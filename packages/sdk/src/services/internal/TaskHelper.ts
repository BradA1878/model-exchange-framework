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
 * Internal Task Helper
 * 
 * INTERNAL USE ONLY - NOT EXPORTED FROM SDK
 * 
 * Provides abstraction over EventBus for task operations.
 * Prevents developers from directly accessing EventBus.
 */

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import { createTaskEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { v4 as uuidv4 } from 'uuid';

/**
 * Task configuration interface
 */
export interface TaskConfig {
    title: string;
    description: string;
    assignedAgentIds: string[];
    assignmentScope?: 'single' | 'multiple';
    assignmentStrategy?: 'auto' | 'manual';
    leadAgentId?: string;
    completionAgentId?: string;
    coordinationMode?: 'collaborative' | 'competitive' | 'sequential';
    priority?: 'low' | 'medium' | 'high';
    requiredCapabilities?: string[];
    tags?: string[];
    metadata?: Record<string, any>;
}

/**
 * Internal helper for task operations
 * Abstracts EventBus calls to prevent direct developer access
 */
export const TaskHelper = {
    /**
     * Create a new task in a channel
     * 
     * @param channelId - Channel ID where task will be created
     * @param config - Task configuration
     * @param creatorAgentId - Agent ID creating the task
     * @returns Promise resolving to the created task ID
     */
    createTask: async (
        channelId: string,
        config: TaskConfig,
        creatorAgentId: string
    ): Promise<string> => {
        // Generate unique task ID
        const taskId = `task-${Date.now()}-${uuidv4().substring(0, 8)}`;
        
        // Create task payload using existing schema function
        const payload = createTaskEventPayload(
            TaskEvents.CREATE_REQUEST,
            creatorAgentId,
            channelId,
            {
                taskId,
                task: {
                    channelId,
                    title: config.title,
                    description: config.description,
                    assignedAgentIds: config.assignedAgentIds,
                    assignmentScope: config.assignmentScope || 'multiple',
                    assignmentStrategy: config.assignmentStrategy || 'manual',
                    leadAgentId: config.leadAgentId,
                    completionAgentId: config.completionAgentId,
                    coordinationMode: config.coordinationMode || 'collaborative',
                    priority: config.priority || 'medium',
                    requiredCapabilities: config.requiredCapabilities || [],
                    tags: config.tags || [],
                    metadata: {
                        ...config.metadata,
                        createdBy: creatorAgentId,
                        createdAt: Date.now()
                    }
                }
            }
        );
        
        EventBus.client.emitOn(creatorAgentId, TaskEvents.CREATE_REQUEST, payload);

        return taskId;
    },

    /**
     * Complete a task.
     *
     * The complete/fail/cancel lifecycle events all put their fields at the `data` level,
     * which is exactly where the server's handlers read them from, and pass `task` as a
     * short human-readable summary string.
     *
     * They previously passed `task` as an object with no `title` / `description` /
     * `assignmentStrategy`. createTaskEventPayload() validates that shape and fails fast,
     * so `mxfService.completeTask()` and `mxfService.cancelTask()` threw
     * "Task title is required" on every single call and no task could ever be completed
     * or cancelled through the SDK. The validator accepts a plain string for `task`, and
     * the server's `payload.data.task?.data || payload.data` fallback lands on `data`
     * either way.
     *
     * @param taskId - Task ID to complete
     * @param agentId - Agent ID completing the task
     * @param channelId - Channel ID where task exists
     * @param result - Task completion result
     */
    completeTask: async (
        taskId: string,
        agentId: string,
        channelId: string,
        result: Record<string, any>
    ): Promise<void> => {
        const payload = createTaskEventPayload(
            TaskEvents.COMPLETE_REQUEST,
            agentId,
            channelId,
            {
                taskId,
                completingAgentId: agentId,
                result,
                completedAt: Date.now(),
                task: `Task ${taskId} completed by ${agentId}`
            }
        );

        EventBus.client.emitOn(agentId, TaskEvents.COMPLETE_REQUEST, payload);
    },

    /**
     * Fail a task.
     *
     * Emits TaskEvents.FAIL_REQUEST, which the server turns into a real `failed` task
     * status and a TaskEvents.FAILED broadcast. Call this whenever local task execution
     * throws — otherwise the server keeps the task in `in_progress` forever and
     * agent.onTaskFailed() never fires.
     *
     * @param taskId - Task ID that failed
     * @param agentId - Agent ID that failed the task
     * @param channelId - Channel ID where task exists
     * @param error - Why the task failed
     */
    failTask: async (
        taskId: string,
        agentId: string,
        channelId: string,
        error: string
    ): Promise<void> => {
        const payload = createTaskEventPayload(
            TaskEvents.FAIL_REQUEST,
            agentId,
            channelId,
            {
                taskId,
                failingAgentId: agentId,
                error,
                failedAt: Date.now(),
                task: `Task ${taskId} failed: ${error}`
            }
        );

        EventBus.client.emitOn(agentId, TaskEvents.FAIL_REQUEST, payload);
    },

    /**
     * Cancel a task.
     *
     * @param taskId - Task ID to cancel
     * @param agentId - Agent ID cancelling the task
     * @param channelId - Channel ID where task exists
     * @param reason - Cancellation reason
     */
    cancelTask: async (
        taskId: string,
        agentId: string,
        channelId: string,
        reason?: string
    ): Promise<void> => {
        const payload = createTaskEventPayload(
            TaskEvents.CANCEL_REQUEST,
            agentId,
            channelId,
            {
                taskId,
                cancellingAgentId: agentId,
                reason,
                cancelledAt: Date.now(),
                task: `Task ${taskId} cancelled by ${agentId}${reason ? `: ${reason}` : ''}`
            }
        );

        EventBus.client.emitOn(agentId, TaskEvents.CANCEL_REQUEST, payload);
    }
};
