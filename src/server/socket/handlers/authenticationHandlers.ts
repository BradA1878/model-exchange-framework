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
 * Authentication Handlers
 * 
 * This module provides socket authentication handling for the MXF.
 * It handles socket authentication middleware and verification.
 */

import { Socket } from 'socket.io';
import logger from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { EventBus } from '../../../shared/events/EventBus';
import { AuthEvents } from '../../../shared/events/EventNames';
import { getNormalizedChannelName } from './utilityHandlers';
import KeyAuthHelper from '../../utils/keyAuthHelper';
import { Channel } from '../../../shared/models/channel';
import { AgentService } from '../services/AgentService';
import { ConfigManager } from '../../../sdk/config/ConfigManager';

// Create module logger
const moduleLogger = logger.child('AuthenticationHandlers');

/**
 * Create authentication middleware for Socket.IO
 * This middleware validates authentication data in socket handshakes
 * 
 * SECURITY LAYERS:
 * 1. Domain Key - Validates SDK → Server connection (env var)
 * 2. User/Agent Auth - Validates specific user/agent identity (JWT or keys)
 * 
 * @returns Authentication middleware function
 */
export const createAuthMiddleware = () => {
    return (socket: Socket, next: (err?: Error) => void): void => {
        try {
            const validator = createStrictValidator('AuthenticationHandlers.authMiddleware');
            
            // Get authentication data from handshake
            const auth = socket.handshake.auth;
            
            
            if (!auth) {
                moduleLogger.warn(`Missing authentication data for socket ${socket.id}`);
                return next(new Error('Authentication required'));
            }
            
            // LAYER 1: Validate domain key (SDK → Server authentication)
            // Domain key is ALWAYS required - no exceptions
            const domainKey = process.env.MXF_DOMAIN_KEY;
            const providedDomainKey = auth.domainKey;
            
            if (!domainKey) {
                moduleLogger.error('Server misconfiguration: MXF_DOMAIN_KEY not set');
                return next(new Error('Server authentication not configured'));
            }
            
            if (!providedDomainKey) {
                moduleLogger.warn(`Missing domain key for socket ${socket.id}`);
                return next(new Error('Domain key required for SDK connection'));
            }
            
            if (providedDomainKey !== domainKey) {
                moduleLogger.warn(`Invalid domain key for socket ${socket.id}`);
                return next(new Error('Invalid domain key'));
            }
            
            
            // LAYER 2: User/Agent authentication happens in handleSocketAuthentication
            // We just check that auth data exists here
            
            // Continue to next middleware
            next();
        } catch (error) {
            moduleLogger.error(`Authentication middleware error: ${error}`);
            next(new Error('Authentication failed'));
        }
    };
};

/**
 * Handle socket authentication
 * This is the main authentication function that validates auth data and registers the agent
 * Supports both JWT (users) and key-based (agents) authentication
 * 
 * @param socket Socket instance
 * @param authData Authentication data
 * @returns Agent ID if authentication successful, null otherwise
 */
export const handleSocketAuthentication = async (socket: Socket, authData: any): Promise<string | null> => {
    try {
        // Domain key was already validated by middleware
        
        
        if (!authData || typeof authData !== 'object') {
            moduleLogger.warn(`Invalid auth data format for socket ${socket.id}`);
            return null;
        }
        
        // Try JWT authentication first
        
        // Try JWT authentication first (for users)
        if (authData.token) {
            const jwtResult = await tryJwtSocketAuthentication(socket, authData.token);
            if (jwtResult) {
                return jwtResult;
            }
        }
        
        // Try username/password authentication (for users - no API required)
        if (authData.username && authData.password) {
            const userPassResult = await tryUsernamePasswordSocketAuthentication(socket, authData.username, authData.password);
            if (userPassResult) {
                return userPassResult;
            }
        }
        
        // Try key-based authentication (for agents)
        if (authData.keyId && authData.secretKey) {
            const keyResult = await tryKeySocketAuthentication(socket, authData.keyId, authData.secretKey, authData.agentId);
            if (keyResult) {
                return keyResult;
            }
        }
        
        // If we reach here, authentication failed
        moduleLogger.warn(`Authentication failed for socket ${socket.id} - no valid credentials provided`);
        return null;
        
    } catch (error) {
        moduleLogger.error(`Authentication error for socket ${socket.id}: ${error}`);
        return null;
    }
};

/**
 * Try JWT authentication for socket connection
 * 
 * @param socket Socket instance
 * @param token JWT token
 * @returns User ID if successful, null otherwise
 */
const tryJwtSocketAuthentication = async (socket: Socket, token: string): Promise<string | null> => {
    try {
        const jwt = require('jsonwebtoken');
        const { User } = require('../../../shared/models/user');
        
        // Verify token
        const secret = process.env.JWT_SECRET || 'default_jwt_secret_for_dev';
        const decoded = jwt.verify(token, secret) as any;
        
        if (!decoded || !decoded.userId) {
            return null;
        }
        
        // Find user in database
        const user = await User.findById(decoded.userId);
        if (!user || !user.isActive) {
            return null;
        }
        
        // Store user auth data
        socket.data = {
            userId: user._id.toString(),
            username: user.username,
            authType: 'jwt',
            authenticated: true
        };
        
        return user._id.toString();
        
    } catch (error) {
        return null;
    }
};

/**
 * Try username/password authentication for socket connection
 * Authenticates user without requiring API - socket-only authentication
 * 
 * @param socket Socket instance
 * @param username Username or email
 * @param password User password
 * @returns User ID if successful, null otherwise
 */
const tryUsernamePasswordSocketAuthentication = async (socket: Socket, username: string, password: string): Promise<string | null> => {
    try {
        const bcrypt = require('bcrypt');
        const { User } = require('../../../shared/models/user');
        
        // Find user by username or email
        const user = await User.findOne({
            $or: [
                { username: username },
                { email: username }
            ]
        });
        
        if (!user || !user.isActive) {
            return null;
        }
        
        // Verify password (password field contains the hashed password)
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return null;
        }
        
        // Store user auth data
        socket.data = {
            userId: user._id.toString(),
            username: user.username,
            authType: 'password',  // Different from JWT to indicate socket-based auth
            authenticated: true
        };
        
        return user._id.toString();
        
    } catch (error) {
        return null;
    }
};

/**
 * Try key-based authentication for socket connection
 * 
 * @param socket Socket instance
 * @param keyId Key identifier
 * @param secretKey Secret key
 * @param clientAgentId Optional client-provided agent ID
 * @returns Agent ID if successful, null otherwise
 */
const tryKeySocketAuthentication = async (socket: Socket, keyId: string, secretKey: string, clientAgentId?: string): Promise<string | null> => {
    try {
        
        // Validate key credentials using the same logic as HTTP authentication
        const validation = await KeyAuthHelper.getInstance().validateKey(keyId, secretKey);
        
        
        if (!validation.valid) {
            moduleLogger.warn(`Key validation failed for socket ${socket.id}: keyId=${keyId}`);
            return null;
        }
        
        // Use client-provided agentId if available, otherwise use server-generated agentId
        const agentId = clientAgentId && clientAgentId.trim() ? clientAgentId.trim() : validation.agentId;
        
        if (!agentId) {
            return null;
        }
        
        // Generate normalized room name if channel provided
        const room = validation.channelId ? getNormalizedChannelName(validation.channelId) : null;
        
        // Store agent auth data
        socket.data = {
            agentId: agentId,
            channelId: validation.channelId,
            keyId,
            authType: 'key',
            authenticated: true
        };
        
        // Add socket to room if channel provided
        if (room) {
            socket.join(room);
            //;
        }
        
        return agentId;
        
    } catch (error) {
        moduleLogger.error(`Key authentication failed for socket: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
};

/**
 * Validate authentication data structure
 * 
 * @param authData Authentication data to validate
 * @returns True if auth data has valid structure, false otherwise
 */
export const validateAuthData = (authData: any): boolean => {
    if (!authData || typeof authData !== 'object') {
        return false;
    }
    
    // Check for JWT authentication
    if (authData.token && typeof authData.token === 'string' && authData.token.trim()) {
        return true;
    }
    
    // Check for username/password authentication
    if (authData.username && authData.password &&
        typeof authData.username === 'string' && typeof authData.password === 'string' &&
        authData.username.trim() && authData.password.trim()) {
        return true;
    }
    
    // Check for key-based authentication
    if (authData.keyId && authData.secretKey && 
        typeof authData.keyId === 'string' && typeof authData.secretKey === 'string' &&
        authData.keyId.trim() && authData.secretKey.trim()) {
        return true;
    }
    
    return false;
};

/**
 * Process authentication response
 * Sends appropriate success or error response to the client
 * 
 * @param socket Socket to send response to
 * @param authenticatedId User/Agent ID if authenticated, null otherwise
 * @param authData Original auth data
 */
export const sendAuthResponse = async (socket: Socket, authenticatedId: string | null, authData: any): Promise<void> => {
    if (authenticatedId) {
        // Authentication successful
        const socketData = socket.data;
        const authType = socketData?.authType || 'unknown';


        if (authType === 'jwt' || authType === 'password') {
            // JWT or password authentication response
            socket.emit(AuthEvents.SUCCESS, {
                userId: authenticatedId,
                username: socketData?.username,
                authType
            });
        } else if (authType === 'key') {
            // Key authentication response - fetch channel config
            try {
                const channelId = socketData?.channelId;
                let channelConfig: any = null;
                let activeAgents: string[] = [];

                if (channelId) {
                    // Fetch channel from database
                    const channel = await Channel.findOne({ channelId }).exec();

                    if (channel) {
                        // Get systemLlmEnabled status from ConfigManager
                        const configManager = ConfigManager.getInstance();
                        const systemLlmEnabled = configManager.isChannelSystemLlmEnabled(channelId);

                        // Extract relevant config for SDK
                        channelConfig = {
                            channelId: channel.channelId,
                            name: channel.name,
                            description: channel.description,
                            showActiveAgents: channel.showActiveAgents !== false, // Default to true
                            systemLlmEnabled
                        };

                        // Get active agents if showActiveAgents is enabled
                        if (channelConfig.showActiveAgents) {
                            try {
                                const agentService = AgentService.getInstance();
                                const activeAgentDocs = await agentService.getActiveAgentsInChannel(channelId);
                                activeAgents = activeAgentDocs.map(agent => agent.id);
                            } catch (error) {
                                moduleLogger.warn(`Failed to fetch active agents for channel ${channelId}: ${error}`);
                            }
                        }
                    }
                }

                socket.emit(AuthEvents.SUCCESS, {
                    agentId: authenticatedId,
                    channelId: socketData?.channelId,
                    authType: 'key',
                    channelConfig,
                    activeAgents
                });
            } catch (error) {
                moduleLogger.warn(`Failed to fetch channel config for auth response: ${error}`);
                // Fall back to basic response
                socket.emit(AuthEvents.SUCCESS, {
                    agentId: authenticatedId,
                    channelId: socketData?.channelId,
                    authType: 'key'
                });
            }
        } else {
            // Fallback response
            socket.emit(AuthEvents.SUCCESS, {
                id: authenticatedId,
                authType
            });
        }
    } else {
        // Authentication failed
        moduleLogger.warn(`Sending ${AuthEvents.ERROR} to socket ${socket.id}`);

        socket.emit(AuthEvents.ERROR, {
            error: 'Authentication failed - please provide valid JWT token or key credentials',
            timestamp: Date.now()
        });
    }
};
