const mockEmit = jest.fn();
jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { on: jest.fn(), emit: mockEmit }, client: { on: jest.fn(), emit: jest.fn() } }
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = jest.fn();
        debug = jest.fn();
        warn = jest.fn();
        error = jest.fn();
        trace = jest.fn();
    }
}));
jest.mock('@mxf-dev/core/services/AutoCorrectionService', () => ({
    AutoCorrectionService: {
        getInstance: (): object => ({
            getConfig: (): object => ({ enabled: true }),
            attemptCorrection: jest.fn().mockResolvedValue({ corrected: false })
        })
    }
}));

import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { McpEvents } from '@mxf-dev/core/events/event-definitions/McpEvents';
import {
    ExternalMcpServerManager,
    type ExternalServerConfig,
    type ExternalServerStatus
} from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';

// The child installs its signal handler before answering the handshake. Its
// readiness therefore also proves that SIGTERM will be ignored in that mode.
const CHILD_SCRIPT = `
const readline = require('node:readline');
const ignoreTerm = process.env.IGNORE_TERM === 'true';
if (ignoreTerm) process.on('SIGTERM', () => {});
readline.createInterface({ input: process.stdin }).on('line', line => {
    const message = JSON.parse(line);
    let result;
    if (message.method === 'initialize') result = { serverInfo: { name: 'stop-test', version: '1' } };
    else if (message.method === 'tools/list') result = { tools: [
        { name: 'test_tool', description: 'test', inputSchema: { type: 'object' } }
    ] };
    else if (message.method === 'tools/call' && !ignoreTerm) result = { content: [{ type: 'text', text: 'ok' }] };
    if (result) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});
`;

interface RuntimeRecord {
    config: ExternalServerConfig;
    process?: ChildProcess;
    status: ExternalServerStatus;
    forceKillTimer?: NodeJS.Timeout;
    stopPromise?: Promise<void>;
    stdoutBuffer: string;
    readyWaiters?: Array<{ resolve: () => void; reject: (error: Error) => void }>;
}

interface ManagerTestAccess {
    servers: Map<string, RuntimeRecord>;
    serverScopes: Map<string, { keepAliveTimer?: NodeJS.Timeout }>;
    sendRequest(serverId: string, method: string, params?: Record<string, unknown>): Promise<unknown>;
    discoverRealToolsFromServer(serverId: string): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>>;
    initializeMcpConnection(serverId: string): Promise<void>;
}

const internals = (manager: ExternalMcpServerManager): ManagerTestAccess => manager as unknown as ManagerTestAccess;
const record = (manager: ExternalMcpServerManager, serverId = 'stop-test'): RuntimeRecord => {
    const runtime = internals(manager).servers.get(serverId);
    if (!runtime) throw new Error('Test server record is missing');
    return runtime;
};
const child = (manager: ExternalMcpServerManager, serverId = 'stop-test'): ChildProcess => {
    const process = record(manager, serverId).process;
    if (!process) throw new Error('Test child is missing');
    return process;
};
const configuration = (ignoreTerm = false): ExternalServerConfig => ({
    id: 'stop-test',
    name: 'Stop Test',
    version: '1',
    command: process.execPath,
    args: ['-e', CHILD_SCRIPT],
    autoStart: true,
    restartOnCrash: true,
    healthCheckInterval: 60000,
    maxRestartAttempts: 1,
    startupTimeout: 10000,
    environmentVariables: { IGNORE_TERM: String(ignoreTerm) }
});

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
};

describe('ExternalMcpServerManager stopping ownership', () => {
    const managers: ExternalMcpServerManager[] = [];
    const expectedShutdownFailures = new Map<ExternalMcpServerManager, Error>();
    const createManager = (): ExternalMcpServerManager => {
        const manager = new ExternalMcpServerManager({ skipServerEventHandlers: true });
        managers.push(manager);
        return manager;
    };

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        mockEmit.mockReset();
    });

    afterEach(async () => {
        // Advance the manager's existing escalation, including on assertion failure.
        // Every real child is awaited before returning to real timers.
        const shutdown = Promise.all(managers.splice(0).map(manager => {
            const expectedError = expectedShutdownFailures.get(manager);
            return expectedError
                ? expect(manager.shutdown()).rejects.toEqual(expect.objectContaining({
                    failures: expect.arrayContaining([expect.objectContaining({ error: expectedError })])
                }))
                : manager.shutdown();
        }));
        await jest.advanceTimersByTimeAsync(5000);
        await shutdown;
        expectedShutdownFailures.clear();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('deduplicates reentrant stops, rejects callers immediately, and awaits SIGKILL exit', async () => {
        const manager = createManager();
        await manager.registerServer(configuration(true));
        const process = child(manager);
        const pid = process.pid;
        const kill = jest.spyOn(process, 'kill');
        const waiterRejected = jest.fn();
        record(manager).readyWaiters = [{ resolve: jest.fn(), reject: waiterRejected }];
        const pendingCall = manager.executeToolOnServer('stop-test', 'test_tool', {}, 'agent-a', 'channel-a')
            .then(() => null, (error: unknown) => error);
        const reentrantStops: Promise<void>[] = [];
        mockEmit.mockImplementation((event: string): void => {
            if (event === McpEvents.EXTERNAL_SERVER_STOP) {
                reentrantStops.push(manager.stopServer('stop-test'));
            }
        });

        let stopped = false;
        const stopping = manager.stopServer('stop-test').then(() => { stopped = true; });
        expect(record(manager).status).toEqual(expect.objectContaining({ status: 'stopping', pid, tools: [] }));
        expect(mockEmit).toHaveBeenCalledWith(McpEvents.EXTERNAL_SERVER_STOP, expect.objectContaining({
            data: expect.objectContaining({ status: 'stopping' })
        }));
        expect(manager.getAllExternalTools()).toEqual([]);
        expect(waiterRejected).toHaveBeenCalledTimes(1);
        expect(await pendingCall).toEqual(expect.objectContaining({ message: expect.stringContaining('server is stopping') }));
        expect(kill).toHaveBeenCalledTimes(1);
        expect(kill).toHaveBeenCalledWith('SIGTERM');
        expect(process.killed).toBe(true);

        await jest.advanceTimersByTimeAsync(4999);
        expect(stopped).toBe(false);
        expect(process.exitCode).toBeNull();
        expect(process.signalCode).toBeNull();
        await jest.advanceTimersByTimeAsync(1);
        await Promise.all([stopping, ...reentrantStops]);

        expect(kill.mock.calls.map(call => call[0])).toEqual(['SIGTERM', 'SIGKILL']);
        expect(process.signalCode).toBe('SIGKILL');
        expect(manager.getServerStatusById('stop-test')).toEqual(expect.objectContaining({ status: 'stopped', pid: undefined }));
        expect(waiterRejected).toHaveBeenCalledTimes(1);
        expect(record(manager).forceKillTimer).toBeUndefined();
        expect(mockEmit.mock.calls.filter(([event]) => event === McpEvents.EXTERNAL_SERVER_STOPPED)).toHaveLength(1);
        expect(mockEmit).toHaveBeenCalledWith(McpEvents.EXTERNAL_SERVER_STOPPED, expect.objectContaining({
            data: expect.objectContaining({ status: 'stopped' })
        }));
    });

    it('holds concurrent starts until the stopped child has exited', async () => {
        const manager = createManager();
        await manager.registerServer(configuration(true));
        const original = child(manager);
        record(manager).config.environmentVariables = { IGNORE_TERM: 'false' };
        const stopping = manager.stopServer('stop-test');
        const starting = Promise.all([manager.startServer('stop-test'), manager.startServer('stop-test')]);

        await jest.advanceTimersByTimeAsync(4999);
        expect(child(manager)).toBe(original);
        expect(record(manager).status.status).toBe('stopping');
        await jest.advanceTimersByTimeAsync(1);
        await Promise.all([stopping, starting]);

        expect(original.signalCode).toBe('SIGKILL');
        expect(child(manager)).not.toBe(original);
        expect(child(manager).pid).not.toBe(original.pid);
        expect(record(manager).status.status).toBe('running');
        expect(manager.getAllExternalTools().map(tool => tool.name)).toEqual(['test_tool']);
    });

    it('ignores old exit, error, stdout and spawn callbacks while the replacement is stopping', async () => {
        const manager = createManager();
        await manager.registerServer(configuration());
        const original = child(manager);
        await manager.stopServer('stop-test');
        record(manager).config.environmentVariables = { IGNORE_TERM: 'true' };
        await manager.startServer('stop-test');
        const replacement = child(manager);
        const stopping = manager.stopServer('stop-test');
        const escalation = record(manager).forceKillTimer;
        const initialize = jest.spyOn(internals(manager), 'initializeMcpConnection');
        record(manager).stdoutBuffer = 'replacement-buffer';

        original.emit('exit', 0, null);
        original.emit('error', new Error('late old process error'));
        original.stdout?.emit('data', Buffer.from('stale bytes'));
        original.emit('spawn');

        expect(record(manager).forceKillTimer).toBe(escalation);
        expect(record(manager).stdoutBuffer).toBe('replacement-buffer');
        expect(record(manager).status).toEqual(expect.objectContaining({ status: 'stopping', pid: replacement.pid }));
        expect(initialize).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(5000);
        await stopping;
        expect(replacement.signalCode).toBe('SIGKILL');
    });

    it('rechecks stop ownership when another stop wins before a waiting start resumes', async () => {
        const manager = createManager();
        await manager.registerServer({ ...configuration(), autoStart: false });
        const firstStop = deferred<void>();
        const secondStop = deferred<void>();
        const runtime = record(manager);
        runtime.status.status = 'stopping';
        runtime.stopPromise = firstStop.promise;
        const starting = manager.startServer('stop-test');
        runtime.stopPromise = secondStop.promise;
        firstStop.resolve();
        try {
            await Promise.resolve();
            expect(runtime.process).toBeUndefined();
            expect(runtime.status.status).toBe('stopping');
        } finally {
            runtime.stopPromise = undefined;
            secondStop.resolve();
            await starting;
        }
        expect(runtime.status.status).toBe('running');
    });

    it('does not admit a replacement while unregistration awaits the old child', async () => {
        const manager = createManager();
        await manager.registerServer(configuration(true));
        const original = child(manager);
        const unregistering = manager.unregisterServer('stop-test');

        await expect(manager.startServer('stop-test')).rejects.toThrow(/being unregistered/);
        await jest.advanceTimersByTimeAsync(5000);
        await unregistering;
        expect(original.signalCode).toBe('SIGKILL');
        expect(manager.getServerStatusById('stop-test')).toBeUndefined();
    });

    it('stops records without children immediately and cancels a queued crash restart after exit', async () => {
        const manager = createManager();
        await manager.registerServer({ ...configuration(), autoStart: false });
        await manager.stopServer('stop-test');
        expect(record(manager).stopPromise).toBeUndefined();
        expect(record(manager).forceKillTimer).toBeUndefined();
        await manager.startServer('stop-test');
        const original = child(manager);
        const exited = once(original, 'exit');
        original.kill('SIGKILL');
        await exited;

        await manager.stopServer('stop-test');
        await jest.advanceTimersByTimeAsync(5000);
        expect(child(manager)).toBe(original);
        expect(record(manager).status.status).toBe('stopped');
        expect(record(manager).stopPromise).toBeUndefined();
    });

    it.each([
        ['SIGTERM', 'throw'], ['SIGKILL', 'throw'],
        ['SIGTERM', 'error-event'], ['SIGKILL', 'error-event']
    ] as const)(
        'retains record and channel scope when %s fails via %s', async (failingSignal, failureMode) => {
            const manager = createManager();
            const serverId = 'channel-a:stop-test';
            await manager.registerChannelServer('channel-a', configuration(true));
            const original = child(manager, serverId);
            const sendSignal = original.kill.bind(original);
            const originalErrorListeners = original.listenerCount('error');
            const originalExitListeners = original.listenerCount('exit');
            const signalError = new Error(`Cannot send ${failingSignal}`);
            expectedShutdownFailures.set(manager, signalError);
            const kill = jest.spyOn(original, 'kill').mockImplementation(signal => {
                if (signal === failingSignal) {
                    if (failureMode === 'error-event') {
                        original.emit('error', signalError);
                        return false;
                    }
                    throw signalError;
                }
                return sendSignal(signal);
            });

            try {
                const unregistering = manager.unregisterChannelServer('channel-a', 'stop-test')
                    .then(() => null, (error: unknown) => error);
                await jest.advanceTimersByTimeAsync(5000);
                expect(await unregistering).toBe(signalError);
                expect(child(manager, serverId)).toBe(original);
                expect(original.exitCode).toBeNull();
                expect(original.signalCode).toBeNull();
                expect(record(manager, serverId).status.status).toBe('error');
                expect(record(manager, serverId).forceKillTimer).toBeUndefined();
                expect(original.listenerCount('error')).toBe(originalErrorListeners);
                expect(original.listenerCount('exit')).toBe(originalExitListeners);
                expect(manager.getServersByScope('channel', 'channel-a').map(server => server.id)).toEqual([serverId]);
                await expect(manager.startServer(serverId)).rejects.toThrow(/being unregistered/);
                await expect(manager.stopServer(serverId)).rejects.toBe(signalError);
            } finally {
                // This test deliberately made the manager's stop fail. Restore
                // signalling and await this exact fixture child's real exit.
                kill.mockRestore();
                if (original.exitCode === null && original.signalCode === null) {
                    const exited = once(original, 'exit');
                    original.kill('SIGKILL');
                    await exited;
                }
            }
        }
    );

    it('retains a failed child during shutdown, stops the others, and closes admission', async () => {
        const manager = createManager();
        const failedServerId = 'channel-a:stop-test';
        const healthyServerId = 'channel-b:stop-test';
        await manager.registerChannelServer('channel-a', configuration(true));
        await manager.registerChannelServer('channel-b', configuration());
        await manager.onAgentLeaveChannel('agent-a', 'channel-a');
        await manager.onAgentLeaveChannel('agent-b', 'channel-b');
        const failedChild = child(manager, failedServerId);
        const healthyChild = child(manager, healthyServerId);
        const sendSignal = failedChild.kill.bind(failedChild);
        const signalError = new Error('SIGTERM permission denied');
        expectedShutdownFailures.set(manager, signalError);
        const kill = jest.spyOn(failedChild, 'kill').mockImplementation(signal => {
            if (signal === 'SIGTERM') {
                failedChild.emit('error', signalError);
                return false;
            }
            return sendSignal(signal);
        });

        try {
            const shutdown = manager.shutdown();
            const outcome = shutdown.then(() => null, (error: unknown) => error);
            expect(manager.shutdown()).toBe(shutdown);
            for (const scope of internals(manager).serverScopes.values()) {
                expect(scope.keepAliveTimer).toBeUndefined();
            }
            await expect(manager.startServer(healthyServerId)).rejects.toThrow(/shutting down/);
            await expect(manager.registerServer({ ...configuration(), id: 'late-global' })).rejects.toThrow(/registration is closed/);
            await expect(manager.registerChannelServer('late-channel', configuration())).rejects.toThrow(/registration is closed/);
            expect(manager.getServersByScope('channel', 'late-channel')).toEqual([]);
            await manager.onAgentLeaveChannel('agent-a', 'channel-a');
            expect(internals(manager).serverScopes.get(failedServerId)?.keepAliveTimer).toBeUndefined();

            await jest.advanceTimersByTimeAsync(5000);
            const error = await outcome;
            expect(error).toEqual(expect.objectContaining({
                message: expect.stringContaining(`${failedServerId}: SIGTERM permission denied`),
                failures: [{ serverId: failedServerId, error: signalError }]
            }));
            expect(child(manager, failedServerId)).toBe(failedChild);
            expect(failedChild.exitCode).toBeNull();
            expect(failedChild.signalCode).toBeNull();
            expect(healthyChild.exitCode !== null || healthyChild.signalCode !== null).toBe(true);
            expect(manager.getServerStatusById(healthyServerId)).toBeUndefined();
            expect(manager.getServersByScope('channel', 'channel-b')).toEqual([]);
            expect(manager.getServersByScope('channel', 'channel-a').map(server => server.id)).toEqual([failedServerId]);
            await expect(manager.shutdown()).rejects.toBe(error);
        } finally {
            kill.mockRestore();
            if (failedChild.exitCode === null && failedChild.signalCode === null) {
                const exited = once(failedChild, 'exit');
                failedChild.kill('SIGKILL');
                await exited;
            }
        }
    });

    it.each(['initialize', 'discovery'] as const)(
        'discards late %s completion after a stop and replacement', async phase => {
            const manager = createManager();
            const access = internals(manager);
            const entered = deferred<void>();
            const pending = deferred<unknown>();
            const initializations: Promise<void>[] = [];
            const originalInitialize = access.initializeMcpConnection.bind(manager);
            jest.spyOn(access, 'initializeMcpConnection').mockImplementation((serverId: string): Promise<void> => {
                const result = originalInitialize(serverId);
                initializations.push(result);
                return result;
            });
            const delayed = phase === 'initialize'
                ? jest.spyOn(access, 'sendRequest').mockImplementationOnce((): Promise<unknown> => {
                    entered.resolve();
                    return pending.promise;
                })
                : jest.spyOn(access, 'discoverRealToolsFromServer').mockImplementationOnce(async () => {
                    entered.resolve();
                    await pending.promise;
                    return [{ name: 'stale_tool', description: 'stale', inputSchema: {} }];
                });
            const starting = manager.registerServer(configuration()).then(() => null, (error: unknown) => error);
            await entered.promise;
            const oldInitialization = initializations[0];
            await manager.stopServer('stop-test');
            expect(await starting).toEqual(expect.objectContaining({ message: expect.stringContaining('was stopped') }));
            delayed.mockRestore();
            await manager.startServer('stop-test');
            const replacement = child(manager);
            const previousEvents = mockEmit.mock.calls.length;

            pending.resolve({ serverInfo: { name: 'stale', version: '1' } });
            await oldInitialization;

            expect(child(manager)).toBe(replacement);
            expect(record(manager).status.status).toBe('running');
            expect(manager.getAllExternalTools().map(tool => tool.name)).toEqual(['test_tool']);
            expect(mockEmit.mock.calls).toHaveLength(previousEvents);
        }
    );
});
