/**
 * Unit tests for BackgroundTaskManager.
 *
 * Tests the singleton service that manages long-running background shell processes.
 * Uses real child_process.spawn() with short-lived commands to validate lifecycle,
 * status tracking, output collection, cancellation, and concurrent task limits.
 *
 * EventBus and payload helpers are mocked to prevent actual event emission.
 */

// Mock EventBus before any imports that reference it
jest.mock('../../../src/shared/events/EventBus', () => ({
    EventBus: {
        server: { emit: jest.fn() }
    }
}));

jest.mock('../../../src/shared/schemas/ShellExecutionEventPayloads', () => ({
    createShellExecutionProgressPayload: jest.fn(() => ({})),
    createShellBackgroundStartedPayload: jest.fn(() => ({})),
    createShellBackgroundCompletedPayload: jest.fn(() => ({}))
}));

import { BackgroundTaskManager } from '../../../src/shared/services/BackgroundTaskManager';

/** Helper: wait for a task to leave the 'running' state */
function waitForCompletion(manager: BackgroundTaskManager, taskId: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
            const status = manager.getTaskStatus(taskId);
            if (!status || status.status !== 'running') {
                clearInterval(interval);
                resolve();
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(interval);
                reject(new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`));
            }
        }, 50);
    });
}

describe('BackgroundTaskManager', () => {
    let manager: BackgroundTaskManager;

    const ctx = {
        agentId: 'test-agent',
        channelId: 'test-channel',
        requestId: 'test-req'
    };

    beforeAll(() => {
        manager = BackgroundTaskManager.getInstance();
    });

    afterAll(() => {
        manager.shutdown();
    });

    // ---- Singleton ----

    describe('singleton', () => {
        it('returns the same instance on repeated calls', () => {
            const a = BackgroundTaskManager.getInstance();
            const b = BackgroundTaskManager.getInstance();
            expect(a).toBe(b);
        });
    });

    // ---- Starting tasks ----

    describe('startBackground', () => {
        it('returns a taskId string', async () => {
            const { taskId } = await manager.startBackground('echo hello', {}, ctx);
            expect(typeof taskId).toBe('string');
            expect(taskId.length).toBeGreaterThan(0);
            await waitForCompletion(manager, taskId);
        });

        it('generates unique taskIds for each invocation', async () => {
            const { taskId: id1 } = await manager.startBackground('echo a', {}, ctx);
            const { taskId: id2 } = await manager.startBackground('echo b', {}, ctx);
            expect(id1).not.toBe(id2);
            await Promise.all([
                waitForCompletion(manager, id1),
                waitForCompletion(manager, id2)
            ]);
        });
    });

    // ---- Task status ----

    describe('getTaskStatus', () => {
        it('returns null for an unknown taskId', () => {
            expect(manager.getTaskStatus('nonexistent-id')).toBeNull();
        });

        it('returns running status immediately after start for a slow command', async () => {
            const { taskId } = await manager.startBackground('sleep 2', {}, ctx);
            const status = manager.getTaskStatus(taskId);
            expect(status).not.toBeNull();
            expect(status!.status).toBe('running');
            expect(status!.command).toBe('sleep 2');
            expect(status!.agentId).toBe('test-agent');
            expect(status!.channelId).toBe('test-channel');
            expect(status!.startTime).toBeGreaterThan(0);
            expect(status!.exitCode).toBeUndefined();
            // Clean up: cancel the long-running task
            manager.cancelTask(taskId);
            await waitForCompletion(manager, taskId);
        });

        it('shows completed status with exitCode 0 after successful command', async () => {
            const { taskId } = await manager.startBackground('echo done', {}, ctx);
            await waitForCompletion(manager, taskId);
            const status = manager.getTaskStatus(taskId);
            expect(status).not.toBeNull();
            expect(status!.status).toBe('completed');
            expect(status!.exitCode).toBe(0);
            expect(status!.endTime).toBeGreaterThan(0);
            expect(status!.elapsedSeconds).toBeGreaterThanOrEqual(0);
        });

        it('shows failed status for a command that exits non-zero', async () => {
            const { taskId } = await manager.startBackground('exit 1', {}, ctx);
            await waitForCompletion(manager, taskId);
            const status = manager.getTaskStatus(taskId);
            expect(status).not.toBeNull();
            expect(status!.status).toBe('failed');
            expect(status!.exitCode).toBe(1);
        });

        it('includes description when provided', async () => {
            const { taskId } = await manager.startBackground(
                'echo desc',
                { description: 'My task description' },
                ctx
            );
            await waitForCompletion(manager, taskId);
            const status = manager.getTaskStatus(taskId);
            expect(status!.description).toBe('My task description');
        });
    });

    // ---- Task output ----

    describe('getTaskOutput', () => {
        it('returns null for an unknown taskId', () => {
            expect(manager.getTaskOutput('nonexistent-id')).toBeNull();
        });

        it('returns the command output after completion', async () => {
            const { taskId } = await manager.startBackground('echo hello_world', {}, ctx);
            await waitForCompletion(manager, taskId);
            const output = manager.getTaskOutput(taskId);
            expect(output).not.toBeNull();
            expect(output!.trim()).toBe('hello_world');
        });

        it('captures multi-line output', async () => {
            const { taskId } = await manager.startBackground(
                'printf "line1\\nline2\\nline3\\n"',
                {},
                ctx
            );
            await waitForCompletion(manager, taskId);
            const output = manager.getTaskOutput(taskId);
            expect(output).toContain('line1');
            expect(output).toContain('line2');
            expect(output).toContain('line3');
        });
    });

    // ---- Cancel ----

    describe('cancelTask', () => {
        it('returns false for an unknown taskId', () => {
            expect(manager.cancelTask('nonexistent-id')).toBe(false);
        });

        it('returns false for an already-completed task', async () => {
            const { taskId } = await manager.startBackground('echo fast', {}, ctx);
            await waitForCompletion(manager, taskId);
            expect(manager.cancelTask(taskId)).toBe(false);
        });

        it('returns true and cancels a running task', async () => {
            const { taskId } = await manager.startBackground('sleep 30', {}, ctx);
            // Give the process a moment to start
            await new Promise(r => setTimeout(r, 100));
            const cancelled = manager.cancelTask(taskId);
            expect(cancelled).toBe(true);
            await waitForCompletion(manager, taskId);
            const status = manager.getTaskStatus(taskId);
            expect(status!.status).toBe('cancelled');
        });
    });

    // ---- List tasks ----

    describe('listTasks', () => {
        it('returns an array', () => {
            const tasks = manager.listTasks();
            expect(Array.isArray(tasks)).toBe(true);
        });

        it('includes tasks started in this test run', async () => {
            const { taskId } = await manager.startBackground('echo listed', {}, ctx);
            await waitForCompletion(manager, taskId);
            const tasks = manager.listTasks();
            const found = tasks.find(t => t.taskId === taskId);
            expect(found).toBeDefined();
            expect(found!.command).toBe('echo listed');
        });

        it('filters by agentId', async () => {
            const ctxA = { agentId: 'agent-AAA', channelId: 'ch', requestId: 'r1' };
            const ctxB = { agentId: 'agent-BBB', channelId: 'ch', requestId: 'r2' };

            const { taskId: idA } = await manager.startBackground('echo a', {}, ctxA);
            const { taskId: idB } = await manager.startBackground('echo b', {}, ctxB);
            await Promise.all([
                waitForCompletion(manager, idA),
                waitForCompletion(manager, idB)
            ]);

            const tasksA = manager.listTasks('agent-AAA');
            const tasksB = manager.listTasks('agent-BBB');

            expect(tasksA.some(t => t.taskId === idA)).toBe(true);
            expect(tasksA.some(t => t.taskId === idB)).toBe(false);
            expect(tasksB.some(t => t.taskId === idB)).toBe(true);
            expect(tasksB.some(t => t.taskId === idA)).toBe(false);
        });
    });

    // ---- Concurrent task limit ----

    describe('max concurrent tasks', () => {
        it('throws when exceeding the limit of 10 concurrent tasks', async () => {
            // Spawn 10 long-running tasks (the manager may already have running tasks
            // from other tests, so we use sleep to ensure they stay running)
            const longTaskIds: string[] = [];
            const startPromises: Promise<{ taskId: string }>[] = [];

            // First, cancel any remaining running tasks to get a clean slate
            const currentTasks = manager.listTasks();
            for (const t of currentTasks) {
                if (t.status === 'running') {
                    manager.cancelTask(t.taskId);
                }
            }
            // Wait briefly for cancellations to settle
            await new Promise(r => setTimeout(r, 200));

            // Now start exactly 10 long-running tasks
            for (let i = 0; i < 10; i++) {
                startPromises.push(manager.startBackground('sleep 30', {}, {
                    agentId: `limit-test-${i}`,
                    channelId: 'ch',
                    requestId: `req-${i}`
                }));
            }

            const results = await Promise.all(startPromises);
            for (const r of results) {
                longTaskIds.push(r.taskId);
            }

            // The 11th task should throw
            await expect(
                manager.startBackground('echo overflow', {}, ctx)
            ).rejects.toThrow(/Maximum concurrent background tasks/);

            // Clean up: cancel all long-running tasks
            for (const id of longTaskIds) {
                manager.cancelTask(id);
            }
            await Promise.all(longTaskIds.map(id => waitForCompletion(manager, id)));
        });
    });

    // ---- Shutdown ----

    describe('shutdown', () => {
        it('cancels running tasks on shutdown', async () => {
            // Get a fresh-ish manager (same singleton, but we can still test behavior)
            const { taskId } = await manager.startBackground('sleep 30', {}, ctx);
            await new Promise(r => setTimeout(r, 100));

            const statusBefore = manager.getTaskStatus(taskId);
            expect(statusBefore!.status).toBe('running');

            manager.shutdown();

            const statusAfter = manager.getTaskStatus(taskId);
            expect(statusAfter!.status).toBe('cancelled');
            expect(statusAfter!.endTime).toBeGreaterThan(0);
        });
    });
});
