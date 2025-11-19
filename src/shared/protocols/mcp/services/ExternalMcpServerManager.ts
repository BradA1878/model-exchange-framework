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
 * ExternalMcpServerManager.ts
 * 
 * Manages external MCP server processes for the hybrid MCP architecture.
 * Provides process lifecycle management, health monitoring, and tool discovery
 * for external MCP servers like calculator, sequential thinking, filesystem, etc.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createStrictValidator } from '../../../utils/validation';
import { Logger } from '../../../utils/Logger';
import { McpEvents } from '../../../events/event-definitions/McpEvents';
import { EventBus } from '../../../events/EventBus';
import { 
    createExternalMcpServerEventPayload,
    createExternalMcpServerErrorEventPayload,
    createExternalMcpServerHealthStatusEventPayload,
    createExternalMcpServerToolsDiscoveredEventPayload
} from '../../../schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { AutoCorrectionService } from '../../../services/AutoCorrectionService';

// Create logger and validator instances
const logger = new Logger('info', 'ExternalMcpServerManager', 'server');
const validator = createStrictValidator('ExternalMcpServerManager');

/**
 * Configuration for an external MCP server
 */
export interface ExternalServerConfig {
    /** Unique identifier for the server */
    id: string;
    /** Display name for the server */
    name: string;
    /** Version of the server */
    version: string;
    /** Description of the server's capabilities */
    description?: string;
    /** Command to execute (e.g., "npx", "uvx", "node") */
    command: string;
    /** Arguments for the command */
    args: string[];
    /** Working directory for the process */
    workingDirectory?: string;
    /** Environment variables for the process */
    environmentVariables?: Record<string, string>;
    /** Whether to auto-start the server on initialization */
    autoStart: boolean;
    /** Whether to restart the server automatically on crash */
    restartOnCrash: boolean;
    /** Health check interval in milliseconds */
    healthCheckInterval: number;
    /** Maximum number of restart attempts */
    maxRestartAttempts: number;
    /** Timeout for server startup in milliseconds */
    startupTimeout: number;
}

/**
 * Status of an external MCP server
 */
export interface ExternalServerStatus {
    id: string;
    name: string;
    status: 'stopped' | 'starting' | 'running' | 'error' | 'restarting';
    pid?: number;
    uptime?: number;
    restartCount: number;
    lastError?: string;
    lastHealthCheck?: number;
    initialized?: boolean;  // Flag to track if MCP connection has been initialized
    initializing?: boolean; // Flag to prevent concurrent initialization
    tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
    }>;
}

/**
 * MCP tool definition from external server
 */
export interface ExternalMcpTool {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    serverId: string;
}

/**
 * Manages external MCP server processes and their lifecycle
 */
export class ExternalMcpServerManager extends EventEmitter {
    private servers: Map<string, {
        config: ExternalServerConfig;
        process?: ChildProcess;
        status: ExternalServerStatus;
        healthCheckTimer?: NodeJS.Timeout;
        startupTimer?: NodeJS.Timeout;
    }> = new Map();
    
    private autoCorrectionService: AutoCorrectionService;

    constructor() {
        super();
        this.autoCorrectionService = AutoCorrectionService.getInstance();

        // Set up event listeners for SDK-initiated server registration
        this.setupEventHandlers();
    }

    /**
     * Set up EventBus handlers for external server registration from SDK
     */
    private setupEventHandlers(): void {
        const { EventBus } = require('../../../events/EventBus');
        const { Events } = require('../../../events/EventNames');
        const { v4: uuidv4 } = require('uuid');

        // Handle external server registration requests from SDK
        EventBus.server.on(Events.Mcp.EXTERNAL_SERVER_REGISTER, async (payload: any) => {
            try {

                const serverConfig = {
                    id: payload.data.id,
                    name: payload.data.name,
                    version: payload.data.version || '1.0.0',
                    command: payload.data.command || '',
                    args: payload.data.args || [],
                    transport: (payload.data.transport || 'stdio') as 'stdio' | 'http',
                    url: payload.data.url,
                    autoStart: payload.data.autoStart !== false,
                    restartOnCrash: payload.data.restartOnCrash !== false,
                    maxRestartAttempts: payload.data.maxRestartAttempts || 3,
                    healthCheckInterval: payload.data.healthCheckInterval || 30000,
                    startupTimeout: payload.data.startupTimeout || 10000,
                    environmentVariables: payload.data.environmentVariables || {}
                };

                // Register the server
                await this.registerServer(serverConfig);

                // Emit success response
                EventBus.server.emit(Events.Mcp.EXTERNAL_SERVER_REGISTERED, {
                    eventId: uuidv4(),
                    eventType: Events.Mcp.EXTERNAL_SERVER_REGISTERED,
                    timestamp: Date.now(),
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    data: {
                        serverId: serverConfig.id,
                        success: true,
                        message: `Server ${serverConfig.name} registered successfully`
                    }
                });


            } catch (error) {
                logger.error(`Error registering external server:`, error);

                // Emit error response
                EventBus.server.emit(Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED, {
                    eventId: uuidv4(),
                    eventType: Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED,
                    timestamp: Date.now(),
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    data: {
                        serverId: payload.data?.id,
                        success: false,
                        error: error instanceof Error ? error.message : String(error)
                    }
                });
            }
        });

        // Handle external server unregistration requests from SDK
        EventBus.server.on(Events.Mcp.EXTERNAL_SERVER_UNREGISTER, async (payload: any) => {
            try {

                const serverId = payload.data.serverId;
                await this.stopServer(serverId);
                this.servers.delete(serverId);

                // Emit success response
                EventBus.server.emit(Events.Mcp.EXTERNAL_SERVER_UNREGISTERED, {
                    eventId: uuidv4(),
                    eventType: Events.Mcp.EXTERNAL_SERVER_UNREGISTERED,
                    timestamp: Date.now(),
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    data: {
                        serverId: serverId,
                        success: true,
                        message: `Server ${serverId} unregistered successfully`
                    }
                });


            } catch (error) {
                logger.error(`Error unregistering external server:`, error);

                // Emit error response
                EventBus.server.emit(Events.Mcp.EXTERNAL_SERVER_UNREGISTERED, {
                    eventId: uuidv4(),
                    eventType: Events.Mcp.EXTERNAL_SERVER_UNREGISTERED,
                    timestamp: Date.now(),
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    data: {
                        serverId: payload.data?.serverId,
                        success: false,
                        error: error instanceof Error ? error.message : String(error)
                    }
                });
            }
        });

    }

    /**
     * Register a new external server configuration
     */
    public async registerServer(config: ExternalServerConfig): Promise<void> {
        // Validate configuration
        validator.assertIsNonEmptyString(config.id, 'Server ID must be a non-empty string');
        validator.assertIsNonEmptyString(config.name, 'Server name must be a non-empty string');
        validator.assertIsNonEmptyString(config.command, 'Server command must be a non-empty string');
        validator.assertIsArray(config.args, 'Server args must be an array');


        // Check if server already exists
        if (this.servers.has(config.id)) {
            throw new Error(`Server with ID ${config.id} is already registered`);
        }

        // Create initial status
        const status: ExternalServerStatus = {
            id: config.id,
            name: config.name,
            status: 'stopped',
            restartCount: 0,
            tools: []
        };

        // Store server configuration and status
        this.servers.set(config.id, {
            config,
            status
        });


        // Auto-start if configured
        if (config.autoStart) {
            await this.startServer(config.id);
        }
    }

    /**
     * Start an external server process
     */
    public async startServer(serverId: string, agentId?: AgentId, channelId?: ChannelId): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData) {
            throw new Error(`Server ${serverId} not found`);
        }

        const { config, status } = serverData;

        if (status.status === 'running') {
            return;
        }


        // Update status
        status.status = 'starting';
        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_SPAWN, serverId, agentId, channelId);

        try {
            // Spawn the process
            const childProcess = spawn(config.command, config.args, {
                cwd: config.workingDirectory || process.cwd(),
                env: { ...process.env, ...config.environmentVariables },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Store process reference
            serverData.process = childProcess;
            status.pid = childProcess.pid;

            // Set up process event handlers
            this.setupProcessEventHandlers(serverId, childProcess);

            // Set startup timeout
            serverData.startupTimer = setTimeout(() => {
                if (status.status === 'starting') {
                    logger.error(`❌ Server ${config.name} startup timed out`);
                    this.handleServerError(serverId, 'Startup timeout', agentId, channelId);
                }
            }, config.startupTimeout);

            // Start health check monitoring
            this.startHealthChecking(serverId);


        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Failed to start server ${config.name}: ${errorMessage}`);
            this.handleServerError(serverId, errorMessage, agentId, channelId);
        }
    }

    /**
     * Stop an external server process
     */
    public async stopServer(serverId: string, agentId?: AgentId, channelId?: ChannelId): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData) {
            throw new Error(`Server ${serverId} not found`);
        }

        const { config, status } = serverData;

        if (status.status === 'stopped') {
            return;
        }


        // Emit stop event
        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STOP, serverId, agentId, channelId);

        // Clear timers
        if (serverData.healthCheckTimer) {
            clearInterval(serverData.healthCheckTimer);
            serverData.healthCheckTimer = undefined;
        }
        if (serverData.startupTimer) {
            clearTimeout(serverData.startupTimer);
            serverData.startupTimer = undefined;
        }

        // Terminate process
        if (serverData.process) {
            serverData.process.kill('SIGTERM');
            
            // Force kill after timeout
            setTimeout(() => {
                if (serverData.process && !serverData.process.killed) {
                    logger.warn(`🔪 Force killing server ${config.name}`);
                    serverData.process.kill('SIGKILL');
                }
            }, 5000);
        }

        // Update status
        status.status = 'stopped';
        status.pid = undefined;
        status.tools = [];

        // Emit stopped event
        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STOPPED, serverId, agentId, channelId);

    }

    /**
     * Get status of all servers
     */
    public getServerStatus(): Map<string, ExternalServerStatus> {
        const statusMap = new Map<string, ExternalServerStatus>();
        
        for (const [id, serverData] of this.servers) {
            statusMap.set(id, { ...serverData.status });
        }

        return statusMap;
    }

    /**
     * Get status of a specific server
     */
    public getServerStatusById(serverId: string): ExternalServerStatus | undefined {
        const serverData = this.servers.get(serverId);
        return serverData ? { ...serverData.status } : undefined;
    }

    /**
     * Get all discovered tools from external servers
     */
    public getAllExternalTools(): ExternalMcpTool[] {
        const tools: ExternalMcpTool[] = [];

        for (const [serverId, serverData] of this.servers) {
            for (const tool of serverData.status.tools) {
                tools.push({
                    ...tool,
                    serverId
                });
            }
        }

        return tools;
    }

    /**
     * Set up event handlers for a spawned process
     */
    private setupProcessEventHandlers(serverId: string, process: ChildProcess): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config, status } = serverData;

        // Handle process exit
        process.on('exit', (code, signal) => {
            
            status.status = 'stopped';
            status.pid = undefined;

            // Clear timers
            if (serverData.healthCheckTimer) {
                clearInterval(serverData.healthCheckTimer);
                serverData.healthCheckTimer = undefined;
            }

            // Handle restart if configured
            if (config.restartOnCrash && code !== 0 && status.restartCount < config.maxRestartAttempts) {
                status.restartCount++;
                
                setTimeout(() => {
                    this.startServer(serverId);
                }, 2000); // Wait 2 seconds before restart
            }

            this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STOPPED, serverId);
        });

        // Handle process errors
        process.on('error', (error) => {
            logger.error(`❌ Server ${config.name} process error: ${error.message}`);
            this.handleServerError(serverId, error.message);
        });

        // Handle stdout for tool discovery and health checks
        if (process.stdout) {
            process.stdout.on('data', (data) => {
                const output = data.toString();
                this.handleServerOutput(serverId, output);
            });
        }

        // Handle stderr for error logging
        if (process.stderr) {
            process.stderr.on('data', (data) => {
                const errorOutput = data.toString();
                // Filter out harmless Node.js experimental warnings from npm
                if (errorOutput.includes('ExperimentalWarning')) {
                    return; // Ignore npm's CommonJS/ES Module warnings
                }
            });
        }

        // Mark as started when process is spawned successfully
        process.on('spawn', () => {
            status.status = 'running';
            
            // Clear startup timer
            if (serverData.startupTimer) {
                clearTimeout(serverData.startupTimer);
                serverData.startupTimer = undefined;
            }

            this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STARTED, serverId);
            
            // Initialize MCP connection first, then discover tools
            setTimeout(() => {
                this.initializeMcpConnection(serverId);
            }, 2000); // Wait 2 seconds for server to fully start
        });
    }

    /**
     * Start health check monitoring for a server
     */
    private startHealthChecking(serverId: string): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config } = serverData;

        serverData.healthCheckTimer = setInterval(() => {
            this.performHealthCheck(serverId);
        }, config.healthCheckInterval);
    }

    /**
     * Perform health check for a server
     */
    private async performHealthCheck(serverId: string): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config, status } = serverData;

        // Emit health check event
        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_HEALTH_CHECK, serverId);

        // Simple health check - process is running
        const isHealthy = serverData.process && !serverData.process.killed;
        
        status.lastHealthCheck = Date.now();
        
        if (status.status === 'running') {
            status.uptime = Date.now() - (status.lastHealthCheck - config.healthCheckInterval);
        }

        // Emit health status
        this.emitServerHealthStatus(serverId, isHealthy ? 'healthy' : 'unhealthy');
    }

    /**
     * Handle server output for tool discovery
     */
    private handleServerOutput(serverId: string, output: string): void {
        // For now, log the output. In the future, we'll parse MCP protocol messages
        //;
        
        // TODO: Parse MCP protocol messages for tool discovery
        // This will be implemented when we add the MCP client integration
    }

    /**
     * Discover tools available from a server
     */
    private async discoverServerTools(serverId: string): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config, process } = serverData;


        // Emit discovery event
        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_DISCOVERY, serverId);

        try {
            // Real MCP tool discovery using JSON-RPC tools/list method
            if (process && process.stdin && process.stdout && !process.killed) {
                const realTools = await this.discoverRealToolsFromServer(serverId);
                
                serverData.status.tools = realTools;
                
                // Log discovered tool names for debugging
                if (realTools.length > 0) {
                    // Special logging for calculator server
                    if (serverId === 'calculator') {
                        //     name: t.name,
                        //     description: t.description?.substring(0, 50) + '...'
                        // })));
                    } else {
                    }
                } else {
                    logger.warn(`⚠️ No tools found from ${config.name} - server may not support tools/list or have no tools`);
                }
            } else {
                logger.error(`❌ Server ${config.name} process not available for tool discovery`);
                serverData.status.tools = [];
            }
        } catch (error) {
            logger.error(`❌ Failed to discover tools from ${config.name}: ${error instanceof Error ? error.message : String(error)}`);
            logger.error(`🚫 No fallback - server ${config.name} will have no available tools until discovery succeeds`);
            serverData.status.tools = [];
        }

        // Emit tools discovered event
        this.emitServerToolsDiscovered(serverId, serverData.status.tools);

    }

    /**
     * Initialize MCP connection with server
     */
    private async initializeMcpConnection(serverId: string): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData || !serverData.process) {
            throw new Error(`Server ${serverId} not found or not running`);
        }

        // Prevent duplicate initialization
        if (serverData.status.initialized) {
            logger.warn(`⚠️ MCP connection already initialized for server ${serverData.config.name}`);
            return;
        }

        const { process, config } = serverData;

        if (!process.stdin || !process.stdout) {
            throw new Error('Process streams not available');
        }

        // Mark as initializing to prevent concurrent initialization
        serverData.status.initializing = true;


        // Send MCP initialize request with required parameters
        const initializeRequest = {
            jsonrpc: "2.0",
            id: "initialize",
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {
                    experimental: {},
                    sampling: {}
                },
                clientInfo: {
                    name: "MXF Framework",
                    version: "0.32.0"
                }
            }
        };

        const requestJson = JSON.stringify(initializeRequest) + '\n';
        process.stdin.write(requestJson);

        // Wait for MCP initialize response
        const responseBuffer = await this.waitForMcpResponse(process.stdout, "initialize");
        const response = JSON.parse(responseBuffer);

        if (response.error) {
            logger.error(`❌ MCP initialize error: ${response.error.message}`);
            throw new Error(`MCP initialize error: ${response.error.message}`);
        }


        // Discover tools after MCP connection is initialized
        await this.discoverServerTools(serverId);
        
        // Mark as successfully initialized
        serverData.status.initialized = true;
        serverData.status.initializing = false;
    }

    /**
     * Wait for MCP response with specific ID
     */
    private async waitForMcpResponse(stdout: NodeJS.ReadableStream, requestId: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let responseBuffer = '';
            let timeoutId: NodeJS.Timeout;
            let resolved = false;

            const responseHandler = (data: Buffer): void => {
                if (resolved) return; // Prevent duplicate responses
                
                responseBuffer += data.toString();
                
                // Try to parse JSON response (MCP responses are line-delimited JSON)
                const lines = responseBuffer.split('\n');
                for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i].trim();
                    if (line) {
                        try {
                            const response = JSON.parse(line.trim());
                            
                            // Check if this is our response
                            if (response.id === requestId) {
                                resolved = true;
                                clearTimeout(timeoutId);
                                stdout.removeListener('data', responseHandler);
                                
                                // Return the clean JSON line instead of the entire buffer
                                resolve(line.trim());
                                return;
                            }
                        } catch (parseError) {
                            // Ignore JSON parse errors for incomplete lines
                            continue;
                        }
                    }
                }
                
                // Keep the last incomplete line in buffer
                responseBuffer = lines[lines.length - 1];
            };

            // Set up timeout (30 seconds for MCP response - some servers like n8n need more time)
            timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    stdout.removeListener('data', responseHandler);
                    reject(new Error(`Timeout waiting for MCP response after 30 seconds`));
                }
            }, 30000);

            // Listen for response
            stdout.on('data', responseHandler);
        });
    }

    /**
     * Discover tools from external MCP server using JSON-RPC tools/list method
     */
    private async discoverRealToolsFromServer(serverId: string): Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }>> {
        const serverData = this.servers.get(serverId);
        if (!serverData || !serverData.process) {
            throw new Error(`Server ${serverId} not found or not running`);
        }

        const { process, config } = serverData;

        return new Promise((resolve, reject) => {
            if (!process.stdin || !process.stdout) {
                reject(new Error('Process streams not available'));
                return;
            }

            const requestId = `tools-list-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            
            // Create MCP tool call request according to the protocol
            const mcpRequest = {
                jsonrpc: '2.0',
                id: requestId,
                method: 'tools/list',
                params: {}
            };

            let responseData = '';
            let timeoutId: NodeJS.Timeout;
            let resolved = false;

            const handleData = (chunk: Buffer): void => {
                if (resolved) return; // Prevent duplicate responses
                
                responseData += chunk.toString();
                
                // Look for complete JSON-RPC response
                const lines = responseData.split('\n');
                for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i].trim();
                    if (line) {
                        try {
                            const response = JSON.parse(line.trim());
                            
                            // Check if this is our response
                            if (response.id === requestId) {
                                resolved = true;
                                clearTimeout(timeoutId);
                                process.stdout!.off('data', handleData);
                                
                                if (response.error) {
                                    reject(new Error(`MCP Error: ${response.error.message}`));
                                    return;
                                }

                                if (response.result && response.result.tools) {
                                    const tools = response.result.tools.map((tool: any) => ({
                                        name: tool.name,
                                        description: tool.description || `Tool from ${config.name}`,
                                        inputSchema: tool.inputSchema || { type: 'object', properties: {}, required: [] }
                                    }));
                                    
                                    resolve(tools);
                                } else {
                                    logger.warn(`⚠️ No tools found in response from ${config.name}`);
                                    resolve([]);
                                }
                                return;
                            }
                        } catch (parseError) {
                            // Continue looking for valid JSON in other lines
                        }
                    }
                }
                
                // Keep the last incomplete line in buffer
                responseData = lines[lines.length - 1];
            };

            // Set up timeout (15 seconds for tool execution)
            timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    process.stdout!.off('data', handleData);
                    reject(new Error(`Timeout waiting for tools/list response from ${config.name} after 15 seconds`));
                }
            }, 15000);

            // Listen for response
            process.stdout.on('data', handleData);

            // Send tools/list request
            const requestLine = JSON.stringify(mcpRequest) + '\n';
            process.stdin.write(requestLine);
        });
    }

    /**
     * Handle server errors
     */
    private handleServerError(serverId: string, error: string, agentId?: AgentId, channelId?: ChannelId): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { status } = serverData;

        status.status = 'error';
        status.lastError = error;

        logger.error(`❌ Server ${serverId} error: ${error}`);

        // Emit error event
        this.emitServerErrorEvent(serverId, error, agentId, channelId);
    }

    /**
     * Emit server event with proper payload structure
     */
    private emitServerEvent(eventType: string, serverId: string, agentId?: AgentId, channelId?: ChannelId): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config } = serverData;

        // Use default values if agentId/channelId not provided
        const defaultAgentId = agentId || 'SYSTEM' as AgentId;
        const defaultChannelId = channelId || 'SYSTEM' as ChannelId;

        // Create event payload using EventBus
        EventBus.server.emit(eventType, createExternalMcpServerEventPayload(
            eventType,
            defaultAgentId,
            defaultChannelId,
            {
                name: config.name,
                version: config.version,
                description: config.description
            }
        ));
    }

    /**
     * Emit server error event with detailed error information
     */
    private emitServerErrorEvent(serverId: string, error: string, agentId?: AgentId, channelId?: ChannelId): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const defaultAgentId = agentId || 'SYSTEM' as AgentId;
        const defaultChannelId = channelId || 'SYSTEM' as ChannelId;

        EventBus.server.emit(McpEvents.EXTERNAL_SERVER_ERROR, createExternalMcpServerErrorEventPayload(
            McpEvents.EXTERNAL_SERVER_ERROR,
            defaultAgentId,
            defaultChannelId,
            {
                error,
                code: 'EXTERNAL_SERVER_ERROR',
                details: { serverId }
            }
        ));
    }

    /**
     * Emit server health status event
     */
    private emitServerHealthStatus(serverId: string, healthStatus: string): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config } = serverData;

        EventBus.server.emit(McpEvents.EXTERNAL_SERVER_HEALTH_STATUS, createExternalMcpServerHealthStatusEventPayload(
            McpEvents.EXTERNAL_SERVER_HEALTH_STATUS,
            'SYSTEM' as AgentId,
            'SYSTEM' as ChannelId,
            {
                name: config.name,
                version: config.version,
                status: healthStatus,
                description: config.description
            }
        ));
    }

    /**
     * Emit tools discovered event
     */
    private emitServerToolsDiscovered(serverId: string, tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }>): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config } = serverData;

        EventBus.server.emit(McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED, createExternalMcpServerToolsDiscoveredEventPayload(
            McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED,
            'SYSTEM' as AgentId,
            'SYSTEM' as ChannelId,
            {
                name: config.name,
                version: config.version,
                tools
            }
        ));
    }

    /**
     * Cleanup and shutdown all servers
     */
    public async shutdown(): Promise<void> {

        const shutdownPromises = Array.from(this.servers.keys()).map(serverId => 
            this.stopServer(serverId)
        );

        await Promise.allSettled(shutdownPromises);

        this.servers.clear();
        this.removeAllListeners();

    }

    /**
     * Get list of running server IDs
     */
    public getRunningServerIds(): string[] {
        const runningServers: string[] = [];
        for (const [serverId, serverData] of this.servers.entries()) {
            if (serverData.status.status === 'running') {
                runningServers.push(serverId);
            }
        }
        return runningServers;
    }

    /**
     * Get list of failed server IDs
     */
    public getFailedServerIds(): string[] {
        const failedServers: string[] = [];
        for (const [serverId, serverData] of this.servers.entries()) {
            if (serverData.status.status === 'error') {
                failedServers.push(serverId);
            }
        }
        return failedServers;
    }

    /**
     * Get statuses of all servers
     */
    public getServerStatuses(): Record<string, ExternalServerStatus> {
        const statuses: Record<string, ExternalServerStatus> = {};
        for (const [serverId, serverData] of this.servers.entries()) {
            statuses[serverId] = { ...serverData.status };
        }
        return statuses;
    }

    /**
     * Start a server using its configuration object
     */
    public async startServerFromConfig(config: ExternalServerConfig): Promise<boolean> {
        try {
            // Register the server if not already registered
            if (!this.servers.has(config.id)) {
                await this.registerServer(config);
            }

            // Start the server process
            await this.startServer(config.id);
            return true;

        } catch (error) {
            logger.error(`Failed to start server ${config.id}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Restart a server by ID
     */
    public async restartServer(serverId: string): Promise<boolean> {
        try {

            // Stop the server first
            await this.stopServer(serverId);

            // Wait a bit before restarting
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Start the server again
            await this.startServer(serverId);

            return true;

        } catch (error) {
            logger.error(`Failed to restart server ${serverId}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Execute a tool on an external MCP server via JSON-RPC with auto-correction support
     */
    public async executeToolOnServer(
        serverId: string, 
        toolName: string, 
        input: any,
        agentId: string = 'system',
        channelId: string = 'default'
    ): Promise<any> {
        // PROACTIVE CORRECTION: Apply known corrections before attempting execution
        // NOTE: n8n-mcp server has built-in n8n_autofix_workflow and validation tools,
        // so proactive correction is not needed for n8n_* tools. This is kept for
        // potential future external tools that might benefit from it.
        // Disabled for now since no tools currently need it.
        const enableProactiveCorrection = false;
        if (enableProactiveCorrection && (toolName === 'create_workflow' || toolName === 'update_workflow')) {
            const proactiveCorrection = await this.autoCorrectionService.attemptCorrection(
                agentId as AgentId,
                channelId as ChannelId,
                toolName,
                input,
                '', // No error yet - proactive check
                undefined
            );
            
            if (proactiveCorrection.corrected && proactiveCorrection.correctedParameters) {
                input = proactiveCorrection.correctedParameters;
            }
        }
        
        const maxAttempts = 2; // Original attempt + 1 retry with correction
        let currentAttempt = 0;
        let lastError: Error | null = null;
        
        while (currentAttempt < maxAttempts) {
            try {
                const result = await this.executeToolOnServerInternal(serverId, toolName, input);
                return result;
                
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.error(`❌ External MCP tool ${toolName} failed on attempt ${currentAttempt + 1}: ${lastError.message}`);
                
                // Only attempt correction if we have retries left
                if (currentAttempt < maxAttempts - 1) {
                    
                    const correctionResult = await this.autoCorrectionService.attemptCorrection(
                        agentId as AgentId,
                        channelId as ChannelId,
                        toolName,
                        input,
                        lastError.message,
                        undefined // tool schema not available for external tools
                    );
                    
                    if (correctionResult.corrected && correctionResult.correctedParameters) {
                        input = correctionResult.correctedParameters; // Use corrected params for retry
                    } else {
                        break; // No correction possible, don't retry
                    }
                }
                
                currentAttempt++;
            }
        }
        
        // All attempts exhausted
        throw lastError || new Error(`Failed to execute ${toolName} after ${maxAttempts} attempts`);
    }

    /**
     * Internal method to execute tool once (without retry logic)
     */
    private async executeToolOnServerInternal(
        serverId: string, 
        toolName: string, 
        input: any
    ): Promise<any> {
        const serverData = this.servers.get(serverId);
        if (!serverData) {
            throw new Error(`Server ${serverId} not found`);
        }

        if (!serverData.process || serverData.status.status !== 'running') {
            throw new Error(`Server ${serverId} is not running`);
        }

        // Verify tool exists on server
        const tool = serverData.status.tools.find(t => t.name === toolName);
        if (!tool) {
            throw new Error(`Tool ${toolName} not found on server ${serverId}`);
        }

        return new Promise((resolve, reject) => {
            try {
                const requestId = Math.random().toString(36).substring(7);
                
                // Create MCP tool call request according to the protocol
                const mcpRequest = {
                    jsonrpc: "2.0",
                    id: requestId,
                    method: "tools/call",
                    params: {
                        name: toolName,
                        arguments: input
                    }
                };

                let responseBuffer = '';
                let timeoutId: NodeJS.Timeout;
                let resolved = false;

                const responseHandler = (data: Buffer): void => {
                    if (resolved) return; // Prevent duplicate responses
                    
                    responseBuffer += data.toString();
                    
                    // Try to parse JSON response (MCP responses are line-delimited JSON)
                    const lines = responseBuffer.split('\n');
                    for (let i = 0; i < lines.length - 1; i++) {
                        const line = lines[i].trim();
                        if (line) {
                            try {
                                const response = JSON.parse(line.trim());
                                
                                // Check if this is our response
                                if (response.id === requestId) {
                                    resolved = true;
                                    clearTimeout(timeoutId);
                                    serverData.process!.stdout!.removeListener('data', responseHandler);
                                    
                                    if (response.error) {
                                        const errorMessage = `MCP error: ${response.error.message || response.error}`;
                                        logger.error(`❌ MCP tool call error: ${errorMessage}`);
                                        reject(new Error(errorMessage));
                                    } else {
                                        resolve(response.result);
                                    }
                                    return;
                                }
                            } catch (parseError) {
                                // Ignore JSON parse errors for incomplete lines
                                continue;
                            }
                        }
                    }
                    
                    // Keep the last incomplete line in buffer
                    responseBuffer = lines[lines.length - 1];
                };

                // Set up timeout (30 seconds for tool execution)
                timeoutId = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        serverData.process!.stdout!.removeListener('data', responseHandler);
                        reject(new Error(`Timeout waiting for tool execution response from ${serverId} after 30 seconds`));
                    }
                }, 30000);

                // Listen for response
                if (!serverData.process || !serverData.process.stdout) {
                    reject(new Error(`Server ${serverId} process stdout not available`));
                    return;
                }
                serverData.process.stdout.on('data', responseHandler);

                // Send the request
                if (!serverData.process.stdin) {
                    reject(new Error(`Server ${serverId} process stdin not available`));
                    return;
                }
                const requestJson = JSON.stringify(mcpRequest) + '\n';
                serverData.process.stdin.write(requestJson);
                

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.error(`❌ Failed to execute tool ${toolName} on server ${serverId}: ${errorMessage}`);
                reject(error);
            }
        });
    }
}
