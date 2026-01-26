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

import { Task, ITask } from '../../../models/task';
import {
    ITaskEntity,
    ITaskRepository,
    TaskFilters,
    TaskStatistics,
    TaskStatus,
    TaskPriority
} from '../../../repositories/interfaces/ITaskRepository';
import { MongoBaseRepository } from './MongoBaseRepository';
import { DateRange } from '../../../repositories/types/FilterTypes';

/**
 * MongoDB implementation of ITaskRepository.
 * Uses the existing Task Mongoose model and translates to domain entities.
 */
export class MongoTaskRepository
    extends MongoBaseRepository<ITaskEntity, ITask>
    implements ITaskRepository {

    constructor() {
        super(Task);
    }

    /**
     * Convert Mongoose document to domain entity
     */
    protected toEntity(doc: any): ITaskEntity {
        return {
            id: doc._id?.toString() || doc.id,
            channelId: doc.channelId,
            title: doc.title,
            description: doc.description,
            priority: doc.priority,
            requiredRoles: doc.requiredRoles,
            requiredCapabilities: doc.requiredCapabilities,
            assignedAgentId: doc.assignedAgentId,
            assignedAgentIds: doc.assignedAgentIds,
            assignmentScope: doc.assignmentScope,
            assignmentDistribution: doc.assignmentDistribution,
            channelWideTask: doc.channelWideTask,
            targetAgentRoles: doc.targetAgentRoles,
            excludeAgentIds: doc.excludeAgentIds,
            maxParticipants: doc.maxParticipants,
            coordinationMode: doc.coordinationMode,
            leadAgentId: doc.leadAgentId,
            completionAgentId: doc.completionAgentId,
            assignmentStrategy: doc.assignmentStrategy,
            status: doc.status,
            progress: doc.progress,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            dueDate: doc.dueDate,
            estimatedDuration: doc.estimatedDuration,
            actualDuration: doc.actualDuration,
            createdBy: doc.createdBy,
            metadata: doc.metadata,
            tags: doc.tags,
            dependsOn: doc.dependsOn,
            blockedBy: doc.blockedBy,
            result: doc.result
        };
    }

    /**
     * Find tasks belonging to a channel
     */
    async findByChannel(channelId: string, filters?: TaskFilters): Promise<ITaskEntity[]> {
        const query: any = { channelId };
        this.applyFilters(query, filters);

        const docs = await this.model.find(query).sort({ priority: -1, createdAt: -1 }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find tasks assigned to an agent
     */
    async findByAssignee(agentId: string, filters?: TaskFilters): Promise<ITaskEntity[]> {
        const query: any = {
            $or: [
                { assignedAgentId: agentId },
                { assignedAgentIds: agentId }
            ]
        };
        this.applyFilters(query, filters);

        const docs = await this.model.find(query).sort({ priority: -1, dueDate: 1 }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find tasks created by an agent
     */
    async findByCreator(agentId: string, filters?: TaskFilters): Promise<ITaskEntity[]> {
        const query: any = { createdBy: agentId };
        this.applyFilters(query, filters);

        const docs = await this.model.find(query).sort({ createdAt: -1 }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find tasks by status
     */
    async findByStatus(status: TaskStatus | TaskStatus[]): Promise<ITaskEntity[]> {
        const query = Array.isArray(status)
            ? { status: { $in: status } }
            : { status };

        const docs = await this.model.find(query).sort({ updatedAt: -1 }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find tasks by priority
     */
    async findByPriority(priority: TaskPriority): Promise<ITaskEntity[]> {
        const docs = await this.model.find({ priority }).sort({ createdAt: -1 }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find overdue tasks
     */
    async findOverdue(): Promise<ITaskEntity[]> {
        const docs = await this.model.find({
            dueDate: { $lt: new Date() },
            status: { $nin: ['completed', 'failed', 'cancelled'] }
        }).sort({ dueDate: 1 }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find tasks due within a time range
     */
    async findByDeadlineRange(range: DateRange): Promise<ITaskEntity[]> {
        const query: any = {};
        if (range.start || range.end) {
            query.dueDate = {};
            if (range.start) query.dueDate.$gte = range.start;
            if (range.end) query.dueDate.$lte = range.end;
        }

        const docs = await this.model.find(query).sort({ dueDate: 1 }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Update task status
     */
    async updateStatus(taskId: string, status: TaskStatus, metadata?: Record<string, any>): Promise<ITaskEntity | null> {
        const update: any = { status };
        if (metadata) {
            update.metadata = metadata;
        }
        if (status === 'completed') {
            update.progress = 100;
        }

        const doc = await this.model.findByIdAndUpdate(
            taskId,
            { $set: update },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Assign task to an agent
     */
    async assignTo(taskId: string, agentId: string): Promise<ITaskEntity | null> {
        const doc = await this.model.findByIdAndUpdate(
            taskId,
            {
                $set: { assignedAgentId: agentId, status: 'assigned' },
                $addToSet: { assignedAgentIds: agentId }
            },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Unassign task from current assignee
     */
    async unassign(taskId: string): Promise<ITaskEntity | null> {
        const doc = await this.model.findByIdAndUpdate(
            taskId,
            {
                $unset: { assignedAgentId: "" },
                $set: { status: 'pending', assignedAgentIds: [] }
            },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Update task progress
     */
    async updateProgress(taskId: string, progress: number): Promise<ITaskEntity | null> {
        const doc = await this.model.findByIdAndUpdate(
            taskId,
            { $set: { progress } },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Get task statistics for a channel
     */
    async getChannelStatistics(channelId: string): Promise<TaskStatistics> {
        const tasks = await this.model.find({ channelId }).lean();

        return this.calculateStatistics(tasks);
    }

    /**
     * Get task statistics for an agent
     */
    async getAgentStatistics(agentId: string): Promise<TaskStatistics> {
        const tasks = await this.model.find({
            $or: [
                { assignedAgentId: agentId },
                { assignedAgentIds: agentId }
            ]
        }).lean();

        return this.calculateStatistics(tasks);
    }

    /**
     * Full-text search on task title and description
     */
    async search(query: string, filters?: TaskFilters): Promise<ITaskEntity[]> {
        const searchQuery: any = {
            $text: { $search: query }
        };
        this.applyFilters(searchQuery, filters);

        const docs = await this.model.find(searchQuery).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find pending tasks in a channel
     */
    async findPending(channelId?: string): Promise<ITaskEntity[]> {
        const query: any = { status: 'pending' };
        if (channelId) query.channelId = channelId;

        const docs = await this.model.find(query).sort({ priority: -1, createdAt: 1 }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Apply filters to a MongoDB query
     */
    private applyFilters(query: any, filters?: TaskFilters): void {
        if (!filters) return;

        if (filters.status) {
            query.status = Array.isArray(filters.status)
                ? { $in: filters.status }
                : filters.status;
        }

        if (filters.priority) {
            query.priority = filters.priority;
        }

        if (filters.assigneeId) {
            query.$or = [
                { assignedAgentId: filters.assigneeId },
                { assignedAgentIds: filters.assigneeId }
            ];
        }

        if (filters.createdRange) {
            query.createdAt = {};
            if (filters.createdRange.start) query.createdAt.$gte = filters.createdRange.start;
            if (filters.createdRange.end) query.createdAt.$lte = filters.createdRange.end;
        }

        if (filters.deadlineRange) {
            query.dueDate = {};
            if (filters.deadlineRange.start) query.dueDate.$gte = filters.deadlineRange.start;
            if (filters.deadlineRange.end) query.dueDate.$lte = filters.deadlineRange.end;
        }
    }

    /**
     * Calculate task statistics from task array
     */
    private calculateStatistics(tasks: any[]): TaskStatistics {
        const byStatus: Record<TaskStatus, number> = {
            pending: 0,
            assigned: 0,
            in_progress: 0,
            completed: 0,
            failed: 0,
            cancelled: 0
        };

        const byPriority: Record<TaskPriority, number> = {
            low: 0,
            medium: 0,
            high: 0,
            urgent: 0
        };

        let overdueCount = 0;
        let totalCompletionTime = 0;
        let completedCount = 0;
        const now = new Date();

        for (const task of tasks) {
            byStatus[task.status as TaskStatus]++;
            byPriority[task.priority as TaskPriority]++;

            if (task.dueDate && task.dueDate < now && task.status !== 'completed') {
                overdueCount++;
            }

            if (task.status === 'completed' && task.actualDuration) {
                totalCompletionTime += task.actualDuration;
                completedCount++;
            }
        }

        return {
            total: tasks.length,
            byStatus,
            byPriority,
            overdueCount,
            averageCompletionTime: completedCount > 0 ? totalCompletionTime / completedCount : undefined
        };
    }
}
