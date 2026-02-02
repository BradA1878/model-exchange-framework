/**
 * Unit tests for TopologicalSort algorithms
 * Tests topological sorting, cycle detection, parallel groups, and critical path
 */

import {
    topologicalSort,
    detectCycle,
    findParallelGroups,
    findCriticalPath,
    computeDagStats,
    isTaskReady,
    getBlockingTasks,
    getTasksToUnblock,
} from '@mxf/shared/services/dag/algorithms/TopologicalSort';
import {
    TaskDag,
    TaskDagNode,
    TaskDagEdge,
} from '@mxf/shared/types/DagTypes';
import { TaskStatus } from '@mxf/shared/types/TaskTypes';

/**
 * Helper to create a TaskDag for testing
 */
function createTestDag(channelId: string = 'test-channel'): TaskDag {
    return {
        channelId,
        nodes: new Map(),
        edges: new Map(),
        adjacencyList: new Map(),
        reverseAdjacencyList: new Map(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
    };
}

/**
 * Helper to add a node to the DAG
 * Note: Use addEdge() to create actual edges. The dependsOn parameter is ignored;
 * all edges should be created explicitly with addEdge() for proper degree tracking.
 */
function addNode(
    dag: TaskDag,
    taskId: string,
    status: TaskStatus = 'pending',
    _dependsOn: string[] = [] // Ignored - use addEdge instead
): TaskDagNode {
    const node: TaskDagNode = {
        taskId,
        status,
        dependsOn: [],
        blockedBy: [],
        inDegree: 0,
        outDegree: 0,
        isReady: status === 'pending',
        addedAt: Date.now(),
        updatedAt: Date.now(),
    };
    dag.nodes.set(taskId, node);
    dag.adjacencyList.set(taskId, new Set());
    dag.reverseAdjacencyList.set(taskId, new Set());
    return node;
}

/**
 * Helper to add an edge to the DAG
 */
function addEdge(dag: TaskDag, fromTaskId: string, toTaskId: string): TaskDagEdge {
    const edgeId = `${fromTaskId}->${toTaskId}`;
    const edge: TaskDagEdge = {
        id: edgeId,
        fromTaskId,
        toTaskId,
        createdAt: Date.now(),
    };
    dag.edges.set(edgeId, edge);
    dag.adjacencyList.get(fromTaskId)?.add(toTaskId);
    dag.reverseAdjacencyList.get(toTaskId)?.add(fromTaskId);

    // Update degrees
    const fromNode = dag.nodes.get(fromTaskId);
    const toNode = dag.nodes.get(toTaskId);
    if (fromNode) fromNode.outDegree++;
    if (toNode) {
        toNode.inDegree++;
        // Only add to dependsOn if not already there (avoid duplicates)
        if (!toNode.dependsOn.includes(fromTaskId)) {
            toNode.dependsOn.push(fromTaskId);
        }
        // Update isReady: a node with dependencies is not ready unless all deps are completed
        toNode.isReady = false;
    }

    return edge;
}

describe('TopologicalSort', () => {
    describe('topologicalSort', () => {
        it('returns empty result for empty DAG', () => {
            const dag = createTestDag();
            const result = topologicalSort(dag);

            expect(result.success).toBe(true);
            expect(result.order).toEqual([]);
            expect(result.levels).toEqual([]);
        });

        it('returns single node for single-node DAG', () => {
            const dag = createTestDag();
            addNode(dag, 'task-1');

            const result = topologicalSort(dag);

            expect(result.success).toBe(true);
            expect(result.order).toEqual(['task-1']);
            expect(result.levels).toEqual([['task-1']]);
        });

        it('returns correct order for linear chain', () => {
            const dag = createTestDag();
            addNode(dag, 'task-1');
            addNode(dag, 'task-2', 'pending', ['task-1']);
            addNode(dag, 'task-3', 'pending', ['task-2']);
            addEdge(dag, 'task-1', 'task-2');
            addEdge(dag, 'task-2', 'task-3');

            const result = topologicalSort(dag);

            expect(result.success).toBe(true);
            expect(result.order).toEqual(['task-1', 'task-2', 'task-3']);
            expect(result.levels.length).toBe(3);
        });

        it('returns correct order for diamond DAG', () => {
            // Diamond: A -> B, A -> C, B -> D, C -> D
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['A']);
            addNode(dag, 'D', 'pending', ['B', 'C']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'A', 'C');
            addEdge(dag, 'B', 'D');
            addEdge(dag, 'C', 'D');

            const result = topologicalSort(dag);

            expect(result.success).toBe(true);
            expect(result.order.indexOf('A')).toBeLessThan(result.order.indexOf('B'));
            expect(result.order.indexOf('A')).toBeLessThan(result.order.indexOf('C'));
            expect(result.order.indexOf('B')).toBeLessThan(result.order.indexOf('D'));
            expect(result.order.indexOf('C')).toBeLessThan(result.order.indexOf('D'));
        });

        it('identifies ready tasks correctly', () => {
            const dag = createTestDag();
            addNode(dag, 'task-1');
            addNode(dag, 'task-2');
            addNode(dag, 'task-3', 'pending', ['task-1']);
            addEdge(dag, 'task-1', 'task-3');

            const result = topologicalSort(dag);

            expect(result.success).toBe(true);
            expect(result.readyTasks).toContain('task-1');
            expect(result.readyTasks).toContain('task-2');
            expect(result.readyTasks).not.toContain('task-3');
        });

        it('identifies blocked tasks correctly', () => {
            const dag = createTestDag();
            addNode(dag, 'task-1');
            const task2 = addNode(dag, 'task-2', 'pending', ['task-1']);
            task2.isReady = false; // Blocked by task-1
            addEdge(dag, 'task-1', 'task-2');

            const result = topologicalSort(dag);

            expect(result.success).toBe(true);
            expect(result.blockedTasks).toContain('task-2');
        });

        it('identifies completed tasks correctly', () => {
            const dag = createTestDag();
            addNode(dag, 'task-1', 'completed');
            addNode(dag, 'task-2', 'pending', ['task-1']);
            addEdge(dag, 'task-1', 'task-2');

            const result = topologicalSort(dag);

            expect(result.success).toBe(true);
            expect(result.completedTasks).toContain('task-1');
        });

        it('fails for cyclic graph (A -> B -> C -> A)', () => {
            const dag = createTestDag();
            addNode(dag, 'A', 'pending', ['C']);
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['B']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'B', 'C');
            addEdge(dag, 'C', 'A');

            const result = topologicalSort(dag);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error).toContain('Cycle detected');
        });
    });

    describe('detectCycle', () => {
        it('returns false for empty DAG', () => {
            const dag = createTestDag();
            const result = detectCycle(dag);

            expect(result.hasCycle).toBe(false);
        });

        it('returns false for single node', () => {
            const dag = createTestDag();
            addNode(dag, 'task-1');

            const result = detectCycle(dag);

            expect(result.hasCycle).toBe(false);
        });

        it('returns false for valid linear chain', () => {
            const dag = createTestDag();
            addNode(dag, 'task-1');
            addNode(dag, 'task-2', 'pending', ['task-1']);
            addNode(dag, 'task-3', 'pending', ['task-2']);
            addEdge(dag, 'task-1', 'task-2');
            addEdge(dag, 'task-2', 'task-3');

            const result = detectCycle(dag);

            expect(result.hasCycle).toBe(false);
        });

        it('returns true for simple cycle (A -> B -> A)', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'B', 'A');

            const result = detectCycle(dag);

            expect(result.hasCycle).toBe(true);
            expect(result.cyclePath).toBeDefined();
        });

        it('returns true for 3-node cycle (A -> B -> C -> A)', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['B']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'B', 'C');
            addEdge(dag, 'C', 'A');

            const result = detectCycle(dag);

            expect(result.hasCycle).toBe(true);
            expect(result.cyclePath).toBeDefined();
            expect(result.cycleDescription).toBeDefined();
        });

        it('detects cycle when testing new edge', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addEdge(dag, 'A', 'B');

            // Test adding edge B -> A (would create cycle)
            const testEdge: TaskDagEdge = {
                id: 'B->A',
                fromTaskId: 'B',
                toTaskId: 'A',
                createdAt: Date.now(),
            };

            const result = detectCycle(dag, testEdge);

            expect(result.hasCycle).toBe(true);
        });

        it('does not detect cycle for valid new edge', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B');
            addNode(dag, 'C');
            addEdge(dag, 'A', 'B');

            // Test adding edge B -> C (valid)
            const testEdge: TaskDagEdge = {
                id: 'B->C',
                fromTaskId: 'B',
                toTaskId: 'C',
                createdAt: Date.now(),
            };

            const result = detectCycle(dag, testEdge);

            expect(result.hasCycle).toBe(false);
        });
    });

    describe('findParallelGroups', () => {
        it('returns empty array for empty DAG', () => {
            const dag = createTestDag();
            const groups = findParallelGroups(dag);

            expect(groups).toEqual([]);
        });

        it('returns single group for independent tasks', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B');
            addNode(dag, 'C');

            const groups = findParallelGroups(dag);

            expect(groups.length).toBe(1);
            expect(groups[0].sort()).toEqual(['A', 'B', 'C']);
        });

        it('returns multiple groups for dependent tasks', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B');
            addNode(dag, 'C', 'pending', ['A']);
            addNode(dag, 'D', 'pending', ['B']);
            addEdge(dag, 'A', 'C');
            addEdge(dag, 'B', 'D');

            const groups = findParallelGroups(dag);

            expect(groups.length).toBe(2);
            // First group: A and B (no dependencies)
            expect(groups[0].sort()).toEqual(['A', 'B']);
            // Second group: C and D (depend on first group)
            expect(groups[1].sort()).toEqual(['C', 'D']);
        });

        it('excludes completed tasks from groups', () => {
            const dag = createTestDag();
            addNode(dag, 'A', 'completed');
            addNode(dag, 'B');
            addNode(dag, 'C', 'pending', ['A']);
            addEdge(dag, 'A', 'C');

            const groups = findParallelGroups(dag);

            // A is completed, so only B and C remain
            const allTasks = groups.flat();
            expect(allTasks).not.toContain('A');
        });

        it('returns empty for cyclic graph', () => {
            const dag = createTestDag();
            addNode(dag, 'A', 'pending', ['B']);
            addNode(dag, 'B', 'pending', ['A']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'B', 'A');

            const groups = findParallelGroups(dag);

            expect(groups).toEqual([]);
        });
    });

    describe('findCriticalPath', () => {
        it('returns empty array for empty DAG', () => {
            const dag = createTestDag();
            const path = findCriticalPath(dag);

            expect(path).toEqual([]);
        });

        it('returns single node for single-node DAG', () => {
            const dag = createTestDag();
            addNode(dag, 'A');

            const path = findCriticalPath(dag);

            expect(path).toEqual(['A']);
        });

        it('returns full chain for linear graph', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['B']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'B', 'C');

            const path = findCriticalPath(dag);

            expect(path).toEqual(['A', 'B', 'C']);
        });

        it('returns longest path for diamond graph', () => {
            // A -> B -> D (length 3)
            // A -> C -> D (length 3)
            // Both paths are the same length
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['A']);
            addNode(dag, 'D', 'pending', ['B', 'C']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'A', 'C');
            addEdge(dag, 'B', 'D');
            addEdge(dag, 'C', 'D');

            const path = findCriticalPath(dag);

            expect(path.length).toBe(3);
            expect(path[0]).toBe('A');
            expect(path[2]).toBe('D');
        });

        it('finds longest path with multiple branches', () => {
            // A -> B -> C -> D (length 4) - longest
            // A -> E (length 2) - shorter
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['B']);
            addNode(dag, 'D', 'pending', ['C']);
            addNode(dag, 'E', 'pending', ['A']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'B', 'C');
            addEdge(dag, 'C', 'D');
            addEdge(dag, 'A', 'E');

            const path = findCriticalPath(dag);

            expect(path).toEqual(['A', 'B', 'C', 'D']);
        });
    });

    describe('computeDagStats', () => {
        it('returns zero stats for empty DAG', () => {
            const dag = createTestDag();
            const stats = computeDagStats(dag);

            expect(stats.nodeCount).toBe(0);
            expect(stats.edgeCount).toBe(0);
            expect(stats.rootCount).toBe(0);
            expect(stats.leafCount).toBe(0);
        });

        it('counts nodes and edges correctly', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['A']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'A', 'C');

            const stats = computeDagStats(dag);

            expect(stats.nodeCount).toBe(3);
            expect(stats.edgeCount).toBe(2);
        });

        it('counts roots and leaves correctly', () => {
            const dag = createTestDag();
            addNode(dag, 'A'); // root
            addNode(dag, 'B'); // root
            addNode(dag, 'C', 'pending', ['A']); // leaf
            addNode(dag, 'D', 'pending', ['B']); // leaf
            addEdge(dag, 'A', 'C');
            addEdge(dag, 'B', 'D');

            const stats = computeDagStats(dag);

            expect(stats.rootCount).toBe(2);
            expect(stats.leafCount).toBe(2);
        });

        it('calculates max depth correctly', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['B']);
            addNode(dag, 'D', 'pending', ['C']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'B', 'C');
            addEdge(dag, 'C', 'D');

            const stats = computeDagStats(dag);

            expect(stats.maxDepth).toBe(4);
        });

        it('tracks task status counts', () => {
            const dag = createTestDag();
            addNode(dag, 'A', 'completed');
            addNode(dag, 'B'); // ready
            const nodeC = addNode(dag, 'C', 'pending', ['A']);
            nodeC.isReady = false; // blocked

            const stats = computeDagStats(dag);

            expect(stats.completedTaskCount).toBe(1);
            expect(stats.readyTaskCount).toBe(1);
            expect(stats.blockedTaskCount).toBe(1);
        });
    });

    describe('isTaskReady', () => {
        it('returns false for non-existent task', () => {
            const dag = createTestDag();
            expect(isTaskReady(dag, 'non-existent')).toBe(false);
        });

        it('returns true for task with no dependencies', () => {
            const dag = createTestDag();
            addNode(dag, 'A');

            expect(isTaskReady(dag, 'A')).toBe(true);
        });

        it('returns false for task with incomplete dependencies', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addEdge(dag, 'A', 'B');

            expect(isTaskReady(dag, 'B')).toBe(false);
        });

        it('returns true for task with all completed dependencies', () => {
            const dag = createTestDag();
            addNode(dag, 'A', 'completed');
            addNode(dag, 'B', 'pending', ['A']);
            addEdge(dag, 'A', 'B');

            expect(isTaskReady(dag, 'B')).toBe(true);
        });

        it('returns false for completed task', () => {
            const dag = createTestDag();
            addNode(dag, 'A', 'completed');

            expect(isTaskReady(dag, 'A')).toBe(false);
        });

        it('returns false for in-progress task', () => {
            const dag = createTestDag();
            addNode(dag, 'A', 'in_progress');

            expect(isTaskReady(dag, 'A')).toBe(false);
        });
    });

    describe('getBlockingTasks', () => {
        it('returns empty array for non-existent task', () => {
            const dag = createTestDag();
            expect(getBlockingTasks(dag, 'non-existent')).toEqual([]);
        });

        it('returns empty array for task with no dependencies', () => {
            const dag = createTestDag();
            addNode(dag, 'A');

            expect(getBlockingTasks(dag, 'A')).toEqual([]);
        });

        it('returns incomplete dependencies', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addEdge(dag, 'A', 'B');

            expect(getBlockingTasks(dag, 'B')).toEqual(['A']);
        });

        it('excludes completed dependencies', () => {
            const dag = createTestDag();
            addNode(dag, 'A', 'completed');
            addNode(dag, 'B');
            addNode(dag, 'C', 'pending', ['A', 'B']);
            addEdge(dag, 'A', 'C');
            addEdge(dag, 'B', 'C');

            const blockers = getBlockingTasks(dag, 'C');
            expect(blockers).toEqual(['B']);
        });

        it('returns all incomplete dependencies', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B');
            addNode(dag, 'C', 'pending', ['A', 'B']);
            addEdge(dag, 'A', 'C');
            addEdge(dag, 'B', 'C');

            const blockers = getBlockingTasks(dag, 'C');
            expect(blockers.sort()).toEqual(['A', 'B']);
        });
    });

    describe('getTasksToUnblock', () => {
        it('returns empty array for non-existent task', () => {
            const dag = createTestDag();
            expect(getTasksToUnblock(dag, 'non-existent')).toEqual([]);
        });

        it('returns empty array for task with no dependents', () => {
            const dag = createTestDag();
            addNode(dag, 'A');

            expect(getTasksToUnblock(dag, 'A')).toEqual([]);
        });

        it('returns task that will become ready', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addEdge(dag, 'A', 'B');

            const toUnblock = getTasksToUnblock(dag, 'A');
            expect(toUnblock).toEqual(['B']);
        });

        it('does not return task that still has other blockers', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B');
            addNode(dag, 'C', 'pending', ['A', 'B']);
            addEdge(dag, 'A', 'C');
            addEdge(dag, 'B', 'C');

            // Completing A won't unblock C because B is still incomplete
            const toUnblock = getTasksToUnblock(dag, 'A');
            expect(toUnblock).toEqual([]);
        });

        it('returns multiple tasks that become ready', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'pending', ['A']);
            addNode(dag, 'C', 'pending', ['A']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'A', 'C');

            const toUnblock = getTasksToUnblock(dag, 'A');
            expect(toUnblock.sort()).toEqual(['B', 'C']);
        });

        it('excludes already completed tasks', () => {
            const dag = createTestDag();
            addNode(dag, 'A');
            addNode(dag, 'B', 'completed', ['A']);
            addNode(dag, 'C', 'pending', ['A']);
            addEdge(dag, 'A', 'B');
            addEdge(dag, 'A', 'C');

            const toUnblock = getTasksToUnblock(dag, 'A');
            expect(toUnblock).toEqual(['C']);
        });
    });

    describe('Performance', () => {
        it('handles 1000 nodes in under 50ms', () => {
            const dag = createTestDag();

            // Create a chain of 1000 nodes
            for (let i = 0; i < 1000; i++) {
                const deps = i > 0 ? [`task-${i - 1}`] : [];
                addNode(dag, `task-${i}`, 'pending', deps);
                if (i > 0) {
                    addEdge(dag, `task-${i - 1}`, `task-${i}`);
                }
            }

            const startTime = performance.now();
            const result = detectCycle(dag);
            const elapsed = performance.now() - startTime;

            expect(result.hasCycle).toBe(false);
            expect(elapsed).toBeLessThan(50);
        });

        it('handles wide DAG (1000 independent nodes) efficiently', () => {
            const dag = createTestDag();

            // Create 1000 independent nodes
            for (let i = 0; i < 1000; i++) {
                addNode(dag, `task-${i}`);
            }

            const startTime = performance.now();
            const result = topologicalSort(dag);
            const elapsed = performance.now() - startTime;

            expect(result.success).toBe(true);
            expect(result.order.length).toBe(1000);
            expect(elapsed).toBeLessThan(50);
        });
    });
});
