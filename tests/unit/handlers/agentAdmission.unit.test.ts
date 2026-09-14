const mockFilesystemAcquire = jest.fn<Promise<void>, [string, string]>();
const mockFilesystemRelease = jest.fn<Promise<void>, [string, string]>();
const mockMembershipAcquire = jest.fn<Promise<void>, [string, string, string]>();
const mockMembershipRelease = jest.fn<Promise<void>, [string]>();
const mockSocketForwarding = jest.fn();
const mockMcpForwarding = jest.fn();
const mockControlLoopHandlers = jest.fn();
const mockMcpHandlers = jest.fn();
const mockTaskHandlers = jest.fn();
const mockEventEmit = jest.fn();
const mockAgentService = {
    agentExists: jest.fn(() => true),
    registerAgent: jest.fn(),
    updateAgentCapabilities: jest.fn(),
    updateAgentAllowedTools: jest.fn(),
    addSocketToAgent: jest.fn(),
    removeSocketFromAgent: jest.fn(),
    hasActiveSockets: jest.fn(() => false),
    updateAgentStatus: jest.fn(),
    getAgent: jest.fn(() => ({ capabilities: [] }))
};

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { emit: mockEventEmit, on: jest.fn(() => ({ unsubscribe: jest.fn() })) } }
}));
jest.mock('@mxf-dev/core/utils/Logger', () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() };
    logger.child.mockReturnValue(logger);
    return { __esModule: true, default: logger, logger, Logger: jest.fn(() => logger) };
});
jest.mock('../../../src/server/socket/services/AgentFilesystemService', () => ({
    AgentFilesystemService: { getInstance: (): object => ({ acquire: mockFilesystemAcquire, release: mockFilesystemRelease }) }
}));
jest.mock('../../../src/server/socket/services/AgentChannelMembershipService', () => ({
    AgentChannelMembershipService: { getInstance: (): object => ({ acquire: mockMembershipAcquire, release: mockMembershipRelease }) }
}));
jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: { getInstance: (): typeof mockAgentService => mockAgentService }
}));
jest.mock('../../../src/server/socket/handlers/authenticationHandlers', () => ({
    handleSocketAuthentication: jest.fn(), sendAuthResponse: jest.fn()
}));
jest.mock('../../../src/server/socket/handlers/controlLoopHandlers', () => ({ setupControlLoopHandlers: mockControlLoopHandlers }));
jest.mock('../../../src/server/socket/handlers/mcpEventHandlers', () => ({ setupMcpEventHandlers: mockMcpHandlers }));
jest.mock('../../../src/server/socket/handlers/taskHandlers', () => ({ registerTaskHandlers: mockTaskHandlers }));
jest.mock('../../../src/server/socket/handlers/eventForwardingHandlers', () => ({
    setupSocketToEventBusForwarding: mockSocketForwarding,
    setupMcpSocketToEventBusForwarding: mockMcpForwarding,
    handleSocketError: jest.fn(), forwardEventToAgent: jest.fn()
}));
jest.mock('../../../src/server/socket/handlers/utilityHandlers', () => ({
    getNormalizedChannelName: (channelId: string): string => `room:${channelId}`
}));
jest.mock('../../../src/server/socket/handlers/channelContextHandlers', () => ({ setupChannelContextEventBusHandlers: jest.fn() }));
jest.mock('../../../src/server/socket/handlers/adminHandlers', () => ({ setupAdminEventHandlers: jest.fn() }));
jest.mock('../../../src/server/socket/services/ChannelService', () => ({ ChannelService: { getInstance: jest.fn() } }));
jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: { getInstance: (): object => ({ getServiceForChannel: jest.fn() }) }
}));
jest.mock('@mxf-dev/core/models/user', () => ({ UserRole: { ADMIN: 'admin', PROVIDER: 'provider', CONSUMER: 'consumer' } }));
jest.mock('../../../src/server/api/services/AuthorizationService', () => ({ authorizationService: { authorize: jest.fn() } }));
jest.mock('../../../src/server/socket/services/UserSessionLifecycle', () => ({ userSessionLifecycle: { registerUserSession: jest.fn() } }));

import { AuthEvents, Events } from '@mxf-dev/core/events/EventNames';
import { completeSocketConnection } from '../../../src/server/socket/handlers/connectionHandlers';

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
    return { promise, resolve, reject };
};
const makeSocket = (): {
    id: string; connected: boolean; data: Record<string, unknown>;
    handshake: { auth: { capabilities: string[]; allowedTools: string[] } };
    join: jest.Mock; emit: jest.Mock; on: jest.Mock; disconnect: jest.Mock;
} => ({
    id: 'socket-a', connected: true,
    data: { agentId: 'agent-a', channelId: 'channel-a', authenticated: true, connectionAdmitted: false },
    handshake: { auth: { capabilities: [], allowedTools: [] } },
    join: jest.fn().mockResolvedValue(undefined), emit: jest.fn(), on: jest.fn(), disconnect: jest.fn()
});
const makeSocketService = (): { registerSocket: jest.Mock; unregisterSocket: jest.Mock; updateHeartbeat: jest.Mock } => ({
    registerSocket: jest.fn(), unregisterSocket: jest.fn(), updateHeartbeat: jest.fn()
});
const assertNoRequestHandlers = (socket: ReturnType<typeof makeSocket>): void => {
    expect(socket.on).not.toHaveBeenCalled();
    for (const install of [mockSocketForwarding, mockMcpForwarding, mockControlLoopHandlers, mockMcpHandlers, mockTaskHandlers]) {
        expect(install).not.toHaveBeenCalled();
    }
};
const assertNotAdmitted = (socket: ReturnType<typeof makeSocket>): void => {
    expect(socket.data.connectionAdmitted).toBe(false);
    expect(mockEventEmit.mock.calls.map(([event]) => event)).not.toContain(Events.Agent.JOIN_CHANNEL);
    expect(mockEventEmit.mock.calls.map(([event]) => event)).not.toContain(Events.Agent.CONNECTED);
    expect(socket.emit.mock.calls.map(([event]) => event)).not.toContain(AuthEvents.SUCCESS);
    assertNoRequestHandlers(socket);
};

describe('agent socket admission ordering', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFilesystemAcquire.mockReset().mockResolvedValue(undefined);
        mockMembershipAcquire.mockReset().mockResolvedValue(undefined);
        mockFilesystemRelease.mockReset().mockResolvedValue(undefined);
        mockMembershipRelease.mockReset().mockResolvedValue(undefined);
    });

    it('waits for filesystem, membership, and room join before admission or request handlers', async () => {
        const filesystem = deferred<void>();
        const membership = deferred<void>();
        const membershipEntered = deferred<void>();
        const joined = deferred<void>();
        const joinEntered = deferred<void>();
        mockFilesystemAcquire.mockReturnValueOnce(filesystem.promise);
        mockMembershipAcquire.mockImplementationOnce((): Promise<void> => {
            membershipEntered.resolve();
            return membership.promise;
        });
        const socket = makeSocket();
        const socketService = makeSocketService();
        socket.join.mockImplementationOnce((): Promise<void> => {
            joinEntered.resolve();
            return joined.promise;
        });
        const completing = completeSocketConnection(socket as never, 'agent-a', 'channel-a', socketService as never);
        expect(mockFilesystemAcquire).toHaveBeenCalledWith('agent-a', 'socket-a');
        expect(mockMembershipAcquire).not.toHaveBeenCalled();
        expect(socket.join).not.toHaveBeenCalled();
        assertNotAdmitted(socket);
        filesystem.resolve();
        await membershipEntered.promise;
        expect(mockMembershipAcquire).toHaveBeenCalledWith('agent-a', 'channel-a', 'socket-a');
        expect(socket.join).not.toHaveBeenCalled();
        assertNotAdmitted(socket);
        membership.resolve();
        await joinEntered.promise;
        expect(socket.join).toHaveBeenCalledWith('room:channel-a');
        assertNotAdmitted(socket);
        joined.resolve();
        await completing;
        expect(socket.data.connectionAdmitted).toBe(true);
        expect(mockEventEmit).toHaveBeenCalledWith(Events.Agent.JOIN_CHANNEL, expect.objectContaining({
            agentId: 'agent-a', channelId: 'channel-a', data: expect.objectContaining({ success: true })
        }));
        for (const install of [mockSocketForwarding, mockMcpForwarding, mockControlLoopHandlers, mockMcpHandlers, mockTaskHandlers]) {
            expect(install).toHaveBeenCalledWith(socket, 'agent-a', 'channel-a');
        }
        expect(socket.on).toHaveBeenCalled();
    });

    it.each(['filesystem', 'membership'] as const)('failed %s admission releases both leases without joining or installing handlers', async phase => {
        const failure = new Error(`${phase} admission failed`);
        if (phase === 'filesystem') mockFilesystemAcquire.mockRejectedValueOnce(failure);
        else mockMembershipAcquire.mockRejectedValueOnce(failure);
        const socket = makeSocket();
        const socketService = makeSocketService();
        await expect(completeSocketConnection(socket as never, 'agent-a', 'channel-a', socketService as never)).rejects.toBe(failure);
        expect(socket.join).not.toHaveBeenCalled();
        assertNotAdmitted(socket);
        expect(mockFilesystemRelease).toHaveBeenCalledWith('agent-a', 'socket-a');
        expect(mockMembershipRelease).toHaveBeenCalledWith('socket-a');
        expect(socketService.unregisterSocket).toHaveBeenCalledWith('socket-a', 'agent-a');
        expect(mockAgentService.removeSocketFromAgent).toHaveBeenCalledWith('agent-a', 'socket-a');
        expect(socket.data.authenticated).toBe(false);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it.each(['filesystem', 'membership', 'room'] as const)('a disconnect during %s prevents the join acknowledgement and handler installation', async phase => {
        const entered = deferred<void>();
        const ready = deferred<void>();
        const hold = (): Promise<void> => { entered.resolve(); return ready.promise; };
        const socket = makeSocket();
        const socketService = makeSocketService();
        if (phase === 'filesystem') mockFilesystemAcquire.mockImplementationOnce(hold);
        else if (phase === 'membership') mockMembershipAcquire.mockImplementationOnce(hold);
        else socket.join.mockImplementationOnce(hold);
        const completing = completeSocketConnection(socket as never, 'agent-a', 'channel-a', socketService as never)
            .catch((error: unknown) => error);
        await entered.promise;
        socket.connected = false;
        ready.resolve();
        expect(await completing).toEqual(expect.objectContaining({ message: 'Socket disconnected during agent admission' }));
        if (phase !== 'room') expect(socket.join).not.toHaveBeenCalled();
        assertNotAdmitted(socket);
        expect(mockFilesystemRelease).toHaveBeenCalledWith('agent-a', 'socket-a');
        expect(mockMembershipRelease).toHaveBeenCalledWith('socket-a');
        expect(socketService.unregisterSocket).toHaveBeenCalledWith('socket-a', 'agent-a');
    });
});
