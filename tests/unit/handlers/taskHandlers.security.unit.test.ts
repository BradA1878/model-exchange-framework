const mockCreateTask = jest.fn();
const mockUpdateTaskInChannel = jest.fn();
const mockAssignTaskInChannel = jest.fn();
const mockAssignTaskIntelligentlyInChannel = jest.fn();
const mockTransitionTaskInChannel = jest.fn();
const mockGetTasks = jest.fn();
const eventHandlers = new Map<string, (payload: unknown) => Promise<void> | void>();
const handlerSubscriptions: Array<{ unsubscribe: jest.Mock }> = [];

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn((event: string, handler: (payload: unknown) => Promise<void> | void) => {
                eventHandlers.set(event, handler);
                const subscription = {
                    unsubscribe: jest.fn((): void => {
                        if (eventHandlers.get(event) === handler) {
                            eventHandlers.delete(event);
                        }
                    })
                };
                handlerSubscriptions.push(subscription);
                return subscription;
            }),
            emit: jest.fn()
        }
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        error = jest.fn();
        warn = jest.fn();
        info = jest.fn();
        debug = jest.fn();
    }
}));

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: {
        getInstance: (): Record<string, jest.Mock> => ({
            createTask: mockCreateTask,
            updateTaskInChannel: mockUpdateTaskInChannel,
            assignTaskInChannel: mockAssignTaskInChannel,
            transitionTaskInChannel: mockTransitionTaskInChannel,
            assignTaskIntelligentlyInChannel: mockAssignTaskIntelligentlyInChannel,
            getTasks: mockGetTasks
        })
    }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import {
    initializeTaskHandlers,
    registerTaskHandlers,
    shutdownTaskHandlers
} from '../../../src/server/socket/handlers/taskHandlers';

describe('socket task creation identity', () => {
    beforeAll(() => {
        // Cold REST/MCP execution must not depend on an agent socket having
        // connected first.
        initializeTaskHandlers();
        registerTaskHandlers(
            { on: jest.fn() } as never,
            'trusted-agent',
            'channel-a'
        );
    });

    it('registers the global create handler before any socket is required', () => {
        expect(eventHandlers.get(TaskEvents.CREATE_REQUEST)).toBeDefined();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockCreateTask.mockResolvedValue({ id: 'task-1' });
        mockAssignTaskIntelligentlyInChannel.mockResolvedValue({
            taskId: 'task-1',
            assignedAgentId: 'trusted-agent'
        });
        mockGetTasks.mockResolvedValue([]);
    });

    it('attributes CREATE_REQUEST only to the authenticated outer agent', async () => {
        const handler = eventHandlers.get(TaskEvents.CREATE_REQUEST);
        expect(handler).toBeDefined();

        await handler!({
            agentId: 'trusted-agent',
            channelId: 'channel-a',
            data: {
                taskId: 'request-1',
                task: {
                    title: 'Security review',
                    description: 'Review task ingress',
                    assignedAgentIds: ['trusted-agent', 'reviewer-agent'],
                    completionAgentId: 'reviewer-agent',
                    createdBy: 'victim-agent'
                }
            }
        });

        expect(mockCreateTask).toHaveBeenCalledWith(
            expect.not.objectContaining({ createdBy: expect.anything() }),
            'trusted-agent',
            'request-1'
        );
        expect(mockCreateTask).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: 'channel-a',
                title: 'Security review',
                description: 'Review task ingress',
                assignedAgentIds: ['trusted-agent', 'reviewer-agent'],
                completionAgentId: 'reviewer-agent'
            }),
            'trusted-agent',
            'request-1'
        );
    });

    it('runs intelligent assignment once without re-emitting its ingress request', async () => {
        const handler = eventHandlers.get(TaskEvents.ASSIGNMENT_REQUESTED);
        expect(handler).toBeDefined();

        await handler!({
            agentId: 'trusted-agent',
            channelId: 'channel-a',
            data: {
                taskId: 'task-1',
                requestId: 'assignment-request-1',
                task: 'assign task-1 intelligently'
            }
        });

        expect(mockAssignTaskIntelligentlyInChannel).toHaveBeenCalledTimes(1);
        expect(mockAssignTaskIntelligentlyInChannel).toHaveBeenCalledWith(
            'task-1',
            'channel-a'
        );
        expect(EventBus.server.emit).not.toHaveBeenCalledWith(
            TaskEvents.ASSIGNMENT_REQUESTED,
            expect.anything()
        );
        expect(EventBus.server.emit).not.toHaveBeenCalledWith(
            TaskEvents.ERROR,
            expect.anything()
        );
    });
});

describe('socket task lifecycle authority', () => {
    const persistedTask = {
        id: 'task-1',
        channelId: 'channel-a',
        title: 'Security review',
        description: 'Review task ingress',
        status: 'completed',
        priority: 'medium',
        assignmentScope: 'single',
        assignedAgentId: 'trusted-agent',
        assignmentStrategy: 'manual',
        createdBy: 'planner',
        createdAt: 1,
        updatedAt: 2,
        progress: 100,
        result: {
            success: true,
            output: { answer: 42 },
            completedBy: 'trusted-agent'
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransitionTaskInChannel.mockResolvedValue(persistedTask);
        mockGetTasks.mockResolvedValue([]);
    });

    it('returns an error instead of acknowledging a generic reassignment', async () => {
        mockUpdateTaskInChannel.mockRejectedValueOnce(
            new Error('Task assignment requires a dedicated assignment operation')
        );
        const handler = eventHandlers.get(TaskEvents.UPDATE_REQUEST);

        await handler?.({
            agentId: 'trusted-agent',
            channelId: 'channel-a',
            data: {
                taskId: 'task-1',
                requestId: 'reassign-request-1',
                assignedAgentId: 'reviewer-agent',
                task: {
                    taskId: 'task-1',
                    requestId: 'reassign-request-1',
                    assignedAgentId: 'reviewer-agent'
                }
            }
        });

        expect(EventBus.server.emit).toHaveBeenCalledWith(
            TaskEvents.ERROR,
            expect.objectContaining({
                data: expect.objectContaining({
                    requestId: 'reassign-request-1',
                    error: 'Task assignment requires a dedicated assignment operation'
                })
            })
        );
        expect(EventBus.server.emit).not.toHaveBeenCalledWith(
            TaskEvents.PROGRESS_UPDATED,
            expect.anything()
        );
    });

    it('acknowledges completion only after the assignee-scoped service transition resolves', async () => {
        const handler = eventHandlers.get(TaskEvents.COMPLETE_REQUEST);
        await handler?.({
            agentId: 'trusted-agent',
            channelId: 'channel-a',
            data: {
                taskId: 'task-1',
                requestId: 'request-1',
                result: { answer: 42 },
                task: 'complete task-1'
            }
        });

        expect(mockTransitionTaskInChannel).toHaveBeenCalledWith(
            'task-1',
            'channel-a',
            'trusted-agent',
            { kind: 'complete', output: { answer: 42 } }
        );
        expect(EventBus.server.emit).toHaveBeenCalledWith(
            TaskEvents.COMPLETED,
            expect.objectContaining({
                agentId: 'trusted-agent',
                channelId: 'channel-a',
                data: expect.objectContaining({
                    requestId: 'request-1',
                    taskId: 'task-1',
                    toAgentId: 'trusted-agent',
                    task: persistedTask
                })
            })
        );
    });

    it('reports a failure through the same guarded transition as completion', async () => {
        const failedTask = {
            ...persistedTask,
            status: 'failed',
            result: { success: false, error: 'iteration limit', completedBy: 'trusted-agent' }
        };
        mockTransitionTaskInChannel.mockResolvedValueOnce(failedTask);
        const handler = eventHandlers.get(TaskEvents.FAIL_REQUEST);

        await handler?.({
            agentId: 'trusted-agent',
            channelId: 'channel-a',
            data: {
                taskId: 'task-1',
                requestId: 'fail-request-1',
                error: 'iteration limit',
                task: 'fail task-1'
            }
        });

        // The socket path carries no authority flag of its own: who may fail a
        // task is decided inside transitionTaskInChannel, the same as complete.
        expect(mockTransitionTaskInChannel).toHaveBeenCalledWith(
            'task-1',
            'channel-a',
            'trusted-agent',
            { kind: 'fail', error: 'iteration limit' }
        );
        expect(EventBus.server.emit).toHaveBeenCalledWith(
            TaskEvents.FAILED,
            expect.objectContaining({
                agentId: 'trusted-agent',
                channelId: 'channel-a',
                data: expect.objectContaining({
                    requestId: 'fail-request-1',
                    taskId: 'task-1',
                    toAgentId: 'trusted-agent',
                    task: failedTask
                })
            })
        );
    });

    it('returns a correlated error when a participant without completion authority reports a failure', async () => {
        mockTransitionTaskInChannel.mockRejectedValueOnce(new Error(
            'Task task-1 cannot be failed by agent contributor-agent in channel channel-a from its current state'
        ));
        const handler = eventHandlers.get(TaskEvents.FAIL_REQUEST);

        await handler?.({
            agentId: 'contributor-agent',
            channelId: 'channel-a',
            data: {
                taskId: 'task-1',
                requestId: 'fail-request-2',
                error: 'iteration limit',
                task: 'fail task-1'
            }
        });

        expect(EventBus.server.emit).toHaveBeenCalledWith(
            TaskEvents.ERROR,
            expect.objectContaining({
                data: expect.objectContaining({
                    requestId: 'fail-request-2',
                    toAgentId: 'contributor-agent',
                    error: expect.stringContaining('cannot be failed by agent contributor-agent')
                })
            })
        );
        expect(EventBus.server.emit).not.toHaveBeenCalledWith(TaskEvents.FAILED, expect.anything());
    });

    it('returns a private correlated error when the lifecycle CAS rejects', async () => {
        mockTransitionTaskInChannel.mockRejectedValueOnce(new Error('illegal task state'));
        const handler = eventHandlers.get(TaskEvents.CANCEL_REQUEST);

        await handler?.({
            agentId: 'trusted-agent',
            channelId: 'channel-a',
            data: {
                taskId: 'task-1',
                requestId: 'request-2',
                reason: 'stop',
                task: 'cancel task-1'
            }
        });

        expect(mockTransitionTaskInChannel).toHaveBeenCalledWith(
            'task-1',
            'channel-a',
            'trusted-agent',
            { kind: 'cancel', reason: 'stop' }
        );
        expect(EventBus.server.emit).toHaveBeenCalledWith(
            TaskEvents.ERROR,
            expect.objectContaining({
                agentId: 'trusted-agent',
                channelId: 'channel-a',
                data: expect.objectContaining({
                    requestId: 'request-2',
                    taskId: 'task-1',
                    toAgentId: 'trusted-agent',
                    error: 'illegal task state'
                })
            })
        );
    });

    it('resolves current to the exact authorized task before acknowledging', async () => {
        mockGetTasks.mockResolvedValueOnce([{
            ...persistedTask,
            id: 'actual-task-id',
            status: 'in_progress',
            assignedAgentIds: ['trusted-agent', 'reviewer-agent'],
            completionAgentId: 'trusted-agent'
        }]);
        mockTransitionTaskInChannel.mockResolvedValueOnce({
            ...persistedTask,
            id: 'actual-task-id'
        });
        const handler = eventHandlers.get(TaskEvents.COMPLETE_REQUEST);

        await handler?.({
            agentId: 'trusted-agent',
            channelId: 'channel-a',
            data: {
                taskId: 'current',
                requestId: 'request-current-1',
                result: { answer: 42 },
                task: 'complete current task'
            }
        });

        expect(mockTransitionTaskInChannel).toHaveBeenCalledWith(
            'actual-task-id',
            'channel-a',
            'trusted-agent',
            { kind: 'complete', output: { answer: 42 } }
        );
        expect(EventBus.server.emit).toHaveBeenCalledWith(
            TaskEvents.COMPLETED,
            expect.objectContaining({
                data: expect.objectContaining({
                    requestId: 'request-current-1',
                    taskId: 'actual-task-id'
                })
            })
        );
    });
});

describe('global socket task handler lifecycle', () => {
    it('shuts down once and installs one fresh listener set on reinitialize', () => {
        const initialSubscriptions = handlerSubscriptions.slice(-9);
        shutdownTaskHandlers();
        shutdownTaskHandlers();

        expect(eventHandlers.size).toBe(0);
        for (const subscription of initialSubscriptions) {
            expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
        }

        jest.mocked(EventBus.server.on).mockClear();
        initializeTaskHandlers();
        expect(EventBus.server.on).toHaveBeenCalledTimes(9);
        expect(eventHandlers.size).toBe(9);
        const freshSubscriptions = handlerSubscriptions.slice(-9);

        shutdownTaskHandlers();
        for (const subscription of freshSubscriptions) {
            expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
        }
        expect(eventHandlers.size).toBe(0);
    });
});
