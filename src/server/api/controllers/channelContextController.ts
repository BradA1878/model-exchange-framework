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
 * Channel Context Controller
 * 
 * Provides API endpoints for channel context management including
 * context creation, participant management, message operations, and LLM-powered features.
 */

import { Request, Response } from 'express';
import { firstValueFrom } from 'rxjs';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events, ChannelEvents } from '@mxf-dev/core/events/EventNames';
import { ConversationTopic, ChannelContextType } from '@mxf-dev/core/types/ChannelContext';
import { projectChannelContext, projectChannelMessages, readChannelHistoryDmVisibility } from '@mxf-dev/core/utils/ChannelHistoryVisibility';
import { User } from '@mxf-dev/core/models/user';
import { normalizeChannelHistoryMessage } from '@mxf-dev/core/utils/ChannelHistoryMessages';
import { authorizationService } from '../services/AuthorizationService';
import { ChannelContextService } from '../../services/ChannelContextService';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { createChannelMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import { createChannelMessageEventPayload, createChannelEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';

// Create validator for this controller
const validate = createStrictValidator('ChannelContextController');

// Create logger for the controller
const logger = new Logger('debug','ChannelContextController', 'server');

const contextForRequest = (req: Request, context: ChannelContextType | null | undefined): Partial<ChannelContextType> | null | undefined => {
    return context && authorizationService.readPrincipal(req).kind === 'agent' ? projectChannelContext(context) : context;
};

/** Stored derived context cannot be partitioned by DM recipient after the fact. */
const denyPrivateDerivedContext = (req: Request, res: Response): boolean => {
    if (authorizationService.readPrincipal(req).kind === 'agent' && readChannelHistoryDmVisibility() === 'parties') {
        res.status(403).json({ success: false, message: 'Derived channel context is unavailable to agents with parties-only DM visibility' });
        return true;
    }
    return false;
};

/**
 * Who is making this request.
 *
 * Every route in this controller is behind requireChannelAccess, so the principal
 * is known by the time a handler runs. Actor fields taken from the request body —
 * `updatedBy`, `agentId` — are the caller telling us who they are, which is not
 * something we have any reason to believe. The authenticated identity is used to
 * attribute the change instead.
 *
 * @param req - Incoming request
 * @returns The agent id (key auth) or user id (JWT auth) behind the request
 */
const actorFor = (req: Request): string => {
    const agent = (req as any).agent;
    if (agent?.agentId) {
        return String(agent.agentId);
    }

    const user = (req as any).user;
    if (user?.id) {
        return String(user.id);
    }

    throw new Error('Authentication required');
};

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
        res.status(201).json(contextForRequest(req, context));
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
        res.status(200).json(contextForRequest(req, context));
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
        // `updatedBy` is discarded if present — the change is attributed to the
        // authenticated caller, not to whoever the body names.
        const { updatedBy: _ignoredUpdatedBy, ...updates } = req.body;
        const updatedBy = actorFor(req);

        // Validate required fields
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsObject(updates, 'Updates must be an object');

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
        res.status(200).json(contextForRequest(req, updatedContext));
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
    if (denyPrivateDerivedContext(req, res)) return;
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
        const { value } = req.body;
        // Attributed to the authenticated caller, not to a body field
        const agentId = actorFor(req);

        // Validate required fields
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        validate.assertIsNonEmptyString(key, 'Metadata key is required');

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
    if (denyPrivateDerivedContext(req, res)) return;
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
 * Publish an owner/admin user message after canonical history acknowledges it
 * @param req - Express request object
 * @param res - Express response object
 */
export const addChannelMessage = async (req: Request, res: Response): Promise<void> => {
    const principal = authorizationService.readPrincipal(req);
    if (principal.kind !== 'user') {
        res.status(principal.kind === 'unauthenticated' ? 401 : 403).json({
            success: false, message: 'A user account is required to publish a channel message'
        });
        return;
    }
    const { channelId } = req.params;
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        res.status(400).json({ success: false, message: 'Message body must be an object' });
        return;
    }
    const { content, messageType } = body as { content?: unknown; messageType?: unknown };
    if (typeof content !== 'string' && (content === null || typeof content !== 'object' || Array.isArray(content))) {
        res.status(400).json({ success: false, message: 'Message content must be a string or non-null object, not an array' });
        return;
    }
    if (messageType !== undefined && (typeof messageType !== 'string' || messageType.trim().length === 0)) {
        res.status(400).json({ success: false, message: 'messageType must be a non-empty string' });
        return;
    }
    try {
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        const authenticatedUsername = (req as Request & { user?: { username?: unknown } }).user?.username;
        const username: unknown = typeof authenticatedUsername === 'string' && authenticatedUsername.trim().length > 0
            ? authenticatedUsername
            : (await User.findById(principal.userId).select('username').lean())?.username;
        if (typeof username !== 'string' || username.trim().length === 0) {
            throw new Error('Authenticated user has no username');
        }
        // Only the authenticated identity supplies attribution. Request IDs and
        // timestamps are generated here, never accepted from the HTTP body.
        const message = createChannelMessage(channelId, username, content, {
            context: { messageType: messageType ?? 'user', userId: principal.userId }
        });
        await firstValueFrom(ChannelContextService.getInstance().addMessage(
            channelId, normalizeChannelHistoryMessage(message, channelId)
        ));
        // Persist first. The ordinary listener's second append is an ID-based
        // no-op, while this single event follows normal channel delivery.
        EventBus.server.emit(Events.Message.CHANNEL_MESSAGE, createChannelMessageEventPayload(
            Events.Message.CHANNEL_MESSAGE, username, message
        ));
        res.status(200).json({ messageId: message.metadata.messageId, timestamp: message.metadata.timestamp });
    } catch (error) {
        logger.error(`Error publishing channel message: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false, message: error instanceof Error ? error.message : String(error)
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
        const { channelId } = req.params;
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
        if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
            throw new Error('Limit must be a positive integer');
        }
        // Read the canonical history before applying recipient visibility and
        // the recent-message limit. The memory bridge owns request cancellation.
        const messages = await firstValueFrom(ChannelContextService.getInstance().getMessages(channelId));
        const principal = authorizationService.readPrincipal(req);
        const visible = principal.kind === 'agent' ? projectChannelMessages(messages, principal.agentId) : messages;
        res.status(200).json({ success: true, messages: limit === undefined ? visible : visible.slice(-limit) });
    } catch (error) {
        logger.error('Error getting channel messages:', error);
        res.status(400).json({ success: false, message: error instanceof Error ? error.message : String(error) });
    }
};

/**
 * Extract topics from channel conversation using LLM analysis
 * @param req - Express request object
 * @param res - Express response object
 */
export const extractChannelTopics = async (req: Request, res: Response): Promise<void> => {
    if (denyPrivateDerivedContext(req, res)) return;
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
    if (denyPrivateDerivedContext(req, res)) return;
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
