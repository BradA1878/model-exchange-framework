import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';

interface TaskRoutingPayload {
    channelId?: unknown;
    data?: {
        toAgentId?: unknown;
    };
}

/**
 * Task events that are permitted to cross the server -> agent socket boundary.
 *
 * Keep this list explicit. `TaskEvents` contains both ingress requests and
 * server-authored outcomes; iterating every value here would echo write request
 * bodies to the whole channel before the server had authorized or persisted
 * them. Legacy REQUEST/RESPONSE remain because they are deliberate private
 * peer messages, not server write commands.
 */
export const TASK_SOCKET_EGRESS_EVENTS: readonly string[] = [
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
];

const AGENT_TARGETED_TASK_EVENTS = new Set<string>([
    TaskEvents.ASSIGNED,
    TaskEvents.ERROR
]);

/**
 * Resolve a server-authored task event's recipient from the task data, never
 * from the envelope emitter. For example, an assignment is emitted by the
 * creator but must be delivered to data.toAgentId (the assignee).
 */
export const resolveTaskEventAgentTarget = (
    eventName: string,
    payload: TaskRoutingPayload
): string | null => {
    if (!AGENT_TARGETED_TASK_EVENTS.has(eventName)) {
        return null;
    }
    const target = payload.data?.toAgentId;
    if (typeof target !== 'string' || target.trim().length === 0) {
        throw new Error(`${eventName} requires data.toAgentId for exact delivery`);
    }
    if (typeof payload.channelId !== 'string' || payload.channelId.trim().length === 0) {
        throw new Error(`${eventName} requires channelId for exact delivery`);
    }
    return target;
};
