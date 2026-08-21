import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import {
    resolveTaskEventAgentTarget,
    TASK_SOCKET_EGRESS_EVENTS
} from '../../../src/server/socket/handlers/TaskEventRoutingPolicy';

describe('task event routing policy', () => {
    it('routes an assignment to its assignee rather than its creator/emitter', () => {
        expect(resolveTaskEventAgentTarget(TaskEvents.ASSIGNED, {
            channelId: 'channel-a',
            data: { toAgentId: 'worker-agent' }
        })).toBe('worker-agent');
    });

    it('routes task errors to the exact requester', () => {
        expect(resolveTaskEventAgentTarget(TaskEvents.ERROR, {
            channelId: 'channel-a',
            data: { toAgentId: 'requesting-agent' }
        })).toBe('requesting-agent');
    });

    it('fails closed when an agent-targeted event has no recipient', () => {
        expect(() => resolveTaskEventAgentTarget(TaskEvents.ASSIGNED, {
            channelId: 'channel-a',
            data: {}
        })).toThrow(/requires data\.toAgentId/);
    });

    it.each([
        TaskEvents.CREATED,
        TaskEvents.STARTED,
        TaskEvents.PROGRESS_UPDATED,
        TaskEvents.COMPLETED,
        TaskEvents.FAILED,
        TaskEvents.CANCELLED
    ])('leaves channel-wide lifecycle event %s untargeted', eventName => {
        expect(resolveTaskEventAgentTarget(eventName, {
            channelId: 'channel-a',
            data: { toAgentId: 'originating-agent' }
        })).toBeNull();
    });

    it.each([
        TaskEvents.CREATE_REQUEST,
        TaskEvents.START_REQUEST,
        TaskEvents.COMPLETE_REQUEST,
        TaskEvents.FAIL_REQUEST,
        TaskEvents.CANCEL_REQUEST,
        TaskEvents.ASSIGN_REQUEST,
        TaskEvents.UPDATE_REQUEST,
        TaskEvents.WORKLOAD_ANALYZE_REQUEST,
        TaskEvents.ASSIGNMENT_REQUESTED
    ])('prohibits client write request %s from socket egress', eventName => {
        expect(TASK_SOCKET_EGRESS_EVENTS).not.toContain(eventName);
    });

    it.each([
        TaskEvents.REQUEST,
        TaskEvents.RESPONSE,
        TaskEvents.CREATED,
        TaskEvents.ASSIGNED,
        TaskEvents.STARTED,
        TaskEvents.PROGRESS_UPDATED,
        TaskEvents.COMPLETED,
        TaskEvents.FAILED,
        TaskEvents.ERROR,
        TaskEvents.CANCELLED,
        TaskEvents.REASSIGNED,
        TaskEvents.ASSIGNMENT_ANALYZED,
        TaskEvents.WORKLOAD_ANALYZED,
        TaskEvents.AGENT_OVERLOADED,
        TaskEvents.DEPENDENCY_RESOLVED,
        TaskEvents.BLOCKING_CLEARED,
        TaskEvents.LATE_AGENT_JOINED,
        TaskEvents.ORCHESTRATION_CONFIG_UPDATED
    ])('permits reviewed server/peer event %s to egress', eventName => {
        expect(TASK_SOCKET_EGRESS_EVENTS).toContain(eventName);
    });
});
