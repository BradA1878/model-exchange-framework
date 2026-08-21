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
 * Dual Authentication Middleware
 * 
 * Provides both JWT-based authentication (for users) and key-based authentication (for agents).
 * This middleware tries JWT authentication first, and if that fails, attempts key-based authentication.
 * This allows both users and agents to access API endpoints using their respective authentication methods.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '@mxf-dev/core/models/user';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import KeyAuthHelper from '../../utils/keyAuthHelper';
import { verifySessionToken } from '../security/jwtTokenPolicy';

// Initialize logger
const logger = new Logger('info', 'DualAuthMiddleware', 'server');

// Create validator
const validate = createStrictValidator('DualAuthMiddleware');

/**
 * Dual authentication middleware that supports both JWT (users) and key-based (agents) authentication
 * 
 * @param req - Express request object
 * @param res - Express response object  
 * @param next - Express next function
 */
export const authenticateDual = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        // First, try JWT authentication
        const jwtResult = await tryJwtAuthentication(req);
        
        if (jwtResult.success) {
            // JWT authentication successful - attach user data
            (req as any).user = jwtResult.user;
            (req as any).authType = 'jwt';
            //;
            return next();
        }
        
        // JWT failed, try key-based authentication  
        const keyResult = await tryKeyAuthentication(req);
        
        if (keyResult.success) {
            // Key authentication successful - attach agent data
            (req as any).agent = keyResult.agent;
            (req as any).authType = 'key';
            return next();
        }
        
        // Both authentication methods failed
        logger.warn(`Authentication failed for request to ${req.path} - no valid JWT or key provided`);
        res.status(401).json({
            success: false,
            message: 'Authentication required. Please provide either a valid JWT token or valid API key credentials.'
        });
        
    } catch (error) {
        logger.error('Dual authentication error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during authentication'
        });
    }
};

/**
 * Try JWT-based authentication
 * 
 * @param req - Express request object
 * @returns Authentication result with user data if successful
 */
const tryJwtAuthentication = async (req: Request): Promise<{ success: boolean; user?: any; error?: string }> => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return { success: false, error: 'No Bearer token provided' };
        }
        
        // Extract token
        const token = authHeader.split(' ')[1];
        
        // Verify signature, algorithm, issuer, audience, and session purpose.
        // A magic-link token is only valid at its exchange endpoint.
        const decoded = verifySessionToken(token);
        
        // Check if token contains userId
        if (!decoded || !decoded.userId) {
            return { success: false, error: 'Invalid token structure' };
        }
        
        // Find user in database
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return { success: false, error: 'User not found' };
        }
        
        // Check if user is active
        if (!user.isActive) {
            return { success: false, error: 'User account is inactive' };
        }
        
        // Return user data
        return {
            success: true,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        };
        
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return { success: false, error: 'JWT token expired' };
        }

        if (error instanceof jwt.JsonWebTokenError) {
            return { success: false, error: 'Invalid JWT token' };
        }
        
        return { success: false, error: `JWT validation error: ${error instanceof Error ? error.message : String(error)}` };
    }
};

/**
 * Try key-based authentication
 * 
 * @param req - Express request object
 * @returns Authentication result with agent data if successful
 */
const tryKeyAuthentication = async (req: Request): Promise<{ success: boolean; agent?: any; error?: string }> => {
    try {
        // Credentials are accepted only in headers. Query-string secrets are
        // routinely retained by reverse-proxy/access logs and browser history;
        // body/URL fallbacks also make authentication depend on the endpoint's
        // payload shape. The SDK and CLI already use these two headers.
        const keyIdHeader = req.headers['x-key-id'];
        const secretKeyHeader = req.headers['x-secret-key'];
        if (
            typeof keyIdHeader !== 'string' || keyIdHeader.trim().length === 0 ||
            typeof secretKeyHeader !== 'string' || secretKeyHeader.length === 0
        ) {
            return {
                success: false,
                error: 'Key credentials require non-empty x-key-id and x-secret-key headers'
            };
        }

        const keyId = keyIdHeader.trim();
        const secretKey = secretKeyHeader;
        
        // Validate key credentials
        const validation = await KeyAuthHelper.getInstance().validateKey(keyId, secretKey);
        
        if (!validation.valid) {
            return { success: false, error: 'Invalid key credentials' };
        }
        
        // Return agent data
        return {
            success: true,
            agent: {
                agentId: validation.agentId,
                channelId: validation.channelId,
                keyId: keyId,
                allowedTools: validation.allowedTools === undefined
                    ? undefined
                    : [...validation.allowedTools]
            }
        };
        
    } catch (error) {
        return { success: false, error: `Key validation error: ${error instanceof Error ? error.message : String(error)}` };
    }
};

/**
 * Require admin role
 * Must be used after authenticateDual middleware
 *
 * Roles are a property of users, not of channel keys. A channel key proves which
 * channel the holder may act on — it carries no role and cannot be promoted to
 * one. Key-authenticated agents are therefore refused here, and so is any
 * request that reached this point without an auth type.
 *
 * This used to call next() for key auth, which meant every agent holding any
 * valid channel key had administrator access to every admin-gated route.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const authType = (req as any).authType;

        if (authType !== 'jwt') {
            if (authType === 'key') {
                const agent = (req as any).agent;
                logger.warn(
                    `Denied admin route ${req.method} ${req.path} to key-authenticated agent ${agent?.agentId ?? 'unknown'} — ` +
                    'channel keys do not carry roles'
                );
            }

            res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
            return;
        }

        const user = (req as any).user;
        if (!user || user.role !== UserRole.ADMIN) {
            res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
            return;
        }

        next();
    } catch (error) {
        logger.error('Authorization error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during authorization'
        });
    }
};

/**
 * Require provider role or admin
 * Must be used after authenticateDual middleware
 *
 * Same rule as requireAdmin: a channel key is not a role. Key-authenticated
 * agents are refused rather than waved through.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const requireProvider = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const authType = (req as any).authType;

        if (authType !== 'jwt') {
            if (authType === 'key') {
                const agent = (req as any).agent;
                logger.warn(
                    `Denied provider route ${req.method} ${req.path} to key-authenticated agent ${agent?.agentId ?? 'unknown'} — ` +
                    'channel keys do not carry roles'
                );
            }

            res.status(403).json({
                success: false,
                message: 'Provider access required'
            });
            return;
        }

        const user = (req as any).user;
        if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.PROVIDER)) {
            res.status(403).json({
                success: false,
                message: 'Provider access required'
            });
            return;
        }

        next();
    } catch (error) {
        logger.error('Authorization error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during authorization'
        });
    }
};
