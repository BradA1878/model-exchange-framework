/**
 * TestSDK SystemLLM safety tests.
 *
 * Integration tests run against a separate server process. The safety setting
 * therefore has to travel in the channel-creation request; changing a
 * ConfigManager singleton in this Jest process cannot protect the server.
 */

const mockConnect = jest.fn<Promise<void>, []>();
const mockCreateChannel = jest.fn();
const mockDisconnect = jest.fn<Promise<void>, []>();

jest.mock('@mxf-dev/sdk', () => ({
    MxfSDK: jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        createChannel: mockCreateChannel,
        disconnect: mockDisconnect
    })),
    LlmProviderType: {
        OPENROUTER: 'openrouter'
    }
}));

import { createTestSDK } from '../../utils/TestSDK';

const createSdk = (): ReturnType<typeof createTestSDK> => createTestSDK({
    serverUrl: 'http://test.invalid',
    domainKey: 'test-domain-key',
    username: 'test-user',
    password: 'test-password'
});

describe('TestSDK channel SystemLLM safety', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockConnect.mockResolvedValue(undefined);
        mockDisconnect.mockResolvedValue(undefined);
        mockCreateChannel.mockResolvedValue({
            getChannelId: jest.fn().mockReturnValue('test-channel')
        });
    });

    it('sends systemLlmEnabled=false in the channel creation request when disabled', async () => {
        const sdk = createSdk();

        await sdk.createTestChannel('safe-channel', {
            disableSystemLlm: true
        });

        expect(mockCreateChannel).toHaveBeenCalledTimes(1);
        const [channelId, channelConfig] = mockCreateChannel.mock.calls[0];
        expect(channelId).toMatch(/^safe-channel-/);
        expect(channelConfig).toEqual(expect.objectContaining({
            systemLlmEnabled: false
        }));
    });

    it('fails closed when disableSystemLlm is omitted', async () => {
        const sdk = createSdk();

        await sdk.createTestChannel('default-safe');

        const [, channelConfig] = mockCreateChannel.mock.calls[0];
        expect(channelConfig.systemLlmEnabled).toBe(false);
    });

    it('enables SystemLLM only through an explicit test opt-in', async () => {
        const sdk = createSdk();

        await sdk.createTestChannel('explicit-system-llm', {
            disableSystemLlm: false
        });

        const [, channelConfig] = mockCreateChannel.mock.calls[0];
        expect(channelConfig.systemLlmEnabled).toBe(true);
    });
});
