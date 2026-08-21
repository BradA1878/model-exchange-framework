const mockEventListeners = new Map<string, (payload: unknown) => unknown>();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn((eventName: string, listener: (payload: unknown) => unknown) => {
                mockEventListeners.set(eventName, listener);
            }),
            emit: jest.fn()
        }
    }
}));

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: {
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn()
    }
}));

jest.mock('@mxf-dev/core/config/ConfigManager', () => ({
    ConfigManager: {
        getInstance: jest.fn(() => ({ setChannelSystemLlmEnabled: jest.fn() }))
    }
}));

jest.mock('@mxf-dev/core/services/ChannelContextMessageOperations', () => ({
    ChannelContextMessageOperations: jest.fn(() => ({}))
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: jest.fn(() => ({
        assert: jest.fn((condition: unknown, message: string) => {
            if (!condition) throw new Error(message);
        }),
        assertIsNonEmptyString: jest.fn((value: unknown, message: string) => {
            if (typeof value !== 'string' || value.length === 0) throw new Error(message);
        })
    }))
}));

jest.mock('../../../src/server/socket/services/McpService', () => ({
    McpService: {
        getInstance: jest.fn(() => ({
            setChannelAllowedTools: jest.fn(),
            hydrateChannelAllowedTools: jest.fn()
        }))
    }
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import { ChannelService } from '../../../src/server/socket/services/ChannelService';

describe('ChannelService message persistence identity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEventListeners.clear();
        (ChannelService as unknown as { instance?: ChannelService }).instance = undefined;
    });

    it('rejects nested sender/channel fields that differ from the trusted envelope', async () => {
        const service = ChannelService.getInstance({} as never);
        const persistSpy = jest.spyOn(
            service as unknown as { persistChannelMessage: (...args: unknown[]) => Promise<void> },
            'persistChannelMessage'
        ).mockResolvedValue(undefined);
        const listener = mockEventListeners.get(Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST);
        expect(listener).toBeDefined();

        await listener!({
            eventId: 'event-1',
            eventType: Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST,
            timestamp: Date.now(),
            agentId: 'agent-real',
            channelId: 'channel-real',
            data: {
                message: {
                    senderId: 'victim-agent',
                    context: { channelId: 'victim-channel' }
                }
            }
        });

        expect(persistSpy).not.toHaveBeenCalled();
    });
});
