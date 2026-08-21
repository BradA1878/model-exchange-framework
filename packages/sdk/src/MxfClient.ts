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
 * Agent Class for the MXF
 * 
 * Provides a client-side interface for creating and connecting agents
 * to the MXF.
 */

import { v4 as uuidv4 } from 'uuid';
import { Subscription } from 'rxjs';
import { ConnectionStatus } from '@mxf-dev/core/types/types';
import { ChannelConnectionConfig } from '@mxf-dev/core/interfaces/ChannelConnectionConfig';
import { buildServerUrl, getServerConfig } from '@mxf-dev/core/config/ServerConfig';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { Events } from '@mxf-dev/core/events/EventNames';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { PayloadOf } from '@mxf-dev/core/events/EventBusBase';
import { PublicEventName, isPublicEvent, getEventCategory } from '@mxf-dev/core/events/PublicEvents';
import { AgentContext, ApiService } from './services/MxfApiService.js';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import {
    AgentEventPayload,
    createAgentEventPayload,
    createBaseEventPayload,
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { SimpleTaskResponse, TaskRequestHandler, TaskEndedHandler } from '@mxf-dev/core/interfaces/TaskInterfaces';
import { AgentConfig, InternalAgentConfig } from '@mxf-dev/core/interfaces/AgentInterfaces';
import { MxfService } from './services/MxfService.js';
import { McpToolHandlers } from './handlers/McpToolHandlers.js';
import { McpResourceHandlers } from './handlers/McpResourceHandlers.js';
import { ControlLoopHandlers } from './handlers/ControlLoopHandlers.js';
import { MemoryHandlers } from './handlers/MemoryHandlers.js';
import { MessageHandlers } from './handlers/MessageHandlers.js';
import { IAgentMemory, IChannelMemory, IRelationshipMemory, MemoryScope } from '@mxf-dev/core/types/MemoryTypes';
import { TaskHandlers } from './handlers/TaskHandlers.js';
import { UserInputHandlers, UserInputHandler } from './handlers/UserInputHandlers.js';
import { MxfToolService, IToolService, ClientTool } from './services/MxfToolService.js';
import { ClientToolExecutor } from './services/ClientToolExecutor.js';
import { ClientExternalMcpManager } from './services/ClientExternalMcpManager.js';
import { SDK_VERSION } from './version.js';

/** How long to wait for the server to acknowledge agent registration. */
const AGENT_REGISTRATION_TIMEOUT_MS = 10_000;

/**
 * Result of registering an MCP server.
 *
 * There is no `success` flag: a failed registration rejects. A resolved value
 * always means the server is registered and its tools are discovered.
 */
export interface McpServerRegistrationResult {
    /** Names of the tools the newly registered server exposes. */
    toolsDiscovered: string[];
}

/**
 * Agent channel keys authorize tool use, not host process management.
 * Use the user-authenticated MxfSDK administrative methods for MCP servers.
 */
export class AgentMcpProcessManagementError extends Error {
    public readonly code = 'MXF_ADMIN_MCP_REQUIRED';

    constructor(operation: string) {
        super(
            `${operation} is an administrative MCP process-management operation and cannot be ` +
            'performed with an agent/channel key. Use the corresponding MxfSDK method on an ' +
            'authenticated administrator connection.'
        );
        this.name = 'AgentMcpProcessManagementError';
    }
}

/**
 * MxfClient class for connecting to the MXF
 */
export class MxfClient {

    /**
     * The installed @mxf-dev/sdk version, read from the package manifest.
     */
    public static readonly SDK_VERSION: string = SDK_VERSION;

    // Properties from the config
    public agentId: string;
    public name: string;
    public channelId?: string;

    protected mxpClient!: any;
    protected config!: Required<InternalAgentConfig>;
    protected status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
    protected responseHandlers: Map<string, (response: SimpleTaskResponse) => void> = new Map();
    
    /**
     * MXF Service for interacting with the channel
     * Provides methods for task creation, message sending, and channel management
     */
    public mxfService!: MxfService;
    
    protected taskRequestHandler: TaskRequestHandler | null = null;
    protected logger!: Logger;
    protected subscribedChannels: Map<string, any> = new Map();
    protected apiService: ApiService | null = null;
    protected agentContext: AgentContext | null = null;
    protected agentMemory: IAgentMemory | null = null;
    protected connectionId: string = '';
    private validator = createStrictValidator('Agent');

    // Lazy connection management
    private connectionPromise: Promise<void> | null = null;
    private isFullyConnected = false;

    // Message handlers
    protected messageHandlers: MessageHandlers | null = null;

    // Control loop handlers
    protected controlLoopHandlers: ControlLoopHandlers | null = null;

    // Memory handlers
    protected memoryHandlers: MemoryHandlers | null = null;

    // MCP handlers
    protected mcpToolHandlers: McpToolHandlers | null = null;
    protected mcpResourceHandlers: McpResourceHandlers | null = null;

    // Task handlers
    protected taskHandlers: TaskHandlers | null = null;

    // User input handlers
    protected userInputHandlers: UserInputHandlers | null = null;

    // Tool service for loading tools via socket events
    protected toolService: MxfToolService | null = null;

    // Client-side tool executor for local execution of eligible stateless tools
    protected clientToolExecutor: ClientToolExecutor | null = null;

    // Client-side external MCP server manager (spawns external MCP servers locally)
    protected clientExternalMcpManager: ClientExternalMcpManager | null = null;

    // Public-API subscriptions created by on(), keyed by event name, for off()/disconnect() cleanup.
    // The handler is kept alongside its subscription so off(event, handler) can remove exactly one.
    private eventListeners: Map<string, Array<{ handler: (data: any) => void; subscription: Subscription }>> = new Map();

    // Subscriptions created by initializeEventHandlers(). Tracked so a disconnect()
    // tears them down instead of leaving a duplicate set behind on every reconnect.
    private lifecycleSubscriptions: Subscription[] = [];

    // Heartbeat mechanism to keep connection alive
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_INTERVAL_MS = 60000; // 60 seconds - send heartbeat every minute

    /**
     * Create a new Agent instance
     * 
     * @param config Agent configuration
     */
    constructor(config: AgentConfig) {
        // Create validator for fail-fast validation
        const validator = createStrictValidator('MxfClient');
        
        // Validate required fields
        validator.assertIsNonEmptyString(config.agentId, 'agentId is required');
        validator.assertIsNonEmptyString(config.channelId, 'channelId is required');
        validator.assertIsNonEmptyString(config.name, 'name is required');
        validator.assertIsNonEmptyString(config.keyId, 'keyId is required');
        validator.assertIsNonEmptyString(config.secretKey, 'secretKey is required');
        
        // Set agent properties from validated config
        this.agentId = config.agentId;
        this.name = config.name;
        this.channelId = config.channelId;
        
        // Initialize logger (use provided logger or create a new one)
        this.logger = new Logger('debug', `Agent:${this.agentId}`, 'client');
        
        // Log SDK version for debugging
        
        
        // Create a properly typed internal configuration
        const internalConfig: InternalAgentConfig = {
            // Required fields (already validated)
            agentId: this.agentId,
            name: this.name,
            channelId: this.channelId,
            keyId: config.keyId,
            secretKey: config.secretKey,
            
            // Agent properties
            description: config.description,
            capabilities: config.capabilities,
            allowedTools: config.allowedTools, // Add allowedTools to internal config
            metadata: config.metadata,
            agentConfigPrompt: config.agentConfigPrompt || '', // Add agentConfigPrompt with default empty string
            
            // SDK domain key for server authentication
            sdkDomainKey: config.sdkDomainKey,
            
            // Optional fields with defaults
            host: config.host || getServerConfig().host,
            port: config.port || getServerConfig().port,
            secure: config.secure ?? getServerConfig().secure,
            apiUrl: config.apiUrl || process.env.MXF_API_URL || `${buildServerUrl()}/api`,
            apiKey: config.apiKey || '',
            autoReconnect: config.autoReconnect ?? true,
            reconnectAttempts: config.reconnectAttempts ?? 5,
            reconnectDelay: config.reconnectDelay ?? 5000,
            requestTimeoutMs: config.requestTimeoutMs ?? 30000,
            logger: this.logger,

            // Client-side tool execution
            enableClientToolExecution: config.enableClientToolExecution ?? false,
            clientExternalMcpServers: config.clientExternalMcpServers,
        };
        
        // Store the configuration - fix the type issue by updating property type in MxfClient class
        this.config = internalConfig as Required<InternalAgentConfig>;
        
        
        // Initialize connection ID
        this.connectionId = uuidv4();
        
        // Create a channel to handle framework connection
        const mainChannelId = config.channelId;
        
        if (this.config.sdkDomainKey) {
        }
        
        const connectionConfig: ChannelConnectionConfig = {
            serverUrl: buildServerUrl(),
            keyId: this.config.keyId,
            secretKey: this.config.secretKey,
            autoReconnect: this.config.autoReconnect,
            reconnectDelay: this.config.reconnectDelay,
            reconnectAttempts: this.config.reconnectAttempts,
            apiUrl: this.config.apiUrl,
            capabilities: this.config.capabilities,
            allowedTools: this.config.allowedTools,
            sdkDomainKey: this.config.sdkDomainKey
        };
        
        // Using Channel as our IChannelService implementation
        this.mxfService = new MxfService(
            mainChannelId, 
            connectionConfig,
            {
                name: "Main Connection Channel",
                description: "Primary agent connection channel for framework communication",
                isPrivate: true,
                allowAnonymous: false,
                requireApproval: false,
                maxAgents: 2, // Just the agent and the server
                metadata: {
                    agentId: this.agentId,
                    purpose: "framework-connection"
                }
            },
            this.logger
        );
        
        // Initialize API service if we have URL
        if (this.config.apiUrl) {
            this.initApiService();
        }

        // Initialize message handlers
        this.messageHandlers = new MessageHandlers(this.channelId, this.agentId);
        
        // Configure MXP if settings are provided
        if (this.config.mxpEnabled !== undefined || 
            this.config.mxpPreferredFormat !== undefined || 
            this.config.mxpForceEncryption !== undefined) {
            this.messageHandlers.updateMxpConfig({
                enabled: this.config.mxpEnabled,
                preferredFormat: this.config.mxpPreferredFormat,
                forceEncryption: this.config.mxpForceEncryption
            });
        }

        // Initialize control loop handlers
        this.controlLoopHandlers = new ControlLoopHandlers(this.channelId, this.agentId);

        // Initialize memory handlers
        this.memoryHandlers = new MemoryHandlers(
            this.channelId,
            this.agentId
        );
        
        // Initialize MCP handlers
        this.mcpToolHandlers = new McpToolHandlers(this.channelId, this.agentId, this.mxfService);
        this.mcpResourceHandlers = new McpResourceHandlers(this.channelId, this.agentId);
        
        // Initialize task handlers (unless disabled for utility agents)
        if (!config.disableTaskHandling) {
            this.taskHandlers = new TaskHandlers(this.channelId, this.agentId);
        }

        // User input handlers are created lazily on first onUserInput() call —
        // not all agents need to handle user input prompts

        // Initialize tool service
        this.toolService = new MxfToolService(this.agentId, this.channelId);

        // Initialize client-side tool executor if enabled
        if (this.config.enableClientToolExecution) {
            this.clientToolExecutor = new ClientToolExecutor(
                this.agentId,
                this.channelId,
                this.mxfService,
                true
            );
            // Load eligible internal tools into the client registry
            this.clientToolExecutor.loadInternalTools();

            // Initialize client-side external MCP servers if configured
            if (this.config.clientExternalMcpServers && this.config.clientExternalMcpServers.length > 0) {
                this.clientExternalMcpManager = new ClientExternalMcpManager(
                    this.agentId,
                    this.channelId,
                    this.clientToolExecutor,
                    this.config.clientExternalMcpServers
                );
            }
        }

        // Set up event handlers for agent events
        this.initializeEventHandlers();
    }

    /**
     * Ensure agent is fully connected and subscribed to its channel
     * This method implements lazy connection - it only connects when needed
     * 
     * @returns Promise that resolves when agent is ready to work
     * @protected
     */
    protected async ensureConnected(): Promise<void> {
        // Only log when connection status is changing, not on every call
        if (!this.isFullyConnected) {
        }
        
        if (this.isFullyConnected) {
            return;
        }

        if (!this.connectionPromise) {
            this.connectionPromise = this.performFullConnection();
        }

        await this.connectionPromise;
    }

    /**
     * Perform the complete connection and subscription process
     * 
     * @returns Promise that resolves when fully connected
     * @private
     */
    private async performFullConnection(): Promise<void> {
        try {
            // Step 0: (Re-)register the agent lifecycle listeners. Idempotent — a no-op
            // on the first connect (the constructor already ran it) and the thing that
            // restores ORPAR/task/control-loop forwarding after a disconnect() torn them down.
            this.initializeEventHandlers();

            // Step 1: Connect socket and register agent using internal connection logic
            await this.connectSocketAndRegister();

            // Step 2: Subscribe to the channel (if channelId provided)
            if (this.channelId) {
                await this.subscribeToChannel(this.channelId);
            }
            
            // Step 3: Load tools automatically as part of connection
            if (this.toolService) {
                try {
                    const tools = await this.toolService.loadTools();
                } catch (toolError) {
                    this.logger.error(`Failed to load tools for agent ${this.agentId}: ${toolError}`);
                    // Don't fail connection if tool loading fails - tools can be loaded later
                }
            }
            
            // Step 4: Call agent-specific initialization if available (for derived classes)
            if (typeof (this as any).performAgentInitialization === 'function') {
                await (this as any).performAgentInitialization();
            }

            // Step 5: Start client-side external MCP servers (after socket is established)
            if (this.clientExternalMcpManager) {
                this.clientExternalMcpManager.start().catch((error: Error) => {
                    this.logger.warn(`Failed to start client-side external MCP servers: ${error.message}`);
                });
            }

            // Mark as fully connected
            this.isFullyConnected = true;

            // Start heartbeat mechanism to keep connection alive
            this.startHeartbeat();

        } catch (error) {
            // Reset connection state on failure
            this.connectionPromise = null;
            this.isFullyConnected = false;
            throw error;
        }
    }

    /**
     * Connect to the framework server and join the specified channel.
     *
     * Sending methods (sendMessage, sendObservation) auto-connect if not already
     * connected; call this explicitly for agents that need to listen for messages.
     *
     * @returns Promise that resolves when the agent is connected and registered
     * @throws Error if the socket fails to connect, credentials are rejected,
     *         or registration times out. Failures are never swallowed — this used
     *         to return `false` and log through a client Logger that is disabled by
     *         default, so a bad key or a registration timeout looked like silence.
     * @public
     *
     * @example
     * ```typescript
     * try {
     *     await agent.connect();
     * } catch (error) {
     *     console.error('Agent failed to connect:', error.message);
     *     process.exit(1);
     * }
     * ```
     */
    public async connect(): Promise<void> {
        await this.ensureConnected();
    }

    /**
     * Disconnect from MXF
     *
     * Tears down every subscription and socket handler this client created, so a
     * later connect() starts from a clean slate rather than stacking a second set
     * of listeners on top of the first.
     *
     * @returns Promise that resolves when disconnected
     * @public
     */
    public async disconnect(): Promise<void> {

        // Stop heartbeat mechanism
        this.stopHeartbeat();

        // Reset connection state
        this.isFullyConnected = false;
        this.connectionPromise = null;

        this.messageHandlers?.cleanup();
        this.mcpToolHandlers?.cleanup();
        this.mcpResourceHandlers?.cleanup();
        this.controlLoopHandlers?.cleanup();
        this.taskHandlers?.cleanup();
        this.userInputHandlers?.cleanup();
        this.memoryHandlers?.cleanup();
        this.toolService?.cleanup();
        this.clientToolExecutor?.cleanup();

        // Drop the agent-lifecycle subscriptions created by initializeEventHandlers().
        // Without this, every disconnect()/connect() cycle added another full set and
        // each status change fired N times.
        this.lifecycleSubscriptions.forEach(sub => sub.unsubscribe());
        this.lifecycleSubscriptions = [];

        // Drop any listeners the consumer registered with agent.on()
        this.removeAllListeners();

        // Shut down client-side external MCP servers
        if (this.clientExternalMcpManager) {
            this.clientExternalMcpManager.cleanup().catch((error: Error) => {
                this.logger.warn(`Error cleaning up client external MCP servers: ${error.message}`);
            });
        }

        // Disconnect from the channel service
        await this.mxfService?.disconnect();

        // Reset status
        this.status = ConnectionStatus.DISCONNECTED;
        this.emitStatusChange(this.status);
    }

    /**
     * Update the agent's allowed tools dynamically.
     * This updates both the server-side AgentService and refreshes the local tool cache.
     * Use this for phase-gated tool access (e.g., ORPAR cognitive cycle phases).
     *
     * @param tools - The new list of allowed tool names
     * @returns Promise that resolves when the update is complete
     * @public
     *
     * @example
     * // Update tools for OBSERVE phase
     * await agent.updateAllowedTools(['orpar_observe', 'game_getState', 'memory_read']);
     *
     * // Update tools for ACT phase
     * await agent.updateAllowedTools(['orpar_act', 'game_askQuestion']);
     */
    public async updateAllowedTools(tools: string[]): Promise<void> {
        await this.ensureConnected();

        // Update local config
        this.config.allowedTools = tools;

        // Tell the server-side AgentService. This goes through EventBus.client with a
        // proper payload helper — it used to bypass the bus entirely via
        // mxfService.socketEmit() and a hand-built object.
        const payload: AgentEventPayload = createAgentEventPayload(
            Events.Agent.ALLOWED_TOOLS_UPDATE,
            this.agentId,
            this.config.channelId,
            { allowedTools: tools }
        );
        EventBus.client.emitOn(this.agentId, Events.Agent.ALLOWED_TOOLS_UPDATE, payload);

        // Refresh local tool cache from server
        await this.refreshTools();
    }

    /**
     * Refresh the agent's cached tools from the server.
     * Call this after the server-side allowedTools have been updated
     * to get the new filtered tool list.
     *
     * @returns Promise resolving to the refreshed list of tools
     * @public
     */
    public async refreshTools(): Promise<ClientTool[]> {
        if (!this.toolService) {
            throw new Error('Tool service not initialized');
        }
        // force=true bypasses cache and fetches fresh from server
        return this.toolService.loadTools(undefined, true);
    }

    /**
     * Set a handler for task requests
     * 
     * @param handler Function that handles task requests
     * @public
     */
    public setTaskRequestHandler(handler: TaskRequestHandler): void {
        this.taskRequestHandler = handler;
        // Also pass the handler to TaskHandlers so it can process assigned tasks
        this.taskHandlers?.setTaskRequestHandler(handler);
    }

    /**
     * Set the handler called once when the task this agent was assigned ends
     * (completed, failed, or cancelled by the server).
     *
     * @param handler Receives the task id and its outcome
     * @protected
     */
    protected setTaskEndedHandler(handler: TaskEndedHandler): void {
        this.taskHandlers?.setTaskEndedHandler(handler);
    }

    /**
     * Register a handler for user input requests.
     * When an agent calls the user_input tool, this handler is invoked
     * to render the prompt and collect the user's response.
     *
     * @param handler - Callback that receives the request and returns the user's response
     * @public
     *
     * @example
     * ```typescript
     * client.onUserInput(async (request) => {
     *     if (request.inputType === 'confirm') {
     *         const answer = await confirm({ message: request.title });
     *         return answer;
     *     }
     *     if (request.inputType === 'select') {
     *         const answer = await select({
     *             message: request.title,
     *             choices: request.inputConfig.options
     *         });
     *         return answer;
     *     }
     *     // text input
     *     const answer = await input({ message: request.title });
     *     return answer;
     * });
     * ```
     */
    public onUserInput(handler: UserInputHandler): void {
        if (!this.channelId) {
            throw new Error('Cannot register user input handler: agent has no channelId configured');
        }
        // Lazily create and initialize on first call.
        // Safe to call before socket connects — EventBus subscriptions are decoupled
        // from socket state and will receive events once the connection is established.
        if (!this.userInputHandlers) {
            this.userInputHandlers = new UserInputHandlers(this.channelId, this.agentId);
            this.userInputHandlers.initialize();
        }
        this.userInputHandlers.setUserInputHandler(handler);
    }

    /**
     * Send a task request to another agent
     *
     * @param toAgentId The ID of the agent to send the task to
     * @param task The task description
     * @returns Promise resolving to the task ID
     * @protected
     */
    protected async sendTaskRequest(toAgentId: string, task: string): Promise<string> {
        await this.ensureConnected();
        return this.taskHandlers?.sendTaskRequest(toAgentId, task) ?? '';
    }

    /**
     * Send a response to a task request
     * 
     * @param response The task response
     * @param fromAgentId The ID of the agent sending the response (defaults to this agent's ID)
     * @returns Promise resolving when the response is sent
     * @protected
     */
    protected async sendTaskResponse(response: SimpleTaskResponse, fromAgentId?: string): Promise<void> {
        await this.ensureConnected();
        this.taskHandlers?.sendTaskResponse(response, fromAgentId);
    }

    /**
     * Send a direct message to another agent
     * 
     * @param agentId The ID of the agent to send the message to
     * @param content The message content
     * @returns Promise resolving when the message is sent
     * @protected
     */
    protected async sendDirectMessage(agentId: string, content: string): Promise<void> {
        await this.ensureConnected();
        this.messageHandlers?.sendDirectMessage(agentId, content);
    }

    /**
     * Send a channel message
     * 
     * @param channelId The channel ID to send the message to
     * @param type The type of message to send
     * @param content The message content
     * @returns Promise that resolves when the message is sent
     * @protected
     */
    protected async sendChannelMessage(channelId: string, type: string, content: any): Promise<boolean> {
        await this.ensureConnected();
        return this.messageHandlers?.sendChannelMessage(channelId, type, content, this.mxfService) ?? false;
    }

    /**
     * Subscribe to a channel to receive updates
     * 
     * @param channelId Channel ID to subscribe to
     * @returns Promise that resolves to true if subscription was successful
     * @private
     */
    private async subscribeToChannel(channelId: string): Promise<boolean> {
        return this.messageHandlers?.subscribeToChannel(channelId, this.mxfService) ?? false;
    }

    /**
     * Unsubscribe from a channel
     * 
     * @param channelId Channel ID to unsubscribe from
     * @returns Promise that resolves to true if unsubscription was successful
     * @protected
     */
    protected async unsubscribeFromChannel(channelId: string): Promise<boolean> {
        await this.ensureConnected();
        return this.messageHandlers?.unsubscribeFromChannel(channelId, this.mxfService) ?? false;
    }

    /**
     * Get a subscribed channel by ID
     * @param channelId Channel ID to get
     * @returns Channel instance or null if not subscribed
     * @protected
     */
    protected getChannel(channelId: string): any {
        return this.subscribedChannels.get(channelId) || null;
    }

    /**
     * Submit an observation to a control loop
     * 
     * @param loopId Control loop ID
     * @param observation Observation data
     * @param loopOwnerId Optional ID of the agent that owns the control loop. Required when submitting
     *                     to a control loop this agent doesn't own.
     * @returns Promise resolving to success boolean
     * @protected
     */
    protected async submitObservation(loopId: string, observation: any, loopOwnerId?: string): Promise<boolean> {
        await this.ensureConnected();
        return this.controlLoopHandlers?.submitObservation(loopId, observation, loopOwnerId) ?? false;
    }

    /**
     * Execute an action in a control loop
     * 
     * @param loopId Control loop ID
     * @param action Action data
     * @returns Promise resolving to success boolean
     * @protected
     */
    protected async executeControlLoopAction(loopId: string, action: any): Promise<boolean> {
        await this.ensureConnected();
        return this.controlLoopHandlers?.executeControlLoopAction(loopId, action) ?? false;
    }

    /**
     * Generate a reflection for a control loop plan (primarily for testing)
     * 
     * @param loopId Control loop ID
     * @param plan Plan to generate reflection for
     * @protected
     */
    protected async generateReflection(loopId: string, plan: any): Promise<void> {
        await this.ensureConnected();
        this.controlLoopHandlers?.generateReflection(loopId, plan);
    }

    /**
     * Check if the agent is connected to the server
     * 
     * @returns true if the agent is connected to the server
     * @public
     */
    public isConnected(): boolean {
        return this.isFullyConnected && this.getSocketConnected();
    }

    /**
     * Register the agent-lifecycle event listeners.
     *
     * Idempotent: calling it twice without an intervening disconnect() is a no-op.
     * Every subscription lands in `lifecycleSubscriptions` so disconnect() can drop
     * them. Before this, the listeners were registered once in the constructor and
     * never tracked, and the per-handler `initialize()` calls were torn down by
     * disconnect() but never restored — a disconnect()/connect() cycle produced an
     * agent with no task or control-loop handling at all.
     *
     * @protected
     */
    protected initializeEventHandlers(): void {
        if (this.lifecycleSubscriptions.length > 0) {
            return;
        }

        const isForThisAgent = (data: any): boolean =>
            !!data && data.agentId === this.config.agentId;

        // Connected
        this.lifecycleSubscriptions.push(
            EventBus.client.on(Events.Agent.CONNECTED, (data: any) => {
                if (isForThisAgent(data)) {
                    this.status = ConnectionStatus.CONNECTED;
                    this.emitStatusChange(this.status);
                }
            })
        );

        // Disconnected. MxfService emits Agent.DISCONNECT locally when this agent's
        // socket drops; Agent.DISCONNECTED is the server's announcement to the other
        // sockets and never reaches the agent that disconnected, so listening for it
        // here left the status stale after a transport drop and a later connect()
        // saw a client that still looked connected.
        this.lifecycleSubscriptions.push(
            EventBus.client.on(Events.Agent.DISCONNECT, (data: unknown) => {
                if (isForThisAgent(data)) {
                    this.status = ConnectionStatus.DISCONNECTED;
                    // The full connection (registration, channel subscription, tool
                    // load) is gone with the socket; a later connect() rebuilds it
                    // instead of returning early on a stale flag.
                    this.isFullyConnected = false;
                    this.connectionPromise = null;
                    this.emitStatusChange(this.status);
                }
            })
        );

        // Error
        this.lifecycleSubscriptions.push(
            EventBus.client.on(Events.Agent.ERROR, (data: any) => {
                if (isForThisAgent(data)) {
                    this.status = ConnectionStatus.ERROR;
                    this.emitStatusChange(this.status);
                }
            })
        );

        // Registered
        this.lifecycleSubscriptions.push(
            EventBus.client.on(Events.Agent.REGISTERED, (data: any) => {
                if (isForThisAgent(data) && this.status !== ConnectionStatus.REGISTERED) {
                    this.status = ConnectionStatus.REGISTERED;
                    this.emitStatusChange(this.status);
                }
            })
        );

        this.controlLoopHandlers?.initialize();
        this.taskHandlers?.initialize();
        // The handler is created lazily by onUserInput(), but an existing handler
        // must be re-subscribed after disconnect() cleaned its EventBus listener.
        this.userInputHandlers?.initialize();
    }

    /**
     * Check if the socket is connected
     * 
     * @returns true if the socket is connected
     * @private
     */
    private getSocketConnected(): boolean {
        try {
            // Primary check: Use the isConnected method of ChannelService if available
            // This is the most accurate way to check if the socket is actually connected
            if (typeof this.mxfService?.['isConnected'] === 'function') {
                const socketConnected = this.mxfService['isConnected']();
                
                // If socket is not connected, agent can't be connected regardless of status
                if (!socketConnected) {
                    return false;
                }
            } else if (!this.mxfService) {
                // If there's no channel service, we're definitely not connected
                return false;
            }
            
            // Secondary check: Verify agent is in a connected/registered state
            return this.status === ConnectionStatus.CONNECTED || 
                   this.status === ConnectionStatus.REGISTERED;
        } catch (error) {
            this.logger.error(`Error checking socket connection: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    private getMemoryHandlersForOperation(operation: string): MemoryHandlers {
        if (!this.memoryHandlers) {
            throw new Error(`Cannot ${operation}: memory handlers are not initialized`);
        }
        if (!this.getSocketConnected()) {
            throw new Error(`Cannot ${operation}: agent socket is not connected`);
        }
        return this.memoryHandlers;
    }

    /**
     * Create a new API service for backend interactions
     * @private
     */
    private initApiService(): void {
        this.validator.assertIsNonEmptyString(this.config.keyId, 'Key ID must be a non-empty string for API service.');
        this.validator.assertIsNonEmptyString(this.config.secretKey, 'Secret Key must be a non-empty string for API service.');

        if (this.config.apiUrl && this.config.keyId && this.config.secretKey) {
            this.apiService = new ApiService({
                baseUrl: this.config.apiUrl,
                keyId: this.config.keyId,
                secretKey: this.config.secretKey
            });
        } else {
            this.logger.warn('API URL not provided. Agent will not be able to use context/memory features.');
        }
    }

    /**
     * Initialize the control loop
     * 
     * @param config Configuration object for the control loop
     * @returns Promise resolving to control loop ID or null if API service is not available
     * @private
     */
    private async initializeControlLoop(config: any): Promise<string> {
        await this.ensureConnected();
        return this.controlLoopHandlers?.initializeControlLoop(config) ?? '';
    }

    /**
     * Start the control loop
     * 
     * @param loopId The control loop ID to start
     * @returns Promise resolving to control loop ID or null if API service is not available
     * @protected
     */
    protected async startControlLoop(loopId: string): Promise<void> {
        await this.ensureConnected();
        this.controlLoopHandlers?.startControlLoop(loopId);
    }

    /**
     * Stop the control loop
     * 
     * @param loopId The control loop ID to stop
     * @returns Promise resolving to control loop ID or null if API service is not available
     * @protected
     */
    protected async stopControlLoop(loopId: string): Promise<void> {
        await this.ensureConnected();
        this.controlLoopHandlers?.stopControlLoop(loopId);
    }

    /**
     * Load agent context from the server
     * Returns context containing identity, role, and instructions
     * @returns Promise resolving to agent context or null if API service is not available
     * @protected
     */
    protected async loadContext(): Promise<AgentContext | null> {
        await this.ensureConnected();
        try {
            if (!this.apiService) {
                this.logger.warn('API service not initialized. Cannot load agent context.');
                return null;
            }

            if (!this.config.keyId) {
                this.logger.warn('No keyId provided. Cannot load agent context.');
                return null;
            }

            // Fetch context from server
            this.agentContext = await this.apiService.fetchAgentContext(this.config.keyId);
            return this.agentContext;
        } catch (error) {
            this.logger.error(`Error loading agent context: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    /**
     * Get or create agent memory from the server using socket connection
     * @returns Promise resolving to authoritative agent memory
     * @protected
     */
    protected async getMemory(): Promise<IAgentMemory> {
        await this.ensureConnected();
        return this.getMemoryHandlersForOperation('get agent memory').getAgentMemory();
    }

    /**
     * Update agent memory on the server using socket connection
     * @param update Memory update data
     * @returns Promise resolving to authoritative updated agent memory
     * @protected
     */
    protected async updateMemory(update: Partial<IAgentMemory>): Promise<IAgentMemory> {
        await this.ensureConnected();
        return this.getMemoryHandlersForOperation('update agent memory')
            .updateAgentMemory(update);
    }

    /**
     * Add a note to agent memory
     * @param key Note key
     * @param value Note value
     * @returns Promise resolving to authoritative updated agent memory
     * @protected
     */
    protected async addNote(key: string, value: unknown): Promise<IAgentMemory> {
        await this.ensureConnected();
        return this.getMemoryHandlersForOperation('add an agent-memory note')
            .addNote(key, value);
    }

    /**
     * Add conversation entry to agent memory
     * @param entry Conversation entry to add
     * @returns Promise resolving to authoritative updated agent memory
     * @protected
     */
    protected async addToConversationHistory(entry: unknown): Promise<IAgentMemory> {
        await this.ensureConnected();
        return this.getMemoryHandlersForOperation('append agent conversation history')
            .addToConversationHistory(entry);
    }

    /**
     * Get or create relationship memory between this agent and another agent
     * @param otherAgentId The other agent ID for the relationship
     * @param channelId Optional channel ID to scope the relationship to
     * @returns Promise resolving to authoritative relationship memory
     * @protected
     */
    protected async getRelationshipMemory(
        otherAgentId: string,
        channelId?: string
    ): Promise<IRelationshipMemory> {
        await this.ensureConnected();
        if (channelId !== undefined) {
            this.validator.assertIsNonEmptyString(
                channelId,
                'Channel ID cannot be empty for relationship memory.'
            );
        }
        return this.getMemoryHandlersForOperation('get relationship memory')
            .getRelationshipMemory(otherAgentId, channelId);
    }

    /**
     * Update relationship memory with new data
     * @param otherAgentId The other agent ID for the relationship
     * @param update Memory fields to update
     * @param channelId Optional channel ID to scope the relationship to
     * @returns Promise resolving to authoritative updated relationship memory
     * @protected
     */
    protected async updateRelationshipMemory(
        otherAgentId: string, 
        update: Partial<IRelationshipMemory>, 
        channelId?: string
    ): Promise<IRelationshipMemory> {
        await this.ensureConnected();
        if (channelId !== undefined) {
            this.validator.assertIsNonEmptyString(
                channelId,
                'Channel ID cannot be empty for relationship memory.'
            );
        }
        return this.getMemoryHandlersForOperation('update relationship memory')
            .updateRelationshipMemory(otherAgentId, update, channelId);
    }

    /**
     * Get or create channel memory for a specific channel
     * @param channelId The channel ID to get memory for
     * @returns Promise resolving to authoritative channel memory
     * @protected
     */
    protected async getChannelMemory(channelId: string): Promise<IChannelMemory> {
        await this.ensureConnected();
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID cannot be empty for getChannelMemory.');
        return this.getMemoryHandlersForOperation('get channel memory')
            .getChannelMemory(channelId);
    }

    /**
     * Update channel memory with new data
     * @param channelId The channel ID to update memory for
     * @param update Memory fields to update
     * @returns Promise resolving to authoritative updated channel memory
     * @protected
     */
    protected async updateChannelMemory(
        channelId: string,
        update: Partial<IChannelMemory>
    ): Promise<IChannelMemory> {
        await this.ensureConnected();
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID cannot be empty for updateChannelMemory.');
        return this.getMemoryHandlersForOperation('update channel memory')
            .updateChannelMemory(channelId, update);
    }

    /**
     * Delete a memory entry based on its scope.
     *
     * Agent memory is always exact-self: an agent credential cannot select a
     * different target. Channel and relationship scopes still require their
     * scope-specific identifier.
     *
     * @param scope The scope of the memory (AGENT, CHANNEL, RELATIONSHIP).
     * @param id The channelId or otherAgentId. Omit for AGENT scope.
     * @param secondaryId Optional secondary identifier, used as channelId for RELATIONSHIP scope.
     * @returns Promise resolving to true when deletion is authoritatively confirmed.
     * @protected
     */
    protected deleteMemoryEntry(scope: MemoryScope.AGENT): Promise<boolean>;
    protected deleteMemoryEntry(scope: MemoryScope.CHANNEL, id: string): Promise<boolean>;
    protected deleteMemoryEntry(
        scope: MemoryScope.RELATIONSHIP,
        otherAgentId: string,
        channelId?: string
    ): Promise<boolean>;
    protected async deleteMemoryEntry(
        scope: MemoryScope,
        id?: string,
        secondaryId?: string
    ): Promise<boolean> {
        switch (scope) {
            case MemoryScope.AGENT:
                if (id !== undefined || secondaryId !== undefined) {
                    throw new Error('AGENT memory deletion is self-scoped and accepts no target ID.');
                }
                break;
            case MemoryScope.CHANNEL:
                if (secondaryId !== undefined) {
                    throw new Error('CHANNEL memory deletion accepts only a channel ID.');
                }
                if (typeof id !== 'string' || id.trim() === '') {
                    throw new Error('Channel ID cannot be empty for CHANNEL scope deletion.');
                }
                break;
            case MemoryScope.RELATIONSHIP:
                if (typeof id !== 'string' || id.trim() === '') {
                    throw new Error('Other Agent ID cannot be empty for RELATIONSHIP scope deletion.');
                }
                if (secondaryId !== undefined && secondaryId.trim() === '') {
                    throw new Error('Channel ID cannot be empty for RELATIONSHIP scope deletion.');
                }
                break;
            default:
                throw new Error(`Unknown memory scope for deletion: ${String(scope)}`);
        }

        await this.ensureConnected();
        const handlers = this.getMemoryHandlersForOperation('delete memory');
        switch (scope) {
            case MemoryScope.AGENT:
                return handlers.deleteAgentMemory();
            case MemoryScope.CHANNEL:
                if (id === undefined) {
                    throw new Error('Channel ID is required for CHANNEL scope deletion.');
                }
                return handlers.deleteChannelMemory(id);
            case MemoryScope.RELATIONSHIP:
                if (id === undefined) {
                    throw new Error('Other Agent ID is required for RELATIONSHIP scope deletion.');
                }
                return handlers.deleteRelationshipMemory(id, secondaryId);
        }
    }

    /**
     * Get the connection ID for this agent
     * 
     * @returns The connection ID
     * @public
     */
    public getConnectionId(): string {
        return this.connectionId;
    }

    /**
     * Get the tool service for this agent
     * 
     * @returns The ToolService instance or null if not initialized
     * @public
     */
    public getToolService(): IToolService | null {
        return this.toolService;
    }

    /**
     * Send a channel message (public API)
     * 
     * @param channelId The channel ID to send the message to
     * @param type The type of message to send
     * @param content The message content
     * @returns Promise that resolves when the message is sent
     * @public
     */
    public async sendMessage(channelId: string, type: string, content: any): Promise<boolean> {
        // Ensure we're connected before sending
        await this.ensureConnected();
        
        // Delegate to sendChannelMessage
        return this.sendChannelMessage(channelId, type, content);
    }
    
    /**
     * Send several channel messages in one call (public API)
     *
     * Each message goes out through the normal Events.Message.CHANNEL_MESSAGE flow,
     * so the server persists them exactly as it does for sendMessage().
     *
     * This used to emit a `'PERSIST_BULK_CHANNEL_MESSAGES_REQUEST'` string literal with
     * a hand-built payload — which is not a registered event, and whose payload was
     * assembled with a bare CommonJS require of uuid, which threw
     * `ReferenceError: require is not defined` on every Node consumer (this is an ESM
     * package). It is now routed through the event system like every other message.
     *
     * @param channelId The channel ID to send the messages to
     * @param type The type of messages to send
     * @param messages Array of message contents
     * @returns Promise that resolves once every message has been sent
     * @throws Error if any message fails to send
     * @public
     */
    public async sendMessages(channelId: string, type: string, messages: any[]): Promise<void> {
        await this.ensureConnected();

        this.validator.assert(Array.isArray(messages), 'messages must be an array');

        if (messages.length === 0) {
            return;
        }

        for (const content of messages) {
            const sent = await this.sendChannelMessage(channelId, type, content);
            if (!sent) {
                throw new Error(
                    `Failed to send message to channel '${channelId}' ` +
                    `(${messages.length} message(s) requested)`
                );
            }
        }
    }

    /**
     * Submit an observation to a control loop (public API)
     * 
     * @param loopIdOrObservation Either a loop ID string or the observation data for this agent's own loop
     * @param observationData Observation data (if first param is loopId)
     * @param loopOwnerId Optional ID of the agent that owns the control loop
     * @returns Promise resolving to success boolean
     * @public
     */
    public async sendObservation(
        loopIdOrObservation: string | any, 
        observationData?: any, 
        loopOwnerId?: string
    ): Promise<boolean> {
        await this.ensureConnected();
        
        // If first parameter is an object, treat it as observation data for this agent's own loop
        if (typeof loopIdOrObservation === 'object' && observationData === undefined) {
            // Auto-initialize this agent's control loop if it doesn't exist
            let ownLoopId = this.controlLoopHandlers?.getActiveControlLoopId();
            if (!ownLoopId) {
                ownLoopId = await this.initializeControlLoop({});
            } else {
            }
            return this.submitObservation(ownLoopId, loopIdOrObservation);
        }
        
        // Otherwise, use the original API
        return this.submitObservation(loopIdOrObservation as string, observationData, loopOwnerId);
    }

    /**
     * List available MCP tools
     * 
     * @param channelId Channel ID to list tools from
     * @param filter Optional filter for tool listing
     * @returns Promise resolving to array of available tools
     * @public
     */
    public async listTools(channelId?: string, filter?: any): Promise<any[]> {
        // Validate optional channelId parameter if provided
        if (channelId && typeof channelId !== 'string') {
            throw new Error('channelId must be a string if provided');
        }
        const targetChannelId = channelId || this.channelId!;
        // targetChannelId is guaranteed to be valid since this.channelId is validated in constructor
        
        // Use ToolService to request tools via socket events
        if (!this.toolService) {
            throw new Error('Tool service not initialized');
        }
        
        return this.toolService.loadTools(filter);
    }

    /**
     * Emit a status change event using the standard payload helper.
     *
     * The payload was hand-built here using a bare CommonJS require of uuid. This is an
     * ESM package, so that threw `ReferenceError: require is not defined` on Node —
     * and because this sits on the connect() path (connectSocketAndRegister →
     * emitStatusChange), every single agent.connect() on Node blew up. Bun's CommonJS
     * polyfill is the only reason it was never caught.
     *
     * @param status - The status to emit
     * @private
     */
    private emitStatusChange(status: ConnectionStatus): void {
        const payload: AgentEventPayload = createAgentEventPayload(
            Events.Agent.STATUS_CHANGE,
            this.agentId,
            this.config.channelId,
            { status: status as string }
        );

        EventBus.client.emitOn(this.agentId, Events.Agent.STATUS_CHANGE, payload);
    }

    /**
     * Start sending periodic heartbeat messages to keep connection alive
     * @private
     */
    private startHeartbeat(): void {
        // Clean up any existing heartbeat interval
        this.stopHeartbeat();


        // Send initial heartbeat immediately
        this.sendHeartbeat();

        // Set up interval to send heartbeats periodically
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, this.HEARTBEAT_INTERVAL_MS);

        // The heartbeat must not be the reason a process stays alive. A connected agent is
        // held open by its socket; without unref() this timer pins Node's event loop on its
        // own, so a consumer that merely constructed a client could never exit.
        this.heartbeatInterval.unref();
    }

    /**
     * Stop sending heartbeat messages
     * @private
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Send a heartbeat message to the server.
     *
     * Uses Events.Heartbeat.HEARTBEAT and the standard payload helper — this was
     * a `'heartbeat'` string literal with a hand-built payload.
     *
     * @private
     */
    private sendHeartbeat(): void {
        try {
            if (!this.isFullyConnected) {
                return;
            }

            const heartbeatPayload = createBaseEventPayload(
                Events.Heartbeat.HEARTBEAT,
                this.agentId,
                this.config.channelId || 'system',
                { clientTimestamp: Date.now() }
            );

            EventBus.client.emitOn(this.agentId, Events.Heartbeat.HEARTBEAT, heartbeatPayload);
        } catch (error) {
            this.logger.error(`Error sending heartbeat: ${error}`);
        }
    }

    /**
     * Connect the socket and register the agent with the server.
     *
     * Resolves only once BOTH Agent.CONNECTED and Agent.REGISTERED have arrived for
     * this agent. Every subscription and the timeout go through one teardown, so no
     * listener survives the call — the CONNECTED subscription used to be created and
     * never unsubscribed on any path, leaking one listener per connect.
     *
     * @private
     */
    private async connectSocketAndRegister(): Promise<void> {
        // Only attempt to connect once
        if (this.status !== ConnectionStatus.DISCONNECTED) {
            return;
        }

        // Update the agent status to connecting
        this.status = ConnectionStatus.CONNECTING;
        this.emitStatusChange(this.status);

        // If already connected, just return
        if (this.isConnected()) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            let registeredReceived = false;
            let connectedReceived = false;

            const subscriptions: Subscription[] = [];
            let timeout: ReturnType<typeof setTimeout> | null = null;

            const teardown = (): void => {
                if (timeout !== null) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                subscriptions.forEach(sub => sub.unsubscribe());
                subscriptions.length = 0;
            };

            const settleResolve = (): void => {
                if (settled) return;
                settled = true;
                teardown();
                resolve();
            };

            const settleReject = (error: Error): void => {
                if (settled) return;
                settled = true;
                teardown();
                this.status = ConnectionStatus.ERROR;
                this.emitStatusChange(this.status);
                reject(error);
            };

            const isForThisAgent = (data: any): boolean =>
                !!data && data.agentId === this.config.agentId;

            subscriptions.push(
                EventBus.client.on(Events.Agent.REGISTERED, (data: any) => {
                    if (!isForThisAgent(data)) return;
                    this.status = ConnectionStatus.REGISTERED;
                    this.emitStatusChange(this.status);
                    registeredReceived = true;
                    if (connectedReceived) settleResolve();
                })
            );

            subscriptions.push(
                EventBus.client.on(Events.Agent.CONNECTED, (data: any) => {
                    if (!isForThisAgent(data)) return;
                    this.status = ConnectionStatus.CONNECTED;
                    this.emitStatusChange(this.status);
                    connectedReceived = true;
                    if (registeredReceived) settleResolve();
                })
            );

            subscriptions.push(
                EventBus.client.on(Events.Agent.REGISTRATION_FAILED, (data: any) => {
                    if (!isForThisAgent(data)) return;
                    const reason = (data as any).error || 'Unknown error';
                    this.logger.error(`Agent ${this.config.agentId} registration failed: ${reason}`);
                    settleReject(new Error(`Agent registration failed: ${reason}`));
                })
            );

            timeout = setTimeout(() => {
                settleReject(new Error(
                    `Agent '${this.config.agentId}' registration timed out after ` +
                    `${AGENT_REGISTRATION_TIMEOUT_MS}ms (connected=${connectedReceived}, registered=${registeredReceived})`
                ));
            }, AGENT_REGISTRATION_TIMEOUT_MS);

            // Initialize the channel socket connection, then register the agent.
            this.mxfService.setAgentId(this.config.agentId);
            this.mxfService.connect().then(() => {
                const registrationPayload: AgentEventPayload = createAgentEventPayload(
                    Events.Agent.REGISTER,
                    this.config.agentId,
                    this.config.channelId,
                    {
                        name: this.config.name,
                        type: 'agent',
                        capabilities: this.config.capabilities || ['basic'],
                        allowedTools: this.config.allowedTools,
                        metadata: this.config.metadata,
                        status: 'registering'
                    }
                );

                EventBus.client.emitOn(this.agentId, Events.Agent.REGISTER, registrationPayload);
            }).catch(error => {
                this.logger.error(`Channel service socket connection failed: ${error instanceof Error ? error.message : String(error)}`);
                settleReject(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }

    /**
     * Execute an MCP tool
     * 
     * @param toolName Name of the tool to execute
     * @param input Input parameters for the tool
     * @param channelId Channel ID where the tool execution should occur
     * @returns Promise resolving to the tool execution result
     * @public
     */
    public async executeTool(toolName: string, input: any, channelId?: string): Promise<any> {
        // Ensure we're connected before executing tools
        await this.ensureConnected();
        
        // Validate optional channelId parameter if provided
        if (channelId && typeof channelId !== 'string') {
            throw new Error('channelId must be a string if provided');
        }
        const targetChannelId = channelId || this.channelId!;
        // targetChannelId is guaranteed to be valid since this.channelId is validated in constructor

        // Route eligible tools to client-side executor (avoids Socket.IO round-trip)
        if (this.clientToolExecutor?.canExecuteLocally(toolName)) {
            return this.clientToolExecutor.executeLocally(toolName, input, targetChannelId);
        }

        // Server-side execution path (existing behavior)
        if (!this.mcpToolHandlers) {
            throw new Error('MCP tool handlers not initialized');
        }

        return this.mcpToolHandlers.callTool(toolName, input, targetChannelId);
    }
    
    /**
     * Register an MCP tool
     *
     * @param tool Tool definition to register
     * @param channelId Channel ID where the tool should be registered
     * @returns Promise that resolves once the server has accepted the tool
     * @throws Error if the server rejects the registration or does not answer
     * @public
     */
    public async registerTool(tool: any, channelId?: string): Promise<void> {
        // Ensure we're connected before registering tools
        await this.ensureConnected();

        // Validate optional channelId parameter if provided
        if (channelId && typeof channelId !== 'string') {
            throw new Error('channelId must be a string if provided');
        }
        const targetChannelId = channelId || this.channelId!;
        // targetChannelId is guaranteed to be valid since this.channelId is validated in constructor

        if (!this.mcpToolHandlers) {
            throw new Error('MCP tool handlers not initialized');
        }

        await this.mcpToolHandlers.registerTool(tool, targetChannelId);
    }

    /**
     * Unregister an MCP tool
     *
     * @param toolName Name of the tool to unregister
     * @param channelId Channel ID where the tool should be unregistered
     * @returns Promise that resolves once the server has removed the tool
     * @throws Error if the server rejects the request or does not answer
     * @public
     */
    public async unregisterTool(toolName: string, channelId?: string): Promise<void> {
        // Ensure we're connected before unregistering tools
        await this.ensureConnected();

        // Validate optional channelId parameter if provided
        if (channelId && typeof channelId !== 'string') {
            throw new Error('channelId must be a string if provided');
        }
        const targetChannelId = channelId || this.channelId!;
        // targetChannelId is guaranteed to be valid since this.channelId is validated in constructor

        if (!this.mcpToolHandlers) {
            throw new Error('MCP tool handlers not initialized');
        }

        await this.mcpToolHandlers.unregisterTool(toolName, targetChannelId);
    }

    /**
     * Agent-key clients cannot register external MCP servers.
     *
     * @param serverConfig External server configuration
     * @returns A rejected promise; agent credentials never authorize this operation
     * @throws AgentMcpProcessManagementError immediately; use MxfSDK.registerExternalMcpServer()
     * @deprecated MCP process management is administrative and is unavailable to MxfClient/MxfAgent.
     * @public
     */
    public async registerExternalMcpServer(serverConfig: {
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
        throw new AgentMcpProcessManagementError(
            `Registering external MCP server '${serverConfig.id}'`
        );
    }

    /**
     * Agent-key clients cannot unregister external MCP servers.
     *
     * @param serverId ID of the server to unregister
     * @returns A rejected promise; agent credentials never authorize this operation
     * @throws AgentMcpProcessManagementError immediately; use MxfSDK.unregisterExternalMcpServer()
     * @deprecated MCP process management is administrative and is unavailable to MxfClient/MxfAgent.
     * @public
     */
    public async unregisterExternalMcpServer(serverId: string): Promise<void> {
        throw new AgentMcpProcessManagementError(
            `Unregistering external MCP server '${serverId}'`
        );
    }

    /**
     * Agent-key clients cannot register channel-scoped MCP servers.
     *
     * @param serverConfig Channel server configuration
     * @returns A rejected promise; agent credentials never authorize this operation
     * @throws AgentMcpProcessManagementError immediately; use MxfSDK.registerChannelMcpServer()
     * @deprecated MCP process management is administrative and is unavailable to MxfClient/MxfAgent.
     * @public
     */
    public async registerChannelMcpServer(serverConfig: {
        id: string;
        name: string;
        command?: string;
        args?: string[];
        transport?: 'stdio';
        autoStart?: boolean;
        environmentVariables?: Record<string, string>;
        restartOnCrash?: boolean;
        maxRestartAttempts?: number;
        keepAliveMinutes?: number;
    }): Promise<McpServerRegistrationResult> {
        throw new AgentMcpProcessManagementError(
            `Registering channel MCP server '${serverConfig.id}'`
        );
    }

    /**
     * List channel-scoped MCP servers
     *
     * Returns all MCP servers registered for the current channel.
     * Uses REST API for simple read operation.
     *
     * @param channelId Optional channel ID (defaults to current channel)
     * @returns Promise resolving to list of channel servers
     * @public
     */
    public async listChannelMcpServers(channelId?: string): Promise<any[]> {
        await this.ensureConnected();

        const targetChannelId = channelId || this.channelId;
        if (!targetChannelId) {
            throw new Error('Cannot list channel MCP servers: no channel specified');
        }

        if (!this.apiService) {
            throw new Error('API service not initialized');
        }

        const response = await this.apiService.get(`/channels/${targetChannelId}/mcp-servers`);
        return response.servers || [];
    }

    /**
     * Agent-key clients cannot unregister channel-scoped MCP servers.
     *
     * @param serverId ID of the server to unregister
     * @param channelId Optional channel ID (defaults to current channel)
     * @returns A rejected promise; agent credentials never authorize this operation
     * @throws AgentMcpProcessManagementError immediately; use MxfSDK.unregisterChannelMcpServer()
     * @deprecated MCP process management is administrative and is unavailable to MxfClient/MxfAgent.
     * @public
     */
    public async unregisterChannelMcpServer(serverId: string, channelId?: string): Promise<void> {
        const scope = channelId || this.channelId || 'unspecified channel';
        throw new AgentMcpProcessManagementError(
            `Unregistering channel MCP server '${serverId}' from '${scope}'`
        );
    }

    /**
     * Register a callback for task completion events
     * @param callback Function to call when a task is completed
     * @public
     */
    public onTaskCompleted(callback: (taskData: any) => void): void {
        this.mxfService?.onTaskCompleted(callback);
    }

    /**
     * Register a callback for task failure events
     * @param callback Function to call when a task fails
     * @public
     */
    public onTaskFailed(callback: (taskData: any) => void): void {
        this.mxfService?.onTaskFailed(callback);
    }

    /**
     * Register a callback for task cancellation events
     * @param callback Function to call when a task is cancelled
     * @public
     */
    public onTaskCancelled(callback: (taskData: any) => void): void {
        this.mxfService?.onTaskCancelled(callback);
    }

    /**
     * Register a callback for task assignment events
     * @param callback Function to call when a task is assigned
     * @public
     */
    public onTaskAssigned(callback: (taskData: any) => void): void {
        this.mxfService?.onTaskAssigned(callback);
    }

    /**
     * Register a callback for task start events
     * @param callback Function to call when a task starts
     * @public
     */
    public onTaskStarted(callback: (taskData: any) => void): void {
        this.mxfService?.onTaskStarted(callback);
    }

    /**
     * Register a callback for task progress events
     * @param callback Function to call when task progress is updated
     * @public
     */
    public onTaskProgressUpdated(callback: (taskData: any) => void): void {
        this.mxfService?.onTaskProgressUpdated(callback);
    }

    /**
     * Clear all task event callbacks
     * @public
     */
    public clearTaskEventCallbacks(): void {
        this.mxfService?.clearTaskEventCallbacks();
    }

    // ==================== PUBLIC EVENT API ====================

    /**
     * Listen to a public event.
     *
     * Only events in the PUBLIC_EVENTS whitelist can be listened to. Internal
     * framework events are not exposed.
     *
     * The handler is typed from the event name: `PayloadOf<E>` resolves to the
     * event's real payload, so `agent.on(Events.Task.ASSIGNED, task => ...)` gives
     * you a typed `task` instead of `any`.
     *
     * @param eventName - Public event name from the Events namespace
     * @param handler - Event handler, typed from the event name
     * @returns This agent instance for method chaining
     * @throws Error if the event is not in the public whitelist. It previously only
     *         logged a warning through a client Logger that is disabled by default
     *         and then silently ignored the listener, so a typo'd event name meant a
     *         handler that never fired and no feedback at all.
     *
     * @example
     * ```typescript
     * agent.on(Events.Message.CHANNEL_MESSAGE, (message) => {
     *     console.log('Received:', message.data);
     * });
     *
     * agent.on(Events.Task.ASSIGNED, (task) => {
     *     console.log('New task:', task.data.taskId);
     * });
     * ```
     */
    public on<E extends PublicEventName>(
        eventName: E,
        handler: (payload: PayloadOf<E>) => void
    ): this {
        if (!isPublicEvent(eventName)) {
            const category = getEventCategory(eventName as any);
            throw new Error(
                `Event '${eventName}' is not in the public whitelist and cannot be listened to. ` +
                `It looks like an internal ${category} event. ` +
                `Use an event from the Events namespace that appears in PUBLIC_EVENTS.`
            );
        }

        const subscription = EventBus.client.on(eventName, handler);

        // Keep the handler next to its subscription so off(event, handler) can find it.
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push({
            handler: handler as (data: any) => void,
            subscription,
        });

        return this; // Allow chaining
    }

    /**
     * Remove an event listener.
     *
     * Passing a handler removes exactly that handler; omitting it removes every
     * handler registered for the event. Removing a single handler is fully
     * supported — this used to warn that it wasn't and then do nothing.
     *
     * @param eventName - Public event name
     * @param handler - Handler to remove. Omit to remove all handlers for the event.
     * @returns This agent instance for method chaining
     *
     * @example
     * ```typescript
     * const messageHandler = (msg) => console.log(msg);
     * agent.on(Events.Message.CHANNEL_MESSAGE, messageHandler);
     *
     * // Remove that one handler
     * agent.off(Events.Message.CHANNEL_MESSAGE, messageHandler);
     *
     * // Or remove every handler for the event
     * agent.off(Events.Message.CHANNEL_MESSAGE);
     * ```
     */
    public off<E extends PublicEventName>(
        eventName: E,
        handler?: (payload: PayloadOf<E>) => void
    ): this {
        const entries = this.eventListeners.get(eventName);
        if (!entries) {
            return this;
        }

        if (handler) {
            const index = entries.findIndex(entry => entry.handler === handler);
            if (index !== -1) {
                entries[index].subscription.unsubscribe();
                entries.splice(index, 1);
            }
            if (entries.length === 0) {
                this.eventListeners.delete(eventName);
            }
        } else {
            entries.forEach(entry => entry.subscription.unsubscribe());
            this.eventListeners.delete(eventName);
        }

        return this;
    }

    /**
     * Remove every listener registered through on().
     *
     * @returns This agent instance for method chaining
     * @public
     */
    public removeAllListeners(): this {
        for (const entries of this.eventListeners.values()) {
            entries.forEach(entry => entry.subscription.unsubscribe());
        }
        this.eventListeners.clear();
        return this;
    }

    /**
     * Emit a public event.
     *
     * Most events are emitted by the framework itself; this exists for custom
     * emission in advanced scenarios.
     *
     * @param eventName - Public event name
     * @param payload - Event payload, typed from the event name. Build it with a
     *                  helper from EventPayloadSchema.
     * @returns This agent instance for method chaining
     * @throws Error if the event is not in the public whitelist. It previously only
     *         warned and silently dropped the emit.
     *
     * @example
     * ```typescript
     * import { createAgentEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
     *
     * agent.emit(
     *     Events.Agent.STATUS_CHANGE,
     *     createAgentEventPayload(Events.Agent.STATUS_CHANGE, agent.agentId, channelId, { status: 'busy' })
     * );
     * ```
     */
    public emit<E extends PublicEventName>(eventName: E, payload: PayloadOf<E>): this {
        if (!isPublicEvent(eventName)) {
            const category = getEventCategory(eventName as any);
            throw new Error(
                `Event '${eventName}' is not in the public whitelist and cannot be emitted. ` +
                `It looks like an internal ${category} event. ` +
                `Use an event from the Events namespace that appears in PUBLIC_EVENTS.`
            );
        }

        EventBus.client.emitOn(this.agentId, eventName, payload);
        return this;
    }
}
