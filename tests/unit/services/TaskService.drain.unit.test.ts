const mockDagService = {
    isEnabled: jest.fn(() => true),
    getDag: jest.fn(() => undefined),
    addTask: jest.fn(),
    buildDag: jest.fn(),
};

jest.mock('@mxf-dev/core/config/dag.config', () => ({
    isDagEnabled: jest.fn(() => true),
    isDagEnforcementEnabled: jest.fn(() => false),
}));

jest.mock('@mxf-dev/core/services/dag/TaskDagService', () => ({
    TaskDagService: {
        getInstance: (): typeof mockDagService => mockDagService,
        shutdownExisting: jest.fn(() => false),
    },
}));

jest.mock('../../../src/server/socket/services/EphemeralEventPatternService', () => ({
    EphemeralEventPatternService: {
        getInstance: (): object => ({}),
    },
}));

jest.mock('../../../src/server/socket/services/TaskCompletionMonitoringService', () => ({
    TaskCompletionMonitoringService: {
        shutdownExisting: jest.fn(() => false),
    },
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createTaskEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { TaskService } from '../../../src/server/socket/services/TaskService';

type DeferredTaskHandler = (task: unknown) => Promise<void>;
type TaskHandlerName = 'handleTaskCreated' | 'handleTaskAssigned' | 'handleTaskCompleted';

interface TaskServiceDrainInternals {
    handleTaskCreated: DeferredTaskHandler;
    handleTaskAssigned: DeferredTaskHandler;
    handleTaskCompleted: DeferredTaskHandler;
    addTaskToDag(task: Record<string, unknown>): Promise<void>;
    buildChannelDag(channelId: string): Promise<void>;
}

const task = {
    id: 'task-a',
    channelId: 'channel-a',
    title: 'Deferred orchestration task',
    description: 'Keep orchestration work inside shutdown drain',
    assignmentStrategy: 'none',
    status: 'pending',
};

describe('TaskService accepted-work drain', () => {
    let service: TaskService;
    let internals: TaskServiceDrainInternals;

    beforeEach(() => {
        EventBus.reset();
        (TaskService as unknown as { instance: TaskService | undefined }).instance = undefined;
        service = TaskService.getInstance();
        internals = service as unknown as TaskServiceDrainInternals;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        service.shutdown();
        EventBus.reset();
        (TaskService as unknown as { instance: TaskService | undefined }).instance = undefined;
    });

    it.each([
        [Events.Task.CREATED, 'handleTaskCreated'],
        [Events.Task.ASSIGNED, 'handleTaskAssigned'],
        [Events.Task.COMPLETED, 'handleTaskCompleted'],
    ] as const)(
        'keeps %s orchestration inside EventBus.drain()',
        async (eventName, handlerName: TaskHandlerName) => {
            let releaseHandler!: () => void;
            const deferredHandler = new Promise<void>(resolve => {
                releaseHandler = resolve;
            });
            jest.spyOn(internals, handlerName).mockReturnValueOnce(deferredHandler);

            EventBus.server.emit(
                eventName,
                createTaskEventPayload(eventName, 'agent-a', 'channel-a', {
                    taskId: task.id,
                    task,
                })
            );
            expect(EventBus.server.pendingHandlerCount()).toBe(1);

            let drainSettled = false;
            const drain = EventBus.drain().then((): void => {
                drainSettled = true;
            });
            await Promise.resolve();

            expect(drainSettled).toBe(false);
            releaseHandler();
            await drain;

            expect(EventBus.server.pendingHandlerCount()).toBe(0);
        }
    );

    it('awaits initial DAG construction before task creation can settle', async () => {
        let releaseDagBuild!: () => void;
        const deferredDagBuild = new Promise<void>(resolve => {
            releaseDagBuild = resolve;
        });
        const buildChannelDag = jest
            .spyOn(internals, 'buildChannelDag')
            .mockReturnValueOnce(deferredDagBuild);

        let addSettled = false;
        const add = internals.addTaskToDag(task).then((): void => {
            addSettled = true;
        });
        await Promise.resolve();

        expect(buildChannelDag).toHaveBeenCalledWith('channel-a');
        expect(addSettled).toBe(false);

        releaseDagBuild();
        await add;
        expect(addSettled).toBe(true);
    });
});
