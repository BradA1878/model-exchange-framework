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
            expect(() => EventBus.server.emit(TEST_EVENT, badPayload as any)).toThrow(
                /null|undefined/
            );
        });

        it('throws on a raw object payload that skipped the schema helpers', () => {
            expect(() =>
                EventBus.server.emit(TEST_EVENT, { status: 'ready' } as any)
            ).toThrow(/Invalid payload/);
        });

        it('throws on an empty event name', () => {
            expect(() => EventBus.server.emit('' as any, payload())).toThrow();
        });

        it('applies the SAME contract on the client bus', () => {
            // The client bus used to swallow this and push a raw, helper-less
            // payload straight into the Subject, bypassing the validation that
            // had just rejected the caller.
            expect(() => EventBus.client.emit(TEST_EVENT, null as any)).toThrow();
            expect(() =>
                EventBus.client.emit(TEST_EVENT, { status: 'ready' } as any)
            ).toThrow(/Invalid payload/);
        });

        it('accepts a payload built with createBaseEventPayload', () => {
            expect(() => EventBus.server.emit(TEST_EVENT, payload())).not.toThrow();
        });

        it('publishes a schema-valid error event when an emit fails', () => {
            const errorHandler = jest.fn();
            EventBus.server.on(Events.Agent.ERROR, errorHandler);

            expect(() => EventBus.server.emit(TEST_EVENT, {} as any)).toThrow();

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
            const subscription = EventBus.server.on(TEST_EVENT, jest.fn());
            expect(EventBus.server.listenerCount(TEST_EVENT)).toBe(1);

            subscription.unsubscribe();

            // Unsubscribing the RxJS handle stops delivery immediately.
            const handler = jest.fn();
            EventBus.server.on(OTHER_EVENT, handler);
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
});
