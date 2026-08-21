import { EventEmitter } from 'events';

type EventHandler = (payload: Record<string, unknown>) => void;

const mockEventHandlers = new Map<string, EventHandler[]>();
const mockServerEmit = jest.fn();
const mockServerOff = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: mockServerEmit,
            on: jest.fn((eventType: string, handler: EventHandler) => {
                const handlers = mockEventHandlers.get(eventType) ?? [];
                handlers.push(handler);
                mockEventHandlers.set(eventType, handlers);
                return { unsubscribe: jest.fn() };
            }),
            off: mockServerOff
        }
    }
}));

jest.mock('@mxf-dev/core/models/mcpToolExecution', () => ({
    McpToolExecution: { create: jest.fn() }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: jest.fn(() => ({
        assertIsObject: jest.fn((value: unknown) => {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                throw new Error('expected object');
            }
        }),
        assertIsNonEmptyString: jest.fn((value: unknown) => {
            if (typeof value !== 'string' || value.trim().length === 0) {
                throw new Error('expected non-empty string');
            }
        })
    }))
}));

import { CoreSocketEvents, Events } from '@mxf-dev/core/events/EventNames';
import { setupMcpEventHandlers } from '../../../src/server/socket/handlers/mcpEventHandlers';

class FakeSocket extends EventEmitter {
    public disconnect(): void {
        this.emit(CoreSocketEvents.DISCONNECT);
    }
}

const dispatchServerEvent = (eventType: string, payload: Record<string, unknown>): void => {
    for (const handler of mockEventHandlers.get(eventType) ?? []) {
        handler(payload);
    }
};

describe('MCP resource handler fail-closed contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEventHandlers.clear();
    });

    it('returns one requester-bound error for resource get and no fabricated result', () => {
        setupMcpEventHandlers(new FakeSocket() as never, 'agent-a', 'channel-a');
        setupMcpEventHandlers(new FakeSocket() as never, 'agent-b', 'channel-b');

        dispatchServerEvent(Events.Mcp.RESOURCE_GET, {
            agentId: 'agent-a',
            channelId: 'channel-a',
            data: { resourceUri: 'file:///secret', requestId: 'request-get-1' }
        });

        expect(mockServerEmit).toHaveBeenCalledTimes(1);
        expect(mockServerEmit).toHaveBeenCalledWith(
            Events.Mcp.RESOURCE_ERROR,
            expect.objectContaining({
                agentId: 'agent-a',
                channelId: 'channel-a',
                data: expect.objectContaining({
                    resourceUri: 'file:///secret',
                    requestId: 'request-get-1',
                    error: expect.objectContaining({
                        code: 'MCP_RESOURCE_PROVIDER_UNAVAILABLE'
                    })
                })
            })
        );
        expect(mockServerEmit).not.toHaveBeenCalledWith(
            Events.Mcp.RESOURCE_RESULT,
            expect.anything()
        );
    });

    it('returns one requester-bound error for resource list and no fake empty success', () => {
        setupMcpEventHandlers(new FakeSocket() as never, 'agent-a', 'channel-a');
        setupMcpEventHandlers(new FakeSocket() as never, 'peer-a', 'channel-a');

        dispatchServerEvent(Events.Mcp.RESOURCE_LIST, {
            agentId: 'agent-a',
            channelId: 'channel-a',
            data: { requestId: 'request-list-1' }
        });

        expect(mockServerEmit).toHaveBeenCalledTimes(1);
        expect(mockServerEmit).toHaveBeenCalledWith(
            Events.Mcp.RESOURCE_ERROR,
            expect.objectContaining({
                agentId: 'agent-a',
                channelId: 'channel-a',
                data: expect.objectContaining({
                    resourceUri: 'list',
                    requestId: 'request-list-1',
                    error: expect.objectContaining({
                        code: 'MCP_RESOURCE_PROVIDER_UNAVAILABLE'
                    })
                })
            })
        );
        expect(mockServerEmit).not.toHaveBeenCalledWith(
            Events.Mcp.RESOURCE_LIST_RESULT,
            expect.anything()
        );
    });
});
