import type { Request, Response } from 'express';

const mockFindById = jest.fn();
const mockFindByIdAndDelete = jest.fn();

jest.mock('@mxf-dev/core/models/user', () => ({
    User: {
        findById: mockFindById,
        findByIdAndDelete: mockFindByIdAndDelete
    },
    UserRole: {
        ADMIN: 'admin',
        PROVIDER: 'provider',
        CONSUMER: 'consumer'
    }
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
    }))
}));
jest.mock('../../../src/server/api/security/jwtTokenPolicy', () => ({
    signMagicLinkToken: jest.fn(),
    signSessionToken: jest.fn(),
    verifyMagicLinkToken: jest.fn()
}));
jest.mock('../../../src/server/api/services/MagicLinkSender', () => ({
    getMagicLinkSender: jest.fn(),
    buildMagicLinkUrl: jest.fn()
}));

import { userController } from '../../../src/server/api/controllers/userController';
import {
    userSessionLifecycle,
    UserSocketSessionLifecycle
} from '../../../src/server/socket/services/UserSessionLifecycle';

const buildResponse = (): Response => {
    const response: Partial<Response> = {};
    response.status = jest.fn().mockReturnValue(response);
    response.json = jest.fn().mockReturnValue(response);
    return response as Response;
};

const responseBody = (response: Response): Record<string, unknown> => (
    (response.json as jest.Mock).mock.calls[0][0] as Record<string, unknown>
);

describe('userController live session invalidation', () => {
    let lifecycle: UserSocketSessionLifecycle;

    beforeEach(() => {
        jest.clearAllMocks();
        lifecycle = {
            registerUserSession: jest.fn(),
            disconnectTokenSessions: jest.fn(),
            disconnectUserSessions: jest.fn().mockResolvedValue(3)
        };
        userSessionLifecycle.setSocketLifecycle(lifecycle);
    });

    afterEach(() => {
        userSessionLifecycle.clearSocketLifecycle(lifecycle);
    });

    it('evicts every exact-user session after an administrator changes the role', async () => {
        const target = {
            _id: 'user-a',
            role: 'admin',
            save: jest.fn().mockResolvedValue(undefined)
        };
        mockFindById.mockResolvedValue(target);
        const response = buildResponse();

        await userController.updateUserRole({
            user: { id: 'admin-operator', role: 'admin' },
            body: { userId: 'user-a', role: 'consumer' }
        } as unknown as Request, response);

        expect(target.save).toHaveBeenCalledTimes(1);
        expect(lifecycle.disconnectUserSessions).toHaveBeenCalledWith('user-a');
        expect(response.status).toHaveBeenCalledWith(200);
        expect(responseBody(response).success).toBe(true);
    });

    it('does not evict another user or an unchanged role', async () => {
        const target = {
            _id: 'user-b',
            role: 'consumer',
            save: jest.fn().mockResolvedValue(undefined)
        };
        mockFindById.mockResolvedValue(target);
        const response = buildResponse();

        await userController.updateUserRole({
            user: { id: 'admin-operator', role: 'admin' },
            body: { userId: 'user-b', role: 'consumer' }
        } as unknown as Request, response);

        expect(lifecycle.disconnectUserSessions).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(200);
    });

    it('does not report a role change as successful when local eviction fails', async () => {
        const target = {
            _id: 'user-a',
            role: 'admin',
            save: jest.fn().mockResolvedValue(undefined)
        };
        mockFindById.mockResolvedValue(target);
        (lifecycle.disconnectUserSessions as jest.Mock)
            .mockRejectedValue(new Error('socket remained connected'));
        const response = buildResponse();

        await userController.updateUserRole({
            user: { id: 'admin-operator', role: 'admin' },
            body: { userId: 'user-a', role: 'consumer' }
        } as unknown as Request, response);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(responseBody(response).success).toBe(false);
    });

    it('deactivates an account and evicts every exact-user session before success', async () => {
        const target = {
            _id: 'user-a',
            role: 'admin',
            isActive: true,
            save: jest.fn().mockResolvedValue(undefined)
        };
        mockFindById.mockResolvedValue(target);
        const response = buildResponse();

        await userController.updateUserStatus({
            user: { id: 'admin-operator', role: 'admin' },
            body: { userId: 'user-a', isActive: false }
        } as unknown as Request, response);

        expect(target.isActive).toBe(false);
        expect(target.save).toHaveBeenCalledTimes(1);
        expect(lifecycle.disconnectUserSessions).toHaveBeenCalledWith('user-a');
        expect(response.status).toHaveBeenCalledWith(200);
    });

    it('does not report deactivation success when an exact-user socket remains live', async () => {
        const target = {
            _id: 'user-a',
            role: 'admin',
            isActive: true,
            save: jest.fn().mockResolvedValue(undefined)
        };
        mockFindById.mockResolvedValue(target);
        (lifecycle.disconnectUserSessions as jest.Mock)
            .mockRejectedValue(new Error('socket remained connected'));
        const response = buildResponse();

        await userController.updateUserStatus({
            user: { id: 'admin-operator', role: 'admin' },
            body: { userId: 'user-a', isActive: false }
        } as unknown as Request, response);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(responseBody(response).success).toBe(false);
    });

    it('evicts JWT, password, and PAT sessions after self-deletion', async () => {
        mockFindByIdAndDelete.mockResolvedValue({ _id: 'user-a' });
        const response = buildResponse();

        await userController.deleteProfile({
            user: { id: 'user-a', role: 'consumer' }
        } as unknown as Request, response);

        expect(mockFindByIdAndDelete).toHaveBeenCalledWith('user-a');
        expect(lifecycle.disconnectUserSessions).toHaveBeenCalledWith('user-a');
        expect(response.status).toHaveBeenCalledWith(200);
    });

    it('does not report deletion success when local session eviction cannot complete', async () => {
        mockFindByIdAndDelete.mockResolvedValue({ _id: 'user-a' });
        (lifecycle.disconnectUserSessions as jest.Mock)
            .mockRejectedValue(new Error('socket remained connected'));
        const response = buildResponse();

        await userController.deleteProfile({
            user: { id: 'user-a', role: 'consumer' }
        } as unknown as Request, response);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(responseBody(response).success).toBe(false);
    });
});
