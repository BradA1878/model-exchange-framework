import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

const mockSpawn = jest.fn();
const mockEmit = jest.fn();

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    spawn: mockSpawn
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { emit: mockEmit } }
}));

jest.mock('@mxf-dev/core/schemas/ShellExecutionEventPayloads', () => ({
    createShellExecutionProgressPayload: jest.fn(() => ({ kind: 'progress' })),
    createShellBackgroundStartedPayload: jest.fn(() => ({ kind: 'started' })),
    createShellBackgroundCompletedPayload: jest.fn(() => ({ kind: 'completed' }))
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import { BackgroundTaskManager } from '@mxf-dev/core/services/BackgroundTaskManager';

class FakeChildProcess extends EventEmitter {
    public readonly stdout = new PassThrough();
    public readonly stderr = new PassThrough();
    public readonly kill = jest.fn((): boolean => true);
}

describe('BackgroundTaskManager terminal process events', () => {
    const previousWorkspaceRoot = process.env.MXF_WORKSPACE_ROOT;

    beforeEach(() => {
        process.env.MXF_WORKSPACE_ROOT = process.cwd();
        mockSpawn.mockReset();
        mockEmit.mockReset();
    });

    afterEach(async (): Promise<void> => {
        await BackgroundTaskManager.shutdownExisting();
    });

    afterAll(() => {
        if (previousWorkspaceRoot === undefined) {
            delete process.env.MXF_WORKSPACE_ROOT;
        } else {
            process.env.MXF_WORKSPACE_ROOT = previousWorkspaceRoot;
        }
    });

    it('finalizes and emits completion exactly once for Node error-then-close ordering', async () => {
        const child = new FakeChildProcess();
        mockSpawn.mockReturnValue(child);
        const manager = BackgroundTaskManager.getInstance();
        const principal = { agentId: 'agent-1', channelId: 'channel-1' };
        const { taskId } = await manager.startBackground('missing-command', {}, {
            ...principal,
            requestId: 'request-1'
        });

        child.emit('error', new Error('spawn failed'));
        child.emit('close', 1);

        expect(manager.getTaskStatus(taskId, principal)).toMatchObject({
            status: 'failed',
            exitCode: 1
        });
        expect(mockEmit.mock.calls.filter(call =>
            call[0] === Events.Shell.SHELL_BACKGROUND_COMPLETED
        )).toHaveLength(1);
    });

    it('keeps one authoritative singleton until deferred process close finishes shutdown', async () => {
        const child = new FakeChildProcess();
        mockSpawn.mockReturnValue(child);
        const manager = BackgroundTaskManager.getInstance();
        await manager.startBackground('long-command', {}, {
            agentId: 'agent-1',
            channelId: 'channel-1',
            requestId: 'request-2'
        });

        const shutdown = manager.shutdown();
        const concurrentShutdown = BackgroundTaskManager.shutdownExisting();
        expect(BackgroundTaskManager.getInstance()).toBe(manager);
        await expect(manager.startBackground('too-late', {}, {
            agentId: 'agent-1',
            channelId: 'channel-1',
            requestId: 'request-3'
        })).rejects.toThrow('is shutting down');

        let settled = false;
        void shutdown.then((): void => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        child.emit('close', null);
        await expect(shutdown).resolves.toBeUndefined();
        await expect(concurrentShutdown).resolves.toBe(true);
        expect(await BackgroundTaskManager.shutdownExisting()).toBe(false);

        const replacement = BackgroundTaskManager.getInstance();
        expect(replacement).not.toBe(manager);
        await replacement.shutdown();
    });

    it('drains a cancelled process whose close event has not arrived before shutdown', async () => {
        const child = new FakeChildProcess();
        mockSpawn.mockReturnValue(child);
        const manager = BackgroundTaskManager.getInstance();
        const principal = { agentId: 'agent-1', channelId: 'channel-1' };
        const { taskId } = await manager.startBackground('long-command', {}, {
            ...principal,
            requestId: 'request-4'
        });

        expect(manager.cancelTask(taskId, principal)).toBe(true);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');

        const shutdown = manager.shutdown();
        let settled = false;
        void shutdown.then((): void => {
            settled = true;
        });
        await Promise.resolve();

        expect(settled).toBe(false);
        expect(child.kill).toHaveBeenCalledWith('SIGKILL');

        child.emit('close', null);
        await expect(shutdown).resolves.toBeUndefined();
    });
});
