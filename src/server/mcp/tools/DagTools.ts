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
 * DAG Tools for MXF
 *
 * MCP tools for agents to interact with the Task DAG system.
 * Provides tools for querying task dependencies, execution order, and blocking tasks.
 */

import { Logger } from '@mxf-dev/core/utils/Logger';
import { MongoDagRepository } from '@mxf-dev/core/database/adapters/mongodb/MongoDagRepository';
import { isDagEnabled, getDagConfig } from '@mxf-dev/core/config/dag.config';
import { DagErrorCode } from '@mxf-dev/core/types/DagTypes';
import { TaskService } from '../../socket/services/TaskService';
import { McpToolHandlerContext } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import { requireExactToolTenantContext } from './helpers/toolTenantContext';

const logger = new Logger('info', 'DagTools', 'server');

export type DagToolResult = Record<string, unknown>;

export interface DagToolArgs extends Record<string, unknown> {
    channelId?: string;
    limit?: number;
    dependentTaskId?: string;
    dependencyTaskId?: string;
    includeCompleted?: boolean;
    includeBlocked?: boolean;
    taskId?: string;
}

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/**
 * Validate that a task ID is a non-empty string.
 * Returns an error response object if invalid, or null if valid.
 *
 * @param fieldName - The name of the field being validated (for error messages)
 * @param value - The value to validate
 * @returns Error response object if invalid, null if valid
 */
function validateTaskId(fieldName: string, value: unknown): { success: false; message: string } | null {
    if (typeof value !== 'string' || value.trim() === '') {
        return {
            success: false,
            message: `${fieldName} must be a non-empty string`,
        };
    }
    return null;
}

/**
 * Helper to get DAG repository
 */
function getDagRepository(): MongoDagRepository {
    return MongoDagRepository.getInstance();
}

/**
 * Enrich task IDs with title and status from TaskService.
 * Returns objects with { id, title, status } for each task ID.
 */
async function enrichTaskIds(taskIds: string[], channelId: string): Promise<Array<{ id: string; title: string; status: string }>> {
    const taskService = TaskService.getInstance();
    const allTasks = await taskService.getTasks({ channelId });
    const taskMap = new Map(allTasks.map(t => [t.id, t]));
    const missingTaskIds = taskIds.filter((id) => !taskMap.has(id));

    if (missingTaskIds.length > 0) {
        throw new Error('DAG references one or more tasks outside the authenticated channel');
    }

    return taskIds.map((id) => {
        const task = taskMap.get(id)!;
        return { id: task.id, title: task.title, status: task.status };
    });
}

/**
 * Get tasks with satisfied dependencies (ready to execute)
 */
export const dag_get_ready_tasks = {
    name: 'dag_get_ready_tasks',
    description: 'Get tasks that have all dependencies satisfied and are ready to execute. Returns task IDs in order of availability.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID to query (auto-populated from context if not provided)',
            },
            limit: {
                type: 'number',
                minimum: 1,
                maximum: 100,
                default: 10,
                description: 'Maximum number of ready tasks to return',
            },
        },
        required: [],
    },
    handler: async (
        args: DagToolArgs,
        context: McpToolHandlerContext
    ): Promise<DagToolResult> => {
        try {
            const { channelId } = requireExactToolTenantContext(context, args.channelId);

            if (!isDagEnabled()) {
                return {
                    success: false,
                    readyTasks: [],
                    message: 'DAG system is disabled. Enable with TASK_DAG_ENABLED=true',
                };
            }

            const dagRepo = getDagRepository();
            const config = getDagConfig();
            // Use configured default, clamp to configured max
            const requestedLimit = args.limit || config.defaultReadyTasksLimit;
            const effectiveLimit = Math.min(requestedLimit, config.maxReadyTasksLimit);
            const readyTaskIds = await dagRepo.getReadyTasks(channelId, {
                limit: effectiveLimit,
            });
            const readyTasks = await enrichTaskIds(readyTaskIds, channelId);

            return {
                success: true,
                readyTasks,
                count: readyTasks.length,
                message: readyTasks.length > 0
                    ? `Found ${readyTasks.length} tasks ready to execute`
                    : 'No tasks are currently ready',
            };
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to get ready tasks', { error: errorMessage });
            return {
                success: false,
                readyTasks: [],
                message: 'Failed to get ready tasks',
                error: errorMessage,
                errorCode: 'INTERNAL_ERROR',
            };
        }
    },
};

/**
 * Check if adding a dependency would create a cycle
 */
export const dag_validate_dependency = {
    name: 'dag_validate_dependency',
    description: 'Check if adding a dependency between two tasks would create a cycle. Use this before adding dependencies to prevent invalid DAG states.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            dependentTaskId: {
                type: 'string',
                description: 'ID of the task that will depend on another',
            },
            dependencyTaskId: {
                type: 'string',
                description: 'ID of the task that must complete first',
            },
        },
        required: ['dependentTaskId', 'dependencyTaskId'],
    },
    handler: async (
        args: DagToolArgs,
        context: McpToolHandlerContext
    ): Promise<DagToolResult> => {
        try {
            const { channelId } = requireExactToolTenantContext(context, args.channelId);

            if (!isDagEnabled()) {
                return {
                    success: false,
                    isValid: false,
                    message: 'DAG system is disabled. Dependencies not validated.',
                };
            }

            // Validate required task ID fields
            const dependentError = validateTaskId('dependentTaskId', args.dependentTaskId);
            if (dependentError) {
                return { ...dependentError, isValid: false };
            }

            const dependencyError = validateTaskId('dependencyTaskId', args.dependencyTaskId);
            if (dependencyError) {
                return { ...dependencyError, isValid: false };
            }
            const dependentTaskId = args.dependentTaskId as string;
            const dependencyTaskId = args.dependencyTaskId as string;

            const taskService = TaskService.getInstance();
            const [dependentTask, dependencyTask] = await Promise.all([
                taskService.getTaskInChannel(dependentTaskId, channelId),
                taskService.getTaskInChannel(dependencyTaskId, channelId)
            ]);
            if (!dependentTask || !dependencyTask) {
                return {
                    success: false,
                    isValid: false,
                    message: 'Both tasks must exist in the authenticated channel'
                };
            }

            const dagRepo = getDagRepository();
            const result = await dagRepo.validateDependency(
                channelId,
                dependentTaskId,
                dependencyTaskId
            );

            if (result.success) {
                return {
                    success: true,
                    isValid: true,
                    message: 'Dependency is valid and does not create a cycle',
                };
            } else {
                return {
                    success: true,
                    isValid: false,
                    message: result.error || 'Dependency would create a cycle',
                    errorCode: result.errorCode,
                    cyclePath: result.cyclePath,
                };
            }
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to validate dependency', { error: errorMessage });
            return {
                success: false,
                isValid: false,
                message: 'Failed to validate dependency',
                error: errorMessage,
                errorCode: DagErrorCode.CYCLE_DETECTED,
            };
        }
    },
};

/**
 * Get execution order (topologically sorted tasks)
 */
export const dag_get_execution_order = {
    name: 'dag_get_execution_order',
    description: 'Get tasks in topologically sorted execution order. Tasks are ordered so that all dependencies come before their dependents.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            includeCompleted: {
                type: 'boolean',
                default: false,
                description: 'Whether to include completed tasks in the order',
            },
            includeBlocked: {
                type: 'boolean',
                default: true,
                description: 'Whether to include blocked tasks in the order',
            },
        },
        required: [],
    },
    handler: async (
        args: DagToolArgs,
        context: McpToolHandlerContext
    ): Promise<DagToolResult> => {
        try {
            const { channelId } = requireExactToolTenantContext(context, args.channelId);

            if (!isDagEnabled()) {
                return {
                    success: false,
                    executionOrder: [],
                    message: 'DAG system is disabled',
                };
            }

            const dagRepo = getDagRepository();
            const executionOrderIds = await dagRepo.getExecutionOrder(channelId, {
                includeCompleted: args.includeCompleted || false,
                includeBlocked: args.includeBlocked !== false,
            });
            const executionOrder = await enrichTaskIds(executionOrderIds, channelId);

            return {
                success: true,
                executionOrder,
                count: executionOrder.length,
                message: `Execution order contains ${executionOrder.length} tasks`,
            };
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to get execution order', { error: errorMessage });
            return {
                success: false,
                executionOrder: [],
                message: 'Failed to get execution order',
                error: errorMessage,
                errorCode: 'INTERNAL_ERROR',
            };
        }
    },
};

/**
 * Get tasks blocking a specific task
 */
export const dag_get_blocking_tasks = {
    name: 'dag_get_blocking_tasks',
    description: 'Get the list of tasks that are blocking a specific task. These are incomplete dependencies that must be completed first.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            taskId: {
                type: 'string',
                description: 'ID of the task to check blockers for',
            },
        },
        required: ['taskId'],
    },
    handler: async (
        args: DagToolArgs,
        context: McpToolHandlerContext
    ): Promise<DagToolResult> => {
        try {
            const { channelId } = requireExactToolTenantContext(context, args.channelId);

            if (!isDagEnabled()) {
                return {
                    success: false,
                    blockingTasks: [],
                    message: 'DAG system is disabled',
                };
            }

            // Validate required task ID field
            const taskIdError = validateTaskId('taskId', args.taskId);
            if (taskIdError) {
                return { ...taskIdError, blockingTasks: [] };
            }
            const taskId = args.taskId as string;

            const task = await TaskService.getInstance().getTaskInChannel(taskId, channelId);
            if (!task) {
                return {
                    success: false,
                    blockingTasks: [],
                    message: 'Task was not found in the authenticated channel',
                };
            }

            const dagRepo = getDagRepository();
            const blockingTaskIds = await dagRepo.getBlockingTasks(channelId, taskId);
            const blockingTasks = await enrichTaskIds(blockingTaskIds, channelId);

            const isReady = blockingTasks.length === 0;

            return {
                success: true,
                taskId,
                blockingTasks,
                isReady,
                message: isReady
                    ? 'Task has no blockers and is ready to execute'
                    : `Task is blocked by ${blockingTasks.length} incomplete dependencies`,
            };
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to get blocking tasks', { error: errorMessage });
            return {
                success: false,
                blockingTasks: [],
                message: 'Failed to get blocking tasks',
                error: errorMessage,
                errorCode: 'INTERNAL_ERROR',
            };
        }
    },
};

/**
 * Get parallel task groups
 */
export const dag_get_parallel_groups = {
    name: 'dag_get_parallel_groups',
    description: 'Get groups of tasks that can be executed in parallel. Tasks in the same group have no dependencies on each other.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
        },
        required: [],
    },
    handler: async (
        args: DagToolArgs,
        context: McpToolHandlerContext
    ): Promise<DagToolResult> => {
        try {
            const { channelId } = requireExactToolTenantContext(context, args.channelId);

            if (!isDagEnabled()) {
                return {
                    success: false,
                    parallelGroups: [],
                    message: 'DAG system is disabled',
                };
            }

            const dagRepo = getDagRepository();
            const parallelGroupIds = await dagRepo.getParallelGroups(channelId);
            // Enrich each group of task IDs with task metadata
            const parallelGroups = await Promise.all(
                parallelGroupIds.map(group => enrichTaskIds(group, channelId))
            );

            return {
                success: true,
                parallelGroups,
                groupCount: parallelGroups.length,
                totalTasks: parallelGroups.reduce((sum, group) => sum + group.length, 0),
                message: `Found ${parallelGroups.length} parallel execution levels`,
            };
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to get parallel groups', { error: errorMessage });
            return {
                success: false,
                parallelGroups: [],
                message: 'Failed to get parallel groups',
                error: errorMessage,
                errorCode: 'INTERNAL_ERROR',
            };
        }
    },
};

/**
 * Get critical path
 */
export const dag_get_critical_path = {
    name: 'dag_get_critical_path',
    description: 'Get the critical path (longest dependency chain) in the DAG. This represents the minimum time to complete all tasks if executed optimally.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
        },
        required: [],
    },
    handler: async (
        args: DagToolArgs,
        context: McpToolHandlerContext
    ): Promise<DagToolResult> => {
        try {
            const { channelId } = requireExactToolTenantContext(context, args.channelId);

            if (!isDagEnabled()) {
                return {
                    success: false,
                    criticalPath: [],
                    message: 'DAG system is disabled',
                };
            }

            const dagRepo = getDagRepository();
            const criticalPathIds = await dagRepo.getCriticalPath(channelId);
            const criticalPath = await enrichTaskIds(criticalPathIds, channelId);

            return {
                success: true,
                criticalPath,
                pathLength: criticalPath.length,
                message: criticalPath.length > 0
                    ? `Critical path has ${criticalPath.length} tasks`
                    : 'No tasks in DAG or all tasks are isolated',
            };
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to get critical path', { error: errorMessage });
            return {
                success: false,
                criticalPath: [],
                message: 'Failed to get critical path',
                error: errorMessage,
                errorCode: 'INTERNAL_ERROR',
            };
        }
    },
};

/**
 * Get DAG statistics
 */
export const dag_get_stats = {
    name: 'dag_get_stats',
    description: 'Get statistics about the task DAG including node count, edge count, and task state distribution.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
        },
        required: [],
    },
    handler: async (
        args: DagToolArgs,
        context: McpToolHandlerContext
    ): Promise<DagToolResult> => {
        try {
            const { channelId } = requireExactToolTenantContext(context, args.channelId);

            if (!isDagEnabled()) {
                return {
                    success: false,
                    stats: null,
                    message: 'DAG system is disabled',
                };
            }

            const dagRepo = getDagRepository();
            const stats = await dagRepo.getStats(channelId);

            if (!stats) {
                return {
                    success: true,
                    stats: null,
                    message: 'No DAG exists for this channel',
                };
            }

            return {
                success: true,
                stats,
                summary: {
                    nodes: stats.nodeCount,
                    edges: stats.edgeCount,
                    ready: stats.readyTaskCount,
                    blocked: stats.blockedTaskCount,
                    completed: stats.completedTaskCount,
                    depth: stats.maxDepth,
                },
                message: `DAG has ${stats.nodeCount} tasks with ${stats.edgeCount} dependencies`,
            };
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            logger.error('Failed to get DAG stats', { error: errorMessage });
            return {
                success: false,
                stats: null,
                message: 'Failed to get DAG stats',
                error: errorMessage,
                errorCode: 'INTERNAL_ERROR',
            };
        }
    },
};

/**
 * Export all DAG tools
 */
export const dagTools = [
    dag_get_ready_tasks,
    dag_validate_dependency,
    dag_get_execution_order,
    dag_get_blocking_tasks,
    dag_get_parallel_groups,
    dag_get_critical_path,
    dag_get_stats,
];
