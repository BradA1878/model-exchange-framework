import type { Subscription } from 'rxjs';

type EventHandler = (payload: unknown) => void;
const mockHandlers = new Map<string, Set<EventHandler>>();
const mockEmit = jest.fn();
const mockPlanFindOne = jest.fn();
const mockGetServiceForChannel = jest.fn();

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

jest.mock('@mxf-dev/core/models/plan', () => ({
    __esModule: true,
    default: { findOne: mockPlanFindOne }
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: {
        getInstance: jest.fn(() => ({ getServiceForChannel: mockGetServiceForChannel }))
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

import { Events } from '@mxf-dev/core/events/EventNames';
import type { TaskCompletionConfig } from '@mxf-dev/core/types/TaskCompletionTypes';
import type { ChannelTask } from '@mxf-dev/core/types/TaskTypes';
import {
    MonitoredTaskTransition,
    TaskCompletionMonitoringService
} from '../../../src/server/socket/services/TaskCompletionMonitoringService';

const deliver = (eventName: string, payload: unknown): void => {
    for (const handler of mockHandlers.get(eventName) ?? []) {
        handler(payload);
    }
};

const task = (channelId: string, taskId = 'same-task'): ChannelTask => ({
    id: taskId,
    channelId,
    title: 'Exact task',
    description: 'Must not cross channels',
    priority: 'medium',
    assignmentScope: 'single',
    assignedAgentId: 'worker',
    assignedAgentIds: ['worker'],
    assignmentStrategy: 'manual',
    coordinationMode: 'collaborative',
    status: 'in_progress',
    progress: 10,
    createdBy: 'creator',
    createdAt: 1,
    updatedAt: 1
});

const outputConfig: TaskCompletionConfig = {
    primary: {
        type: 'output-based',
        requiredOutputs: [{ type: 'tool_call', count: 1 }]
    }
};

describe('TaskCompletionMonitoringService correctness', () => {
    let service: TaskCompletionMonitoringService;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000);
        mockHandlers.clear();
        mockEmit.mockClear();
        mockPlanFindOne.mockReset();
        mockGetServiceForChannel.mockReset();
        mockGetServiceForChannel.mockReturnValue(null);
        service = TaskCompletionMonitoringService.getInstance();
    });

    afterEach(() => {
        service.shutdown();
        jest.useRealTimers();
    });

    it('keeps equal task ids isolated by channel and records only official tool-result evidence', async () => {
        const transitionA = jest.fn(async (transition: MonitoredTaskTransition) => ({
            ...task('channel-a'),
            status: transition.status,
            progress: transition.progress,
            result: transition.result
        }));
        const transitionB = jest.fn(async (transition: MonitoredTaskTransition) => ({
            ...task('channel-b'),
            status: transition.status,
            progress: transition.progress,
            result: transition.result
        }));

        service.startMonitoring(task('channel-a'), outputConfig, transitionA);
        service.startMonitoring(task('channel-b'), outputConfig, transitionB);
        await Promise.resolve();

        deliver(Events.Mcp.TOOL_RESULT, {
            agentId: 'worker',
            channelId: 'channel-a',
            data: { toolName: 'verified_tool', callId: 'call-1', result: { ok: true } }
        });
        await jest.advanceTimersByTimeAsync(30_000);

        expect(transitionA).toHaveBeenCalledTimes(1);
        expect(transitionA).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 'same-task',
            channelId: 'channel-a',
            status: 'completed'
        }));
        expect(transitionB).not.toHaveBeenCalled();
        expect(service.getMonitoringStatus('channel-a', 'same-task').active).toBe(false);
        expect(service.getMonitoringStatus('channel-b', 'same-task').active).toBe(true);
    });

    it('does not guess which same-channel task produced activity', async () => {
        const firstTransition = jest.fn();
        const secondTransition = jest.fn();
        service.startMonitoring(task('channel-a', 'task-1'), outputConfig, firstTransition);
        service.startMonitoring(task('channel-a', 'task-2'), outputConfig, secondTransition);
        await Promise.resolve();

        deliver(Events.Mcp.TOOL_RESULT, {
            agentId: 'worker',
            channelId: 'channel-a',
            data: { toolName: 'ambiguous_tool', callId: 'call-2', result: {} }
        });
        await jest.advanceTimersByTimeAsync(30_000);

        expect(firstTransition).not.toHaveBeenCalled();
        expect(secondTransition).not.toHaveBeenCalled();
    });

    it('owns and tears down its official EventBus subscriptions and timers', () => {
        service.startMonitoring(task('channel-a'), outputConfig, jest.fn());

        expect(mockHandlers.has(Events.Message.AGENT_MESSAGE_DELIVERED)).toBe(true);
        expect(mockHandlers.has(Events.Mcp.TOOL_RESULT)).toBe(true);
        expect(mockHandlers.has(Events.Plan.PLAN_STEP_COMPLETED)).toBe(true);
        expect(jest.getTimerCount()).toBe(1);

        service.shutdown();

        expect(Array.from(mockHandlers.values()).every(handlers => handlers.size === 0)).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('returns a fresh live singleton after shutdown and rejects stale references', () => {
        const stoppedService = service;
        stoppedService.shutdown();
        expect(TaskCompletionMonitoringService.shutdownExisting()).toBe(false);

        const restartedService = TaskCompletionMonitoringService.getInstance();
        expect(restartedService).not.toBe(stoppedService);
        expect(() => stoppedService.startMonitoring(
            task('channel-a'),
            outputConfig,
            jest.fn()
        )).toThrow(/shut down/i);

        restartedService.startMonitoring(task('channel-a'), outputConfig, jest.fn());
        expect(restartedService.getMonitoringStatus('channel-a', 'same-task').active).toBe(true);
        expect(TaskCompletionMonitoringService.shutdownExisting()).toBe(true);
        expect(TaskCompletionMonitoringService.shutdownExisting()).toBe(false);
    });

    it('rejects malformed output patterns before a task is persisted or monitored', () => {
        expect(() => service.assertValidConfig({
            primary: {
                type: 'output-based',
                requiredOutputs: [{ type: 'message', pattern: '[unterminated' }]
            }
        })).toThrow(/invalid output pattern/i);

        expect(jest.getTimerCount()).toBe(0);
    });

    it.each([
        {
            name: 'provider rejection',
            response: (): Promise<string> => Promise.reject(new Error('provider unavailable')),
            expectedReason: /provider unavailable/
        },
        {
            name: 'malformed provider response',
            response: (): Promise<string> => Promise.resolve('probably complete'),
            expectedReason: /required format/
        }
    ])('fails once and stops monitoring after a $name', async ({ response, expectedReason }) => {
        const sendLlmRequest = jest.fn().mockImplementation(response);
        mockGetServiceForChannel.mockReturnValue({
            getModelForOperation: jest.fn().mockReturnValue('test-model'),
            sendLlmRequest
        });
        const transition = jest.fn(async (requested: MonitoredTaskTransition) => ({
            ...task('channel-a'),
            status: requested.status,
            progress: requested.progress,
            result: requested.result
        }));

        service.startMonitoring(task('channel-a'), {
            primary: {
                type: 'systemllm-eval',
                objectives: ['Produce the required result'],
                evaluationInterval: 1_000,
                confidenceThreshold: 0.8,
                maxEvaluations: 3
            }
        }, transition);
        await jest.advanceTimersByTimeAsync(0);

        expect(transition).toHaveBeenCalledTimes(1);
        expect(transition).toHaveBeenCalledWith(expect.objectContaining({
            channelId: 'channel-a',
            taskId: 'same-task',
            status: 'failed',
            result: expect.objectContaining({ error: expect.stringMatching(expectedReason) })
        }));
        expect(service.getMonitoringStatus('channel-a', 'same-task').active).toBe(false);

        await jest.advanceTimersByTimeAsync(60_000);
        expect(sendLlmRequest).toHaveBeenCalledTimes(1);
        expect(transition).toHaveBeenCalledTimes(1);
    });

    it('fails an evaluator immediately when its channel has no SystemLLM service', async () => {
        const transition = jest.fn(async (requested: MonitoredTaskTransition) => ({
            ...task('channel-a'),
            status: requested.status,
            progress: requested.progress,
            result: requested.result
        }));

        service.startMonitoring(task('channel-a'), {
            primary: {
                type: 'systemllm-eval',
                objectives: ['Produce the required result'],
                evaluationInterval: 1_000,
                confidenceThreshold: 0.8,
                maxEvaluations: 3
            }
        }, transition);
        await jest.advanceTimersByTimeAsync(0);

        expect(transition).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            result: expect.objectContaining({
                error: expect.stringMatching(/SystemLLM is unavailable for channel channel-a/)
            })
        }));
        expect(service.getMonitoringStatus('channel-a', 'same-task').active).toBe(false);
    });

    it('enforces the configured SystemLLM evaluation budget', async () => {
        const sendLlmRequest = jest.fn().mockResolvedValue(
            '<complete>NO</complete><confidence>0.9</confidence><reason>Work remains</reason>'
        );
        mockGetServiceForChannel.mockReturnValue({
            getModelForOperation: jest.fn().mockReturnValue('test-model'),
            sendLlmRequest
        });
        const transition = jest.fn(async (requested: MonitoredTaskTransition) => ({
            ...task('channel-a'),
            status: requested.status,
            progress: requested.progress,
            result: requested.result
        }));

        service.startMonitoring(task('channel-a'), {
            primary: {
                type: 'systemllm-eval',
                objectives: ['Produce the required result'],
                evaluationInterval: 1_000,
                confidenceThreshold: 0.8,
                maxEvaluations: 2
            }
        }, transition);
        await jest.advanceTimersByTimeAsync(1_000);

        expect(sendLlmRequest).toHaveBeenCalledTimes(2);
        expect(transition).toHaveBeenCalledTimes(1);
        expect(transition).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            result: expect.objectContaining({
                error: 'SystemLLM evaluation budget exhausted after 2 attempts'
            })
        }));

        await jest.advanceTimersByTimeAsync(60_000);
        expect(sendLlmRequest).toHaveBeenCalledTimes(2);
    });
});
