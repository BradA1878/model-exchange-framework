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

import { Logger } from '../../../utils/Logger';
import { TaskService } from '../../../../server/socket/services/TaskService';
import { 
    ChannelTask, 
    TaskPriority, 
    TaskStatus, 
    AssignmentStrategy,
    CreateTaskRequest,
    UpdateTaskRequest,
    TaskQueryFilters
} from '../../../types/TaskTypes';

const logger = new Logger('info', 'TaskBridgeTools', 'server');

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
    handler: async (args: any, context: any) => {
        try {
            const taskService = getTaskService();
            
            // Auto-populate channelId from context if not provided
            const channelId = args.channelId || context.channelId;
            
            if (!channelId) {
                throw new Error('channelId is required but not provided and not available in context');
            }
            
            const createRequest: CreateTaskRequest = {
                title: args.title,
                description: args.description,
                channelId: channelId,
                priority: args.priority || 'medium',
                assignedAgentId: args.assignTo,
                assignmentStrategy: args.assignTo ? 'manual' : 'none',
                assignmentScope: 'single',
                dependsOn: args.dependsOn,
            };
            
            const task = await taskService.createTask(createRequest, context.agentId);
            
            
            return {
                success: true,
                task,
                taskId: task.id,
                message: `Task "${args.title}" created successfully with ID: ${task.id}`
            };
            
        } catch (error: any) {
            logger.error('Failed to create task via task_create tool', {
                error: error.message,
                agentId: context.agentId,
                title: args.title
            });
            
            return {
                success: false,
                message: 'Failed to create task',
                error: error.message
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
    handler: async (args: any, context: any) => {
        try {
            const taskService = getTaskService();
            
            const filters: TaskQueryFilters = {
                channelId: args.channelId,
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
            
        } catch (error: any) {
            logger.error('Failed to query tasks via task_query tool', {
                error: error.message,
                agentId: context.agentId
            });
            
            return {
                success: false,
                tasks: [],
                count: 0,
                message: 'Failed to query tasks',
                error: error.message
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
            status: {
                type: 'string',
                enum: ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled'],
                description: 'New task status'
            },
            progress: {
                type: 'number',
                minimum: 0,
                maximum: 100,
                description: 'Task progress percentage (0-100)'
            }
        },
        required: ['taskId']
    },
    handler: async (args: any, context: any) => {
        try {
            const taskService = getTaskService();
            
            const { taskId, ...updateData } = args;
            
            const task = await taskService.updateTask(taskId, updateData);
            
            
            return {
                success: true,
                task,
                message: `Task ${taskId} updated successfully`
            };
            
        } catch (error: any) {
            logger.error('Failed to update task via task_update tool', {
                error: error.message,
                agentId: context.agentId,
                taskId: args.taskId
            });
            
            return {
                success: false,
                message: 'Failed to update task',
                error: error.message
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
            summary: {
                type: 'string',
                description: 'Summary of the work completed and results achieved'
            },
            success: {
                type: 'boolean',
                description: 'Whether the task was completed successfully',
                default: true
            }
        },
        required: ['summary']
    },
    handler: async (args: any, context: any) => {
        try {
            const taskService = getTaskService();
            
            // Use the task service's completion handler
            const result = await taskService.handleTaskCompletion(
                context.agentId,
                context.channelId,
                {
                    summary: args.summary,
                    success: args.success,
                    requestId: `bridge-${Date.now()}`
                }
            );
            
            
            return result;
            
        } catch (error: any) {
            logger.error('Failed to complete task via task_complete_bridge tool', {
                error: error.message,
                agentId: context.agentId
            });
            
            return {
                status: 'error',
                message: 'Failed to complete task',
                error: error.message
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
    handler: async (args: any, context: any) => {
        try {
            const taskService = getTaskService();
            
            const tasks = await taskService.getTasks({});
            const task = tasks.find(t => t.id === args.taskId);
            
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
            
        } catch (error: any) {
            logger.error('Failed to get task status via task_status tool', {
                error: error.message,
                agentId: context.agentId,
                taskId: args.taskId
            });
            
            return {
                success: false,
                message: 'Failed to get task status',
                error: error.message
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