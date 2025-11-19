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
 * Task Management Events for MXF Framework
 * 
 * Comprehensive event definitions for task creation, assignment, orchestration
 * and SystemLLM-powered intelligent agent assignment
 */

import { ChannelTask, AgentAssignmentAnalysis, ChannelWorkloadAnalysis } from '../../types/TaskTypes';
import { AgentId } from '../../types/Agent';
import { ChannelId } from '../../types/ChannelContext';

/**
 * Interface for task request events (legacy - kept for backward compatibility)
 */
export interface TaskRequestEvent {
    taskId: string;
    fromAgentId: string;
    toAgentId: string;
    task: string;
    timestamp: number;
}

/**
 * Interface for task response events (legacy - kept for backward compatibility)
 */
export interface TaskResponseEvent {
    taskId: string;
    fromAgentId: string;
    toAgentId: string;
    response: string;
    timestamp: number;
}

/**
 * Standard task event payload structure
 */
export interface TaskEventPayload {
    eventId: string;
    eventType: string;
    timestamp: number;
    agentId?: AgentId;
    channelId: ChannelId;
    data: Record<string, any>;
}

/**
 * Task creation event payload
 */
export interface TaskCreatedEvent extends TaskEventPayload {
    data: {
        task: ChannelTask;
    };
}

/**
 * Task assignment event payload
 */
export interface TaskAssignedEvent extends TaskEventPayload {
    data: {
        task: ChannelTask;
        previousAgentId?: AgentId;
        assignmentAnalysis?: AgentAssignmentAnalysis;
    };
}

/**
 * Task progress update event payload
 */
export interface TaskProgressEvent extends TaskEventPayload {
    data: {
        task: ChannelTask;
        previousProgress: number;
        progressDelta: number;
    };
}

/**
 * Task completion event payload
 */
export interface TaskCompletedEvent extends TaskEventPayload {
    data: {
        task: ChannelTask;
        result: any;
        duration: number; // in minutes
    };
}

/**
 * Agent workload analysis event payload
 */
export interface AgentWorkloadEvent extends TaskEventPayload {
    data: {
        workloadAnalysis: ChannelWorkloadAnalysis;
        trigger: 'periodic' | 'task_created' | 'task_completed' | 'agent_joined';
    };
}

/**
 * Enhanced TaskEvents with comprehensive task management
 */
export const TaskEvents = {
    // Legacy events (backward compatibility)
    REQUEST: 'task:request',
    RESPONSE: 'task:response',
    
    // Task request events (from clients to server)
    CREATE_REQUEST: 'task:create_request',
    START_REQUEST: 'task:start_request', 
    COMPLETE_REQUEST: 'task:complete_request',
    FAIL_REQUEST: 'task:fail_request',
    CANCEL_REQUEST: 'task:cancel_request',
    ASSIGN_REQUEST: 'task:assign_request',
    UPDATE_REQUEST: 'task:update_request',
    WORKLOAD_ANALYZE_REQUEST: 'task:workload_analyze_request',
    
    // Core task lifecycle events (server responses/notifications)
    CREATED: 'task:created',
    ASSIGNED: 'task:assigned',
    STARTED: 'task:started',
    PROGRESS_UPDATED: 'task:progress_updated',
    COMPLETED: 'task:completed',
    FAILED: 'task:failed',
    ERROR: 'task:error', // Task execution error
    CANCELLED: 'task:cancelled',
    REASSIGNED: 'task:reassigned',
    
    // Task orchestration events
    ASSIGNMENT_REQUESTED: 'task:assignment_requested',
    ASSIGNMENT_ANALYZED: 'task:assignment_analyzed',
    WORKLOAD_ANALYZED: 'task:workload_analyzed',
    AGENT_OVERLOADED: 'task:agent_overloaded',
    
    // Coordination events
    DEPENDENCY_RESOLVED: 'task:dependency_resolved',
    BLOCKING_CLEARED: 'task:blocking_cleared',
    LATE_AGENT_JOINED: 'task:late_agent_joined',
    
    // System events
    ORCHESTRATION_CONFIG_UPDATED: 'task:orchestration_config_updated'
} as const;

/**
 * Enhanced payload types for all task events
 */
export interface TaskPayloads {
    // Legacy events
    'task:request': TaskRequestEvent;
    'task:response': TaskResponseEvent;
    
    // Task request events
    'task:create_request': TaskEventPayload & { data: { task: ChannelTask } };
    'task:start_request': TaskEventPayload & { data: { task: ChannelTask } };
    'task:complete_request': TaskEventPayload & { data: { task: ChannelTask; result: any } };
    'task:fail_request': TaskEventPayload & { data: { task: ChannelTask; error: string } };
    'task:cancel_request': TaskEventPayload & { data: { task: ChannelTask; reason?: string } };
    'task:assign_request': TaskEventPayload & { data: { task: ChannelTask; agentId: AgentId } };
    'task:update_request': TaskEventPayload & { data: { task: ChannelTask; updates: Record<string, any> } };
    'task:workload_analyze_request': TaskEventPayload & { data: { channelId: ChannelId } };
    
    // Core task lifecycle events
    'task:created': TaskCreatedEvent;
    'task:assigned': TaskAssignedEvent;
    'task:started': TaskEventPayload & { data: { task: ChannelTask } };
    'task:progress_updated': TaskProgressEvent;
    'task:completed': TaskCompletedEvent;
    'task:failed': TaskEventPayload & { data: { task: ChannelTask; error: string } };
    'task:cancelled': TaskEventPayload & { data: { task: ChannelTask; reason?: string } };
    'task:reassigned': TaskAssignedEvent;
    
    // Task orchestration events
    'task:assignment_requested': TaskEventPayload & { data: { task: ChannelTask } };
    'task:assignment_analyzed': TaskEventPayload & { data: { task: ChannelTask; analysis: AgentAssignmentAnalysis } };
    'task:workload_analyzed': AgentWorkloadEvent;
    'task:agent_overloaded': TaskEventPayload & { data: { agentId: AgentId; currentTasks: number; threshold: number } };
    
    // Coordination events
    'task:dependency_resolved': TaskEventPayload & { data: { task: ChannelTask; resolvedDependency: string } };
    'task:blocking_cleared': TaskEventPayload & { data: { task: ChannelTask; clearedBlocker: string } };
    'task:late_agent_joined': TaskEventPayload & { data: { task: ChannelTask; joinedAgentId: AgentId } };
    
    // System events
    'task:orchestration_config_updated': TaskEventPayload & { data: { config: Record<string, any> } };
}
