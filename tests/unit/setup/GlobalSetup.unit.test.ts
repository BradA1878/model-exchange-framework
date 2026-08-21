const mockWaitOn = jest.fn<Promise<void>, [unknown]>();
const mockPost = jest.fn<Promise<unknown>, [string, unknown]>();
const mockIsAxiosError = jest.fn<boolean, [unknown]>();

jest.mock('wait-on', () => ({
    __esModule: true,
    default: mockWaitOn
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: {
        post: mockPost,
        isAxiosError: mockIsAxiosError
    }
}));

import globalSetup from '../../setup/globalSetup';

interface MockAxiosError {
    isAxiosError: true;
    message: string;
    response?: {
        status: number;
        data?: { message?: string };
    };
}

const axiosError = (status: number, message: string): MockAxiosError => ({
    isAxiosError: true,
    message,
    response: { status, data: { message } }
});

describe('integration global setup', () => {
    beforeEach((): void => {
        jest.clearAllMocks();
        mockWaitOn.mockResolvedValue(undefined);
        mockPost.mockResolvedValue({});
        mockIsAxiosError.mockImplementation((error: unknown): boolean =>
            (error as { isAxiosError?: boolean }).isAxiosError === true
        );
        jest.spyOn(console, 'log').mockImplementation((): void => undefined);
    });

    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it('prepares the demo user after the externally managed server is healthy', async () => {
        await expect(globalSetup()).resolves.toBeUndefined();

        expect(mockWaitOn).toHaveBeenCalledWith(expect.objectContaining({
            resources: ['http://localhost:3001/health']
        }));
        expect(mockPost).toHaveBeenCalledWith(
            'http://localhost:3001/api/users/register',
            expect.objectContaining({ username: 'demo-user' })
        );
    });

    it('accepts an authoritative already-exists response', async () => {
        mockPost.mockRejectedValue(axiosError(409, 'User already exists'));

        await expect(globalSetup()).resolves.toBeUndefined();
    });

    it('fails setup when user preparation returns an unrelated error', async () => {
        mockPost.mockRejectedValue(axiosError(503, 'Database unavailable'));

        await expect(globalSetup()).rejects.toThrow(
            'Unable to prepare integration-test user: Database unavailable'
        );
    });
});
