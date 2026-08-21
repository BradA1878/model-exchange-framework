import { EventEmitter } from 'events';

const mockSetupSocketForwarding = jest.fn();
const mockSetupMcpForwarding = jest.fn();
const mockSetupControlLoopHandlers = jest.fn();
const mockSetupMcpEventHandlers = jest.fn();
const mockRegisterTaskHandlers = jest.fn();
const mockAddParticipant = jest.fn();
const mockUpdateAllowedTools = jest.fn();
const mockHandleSocketAuthentication = jest.fn();
const mockSendAuthResponse = jest.fn();
const mockAuthorize = jest.fn();
const mockRegisterUserSession = jest.fn();
const mockEventBusListeners = new Map<string, Array<(payload: Record<string, unknown>) => void>>();

const mockAgentService = {
    agentExists: jest.fn(() => true),
    registerAgent: jest.fn(),
    updateAgentCapabilities: jest.fn(),
    updateAgentAllowedTools: mockUpdateAllowedTools,
    addSocketToAgent: jest.fn(),
    removeSocketFromAgent: jest.fn(),
    hasActiveSockets: jest.fn(() => false),
    updateAgentStatus: jest.fn(),
    getAgent: jest.fn(() => ({ capabilities: [] }))
};

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn(),
            on: jest.fn((
                eventType: string,
                handler: (payload: Record<string, unknown>) => void
            ) => {
                const handlers = mockEventBusListeners.get(eventType) ?? [];
                handlers.push(handler);
                mockEventBusListeners.set(eventType, handlers);
                return { unsubscribe: jest.fn() };
            })
        }
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => {
    const logger = {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
        child: jest.fn()
    };
    logger.child.mockReturnValue(logger);
    return { __esModule: true, default: logger, logger, Logger: jest.fn(() => logger) };
});

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: jest.fn(() => ({
        assertIsObject: jest.fn(),
        assertIsNonEmptyString: jest.fn((value: unknown) => {
            if (typeof value !== 'string' || value.length === 0) {
                throw new Error('expected non-empty string');
            }
        })
    }))
}));

jest.mock('../../../src/server/socket/handlers/authenticationHandlers', () => ({
    handleSocketAuthentication: mockHandleSocketAuthentication,
    sendAuthResponse: mockSendAuthResponse
}));
jest.mock('../../../src/server/socket/handlers/controlLoopHandlers', () => ({
    setupControlLoopHandlers: mockSetupControlLoopHandlers
}));
jest.mock('../../../src/server/socket/handlers/mcpEventHandlers', () => ({
    setupMcpEventHandlers: mockSetupMcpEventHandlers
}));
jest.mock('../../../src/server/socket/handlers/eventForwardingHandlers', () => ({
    setupSocketToEventBusForwarding: mockSetupSocketForwarding,
    setupMcpSocketToEventBusForwarding: mockSetupMcpForwarding,
    handleSocketError: jest.fn(),
    forwardEventToAgent: jest.fn()
}));
jest.mock('../../../src/server/socket/handlers/taskHandlers', () => ({
    registerTaskHandlers: mockRegisterTaskHandlers
}));
jest.mock('../../../src/server/socket/handlers/utilityHandlers', () => ({
    getNormalizedChannelName: jest.fn((channelId: string) => channelId)
}));
jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: { getInstance: jest.fn(() => mockAgentService) }
}));
jest.mock('../../../src/server/socket/handlers/channelContextHandlers', () => ({
    setupChannelContextEventBusHandlers: jest.fn()
}));
jest.mock('../../../src/server/socket/handlers/adminHandlers', () => ({
    setupAdminEventHandlers: jest.fn()
}));
jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: {
        getInstance: jest.fn(() => ({ addParticipant: mockAddParticipant }))
    }
}));
jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: {
        getInstance: jest.fn(() => ({ getServiceForChannel: jest.fn() }))
    }
}));
jest.mock('@mxf-dev/core/models/user', () => ({
    UserRole: { ADMIN: 'admin', PROVIDER: 'provider', CONSUMER: 'consumer' }
}));
jest.mock('../../../src/server/api/services/AuthorizationService', () => ({
    authorizationService: { authorize: mockAuthorize }
}));
jest.mock('../../../src/server/socket/services/UserSessionLifecycle', () => ({
    userSessionLifecycle: {
        registerUserSession: mockRegisterUserSession
    }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { AuthEvents, Events } from '@mxf-dev/core/events/EventNames';
import { UserRole } from '@mxf-dev/core/models/user';
import {
    completeSocketConnection,
    handleConnection
} from '../../../src/server/socket/handlers/connectionHandlers';

class FakeSocket extends EventEmitter {
    public id = 'socket-1';
    public data: Record<string, unknown> = {
        agentId: 'agent-real',
        channelId: 'channel-real',
        authenticated: true
    };
    public handshake: {
        auth: { capabilities: string[]; allowedTools?: string[] };
    } = { auth: { capabilities: [], allowedTools: [] } };
    public join = jest.fn();
    public disconnect = jest.fn();
    public connected = true;
    public emitted: Array<{ event: string; payload: unknown }> = [];

    public emit(event: string, payload?: unknown): boolean {
        this.emitted.push({ event, payload });
        return super.emit(event, payload);
    }
}

const buildSocketService = (): Record<string, jest.Mock> => ({
    registerSocket: jest.fn(),
    unregisterSocket: jest.fn(),
    updateHeartbeat: jest.fn()
});

const flushPromises = async (): Promise<void> => {
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
};

describe('connection security', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEventBusListeners.clear();
        mockAgentService.agentExists.mockReturnValue(true);
        mockAgentService.hasActiveSockets.mockReturnValue(false);
        mockAgentService.getAgent.mockReturnValue({ capabilities: [] });
        mockUpdateAllowedTools.mockReturnValue(true);
        mockAddParticipant.mockResolvedValue(true);
        mockHandleSocketAuthentication.mockReset();
        mockSendAuthResponse.mockReset();
        mockAuthorize.mockReset();
        mockRegisterUserSession.mockReset();
        mockRegisterUserSession.mockImplementation(async (
            _socket: unknown,
            onAuthorized?: () => void | Promise<void>
        ) => {
            await onAuthorized?.();
        });
        mockAuthorize.mockResolvedValue({ allowed: false, status: 403, reason: 'denied' });
    });

    it('binds allowedTools updates to the authenticated agent', async () => {
        const socket = new FakeSocket();
        socket.data.credentialAllowedTools = ['memory_get'];
        const socketService = buildSocketService();
        await completeSocketConnection(
            socket as never,
            'agent-real',
            'channel-real',
            socketService as never
        );
        mockUpdateAllowedTools.mockClear();

        socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATE, {
            agentId: 'victim-agent',
            data: { allowedTools: ['dangerous-tool'] }
        });

        expect(mockUpdateAllowedTools).not.toHaveBeenCalled();
        expect(socket.emitted).toContainEqual({
            event: Events.Agent.ALLOWED_TOOLS_UPDATED,
            payload: {
                agentId: 'agent-real',
                allowedTools: [],
                success: false
            }
        });

        socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATE, {
            agentId: 'agent-real',
            data: { allowedTools: ['   '] }
        });
        expect(mockUpdateAllowedTools).not.toHaveBeenCalled();

        socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATE, {
            agentId: 'agent-real',
            data: { allowedTools: ['memory_get'] }
        });
        expect(mockUpdateAllowedTools).toHaveBeenCalledWith('agent-real', ['memory_get']);
    });

    it('rejects handshake and live expansions outside the authenticated key grant', async () => {
        const socket = new FakeSocket();
        socket.data.credentialAllowedTools = ['task_complete'];
        socket.handshake.auth.allowedTools = ['shell_execute'];
        const socketService = buildSocketService();

        await expect(completeSocketConnection(
            socket as never,
            'agent-real',
            'channel-real',
            socketService as never
        )).rejects.toThrow('outside the authenticated credential grant');
        expect(socketService.registerSocket).not.toHaveBeenCalled();

        socket.handshake.auth.allowedTools = ['task_complete'];
        await completeSocketConnection(
            socket as never,
            'agent-real',
            'channel-real',
            socketService as never
        );
        mockUpdateAllowedTools.mockClear();
        socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATE, {
            agentId: 'agent-real',
            data: { allowedTools: ['shell_execute'] }
        });
        expect(mockUpdateAllowedTools).not.toHaveBeenCalled();
    });

    it('preserves omitted allowedTools and applies an explicit empty deny-all list', async () => {
        const newAgentSocket = new FakeSocket();
        delete (newAgentSocket.handshake.auth as Record<string, unknown>).allowedTools;
        mockAgentService.agentExists.mockReturnValue(false);

        await completeSocketConnection(
            newAgentSocket as never,
            'agent-default-tools',
            'channel-real',
            buildSocketService() as never
        );

        expect(mockAgentService.registerAgent).toHaveBeenCalledWith(
            'agent-default-tools',
            [],
            undefined
        );
        expect(mockUpdateAllowedTools).not.toHaveBeenCalled();

        jest.clearAllMocks();
        mockAgentService.agentExists.mockReturnValue(true);
        mockAgentService.getAgent.mockReturnValue({ capabilities: [] });
        mockAddParticipant.mockResolvedValue(true);
        const denyAllSocket = new FakeSocket();
        denyAllSocket.handshake.auth.allowedTools = [];

        await completeSocketConnection(
            denyAllSocket as never,
            'agent-deny-all',
            'channel-real',
            buildSocketService() as never
        );

        expect(mockUpdateAllowedTools).toHaveBeenCalledWith('agent-deny-all', []);
    });

    it('rejects malformed allowedTools before registering the socket', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        (socket.handshake.auth as { allowedTools?: string[] }).allowedTools = [''];

        await expect(completeSocketConnection(
            socket as never,
            'agent-invalid-tools',
            'channel-real',
            socketService as never
        )).rejects.toThrow('array of non-empty strings');

        expect(socketService.registerSocket).not.toHaveBeenCalled();
        expect(mockAgentService.registerAgent).not.toHaveBeenCalled();
    });

    it('disconnects a stale key when its bound channel cannot be joined', async () => {
        mockAddParticipant.mockResolvedValue(false);
        const socket = new FakeSocket();
        const socketService = buildSocketService();

        await expect(completeSocketConnection(
            socket as never,
            'agent-real',
            'deleted-channel',
            socketService as never
        )).rejects.toThrow('unavailable');

        expect(socketService.unregisterSocket).toHaveBeenCalledWith('socket-1', 'agent-real');
        expect(socket.emitted).toContainEqual({
            event: AuthEvents.ERROR,
            payload: {
                error: 'Authenticated channel is unavailable',
                channelId: 'deleted-channel'
            }
        });
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(mockSetupSocketForwarding).not.toHaveBeenCalled();
        expect(mockSetupMcpForwarding).not.toHaveBeenCalled();
        expect(mockRegisterTaskHandlers).not.toHaveBeenCalled();
    });

    it('completes authentication and installs connection handlers at most once', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        mockHandleSocketAuthentication.mockImplementation(async (targetSocket: FakeSocket) => {
            targetSocket.data = {
                agentId: 'agent-real',
                channelId: 'channel-real',
                authType: 'key',
                authenticated: true
            };
            return 'agent-real';
        });

        handleConnection(socket as never, socketService as never);

        // Race an explicit auth event against the handshake authentication, then
        // try again after authentication completed.
        socket.emit('auth', { keyId: 'same-key', secretKey: 'same-secret' });
        await flushPromises();
        socket.emit('auth', { keyId: 'same-key', secretKey: 'same-secret' });
        await flushPromises();

        expect(mockHandleSocketAuthentication).toHaveBeenCalledTimes(1);
        expect(socketService.registerSocket).toHaveBeenCalledTimes(1);
        expect(mockAddParticipant).toHaveBeenCalledTimes(1);
        expect(mockSetupSocketForwarding).toHaveBeenCalledTimes(1);
        expect(mockSetupMcpForwarding).toHaveBeenCalledTimes(1);
        expect(mockSetupControlLoopHandlers).toHaveBeenCalledTimes(1);
        expect(mockSetupMcpEventHandlers).toHaveBeenCalledTimes(1);
        expect(mockRegisterTaskHandlers).toHaveBeenCalledTimes(1);
    });

    it('makes a post-credential setup failure terminal for that socket', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        mockHandleSocketAuthentication.mockImplementation(async (targetSocket: FakeSocket) => {
            targetSocket.data = {
                agentId: 'agent-real',
                channelId: 'channel-real',
                authType: 'key',
                authenticated: true
            };
            return 'agent-real';
        });
        mockSetupSocketForwarding.mockImplementationOnce(() => {
            throw new Error('partial setup failed');
        });

        handleConnection(socket as never, socketService as never);
        await flushPromises();

        socket.emit('auth', { keyId: 'same-key', secretKey: 'same-secret' });
        await flushPromises();

        expect(mockHandleSocketAuthentication).toHaveBeenCalledTimes(1);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(socket.data.authenticated).toBe(false);
    });

    it('treats a failed credential validation as the socket terminal attempt', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        mockHandleSocketAuthentication.mockResolvedValue(null);

        handleConnection(socket as never, socketService as never);

        // Race post-connect auth against the failing handshake, then try again
        // after the failure has completed.
        socket.emit('auth', { username: 'attacker', password: 'guess-one' });
        await flushPromises();
        socket.emit('auth', { username: 'attacker', password: 'guess-two' });
        await flushPromises();

        expect(mockHandleSocketAuthentication).toHaveBeenCalledTimes(1);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(socket.data.authenticated).toBe(false);
        expect(socketService.registerSocket).not.toHaveBeenCalled();
    });

    it('installs no user-scoped handlers when final lifecycle authorization fails', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        mockHandleSocketAuthentication.mockImplementation(async (targetSocket: FakeSocket) => {
            targetSocket.data = {
                userId: 'user-1',
                username: 'stale-admin',
                role: UserRole.ADMIN,
                authType: 'jwt',
                authenticated: true
            };
            return 'user-1';
        });
        mockRegisterUserSession.mockRejectedValueOnce(
            new Error('User authorization changed before socket registration completed')
        );

        handleConnection(socket as never, socketService as never);
        await flushPromises();

        expect(mockRegisterUserSession).toHaveBeenCalledWith(socket, expect.any(Function));
        expect(socket.listenerCount(Events.Channel.CREATE)).toBe(0);
        expect(socket.listenerCount(Events.Key.GENERATE)).toBe(0);
        expect(socket.listenerCount(Events.Mcp.EXTERNAL_SERVER_REGISTER)).toBe(0);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(socket.data.authenticated).toBe(false);
    });

    it('lets a user create a channel but denies key generation for a foreign channel', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        mockHandleSocketAuthentication.mockImplementation(async (targetSocket: FakeSocket) => {
            targetSocket.data = {
                userId: 'user-1',
                username: 'reader',
                role: UserRole.CONSUMER,
                authType: 'jwt',
                authenticated: true
            };
            return 'user-1';
        });
        mockAuthorize.mockImplementation(async (
            _action: string,
            _kind: string,
            resourceId: string
        ) => (
            resourceId === 'new-channel'
                ? { allowed: false, status: 404, reason: 'not found' }
                : { allowed: false, status: 403, reason: 'denied' }
        ));

        handleConnection(socket as never, socketService as never);
        await flushPromises();

        expect(mockRegisterUserSession).toHaveBeenCalledTimes(1);
        expect(mockRegisterUserSession).toHaveBeenCalledWith(socket, expect.any(Function));

        expect(socket.listenerCount(Events.Channel.CREATE)).toBe(1);
        expect(socket.listenerCount(Events.Key.GENERATE)).toBe(1);
        expect(socket.listenerCount(Events.Mcp.CHANNEL_SERVER_REGISTER)).toBe(1);
        expect(socket.listenerCount(Events.Mcp.CHANNEL_SERVER_UNREGISTER)).toBe(1);
        expect(socket.listenerCount(Events.Mcp.EXTERNAL_SERVER_REGISTER)).toBe(1);
        expect(socket.listenerCount(Events.Mcp.EXTERNAL_SERVER_UNREGISTER)).toBe(1);

        (EventBus.server.emit as jest.Mock).mockClear();
        socket.emit(Events.Channel.CREATE, {
            eventId: 'create-request',
            eventType: Events.Channel.CREATE,
            agentId: 'user-1',
            channelId: 'new-channel',
            data: { name: 'My channel' }
        });
        socket.emit(Events.Key.GENERATE, {
            eventId: 'key-request',
            eventType: Events.Key.GENERATE,
            agentId: 'user-1',
            channelId: 'channel-real',
            data: { channelId: 'channel-real', agentId: 'new-agent' }
        });
        socket.emit(Events.Mcp.EXTERNAL_SERVER_REGISTER, {
            eventId: 'external-request',
            eventType: Events.Mcp.EXTERNAL_SERVER_REGISTER,
            agentId: 'user-1',
            channelId: 'system',
            data: { id: 'server-1', command: 'unsafe' }
        });
        await flushPromises();

        expect(EventBus.server.emit).toHaveBeenCalledTimes(1);
        expect(EventBus.server.emit).toHaveBeenCalledWith(
            Events.Channel.CREATE,
            expect.objectContaining({
                agentId: 'user-1',
                channelId: 'new-channel',
                data: { name: 'My channel' }
            })
        );
        expect(mockAuthorize).toHaveBeenCalledWith(
            'manage',
            'channel',
            'channel-real',
            expect.objectContaining({ kind: 'user', userId: 'user-1' })
        );
        expect(socket.emitted).toEqual(expect.arrayContaining([
            expect.objectContaining({ event: Events.Key.GENERATION_FAILED }),
            expect.objectContaining({ event: Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED })
        ]));
    });

    it('denies opening an existing foreign channel through Channel.CREATE', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        mockHandleSocketAuthentication.mockImplementation(async (targetSocket: FakeSocket) => {
            targetSocket.data = {
                userId: 'user-1',
                username: 'reader',
                role: UserRole.CONSUMER,
                authType: 'jwt',
                authenticated: true
            };
            return 'user-1';
        });
        mockAuthorize.mockResolvedValue({
            allowed: false,
            status: 403,
            reason: 'foreign owner'
        });

        handleConnection(socket as never, socketService as never);
        await flushPromises();
        (EventBus.server.emit as jest.Mock).mockClear();
        socket.emitted.length = 0;

        socket.emit(Events.Channel.CREATE, {
            eventId: 'foreign-channel-create',
            eventType: Events.Channel.CREATE,
            agentId: 'user-1',
            channelId: 'foreign-channel',
            data: { name: 'Foreign channel' }
        });
        await flushPromises();

        expect(mockAuthorize).toHaveBeenCalledWith(
            'manage',
            'channel',
            'foreign-channel',
            expect.objectContaining({ kind: 'user', userId: 'user-1' })
        );
        expect(EventBus.server.emit).not.toHaveBeenCalled();
        expect(socket.emitted).toContainEqual(expect.objectContaining({
            event: Events.Channel.CREATION_FAILED,
            payload: expect.objectContaining({
                agentId: 'user-1',
                channelId: 'foreign-channel'
            })
        }));
        expect(socket.emitted.some(entry => (
            entry.event === Events.Channel.CREATED ||
            entry.event === Events.Key.GENERATED
        ))).toBe(false);
    });

    it('returns correlated create and key responses only once to the requesting user', async () => {
        const socket = new FakeSocket();
        mockHandleSocketAuthentication.mockImplementation(async (targetSocket: FakeSocket) => {
            targetSocket.data = {
                userId: 'user-1',
                username: 'owner',
                role: UserRole.CONSUMER,
                authType: 'jwt',
                authenticated: true
            };
            return 'user-1';
        });
        mockAuthorize.mockImplementation(async (
            _action: string,
            _kind: string,
            resourceId: string
        ) => resourceId === 'new-channel'
            ? { allowed: false, status: 404, reason: 'not found' }
            : { allowed: true, resource: { channelId: resourceId, createdBy: 'user-1' } });

        handleConnection(socket as never, buildSocketService() as never);
        await flushPromises();
        socket.emitted.length = 0;
        (EventBus.server.emit as jest.Mock).mockClear();

        socket.emit(Events.Channel.CREATE, {
            eventId: 'create-request',
            eventType: Events.Channel.CREATE,
            agentId: 'user-1',
            channelId: 'new-channel',
            data: { name: 'New channel' }
        });
        socket.emit(Events.Key.GENERATE, {
            eventId: 'key-request',
            eventType: Events.Key.GENERATE,
            agentId: 'user-1',
            channelId: 'owned-channel',
            data: { channelId: 'owned-channel', agentId: 'agent-1' }
        });
        await flushPromises();

        const createdHandler = mockEventBusListeners.get(Events.Channel.CREATED)?.[0];
        const generatedHandler = mockEventBusListeners.get(Events.Key.GENERATED)?.[0];
        expect(createdHandler).toBeDefined();
        expect(generatedHandler).toBeDefined();

        const createdPayload = {
            agentId: 'user-1',
            channelId: 'new-channel',
            data: { channelId: 'new-channel', name: 'New channel' }
        };
        const keyPayload = {
            agentId: 'user-1',
            channelId: 'owned-channel',
            data: {
                channelId: 'owned-channel',
                agentId: 'agent-1',
                keyId: 'key-1',
                secretKey: 'one-time-secret'
            }
        };

        createdHandler!({ ...createdPayload, agentId: 'other-user' });
        generatedHandler!({ ...keyPayload, agentId: 'other-user' });
        createdHandler!(createdPayload);
        generatedHandler!(keyPayload);
        createdHandler!(createdPayload);
        generatedHandler!(keyPayload);

        expect(socket.emitted.filter(entry => entry.event === Events.Channel.CREATED)).toEqual([{
            event: Events.Channel.CREATED,
            payload: createdPayload
        }]);
        expect(socket.emitted.filter(entry => entry.event === Events.Key.GENERATED)).toEqual([{
            event: Events.Key.GENERATED,
            payload: keyPayload
        }]);
    });

    it('validates admin request direction and rebuilds identity before forwarding', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        mockHandleSocketAuthentication.mockImplementation(async (targetSocket: FakeSocket) => {
            targetSocket.data = {
                userId: 'admin-1',
                username: 'administrator',
                role: UserRole.ADMIN,
                authType: 'jwt',
                authenticated: true
            };
            return 'admin-1';
        });

        handleConnection(socket as never, socketService as never);
        await flushPromises();
        (EventBus.server.emit as jest.Mock).mockClear();

        const validRequest = {
            eventId: 'client-event',
            eventType: Events.Channel.CREATE,
            timestamp: 123,
            agentId: 'admin-1',
            channelId: 'channel-new',
            data: { name: 'New channel' },
            smuggled: 'discard me'
        };
        socket.emit(Events.Channel.CREATE, validRequest);

        expect(EventBus.server.emit).toHaveBeenCalledTimes(1);
        const [, trustedPayload] = (EventBus.server.emit as jest.Mock).mock.calls[0];
        expect(trustedPayload).not.toBe(validRequest);
        expect(trustedPayload.agentId).toBe('admin-1');
        expect(trustedPayload.channelId).toBe('channel-new');
        expect(trustedPayload.eventType).toBe(Events.Channel.CREATE);
        expect(trustedPayload.smuggled).toBeUndefined();

        expect(socket.listenerCount(Events.Mcp.EXTERNAL_SERVER_REGISTER)).toBe(1);
        expect(socket.listenerCount(Events.Mcp.EXTERNAL_SERVER_UNREGISTER)).toBe(1);

        (EventBus.server.emit as jest.Mock).mockClear();
        socket.emit(Events.Channel.CREATE, {
            ...validRequest,
            agentId: 'another-user'
        });
        socket.emit(Events.Key.GENERATE, {
            ...validRequest,
            eventType: Events.Channel.CREATE,
            data: { channelId: 'channel-new', agentId: 'agent-new' }
        });

        expect(EventBus.server.emit).not.toHaveBeenCalled();
    });

    it('gates and rebuilds global MCP process registration on the admin socket', async () => {
        const socket = new FakeSocket();
        const socketService = buildSocketService();
        mockHandleSocketAuthentication.mockImplementation(async (targetSocket: FakeSocket) => {
            targetSocket.data = {
                userId: 'admin-1',
                username: 'administrator',
                role: UserRole.ADMIN,
                authType: 'pat',
                authenticated: true
            };
            return 'admin-1';
        });

        handleConnection(socket as never, socketService as never);
        await flushPromises();

        const request = {
            eventId: 'external-register',
            eventType: Events.Mcp.EXTERNAL_SERVER_REGISTER,
            timestamp: 1,
            agentId: 'admin-1',
            channelId: 'system',
            data: {
                id: 'trusted-server',
                name: 'Trusted server',
                command: 'trusted-command',
                transport: 'stdio'
            }
        };

        const previousUnsafeSetting = process.env.MXF_UNSAFE_STDIO_MCP_ENABLED;
        delete process.env.MXF_UNSAFE_STDIO_MCP_ENABLED;
        (EventBus.server.emit as jest.Mock).mockClear();
        socket.emit(Events.Mcp.EXTERNAL_SERVER_REGISTER, request);

        expect(EventBus.server.emit).not.toHaveBeenCalled();
        expect(socket.emitted).toContainEqual(expect.objectContaining({
            event: Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED
        }));

        process.env.MXF_UNSAFE_STDIO_MCP_ENABLED = 'true';
        socket.emit(Events.Mcp.EXTERNAL_SERVER_REGISTER, request);

        expect(EventBus.server.emit).toHaveBeenCalledTimes(1);
        const [, trustedPayload] = (EventBus.server.emit as jest.Mock).mock.calls[0];
        expect(trustedPayload).not.toBe(request);
        expect(trustedPayload).toEqual(expect.objectContaining({
            eventType: Events.Mcp.EXTERNAL_SERVER_REGISTER,
            agentId: 'admin-1',
            channelId: 'system',
            data: expect.objectContaining({ id: 'trusted-server' })
        }));

        const discoveryHandler = mockEventBusListeners.get(
            Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED
        )?.[0];
        expect(discoveryHandler).toBeDefined();
        const unrelatedDiscovery = {
            eventId: 'unrelated-discovery',
            eventType: Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED,
            timestamp: Date.now(),
            agentId: 'SYSTEM',
            channelId: 'system',
            data: { serverId: 'another-admin-server', tools: ['private-tool'] }
        };
        const correlatedDiscovery = {
            ...unrelatedDiscovery,
            eventId: 'correlated-discovery',
            data: { serverId: 'trusted-server', tools: ['trusted-tool'] }
        };

        discoveryHandler!(unrelatedDiscovery);
        expect(socket.emitted).not.toContainEqual({
            event: Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED,
            payload: unrelatedDiscovery
        });

        discoveryHandler!(correlatedDiscovery);
        discoveryHandler!(correlatedDiscovery);
        expect(socket.emitted.filter(entry => (
            entry.event === Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED
        ))).toEqual([{
            event: Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED,
            payload: correlatedDiscovery
        }]);

        if (previousUnsafeSetting === undefined) {
            delete process.env.MXF_UNSAFE_STDIO_MCP_ENABLED;
        } else {
            process.env.MXF_UNSAFE_STDIO_MCP_ENABLED = previousUnsafeSetting;
        }
    });
});
