const mockFindOne = jest.fn();

jest.mock('@mxf-dev/core/models/personalAccessToken', () => ({
    __esModule: true,
    default: { findOne: mockFindOne },
    generatePersonalAccessToken: jest.fn()
}));
jest.mock('bcrypt', () => ({
    __esModule: true,
    default: { hash: jest.fn(), compare: jest.fn() }
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
    }))
}));

import { PersonalAccessTokenService } from '../../../src/server/api/services/PersonalAccessTokenService';
import {
    userSessionLifecycle,
    UserSocketSessionLifecycle
} from '../../../src/server/socket/services/UserSessionLifecycle';

interface MockTokenDocument extends Record<string, unknown> {
    isActive: boolean;
    save: jest.Mock;
}

const tokenDocument = (overrides: Record<string, unknown> = {}): MockTokenDocument => ({
    tokenId: 'token-a',
    userId: { toString: (): string => 'user-a' },
    isActive: true,
    revokedAt: undefined,
    revokedReason: undefined,
    updatedAt: new Date(0),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides
});

describe('PersonalAccessTokenService live session revocation', () => {
    let lifecycle: UserSocketSessionLifecycle;

    beforeEach(() => {
        jest.clearAllMocks();
        lifecycle = {
            registerUserSession: jest.fn(),
            disconnectTokenSessions: jest.fn().mockResolvedValue(2),
            disconnectUserSessions: jest.fn()
        };
        userSessionLifecycle.setSocketLifecycle(lifecycle);
    });

    afterEach(() => {
        userSessionLifecycle.clearSocketLifecycle(lifecycle);
    });

    it('does not complete revocation until every exact-token socket is evicted', async () => {
        const token = tokenDocument();
        mockFindOne.mockResolvedValue(token);

        await expect(PersonalAccessTokenService.getInstance().revokeToken(
            'token-a', 'user-a', 'rotated'
        )).resolves.toBe(true);

        expect(token.save).toHaveBeenCalledTimes(1);
        expect(lifecycle.disconnectTokenSessions).toHaveBeenCalledWith('token-a');
        expect(token).toEqual(expect.objectContaining({
            isActive: false,
            revokedAt: expect.any(Date),
            revokedReason: 'rotated'
        }));
    });

    it('propagates local eviction failure instead of reporting revocation success', async () => {
        const token = tokenDocument();
        mockFindOne.mockResolvedValue(token);
        (lifecycle.disconnectTokenSessions as jest.Mock)
            .mockRejectedValue(new Error('socket remained connected'));

        await expect(PersonalAccessTokenService.getInstance().revokeToken(
            'token-a', 'user-a'
        )).rejects.toThrow('socket remained connected');

        expect(token.save).toHaveBeenCalledTimes(1);
        expect(token.isActive).toBe(false);
    });

    it('never evicts a token owned by another user', async () => {
        mockFindOne.mockResolvedValue(tokenDocument({
            userId: { toString: (): string => 'user-b' }
        }));

        await expect(PersonalAccessTokenService.getInstance().revokeToken(
            'token-a', 'user-a'
        )).resolves.toBe(false);

        expect(lifecycle.disconnectTokenSessions).not.toHaveBeenCalled();
    });

    it('fails closed when no local socket lifecycle is installed', async () => {
        const token = tokenDocument();
        mockFindOne.mockResolvedValue(token);
        userSessionLifecycle.clearSocketLifecycle(lifecycle);

        await expect(PersonalAccessTokenService.getInstance().revokeToken(
            'token-a', 'user-a'
        )).rejects.toThrow('User socket session lifecycle is not initialized');

        expect(token.save).toHaveBeenCalledTimes(1);
    });
});
