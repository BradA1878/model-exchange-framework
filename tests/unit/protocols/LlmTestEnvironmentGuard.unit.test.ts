/**
 * External provider calls are blocked in test processes unless the run opts in
 * explicitly. The assertion sits before fetch so real credentials in a
 * developer's environment cannot turn an ordinary test into a paid request.
 */

import { lastValueFrom } from 'rxjs';
import { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import { McpContentType, McpRole } from '@mxf-dev/core/protocols/mcp/IMcpClient';
import {
    EXTERNAL_LLM_TEST_OPT_IN_ENV
} from '@mxf-dev/core/protocols/mcp/LlmTestEnvironmentGuard';
import { OpenRouterMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenRouterMcpClient';

function buildContext(): AgentContext {
    return {
        systemPrompt: 'Test system prompt',
        agentConfig: {
            agentId: 'guard-test-agent',
            channelId: 'guard-test-channel',
            name: 'Guard test agent',
            host: 'localhost',
            port: 3001,
            secure: false,
            keyId: 'guard-key',
            secretKey: 'guard-secret',
            apiUrl: 'http://localhost:3001',
            apiKey: 'guard-api-key',
            agentConfigPrompt: 'Test agent'
        },
        currentTask: null,
        conversationHistory: [{
            id: 'message-1',
            role: 'user',
            content: 'Hello',
            timestamp: Date.now(),
            metadata: { contextLayer: 'conversation' }
        }],
        recentActions: [],
        availableTools: [],
        agentId: 'guard-test-agent',
        channelId: 'guard-test-channel',
        timestamp: Date.now()
    };
}

function successfulResponse(): Response {
    return new Response(JSON.stringify({
            id: 'guard-response',
            model: 'test-model',
            choices: [{
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop'
            }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }), { status: 200 });
}

describe('external LLM test-environment guard', () => {
    const originalFetch = global.fetch;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalOptIn = process.env[EXTERNAL_LLM_TEST_OPT_IN_ENV];
    let fetchMock: jest.Mock;
    let client: OpenRouterMcpClient;

    beforeEach(async () => {
        process.env.NODE_ENV = 'test';
        delete process.env[EXTERNAL_LLM_TEST_OPT_IN_ENV];
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof global.fetch;
        client = new OpenRouterMcpClient();
        await lastValueFrom(client.initialize({
            apiKey: 'credential-that-must-not-be-used',
            defaultModel: 'test-model'
        }));
    });

    afterEach(() => {
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
        if (originalOptIn === undefined) {
            delete process.env[EXTERNAL_LLM_TEST_OPT_IN_ENV];
        } else {
            process.env[EXTERNAL_LLM_TEST_OPT_IN_ENV] = originalOptIn;
        }
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('blocks context requests before fetch when no opt-in is present', async () => {
        await expect(
            lastValueFrom(client.sendWithContext!(buildContext(), {}))
        ).rejects.toThrow(
            `External LLM call blocked for OpenRouterMcpClient because NODE_ENV=test. ` +
            `Set ${EXTERNAL_LLM_TEST_OPT_IN_ENV}=true`
        );

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('also blocks the inherited sendMessage API before fetch', async () => {
        await expect(lastValueFrom(client.sendMessage([{
            role: McpRole.USER,
            content: {
                type: McpContentType.TEXT,
                text: 'Hello'
            }
        }]))).rejects.toThrow(/External LLM call blocked/);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows a deliberately opted-in request', async () => {
        process.env[EXTERNAL_LLM_TEST_OPT_IN_ENV] = 'true';
        fetchMock.mockResolvedValue(successfulResponse());

        await expect(
            lastValueFrom(client.sendWithContext!(buildContext(), {}))
        ).resolves.toEqual(expect.objectContaining({ id: 'guard-response' }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not treat a merely truthy opt-in value as authorization', async () => {
        process.env[EXTERNAL_LLM_TEST_OPT_IN_ENV] = '1';

        await expect(
            lastValueFrom(client.sendWithContext!(buildContext(), {}))
        ).rejects.toThrow(/External LLM call blocked/);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
