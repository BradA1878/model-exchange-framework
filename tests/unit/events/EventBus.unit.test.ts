/**
 * Unit tests for the MXF event bus.
 *
 * The bus is the most load-bearing module in the repo and, until now, had no
 * unit tests — every other suite jest.mock()s it, so nothing ever exercised the
 * real implementation. These tests pin the behaviours that were silently broken:
 *
 *   - once() unsubscribing after exactly one delivery (it used to key its
 *     registry entry by an internal wrapper, so off() never found it, the RxJS
 *     subscription was never disposed, and the "one-shot" listener fired on
 *     EVERY later event while the subscription leaked).
 *   - a single emit error contract across both buses (the client swallowed
 *     errors and injected a raw payload; the server threw).
 *   - payload validation that cannot be bypassed.
 *   - accurate subscriber counts.
 *   - removeAllListeners() disposing only the subscriptions the bus owns —
 *     both buses share one RxJS Subject, so reaching into it took out the other
 *     bus's subscribers too.
 */

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';

const TEST_EVENT = Events.Agent.STATUS_CHANGE;
const OTHER_EVENT = Events.Agent.CONNECTED;

/** Build a schema-valid payload for the bus. */
const payload = (data: Record<string, unknown> = { status: 'ready' }) =>
    createBaseEventPayload(TEST_EVENT, 'agent-1', 'channel-1', data, { source: 'EventBus.unit.test' });

describe('EventBus', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        // Errors are always written now (a library must not swallow them), so
        // the deliberate-failure tests below would otherwise spam the reporter.
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        EventBus.reset();
    });

    afterEach(() => {
        EventBus.reset();
        consoleErrorSpy.mockRestore();
    });

    describe('on()', () => {
        it('delivers the payload to the handler', () => {
            const handler = jest.fn();
            EventBus.server.on(TEST_EVENT, handler);

            const sent = payload({ status: 'busy' });
            EventBus.server.emit(TEST_EVENT, sent);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(sent);
        });

        it('delivers to every handler subscribed to the event', () => {
            const first = jest.fn();
            const second = jest.fn();
            EventBus.server.on(TEST_EVENT, first);
            EventBus.server.on(TEST_EVENT, second);

            EventBus.server.emit(TEST_EVENT, payload());

            expect(first).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
        });

        it('does not deliver events the handler did not subscribe to', () => {
            const handler = jest.fn();
            EventBus.server.on(TEST_EVENT, handler);

            EventBus.server.emit(
                OTHER_EVENT,
                createBaseEventPayload(OTHER_EVENT, 'agent-1', 'channel-1', {})
            );

            expect(handler).not.toHaveBeenCalled();
        });

        it('keeps the subscription alive when a handler throws', () => {
            const exploding = jest.fn(() => {
                throw new Error('handler blew up');
            });
            const healthy = jest.fn();

            EventBus.server.on(TEST_EVENT, exploding);
            EventBus.server.on(TEST_EVENT, healthy);

            EventBus.server.emit(TEST_EVENT, payload());
            EventBus.server.emit(TEST_EVENT, payload());

            // The thrower keeps being called, and it never took the other one down.
            expect(exploding).toHaveBeenCalledTimes(2);
            expect(healthy).toHaveBeenCalledTimes(2);
        });

        it('drains accepted async handler work before resources are closed', async () => {
            let releaseHandler!: () => void;
            const handlerFinished = new Promise<void>(resolve => {
                releaseHandler = resolve;
            });
            const handler = jest.fn(async (): Promise<void> => {
                await handlerFinished;
            });
            EventBus.server.on(TEST_EVENT, handler);

            EventBus.server.emit(TEST_EVENT, payload());
            expect(EventBus.server.pendingHandlerCount()).toBe(1);

            const drained = jest.fn();
            const drainPromise = EventBus.drain().then(drained);
            await Promise.resolve();
            expect(drained).not.toHaveBeenCalled();

            releaseHandler();
            await drainPromise;
            expect(drained).toHaveBeenCalledTimes(1);
            expect(EventBus.server.pendingHandlerCount()).toBe(0);
        });

        it('drains re-entrant work published to the other bus', async () => {
            let releaseNested!: () => void;
            const nestedFinished = new Promise<void>(resolve => {
                releaseNested = resolve;
            });

            EventBus.server.on(TEST_EVENT, async (): Promise<void> => {
                await Promise.resolve();
                EventBus.client.on(OTHER_EVENT, async (): Promise<void> => {
                    await nestedFinished;
                });
                EventBus.server.emit(
                    OTHER_EVENT,
                    createBaseEventPayload(OTHER_EVENT, 'agent-1', 'channel-1', {})
                );
            });

            EventBus.server.emit(TEST_EVENT, payload());
            const drainPromise = EventBus.drain();
            await Promise.resolve();
            await Promise.resolve();

            expect(EventBus.client.pendingHandlerCount()).toBe(1);
            releaseNested();
            await drainPromise;
            expect(EventBus.client.pendingHandlerCount()).toBe(0);
        });

        it('observes rejected handlers and still completes the drain', async () => {
            EventBus.server.on(TEST_EVENT, async (): Promise<void> => {
                throw new Error('async persistence failed');
            });

            EventBus.server.emit(TEST_EVENT, payload());
            await expect(EventBus.drain()).resolves.toBeUndefined();
            expect(consoleErrorSpy.mock.calls.some((call: unknown[]) => call.some((argument: unknown) =>
                String(argument).includes("Async handler for 'agent:status:change' rejected")
            ))).toBe(true);
        });
    });

    describe('once()', () => {
        it('fires exactly once no matter how many events arrive', () => {
            const handler = jest.fn();
            EventBus.server.once(TEST_EVENT, handler);

            EventBus.server.emit(TEST_EVENT, payload());
            EventBus.server.emit(TEST_EVENT, payload());
            EventBus.server.emit(TEST_EVENT, payload());

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('disposes its RxJS subscription after the first delivery', () => {
            const subscription = EventBus.server.once(TEST_EVENT, jest.fn());

            expect(subscription.closed).toBe(false);

            EventBus.server.emit(TEST_EVENT, payload());

            // This is the leak: the subscription used to stay open forever.
            expect(subscription.closed).toBe(true);
        });

        it('drops the handler from the registry once it has fired', () => {
            EventBus.server.once(TEST_EVENT, jest.fn());
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(1);

            EventBus.server.emit(TEST_EVENT, payload());

            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
            expect(EventBus.server.hasSubscribers(TEST_EVENT)).toBe(false);
        });

        it('does not accumulate handlers across repeated request/response cycles', () => {
            // This is the MemoryHandlers pattern: one once() per request. Each
            // stale handler used to stay subscribed forever, so request N was
            // delivered to all N-1 earlier handlers as well.
            const handlers: jest.Mock[] = [];

            for (let i = 0; i < 5; i++) {
                const handler = jest.fn();
                handlers.push(handler);
                EventBus.server.once(TEST_EVENT, handler);
                EventBus.server.emit(TEST_EVENT, payload({ status: `reply-${i}` }));
            }

            // Every handler saw its own event and nothing else.
            handlers.forEach((handler, i) => {
                expect(handler).toHaveBeenCalledTimes(1);
                expect(handler.mock.calls[0][0].data).toEqual({ status: `reply-${i}` });
            });

            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
        });

        it('can be cancelled with off() before the event arrives', () => {
            const handler = jest.fn();
            const subscription = EventBus.server.once(TEST_EVENT, handler);

            // off() takes the ORIGINAL handler, not an internal wrapper.
            EventBus.server.off(TEST_EVENT, handler);

            EventBus.server.emit(TEST_EVENT, payload());

            expect(handler).not.toHaveBeenCalled();
            expect(subscription.closed).toBe(true);
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
        });

        it('still unsubscribes when the handler throws', () => {
            const handler = jest.fn(() => {
                throw new Error('once handler blew up');
            });
            const subscription = EventBus.server.once(TEST_EVENT, handler);

            EventBus.server.emit(TEST_EVENT, payload());
            EventBus.server.emit(TEST_EVENT, payload());

            expect(handler).toHaveBeenCalledTimes(1);
            expect(subscription.closed).toBe(true);
        });

        it('works the same on the client bus', () => {
            const handler = jest.fn();
            const subscription = EventBus.client.once(TEST_EVENT, handler);

            EventBus.client.emit(TEST_EVENT, payload());
            EventBus.client.emit(TEST_EVENT, payload());

            expect(handler).toHaveBeenCalledTimes(1);
            expect(subscription.closed).toBe(true);
            expect(EventBus.client.listenerCount(TEST_EVENT)).toBe(0);
        });
    });

    describe('off()', () => {
        it('removes only the named handler', () => {
            const kept = jest.fn();
            const removed = jest.fn();
            EventBus.server.on(TEST_EVENT, kept);
            EventBus.server.on(TEST_EVENT, removed);

            EventBus.server.off(TEST_EVENT, removed);
            EventBus.server.emit(TEST_EVENT, payload());

            expect(kept).toHaveBeenCalledTimes(1);
            expect(removed).not.toHaveBeenCalled();
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(1);
        });

        it('removes every handler for the event when no handler is given', () => {
            EventBus.server.on(TEST_EVENT, jest.fn());
            EventBus.server.on(TEST_EVENT, jest.fn());
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(2);

            EventBus.server.off(TEST_EVENT);

            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
        });

        it('is a no-op for an event with no handlers', () => {
            expect(() => EventBus.server.off(TEST_EVENT)).not.toThrow();
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
        });
    });

    describe('emit() error contract', () => {
        it.each([
            ['null', null],
            ['undefined', undefined]
        ])('throws when the payload is %s', (_label, badPayload) => {
            expect(() => EventBus.server.emit(
                TEST_EVENT,
                badPayload as unknown as ReturnType<typeof payload>
            )).toThrow(
                /null|undefined/
            );
        });

        it('throws on a raw object payload that skipped the schema helpers', () => {
            expect(() =>
                EventBus.server.emit(
                    TEST_EVENT,
                    { status: 'ready' } as unknown as ReturnType<typeof payload>
                )
            ).toThrow(/Invalid payload/);
        });

        it('throws on an empty event name', () => {
            expect(() => EventBus.server.emit('' as typeof TEST_EVENT, payload())).toThrow();
        });

        it('applies the SAME contract on the client bus', () => {
            // The client bus used to swallow this and push a raw, helper-less
            // payload straight into the Subject, bypassing the validation that
            // had just rejected the caller.
            expect(() => EventBus.client.emit(
                TEST_EVENT,
                null as unknown as ReturnType<typeof payload>
            )).toThrow();
            expect(() =>
                EventBus.client.emit(
                    TEST_EVENT,
                    { status: 'ready' } as unknown as ReturnType<typeof payload>
                )
            ).toThrow(/Invalid payload/);
        });

        it('accepts a payload built with createBaseEventPayload', () => {
            expect(() => EventBus.server.emit(TEST_EVENT, payload())).not.toThrow();
        });

        it('publishes a schema-valid error event when an emit fails', () => {
            const errorHandler = jest.fn();
            EventBus.server.on(Events.Agent.ERROR, errorHandler);

            expect(() => EventBus.server.emit(
                TEST_EVENT,
                {} as unknown as ReturnType<typeof payload>
            )).toThrow();

            expect(errorHandler).toHaveBeenCalledTimes(1);
            const errorPayload = errorHandler.mock.calls[0][0];

            // The bus must obey the payload rules it enforces on everyone else.
            expect(errorPayload).toHaveProperty('eventId');
            expect(errorPayload).toHaveProperty('eventType', Events.Agent.ERROR);
            expect(errorPayload).toHaveProperty('agentId');
            expect(errorPayload).toHaveProperty('channelId');
            expect(errorPayload).toHaveProperty('timestamp');
            expect(errorPayload.data).toHaveProperty('event', TEST_EVENT);
        });
    });

    describe('subscriber counts', () => {
        it('tracks counts as handlers come and go', () => {
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
            expect(EventBus.server.hasSubscribers(TEST_EVENT)).toBe(false);
            expect(EventBus.server.hasListeners(TEST_EVENT)).toBe(false);

            const first = jest.fn();
            EventBus.server.on(TEST_EVENT, first);
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(1);
            expect(EventBus.server.hasSubscribers(TEST_EVENT)).toBe(true);

            EventBus.server.on(TEST_EVENT, jest.fn());
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(2);

            EventBus.server.off(TEST_EVENT, first);
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(1);

            EventBus.server.off(TEST_EVENT);
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
            expect(EventBus.server.hasListeners(TEST_EVENT)).toBe(false);
        });

        it('drops the count when a subscription is unsubscribed directly', () => {
            const handler = jest.fn();
            const subscription = EventBus.server.on(TEST_EVENT, handler);
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(1);

            subscription.unsubscribe();

            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
            EventBus.server.emit(TEST_EVENT, payload());
            expect(handler).not.toHaveBeenCalled();
        });

        it('drops a pending once handler when its subscription is unsubscribed directly', () => {
            const handler = jest.fn();
            const subscription = EventBus.server.once(TEST_EVENT, handler);
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(1);

            subscription.unsubscribe();

            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(0);
            EventBus.server.emit(TEST_EVENT, payload());
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('onAll()', () => {
        it('receives every event with its type', () => {
            const seen: string[] = [];
            EventBus.server.onAll((eventType) => seen.push(eventType));

            EventBus.server.emit(TEST_EVENT, payload());
            EventBus.server.emit(
                OTHER_EVENT,
                createBaseEventPayload(OTHER_EVENT, 'agent-1', 'channel-1', {})
            );

            expect(seen).toEqual([TEST_EVENT, OTHER_EVENT]);
        });

        it('drops registry bookkeeping when unsubscribed directly', () => {
            const subscription = EventBus.server.onAll(jest.fn());
            expect(EventBus.server.allListenerCount()).toBe(1);

            subscription.unsubscribe();

            expect(EventBus.server.allListenerCount()).toBe(0);
        });
    });

    describe('categories', () => {
        it('unsubscribes a whole category at once', () => {
            const first = jest.fn();
            const second = jest.fn();
            const untouched = jest.fn();

            EventBus.server.onWithCategory('feature-a', TEST_EVENT, first);
            EventBus.server.onWithCategory('feature-a', OTHER_EVENT, second);
            EventBus.server.onWithCategory('feature-b', TEST_EVENT, untouched);

            EventBus.server.unsubscribeCategory('feature-a');

            EventBus.server.emit(TEST_EVENT, payload());

            expect(first).not.toHaveBeenCalled();
            expect(untouched).toHaveBeenCalledTimes(1);
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(1);
            expect(EventBus.server.listenerCount(OTHER_EVENT)).toBe(0);
        });
    });

    describe('removeAllListeners()', () => {
        it('removes handlers for a single event only', () => {
            const target = jest.fn();
            const survivor = jest.fn();
            EventBus.server.on(TEST_EVENT, target);
            EventBus.server.on(OTHER_EVENT, survivor);

            EventBus.server.removeAllListeners(TEST_EVENT);

            EventBus.server.emit(TEST_EVENT, payload());
            EventBus.server.emit(
                OTHER_EVENT,
                createBaseEventPayload(OTHER_EVENT, 'agent-1', 'channel-1', {})
            );

            expect(target).not.toHaveBeenCalled();
            expect(survivor).toHaveBeenCalledTimes(1);
        });

        it('leaves the OTHER bus alone even though both share one Subject', () => {
            // The old implementation assigned eventSubject.observers = [], which
            // reached across into every subscriber of the shared Subject.
            const serverHandler = jest.fn();
            const clientHandler = jest.fn();

            EventBus.server.on(TEST_EVENT, serverHandler);
            EventBus.client.on(TEST_EVENT, clientHandler);

            EventBus.server.removeAllListeners();

            EventBus.client.emit(TEST_EVENT, payload());

            expect(serverHandler).not.toHaveBeenCalled();
            expect(clientHandler).toHaveBeenCalledTimes(1);
        });
    });

    describe('shared Subject', () => {
        it('delivers a server-bus emit to client-bus subscribers', () => {
            // Both buses push into the same Subject. This is why emitting the
            // same event on BOTH buses (as ConfigManager used to) delivered two
            // copies to every local subscriber.
            const clientHandler = jest.fn();
            EventBus.client.on(TEST_EVENT, clientHandler);

            EventBus.server.emit(TEST_EVENT, payload());

            expect(clientHandler).toHaveBeenCalledTimes(1);
        });
    });

    describe('process-global client socket ingress', () => {
        const socket = (): {
            connected: boolean;
            on: jest.Mock;
            off: jest.Mock;
            emit: jest.Mock;
            onAny: jest.Mock;
            offAny: jest.Mock;
            disconnect: jest.Mock;
            deliver: (event: string, eventPayload: unknown) => void;
            anyListenerCount: () => number;
        } => {
            const inboundHandlers = new Set<(event: string, eventPayload: unknown) => void>();
            return {
                connected: true,
                on: jest.fn(),
                off: jest.fn(),
                emit: jest.fn(),
                onAny: jest.fn(handler => {
                    inboundHandlers.add(handler);
                }),
                offAny: jest.fn((handler?: (event: string, eventPayload: unknown) => void) => {
                    if (handler) {
                        inboundHandlers.delete(handler);
                    } else {
                        inboundHandlers.clear();
                    }
                }),
                disconnect: jest.fn(),
                deliver: (event, eventPayload): void => {
                    for (const handler of inboundHandlers) {
                        handler(event, eventPayload);
                    }
                },
                anyListenerCount: (): number => inboundHandlers.size,
            };
        };

        it('detaches only EventBus transport listeners during reset', () => {
            const primarySocket = socket();
            const namedSocket = socket();
            const externalPrimaryListener = jest.fn();
            const externalNamedListener = jest.fn();
            primarySocket.onAny(externalPrimaryListener);
            namedSocket.onAny(externalNamedListener);

            EventBus.client.setClientSocket(primarySocket);
            EventBus.client.registerSocket('agent-1', namedSocket);
            expect(primarySocket.anyListenerCount()).toBe(2);
            expect(namedSocket.anyListenerCount()).toBe(2);

            EventBus.reset();

            expect(primarySocket.anyListenerCount()).toBe(1);
            expect(namedSocket.anyListenerCount()).toBe(1);
            primarySocket.deliver(TEST_EVENT, payload());
            namedSocket.deliver(TEST_EVENT, payload());
            expect(externalPrimaryListener).toHaveBeenCalledTimes(1);
            expect(externalNamedListener).toHaveBeenCalledTimes(1);

            const freshHandler = jest.fn();
            EventBus.client.on(TEST_EVENT, freshHandler);
            EventBus.client.setClientSocket(primarySocket);
            primarySocket.deliver(TEST_EVENT, payload());

            expect(primarySocket.anyListenerCount()).toBe(2);
            expect(externalPrimaryListener).toHaveBeenCalledTimes(2);
            expect(freshHandler).toHaveBeenCalledTimes(1);
        });

        it('publishes one typed room envelope once across multiple local sockets', () => {
            const firstSocket = socket();
            const secondSocket = socket();
            const handler = jest.fn();
            EventBus.client.on(TEST_EVENT, handler);
            EventBus.client.registerSocket('agent-1', firstSocket);
            EventBus.client.registerSocket('agent-2', secondSocket);

            const firstEnvelope = createBaseEventPayload(
                TEST_EVENT,
                'agent-1',
                'channel-1',
                { status: 'first' },
                { eventId: 'shared-room-event-1' }
            );
            firstSocket.deliver(TEST_EVENT, firstEnvelope);
            secondSocket.deliver(TEST_EVENT, firstEnvelope);
            secondSocket.deliver(TEST_EVENT, firstEnvelope);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenLastCalledWith(firstEnvelope);

            const secondEnvelope = createBaseEventPayload(
                TEST_EVENT,
                'agent-1',
                'channel-1',
                { status: 'second' },
                { eventId: 'shared-room-event-2' }
            );
            firstSocket.deliver(TEST_EVENT, secondEnvelope);
            secondSocket.deliver(TEST_EVENT, secondEnvelope);

            expect(handler).toHaveBeenCalledTimes(2);
            expect(handler).toHaveBeenLastCalledWith(secondEnvelope);
        });

        it('does not conflate legacy raw socket deliveries without an eventId', () => {
            const firstSocket = socket();
            const secondSocket = socket();
            const handler = jest.fn();
            EventBus.client.on(TEST_EVENT, handler);
            EventBus.client.registerSocket('agent-1', firstSocket);
            EventBus.client.registerSocket('agent-2', secondSocket);
            const rawPayload = { status: 'legacy-raw' };

            firstSocket.deliver(TEST_EVENT, rawPayload);
            secondSocket.deliver(TEST_EVENT, rawPayload);

            expect(handler).toHaveBeenCalledTimes(2);
        });

        it('clears exact-envelope history on disconnect', () => {
            const firstSocket = socket();
            const handler = jest.fn();
            EventBus.client.on(TEST_EVENT, handler);
            EventBus.client.registerSocket('agent-1', firstSocket);
            const envelope = createBaseEventPayload(
                TEST_EVENT,
                'agent-1',
                'channel-1',
                { status: 'reconnect' },
                { eventId: 'replayed-after-reconnect' }
            );
            firstSocket.deliver(TEST_EVENT, envelope);

            EventBus.client.disconnect();
            const reconnectedSocket = socket();
            EventBus.client.registerSocket('agent-1', reconnectedSocket);
            reconnectedSocket.deliver(TEST_EVENT, envelope);

            expect(handler).toHaveBeenCalledTimes(2);
        });
    });
});
