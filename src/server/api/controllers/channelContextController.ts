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
 * Channel Context Controller
 * 
 * Provides API endpoints for channel context management including
 * context creation, participant management, message operations, and LLM-powered features.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as validation from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { Events, ChannelEvents, ChannelActionTypes } from '../../../shared/events/EventNames';
import { ConversationTopic } from '../../../shared/types/ChannelContext';
import { Channel } from '../../../shared/models/channel';
import { ChannelContextService } from '../../../shared/services/ChannelContextService';
import { createStrictValidator } from '../../../shared/utils/validation';
import { ContentFormat, createChannelMessage } from '../../../shared/schemas/MessageSchemas';
import { createChannelMessageEventPayload, createChannelEventPayload } from '../../../shared/schemas/EventPayloadSchema';

// Create validator for this controller
const validate = createStrictValidator('ChannelContextController');

// Create logger for the controller
const logger = new Logger('debug','ChannelContextController', 'server');

/**
 * Create a new channel context
 * @param req - Express request object
 * @param res - Express response object
 */
export const createContext = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        const { name, description, creatorId } = req.body;
        
        // Validate required fields
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsNonEmptyString(name, 'Channel name is required');
        validate.assertIsNonEmptyString(creatorId, 'Creator agent ID is required');
        
        // Create the context using the service
        const context = await channelContextService.createContext(
            channelId,
            name,
            description || '',
            creatorId
        ).toPromise();
        
        // Return success with the created context
        res.status(201).json(context);
    } catch (error) {
        logger.error('Error creating channel context:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Get channel context
 * @param req - Express request object
 * @param res - Express response object
 */
export const getContext = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        
        // Validate channel ID
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        
        
        // Get the context using the service
        const context = await channelContextService.getContext(channelId).toPromise();
        
        
        if (!context) {
            logger.warn(`[API] Channel context for channel ${channelId} not found, returning 404`);
            res.status(404).json({
                success: false,
                message: `Channel context for channel ${channelId} not found`
            });
            return;
        }
        
        // Return the context
        res.status(200).json(context);
    } catch (error) {
        logger.error('Error getting channel context:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Update channel context
 * @param req - Express request object
 * @param res - Express response object
 */
export const updateContext = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        const { updatedBy, ...updates } = req.body;
        
        // Validate required fields
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsObject(updates, 'Updates must be an object');
        validate.assertIsNonEmptyString(updatedBy, 'Agent ID making the update is required');
        
        // Update the context using the service
        const updatedContext = await channelContextService.updateContext(
            channelId,
            updates,
            updatedBy
        ).toPromise();
        
        if (!updatedContext) {
            res.status(404).json({
                success: false,
                message: `Channel context for channel ${channelId} not found`
            });
            return;
        }
        
        // Return the updated context
        res.status(200).json(updatedContext);
    } catch (error) {
        logger.error('Error updating channel context:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Add an agent to a channel
 * @param req - Express request object
 * @param res - Express response object
 */
export const addAgentToChannel = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId, agentId } = req.params;
        
        // Validate required fields
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsNonEmptyString(agentId, 'Agent ID is required');
        
        // Add the agent using the service
        await channelContextService.updateContext(
            channelId,
            {
                participants: [agentId] // Adding to the participants array
            },
            agentId // Agent making the update, so this is the actorId for the event
        ).toPromise();
        
        // Emit event for agent joining channel using proper helper function
        const joinEventPayload = createChannelEventPayload(
            ChannelEvents.AGENT_JOINED,
            agentId,
            channelId,
            {
                action: 'join',
                targetAgentId: agentId
            }
        );
        EventBus.server.emit(ChannelEvents.AGENT_JOINED, joinEventPayload);
        
        // Return success status
        res.status(200).json({
            success: true,
            message: `Agent ${agentId} added to channel ${channelId}`
        });
    } catch (error) {
        logger.error('Error adding agent to channel:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Remove an agent from a channel
 * @param req - Express request object
 * @param res - Express response object
 */
export const removeAgentFromChannel = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId, agentId } = req.params;
        
        // Validate required fields
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsNonEmptyString(agentId, 'Agent ID is required');
        
        // Get current context
        const context = await channelContextService.getContext(channelId).toPromise();
        
        if (!context || !context.participants) {
            throw new Error(`Channel context for ${channelId} not found or has no participants`);
        }
        
        // Remove the agent from participants list
        const updatedParticipants = (context.participants || []).filter(id => id !== agentId);
        
        // Update context with new participants list
        await channelContextService.updateContext(
            channelId,
            {
                participants: updatedParticipants
            },
            agentId // Agent making the update, so this is the actorId for the event
        ).toPromise();
        
        // Emit event for agent leaving channel using proper helper function
        const leaveEventPayload = createChannelEventPayload(
            ChannelEvents.AGENT_LEFT,
            agentId,
            channelId,
            {
                action: 'leave',
                targetAgentId: agentId
            }
        );
        EventBus.server.emit(ChannelEvents.AGENT_LEFT, leaveEventPayload);
        
        // Return success status
        res.status(200).json({
            success: true,
            message: `Agent ${agentId} removed from channel ${channelId}`
        });
    } catch (error) {
        logger.error('Error removing agent from channel:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Get channel metadata
 * @param req - Express request object
 * @param res - Express response object
 */
export const getChannelMetadata = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        const { key } = req.params; // Optional, may be undefined
        
        // Validate channel ID
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        
        // Get context first
        const context = await channelContextService.getContext(channelId).toPromise();
        
        if (!context) {
            res.status(404).json({
                success: false,
                message: `Channel context for channel ${channelId} not found`
            });
            return;
        }
        
        // Return specific metadata key or all metadata
        if (key) {
            res.status(200).json({
                success: true,
                metadata: context.metadata?.[key]
            });
        } else {
            res.status(200).json({
                success: true,
                metadata: context.metadata || {}
            });
        }
    } catch (error) {
        logger.error('Error getting channel metadata:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Set channel metadata
 * @param req - Express request object
 * @param res - Express response object
 */
export const setChannelMetadata = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId, key } = req.params;
        const { value, agentId } = req.body;
        
        // Validate required fields
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsNonEmptyString(key, 'Metadata key is required');
        validate.assertIsNonEmptyString(agentId, 'Agent ID is required');
        
        // Get context first
        let context = await channelContextService.getContext(channelId).toPromise();
        
        if (!context) {
            res.status(404).json({
                success: false,
                message: `Channel context for channel ${channelId} not found`
            });
            return;
        }
        
        // Create metadata update
        const metadataUpdate = {
            metadata: {
                ...(context.metadata || {}),
                [key]: value
            }
        };
        
        // Update the context using the service
        const updatedContext = await channelContextService.updateContext(
            channelId,
            metadataUpdate,
            agentId
        ).toPromise();
        
        // Return success
        res.status(200).json({
            success: true,
            message: `Metadata ${key} updated for channel ${channelId}`
        });
    } catch (error) {
        logger.error('Error setting channel metadata:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Get channel context history
 * @param req - Express request object
 * @param res - Express response object
 */
export const getChannelHistory = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        
        // Validate channel ID
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        
        // If limit is provided, validate it's a positive number
        if (limit !== undefined) {
            validate.assertIsNumber(limit, 'Limit must be a number');
            if (limit <= 0) {
                throw new Error('Limit must be a positive number');
            }
        }
        
        // Get history using the service
        const history = await channelContextService.getContextHistory(
            channelId,
            limit
        ).toPromise();
        
        // Return the history
        res.status(200).json({
            success: true,
            history: history || []
        });
    } catch (error) {
        logger.error('Error getting channel history:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Add a message to the channel with improved timeout handling
 * @param req - Express request object
 * @param res - Express response object
 */
export const addChannelMessage = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        const message: any = req.body; // Type as any to reflect current dynamic property assignment
        
        // Validate required fields with fail-fast behavior
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsObject(message, 'Message must be an object');
        validate.assertIsNonEmptyString(message.content, 'Message content is required');
        validate.assertIsNonEmptyString(message.senderId, 'Sender ID is required');
        
        // Ensure message has all required fields (defaults)
        if (!message.messageId) {
            message.messageId = uuidv4();
        }
        if (!message.timestamp) {
            message.timestamp = Date.now();
        }
        if (!message.metadata) {
            message.metadata = {};
        }

        // Convert toPromise to a Promise with timeout
        const timeoutMs = 10000; // 10 second timeout
        
        // Create a promise that resolves when the service completes
        const servicePromise = channelContextService.addMessage(channelId, message).toPromise();
        
        // Create a timeout promise
        const timeoutPromise = new Promise<boolean>((_resolve, reject) => {
            setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
        
        // Race the service promise against the timeout
        await Promise.race([servicePromise, timeoutPromise]);
        
        // Return success
        res.status(200).json({
            success: true,
            messageId: message.messageId
        });
    } catch (error) {
        const isTimeout = error instanceof Error && error.message.includes('timed out');
        const logLevel = isTimeout ? 'warn' : 'error';
        const statusCode = isTimeout ? 408 : 400; // 408 Request Timeout
        
        logger[logLevel](`Error adding channel message: ${error instanceof Error ? error.message : String(error)}`);
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get channel messages
 * @param req - Express request object
 * @param res - Express response object
 */
export const getChannelMessages = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        
        // Validate channel ID
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        
        // If limit is provided, validate it's a positive number
        if (limit !== undefined) {
            validate.assertIsNumber(limit, 'Limit must be a number');
            if (limit <= 0) {
                throw new Error('Limit must be a positive number');
            }
        }
        
        
        // Convert toPromise to a Promise with timeout
        const timeoutMs = 10000; // 10 second timeout
        
        // Create a promise that resolves when the service completes
        const servicePromise = channelContextService.getMessages(channelId, limit).toPromise();
        
        // Create a timeout promise
        const timeoutPromise = new Promise<any[]>((_resolve, reject) => {
            setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
        
        try {
            // Race the service promise against the timeout
            const messages = await Promise.race([servicePromise, timeoutPromise]);
            
            // Return the messages
            res.status(200).json({
                success: true,
                messages: messages || []
            });
            
        } catch (timeoutError) {
            // Handle timeout specifically
            logger.warn(`Timeout occurred while retrieving messages for channel ${channelId}`);
            res.status(408).json({
                success: false,
                message: 'Request timeout while retrieving messages'
            });
        }
    } catch (error) {
        logger.error('Error getting channel messages:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Extract topics from channel conversation using LLM analysis
 * @param req - Express request object
 * @param res - Express response object
 */
export const extractChannelTopics = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        const { minRelevance = 0.5 } = req.body;
        
        // Validate channel ID and minRelevance
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsInRange(minRelevance, 0, 1, 'Minimum relevance must be between 0 and 1');
        
        
        // Convert minRelevance to number if it's a string from the HTTP request
        const minRelevanceValue = typeof minRelevance === 'string' ? parseFloat(minRelevance) : minRelevance;
        
        // Use the service implementation with timeout handling
        const timeoutMs = 60000; // 60 second timeout for LLM processing
        
        // Create a promise that resolves when the service completes
        const servicePromise = channelContextService.extractConversationTopics(
            channelId, 
            minRelevanceValue
        ).toPromise();
        
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`LLM topic extraction timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
        
        // Race the service promise against the timeout
        const topics = await Promise.race([servicePromise, timeoutPromise]) as ConversationTopic[];
        
        // Return the topics in the format expected by clients
        res.status(200).json({
            success: true,
            topics: topics || []
        });
    } catch (error) {
        const isTimeout = error instanceof Error && error.message.includes('timed out');
        const logLevel = isTimeout ? 'warn' : 'error';
        const statusCode = isTimeout ? 408 : 400; // 408 Request Timeout
        
        logger[logLevel](`Error extracting channel topics: ${error instanceof Error ? error.message : String(error)}`);
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Generate channel conversation summary using LLM analysis
 * @param req - Express request object
 * @param res - Express response object
 */
export const generateChannelSummary = async (req: Request, res: Response): Promise<void> => {
    try {
        const channelContextService = ChannelContextService.getInstance();
        const { channelId } = req.params;
        const { maxLength = 500 } = req.body;
        
        // Validate channel ID and parameters
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        if (maxLength) {
            validate.assertIsNumber(maxLength, 'Max length must be a number');
            validate.assertIsInRange(maxLength, 50, 2000, 'Max length must be between 50 and 2000 characters');
        }
        
        
        // Check if there are messages to summarize
        const messages = await channelContextService.getMessages(channelId).toPromise();
        if (!messages || messages.length === 0) {
            res.status(200).json({
                success: true,
                summary: 'No messages to summarize.'
            });
            return;
        }
        
        // Use the service implementation with timeout handling
        const timeoutMs = 60000; // 60 second timeout for LLM processing
        
        // Create a promise that resolves when the service completes
        // The service expects a messageCount parameter (number of most recent messages to include)
        // We'll use 50 as a reasonable default if maxLength is not specified
        const messageCount = maxLength && typeof maxLength === 'number' ? 
            Math.max(20, Math.min(100, Math.ceil(maxLength / 50))) : 50;
            
        const servicePromise = channelContextService.generateConversationSummary(
            channelId, 
            messageCount
        ).toPromise();
        
        // Create a timeout promise
        const timeoutPromise = new Promise<string>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`LLM summary generation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
        
        // Race the service promise against the timeout
        const summary = await Promise.race([servicePromise, timeoutPromise]);
        
        // Return the summary in the format expected by clients
        res.status(200).json({
            success: true,
            summary: summary || ''
        });
    } catch (error) {
        const isTimeout = error instanceof Error && error.message.includes('timed out');
        const logLevel = isTimeout ? 'warn' : 'error';
        const statusCode = isTimeout ? 408 : 400; // 408 Request Timeout
        
        logger[logLevel](`Error generating channel summary: ${error instanceof Error ? error.message : String(error)}`);
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : String(error)
        });
    }
};
