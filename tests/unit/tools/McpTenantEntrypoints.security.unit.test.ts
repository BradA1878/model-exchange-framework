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
        server: { emit: jest.fn(), on: jest.fn() },
        client: { emit: jest.fn(), on: jest.fn() }
    }
}));

jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: { getInstance: jest.fn() }
}));

jest.mock('@mxf-dev/core/database/adapters/mongodb/MongoDagRepository', () => ({
    MongoDagRepository: { getInstance: jest.fn() }
}));

jest.mock('@mxf-dev/core/config/dag.config', () => ({
    isDagEnabled: jest.fn().mockReturnValue(true),
    getDagConfig: jest.fn().mockReturnValue({
        defaultReadyTasksLimit: 10,
        maxReadyTasksLimit: 100
    })
}));

jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: { getInstance: jest.fn() }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { ChannelService } from '../../../src/server/socket/services/ChannelService';
import { TaskService } from '../../../src/server/socket/services/TaskService';
import { MongoDagRepository } from '@mxf-dev/core/database/adapters/mongodb/MongoDagRepository';
import { AgentService } from '../../../src/server/socket/services/AgentService';
import { MxpMiddleware } from '@mxf-dev/core/middleware/MxpMiddleware';
import CoordinationModel, {
    CoordinationState,
    CoordinationType
} from '@mxf-dev/core/models/coordination';
import {
    createTaskTool,
    getTaskStatusTool,
    queryTasksTool,
    updateTaskTool
} from '../../../src/server/mcp/tools/TaskBridgeTools';
import {
    dag_get_blocking_tasks,
    dag_get_ready_tasks
} from '../../../src/server/mcp/tools/DagTools';
import {
    agentBroadcastTool,
    agentCoordinateTool,
    agentDiscoverTool,
    agentMessageTool
} from '../../../src/server/mcp/tools/AgentCommunicationTools';
import {
    coordinationAcceptTool,
    coordinationListTool,
    coordinationRequestTool,
    coordinationStatusTool,
    coordinationUpdateTool
} from '../../../src/server/mcp/tools/CoordinationTools';

const contextA = {
    requestId: 'request-a',
    agentId: 'agent-a',
    channelId: 'channel-a'
};

const taskA = {
    id: 'task-a',
    title: 'Task A',
    description: 'A-scoped work',
    channelId: 'channel-a',
    status: 'pending',
    priority: 'medium'
};

const channelMembers: Record<string, Set<string>> = {
    'channel-a': new Set(['agent-a', 'agent-b', 'agent-c']),
    'channel-b': new Set(['agent-a', 'foreign-agent'])
};

const channelService = {
    isParticipant: jest.fn((channelId: string, agentId: string) =>
        channelMembers[channelId]?.has(agentId) ?? false
    )
};

const taskService = {
    createTask: jest.fn(),
    getTasks: jest.fn(),
    getTaskInChannel: jest.fn(),
    updateTaskInChannel: jest.fn(),
    handleTaskCompletion: jest.fn()
};

const dagRepository = {
    getReadyTasks: jest.fn(),
    getBlockingTasks: jest.fn(),
    validateDependency: jest.fn(),
    getExecutionOrder: jest.fn(),
    getParallelGroups: jest.fn(),
    getCriticalPath: jest.fn(),
    getStats: jest.fn()
};

const agentService = {
    getActiveAgentsInChannel: jest.fn()
};

const emitted = EventBus.server.emit as jest.Mock;

function resultData(result: unknown): Record<string, unknown> {
    return (result as { content: { data: Record<string, unknown> } }).content.data;
}

describe('server MCP tenant entrypoints', () => {
    let coordinationFindOne: jest.SpyInstance;
    let coordinationFindOneAndUpdate: jest.SpyInstance;
    let coordinationFind: jest.SpyInstance;
    let coordinationSave: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        (ChannelService.getInstance as jest.Mock).mockReturnValue(channelService);
        (TaskService.getInstance as jest.Mock).mockReturnValue(taskService);
        (MongoDagRepository.getInstance as jest.Mock).mockReturnValue(dagRepository);
        (AgentService.getInstance as jest.Mock).mockReturnValue(agentService);

        coordinationFindOne = jest.spyOn(CoordinationModel, 'findOne');
        coordinationFindOneAndUpdate = jest.spyOn(CoordinationModel, 'findOneAndUpdate');
        coordinationFind = jest.spyOn(CoordinationModel, 'find');
        coordinationSave = jest.spyOn(CoordinationModel.prototype, 'save')
            .mockImplementation(async function(this: typeof CoordinationModel.prototype) {
                return this;
            });
    });

    afterEach(() => {
        coordinationFindOne.mockRestore();
        coordinationFindOneAndUpdate.mockRestore();
        coordinationFind.mockRestore();
        coordinationSave.mockRestore();
    });

    describe('TaskBridgeTools', () => {
        it('rejects a caller-chosen foreign channel before querying', async () => {
            const result = await queryTasksTool.handler({ channelId: 'channel-b' }, contextA);

            expect(result.success).toBe(false);
            expect(taskService.getTasks).not.toHaveBeenCalled();
        });

        it('supports a cold exact-context task query without socket membership state', async () => {
            taskService.getTasks.mockResolvedValueOnce([taskA]);

            const result = await queryTasksTool.handler({}, contextA);

            expect(result.success).toBe(true);
            expect(taskService.getTasks).toHaveBeenCalledWith({
                channelId: 'channel-a',
                status: undefined,
                assignedAgentId: undefined
            });
            expect(channelService.isParticipant).not.toHaveBeenCalled();
        });

        it('uses the scoped service mutation and never forwards a model-supplied channel', async () => {
            taskService.updateTaskInChannel.mockResolvedValueOnce({ ...taskA, status: 'in_progress' });

            const result = await updateTaskTool.handler({
                taskId: 'task-a',
                progress: 40,
                status: 'in_progress',
                ignoredField: 'must-not-cross'
            }, contextA);

            expect(result.success).toBe(true);
            expect(taskService.updateTaskInChannel).toHaveBeenCalledWith(
                'task-a',
                'channel-a',
                { progress: 40 }
            );
        });

        it('rejects a foreign channel override before any task mutation', async () => {
            const result = await updateTaskTool.handler({
                taskId: 'task-b',
                channelId: 'channel-b',
                progress: 80,
                status: 'completed'
            }, contextA);

            expect(result.success).toBe(false);
            expect(taskService.updateTaskInChannel).not.toHaveBeenCalled();
        });

        it('does not create when a dependency is absent from the authenticated channel', async () => {
            taskService.getTaskInChannel.mockResolvedValueOnce(null);

            const result = await createTaskTool.handler({
                title: 'poison attempt',
                description: 'foreign dependency',
                dependsOn: ['foreign-task']
            }, contextA);

            expect(result.success).toBe(false);
            expect(taskService.getTaskInChannel).toHaveBeenCalledWith('foreign-task', 'channel-a');
            expect(taskService.createTask).not.toHaveBeenCalled();
        });

        it('scopes task status lookup at the database-facing service method', async () => {
            taskService.getTaskInChannel.mockResolvedValueOnce(taskA);

            const result = await getTaskStatusTool.handler({ taskId: 'task-a' }, contextA);

            expect(result.success).toBe(true);
            expect(taskService.getTaskInChannel).toHaveBeenCalledWith('task-a', 'channel-a');
            expect(taskService.getTasks).not.toHaveBeenCalled();
        });
    });

    describe('DagTools', () => {
        it('rejects a caller-chosen foreign channel before touching the DAG repository', async () => {
            const result = await dag_get_ready_tasks.handler({ channelId: 'channel-b' }, contextA);

            expect(result.success).toBe(false);
            expect(dagRepository.getReadyTasks).not.toHaveBeenCalled();
        });

        it('fails closed when a repository task ID cannot be resolved in the exact channel', async () => {
            dagRepository.getReadyTasks.mockResolvedValueOnce(['foreign-task']);
            taskService.getTasks.mockResolvedValueOnce([]);

            const result = await dag_get_ready_tasks.handler({}, contextA);

            expect(result.success).toBe(false);
            expect(result.readyTasks).toEqual([]);
            expect(JSON.stringify(result)).not.toContain('unknown');
            expect(dagRepository.getReadyTasks).toHaveBeenCalledWith('channel-a', { limit: 10 });
        });

        it('requires the queried task itself to exist in-channel before reading blockers', async () => {
            taskService.getTaskInChannel.mockResolvedValueOnce(null);

            const result = await dag_get_blocking_tasks.handler({ taskId: 'foreign-task' }, contextA);

            expect(result.success).toBe(false);
            expect(taskService.getTaskInChannel).toHaveBeenCalledWith('foreign-task', 'channel-a');
            expect(dagRepository.getBlockingTasks).not.toHaveBeenCalled();
        });

        it('returns same-channel DAG task metadata', async () => {
            dagRepository.getReadyTasks.mockResolvedValueOnce(['task-a']);
            taskService.getTasks.mockResolvedValueOnce([taskA]);

            const result = await dag_get_ready_tasks.handler({}, contextA);

            expect(result).toEqual(expect.objectContaining({
                success: true,
                readyTasks: [{ id: 'task-a', title: 'Task A', status: 'pending' }]
            }));
        });
    });

    describe('AgentCommunicationTools', () => {
        it('blocks a foreign target without enumerating agents or emitting an event', async () => {
            const result = await agentMessageTool.handler({
                targetAgentId: 'foreign-agent',
                message: 'secret'
            }, contextA);

            expect(resultData(result).error).toContain('not current participants');
            expect(emitted).not.toHaveBeenCalled();
            expect(agentService.getActiveAgentsInChannel).not.toHaveBeenCalled();
        });

        it('validates every broadcast target before emitting any event', async () => {
            const result = await agentBroadcastTool.handler({
                targetAgentIds: ['agent-b', 'foreign-agent'],
                message: 'partial delivery must not happen'
            }, contextA);

            expect(resultData(result).error).toContain('not current participants');
            expect(emitted).not.toHaveBeenCalled();
        });

        it('emits a same-channel direct message without claiming delivery', async () => {
            const result = await agentMessageTool.handler({
                targetAgentId: 'agent-b',
                message: 'same tenant'
            }, contextA);

            expect(resultData(result)).toEqual(expect.objectContaining({
                targetAgent: 'agent-b',
                eventEmitted: true
            }));
            expect(resultData(result)).not.toHaveProperty('sent');
            expect(emitted).toHaveBeenCalledTimes(1);
        });

        it('fails closed without emission when forced encryption cannot be applied', async () => {
            const processOutgoing = jest.spyOn(MxpMiddleware, 'processOutgoing')
                .mockRejectedValueOnce(new Error('encryption unavailable'));

            const result = await agentMessageTool.handler({
                targetAgentId: 'agent-b',
                message: 'must remain secret',
                mxpOptions: {
                    enableMxp: false,
                    preferredFormat: 'natural-language',
                    forceEncryption: true
                }
            }, contextA);

            expect(processOutgoing).toHaveBeenCalled();
            expect(resultData(result).error).toContain('MXP processing failed');
            expect(emitted).not.toHaveBeenCalled();
            processOutgoing.mockRestore();
        });

        it('rejects cross-channel discovery before querying or emitting', async () => {
            const result = await agentDiscoverTool.handler({ channelId: 'channel-b' }, contextA);

            expect(resultData(result).error).toContain('does not match');
            expect(agentService.getActiveAgentsInChannel).not.toHaveBeenCalled();
            expect(emitted).not.toHaveBeenCalled();
        });

        it('rejects a foreign coordination target before emitting any request', async () => {
            const result = await agentCoordinateTool.handler({
                targetAgentIds: ['agent-b', 'foreign-agent'],
                coordinationType: 'collaborate',
                taskDescription: 'must be all-or-nothing'
            }, contextA);

            expect(resultData(result).error).toContain('not current participants');
            expect(emitted).not.toHaveBeenCalled();
        });

        it('reports same-channel coordination as requested without assuming acceptance', async () => {
            const result = await agentCoordinateTool.handler({
                targetAgentIds: ['agent-b'],
                coordinationType: 'collaborate',
                taskDescription: 'same tenant'
            }, contextA);

            expect(resultData(result)).toEqual(expect.objectContaining({
                status: 'requested',
                requestedAgents: ['agent-b'],
                notificationsEmitted: 1
            }));
            expect(resultData(result)).not.toHaveProperty('acceptedAgents');
            expect(emitted).toHaveBeenCalledTimes(1);
        });
    });

    describe('CoordinationTools', () => {
        const coordination = {
            _id: 'mongo-coord-a',
            coordinationId: 'coord-a',
            type: CoordinationType.COLLABORATE,
            state: CoordinationState.REQUESTED,
            requestingAgent: 'agent-a',
            targetAgents: ['agent-b', 'agent-c'],
            acceptedAgents: [],
            rejectedAgents: [],
            taskDescription: 'same channel',
            createdAt: new Date(1),
            updatedAt: new Date(1)
        };

        it('rejects a foreign request target before persistence or emission', async () => {
            const result = await coordinationRequestTool.handler({
                targetAgents: ['foreign-agent'],
                coordinationType: CoordinationType.COLLABORATE,
                taskDescription: 'cross tenant'
            }, contextA);

            expect(resultData(result).error).toContain('not current participants');
            expect(coordinationSave).not.toHaveBeenCalled();
            expect(emitted).not.toHaveBeenCalled();
        });

        it('persists and emits a same-channel request only after validating all targets', async () => {
            const result = await coordinationRequestTool.handler({
                targetAgents: ['agent-b'],
                coordinationType: CoordinationType.COLLABORATE,
                taskDescription: 'same tenant'
            }, contextA);

            expect(resultData(result)).toEqual(expect.objectContaining({
                status: 'requested',
                targetAgents: ['agent-b']
            }));
            expect(coordinationSave).toHaveBeenCalledTimes(1);
            expect(emitted).toHaveBeenCalledTimes(1);
        });

        it('binds status reads to exact channel and actor at the database query', async () => {
            coordinationFindOne.mockResolvedValueOnce(null);

            const result = await coordinationStatusTool.handler({ coordinationId: 'coord-shared' }, contextA);

            expect(resultData(result).error).toContain('not found');
            expect(coordinationFindOne).toHaveBeenCalledWith({
                coordinationId: 'coord-shared',
                channelId: 'channel-a',
                $or: [
                    { requestingAgent: 'agent-a' },
                    { targetAgents: 'agent-a' }
                ]
            });
            expect(coordinationFindOneAndUpdate).not.toHaveBeenCalled();
            expect(emitted).not.toHaveBeenCalled();
        });

        it('binds collection reads to the exact channel at the database query', async () => {
            const limit = jest.fn().mockResolvedValue([]);
            const sort = jest.fn().mockReturnValue({ limit });
            coordinationFind.mockReturnValueOnce({ sort });

            const result = await coordinationListTool.handler({}, contextA);

            expect(resultData(result)).toEqual({ coordinations: [], total: 0 });
            expect(coordinationFind).toHaveBeenCalledWith({
                channelId: 'channel-a',
                $or: [
                    { requestingAgent: 'agent-a' },
                    { targetAgents: 'agent-a' },
                    { acceptedAgents: 'agent-a' }
                ]
            });
        });

        it('lets a present party accept while another party is offline', async () => {
            // agent-c dropped its socket; the coordination it was asked to join
            // must still be workable by the parties that are present.
            channelMembers['channel-a'].delete('agent-c');
            try {
                const accepted = { ...coordination, acceptedAgents: ['agent-b'] };
                coordinationFindOne.mockResolvedValueOnce(coordination);
                coordinationFindOneAndUpdate.mockResolvedValueOnce(accepted);

                const result = await coordinationAcceptTool.handler(
                    { coordinationId: 'coord-a' },
                    { ...contextA, agentId: 'agent-b' }
                );

                expect(resultData(result).status).toBe('accepted');
                expect(coordinationFindOneAndUpdate).toHaveBeenCalledTimes(1);
            } finally {
                channelMembers['channel-a'].add('agent-c');
            }
        });

        it('lists coordinations whose other parties are offline', async () => {
            channelMembers['channel-a'].delete('agent-c');
            try {
                const limit = jest.fn().mockResolvedValue([coordination]);
                const sort = jest.fn().mockReturnValue({ limit });
                coordinationFind.mockReturnValueOnce({ sort });

                const result = await coordinationListTool.handler({}, contextA);

                expect(resultData(result)).toEqual(expect.objectContaining({
                    total: 1,
                    coordinations: [expect.objectContaining({ coordinationId: 'coord-a' })]
                }));
            } finally {
                channelMembers['channel-a'].add('agent-c');
            }
        });

        it('still refuses a caller who is not a current participant of the channel', async () => {
            const result = await coordinationStatusTool.handler(
                { coordinationId: 'coord-a' },
                { ...contextA, agentId: 'foreign-agent' }
            );

            expect(resultData(result).error).toContain('not a current participant');
            expect(coordinationFindOne).not.toHaveBeenCalled();
        });

        it('performs acceptance through an atomic exact-channel target predicate', async () => {
            const accepted = { ...coordination, acceptedAgents: ['agent-b'] };
            coordinationFindOne.mockResolvedValueOnce(coordination);
            coordinationFindOneAndUpdate.mockResolvedValueOnce(accepted);

            const result = await coordinationAcceptTool.handler(
                { coordinationId: 'coord-a' },
                { ...contextA, agentId: 'agent-b' }
            );

            expect(resultData(result).status).toBe('accepted');
            expect(coordinationFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    coordinationId: 'coord-a',
                    channelId: 'channel-a',
                    targetAgents: 'agent-b',
                    acceptedAgents: { $ne: 'agent-b' },
                    'rejectedAgents.agentId': { $ne: 'agent-b' }
                }),
                { $addToSet: { acceptedAgents: 'agent-b' } },
                { new: true, runValidators: true }
            );
            expect(emitted).toHaveBeenCalledTimes(1);
        });

        it('does not mutate or emit when the scoped coordination lookup misses', async () => {
            coordinationFindOne.mockResolvedValueOnce(null);

            const result = await coordinationUpdateTool.handler({
                coordinationId: 'foreign-coord',
                state: CoordinationState.IN_PROGRESS
            }, contextA);

            expect(resultData(result).error).toContain('not found');
            expect(coordinationFindOne).toHaveBeenCalledWith(expect.objectContaining({
                coordinationId: 'foreign-coord',
                channelId: 'channel-a'
            }));
            expect(coordinationFindOneAndUpdate).not.toHaveBeenCalled();
            expect(emitted).not.toHaveBeenCalled();
        });
    });
});
