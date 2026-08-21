type EventHandler = (payload: unknown) => Promise<void> | void;
const mockHandlers = new Map<string, EventHandler[]>();
const mockOn = jest.fn((eventName: string, handler: EventHandler) => {
    const handlers = mockHandlers.get(eventName) ?? [];
    handlers.push(handler);
    mockHandlers.set(eventName, handlers);
    return {
        unsubscribe: jest.fn(() => {
            const index = handlers.indexOf(handler);
            if (index >= 0) handlers.splice(index, 1);
        })
    };
});

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { on: mockOn, emit: jest.fn() } }
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: {
        getInstance: jest.fn(() => ({ getServiceForChannel: jest.fn(() => null) }))
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        debug = jest.fn();
        info = jest.fn();
        warn = jest.fn();
        error = jest.fn();
    }
}));

import { AgentEvents } from '@mxf-dev/core/events/event-definitions/AgentEvents';
import { ControlLoopEvents } from '@mxf-dev/core/events/event-definitions/ControlLoopEvents';
import { MessageEvents } from '@mxf-dev/core/events/event-definitions/MessageEvents';
import { Events } from '@mxf-dev/core/events/EventNames';
import { EphemeralEventPatternService } from '../../../src/server/socket/services/EphemeralEventPatternService';

const deliver = async (eventName: string, payload: unknown): Promise<void> => {
    await Promise.all((mockHandlers.get(eventName) ?? []).map(handler => handler(payload)));
};

describe('EphemeralEventPatternService identity', () => {
    it('initializes once and keeps one agent activity per exact channel', async () => {
        const service = EphemeralEventPatternService.getInstance();

        await service.initialize();
        await service.initialize();

        expect(mockOn.mock.calls.filter(([eventName]) => eventName === AgentEvents.CONNECTED)).toHaveLength(1);
        await deliver(AgentEvents.CONNECTED, {
            agentId: 'shared-agent',
            channelId: 'channel-a',
            data: {}
        });
        await deliver(AgentEvents.CONNECTED, {
            agentId: 'shared-agent',
            channelId: 'channel-b',
            data: {}
        });

        expect(Array.from(service.getAgentActivities().values()).map(activity => activity.channelId).sort())
            .toEqual(['channel-a', 'channel-b']);

        await deliver(AgentEvents.DISCONNECTED, {
            agentId: 'shared-agent',
            channelId: 'channel-a',
            data: {}
        });

        expect(Array.from(service.getAgentActivities().values()).map(activity => activity.channelId))
            .toEqual(['channel-b']);

        await deliver(Events.Mcp.TOOL_RESULT, {
            agentId: 'shared-agent',
            channelId: 'channel-b',
            data: { toolName: 'actual_tool', result: { ok: true } }
        });
        expect(Array.from(service.getAgentActivities().values())[0]?.toolUsage)
            .toEqual(['actual_tool']);

        service.shutdown();
        expect(Array.from(mockHandlers.values()).every(handlers => handlers.length === 0)).toBe(true);
        expect(service.getAgentActivities().size).toBe(0);

        await service.initialize();
        expect(mockOn.mock.calls.filter(([eventName]) => eventName === AgentEvents.CONNECTED))
            .toHaveLength(2);

        await deliver(Events.Mcp.TOOL_RESULT, {
            agentId: 'cold-tool-agent',
            channelId: 'channel-c',
            data: { toolName: 'first_tool', result: { ok: true } }
        });
        await deliver(MessageEvents.CHANNEL_MESSAGE, {
            agentId: 'cold-message-agent',
            channelId: 'channel-c',
            data: { message: { content: { data: 'first message' } } }
        });
        await deliver(ControlLoopEvents.PLAN, {
            agentId: 'cold-plan-agent',
            channelId: 'channel-c',
            data: {}
        });

        const activities = Array.from(service.getAgentActivities().values());
        expect(activities.find(activity => activity.agentId === 'cold-tool-agent')?.toolUsage)
            .toEqual(['first_tool']);
        expect(activities.find(activity => activity.agentId === 'cold-message-agent')?.recentMessages)
            .toHaveLength(1);
        expect(activities.find(activity => activity.agentId === 'cold-plan-agent')?.currentOrparPhase)
            .toBe('planning');

        service.shutdown();
    });
});
