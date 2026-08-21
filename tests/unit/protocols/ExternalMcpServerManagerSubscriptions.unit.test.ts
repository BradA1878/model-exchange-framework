const mockServerHandlers = new Map<string, Set<(payload: unknown) => void>>();
const mockEventEmit = jest.fn((event: string, payload: unknown) => {
    for (const handler of mockServerHandlers.get(event) ?? []) {
        handler(payload);
    }
});

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn((event: string, handler: (payload: unknown) => void) => {
                const handlers = mockServerHandlers.get(event) ?? new Set();
                handlers.add(handler);
                mockServerHandlers.set(event, handlers);
                return {
                    unsubscribe: jest.fn(() => handlers.delete(handler))
                };
            }),
            emit: mockEventEmit
        }
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        error = jest.fn();
        warn = jest.fn();
        info = jest.fn();
        debug = jest.fn();
        trace = jest.fn();
        child(): MockLogger { return this; }
    }
}));

jest.mock('@mxf-dev/core/services/AutoCorrectionService', () => ({
    AutoCorrectionService: {
        getInstance: (): { attemptCorrection: jest.Mock } => ({ attemptCorrection: jest.fn() })
    }
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import { ExternalMcpServerManager } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';

const registrationPayload = {
    agentId: 'admin-1',
    channelId: 'system',
    data: {
        id: 'external-tools',
        name: 'External Tools',
        transport: 'http'
    }
};

describe('ExternalMcpServerManager EventBus lifecycle', () => {
    beforeEach(() => {
        mockServerHandlers.clear();
        jest.clearAllMocks();
    });

    it('unsubscribes a shut-down manager so reconstruction handles each request once', async () => {
        const first = new ExternalMcpServerManager();
        const firstRegister = jest.spyOn(first, 'registerServer').mockResolvedValue(undefined);

        mockEventEmit(Events.Mcp.EXTERNAL_SERVER_REGISTER, registrationPayload);
        await Promise.resolve();
        expect(firstRegister).toHaveBeenCalledTimes(1);

        await first.shutdown();
        expect(mockServerHandlers.get(Events.Mcp.EXTERNAL_SERVER_REGISTER)?.size ?? 0).toBe(0);
        expect(mockServerHandlers.get(Events.Mcp.EXTERNAL_SERVER_UNREGISTER)?.size ?? 0).toBe(0);

        const second = new ExternalMcpServerManager();
        const secondRegister = jest.spyOn(second, 'registerServer').mockResolvedValue(undefined);

        mockEventEmit(Events.Mcp.EXTERNAL_SERVER_REGISTER, registrationPayload);
        await Promise.resolve();

        expect(firstRegister).toHaveBeenCalledTimes(1);
        expect(secondRegister).toHaveBeenCalledTimes(1);
        await second.shutdown();
    });
});
