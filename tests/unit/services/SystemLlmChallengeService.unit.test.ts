import type { Subscription } from 'rxjs';

type EventHandler = (payload: unknown) => void;
const mockHandlers = new Map<string, Set<EventHandler>>();
const mockEmit = jest.fn();
const mockGetStance = jest.fn();
const mockIsChannelSystemLlmEnabled = jest.fn();
const mockIsSystemLlmEnabled = jest.fn();
const mockGetServiceForChannel = jest.fn();
const mockIsExhausted = jest.fn();
const mockFindActiveTask = jest.fn();
const mockRecordChallenge = jest.fn();
const mockGetAllOrparStates = jest.fn();
const mockGenerateChallenge = jest.fn();
const mockInject = jest.fn();
const mockSystemLlmInstance = {
    generateChallenge: mockGenerateChallenge,
    injectSystemChallengeMessage: mockInject
};

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn((eventName: string, handler: EventHandler): Subscription => {
                const handlers = mockHandlers.get(eventName) ?? new Set<EventHandler>();
                handlers.add(handler);
                mockHandlers.set(eventName, handlers);
                return {
                    closed: false,
                    unsubscribe: jest.fn(() => handlers.delete(handler))
                } as unknown as Subscription;
            }),
            emit: mockEmit
        }
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        debug = jest.fn();
        info = jest.fn();
        warn = jest.fn();
        error = jest.fn();
    }
}));

jest.mock('@mxf-dev/core/config/ConfigManager', () => ({
    ConfigManager: {
        getInstance: jest.fn(() => ({
            getChannelSystemLlmStance: mockGetStance,
            isChannelSystemLlmEnabled: mockIsChannelSystemLlmEnabled
        }))
    }
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    isSystemLlmEnabled: (): boolean => mockIsSystemLlmEnabled(),
    SystemLlmServiceManager: {
        getInstance: jest.fn(() => ({ getServiceForChannel: mockGetServiceForChannel }))
    }
}));

jest.mock('../../../src/server/socket/services/SystemLlmBudgetService', () => ({
    SystemLlmBudgetService: {
        getInstance: jest.fn(() => ({ isExhausted: mockIsExhausted }))
    }
}));

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: {
        getInstance: jest.fn(() => ({
            findActiveTaskForAgent: mockFindActiveTask,
            recordSystemLlmChallenge: mockRecordChallenge
        }))
    }
}));

jest.mock('@mxf-dev/core/protocols/mcp/tools/OrparTools', () => ({
    getAllOrparStates: mockGetAllOrparStates
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import { OrparEvents } from '@mxf-dev/core/events/event-definitions/OrparEvents';
import type { OrparPlanPayload, OrparReflectPayload } from '@mxf-dev/core/events/event-definitions/OrparEvents';
import type { ChannelTask } from '@mxf-dev/core/types/TaskTypes';
import {
    TASK_METADATA_CHALLENGES_KEY,
    type SystemLlmChallenge
} from '@mxf-dev/core/types/SystemLlmStanceTypes';
import {
    ChallengeUnavailableError,
    SystemLlmChallengeService
} from '../../../src/server/socket/services/SystemLlmChallengeService';
import { EVIDENCE_CAPS } from '../../../src/server/socket/services/SystemLlmEvidence';
import type { ChallengeEvidence } from '../../../src/server/socket/services/SystemLlmStancePrompts';

const deliver = (eventName: string, payload: unknown): void => {
    for (const handler of mockHandlers.get(eventName) ?? []) {
        handler(payload);
    }
};

/** Lets a fire-and-forget async handler (challengeAsync) finish before assertions run. */
const flushAsync = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const task = (overrides: Partial<ChannelTask> = {}): ChannelTask => ({
    id: 'task-1',
    channelId: 'ch-1',
    title: 'Ship the report',
    description: 'Write and publish the quarterly report',
    priority: 'medium',
    assignmentScope: 'single',
    assignedAgentId: 'agent-a',
    assignedAgentIds: ['agent-a'],
    assignmentStrategy: 'manual',
    coordinationMode: 'collaborative',
    status: 'in_progress',
    progress: 10,
    createdBy: 'creator',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
});

const planPayload = (data: Partial<OrparPlanPayload['data']> = {}): OrparPlanPayload => ({
    eventId: 'evt-plan',
    eventType: OrparEvents.PLAN,
    agentId: 'agent-a',
    channelId: 'ch-1',
    timestamp: 1,
    loopId: 'loop-1',
    cycleNumber: 1,
    data: { plan: 'Ship the report by Friday', ...data }
});

const reflectPayload = (data: Partial<OrparReflectPayload['data']> = {}): OrparReflectPayload => ({
    eventId: 'evt-reflect',
    eventType: OrparEvents.REFLECT,
    agentId: 'agent-a',
    channelId: 'ch-1',
    timestamp: 1,
    loopId: 'loop-1',
    cycleNumber: 1,
    data: { reflection: 'Everything worked as expected', ...data }
});

describe('SystemLlmChallengeService', () => {
    let service: SystemLlmChallengeService;

    beforeEach(() => {
        mockHandlers.clear();
        mockEmit.mockClear();
        mockGetStance.mockReset();
        mockIsChannelSystemLlmEnabled.mockReset();
        mockIsChannelSystemLlmEnabled.mockReturnValue(true);
        mockIsSystemLlmEnabled.mockReset();
        mockIsSystemLlmEnabled.mockReturnValue(true);
        mockGetServiceForChannel.mockReset();
        mockIsExhausted.mockReset();
        mockIsExhausted.mockReturnValue(false);
        mockFindActiveTask.mockReset();
        mockRecordChallenge.mockReset();
        mockRecordChallenge.mockResolvedValue(true);
        mockGetAllOrparStates.mockReset();
        mockGetAllOrparStates.mockReturnValue(new Map());
        mockGenerateChallenge.mockReset();
        mockInject.mockReset();
        service = SystemLlmChallengeService.getInstance();
    });

    afterEach(() => {
        service.shutdown();
    });

    it('supportive stance leaves completion claims unchallenged and ignores plan events', async () => {
        mockGetStance.mockReturnValue('supportive');

        await expect(service.challengeCompletionClaim({
            task: task(),
            agentId: 'agent-a',
            channelId: 'ch-1',
            summary: 'Task done'
        })).resolves.toBeNull();
        expect(mockGenerateChallenge).not.toHaveBeenCalled();
        expect(mockGetServiceForChannel).not.toHaveBeenCalled();

        service.start();
        deliver(OrparEvents.PLAN, planPayload());
        await flushAsync();

        expect(mockFindActiveTask).not.toHaveBeenCalled();
        expect(mockGenerateChallenge).not.toHaveBeenCalled();
    });

    it('does not record or emit when the critic finds nothing to dispute', async () => {
        mockGetStance.mockReturnValue('critical');
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
        mockGenerateChallenge.mockResolvedValue({ challenge: false, summary: '', points: [] });

        await expect(service.challengeCompletionClaim({
            task: task(),
            agentId: 'agent-a',
            channelId: 'ch-1',
            summary: 'Task done'
        })).resolves.toBeNull();

        expect(mockRecordChallenge).not.toHaveBeenCalled();
        expect(mockEmit).not.toHaveBeenCalled();
    });

    it('returns, records, and emits a critical completion challenge built from the evidence', async () => {
        mockGetStance.mockReturnValue('critical');
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
        mockGetAllOrparStates.mockReturnValue(new Map([
            ['agent-a:ch-1', {
                currentPhase: 'reflect',
                loopId: 'loop-1',
                cycleCount: 1,
                lastUpdated: 1,
                phaseHistory: [
                    { phase: 'observe', timestamp: 1, content: 'Looked at the report draft' },
                    { phase: 'reason', timestamp: 2, content: 'Decided it was ready' }
                ]
            }]
        ]));
        mockGenerateChallenge.mockResolvedValue({
            challenge: true,
            summary: 'Two claims lack evidence',
            points: [
                { claim: 'report is published', problem: 'no publish tool call', evidenceNeeded: 'a file_write or publish result' },
                { claim: 'stakeholders notified', problem: 'no message shows this', evidenceNeeded: 'a channel message to stakeholders' }
            ]
        });

        const result = await service.challengeCompletionClaim({
            task: task({ id: 'task-1', channelId: 'ch-1', title: 'Ship the report' }),
            agentId: 'agent-a',
            channelId: 'ch-1',
            summary: 'Report is published and stakeholders were notified',
            details: { filesChanged: 3 }
        });

        expect(result).toEqual(expect.objectContaining({
            channelId: 'ch-1',
            agentId: 'agent-a',
            taskId: 'task-1',
            trigger: 'completion_claim',
            stance: 'critical',
            delivery: 'tool_result',
            summary: 'Two claims lack evidence',
            points: [
                { claim: 'report is published', problem: 'no publish tool call', evidenceNeeded: 'a file_write or publish result' },
                { claim: 'stakeholders notified', problem: 'no message shows this', evidenceNeeded: 'a channel message to stakeholders' }
            ]
        }));
        expect(result?.id).toEqual(expect.any(String));

        expect(mockRecordChallenge).toHaveBeenCalledWith('task-1', 'ch-1', expect.objectContaining({
            id: result?.id,
            trigger: 'completion_claim',
            stance: 'critical',
            delivery: 'tool_result',
            summary: 'Two claims lack evidence',
            points: result?.points
        }));

        expect(mockEmit).toHaveBeenCalledTimes(1);
        expect(mockEmit).toHaveBeenCalledWith(
            Events.System.SYSTEMLLM_CHALLENGE_ISSUED,
            expect.objectContaining({
                agentId: 'agent-a',
                channelId: 'ch-1',
                data: expect.objectContaining({
                    challengeId: result?.id,
                    taskId: 'task-1',
                    trigger: 'completion_claim',
                    stance: 'critical',
                    delivery: 'tool_result',
                    summary: 'Two claims lack evidence'
                })
            })
        );

        expect(mockGenerateChallenge).toHaveBeenCalledWith('critical', 'completion_claim', expect.objectContaining({
            task: expect.objectContaining({ title: 'Ship the report' }),
            agentId: 'agent-a',
            claim: 'Report is published and stakeholders were notified',
            claimDetails: JSON.stringify({ filesChanged: 3 }),
            orparHistory: [
                { phase: 'observe', content: 'Looked at the report draft' },
                { phase: 'reason', content: 'Decided it was ready' }
            ]
        }));
    });

    it('challenges each trigger at most once per task, independently of other triggers', async () => {
        mockGetStance.mockReturnValue('critical');
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);

        const alreadyChallenged = task({
            metadata: {
                [TASK_METADATA_CHALLENGES_KEY]: [
                    { id: 'prev-1', trigger: 'completion_claim', stance: 'critical', delivery: 'tool_result', summary: 'earlier', points: [], createdAt: 1 }
                ]
            }
        });
        await expect(service.challengeCompletionClaim({
            task: alreadyChallenged,
            agentId: 'agent-a',
            channelId: 'ch-1',
            summary: 'done again'
        })).resolves.toBeNull();
        expect(mockGenerateChallenge).not.toHaveBeenCalled();

        const onlyPlanChallenged = task({
            metadata: {
                [TASK_METADATA_CHALLENGES_KEY]: [
                    { id: 'prev-2', trigger: 'plan_posted', stance: 'critical', delivery: 'channel_message', summary: 'earlier plan', points: [], createdAt: 1 }
                ]
            }
        });
        mockGenerateChallenge.mockResolvedValue({ challenge: false, summary: '', points: [] });
        await expect(service.challengeCompletionClaim({
            task: onlyPlanChallenged,
            agentId: 'agent-a',
            channelId: 'ch-1',
            summary: 'done'
        })).resolves.toBeNull();
        expect(mockGenerateChallenge).toHaveBeenCalledTimes(1);
        expect(mockGenerateChallenge).toHaveBeenCalledWith('critical', 'completion_claim', expect.anything());
    });

    it('issues a hostile challenge tagged with the hostile stance', async () => {
        mockGetStance.mockReturnValue('hostile');
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
        mockGenerateChallenge.mockResolvedValue({
            challenge: true,
            summary: 'Plausible but wrong objection',
            points: [{ claim: 'x', problem: 'y', evidenceNeeded: 'z' }]
        });

        const result = await service.challengeCompletionClaim({
            task: task(),
            agentId: 'agent-a',
            channelId: 'ch-1',
            summary: 'Task done'
        });

        expect(result?.stance).toBe('hostile');
        expect(mockEmit).toHaveBeenCalledWith(
            Events.System.SYSTEMLLM_CHALLENGE_ISSUED,
            expect.objectContaining({ data: expect.objectContaining({ stance: 'hostile' }) })
        );
    });

    describe('when SystemLLM is unavailable', () => {
        it('throws mentioning the budget when a completion challenge is required and the budget is spent', async () => {
            mockGetStance.mockReturnValue('critical');
            mockGetServiceForChannel.mockReturnValue(null);
            mockIsExhausted.mockReturnValue(true);

            const attempt = service.challengeCompletionClaim({
                task: task(),
                agentId: 'agent-a',
                channelId: 'ch-1',
                summary: 'Task done'
            });
            await expect(attempt).rejects.toThrow(ChallengeUnavailableError);
            await expect(attempt).rejects.toThrow(/budget/i);
        });

        it('resolves null when SystemLLM is off for the channel', async () => {
            mockGetStance.mockReturnValue('critical');
            mockIsChannelSystemLlmEnabled.mockReturnValue(false);
            mockGetServiceForChannel.mockReturnValue(null);
            mockIsExhausted.mockReturnValue(false);

            await expect(service.challengeCompletionClaim({
                task: task(),
                agentId: 'agent-a',
                channelId: 'ch-1',
                summary: 'Task done'
            })).resolves.toBeNull();
            expect(mockGetServiceForChannel).not.toHaveBeenCalled();
        });

        it('never blocks a channel that opted out of SystemLLM, even with the budget spent', async () => {
            // getServiceForChannel returns null for "off" and "budget spent"
            // alike; the off check must come first so other channels' spend
            // cannot stop this one's task_complete.
            mockGetStance.mockReturnValue('critical');
            mockIsChannelSystemLlmEnabled.mockReturnValue(false);
            mockGetServiceForChannel.mockReturnValue(null);
            mockIsExhausted.mockReturnValue(true);

            await expect(service.challengeCompletionClaim({
                task: task(),
                agentId: 'agent-a',
                channelId: 'ch-1',
                summary: 'Task done'
            })).resolves.toBeNull();
        });

        it('resolves null when SystemLLM is off for the whole server', async () => {
            mockGetStance.mockReturnValue('critical');
            mockIsSystemLlmEnabled.mockReturnValue(false);
            mockIsExhausted.mockReturnValue(true);

            await expect(service.challengeCompletionClaim({
                task: task(),
                agentId: 'agent-a',
                channelId: 'ch-1',
                summary: 'Task done'
            })).resolves.toBeNull();
        });

        it('throws when SystemLLM is on and under budget but no service can be had', async () => {
            mockGetStance.mockReturnValue('critical');
            mockGetServiceForChannel.mockReturnValue(null);
            mockIsExhausted.mockReturnValue(false);

            const attempt = service.challengeCompletionClaim({
                task: task(),
                agentId: 'agent-a',
                channelId: 'ch-1',
                summary: 'Task done'
            });
            await expect(attempt).rejects.toThrow(ChallengeUnavailableError);
            await expect(attempt).rejects.toThrow(/unavailable/);
        });
    });

    it('wraps a generateChallenge failure in ChallengeUnavailableError without recording or emitting', async () => {
        mockGetStance.mockReturnValue('critical');
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
        mockGenerateChallenge.mockRejectedValue(new Error('Challenge response is a degraded fallback, not a model reply'));

        const attempt = service.challengeCompletionClaim({
            task: task(),
            agentId: 'agent-a',
            channelId: 'ch-1',
            summary: 'Task done'
        });
        await expect(attempt).rejects.toThrow(ChallengeUnavailableError);
        await expect(attempt).rejects.toThrow(/degraded fallback/);

        expect(mockRecordChallenge).not.toHaveBeenCalled();
        expect(mockEmit).not.toHaveBeenCalled();
    });

    it('drops a challenge that lost the once-per-trigger write to an overlapping claim', async () => {
        // The record write is conditional on no record for the trigger. When it
        // reports that one already exists, the earlier challenge stands and this
        // one is neither announced nor returned.
        mockGetStance.mockReturnValue('critical');
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
        mockGenerateChallenge.mockResolvedValue({
            challenge: true,
            summary: 'Late duplicate',
            points: [{ claim: 'done', problem: 'no evidence', evidenceNeeded: 'a tool result' }]
        });
        mockRecordChallenge.mockResolvedValue(false);

        const result = await service.challengeCompletionClaim({
            task: task(),
            agentId: 'agent-a',
            channelId: 'ch-1',
            summary: 'Task done'
        });

        expect(result).toBeNull();
        expect(mockRecordChallenge).toHaveBeenCalledTimes(1);
        expect(mockEmit).not.toHaveBeenCalled();
    });

    describe('async plan path', () => {
        it('challenges a posted plan and delivers it as a channel message', async () => {
            service.start();
            mockGetStance.mockReturnValue('critical');
            mockFindActiveTask.mockResolvedValue(task());
            mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
            mockGenerateChallenge.mockResolvedValue({
                challenge: true,
                summary: 'The plan skips verification',
                points: [{ claim: 'ship it', problem: 'no verification step', evidenceNeeded: 'a test run' }]
            });

            deliver(OrparEvents.PLAN, planPayload({ plan: 'Ship the report by Friday' }));
            await flushAsync();

            expect(mockGenerateChallenge).toHaveBeenCalledWith(
                'critical',
                'plan_posted',
                expect.objectContaining({ claim: 'Ship the report by Friday' })
            );
            expect(mockInject).toHaveBeenCalledTimes(1);
            const [deliveredChallenge, text] = mockInject.mock.calls[0] as [SystemLlmChallenge, string];
            expect(deliveredChallenge.delivery).toBe('channel_message');
            expect(deliveredChallenge.trigger).toBe('plan_posted');
            expect(text).toMatch(/^SYSTEM CHALLENGE/);
            expect(mockEmit).toHaveBeenCalledTimes(1);
        });

        it('does not challenge a plan when the agent has no active task', async () => {
            service.start();
            mockGetStance.mockReturnValue('critical');
            mockFindActiveTask.mockResolvedValue(null);

            deliver(OrparEvents.PLAN, planPayload());
            await flushAsync();

            expect(mockGenerateChallenge).not.toHaveBeenCalled();
        });

        it('neither delivers nor announces a challenge whose task ended while the model was answering', async () => {
            // The agent can finish the task during the challenge round trip; a
            // challenge delivered then would never be answered. The record stays
            // as audit trail, but nothing is sent or announced as "issued".
            service.start();
            mockGetStance.mockReturnValue('critical');
            mockFindActiveTask
                .mockResolvedValueOnce(task())
                .mockResolvedValueOnce(null);
            mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
            mockGenerateChallenge.mockResolvedValue({
                challenge: true,
                summary: 'Too late',
                points: [{ claim: 'ship it', problem: 'no verification step', evidenceNeeded: 'a test run' }]
            });

            deliver(OrparEvents.PLAN, planPayload());
            await flushAsync();

            expect(mockRecordChallenge).toHaveBeenCalledTimes(1);
            expect(mockInject).not.toHaveBeenCalled();
            expect(mockEmit).not.toHaveBeenCalled();
        });

        it('announces an async challenge only after it has been injected', async () => {
            service.start();
            mockGetStance.mockReturnValue('critical');
            mockFindActiveTask.mockResolvedValue(task());
            mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
            mockGenerateChallenge.mockResolvedValue({
                challenge: true,
                summary: 'Order matters',
                points: [{ claim: 'ship it', problem: 'no verification step', evidenceNeeded: 'a test run' }]
            });

            deliver(OrparEvents.PLAN, planPayload());
            await flushAsync();

            expect(mockInject).toHaveBeenCalledTimes(1);
            expect(mockEmit).toHaveBeenCalledTimes(1);
            expect(mockInject.mock.invocationCallOrder[0]).toBeLessThan(mockEmit.mock.invocationCallOrder[0]);
        });
    });

    describe('async reflect path', () => {
        it('does not challenge a reflection that already reports missed expectations', async () => {
            service.start();
            mockGetStance.mockReturnValue('critical');

            deliver(OrparEvents.REFLECT, reflectPayload({ expectationsMet: false }));
            await flushAsync();

            expect(mockFindActiveTask).not.toHaveBeenCalled();
            expect(mockGenerateChallenge).not.toHaveBeenCalled();
        });

        it('challenges a reflection that does not report missed expectations', async () => {
            service.start();
            mockGetStance.mockReturnValue('critical');
            mockFindActiveTask.mockResolvedValue(task());
            mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
            mockGenerateChallenge.mockResolvedValue({ challenge: false, summary: '', points: [] });

            deliver(OrparEvents.REFLECT, reflectPayload());
            await flushAsync();

            expect(mockGenerateChallenge).toHaveBeenCalledWith('critical', 'reflection_success', expect.anything());
        });
    });

    it('logs an async-path failure instead of throwing and does not deliver anything', async () => {
        service.start();
        mockGetStance.mockReturnValue('critical');
        mockFindActiveTask.mockResolvedValue(task());
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
        mockGenerateChallenge.mockRejectedValue(new Error('provider unavailable'));

        expect(() => deliver(OrparEvents.PLAN, planPayload())).not.toThrow();
        await flushAsync();

        expect(mockInject).not.toHaveBeenCalled();
    });

    it('bounds tool-call and message evidence per channel and agent', async () => {
        // Evidence is only kept for channels whose stance can use it.
        mockGetStance.mockReturnValue('critical');
        service.start();

        const totalCalls = EVIDENCE_CAPS.toolCalls + 2;
        for (let i = 1; i <= totalCalls; i++) {
            const isLast = i === totalCalls;
            deliver(Events.Mcp.TOOL_RESULT, {
                agentId: 'a',
                channelId: 'c',
                data: {
                    toolName: `tool-${i}`,
                    callId: `call-${i}`,
                    result: isLast ? 'x'.repeat(EVIDENCE_CAPS.toolResultChars + 100) : `result-${i}`
                }
            });
        }
        deliver(Events.Mcp.TOOL_RESULT, {
            agentId: 'b',
            channelId: 'c',
            data: { toolName: 'other-agent-tool', callId: 'call-b', result: 'irrelevant' }
        });

        deliver(Events.Message.AGENT_MESSAGE_DELIVERED, {
            channelId: 'c',
            data: { fromAgentId: 'b', toAgentId: 'a', content: 'hello', timestamp: 1 }
        });
        deliver(Events.Message.CHANNEL_MESSAGE, {
            channelId: 'c',
            data: {
                messageId: 'sys-1',
                senderId: 'system',
                content: { format: 'text', data: 'hint' },
                timestamp: 1,
                type: 'system'
            }
        });

        mockGetStance.mockReturnValue('critical');
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
        mockGenerateChallenge.mockResolvedValue({ challenge: false, summary: '', points: [] });

        await service.challengeCompletionClaim({
            task: task({ id: 'task-1', channelId: 'c' }),
            agentId: 'a',
            channelId: 'c',
            summary: 'done'
        });

        expect(mockGenerateChallenge).toHaveBeenCalledTimes(1);
        const evidence = mockGenerateChallenge.mock.calls[0][2] as ChallengeEvidence;

        expect(evidence.toolCalls).toHaveLength(EVIDENCE_CAPS.toolCalls);
        expect(evidence.toolCalls[0].toolName).toBe('tool-3');
        expect(evidence.toolCalls[evidence.toolCalls.length - 1].result).toEqual(expect.stringContaining('[truncated'));

        expect(evidence.messages).toEqual([{ agentId: 'b', content: 'hello' }]);
    });

    const deliverEvidence = (channelId: string, agentId: string): void => {
        deliver(Events.Mcp.TOOL_RESULT, {
            agentId,
            channelId,
            data: { toolName: 'file_write', callId: 'call-1', result: 'ok' }
        });
        deliver(Events.Message.AGENT_MESSAGE_DELIVERED, {
            channelId,
            data: { fromAgentId: agentId, toAgentId: 'lead', content: 'wrote it', timestamp: 1 }
        });
    };

    const claimEvidence = async (channelId: string, agentId: string): Promise<ChallengeEvidence> => {
        mockGetStance.mockReturnValue('critical');
        mockGetServiceForChannel.mockReturnValue(mockSystemLlmInstance);
        mockGenerateChallenge.mockResolvedValue({ challenge: false, summary: '', points: [] });
        await service.challengeCompletionClaim({
            task: task({ id: `task-${channelId}`, channelId }),
            agentId,
            channelId,
            summary: 'done'
        });
        return mockGenerateChallenge.mock.calls[mockGenerateChallenge.mock.calls.length - 1][2] as ChallengeEvidence;
    };

    it('keeps a failed tool call as evidence too', async () => {
        // The executor answers a tool that threw or was refused with TOOL_ERROR,
        // never TOOL_RESULT; a critical stance has to see that the agent's
        // fetch failed, not only the calls that succeeded.
        mockGetStance.mockReturnValue('critical');
        service.start();
        deliver(Events.Mcp.TOOL_ERROR, {
            agentId: 'a',
            channelId: 'c',
            data: { toolName: 'fetch_feed', callId: 'call-1', error: 'Tool execution error: feed unreachable' }
        });

        const evidence = await claimEvidence('c', 'a');

        expect(evidence.toolCalls).toEqual([
            { agentId: 'a', toolName: 'fetch_feed', result: 'failed: Tool execution error: feed unreachable' }
        ]);
    });

    it('quotes only broadcasts and the agent\'s own direct messages, never a private exchange between others', async () => {
        mockGetStance.mockReturnValue('critical');
        service.start();
        deliver(Events.Message.AGENT_MESSAGE_DELIVERED, {
            channelId: 'c',
            data: { fromAgentId: 'b', toAgentId: 'x', content: 'private between b and x', timestamp: 1 }
        });
        deliver(Events.Message.AGENT_MESSAGE_DELIVERED, {
            channelId: 'c',
            data: { fromAgentId: 'b', toAgentId: 'a', content: 'b to a', timestamp: 2 }
        });
        deliver(Events.Message.AGENT_MESSAGE_DELIVERED, {
            channelId: 'c',
            data: { fromAgentId: 'a', toAgentId: 'x', content: 'a to x', timestamp: 3 }
        });
        deliver(Events.Message.CHANNEL_MESSAGE, {
            channelId: 'c',
            data: { messageId: 'm1', senderId: 'x', content: { format: 'text', data: 'broadcast' }, timestamp: 4, type: 'text' }
        });

        const evidence = await claimEvidence('c', 'a');

        expect(evidence.messages).toEqual([
            { agentId: 'b', content: 'b to a' },
            { agentId: 'a', content: 'a to x' },
            { agentId: 'x', content: 'broadcast' }
        ]);
    });

    it('keeps no evidence for a channel in supportive stance', async () => {
        // A supportive deployment pays nothing for the feature. Switching the
        // channel to critical later starts collection from that moment.
        mockGetStance.mockReturnValue('supportive');
        service.start();
        deliverEvidence('c', 'a');

        const evidence = await claimEvidence('c', 'a');

        expect(evidence.toolCalls).toEqual([]);
        expect(evidence.messages).toEqual([]);
    });

    it('drops a channel\'s evidence when the channel is deleted or archived', async () => {
        mockGetStance.mockReturnValue('critical');
        service.start();
        deliverEvidence('c', 'a');
        deliverEvidence('d', 'a');

        deliver(Events.Channel.DELETED, { channelId: 'c', agentId: 'admin', data: {} });

        const gone = await claimEvidence('c', 'a');
        expect(gone.toolCalls).toEqual([]);
        expect(gone.messages).toEqual([]);

        const kept = await claimEvidence('d', 'a');
        expect(kept.toolCalls).toHaveLength(1);
        expect(kept.messages).toHaveLength(1);
    });

    it('drops an agent\'s tool calls in every channel when it disconnects, keeping the channel messages', async () => {
        mockGetStance.mockReturnValue('critical');
        service.start();
        deliverEvidence('c', 'a');
        deliverEvidence('d', 'a');

        deliver(Events.Agent.DISCONNECTED, { agentId: 'a', channelId: 'c', data: {} });

        const inC = await claimEvidence('c', 'a');
        expect(inC.toolCalls).toEqual([]);
        expect(inC.messages).toHaveLength(1);
        const inD = await claimEvidence('d', 'a');
        expect(inD.toolCalls).toEqual([]);
    });
});
