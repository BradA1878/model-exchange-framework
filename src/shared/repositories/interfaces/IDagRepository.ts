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
 * Repository Interface for Task DAG Operations
 *
 * Provides methods for building and querying DAGs from task data.
 * The DAG is derived from task dependencies (dependsOn/blockedBy fields).
 */

import { ChannelId } from '../../types/ChannelContext';
import { TaskStatus } from '../../types/TaskTypes';
import {
    TaskDag,
    TaskDagNode,
    TaskDagEdge,
    TopologicalResult,
    DagValidationResult,
    DagStats,
    AddDependencyResult,
} from '../../types/DagTypes';

/**
 * Repository interface for Task DAG operations
 */
export interface IDagRepository {
    /**
     * Build a DAG from existing tasks in a channel
     *
     * @param channelId - The channel to build DAG for
     * @returns The built DAG or null if channel has no tasks
     */
    buildDagFromTasks(channelId: ChannelId): Promise<TaskDag | null>;

    /**
     * Get the DAG for a channel (cached or build if needed)
     *
     * @param channelId - The channel ID
     * @returns The DAG or null if not found
     */
    getDag(channelId: ChannelId): Promise<TaskDag | null>;

    /**
     * Check if a task is ready to execute
     *
     * @param channelId - The channel ID
     * @param taskId - The task ID
     * @returns true if task is ready (all dependencies completed)
     */
    isTaskReady(channelId: ChannelId, taskId: string): Promise<boolean>;

    /**
     * Get tasks that are ready to execute
     *
     * @param channelId - The channel ID
     * @param options - Optional filters and limits
     * @returns Array of ready task IDs
     */
    getReadyTasks(
        channelId: ChannelId,
        options?: {
            limit?: number;
            excludeStatuses?: TaskStatus[];
        }
    ): Promise<string[]>;

    /**
     * Get tasks that are blocking a specific task
     *
     * @param channelId - The channel ID
     * @param taskId - The task ID
     * @returns Array of blocking task IDs
     */
    getBlockingTasks(channelId: ChannelId, taskId: string): Promise<string[]>;

    /**
     * Get the execution order for tasks (topologically sorted)
     *
     * @param channelId - The channel ID
     * @param options - Optional filters
     * @returns Topologically sorted task IDs
     */
    getExecutionOrder(
        channelId: ChannelId,
        options?: {
            includeCompleted?: boolean;
            includeBlocked?: boolean;
            statuses?: TaskStatus[];
        }
    ): Promise<string[]>;

    /**
     * Validate a potential dependency before adding it
     *
     * @param channelId - The channel ID
     * @param dependentTaskId - The task that will depend
     * @param dependencyTaskId - The task that must complete first
     * @returns Validation result including cycle detection
     */
    validateDependency(
        channelId: ChannelId,
        dependentTaskId: string,
        dependencyTaskId: string
    ): Promise<AddDependencyResult>;

    /**
     * Validate the entire DAG
     *
     * @param channelId - The channel ID
     * @returns Validation result with errors and warnings
     */
    validateDag(channelId: ChannelId): Promise<DagValidationResult>;

    /**
     * Get DAG statistics
     *
     * @param channelId - The channel ID
     * @returns Statistics about the DAG
     */
    getStats(channelId: ChannelId): Promise<DagStats | null>;

    /**
     * Get tasks in parallel execution groups
     *
     * @param channelId - The channel ID
     * @returns Array of groups where tasks in each group can run in parallel
     */
    getParallelGroups(channelId: ChannelId): Promise<string[][]>;

    /**
     * Get the critical path (longest dependency chain)
     *
     * @param channelId - The channel ID
     * @returns Array of task IDs forming the critical path
     */
    getCriticalPath(channelId: ChannelId): Promise<string[]>;

    /**
     * Invalidate the cached DAG for a channel
     *
     * @param channelId - The channel ID
     */
    invalidateCache(channelId: ChannelId): Promise<void>;

    /**
     * Called when a task is created
     *
     * @param channelId - The channel ID
     * @param taskId - The created task ID
     * @param dependencies - Task IDs this task depends on
     */
    onTaskCreated(
        channelId: ChannelId,
        taskId: string,
        dependencies?: string[]
    ): Promise<void>;

    /**
     * Called when a task status changes
     *
     * @param channelId - The channel ID
     * @param taskId - The task ID
     * @param newStatus - The new status
     */
    onTaskStatusChanged(
        channelId: ChannelId,
        taskId: string,
        newStatus: TaskStatus
    ): Promise<void>;

    /**
     * Called when a task is deleted
     *
     * @param channelId - The channel ID
     * @param taskId - The deleted task ID
     */
    onTaskDeleted(channelId: ChannelId, taskId: string): Promise<void>;
}
