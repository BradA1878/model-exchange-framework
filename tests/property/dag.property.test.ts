/**
 * Property-based tests for Task DAG algorithms
 * Uses fast-check to verify DAG invariants
 */

import fc from 'fast-check';
import {
    TaskDag,
    TaskDagNode,
    TaskDagEdge,
    TopologicalResult,
} from '@mxf/shared/types/DagTypes';
import { TaskStatus } from '@mxf/shared/types/TaskTypes';
import {
    topologicalSort,
    detectCycle,
    findParallelGroups,
    findCriticalPath,
    computeDagStats,
    isTaskReady,
    getBlockingTasks,
} from '@mxf/shared/services/dag/algorithms/TopologicalSort';

/**
 * Helper to create an empty DAG
 */
function createEmptyDag(channelId: string = 'test'): TaskDag {
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
 * Helper to add a node
 */
function addNode(dag: TaskDag, taskId: string, status: TaskStatus = 'pending'): void {
    dag.nodes.set(taskId, {
        taskId,
        status,
        dependsOn: [],
        blockedBy: [],
        inDegree: 0,
        outDegree: 0,
        isReady: status === 'pending',
        addedAt: Date.now(),
        updatedAt: Date.now(),
    });
    dag.adjacencyList.set(taskId, new Set());
    dag.reverseAdjacencyList.set(taskId, new Set());
}

/**
 * Helper to add an edge (maintaining consistency)
 */
function addEdge(dag: TaskDag, fromId: string, toId: string): void {
    const edgeId = `${fromId}->${toId}`;
    dag.edges.set(edgeId, {
        id: edgeId,
        fromTaskId: fromId,
        toTaskId: toId,
        createdAt: Date.now(),
    });
    dag.adjacencyList.get(fromId)?.add(toId);
    dag.reverseAdjacencyList.get(toId)?.add(fromId);

    const fromNode = dag.nodes.get(fromId);
    const toNode = dag.nodes.get(toId);
    if (fromNode) fromNode.outDegree++;
    if (toNode) {
        toNode.inDegree++;
        toNode.dependsOn.push(fromId);
        toNode.isReady = false;
    }
}

/**
 * Custom arbitrary for generating valid (acyclic) DAGs
 */
function dagArbitrary(maxNodes: number = 20): fc.Arbitrary<TaskDag> {
    return fc.record({
        nodeCount: fc.integer({ min: 0, max: maxNodes }),
        // Generate potential edges as pairs (i, j) where i < j ensures acyclic
        edgeIndices: fc.array(
            fc.tuple(
                fc.integer({ min: 0, max: maxNodes - 1 }),
                fc.integer({ min: 0, max: maxNodes - 1 })
            ),
            { maxLength: maxNodes * 2 }
        ),
    }).map(({ nodeCount, edgeIndices }) => {
        const dag = createEmptyDag();

        // Add nodes
        for (let i = 0; i < nodeCount; i++) {
            addNode(dag, `task-${i}`);
        }

        // Add edges only from lower to higher index (ensures acyclic)
        for (const [from, to] of edgeIndices) {
            if (from < to && from < nodeCount && to < nodeCount) {
                const fromId = `task-${from}`;
                const toId = `task-${to}`;
                // Check edge doesn't already exist
                const edgeId = `${fromId}->${toId}`;
                if (!dag.edges.has(edgeId)) {
                    addEdge(dag, fromId, toId);
                }
            }
        }

        return dag;
    });
}

describe('DAG Property Tests', () => {
    describe('Topological Sort Properties', () => {
        it('topological sort is a valid ordering (all deps come before dependents)', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const result = topologicalSort(dag);

                        if (!result.success) {
                            // If sort failed, DAG must have a cycle
                            const cycleResult = detectCycle(dag);
                            return cycleResult.hasCycle;
                        }

                        // For each edge (A -> B), A must appear before B in the order
                        for (const edge of dag.edges.values()) {
                            const fromIndex = result.order.indexOf(edge.fromTaskId);
                            const toIndex = result.order.indexOf(edge.toTaskId);

                            if (fromIndex === -1 || toIndex === -1) {
                                return false; // Missing node in result
                            }

                            if (fromIndex >= toIndex) {
                                return false; // Dependency comes after dependent
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('topological sort includes all nodes from DAG', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const result = topologicalSort(dag);

                        if (!result.success) {
                            return true; // Cycles are handled separately
                        }

                        return result.order.length === dag.nodes.size;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('ready + blocked + completed = total nodes', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const result = topologicalSort(dag);

                        if (!result.success) {
                            return true;
                        }

                        const totalCounted =
                            result.readyTasks.length +
                            result.blockedTasks.length +
                            result.completedTasks.length;

                        return totalCounted === dag.nodes.size;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Cycle Detection Properties', () => {
        it('valid DAG (edges only from lower to higher index) has no cycle', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const result = detectCycle(dag);
                        // Our dagArbitrary always produces acyclic graphs
                        return !result.hasCycle;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('adding a back edge to valid DAG creates a cycle', () => {
            fc.assert(
                fc.property(
                    dagArbitrary().filter(dag => dag.nodes.size >= 2),
                    (dag) => {
                        // Find a node with dependencies
                        for (const [nodeId, node] of dag.nodes) {
                            if (node.dependsOn.length > 0) {
                                // Create a back edge from the first dependency to this node
                                const depId = node.dependsOn[0];
                                const testEdge: TaskDagEdge = {
                                    id: `${nodeId}->${depId}`,
                                    fromTaskId: nodeId,
                                    toTaskId: depId,
                                    createdAt: Date.now(),
                                };

                                const result = detectCycle(dag, testEdge);
                                // This should create a cycle
                                return result.hasCycle;
                            }
                        }
                        // No suitable edge found, pass
                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Parallel Groups Properties', () => {
        it('tasks in same parallel group have no dependencies on each other', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const groups = findParallelGroups(dag);

                        for (const group of groups) {
                            for (let i = 0; i < group.length; i++) {
                                const nodeA = dag.nodes.get(group[i]);
                                for (let j = i + 1; j < group.length; j++) {
                                    const nodeB = dag.nodes.get(group[j]);

                                    // Check A doesn't depend on B
                                    if (nodeA?.dependsOn.includes(group[j])) {
                                        return false;
                                    }

                                    // Check B doesn't depend on A
                                    if (nodeB?.dependsOn.includes(group[i])) {
                                        return false;
                                    }
                                }
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('all non-completed tasks appear in exactly one parallel group', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const groups = findParallelGroups(dag);
                        const allGroupedTasks = groups.flat();

                        // Count non-completed tasks
                        let nonCompletedCount = 0;
                        for (const node of dag.nodes.values()) {
                            if (node.status !== 'completed') {
                                nonCompletedCount++;
                            }
                        }

                        // Should have same count
                        if (allGroupedTasks.length !== nonCompletedCount) {
                            return false;
                        }

                        // No duplicates
                        const seen = new Set<string>();
                        for (const taskId of allGroupedTasks) {
                            if (seen.has(taskId)) {
                                return false;
                            }
                            seen.add(taskId);
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Critical Path Properties', () => {
        it('critical path length <= total number of nodes', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const path = findCriticalPath(dag);
                        return path.length <= dag.nodes.size;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('critical path is a valid path through the DAG', () => {
            fc.assert(
                fc.property(
                    dagArbitrary().filter(dag => dag.nodes.size > 0),
                    (dag) => {
                        const path = findCriticalPath(dag);

                        if (path.length <= 1) {
                            return true; // Single node or empty path is trivially valid
                        }

                        // Check each consecutive pair is connected by an edge
                        for (let i = 0; i < path.length - 1; i++) {
                            const from = path[i];
                            const to = path[i + 1];
                            const neighbors = dag.adjacencyList.get(from);

                            if (!neighbors || !neighbors.has(to)) {
                                return false; // No edge between consecutive nodes
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('critical path matches DAG stats max depth', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const path = findCriticalPath(dag);
                        const stats = computeDagStats(dag);

                        return path.length === stats.maxDepth;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('DAG Statistics Properties', () => {
        it('edge count matches sum of out-degrees / 2 (or exact count)', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const stats = computeDagStats(dag);
                        return stats.edgeCount === dag.edges.size;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('node count matches actual node count', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const stats = computeDagStats(dag);
                        return stats.nodeCount === dag.nodes.size;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('ready + blocked + completed = nodeCount', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const stats = computeDagStats(dag);
                        const total = stats.readyTaskCount + stats.blockedTaskCount + stats.completedTaskCount;
                        return total === stats.nodeCount;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('average degrees are non-negative', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        const stats = computeDagStats(dag);
                        return stats.averageInDegree >= 0 && stats.averageOutDegree >= 0;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Task Ready State Properties', () => {
        it('task with no dependencies is always ready (if pending)', () => {
            fc.assert(
                fc.property(
                    dagArbitrary().filter(dag => dag.nodes.size > 0),
                    (dag) => {
                        // Find a root node (no dependencies)
                        for (const [taskId, node] of dag.nodes) {
                            if (node.inDegree === 0 && node.status === 'pending') {
                                return isTaskReady(dag, taskId);
                            }
                        }
                        return true; // No suitable node found
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('task with incomplete dependencies is not ready', () => {
            fc.assert(
                fc.property(
                    dagArbitrary().filter(dag => dag.edges.size > 0),
                    (dag) => {
                        // Find a node with dependencies
                        for (const [taskId, node] of dag.nodes) {
                            if (node.inDegree > 0 && node.status === 'pending') {
                                // Check if all dependencies are incomplete
                                const allDepsIncomplete = node.dependsOn.every(depId => {
                                    const depNode = dag.nodes.get(depId);
                                    return depNode && depNode.status !== 'completed';
                                });

                                if (allDepsIncomplete) {
                                    return !isTaskReady(dag, taskId);
                                }
                            }
                        }
                        return true; // No suitable node found
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Blocking Tasks Properties', () => {
        it('blocking tasks are a subset of dependsOn', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    (dag) => {
                        for (const [taskId, node] of dag.nodes) {
                            const blockers = getBlockingTasks(dag, taskId);

                            // Every blocker should be in dependsOn
                            for (const blockerId of blockers) {
                                if (!node.dependsOn.includes(blockerId)) {
                                    return false;
                                }
                            }
                        }
                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('completed dependencies are not blocking', () => {
            fc.assert(
                fc.property(
                    dagArbitrary(),
                    fc.integer({ min: 0, max: 10 }),
                    (dag, completedCount) => {
                        // Mark some nodes as completed
                        let marked = 0;
                        for (const node of dag.nodes.values()) {
                            if (marked < completedCount) {
                                node.status = 'completed';
                                marked++;
                            }
                        }

                        // Check blocking tasks
                        for (const [taskId] of dag.nodes) {
                            const blockers = getBlockingTasks(dag, taskId);

                            for (const blockerId of blockers) {
                                const blockerNode = dag.nodes.get(blockerId);
                                if (blockerNode?.status === 'completed') {
                                    return false; // Completed task shouldn't be blocking
                                }
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });
});
