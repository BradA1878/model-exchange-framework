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
const serverListeners = new Map<string, Array<(payload: unknown) => void>>();
const mockIsParticipant = jest.fn((channelId: string, agentId: string) => (
    channelId === 'channel-real' && ['agent-real', 'agent-two'].includes(agentId)
));
const mockSubmitUserInputResponse = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn((eventType: string, payload: any) => {
                emitted.push({ eventType, payload });
            }),
            on: jest.fn((eventType: string, handler: (payload: unknown) => void) => {
                const handlers = serverListeners.get(eventType) ?? [];
                handlers.push(handler);
                serverListeners.set(eventType, handlers);
                return { unsubscribe: jest.fn() };
            })
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
            submitResponse: mockSubmitUserInputResponse,
            cancelRequestsForAgent: jest.fn()
        })
    }
}));
jest.mock('@mxf-dev/core/middleware/MxpMiddleware', () => ({
    MxpMiddleware: { processIncoming: jest.fn(), processOutgoing: jest.fn() }
}));
jest.mock('@mxf-dev/core/schemas/MxpProtocolSchemas', () => ({ isMxpMessage: jest.fn(() => false) }));
jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: {
        getInstance: jest.fn(() => ({ isParticipant: mockIsParticipant }))
    }
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import {
    EventQueueControl,
    forwardEventToAgent,
    setupEventBusToSocketForwarding,
    setupMcpSocketToEventBusForwarding,
    setupSocketToEventBusForwarding
} from '../../../src/server/socket/handlers/eventForwardingHandlers';

/** A socket stand-in that records the handlers registered on it. */
class FakeSocket extends EventEmitter {
    public id = 'socket-1';
    public data: Record<string, unknown> = {
        keyId: 'key-1',
        effectiveAllowedTools: undefined
    };
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
): {
    eventId: string;
    eventType: string;
    timestamp: number;
    agentId: string;
    channelId: string;
    data: unknown;
} => ({
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
        mockIsParticipant.mockClear();
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

        it('normalizes nested message context to the authenticated channel', () => {
            socket.emit(
                Events.Message.CHANNEL_MESSAGE,
                clientEnvelope(Events.Message.CHANNEL_MESSAGE, {
                    data: {
                        content: 'hi',
                        senderId: 'forged-agent',
                        context: {
                            channelId: 'victim-channel',
                            sessionId: 'session-1'
                        }
                    }
                })
            );

            const forwarded = emitted.find((e) => e.eventType === Events.Message.CHANNEL_MESSAGE);
            expect(forwarded!.payload.data).toEqual(expect.objectContaining({
                senderId: AGENT,
                context: {
                    channelId: CHANNEL,
                    sessionId: 'session-1'
                }
            }));
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

        it('rejects a direct message to an agent outside the authenticated channel', () => {
            socket.emit(
                Events.Message.AGENT_MESSAGE,
                clientEnvelope(Events.Message.AGENT_MESSAGE, {
                    data: {
                        content: 'cross-channel secret',
                        receiverId: 'victim-agent',
                        senderId: AGENT
                    }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Message.AGENT_MESSAGE)).toBeUndefined();
            expect(emitted.find((e) => e.eventType === Events.Message.MESSAGE_ERROR))
                .toEqual(expect.objectContaining({
                    payload: expect.objectContaining({
                        agentId: AGENT,
                        channelId: CHANNEL,
                        data: expect.objectContaining({
                            error: expect.stringContaining('not a participant')
                        })
                    })
                }));
        });
    });

    describe('Memory events', () => {
        it('forwards a memory request from the authenticated agent', () => {
            socket.emit(
                Events.Memory.GET,
                clientEnvelope(Events.Memory.GET, {
                    data: { scope: 'agent', operationId: 'op-1', id: AGENT }
                })
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
                    data: { scope: 'agent', operationId: 'op-1', id: AGENT }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Memory.GET)).toBeUndefined();
        });

        it('drops a memory request aimed at another channel', () => {
            socket.emit(
                Events.Memory.UPDATE,
                clientEnvelope(Events.Memory.UPDATE, {
                    channelId: 'victim-channel',
                    data: { scope: 'channel', operationId: 'op-1', id: CHANNEL, data: {} }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Memory.UPDATE)).toBeUndefined();
        });

        it('rebuilds the envelope but keeps the operation data intact', () => {
            socket.emit(
                Events.Memory.GET,
                clientEnvelope(Events.Memory.GET, {
                    data: { scope: 'channel', operationId: 'op-7', id: CHANNEL }
                })
            );

            const forwarded = emitted.find((e) => e.eventType === Events.Memory.GET);
            expect(forwarded!.payload.data).toEqual({
                scope: 'channel',
                operationId: 'op-7',
                id: CHANNEL
            });
        });

        it('rejects cross-agent reads before dispatch and returns a correlated result', () => {
            socket.emit(
                Events.Memory.GET,
                clientEnvelope(Events.Memory.GET, {
                    data: {
                        scope: 'agent',
                        operationId: 'op-cross-agent',
                        id: 'victim-agent'
                    }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Memory.GET)).toBeUndefined();
            const denial = emitted.find((e) => e.eventType === Events.Memory.GET_RESULT);
            expect(denial!.payload).toEqual(expect.objectContaining({
                agentId: AGENT,
                channelId: CHANNEL,
                data: expect.objectContaining({
                    operationId: 'op-cross-agent',
                    error: expect.stringContaining('authenticated socket scope')
                })
            }));
        });

        it('rejects cross-channel writes including embedded legacy keys', () => {
            socket.emit(
                Events.Memory.UPDATE,
                clientEnvelope(Events.Memory.UPDATE, {
                    data: {
                        scope: 'channel',
                        operationId: 'op-cross-channel',
                        id: CHANNEL,
                        data: {
                            'channel:context:victim-channel': { secret: true }
                        }
                    }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Memory.UPDATE)).toBeUndefined();
            expect(emitted.find((e) => e.eventType === Events.Memory.UPDATE_RESULT))
                .toEqual(expect.objectContaining({
                    payload: expect.objectContaining({
                        data: expect.objectContaining({
                            operationId: 'op-cross-channel',
                            error: expect.stringContaining('authenticated socket scope')
                        })
                    })
                }));
        });

        it('rejects a foreign nested channel identity in an otherwise local update', () => {
            socket.emit(
                Events.Memory.UPDATE,
                clientEnvelope(Events.Memory.UPDATE, {
                    data: {
                        scope: 'channel',
                        operationId: 'op-poison-channel',
                        id: `channel:context:${CHANNEL}`,
                        data: {
                            [`channel:context:${CHANNEL}`]: {
                                channelId: 'victim-channel',
                                summary: 'poisoned'
                            }
                        }
                    }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Memory.UPDATE)).toBeUndefined();
            expect(emitted.find((e) => e.eventType === Events.Memory.UPDATE_RESULT)).toBeDefined();
        });

        it('canonicalizes relationship ids after proving both channel participants', () => {
            socket.emit(
                Events.Memory.GET,
                clientEnvelope(Events.Memory.GET, {
                    data: {
                        scope: 'relationship',
                        operationId: 'op-global-relationship',
                        id: [AGENT, 'agent-two']
                    }
                })
            );

            const forwarded = emitted.find((e) => e.eventType === Events.Memory.GET);
            expect(forwarded!.payload.data.id).toEqual([AGENT, 'agent-two', CHANNEL]);
            expect(mockIsParticipant).toHaveBeenCalledWith(CHANNEL, AGENT);
            expect(mockIsParticipant).toHaveBeenCalledWith(CHANNEL, 'agent-two');
        });

        it('rejects relationship access to a non-participant peer', () => {
            socket.emit(
                Events.Memory.GET,
                clientEnvelope(Events.Memory.GET, {
                    data: {
                        scope: 'relationship',
                        operationId: 'op-foreign-peer',
                        id: [AGENT, 'victim-agent', CHANNEL]
                    }
                })
            );

            expect(emitted.find((e) => e.eventType === Events.Memory.GET)).toBeUndefined();
            expect(emitted.find((e) => e.eventType === Events.Memory.GET_RESULT)).toBeDefined();
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

    describe('event-family direction allowlists', () => {
        it('installs message request listeners but no delivery, system, or error listeners', () => {
            expect(socket.listensFor(Events.Message.AGENT_MESSAGE)).toBe(true);
            expect(socket.listensFor(Events.Message.CHANNEL_MESSAGE)).toBe(true);
            expect(socket.listensFor(Events.Message.LLM_MESSAGE)).toBe(false);
            expect(socket.listensFor(Events.Message.AGENT_MESSAGE_DELIVERED)).toBe(false);
            expect(socket.listensFor(Events.Message.SYSTEM_MESSAGE)).toBe(false);
            expect(socket.listensFor(Events.Message.MESSAGE_ERROR)).toBe(false);
            expect(socket.listensFor(Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST)).toBe(false);
        });

        it('installs scoped memory requests but no result, clear-all, sync, or expiration listeners', () => {
            expect(socket.listensFor(Events.Memory.GET)).toBe(true);
            expect(socket.listensFor(Events.Memory.DELETE)).toBe(true);
            expect(socket.listensFor(Events.Memory.CREATE)).toBe(false);
            expect(socket.listensFor(Events.Memory.CLEAR)).toBe(false);
            expect(socket.listensFor(Events.Memory.RECALL)).toBe(false);
            expect(socket.listensFor(Events.Memory.STORE)).toBe(false);
            expect(socket.listensFor(Events.Memory.FORGET)).toBe(false);
            expect(socket.listensFor(Events.Memory.GET_RESULT)).toBe(false);
            expect(socket.listensFor(Events.Memory.CLEAR_ALL)).toBe(false);
            expect(socket.listensFor(Events.Memory.SYNC)).toBe(false);
            expect(socket.listensFor(Events.Memory.EXPIRE)).toBe(false);
        });

        it('installs task request listeners but no lifecycle/result listeners', () => {
            expect(socket.listensFor(Events.Task.CREATE_REQUEST)).toBe(true);
            expect(socket.listensFor(Events.Task.COMPLETE_REQUEST)).toBe(true);
            expect(socket.listensFor(Events.Task.REQUEST)).toBe(true);
            expect(socket.listensFor(Events.Task.RESPONSE)).toBe(true);
            expect(socket.listensFor(Events.Task.CREATED)).toBe(false);
            expect(socket.listensFor(Events.Task.ASSIGNED)).toBe(false);
            expect(socket.listensFor(Events.Task.COMPLETED)).toBe(false);
        });

        it('preserves legacy task request/response with trusted sender identity', () => {
            socket.emit(
                Events.Task.REQUEST,
                clientEnvelope(Events.Task.REQUEST, {
                    data: {
                        taskId: 'task-1',
                        fromAgentId: 'victim-agent',
                        toAgentId: 'agent-two',
                        task: 'review this'
                    }
                })
            );
            socket.emit(
                Events.Task.RESPONSE,
                clientEnvelope(Events.Task.RESPONSE, {
                    data: {
                        taskId: 'task-1',
                        fromAgentId: 'victim-agent',
                        toAgentId: 'agent-two',
                        task: 'done'
                    }
                })
            );

            const request = emitted.find((e) => e.eventType === Events.Task.REQUEST);
            const response = emitted.find((e) => e.eventType === Events.Task.RESPONSE);
            expect(request!.payload.data).toEqual(expect.objectContaining({
                fromAgentId: AGENT,
                toAgentId: 'agent-two',
                task: 'review this'
            }));
            expect(response!.payload.data).toEqual(expect.objectContaining({
                fromAgentId: AGENT,
                toAgentId: 'agent-two',
                task: 'done'
            }));
        });

        it('preserves terminal correlation and result while replacing forged lifecycle identity', () => {
            socket.emit(
                Events.Task.COMPLETE_REQUEST,
                clientEnvelope(Events.Task.COMPLETE_REQUEST, {
                    data: {
                        taskId: 'task-ack',
                        requestId: 'request-ack',
                        completingAgentId: 'victim-agent',
                        result: { answer: 42 },
                        task: 'complete task-ack'
                    }
                })
            );

            const request = emitted.find(
                entry => entry.eventType === Events.Task.COMPLETE_REQUEST
            );
            expect(request?.payload.data).toEqual(expect.objectContaining({
                taskId: 'task-ack',
                requestId: 'request-ack',
                completingAgentId: AGENT,
                fromAgentId: AGENT,
                result: { answer: 42 }
            }));
        });

        it('rejects a legacy task target outside the authenticated channel', () => {
            socket.emit(
                Events.Task.REQUEST,
                clientEnvelope(Events.Task.REQUEST, {
                    data: {
                        taskId: 'task-foreign',
                        fromAgentId: 'forged-agent',
                        toAgentId: 'victim-agent',
                        task: 'private request'
                    }
                })
            );

            expect(mockIsParticipant).toHaveBeenCalledWith(CHANNEL, 'victim-agent');
            expect(emitted.find((entry) => (
                entry.eventType === Events.Task.REQUEST
            ))).toBeUndefined();
        });

        it('installs Meilisearch request listeners but no server response listeners', () => {
            expect(socket.listensFor(Events.Meilisearch.INDEX_REQUEST)).toBe(true);
            expect(socket.listensFor(Events.Meilisearch.BACKFILL_REQUEST)).toBe(true);
            expect(socket.listensFor(Events.Meilisearch.BACKFILL_SETTLED)).toBe(true);
            expect(socket.listensFor(Events.Meilisearch.INDEX)).toBe(false);
            expect(socket.listensFor(Events.Meilisearch.BACKFILL_COMPLETE)).toBe(false);
            expect(socket.listensFor(Events.Meilisearch.INDEX_ERROR)).toBe(false);
        });

        it('forwards a well-formed settled report to the server bus', () => {
            emitted.length = 0;
            socket.emit(
                Events.Meilisearch.BACKFILL_SETTLED,
                clientEnvelope(Events.Meilisearch.BACKFILL_SETTLED, {
                    data: {
                        operationId: 'settled-1',
                        indexName: 'mxf-conversations',
                        documentType: 'conversation',
                        totalDocuments: 0,
                        indexedDocuments: 0,
                        failedDocuments: 0,
                        skippedDocuments: 0,
                        duration: 0,
                        success: true,
                        source: 'memory',
                        metadata: {}
                    }
                })
            );

            const forwarded = emitted.find((entry) => entry.eventType === Events.Meilisearch.BACKFILL_SETTLED);
            expect(forwarded?.payload).toMatchObject({
                agentId: AGENT,
                channelId: CHANNEL,
                data: { totalDocuments: 0, success: true, metadata: { agentId: AGENT, channelId: CHANNEL } }
            });
        });

        it('refuses a malformed settled report without echoing a backfill error to the agent', () => {
            emitted.length = 0;
            socket.emit(
                Events.Meilisearch.BACKFILL_SETTLED,
                clientEnvelope(Events.Meilisearch.BACKFILL_SETTLED, {
                    data: {
                        operationId: 'settled-2',
                        indexName: 'mxf-conversations',
                        documentType: 'conversation',
                        // 1 + 1 + 1 does not add up to 5
                        totalDocuments: 5,
                        indexedDocuments: 1,
                        failedDocuments: 1,
                        skippedDocuments: 1,
                        duration: 0,
                        success: false,
                        source: 'memory',
                        metadata: {}
                    }
                })
            );

            expect(emitted.find((entry) => entry.eventType === Events.Meilisearch.BACKFILL_SETTLED)).toBeUndefined();
            // Nothing awaits a settled report, and it is not a backfill failure.
            expect(emitted.find((entry) => entry.eventType === Events.Meilisearch.BACKFILL_ERROR)).toBeUndefined();
        });
    });

    describe('MCP identity and direction policy', () => {
        it('installs only client request listeners, never server-owned or process-management listeners', () => {
            const mcpSocket = new FakeSocket();
            setupMcpSocketToEventBusForwarding(mcpSocket as never, AGENT, CHANNEL);

            expect(mcpSocket.listensFor(Events.Mcp.EXTERNAL_SERVER_REGISTER)).toBe(false);
            expect(mcpSocket.listensFor(Events.Mcp.CHANNEL_SERVER_REGISTER)).toBe(false);
            expect(mcpSocket.listensFor(Events.Mcp.EXTERNAL_SERVER_UNREGISTER)).toBe(false);
            expect(mcpSocket.listensFor(Events.Mcp.TOOL_RESULT)).toBe(false);
            expect(mcpSocket.listensFor(Events.Mcp.TOOL_LIST_RESULT)).toBe(false);
            expect(mcpSocket.listensFor(Events.Mcp.MXF_TOOL_LIST_RESULT)).toBe(false);
            expect(mcpSocket.listensFor(Events.Mcp.TOOL_CALL)).toBe(true);
            expect(mcpSocket.listensFor(Events.Mcp.TOOL_LIST)).toBe(true);
            expect(mcpSocket.listensFor(Events.Mcp.TOOL_UNREGISTER)).toBe(true);
        });

        it('rebuilds a structured MCP request with the authenticated socket identity', () => {
            const mcpSocket = new FakeSocket();
            setupMcpSocketToEventBusForwarding(mcpSocket as never, AGENT, CHANNEL);
            const forgedEnvelope = clientEnvelope(Events.Mcp.TOOL_CALL, {
                agentId: 'forged-agent',
                channelId: 'forged-channel',
                data: {
                    toolName: 'memory_get',
                    callId: 'call-1',
                    arguments: { key: 'notes' }
                }
            });

            mcpSocket.emit(Events.Mcp.TOOL_CALL, forgedEnvelope);

            const forwarded = emitted.find((entry) => entry.eventType === Events.Mcp.TOOL_CALL);
            expect(forwarded).toBeDefined();
            expect(forwarded!.payload).not.toBe(forgedEnvelope);
            expect(forwarded!.payload.agentId).toBe(AGENT);
            expect(forwarded!.payload.channelId).toBe(CHANNEL);
            expect(forwarded!.payload.data.toolName).toBe('memory_get');
            expect(forwarded!.payload.authorization).toEqual({
                keyId: 'key-1',
                allowedTools: undefined
            });
            expect(forwarded!.payload.smuggled).toBeUndefined();
        });

        it('drops a structured MCP envelope whose declared type mismatches the socket event', () => {
            const mcpSocket = new FakeSocket();
            setupMcpSocketToEventBusForwarding(mcpSocket as never, AGENT, CHANNEL);

            mcpSocket.emit(
                Events.Mcp.TOOL_CALL,
                clientEnvelope(Events.Mcp.TOOL_RESULT, {
                    data: { toolName: 'memory_get', arguments: {} }
                })
            );

            expect(emitted.find((entry) => entry.eventType === Events.Mcp.TOOL_CALL)).toBeUndefined();
        });
    });

    describe('reviewed event egress', () => {
        it('deduplicates exact task repeats and keeps private results requester-only', () => {
            jest.useFakeTimers();
            serverListeners.clear();
            EventQueueControl.setEnabled(false);

            const roomEmit = jest.fn();
            const agentEmit = jest.fn();
            const toRoom = jest.fn(() => ({
                emit: roomEmit,
                except: jest.fn(() => ({ emit: roomEmit }))
            }));
            let registeredChannel = CHANNEL;
            const getSocketByAgentId = jest.fn((_: string, scopedChannel: string) => (
                scopedChannel === registeredChannel
                    ? {
                        connected: true,
                        data: { agentId: AGENT, channelId: registeredChannel },
                        emit: agentEmit
                    }
                    : null
            ));
            const socketService = {
                getNormalizedChannelName: jest.fn((channelId: string) => channelId),
                getSocketServer: jest.fn(() => ({
                    to: toRoom
                })),
                getSocketByAgentId
            };
            setupEventBusToSocketForwarding(socketService as never);

            const clientOnlyTaskEvents = [
                Events.Task.CREATE_REQUEST,
                Events.Task.START_REQUEST,
                Events.Task.COMPLETE_REQUEST,
                Events.Task.FAIL_REQUEST,
                Events.Task.CANCEL_REQUEST,
                Events.Task.ASSIGN_REQUEST,
                Events.Task.UPDATE_REQUEST,
                Events.Task.WORKLOAD_ANALYZE_REQUEST,
                Events.Task.ASSIGNMENT_REQUESTED
            ];
            clientOnlyTaskEvents.forEach(eventName => {
                expect(serverListeners.get(eventName)).toBeUndefined();
            });

            const taskHandler = serverListeners.get(Events.Task.CREATED)?.[0];
            expect(taskHandler).toBeDefined();

            const first = {
                eventId: 'event-task-1',
                eventType: Events.Task.CREATED,
                timestamp: 1,
                agentId: AGENT,
                channelId: CHANNEL,
                data: { taskId: 'task-1', task: { title: 'first' } }
            };
            const second = {
                ...first,
                eventId: 'event-task-2',
                data: { taskId: 'task-2', task: { title: 'second' } }
            };

            taskHandler!(first);
            taskHandler!(second);
            taskHandler!({ ...first });

            expect(roomEmit).toHaveBeenCalledTimes(2);
            expect(roomEmit).toHaveBeenNthCalledWith(1, Events.Task.CREATED, first);
            expect(roomEmit).toHaveBeenNthCalledWith(2, Events.Task.CREATED, second);

            const terminalPayload = {
                ...clientEnvelope(Events.Task.COMPLETED, {
                    data: {
                        taskId: 'task-1',
                        requestId: 'complete-request-1',
                        fromAgentId: AGENT,
                        toAgentId: AGENT,
                        task: { id: 'task-1', status: 'completed' }
                    }
                }),
                eventId: 'event-task-completed-1'
            };
            serverListeners.get(Events.Task.COMPLETED)?.[0](terminalPayload);

            // Terminal outcomes are coordination events for every peer in the
            // authenticated channel room. They are not exact-agent responses,
            // and naming the room keeps sockets in every other channel out.
            expect(toRoom).toHaveBeenLastCalledWith(CHANNEL);
            expect(roomEmit).toHaveBeenNthCalledWith(
                3,
                Events.Task.COMPLETED,
                terminalPayload
            );
            expect(agentEmit).not.toHaveBeenCalledWith(
                Events.Task.COMPLETED,
                terminalPayload
            );

            const peerRequest = {
                ...clientEnvelope(Events.Task.REQUEST, {
                    data: {
                        taskId: 'peer-task',
                        fromAgentId: AGENT,
                        toAgentId: 'agent-two',
                        task: 'peer-only request'
                    }
                }),
                eventId: 'peer-task-request'
            };
            const peerResponse = {
                ...clientEnvelope(Events.Task.RESPONSE, {
                    data: {
                        taskId: 'peer-task',
                        fromAgentId: 'agent-two',
                        toAgentId: AGENT,
                        task: 'peer-only response'
                    }
                }),
                eventId: 'peer-task-response'
            };

            serverListeners.get(Events.Task.REQUEST)?.[0](peerRequest);
            serverListeners.get(Events.Task.RESPONSE)?.[0](peerResponse);

            expect(getSocketByAgentId).toHaveBeenCalledWith('agent-two', CHANNEL);
            expect(getSocketByAgentId).toHaveBeenCalledWith(AGENT, CHANNEL);
            expect(agentEmit).toHaveBeenCalledWith(Events.Task.REQUEST, peerRequest);
            expect(agentEmit).toHaveBeenCalledWith(Events.Task.RESPONSE, peerResponse);
            expect(roomEmit).toHaveBeenCalledTimes(3);

            const userInputResponseHandler = serverListeners.get(Events.UserInput.RESPONSE)?.[0];
            const responsePayload = clientEnvelope(Events.UserInput.RESPONSE, {
                data: {
                    requestId: 'request-secret',
                    value: 'human secret',
                    respondedBy: AGENT,
                    timestamp: Date.now()
                }
            });
            userInputResponseHandler!(responsePayload);

            expect(mockSubmitUserInputResponse).toHaveBeenCalledWith(
                'request-secret',
                'human secret',
                AGENT,
                CHANNEL
            );
            expect(agentEmit).toHaveBeenCalledWith(Events.UserInput.RESPONSE, responsePayload);
            expect(roomEmit).toHaveBeenCalledTimes(3);

            const requesterOnlyEvents = [
                Events.Mcp.TOOL_LIST_RESULT,
                Events.Mcp.TOOL_LIST_ERROR,
                Events.Mcp.RESOURCE_LIST_RESULT,
                Events.Meilisearch.INDEX,
                Events.Meilisearch.INDEX_ERROR,
                Events.Meilisearch.BACKFILL_COMPLETE,
                Events.Meilisearch.BACKFILL_PARTIAL,
                Events.Meilisearch.BACKFILL_ERROR,
                Events.Agent.ERROR,
                Events.UserInput.REQUEST,
                Events.UserInput.CANCELLED,
                Events.UserInput.TIMEOUT
            ];

            requesterOnlyEvents.forEach((eventName, index) => {
                const handler = serverListeners.get(eventName)?.[0];
                expect(handler).toBeDefined();
                const payload = {
                    ...clientEnvelope(eventName),
                    eventId: `requester-result-${index}`
                };
                handler!(payload);
                expect(agentEmit).toHaveBeenCalledWith(eventName, payload);
            });

            // A tool call is forwarded to its requester too: its arguments are the
            // only record of what the agent asked for, and the docs promise them
            // to agent.on(Events.Mcp.TOOL_CALL). The authorization block the
            // ingress attached for the executor stays on the server.
            const toolCallHandler = serverListeners.get(Events.Mcp.TOOL_CALL)?.[0];
            expect(toolCallHandler).toBeDefined();
            const toolCall = {
                ...clientEnvelope(Events.Mcp.TOOL_CALL, {
                    data: { toolName: 'sentinel_close_trade', callId: 'call-1', arguments: { tradeId: 'trade-9' } }
                }),
                eventId: 'requester-tool-call',
                authorization: { keyId: 'key-1', allowedTools: ['sentinel_close_trade'] }
            };
            toolCallHandler!(toolCall);
            const forwardedToolCall = agentEmit.mock.calls.find((call) => call[0] === Events.Mcp.TOOL_CALL)?.[1];
            expect(forwardedToolCall).toMatchObject({
                eventId: 'requester-tool-call',
                agentId: AGENT,
                channelId: CHANNEL,
                data: { toolName: 'sentinel_close_trade', callId: 'call-1', arguments: { tradeId: 'trade-9' } }
            });
            expect(forwardedToolCall).not.toHaveProperty('authorization');

            // None of the requester-only results is sent to the channel room,
            // which also keeps other-channel and unauthenticated sockets out.
            expect(roomEmit).toHaveBeenCalledTimes(3);

            // The queued path carries the same authenticated channel scope.
            // Simulate the global agent-id map now pointing at channel B: a
            // channel-A result must be dropped instead of reaching that socket.
            const callsBeforeCrossChannelDelivery = agentEmit.mock.calls.length;
            registeredChannel = 'channel-b';
            EventQueueControl.setEnabled(true);
            forwardEventToAgent(
                socketService as never,
                AGENT,
                Events.Memory.GET_RESULT,
                clientEnvelope(Events.Memory.GET_RESULT)
            );
            jest.advanceTimersByTime(10);

            expect(getSocketByAgentId).toHaveBeenLastCalledWith(AGENT, CHANNEL);
            expect(agentEmit).toHaveBeenCalledTimes(callsBeforeCrossChannelDelivery);

            EventQueueControl.setEnabled(false);
            jest.useRealTimers();
        });
    });
});
