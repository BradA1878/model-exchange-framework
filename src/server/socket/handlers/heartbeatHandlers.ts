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
 * Heartbeat Handlers
 * 
 * This module provides heartbeat monitoring and connection health management
 * for the Model Exchange Framework (MXF).
 */

import { Socket } from 'socket.io';
import { AgentConnectionStatus } from '../../../shared/types/AgentTypes';
import { EventBus } from '../../../shared/events/EventBus';
import { AgentEvents, AgentPayloads } from '../../../shared/events/EventNames';
import { createStrictValidator } from '../../../shared/utils/validation';
import { createBaseEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import logger from '../../../shared/utils/Logger';

// Create module logger
const moduleLogger = logger.child('HeartbeatHandlers');

// Heartbeat configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 1800000; // 1800 seconds (30 minutes) - allows for idle agents in demos

/**
 * Start the heartbeat monitor to detect disconnected agents
 * @param heartbeats - Map of agent IDs to last activity timestamps
 * @param getSocketInfo - Function to get socket info for an agent
 * @param disconnectAgent - Function to disconnect an agent
 * @returns The heartbeat monitor interval ID
 */
export const startHeartbeatMonitor = (
    heartbeats: Map<string, number>,
    getSocketInfo: (agentId: string) => { socket: Socket | null; channelId: string } | null,
    disconnectAgent: (socketId: string, agentId: string, reason: string) => Promise<void>
): NodeJS.Timeout => {
    const validator = createStrictValidator('HeartbeatHandlers.startHeartbeatMonitor');
    
    
    // Start interval to check heartbeats
    const intervalId = setInterval(() => {
        checkHeartbeats(heartbeats, getSocketInfo, disconnectAgent);
    }, HEARTBEAT_INTERVAL);
    
    
    return intervalId;
};

/**
 * Check all agent heartbeats and disconnect inactive agents
 * @param heartbeats - Map of agent IDs to last activity timestamps
 * @param getSocketInfo - Function to get socket info for an agent
 * @param disconnectAgent - Function to disconnect an agent
 */
export const checkHeartbeats = (
    heartbeats: Map<string, number>,
    getSocketInfo: (agentId: string) => { socket: Socket | null; channelId: string } | null,
    disconnectAgent: (socketId: string, agentId: string, reason: string) => Promise<void>
): void => {
    const validator = createStrictValidator('HeartbeatHandlers.checkHeartbeats');
    
    const now = Date.now();
    
    try {
        // ;
        
        // Check each agent's heartbeat
        heartbeats.forEach((lastActivity, agentId) => {
            // Calculate time since last activity
            const timeSinceLastActivity = now - lastActivity;

            // Get socket info for agent
            const socketInfo = getSocketInfo(agentId);
            
            // If inactive for too long, disconnect
            if (timeSinceLastActivity > HEARTBEAT_TIMEOUT) {
                moduleLogger.warn(`Agent ${agentId} has been inactive for ${timeSinceLastActivity}ms, disconnecting`);
                
                // Always remove from heartbeats map to prevent re-processing
                // This must happen first to avoid repeated warnings
                heartbeats.delete(agentId);
                
                if (socketInfo && socketInfo.socket) {
                    // Get socket ID from socket info
                    const socketId = socketInfo.socket.id;

                    // Ensure we have a valid channelId, fallback to 'system' if not
                    const safeChannelId = socketInfo.channelId || 'system';


                    // Disconnect socket from Socket.IO server with reason
                    // This will trigger the socket's 'disconnect' event handler which will handle cleanup
                    socketInfo.socket.disconnect(true);

                    // Force manual cleanup in case socket disconnect handler doesn't run
                    // This ensures the agent is properly cleaned up even if there are timing issues
                    setTimeout(async () => {
                        await disconnectAgent(socketId, agentId, 'heartbeat_timeout');

                        // Create timeout payload using createBaseEventPayload for proper EventBus structure
                        const connectionData: AgentPayloads['agent:connection:status'] = {
                            agentId: agentId,
                            status: AgentConnectionStatus.DISCONNECTED
                        };

                        const connectionStatusPayload = createBaseEventPayload(
                            AgentEvents.CONNECTION_STATUS,
                            agentId,
                            safeChannelId,
                            connectionData
                        );

                        // Emit connection status event via EventBus
                        EventBus.server.emit(AgentEvents.CONNECTION_STATUS, connectionStatusPayload);

                    }, 100); // Small delay to allow socket disconnect event to process first
                } else {
                    // No valid socket found, but still need to clean up

                    // Only emit event if we have a valid channelId
                    const safeChannelId = socketInfo?.channelId || 'system';
                    if (safeChannelId && safeChannelId !== '') {
                        // Emit disconnection event even without socket info
                        const connectionData: AgentPayloads['agent:connection:status'] = {
                            agentId: agentId,
                            status: AgentConnectionStatus.DISCONNECTED
                        };

                        const connectionStatusPayload = createBaseEventPayload(
                            AgentEvents.CONNECTION_STATUS,
                            agentId,
                            safeChannelId,
                            connectionData
                        );

                        EventBus.server.emit(AgentEvents.CONNECTION_STATUS, connectionStatusPayload);
                    }
                }
            }
        });
    } catch (error) {
        moduleLogger.error(`Error checking heartbeats: ${error}`);
    }
};

/**
 * Update the heartbeat timestamp for an agent
 * @param agentId - Agent ID to update heartbeat for
 * @param heartbeats - Map of agent IDs to last activity timestamps
 */
export const updateHeartbeat = (agentId: string, heartbeats: Map<string, number>): void => {
    try {
        const validator = createStrictValidator('HeartbeatHandlers.updateHeartbeat');
        validator.assertIsNonEmptyString(agentId);
        
        // Update heartbeat with current timestamp
        heartbeats.set(agentId, Date.now());
    } catch (error) {
        moduleLogger.error(`Error updating heartbeat for agent ${agentId}: ${error}`);
    }
};

/**
 * Stop the heartbeat monitor
 * @param heartbeatMonitor - Heartbeat monitor interval ID
 */
export const stopHeartbeatMonitor = (heartbeatMonitor: NodeJS.Timeout | null): void => {
    if (heartbeatMonitor) {
        clearInterval(heartbeatMonitor);
    }
};