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
 * Event Names and Payload Types
 * 
 * This file centralizes all event names and their associated payload types used in the framework 
 * to avoid string literals and prevent mismatches between emitters and listeners.
 * 
 * THIS IS THE SINGLE SOURCE OF TRUTH for all event names and payload types in the framework.
 * Both the server and SDK import from this file.
 */

/**
 * Core Socket.IO events that are part of the Socket.IO library itself
 */
export const CoreSocketEvents = {
    // Standard Socket.IO events
    CONNECT: 'connect', // Fired when the client successfully connects to the server
    DISCONNECT: 'disconnect', // Fired when the client disconnects from the server
    CONNECT_ERROR: 'connect_error', // Fired when the connection cannot be established
    RECONNECT: 'reconnect', // Fired when the client successfully reconnects after disconnection
    RECONNECT_ATTEMPT: 'reconnect_attempt', // Fired when attempting to reconnect
    RECONNECT_ERROR: 'reconnect_error', // Fired when a reconnection attempt error occurs
    RECONNECT_FAILED: 'reconnect_failed', // Fired when all reconnection attempts have failed
    ERROR: 'error', // Fired when an error occurs in Socket.IO

    // Socket.IO protocol events
    CONNECTION: 'connection', // Fired on the server when a new client connects
    PING: 'ping', // Internal ping event to check connection health
    PONG: 'pong', // Response to ping event
};

/**
 * Reserved socket.io events that should not be re-emitted to prevent loops and conflicts
 */
export const SOCKET_RESERVED_EVENTS = Object.values(CoreSocketEvents);

export type SocketReservedEventType = typeof SOCKET_RESERVED_EVENTS[number];

/**
 * Payload types for Core Socket.IO events
 */
export interface CoreSocketPayloads {
    'connect': void;
    'disconnect': { reason: string };
    'connect_error': Error;
    'reconnect': number;
    'reconnect_attempt': number;
    'reconnect_error': Error;
    'reconnect_failed': void;
    'error': Error;
    'connection': { socketId: string };
    'ping': any;
    'pong': any;
}

import { AgentEvents } from './event-definitions/AgentEvents';
import type { AgentPayloads, AgentRegistrationEvent, AgentConnectionEvent } from './event-definitions/AgentEvents';
export { AgentEvents };
export type { AgentPayloads, AgentRegistrationEvent, AgentConnectionEvent };

import { MessageEvents } from './event-definitions/MessageEvents';
import type { MessagePayloads, AgentMessageEvent } from './event-definitions/MessageEvents';
export { MessageEvents };
export type { MessagePayloads, AgentMessageEvent };

import { Events as ChannelEventsInternal, ChannelActionTypes } from './event-definitions/ChannelEvents';
import type { ChannelPayloads, ChannelActionType, ChannelCreationEvent } from './event-definitions/ChannelEvents';
export { ChannelEventsInternal as ChannelEvents, ChannelActionTypes };
export type { ChannelPayloads, ChannelActionType, ChannelCreationEvent };

import { MemoryEvents as MemoryEventsInternal, MemoryEvents } from './event-definitions/MemoryEvents';
import type { MemoryPayloads, MemoryUpdateEvent, MemoryCreateEvent, MemoryScope, MemoryGetEvent, MemoryDeleteEvent, MemorySyncEvent } from './event-definitions/MemoryEvents';
export { MemoryEvents };
export type { MemoryPayloads, MemoryUpdateEvent, MemoryCreateEvent, MemoryScope, MemoryGetEvent, MemoryDeleteEvent, MemorySyncEvent };

import { TaskEvents } from './event-definitions/TaskEvents';
import type { TaskPayloads, TaskRequestEvent, TaskResponseEvent } from './event-definitions/TaskEvents';
export { TaskEvents };
export type { TaskPayloads, TaskRequestEvent, TaskResponseEvent };

import { LlmServiceEvents } from './event-definitions/LlmEvents';
import type { LlmServicePayloads } from './event-definitions/LlmEvents';
export { LlmServiceEvents };
export type { LlmServicePayloads };

import { HeartbeatEvents } from './event-definitions/HeartbeatEvents';
import type { HeartbeatPayloads } from './event-definitions/HeartbeatEvents';
export { HeartbeatEvents };
export type { HeartbeatPayloads };

import { McpEvents } from './event-definitions/McpEvents';
import type { McpPayloads } from './event-definitions/McpEvents';
export { McpEvents };
export type { McpPayloads };

import { ControlLoopEvents } from './event-definitions/ControlLoopEvents';
import type { ControlLoopPayloads } from './event-definitions/ControlLoopEvents';
export { ControlLoopEvents };
export type { ControlLoopPayloads };

import { OrparEvents } from './event-definitions/OrparEvents';
import type { OrparPayloads } from './event-definitions/OrparEvents';
export { OrparEvents };
export type { OrparPayloads };

import { SystemEvents } from './event-definitions/SystemEvents';
export { SystemEvents };

import { AnalyticsEvents } from './event-definitions/AnalyticsEvents';
import type { AnalyticsPayloads } from './event-definitions/AnalyticsEvents';
export { AnalyticsEvents };
export type { AnalyticsPayloads };

import { ConfigEvents } from './event-definitions/ConfigEvents';
import type { ConfigPayloads } from './event-definitions/ConfigEvents';
export { ConfigEvents };
export type { ConfigPayloads };

import { BulkEvents } from './event-definitions/BulkEvents';
import type { BulkPayloads } from './event-definitions/BulkEvents';
export { BulkEvents };
export type { BulkPayloads };

import { MxpEvents } from './event-definitions/MxpEvents';
import type { MxpPayloads } from './event-definitions/MxpEvents';
export { MxpEvents };
export type { MxpPayloads };

import { KeyEvents } from './event-definitions/KeyEvents';
import type { KeyPayloads } from './event-definitions/KeyEvents';
export { KeyEvents };
export type { KeyPayloads };

import { MeilisearchEvents } from './event-definitions/MeilisearchEvents';
import type { MeilisearchPayloads } from './event-definitions/MeilisearchEvents';
export { MeilisearchEvents };
export type { MeilisearchPayloads };

import { CodeExecutionEvents } from './event-definitions/CodeExecutionEvents';
import type { CodeExecutionPayloads } from './event-definitions/CodeExecutionEvents';
export { CodeExecutionEvents };
export type { CodeExecutionPayloads };

import { WorkflowEvents } from './event-definitions/WorkflowEvents';
import type { WorkflowPayloads } from './event-definitions/WorkflowEvents';
export { WorkflowEvents };
export type { WorkflowPayloads };

import { InferenceParameterEvents } from './event-definitions/InferenceParameterEvents';
import type { InferenceParameterPayloads } from './event-definitions/InferenceParameterEvents';
export { InferenceParameterEvents };
export type { InferenceParameterPayloads };

import { PlanEvents } from './event-definitions/PlanEvents';
import type { PlanPayloads, PlanStepCompletedEventData } from './event-definitions/PlanEvents';
export { PlanEvents };
export type { PlanPayloads, PlanStepCompletedEventData };

import { MemoryUtilityEvents } from './event-definitions/MemoryUtilityEvents';
import type { MemoryUtilityPayloads } from './event-definitions/MemoryUtilityEvents';
export { MemoryUtilityEvents };
export type { MemoryUtilityPayloads };

import { OrparMemoryEvents } from './event-definitions/OrparMemoryEvents';
import type { OrparMemoryPayloads } from './event-definitions/OrparMemoryEvents';
export { OrparMemoryEvents };
export type { OrparMemoryPayloads };

import { DagEvents } from './event-definitions/DagEvents';
import type { DagPayloads } from './event-definitions/DagEvents';
export { DagEvents };
export type { DagPayloads };

import { KnowledgeGraphEvents } from './event-definitions/KnowledgeGraphEvents';
import type { KnowledgeGraphPayloads } from './event-definitions/KnowledgeGraphEvents';
export { KnowledgeGraphEvents };
export type { KnowledgeGraphPayloads };

import { TensorFlowEvents } from './event-definitions/TensorFlowEvents';
import type { TensorFlowPayloads } from './event-definitions/TensorFlowEvents';
export { TensorFlowEvents };
export type { TensorFlowPayloads };

import { UserInputEvents } from './event-definitions/UserInputEvents';
import type { UserInputPayloads } from './event-definitions/UserInputEvents';
export { UserInputEvents };
export type { UserInputPayloads };

/**
 * Socket Authentication Events
 * Used for socket authentication success/failure communication
 */
export const AuthEvents = {
    SUCCESS: 'auth:success',
    ERROR: 'auth:error'
} as const;

/**
 * Unified export of all events for convenience
 */
export namespace Events {
    export const Core = CoreSocketEvents;
    export const Agent = AgentEvents;
    export const Message = MessageEvents;
    export const Channel = ChannelEventsInternal;
    export const Key = KeyEvents;
    export const Task = TaskEvents;
    export const LlmService = LlmServiceEvents;
    export const ControlLoop = ControlLoopEvents;
    export const Orpar = OrparEvents;
    export const Heartbeat = HeartbeatEvents;
    export const Mcp = McpEvents;
    export const Memory = MemoryEventsInternal;
    export const System = SystemEvents;
    export const Analytics = AnalyticsEvents;
    export const Config = ConfigEvents;
    export const Bulk = BulkEvents;
    export const Auth = AuthEvents;
    export const Mxp = MxpEvents;
    export const Meilisearch = MeilisearchEvents;
    export const CodeExecution = CodeExecutionEvents;
    export const Workflow = WorkflowEvents;
    export const InferenceParameter = InferenceParameterEvents;
    export const Plan = PlanEvents;
    export const MemoryUtility = MemoryUtilityEvents;
    export const OrparMemory = OrparMemoryEvents;
    export const Dag = DagEvents;
    export const KnowledgeGraph = KnowledgeGraphEvents;
    export const TensorFlow = TensorFlowEvents;
    export const UserInput = UserInputEvents;
}

/**
 * Complete event map combining all event payloads
 */
export type EventMap =
    CoreSocketPayloads &
    AgentPayloads &
    MessagePayloads &
    ChannelPayloads &
    KeyPayloads &
    TaskPayloads &
    LlmServicePayloads &
    ControlLoopPayloads &
    OrparPayloads &
    HeartbeatPayloads &
    McpPayloads &
    MemoryPayloads &
    AnalyticsPayloads &
    ConfigPayloads &
    BulkPayloads &
    MxpPayloads &
    MeilisearchPayloads &
    CodeExecutionPayloads &
    WorkflowPayloads &
    InferenceParameterPayloads &
    PlanPayloads &
    MemoryUtilityPayloads &
    OrparMemoryPayloads &
    DagPayloads &
    KnowledgeGraphPayloads &
    TensorFlowPayloads &
    UserInputPayloads;

/**
 * Event name type - any valid event name
 */
export type EventName = keyof EventMap;
