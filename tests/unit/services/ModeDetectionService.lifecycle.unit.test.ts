type EventHandler = (payload: { channelId: string }) => void;

const handlers = new Map<string, EventHandler[]>();
const unsubscribe = jest.fn();
const mockOn = jest.fn((eventName: string, handler: EventHandler) => {
    const eventHandlers = handlers.get(eventName) ?? [];
    eventHandlers.push(handler);
    handlers.set(eventName, eventHandlers);
    return {
        unsubscribe: jest.fn((): void => {
            unsubscribe();
            const index = eventHandlers.indexOf(handler);
            if (index >= 0) {
                eventHandlers.splice(index, 1);
            }
        })
    };
});

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { on: mockOn } }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        debug = jest.fn();
        info = jest.fn();
        warn = jest.fn();
        error = jest.fn();
    }
}));

import { ModeDetectionService } from '../../../src/server/socket/services/ModeDetectionService';

describe('ModeDetectionService lifecycle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        handlers.clear();
        unsubscribe.mockClear();
        mockOn.mockClear();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('owns and releases its interval, subscriptions, state, and singleton', async () => {
        const first = ModeDetectionService.getInstance();

        expect(jest.getTimerCount()).toBe(1);
        expect(mockOn).toHaveBeenCalledTimes(3);

        await first.detectMode('channel-a', [{
            id: 'activity-1',
            agentId: 'agent-a',
            channelId: 'channel-a',
            timestamp: Date.now(),
            type: 'tool_call',
            action: 'execute',
            details: {}
        }]);
        expect(first.getStatistics().totalChannels).toBe(1);

        first.shutdown();
        first.shutdown();

        expect(jest.getTimerCount()).toBe(0);
        expect(unsubscribe).toHaveBeenCalledTimes(3);
        expect(first.getStatistics().totalChannels).toBe(0);
        expect(Array.from(handlers.values()).every(eventHandlers => eventHandlers.length === 0))
            .toBe(true);

        const second = ModeDetectionService.getInstance();
        expect(second).not.toBe(first);
        expect(jest.getTimerCount()).toBe(1);
        second.shutdown();
    });
});
