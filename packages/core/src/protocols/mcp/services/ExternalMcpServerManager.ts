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
import { assertUnsafeStdioMcpEnabled, isStdioMcpTransport } from '../security/ExternalMcpRegistrationPolicy.js';

// Create logger and validator instances
const logger = new Logger('info', 'ExternalMcpServerManager', 'server');
const validator = createStrictValidator('ExternalMcpServerManager');

interface ExternalMcpRegistrationRequestData extends Partial<ExternalServerConfig> {
    id: string;
    name: string;
    channelId?: string;
    keepAliveMinutes?: number;
}

interface ExternalMcpUnregistrationRequestData {
    serverId: string;
    channelId?: string;
}

interface ExternalMcpLifecycleRequestPayload<TData> {
    agentId: AgentId;
    channelId: ChannelId;
    data: TData;
}

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
    /** Transport requested by a remote registration. Omitted means stdio. */
    transport?: 'stdio' | 'http';
    /** Endpoint for an HTTP transport registration. */
    url?: string;
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
    status: 'stopped' | 'starting' | 'running' | 'error' | 'restarting' | 'stopping';
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
    /** Authoritative visibility scope assigned when the server was registered. */
    scope: 'global' | 'channel' | 'agent';
    /** Channel or agent identifier for non-global scopes. */
    scopeId?: string;
    /** Set only for filesystem servers registered through the trusted operator path. */
    operatorAgentFilesystem?: boolean;
}

/** Scope is assigned by manager entry points, never by caller configuration. */
interface ServerScope {
    scope: 'global' | 'channel' | 'agent';
    scopeId?: string;
    connectedAgents: Set<string>;
    keepAliveMinutes?: number;
    keepAliveTimer?: NodeJS.Timeout;
    registrationContext?: {
        agentId: string;
        channelId: string;
        originalServerId: string;
        serverName: string;
    };
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

/** Delay before restarting a crashed server. */
const DEFAULT_RESTART_DELAY_MS = 2000;

/**
 * Consecutive failed health probes after which a running server is declared
 * dead and restarted. One failure can be a slow reply; two in a row on a
 * connection that answers in milliseconds when healthy means the connection
 * is gone.
 */
const HEALTH_FAILURES_BEFORE_RESTART = 2;

/** A caller waiting for a starting server to finish its handshake and discovery. */
interface ReadyWaiter {
    resolve: () => void;
    reject: (error: Error) => void;
}

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
        /**
         * Set by stopServer() before it kills the process, so the exit handler
         * can tell an intentional stop from a crash. Retained until the next
         * explicit start so delayed crash-restart callbacks also respect stop.
         */
        expectedExit?: boolean;
        /** SIGKILL escalation timer set by stopServer; cleared when the process exits. */
        forceKillTimer?: NodeJS.Timeout;
        /** One stop operation owns the current child until it has exited. */
        stopPromise?: Promise<void>;
        /** Unregistration must not admit a replacement while awaiting child exit. */
        removing?: boolean;
        /** Internal provenance, deliberately separate from client-supplied config. */
        operatorAgentFilesystemOwner?: string;
        /** Callers awaiting handshake + tool discovery of a starting server. */
        readyWaiters?: ReadyWaiter[];
        /** Consecutive failed health probes; reset on any successful probe. */
        consecutiveHealthFailures?: number;
    }> = new Map();

    // Scope tracking for channel/agent-scoped servers
    private serverScopes: Map<string, ServerScope> = new Map();

    /**
     * Channel ids which crossed their terminal deletion boundary in this
     * process. Channel ids are reserved in persistence, so this tombstone never
     * needs to be removed and closes register/delete races in both directions.
     */
    private retiredChannelIds = new Set<string>();

    private autoCorrectionService: AutoCorrectionService;

    /** Injectable event emitter — decouples from direct EventBus.server dependency.
     *  Server-side: uses default ServerToolEventEmitter (wraps EventBus.server).
     *  Client-side: uses ClientToolEventEmitter (wraps EventBus.client + socketEmit). */
    private toolEventEmitter: IToolEventEmitter | null = null;

    /** EventBus subscriptions owned by this manager instance. */
    private eventSubscriptions: Array<{ unsubscribe: () => void }> = [];

    /** Shutdown closes admission permanently and reports the same owned result to every caller. */
    private shutdownPromise?: Promise<void>;

    /** Delay before restarting a crashed server. Overridable for tests. */
    private restartDelayMs: number = DEFAULT_RESTART_DELAY_MS;

    /** Per-method JSON-RPC reply timeouts. Overridable for tests and tuning. */
    private requestTimeouts: Record<keyof typeof REQUEST_TIMEOUTS_MS, number> = { ...REQUEST_TIMEOUTS_MS };

    /**
     * @param options.toolEventEmitter - Injectable event emitter for decoupling from EventBus.server
     * @param options.skipServerEventHandlers - Skip setting up EventBus.server listeners (for client-side usage)
     * @param options.restartDelayMs - Delay before restarting a crashed server (default 2000)
     * @param options.requestTimeoutsMs - Per-method JSON-RPC reply timeout overrides
     */
    constructor(options?: {
        toolEventEmitter?: IToolEventEmitter;
        skipServerEventHandlers?: boolean;
        restartDelayMs?: number;
        requestTimeoutsMs?: Partial<Record<keyof typeof REQUEST_TIMEOUTS_MS, number>>;
    }) {
        super();
        this.autoCorrectionService = AutoCorrectionService.getInstance();

        if (options?.toolEventEmitter) {
            this.toolEventEmitter = options.toolEventEmitter;
        }
        if (options?.restartDelayMs !== undefined) {
            this.restartDelayMs = options.restartDelayMs;
        }
        if (options?.requestTimeoutsMs) {
            this.requestTimeouts = { ...this.requestTimeouts, ...options.requestTimeoutsMs };
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
        this.eventSubscriptions.push(EventBus.server.on(Events.Mcp.EXTERNAL_SERVER_REGISTER, async (
            payload: ExternalMcpLifecycleRequestPayload<ExternalMcpRegistrationRequestData>
        ) => {
            try {

                // EventBus registrations originate outside this manager (normally
                // from a socket). They are caller-controlled and stdio means host
                // process execution, so require the operator's explicit opt-in.
                assertUnsafeStdioMcpEnabled(payload.data?.transport);

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
        }));

        // Handle external server unregistration requests from SDK
        this.eventSubscriptions.push(EventBus.server.on(Events.Mcp.EXTERNAL_SERVER_UNREGISTER, async (
            payload: ExternalMcpLifecycleRequestPayload<ExternalMcpUnregistrationRequestData>
        ) => {
            try {

                const serverId = payload.data.serverId;
                this.assertUnreservedServerId(serverId);
                await this.unregisterServer(serverId);

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
                // Interpolate the message: passing the raw error as a second console
                // argument makes Bun print a source-code excerpt instead of the message.
                logger.error(`Error unregistering external server: ${error instanceof Error ? error.message : String(error)}`);

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
        }));

        // Handle channel-scoped server registration requests
        this.eventSubscriptions.push(EventBus.server.on(Events.Mcp.CHANNEL_SERVER_REGISTER, async (
            payload: ExternalMcpLifecycleRequestPayload<ExternalMcpRegistrationRequestData>
        ) => {
            try {
                // Channel membership is not permission to execute a host command.
                // The HTTP/socket entry point must also establish administrator
                // authority; this is the defense-in-depth feature gate.
                assertUnsafeStdioMcpEnabled(payload.data?.transport);
                if (!isStdioMcpTransport(payload.data?.transport)) {
                    throw new Error('HTTP transport registration is not implemented by ExternalMcpServerManager');
                }
                logger.info(`[CHANNEL_SERVER_REGISTER] Received registration request: ${JSON.stringify({ agentId: payload.agentId, channelId: payload.channelId, serverId: payload.data?.id })}`);
                

                const channelId = payload.data.channelId || payload.channelId;

                await this.registerChannelServer(
                    channelId,
                    {
                        id: payload.data.id,
                        name: payload.data.name,
                        version: payload.data.version || '1.0.0',
                        command: payload.data.command || '',
                        args: payload.data.args || [],
                        autoStart: payload.data.autoStart !== false,
                        restartOnCrash: payload.data.restartOnCrash !== false,
                        maxRestartAttempts: payload.data.maxRestartAttempts || 3,
                        healthCheckInterval: payload.data.healthCheckInterval || 30000,
                        startupTimeout: payload.data.startupTimeout || 10000,
                        environmentVariables: payload.data.environmentVariables || {},
                        keepAliveMinutes: payload.data.keepAliveMinutes
                    },
                    // Registration context for deferred success emission after tool discovery
                    {
                        agentId: payload.agentId,
                        channelId,
                        originalServerId: payload.data.id,
                        serverName: payload.data.name
                    }
                );

            } catch (error) {

                logger.error(`Error registering channel server: ${error instanceof Error ? error.message : String(error)}`);

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
        }));

        // Handle channel server unregistration requests
        this.eventSubscriptions.push(EventBus.server.on(Events.Mcp.CHANNEL_SERVER_UNREGISTER, async (
            payload: ExternalMcpLifecycleRequestPayload<ExternalMcpUnregistrationRequestData>
        ) => {
            try {

                const channelId = payload.data.channelId || payload.channelId;

                await this.unregisterChannelServer(channelId, payload.data.serverId);

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

                logger.error(`Error unregistering channel server: ${error instanceof Error ? error.message : String(error)}`);

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
        }));

    }

    /** Register a global server without operator filesystem privileges. */
    public async registerServer(config: ExternalServerConfig): Promise<void> {
        this.assertUnreservedServerId(config.id);
        await this.registerScopedServer(config, { scope: 'global', connectedAgents: new Set() });
    }

    /**
     * Register an operator-configured filesystem server for one agent. The
     * caller validates its filesystem roots before entering this trusted path.
     */
    public async registerAgentFilesystemServer(config: ExternalServerConfig, agentId: string): Promise<void> {
        validator.assertIsNonEmptyString(agentId, 'agentId must be a non-empty string');
        if (config.id !== `filesystem:${agentId}`) {
            throw new Error(`Agent filesystem server ID must be filesystem:${agentId}`);
        }
        await this.registerScopedServer(config, {
            scope: 'agent',
            scopeId: agentId,
            connectedAgents: new Set(),
            keepAliveMinutes: 0
        }, agentId);
    }

    /** Check private provenance and the exact scope, rather than trusting a name or config field. */
    public isOperatorAgentFilesystem(serverId: string, agentId: string): boolean {
        const scope = this.serverScopes.get(serverId);
        return this.servers.get(serverId)?.operatorAgentFilesystemOwner === agentId &&
            scope?.scope === 'agent' && scope.scopeId === agentId;
    }

    private assertUnreservedServerId(serverId: string): void {
        validator.assertIsNonEmptyString(serverId, 'Server ID must be a non-empty string');
        if (serverId.startsWith('filesystem:')) {
            throw new Error(`Server ID ${serverId} is reserved for operator agent filesystem servers`);
        }
    }

    /** Reserve the record and scope together before startup can yield or emit an event. */
    private async registerScopedServer(
        config: ExternalServerConfig,
        scope: ServerScope,
        operatorAgentFilesystemOwner?: string
    ): Promise<void> {
        if (this.shutdownPromise) {
            throw new Error('External MCP server manager is shutting down; registration is closed');
        }
        // Only stdio is implemented; an HTTP label must never fall through to spawn.
        if (!isStdioMcpTransport(config.transport)) {
            throw new Error('HTTP transport registration is not implemented by ExternalMcpServerManager');
        }
        validator.assertIsNonEmptyString(config.id, 'Server ID must be a non-empty string');
        validator.assertIsNonEmptyString(config.name, 'Server name must be a non-empty string');
        validator.assertIsNonEmptyString(config.command, 'Server command must be a non-empty string');
        validator.assertIsArray(config.args, 'Server args must be an array');
        if (this.servers.has(config.id)) {
            throw new Error(`Server with ID ${config.id} is already registered`);
        }

        // An orphaned scope can retain actual connected agents, but a failed
        // duplicate registration must leave the existing record and timer alone.
        const existingScope = this.serverScopes.get(config.id);
        if (existingScope?.keepAliveTimer) clearTimeout(existingScope.keepAliveTimer);
        if (existingScope?.scope === scope.scope && existingScope.scopeId === scope.scopeId) {
            scope.connectedAgents = existingScope.connectedAgents;
        }
        this.servers.set(config.id, {
            config,
            status: {
                id: config.id,
                name: config.name,
                status: 'stopped',
                restartCount: 0,
                tools: []
            },
            pending: new Map(),
            stdoutBuffer: '',
            operatorAgentFilesystemOwner
        });
        this.serverScopes.set(config.id, scope);

        logger.info(`[REGISTER_SERVER] Registering server ${config.id}: command="${config.command}", args=${JSON.stringify(config.args)}, autoStart=${config.autoStart}`);
        if (config.autoStart) await this.startServer(config.id);
    }

    /** Register a channel server; autoStart resolves only after successful tool discovery. */
    public async registerChannelServer(
        channelId: string,
        config: Omit<ExternalServerConfig, 'id'> & { id: string; keepAliveMinutes?: number },
        registrationContext?: ServerScope['registrationContext']
    ): Promise<void> {
        validator.assertIsNonEmptyString(channelId, 'channelId must be a non-empty string');
        this.assertUnreservedServerId(config.id);
        const serverId = `${channelId}:${config.id}`;
        this.assertUnreservedServerId(serverId);
        if (this.retiredChannelIds.has(channelId)) {
            throw new Error(`Channel ${channelId} is deleted; MCP servers cannot be registered`);
        }

        const { keepAliveMinutes, ...serverConfig } = config;
        await this.registerScopedServer({ ...serverConfig, id: serverId }, {
            scope: 'channel',
            scopeId: channelId,
            connectedAgents: new Set(),
            keepAliveMinutes: keepAliveMinutes ?? 5,
            registrationContext
        });

        // Deletion can win while startup is awaiting the handshake/discovery.
        if (this.retiredChannelIds.has(channelId)) {
            await this.removeServer(serverId, 'registration raced channel deletion');
            throw new Error(`Channel ${channelId} was deleted during MCP server registration`);
        }
    }

    /**
     * Unregister a channel-scoped server: stop the process and remove both the
     * server record and the scope tracking, including any keepAlive timer.
     *
     * Idempotent: unregistering a server that is partially or fully gone cleans
     * up whatever remains and resolves. Production showed the half-removed
     * state — record deleted, scope alive — and an unregister that throws
     * "not found" against it leaves the zombie in place forever.
     */
    public async unregisterChannelServer(channelId: string, serverId: string): Promise<void> {
        validator.assertIsNonEmptyString(channelId, 'channelId must be a non-empty string');
        validator.assertIsNonEmptyString(serverId, 'serverId must be a non-empty string');
        const fullServerId = `${channelId}:${serverId}`;
        const scope = this.serverScopes.get(fullServerId);
        if (scope && (scope.scope !== 'channel' || scope.scopeId !== channelId)) {
            throw new Error(`Server ${fullServerId} does not belong to channel ${channelId}`);
        }
        if (!scope && this.servers.has(fullServerId)) {
            throw new Error(`Server ${fullServerId} has no channel scope`);
        }
        await this.removeServer(fullServerId, 'channel server unregistration');
    }

    /**
     * Permanently retire a channel's MCP runtime in this process.
     *
     * The tombstone is installed before process cleanup, which makes concurrent
     * registrations fail both before and after their asynchronous startup.
     * Every known channel scope is removed, including orphaned scope entries.
     * Other scopes may share an ID prefix and are not owned by this channel.
     */
    public async retireChannel(channelId: string): Promise<void> {
        validator.assertIsNonEmptyString(channelId, 'channelId must be a non-empty string');
        this.retiredChannelIds.add(channelId);

        const serverIds = new Set<string>();
        for (const [serverId, scopeData] of this.serverScopes.entries()) {
            if (scopeData.scope === 'channel' && scopeData.scopeId === channelId) {
                serverIds.add(serverId);
            }
        }

        const results = await Promise.allSettled(
            Array.from(serverIds, serverId => (
                this.removeServer(serverId, 'channel deletion')
            ))
        );
        const failures = results.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
        );
        if (failures.length > 0) {
            throw new Error(
                `Failed to retire ${failures.length} MCP server(s) for channel ${channelId}`
            );
        }
    }

    /**
     * Unregister a server by its full id (global servers, and the SDK-facing
     * EXTERNAL_SERVER_UNREGISTER path). Also removes scope tracking — this
     * path used to delete only the server record, which was exactly the
     * zombie state observed in production: agents kept "joining" a scope
     * whose server no longer existed.
     */
    public async unregisterServer(serverId: string): Promise<void> {
        validator.assertIsNonEmptyString(serverId, 'serverId must be a non-empty string');
        await this.removeServer(serverId, 'server unregistration');
    }

    /**
     * Stop a server (if running) and remove every trace of it: server record,
     * scope entry, keepAlive timer. Never throws for a missing record — it
     * removes what exists and says what it did. A failed stop retains ownership
     * and propagates the failure instead of forgetting a potentially live child.
     */
    private async removeServer(serverId: string, reason: string): Promise<void> {
        const serverData = this.servers.get(serverId);
        const scopeData = this.serverScopes.get(serverId);

        if (!serverData && !scopeData) {
            logger.warn(`Nothing to unregister for ${serverId} (${reason}) — no record, no scope`);
            return;
        }

        if (scopeData?.keepAliveTimer) {
            clearTimeout(scopeData.keepAliveTimer);
            scopeData.keepAliveTimer = undefined;
        }

        if (serverData) {
            serverData.removing = true;
            try {
                await this.stopServer(serverId, undefined, undefined, reason);
            } catch (error) {
                logger.error(
                    `Error stopping ${serverId} during ${reason}: ` +
                    `${error instanceof Error ? error.message : String(error)}; retaining its record and scope`
                );
                throw error;
            }
        } else {
            logger.warn(
                `Unregistering ${serverId} (${reason}): server record was already gone, ` +
                `removing the orphaned scope entry`
            );
        }

        this.servers.delete(serverId);
        this.serverScopes.delete(serverId);
        logger.info(`Unregistered server ${serverId} (${reason})`);
    }

    /**
     * Remove a server after its owned child exited and exhausted its restart
     * budget. The exit handler is the sole caller; no live process is discarded.
     */
    private removeServerAfterFailure(serverId: string, reason: string): void {
        const serverData = this.servers.get(serverId);
        if (serverData) {
            if (serverData.healthCheckTimer) {
                clearInterval(serverData.healthCheckTimer);
                serverData.healthCheckTimer = undefined;
            }
            if (serverData.startupTimer) {
                clearTimeout(serverData.startupTimer);
                serverData.startupTimer = undefined;
            }
            this.rejectPendingRequests(serverId, reason);
            this.settleReadyWaiters(serverId, new Error(reason));
        }

        const scopeData = this.serverScopes.get(serverId);
        if (scopeData?.keepAliveTimer) {
            clearTimeout(scopeData.keepAliveTimer);
        }

        this.servers.delete(serverId);
        this.serverScopes.delete(serverId);

        logger.error(
            `Server ${serverId} unregistered: ${reason}. ` +
            `Its tools are removed from the registry; re-register the server to restore them.`
        );

        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STOPPED, serverId);
    }

    /**
     * Settle every caller waiting for a server to become ready.
     */
    private settleReadyWaiters(serverId: string, error?: Error): void {
        const serverData = this.servers.get(serverId);
        if (!serverData?.readyWaiters?.length) {
            return;
        }
        const waiters = serverData.readyWaiters;
        serverData.readyWaiters = [];
        for (const waiter of waiters) {
            if (error) {
                waiter.reject(error);
            } else {
                waiter.resolve();
            }
        }
    }

    /**
     * Start an external server process.
     *
     * Resolves once the MCP handshake AND tool discovery have completed — a
     * resolved startServer() means the server's tools are in the registry.
     * It used to resolve right after spawn, which let callers (agent join,
     * restart) proceed against a server that had not finished — or would
     * never finish — its handshake.
     */
    public async startServer(serverId: string, agentId?: AgentId, channelId?: ChannelId): Promise<void> {
        if (this.shutdownPromise) {
            throw new Error('External MCP server manager is shutting down; process starts are closed');
        }
        logger.info(`[START_SERVER] Starting server ${serverId}`);

        const serverData = this.servers.get(serverId);
        if (!serverData) {
            // Server was unregistered (e.g., during cleanup) - log warning and return gracefully
            logger.warn(`⚠️  Cannot start server ${serverId} - server not found (likely unregistered)`);
            return;
        }

        const { config, status } = serverData;

        if (serverData.removing) {
            throw new Error(`Server ${serverId} is being unregistered`);
        }
        while (serverData.stopPromise) {
            await serverData.stopPromise;
            if (this.shutdownPromise) {
                throw new Error('External MCP server manager is shutting down; process starts are closed');
            }
            // Unregistration can win while this caller waits for the old child.
            if (this.servers.get(serverId) !== serverData || serverData.removing) {
                throw new Error(`Server ${serverId} was unregistered while waiting for it to stop`);
            }
        }

        if (status.status === 'running') {
            logger.info(`[START_SERVER] Server ${serverId} already running`);
            return;
        }

        if (status.status === 'starting') {
            // Another caller is already starting this server — wait for that
            // startup instead of spawning a second process.
            logger.info(`[START_SERVER] Server ${serverId} already starting, awaiting readiness`);
            await new Promise<void>((resolve, reject) => {
                serverData.readyWaiters = serverData.readyWaiters ?? [];
                serverData.readyWaiters.push({ resolve, reject });
            });
            return;
        }

        // A failed handshake or discovery can leave its child alive. Keep that
        // process owned until stop succeeds before admitting a replacement.
        if (status.status === 'error' && serverData.process &&
            serverData.process.exitCode === null && serverData.process.signalCode === null) {
            await this.stopServer(serverId, agentId, channelId, 'restart after startup failure');
            if (this.shutdownPromise || this.servers.get(serverId) !== serverData || serverData.removing) {
                throw new Error(`Server ${serverId} no longer accepts process starts`);
            }
            await this.startServer(serverId, agentId, channelId);
            return;
        }

        // Update status
        status.status = 'starting';
        serverData.expectedExit = false;
        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_SPAWN, serverId, agentId, channelId);
        if (this.shutdownPromise || this.servers.get(serverId) !== serverData || serverData.expectedExit || serverData.removing) {
            throw new Error(`Server ${serverId} was stopped before its process could start`);
        }

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
                if (this.isCurrentProcessActive(serverId, childProcess) && status.status === 'starting') {
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
            throw error instanceof Error ? error : new Error(errorMessage);
        }

        // Wait for the handshake and tool discovery. Settled by
        // initializeMcpConnection() on success, and by handleServerError()
        // or the exit handler on failure — those already report the cause,
        // so a rejection here propagates without being re-handled.
        await new Promise<void>((resolve, reject) => {
            serverData.readyWaiters = serverData.readyWaiters ?? [];
            serverData.readyWaiters.push({ resolve, reject });
        });
    }

    /**
     * Handle agent joining a channel — verify each channel server is actually
     * alive before counting the agent as connected.
     *
     * This used to be a blind reference-count bump: a missing server record was
     * silently skipped and a dead process was never probed, so agents "joined"
     * servers that could not serve a single tool call, and the only downstream
     * signal was a NOT FOUND warning when their allowlist resolved.
     */
    public async onAgentJoinChannel(agentId: string, channelId: string): Promise<void> {
        logger.info(`Agent ${agentId} joining channel ${channelId} - checking for channel servers`);

        // Find all channel-scoped servers for this channel
        for (const [serverId, scopeData] of this.serverScopes.entries()) {
            if (scopeData.scope !== 'channel' || scopeData.scopeId !== channelId) {
                continue;
            }

            const serverData = this.servers.get(serverId);
            if (!serverData) {
                // The production zombie state: a scope entry whose server record is
                // gone. There is no config left to restart from, so remove the
                // orphan loudly instead of pretending the agent connected.
                logger.error(
                    `Agent ${agentId} tried to join channel server ${serverId}, but its server record is gone ` +
                    `(scope entry was orphaned). Removing the orphaned scope — the server must be re-registered.`
                );
                if (scopeData.keepAliveTimer) {
                    clearTimeout(scopeData.keepAliveTimer);
                }
                this.serverScopes.delete(serverId);
                continue;
            }

            try {
                if (serverData.status.status !== 'running') {
                    logger.info(`Starting channel server ${serverId} for agent ${agentId} (status: ${serverData.status.status})`);
                    await this.startServer(serverId);
                } else {
                    // Status says running — prove it. A live entry with a dead child
                    // (or a wedged MCP connection) must trigger recovery at join
                    // time, not a silent ref-count bump.
                    const alive = serverData.process && !serverData.process.killed && serverData.process.exitCode === null;
                    if (!alive) {
                        logger.warn(`Channel server ${serverId} has no live process at agent join — restarting`);
                        await this.restartServer(serverId);
                    } else {
                        try {
                            await this.sendRequest(serverId, 'tools/list');
                        } catch (probeError) {
                            logger.warn(
                                `Channel server ${serverId} did not answer the liveness probe at agent join ` +
                                `(${probeError instanceof Error ? probeError.message : String(probeError)}) — restarting`
                            );
                            await this.restartServer(serverId);
                        }
                    }
                }
            } catch (error) {
                logger.error(
                    `Channel server ${serverId} could not be made available for agent ${agentId}: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
                continue;
            }

            // Only a server that is verifiably up counts the agent as connected
            scopeData.connectedAgents.add(agentId);

            // Clear any pending keepAlive timer
            if (scopeData.keepAliveTimer) {
                clearTimeout(scopeData.keepAliveTimer);
                scopeData.keepAliveTimer = undefined;
            }

            logger.info(`Agent ${agentId} connected to channel server ${serverId} (${scopeData.connectedAgents.size} agents)`);
        }
    }

    /**
     * Handle agent leaving a channel - implement reference counting and keepAlive
     */
    public async onAgentLeaveChannel(agentId: string, channelId: string): Promise<void> {
        // Shutdown clears these timers and must not admit another keepalive.
        if (this.shutdownPromise) return;
        logger.info(`Agent ${agentId} leaving channel ${channelId} - checking channel servers`);

        // Find all channel-scoped servers for this channel
        for (const [serverId, scopeData] of this.serverScopes.entries()) {
            if (scopeData.scope === 'channel' && scopeData.scopeId === channelId) {
                // Remove agent from connected agents
                scopeData.connectedAgents.delete(agentId);

                logger.info(`Agent ${agentId} disconnected from channel server ${serverId} (${scopeData.connectedAgents.size} agents remaining)`);

                // If no more agents connected, start keepAlive timer
                if (scopeData.connectedAgents.size === 0) {
                    const keepAliveMs = (scopeData.keepAliveMinutes ?? 5) * 60 * 1000;
                    if (scopeData.keepAliveTimer) {
                        clearTimeout(scopeData.keepAliveTimer);
                        scopeData.keepAliveTimer = undefined;
                    }
                    if (keepAliveMs === 0) {
                        await this.stopServer(serverId, undefined, undefined, 'last agent left');
                        continue;
                    }

                    logger.info(`Last agent left channel server ${serverId}, starting ${scopeData.keepAliveMinutes}min keepAlive timer`);

                    scopeData.keepAliveTimer = setTimeout(async () => {
                        scopeData.keepAliveTimer = undefined;
                        if (!this.servers.has(serverId)) {
                            logger.warn(`KeepAlive expired for ${serverId}, but its server record is already gone — removing the orphaned scope`);
                            this.serverScopes.delete(serverId);
                            return;
                        }
                        logger.info(`KeepAlive expired for server ${serverId}, stopping server`);
                        try {
                            await this.stopServer(serverId, undefined, undefined, 'keepAlive expired');
                        } catch (error) {
                            logger.error(`Error stopping server ${serverId} after keepAlive: ${error instanceof Error ? error.message : String(error)}`);
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

        for (const [serverId, serverData] of this.servers.entries()) {
            // Servers registered through the original global registration path
            // predate serverScopes and are explicitly global, matching the tool
            // snapshot contract in getAllExternalTools().
            const scopeData = this.serverScopes.get(serverId);
            const actualScope = scopeData?.scope ?? 'global';
            if (actualScope === scope) {
                // For channel/agent scope, match scopeId
                if ((scope === 'channel' || scope === 'agent') && scopeData?.scopeId !== scopeId) {
                    continue;
                }

                servers.push(serverData.status);
            }
        }

        return servers.sort((a, b) => a.id.localeCompare(b.id));
    }

    /**
     * Stop an external server process.
     *
     * An intentional stop: the exit handler will see `expectedExit` and will
     * neither log the exit as a crash nor restart the process.
     * Removes tools and rejects pending work immediately, then resolves only
     * after the owned child exits. A record without a live child settles immediately.
     */
    public async stopServer(serverId: string, agentId?: AgentId, channelId?: ChannelId, reason?: string): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData) {
            throw new Error(`Server ${serverId} not found`);
        }

        if (serverData.stopPromise) {
            return serverData.stopPromise;
        }

        const { config, status } = serverData;
        const stoppingProcess = serverData.process;
        if (status.status === 'stopped' && (!stoppingProcess || stoppingProcess.pid === undefined ||
            stoppingProcess.exitCode !== null || stoppingProcess.signalCode !== null)) {
            // An unexpected exit may already have scheduled a restart. An
            // explicit stop cancels that intention even though the child is gone.
            serverData.expectedExit = true;
            return;
        }
        // Claim ownership before notifying listeners: a reentrant stop must join
        // this operation, and a start must wait until this child is gone.
        let resolveStop!: () => void;
        let rejectStop!: (error: unknown) => void;
        const stopPromise = new Promise<void>((resolve, reject) => {
            resolveStop = resolve;
            rejectStop = reject;
        });
        serverData.stopPromise = stopPromise;
        serverData.expectedExit = true;
        const droppedTools = status.tools.length;
        status.status = 'stopping';
        status.tools = [];
        status.initialized = false;
        status.initializing = false;

        try {
            logger.info(
                `Stopping server ${serverId} (${reason ?? 'no reason given'})` +
                (droppedTools > 0 ? ` — removing its ${droppedTools} tool(s) from the registry` : '')
            );

            if (serverData.healthCheckTimer) {
                clearInterval(serverData.healthCheckTimer);
                serverData.healthCheckTimer = undefined;
            }
            if (serverData.startupTimer) {
                clearTimeout(serverData.startupTimer);
                serverData.startupTimer = undefined;
            }

            // Fail requests immediately; waiting for process exit must not hold
            // their callers or startup waiters open.
            this.rejectPendingRequests(serverId, 'server is stopping');
            this.settleReadyWaiters(serverId, new Error(`Server ${serverId} was stopped (${reason ?? 'no reason given'})`));
            this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STOP, serverId, agentId, channelId);

            if (stoppingProcess?.pid !== undefined &&
                stoppingProcess.exitCode === null && stoppingProcess.signalCode === null) {
                await new Promise<void>((resolve, reject) => {
                    const cleanup = (): void => {
                        clearTimeout(escalationTimer);
                        stoppingProcess.off('exit', onExit);
                        stoppingProcess.off('error', onError);
                        if (this.servers.get(serverId)?.process === stoppingProcess &&
                            serverData.forceKillTimer === escalationTimer) {
                            serverData.forceKillTimer = undefined;
                        }
                    };
                    const onExit = (): void => {
                        cleanup();
                        resolve();
                    };
                    const onError = (error: Error): void => {
                        if (this.servers.get(serverId)?.process !== stoppingProcess) return;
                        cleanup();
                        reject(error);
                    };
                    // `killed` means a signal was sent, not that the process exited.
                    // Only this exact child may receive the existing escalation.
                    const escalationTimer = setTimeout(() => {
                        if (this.servers.get(serverId)?.process !== stoppingProcess) {
                            return;
                        }
                        if (serverData.forceKillTimer === escalationTimer) {
                            serverData.forceKillTimer = undefined;
                        }
                        if (stoppingProcess.exitCode === null && stoppingProcess.signalCode === null) {
                            logger.warn(`Force killing server ${config.name}`);
                            try {
                                stoppingProcess.kill('SIGKILL');
                            } catch (error) {
                                onError(error instanceof Error ? error : new Error(String(error)));
                            }
                        }
                    }, 5000);
                    serverData.forceKillTimer = escalationTimer;
                    stoppingProcess.once('exit', onExit);
                    // Node emits 'error' for failures such as EPERM and returns
                    // false. A false return alone can also mean an exited child.
                    stoppingProcess.once('error', onError);
                    try {
                        stoppingProcess.kill('SIGTERM');
                    } catch (error) {
                        onError(error instanceof Error ? error : new Error(String(error)));
                    }
                });
            }

            if (this.servers.get(serverId) === serverData && serverData.process === stoppingProcess) {
                status.status = 'stopped';
                status.pid = undefined;
                serverData.stopPromise = undefined;
                this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STOPPED, serverId, agentId, channelId);
            }
            resolveStop();
        } catch (error) {
            if (this.servers.get(serverId) === serverData && serverData.process === stoppingProcess) {
                status.status = 'error';
                status.lastError = `Failed to stop server: ${error instanceof Error ? error.message : String(error)}`;
            }
            // Keep the rejected stop promise: a failed stop cannot safely admit
            // a replacement process over a child whose exit was not confirmed.
            rejectStop(error);
        }
        return stopPromise;
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
            const scopeData = this.serverScopes.get(serverId);
            const scope = scopeData?.scope ?? 'global';
            const scopeId = scopeData?.scopeId;

            for (const tool of serverData.status.tools) {
                tools.push({
                    ...tool,
                    serverId,
                    scope,
                    scopeId,
                    ...(scopeId && this.isOperatorAgentFilesystem(serverId, scopeId)
                        ? { operatorAgentFilesystem: true }
                        : {})
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
            const currentData = this.servers.get(serverId);
            if (!currentData || currentData.process !== process) {
                // Exit of a process instance that has already been replaced (restart)
                // or whose server record is gone (unregistered). Not this record's
                // state to change.
                logger.debug(`Ignoring exit of a superseded process for ${serverId} (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
                return;
            }

            // Check ownership first: an old child's exit cannot cancel the
            // replacement child's escalation timer.
            if (currentData.forceKillTimer) {
                clearTimeout(currentData.forceKillTimer);
                currentData.forceKillTimer = undefined;
            }

            const wasExpected = currentData.expectedExit === true;

            const droppedTools = status.tools.length;

            status.status = 'stopped';
            status.pid = undefined;
            // The handshake does not survive the process. A restarted server has to
            // perform it again before it can be marked running.
            status.initialized = false;
            status.initializing = false;
            status.tools = [];

            // Anything still waiting on this process will never get a reply.
            this.rejectPendingRequests(
                serverId,
                `server exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`
            );
            this.settleReadyWaiters(
                serverId,
                new Error(`Server ${serverId} exited during startup (code ${code ?? 'null'}, signal ${signal ?? 'none'})`)
            );

            // Clear timers
            if (serverData.healthCheckTimer) {
                clearInterval(serverData.healthCheckTimer);
                serverData.healthCheckTimer = undefined;
            }
            if (serverData.startupTimer) {
                clearTimeout(serverData.startupTimer);
                serverData.startupTimer = undefined;
            }

            if (wasExpected) {
                logger.info(`Server ${serverId} exited after stop (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
                return;
            }

            // Unexpected death. This used to happen in complete silence — no log
            // line at any level — which is how production servers vanished from
            // the tool registry with nothing to grep for.
            logger.error(
                `Server ${serverId} exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'})` +
                (droppedTools > 0 ? ` — its ${droppedTools} tool(s) are removed from the registry` : '')
            );

            // Restart on ANY unexpected exit when configured — including a clean
            // exit code. `code !== 0` used to gate this, leaving a child that
            // exited 0 dead forever with no restart and no log.
            if (config.restartOnCrash) {
                if (status.restartCount < config.maxRestartAttempts) {
                    status.restartCount++;
                    logger.warn(
                        `Restarting server ${serverId} in ${this.restartDelayMs}ms ` +
                        `(attempt ${status.restartCount}/${config.maxRestartAttempts})`
                    );
                    setTimeout(() => {
                        // A stop or replacement can win during the restart delay.
                        if (this.servers.get(serverId) === currentData &&
                            currentData.process === process && !currentData.expectedExit && !currentData.removing) {
                            this.startServer(serverId).catch(error => {
                                logger.error(
                                    `Restart of server ${serverId} failed: ` +
                                    `${error instanceof Error ? error.message : String(error)}`
                                );
                            });
                        }
                    }, this.restartDelayMs);
                } else {
                    // Out of restart budget: remove the server entirely rather than
                    // leaving a zombie record + scope that agents can "join".
                    this.removeServerAfterFailure(
                        serverId,
                        `crashed and exhausted its ${config.maxRestartAttempts} restart attempt(s)`
                    );
                    return;
                }
            } else {
                logger.error(
                    `Server ${serverId} will not be restarted (restartOnCrash is off). ` +
                    `An agent joining its channel will start it again on demand.`
                );
            }

            this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STOPPED, serverId);
        });

        // Handle process errors
        process.on('error', (error) => {
            if (!this.isCurrentProcessActive(serverId, process)) return;
            logger.error(`❌ Server ${config.name} process error: ${error.message}`);
            this.handleServerError(serverId, error.message);
        });

        // ONE stdout listener per server. Every JSON-RPC reply arrives here and is
        // routed to its waiting caller by request id.
        if (process.stdout) {
            process.stdout.on('data', (data: Buffer) => {
                if (!this.isCurrentProcessActive(serverId, process)) return;
                this.handleServerOutput(serverId, data.toString());
            });
        }

        // Handle stderr — log non-warning output for debugging spawn failures
        if (process.stderr) {
            process.stderr.on('data', (data) => {
                if (!this.isCurrentProcessActive(serverId, process)) return;
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
            if (!this.isCurrentProcessActive(serverId, process)) return;
            logger.info(`[SPAWN] Server ${serverId} process spawned; starting MCP handshake`);

            // stdin writes are buffered by the OS, so the handshake can be written
            // immediately — the child reads it when it is ready. The old code slept
            // two seconds here and hoped that was long enough.
            this.initializeMcpConnection(serverId).catch((err) => {
                if (!this.isCurrentProcessActive(serverId, process)) return;
                logger.error(`[MCP] Failed to initialize connection to ${serverId}: ${err.message}`);
                this.handleServerError(serverId, `MCP initialization failed: ${err.message}`);
            });
        });
    }

    /** Async process work may publish only while its exact child remains active. */
    private isCurrentProcessActive(serverId: string, process: ChildProcess): boolean {
        const currentData = this.servers.get(serverId);
        return !this.shutdownPromise && currentData?.process === process && !currentData.stopPromise && !currentData.expectedExit &&
            process.exitCode === null && process.signalCode === null;
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
        const timeoutMs = this.requestTimeouts[method];

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

        const { status, process } = serverData;
        if (!process || !this.isCurrentProcessActive(serverId, process)) return;

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
            if (!this.isCurrentProcessActive(serverId, process)) return;
            serverData.consecutiveHealthFailures = 0;
            this.emitServerHealthStatus(serverId, 'healthy');
        } catch (error) {
            if (!this.isCurrentProcessActive(serverId, process)) return;
            const message = error instanceof Error ? error.message : String(error);
            serverData.consecutiveHealthFailures = (serverData.consecutiveHealthFailures ?? 0) + 1;
            logger.warn(
                `Health check failed for ${serverId} ` +
                `(${serverData.consecutiveHealthFailures} consecutive): ${message}`
            );
            this.emitServerHealthStatus(serverId, 'unhealthy');

            // A process that is alive but no longer answering MCP is as dead as a
            // crashed one — the exit handler will never fire for it. Recover here.
            if (
                serverData.consecutiveHealthFailures >= HEALTH_FAILURES_BEFORE_RESTART &&
                serverData.config.restartOnCrash &&
                status.status === 'running'
            ) {
                serverData.consecutiveHealthFailures = 0;
                logger.error(`Server ${serverId} failed ${HEALTH_FAILURES_BEFORE_RESTART} consecutive health checks — restarting it`);
                this.restartServer(serverId).catch(restartError => {
                    logger.error(
                        `Health-check restart of ${serverId} failed: ` +
                        `${restartError instanceof Error ? restartError.message : String(restartError)}`
                    );
                });
            }
        }
    }

    /**
     * Discover tools available from a server
     */
    private async discoverServerTools(serverId: string): Promise<void> {
        const serverData = this.servers.get(serverId);
        if (!serverData) return;

        const { process } = serverData;
        if (!process || !this.isCurrentProcessActive(serverId, process) || serverData.status.status !== 'starting') return;
        if (!process.stdin || !process.stdout) {
            throw new Error(`Server ${serverId} process streams are not available for tool discovery`);
        }

        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_DISCOVERY, serverId);
        if (!this.isCurrentProcessActive(serverId, process) || serverData.status.status !== 'starting') return;
        const tools = await this.discoverRealToolsFromServer(serverId);
        // A stop, replacement, or startup failure owns the state from here on.
        if (!this.isCurrentProcessActive(serverId, process) || serverData.status.status !== 'starting') return;

        // Publish complete state before observers handle either readiness event.
        serverData.status.tools = tools;
        serverData.status.status = 'running';
        serverData.status.initialized = true;
        serverData.status.initializing = false;
        if (serverData.startupTimer) {
            clearTimeout(serverData.startupTimer);
            serverData.startupTimer = undefined;
        }
        this.emitServerEvent(McpEvents.EXTERNAL_SERVER_STARTED, serverId);
        if (!this.isCurrentProcessActive(serverId, process)) return;
        this.emitServerToolsDiscovered(serverId, tools);
        if (!this.isCurrentProcessActive(serverId, process)) return;

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
        if (!this.isCurrentProcessActive(serverId, process)) return;

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
        if (!this.isCurrentProcessActive(serverId, process)) return;

        logger.info(
            `[MCP] ${config.name} initialized ` +
            `(server: ${result?.serverInfo?.name ?? 'unknown'} ${result?.serverInfo?.version ?? ''})`
        );

        // 2. notifications/initialized — required by the spec before any other request
        this.sendNotification(serverId, 'notifications/initialized');

        // Startup includes discovery: concurrent callers cannot use a server
        // whose handshake succeeded but whose available tools are still unknown.
        await this.discoverServerTools(serverId);
        if (!this.isCurrentProcessActive(serverId, process) || serverData.status.status !== 'running') return;

        // A server that came up healthy earns back its full restart budget.
        // restartCount used to only ever grow, so a server that crashed a few
        // times over its lifetime — days apart, each recovered — permanently
        // exhausted its budget and the next crash left it down for good.
        serverData.status.restartCount = 0;
        serverData.consecutiveHealthFailures = 0;

        // Whoever awaited startServer() can proceed: the tools are discovered.
        this.settleReadyWaiters(serverId);
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

        if (!Array.isArray(result?.tools)) {
            throw new Error(`Invalid tools/list response from ${config.name}: tools must be an array`);
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

        // Anyone awaiting this server's startup gets the failure now.
        this.settleReadyWaiters(serverId, new Error(`Server ${serverId} failed: ${error}`));

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
                    status: serverData.status.status
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
     * Close admission and stop every server. Failed children remain owned and
     * the shutdown rejects with their individual failures; no stop is retried.
     */
    public shutdown(): Promise<void> {
        if (this.shutdownPromise) return this.shutdownPromise;

        let resolveShutdown!: () => void;
        let rejectShutdown!: (error: unknown) => void;
        const shutdownPromise = new Promise<void>((resolve, reject) => {
            resolveShutdown = resolve;
            rejectShutdown = reject;
        });
        // Claim before stopping any child: lifecycle listeners can call back
        // into shutdown, registration, or start synchronously.
        this.shutdownPromise = shutdownPromise;
        this.finishShutdown().then(resolveShutdown, rejectShutdown);
        return shutdownPromise;
    }

    /** Drain all child stops without discarding records whose stop failed. */
    private async finishShutdown(): Promise<void> {

        // Stop accepting lifecycle requests before child-process teardown. Node's
        // removeAllListeners() below only affects this class's EventEmitter; it
        // does not detach RxJS EventBus subscriptions.
        for (const subscription of this.eventSubscriptions) {
            subscription.unsubscribe();
        }
        this.eventSubscriptions = [];

        // Cancel every keepalive before awaiting stops, including failed records
        // whose ownership must survive shutdown.
        for (const scopeData of this.serverScopes.values()) {
            if (scopeData.keepAliveTimer) {
                clearTimeout(scopeData.keepAliveTimer);
                scopeData.keepAliveTimer = undefined;
            }
        }

        const serverIds = [...this.servers.keys()];
        const results = await Promise.allSettled(serverIds.map(serverId => this.stopServer(serverId)));
        const failures: Array<{ serverId: string; error: unknown }> = [];
        for (let index = 0; index < serverIds.length; index++) {
            const serverId = serverIds[index];
            const result = results[index];
            if (result.status === 'fulfilled') {
                this.servers.delete(serverId);
                this.serverScopes.delete(serverId);
            } else {
                failures.push({ serverId, error: result.reason });
            }
        }
        // An orphaned scope has no child to retain; failed server scopes remain.
        for (const serverId of this.serverScopes.keys()) {
            if (!this.servers.has(serverId)) this.serverScopes.delete(serverId);
        }
        this.retiredChannelIds.clear();
        this.removeAllListeners();
        if (failures.length > 0) {
            const details = failures.map(({ serverId, error }) =>
                `${serverId}: ${error instanceof Error ? error.message : String(error)}`
            ).join('; ');
            throw Object.assign(new Error(`External MCP shutdown failed: ${details}`), { failures });
        }
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
     * Restart a server by ID. Resolves after the restarted server has finished
     * its handshake and tool discovery (see startServer). Throws when the
     * restart fails, so callers can react instead of proceeding against a dead
     * server.
     */
    public async restartServer(serverId: string): Promise<boolean> {
        logger.info(`Restarting server ${serverId}`);

        // Stop the server first
        await this.stopServer(serverId, undefined, undefined, 'restart');

        // Give the old process a moment to release stdio
        await new Promise(resolve => setTimeout(resolve, this.restartDelayMs));

        // Start the server again — resolves after handshake + tool discovery
        await this.startServer(serverId);

        return true;
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
                
                // The environment disable is a ceiling: do not consult learned
                // patterns or retry an unmodified failed call when it is off.
                if (!this.autoCorrectionService.getConfig().enabled) break;
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
