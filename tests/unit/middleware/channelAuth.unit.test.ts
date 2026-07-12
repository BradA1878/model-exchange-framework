/**
 * Channel Authorization Middleware Unit Tests
 *
 * Covers the rule that decides which channel a principal may act on:
 * - a user may act on channels they created
 * - an agent may act on the channel its key is bound to, or one it participates in
 * - everything else is refused
 *
 * These routes previously had no ownership or membership check at all, so knowing
 * a channelId was enough to rename, delete, or read any channel in the system.
 */

import { Request, Response, NextFunction } from 'express';

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: {
        findOne: jest.fn()
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

import { Channel } from '@mxf-dev/core/models/channel';
import {
    authorizeChannel,
    readPrincipal,
    requireChannelAccess
} from '../../../src/server/api/middleware/channelAuth';

const mockChannel = Channel.findOne as jest.Mock;

/** Build a channel document as the middleware sees it. */
const channelDoc = (overrides: Record<string, unknown> = {}) => ({
    channelId: 'channel-a',
    createdBy: 'user-1',
    participants: ['agent-1'],
    ...overrides
});

describe('channelAuth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('readPrincipal', () => {
        it('reads a JWT user and stringifies the id', () => {
            const req = {
                authType: 'jwt',
                user: { id: { toString: () => 'user-1' } }
            } as unknown as Request;

            expect(readPrincipal(req)).toEqual({
                authType: 'jwt',
                userId: 'user-1',
                agentId: undefined,
                keyChannelId: undefined
            });
        });

        it('reads a key-authenticated agent with its bound channel', () => {
            const req = {
                authType: 'key',
                agent: { agentId: 'agent-1', channelId: 'channel-a' }
            } as unknown as Request;

            expect(readPrincipal(req)).toEqual({
                authType: 'key',
                userId: undefined,
                agentId: 'agent-1',
                keyChannelId: 'channel-a'
            });
        });

        it('reports no auth type when the request is unauthenticated', () => {
            expect(readPrincipal({} as Request).authType).toBeUndefined();
        });
    });

    describe('authorizeChannel — users', () => {
        it('allows the user who created the channel', async () => {
            mockChannel.mockResolvedValue(channelDoc({ createdBy: 'user-1' }));

            const decision = await authorizeChannel('channel-a', {
                authType: 'jwt',
                userId: 'user-1'
            });

            expect(decision.allowed).toBe(true);
        });

        it('refuses a user who did not create the channel', async () => {
            mockChannel.mockResolvedValue(channelDoc({ createdBy: 'user-1' }));

            const decision = await authorizeChannel('channel-a', {
                authType: 'jwt',
                userId: 'user-2'
            });

            expect(decision).toMatchObject({ allowed: false, status: 403 });
        });

        it('compares ids as strings so an ObjectId createdBy still matches', async () => {
            mockChannel.mockResolvedValue(
                channelDoc({ createdBy: { toString: () => 'user-1' } })
            );

            const decision = await authorizeChannel('channel-a', {
                authType: 'jwt',
                userId: 'user-1'
            });

            expect(decision.allowed).toBe(true);
        });
    });

    describe('authorizeChannel — agents', () => {
        it('allows an agent whose key is bound to the channel', async () => {
            mockChannel.mockResolvedValue(channelDoc({ participants: [] }));

            const decision = await authorizeChannel('channel-a', {
                authType: 'key',
                agentId: 'agent-9',
                keyChannelId: 'channel-a'
            });

            expect(decision.allowed).toBe(true);
        });

        it('allows an agent listed as a participant', async () => {
            mockChannel.mockResolvedValue(channelDoc({ participants: ['agent-1'] }));

            const decision = await authorizeChannel('channel-a', {
                authType: 'key',
                agentId: 'agent-1',
                keyChannelId: 'channel-other'
            });

            expect(decision.allowed).toBe(true);
        });

        it('refuses an agent whose key belongs to a different channel', async () => {
            mockChannel.mockResolvedValue(
                channelDoc({ channelId: 'channel-b', participants: [] })
            );

            const decision = await authorizeChannel('channel-b', {
                authType: 'key',
                agentId: 'agent-1',
                keyChannelId: 'channel-a'
            });

            expect(decision).toMatchObject({ allowed: false, status: 403 });
        });

        it('refuses an agent with no bound channel and no participation', async () => {
            mockChannel.mockResolvedValue(channelDoc({ participants: [] }));

            const decision = await authorizeChannel('channel-a', {
                authType: 'key',
                agentId: 'agent-1'
            });

            expect(decision).toMatchObject({ allowed: false, status: 403 });
        });
    });

    describe('authorizeChannel — rejections', () => {
        it('returns 401 when the request is unauthenticated', async () => {
            const decision = await authorizeChannel('channel-a', {});

            expect(decision).toMatchObject({ allowed: false, status: 401 });
            expect(mockChannel).not.toHaveBeenCalled();
        });

        it('returns 404 when the channel does not exist', async () => {
            mockChannel.mockResolvedValue(null);

            const decision = await authorizeChannel('nope', {
                authType: 'jwt',
                userId: 'user-1'
            });

            expect(decision).toMatchObject({ allowed: false, status: 404 });
        });

        it('returns 404 for a blank channelId without querying', async () => {
            const decision = await authorizeChannel('  ', {
                authType: 'jwt',
                userId: 'user-1'
            });

            expect(decision).toMatchObject({ allowed: false, status: 404 });
            expect(mockChannel).not.toHaveBeenCalled();
        });

        it('refuses an unrecognized auth type', async () => {
            mockChannel.mockResolvedValue(channelDoc());

            const decision = await authorizeChannel('channel-a', {
                authType: 'something-else'
            });

            expect(decision).toMatchObject({ allowed: false, status: 403 });
        });
    });

    describe('requireChannelAccess middleware', () => {
        const buildRes = () => {
            const res: Partial<Response> = {};
            res.status = jest.fn().mockReturnValue(res);
            res.json = jest.fn().mockReturnValue(res);
            return res as Response;
        };

        it('calls next and attaches the channel when allowed', async () => {
            const channel = channelDoc();
            mockChannel.mockResolvedValue(channel);

            const req = {
                params: { channelId: 'channel-a' },
                authType: 'jwt',
                user: { id: 'user-1' }
            } as unknown as Request;
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            await requireChannelAccess(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect((req as any).channel).toBe(channel);
        });

        it('responds 403 and does not call next when refused', async () => {
            mockChannel.mockResolvedValue(channelDoc({ createdBy: 'someone-else' }));

            const req = {
                params: { channelId: 'channel-a' },
                method: 'DELETE',
                originalUrl: '/api/channels/channel-a',
                authType: 'jwt',
                user: { id: 'user-1' }
            } as unknown as Request;
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            await requireChannelAccess(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('responds 500 when the channel lookup throws', async () => {
            mockChannel.mockRejectedValue(new Error('database down'));

            const req = {
                params: { channelId: 'channel-a' },
                method: 'PUT',
                originalUrl: '/api/channels/channel-a',
                authType: 'jwt',
                user: { id: 'user-1' }
            } as unknown as Request;
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            await requireChannelAccess(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});
