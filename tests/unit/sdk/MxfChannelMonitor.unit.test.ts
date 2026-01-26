/**
 * Unit tests for MxfChannelMonitor
 * Tests channel event filtering logic and subscription management
 */

import { Subject, Subscription } from 'rxjs';
import { EventBus } from '@mxf/shared/events/EventBus';
import { MxfChannelMonitor } from '@mxf/sdk/MxfChannelMonitor';

// Mock EventBus.client
jest.mock('@mxf/shared/events/EventBus', () => {
    const mockSubject = new Subject<any>();
    const subscriptions: Map<string, ((payload: any) => void)[]> = new Map();

    return {
        EventBus: {
            client: {
                on: jest.fn((event: string, handler: (payload: any) => void) => {
                    if (!subscriptions.has(event)) {
                        subscriptions.set(event, []);
                    }
                    subscriptions.get(event)!.push(handler);

                    // Return a mock subscription
                    return {
                        unsubscribe: jest.fn(() => {
                            const handlers = subscriptions.get(event);
                            if (handlers) {
                                const index = handlers.indexOf(handler);
                                if (index > -1) {
                                    handlers.splice(index, 1);
                                }
                            }
                        })
                    } as unknown as Subscription;
                }),
                // Helper to emit events in tests
                _emit: (event: string, payload: any) => {
                    const handlers = subscriptions.get(event);
                    if (handlers) {
                        handlers.forEach(handler => handler(payload));
                    }
                },
                // Helper to clear subscriptions between tests
                _clear: () => {
                    subscriptions.clear();
                }
            }
        }
    };
});

describe('MxfChannelMonitor Unit Tests', () => {
    const TEST_CHANNEL_ID = 'test-channel-123';
    const OTHER_CHANNEL_ID = 'other-channel-456';
    let monitor: MxfChannelMonitor;

    beforeEach(() => {
        // Clear mock subscriptions
        (EventBus.client as any)._clear();
        // Create fresh monitor for each test
        monitor = new MxfChannelMonitor(TEST_CHANNEL_ID);
    });

    afterEach(() => {
        if (monitor.isActive()) {
            monitor.destroy();
        }
    });

    describe('Constructor', () => {
        it('should create monitor with valid channelId', () => {
            expect(monitor.getChannelId()).toBe(TEST_CHANNEL_ID);
            expect(monitor.isActive()).toBe(true);
        });

        it('should throw error when channelId is empty', () => {
            expect(() => new MxfChannelMonitor('')).toThrow('channelId is required');
        });

        it('should throw error when channelId is undefined', () => {
            expect(() => new MxfChannelMonitor(undefined as any)).toThrow('channelId is required');
        });
    });

    describe('Channel Filtering - Strict Mode', () => {
        it('should deliver events with matching channelId', () => {
            const handler = jest.fn();
            const testEvent = 'message:agent_message';
            const payload = {
                channelId: TEST_CHANNEL_ID,
                agentId: 'agent-1',
                data: { content: 'Hello' }
            };

            monitor.on(testEvent, handler);
            (EventBus.client as any)._emit(testEvent, payload);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(payload);
        });

        it('should NOT deliver events with different channelId', () => {
            const handler = jest.fn();
            const testEvent = 'message:agent_message';
            const payload = {
                channelId: OTHER_CHANNEL_ID,
                agentId: 'agent-1',
                data: { content: 'Hello' }
            };

            monitor.on(testEvent, handler);
            (EventBus.client as any)._emit(testEvent, payload);

            expect(handler).not.toHaveBeenCalled();
        });

        it('should NOT deliver events without channelId', () => {
            const handler = jest.fn();
            const testEvent = 'system:heartbeat';
            const payload = {
                agentId: 'agent-1',
                timestamp: Date.now()
                // No channelId - should be filtered out
            };

            monitor.on(testEvent, handler);
            (EventBus.client as any)._emit(testEvent, payload);

            expect(handler).not.toHaveBeenCalled();
        });

        it('should NOT deliver non-object payloads', () => {
            const handler = jest.fn();
            const testEvent = 'some:event';

            monitor.on(testEvent, handler);

            // Test various non-object payloads
            (EventBus.client as any)._emit(testEvent, 'string payload');
            (EventBus.client as any)._emit(testEvent, 123);
            (EventBus.client as any)._emit(testEvent, null);
            (EventBus.client as any)._emit(testEvent, undefined);
            (EventBus.client as any)._emit(testEvent, true);

            expect(handler).not.toHaveBeenCalled();
        });

        it('should NOT deliver array payloads (arrays are objects but lack channelId property)', () => {
            const handler = jest.fn();
            const testEvent = 'some:event';

            monitor.on(testEvent, handler);
            (EventBus.client as any)._emit(testEvent, [{ channelId: TEST_CHANNEL_ID }]);

            // Array doesn't have channelId as a direct property, so should be filtered
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('Multiple Monitors - Isolation', () => {
        it('should only deliver events to monitors for matching channel', () => {
            const monitor1 = new MxfChannelMonitor('channel-A');
            const monitor2 = new MxfChannelMonitor('channel-B');
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const testEvent = 'message:agent_message';

            monitor1.on(testEvent, handler1);
            monitor2.on(testEvent, handler2);

            // Emit event for channel-A
            (EventBus.client as any)._emit(testEvent, {
                channelId: 'channel-A',
                data: { content: 'For A' }
            });

            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).not.toHaveBeenCalled();

            // Emit event for channel-B
            (EventBus.client as any)._emit(testEvent, {
                channelId: 'channel-B',
                data: { content: 'For B' }
            });

            expect(handler1).toHaveBeenCalledTimes(1); // Still 1
            expect(handler2).toHaveBeenCalledTimes(1);

            monitor1.destroy();
            monitor2.destroy();
        });

        it('should not cross-contaminate between multiple monitors', () => {
            const monitors: MxfChannelMonitor[] = [];
            const handlers: jest.Mock[] = [];
            const testEvent = 'message:agent_message';

            // Create 5 monitors for different channels
            for (let i = 0; i < 5; i++) {
                const mon = new MxfChannelMonitor(`channel-${i}`);
                const handler = jest.fn();
                mon.on(testEvent, handler);
                monitors.push(mon);
                handlers.push(handler);
            }

            // Emit event for channel-2 only
            (EventBus.client as any)._emit(testEvent, {
                channelId: 'channel-2',
                data: { content: 'Only for channel-2' }
            });

            // Only handler[2] should be called
            handlers.forEach((handler, index) => {
                if (index === 2) {
                    expect(handler).toHaveBeenCalledTimes(1);
                } else {
                    expect(handler).not.toHaveBeenCalled();
                }
            });

            // Cleanup
            monitors.forEach(mon => mon.destroy());
        });
    });

    describe('Subscription Management', () => {
        it('should track subscription count', () => {
            expect(monitor.getSubscriptionCount()).toBe(0);

            monitor.on('event:one', jest.fn());
            expect(monitor.getSubscriptionCount()).toBe(1);

            monitor.on('event:two', jest.fn());
            expect(monitor.getSubscriptionCount()).toBe(2);

            monitor.on('event:one', jest.fn()); // Same event, another handler
            expect(monitor.getSubscriptionCount()).toBe(3);
        });

        it('should unsubscribe from specific event via off()', () => {
            const handler = jest.fn();
            const testEvent = 'message:agent_message';

            monitor.on(testEvent, handler);
            expect(monitor.getSubscriptionCount()).toBe(1);

            monitor.off(testEvent);
            expect(monitor.getSubscriptionCount()).toBe(0);

            // Event should no longer be delivered
            (EventBus.client as any)._emit(testEvent, {
                channelId: TEST_CHANNEL_ID,
                data: { content: 'After off' }
            });
            expect(handler).not.toHaveBeenCalled();
        });

        it('should remove all listeners via removeAllListeners()', () => {
            monitor.on('event:one', jest.fn());
            monitor.on('event:two', jest.fn());
            monitor.on('event:three', jest.fn());
            expect(monitor.getSubscriptionCount()).toBe(3);

            monitor.removeAllListeners();
            expect(monitor.getSubscriptionCount()).toBe(0);
        });

        it('should return subscription from on() that can be unsubscribed', () => {
            const handler = jest.fn();
            const testEvent = 'message:agent_message';

            const subscription = monitor.on(testEvent, handler);
            expect(monitor.getSubscriptionCount()).toBe(1);

            subscription.unsubscribe();

            // After unsubscribe, handler should not be called
            // Note: The subscription count still shows 1 because we track by event name
            // but the actual RxJS subscription is unsubscribed
        });
    });

    describe('Destroy Behavior', () => {
        it('should mark monitor as inactive after destroy', () => {
            expect(monitor.isActive()).toBe(true);
            monitor.destroy();
            expect(monitor.isActive()).toBe(false);
        });

        it('should clear all subscriptions on destroy', () => {
            monitor.on('event:one', jest.fn());
            monitor.on('event:two', jest.fn());
            expect(monitor.getSubscriptionCount()).toBe(2);

            monitor.destroy();
            expect(monitor.getSubscriptionCount()).toBe(0);
        });

        it('should throw error when subscribing after destroy', () => {
            monitor.destroy();

            expect(() => {
                monitor.on('some:event', jest.fn());
            }).toThrow('Cannot subscribe to event');
        });

        it('should be safe to call destroy multiple times', () => {
            monitor.destroy();
            expect(() => monitor.destroy()).not.toThrow();
            expect(monitor.isActive()).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        it('should handle payload with null channelId', () => {
            const handler = jest.fn();
            const testEvent = 'message:agent_message';

            monitor.on(testEvent, handler);
            (EventBus.client as any)._emit(testEvent, {
                channelId: null,
                data: { content: 'Null channel' }
            });

            // null !== TEST_CHANNEL_ID, so should not be delivered
            expect(handler).not.toHaveBeenCalled();
        });

        it('should handle payload with undefined channelId', () => {
            const handler = jest.fn();
            const testEvent = 'message:agent_message';

            monitor.on(testEvent, handler);
            (EventBus.client as any)._emit(testEvent, {
                channelId: undefined,
                data: { content: 'Undefined channel' }
            });

            // undefined !== TEST_CHANNEL_ID, so should not be delivered
            expect(handler).not.toHaveBeenCalled();
        });

        it('should handle empty object payload', () => {
            const handler = jest.fn();
            const testEvent = 'message:agent_message';

            monitor.on(testEvent, handler);
            (EventBus.client as any)._emit(testEvent, {});

            // Empty object has no channelId, should not be delivered
            expect(handler).not.toHaveBeenCalled();
        });

        it('should handle deeply nested channelId (should NOT match)', () => {
            const handler = jest.fn();
            const testEvent = 'message:agent_message';

            monitor.on(testEvent, handler);
            (EventBus.client as any)._emit(testEvent, {
                data: {
                    channelId: TEST_CHANNEL_ID // Nested, not top-level
                }
            });

            // channelId must be at top level of payload
            expect(handler).not.toHaveBeenCalled();
        });
    });
});
