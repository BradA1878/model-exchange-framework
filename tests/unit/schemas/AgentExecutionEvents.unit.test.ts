import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { isPublicEvent } from '@mxf-dev/core/events/PublicEvents';
import {
    createBaseEventPayload, createLlmRequestEventPayload, createAgentIterationLimitEventPayload,
    createAgentHistoryTrimmedEventPayload, createLlmReasoningEventPayload, createLlmStreamChunkEventPayload,
    createLlmUsageEventPayload, createMcpToolCallPayload, createMcpToolResultPayload, createMcpToolErrorPayload,
    type AgentHistoryTrimmedEventData, type AgentIterationLimitEventData, type LlmRequestEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';

const agentId = 'observer';
const channelId = 'channel';
const correlation = { activationId: 'activation-a', requestId: 'request-a' };
const requestData: LlmRequestEventData = {
    ...correlation, provider: 'openrouter', model: 'test-model',
    body: { messages: [{ role: 'system', content: '\nOperator prompt\n' }], temperature: 0 }
};
const limitData: AgentIterationLimitEventData = {
    activationId: correlation.activationId, maxIterations: 2, trigger: 'channel_message', messageId: 'message-a'
};
const trimData: AgentHistoryTrimmedEventData = {
    maxHistory: 3, droppedCount: 2, droppedMessageIds: ['old-user', 'old-assistant'], keptCount: 3
};

describe('agent execution event contracts', () => {
    it('preserves primitive response data with optional envelope correlation', () => {
        const response = createBaseEventPayload(Events.Agent.LLM_RESPONSE, agentId, channelId, 'Hello.', correlation);
        expect(response).toMatchObject({ ...correlation, data: 'Hello.' });
        const received: string[] = [];
        const subscription = EventBus.client.on(Events.Agent.LLM_RESPONSE, payload => { received.push(payload.data); });
        try {
            EventBus.client.emitLocal(Events.Agent.LLM_RESPONSE, response);
            expect(received).toEqual(['Hello.']);
        } finally {
            subscription.unsubscribe();
        }
        const legacy = createBaseEventPayload(Events.Agent.LLM_RESPONSE, agentId, channelId, 'Hello.');
        expect(legacy.data).toBe('Hello.');
        expect(legacy).not.toHaveProperty('activationId');
        expect(legacy).not.toHaveProperty('requestId');
    });

    it('publishes a typed exact request body through the actual local EventBus', () => {
        const received: LlmRequestEventData[] = [];
        const subscription = EventBus.client.on(Events.Agent.LLM_REQUEST, payload => { received.push(payload.data); });
        try {
            const payload = createLlmRequestEventPayload(Events.Agent.LLM_REQUEST, agentId, channelId, requestData);
            expect(payload).toMatchObject(correlation);
            EventBus.client.emitLocal(Events.Agent.LLM_REQUEST, payload);
            expect(received).toEqual([requestData]);
            expect(received[0].body).toEqual(requestData.body);
        } finally {
            subscription.unsubscribe();
        }
    });

    it.each(['requestId', 'activationId', 'provider', 'model'] as const)('rejects a request observation without %s', field => {
        expect(() => createLlmRequestEventPayload(Events.Agent.LLM_REQUEST, agentId, channelId, { ...requestData, [field]: ' ' }))
            .toThrow(field);
    });

    it('rejects a non-object request body and contradictory correlation', () => {
        expect(() => createLlmRequestEventPayload(Events.Agent.LLM_REQUEST, agentId, channelId,
            { ...requestData, body: [] } as unknown as LlmRequestEventData)).toThrow('body');
        expect(() => createLlmRequestEventPayload(Events.Agent.LLM_REQUEST, agentId, channelId,
            requestData, { activationId: 'different' })).toThrow('activationId must match event data');
        expect(() => createBaseEventPayload(Events.Agent.LLM_RESPONSE, agentId, channelId, 'Hello.', { requestId: '' }))
            .toThrow('requestId');
    });

    it('carries correlation on existing reasoning, usage, streaming, and tool events', () => {
        const payloads = [
            createLlmReasoningEventPayload(Events.Agent.LLM_REASONING, agentId, channelId, { reasoning: 'Consider the evidence' }, correlation),
            createLlmStreamChunkEventPayload(Events.Agent.LLM_STREAM_CHUNK, agentId, channelId, { chunk: 'Hi', timestamp: 1 }, correlation),
            createLlmUsageEventPayload(Events.Agent.LLM_USAGE, agentId, channelId,
                { model: 'test', inputTokens: 1, outputTokens: 2, totalTokens: 3, timestamp: 1 }, correlation),
            createMcpToolCallPayload(Events.Mcp.TOOL_CALL, agentId, channelId, { toolName: 'read_file', callId: 'tool-a', arguments: {} }, correlation),
            createMcpToolResultPayload(Events.Mcp.TOOL_RESULT, agentId, channelId, { toolName: 'read_file', callId: 'tool-a', result: '' }, correlation),
            createMcpToolErrorPayload(Events.Mcp.TOOL_ERROR, agentId, channelId, { toolName: 'read_file', callId: 'tool-a', error: 'Denied' }, correlation)
        ];
        for (const payload of payloads) expect(payload).toMatchObject(correlation);
        expect(payloads[4].data).toMatchObject({ result: '' });
        expect(payloads[5].data).toMatchObject({ error: 'Denied' });
    });

    it('retains reported zero cost and latency without inventing absent provider metadata', () => {
        const usage = { model: 'test', inputTokens: 0, outputTokens: 0, totalTokens: 0, timestamp: 1 };
        const absent = createLlmUsageEventPayload(Events.Agent.LLM_USAGE, agentId, channelId, usage);
        expect(absent.data).not.toHaveProperty('costUsd');
        expect(absent.data).not.toHaveProperty('providerRoute');
        const reported = createLlmUsageEventPayload(Events.Agent.LLM_USAGE, agentId, channelId, {
            ...usage, ...correlation, costUsd: 0, latencyMs: 0, providerRoute: 'route-a', finishReason: 'stop', nativeFinishReason: 'end_turn'
        });
        expect(reported).toMatchObject(correlation);
        expect(reported.data).toMatchObject({ costUsd: 0, latencyMs: 0, providerRoute: 'route-a', finishReason: 'stop', nativeFinishReason: 'end_turn' });
        expect(() => createLlmUsageEventPayload(Events.Agent.LLM_USAGE, agentId, channelId, { ...usage, costUsd: NaN })).toThrow('costUsd');
    });

    it('validates iteration identity, trigger and positive integer bound', () => {
        const payload = createAgentIterationLimitEventPayload(Events.Agent.ITERATION_LIMIT, agentId, channelId, limitData);
        expect(payload).toMatchObject({ activationId: correlation.activationId, data: limitData });
        for (const maxIterations of [0, -1, 1.5, Infinity]) {
            expect(() => createAgentIterationLimitEventPayload(Events.Agent.ITERATION_LIMIT, agentId, channelId, { ...limitData, maxIterations }))
                .toThrow('positive integer');
        }
        expect(() => createAgentIterationLimitEventPayload(Events.Agent.ITERATION_LIMIT, agentId, channelId,
            { ...limitData, trigger: 'task' } as unknown as AgentIterationLimitEventData)).toThrow('trigger');
        expect(() => createAgentIterationLimitEventPayload(Events.Agent.ITERATION_LIMIT, agentId, channelId, { ...limitData, messageId: '' }))
            .toThrow('messageId');
    });

    it('reports exact trim counts and rejects empty or inconsistent removal reports', () => {
        expect(createAgentHistoryTrimmedEventPayload(Events.Agent.HISTORY_TRIMMED, agentId, channelId, trimData).data).toEqual(trimData);
        const invalid = [
            { ...trimData, droppedCount: 1 }, { ...trimData, droppedCount: 0, droppedMessageIds: [] },
            { ...trimData, keptCount: -1 }, { ...trimData, droppedMessageIds: ['old-user', ''] }
        ];
        for (const data of invalid) {
            expect(() => createAgentHistoryTrimmedEventPayload(Events.Agent.HISTORY_TRIMMED, agentId, channelId, data)).toThrow();
        }
    });

    it('exposes all three events through the public agent API allowlist', () => {
        for (const event of [Events.Agent.LLM_REQUEST, Events.Agent.ITERATION_LIMIT, Events.Agent.HISTORY_TRIMMED]) {
            expect(isPublicEvent(event)).toBe(true);
        }
    });
});
