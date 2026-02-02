/**
 * Unit tests for TaskDagService
 * Tests DAG building, dependency management, and cache operations
 */

import { TaskDagService } from '@mxf/shared/services/dag/TaskDagService';
import { resetDagConfig, updateDagConfig } from '@mxf/shared/config/dag.config';
import { ChannelTask, TaskStatus } from '@mxf/shared/types/TaskTypes';
import { DagErrorCode } from '@mxf/shared/types/DagTypes';

/**
 * Helper to create a test task
 */
function createTestTask(
    id: string,
    status: TaskStatus = 'pending',
    dependsOn: string[] = []
): ChannelTask {
    return {
        id,
        channelId: 'test-channel',
        title: `Test Task ${id}`,
        description: `Description for ${id}`,
        status,
        priority: 'medium',
        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        dependsOn,
        blockedBy: [],
        createdBy: 'system',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

describe('TaskDagService', () => {
    let service: TaskDagService;
    const channelId = 'test-channel';

    beforeEach(() => {
        // Reset config and enable DAG
        resetDagConfig();
        updateDagConfig({
            enabled: true,
            emitEvents: false, // Disable events for unit tests
        });

        // Get fresh service instance
        service = TaskDagService.getInstance();
        service.clearAllCaches();
    });

    afterEach(() => {
        resetDagConfig();
    });

    describe('buildDag', () => {
        it('builds DAG from empty task list', () => {
            const dag = service.buildDag(channelId, []);

            expect(dag).toBeDefined();
            expect(dag.channelId).toBe(channelId);
            expect(dag.nodes.size).toBe(0);
            expect(dag.edges.size).toBe(0);
        });

        it('builds DAG with single task', () => {
            const tasks = [createTestTask('task-1')];
            const dag = service.buildDag(channelId, tasks);

            expect(dag.nodes.size).toBe(1);
            expect(dag.nodes.has('task-1')).toBe(true);
            expect(dag.edges.size).toBe(0);
        });

        it('builds DAG with dependencies', () => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
                createTestTask('task-3', 'pending', ['task-1', 'task-2']),
            ];
            const dag = service.buildDag(channelId, tasks);

            expect(dag.nodes.size).toBe(3);
            expect(dag.edges.size).toBe(3); // task-1->task-2, task-1->task-3, task-2->task-3

            const task2Node = dag.nodes.get('task-2');
            expect(task2Node?.inDegree).toBe(1);
            expect(task2Node?.dependsOn).toContain('task-1');
        });

        it('ignores dependencies to non-existent tasks', () => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['non-existent']),
            ];
            const dag = service.buildDag(channelId, tasks);

            expect(dag.nodes.size).toBe(2);
            // Edge to non-existent task should not be created
            expect(dag.edges.size).toBe(0);
        });

        it('sets correct ready status', () => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
            ];
            const dag = service.buildDag(channelId, tasks);

            const task1Node = dag.nodes.get('task-1');
            const task2Node = dag.nodes.get('task-2');

            expect(task1Node?.isReady).toBe(true);
            expect(task2Node?.isReady).toBe(false);
        });

        it('caches the built DAG', () => {
            const tasks = [createTestTask('task-1')];
            service.buildDag(channelId, tasks);

            const cachedDag = service.getDag(channelId);
            expect(cachedDag).toBeDefined();
            expect(cachedDag?.nodes.size).toBe(1);
        });
    });

    describe('addDependency', () => {
        beforeEach(() => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2'),
                createTestTask('task-3'),
            ];
            service.buildDag(channelId, tasks);
        });

        it('adds valid dependency', async () => {
            const result = await service.addDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            expect(result.success).toBe(true);
            expect(result.edge).toBeDefined();
            expect(result.edge?.fromTaskId).toBe('task-1');
            expect(result.edge?.toTaskId).toBe('task-2');
        });

        it('fails for non-existent DAG', async () => {
            const result = await service.addDependency('non-existent-channel', {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('No DAG found');
        });

        it('fails for non-existent dependent task', async () => {
            const result = await service.addDependency(channelId, {
                dependentTaskId: 'non-existent',
                dependencyTaskId: 'task-1',
            });

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe(DagErrorCode.MISSING_NODE);
        });

        it('fails for non-existent dependency task', async () => {
            const result = await service.addDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'non-existent',
            });

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe(DagErrorCode.MISSING_NODE);
        });

        it('fails for self-dependency', async () => {
            const result = await service.addDependency(channelId, {
                dependentTaskId: 'task-1',
                dependencyTaskId: 'task-1',
            });

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe(DagErrorCode.SELF_DEPENDENCY);
        });

        it('fails for duplicate dependency', async () => {
            await service.addDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            const result = await service.addDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe(DagErrorCode.DUPLICATE_EDGE);
        });

        it('fails for dependency that would create cycle', async () => {
            await service.addDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            // Try to add task-1 depends on task-2 (would create cycle)
            const result = await service.addDependency(channelId, {
                dependentTaskId: 'task-1',
                dependencyTaskId: 'task-2',
            });

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe(DagErrorCode.CYCLE_DETECTED);
            expect(result.cyclePath).toBeDefined();
        });

        it('updates node degrees after adding dependency', async () => {
            await service.addDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            const dag = service.getDag(channelId);
            const task1Node = dag?.nodes.get('task-1');
            const task2Node = dag?.nodes.get('task-2');

            expect(task1Node?.outDegree).toBe(1);
            expect(task2Node?.inDegree).toBe(1);
        });

        it('updates ready status after adding dependency', async () => {
            // Initially task-2 should be ready
            let dag = service.getDag(channelId);
            expect(dag?.nodes.get('task-2')?.isReady).toBe(true);

            // Add dependency
            await service.addDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            // Now task-2 should not be ready
            dag = service.getDag(channelId);
            expect(dag?.nodes.get('task-2')?.isReady).toBe(false);
        });

        it('increments DAG version', async () => {
            const dagBefore = service.getDag(channelId);
            const versionBefore = dagBefore?.version ?? 0;

            await service.addDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            const dagAfter = service.getDag(channelId);
            expect(dagAfter?.version).toBe(versionBefore + 1);
        });
    });

    describe('removeDependency', () => {
        beforeEach(() => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
            ];
            service.buildDag(channelId, tasks);
        });

        it('removes existing dependency', async () => {
            const result = await service.removeDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            expect(result).toBe(true);

            const dag = service.getDag(channelId);
            expect(dag?.edges.size).toBe(0);
        });

        it('returns false for non-existent DAG', async () => {
            const result = await service.removeDependency('non-existent', {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            expect(result).toBe(false);
        });

        it('returns false for non-existent dependency', async () => {
            const result = await service.removeDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-3',
            });

            expect(result).toBe(false);
        });

        it('updates node degrees after removal', async () => {
            await service.removeDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            const dag = service.getDag(channelId);
            const task1Node = dag?.nodes.get('task-1');
            const task2Node = dag?.nodes.get('task-2');

            expect(task1Node?.outDegree).toBe(0);
            expect(task2Node?.inDegree).toBe(0);
        });

        it('updates ready status after removal', async () => {
            await service.removeDependency(channelId, {
                dependentTaskId: 'task-2',
                dependencyTaskId: 'task-1',
            });

            const dag = service.getDag(channelId);
            expect(dag?.nodes.get('task-2')?.isReady).toBe(true);
        });
    });

    describe('addTask', () => {
        it('adds task to existing DAG', () => {
            const tasks = [createTestTask('task-1')];
            service.buildDag(channelId, tasks);

            const newTask = createTestTask('task-2');
            service.addTask(channelId, newTask);

            const dag = service.getDag(channelId);
            expect(dag?.nodes.size).toBe(2);
            expect(dag?.nodes.has('task-2')).toBe(true);
        });

        it('creates new DAG if none exists', () => {
            const task = createTestTask('task-1');
            service.addTask(channelId, task);

            const dag = service.getDag(channelId);
            expect(dag).toBeDefined();
            expect(dag?.nodes.size).toBe(1);
        });

        it('adds edges for dependencies', () => {
            const tasks = [createTestTask('task-1')];
            service.buildDag(channelId, tasks);

            const newTask = createTestTask('task-2', 'pending', ['task-1']);
            service.addTask(channelId, newTask);

            const dag = service.getDag(channelId);
            expect(dag?.edges.size).toBe(1);
        });
    });

    describe('removeTask', () => {
        beforeEach(() => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
                createTestTask('task-3', 'pending', ['task-2']),
            ];
            service.buildDag(channelId, tasks);
        });

        it('removes task from DAG', () => {
            service.removeTask(channelId, 'task-2');

            const dag = service.getDag(channelId);
            expect(dag?.nodes.size).toBe(2);
            expect(dag?.nodes.has('task-2')).toBe(false);
        });

        it('removes associated edges', () => {
            service.removeTask(channelId, 'task-2');

            const dag = service.getDag(channelId);
            // task-1->task-2 and task-2->task-3 should be removed
            expect(dag?.edges.size).toBe(0);
        });

        it('does nothing for non-existent task', () => {
            const dagBefore = service.getDag(channelId);
            const nodeCountBefore = dagBefore?.nodes.size ?? 0;

            service.removeTask(channelId, 'non-existent');

            const dagAfter = service.getDag(channelId);
            expect(dagAfter?.nodes.size).toBe(nodeCountBefore);
        });
    });

    describe('updateTaskStatus', () => {
        beforeEach(() => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
            ];
            service.buildDag(channelId, tasks);
        });

        it('updates task status in node', () => {
            service.updateTaskStatus(channelId, 'task-1', 'in_progress');

            const dag = service.getDag(channelId);
            expect(dag?.nodes.get('task-1')?.status).toBe('in_progress');
        });

        it('updates ready status of dependents when completed', () => {
            // task-2 should not be ready initially
            let dag = service.getDag(channelId);
            expect(dag?.nodes.get('task-2')?.isReady).toBe(false);

            // Complete task-1
            service.updateTaskStatus(channelId, 'task-1', 'completed');

            // task-2 should now be ready
            dag = service.getDag(channelId);
            expect(dag?.nodes.get('task-2')?.isReady).toBe(true);
        });

        it('does nothing for non-existent channel', () => {
            // Should not throw
            service.updateTaskStatus('non-existent', 'task-1', 'completed');
        });

        it('does nothing for non-existent task', () => {
            // Should not throw
            service.updateTaskStatus(channelId, 'non-existent', 'completed');
        });
    });

    describe('isTaskReady', () => {
        beforeEach(() => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
            ];
            service.buildDag(channelId, tasks);
        });

        it('returns true for task with no dependencies', () => {
            expect(service.isTaskReady(channelId, 'task-1')).toBe(true);
        });

        it('returns false for task with incomplete dependencies', () => {
            expect(service.isTaskReady(channelId, 'task-2')).toBe(false);
        });

        it('returns true when no DAG exists', () => {
            // If no DAG, assume task is ready
            expect(service.isTaskReady('non-existent', 'task-1')).toBe(true);
        });
    });

    describe('getBlockingTasks', () => {
        beforeEach(() => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2'),
                createTestTask('task-3', 'pending', ['task-1', 'task-2']),
            ];
            service.buildDag(channelId, tasks);
        });

        it('returns blocking tasks', () => {
            const blockers = service.getBlockingTasks(channelId, 'task-3');
            expect(blockers.sort()).toEqual(['task-1', 'task-2']);
        });

        it('returns empty array for no blockers', () => {
            const blockers = service.getBlockingTasks(channelId, 'task-1');
            expect(blockers).toEqual([]);
        });

        it('returns empty array for non-existent channel', () => {
            const blockers = service.getBlockingTasks('non-existent', 'task-1');
            expect(blockers).toEqual([]);
        });
    });

    describe('getReadyTasks', () => {
        beforeEach(() => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2'),
                createTestTask('task-3', 'pending', ['task-1']),
            ];
            service.buildDag(channelId, tasks);
        });

        it('returns ready tasks', () => {
            const ready = service.getReadyTasks(channelId);
            expect(ready.sort()).toEqual(['task-1', 'task-2']);
        });

        it('respects limit option', () => {
            const ready = service.getReadyTasks(channelId, { limit: 1 });
            expect(ready.length).toBe(1);
        });

        it('respects taskIds filter', () => {
            const ready = service.getReadyTasks(channelId, { taskIds: ['task-1'] });
            expect(ready).toEqual(['task-1']);
        });

        it('returns empty array for non-existent channel', () => {
            const ready = service.getReadyTasks('non-existent');
            expect(ready).toEqual([]);
        });
    });

    describe('getExecutionOrder', () => {
        beforeEach(() => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
                createTestTask('task-3', 'pending', ['task-2']),
            ];
            service.buildDag(channelId, tasks);
        });

        it('returns topologically sorted order', () => {
            const order = service.getExecutionOrder(channelId);
            expect(order).toEqual(['task-1', 'task-2', 'task-3']);
        });

        it('excludes completed tasks by default', () => {
            service.updateTaskStatus(channelId, 'task-1', 'completed');
            const order = service.getExecutionOrder(channelId);
            expect(order).not.toContain('task-1');
        });

        it('includes completed tasks when specified', () => {
            service.updateTaskStatus(channelId, 'task-1', 'completed');
            const order = service.getExecutionOrder(channelId, { includeCompleted: true });
            expect(order).toContain('task-1');
        });
    });

    describe('getParallelGroups', () => {
        it('returns parallel execution groups', () => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2'),
                createTestTask('task-3', 'pending', ['task-1', 'task-2']),
            ];
            service.buildDag(channelId, tasks);

            const groups = service.getParallelGroups(channelId);
            expect(groups.length).toBe(2);
            expect(groups[0].sort()).toEqual(['task-1', 'task-2']);
            expect(groups[1]).toEqual(['task-3']);
        });
    });

    describe('getCriticalPath', () => {
        it('returns critical path', () => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
                createTestTask('task-3', 'pending', ['task-2']),
            ];
            service.buildDag(channelId, tasks);

            const path = service.getCriticalPath(channelId);
            expect(path).toEqual(['task-1', 'task-2', 'task-3']);
        });
    });

    describe('validateDag', () => {
        it('returns valid for acyclic DAG', () => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
            ];
            service.buildDag(channelId, tasks);

            const result = service.validateDag(channelId);
            expect(result.isValid).toBe(true);
            expect(result.errors.length).toBe(0);
        });

        it('returns stats', () => {
            const tasks = [
                createTestTask('task-1'),
                createTestTask('task-2', 'pending', ['task-1']),
            ];
            service.buildDag(channelId, tasks);

            const result = service.validateDag(channelId);
            expect(result.stats.nodeCount).toBe(2);
            expect(result.stats.edgeCount).toBe(1);
        });
    });

    describe('cache operations', () => {
        it('clears cache for specific channel', () => {
            const tasks = [createTestTask('task-1')];
            service.buildDag(channelId, tasks);
            service.buildDag('other-channel', tasks);

            service.clearCache(channelId);

            expect(service.getDag(channelId)).toBeNull();
            expect(service.getDag('other-channel')).not.toBeNull();
        });

        it('clears all caches', () => {
            const tasks = [createTestTask('task-1')];
            service.buildDag(channelId, tasks);
            service.buildDag('other-channel', tasks);

            service.clearAllCaches();

            expect(service.getDag(channelId)).toBeNull();
            expect(service.getDag('other-channel')).toBeNull();
        });
    });

    describe('disabled state', () => {
        beforeEach(() => {
            resetDagConfig();
            updateDagConfig({ enabled: false });
        });

        it('reports disabled state', () => {
            expect(service.isEnabled()).toBe(false);
        });
    });
});
