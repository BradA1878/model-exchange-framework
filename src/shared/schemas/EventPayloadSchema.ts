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
 * EventPayloadSchema.ts
 * 
 * Defines standardized event payload schemas used throughout the Model Exchange Framework.
 * These schemas provide a consistent structure for all events exchanged between components.
 */

import { v4 as uuidv4 } from 'uuid';
import { ChannelActionType, EventName, Events } from '../events/EventNames'; 
import { createStrictValidator } from '../utils/validation';
import { AgentId, ChannelId } from '../types/ChannelContext';
import { MemoryScope } from '../types/MemoryTypes';
import { ChannelMessage, AgentMessage } from './MessageSchemas';
import { Logger } from '../utils/Logger'; 

// Create logger instance for event payload schema
const logger = new Logger('warn', 'EventPayloadSchema', 'server');

/**
 * Base interface for all event payloads.
 * Enforces mandatory fields for all events in the system.
 */
export interface BaseEventPayload<TData = any> {
    eventId: string;          // Unique identifier for this specific event instance (auto-generated UUID)
    eventType: EventName | string; // The specific type of event (e.g., Events.ControlLoop.INITIALIZE)
    timestamp: number;        // Unix timestamp (milliseconds) when the event was created (auto-generated)
    agentId: AgentId;         // ID of the agent primarily associated with this event
    channelId: ChannelId;     // ID of the channel primarily associated with this event
    source?: string;          // Optional: The component or module that originated the event
    isRecursionProtection?: boolean; // Optional: Flag to prevent recursive event processing
    data: TData;              // Event-specific data
}

// --- Specific Event Data Interfaces & Payloads ---

/**
 * Data for connection-related events.
 */
export interface ConnectionEventData {
    connectionId: string;
    status: 'connected' | 'disconnected' | 'error';
    error?: string;
}
export type ConnectionEventPayload = BaseEventPayload<ConnectionEventData>;

/**
 * Data for agent-related events (e.g., registration, status changes not covered by simple connection status).
 */
export interface AgentEventData {
    name?: string;
    type?: string;
    capabilities?: string[];
    status?: string; // e.g., 'registered', 'updated', 'unregistered'
    metadata?: Record<string, any>;
    [key: string]: any;
}
export type AgentEventPayload = BaseEventPayload<AgentEventData>;

/**
 * Data for LLM reasoning events - captures reasoning tokens from advanced models
 */
export interface LlmReasoningEventData {
    reasoning: string;                    // The reasoning content from the model
    modelName?: string;                   // Model that generated the reasoning
    reasoningTokens?: number;             // Number of reasoning tokens used
    provider?: string;                    // Provider (e.g., 'openai', 'anthropic', 'openrouter')
    config?: {                           // Configuration used for reasoning
        effort?: 'low' | 'medium' | 'high';
        maxTokens?: number;
        exclude?: boolean;
    };
    timestamp?: number;                   // When reasoning was generated
    metadata?: Record<string, any>;       // Additional provider-specific data
}
export type LlmReasoningEventPayload = BaseEventPayload<LlmReasoningEventData>;

/**
 * Data for LLM reasoning parsed events - when reasoning text is parsed for tool intentions
 */
export interface LlmReasoningParsedEventData {
    reasoning: string;                    // The reasoning text that was parsed
    toolIntentions: Array<{              // Tool intentions extracted from reasoning
        toolName: string;
        arguments: Record<string, any>;
        confidence: number;
        reasoning: string;
    }>;
    parseMethod: 'structured' | 'heuristic' | 'failed'; // Method used for parsing
    toolCount: number;                    // Number of tool intentions found
    parseSuccessful: boolean;             // Whether parsing was successful
    metadata?: Record<string, any>;       // Additional parse metadata
}
export type LlmReasoningParsedEventPayload = BaseEventPayload<LlmReasoningParsedEventData>;

/**
 * Data for LLM reasoning tools synthesized events - when tool_calls are created from reasoning
 */
export interface LlmReasoningToolsSynthesizedEventData {
    toolCalls: Array<{                   // Synthesized tool calls
        type: string;
        id: string;
        name: string;
        input: Record<string, any>;
    }>;
    toolIntentions: Array<{              // Original intentions that led to synthesis
        toolName: string;
        arguments: Record<string, any>;
        confidence: number;
        reasoning: string;
    }>;
    parseMethod: 'structured' | 'heuristic' | 'failed'; // Method that found the intentions
    synthesisSuccessful: boolean;         // Whether synthesis was successful
    metadata?: Record<string, any>;       // Additional synthesis metadata
}
export type LlmReasoningToolsSynthesizedEventPayload = BaseEventPayload<LlmReasoningToolsSynthesizedEventData>;

/**
 * Interface for agent registration events
 */
export interface AgentRegistrationEventData {
    agentId: string;
    socketId: string;
    timestamp: number;
    channelId?: string;
    capabilities?: string[];
    status: 'pending' | 'registered' | 'error';
    error?: string;
}

/**
 * Payload type for agent registration events
 */
export type AgentRegistrationEventPayload = BaseEventPayload<AgentRegistrationEventData>;

/**
 * Interface for agent connection events
 */
export interface AgentConnectionEventData {
    agentId: string;
    socketId: string;
    timestamp: number;
    channelId?: string;
    status: 'connecting' | 'connected' | 'error';
    error?: string;
}

/**
 * Payload type for agent connection events
 */
export type AgentConnectionEventPayload = BaseEventPayload<AgentConnectionEventData>;

/**
 * Interface for agent join events
 */
export interface AgentJoinEventData {
    agentId: string;
    channelId: string;
    timestamp: number;
}

/**
 * Payload type for agent join events
 */
export type AgentJoinEventPayload = BaseEventPayload<AgentJoinEventData>;

/**
 * Interface for agent leave events
 */
export interface AgentLeaveEventData {
    agentId: string;
    channelId: string;
    timestamp: number;
}

/**
 * Payload type for agent leave events
 */
export type AgentLeaveEventPayload = BaseEventPayload<AgentLeaveEventData>;

/**
 * Data for channel-related events (e.g., created, joined, left, deleted).
 */
export interface ChannelEventData {
    name?: string;            // e.g., channel name for creation events
    action: ChannelActionType | 'created' | 'deleted' | 'updated' | 'archived'; // Extended for more channel actions
    targetAgentId?: AgentId;  // e.g., for agent_joined, agent_left events
    metadata?: Record<string, any>;
    [key: string]: any;
}
export type ChannelEventPayload = BaseEventPayload<ChannelEventData>;

/**
 * Data for subscription-related events within a channel.
 */
export interface SubscriptionEventData {
    // agentId for who is subscribing/unsubscribing is BaseEventPayload.agentId
    // channelId for the subscription is BaseEventPayload.channelId
    action: 'subscribe' | 'unsubscribe';
    targetEvent?: EventName | string; // Optional: if subscribing to a specific event type
    [key: string]: any;
}
export type SubscriptionEventPayload = BaseEventPayload<SubscriptionEventData>;

/**
 * Data for task request events.
 */
export interface TaskEventData {
    taskId: string;
    fromAgentId?: AgentId; // Agent initiating the task (could be different from BaseEventPayload.agentId if event is relayed)
    toAgentId?: AgentId;   // Agent designated to perform the task
    task: any;            // The task content/details
}
export type TaskEventPayload = BaseEventPayload<TaskEventData>;

/**
 * Data for task response events.
 */
export interface TaskResponseEventData {
    taskId: string;
    fromAgentId?: AgentId; // Agent that performed the task and is sending the response
    toAgentId?: AgentId;   // Agent that originally requested the task
    response: any;        // The task response content/details
    error?: string;       // Optional error if task execution failed
}
export type TaskResponseEventPayload = BaseEventPayload<TaskResponseEventData>;

/**
 * Data for task assignment events.
 */
export interface TaskAssignmentEventData {
    taskId: string;
    assignedAgentId: AgentId;
    strategy: string;
    confidence: number;
    reasoning: string;
    assignedAt: number;
    estimatedCompletion?: number;
    task: any; // Full task object for consistency with other task events
}
export type TaskAssignmentEventPayload = BaseEventPayload<TaskAssignmentEventData>;

/**
 * Data specific to control loop operations and lifecycle.
 */
export interface ControlLoopSpecificData {
    loopId: string;        // Unique identifier for the control loop instance
    status?: string;       // Specific status of the control loop (e.g., 'initializing', 'running', 'paused', 'completed')
    config?: any;          // Control loop configuration
    observation?: any;     // Current observation
    reasoning?: any;       // Current reasoning
    plan?: any;            // Current plan
    action?: any;          // Current action (or action to be executed)
    error?: string;        // Error if any occurred within the loop's operation
    context?: { [key: string]: any }; // Additional context specific to the loop's state or operation
    [key: string]: any;     // Allow for additional data
}
export type ControlLoopEventPayload = BaseEventPayload<ControlLoopSpecificData>;

// --- Memory Operation Event Data Interfaces & Payloads ---

/**
 * Base data for all memory operations.
 */
export interface BaseMemoryOperationData {
    operationId: string; // Unique ID for this specific memory operation (can be used for correlation)
    scope: MemoryScope;
    id: string | string[]; // Identifier for the memory scope (e.g., agentId, channelId, relationshipId)
}

/**
 * Data for memory GET request events.
 */
export interface MemoryGetEventData extends BaseMemoryOperationData {
    key?: string;                   // Optional: specific key to retrieve within the memory
    filters?: Record<string, any>;  // Optional: filters to apply if retrieving multiple items or a collection
}
export type MemoryGetEventPayload = BaseEventPayload<MemoryGetEventData>;

/**
 * Data for memory GET result events.
 */
export interface MemoryGetResultEventData extends BaseMemoryOperationData {
    key?: string;
    memory: any;     // The retrieved memory data. Could be null or undefined if not found.
    error?: string;  // Error message if the GET operation failed
}
export type MemoryGetResultEventPayload = BaseEventPayload<MemoryGetResultEventData>;

/**
 * Data for memory UPDATE request events.
 */
export interface MemoryUpdateEventData extends BaseMemoryOperationData {
    data: Record<string, any>;    // The data to be written or updated in memory
    metadata?: Record<string, any>; // Optional: metadata associated with this update operation
}
export type MemoryUpdateEventPayload = BaseEventPayload<MemoryUpdateEventData>;

/**
 * Data for memory UPDATE result events.
 */
export interface MemoryUpdateResultEventData extends BaseMemoryOperationData {
    memory: any;     // The state of the memory after the update. Can be the updated object or a success indicator.
    error?: string;  // Error message if the UPDATE operation failed
}
export type MemoryUpdateResultEventPayload = BaseEventPayload<MemoryUpdateResultEventData>;

/**
 * Data for memory DELETE request events.
 */
export interface MemoryDeleteEventData extends BaseMemoryOperationData {
    key?: string;    // Optional: specific key to delete within the memory scope
}
export type MemoryDeleteEventPayload = BaseEventPayload<MemoryDeleteEventData>;

/**
 * Data for memory DELETE result events.
 */
export interface MemoryDeleteResultEventData extends BaseMemoryOperationData {
    key?: string;    // If a specific key was targeted for deletion
    success: boolean;
    deletedCount?: number; // Optional: if multiple items could be deleted
    error?: string;  // Error message if the DELETE operation failed
}
export type MemoryDeleteResultEventPayload = BaseEventPayload<MemoryDeleteResultEventData>;

/**
 * Data for memory SYNC request events.
 */
export interface MemorySyncRequestData extends BaseMemoryOperationData {
    // Additional sync-specific parameters can be added here
    target?: 'local' | 'remote' | 'bidirectional'; // Example: direction of sync
}
export type MemorySyncRequestPayload = BaseEventPayload<MemorySyncRequestData>;

/**
 * Data for memory SYNC COMPLETE events.
 */
export interface MemorySyncCompleteData extends BaseMemoryOperationData {
    itemCount?: number; // Number of items synced
    statusMessage?: string;
}
export type MemorySyncCompletePayload = BaseEventPayload<MemorySyncCompleteData>;

/**
 * Data for memory SYNC ERROR events.
 */
export interface MemorySyncErrorData extends BaseMemoryOperationData {
    error: string;
    details?: any;
}
export type MemorySyncErrorPayload = BaseEventPayload<MemorySyncErrorData>;

// --- Specific Memory Request Payload Interfaces (for SDK/client-side construction of requests) ---
// These are not full BaseEventPayloads, but the 'data' portion the SDK Handler will wrap.

/**
 * Base structure for memory operation request payloads before they are wrapped into a full BaseEventPayload.
 * This is typically what SDK methods like sendMemoryRequest expect as their 'payload' argument.
 */
export interface BaseMemoryRequest {
    scope: MemoryScope;
    id: string | string[]; // Identifier for the memory scope (e.g., agentId, channelId, relationshipId)
    channelId: string;   // Channel context for the request
}

/**
 * Request payload for getting memory.
 */
export interface MemoryGetRequest extends BaseMemoryRequest {
    key?: string;                   // Optional: specific key to retrieve within the memory
    filters?: Record<string, any>;  // Optional: filters to apply if retrieving multiple items or a collection
}

/**
 * Request payload for creating memory.
 */
export interface MemoryCreateRequest<TData = any> extends BaseMemoryRequest {
    data: TData; // Data to be stored
}

/**
 * Request payload for updating memory.
 */
export interface MemoryUpdateRequest<TData = any> extends BaseMemoryRequest {
    data: Partial<TData>; // Partial data for update
    key?: string;         // Optional key for specific entry update
}

/**
 * Request payload for deleting memory.
 */
export interface MemoryDeleteRequest extends BaseMemoryRequest {
    key?: string;    // Optional: specific key to delete within the memory scope
}

/**
 * Union type for all possible memory request payloads that sendMemoryRequest can handle.
 */
export type MemoryRequestPayload = 
    | MemoryGetRequest 
    | MemoryCreateRequest<any> 
    | MemoryUpdateRequest<any> 
    | MemoryDeleteRequest;

// --- MCP (Model Control Plane) Event Data --- 
// Placeholder for MCP specific events if they need to be standardized here
// Example: Tool registration, call, result events if they are to be treated as BaseEventPayload compliant

export interface McpToolEventData {
    toolName: string;
    toolVersion?: string;
    [key: string]: any; // For additional properties like arguments, results, errors
}
export type McpToolRegisteredEventPayload = BaseEventPayload<McpToolEventData & { registrationDetails: any }>;
export type McpToolUnregisteredEventPayload = BaseEventPayload<McpToolEventData>;
export type McpToolCallEventPayload = BaseEventPayload<McpToolEventData & { callId: string; arguments: any }>;
export type McpToolResultEventPayload = BaseEventPayload<McpToolEventData & { callId: string; result: any }>;
export type McpToolErrorEventPayload = BaseEventPayload<McpToolEventData & { callId: string; error: any }>;

export interface McpResourceEventData {
    resourceUri: string;
    resourceType?: string;
    [key: string]: any; // For additional properties like data, errors
}
export type McpResourceGetEventPayload = BaseEventPayload<McpResourceEventData & { requestId: string }>;
export type McpResourceListEventPayload = BaseEventPayload<McpResourceEventData & { requestId: string; filter?: any }>;
export type McpResourceResultEventPayload = BaseEventPayload<McpResourceEventData & { requestId: string; data: any }>;
export type McpResourceErrorEventPayload = BaseEventPayload<McpResourceEventData & { requestId: string; error: any }>;

/**
 * Data for external MCP server events (global and channel-scoped)
 */
export interface ExternalMcpServerEventData {
    serverId: string;
    serverName?: string;
    scope: 'global' | 'channel' | 'agent';
    scopeId?: string; // channelId for channel scope, agentId for agent scope
    success?: boolean;
    error?: string;
    message?: string;
    toolsDiscovered?: string[];
    status?: 'stopped' | 'starting' | 'running' | 'error';
    connectedAgents?: number;
    [key: string]: any;
}
export type ExternalMcpServerEventPayload = BaseEventPayload<ExternalMcpServerEventData>;


// --- Event Payloads Carrying Standard Messages ---

/**
 * Data for generic message-related events.
 * This is used as the 'data' field in events like Events.Message.CHANNEL_MESSAGE or Events.Message.AGENT_MESSAGE.
 */
export interface MessageEventData {
    /**
     * The actual message content, which can be a ChannelMessage or AgentMessage.
     * This reuses the detailed message structures from MessageSchemas.ts.
     */
    message: ChannelMessage | AgentMessage; 

    /**
     * Optional error message if processing or delivery of the message failed.
     */
    error?: string;

    /**
     * Allows for additional, event-specific properties if needed.
     */
    [key: string]: any; 
}

export type MessageEventPayload = BaseEventPayload<MessageEventData>;

/**
 * Event payload for events that carry a standard ChannelMessage.
 */
export type ChannelMessageEventPayload = BaseEventPayload<ChannelMessage>;

/**
 * Event payload for events that carry a standard AgentMessage.
 */
export type AgentMessageEventPayload = BaseEventPayload<AgentMessage>;

/**
 * Payload type for message persistence failure.
 */
export interface MessagePersistFailedPayload {
    channelId?: string; // The channel ID for which persistence was attempted
    messageId?: string; // The ID of the message, if available
    originalMessage?: Partial<ChannelMessage>; // The original message data that failed to persist
    error: string; // Description of the error
    timestamp: number; // Timestamp of when the error occurred
    fromAgentId?: string; // ID of the agent that initiated the original request, if applicable
}

/**
 * Payload type for message send failure.
 */
export interface MessageSendFailedPayload {
    channelId?: string; // The channel ID to which the message was intended
    messageId?: string; // The ID of the message that failed to send
    originalMessage?: Partial<ChannelMessage>; // The original message data
    error: string; // Description of the error
    timestamp: number; // Timestamp of when the error occurred
    fromAgentId?: string; // ID of the agent that sent the message, if applicable
}

// --- Helper Functions ---

/**
 * Creates a standardized base event payload.
 * This is the core function for generating all event payloads in the system.
 *
 * @param eventType - The specific type of event (e.g., Events.ControlLoop.INITIALIZE).
 * @param agentId - ID of the agent primarily associated with this event.
 * @param channelId - ID of the channel primarily associated with this event.
 * @param data - The event-specific data.
 * @param options - Optional parameters like source, recursion protection, or overrides for eventId and timestamp.
 * @returns A fully formed BaseEventPayload.
 */
export function createBaseEventPayload<TData>(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    data: TData,
    options: {
        source?: string;
        isRecursionProtection?: boolean;
        eventId?: string; 
        timestamp?: number;
    } = {}
): BaseEventPayload<TData> {
    const validator = createStrictValidator('createBaseEventPayload');
    validator.assertIsNonEmptyString(eventType, 'eventType');
    validator.assertIsNonEmptyString(agentId, 'agentId');
    validator.assertIsNonEmptyString(channelId, 'channelId'); // Enforcing channelId as per requirement
    // data can be anything, so no generic validation here, specific helpers can validate their data.

    return {
        eventId: options.eventId || uuidv4(),
        eventType,
        timestamp: options.timestamp || Date.now(),
        agentId,
        channelId,
        source: options.source,
        isRecursionProtection: options.isRecursionProtection,
        data,
    };
}

// --- Specific Event Payload Creator Helpers ---

/**
 * Creates a ConnectionEventPayload.
 * @param eventType - The specific connection event type (e.g., Events.Agent.CONNECTED, Events.Agent.DISCONNECTED).
 * @param agentId - The Agent ID involved in the connection event.
 * @param channelId - The Channel ID context for this event (can be a default/system channel if not specific).
 * @param connectionData - The specific data for the connection event.
 * @param options - Optional base event payload options.
 * @returns A ConnectionEventPayload.
 */
export function createConnectionEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    connectionData: ConnectionEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): ConnectionEventPayload {
    return createBaseEventPayload<ConnectionEventData>(eventType, agentId, channelId, connectionData, options);
}

/**
 * Creates an AgentEventPayload.
 * @param eventType - The specific agent event type (e.g., Events.Agent.REGISTERED, Events.Agent.STATUS_CHANGE).
 * @param agentId - The Agent ID to whom this event pertains.
 * @param channelId - The Channel ID context for this agent event.
 * @param agentData - The specific data for the agent event.
 * @param options - Optional base event payload options.
 * @returns An AgentEventPayload.
 */
export function createAgentEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    agentData: AgentEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): AgentEventPayload {
    return createBaseEventPayload<AgentEventData>(eventType, agentId, channelId, agentData, options);
}

/**
 * Creates an LLM Reasoning EventPayload.
 * @param eventType - The specific LLM reasoning event type (e.g., AgentEvents.LLM_REASONING).
 * @param agentId - The Agent ID that generated the reasoning.
 * @param channelId - The Channel ID context for this reasoning event.
 * @param reasoningData - The specific data for the reasoning event.
 * @param options - Optional base event payload options.
 * @returns An LlmReasoningEventPayload.
 */
export function createLlmReasoningEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    reasoningData: LlmReasoningEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): LlmReasoningEventPayload {
    // Add validation for reasoning data
    const validator = createStrictValidator('LlmReasoningEventPayload');
    validator.assertIsNonEmptyString(reasoningData.reasoning, 'Reasoning content is required');
    
    return createBaseEventPayload<LlmReasoningEventData>(eventType, agentId, channelId, reasoningData, options);
}

/**
 * Creates an LlmReasoningParsedEventPayload.
 * Used when reasoning text is parsed for tool intentions.
 * 
 * @param eventType - The specific event type (e.g., AgentEvents.LLM_REASONING_PARSED).
 * @param agentId - The Agent ID that generated the reasoning.
 * @param channelId - The Channel ID for the agent.
 * @param parsedData - The parsed reasoning data including tool intentions.
 * @param options - Optional base event payload options.
 * @returns An LlmReasoningParsedEventPayload.
 */
export function createLlmReasoningParsedEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    parsedData: LlmReasoningParsedEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): LlmReasoningParsedEventPayload {
    // Add validation for parsed data
    const validator = createStrictValidator('LlmReasoningParsedEventPayload');
    validator.assertIsNonEmptyString(parsedData.reasoning, 'Reasoning content is required');
    validator.assertIsArray(parsedData.toolIntentions, 'Tool intentions must be an array');
    
    return createBaseEventPayload<LlmReasoningParsedEventData>(eventType, agentId, channelId, parsedData, options);
}

/**
 * Creates an LlmReasoningToolsSynthesizedEventPayload.
 * Used when tool_calls are synthesized from reasoning intentions.
 * 
 * @param eventType - The specific event type (e.g., AgentEvents.LLM_REASONING_TOOLS_SYNTHESIZED).
 * @param agentId - The Agent ID that generated the reasoning.
 * @param channelId - The Channel ID for the agent.
 * @param synthesizedData - The synthesized tool calls data.
 * @param options - Optional base event payload options.
 * @returns An LlmReasoningToolsSynthesizedEventPayload.
 */
export function createLlmReasoningToolsSynthesizedEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    synthesizedData: LlmReasoningToolsSynthesizedEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): LlmReasoningToolsSynthesizedEventPayload {
    // Add validation for synthesized data
    const validator = createStrictValidator('LlmReasoningToolsSynthesizedEventPayload');
    validator.assertIsArray(synthesizedData.toolCalls, 'Tool calls must be an array');
    validator.assertIsArray(synthesizedData.toolIntentions, 'Tool intentions must be an array');
    
    return createBaseEventPayload<LlmReasoningToolsSynthesizedEventData>(eventType, agentId, channelId, synthesizedData, options);
}

/**
 * Creates a ChannelEventPayload.
 * @param eventType - The specific channel event type (e.g., Events.Channel.CREATED, Events.Channel.AGENT_JOINED).
 * @param agentId - The Agent ID initiating or primarily affected by the channel event.
 * @param channelId - The Channel ID to which this event pertains.
 * @param channelData - The specific data for the channel event.
 * @param options - Optional base event payload options.
 * @returns A ChannelEventPayload.
 */
export function createChannelEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    channelData: ChannelEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): ChannelEventPayload {
    return createBaseEventPayload<ChannelEventData>(eventType, agentId, channelId, channelData, options);
}

/**
 * Creates a SubscriptionEventPayload.
 * @param eventType - Usually Events.Channel.SUBSCRIBE or Events.Channel.UNSUBSCRIBE.
 * @param agentId - The Agent ID performing the subscribe/unsubscribe action.
 * @param channelId - The Channel ID where the subscription is happening.
 * @param subscriptionData - The specific data for the subscription event.
 * @param options - Optional base event payload options.
 * @returns A SubscriptionEventPayload.
 */
export function createSubscriptionEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    subscriptionData: SubscriptionEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): SubscriptionEventPayload {
    return createBaseEventPayload<SubscriptionEventData>(eventType, agentId, channelId, subscriptionData, options);
}

/**
 * Creates a TaskEventPayload (for task requests).
 * @param eventType - Usually Events.Task.REQUEST.
 * @param emittingAgentId - The Agent ID emitting this task request event.
 * @param channelId - The Channel ID context for this task event.
 * @param taskData - The specific data for the task request.
 * @param options - Optional base event payload options.
 * @returns A TaskEventPayload.
 */
export function createTaskEventPayload(
    eventType: EventName | string, 
    emittingAgentId: AgentId,
    channelId: ChannelId,
    taskData: TaskEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): TaskEventPayload {
    // Fail-fast validation for task event payload
    const validator = createStrictValidator('TaskEventPayload');
    
    // Validate required event parameters
    validator.assertIsNonEmptyString(eventType, 'Event type is required');
    validator.assertIsNonEmptyString(emittingAgentId, 'Emitting agent ID is required');
    validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
    
    // Validate task data structure
    validator.assertIsObject(taskData, 'Task data must be an object');
    validator.assertIsNonEmptyString(taskData.taskId, 'Task ID is required');
    //validator.assertIsNonEmptyString(taskData.toAgentId, 'Target agent ID is required');
    validator.assertIsObject(taskData.task, 'Task content must be an object');
    
    // Validate task content has required fields
    const task = taskData.task;
    validator.assertIsNonEmptyString(task.title, 'Task title is required');
    validator.assertIsNonEmptyString(task.description, 'Task description is required');
    validator.assertIsNonEmptyString(task.assignmentStrategy, 'Assignment strategy is required');
    
    // Validate assignment scope and related fields
    if (task.assignmentScope) {
        const validScopes = ['single', 'multiple', 'channel-wide'];
        validator.assert(
            validScopes.includes(task.assignmentScope), 
            `Assignment scope must be one of: ${validScopes.join(', ')}`
        );
        
        // Validate multi-agent assignment requirements
        if (task.assignmentScope === 'multiple') {
            validator.assert(
                Array.isArray(task.assignedAgentIds) && task.assignedAgentIds.length > 1,
                'Multiple assignment scope requires assignedAgentIds array with 2+ agents'
            );
        }
        
        // Validate channel-wide assignment requirements
        if (task.assignmentScope === 'channel-wide') {
            validator.assert(
                task.channelWideTask === true || task.maxParticipants > 0,
                'Channel-wide assignment requires channelWideTask flag or maxParticipants limit'
            );
        }
    }
    
    // Validate coordination mode if specified
    if (task.coordinationMode) {
        const validModes = ['independent', 'collaborative', 'sequential', 'hierarchical'];
        validator.assert(
            validModes.includes(task.coordinationMode),
            `Coordination mode must be one of: ${validModes.join(', ')}`
        );
    }
    
    // Ensure fromAgentId is present in taskData, if not, use emittingAgentId
    const dataWithFromAgent = { ...taskData, fromAgentId: taskData.fromAgentId || emittingAgentId };
    
    return createBaseEventPayload<TaskEventData>(eventType, emittingAgentId, channelId, dataWithFromAgent, options);
}

/**
 * Creates a TaskResponseEventPayload.
 * @param eventType - Usually Events.Task.RESPONSE.
 * @param emittingAgentId - The Agent ID emitting this task response event (usually the one that performed the task).
 * @param channelId - The Channel ID context for this task response event.
 * @param taskResponseData - The specific data for the task response.
 * @param options - Optional base event payload options.
 * @returns A TaskResponseEventPayload.
 */
export function createTaskResponseEventPayload(
    eventType: EventName | string,
    emittingAgentId: AgentId, 
    channelId: ChannelId,
    taskResponseData: TaskResponseEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): TaskResponseEventPayload {
    // Ensure fromAgentId is present in taskResponseData, if not, use emittingAgentId
    const dataWithFromAgent = { ...taskResponseData, fromAgentId: taskResponseData.fromAgentId || emittingAgentId };
    return createBaseEventPayload<TaskResponseEventData>(eventType, emittingAgentId, channelId, dataWithFromAgent, options);
}

/**
 * Creates a TaskAssignmentEventPayload.
 * @param eventType - Usually Events.Task.ASSIGNED.
 * @param assignedAgentId - The Agent ID that was assigned the task.
 * @param channelId - The Channel ID context for this task assignment event.
 * @param taskAssignmentData - The specific data for the task assignment.
 * @param options - Optional base event payload options.
 * @returns A TaskAssignmentEventPayload.
 */
export function createTaskAssignmentEventPayload(
    eventType: EventName | string,
    assignedAgentId: AgentId, 
    channelId: ChannelId,
    taskAssignmentData: TaskAssignmentEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): TaskAssignmentEventPayload {
    return createBaseEventPayload<TaskAssignmentEventData>(eventType, assignedAgentId, channelId, taskAssignmentData, options);
}

/**
 * Creates a ControlLoopEventPayload.
 * @param eventType - The specific control loop event type (e.g., Events.ControlLoop.INITIALIZE, Events.ControlLoop.OBSERVATION).
 * @param agentId - The Agent ID that owns/runs this control loop.
 * @param channelId - The Channel ID with which this control loop is associated.
 * @param controlLoopData - The specific data for the control loop event.
 * @param options - Optional base event payload options.
 * @returns A ControlLoopEventPayload.
 */
export function createControlLoopEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    controlLoopData: ControlLoopSpecificData,
    options: { source?: string; eventId?: string; timestamp?: number; isRecursionProtection?: boolean; } = {}
): ControlLoopEventPayload {
    return createBaseEventPayload<ControlLoopSpecificData>(eventType, agentId, channelId, controlLoopData, options);
}

// --- Memory Event Payload Creator Helpers ---

/**
 * Creates a MemoryGetEventPayload.
 * @param eventType - Usually Events.Memory.GET.
 * @param agentId - Agent requesting or involved in the memory operation.
 * @param channelId - Channel context for the memory operation.
 * @param memoryGetData - Specific data for the memory get request.
 * @param options - Optional base event payload options.
 * @returns A MemoryGetEventPayload.
 */
export function createMemoryGetEventPayload(
    eventType: typeof Events.Memory.GET,
    agentId: AgentId,
    channelId: ChannelId,
    memoryGetData: MemoryGetEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): MemoryGetEventPayload {
    const validator = createStrictValidator('createMemoryGetEventPayload');
    validator.assertIsNonEmptyString(memoryGetData.operationId, 'memoryGetData.operationId');
    validator.assert(
        Object.values(MemoryScope).includes(memoryGetData.scope),
        `memoryGetData.scope must be a valid MemoryScope value. Received: ${memoryGetData.scope}`
    );
    // Validate 'id' which is string | string[]
    if (Array.isArray(memoryGetData.id)) {
        validator.assert(memoryGetData.id.length > 0, 'memoryGetData.id array must not be empty');
        memoryGetData.id.forEach((item, index) => {
            validator.assertIsNonEmptyString(item, `memoryGetData.id[${index}] must be a non-empty string`);
        });
    } else {
        validator.assertIsNonEmptyString(memoryGetData.id, 'memoryGetData.id must be a non-empty string or a non-empty array of non-empty strings');
    }
    return createBaseEventPayload<MemoryGetEventData>(eventType, agentId, channelId, memoryGetData, options);
}

/**
 * Creates a MemoryGetResultEventPayload.
 * @param eventType - Usually Events.Memory.GET_RESULT or Events.Memory.GET_ERROR.
 * @param agentId - Agent involved in the memory operation result.
 * @param channelId - Channel context for the memory operation result.
 * @param memoryGetResultData - Specific data for the memory get result.
 * @param options - Optional base event payload options.
 * @returns A MemoryGetResultEventPayload.
 */
export function createMemoryGetResultEventPayload(
    eventType: typeof Events.Memory.GET_RESULT,
    agentId: AgentId,
    channelId: ChannelId,
    memoryGetResultData: MemoryGetResultEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): MemoryGetResultEventPayload {
    const validator = createStrictValidator('createMemoryGetResultEventPayload');
    validator.assertIsNonEmptyString(memoryGetResultData.operationId, 'memoryGetResultData.operationId');
    validator.assert(
        Object.values(MemoryScope).includes(memoryGetResultData.scope),
        `memoryGetResultData.scope must be a valid MemoryScope value. Received: ${memoryGetResultData.scope}`
    );
    // Validate 'id' which is string | string[]
    if (Array.isArray(memoryGetResultData.id)) {
        validator.assert(memoryGetResultData.id.length > 0, 'memoryGetResultData.id array must not be empty');
        memoryGetResultData.id.forEach((item, index) => {
            validator.assertIsNonEmptyString(item, `memoryGetResultData.id[${index}] must be a non-empty string`);
        });
    } else {
        validator.assertIsNonEmptyString(memoryGetResultData.id, 'memoryGetResultData.id must be a non-empty string or a non-empty array of non-empty strings');
    }
    // memoryGetResultData.memory can be null/undefined if not found, so no strict check on its presence unless error is also absent.
    if (!memoryGetResultData.error && memoryGetResultData.memory === undefined) {
        // MemoryGetResultEventData created without memory or error - this is allowed for empty results
    }
    return createBaseEventPayload<MemoryGetResultEventData>(eventType, agentId, channelId, memoryGetResultData, options);
}

/**
 * Creates a MemoryUpdateEventPayload.
 * @param eventType - Usually Events.Memory.UPDATE.
 * @param agentId - Agent requesting or involved in the memory update.
 * @param channelId - Channel context for the memory update.
 * @param memoryUpdateData - Specific data for the memory update request.
 * @param options - Optional base event payload options.
 * @returns A MemoryUpdateEventPayload.
 */
export function createMemoryUpdateEventPayload(
    eventType: typeof Events.Memory.UPDATE,
    agentId: AgentId,
    channelId: ChannelId,
    memoryUpdateData: MemoryUpdateEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): MemoryUpdateEventPayload {
    const validator = createStrictValidator('createMemoryUpdateEventPayload');
    validator.assertIsNonEmptyString(memoryUpdateData.operationId, 'memoryUpdateData.operationId');
    validator.assert(
        Object.values(MemoryScope).includes(memoryUpdateData.scope),
        `memoryUpdateData.scope must be a valid MemoryScope value. Received: ${memoryUpdateData.scope}`
    );
    // Validate 'id' which is string | string[]
    if (Array.isArray(memoryUpdateData.id)) {
        validator.assert(memoryUpdateData.id.length > 0, 'memoryUpdateData.id array must not be empty');
        memoryUpdateData.id.forEach((item, index) => {
            validator.assertIsNonEmptyString(item, `memoryUpdateData.id[${index}] must be a non-empty string`);
        });
    } else {
        validator.assertIsNonEmptyString(memoryUpdateData.id, 'memoryUpdateData.id must be a non-empty string or a non-empty array of non-empty strings');
    }
    validator.assertIsObject(memoryUpdateData.data, 'memoryUpdateData.data');
    return createBaseEventPayload<MemoryUpdateEventData>(eventType, agentId, channelId, memoryUpdateData, options);
}

/**
 * Creates a MemoryUpdateResultEventPayload.
 * @param eventType - Usually Events.Memory.UPDATE_RESULT or Events.Memory.UPDATE_ERROR.
 * @param agentId - Agent involved in the memory update result.
 * @param channelId - Channel context for the memory update result.
 * @param memoryUpdateResultData - Specific data for the memory update result.
 * @param options - Optional base event payload options.
 * @returns A MemoryUpdateResultEventPayload.
 */
export function createMemoryUpdateResultEventPayload(
    eventType: typeof Events.Memory.UPDATE_RESULT,
    agentId: AgentId,
    channelId: ChannelId,
    memoryUpdateResultData: MemoryUpdateResultEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): MemoryUpdateResultEventPayload {
    const validator = createStrictValidator('createMemoryUpdateResultEventPayload');
    validator.assertIsNonEmptyString(memoryUpdateResultData.operationId, 'memoryUpdateResultData.operationId');
    validator.assert(
        Object.values(MemoryScope).includes(memoryUpdateResultData.scope),
        `memoryUpdateResultData.scope must be a valid MemoryScope value. Received: ${memoryUpdateResultData.scope}`
    );
    // Validate 'id' which is string | string[]
    if (Array.isArray(memoryUpdateResultData.id)) {
        validator.assert(memoryUpdateResultData.id.length > 0, 'memoryUpdateResultData.id array must not be empty');
        memoryUpdateResultData.id.forEach((item, index) => {
            validator.assertIsNonEmptyString(item, `memoryUpdateResultData.id[${index}] must be a non-empty string`);
        });
    } else {
        validator.assertIsNonEmptyString(memoryUpdateResultData.id, 'memoryUpdateResultData.id must be a non-empty string or a non-empty array of non-empty strings');
    }
    // memoryUpdateResultData.memory might not be strictly an object if e.g. indicating success only
    if (!memoryUpdateResultData.error && memoryUpdateResultData.memory === undefined) {
        // MemoryUpdateResultEventData created without memory or error - this is allowed for success indicators
    }
    return createBaseEventPayload<MemoryUpdateResultEventData>(eventType, agentId, channelId, memoryUpdateResultData, options);
}

/**
 * Creates a MemoryDeleteEventPayload.
 * @param eventType - Usually Events.Memory.DELETE.
 * @param agentId - Agent requesting or involved in the memory deletion.
 * @param channelId - Channel context for the memory deletion.
 * @param memoryDeleteData - Specific data for the memory delete request.
 * @param options - Optional base event payload options.
 * @returns A MemoryDeleteEventPayload.
 */
export function createMemoryDeleteEventPayload(
    eventType: typeof Events.Memory.DELETE,
    agentId: AgentId,
    channelId: ChannelId,
    memoryDeleteData: MemoryDeleteEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): MemoryDeleteEventPayload {
    const validator = createStrictValidator('createMemoryDeleteEventPayload');
    validator.assertIsNonEmptyString(memoryDeleteData.operationId, 'memoryDeleteData.operationId');
    validator.assert(
        Object.values(MemoryScope).includes(memoryDeleteData.scope),
        `memoryDeleteData.scope must be a valid MemoryScope value. Received: ${memoryDeleteData.scope}`
    );
    // Validate 'id' which is string | string[]
    if (Array.isArray(memoryDeleteData.id)) {
        validator.assert(memoryDeleteData.id.length > 0, 'memoryDeleteData.id array must not be empty');
        memoryDeleteData.id.forEach((item, index) => {
            validator.assertIsNonEmptyString(item, `memoryDeleteData.id[${index}] must be a non-empty string`);
        });
    } else {
        validator.assertIsNonEmptyString(memoryDeleteData.id, 'memoryDeleteData.id must be a non-empty string or a non-empty array of non-empty strings');
    }
    return createBaseEventPayload<MemoryDeleteEventData>(eventType, agentId, channelId, memoryDeleteData, options);
}

/**
 * Creates a MemoryDeleteResultEventPayload.
 * @param eventType - Usually Events.Memory.DELETE_RESULT or Events.Memory.DELETE_ERROR.
 * @param agentId - Agent involved in the memory deletion result.
 * @param channelId - Channel context for the memory deletion result.
 * @param memoryDeleteResultData - Specific data for the memory delete result.
 * @param options - Optional base event payload options.
 * @returns A MemoryDeleteResultEventPayload.
 */
export function createMemoryDeleteResultEventPayload(
    eventType: typeof Events.Memory.DELETE_RESULT,
    agentId: AgentId,
    channelId: ChannelId,
    memoryDeleteResultData: MemoryDeleteResultEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): MemoryDeleteResultEventPayload {
    const validator = createStrictValidator('createMemoryDeleteResultEventPayload');
    validator.assertIsNonEmptyString(memoryDeleteResultData.operationId, 'memoryDeleteResultData.operationId');
    validator.assert(
        Object.values(MemoryScope).includes(memoryDeleteResultData.scope),
        `memoryDeleteResultData.scope must be a valid MemoryScope value. Received: ${memoryDeleteResultData.scope}`
    );
    // Validate 'id' which is string | string[]
    if (Array.isArray(memoryDeleteResultData.id)) {
        validator.assert(memoryDeleteResultData.id.length > 0, 'memoryDeleteResultData.id array must not be empty');
        memoryDeleteResultData.id.forEach((item, index) => {
            validator.assertIsNonEmptyString(item, `memoryDeleteResultData.id[${index}] must be a non-empty string`);
        });
    } else {
        validator.assertIsNonEmptyString(memoryDeleteResultData.id, 'memoryDeleteResultData.id must be a non-empty string or a non-empty array of non-empty strings');
    }
    if (!memoryDeleteResultData.error && typeof memoryDeleteResultData.success !== 'boolean') {
        throw new Error('MemoryDeleteResultEventData requires a success flag if no error is provided.');
    }
    return createBaseEventPayload<MemoryDeleteResultEventData>(eventType, agentId, channelId, memoryDeleteResultData, options);
}

/**
 * Creates a MemorySyncCompleteEventPayload.
 * @param eventType - Usually Events.Memory.SYNC_COMPLETE.
 * @param agentId - Agent involved in the memory sync operation.
 * @param channelId - Channel context for the memory sync operation.
 * @param memorySyncCompleteData - Specific data for the memory sync complete.
 * @param options - Optional base event payload options.
 * @returns A MemorySyncCompleteEventPayload.
 */
export function createMemorySyncCompleteEventPayload(
    eventType: typeof Events.Memory.SYNC_COMPLETE,
    agentId: AgentId,
    channelId: ChannelId,
    memorySyncCompleteData: MemorySyncCompleteData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): MemorySyncCompletePayload {
    const validator = createStrictValidator('createMemorySyncCompleteEventPayload');
    validator.assertIsNonEmptyString(memorySyncCompleteData.operationId, 'memorySyncCompleteData.operationId');
    validator.assert(
        Object.values(MemoryScope).includes(memorySyncCompleteData.scope),
        `memorySyncCompleteData.scope must be a valid MemoryScope value. Received: ${memorySyncCompleteData.scope}`
    );
    return createBaseEventPayload<MemorySyncCompleteData>(eventType, agentId, channelId, memorySyncCompleteData, options);
}

/**
 * Creates a MemorySyncErrorEventPayload.
 * @param eventType - Usually Events.Memory.SYNC_ERROR.
 * @param agentId - Agent involved in the memory sync error.
 * @param channelId - Channel context for the memory sync error.
 * @param memorySyncErrorData - Specific data for the memory sync error.
 * @param options - Optional base event payload options.
 * @returns A MemorySyncErrorEventPayload.
 */
export function createMemorySyncErrorEventPayload(
    eventType: typeof Events.Memory.SYNC_ERROR,
    agentId: AgentId,
    channelId: ChannelId,
    memorySyncErrorData: MemorySyncErrorData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): MemorySyncErrorPayload {
    const validator = createStrictValidator('createMemorySyncErrorEventPayload');
    validator.assertIsNonEmptyString(memorySyncErrorData.operationId, 'memorySyncErrorData.operationId');
    validator.assert(
        Object.values(MemoryScope).includes(memorySyncErrorData.scope),
        `memorySyncErrorData.scope must be a valid MemoryScope value. Received: ${memorySyncErrorData.scope}`
    );
    validator.assertIsNonEmptyString(memorySyncErrorData.error, 'memorySyncErrorData.error');
    return createBaseEventPayload<MemorySyncErrorData>(eventType, agentId, channelId, memorySyncErrorData, options);
}

// --- Message Event Payload Creator Helpers ---

/**
 * Creates an event payload that carries a standard ChannelMessage.
 * @param eventType - The specific event type, e.g., Events.Message.CHANNEL_MESSAGE.
 * @param agentId - The Agent ID involved in processing or relaying this message event.
 * @param channelMessage - The ChannelMessage object itself.
 * @param options - Optional base event payload options.
 * @returns A ChannelMessageEventPayload.
 */
export function createChannelMessageEventPayload(
    eventType: EventName | string,
    agentId: AgentId, 
    channelMessage: ChannelMessage,
    options: { source?: string; isRecursionProtection?: boolean; eventId?: string; timestamp?: number; } = {}
): ChannelMessageEventPayload {
    const validator = createStrictValidator('createChannelMessageEventPayload');
    validator.assertIsObject(channelMessage, 'channelMessage');
    validator.assertIsNonEmptyString(channelMessage?.context?.channelId, 'channelMessage.context.channelId');

    return createBaseEventPayload<ChannelMessage>(
        eventType,
        agentId,
        channelMessage.context.channelId, // Deriving channelId for BaseEventPayload from the message's context
        channelMessage,
        options
    );
}

/**
 * Creates an event payload that carries a standard AgentMessage.
 * @param eventType - The specific event type, e.g., Events.Message.AGENT_MESSAGE.
 * @param agentId - The Agent ID involved in this agent message event (e.g., sender or receiver based on context).
 * @param channelId - The Channel ID providing context for this agent message event.
 * @param agentMessage - The AgentMessage object itself.
 * @param options - Optional base event payload options.
 * @returns A AgentMessageEventPayload.
 */
export function createAgentMessageEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId, 
    agentMessage: AgentMessage,
    options: { source?: string; isRecursionProtection?: boolean; eventId?: string; timestamp?: number; } = {}
): AgentMessageEventPayload {
    const validator = createStrictValidator('createAgentMessageEventPayload');
    validator.assertIsObject(agentMessage, 'agentMessage');
    // agentMessage.receiverId is validated by its own creator typically

    return createBaseEventPayload<AgentMessage>(
        eventType,
        agentId,
        channelId, // Agent messages can still occur within a channel context for the event logging/tracing
        agentMessage,
        options
    );
}

/**
 * Creates a MessageEventPayload for message persistence events.
 * @param eventType - The specific event type (e.g., Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST).
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the message event.
 * @param options - Optional overrides for eventId and timestamp.
 * @returns The complete event payload.
 */
export const createMessageEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MessageEventData,
    options?: { eventId?: string; timestamp?: number }
): MessageEventPayload => ({
    eventId: options?.eventId || uuidv4(),
    eventType,
    timestamp: options?.timestamp || Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a MessagePersistFailedPayload event payload.
 * @param eventType - The specific event type (e.g., Events.Message.MESSAGE_PERSIST_FAILED).
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the message persist failed event.
 * @param options - Optional overrides for eventId and timestamp.
 * @returns The complete event payload.
 */
export const createMessagePersistFailedEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MessagePersistFailedPayload,
    options?: { eventId?: string; timestamp?: number }
): BaseEventPayload<MessagePersistFailedPayload> => ({
    eventId: options?.eventId || uuidv4(),
    eventType,
    timestamp: options?.timestamp || Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a MessageSendFailedPayload event payload.
 * @param eventType - The specific event type (e.g., Events.Message.MESSAGE_SEND_FAILED).
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the message send failed event.
 * @param options - Optional overrides for eventId and timestamp.
 * @returns The complete event payload.
 */
export const createMessageSendFailedEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MessageSendFailedPayload,
    options?: { eventId?: string; timestamp?: number }
): BaseEventPayload<MessageSendFailedPayload> => ({
    eventId: options?.eventId || uuidv4(),
    eventType,
    timestamp: options?.timestamp || Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

// --- LLM Service Event Payloads ---

/**
 * Data for LLM instruction started event.
 */
export interface LlmInstructionStartedEventData {
    serviceId: string;      // Unique ID for the LLM service instance or request context
    instructionId: string;  // Unique ID for this specific instruction/prompt
    timestamp: number;
    prompt: string;
    options?: Record<string, any>; // LLM provider options
}

/**
 * Data for LLM instruction completed event.
 */
export interface LlmInstructionCompletedEventData {
    serviceId: string;
    instructionId: string;
    timestamp: number;
    response: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        [key: string]: any; // For other provider-specific usage data
    };
}

/**
 * Data for LLM instruction error event.
 */
export interface LlmInstructionErrorEventData {
    serviceId: string;
    instructionId: string;
    timestamp: number;
    error: string;
}

/**
 * Creates a payload for an LLM instruction started event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the LLM instruction started event.
 * @returns The complete event payload.
 */
export const createLlmInstructionStartedPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: LlmInstructionStartedEventData
): BaseEventPayload<LlmInstructionStartedEventData> => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an LLM instruction completed event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the LLM instruction completed event.
 * @returns The complete event payload.
 */
export const createLlmInstructionCompletedPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: LlmInstructionCompletedEventData
): BaseEventPayload<LlmInstructionCompletedEventData> => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an LLM instruction error event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the LLM instruction error event.
 * @returns The complete event payload.
 */
export const createLlmInstructionErrorPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: LlmInstructionErrorEventData
): BaseEventPayload<LlmInstructionErrorEventData> => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP tool register event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP tool register event.
 * @returns The complete event payload.
 */
export const createMcpToolRegisterPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpToolEventData & { registrationDetails: any }
): McpToolRegisteredEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP tool registered response event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP tool registered response event.
 * @returns The complete event payload.
 */
export const createMcpToolRegisteredPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpToolEventData & { success: boolean; error?: string }
): McpToolRegisteredEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data: {
        ...data,
        registrationDetails: { success: data.success, error: data.error }
    },
});

/**
 * Creates a payload for an MCP tool unregister event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP tool unregister event.
 * @returns The complete event payload.
 */
export const createMcpToolUnregisterPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpToolEventData
): McpToolUnregisteredEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP tool call event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP tool call event.
 * @returns The complete event payload.
 */
export const createMcpToolCallPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpToolEventData & { callId: string; arguments: any }
): McpToolCallEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP tool result event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP tool result event.
 * @returns The complete event payload.
 */
export const createMcpToolResultPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpToolEventData & { callId: string; result: any }
): McpToolResultEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP tool error event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP tool error event.
 * @returns The complete event payload.
 */
export const createMcpToolErrorPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpToolEventData & { callId: string; error: any }
): McpToolErrorEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP resource get event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP resource get event.
 * @returns The complete event payload.
 */
export const createMcpResourceGetPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpResourceEventData & { requestId: string }
): McpResourceGetEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP resource list event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP resource list event.
 * @returns The complete event payload.
 */
export const createMcpResourceListPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpResourceEventData & { requestId: string; filter?: any }
): McpResourceListEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP resource result event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP resource result event.
 * @returns The complete event payload.
 */
export const createMcpResourceResultPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpResourceEventData & { requestId: string; data: any }
): McpResourceResultEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an MCP resource error event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP resource error event.
 * @returns The complete event payload.
 */
export const createMcpResourceErrorPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: McpResourceEventData & { requestId: string; error: any }
): McpResourceErrorEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an external MCP server event (global or channel-scoped).
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param serverData - The specific data for the external MCP server event.
 * @param options - Optional base event payload options.
 * @returns The complete event payload.
 */
export function createExternalMcpServerEventPayload(
    eventType: EventName | string,
    agentId: AgentId,
    channelId: ChannelId,
    serverData: ExternalMcpServerEventData,
    options: { source?: string; eventId?: string; timestamp?: number } = {}
): ExternalMcpServerEventPayload {
    return createBaseEventPayload<ExternalMcpServerEventData>(
        eventType,
        agentId,
        channelId,
        serverData,
        options
    );
}

/**
 * Creates a payload for an MCP tool registry changed event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the MCP tool registry changed event.
 * @returns The complete event payload.
 */
export const createMcpToolRegistryChangedPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: { tools: Array<{ name: string, description: string, inputSchema: Record<string, any> }> }
): BaseEventPayload<{ tools: Array<{ name: string, description: string, inputSchema: Record<string, any> }> }> => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Data for agent message delivered events.
 */
export interface AgentMessageDeliveredEventData {
    fromAgentId: string;
    toAgentId: string;
    content: any;
    timestamp: number;
    [key: string]: any;
}

/**
 * Payload type for agent message delivered events.
 */
export type AgentMessageDeliveredEventPayload = BaseEventPayload<AgentMessageDeliveredEventData>;

/**
 * Data for agent state change events (e.g., agent becoming active/inactive).
 */
export interface AgentStateChangeEventData {
    // Add properties for agent state change data
}

/**
 * Creates a payload for an agent message delivered event.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the agent message delivered event.
 * @returns The complete event payload.
 */
export const createAgentMessageDeliveredPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: AgentMessageDeliveredEventData
): AgentMessageDeliveredEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a payload for an agent message forward event (used server-side).
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The original agent message event payload being forwarded.
 * @returns The complete event payload.
 */
export const createAgentMessageForwardPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: any
): BaseEventPayload<any> => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Defines the parameters required for creating a new channel.
 * This is used as the 'data' field in channel creation events.
 */
export interface ChannelCreationParams {
    /**
     * The unique identifier for the channel to be created.
     */
    channelId: string;

    /**
     * Optional descriptive name for the channel.
     * If not provided, it may default to the channelId.
     */
    name?: string;

    /**
     * The identifier of the agent initiating the channel creation.
     */
    agentId: string;

    // Add any other properties specifically needed for channel creation,
    // for example, initial members, channel type, metadata, etc.
}

/**
 * Interface for channel creation events
 */
export interface ChannelCreationEventData {
    channelId: string;
    agentId: string;
    timestamp: number;
    config?: any;
    status: 'pending' | 'created' | 'error';
    error?: string;
}

/**
 * Payload type for channel creation events
 */
export type ChannelCreationEventPayload = BaseEventPayload<ChannelCreationEventData>;

/**
 * Channel context operation payload types
 */

// Get context
export interface ContextGetEventData {
    channelId: ChannelId;
    operationId?: string;
    timestamp: number;
}

export type ContextGetEventPayload = BaseEventPayload<ContextGetEventData>;

// Got context
export interface ContextGotEventData {
    channelId: ChannelId;
    context: any;
    operationId?: string;
    timestamp: number;
}

export type ContextGotEventPayload = BaseEventPayload<ContextGotEventData>;

// Get context failed
export interface ContextGetFailedEventData {
    channelId: ChannelId;
    error: string;
    operationId?: string;
    timestamp: number;
}

export type ContextGetFailedEventPayload = BaseEventPayload<ContextGetFailedEventData>;

// Update context
export interface ContextUpdateEventData {
    channelId: ChannelId;
    agentId: AgentId;
    updates: any;
    operationId?: string;
    timestamp: number;
}

export type ContextUpdateEventPayload = BaseEventPayload<ContextUpdateEventData>;

// Context updated
export interface ContextUpdatedEventData {
    channelId: ChannelId;
    context: any;
    operationId?: string;
    timestamp: number;
}

export type ContextUpdatedEventPayload = BaseEventPayload<ContextUpdatedEventData>;

// Context update failed
export interface ContextUpdateFailedEventData {
    channelId: ChannelId;
    error: string;
    operationId?: string;
    timestamp: number;
}

export type ContextUpdateFailedEventPayload = BaseEventPayload<ContextUpdateFailedEventData>;

// Set metadata
export interface MetadataSetEventData {
    channelId: ChannelId;
    agentId: AgentId;
    key: string;
    value: any;
    operationId?: string;
    timestamp: number;
}

export type MetadataSetEventPayload = BaseEventPayload<MetadataSetEventData>;

// Metadata set success
export interface MetadataSetSuccessEventData {
    channelId: ChannelId;
    key: string;
    value: any;
    operationId?: string;
    timestamp: number;
}

export type MetadataSetSuccessEventPayload = BaseEventPayload<MetadataSetSuccessEventData>;

// Metadata set failed
export interface MetadataSetFailedEventData {
    channelId: ChannelId;
    key: string;
    error: string;
    operationId?: string;
    timestamp: number;
}

export type MetadataSetFailedEventPayload = BaseEventPayload<MetadataSetFailedEventData>;

// Get metadata
export interface MetadataGetEventData {
    channelId: ChannelId;
    key?: string;
    operationId?: string;
    timestamp: number;
}

export type MetadataGetEventPayload = BaseEventPayload<MetadataGetEventData>;

// Got metadata
export interface MetadataGotEventData {
    channelId: ChannelId;
    metadata: Record<string, any> | any;
    operationId?: string;
    timestamp: number;
}

export type MetadataGotEventPayload = BaseEventPayload<MetadataGotEventData>;

// Get metadata failed
export interface MetadataGetFailedEventData {
    channelId: ChannelId;
    key?: string;
    error: string;
    operationId?: string;
    timestamp: number;
}

export type MetadataGetFailedEventPayload = BaseEventPayload<MetadataGetFailedEventData>;

// Extract topics
export interface TopicsExtractEventData {
    channelId: ChannelId;
    minRelevance?: number;
    operationId?: string;
    timestamp: number;
}

export type TopicsExtractEventPayload = BaseEventPayload<TopicsExtractEventData>;

// Topics extracted
export interface TopicsExtractedEventData {
    channelId: ChannelId;
    topics: Array<{
        id: string;
        topic: string;
        keywords: string[];
        relevance: number;
    }>;
    operationId?: string;
    timestamp: number;
}

export type TopicsExtractedEventPayload = BaseEventPayload<TopicsExtractedEventData>;

// Topics extract failed
export interface TopicsExtractFailedEventData {
    channelId: ChannelId;
    error: string;
    operationId?: string;
    timestamp: number;
}

export type TopicsExtractFailedEventPayload = BaseEventPayload<TopicsExtractFailedEventData>;

// Generate summary
export interface SummaryGenerateEventData {
    channelId: ChannelId;
    messageCount?: number;
    operationId?: string;
    timestamp: number;
}

export type SummaryGenerateEventPayload = BaseEventPayload<SummaryGenerateEventData>;

// Summary generated
export interface SummaryGeneratedEventData {
    channelId: ChannelId;
    summary: string;
    operationId?: string;
    timestamp: number;
}

export type SummaryGeneratedEventPayload = BaseEventPayload<SummaryGeneratedEventData>;

// Summary generate failed
export interface SummaryGenerateFailedEventData {
    channelId: ChannelId;
    error: string;
    operationId?: string;
    timestamp: number;
}

export type SummaryGenerateFailedEventPayload = BaseEventPayload<SummaryGenerateFailedEventData>;

/**
 * Creates a ChannelCreationEventPayload.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the channel creation event.
 * @returns The complete event payload.
 */
export const createChannelCreationEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: ChannelCreationEventData
): ChannelCreationEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a ContextGetEventPayload.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the context get event.
 * @returns The complete event payload.
 */
export const createContextGetEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: ContextGetEventData
): ContextGetEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a ContextGotEventPayload.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the context got event.
 * @returns The complete event payload.
 */
export const createContextGotEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: ContextGotEventData
): ContextGotEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a ContextUpdateEventPayload.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the context update event.
 * @returns The complete event payload.
 */
export const createContextUpdateEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: ContextUpdateEventData
): ContextUpdateEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a MetadataSetEventPayload.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the metadata set event.
 * @returns The complete event payload.
 */
export const createMetadataSetEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MetadataSetEventData
): MetadataSetEventPayload => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'SYSTEM',
    data,
});

/**
 * Creates a TopicsExtractEventPayload.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the topics extract event.
 * @param options - Optional parameters like source, recursion protection flag, or overrides for eventId and timestamp.
 * @returns The complete event payload.
 */
export const createTopicsExtractEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: TopicsExtractEventData,
    options: { source?: string; isRecursionProtection?: boolean; eventId?: string; timestamp?: number; } = {}
): TopicsExtractEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'SYSTEM',
    isRecursionProtection: options.isRecursionProtection,
    data,
});

/**
 * Creates a SummaryGenerateEventPayload.
 * @param eventType - The specific event type.
 * @param agentId - The ID of the agent initiating or responsible for the event.
 * @param channelId - The ID of the channel associated with the event.
 * @param data - The specific data for the summary generate event.
 * @param options - Optional parameters like source, recursion protection flag, or overrides for eventId and timestamp.
 * @returns The complete event payload.
 */
export const createSummaryGenerateEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: SummaryGenerateEventData,
    options: { source?: string; isRecursionProtection?: boolean; eventId?: string; timestamp?: number; } = {}
): SummaryGenerateEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'SYSTEM',
    isRecursionProtection: options.isRecursionProtection,
    data,
});

/**
 * Data for agent state change events (e.g., agent becoming active/inactive).
 */
export interface AgentStateChangeEventData {
    // Add properties for agent state change data
}

export type AgentStateChangeEventPayload = BaseEventPayload<AgentStateChangeEventData>;

// === MCP Event Payloads ===

/**
 * Data for external MCP server error events
 */
export interface ExternalMcpServerErrorEventData {
    error: string;
    code: string;
    details: Record<string, any>;
}

export type ExternalMcpServerErrorEventPayload = BaseEventPayload<ExternalMcpServerErrorEventData>;

/**
 * Data for external MCP server health status events
 */
export interface ExternalMcpServerHealthStatusEventData {
    name: string;
    version: string;
    status: string;
    description?: string;
}

export type ExternalMcpServerHealthStatusEventPayload = BaseEventPayload<ExternalMcpServerHealthStatusEventData>;

/**
 * Data for external MCP server tools discovered events
 */
export interface ExternalMcpServerToolsDiscoveredEventData {
    name: string;
    version: string;
    tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
    }>;
}

export type ExternalMcpServerToolsDiscoveredEventPayload = BaseEventPayload<ExternalMcpServerToolsDiscoveredEventData>;

/**
 * Creates an external MCP server error event payload.
 */
export const createExternalMcpServerErrorEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: ExternalMcpServerErrorEventData,
    options: { source?: string; isRecursionProtection?: boolean; eventId?: string; timestamp?: number; } = {}
): ExternalMcpServerErrorEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'ExternalMcpServerManager',
    isRecursionProtection: options.isRecursionProtection,
    data,
});

/**
 * Creates an external MCP server health status event payload.
 */
export const createExternalMcpServerHealthStatusEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: ExternalMcpServerHealthStatusEventData,
    options: { source?: string; isRecursionProtection?: boolean; eventId?: string; timestamp?: number; } = {}
): ExternalMcpServerHealthStatusEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'ExternalMcpServerManager',
    isRecursionProtection: options.isRecursionProtection,
    data,
});

/**
 * Creates an external MCP server tools discovered event payload.
 */
export const createExternalMcpServerToolsDiscoveredEventPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: ExternalMcpServerToolsDiscoveredEventData,
    options: { source?: string; isRecursionProtection?: boolean; eventId?: string; timestamp?: number; } = {}
): ExternalMcpServerToolsDiscoveredEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'ExternalMcpServerManager',
    isRecursionProtection: options.isRecursionProtection,
    data,
});

// === System Event Payloads ===

/**
 * Import system event types and interfaces
 */
import { 
    SystemEphemeralEventData, 
    CoordinationAnalysis, 
    TemporalContext,
    SystemEventType
} from '../events/event-definitions/SystemEvents';

/**
 * System ephemeral event payload for EventBus integration
 * These events provide intelligent context injection without appearing in message history
 */
export interface SystemEphemeralEventPayloadData {
    /** Ephemeral event data with temporal context */
    eventData: SystemEphemeralEventData;
    /** Coordination analysis context */
    coordinationContext?: CoordinationAnalysis;
    /** Additional system metadata */
    systemMetadata: {
        /** System intelligence confidence */
        systemConfidence: number;
        /** Processing timestamp */
        processingTime: number;
        /** System version */
        systemVersion: string;
        /** Analysis method used */
        analysisMethod: 'pattern_recognition' | 'temporal_analysis' | 'coordination_detection' | 'activity_monitoring';
    };
}

export type SystemEphemeralEventPayload = BaseEventPayload<SystemEphemeralEventPayloadData>;

/**
 * System coordination event payload for coordination analysis results
 */
export interface SystemCoordinationEventPayloadData {
    /** Coordination analysis results */
    coordinationAnalysis: CoordinationAnalysis;
    /** Recommended actions */
    recommendedActions: string[];
    /** Priority level for coordination */
    priority: number;
    /** Temporal context */
    temporalContext: TemporalContext;
    /** Confidence in recommendations */
    recommendationConfidence: number;
}

export type SystemCoordinationEventPayload = BaseEventPayload<SystemCoordinationEventPayloadData>;

/**
 * System temporal pattern event payload for time-based pattern detection
 */
export interface SystemTemporalPatternEventPayloadData {
    /** Detected temporal pattern */
    pattern: {
        /** Pattern type */
        type: string;
        /** Pattern description */
        description: string;
        /** Temporal context */
        temporalContext: TemporalContext;
        /** Pattern confidence */
        confidence: number;
        /** Affected channels */
        affectedChannels: ChannelId[];
        /** Suggested responses */
        suggestedResponses: string[];
        /** Pattern frequency */
        frequency: 'rare' | 'occasional' | 'regular' | 'frequent' | 'constant';
        /** Pattern duration */
        duration: number;
    };
    /** Pattern impact assessment */
    impactAssessment: {
        /** Severity of pattern impact */
        severity: 'low' | 'medium' | 'high' | 'critical';
        /** Affected agents */
        affectedAgents: AgentId[];
        /** Recommended response time */
        responseTimeMs: number;
    };
}

export type SystemTemporalPatternEventPayload = BaseEventPayload<SystemTemporalPatternEventPayloadData>;

/**
 * System context analysis event payload for rich context awareness
 */
export interface SystemContextAnalysisEventPayloadData {
    /** Context analysis results */
    contextAnalysis: {
        /** Channel activity summary */
        channelActivity: {
            /** Activity level (0-10) */
            level: number;
            /** Recent message count */
            messageCount: number;
            /** Active agent count */
            activeAgents: number;
            /** Tool usage frequency */
            toolUsage: number;
        };
        /** Agent interaction patterns */
        interactionPatterns: {
            /** Collaboration intensity */
            collaborationIntensity: number;
            /** Communication frequency */
            communicationFrequency: number;
            /** Resource sharing level */
            resourceSharing: number;
        };
        /** System intelligence insights */
        systemInsights: string[];
        /** Temporal context */
        temporalContext: TemporalContext;
    };
    /** Analysis confidence */
    analysisConfidence: number;
    /** Next analysis scheduled time */
    nextAnalysisTime: string;
}

export type SystemContextAnalysisEventPayload = BaseEventPayload<SystemContextAnalysisEventPayloadData>;

// === System Event Payload Creation Helpers ===

/**
 * Creates a system ephemeral event payload for intelligent context injection
 */
export const createSystemEphemeralEventPayload = (
    eventType: SystemEventType,
    agentId: AgentId,
    channelId: ChannelId,
    eventData: SystemEphemeralEventData,
    coordinationContext?: CoordinationAnalysis,
    options: { 
        source?: string; 
        isRecursionProtection?: boolean; 
        eventId?: string; 
        timestamp?: number;
        systemConfidence?: number;
        analysisMethod?: 'pattern_recognition' | 'temporal_analysis' | 'coordination_detection' | 'activity_monitoring';
    } = {}
): SystemEphemeralEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'SystemLlmService',
    isRecursionProtection: options.isRecursionProtection,
    data: {
        eventData,
        coordinationContext,
        systemMetadata: {
            systemConfidence: options.systemConfidence || 0.8,
            processingTime: Date.now(),
            systemVersion: '1.0.0',
            analysisMethod: options.analysisMethod || 'coordination_detection'
        }
    },
});

/**
 * Creates a system coordination event payload for coordination analysis
 */
export const createSystemCoordinationEventPayload = (
    eventType: SystemEventType,
    agentId: AgentId,
    channelId: ChannelId,
    coordinationAnalysis: CoordinationAnalysis,
    recommendedActions: string[],
    temporalContext: TemporalContext,
    options: { 
        source?: string; 
        isRecursionProtection?: boolean; 
        eventId?: string; 
        timestamp?: number;
        priority?: number;
        recommendationConfidence?: number;
    } = {}
): SystemCoordinationEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'SystemLlmService',
    isRecursionProtection: options.isRecursionProtection,
    data: {
        coordinationAnalysis,
        recommendedActions,
        priority: options.priority || 5,
        temporalContext,
        recommendationConfidence: options.recommendationConfidence || 0.75
    },
});

/**
 * Creates a system temporal pattern event payload for pattern detection
 */
export const createSystemTemporalPatternEventPayload = (
    eventType: SystemEventType,
    agentId: AgentId,
    channelId: ChannelId,
    pattern: SystemTemporalPatternEventPayloadData['pattern'],
    impactAssessment: SystemTemporalPatternEventPayloadData['impactAssessment'],
    options: { 
        source?: string; 
        isRecursionProtection?: boolean; 
        eventId?: string; 
        timestamp?: number;
    } = {}
): SystemTemporalPatternEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'SystemLlmService',
    isRecursionProtection: options.isRecursionProtection,
    data: {
        pattern,
        impactAssessment
    },
});

/**
 * Creates a system context analysis event payload for rich context awareness
 */
export const createSystemContextAnalysisEventPayload = (
    eventType: SystemEventType,
    agentId: AgentId,
    channelId: ChannelId,
    contextAnalysis: SystemContextAnalysisEventPayloadData['contextAnalysis'],
    options: { 
        source?: string; 
        isRecursionProtection?: boolean; 
        eventId?: string; 
        timestamp?: number;
        analysisConfidence?: number;
        nextAnalysisTime?: string;
    } = {}
): SystemContextAnalysisEventPayload => ({
    eventId: options.eventId || uuidv4(),
    eventType,
    timestamp: options.timestamp || Date.now(),
    agentId,
    channelId,
    source: options.source || 'SystemLlmService',
    isRecursionProtection: options.isRecursionProtection,
    data: {
        contextAnalysis,
        analysisConfidence: options.analysisConfidence || 0.8,
        nextAnalysisTime: options.nextAnalysisTime || new Date(Date.now() + 300000).toISOString() // 5 minutes default
    },
});

/**
 * Validation helper for system event payloads
 * Ensures system events meet quality and security standards
 */
export const validateSystemEventPayload = (payload: SystemEphemeralEventPayload): boolean => {
    const validator = createStrictValidator('SystemEventPayload');
    
    try {
        // Validate base payload structure
        validator.assertIsNonEmptyString(payload.eventId, 'Event ID is required');
        validator.assertIsNonEmptyString(payload.eventType, 'Event type is required');
        validator.assertIsNumber(payload.timestamp, 'Timestamp is required');
        validator.assertIsNonEmptyString(payload.agentId, 'Agent ID is required');
        validator.assertIsNonEmptyString(payload.channelId, 'Channel ID is required');
        
        // Validate system event data
        validator.assertIsObject(payload.data, 'Event data is required');
        validator.assertIsObject(payload.data.eventData, 'Event data content is required');
        validator.assertIsNonEmptyString(payload.data.eventData.content, 'Event content is required');
        validator.assertIsObject(payload.data.eventData.temporalContext, 'Temporal context is required');
        
        // Validate confidence scores
        const confidence = payload.data.eventData.metadata.confidence;
        validator.assert(confidence >= 0 && confidence <= 1, 'Confidence must be between 0 and 1');
        
        const relevance = payload.data.eventData.metadata.relevance;
        validator.assert(relevance >= 0 && relevance <= 1, 'Relevance must be between 0 and 1');
        
        // Validate TTL
        validator.assert(payload.data.eventData.ttl > 0, 'TTL must be positive');
        
        return true;
    } catch (error) {
        logger.warn(`System event payload validation failed: ${error}`);
        return false;
    }
};

/**
 * Create a TemporalContext object from Time MCP server data
 * @param timeData - Raw data from Time MCP server
 * @param options - Optional configuration for temporal context
 * @returns Properly formatted TemporalContext object
 */
export const createTemporalContext = (
    timeData: any = {},
    options: {
        businessHoursStart?: string;
        businessHoursEnd?: string;
        timezone?: string;
    } = {}
): TemporalContext => {
    const validator = createStrictValidator('TemporalContext');
    
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const businessStart = parseInt(options.businessHoursStart?.split(':')[0] || '9');
    const businessEnd = parseInt(options.businessHoursEnd?.split(':')[0] || '17');
    const isBusinessHours = hour >= businessStart && hour <= businessEnd && !isWeekend;
    
    // Generate contextual timing
    let contextualTiming = 'Standard operating period';
    if (isWeekend) {
        contextualTiming = 'Weekend period - reduced activity expected';
    } else if (hour >= businessStart && hour <= businessEnd) {
        contextualTiming = 'Peak collaboration hours - high agent activity';
    } else if (hour >= 18 && hour <= 22) {
        contextualTiming = 'Evening period - moderate activity';
    } else {
        contextualTiming = 'Off-peak hours - limited activity expected';
    }
    
    return {
        currentTime: timeData.current_time || now.toISOString(),
        localTime: timeData.local_time || now.toLocaleString(),
        relativeTime: timeData.relative_time || 'now',
        workingHours: timeData.business_hours ?? isBusinessHours,
        timeZone: timeData.timezone || options.timezone || 'UTC',
        dayOfWeek: timeData.day_of_week || now.toLocaleDateString('en-US', { weekday: 'long' }),
        contextualTiming,
        metadata: {
            timestamp: Date.now(),
            businessHours: {
                start: options.businessHoursStart || '09:00',
                end: options.businessHoursEnd || '17:00'
            },
            utcOffset: timeData.utc_offset || 0,
            isWeekend: timeData.is_weekend ?? isWeekend
        }
    };
};

/**
 * Create a basic CoordinationAnalysis object
 * @param channelId - Channel identifier
 * @param options - Optional configuration for analysis
 * @returns Basic CoordinationAnalysis structure
 */
export const createBasicCoordinationAnalysis = (
    channelId: ChannelId,
    options: {
        activeAgents?: AgentId[];
        messageCount?: number;
        toolUsage?: number;
        timePeriod?: string;
    } = {}
): CoordinationAnalysis => {
    const validator = createStrictValidator('CoordinationAnalysis');
    validator.assertIsNonEmptyString(channelId, 'Channel ID is required for coordination analysis');
    
    return {
        channelId,
        activeAgents: options.activeAgents || [],
        opportunities: [
            {
                type: 'collaboration',
                involvedAgents: options.activeAgents || [],
                description: 'Detected potential for agent collaboration based on activity patterns',
                confidence: 0.7,
                suggestedAction: 'Consider coordinating on shared objectives'
            }
        ],
        activityMetrics: {
            messageCount: options.messageCount || 0,
            toolUsage: options.toolUsage || 0,
            interactionDensity: 0,
            timePeriod: options.timePeriod || 'last 10 minutes'
        },
        temporalPatterns: [],
        analysisTime: new Date().toISOString()
    };
};

// === MXF Tool Service Payload Helpers ===

/**
 * Data for MXF tool list request events
 */
export interface MxfToolListEventData {
    filter?: {
        name?: string;
        channelId?: string;
    };
    allowedTools?: string[]; // Agent-specific tool restrictions
    requestId?: string;
}

/**
 * Data for MXF tool list result events
 */
export interface MxfToolListResultEventData {
    tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
        enabled: boolean;
        providerId: string;
        channelId: string;
        parameters?: any;
        metadata?: any;
    }>;
    count: number;
    requestId?: string;
}

/**
 * Data for MXF tool list error events
 */
export interface MxfToolListErrorEventData {
    error: string;
    requestId?: string;
}

/**
 * Creates a payload for MXF tool list request events
 */
export const createMxfToolListPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MxfToolListEventData
): BaseEventPayload<MxfToolListEventData> => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'MXF_CLIENT',
    data,
});

/**
 * Creates a payload for MXF tool list result events
 */
export const createMxfToolListResultPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MxfToolListResultEventData
): BaseEventPayload<MxfToolListResultEventData> => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'MXF_SERVICE',
    data,
});

/**
 * Creates a payload for MXF tool list error events
 */
export const createMxfToolListErrorPayload = (
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MxfToolListErrorEventData
): BaseEventPayload<MxfToolListErrorEventData> => ({
    eventId: uuidv4(),
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'MXF_SERVICE',
    data,
});

// --- MXP 2.0 Event Payload Creators ---

import { 
    MxpTokenOptimizationEventData,
    MxpBandwidthOptimizationEventData,
    MxpSecurityEventData,
    MxpAnalyticsEventData
} from '../events/event-definitions/MxpEvents';

export { 
    MxpTokenOptimizationEventData,
    MxpBandwidthOptimizationEventData,
    MxpSecurityEventData,
    MxpAnalyticsEventData
};

/**
 * Creates an MXP token optimization event payload
 */
export function createMxpTokenOptimizationEventPayload(
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MxpTokenOptimizationEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): BaseEventPayload<MxpTokenOptimizationEventData> {
    const validator = createStrictValidator('createMxpTokenOptimizationEventPayload');
    validator.assertIsNonEmptyString(data.operationId, 'operationId');
    validator.assertIsNumber(data.originalTokens, 'originalTokens must be a number');
    validator.assertIsNumber(data.optimizedTokens, 'optimizedTokens must be a number');
    validator.assertIsNumber(data.compressionRatio, 'compressionRatio must be a number');
    
    return createBaseEventPayload<MxpTokenOptimizationEventData>(
        eventType, agentId, channelId, data, options
    );
}

/**
 * Creates an MXP bandwidth optimization event payload
 */
export function createMxpBandwidthOptimizationEventPayload(
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MxpBandwidthOptimizationEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): BaseEventPayload<MxpBandwidthOptimizationEventData> {
    const validator = createStrictValidator('createMxpBandwidthOptimizationEventPayload');
    validator.assertIsNonEmptyString(data.operationId, 'operationId');
    validator.assertIsNumber(data.originalSize, 'originalSize must be a number');
    validator.assertIsNumber(data.compressedSize, 'compressedSize must be a number');
    validator.assertIsNumber(data.compressionRatio, 'compressionRatio must be a number');
    
    return createBaseEventPayload<MxpBandwidthOptimizationEventData>(
        eventType, agentId, channelId, data, options
    );
}

/**
 * Creates an MXP security event payload
 */
export function createMxpSecurityEventPayload(
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MxpSecurityEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): BaseEventPayload<MxpSecurityEventData> {
    const validator = createStrictValidator('createMxpSecurityEventPayload');
    validator.assertIsNonEmptyString(data.newLevel, 'newLevel');
    validator.assertIsNumber(data.timestamp, 'timestamp must be a number');
    
    return createBaseEventPayload<MxpSecurityEventData>(
        eventType, agentId, channelId, data, options
    );
}

/**
 * Creates an MXP analytics event payload
 */
export function createMxpAnalyticsEventPayload(
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MxpAnalyticsEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): BaseEventPayload<MxpAnalyticsEventData> {
    const validator = createStrictValidator('createMxpAnalyticsEventPayload');
    validator.assertIsNonEmptyString(data.metricType, 'metricType');
    validator.assertIsNumber(data.value, 'value must be a number');
    validator.assertIsNonEmptyString(data.unit, 'unit');
    validator.assertIsNumber(data.timestamp, 'timestamp must be a number');
    
    return createBaseEventPayload<MxpAnalyticsEventData>(
        eventType, agentId, channelId, data, options
    );
}

// --- Meilisearch Integration Event Payload Creators ---

/**
 * Data for Meilisearch indexing events
 */
export interface MeilisearchIndexEventData {
    operationId: string;          // Unique ID for this indexing operation
    indexName: string;            // Name of the Meilisearch index (e.g., 'mxf-conversations')
    documentId: string;           // ID of the document being indexed
    documentType: 'conversation' | 'action' | 'pattern' | 'observation'; // Type of document
    success: boolean;             // Whether indexing succeeded
    duration?: number;            // Time taken to index in milliseconds
    error?: string;               // Error message if indexing failed
    metadata?: {                  // Additional context
        messageCount?: number;    // For batch operations
        agentId?: string;
        channelId?: string;
        timestamp?: number;
    };
}
export type MeilisearchIndexEventPayload = BaseEventPayload<MeilisearchIndexEventData>;

/**
 * Data for Meilisearch search events
 */
export interface MeilisearchSearchEventData {
    operationId: string;          // Unique ID for this search operation
    indexName: string;            // Name of the Meilisearch index searched
    query: string;                // Search query text
    hybridRatio?: number;         // Semantic/keyword ratio (0.0-1.0)
    resultCount: number;          // Number of results returned
    duration: number;             // Search latency in milliseconds
    filters?: Record<string, any>; // Applied filters (channelId, agentId, etc.)
    success: boolean;             // Whether search succeeded
    error?: string;               // Error message if search failed
    metadata?: {                  // Additional context
        semanticSearch?: boolean; // Whether semantic search was used
        embeddingModel?: string;  // Model used for embeddings
        cacheHit?: boolean;       // Whether result was cached
    };
}
export type MeilisearchSearchEventPayload = BaseEventPayload<MeilisearchSearchEventData>;

/**
 * Data for Meilisearch backfill events
 */
export interface MeilisearchBackfillEventData {
    operationId: string;          // Unique ID for this backfill operation
    indexName: string;            // Name of the Meilisearch index
    totalDocuments: number;       // Total documents to backfill
    indexedDocuments: number;     // Number of documents successfully indexed
    failedDocuments: number;      // Number of documents that failed to index
    duration: number;             // Total time taken in milliseconds
    success: boolean;             // Whether backfill completed successfully
    source: 'mongodb' | 'memory' | 'other'; // Source of backfilled data
    error?: string;               // Error message if backfill failed
    metadata?: {                  // Additional context
        agentId?: string;
        channelId?: string;
        startTimestamp?: number;  // Earliest message timestamp
        endTimestamp?: number;    // Latest message timestamp
        batchSize?: number;       // Batch size used for indexing
    };
}
export type MeilisearchBackfillEventPayload = BaseEventPayload<MeilisearchBackfillEventData>;

/**
 * Creates a Meilisearch indexing event payload
 */
export function createMeilisearchIndexEventPayload(
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MeilisearchIndexEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): BaseEventPayload<MeilisearchIndexEventData> {
    const validator = createStrictValidator('createMeilisearchIndexEventPayload');
    validator.assertIsNonEmptyString(data.operationId, 'operationId');
    validator.assertIsNonEmptyString(data.indexName, 'indexName');
    validator.assertIsNonEmptyString(data.documentId, 'documentId');
    validator.assertIsNonEmptyString(data.documentType, 'documentType');
    validator.assertIsBoolean(data.success);

    return createBaseEventPayload<MeilisearchIndexEventData>(
        eventType, agentId, channelId, data, options
    );
}

/**
 * Creates a Meilisearch search event payload
 */
export function createMeilisearchSearchEventPayload(
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MeilisearchSearchEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): BaseEventPayload<MeilisearchSearchEventData> {
    const validator = createStrictValidator('createMeilisearchSearchEventPayload');
    validator.assertIsNonEmptyString(data.operationId, 'operationId');
    validator.assertIsNonEmptyString(data.indexName, 'indexName');
    validator.assertIsNonEmptyString(data.query, 'query');
    validator.assertIsNumber(data.resultCount, 'resultCount must be a number');
    validator.assertIsNumber(data.duration, 'duration must be a number');
    validator.assertIsBoolean(data.success);

    return createBaseEventPayload<MeilisearchSearchEventData>(
        eventType, agentId, channelId, data, options
    );
}

/**
 * Creates a Meilisearch backfill event payload
 */
export function createMeilisearchBackfillEventPayload(
    eventType: string,
    agentId: AgentId,
    channelId: ChannelId,
    data: MeilisearchBackfillEventData,
    options: { source?: string; eventId?: string; timestamp?: number; } = {}
): BaseEventPayload<MeilisearchBackfillEventData> {
    const validator = createStrictValidator('createMeilisearchBackfillEventPayload');
    validator.assertIsNonEmptyString(data.operationId, 'operationId');
    validator.assertIsNonEmptyString(data.indexName, 'indexName');
    validator.assertIsNumber(data.totalDocuments, 'totalDocuments must be a number');
    validator.assertIsNumber(data.indexedDocuments, 'indexedDocuments must be a number');
    validator.assertIsNumber(data.failedDocuments, 'failedDocuments must be a number');
    validator.assertIsNumber(data.duration, 'duration must be a number');
    validator.assertIsBoolean(data.success);
    validator.assertIsNonEmptyString(data.source, 'source');

    return createBaseEventPayload<MeilisearchBackfillEventData>(
        eventType, agentId, channelId, data, options
    );
}
