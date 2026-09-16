/**
 * agent.disconnect() against a turn that is still finishing.
 *
 * A consumer that disconnects an ephemeral agent as soon as it sees
 * task:completed races the task's final turn: addConversationMessage()
 * awaits the persist of the task_complete tool result, and disconnect()
 * closed the socket under that save. The turn then failed with
 * "Cannot start memory operation … not connected" (or "cancelled: channel
 * service disconnected explicitly"), the execution loop treated that as a
 * task failure, and TaskHandlers tried to report the already-completed task
 * as failed into the closed socket — six error lines per agent per task.
 *
 * Nothing exercised MxfAgent itself before; the base-client mocks are the
 * ones MxfClientPublicApi.unit.test.ts uses, plus fakes for the managers
 * MxfAgent adds.
 */
import { Subscription } from 'rxjs';

const mockLoggerError = jest.fn();
const calls: string[] = [];

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = jest.fn(); warn = jest.fn(); error = mockLoggerError; debug = jest.fn();
    }
}));

jest.mock('@mxf-dev/core/events/EventBus', () => {
    const handlers: Map<string, ((payload: unknown) => void)[]> = new Map();
    const client = {
        on: jest.fn((event: string, handler: (payload: unknown) => void) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
            return {
                unsubscribe: jest.fn(() => {
                    const list = handlers.get(event);
                    if (list) {
                        const index = list.indexOf(handler);
                        if (index > -1) list.splice(index, 1);
                    }
                })
            } as unknown as Subscription;
        }),
        off: jest.fn(),
        emit: jest.fn(),
        emitOn: jest.fn(),
        emitLocal: jest.fn(),
        registerSocket: jest.fn(),
        unregisterSocket: jest.fn(),
        setClientSocket: jest.fn(),
        isRegisteredSocketConnected: jest.fn(() => true),
        _dispatch: (event: string, payload: unknown): void => {
            for (const handler of [...(handlers.get(event) ?? [])]) handler(payload);
        },
        _reset: (): void => handlers.clear()
    };
    return { EventBus: { client } };
});

jest.mock('@mxf-dev/sdk/services/MxfService', () => ({
    MxfService: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        disconnect: jest.fn(async () => { calls.push('service.disconnect'); }),
        setAgentId: jest.fn(),
        isConnected: jest.fn(() => true),
        socketEmit: jest.fn(),
        getChannelConfig: jest.fn(() => ({})),
        getActiveAgents: jest.fn(() => []),
        onTaskCompleted: jest.fn(),
        onTaskFailed: jest.fn(),
        onTaskCancelled: jest.fn(),
        onTaskAssigned: jest.fn(),
        onTaskStarted: jest.fn(),
        onTaskProgressUpdated: jest.fn(),
        clearTaskEventCallbacks: jest.fn()
    }))
}));

jest.mock('@mxf-dev/sdk/handlers/MessageHandlers', () => ({
    MessageHandlers: jest.fn().mockImplementation(() => ({
        subscribeToChannel: jest.fn().mockResolvedValue(true),
        unsubscribeFromChannel: jest.fn().mockResolvedValue(true),
        sendChannelMessage: jest.fn().mockResolvedValue(true),
        sendDirectMessage: jest.fn(),
        updateMxpConfig: jest.fn(),
        cleanup: jest.fn()
    }))
}));

const cachedTools = [
    { name: 'task_complete', description: 'Finish the task', inputSchema: { type: 'object', properties: {} }, enabled: true, providerId: 'internal', channelId: 'test-channel' },
    { name: 'fetch_feed', description: 'Fetch a feed', inputSchema: { type: 'object', properties: {} }, enabled: true, providerId: 'internal', channelId: 'test-channel' }
];
jest.mock('@mxf-dev/sdk/services/MxfToolService', () => ({
    MxfToolService: jest.fn().mockImplementation(() => ({
        loadTools: jest.fn().mockResolvedValue(cachedTools),
        reloadTools: jest.fn().mockResolvedValue(cachedTools),
        getCachedTools: jest.fn(() => cachedTools),
        isLoaded: jest.fn(() => true),
        cleanup: jest.fn()
    }))
}));

const mockSendWithContextStreaming = jest.fn();
jest.mock('@mxf-dev/sdk/managers/MxfMcpClientManager', () => ({
    MxfMcpClientManager: jest.fn().mockImplementation(() => ({
        initializeMcpClient: jest.fn().mockResolvedValue(undefined),
        sendWithContextStreaming: mockSendWithContextStreaming,
        registerTool: jest.fn(),
        unregisterTool: jest.fn(),
        cleanup: jest.fn().mockResolvedValue(undefined)
    }))
}));

const mockAddConversationMessage = jest.fn();
const mockFlushPersistence = jest.fn(async () => { calls.push('flushPersistence'); });
jest.mock('@mxf-dev/sdk/managers/MxfMemoryManager', () => ({
    MxfMemoryManager: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        addConversationMessage: mockAddConversationMessage,
        updateConversationMessage: jest.fn().mockResolvedValue(undefined),
        getConversationHistory: jest.fn(() => []),
        flushPersistence: mockFlushPersistence,
        stopPersistence: jest.fn(() => { calls.push('stopPersistence'); }),
        flushIndexQueue: jest.fn(async () => { calls.push('flushIndexQueue'); }),
        stopIndexing: jest.fn(() => { calls.push('stopIndexing'); }),
        pendingIndexCount: jest.fn(() => 0)
    }))
}));

jest.mock('@mxf-dev/sdk/managers/MxfSystemPromptManager', () => ({
    MxfSystemPromptManager: jest.fn().mockImplementation(() => ({
        generateMinimalPrompt: jest.fn(() => 'system prompt'),
        updatePromptForTask: jest.fn().mockResolvedValue(undefined),
        loadCompleteSystemPrompt: jest.fn().mockResolvedValue(undefined),
        setAgentConfigPrompt: jest.fn().mockResolvedValue(undefined)
    }))
}));

jest.mock('@mxf-dev/sdk/services/MxfContextBuilder', () => ({
    MxfContextBuilder: jest.fn().mockImplementation(() => ({
        buildContext: jest.fn(async () => ({ systemPrompt: 'system prompt', messages: [], tools: [] })),
        actionHistoryService: undefined
    }))
}));

jest.mock('@mxf-dev/sdk/services/MxfEventHandlerService', () => ({
    MxfEventHandlerService: jest.fn().mockImplementation(() => ({
        initializeEventHandlers: jest.fn(),
        cleanup: jest.fn()
    }))
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import type { AgentConfig } from '@mxf-dev/core/interfaces/AgentInterfaces';
import { MxfAgent } from '@mxf-dev/sdk/MxfAgent';
import { MxfAgentSystemPrompt } from '@mxf-dev/core/prompts/MxfAgentSystemPrompt';
import { MxfTaskExecutionManager } from '@mxf-dev/sdk/managers/MxfTaskExecutionManager';
import type { MessageActivationQueue } from '@mxf-dev/sdk/services/MessageActivationQueue';
import type { ConversationMessage } from '@mxf-dev/core/interfaces/ConversationMessage';
import type { ConversationMessageInput } from '@mxf-dev/sdk/managers/MxfMemoryManager';
import type { AgentContext } from '@mxf-dev/core/interfaces/AgentContext';
import type { McpApiResponse, McpRequestOptions } from '@mxf-dev/core/protocols/mcp/IMcpClient';
import { observeMcpRequest } from '@mxf-dev/core/protocols/mcp/RequestObservation';
import { OpenRouterMcpClient } from '@mxf-dev/core/protocols/mcp/providers/OpenRouterMcpClient';
import { createAgentEventPayload, createMcpToolErrorPayload, type LlmRequestEventData, type BaseEventPayload, type McpToolCallEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';

const CONFIG: AgentConfig = {
    agentId: 'test-agent',
    name: 'Test Agent',
    channelId: 'test-channel',
    keyId: 'key-1',
    secretKey: 'secret-1',
    host: 'localhost',
    port: 3001,
    secure: false,
    apiUrl: 'http://localhost:3001/api',
    apiKey: '',
    agentConfigPrompt: '',
    llmProvider: 'openrouter',
    model: 'test-model'
} as AgentConfig;

const textResponse = {
    content: [{ type: 'text', text: 'Working on it.' }],
    model: 'test-model'
};

describe('MxfAgent message turns and bare tool feedback', () => {
    const prompt = ' Observe.\n{{agentId}} stays literal.\n';
    const created: MxfAgent[] = [];
    function makeAgent(extra: Partial<AgentConfig> = {}): {
        agent: MxfAgent; queue: MessageActivationQueue; history: ConversationMessage[]
    } {
        const agent = new MxfAgent({
            ...CONFIG, promptMode: 'bare', activation: 'message', agentConfigPrompt: prompt,
            disableTaskHandling: true, allowedTools: ['fetch_feed'], maxIterations: 3, ...extra
        });
        created.push(agent);
        const internal = agent as unknown as {
            messageActivations: MessageActivationQueue;
            memoryManager: { getConversationHistory: jest.Mock };
            systemPromptManager: { generateMinimalPrompt: jest.Mock };
            contextBuilder: unknown;
        };
        const history: ConversationMessage[] = [{ id: 'system', role: 'system', content: prompt, timestamp: 1 }];
        internal.memoryManager.getConversationHistory.mockImplementation(() => history);
        mockAddConversationMessage.mockImplementation(async (input: ConversationMessageInput) => {
            history.push({ id: `message-${history.length}`, timestamp: Date.now(), ...input });
        });
        internal.systemPromptManager.generateMinimalPrompt.mockReturnValue(prompt);
        // Exercise the real bare context builder; the transport alone is controlled.
        const { MxfContextBuilder } = jest.requireActual<typeof import('@mxf-dev/sdk/services/MxfContextBuilder')>(
            '@mxf-dev/sdk/services/MxfContextBuilder'
        );
        internal.contextBuilder = new MxfContextBuilder(CONFIG.agentId);
        return { agent, queue: internal.messageActivations, history };
    }
    const receive = (queue: MessageActivationQueue, id = 'incoming'): Promise<void> => queue.accept(
        { trigger: 'channel_message', messageId: id },
        { role: 'user', content: 'Hello.', metadata: { originalMessageId: id, fromAgentId: 'peer', contextLayer: 'conversation' } }
    );
    const events = (event: string): unknown[][] => (EventBus.client.emitOn as jest.Mock).mock.calls.filter(call => call[1] === event);

    beforeEach(() => {
        jest.clearAllMocks();
        mockSendWithContextStreaming.mockReset().mockResolvedValue(textResponse);
        mockAddConversationMessage.mockReset().mockResolvedValue(undefined);
        (EventBus.client as unknown as { _reset: () => void })._reset();
    });
    afterEach(async () => {
        await Promise.all(created.splice(0).map(agent => agent.disconnect()));
    });

    it('takes one task-free turn with only the operator prompt and received dialogue', async () => {
        const { queue, history } = makeAgent();
        await receive(queue);
        await queue.waitForIdle();
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
        const context = mockSendWithContextStreaming.mock.calls[0][0] as AgentContext;
        expect(context.systemPrompt).toBe(prompt);
        expect(context.promptMode).toBe('bare');
        expect(context.currentTask).toBeNull();
        expect(context.recentActions).toEqual([]);
        expect(history.map(value => [value.role, value.content])).toEqual([
            ['system', prompt], ['user', 'Hello.'], ['assistant', 'Working on it.']
        ]);
        expect(events(Events.Agent.ITERATION_LIMIT)).toHaveLength(0);
        expect(events(Events.Agent.ERROR)).toHaveLength(0);
    });

    it('passes empty parameters and empty results unchanged, then emits only an iteration limit', async () => {
        const { agent, queue, history } = makeAgent({ maxIterations: 5, circuitBreakerEnabled: false });
        const execute = jest.spyOn(agent, 'executeTool').mockResolvedValue({ content: [{ type: 'text', text: '' }] });
        mockSendWithContextStreaming.mockResolvedValue({
            model: 'test-model', content: [{ type: 'tool_use', id: 'tool-call', name: 'fetch_feed', input: {} }]
        });
        await receive(queue);
        await queue.waitForIdle();
        expect(execute).toHaveBeenCalledTimes(5);
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(5);
        expect(history.filter(value => value.role === 'tool').map(value => value.content)).toEqual(['', '', '', '', '']);
        expect(history.filter(value => value.role === 'user')).toHaveLength(1);
        expect(events(Events.Agent.ITERATION_LIMIT)).toHaveLength(1);
        const limit = events(Events.Agent.ITERATION_LIMIT)[0][2] as { activationId: string; data: unknown };
        expect(limit.data).toEqual({ activationId: limit.activationId, maxIterations: 5, trigger: 'channel_message', messageId: 'incoming' });
        for (const call of execute.mock.calls) expect(call[3]?.activationId).toBe(limit.activationId);
        expect(events(Events.Agent.ERROR)).toHaveLength(0);
    });

    it('retains default circuit blocking without adding bare-mode instructions', async () => {
        const { agent, queue, history } = makeAgent();
        const execute = jest.spyOn(agent, 'executeTool').mockResolvedValue({ result: 'data' });
        mockSendWithContextStreaming.mockResolvedValue({
            model: 'test-model', content: [{ type: 'tool_use', id: 'tool-call', name: 'fetch_feed', input: { query: 'same' } }]
        });
        await receive(queue);
        await queue.waitForIdle();
        expect(execute).toHaveBeenCalledTimes(2);
        expect(history.filter(value => value.role === 'user')).toHaveLength(1);
        expect(history.at(-1)?.content).toContain('blocked by circuit breaker');
    });

    it('stores the original failed-tool error without a corrective user turn', async () => {
        const { agent, queue, history } = makeAgent();
        jest.spyOn(agent, 'executeTool').mockRejectedValue(new Error('Recipient does not exist'));
        mockSendWithContextStreaming.mockResolvedValueOnce({
            model: 'test-model', content: [{ type: 'tool_use', id: 'tool-call', name: 'messaging_send', input: {} }]
        }).mockResolvedValue(textResponse);
        await receive(queue);
        await queue.waitForIdle();
        expect(history.filter(value => value.role === 'tool').map(value => value.content)).toEqual(['Recipient does not exist']);
        expect(history.filter(value => value.role === 'user')).toHaveLength(1);
    });

    it('forwards provider options and correlates request capture, reasoning, response, and reported usage', async () => {
        const providerOptions = { provider: { order: ['route'], allow_fallbacks: false } };
        const { queue } = makeAgent({ captureLlmRequests: true, providerOptions, reasoning: { enabled: true } });
        mockSendWithContextStreaming.mockImplementation(async (context: AgentContext, options: McpRequestOptions) => {
            expect(options.providerOptions).toBe(providerOptions);
            const attempt = observeMcpRequest('openrouter', 'test-model', JSON.stringify({ model: 'test-model' }), options.requestTrace);
            return {
                ...textResponse, reasoning: 'Thinking', usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
                request: attempt.complete({ costUsd: 0.25, providerRoute: 'route', finishReason: 'stop', nativeFinishReason: 'end_turn' })
            };
        });
        await receive(queue);
        await queue.waitForIdle();
        const captured = events(Events.Agent.LLM_REQUEST)[0][2] as { activationId: string; requestId: string };
        for (const event of [Events.Agent.LLM_RESPONSE, Events.Agent.LLM_REASONING, Events.Agent.LLM_USAGE]) {
            expect(events(event)).toHaveLength(1);
            expect(events(event)[0][2]).toMatchObject({ activationId: captured.activationId, requestId: captured.requestId });
        }
        expect(events(Events.Agent.LLM_USAGE)[0][2]).toMatchObject({ data: { costUsd: 0.25, providerRoute: 'route', totalTokens: 5 } });
    });

    it('sends a bare message and failed tool round through the real OpenRouter streaming wire', async () => {
        const originalFetch = global.fetch;
        const originalOptIn = process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS;
        const providerOptions = { provider: { order: ['provider-a', 'provider-b'], allow_fallbacks: false, require_parameters: true } };
        const registryTool = {
            name: 'messaging_send', description: 'Send the supplied content to one channel participant.\nKeep this registry description unchanged.',
            inputSchema: {
                type: 'object', additionalProperties: false,
                properties: {
                    agentId: { type: 'string', minLength: 1 },
                    content: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] }
                },
                required: ['agentId', 'content']
            }, enabled: true, providerId: 'internal', channelId: CONFIG.channelId
        };
        const wireRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
        const toolError = 'Recipient agent-03 is not a current participant';
        const nativeCall = {
            id: 'native-message-call', type: 'function',
            function: { name: 'messaging_send', arguments: JSON.stringify({ agentId: 'agent-03', content: 'Hello.' }) }
        };
        const streamFrames = [
            {
                id: 'provider-response-one', model: 'vendor/model', provider: 'provider-a',
                choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...nativeCall }] }, finish_reason: 'tool_calls', native_finish_reason: 'tool_use' }],
                usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cost: 0.012 }
            },
            {
                id: 'provider-response-two', model: 'vendor/model', provider: 'provider-b',
                choices: [{ index: 0, delta: { content: 'The recipient is unavailable.' }, finish_reason: 'stop', native_finish_reason: 'end_turn' }],
                usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29, cost: 0.015 }
            }
        ];
        // Every fetch is handled locally, including any initialization probe.
        // An unexpected endpoint or third completion fails instead of networking.
        const fakeFetch = jest.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.endsWith('/models')) {
                return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            if (url !== 'https://openrouter.ai/api/v1/chat/completions' || typeof init?.body !== 'string') {
                throw new Error(`Unexpected provider transport request: ${url}`);
            }
            const frame = streamFrames[wireRequests.length];
            if (!frame) throw new Error('Unexpected third provider completion');
            wireRequests.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
            return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
                status: 200, headers: { 'content-type': 'text/event-stream' }
            });
        }) as typeof fetch;
        const agentConfig = {
            apiKey: 'test-provider-key', defaultModel: 'vendor/model', temperature: 0,
            maxTokens: 321, captureLlmRequests: true, allowedTools: ['messaging_send'], providerOptions
        };
        const { agent, queue, history } = makeAgent(agentConfig);
        const { MxfMcpClientManager: RealMcpClientManager } = jest.requireActual<typeof import('@mxf-dev/sdk/managers/MxfMcpClientManager')>(
            '@mxf-dev/sdk/managers/MxfMcpClientManager'
        );
        const manager = new RealMcpClientManager(CONFIG.agentId, { ...CONFIG, ...agentConfig });
        const internal = agent as unknown as {
            mcpClientManager: typeof manager;
            toolService: { getCachedTools: jest.Mock; loadTools: jest.Mock };
            mxfService: { socketEmit: jest.Mock };
            isFullyConnected: boolean;
        };
        internal.mcpClientManager = manager;
        // The fixture represents an already connected agent; only its tool
        // request/reply transport is replaced below, not the SDK tool handler.
        internal.isFullyConnected = true;
        internal.toolService.getCachedTools.mockReturnValue([registryTool]);
        internal.toolService.loadTools.mockResolvedValue([registryTool]);
        const toolReplies: BaseEventPayload[] = [];
        internal.mxfService.socketEmit.mockImplementation((event: string, payload: McpToolCallEventPayload): void => {
            expect(event).toBe(Events.Mcp.TOOL_CALL);
            const error = createMcpToolErrorPayload(
                Events.Mcp.TOOL_ERROR, CONFIG.agentId, CONFIG.channelId,
                { toolName: payload.data.toolName, callId: payload.data.callId, error: toolError },
                { requestId: payload.requestId, activationId: payload.activationId }
            );
            toolReplies.push(error);
            (EventBus.client as unknown as { _dispatch: (event: string, payload: unknown) => void })._dispatch(Events.Mcp.TOOL_ERROR, error);
        });
        global.fetch = fakeFetch;
        process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = 'true';
        try {
            await manager.initializeMcpClient();
            expect(Reflect.get(manager, 'mcpClient')).toBeInstanceOf(OpenRouterMcpClient);
            await queue.accept({ trigger: 'channel_message', messageId: 'wire-incoming' }, {
                role: 'user', content: 'Hello.', metadata: { fromAgentId: 'agent-02', originalMessageId: 'wire-incoming' }
            });
            await queue.waitForIdle();

            expect(mockSendWithContextStreaming).not.toHaveBeenCalled();
            expect(wireRequests).toHaveLength(2);
            const expectedTools = [{ type: 'function', function: {
                name: registryTool.name, description: registryTool.description, parameters: registryTool.inputSchema
            } }];
            const firstMessages = [{ role: 'system', content: prompt }, { role: 'user', content: '[agent-02]: Hello.' }];
            expect(wireRequests[0].body.messages).toEqual(firstMessages);
            expect(wireRequests[1].body.messages).toEqual([
                ...firstMessages,
                { role: 'assistant', content: '', tool_calls: [nativeCall] },
                { role: 'tool', content: toolError, tool_call_id: nativeCall.id }
            ]);
            for (const { body } of wireRequests) {
                expect(body).toMatchObject({
                    model: 'vendor/model', temperature: 0, max_tokens: 321, stream: true,
                    provider: providerOptions.provider, tool_choice: 'auto', usage: { include: true }
                });
                expect(body.tools).toEqual(expectedTools);
            }
            expect(history.filter(message => message.role === 'user')).toHaveLength(1);
            expect(history.at(-1)).toMatchObject({ role: 'assistant', content: 'The recipient is unavailable.' });
            expect(events(Events.Agent.ERROR)).toHaveLength(0);
            expect(events(Events.Agent.ITERATION_LIMIT)).toHaveLength(0);

            const captures = events(Events.Agent.LLM_REQUEST).map(call => call[2] as BaseEventPayload<LlmRequestEventData>);
            expect(captures).toHaveLength(2);
            expect(captures.map(capture => capture.data.body)).toEqual(wireRequests.map(request => request.body));
            expect(captures[0].activationId).toEqual(expect.any(String));
            expect(captures[1].activationId).toBe(captures[0].activationId);
            expect(captures[0].requestId).toEqual(expect.any(String));
            expect(captures[1].requestId).not.toBe(captures[0].requestId);
            for (const capture of captures) {
                expect(capture.data).toMatchObject({
                    requestId: capture.requestId, activationId: capture.activationId, provider: 'openrouter', model: 'vendor/model'
                });
            }
            const usage = events(Events.Agent.LLM_USAGE).map(call => call[2]);
            expect(usage).toHaveLength(2);
            expect(usage[0]).toMatchObject({
                requestId: captures[0].requestId, activationId: captures[0].activationId,
                data: { inputTokens: 11, outputTokens: 7, totalTokens: 18, costUsd: 0.012, providerRoute: 'provider-a', finishReason: 'tool_calls', nativeFinishReason: 'tool_use' }
            });
            expect(usage[1]).toMatchObject({
                requestId: captures[1].requestId, activationId: captures[1].activationId,
                data: { inputTokens: 20, outputTokens: 9, totalTokens: 29, costUsd: 0.015, providerRoute: 'provider-b', finishReason: 'stop', nativeFinishReason: 'end_turn' }
            });
            expect(internal.mxfService.socketEmit).toHaveBeenCalledTimes(1);
            const toolCall = internal.mxfService.socketEmit.mock.calls[0][1] as McpToolCallEventPayload;
            expect(toolCall).toMatchObject({
                requestId: captures[0].requestId, activationId: captures[0].activationId,
                data: { toolName: 'messaging_send', arguments: { agentId: 'agent-03', content: 'Hello.' } }
            });
            expect(toolReplies).toHaveLength(1);
            expect(toolReplies[0]).toMatchObject({
                requestId: toolCall.requestId, activationId: toolCall.activationId,
                data: { callId: toolCall.data.callId, error: toolError }
            });
        } finally {
            try {
                await agent.disconnect();
            } finally {
                global.fetch = originalFetch;
                if (originalOptIn === undefined) delete process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS;
                else process.env.MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS = originalOptIn;
            }
        }
    });

    it('reports usage from a response arriving after disconnect without adding stale content', async () => {
        const { agent, queue, history } = makeAgent();
        let finish!: (value: Partial<McpApiResponse>) => void;
        let signalStarted!: () => void;
        const started = new Promise<void>(resolve => { signalStarted = resolve; });
        mockSendWithContextStreaming.mockImplementation(() => {
            signalStarted();
            return new Promise(resolve => { finish = resolve; });
        });
        await receive(queue);
        await started;
        await agent.disconnect();
        finish({ ...textResponse, usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } as Partial<McpApiResponse>);
        await queue.waitForIdle();
        expect(events(Events.Agent.LLM_USAGE)).toHaveLength(1);
        expect(events(Events.Agent.LLM_RESPONSE)).toHaveLength(0);
        expect(history.filter(value => value.role === 'assistant')).toHaveLength(0);
        expect(events(Events.Agent.LLM_USAGE)[0][2]).not.toHaveProperty('data.costUsd');
    });

    it('keeps the first reconnected message reserved until the old provider call drains', async () => {
        const { agent, queue } = makeAgent();
        let finish!: (value: typeof textResponse) => void;
        let signalStarted!: () => void;
        const started = new Promise<void>(resolve => { signalStarted = resolve; });
        mockSendWithContextStreaming.mockImplementationOnce(() => {
            signalStarted();
            return new Promise(resolve => { finish = resolve; });
        }).mockResolvedValue(textResponse);
        await receive(queue, 'old');
        await started;
        await agent.disconnect();
        await (agent as unknown as { performAgentInitialization: () => Promise<void> }).performAgentInitialization();
        await receive(queue, 'new');
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
        finish(textResponse);
        await queue.waitForIdle();
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(2);
    });

    it('preserves a running tool and coalesced messages across a transport reconnect', async () => {
        const { agent, queue, history } = makeAgent();
        const internal = agent as unknown as {
            connectSocketAndRegister(): Promise<void>;
            memoryManager: { initialize: jest.Mock };
            mcpClientManager: { initializeMcpClient: jest.Mock };
            eventHandlerService: { initializeEventHandlers: jest.Mock };
            systemPromptManager: { loadCompleteSystemPrompt: jest.Mock };
            toolService: { loadTools: jest.Mock; reloadTools: jest.Mock };
        };
        // Keep the real public connect -> ensureConnected -> full initialization
        // path, replacing only the socket registration handshake.
        const register = jest.spyOn(internal, 'connectSocketAndRegister').mockResolvedValue(undefined);
        const result = { content: [{ type: 'text' as const, text: 'Actual tool result' }] };
        let finishTool!: (value: typeof result) => void;
        let signalToolStarted!: () => void;
        const toolStarted = new Promise<void>(resolve => { signalToolStarted = resolve; });
        const toolResult = new Promise<typeof result>(resolve => { finishTool = resolve; });
        const execute = jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            signalToolStarted();
            return toolResult;
        });
        mockSendWithContextStreaming.mockResolvedValueOnce({
            model: 'test-model', content: [{ type: 'tool_use', id: 'running-call', name: 'fetch_feed', input: {} }]
        }).mockResolvedValueOnce({
            model: 'test-model', content: [{ type: 'text', text: 'First activation finished.' }]
        }).mockResolvedValueOnce({
            model: 'test-model', content: [{ type: 'text', text: 'Pending messages processed.' }]
        });
        try {
            await agent.connect();
            const subscriptionCount = (EventBus.client.on as jest.Mock).mock.calls.length;
            await receive(queue, 'running');
            await toolStarted;
            await receive(queue, 'pending-one');
            await receive(queue, 'pending-two');
            expect(history.filter(message => message.role === 'tool')).toHaveLength(0);
            const toolLoadsBeforeReconnect = internal.toolService.loadTools.mock.calls.length;

            const disconnected = createAgentEventPayload(
                Events.Agent.DISCONNECT, CONFIG.agentId, CONFIG.channelId, { reason: 'transport disconnected' }
            );
            (EventBus.client as unknown as { _dispatch: (event: string, payload: unknown) => void })
                ._dispatch(Events.Agent.DISCONNECT, disconnected);
            await agent.connect();

            expect(register).toHaveBeenCalledTimes(2);
            expect(internal.toolService.loadTools).toHaveBeenCalledTimes(toolLoadsBeforeReconnect + 1);
            expect(internal.toolService.reloadTools).toHaveBeenCalledTimes(1);
            expect(internal.memoryManager.initialize).toHaveBeenCalledTimes(1);
            expect(internal.mcpClientManager.initializeMcpClient).toHaveBeenCalledTimes(1);
            expect(internal.eventHandlerService.initializeEventHandlers).toHaveBeenCalledTimes(1);
            expect(internal.systemPromptManager.loadCompleteSystemPrompt).toHaveBeenCalledTimes(1);
            expect(EventBus.client.on).toHaveBeenCalledTimes(subscriptionCount);
            expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
            expect(history.filter(message => message.role === 'tool')).toHaveLength(0);

            finishTool(result);
            await queue.waitForIdle();
            expect(execute).toHaveBeenCalledTimes(1);
            expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(3);
            expect(history.filter(message => message.role === 'tool')).toEqual([
                expect.objectContaining({ content: 'Actual tool result', metadata: expect.objectContaining({ tool_call_id: 'running-call' }) })
            ]);
            expect(history.some(message => message.metadata?.interrupted)).toBe(false);
            expect(history.filter(message => message.role === 'user').map(message => message.metadata?.originalMessageId))
                .toEqual(['running', 'pending-one', 'pending-two']);
            expect(history.filter(message => message.role === 'assistant' && message.content).map(message => message.content))
                .toEqual(['First activation finished.', 'Pending messages processed.']);
            expect(events(Events.Agent.ERROR)).toHaveLength(0);

            // Explicit disconnect ends the session and must initialize it again.
            await agent.disconnect();
            await agent.connect();
            expect(register).toHaveBeenCalledTimes(3);
            expect(internal.memoryManager.initialize).toHaveBeenCalledTimes(2);
            expect(internal.mcpClientManager.initializeMcpClient).toHaveBeenCalledTimes(2);
            expect(internal.eventHandlerService.initializeEventHandlers).toHaveBeenCalledTimes(2);
            expect(internal.systemPromptManager.loadCompleteSystemPrompt).toHaveBeenCalledTimes(2);
        } finally {
            finishTool(result);
            await queue.waitForIdle();
            await agent.disconnect();
        }
    });

    it('records interrupted tool pairing truthfully before a new session takes a turn', async () => {
        const { agent, queue, history } = makeAgent();
        history.push({
            id: 'old-call', role: 'assistant', content: '', timestamp: 1,
            tool_calls: [{ id: 'unfinished', type: 'function', function: { name: 'fetch_feed', arguments: '{}' } }]
        });
        await (agent as unknown as { performAgentInitialization: () => Promise<void> }).performAgentInitialization();
        await receive(queue);
        await queue.waitForIdle();
        const result = history.find(value => value.metadata?.tool_call_id === 'unfinished');
        expect(result).toMatchObject({ role: 'tool', metadata: { interrupted: true, error: true } });
        expect(result?.content).toBe('No result was recorded for fetch_feed before this session started.');
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
    });
});

describe('MxfAgent.disconnect() against a finishing turn', () => {
    beforeEach(() => {
        calls.length = 0;
        jest.clearAllMocks();
        (EventBus.client as unknown as { _reset: () => void })._reset();
        (EventBus.client.isRegisteredSocketConnected as jest.Mock).mockReturnValue(true);
        mockAddConversationMessage.mockResolvedValue(undefined);
    });

    it('persists queued memory before closing the socket', async () => {
        const agent = new MxfAgent({ ...CONFIG });

        await agent.disconnect();

        expect(calls).toEqual(['flushPersistence', 'stopPersistence', 'flushIndexQueue', 'stopIndexing', 'service.disconnect']);
    });

    it('still closes the socket when the memory flush fails, logging that failure once', async () => {
        // A save the server never answers now ends with a time-out error from
        // flushPersistence(); disconnect() reports it and goes on to stop
        // persistence, drain the index queue, and close the socket.
        const agent = new MxfAgent({ ...CONFIG });
        mockFlushPersistence.mockRejectedValueOnce(
            new Error("Memory operation op-1 timed out after 60000ms waiting for the server's answer")
        );

        await expect(agent.disconnect()).resolves.toBeUndefined();

        expect(calls).toEqual(['stopPersistence', 'flushIndexQueue', 'stopIndexing', 'service.disconnect']);
        expect(mockLoggerError).toHaveBeenCalledTimes(1);
        expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining(
            "Could not persist queued memory before disconnect: Memory operation op-1 timed out after 60000ms"
        ));
    });

    it('ends a turn that finishes after disconnect() began, without reporting a task failure', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        mockSendWithContextStreaming.mockResolvedValue(textResponse);
        // The consumer disconnected while the model was answering: the turn's next save cannot start.
        await agent.disconnect();
        mockAddConversationMessage.mockImplementation(async () => {
            (EventBus.client.isRegisteredSocketConnected as jest.Mock).mockReturnValue(false);
            throw new Error("Cannot start memory operation op-1: agent socket 'test-agent' is not connected");
        });
        const taskExecutionManager = (agent as unknown as {
            taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown> };
        }).taskExecutionManager;

        await expect(taskExecutionManager.executeTask({
            taskId: 'task-1',
            fromAgentId: 'requester',
            toAgentId: 'test-agent',
            title: 'Classify',
            description: 'Classify the feed',
            content: 'Classify the feed'
        })).resolves.toBeDefined();

        const agentErrors = (EventBus.client.emitOn as jest.Mock).mock.calls.filter(call => call[1] === Events.Agent.ERROR);
        expect(agentErrors).toHaveLength(0);
        expect(mockLoggerError).not.toHaveBeenCalled();
    });
    it('discards tool results when the task is cancelled while a tool runs', async () => {
        // disconnect() cancels the current task; a tool call in flight at that
        // moment still returns, and its result used to be persisted into the
        // closing socket. A task_complete that succeeded is different: it clears
        // the task itself and its result is stored like any other.
        const agent = new MxfAgent({ ...CONFIG });
        mockSendWithContextStreaming.mockResolvedValue({
            content: [{ type: 'tool_use', id: 'call-1', name: 'fetch_feed', input: { url: 'https://example.com/rss' } }],
            model: 'test-model'
        });
        const taskExecutionManager = (agent as unknown as {
            taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown>; cancelCurrentTask: (reason: string) => void };
        }).taskExecutionManager;
        jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            taskExecutionManager.cancelCurrentTask('consumer disconnected');
            return { content: { type: 'text', text: '<rss/>' } };
        });

        await expect(taskExecutionManager.executeTask({
            taskId: 'task-2',
            fromAgentId: 'requester',
            toAgentId: 'test-agent',
            title: 'Fetch',
            description: 'Fetch the feed',
            content: 'Fetch the feed'
        })).resolves.toBeDefined();

        const storedRoles = mockAddConversationMessage.mock.calls.map(call => (call[0] as { role: string }).role);
        expect(storedRoles).toContain('assistant');
        expect(storedRoles).not.toContain('tool');
        expect((EventBus.client.emitOn as jest.Mock).mock.calls.filter(call => call[1] === Events.Agent.ERROR)).toHaveLength(0);
        expect(mockLoggerError).not.toHaveBeenCalled();
    });
    it('keeps a genuine socket drop mid-task loud: the failure is reported, not ended quietly', async () => {
        // Only an explicit disconnect() is quiet. A transient drop (auto-reconnect
        // follows) must still surface, or an unfinished task sits in_progress with
        // no signal to anyone — the bug TaskHandlers already fixed once.
        const agent = new MxfAgent({ ...CONFIG });
        mockSendWithContextStreaming.mockResolvedValue(textResponse);
        mockAddConversationMessage.mockImplementation(async () => {
            (EventBus.client.isRegisteredSocketConnected as jest.Mock).mockReturnValue(false);
            throw new Error("Cannot start memory operation op-2: agent socket 'test-agent' is not connected");
        });
        const taskExecutionManager = (agent as unknown as {
            taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown> };
        }).taskExecutionManager;

        await expect(taskExecutionManager.executeTask({
            taskId: 'task-3',
            fromAgentId: 'requester',
            toAgentId: 'test-agent',
            title: 'Classify',
            description: 'Classify the feed',
            content: 'Classify the feed'
        })).rejects.toThrow('not connected');

        const agentErrors = (EventBus.client.emitOn as jest.Mock).mock.calls.filter(call => call[1] === Events.Agent.ERROR);
        expect(agentErrors).toHaveLength(1);
        expect(mockLoggerError).toHaveBeenCalled();
    });

    it('stores the real task_complete result when disconnect() cancelled the task during the call', async () => {
        // The consumer's task:completed listener fires while task_complete's own
        // round trip is still outstanding; disconnect() cancels the task before
        // the result returns. That result is the genuine, first completion —
        // not a duplicate — and must be stored as such.
        const agent = new MxfAgent({ ...CONFIG });
        mockSendWithContextStreaming.mockResolvedValue({
            content: [{ type: 'tool_use', id: 'call-2', name: 'task_complete', input: { summary: 'Classified 12 items' } }],
            model: 'test-model'
        });
        jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            await agent.disconnect();
            return { status: 'task_completed', message: 'Task completed successfully: Classified 12 items', taskId: 'task-4' };
        });
        const taskExecutionManager = (agent as unknown as {
            taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown> };
        }).taskExecutionManager;

        await expect(taskExecutionManager.executeTask({
            taskId: 'task-4',
            fromAgentId: 'requester',
            toAgentId: 'test-agent',
            title: 'Classify',
            description: 'Classify the feed',
            content: 'Classify the feed'
        })).resolves.toBeDefined();

        const toolMessages = mockAddConversationMessage.mock.calls
            .map(call => call[0] as { role: string; content: string })
            .filter(message => message.role === 'tool');
        expect(toolMessages).toHaveLength(1);
        expect(toolMessages[0].content).not.toContain('Duplicate task_complete');
        expect(toolMessages[0].content).toContain('Classified 12 items');
        expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('rejects overlapping admission before adding its prompt or changing task identity', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const manager = (agent as unknown as { taskExecutionManager: MxfTaskExecutionManager }).taskExecutionManager;
        let releasePreparation!: () => void;
        mockAddConversationMessage.mockImplementationOnce(() => new Promise<void>(resolve => { releasePreparation = resolve; }));
        const first = manager.executeTask({ taskId: 'task-A', content: 'First task' });
        await expect(manager.executeTask({ taskId: 'task-B', content: 'Second task' })).rejects.toThrow('already executing task task-A');
        expect(manager.getCurrentTask()?.taskId).toBe('task-A');
        expect(mockAddConversationMessage).toHaveBeenCalledTimes(1);
        expect(mockAddConversationMessage.mock.calls[0][0].content).toContain('First task');
        manager.cancelCurrentTask('test finished');
        releasePreparation();
        await first;
        expect(mockSendWithContextStreaming).not.toHaveBeenCalled();
    });

    it('discards a stopped task response and drains it before preparing the next task', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const manager = (agent as unknown as { taskExecutionManager: MxfTaskExecutionManager }).taskExecutionManager;
        let releaseFirst!: (response: unknown) => void;
        let reachedProvider!: () => void;
        const providerStarted = new Promise<void>(resolve => { reachedProvider = resolve; });
        mockSendWithContextStreaming.mockImplementationOnce(() => {
            reachedProvider();
            return new Promise(resolve => { releaseFirst = resolve; });
        }).mockResolvedValueOnce({
            content: [{ type: 'tool_use', id: 'call-B', name: 'task_complete', input: { summary: 'Second finished' } }],
            model: 'test-model'
        });
        const execute = jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            manager.clearCurrentTask('completed');
            return { status: 'task_completed', taskId: 'task-B', message: 'Second finished' };
        });
        const first = manager.executeTask({ taskId: 'task-A', content: 'First task' });
        await providerStarted;
        manager.cancelCurrentTask('cancelled by consumer');
        const second = manager.executeTask({ taskId: 'task-B', content: 'Second task' });
        expect(manager.getCurrentTask()?.taskId).toBe('task-B');
        expect(mockAddConversationMessage).toHaveBeenCalledTimes(1);
        releaseFirst({
            content: [{ type: 'tool_use', id: 'stale-call', name: 'fetch_feed', input: { url: 'https://example.com/stale' } }],
            model: 'test-model'
        });
        await Promise.all([first, second]);
        expect(execute.mock.calls.map(call => call[0])).toEqual(['task_complete']);
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(2);
        const history = JSON.stringify(mockAddConversationMessage.mock.calls);
        expect(history).not.toContain('stale-call');
        expect(history).toContain('Second task');
        expect(history).toContain('Second finished');
        expect(manager.getCurrentTask()).toBeNull();
    });

    it('drains an event-triggered contributor turn before preparing the next task', async () => {
        const agent = new MxfAgent({ ...CONFIG, maxIterations: 1 });
        const manager = agent.getTaskExecutionManager();
        const internal = agent as unknown as {
            provideImmediateToolFeedback(from: string, tool: string, data: string, type: string): Promise<string>;
        };
        let releaseFeedback!: (response: unknown) => void;
        let reachedFeedbackProvider!: () => void;
        const feedbackProviderStarted = new Promise<void>(resolve => { reachedFeedbackProvider = resolve; });
        mockSendWithContextStreaming.mockReset()
            .mockResolvedValueOnce(textResponse)
            .mockImplementationOnce(() => {
                reachedFeedbackProvider();
                return new Promise(resolve => { releaseFeedback = resolve; });
            })
            .mockResolvedValueOnce({
                content: [{ type: 'tool_use', id: 'call-B', name: 'task_complete', input: { summary: 'Second finished' } }],
                model: 'test-model'
            });
        const execute = jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            manager.clearCurrentTask('completed');
            return { status: 'task_completed', taskId: 'task-B', message: 'Second finished' };
        });

        // A contributor stays available for messages after its assigned loop ends.
        await manager.executeTask({ taskId: 'task-A', content: 'First task', completionAgentId: 'peer' });
        expect(manager.getCurrentTask()?.taskId).toBe('task-A');
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
        const feedback = internal.provideImmediateToolFeedback('peer', 'messaging_send', 'Continue task A', 'agent message');
        const feedbackOutcome = Promise.allSettled([feedback]);
        await Promise.race([
            feedbackProviderStarted,
            feedback.then(() => { throw new Error('Feedback returned before reaching its provider'); })
        ]);

        manager.clearCurrentTask('completed by peer');
        const second = manager.executeTask({ taskId: 'task-B', content: 'Second task' });
        const secondOutcome = Promise.allSettled([second]);
        let historyBeforeRelease: string;
        try {
            // Let B reach preparation while A's message-triggered provider stays pending.
            await new Promise<void>(resolve => { setImmediate(resolve); });
            historyBeforeRelease = JSON.stringify(mockAddConversationMessage.mock.calls);
            expect(manager.getCurrentTask()?.taskId).toBe('task-B');
        } finally {
            releaseFeedback({
                content: [{ type: 'tool_use', id: 'stale-feedback-call', name: 'fetch_feed', input: {} }],
                model: 'test-model'
            });
            await Promise.all([feedbackOutcome, secondOutcome]);
        }

        expect(historyBeforeRelease).not.toContain('Second task');
        expect((await feedbackOutcome)[0].status).toBe('fulfilled');
        expect((await secondOutcome)[0].status).toBe('fulfilled');
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(3);
        expect(execute.mock.calls.map(call => call[0])).toEqual(['task_complete']);
        const history = JSON.stringify(mockAddConversationMessage.mock.calls);
        expect(history).not.toContain('stale-feedback-call');
        expect(history).toContain('Second task');
        expect(history).toContain('Second finished');
        expect(manager.getCurrentTask()).toBeNull();
    });

    it('keeps feedback from starting the first turn while assigned task preparation is pending', async () => {
        const agent = new MxfAgent({ ...CONFIG, maxIterations: 1 });
        const manager = agent.getTaskExecutionManager();
        const internal = agent as unknown as {
            provideImmediateToolFeedback(from: string, tool: string, data: string, type: string): Promise<string>;
        };
        let releasePreparation!: () => void;
        mockAddConversationMessage.mockImplementationOnce(() => new Promise<void>(resolve => { releasePreparation = resolve; }));
        mockSendWithContextStreaming.mockReset().mockResolvedValue({
            content: [{ type: 'tool_use', id: 'prepared-call', name: 'task_complete', input: { summary: 'Prepared task finished' } }],
            model: 'test-model'
        });
        const execute = jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            manager.clearCurrentTask('completed');
            return { status: 'task_completed', taskId: 'task-B', message: 'Prepared task finished' };
        });
        const assigned = manager.executeTask({ taskId: 'task-B', content: 'Second task' });
        const assignedOutcome = Promise.allSettled([assigned]);
        const feedback = internal.provideImmediateToolFeedback('peer', 'messaging_send', 'Message during preparation', 'agent message');
        const feedbackOutcome = Promise.allSettled([feedback]);
        let providerCallsBeforePreparation: number;
        try {
            await feedback;
            providerCallsBeforePreparation = mockSendWithContextStreaming.mock.calls.length;
        } finally {
            releasePreparation();
            await Promise.all([assignedOutcome, feedbackOutcome]);
        }

        expect(providerCallsBeforePreparation).toBe(0);
        expect((await assignedOutcome)[0].status).toBe('fulfilled');
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
        expect(agent.getSystemPromptManager().updatePromptForTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-B' }));
        expect(execute.mock.calls.map(call => call[0])).toEqual(['task_complete']);
        expect(JSON.stringify(mockAddConversationMessage.mock.calls)).toContain('Prepared task finished');
        expect(manager.getCurrentTask()).toBeNull();
    });

    it('does not let a late completion result clear or append to a newer task', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const manager = (agent as unknown as { taskExecutionManager: MxfTaskExecutionManager }).taskExecutionManager;
        mockSendWithContextStreaming.mockResolvedValue({
            content: [{ type: 'tool_use', id: 'completion-call', name: 'task_complete', input: { summary: 'Done' } }],
            model: 'test-model'
        });
        let second!: Promise<unknown>;
        let callsToComplete = 0;
        jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            callsToComplete++;
            if (callsToComplete === 1) {
                manager.clearCurrentTask('completed');
                second = manager.executeTask({ taskId: 'task-B', content: 'Second task' });
                return { status: 'task_completed', taskId: 'task-A', message: 'Old completion' };
            }
            expect(manager.getCurrentTask()?.taskId).toBe('task-B');
            manager.clearCurrentTask('completed');
            return { status: 'task_completed', taskId: 'task-B', message: 'New completion' };
        });
        await manager.executeTask({ taskId: 'task-A', content: 'First task' });
        await second;
        expect(callsToComplete).toBe(2);
        const toolMessages = mockAddConversationMessage.mock.calls.map(call => call[0]).filter(message => message.role === 'tool');
        expect(toolMessages).toHaveLength(1);
        expect(toolMessages[0].content).toContain('New completion');
        expect(toolMessages[0].content).not.toContain('Old completion');
    });


    it('refreshes the real prompt manager when the accepted request uses taskId', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const { MxfSystemPromptManager: RealPromptManager } = jest.requireActual<typeof import('@mxf-dev/sdk/managers/MxfSystemPromptManager')>('@mxf-dev/sdk/managers/MxfSystemPromptManager');
        const update = jest.fn().mockResolvedValue(undefined);
        const framework = jest.spyOn(MxfAgentSystemPrompt, 'buildFrameworkSystemPrompt')
            .mockResolvedValue('Framework prompt for current tools');
        const real = new RealPromptManager(CONFIG.agentId, CONFIG, {
            getConversationHistory: (): Array<{ id: string; role: 'system'; content: string; timestamp: number }> => [{ id: 'system', role: 'system', content: 'old prompt', timestamp: 1 }],
            updateConversationMessage: update,
            getCachedTools: (): typeof cachedTools => cachedTools
        });
        jest.spyOn(agent.getSystemPromptManager(), 'updatePromptForTask').mockImplementation(task => real.updatePromptForTask(task));
        const manager = agent.getTaskExecutionManager();
        mockSendWithContextStreaming.mockImplementation(async () => {
            manager.cancelCurrentTask('finished checking prompt');
            return textResponse;
        });
        try {
            await manager.executeTask({ taskId: 'accepted-task', title: 'Current review', content: 'Review the evidence' });
            expect(update).toHaveBeenCalledWith(0, expect.objectContaining({
                role: 'system', content: expect.stringContaining('Framework prompt for current tools')
            }));
        } finally {
            framework.mockRestore();
        }
    });

    it('retains task context without accumulating system messages across session reconnects', async () => {
        const agent = new MxfAgent({ ...CONFIG, memoryMode: 'session' });
        const { MxfMemoryManager: RealMemoryManager } = jest.requireActual<typeof import('@mxf-dev/sdk/managers/MxfMemoryManager')>('@mxf-dev/sdk/managers/MxfMemoryManager');
        const memory = new RealMemoryManager({
            agentId: CONFIG.agentId, channelId: CONFIG.channelId,
            maxHistory: 5, maxObservations: 5, enablePersistence: false, memoryMode: 'session'
        });
        const internal = agent as unknown as {
            memoryManager: typeof memory;
            performAgentInitialization(): Promise<void>;
        };
        internal.memoryManager = memory;
        await internal.performAgentInitialization();
        await memory.addConversationMessage({ role: 'user', content: 'Keep this session context' });
        for (let reconnect = 0; reconnect < 12; reconnect++) {
            await internal.performAgentInitialization();
        }
        const history = memory.getConversationHistory();
        expect(history.filter(message => message.role === 'system')).toHaveLength(1);
        expect(history.some(message => message.content === 'Keep this session context')).toBe(true);
        expect(history.length).toBeLessThanOrEqual(5);
        await agent.disconnect();
    });

    it('does not resume an aggregated response against a newer task', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const manager = agent.getTaskExecutionManager();
        // Keep both task executions in preparation so this exercises the separate
        // aggregation entry path without a provider response taking ownership.
        let releaseFirst!: () => void;
        let releaseBatch!: () => void;
        mockAddConversationMessage
            .mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve; }))
            .mockImplementationOnce(() => new Promise<void>(resolve => { releaseBatch = resolve; }));
        const first = manager.executeTask({ taskId: 'task-A', title: 'First', content: 'First task' });
        const internal = agent as unknown as { handleAggregatedMessage(from: string[], content: string): Promise<void> };
        const batch = internal.handleAggregatedMessage(['peer'], 'Old task message');
        manager.cancelCurrentTask('cancelled');
        const second = manager.executeTask({ taskId: 'task-B', title: 'Second', content: 'Second task' });
        releaseBatch();
        await batch;
        expect(mockSendWithContextStreaming).not.toHaveBeenCalled();
        manager.cancelCurrentTask('test done');
        releaseFirst();
        await Promise.all([first, second]);
    });

});

describe('MxfAgent framework-mode tool results', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (EventBus.client as unknown as { _reset: () => void })._reset();
        (EventBus.client.isRegisteredSocketConnected as jest.Mock).mockReturnValue(true);
        mockAddConversationMessage.mockResolvedValue(undefined);
    });

    it('sends the model the payload of a native MCP result envelope, not "Success"', async () => {
        // Since 5.0 the server forwards an external server's result unchanged as
        // {content: [{type: 'text', text}]}. The default prompt mode turned that
        // into the word "Success" while the channel monitor logged every payload.
        const agent = new MxfAgent({ ...CONFIG });
        const payload = JSON.stringify({ portfolio: { startingCapital: 2000 } });
        mockSendWithContextStreaming.mockResolvedValueOnce({
            content: [{ type: 'tool_use', id: 'read-call', name: 'fetch_feed', input: { scope: 'open' } }],
            model: 'test-model'
        }).mockResolvedValueOnce({
            content: [{ type: 'tool_use', id: 'finish-call', name: 'task_complete', input: { summary: 'Reviewed positions' } }],
            model: 'test-model'
        });
        jest.spyOn(agent, 'executeTool').mockImplementation(async (toolName: string) => toolName === 'fetch_feed'
            ? { content: [{ type: 'text', text: payload }] }
            : { status: 'task_completed', taskId: 'task-5', message: 'Task completed successfully: Reviewed positions' });

        await expect(agent.getTaskExecutionManager().executeTask({
            taskId: 'task-5', fromAgentId: 'requester', toAgentId: 'test-agent',
            title: 'Review', description: 'Review the portfolio', content: 'Review the portfolio'
        })).resolves.toBeDefined();

        const toolMessages = mockAddConversationMessage.mock.calls
            .map(call => call[0] as { role: string; content: string; metadata?: { tool_call_id?: string } })
            .filter(message => message.role === 'tool');
        expect(toolMessages.map(message => [message.metadata?.tool_call_id, message.content])).toEqual([
            ['read-call', payload],
            ['finish-call', expect.stringContaining('Reviewed positions')]
        ]);
        expect(mockLoggerError).not.toHaveBeenCalled();
        await agent.disconnect();
    });
});
