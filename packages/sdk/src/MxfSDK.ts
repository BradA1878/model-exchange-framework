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
 * MxfSDK - Primary SDK entry point for Model Exchange Framework
 *
 * This class handles:
 * 1. Domain key authentication (SDK → Server)
 * 2. User authentication (JWT, username/password, or Personal Access Token)
 * 3. Agent creation and management
 *
 * USAGE:
 * ```typescript
 * import { MxfSDK } from '@mxf-dev/sdk';
 *
 * // Option 1: Personal Access Token (RECOMMENDED for SDK)
 * const sdk = new MxfSDK({
 *     serverUrl: 'http://localhost:3001',
 *     domainKey: process.env.MXF_DOMAIN_KEY,
 *     accessToken: process.env.MXF_ACCESS_TOKEN  // Format: pat_xxx:secret
 * });
 *
 * // Option 2: JWT token (pre-authenticated)
 * const sdk = new MxfSDK({
 *     serverUrl: 'http://localhost:3001',
 *     domainKey: process.env.MXF_DOMAIN_KEY,
 *     userId: 'user-id',
 *     userToken: 'jwt_token'
 * });
 *
 * // Option 3: Username/password (legacy)
 * const sdk = new MxfSDK({
 *     serverUrl: 'http://localhost:3001',
 *     domainKey: process.env.MXF_DOMAIN_KEY,
 *     username: 'demo-user',
 *     password: 'demo-password'
 * });
 *
 * await sdk.connect();
 *
 * // Create agents via SDK instance
 * const agent = await sdk.createAgent({
 *     agentId: 'my-agent',
 *     name: 'My Agent',
 *     channelId: 'my-channel',
 *     keyId: 'key-123',
 *     secretKey: 'secret-456',
 *     llmProvider: 'openrouter',
 *     defaultModel: 'anthropic/claude-3.5-sonnet'
 * });
 *
 * await agent.connect();
 * ```
 */

import { Events, CoreSocketEvents, AuthEvents } from '@mxf-dev/core/events/EventNames';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { McpEvents } from '@mxf-dev/core/events/event-definitions/McpEvents';
import { MxfAgent } from './MxfAgent.js';
import { MxfChannelMonitor } from './MxfChannelMonitor.js';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { createBaseEventPayload, createSdkReconnectedEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import type { SdkReconnectedEventData } from '@mxf-dev/core/events/event-definitions/SdkEvents';
import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';
import { AgentConfig, LlmReasoningConfig } from '@mxf-dev/core/interfaces/AgentInterfaces';
import { ChannelConfig } from '@mxf-dev/core/interfaces/ChannelConfig';
import { awaitEventResponse, EventRequestError } from './services/internal/EventRequest.js';
import type { McpServerRegistrationResult } from './MxfClient.js';
import type { KeyGenerateResult } from './services/MxfService.js';
import { default as socketIO } from 'socket.io-client';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';

const moduleLogger = new Logger('debug', 'MxfSDK', 'client');

/** How long to wait for an MCP server registration/unregistration to come back. */
const MCP_REGISTRATION_TIMEOUT_MS = 30_000;

/** How long to wait for a channel-create or key-generate to come back. */
const ADMIN_OPERATION_TIMEOUT_MS = 10_000;

/**
 * MxfSDK configuration interface
 */
export interface MxfSDKConfig {
    // Server connection
    serverUrl: string;
    domainKey: string;

    // User authentication (one of these sets is required)
    // Option 1: Personal Access Token (RECOMMENDED)
    accessToken?: string;  // Format: pat_xxx:secret

    // Option 2: Pre-authenticated JWT
    userId?: string;
    userToken?: string;  // JWT token

    // Option 3: Username/password (legacy)
    username?: string;
    password?: string;

    // Optional settings
    secure?: boolean;
    reconnection?: boolean;
    /**
     * Maximum automatic reconnect attempts. Omit for unlimited retries so a
     * server boot race or transient outage does not strand the SDK.
     */
    reconnectionAttempts?: number;
}

type SdkSocket = ReturnType<typeof socketIO>;

interface PendingSdkConnection {
    socket: SdkSocket;
    resolve: () => void;
    reject: (error: Error) => void;
}

interface SocketLifecycleCleanup {
    socket: SdkSocket;
    run: () => void;
}

/**
 * Agent creation configuration
 * Simplified config - host/port/secure/apiUrl are derived from SDK's serverUrl
 */
export interface AgentCreationConfig {
    // Required fields
    agentId: string;
    name: string;
    channelId: string;
    keyId: string;
    secretKey: string;
    llmProvider: LlmProviderType;
    defaultModel: string;
    
    // Optional agent identity
    agentConfigPrompt?: string;  // Agent's identity/role (optional, will use default if not provided)
    description?: string;
    capabilities?: string[];
    metadata?: Record<string, any>;
    
    // Optional LLM settings
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    maxHistory?: number;  // Max conversation history entries (default: 50) - keep low for long-running agents
    reasoning?: LlmReasoningConfig;  // Reasoning tokens: { enabled: true, effort: 'medium' } to request, { enabled: false } to disable models that reason by default (GLM, Qwen, DeepSeek)
    allowedTools?: string[];
    circuitBreakerExemptTools?: string[];  // Tools exempt from circuit breaker detection (for game tools, etc.)
    useMessageAggregate?: boolean;
    maxIterations?: number;  // Max LLM iterations per task (default: 10, increase for game scenarios)
    
    // Optional behavioral settings
    disableTaskHandling?: boolean;  // Disable automatic task handling (for utility agents that only register MCP servers)
    
    // Optional MXP settings
    mxpEnabled?: boolean;
    mxpPreferredFormat?: 'auto' | 'mxp' | 'natural-language';
    mxpForceEncryption?: boolean;

    // Optional connection settings
    reconnectAttempts?: number;  // Number of reconnection attempts (default: 5)
    reconnectDelay?: number;     // Delay between reconnection attempts in ms (default: 5000)
}

/**
 * MxfSDK - Main SDK class
 */
export class MxfSDK {
    private config: MxfSDKConfig;
    private socket: SdkSocket | null = null;
    private connectionPromise: Promise<void> | null = null;
    private disconnectPromise: Promise<void> | null = null;
    private pendingConnection: PendingSdkConnection | null = null;
    private socketLifecycleCleanup: SocketLifecycleCleanup | null = null;
    private authenticated: boolean = false;
    private userToken: string | null = null;
    private agents: Map<string, MxfAgent> = new Map();
    private userId: string = 'sdk-user';  // Default user ID for socket events
    /**
     * The user id the server confirmed at auth:success — the real Mongo ObjectId.
     * Distinct from `userId`, which starts as a placeholder, and from `config.userId`,
     * which PAT auth (the recommended path) never sets at all.
     */
    private authenticatedUserId: string | null = null;
    /**
     * Reconnect attempt count reported by the socket manager for the current
     * socket, consumed by the next authentication success. Null when the
     * manager has not reported a transport reconnect since the last auth.
     */
    private pendingTransportReconnectAttempt: number | null = null;
    private channelMonitors: Map<string, MxfChannelMonitor> = new Map();  // Track channel monitors for cleanup

    constructor(config: MxfSDKConfig) {
        // Validate required config
        if (!config.serverUrl) {
            throw new Error('serverUrl is required');
        }
        if (!config.domainKey) {
            throw new Error('domainKey is required');
        }

        // Validate user authentication - one of three options required
        const hasPAT = config.accessToken && config.accessToken.includes(':');
        const hasJWT = config.userId && config.userToken;
        const hasCredentials = config.username && config.password;

        if (!hasPAT && !hasJWT && !hasCredentials) {
            throw new Error('User authentication required: provide accessToken (pat_xxx:secret), (userId + userToken), or (username + password)');
        }

        // Validate PAT format if provided
        if (config.accessToken && !config.accessToken.includes(':')) {
            throw new Error('Invalid accessToken format. Expected: tokenId:secret (e.g., pat_xxx:secret)');
        }

        if (
            config.reconnectionAttempts !== undefined &&
            config.reconnectionAttempts !== Number.POSITIVE_INFINITY &&
            (!Number.isInteger(config.reconnectionAttempts) || config.reconnectionAttempts < 0)
        ) {
            throw new Error('reconnectionAttempts must be a non-negative integer or Infinity');
        }

        this.config = config;
    }

    /**
     * Connect SDK to MXF server
     * Establishes socket connection for admin operations (channel/key creation)
     */
    async connect(): Promise<void> {
        // A caller may reconnect while agent teardown is still in progress. Wait for
        // the authoritative disconnect to release the old socket before inspecting
        // connection state or creating a replacement.
        if (this.disconnectPromise) {
            await this.disconnectPromise;
        }

        // Validate we have authentication credentials
        const hasPAT = this.config.accessToken && this.config.accessToken.includes(':');
        const hasJWT = this.config.userToken;
        const hasCredentials = this.config.username && this.config.password;

        if (!hasPAT && !hasJWT && !hasCredentials) {
            throw new Error('Must provide accessToken, userToken, or username/password for authentication');
        }

        // Validate domain key
        if (!this.config.domainKey) {
            throw new Error('Domain key is required for SDK connection');
        }

        if (this.isConnected()) {
            return;
        }

        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        // Placeholder identity for the handshake only. auth:success replaces it
        // with the server-confirmed id, which is why it is set after the guards
        // above: a redundant connect() on a live SDK must not stamp later admin
        // requests with the placeholder.
        this.userId = this.config.userId || this.config.username || 'sdk-user';

        // Authentication success, rather than the first transport connection,
        // is the authoritative boundary. Keep this promise pending while the
        // Socket.IO manager retries a boot race or transient outage.
        const connectionAttempt = this.connectSocket();
        this.connectionPromise = connectionAttempt;

        try {
            await connectionAttempt;
        } finally {
            if (this.connectionPromise === connectionAttempt) {
                this.connectionPromise = null;
            }
        }
    }

    /**
     * Connect socket with domain key and user authentication
     */
    private async connectSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            let socket = this.socket;

            if (socket && !socket.connected && !socket.active) {
                this.releaseSocket(socket, false);
                socket = null;
            }

            if (!socket) {
                const socketOptions: Partial<ManagerOptions & SocketOptions> = {
                    reconnection: this.config.reconnection ?? true,
                    reconnectionAttempts: this.config.reconnectionAttempts ?? Number.POSITIVE_INFINITY,
                    auth: {
                        domainKey: this.config.domainKey
                    }
                };

                // Add user authentication (priority: PAT > JWT > username/password)
                if (this.config.accessToken) {
                    // Personal Access Token authentication (RECOMMENDED)
                    socketOptions.auth = {
                        ...socketOptions.auth,
                        accessToken: this.config.accessToken
                    };
                } else if (this.config.userToken) {
                    // JWT authentication
                    socketOptions.auth = {
                        ...socketOptions.auth,
                        token: this.config.userToken,
                        userId: this.userId
                    };
                } else if (this.config.username && this.config.password) {
                    // Username/password authentication (legacy)
                    socketOptions.auth = {
                        ...socketOptions.auth,
                        username: this.config.username,
                        password: this.config.password
                    };
                }

                socket = socketIO(this.config.serverUrl, socketOptions);
                this.socket = socket;
                this.installSocketLifecycleHandlers(socket);
            }

            this.pendingConnection = {
                socket,
                resolve,
                reject
            };

            if (this.authenticated && socket.connected) {
                this.resolvePendingConnection(socket);
            }
        });
    }

    /**
     * Install lifecycle handlers once for a socket. They remain active after
     * connect() resolves so a later manager reconnect can restore SDK state.
     */
    private installSocketLifecycleHandlers(socket: SdkSocket): void {
        const handleConnectError = (error: Error): void => {
            if (this.socket !== socket) {
                return;
            }

            this.authenticated = false;
            this.authenticatedUserId = null;
            moduleLogger.error(`SDK socket connection error: ${error.message}`);

            const reconnectionEnabled = this.config.reconnection ?? true;
            if (!reconnectionEnabled || !socket.active) {
                const connectionError = new Error(`Socket connection failed: ${error.message}`);
                this.rejectPendingConnection(socket, connectionError);
                this.releaseSocket(socket, true);
            }
        };

        const handleDisconnect = (reason: string): void => {
            if (this.socket !== socket) {
                return;
            }

            this.authenticated = false;
            this.authenticatedUserId = null;
            moduleLogger.warn(`SDK socket disconnected: ${reason}`);

            if (!socket.active) {
                const disconnectError = new Error(
                    `SDK socket disconnected without automatic recovery: ${reason}`
                );
                this.rejectPendingConnection(socket, disconnectError);
                this.releaseSocket(socket, false);
            }
        };

        const handleAuthSuccess = (data: unknown): void => {
            if (this.socket !== socket) {
                return;
            }

            if (!this.isRecord(data) ||
                typeof data.userId !== 'string' ||
                data.userId.trim().length === 0) {
                const responseError = new Error(
                    'Authentication succeeded without a valid server-confirmed userId'
                );
                this.authenticated = false;
                this.authenticatedUserId = null;
                this.rejectPendingConnection(socket, responseError);
                this.releaseSocket(socket, true);
                return;
            }

            // When no connect() call is waiting on this socket, the socket manager
            // restored the session on its own after a dropped transport.
            const restoredBySocketManager = this.pendingConnection?.socket !== socket;
            const attempt = this.pendingTransportReconnectAttempt;
            this.pendingTransportReconnectAttempt = null;

            this.userId = data.userId;
            this.authenticatedUserId = data.userId;
            this.authenticated = true;
            EventBus.client.setClientSocket(socket);
            this.resolvePendingConnection(socket);

            if (restoredBySocketManager) {
                this.emitReconnected(data.userId, attempt);
            }
        };

        const handleAuthError = (data: unknown): void => {
            if (this.socket !== socket) {
                return;
            }

            const authError = this.isRecord(data) && typeof data.error === 'string'
                ? data.error
                : 'Unknown error';
            moduleLogger.error(`Authentication failed: ${authError}`);
            this.authenticated = false;
            this.authenticatedUserId = null;
            this.rejectPendingConnection(socket, new Error(`Authentication failed: ${authError}`));
            this.releaseSocket(socket, true);
        };

        const handleReconnect = (attempt: number): void => {
            if (this.socket === socket) {
                this.pendingTransportReconnectAttempt = attempt;
                moduleLogger.info(`SDK socket transport reconnected after ${attempt} attempt(s); awaiting authentication`);
            }
        };

        const handleReconnectFailed = (): void => {
            if (this.socket !== socket) {
                return;
            }

            const reconnectError = new Error('Socket reconnection attempts exhausted before authentication');
            this.authenticated = false;
            this.authenticatedUserId = null;
            this.rejectPendingConnection(socket, reconnectError);
            this.releaseSocket(socket, true);
        };

        socket.on(CoreSocketEvents.CONNECT_ERROR, handleConnectError);
        socket.on(CoreSocketEvents.DISCONNECT, handleDisconnect);
        socket.on(AuthEvents.SUCCESS, handleAuthSuccess);
        socket.on(AuthEvents.ERROR, handleAuthError);
        socket.io.on(CoreSocketEvents.RECONNECT as 'reconnect', handleReconnect);
        socket.io.on(CoreSocketEvents.RECONNECT_FAILED as 'reconnect_failed', handleReconnectFailed);

        this.socketLifecycleCleanup = {
            socket,
            run: (): void => {
                socket.off(CoreSocketEvents.CONNECT_ERROR, handleConnectError);
                socket.off(CoreSocketEvents.DISCONNECT, handleDisconnect);
                socket.off(AuthEvents.SUCCESS, handleAuthSuccess);
                socket.off(AuthEvents.ERROR, handleAuthError);
                socket.io.off(CoreSocketEvents.RECONNECT as 'reconnect', handleReconnect);
                socket.io.off(CoreSocketEvents.RECONNECT_FAILED as 'reconnect_failed', handleReconnectFailed);
            }
        };
    }

    /**
     * Subscribe to the user connection being restored by the socket manager.
     *
     * Fires after the server has re-authenticated a connection that no
     * connect() call was waiting for — a reconnect after a dropped transport.
     * It does not fire for the authentication that settles connect() itself.
     * A server restart kills the channel MCP server processes it was running,
     * so this is the place to register them again.
     *
     * @param listener - Called with the server-confirmed user id and the
     *                   transport reconnect attempt count when known
     * @returns A function that removes the listener
     */
    public onReconnected(listener: (info: SdkReconnectedEventData) => void): () => void {
        const subscription = EventBus.client.on(Events.Sdk.RECONNECTED, (payload) => {
            if (payload.data.userId !== this.authenticatedUserId) {
                return;
            }
            listener(payload.data);
        });
        return (): void => { subscription.unsubscribe(); };
    }

    /** Deliver Events.Sdk.RECONNECTED to local subscribers only. */
    private emitReconnected(userId: string, attempt: number | null): void {
        moduleLogger.info(
            `SDK connection restored by the socket manager for user ${userId}` +
            (attempt === null ? '' : ` after ${attempt} transport attempt(s)`)
        );
        EventBus.client.emitLocal(
            Events.Sdk.RECONNECTED,
            createSdkReconnectedEventPayload(Events.Sdk.RECONNECTED, userId, { userId, attempt }, { source: 'MxfSDK' })
        );
    }

    private resolvePendingConnection(socket: SdkSocket): void {
        if (this.pendingConnection?.socket !== socket) {
            return;
        }

        const { resolve } = this.pendingConnection;
        this.pendingConnection = null;
        resolve();
    }

    private rejectPendingConnection(socket: SdkSocket, error: Error): void {
        if (this.pendingConnection?.socket !== socket) {
            return;
        }

        const { reject } = this.pendingConnection;
        this.pendingConnection = null;
        reject(error);
    }

    private releaseSocket(socket: SdkSocket, disconnect: boolean): void {
        if (this.socket !== socket) {
            return;
        }

        if (this.socketLifecycleCleanup?.socket === socket) {
            this.socketLifecycleCleanup.run();
            this.socketLifecycleCleanup = null;
        }

        EventBus.client.clearClientSocket(socket);
        this.socket = null;
        this.pendingTransportReconnectAttempt = null;

        if (disconnect) {
            socket.disconnect();
        }
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null;
    }

    /**
     * Fail fast if the SDK socket is not up.
     *
     * @throws Error if connect() has not run, or the socket has since dropped
     * @private
     */
    private assertSocketConnected(): void {
        if (!this.socket || !this.socket.connected) {
            throw new Error('SDK socket not connected. Call sdk.connect() first.');
        }
    }

    /**
     * Create an agent instance
     *
     * @param config Agent creation configuration
     * @returns Configured MxfAgent instance (not yet connected)
     */
    async createAgent(config: AgentCreationConfig): Promise<MxfAgent> {
        if (!this.authenticated) {
            throw new Error('SDK must be connected before creating agents. Call sdk.connect() first.');
        }

        // Parse server URL to get host and port
        const url = new URL(this.config.serverUrl);
        const host = url.hostname;
        const port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);

        // Build agent configuration with all optional fields
        const agentConfig: AgentConfig = {
            agentId: config.agentId,
            name: config.name,
            channelId: config.channelId,
            host: host,
            port: port,
            secure: this.config.secure ?? (url.protocol === 'https:'),
            apiUrl: `${this.config.serverUrl}/api`,
            keyId: config.keyId,
            secretKey: config.secretKey,
            description: config.description || '',
            capabilities: config.capabilities || [],
            metadata: config.metadata || {},
            llmProvider: config.llmProvider,
            apiKey: config.apiKey || '',
            defaultModel: config.defaultModel,
            agentConfigPrompt: config.agentConfigPrompt || `You are ${config.name}, an AI agent in the ${config.channelId} channel.`,
            // Pass through all optional LLM settings
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            maxHistory: config.maxHistory,
            reasoning: config.reasoning,
            allowedTools: config.allowedTools,
            circuitBreakerExemptTools: config.circuitBreakerExemptTools,
            useMessageAggregate: config.useMessageAggregate,
            maxIterations: config.maxIterations,
            // Pass through behavioral settings
            disableTaskHandling: config.disableTaskHandling,
            // Pass through MXP settings
            mxpEnabled: config.mxpEnabled,
            mxpPreferredFormat: config.mxpPreferredFormat,
            mxpForceEncryption: config.mxpForceEncryption,
            // Pass through connection settings
            reconnectAttempts: config.reconnectAttempts,
            reconnectDelay: config.reconnectDelay,
            // Add domain key to agent auth
            sdkDomainKey: this.config.domainKey
        };

        const agent = new MxfAgent(agentConfig);
        this.agents.set(config.agentId, agent);

        return agent;
    }

    /**
     * Create a channel via socket event
     * 
     * Returns a channel monitor that can be used to listen to events in the channel.
     * 
     * @param channelId Channel identifier
     * @param config Channel configuration
     * @returns Promise resolving to MxfChannelMonitor for event monitoring
     * 
     * @example
     * ```typescript
     * const channel = await sdk.createChannel('my-channel', {
     *     name: 'My Channel',
     *     description: 'A collaborative workspace',
     *     isPrivate: false,
     *     requireApproval: false,
     *     maxAgents: 50,
     *     allowAnonymous: false,
     *     metadata: { project: 'demo' }
     * });
     * 
     * // Listen to channel events
     * channel.on(Events.Message.AGENT_MESSAGE, (payload) => {
     *     console.log('Message:', payload.data.content.data);
     * });
     * ```
     */
    async createChannel(channelId: string, config: Partial<ChannelConfig> & { name: string }): Promise<MxfChannelMonitor> {
        this.assertSocketConnected();

        // Destructure config with defaults
        const {
            name,
            description = '',
            isPrivate = false,
            requireApproval = false,
            maxAgents = 100,
            allowAnonymous = false,
            metadata = {},
            allowedTools = [],
            systemLlmEnabled = true,
            mcpServers = []
        } = config;

        await awaitEventResponse<void>({
            emitEvent: Events.Channel.CREATE,
            payload: createBaseEventPayload(
                Events.Channel.CREATE,
                this.userId,
                channelId,
                {
                    name,
                    description,
                    isPrivate,
                    requireApproval,
                    maxAgents,
                    allowAnonymous,
                    metadata,
                    allowedTools,
                    systemLlmEnabled
                }
            ),
            route: { via: 'primary' },
            successEvent: Events.Channel.CREATED,
            failureEvent: Events.Channel.CREATION_FAILED,
            correlate: (payload: any) => payload?.channelId === channelId,
            mapResult: () => undefined,
            timeoutMs: ADMIN_OPERATION_TIMEOUT_MS,
            description: `Channel creation for '${channelId}'`,
            logger: moduleLogger,
        });

        // Register any MCP servers the caller asked for. A failure here is a failure of
        // createChannel — it used to be logged and swallowed, leaving the caller with a
        // channel monitor and no tools, and no way to tell.
        for (const serverConfig of mcpServers) {
            await this.registerChannelMcpServer(channelId, serverConfig);
        }

        const channelMonitor = new MxfChannelMonitor(channelId);
        this.channelMonitors.set(channelId, channelMonitor);
        return channelMonitor;
    }

    /**
     * Register an MCP server for a channel.
     *
     * Registers at the SDK level, without needing an agent.
     *
     * @param channelId Channel identifier
     * @param serverConfig MCP server configuration
     * @returns Promise resolving to the discovered tool names
     * @throws EventRequestError if the server rejects the registration
     * @throws EventRequestTimeoutError if no response arrives in 30s
     */
    async registerChannelMcpServer(channelId: string, serverConfig: {
        id: string;
        name: string;
        command?: string;
        args?: string[];
        transport?: 'stdio';
        autoStart?: boolean;
        environmentVariables?: Record<string, string>;
        restartOnCrash?: boolean;
        keepAliveMinutes?: number;
    }): Promise<McpServerRegistrationResult> {
        this.assertSocketConnected();

        return awaitEventResponse<McpServerRegistrationResult>({
            emitEvent: McpEvents.CHANNEL_SERVER_REGISTER,
            payload: createBaseEventPayload(
                McpEvents.CHANNEL_SERVER_REGISTER,
                this.userId,
                channelId,
                { ...serverConfig, channelId }
            ),
            route: { via: 'primary' },
            successEvent: McpEvents.CHANNEL_SERVER_REGISTERED,
            failureEvent: McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED,
            correlate: (payload: any) =>
                payload?.data?.serverId === serverConfig.id &&
                payload?.data?.scopeId === channelId,
            mapResult: (payload: any) => {
                if (payload?.data?.success === false) {
                    throw new EventRequestError(
                        payload?.data?.error || `Failed to register channel MCP server '${serverConfig.id}'`,
                        McpEvents.CHANNEL_SERVER_REGISTERED,
                        payload
                    );
                }
                return { toolsDiscovered: (payload?.data?.tools ?? []).map((t: any) => t.name) };
            },
            timeoutMs: MCP_REGISTRATION_TIMEOUT_MS,
            description: `Channel MCP server registration for '${serverConfig.id}'`,
            logger: moduleLogger,
        });
    }

    /**
     * Unregister an MCP server from a channel.
     *
     * @param channelId Channel identifier
     * @param serverId Server identifier
     * @returns Promise that resolves once the server has been removed
     * @throws EventRequestError if the server reports the removal failed
     * @throws EventRequestTimeoutError if no response arrives in 30s
     */
    async unregisterChannelMcpServer(channelId: string, serverId: string): Promise<void> {
        this.assertSocketConnected();

        await awaitEventResponse<void>({
            emitEvent: McpEvents.CHANNEL_SERVER_UNREGISTER,
            payload: createBaseEventPayload(
                McpEvents.CHANNEL_SERVER_UNREGISTER,
                this.userId,
                channelId,
                { serverId, channelId }
            ),
            route: { via: 'primary' },
            successEvent: McpEvents.CHANNEL_SERVER_UNREGISTERED,
            correlate: (payload: any) =>
                payload?.data?.serverId === serverId &&
                payload?.data?.scopeId === channelId,
            mapResult: (payload: any) => {
                if (payload?.data?.success === false) {
                    throw new EventRequestError(
                        payload?.data?.error || `Failed to unregister channel MCP server '${serverId}'`,
                        McpEvents.CHANNEL_SERVER_UNREGISTERED,
                        payload
                    );
                }
            },
            timeoutMs: MCP_REGISTRATION_TIMEOUT_MS,
            description: `Channel MCP server unregistration for '${serverId}'`,
            logger: moduleLogger,
        });
    }

    /**
     * Generate a channel key via socket event
     *
     * @param channelId Channel identifier
     * @param agentId Required globally keyed agent identity this credential authenticates as
     * @param name Key name (optional)
     * @param expiresAt Expiration date (optional)
     * @returns Promise resolving to key generation result
     */
    async generateKey(
        channelId: string,
        agentId: string,
        name?: string,
        expiresAt?: Date,
        allowedTools?: string[]
    ): Promise<KeyGenerateResult> {
        this.assertSocketConnected();

        if (typeof agentId !== 'string' || agentId.trim().length === 0) {
            throw new Error('agentId is required when generating a key');
        }
        if (agentId !== agentId.trim()) {
            throw new Error('agentId must not contain leading or trailing whitespace');
        }

        return awaitEventResponse<KeyGenerateResult>({
            emitEvent: Events.Key.GENERATE,
            payload: createBaseEventPayload(
                Events.Key.GENERATE,
                this.userId,
                channelId,
                {
                    channelId,
                    agentId,
                    name,
                    expiresAt: expiresAt?.toISOString(),
                    allowedTools
                }
            ),
            route: { via: 'primary' },
            successEvent: Events.Key.GENERATED,
            failureEvent: Events.Key.GENERATION_FAILED,
            correlate: (payload: any) => payload?.data?.channelId === channelId,
            mapResult: (payload: any) => ({
                keyId: payload.data.keyId,
                secretKey: payload.data.secretKey,
                channelId: payload.data.channelId,
                agentId: payload.data.agentId,
                allowedTools: payload.data.allowedTools
            }),
            timeoutMs: ADMIN_OPERATION_TIMEOUT_MS,
            description: `Key generation for channel '${channelId}'`,
            logger: moduleLogger,
        });
    }

    /**
     * Get an agent by ID
     */
    getAgent(agentId: string): MxfAgent | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Get all agents created by this SDK instance
     */
    getAllAgents(): MxfAgent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Register an external MCP server.
     *
     * Adds a developer-supplied MCP server to MXF. Resolves once its tools have been
     * discovered, so a resolved promise means the tools are usable.
     *
     * Responses are correlated by `serverId` — this used to resolve on the first
     * TOOLS_DISCOVERED event it saw regardless of origin, so two concurrent
     * registrations could complete each other with the wrong server's tools.
     *
     * @param serverConfig External server configuration
     * @returns Promise resolving to the discovered tool names
     * @throws EventRequestError if the server rejects the registration
     * @throws EventRequestTimeoutError if no response arrives in 30s
     *
     * @example
     * ```typescript
     * const { toolsDiscovered } = await sdk.registerExternalMcpServer({
     *   id: 'my-custom-server',
     *   name: 'My Custom Server',
     *   command: 'npx',
     *   args: ['-y', 'my-mcp-package']
     * });
     * ```
     */
    async registerExternalMcpServer(serverConfig: {
        id: string;
        name: string;
        command?: string;
        args?: string[];
        transport?: 'stdio';
        autoStart?: boolean;
        environmentVariables?: Record<string, string>;
        restartOnCrash?: boolean;
        maxRestartAttempts?: number;
    }): Promise<McpServerRegistrationResult> {
        this.assertSocketConnected();

        return awaitEventResponse<McpServerRegistrationResult>({
            emitEvent: McpEvents.EXTERNAL_SERVER_REGISTER,
            payload: createBaseEventPayload(
                McpEvents.EXTERNAL_SERVER_REGISTER,
                this.userId,
                'system',
                serverConfig
            ),
            route: { via: 'primary' },
            // Tools discovered — not "registered" — is the point at which the server
            // is actually usable, so that is what we wait for.
            successEvent: McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED,
            failureEvent: McpEvents.EXTERNAL_SERVER_REGISTRATION_FAILED,
            correlate: (payload: any) => payload?.data?.serverId === serverConfig.id,
            mapResult: (payload: any) => ({
                toolsDiscovered: (payload?.data?.tools ?? []).map((t: any) => t.name)
            }),
            timeoutMs: MCP_REGISTRATION_TIMEOUT_MS,
            description: `External MCP server registration for '${serverConfig.id}'`,
            logger: moduleLogger,
        });
    }

    /**
     * Unregister an external MCP server.
     *
     * @param serverId ID of the server to unregister
     * @returns Promise that resolves once the server has been removed
     * @throws EventRequestError if the server reports the removal failed
     * @throws EventRequestTimeoutError if no response arrives in 30s
     */
    async unregisterExternalMcpServer(serverId: string): Promise<void> {
        this.assertSocketConnected();

        await awaitEventResponse<void>({
            emitEvent: McpEvents.EXTERNAL_SERVER_UNREGISTER,
            payload: createBaseEventPayload(
                McpEvents.EXTERNAL_SERVER_UNREGISTER,
                this.userId,
                'system',
                { serverId }
            ),
            route: { via: 'primary' },
            successEvent: McpEvents.EXTERNAL_SERVER_UNREGISTERED,
            correlate: (payload: any) => payload?.data?.serverId === serverId,
            mapResult: (payload: any) => {
                if (payload?.data?.success === false) {
                    throw new EventRequestError(
                        payload?.data?.error || `Failed to unregister external MCP server '${serverId}'`,
                        McpEvents.EXTERNAL_SERVER_UNREGISTERED,
                        payload
                    );
                }
            },
            timeoutMs: MCP_REGISTRATION_TIMEOUT_MS,
            description: `External MCP server unregistration for '${serverId}'`,
            logger: moduleLogger,
        });
    }

    /**
     * Disconnect SDK and all agents
     */
    async disconnect(): Promise<void> {
        if (this.disconnectPromise) {
            return this.disconnectPromise;
        }

        const disconnectAttempt = this.performDisconnect();
        this.disconnectPromise = disconnectAttempt;

        try {
            await disconnectAttempt;
        } finally {
            if (this.disconnectPromise === disconnectAttempt) {
                this.disconnectPromise = null;
            }
        }
    }

    private async performDisconnect(): Promise<void> {
        // Disconnect all agents
        for (const agent of this.agents.values()) {
            try {
                await agent.disconnect();
            } catch (error) {
                moduleLogger.error(`Error disconnecting agent: ${error}`);
            }
        }

        // Destroy all channel monitors
        for (const monitor of this.channelMonitors.values()) {
            try {
                monitor.destroy();
            } catch (error) {
                moduleLogger.error(`Error destroying channel monitor: ${error}`);
            }
        }
        this.channelMonitors.clear();

        // Disconnect SDK socket
        if (this.socket) {
            const socket = this.socket;
            this.rejectPendingConnection(
                socket,
                new Error('SDK connection cancelled by disconnect()')
            );
            this.releaseSocket(socket, true);
        }

        this.authenticated = false;
        this.authenticatedUserId = null;
        this.agents.clear();
    }

    /**
     * Check if SDK is connected and authenticated
     */
    isConnected(): boolean {
        return this.authenticated && this.socket?.connected === true;
    }

    /**
     * Get the authenticated user ID.
     *
     * This is the id the server confirmed at auth:success — the Mongo ObjectId of the
     * user this SDK is acting as. It returns `undefined` until connect() completes.
     *
     * It used to return `config.userId`, which is only ever set on the JWT path.
     * Under PAT auth — the recommended path — config.userId is never provided, so a
     * fully connected SDK returned `undefined` for a user it knew perfectly well.
     *
     * @returns The authenticated user ID, or undefined if not yet connected
     */
    getUserId(): string | undefined {
        return this.authenticatedUserId ?? undefined;
    }

    /**
     * Get server URL
     */
    getServerUrl(): string {
        return this.config.serverUrl;
    }
}
