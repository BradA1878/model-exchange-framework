/**
 * Primary SDK connection lifecycle regressions.
 *
 * A transient first connection failure must remain recoverable, authentication
 * state must follow the live socket, and a configured finite retry budget must
 * still produce a terminal failure that callers can recover from explicitly.
 */

const mockSocketIO = jest.fn();

jest.mock('socket.io-client', () => ({
    __esModule: true,
    default: mockSocketIO
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import type { SocketLike } from '@mxf-dev/core/events/EventBusBase';
import { AuthEvents, CoreSocketEvents, Events } from '@mxf-dev/core/events/EventNames';
import { MxfSDK, type MxfSDKConfig } from '@mxf-dev/sdk';

type Listener = (...args: unknown[]) => void;

class FakeManager {
    private readonly listeners = new Map<string, Set<Listener>>();

    public on(event: string, listener: Listener): this {
        const eventListeners = this.listeners.get(event) ?? new Set<Listener>();
        eventListeners.add(listener);
        this.listeners.set(event, eventListeners);
        return this;
    }

    public off(event: string, listener: Listener): this {
        this.listeners.get(event)?.delete(listener);
        return this;
    }

    public deliver(event: string, ...args: unknown[]): void {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(...args);
        }
    }

}

class FakeSocket {
    public connected = false;
    public active = true;
    public readonly io = new FakeManager();
    public readonly emit = jest.fn();
    public readonly disconnect = jest.fn((): this => {
        this.connected = false;
        this.active = false;
        return this;
    });
    public readonly removeAllListeners = jest.fn((): this => {
        this.listeners.clear();
        return this;
    });

    private readonly listeners = new Map<string, Set<Listener>>();
    private readonly anyListeners = new Set<Listener>();

    public on(event: string, listener: Listener): this {
        const eventListeners = this.listeners.get(event) ?? new Set<Listener>();
        eventListeners.add(listener);
        this.listeners.set(event, eventListeners);
        return this;
    }

    public off(event: string, listener?: Listener): this {
        if (listener) {
            this.listeners.get(event)?.delete(listener);
        } else {
            this.listeners.delete(event);
        }
        return this;
    }

    public onAny(listener: Listener): this {
        this.anyListeners.add(listener);
        return this;
    }

    public offAny(listener?: Listener): this {
        if (listener) {
            this.anyListeners.delete(listener);
        } else {
            this.anyListeners.clear();
        }
        return this;
    }

    public deliver(event: string, ...args: unknown[]): void {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(...args);
        }
    }

    public deliverAny(event: string, ...args: unknown[]): void {
        for (const listener of this.anyListeners) {
            listener(event, ...args);
        }
    }

    public listenerCount(event: string): number {
        return this.listeners.get(event)?.size ?? 0;
    }

    public anyListenerCount(): number {
        return this.anyListeners.size;
    }
}

interface SocketFactoryCall {
    serverUrl: string;
    options: {
        reconnection?: boolean;
        reconnectionAttempts?: number;
    };
}

const createConfig = (overrides: Partial<MxfSDKConfig> = {}): MxfSDKConfig => ({
    serverUrl: 'http://localhost:3001',
    domainKey: 'test-domain-key',
    accessToken: 'pat_test:secret',
    ...overrides
});

describe('MxfSDK connection lifecycle', () => {
    const sockets: FakeSocket[] = [];
    const calls: SocketFactoryCall[] = [];
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        sockets.length = 0;
        calls.length = 0;
        mockSocketIO.mockReset();
        mockSocketIO.mockImplementation((serverUrl: string, options: SocketFactoryCall['options']) => {
            const socket = new FakeSocket();
            sockets.push(socket);
            calls.push({ serverUrl, options });
            return socket;
        });
        EventBus.reset();
    });

    afterEach(() => {
        EventBus.reset();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    it('survives an initial boot race and authenticates on a later manager connection', async () => {
        const sdk = new MxfSDK(createConfig());
        const namedAgentSocket = new FakeSocket();
        const namedAgentOffAny = jest.spyOn(namedAgentSocket, 'offAny');
        namedAgentSocket.onAny(jest.fn());
        EventBus.client.registerSocket(
            'agent-a',
            namedAgentSocket as unknown as SocketLike
        );
        const connection = sdk.connect();
        const socket = sockets[0];
        socket.onAny(jest.fn());
        let settled = false;
        void connection.finally(() => {
            settled = true;
        });

        expect(calls[0]).toEqual(expect.objectContaining({
            serverUrl: 'http://localhost:3001',
            options: expect.objectContaining({
                reconnection: true,
                reconnectionAttempts: Number.POSITIVE_INFINITY
            })
        }));

        socket.active = true;
        socket.deliver(CoreSocketEvents.CONNECT_ERROR, new Error('server still starting'));
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(sdk.isConnected()).toBe(false);

        socket.connected = true;
        socket.io.deliver(CoreSocketEvents.RECONNECT, 1);
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });

        await expect(connection).resolves.toBeUndefined();
        expect(sdk.isConnected()).toBe(true);
        expect(sdk.getUserId()).toBe('user-a');
        expect(socket.removeAllListeners).not.toHaveBeenCalled();
        expect(socket.listenerCount(CoreSocketEvents.DISCONNECT)).toBe(1);
        expect(socket.anyListenerCount()).toBe(2);
        expect(namedAgentOffAny).not.toHaveBeenCalled();
        expect(namedAgentSocket.anyListenerCount()).toBe(2);

        EventBus.client.unregisterSocket('agent-a');
        expect(namedAgentOffAny).toHaveBeenCalledTimes(1);
        expect(namedAgentSocket.anyListenerCount()).toBe(1);
    });

    it('clears authentication on disconnect and heals it after manager re-authentication', async () => {
        const sdk = new MxfSDK(createConfig());
        const connection = sdk.connect();
        const socket = sockets[0];
        socket.connected = true;
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });
        await connection;

        socket.connected = false;
        socket.active = true;
        socket.deliver(CoreSocketEvents.DISCONNECT, 'transport close');
        expect(sdk.isConnected()).toBe(false);
        expect(sdk.getUserId()).toBeUndefined();

        socket.connected = true;
        socket.io.deliver(CoreSocketEvents.RECONNECT, 2);
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });

        expect(sdk.isConnected()).toBe(true);
        expect(sdk.getUserId()).toBe('user-a');
        expect(mockSocketIO).toHaveBeenCalledTimes(1);
    });

    it('signals a reconnect only when the socket manager restores the session on its own', async () => {
        const sdk = new MxfSDK(createConfig());
        const reconnects: Array<{ userId: string; attempt: number | null }> = [];
        const busEvents: unknown[] = [];
        EventBus.client.on(Events.Sdk.RECONNECTED, (payload) => { busEvents.push(payload); });
        sdk.onReconnected((info) => { reconnects.push(info); });

        const connection = sdk.connect();
        const socket = sockets[0];
        socket.connected = true;
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });
        await connection;

        // The first authentication settled connect(); it is not a reconnect.
        expect(reconnects).toEqual([]);

        socket.connected = false;
        socket.deliver(CoreSocketEvents.DISCONNECT, 'transport close');
        socket.connected = true;
        socket.io.deliver(CoreSocketEvents.RECONNECT, 3);
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });

        expect(reconnects).toEqual([{ userId: 'user-a', attempt: 3 }]);
        expect(busEvents).toHaveLength(1);
        expect(busEvents[0]).toMatchObject({
            eventType: Events.Sdk.RECONNECTED,
            agentId: 'user-a',
            data: { userId: 'user-a', attempt: 3 }
        });
        // A local lifecycle signal must not be sent back over the socket.
        expect(socket.emit).not.toHaveBeenCalledWith(Events.Sdk.RECONNECTED, expect.anything());
    });

    it('stops delivering reconnect signals after the listener unsubscribes', async () => {
        const sdk = new MxfSDK(createConfig());
        const listener = jest.fn();
        const unsubscribe = sdk.onReconnected(listener);

        const connection = sdk.connect();
        const socket = sockets[0];
        socket.connected = true;
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });
        await connection;

        unsubscribe();
        socket.connected = false;
        socket.deliver(CoreSocketEvents.DISCONNECT, 'transport close');
        socket.connected = true;
        socket.io.deliver(CoreSocketEvents.RECONNECT, 1);
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });

        expect(listener).not.toHaveBeenCalled();
    });

    it('keeps the server-confirmed identity when connect() is called on a live SDK', async () => {
        const sdk = new MxfSDK(createConfig());
        const connection = sdk.connect();
        const socket = sockets[0];
        socket.connected = true;
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });
        await connection;

        // A redundant connect() is a no-op: no new socket, no re-authentication...
        await sdk.connect();
        expect(mockSocketIO).toHaveBeenCalledTimes(1);

        // ...so it must not replace the confirmed identity with the config
        // placeholder that every admin request is stamped with.
        const creation = sdk.createChannel('channel-1', { name: 'Channel 1' });
        const createCall = socket.emit.mock.calls.find(([event]) => event === Events.Channel.CREATE);
        expect(createCall?.[1]).toEqual(expect.objectContaining({ agentId: 'user-a' }));

        socket.deliverAny(Events.Channel.CREATED, {
            eventType: Events.Channel.CREATED,
            agentId: 'user-a',
            channelId: 'channel-1',
            data: { channelId: 'channel-1' }
        });
        await expect(creation).resolves.toBeDefined();
    });

    it('rejects malformed authentication success without trusting a placeholder identity', async () => {
        const sdk = new MxfSDK(createConfig());
        const connection = sdk.connect();
        const socket = sockets[0];
        socket.connected = true;

        socket.deliver(AuthEvents.SUCCESS, { userId: '   ' });

        await expect(connection).rejects.toThrow(
            'Authentication succeeded without a valid server-confirmed userId'
        );
        expect(sdk.isConnected()).toBe(false);
        expect(sdk.getUserId()).toBeUndefined();
        expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('releases only its EventBus primary listener on explicit disconnect', async () => {
        const sdk = new MxfSDK(createConfig());
        const connection = sdk.connect();
        const socket = sockets[0];
        const externalAnyListener = jest.fn();
        socket.onAny(externalAnyListener);
        socket.connected = true;
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });
        await connection;
        expect(socket.anyListenerCount()).toBe(2);

        await sdk.disconnect();

        expect(socket.anyListenerCount()).toBe(1);
        socket.deliverAny(Events.Agent.STATUS_CHANGE, { ignored: true });
        expect(externalAnyListener).toHaveBeenCalledTimes(1);
        expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('rejects after a configured retry budget is exhausted and permits a fresh connect', async () => {
        const sdk = new MxfSDK(createConfig({ reconnectionAttempts: 2 }));
        const firstConnection = sdk.connect();
        const firstSocket = sockets[0];

        firstSocket.deliver(CoreSocketEvents.CONNECT_ERROR, new Error('unavailable'));
        firstSocket.io.deliver(CoreSocketEvents.RECONNECT_FAILED);

        await expect(firstConnection).rejects.toThrow(/reconnection attempts exhausted/i);
        expect(sdk.isConnected()).toBe(false);
        expect(firstSocket.disconnect).toHaveBeenCalledTimes(1);

        const secondConnection = sdk.connect();
        const secondSocket = sockets[1];
        secondSocket.connected = true;
        secondSocket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });

        await expect(secondConnection).resolves.toBeUndefined();
        expect(mockSocketIO).toHaveBeenCalledTimes(2);
        expect(sdk.isConnected()).toBe(true);
    });

    it('shares one in-flight connection across concurrent callers', async () => {
        const sdk = new MxfSDK(createConfig());
        const firstConnection = sdk.connect();
        const secondConnection = sdk.connect();
        const socket = sockets[0];

        expect(mockSocketIO).toHaveBeenCalledTimes(1);
        socket.connected = true;
        socket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });

        await expect(Promise.all([firstConnection, secondConnection])).resolves.toEqual([
            undefined,
            undefined
        ]);
    });

    it('cancels a pending connection when disconnect is explicit', async () => {
        const sdk = new MxfSDK(createConfig());
        const connection = sdk.connect();
        const rejection = expect(connection).rejects.toThrow(/cancelled by disconnect/i);

        await sdk.disconnect();

        await rejection;
        expect(sdk.isConnected()).toBe(false);
        expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    });

    it('waits for an in-flight disconnect before reconnecting', async () => {
        const sdk = new MxfSDK(createConfig());
        const firstConnection = sdk.connect();
        const firstSocket = sockets[0];
        firstSocket.connected = true;
        firstSocket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });
        await firstConnection;

        let releaseAgentDisconnect!: () => void;
        const deferredAgentDisconnect = new Promise<void>(resolve => {
            releaseAgentDisconnect = resolve;
        });
        const agentDisconnect = jest.fn(() => deferredAgentDisconnect);
        (sdk as unknown as {
            agents: Map<string, { disconnect: () => Promise<void> }>;
        }).agents.set('agent-a', { disconnect: agentDisconnect });

        const disconnect = sdk.disconnect();
        const reconnect = sdk.connect();
        await Promise.resolve();

        expect(agentDisconnect).toHaveBeenCalledTimes(1);
        expect(mockSocketIO).toHaveBeenCalledTimes(1);

        releaseAgentDisconnect();
        await disconnect;

        expect(firstSocket.disconnect).toHaveBeenCalledTimes(1);
        expect(mockSocketIO).toHaveBeenCalledTimes(2);

        const secondSocket = sockets[1];
        secondSocket.connected = true;
        secondSocket.deliver(AuthEvents.SUCCESS, { userId: 'user-a' });

        await expect(reconnect).resolves.toBeUndefined();
        expect(sdk.isConnected()).toBe(true);
    });
});
