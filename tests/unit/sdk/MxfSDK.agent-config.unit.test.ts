/** The public SDK constructor forwards caller options to the agent boundary. */
const mockAgentConstructor = jest.fn();

jest.mock('@mxf-dev/sdk/MxfAgent', () => ({
    MxfAgent: mockAgentConstructor
}));

import { MxfSDK, type AgentCreationConfig } from '@mxf-dev/sdk/MxfSDK';
import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';

const agentConfig: AgentCreationConfig = {
    agentId: 'agent-a',
    name: 'Agent A',
    channelId: 'channel-a',
    keyId: 'key-a',
    secretKey: 'secret-a',
    llmProvider: LlmProviderType.AZURE_OPENAI,
    defaultModel: 'deployment-a'
};

const connectedSdk = (): MxfSDK => {
    const sdk = new MxfSDK({
        serverUrl: 'https://mxf.example',
        domainKey: 'domain-a',
        accessToken: 'pat_test:secret'
    });
    // Authentication is covered by the socket lifecycle suite; this test starts
    // at that boundary and exercises the real public option-to-agent mapping.
    (sdk as unknown as { authenticated: boolean }).authenticated = true;
    return sdk;
};

describe('MxfSDK agent configuration', () => {
    beforeEach(() => mockAgentConstructor.mockClear());

    it('forwards session memory, disabled backfill and provider-specific options', async () => {
        const providerOptions = {
            endpoint: 'https://azure.example',
            deployment: 'deployment-a',
            apiVersion: 'test-version'
        };
        await connectedSdk().createAgent({
            ...agentConfig,
            memoryMode: 'session',
            backfillSearchIndexOnLoad: false,
            providerOptions
        });

        expect(mockAgentConstructor).toHaveBeenCalledWith(expect.objectContaining({
            memoryMode: 'session',
            backfillSearchIndexOnLoad: false,
            providerOptions,
            host: 'mxf.example',
            port: 443,
            secure: true
        }));
    });

    it('leaves omitted memory and provider options to their existing defaults', async () => {
        await connectedSdk().createAgent(agentConfig);
        expect(mockAgentConstructor).toHaveBeenCalledWith(expect.objectContaining({
            memoryMode: undefined,
            backfillSearchIndexOnLoad: undefined,
            providerOptions: undefined
        }));
    });
});
