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
 * Utility Handlers
 * 
 * This module provides utility functions for socket operations in the MXF.
 * It includes helper functions used across different handler modules.
 */

import { Socket } from 'socket.io';
import { EventBus } from '../../../shared/events/EventBus';
import { createStrictValidator } from '../../../shared/utils/validation';
import logger from '../../../shared/utils/Logger';

// Create module logger
const moduleLogger = logger.child('UtilityHandlers');

/**
 * Safely remove listeners from a socket
 * Prevents memory leaks by ensuring all listeners are removed
 * 
 * @param socket - Socket to remove listeners from
 * @param eventName - Optional specific event to remove listeners for
 */
export const safelyRemoveListeners = (socket: Socket, eventName?: string): void => {
    try {
        if (eventName) {
            // Remove listeners for specific event
            socket.removeAllListeners(eventName);
        } else {
            // Remove all listeners
            socket.removeAllListeners();
        }
    } catch (error) {
        moduleLogger.error(`Error removing listeners from socket ${socket.id}: ${error}`);
    }
};

/**
 * Get the normalized channel name for a given channel ID
 * This ensures consistent channel naming across the codebase
 * 
 * @param channelId - Channel ID to normalize
 * @returns Normalized channel name
 */
export const getNormalizedChannelName = (channelId: string): string => {
    // Validator to ensure we have valid input
    const validator = createStrictValidator('UtilityHandlers.getNormalizedChannelName');
    validator.assertIsNonEmptyString(channelId);
    
    // Return normalized name with consistent prefix
    return `channel:${channelId}`;
};

/**
 * Get socket information as a human-readable string
 * Useful for debugging and logging
 * 
 * @param socket - Socket to get info for
 * @returns Human-readable string with socket info
 */
export const getSocketInfo = (socket: Socket): string => {
    if (!socket) {
        return 'Socket: null';
    }
    
    try {
        const info = {
            id: socket.id,
            connected: socket.connected,
            agentId: socket.data?.agentId || '[NOT_SET]',
            channelId: socket.data?.channelId || '[NOT_SET]',
            rooms: [...socket.rooms].join(', '),
            handshake: {
                address: socket.handshake.address,
                time: socket.handshake.time,
                headers: {
                    'user-agent': socket.handshake.headers['user-agent'] || '[NOT_PROVIDED]'
                }
            }
        };
        
        return `Socket Info: ${JSON.stringify(info)}`;
    } catch (error) {
        return `Socket: ${socket.id}, Error retrieving details: ${error}`;
    }
};
