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
 * Internal Task Helper
 * 
 * INTERNAL USE ONLY - NOT EXPORTED FROM SDK
 * 
 * Provides abstraction over EventBus for task operations.
 * Prevents developers from directly accessing EventBus.
 */

import { EventBus } from '../../../shared/events/EventBus';
import { TaskEvents } from '../../../shared/events/event-definitions/TaskEvents';
import { createTaskEventPayload } from '../../../shared/schemas/EventPayloadSchema';
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
        
        EventBus.client.emit(TaskEvents.CREATE_REQUEST, payload);
        
        return taskId;
    },

    /**
     * Complete a task
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
        // Create completion payload with proper structure
        const payload = createTaskEventPayload(
            TaskEvents.COMPLETE_REQUEST,
            agentId,
            channelId,
            {
                taskId,
                task: {
                    result,
                    completedBy: agentId,
                    completedAt: Date.now()
                }
            }
        );
        
        // Emit completion event through EventBus (hidden from developer)
        EventBus.client.emit(TaskEvents.COMPLETE_REQUEST, payload);
    },

    /**
     * Cancel a task
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
        // Create cancellation payload with proper structure
        const payload = createTaskEventPayload(
            TaskEvents.CANCEL_REQUEST,
            agentId,
            channelId,
            {
                taskId,
                task: {
                    reason,
                    cancelledBy: agentId,
                    cancelledAt: Date.now()
                }
            }
        );
        
        // Emit cancellation event through EventBus (hidden from developer)
        EventBus.client.emit(TaskEvents.CANCEL_REQUEST, payload);
    }
};
