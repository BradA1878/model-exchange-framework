/** Real OpenRouter adapter and SSE parser with HTTP stubbed at the transport boundary. */
import { lastValueFrom } from 'rxjs';
import type { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import type { McpRequestObservation } from '@mxf-dev/core/protocols/mcp/IMcpClient';
import { OpenRouterMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenRouterMcpClient';

const context: AgentContext = {
    promptMode: 'bare', systemPrompt: 'Exact prompt.  ', agentConfig: { agentId: 'agent' } as AgentContext['agentConfig'],
    currentTask: null, recentActions: [], availableTools: [], agentId: 'agent', channelId: 'channel', timestamp: 1,
    conversationHistory: [{ id: 'message', role: 'user', content: 'Hello.', timestamp: 1 }]
};
const responseBody = (usage?: Record<string, unknown>): Record<string, unknown> => ({
    id: 'response', model: 'provider-model', provider: 'actual-route',
    choices: [{ message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop', native_finish_reason: 'provider_done' }],
    ...(usage === undefined ? {} : { usage })
});
const streamResponse = (usage?: Record<string, unknown>): Response => new Response(new ReadableStream({
    start(controller): void {
        const chunks = [
            { id: 'response', model: 'provider-model', provider: 'actual-route', choices: [{ delta: { role: 'assistant' } }] },
            { choices: [{ delta: { reasoning: 'thought' } }] },
            { choices: [{ delta: { content: 'answer' } }] },
            { choices: [{ delta: {}, finish_reason: 'stop', native_finish_reason: 'provider_done' }] },
            ...(usage === undefined ? [] : [{ choices: [], usage }])
        ];
        const data = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
        // Split a JSON line across chunks to exercise buffering at the wire boundary.
        controller.enqueue(new TextEncoder().encode(data.slice(0, 40)));
        controller.enqueue(new TextEncoder().encode(data.slice(40)));
        controller.close();
    }
}), { headers: { 'Content-Type': 'text/event-stream' } });

describe('OpenRouter request observations', () => {
    const originalFetch = global.fetch;
    const envKeys = ['MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS', 'OPENROUTER_BASE_DELAY_MS'] as const;
    let saved: Array<string | undefined>;
    let fetchMock: jest.Mock;
    let client: OpenRouterMcpClient;
    beforeEach(async () => {
        saved = envKeys.map(key => process.env[key]);
        process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = 'true';
        process.env.OPENROUTER_BASE_DELAY_MS = '1';
        fetchMock = jest.fn();
        global.fetch = fetchMock as typeof fetch;
        client = new OpenRouterMcpClient();
        await lastValueFrom(client.initialize({ apiKey: 'test', defaultModel: 'test-model' }));
    });
    afterEach(() => {
        global.fetch = originalFetch;
        envKeys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
        jest.useRealTimers();
    });

    it.each([false, true])('captures exact body and actual usage/route/finish metadata (stream=%s)', async stream => {
        const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 7, cost: 0 };
        fetchMock.mockResolvedValue(stream ? streamResponse(usage) : new Response(JSON.stringify(responseBody(usage))));
        const observations: McpRequestObservation[] = [];
        const response = await lastValueFrom(client.sendWithContext(context, {
            stream,
            providerOptions: { provider: { order: ['preferred'], allow_fallbacks: false }, transforms: [], usage: { include: false } },
            requestTrace: { activationId: 'activation', captureBody: true, onRequest: (request: McpRequestObservation) => observations.push(request) }
        }));
        const wire = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(observations).toHaveLength(1);
        expect(observations[0].body).toEqual(wire);
        expect(wire).toMatchObject({ usage: { include: true }, provider: { order: ['preferred'], allow_fallbacks: false }, transforms: [] });
        expect(wire.messages).toEqual([{ role: 'system', content: 'Exact prompt.  ' }, { role: 'user', content: 'Hello.' }]);
        expect(wire).not.toHaveProperty('requestTrace');
        expect(response.usage).toEqual({ input_tokens: 3, output_tokens: 2, total_tokens: 7 });
        expect(response.request).toMatchObject({
            requestId: observations[0].requestId, activationId: 'activation', provider: 'openrouter',
            providerRoute: 'actual-route', costUsd: 0, finishReason: 'stop', nativeFinishReason: 'provider_done'
        });
        if (stream) expect(response.reasoning).toBe('thought');
    });

    it.each([false, true])('preserves absent usage/cost and reported zero separately (stream=%s)', async stream => {
        fetchMock.mockImplementation(async () => stream ? streamResponse() : new Response(JSON.stringify(responseBody())));
        const absent = await lastValueFrom(client.sendWithContext(context, { stream }));
        expect(absent.usage).toBeUndefined();
        expect(absent.request).not.toHaveProperty('costUsd');
        const zero = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        fetchMock.mockImplementation(async () => stream ? streamResponse(zero) : new Response(JSON.stringify(responseBody(zero))));
        expect((await lastValueFrom(client.sendWithContext(context, { stream }))).usage).toEqual({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    });

    it('observes each actual retry attempt and correlates only the successful response', async () => {
        jest.useFakeTimers();
        fetchMock.mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(responseBody())));
        const observed: McpRequestObservation[] = [];
        const operation = lastValueFrom(client.sendWithContext(context, { requestTrace: { captureBody: true, onRequest: (request: McpRequestObservation) => observed.push(request) } }));
        await jest.advanceTimersByTimeAsync(100);
        const response = await operation;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(observed).toHaveLength(2);
        expect(observed[0].requestId).not.toBe(observed[1].requestId);
        expect(response.request!.requestId).toBe(observed[1].requestId);
        observed.forEach((request, index) => expect(request.body).toEqual(JSON.parse(fetchMock.mock.calls[index][1].body)));
    });

    it.each(['', 'null', '42', '[]', '{"query":', '{}'])('validates accumulated bare streaming arguments %p', async argumentsText => {
        const chunks = [
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'lookup', arguments: argumentsText.slice(0, 4) } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText.slice(4) } }] }, finish_reason: 'tool_calls' }] }
        ];
        fetchMock.mockResolvedValue(new Response(new ReadableStream({
            start(controller): void {
                chunks.forEach(chunk => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)));
                controller.close();
            }
        })));
        const operation = lastValueFrom(client.sendWithContext(context, { stream: true }));
        if (argumentsText === '{}') {
            expect((await operation).content).toContainEqual(expect.objectContaining({ type: 'tool_use', name: 'lookup', input: {} }));
        } else {
            await expect(operation).rejects.toThrow(/tool call arguments/i);
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
