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

import { Logger } from '@mxf-dev/core/utils/Logger';
import { TaskService } from '../../socket/services/TaskService';
import { normalizeSummaryInput } from './helpers/toolInputNormalization';
import { requireExactToolTenantContext } from './helpers/toolTenantContext';
import { McpToolHandlerContext } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import {
    CreateTaskRequest,
    TaskQueryFilters
} from '@mxf-dev/core/types/TaskTypes';

const logger = new Logger('info', 'TaskBridgeTools', 'server');

export type TaskToolResult = Record<string, unknown>;

export interface CreateTaskToolArgs extends Record<string, unknown> {
    title: string;
    description: string;
    assignTo?: string;
    channelId?: string;
    priority?: CreateTaskRequest['priority'];
    dependsOn?: unknown;
}

export interface QueryTasksToolArgs extends Record<string, unknown> {
    channelId?: string;
    status?: TaskQueryFilters['status'];
    assignedAgentId?: string;
}

export interface UpdateTaskToolArgs extends Record<string, unknown> {
    taskId: string;
    channelId?: string;
    progress: number;
}

export interface CompleteTaskToolArgs extends Record<string, unknown> {
    summary: unknown;
    success?: boolean;
}

export interface TaskStatusToolArgs extends Record<string, unknown> {
    taskId: string;
    channelId?: string;
}

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const normalizeToolSummary = (summary: unknown): string | undefined => {
    if (typeof summary === 'string') {
        return normalizeSummaryInput(summary);
    }
    if (summary !== null && typeof summary === 'object' && !Array.isArray(summary)) {
        return normalizeSummaryInput(summary as Record<string, unknown>);
    }
    throw new Error('summary must be a string or object');
};

/**
 * Task Bridge Tools for MXF
 * 
 * Bridges the existing TaskService to make it accessible to LLM agents
 * Provides task creation, assignment, querying, and completion functionality
 */

// Helper function to get TaskService instance
function getTaskService(): TaskService {
    return TaskService.getInstance();
}

export const createTaskTool = {
    name: 'task_create',
    description: 'Create a new task in the MXF task management system. Optionally assign it to a specific agent.',
    inputSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'Task title/name'
            },
            description: {
                type: 'string',
                description: 'Detailed task description with all necessary context for the assigned agent'
            },
            assignTo: {
                type: 'string',
                description: 'Agent ID to assign this task to (e.g., "content-agent", "distribution-agent"). Optional - omit when creating tasks for dependency tracking without delegation.'
            },
            channelId: {
                type: 'string',
                description: 'Channel ID where the task should be created (auto-populated from context if not provided)'
            },
            priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'urgent'],
                default: 'medium',
                description: 'Task priority level'
            },
            dependsOn: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of task IDs this task depends on. Used by the DAG system to track task dependencies and execution order.'
            }
        },
        required: ['title', 'description']
    },
    handler: async (
        args: CreateTaskToolArgs,
        context: McpToolHandlerContext
    ): Promise<TaskToolResult> => {
        try {
            const taskService = getTaskService();

            const { agentId, channelId } = requireExactToolTenantContext(context, args.channelId);
            let dependsOn: string[] | undefined;
            if (args.dependsOn !== undefined) {
                if (!Array.isArray(args.dependsOn)) {
                    throw new Error('dependsOn must be an array of task IDs');
                }
                dependsOn = args.dependsOn.map((taskId: unknown) => {
                    if (typeof taskId !== 'string' || taskId.trim() === '') {
                        throw new Error('dependsOn must contain only non-empty task IDs');
                    }
                    return taskId;
                });
                const dependencies = await Promise.all(
                    dependsOn.map((taskId) => taskService.getTaskInChannel(taskId, channelId))
                );
                if (dependencies.some((task) => task === null)) {
                    throw new Error('One or more dependency tasks were not found in the authenticated channel');
                }
            }
            
            const createRequest: CreateTaskRequest = {
                title: args.title,
                description: args.description,
                channelId: channelId,
                priority: args.priority || 'medium',
                assignedAgentId: args.assignTo,
                assignmentStrategy: args.assignTo ? 'manual' : 'none',
                assignmentScope: 'single',
                dependsOn,
            };
            
            const task = await taskService.createTask(createRequest, agentId);
            
            
            return {
                success: true,
                task,
                taskId: task.id,
                message: `Task "${args.title}" created successfully with ID: ${task.id}`
            };
            
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to create task via task_create tool', {
                error: errorMessage,
                agentId: context.agentId,
                title: args.title
            });
            
            return {
                success: false,
                message: 'Failed to create task',
                error: errorMessage
            };
        }
    }
};

export const queryTasksTool = {
    name: 'task_query',
    description: 'Query and retrieve tasks from the task management system',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Filter by channel ID'
            },
            status: {
                type: 'string',
                enum: ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled'],
                description: 'Filter by task status'
            },
            assignedAgentId: {
                type: 'string',
                description: 'Filter by assigned agent ID'
            }
        }
    },
    handler: async (
        args: QueryTasksToolArgs,
        context: McpToolHandlerContext
    ): Promise<TaskToolResult> => {
        try {
            const taskService = getTaskService();
            const { channelId } = requireExactToolTenantContext(context, args.channelId);

            const filters: TaskQueryFilters = {
                channelId,
                status: args.status,
                assignedAgentId: args.assignedAgentId
            };
            
            const tasks = await taskService.getTasks(filters);
            
            
            return {
                success: true,
                tasks,
                count: tasks.length,
                message: `Found ${tasks.length} tasks matching the criteria`
            };
            
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to query tasks via task_query tool', {
                error: errorMessage,
                agentId: context.agentId
            });
            
            return {
                success: false,
                tasks: [],
                count: 0,
                message: 'Failed to query tasks',
                error: errorMessage
            };
        }
    }
};

export const updateTaskTool = {
    name: 'task_update',
    description: 'Update an existing task in the task management system',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'ID of the task to update'
            },
            progress: {
                type: 'number',
                minimum: 0,
                maximum: 100,
                description: 'Task progress percentage (0-100)'
            }
        },
        required: ['taskId', 'progress']
    },
    handler: async (
        args: UpdateTaskToolArgs,
        context: McpToolHandlerContext
    ): Promise<TaskToolResult> => {
        try {
            const taskService = getTaskService();
            const { channelId } = requireExactToolTenantContext(context, args.channelId);
            const updateData = { progress: args.progress };

            const task = await taskService.updateTaskInChannel(args.taskId, channelId, updateData);
            
            
            return {
                success: true,
                task,
                message: `Task ${args.taskId} updated successfully`
            };
            
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to update task via task_update tool', {
                error: errorMessage,
                agentId: context.agentId,
                taskId: args.taskId
            });
            
            return {
                success: false,
                message: 'Failed to update task',
                error: errorMessage
            };
        }
    }
};

export const completeTaskBridgeTool = {
    name: 'task_complete_bridge',
    description: 'Complete a task through the task management system (alternative to task_complete)',
    inputSchema: {
        type: 'object',
        properties: {
            // Objects are admitted (and stored as their JSON string) for the
            // same reason as task_complete: models summarize structured work
            // as structured data. Other non-string types are still rejected.
            summary: {
                type: ['string', 'object'],
                description: 'Summary of the work completed and results achieved. Prose is preferred; an object is stored as its JSON string.'
            },
            success: {
                type: 'boolean',
                description: 'Whether the task was completed successfully',
                default: true
            }
        },
        required: ['summary']
    },
    handler: async (
        args: CompleteTaskToolArgs,
        context: McpToolHandlerContext
    ): Promise<TaskToolResult> => {
        try {
            const taskService = getTaskService();
            const { agentId, channelId } = requireExactToolTenantContext(context);
            const summary = normalizeToolSummary(args.summary);
            if (summary === undefined) {
                throw new Error('Task completion summary is required');
            }

            // Use the task service's completion handler. Objects are stored as
            // their JSON string; handleTaskCompletion requires a plain string.
            const result = await taskService.handleTaskCompletion(
                agentId,
                channelId,
                {
                    summary,
                    success: args.success,
                    requestId: `bridge-${Date.now()}`
                }
            );
            
            
            return result;
            
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to complete task via task_complete_bridge tool', {
                error: errorMessage,
                agentId: context.agentId
            });
            
            return {
                status: 'error',
                message: 'Failed to complete task',
                error: errorMessage
            };
        }
    }
};

export const getTaskStatusTool = {
    name: 'task_status',
    description: 'Get detailed status and information about a specific task',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'ID of the task to get status for'
            }
        },
        required: ['taskId']
    },
    handler: async (
        args: TaskStatusToolArgs,
        context: McpToolHandlerContext
    ): Promise<TaskToolResult> => {
        try {
            const taskService = getTaskService();
            const { channelId } = requireExactToolTenantContext(context, args.channelId);
            const task = await taskService.getTaskInChannel(args.taskId, channelId);
            
            if (!task) {
                return {
                    success: false,
                    message: `Task ${args.taskId} not found`
                };
            }
            
            
            return {
                success: true,
                task,
                message: `Task ${args.taskId} status: ${task.status}`
            };
            
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to get task status via task_status tool', {
                error: errorMessage,
                agentId: context.agentId,
                taskId: args.taskId
            });
            
            return {
                success: false,
                message: 'Failed to get task status',
                error: errorMessage
            };
        }
    }
};

// Export all task bridge tools
export const taskBridgeTools = [
    createTaskTool,
    queryTasksTool,
    updateTaskTool,
    completeTaskBridgeTool,
    getTaskStatusTool
];
