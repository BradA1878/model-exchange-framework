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
 * @documentation https://mxf-dev.github.io/mxf/
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
import { createStrictValidator } from '../../../utils/validation.js';
import { Logger } from '../../../utils/Logger.js';
import { McpEvents } from '../../../events/event-definitions/McpEvents.js';
import { EventBus } from '../../../events/EventBus.js';
import { 
    createExternalMcpServerEventPayload,
    createExternalMcpServerErrorEventPayload,
    createExternalMcpServerHealthStatusEventPayload,
    createExternalMcpServerToolsDiscoveredEventPayload
} from '../../../schemas/EventPayloadSchema.js';
import { AgentId, ChannelId } from '../../../types/ChannelContext.js';
import { AutoCorrectionService } from '../../../services/AutoCorrectionService.js';
import { IToolEventEmitter } from './IToolEventEmitter.js';
import { Events } from '../../../events/EventNames.js';
import { v4 as uuidv4 } from 'uuid';

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
 * A JSON-RPC request that has been written to a server and is awaiting its reply.
 */
interface PendingRequest {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    method: string;
}

/** How long to wait for a reply to a JSON-RPC request, per method. */
const REQUEST_TIMEOUTS_MS = {
    initialize: 30000,
    'tools/list': 15000,
    'tools/call': 30000,
    ping: 5000
} as const;

/** MCP protocol version this client negotiates in the initialize handshake. */
const MCP_PROTOCOL_VERSION = '2024-11-05';

/** Version this client reports to servers. */
const MCP_CLIENT_VERSION = '1.0.0';

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
        /**
         * In-flight JSON-RPC requests, keyed by request id.
         *
         * There is ONE stdout listener per server (installed at spawn) that resolves
         * entries in this map. Previously each call attached its own 'data' listener
         * and re-parsed the whole stream: with N concurrent calls every line was
         * parsed N times, and a listener that timed out was removed only if the
         * timeout path ran — repeated timeouts leaked listeners until Node warned
         * about a possible EventEmitter leak.
         */
        pending: Map<string, PendingRequest>;
        /** Partial line left over from the last stdout chunk. */
        stdoutBuffer: string;
    }> = new Map();

    // Scope tracking for channel/agent-scoped servers
    private serverScopes: Map<string, {
        scope: 'global' | 'channel' | 'agent';
        scopeId?: string;
        connectedAgents: Set<string>;
        keepAliveMinutes?: number;
        keepAliveTimer?: NodeJS.Timeout;
        // Registration context for deferred success emission after tool discovery
        registrationContext?: {
            agentId: string;
            channelId: string;
            originalServerId: string;
            serverName: string;
        };
    }> = new Map();

    private autoCorrectionService: AutoCorrectionService;

    /** Injectable event emitter — decouples from direct EventBus.server dependency.
     *  Server-side: uses default ServerToolEventEmitter (wraps EventBus.server).
     *  Client-side: uses ClientToolEventEmitter (wraps EventBus.client + socketEmit). */
    private toolEventEmitter: IToolEventEmitter | null = null;

    /**
     * @param options.toolEventEmitter - Injectable event emitter for decoupling from EventBus.server
     * @param options.skipServerEventHandlers - Skip setting up EventBus.server listeners (for client-side usage)
     */
    constructor(options?: { toolEventEmitter?: IToolEventEmitter; skipServerEventHandlers?: boolean }) {
        super();
        this.autoCorrectionService = AutoCorrectionService.getInstance();

        if (options?.toolEventEmitter) {
            this.toolEventEmitter = options.toolEventEmitter;
        }

        // Set up event listeners for SDK-initiated server registration
        // Skipped when running client-side (no EventBus.server listeners needed)
        if (!options?.skipServerEventHandlers) {
            this.setupEventHandlers();
        }
    }

    /**
     * Set up EventBus handlers for external server registration from SDK
     */
    private setupEventHandlers(): void {

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

        // Handle channel-scoped server registration requests
        EventBus.server.on(Events.Mcp.CHANNEL_SERVER_REGISTER, async (payload: any) => {
            try {
                logger.info(`[CHANNEL_SERVER_REGISTER] Received registration request: ${JSON.stringify({ agentId: payload.agentId, channelId: payload.channelId, serverId: payload.data?.id })}`);
                

                const channelId = payload.data.channelId || payload.channelId;
                const serverId = `${channelId}:${payload.data.id}`;

                const serverConfig = {
                    id: serverId,
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

                // Track scope BEFORE registration so we can store the registration context
                // Note: connectedAgents starts empty - only actual game agents are counted, not the admin who registers
                this.serverScopes.set(serverId, {
                    scope: 'channel',
                    scopeId: channelId,
                    connectedAgents: new Set(),
                    keepAliveMinutes: payload.data.keepAliveMinutes || 5,
                    // Store registration context for deferred success emission
                    registrationContext: {
                        agentId: payload.agentId,
                        channelId,
                        originalServerId: payload.data.id,
                        serverName: payload.data.name
                    }
                });

                // Register the server (this starts the process and tool discovery)
                // Success event will be emitted after tool discovery completes
                await this.registerServer(serverConfig);
                
                logger.info(`[CHANNEL_SERVER_REGISTER] Server ${serverId} registered, waiting for tool discovery before emitting success`);

            } catch (error) {

                logger.error(`Error registering channel server:`, error);

                // Emit error response
                EventBus.server.emit(McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED,
                    createExternalMcpServerEventPayload(
                        McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED,
                        payload.agentId,
                        payload.data?.channelId || payload.channelId,
                        {
                            serverId: payload.data?.id,
                            scope: 'channel',
                            scopeId: payload.data?.channelId || payload.channelId,
                            success: false,
                            error: error instanceof Error ? error.message : String(error)
                        }
                    )
                );
            }
        });

        // Handle channel server unregistration requests
        EventBus.server.on(Events.Mcp.CHANNEL_SERVER_UNREGISTER, async (payload: any) => {
            try {

                const channelId = payload.data.channelId || payload.channelId;
                const serverId = `${channelId}:${payload.data.serverId}`;

                await this.stopServer(serverId);
                this.servers.delete(serverId);
                this.serverScopes.delete(serverId);

                // Emit success response
                EventBus.server.emit(McpEvents.CHANNEL_SERVER_UNREGISTERED,
                    createExternalMcpServerEventPayload(
                        McpEvents.CHANNEL_SERVER_UNREGISTERED,
                        payload.agentId,
                        channelId,
                        {
                            serverId: payload.data.serverId,
                            scope: 'channel',
                            scopeId: channelId,
                            success: true,
                            message: `Channel server ${payload.data.serverId} unregistered successfully`
                        }
                    )
                );

            } catch (error) {

                logger.error(`Error unregistering channel server:`, error);

                // Emit error response
                EventBus.server.emit(McpEvents.CHANNEL_SERVER_UNREGISTERED,
                    createExternalMcpServerEventPayload(
                        McpEvents.CHANNEL_SERVER_UNREGISTERED,
                        payload.agentId,
                        payload.data?.channelId || payload.channelId,
                        {
                            serverId: payload.data?.serverId,
                            scope: 'channel',
                            scopeId: payload.data?.channelId || payload.channelId,
                            success: false,
                            error: error instanceof Error ? error.message : String(error)
                        }
                    )
                );
            }
        });

    }

    /**
     * Register a new external server configuration
     */
    public async registerServer(config: ExternalServerConfig): Promise<void> {
        logger.info(`[REGISTER_SERVER] Registering server ${config.id}: command="${config.command}", args=${JSON.stringify(config.args)}, autoStart=${config.autoStart}`);
        
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
            status,
            pending: new Map(),
            stdoutBuffer: ''
        });


        // Auto-start if configured
        if (config.autoStart) {
            logger.info(`[REGISTER_SERVER] Auto-starting server ${config.id}`);
            await this.startServer(config.id);
        }
    }

    /**
     * Start an external server process
     */
    public async startServer(serverId: string, agentId?: AgentId, channelId?: ChannelId): Promise<void> {
        logger.info(`[START_SERVER] Starting server ${serverId}`);
        
        const serverData = this.servers.get(serverId);
        if (!serverData) {
            // Server was unregistered (e.g., during cleanup) - log warning and return gracefully
            logger.warn(`⚠️  Cannot start server ${serverId} - server not found (likely unregistered)`);
            return;
        }

        const { config, status } = serverData;

        if (status.status === 'running') {
            logger.info(`[START_SERVER] Server ${serverId} already running`);
            return;
        }


        // Update status
        status.status = 'starting';
        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_SPAWN, serverId, agentId, channelId);

        try {
            // Spawn the process
            const cwd = config.workingDirectory || process.cwd();
            logger.info(`[START_SERVER] Spawning: ${config.command} ${config.args.join(' ')} in ${cwd}`);
            
            // Least privilege: external servers get only what a child process
            // needs to run plus their declared variables — never the full
            // parent environment (which holds JWT/DB/API secrets).
            const declaredEnv = config.environmentVariables ?? {};
            for (const [name, value] of Object.entries(declaredEnv)) {
                if (value === undefined || value === null || value === '') {
                    throw new Error(
                        `External MCP server '${serverId}' requires environment variable ${name} but it resolved empty — set it before starting this server`
                    );
                }
            }
            const childEnv: Record<string, string> = {
                ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
                ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
                ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {}),
                ...declaredEnv
            };
            const childProcess = spawn(config.command, config.args, {
                cwd,
                env: childEnv,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Store process reference — PID is assigned by the OS immediately but the
            // process may not have started yet. The 'spawn' event in setupProcessEventHandlers
            // confirms the process actually started; the 'error' event handles spawn failures.
            serverData.process = childProcess;
            status.pid = childProcess.pid;
            logger.info(`[START_SERVER] Process created with PID ${childProcess.pid}, awaiting spawn confirmation...`);

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
     * Handle agent joining a channel - start channel servers and track connection
     */
    public async onAgentJoinChannel(agentId: string, channelId: string): Promise<void> {
        logger.info(`Agent ${agentId} joining channel ${channelId} - checking for channel servers`);

        // Find all channel-scoped servers for this channel
        for (const [serverId, scopeData] of this.serverScopes.entries()) {
            if (scopeData.scope === 'channel' && scopeData.scopeId === channelId) {
                // Add agent to connected agents
                scopeData.connectedAgents.add(agentId);

                // Clear any pending keepAlive timer
                if (scopeData.keepAliveTimer) {
                    clearTimeout(scopeData.keepAliveTimer);
                    scopeData.keepAliveTimer = undefined;
                }

                // Start server if not already running
                const serverData = this.servers.get(serverId);
                if (serverData && serverData.status.status !== 'running') {
                    logger.info(`Starting channel server ${serverId} for agent ${agentId}`);
                    await this.startServer(serverId);
                }

                logger.info(`Agent ${agentId} connected to channel server ${serverId} (${scopeData.connectedAgents.size} agents)`);
            }
        }
    }

    /**
     * Handle agent leaving a channel - implement reference counting and keepAlive
     */
    public async onAgentLeaveChannel(agentId: string, channelId: string): Promise<void> {
        logger.info(`Agent ${agentId} leaving channel ${channelId} - checking channel servers`);

        // Find all channel-scoped servers for this channel
        for (const [serverId, scopeData] of this.serverScopes.entries()) {
            if (scopeData.scope === 'channel' && scopeData.scopeId === channelId) {
                // Remove agent from connected agents
                scopeData.connectedAgents.delete(agentId);

                logger.info(`Agent ${agentId} disconnected from channel server ${serverId} (${scopeData.connectedAgents.size} agents remaining)`);

                // If no more agents connected, start keepAlive timer
                if (scopeData.connectedAgents.size === 0) {
                    const keepAliveMs = (scopeData.keepAliveMinutes || 5) * 60 * 1000;

                    logger.info(`Last agent left channel server ${serverId}, starting ${scopeData.keepAliveMinutes}min keepAlive timer`);

                    scopeData.keepAliveTimer = setTimeout(async () => {
                        logger.info(`KeepAlive expired for server ${serverId}, stopping server`);
                        try {
                            await this.stopServer(serverId);
                        } catch (error) {
                            logger.error(`Error stopping server ${serverId} after keepAlive:`, error);
                        }
                    }, keepAliveMs);
                }
            }
        }
    }

    /**
     * Get servers by scope
     */
    public getServersByScope(scope: 'global' | 'channel' | 'agent', scopeId?: string): ExternalServerStatus[] {
        const servers: ExternalServerStatus[] = [];

        for (const [serverId, scopeData] of this.serverScopes.entries()) {
            if (scopeData.scope === scope) {
                // For channel/agent scope, match scopeId
                if ((scope === 'channel' || scope === 'agent') && scopeData.scopeId !== scopeId) {
                    continue;
                }

                const serverData = this.servers.get(serverId);
                if (serverData) {
                    servers.push(serverData.status);
                }
            }
        }

        return servers;
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

        // Fail anything still in flight before we kill the process, so callers get
        // a clear error rather than waiting out their own timeouts.
        this.rejectPendingRequests(serverId, 'server is stopping');

        // Terminate process
        if (serverData.process) {
            serverData.process.kill('SIGTERM');

            // Force kill after timeout
            setTimeout(() => {
                if (serverData.process && !serverData.process.killed) {
                    logger.warn(`Force killing server ${config.name}`);
                    serverData.process.kill('SIGKILL');
                }
            }, 5000);
        }

        // Update status
        status.status = 'stopped';
        status.pid = undefined;
        status.tools = [];
        status.initialized = false;
        status.initializing = false;

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
            // The handshake does not survive the process. A restarted server has to
            // perform it again before it can be marked running.
            status.initialized = false;
            status.initializing = false;

            // Anything still waiting on this process will never get a reply.
            this.rejectPendingRequests(
                serverId,
                `server exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`
            );

            // Clear timers
            if (serverData.healthCheckTimer) {
                clearInterval(serverData.healthCheckTimer);
                serverData.healthCheckTimer = undefined;
            }

            // Handle restart if configured
            if (config.restartOnCrash && code !== 0 && status.restartCount < config.maxRestartAttempts) {
                status.restartCount++;
                
                setTimeout(() => {
                    // Check if server still exists before attempting restart
                    // (it may have been unregistered during the delay)
                    if (this.servers.has(serverId)) {
                        this.startServer(serverId);
                    }
                }, 2000); // Wait 2 seconds before restart
            }

            this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STOPPED, serverId);
        });

        // Handle process errors
        process.on('error', (error) => {
            logger.error(`❌ Server ${config.name} process error: ${error.message}`);
            this.handleServerError(serverId, error.message);
        });

        // ONE stdout listener per server. Every JSON-RPC reply arrives here and is
        // routed to its waiting caller by request id.
        if (process.stdout) {
            process.stdout.on('data', (data: Buffer) => {
                this.handleServerOutput(serverId, data.toString());
            });
        }

        // Handle stderr — log non-warning output for debugging spawn failures
        if (process.stderr) {
            process.stderr.on('data', (data) => {
                const errorOutput = data.toString().trim();
                // Filter out harmless Node.js experimental warnings from npm
                if (errorOutput.includes('ExperimentalWarning')) {
                    return; // Ignore npm's CommonJS/ES Module warnings
                }
                if (errorOutput) {
                    logger.debug(`[MCP-STDERR] ${serverId}: ${errorOutput}`);
                }
            });
        }

        // The OS started the process. That is NOT the same as the server being ready
        // to serve MCP: it says nothing about whether the JSON-RPC handshake will
        // succeed. Status stays 'starting' until initializeMcpConnection() completes,
        // so a server that spawns and then fails its handshake never reports 'running'.
        process.on('spawn', () => {
            logger.info(`[SPAWN] Server ${serverId} process spawned; starting MCP handshake`);

            // stdin writes are buffered by the OS, so the handshake can be written
            // immediately — the child reads it when it is ready. The old code slept
            // two seconds here and hoped that was long enough.
            this.initializeMcpConnection(serverId).catch((err) => {
                logger.error(`[MCP] Failed to initialize connection to ${serverId}: ${err.message}`);
                this.handleServerError(serverId, `MCP initialization failed: ${err.message}`);
            });
        });
    }

    /**
     * Route a chunk of a server's stdout to whoever is waiting for it.
     *
     * MCP over stdio is line-delimited JSON. Chunks do not respect line boundaries,
     * so a partial line is carried over to the next chunk.
     */
    private handleServerOutput(serverId: string, chunk: string): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) {
            return;
        }

        serverData.stdoutBuffer += chunk;

        const lines = serverData.stdoutBuffer.split('\n');
        // The last element is either an incomplete line or '' — keep it for next time.
        serverData.stdoutBuffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            let message: any;
            try {
                message = JSON.parse(trimmed);
            } catch {
                // Servers spawned through npx sometimes print non-JSON banners to
                // stdout. Not our reply; not an error.
                logger.debug(`[MCP-STDOUT] ${serverId}: ${trimmed.slice(0, 200)}`);
                continue;
            }

            // A message with no id is a notification from the server, not a reply.
            if (message.id === undefined || message.id === null) {
                continue;
            }

            const requestId = String(message.id);
            const pending = serverData.pending.get(requestId);
            if (!pending) {
                continue;
            }

            clearTimeout(pending.timer);
            serverData.pending.delete(requestId);

            if (message.error) {
                pending.reject(new Error(
                    `MCP error from ${serverId} (${pending.method}): ` +
                    `${message.error.message ?? JSON.stringify(message.error)}`
                ));
            } else {
                pending.resolve(message.result);
            }
        }
    }

    /**
     * Send a JSON-RPC request and wait for its reply.
     *
     * The reply is matched by id in handleServerOutput(). On timeout the pending
     * entry is removed, so nothing accumulates.
     */
    private sendRequest(
        serverId: string,
        method: keyof typeof REQUEST_TIMEOUTS_MS,
        params: Record<string, any> = {}
    ): Promise<any> {
        const serverData = this.servers.get(serverId);
        if (!serverData?.process?.stdin) {
            return Promise.reject(new Error(`Server ${serverId} is not running or has no stdin`));
        }

        const stdin = serverData.process.stdin;
        const requestId = uuidv4();
        const timeoutMs = REQUEST_TIMEOUTS_MS[method];

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                serverData.pending.delete(requestId);
                reject(new Error(
                    `Timed out after ${timeoutMs}ms waiting for ${method} from ${serverId}`
                ));
            }, timeoutMs);

            serverData.pending.set(requestId, { resolve, reject, timer, method });

            const request = {
                jsonrpc: '2.0',
                id: requestId,
                method,
                params
            };

            stdin.write(JSON.stringify(request) + '\n', (writeError) => {
                if (writeError) {
                    clearTimeout(timer);
                    serverData.pending.delete(requestId);
                    reject(new Error(
                        `Failed to write ${method} to ${serverId}: ${writeError.message}`
                    ));
                }
            });
        });
    }

    /**
     * Send a JSON-RPC notification. Notifications have no id and get no reply.
     */
    private sendNotification(
        serverId: string,
        method: string,
        params: Record<string, any> = {}
    ): void {
        const serverData = this.servers.get(serverId);
        if (!serverData?.process?.stdin) {
            throw new Error(`Server ${serverId} is not running or has no stdin`);
        }

        const notification = { jsonrpc: '2.0', method, params };
        serverData.process.stdin.write(JSON.stringify(notification) + '\n');
    }

    /**
     * Fail every in-flight request for a server. Called when the process dies, so
     * callers get an error instead of hanging until their individual timeouts.
     */
    private rejectPendingRequests(serverId: string, reason: string): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) {
            return;
        }

        for (const [requestId, pending] of serverData.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`${pending.method} on ${serverId} aborted: ${reason}`));
            serverData.pending.delete(requestId);
        }

        serverData.stdoutBuffer = '';
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
     * Check that a server is actually answering.
     *
     * This used to be `process && !process.killed` — which only says the OS has not
     * reaped the process. A server that had wedged, deadlocked, or stopped reading
     * stdin stayed "healthy" forever.
     *
     * A real probe means a round trip through the JSON-RPC layer. `tools/list` is
     * the probe: every server we can talk to implements it (we call it at
     * discovery), it takes no arguments, and a reply proves the server is reading
     * stdin, parsing JSON-RPC, and writing stdout.
     */
    private async performHealthCheck(serverId: string): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { status } = serverData;

        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_HEALTH_CHECK, serverId);

        status.lastHealthCheck = Date.now();

        // A process that is gone is unhealthy without needing a round trip.
        if (!serverData.process || serverData.process.killed) {
            this.emitServerHealthStatus(serverId, 'unhealthy');
            return;
        }

        // Only probe a server that finished its handshake — one still starting has
        // not agreed to speak MCP yet.
        if (status.status !== 'running') {
            this.emitServerHealthStatus(serverId, 'unhealthy');
            return;
        }

        try {
            await this.sendRequest(serverId, 'tools/list');
            this.emitServerHealthStatus(serverId, 'healthy');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`Health check failed for ${serverId}: ${message}`);
            this.emitServerHealthStatus(serverId, 'unhealthy');
        }
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
        
        // Emit deferred CHANNEL_SERVER_REGISTERED for channel-scoped servers
        const scopeData = this.serverScopes.get(serverId);
        if (scopeData?.scope === 'channel' && scopeData.registrationContext) {
            const ctx = scopeData.registrationContext;
            
            logger.info(`[CHANNEL_SERVER_REGISTER] Tool discovery complete for ${serverId}, emitting CHANNEL_SERVER_REGISTERED with ${serverData.status.tools.length} tools`);
            
            EventBus.server.emit(McpEvents.CHANNEL_SERVER_REGISTERED,
                createExternalMcpServerEventPayload(
                    McpEvents.CHANNEL_SERVER_REGISTERED,
                    ctx.agentId,
                    ctx.channelId,
                    {
                        serverId: ctx.originalServerId,
                        serverName: ctx.serverName,
                        scope: 'channel',
                        scopeId: ctx.channelId,
                        success: true,
                        tools: serverData.status.tools,
                        message: `Channel server ${ctx.serverName} registered with ${serverData.status.tools.length} tools`
                    }
                )
            );
            
            // Clear registration context after emission
            scopeData.registrationContext = undefined;
        }

    }

    /**
     * Perform the MCP handshake, then discover the server's tools.
     *
     * The handshake is two messages, not one:
     *   1. `initialize` — request/response, negotiates protocol version.
     *   2. `notifications/initialized` — a notification telling the server the
     *      client is ready.
     *
     * The second was never sent. It is required by the MCP spec, and a strict
     * server is entitled to reject `tools/list` from a client that never sent it.
     *
     * The server is only marked 'running' once this completes. Spawning a process
     * says nothing about whether it speaks MCP.
     */
    private async initializeMcpConnection(serverId: string): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData || !serverData.process) {
            throw new Error(`Server ${serverId} not found or not running`);
        }

        if (serverData.status.initialized) {
            logger.warn(`MCP connection already initialized for server ${serverData.config.name}`);
            return;
        }

        const { process, config } = serverData;

        if (!process.stdin || !process.stdout) {
            throw new Error('Process streams not available');
        }

        serverData.status.initializing = true;

        // 1. initialize
        const result = await this.sendRequest(serverId, 'initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
                experimental: {},
                sampling: {}
            },
            clientInfo: {
                name: 'MXF Framework',
                version: MCP_CLIENT_VERSION
            }
        });

        logger.info(
            `[MCP] ${config.name} initialized ` +
            `(server: ${result?.serverInfo?.name ?? 'unknown'} ${result?.serverInfo?.version ?? ''})`
        );

        // 2. notifications/initialized — required by the spec before any other request
        this.sendNotification(serverId, 'notifications/initialized');

        // The handshake succeeded, so the server is genuinely serving MCP now.
        // Discovery below issues tools/list, which requires this status.
        serverData.status.status = 'running';
        serverData.status.initialized = true;
        serverData.status.initializing = false;

        if (serverData.startupTimer) {
            clearTimeout(serverData.startupTimer);
            serverData.startupTimer = undefined;
        }

        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STARTED, serverId);

        // Now that the connection is live, find out what the server offers.
        await this.discoverServerTools(serverId);
    }

    /**
     * Ask a server what tools it has.
     */
    private async discoverRealToolsFromServer(
        serverId: string
    ): Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }>> {
        const serverData = this.servers.get(serverId);
        if (!serverData || !serverData.process) {
            throw new Error(`Server ${serverId} not found or not running`);
        }

        const { config } = serverData;

        const result = await this.sendRequest(serverId, 'tools/list');

        if (!result?.tools) {
            logger.warn(`No tools in the tools/list response from ${config.name}`);
            return [];
        }

        return result.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description || `Tool from ${config.name}`,
            inputSchema: tool.inputSchema || { type: 'object', properties: {}, required: [] }
        }));
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

        // Determine scope from server ID
        const scopeData = this.serverScopes.get(serverId);
        const scope = scopeData?.scope || 'global';
        const scopeId = scopeData?.scopeId;

        // Use injectable emitter if available, otherwise direct EventBus.server
        if (this.toolEventEmitter) {
            this.toolEventEmitter.emitServerEvent(eventType, serverId, config.name, scope, scopeId, defaultAgentId, defaultChannelId);
        } else {
            EventBus.server.emit(eventType, createExternalMcpServerEventPayload(
                eventType,
                defaultAgentId,
                defaultChannelId,
                {
                    serverId: serverId,
                    serverName: config.name,
                    scope: scope,
                    scopeId: scopeId,
                    status: 'running'
                }
            ));
        }
    }

    /**
     * Emit server error event with detailed error information
     */
    private emitServerErrorEvent(serverId: string, error: string, agentId?: AgentId, channelId?: ChannelId): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const defaultAgentId = agentId || 'SYSTEM' as AgentId;
        const defaultChannelId = channelId || 'SYSTEM' as ChannelId;

        if (this.toolEventEmitter) {
            this.toolEventEmitter.emitServerError(serverId, error, defaultAgentId, defaultChannelId);
        } else {
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
    }

    /**
     * Emit server health status event
     */
    private emitServerHealthStatus(serverId: string, healthStatus: string): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config } = serverData;

        if (this.toolEventEmitter) {
            this.toolEventEmitter.emitHealthStatus(serverId, config.name, config.version, healthStatus, config.description);
        } else {
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
    }

    /**
     * Emit tools discovered event
     */
    private emitServerToolsDiscovered(serverId: string, tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }>): void {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { config } = serverData;

        if (this.toolEventEmitter) {
            this.toolEventEmitter.emitToolsDiscovered(serverId, config.name, config.version, tools);
            return;
        }

        EventBus.server.emit(McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED, createExternalMcpServerToolsDiscoveredEventPayload(
            McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED,
            'SYSTEM' as AgentId,
            'SYSTEM' as ChannelId,
            {
                serverId,
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
        agentId: string,
        channelId: string
    ): Promise<any> {
        // Identity is required. These parameters used to default to 'system' and
        // 'default', which quietly defeated the registry's own rule that every tool
        // execution carry a real agentId and channelId — and made auto-correction
        // learn against a fake agent.
        if (typeof agentId !== 'string' || agentId.length === 0) {
            throw new Error(
                `executeToolOnServer requires an agentId (tool "${toolName}" on server "${serverId}"). ` +
                `External tool calls must be attributable to an agent.`
            );
        }
        if (typeof channelId !== 'string' || channelId.length === 0) {
            throw new Error(
                `executeToolOnServer requires a channelId (tool "${toolName}" on server "${serverId}"). ` +
                `External tool calls must be attributable to a channel.`
            );
        }

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
     * Execute a tool once, without the retry/auto-correction wrapper.
     *
     * The reply is matched by request id through the server's single stdout
     * listener — see sendRequest() and handleServerOutput().
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

        // Verify the server actually offers this tool before calling it.
        const tool = serverData.status.tools.find(t => t.name === toolName);
        if (!tool) {
            throw new Error(
                `Tool ${toolName} not found on server ${serverId}. ` +
                `Available: ${serverData.status.tools.map(t => t.name).join(', ') || 'none'}`
            );
        }

        return this.sendRequest(serverId, 'tools/call', {
            name: toolName,
            arguments: input
        });
    }
}
