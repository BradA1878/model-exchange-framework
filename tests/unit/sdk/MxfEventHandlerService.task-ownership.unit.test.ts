import type { BaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';

const mockHandlers = new Map<string, Array<(payload: BaseEventPayload) => unknown>>();
const mockProcessIncoming = jest.fn();
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
    MxpMiddleware: {
        processIncoming: (...args: unknown[]): Promise<unknown> => mockProcessIncoming(...args),
        mxpToNaturalLanguage: jest.fn()
    }
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { createMxpMessage, MxpMessageType } from '@mxf-dev/core/schemas/MxpProtocolSchemas';
import { SYSTEMLLM_CHALLENGE_MESSAGE_TYPE } from '@mxf-dev/core/types/SystemLlmStanceTypes';
import {
    EventHandlerCallbacks,
    MxfEventHandlerService
} from '@mxf-dev/sdk/services/MxfEventHandlerService';

const AGENT_ID = 'event-worker';
const CHANNEL_ID = 'event-channel';
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
};

describe('MxfEventHandlerService task ownership across asynchronous work', () => {
    let currentTask: { taskId: string } | null;
    let callbacks: EventHandlerCallbacks;
    let service: MxfEventHandlerService;
    let addConversationMessage: jest.Mock;
    let feedback: jest.Mock;
    let generate: jest.Mock;
    let aggregate: jest.Mock;

    beforeEach(() => {
        mockHandlers.clear();
        mockProcessIncoming.mockReset();
        currentTask = { taskId: 'task-A' };
        addConversationMessage = jest.fn().mockResolvedValue(undefined);
        feedback = jest.fn().mockResolvedValue('ok');
        generate = jest.fn().mockResolvedValue('ok');
        aggregate = jest.fn().mockReturnValue(false);
        callbacks = {
            addConversationMessage,
            provideImmediateToolFeedback: feedback,
            generateResponse: generate,
            getContextualTools: (_history, tools): ReturnType<EventHandlerCallbacks['getContextualTools']> => tools,
            getConversationHistory: (): [] => [],
            getAvailableTools: (): Array<{ name: string }> => [{ name: 'task_complete' }],
            getCurrentTask: (): typeof currentTask => currentTask,
            hasActiveTask: (): boolean => currentTask !== null,
            isToolGatekeepingDisabled: (): boolean => false,
            getAgentCapabilities: (): string[] => [],
            tryAggregateMessage: aggregate
        };
        service = new MxfEventHandlerService(AGENT_ID, callbacks);
        service.initializeEventHandlers();
    });

    afterEach(() => { service.cleanup(); });

    const dispatch = async (event: string, data: Record<string, unknown>): Promise<void> => {
        const payload = createBaseEventPayload(event, AGENT_ID, CHANNEL_ID, data);
        await Promise.all((mockHandlers.get(event) ?? []).map(handler => handler(payload)));
    };

    const message = (content: unknown): Record<string, unknown> => ({
        messageId: 'message-A', senderId: 'peer', receiverId: AGENT_ID, content
    });

    it.each([Events.Message.AGENT_MESSAGE, Events.Message.CHANNEL_MESSAGE])(
        'discards %s decoded after a different task is accepted', async event => {
            const decoded = deferred<string>();
            mockProcessIncoming.mockReturnValue(decoded.promise);
            const content = createMxpMessage(MxpMessageType.OPERATION, 'peer', { op: 'review', args: [] });
            const processing = dispatch(event, message(content));
            expect(mockProcessIncoming).toHaveBeenCalledTimes(1);

            currentTask = { taskId: 'task-B' };
            decoded.resolve('decoded work for task A');
            await processing;

            expect(addConversationMessage).not.toHaveBeenCalled();
            expect(aggregate).not.toHaveBeenCalled();
            expect(feedback).not.toHaveBeenCalled();
        }
    );

    const saveCases: Array<{ name: string; event: string; data: Record<string, unknown> }> = [
        { name: 'direct message', event: Events.Message.AGENT_MESSAGE, data: message('work for task A') },
        { name: 'channel message', event: Events.Message.CHANNEL_MESSAGE, data: message('work for task A') },
        {
            name: 'SystemLLM challenge', event: Events.Message.CHANNEL_MESSAGE,
            data: {
                senderId: 'system', receiverId: AGENT_ID, content: 'Explain task A',
                context: { messageType: SYSTEMLLM_CHALLENGE_MESSAGE_TYPE, taskId: 'task-A' }
            }
        },
        { name: 'system event', event: Events.System.COORDINATION_HINT, data: { content: 'coordinate task A' } },
        { name: 'message error', event: Events.Message.MESSAGE_ERROR, data: { error: 'invalid message for task A' } }
    ];

    it.each(saveCases)('does not answer a $name after its save outlasts task A', async ({ event, data }) => {
        const saved = deferred<void>();
        addConversationMessage.mockReturnValueOnce(saved.promise);
        const processing = dispatch(event, data);
        expect(addConversationMessage).toHaveBeenCalledTimes(1);

        currentTask = { taskId: 'task-B' };
        saved.resolve();
        await processing;

        expect(feedback).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
        // MESSAGE_ERROR must not add a second corrective prompt under task B.
        expect(addConversationMessage).toHaveBeenCalledTimes(1);
    });

    it('keeps idle channel context without triggering a task admitted while it saves', async () => {
        currentTask = null;
        const saved = deferred<void>();
        addConversationMessage.mockReturnValueOnce(saved.promise);
        const processing = dispatch(Events.Message.CHANNEL_MESSAGE, message('context while idle'));
        expect(addConversationMessage).toHaveBeenCalledTimes(1);
        currentTask = { taskId: 'task-B' };
        saved.resolve();
        await processing;
        expect(feedback).not.toHaveBeenCalled();
    });

    it('still answers when the same accepted task owns the saved message', async () => {
        await dispatch(Events.Message.AGENT_MESSAGE, message('current task message'));
        expect(addConversationMessage).toHaveBeenCalledTimes(1);
        expect(feedback).toHaveBeenCalledWith('peer', 'messaging_send', 'current task message', 'agent message');
    });
});
