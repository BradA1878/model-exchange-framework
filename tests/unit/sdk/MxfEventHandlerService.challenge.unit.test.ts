/**
 * Unit tests for MxfEventHandlerService's SystemLLM "stance" channel-message
 * handling: challenges that ask an agent to answer, and the older
 * coordination hints that never do.
 *
 * handleChannelMessage is private. The constructor does not touch EventBus
 * (only the separate initializeEventHandlers() call does, and these tests
 * never call it), so no EventBus mock is needed here — these tests reach the
 * handler directly through a narrow cast that widens only the one method
 * under test, and assert on what it does with the callbacks it is given.
 */

import { MxfEventHandlerService, EventHandlerCallbacks } from '@mxf-dev/sdk/services/MxfEventHandlerService';
import { SYSTEMLLM_CHALLENGE_MESSAGE_TYPE } from '@mxf-dev/core/types/SystemLlmStanceTypes';

const AGENT_ID = 'agent-under-test';

interface ChallengeContextFixture {
    messageType: string;
    stance?: string;
    challengeId?: string;
    trigger?: string;
    taskId?: string;
    targetAgentId?: string;
}

interface ChallengeEventDataFixture {
    senderId: string;
    receiverId?: string;
    content: { format: string; data: string };
    context: ChallengeContextFixture;
}

interface CoordinationHintEventDataFixture {
    senderId: string;
    content: { data: string };
    context: { source: string; messageType: string };
}

interface PayloadFixture {
    timestamp: number;
}

interface ServiceHarness {
    service: MxfEventHandlerService;
    addConversationMessage: jest.Mock;
    provideImmediateToolFeedback: jest.Mock;
}

/** Build a service wired to fresh callback mocks so each test starts clean. */
const buildService = (agentId: string, hasActiveTask = true): ServiceHarness => {
    const addConversationMessage = jest.fn().mockResolvedValue(undefined);
    const provideImmediateToolFeedback = jest.fn().mockResolvedValue('ok');
    const callbacks: EventHandlerCallbacks = {
        addConversationMessage,
        provideImmediateToolFeedback,
        generateResponse: jest.fn(),
        getContextualTools: jest.fn(),
        getConversationHistory: jest.fn(),
        getAvailableTools: jest.fn(),
        getCurrentTask: jest.fn(),
        isToolGatekeepingDisabled: jest.fn(),
        hasActiveTask: jest.fn(() => hasActiveTask)
    };
    return {
        service: new MxfEventHandlerService(agentId, callbacks),
        addConversationMessage,
        provideImmediateToolFeedback
    };
};

/** handleChannelMessage is private; this is the narrow cast the task brief calls for. */
const invokeHandleChannelMessage = (
    service: MxfEventHandlerService,
    eventData: unknown,
    payload: unknown
): Promise<void> =>
    (service as unknown as { handleChannelMessage: (eventData: unknown, payload: unknown) => Promise<void> })
        .handleChannelMessage(eventData, payload);

describe('MxfEventHandlerService SystemLLM challenge handling', () => {
    it('stores a challenge addressed to this agent as requiring a response, then requests immediate feedback', async () => {
        const { service, addConversationMessage, provideImmediateToolFeedback } = buildService(AGENT_ID);
        const eventData: ChallengeEventDataFixture = {
            senderId: 'system',
            receiverId: AGENT_ID,
            content: { format: 'text', data: 'SYSTEM CHALLENGE (stance: critical): the report is not written yet.' },
            context: {
                messageType: SYSTEMLLM_CHALLENGE_MESSAGE_TYPE,
                stance: 'critical',
                challengeId: 'chal-1',
                trigger: 'completion_claim',
                taskId: 'task-1'
            }
        };
        const payload: PayloadFixture = { timestamp: 111222 };

        await invokeHandleChannelMessage(service, eventData, payload);

        expect(addConversationMessage).toHaveBeenCalledTimes(1);
        expect(addConversationMessage).toHaveBeenCalledWith({
            role: 'user',
            content: eventData.content.data,
            metadata: {
                messageType: 'systemllm-challenge',
                source: 'SystemLlmService',
                stance: 'critical',
                challengeId: 'chal-1',
                challengeTrigger: 'completion_claim',
                taskId: 'task-1',
                toAgentId: AGENT_ID,
                requiresResponse: true,
                ephemeral: false,
                timestamp: 111222
            }
        });
        expect(provideImmediateToolFeedback).toHaveBeenCalledTimes(1);
        expect(provideImmediateToolFeedback).toHaveBeenCalledWith(
            'system',
            'systemllm_challenge',
            eventData.content.data,
            'system challenge'
        );
        // The message must land in history before feedback is requested on it.
        expect(addConversationMessage.mock.invocationCallOrder[0])
            .toBeLessThan(provideImmediateToolFeedback.mock.invocationCallOrder[0]);
    });

    it('keeps a challenge addressed to another agent as ephemeral context and skips immediate feedback', async () => {
        const { service, addConversationMessage, provideImmediateToolFeedback } = buildService(AGENT_ID);
        const eventData: ChallengeEventDataFixture = {
            senderId: 'system',
            receiverId: 'other-agent',
            content: { format: 'text', data: 'SYSTEM CHALLENGE (stance: hostile): the plan skips validation.' },
            context: {
                messageType: SYSTEMLLM_CHALLENGE_MESSAGE_TYPE,
                stance: 'hostile',
                challengeId: 'chal-2',
                trigger: 'plan_posted',
                taskId: 'task-2'
            }
        };
        const payload: PayloadFixture = { timestamp: 222333 };

        await invokeHandleChannelMessage(service, eventData, payload);

        expect(addConversationMessage).toHaveBeenCalledTimes(1);
        expect(addConversationMessage).toHaveBeenCalledWith({
            role: 'user',
            content: `${eventData.content.data}\n\n[Note: this challenge is addressed to other-agent, not to you. Context only.]`,
            metadata: {
                messageType: 'systemllm-challenge',
                source: 'SystemLlmService',
                stance: 'hostile',
                challengeId: 'chal-2',
                challengeTrigger: 'plan_posted',
                taskId: 'task-2',
                toAgentId: 'other-agent',
                requiresResponse: false,
                ephemeral: true,
                timestamp: 222333
            }
        });
        expect(provideImmediateToolFeedback).not.toHaveBeenCalled();
    });

    it('keeps a challenge as context only when this agent has no active task to answer it from', async () => {
        // provideImmediateToolFeedback takes no turn without an active task, so
        // the handler must not pretend one happened.
        const { service, addConversationMessage, provideImmediateToolFeedback } = buildService(AGENT_ID, false);
        const eventData: ChallengeEventDataFixture = {
            senderId: 'system',
            receiverId: AGENT_ID,
            content: { format: 'text', data: 'SYSTEM CHALLENGE (stance: critical): late.' },
            context: {
                messageType: SYSTEMLLM_CHALLENGE_MESSAGE_TYPE,
                stance: 'critical',
                challengeId: 'chal-late',
                trigger: 'plan_posted',
                taskId: 'task-9'
            }
        };

        await invokeHandleChannelMessage(service, eventData, { timestamp: 1 });

        expect(addConversationMessage).toHaveBeenCalledWith(expect.objectContaining({
            role: 'user',
            content: 'SYSTEM CHALLENGE (stance: critical): late.\n\n[Note: this challenge arrived after the task ended. Context only.]',
            metadata: expect.objectContaining({
                messageType: 'systemllm-challenge',
                challengeId: 'chal-late',
                requiresResponse: false,
                ephemeral: true
            })
        }));
        expect(provideImmediateToolFeedback).not.toHaveBeenCalled();
    });

    it('keeps an unaddressed challenge as context only, so a whole channel never answers at once', async () => {
        const { service, addConversationMessage, provideImmediateToolFeedback } = buildService(AGENT_ID);
        const eventData: ChallengeEventDataFixture = {
            senderId: 'system',
            content: { format: 'text', data: 'SYSTEM CHALLENGE broadcast to the whole channel.' },
            context: {
                messageType: SYSTEMLLM_CHALLENGE_MESSAGE_TYPE,
                stance: 'critical',
                challengeId: 'chal-3',
                trigger: 'reflection_success',
                taskId: 'task-3'
            }
        };
        const payload: PayloadFixture = { timestamp: 333444 };

        await invokeHandleChannelMessage(service, eventData, payload);

        expect(addConversationMessage).toHaveBeenCalledWith({
            role: 'user',
            content: `${eventData.content.data}\n\n[Note: this challenge is addressed to no agent, not to you. Context only.]`,
            metadata: {
                messageType: 'systemllm-challenge',
                source: 'SystemLlmService',
                stance: 'critical',
                challengeId: 'chal-3',
                challengeTrigger: 'reflection_success',
                taskId: 'task-3',
                toAgentId: undefined,
                requiresResponse: false,
                ephemeral: true,
                timestamp: 333444
            }
        });
        expect(provideImmediateToolFeedback).not.toHaveBeenCalled();
    });

    it('stores a coordination hint as ephemeral context and never requests a response', async () => {
        const { service, addConversationMessage, provideImmediateToolFeedback } = buildService(AGENT_ID);
        const eventData: CoordinationHintEventDataFixture = {
            senderId: 'system',
            content: { data: 'worker-1 and worker-2 are both editing report.md.' },
            context: { source: 'SystemLlmService', messageType: 'coordination_suggestion' }
        };
        const payload: PayloadFixture = { timestamp: 444555 };

        await invokeHandleChannelMessage(service, eventData, payload);

        expect(addConversationMessage).toHaveBeenCalledTimes(1);
        expect(addConversationMessage).toHaveBeenCalledWith({
            role: 'user',
            content: `SYSTEM: ${eventData.content.data}\n\n[Note: This is ephemeral coordination metadata from SystemLLM. Do not respond to this directly.]`,
            metadata: {
                messageType: 'systemllm-coordination',
                source: 'SystemLlmService',
                coordinationType: undefined,
                ephemeral: true,
                isSystemLLM: true,
                doNotTriggerResponse: true,
                timestamp: 444555
            }
        });
        expect(provideImmediateToolFeedback).not.toHaveBeenCalled();
    });

    it('ignores a channel message this agent sent to itself, even one shaped like a challenge', async () => {
        const { service, addConversationMessage, provideImmediateToolFeedback } = buildService(AGENT_ID);
        const eventData: ChallengeEventDataFixture = {
            senderId: AGENT_ID,
            content: { format: 'text', data: 'echoed back to self' },
            context: { messageType: SYSTEMLLM_CHALLENGE_MESSAGE_TYPE }
        };
        const payload: PayloadFixture = { timestamp: 555666 };

        await invokeHandleChannelMessage(service, eventData, payload);

        expect(addConversationMessage).not.toHaveBeenCalled();
        expect(provideImmediateToolFeedback).not.toHaveBeenCalled();
    });
});
