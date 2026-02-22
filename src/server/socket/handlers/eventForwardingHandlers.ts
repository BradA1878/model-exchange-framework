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
 * Event forwarding handlers for socket communications
 * 
 * Handles forwarding events between EventBus and Socket.IO with priority queue system
 */

import { Socket } from 'socket.io';
import { ISocketService } from '../../../shared/interfaces/SocketServiceInterface';
import {
    Events,
    CoreSocketEvents,
    ControlLoopEvents,
    OrparEvents,
    SOCKET_RESERVED_EVENTS
} from '../../../shared/events/EventNames';
import { clearAgentOrparState } from '../../../shared/protocols/mcp/tools/OrparTools';
import { TaskEvents } from '../../../shared/events/event-definitions/TaskEvents';
import { UserInputEvents } from '../../../shared/events/event-definitions/UserInputEvents';
import { UserInputRequestManager } from '../../../shared/services/UserInputRequestManager';
import { createStrictValidator } from '../../../shared/utils/validation';
import { logger , Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { v4 as uuidv4 } from 'uuid'; 
import {
    BaseEventPayload,
    createBaseEventPayload,
    createAgentEventPayload,
    createChannelEventPayload,
    createChannelMessageEventPayload,
    createTaskEventPayload,
    createConnectionEventPayload,
    createMcpToolCallPayload,
    createMcpToolRegisterPayload,
    createMcpResourceGetPayload,
    createMcpResourceListPayload,
    createUserInputResponsePayload,
    AgentEventData,
    ChannelEventData,
    TaskEventData,
    ConnectionEventData
} from '../../../shared/schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '../../../shared/types/ChannelContext'; 
import { ChannelActionType } from '../../../shared/events/event-definitions/ChannelEvents';
import { MxpMiddleware } from '../../../shared/middleware/MxpMiddleware';
import { isMxpMessage } from '../../../shared/schemas/MxpProtocolSchemas';
import { MxpEventForwardingEnhancer } from '../../../shared/mxp/MxpEventForwardingEnhancer';

// Create a module-specific logger
const moduleLogger = new Logger('debug', 'EventForwardingHandlers', 'server');

// Event priority levels for queue management
enum EventPriority {
    CRITICAL = 0,    // System failures, agent disconnections
    HIGH = 1,        // Task assignments, tool results
    NORMAL = 2,      // Agent messages, status updates
    LOW = 3,         // Discovery requests, heartbeats
    BACKGROUND = 4   // Memory updates, analytics
}

// Queued event structure
interface QueuedEvent {
    id: string;
    priority: EventPriority;
    type: 'agent' | 'channel';
    eventName: string;
    payload: any;
    targetId: string; // agentId or channelId
    excludedAgentId?: string; // for channel events
    timestamp: number;
    retryCount: number;
}

// Event queue configuration
interface EventQueueConfig {
    enabled: boolean;
    batchSize: number;
    processingDelayMs: number;
    maxQueueSize: number;
    maxRetries: number;
}

// Default configuration - configurable via environment variables for performance tuning
// Original values were: enabled=true, batchSize=10, processingDelayMs=25 (for testing)
// Reduced processingDelayMs default from 25 to 5 for production performance
const defaultQueueConfig: EventQueueConfig = {
    enabled: process.env.EVENT_QUEUE_ENABLED !== 'false',
    batchSize: parseInt(process.env.EVENT_QUEUE_BATCH_SIZE || '10', 10),
    processingDelayMs: parseInt(process.env.EVENT_QUEUE_DELAY_MS || '5', 10),
    maxQueueSize: parseInt(process.env.EVENT_QUEUE_MAX_SIZE || '1000', 10),
    maxRetries: parseInt(process.env.EVENT_QUEUE_MAX_RETRIES || '3', 10)
};

// Priority queue implementation
class EventForwardingQueue {
    private queues: Map<EventPriority, QueuedEvent[]> = new Map();
    private config: EventQueueConfig;
    private processing: boolean = false;
    private processingTimer: NodeJS.Timeout | null = null;
    private socketService: ISocketService | null = null;

    constructor(config: EventQueueConfig = defaultQueueConfig) {
        this.config = { ...config };
        
        // Initialize priority queues
        Object.values(EventPriority).forEach(priority => {
            if (typeof priority === 'number') {
                this.queues.set(priority, []);
            }
        });

    }

    // Set socket service for processing
    public setSocketService(socketService: ISocketService): void {
        this.socketService = socketService;
        if (this.config.enabled && !this.processing) {
            this.startProcessing();
        }
    }

    // Enable or disable the queue system
    public setEnabled(enabled: boolean): void {
        this.config.enabled = enabled;
        
        if (enabled && !this.processing && this.socketService) {
            this.startProcessing();
        } else if (!enabled && this.processing) {
            this.stopProcessing();
        }
    }

    // Check if queue is enabled
    public isEnabled(): boolean {
        return this.config.enabled;
    }

    // Enqueue an event for processing
    public enqueue(event: Omit<QueuedEvent, 'id' | 'timestamp' | 'retryCount'>): void {
        const validator = createStrictValidator('EventForwardingQueue.enqueue');
        validator.assertIsNonEmptyString(event.eventName);
        validator.assertIsNonEmptyString(event.targetId);

        const queuedEvent: QueuedEvent = {
            ...event,
            id: uuidv4(),
            timestamp: Date.now(),
            retryCount: 0
        };

        const queue = this.queues.get(event.priority);
        if (!queue) {
            moduleLogger.error(`Invalid event priority: ${event.priority}`);
            return;
        }

        // Check queue size limit
        const totalQueueSize = this.getTotalQueueSize();
        if (totalQueueSize >= this.config.maxQueueSize) {
            moduleLogger.warn(`Queue size limit reached (${this.config.maxQueueSize}), dropping event: ${event.eventName}`);
            return;
        }

        queue.push(queuedEvent);
        // ;

        // MXP 2.0 Enhancement: Also enqueue in MXP-enhanced system if enabled
        this.enqueueMxpEnhanced(queuedEvent);

        // Start processing if not already running
        if (this.config.enabled && !this.processing && this.socketService) {
            this.startProcessing();
        }
    }

    // MXP 2.0 Enhancement: Enqueue event with compression support
    private enqueueMxpEnhanced(event: QueuedEvent): void {
        try {
            // Determine channel ID for MXP configuration lookup
            let channelId: string | undefined;
            
            // Try to extract channel ID from the event payload or context
            if (event.payload && typeof event.payload === 'object') {
                channelId = event.payload.channelId || 
                           event.payload.context?.channelId ||
                           (event.type === 'channel' ? event.targetId : undefined);
            }

            if (channelId) {
                // Enqueue in MXP-enhanced system with compression support
                MxpEventForwardingEnhancer.getInstance().enqueueEvent(
                    event.eventName,
                    event.payload,
                    event.priority,
                    event.targetId,
                    event.type,
                    channelId,
                    event.excludedAgentId
                ).catch((error) => {
                    // Graceful degradation - original queue still works
                });
            }
        } catch (error) {
            // Graceful degradation - if MXP fails, original queue still works
        }
    }

    // Start processing events from queues
    private startProcessing(): void {
        if (this.processing) return;
        
        this.processing = true;
        this.scheduleNextBatch();
    }

    // Stop processing events
    private stopProcessing(): void {
        if (!this.processing) return;
        
        this.processing = false;
        if (this.processingTimer) {
            clearTimeout(this.processingTimer);
            this.processingTimer = null;
        }
    }

    // Schedule next batch processing
    private scheduleNextBatch(): void {
        if (!this.processing) return;

        this.processingTimer = setTimeout(() => {
            this.processBatch();
            this.scheduleNextBatch();
        }, this.config.processingDelayMs);
    }

    // Process a batch of events by priority
    private processBatch(): void {
        if (!this.socketService) return;

        const batch: QueuedEvent[] = [];
        
        // Collect events by priority (CRITICAL first)
        for (const priority of [EventPriority.CRITICAL, EventPriority.HIGH, EventPriority.NORMAL, EventPriority.LOW, EventPriority.BACKGROUND]) {
            const queue = this.queues.get(priority);
            if (queue && queue.length > 0) {
                const batchSize = Math.min(this.config.batchSize - batch.length, queue.length);
                batch.push(...queue.splice(0, batchSize));
                
                if (batch.length >= this.config.batchSize) break;
            }
        }

        // Process the batch
        for (const event of batch) {
            this.processEvent(event);
        }

        if (batch.length > 0) {
            // ;
        }
    }

    // Process a single event
    private processEvent(event: QueuedEvent): void {
        try {
            if (event.type === 'agent') {
                this.forwardToAgent(event);
            } else if (event.type === 'channel') {
                this.forwardToChannel(event);
            }
        } catch (error) {
            moduleLogger.error(`Error processing event ${event.eventName}: ${error}`);
            this.handleFailedEvent(event);
        }
    }

    // Forward event to specific agent
    private forwardToAgent(event: QueuedEvent): void {
        if (!this.socketService) return;
        
        const socket = this.socketService.getSocketByAgentId(event.targetId);
        if (!socket) {
            // ;
            return;
        }

        safelyEmitToSocket(socket, event.eventName, event.payload);
        //// ;
    }

    // Forward event to channel
    private forwardToChannel(event: QueuedEvent): void {
        if (!this.socketService) return;
        
        const roomName = this.socketService.getNormalizedChannelName(event.targetId);
        const io = this.socketService.getSocketServer();
        
        if (!io) {
            moduleLogger.error('Socket server not available for channel forwarding');
            return;
        }

        if (event.excludedAgentId) {
            const excludedSocket = this.socketService.getSocketByAgentId(event.excludedAgentId);
            if (excludedSocket) {
                io.to(roomName).except(excludedSocket.id).emit(event.eventName, event.payload);
            } else {
                io.to(roomName).emit(event.eventName, event.payload);
            }
        } else {
            io.to(roomName).emit(event.eventName, event.payload);
        }

        //// ;
    }

    // Handle failed event processing
    private handleFailedEvent(event: QueuedEvent): void {
        event.retryCount++;
        
        if (event.retryCount <= this.config.maxRetries) {
            // Re-queue for retry with lower priority
            const retryPriority = Math.min(event.priority + 1, EventPriority.BACKGROUND);
            const queue = this.queues.get(retryPriority);
            if (queue) {
                queue.push(event);
                // ;
            }
        } else {
            moduleLogger.error(`Dropping event ${event.eventName} after ${this.config.maxRetries} retries`);
        }
    }

    // Get total events in all queues
    private getTotalQueueSize(): number {
        let total = 0;
        for (const queue of this.queues.values()) {
            total += queue.length;
        }
        return total;
    }

    // Get queue statistics
    public getStats(): { [key: string]: number } {
        const stats: { [key: string]: number } = {
            totalEvents: this.getTotalQueueSize(),
            processing: this.processing ? 1 : 0,
            enabled: this.config.enabled ? 1 : 0
        };

        // Add per-priority queue sizes
        for (const [priority, queue] of this.queues.entries()) {
            stats[`priority_${priority}`] = queue.length;
        }

        return stats;
    }
}

// Global event queue instance
const eventQueue = new EventForwardingQueue();

// Determine event priority based on event name
const getEventPriority = (eventName: string): EventPriority => {
    // Critical events - system failures and disconnections
    if (eventName.includes('disconnect') || eventName.includes('error') || eventName.includes('failed')) {
        return EventPriority.CRITICAL;
    }
    
    // High priority - task management and tool results
    if (eventName.includes('task:assigned') || eventName.includes('task:completed') || 
        eventName.includes('mcp:tool:result') || eventName.includes('task:failed')) {
        return EventPriority.HIGH;
    }
    
    // Normal priority - agent communication and status
    if (eventName.includes('message:agent') || eventName.includes('message:channel') || 
        eventName.includes('agent:status') || eventName.includes('task:progress')) {
        return EventPriority.NORMAL;
    }
    
    // Low priority - discovery and heartbeats
    if (eventName.includes('discovery') || eventName.includes('heartbeat') || 
        eventName.includes('channel:member') || eventName.includes('agent:connect')) {
        return EventPriority.LOW;
    }
    
    // Background priority - memory and analytics
    if (eventName.includes('memory:') || eventName.includes('coordination:hint') || 
        eventName.includes('pattern_recognition') || eventName.includes('analytics')) {
        return EventPriority.BACKGROUND;
    }
    
    // Default to normal priority
    return EventPriority.NORMAL;
};

// Export queue control functions for external use
export const EventQueueControl = {
    setEnabled: (enabled: boolean): void => eventQueue.setEnabled(enabled),
    isEnabled: (): boolean => eventQueue.isEnabled(),
    getStats: (): { [key: string]: number } => eventQueue.getStats()
};

// Global flag to prevent multiple event handler registrations
let eventHandlersSetup = false;

/**
 * Set up event forwarding from EventBus to socket
 * This establishes forwarding for all relevant events from the EventBus to socket.io
 * 
 * @param socketService The socket service instance
 */
export const setupEventBusToSocketForwarding = (socketService: ISocketService): void => {
    try {
        if (eventHandlersSetup) {
            moduleLogger.warn('EventBus-to-socket forwarding already set up, skipping duplicate registration');
            return;
        }
        
        eventHandlersSetup = true;
        
        // Initialize the event queue with socket service
        eventQueue.setSocketService(socketService);
        
        // Keep track of events being processed to prevent recursion
        const processingEvents = new Set<string>();
        
        // Channel message events
        EventBus.server.on(Events.Message.CHANNEL_MESSAGE, async (payload) => {
            try {
                // Prevent recursive message forwarding
                const eventKey = `${Events.Message.CHANNEL_MESSAGE}-${JSON.stringify(payload)}`;
                if (processingEvents.has(eventKey)) {
                    return;
                }
                
                processingEvents.add(eventKey);
                
                // channelId must be at top-level of payload - enforce strict structure
                if (!payload.channelId || typeof payload.channelId !== 'string') {
                    moduleLogger.error(`Invalid CHANNEL_MESSAGE payload: missing or invalid top-level channelId. Payload structure: ${JSON.stringify(Object.keys(payload))}`);
                    return;
                }
                
                // Process MXP messages on the server side
                let processedPayload = payload;
                if (payload.data && isMxpMessage(payload.data.content)) {
                    try {
                        // Server-side MXP processing
                        // 1. Decrypt the incoming message
                        const decrypted = await MxpMiddleware.processIncoming(payload.data.content);
                        
                        // 2. Re-encrypt for each recipient (in the future, could be per-agent keys)
                        const reEncrypted = await MxpMiddleware.processOutgoing(
                            decrypted,
                            payload.data.senderId || 'server',
                            {
                                enableMxp: true,
                                forceEncryption: true
                            }
                        );
                        
                        // Update payload with processed content
                        processedPayload = {
                            ...payload,
                            data: {
                                ...payload.data,
                                content: reEncrypted
                            }
                        };
                        
                    } catch (error) {
                        moduleLogger.warn(`MXP server processing failed, forwarding original: ${error}`);
                        // Continue with original payload
                    }
                }
                
                forwardEventToChannel(socketService, Events.Message.CHANNEL_MESSAGE, processedPayload, processedPayload.channelId);
                
                // Release the event after processing
                setTimeout(() => {
                    processingEvents.delete(eventKey);
                }, 0);
            } catch (error) {
                moduleLogger.error(`Error forwarding channel message from EventBus: ${error}`);
            }
        });
        
        // Message error events - Forward validation errors back to the sending agent
        EventBus.server.on(Events.Message.MESSAGE_ERROR, (payload) => {
            try {
                // Forward message errors to the agent who attempted to send the message
                const targetAgentId = payload.agentId; // The agent who sent the invalid message
                
                if (targetAgentId) {
                    forwardEventToAgent(socketService, targetAgentId, Events.Message.MESSAGE_ERROR, payload);
                } else {
                    moduleLogger.warn('No target agent ID found in MESSAGE_ERROR payload');
                }
            } catch (error) {
                moduleLogger.error(`Error forwarding message error event: ${error}`);
            }
        });
        
        // Agent message events
        EventBus.server.on(Events.Message.AGENT_MESSAGE, async (payload) => {
            try {
                // Prevent recursive message forwarding
                const eventKey = `${Events.Message.AGENT_MESSAGE}-${JSON.stringify(payload)}`;
                if (processingEvents.has(eventKey)) {
                    return;
                }
                
                processingEvents.add(eventKey);
                
                // Process MXP messages on the server side
                let processedPayload = payload;
                if (payload.data && isMxpMessage(payload.data.content)) {
                    try {
                        // Server-side MXP processing for direct messages
                        // 1. Decrypt the incoming message
                        const decrypted = await MxpMiddleware.processIncoming(payload.data.content);
                        
                        // 2. Re-encrypt for the specific recipient
                        const reEncrypted = await MxpMiddleware.processOutgoing(
                            decrypted,
                            payload.data.senderId || 'server',
                            {
                                enableMxp: true,
                                forceEncryption: true
                            }
                        );
                        
                        // Update payload with processed content
                        processedPayload = {
                            ...payload,
                            data: {
                                ...payload.data,
                                content: reEncrypted
                            }
                        };
                        
                    } catch (error) {
                        moduleLogger.warn(`MXP server processing failed for agent message, forwarding original: ${error}`);
                        // Continue with original payload
                    }
                }
                
                // Extract target agent ID from the message data structure
                // The receiverId is in payload.data (the agent message object)
                const targetAgentId = processedPayload.data?.receiverId || processedPayload.toAgentId;
                
                if (targetAgentId) {
                    forwardEventToAgent(socketService, targetAgentId, Events.Message.AGENT_MESSAGE, processedPayload);
                } else {
                    moduleLogger.warn('No target agent ID found in AGENT_MESSAGE payload', { 
                        payloadKeys: Object.keys(payload || {}),
                        dataKeys: payload.data ? Object.keys(payload.data) : 'no data'
                    });
                }
                
                // Release the event after processing
                setTimeout(() => {
                    processingEvents.delete(eventKey);
                }, 0);
            } catch (error) {
                moduleLogger.error(`Error forwarding agent message from EventBus: ${error}`);
            }
        });
        
        // Handle other agent-related events (status updates, etc.)
        // These are routed to individual agents directly
        [
            // Agent events
            Events.Agent.CONNECTED,
            Events.Agent.REGISTERED,
            Events.Agent.REGISTRATION_FAILED,
            Events.Agent.STATUS_CHANGE,

            // Control loop events (server-orchestrated)
            ControlLoopEvents.INITIALIZE,
            ControlLoopEvents.INITIALIZED,
            ControlLoopEvents.STARTED,
            ControlLoopEvents.OBSERVATION,
            ControlLoopEvents.REASONING,
            ControlLoopEvents.PLAN,
            ControlLoopEvents.EXECUTION,
            ControlLoopEvents.REFLECTION,
            ControlLoopEvents.ACTION,
            ControlLoopEvents.STOPPED,
            ControlLoopEvents.ERROR,

            // ORPAR events (agent-driven cognitive documentation)
            OrparEvents.OBSERVE,
            OrparEvents.REASON,
            OrparEvents.PLAN,
            OrparEvents.ACT,
            OrparEvents.REFLECT,
            OrparEvents.STATUS,
            OrparEvents.ERROR,
            OrparEvents.CLEAR_STATE

        ].forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    const targetAgentId = payload.agentId;
                    
                    if (!targetAgentId) {
                        moduleLogger.warn(`Missing agentId in control loop event: ${eventName}`);
                        return;
                    }
                    
                    forwardEventToAgent(socketService, targetAgentId, eventName, payload);
                } catch (error) {
                    moduleLogger.error(`Error forwarding agent event from EventBus: ${eventName}, error: ${error}`);
                }
            });
        });

        // Special handler for ORPAR CLEAR_STATE - actually clears the state
        EventBus.server.on(OrparEvents.CLEAR_STATE, (payload) => {
            try {
                const { agentId, channelId } = payload;
                if (agentId && channelId) {
                    clearAgentOrparState(agentId, channelId);
                    moduleLogger.debug(`[ORPAR] Cleared state for ${agentId}:${channelId} via CLEAR_STATE event`);
                }
            } catch (error) {
                moduleLogger.error(`Error handling ORPAR CLEAR_STATE: ${error}`);
            }
        });

        // Handle agent disconnection events specially
        // These should be broadcast to OTHER agents in the channel, not to the disconnecting agent
        EventBus.server.on(Events.Agent.DISCONNECTED, (payload) => {
            try {
                const disconnectedAgentId = payload.agentId;
                const channelId = payload.channelId;

                if (!disconnectedAgentId) {
                    moduleLogger.warn(`Missing agentId in DISCONNECTED event`);
                    return;
                }

                if (!channelId) {
                    moduleLogger.warn(`Missing channelId in DISCONNECTED event`);
                    return;
                }

                // Cancel any pending user input requests for the disconnected agent
                // to avoid blocking promises hanging until the cleanup TTL fires
                const manager = UserInputRequestManager.getInstance();
                manager.cancelRequestsForAgent(disconnectedAgentId);

                // Broadcast to all OTHER agents in the channel (excluding the disconnected one)
                forwardEventToChannel(socketService, Events.Agent.DISCONNECTED, payload, channelId, disconnectedAgentId);
            } catch (error) {
                moduleLogger.error(`Error forwarding agent disconnection event: ${error}`);
            }
        });
        
        // Handle channel-related events
        // These are broadcast to all clients in a channel
        [
            Events.Channel.CREATED,
            Events.Channel.UPDATE,
            Events.Channel.DELETED,
            Events.Channel.ARCHIVED,
            Events.Channel.AGENT_JOINED,
            Events.Channel.AGENT_LEFT,
            Events.Channel.CONTEXT.TOPICS_EXTRACT,
            Events.Channel.CONTEXT.SUMMARY_GENERATE
        ].forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    if (eventName === Events.Channel.CONTEXT.SUMMARY_GENERATE) {
                    }
                    if (eventName === Events.Channel.CONTEXT.TOPICS_EXTRACT) {
                    }
                    
                    const channelId = payload.channelId;
                    
                    if (!channelId) {
                        moduleLogger.warn(`Missing channelId in channel event: ${eventName}`);
                        return;
                    }
                    
                    // Prevent recursive event forwarding
                    const eventKey = `${eventName}-${channelId}-${JSON.stringify(payload)}`;
                    if (processingEvents.has(eventKey)) {
                        return;
                    }
                    
                    processingEvents.add(eventKey);
                    
                    forwardEventToChannel(socketService, eventName, payload, channelId);
                    
                    // If this event targets a specific agent, also forward directly to that agent
                    if (payload.agentId) {
                        forwardEventToAgent(socketService, payload.agentId, eventName, payload);
                    }
                    
                    // Release the event after processing
                    setTimeout(() => {
                        processingEvents.delete(eventKey);
                    }, 0);
                } catch (error) {
                    moduleLogger.error(`Error forwarding channel event from EventBus: ${eventName}, error: ${error}`);
                }
            });
        });
        
        // Handle Memory events - Forward back to requesting agents
        [
            Events.Memory.GET_RESULT,
            Events.Memory.UPDATE_RESULT,
            Events.Memory.DELETE_RESULT
        ].forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator(`EventForwarding:${eventName}`);
                    
                    // Validate payload structure with fail-fast
                    validator.assertIsObject(payload, 'Memory event payload must be an object');
                    validator.assertIsNonEmptyString(payload.agentId, 'Memory event payload.agentId is required');
                    validator.assertIsNonEmptyString(payload.channelId, 'Memory event payload.channelId is required');
                    
                    const targetAgentId = payload.agentId;
                    
                    // Forward memory result events directly to the requesting agent
                    forwardEventToAgent(socketService, targetAgentId, eventName, payload);
                } catch (error) {
                    moduleLogger.error(`Error forwarding memory event from EventBus: ${eventName}, error: ${error}`);
                    throw error; // Fail fast - re-throw validation errors
                }
            });
        });
        
        // Handle MCP events - Forward back to requesting agents ONLY (not to channels)
        // Use deduplication to prevent duplicate event forwarding
        const mcpEventProcessingKeys = new Set<string>();

        [
            Events.Mcp.TOOL_RESULT,
            Events.Mcp.TOOL_ERROR,
            Events.Mcp.TOOL_REGISTERED,
            Events.Mcp.TOOL_UNREGISTERED,
            Events.Mcp.MXF_TOOL_LIST_RESULT,
            Events.Mcp.MXF_TOOL_LIST_ERROR,
            Events.Mcp.RESOURCE_RESULT,
            Events.Mcp.RESOURCE_ERROR,
            Events.Mcp.EXTERNAL_SERVER_REGISTERED,
            Events.Mcp.EXTERNAL_SERVER_UNREGISTERED,
            Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED,
            Events.Mcp.CHANNEL_SERVER_REGISTERED,
            Events.Mcp.CHANNEL_SERVER_UNREGISTERED,
            Events.Mcp.CHANNEL_SERVER_REGISTRATION_FAILED
        ].forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    // Log channel server events for debugging
                    if (eventName.includes('channel:server')) {
                        moduleLogger.info(`[MCP-RESPONSE] Forwarding ${eventName} to socket for agent ${payload.agentId}`);
                    }

                    const validator = createStrictValidator(`EventForwarding:${eventName}`);

                    // Validate payload structure with fail-fast
                    validator.assertIsObject(payload, 'MCP event payload must be an object');
                    validator.assertIsNonEmptyString(payload.agentId, 'MCP event payload.agentId is required');
                    validator.assertIsNonEmptyString(payload.channelId, 'MCP event payload.channelId is required');

                    const targetAgentId = payload.agentId;

                    // Create a unique key for deduplication using callId or eventId
                    const eventKey = `${eventName}-${targetAgentId}-${payload.data?.callId || payload.eventId || ''}`;

                    // Check if we've already processed this exact event
                    if (mcpEventProcessingKeys.has(eventKey)) {
                        moduleLogger.debug(`[MCP] Skipping duplicate event: ${eventKey}`);
                        return;
                    }

                    // Mark as processing
                    mcpEventProcessingKeys.add(eventKey);

                    // Forward MCP result events directly to the requesting agent ONLY
                    // IMPORTANT: Do NOT broadcast to channel - MCP results are agent-specific
                    forwardEventToAgent(socketService, targetAgentId, eventName, payload);

                    // Clean up processing key after a short delay to allow for late duplicates
                    setTimeout(() => {
                        mcpEventProcessingKeys.delete(eventKey);
                    }, 1000);
                } catch (error) {
                    moduleLogger.error(`Error forwarding MCP event from EventBus: ${eventName}, error: ${error}`);
                    throw error; // Fail fast - re-throw validation errors
                }
            });
        });
        
        // Handle user input events - Forward request/cancelled/timeout to channel,
        // and route responses back to UserInputRequestManager to resolve pending Promises
        EventBus.server.on(UserInputEvents.REQUEST, (payload) => {
            try {
                const channelId = payload.channelId;
                if (!channelId) {
                    moduleLogger.warn('Missing channelId in user_input:request event');
                    return;
                }
                // Broadcast request to all clients in the channel so any client can render the prompt
                forwardEventToChannel(socketService, UserInputEvents.REQUEST, payload, channelId);
            } catch (error) {
                moduleLogger.error(`Error forwarding user_input:request: ${error}`);
            }
        });

        EventBus.server.on(UserInputEvents.CANCELLED, (payload) => {
            try {
                const channelId = payload.channelId;
                if (!channelId) {
                    moduleLogger.warn('Missing channelId in user_input:cancelled event');
                    return;
                }
                forwardEventToChannel(socketService, UserInputEvents.CANCELLED, payload, channelId);
            } catch (error) {
                moduleLogger.error(`Error forwarding user_input:cancelled: ${error}`);
            }
        });

        EventBus.server.on(UserInputEvents.TIMEOUT, (payload) => {
            try {
                const channelId = payload.channelId;
                if (!channelId) {
                    moduleLogger.warn('Missing channelId in user_input:timeout event');
                    return;
                }
                forwardEventToChannel(socketService, UserInputEvents.TIMEOUT, payload, channelId);
            } catch (error) {
                moduleLogger.error(`Error forwarding user_input:timeout: ${error}`);
            }
        });

        // Handle user input responses — route to UserInputRequestManager to resolve the blocking tool call
        EventBus.server.on(UserInputEvents.RESPONSE, (payload) => {
            try {
                // All events use BaseEventPayload<T> wrapping — .data is always the source of truth
                if (!payload.data) {
                    moduleLogger.warn('Malformed user_input:response event: missing payload.data');
                    return;
                }
                const responseData = payload.data;
                if (!responseData.requestId) {
                    moduleLogger.warn('Missing requestId in user_input:response event');
                    return;
                }

                const manager = UserInputRequestManager.getInstance();
                manager.submitResponse(responseData.requestId, responseData.value);
            } catch (error) {
                moduleLogger.error(`Error processing user_input:response: ${error}`);
            }
        });

        // Handle task events - Forward to assigned agents and channels
        const taskEventProcessingKeys = new Set<string>();
        
        Object.values(TaskEvents).forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    // Create a unique key for this specific event to prevent duplication
                    const eventKey = `${eventName}-${payload.taskId}-${payload.agentId}-${payload.channelId}`;
                    
                    // Check if we're already processing this exact event
                    if (taskEventProcessingKeys.has(eventKey)) {
                        return;
                    }
                    
                    // Mark as processing
                    taskEventProcessingKeys.add(eventKey);
                    
                    // Clean up old keys after processing
                    setTimeout(() => {
                        taskEventProcessingKeys.delete(eventKey);
                    }, 1000);
                    
                    
                    // For task completion, failure, and cancellation events, only forward to the specific agent
                    if (eventName === TaskEvents.COMPLETED || 
                        eventName === TaskEvents.FAILED || 
                        eventName === TaskEvents.CANCELLED) {
                        
                        if (payload.agentId) {
                            forwardEventToAgent(socketService, payload.agentId, eventName, payload);
                        }
                        return;
                    }
                    
                    // For task assignment events, determine forwarding strategy based on assignment scope
                    if (eventName === TaskEvents.ASSIGNED) {
                        // Check if this is a multi-agent task (multiple agents assigned)
                        const isMultiAgentTask = payload.assignedAgents && Array.isArray(payload.assignedAgents) && payload.assignedAgents.length > 1;
                        
                        if (isMultiAgentTask) {
                            // Multi-agent task: forward to channel only (agents will filter for themselves)
                            if (payload.channelId) {
                                forwardEventToChannel(socketService, eventName, payload, payload.channelId);
                            }
                        } else {
                            // Single-agent task: forward to specific agent only
                            if (payload.agentId) {
                                forwardEventToAgent(socketService, payload.agentId, eventName, payload);
                            }
                        }
                        return;
                    }
                    
                    // For other task events (start, progress), forward based on context
                    if (payload.agentId && !payload.channelId) {
                        // Agent-specific event
                        forwardEventToAgent(socketService, payload.agentId, eventName, payload);
                    } else if (payload.channelId) {
                        // Channel-wide event
                        forwardEventToChannel(socketService, eventName, payload, payload.channelId);
                    }
                } catch (error) {
                    moduleLogger.error(`Error forwarding task event from EventBus: ${eventName}, error: ${error}`);
                }
            });
        });
        
    } catch (error) {
        moduleLogger.error(`Error setting up EventBus-to-socket forwarding: ${error}`);
    }
};

/**
 * Setup event forwarding from socket to EventBus
 * @param socket Socket instance
 * @param agentId Agent ID
 * @param channelId Channel ID
 */
export const setupSocketToEventBusForwarding = (
    socket: Socket,
    agentId: string, 
    channelId: string
): void => {
    try {
        const validator = createStrictValidator('EventForwardingHandlers.setupSocketToEventBusForwarding');
        validator.assertIsObject(socket);
        validator.assertIsNonEmptyString(agentId);
        // channelId can be undefined or empty if not in a channel context, so no assertion here


        // Forward core socket events like subscribe/unsubscribe
        // Note: We exclude Socket.IO's built-in reserved events (connect, disconnect, etc.) 
        // as they should only be handled by connection handlers, not forwarded through EventBus
        Object.values(CoreSocketEvents).forEach(eventName => {
            // Skip Socket.IO reserved events that should not be forwarded through EventBus
            if (SOCKET_RESERVED_EVENTS.includes(eventName)) {
                return;
            }
            
            socket.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator('setupSocketToEventBusForwarding');
                    validator.assertIsNonEmptyString(agentId, 'agentId');
                    validator.assertIsNonEmptyString(channelId, 'channelId');
                    
                    const structuredPayload = createBaseEventPayload(
                        eventName,
                        agentId,
                        channelId,
                        payload
                    );
                    EventBus.server.emit(eventName, structuredPayload);
                } catch (error) {
                    moduleLogger.error(`Error processing ${eventName}: ${error}`);
                }
            });
        });

        // Forward Message events
        Object.values(Events.Message).forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    // Ensure the event is only processed if it's a Message event type
                    if (Object.values(Events.Message).includes(eventName as any)) {
                        const validator = createStrictValidator('setupSocketToEventBusForwarding');
                        validator.assertIsNonEmptyString(agentId, 'agentId');
                        validator.assertIsNonEmptyString(channelId, 'channelId');
                        
                        if (eventName === Events.Message.CHANNEL_MESSAGE) {
                        }
                        
                        // Payload should already be a proper BaseEventPayload structure
                        // Validate it has the required EventPayload structure
                        if (!payload || typeof payload !== 'object' || 
                            !payload.eventId || !payload.eventType || !payload.agentId || !payload.channelId) {
                            throw new Error(`Invalid EventPayload structure received for ${eventName}`);
                        }
                        
                        if (eventName === Events.Message.CHANNEL_MESSAGE) {
                        }
                        
                        // Forward the already-structured payload directly to EventBus
                        EventBus.server.emit(eventName, payload);
                        
                        // Confirm forwarding for CHANNEL_MESSAGE events
                        if (eventName === Events.Message.CHANNEL_MESSAGE) {
                        }
                    }
                } catch (error) {
                    moduleLogger.error(`Error processing ${eventName}: ${error}`);
                }
            });
        });

        // Forward Memory events
        Object.values(Events.Memory).forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator('setupSocketToEventBusForwarding');
                    validator.assertIsNonEmptyString(agentId, 'agentId');
                    validator.assertIsNonEmptyString(channelId, 'channelId');

                    // Payload should already be a proper BaseEventPayload structure
                    // Validate it has the required EventPayload structure
                    if (!payload || typeof payload !== 'object' ||
                        !payload.eventId || !payload.eventType || !payload.agentId || !payload.channelId) {
                        throw new Error(`Invalid EventPayload structure received for ${eventName}`);
                    }

                    // Forward the already-structured payload directly to EventBus
                    EventBus.server.emit(eventName, payload);
                } catch (error) {
                    moduleLogger.error(`Error processing ${eventName}: ${error}`);
                }
            });
        });

        // Forward Meilisearch events (server-side indexing with embeddings)
        Object.values(Events.Meilisearch).forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    // Payload should already be a proper BaseEventPayload structure
                    // Forward directly to EventBus for server-side processing
                    EventBus.server.emit(eventName, payload);
                } catch (error) {
                    moduleLogger.error(`Error processing Meilisearch event ${eventName}: ${error}`);
                }
            });
        });

        // Forward Task events
        Object.values(TaskEvents).forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator('setupSocketToEventBusForwarding');
                    validator.assertIsNonEmptyString(agentId, 'agentId');
                    validator.assertIsNonEmptyString(channelId, 'channelId');
                    
                    
                    let structuredPayload;
                    
                    // Handle START_REQUEST differently - it doesn't need a full task object
                    if (eventName === TaskEvents.START_REQUEST) {
                        structuredPayload = createBaseEventPayload(
                            eventName,
                            agentId,
                            channelId,
                            {
                                taskId: payload.taskId || payload.data?.taskId,
                                startingAgentId: payload.startingAgentId || payload.data?.startingAgentId,
                                fromAgentId: agentId,
                                toAgentId: payload.toAgentId || payload.data?.toAgentId || agentId
                            }
                        );
                    } else {
                        // For other task events, include the full task object
                        structuredPayload = createTaskEventPayload(
                            eventName,
                            agentId,
                            channelId,
                            {
                                taskId: payload.taskId || payload.data?.taskId,
                                fromAgentId: agentId,
                                toAgentId: payload.toAgentId || payload.data?.toAgentId || agentId,
                                task: payload.data?.task || payload.task || payload.data || payload
                            }
                        );
                    }
                    
                    EventBus.server.emit(eventName, structuredPayload);
                } catch (error) {
                    moduleLogger.error(`Error processing task ${eventName}: ${error}`);
                }
            });
        });

        // Forward User Input RESPONSE events only (client → server direction).
        // Only RESPONSE is accepted from clients — REQUEST, CANCELLED, and TIMEOUT are
        // server→client events. Accepting them from clients would let any connected client
        // forge fake prompts or silently cancel pending requests.
        // Always reconstruct the payload using the authenticated socket-context agentId/channelId
        // to prevent clients from forging identity claims.
        socket.on(UserInputEvents.RESPONSE, (payload) => {
            try {
                // Extract raw response data — use .data if structured, otherwise treat as raw
                const rawData = (payload.data && payload.eventType) ? payload.data : payload;

                const structuredPayload = createUserInputResponsePayload(
                    agentId as AgentId,
                    channelId as ChannelId,
                    {
                        requestId: rawData.requestId,
                        value: rawData.value,
                        respondedBy: agentId,
                        timestamp: Date.now(),
                    }
                );
                EventBus.server.emit(UserInputEvents.RESPONSE, structuredPayload);
            } catch (error) {
                moduleLogger.error(`Error processing user input response event: ${error}`);
            }
        });

        // NOTE: MCP events are handled by setupMcpSocketToEventBusForwarding() - do not duplicate here

        // Forward generic events (less common from client, but possible)
        // Consider if a more specific list is needed instead of 'event'
        socket.on('event', (eventName: string, payload: any) => {
            try {
                const validator = createStrictValidator('setupSocketToEventBusForwarding');
                validator.assertIsNonEmptyString(agentId, 'agentId');
                validator.assertIsNonEmptyString(channelId, 'channelId');
                validator.assertIsNonEmptyString(eventName, 'eventName');
                
                const structuredPayload = createBaseEventPayload(
                    eventName,
                    agentId,
                    channelId,
                    payload
                );
                EventBus.server.emit(eventName, structuredPayload);
            } catch (error) {
                moduleLogger.error(`Error processing generic event ${eventName}: ${error}`);
            }
        });

    } catch (error) {
        moduleLogger.error(`Error setting up socket to EventBus forwarding: ${error}`);
    }
};

/**
 * Set up socket-to-EventBus forwarding for MCP events
 * This bridges client MCP socket events to server EventBus events
 * Following the same pattern as setupSocketToEventBusForwarding
 * 
 * @param socket The socket instance
 * @param agentId Agent ID associated with the socket  
 * @param channelId Channel ID for the connection context
 */
export const setupMcpSocketToEventBusForwarding = (socket: Socket, agentId: string, channelId: string): void => {
    try {
        const validator = createStrictValidator('EventForwardingHandlers.setupMcpSocketToEventBusForwarding');
        validator.assertIsObject(socket);
        validator.assertIsNonEmptyString(agentId);
        // channelId can be undefined or empty if not in a channel context, so no assertion here
        
        
        // Forward MCP events using the same pattern as other event forwarding
        Object.values(Events.Mcp).forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator('setupMcpSocketToEventBusForwarding');
                    validator.assertIsNonEmptyString(agentId, 'agentId');
                    // channelId can be empty for some contexts, so we don't validate it as non-empty

                    // Log channel server events for debugging
                    if (eventName.includes('channel:server')) {
                        moduleLogger.info(`[MCP-FORWARD] Received ${eventName} from socket, forwarding to EventBus.server`);
                    }
                    
                    // Check if payload is already a structured EventPayload
                    if (payload.eventId && payload.eventType && payload.data) {
                        // Already structured - just forward it
                        EventBus.server.emit(eventName, payload);
                        return;
                    }
                    
                    // For MCP events, we need to transform the raw socket payload into proper EventBus payload
                    // using the appropriate createMcp* helper functions
                    let structuredPayload;
                    
                    switch (eventName) {
                        case Events.Mcp.TOOL_CALL:
                            // Handle raw payloads using schema-defined structure
                            structuredPayload = createMcpToolCallPayload(
                                eventName,
                                agentId,
                                channelId,
                                {
                                    toolName: payload.toolName,
                                    callId: payload.callId || uuidv4(),
                                    arguments: payload.arguments || {}
                                }
                            );
                            break;
                            
                        case Events.Mcp.TOOL_REGISTER:
                            // Handle raw payloads using schema-defined structure
                            structuredPayload = createMcpToolRegisterPayload(
                                eventName,
                                agentId,
                                channelId,
                                {
                                    toolName: payload.toolName,
                                    description: payload.description,
                                    inputSchema: payload.inputSchema,
                                    registrationDetails: payload.registrationDetails || {}
                                }
                            );
                            break;
                            
                        // MXF Tool Service events (for client-server tool communication)
                        case Events.Mcp.MXF_TOOL_LIST:
                        case Events.Mcp.MXF_TOOL_LIST_RESULT:
                        case Events.Mcp.MXF_TOOL_LIST_ERROR:
                            // For MXF tool events, preserve the payload structure 
                            // as it contains requestId and other important metadata
                            structuredPayload = createBaseEventPayload(
                                eventName,
                                agentId,
                                channelId,
                                payload
                            );
                            break;
                            
                        case Events.Mcp.RESOURCE_GET:
                            structuredPayload = createMcpResourceGetPayload(
                                eventName,
                                agentId,
                                channelId,
                                {
                                    resourceUri: payload.uri || payload.resourceUri,
                                    requestId: payload.requestId || uuidv4()
                                }
                            );
                            break;
                            
                        case Events.Mcp.RESOURCE_LIST:
                            structuredPayload = createMcpResourceListPayload(
                                eventName,
                                agentId,
                                channelId,
                                {
                                    resourceUri: 'list', // Standard URI for list operations
                                    requestId: payload.requestId || uuidv4(),
                                    filter: payload.filter
                                }
                            );
                            break;
                            
                        default:
                            // For other MCP events, use the base payload structure
                            structuredPayload = createBaseEventPayload(
                                eventName,
                                agentId,
                                channelId,
                                payload
                            );
                            break;
                    }
                    
                    
                    // Forward the structured payload to EventBus
                    EventBus.server.emit(eventName, structuredPayload);
                    
                    
                } catch (error) {
                    moduleLogger.error(`Error processing MCP ${eventName}: ${error}`);
                }
            });
        });
        
        
    } catch (error) {
        moduleLogger.error(`Error setting up MCP socket-to-EventBus forwarding: ${error}`);
    }
};

/**
 * Extracts a channel action from an event name
 * Channel events typically have a structure like 'channel:created', 'channel:updated', etc.
 * 
 * @param eventName - The name of the channel-related event
 * @returns A valid ChannelActionType or default action
 */
const extractChannelAction = (eventName: string): ChannelActionType | 'created' | 'deleted' | 'updated' | 'archived' => {
    // Extract the action part after the colon
    const parts = eventName.split(':');
    if (parts.length >= 2) {
        const action = parts[1];
        // If it's a standard action, return it
        if (['created', 'deleted', 'updated', 'archived', 'join', 'leave', 'agent_joined', 'agent_left'].includes(action)) {
            return action as ChannelActionType | 'created' | 'deleted' | 'updated' | 'archived';
        }
    }
    // Default action if we can't extract a valid one
    return 'updated';
};

/**
 * Forward an event to a specific agent (with optional priority queue)
 * @param socketService SocketService instance
 * @param agentId Agent ID to forward the event to
 * @param eventName Event name to forward
 * @param payload Event payload to forward
 */
export const forwardEventToAgent = (
    socketService: ISocketService, 
    agentId: string, 
    eventName: string, 
    payload: any
): void => {
    try {
        const validator = createStrictValidator('forwardEventToAgent');
        
        // Add better type checking and logging for agentId
        if (typeof agentId !== 'string') {
            moduleLogger.error(`[forwardEventToAgent] agentId must be a string, got: ${typeof agentId}, value: ${JSON.stringify(agentId)}`);
            return;
        }
        
        // Validate parameters
        validator.assertIsNonEmptyString(agentId);
        validator.assertIsNonEmptyString(eventName);
        
        // Check if queuing is enabled
        if (eventQueue.isEnabled()) {
            // Queue the event with appropriate priority
            eventQueue.enqueue({
                priority: getEventPriority(eventName),
                type: 'agent',
                eventName,
                payload,
                targetId: agentId
            });
            // ;
            return;
        }
        
        // Direct forwarding (fallback for when queue is disabled)
        // ;
        
        // Get the socket for the agent
        const socket = socketService.getSocketByAgentId(agentId);
        
        // Skip if agent has no socket - don't show a warning as this is a normal case
        // during disconnect sequences
        if (!socket) {
            return;
        }
        
        // Forward the event to the socket
        safelyEmitToSocket(socket, eventName, payload);
        
        // ;
    } catch (error) {
        moduleLogger.error(`Error forwarding event to agent: ${error}`);
    }
};

/**
 * Safely emit an event to a socket
 * @param socket Socket to emit to
 * @param eventName Event name to emit
 * @param payload Event payload to emit
 */
export const safelyEmitToSocket = (
    socket: Socket,
    eventName: string,
    payload: any
): void => {
    try {
        if (socket && socket.connected) {
            // Add detailed debug logging for status change events
            if (eventName === Events.Agent.STATUS_CHANGE) {
                // ;
                
                // Validate payload structure
                if (!payload.data) {
                    moduleLogger.warn(`Invalid ${eventName} payload structure - missing data property`);
                }
                
                if (!payload.agentId) {
                    moduleLogger.warn(`Invalid ${eventName} payload structure - missing agentId property`);
                }
            }

            //// ;
            
            socket.emit(eventName, payload);
        } else {
            moduleLogger.warn(`[SOCKET EMIT] Cannot emit ${eventName} - socket not connected or missing`);
        }
    } catch (error) {
        moduleLogger.error(`Error emitting to socket: ${error}`);
    }
};

/**
 * Forward an event to a channel (with optional priority queue)
 * @param socketService SocketService instance
 * @param eventName Event name to forward
 * @param payload Event payload to forward
 * @param channelId Channel ID to forward to
 * @param excludedAgentId Agent ID to exclude from the forwarding (optional)
 */
export const forwardEventToChannel = (
    socketService: ISocketService,
    eventName: string,
    payload: any,
    channelId: string,
    excludedAgentId?: string
): void => {
    try {
        const validator = createStrictValidator('forwardEventToChannel');
        
        // Validate parameters
        validator.assertIsNonEmptyString(eventName);
        validator.assertIsNonEmptyString(channelId);
        
        // Check if queuing is enabled
        if (eventQueue.isEnabled()) {
            // Queue the event with appropriate priority
            eventQueue.enqueue({
                priority: getEventPriority(eventName),
                type: 'channel',
                eventName,
                payload,
                targetId: channelId,
                excludedAgentId
            });
            // ;
            return;
        }
        
        // Direct forwarding (fallback for when queue is disabled)
        // ;
        
        // Get normalized channel name
        const roomName = socketService.getNormalizedChannelName(channelId);
        
        // Get the socket server
        const io = socketService.getSocketServer();
        if (!io) {
            moduleLogger.error(`Socket server not available`);
            return;
        }
        
        // Forward the event to all sockets in the room, excluding the specified agent if any
        if (excludedAgentId) {
            // Get the socket ID for the excluded agent
            const excludedSocket = socketService.getSocketByAgentId(excludedAgentId);
            if (excludedSocket) {
                io.to(roomName).except(excludedSocket.id).emit(eventName, payload);
            } else {
                // If no socket found for excluded agent (likely already disconnected), just broadcast normally
                io.to(roomName).emit(eventName, payload);
            }
        } else {
            io.to(roomName).emit(eventName, payload);
        }
        
        // ;
    } catch (error) {
        moduleLogger.error(`Error forwarding event to channel: ${error}`);
    }
};