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
 * Authentication Handlers
 *
 * This module provides socket authentication handling for the MXF.
 * It handles socket authentication middleware and verification.
 *
 * Supported authentication methods (in priority order):
 * 1. Personal Access Token (PAT) - accessToken in format tokenId:secret
 * 2. JWT token - Pre-authenticated user token
 * 3. Username/password - Legacy credential-based auth
 * 4. Channel key - For agent connections (keyId + secretKey)
 */

import { Socket } from 'socket.io';
import logger from '@mxf-dev/core/utils/Logger';
import { AuthEvents } from '@mxf-dev/core/events/EventNames';
import { getNormalizedChannelName } from './utilityHandlers';
import KeyAuthHelper from '../../utils/keyAuthHelper';
import { Channel } from '@mxf-dev/core/models/channel';
import { User } from '@mxf-dev/core/models/user';
import bcrypt from 'bcrypt';
import { AgentService } from '../services/AgentService';
import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';
import { PersonalAccessTokenService } from '../../api/services/PersonalAccessTokenService';
import { verifySessionToken } from '../../api/security/jwtTokenPolicy';
import { consumeSocketPasswordAttempt } from '../security/SocketPasswordRateLimiter';
import type { SystemLlmStance } from '@mxf-dev/core/types/SystemLlmStanceTypes';

// Create module logger
const moduleLogger = logger.child('AuthenticationHandlers');

interface SocketChannelConfig {
    channelId: string;
    name?: string;
    description?: string;
    showActiveAgents: boolean;
    systemLlmEnabled: boolean;
    /** Effective stance: the channel's own, or the server's SYSTEMLLM_STANCE. */
    systemLlmStance: SystemLlmStance;
}

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
 * Supports PAT (users), JWT (users), username/password (users), and key-based (agents) authentication
 *
 * @param socket Socket instance
 * @param authData Authentication data
 * @returns Agent ID if authentication successful, null otherwise
 */
export const handleSocketAuthentication = async (
    socket: Socket,
    authData: unknown
): Promise<string | null> => {
    try {
        // Domain key was already validated by middleware

        if (!authData || typeof authData !== 'object') {
            moduleLogger.warn(`Invalid auth data format for socket ${socket.id}`);
            return null;
        }
        const credentials = authData as Record<string, unknown>;

        // Try Personal Access Token authentication first (RECOMMENDED for SDK)
        if (typeof credentials.accessToken === 'string') {
            const patResult = await tryPATSocketAuthentication(socket, credentials.accessToken);
            if (patResult) {
                return patResult;
            }
        }

        // Try JWT authentication (for users with pre-authenticated sessions)
        if (typeof credentials.token === 'string') {
            const jwtResult = await tryJwtSocketAuthentication(socket, credentials.token);
            if (jwtResult) {
                return jwtResult;
            }
        }

        // Try username/password authentication (for users - no API required)
        if (typeof credentials.username === 'string' &&
            typeof credentials.password === 'string') {
            const userPassResult = await tryUsernamePasswordSocketAuthentication(
                socket,
                credentials.username,
                credentials.password
            );
            if (userPassResult) {
                return userPassResult;
            }
        }

        // Try key-based authentication (for agents).
        // authData.agentId is deliberately not passed through — the agent identity
        // is derived from the key. See tryKeySocketAuthentication.
        if (typeof credentials.keyId === 'string' &&
            typeof credentials.secretKey === 'string') {
            const keyResult = await tryKeySocketAuthentication(
                socket,
                credentials.keyId,
                credentials.secretKey
            );
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
 * Try Personal Access Token (PAT) authentication for socket connection
 * This is the RECOMMENDED auth method for SDK users
 *
 * @param socket Socket instance
 * @param accessToken Full token in format tokenId:secret
 * @returns User ID if successful, null otherwise
 */
const tryPATSocketAuthentication = async (socket: Socket, accessToken: string): Promise<string | null> => {
    try {
        // Validate token format
        if (!accessToken || typeof accessToken !== 'string' || !accessToken.includes(':')) {
            moduleLogger.warn(`Invalid PAT format for socket ${socket.id}`);
            return null;
        }

        // Parse token format: tokenId:secret
        const colonIndex = accessToken.indexOf(':');
        const tokenId = accessToken.substring(0, colonIndex);
        const secret = accessToken.substring(colonIndex + 1);

        if (!tokenId || !secret) {
            moduleLogger.warn(`Invalid PAT components for socket ${socket.id}`);
            return null;
        }

        // Validate token using PersonalAccessTokenService
        const tokenService = PersonalAccessTokenService.getInstance();
        const validation = await tokenService.validateToken(tokenId, secret);

        if (!validation.valid || !validation.userId) {
            moduleLogger.warn(`PAT validation failed for socket ${socket.id}: ${validation.error || 'unknown error'}`);
            return null;
        }

        // Fetch user to get username
        const user = await User.findById(validation.userId);

        if (!user || !user.isActive) {
            moduleLogger.warn(`PAT user not found or inactive for socket ${socket.id}`);
            return null;
        }

        // Store user auth data
        socket.data = {
            userId: validation.userId,
            username: user.username,
            role: user.role,
            tokenId: validation.tokenId,
            scopes: validation.scopes,
            credentialExpiresAt: validation.expiresAt?.getTime(),
            authType: 'pat',
            authenticated: true
        };

        moduleLogger.debug(`PAT authentication successful for socket ${socket.id}, user ${validation.userId}`);
        return validation.userId;

    } catch (error) {
        moduleLogger.error(`PAT authentication error for socket: ${error instanceof Error ? error.message : String(error)}`);
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

        // Socket sessions use the same purpose/audience policy as HTTP. Magic
        // links must be exchanged first and cannot authenticate a socket.
        const decoded = verifySessionToken(token);

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
            userId: String(user._id),
            username: user.username,
            role: user.role,
            credentialExpiresAt: decoded.exp * 1000,
            authType: 'jwt',
            authenticated: true
        };

        return String(user._id);

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
        // Reject non-string credentials before they reach the Mongo query. Socket
        // handshake auth is JSON, so `{ username: { $gt: "" } }` would otherwise be
        // interpolated as a query operator and match the first user in the collection.
        if (typeof username !== 'string' || typeof password !== 'string') {
            moduleLogger.warn(`Rejected socket credentials with non-string username or password for socket ${socket.id}`);
            return null;
        }

        const usernameValue = username.trim();
        if (usernameValue.length === 0 || password.length === 0) {
            return null;
        }

        // Process-wide buckets survive socket reconnects. This check happens
        // before MongoDB and bcrypt so rejected brute-force traffic consumes no
        // database query or password-hash CPU.
        if (!consumeSocketPasswordAttempt(socket, usernameValue)) {
            moduleLogger.warn(`Socket password authentication rate limit exceeded for socket ${socket.id}`);
            return null;
        }

        // Find user by username or email
        const user = await User.findOne({
            $or: [
                { username: usernameValue },
                { email: usernameValue }
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
            userId: String(user._id),
            username: user.username,
            role: user.role,
            authType: 'password',  // Different from JWT to indicate socket-based auth
            authenticated: true
        };
        
        return String(user._id);
        
    } catch (error) {
        return null;
    }
};

/**
 * Try key-based authentication for socket connection
 *
 * The agent identity is derived from the key, never taken from the client.
 * ChannelKeyService.validateKey returns the agentId that the keyId and channelId
 * hash to — the same derivation HTTP key auth uses — so one key always maps to
 * one agent, on both transports.
 *
 * This used to prefer a client-supplied `agentId` from the handshake, which made
 * agent identity self-asserted: any holder of any valid channel key could claim
 * to be any agent, and every downstream check that trusts socket.data.agentId
 * (task assignment, message sender, memory scope) trusted that claim.
 *
 * @param socket Socket instance
 * @param keyId Key identifier
 * @param secretKey Secret key
 * @returns Agent ID if successful, null otherwise
 */
const tryKeySocketAuthentication = async (socket: Socket, keyId: string, secretKey: string): Promise<string | null> => {
    try {
        // Reject non-string credentials before they reach the key lookup
        if (typeof keyId !== 'string' || typeof secretKey !== 'string') {
            moduleLogger.warn(`Rejected socket key credentials with non-string keyId or secretKey for socket ${socket.id}`);
            return null;
        }

        // Validate key credentials using the same logic as HTTP authentication
        const validation = await KeyAuthHelper.getInstance().validateKey(keyId, secretKey);

        if (!validation.valid) {
            moduleLogger.warn(`Key validation failed for socket ${socket.id}: keyId=${keyId}`);
            return null;
        }

        // Identity comes from the key, not from the handshake
        const agentId = validation.agentId;

        if (!agentId) {
            moduleLogger.error(`Key ${keyId} validated but resolved no agentId — refusing to authenticate socket ${socket.id}`);
            return null;
        }

        // Generate normalized room name if channel provided
        const room = validation.channelId ? getNormalizedChannelName(validation.channelId) : null;

        // Store agent auth data
        socket.data = {
            agentId: agentId,
            channelId: validation.channelId,
            keyId,
            credentialAllowedTools: validation.allowedTools === undefined
                ? undefined
                : [...validation.allowedTools],
            credentialExpiresAt: validation.expiresAt?.getTime(),
            authType: 'key',
            authenticated: true
        };

        // Add socket to room if channel provided
        if (room) {
            socket.join(room);
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
export const validateAuthData = (authData: unknown): boolean => {
    if (!authData || typeof authData !== 'object') {
        return false;
    }
    const credentials = authData as Record<string, unknown>;

    // Check for Personal Access Token authentication (RECOMMENDED)
    if (typeof credentials.accessToken === 'string' &&
        credentials.accessToken.trim() && credentials.accessToken.includes(':')) {
        return true;
    }

    // Check for JWT authentication
    if (typeof credentials.token === 'string' && credentials.token.trim()) {
        return true;
    }

    // Check for username/password authentication
    if (typeof credentials.username === 'string' &&
        typeof credentials.password === 'string' &&
        credentials.username.trim() && credentials.password.trim()) {
        return true;
    }

    // Check for key-based authentication
    if (typeof credentials.keyId === 'string' &&
        typeof credentials.secretKey === 'string' &&
        credentials.keyId.trim() && credentials.secretKey.trim()) {
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
export const sendAuthResponse = async (
    socket: Socket,
    authenticatedId: string | null,
    _authData: unknown
): Promise<void> => {
    if (authenticatedId) {
        // Authentication successful
        const socketData = socket.data;
        const authType = socketData?.authType || 'unknown';


        if (authType === 'jwt' || authType === 'password' || authType === 'pat') {
            // JWT, password, or PAT authentication response
            socket.emit(AuthEvents.SUCCESS, {
                userId: authenticatedId,
                username: socketData?.username,
                authType
            });
        } else if (authType === 'key') {
            // Key authentication response - fetch channel config
            try {
                const channelId = socketData?.channelId;
                let channelConfig: SocketChannelConfig | null = null;
                let activeAgents: string[] = [];

                if (channelId) {
                    // Fetch channel from database
                    const channel = await Channel.findOne({ channelId }).exec();

                    if (channel) {
                        // Get the SystemLLM settings from ConfigManager: the enabled flag and
                        // the effective stance (channel override, else the server default).
                        const configManager = ConfigManager.getInstance();
                        const systemLlmEnabled = configManager.isChannelSystemLlmEnabled(channelId);
                        const systemLlmStance = configManager.getChannelSystemLlmStance(channelId);

                        // Extract relevant config for SDK
                        channelConfig = {
                            channelId: channel.channelId,
                            name: channel.name,
                            description: channel.description,
                            showActiveAgents: channel.showActiveAgents !== false, // Default to true
                            systemLlmEnabled,
                            systemLlmStance
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
            error: 'Authentication failed - please provide valid accessToken (PAT), JWT token, username/password, or key credentials',
            timestamp: Date.now()
        });
    }
};
