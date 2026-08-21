import { Request, Response } from 'express';
import { of } from 'rxjs';

const createChannel = jest.fn();
const createChannelKey = jest.fn();
const deleteOwnedChannel = jest.fn();
const deleteAdminChannel = jest.fn();
const deleteMemory = jest.fn();
const emitEvent = jest.fn();

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: {
        findOne: jest.fn(),
        deleteOne: jest.fn()
    }
}));

jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: {
        getInstance: jest.fn(() => ({
            createChannel,
            deleteChannel: deleteOwnedChannel,
            deleteChannelAsAdministrator: deleteAdminChannel
        }))
    }
}));

jest.mock('../../../src/server/socket/services/ChannelKeyService', () => ({
    __esModule: true,
    default: { createChannelKey },
    CreatedChannelKey: {}
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: { emit: emitEvent }
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

jest.mock('../../../src/server/api/services/MemoryPersistenceService', () => ({
    MemoryPersistenceService: {
        getInstance: jest.fn(() => ({ deleteMemory }))
    }
}));

import { Channel } from '@mxf-dev/core/models/channel';
import {
    createChannelWorkspace,
    deleteChannel as deleteChannelController
} from '../../../src/server/api/controllers/channelController';

const mockFindOne = Channel.findOne as jest.Mock;

const selectedResult = (value: unknown): { select: jest.Mock } => ({
    select: jest.fn().mockResolvedValue(value)
});

const buildResponse = (): Response => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

describe('createChannelWorkspace security', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        deleteOwnedChannel.mockResolvedValue(true);
        deleteAdminChannel.mockResolvedValue(true);
        deleteMemory.mockReturnValue(of(true));
    });

    it('refuses a key-authenticated agent before looking up or creating a channel', async () => {
        const req = {
            authType: 'key',
            agent: { agentId: 'agent-1' },
            body: { channelId: 'channel-a' }
        } as unknown as Request;
        const res = buildResponse();

        await createChannelWorkspace(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockFindOne).not.toHaveBeenCalled();
        expect(createChannel).not.toHaveBeenCalled();
    });

    it('rejects invalid key options before creating a workspace', async () => {
        const req = {
            authType: 'jwt',
            user: { id: 'user-1' },
            body: { channelId: 'channel-a', generateKey: true }
        } as unknown as Request;
        const res = buildResponse();

        await createChannelWorkspace(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockFindOne).not.toHaveBeenCalled();
        expect(createChannel).not.toHaveBeenCalled();
    });

    it.each(['system', 'NO_CHANNEL', 'global', 'system:workflows'])(
        'rejects reserved workspace id %s before database or service access',
        async (channelId) => {
            const req = {
                authType: 'jwt',
                user: { id: 'user-1' },
                body: { channelId }
            } as unknown as Request;
            const res = buildResponse();

            await createChannelWorkspace(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(mockFindOne).not.toHaveBeenCalled();
            expect(createChannel).not.toHaveBeenCalled();
        }
    );

    it('does not adopt an existing channel or mint a key for it', async () => {
        mockFindOne.mockReturnValue(selectedResult({ _id: 'existing' }));
        const req = {
            authType: 'jwt',
            user: { id: 'attacker' },
            body: {
                channelId: 'victim-channel',
                generateKey: true,
                keyAgentId: 'attacker-agent'
            }
        } as unknown as Request;
        const res = buildResponse();

        await createChannelWorkspace(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(createChannel).not.toHaveBeenCalled();
        expect(createChannelKey).not.toHaveBeenCalled();
    });

    it('checks persisted ownership after creation before minting a key', async () => {
        mockFindOne
            .mockReturnValueOnce(selectedResult(null))
            .mockReturnValueOnce(selectedResult({ createdBy: 'racing-user' }));
        createChannel.mockResolvedValue({
            id: 'channel-a',
            name: 'Channel A',
            active: true,
            createdAt: new Date()
        });
        const req = {
            authType: 'jwt',
            user: { id: 'user-1' },
            body: {
                channelId: 'channel-a',
                generateKey: true,
                keyAgentId: 'agent-1'
            }
        } as unknown as Request;
        const res = buildResponse();

        await createChannelWorkspace(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(createChannelKey).not.toHaveBeenCalled();
    });

    it('creates a workspace and key only for the authenticated owner', async () => {
        mockFindOne
            .mockReturnValueOnce(selectedResult(null))
            .mockReturnValueOnce(selectedResult({ createdBy: 'user-1' }));
        const createdAt = new Date();
        createChannel.mockResolvedValue({
            id: 'channel-a',
            name: 'Channel A',
            active: true,
            createdAt
        });
        createChannelKey.mockResolvedValue({
            keyId: 'key-1',
            secretKey: 'shown-once',
            agentId: 'agent-1',
            isActive: true,
            createdAt
        });
        const req = {
            authType: 'jwt',
            user: { id: 'user-1' },
            body: {
                channelId: 'channel-a',
                name: 'Channel A',
                generateKey: true,
                keyAgentId: 'agent-1'
            }
        } as unknown as Request;
        const res = buildResponse();

        await createChannelWorkspace(req, res);

        expect(createChannel).toHaveBeenCalledWith(
            'channel-a',
            'Channel A',
            'user-1',
            { description: undefined, isPrivate: false }
        );
        expect(createChannelKey).toHaveBeenCalledWith(
            'channel-a',
            'user-1',
            'agent-1',
            'Initial key for Channel A',
            undefined,
            undefined
        );
        expect(res.status).toHaveBeenCalledWith(201);
    });
});

describe('deleteChannel lifecycle delegation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        deleteOwnedChannel.mockResolvedValue(true);
        deleteAdminChannel.mockResolvedValue(true);
        deleteMemory.mockReturnValue(of(true));
    });

    it('uses the authoritative service for a cold REST deletion without hard-delete or duplicate event', async () => {
        const req = {
            params: { channelId: 'channel-a' },
            body: { reason: 'retired' },
            user: { id: 'user-1', role: 'consumer' }
        } as unknown as Request;
        const res = buildResponse();

        await deleteChannelController(req, res);

        expect(deleteOwnedChannel).toHaveBeenCalledWith(
            'channel-a',
            'user-1',
            'retired'
        );
        expect(Channel.deleteOne).not.toHaveBeenCalled();
        expect(deleteMemory).toHaveBeenCalled();
        expect(emitEvent).not.toHaveBeenCalledWith(
            expect.stringMatching(/channel.*deleted/i),
            expect.anything()
        );
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('uses the database-verified administrator lifecycle for global deletion', async () => {
        const req = {
            params: { channelId: 'channel-a' },
            body: {},
            user: { id: 'admin-1', role: 'admin' }
        } as unknown as Request;
        const res = buildResponse();

        await deleteChannelController(req, res);

        expect(deleteAdminChannel).toHaveBeenCalledWith(
            'channel-a',
            'admin-1',
            undefined
        );
        expect(deleteOwnedChannel).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns failure and never removes memory when lifecycle cleanup throws', async () => {
        deleteOwnedChannel.mockRejectedValue(new Error('cleanup required'));
        const req = {
            params: { channelId: 'channel-a' },
            body: {},
            user: { id: 'user-1', role: 'consumer' }
        } as unknown as Request;
        const res = buildResponse();

        await deleteChannelController(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(deleteMemory).not.toHaveBeenCalled();
    });
});
