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
 * MongoDB DAG Repository
 *
 * Implements IDagRepository by deriving DAG structure from existing task data.
 * The DAG is built from task dependsOn/blockedBy fields, not stored separately.
 * This adapter uses TaskDagService for DAG operations and TaskService for data access.
 */

import { Task } from '../../../models/task';
import { IDagRepository } from '../../../repositories/interfaces/IDagRepository';
import { ChannelId } from '../../../types/ChannelContext';
import { TaskStatus, ChannelTask } from '../../../types/TaskTypes';
import {
    TaskDag,
    DagValidationResult,
    DagStats,
    AddDependencyResult,
} from '../../../types/DagTypes';
import { TaskDagService } from '../../../services/dag/TaskDagService';
import { isDagEnabled } from '../../../config/dag.config';
import { Logger } from '../../../utils/Logger';

const logger = new Logger('info', 'MongoDagRepository', 'server');

/**
 * MongoDB implementation of IDagRepository
 * Derives DAG from existing task data in MongoDB
 */
export class MongoDagRepository implements IDagRepository {
    private static instance: MongoDagRepository;
    private dagService: TaskDagService;

    private constructor() {
        this.dagService = TaskDagService.getInstance();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): MongoDagRepository {
        if (!MongoDagRepository.instance) {
            MongoDagRepository.instance = new MongoDagRepository();
        }
        return MongoDagRepository.instance;
    }

    /**
     * Build a DAG from existing tasks in a channel
     */
    async buildDagFromTasks(channelId: ChannelId): Promise<TaskDag | null> {
        if (!isDagEnabled()) {
            logger.debug('DAG system disabled, skipping buildDagFromTasks');
            return null;
        }

        try {
            // Fetch all tasks for the channel from MongoDB
            const tasks = await Task.find({ channelId }).lean();

            if (tasks.length === 0) {
                logger.debug(`No tasks found for channel ${channelId}`);
                return null;
            }

            // Convert to ChannelTask format
            const channelTasks: ChannelTask[] = tasks.map((task: any) => ({
                id: task._id?.toString() || task.id,
                channelId: task.channelId,
                title: task.title,
                description: task.description,
                priority: task.priority,
                requiredRoles: task.requiredRoles,
                requiredCapabilities: task.requiredCapabilities,
                assignedAgentId: task.assignedAgentId,
                assignedAgentIds: task.assignedAgentIds,
                assignmentScope: task.assignmentScope || 'single',
                assignmentDistribution: task.assignmentDistribution,
                channelWideTask: task.channelWideTask,
                targetAgentRoles: task.targetAgentRoles,
                excludeAgentIds: task.excludeAgentIds,
                maxParticipants: task.maxParticipants,
                coordinationMode: task.coordinationMode,
                leadAgentId: task.leadAgentId,
                agentSelectionCriteria: task.agentSelectionCriteria,
                status: task.status,
                progress: task.progress,
                createdAt: task.createdAt?.getTime() || Date.now(),
                updatedAt: task.updatedAt?.getTime() || Date.now(),
                dueDate: task.dueDate?.getTime(),
                estimatedDuration: task.estimatedDuration,
                actualDuration: task.actualDuration,
                createdBy: task.createdBy,
                metadata: task.metadata,
                tags: task.tags,
                dependsOn: task.dependsOn || [],
                blockedBy: task.blockedBy || [],
                result: task.result,
                assignmentStrategy: task.assignmentStrategy || 'manual',
            }));

            // Build DAG using TaskDagService
            const dag = this.dagService.buildDag(channelId, channelTasks);
            logger.debug(`Built DAG for channel ${channelId}: ${dag.nodes.size} nodes, ${dag.edges.size} edges`);

            return dag;
        } catch (error: any) {
            logger.error(`Failed to build DAG for channel ${channelId}`, { error: error.message });
            throw error;
        }
    }

    /**
     * Get the DAG for a channel (cached or build if needed)
     */
    async getDag(channelId: ChannelId): Promise<TaskDag | null> {
        if (!isDagEnabled()) {
            return null;
        }

        // Check if DAG exists in cache
        let dag = this.dagService.getDag(channelId);

        if (!dag) {
            // Build from database
            dag = await this.buildDagFromTasks(channelId);
        }

        return dag;
    }

    /**
     * Check if a task is ready to execute
     */
    async isTaskReady(channelId: ChannelId, taskId: string): Promise<boolean> {
        if (!isDagEnabled()) {
            return true; // If DAG disabled, assume task is ready
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        return this.dagService.isTaskReady(channelId, taskId);
    }

    /**
     * Get tasks that are ready to execute
     */
    async getReadyTasks(
        channelId: ChannelId,
        options?: {
            limit?: number;
            excludeStatuses?: TaskStatus[];
        }
    ): Promise<string[]> {
        if (!isDagEnabled()) {
            return [];
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        return this.dagService.getReadyTasks(channelId, {
            limit: options?.limit,
        });
    }

    /**
     * Get tasks that are blocking a specific task
     */
    async getBlockingTasks(channelId: ChannelId, taskId: string): Promise<string[]> {
        if (!isDagEnabled()) {
            return [];
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        return this.dagService.getBlockingTasks(channelId, taskId);
    }

    /**
     * Get the execution order for tasks (topologically sorted)
     */
    async getExecutionOrder(
        channelId: ChannelId,
        options?: {
            includeCompleted?: boolean;
            includeBlocked?: boolean;
            statuses?: TaskStatus[];
        }
    ): Promise<string[]> {
        if (!isDagEnabled()) {
            return [];
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        return this.dagService.getExecutionOrder(channelId, options);
    }

    /**
     * Validate a potential dependency before adding it
     */
    async validateDependency(
        channelId: ChannelId,
        dependentTaskId: string,
        dependencyTaskId: string
    ): Promise<AddDependencyResult> {
        if (!isDagEnabled()) {
            return { success: true };
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        // Use TaskDagService to validate
        return this.dagService.addDependency(channelId, {
            dependentTaskId,
            dependencyTaskId,
        });
    }

    /**
     * Validate the entire DAG
     */
    async validateDag(channelId: ChannelId): Promise<DagValidationResult> {
        if (!isDagEnabled()) {
            return {
                isValid: true,
                errors: [],
                warnings: [],
                stats: {
                    nodeCount: 0,
                    edgeCount: 0,
                    rootCount: 0,
                    leafCount: 0,
                    maxDepth: 0,
                    averageInDegree: 0,
                    averageOutDegree: 0,
                    readyTaskCount: 0,
                    blockedTaskCount: 0,
                    completedTaskCount: 0,
                },
            };
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        return this.dagService.validateDag(channelId);
    }

    /**
     * Get DAG statistics
     */
    async getStats(channelId: ChannelId): Promise<DagStats | null> {
        if (!isDagEnabled()) {
            return null;
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        return this.dagService.getStats(channelId);
    }

    /**
     * Get tasks in parallel execution groups
     */
    async getParallelGroups(channelId: ChannelId): Promise<string[][]> {
        if (!isDagEnabled()) {
            return [];
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        return this.dagService.getParallelGroups(channelId);
    }

    /**
     * Get the critical path (longest dependency chain)
     */
    async getCriticalPath(channelId: ChannelId): Promise<string[]> {
        if (!isDagEnabled()) {
            return [];
        }

        // Ensure DAG is built
        await this.getDag(channelId);

        return this.dagService.getCriticalPath(channelId);
    }

    /**
     * Invalidate the cached DAG for a channel
     */
    async invalidateCache(channelId: ChannelId): Promise<void> {
        this.dagService.clearCache(channelId);
        logger.debug(`Invalidated DAG cache for channel ${channelId}`);
    }

    /**
     * Called when a task is created
     */
    async onTaskCreated(
        channelId: ChannelId,
        taskId: string,
        dependencies?: string[]
    ): Promise<void> {
        if (!isDagEnabled()) {
            return;
        }

        // Rebuild the DAG to include the new task
        await this.buildDagFromTasks(channelId);
        logger.debug(`DAG updated for new task ${taskId} in channel ${channelId}`);
    }

    /**
     * Called when a task status changes
     */
    async onTaskStatusChanged(
        channelId: ChannelId,
        taskId: string,
        newStatus: TaskStatus
    ): Promise<void> {
        if (!isDagEnabled()) {
            return;
        }

        // Update the task status in the DAG
        this.dagService.updateTaskStatus(channelId, taskId, newStatus);
        logger.debug(`DAG updated for task ${taskId} status change to ${newStatus}`);
    }

    /**
     * Called when a task is deleted
     */
    async onTaskDeleted(channelId: ChannelId, taskId: string): Promise<void> {
        if (!isDagEnabled()) {
            return;
        }

        // Remove the task from the DAG
        this.dagService.removeTask(channelId, taskId);
        logger.debug(`Removed task ${taskId} from DAG for channel ${channelId}`);
    }
}
