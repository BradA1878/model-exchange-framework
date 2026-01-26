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

import { IBaseRepository } from './IBaseRepository';
import { DateRange } from '../types/FilterTypes';

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Task status values
 */
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Assignment strategy types
 */
export type AssignmentStrategy = 'role_based' | 'workload_balanced' | 'expertise_driven' | 'manual' | 'intelligent';

/**
 * Assignment scope types
 */
export type AssignmentScope = 'single' | 'multiple' | 'channel-wide';

/**
 * Assignment distribution types
 */
export type AssignmentDistribution = 'parallel' | 'sequential' | 'collaborative';

/**
 * Coordination mode types
 */
export type CoordinationMode = 'independent' | 'collaborative' | 'sequential' | 'hierarchical';

/**
 * Domain entity type for Task (database-agnostic)
 */
export interface ITaskEntity {
    id?: string;
    channelId: string;
    title: string;
    description: string;
    priority: TaskPriority;
    requiredRoles?: string[];
    requiredCapabilities?: string[];
    assignedAgentId?: string;
    assignedAgentIds?: string[];
    assignmentScope?: AssignmentScope;
    assignmentDistribution?: AssignmentDistribution;
    channelWideTask?: boolean;
    targetAgentRoles?: string[];
    excludeAgentIds?: string[];
    maxParticipants?: number;
    coordinationMode?: CoordinationMode;
    leadAgentId?: string;
    completionAgentId?: string;
    assignmentStrategy: AssignmentStrategy;
    status: TaskStatus;
    progress?: number;
    createdAt: Date;
    updatedAt: Date;
    dueDate?: Date;
    estimatedDuration?: number;
    actualDuration?: number;
    createdBy: string;
    metadata?: Record<string, any>;
    tags?: string[];
    dependsOn?: string[];
    blockedBy?: string[];
    result?: {
        success?: boolean;
        output?: any;
        error?: string;
        completedAt?: Date;
        completedBy?: string;
    };
}

/**
 * Task filter options
 */
export interface TaskFilters {
    status?: TaskStatus | TaskStatus[];
    priority?: TaskPriority;
    assigneeId?: string;
    createdRange?: DateRange;
    deadlineRange?: DateRange;
}

/**
 * Task hierarchy structure
 */
export interface TaskHierarchy {
    task: ITaskEntity;
    parent: ITaskEntity | null;
    subtasks: ITaskEntity[];
}

/**
 * Task statistics
 */
export interface TaskStatistics {
    total: number;
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<TaskPriority, number>;
    overdueCount: number;
    averageCompletionTime?: number;
}

/**
 * Repository interface for Task entities.
 */
export interface ITaskRepository extends IBaseRepository<ITaskEntity> {
    /**
     * Find tasks belonging to a channel
     */
    findByChannel(channelId: string, filters?: TaskFilters): Promise<ITaskEntity[]>;

    /**
     * Find tasks assigned to an agent
     */
    findByAssignee(agentId: string, filters?: TaskFilters): Promise<ITaskEntity[]>;

    /**
     * Find tasks created by an agent
     */
    findByCreator(agentId: string, filters?: TaskFilters): Promise<ITaskEntity[]>;

    /**
     * Find tasks by status
     */
    findByStatus(status: TaskStatus | TaskStatus[]): Promise<ITaskEntity[]>;

    /**
     * Find tasks by priority
     */
    findByPriority(priority: TaskPriority): Promise<ITaskEntity[]>;

    /**
     * Find overdue tasks (deadline passed, not completed)
     */
    findOverdue(): Promise<ITaskEntity[]>;

    /**
     * Find tasks due within a time range
     */
    findByDeadlineRange(range: DateRange): Promise<ITaskEntity[]>;

    /**
     * Update task status
     */
    updateStatus(taskId: string, status: TaskStatus, metadata?: Record<string, any>): Promise<ITaskEntity | null>;

    /**
     * Assign task to an agent
     */
    assignTo(taskId: string, agentId: string): Promise<ITaskEntity | null>;

    /**
     * Unassign task from current assignee
     */
    unassign(taskId: string): Promise<ITaskEntity | null>;

    /**
     * Update task progress
     */
    updateProgress(taskId: string, progress: number): Promise<ITaskEntity | null>;

    /**
     * Get task statistics for a channel
     */
    getChannelStatistics(channelId: string): Promise<TaskStatistics>;

    /**
     * Get task statistics for an agent
     */
    getAgentStatistics(agentId: string): Promise<TaskStatistics>;

    /**
     * Full-text search on task title and description
     * Note: Implementation may vary by database
     */
    search(query: string, filters?: TaskFilters): Promise<ITaskEntity[]>;

    /**
     * Find pending tasks in a channel
     */
    findPending(channelId?: string): Promise<ITaskEntity[]>;
}
