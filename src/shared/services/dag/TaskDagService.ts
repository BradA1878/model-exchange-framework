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
 * TaskDagService
 *
 * Central service for managing Task DAGs.
 * Provides methods for building DAGs, validating dependencies, and querying execution order.
 *
 * Features:
 * - In-memory DAG cache per channel
 * - Cycle detection before adding dependencies
 * - Topological sort for execution ordering
 * - Event emission for DAG changes
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { Events } from '../../events/EventNames';
import { DagEvents } from '../../events/event-definitions/DagEvents';
import {
    TaskDag,
    TaskDagNode,
    TaskDagEdge,
    TopologicalResult,
    CycleDetectionResult,
    DagValidationResult,
    DagValidationError,
    DagValidationWarning,
    DagStats,
    DagErrorCode,
    DagWarningCode,
    AddDependencyRequest,
    AddDependencyResult,
    RemoveDependencyRequest,
    GetReadyTasksOptions,
    GetExecutionOrderOptions,
} from '../../types/DagTypes';
import { ChannelTask, TaskStatus } from '../../types/TaskTypes';
import { ChannelId } from '../../types/ChannelContext';
import {
    getDagConfig,
    isDagEnabled,
    isDagEnforcementEnabled,
    shouldEmitDagEvents,
} from '../../config/dag.config';
import {
    topologicalSort,
    detectCycle,
    findParallelGroups,
    findCriticalPath,
    computeDagStats,
    isTaskReady,
    getBlockingTasks,
    getTasksToUnblock,
} from './algorithms/TopologicalSort';
import {
    createDagTaskDependenciesResolvedPayload,
    createDagTaskBlockedPayload,
    createDagTaskUnblockedPayload,
    createDagCycleDetectedPayload,
    createDagUpdatedPayload,
    createDagDependencyAddedPayload,
    createDagDependencyRemovedPayload,
} from '../../schemas/EventPayloadSchema';

/**
 * Cached topological sort result with version tracking
 */
interface CachedTopoResult {
    /** DAG version when this result was computed */
    version: number;
    /** The cached topological sort result */
    result: TopologicalResult;
}

/**
 * Cache entry for a channel's DAG
 */
interface DagCacheEntry {
    dag: TaskDag;
    lastAccessed: number;
    lastModified: number;
    /** Cached topological sort result, invalidated when DAG version changes */
    cachedTopoResult?: CachedTopoResult;
}

/**
 * TaskDagService manages Task DAGs for all channels
 */
export class TaskDagService {
    private static instance: TaskDagService;
    private logger: Logger;
    private enabled: boolean = false;

    // In-memory cache of DAGs per channel
    private dagCache: Map<ChannelId, DagCacheEntry> = new Map();

    // Per-channel locks for serializing concurrent operations (e.g., task completion)
    private channelLocks: Map<ChannelId, Promise<void>> = new Map();

    // Cache cleanup interval
    private cleanupInterval: NodeJS.Timeout | null = null;

    private constructor() {
        this.logger = new Logger('info', 'TaskDagService', 'server');
        this.initialize();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): TaskDagService {
        if (!TaskDagService.instance) {
            TaskDagService.instance = new TaskDagService();
        }
        return TaskDagService.instance;
    }

    /**
     * Initialize the service
     */
    private initialize(): void {
        const config = getDagConfig();
        this.enabled = config.enabled;

        if (!this.enabled) {
            this.logger.debug('TaskDagService initialized but disabled');
            return;
        }

        this.logger.info('TaskDagService initialized');

        // Start cache cleanup interval
        this.startCacheCleanup();
    }

    /**
     * Start the cache cleanup interval
     */
    private startCacheCleanup(): void {
        const config = getDagConfig();
        const cleanupIntervalMs = config.cacheTtlMs * 2; // Cleanup every 2x TTL

        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredCaches();
        }, cleanupIntervalMs);
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupExpiredCaches(): void {
        const config = getDagConfig();
        const now = Date.now();
        const expiredChannels: ChannelId[] = [];

        for (const [channelId, entry] of this.dagCache) {
            if (now - entry.lastAccessed > config.cacheTtlMs) {
                expiredChannels.push(channelId);
            }
        }

        for (const channelId of expiredChannels) {
            this.dagCache.delete(channelId);
            this.logger.debug(`Cleaned up expired DAG cache for channel: ${channelId}`);
        }
    }

    /**
     * Check if the service is enabled
     */
    public isEnabled(): boolean {
        // Check config dynamically to reflect runtime changes
        return getDagConfig().enabled;
    }

    /**
     * Execute a function while holding a per-channel lock.
     * Uses promise chaining to serialize concurrent operations on the same channel.
     * This prevents race conditions when multiple tasks complete simultaneously.
     *
     * @param channelId - The channel to lock
     * @param fn - The function to execute under the lock
     * @returns The return value of the function
     */
    public async withChannelLock<T>(channelId: ChannelId, fn: () => Promise<T>): Promise<T> {
        const currentLock = this.channelLocks.get(channelId) ?? Promise.resolve();

        let resolve: () => void;
        const newLock = new Promise<void>((r) => { resolve = r; });
        this.channelLocks.set(channelId, newLock);

        // Wait for previous lock to release before executing
        await currentLock;

        try {
            return await fn();
        } finally {
            resolve!();
            // Clean up the lock if it's still our promise (no new lock was queued)
            if (this.channelLocks.get(channelId) === newLock) {
                this.channelLocks.delete(channelId);
            }
        }
    }

    /**
     * Get cached topological sort result for a channel.
     * Returns the cached result if the DAG version has not changed, otherwise recomputes.
     *
     * @param channelId - The channel to get topological sort for
     * @returns The topological sort result, or null if no DAG exists
     */
    private getCachedTopologicalSort(channelId: ChannelId): TopologicalResult | null {
        const entry = this.dagCache.get(channelId);
        if (!entry) {
            return null;
        }

        const dag = entry.dag;

        // Return cached result if DAG version hasn't changed
        if (entry.cachedTopoResult && entry.cachedTopoResult.version === dag.version) {
            return entry.cachedTopoResult.result;
        }

        // Recompute and cache
        const result = topologicalSort(dag);
        entry.cachedTopoResult = {
            version: dag.version,
            result,
        };

        return result;
    }

    /**
     * Build a DAG from a list of tasks
     */
    public buildDag(channelId: ChannelId, tasks: ChannelTask[]): TaskDag {
        const now = Date.now();

        const dag: TaskDag = {
            channelId,
            nodes: new Map(),
            edges: new Map(),
            adjacencyList: new Map(),
            reverseAdjacencyList: new Map(),
            createdAt: now,
            updatedAt: now,
            version: 1,
        };

        // First pass: create all nodes
        for (const task of tasks) {
            const node = this.createNodeFromTask(task);
            dag.nodes.set(task.id, node);
            dag.adjacencyList.set(task.id, new Set());
            dag.reverseAdjacencyList.set(task.id, new Set());
        }

        // Second pass: create edges from dependencies
        for (const task of tasks) {
            const dependencies = [
                ...(task.dependsOn || []),
                ...(task.blockedBy || []),
            ];

            for (const depId of dependencies) {
                // Only create edge if both nodes exist
                if (dag.nodes.has(depId)) {
                    const edgeId = `${depId}->${task.id}`;
                    const edge: TaskDagEdge = {
                        id: edgeId,
                        fromTaskId: depId,
                        toTaskId: task.id,
                        createdAt: now,
                    };

                    dag.edges.set(edgeId, edge);

                    // Update adjacency lists
                    dag.adjacencyList.get(depId)?.add(task.id);
                    dag.reverseAdjacencyList.get(task.id)?.add(depId);
                }
            }
        }

        // Third pass: compute in/out degrees and ready status
        this.updateNodeDegrees(dag);
        this.updateReadyStatus(dag);

        // Cache the DAG
        this.dagCache.set(channelId, {
            dag,
            lastAccessed: now,
            lastModified: now,
        });

        this.logger.debug(`Built DAG for channel ${channelId}: ${dag.nodes.size} nodes, ${dag.edges.size} edges`);

        return dag;
    }

    /**
     * Create a DAG node from a task
     */
    private createNodeFromTask(task: ChannelTask): TaskDagNode {
        return {
            taskId: task.id,
            status: task.status,
            dependsOn: [...(task.dependsOn || []), ...(task.blockedBy || [])],
            blockedBy: [],
            inDegree: 0,
            outDegree: 0,
            isReady: false,
            addedAt: Date.now(),
            updatedAt: Date.now(),
        };
    }

    /**
     * Update in/out degrees for all nodes
     */
    private updateNodeDegrees(dag: TaskDag): void {
        for (const [taskId, node] of dag.nodes) {
            node.inDegree = dag.reverseAdjacencyList.get(taskId)?.size || 0;
            node.outDegree = dag.adjacencyList.get(taskId)?.size || 0;
        }
    }

    /**
     * Update ready status for all nodes
     */
    private updateReadyStatus(dag: TaskDag): void {
        for (const [taskId, node] of dag.nodes) {
            node.isReady = isTaskReady(dag, taskId);
        }
    }

    /**
     * Get or create DAG for a channel
     */
    public getDag(channelId: ChannelId): TaskDag | null {
        const entry = this.dagCache.get(channelId);
        if (entry) {
            entry.lastAccessed = Date.now();
            return entry.dag;
        }
        return null;
    }

    /**
     * Validate and add a dependency between tasks
     */
    public async addDependency(
        channelId: ChannelId,
        request: AddDependencyRequest
    ): Promise<AddDependencyResult> {
        const dag = this.getDag(channelId);
        if (!dag) {
            return {
                success: false,
                error: `No DAG found for channel: ${channelId}`,
            };
        }

        const { dependentTaskId, dependencyTaskId, label } = request;

        // Validate nodes exist
        if (!dag.nodes.has(dependentTaskId)) {
            return {
                success: false,
                error: `Dependent task not found: ${dependentTaskId}`,
                errorCode: DagErrorCode.MISSING_NODE,
            };
        }

        if (!dag.nodes.has(dependencyTaskId)) {
            return {
                success: false,
                error: `Dependency task not found: ${dependencyTaskId}`,
                errorCode: DagErrorCode.MISSING_NODE,
            };
        }

        // Check for self-dependency
        if (dependentTaskId === dependencyTaskId) {
            return {
                success: false,
                error: 'Task cannot depend on itself',
                errorCode: DagErrorCode.SELF_DEPENDENCY,
            };
        }

        // Check for duplicate edge
        const edgeId = `${dependencyTaskId}->${dependentTaskId}`;
        if (dag.edges.has(edgeId)) {
            return {
                success: false,
                error: 'Dependency already exists',
                errorCode: DagErrorCode.DUPLICATE_EDGE,
            };
        }

        // Check for cycle
        const testEdge: TaskDagEdge = {
            id: edgeId,
            fromTaskId: dependencyTaskId,
            toTaskId: dependentTaskId,
            label,
            createdAt: Date.now(),
        };

        const cycleResult = detectCycle(dag, testEdge);
        if (cycleResult.hasCycle) {
            // Emit cycle detected event
            if (shouldEmitDagEvents()) {
                EventBus.server.emit(
                    DagEvents.CYCLE_DETECTED,
                    createDagCycleDetectedPayload(
                        channelId,
                        'system',
                        dependentTaskId,
                        dependencyTaskId,
                        cycleResult.cyclePath || [],
                        cycleResult.cycleDescription || 'Cycle detected'
                    )
                );
            }

            return {
                success: false,
                error: cycleResult.cycleDescription || 'Adding this dependency would create a cycle',
                errorCode: DagErrorCode.CYCLE_DETECTED,
                cyclePath: cycleResult.cyclePath,
            };
        }

        // Add the edge
        dag.edges.set(edgeId, testEdge);
        dag.adjacencyList.get(dependencyTaskId)?.add(dependentTaskId);
        dag.reverseAdjacencyList.get(dependentTaskId)?.add(dependencyTaskId);

        // Update node
        const dependentNode = dag.nodes.get(dependentTaskId)!;
        dependentNode.dependsOn.push(dependencyTaskId);
        dependentNode.inDegree++;
        dependentNode.updatedAt = Date.now();

        const dependencyNode = dag.nodes.get(dependencyTaskId)!;
        dependencyNode.outDegree++;
        dependencyNode.updatedAt = Date.now();

        // Update ready status
        this.updateReadyStatus(dag);

        // Update DAG metadata
        dag.updatedAt = Date.now();
        dag.version++;

        // Update cache
        const cacheEntry = this.dagCache.get(channelId);
        if (cacheEntry) {
            cacheEntry.lastModified = Date.now();
        }

        // Emit events
        if (shouldEmitDagEvents()) {
            EventBus.server.emit(
                DagEvents.DEPENDENCY_ADDED,
                createDagDependencyAddedPayload(
                    channelId,
                    'system',
                    edgeId,
                    dependentTaskId,
                    dependencyTaskId,
                    label
                )
            );

            EventBus.server.emit(
                DagEvents.DAG_UPDATED,
                createDagUpdatedPayload(
                    channelId,
                    'system',
                    'edge_added',
                    [dependentTaskId, dependencyTaskId],
                    dag.version
                )
            );
        }

        this.logger.debug(`Added dependency: ${dependencyTaskId} -> ${dependentTaskId}`);

        return {
            success: true,
            edge: testEdge,
        };
    }

    /**
     * Remove a dependency between tasks
     */
    public async removeDependency(
        channelId: ChannelId,
        request: RemoveDependencyRequest
    ): Promise<boolean> {
        const dag = this.getDag(channelId);
        if (!dag) {
            return false;
        }

        const { dependentTaskId, dependencyTaskId } = request;
        const edgeId = `${dependencyTaskId}->${dependentTaskId}`;

        if (!dag.edges.has(edgeId)) {
            return false;
        }

        // Remove the edge
        dag.edges.delete(edgeId);
        dag.adjacencyList.get(dependencyTaskId)?.delete(dependentTaskId);
        dag.reverseAdjacencyList.get(dependentTaskId)?.delete(dependencyTaskId);

        // Update nodes
        const dependentNode = dag.nodes.get(dependentTaskId);
        if (dependentNode) {
            dependentNode.dependsOn = dependentNode.dependsOn.filter((id) => id !== dependencyTaskId);
            dependentNode.inDegree--;
            dependentNode.updatedAt = Date.now();
        }

        const dependencyNode = dag.nodes.get(dependencyTaskId);
        if (dependencyNode) {
            dependencyNode.outDegree--;
            dependencyNode.updatedAt = Date.now();
        }

        // Update ready status
        this.updateReadyStatus(dag);

        // Update DAG metadata
        dag.updatedAt = Date.now();
        dag.version++;

        // Update cache
        const cacheEntry = this.dagCache.get(channelId);
        if (cacheEntry) {
            cacheEntry.lastModified = Date.now();
        }

        // Emit events
        if (shouldEmitDagEvents()) {
            EventBus.server.emit(
                DagEvents.DEPENDENCY_REMOVED,
                createDagDependencyRemovedPayload(
                    channelId,
                    'system',
                    edgeId,
                    dependentTaskId,
                    dependencyTaskId
                )
            );

            EventBus.server.emit(
                DagEvents.DAG_UPDATED,
                createDagUpdatedPayload(
                    channelId,
                    'system',
                    'edge_removed',
                    [dependentTaskId, dependencyTaskId],
                    dag.version
                )
            );
        }

        this.logger.debug(`Removed dependency: ${dependencyTaskId} -> ${dependentTaskId}`);

        return true;
    }

    /**
     * Add a task to the DAG
     */
    public addTask(channelId: ChannelId, task: ChannelTask): void {
        let dag = this.getDag(channelId);

        if (!dag) {
            // Create a new DAG with just this task
            dag = this.buildDag(channelId, [task]);
            return;
        }

        const node = this.createNodeFromTask(task);
        dag.nodes.set(task.id, node);
        dag.adjacencyList.set(task.id, new Set());
        dag.reverseAdjacencyList.set(task.id, new Set());

        // Add edges for dependencies
        const dependencies = [...(task.dependsOn || []), ...(task.blockedBy || [])];
        for (const depId of dependencies) {
            if (dag.nodes.has(depId)) {
                const edgeId = `${depId}->${task.id}`;
                const edge: TaskDagEdge = {
                    id: edgeId,
                    fromTaskId: depId,
                    toTaskId: task.id,
                    createdAt: Date.now(),
                };

                dag.edges.set(edgeId, edge);
                dag.adjacencyList.get(depId)?.add(task.id);
                dag.reverseAdjacencyList.get(task.id)?.add(depId);
            }
        }

        // Update degrees
        this.updateNodeDegrees(dag);
        this.updateReadyStatus(dag);

        // Update DAG metadata
        dag.updatedAt = Date.now();
        dag.version++;

        // Update cache
        const cacheEntry = this.dagCache.get(channelId);
        if (cacheEntry) {
            cacheEntry.lastModified = Date.now();
        }

        // Emit event
        if (shouldEmitDagEvents()) {
            EventBus.server.emit(
                DagEvents.DAG_UPDATED,
                createDagUpdatedPayload(channelId, 'system', 'node_added', [task.id], dag.version)
            );
        }

        this.logger.debug(`Added task ${task.id} to DAG for channel ${channelId}`);
    }

    /**
     * Remove a task from the DAG
     */
    public removeTask(channelId: ChannelId, taskId: string): void {
        const dag = this.getDag(channelId);
        if (!dag || !dag.nodes.has(taskId)) {
            return;
        }

        // Remove all edges involving this task
        const edgesToRemove: string[] = [];
        for (const [edgeId, edge] of dag.edges) {
            if (edge.fromTaskId === taskId || edge.toTaskId === taskId) {
                edgesToRemove.push(edgeId);
            }
        }

        for (const edgeId of edgesToRemove) {
            dag.edges.delete(edgeId);
        }

        // Update adjacency lists
        for (const neighbors of dag.adjacencyList.values()) {
            neighbors.delete(taskId);
        }
        for (const neighbors of dag.reverseAdjacencyList.values()) {
            neighbors.delete(taskId);
        }

        // Remove the node
        dag.nodes.delete(taskId);
        dag.adjacencyList.delete(taskId);
        dag.reverseAdjacencyList.delete(taskId);

        // Update degrees
        this.updateNodeDegrees(dag);
        this.updateReadyStatus(dag);

        // Update DAG metadata
        dag.updatedAt = Date.now();
        dag.version++;

        // Emit event
        if (shouldEmitDagEvents()) {
            EventBus.server.emit(
                DagEvents.DAG_UPDATED,
                createDagUpdatedPayload(channelId, 'system', 'node_removed', [taskId], dag.version)
            );
        }

        this.logger.debug(`Removed task ${taskId} from DAG for channel ${channelId}`);
    }

    /**
     * Update task status in the DAG
     */
    public updateTaskStatus(channelId: ChannelId, taskId: string, newStatus: TaskStatus): void {
        const dag = this.getDag(channelId);
        if (!dag) {
            return;
        }

        const node = dag.nodes.get(taskId);
        if (!node) {
            return;
        }

        const oldStatus = node.status;
        node.status = newStatus;
        node.updatedAt = Date.now();

        // Update ready status for all nodes
        this.updateReadyStatus(dag);

        // Update DAG metadata
        dag.updatedAt = Date.now();
        dag.version++;

        // If task completed, check for tasks to unblock
        if (newStatus === 'completed' && oldStatus !== 'completed') {
            const toUnblock = getTasksToUnblock(dag, taskId);

            for (const unblockedTaskId of toUnblock) {
                const unblockedNode = dag.nodes.get(unblockedTaskId);
                if (unblockedNode && shouldEmitDagEvents()) {
                    EventBus.server.emit(
                        DagEvents.TASK_DEPENDENCIES_RESOLVED,
                        createDagTaskDependenciesResolvedPayload(
                            channelId,
                            'system',
                            unblockedTaskId,
                            [taskId]
                        )
                    );
                }
            }
        }

        // Emit status change event
        if (shouldEmitDagEvents()) {
            EventBus.server.emit(
                DagEvents.DAG_UPDATED,
                createDagUpdatedPayload(channelId, 'system', 'status_changed', [taskId], dag.version)
            );
        }

        this.logger.debug(`Updated task ${taskId} status to ${newStatus}`);
    }

    /**
     * Check if a task is ready to execute
     */
    public isTaskReady(channelId: ChannelId, taskId: string): boolean {
        const dag = this.getDag(channelId);
        if (!dag) {
            return true; // If no DAG, assume ready
        }

        return isTaskReady(dag, taskId);
    }

    /**
     * Get tasks blocking a specific task
     */
    public getBlockingTasks(channelId: ChannelId, taskId: string): string[] {
        const dag = this.getDag(channelId);
        if (!dag) {
            return [];
        }

        return getBlockingTasks(dag, taskId);
    }

    /**
     * Get ready tasks for a channel
     */
    public getReadyTasks(channelId: ChannelId, options?: GetReadyTasksOptions): string[] {
        const dag = this.getDag(channelId);
        if (!dag) {
            return [];
        }

        let readyTasks: string[] = [];

        for (const [taskId, node] of dag.nodes) {
            if (node.isReady && node.status !== 'completed' && node.status !== 'in_progress') {
                readyTasks.push(taskId);
            }
        }

        // Apply filters
        if (options?.taskIds) {
            readyTasks = readyTasks.filter((id) => options.taskIds!.includes(id));
        }

        // Apply limit
        if (options?.limit && options.limit > 0) {
            readyTasks = readyTasks.slice(0, options.limit);
        }

        return readyTasks;
    }

    /**
     * Get execution order for tasks
     */
    public getExecutionOrder(channelId: ChannelId, options?: GetExecutionOrderOptions): string[] {
        const dag = this.getDag(channelId);
        if (!dag) {
            return [];
        }

        const result = this.getCachedTopologicalSort(channelId);
        if (!result || !result.success) {
            this.logger.warn(`Cannot get execution order for channel ${channelId}: ${result?.error}`);
            return [];
        }

        let order = result.order;

        // Apply filters - by default exclude completed tasks
        const includeCompleted = options?.includeCompleted ?? false;
        const includeBlocked = options?.includeBlocked ?? true;

        if (!includeCompleted) {
            order = order.filter((id) => {
                const node = dag.nodes.get(id);
                return node && node.status !== 'completed';
            });
        }

        if (!includeBlocked) {
            order = order.filter((id) => {
                const node = dag.nodes.get(id);
                return node && node.isReady;
            });
        }

        if (options?.statuses && options.statuses.length > 0) {
            order = order.filter((id) => {
                const node = dag.nodes.get(id);
                return node && options.statuses!.includes(node.status);
            });
        }

        return order;
    }

    /**
     * Get parallel groups for a channel.
     * Uses cached topological sort result to extract execution levels.
     */
    public getParallelGroups(channelId: ChannelId): string[][] {
        const dag = this.getDag(channelId);
        if (!dag) {
            return [];
        }

        const result = this.getCachedTopologicalSort(channelId);
        if (!result || !result.success) {
            return findParallelGroups(dag);
        }

        return result.levels;
    }

    /**
     * Get critical path for a channel.
     * Uses cached topological sort result to extract critical path.
     */
    public getCriticalPath(channelId: ChannelId): string[] {
        const dag = this.getDag(channelId);
        if (!dag) {
            return [];
        }

        const result = this.getCachedTopologicalSort(channelId);
        if (!result || !result.success) {
            return findCriticalPath(dag);
        }

        return result.criticalPath;
    }

    /**
     * Validate the DAG for a channel
     */
    public validateDag(channelId: ChannelId): DagValidationResult {
        const dag = this.getDag(channelId);
        const config = getDagConfig();

        const result: DagValidationResult = {
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

        if (!dag) {
            return result;
        }

        // Check for cycles
        const cycleResult = detectCycle(dag);
        if (cycleResult.hasCycle) {
            result.isValid = false;
            result.errors.push({
                code: DagErrorCode.CYCLE_DETECTED,
                message: cycleResult.cycleDescription || 'Cycle detected',
                taskIds: cycleResult.cyclePath,
            });
        }

        // Check for missing nodes referenced by edges
        for (const edge of dag.edges.values()) {
            if (!dag.nodes.has(edge.fromTaskId)) {
                result.isValid = false;
                result.errors.push({
                    code: DagErrorCode.MISSING_NODE,
                    message: `Edge references missing source node: ${edge.fromTaskId}`,
                    taskIds: [edge.fromTaskId],
                    edgeIds: [edge.id],
                });
            }
            if (!dag.nodes.has(edge.toTaskId)) {
                result.isValid = false;
                result.errors.push({
                    code: DagErrorCode.MISSING_NODE,
                    message: `Edge references missing target node: ${edge.toTaskId}`,
                    taskIds: [edge.toTaskId],
                    edgeIds: [edge.id],
                });
            }
        }

        // Compute stats
        result.stats = computeDagStats(dag);

        // Check for warnings
        for (const node of dag.nodes.values()) {
            if (node.inDegree > config.maxInDegreeWarning) {
                result.warnings.push({
                    code: DagWarningCode.HIGH_IN_DEGREE,
                    message: `Task ${node.taskId} has ${node.inDegree} dependencies (threshold: ${config.maxInDegreeWarning})`,
                    taskIds: [node.taskId],
                });
            }

            if (node.outDegree > config.maxOutDegreeWarning) {
                result.warnings.push({
                    code: DagWarningCode.HIGH_OUT_DEGREE,
                    message: `Task ${node.taskId} blocks ${node.outDegree} tasks (threshold: ${config.maxOutDegreeWarning})`,
                    taskIds: [node.taskId],
                });
            }

            // Check for orphaned nodes
            if (node.inDegree === 0 && node.outDegree === 0 && dag.nodes.size > 1) {
                result.warnings.push({
                    code: DagWarningCode.ORPHANED_NODE,
                    message: `Task ${node.taskId} has no dependencies and no dependents`,
                    taskIds: [node.taskId],
                });
            }
        }

        // Check for long chains
        if (result.stats.maxDepth > config.maxChainLengthWarning) {
            result.warnings.push({
                code: DagWarningCode.LONG_CHAIN,
                message: `DAG has a chain of length ${result.stats.maxDepth} (threshold: ${config.maxChainLengthWarning})`,
            });
        }

        return result;
    }

    /**
     * Get DAG statistics.
     * Leverages cached topological sort to populate ready/blocked/completed counts
     * where possible, falling back to full computation.
     */
    public getStats(channelId: ChannelId): DagStats | null {
        const dag = this.getDag(channelId);
        if (!dag) {
            return null;
        }

        // computeDagStats is cheap (O(n)) and produces maxDepth/degree stats
        // that aren't in TopologicalResult, so we always call it directly.
        // The cached topo result already ensures topologicalSort() isn't called
        // redundantly when getStats is invoked alongside getExecutionOrder/etc.
        return computeDagStats(dag);
    }

    /**
     * Clear the DAG cache for a channel
     */
    public clearCache(channelId: ChannelId): void {
        this.dagCache.delete(channelId);
        this.logger.debug(`Cleared DAG cache for channel: ${channelId}`);
    }

    /**
     * Clear all DAG caches and pending locks
     */
    public clearAllCaches(): void {
        this.dagCache.clear();
        this.channelLocks.clear();
        this.logger.debug('Cleared all DAG caches and locks');
    }

    /**
     * Shutdown the service
     */
    public shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.channelLocks.clear();
        this.clearAllCaches();
        this.logger.info('TaskDagService shutdown complete');
    }
}
