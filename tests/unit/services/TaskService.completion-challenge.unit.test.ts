/**
 * TaskService x SystemLlmChallengeService integration.
 *
 * handleTaskCompletion asks SystemLlmChallengeService to challenge a success
 * claim before the task is marked complete. A returned challenge short-circuits
 * the transition and hands the agent a `completion_challenged` result instead;
 * a thrown ChallengeUnavailableError must leave the task exactly where it was.
 * These tests exercise that integration in isolation from SystemLlmChallengeService's
 * own behavior, which is covered in SystemLlmChallengeService.unit.test.ts.
 */

const mockDagShutdown = jest.fn();
const mockMonitoringShutdown = jest.fn();
const mockAssertTaskAgentsBelongToChannel = jest.fn().mockResolvedValue(undefined);
const mockAssertTaskDependenciesBelongToChannel = jest.fn().mockResolvedValue(undefined);
const mockEventSubscriptions: Array<{ unsubscribe: jest.Mock }> = [];
const mockChallengeCompletionClaim = jest.fn();

jest.mock('@mxf-dev/core/models/task', () => {
    const Task = Object.assign(jest.fn(), {
        findOne: jest.fn(),
        findById: jest.fn(),
        findByIdAndUpdate: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn(),
        exists: jest.fn(),
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

jest.mock('../../../src/server/socket/services/SystemLlmChallengeService', () => ({
    SystemLlmChallengeService: {
        getInstance: jest.fn().mockReturnValue({
            challengeCompletionClaim: mockChallengeCompletionClaim
        })
    },
    ChallengeUnavailableError: class ChallengeUnavailableError extends Error {}
}));

import { Task } from '@mxf-dev/core/models/task';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import {
    TASK_METADATA_CHALLENGES_KEY,
    type SystemLlmChallengeRecord
} from '@mxf-dev/core/types/SystemLlmStanceTypes';
import { TaskService } from '../../../src/server/socket/services/TaskService';

const mockFind = Task.find as jest.Mock;
const mockFindOneAndUpdate = Task.findOneAndUpdate as jest.Mock;
const mockUpdateOne = Task.updateOne as jest.Mock;
const mockExists = Task.exists as jest.Mock;

/** A stored task document as the service reads it: assigned to 'worker', active, in 'ch-1'. */
const taskDoc = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: { toString: (): string => 'task-1' },
    id: 'task-1',
    channelId: 'ch-1',
    title: 'Ship the report',
    description: 'Write and publish the quarterly report',
    status: 'in_progress',
    priority: 'medium',
    assignmentStrategy: 'manual',
    assignmentScope: 'single',
    assignedAgentId: 'worker',
    assignedAgentIds: ['worker'],
    completionAgentId: undefined,
    createdBy: 'user-1',
    progress: 10,
    ...overrides
});

describe('TaskService completion challenge integration', () => {
    let service: TaskService;

    beforeEach(() => {
        jest.clearAllMocks();
        mockChallengeCompletionClaim.mockReset();
        mockUpdateOne.mockReset();
        mockExists.mockReset();
        service = TaskService.getInstance();
        (Task.findById as jest.Mock).mockResolvedValue(taskDoc());
        mockFind.mockReturnValue({ sort: jest.fn().mockResolvedValue([taskDoc()]) });
        mockAssertTaskAgentsBelongToChannel.mockResolvedValue(undefined);
        mockAssertTaskDependenciesBelongToChannel.mockResolvedValue(undefined);
    });

    describe('handleTaskCompletion', () => {
        it('completes the task when SystemLLM raises no challenge', async () => {
            mockChallengeCompletionClaim.mockResolvedValue(null);
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'completed',
                progress: 100,
                result: {
                    success: true,
                    output: { summary: 'done' },
                    completedAt: new Date(2_000),
                    completedBy: 'worker'
                }
            }));

            const result = await service.handleTaskCompletion('worker', 'ch-1', {
                summary: 'done',
                requestId: 'r1'
            });

            expect(result).toEqual(expect.objectContaining({ status: 'task_completed', taskId: 'task-1' }));
            expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
            expect(jest.mocked(EventBus.server.emit)).toHaveBeenCalledWith(
                TaskEvents.COMPLETED,
                expect.objectContaining({ data: expect.objectContaining({ taskId: 'task-1', requestId: 'r1' }) })
            );
            expect(mockChallengeCompletionClaim).toHaveBeenCalledWith(expect.objectContaining({
                agentId: 'worker',
                channelId: 'ch-1',
                summary: 'done',
                task: expect.objectContaining({ id: 'task-1' })
            }));
        });

        it('returns a challenged status without transitioning the task when SystemLLM disputes the claim', async () => {
            const challenge = {
                id: 'challenge-1',
                channelId: 'ch-1',
                agentId: 'worker',
                taskId: 'task-1',
                trigger: 'completion_claim',
                stance: 'critical',
                delivery: 'tool_result',
                summary: 'No evidence the report was published',
                points: [{ claim: 'published', problem: 'no tool call shows it', evidenceNeeded: 'a publish result' }],
                createdAt: 1
            };
            mockChallengeCompletionClaim.mockResolvedValue(challenge);

            const result = await service.handleTaskCompletion('worker', 'ch-1', {
                summary: 'done',
                requestId: 'r1'
            });

            expect(result).toEqual({
                status: 'completion_challenged',
                message: 'Completion of task task-1 was challenged by SystemLLM (critical stance). ' +
                    'Address each point with evidence, or explain why it is wrong, then call task_complete again.',
                taskId: 'task-1',
                challenge: {
                    id: 'challenge-1',
                    stance: 'critical',
                    trigger: 'completion_claim',
                    summary: 'No evidence the report was published',
                    points: challenge.points
                }
            });
            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
            expect(jest.mocked(EventBus.server.emit)).not.toHaveBeenCalled();
        });

        it('does not consult SystemLLM for a reported failure', async () => {
            mockFindOneAndUpdate.mockResolvedValue(taskDoc({
                status: 'failed',
                result: {
                    success: false,
                    error: 'could not publish',
                    completedAt: new Date(2_000),
                    completedBy: 'worker'
                }
            }));

            const result = await service.handleTaskCompletion('worker', 'ch-1', {
                summary: 'could not publish',
                success: false,
                requestId: 'r1'
            });

            expect(mockChallengeCompletionClaim).not.toHaveBeenCalled();
            expect(result.status).toBe('task_failed');
            expect(jest.mocked(EventBus.server.emit)).toHaveBeenCalledWith(
                TaskEvents.FAILED,
                expect.objectContaining({ data: expect.objectContaining({ taskId: 'task-1' }) })
            );
        });

        it('propagates a required-challenge failure without transitioning the task', async () => {
            mockChallengeCompletionClaim.mockRejectedValue(
                new Error('SystemLLM daily budget is spent; no challenge can be produced for channel ch-1')
            );

            await expect(service.handleTaskCompletion('worker', 'ch-1', {
                summary: 'done',
                requestId: 'r1'
            })).rejects.toThrow(/SystemLLM daily budget is spent/);

            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
            expect(jest.mocked(EventBus.server.emit)).not.toHaveBeenCalled();
        });
    });

    describe('findActiveTaskForAgent', () => {
        it('resolves the assignee\'s task and null for an uninvolved agent', async () => {
            await expect(service.findActiveTaskForAgent('ch-1', 'worker'))
                .resolves.toEqual(expect.objectContaining({ id: 'task-1', assignedAgentIds: ['worker'] }));
            await expect(service.findActiveTaskForAgent('ch-1', 'other-agent'))
                .resolves.toBeNull();
        });

        it('routes to the designated completion agent instead of the assignee', async () => {
            mockFind.mockReturnValue({
                sort: jest.fn().mockResolvedValue([taskDoc({
                    assignedAgentIds: ['worker'],
                    completionAgentId: 'lead'
                })])
            });

            await expect(service.findActiveTaskForAgent('ch-1', 'lead'))
                .resolves.toEqual(expect.objectContaining({ id: 'task-1', completionAgentId: 'lead' }));
            await expect(service.findActiveTaskForAgent('ch-1', 'worker'))
                .resolves.toBeNull();
        });
    });

    describe('recordSystemLlmChallenge', () => {
        const record: SystemLlmChallengeRecord = {
            id: 'challenge-1',
            trigger: 'completion_claim',
            stance: 'critical',
            delivery: 'tool_result',
            summary: 'summary',
            points: [{ claim: 'a', problem: 'b', evidenceNeeded: 'c' }],
            createdAt: 1
        };

        it('pushes the record onto the task metadata, only if the trigger is not already recorded', async () => {
            mockUpdateOne.mockResolvedValue({ matchedCount: 1 });

            await expect(service.recordSystemLlmChallenge('t1', 'ch-1', record)).resolves.toBe(true);

            // The filter excludes tasks that already carry this trigger, so two
            // overlapping claims cannot both record a challenge.
            expect(mockUpdateOne).toHaveBeenCalledWith(
                {
                    _id: 't1',
                    channelId: 'ch-1',
                    [`metadata.${TASK_METADATA_CHALLENGES_KEY}.trigger`]: { $ne: 'completion_claim' }
                },
                expect.objectContaining({
                    $push: { [`metadata.${TASK_METADATA_CHALLENGES_KEY}`]: record }
                })
            );
            expect(mockExists).not.toHaveBeenCalled();
        });

        it('returns false when the task exists but already carries a record for the trigger', async () => {
            mockUpdateOne.mockResolvedValue({ matchedCount: 0 });
            mockExists.mockResolvedValue({ _id: 't1' });

            await expect(service.recordSystemLlmChallenge('t1', 'ch-1', record)).resolves.toBe(false);
            expect(mockExists).toHaveBeenCalledWith({ _id: 't1', channelId: 'ch-1' });
        });

        it('rejects when the task is not found in the channel', async () => {
            mockUpdateOne.mockResolvedValue({ matchedCount: 0 });
            mockExists.mockResolvedValue(null);

            await expect(service.recordSystemLlmChallenge('t1', 'ch-1', record))
                .rejects.toThrow(/not found/i);
        });
    });
});
