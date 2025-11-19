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
 * Channel Module
 * 
 * Represents a communication channel that agents can join to exchange messages.
 * Handles both channel-specific functionality and socket communication.
 */

import { default as socketIO } from 'socket.io-client';
import { EventBus } from '../../shared/events/EventBus';
import { Events, CoreSocketEvents, AgentEvents, ChannelEvents, ChannelActionTypes, AuthEvents } from '../../shared/events/EventNames';
import { TaskEvents } from '../../shared/events/event-definitions/TaskEvents';
import { PublicEventName, isPublicEvent } from '../../shared/events/PublicEvents';
import { v4 as uuidv4 } from 'uuid';
import { createChannelMessage, ChannelMessage } from '../../shared/schemas/MessageSchemas';
import { 
    createChannelEventPayload, 
    createSubscriptionEventPayload, 
    createAgentMessageEventPayload,
    createAgentEventPayload, 
    AgentEventData,
    AgentEventPayload,
    ChannelEventPayload,            
    createChannelMessageEventPayload,
    ChannelMessageEventPayload 
} from '../../shared/schemas/EventPayloadSchema';
import { MemoryEvents, MemoryScope, MemoryUpdateEvent } from '../../shared/events/event-definitions/MemoryEvents';
import { createStrictValidator } from '../../shared/utils/validation';
import { ApiService, ChannelContext, ChannelMemory } from './MxfApiService';
// Removed SocketProvider - internal implementation detail
import { ChannelConfig } from '../../shared/interfaces/ChannelConfig';
import { ChannelInfo } from '../../shared/interfaces/ChannelInfo';
import { ChannelConnectionConfig } from '../../shared/interfaces/ChannelConnectionConfig';

// Internal helpers (not exported from SDK)
import { TaskHelper, TaskConfig } from './internal/TaskHelper';
import { 
    AdminHelper, 
    ChannelCreateConfig, 
    ChannelCreateResult, 
    KeyGenerateConfig, 
    KeyGenerateResult, 
    KeyInfo 
} from './internal/AdminHelper';

// Re-export types for public API use
export type { TaskConfig, ChannelCreateConfig, ChannelCreateResult, KeyGenerateConfig, KeyGenerateResult, KeyInfo };

/**
 * Task event callback types for SDK users
 */
export interface TaskEventCallbacks {
    onTaskCompleted?: (taskData: any) => void;
    onTaskFailed?: (taskData: any) => void;
    onTaskCancelled?: (taskData: any) => void;
    onTaskAssigned?: (taskData: any) => void;
    onTaskStarted?: (taskData: any) => void;
    onTaskProgressUpdated?: (taskData: any) => void;
}

/**
 * Internal channel service interface - only exposes what handlers need
 */
export interface IInternalChannelService {
    socketEmit(eventName: string, data: any): void;
    isConnected(): boolean;
}

/**
 * Channel class
 * 
 * Represents a communication channel that agents can join.
 * Handles event listening, message sending, and socket connection management.
 */
export class MxfService implements IInternalChannelService {
    private channelId: string;
    private config: Required<ChannelConfig>;
    private connectionConfig: ChannelConnectionConfig;
    private info: ChannelInfo | null = null;
    private isActive: boolean = false;
    private logger: any;
    
    // Socket.io connection properties
    private socket: any = null;
    private serverUrl: string;
    private keyId?: string;
    private secretKey?: string;
    private agentId: string | null = null;
    private connected: boolean = false;
    private autoReconnect: boolean = true;
    private reconnectDelay: number = 5000;
    private reconnectAttempts: number = 5;
    private pendingEvents: Array<{event: string, data: any}> = [];
    private validator = createStrictValidator('Channel');
    private eventListenersSetup: boolean = false; // Track if event listeners are already set up

    // API Service for context and memory operations
    private apiService: ApiService | null = null;
    private channelContext: ChannelContext | null = null;
    private channelMemory: ChannelMemory | null = null;

    // Channel config and active agents (received from server on auth)
    private channelConfigData: any = null;
    private activeAgentsList: string[] = [];

    // Task event callbacks for SDK users
    private taskEventCallbacks: TaskEventCallbacks = {};

    // Event listener subscriptions for channel.on() cleanup
    private channelEventListeners: Map<string, any[]> = new Map();

    /**
     * Create a new channel
     * @param channelId Channel ID
     * @param connectionConfig Connection configuration
     * @param config Channel configuration
     * @param logger Optional logger instance
     */
    constructor(
        channelId: string, 
        connectionConfig: ChannelConnectionConfig,
        config: Partial<ChannelConfig> = {},
        logger: any = console
    ) {
        this.validator.assertIsNonEmptyString(channelId);
        this.channelId = channelId;
        this.logger = logger;
        
        // Set socket connection properties
        this.serverUrl = connectionConfig.serverUrl;
        this.keyId = connectionConfig.keyId;
        this.secretKey = connectionConfig.secretKey;
        this.autoReconnect = connectionConfig.autoReconnect ?? true;
        this.reconnectDelay = connectionConfig.reconnectDelay ?? 5000;
        this.reconnectAttempts = connectionConfig.reconnectAttempts ?? 5;
        this.connectionConfig = connectionConfig;
        
        // Default channel configuration
        this.config = {
            name: config.name || `Channel-${channelId}`,
            description: config.description || '',
            isPrivate: config.isPrivate ?? false,
            requireApproval: config.requireApproval ?? false,
            maxAgents: config.maxAgents ?? 100,
            allowAnonymous: config.allowAnonymous ?? false,
            metadata: config.metadata || {}
        };

        // Initialize API service if API URL is provided
        if (connectionConfig.apiUrl && (this.keyId || connectionConfig.keyId) && (this.secretKey || connectionConfig.secretKey)) {
            this.apiService = new ApiService({
                baseUrl: connectionConfig.apiUrl,
                keyId: this.keyId || connectionConfig.keyId,
                secretKey: this.secretKey || connectionConfig.secretKey
            });
        }
        
        // Setup event listeners
        this.setupEventListeners();
    }

    /**
     * Connect to the server
     * @returns Promise that resolves when connected
     */
    public async connect(): Promise<boolean> {
        // Make sure we have an agent ID
        this.validateAgentId();
        
        try {
            return new Promise<boolean>((resolve, reject) => {
                // Set up timeout for connection
                const timeoutId = setTimeout(() => {
                    this.logger.error(`[Channel:${this.channelId}] Connection timed out after 10 seconds`);
                    
                    // Clean up event listeners using proper subscription management
                    if (connectedSubscription) {
                        connectedSubscription.unsubscribe();
                    }
                    
                    // Reject the promise
                    reject(new Error('Connection timed out after 10 seconds'));
                }, 10000);
                
                // Listen for specific "CONNECTED" response using RxJS subscription
                const connectedSubscription = EventBus.client.on(AgentEvents.CONNECTED, (data: any) => {
                    
                    // Get agentId from standardized top-level location
                    const agentId = data.agentId;
                    
                    // Verify this event is for our agent
                    if (!agentId) {
                        this.logger.error(`[Channel:${this.channelId}] Received invalid CONNECTED event: missing agentId`);
                        return;
                    }
                    
                    if (agentId !== this.agentId) {
                        return;
                    }
                    
                    
                    // Got a response for this agent, can clear handlers and resolve
                    this.connected = true;
                    this.isActive = true;
                    
                    // Clean up timeout and subscription
                    clearTimeout(timeoutId);
                    connectedSubscription.unsubscribe();
                    
                    // Process any pending events that were queued while disconnected
                    this.processPendingEvents();
                    
                    resolve(true);
                });
                
                // Initialize socket.io connection if not already connected
                if (!this.socket || !this.socket.connected) {
                    
                    if (this.connectionConfig.sdkDomainKey) {
                    }
                    
                    // Create socket.io instance with authentication
                    this.socket = socketIO(this.serverUrl, {
                        auth: {
                            domainKey: this.connectionConfig.sdkDomainKey,  // SDK domain key (layer 1 auth)
                            agentId: this.agentId,
                            keyId: this.keyId,
                            secretKey: this.secretKey,
                            capabilities: this.connectionConfig.capabilities || [],
                            allowedTools: this.connectionConfig.allowedTools
                        },
                        reconnection: this.autoReconnect,
                        reconnectionDelay: this.reconnectDelay,
                        reconnectionAttempts: this.reconnectAttempts,
                        timeout: 10000, // Increased timeout for more stable connections
                        forceNew: false, // Don't force a new connection if one exists
                        transports: ['websocket', 'polling'] // Try websocket first, fallback to polling
                    });
                    
                    // Set up connection event handler
                    this.socket.on(CoreSocketEvents.CONNECT, () => {
                        
                        // Don't clear timeout yet - we still need to wait for CONNECTED event
                        // The timeout protects against both socket connection AND server response delays
                        
                        // Set the socket for event forwarding
                        EventBus.client.setClientSocket(this.socket);
                        
                        // Listen for authentication events for logging
                        this.socket.on(AuthEvents.SUCCESS, (authData: any) => {

                            // Store channel config and active agents if provided
                            if (authData.channelConfig) {
                                this.channelConfigData = authData.channelConfig;
                            }

                            if (authData.activeAgents && Array.isArray(authData.activeAgents)) {
                                this.activeAgentsList = authData.activeAgents;
                            }
                        });
                        
                        // Listen for authentication errors
                        this.socket.on(AuthEvents.ERROR, (errorData: any) => {
                            this.logger.error(`[Channel:${this.channelId}] Authentication failed:`, errorData);
                        });
                        
                        // Set up socket event handlers
                        this.setupSocketEventHandlers();
                        
                        // Emit agent connection request to server
                        const agentId = this.validateAgentId();
                        const payload: AgentEventPayload = createAgentEventPayload(
                            AgentEvents.CONNECT,
                            agentId,
                            this.channelId,
                            {
                                status: 'connected',
                                metadata: {
                                    socketId: this.socket.id,
                                    channelId: this.channelId,
                                    connectionTime: Date.now()
                                }
                            }
                        );
                        
                        EventBus.client.emit(AgentEvents.CONNECT, payload);
                    });
                    
                    // Handle socket connection errors
                    this.socket.on(CoreSocketEvents.CONNECT_ERROR, (error: any) => {
                        this.logger.error(`[Channel:${this.channelId}] Socket connection error:`, error);
                        
                        // Clean up event listeners
                        connectedSubscription.unsubscribe();
                        clearTimeout(timeoutId);
                        
                        // Reject the promise
                        reject(new Error(`Socket connection error: ${error.message || 'Unknown error'}`));
                    });
                } else {
                    
                    // Socket is already connected, so emit the connected event for our agent
                    // to request that the server send us a CONNECTED event
                    // This is needed because the server SocketService might not have emitted the event yet
                    const agentId = this.validateAgentId(); // Ensure agentId is valid
                    const payload: AgentEventPayload = createAgentEventPayload(
                        AgentEvents.CONNECT,      // 1. eventType
                        agentId,                  // 2. agentId for BaseEventPayload
                        this.channelId,           // 3. channelId for BaseEventPayload
                        {                         // 4. AgentEventData fields:
                            status: 'connected', 
                            metadata: { 
                                socketId: this.socket.id,
                                channelId: this.channelId // Duplicating channelId here as it's part of specific event context too
                            }
                        }
                    );
                    
                    EventBus.client.emit(AgentEvents.CONNECT, payload);
                }
            });
        } catch (error) {
            this.logger.error(`[Channel:${this.channelId}] Error connecting:`, error);
            throw error;
        }
    }
    
    /**
     * Set the agent ID for this channel
     * @param agentId Agent ID to set
     */
    public setAgentId(agentId: string): void {
        this.validator.assertIsNonEmptyString(agentId);
        this.agentId = agentId;
    }
    
    /**
     * Set up socket.io event handlers
     */
    private setupSocketEventHandlers(): void {
        if (!this.socket) {
            return;
        }
        
        // Handle connection
        this.socket.on(CoreSocketEvents.CONNECT, () => {
            this.connected = true;
            
            // Process any pending events
            this.processPendingEvents();
            
            try {
                // Validate agent ID before emitting
                const agentId = this.validateAgentId();
                
                // Emit the connection event with proper payload structure using the schema function
                const connectData: AgentEventData = {
                    status: 'connected',
                    socketId: this.socket.id
                };
                
                EventBus.client.emit(
                    AgentEvents.CONNECT, 
                    createAgentEventPayload(
                        AgentEvents.CONNECT,
                        agentId,
                        this.channelId,
                        connectData
                    )
                );
            } catch (error) {
                this.logger.error(`[Channel:${this.channelId}] Failed to emit connect event: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        
        // Handle disconnect
        this.socket.on(CoreSocketEvents.DISCONNECT, (reason: string) => {
            this.connected = false;
            
            try {
                // Emit disconnect event with validated agent ID
                const agentId = this.validateAgentId();
                
                // Notify that we're disconnected using proper payload structure using the schema function
                const disconnectData: AgentEventData = {
                    status: 'disconnected',
                    socketId: this.socket?.id,
                    reason: reason
                };
                
                EventBus.client.emit(
                    AgentEvents.DISCONNECT, 
                    createAgentEventPayload(
                        AgentEvents.DISCONNECT,
                        agentId,
                        this.channelId,
                        disconnectData
                    )
                );
            } catch (error) {
                // If we can't emit the disconnect event due to missing agentId, at least log it
                this.logger.error(`[Channel:${this.channelId}] Failed to emit disconnect event: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        
        // Handle reconnect
        this.socket.on(CoreSocketEvents.RECONNECT, () => {
            this.connected = true;
            this.processPendingEvents();
        });
        
        // Set up event listeners for this channel
        this.setupEventListeners();
    }

    /**
     * Get the channel ID
     * @returns Channel ID
     */
    public getChannelId(): string {
        return this.channelId;
    }

    /**
     * Check if the socket is connected
     * @returns True if connected
     */
    public isConnected(): boolean {
        // First check our internal connected flag
        if (!this.connected) {
            return false;
        }
        
        // Then verify socket exists and is actually connected
        if (!this.socket) {
            return false;
        }
        
        // Check the socket.io connection status
        return !!this.socket.connected;
    }
    
    /**
     * Unsubscribe from this channel
     * Simply emits an unsubscription request event - all handling is done by the server
     */
    public unsubscribe(): void {
        const leavingAgentId = this.validateAgentId();
        
        
        // Create standardized ChannelEventPayload for LEAVE action
        const payload: ChannelEventPayload = createChannelEventPayload(
            Events.Agent.LEAVE_CHANNEL,    // eventType
            leavingAgentId,          // agentId for BaseEventPayload (who is leaving)
            this.channelId,           // channelId for BaseEventPayload
            {                         // ChannelEventData
                action: ChannelActionTypes.LEAVE,
                agentId: leavingAgentId, // Agent performing the action (redundant but good for clarity in ChannelEventData)
                channelId: this.channelId  // Channel context for the action
            }
        );
        
        // Emit LEAVE event via EventBus
        EventBus.client.emit(Events.Agent.LEAVE_CHANNEL, payload);
    }

    /**
     * Emit an event directly to the socket
     * @param eventName - Name of the event to emit
     * @param data - Data to send with the event
     * @internal - This method is for internal SDK use only, not for direct developer use
     */
    public socketEmit(eventName: string, data: any): void {
        this.validateSocket();
        this.socket.emit(eventName, data);
    }

    /**
     * Validate that the socket is connected
     * Throws an error if the socket is not connected
     */
    private validateSocket(): void {
        if (!this.socket || !this.socket.connected) {
            throw new Error('Socket is not connected');
        }
    }

    /**
     * Send a message to the channel
     * @param messageContent - Content of the message to send
     * @param fromAgentId - ID of the agent sending the message
     * @param options - Optional message options
     * @returns The generated message ID
     */
    public async sendMessage(
        messageContent: string | Record<string, any>,
        fromAgentId: string,
        options: Record<string, any> = {}
    ): Promise<string> {
        this.validator.assertIsNonEmptyString(fromAgentId);
        
        // Generate a unique message ID if not provided
        const messageId = options.messageId || this.generateMessageId();
        
        
        try {
            // Create a properly formatted standardized channel message
            const standardMessage: ChannelMessage = createChannelMessage(
                this.channelId,
                fromAgentId,
                messageContent,
                {
                    metadata: {
                        messageId,
                        timestamp: Date.now(),
                        ...options.metadata
                    },
                    ...options
                }
            );
            
            // Process with binary protocol for any internal processing that may be needed,
            // but never send the raw binary - always wrap in JSON
            
            // Wrap the ChannelMessage in a ChannelMessageEventPayload (BaseEventPayload)
            const eventPayload = createChannelMessageEventPayload(
                Events.Message.CHANNEL_MESSAGE, // eventType
                fromAgentId,                    // agentId for BaseEventPayload (sender of the message)
                standardMessage,                // The ChannelMessage object itself (goes into data field)
                {}                              // Options (empty object if none specific)
            );
            
            // Send the properly structured EventPayload via socket
            EventBus.client.emit(Events.Message.CHANNEL_MESSAGE, eventPayload);
            
            return messageId;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error sending message: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Set up listener for messages on this channel
     */
    private setupEventListeners(): void {
        if (this.eventListenersSetup) {
            return;
        }
        this.eventListenersSetup = true;

        // Listen for messages on this channel
        EventBus.client.on(Events.Message.CHANNEL_MESSAGE, (payload: ChannelMessageEventPayload) => {
            // 'payload' is ChannelMessageEventPayload.
            // The actual ChannelMessage is in payload.data
            // The channelId for a ChannelMessage is within its 'context' property.
            if (payload && payload.data && payload.data.context && payload.data.context.channelId === this.channelId) {
                // Optional: Check consistency between BaseEventPayload.agentId and ChannelMessage.senderId
                if (payload.agentId !== payload.data.senderId) {
                    this.logger.warn(
                        `[Channel:${this.channelId}] Mismatch in senderId for CHANNEL_MESSAGE. ` +
                        `Event sender (BaseEventPayload.agentId): ${payload.agentId}, ` +
                        `Message sender (ChannelMessage.senderId): ${payload.data.senderId}`
                    );
                    // Depending on policy, you might choose to ignore, or trust one over the other.
                    // For now, we'll proceed using the senderId from the ChannelMessage data.
                }
                // TODO: Further processing of payload.data (the ChannelMessage) if needed by MxfService itself.
                // Typically, other parts of the application would subscribe to this event for their own handling.
            }
        });

        // Listen for task events relevant to this agent/channel
        this.setupTaskEventListeners();
    }

    /**
     * Set up listeners for task events
     * @private
     */
    private setupTaskEventListeners(): void {
        
        // Task completion events
        EventBus.client.on(TaskEvents.COMPLETED, (payload: any) => {
            this.handleTaskEvent('completed', payload);
        });

        EventBus.client.on(TaskEvents.FAILED, (payload: any) => {
            this.handleTaskEvent('failed', payload);
        });

        EventBus.client.on(TaskEvents.CANCELLED, (payload: any) => {
            this.handleTaskEvent('cancelled', payload);
        });

        EventBus.client.on(TaskEvents.ASSIGNED, (payload: any) => {
            this.handleTaskEvent('assigned', payload);
        });

        EventBus.client.on(TaskEvents.STARTED, (payload: any) => {
            this.handleTaskEvent('started', payload);
        });

        EventBus.client.on(TaskEvents.PROGRESS_UPDATED, (payload: any) => {
            //
            this.handleTaskEvent('progressUpdated', payload);
        });
    }

    /**
     * Handle task event and invoke appropriate callback
     * @private
     */
    private handleTaskEvent(eventType: string, payload: any): void {
        try {
            // Validate payload structure
            if (!payload || typeof payload !== 'object') {
                this.logger.warn(`[Channel:${this.channelId}] Invalid task event payload for ${eventType}`);
                return;
            }

            // Check if this event is relevant to our channel
            if (payload.channelId && payload.channelId !== this.channelId) {
                return; // Not for our channel
            }

            // Get our agent ID for filtering
            const agentId = this.getAgentId();
            
            if (!agentId) {
                this.logger.warn(`[Channel:${this.channelId}] No agent ID available for event filtering`);
                return;
            }
            
            // Enhanced agent-level event filtering
            // For task assignment events, only process if we're assigned
            if (eventType === 'assigned') {
                const assignedAgents = payload.assignedAgents || (payload.agentId && payload.agentId !== 'system' ? [payload.agentId] : []);
                const isAssignedToUs = assignedAgents.includes(agentId);
                const isSystemAssignment = payload.agentId === 'system';
                
                // Only process if assigned to us or it's a system assignment in our channel
                if (!isAssignedToUs && !isSystemAssignment) {
                    //;
                    return;
                }
                
                //;
            }
            
            // For task completion events, log who completed the task but allow all agents to receive for coordination
            if (eventType === 'completed' || eventType === 'failed' || eventType === 'cancelled') {
                //;
            }

            // Reduced logging - only show task ID and basic info

            // Invoke appropriate callback
            const taskData = {
                taskId: payload.taskId || payload.data?.taskId || payload.data?.task?.id,
                task: payload.data?.task,
                agentId: payload.agentId,
                channelId: payload.channelId,
                timestamp: payload.timestamp,
                eventType: eventType,
                rawPayload: payload
            };

            switch (eventType) {
                case 'completed':
                    this.taskEventCallbacks.onTaskCompleted?.(taskData);
                    break;
                case 'failed':
                    this.taskEventCallbacks.onTaskFailed?.(taskData);
                    break;
                case 'cancelled':
                    this.taskEventCallbacks.onTaskCancelled?.(taskData);
                    break;
                case 'assigned':
                    this.taskEventCallbacks.onTaskAssigned?.(taskData);
                    break;
                case 'started':
                    this.taskEventCallbacks.onTaskStarted?.(taskData);
                    break;
                case 'progressUpdated':
                    this.taskEventCallbacks.onTaskProgressUpdated?.(taskData);
                    break;
            }
        } catch (error) {
            this.logger.error(`[Channel:${this.channelId}] Error handling task ${eventType} event:`, error);
        }
    }

    /**
     * Ensure we have a valid agent ID
     * @private
     * @throws {Error} If agent ID is not available
     * @returns {string} The validated agentId
     */
    private validateAgentId(): string {
        if (!this.agentId) {
            throw new Error(`[Channel:${this.channelId}] Agent ID is required for this operation`);
        }
        return this.agentId;
    }

    /**
     * Process any pending events that were queued while disconnected
     */
    private processPendingEvents(): void {
        if (!this.isConnected()) {
            return;
        }
        
        // Nothing to process
        if (!this.pendingEvents.length) {
            return;
        }
        
        
        // Process all pending events
        // Create a copy and clear the instance's queue immediately to avoid race conditions if new events are added during processing
        const eventsToProcess = [...this.pendingEvents];
        this.pendingEvents = [];
        
        // Emit all pending events through EventBus
        // Assumption: pendingEvent.data is the fully-formed, correct payload that was originally passed to EventBus.client.emit
        for (const pendingEvent of eventsToProcess) {
            EventBus.client.emit(pendingEvent.event, pendingEvent.data);
        }
    }

    /**
     * Disconnect from the server and clean up resources
     */
    public async disconnect(): Promise<void> {
        try {
            
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }
            
            this.connected = false;
            
        } catch (error) {
            this.logger.error(`[Channel:${this.channelId}] Error during disconnect:`, error);
            throw error;
        }
    }

    /**
     * Generate a unique message ID
     */
    private generateMessageId(): string {
        return uuidv4();
    }

    // SocketProvider implementation
    
    /**
     * Get the underlying socket - PRIVATE
     * @returns The socket.io Socket instance
     */
    private getSocket(): any {
        return this.socket;
    }
    
    /**
     * Get the socket ID - PRIVATE
     * @returns The socket ID or null if not connected
     */
    private getSocketId(): string | null {
        return this.socket?.id || null;
    }
    
    /**
     * Get the server URL - PRIVATE
     * @returns The server URL
     */
    private getUrl(): string {
        return this.serverUrl;
    }
    
    /**
     * Get the agent ID
     * @returns The agent ID or null if not set
     */
    public getAgentId(): string | null {
        return this.agentId;
    }

    /**
     * Get the channel configuration received from server
     * @returns Channel config or null if not available
     */
    public getChannelConfig(): any {
        return this.channelConfigData;
    }

    /**
     * Get the list of active agents in the channel
     * @returns Array of agent IDs
     */
    public getActiveAgents(): string[] {
        return this.activeAgentsList;
    }

    /**
     * Load channel context from the server
     * @returns Promise resolving to channel context or null if API service is not available
     */
    public async loadContext(): Promise<ChannelContext | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot load channel context.`);
                return null;
            }

            // Fetch context from server
            this.channelContext = await this.apiService.fetchChannelContext(this.channelId);
            return this.channelContext;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error loading channel context: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Get or create shared channel memory
     * @returns Promise resolving to channel memory or null if API service is not available
     */
    public async getSharedMemory(): Promise<ChannelMemory | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot access channel memory.`);
                return null;
            }

            // Get or create shared memory
            this.channelMemory = await this.apiService.getOrCreateChannelMemory(this.channelId);
            return this.channelMemory;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error accessing shared memory: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Update shared channel memory
     * @param update Memory update data
     * @returns Promise resolving to updated channel memory or null if API service is not available
     */
    public async updateSharedMemory(update: Partial<ChannelMemory>): Promise<ChannelMemory | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot update shared memory.`);
                return null;
            }

            // Update memory via API
            const updatedMemory = await this.apiService.updateChannelMemory(this.channelId, update);
            
            if (updatedMemory) {
                this.channelMemory = updatedMemory;

                // Emit memory update event
                try {
                    const agentId = this.validateAgentId(); // Agent performing the action or context for the event
                    const operationId = uuidv4();
                    const timestamp = Date.now();

                    const memoryUpdatePayload: MemoryUpdateEvent = {
                        id: this.channelId,       // ID of the memory resource being updated (channel memory)
                        data: update,             // The partial update data that was applied
                        scope: MemoryScope.CHANNEL,
                        operationId,
                        timestamp,
                        // metadata can be omitted if not needed
                    };

                    EventBus.client.emit(MemoryEvents.UPDATE, memoryUpdatePayload);
                } catch (eventError) {
                    const eventErrorMessage = eventError instanceof Error ? eventError.message : String(eventError);
                    this.logger.error(`[Channel:${this.channelId}] Error emitting ${MemoryEvents.UPDATE} event: ${eventErrorMessage}`);
                    // Decide if this error should affect the outcome of updateSharedMemory
                }
                return this.channelMemory;
            }
            return null; // If apiService didn't return updated memory
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error updating shared memory: ${errorMessage}`);
            // Optionally emit a MemoryEvents.UPDATE_ERROR here if defined and appropriate
            return null;
        }
    }

    /**
     * Add a note to shared channel memory
     * @param key Note key
     * @param value Note value
     * @returns Promise resolving to updated channel memory or null if API service is not available
     */
    public async addSharedNote(key: string, value: any): Promise<ChannelMemory | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot add shared note.`);
                return null;
            }

            return await this.updateSharedMemory({
                notes: {
                    [key]: value
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error adding shared note: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Update shared state in channel memory
     * @param key State key
     * @param value State value
     * @returns Promise resolving to updated channel memory or null if API service is not available
     */
    public async updateSharedState(key: string, value: any): Promise<ChannelMemory | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot update shared state.`);
                return null;
            }

            return await this.updateSharedMemory({
                sharedState: {
                    [key]: value
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error updating shared state: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Add conversation entry to channel memory
     * @param entry Conversation entry to add
     * @returns Promise resolving to channel memory or null if API service is not available
     */
    public async addToSharedConversationHistory(entry: any): Promise<ChannelMemory | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot update conversation history.`);
                return null;
            }

            return await this.updateSharedMemory({
                conversationHistory: [entry]
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error adding to conversation history: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Extract conversation topics from recent channel messages
     * @param minRelevance Minimum relevance threshold (0.0 to 1.0)
     * @returns Promise resolving to conversation topics or null if API service is not available
     */
    public async extractTopics(minRelevance: number = 0.5): Promise<any[] | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot extract topics.`);
                return null;
            }

            // Call the API endpoint for topic extraction
            const topics = await this.apiService.extractChannelTopics(this.channelId, minRelevance);
            return topics;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error extracting conversation topics: ${errorMessage}`);
            return null;
        }
    }
    
    /**
     * Create a new channel context
     * @param name Channel name
     * @param description Channel description
     * @returns Promise resolving to created channel context or null if API service is not available
     */
    public async createChannelContext(name: string, description: string): Promise<ChannelContext | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot create channel context.`);
                return null;
            }

            // Get the agent ID for attribution
            const agentId = this.validateAgentId();
            
            // Call the API endpoint to create context
            const context = await this.apiService.createChannelContext(
                this.channelId,
                name,
                description,
                agentId
            );
            
            // Store the context locally
            this.channelContext = context;
            
            return context;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error creating channel context: ${errorMessage}`);
            return null;
        }
    }
    
    /**
     * Add an agent to this channel
     * @param targetAgentId Agent ID to add to the channel
     * @returns Promise resolving to success status
     */
    public async addAgent(targetAgentId: string): Promise<boolean> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot add agent.`);
                return false;
            }
            
            // Call the API endpoint to add agent
            const success = await this.apiService.addAgentToChannel(this.channelId, targetAgentId);
            
            if (success) {
                // Emit an event indicating an agent joined the channel
                const eventPayload = createChannelEventPayload(
                    ChannelEvents.AGENT_JOINED,
                    this.validateAgentId(), // Agent performing the action / emitting the event
                    this.channelId,
                    {
                        action: ChannelActionTypes.JOIN, // Corrected Action type
                        agentId: targetAgentId // The agent that joined
                    }
                );
                EventBus.client.emit(ChannelEvents.AGENT_JOINED, eventPayload);
            }
            
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error adding agent ${targetAgentId}: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Remove an agent from this channel
     * @param targetAgentId Agent ID to remove from the channel
     * @returns Promise resolving to success status
     */
    public async removeAgent(targetAgentId: string): Promise<boolean> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot remove agent.`);
                return false;
            }
            
            // Call the API endpoint to remove agent
            const success = await this.apiService.removeAgentFromChannel(this.channelId, targetAgentId);
            
            if (success) {
                // Emit an event indicating an agent left the channel
                const eventPayload = createChannelEventPayload(
                    ChannelEvents.AGENT_LEFT,
                    this.validateAgentId(), // Agent performing the action / emitting the event
                    this.channelId,
                    {
                        action: ChannelActionTypes.LEAVE, // Corrected Action type
                        agentId: targetAgentId // The agent that left
                    }
                );
                EventBus.client.emit(ChannelEvents.AGENT_LEFT, eventPayload);
            }
            
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error removing agent ${targetAgentId}: ${errorMessage}`);
            return false;
        }
    }
    
    /**
     * Set channel metadata value
     * @param key Metadata key
     * @param value Metadata value
     * @returns Promise resolving to success status
     */
    public async setMetadata(key: string, value: any): Promise<boolean> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot set metadata.`);
                return false;
            }
            
            // Get the agent ID for attribution
            const agentId = this.validateAgentId();
            
            // Call the API endpoint to set metadata
            const success = await this.apiService.setChannelMetadata(this.channelId, key, value, agentId);
            
            if (success) {
                // Refresh local context after successful update
                await this.loadContext();
            }
            
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error setting metadata key ${key}: ${errorMessage}`);
            return false;
        }
    }
    
    /**
     * Get channel metadata
     * @param key Optional metadata key (if not provided, returns all metadata)
     * @returns Promise resolving to metadata value or null if API service is not available
     */
    public async getMetadata(key?: string): Promise<any> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot get metadata.`);
                return null;
            }
            
            // Call the API endpoint to get metadata
            return await this.apiService.getChannelMetadata(this.channelId, key);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error getting metadata${key ? ` for key ${key}` : ''}: ${errorMessage}`);
            return null;
        }
    }
    
    /**
     * Get channel context history
     * @param limit Maximum number of history entries
     * @returns Promise resolving to history entries or null if API service is not available
     */
    public async getContextHistory(limit?: number): Promise<any[] | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot get context history.`);
                return null;
            }

            // Call the API endpoint to get history
            const history = await this.apiService.getChannelContextHistory(this.channelId, limit);
            return history;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error getting context history: ${errorMessage}`);
            return null;
        }
    }
    
    /**
     * Add a message to channel history directly (without sending through socket)
     * @param message Message to add to history
     * @returns Promise resolving to success status
     */
    public async addMessageToHistory(message: any): Promise<boolean> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot add message to history.`);
                return false;
            }
            
            // Ensure the message has required fields
            if (!message.messageId) {
                message.messageId = this.generateMessageId();
            }
            if (!message.timestamp) {
                message.timestamp = Date.now();
            }
            if (!message.senderId && this.agentId) {
                message.senderId = this.agentId;
            }
            
            // Call the API endpoint to add message
            return await this.apiService.addChannelMessage(this.channelId, message);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error adding message to history: ${errorMessage}`);
            return false;
        }
    }
    
    /**
     * Get recent channel messages
     * @param limit Maximum number of messages to retrieve
     * @returns Promise resolving to messages array or null if API service is not available
     */
    public async getMessages(limit?: number): Promise<any[] | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot get channel messages.`);
                return null;
            }
            
            // Call the API endpoint to get messages
            return await this.apiService.getChannelMessages(this.channelId, limit);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error getting channel messages: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Generate a summary of the conversation in this channel
     * @returns Promise resolving to conversation summary or null if API service is not available
     */
    public async generateConversationSummary(): Promise<string | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot generate summary.`);
                return null;
            }

            // Call the API endpoint for conversation summarization
            const summary = await this.apiService.generateChannelSummary(this.channelId);
            return summary;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error generating conversation summary: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Update the channel context
     * @param updates Context updates to apply
     * @returns Promise resolving to updated context or null if API service is not available
     */
    public async updateContext(updates: any): Promise<ChannelContext | null> {
        try {
            if (!this.apiService) {
                this.logger.warn(`[Channel:${this.channelId}] API service not initialized. Cannot update context.`);
                return null;
            }

            const agentId = this.validateAgentId(); // Agent performing the action
            
            // Call the API endpoint for context update
            const updatedContext = await this.apiService.updateChannelContext(this.channelId, updates, agentId);

            if (updatedContext) {
                // Emit channel context update event
                try {
                    const eventPayload = createChannelEventPayload(
                        ChannelEvents.CONTEXT.UPDATED, // Corrected event name
                        agentId,
                        this.channelId,
                        {
                            action: ChannelActionTypes.UPDATE_CONTEXT,
                            context: updatedContext // The full updated context
                        }
                    );
                    EventBus.client.emit(ChannelEvents.CONTEXT.UPDATED, eventPayload); // Corrected event name
                } catch (eventError) {
                    const eventErrorMessage = eventError instanceof Error ? eventError.message : String(eventError);
                    this.logger.error(`[Channel:${this.channelId}] Error emitting ${ChannelEvents.CONTEXT.UPDATED} for context update: ${eventErrorMessage}`); // Corrected event name
                    // Decide if this error should affect the outcome of updateContext
                }
                return updatedContext;
            }
            return null; // If apiService didn't return updated context
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`[Channel:${this.channelId}] Error updating context: ${errorMessage}`);
            // Optionally emit a ChannelEvents.CHANNEL_ERROR here
            return null;
        }
    }
    
    /**
     * Register task event callbacks for SDK users
     * @param callbacks Object containing callback functions for different task events
     */
    public onTaskEvents(callbacks: TaskEventCallbacks): void {
        this.taskEventCallbacks = { ...this.taskEventCallbacks, ...callbacks };
    }

    /**
     * Register a callback for task completion events
     * @param callback Function to call when a task is completed
     */
    public onTaskCompleted(callback: (taskData: any) => void): void {
        this.taskEventCallbacks.onTaskCompleted = callback;
    }

    /**
     * Register a callback for task failure events
     * @param callback Function to call when a task fails
     */
    public onTaskFailed(callback: (taskData: any) => void): void {
        this.taskEventCallbacks.onTaskFailed = callback;
    }

    /**
     * Register a callback for task assignment events
     * @param callback Function to call when a task is assigned
     */
    public onTaskAssigned(callback: (taskData: any) => void): void {
        this.taskEventCallbacks.onTaskAssigned = callback;
    }

    /**
     * Register a callback for task cancellation events
     * @param callback Function to call when a task is cancelled
     */
    public onTaskCancelled(callback: (taskData: any) => void): void {
        this.taskEventCallbacks.onTaskCancelled = callback;
    }

    /**
     * Register a callback for task start events
     * @param callback Function to call when a task starts
     */
    public onTaskStarted(callback: (taskData: any) => void): void {
        this.taskEventCallbacks.onTaskStarted = callback;
    }

    /**
     * Register a callback for task progress update events
     * @param callback Function to call when task progress is updated
     */
    public onTaskProgressUpdated(callback: (taskData: any) => void): void {
        this.taskEventCallbacks.onTaskProgressUpdated = callback;
    }

    /**
     * Clear all task event callbacks
     */
    public clearTaskEventCallbacks(): void {
        this.taskEventCallbacks = {};
    }

    // ============================================================================
    // CONVENIENCE METHODS - Simplified SDK APIs
    // ============================================================================

    /**
     * Create a task in this channel
     * Simplified API that hides EventBus complexity
     * 
     * @param config - Task configuration
     * @returns Promise resolving to the created task ID
     * 
     * @example
     * ```typescript
     * const taskId = await agent.channelService.createTask({
     *     title: 'Schedule Interview',
     *     description: 'Find time for technical interview',
     *     assignedAgentIds: ['recruiter', 'candidate', 'scheduler'],
     *     completionAgentId: 'scheduler'
     * });
     * ```
     */
    public async createTask(config: TaskConfig): Promise<string> {
        // Validate we have an agent ID
        const agentId = this.validateAgentId();
        
        // Use internal helper to create task (hides EventBus from developer)
        return await TaskHelper.createTask(this.channelId, config, agentId);
    }

    /**
     * Complete a task
     * Simplified API for task completion
     * 
     * @param taskId - Task ID to complete
     * @param result - Task completion result
     * 
     * @example
     * ```typescript
     * await agent.channelService.completeTask('task-123', {
     *     scheduledTime: '2pm Tuesday',
     *     attendees: ['recruiter', 'candidate']
     * });
     * ```
     */
    public async completeTask(taskId: string, result: Record<string, any>): Promise<void> {
        const agentId = this.validateAgentId();
        
        // Use internal helper to complete task (hides EventBus from developer)
        await TaskHelper.completeTask(taskId, agentId, this.channelId, result);
    }

    /**
     * Cancel a task
     * Simplified API for task cancellation
     * 
     * @param taskId - Task ID to cancel
     * @param reason - Optional cancellation reason
     * 
     * @example
     * ```typescript
     * await agent.channelService.cancelTask('task-123', 'Client unavailable');
     * ```
     */
    public async cancelTask(taskId: string, reason?: string): Promise<void> {
        const agentId = this.validateAgentId();
        
        // Use internal helper to cancel task (hides EventBus from developer)
        await TaskHelper.cancelTask(taskId, agentId, this.channelId, reason);
    }

    // ============================================================
    // ADMIN OPERATIONS
    // ============================================================

    /**
     * Create a new channel (admin operation)
     * 
     * Creates a channel using event-driven architecture instead of HTTP API.
     * Requires admin/creator privileges.
     * 
     * @param config - Channel creation configuration
     * @returns Promise resolving to channel creation result
     * 
     * @example
     * ```typescript
     * const result = await agent.mxfService.createChannel({
     *     channelId: 'my-channel',
     *     name: 'My Channel',
     *     metadata: { purpose: 'Demo' }
     * });
     * console.log('Channel created:', result.channelId);
     * ```
     */
    public async createChannel(config: ChannelCreateConfig): Promise<ChannelCreateResult> {
        const agentId = this.validateAgentId();
        
        // Use internal helper (hides EventBus from developer)
        return await AdminHelper.createChannel(config, agentId);
    }

    /**
     * Generate a channel key (admin operation)
     * 
     * Generates authentication keys for agents to join channels.
     * Uses event-driven architecture instead of HTTP API.
     * 
     * @param config - Key generation configuration
     * @returns Promise resolving to generated key credentials
     * 
     * @example
     * ```typescript
     * const key = await agent.mxfService.generateKey({
     *     channelId: 'my-channel',
     *     agentId: 'new-agent',
     *     name: 'Agent Access Key',
     *     expiresAt: new Date(Date.now() + 86400000) // 24 hours
     * });
     * console.log('Key ID:', key.keyId);
     * console.log('Secret:', key.secretKey);
     * ```
     */
    public async generateKey(config: KeyGenerateConfig): Promise<KeyGenerateResult> {
        const agentId = this.validateAgentId();
        
        // Use internal helper (hides EventBus from developer)
        return await AdminHelper.generateKey(config, agentId);
    }

    /**
     * Deactivate a channel key (admin operation)
     * 
     * Deactivates an authentication key, preventing further use.
     * Uses event-driven architecture instead of HTTP API.
     * 
     * @param keyId - Key ID to deactivate
     * @returns Promise resolving when key is deactivated
     * 
     * @example
     * ```typescript
     * await agent.mxfService.deactivateKey('key_123');
     * console.log('Key deactivated');
     * ```
     */
    public async deactivateKey(keyId: string): Promise<void> {
        const agentId = this.validateAgentId();
        
        // Use internal helper (hides EventBus from developer)
        await AdminHelper.deactivateKey(keyId, this.channelId, agentId);
    }

    /**
     * List channel keys (admin operation)
     * 
     * Lists authentication keys for the current channel.
     * Uses event-driven architecture instead of HTTP API.
     * 
     * @param activeOnly - Whether to list only active keys (default: true)
     * @returns Promise resolving to array of key information
     * 
     * @example
     * ```typescript
     * const keys = await agent.mxfService.listKeys(true);
     * console.log(`Found ${keys.length} active keys`);
     * keys.forEach(key => {
     *     console.log(`- ${key.keyId}: ${key.name || 'Unnamed'}`);
     * });
     * ```
     */
    public async listKeys(activeOnly: boolean = true): Promise<KeyInfo[]> {
        const agentId = this.validateAgentId();
        
        // Use internal helper (hides EventBus from developer)
        return await AdminHelper.listKeys(this.channelId, agentId, activeOnly);
    }

    // ==================== PUBLIC EVENT API ====================

    /**
     * Listen to channel events
     * 
     * Captures all public events happening in this channel by filtering events
     * based on channelId. Only events in the PUBLIC_EVENTS whitelist can be listened to.
     * 
     * @param eventName - Public event name from Events namespace
     * @param handler - Event handler function
     * @returns This service instance for method chaining
     * @throws Error if event is not in public whitelist
     * 
     * @example
     * ```typescript
     * // Listen for all messages in the channel
     * agent.channelService.on(Events.Message.AGENT_MESSAGE, (payload) => {
     *     if (payload.channelId === 'my-channel') {
     *         console.log('Channel message:', payload);
     *     }
     * });
     * 
     * // Listen for task events in the channel
     * agent.channelService.on(Events.Task.COMPLETED, (payload) => {
     *     console.log('Task completed in channel:', payload);
     * });
     * ```
     */
    public on(eventName: PublicEventName, handler: (data: any) => void): this {
        // Validate event is in public whitelist
        if (!isPublicEvent(eventName)) {
            this.logger.warn(
                `Event '${eventName}' is not in the public whitelist. ` +
                `Only events from PUBLIC_EVENTS can be monitored. Ignoring listener.`
            );
            return this;
        }

        // Wrap handler to filter by channelId
        const channelFilteredHandler = (data: any): void => {
            // Only process events for this channel
            if (data.channelId === this.channelId) {
                handler(data);
            }
        };

        // Subscribe to event through EventBus
        const subscription = EventBus.client.on(eventName, channelFilteredHandler);

        // Track subscription for cleanup
        if (!this.channelEventListeners.has(eventName)) {
            this.channelEventListeners.set(eventName, []);
        }
        this.channelEventListeners.get(eventName)!.push(subscription);

        return this; // Allow chaining
    }

    /**
     * Remove a channel event listener
     * 
     * @param eventName - Public event name
     * @returns This service instance for method chaining
     * 
     * @example
     * ```typescript
     * // Remove all handlers for an event
     * agent.channelService.off(Events.Message.CHANNEL_MESSAGE);
     * ```
     */
    public off(eventName: PublicEventName): this {
        const subscriptions = this.channelEventListeners.get(eventName);
        
        if (subscriptions) {
            // Remove all handlers for this event
            subscriptions.forEach(sub => sub.unsubscribe());
            this.channelEventListeners.delete(eventName);
        }

        return this;
    }
}

export default MxfService;
