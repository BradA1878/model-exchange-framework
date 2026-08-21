/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Socket Service
 * 
 * Responsible for managing Socket.IO connections and managing the socket lifecycle.
 * This service handles:
 * 1. Socket initialization and authentication
 * 2. Connection management
 * 3. Agent identity validation
 * 4. Socket-to-EventBus bridging
 * 
 * The SocketService does NOT handle:
 * - Channel management (delegated to ChannelService)
 * - Message routing (delegated to EventBus)
 * - Business logic (delegated to appropriate services)
 */

import { Server as SocketServer, Socket } from 'socket.io';
import { CoreSocketEvents } from '@mxf-dev/core/events/EventNames';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import logger from '@mxf-dev/core/utils/Logger';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { AgentService } from './AgentService';
import { ISocketService, AgentSocketInfo as IAgentSocketInfo } from '@mxf-dev/core/interfaces/SocketServiceInterface';
import { setupEventBusToSocketForwarding } from '../handlers/eventForwardingHandlers';
import { handleConnection } from '../handlers/connectionHandlers';
import { createAuthMiddleware } from '../handlers/authenticationHandlers';
import { handleSocketDisconnect } from '../handlers/connectionHandlers';
import { startHeartbeatMonitor } from '../handlers/heartbeatHandlers';
import { setupMeilisearchHandlers } from '../handlers/meilisearchHandlers';
import channelKeyService, { ChannelKeySocketLifecycle } from './ChannelKeyService';
import {
    userSessionLifecycle,
    UserSocketSessionLifecycle
} from './UserSessionLifecycle';
import { User } from '@mxf-dev/core/models/user';
import PersonalAccessToken from '@mxf-dev/core/models/personalAccessToken';

// Agent connection information (internal implementation)
interface AgentSocketInfo {
    socket: Socket;
    channelId: string;
    connected: boolean;
    lastActivity: number;
}

/**
 * Socket Service for managing agent connections
 */
export class SocketService implements ISocketService, ChannelKeySocketLifecycle, UserSocketSessionLifecycle {
    private io: SocketServer | null = null;
    private logger = logger.child('SocketService'); // Use child logger
    // Agent tracking
    private agents = new Map<string, AgentSocketInfo>(); // Maps agentId -> socket info
    private socketIds = new Map<string, string>(); // Maps socketId -> agentId
    private sockets = new Map<string, Socket>(); // Maps socketId -> socket
    // Heartbeat tracking
    private heartbeats = new Map<string, number>(); // Maps agentId -> last heartbeat time
    private heartbeatMonitor: NodeJS.Timeout | null = null;
    private credentialExpiryTimers = new Map<string, NodeJS.Timeout>();
    private agentService: AgentService | null = null;
    private readonly pendingDisconnects = new Set<Promise<void>>();
    private shutdownPromise: Promise<void> | undefined;

    /**
     * Constructor
     */
    constructor(io: SocketServer) {
        if (!io) {
            throw new Error('Socket.IO server is required');
        }

        
        // Store the provided Socket.IO server instance
        this.io = io;
        channelKeyService.setSocketLifecycle(this);
        userSessionLifecycle.setSocketLifecycle(this);
        
        // AgentService will be initialized lazily when needed
        // to avoid early singleton instantiation
            
        // Set up authentication middleware
        this.io.use(this.authMiddleware.bind(this));
        
        // Handle new connections
        this.io.on(CoreSocketEvents.CONNECTION, this.handleConnection.bind(this));
        
        // Start heartbeat monitor
        this.startHeartbeatMonitor();
        
        // Set up event forwarding
        this.setupEventForwarding();
        
    }

    /**
     * Get AgentService instance lazily
     */
    private getAgentService(): AgentService {
        if (!this.agentService) {
            this.agentService = AgentService.getInstance();
        }
        return this.agentService;
    }

    /**
     * Authentication middleware for Socket.IO
     * @param socket - Socket to authenticate
     * @param next - Next middleware function
     */
    private authMiddleware(socket: Socket, next: (err?: Error) => void): void {
        try {
            // Import and use the authentication handlers
            
            
            // Get the middleware function from the authenticationHandlers
            const authMiddleware = createAuthMiddleware();
            
            // Use the middleware function
            authMiddleware(socket, next);
        } catch (error) {
            this.logger.error(`Authentication middleware error: ${error}`);
            next(new Error('Authentication failed'));
        }
    }
    
    /**
     * Handle a new socket connection
     * @param socket Socket instance
     */
    private handleConnection(socket: Socket): void {
        try {
            // Store a reference to the socket by ID for quick lookups
            // We'll do this before calling the handler in case the handler needs it
            this.sockets.set(socket.id, socket);
            
            // Log the new connection
            
            // Use the connection handler to handle the connection
            // Pass the socketService instance so the handler can access our methods
            handleConnection(socket, this);
            
            // Set up disconnect event handling once, to avoid multiple handlers
            // This ensures we don't process disconnects multiple times
            socket.once('disconnect', (reason) => {
                // Get agentId before potential cleanup by unregisterSocket
                const agentId = this.socketIds.get(socket.id);
                
                // Get agent info
                const agentInfo = agentId ? this.agents.get(agentId) : null;
                const channelId = agentInfo ? agentInfo.channelId : '';
                
                
                if (agentId) {
                    void this.handleSocketDisconnect(socket.id, channelId, agentId, reason);
                    return;
                }

                // User and unauthenticated sockets are not represented in the
                // agent maps. They must still leave the service registry and
                // release any JWT/PAT expiry timer on every disconnect path.
                this.unregisterUserSession(socket.id);
            });
        } catch (error) {
            this.logger.error(`Error handling socket connection: ${error}`);
        }
    }
    
    /**
     * Set up server-side event listeners for EventBus events that need to be forwarded to clients
     * This maintains our clean architecture by keeping socket operations in SocketService
     */
    private setupEventForwarding(): void {
        try {

            // Set up event forwarding using the handler module
            setupEventBusToSocketForwarding(this);

            // Set up Meilisearch handlers for server-side indexing with embeddings
            setupMeilisearchHandlers();

        } catch (error) {
            this.logger.error(`Error setting up event forwarding: ${error}`);
        }
    }
    
    /**
     * Handle a socket disconnection
     * @param socketId - Socket ID that disconnected
     * @param agentId - Agent ID
     * @param channelId - Channel ID
     * @param reason - Reason for disconnection
     */
    private handleSocketDisconnect(
        socketId: string,
        channelId: string,
        agentId: string,
        reason: string
    ): Promise<void> {
        const operation = this.performSocketDisconnect(socketId, channelId, agentId, reason);
        this.pendingDisconnects.add(operation);
        void operation.then(
            () => this.pendingDisconnects.delete(operation),
            () => this.pendingDisconnects.delete(operation)
        );
        return operation;
    }

    private async performSocketDisconnect(
        socketId: string,
        channelId: string,
        agentId: string,
        reason: string
    ): Promise<void> {
        try {
            
            // Handle the socket disconnect using the handler module
            await handleSocketDisconnect(socketId, channelId, agentId, reason, this);
        } catch (error) {
            this.logger.error(`Error handling socket disconnect: ${error}`);
        }
    }
    
    /**
     * Update the heartbeat timestamp for an agent
     * @param agentId - Agent ID to update heartbeat for
     */
    public updateHeartbeat(agentId: string): void {
        this.heartbeats.set(agentId, Date.now());
    }
    
    /**
     * Start the heartbeat monitor to detect disconnected agents
     */
    private startHeartbeatMonitor(): void {
        try {
            
            // Clean up any existing heartbeat monitor
            if (this.heartbeatMonitor) {
                clearInterval(this.heartbeatMonitor);
            }
            
            // Define callback functions for the heartbeat handler to use
            const getSocketInfo = this.getAgentSocketInfo.bind(this);
            const disconnectAgent = async (
                socketId: string,
                agentId: string,
                reason: string
            ): Promise<void> => {
                // Get channel ID for this agent
                const agentInfo = this.agents.get(agentId);
                const channelId = agentInfo?.channelId || 'system';

                // Use the full disconnect handler to ensure proper cleanup
                // This will handle unregistering, status updates, and channel removal
                await this.handleSocketDisconnect(socketId, channelId, agentId, reason);
            };
            
            // Start the heartbeat monitor using the handler module
            this.heartbeatMonitor = startHeartbeatMonitor(
                this.heartbeats,
                getSocketInfo,
                disconnectAgent
            );
            
        } catch (error) {
            this.logger.error(`Error starting heartbeat monitor: ${error}`);
        }
    }
    
    /**
     * Shutdown the socket service
     */
    public shutdown(): Promise<void> {
        if (!this.shutdownPromise) {
            this.shutdownPromise = this.performShutdown();
        }
        return this.shutdownPromise;
    }

    private async performShutdown(): Promise<void> {
        
        // Clear heartbeat monitor
        if (this.heartbeatMonitor) {
            clearInterval(this.heartbeatMonitor);
            this.heartbeatMonitor = null;
        }

        for (const timer of this.credentialExpiryTimers.values()) {
            clearTimeout(timer);
        }
        this.credentialExpiryTimers.clear();
        
        // Detach the transport before awaiting its close callback so a second
        // caller cannot begin another close against the same Socket.IO server.
        const socketServer = this.io;
        this.io = null;
        let transportError: unknown;
        try {
            socketServer?.disconnectSockets(true);
        } catch (error) {
            transportError = error;
        }

        if (socketServer) {
            try {
                await new Promise<void>((resolve, reject) => {
                    socketServer.close(error => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve();
                    });
                });
            } catch (error) {
                transportError ??= error;
            }
        }

        // Socket.IO does not await promises returned by disconnect listeners. Drain
        // the work explicitly before later shutdown steps close dependent services
        // and MongoDB. Loop in case one disconnect operation synchronously starts
        // another while the first batch is settling.
        while (this.pendingDisconnects.size > 0) {
            await Promise.all([...this.pendingDisconnects]);
        }

        // Clear all maps only after disconnect handlers have finished using the
        // authoritative socket registry and channel lifecycle services.
        this.agents.clear();
        this.socketIds.clear();
        this.sockets.clear();
        this.heartbeats.clear();
        channelKeyService.clearSocketLifecycle(this);
        userSessionLifecycle.clearSocketLifecycle(this);

        if (transportError !== undefined) {
            throw transportError;
        }
        
    }
    
    /**
     * Check if the socket service is running
     * @returns True if the socket server is initialized and running
     */
    public isRunning(): boolean {
        return this.io !== null;
    }
    
    /**
     * Get the socket for an agent by its ID
     * @param agentId - Agent ID to find the socket for
     * @param channelId - Authenticated channel the event is scoped to
     * @returns The socket for the agent in that exact channel, or null if not found
     */
    public getSocketByAgentId(agentId: string, channelId: string): Socket | null {
        const agentInfo = this.agents.get(agentId);
        if (!agentInfo || agentInfo.channelId !== channelId) {
            return null;
        }

        // Check both the server registry and the immutable authentication
        // context. A later connection may reuse an agent id in another channel;
        // it must never receive results addressed to the original channel.
        if (agentInfo.socket.data?.agentId !== agentId ||
            agentInfo.socket.data?.channelId !== channelId) {
            return null;
        }

        return agentInfo.socket;
    }
    
    /**
     * Get the normalized channel name for a given channel ID
     * @param channelId - Channel ID to normalize
     * @returns Normalized channel name
     */
    public getNormalizedChannelName(channelId: string): string {
        return `channel:${channelId}`;
    }
    
    /**
     * Register a socket with an agent ID
     * @param socket Socket to register
     * @param agentId Agent ID to associate with the socket
     * @param channelId Channel ID for the socket context
     */
    public registerSocket(socket: Socket, agentId: string, channelId: string): void {
        const validator = createStrictValidator('SocketService.registerSocket');
        validator.assertIsNonEmptyString(agentId);

        if (socket.data?.authType === 'key') {
            const keyId = socket.data.keyId;
            const expiresAt = socket.data.credentialExpiresAt;
            if (typeof keyId !== 'string' || keyId.length === 0) {
                socket.disconnect(true);
                throw new Error('Authenticated key socket is missing its credential id');
            }
            if (expiresAt !== undefined &&
                (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt))) {
                socket.disconnect(true);
                throw new Error('Authenticated key socket has an invalid credential expiry');
            }
            if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
                socket.disconnect(true);
                throw new Error('Authenticated key expired before socket registration completed');
            }
        }

        // Create agent info
        const agentInfo: AgentSocketInfo = {
            socket,
            channelId,
            connected: true,
            lastActivity: Date.now()
        };
        
        // Store agent info
        this.agents.set(agentId, agentInfo);
        this.socketIds.set(socket.id, agentId);
        this.sockets.set(socket.id, socket);
        this.heartbeats.set(agentId, Date.now());

        this.scheduleCredentialExpiry(socket);
    }

    /**
     * Register an authenticated JWT, password, or PAT user session.
     * User sockets were historically kept only in Socket.IO's adapter and were
     * therefore invisible to revocation and leaked from this service's raw map.
     */
    public async registerUserSession(socket: Socket): Promise<void> {
        const userId = socket.data?.userId;
        const authType = socket.data?.authType;
        if (typeof userId !== 'string' || userId.trim().length === 0 ||
            !this.isUserAuthType(authType)) {
            if (socket.connected !== false) {
                socket.disconnect(true);
            }
            throw new Error('Authenticated user socket is missing trusted session identity');
        }

        if (authType === 'pat' &&
            (typeof socket.data?.tokenId !== 'string' || socket.data.tokenId.trim().length === 0)) {
            if (socket.connected !== false) {
                socket.disconnect(true);
            }
            throw new Error('Authenticated PAT socket is missing its token id');
        }

        const expiresAt = socket.data?.credentialExpiresAt;
        if (authType === 'jwt' &&
            (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt))) {
            if (socket.connected !== false) {
                socket.disconnect(true);
            }
            throw new Error('Authenticated JWT socket is missing its verified expiry');
        }
        if (expiresAt !== undefined &&
            (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt))) {
            if (socket.connected !== false) {
                socket.disconnect(true);
            }
            throw new Error('Authenticated user socket has an invalid credential expiry');
        }
        if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
            if (socket.connected !== false) {
                socket.disconnect(true);
            }
            throw new Error('User credential expired before socket registration completed');
        }

        // Authentication may have started before a concurrent role change,
        // deactivation, deletion, or PAT revocation. The lifecycle registry
        // serializes this final read with those mutations; validate current
        // persisted authority again before installing/tracking the session.
        const user = await User.findById(userId);
        if (!user || !user.isActive || String(user.role) !== String(socket.data?.role)) {
            if (socket.connected !== false) {
                socket.disconnect(true);
            }
            throw new Error('User authorization changed before socket registration completed');
        }

        // Rebuild mutable profile and authorization fields from the record read
        // inside the lifecycle lock. Do not retain caller or stale pre-lock
        // values when installing role-sensitive socket listeners.
        socket.data.userId = String(user._id);
        socket.data.username = user.username;
        socket.data.role = user.role;

        if (authType === 'pat') {
            const token = await PersonalAccessToken.findOne({
                tokenId: socket.data.tokenId,
                userId,
                isActive: true,
                revokedAt: null
            });
            const persistedExpiry = token?.expiresAt?.getTime();
            if (!token ||
                (persistedExpiry !== undefined && persistedExpiry <= Date.now()) ||
                persistedExpiry !== expiresAt) {
                if (socket.connected !== false) {
                    socket.disconnect(true);
                }
                throw new Error('PAT authorization changed before socket registration completed');
            }
            socket.data.scopes = [...token.scopes];
        }

        if (socket.connected === false) {
            throw new Error('User socket disconnected before registration completed');
        }

        this.sockets.set(socket.id, socket);
        this.scheduleCredentialExpiry(socket);
    }
    
    /**
     * Unregister a socket
     * @param socketId Socket ID to unregister
     * @param agentId Agent ID associated with the socket
     */
    public unregisterSocket(socketId: string, agentId: string): void {
        const validator = createStrictValidator('SocketService.unregisterSocket');
        validator.assertIsNonEmptyString(socketId);
        validator.assertIsNonEmptyString(agentId);


        // Remove from maps
        this.agents.delete(agentId);
        this.socketIds.delete(socketId);
        this.sockets.delete(socketId);

        // Remove heartbeat entry to prevent stale entries
        this.heartbeats.delete(agentId);
        this.clearCredentialExpiryTimer(socketId);

    }
    
    /**
     * Get the socket information for an agent
     * @param agentId Agent ID to get socket info for
     * @returns Socket information or null if not found
     */
    public getAgentSocketInfo(agentId: string): IAgentSocketInfo | null {
        const agentInfo = this.agents.get(agentId);
        if (!agentInfo) {
            return null;
        }
        
        // Return a copy to avoid external modification
        return {
            socket: agentInfo.socket,
            channelId: agentInfo.channelId,
            connected: agentInfo.connected,
            lastActivity: agentInfo.lastActivity
        };
    }
    
    /**
     * Get the Socket.IO server instance
     * @returns The Socket.IO server or null if not initialized
     */
    public getSocketServer(): SocketServer | null {
        return this.io;
    }
    
    /**
     * Get all heartbeats for monitoring
     * @returns Map of agent IDs to last activity timestamps
     */
    public getAllHeartbeats(): Map<string, number> {
        return new Map(this.heartbeats);
    }

    /**
     * Get the count of currently connected sockets
     * @returns Number of connected sockets
     */
    public getConnectedSocketsCount(): number {
        if (!this.io) {
            return 0;
        }
        // Get the default namespace and count connected sockets
        const sockets = this.io.sockets?.sockets;
        return sockets ? sockets.size : 0;
    }

    /** Disconnect every live socket authenticated with one exact key. */
    public disconnectKeySockets(keyId: string): number {
        return this.disconnectMatchingSockets(socket => socket.data?.keyId === keyId);
    }

    /** Disconnect every live key-authenticated socket in one exact channel. */
    public disconnectChannelSockets(channelId: string): number {
        return this.disconnectMatchingSockets(socket => (
            socket.data?.authType === 'key' && socket.data?.channelId === channelId
        ));
    }

    /** Disconnect every live PAT socket carrying one exact immutable token id. */
    public disconnectTokenSessions(tokenId: string): number {
        return this.disconnectMatchingSockets(socket => (
            socket.data?.authType === 'pat' && socket.data?.tokenId === tokenId
        ));
    }

    /** Disconnect all user-authenticated sessions for one exact account. */
    public disconnectUserSessions(userId: string): number {
        return this.disconnectMatchingSockets(socket => (
            this.isUserAuthType(socket.data?.authType) && socket.data?.userId === userId
        ));
    }

    private disconnectMatchingSockets(predicate: (socket: Socket) => boolean): number {
        let disconnected = 0;
        const failures: string[] = [];
        for (const socket of this.getTrackedSockets().values()) {
            if (!predicate(socket)) {
                continue;
            }

            if (socket.connected === false) {
                if (this.isUserAuthType(socket.data?.authType)) {
                    this.unregisterUserSession(socket.id);
                } else {
                    this.clearCredentialExpiryTimer(socket.id);
                }
                continue;
            }

            try {
                socket.disconnect(true);
                if (socket.connected === true) {
                    failures.push(`Socket ${socket.id} remained connected after credential revocation`);
                    continue;
                }
                this.clearCredentialExpiryTimer(socket.id);
                if (this.isUserAuthType(socket.data?.authType)) {
                    this.unregisterUserSession(socket.id);
                }
                disconnected += 1;
            } catch (error) {
                failures.push(
                    `Socket ${socket.id} disconnect failed: ` +
                    (error instanceof Error ? error.message : String(error))
                );
            }
        }
        if (failures.length > 0) {
            throw new Error(failures.join('; '));
        }
        return disconnected;
    }

    /** Union the service registry with Socket.IO's registry during auth races. */
    private getTrackedSockets(): Map<string, Socket> {
        const tracked = new Map<string, Socket>(this.sockets);
        const ioSockets = this.io?.sockets?.sockets;
        if (ioSockets) {
            for (const [socketId, socket] of ioSockets) {
                tracked.set(socketId, socket);
            }
        }
        return tracked;
    }

    private clearCredentialExpiryTimer(socketId: string): void {
        const timer = this.credentialExpiryTimers.get(socketId);
        if (timer) {
            clearTimeout(timer);
            this.credentialExpiryTimers.delete(socketId);
        }
    }

    private isUserAuthType(authType: unknown): authType is 'jwt' | 'password' | 'pat' {
        return authType === 'jwt' || authType === 'password' || authType === 'pat';
    }

    private unregisterUserSession(socketId: string): void {
        this.sockets.delete(socketId);
        this.clearCredentialExpiryTimer(socketId);
    }

    /**
     * Schedule a key, PAT, or JWT socket's hard expiry without retaining its
     * secret/token. Long expiries are chunked because JavaScript timers have a
     * signed 32-bit delay.
     */
    private scheduleCredentialExpiry(socket: Socket): void {
        this.clearCredentialExpiryTimer(socket.id);

        const authType = socket.data?.authType;
        if ((authType !== 'key' && authType !== 'pat' && authType !== 'jwt') ||
            typeof socket.data?.credentialExpiresAt !== 'number') {
            return;
        }

        const expiresAt = socket.data.credentialExpiresAt;
        const credentialIdentity = authType === 'key'
            ? socket.data.keyId
            : authType === 'pat'
                ? socket.data.tokenId
                : socket.data.userId;
        const maxTimerDelay = 2_147_483_647;

        const scheduleNext = (): void => {
            const remaining = expiresAt - Date.now();
            if (remaining > 0) {
                const timer = setTimeout(scheduleNext, Math.min(remaining, maxTimerDelay));
                timer.unref?.();
                this.credentialExpiryTimers.set(socket.id, timer);
                return;
            }

            this.credentialExpiryTimers.delete(socket.id);
            const trackedSocket = this.getTrackedSockets().get(socket.id);
            if (trackedSocket === socket &&
                socket.connected !== false &&
                socket.data?.authType === authType &&
                (authType === 'key'
                    ? socket.data?.keyId === credentialIdentity
                    : authType === 'pat'
                        ? socket.data?.tokenId === credentialIdentity
                        : socket.data?.userId === credentialIdentity)) {
                socket.disconnect(true);
                if (authType !== 'key') {
                    this.unregisterUserSession(socket.id);
                }
            }
        };

        scheduleNext();
    }
}
