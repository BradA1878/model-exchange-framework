/** Exercise real provider conversion and installed SDK serialization; stub HTTP only. */
import { lastValueFrom } from 'rxjs';
import type { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import type { McpRequestObservation, McpTool } from '@mxf-dev/core/protocols/mcp/IMcpClient';
import { AnthropicMcpClient } from '@mxf-dev/core/protocols/mcp/providers/AnthropicMcpClient';
import { AzureOpenAiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/AzureOpenAiMcpClient';
import { GeminiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/GeminiMcpClient';
import { OllamaMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OllamaMcpClient';
import { OpenAiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenAiMcpClient';
import { OpenRouterMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenRouterMcpClient';
import { XaiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/XaiMcpClient';
import { CustomMcpClient } from '@mxf-dev/core/protocols/mcp/providers/CustomMcpClient';
import { buildBareContextMessages } from '@mxf-dev/core/protocols/mcp/providers/BareContextMessages';

const prompt = 'First line.\n{{date}} stays literal.\nLast line.  ';
const tool: McpTool = {
    name: 'lookup', description: 'Read this exact description.\nNo extra guidance.',
    input_schema: { type: 'object', properties: { query: { type: 'string', minLength: 1 } }, required: ['query'], additionalProperties: false }
};
const context = (): AgentContext => ({
    promptMode: 'bare', systemPrompt: prompt,
    agentConfig: { agentId: 'bare-agent' } as AgentContext['agentConfig'],
    currentTask: { taskId: 'hidden-task', description: 'Do not inject this task.' },
    recentActions: [{ action: 'Do not inject this action.' }] as AgentContext['recentActions'],
    availableTools: [tool], agentId: 'bare-agent', channelId: 'bare-channel', timestamp: 1,
    conversationHistory: [{ id: 'inbound', role: 'user', content: 'Hello.', timestamp: 1, metadata: { fromAgentId: 'agent-02' } }]
});
const reply = {
    id: 'provider-response', model: 'test-model', role: 'assistant', type: 'message',
    content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', done: true,
    message: { role: 'assistant', content: 'ok' },
    choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    usage: { input_tokens: 1, output_tokens: 1, prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    prompt_eval_count: 1, eval_count: 1
};
const httpReply = (value: unknown = reply, status = 200): Response => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'retry-after-ms': '1' }
});
const providers = [
    { name: 'openrouter', make: (): OpenRouterMcpClient => new OpenRouterMcpClient() },
    { name: 'anthropic', make: (): AnthropicMcpClient => new AnthropicMcpClient() },
    { name: 'openai', make: (): OpenAiMcpClient => new OpenAiMcpClient() },
    { name: 'azure-openai', make: (): AzureOpenAiMcpClient => new AzureOpenAiMcpClient() },
    { name: 'xai', make: (): XaiMcpClient => new XaiMcpClient() },
    { name: 'ollama', make: (): OllamaMcpClient => new OllamaMcpClient() },
    { name: 'gemini', make: (): GeminiMcpClient => new GeminiMcpClient() }
];

/** Native responses exercise provider conversion without replacing converter methods. */
const toolReply = (provider: string, input: unknown, rawArguments?: string): Record<string, unknown> => {
    if (provider === 'anthropic') return { ...reply, content: [{ type: 'tool_use', id: 'call', name: 'lookup', input }] };
    if (provider === 'gemini') return { ...reply, candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'lookup', args: input } }] } }] };
    const toolCall = { id: 'call', type: 'function', function: { name: 'lookup', arguments: rawArguments ?? (provider === 'ollama' ? input : JSON.stringify(input)) } };
    const message = { role: 'assistant', content: '', tool_calls: [toolCall] };
    return { ...reply, message, choices: [{ message, finish_reason: 'tool_calls' }] };
};

describe('bare provider requests', () => {
    const originalFetch = global.fetch;
    const originalOptIn = process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = 'true';
        fetchMock = jest.fn(async () => httpReply());
        global.fetch = fetchMock as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
        if (originalOptIn === undefined) delete process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS;
        else process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = originalOptIn;
        jest.useRealTimers();
    });

    const initialize = async (make: typeof providers[number]['make']): Promise<ReturnType<typeof providers[number]['make']>> => {
        const client = make();
        await lastValueFrom(client.initialize({
            apiKey: 'test-key', defaultModel: 'test-model',
            providerOptions: { endpoint: 'https://azure.test.invalid', deployment: 'test-deployment' }
        }));
        fetchMock.mockClear();
        return client;
    };

    it.each(providers)('$name sends only the literal operator prompt, attributed dialogue and unchanged tools', async ({ name, make }) => {
        const client = await initialize(make);
        const observations: McpRequestObservation[] = [];
        const result = await lastValueFrom(client.sendWithContext(context(), {
            requestTrace: { activationId: 'activation-one', captureBody: name !== 'gemini', onRequest: (request: McpRequestObservation) => observations.push(request) }
        }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        if (name === 'anthropic') {
            expect(body.system).toBe(prompt);
            expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '[agent-02]: Hello.' }] }]);
            expect(body.tools[0]).toEqual(tool);
        } else if (name === 'gemini') {
            expect(body.systemInstruction.parts).toEqual([{ text: prompt }]);
            expect(body.contents).toEqual([{ role: 'user', parts: [{ text: '[agent-02]: Hello.' }] }]);
            expect(body.tools[0].functionDeclarations[0].description).toBe(tool.description);
            expect(body.tools[0].functionDeclarations[0].parameters).toEqual(tool.input_schema);
            expect(observations).toHaveLength(0);
            expect(result.request).toBeUndefined();
        } else {
            expect(body.messages).toEqual([
                { role: 'system', content: prompt }, { role: 'user', content: '[agent-02]: Hello.' }
            ]);
            expect(body.tools[0].function.description).toBe(tool.description);
            expect(body.tools[0].function.parameters).toEqual(tool.input_schema);
        }
        if (name !== 'gemini') {
            expect(observations).toHaveLength(1);
            expect(observations[0].body).toEqual(body);
            expect(observations[0].provider).toBe(name);
            expect(result.request).toMatchObject({ requestId: observations[0].requestId, activationId: 'activation-one', provider: name });
            expect(result.request!.latencyMs).toBeGreaterThanOrEqual(0);
            expect(result.request).not.toHaveProperty('costUsd');
        }
    });

    it.each(providers)('$name retains native assistant calls and raw tool results', async ({ name, make }) => {
        const client = await initialize(make);
        const requestContext = context();
        requestContext.conversationHistory.push(
            { id: 'assistant', role: 'assistant', content: '', timestamp: 2, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"query":"x"}' } }] },
            { id: 'result', role: 'tool', content: 'denied verbatim', timestamp: 3, metadata: { tool_call_id: 'call-1' } }
        );
        await lastValueFrom(client.sendWithContext(requestContext));
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        if (name === 'anthropic') {
            expect(body.messages.slice(1)).toEqual([
                { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'lookup', input: { query: 'x' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'denied verbatim' }] }] }
            ]);
        } else if (name === 'gemini') {
            expect(body.contents.slice(1)).toEqual([
                { role: 'model', parts: [{ functionCall: { name: 'lookup', args: { query: 'x' } } }] },
                { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { output: 'denied verbatim' } } }] }
            ]);
        } else if (name === 'ollama') {
            expect(body.messages.slice(2)).toEqual([
                { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: { query: 'x' } } }] },
                { role: 'tool', content: 'denied verbatim', tool_name: 'lookup' }
            ]);
        } else {
            expect(body.messages.slice(2)).toEqual([
                { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"query":"x"}' } }] },
                { role: 'tool', content: 'denied verbatim', tool_call_id: 'call-1' }
            ]);
        }
    });

    it('keeps custom-provider helper tool roles and IDs intact', () => {
        class CustomProbe extends CustomMcpClient { public format = this.structureMessagesFromContext; }
        const messages = new CustomProbe().format(context());
        expect(messages).toEqual([{ role: 'system', content: prompt }, { role: 'user', content: '[agent-02]: Hello.' }]);
    });

    it('rejects Gemini capture before HTTP without inventing request observations', async () => {
        const client = await initialize(() => new GeminiMcpClient());
        const onRequest = jest.fn();
        await expect(lastValueFrom(client.sendWithContext(context(), { requestTrace: { captureBody: true, onRequest } })))
            .rejects.toThrow('Gemini does not support exact HTTP request capture');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(onRequest).not.toHaveBeenCalled();
    });

    it.each(providers.filter(provider => provider.name !== 'gemini'))('$name captures a separate snapshot and omits the body when capture is off', async ({ make }) => {
        const client = await initialize(make);
        await lastValueFrom(client.sendWithContext(context(), {
            requestTrace: { captureBody: true, onRequest: (request: McpRequestObservation) => { request.body!.injected = 'observer mutation'; } }
        }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('injected');
        const onRequest = jest.fn();
        await lastValueFrom(client.sendWithContext(context(), { requestTrace: { captureBody: false, onRequest } }));
        expect(onRequest.mock.calls[0][0]).not.toHaveProperty('body');
    });

    it.each(providers.filter(provider => ['openai', 'azure-openai'].includes(provider.name)))('$name assigns distinct IDs to SDK retries', async ({ make }) => {
        jest.useFakeTimers();
        const client = await initialize(make);
        fetchMock.mockResolvedValueOnce(httpReply({ error: { message: 'retryable' } }, 500));
        const observations: McpRequestObservation[] = [];
        const operation = lastValueFrom(client.sendWithContext(context(), { requestTrace: { captureBody: true, onRequest: (request: McpRequestObservation) => observations.push(request) } }));
        await jest.advanceTimersByTimeAsync(20);
        const response = await operation;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(observations).toHaveLength(2);
        expect(observations[0].requestId).not.toBe(observations[1].requestId);
        expect(response.request!.requestId).toBe(observations[1].requestId);
    });

    it.each(providers.filter(provider => ['openai', 'azure-openai'].includes(provider.name)))('$name isolates concurrent request observations', async ({ make }) => {
        const client = await initialize(make);
        let releaseFirst!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { releaseFirst = resolve; }));
        const firstObserved = jest.fn();
        const first = lastValueFrom(client.sendWithContext(context(), { requestTrace: { activationId: 'first', onRequest: firstObserved } }));
        while (!releaseFirst) await Promise.resolve();
        const secondObserved = jest.fn();
        const second = await lastValueFrom(client.sendWithContext(context(), { requestTrace: { activationId: 'second', onRequest: secondObserved } }));
        releaseFirst(httpReply());
        expect((await first).request).toMatchObject({ activationId: 'first', requestId: firstObserved.mock.calls[0][0].requestId });
        expect(second.request).toMatchObject({ activationId: 'second', requestId: secondObserved.mock.calls[0][0].requestId });
    });

    it.each(providers)('$name distinguishes absent usage from reported zero', async ({ make }) => {
        const client = await initialize(make);
        const absent = { ...reply, usage: undefined, usageMetadata: undefined, prompt_eval_count: undefined, eval_count: undefined };
        fetchMock.mockResolvedValueOnce(httpReply(absent));
        expect((await lastValueFrom(client.sendWithContext(context()))).usage).toBeUndefined();
        fetchMock.mockResolvedValueOnce(httpReply({ ...reply,
            usage: { input_tokens: 0, output_tokens: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
            prompt_eval_count: 0, eval_count: 0
        }));
        expect((await lastValueFrom(client.sendWithContext(context()))).usage).toEqual({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    });

    it.each(providers)('$name rejects non-object bare response arguments but preserves valid empty objects', async ({ name, make }) => {
        for (const invalid of [undefined, '', null, 42, []]) {
            // Each independent malformed response gets a fresh client so repeated
            // intentional failures do not trip OpenRouter's existing circuit breaker.
            const client = await initialize(make);
            fetchMock.mockResolvedValueOnce(httpReply(toolReply(name, invalid)));
            await expect(lastValueFrom(client.sendWithContext(context()))).rejects.toThrow(/tool call arguments/i);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
        const client = await initialize(make);
        fetchMock.mockResolvedValueOnce(httpReply(toolReply(name, {})));
        const result = await lastValueFrom(client.sendWithContext(context()));
        expect(result.content).toContainEqual(expect.objectContaining({ type: 'tool_use', name: 'lookup', input: {} }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(providers.filter(provider => ['openai', 'azure-openai', 'openrouter', 'xai', 'ollama'].includes(provider.name)))('$name retains malformed raw arguments in its error', async ({ name, make }) => {
        const client = await initialize(make);
        const malformed = '{"query":';
        fetchMock.mockResolvedValueOnce(httpReply(toolReply(name, undefined, malformed)));
        await expect(lastValueFrom(client.sendWithContext(context()))).rejects.toThrow(JSON.stringify(malformed));
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(providers.filter(provider => ['openai', 'openrouter'].includes(provider.name)))('$name retains framework-mode malformed-input behavior', async ({ name, make }) => {
        const client = await initialize(make);
        const malformed = '{"query":';
        fetchMock.mockResolvedValueOnce(httpReply(toolReply(name, undefined, malformed)));
        const frameworkContext = context();
        frameworkContext.promptMode = 'framework';
        const result = await lastValueFrom(client.sendWithContext(frameworkContext));
        expect(result.content).toContainEqual(expect.objectContaining({ type: 'tool_use', input: name === 'openrouter' ? {} : { raw: malformed } }));
    });

    it('keeps actual tool results adjacent across inbound dialogue and rejects broken pairing', () => {
        const requestContext = context();
        requestContext.conversationHistory.push(
            { id: 'call', role: 'assistant', content: '', timestamp: 2, tool_calls: [{ id: 'id', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
            { id: 'peer', role: 'user', content: 'Concurrent question.', timestamp: 3, metadata: { fromAgentId: 'peer' } },
            { id: 'result', role: 'tool', content: 'actual result', timestamp: 4, metadata: { tool_call_id: 'id' } }
        );
        expect(buildBareContextMessages(requestContext).slice(2).map(message => [message.role, message.content])).toEqual([
            ['assistant', ''], ['tool', 'actual result'], ['user', '[peer]: Concurrent question.']
        ]);
        requestContext.conversationHistory.pop();
        expect(() => buildBareContextMessages(requestContext)).toThrow('Missing tool result: id');
        requestContext.conversationHistory.push({ id: 'orphan', role: 'tool', content: 'orphan', timestamp: 5, metadata: { tool_call_id: 'other' } });
        requestContext.conversationHistory.splice(1, 1);
        expect(() => buildBareContextMessages(requestContext)).toThrow('no matching assistant call');
    });
});
