import { NextFunction, Request, Response } from 'express';

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

import { Channel } from '@mxf-dev/core/models/channel';
import {
    requireResourceOwner,
    requireUserPrincipal
} from '../../../src/server/api/middleware/resourceOwnership';

const buildResponse = (): Response => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

describe('resource ownership middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects an agent credential where a user principal is required', () => {
        const req = {
            authType: 'key',
            agent: { agentId: 'agent-1', channelId: 'channel-a', keyId: 'key-a' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        requireUserPrincipal(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('calls next only after the central policy confirms ownership', async () => {
        (Channel.findOne as jest.Mock).mockResolvedValue({
            channelId: 'channel-a',
            createdBy: 'user-1'
        });
        const req = {
            authType: 'jwt',
            user: { id: 'user-1', role: 'consumer' },
            params: { channelId: 'channel-a' }
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireResourceOwner('channel', request => request.params.channelId)(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('does not disclose a resource to a different user', async () => {
        (Channel.findOne as jest.Mock).mockResolvedValue({
            channelId: 'channel-a',
            createdBy: 'user-1'
        });
        const req = {
            authType: 'jwt',
            user: { id: 'user-2', role: 'consumer' },
            params: { channelId: 'channel-a' },
            method: 'DELETE',
            originalUrl: '/api/channels/channel-a'
        } as unknown as Request;
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await requireResourceOwner('channel', request => request.params.channelId)(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
