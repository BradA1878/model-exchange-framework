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
 * Event forwarding handlers for socket communications
 * 
 * Handles forwarding events between EventBus and Socket.IO with priority queue system
 */

import { Socket } from 'socket.io';
import { ISocketService } from '@mxf-dev/core/interfaces/SocketServiceInterface';
import {
    Events,
    CoreSocketEvents,
    ControlLoopEvents,
    OrparEvents,
    SOCKET_RESERVED_EVENTS
} from '@mxf-dev/core/events/EventNames';
import { clearAgentOrparState } from '@mxf-dev/core/protocols/mcp/tools/OrparTools';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import { UserInputEvents } from '@mxf-dev/core/events/event-definitions/UserInputEvents';
import { UserInputRequestManager } from '@mxf-dev/core/services/UserInputRequestManager';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { isAgentSocketMcpEventAllowed } from '../../api/middleware/runtimeFeaturePolicy';
import { logger , Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
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
    createMeilisearchIndexEventPayload,
    createMeilisearchBackfillEventPayload,
    AgentEventData,
    ChannelEventData,
    TaskEventData,
    ConnectionEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '@mxf-dev/core/types/ChannelContext'; 
import { ChannelActionType } from '@mxf-dev/core/events/event-definitions/ChannelEvents';
import { MxpMiddleware } from '@mxf-dev/core/middleware/MxpMiddleware';
import { isMxpMessage } from '@mxf-dev/core/schemas/MxpProtocolSchemas';
import { ChannelService } from '../services/ChannelService';
import { authorizeMeilisearchSocketRequest, buildMeilisearchIngressFailure } from '../security/MeilisearchIngressPolicy';
import {
    resolveTaskEventAgentTarget,
    TASK_SOCKET_EGRESS_EVENTS
} from './TaskEventRoutingPolicy';

// Create a module-specific logger
const moduleLogger = new Logger('debug', 'EventForwardingHandlers', 'server');

/** Explicit client-to-server event directions. New events fail closed. */
const AGENT_SOCKET_MESSAGE_REQUEST_EVENTS = [
    Events.Message.AGENT_MESSAGE,
    Events.Message.CHANNEL_MESSAGE
] as const;

const AGENT_SOCKET_MEMORY_REQUEST_EVENTS = [
    Events.Memory.GET,
    Events.Memory.UPDATE,
    Events.Memory.DELETE
] as const;

const AGENT_SOCKET_MEILISEARCH_REQUEST_EVENTS = [
    Events.Meilisearch.INDEX_REQUEST,
    Events.Meilisearch.BACKFILL_REQUEST,
    // The SDK's settled memory-load report; validated like a request, nothing indexed.
    Events.Meilisearch.BACKFILL_SETTLED
] as const;

const AGENT_SOCKET_TASK_REQUEST_EVENTS = [
    TaskEvents.REQUEST,
    TaskEvents.RESPONSE,
    TaskEvents.CREATE_REQUEST,
    TaskEvents.START_REQUEST,
    TaskEvents.COMPLETE_REQUEST,
    TaskEvents.FAIL_REQUEST,
    TaskEvents.CANCEL_REQUEST,
    TaskEvents.ASSIGN_REQUEST,
    TaskEvents.UPDATE_REQUEST,
    TaskEvents.WORKLOAD_ANALYZE_REQUEST,
    TaskEvents.ASSIGNMENT_REQUESTED
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

/**
 * The bus copy of a tool call carries the authorization the ingress attached
 * for the executor. The requester gets the call back without it: it needs
 * what it asked for, not its own credential scope.
 */
const withoutAuthorization = <T extends object>(payload: T): Omit<T, 'authorization'> => {
    const copy = { ...(payload as Record<string, unknown>) };
    delete copy.authorization;
    return copy as Omit<T, 'authorization'>;
};

const emitMeilisearchIngressError = (
    eventName: string,
    rawData: unknown,
    agentId: string,
    channelId: string,
    error: unknown
): void => {
    // A refused settled report has no requester waiting on it and is not a
    // backfill failure; it was logged by the caller and ends here.
    if (eventName === Events.Meilisearch.BACKFILL_SETTLED) {
        return;
    }
    const failure = buildMeilisearchIngressFailure(eventName, rawData, agentId, channelId, error);
    if (failure.event === Events.Meilisearch.INDEX_ERROR) {
        EventBus.server.emit(failure.event, createMeilisearchIndexEventPayload(
            failure.event, agentId, channelId, failure.data
        ));
        return;
    }
    EventBus.server.emit(failure.event, createMeilisearchBackfillEventPayload(
        failure.event, agentId, channelId, failure.data
    ));
};

const containsForeignChannelIdentity = (value: unknown, channelId: string): boolean => {
    const pending: unknown[] = [value];
    const visited = new Set<object>();

    while (pending.length > 0) {
        const current = pending.pop();
        if (current === null || typeof current !== 'object' || visited.has(current)) {
            continue;
        }
        visited.add(current);

        if (Array.isArray(current)) {
            pending.push(...current);
            continue;
        }

        const record = current as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(record, 'channelId') &&
            record.channelId !== channelId) {
            return true;
        }
        pending.push(...Object.values(record));
    }

    return false;
};

const authorizeSocketMemoryRequest = (
    requestData: Record<string, unknown>,
    agentId: string,
    channelId: string
): Record<string, unknown> | null => {
    const allowedChannelMemoryIds = new Set([
        channelId,
        `channel:messages:${channelId}`,
        `channel:context:${channelId}`,
        `channel:context:history:${channelId}`
    ]);

    switch (requestData.scope) {
        case 'agent':
            return requestData.id === agentId ? requestData : null;

        case 'channel': {
            if (typeof requestData.id !== 'string' ||
                !allowedChannelMemoryIds.has(requestData.id)) {
                return null;
            }

            if (requestData.key !== undefined &&
                (typeof requestData.key !== 'string' ||
                    !allowedChannelMemoryIds.has(requestData.key))) {
                return null;
            }

            // MemoryService supports a legacy keyed update shape. Do not let an
            // otherwise-valid channel id smuggle a different channel's key in
            // the update body.
            if (isRecord(requestData.data)) {
                const embeddedChannelKeys = Object.keys(requestData.data)
                    .filter(key => key.startsWith('channel:'));
                if (embeddedChannelKeys.some(key => !allowedChannelMemoryIds.has(key))) {
                    return null;
                }

                if (containsForeignChannelIdentity(requestData.data, channelId)) {
                    return null;
                }
            }

            return requestData;
        }

        case 'relationship': {
            const relationshipId = requestData.id;
            if (!Array.isArray(relationshipId) ||
                (relationshipId.length !== 2 && relationshipId.length !== 3) ||
                relationshipId.some(part => typeof part !== 'string' || part.length === 0) ||
                (relationshipId.length === 3 && relationshipId[2] !== channelId) ||
                (relationshipId[0] !== agentId && relationshipId[1] !== agentId)) {
                return null;
            }

            const peerAgentId = relationshipId[0] === agentId
                ? relationshipId[1]
                : relationshipId[0];
            const channelService = ChannelService.getInstance();
            if (!channelService.isParticipant(channelId, agentId) ||
                !channelService.isParticipant(channelId, peerAgentId)) {
                return null;
            }

            return {
                ...requestData,
                id: [relationshipId[0], relationshipId[1], channelId]
            };
        }

        default:
            return null;
    }
};

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
    channelId: string; // authenticated channel scope for delivery
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

        // Start processing if not already running
        if (this.config.enabled && !this.processing && this.socketService) {
            this.startProcessing();
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

        const socket = this.socketService.getSocketByAgentId(
            event.targetId,
            event.channelId
        );
        if (!socket) {
            // Log when critical events can't be delivered (socket not found)
            if (event.eventName.includes('tool:result') || event.eventName.includes('tool:error')) {
                moduleLogger.warn(`[EventQueue] Cannot deliver ${event.eventName} to agent ${event.targetId}: socket not found`);
            }
            return;
        }

        safelyEmitToSocket(socket, event.eventName, event.payload);
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
            const excludedSocket = this.socketService.getSocketByAgentId(
                event.excludedAgentId,
                event.channelId
            );
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
    
    // High priority - task management, tool results, and user input (confirmation prompts)
    if (eventName.includes('task:assigned') || eventName.includes('task:completed') ||
        eventName.includes('mcp:tool:result') || eventName.includes('task:failed') ||
        eventName.includes('user_input')) {
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
            Events.Agent.ERROR,

            // Control loop events (server-orchestrated)
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
        // Use deduplication to prevent duplicate event forwarding.
        // The tool call itself is forwarded too: its arguments are the only record
        // of what the agent asked for, and the docs promise them to
        // agent.on(Events.Mcp.TOOL_CALL). It was left out when this list was
        // created (results only), so that subscription never fired.
        const mcpEventProcessingKeys = new Set<string>();

        [
            Events.Mcp.TOOL_CALL,
            Events.Mcp.TOOL_RESULT,
            Events.Mcp.TOOL_ERROR,
            Events.Mcp.TOOL_REGISTERED,
            Events.Mcp.TOOL_UNREGISTERED,
            Events.Mcp.TOOL_LIST_RESULT,
            Events.Mcp.TOOL_LIST_ERROR,
            Events.Mcp.MXF_TOOL_LIST_RESULT,
            Events.Mcp.MXF_TOOL_LIST_ERROR,
            Events.Mcp.RESOURCE_RESULT,
            Events.Mcp.RESOURCE_ERROR,
            Events.Mcp.RESOURCE_LIST_RESULT,
            Events.Mcp.EXTERNAL_SERVER_REGISTERED,
            Events.Mcp.EXTERNAL_SERVER_UNREGISTERED,
            Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED,
            Events.Mcp.CHANNEL_SERVER_REGISTERED,
            Events.Mcp.CHANNEL_SERVER_UNREGISTERED,
            Events.Mcp.CHANNEL_SERVER_REGISTRATION_FAILED
        ].forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    // Log channel server events and tool result events for debugging
                    if (eventName.includes('channel:server')) {
                        moduleLogger.info(`[MCP-RESPONSE] Forwarding ${eventName} to socket for agent ${payload.agentId}`);
                    }
                    if (eventName === Events.Mcp.TOOL_RESULT || eventName === Events.Mcp.TOOL_ERROR) {
                        moduleLogger.debug(`[MCP-RESULT] Forwarding ${eventName} to agent ${payload.agentId} (callId: ${payload.data?.callId || 'unknown'})`);
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

                    // Forward MCP events directly to the requesting agent ONLY
                    // IMPORTANT: Do NOT broadcast to channel - MCP results are agent-specific
                    forwardEventToAgent(
                        socketService,
                        targetAgentId,
                        eventName,
                        eventName === Events.Mcp.TOOL_CALL ? withoutAuthorization(payload) : payload
                    );

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

        // Meilisearch outcomes may contain indexed content and operational
        // details. They are observable by the requesting agent only; never
        // restore the former EventBus-wide Socket.IO broadcast for them.
        [
            Events.Meilisearch.INDEX,
            Events.Meilisearch.INDEX_ERROR,
            Events.Meilisearch.BACKFILL_COMPLETE,
            Events.Meilisearch.BACKFILL_PARTIAL,
            Events.Meilisearch.BACKFILL_ERROR
        ].forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator(`EventForwarding:${eventName}`);
                    validator.assertIsObject(payload, 'Meilisearch event payload must be an object');
                    validator.assertIsNonEmptyString(
                        payload.agentId,
                        'Meilisearch event payload.agentId is required'
                    );
                    validator.assertIsNonEmptyString(
                        payload.channelId,
                        'Meilisearch event payload.channelId is required'
                    );

                    forwardEventToAgent(
                        socketService,
                        payload.agentId,
                        eventName,
                        payload
                    );
                } catch (error) {
                    moduleLogger.error(
                        `Error forwarding Meilisearch event from EventBus: ${eventName}, error: ${error}`
                    );
                    throw error;
                }
            });
        });

        // User-input prompts and request ids belong to one exact agent. Peers in
        // the same channel do not need them and must not be able to race or read
        // the prompt. All lifecycle delivery is requester-targeted.
        [
            UserInputEvents.REQUEST,
            UserInputEvents.CANCELLED,
            UserInputEvents.TIMEOUT
        ].forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator(`EventForwarding:${eventName}`);
                    validator.assertIsObject(payload, 'User input event payload must be an object');
                    validator.assertIsNonEmptyString(
                        payload.agentId,
                        'User input event payload.agentId is required'
                    );
                    validator.assertIsNonEmptyString(
                        payload.channelId,
                        'User input event payload.channelId is required'
                    );
                    forwardEventToAgent(
                        socketService,
                        payload.agentId,
                        eventName,
                        payload
                    );
                } catch (error) {
                    moduleLogger.error(`Error forwarding ${eventName}: ${error}`);
                    throw error;
                }
            });
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
                manager.submitResponse(
                    responseData.requestId,
                    responseData.value,
                    payload.agentId,
                    payload.channelId
                );

                // The response can contain human-entered secrets. Only the
                // authenticated agent that owns the pending request receives it;
                // peers in the room must not see the value.
                forwardEventToAgent(
                    socketService,
                    payload.agentId,
                    UserInputEvents.RESPONSE,
                    payload
                );
            } catch (error) {
                moduleLogger.error(`Error processing user_input:response: ${error}`);
            }
        });

        // Handle task events - Forward to assigned agents and channels
        const taskEventProcessingKeys = new Set<string>();
        
        // TaskEvents also contains client -> server write requests. Only the
        // explicitly reviewed egress set may acquire an outbound socket handler;
        // otherwise a CREATE/COMPLETE/etc. request would be echoed to peers before
        // its authoritative handler had accepted and persisted it.
        TASK_SOCKET_EGRESS_EVENTS.forEach(eventName => {
            EventBus.server.on(eventName, (payload) => {
                try {
                    if (typeof payload?.eventId !== 'string' || payload.eventId.length === 0) {
                        moduleLogger.warn(`Dropped task event without eventId: ${eventName}`);
                        return;
                    }

                    // eventId identifies one exact envelope. Reading taskId from
                    // the envelope root made every helper-built task (whose id is
                    // in data.taskId) collide for one second.
                    const eventKey = `${eventName}-${payload.eventId}`;
                    
                    // Check if we're already processing this exact event
                    if (taskEventProcessingKeys.has(eventKey)) {
                        return;
                    }
                    
                    // Mark as processing
                    taskEventProcessingKeys.add(eventKey);
                    
                    // Clean up old keys after processing
                    const cleanupTimer = setTimeout(() => {
                        taskEventProcessingKeys.delete(eventKey);
                    }, 1000);
                    cleanupTimer.unref?.();

                    // Legacy task requests and responses are private peer
                    // messages. Route them only to their same-channel target.
                    if (eventName === TaskEvents.REQUEST ||
                        eventName === TaskEvents.RESPONSE) {
                        const targetAgentId = payload.data?.toAgentId;
                        if (typeof payload.channelId !== 'string' ||
                            typeof targetAgentId !== 'string' ||
                            targetAgentId.trim().length === 0 ||
                            !ChannelService.getInstance().isParticipant(
                                payload.channelId,
                                targetAgentId
                            )) {
                            moduleLogger.warn(
                                `Dropped ${eventName} with an invalid same-channel target`
                            );
                            return;
                        }

                        forwardEventToAgent(
                            socketService,
                            targetAgentId,
                            eventName,
                            payload
                        );
                        return;
                    }

                    const taskTarget = resolveTaskEventAgentTarget(eventName, payload);
                    if (taskTarget) {
                        if (!ChannelService.getInstance().isParticipant(payload.channelId, taskTarget)) {
                            moduleLogger.warn(
                                `Dropped ${eventName}: target ${taskTarget} is not a participant ` +
                                `in ${payload.channelId}`
                            );
                            return;
                        }
                        forwardEventToAgent(socketService, taskTarget, eventName, payload);
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
 * Check a client envelope against the identity the socket actually authenticated as.
 *
 * `socketAgentId` and `socketChannelId` come from socket.data, which is written by
 * the channel-key validation at connect time. A payload that claims a different
 * agent or channel is either a client bug or an impersonation attempt; either way
 * it is dropped and the sender is told, rather than being quietly rewritten.
 *
 * @param eventName - Event the client emitted
 * @param payload - Client-supplied event envelope
 * @param socketAgentId - Agent this socket authenticated as
 * @param socketChannelId - Channel this socket's key is bound to
 * @returns True when the envelope matches; false when it was rejected
 */
const assertMatchesSocketIdentity = (
    eventName: string,
    payload: { eventType?: unknown; agentId?: unknown; channelId?: unknown },
    socketAgentId: string,
    socketChannelId: string
): boolean => {
    const claimedAgentId = payload.agentId;
    const claimedChannelId = payload.channelId;

    if (payload.eventType === eventName &&
        claimedAgentId === socketAgentId &&
        claimedChannelId === socketChannelId) {
        return true;
    }

    moduleLogger.warn(
        `Rejected ${eventName} from agent ${socketAgentId} on channel ${socketChannelId}: ` +
        `payload claims eventType=${String(payload.eventType)} ` +
        `agentId=${String(claimedAgentId)} channelId=${String(claimedChannelId)}`
    );

    // Tell the sender. MESSAGE_ERROR is forwarded back to payload.agentId by the
    // EventBus-to-socket path, so it is addressed with the authenticated identity.
    EventBus.server.emit(
        Events.Message.MESSAGE_ERROR,
        createBaseEventPayload(
            Events.Message.MESSAGE_ERROR,
            socketAgentId as AgentId,
            socketChannelId as ChannelId,
            {
                error: `Rejected ${eventName}: payload type and identity must match the authenticated socket event`,
                rejectedEvent: eventName
            }
        )
    );

    return false;
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

        // Forward Message events.
        //
        // The client's envelope is checked against the authenticated socket
        // context and then thrown away: the payload that reaches EventBus is
        // rebuilt from `agentId`/`channelId`, which come from socket.data at
        // connection time and cannot be chosen by the client. `senderId` inside
        // the message body is overwritten for the same reason — it is an identity
        // claim, and the only identity we trust is the one the channel key
        // authenticated.
        //
        // This used to forward the client's object verbatim after checking only
        // that the fields were present, so any connected agent could post into
        // any channel as any agent.
        AGENT_SOCKET_MESSAGE_REQUEST_EVENTS.forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator('setupSocketToEventBusForwarding');
                    validator.assertIsNonEmptyString(agentId, 'agentId');
                    validator.assertIsNonEmptyString(channelId, 'channelId');

                    // Payload should already be a proper BaseEventPayload structure
                    if (!payload || typeof payload !== 'object' ||
                        !payload.eventId || !payload.eventType || !payload.agentId || !payload.channelId) {
                        throw new Error(`Invalid EventPayload structure received for ${eventName}`);
                    }

                    if (!assertMatchesSocketIdentity(eventName, payload, agentId, channelId)) {
                        return;
                    }

                    const messageContext = isRecord(payload.data?.context)
                        ? { ...payload.data.context, channelId }
                        : { channelId };
                    const messageData = isRecord(payload.data)
                        ? {
                            ...payload.data,
                            senderId: agentId,
                            context: messageContext
                        }
                        : payload.data;

                    if (eventName === Events.Message.AGENT_MESSAGE) {
                        const receiverId = isRecord(messageData)
                            ? messageData.receiverId
                            : undefined;
                        if (typeof receiverId !== 'string' ||
                            receiverId.trim().length === 0 ||
                            !ChannelService.getInstance().isParticipant(channelId, receiverId)) {
                            moduleLogger.warn(
                                `Denied direct message from ${agentId} to a non-participant in ${channelId}`
                            );
                            EventBus.server.emit(
                                Events.Message.MESSAGE_ERROR,
                                createBaseEventPayload(
                                    Events.Message.MESSAGE_ERROR,
                                    agentId,
                                    channelId,
                                    {
                                        originalEvent: eventName,
                                        error: 'Direct message recipient is not a participant in the authenticated channel'
                                    }
                                )
                            );
                            return;
                        }
                    }

                    const structuredPayload = createBaseEventPayload(
                        eventName,
                        agentId as AgentId,
                        channelId as ChannelId,
                        messageData
                    );

                    EventBus.server.emit(eventName, structuredPayload);
                } catch (error) {
                    moduleLogger.error(`Error processing ${eventName}: ${error}`);
                }
            });
        });

        // Forward Memory events.
        //
        // Same rule as messages: the envelope is rebuilt from the authenticated
        // socket context. Memory results are routed back by `payload.agentId`, so
        // a forged envelope both hid the requester and delivered another agent's
        // memory to a socket of the attacker's choosing.
        AGENT_SOCKET_MEMORY_REQUEST_EVENTS.forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator('setupSocketToEventBusForwarding');
                    validator.assertIsNonEmptyString(agentId, 'agentId');
                    validator.assertIsNonEmptyString(channelId, 'channelId');

                    // Payload should already be a proper BaseEventPayload structure
                    if (!payload || typeof payload !== 'object' ||
                        !payload.eventId || !payload.eventType || !payload.agentId || !payload.channelId) {
                        throw new Error(`Invalid EventPayload structure received for ${eventName}`);
                    }

                    if (!assertMatchesSocketIdentity(eventName, payload, agentId, channelId)) {
                        return;
                    }

                    const untrustedRequestData = isRecord(payload.data) ? payload.data : {};
                    const requestData = authorizeSocketMemoryRequest(
                        untrustedRequestData,
                        agentId,
                        channelId
                    );
                    if (!requestData) {
                        moduleLogger.warn(
                            `Denied unauthorized ${eventName} memory scope from socket ${socket.id}`
                        );

                        const resultEvent = eventName === Events.Memory.GET
                            ? Events.Memory.GET_RESULT
                            : eventName === Events.Memory.UPDATE
                                ? Events.Memory.UPDATE_RESULT
                                : Events.Memory.DELETE_RESULT;
                        const error = 'Memory request is outside the authenticated socket scope';
                        const resultData = eventName === Events.Memory.DELETE
                            ? {
                                operationId: untrustedRequestData.operationId,
                                scope: untrustedRequestData.scope,
                                id: untrustedRequestData.id,
                                success: false,
                                error
                            }
                            : {
                                operationId: untrustedRequestData.operationId,
                                scope: untrustedRequestData.scope,
                                id: untrustedRequestData.id,
                                memory: null,
                                error
                            };
                        EventBus.server.emit(
                            resultEvent,
                            createBaseEventPayload(resultEvent, agentId, channelId, resultData)
                        );
                        return;
                    }

                    const structuredPayload = createBaseEventPayload(
                        eventName,
                        agentId as AgentId,
                        channelId as ChannelId,
                        requestData
                    );

                    EventBus.server.emit(eventName, structuredPayload);
                } catch (error) {
                    moduleLogger.error(`Error processing ${eventName}: ${error}`);
                }
            });
        });

        // Forward only Meilisearch client requests. Results and errors are
        // server-owned and must never be injected back into the server bus.
        AGENT_SOCKET_MEILISEARCH_REQUEST_EVENTS.forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    if (!payload || typeof payload !== 'object' ||
                        !payload.eventId || !payload.eventType || !payload.agentId || !payload.channelId) {
                        throw new Error(`Invalid EventPayload structure received for ${eventName}`);
                    }

                    if (!assertMatchesSocketIdentity(eventName, payload, agentId, channelId)) {
                        throw new Error('Meilisearch request identity does not match the authenticated socket');
                    }

                    const safeData = authorizeMeilisearchSocketRequest(
                        eventName,
                        payload.data,
                        agentId,
                        channelId
                    );

                    EventBus.server.emit(
                        eventName,
                        createBaseEventPayload(eventName, agentId, channelId, safeData)
                    );
                } catch (error) {
                    moduleLogger.error(`Error processing Meilisearch event ${eventName}: ${error}`);
                    emitMeilisearchIngressError(
                        eventName,
                        payload?.data,
                        agentId,
                        channelId,
                        error
                    );
                }
            });
        });

        // Forward only task requests. Lifecycle transitions, results, and
        // orchestration notifications originate on the server.
        AGENT_SOCKET_TASK_REQUEST_EVENTS.forEach(eventName => {
            socket.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator('setupSocketToEventBusForwarding');
                    validator.assertIsNonEmptyString(agentId, 'agentId');
                    validator.assertIsNonEmptyString(channelId, 'channelId');

                    const isStructuredPayload = payload !== null &&
                        typeof payload === 'object' &&
                        typeof payload.eventId === 'string' &&
                        typeof payload.eventType === 'string' &&
                        Object.prototype.hasOwnProperty.call(payload, 'data');

                    if (isStructuredPayload &&
                        !assertMatchesSocketIdentity(eventName, payload, agentId, channelId)) {
                        return;
                    }

                    const rawData = isStructuredPayload ? payload.data : payload;
                    const requestData = rawData !== null && typeof rawData === 'object'
                        ? rawData
                        : {};

                    if (eventName === TaskEvents.REQUEST ||
                        eventName === TaskEvents.RESPONSE) {
                        const targetAgentId = requestData.toAgentId;
                        if (typeof targetAgentId !== 'string' ||
                            targetAgentId.trim().length === 0 ||
                            !ChannelService.getInstance().isParticipant(
                                channelId,
                                targetAgentId
                            )) {
                            moduleLogger.warn(
                                `Denied ${eventName} from ${agentId}: ` +
                                `target is not a participant in ${channelId}`
                            );
                            return;
                        }
                    }

                    let structuredPayload;
                    
                    // Handle START_REQUEST differently - it doesn't need a full task object
                    if (eventName === TaskEvents.START_REQUEST) {
                        structuredPayload = createBaseEventPayload(
                            eventName,
                            agentId,
                            channelId,
                            {
                                taskId: requestData.taskId,
                                requestId: requestData.requestId,
                                startingAgentId: agentId,
                                fromAgentId: agentId,
                                toAgentId: requestData.toAgentId || agentId,
                                task: requestData.task ?? `Start task ${String(requestData.taskId ?? '')}`
                            }
                        );
                    } else {
                        // For other task events, include the full task object
                        structuredPayload = createTaskEventPayload(
                            eventName,
                            agentId,
                            channelId,
                            {
                                taskId: requestData.taskId,
                                requestId: requestData.requestId,
                                fromAgentId: agentId,
                                toAgentId: requestData.toAgentId || agentId,
                                task: requestData.task || requestData,
                                ...(eventName === TaskEvents.COMPLETE_REQUEST
                                    ? {
                                        completingAgentId: agentId,
                                        result: requestData.result,
                                        completedAt: requestData.completedAt
                                    }
                                    : {}),
                                ...(eventName === TaskEvents.FAIL_REQUEST
                                    ? {
                                        failingAgentId: agentId,
                                        error: requestData.error,
                                        failedAt: requestData.failedAt
                                    }
                                    : {}),
                                ...(eventName === TaskEvents.CANCEL_REQUEST
                                    ? {
                                        cancellingAgentId: agentId,
                                        reason: requestData.reason,
                                        cancelledAt: requestData.cancelledAt
                                    }
                                    : {}),
                                ...(eventName === TaskEvents.ASSIGN_REQUEST
                                    ? { targetAgentId: requestData.targetAgentId }
                                    : {}),
                                ...(eventName === TaskEvents.WORKLOAD_ANALYZE_REQUEST
                                    ? { targetChannelId: requestData.targetChannelId }
                                    : {})
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

        // There is deliberately no generic `event` passthrough here.
        //
        // A `socket.on('event', (eventName, payload) => EventBus.server.emit(eventName, ...))`
        // handler used to sit at this spot. It let any connected client put any
        // event name onto the server bus — including the internal names the server
        // acts on, such as task lifecycle and MCP tool calls — which routed around
        // every per-family check above. Clients emit the specific events they need;
        // each family is forwarded explicitly, with its identity rebuilt from the
        // authenticated socket.

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
        
        
        // Only install listeners for reviewed client-to-server request events.
        // Response, lifecycle, observability, and process-management event names
        // are server-owned and therefore cannot be injected by an agent socket.
        Object.values(Events.Mcp)
            .filter(isAgentSocketMcpEventAllowed)
            .forEach(eventName => {
                socket.on(eventName, (payload) => {
                try {
                    const validator = createStrictValidator('setupMcpSocketToEventBusForwarding');
                    validator.assertIsNonEmptyString(agentId, 'agentId');
                    // channelId can be empty for some contexts, so we don't validate it as non-empty

                    const isStructuredPayload = payload !== null &&
                        typeof payload === 'object' &&
                        typeof payload.eventId === 'string' &&
                        typeof payload.eventType === 'string' &&
                        Object.prototype.hasOwnProperty.call(payload, 'data');

                    if (isStructuredPayload && payload.eventType !== eventName) {
                        moduleLogger.warn(
                            `Denied MCP envelope type mismatch from socket ${socket.id}: ` +
                            `listener=${eventName}, envelope=${String(payload.eventType)}`
                        );
                        return;
                    }

                    // Never trust identity fields from an incoming envelope. Only
                    // its data is accepted; a fresh envelope is built below from
                    // the authenticated socket's agent and channel.
                    const rawData = isStructuredPayload ? payload.data : payload;
                    const requestData = rawData !== null && typeof rawData === 'object'
                        ? rawData
                        : {};
                    const authenticatedKeyId = socket.data?.keyId;
                    if (typeof authenticatedKeyId !== 'string' || authenticatedKeyId.trim().length === 0) {
                        moduleLogger.warn(`Denied MCP request without an authenticated key on socket ${socket.id}`);
                        return;
                    }
                    const effectiveAllowedTools = socket.data?.effectiveAllowedTools;
                    if (effectiveAllowedTools !== undefined && !Array.isArray(effectiveAllowedTools)) {
                        moduleLogger.warn(`Denied MCP request with invalid server tool policy on socket ${socket.id}`);
                        return;
                    }
                    const authorization = {
                        keyId: authenticatedKeyId,
                        allowedTools: effectiveAllowedTools === undefined
                            ? undefined
                            : [...effectiveAllowedTools]
                    };
                    
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
                                    toolName: requestData.toolName,
                                    callId: requestData.callId || uuidv4(),
                                    arguments: requestData.arguments || {}
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
                                    toolName: requestData.toolName,
                                    description: requestData.description,
                                    inputSchema: requestData.inputSchema,
                                    registrationDetails: requestData.registrationDetails || {}
                                }
                            );
                            break;

                        // MXF Tool Service events (for client-server tool communication)
                        case Events.Mcp.TOOL_UNREGISTER:
                        case Events.Mcp.TOOL_LIST:
                        case Events.Mcp.MXF_TOOL_LIST:
                            structuredPayload = createBaseEventPayload(
                                eventName,
                                agentId,
                                channelId,
                                requestData
                            );
                            break;
                            
                        case Events.Mcp.RESOURCE_GET:
                            structuredPayload = createMcpResourceGetPayload(
                                eventName,
                                agentId,
                                channelId,
                                {
                                    resourceUri: requestData.uri || requestData.resourceUri,
                                    requestId: requestData.requestId || uuidv4()
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
                                    requestId: requestData.requestId || uuidv4(),
                                    filter: requestData.filter
                                }
                            );
                            break;

                        default:
                            // The feature policy is the source of the request
                            // allowlist. Fail closed if the two ever drift.
                            moduleLogger.warn(`Denied unhandled MCP request event ${eventName}`);
                            return;
                    }
                    
                    
                    // Forward the structured payload to EventBus
                    EventBus.server.emit(eventName, {
                        ...structuredPayload,
                        authorization
                    });
                    
                    
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
        validator.assertIsObject(payload);
        validator.assertIsNonEmptyString(
            payload.channelId,
            'Agent-targeted event payload.channelId is required'
        );
        
        // Check if queuing is enabled
        if (eventQueue.isEnabled()) {
            // Queue the event with appropriate priority
            eventQueue.enqueue({
                priority: getEventPriority(eventName),
                type: 'agent',
                eventName,
                payload,
                targetId: agentId,
                channelId: payload.channelId
            });
            // ;
            return;
        }
        
        // Direct forwarding (fallback for when queue is disabled)
        // ;
        
        // Get the socket for the agent
        const socket = socketService.getSocketByAgentId(agentId, payload.channelId);
        
        // Skip if agent has no socket — log a warning for critical events (tool results)
        // since these are required for agent loop progress. Silence for normal disconnect sequences.
        if (!socket) {
            if (eventName.includes('tool:result') || eventName.includes('tool:error')) {
                moduleLogger.warn(`[forwardEventToAgent] Cannot deliver ${eventName} to agent ${agentId}: socket not found (queue disabled)`);
            }
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
                channelId,
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
            const excludedSocket = socketService.getSocketByAgentId(
                excludedAgentId,
                channelId
            );
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
