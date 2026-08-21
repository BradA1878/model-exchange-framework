import { EventEmitter } from 'events';

const mockFindOne = jest.fn();
const mockFindById = jest.fn();
const mockCompare = jest.fn();
const mockValidateKey = jest.fn();
const mockValidateToken = jest.fn();
const mockVerifySessionToken = jest.fn();

jest.mock('@mxf-dev/core/models/user', () => ({
    User: { findOne: mockFindOne, findById: mockFindById }
}));
jest.mock('bcrypt', () => ({
    __esModule: true,
    default: { compare: mockCompare }
}));
jest.mock('../../../src/server/utils/keyAuthHelper', () => ({
    __esModule: true,
    default: {
        getInstance: (): { validateKey: typeof mockValidateKey } => ({
            validateKey: mockValidateKey
        })
    }
}));
jest.mock('../../../src/server/api/services/PersonalAccessTokenService', () => ({
    PersonalAccessTokenService: {
        getInstance: (): { validateToken: jest.Mock } => ({ validateToken: mockValidateToken })
    }
}));
jest.mock('../../../src/server/api/security/jwtTokenPolicy', () => ({
    verifySessionToken: mockVerifySessionToken
}));
jest.mock('@mxf-dev/core/models/channel', () => ({ Channel: {} }));
jest.mock('@mxf-dev/core/config/ConfigManager', () => ({ ConfigManager: {} }));
jest.mock('../../../src/server/socket/services/AgentService', () => ({ AgentService: {} }));
jest.mock('@mxf-dev/core/utils/Logger', () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return {
        __esModule: true,
        default: { ...logger, child: (): typeof logger => logger },
        Logger: jest.fn(() => logger)
    };
});

import { handleSocketAuthentication } from '../../../src/server/socket/handlers/authenticationHandlers';
import { resetSocketPasswordRateLimiterForTests } from '../../../src/server/socket/security/SocketPasswordRateLimiter';
import { SOCKET_PASSWORD_RATE_LIMIT_MAX_ENV } from '../../../src/server/config/IngressSecurityConfig';

class FakeSocket extends EventEmitter {
    public id: string;
    public data: Record<string, unknown> = {};
    public handshake: { address: string; auth: Record<string, unknown> };
    public conn: { remoteAddress: string };
    public join = jest.fn();

    public constructor(id: string, address: string) {
        super();
        this.id = id;
        this.handshake = { address, auth: {} };
        this.conn = { remoteAddress: address };
    }
}

describe('process-wide socket password rate limit', () => {
    const previousMaximum = process.env[SOCKET_PASSWORD_RATE_LIMIT_MAX_ENV];
    const keyExpiresAt = new Date('2026-08-19T00:00:00.000Z');

    beforeEach(() => {
        jest.clearAllMocks();
        process.env[SOCKET_PASSWORD_RATE_LIMIT_MAX_ENV] = '2';
        resetSocketPasswordRateLimiterForTests();
        mockFindOne.mockResolvedValue({
            _id: 'user-1', username: 'Alice', password: 'hash', role: 'consumer', isActive: true
        });
        mockCompare.mockResolvedValue(false);
        mockFindById.mockResolvedValue({
            _id: 'user-1', username: 'Alice', role: 'consumer', isActive: true
        });
        mockValidateKey.mockResolvedValue({
            valid: true,
            agentId: 'agent-1',
            channelId: 'channel-1',
            allowedTools: undefined,
            expiresAt: keyExpiresAt
        });
    });

    afterAll(() => {
        if (previousMaximum === undefined) {
            delete process.env[SOCKET_PASSWORD_RATE_LIMIT_MAX_ENV];
        } else {
            process.env[SOCKET_PASSWORD_RATE_LIMIT_MAX_ENV] = previousMaximum;
        }
        resetSocketPasswordRateLimiterForTests();
    });

    it('limits one normalized account across fresh sockets and source IPs before DB/bcrypt', async () => {
        await handleSocketAuthentication(new FakeSocket('one', '10.0.0.1') as never, {
            username: ' Alice ', password: 'wrong'
        });
        await handleSocketAuthentication(new FakeSocket('two', '10.0.0.2') as never, {
            username: 'alice', password: 'wrong'
        });
        await handleSocketAuthentication(new FakeSocket('three', '10.0.0.3') as never, {
            username: 'ALICE', password: 'wrong'
        });

        expect(mockFindOne).toHaveBeenCalledTimes(2);
        expect(mockCompare).toHaveBeenCalledTimes(2);
    });

    it('limits one source IP cycling account names', async () => {
        await handleSocketAuthentication(new FakeSocket('one', '10.0.0.9') as never, {
            username: 'first', password: 'wrong'
        });
        await handleSocketAuthentication(new FakeSocket('two', '10.0.0.9') as never, {
            username: 'second', password: 'wrong'
        });
        await handleSocketAuthentication(new FakeSocket('three', '10.0.0.9') as never, {
            username: 'third', password: 'wrong'
        });

        expect(mockFindOne).toHaveBeenCalledTimes(2);
        expect(mockCompare).toHaveBeenCalledTimes(2);
    });

    it('authenticates a legitimate password and does not apply the limiter to agent keys', async () => {
        mockCompare.mockResolvedValueOnce(true);
        const userSocket = new FakeSocket('user', '10.0.0.5');
        await expect(handleSocketAuthentication(userSocket as never, {
            username: 'Alice', password: 'correct'
        })).resolves.toBe('user-1');
        expect(userSocket.data).toMatchObject({ authType: 'password', authenticated: true });

        const keySocket = new FakeSocket('agent', '10.0.0.5');
        await expect(handleSocketAuthentication(keySocket as never, {
            keyId: 'key-1', secretKey: 'secret'
        })).resolves.toBe('agent-1');
        expect(mockValidateKey).toHaveBeenCalledTimes(1);
        expect(keySocket.data).toMatchObject({
            authType: 'key',
            keyId: 'key-1',
            credentialExpiresAt: keyExpiresAt.getTime()
        });
    });

    it('carries the verified JWT exp into the immutable socket session', async () => {
        const exp = Math.floor(Date.now() / 1000) + 3_600;
        mockVerifySessionToken.mockReturnValue({
            userId: 'user-1', role: 'consumer', type: 'user', exp
        });
        const socket = new FakeSocket('jwt-user', '10.0.0.6');

        await expect(handleSocketAuthentication(socket as never, {
            token: 'signed-session-token'
        })).resolves.toBe('user-1');

        expect(socket.data).toMatchObject({
            authType: 'jwt',
            userId: 'user-1',
            credentialExpiresAt: exp * 1000,
            authenticated: true
        });
    });

    it('carries an exact PAT token id and verified expiry into the socket session', async () => {
        const expiresAt = new Date(Date.now() + 3_600_000);
        mockValidateToken.mockResolvedValue({
            valid: true,
            userId: 'user-1',
            tokenId: 'mxf_token_a',
            scopes: ['sdk'],
            expiresAt
        });
        const socket = new FakeSocket('pat-user', '10.0.0.6');

        await expect(handleSocketAuthentication(socket as never, {
            accessToken: 'mxf_token_a:secret'
        })).resolves.toBe('user-1');

        expect(socket.data).toMatchObject({
            authType: 'pat',
            userId: 'user-1',
            tokenId: 'mxf_token_a',
            credentialExpiresAt: expiresAt.getTime(),
            authenticated: true
        });
    });

    it('fails closed on invalid configuration without Mongo or bcrypt work', async () => {
        process.env[SOCKET_PASSWORD_RATE_LIMIT_MAX_ENV] = 'many';
        resetSocketPasswordRateLimiterForTests();

        await expect(handleSocketAuthentication(
            new FakeSocket('invalid-config', '10.0.0.7') as never,
            { username: 'alice', password: 'wrong' }
        )).resolves.toBeNull();
        expect(mockFindOne).not.toHaveBeenCalled();
        expect(mockCompare).not.toHaveBeenCalled();
    });
});
