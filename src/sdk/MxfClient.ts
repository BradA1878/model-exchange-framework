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
 * Agent Class for the MXF
 * 
 * Provides a client-side interface for creating and connecting agents
 * to the MXF.
 */

import { v4 as uuidv4 } from 'uuid';
import { ConnectionStatus } from '../shared/types/types';
import { ChannelConnectionConfig } from '../shared/interfaces/ChannelConnectionConfig';
import { buildServerUrl, getServerConfig } from './config';
import { Logger } from '../shared/utils/Logger';
import { Events } from '../shared/events/EventNames';
import { EventBus } from '../shared/events/EventBus';
import { PublicEventName, isPublicEvent, getEventCategory } from '../shared/events/PublicEvents';
import { AgentContext, ApiService } from './services/MxfApiService';
import { createStrictValidator } from '../shared/utils/validation';
import { AgentEventPayload, AgentEventData, BaseEventPayload, BaseMemoryOperationData } from '../shared/schemas/EventPayloadSchema';
import { SimpleTaskResponse, TaskRequestHandler } from '../shared/interfaces/TaskInterfaces';
import { AgentConfig, InternalAgentConfig } from '../shared/interfaces/AgentInterfaces';
import { MxfService } from './services/MxfService';
import { McpToolHandlers } from './handlers/McpToolHandlers';
import { McpResourceHandlers } from './handlers/McpResourceHandlers';
import { ControlLoopHandlers } from './handlers/ControlLoopHandlers';
import { MemoryHandlers } from './handlers/MemoryHandlers';
import { MessageHandlers } from './handlers/MessageHandlers';
import { IAgentMemory, IChannelMemory, IRelationshipMemory, MemoryScope } from '../shared/types/MemoryTypes';
import { TaskHandlers } from './handlers/TaskHandlers';
import { MxfToolService, IToolService, ClientTool } from './services/MxfToolService';

/**
 * MxfClient class for connecting to the MXF
 */
export class MxfClient {

    /**
     * Static identifier for SDK version tracking 
     * Used to verify which version of the SDK is being loaded
     */
    public static readonly SDK_VERSION = "DEV-BUILD-" + new Date().toISOString();

    /** Constructor log - to verify the SDK version being loaded */
    private static readonly SDK_VERSION_IDENTIFIER = MxfClient.SDK_VERSION;

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

    // Tool service for loading tools via socket events
    protected toolService: MxfToolService | null = null;

    // Event listener subscriptions for cleanup
    private eventListeners: Map<string, any[]> = new Map();

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
            logger: this.logger
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
            this.agentId, 
            this.mxfService, 
            this.config.requestTimeoutMs, 
        );
        
        // Initialize MCP handlers
        this.mcpToolHandlers = new McpToolHandlers(this.channelId, this.agentId, this.mxfService);
        this.mcpResourceHandlers = new McpResourceHandlers(this.channelId, this.agentId);
        
        // Initialize task handlers (unless disabled for utility agents)
        if (!config.disableTaskHandling) {
            this.taskHandlers = new TaskHandlers(this.channelId, this.agentId);
        }
        
        // Initialize tool service
        this.toolService = new MxfToolService(this.agentId, this.channelId);
        
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
     * Connect to the framework server and join the specified channel
     * This method is public to allow developers to explicitly connect agents that need to listen for messages
     * Sending methods (sendMessage, sendObservation) will auto-connect if not already connected
     * @returns Promise resolving to true if connection successful
     * @public
     */
    public async connect(): Promise<boolean> {
        try {
            await this.ensureConnected();
            return true;
        } catch (error) {
            this.logger.error(`Failed to connect agent: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Disconnect from MXF
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
        this.memoryHandlers?.cleanup();
        this.toolService?.cleanup();

        // Disconnect from the channel service
        this.mxfService?.disconnect();

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

        // Emit event to update server-side AgentService
        if (this.mxfService) {
            this.mxfService.socketEmit(Events.Agent.ALLOWED_TOOLS_UPDATE, {
                agentId: this.agentId,
                allowedTools: tools
            });
        }

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
     * Register the agent with the hub
     * 
     * @param options Registration options
     * @returns Promise resolving to true if registration was successful
     * @private
     */
    private async register(options: { 
        agentId?: string; 
        name?: string; 
        type?: string; 
        capabilities?: string[];
        channelId?: string;
        metadata?: Record<string, any>;
    }): Promise<boolean> {
        
        // If we're already registered, just return true
        if (this.status === ConnectionStatus.REGISTERED) {
            return true;
        }
        
        // Build a valid agent ID and name
        const agentId = this.config.agentId;
        const name = options.name || this.config.name;
        
        // Return a promise that resolves when registration is complete
        return new Promise<boolean>((resolve, reject) => {
            // Handle registration success
            const onRegistered = (registered: any) => {
                if (registered.agentId === agentId) {
                    this.status = ConnectionStatus.REGISTERED;
                    this.emitStatusChange(this.status);
                    
                    // Clean up subscriptions properly
                    registeredSubscription.unsubscribe();
                    registrationFailedSubscription.unsubscribe();
                    
                    // Clear registration timeout
                    clearTimeout(registrationTimeout);
                    
                    resolve(true);
                }
            };
            
            // Handle registration failure
            const onError = (error: any) => {
                if (error.agentId === agentId) {
                    this.logger.error(`Agent ${agentId} registration failed: ${error.error}`);
                    this.status = ConnectionStatus.ERROR;
                    this.emitStatusChange(this.status);
                    
                    // Clean up subscriptions properly
                    registeredSubscription.unsubscribe();
                    registrationFailedSubscription.unsubscribe();
                    
                    // Clear registration timeout
                    clearTimeout(registrationTimeout);
                    
                    reject(new Error(error.error));
                }
            };
            
            // Listen for registration events using RxJS subscriptions
            const registeredSubscription = EventBus.client.on(Events.Agent.REGISTERED, onRegistered);
            
            // Listen for registration failed events
            const registrationFailedSubscription = EventBus.client.on(Events.Agent.REGISTRATION_FAILED, onError);
            
            if (options.channelId && typeof options.channelId !== 'string') {
                throw new Error('options.channelId must be a string if provided');
            }
            const eventChannelId = options.channelId || this.config.channelId;
            const agentDataForRegistration: AgentEventData = {
                name: name,
                type: options.type,
                capabilities: options.capabilities || this.config.capabilities || ['basic'],
                allowedTools: this.config.allowedTools, // Include allowedTools in registration - don't default to []
                metadata: options.metadata || this.config.metadata,
                status: 'registering' // Indicate the action
            };


            const registrationPayload: AgentEventPayload = {
                eventId: uuidv4(),
                eventType: Events.Agent.REGISTER,
                timestamp: Date.now(),
                agentId: this.agentId,
                channelId: eventChannelId,
                data: agentDataForRegistration
            };

            // Set a timeout for registration
            const registrationTimeout = setTimeout(() => {
                this.logger.error(`register() - Registration timed out after 10 seconds`);
                
                // Clean up subscriptions properly
                registeredSubscription.unsubscribe();
                registrationFailedSubscription.unsubscribe();
                
                // Update status
                this.status = ConnectionStatus.ERROR;
                this.emitStatusChange(this.status);
                
                reject(new Error('[REJECT] register() - Registration timed out after 10 seconds'));
            }, 10000);

            EventBus.client.emit(Events.Agent.REGISTER, registrationPayload);
        });
    }

    /**
     * Initialize event handlers
     */
    protected initializeEventHandlers(): void {
        
        
        // Listen for connection events
        EventBus.client.on(Events.Agent.CONNECTED, (data: any) => {
            if (data && data.agentId === this.config.agentId) {
                //;
                this.status = ConnectionStatus.CONNECTED;
                this.emitStatusChange(this.status);
            }
        });

        // Listen for disconnect events
        EventBus.client.on(Events.Agent.DISCONNECTED, (data: any) => {
            if (data && data.agentId === this.config.agentId) {
                //;
                this.status = ConnectionStatus.DISCONNECTED;
                this.emitStatusChange(this.status);
            }
        });

        // Listen for error events
        EventBus.client.on(Events.Agent.ERROR, (data: any) => {
            if (data && data.agentId === this.config.agentId) {
                this.status = ConnectionStatus.ERROR;
                this.emitStatusChange(this.status);
            }
        });
        
        // Track registration events
        EventBus.client.on(Events.Agent.REGISTERED as string, (data: any) => {
            if (data && data.agentId === this.config.agentId) {
                
                // Update status
                if (this.status !== ConnectionStatus.REGISTERED) {
                    this.status = ConnectionStatus.REGISTERED;
                    this.emitStatusChange(this.status);
                }
            }
        });
        
        this.controlLoopHandlers?.initialize();
        this.taskHandlers?.initialize();
        
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
     * @returns Promise resolving to agent memory or null if socket is not available
     * @protected
     */
    protected async getMemory(): Promise<IAgentMemory | null> {
        await this.ensureConnected();
        this.validator.assert(!!this.memoryHandlers, 'Memory Handlers not initialized.');
        if (!this.memoryHandlers) return null; // Type guard

        if (!this.getSocketConnected()) {
            this.logger.warn('Socket not connected. Cannot get agent memory.');
            return null;
        }
        return this.memoryHandlers.getAgentMemory();
    }

    /**
     * Update agent memory on the server using socket connection
     * @param update Memory update data
     * @returns Promise resolving to updated agent memory or null if socket is not available
     * @protected
     */
    protected async updateMemory(update: Partial<IAgentMemory>): Promise<IAgentMemory | null> {
        await this.ensureConnected();
        this.validator.assert(!!this.memoryHandlers, 'Memory Handlers not initialized.');
        if (!this.memoryHandlers) return null; // Type guard

        if (!this.getSocketConnected()) {
            this.logger.warn('Socket not connected. Cannot update agent memory.');
            return null;
        }
        return this.memoryHandlers.updateAgentMemory(update);
    }

    /**
     * Add a note to agent memory
     * @param key Note key
     * @param value Note value
     * @returns Promise resolving to updated agent memory or null if API service is not available
     * @protected
     */
    protected async addNote(key: string, value: any): Promise<IAgentMemory | null> {
        await this.ensureConnected();
        this.validator.assert(!!this.memoryHandlers, 'MemoryHandlers should be initialized');
        if (!this.memoryHandlers) return null; // Type guard

        return await this.memoryHandlers.addNote(key, value);
    }

    /**
     * Add conversation entry to agent memory
     * @param entry Conversation entry to add
     * @returns Promise resolving to updated agent memory or null if API service is not available
     * @protected
     */
    protected async addToConversationHistory(entry: any): Promise<IAgentMemory | null> {
        await this.ensureConnected();
        this.validator.assert(!!this.memoryHandlers, 'MemoryHandlers should be initialized');
        if (!this.memoryHandlers) return null; // Type guard

        return await this.memoryHandlers.addToConversationHistory(entry);
    }

    /**
     * Get or create relationship memory between this agent and another agent
     * @param otherAgentId The other agent ID for the relationship
     * @param channelId Optional channel ID to scope the relationship to
     * @returns Promise resolving to relationship memory or null if API service is not available
     * @protected
     */
    protected async getRelationshipMemory(otherAgentId: string, channelId?: string): Promise<IRelationshipMemory | null> {
        await this.ensureConnected();
        this.validator.assert(!!this.memoryHandlers, 'Memory Handlers not initialized.');
        if (!this.memoryHandlers) return null;

        if (!this.getSocketConnected()) {
            this.logger.warn('Socket not connected. Cannot get relationship memory.');
            return null;
        }
        // Ensure channelId is a string if provided, otherwise undefined for the handler
        const effectiveChannelId = typeof channelId === 'string' && channelId.trim() !== '' ? channelId : undefined;
        return this.memoryHandlers.getRelationshipMemory(otherAgentId, effectiveChannelId);
    }

    /**
     * Update relationship memory with new data
     * @param otherAgentId The other agent ID for the relationship
     * @param update Memory fields to update
     * @param channelId Optional channel ID to scope the relationship to
     * @returns Promise resolving to updated relationship memory or null if API service is not available
     * @protected
     */
    protected async updateRelationshipMemory(
        otherAgentId: string, 
        update: Partial<IRelationshipMemory>, 
        channelId?: string
    ): Promise<IRelationshipMemory | null> {
        await this.ensureConnected();
        this.validator.assert(!!this.memoryHandlers, 'Memory Handlers not initialized.');
        if (!this.memoryHandlers) return null;

        if (!this.getSocketConnected()) {
            this.logger.warn('Socket not connected. Cannot update relationship memory.');
            return null;
        }
        const effectiveChannelId = typeof channelId === 'string' && channelId.trim() !== '' ? channelId : undefined;
        return this.memoryHandlers.updateRelationshipMemory(otherAgentId, update, effectiveChannelId);
    }

    /**
     * Get or create channel memory for a specific channel
     * @param channelId The channel ID to get memory for
     * @returns Promise resolving to channel memory or null if API service is not available
     * @protected
     */
    protected async getChannelMemory(channelId: string): Promise<IChannelMemory | null> {
        await this.ensureConnected();
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID cannot be empty for getChannelMemory.');
        this.validator.assert(!!this.memoryHandlers, 'Memory Handlers not initialized.');
        if (!this.memoryHandlers) return null;

        if (!this.getSocketConnected()) {
            this.logger.warn('Socket not connected. Cannot get channel memory.');
            return null;
        }
        return this.memoryHandlers.getChannelMemory(channelId);
    }

    /**
     * Update channel memory with new data
     * @param channelId The channel ID to update memory for
     * @param update Memory fields to update
     * @returns Promise resolving to updated channel memory or null if API service is not available
     * @protected
     */
    protected async updateChannelMemory(channelId: string, update: Partial<IChannelMemory>): Promise<IChannelMemory | null> {
        await this.ensureConnected();
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID cannot be empty for updateChannelMemory.');
        this.validator.assert(!!this.memoryHandlers, 'Memory Handlers not initialized.');
        if (!this.memoryHandlers) return null;

        if (!this.getSocketConnected()) {
            this.logger.warn('Socket not connected. Cannot update channel memory.');
            return null;
        }
        return this.memoryHandlers.updateChannelMemory(channelId, update);
    }

    /**
     * Delete a memory entry based on its scope and ID.
     * @param scope The scope of the memory (AGENT, CHANNEL, RELATIONSHIP).
     * @param id The primary identifier for the memory entry.
     *           For AGENT scope, this is typically the agent's own ID (though not directly used by the handler method).
     *           For CHANNEL scope, this is the channelId.
     *           For RELATIONSHIP scope, this is the otherAgentId.
     * @param secondaryId Optional secondary identifier, used as channelId for RELATIONSHIP scope.
     * @returns Promise resolving to true if deletion was successful, false otherwise.
     * @protected
     */
    protected async deleteMemoryEntry(
        scope: MemoryScope,
        id: string, // For AGENT, this is agentId; for CHANNEL, channelId; for RELATIONSHIP, otherAgentId
        secondaryId?: string // For RELATIONSHIP, this is channelId
    ): Promise<boolean> {
        await this.ensureConnected();
        this.validator.assert(!!this.memoryHandlers, 'Memory Handlers not initialized.');
        if (!this.memoryHandlers) return false;

        if (!this.getSocketConnected()) {
            this.logger.warn('Socket not connected. Cannot delete memory entry.');
            return false;
        }

        this.validator.assertIsNonEmptyString(id, 'Primary ID cannot be empty for deleteMemoryEntry.');

        switch (scope) {
            case MemoryScope.AGENT:
                // The 'id' parameter (agentId) is not strictly needed by deleteAgentMemory handler,
                // as it operates on the current agent's memory by default.
                return this.memoryHandlers.deleteAgentMemory();
            case MemoryScope.CHANNEL:
                this.validator.assertIsNonEmptyString(id, 'Channel ID cannot be empty for CHANNEL scope deletion.');
                return this.memoryHandlers.deleteChannelMemory(id); // id is channelId
            case MemoryScope.RELATIONSHIP:
                this.validator.assertIsNonEmptyString(id, 'Other Agent ID cannot be empty for RELATIONSHIP scope deletion.');
                // secondaryId is the optional channelId for the relationship
                return this.memoryHandlers.deleteRelationshipMemory(id, secondaryId); // id is otherAgentId
            default:
                this.logger.error(`Unknown memory scope for deletion: ${scope}`);
                return false;
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
     * Send multiple channel messages efficiently in bulk (public API)
     * 
     * @param channelId The channel ID to send the messages to
     * @param type The type of messages to send
     * @param messages Array of message contents
     * @returns Promise that resolves when all messages are sent
     * @public
     */
    public async sendMessages(channelId: string, type: string, messages: any[]): Promise<boolean> {
        try {
            await this.ensureConnected();
            
            if (!messages || messages.length === 0) {
                this.logger.warn('No messages provided to sendMessages');
                return true;
            }


            // Convert messages to ChannelMessage format
            const channelMessages = messages.map(content => {
                const messageId = require('uuid').v4();
                const timestamp = Date.now();
                
                return {
                    senderId: this.agentId,
                    content: {
                        format: 'text' as const,
                        data: content
                    },
                    metadata: {
                        messageId: messageId,
                        timestamp: timestamp,
                        type: type,
                        messageType: type
                    },
                    context: {
                        channelId: channelId,
                        channelContextType: 'CONVERSATION_HISTORY' as const
                    }
                };
            });

            // Emit bulk persistence request event
            EventBus.client.emit('PERSIST_BULK_CHANNEL_MESSAGES_REQUEST', {
                eventId: require('uuid').v4(),
                eventType: 'PERSIST_BULK_CHANNEL_MESSAGES_REQUEST',
                agentId: this.agentId,
                channelId: channelId,
                timestamp: Date.now(),
                data: {
                    channelId: channelId,
                    messages: channelMessages
                }
            });

            return true;

        } catch (error) {
            this.logger.error(`Failed to send ${messages.length} messages in bulk:`, error instanceof Error ? error.message : String(error));
            return false;
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
     * Properly emit a status change event using the standardized payload format
     * @param status - The status to emit
     */
    private emitStatusChange(status: ConnectionStatus): void {
        // Use the proper EventPayloadSchema format for the event
        const agentDataForStatusChange: AgentEventData = { status: status as string };
        const payload: AgentEventPayload = {
            eventId: require('uuid').v4(),
            eventType: Events.Agent.STATUS_CHANGE,
            timestamp: Date.now(),
            agentId: this.agentId,
            channelId: this.config.channelId,
            data: agentDataForStatusChange
        };

        EventBus.client.emit(Events.Agent.STATUS_CHANGE, payload);
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
     * Send a heartbeat message to the server
     * @private
     */
    private sendHeartbeat(): void {
        try {
            if (!this.isFullyConnected) {
                return;
            }

            const heartbeatPayload = {
                eventId: uuidv4(),
                eventType: 'heartbeat',
                timestamp: Date.now(),
                agentId: this.agentId,
                channelId: this.config.channelId || 'system',
                data: {
                    clientTimestamp: Date.now()
                }
            };

            EventBus.client.emit('heartbeat', heartbeatPayload);
        } catch (error) {
            this.logger.error(`Error sending heartbeat: ${error}`);
        }
    }

    /**
     * Internal method to handle socket connection and agent registration
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
        
        
        // Connect to the socket and wait for completion
        await new Promise<void>((resolve, reject) => {
            // Track both events before resolving
            let registeredReceived = false;
            let connectedReceived = false;
            
            const checkBothEventsReceived = (): void => {
                if (registeredReceived && connectedReceived) {
                    // Clean up all event listeners
                    registeredSubscription.unsubscribe();
                    registrationFailedSubscription.unsubscribe();
                    
                    // Clear timeout
                    clearTimeout(timeout);
                    
                    // Resolve the promise
                    resolve();
                }
            };
            
            // Listen for agent registered event
            const registeredSubscription = EventBus.client.on(Events.Agent.REGISTERED, (data: any) => {
                if (data && data.agentId === this.config.agentId) {
                    
                    // Update internal status
                    this.status = ConnectionStatus.REGISTERED;
                    this.emitStatusChange(this.status);
                    
                    // Mark registered as received
                    registeredReceived = true;
                    checkBothEventsReceived();
                } else {
                }
            });
            
            const registrationFailedSubscription = EventBus.client.on(Events.Agent.REGISTRATION_FAILED, (data: any) => {
                this.logger.error(`Registration failed event received: ${JSON.stringify(data)}`);
                
                if (data && data.agentId === this.config.agentId) {
                    this.logger.error(`Agent ${this.config.agentId} registration failed: ${data.error || 'Unknown error'}`);
                    
                    // Update status
                    this.status = ConnectionStatus.ERROR;
                    this.emitStatusChange(this.status);
                    
                    // Clean up event listeners
                    registeredSubscription.unsubscribe();
                    registrationFailedSubscription.unsubscribe();
                    
                    // Clear timeout
                    clearTimeout(timeout);
                    
                    reject(new Error(`Agent registration failed: ${data.error || 'Unknown error'}`));
                } else {
                }
            });
            
            // Listen for the connected event
            const connectedSubscription = EventBus.client.on(Events.Agent.CONNECTED, (data: any) => {
                if (data && data.agentId === this.config.agentId) {
                    
                    // Update status to connected
                    this.status = ConnectionStatus.CONNECTED;
                    this.emitStatusChange(this.status);
                    
                    // Mark connected as received
                    connectedReceived = true;
                    checkBothEventsReceived();
                }
            });
            
            // Set registration timeout
            const timeout = setTimeout(() => {
                this.logger.error(`connectSocketAndRegister() - Registration timed out after 10 seconds`);
                
                // Clean up event listeners
                registeredSubscription.unsubscribe();
                registrationFailedSubscription.unsubscribe();
                
                // Update status
                this.status = ConnectionStatus.ERROR;
                this.emitStatusChange(this.status);
                
                reject(new Error('[REJECT] connectSocketAndRegister() - Registration timed out after 10 seconds'));
            }, 10000);

            // Initialize the channel socket connection
            this.mxfService.setAgentId(this.config.agentId);
            this.mxfService.connect().then(async () => {
                
                // Now trigger agent registration with capabilities via EventBus
                try {
                    
                    const agentDataForRegistration = {
                        name: this.config.name,
                        type: 'agent',
                        capabilities: this.config.capabilities || ['basic'],
                        allowedTools: this.config.allowedTools, // Add allowedTools to registration - don't default to []
                        metadata: this.config.metadata,
                        status: 'registering'
                    };
                    

                    const registrationPayload = {
                        eventId: uuidv4(),
                        eventType: Events.Agent.REGISTER,
                        timestamp: Date.now(),
                        agentId: this.config.agentId,
                        channelId: this.config.channelId,
                        data: agentDataForRegistration
                    };

                    EventBus.client.emit(Events.Agent.REGISTER, registrationPayload);
                } catch (regError) {
                    this.logger.error(`Failed to send agent registration event:`, regError);
                    
                    // Clean up event listeners
                    registeredSubscription.unsubscribe();
                    registrationFailedSubscription.unsubscribe();
                    
                    // Clear timeout
                    clearTimeout(timeout);
                    
                    // Update status
                    this.status = ConnectionStatus.ERROR;
                    this.emitStatusChange(this.status);
                    
                    reject(regError);
                    return;
                }
                
            }).catch(error => {
                this.logger.error(`Channel service socket connection failed:`, error);
                
                // Clean up event listeners
                registeredSubscription.unsubscribe();
                registrationFailedSubscription.unsubscribe();
                
                // Clear timeout
                clearTimeout(timeout);
                
                // Update status
                this.status = ConnectionStatus.ERROR;
                this.emitStatusChange(this.status);
                
                reject(error);
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
     * @returns Promise resolving to true if registration was successful
     * @public
     */
    public async registerTool(tool: any, channelId?: string): Promise<boolean> {
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
        
        return this.mcpToolHandlers.registerTool(tool, targetChannelId);
    }
    
    /**
     * Register an external MCP server
     *
     * This allows developers to add their own MCP servers to MXF dynamically.
     * The server will be started and its tools will become available to agents.
     *
     * @param serverConfig External server configuration
     * @returns Promise resolving to true if registration was successful
     * @public
     *
     * @example
     * ```typescript
     * await sdk.registerExternalMcpServer({
     *   id: 'my-custom-server',
     *   name: 'My Custom Server',
     *   command: 'npx',
     *   args: ['-y', 'my-mcp-package'],
     *   autoStart: true
     * });
     * ```
     */
    public async registerExternalMcpServer(serverConfig: {
        id: string;
        name: string;
        command?: string;
        args?: string[];
        transport?: 'stdio' | 'http';
        url?: string;
        autoStart?: boolean;
        environmentVariables?: Record<string, string>;
        restartOnCrash?: boolean;
        maxRestartAttempts?: number;
    }): Promise<{ success: boolean; toolsDiscovered?: string[] }> {
        await this.ensureConnected();

        return new Promise((resolve, reject) => {
            try {

                let registrationCompleted = false;

                // Set up handler for registration response
                const registrationSubscription = EventBus.client.on(Events.Mcp.EXTERNAL_SERVER_REGISTERED, (payload: any) => {
                    if (payload.data?.serverId === serverConfig.id && !registrationCompleted) {
                        if (!payload.data?.success) {
                            registrationSubscription.unsubscribe();
                            errorSubscription.unsubscribe();
                            toolsSubscription.unsubscribe();
                            this.logger.error(`Failed to register server ${serverConfig.name}`);
                            resolve({ success: false });
                        }
                        // Don't resolve yet - wait for tools to be discovered
                    }
                });

                // Set up handler for tool discovery (this is when we know it's ready)
                const toolsSubscription = EventBus.client.on(Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED, (payload: any) => {
                    // Check if this is for our server (match by checking if discovered tools match our server)
                    // Since we don't have serverId in this event, we'll use a timeout-based approach
                    if (!registrationCompleted) {
                        const discoveredTools = payload.data?.tools?.map((t: any) => t.name) || [];

                        // If we're the only server being registered, assume these are our tools
                        // Better approach: add serverId to TOOLS_DISCOVERED event
                        registrationCompleted = true;
                        registrationSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        toolsSubscription.unsubscribe();


                        // Reload tool cache BEFORE resolving promise
                        if (this.toolService) {
                            this.toolService.loadTools(undefined, true).then((tools) => {  // force=true to bypass cache
                                resolve({ success: true, toolsDiscovered: discoveredTools });
                            }).catch(err => {
                                this.logger.error(`❌ Failed to refresh tool cache: ${err}`);
                                resolve({ success: true, toolsDiscovered: discoveredTools }); // Still resolve, tools might work
                            });
                        } else {
                            this.logger.warn('No toolService available - tool cache not refreshed');
                            resolve({ success: true, toolsDiscovered: discoveredTools });
                        }
                    }
                });

                // Set up error handler
                const errorSubscription = EventBus.client.on(Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED, (payload: any) => {
                    if (payload.data?.serverId === serverConfig.id && !registrationCompleted) {
                        registrationCompleted = true;
                        registrationSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        toolsSubscription.unsubscribe();

                        this.logger.error(`Server registration failed: ${payload.data?.error || 'Unknown error'}`);
                        reject(new Error(payload.data?.error || 'Server registration failed'));
                    }
                });

                // Emit registration request
                const registrationPayload = {
                    eventId: uuidv4(),
                    eventType: Events.Mcp.EXTERNAL_SERVER_REGISTER,
                    timestamp: Date.now(),
                    agentId: this.config.agentId || 'sdk-user',
                    channelId: this.channelId || 'system',
                    data: serverConfig
                };

                EventBus.client.emit(Events.Mcp.EXTERNAL_SERVER_REGISTER, registrationPayload);

                // Timeout after 30 seconds
                setTimeout(() => {
                    if (!registrationCompleted) {
                        registrationCompleted = true;
                        registrationSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        toolsSubscription.unsubscribe();
                        reject(new Error('External server registration timeout after 30 seconds (tools not discovered)'));
                    }
                }, 30000);

            } catch (error) {
                this.logger.error(`Error registering external server: ${error}`);
                reject(error);
            }
        });
    }

    /**
     * Unregister an external MCP server
     *
     * Stops and removes an external MCP server from MXF.
     *
     * @param serverId ID of the server to unregister
     * @returns Promise resolving to true if unregistration was successful
     * @public
     */
    public async unregisterExternalMcpServer(serverId: string): Promise<boolean> {
        await this.ensureConnected();

        return new Promise((resolve, reject) => {
            try {

                // Set up one-time handler for response
                const subscription = EventBus.client.on(Events.Mcp.EXTERNAL_SERVER_UNREGISTERED, (payload: any) => {
                    if (payload.data?.serverId === serverId) {
                        subscription.unsubscribe();

                        if (payload.data?.success) {
                            resolve(true);
                        } else {
                            this.logger.error(`Failed to unregister server ${serverId}: ${payload.data?.error || 'Unknown error'}`);
                            resolve(false);
                        }
                    }
                });

                // Emit unregistration request
                const unregistrationPayload = {
                    eventId: uuidv4(),
                    eventType: Events.Mcp.EXTERNAL_SERVER_UNREGISTER,
                    timestamp: Date.now(),
                    agentId: this.config.agentId || 'sdk-user',
                    channelId: this.channelId || 'system',
                    data: { serverId }
                };

                EventBus.client.emit(Events.Mcp.EXTERNAL_SERVER_UNREGISTER, unregistrationPayload);

                // Timeout after 30 seconds
                setTimeout(() => {
                    subscription.unsubscribe();
                    reject(new Error('External server unregistration timeout after 30 seconds'));
                }, 30000);

            } catch (error) {
                this.logger.error(`Error unregistering external server: ${error}`);
                reject(error);
            }
        });
    }

    /**
     * Register a channel-scoped MCP server
     *
     * This allows all agents in a channel to share the same MCP server instance.
     * The server is automatically started when the first agent joins and stopped
     * after a keepAlive period when the last agent leaves.
     *
     * @param serverConfig Channel server configuration
     * @returns Promise resolving to registration result
     * @public
     *
     * @example
     * ```typescript
     * await client.registerChannelMcpServer({
     *   id: 'chess-game',
     *   name: 'Chess Game Server',
     *   command: 'npx',
     *   args: ['-y', '@mcp/chess'],
     *   keepAliveMinutes: 10
     * });
     * ```
     */
    public async registerChannelMcpServer(serverConfig: {
        id: string;
        name: string;
        command?: string;
        args?: string[];
        transport?: 'stdio' | 'http';
        url?: string;
        autoStart?: boolean;
        environmentVariables?: Record<string, string>;
        restartOnCrash?: boolean;
        maxRestartAttempts?: number;
        keepAliveMinutes?: number;
    }): Promise<{ success: boolean; toolsDiscovered?: string[] }> {
        await this.ensureConnected();

        if (!this.channelId) {
            throw new Error('Cannot register channel MCP server: agent not in a channel');
        }

        return new Promise((resolve, reject) => {
            try {
                const { McpEvents } = require('../shared/events/event-definitions/McpEvents');

                let registrationCompleted = false;

                // Set up handler for registration response
                const registrationSubscription = EventBus.client.on(McpEvents.CHANNEL_SERVER_REGISTERED, (payload: any) => {
                    if (payload.data?.serverId === serverConfig.id &&
                        payload.data?.scopeId === this.channelId &&
                        !registrationCompleted) {

                        if (!payload.data?.success) {
                            registrationSubscription.unsubscribe();
                            errorSubscription.unsubscribe();
                            toolsSubscription.unsubscribe();
                            this.logger.error(`Failed to register channel server ${serverConfig.name}`);
                            resolve({ success: false });
                        }
                        // Don't resolve yet - wait for tools to be discovered
                    }
                });

                // Set up handler for tool discovery
                const toolsSubscription = EventBus.client.on(Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED, (payload: any) => {
                    if (!registrationCompleted) {
                        const discoveredTools = payload.data?.tools?.map((t: any) => t.name) || [];

                        registrationCompleted = true;
                        registrationSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        toolsSubscription.unsubscribe();

                        // Reload tool cache
                        if (this.toolService) {
                            this.toolService.loadTools(undefined, true).then(() => {
                                resolve({ success: true, toolsDiscovered: discoveredTools });
                            }).catch(err => {
                                this.logger.error(`❌ Failed to refresh tool cache: ${err}`);
                                resolve({ success: true, toolsDiscovered: discoveredTools });
                            });
                        } else {
                            resolve({ success: true, toolsDiscovered: discoveredTools });
                        }
                    }
                });

                // Set up error handler
                const errorSubscription = EventBus.client.on(McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED, (payload: any) => {
                    if (payload.data?.serverId === serverConfig.id &&
                        payload.data?.scopeId === this.channelId &&
                        !registrationCompleted) {

                        registrationCompleted = true;
                        registrationSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        toolsSubscription.unsubscribe();

                        this.logger.error(`Channel server registration failed: ${payload.data?.error || 'Unknown error'}`);
                        reject(new Error(payload.data?.error || 'Channel server registration failed'));
                    }
                });

                // Emit registration request
                const registrationPayload = {
                    eventId: uuidv4(),
                    eventType: McpEvents.CHANNEL_SERVER_REGISTER,
                    timestamp: Date.now(),
                    agentId: this.config.agentId || 'sdk-user',
                    channelId: this.channelId,
                    data: {
                        ...serverConfig,
                        channelId: this.channelId
                    }
                };

                EventBus.client.emit(McpEvents.CHANNEL_SERVER_REGISTER, registrationPayload);

                // Timeout after 30 seconds
                setTimeout(() => {
                    if (!registrationCompleted) {
                        registrationCompleted = true;
                        registrationSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        toolsSubscription.unsubscribe();
                        reject(new Error('Channel server registration timeout after 30 seconds'));
                    }
                }, 30000);

            } catch (error) {
                this.logger.error(`Error registering channel server: ${error}`);
                reject(error);
            }
        });
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

        try {
            // Use REST API for read operation
            const response = await this.apiService.get(`/channels/${targetChannelId}/mcp-servers`);
            return response.servers || [];
        } catch (error) {
            this.logger.error(`Error listing channel servers: ${error}`);
            throw error;
        }
    }

    /**
     * Unregister a channel-scoped MCP server
     *
     * Stops and removes a channel-scoped MCP server from MXF.
     *
     * @param serverId ID of the server to unregister
     * @param channelId Optional channel ID (defaults to current channel)
     * @returns Promise resolving to true if unregistration was successful
     * @public
     */
    public async unregisterChannelMcpServer(serverId: string, channelId?: string): Promise<boolean> {
        await this.ensureConnected();

        const targetChannelId = channelId || this.channelId;
        if (!targetChannelId) {
            throw new Error('Cannot unregister channel MCP server: no channel specified');
        }

        return new Promise((resolve, reject) => {
            try {
                const { McpEvents } = require('../shared/events/event-definitions/McpEvents');

                // Set up one-time handler for response
                const subscription = EventBus.client.on(McpEvents.CHANNEL_SERVER_UNREGISTERED, (payload: any) => {
                    if (payload.data?.serverId === serverId && payload.data?.scopeId === targetChannelId) {
                        subscription.unsubscribe();

                        if (payload.data?.success) {
                            resolve(true);
                        } else {
                            this.logger.error(`Failed to unregister channel server ${serverId}: ${payload.data?.error || 'Unknown error'}`);
                            resolve(false);
                        }
                    }
                });

                // Emit unregistration request
                const unregistrationPayload = {
                    eventId: uuidv4(),
                    eventType: McpEvents.CHANNEL_SERVER_UNREGISTER,
                    timestamp: Date.now(),
                    agentId: this.config.agentId || 'sdk-user',
                    channelId: targetChannelId,
                    data: {
                        serverId,
                        channelId: targetChannelId
                    }
                };

                EventBus.client.emit(McpEvents.CHANNEL_SERVER_UNREGISTER, unregistrationPayload);

                // Timeout after 30 seconds
                setTimeout(() => {
                    subscription.unsubscribe();
                    reject(new Error('Channel server unregistration timeout after 30 seconds'));
                }, 30000);

            } catch (error) {
                this.logger.error(`Error unregistering channel server: ${error}`);
                reject(error);
            }
        });
    }

    /**
     * Unregister an MCP tool
     *
     * @param toolName Name of the tool to unregister
     * @param channelId Channel ID where the tool should be unregistered
     * @returns Promise resolving to true if unregistration was successful
     * @public
     */
    public async unregisterTool(toolName: string, channelId?: string): Promise<boolean> {
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
        
        return this.mcpToolHandlers.unregisterTool(toolName, targetChannelId);
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
     * Listen to a public event
     * 
     * Only events in the PUBLIC_EVENTS whitelist can be listened to.
     * Internal/sensitive framework events are blocked for security.
     * 
     * @param eventName - Public event name from Events namespace
     * @param handler - Event handler function
     * @returns This agent instance for method chaining
     * @throws Error if event is not in public whitelist
     * 
     * @example
     * ```typescript
     * agent.on(Events.Message.CHANNEL_MESSAGE, (message) => {
     *     console.log('Received:', message.content);
     * });
     * 
     * agent.on(Events.Task.ASSIGNED, (task) => {
     *     console.log('New task:', task.taskId);
     * });
     * ```
     */
    public on(eventName: PublicEventName, handler: (data: any) => void): this {
        // Validate event is in public whitelist
        if (!isPublicEvent(eventName)) {
            const category = getEventCategory(eventName as any);
            this.logger.warn(
                `Event '${eventName}' is not in the public whitelist. ` +
                `Only events from PUBLIC_EVENTS can be monitored. ` +
                `This appears to be an internal ${category} event. Ignoring listener.`
            );
            return this;
        }

        // Subscribe to event through EventBus
        const subscription = EventBus.client.on(eventName, handler);

        // Track subscription for cleanup
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(subscription);

        return this; // Allow chaining
    }

    /**
     * Remove an event listener
     * 
     * @param eventName - Public event name
     * @param handler - Handler function to remove (optional, removes all if not provided)
     * @returns This agent instance for method chaining
     * 
     * @example
     * ```typescript
     * const messageHandler = (msg) => console.log(msg);
     * agent.on(Events.Message.CHANNEL_MESSAGE, messageHandler);
     * 
     * // Later, remove specific handler
     * agent.off(Events.Message.CHANNEL_MESSAGE, messageHandler);
     * 
     * // Or remove all handlers for an event
     * agent.off(Events.Message.CHANNEL_MESSAGE);
     * ```
     */
    public off(eventName: PublicEventName, handler?: (data: any) => void): this {
        const subscriptions = this.eventListeners.get(eventName);
        
        if (subscriptions) {
            if (handler) {
                // Remove specific handler (not easily possible with RxJS subscriptions)
                // This would require storing handler references
                this.logger.warn('Removing specific handler not fully supported. Use removeAllListeners() instead.');
            } else {
                // Remove all handlers for this event
                subscriptions.forEach(sub => sub.unsubscribe());
                this.eventListeners.delete(eventName);
            }
        }

        return this;
    }

    /**
     * Emit an event (for advanced use cases)
     * 
     * Note: Most events are emitted automatically by the framework.
     * This is provided for custom event emission in advanced scenarios.
     * 
     * @param eventName - Public event name
     * @param data - Event data
     * @returns This agent instance for method chaining
     * 
     * @example
     * ```typescript
     * // Custom status change
     * agent.emit(Events.Agent.STATUS_CHANGE, {
     *     agentId: agent.agentId,
     *     status: 'busy'
     * });
     * ```
     */
    public emit(eventName: PublicEventName, data: any): this {
        // Validate event is in public whitelist
        if (!isPublicEvent(eventName)) {
            this.logger.warn(
                `Event '${eventName}' is not in the public whitelist. ` +
                `Only events from PUBLIC_EVENTS can be emitted. Ignoring emit.`
            );
            return this;
        }

        EventBus.client.emit(eventName, data);
        return this;
    }
}
