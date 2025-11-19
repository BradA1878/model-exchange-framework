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
 * @documentation https://brada1878.github.io/model-exchange-framework/
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
import { 
    Events,
    CoreSocketEvents
} from '../../../shared/events/EventNames';
import { AgentConnectionStatus } from '../../../shared/types/AgentTypes';
import { EventBus } from '../../../shared/events/EventBus';
import logger from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { AgentService } from './AgentService';
import { ISocketService, AgentSocketInfo as IAgentSocketInfo } from '../../../shared/interfaces/SocketServiceInterface';
import { setupEventBusToSocketForwarding } from '../handlers/eventForwardingHandlers';
import { handleConnection } from '../handlers/connectionHandlers';
import { createAuthMiddleware } from '../handlers/authenticationHandlers';
import { handleSocketDisconnect } from '../handlers/connectionHandlers';
import { startHeartbeatMonitor } from '../handlers/heartbeatHandlers';
import { setupMeilisearchHandlers } from '../handlers/meilisearchHandlers';

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
export class SocketService implements ISocketService {
    private io: SocketServer | null = null;
    private logger = logger.child('SocketService'); // Use child logger
    private readonly heartbeatInterval: number = 30000; // 30 seconds
    private readonly heartbeatTimeout: number = 300000; // 300 seconds (5 minutes) - allows for complex LLM processing
    // Agent tracking
    private agents = new Map<string, AgentSocketInfo>(); // Maps agentId -> socket info
    private socketIds = new Map<string, string>(); // Maps socketId -> agentId
    private sockets = new Map<string, Socket>(); // Maps socketId -> socket
    // Heartbeat tracking
    private heartbeats = new Map<string, number>(); // Maps agentId -> last heartbeat time
    private heartbeatMonitor: NodeJS.Timeout | null = null;
    private readonly validator = createStrictValidator();
    private agentService: AgentService | null = null;

    /**
     * Constructor
     */
    constructor(io: SocketServer) {
        const validator = createStrictValidator('SocketService.initialize');
        
        if (!io) {
            throw new Error('Socket.IO server is required');
        }

        
        // Store the provided Socket.IO server instance
        this.io = io;
        
        // AgentService will be initialized lazily when needed
        // to avoid early singleton instantiation
            
        // Connect Socket.IO server to EventBus for proper event routing
        // This is critical for events emitted through EventBus to reach client sockets
        EventBus.server.setSocketServer(io);
        
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
                    this.handleSocketDisconnect(socket.id, channelId, agentId, reason);
                }
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
    private async handleSocketDisconnect(socketId: string, channelId: string, agentId: string, reason: string): Promise<void> {
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
            const disconnectAgent = async (socketId: string, agentId: string, reason: string) => {
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
    public shutdown(): void {
        
        // Clear heartbeat monitor
        if (this.heartbeatMonitor) {
            clearInterval(this.heartbeatMonitor);
            this.heartbeatMonitor = null;
        }
        
        // Disconnect all sockets
        if (this.io) {
            this.io.disconnectSockets(true);
            this.io.close();
            this.io = null;
        }
        
        // Clear all maps
        this.agents.clear();
        this.socketIds.clear();
        this.sockets.clear();
        this.heartbeats.clear();
        
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
     * @returns The socket for the agent, or null if not found
     */
    public getSocketByAgentId(agentId: string): Socket | null {
        const agentInfo = this.agents.get(agentId);
        return agentInfo ? agentInfo.socket : null;
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
        this.heartbeats.set(agentId, Date.now());
        
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
}
