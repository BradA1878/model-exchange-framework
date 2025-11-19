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
 * Authentication Middleware
 * 
 * Provides JWT-based authentication for API endpoints.
 * Validates tokens and attaches user data to requests.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '../../../shared/models/user';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';

// Initialize logger
const logger = new Logger('info', 'AuthMiddleware', 'server');

// Create validator
const validate = createStrictValidator('AuthMiddleware');

/**
 * Authenticate user via JWT token
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({
                success: false,
                message: 'Authentication required. Please provide a valid token.'
            });
            return;
        }
        
        // Extract token
        const token = authHeader.split(' ')[1];
        
        // Verify token
        const secret = process.env.JWT_SECRET || 'default_jwt_secret_for_dev';
        const decoded = jwt.verify(token, secret) as any;
        
        // Check if token contains userId
        if (!decoded || !decoded.userId) {
            res.status(401).json({
                success: false,
                message: 'Invalid token structure'
            });
            return;
        }
        
        // Find user in database
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            res.status(401).json({
                success: false,
                message: 'User not found'
            });
            return;
        }
        
        // Check if user is active
        if (!user.isActive) {
            res.status(403).json({
                success: false,
                message: 'User account is inactive'
            });
            return;
        }
        
        // Attach user to request
        (req as any).user = {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role
        };
        
        // Continue with request
        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
            return;
        }
        
        if (error instanceof jwt.TokenExpiredError) {
            res.status(401).json({
                success: false,
                message: 'Token expired'
            });
            return;
        }
        
        logger.error('Authentication error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during authentication'
        });
    }
};

/**
 * Require admin role
 * 
 * Must be used after authenticateUser middleware
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Ensure user is attached to request
        const user = (req as any).user;
        
        if (!user) {
            res.status(403).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }
        
        // Check if user has admin role
        if (user.role !== UserRole.ADMIN) {
            res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
            return;
        }
        
        // Continue with request
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
 * 
 * Must be used after authenticateUser middleware
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const requireProvider = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Ensure user is attached to request
        const user = (req as any).user;
        
        if (!user) {
            res.status(403).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }
        
        // Check if user has admin or provider role
        if (user.role !== UserRole.ADMIN && user.role !== UserRole.PROVIDER) {
            res.status(403).json({
                success: false,
                message: 'Provider access required'
            });
            return;
        }
        
        // Continue with request
        next();
    } catch (error) {
        logger.error('Authorization error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during authorization'
        });
    }
};
