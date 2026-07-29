/**
 * Unit tests for OpenRouterMcpClient request timeouts, the streaming idle
 * watchdog, slow-request WARNs, and request-queue isolation.
 *
 * Background: sentinel agents stalled silently in production — the last tool
 * result arrived, then the next LLM turn never did. No error, no retry, no
 * timeout at this layer; a consumer-side 240s backstop killed the task. Cause:
 * neither fetch carried an AbortSignal, the SSE read loop could pend forever on
 * a dead connection, and the request queue was class-static, so the one hung
 * request also starved every other client instance in the process.
 *
 * The contract pinned here:
 * - a hung non-streaming request fails after OPENROUTER_REQUEST_TIMEOUT_MS with
 *   an error naming the model, agent, elapsed time, and request size — once,
 *   with no retry
 * - a streaming request whose SSE stream goes silent (or whose headers never
 *   arrive) fails after OPENROUTER_STREAM_IDLE_TIMEOUT_MS the same way
 * - a hung request delays only its own client's queue, and only until its
 *   timeout; other client instances are unaffected
 * - a request slower than OPENROUTER_SLOW_REQUEST_WARN_MS logs WARNs that make
 *   slow-vs-hung distinguishable
 * - garbage in the timeout env vars fails initialization instead of silently
 *   disabling the bound
 */

import { lastValueFrom } from 'rxjs';
import { OpenRouterMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenRouterMcpClient';
import { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import { Logger } from '@mxf-dev/core/utils/Logger';

const TIMEOUT_ENV_KEYS = [
    'OPENROUTER_REQUEST_TIMEOUT_MS',
    'OPENROUTER_STREAM_IDLE_TIMEOUT_MS',
    'OPENROUTER_SLOW_REQUEST_WARN_MS'
] as const;

/** Minimal agent context accepted by structureMessagesFromContext */
function buildContext(agentId: string = 'test-agent'): AgentContext {
    return {
        systemPrompt: 'You are a test agent.',
        agentConfig: { agentId } as any,
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
        agentId,
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

/**
 * A fetch that never responds but honors its AbortSignal, the way a real
 * runtime rejects an aborted request. This is the shape of the production hang:
 * connection accepted, response never sent.
 */
function hungFetchImplementation(): (url: any, init: any) => Promise<any> {
    return (_url: any, init: any) =>
        new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
                const error = new Error('The operation was aborted due to timeout');
                error.name = 'TimeoutError';
                reject(error);
            });
        });
}

/** Streaming response that sends one SSE chunk and then goes silent forever */
function stalledStreamFetchResponse(): any {
    const encoder = new TextEncoder();
    const firstEvent = `data: ${JSON.stringify({
        id: 'gen-stall-1',
        model: 'z-ai/glm-5.2',
        choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }],
    })}\n\n`;
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(firstEvent));
            // Never close, never enqueue again — a dead connection mid-stream
        },
    });
    return { ok: true, status: 200, body: stream };
}

describe('OpenRouterMcpClient request timeouts', () => {
    let fetchMock: jest.Mock;
    const originalFetch = global.fetch;
    const savedEnv: Partial<Record<(typeof TIMEOUT_ENV_KEYS)[number], string | undefined>> = {};

    async function makeClient(env: Partial<Record<(typeof TIMEOUT_ENV_KEYS)[number], string>>): Promise<OpenRouterMcpClient> {
        for (const [key, value] of Object.entries(env)) {
            process.env[key] = value;
        }
        const client = new OpenRouterMcpClient();
        await lastValueFrom(client.initialize({ apiKey: 'test-key', defaultModel: 'z-ai/glm-5.2' }));
        return client;
    }

    beforeEach(() => {
        for (const key of TIMEOUT_ENV_KEYS) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
        fetchMock = jest.fn();
        global.fetch = fetchMock as any;
    });

    afterEach(() => {
        for (const key of TIMEOUT_ENV_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    describe('non-streaming requests', () => {
        it('fails a hung request after the configured timeout with model/agent/size context', async () => {
            const client = await makeClient({ OPENROUTER_REQUEST_TIMEOUT_MS: '120' });
            fetchMock.mockImplementation(hungFetchImplementation());

            const startedAt = Date.now();
            await expect(
                lastValueFrom(client.sendWithContext!(buildContext(), {}))
            ).rejects.toThrow(/timed out.*model=z-ai\/glm-5\.2.*agent=test-agent.*request=\d+(\.\d+)?KB/);
            const elapsed = Date.now() - startedAt;

            // Bounded promptly — not the 240s consumer backstop, and no retries
            expect(elapsed).toBeLessThan(2000);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('passes an AbortSignal to fetch', async () => {
            const client = await makeClient({});
            fetchMock.mockResolvedValue(nonStreamingFetchResponse());

            await lastValueFrom(client.sendWithContext!(buildContext(), {}));

            const init = fetchMock.mock.calls[0][1];
            expect(init.signal).toBeInstanceOf(AbortSignal);
        });

        it('advances the request queue after a hung request times out', async () => {
            const client = await makeClient({ OPENROUTER_REQUEST_TIMEOUT_MS: '120' });
            fetchMock
                .mockImplementationOnce(hungFetchImplementation())
                .mockImplementation(async () => nonStreamingFetchResponse());

            // Queue two requests on the same client: the first hangs, the second
            // must still complete once the first times out. Before the timeout
            // existed the queue's await never returned and every later request
            // in the process waited forever. allSettled so a failed assertion
            // cannot orphan the other promise into a later test.
            const [first, second] = await Promise.allSettled([
                lastValueFrom(client.sendWithContext!(buildContext(), {})),
                lastValueFrom(client.sendWithContext!(buildContext(), {}))
            ]);

            expect(first.status).toBe('rejected');
            expect(String((first as PromiseRejectedResult).reason)).toMatch(/timed out/);
            expect(second.status).toBe('fulfilled');
            expect((second as PromiseFulfilledResult<any>).value.content[0])
                .toEqual(expect.objectContaining({ text: 'ok' }));
        });

        it('does not let one client\'s in-flight request block another client instance', async () => {
            const clientA = await makeClient({ OPENROUTER_REQUEST_TIMEOUT_MS: '3000' });
            const clientB = await makeClient({ OPENROUTER_REQUEST_TIMEOUT_MS: '3000' });

            // clientA's request stays in flight until released at the end of the
            // test; clientB's request must complete while A is still pending.
            // With the old class-static queue, B queued behind A and this test
            // hung until the jest timeout.
            let releaseA: (value: any) => void = () => undefined;
            fetchMock
                .mockImplementationOnce(() => new Promise(resolve => { releaseA = resolve; }))
                .mockImplementation(async () => nonStreamingFetchResponse());

            const pendingA = lastValueFrom(clientA.sendWithContext!(buildContext('agent-a'), {}));

            let aSettled = false;
            pendingA.then(() => { aSettled = true; }, () => { aSettled = true; });

            const responseB = await lastValueFrom(clientB.sendWithContext!(buildContext('agent-b'), {}));
            expect(responseB.content[0]).toEqual(expect.objectContaining({ text: 'ok' }));
            expect(aSettled).toBe(false);

            releaseA(nonStreamingFetchResponse());
            await pendingA;
        });
    });

    describe('streaming requests', () => {
        it('fails when the SSE stream goes silent past the idle timeout', async () => {
            const client = await makeClient({ OPENROUTER_STREAM_IDLE_TIMEOUT_MS: '100' });
            fetchMock.mockResolvedValue(stalledStreamFetchResponse());

            const startedAt = Date.now();
            let caught: any;
            try {
                await lastValueFrom(client.sendWithContext!(buildContext(), { stream: true }));
            } catch (error) {
                caught = error;
            }

            expect(caught).toBeDefined();
            expect(caught.message).toMatch(/no SSE data for 100ms/);
            expect(caught.message).toMatch(/model=z-ai\/glm-5\.2/);
            expect(caught.message).toMatch(/agent=test-agent/);
            expect(caught.isRequestTimeout).toBe(true);
            expect(Date.now() - startedAt).toBeLessThan(2000);
        });

        it('fails when response headers never arrive', async () => {
            const client = await makeClient({ OPENROUTER_STREAM_IDLE_TIMEOUT_MS: '100' });
            // Never resolves and ignores the abort signal entirely — the race
            // against the watchdog must still unblock the await.
            fetchMock.mockImplementation(() => new Promise(() => undefined));

            await expect(
                lastValueFrom(client.sendWithContext!(buildContext(), { stream: true }))
            ).rejects.toThrow(/no response headers within 100ms/);
        });
    });

    describe('slow-request WARN', () => {
        it('warns while a request is in flight past the threshold and again on completion', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
            const client = await makeClient({ OPENROUTER_SLOW_REQUEST_WARN_MS: '60' });
            fetchMock.mockImplementation(
                () => new Promise(resolve => setTimeout(() => resolve(nonStreamingFetchResponse()), 200))
            );

            await lastValueFrom(client.sendWithContext!(buildContext(), {}));

            const warnMessages = warnSpy.mock.calls.map(call => String(call[0]));
            expect(warnMessages.some(message =>
                /still in flight after 60ms/.test(message) &&
                /model=z-ai\/glm-5\.2/.test(message) &&
                /agent=test-agent/.test(message)
            )).toBe(true);
            expect(warnMessages.some(message => /completed after \d+ms/.test(message))).toBe(true);
        });

        it('stays silent for requests faster than the threshold', async () => {
            const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
            const client = await makeClient({ OPENROUTER_SLOW_REQUEST_WARN_MS: '5000' });
            fetchMock.mockResolvedValue(nonStreamingFetchResponse());

            await lastValueFrom(client.sendWithContext!(buildContext(), {}));

            const slowWarns = warnSpy.mock.calls
                .map(call => String(call[0]))
                .filter(message => /in flight|completed after/.test(message));
            expect(slowWarns).toEqual([]);
        });
    });

    describe('timeout env validation', () => {
        it('fails initialization on a non-numeric timeout instead of disabling the bound', async () => {
            process.env.OPENROUTER_REQUEST_TIMEOUT_MS = 'nope';
            const client = new OpenRouterMcpClient();
            await expect(
                lastValueFrom(client.initialize({ apiKey: 'test-key', defaultModel: 'z-ai/glm-5.2' }))
            ).rejects.toThrow(/OPENROUTER_REQUEST_TIMEOUT_MS must be a positive integer/);
        });
    });
});
