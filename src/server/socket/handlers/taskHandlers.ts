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
 * Task Management Socket Handlers
 *
 * This module provides EventBus handlers for task management operations.
 * Task events are forwarded from socket to EventBus by eventForwardingHandlers,
 * then processed here and responses sent back through EventBus.
 *
 * Trust boundary: `payload.agentId` and `payload.channelId` are written by
 * eventForwardingHandlers from socket.data, which the channel key established at
 * connect time — they are the caller's real identity, not a client claim. The
 * `taskId` inside `payload.data` is the opposite: it comes straight off the wire.
 *
 * Generic field updates go through TaskService.updateTaskInChannel, while
 * assignment and lifecycle changes use dedicated compare-and-set operations.
 * Every write remains scoped to the authenticated channel and actor authority.
 */

import { Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import { CoreSocketEvents } from '@mxf-dev/core/events/EventNames';
import { createTaskEventPayload, TaskEventPayload, TaskEventData } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { TaskService } from '../services/TaskService';
import { 
    CreateTaskRequest, 
    UpdateTaskRequest
} from '@mxf-dev/core/types/TaskTypes';

// Global flag to ensure task handlers are only registered once
let globalTaskHandlersRegistered = false;
let globalTaskHandlerSubscriptions: Subscription[] = [];
const activeConnections = new Set<string>(); // Track active agent connections

// Create module logger
const moduleLogger = new Logger('debug', 'TaskHandlers', 'server');

/**
 * Register global task event handlers for EventBus (singleton)
 * These handlers should only be registered once globally, not per connection
 */
export const initializeTaskHandlers = (): void => {

    if (globalTaskHandlersRegistered) {
        return;
    }
    
    const validator = createStrictValidator('GlobalTaskHandlers');
    const taskService = TaskService.getInstance();

    const emitTaskRequestError = (payload: TaskEventPayload, error: unknown): void => {
        const agentId = payload?.agentId;
        const channelId = payload?.channelId;
        const outerData = payload?.data;
        const nestedData = outerData?.task?.data?.task?.data
            ?? outerData?.task?.data
            ?? outerData;
        const taskId = nestedData?.taskId ?? outerData?.taskId;
        const requestId = nestedData?.requestId ?? outerData?.requestId ?? outerData?.taskId;

        if (typeof agentId !== 'string' || agentId.trim().length === 0 ||
            typeof channelId !== 'string' || channelId.trim().length === 0 ||
            typeof taskId !== 'string' || taskId.trim().length === 0) {
            moduleLogger.error('Cannot address task error because trusted task identity is incomplete');
            return;
        }

        EventBus.server.emit(
            TaskEvents.ERROR,
            createTaskEventPayload(TaskEvents.ERROR, agentId, channelId, {
                taskId,
                ...(typeof requestId === 'string' && requestId.trim().length > 0
                    ? { requestId }
                    : {}),
                fromAgentId: 'system',
                toAgentId: agentId,
                task: `Task request ${taskId} failed`,
                error: error instanceof Error ? error.message : String(error)
            })
        );
    };

    // Handler for task creation - GLOBAL SINGLETON
    const handleTaskCreate = async (payload: TaskEventPayload): Promise<void> => {
        try {
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Extract task creation data from socket payload (after eventForwardingHandlers wrapping)
            validator.assertIsObject(payload.data, 'payload.data is required');
            validator.assertIsObject(payload.data.task, 'payload.data.task is required');
            const requestId = payload.data.taskId;
            validator.assertIsNonEmptyString(requestId, 'request taskId');
            
            // The actual task data is nested inside payload.data.task.data due to eventForwardingHandlers wrapper
            const taskData = payload.data.task.data || payload.data.task;
            validator.assertIsObject(taskData, 'task data is required');
            validator.assertIsNonEmptyString(taskData.title, 'task title');
            validator.assertIsNonEmptyString(taskData.description, 'task description');

            const createRequest: CreateTaskRequest = {
                title: taskData.title,
                description: taskData.description,
                channelId,
                priority: taskData.priority || 'medium',
                requiredRoles: taskData.requiredRoles || [],
                requiredCapabilities: taskData.requiredCapabilities || [],
                assignmentStrategy: taskData.assignmentStrategy || 'intelligent',
                assignedAgentId: taskData.assignedAgentId,
                dueDate: taskData.dueDate,
                estimatedDuration: taskData.estimatedDuration,
                metadata: taskData.metadata || {},
                tags: taskData.tags || [],
                dependsOn: taskData.dependsOn || [],
                // Multi-agent assignment fields
                assignmentScope: taskData.assignmentScope || 'single',
                assignedAgentIds: taskData.assignedAgentIds || [],
                assignmentDistribution: taskData.assignmentDistribution,
                coordinationMode: taskData.coordinationMode,
                leadAgentId: taskData.leadAgentId,
                completionAgentId: taskData.completionAgentId,
                // Channel-wide task fields - CRITICAL for validation
                channelWideTask: taskData.channelWideTask,
                maxParticipants: taskData.maxParticipants,
                targetAgentRoles: taskData.targetAgentRoles || [],
                excludeAgentIds: taskData.excludeAgentIds || []
            };
            // The socket forwarder rebuilt payload.agentId from the validated
            // channel key. A nested createdBy is untrusted model state and is
            // deliberately absent from the fresh createRequest above.
            const createdBy = agentId;
            
            await taskService.createTask(createRequest, createdBy, requestId);
            
            // Note: TaskService.createTask() already emits TaskEvents.CREATED, so no need to emit here
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task creation: ${error}`);
            emitTaskRequestError(payload, error);
        }
    };

    // Handler for task updates  
    const handleTaskUpdate = async (payload: TaskEventPayload): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            const taskData = payload.data.task?.data
                ?? (typeof payload.data.task === 'object' && payload.data.task !== null
                    ? payload.data.task
                    : payload.data);
            const taskId = payload.data.taskId ?? taskData.taskId;
            const requestId = payload.data.requestId ?? taskData.requestId;
            const updateRequest: UpdateTaskRequest & Record<string, unknown> = { ...taskData };
            delete updateRequest.taskId;
            delete updateRequest.requestId;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');

            // Scoped to the caller's channel — see the trust note at the top of this file
            const updatedTask = await taskService.updateTaskInChannel(taskId, channelId, updateRequest);

            // Use PROGRESS_UPDATED since UPDATED doesn't exist
            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                requestId,
                fromAgentId: agentId,
                toAgentId: updatedTask.assignedAgentId || agentId,
                task: updatedTask
            };
            const eventPayload = createTaskEventPayload(TaskEvents.PROGRESS_UPDATED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.PROGRESS_UPDATED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task update: ${error}`);
            emitTaskRequestError(payload, error);
        }
    };

    // Handler for task assignment
    const handleTaskAssign = async (payload: TaskEventPayload): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            const taskData = payload.data.task?.data
                ?? (typeof payload.data.task === 'object' && payload.data.task !== null
                    ? payload.data.task
                    : payload.data);
            const taskId = payload.data.taskId ?? taskData.taskId;
            const targetAgentId = payload.data.targetAgentId ?? taskData.targetAgentId;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(targetAgentId, 'targetAgentId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');

            await taskService.assignTaskInChannel(
                taskId,
                channelId,
                targetAgentId,
                agentId
            );
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task assignment: ${error}`);
            emitTaskRequestError(payload, error);
        }
    };

    // Handler for intelligent task assignment
    const handleTaskAssignIntelligent = async (payload: TaskEventPayload): Promise<void> => {
        try {
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle both direct and nested payload structures
            const taskData = payload.data.task?.data || payload.data;
            const { taskId } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');

            // Scoped to the caller's channel. Assignment runs an LLM pass, so an
            // unscoped taskId here was also a way to make another channel spend budget.
            await taskService.assignTaskIntelligentlyInChannel(taskId, channelId);

            // TaskService persists the assignment and emits the authoritative
            // ASSIGNED event. Emitting ASSIGNMENT_REQUESTED here used to invoke
            // this same ingress handler recursively, then report a false error
            // because the task was no longer pending.
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling intelligent task assignment: ${error}`);
            emitTaskRequestError(payload, error);
        }
    };

    // Handler for task lifecycle events
    const handleTaskStart = async (payload: TaskEventPayload): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle both direct and nested payload structures
            const taskData = payload.data.task?.data || payload.data;
            const { taskId, requestId } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');

            // Only the assignee starts a task, and only in their own channel
            const updatedTask = await taskService.transitionTaskInChannel(
                taskId,
                channelId,
                agentId,
                { kind: 'start' }
            );

            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                requestId,
                fromAgentId: agentId,
                toAgentId: agentId,
                task: updatedTask
            };
            const eventPayload = createTaskEventPayload(TaskEvents.STARTED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.STARTED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task start: ${error}`);
            emitTaskRequestError(payload, error);
        }
    };

    const handleTaskComplete = async (payload: TaskEventPayload): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle multiple levels of nesting from EventBus forwarding
            const taskData = payload.data.task?.data?.task?.data || payload.data.task?.data || payload.data;
            const { taskId, requestId, result } = taskData;
            
            // Resolve 'current' taskId to actual task ID
            let resolvedTaskId = taskId;
            if (taskId === 'current') {
                // Find the most recent assigned task for this agent that's not yet completed
                const activeTasks = await taskService.getTasks({ channelId });
                const agentTask = activeTasks.find(task => {
                    const canComplete = task.completionAgentId
                        ? task.completionAgentId === agentId
                        : task.assignedAgentIds?.includes(agentId) || task.assignedAgentId === agentId;
                    return canComplete &&
                        task.status !== 'completed' &&
                        task.status !== 'failed' &&
                        task.status !== 'cancelled';
                });
                
                if (agentTask) {
                    resolvedTaskId = agentTask.id;
                } else {
                    throw new Error(
                        `No active task can be completed by agent ${agentId} in channel ${channelId}`
                    );
                }
            }
            
            validator.assertIsNonEmptyString(resolvedTaskId, 'resolvedTaskId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');
            validator.assertIsObject(result, 'task completion result is required');

            // Completion is restricted twice over: the task must be in the caller's
            // channel, and the caller must be the agent it is assigned to.
            // `completingAgentId` from the payload is not used for the check —
            // `agentId` is the identity the socket authenticated as.
            const updatedTask = await taskService.transitionTaskInChannel(
                resolvedTaskId,
                channelId,
                agentId,
                { kind: 'complete', output: result }
            );

            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                requestId,
                fromAgentId: agentId,
                toAgentId: agentId,
                task: updatedTask
            };
            const eventPayload = createTaskEventPayload(TaskEvents.COMPLETED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.COMPLETED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task complete: ${error}`);
            emitTaskRequestError(payload, error);
        }
    };

    const handleTaskFail = async (payload: TaskEventPayload): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle multiple levels of nesting from EventBus forwarding
            const taskData = payload.data.task?.data?.task?.data || payload.data.task?.data || payload.data;
            const { taskId, requestId, error: taskError } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');
            validator.assertIsNonEmptyString(taskError, 'task failure error is required');

            // Only the assignee can fail a task, and only in their own channel
            const updatedTask = await taskService.transitionTaskInChannel(
                taskId,
                channelId,
                agentId,
                { kind: 'fail', error: taskError }
            );

            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                requestId,
                fromAgentId: agentId,
                toAgentId: agentId,
                task: updatedTask
            };
            const eventPayload = createTaskEventPayload(TaskEvents.FAILED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.FAILED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task fail: ${error}`);
            emitTaskRequestError(payload, error);
        }
    };

    const handleTaskCancel = async (payload: TaskEventPayload): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle both direct and nested payload structures
            const taskData = payload.data.task?.data || payload.data;
            const { taskId, requestId, reason } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');

            const updatedTask = await taskService.transitionTaskInChannel(
                taskId,
                channelId,
                agentId,
                { kind: 'cancel', reason }
            );

            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                requestId,
                fromAgentId: agentId,
                toAgentId: agentId,
                task: updatedTask
            };
            const eventPayload = createTaskEventPayload(TaskEvents.CANCELLED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.CANCELLED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task cancel: ${error}`);
            emitTaskRequestError(payload, error);
        }
    };

    // Handler for workload analysis
    const handleAnalyzeWorkload = async (payload: TaskEventPayload): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            //;
            // Handle flexible payload structures - targetChannelId can be in different locations
            const targetChannelId = payload.data.targetChannelId || 
                                    payload.data.task?.targetChannelId || 
                                    payload.data.task?.data?.targetChannelId ||
                                    payload.data.task?.data?.task?.targetChannelId;
            
            validator.assertIsNonEmptyString(targetChannelId, 'targetChannelId is required');
            
            const taskEventData: TaskEventData = {
                taskId: `workload-analysis-${targetChannelId}`,
                fromAgentId: agentId,
                toAgentId: agentId,
                task: {}
            };
            const eventPayload = createTaskEventPayload(TaskEvents.WORKLOAD_ANALYZED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.WORKLOAD_ANALYZED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ CRITICAL ERROR in workload analysis handler: ${error}`);
            moduleLogger.error(`❌ Error stack:`, error);
            emitTaskRequestError(payload, error);
        }
    };

    try {
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.CREATE_REQUEST, handleTaskCreate)
        );
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.UPDATE_REQUEST, handleTaskUpdate)
        );
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.ASSIGN_REQUEST, handleTaskAssign)
        );
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.ASSIGNMENT_REQUESTED, handleTaskAssignIntelligent)
        );
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.START_REQUEST, handleTaskStart)
        );
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.COMPLETE_REQUEST, handleTaskComplete)
        );
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.FAIL_REQUEST, handleTaskFail)
        );
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.CANCEL_REQUEST, handleTaskCancel)
        );
        globalTaskHandlerSubscriptions.push(
            EventBus.server.on(TaskEvents.WORKLOAD_ANALYZE_REQUEST, handleAnalyzeWorkload)
        );
        globalTaskHandlersRegistered = true;
    } catch (error) {
        shutdownTaskHandlers();
        throw error;
    }
};

/** Release process-global task handlers so cold restart installs one fresh set. */
export const shutdownTaskHandlers = (): void => {
    for (const subscription of globalTaskHandlerSubscriptions) {
        subscription.unsubscribe();
    }
    globalTaskHandlerSubscriptions = [];
    activeConnections.clear();
    globalTaskHandlersRegistered = false;
};

/**
 * Register task handlers for a specific socket connection
 * This now only handles connection tracking and cleanup, not EventBus registration
 * 
 * @param socket Socket connection (used for cleanup on disconnect)
 * @param agentId Agent ID associated with the socket
 * @param channelId Channel ID for the connection context
 */
export const registerTaskHandlers = (socket: Socket, agentId: string, channelId: string): void => {
    
    // Ensure global handlers are registered (singleton)
    initializeTaskHandlers();
    
    // Track this connection
    const connectionKey = `${agentId}:${channelId}`;
    activeConnections.add(connectionKey);
    
    // Handle socket disconnection - clean up connection tracking
    socket.on(CoreSocketEvents.DISCONNECT, () => {
        activeConnections.delete(connectionKey);
        
        // Note: We do NOT remove global EventBus handlers here since other agents may still be connected
        // Global handlers remain active for the lifetime of the server
    });
    
};
