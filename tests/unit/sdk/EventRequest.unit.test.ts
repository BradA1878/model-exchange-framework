/**
 * Unit tests for awaitEventResponse — the shared request/response helper that replaced
 * 13 hand-rolled copies across MxfSDK / MxfClient / AdminHelper / McpToolHandlers /
 * MemoryHandlers.
 *
 * The contract under test:
 *   - resolves with the mapped result on a correlated success event
 *   - REJECTS on a correlated failure event (one failure contract, no `{success:false}`)
 *   - rejects on timeout
 *   - ignores responses that do not correlate
 *   - always clears its timer and unsubscribes — on every exit path
 */

import { Subject, Subscription } from 'rxjs';

// Mock EventBus.client with a controllable in-memory bus.
jest.mock('@mxf-dev/core/events/EventBus', () => {
    const handlers: Map<string, ((payload: any) => void)[]> = new Map();
    const emitted: Array<{ route: string; socketId?: string; event: string; payload: any }> = [];

    return {
        EventBus: {
            client: {
                on: jest.fn((event: string, handler: (payload: any) => void) => {
                    if (!handlers.has(event)) handlers.set(event, []);
                    handlers.get(event)!.push(handler);
                    return {
                        closed: false,
                        unsubscribe: jest.fn(function (this: any) {
                            this.closed = true;
                            const list = handlers.get(event);
                            if (list) {
                                const i = list.indexOf(handler);
                                if (i > -1) list.splice(i, 1);
                            }
                        }),
                    } as unknown as Subscription;
                }),
                emit: jest.fn((event: string, payload: any) => {
                    emitted.push({ route: 'primary', event, payload });
                }),
                emitOn: jest.fn((socketId: string, event: string, payload: any) => {
                    emitted.push({ route: 'agent', socketId, event, payload });
                }),
                // test helpers
                _deliver: (event: string, payload: any) => {
                    [...(handlers.get(event) ?? [])].forEach(h => h(payload));
                },
                _handlerCount: (event: string) => (handlers.get(event) ?? []).length,
                _emitted: () => emitted,
                _reset: () => {
                    handlers.clear();
                    emitted.length = 0;
                },
            },
        },
    };
});

import { EventBus } from '@mxf-dev/core/events/EventBus';
import {
    awaitEventResponse,
    EventRequestError,
    EventRequestTimeoutError,
} from '@mxf-dev/sdk/services/internal/EventRequest';
import { Logger } from '@mxf-dev/core/utils/Logger';

const bus = EventBus.client as any;
const logger = new Logger('error', 'EventRequestTest', 'client');

const REQUEST = 'test:request';
const SUCCESS = 'test:success';
const FAILURE = 'test:failure';

const payloadFor = (id: string) => ({
    eventId: `evt-${id}`,
    eventType: REQUEST,
    timestamp: Date.now(),
    agentId: 'agent-1',
    channelId: 'channel-1',
    data: { id },
});

const baseOptions = (id: string, overrides: Record<string, any> = {}) => ({
    emitEvent: REQUEST,
    payload: payloadFor(id) as any,
    route: { via: 'agent' as const, agentId: 'agent-1' },
    successEvent: SUCCESS,
    failureEvent: FAILURE,
    correlate: (p: any) => p?.data?.id === id,
    mapResult: (p: any) => p.data.value,
    timeoutMs: 50,
    description: `Test request ${id}`,
    logger,
    ...overrides,
});

describe('awaitEventResponse', () => {
    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
    });

    it('emits the request through the agent socket and resolves with the mapped result', async () => {
        const promise = awaitEventResponse<string>(baseOptions('a'));

        const [sent] = bus._emitted();
        expect(sent.route).toBe('agent');
        expect(sent.socketId).toBe('agent-1');
        expect(sent.event).toBe(REQUEST);

        bus._deliver(SUCCESS, { data: { id: 'a', value: 'done' } });

        await expect(promise).resolves.toBe('done');
    });

    it('emits through the primary socket when routed via primary', async () => {
        const promise = awaitEventResponse<string>(
            baseOptions('p', { route: { via: 'primary' as const } })
        );

        expect(bus._emitted()[0].route).toBe('primary');

        bus._deliver(SUCCESS, { data: { id: 'p', value: 'ok' } });
        await expect(promise).resolves.toBe('ok');
    });

    it('subscribes BEFORE emitting, so a synchronous reply is never missed', async () => {
        const promise = awaitEventResponse<string>(baseOptions('order', { timeoutMs: 20 }));

        // Both listeners must be registered before the request goes out on the wire.
        const onOrders = (bus.on as jest.Mock).mock.invocationCallOrder;
        const emitOrder = (bus.emitOn as jest.Mock).mock.invocationCallOrder[0];

        expect(onOrders).toHaveLength(2); // success + failure
        expect(emitOrder).toBeGreaterThan(Math.max(...onOrders));

        await expect(promise).rejects.toThrow(EventRequestTimeoutError);
    });

    it('REJECTS with EventRequestError on a correlated failure event', async () => {
        const promise = awaitEventResponse<string>(baseOptions('b'));

        bus._deliver(FAILURE, { data: { id: 'b', error: 'server said no' } });

        await expect(promise).rejects.toThrow(EventRequestError);
        await expect(promise).rejects.toThrow('server said no');
    });

    it('REJECTS when mapResult throws — a success event carrying success:false is a failure', async () => {
        const promise = awaitEventResponse<string>(
            baseOptions('c', {
                mapResult: (p: any) => {
                    if (p.data.success === false) {
                        throw new EventRequestError('rejected by server', SUCCESS, p);
                    }
                    return p.data.value;
                },
            })
        );

        bus._deliver(SUCCESS, { data: { id: 'c', success: false } });

        await expect(promise).rejects.toThrow('rejected by server');
    });

    it('rejects with EventRequestTimeoutError when no correlated response arrives', async () => {
        const promise = awaitEventResponse<string>(baseOptions('d', { timeoutMs: 20 }));

        await expect(promise).rejects.toThrow(EventRequestTimeoutError);
    });

    it('ignores responses that do not correlate — one request cannot complete another', async () => {
        const promise = awaitEventResponse<string>(baseOptions('mine', { timeoutMs: 60 }));

        // A response for a different server/request. This is the exact bug the MCP
        // registration flows had: they resolved on the first TOOLS_DISCOVERED event
        // they saw, regardless of which server it belonged to.
        bus._deliver(SUCCESS, { data: { id: 'someone-else', value: 'wrong tools' } });

        // Still pending; only the correctly correlated response completes it.
        bus._deliver(SUCCESS, { data: { id: 'mine', value: 'right tools' } });

        await expect(promise).resolves.toBe('right tools');
    });

    it('unsubscribes every listener after resolving', async () => {
        const promise = awaitEventResponse<string>(baseOptions('e'));
        expect(bus._handlerCount(SUCCESS)).toBe(1);
        expect(bus._handlerCount(FAILURE)).toBe(1);

        bus._deliver(SUCCESS, { data: { id: 'e', value: 'x' } });
        await promise;

        expect(bus._handlerCount(SUCCESS)).toBe(0);
        expect(bus._handlerCount(FAILURE)).toBe(0);
    });

    it('unsubscribes every listener after rejecting', async () => {
        const promise = awaitEventResponse<string>(baseOptions('f'));
        bus._deliver(FAILURE, { data: { id: 'f', error: 'nope' } });
        await expect(promise).rejects.toThrow();

        expect(bus._handlerCount(SUCCESS)).toBe(0);
        expect(bus._handlerCount(FAILURE)).toBe(0);
    });

    it('unsubscribes every listener after timing out', async () => {
        const promise = awaitEventResponse<string>(baseOptions('g', { timeoutMs: 10 }));
        await expect(promise).rejects.toThrow(EventRequestTimeoutError);

        expect(bus._handlerCount(SUCCESS)).toBe(0);
        expect(bus._handlerCount(FAILURE)).toBe(0);
    });

    it('clears the timeout on success so a short-lived script does not hang', async () => {
        const clearSpy = jest.spyOn(global, 'clearTimeout');

        const promise = awaitEventResponse<string>(baseOptions('h', { timeoutMs: 30_000 }));
        bus._deliver(SUCCESS, { data: { id: 'h', value: 'x' } });
        await promise;

        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });

    it('settles exactly once even if several correlated responses arrive', async () => {
        const mapResult = jest.fn((p: any) => p.data.value);
        const promise = awaitEventResponse<string>(baseOptions('i', { mapResult }));

        bus._deliver(SUCCESS, { data: { id: 'i', value: 'first' } });
        bus._deliver(SUCCESS, { data: { id: 'i', value: 'second' } });
        bus._deliver(FAILURE, { data: { id: 'i', error: 'late failure' } });

        await expect(promise).resolves.toBe('first');
        expect(mapResult).toHaveBeenCalledTimes(1);
    });

    it('rejects when the emit itself throws', async () => {
        (bus.emitOn as jest.Mock).mockImplementationOnce(() => {
            throw new Error('socket is gone');
        });

        await expect(awaitEventResponse<string>(baseOptions('j'))).rejects.toThrow('socket is gone');
    });

    it('works without a failure event (operations the server has no failure event for)', async () => {
        const promise = awaitEventResponse<string>(
            baseOptions('k', { failureEvent: undefined })
        );

        bus._deliver(SUCCESS, { data: { id: 'k', value: 'fine' } });
        await expect(promise).resolves.toBe('fine');
    });
});
