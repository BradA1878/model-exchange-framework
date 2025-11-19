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
 * Task Management Socket Handlers
 * 
 * This module provides EventBus handlers for task management operations.
 * Task events are forwarded from socket to EventBus by eventForwardingHandlers,
 * then processed here and responses sent back through EventBus.
 */

import { Socket } from 'socket.io';
import { EventBus } from '../../../shared/events/EventBus';
import { TaskEvents } from '../../../shared/events/event-definitions/TaskEvents';
import { createTaskEventPayload, TaskEventPayload, TaskEventData, createBaseEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { TaskService } from '../services/TaskService';
import { 
    CreateTaskRequest, 
    UpdateTaskRequest,
    TaskQueryFilters 
} from '../../../shared/types/TaskTypes';

// Global flag to ensure task handlers are only registered once
let globalTaskHandlersRegistered = false;
const activeConnections = new Set<string>(); // Track active agent connections

// Create module logger
const moduleLogger = new Logger('debug', 'TaskHandlers', 'server');

/**
 * Register global task event handlers for EventBus (singleton)
 * These handlers should only be registered once globally, not per connection
 */
const registerGlobalTaskHandlers = (): void => {

    if (globalTaskHandlersRegistered) {
        return;
    }
    
    const validator = createStrictValidator('GlobalTaskHandlers');
    const taskService = TaskService.getInstance();

    // Handler for task creation - GLOBAL SINGLETON
    const handleTaskCreate = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Extract task creation data from socket payload (after eventForwardingHandlers wrapping)
            validator.assertIsObject(payload.data, 'payload.data is required');
            validator.assertIsObject(payload.data.task, 'payload.data.task is required');
            
            // The actual task data is nested inside payload.data.task.data due to eventForwardingHandlers wrapper
            const taskData = payload.data.task.data || payload.data.task;
            validator.assertIsObject(taskData, 'task data is required');
            validator.assertIsNonEmptyString(taskData.title, 'task title');
            validator.assertIsNonEmptyString(taskData.description, 'task description');

            const createRequest: any = {
                title: taskData.title,
                description: taskData.description,
                channelId,
                priority: taskData.priority || 'medium',
                requiredRoles: taskData.requiredRoles || [],
                requiredCapabilities: taskData.requiredCapabilities || [],
                assignmentStrategy: taskData.assignmentStrategy || 'auto',
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
                // Channel-wide task fields - CRITICAL for validation
                channelWideTask: taskData.channelWideTask,
                maxParticipants: taskData.maxParticipants,
                targetAgentRoles: taskData.targetAgentRoles || [],
                excludeAgentIds: taskData.excludeAgentIds || []
            };
            const createdBy = taskData.createdBy || 'socket_user';
            
            const task = await taskService.createTask(createRequest, createdBy);
            
            // Note: TaskService.createTask() already emits TaskEvents.CREATED, so no need to emit here
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task creation: ${error}`);
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    // Handler for task updates  
    const handleTaskUpdate = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle both direct and nested payload structures
            const taskData = payload.data.task?.data || payload.data;
            const { taskId, ...updateRequest } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            
            const updatedTask = await taskService.updateTask(taskId, updateRequest);
            
            // Use PROGRESS_UPDATED since UPDATED doesn't exist
            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                fromAgentId: agentId,
                toAgentId: updatedTask.assignedAgentId || agentId,
                task: updatedTask
            };
            const eventPayload = createTaskEventPayload(TaskEvents.PROGRESS_UPDATED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.PROGRESS_UPDATED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task update: ${error}`);
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    // Handler for task assignment
    const handleTaskAssign = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle both direct and nested payload structures
            const taskData = payload.data.task?.data || payload.data;
            const { taskId, targetAgentId } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(targetAgentId, 'targetAgentId is required');
            
            const updatedTask = await taskService.updateTask(taskId, {
                assignedAgentId: targetAgentId,
                status: 'assigned'
            });
            
            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                fromAgentId: agentId,
                toAgentId: targetAgentId,
                task: updatedTask
            };
            const eventPayload = createTaskEventPayload(TaskEvents.ASSIGNED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.ASSIGNED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task assignment: ${error}`);
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    // Handler for intelligent task assignment
    const handleTaskAssignIntelligent = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle both direct and nested payload structures
            const taskData = payload.data.task?.data || payload.data;
            const { taskId } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            
            const assignmentResult = await taskService.assignTaskIntelligently(taskId);
            
            const taskEventData: TaskEventData = {
                taskId: taskId,
                fromAgentId: agentId,
                toAgentId: assignmentResult.assignedAgentId,
                task: assignmentResult
            };
            const eventPayload = createTaskEventPayload(TaskEvents.ASSIGNMENT_REQUESTED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.ASSIGNMENT_REQUESTED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling intelligent task assignment: ${error}`);
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    // Handler for task lifecycle events
    const handleTaskStart = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle both direct and nested payload structures
            const taskData = payload.data.task?.data || payload.data;
            const { taskId, startingAgentId } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(startingAgentId, 'startingAgentId is required');
            
            const updatedTask = await taskService.updateTask(taskId, {
                status: 'in_progress'
            });
            
            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                fromAgentId: agentId,
                toAgentId: startingAgentId,
                task: updatedTask
            };
            const eventPayload = createTaskEventPayload(TaskEvents.STARTED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.STARTED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task start: ${error}`);
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    const handleTaskComplete = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle multiple levels of nesting from EventBus forwarding
            const taskData = payload.data.task?.data?.task?.data || payload.data.task?.data || payload.data;
            const { taskId, completingAgentId, result } = taskData;
            
            // Resolve 'current' taskId to actual task ID
            let resolvedTaskId = taskId;
            if (taskId === 'current') {
                // Find the most recent assigned task for this agent that's not yet completed
                const activeTasks = await taskService.getTasks({ channelId });
                const agentTask = activeTasks.find(task => 
                    (task.assignedAgentIds?.includes(agentId) || task.assignedAgentId === agentId) && 
                    task.status !== 'completed' && 
                    task.status !== 'failed' && 
                    task.status !== 'cancelled'
                );
                
                if (agentTask) {
                    resolvedTaskId = agentTask.id;
                } else {
                    moduleLogger.warn(`⚠️ Could not find active task for agent ${agentId}, using 'current' as-is`);
                }
            }
            
            validator.assertIsNonEmptyString(resolvedTaskId, 'resolvedTaskId is required');
            validator.assertIsNonEmptyString(completingAgentId || agentId, 'completingAgentId is required');
            
            const updatedTask = await taskService.updateTask(resolvedTaskId, {
                status: 'completed',
                progress: 100
            });
            
            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                fromAgentId: agentId,
                toAgentId: completingAgentId || agentId,
                task: {
                    ...updatedTask,
                    result: result
                }
            };
            const eventPayload = createTaskEventPayload(TaskEvents.COMPLETED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.COMPLETED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task complete: ${error}`);
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    const handleTaskFail = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle multiple levels of nesting from EventBus forwarding
            const taskData = payload.data.task?.data?.task?.data || payload.data.task?.data || payload.data;
            const { taskId, failingAgentId, error: taskError } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            validator.assertIsNonEmptyString(failingAgentId, 'failingAgentId is required');
            
            const updatedTask = await taskService.updateTask(taskId, {
                status: 'failed'
            });
            
            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                fromAgentId: agentId,
                toAgentId: failingAgentId,
                task: {
                    ...updatedTask,
                    error: taskError
                }
            };
            const eventPayload = createTaskEventPayload(TaskEvents.FAILED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.FAILED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task fail: ${error}`);
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    const handleTaskCancel = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
            
            
            // Handle both direct and nested payload structures
            const taskData = payload.data.task?.data || payload.data;
            const { taskId, reason } = taskData;
            validator.assertIsNonEmptyString(taskId, 'taskId is required');
            
            const updatedTask = await taskService.updateTask(taskId, {
                status: 'cancelled'
            });
            
            const taskEventData: TaskEventData = {
                taskId: updatedTask.id,
                fromAgentId: agentId,
                toAgentId: updatedTask.assignedAgentId || agentId,
                task: {
                    ...updatedTask,
                    reason: reason
                }
            };
            const eventPayload = createTaskEventPayload(TaskEvents.CANCELLED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.CANCELLED, eventPayload);
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task cancel: ${error}`);
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    // Handler for workload analysis
    const handleAnalyzeWorkload = async (payload: any): Promise<void> => {
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
            // Use helper to create task error event payload
            const errorPayload = createBaseEventPayload(
                TaskEvents.ERROR,
                payload.agentId || 'unknown',
                payload.channelId || 'unknown',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                { source: 'TaskHandler' }
            );
            EventBus.server.emit(TaskEvents.ERROR, errorPayload);
        }
    };

    // Handler for task assigned notifications
    const handleTaskAssigned = async (payload: any): Promise<void> => {
        try {
            // Extract the originating agent info from payload
            const agentId = payload.agentId || 'unknown';
            const channelId = payload.channelId || 'unknown';
                        
            // Server handler processes all assignments for forwarding to agents
            const taskData = payload.data;
            const targetAgentId = taskData?.toAgentId;
            
            if (targetAgentId) {
                
                // Forward the assignment notification to the client
                // The client should receive this and start working on the task
                // This goes through eventForwardingHandlers to reach the agent
            } else {
            }
            
        } catch (error) {
            moduleLogger.error(`❌ Error handling task assigned notification: ${error}`);
        }
    };

    // Register GLOBAL EventBus listeners (once only)
    EventBus.server.on(TaskEvents.CREATE_REQUEST, handleTaskCreate);
    EventBus.server.on(TaskEvents.UPDATE_REQUEST, handleTaskUpdate);
    EventBus.server.on(TaskEvents.ASSIGN_REQUEST, handleTaskAssign);
    EventBus.server.on(TaskEvents.ASSIGNMENT_REQUESTED, handleTaskAssignIntelligent);
    EventBus.server.on(TaskEvents.START_REQUEST, handleTaskStart);
    EventBus.server.on(TaskEvents.COMPLETE_REQUEST, handleTaskComplete);
    EventBus.server.on(TaskEvents.FAIL_REQUEST, handleTaskFail);
    EventBus.server.on(TaskEvents.CANCEL_REQUEST, handleTaskCancel);
    EventBus.server.on(TaskEvents.WORKLOAD_ANALYZE_REQUEST, handleAnalyzeWorkload);
    EventBus.server.on(TaskEvents.ASSIGNED, handleTaskAssigned);
    
    
    globalTaskHandlersRegistered = true;
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
    registerGlobalTaskHandlers();
    
    // Track this connection
    const connectionKey = `${agentId}:${channelId}`;
    activeConnections.add(connectionKey);
    
    // Handle socket disconnection - clean up connection tracking
    socket.on('disconnect', () => {
        activeConnections.delete(connectionKey);
        
        // Note: We do NOT remove global EventBus handlers here since other agents may still be connected
        // Global handlers remain active for the lifetime of the server
    });
    
};
