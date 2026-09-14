/** A new transport must receive its own handlers without rebuilding local subscriptions. */
const mockSocketIO = jest.fn();

jest.mock('socket.io-client', () => ({
    __esModule: true,
    default: mockSocketIO
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events, AuthEvents, CoreSocketEvents } from '@mxf-dev/core/events/EventNames';
import {
    createAgentEventPayload,
    createBaseEventPayload,
    createControlLoopEventPayload,
    createTaskEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MxfService } from '@mxf-dev/sdk/services/MxfService';

type Listener = (...args: unknown[]) => void;

/** Socket.IO boundary with separate outbound emission and inbound delivery. */
class TestSocket {
    public connected = false;
    public active = true;
    public readonly emit = jest.fn();
    public readonly disconnect = jest.fn((): void => {
        this.active = false;
        this.connected = false;
    });
    private readonly listeners = new Map<string, Set<Listener>>();
    private readonly anyListeners = new Set<Listener>();

    public constructor(public readonly id: string) {}

    public on(event: string, listener: Listener): this {
        const listeners = this.listeners.get(event) ?? new Set<Listener>();
        listeners.add(listener);
        this.listeners.set(event, listeners);
        return this;
    }

    public off(event: string, listener: Listener): this {
        this.listeners.get(event)?.delete(listener);
        return this;
    }

    public onAny(listener: Listener): this {
        this.anyListeners.add(listener);
        return this;
    }

    public offAny(listener: Listener): this {
        this.anyListeners.delete(listener);
        return this;
    }

    public deliver(event: string, ...args: unknown[]): void {
        // Socket.IO reserved lifecycle events do not pass through onAny.
        if (!Object.values(CoreSocketEvents).includes(event)) {
            for (const listener of this.anyListeners) {
                listener(event, ...args);
            }
        }
        for (const listener of this.listeners.get(event) ?? []) {
            listener(...args);
        }
    }

    public listenerCount(event: string): number {
        return this.listeners.get(event)?.size ?? 0;
    }

    public totalListenerCount(): number {
        return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
    }

    public anyListenerCount(): number {
        return this.anyListeners.size;
    }
}

const AGENT_ID = 'replacement-agent';
const CHANNEL_ID = 'replacement-channel';
const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const acceptConnection = (socket: TestSocket): void => {
    socket.connected = true;
    socket.deliver(CoreSocketEvents.CONNECT);
    socket.deliver(AuthEvents.SUCCESS, {
        ...createBaseEventPayload(AuthEvents.SUCCESS, AGENT_ID, CHANNEL_ID, {}),
        channelConfig: { name: socket.id },
        activeAgents: [AGENT_ID]
    });
    socket.deliver(
        Events.Agent.CONNECTED,
        createAgentEventPayload(Events.Agent.CONNECTED, AGENT_ID, CHANNEL_ID, { status: 'connected' })
    );
};

const deliverWorkEvents = (socket: TestSocket): void => {
    socket.deliver(
        Events.ControlLoop.STARTED,
        createControlLoopEventPayload(Events.ControlLoop.STARTED, AGENT_ID, CHANNEL_ID, {
            loopId: 'loop-1', status: 'running'
        })
    );
    socket.deliver(
        Events.Orpar.REASON,
        {
            ...createBaseEventPayload(Events.Orpar.REASON, AGENT_ID, CHANNEL_ID, { analysis: 'Received work' }),
            loopId: 'loop-1',
            cycleNumber: 1
        }
    );
    socket.deliver(
        Events.Task.COMPLETED,
        createTaskEventPayload(Events.Task.COMPLETED, AGENT_ID, CHANNEL_ID, {
            taskId: 'task-1',
            task: {
                id: 'task-1',
                title: 'Finished work',
                description: 'Verify completion delivery after transport replacement',
                status: 'completed',
                assignmentStrategy: 'manual'
            }
        })
    );
};

describe('MxfService socket replacement', () => {
    const sockets: TestSocket[] = [];
    let service: MxfService;

    beforeEach(() => {
        jest.useFakeTimers();
        EventBus.reset();
        sockets.length = 0;
        mockSocketIO.mockReset();
        mockSocketIO.mockImplementation((): TestSocket => {
            const socket = new TestSocket(`socket-${sockets.length + 1}`);
            sockets.push(socket);
            return socket;
        });
        service = new MxfService(CHANNEL_ID, { serverUrl: 'http://mxf.test' }, {}, logger);
        service.setAgentId(AGENT_ID);
    });

    afterEach(async () => {
        await service.disconnect();
        EventBus.reset();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('replaces a remotely disconnected socket and preserves local subscribers', async () => {
        const onControl = jest.fn();
        const onOrpar = jest.fn();
        const onTask = jest.fn();
        const onPublicTask = jest.fn();
        EventBus.client.on(Events.ControlLoop.STARTED, onControl);
        EventBus.client.on(Events.Orpar.REASON, onOrpar);
        service.onTaskCompleted(onTask);
        service.on(Events.Task.COMPLETED, onPublicTask);

        const firstConnection = service.connect();
        const first = sockets[0];
        acceptConnection(first);
        await expect(firstConnection).resolves.toBe(true);
        service.unsubscribe();
        expect(first.emit).toHaveBeenCalledWith(
            Events.Agent.LEAVE_CHANNEL,
            expect.objectContaining({ agentId: AGENT_ID, channelId: CHANNEL_ID })
        );
        first.connected = false;
        first.deliver(CoreSocketEvents.DISCONNECT, 'io server disconnect');
        expect(service.isConnected()).toBe(false);

        const replacementConnection = service.connect();
        const replacement = sockets[1];
        expect(first.totalListenerCount()).toBe(0);
        expect(first.anyListenerCount()).toBe(0);
        expect(first.disconnect).toHaveBeenCalledTimes(1);
        expect(first.active).toBe(false);
        acceptConnection(replacement);
        await expect(replacementConnection).resolves.toBe(true);
        expect(service.isConnected()).toBe(true);
        expect(service.getChannelConfig()).toEqual({ name: replacement.id });
        expect(service.getActiveAgents()).toEqual([AGENT_ID]);

        // A retired transport cannot republish events or alter the new connection.
        deliverWorkEvents(first);
        first.deliver(CoreSocketEvents.DISCONNECT, 'late retired transport event');
        expect(service.isConnected()).toBe(true);
        deliverWorkEvents(replacement);
        expect(onControl).toHaveBeenCalledTimes(1);
        expect(onOrpar).toHaveBeenCalledTimes(1);
        expect(onTask).toHaveBeenCalledTimes(1);
        expect(onPublicTask).toHaveBeenCalledTimes(1);
        expect(replacement.anyListenerCount()).toBe(1);
        expect(replacement.listenerCount(CoreSocketEvents.DISCONNECT)).toBe(1);

        replacement.connected = false;
        replacement.deliver(CoreSocketEvents.DISCONNECT, 'transport close');
        expect(service.isConnected()).toBe(false);
    });

    it('keeps one set of handlers during automatic reconnect on the same socket', async () => {
        const onControl = jest.fn();
        const onOrpar = jest.fn();
        const onTask = jest.fn();
        EventBus.client.on(Events.ControlLoop.STARTED, onControl);
        EventBus.client.on(Events.Orpar.REASON, onOrpar);
        service.onTaskCompleted(onTask);
        const connection = service.connect();
        const socket = sockets[0];
        acceptConnection(socket);
        await connection;
        const initialCount = socket.totalListenerCount();

        for (let attempt = 0; attempt < 3; attempt++) {
            socket.connected = false;
            socket.deliver(CoreSocketEvents.DISCONNECT, 'transport close');
            expect(service.isConnected()).toBe(false);
            acceptConnection(socket);
            expect(service.isConnected()).toBe(true);
            deliverWorkEvents(socket);
            expect(socket.totalListenerCount()).toBe(initialCount);
            expect(socket.anyListenerCount()).toBe(1);
        }

        expect(mockSocketIO).toHaveBeenCalledTimes(1);
        expect(socket.disconnect).not.toHaveBeenCalled();
        expect(onControl).toHaveBeenCalledTimes(3);
        expect(onOrpar).toHaveBeenCalledTimes(3);
        expect(onTask).toHaveBeenCalledTimes(3);
    });

    it('rebuilds socket and task handlers after explicit disconnect and connect', async () => {
        const onControl = jest.fn();
        const onOrpar = jest.fn();
        const onTask = jest.fn();
        EventBus.client.on(Events.ControlLoop.STARTED, onControl);
        EventBus.client.on(Events.Orpar.REASON, onOrpar);
        service.onTaskCompleted(onTask);
        const connection = service.connect();
        const first = sockets[0];
        acceptConnection(first);
        await connection;
        await service.disconnect();
        expect(first.totalListenerCount()).toBe(0);
        expect(first.anyListenerCount()).toBe(0);
        expect(first.active).toBe(false);

        const nextConnection = service.connect();
        const next = sockets[1];
        acceptConnection(next);
        await expect(nextConnection).resolves.toBe(true);
        deliverWorkEvents(next);
        expect(onControl).toHaveBeenCalledTimes(1);
        expect(onOrpar).toHaveBeenCalledTimes(1);
        expect(onTask).toHaveBeenCalledTimes(1);
        expect(next.anyListenerCount()).toBe(1);
        expect(next.listenerCount(CoreSocketEvents.DISCONNECT)).toBe(1);
        expect(jest.getTimerCount()).toBe(0);
    });
});
