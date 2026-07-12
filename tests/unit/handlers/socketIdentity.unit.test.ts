/**
 * Socket Identity Unit Tests
 *
 * Two ways a client used to be able to say who it was:
 *
 * 1. Key auth read `agentId` out of the handshake. The channel key authenticates a
 *    channel; the client picked its own name inside it. Every downstream check that
 *    trusts socket.data.agentId — task assignment, message sender, memory scope —
 *    trusted that.
 *
 * 2. The Message and Memory socket forwarders checked only that agentId/channelId
 *    were *present* in the client's envelope, then forwarded the object as-is. So an
 *    agent could post into any channel as any agent. (The task and user-input paths
 *    in the same file already rebuilt from socket context — these now match.)
 *
 * Plus: the generic `event` passthrough, which let a client put any event name at
 * all onto EventBus.server, is gone.
 */

import { EventEmitter } from 'events';

const emitted: Array<{ eventType: string; payload: any }> = [];

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn((eventType: string, payload: any) => {
                emitted.push({ eventType, payload });
            }),
            on: jest.fn()
        }
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => {
    const child = (): Record<string, unknown> => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn(() => child())
    });

    return {
        Logger: jest.fn().mockImplementation(() => child()),
        logger: child(),
        __esModule: true,
        default: child()
    };
});

jest.mock('@mxf-dev/core/protocols/mcp/tools/OrparTools', () => ({ clearAgentOrparState: jest.fn() }));
jest.mock('@mxf-dev/core/services/UserInputRequestManager', () => ({
    UserInputRequestManager: {
        getInstance: jest.fn().mockReturnValue({
            submitResponse: jest.fn(),
            cancelRequestsForAgent: jest.fn()
        })
    }
}));
jest.mock('@mxf-dev/core/middleware/MxpMiddleware', () => ({
    MxpMiddleware: { processIncoming: jest.fn(), processOutgoing: jest.fn() }
}));
jest.mock('@mxf-dev/core/schemas/MxpProtocolSchemas', () => ({ isMxpMessage: jest.fn(() => false) }));

import { Events } from '@mxf-dev/core/events/EventNames';
import { setupSocketToEventBusForwarding } from '../../../src/server/socket/handlers/eventForwardingHandlers';

/** A socket stand-in that records the handlers registered on it. */
class FakeSocket extends EventEmitter {
    public id = 'socket-1';
    public data: Record<string, unknown> = {};
    public join = jest.fn();

    /** Whether a handler was registered for an event. */
    public listensFor(eventName: string): boolean {
        return this.listenerCount(eventName) > 0;
    }
}

const AGENT = 'agent-real';
const CHANNEL = 'channel-real';

/** A well-formed BaseEventPayload as a client would send it. */
const clientEnvelope = (
    eventType: string,
    overrides: { agentId?: string; channelId?: string; data?: unknown } = {}
) => ({
    eventId: 'evt-1',
    eventType,
    timestamp: Date.now(),
    agentId: overrides.agentId ?? AGENT,
    channelId: overrides.channelId ?? CHANNEL,
    data: overrides.data ?? { content: 'hello', senderId: AGENT }
});

describe('socket-to-EventBus identity', () => {
    let socket: FakeSocket;

    beforeEach(() => {
        emitted.length = 0;
        socket = new FakeSocket();
        setupSocketToEventBusForwarding(socket as any, AGENT, CHANNEL);
    });

    describe('Message events', () => {
        it('forwards a message from the authenticated agent', () => {
            socket.emit(
                Events.Message.CHANNEL_MESSAGE,
                clientEnvelope(Events.Message.CHANNEL_MESSAGE)
            );

            const forwarded = emitted.find((e) => e.eventType === Events.Message.CHANNEL_MESSAGE);
            expect(forwarded).toBeDefined();
            expect(forwarded!.payload.agentId).toBe(AGENT);
            expect(forwarded!.payload.channelId).toBe(CHANNEL);
        });

        it('drops a message that claims another agent', () => {
            socket.emit(
                Events.Message.CHANNEL_MESSAGE,
                clientEnvelope(Events.Message.CHANNEL_MESSAGE, { agentId: 'someone-else' })
            );

            expect(emitted.find((e) => e.eventType === Events.Message.CHANNEL_MESSAGE)).toBeUndefined();
        });

        it('drops a message aimed at another channel', () => {
            socket.emit(
                Events.Message.CHANNEL_MESSAGE,
                clientEnvelope(Events.Message.CHANNEL_MESSAGE, { channelId: 'other-channel' })
            );

            expect(emitted.find((e) => e.eventType === Events.Message.CHANNEL_MESSAGE)).toBeUndefined();
        });

        it('tells the sender why the message was rejected', () => {
            socket.emit(
                Events.Message.CHANNEL_MESSAGE,
                clientEnvelope(Events.Message.CHANNEL_MESSAGE, { agentId: 'someone-else' })
            );

            const error = emitted.find((e) => e.eventType === Events.Message.MESSAGE_ERROR);
            expect(error).toBeDefined();
            // Addressed with the authenticated identity, not the forged one
            expect(error!.payload.agentId).toBe(AGENT);
        });

        it('overwrites a forged senderId inside the message body', () => {
            socket.emit(
                Events.Message.CHANNEL_MESSAGE,
                clientEnvelope(Events.Message.CHANNEL_MESSAGE, {
                    data: { content: 'hi', senderId: 'commander-kane' }
                })
            );

            const forwarded = emitted.find((e) => e.eventType === Events.Message.CHANNEL_MESSAGE);
            expect(forwarded!.payload.data.senderId).toBe(AGENT);
        });

        it('rebuilds the envelope rather than forwarding the client object', () => {
            const envelope: any = clientEnvelope(Events.Message.CHANNEL_MESSAGE);
            envelope.smuggled = 'should not survive';

            socket.emit(Events.Message.CHANNEL_MESSAGE, envelope);

            const forwarded = emitted.find((e) => e.eventType === Events.Message.CHANNEL_MESSAGE);
            expect(forwarded!.payload).not.toBe(envelope);
            expect(forwarded!.payload.smuggled).toBeUndefined();
        });

        it('drops a payload that is not a structured envelope', () => {
            socket.emit(Events.Message.CHANNEL_MESSAGE, { content: 'raw' });

            expect(emitted.find((e) => e.eventType === Events.Message.CHANNEL_MESSAGE)).toBeUndefined();
        });

        it('keeps the recipient of a direct message', () => {
            socket.emit(
                Events.Message.AGENT_MESSAGE,
                clientEnvelope(Events.Message.AGENT_MESSAGE, {
                    data: { content: 'psst', receiverId: 'agent-two', senderId: AGENT }
                })
            );

            const forwarded = emitted.find((e) => e.eventType === Events.Message.AGENT_MESSAGE);
            expect(forwarded!.payload.data.receiverId).toBe('agent-two');
            expect(forwarded!.payload.data.senderId).toBe(AGENT);
        });
    });

    describe('Memory events', () => {
        it('forwards a memory request from the authenticated agent', () => {
            socket.emit(
                Events.Memory.GET,
                clientEnvelope(Events.Memory.GET, { data: { scope: 'agent', operationId: 'op-1' } })
            );

            const forwarded = emitted.find((e) => e.eventType === Events.Memory.GET);
            expect(forwarded).toBeDefined();
            expect(forwarded!.payload.agentId).toBe(AGENT);
            expect(forwarded!.payload.channelId).toBe(CHANNEL);
        });

        it('drops a memory request that claims another agent', () => {
            socket.emit(
                Events.Memory.GET,
                clientEnvelope(Events.Memory.GET, {
                    agentId: 'victim-agent',
                    data: { scope: 'agent', operationId: 'op-1' }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Memory.GET)).toBeUndefined();
        });

        it('drops a memory request aimed at another channel', () => {
            socket.emit(
                Events.Memory.UPDATE,
                clientEnvelope(Events.Memory.UPDATE, {
                    channelId: 'victim-channel',
                    data: { scope: 'channel', operationId: 'op-1', data: {} }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Memory.UPDATE)).toBeUndefined();
        });

        it('rebuilds the envelope but keeps the operation data intact', () => {
            socket.emit(
                Events.Memory.GET,
                clientEnvelope(Events.Memory.GET, {
                    data: { scope: 'channel', operationId: 'op-7', key: 'notes' }
                })
            );

            const forwarded = emitted.find((e) => e.eventType === Events.Memory.GET);
            expect(forwarded!.payload.data).toEqual({
                scope: 'channel',
                operationId: 'op-7',
                key: 'notes'
            });
        });
    });

    describe('generic event passthrough', () => {
        it('is gone — a client can no longer name the event it puts on the bus', () => {
            expect(socket.listensFor('event')).toBe(false);
        });

        it('emitting it does nothing', () => {
            socket.emit('event', Events.Task.COMPLETE_REQUEST, { taskId: 'someone-elses-task' });

            expect(emitted).toHaveLength(0);
        });
    });
});
