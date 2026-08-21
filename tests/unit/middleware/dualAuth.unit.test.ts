/**
 * Dual Auth Role Gate Unit Tests
 *
 * requireAdmin and requireProvider used to call next() for any key-authenticated
 * request — "agents with valid keys are considered to have admin access". A
 * channel key proves which channel you may act on; it carries no role. Any agent
 * holding any valid key was therefore an administrator on every admin-gated route.
 */

import { Request, Response, NextFunction } from 'express';

interface DualAuthenticatedRequest extends Request {
    authType?: string;
    agent?: {
        agentId: string;
        channelId: string;
        keyId: string;
        allowedTools?: string[];
    };
}

const mockValidateKey = jest.fn();

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
        assertIsObject: jest.fn(),
        assertIsNonEmptyString: jest.fn()
    })
}));

jest.mock('@mxf-dev/core/utils/env', () => ({
    requireEnv: jest.fn().mockReturnValue('test-jwt-secret-0123456789abcdefghij')
}));

jest.mock('@mxf-dev/core/models/user', () => ({
    User: { findById: jest.fn() },
    UserRole: { ADMIN: 'admin', PROVIDER: 'provider', CONSUMER: 'consumer' }
}));

jest.mock('../../../src/server/utils/keyAuthHelper', () => ({
    __esModule: true,
    default: {
        getInstance: jest.fn().mockReturnValue({ validateKey: mockValidateKey })
    }
}));

import { User, UserRole } from '@mxf-dev/core/models/user';
import {
    authenticateDual,
    requireAdmin,
    requireProvider
} from '../../../src/server/api/middleware/dualAuth';
import { signMagicLinkToken } from '../../../src/server/api/security/jwtTokenPolicy';

const buildRes = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

const buildReq = (fields: Record<string, unknown>): DualAuthenticatedRequest =>
    ({ method: 'DELETE', path: '/mcp/tools/x', ...fields } as unknown as DualAuthenticatedRequest);

describe('dualAuth role gates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('token purpose', () => {
        it('rejects a magic-link exchange token as ordinary API authentication', async () => {
            const token = signMagicLinkToken(
                'user-1',
                'person@example.test',
                'one-time-nonce',
                15
            );
            const req = buildReq({
                headers: { authorization: `Bearer ${token}` },
                query: {},
                body: {},
                params: {}
            });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            await authenticateDual(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
            expect(User.findById).not.toHaveBeenCalled();
            expect(mockValidateKey).not.toHaveBeenCalled();
        });
    });

    describe('key credential transport', () => {
        beforeEach(() => {
            mockValidateKey.mockResolvedValue({
                valid: true,
                agentId: 'agent-1',
                channelId: 'channel-1',
                allowedTools: ['task_complete']
            });
        });

        it('accepts the documented credential headers', async () => {
            const req = buildReq({
                headers: {
                    'x-key-id': 'key-1',
                    'x-secret-key': 'secret-1'
                },
                query: {},
                body: {},
                params: {}
            });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            await authenticateDual(req, res, next);

            expect(mockValidateKey).toHaveBeenCalledWith('key-1', 'secret-1');
            expect(next).toHaveBeenCalledTimes(1);
            expect(req.authType).toBe('key');
            expect(req.agent).toEqual({
                agentId: 'agent-1',
                channelId: 'channel-1',
                keyId: 'key-1',
                allowedTools: ['task_complete']
            });
        });

        it.each([
            ['query string', { query: { keyId: 'key-1', secretKey: 'secret-1' }, body: {}, params: {} }],
            ['request body', { query: {}, body: { keyId: 'key-1', secretKey: 'secret-1' }, params: {} }],
            ['URL parameter plus query secret', { query: { secretKey: 'secret-1' }, body: {}, params: { keyId: 'key-1' } }]
        ])('rejects credentials supplied through the %s', async (_label, credentialFields) => {
            const req = buildReq({ headers: {}, ...credentialFields });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            await authenticateDual(req, res, next);

            expect(mockValidateKey).not.toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
        });
    });

    describe('requireAdmin', () => {
        it('lets an admin user through', () => {
            const req = buildReq({ authType: 'jwt', user: { role: UserRole.ADMIN } });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireAdmin(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('refuses a non-admin user', () => {
            const req = buildReq({ authType: 'jwt', user: { role: UserRole.CONSUMER } });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireAdmin(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('refuses a key-authenticated agent — a key is not a role', () => {
            const req = buildReq({ authType: 'key', agent: { agentId: 'agent-1' } });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireAdmin(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('refuses a request with no auth type', () => {
            const req = buildReq({});
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireAdmin(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('refuses a JWT request with no user attached', () => {
            const req = buildReq({ authType: 'jwt' });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireAdmin(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });

    describe('requireProvider', () => {
        it('lets a provider through', () => {
            const req = buildReq({ authType: 'jwt', user: { role: UserRole.PROVIDER } });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireProvider(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('lets an admin through', () => {
            const req = buildReq({ authType: 'jwt', user: { role: UserRole.ADMIN } });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireProvider(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('refuses a consumer', () => {
            const req = buildReq({ authType: 'jwt', user: { role: UserRole.CONSUMER } });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireProvider(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('refuses a key-authenticated agent', () => {
            const req = buildReq({ authType: 'key', agent: { agentId: 'agent-1' } });
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            requireProvider(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
        });
    });
});
