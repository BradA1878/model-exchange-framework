import { of, throwError } from 'rxjs';

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { MemoryPersistenceLevel } from '@mxf-dev/core/types/MemoryTypes';
import { MxfService } from '@mxf-dev/sdk/services/MxfService';
import {
    ApiService,
    ChannelMemory
} from '@mxf-dev/sdk/services/MxfApiService';
import { MxfMemoryService } from '@mxf-dev/sdk/services/MxfMemoryService';

const AGENT_ID = 'service-memory-agent';
const CHANNEL_ID = 'service-memory-channel';

const channelMemory: ChannelMemory = {
    id: 'channel-memory-id',
    channelId: CHANNEL_ID,
    createdAt: new Date(1),
    updatedAt: new Date(2),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: { saved: true },
    sharedState: {},
    conversationHistory: [],
    customData: {}
};

const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
};

const createService = (): MxfService => {
    const service = new MxfService(
        CHANNEL_ID,
        { serverUrl: 'http://mxf.test' },
        {},
        logger
    );
    service.setAgentId(AGENT_ID);
    return service;
};

const injectApiService = (service: MxfService, apiService: ApiService | null): void => {
    (service as unknown as { apiService: ApiService | null }).apiService = apiService;
};

const resetMemoryService = (): void => {
    (MxfMemoryService as unknown as { instance?: MxfMemoryService }).instance = undefined;
};

describe('MxfService canonical memory boundaries', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        EventBus.reset();
        resetMemoryService();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
        resetMemoryService();
    });

    it('returns the canonical HTTP channel memory and propagates read failures', async () => {
        const getOrCreateChannelMemory = jest.fn<Promise<ChannelMemory>, [string]>()
            .mockResolvedValueOnce(channelMemory)
            .mockRejectedValueOnce(new Error('canonical HTTP read failed'));
        const service = createService();
        injectApiService(service, { getOrCreateChannelMemory } as unknown as ApiService);

        await expect(service.getSharedMemory()).resolves.toBe(channelMemory);
        await expect(service.getSharedMemory()).rejects.toThrow('canonical HTTP read failed');
        expect(getOrCreateChannelMemory).toHaveBeenNthCalledWith(1, CHANNEL_ID);
        expect(getOrCreateChannelMemory).toHaveBeenNthCalledWith(2, CHANNEL_ID);
    });

    it('fails immediately when shared-memory HTTP access is not configured', async () => {
        const service = createService();
        injectApiService(service, null);

        await expect(service.getSharedMemory()).rejects.toThrow(/API service is required/);
    });

    it('performs exactly one HTTP shared-memory mutation and does not duplicate it on EventBus', async () => {
        const updateChannelMemory = jest.fn<
            Promise<ChannelMemory>,
            [string, Partial<ChannelMemory>]
        >().mockResolvedValue(channelMemory);
        const service = createService();
        injectApiService(service, { updateChannelMemory } as unknown as ApiService);
        const emitSpy = jest.spyOn(EventBus.client, 'emitOn');
        const update = { notes: { saved: true } };

        await expect(service.updateSharedMemory(update)).resolves.toBe(channelMemory);

        expect(updateChannelMemory).toHaveBeenCalledTimes(1);
        expect(updateChannelMemory).toHaveBeenCalledWith(CHANNEL_ID, update);
        expect(emitSpy).not.toHaveBeenCalled();
    });

    it('surfaces the exact HTTP persistence failure instead of returning null', async () => {
        const failure = new Error('canonical HTTP write failed');
        const updateChannelMemory = jest.fn<
            Promise<ChannelMemory>,
            [string, Partial<ChannelMemory>]
        >().mockRejectedValue(failure);
        const service = createService();
        injectApiService(service, { updateChannelMemory } as unknown as ApiService);

        await expect(service.updateSharedMemory({ notes: { lost: false } }))
            .rejects.toBe(failure);
        expect(updateChannelMemory).toHaveBeenCalledTimes(1);
    });

    it('routes shared conversation append through the caller-scoped atomic boundary', async () => {
        const entry = { messageId: 'new-message', content: 'new' };
        const authoritativeHistory = [
            { messageId: 'existing-message', content: 'existing' },
            entry
        ];
        const appendSpy = jest.spyOn(
            MxfMemoryService.getInstance(),
            'appendChannelMessages'
        ).mockReturnValue(of(authoritativeHistory));
        const service = createService();

        await expect(service.addToSharedConversationHistory(entry))
            .resolves.toBe(authoritativeHistory);
        expect(appendSpy).toHaveBeenCalledTimes(1);
        expect(appendSpy).toHaveBeenCalledWith(AGENT_ID, CHANNEL_ID, [entry]);
    });

    it('surfaces the exact atomic append failure instead of returning null', async () => {
        const failure = new Error('atomic message persistence failed');
        jest.spyOn(
            MxfMemoryService.getInstance(),
            'appendChannelMessages'
        ).mockReturnValue(throwError(() => failure));
        const service = createService();

        await expect(service.addToSharedConversationHistory({ content: 'new' }))
            .rejects.toBe(failure);
    });

    it('cancels a pending raw memory append during explicit disconnect', async () => {
        const socket = {
            connected: true,
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn(),
            onAny: jest.fn(),
            offAny: jest.fn(),
            disconnect: jest.fn()
        };
        const service = createService();
        (service as unknown as { socket: typeof socket }).socket = socket;
        EventBus.client.registerSocket(AGENT_ID, socket);

        const append = service.addToSharedConversationHistory({ content: 'pending' });
        await service.disconnect();

        await expect(append).rejects.toThrow(/disconnected explicitly/);
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_ERROR)).toBe(0);
        expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });
});
