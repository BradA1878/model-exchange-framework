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

import { AgentMessageEvent } from './MessageEvents';
import {
    AgentEventData,
    AgentEventPayload,
    AgentRegistrationEventData as AgentRegistrationEventBase,
    AgentConnectionEventData as AgentConnectionEventBase,
    AgentJoinEventData as AgentJoinEventBase,
    AgentLeaveEventData as AgentLeaveEventBase
} from '../../schemas/EventPayloadSchema';

/**
 * Type definition for agent registration events imported from EventPayloadSchema
 * @deprecated BACKWARD-COMPATIBILITY: Import from src/shared/schemas/EventPayloadSchema.ts instead
 * This type alias is maintained for backward compatibility and will be removed in a future release
 */
export type AgentRegistrationEvent = AgentRegistrationEventBase;

/**
 * Type definition for agent connection events imported from EventPayloadSchema
 * @deprecated BACKWARD-COMPATIBILITY: Import from src/shared/schemas/EventPayloadSchema.ts instead
 * This type alias is maintained for backward compatibility and will be removed in a future release
 */
export type AgentConnectionEvent = AgentConnectionEventBase;

/**
 * Type definition for agent join events imported from EventPayloadSchema
 * @deprecated BACKWARD-COMPATIBILITY: Import from src/shared/schemas/EventPayloadSchema.ts instead
 * This type alias is maintained for backward compatibility and will be removed in a future release
 */
export type AgentJoinEvent = AgentJoinEventBase;

/**
 * Type definition for agent leave events imported from EventPayloadSchema
 * @deprecated BACKWARD-COMPATIBILITY: Import from src/shared/schemas/EventPayloadSchema.ts instead
 * This type alias is maintained for backward compatibility and will be removed in a future release
 */
export type AgentLeaveEvent = AgentLeaveEventBase;

/**
 * Events related to agent status and connectivity
 */
export const AgentEvents = {
    // Registration events
    REGISTER: 'agent:register', // Agent registration request
    REGISTERED: 'agent:registered', // Agent has been registered
    REGISTRATION_FAILED: 'agent:registration:failed', // Agent registration failed
    
    // Connection events
    CONNECT: 'agent:connect', // Agent connect event
    CONNECTED: 'agent:connected', // Agent has connected
    DISCONNECT: 'agent:disconnect', // Agent disconnect event
    DISCONNECTED: 'agent:disconnected', // Agent has disconnected
    CONNECTION_ERROR: 'agent:connection:error', // Agent connection error
    CONNECTION_STATUS: 'agent:connection:status', // Agent connection status update
    STATUS_CHANGE: 'agent:status:change', // Agent status change
    
    // Error events
    ERROR: 'agent:error', // Agent error
    
    // Agent message events
    AGENT_MESSAGE: 'agent:message', // Alias for MESSAGE - backward compatibility
    
    // Tool execution events
    TOOL_CALL: 'agent:tool_call', // Agent tool call execution
    TOOL_RESULT: 'agent:tool_result', // Agent tool execution result
    
    // Context management events  
    CONTEXT_UPDATE: 'agent:context_update', // Agent context update
    
    // LLM response events
    LLM_RESPONSE: 'agent:llm_response', // Agent LLM response for monitoring
    LLM_REASONING: 'agent:llm_reasoning', // Agent LLM reasoning tokens for transparency
    LLM_REASONING_PARSED: 'agent:llm_reasoning:parsed', // Reasoning text parsed for tool intentions
    LLM_REASONING_TOOLS_SYNTHESIZED: 'agent:llm_reasoning:tools_synthesized', // Tool calls synthesized from reasoning
    
    // Task management events
    TASK_ASSIGNED: 'agent:task_assigned', // Agent has been assigned a task

    // Channel operations (agent perspective)
    JOIN_CHANNEL: 'agent:join_channel', // Agent requests to join a channel
    JOINED_CHANNEL: 'agent:joined_channel', // Agent successfully joined a channel
    JOIN_CHANNEL_FAILED: 'agent:join_channel:failed', // Agent failed to join a channel
    LEAVE_CHANNEL: 'agent:leave_channel', // Agent requests to leave a channel
    LEFT_CHANNEL: 'agent:left_channel', // Agent successfully left a channel
    LEAVE_CHANNEL_FAILED: 'agent:leave_channel:failed', // Agent failed to leave a channel
    
    // Discovery operations
    DISCOVERY_REQUEST: 'agent:discovery:request', // Agent requests to discover other agents
    DISCOVERY_RESPONSE: 'agent:discovery:response', // Response with discovered agents
    
    // Lifecycle management events
    RESTART_REQUEST: 'agent:restart:request', // Request to restart an agent
    RESTART_RESPONSE: 'agent:restart:response', // Response from agent restart
    SHUTDOWN_REQUEST: 'agent:shutdown:request', // Request to shutdown an agent
    SHUTDOWN_RESPONSE: 'agent:shutdown:response', // Response from agent shutdown
    PAUSE_REQUEST: 'agent:pause:request', // Request to pause an agent
    PAUSE_RESPONSE: 'agent:pause:response', // Response from agent pause
    RESUME_REQUEST: 'agent:resume:request', // Request to resume an agent
    RESUME_RESPONSE: 'agent:resume:response', // Response from agent resume
    METRICS_REQUEST: 'agent:metrics:request', // Request for agent metrics
    METRICS_RESPONSE: 'agent:metrics:response', // Response with agent metrics

    // Tool configuration events
    ALLOWED_TOOLS_UPDATE: 'agent:allowed_tools:update', // Request to update agent's allowed tools
    ALLOWED_TOOLS_UPDATED: 'agent:allowed_tools:updated', // Confirmation of allowed tools update
};

/**
 * Payload types for Agent events
 */
export interface AgentPayloads {
    'agent:register': { agentId: string, capabilities?: string[] };
    'agent:registered': AgentRegistrationEvent;
    'agent:registration:failed': { agentId: string, error: string };
    'agent:connect': AgentConnectionEvent;
    'agent:connected': { agentId: string, socketId: string };
    'agent:disconnect': { agentId: string, reason?: string };
    'agent:disconnected': { agentId: string };
    'agent:connection:error': { agentId: string, error: string };
    'agent:connection:status': { agentId: string, status: string };
    'agent:status:change': { agentId: string, status: string };
    'agent:error': { agentId: string, error: string };
    'agent:message': AgentMessageEvent;
    'agent:llm_response': { agentId: string, response: string, timestamp: number };
    'agent:llm_reasoning:parsed': { agentId: string, toolIntentions: any[], parseMethod: string, timestamp: number };
    'agent:llm_reasoning:tools_synthesized': { agentId: string, toolCalls: any[], timestamp: number };
    
    // Channel operations (agent perspective)
    'agent:join_channel': { channelId: string, agentId: string };
    'agent:joined_channel': { channelId: string, agentId: string };
    'agent:join_channel:failed': { channelId: string, agentId: string, error: string };
    'agent:leave_channel': { channelId: string, agentId: string };
    'agent:left_channel': { channelId: string, agentId: string };
    'agent:leave_channel:failed': { channelId: string, agentId: string, error: string };
    
    // Discovery operations
    'agent:discovery:request': { agentId: string };
    'agent:discovery:response': { agents: AgentEventData[] };
    
    // Lifecycle management events
    'agent:restart:request': { agentId: string, reason?: string, timestamp: Date };
    'agent:restart:response': { agentId: string, success: boolean, error?: string };
    'agent:shutdown:request': { agentId: string, reason?: string, timestamp: Date };
    'agent:shutdown:response': { agentId: string, success: boolean, error?: string };
    'agent:pause:request': { agentId: string, reason?: string, timestamp: Date };
    'agent:pause:response': { agentId: string, success: boolean, error?: string };
    'agent:resume:request': { agentId: string, reason?: string, timestamp: Date };
    'agent:resume:response': { agentId: string, success: boolean, error?: string };
    'agent:metrics:request': { agentId: string, timestamp: Date };
    'agent:metrics:response': { agentId: string, metrics: any, timestamp: Date };

    // Tool configuration events
    'agent:allowed_tools:update': { agentId: string; allowedTools: string[] };
    'agent:allowed_tools:updated': { agentId: string; allowedTools: string[]; success: boolean };
}
