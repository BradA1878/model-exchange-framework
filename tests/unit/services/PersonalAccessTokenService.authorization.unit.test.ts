const mockFindOne = jest.fn();
const mockCompare = jest.fn();

jest.mock('@mxf-dev/core/models/personalAccessToken', () => ({
    __esModule: true,
    default: { findOne: mockFindOne },
    generatePersonalAccessToken: jest.fn()
}));

jest.mock('bcrypt', () => ({
    __esModule: true,
    default: {
        hash: jest.fn(),
        compare: mockCompare
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

import { PersonalAccessTokenService } from '../../../src/server/api/services/PersonalAccessTokenService';

interface MockTokenDocument extends Record<string, unknown> {
    save: jest.Mock;
}

const tokenDocument = (userId: string): MockTokenDocument => ({
    tokenId: 'mxf_target',
    tokenHash: 'stored-hash',
    userId: { toString: (): string => userId },
    scopes: ['sdk'],
    isActive: true,
    revokedAt: undefined,
    expiresAt: undefined,
    usageCount: 0,
    dailyUsageCount: 0,
    monthlyUsageCount: 0,
    lastDailyReset: undefined,
    lastMonthlyReset: undefined,
    updatedAt: new Date(0),
    save: jest.fn().mockResolvedValue(undefined)
});

describe('PersonalAccessTokenService management validation authorization', () => {
    let service: PersonalAccessTokenService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = PersonalAccessTokenService.getInstance();
    });

    it('applies ownership in the database query before secret verification or mutation', async () => {
        mockFindOne.mockResolvedValue(null);

        const result = await service.validateTokenForRequester(
            'mxf_target',
            'secret',
            { userId: 'user-a', isAdmin: false }
        );

        expect(mockFindOne).toHaveBeenCalledWith({
            tokenId: 'mxf_target',
            userId: 'user-a'
        });
        expect(mockCompare).not.toHaveBeenCalled();
        expect(result).toEqual({ valid: false, error: 'Token not found or access denied' });
    });

    it('validates and records usage for a token owned by the requester', async () => {
        const token = tokenDocument('user-a');
        mockFindOne.mockResolvedValue(token);
        mockCompare.mockResolvedValue(true);

        const result = await service.validateTokenForRequester(
            'mxf_target',
            'secret',
            { userId: 'user-a', isAdmin: false }
        );

        expect(mockFindOne).toHaveBeenCalledWith({
            tokenId: 'mxf_target',
            userId: 'user-a'
        });
        expect(mockCompare).toHaveBeenCalledWith('secret', 'stored-hash');
        expect(token.save).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            valid: true,
            userId: 'user-a',
            scopes: ['sdk'],
            tokenId: 'mxf_target'
        });
    });

    it('allows an administrator to validate a token without an owner predicate', async () => {
        const token = tokenDocument('user-b');
        mockFindOne.mockResolvedValue(token);
        mockCompare.mockResolvedValue(true);

        const result = await service.validateTokenForRequester(
            'mxf_target',
            'secret',
            { userId: 'admin-a', isAdmin: true }
        );

        expect(mockFindOne).toHaveBeenCalledWith({ tokenId: 'mxf_target' });
        expect(token.save).toHaveBeenCalledTimes(1);
        expect(result.valid).toBe(true);
        expect(result.userId).toBe('user-b');
    });
});
