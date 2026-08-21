/**
 * Channel creation must persist an explicit SystemLLM opt-out and update the
 * server-side guard. This is the server half of TestSDK's paid-LLM safety path.
 */

const mockSavedChannelFields: Array<Record<string, unknown>> = [];
const mockFindOne = jest.fn();
const mockSaveChannel = jest.fn();
const mockSetChannelSystemLlmEnabled = jest.fn();
const mockSetChannelAllowedTools = jest.fn().mockResolvedValue(undefined);
const mockHydrateChannelAllowedTools = jest.fn();

jest.mock('@mxf-dev/core/models/channel', () => {
    const Channel = jest.fn().mockImplementation((fields: Record<string, unknown>) => ({
        ...fields,
        save: jest.fn(async () => {
            mockSavedChannelFields.push(fields);
            await mockSaveChannel(fields);
        })
    }));

    Object.assign(Channel, {
        findOne: mockFindOne,
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn()
    });

    return { Channel };
});

jest.mock('@mxf-dev/core/config/ConfigManager', () => ({
    ConfigManager: {
        getInstance: jest.fn().mockReturnValue({
            setChannelSystemLlmEnabled: mockSetChannelSystemLlmEnabled
        })
    }
}));

jest.mock('@mxf-dev/core/services/ChannelContextMessageOperations', () => ({
    ChannelContextMessageOperations: jest.fn()
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn(),
            emit: jest.fn()
        }
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: jest.fn().mockReturnValue({
        assert: jest.fn((condition: unknown, message: string) => {
            if (!condition) throw new Error(message);
        }),
        assertIsNonEmptyString: jest.fn((value: unknown, message: string) => {
            if (typeof value !== 'string' || value.length === 0) throw new Error(message);
        })
    })
}));

jest.mock('../../../src/server/socket/services/McpService', () => ({
    McpService: {
        getInstance: jest.fn().mockReturnValue({
            setChannelAllowedTools: mockSetChannelAllowedTools,
            hydrateChannelAllowedTools: mockHydrateChannelAllowedTools
        })
    }
}));

import { ChannelService } from '../../../src/server/socket/services/ChannelService';

describe('ChannelService SystemLLM persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSavedChannelFields.length = 0;
        mockFindOne.mockResolvedValue(null);
        mockSaveChannel.mockResolvedValue(undefined);
        mockSetChannelAllowedTools.mockResolvedValue(undefined);
        mockHydrateChannelAllowedTools.mockReset();
        (ChannelService as unknown as { instance?: ChannelService }).instance = undefined;
    });

    it('persists false and installs a disabled server-side guard', async () => {
        const service = ChannelService.getInstance({} as never);

        const channel = await service.createChannel(
            'safe-test-channel',
            'Safe test channel',
            'test-user',
            { systemLlmEnabled: false }
        );

        expect(channel).not.toBeNull();
        expect(mockSavedChannelFields).toHaveLength(1);
        expect(mockSavedChannelFields[0].systemLlmEnabled).toBe(false);
        expect(mockSetChannelSystemLlmEnabled).toHaveBeenCalledWith(
            false,
            'safe-test-channel',
            'Channel created with systemLlmEnabled=false'
        );
    });

    it.each(['system', 'NO_CHANNEL', 'global', 'system:workflows'])(
        'rejects externally claimable reserved channel id %s before persistence',
        async (channelId) => {
            const service = ChannelService.getInstance({} as never);

            await expect(service.createChannel(
                channelId,
                'Reserved channel',
                'test-user'
            )).rejects.toThrow(/reserved for internal MXF routing/i);

            expect(mockFindOne).not.toHaveBeenCalled();
            expect(mockSavedChannelFields).toHaveLength(0);
        }
    );

    it('hydrates persisted allowedTools before a cold-loaded participant joins', async () => {
        const persistedTools = ['memory_get', 'task_complete'];
        const channelDocument = {
            channelId: 'cold-channel',
            name: 'Cold channel',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            description: '',
            participants: [],
            isPrivate: false,
            createdBy: 'owner-1',
            systemLlmEnabled: false,
            allowedTools: persistedTools
        };
        mockFindOne.mockResolvedValue(channelDocument);
        const findOneAndUpdate = (jest.requireMock('@mxf-dev/core/models/channel') as {
            Channel: { findOneAndUpdate: jest.Mock }
        }).Channel.findOneAndUpdate;
        findOneAndUpdate.mockResolvedValue(channelDocument);
        const service = ChannelService.getInstance({} as never);

        await expect(service.addParticipant(
            'cold-channel',
            'agent-1',
            'agent-1'
        )).resolves.toBe(true);

        expect(mockHydrateChannelAllowedTools).toHaveBeenCalledWith(
            'cold-channel',
            persistedTools
        );
        expect(mockHydrateChannelAllowedTools.mock.invocationCallOrder[0]).toBeLessThan(
            findOneAndUpdate.mock.invocationCallOrder[0]
        );
    });

    it('hydrates an empty persisted channel policy as no extra restriction', async () => {
        const channelDocument = {
            channelId: 'open-channel',
            name: 'Open channel',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            description: '',
            participants: [],
            isPrivate: false,
            createdBy: 'owner-1',
            allowedTools: []
        };
        mockFindOne.mockResolvedValue(channelDocument);
        const findOneAndUpdate = (jest.requireMock('@mxf-dev/core/models/channel') as {
            Channel: { findOneAndUpdate: jest.Mock }
        }).Channel.findOneAndUpdate;
        findOneAndUpdate.mockResolvedValue(channelDocument);
        const service = ChannelService.getInstance({} as never);

        await expect(service.addParticipant(
            'open-channel',
            'agent-1',
            'agent-1'
        )).resolves.toBe(true);

        expect(mockHydrateChannelAllowedTools).toHaveBeenCalledWith(
            'open-channel',
            []
        );
    });

    it('hydrates persisted policy during duplicate-key recovery', async () => {
        const persistedTools = ['memory_get'];
        const existingChannel = {
            channelId: 'raced-channel',
            name: 'Existing channel',
            createdBy: 'owner-1',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            participants: [],
            allowedTools: persistedTools
        };
        mockFindOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(existingChannel);
        mockSaveChannel.mockRejectedValueOnce(new Error('E11000 duplicate key'));
        const service = ChannelService.getInstance({} as never);

        await expect(service.createChannel(
            'raced-channel',
            'Raced channel',
            'owner-1'
        )).resolves.toEqual(expect.objectContaining({ id: 'raced-channel' }));

        expect(mockHydrateChannelAllowedTools).toHaveBeenCalledWith(
            'raced-channel',
            persistedTools
        );
    });

    it('rejects a foreign owner that wins the insert after a not-found preflight', async () => {
        const foreignChannel = {
            channelId: 'contended-channel',
            name: 'Foreign channel',
            createdBy: 'other-owner',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            participants: [],
            allowedTools: ['foreign-only-tool']
        };
        mockFindOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(foreignChannel);
        mockSaveChannel.mockRejectedValueOnce(new Error('E11000 duplicate key'));
        const service = ChannelService.getInstance({} as never);

        await expect(service.createChannel(
            'contended-channel',
            'Requested channel',
            'requesting-owner'
        )).resolves.toBeNull();

        expect(mockHydrateChannelAllowedTools).not.toHaveBeenCalledWith(
            'contended-channel',
            ['foreign-only-tool']
        );
    });
});
