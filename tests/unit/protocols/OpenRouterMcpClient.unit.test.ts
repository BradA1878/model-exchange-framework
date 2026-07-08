/**
 * Unit tests for OpenRouterMcpClient reasoning parameter handling.
 *
 * Some OpenRouter models (GLM 5.x, Qwen, DeepSeek) reason by default when a request
 * omits the `reasoning` parameter (model listing reports `default_enabled: true`).
 * Omitting the parameter is therefore NOT the same as disabling reasoning: an agent
 * that declares `reasoning: { enabled: false }` must produce an explicit
 * `reasoning: { enabled: false }` request body — OpenRouter's documented off-switch —
 * or the model silently thinks anyway and burns the completion token budget.
 *
 * These tests pin the request-body contract for both request builders
 * (non-streaming and streaming):
 * - enabled: true  → reasoning config forwarded (effort or max_tokens)
 * - enabled: false → explicit { enabled: false } forwarded, other fields dropped
 * - absent         → no reasoning key (provider default preserved)
 */

import { lastValueFrom } from 'rxjs';
import { OpenRouterMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenRouterMcpClient';
import { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import { McpApiResponse } from '@mxf-dev/core/protocols/mcp/IMcpClient';

/** Minimal agent context accepted by structureMessagesFromContext */
function buildContext(): AgentContext {
    return {
        systemPrompt: 'You are a test agent.',
        agentConfig: { agentId: 'test-agent' } as any,
        currentTask: null,
        conversationHistory: [
            {
                id: 'msg-1',
                role: 'user',
                content: 'Hello',
                timestamp: Date.now(),
                metadata: { contextLayer: 'conversation' },
            } as any,
        ],
        recentActions: [],
        availableTools: [],
        agentId: 'test-agent',
        channelId: 'test-channel',
        timestamp: Date.now(),
    };
}

/** Successful non-streaming OpenRouter chat completion */
function nonStreamingFetchResponse(): any {
    const body = {
        id: 'gen-test-1',
        model: 'z-ai/glm-5.2',
        created: 1,
        object: 'chat.completion',
        choices: [
            {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
            },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
    };
}

/** Successful streaming (SSE) OpenRouter chat completion */
function streamingFetchResponse(): any {
    const encoder = new TextEncoder();
    const events = [
        `data: ${JSON.stringify({
            id: 'gen-test-2',
            model: 'z-ai/glm-5.2',
            choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
        })}\n\n`,
        `data: ${JSON.stringify({
            id: 'gen-test-2',
            model: 'z-ai/glm-5.2',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })}\n\n`,
        'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
        start(controller) {
            for (const event of events) {
                controller.enqueue(encoder.encode(event));
            }
            controller.close();
        },
    });
    return { ok: true, status: 200, body: stream };
}

describe('OpenRouterMcpClient reasoning parameter', () => {
    let client: OpenRouterMcpClient;
    let fetchMock: jest.Mock;
    const originalFetch = global.fetch;

    beforeEach(async () => {
        client = new OpenRouterMcpClient();
        await lastValueFrom(client.initialize({ apiKey: 'test-key', defaultModel: 'z-ai/glm-5.2' }));
        fetchMock = jest.fn();
        global.fetch = fetchMock as any;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    /** Extract the parsed JSON request body of the first fetch call */
    function sentRequestBody(): Record<string, any> {
        expect(fetchMock).toHaveBeenCalledTimes(1);
        return JSON.parse(fetchMock.mock.calls[0][1].body);
    }

    describe('non-streaming request builder', () => {
        async function send(options: Record<string, any>): Promise<McpApiResponse> {
            fetchMock.mockResolvedValue(nonStreamingFetchResponse());
            return lastValueFrom(client.sendWithContext!(buildContext(), options));
        }

        it('forwards effort when reasoning is enabled', async () => {
            await send({ reasoning: { enabled: true, effort: 'high' } });
            expect(sentRequestBody().reasoning).toEqual({ effort: 'high' });
        });

        it('forwards max_tokens when reasoning is enabled with a token budget', async () => {
            await send({ reasoning: { enabled: true, maxTokens: 2048 } });
            expect(sentRequestBody().reasoning).toEqual({ max_tokens: 2048 });
        });

        it('sends the explicit off-switch when reasoning is disabled', async () => {
            await send({ reasoning: { enabled: false } });
            expect(sentRequestBody().reasoning).toEqual({ enabled: false });
        });

        it('sends only the off-switch when disabled config carries other fields', async () => {
            await send({ reasoning: { enabled: false, effort: 'high', maxTokens: 2048 } });
            expect(sentRequestBody().reasoning).toEqual({ enabled: false });
        });

        it('omits the reasoning key when no reasoning config is given', async () => {
            await send({});
            expect(sentRequestBody()).not.toHaveProperty('reasoning');
        });
    });

    describe('streaming request builder', () => {
        async function send(options: Record<string, any>): Promise<McpApiResponse> {
            fetchMock.mockResolvedValue(streamingFetchResponse());
            return lastValueFrom(client.sendWithContext!(buildContext(), { ...options, stream: true }));
        }

        it('forwards effort when reasoning is enabled', async () => {
            await send({ reasoning: { enabled: true, effort: 'low' } });
            expect(sentRequestBody().reasoning).toEqual({ effort: 'low' });
        });

        it('sends the explicit off-switch when reasoning is disabled', async () => {
            await send({ reasoning: { enabled: false } });
            expect(sentRequestBody().reasoning).toEqual({ enabled: false });
        });

        it('omits the reasoning key when no reasoning config is given', async () => {
            await send({});
            expect(sentRequestBody()).not.toHaveProperty('reasoning');
        });
    });
});
