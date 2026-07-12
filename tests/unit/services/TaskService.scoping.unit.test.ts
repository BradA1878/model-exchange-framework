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

jest.mock('@mxf-dev/core/models/task', () => ({
    Task: {
        findOne: jest.fn(),
        findById: jest.fn(),
        findByIdAndUpdate: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn(),
        find: jest.fn()
    }
}));

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
    EventBus: { server: { emit: jest.fn(), on: jest.fn() } }
}));

jest.mock('@mxf-dev/core/config/dag.config', () => ({
    isDagEnabled: jest.fn().mockReturnValue(false),
    isDagEnforcementEnabled: jest.fn().mockReturnValue(false)
}));

jest.mock('@mxf-dev/core/services/dag/TaskDagService', () => ({
    TaskDagService: {
        getInstance: jest.fn().mockReturnValue({
            isEnabled: jest.fn().mockReturnValue(false),
            getBlockingTasks: jest.fn().mockReturnValue([]),
            updateTaskStatus: jest.fn(),
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
        getInstance: jest.fn().mockReturnValue({ startMonitoring: jest.fn() })
    }
}));

import { Task } from '@mxf-dev/core/models/task';
import { TaskService } from '../../../src/server/socket/services/TaskService';

const mockFindOne = Task.findOne as jest.Mock;
const mockFindByIdAndUpdate = Task.findByIdAndUpdate as jest.Mock;
const mockFindOneAndUpdate = Task.findOneAndUpdate as jest.Mock;

/** A stored task document as the service reads it. */
const taskDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: { toString: () => 'task-1' },
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
    createdBy: 'user-1',
    progress: 0,
    ...overrides
});

describe('TaskService scoping', () => {
    let service: TaskService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = TaskService.getInstance();
        // updateTask re-reads the task before writing; the scoped lookup happens first
        (Task.findById as jest.Mock).mockResolvedValue(taskDoc());
    });

    describe('updateTaskInChannel', () => {
        it('updates a task that is in the caller\'s channel', async () => {
            mockFindOne.mockResolvedValue(taskDoc());
            mockFindByIdAndUpdate.mockResolvedValue(taskDoc({ status: 'completed' }));

            const result = await service.updateTaskInChannel('task-1', 'channel-a', {
                status: 'completed'
            });

            expect(mockFindOne).toHaveBeenCalledWith({ _id: 'task-1', channelId: 'channel-a' });
            expect(result.status).toBe('completed');
        });

        it('refuses a task that belongs to another channel', async () => {
            // The scoped query finds nothing, because the task is not in channel-b
            mockFindOne.mockResolvedValue(null);

            await expect(
                service.updateTaskInChannel('task-1', 'channel-b', { status: 'completed' })
            ).rejects.toThrow(/not found in channel channel-b/);

            expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('does not reveal whether the task exists elsewhere', async () => {
            mockFindOne.mockResolvedValue(null);

            await expect(
                service.updateTaskInChannel('task-1', 'channel-b', { status: 'cancelled' })
            ).rejects.toThrow(/not found in channel/);
        });

        it('allows the assignee to change state when assignment is required', async () => {
            mockFindOne.mockResolvedValue(taskDoc({ assignedAgentId: 'agent-1' }));
            mockFindByIdAndUpdate.mockResolvedValue(taskDoc({ status: 'completed' }));

            await expect(
                service.updateTaskInChannel(
                    'task-1',
                    'channel-a',
                    { status: 'completed' },
                    { requireAssignedAgentId: 'agent-1' }
                )
            ).resolves.toBeDefined();
        });

        it('refuses a non-assignee from completing someone else\'s task', async () => {
            mockFindOne.mockResolvedValue(taskDoc({ assignedAgentId: 'agent-1' }));

            await expect(
                service.updateTaskInChannel(
                    'task-1',
                    'channel-a',
                    { status: 'completed' },
                    { requireAssignedAgentId: 'agent-2' }
                )
            ).rejects.toThrow(/not assigned to task/);

            expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('accepts an assignee listed in a multi-agent assignment', async () => {
            mockFindOne.mockResolvedValue(
                taskDoc({ assignedAgentId: undefined, assignedAgentIds: ['agent-2', 'agent-3'] })
            );
            mockFindByIdAndUpdate.mockResolvedValue(taskDoc({ status: 'completed' }));

            await expect(
                service.updateTaskInChannel(
                    'task-1',
                    'channel-a',
                    { status: 'completed' },
                    { requireAssignedAgentId: 'agent-3' }
                )
            ).resolves.toBeDefined();
        });

        it('rejects a blank channelId rather than matching everything', async () => {
            await expect(
                service.updateTaskInChannel('task-1', '', { status: 'completed' })
            ).rejects.toThrow();

            expect(mockFindOne).not.toHaveBeenCalled();
        });

        it('rejects a blank taskId', async () => {
            await expect(
                service.updateTaskInChannel('', 'channel-a', { status: 'completed' })
            ).rejects.toThrow();

            expect(mockFindOne).not.toHaveBeenCalled();
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

    describe('atomic claim', () => {
        it('claims only while the task is pending and unassigned', async () => {
            const pendingTask = taskDoc({ status: 'pending', assignedAgentId: undefined });

            (Task.findById as jest.Mock).mockResolvedValue(pendingTask);
            mockFindOneAndUpdate.mockResolvedValue(
                taskDoc({ status: 'assigned', assignedAgentId: 'agent-1' })
            );

            const agentService = require('../../../src/server/socket/services/AgentService').AgentService;
            agentService.getInstance().getActiveAgentsInChannel.mockResolvedValue([
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

            const agentService = require('../../../src/server/socket/services/AgentService').AgentService;
            agentService.getInstance().getActiveAgentsInChannel.mockResolvedValue([
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

            const agentService = require('../../../src/server/socket/services/AgentService').AgentService;
            agentService.getInstance().getActiveAgentsInChannel.mockResolvedValue([
                { id: 'agent-1', role: 'worker' }
            ]);

            await expect(service.assignTaskIntelligently('task-1'))
                .rejects.toThrow(/claimed by another agent/);
        });
    });
});
