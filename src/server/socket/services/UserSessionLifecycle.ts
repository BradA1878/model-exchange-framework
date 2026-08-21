/**
 * Local authenticated-user socket lifecycle bridge.
 *
 * API services must be able to terminate already-authenticated user sockets
 * after a token or account authorization change without importing SocketService
 * and creating an API <-> realtime dependency cycle. SocketService installs the
 * sole local implementation while it is running.
 *
 * This bridge is intentionally process-local. A multi-process deployment must
 * publish user and PAT invalidations to every server instance before it can
 * claim cluster-wide immediate revocation.
 */

import type { Socket } from 'socket.io';

export interface UserSocketSessionLifecycle {
    registerUserSession(socket: Socket): void | Promise<void>;
    disconnectTokenSessions(tokenId: string): number | Promise<number>;
    disconnectUserSessions(userId: string): number | Promise<number>;
}

class UserSessionLifecycleRegistry {
    private socketLifecycle: UserSocketSessionLifecycle | null = null;
    private readonly userAuthorizationLocks = new Map<string, Promise<void>>();

    public setSocketLifecycle(lifecycle: UserSocketSessionLifecycle): void {
        this.socketLifecycle = lifecycle;
    }

    public clearSocketLifecycle(lifecycle: UserSocketSessionLifecycle): void {
        if (this.socketLifecycle === lifecycle) {
            this.socketLifecycle = null;
        }
    }

    private getSocketLifecycle(): UserSocketSessionLifecycle {
        if (!this.socketLifecycle) {
            throw new Error('User socket session lifecycle is not initialized');
        }
        return this.socketLifecycle;
    }

    public async registerUserSession(
        socket: Socket,
        onAuthorized?: () => void | Promise<void>
    ): Promise<void> {
        const userId = socket.data?.userId;
        if (typeof userId !== 'string' || userId.trim().length === 0) {
            throw new Error('Authenticated user socket is missing its userId');
        }
        await this.runUserAuthorizationMutation(userId, async () => {
            await this.getSocketLifecycle().registerUserSession(socket);
            const socketIsConnected = (): boolean => socket.connected !== false;

            // Privileged/user-scoped listeners capture the authenticated role.
            // Install them before releasing the same per-user lock used by role,
            // status, deletion, and PAT revocation mutations. If the socket
            // disappeared during final database validation, do not install any
            // handlers after its disconnect cleanup already ran.
            if (!socketIsConnected()) {
                throw new Error('User socket disconnected before authorization completed');
            }
            try {
                await onAuthorized?.();
            } catch (error) {
                if (socketIsConnected()) {
                    socket.disconnect(true);
                }
                throw error;
            }
            if (!socketIsConnected()) {
                throw new Error('User socket disconnected while authorization completed');
            }
        });
    }

    public async disconnectTokenSessions(tokenId: string): Promise<number> {
        if (typeof tokenId !== 'string' || tokenId.trim().length === 0) {
            throw new Error('A non-empty tokenId is required for user session eviction');
        }
        return this.getSocketLifecycle().disconnectTokenSessions(tokenId.trim());
    }

    public async disconnectUserSessions(userId: string): Promise<number> {
        if (typeof userId !== 'string' || userId.trim().length === 0) {
            throw new Error('A non-empty userId is required for user session eviction');
        }
        return this.getSocketLifecycle().disconnectUserSessions(userId.trim());
    }

    /**
     * Serialize final session registration with destructive authorization
     * mutations for one user. The operation has no timeout/fallback: callers
     * either complete the exact mutation/registration or fail.
     */
    public async runUserAuthorizationMutation<T>(
        userId: string,
        operation: () => T | Promise<T>
    ): Promise<T> {
        if (typeof userId !== 'string' || userId.trim().length === 0) {
            throw new Error('A non-empty userId is required for authorization lifecycle work');
        }
        const normalizedUserId = userId.trim();
        const previous = this.userAuthorizationLocks.get(normalizedUserId) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const tail = previous.then(() => gate, () => gate);
        this.userAuthorizationLocks.set(normalizedUserId, tail);

        await previous.catch(() => undefined);
        try {
            return await operation();
        } finally {
            release();
            if (this.userAuthorizationLocks.get(normalizedUserId) === tail) {
                this.userAuthorizationLocks.delete(normalizedUserId);
            }
        }
    }
}

export const userSessionLifecycle = new UserSessionLifecycleRegistry();
