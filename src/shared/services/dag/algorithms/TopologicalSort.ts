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
 * Topological Sort Algorithms for Task DAG
 *
 * Implements Kahn's algorithm for topological sorting with cycle detection.
 * Performance target: Cycle detection < 50ms for 1000 tasks.
 *
 * Key algorithms:
 * - topologicalSort: Kahn's algorithm for ordering tasks
 * - detectCycle: DFS-based cycle detection
 * - findParallelGroups: Identify tasks that can run concurrently
 * - findCriticalPath: Longest dependency chain calculation
 */

import {
    TaskDag,
    TaskDagNode,
    TaskDagEdge,
    TopologicalResult,
    CycleDetectionResult,
    DagStats,
} from '../../../types/DagTypes';
import { TaskStatus } from '../../../types/TaskTypes';
import { Logger } from '../../../utils/Logger';

const logger = new Logger('info', 'TopologicalSort', 'server');

/**
 * Performs topological sort using Kahn's algorithm
 *
 * Kahn's algorithm:
 * 1. Find all nodes with no incoming edges (in-degree = 0)
 * 2. Add them to the result and remove their outgoing edges
 * 3. Repeat until no nodes remain or a cycle is detected
 *
 * @param dag - The task DAG to sort
 * @returns TopologicalResult with sorted order and execution levels
 */
export function topologicalSort(dag: TaskDag): TopologicalResult {
    const startTime = performance.now();

    // Initialize result
    const result: TopologicalResult = {
        success: false,
        order: [],
        readyTasks: [],
        blockedTasks: [],
        completedTasks: [],
        levels: [],
        criticalPath: [],
    };

    // Handle empty DAG
    if (dag.nodes.size === 0) {
        result.success = true;
        return result;
    }

    // Copy in-degrees to avoid mutating the original DAG
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();

    for (const [taskId, node] of dag.nodes) {
        inDegree.set(taskId, node.inDegree);

        // Track completed tasks
        if (node.status === 'completed') {
            result.completedTasks.push(taskId);
        }
    }

    // Copy adjacency list
    for (const [taskId, neighbors] of dag.adjacencyList) {
        adjacency.set(taskId, new Set(neighbors));
    }

    // Find initial nodes with in-degree 0 (root nodes)
    const queue: string[] = [];
    for (const [taskId, degree] of inDegree) {
        if (degree === 0) {
            queue.push(taskId);
        }
    }

    // Process nodes level by level (BFS)
    let processedCount = 0;

    while (queue.length > 0) {
        // All nodes in current queue are at the same level (can run in parallel)
        const currentLevel: string[] = [];
        const levelSize = queue.length;

        for (let i = 0; i < levelSize; i++) {
            const taskId = queue.shift()!;
            result.order.push(taskId);
            currentLevel.push(taskId);
            processedCount++;

            // Determine if task is ready, blocked, or completed
            const node = dag.nodes.get(taskId);
            if (node) {
                if (node.status === 'completed') {
                    // Already in completedTasks
                } else if (node.isReady) {
                    result.readyTasks.push(taskId);
                } else {
                    result.blockedTasks.push(taskId);
                }
            }

            // Reduce in-degree of dependent tasks
            const neighbors = adjacency.get(taskId) || new Set();
            for (const neighbor of neighbors) {
                const currentDegree = inDegree.get(neighbor) || 0;
                const newDegree = currentDegree - 1;
                inDegree.set(neighbor, newDegree);

                if (newDegree === 0) {
                    queue.push(neighbor);
                }
            }
        }

        if (currentLevel.length > 0) {
            result.levels.push(currentLevel);
        }
    }

    // Check for cycle (not all nodes processed)
    if (processedCount !== dag.nodes.size) {
        result.success = false;
        result.error = `Cycle detected: only processed ${processedCount} of ${dag.nodes.size} nodes`;

        // Find remaining nodes (part of cycle)
        const remaining: string[] = [];
        for (const [taskId, degree] of inDegree) {
            if (!result.order.includes(taskId)) {
                remaining.push(taskId);
            }
        }

        logger.warn(`Topological sort failed: cycle detected involving tasks: ${remaining.join(', ')}`);
        return result;
    }

    // Compute critical path using internal function to avoid circular dependency
    result.criticalPath = computeCriticalPathInternal(dag, result.order);
    result.success = true;

    const elapsed = performance.now() - startTime;
    logger.debug(`Topological sort completed in ${elapsed.toFixed(2)}ms for ${dag.nodes.size} nodes`);

    return result;
}

/**
 * Detects cycles in the DAG using DFS
 *
 * Uses three-color marking:
 * - WHITE (0): Not visited
 * - GRAY (1): Currently in recursion stack
 * - BLACK (2): Fully processed
 *
 * @param dag - The task DAG to check
 * @param newEdge - Optional new edge to test (before adding)
 * @returns CycleDetectionResult indicating if a cycle exists
 */
export function detectCycle(dag: TaskDag, newEdge?: TaskDagEdge): CycleDetectionResult {
    const startTime = performance.now();

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();

    // Initialize all nodes as white
    for (const taskId of dag.nodes.keys()) {
        color.set(taskId, WHITE);
        parent.set(taskId, null);
    }

    // Build adjacency list (copy to avoid mutation)
    const adjacency = new Map<string, Set<string>>();
    for (const [taskId, neighbors] of dag.adjacencyList) {
        adjacency.set(taskId, new Set(neighbors));
    }

    // If testing a new edge, temporarily add it
    if (newEdge) {
        const fromNeighbors = adjacency.get(newEdge.fromTaskId) || new Set();
        fromNeighbors.add(newEdge.toTaskId);
        adjacency.set(newEdge.fromTaskId, fromNeighbors);

        // Ensure both nodes exist in color map
        if (!color.has(newEdge.fromTaskId)) {
            color.set(newEdge.fromTaskId, WHITE);
            parent.set(newEdge.fromTaskId, null);
        }
        if (!color.has(newEdge.toTaskId)) {
            color.set(newEdge.toTaskId, WHITE);
            parent.set(newEdge.toTaskId, null);
        }
    }

    let cyclePath: string[] | undefined;

    /**
     * DFS helper function
     * @returns true if cycle detected
     */
    function dfs(node: string): boolean {
        color.set(node, GRAY);

        const neighbors = adjacency.get(node) || new Set();
        for (const neighbor of neighbors) {
            const neighborColor = color.get(neighbor) ?? WHITE;

            if (neighborColor === GRAY) {
                // Found back edge (cycle)
                cyclePath = reconstructCycle(node, neighbor, parent);
                return true;
            }

            if (neighborColor === WHITE) {
                parent.set(neighbor, node);
                if (dfs(neighbor)) {
                    return true;
                }
            }
        }

        color.set(node, BLACK);
        return false;
    }

    // Run DFS from each unvisited node
    for (const taskId of color.keys()) {
        if (color.get(taskId) === WHITE) {
            if (dfs(taskId)) {
                const elapsed = performance.now() - startTime;
                logger.debug(`Cycle detection completed in ${elapsed.toFixed(2)}ms - CYCLE FOUND`);

                return {
                    hasCycle: true,
                    cyclePath,
                    cycleDescription: cyclePath
                        ? `Cycle: ${cyclePath.join(' -> ')}`
                        : 'Cycle detected but path could not be reconstructed',
                };
            }
        }
    }

    const elapsed = performance.now() - startTime;
    logger.debug(`Cycle detection completed in ${elapsed.toFixed(2)}ms - no cycle`);

    return {
        hasCycle: false,
    };
}

/**
 * Reconstructs the cycle path from parent pointers
 */
function reconstructCycle(
    startNode: string,
    endNode: string,
    parent: Map<string, string | null>
): string[] {
    const path: string[] = [endNode];
    let current: string | null = startNode;

    // Walk back from startNode to find endNode
    while (current !== null && current !== endNode) {
        path.unshift(current);
        current = parent.get(current) || null;
    }

    // Add the closing edge
    path.push(endNode);

    return path;
}

/**
 * Finds groups of tasks that can be executed in parallel
 *
 * Tasks are in the same parallel group if they:
 * 1. Have the same "depth" in the DAG
 * 2. Don't depend on each other
 *
 * @param dag - The task DAG
 * @returns Array of parallel groups (each group is an array of task IDs)
 */
export function findParallelGroups(dag: TaskDag): string[][] {
    // Use topological sort levels as parallel groups
    const result = topologicalSort(dag);

    if (!result.success) {
        logger.warn('Cannot find parallel groups: DAG contains cycle');
        return [];
    }

    // Filter out completed tasks from each level
    return result.levels.map((level) =>
        level.filter((taskId) => {
            const node = dag.nodes.get(taskId);
            return node && node.status !== 'completed';
        })
    ).filter((level) => level.length > 0);
}

/**
 * Internal function to compute critical path from an existing topological order.
 * This avoids circular dependency with topologicalSort.
 *
 * @param dag - The task DAG
 * @param order - Pre-computed topological order
 * @returns Array of task IDs representing the critical path
 */
function computeCriticalPathInternal(dag: TaskDag, order: string[]): string[] {
    if (order.length === 0) {
        return [];
    }

    // Distance from start and predecessor tracking
    const dist = new Map<string, number>();
    const predecessor = new Map<string, string | null>();

    // Initialize
    for (const taskId of order) {
        dist.set(taskId, 0);
        predecessor.set(taskId, null);
    }

    // Process in topological order
    for (const taskId of order) {
        const currentDist = dist.get(taskId) || 0;
        const neighbors = dag.adjacencyList.get(taskId) || new Set();

        for (const neighbor of neighbors) {
            const neighborDist = dist.get(neighbor) || 0;
            if (currentDist + 1 > neighborDist) {
                dist.set(neighbor, currentDist + 1);
                predecessor.set(neighbor, taskId);
            }
        }
    }

    // Find the node with maximum distance
    let maxDist = 0;
    let endNode: string | null = null;

    for (const [taskId, d] of dist) {
        if (d > maxDist) {
            maxDist = d;
            endNode = taskId;
        }
    }

    if (endNode === null) {
        // All isolated nodes
        return order.length > 0 ? [order[0]] : [];
    }

    // Reconstruct path
    const path: string[] = [];
    let current: string | null = endNode;

    while (current !== null) {
        path.unshift(current);
        current = predecessor.get(current) || null;
    }

    return path;
}

/**
 * Finds the critical path (longest dependency chain) in the DAG
 *
 * Uses dynamic programming to compute longest path from each node.
 *
 * @param dag - The task DAG
 * @returns Array of task IDs representing the critical path
 */
export function findCriticalPath(dag: TaskDag): string[] {
    if (dag.nodes.size === 0) {
        return [];
    }

    // Get topological order first
    const sortResult = topologicalSort(dag);
    if (!sortResult.success) {
        logger.warn('Cannot find critical path: DAG contains cycle');
        return [];
    }

    // Return the critical path already computed by topologicalSort
    return sortResult.criticalPath;
}

/**
 * Computes statistics about the DAG
 *
 * @param dag - The task DAG
 * @returns DagStats with computed metrics
 */
export function computeDagStats(dag: TaskDag): DagStats {
    let rootCount = 0;
    let leafCount = 0;
    let totalInDegree = 0;
    let totalOutDegree = 0;
    let readyCount = 0;
    let blockedCount = 0;
    let completedCount = 0;

    for (const node of dag.nodes.values()) {
        totalInDegree += node.inDegree;
        totalOutDegree += node.outDegree;

        if (node.inDegree === 0) {
            rootCount++;
        }
        if (node.outDegree === 0) {
            leafCount++;
        }

        if (node.status === 'completed') {
            completedCount++;
        } else if (node.isReady) {
            readyCount++;
        } else {
            blockedCount++;
        }
    }

    const nodeCount = dag.nodes.size;
    const criticalPath = findCriticalPath(dag);

    return {
        nodeCount,
        edgeCount: dag.edges.size,
        rootCount,
        leafCount,
        maxDepth: criticalPath.length,
        averageInDegree: nodeCount > 0 ? totalInDegree / nodeCount : 0,
        averageOutDegree: nodeCount > 0 ? totalOutDegree / nodeCount : 0,
        readyTaskCount: readyCount,
        blockedTaskCount: blockedCount,
        completedTaskCount: completedCount,
    };
}

/**
 * Checks if a task is ready to execute
 *
 * A task is ready if:
 * 1. All its dependencies are completed
 * 2. Its status is 'pending' or 'assigned'
 *
 * @param dag - The task DAG
 * @param taskId - The task to check
 * @returns true if the task is ready
 */
export function isTaskReady(dag: TaskDag, taskId: string): boolean {
    const node = dag.nodes.get(taskId);
    if (!node) {
        return false;
    }

    // Already completed or in progress
    if (node.status === 'completed' || node.status === 'in_progress') {
        return false;
    }

    // Check all dependencies
    for (const depId of node.dependsOn) {
        const depNode = dag.nodes.get(depId);
        if (!depNode || depNode.status !== 'completed') {
            return false;
        }
    }

    return true;
}

/**
 * Gets all tasks that are blocking a specific task
 *
 * @param dag - The task DAG
 * @param taskId - The task to check
 * @returns Array of task IDs that are blocking this task
 */
export function getBlockingTasks(dag: TaskDag, taskId: string): string[] {
    const node = dag.nodes.get(taskId);
    if (!node) {
        return [];
    }

    const blockers: string[] = [];

    for (const depId of node.dependsOn) {
        const depNode = dag.nodes.get(depId);
        if (depNode && depNode.status !== 'completed') {
            blockers.push(depId);
        }
    }

    return blockers;
}

/**
 * Gets all tasks that will be unblocked when a specific task completes
 *
 * @param dag - The task DAG
 * @param taskId - The task that is completing
 * @returns Array of task IDs that may become ready
 */
export function getTasksToUnblock(dag: TaskDag, taskId: string): string[] {
    const dependents = dag.adjacencyList.get(taskId);
    if (!dependents) {
        return [];
    }

    const toUnblock: string[] = [];

    for (const depId of dependents) {
        const depNode = dag.nodes.get(depId);
        if (depNode && depNode.status !== 'completed') {
            // Check if this completion would make the dependent ready
            const blockers = getBlockingTasks(dag, depId);
            // After this task completes, only other blockers remain
            const remainingBlockers = blockers.filter((b) => b !== taskId);
            if (remainingBlockers.length === 0) {
                toUnblock.push(depId);
            }
        }
    }

    return toUnblock;
}
