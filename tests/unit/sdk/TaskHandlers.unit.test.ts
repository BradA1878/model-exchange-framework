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
                    return { unsubscribe: jest.fn() } as unknown as Subscription;
                }),
                emitOn: jest.fn((socketId: string, event: string, payload: any) => {
                    emitted.push({ socketId, event, payload });
                }),
                emit: jest.fn(),
                off: jest.fn(),
                _deliver: (event: string, payload: any) => {
                    [...(handlers.get(event) ?? [])].forEach(h => h(payload));
                },
                _emitted: () => emitted,
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
import { TaskHandlers } from '@mxf-dev/sdk/handlers/TaskHandlers';
import { TaskHelper } from '@mxf-dev/sdk/services/internal/TaskHelper';

const bus = EventBus.client as any;

const AGENT_ID = 'worker-agent';
const CHANNEL_ID = 'work-channel';

/** Build an ASSIGNED payload the way the server sends it. */
const assignedPayload = (taskId: string) => ({
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
        },
    },
});

/** Wait for the handler's fire-and-forget promise chain to settle. */
const flush = () => new Promise(resolve => setImmediate(resolve));

const failRequests = () =>
    bus._emitted().filter((e: any) => e.event === TaskEvents.FAIL_REQUEST);

describe('TaskHandlers task failure reporting', () => {
    let handlers: TaskHandlers;

    beforeEach(() => {
        bus._reset();
        jest.clearAllMocks();
        handlers = new TaskHandlers(CHANNEL_ID, AGENT_ID);
        handlers.initialize();
    });

    afterEach(() => {
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
    });

    it('completeTask builds a payload the schema validator accepts', async () => {
        await expect(
            TaskHelper.completeTask('t-1', AGENT_ID, CHANNEL_ID, { answer: 42 })
        ).resolves.toBeUndefined();

        const [sent] = bus._emitted();
        expect(sent.event).toBe(TaskEvents.COMPLETE_REQUEST);
        // The server reads these off payload.data.
        expect(sent.payload.data.taskId).toBe('t-1');
        expect(sent.payload.data.completingAgentId).toBe(AGENT_ID);
        expect(sent.payload.data.result).toEqual({ answer: 42 });
    });

    it('cancelTask builds a payload the schema validator accepts', async () => {
        await expect(
            TaskHelper.cancelTask('t-2', AGENT_ID, CHANNEL_ID, 'client went away')
        ).resolves.toBeUndefined();

        const [sent] = bus._emitted();
        expect(sent.event).toBe(TaskEvents.CANCEL_REQUEST);
        expect(sent.payload.data.taskId).toBe('t-2');
        expect(sent.payload.data.reason).toBe('client went away');
    });

    it('failTask builds a payload the schema validator accepts', async () => {
        await expect(
            TaskHelper.failTask('t-3', AGENT_ID, CHANNEL_ID, 'provider 500')
        ).resolves.toBeUndefined();

        const [sent] = bus._emitted();
        expect(sent.event).toBe(TaskEvents.FAIL_REQUEST);
        expect(sent.payload.data.taskId).toBe('t-3');
        expect(sent.payload.data.failingAgentId).toBe(AGENT_ID);
        expect(sent.payload.data.error).toBe('provider 500');
    });
});
