import { Request } from 'express';

const mockHydrateChannelRuntimePolicy = jest.fn();

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { find: jest.fn(), findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/agent', () => ({
    Agent: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/channelKey', () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}));

jest.mock('../../../src/server/api/security/ChannelRuntimePolicy', () => ({
    hydrateChannelRuntimePolicy: mockHydrateChannelRuntimePolicy
}));

import { Agent } from '@mxf-dev/core/models/agent';
import { Channel } from '@mxf-dev/core/models/channel';
import ChannelKey from '@mxf-dev/core/models/channelKey';
import { authorizationService } from '../../../src/server/api/services/AuthorizationService';

const selectedResult = (value: unknown): { select: jest.Mock } => ({
    select: jest.fn().mockResolvedValue(value)
});

describe('AuthorizationService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('principal extraction', () => {
        it('normalizes an authenticated user from middleware-owned request state', () => {
            const request = {
                authType: 'jwt',
                user: {
                    id: { toString: () => 'user-1' },
                    role: 'provider'
                }
            } as unknown as Request;

            expect(authorizationService.readPrincipal(request)).toEqual({
                kind: 'user',
                userId: 'user-1',
                role: 'provider'
            });
        });

        it('requires both immutable agent and channel identity for a key principal', () => {
            const valid = {
                authType: 'key',
                agent: { agentId: 'agent-1', channelId: 'channel-a', keyId: 'key-a' }
            } as unknown as Request;
            const incomplete = {
                authType: 'key',
                agent: { agentId: 'agent-1' }
            } as unknown as Request;

            expect(authorizationService.readPrincipal(valid)).toEqual({
                kind: 'agent',
                agentId: 'agent-1',
                channelId: 'channel-a',
                keyId: 'key-a'
            });
            expect(authorizationService.readPrincipal(incomplete)).toEqual({
                kind: 'unauthenticated'
            });
        });

        it('does not infer identity from request parameters or headers', () => {
            const request = {
                params: { agentId: 'forged-agent', channelId: 'forged-channel' },
                headers: { 'x-agent-id': 'forged-agent' }
            } as unknown as Request;

            expect(authorizationService.readPrincipal(request)).toEqual({
                kind: 'unauthenticated'
            });
        });
    });

    describe('channel access', () => {
        it('allows an owning user and compares persisted identifiers as strings', async () => {
            (Channel.findOne as jest.Mock).mockResolvedValue({
                channelId: 'channel-a',
                createdBy: { toString: () => 'user-1' }
            });

            const decision = await authorizationService.authorize(
                'access',
                'channel',
                'channel-a',
                { kind: 'user', userId: 'user-1', role: 'consumer' }
            );

            expect(decision.allowed).toBe(true);
            expect(mockHydrateChannelRuntimePolicy).toHaveBeenCalledWith(
                expect.objectContaining({ channelId: 'channel-a' })
            );
        });

        it('allows an administrator to access another user’s channel', async () => {
            (Channel.findOne as jest.Mock).mockResolvedValue({
                channelId: 'channel-a',
                createdBy: 'user-1'
            });

            const decision = await authorizationService.authorize(
                'access',
                'channel',
                'channel-a',
                { kind: 'user', userId: 'admin-1', role: 'admin' }
            );

            expect(decision.allowed).toBe(true);
        });

        it('allows an agent only when its validated key is bound to the exact channel', async () => {
            (Channel.findOne as jest.Mock).mockResolvedValue({
                channelId: 'channel-a',
                createdBy: 'user-1',
                participants: []
            });

            const decision = await authorizationService.authorize(
                'access',
                'channel',
                'channel-a',
                { kind: 'agent', agentId: 'agent-9', channelId: 'channel-a', keyId: 'key-a' }
            );

            expect(decision.allowed).toBe(true);
        });

        it('rejects a participant presenting a key bound to another channel', async () => {
            (Channel.findOne as jest.Mock).mockResolvedValue({
                channelId: 'channel-a',
                createdBy: 'user-1',
                participants: ['agent-1']
            });

            const decision = await authorizationService.authorize(
                'access',
                'channel',
                'channel-a',
                { kind: 'agent', agentId: 'agent-1', channelId: 'channel-other', keyId: 'key-other' }
            );

            expect(decision).toMatchObject({ allowed: false, status: 403 });
            expect(mockHydrateChannelRuntimePolicy).not.toHaveBeenCalled();
        });
    });

    describe('channel collection scope', () => {
        it('gives an administrator an unrestricted scope without loading channels', async () => {
            const decision = await authorizationService.resolveChannelScope({
                kind: 'user',
                userId: 'admin-1',
                role: 'admin'
            });

            expect(decision).toEqual({
                allowed: true,
                scope: { unrestricted: true }
            });
            expect(Channel.find).not.toHaveBeenCalled();
        });

        it('loads only the normal user\'s owned channel ids', async () => {
            const lean = jest.fn().mockResolvedValue([
                { channelId: 'channel-a' },
                { channelId: 'channel-a' },
                { channelId: 'channel-b' }
            ]);
            const select = jest.fn().mockReturnValue({ lean });
            (Channel.find as jest.Mock).mockReturnValue({ select });

            const decision = await authorizationService.resolveChannelScope({
                kind: 'user',
                userId: 'user-1',
                role: 'consumer'
            });

            expect(Channel.find).toHaveBeenCalledWith({ createdBy: 'user-1', active: true });
            expect(select).toHaveBeenCalledWith('channelId');
            expect(decision).toEqual({
                allowed: true,
                scope: { unrestricted: false, channelIds: ['channel-a', 'channel-b'] }
            });
        });

        it('confines an agent to the exact channel embedded in its validated key identity', async () => {
            const decision = await authorizationService.resolveChannelScope({
                kind: 'agent',
                agentId: 'agent-1',
                channelId: 'channel-a',
                keyId: 'key-a'
            });

            expect(decision).toEqual({
                allowed: true,
                scope: { unrestricted: false, channelIds: ['channel-a'] }
            });
            expect(Channel.find).not.toHaveBeenCalled();
        });

        it('rejects unauthenticated and unsupported principals', async () => {
            await expect(authorizationService.resolveChannelScope({ kind: 'unauthenticated' }))
                .resolves.toMatchObject({ allowed: false, status: 401 });
            await expect(authorizationService.resolveChannelScope({ kind: 'invalid', authType: 'pat' }))
                .resolves.toMatchObject({ allowed: false, status: 403 });

            expect(Channel.find).not.toHaveBeenCalled();
        });
    });

    describe('resource administration', () => {
        it('allows an agent to access context only through its exact bound key', async () => {
            (Agent.findOne as jest.Mock).mockReturnValue(selectedResult({
                createdBy: 'user-1',
                agentId: 'agent-1',
                keyId: 'key-a'
            }));

            const decision = await authorizationService.authorize(
                'access',
                'agent-key',
                'key-a',
                { kind: 'agent', agentId: 'agent-1', channelId: 'channel-a', keyId: 'key-a' }
            );

            expect(decision.allowed).toBe(true);
        });

        it('rejects a key-authenticated agent requesting another agent’s context', async () => {
            (Agent.findOne as jest.Mock).mockReturnValue(selectedResult({
                createdBy: 'user-2',
                agentId: 'agent-2',
                keyId: 'key-b'
            }));

            const decision = await authorizationService.authorize(
                'access',
                'agent-key',
                'key-b',
                { kind: 'agent', agentId: 'agent-1', channelId: 'channel-a', keyId: 'key-a' }
            );

            expect(decision).toMatchObject({ allowed: false, status: 403 });
        });

        it('allows an administrator to manage an existing agent', async () => {
            (Agent.findOne as jest.Mock).mockReturnValue(selectedResult({ createdBy: 'user-1' }));

            const decision = await authorizationService.authorize(
                'manage',
                'agent',
                'agent-a',
                { kind: 'user', userId: 'admin-1', role: 'admin' }
            );

            expect(decision.allowed).toBe(true);
        });

        it('allows only the persisted owner of a key', async () => {
            (ChannelKey.findOne as jest.Mock).mockReturnValue(selectedResult({ createdBy: 'user-1' }));

            const decision = await authorizationService.authorize(
                'manage',
                'key',
                'key-a',
                { kind: 'user', userId: 'user-2', role: 'consumer' }
            );

            expect(decision).toMatchObject({ allowed: false, status: 403 });
        });

        it('rejects agent credentials before loading administrative resources', async () => {
            const decision = await authorizationService.authorize(
                'manage',
                'channel',
                'channel-a',
                { kind: 'agent', agentId: 'agent-1', channelId: 'channel-a', keyId: 'key-a' }
            );

            expect(decision).toMatchObject({ allowed: false, status: 403 });
            expect(Channel.findOne).not.toHaveBeenCalled();
        });

        it('never authorizes an inactive channel tombstone', async () => {
            (Channel.findOne as jest.Mock).mockResolvedValue(null);

            const decision = await authorizationService.authorize(
                'manage',
                'channel',
                'deleted-channel',
                { kind: 'user', userId: 'user-1', role: 'consumer' }
            );

            expect(Channel.findOne).toHaveBeenCalledWith({
                channelId: 'deleted-channel',
                active: true
            });
            expect(decision).toMatchObject({ allowed: false, status: 404 });
        });

        it('returns 404 for a missing resource', async () => {
            (Agent.findOne as jest.Mock).mockReturnValue(selectedResult(null));

            const decision = await authorizationService.authorize(
                'manage',
                'agent',
                'missing',
                { kind: 'user', userId: 'user-1', role: 'consumer' }
            );

            expect(decision).toMatchObject({ allowed: false, status: 404 });
        });

        it('rejects unauthenticated and unknown principals without database access', async () => {
            const unauthenticated = await authorizationService.authorize(
                'manage',
                'channel',
                'channel-a',
                { kind: 'unauthenticated' }
            );
            const invalid = await authorizationService.authorize(
                'manage',
                'channel',
                'channel-a',
                { kind: 'invalid', authType: 'unexpected' }
            );

            expect(unauthenticated).toMatchObject({ allowed: false, status: 401 });
            expect(invalid).toMatchObject({ allowed: false, status: 403 });
            expect(Channel.findOne).not.toHaveBeenCalled();
        });
    });
});
