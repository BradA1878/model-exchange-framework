import { TaskEffectivenessModel } from '../../../packages/core/src/models/taskEffectiveness';
import { TaskEffectivenessService } from '../../../packages/core/src/services/TaskEffectivenessService';
import {
    TaskDefinition,
    TaskEffectivenessMetrics
} from '../../../packages/core/src/types/EffectivenessTypes';

const createDefinition = (
    taskId: string,
    agentId: string,
    channelId: string,
    taskType = 'analysis'
): TaskDefinition => ({
    taskId,
    agentId,
    channelId,
    taskType,
    description: `${agentId} task`
});

const createCompletedMetrics = (
    taskId: string,
    taskType: string,
    success: boolean
): TaskEffectivenessMetrics => ({
    taskId,
    metadata: {
        type: taskType,
        description: `${taskType} task`,
        startTime: 100,
        endTime: 200,
        status: success ? 'completed' : 'failed'
    },
    performance: {
        completionTime: 100,
        stepCount: 1,
        toolsUsed: 0,
        uniqueTools: [],
        agentInteractions: 0,
        humanInterventions: 0,
        autonomyScore: 1
    },
    quality: {
        goalAchieved: success,
        completenessScore: success ? 1 : 0,
        iterationCount: 0,
        errorCount: 0,
        customMetrics: {}
    },
    resources: {
        totalComputeTime: 0,
        peakConcurrentAgents: 0,
        memoryOperations: 0
    },
    collaboration: {
        participatingAgents: [],
        messageCount: 0,
        coordinationCount: 0,
        knowledgeTransfers: 0,
        collaborationScore: 0
    }
});

describe('TaskEffectivenessService tenant scoping', () => {
    const service = TaskEffectivenessService.getInstance();
    const internalState = service as unknown as {
        activeTasks: Map<string, TaskEffectivenessMetrics>;
        taskDefinitions: Map<string, TaskDefinition>;
        taskEvents: Map<string, unknown[]>;
    };

    beforeEach(() => {
        internalState.activeTasks.clear();
        internalState.taskDefinitions.clear();
        internalState.taskEvents.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('isolates active state when two tenants reuse the same task ID', async () => {
        service.startTask(createDefinition('shared-task', 'agent-a', 'channel-a'));
        service.startTask(createDefinition('shared-task', 'agent-b', 'channel-b'));

        service.recordEvent({
            eventId: 'event-a',
            taskId: 'shared-task',
            agentId: 'agent-a',
            channelId: 'channel-a',
            timestamp: Date.now(),
            type: 'step',
            details: {}
        });
        service.updateQuality('shared-task', 'agent-a', 'channel-a', {
            completenessScore: 0.75
        });

        expect(() => service.recordEvent({
            eventId: 'foreign-event',
            taskId: 'shared-task',
            agentId: 'agent-a',
            channelId: 'channel-b',
            timestamp: Date.now(),
            type: 'error',
            details: {}
        })).toThrow('was not found for this agent and channel');
        expect(() => service.updateQuality(
            'shared-task',
            'agent-b',
            'channel-a',
            { completenessScore: 1 }
        )).toThrow('was not found for this agent and channel');

        const tenantA = await service.getTaskMetrics('shared-task', 'agent-a', 'channel-a');
        const tenantB = await service.getTaskMetrics('shared-task', 'agent-b', 'channel-b');

        expect(tenantA?.performance.stepCount).toBe(1);
        expect(tenantA?.quality.completenessScore).toBe(0.75);
        expect(tenantA?.quality.errorCount).toBe(0);
        expect(tenantB?.performance.stepCount).toBe(0);
        expect(tenantB?.quality.completenessScore).toBe(0);
    });

    it('uses the exact composite tenant predicate for completion and leaves the other tenant active', async () => {
        service.startTask(createDefinition('shared-task', 'agent-a', 'channel-a'));
        service.startTask(createDefinition('shared-task', 'agent-b', 'channel-b'));
        const exec = jest.fn().mockResolvedValue({});
        const updateSpy = jest.spyOn(TaskEffectivenessModel, 'findOneAndUpdate')
            .mockReturnValue({ exec } as never);

        await expect(service.completeTask(
            'shared-task',
            'agent-a',
            'channel-b',
            true
        )).resolves.toBeNull();
        expect(updateSpy).not.toHaveBeenCalled();

        await expect(service.completeTask(
            'shared-task',
            'agent-a',
            'channel-a',
            true
        )).resolves.not.toBeNull();
        expect(updateSpy).toHaveBeenCalledWith(
            { taskId: 'shared-task', agentId: 'agent-a', channelId: 'channel-a' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    agentId: 'agent-a',
                    channelId: 'channel-a'
                })
            }),
            expect.objectContaining({ upsert: true, runValidators: true })
        );
        expect(exec).toHaveBeenCalledTimes(1);

        const tenantB = await service.getTaskMetrics('shared-task', 'agent-b', 'channel-b');
        expect(tenantB?.metadata.status).toBe('in_progress');
    });

    it('binds persisted item reads and analytics queries to exact agent and channel', async () => {
        const findOneExec = jest.fn().mockResolvedValue(null);
        const findOneSpy = jest.spyOn(TaskEffectivenessModel, 'findOne')
            .mockReturnValue({ exec: findOneExec } as never);

        await expect(service.getTaskMetrics(
            'shared-task',
            'agent-a',
            'channel-a'
        )).resolves.toBeNull();
        expect(findOneSpy).toHaveBeenCalledWith({
            taskId: 'shared-task',
            agentId: 'agent-a',
            channelId: 'channel-a'
        });

        const tenantDocuments = {
            'agent-a': [{
                taskId: 'shared-task',
                agentId: 'agent-a',
                channelId: 'channel-a',
                metrics: createCompletedMetrics('shared-task', 'research', true)
            }],
            'agent-b': [{
                taskId: 'shared-task',
                agentId: 'agent-b',
                channelId: 'channel-b',
                metrics: createCompletedMetrics('shared-task', 'development', false)
            }]
        } as const;
        const queries: Array<Record<string, unknown>> = [];
        jest.spyOn(TaskEffectivenessModel, 'find').mockImplementation(((query: Record<string, unknown>) => {
            queries.push(query);
            const documents = query.agentId === 'agent-a'
                ? tenantDocuments['agent-a']
                : tenantDocuments['agent-b'];
            return { exec: jest.fn().mockResolvedValue(documents) } as never;
        }) as never);

        const tenantA = await service.getAnalytics(0, 1000, 'agent-a', 'channel-a');
        const tenantB = await service.getAnalytics(0, 1000, 'agent-b', 'channel-b');

        expect(queries).toEqual([
            expect.objectContaining({ agentId: 'agent-a', channelId: 'channel-a' }),
            expect.objectContaining({ agentId: 'agent-b', channelId: 'channel-b' })
        ]);
        expect(Object.keys(tenantA.byTaskType)).toEqual(['research']);
        expect(Object.keys(tenantA.byChannel)).toEqual(['channel-a']);
        expect(Object.keys(tenantB.byTaskType)).toEqual(['development']);
        expect(Object.keys(tenantB.byChannel)).toEqual(['channel-b']);
    });
});
