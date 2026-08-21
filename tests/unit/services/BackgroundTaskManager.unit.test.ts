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
jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: { emit: jest.fn() }
    }
}));

jest.mock('@mxf-dev/core/schemas/ShellExecutionEventPayloads', () => ({
    createShellExecutionProgressPayload: jest.fn(() => ({})),
    createShellBackgroundStartedPayload: jest.fn(() => ({})),
    createShellBackgroundCompletedPayload: jest.fn(() => ({}))
}));

import { BackgroundTaskManager } from '@mxf-dev/core/services/BackgroundTaskManager';

/** Helper: wait for a task to leave the 'running' state */
function waitForCompletion(
    manager: BackgroundTaskManager,
    taskId: string,
    principal: { agentId: string; channelId: string },
    timeoutMs = 5000
): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
            const status = manager.getTaskStatus(taskId, principal);
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
    let originalWorkspaceRoot: string | undefined;

    const ctx = {
        agentId: 'test-agent',
        channelId: 'test-channel',
        requestId: 'test-req'
    };

    beforeAll(() => {
        originalWorkspaceRoot = process.env.MXF_WORKSPACE_ROOT;
        process.env.MXF_WORKSPACE_ROOT = process.cwd();
        manager = BackgroundTaskManager.getInstance();
    });

    afterAll(async (): Promise<void> => {
        await manager.shutdown();
        if (originalWorkspaceRoot === undefined) {
            delete process.env.MXF_WORKSPACE_ROOT;
        } else {
            process.env.MXF_WORKSPACE_ROOT = originalWorkspaceRoot;
        }
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
            await waitForCompletion(manager, taskId, ctx);
        });

        it('generates unique taskIds for each invocation', async () => {
            const { taskId: id1 } = await manager.startBackground('echo a', {}, ctx);
            const { taskId: id2 } = await manager.startBackground('echo b', {}, ctx);
            expect(id1).not.toBe(id2);
            await Promise.all([
                waitForCompletion(manager, id1, ctx),
                waitForCompletion(manager, id2, ctx)
            ]);
        });
    });

    // ---- Task status ----

    describe('getTaskStatus', () => {
        it('returns null for an unknown taskId', () => {
            expect(manager.getTaskStatus('nonexistent-id', ctx)).toBeNull();
        });

        it('returns running status immediately after start for a slow command', async () => {
            const { taskId } = await manager.startBackground('sleep 2', {}, ctx);
            const status = manager.getTaskStatus(taskId, ctx);
            expect(status).not.toBeNull();
            expect(status!.status).toBe('running');
            expect(status!.command).toBe('sleep 2');
            expect(status!.agentId).toBe('test-agent');
            expect(status!.channelId).toBe('test-channel');
            expect(status!.startTime).toBeGreaterThan(0);
            expect(status!.exitCode).toBeUndefined();
            // Clean up: cancel the long-running task
            manager.cancelTask(taskId, ctx);
            await waitForCompletion(manager, taskId, ctx);
        });

        it('shows completed status with exitCode 0 after successful command', async () => {
            const { taskId } = await manager.startBackground('echo done', {}, ctx);
            await waitForCompletion(manager, taskId, ctx);
            const status = manager.getTaskStatus(taskId, ctx);
            expect(status).not.toBeNull();
            expect(status!.status).toBe('completed');
            expect(status!.exitCode).toBe(0);
            expect(status!.endTime).toBeGreaterThan(0);
            expect(status!.elapsedSeconds).toBeGreaterThanOrEqual(0);
        });

        it('shows failed status for a command that exits non-zero', async () => {
            const { taskId } = await manager.startBackground('exit 1', {}, ctx);
            await waitForCompletion(manager, taskId, ctx);
            const status = manager.getTaskStatus(taskId, ctx);
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
            await waitForCompletion(manager, taskId, ctx);
            const status = manager.getTaskStatus(taskId, ctx);
            expect(status!.description).toBe('My task description');
        });
    });

    // ---- Task output ----

    describe('getTaskOutput', () => {
        it('returns null for an unknown taskId', () => {
            expect(manager.getTaskOutput('nonexistent-id', ctx)).toBeNull();
        });

        it('returns the command output after completion', async () => {
            const { taskId } = await manager.startBackground('echo hello_world', {}, ctx);
            await waitForCompletion(manager, taskId, ctx);
            const output = manager.getTaskOutput(taskId, ctx);
            expect(output).not.toBeNull();
            expect(output!.trim()).toBe('hello_world');
        });

        it('captures multi-line output', async () => {
            const { taskId } = await manager.startBackground(
                'printf "line1\\nline2\\nline3\\n"',
                {},
                ctx
            );
            await waitForCompletion(manager, taskId, ctx);
            const output = manager.getTaskOutput(taskId, ctx);
            expect(output).toContain('line1');
            expect(output).toContain('line2');
            expect(output).toContain('line3');
        });
    });

    describe('principal ownership', () => {
        it('allows the exact agent and channel to read its task', async () => {
            const { taskId } = await manager.startBackground('echo owner_only', {}, ctx);
            await waitForCompletion(manager, taskId, ctx);

            expect(manager.getTaskStatus(taskId, ctx)?.taskId).toBe(taskId);
            expect(manager.getTaskOutput(taskId, ctx)?.trim()).toBe('owner_only');
        });

        it('hides task status and output from another agent or channel', async () => {
            const { taskId } = await manager.startBackground('echo private', {}, ctx);
            await waitForCompletion(manager, taskId, ctx);

            const wrongAgent = { agentId: 'other-agent', channelId: ctx.channelId };
            const wrongChannel = { agentId: ctx.agentId, channelId: 'other-channel' };

            expect(manager.getTaskStatus(taskId, wrongAgent)).toBeNull();
            expect(manager.getTaskOutput(taskId, wrongAgent)).toBeNull();
            expect(manager.getTaskStatus(taskId, wrongChannel)).toBeNull();
            expect(manager.getTaskOutput(taskId, wrongChannel)).toBeNull();
            expect(manager.listTasks(wrongAgent).some(task => task.taskId === taskId)).toBe(false);
            expect(manager.listTasks(wrongChannel).some(task => task.taskId === taskId)).toBe(false);
        });

        it('denies cross-principal cancellation without affecting the owner task', async () => {
            const { taskId } = await manager.startBackground('sleep 30', {}, ctx);
            const foreignPrincipal = { agentId: 'other-agent', channelId: ctx.channelId };

            expect(manager.cancelTask(taskId, foreignPrincipal)).toBe(false);
            expect(manager.getTaskStatus(taskId, ctx)?.status).toBe('running');
            expect(manager.cancelTask(taskId, ctx)).toBe(true);
            await waitForCompletion(manager, taskId, ctx);
        });
    });

    // ---- Cancel ----

    describe('cancelTask', () => {
        it('returns false for an unknown taskId', () => {
            expect(manager.cancelTask('nonexistent-id', ctx)).toBe(false);
        });

        it('returns false for an already-completed task', async () => {
            const { taskId } = await manager.startBackground('echo fast', {}, ctx);
            await waitForCompletion(manager, taskId, ctx);
            expect(manager.cancelTask(taskId, ctx)).toBe(false);
        });

        it('returns true and cancels a running task', async () => {
            const { taskId } = await manager.startBackground('sleep 30', {}, ctx);
            // Give the process a moment to start
            await new Promise(r => setTimeout(r, 100));
            const cancelled = manager.cancelTask(taskId, ctx);
            expect(cancelled).toBe(true);
            await waitForCompletion(manager, taskId, ctx);
            const status = manager.getTaskStatus(taskId, ctx);
            expect(status!.status).toBe('cancelled');
        });
    });

    // ---- List tasks ----

    describe('listTasks', () => {
        it('returns an array', () => {
            const tasks = manager.listTasks(ctx);
            expect(Array.isArray(tasks)).toBe(true);
        });

        it('includes tasks started in this test run', async () => {
            const { taskId } = await manager.startBackground('echo listed', {}, ctx);
            await waitForCompletion(manager, taskId, ctx);
            const tasks = manager.listTasks(ctx);
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
                waitForCompletion(manager, idA, ctxA),
                waitForCompletion(manager, idB, ctxB)
            ]);

            const tasksA = manager.listTasks(ctxA);
            const tasksB = manager.listTasks(ctxB);

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
            const currentTasks = manager.listTasks(ctx);
            for (const t of currentTasks) {
                if (t.status === 'running') {
                    manager.cancelTask(t.taskId, ctx);
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
                manager.cancelTask(id, {
                    agentId: `limit-test-${longTaskIds.indexOf(id)}`,
                    channelId: 'ch'
                });
            }
            await Promise.all(longTaskIds.map((id, index) => waitForCompletion(
                manager,
                id,
                { agentId: `limit-test-${index}`, channelId: 'ch' }
            )));
        });
    });

    // ---- Shutdown ----

    describe('shutdown', () => {
        it('cancels and drains running tasks on shutdown', async () => {
            // Get a fresh-ish manager (same singleton, but we can still test behavior)
            const { taskId } = await manager.startBackground('sleep 30', {}, ctx);
            await new Promise(r => setTimeout(r, 100));

            const statusBefore = manager.getTaskStatus(taskId, ctx);
            expect(statusBefore!.status).toBe('running');

            const activeManager = manager;
            const shutdown = manager.shutdown();
            expect(BackgroundTaskManager.getInstance()).toBe(activeManager);
            const concurrentShutdown = BackgroundTaskManager.shutdownExisting();
            await expect(activeManager.startBackground('echo too-late', {}, ctx))
                .rejects.toThrow('is shutting down');
            await shutdown;
            await expect(concurrentShutdown).resolves.toBe(true);

            const statusAfter = activeManager.getTaskStatus(taskId, ctx);
            expect(statusAfter!.status).toBe('cancelled');
            expect(statusAfter!.endTime).toBeGreaterThan(0);
            expect(await BackgroundTaskManager.shutdownExisting()).toBe(false);

            manager = BackgroundTaskManager.getInstance();
            expect(manager).not.toBe(activeManager);
            await manager.shutdown();
        });
    });
});
