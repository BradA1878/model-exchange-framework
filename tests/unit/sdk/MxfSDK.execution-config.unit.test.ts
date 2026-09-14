const mockAgentConstructor = jest.fn();
jest.mock('@mxf-dev/sdk/MxfAgent', () => ({ MxfAgent: mockAgentConstructor }));

import { MxfSDK, type AgentCreationConfig } from '@mxf-dev/sdk/MxfSDK';
import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';

const baseConfig: AgentCreationConfig = {
    agentId: 'worker', name: 'Worker', channelId: 'channel', keyId: 'key', secretKey: 'secret',
    llmProvider: LlmProviderType.OPENROUTER, defaultModel: 'test-model'
};

const authenticatedSdk = (): MxfSDK => {
    const sdk = new MxfSDK({ serverUrl: 'https://mxf.example', domainKey: 'domain', accessToken: 'pat_test:secret' });
    // Authentication itself is tested by the socket lifecycle suite.
    (sdk as unknown as { authenticated: boolean }).authenticated = true;
    return sdk;
};

describe('public SDK execution controls', () => {
    beforeEach(() => mockAgentConstructor.mockClear());

    it('forwards all controls and preserves the exact bare prompt', async () => {
        const controls = {
            promptMode: 'bare' as const, activation: 'message' as const,
            circuitBreakerEnabled: false, captureLlmRequests: true,
            agentConfigPrompt: '\nObserve.\r\nNo assigned task.\n', maxIterations: 5,
            mxpEnabled: false, disableTaskHandling: true
        };
        await authenticatedSdk().createAgent({ ...baseConfig, ...controls });
        expect(mockAgentConstructor).toHaveBeenCalledWith(expect.objectContaining(controls));
    });

    it('keeps omitted settings and the existing framework prompt default', async () => {
        await authenticatedSdk().createAgent(baseConfig);
        expect(mockAgentConstructor).toHaveBeenCalledWith(expect.objectContaining({
            promptMode: undefined, activation: undefined, circuitBreakerEnabled: undefined, captureLlmRequests: undefined,
            agentConfigPrompt: 'You are Worker, an AI agent in the channel channel.'
        }));
    });

    it('rejects a missing bare prompt before fallback construction', async () => {
        await expect(authenticatedSdk().createAgent({ ...baseConfig, promptMode: 'bare' }))
            .rejects.toThrow('Bare prompt mode requires a non-empty agentConfigPrompt');
        expect(mockAgentConstructor).not.toHaveBeenCalled();
    });

    it('rejects incompatible message aggregation before constructing an agent', async () => {
        await expect(authenticatedSdk().createAgent({ ...baseConfig, activation: 'message', useMessageAggregate: true }))
            .rejects.toThrow('Message activation cannot enable message aggregation');
        expect(mockAgentConstructor).not.toHaveBeenCalled();
    });
});
