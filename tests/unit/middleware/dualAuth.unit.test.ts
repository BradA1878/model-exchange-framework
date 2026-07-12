/**
 * Dual Auth Role Gate Unit Tests
 *
 * requireAdmin and requireProvider used to call next() for any key-authenticated
 * request — "agents with valid keys are considered to have admin access". A
 * channel key proves which channel you may act on; it carries no role. Any agent
 * holding any valid key was therefore an administrator on every admin-gated route.
 */

import { Request, Response, NextFunction } from 'express';

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
    requireEnv: jest.fn().mockReturnValue('test-jwt-secret')
}));

jest.mock('@mxf-dev/core/models/user', () => ({
    User: { findById: jest.fn() },
    UserRole: { ADMIN: 'admin', PROVIDER: 'provider', CONSUMER: 'consumer' }
}));

jest.mock('../../../src/server/utils/keyAuthHelper', () => ({
    __esModule: true,
    default: {
        getInstance: jest.fn().mockReturnValue({ validateKey: jest.fn() })
    }
}));

import { UserRole } from '@mxf-dev/core/models/user';
import { requireAdmin, requireProvider } from '../../../src/server/api/middleware/dualAuth';

const buildRes = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

const buildReq = (fields: Record<string, unknown>) =>
    ({ method: 'DELETE', path: '/mcp/tools/x', ...fields } as unknown as Request);

describe('dualAuth role gates', () => {
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
