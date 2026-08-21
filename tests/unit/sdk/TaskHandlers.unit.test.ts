/**
 * Unit tests for TaskHandlers.
 *
 * Covers the behaviours that were previously broken:
 *   - a rejected task handler emits a real TaskEvents.FAIL_REQUEST, so the server moves
 *     the task out of `in_progress` and agent.onTaskFailed() actually fires. It used to
 *     only call logger.error() — and the client Logger ships disabled — so the task hung
 *     in `in_progress` forever and nobody was ever told.
 *   - a missing task handler is also a task failure, not a silent warning
 *   - processedTaskAssignments is bounded rather than growing without limit
 */

import { Subscription } from 'rxjs';

jest.mock('@mxf-dev/core/events/EventBus', () => {
    const handlers: Map<string, ((payload: any) => void)[]> = new Map();
    const emitted: Array<{ socketId: string; event: string; payload: any }> = [];

    return {
        EventBus: {
            client: {
                on: jest.fn((event: string, handler: (payload: any) => void) => {
                    if (!handlers.has(event)) handlers.set(event, []);
                    handlers.get(event)!.push(handler);
                    return new Subscription(() => {
                        const eventHandlers = handlers.get(event);
                        if (!eventHandlers) return;
                        const index = eventHandlers.indexOf(handler);
                        if (index >= 0) eventHandlers.splice(index, 1);
                    });
                }),
                isRegisteredSocketConnected: jest.fn((): boolean => true),
                emitOn: jest.fn((socketId: string, event: string, payload: any) => {
                    emitted.push({ socketId, event, payload });
                }),
                emit: jest.fn(),
                off: jest.fn(),
                _deliver: (event: string, payload: any) => {
                    [...(handlers.get(event) ?? [])].forEach(h => h(payload));
                },
                _emitted: () => emitted,
                _handlerCount: (event: string): number => handlers.get(event)?.length ?? 0,
                _reset: () => {
                    handlers.clear();
                    emitted.length = 0;
                },
            },
        },
    };
});

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import { AgentEvents } from '@mxf-dev/core/events/event-definitions/AgentEvents';
import { TaskHandlers } from '@mxf-dev/sdk/handlers/TaskHandlers';
import { TaskHelper } from '@mxf-dev/sdk/services/internal/TaskHelper';

const bus = EventBus.client as any;

const AGENT_ID = 'worker-agent';
const CHANNEL_ID = 'work-channel';

/** Build an ASSIGNED payload the way the server sends it. */
interface AssignedTaskFixture {
    id: string;
    channelId: string;
    title: string;
    description: string;
    assignedAgentIds: string[];
    completionAgentId?: string;
    metadata: Record<string, unknown>;
}

interface AssignedPayloadFixture {
    agentId: string;
    channelId: string;
    data: { toAgentId: string; fromAgentId: string; task: AssignedTaskFixture };
}

const assignedPayload = (taskId: string, task: Partial<AssignedTaskFixture> = {}): AssignedPayloadFixture => ({
    agentId: 'system',
    channelId: CHANNEL_ID,
    data: {
        toAgentId: AGENT_ID,
        fromAgentId: 'planner',
        task: {
            id: taskId,
            channelId: CHANNEL_ID,
            title: 'Do the thing',
            description: 'Do the thing properly',
            assignedAgentIds: [AGENT_ID],
            metadata: {},
            ...task,
        },
    },
});

interface EmittedEvent {
    event: string;
    payload: { data: Record<string, unknown> };
}

/** Wait for the handler's fire-and-forget promise chain to settle. */
const flush = () => new Promise(resolve => setImmediate(resolve));

const failRequests = () =>
    bus._emitted().filter((e: any) => e.event === TaskEvents.FAIL_REQUEST);

describe('TaskHandlers terminal task events', () => {
    let handlers: TaskHandlers;
    let ended: jest.Mock;

    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
        bus.isRegisteredSocketConnected.mockReturnValue(true);
        handlers = new TaskHandlers(CHANNEL_ID, AGENT_ID);
        handlers.initialize();
        handlers.setTaskRequestHandler(async () => ({ ok: true }) as never);
        ended = jest.fn();
        handlers.setTaskEndedHandler(ended);
    });

    afterEach(() => {
        handlers.cleanup();
    });

    const terminal = (event: string, taskId: string): void => {
        // Shape of the server's channel broadcast for a terminal outcome.
        bus._deliver(event, {
            agentId: 'lead-agent',
            channelId: CHANNEL_ID,
            data: { taskId, fromAgentId: 'lead-agent', toAgentId: 'lead-agent', task: { id: taskId, status: 'failed' } }
        });
    };

    it('reports the assigned task as ended once when the server broadcasts its outcome', async () => {
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-1'));
        await flush();

        terminal(TaskEvents.FAILED, 'task-1');
        expect(ended).toHaveBeenCalledWith('task-1', 'failed');

        // A second broadcast for the same task (another agent's refused report,
        // a replay) must not fire again: the agent is already idle.
        terminal(TaskEvents.FAILED, 'task-1');
        expect(ended).toHaveBeenCalledTimes(1);
    });

    it('reports completion and cancellation with their outcome', async () => {
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-2'));
        await flush();
        terminal(TaskEvents.COMPLETED, 'task-2');
        expect(ended).toHaveBeenLastCalledWith('task-2', 'completed');

        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-3'));
        await flush();
        terminal(TaskEvents.CANCELLED, 'task-3');
        expect(ended).toHaveBeenLastCalledWith('task-3', 'cancelled');
    });

    it('ignores outcomes of tasks this agent was not assigned', async () => {
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-4'));
        await flush();

        terminal(TaskEvents.FAILED, 'someone-elses-task');
        expect(ended).not.toHaveBeenCalled();
    });

    it('stops reporting after cleanup', async () => {
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-5'));
        await flush();
        handlers.cleanup();

        terminal(TaskEvents.FAILED, 'task-5');
        expect(ended).not.toHaveBeenCalled();
    });
});

describe('TaskHandlers task failure reporting', () => {
    let handlers: TaskHandlers;

    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
        bus.isRegisteredSocketConnected.mockReturnValue(true);
        handlers = new TaskHandlers(CHANNEL_ID, AGENT_ID);
        handlers.initialize();
    });

    afterEach(() => {
        TaskHelper.cancelPendingOperations(CHANNEL_ID, AGENT_ID, 'test cleanup');
        handlers.cleanup();
    });

    it('emits TaskEvents.FAIL_REQUEST when the task handler rejects', async () => {
        handlers.setTaskRequestHandler(async () => {
            throw new Error('LLM provider returned 500');
        });

        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-1'));
        await flush();

        const fails = failRequests();
        expect(fails).toHaveLength(1);

        const { socketId, payload } = fails[0];
        expect(socketId).toBe(AGENT_ID);
        expect(payload.data.taskId).toBe('task-1');
        expect(payload.data.failingAgentId).toBe(AGENT_ID);
        expect(payload.data.error).toContain('LLM provider returned 500');
    });

    it('routes the failure to the task\'s own channel', async () => {
        handlers.setTaskRequestHandler(async () => {
            throw new Error('boom');
        });

        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-2'));
        await flush();

        expect(failRequests()[0].payload.channelId).toBe(CHANNEL_ID);
    });

    it('emits TaskEvents.FAIL_REQUEST when no task handler is registered at all', async () => {
        // Previously just a logger.warn() into a disabled logger: the task was assigned,
        // never run, and never failed.
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-3'));
        await flush();

        const fails = failRequests();
        expect(fails).toHaveLength(1);
        expect(fails[0].payload.data.error).toMatch(/No task request handler/i);
    });

    it('emits NO failure when the task handler succeeds', async () => {
        handlers.setTaskRequestHandler(async () => ({ ok: true }) as any);

        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-4'));
        await flush();

        expect(failRequests()).toHaveLength(0);
    });

    it('does not report a failure for a task another agent is designated to finish', async () => {
        handlers.setTaskRequestHandler(async () => {
            throw new Error('contributor hit its iteration limit');
        });
        // Shape the server sends for a task created with assignedAgentIds and a
        // completionAgentId: the designation is on the task, the metadata is the
        // creator's own (here empty) — no role flags are computed on that path.
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-6', {
            assignedAgentIds: [AGENT_ID, 'lead-agent'],
            completionAgentId: 'lead-agent',
            metadata: {}
        }));
        await flush();

        // The server would refuse the request anyway; the SDK does not send it,
        // and surfaces the participant's error on the agent error channel instead.
        expect(failRequests()).toHaveLength(0);
        const errors = (bus._emitted() as EmittedEvent[]).filter(e => e.event === AgentEvents.ERROR);
        expect(errors).toHaveLength(1);
        expect(errors[0].payload.data).toMatchObject({
            taskId: 'task-6',
            phase: 'task_execution',
            message: expect.stringContaining('contributor hit its iteration limit')
        });
    });

    it('reports a failure when the assignment names this agent as the completion agent', async () => {
        handlers.setTaskRequestHandler(async () => {
            throw new Error('lead failed');
        });
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-7', {
            assignedAgentIds: [AGENT_ID, 'helper-agent'],
            completionAgentId: AGENT_ID,
            metadata: {}
        }));
        await flush();

        expect(failRequests()).toHaveLength(1);
        expect(failRequests()[0].payload.data.taskId).toBe('task-7');
    });

    it('follows the server-computed role metadata when the task has no designation', async () => {
        handlers.setTaskRequestHandler(async () => {
            throw new Error('contributor failed');
        });
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-8', {
            assignedAgentIds: [AGENT_ID, 'lead-agent'],
            metadata: { multiAgentTask: true, isCompletionAgent: false, agentRole: 'contributor' }
        }));
        await flush();

        expect(failRequests()).toHaveLength(0);
    });

    it('does not process the same task assignment twice', async () => {
        const handler = jest.fn().mockResolvedValue({ ok: true });
        handlers.setTaskRequestHandler(handler as any);

        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-5'));
        bus._deliver(TaskEvents.ASSIGNED, assignedPayload('task-5'));
        await flush();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('bounds processedTaskAssignments instead of growing it without limit', async () => {
        handlers.setTaskRequestHandler(async () => ({ ok: true }) as any);

        // Push well past the 1000-entry cap.
        for (let i = 0; i < 1200; i++) {
            bus._deliver(TaskEvents.ASSIGNED, assignedPayload(`bulk-${i}`));
        }
        await flush();

        const processed = (handlers as any).processedTaskAssignments as Set<string>;
        expect(processed.size).toBeLessThanOrEqual(1000);

        // Oldest entries were evicted; the most recent are still remembered.
        expect(processed.has('bulk-1199')).toBe(true);
        expect(processed.has('bulk-0')).toBe(false);
    });

    it('ignores assignments addressed to a different agent', async () => {
        const handler = jest.fn().mockResolvedValue({ ok: true });
        handlers.setTaskRequestHandler(handler as any);

        const payload = assignedPayload('task-6');
        payload.data.toAgentId = 'someone-else';
        payload.data.task.assignedAgentIds = ['someone-else'];

        bus._deliver(TaskEvents.ASSIGNED, payload);
        await flush();

        expect(handler).not.toHaveBeenCalled();
        expect(failRequests()).toHaveLength(0);
    });
});

/**
 * The task lifecycle payloads have to survive createTaskEventPayload()'s fail-fast
 * validation. complete/cancel used to pass a `task` object with no title, so the
 * validator threw "Task title is required" on EVERY call and no task could be completed
 * or cancelled through the SDK at all.
 */
describe('TaskHelper lifecycle payloads', () => {
    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
        bus.isRegisteredSocketConnected.mockReturnValue(true);
    });

    afterEach(() => {
        TaskHelper.cancelPendingOperations(CHANNEL_ID, AGENT_ID, 'test cleanup');
    });

    it('returns only the persisted task id from the correlated CREATED event', async () => {
        const creation = TaskHelper.createTask(CHANNEL_ID, {
            title: 'Persist me',
            description: 'Return the database identity',
            assignedAgentIds: [AGENT_ID]
        }, AGENT_ID);
        const [request] = bus._emitted();

        expect(request.event).toBe(TaskEvents.CREATE_REQUEST);
        const requestId = request.payload.data.taskId;
        expect(requestId).toEqual(expect.any(String));

        bus._deliver(TaskEvents.CREATED, {
            agentId: AGENT_ID,
            channelId: CHANNEL_ID,
            data: {
                requestId,
                taskId: 'persisted-task-id',
                task: { id: 'persisted-task-id' }
            }
        });

        await expect(creation).resolves.toBe('persisted-task-id');
    });

    it('rejects a correlated server creation error instead of returning a synthetic id', async () => {
        const creation = TaskHelper.createTask(CHANNEL_ID, {
            title: 'Cannot persist',
            description: 'Surface the database failure',
            assignedAgentIds: [AGENT_ID]
        }, AGENT_ID);
        const [request] = bus._emitted();
        const requestId = request.payload.data.taskId;

        bus._deliver(TaskEvents.ERROR, {
            agentId: AGENT_ID,
            channelId: CHANNEL_ID,
            data: { requestId, taskId: requestId, error: 'database rejected task' }
        });

        await expect(creation).rejects.toThrow('database rejected task');
    });

    it('rejects and disposes a pending creation when its exact channel disconnects', async () => {
        const creation = TaskHelper.createTask(CHANNEL_ID, {
            title: 'Interrupted task',
            description: 'The response cannot arrive after disconnect',
            assignedAgentIds: [AGENT_ID]
        }, AGENT_ID);

        TaskHelper.cancelPendingOperations(CHANNEL_ID, AGENT_ID, 'channel disconnected');

        await expect(creation).rejects.toThrow('channel disconnected');
    });

    it('completeTask waits for the exact authoritative completion acknowledgement', async () => {
        let settled = false;
        const completion = TaskHelper.completeTask(
            't-1', AGENT_ID, CHANNEL_ID, { answer: 42 }
        ).finally((): void => { settled = true; });
        const [sent] = bus._emitted();
        expect(sent.event).toBe(TaskEvents.COMPLETE_REQUEST);
        expect(sent.payload.data.taskId).toBe('t-1');
        expect(sent.payload.data.requestId).toEqual(expect.any(String));
        expect(sent.payload.data.completingAgentId).toBe(AGENT_ID);
        expect(sent.payload.data.result).toEqual({ answer: 42 });

        await Promise.resolve();
        expect(settled).toBe(false);

        bus._deliver(TaskEvents.COMPLETED, {
            agentId: 'sibling-agent',
            channelId: CHANNEL_ID,
            data: {
                requestId: sent.payload.data.requestId,
                taskId: 't-1',
                task: { id: 't-1', status: 'completed' }
            }
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        bus._deliver(TaskEvents.COMPLETED, {
            agentId: AGENT_ID,
            channelId: CHANNEL_ID,
            data: {
                requestId: sent.payload.data.requestId,
                taskId: 't-1',
                task: { id: 't-1', status: 'completed' }
            }
        });
        await expect(completion).resolves.toBeUndefined();
        expect(bus._handlerCount(TaskEvents.COMPLETED)).toBe(0);
        expect(bus._handlerCount(TaskEvents.ERROR)).toBe(0);
    });

    it('rejects only the exact correlated lifecycle error and ignores a sibling forgery', async () => {
        const cancellation = TaskHelper.cancelTask(
            't-2', AGENT_ID, CHANNEL_ID, 'client went away'
        );
        const [sent] = bus._emitted();
        expect(sent.event).toBe(TaskEvents.CANCEL_REQUEST);
        expect(sent.payload.data.taskId).toBe('t-2');
        expect(sent.payload.data.reason).toBe('client went away');

        bus._deliver(TaskEvents.ERROR, {
            agentId: 'sibling-agent',
            channelId: CHANNEL_ID,
            data: {
                requestId: sent.payload.data.requestId,
                taskId: 't-2',
                error: 'forged rejection'
            }
        });
        bus._deliver(TaskEvents.ERROR, {
            agentId: AGENT_ID,
            channelId: CHANNEL_ID,
            data: {
                requestId: sent.payload.data.requestId,
                taskId: 't-2',
                error: 'server rejected cancellation'
            }
        });

        await expect(cancellation).rejects.toThrow('server rejected cancellation');
    });

    it('failTask resolves only after the server persists and acknowledges failure', async () => {
        const failure = TaskHelper.failTask('t-3', AGENT_ID, CHANNEL_ID, 'provider 500');
        const [sent] = bus._emitted();
        expect(sent.event).toBe(TaskEvents.FAIL_REQUEST);
        expect(sent.payload.data.taskId).toBe('t-3');
        expect(sent.payload.data.failingAgentId).toBe(AGENT_ID);
        expect(sent.payload.data.error).toBe('provider 500');

        bus._deliver(TaskEvents.FAILED, {
            agentId: AGENT_ID,
            channelId: CHANNEL_ID,
            data: {
                requestId: sent.payload.data.requestId,
                taskId: 't-3',
                task: { id: 't-3', status: 'failed' }
            }
        });
        await expect(failure).resolves.toBeUndefined();
    });

    it('accepts the server-resolved task id for a correlated current-task request', async () => {
        const completion = TaskHelper.completeTask(
            'current', AGENT_ID, CHANNEL_ID, { answer: 42 }
        );
        const [sent] = bus._emitted();

        bus._deliver(TaskEvents.COMPLETED, {
            agentId: AGENT_ID,
            channelId: CHANNEL_ID,
            data: {
                requestId: sent.payload.data.requestId,
                taskId: 'persisted-current-task',
                task: { id: 'persisted-current-task', status: 'completed' }
            }
        });

        await expect(completion).resolves.toBeUndefined();
    });

    it('fails immediately without listeners or emission when no agent socket is connected', async () => {
        bus.isRegisteredSocketConnected.mockReturnValue(false);

        await expect(
            TaskHelper.completeTask('t-4', AGENT_ID, CHANNEL_ID, { answer: 42 })
        ).rejects.toThrow(/socket.*not connected/i);

        expect(bus._emitted()).toHaveLength(0);
        expect(bus._handlerCount(TaskEvents.COMPLETED)).toBe(0);
        expect(bus._handlerCount(TaskEvents.ERROR)).toBe(0);
    });
});
