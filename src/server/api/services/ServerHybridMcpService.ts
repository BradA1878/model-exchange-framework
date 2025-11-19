/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * Server-Side Hybrid MCP Service
 * 
 * Manages the hybrid MCP architecture on the server side, integrating:
 * - Internal MXF MCP tools (from existing McpToolRegistry) 
 * - External MCP servers (Calculator, Sequential Thinking, etc.)
 * - Unified tool discovery and execution interface
 * - Real-time tool registry updates via EventBus
 * 
 * This service runs server-side and follows existing MCP patterns.
 */

import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { ExternalMcpServerManager } from '../../../shared/protocols/mcp/services/ExternalMcpServerManager';
import { 
    EXTERNAL_SERVER_CONFIGS, 
    getAutoStartConfigs
} from '../../../shared/protocols/mcp/services/ExternalServerConfigs';
import type { ExternalServerConfig } from '../../../shared/protocols/mcp/services/ExternalMcpServerManager';
import { HybridMcpToolRegistry } from '../../../shared/protocols/mcp/services/HybridMcpToolRegistry';
import { McpToolRegistry } from './McpToolRegistry';
import { firstValueFrom } from 'rxjs';
import { EventBus } from '../../../shared/events/EventBus';
import { McpEvents } from '../../../shared/events/event-definitions/McpEvents';
import fs from 'fs';
import path from 'path';

// Create logger and validator
const logger = new Logger('info', 'ServerHybridMcpService', 'server');
const validate = createStrictValidator('ServerHybridMcpService');

// Priority servers that should auto-start (dynamically determined from configs)
const PRIORITY_EXTERNAL_SERVERS = getAutoStartConfigs();

// Basic types for server use
export interface HybridToolInfo {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    source: 'internal' | 'external';
    category?: string;
    serverId?: string;
    enabled?: boolean;
}

export interface HybridServiceStatus {
    initialized: boolean;
    internalToolsCount: number;
    externalToolsCount: number;
    totalToolsCount: number;
    runningServers: string[];
    failedServers: string[];
    uptime: number;
}

export interface HybridServiceStats {
    status: HybridServiceStatus;
    metadata: {
        lastUpdated: string;
    };
}

/**
 * Configuration for server-side hybrid MCP service
 */
export interface ServerHybridMcpConfig {
    externalServerConfigs?: ExternalServerConfig[];
    autoStartPriorityServers?: boolean;
    startupTimeout?: number;
}

/**
 * Server-side Hybrid MCP Service
 * Integrates with existing MCP infrastructure and provides unified tool management
 */
export class ServerHybridMcpService {
    private static instance: ServerHybridMcpService | null = null;
    private readonly externalServerManager: ExternalMcpServerManager;
    private readonly hybridRegistry: HybridMcpToolRegistry;
    private readonly config: Required<ServerHybridMcpConfig>;
    
    private initialized: boolean = false;
    private readonly startTime: number = Date.now();

    /**
     * Private constructor - use getInstance() instead
     */
    private constructor(config: ServerHybridMcpConfig = {}) {
        // Validate configuration
        validate.assertIsObject(config, 'config');

        // Set default configuration
        this.config = {
            externalServerConfigs: config.externalServerConfigs || PRIORITY_EXTERNAL_SERVERS,
            autoStartPriorityServers: config.autoStartPriorityServers ?? true,
            startupTimeout: config.startupTimeout || 30000
        };


        // Initialize components
        this.externalServerManager = new ExternalMcpServerManager();
        this.hybridRegistry = new HybridMcpToolRegistry(McpToolRegistry.getInstance(), this.externalServerManager);

        // Expose hybrid registry globally for tools_recommend tool
        (global as any).hybridMcpToolRegistry = this.hybridRegistry;

        // Register external server configurations WITHOUT auto-starting
        this.config.externalServerConfigs.forEach(serverConfig => {
            // Create a config copy with autoStart disabled during registration
            const registrationConfig = { ...serverConfig, autoStart: false };
            this.externalServerManager.registerServer(registrationConfig);
        });

    }

    /**
     * Get the singleton instance of ServerHybridMcpService
     */
    public static getInstance(config: ServerHybridMcpConfig = {}): ServerHybridMcpService {
        if (!ServerHybridMcpService.instance) {
            ServerHybridMcpService.instance = new ServerHybridMcpService(config);
        }
        return ServerHybridMcpService.instance;
    }

    /**
     * Ensure required directories exist for external MCP servers
     */
    private async ensureRequiredDirectories(): Promise<void> {
        const requiredDirectories = [
            '/tmp/mcp-workspace'  // Required by Filesystem MCP server
        ];

        for (const dir of requiredDirectories) {
            try {
                // Check if directory exists
                await fs.promises.access(dir, fs.constants.F_OK);
            } catch (error) {
                // Directory doesn't exist, create it
                try {
                    await fs.promises.mkdir(dir, { recursive: true });
                } catch (createError) {
                    const errorMessage = createError instanceof Error ? createError.message : String(createError);
                    logger.error(`❌ Failed to create directory ${dir}: ${errorMessage}`);
                    throw new Error(`Failed to create required directory ${dir}: ${errorMessage}`);
                }
            }
        }
    }

    /**
     * Initialize the hybrid MCP service
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            logger.warn('⚠️ Service already initialized');
            return;
        }


        try {
            // Ensure required directories exist before starting servers
            await this.ensureRequiredDirectories();

            // Start priority external servers (clean startup - no stopping needed)
            if (this.config.autoStartPriorityServers) {
                await this.startPriorityExternalServers();
            }

            // Refresh tools in hybrid registry with any discovered external tools
            await this.refreshHybridRegistryExternalTools();

            this.initialized = true;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Failed to initialize ServerHybridMcpService: ${errorMessage}`);
            throw new Error(`Failed to initialize hybrid MCP service: ${errorMessage}`);
        }
    }

    /**
     * Start priority external servers
     */
    private async startPriorityExternalServers(): Promise<void> {
        const priorityServers = this.config.externalServerConfigs
            .filter(config => config.autoStart)
            .map(config => config.id);

        if (priorityServers.length === 0) {
            return;
        }


        const startPromises = priorityServers.map(async (serverId) => {
            try {
                await this.externalServerManager.startServer(serverId);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn(`⚠️ Failed to start priority server ${serverId}: ${errorMessage}`);
                // Continue with other servers even if one fails
            }
        });

        await Promise.allSettled(startPromises);
    }

    /**
     * Force refresh of external tools in hybrid registry
     */
    private async refreshHybridRegistryExternalTools(): Promise<void> {
        try {
            // Access the private refreshExternalTools method via reflection or add a public method
            // For now, we'll trigger a refresh by emitting the tools discovered event
            const allExternalTools = this.externalServerManager.getAllExternalTools();
            
            // Emit the tools discovered event to trigger hybrid registry refresh
            if (allExternalTools.length > 0) {
                EventBus.server.emit(McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED, {
                    serverId: 'manual-refresh',
                    tools: allExternalTools,
                    timestamp: new Date().toISOString(),
                    source: 'ServerHybridMcpService'
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(`⚠️ Failed to refresh external tools in hybrid registry: ${errorMessage}`);
        }
    }

    /**
     * Get service status
     */
    public getStatus(): HybridServiceStatus {
        const externalStatus = this.externalServerManager.getServerStatuses();
        
        // Count internal tools from existing registry
        let internalToolsCount = 0;
        try {
            // Get tools synchronously if possible, otherwise default to 0
            const toolsMap = (McpToolRegistry.getInstance() as any).tools;
            internalToolsCount = toolsMap ? toolsMap.size : 0;
        } catch (error) {
            logger.warn('Could not get internal tools count');
        }

        // Count running and failed external servers
        const runningServers = Object.keys(externalStatus).filter(
            id => externalStatus[id].status === 'running'
        );
        const failedServers = Object.keys(externalStatus).filter(
            id => externalStatus[id].status === 'error'
        );

        // External tools count (mock for now - would be discovered from servers)
        const externalToolsCount = runningServers.length * 2; // Estimate 2 tools per server

        return {
            initialized: this.initialized,
            internalToolsCount,
            externalToolsCount,
            totalToolsCount: internalToolsCount + externalToolsCount,
            runningServers,
            failedServers,
            uptime: Date.now() - this.startTime
        };
    }

    /**
     * Get service statistics
     */
    public getServiceStats(): HybridServiceStats {
        const status = this.getStatus();

        return {
            status,
            metadata: {
                lastUpdated: new Date().toISOString()
            }
        };
    }

    /**
     * Get available internal tools
     */
    public async getInternalTools(): Promise<HybridToolInfo[]> {
        try {
            const tools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
            return tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                source: 'internal' as const,
                enabled: tool.enabled
            }));
        } catch (error) {
            logger.error(`Failed to get internal tools: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Get external server statuses
     */
    public getExternalServerStatuses(): Record<string, any> {
        return this.externalServerManager.getServerStatuses();
    }

    /**
     * Start an external server
     */
    public async startExternalServer(serverId: string): Promise<boolean> {
        try {
            await this.externalServerManager.startServer(serverId);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to start server ${serverId}: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Stop an external server
     */
    public async stopExternalServer(serverId: string): Promise<boolean> {
        try {
            await this.externalServerManager.stopServer(serverId);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to stop server ${serverId}: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Get external server manager (for advanced operations)
     */
    public getExternalServerManager(): ExternalMcpServerManager {
        return this.externalServerManager;
    }

    /**
     * Get hybrid registry
     */
    public getHybridRegistry(): HybridMcpToolRegistry {
        return this.hybridRegistry;
    }

    /**
     * Shutdown the service
     */
    public async shutdown(): Promise<void> {
        
        try {
            // Clean up global reference
            delete (global as any).hybridMcpToolRegistry;
            
            // Shutdown external servers
            await this.externalServerManager.shutdown();
            
            this.initialized = false;
        } catch (error) {
            logger.error(`❌ Error during ServerHybridMcpService shutdown: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
