/** Run the installed Google SDK serializer, replacing only its HTTP transport. */
import { lastValueFrom } from 'rxjs';
import { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import { McpContentType, McpMessage, McpRole, McpTool } from '@mxf-dev/core/protocols/mcp/IMcpClient';
import { GeminiMcpClient } from '@mxf-dev/core/protocols/mcp/providers/GeminiMcpClient';

const instruction = 'Keep the system instruction separate from user dialogue.';
const tool: McpTool = {
    name: 'lookup', description: 'Look up a query',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
};
const messages: McpMessage[] = [
    { role: McpRole.SYSTEM, content: { type: McpContentType.TEXT, text: instruction } },
    { role: McpRole.USER, content: { type: McpContentType.TEXT, text: 'Hello' } }
];
const context: AgentContext = {
    systemPrompt: instruction,
    agentConfig: { agentId: 'wire-agent' } as AgentContext['agentConfig'],
    currentTask: null,
    conversationHistory: [{
        id: 'message', role: 'user', content: 'Hello', timestamp: 1,
        metadata: { contextLayer: 'conversation' }
    }] as AgentContext['conversationHistory'],
    recentActions: [], availableTools: [], agentId: 'wire-agent', channelId: 'wire-channel', timestamp: 1
};

describe('Gemini installed SDK wire contract', () => {
    const originalFetch = global.fetch;
    const originalOptIn = process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS;
    let fetchMock: jest.Mock;
    let client: GeminiMcpClient;

    beforeEach(async () => {
        fetchMock = jest.fn().mockImplementation(async () => new Response(JSON.stringify({
            candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        global.fetch = fetchMock as unknown as typeof fetch;
        process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = 'true';
        client = new GeminiMcpClient();
        await lastValueFrom(client.initialize({ apiKey: 'test-key', defaultModel: 'gemini-test', temperature: 0.8 }));
    });

    afterEach(() => {
        global.fetch = originalFetch;
        if (originalOptIn === undefined) delete process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS;
        else process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = originalOptIn;
    });

    it.each([
        { path: 'legacy', tools: false }, { path: 'legacy', tools: true },
        { path: 'context', tools: false }, { path: 'context', tools: true }
    ])('preserves instructions and generation config on $path with tools=$tools', async ({ path, tools }) => {
        const options = { temperature: 0, maxTokens: 123, topK: 11, topP: 0.4, requireToolUse: true };
        if (path === 'legacy') {
            await lastValueFrom(client.sendMessage(messages, tools ? [tool] : [], options));
        } else {
            await lastValueFrom(client.sendWithContext({ ...context, availableTools: tools ? [tool] : [] }, options));
        }

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.systemInstruction.parts).toEqual(expect.arrayContaining([
            { text: expect.stringContaining(instruction) }
        ]));
        expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Hello' }] }]);
        expect(body.generationConfig).toEqual(expect.objectContaining({
            temperature: 0, maxOutputTokens: 123, topK: 11, topP: 0.4
        }));
        if (tools) {
            expect(body.tools[0].functionDeclarations).toEqual([expect.objectContaining({ name: 'lookup' })]);
            expect(body.toolConfig.functionCallingConfig).toEqual({
                mode: path === 'legacy' ? 'ANY' : 'AUTO', allowedFunctionNames: ['lookup']
            });
        } else {
            expect(body).not.toHaveProperty('tools');
        }
    });

    it.each(['legacy', 'context'])('maps %s text once and retains reported usage', async path => {
        const response = await lastValueFrom(path === 'legacy'
            ? client.sendMessage(messages)
            : client.sendWithContext(context));
        expect(response.content).toEqual([{ type: McpContentType.TEXT, text: 'ok' }]);
        expect(response.usage).toEqual({ input_tokens: 2, output_tokens: 1, total_tokens: 3 });
    });

    it.each([false, true])('preserves function calls in a response with text=%s', async withText => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            candidates: [{
                content: { role: 'model', parts: [
                    ...(withText ? [{ text: 'Looking up both records.' }] : []),
                    { functionCall: { name: 'lookup', args: { query: 'first' } } },
                    { functionCall: { name: 'lookup', args: { query: 'second' } } }
                ] },
                finishReason: 'STOP'
            }],
            // Retain the reported total even when it includes tokens outside the
            // prompt/candidate split. Deriving a sum would discard that evidence.
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 11 }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const response = await lastValueFrom(client.sendWithContext({ ...context, availableTools: [tool] }));
        expect(response.content).toEqual([
            ...(withText ? [{ type: McpContentType.TEXT, text: 'Looking up both records.' }] : []),
            { type: McpContentType.TOOL_USE, id: expect.any(String), name: 'lookup', input: { query: 'first' } },
            { type: McpContentType.TOOL_USE, id: expect.any(String), name: 'lookup', input: { query: 'second' } }
        ]);
        const calls = response.content.filter(part => part.type === McpContentType.TOOL_USE);
        expect(calls[0].id).not.toBe(calls[1].id);
        expect(response.usage).toEqual({ input_tokens: 5, output_tokens: 2, total_tokens: 11 });
    });

    it('preserves explicit zero usage without substituting other values', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'ok' }] } }],
            usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const response = await lastValueFrom(client.sendMessage(messages));
        expect(response.usage).toEqual({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    });

    it('omits unreported usage instead of inventing a zero-cost call', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'ok' }] } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const response = await lastValueFrom(client.sendMessage(messages));
        expect(response.usage).toBeUndefined();
    });

    it.each([
        { promptTokenCount: 2, candidatesTokenCount: 1 },
        { promptTokenCount: 2, candidatesTokenCount: -1, totalTokenCount: 1 }
    ])('rejects incomplete or invalid reported usage: %j', async usageMetadata => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        await expect(lastValueFrom(client.sendMessage(messages))).rejects.toThrow('Gemini response has missing or invalid token usage');
    });
});
