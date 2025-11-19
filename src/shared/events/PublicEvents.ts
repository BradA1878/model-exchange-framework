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
 * Public Events
 * 
 * Defines which events are safe for external developer consumption.
 * Internal/sensitive events are NOT exposed through agent.on() API.
 */

import { Events } from './EventNames';

/**
 * Public Agent Events - Safe for developers to listen to
 */
export const PUBLIC_AGENT_EVENTS = [
    Events.Agent.CONNECTED,
    Events.Agent.DISCONNECTED,
    Events.Agent.REGISTERED,
    Events.Agent.REGISTRATION_FAILED,
    Events.Agent.STATUS_CHANGE,
    Events.Agent.ERROR,
    Events.Agent.JOIN_CHANNEL,
    Events.Agent.LEAVE_CHANNEL,
    Events.Agent.LLM_RESPONSE,
    Events.Agent.LLM_REASONING,
    Events.Agent.LLM_REASONING_PARSED,
    Events.Agent.LLM_REASONING_TOOLS_SYNTHESIZED,
] as const;

/**
 * Public Message Events - Core messaging functionality
 */
export const PUBLIC_MESSAGE_EVENTS = [
    Events.Message.CHANNEL_MESSAGE,
    Events.Message.AGENT_MESSAGE,
    Events.Message.CHANNEL_MESSAGE_DELIVERED,
    Events.Message.AGENT_MESSAGE_DELIVERED,
    Events.Message.MESSAGE_SEND_FAILED,
    Events.Message.MESSAGE_ERROR,
] as const;

/**
 * Public Task Events - Task lifecycle
 */
export const PUBLIC_TASK_EVENTS = [
    Events.Task.ASSIGNED,
    Events.Task.COMPLETED,
    Events.Task.FAILED,
    Events.Task.PROGRESS_UPDATED,
    Events.Task.CREATED,
    Events.Task.REQUEST,
    Events.Task.RESPONSE,
] as const;

/**
 * Public MCP/Tool Events - Tool execution feedback and server management
 */
export const PUBLIC_MCP_EVENTS = [
    Events.Mcp.TOOL_CALL,
    Events.Mcp.TOOL_RESULT,
    Events.Mcp.TOOL_ERROR,
    Events.Mcp.TOOL_REGISTERED,
    Events.Mcp.TOOL_LIST_RESULT,
    Events.Mcp.EXTERNAL_SERVER_REGISTERED,
    Events.Mcp.EXTERNAL_SERVER_UNREGISTERED,
    Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED,
    Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED,
] as const;

/**
 * Public Memory Events - Memory operation results
 */
export const PUBLIC_MEMORY_EVENTS = [
    Events.Memory.GET_RESULT,
    Events.Memory.UPDATE_RESULT,
    Events.Memory.CREATE_RESULT,
    Events.Memory.DELETE_RESULT,
    Events.Memory.SYNC_COMPLETE,
    Events.Memory.GET_ERROR,
    Events.Memory.UPDATE_ERROR,
    Events.Memory.CREATE_ERROR,
] as const;

/**
 * Public Control Loop Events - Observable reasoning phases
 */
export const PUBLIC_CONTROL_LOOP_EVENTS = [
    Events.ControlLoop.OBSERVATION,
    Events.ControlLoop.REASONING,
    Events.ControlLoop.PLAN,
    Events.ControlLoop.ACTION,
    Events.ControlLoop.REFLECTION,
    Events.ControlLoop.EXECUTION,
    Events.ControlLoop.ERROR,
] as const;

/**
 * Public Channel Events - Channel lifecycle
 */
export const PUBLIC_CHANNEL_EVENTS = [
    Events.Channel.AGENT_JOINED,
    Events.Channel.AGENT_LEFT,
    Events.Channel.CONTEXT.UPDATED,
    Events.Channel.CREATED,
    Events.Channel.UPDATED,
] as const;

/**
 * Public Meilisearch Events - Semantic search operations
 */
export const PUBLIC_MEILISEARCH_EVENTS = [
    'meilisearch:index',
    'meilisearch:backfill:complete',
    'meilisearch:backfill:partial',
    'meilisearch:search',
] as const;

/**
 * Combined array of all public events
 */
export const PUBLIC_EVENTS = [
    ...PUBLIC_AGENT_EVENTS,
    ...PUBLIC_MESSAGE_EVENTS,
    ...PUBLIC_TASK_EVENTS,
    ...PUBLIC_MCP_EVENTS,
    ...PUBLIC_MEMORY_EVENTS,
    ...PUBLIC_CONTROL_LOOP_EVENTS,
    ...PUBLIC_CHANNEL_EVENTS,
    ...PUBLIC_MEILISEARCH_EVENTS,
] as const;

/**
 * Type representing all public event names
 */
export type PublicEventName = typeof PUBLIC_EVENTS[number];

/**
 * Check if an event is safe for public consumption
 * 
 * @param eventName - Event name to check
 * @returns True if event is in the public whitelist
 */
export const isPublicEvent = (eventName: string): eventName is PublicEventName => {
    return (PUBLIC_EVENTS as readonly string[]).includes(eventName);
};

/**
 * Get human-readable category for a public event
 * 
 * @param eventName - Public event name
 * @returns Event category or 'unknown'
 */
export const getEventCategory = (eventName: PublicEventName): string => {
    if (PUBLIC_AGENT_EVENTS.includes(eventName as any)) return 'agent';
    if (PUBLIC_MESSAGE_EVENTS.includes(eventName as any)) return 'message';
    if (PUBLIC_TASK_EVENTS.includes(eventName as any)) return 'task';
    if (PUBLIC_MCP_EVENTS.includes(eventName as any)) return 'mcp';
    if (PUBLIC_MEMORY_EVENTS.includes(eventName as any)) return 'memory';
    if (PUBLIC_CONTROL_LOOP_EVENTS.includes(eventName as any)) return 'controlLoop';
    if (PUBLIC_CHANNEL_EVENTS.includes(eventName as any)) return 'channel';
    if (PUBLIC_MEILISEARCH_EVENTS.includes(eventName as any)) return 'meilisearch';
    return 'unknown';
};

/**
 * INTERNAL/SENSITIVE EVENTS (NOT EXPOSED)
 * 
 * These events are for framework internal use only:
 * - Events.System.* - System internals
 * - Events.Heartbeat.* - Connection health monitoring
 * - Events.LlmService.* - Internal SystemLLM operations
 * - Events.Analytics.* - Internal metrics collection
 * - Events.Config.* - Internal configuration changes
 * - Events.Bulk.* - Internal bulk operations
 * - Events.Auth.* - Authentication flow (security sensitive)
 * - Events.Core.* - Low-level Socket.IO events
 * - Events.Mxp.ENCRYPTION_* - Security/encryption internals
 * 
 * Attempting to listen to these through agent.on() will throw an error.
 */
