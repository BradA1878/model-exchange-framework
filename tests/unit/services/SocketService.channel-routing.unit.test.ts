jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn(),
            emit: jest.fn()
        }
    }
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

const mockHandleSocketDisconnect = jest.fn();

jest.mock('../../../src/server/socket/handlers/connectionHandlers', () => ({
    handleConnection: jest.fn(),
    handleSocketDisconnect: mockHandleSocketDisconnect
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
import channelKeyService from '../../../src/server/socket/services/ChannelKeyService';
import ChannelKey from '@mxf-dev/core/models/channelKey';

const buildBareService = (ioSockets: Map<string, unknown> = new Map()): SocketService => {
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

describe('SocketService channel-aware agent lookup', () => {
    it('returns a socket only when registry and authenticated socket identity match', () => {
        const socket = {
            id: 'socket-agent-a-channel-b',
            data: {
                agentId: 'agent-a',
                channelId: 'channel-b'
            }
        };
        const service = Object.create(SocketService.prototype) as SocketService;
        (service as unknown as { agents: Map<string, unknown> }).agents = new Map([
            ['agent-a', {
                socket,
                channelId: 'channel-b',
                connected: true,
                lastActivity: Date.now()
            }]
        ]);

        expect(service.getSocketByAgentId('agent-a', 'channel-a')).toBeNull();
        expect(service.getSocketByAgentId('agent-a', 'channel-b')).toBe(socket);

        socket.data.channelId = 'channel-c';
        expect(service.getSocketByAgentId('agent-a', 'channel-b')).toBeNull();
    });

    it('wires and clears the authoritative credential lifecycle bridge', async () => {
        const setLifecycle = jest.spyOn(channelKeyService, 'setSocketLifecycle');
        const clearLifecycle = jest.spyOn(channelKeyService, 'clearSocketLifecycle');
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
        setLifecycle.mockRestore();
        clearLifecycle.mockRestore();
    });

    it('waits for transport closure and shares one idempotent shutdown', async () => {
        let completeClose: ((error?: Error) => void) | undefined;
        const io = {
            use: jest.fn(),
            on: jest.fn(),
            disconnectSockets: jest.fn(),
            close: jest.fn((callback: (error?: Error) => void) => {
                completeClose = callback;
            }),
            sockets: { sockets: new Map() }
        };
        const service = new SocketService(io as never);

        const first = service.shutdown();
        const second = service.shutdown();
        let settled = false;
        void first.then(() => { settled = true; });
        await Promise.resolve();

        expect(second).toBe(first);
        expect(io.disconnectSockets).toHaveBeenCalledWith(true);
        expect(io.close).toHaveBeenCalledTimes(1);
        expect(settled).toBe(false);

        completeClose?.();
        await expect(first).resolves.toBeUndefined();
        expect(settled).toBe(true);
    });

    it('owns disconnect exactly once and drains async cleanup before shutdown resolves', async () => {
        let connectionHandler: ((socket: unknown) => void) | undefined;
        let disconnectHandler: ((reason: string) => void) | undefined;
        let releaseDisconnect!: () => void;
        const disconnectGate = new Promise<void>(resolve => {
            releaseDisconnect = resolve;
        });
        mockHandleSocketDisconnect.mockImplementation(async () => {
            await disconnectGate;
        });

        const socket = {
            id: 'socket-drained',
            connected: true,
            data: { agentId: 'agent-drained', channelId: 'channel-drained' },
            once: jest.fn((_event: string, handler: (reason: string) => void) => {
                disconnectHandler = handler;
            })
        };
        const io = {
            use: jest.fn(),
            on: jest.fn((_event: string, handler: (socket: unknown) => void) => {
                connectionHandler = handler;
            }),
            disconnectSockets: jest.fn(() => {
                disconnectHandler?.('server shutting down');
            }),
            close: jest.fn((callback: (error?: Error) => void) => callback()),
            sockets: { sockets: new Map([[socket.id, socket]]) }
        };
        const service = new SocketService(io as never);
        connectionHandler?.(socket);
        service.registerSocket(socket as never, 'agent-drained', 'channel-drained');

        let shutdownSettled = false;
        const shutdown = service.shutdown().then(() => {
            shutdownSettled = true;
        });
        await Promise.resolve();

        expect(mockHandleSocketDisconnect).toHaveBeenCalledTimes(1);
        expect(mockHandleSocketDisconnect).toHaveBeenCalledWith(
            socket.id,
            'channel-drained',
            'agent-drained',
            'server shutting down',
            service
        );
        expect(shutdownSettled).toBe(false);

        releaseDisconnect();
        await shutdown;
        expect(shutdownSettled).toBe(true);
    });

    it('still drains disconnect cleanup when transport closure fails', async () => {
        let connectionHandler: ((socket: unknown) => void) | undefined;
        let disconnectHandler: ((reason: string) => void) | undefined;
        let releaseDisconnect!: () => void;
        const disconnectGate = new Promise<void>(resolve => {
            releaseDisconnect = resolve;
        });
        mockHandleSocketDisconnect.mockImplementation(async () => {
            await disconnectGate;
        });
        mockHandleSocketDisconnect.mockClear();

        const socket = {
            id: 'socket-close-failure',
            connected: true,
            data: { agentId: 'agent-close-failure', channelId: 'channel-close-failure' },
            once: jest.fn((_event: string, handler: (reason: string) => void) => {
                disconnectHandler = handler;
            })
        };
        const closeFailure = new Error('transport close failed');
        const io = {
            use: jest.fn(),
            on: jest.fn((_event: string, handler: (socket: unknown) => void) => {
                connectionHandler = handler;
            }),
            disconnectSockets: jest.fn(() => {
                disconnectHandler?.('transport close');
            }),
            close: jest.fn((callback: (error?: Error) => void) => callback(closeFailure)),
            sockets: { sockets: new Map([[socket.id, socket]]) }
        };
        const service = new SocketService(io as never);
        connectionHandler?.(socket);
        service.registerSocket(
            socket as never,
            'agent-close-failure',
            'channel-close-failure'
        );

        let shutdownSettled = false;
        const shutdown = service.shutdown().finally(() => {
            shutdownSettled = true;
        });
        await Promise.resolve();
        expect(shutdownSettled).toBe(false);
        expect(mockHandleSocketDisconnect).toHaveBeenCalledTimes(1);

        releaseDisconnect();
        await expect(shutdown).rejects.toBe(closeFailure);
        expect(shutdownSettled).toBe(true);
        expect(service.getAgentSocketInfo('agent-close-failure')).toBeNull();
    });

    it('disconnects only the live socket for a key revoked through ChannelKeyService', async () => {
        const oldKeySocket = {
            id: 'socket-old-key',
            connected: true,
            data: {
                authType: 'key',
                keyId: 'key-owner-a',
                agentId: 'shared-agent-id',
                channelId: 'channel-a'
            },
            disconnect: jest.fn(function(this: { connected: boolean }) {
                this.connected = false;
            })
        };
        const otherOwnerSocket = {
            id: 'socket-other-owner',
            connected: true,
            data: {
                authType: 'key',
                keyId: 'key-owner-b',
                agentId: 'shared-agent-id',
                channelId: 'channel-b'
            },
            disconnect: jest.fn()
        };
        const ioSockets = new Map<string, unknown>([
            [oldKeySocket.id, oldKeySocket],
            [otherOwnerSocket.id, otherOwnerSocket]
        ]);
        const io = {
            use: jest.fn(),
            on: jest.fn(),
            disconnectSockets: jest.fn(),
            close: jest.fn(),
            sockets: { sockets: ioSockets }
        };
        const updateOne = jest.spyOn(ChannelKey, 'updateOne')
            .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
        const service = new SocketService(io as never);

        try {
            await expect(channelKeyService.deactivateChannelKey('key-owner-a'))
                .resolves.toBe(true);
            expect(updateOne).toHaveBeenCalledWith(
                { keyId: 'key-owner-a', isActive: true },
                { $set: { isActive: false, updatedAt: expect.any(Date) } }
            );
            expect(oldKeySocket.disconnect).toHaveBeenCalledWith(true);
            expect(otherOwnerSocket.disconnect).not.toHaveBeenCalled();
        } finally {
            service.shutdown();
            updateOne.mockRestore();
        }
    });

    it('does not report revocation success while the exact socket remains connected', async () => {
        const stuckSocket = {
            id: 'socket-stuck',
            connected: true,
            data: { authType: 'key', keyId: 'key-stuck' },
            disconnect: jest.fn()
        };
        const io = {
            use: jest.fn(),
            on: jest.fn(),
            disconnectSockets: jest.fn(),
            close: jest.fn(),
            sockets: { sockets: new Map([[stuckSocket.id, stuckSocket]]) }
        };
        const updateOne = jest.spyOn(ChannelKey, 'updateOne')
            .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
        const service = new SocketService(io as never);

        try {
            await expect(channelKeyService.deactivateChannelKey('key-stuck'))
                .resolves.toBe(false);
            expect(stuckSocket.disconnect).toHaveBeenCalledWith(true);
            expect(stuckSocket.connected).toBe(true);
        } finally {
            service.shutdown();
            updateOne.mockRestore();
        }
    });

    it('disconnects a registered key socket exactly when its credential expires', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));

        try {
            const expiresAt = Date.now() + 1_000;
            const expiringSocket = {
                id: 'socket-expiring',
                connected: true,
                data: {
                    authType: 'key',
                    keyId: 'key-expiring',
                    agentId: 'agent-expiring',
                    channelId: 'channel-a',
                    credentialExpiresAt: expiresAt
                },
                disconnect: jest.fn(function(this: { connected: boolean }) {
                    this.connected = false;
                })
            };
            const service = buildBareService();

            service.registerSocket(expiringSocket as never, 'agent-expiring', 'channel-a');
            expect(expiringSocket.disconnect).not.toHaveBeenCalled();

            jest.advanceTimersByTime(999);
            expect(expiringSocket.disconnect).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1);
            expect(expiringSocket.disconnect).toHaveBeenCalledTimes(1);
            expect(expiringSocket.disconnect).toHaveBeenCalledWith(true);
            expect((service as unknown as { credentialExpiryTimers: Map<string, unknown> })
                .credentialExpiryTimers.size).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it('rejects a credential that expires before socket registration finishes', () => {
        const socket = {
            id: 'socket-already-expired',
            connected: true,
            data: {
                authType: 'key',
                keyId: 'key-expired',
                credentialExpiresAt: Date.now() - 1
            },
            disconnect: jest.fn()
        };
        const service = buildBareService();

        expect(() => service.registerSocket(socket as never, 'agent-a', 'channel-a'))
            .toThrow('expired before socket registration');
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(service.getAgentSocketInfo('agent-a')).toBeNull();
    });

    it('clears a credential expiry timer when the socket unregisters', () => {
        jest.useFakeTimers();
        try {
            const socket = {
                id: 'socket-unregistered',
                connected: true,
                data: {
                    authType: 'key',
                    keyId: 'key-unregistered',
                    credentialExpiresAt: Date.now() + 1_000
                },
                disconnect: jest.fn()
            };
            const service = buildBareService();

            service.registerSocket(socket as never, 'agent-a', 'channel-a');
            service.unregisterSocket(socket.id, 'agent-a');
            jest.advanceTimersByTime(1_000);

            expect(socket.disconnect).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });
});
