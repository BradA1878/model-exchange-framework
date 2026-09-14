const emitted: Array<{ eventType: string; payload: unknown }> = [];
const serverListeners = new Map<string, Array<(payload: unknown) => void>>();
const mockIsParticipant = jest.fn((channelId: string, agentId: string) => (
    channelId === 'channel-real' && ['agent-real', 'agent-two'].includes(agentId)
));
const mockSubmitUserInputResponse = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn((eventType: string, payload: unknown) => {
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
import { createMemoryGetResultEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MemoryScope } from '@mxf-dev/core/types/MemoryTypes';
import { EventQueueControl, forwardEventToAgent, setupEventBusToSocketForwarding } from '../../../src/server/socket/handlers/eventForwardingHandlers';
const AGENT = 'agent-real';
const CHANNEL = 'channel-real';

describe('socket channel history projection', () => {
    it('filters memory before both direct and queued delivery', async () => {
        const previous = process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
        process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY = 'parties';
        jest.useFakeTimers();
        const delivered = jest.fn();
        const socketService = {
            getSocketByAgentId: jest.fn(() => ({ connected: true, data: { agentId: AGENT, channelId: CHANNEL }, emit: delivered })),
            getSocketServer: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
            getNormalizedChannelName: (id: string): string => id
        };
        try {
            setupEventBusToSocketForwarding(socketService as never);
            for (const queued of [false, true]) {
                EventQueueControl.setEnabled(queued);
                const messages = [
                    { messageId: 'private', senderId: 'a', content: 'secret', metadata: { originalMessageType: 'agent-to-agent', targetAgentId: 'b' } },
                    { messageId: 'public', senderId: 'a', content: 'public' }
                ];
                const payload = createMemoryGetResultEventPayload(Events.Memory.GET_RESULT, AGENT, CHANNEL, {
                    operationId: 'history-read', scope: MemoryScope.CHANNEL, id: `channel:messages:${CHANNEL}`, memory: messages
                });
                forwardEventToAgent(socketService as never, AGENT, Events.Memory.GET_RESULT, payload);
                await jest.advanceTimersByTimeAsync(10);
                expect(delivered).toHaveBeenCalledWith(Events.Memory.GET_RESULT, expect.objectContaining({
                    eventId: payload.eventId, data: expect.objectContaining({ operationId: 'history-read', memory: [messages[1]] })
                }));
                expect(payload.data.memory).toEqual(messages);

                const history = createMemoryGetResultEventPayload(Events.Memory.GET_RESULT, AGENT, CHANNEL, {
                    operationId: 'context-history', scope: MemoryScope.CHANNEL, id: `channel:context:history:${CHANNEL}`, memory: [{ data: 'secret' }]
                });
                forwardEventToAgent(socketService as never, AGENT, Events.Memory.GET_RESULT, history);
                await jest.advanceTimersByTimeAsync(10);
                expect(delivered).toHaveBeenLastCalledWith(Events.Memory.GET_RESULT, expect.objectContaining({
                    data: expect.objectContaining({ operationId: 'context-history', memory: null, error: expect.stringContaining('unavailable') })
                }));
            }
        } finally {
            EventQueueControl.setEnabled(false);
            serverListeners.clear();
            jest.useRealTimers();
            if (previous === undefined) delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
            else process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY = previous;
        }
    });
});
