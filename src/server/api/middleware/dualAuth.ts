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
 * Dual Authentication Middleware
 * 
 * Provides both JWT-based authentication (for users) and key-based authentication (for agents).
 * This middleware tries JWT authentication first, and if that fails, attempts key-based authentication.
 * This allows both users and agents to access API endpoints using their respective authentication methods.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '../../../shared/models/user';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import KeyAuthHelper from '../../utils/keyAuthHelper';

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
        
        // Verify token
        const secret = process.env.JWT_SECRET || 'default_jwt_secret_for_dev';
        const decoded = jwt.verify(token, secret) as any;
        
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
        if (error instanceof jwt.JsonWebTokenError) {
            return { success: false, error: 'Invalid JWT token' };
        }
        
        if (error instanceof jwt.TokenExpiredError) {
            return { success: false, error: 'JWT token expired' };
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
        // Try to get key credentials from multiple sources
        let keyId: string | undefined;
        let secretKey: string | undefined;
        
        // Method 1: From headers (preferred for API calls)
        if (req.headers['x-key-id'] && req.headers['x-secret-key']) {
            keyId = req.headers['x-key-id'] as string;
            secretKey = req.headers['x-secret-key'] as string;
        }
        // Method 2: From query parameters (fallback)
        else if (req.query.keyId && req.query.secretKey) {
            keyId = req.query.keyId as string;
            secretKey = req.query.secretKey as string;
        }
        // Method 3: From request body (for POST/PATCH requests)
        else if (req.body && req.body.keyId && req.body.secretKey) {
            keyId = req.body.keyId;
            secretKey = req.body.secretKey;
        }
        // Method 4: Extract from URL parameter if route uses :keyId (for backward compatibility)
        else if (req.params.keyId) {
            // For routes like /agents/context/:keyId, we need both keyId and secretKey
            // The secretKey should be in headers or query for security
            keyId = req.params.keyId;
            if (req.headers['x-secret-key']) {
                secretKey = req.headers['x-secret-key'] as string;
            } else if (req.query.secretKey) {
                secretKey = req.query.secretKey as string;
            }
        }
        
        if (!keyId || !secretKey) {
            return { success: false, error: 'Missing keyId or secretKey' };
        }
        
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
                keyId: keyId
            }
        };
        
    } catch (error) {
        return { success: false, error: `Key validation error: ${error instanceof Error ? error.message : String(error)}` };
    }
};

/**
 * Require admin role (works with both JWT users and key-based agents)
 * Must be used after authenticateDual middleware
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const authType = (req as any).authType;
        
        if (authType === 'jwt') {
            // Check JWT user role
            const user = (req as any).user;
            if (!user || user.role !== UserRole.ADMIN) {
                res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
                return;
            }
        } else if (authType === 'key') {
            // For key-based auth, we could implement admin agent verification here
            // For now, agents with valid keys are considered to have admin access to their own resources
        } else {
            res.status(403).json({
                success: false,
                message: 'Authentication required'
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
 * Require provider role or admin (works with both authentication types)
 * Must be used after authenticateDual middleware
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const requireProvider = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const authType = (req as any).authType;
        
        if (authType === 'jwt') {
            // Check JWT user role
            const user = (req as any).user;
            if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.PROVIDER)) {
                res.status(403).json({
                    success: false,
                    message: 'Provider access required'
                });
                return;
            }
        } else if (authType === 'key') {
            // For key-based auth, agents with valid keys are considered to have provider access
        } else {
            res.status(403).json({
                success: false,
                message: 'Authentication required'
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
