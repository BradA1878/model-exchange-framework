/** Exercise the actual streaming parser and recovery loop with controlled HTTP bodies. */
import { lastValueFrom } from 'rxjs';
import { OpenRouterMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenRouterMcpClient';
import type { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import type { McpRequestObservation } from '@mxf-dev/core/protocols/mcp/IMcpClient';
import { Logger } from '@mxf-dev/core/utils/Logger';

const context: AgentContext = {
    promptMode: 'bare', systemPrompt: 'Literal prompt.', agentConfig: { agentId: 'agent' } as AgentContext['agentConfig'],
    agentId: 'agent', channelId: 'channel', currentTask: null, recentActions: [], availableTools: [], timestamp: 1,
    conversationHistory: [{ id: 'message', role: 'user', content: 'Hello.', timestamp: 1 }]
};
const deltaFrame = (delta: object): string => `data:${JSON.stringify({ choices: [{ delta }] })}\n\n`;

interface StreamControl {
    response: Response;
    send: (frame: string) => void;
    cancelled: jest.Mock;
}

function stream(initial: string[] = [], heartbeat?: string, status = 200): StreamControl {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    const cancelled = jest.fn(() => { clearInterval(heartbeatTimer); });
    const send = (frame: string): void => controller.enqueue(new TextEncoder().encode(frame));
    const body = new ReadableStream<Uint8Array>({
        start(value): void {
            controller = value;
            initial.forEach(send);
            if (heartbeat !== undefined) heartbeatTimer = setInterval(() => send(heartbeat), 20);
        },
        cancel: cancelled
    });
    return { response: new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } }), send, cancelled };
}

describe('OpenRouter first-data watchdog', () => {
    const envKeys = [
        'MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS', 'OPENROUTER_FIRST_TOKEN_TIMEOUT_MS', 'OPENROUTER_STREAM_IDLE_TIMEOUT_MS',
        'OPENROUTER_REQUEST_TIMEOUT_MS', 'OPENROUTER_SLOW_REQUEST_WARN_MS', 'OPENROUTER_MAX_RETRIES',
        'OPENROUTER_BASE_DELAY_MS', 'OPENROUTER_ENABLE_DETAILED_LOGGING'
    ] as const;
    const originalFetch = global.fetch;
    let saved: Array<string | undefined>;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        saved = envKeys.map(key => process.env[key]);
        process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = 'true';
        process.env.OPENROUTER_FIRST_TOKEN_TIMEOUT_MS = '100';
        process.env.OPENROUTER_STREAM_IDLE_TIMEOUT_MS = '60';
        process.env.OPENROUTER_REQUEST_TIMEOUT_MS = '50';
        process.env.OPENROUTER_SLOW_REQUEST_WARN_MS = '10000';
        process.env.OPENROUTER_MAX_RETRIES = '5';
        process.env.OPENROUTER_BASE_DELAY_MS = '10';
        process.env.OPENROUTER_ENABLE_DETAILED_LOGGING = 'false';
        fetchMock = jest.fn();
        global.fetch = fetchMock as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
        envKeys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    const initialize = async (): Promise<OpenRouterMcpClient> => {
        const client = new OpenRouterMcpClient();
        await lastValueFrom(client.initialize({ apiKey: 'test-key', defaultModel: 'test-model' }));
        return client;
    };

    it('expires keepalive-only attempts, retries once, logs context and cancels both streams', async () => {
        const client = await initialize();
        const errorLog = jest.spyOn((client as unknown as { logger: Logger }).logger, 'error');
        const attempts: StreamControl[] = [];
        fetchMock.mockImplementation(async () => {
            const attempt = stream([], ': keepalive\n\n');
            attempts.push(attempt);
            return attempt.response;
        });
        const observations: McpRequestObservation[] = [];
        const operation = lastValueFrom(client.sendWithContext(context, {
            stream: true,
            requestTrace: { activationId: 'turn', captureBody: true, onRequest: (request: McpRequestObservation): void => { observations.push(request); } }
        }));
        const rejection = expect(operation).rejects.toMatchObject({ name: 'FirstTokenTimeoutError' });
        await jest.advanceTimersByTimeAsync(250);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(attempts.every(attempt => attempt.cancelled.mock.calls.length === 1)).toBe(true);
        expect(fetchMock.mock.calls.every(([, init]) => init.signal.aborted)).toBe(true);
        expect(errorLog.mock.calls.map(([message]) => message)).toEqual([
            expect.stringContaining('first-data timeout after 100ms (limit 100ms): model=test-model, agent=agent, request='),
            expect.stringContaining('first-data timeout after 100ms (limit 100ms): model=test-model, agent=agent, request=')
        ]);
        expect(observations.map(request => request.activationId)).toEqual(['turn', 'turn']);
        expect(observations[0].requestId).not.toBe(observations[1].requestId);
        observations.forEach((request, index) => expect(request.body).toEqual(JSON.parse(fetchMock.mock.calls[index][1].body)));
        expect(jest.getTimerCount()).toBe(0);
    });

    it('respects a lower configured one-attempt limit', async () => {
        process.env.OPENROUTER_MAX_RETRIES = '1';
        const client = await initialize();
        const attempt = stream([], ': heartbeat\n\n');
        fetchMock.mockResolvedValue(attempt.response);
        const rejection = expect(lastValueFrom(client.sendWithContext(context, { stream: true }))).rejects.toMatchObject({ name: 'FirstTokenTimeoutError' });
        await jest.advanceTimersByTimeAsync(100);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(attempt.cancelled).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each([
        deltaFrame({ role: 'assistant' }),
        'data:{"usage":{"prompt_tokens":1,"completion_tokens":0,"total_tokens":1},"choices":[]}\n\n',
        deltaFrame({ content: '', reasoning: '', reasoning_details: [], tool_calls: [{ index: 0, id: 'call', type: 'function' }] })
    ])('does not mistake a non-model frame for first data: %p', async frame => {
        process.env.OPENROUTER_MAX_RETRIES = '1';
        const client = await initialize();
        fetchMock.mockResolvedValue(stream([], frame).response);
        const rejection = expect(lastValueFrom(client.sendWithContext(context, { stream: true }))).rejects.toMatchObject({ name: 'FirstTokenTimeoutError' });
        await jest.advanceTimersByTimeAsync(100);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each([
        { content: 'word' }, { reasoning: 'thought' }, { reasoning_content: 'thought' },
        { reasoning_details: [{ type: 'reasoning.text', text: 'thought' }] },
        { reasoning_details: [{ type: 'reasoning.encrypted', data: 'encrypted provider data' }] },
        { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
        { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'lookup' } }] },
        { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { arguments: '{}' } }] }
    ])('allows long streams after real model data %p without a total cap', async delta => {
        const client = await initialize();
        const attempt = stream([deltaFrame(delta)], ': heartbeat\n\n');
        fetchMock.mockResolvedValue(attempt.response);
        const operation = lastValueFrom(client.sendWithContext(context, { stream: true }));
        // Exceed first-data, completion, and NetworkRecovery's extra 1s bound.
        await jest.advanceTimersByTimeAsync(2000);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
        const initialFunction = delta.tool_calls?.[0]?.function;
        if (initialFunction && !('arguments' in initialFunction)) attempt.send(deltaFrame({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }));
        if (initialFunction && !('name' in initialFunction)) attempt.send(deltaFrame({ tool_calls: [{ index: 0, function: { name: 'lookup' } }] }));
        attempt.send('data:[DONE]\n\n');
        const response = await operation;
        expect(response.request).toMatchObject({ provider: 'openrouter' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(attempt.cancelled).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not retry an idle failure after partial model output', async () => {
        const client = await initialize();
        const attempt = stream([deltaFrame({ content: 'partial' })]);
        fetchMock.mockResolvedValue(attempt.response);
        const rejection = expect(lastValueFrom(client.sendWithContext(context, { stream: true }))).rejects.toMatchObject({ name: 'TimeoutError', isRequestTimeout: true });
        await jest.advanceTimersByTimeAsync(60);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(attempt.cancelled).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('correlates a successful second attempt and terminates DONE without waiting for EOF', async () => {
        const client = await initialize();
        const first = stream([], ': heartbeat\n\n');
        const second = stream([deltaFrame({ content: 'answer' }), 'data:[DONE]\n\n']);
        fetchMock.mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
        const observations: McpRequestObservation[] = [];
        const operation = lastValueFrom(client.sendWithContext(context, {
            stream: true, requestTrace: { activationId: 'turn', onRequest: (request: McpRequestObservation): void => { observations.push(request); } }
        }));
        await jest.advanceTimersByTimeAsync(150);
        const response = await operation;
        expect(response.content).toEqual([{ type: 'text', text: 'answer' }]);
        expect(response.request).toMatchObject({ requestId: observations[1].requestId, activationId: 'turn' });
        expect(first.cancelled).toHaveBeenCalledTimes(1);
        expect(second.cancelled).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('bounds a stalled HTTP error body without retrying the known HTTP rejection', async () => {
        process.env.OPENROUTER_FIRST_TOKEN_TIMEOUT_MS = '20';
        const client = await initialize();
        const attempt = stream([], undefined, 400);
        fetchMock.mockResolvedValue(attempt.response);
        const rejection = expect(lastValueFrom(client.sendWithContext(context, { stream: true }))).rejects.toMatchObject({ name: 'TimeoutError' });
        await jest.advanceTimersByTimeAsync(60);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(attempt.cancelled).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each(['0', '-1', '1.5', '1ms', '', '2147483648', 'not-a-number'])('fails initialization on invalid first-data bound %s', async value => {
        process.env.OPENROUTER_FIRST_TOKEN_TIMEOUT_MS = value;
        await expect(initialize()).rejects.toThrow('OPENROUTER_FIRST_TOKEN_TIMEOUT_MS');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses a three-minute first-data default', async () => {
        delete process.env.OPENROUTER_FIRST_TOKEN_TIMEOUT_MS;
        process.env.OPENROUTER_MAX_RETRIES = '1';
        const client = await initialize();
        fetchMock.mockResolvedValue(stream([], ': heartbeat\n\n').response);
        const rejection = expect(lastValueFrom(client.sendWithContext(context, { stream: true }))).rejects.toThrow('limit 180000ms');
        await jest.advanceTimersByTimeAsync(180000);
        await rejection;
        expect(jest.getTimerCount()).toBe(0);
    });
});
