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

import { AgentEvents, AgentPayloads, AgentRegistrationEvent, AgentConnectionEvent } from './event-definitions/AgentEvents';
export { AgentEvents, AgentPayloads, AgentRegistrationEvent, AgentConnectionEvent };

import { MessageEvents, MessagePayloads, AgentMessageEvent } from './event-definitions/MessageEvents';
export { MessageEvents, MessagePayloads, AgentMessageEvent };

import { ChannelPayloads, Events as ChannelEventsInternal, ChannelActionType, ChannelActionTypes, ChannelCreationEvent } from './event-definitions/ChannelEvents';
export { ChannelPayloads, ChannelEventsInternal as ChannelEvents, ChannelActionType, ChannelActionTypes, ChannelCreationEvent };

import { MemoryEvents as MemoryEventsInternal, MemoryPayloads, MemoryUpdateEvent, MemoryCreateEvent, MemoryScope, MemoryEvents,
    MemoryGetEvent,
    MemoryDeleteEvent,
    MemorySyncEvent, } from './event-definitions/MemoryEvents';
export { MemoryUpdateEvent, MemoryCreateEvent, MemoryScope, MemoryEvents, MemoryPayloads, MemoryGetEvent, MemoryDeleteEvent, MemorySyncEvent };

import { TaskEvents, TaskPayloads, TaskRequestEvent, TaskResponseEvent } from './event-definitions/TaskEvents';
export { TaskEvents, TaskPayloads, TaskRequestEvent, TaskResponseEvent };

import { LlmServiceEvents, LlmServicePayloads } from './event-definitions/LlmEvents';
export { LlmServiceEvents, LlmServicePayloads };

import { HeartbeatEvents, HeartbeatPayloads } from './event-definitions/HeartbeatEvents';
export { HeartbeatEvents, HeartbeatPayloads };

import { McpEvents, McpPayloads } from './event-definitions/McpEvents';
export { McpEvents, McpPayloads };

import { ControlLoopEvents, ControlLoopPayloads } from './event-definitions/ControlLoopEvents';
export { ControlLoopEvents };

import { OrparEvents, OrparPayloads } from './event-definitions/OrparEvents';
export { OrparEvents, OrparPayloads };

import { SystemEvents } from './event-definitions/SystemEvents';
export { SystemEvents };

import { AnalyticsEvents, AnalyticsPayloads } from './event-definitions/AnalyticsEvents';
export { AnalyticsEvents, AnalyticsPayloads };

import { ConfigEvents, ConfigPayloads } from './event-definitions/ConfigEvents';
export { ConfigEvents, ConfigPayloads };

import { BulkEvents, BulkPayloads } from './event-definitions/BulkEvents';
export { BulkEvents, BulkPayloads };

import { MxpEvents, MxpPayloads } from './event-definitions/MxpEvents';
export { MxpEvents, MxpPayloads };

import { KeyEvents, KeyPayloads } from './event-definitions/KeyEvents';
export { KeyEvents, KeyPayloads };

import { MeilisearchEvents, MeilisearchPayloads } from './event-definitions/MeilisearchEvents';
export { MeilisearchEvents, MeilisearchPayloads };

import { CodeExecutionEvents, CodeExecutionPayloads } from './event-definitions/CodeExecutionEvents';
export { CodeExecutionEvents, CodeExecutionPayloads };

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
    CodeExecutionPayloads;

/**
 * Event name type - any valid event name
 */
export type EventName = keyof EventMap;
