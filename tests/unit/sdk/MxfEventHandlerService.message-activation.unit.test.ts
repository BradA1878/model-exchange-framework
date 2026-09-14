import type { BaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';

const mockHandlers = new Map<string, Array<(payload: BaseEventPayload) => unknown>>();
const mockProcessIncoming = jest.fn();
const mockMxpToNaturalLanguage = jest.fn();
jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { client: {
        on: jest.fn((event: string, handler: (payload: BaseEventPayload) => unknown) => {
            const handlers = mockHandlers.get(event) ?? [];
            handlers.push(handler);
            mockHandlers.set(event, handlers);
            return { unsubscribe: jest.fn() };
        })
    } }
}));
jest.mock('@mxf-dev/core/middleware/MxpMiddleware', () => ({
    MxpMiddleware: { processIncoming: mockProcessIncoming, mxpToNaturalLanguage: mockMxpToNaturalLanguage }
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { createAgentMessage, createChannelMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import { createMxpMessage, MxpMessageType } from '@mxf-dev/core/schemas/MxpProtocolSchemas';
import { SYSTEMLLM_CHALLENGE_MESSAGE_TYPE } from '@mxf-dev/core/types/SystemLlmStanceTypes';
import { MxfEventHandlerService, type EventHandlerCallbacks, type MessageActivationInput, type MessageActivationTrigger } from '@mxf-dev/sdk/services/MxfEventHandlerService';
import type { ConversationMessageInput } from '@mxf-dev/sdk/managers/MxfMemoryManager';

const AGENT = 'listener';
const CHANNEL = 'owned-channel';
type ExecutionConfig = NonNullable<ConstructorParameters<typeof MxfEventHandlerService>[2]>;

describe('message activation dispatch and bare history', () => {
    let service: MxfEventHandlerService;
    let callbacks: EventHandlerCallbacks;
    let accept: jest.Mock;
    let save: jest.Mock;
    let feedback: jest.Mock;
    let generate: jest.Mock;
    let task: { taskId: string } | null;

    beforeEach(() => {
        mockHandlers.clear();
        mockProcessIncoming.mockReset();
        mockMxpToNaturalLanguage.mockReset();
        accept = jest.fn().mockResolvedValue(undefined);
        save = jest.fn().mockResolvedValue(undefined);
        feedback = jest.fn().mockResolvedValue('answered');
        generate = jest.fn().mockResolvedValue('answered');
        task = null;
        callbacks = {
            acceptMessage: accept, addConversationMessage: save,
            provideImmediateToolFeedback: feedback, generateResponse: generate,
            getContextualTools: (_history, tools): ReturnType<EventHandlerCallbacks['getContextualTools']> => tools,
            getConversationHistory: (): [] => [], getAvailableTools: (): [] => [],
            getCurrentTask: (): typeof task => task, hasActiveTask: (): boolean => task !== null,
            isToolGatekeepingDisabled: (): boolean => false
        };
    });

    afterEach(() => { service?.cleanup(); });

    const start = (config: ExecutionConfig = {}): void => {
        service = new MxfEventHandlerService(AGENT, callbacks, {
            channelId: CHANNEL, promptMode: 'bare', activation: 'message', ...config
        });
        service.initializeEventHandlers();
    };

    // Dispatch through the service's actual registered handlers. Calling this
    // function runs each handler synchronously up to its first suspension.
    const dispatch = (event: string, data: object, channelId = CHANNEL): Promise<void> => {
        const payload = createBaseEventPayload(event, 'peer', channelId, data);
        return Promise.all((mockHandlers.get(event) ?? []).map(handler => handler(payload))).then(() => undefined);
    };

    it('requires an activation owner when message mode is selected', () => {
        delete callbacks.acceptMessage;
        expect(() => start()).toThrow('Message activation requires an acceptMessage callback');
        expect(() => start({ activation: 'task' })).not.toThrow();
    });

    it.each([Events.Message.AGENT_MESSAGE, Events.Message.CHANNEL_MESSAGE])(
        'reserves %s synchronously without a task or a second storage path', async event => {
            start();
            let release!: () => void;
            accept.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
            const data = createAgentMessage('peer', AGENT, '  raw\ntext  ', { metadata: { messageId: 'canonical' } });
            const pending = dispatch(event, data);
            try {
                expect(accept).toHaveBeenCalledTimes(1);
                expect(accept).toHaveBeenCalledWith(
                    { trigger: event === Events.Message.AGENT_MESSAGE ? 'agent_message' : 'channel_message', messageId: 'canonical' },
                    { role: 'user', content: '  raw\ntext  ', metadata: { fromAgentId: 'peer', originalMessageId: 'canonical' } }
                );
                expect(save).not.toHaveBeenCalled();
                expect(feedback).not.toHaveBeenCalled();
                expect(generate).not.toHaveBeenCalled();
            } finally {
                release();
                await pending;
            }
        }
    );

    it('deduplicates canonical IDs across delivery envelopes and message routes, not repeated text', async () => {
        start();
        const data = { senderId: 'peer', receiverId: AGENT, content: 'same text', messageId: 'transport-A', metadata: { messageId: 'canonical-A' } };
        await dispatch(Events.Message.AGENT_MESSAGE, data);
        await dispatch(Events.Message.CHANNEL_MESSAGE, { ...data, messageId: 'transport-B' });
        await dispatch(Events.Message.CHANNEL_MESSAGE, { ...data, metadata: { messageId: 'canonical-B' } });
        expect(accept.mock.calls.map(([trigger]) => trigger.messageId)).toEqual(['canonical-A', 'canonical-B']);
    });

    it('rejects missing canonical IDs even when the delivery envelope has an ID', async () => {
        start();
        await expect(dispatch(Events.Message.AGENT_MESSAGE, { senderId: 'peer', receiverId: AGENT, content: 'raw' }))
            .rejects.toThrow('Message activation requires a canonical messageId');
        expect(accept).not.toHaveBeenCalled();
    });

    it.each([
        { name: 'self broadcast', event: Events.Message.CHANNEL_MESSAGE, data: { senderId: AGENT } },
        { name: 'self DM', event: Events.Message.AGENT_MESSAGE, data: { senderId: AGENT } },
        { name: 'another receiver', event: Events.Message.AGENT_MESSAGE, data: { receiverId: 'other' } },
        { name: 'addressed channel message', event: Events.Message.CHANNEL_MESSAGE, data: { receiverId: 'other' } },
        { name: 'system sender', event: Events.Message.CHANNEL_MESSAGE, data: { senderId: 'system' } },
        { name: 'SystemLLM metadata', event: Events.Message.AGENT_MESSAGE, data: { metadata: { source: 'SystemLlmService' } } },
        { name: 'system flag', event: Events.Message.CHANNEL_MESSAGE, data: { context: { systemGenerated: true } } },
        { name: 'task metadata', event: Events.Message.AGENT_MESSAGE, data: { context: { source: 'TaskService' } } },
        { name: 'memory metadata', event: Events.Message.AGENT_MESSAGE, data: { metadata: { source: 'MemoryService' } } },
        { name: 'SystemLLM challenge', event: Events.Message.CHANNEL_MESSAGE, data: { context: { messageType: SYSTEMLLM_CHALLENGE_MESSAGE_TYPE } } }
    ])('ignores $name before activation or storage', async ({ event, data }) => {
        start();
        await dispatch(event, { messageId: 'ignored', senderId: 'peer', receiverId: AGENT, content: 'injected text', ...data });
        expect(accept).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(feedback).not.toHaveBeenCalled();
    });

    it.each(['message', 'task'] as const)('filters shared EventBus traffic by owned channel in %s mode', async activation => {
        start({ activation });
        task = { taskId: 'task-A' };
        const data = createAgentMessage('peer', AGENT, 'foreign');
        await dispatch(Events.Message.AGENT_MESSAGE, data, 'other-channel');
        await dispatch(Events.Message.CHANNEL_MESSAGE, data, 'other-channel');
        expect(accept).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(feedback).not.toHaveBeenCalled();
    });

    it('serializes application objects without treating arbitrary data fields as envelopes or decoding MXP', async () => {
        start();
        const applicationObject = { data: 'literal property', value: 0 };
        const mxp = createMxpMessage(MxpMessageType.OPERATION, 'peer', { op: 'review', args: [] });
        await dispatch(Events.Message.CHANNEL_MESSAGE, createChannelMessage(CHANNEL, 'memory-reader', applicationObject));
        await dispatch(Events.Message.AGENT_MESSAGE, { senderId: 'peer', receiverId: AGENT, messageId: 'raw-object', content: applicationObject });
        await dispatch(Events.Message.AGENT_MESSAGE, { senderId: 'peer', receiverId: AGENT, messageId: 'mxp', content: mxp });
        expect(accept.mock.calls.map(([, message]) => message.content)).toEqual([
            JSON.stringify(applicationObject), JSON.stringify(applicationObject), JSON.stringify(mxp)
        ]);
        expect(accept.mock.calls[0][1].role).toBe('user');
        expect(mockProcessIncoming).not.toHaveBeenCalled();
    });

    it('does not apply the task outgoing-message gate to message activations', async () => {
        start();
        await dispatch(Events.Message.AGENT_MESSAGE, createAgentMessage(AGENT, 'peer', 'outgoing'));
        await dispatch(Events.Message.AGENT_MESSAGE, createAgentMessage('peer', AGENT, 'immediate answer'));
        expect(accept).toHaveBeenCalledTimes(1);
    });

    it.each([Events.Message.AGENT_MESSAGE, Events.Message.CHANNEL_MESSAGE])(
        'reserves framework %s before delayed MXP decoding and stores the decoded dialogue', async event => {
            start({ promptMode: 'framework' });
            let finishDecode!: (value: string) => void;
            const decoded = new Promise<string>(resolve => { finishDecode = resolve; });
            mockProcessIncoming.mockReturnValue(decoded);
            const stored: ConversationMessageInput[] = [];
            let reserved = false;
            accept.mockImplementation(async (_trigger: MessageActivationTrigger, input: MessageActivationInput): Promise<void> => {
                // This is the activation owner's entry point, before it awaits
                // preparation or persistence. Decoding has not even started yet.
                expect(mockProcessIncoming).not.toHaveBeenCalled();
                reserved = true;
                stored.push(typeof input === 'function' ? await input() : input);
            });
            const content = createMxpMessage(MxpMessageType.OPERATION, 'peer', { op: 'review', args: [] });
            const pending = dispatch(event, { senderId: 'peer', receiverId: AGENT, messageId: 'delayed-mxp', content });
            try {
                expect(reserved).toBe(true);
                expect(accept).toHaveBeenCalledTimes(1);
                expect(accept.mock.calls[0][1]).toEqual(expect.any(Function));
                expect(mockProcessIncoming).toHaveBeenCalledWith(content);
                expect(stored).toEqual([]);
            } finally {
                finishDecode('decoded MXP text');
                await pending;
            }
            expect(stored).toHaveLength(1);
            expect(stored[0]).toEqual({
                role: 'user',
                content: event === Events.Message.AGENT_MESSAGE ? 'decoded MXP text' :
                    `🎯 CHANNEL NOTIFICATION: Agent "peer" sent a message to channel "${CHANNEL}" using "messaging_broadcast": "decoded MXP text". Please review this channel message and decide how to respond or proceed.`,
                metadata: { fromAgentId: 'peer', originalMessageId: 'delayed-mxp' }
            });
            expect(save).not.toHaveBeenCalled();
            expect(feedback).not.toHaveBeenCalled();
        }
    );

    it.each([{ capabilities: [] }, { capabilities: ['mxp-protocol'] }, { capabilities: ['calculation'] }])(
        'preserves framework MXP conversion policy for capabilities $capabilities', async ({ capabilities }) => {
            callbacks.getAgentCapabilities = (): string[] => capabilities;
            start({ promptMode: 'framework' });
            const mxp = createMxpMessage(MxpMessageType.OPERATION, 'peer', { op: 'review', args: [] });
            mockProcessIncoming.mockResolvedValue(mxp);
            mockMxpToNaturalLanguage.mockReturnValue('readable operation');
            const stored: ConversationMessageInput[] = [];
            accept.mockImplementation(async (_trigger: MessageActivationTrigger, input: MessageActivationInput): Promise<void> => {
                stored.push(typeof input === 'function' ? await input() : input);
            });
            await dispatch(Events.Message.AGENT_MESSAGE, { senderId: 'peer', receiverId: AGENT, messageId: 'mxp-capability', content: mxp });
            expect(stored[0].content).toBe(capabilities.length === 0 ? 'readable operation' : JSON.stringify(mxp));
            expect(mockMxpToNaturalLanguage).toHaveBeenCalledTimes(capabilities.length === 0 ? 1 : 0);
        }
    );

    it('rejects failed MXP preparation without storing ciphertext as dialogue', async () => {
        start({ promptMode: 'framework' });
        const mxp = createMxpMessage(MxpMessageType.OPERATION, 'peer', { op: 'review', args: [] });
        mockProcessIncoming.mockRejectedValue(new Error('MXP decryption failed'));
        accept.mockImplementation(async (_trigger: MessageActivationTrigger, input: MessageActivationInput): Promise<void> => {
            await save(typeof input === 'function' ? await input() : input);
        });
        await expect(dispatch(Events.Message.AGENT_MESSAGE, {
            senderId: 'peer', receiverId: AGENT, messageId: 'invalid-mxp', content: mxp
        })).rejects.toThrow('MXP decryption failed');
        expect(accept).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();
        expect(feedback).not.toHaveBeenCalled();
    });

    it.each([Events.System.COORDINATION_HINT, Events.Agent.ERROR, Events.Memory.UPDATE_ERROR, Events.Message.MESSAGE_ERROR])(
        'does not inject framework event %s into bare history', async event => {
            start();
            task = { taskId: 'task-A' };
            await dispatch(event, { content: 'framework instructions', error: 'invalid tool call' });
            expect(save).not.toHaveBeenCalled();
            expect(generate).not.toHaveBeenCalled();
            expect(accept).not.toHaveBeenCalled();
        }
    );

    it.each([Events.Message.AGENT_MESSAGE, Events.Message.CHANNEL_MESSAGE])(
        'keeps %s raw in bare task mode while preserving immediate feedback', async event => {
            start({ activation: 'task' });
            task = { taskId: 'task-A' };
            await dispatch(event, createAgentMessage('peer', AGENT, '  original text  '));
            expect(save).toHaveBeenCalledWith(expect.objectContaining({
                role: 'user', content: '  original text  ', metadata: expect.objectContaining({ fromAgentId: 'peer' })
            }));
            expect(feedback).toHaveBeenCalledTimes(1);
            expect(accept).not.toHaveBeenCalled();
        }
    );

    it('retains framework channel notification wording when only message activation is enabled', async () => {
        start({ promptMode: 'framework' });
        await dispatch(Events.Message.CHANNEL_MESSAGE, createChannelMessage(CHANNEL, 'peer', 'hello'));
        expect(accept.mock.calls[0][1].content).toBe(
            `🎯 CHANNEL NOTIFICATION: Agent "peer" sent a message to channel "${CHANNEL}" using "messaging_broadcast": "hello". Please review this channel message and decide how to respond or proceed.`
        );
    });

    it('preserves the default task gate and deduplicates canonical channel deliveries', async () => {
        start({ promptMode: 'framework', activation: 'task' });
        await dispatch(Events.Message.AGENT_MESSAGE, createAgentMessage('peer', AGENT, 'idle DM'));
        expect(save).not.toHaveBeenCalled();
        task = { taskId: 'task-A' };
        const data = createChannelMessage(CHANNEL, 'peer', 'channel message');
        await dispatch(Events.Message.CHANNEL_MESSAGE, data);
        await dispatch(Events.Message.CHANNEL_MESSAGE, data);
        expect(save).toHaveBeenCalledTimes(1);
        expect(feedback).toHaveBeenCalledTimes(1);
    });
});
