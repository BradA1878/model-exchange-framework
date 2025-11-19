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
 * Validation Middleware
 * 
 * Provides request validation for API endpoints.
 * Uses shared validation utilities.
 */

import { Request, Response, NextFunction } from 'express';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';

// Initialize logger
const logger = new Logger('info', 'ValidationMiddleware', 'server');

// Create validator
const validate = createStrictValidator('ValidationMiddleware');

/**
 * Validate channel input for creation and updates
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const validateChannelInput = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Assert request body is an object
        if (!req.body || typeof req.body !== 'object') {
            res.status(400).json({
                success: false,
                message: 'Request body must be a valid JSON object'
            });
            return;
        }
        
        // For channel creation
        if (req.method === 'POST') {
            // Required fields for channel creation
            if (!req.body.agentId || typeof req.body.agentId !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'agentId is required and must be a string'
                });
                return;
            }
            
            // Validate channelId if provided
            if (req.body.channelId && typeof req.body.channelId !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'channelId must be a string'
                });
                return;
            }
            
            // Validate customChannelId if provided
            if (req.body.customChannelId && typeof req.body.customChannelId !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'customChannelId must be a string'
                });
                return;
            }
            
            // Validate agentType if provided
            if (req.body.agentType && typeof req.body.agentType !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'agentType must be a string'
                });
                return;
            }
        }
        
        // For channel updates
        if (req.method === 'PUT' || req.method === 'PATCH') {
            // Ensure at least one field to update
            const allowedUpdateFields = ['customChannelId', 'name', 'description', 'isPublic', 'metadata'];
            const hasValidField = allowedUpdateFields.some(field => field in req.body);
            
            if (!hasValidField) {
                res.status(400).json({
                    success: false,
                    message: `Request must include at least one of: ${allowedUpdateFields.join(', ')}`
                });
                return;
            }
        }
        
        // Continue with request
        next();
    } catch (error) {
        logger.error('Channel validation error:', error);
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'Invalid request data'
        });
    }
};

/**
 * Validate verification input
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const validateVerificationInput = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Assert request body is an object
        if (!req.body || typeof req.body !== 'object') {
            res.status(400).json({
                success: false,
                message: 'Request body must be a valid JSON object'
            });
            return;
        }
        
        // For verification initialization
        if (req.method === 'POST') {
            // Required field for verification method
            if (!req.body.method || typeof req.body.method !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'method is required and must be a string'
                });
                return;
            }
            
            // Validate verification method
            const validMethods = ['dns', 'email', 'file', 'token'];
            if (!validMethods.includes(req.body.method)) {
                res.status(400).json({
                    success: false,
                    message: `method must be one of: ${validMethods.join(', ')}`
                });
                return;
            }
        }
        
        // For verification completion
        if (req.method === 'PUT') {
            // Required field for verification token
            if (!req.body.token || typeof req.body.token !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'token is required and must be a string'
                });
                return;
            }
        }
        
        // Continue with request
        next();
    } catch (error) {
        logger.error('Verification validation error:', error);
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'Invalid request data'
        });
    }
};

/**
 * Validate agent input for creation and updates
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const validateAgentInput = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Assert request body is an object
        if (!req.body || typeof req.body !== 'object') {
            res.status(400).json({
                success: false,
                message: 'Request body must be a valid JSON object'
            });
            return;
        }
        
        // For agent creation
        if (req.method === 'POST') {
            // Required fields for agent creation
            if (!req.body.agentId || typeof req.body.agentId !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'agentId is required and must be a string'
                });
                return;
            }
            
            if (!req.body.name || typeof req.body.name !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'name is required and must be a string'
                });
                return;
            }
            
            // Validate serviceTypes if provided
            if (req.body.serviceTypes && !Array.isArray(req.body.serviceTypes)) {
                res.status(400).json({
                    success: false,
                    message: 'serviceTypes must be an array'
                });
                return;
            }
            
            // Validate capabilities if provided
            if (req.body.capabilities && typeof req.body.capabilities !== 'object') {
                res.status(400).json({
                    success: false,
                    message: 'capabilities must be an object'
                });
                return;
            }
        }
        
        // For agent updates
        if (req.method === 'PUT' || req.method === 'PATCH') {
            // Ensure at least one field to update
            const allowedUpdateFields = ['name', 'description', 'type', 'serviceTypes', 'capabilities', 'status'];
            const hasValidField = allowedUpdateFields.some(field => field in req.body);
            
            if (!hasValidField) {
                res.status(400).json({
                    success: false,
                    message: `Request must include at least one of: ${allowedUpdateFields.join(', ')}`
                });
                return;
            }
            
            // Validate status if provided
            if (req.body.status && typeof req.body.status === 'string') {
                const validStatuses = ['ACTIVE', 'INACTIVE', 'BUSY', 'ERROR'];
                if (!validStatuses.includes(req.body.status)) {
                    res.status(400).json({
                        success: false,
                        message: `status must be one of: ${validStatuses.join(', ')}`
                    });
                    return;
                }
            }
        }
        
        // Continue with request
        next();
    } catch (error) {
        logger.error('Agent validation error:', error);
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'Invalid request data'
        });
    }
};

/**
 * Validate memory input for updates
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const validateMemoryInput = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Assert request body is an object
        if (!req.body || typeof req.body !== 'object') {
            res.status(400).json({
                success: false,
                message: 'Request body must be a valid JSON object'
            });
            return;
        }
        
        // Ensure at least one valid memory field
        const validMemoryFields = ['notes', 'customData', 'conversationHistory'];
        const hasValidField = validMemoryFields.some(field => field in req.body);
        
        if (!hasValidField) {
            res.status(400).json({
                success: false,
                message: `Request must include at least one of: ${validMemoryFields.join(', ')}`
            });
            return;
        }
        
        // Validate notes if provided
        if ('notes' in req.body && typeof req.body.notes !== 'object') {
            res.status(400).json({
                success: false,
                message: 'notes must be an object'
            });
            return;
        }
        
        // Validate customData if provided
        if ('customData' in req.body && typeof req.body.customData !== 'object') {
            res.status(400).json({
                success: false,
                message: 'customData must be an object'
            });
            return;
        }
        
        // Validate conversationHistory if provided
        if ('conversationHistory' in req.body && !Array.isArray(req.body.conversationHistory)) {
            res.status(400).json({
                success: false,
                message: 'conversationHistory must be an array'
            });
            return;
        }
        
        // Continue with request
        next();
    } catch (error) {
        logger.error('Memory validation error:', error);
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'Invalid request data'
        });
    }
};

/**
 * Validate MCP tool input for creation and updates
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const validateToolInput = (req: Request, res: Response, next: NextFunction): void => {
    try {
        // Assert request body is an object
        if (!req.body || typeof req.body !== 'object') {
            res.status(400).json({
                success: false,
                message: 'Request body must be a valid JSON object'
            });
            return;
        }
        
        // For tool creation or update
        if (req.method === 'POST' || req.method === 'PUT') {
            // Required fields
            if (!req.body.name || typeof req.body.name !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'name is required and must be a string'
                });
                return;
            }
            
            if (!req.body.description || typeof req.body.description !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'description is required and must be a string'
                });
                return;
            }
            
            // Validate parameters if provided
            if (req.body.parameters) {
                if (typeof req.body.parameters !== 'object') {
                    res.status(400).json({
                        success: false,
                        message: 'parameters must be an object'
                    });
                    return;
                }
            }
            
            // Validate provider if provided
            if (req.body.provider && typeof req.body.provider !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'provider must be a string'
                });
                return;
            }
            
            // Validate version if provided
            if (req.body.version && typeof req.body.version !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'version must be a string'
                });
                return;
            }
            
            // Validate metadata if provided
            if (req.body.metadata && typeof req.body.metadata !== 'object') {
                res.status(400).json({
                    success: false,
                    message: 'metadata must be an object'
                });
                return;
            }
        }
        
        // Continue with request
        next();
    } catch (error) {
        logger.error('Tool validation error:', error);
        res.status(400).json({
            success: false,
            message: error instanceof Error ? error.message : 'Invalid request data'
        });
    }
};
