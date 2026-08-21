import { NextFunction, Request, Response } from 'express';

const mockHydrateChannelRuntimePolicy = jest.fn();

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/agent', () => ({
    Agent: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/channelKey', () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('../../../src/server/api/security/ChannelRuntimePolicy', () => ({
    hydrateChannelRuntimePolicy: mockHydrateChannelRuntimePolicy
}));

import { Channel } from '@mxf-dev/core/models/channel';
import {
    ChannelAuthorizedRequest,
    requireChannelAccess,
    requireChannelDeletionOwner,
    requireChannelOwner
} from '../../../src/server/api/middleware/channelAuth';

const mockChannel = Channel.findOne as jest.Mock;

const channelDocument = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    channelId: 'channel-a',
    createdBy: 'user-1',
    participants: ['agent-1'],
    ...overrides
});

const buildResponse = (): Response => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

describe('channel authorization middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('attaches the resolved channel for its owning user', async () => {
        const channel = channelDocument();
        mockChannel.mockResolvedValue(channel);
        const req = {
            params: { channelId: 'channel-a' },
            authType: 'jwt',
            user: { id: 'user-1', role: 'consumer' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireChannelAccess(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect((req as ChannelAuthorizedRequest).channel).toBe(channel);
        expect(mockHydrateChannelRuntimePolicy).toHaveBeenCalledWith(channel);
    });

    it('allows an administrator to manage a channel owned by another user', async () => {
        mockChannel.mockResolvedValue(channelDocument());
        const req = {
            params: { channelId: 'channel-a' },
            authType: 'jwt',
            user: { id: 'admin-1', role: 'admin' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireChannelOwner(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('allows an agent to access only the channel bound to its key', async () => {
        mockChannel.mockResolvedValue(channelDocument({ participants: [] }));
        const req = {
            params: { channelId: 'channel-a' },
            authType: 'key',
            agent: { agentId: 'agent-9', channelId: 'channel-a', keyId: 'key-a' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireChannelAccess(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('does not let participation turn a different channel key into a bearer credential', async () => {
        mockChannel.mockResolvedValue(channelDocument({ participants: ['agent-1'] }));
        const req = {
            params: { channelId: 'channel-a' },
            method: 'GET',
            originalUrl: '/api/channels/channel-a',
            authType: 'key',
            agent: { agentId: 'agent-1', channelId: 'channel-other', keyId: 'key-other' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireChannelAccess(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('reserves channel administration for users', async () => {
        const req = {
            params: { channelId: 'channel-a' },
            method: 'DELETE',
            originalUrl: '/api/channels/channel-a',
            authType: 'key',
            agent: { agentId: 'agent-1', channelId: 'channel-a', keyId: 'key-a' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireChannelOwner(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockChannel).not.toHaveBeenCalled();
    });

    it('allows an owner to retry pending deletion without rehydrating the tombstone', async () => {
        const tombstone = channelDocument({
            active: false,
            metadata: { deletionCleanupStatus: 'pending' }
        });
        mockChannel.mockResolvedValue(tombstone);
        const req = {
            params: { channelId: 'channel-a' },
            method: 'DELETE',
            originalUrl: '/api/channels/channel-a',
            authType: 'jwt',
            user: { id: 'user-1', role: 'consumer' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireChannelDeletionOwner(req, res, next);

        expect(mockChannel).toHaveBeenCalledWith({
            channelId: 'channel-a',
            $or: [
                { active: true },
                { active: false, 'metadata.deletionCleanupStatus': 'pending' }
            ]
        });
        expect(next).toHaveBeenCalledTimes(1);
        expect(mockHydrateChannelRuntimePolicy).not.toHaveBeenCalled();
    });

    it('returns 500 when the policy lookup fails', async () => {
        mockChannel.mockRejectedValue(new Error('database down'));
        const req = {
            params: { channelId: 'channel-a' },
            method: 'GET',
            originalUrl: '/api/channels/channel-a',
            authType: 'jwt',
            user: { id: 'user-1' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireChannelAccess(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
