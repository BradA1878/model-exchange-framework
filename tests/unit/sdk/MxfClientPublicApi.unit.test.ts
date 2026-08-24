/**
 * Unit tests for MxfClient's public API contract.
 *
 * Covers the behaviours that were previously silently broken:
 *   - connect() THROWS on failure instead of returning `false` into a disabled logger
 *   - on()/emit() THROW on a non-public event instead of warning and doing nothing
 *   - off(event, handler) removes exactly that handler
 *   - disconnect() drops every lifecycle subscription, so a reconnect does not stack a
 *     second set on top of the first
 *   - no `require()` survives anywhere in the SDK source (this is an ESM package)
 */

import { Subscription } from 'rxjs';

// ---------------------------------------------------------------------------
// EventBus.client mock — an in-memory bus we can drive from the tests.
// ---------------------------------------------------------------------------
jest.mock('@mxf-dev/core/events/EventBus', () => {
    const handlers: Map<string, ((payload: any) => void)[]> = new Map();

    const client = {
        on: jest.fn((event: string, handler: (payload: any) => void) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
            return {
                unsubscribe: jest.fn(() => {
                    const list = handlers.get(event);
                    if (list) {
                        const i = list.indexOf(handler);
                        if (i > -1) list.splice(i, 1);
                    }
                }),
            } as unknown as Subscription;
        }),
        off: jest.fn(),
        emit: jest.fn(),
        emitOn: jest.fn(),
        registerSocket: jest.fn(),
        unregisterSocket: jest.fn(),
        setClientSocket: jest.fn(),
        _deliver: (event: string, payload: any) => {
            [...(handlers.get(event) ?? [])].forEach(h => h(payload));
        },
        _handlerCount: (event: string) => (handlers.get(event) ?? []).length,
        _totalHandlers: () => [...handlers.values()].reduce((n, l) => n + l.length, 0),
        _reset: () => handlers.clear(),
    };

    return { EventBus: { client } };
});

// MxfService is the socket layer; stub it so no real socket is opened.
const mockServiceConnect = jest.fn();
jest.mock('@mxf-dev/sdk/services/MxfService', () => ({
    MxfService: jest.fn().mockImplementation(() => ({
        connect: mockServiceConnect,
        disconnect: jest.fn().mockResolvedValue(undefined),
        setAgentId: jest.fn(),
        isConnected: jest.fn(() => true),
        socketEmit: jest.fn(),
        getChannelConfig: jest.fn(() => ({})),
        getActiveAgents: jest.fn(() => []),
        onTaskCompleted: jest.fn(),
        onTaskFailed: jest.fn(),
        onTaskCancelled: jest.fn(),
        onTaskAssigned: jest.fn(),
        onTaskStarted: jest.fn(),
        onTaskProgressUpdated: jest.fn(),
        clearTaskEventCallbacks: jest.fn(),
    })),
}));

// Channel subscription and tool loading both wait on server responses that never arrive
// in a unit test. Stub them so connect() can reach the end of performFullConnection().
jest.mock('@mxf-dev/sdk/handlers/MessageHandlers', () => ({
    MessageHandlers: jest.fn().mockImplementation(() => ({
        subscribeToChannel: jest.fn().mockResolvedValue(true),
        unsubscribeFromChannel: jest.fn().mockResolvedValue(true),
        sendChannelMessage: jest.fn().mockResolvedValue(true),
        sendDirectMessage: jest.fn(),
        updateMxpConfig: jest.fn(),
        cleanup: jest.fn(),
    })),
}));

jest.mock('@mxf-dev/sdk/services/MxfToolService', () => ({
    MxfToolService: jest.fn().mockImplementation(() => ({
        loadTools: jest.fn().mockResolvedValue([]),
        getCachedTools: jest.fn(() => []),
        cleanup: jest.fn(),
    })),
}));

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import {
    AgentMcpProcessManagementError,
    MxfClient
} from '@mxf-dev/sdk/MxfClient';
import { Events } from '@mxf-dev/core/events/EventNames';
import { UserInputEvents } from '@mxf-dev/core/events/event-definitions/UserInputEvents';
import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryScope
} from '@mxf-dev/core/types/MemoryTypes';
import type { AgentConfig } from '@mxf-dev/core/interfaces/AgentInterfaces';
import { ConnectionStatus } from '@mxf-dev/core/types/types';

const bus = EventBus.client as any;

const CONFIG: AgentConfig = {
    agentId: 'test-agent',
    name: 'Test Agent',
    channelId: 'test-channel',
    keyId: 'key-1',
    secretKey: 'secret-1',
    host: 'localhost',
    port: 3001,
    secure: false,
    apiUrl: 'http://localhost:3001/api',
    apiKey: '',
    agentConfigPrompt: ''
};

const newClient = (): MxfClient => new MxfClient({ ...CONFIG });

class MemoryBoundaryClient extends MxfClient {
    public readAgentMemory(): Promise<IAgentMemory> {
        return this.getMemory();
    }

    public writeAgentMemory(update: Partial<IAgentMemory>): Promise<IAgentMemory> {
        return this.updateMemory(update);
    }

    public readChannelMemory(channelId: string): Promise<IChannelMemory> {
        return this.getChannelMemory(channelId);
    }

    public writeChannelMemory(
        channelId: string,
        update: Partial<IChannelMemory>
    ): Promise<IChannelMemory> {
        return this.updateChannelMemory(channelId, update);
    }

    public readRelationshipMemory(
        otherAgentId: string,
        channelId?: string
    ): Promise<IRelationshipMemory> {
        return this.getRelationshipMemory(otherAgentId, channelId);
    }

    public writeRelationshipMemory(
        otherAgentId: string,
        update: Partial<IRelationshipMemory>,
        channelId?: string
    ): Promise<IRelationshipMemory> {
        return this.updateRelationshipMemory(otherAgentId, update, channelId);
    }

    public deleteOwnAgentMemory(): Promise<boolean> {
        return this.deleteMemoryEntry(MemoryScope.AGENT);
    }

    public deleteOwnChannelMemory(channelId: string): Promise<boolean> {
        return this.deleteMemoryEntry(MemoryScope.CHANNEL, channelId);
    }

    public deleteOwnRelationshipMemory(
        otherAgentId: string,
        channelId?: string
    ): Promise<boolean> {
        return this.deleteMemoryEntry(MemoryScope.RELATIONSHIP, otherAgentId, channelId);
    }

    public deleteAgentMemoryWithForgedTarget(targetAgentId: string): Promise<boolean> {
        const forgedCall = this.deleteMemoryEntry as unknown as (
            scope: MemoryScope,
            target: string
        ) => Promise<boolean>;
        return forgedCall.call(this, MemoryScope.AGENT, targetAgentId);
    }
}

describe('MxfClient.connect()', () => {
    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
    });

    it('THROWS when the underlying socket connection fails', async () => {
        // Previously this collapsed into `return false`, and the error went to a client
        // Logger that ships disabled — so the consumer saw nothing at all.
        mockServiceConnect.mockRejectedValue(new Error('ECONNREFUSED'));

        const client = newClient();
        await expect(client.connect()).rejects.toThrow('ECONNREFUSED');
    });

    it('THROWS when registration fails', async () => {
        mockServiceConnect.mockImplementation(async () => {
            // Server rejects the registration.
            setImmediate(() =>
                bus._deliver(Events.Agent.REGISTRATION_FAILED, {
                    agentId: CONFIG.agentId,
                    error: 'invalid channel key',
                })
            );
        });

        const client = newClient();
        await expect(client.connect()).rejects.toThrow('invalid channel key');
    });

    it('returns void (not a boolean) so failure cannot be mistaken for `false`', async () => {
        mockServiceConnect.mockImplementation(async () => {
            setImmediate(() => {
                bus._deliver(Events.Agent.CONNECTED, { agentId: CONFIG.agentId });
                bus._deliver(Events.Agent.REGISTERED, { agentId: CONFIG.agentId });
            });
        });

        const client = newClient();
        await expect(client.connect()).resolves.toBeUndefined();
    });
});

describe('MxfClient connection status on a dropped socket', () => {
    class StatusClient extends MxfClient {
        public currentStatus(): ConnectionStatus {
            return this.status;
        }
    }

    const connectClient = async (client: MxfClient): Promise<void> => {
        mockServiceConnect.mockImplementation(async () => {
            setImmediate(() => {
                bus._deliver(Events.Agent.CONNECTED, { agentId: CONFIG.agentId });
                bus._deliver(Events.Agent.REGISTERED, { agentId: CONFIG.agentId });
            });
        });
        await client.connect();
    };

    it('marks the client disconnected on the local agent:disconnect the socket layer emits', async () => {
        const client = new StatusClient({ ...CONFIG });
        await connectClient(client);
        expect(client.currentStatus()).toBe(ConnectionStatus.REGISTERED);
        bus.emitOn.mockClear();

        // MxfService emits this locally when the agent socket drops. The server's
        // agent:disconnected goes to the other sockets and never reaches this one.
        bus._deliver(Events.Agent.DISCONNECT, {
            agentId: CONFIG.agentId,
            data: { status: 'disconnected', reason: 'transport close' }
        });

        expect(client.currentStatus()).toBe(ConnectionStatus.DISCONNECTED);
        expect(bus.emitOn).toHaveBeenCalledWith(
            CONFIG.agentId,
            Events.Agent.STATUS_CHANGE,
            expect.objectContaining({ data: expect.objectContaining({ status: 'disconnected' }) })
        );

        // A later connect() must actually reconnect instead of seeing a stale CONNECTED.
        mockServiceConnect.mockClear();
        await connectClient(client);
        expect(mockServiceConnect).toHaveBeenCalledTimes(1);
        expect(client.currentStatus()).toBe(ConnectionStatus.REGISTERED);
    });

    it('ignores another agent\'s disconnect', async () => {
        const client = new StatusClient({ ...CONFIG });
        await connectClient(client);

        bus._deliver(Events.Agent.DISCONNECT, { agentId: 'someone-else', data: { status: 'disconnected' } });

        expect(client.currentStatus()).toBe(ConnectionStatus.REGISTERED);
    });
});

describe('MxfClient public event whitelist', () => {
    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
    });

    it('on() THROWS for an event outside the public whitelist', () => {
        const client = newClient();

        // The JSDoc has always claimed "@throws Error if event is not in public whitelist".
        // It used to only logger.warn() and silently drop the listener, so a typo'd event
        // name produced a handler that never fired, with zero feedback.
        expect(() => client.on('definitely:not:a:public:event' as any, () => { /* noop */ }))
            .toThrow(/not in the public whitelist/);
    });

    it('emit() THROWS for an event outside the public whitelist', () => {
        const client = newClient();

        expect(() => client.emit('definitely:not:a:public:event' as any, {} as any))
            .toThrow(/not in the public whitelist/);
    });

    it('on() accepts a whitelisted event and delivers payloads to the handler', () => {
        const client = newClient();
        const handler = jest.fn();

        client.on(Events.Task.ASSIGNED, handler);
        bus._deliver(Events.Task.ASSIGNED, { channelId: 'test-channel', data: { taskId: 't1' } });

        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ data: { taskId: 't1' } })
        );
    });

    it('on() returns the client for chaining', () => {
        const client = newClient();
        expect(client.on(Events.Task.ASSIGNED, () => { /* noop */ })).toBe(client);
    });
});

describe('MxfClient MCP process-management boundary', () => {
    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
    });

    it('rejects all agent-key process-management methods immediately without emitting', async () => {
        const client = newClient();
        const attempts: Array<() => Promise<unknown>> = [
            (): Promise<unknown> => client.registerExternalMcpServer({ id: 'global-tools', name: 'Global Tools' }),
            (): Promise<unknown> => client.unregisterExternalMcpServer('global-tools'),
            (): Promise<unknown> => client.registerChannelMcpServer({ id: 'channel-tools', name: 'Channel Tools' }),
            (): Promise<unknown> => client.unregisterChannelMcpServer('channel-tools')
        ];

        for (const attempt of attempts) {
            const rejection = attempt();
            await expect(rejection).rejects.toEqual(expect.objectContaining({
                name: 'AgentMcpProcessManagementError',
                code: 'MXF_ADMIN_MCP_REQUIRED',
                message: expect.stringContaining('MxfSDK')
            }));
            await expect(rejection).rejects.toBeInstanceOf(AgentMcpProcessManagementError);
        }

        expect(bus.emit).not.toHaveBeenCalled();
        expect(bus.emitOn).not.toHaveBeenCalled();
        expect(mockServiceConnect).not.toHaveBeenCalled();
    });
});

describe('MxfClient authoritative memory boundary', () => {
    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
    });

    it('deletes exact-self memory without a target and rejects a forged target', async () => {
        const client = new MemoryBoundaryClient({ ...CONFIG });
        const deleteAgentMemory = jest.fn().mockResolvedValue(true);
        Object.assign(client as unknown as Record<string, unknown>, {
            isFullyConnected: true,
            status: ConnectionStatus.CONNECTED,
            memoryHandlers: { deleteAgentMemory }
        });

        await expect(client.deleteOwnAgentMemory()).resolves.toBe(true);
        expect(deleteAgentMemory).toHaveBeenCalledWith();

        const disconnectedClient = new MemoryBoundaryClient({ ...CONFIG });
        await expect(disconnectedClient.deleteAgentMemoryWithForgedTarget('victim-agent'))
            .rejects.toThrow(/self-scoped/);
        expect(deleteAgentMemory).toHaveBeenCalledTimes(1);
        expect(mockServiceConnect).not.toHaveBeenCalled();
    });

    it('propagates authoritative GET, UPDATE, and DELETE failures for every scope', async () => {
        const client = new MemoryBoundaryClient({ ...CONFIG });
        const storageFailure = new Error('authoritative memory storage unavailable');
        const memoryHandlers = {
            getAgentMemory: jest.fn().mockRejectedValue(storageFailure),
            updateAgentMemory: jest.fn().mockRejectedValue(storageFailure),
            deleteAgentMemory: jest.fn().mockRejectedValue(storageFailure),
            getChannelMemory: jest.fn().mockRejectedValue(storageFailure),
            updateChannelMemory: jest.fn().mockRejectedValue(storageFailure),
            deleteChannelMemory: jest.fn().mockRejectedValue(storageFailure),
            getRelationshipMemory: jest.fn().mockRejectedValue(storageFailure),
            updateRelationshipMemory: jest.fn().mockRejectedValue(storageFailure),
            deleteRelationshipMemory: jest.fn().mockRejectedValue(storageFailure)
        };
        Object.assign(client as unknown as Record<string, unknown>, {
            isFullyConnected: true,
            status: ConnectionStatus.CONNECTED,
            memoryHandlers
        });
        const operations: Array<() => Promise<unknown>> = [
            (): Promise<unknown> => client.readAgentMemory(),
            (): Promise<unknown> => client.writeAgentMemory({ notes: { key: 'value' } }),
            (): Promise<unknown> => client.deleteOwnAgentMemory(),
            (): Promise<unknown> => client.readChannelMemory(CONFIG.channelId),
            (): Promise<unknown> => client.writeChannelMemory(
                CONFIG.channelId,
                { notes: { key: 'value' } }
            ),
            (): Promise<unknown> => client.deleteOwnChannelMemory(CONFIG.channelId),
            (): Promise<unknown> => client.readRelationshipMemory('peer-agent'),
            (): Promise<unknown> => client.writeRelationshipMemory(
                'peer-agent',
                { notes: { key: 'value' } }
            ),
            (): Promise<unknown> => client.deleteOwnRelationshipMemory('peer-agent')
        ];

        for (const operation of operations) {
            await expect(operation()).rejects.toThrow('authoritative memory storage unavailable');
        }
    });

    it('rejects a disconnected memory operation instead of returning null or false', async () => {
        const client = new MemoryBoundaryClient({ ...CONFIG });
        const getAgentMemory = jest.fn();
        Object.assign(client as unknown as Record<string, unknown>, {
            isFullyConnected: true,
            status: ConnectionStatus.CONNECTED,
            mxfService: { isConnected: () => false },
            memoryHandlers: { getAgentMemory }
        });

        await expect(client.readAgentMemory()).rejects.toThrow(/socket is not connected/);
        expect(getAgentMemory).not.toHaveBeenCalled();
    });
});

describe('MxfClient.off()', () => {
    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
    });

    it('removes ONLY the named handler, leaving the others subscribed', () => {
        // off(event, handler) used to warn "Removing specific handler not fully supported"
        // and then remove nothing at all.
        const client = newClient();
        const keep = jest.fn();
        const drop = jest.fn();

        client.on(Events.Task.ASSIGNED, keep);
        client.on(Events.Task.ASSIGNED, drop);

        client.off(Events.Task.ASSIGNED, drop);

        bus._deliver(Events.Task.ASSIGNED, { data: { taskId: 't1' } });

        expect(keep).toHaveBeenCalledTimes(1);
        expect(drop).not.toHaveBeenCalled();
    });

    it('removes every handler for the event when no handler is given', () => {
        const client = newClient();
        const a = jest.fn();
        const b = jest.fn();

        client.on(Events.Task.ASSIGNED, a);
        client.on(Events.Task.ASSIGNED, b);
        client.off(Events.Task.ASSIGNED);

        bus._deliver(Events.Task.ASSIGNED, { data: {} });

        expect(a).not.toHaveBeenCalled();
        expect(b).not.toHaveBeenCalled();
    });
});

describe('MxfClient subscription lifecycle', () => {
    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
        mockServiceConnect.mockImplementation(async () => {
            setImmediate(() => {
                bus._deliver(Events.Agent.CONNECTED, { agentId: CONFIG.agentId });
                bus._deliver(Events.Agent.REGISTERED, { agentId: CONFIG.agentId });
            });
        });
    });

    it('does not accumulate lifecycle listeners across a disconnect/connect cycle', async () => {
        const client = newClient();

        await client.connect();
        const afterFirstConnect = bus._totalHandlers();

        await client.disconnect();
        await client.connect();
        const afterReconnect = bus._totalHandlers();

        // Every disconnect()/connect() cycle used to stack another full set of
        // agent-lifecycle listeners, so each status change fired N times.
        expect(afterReconnect).toBe(afterFirstConnect);
    });

    it('restores a lazily registered user-input handler after reconnect', async () => {
        const client = newClient();
        client.onUserInput(async () => 'approved');

        expect(bus._handlerCount(UserInputEvents.REQUEST)).toBe(1);

        await client.connect();
        await client.disconnect();
        expect(bus._handlerCount(UserInputEvents.REQUEST)).toBe(0);

        await client.connect();
        expect(bus._handlerCount(UserInputEvents.REQUEST)).toBe(1);
    });

    it('drops consumer listeners registered with on() when disconnect() runs', async () => {
        const client = newClient();
        const handler = jest.fn();

        await client.connect();
        client.on(Events.Task.ASSIGNED, handler);

        await client.disconnect();
        bus._deliver(Events.Task.ASSIGNED, { data: {} });

        expect(handler).not.toHaveBeenCalled();
    });

    it('leaves no handlers behind at all after disconnect()', async () => {
        const client = newClient();
        await client.connect();
        await client.disconnect();

        expect(bus._totalHandlers()).toBe(0);
    });
});

describe('MxfClient.SDK_VERSION', () => {
    it('is the real version from package.json, not a build timestamp', () => {
        // It used to be `"DEV-BUILD-" + new Date().toISOString()`, which shipped to npm.
        const manifest = JSON.parse(
            readFileSync(join(__dirname, '../../../packages/sdk/package.json'), 'utf8')
        );

        expect(MxfClient.SDK_VERSION).toBe(manifest.version);
        expect(MxfClient.SDK_VERSION).not.toMatch(/DEV-BUILD/);
        expect(MxfClient.SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });
});

describe('SDK source is ESM-clean', () => {
    it('contains no CommonJS require() anywhere — this is a "type": "module" package', () => {
        // MxfClient.ts:1234 and :1316 held `eventId: require('uuid').v4()`. Node threw
        // `ReferenceError: require is not defined`; Bun silently polyfilled it, which is
        // why it shipped. connect() went straight through one of them, so EVERY
        // agent.connect() on Node threw.
        const root = join(__dirname, '../../../packages/sdk/src');
        const offenders: string[] = [];

        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    walk(full);
                } else if (entry.endsWith('.ts')) {
                    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
                        if (/(^|[^.\w])require\s*\(/.test(line)) {
                            offenders.push(`${full}:${i + 1}: ${line.trim()}`);
                        }
                    });
                }
            }
        };

        walk(root);
        expect(offenders).toEqual([]);
    });
});
