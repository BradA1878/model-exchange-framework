const mockAxios = jest.fn();

jest.mock('axios', () => ({
    __esModule: true,
    default: (config: unknown): unknown => mockAxios(config)
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import { MemoryPersistenceLevel } from '@mxf-dev/core/types/MemoryTypes';
import { ApiService } from '@mxf-dev/sdk/services/MxfApiService';

const agentMemory = {
    id: 'agent-memory-a',
    agentId: 'agent-a',
    createdAt: new Date(1),
    updatedAt: new Date(2),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: { source: 'canonical' },
    conversationHistory: [],
    customData: {}
};

const channelMemory = {
    id: 'channel-memory-a',
    channelId: 'channel-a',
    createdAt: new Date(1),
    updatedAt: new Date(2),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: { source: 'canonical' },
    sharedState: {},
    conversationHistory: [],
    customData: {}
};

const relationshipMemory = {
    id: 'relationship-memory-a',
    agentId1: 'agent-a',
    agentId2: 'agent-b',
    channelId: 'channel-a',
    createdAt: new Date(1),
    updatedAt: new Date(2),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: { source: 'canonical' },
    interactionHistory: [],
    customData: {}
};

describe('ApiService canonical memory payloads', () => {
    let service: ApiService;

    beforeEach(() => {
        mockAxios.mockReset();
        service = new ApiService({
            baseUrl: 'https://mxf.test/api',
            keyId: 'key-a',
            secretKey: 'secret-a'
        });
    });

    it.each([
        {
            label: 'agent',
            memory: agentMemory,
            call: (target: ApiService): Promise<unknown> => target.getOrCreateAgentMemory('key-a'),
            expectedUrl: 'https://mxf.test/api/agents/memory/key-a'
        },
        {
            label: 'channel',
            memory: channelMemory,
            call: (target: ApiService): Promise<unknown> => target.getOrCreateChannelMemory('channel-a'),
            expectedUrl: 'https://mxf.test/api/channels/memory/channel-a'
        },
        {
            label: 'relationship',
            memory: relationshipMemory,
            call: (target: ApiService): Promise<unknown> => target.getOrCreateRelationshipMemory(
                'agent-a',
                'agent-b',
                'channel-a'
            ),
            expectedUrl: 'https://mxf.test/api/relationships/memory/channel-a/agent-a/agent-b'
        }
    ])('returns the actual $label memory instead of the HTTP envelope', async ({ memory, call, expectedUrl }) => {
        mockAxios.mockResolvedValueOnce({ data: { success: true, data: memory } });

        await expect(call(service)).resolves.toEqual(memory);
        expect(mockAxios).toHaveBeenCalledWith(expect.objectContaining({
            method: 'GET',
            url: expectedUrl,
            headers: expect.objectContaining({
                'x-key-id': 'key-a',
                'x-secret-key': 'secret-a'
            })
        }));
    });

    it('uses the mounted relationship PATCH route and leaves server-owned identity fields untouched', async () => {
        mockAxios.mockResolvedValueOnce({
            data: { success: true, data: relationshipMemory }
        });

        const update = { notes: { verified: true } };
        await expect(service.updateRelationshipMemory(
            'agent-a',
            'agent-b',
            'channel-a',
            update
        )).resolves.toEqual(relationshipMemory);

        expect(mockAxios).toHaveBeenCalledWith(expect.objectContaining({
            method: 'PATCH',
            url: 'https://mxf.test/api/relationships/memory/channel-a/agent-a/agent-b',
            data: update
        }));
    });

    it('fails when a successful memory response has no payload', async () => {
        mockAxios.mockResolvedValueOnce({ data: { success: true } });

        await expect(service.getOrCreateChannelMemory('channel-a'))
            .rejects.toThrow('Memory API returned no memory payload');
    });
});
