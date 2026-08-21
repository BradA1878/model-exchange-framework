import { EventBus } from '@mxf-dev/core/events/EventBus';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import {
    createTaskEventPayload,
    TaskEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MxfService } from '@mxf-dev/sdk/services/MxfService';

const AGENT_ID = 'assigned-agent';
const CHANNEL_ID = 'task-channel';

const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
};

const createService = (): MxfService => {
    const service = new MxfService(
        CHANNEL_ID,
        { serverUrl: 'http://mxf.test' },
        {},
        logger
    );
    service.setAgentId(AGENT_ID);
    return service;
};

const assignmentPayload = (
    toAgentId: string,
    channelId = CHANNEL_ID
): TaskEventPayload =>
    createTaskEventPayload(TaskEvents.ASSIGNED, 'task-creator', channelId, {
        taskId: 'task-1',
        fromAgentId: 'task-creator',
        toAgentId,
        task: {
            id: 'task-1',
            title: 'Assigned work',
            description: 'Prove exact assignment delivery',
            assignmentStrategy: 'manual'
        }
    });

const completionPayload = (eventId: string): TaskEventPayload =>
    createTaskEventPayload(TaskEvents.COMPLETED, AGENT_ID, CHANNEL_ID, {
        taskId: 'task-1',
        requestId: 'complete-request-1',
        fromAgentId: AGENT_ID,
        toAgentId: AGENT_ID,
        task: {
            id: 'task-1',
            title: 'Assigned work',
            description: 'Prove exact terminal delivery',
            assignmentStrategy: 'manual',
            status: 'completed'
        }
    }, { eventId });

const inboundSocket = (): {
    connected: boolean;
    on: jest.Mock;
    off: jest.Mock;
    emit: jest.Mock;
    onAny: jest.Mock;
    offAny: jest.Mock;
    deliver: (event: string, payload: unknown) => void;
} => {
    let inboundHandler: ((event: string, payload: unknown) => void) | undefined;
    return {
        connected: true,
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        onAny: jest.fn(handler => {
            inboundHandler = handler;
        }),
        offAny: jest.fn(() => {
            inboundHandler = undefined;
        }),
        deliver: (event, payload): void => {
            inboundHandler?.(event, payload);
        }
    };
};

describe('MxfService task assignment routing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        EventBus.reset();
    });

    afterEach(() => {
        EventBus.reset();
    });

    it('invokes the assignee callback when creator and assignee differ', () => {
        const service = createService();
        const onAssigned = jest.fn();
        service.onTaskAssigned(onAssigned);
        const payload = assignmentPayload(AGENT_ID);

        EventBus.client.emitLocal(TaskEvents.ASSIGNED, payload);

        expect(onAssigned).toHaveBeenCalledTimes(1);
        expect(onAssigned).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 'task-1',
            agentId: 'task-creator',
            channelId: CHANNEL_ID,
            eventType: 'assigned',
            rawPayload: payload
        }));
    });

    it('does not consume a sibling assignment or an assignment from another channel', () => {
        const service = createService();
        const onAssigned = jest.fn();
        service.onTaskAssigned(onAssigned);

        EventBus.client.emitLocal(TaskEvents.ASSIGNED, assignmentPayload('sibling-agent'));
        EventBus.client.emitLocal(
            TaskEvents.ASSIGNED,
            assignmentPayload(AGENT_ID, 'other-channel')
        );

        expect(onAssigned).not.toHaveBeenCalled();
    });

    it('invokes each terminal callback once per exact room envelope across local sockets', () => {
        const service = createService();
        const onCompleted = jest.fn();
        service.onTaskCompleted(onCompleted);
        const firstSocket = inboundSocket();
        const secondSocket = inboundSocket();
        EventBus.client.registerSocket('assigned-agent', firstSocket);
        EventBus.client.registerSocket('peer-agent', secondSocket);
        const first = completionPayload('terminal-event-1');

        firstSocket.deliver(TaskEvents.COMPLETED, first);
        secondSocket.deliver(TaskEvents.COMPLETED, first);
        secondSocket.deliver(TaskEvents.COMPLETED, first);

        expect(onCompleted).toHaveBeenCalledTimes(1);
        expect(onCompleted).toHaveBeenLastCalledWith(expect.objectContaining({
            taskId: 'task-1',
            rawPayload: first
        }));

        const second = completionPayload('terminal-event-2');
        firstSocket.deliver(TaskEvents.COMPLETED, second);
        secondSocket.deliver(TaskEvents.COMPLETED, second);

        expect(onCompleted).toHaveBeenCalledTimes(2);
        expect(onCompleted).toHaveBeenLastCalledWith(expect.objectContaining({
            taskId: 'task-1',
            rawPayload: second
        }));
    });
});
