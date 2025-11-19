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
 * Socket Service Interface
 * 
 * This interface defines the public API for the SocketService that handler modules need to access.
 * It ensures proper separation of concerns while allowing the handlers to perform necessary operations.
 */

import { Server as SocketServer, Socket } from 'socket.io';

/**
 * Interface for agent socket information
 */
export interface AgentSocketInfo {
    socket: Socket | null;
    channelId: string;
    connected: boolean;
    lastActivity: number;
}

/**
 * Socket Service Interface
 * Defines the public methods that handlers can access
 */
export interface ISocketService {
    /**
     * Register a socket with an agent ID
     * @param socket Socket to register
     * @param agentId Agent ID to associate with the socket
     * @param channelId Channel ID for the socket context
     */
    registerSocket(socket: Socket, agentId: string, channelId: string): void;
    
    /**
     * Unregister a socket
     * @param socketId Socket ID to unregister
     * @param agentId Agent ID associated with the socket
     */
    unregisterSocket(socketId: string, agentId: string): void;
    
    /**
     * Update the heartbeat timestamp for an agent
     * @param agentId Agent ID to update heartbeat for
     */
    updateHeartbeat(agentId: string): void;
    
    /**
     * Get the socket information for an agent
     * @param agentId Agent ID to get socket info for
     * @returns Socket information or null if not found
     */
    getAgentSocketInfo(agentId: string): AgentSocketInfo | null;
    
    /**
     * Get the socket for an agent by its ID
     * @param agentId Agent ID to find the socket for
     * @returns The socket for the agent, or null if not found
     */
    getSocketByAgentId(agentId: string): Socket | null;
    
    /**
     * Get the Socket.IO server instance
     * @returns The Socket.IO server or null if not initialized
     */
    getSocketServer(): SocketServer | null;
    
    /**
     * Get the normalized channel name for a given channel ID
     * @param channelId Channel ID to normalize
     * @returns Normalized channel name
     */
    getNormalizedChannelName(channelId: string): string;
    
    /**
     * Get all heartbeats for monitoring
     * @returns Map of agent IDs to last activity timestamps
     */
    getAllHeartbeats(): Map<string, number>;
    
    /**
     * Check if the socket service is running
     * @returns True if the socket server is initialized and running
     */
    isRunning(): boolean;
}
