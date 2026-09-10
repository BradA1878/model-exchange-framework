jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
    }))
}));

import { Request, Response } from 'express';
import { UserInputRequestManager } from '@mxf-dev/core/services/UserInputRequestManager';
import { ServerShutdownCoordinator } from '../../../src/server/services/ServerShutdownCoordinator';
import {
    requireServerReady,
    ServerRuntimeState
} from '../../../src/server/services/ServerRuntimeState';

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void;
    const promise = new Promise<void>(complete => { resolve = complete; });
    return { promise, resolve };
};

describe('server startup and shutdown coordination', () => {
    it('cleans an operation that finishes after a signal without creating later services', async () => {
        const runtime = new ServerRuntimeState();
        const operation = deferred();
        let connected = false;
        const initializeLaterServices = jest.fn();
        const listen = jest.fn();
        const closeDatabase = jest.fn((): void => { connected = false; });
        const startup = runtime.runStartup(async () => {
            await operation.promise;
            connected = true;
            if (!runtime.canContinueStartup()) return;
            initializeLaterServices();
            listen();
            runtime.markReady();
        });
        const coordinator = new ServerShutdownCoordinator([
            { name: 'startup', run: (): Promise<void> => runtime.waitForStartupCompletion() },
            { name: 'database', run: closeDatabase }
        ]);

        runtime.markStopping();
        const shutdown = coordinator.shutdown('SIGTERM');
        expect(closeDatabase).not.toHaveBeenCalled();

        operation.resolve();
        await startup;
        await shutdown;
        runtime.markStopped();

        expect(initializeLaterServices).not.toHaveBeenCalled();
        expect(listen).not.toHaveBeenCalled();
        expect(closeDatabase).toHaveBeenCalledTimes(1);
        expect(connected).toBe(false);
        expect(runtime.getLifecycle()).toBe('stopped');
        expect(runtime.getExitCode()).toBe(0);
    });

    it('closes a pending listen that completes during shutdown without reporting ready', async () => {
        const runtime = new ServerRuntimeState();
        const listening = deferred();
        let open = false;
        const markReady = jest.spyOn(runtime, 'markReady');
        const startup = runtime.runStartup(async () => {
            await listening.promise;
            open = true;
            if (!runtime.canContinueStartup()) return;
            runtime.markReady();
        });
        const closeHttp = jest.fn((): void => { open = false; });
        const coordinator = new ServerShutdownCoordinator([
            { name: 'startup', run: (): Promise<void> => runtime.waitForStartupCompletion() },
            { name: 'http', run: closeHttp }
        ]);

        runtime.markStopping();
        const shutdown = coordinator.shutdown('SIGINT');
        expect(closeHttp).not.toHaveBeenCalled();
        listening.resolve();
        await Promise.all([startup, shutdown]);

        expect(markReady).not.toHaveBeenCalled();
        expect(closeHttp).toHaveBeenCalledTimes(1);
        expect(open).toBe(false);
    });

    it('releases the startup barrier on failure before failure cleanup waits on it', async () => {
        const runtime = new ServerRuntimeState();
        const cleanup = jest.fn();
        const coordinator = new ServerShutdownCoordinator([
            { name: 'startup', run: (): Promise<void> => runtime.waitForStartupCompletion() },
            { name: 'resources', run: cleanup }
        ]);
        const failure = new Error('database connection failed');
        const startup = runtime.runStartup(async () => { throw failure; });

        await expect(startup).rejects.toBe(failure);
        runtime.markFailed();
        await coordinator.shutdown('initialization failure');
        runtime.markStopped();

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(runtime.getExitCode()).toBe(1);
        await expect(runtime.runStartup(async () => undefined)).rejects.toThrow('only start once');
    });

    it('admits API requests only while ready', () => {
        const runtime = new ServerRuntimeState();
        const gate = requireServerReady(runtime);
        const json = jest.fn();
        const status = jest.fn(() => ({ json }));
        const response = { status } as unknown as Response;
        const next = jest.fn();

        gate({} as Request, response, next);
        expect(status).toHaveBeenLastCalledWith(503);
        expect(next).not.toHaveBeenCalled();

        runtime.markReady();
        gate({} as Request, response, next);
        expect(next).toHaveBeenCalledTimes(1);

        runtime.markStopping();
        gate({} as Request, response, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(json).toHaveBeenLastCalledWith({
            success: false, error: 'Server is not accepting requests'
        });
    });

    it('settles pending REST prompts before close waits and refuses late prompt creation', async () => {
        const manager = UserInputRequestManager.getInstance();
        const request = {
            agentId: 'rest-agent-without-a-socket',
            channelId: 'channel',
            title: 'Approve?',
            inputType: 'confirm' as const,
            inputConfig: {}
        };
        const { promise } = manager.createRequest(request);
        const restFinished = promise.catch(error => error as Error);
        const continueHandler = deferred();
        const closeEntered = deferred();
        // An admitted request can still be awaiting authorization when shutdown
        // starts. Its eventual prompt must fail even through a fresh singleton.
        const lateRequest = continueHandler.promise.then(() => {
            UserInputRequestManager.getInstance().createRequest(request);
        });
        const lateFinished = lateRequest.catch(error => error as Error);
        const coordinator = new ServerShutdownCoordinator([
            { name: 'user-input', run: (): void => UserInputRequestManager.stopAcceptingRequests() },
            {
                name: 'socket-and-http',
                run: async (): Promise<void> => {
                    closeEntered.resolve();
                    await Promise.all([restFinished, lateFinished]);
                }
            }
        ]);

        const shutdown = coordinator.shutdown('SIGTERM');
        await closeEntered.promise;
        continueHandler.resolve();
        await shutdown;

        expect(await restFinished).toEqual(new Error('UserInputRequestManager shutting down'));
        expect(await lateFinished).toEqual(
            new Error('UserInputRequestManager is not accepting requests during shutdown')
        );
        expect(() => manager.createRequest(request)).toThrow('not accepting requests');
        const stoppedManager = UserInputRequestManager.getInstance();
        expect((stoppedManager as unknown as { cleanupInterval: unknown }).cleanupInterval).toBeNull();
        UserInputRequestManager.shutdownExisting();
        UserInputRequestManager.stopAcceptingRequests();
    });
});
