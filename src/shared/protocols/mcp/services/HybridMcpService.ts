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
 * HybridMcpService.ts
 * 
 * Central service for managing the hybrid MCP architecture that combines
 * internal MXF tools with external MCP servers. Provides a unified interface
 * for tool discovery, execution, and management across the ecosystem.
 */

import { Observable, BehaviorSubject, firstValueFrom } from 'rxjs';
import { ExternalMcpServerManager } from './ExternalMcpServerManager';
import { HybridMcpToolRegistry, HybridMcpTool } from './HybridMcpToolRegistry';
import { McpToolRegistry } from '../../../../server/api/services/McpToolRegistry';
import { EXTERNAL_SERVER_CONFIGS, getAutoStartConfigs } from './ExternalServerConfigs';
import { createStrictValidator } from '../../../utils/validation';
import { Logger } from '../../../utils/Logger';
import { EventBus } from '../../../events/EventBus';

// Create logger and validator instances
const logger = new Logger('info', 'HybridMcpService', 'server');
const validator = createStrictValidator('HybridMcpService');

/**
 * Service initialization configuration
 */
export interface HybridMcpServiceConfig {
    /** Whether to auto-start priority external servers */
    autoStartServers: boolean;
    /** Custom server configurations to override defaults */
    customConfigs?: Record<string, any>;
    /** Maximum startup time for the service */
    startupTimeout: number;
}

/**
 * Service status information
 */
export interface HybridMcpServiceStatus {
    /** Whether the service is fully initialized */
    initialized: boolean;
    /** Number of internal tools available */
    internalToolsCount: number;
    /** Number of external tools available */
    externalToolsCount: number;
    /** Total number of tools available */
    totalToolsCount: number;
    /** List of running external servers */
    runningServers: string[];
    /** List of failed servers */
    failedServers: string[];
    /** Service uptime in milliseconds */
    uptime: number;
}

/**
 * Central service for hybrid MCP architecture
 */
export class HybridMcpService {
    private internalRegistry: McpToolRegistry;
    private externalServerManager: ExternalMcpServerManager;
    private hybridRegistry: HybridMcpToolRegistry;
    
    private serviceStartTime: number = 0;
    private statusSubject = new BehaviorSubject<HybridMcpServiceStatus>({
        initialized: false,
        internalToolsCount: 0,
        externalToolsCount: 0,
        totalToolsCount: 0,
        runningServers: [],
        failedServers: [],
        uptime: 0
    });

    constructor(
        internalRegistry: McpToolRegistry,
        config: Partial<HybridMcpServiceConfig> = {}
    ) {
        this.internalRegistry = internalRegistry;
        
        // Initialize external server manager
        this.externalServerManager = new ExternalMcpServerManager();
        
        // Initialize hybrid registry
        this.hybridRegistry = new HybridMcpToolRegistry(
            this.internalRegistry,
            this.externalServerManager
        );

    }

    /**
     * Initialize the hybrid MCP service
     */
    public async initialize(config: Partial<HybridMcpServiceConfig> = {}): Promise<void> {
        const startTime = Date.now();
        this.serviceStartTime = startTime;
        
        const finalConfig: HybridMcpServiceConfig = {
            autoStartServers: true,
            startupTimeout: 30000, // 30 seconds
            ...config
        };


        try {
            // Step 1: Wait for internal registry to be ready
            await this.waitForInternalRegistry();

            // Step 2: Set up status monitoring
            this.setupStatusMonitoring();

            // Step 3: Auto-start priority external servers if configured
            if (finalConfig.autoStartServers) {
                await this.startPriorityServers();
            }

            // Step 4: Make hybrid registry globally available for MetaTools
            (global as any).hybridMcpToolRegistry = this.hybridRegistry;

            // Update status
            this.updateServiceStatus();

            const initTime = Date.now() - startTime;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ HybridMcpService initialization failed: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Wait for internal registry to be ready with tools
     */
    private async waitForInternalRegistry(): Promise<void> {
        
        let attempts = 0;
        const maxAttempts = 10;
        const delay = 1000; // 1 second

        while (attempts < maxAttempts) {
            try {
                const tools = await firstValueFrom(this.internalRegistry.listTools());
                if (tools.length > 0) {
                    return;
                }
            } catch (error) {
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        logger.warn('⚠️ Internal registry timeout, proceeding anyway');
    }

    /**
     * Set up status monitoring for real-time updates
     */
    private setupStatusMonitoring(): void {
        // Monitor hybrid registry changes
        this.hybridRegistry.listAllTools().subscribe({
            next: () => {
                this.updateServiceStatus();
            },
            error: (error) => {
                logger.error(`Status monitoring error: ${error.message}`);
            }
        });

        // Monitor external server events
        this.externalServerManager.on('serverStarted', (data) => {
            this.updateServiceStatus();
        });

        this.externalServerManager.on('serverStopped', (data) => {
            this.updateServiceStatus();
        });

        this.externalServerManager.on('serverFailed', (data) => {
            logger.warn(`⚠️ External server failed: ${data.serverId} - ${data.reason}`);
            this.updateServiceStatus();
        });
    }

    /**
     * Start priority external servers (calculator and sequential thinking)
     */
    private async startPriorityServers(): Promise<void> {
        
        const autoStartConfigs = getAutoStartConfigs();
        const startPromises = autoStartConfigs.map(config => 
            this.externalServerManager.startServerFromConfig(config).catch(error => {
                logger.error(`Failed to start server ${config.id}: ${error.message}`);
                return false;
            })
        );

        const results = await Promise.allSettled(startPromises);
        const successful = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        
    }

    /**
     * Update service status information
     */
    private updateServiceStatus(): void {
        try {
            const hybridTools = this.hybridRegistry.getAllToolsSnapshot();
            const stats = this.hybridRegistry.getToolStats();
            const runningServers = this.externalServerManager.getRunningServerIds();
            const failedServers = this.externalServerManager.getFailedServerIds();

            const status: HybridMcpServiceStatus = {
                initialized: true,
                internalToolsCount: stats.internal,
                externalToolsCount: stats.external,
                totalToolsCount: stats.total,
                runningServers,
                failedServers,
                uptime: this.serviceStartTime > 0 ? Date.now() - this.serviceStartTime : 0
            };

            this.statusSubject.next(status);

        } catch (error) {
            logger.error(`Error updating service status: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get current service status
     */
    public getStatus(): HybridMcpServiceStatus {
        return this.statusSubject.value;
    }

    /**
     * Get service status as observable
     */
    public getStatusObservable(): Observable<HybridMcpServiceStatus> {
        return this.statusSubject.asObservable();
    }

    /**
     * Get the hybrid tool registry
     */
    public getHybridRegistry(): HybridMcpToolRegistry {
        return this.hybridRegistry;
    }

    /**
     * Get the external server manager
     */
    public getExternalServerManager(): ExternalMcpServerManager {
        return this.externalServerManager;
    }

    /**
     * Start a specific external server by ID
     */
    public async startExternalServer(serverId: string): Promise<boolean> {
        
        const config = Object.values(EXTERNAL_SERVER_CONFIGS).find(c => c.id === serverId);
        if (!config) {
            throw new Error(`Server configuration not found: ${serverId}`);
        }

        return this.externalServerManager.startServerFromConfig(config);
    }

    /**
     * Stop a specific external server by ID
     */
    public async stopExternalServer(serverId: string): Promise<boolean> {
        try {
            await this.externalServerManager.stopServer(serverId);
            return true;
        } catch (error) {
            logger.error(`Failed to stop server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Restart a specific external server by ID
     */
    public async restartExternalServer(serverId: string): Promise<boolean> {
        return this.externalServerManager.restartServer(serverId);
    }

    /**
     * Execute a tool through the hybrid registry
     */
    public async executeTool(
        toolName: string,
        input: Record<string, any>,
        agentId?: string,
        channelId?: string
    ): Promise<any> {
        return this.hybridRegistry.executeTool(toolName, input, agentId, channelId);
    }

    /**
     * Get available tools with filtering options
     */
    public getAvailableTools(filters: {
        categories?: string[];
        sources?: string[];
        excludeTools?: string[];
        internalOnly?: boolean;
        externalOnly?: boolean;
    } = {}): HybridMcpTool[] {
        let tools = this.hybridRegistry.getAllToolsSnapshot();

        // Apply filters
        if (filters.categories && filters.categories.length > 0) {
            tools = tools.filter(tool => filters.categories!.includes(tool.category));
        }

        if (filters.sources && filters.sources.length > 0) {
            tools = tools.filter(tool => filters.sources!.includes(tool.source));
        }

        if (filters.excludeTools && filters.excludeTools.length > 0) {
            tools = tools.filter(tool => !filters.excludeTools!.includes(tool.name));
        }

        if (filters.internalOnly) {
            tools = tools.filter(tool => !tool.isExternal);
        }

        if (filters.externalOnly) {
            tools = tools.filter(tool => tool.isExternal);
        }

        return tools;
    }

    /**
     * Get detailed service statistics
     */
    public getServiceStats(): {
        status: HybridMcpServiceStatus;
        toolStats: ReturnType<HybridMcpToolRegistry['getToolStats']>;
        serverStats: {
            total: number;
            running: number;
            failed: number;
            byStatus: Record<string, number>;
        };
    } {
        const status = this.getStatus();
        const toolStats = this.hybridRegistry.getToolStats();
        const serverStatuses = this.externalServerManager.getServerStatuses();
        
        const serverStats = {
            total: Object.keys(EXTERNAL_SERVER_CONFIGS).length,
            running: status.runningServers.length,
            failed: status.failedServers.length,
            byStatus: {} as Record<string, number>
        };

        // Count servers by status
        for (const [serverId, serverStatus] of Object.entries(serverStatuses)) {
            const statusKey = serverStatus.status;
            serverStats.byStatus[statusKey] = (serverStats.byStatus[statusKey] || 0) + 1;
        }

        return {
            status,
            toolStats,
            serverStats
        };
    }

    /**
     * Shutdown the hybrid MCP service
     */
    public async shutdown(): Promise<void> {

        try {
            // Stop all external servers
            await this.externalServerManager.shutdown();
            
            // Shutdown hybrid registry
            await this.hybridRegistry.shutdown();
            
            // Clear global reference
            delete (global as any).hybridMcpToolRegistry;
            
            // Complete status subject
            this.statusSubject.complete();


        } catch (error) {
            logger.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
