const mockUserFindById = jest.fn();
const mockPatFindOne = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn(),
            emit: jest.fn()
        }
    }
}));

jest.mock('@mxf-dev/core/models/user', () => ({
    User: { findById: mockUserFindById }
}));
jest.mock('@mxf-dev/core/models/personalAccessToken', () => ({
    __esModule: true,
    default: { findOne: mockPatFindOne }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => {
    const childLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    };
    return {
        __esModule: true,
        default: { child: jest.fn(() => childLogger) },
        Logger: jest.fn(() => childLogger),
        logger: { child: jest.fn(() => childLogger) }
    };
});

jest.mock('../../../src/server/socket/handlers/eventForwardingHandlers', () => ({
    setupEventBusToSocketForwarding: jest.fn()
}));
jest.mock('../../../src/server/socket/handlers/connectionHandlers', () => ({
    handleConnection: jest.fn(),
    handleSocketDisconnect: jest.fn()
}));
jest.mock('../../../src/server/socket/handlers/authenticationHandlers', () => ({
    createAuthMiddleware: jest.fn(() => jest.fn())
}));
jest.mock('../../../src/server/socket/handlers/heartbeatHandlers', () => ({
    startHeartbeatMonitor: jest.fn(() => null)
}));
jest.mock('../../../src/server/socket/handlers/meilisearchHandlers', () => ({
    setupMeilisearchHandlers: jest.fn()
}));

import { SocketService } from '../../../src/server/socket/services/SocketService';
import { userSessionLifecycle } from '../../../src/server/socket/services/UserSessionLifecycle';

interface TestSocket {
    id: string;
    connected: boolean;
    data: Record<string, unknown>;
    disconnect: jest.Mock;
}

const buildSocket = (id: string, data: Record<string, unknown>): TestSocket => {
    const socket: TestSocket = {
        id,
        connected: true,
        data: {
            ...(['jwt', 'password', 'pat'].includes(String(data.authType))
                ? { role: 'consumer' }
                : {}),
            ...data
        },
        disconnect: jest.fn()
    };
    socket.disconnect.mockImplementation(() => {
        socket.connected = false;
    });
    return socket;
};

const buildBareService = (ioSockets: Map<string, TestSocket> = new Map()): SocketService => {
    const service = Object.create(SocketService.prototype) as SocketService;
    Object.assign(service as object, {
        io: { sockets: { sockets: ioSockets } },
        agents: new Map(),
        socketIds: new Map(),
        sockets: new Map(),
        heartbeats: new Map(),
        credentialExpiryTimers: new Map()
    });
    return service;
};

const trackedSocketIds = (service: SocketService): string[] => (
    [...(service as unknown as { sockets: Map<string, unknown> }).sockets.keys()]
);

describe('SocketService authenticated user lifecycle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUserFindById.mockImplementation(async (userId: string) => ({
            _id: userId,
            username: `${userId}-name`,
            role: 'consumer',
            isActive: true
        }));
        mockPatFindOne.mockImplementation(async (query: Record<string, unknown>) => ({
            tokenId: query.tokenId,
            userId: query.userId,
            isActive: true,
            revokedAt: undefined,
            scopes: [],
            expiresAt: undefined
        }));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('disconnects every socket for one exact PAT and leaves other tokens untouched', async () => {
        const service = buildBareService();
        const tokenA1 = buildSocket('pat-a-1', {
            authType: 'pat', userId: 'user-a', tokenId: 'token-a'
        });
        const tokenA2 = buildSocket('pat-a-2', {
            authType: 'pat', userId: 'user-a', tokenId: 'token-a'
        });
        const tokenB = buildSocket('pat-b', {
            authType: 'pat', userId: 'user-a', tokenId: 'token-b'
        });

        await Promise.all(
            [tokenA1, tokenA2, tokenB]
                .map(socket => service.registerUserSession(socket as never))
        );

        expect(service.disconnectTokenSessions('token-a')).toBe(2);
        expect(tokenA1.disconnect).toHaveBeenCalledWith(true);
        expect(tokenA2.disconnect).toHaveBeenCalledWith(true);
        expect(tokenB.disconnect).not.toHaveBeenCalled();
        expect(trackedSocketIds(service)).toEqual(['pat-b']);
    });

    it('disconnects JWT, password, and PAT sessions for one exact user only', async () => {
        const service = buildBareService();
        const sessions = [
            buildSocket('jwt-a', {
                authType: 'jwt', userId: 'user-a', credentialExpiresAt: Date.now() + 60_000
            }),
            buildSocket('password-a', { authType: 'password', userId: 'user-a' }),
            buildSocket('pat-a', { authType: 'pat', userId: 'user-a', tokenId: 'token-a' })
        ];
        const otherUser = buildSocket('jwt-b', {
            authType: 'jwt', userId: 'user-b', credentialExpiresAt: Date.now() + 60_000
        });
        await Promise.all(sessions.map(socket => service.registerUserSession(socket as never)));
        await service.registerUserSession(otherUser as never);

        expect(service.disconnectUserSessions('user-a')).toBe(3);
        sessions.forEach(socket => expect(socket.disconnect).toHaveBeenCalledWith(true));
        expect(otherUser.disconnect).not.toHaveBeenCalled();
        expect(trackedSocketIds(service)).toEqual(['jwt-b']);
        expect(service.disconnectUserSessions('user-b')).toBe(1);
    });

    it.each([
        ['jwt', { authType: 'jwt', userId: 'user-a' }],
        ['pat', { authType: 'pat', userId: 'user-a', tokenId: 'token-a' }]
    ])('hard-disconnects an authenticated %s session at its exact expiry', async (_label, baseData) => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
        const service = buildBareService();
        const socket = buildSocket(`expiring-${String(baseData.authType)}`, {
            ...baseData,
            credentialExpiresAt: Date.now() + 1_000
        });

        if (baseData.authType === 'pat') {
            mockPatFindOne.mockResolvedValueOnce({
                tokenId: 'token-a',
                userId: 'user-a',
                isActive: true,
                revokedAt: undefined,
                scopes: [],
                expiresAt: new Date(Date.now() + 1_000)
            });
        }
        await service.registerUserSession(socket as never);
        jest.advanceTimersByTime(999);
        expect(socket.disconnect).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);

        expect(socket.disconnect).toHaveBeenCalledTimes(1);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(trackedSocketIds(service)).toEqual([]);
        expect((service as unknown as { credentialExpiryTimers: Map<string, unknown> })
            .credentialExpiryTimers.size).toBe(0);
    });

    it('fails closed when a verified JWT expiry is absent or already elapsed', async () => {
        const service = buildBareService();
        const missingExpiry = buildSocket('jwt-missing-expiry', {
            authType: 'jwt', userId: 'user-a'
        });
        const expired = buildSocket('pat-expired', {
            authType: 'pat', userId: 'user-a', tokenId: 'token-a',
            credentialExpiresAt: Date.now() - 1
        });

        await expect(service.registerUserSession(missingExpiry as never))
            .rejects.toThrow('missing its verified expiry');
        await expect(service.registerUserSession(expired as never))
            .rejects.toThrow('expired before socket registration');
        expect(missingExpiry.disconnect).toHaveBeenCalledWith(true);
        expect(expired.disconnect).toHaveBeenCalledWith(true);
        expect(trackedSocketIds(service)).toEqual([]);
    });

    it('rebuilds mutable user and PAT authorization fields from the final locked read', async () => {
        const service = buildBareService();
        const socket = buildSocket('pat-refresh', {
            authType: 'pat',
            userId: 'user-a',
            username: 'stale-name',
            role: 'consumer',
            tokenId: 'token-a',
            scopes: ['stale-scope']
        });
        mockUserFindById.mockResolvedValueOnce({
            _id: 'user-a',
            username: 'current-name',
            role: 'consumer',
            isActive: true
        });
        mockPatFindOne.mockResolvedValueOnce({
            tokenId: 'token-a',
            userId: 'user-a',
            isActive: true,
            revokedAt: undefined,
            scopes: ['current-scope'],
            expiresAt: undefined
        });

        await service.registerUserSession(socket as never);

        expect(socket.data).toEqual(expect.objectContaining({
            userId: 'user-a',
            username: 'current-name',
            role: 'consumer',
            scopes: ['current-scope']
        }));
        expect(service.disconnectTokenSessions('token-a')).toBe(1);
    });

    it('attempts every matching eviction and fails instead of accepting a stuck socket', async () => {
        const service = buildBareService();
        const stuck = buildSocket('stuck', {
            authType: 'pat', userId: 'user-a', tokenId: 'token-a'
        });
        stuck.disconnect.mockImplementation(() => undefined);
        const healthy = buildSocket('healthy', {
            authType: 'pat', userId: 'user-a', tokenId: 'token-a'
        });
        await service.registerUserSession(stuck as never);
        await service.registerUserSession(healthy as never);

        expect(() => service.disconnectTokenSessions('token-a'))
            .toThrow('Socket stuck remained connected');
        expect(stuck.disconnect).toHaveBeenCalledWith(true);
        expect(healthy.disconnect).toHaveBeenCalledWith(true);
    });

    it('removes a user socket and its timer on ordinary disconnect, idempotently', async () => {
        jest.useFakeTimers();
        const connectionCallbacks: Array<(socket: unknown) => void> = [];
        const io = {
            use: jest.fn(),
            on: jest.fn((_event: string, callback: (socket: unknown) => void) => {
                connectionCallbacks.push(callback);
            }),
            disconnectSockets: jest.fn(),
            close: jest.fn(),
            sockets: { sockets: new Map() }
        };
        const service = new SocketService(io as never);
        const disconnectCallbacks: Array<(reason: string) => void> = [];
        const socket = {
            ...buildSocket('ordinary-disconnect', {
                authType: 'jwt', userId: 'user-a', credentialExpiresAt: Date.now() + 10_000
            }),
            once: jest.fn((_event: string, callback: (reason: string) => void) => {
                disconnectCallbacks.push(callback);
            })
        };

        try {
            expect(connectionCallbacks).toHaveLength(1);
            connectionCallbacks[0](socket);
            await service.registerUserSession(socket as never);
            expect(trackedSocketIds(service)).toEqual(['ordinary-disconnect']);

            disconnectCallbacks[0]('client namespace disconnect');
            disconnectCallbacks[0]('duplicate callback');
            jest.advanceTimersByTime(10_000);

            expect(trackedSocketIds(service)).toEqual([]);
            expect(socket.disconnect).not.toHaveBeenCalled();
        } finally {
            service.shutdown();
        }
    });

    it('unrefs long-lived credential timers while retaining explicit cleanup', async () => {
        const service = buildBareService();
        const socket = buildSocket('jwt-unref', {
            authType: 'jwt',
            userId: 'user-a',
            credentialExpiresAt: Date.now() + 60_000
        });

        await service.registerUserSession(socket as never);

        const timer = (service as unknown as {
            credentialExpiryTimers: Map<string, NodeJS.Timeout>;
        }).credentialExpiryTimers.get(socket.id);
        expect(timer).toBeDefined();
        expect(timer?.hasRef()).toBe(false);

        expect(service.disconnectUserSessions('user-a')).toBe(1);
        expect((service as unknown as {
            credentialExpiryTimers: Map<string, NodeJS.Timeout>;
        }).credentialExpiryTimers.size).toBe(0);
    });

    it.each([
        ['deactivation', { role: 'admin', isActive: false }],
        ['role change', { role: 'consumer', isActive: true }]
    ])('rejects stale registration when %s wins the per-user lifecycle lock', async (
        _reason,
        currentAuthorization
    ) => {
        const service = buildBareService();
        const socket = buildSocket('stale-user-auth', {
            authType: 'password',
            userId: 'user-a',
            role: 'admin'
        });
        const installHandlers = jest.fn();
        let releaseMutation!: () => void;
        let signalMutationStarted!: () => void;
        const mutationStarted = new Promise<void>(resolve => {
            signalMutationStarted = resolve;
        });
        const mutationGate = new Promise<void>(resolve => {
            releaseMutation = resolve;
        });
        mockUserFindById.mockImplementation(async () => ({
            _id: 'user-a',
            username: 'current-name',
            ...currentAuthorization
        }));
        userSessionLifecycle.setSocketLifecycle(service);

        try {
            const mutation = userSessionLifecycle.runUserAuthorizationMutation(
                'user-a',
                async () => {
                    signalMutationStarted();
                    await mutationGate;
                    service.disconnectUserSessions('user-a');
                }
            );
            await mutationStarted;

            const registration = userSessionLifecycle.registerUserSession(
                socket as never,
                installHandlers
            );
            expect(mockUserFindById).not.toHaveBeenCalled();

            releaseMutation();
            await mutation;
            await expect(registration).rejects.toThrow(
                'User authorization changed before socket registration completed'
            );

            expect(installHandlers).not.toHaveBeenCalled();
            expect(socket.disconnect).toHaveBeenCalledWith(true);
            expect(trackedSocketIds(service)).toEqual([]);
        } finally {
            userSessionLifecycle.clearSocketLifecycle(service);
        }
    });

    it('rejects stale PAT registration when revocation wins the lifecycle lock', async () => {
        const service = buildBareService();
        const socket = buildSocket('stale-pat', {
            authType: 'pat',
            userId: 'user-a',
            tokenId: 'token-a'
        });
        const installHandlers = jest.fn();
        let tokenActive = true;
        let releaseMutation!: () => void;
        let signalMutationStarted!: () => void;
        const mutationStarted = new Promise<void>(resolve => {
            signalMutationStarted = resolve;
        });
        const mutationGate = new Promise<void>(resolve => {
            releaseMutation = resolve;
        });
        mockPatFindOne.mockImplementation(async () => tokenActive ? {
            tokenId: 'token-a',
            userId: 'user-a',
            isActive: true,
            revokedAt: undefined,
            scopes: [],
            expiresAt: undefined
        } : null);
        userSessionLifecycle.setSocketLifecycle(service);

        try {
            const revocation = userSessionLifecycle.runUserAuthorizationMutation(
                'user-a',
                async () => {
                    tokenActive = false;
                    signalMutationStarted();
                    await mutationGate;
                    service.disconnectTokenSessions('token-a');
                }
            );
            await mutationStarted;

            const registration = userSessionLifecycle.registerUserSession(
                socket as never,
                installHandlers
            );
            expect(mockPatFindOne).not.toHaveBeenCalled();

            releaseMutation();
            await revocation;
            await expect(registration).rejects.toThrow(
                'PAT authorization changed before socket registration completed'
            );

            expect(installHandlers).not.toHaveBeenCalled();
            expect(socket.disconnect).toHaveBeenCalledWith(true);
            expect(trackedSocketIds(service)).toEqual([]);
        } finally {
            userSessionLifecycle.clearSocketLifecycle(service);
        }
    });

    it('serializes handler installation before a waiting role mutation can evict the socket', async () => {
        const service = buildBareService();
        const socket = buildSocket('atomic-handler-install', {
            authType: 'password',
            userId: 'user-a',
            role: 'consumer'
        });
        let releaseHandlerInstall!: () => void;
        let signalHandlerInstallStarted!: () => void;
        const handlerInstallStarted = new Promise<void>(resolve => {
            signalHandlerInstallStarted = resolve;
        });
        const handlerInstallGate = new Promise<void>(resolve => {
            releaseHandlerInstall = resolve;
        });
        let handlersInstalled = false;
        let mutationCompleted = false;
        userSessionLifecycle.setSocketLifecycle(service);

        try {
            const registration = userSessionLifecycle.registerUserSession(
                socket as never,
                async () => {
                    signalHandlerInstallStarted();
                    await handlerInstallGate;
                    handlersInstalled = true;
                }
            );
            await handlerInstallStarted;

            const mutation = userSessionLifecycle.runUserAuthorizationMutation(
                'user-a',
                async () => {
                    service.disconnectUserSessions('user-a');
                    mutationCompleted = true;
                }
            );
            await Promise.resolve();
            expect(mutationCompleted).toBe(false);
            expect(socket.disconnect).not.toHaveBeenCalled();

            releaseHandlerInstall();
            await registration;
            await mutation;

            expect(handlersInstalled).toBe(true);
            expect(mutationCompleted).toBe(true);
            expect(socket.disconnect).toHaveBeenCalledWith(true);
            expect(trackedSocketIds(service)).toEqual([]);
        } finally {
            userSessionLifecycle.clearSocketLifecycle(service);
        }
    });

    it('installs and clears the API-to-socket lifecycle bridge', async () => {
        const setLifecycle = jest.spyOn(userSessionLifecycle, 'setSocketLifecycle');
        const clearLifecycle = jest.spyOn(userSessionLifecycle, 'clearSocketLifecycle');
        const io = {
            use: jest.fn(),
            on: jest.fn(),
            disconnectSockets: jest.fn(),
            close: jest.fn((callback: (error?: Error) => void) => callback()),
            sockets: { sockets: new Map() }
        };
        const service = new SocketService(io as never);

        expect(setLifecycle).toHaveBeenCalledWith(service);
        await service.shutdown();
        expect(clearLifecycle).toHaveBeenCalledWith(service);
    });
});
