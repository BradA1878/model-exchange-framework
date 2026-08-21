import { Request, Response } from 'express';

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: {
        find: jest.fn(),
        findOne: jest.fn()
    }
}));

jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: { getInstance: jest.fn(() => ({})) }
}));

jest.mock('../../../src/server/socket/services/ChannelKeyService', () => ({
    __esModule: true,
    default: {},
    CreatedChannelKey: {}
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { emit: jest.fn() } }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('../../../src/server/api/services/MemoryPersistenceService', () => ({
    MemoryPersistenceService: {
        getInstance: jest.fn(() => ({ deleteMemory: jest.fn() }))
    }
}));

import { Channel } from '@mxf-dev/core/models/channel';
import {
    CHANNEL_DISCOVERY_PROJECTION,
    findByChannelId,
    getChannelById,
    searchChannels,
    toSafeChannelDiscoveryView
} from '../../../src/server/api/controllers/channelController';

const buildResponse = (): Response => {
    const response: Partial<Response> = {};
    response.status = jest.fn().mockReturnValue(response);
    response.json = jest.fn().mockReturnValue(response);
    return response as Response;
};

const sensitiveChannel = {
    _id: 'mongo-id',
    channelId: 'private-channel',
    name: 'Private Channel',
    description: 'Discoverable description',
    isPrivate: true,
    active: true,
    verified: true,
    createdBy: 'owner-user',
    participants: ['agent-secret'],
    sharedMemory: { notes: { launchCode: '1234' } },
    verificationToken: 'verification-secret',
    verificationExpiry: new Date(),
    metadata: { internalTenant: 'tenant-1' },
    context: { instructions: 'private system instructions' },
    allowedTools: ['internal_only'],
    mcpServers: {
        servers: [{
            id: 'mcp-1',
            config: {
                command: 'private-command',
                env: { API_KEY: 'credential-secret' }
            }
        }]
    }
};

interface FindChain {
    select: jest.Mock;
    limit: jest.Mock;
    lean: jest.Mock;
}

interface FindOneChain {
    select: jest.Mock;
    lean: jest.Mock;
}

const findChain = (result: unknown[]): FindChain => {
    const lean = jest.fn().mockResolvedValue(result);
    const limit = jest.fn().mockReturnValue({ lean });
    const select = jest.fn().mockReturnValue({ limit, lean });
    return { select, limit, lean };
};

const findOneChain = (result: unknown): FindOneChain => {
    const lean = jest.fn().mockResolvedValue(result);
    const select = jest.fn().mockReturnValue({ lean });
    return { select, lean };
};

describe('channel discovery security', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('uses an explicit projection and output allowlist for discovery records', () => {
        const safe = toSafeChannelDiscoveryView(sensitiveChannel);

        expect(CHANNEL_DISCOVERY_PROJECTION).toMatchObject({
            _id: 0,
            channelId: 1,
            name: 1,
            description: 1
        });
        expect(safe).toMatchObject({
            channelId: 'private-channel',
            name: 'Private Channel',
            description: 'Discoverable description'
        });
        expect(safe).not.toHaveProperty('_id');
        expect(safe).not.toHaveProperty('createdBy');
        expect(safe).not.toHaveProperty('participants');
        expect(safe).not.toHaveProperty('sharedMemory');
        expect(safe).not.toHaveProperty('verificationToken');
        expect(safe).not.toHaveProperty('metadata');
        expect(safe).not.toHaveProperty('context');
        expect(safe).not.toHaveProperty('allowedTools');
        expect(safe).not.toHaveProperty('mcpServers');
    });

    it('limits user search to public channels plus channels owned by that user', async () => {
        const chain = findChain([sensitiveChannel]);
        (Channel.find as jest.Mock).mockReturnValue(chain);
        const req = {
            authType: 'jwt',
            user: { id: 'owner-user', role: 'consumer' },
            query: { query: 'private' }
        } as unknown as Request;
        const res = buildResponse();

        await searchChannels(req, res);

        const mongoQuery = (Channel.find as jest.Mock).mock.calls[0][0];
        expect(mongoQuery.$and[1]).toEqual({
            $or: [
                { isPrivate: { $ne: true } },
                { createdBy: 'owner-user' }
            ]
        });
        expect(chain.select).toHaveBeenCalledWith(CHANNEL_DISCOVERY_PROJECTION);
        const responseBody = (res.json as jest.Mock).mock.calls[0][0];
        expect(responseBody.data[0]).not.toHaveProperty('sharedMemory');
        expect(responseBody.data[0]).not.toHaveProperty('mcpServers');
    });

    it('limits an agent to public channels plus its immutable key-bound channel', async () => {
        const chain = findOneChain(sensitiveChannel);
        (Channel.findOne as jest.Mock).mockReturnValue(chain);
        const req = {
            authType: 'key',
            agent: {
                agentId: 'agent-1',
                channelId: 'private-channel',
                keyId: 'key-1'
            },
            params: { channelId: 'private-channel' },
            query: {}
        } as unknown as Request;
        const res = buildResponse();

        await findByChannelId(req, res);

        const mongoQuery = (Channel.findOne as jest.Mock).mock.calls[0][0];
        expect(mongoQuery.$and[1]).toEqual({
            $or: [
                { isPrivate: { $ne: true } },
                { channelId: 'private-channel' }
            ]
        });
        expect(chain.select).toHaveBeenCalledWith(CHANNEL_DISCOVERY_PROJECTION);
    });

    it('does not broaden agent discovery from a matching participant name', async () => {
        const chain = findOneChain(null);
        (Channel.findOne as jest.Mock).mockReturnValue(chain);
        const req = {
            authType: 'key',
            agent: { agentId: 'agent-1', channelId: 'bound-channel', keyId: 'key-1' },
            params: { channelId: 'other-private-channel' },
            query: {}
        } as unknown as Request;
        const res = buildResponse();

        await findByChannelId(req, res);

        const mongoQuery = (Channel.findOne as jest.Mock).mock.calls[0][0];
        expect(JSON.stringify(mongoQuery)).not.toContain('participants');
        expect(JSON.stringify(mongoQuery)).toContain('bound-channel');
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('does not let an unaffiliated user opt unverified public channels into search results', async () => {
        const chain = findChain([]);
        (Channel.find as jest.Mock).mockReturnValue(chain);
        const req = {
            authType: 'jwt',
            user: { id: 'unaffiliated-user', role: 'consumer' },
            query: { query: 'pending', verifiedOnly: 'false' }
        } as unknown as Request;
        const res = buildResponse();

        await searchChannels(req, res);

        const mongoQuery = (Channel.find as jest.Mock).mock.calls[0][0];
        expect(mongoQuery.$and[2]).toEqual({
            $or: [
                { verified: true },
                { createdBy: 'unaffiliated-user' }
            ]
        });
        expect((res.json as jest.Mock).mock.calls[0][0].data).toEqual([]);
    });

    it('does not let an unaffiliated user opt another channel into an unverified exact lookup', async () => {
        const chain = findOneChain(null);
        (Channel.findOne as jest.Mock).mockReturnValue(chain);
        const req = {
            authType: 'jwt',
            user: { id: 'unaffiliated-user', role: 'consumer' },
            params: { channelId: 'pending-public-channel' },
            query: { includeUnverified: 'true' }
        } as unknown as Request;
        const res = buildResponse();

        await findByChannelId(req, res);

        const mongoQuery = (Channel.findOne as jest.Mock).mock.calls[0][0];
        expect(mongoQuery.$and[2]).toEqual({
            $or: [
                { verified: true },
                { createdBy: 'unaffiliated-user' }
            ]
        });
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('renders the channel already authorized by middleware without a second unscoped lookup', async () => {
        const req = {
            params: { channelId: 'private-channel' },
            channel: {
                ...sensitiveChannel,
                participants: ['agent-1', 'agent-2'],
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-02T00:00:00.000Z')
            }
        } as unknown as Request;
        const res = buildResponse();

        await getChannelById(req, res);

        expect(Channel.findOne).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            channel: expect.objectContaining({
                channelId: 'private-channel',
                participants: 2
            })
        });
    });
});
