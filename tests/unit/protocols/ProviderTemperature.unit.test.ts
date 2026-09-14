/** Verify the actual provider request builders preserve explicit temperature zero. */
import { lastValueFrom } from 'rxjs';
import { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import { McpContentType, McpMessage, McpRole } from '@mxf-dev/core/protocols/mcp/IMcpClient';
import { AnthropicMcpClient } from '@mxf-dev/core/protocols/mcp/providers/AnthropicMcpClient';
import { AzureOpenAiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/AzureOpenAiMcpClient';
import { GeminiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/GeminiMcpClient';
import { OllamaMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OllamaMcpClient';
import { OpenAiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenAiMcpClient';
import { OpenRouterMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenRouterMcpClient';
import { XaiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/XaiMcpClient';

const messages: McpMessage[] = [{ role: McpRole.USER, content: { type: McpContentType.TEXT, text: 'Hello' } }];
const context: AgentContext = {
    systemPrompt: 'Test agent.',
    agentConfig: { agentId: 'temperature-agent' } as AgentContext['agentConfig'],
    currentTask: null,
    conversationHistory: [{
        id: 'message', role: 'user', content: 'Hello', timestamp: 1,
        metadata: { contextLayer: 'conversation' }
    }] as AgentContext['conversationHistory'],
    recentActions: [], availableTools: [], agentId: 'temperature-agent', channelId: 'temperature-channel', timestamp: 1
};

// Only transport boundaries are stubbed; initialization, context conversion and
// request construction execute in the production provider clients.
const response = {
    id: 'response', model: 'test-model', role: 'assistant', text: 'ok',
    content: [{ type: 'text', text: 'ok' }], message: { content: 'ok' }, done: true,
    choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { input_tokens: 1, output_tokens: 1, prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
};

const providers = [
    { name: 'Anthropic', make: (): AnthropicMcpClient => new AnthropicMcpClient(), path: 'legacy' },
    { name: 'Anthropic', make: (): AnthropicMcpClient => new AnthropicMcpClient(), path: 'context' },
    { name: 'Xai', make: (): XaiMcpClient => new XaiMcpClient(), path: 'legacy' },
    { name: 'Xai', make: (): XaiMcpClient => new XaiMcpClient(), path: 'context' },
    { name: 'OpenRouter', make: (): OpenRouterMcpClient => new OpenRouterMcpClient(), path: 'legacy' },
    { name: 'OpenRouter', make: (): OpenRouterMcpClient => new OpenRouterMcpClient(), path: 'context' },
    { name: 'Ollama', make: (): OllamaMcpClient => new OllamaMcpClient(), path: 'context' },
    { name: 'AzureOpenAi', make: (): AzureOpenAiMcpClient => new AzureOpenAiMcpClient(), path: 'legacy' },
    { name: 'OpenAi', make: (): OpenAiMcpClient => new OpenAiMcpClient(), path: 'legacy' },
    { name: 'OpenAi', make: (): OpenAiMcpClient => new OpenAiMcpClient(), path: 'context' },
    { name: 'Gemini', make: (): GeminiMcpClient => new GeminiMcpClient(), path: 'context' }
];

describe.each(providers)('$name $path temperature', ({ name, make, path }) => {
    const originalFetch = global.fetch;
    const originalOptIn = process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        fetchMock = jest.fn().mockResolvedValue({
            ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response)
        });
        global.fetch = fetchMock as unknown as typeof fetch;
        process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = 'true';
    });

    afterEach(() => {
        global.fetch = originalFetch;
        if (originalOptIn === undefined) delete process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS;
        else process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = originalOptIn;
        jest.restoreAllMocks();
    });

    it.each([
        { label: 'configured zero', configured: 0, requested: undefined, expected: 0 },
        { label: 'per-request zero', configured: 0.8, requested: 0, expected: 0 },
        { label: 'absent value default', configured: undefined, requested: undefined, expected: 0.7 }
    ])('preserves $label in the outgoing request', async ({ configured, requested, expected }) => {
        const client = make();
        await lastValueFrom(client.initialize({
            apiKey: 'test-key', defaultModel: 'test-model', temperature: configured,
            providerOptions: { endpoint: 'https://test.invalid', deployment: 'test-deployment' }
        }));
        fetchMock.mockClear();
        const sdkRequest = jest.fn().mockResolvedValue(response);
        if (name === 'AzureOpenAi' || name === 'OpenAi') {
            Object.assign(client, { apiClient: { chat: { completions: { create: sdkRequest } } } });
        } else if (name === 'Gemini') {
            sdkRequest.mockResolvedValue({
                candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
            });
            Object.assign(client, { genAiClient: { models: { generateContent: sdkRequest } } });
        }

        const options = requested === undefined ? {} : { temperature: requested };
        if (path === 'context') await lastValueFrom(client.sendWithContext(context, options));
        else await lastValueFrom(client.sendMessage(messages, undefined, options));

        const request = sdkRequest.mock.calls.length
            ? sdkRequest.mock.calls[0][0]
            : JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(sdkRequest.mock.calls.length + fetchMock.mock.calls.length).toBe(1);
        const temperature = name === 'Ollama' ? request.options.temperature
            : name === 'Gemini' ? request.config.temperature : request.temperature;
        expect(temperature).toBe(expected);
    });
});

it('preserves explicit zero in the OpenAI Responses helper', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected network request')) as unknown as typeof fetch;
    try {
        const client = new OpenAiMcpClient();
        await lastValueFrom(client.initialize({ apiKey: 'test-key', defaultModel: 'test-model' }));
        const create = jest.fn().mockResolvedValue(response);
        Object.assign(client, { apiClient: { responses: { create } } });
        // This separate builder currently has no public dispatch path; exercise
        // its production implementation directly without inventing one.
        const send = Reflect.get(client, 'sendInstructionsBasedRequest') as (
            instructions: string, input: McpMessage['content'], options: { temperature: number }
        ) => Promise<unknown>;
        await send.call(client, 'Test instruction', messages[0].content, { temperature: 0 });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0 }));
    } finally {
        global.fetch = originalFetch;
    }
});
