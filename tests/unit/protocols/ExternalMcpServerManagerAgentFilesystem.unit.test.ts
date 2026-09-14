const mockHandlers = new Map<string, (payload: unknown) => Promise<void>>();
const mockEmit = jest.fn();
let mockCorrectionEnabled = true;
const mockAttemptCorrection = jest.fn();
jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: {
        on: jest.fn((event: string, handler: (payload: unknown) => Promise<void>) => {
            mockHandlers.set(event, handler);
            return { unsubscribe: (): boolean => mockHandlers.delete(event) };
        }),
        emit: mockEmit
    } }
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
    AutoCorrectionService: { getInstance: (): object => ({
        getConfig: (): object => ({ enabled: mockCorrectionEnabled }),
        attemptCorrection: mockAttemptCorrection
    }) }
}));

import type { ChildProcess } from 'node:child_process';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import {
    ExternalMcpServerManager,
    type ExternalServerConfig,
    type ExternalServerStatus
} from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';

// A real, local MCP child: no framework server or network calls are involved.
const CHILD_SCRIPT = `
const readline = require('node:readline');
const mode = process.env.TEST_MODE;
readline.createInterface({ input: process.stdin }).on('line', line => {
    const message = JSON.parse(line);
    let result;
    let error;
    if (message.method === 'initialize') result = { serverInfo: { name: 'agent-fs-test', version: '1' } };
    else if (message.method === 'tools/list') {
        if (mode === 'list-error') error = { code: -32603, message: 'discovery failed' };
        else if (mode === 'list-invalid') result = {};
        else result = { tools: mode === 'empty' ? [] : [
            { name: 'read_file', description: 'read', inputSchema: { type: 'object' } }
        ] };
    } else if (message.method === 'tools/call') {
        error = { code: -32602, message: 'invalid path' };
    } else if (message.method === 'ping') result = {};
    if (result || error) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result, error }) + '\\n');
});
`;
const configuration = (id = 'filesystem:agent-a', mode = 'normal'): ExternalServerConfig => ({
    id, name: 'Agent filesystem test', version: '1', command: process.execPath,
    args: ['-e', CHILD_SCRIPT], autoStart: true, restartOnCrash: false,
    healthCheckInterval: 60000, maxRestartAttempts: 0, startupTimeout: 10000,
    environmentVariables: { TEST_MODE: mode }
});
type Tool = { name: string; description: string; inputSchema: Record<string, unknown> };
interface Scope {
    scope: 'global' | 'channel' | 'agent';
    scopeId?: string;
    keepAliveMinutes?: number;
    keepAliveTimer?: NodeJS.Timeout;
    connectedAgents: Set<string>;
}
interface TestAccess {
    servers: Map<string, { process?: ChildProcess; status: ExternalServerStatus; config: ExternalServerConfig }>;
    serverScopes: Map<string, Scope>;
    discoverRealToolsFromServer(serverId: string): Promise<Tool[]>;
    initializeMcpConnection(serverId: string): Promise<void>;
    sendRequest(serverId: string, method: string, params?: unknown): Promise<unknown>;
}
const internals = (manager: ExternalMcpServerManager): TestAccess => manager as unknown as TestAccess;
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
    let resolve!: (value: T) => void;
    return { promise: new Promise<T>(complete => { resolve = complete; }), resolve };
};

describe('operator agent filesystem registration and readiness', () => {
    const managers: ExternalMcpServerManager[] = [];
    const createManager = (withCallerEvents = false): ExternalMcpServerManager => {
        const manager = new ExternalMcpServerManager({ skipServerEventHandlers: !withCallerEvents });
        managers.push(manager);
        return manager;
    };
    beforeEach(() => {
        mockEmit.mockReset();
        mockHandlers.clear();
        mockCorrectionEnabled = true;
        mockAttemptCorrection.mockReset().mockResolvedValue({ corrected: false });
    });
    afterEach(async () => {
        await Promise.all(managers.splice(0).map(manager => manager.shutdown()));
        jest.restoreAllMocks();
    });

    it('reserves agent scope and private provenance before startup emits, with exact owner matching', async () => {
        const manager = createManager();
        const observations: boolean[] = [];
        mockEmit.mockImplementation((event: string): void => {
            if (event === Events.Mcp.EXTERNAL_SERVER_SPAWN) {
                observations.push(manager.isOperatorAgentFilesystem('filesystem:agent-a', 'agent-a'));
                expect(manager.getServersByScope('agent', 'agent-a')).toHaveLength(1);
            }
        });
        const registering = manager.registerAgentFilesystemServer(configuration(), 'agent-a');
        await expect(manager.registerAgentFilesystemServer(configuration(), 'agent-a')).rejects.toThrow('already registered');
        await registering;
        expect(observations).toEqual([true]);
        expect(internals(manager).serverScopes.get('filesystem:agent-a')?.keepAliveMinutes).toBe(0);
        expect(manager.getAllExternalTools()).toEqual([expect.objectContaining({
            name: 'read_file', serverId: 'filesystem:agent-a', scope: 'agent', scopeId: 'agent-a',
            operatorAgentFilesystem: true
        })]);
        expect(manager.isOperatorAgentFilesystem('filesystem:agent-a', 'agent-b')).toBe(false);
        await manager.unregisterServer('filesystem:agent-a');
        expect(manager.isOperatorAgentFilesystem('filesystem:agent-a', 'agent-a')).toBe(false);
    });

    it('rejects wrong trusted IDs and reserves both raw and channel-composed caller namespaces', async () => {
        const manager = createManager();
        const config = { ...configuration(), autoStart: false };
        await expect(manager.registerAgentFilesystemServer(config, 'agent-b')).rejects.toThrow('must be filesystem:agent-b');
        await expect(manager.registerServer(config)).rejects.toThrow('reserved');
        await expect(manager.registerChannelServer('channel-a', config)).rejects.toThrow('reserved');
        await expect(manager.registerChannelServer('filesystem', { ...config, id: 'agent-a' })).rejects.toThrow('reserved');
        expect(manager.getServerStatus().size).toBe(0);
        expect(internals(manager).serverScopes.size).toBe(0);
    });

    it('allows global filesystem without trusting caller-supplied scope or operator fields', async () => {
        const manager = createManager();
        const config = {
            ...configuration('filesystem'), scope: 'agent', scopeId: 'agent-a',
            operatorAgentFilesystem: true, operatorAgentFilesystemOwner: 'agent-a'
        };
        await manager.registerServer(config);
        expect(manager.getAllExternalTools()).toEqual([expect.objectContaining({ serverId: 'filesystem', scope: 'global' })]);
        expect(manager.getAllExternalTools()[0].operatorAgentFilesystem).toBeUndefined();
        expect(manager.isOperatorAgentFilesystem('filesystem', 'agent-a')).toBe(false);
    });

    it('duplicate registration cannot replace scope, agents, or an existing keepalive timer', async () => {
        const manager = createManager();
        const config = { ...configuration('tools'), autoStart: false, keepAliveMinutes: 1 };
        await manager.registerChannelServer('channel-a', config);
        await manager.onAgentLeaveChannel('agent-a', 'channel-a');
        const scope = internals(manager).serverScopes.get('channel-a:tools')!;
        const timer = scope.keepAliveTimer;
        expect(timer).toBeDefined();
        await expect(manager.registerChannelServer('channel-a', { ...config, keepAliveMinutes: 0 })).rejects.toThrow('already registered');
        await expect(manager.registerServer({ ...config, id: 'channel-a:tools' })).rejects.toThrow('already registered');
        expect(internals(manager).serverScopes.get('channel-a:tools')).toBe(scope);
        expect(scope.keepAliveTimer).toBe(timer);
        expect(scope.keepAliveMinutes).toBe(1);
        expect(manager.getServersByScope('channel', 'channel-a')).toHaveLength(1);
        await manager.registerServer({ ...config, id: 'channel-b:tools' });
        await expect(manager.registerChannelServer('channel-b', config)).rejects.toThrow('already registered');
        expect(manager.getServersByScope('global').map(server => server.id)).toEqual(['channel-b:tools']);
        expect(manager.getServersByScope('channel', 'channel-b')).toEqual([]);
    });

    it('operator servers survive caller unregistration and channel prefix collisions', async () => {
        const manager = createManager(true);
        await manager.registerAgentFilesystemServer(configuration(), 'agent-a');
        await expect(manager.unregisterChannelServer('filesystem', 'agent-a')).rejects.toThrow('does not belong');
        await manager.retireChannel('filesystem');
        const unregister = mockHandlers.get(Events.Mcp.EXTERNAL_SERVER_UNREGISTER)!;
        await unregister(createBaseEventPayload(Events.Mcp.EXTERNAL_SERVER_UNREGISTER, 'agent-b', 'channel-b', {
            serverId: 'filesystem:agent-a'
        }));
        expect(mockEmit).toHaveBeenCalledWith(Events.Mcp.EXTERNAL_SERVER_UNREGISTERED, expect.objectContaining({
            data: expect.objectContaining({ success: false, error: expect.stringContaining('reserved') })
        }));
        expect(manager.getServerStatusById('filesystem:agent-a')?.status).toBe('running');
        expect(manager.isOperatorAgentFilesystem('filesystem:agent-a', 'agent-a')).toBe(true);
        await manager.unregisterServer('filesystem:agent-a');
        expect(manager.getServerStatusById('filesystem:agent-a')).toBeUndefined();
    });

    it('holds concurrent starts until discovery and publishes complete state before readiness events', async () => {
        const manager = createManager();
        const entered = deferred<void>();
        const discovery = deferred<Tool[]>();
        jest.spyOn(internals(manager), 'discoverRealToolsFromServer').mockImplementationOnce((): Promise<Tool[]> => {
            entered.resolve();
            return discovery.promise;
        });
        const snapshots: Array<{ event: string; status?: string; tools: string[] }> = [];
        mockEmit.mockImplementation((event: string): void => {
            if (event === Events.Mcp.EXTERNAL_SERVER_STARTED || event === Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED) {
                snapshots.push({ event, status: manager.getServerStatusById('filesystem:agent-a')?.status,
                    tools: manager.getAllExternalTools().map(tool => tool.name) });
            }
        });
        let firstReady = false;
        let secondReady = false;
        const first = manager.registerAgentFilesystemServer(configuration(), 'agent-a').then(() => { firstReady = true; });
        await entered.promise;
        const second = manager.startServer('filesystem:agent-a').then(() => { secondReady = true; });
        await Promise.resolve();
        expect(firstReady).toBe(false);
        expect(secondReady).toBe(false);
        expect(manager.getServerStatusById('filesystem:agent-a')?.status).toBe('starting');
        expect(manager.getAllExternalTools()).toEqual([]);
        expect(snapshots).toEqual([]);
        discovery.resolve([{ name: 'read_file', description: 'read', inputSchema: {} }]);
        await Promise.all([first, second]);
        expect(snapshots).toEqual([
            { event: Events.Mcp.EXTERNAL_SERVER_STARTED, status: 'running', tools: ['read_file'] },
            { event: Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED, status: 'running', tools: ['read_file'] }
        ]);
    });

    it.each(['list-error', 'list-invalid'])('rejects %s discovery without advertising readiness', async mode => {
        const manager = createManager();
        await expect(manager.registerAgentFilesystemServer(configuration('filesystem:agent-a', mode), 'agent-a'))
            .rejects.toThrow(/discovery failed|tools must be an array/);
        expect(manager.getServerStatusById('filesystem:agent-a')?.status).toBe('error');
        expect(manager.getAllExternalTools()).toEqual([]);
        expect(mockEmit.mock.calls.map(([event]) => event)).not.toContain(Events.Mcp.EXTERNAL_SERVER_STARTED);
        expect(mockEmit.mock.calls.map(([event]) => event)).not.toContain(Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED);
    });

    it('accepts a valid empty tools list', async () => {
        const manager = createManager();
        await manager.registerAgentFilesystemServer(configuration('filesystem:agent-a', 'empty'), 'agent-a');
        expect(manager.getServerStatusById('filesystem:agent-a')?.status).toBe('running');
        expect(manager.getAllExternalTools()).toEqual([]);
    });

    it('stops a failed discovery child before explicit start spawns a replacement', async () => {
        const manager = createManager();
        await expect(manager.registerAgentFilesystemServer(configuration('filesystem:agent-a', 'list-error'), 'agent-a'))
            .rejects.toThrow('discovery failed');
        const record = internals(manager).servers.get('filesystem:agent-a')!;
        const oldChild = record.process!;
        expect(oldChild.exitCode).toBeNull();
        expect(oldChild.signalCode).toBeNull();
        record.config.environmentVariables = { TEST_MODE: 'normal' };
        mockEmit.mockImplementation((event: string): void => {
            if (event === Events.Mcp.EXTERNAL_SERVER_SPAWN) {
                expect(oldChild.exitCode !== null || oldChild.signalCode !== null).toBe(true);
            }
        });
        await manager.startServer('filesystem:agent-a');
        expect(record.process?.pid).not.toBe(oldChild.pid);
        expect(oldChild.exitCode !== null || oldChild.signalCode !== null).toBe(true);
        expect(manager.getServerStatusById('filesystem:agent-a')?.status).toBe('running');
        expect(manager.getAllExternalTools().map(tool => tool.name)).toEqual(['read_file']);
    });

    it('does not publish a late discovery response after the existing startup bound fails', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        const manager = createManager();
        const entered = deferred<void>();
        const discovery = deferred<Tool[]>();
        const access = internals(manager);
        let initializing!: Promise<void>;
        const initialize = access.initializeMcpConnection.bind(manager);
        jest.spyOn(access, 'initializeMcpConnection').mockImplementation((serverId: string): Promise<void> => {
            initializing = initialize(serverId);
            return initializing;
        });
        jest.spyOn(access, 'discoverRealToolsFromServer').mockImplementationOnce((): Promise<Tool[]> => {
            entered.resolve();
            return discovery.promise;
        });
        try {
            const starting = manager.registerAgentFilesystemServer(configuration(), 'agent-a')
                .then(() => null, (error: unknown) => error);
            await entered.promise;
            await jest.advanceTimersByTimeAsync(10000);
            expect(await starting).toEqual(expect.objectContaining({ message: expect.stringContaining('Startup timeout') }));
            discovery.resolve([{ name: 'late_tool', description: 'late', inputSchema: {} }]);
            await initializing;
            expect(manager.getServerStatusById('filesystem:agent-a')?.status).toBe('error');
            expect(manager.getAllExternalTools()).toEqual([]);
            expect(mockEmit.mock.calls.map(([event]) => event)).not.toContain(Events.Mcp.EXTERNAL_SERVER_STARTED);
        } finally {
            discovery.resolve([]);
            const stopping = manager.shutdown();
            await jest.advanceTimersByTimeAsync(5000);
            await stopping;
            jest.useRealTimers();
        }
    });

    it('zero keepalive awaits the actual child exit when the last channel agent leaves', async () => {
        const manager = createManager();
        await manager.registerChannelServer('channel-a', { ...configuration('tools'), keepAliveMinutes: 0 });
        await manager.onAgentJoinChannel('agent-a', 'channel-a');
        const child = internals(manager).servers.get('channel-a:tools')!.process!;
        await manager.onAgentLeaveChannel('agent-a', 'channel-a');
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
        expect(manager.getServerStatusById('channel-a:tools')?.status).toBe('stopped');
        expect(internals(manager).serverScopes.get('channel-a:tools')?.keepAliveTimer).toBeUndefined();
    });

    it.each([false, true])('honors correction enabled=%s for failed external RPCs', async enabled => {
        const manager = createManager();
        await manager.registerAgentFilesystemServer(configuration(), 'agent-a');
        mockCorrectionEnabled = enabled;
        mockAttemptCorrection.mockResolvedValue({ corrected: true, correctedParameters: { path: 'corrected' } });
        const request = jest.spyOn(internals(manager), 'sendRequest');
        await expect(manager.executeToolOnServer('filesystem:agent-a', 'read_file', { path: 'original' }, 'agent-a', 'channel-a'))
            .rejects.toThrow('invalid path');
        const calls = request.mock.calls.filter(([, method]) => method === 'tools/call');
        expect(calls).toHaveLength(enabled ? 2 : 1);
        expect(mockAttemptCorrection).toHaveBeenCalledTimes(enabled ? 1 : 0);
        expect(calls[0][2]).toEqual({ name: 'read_file', arguments: { path: 'original' } });
        if (enabled) expect(calls[1][2]).toEqual({ name: 'read_file', arguments: { path: 'corrected' } });
    });
});
