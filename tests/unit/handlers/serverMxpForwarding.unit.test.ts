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
import { MxpMiddleware } from '@mxf-dev/core/middleware/MxpMiddleware';
import { isMxpMessage } from '@mxf-dev/core/schemas/MxpProtocolSchemas';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import {
    EventQueueControl,
    setupEventBusToSocketForwarding
} from '../../../src/server/socket/handlers/eventForwardingHandlers';

const AGENT = 'agent-real';
const CHANNEL = 'channel-real';

describe('server MXP processing ceiling', () => {
    it('forwards broadcasts and direct messages unchanged when MXP is disabled', async () => {
        const previous = process.env.MXP_ENABLED;
        process.env.MXP_ENABLED = 'false';
        jest.useFakeTimers();
        serverListeners.clear();
        EventQueueControl.setEnabled(false);
        const roomEmit = jest.fn();
        const agentEmit = jest.fn();
        const room = { emit: roomEmit, except: jest.fn(() => ({ emit: roomEmit })) };
        const socketService = {
            getNormalizedChannelName: (id: string): string => id,
            getSocketServer: (): { to: jest.Mock } => ({ to: jest.fn(() => room) }),
            getSocketByAgentId: (): { connected: boolean; emit: jest.Mock } => ({ connected: true, emit: agentEmit })
        };
        jest.mocked(isMxpMessage).mockReturnValue(true);
        jest.mocked(MxpMiddleware.processIncoming).mockClear();
        jest.mocked(MxpMiddleware.processOutgoing).mockClear();
        try {
            setupEventBusToSocketForwarding(socketService as never);
            for (const eventType of [Events.Message.CHANNEL_MESSAGE, Events.Message.AGENT_MESSAGE]) {
                const data = { senderId: AGENT, receiverId: 'agent-two', content: { format: 'mxp', data: 'original' } };
                const payload = createBaseEventPayload(eventType, AGENT, CHANNEL, data);
                await Promise.all((serverListeners.get(eventType) ?? []).map(handler => handler(payload)));
                expect(MxpMiddleware.processIncoming).not.toHaveBeenCalled();
                expect(MxpMiddleware.processOutgoing).not.toHaveBeenCalled();
                expect(eventType === Events.Message.CHANNEL_MESSAGE ? roomEmit : agentEmit).toHaveBeenCalledWith(eventType, payload);
                expect(payload.data.content).toEqual({ format: 'mxp', data: 'original' });
            }
        } finally {
            jest.mocked(isMxpMessage).mockReturnValue(false);
            jest.clearAllTimers();
            jest.useRealTimers();
            if (previous === undefined) delete process.env.MXP_ENABLED;
            else process.env.MXP_ENABLED = previous;
        }
    });
});
