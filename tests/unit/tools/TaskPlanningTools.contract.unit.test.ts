import type { Subscription } from 'rxjs';

type EventHandler = (payload: unknown) => void;
const mockHandlers = new Map<string, Set<EventHandler>>();
const mockEmitted: Array<{ eventName: string; payload: unknown }> = [];
const mockPlanSave = jest.fn();
const mockPlanDeleteOne = jest.fn();
const mockPlanFindOne = jest.fn();
const mockTaskFindOne = jest.fn();

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
            emit: jest.fn((eventName: string, payload: unknown) => {
                mockEmitted.push({ eventName, payload });
            })
        }
    }
}));

jest.mock('@mxf-dev/core/models/plan', () => {
    const PlanModel = jest.fn().mockImplementation((input: Record<string, unknown>) => ({
        ...input,
        items: input.items,
        save: mockPlanSave
    }));
    Object.assign(PlanModel, {
        findOne: mockPlanFindOne,
        deleteOne: mockPlanDeleteOne
    });
    return { __esModule: true, default: PlanModel };
});

jest.mock('@mxf-dev/core/models/task', () => ({
    Task: { findOne: mockTaskFindOne }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        debug = jest.fn();
        info = jest.fn();
        warn = jest.fn();
        error = jest.fn();
    }
}));

import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import {
    task_create_with_plan,
    task_link_to_plan
} from '@mxf-dev/core/protocols/mcp/tools/TaskPlanningTools';
import type { McpToolHandlerResult } from '@mxf-dev/core/protocols/mcp/McpServerTypes';

const deliver = (eventName: string, payload: unknown): void => {
    for (const handler of mockHandlers.get(eventName) ?? []) {
        handler(payload);
    }
};

const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

describe('TaskPlanningTools authoritative contracts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockHandlers.clear();
        mockEmitted.length = 0;
        mockPlanSave.mockResolvedValue(undefined);
        mockPlanDeleteOne.mockResolvedValue({ deletedCount: 1 });
    });

    it('returns the persisted task id only after the correlated CREATED event', async () => {
        const resultPromise = task_create_with_plan.handler({
            title: 'Delegated review',
            description: 'Review the implementation',
            completionPlan: {
                steps: [{ title: 'Inspect', critical: true }],
                completionType: 'all_steps'
            },
            assignTo: ['worker']
        }, {
            requestId: 'tool-call',
            agentId: 'planner',
            channelId: 'channel-a'
        }) as Promise<McpToolHandlerResult>;
        await flush();

        const request = mockEmitted.find(entry => entry.eventName === TaskEvents.CREATE_REQUEST);
        expect(request).toBeDefined();
        const requestPayload = request!.payload as {
            data: { requestId: string; taskId: string };
        };
        expect(requestPayload.data.requestId).toBe(requestPayload.data.taskId);

        deliver(TaskEvents.CREATED, {
            channelId: 'channel-a',
            data: {
                requestId: requestPayload.data.requestId,
                taskId: 'persisted-task',
                task: { id: 'persisted-task' }
            }
        });

        const result = await resultPromise;
        expect(result.content.data).toEqual(expect.objectContaining({
            success: true,
            taskId: 'persisted-task'
        }));
    });

    it('rejects a correlated server error and removes the otherwise orphaned plan', async () => {
        const resultPromise = task_create_with_plan.handler({
            title: 'Rejected review',
            description: 'The database will reject this task',
            completionPlan: { steps: [{ title: 'Inspect' }] }
        }, {
            requestId: 'tool-call',
            agentId: 'planner',
            channelId: 'channel-a'
        }) as Promise<McpToolHandlerResult>;
        await flush();
        const request = mockEmitted.find(entry => entry.eventName === TaskEvents.CREATE_REQUEST)!;
        const requestId = (request.payload as { data: { requestId: string } }).data.requestId;

        deliver(TaskEvents.ERROR, {
            channelId: 'channel-a',
            data: { requestId, taskId: requestId, error: 'task persistence failed' }
        });

        await expect(resultPromise).rejects.toThrow('task persistence failed');
        expect(mockPlanDeleteOne).toHaveBeenCalledWith(expect.objectContaining({
            channelId: 'channel-a'
        }));
    });

    it('links only same-channel task and plan records and waits for the persisted update', async () => {
        mockPlanFindOne.mockResolvedValue({
            planId: 'plan-1',
            channelId: 'channel-a',
            items: [{ id: 'item-1', priority: 'high', status: 'pending' }]
        });
        mockTaskFindOne.mockResolvedValue({
            id: 'task-1',
            channelId: 'channel-a',
            assignedAgentId: 'worker',
            metadata: { retained: true }
        });

        const resultPromise = task_link_to_plan.handler({
            taskId: 'task-1',
            planId: 'plan-1',
            completionType: 'critical_steps'
        }, {
            requestId: 'tool-call',
            agentId: 'planner',
            channelId: 'channel-a'
        }) as Promise<McpToolHandlerResult>;
        await flush();

        expect(mockPlanFindOne).toHaveBeenCalledWith({ planId: 'plan-1', channelId: 'channel-a' });
        expect(mockTaskFindOne).toHaveBeenCalledWith({ _id: 'task-1', channelId: 'channel-a' });
        const request = mockEmitted.find(entry => entry.eventName === TaskEvents.UPDATE_REQUEST)!;
        const requestId = (request.payload as { data: { requestId: string } }).data.requestId;

        deliver(TaskEvents.PROGRESS_UPDATED, {
            channelId: 'channel-a',
            data: {
                requestId,
                taskId: 'task-1',
                task: { id: 'task-1' }
            }
        });

        const result = await resultPromise;
        expect(result.content.data).toEqual(expect.objectContaining({
            success: true,
            taskId: 'task-1',
            monitoringConfigured: true
        }));
    });
});
