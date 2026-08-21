/**
 * Task Service Scoping and Claiming Unit Tests
 *
 * Two problems:
 *
 * 1. Socket task handlers mutated any task by client-supplied taskId. updateTask
 *    resolved to Task.findByIdAndUpdate with no scoping, so an agent in channel A
 *    could complete, reassign, or cancel a task in channel B by naming its id.
 *    updateTaskInChannel confines the write to the caller's channel, and to the
 *    assignee where only the assignee should act.
 *
 * 2. Task claiming was last-write-wins: assignment read the task, decided, then
 *    called task.save(). Two agents could each believe they owned the same task.
 *    The claim is now a single conditional update.
 */

const mockDagShutdown = jest.fn();
const mockMonitoringShutdown = jest.fn();
const mockAssertTaskAgentsBelongToChannel = jest.fn().mockResolvedValue(undefined);
const mockAssertTaskDependenciesBelongToChannel = jest.fn().mockResolvedValue(undefined);
const mockEventSubscriptions: Array<{ unsubscribe: jest.Mock }> = [];

jest.mock('@mxf-dev/core/models/task', () => {
    const Task = Object.assign(jest.fn(), {
        findOne: jest.fn(),
        findById: jest.fn(),
        findByIdAndUpdate: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn(),
        find: jest.fn()
    });
    return { Task };
});

jest.mock('@mxf-dev/core/models/agent', () => ({ Agent: { find: jest.fn(), findOne: jest.fn() } }));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn(),
            on: jest.fn(() => {
                const subscription = { unsubscribe: jest.fn() };
                mockEventSubscriptions.push(subscription);
                return subscription;
            })
        }
    }
}));

jest.mock('@mxf-dev/core/config/dag.config', () => ({
    isDagEnabled: jest.fn().mockReturnValue(false),
    isDagEnforcementEnabled: jest.fn().mockReturnValue(false)
}));

jest.mock('@mxf-dev/core/services/dag/TaskDagService', () => ({
    TaskDagService: {
        shutdownExisting: jest.fn((): boolean => {
            mockDagShutdown();
            return true;
        }),
        getInstance: jest.fn().mockReturnValue({
            isEnabled: jest.fn().mockReturnValue(false),
            getBlockingTasks: jest.fn().mockReturnValue([]),
            updateTaskStatus: jest.fn(),
            shutdown: mockDagShutdown,
            withChannelLock: jest.fn(),
            getDag: jest.fn(),
            addTask: jest.fn(),
            buildDag: jest.fn()
        })
    }
}));

jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: {
        getInstance: jest.fn().mockReturnValue({
            getActiveAgentsInChannel: jest.fn().mockResolvedValue([]),
            getAgent: jest.fn()
        })
    }
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: {
        getInstance: jest.fn().mockReturnValue({ getServiceForChannel: jest.fn().mockReturnValue(null) })
    }
}));

jest.mock('../../../src/server/socket/services/EphemeralEventPatternService', () => ({
    EphemeralEventPatternService: { getInstance: jest.fn().mockReturnValue({ initialize: jest.fn() }) }
}));

jest.mock('../../../src/server/socket/services/TaskCompletionMonitoringService', () => ({
    TaskCompletionMonitoringService: {
        shutdownExisting: jest.fn((): boolean => {
            mockMonitoringShutdown();
            return true;
        }),
        getInstance: jest.fn().mockReturnValue({
            startMonitoring: jest.fn(),
            shutdown: mockMonitoringShutdown
        })
    }
}));

jest.mock('../../../src/server/socket/services/TaskParticipantPolicy', () => ({
    assertTaskAgentsBelongToChannel: mockAssertTaskAgentsBelongToChannel,
    assertTaskDependenciesBelongToChannel: mockAssertTaskDependenciesBelongToChannel
}));

import { Task } from '@mxf-dev/core/models/task';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import { isDagEnabled } from '@mxf-dev/core/config/dag.config';
import { TaskDagService } from '@mxf-dev/core/services/dag/TaskDagService';
import { TaskService } from '../../../src/server/socket/services/TaskService';
import { SystemLlmServiceManager } from '../../../src/server/socket/services/SystemLlmServiceManager';
import { AgentService } from '../../../src/server/socket/services/AgentService';
import { TaskCompletionMonitoringService } from '../../../src/server/socket/services/TaskCompletionMonitoringService';

const mockFindOne = Task.findOne as jest.Mock;
const mockFind = Task.find as jest.Mock;
const mockFindByIdAndUpdate = Task.findByIdAndUpdate as jest.Mock;
const mockFindOneAndUpdate = Task.findOneAndUpdate as jest.Mock;
const mockTaskConstructor = Task as unknown as jest.Mock;
const mockGetSystemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel as jest.Mock;
const mockAgentService = AgentService.getInstance();

const validAssignmentResponse = (recommendedAgentId = 'agent-1', confidence = 0.9): string => JSON.stringify({
    recommendedAgentId,
    confidence,
    reasoning: 'The selected agent has the strongest exact capability match.',
    roleMatch: 0.9,
    capabilityMatch: 0.95,
    workloadScore: 0.8,
    expertiseScore: 0.9,
    availabilityScore: 0.85
});

/** A stored task document as the service reads it. */
const taskDoc = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: { toString: (): string => 'task-1' },
    id: 'task-1',
    channelId: 'channel-a',
    title: 'Do the thing',
    description: 'Details',
    status: 'assigned',
    priority: 'medium',
    assignmentStrategy: 'intelligent',
    assignmentScope: 'single',
    assignedAgentId: 'agent-1',
    assignedAgentIds: undefined,
    completionAgentId: undefined,
    createdBy: 'user-1',
    progress: 0,
    ...overrides
});

describe('TaskService scoping', () => {
    let service: TaskService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = TaskService.getInstance();
        (Task.findById as jest.Mock).mockResolvedValue(taskDoc());
        mockFind.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
        mockGetSystemLlm.mockReturnValue({
            sendLlmRequest: jest.fn().mockResolvedValue(validAssignmentResponse())
        });
        mockAssertTaskAgentsBelongToChannel.mockResolvedValue(undefined);
        mockAssertTaskDependenciesBelongToChannel.mockResolvedValue(undefined);
        mockTaskConstructor.mockImplementation((input: Record<string, unknown>) => {
            const stored = {
                ...input,
                _id: { toString: (): string => 'task-created' },
                id: 'task-created',
                createdAt: new Date(1_000),
                updatedAt: new Date(1_000)
            };
            return {
                ...stored,
                save: jest.fn().mockResolvedValue(stored)
            };
        });
    });

    describe('updateTaskInChannel', () => {
        it('updates non-lifecycle fields inside the caller\'s channel', async () => {
            mockFindOne.mockResolvedValue(taskDoc());
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({ priority: 'high' }));

            const result = await service.updateTaskInChannel('task-1', 'channel-a', {
                priority: 'high'
            });

            expect(mockFindOne).toHaveBeenCalledWith({ _id: 'task-1', channelId: 'channel-a' });
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                { _id: 'task-1', channelId: 'channel-a' },
                { $set: { priority: 'high' } },
                { new: true, runValidators: true }
            );
            expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
            expect(result.priority).toBe('high');
        });

        it.each([
            [{ status: 'completed' }, /dedicated lifecycle operation/i],
            [{ assignedAgentId: 'agent-2' }, /dedicated assignment operation/i]
        ])('rejects generic lifecycle/assignment mutation %# before reading or mutating', async (
            update,
            expectedError
        ) => {
            await expect(
                service.updateTaskInChannel(
                    'task-1',
                    'channel-a',
                    update as never
                )
            ).rejects.toThrow(expectedError);

            expect(mockFindOne).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
            expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
            expect(mockAssertTaskAgentsBelongToChannel).not.toHaveBeenCalled();
        });

        it('rejects model-only fields before reading or mutating a task', async () => {
            await expect(
                service.updateTaskInChannel(
                    'task-1',
                    'channel-a',
                    { channelId: 'channel-b' } as never
                )
            ).rejects.toThrow(/unsupported field.*channelId/i);

            expect(mockFindOne).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        });

        it('keeps the channel predicate on the write if the task changes after the pre-read', async () => {
            mockFindOne.mockResolvedValue(taskDoc());
            // Simulates the atomic channel-scoped filter no longer matching at write time.
            mockFindOneAndUpdate.mockResolvedValue(null);

            await expect(
                service.updateTaskInChannel('task-1', 'channel-a', { priority: 'high' })
            ).rejects.toThrow(/not found in channel channel-a/);

            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                { _id: 'task-1', channelId: 'channel-a' },
                { $set: { priority: 'high' } },
                { new: true, runValidators: true }
            );
            expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('refuses a task that belongs to another channel', async () => {
            // The scoped query finds nothing, because the task is not in channel-b
            mockFindOne.mockResolvedValue(null);

            await expect(
                service.updateTaskInChannel('task-1', 'channel-b', { priority: 'high' })
            ).rejects.toThrow(/not found in channel channel-b/);

            expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('rejects a blank channelId rather than matching everything', async () => {
            await expect(
                service.updateTaskInChannel('task-1', '', { priority: 'high' })
            ).rejects.toThrow();

            expect(mockFindOne).not.toHaveBeenCalled();
        });

        it('rejects a blank taskId', async () => {
            await expect(
                service.updateTaskInChannel('', 'channel-a', { priority: 'high' })
            ).rejects.toThrow();

            expect(mockFindOne).not.toHaveBeenCalled();
        });
    });

    describe('agent lifecycle compare-and-set', () => {
        it('persists completion result atomically with exact assignee and legal states', async () => {
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'completed',
                progress: 100,
                result: {
                    success: true,
                    output: { success: false, answer: 42 },
                    completedAt: new Date(2_000),
                    completedBy: 'agent-1'
                }
            }));

            const result = await service.transitionTaskInChannel(
                'task-1',
                'channel-a',
                'agent-1',
                { kind: 'complete', output: { success: false, answer: 42 } }
            );

            expect(mockFindOne).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: 'task-1',
                    channelId: 'channel-a',
                    status: { $in: ['assigned', 'in_progress'] },
                    $or: [
                        { completionAgentId: 'agent-1' },
                        {
                            $and: [
                                {
                                    $or: [
                                        { completionAgentId: { $exists: false } },
                                        { completionAgentId: null }
                                    ]
                                },
                                {
                                    $or: [
                                        { assignedAgentId: 'agent-1' },
                                        { assignedAgentIds: 'agent-1' }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    $set: expect.objectContaining({
                        status: 'completed',
                        progress: 100,
                        result: expect.objectContaining({
                            success: true,
                            output: { success: false, answer: 42 },
                            completedBy: 'agent-1'
                        })
                    })
                },
                { new: true, runValidators: true }
            );
            expect(result.result?.success).toBe(true);
        });

        it('requires the designated completion agent in the terminal CAS', async () => {
            mockFindOneAndUpdate.mockResolvedValueOnce(null);

            await expect(service.transitionTaskInChannel(
                'task-1',
                'channel-a',
                'agent-1',
                { kind: 'complete', output: { answer: 42 } }
            )).rejects.toThrow(/current state/i);

            expect(mockFindOneAndUpdate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    $or: [
                        { completionAgentId: 'agent-1' },
                        {
                            $and: [
                                {
                                    $or: [
                                        { completionAgentId: { $exists: false } },
                                        { completionAgentId: null }
                                    ]
                                },
                                {
                                    $or: [
                                        { assignedAgentId: 'agent-1' },
                                        { assignedAgentIds: 'agent-1' }
                                    ]
                                }
                            ]
                        }
                    ]
                }),
                expect.any(Object),
                expect.any(Object)
            );

            mockFindOneAndUpdate.mockResolvedValueOnce(taskDoc({
                status: 'completed',
                assignedAgentIds: ['agent-1', 'agent-2'],
                completionAgentId: 'agent-2',
                result: { success: true, completedBy: 'agent-2' }
            }));
            await expect(service.transitionTaskInChannel(
                'task-1',
                'channel-a',
                'agent-2',
                { kind: 'complete', output: { answer: 42 } }
            )).resolves.toEqual(expect.objectContaining({ status: 'completed' }));

            expect(mockFindOneAndUpdate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    $or: expect.arrayContaining([{ completionAgentId: 'agent-2' }])
                }),
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('persists failure evidence in the same completion-authority transition', async () => {
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'failed',
                result: {
                    success: false,
                    error: 'provider 500',
                    completedAt: new Date(2_000),
                    completedBy: 'agent-1'
                }
            }));

            await service.transitionTaskInChannel(
                'task-1', 'channel-a', 'agent-1',
                { kind: 'fail', error: 'provider 500' }
            );

            // Failing a task is a terminal outcome and is gated exactly like
            // completing it: the designated completion agent when there is one,
            // otherwise any assignee. A participant's own error must not end a
            // task that another agent was designated to finish.
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    channelId: 'channel-a',
                    status: { $in: ['assigned', 'in_progress'] },
                    $or: [
                        { completionAgentId: 'agent-1' },
                        {
                            $and: [
                                {
                                    $or: [
                                        { completionAgentId: { $exists: false } },
                                        { completionAgentId: null }
                                    ]
                                },
                                {
                                    $or: [
                                        { assignedAgentId: 'agent-1' },
                                        { assignedAgentIds: 'agent-1' }
                                    ]
                                }
                            ]
                        }
                    ]
                }),
                {
                    $set: expect.objectContaining({
                        status: 'failed',
                        result: expect.objectContaining({
                            success: false,
                            error: 'provider 500',
                            completedBy: 'agent-1'
                        })
                    })
                },
                { new: true, runValidators: true }
            );
        });

        it('rejects a stale or non-assignee transition from the single CAS result', async () => {
            mockFindOneAndUpdate.mockResolvedValue(null);

            await expect(service.transitionTaskInChannel(
                'task-1', 'channel-a', 'agent-2', { kind: 'cancel', reason: 'stop' }
            )).rejects.toThrow(/current state/i);

            expect(mockFindOne).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: { $in: ['assigned', 'in_progress'] },
                    $or: expect.arrayContaining([{ assignedAgentId: 'agent-2' }])
                }),
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('allows an owner to cancel a pending unassigned task without weakening agent CAS', async () => {
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'cancelled',
                assignedAgentId: undefined,
                result: {
                    success: false,
                    error: 'no longer needed',
                    completedAt: new Date(2_000),
                    completedBy: 'user-1'
                }
            }));

            await service.transitionTaskAsOwnerInChannel(
                'task-1', 'channel-a', 'user-1',
                { kind: 'cancel', reason: 'no longer needed' }
            );

            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: 'task-1',
                    channelId: 'channel-a',
                    status: { $in: ['pending', 'assigned', 'in_progress'] }
                },
                expect.objectContaining({
                    $set: expect.objectContaining({ status: 'cancelled' })
                }),
                { new: true, runValidators: true }
            );
        });
    });

    describe('handleTaskCompletion', () => {
        it('keeps channel and assignee predicates on the completion write', async () => {
            const sort = jest.fn().mockResolvedValue([taskDoc()]);
            mockFind.mockReturnValue({ sort });
            mockFindOne.mockResolvedValue(taskDoc());
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'completed',
                progress: 100,
                result: {
                    success: true,
                    output: { summary: 'done', requestId: 'completion-1' },
                    completedAt: new Date(2_000),
                    completedBy: 'agent-1'
                }
            }));

            await service.handleTaskCompletion('agent-1', 'channel-a', {
                summary: 'done',
                success: true,
                requestId: 'completion-1'
            });

            expect(mockFind).toHaveBeenCalledWith({ channelId: 'channel-a' });
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: 'task-1',
                    channelId: 'channel-a',
                    status: { $in: ['assigned', 'in_progress'] },
                    $or: [
                        { completionAgentId: 'agent-1' },
                        {
                            $and: [
                                {
                                    $or: [
                                        { completionAgentId: { $exists: false } },
                                        { completionAgentId: null }
                                    ]
                                },
                                {
                                    $or: [
                                        { assignedAgentId: 'agent-1' },
                                        { assignedAgentIds: 'agent-1' }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    $set: expect.objectContaining({
                        status: 'completed',
                        progress: 100
                    })
                },
                { new: true, runValidators: true }
            );
            expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('persists and emits an honest failure when success is false', async () => {
            const sort = jest.fn().mockResolvedValue([taskDoc()]);
            mockFind.mockReturnValue({ sort });
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'failed',
                result: {
                    success: false,
                    error: 'validation failed',
                    output: {
                        agentId: 'agent-1',
                        summary: 'validation failed',
                        reportedSuccess: false,
                        requestId: 'completion-failed-1'
                    },
                    completedAt: new Date(2_000),
                    completedBy: 'agent-1'
                }
            }));

            const result = await service.handleTaskCompletion('agent-1', 'channel-a', {
                summary: 'validation failed',
                success: false,
                requestId: 'completion-failed-1'
            });

            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: 'task-1',
                    channelId: 'channel-a',
                    status: { $in: ['assigned', 'in_progress'] }
                }),
                {
                    $set: expect.objectContaining({
                        status: 'failed',
                        result: expect.objectContaining({
                            success: false,
                            error: 'validation failed',
                            output: expect.objectContaining({ reportedSuccess: false }),
                            completedBy: 'agent-1'
                        })
                    })
                },
                { new: true, runValidators: true }
            );
            expect(result).toEqual(expect.objectContaining({
                status: 'task_failed',
                message: 'Task failed: validation failed'
            }));
            expect(EventBus.server.emit).toHaveBeenCalledWith(
                TaskEvents.FAILED,
                expect.objectContaining({
                    data: expect.objectContaining({ requestId: 'completion-failed-1' })
                })
            );
            expect(jest.mocked(EventBus.server.emit).mock.calls.some(
                ([eventName, payload]) => eventName === TaskEvents.COMPLETED &&
                    (payload as { data?: { requestId?: string } }).data?.requestId === 'completion-failed-1'
            )).toBe(false);
        });

        it('does not let another assignee bypass a designated completion agent', async () => {
            const sort = jest.fn().mockResolvedValue([taskDoc({
                assignedAgentIds: ['agent-1', 'agent-2'],
                completionAgentId: 'agent-2'
            })]);
            mockFind.mockReturnValue({ sort });

            await expect(service.handleTaskCompletion('agent-1', 'channel-a', {
                summary: 'attempted bypass',
                requestId: 'completion-denied-1'
            })).rejects.toThrow(/no active task is assigned/i);

            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        });

        it('rejects missing completion evidence before task lookup', async () => {
            await expect(service.handleTaskCompletion('agent-1', 'channel-a', {
                summary: '',
                requestId: 'completion-2'
            })).rejects.toThrow(/summary is required/i);

            expect(mockFind).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        });
    });

    describe('authoritative creation and assignment', () => {
        it('persists explicit creation assignment and emits one ASSIGNED outcome', async () => {
            const task = await service.createTask({
                channelId: 'channel-a',
                title: 'Assigned at creation',
                description: 'Persist assignment state before announcing it',
                assignmentStrategy: 'manual',
                assignedAgentIds: ['agent-1']
            }, 'user-1', 'create-request-1');

            expect(mockTaskConstructor).toHaveBeenCalledWith(expect.objectContaining({
                status: 'assigned',
                assignedAgentId: 'agent-1',
                assignedAgentIds: ['agent-1']
            }));
            expect(task.status).toBe('assigned');
            const assignmentCalls = jest.mocked(EventBus.server.emit).mock.calls.filter(
                ([eventName]) => eventName === TaskEvents.ASSIGNED
            );
            expect(assignmentCalls).toHaveLength(1);
            expect(assignmentCalls[0][1]).toEqual(expect.objectContaining({
                data: expect.objectContaining({ toAgentId: 'agent-1' })
            }));
        });

        it('normalizes single and multi-agent assignments without duplicate outcomes', async () => {
            await service.createTask({
                channelId: 'channel-a',
                title: 'Normalized assignment',
                description: 'Emit one outcome for each distinct assignee',
                assignmentStrategy: 'manual',
                assignedAgentId: 'agent-1',
                assignedAgentIds: ['agent-1', 'agent-2', 'agent-2'],
                completionAgentId: 'agent-2'
            }, 'user-1', 'create-request-2');

            expect(mockTaskConstructor).toHaveBeenCalledWith(expect.objectContaining({
                assignedAgentId: 'agent-1',
                assignedAgentIds: ['agent-1', 'agent-2'],
                completionAgentId: 'agent-2',
                status: 'assigned'
            }));
            expect(mockAssertTaskAgentsBelongToChannel).toHaveBeenCalledWith(
                'channel-a',
                ['agent-1', 'agent-2', undefined, 'agent-2']
            );
            const assignmentRecipients = jest.mocked(EventBus.server.emit).mock.calls
                .filter(([eventName]) => eventName === TaskEvents.ASSIGNED)
                .map(([, payload]) => (payload as { data: { toAgentId: string } }).data.toAgentId);
            expect(assignmentRecipients).toEqual(['agent-1', 'agent-2']);
        });

        it('rejects an unreachable designated completion agent before persistence', async () => {
            await expect(service.createTask({
                channelId: 'channel-a',
                title: 'Unreachable completer',
                description: 'The completion agent must receive the assignment',
                assignedAgentIds: ['agent-1'],
                completionAgentId: 'agent-2'
            }, 'user-1')).rejects.toThrow(/completionAgentId.*assigned/i);

            expect(mockTaskConstructor).not.toHaveBeenCalled();
            expect(mockAssertTaskAgentsBelongToChannel).not.toHaveBeenCalled();
        });

        it.each([
            {
                name: 'multiple scope with one agent',
                request: {
                    assignmentScope: 'multiple' as const,
                    assignedAgentIds: ['agent-1']
                },
                error: /multiple assignment scope.*two distinct/i
            },
            {
                name: 'multiple scope with duplicate agents',
                request: {
                    assignmentScope: 'multiple' as const,
                    assignedAgentId: 'agent-1',
                    assignedAgentIds: ['agent-1', 'agent-1']
                },
                error: /multiple assignment scope.*two distinct/i
            },
            {
                name: 'channel-wide scope with no selection boundary',
                request: { assignmentScope: 'channel-wide' as const },
                error: /channel-wide assignment requires/i
            }
        ])('rejects invalid $name before persistence', async ({ request, error }) => {
            await expect(service.createTask({
                channelId: 'channel-a',
                title: 'Invalid assignment shape',
                description: 'Must fail before the model constructor',
                ...request
            }, 'user-1')).rejects.toThrow(error);

            expect(mockTaskConstructor).not.toHaveBeenCalled();
            expect(mockAssertTaskAgentsBelongToChannel).not.toHaveBeenCalled();
        });

        it('counts singular and plural assignees together for a valid multiple scope', async () => {
            await expect(service.createTask({
                channelId: 'channel-a',
                title: 'Two sources, two assignees',
                description: 'Normalization happens before persistence and event validation',
                assignmentScope: 'multiple',
                assignedAgentId: 'agent-1',
                assignedAgentIds: ['agent-2']
            }, 'user-1')).resolves.toEqual(expect.objectContaining({ status: 'assigned' }));

            expect(mockTaskConstructor).toHaveBeenCalledWith(expect.objectContaining({
                assignedAgentId: 'agent-1',
                assignedAgentIds: ['agent-1', 'agent-2'],
                assignmentScope: 'multiple'
            }));
        });

        it.each([
            { channelWideTask: true },
            { maxParticipants: 1 }
        ])('accepts a valid channel-wide boundary %#', async boundary => {
            await expect(service.createTask({
                channelId: 'channel-a',
                title: 'Bounded channel-wide work',
                description: 'Valid before the task is saved',
                assignmentScope: 'channel-wide',
                ...boundary
            }, 'user-1')).resolves.toEqual(expect.objectContaining({
                assignmentScope: 'channel-wide'
            }));
        });

        it('does not run a second assignment pass for an explicitly assigned CREATED task', async () => {
            const assignmentSpy = jest.spyOn(service, 'assignTaskIntelligently');

            await (service as unknown as {
                handleTaskCreated: (task: Record<string, unknown>) => Promise<void>;
            }).handleTaskCreated(taskDoc({
                status: 'assigned',
                assignedAgentId: 'agent-1',
                assignedAgentIds: ['agent-1']
            }));

            expect(assignmentSpy).not.toHaveBeenCalled();
        });

        it('assigns a pending task with one CAS and emits exactly one outcome', async () => {
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'assigned',
                assignedAgentId: 'agent-2'
            }));

            await service.assignTaskInChannel(
                'task-1', 'channel-a', 'agent-2', 'user-1'
            );

            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                { _id: 'task-1', channelId: 'channel-a', status: 'pending' },
                {
                    $set: expect.objectContaining({
                        assignedAgentId: 'agent-2',
                        status: 'assigned'
                    })
                },
                { new: true, runValidators: true }
            );
            expect(jest.mocked(EventBus.server.emit).mock.calls.filter(
                ([eventName]) => eventName === TaskEvents.ASSIGNED
            )).toHaveLength(1);
        });
    });

    describe('REST collection and item reads', () => {
        it('applies authorized channel ids in the database query', async () => {
            const sort = jest.fn().mockResolvedValue([]);
            mockFind.mockReturnValue({ sort });

            await service.getTasksInChannels(
                { status: 'pending' },
                ['channel-a', 'channel-b', 'channel-a']
            );

            expect(mockFind).toHaveBeenCalledWith({
                status: 'pending',
                channelId: { $in: ['channel-a', 'channel-b'] }
            });
        });

        it('returns an empty collection without querying when the principal owns no channels', async () => {
            await expect(service.getTasksInChannels({}, [])).resolves.toEqual([]);
            expect(mockFind).not.toHaveBeenCalled();
        });

        it('does not query when a requested channel is outside the authorized set', async () => {
            await expect(
                service.getTasksInChannels({ channelId: 'channel-b' }, ['channel-a'])
            ).resolves.toEqual([]);

            expect(mockFind).not.toHaveBeenCalled();
        });

        it('reads an item with both task and authorized channel in the query', async () => {
            mockFindOne.mockResolvedValue(taskDoc());

            const task = await service.getTaskInChannel('task-1', 'channel-a');

            expect(mockFindOne).toHaveBeenCalledWith({ _id: 'task-1', channelId: 'channel-a' });
            expect(task?.id).toBe('task-1');
        });

        it('resolves only the task channel before authorization', async () => {
            const lean = jest.fn().mockResolvedValue({ channelId: 'channel-a' });
            const select = jest.fn().mockReturnValue({ lean });
            (Task.findById as jest.Mock).mockReturnValue({ select });

            await expect(service.getTaskChannelId('task-1')).resolves.toBe('channel-a');

            expect(Task.findById).toHaveBeenCalledWith('task-1');
            expect(select).toHaveBeenCalledWith('channelId');
        });
    });

    describe('assignTaskIntelligentlyInChannel', () => {
        it('refuses a task from another channel before any assignment work', async () => {
            mockFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

            await expect(
                service.assignTaskIntelligentlyInChannel('task-1', 'channel-b')
            ).rejects.toThrow(/not found in channel channel-b/);
        });

        it('scopes the lookup by channel', async () => {
            const select = jest.fn().mockResolvedValue(null);
            mockFindOne.mockReturnValue({ select });

            await expect(
                service.assignTaskIntelligentlyInChannel('task-1', 'channel-a')
            ).rejects.toThrow();

            expect(mockFindOne).toHaveBeenCalledWith({ _id: 'task-1', channelId: 'channel-a' });
        });
    });

    describe('automatic terminal transition', () => {
        it('uses one channel-scoped non-terminal compare-and-set', async () => {
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'completed',
                progress: 100,
                result: { success: true, completedBy: 'system' }
            }));

            const result = await service.transitionMonitoredTask({
                taskId: 'task-1',
                channelId: 'channel-a',
                status: 'completed',
                progress: 100,
                result: {
                    success: true,
                    completedAt: 123,
                    completedBy: 'system'
                }
            });

            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                {
                    _id: 'task-1',
                    channelId: 'channel-a',
                    status: { $nin: ['completed', 'failed', 'cancelled'] }
                },
                {
                    $set: expect.objectContaining({
                        status: 'completed',
                        progress: 100,
                        result: expect.objectContaining({ completedBy: 'system' })
                    })
                },
                { new: true, runValidators: true }
            );
            expect(result?.status).toBe('completed');
        });

        it('returns null when another evaluation already made the task terminal', async () => {
            mockFindOneAndUpdate.mockResolvedValue(null);

            await expect(service.transitionMonitoredTask({
                taskId: 'task-1',
                channelId: 'channel-a',
                status: 'failed',
                progress: 10,
                result: { success: false, error: 'timeout' }
            })).resolves.toBeNull();
        });

        it('still returns the persisted terminal task when DAG propagation fails', async () => {
            const dagService = TaskDagService.getInstance();
            (isDagEnabled as jest.Mock).mockReturnValueOnce(true);
            (dagService.withChannelLock as jest.Mock).mockImplementationOnce(
                async (_channelId: string, operation: () => Promise<unknown>): Promise<unknown> => operation()
            );
            (dagService.isEnabled as jest.Mock).mockReturnValueOnce(true);
            (dagService.updateTaskStatus as jest.Mock).mockImplementationOnce(() => {
                throw new Error('DAG unavailable');
            });
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({ status: 'completed', progress: 100 }));

            await expect(service.transitionMonitoredTask({
                taskId: 'task-1',
                channelId: 'channel-a',
                status: 'completed',
                progress: 100,
                result: { success: true, completedBy: 'system' }
            })).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
        });
    });

    describe('shutdown', () => {
        it('unsubscribes exactly once and reinitializes one fresh listener set', () => {
            const initialTaskSubscriptions = mockEventSubscriptions.slice(-3);
            service.shutdown();
            service.shutdown();

            expect(mockMonitoringShutdown).toHaveBeenCalledTimes(1);
            expect(mockDagShutdown).toHaveBeenCalledTimes(1);
            expect(TaskCompletionMonitoringService.getInstance).not.toHaveBeenCalled();
            expect(TaskDagService.getInstance).not.toHaveBeenCalled();
            for (const subscription of initialTaskSubscriptions) {
                expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
            }

            const restartedService = TaskService.getInstance();
            expect(restartedService).not.toBe(service);
            expect(EventBus.server.on).toHaveBeenCalledTimes(3);
            const reinitializedSubscriptions = mockEventSubscriptions.slice(-3);

            restartedService.shutdown();
            expect(mockMonitoringShutdown).toHaveBeenCalledTimes(2);
            expect(mockDagShutdown).toHaveBeenCalledTimes(2);
            for (const subscription of reinitializedSubscriptions) {
                expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
            }
        });
    });

    describe('stopPeriodicWork', () => {
        it('stops the timers and completion monitoring while keeping event handling alive', () => {
            jest.useFakeTimers();
            try {
                const periodicService = TaskService.getInstance();
                const initialTaskSubscriptions = mockEventSubscriptions.slice(-3);
                const optimize = jest
                    .spyOn(periodicService as unknown as { optimizeTaskAssignments: () => Promise<void> }, 'optimizeTaskAssignments')
                    .mockResolvedValue(undefined);
                const coordinate = jest
                    .spyOn(periodicService as unknown as { coordinateAgentAssignments: () => Promise<void> }, 'coordinateAgentAssignments')
                    .mockResolvedValue(undefined);

                periodicService.stopPeriodicWork();
                jest.advanceTimersByTime(10 * 60 * 1000);

                expect(optimize).not.toHaveBeenCalled();
                expect(coordinate).not.toHaveBeenCalled();
                expect(mockMonitoringShutdown).toHaveBeenCalledTimes(1);
                expect(jest.getTimerCount()).toBe(0);
                // Accepted work still has its handlers until shutdown().
                for (const subscription of initialTaskSubscriptions) {
                    expect(subscription.unsubscribe).not.toHaveBeenCalled();
                }

                // Safe to repeat, and shutdown() still releases the handlers.
                expect(() => periodicService.stopPeriodicWork()).not.toThrow();
                periodicService.shutdown();
                for (const subscription of initialTaskSubscriptions) {
                    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
                }
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('multi-agent assignment compare-and-set', () => {
        const multiAgents = [
            { id: 'agent-1', role: 'worker' },
            { id: 'agent-2', role: 'specialist' }
        ];

        it('assigns a pending multiple-scope task through one pending-only CAS write', async () => {
            const save = jest.fn();
            (Task.findById as jest.Mock).mockResolvedValue(taskDoc({
                status: 'pending',
                assignmentScope: 'multiple',
                assignedAgentId: undefined,
                assignedAgentIds: ['agent-1', 'agent-2'],
                save
            }));
            (mockAgentService.getAgent as jest.Mock).mockImplementation(
                async (agentId: string) => multiAgents.find(agent => agent.id === agentId) ?? null
            );
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'assigned',
                assignmentScope: 'multiple',
                assignedAgentIds: ['agent-1', 'agent-2'],
                leadAgentId: 'agent-1',
                assignedAgentId: 'agent-1'
            }));

            await expect(service.assignTaskIntelligently('task-1')).resolves.toEqual(
                expect.objectContaining({ strategy: 'multi_agent', assignedAgentId: 'agent-1' })
            );

            expect(save).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ _id: 'task-1', channelId: 'channel-a', status: 'pending' }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        assignedAgentIds: ['agent-1', 'agent-2'],
                        leadAgentId: 'agent-1',
                        assignedAgentId: 'agent-1',
                        status: 'assigned'
                    })
                }),
                expect.objectContaining({ new: true })
            );
            expect(EventBus.server.emit as jest.Mock).toHaveBeenCalledTimes(2);
        });

        it('refuses to re-assign a completed multiple-scope task', async () => {
            const save = jest.fn();
            (Task.findById as jest.Mock).mockResolvedValue(taskDoc({
                status: 'completed',
                assignmentScope: 'multiple',
                assignedAgentIds: ['agent-1', 'agent-2'],
                save
            }));
            (mockAgentService.getAgent as jest.Mock).mockImplementation(
                async (agentId: string) => multiAgents.find(agent => agent.id === agentId) ?? null
            );
            mockFindOneAndUpdate.mockResolvedValue(null);

            await expect(service.assignTaskIntelligently('task-1'))
                .rejects.toThrow(/no longer pending/);

            expect(save).not.toHaveBeenCalled();
            expect(EventBus.server.emit as jest.Mock).not.toHaveBeenCalled();
        });

        it('refuses to re-assign a completed channel-wide task', async () => {
            const save = jest.fn();
            (Task.findById as jest.Mock).mockResolvedValue(taskDoc({
                status: 'completed',
                assignmentScope: 'channel-wide',
                assignedAgentIds: ['agent-1', 'agent-2'],
                save
            }));
            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue(multiAgents);
            mockFindOneAndUpdate.mockResolvedValue(null);

            await expect(service.assignTaskIntelligently('task-1'))
                .rejects.toThrow(/no longer pending/);

            expect(save).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ _id: 'task-1', channelId: 'channel-a', status: 'pending' }),
                expect.objectContaining({
                    $set: expect.objectContaining({ channelWideTask: true, status: 'assigned' })
                }),
                expect.objectContaining({ new: true })
            );
            expect(EventBus.server.emit as jest.Mock).not.toHaveBeenCalled();
        });
    });

    describe('atomic claim', () => {
        it('uses the validated SystemLLM recommendation instead of fabricating a first-agent result', async () => {
            const pendingTask = taskDoc({ status: 'pending', assignedAgentId: undefined });
            const sendLlmRequest = jest.fn().mockResolvedValue(validAssignmentResponse('agent-2'));

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            mockGetSystemLlm.mockReturnValue({ sendLlmRequest });
            mockFindOneAndUpdate.mockResolvedValue(
                taskDoc({ status: 'assigned', assignedAgentId: 'agent-2' })
            );

            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue([
                { id: 'agent-1', role: 'worker' },
                { id: 'agent-2', role: 'specialist' }
            ]);

            await expect(service.assignTaskIntelligently('task-1')).resolves.toEqual(
                expect.objectContaining({
                    assignedAgentId: 'agent-2',
                    strategy: 'intelligent',
                    confidence: 0.9
                })
            );

            expect(sendLlmRequest).toHaveBeenCalledWith(
                expect.stringContaining('"recommendedAgentId"'),
                undefined,
                { operationType: 'coordination' }
            );
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    $set: expect.objectContaining({ assignedAgentId: 'agent-2' })
                }),
                expect.any(Object)
            );
        });

        it('keeps participant validation on the dedicated assignment path', async () => {
            mockAssertTaskAgentsBelongToChannel.mockRejectedValueOnce(
                new Error('Task agent(s) are not participants of channel channel-a: foreign-agent')
            );

            await expect(service.assignTaskInChannel(
                'task-1',
                'channel-a',
                'foreign-agent',
                'user-1'
            )).rejects.toThrow(/not participants.*foreign-agent/i);

            expect(mockAssertTaskAgentsBelongToChannel)
                .toHaveBeenCalledWith('channel-a', ['foreign-agent']);
            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        });

        it('builds assignment workload from persisted channel tasks', async () => {
            const pendingTask = taskDoc({
                status: 'pending',
                assignedAgentId: undefined,
                createdAt: new Date(1_000),
                updatedAt: new Date(2_000)
            });
            const sendLlmRequest = jest.fn().mockResolvedValue(validAssignmentResponse());
            const sort = jest.fn().mockResolvedValue([
                taskDoc({
                    status: 'in_progress',
                    assignedAgentId: 'agent-1',
                    createdAt: new Date(1_000),
                    updatedAt: new Date(2_000)
                })
            ]);

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            mockFind.mockReturnValue({ sort });
            mockGetSystemLlm.mockReturnValue({ sendLlmRequest });
            mockFindOneAndUpdate.mockResolvedValue(
                taskDoc({ status: 'assigned', assignedAgentId: 'agent-1' })
            );
            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue([
                { id: 'agent-1', role: 'worker' }
            ]);

            await service.assignTaskIntelligently('task-1');

            expect(mockFind).toHaveBeenCalledWith({ channelId: 'channel-a' });
            expect(sendLlmRequest).toHaveBeenCalledWith(
                expect.stringContaining('CurrentTasks=1'),
                undefined,
                { operationType: 'coordination' }
            );
        });

        it('does not call SystemLLM when persisted workload analysis fails', async () => {
            const pendingTask = taskDoc({ status: 'pending', assignedAgentId: undefined });
            const sendLlmRequest = jest.fn().mockResolvedValue(validAssignmentResponse());

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            mockFind.mockReturnValue({ sort: jest.fn().mockRejectedValue(new Error('database unavailable')) });
            mockGetSystemLlm.mockReturnValue({ sendLlmRequest });
            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue([
                { id: 'agent-1', role: 'worker' }
            ]);

            await expect(service.assignTaskIntelligently('task-1'))
                .rejects.toThrow('database unavailable');

            expect(sendLlmRequest).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        });

        it('fails without claiming when the SystemLLM response is malformed', async () => {
            const pendingTask = taskDoc({ status: 'pending', assignedAgentId: undefined });

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            mockGetSystemLlm.mockReturnValue({
                sendLlmRequest: jest.fn().mockResolvedValue('{not-json')
            });

            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue([
                { id: 'agent-1', role: 'worker' }
            ]);

            await expect(service.assignTaskIntelligently('task-1'))
                .rejects.toThrow(/invalid JSON/);

            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        });

        it('fails without claiming when no channel SystemLLM exists', async () => {
            const pendingTask = taskDoc({ status: 'pending', assignedAgentId: undefined });

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            mockGetSystemLlm.mockReturnValue(null);

            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue([
                { id: 'agent-1', role: 'worker' }
            ]);

            await expect(service.assignTaskIntelligently('task-1'))
                .rejects.toThrow(/SystemLLM is unavailable/);

            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        });

        it('claims only while the task is pending and unassigned', async () => {
            const pendingTask = taskDoc({ status: 'pending', assignedAgentId: undefined });

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            mockFindOneAndUpdate.mockResolvedValue(
                taskDoc({ status: 'assigned', assignedAgentId: 'agent-1' })
            );

            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue([
                { id: 'agent-1', role: 'worker' }
            ]);

            await service.assignTaskIntelligently('task-1');

            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: 'task-1',
                    status: 'pending'
                }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        assignedAgentId: 'agent-1',
                        status: 'assigned'
                    })
                }),
                expect.objectContaining({ new: true })
            );
        });

        it('guards the claim on the task still being unassigned', async () => {
            const pendingTask = taskDoc({ status: 'pending', assignedAgentId: undefined });

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({ status: 'assigned' }));

            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue([
                { id: 'agent-1', role: 'worker' }
            ]);

            await service.assignTaskIntelligently('task-1');

            const filter = mockFindOneAndUpdate.mock.calls[0][0];
            expect(filter.$or).toEqual([
                { assignedAgentId: { $exists: false } },
                { assignedAgentId: null }
            ]);
        });

        it('fails the loser of a race rather than letting both agents own the task', async () => {
            const pendingTask = taskDoc({ status: 'pending', assignedAgentId: undefined });

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            // The conditional update matched nothing: someone else claimed it first
            mockFindOneAndUpdate.mockResolvedValue(null);

            (mockAgentService.getActiveAgentsInChannel as jest.Mock).mockResolvedValue([
                { id: 'agent-1', role: 'worker' }
            ]);

            await expect(service.assignTaskIntelligently('task-1'))
                .rejects.toThrow(/claimed by another agent/);
        });
    });
});
