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
 * Channel Controller
 * 
 * Provides API endpoints for channel management and discovery, allowing
 * agents to register channels, verify ownership, and discover other agents.
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Channel } from '../../../shared/models/channel';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { Events, ChannelActionTypes, ChannelActionType } from '../../../shared/events/EventNames';
import { ChannelService } from '../../socket/services/ChannelService';
import channelKeyService from '../../socket/services/ChannelKeyService';
import { createChannelEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { MemoryPersistenceService } from '../services/MemoryPersistenceService';
import { MemoryScope } from '../../../shared/types/MemoryTypes';
import { firstValueFrom } from 'rxjs';

// Create validator for this controller
const validate = createStrictValidator('ChannelController');

// Initialize logger for channel controller
const logger = new Logger('info', 'ChannelController', 'server');

// Channel discovery service - real database implementations
const channelDiscoveryService = {
    registerChannel: async (channel: any) => {
        // Create new channel in database
        const newChannel = new Channel(channel);
        return await newChannel.save();
    },
    
    verifyChannel: async (verificationData: any) => {
        const channelId = typeof verificationData === 'string' ? verificationData : verificationData.channelId;
        const token = verificationData.token;
        
        // Find channel and verify token
        const channel = await Channel.findOne({ channelId });
        if (!channel) {
            return { verified: false, error: 'Channel not found' };
        }
        
        if (channel.verificationToken !== token) {
            return { verified: false, error: 'Invalid verification token' };
        }
        
        if (channel.verificationExpiry && channel.verificationExpiry < new Date()) {
            return { verified: false, error: 'Verification token expired' };
        }
        
        // Update channel as verified
        channel.verified = true;
        channel.verificationToken = undefined;
        channel.verificationExpiry = undefined;
        await channel.save();
        
        return { verified: true, channelId };
    },
    
    findChannelById: async (channelId: string) => {
        try {
            const channel = await Channel.findOne({ channelId }).lean();
            return channel;
        } catch (error) {
            logger.error(`Error finding channel ${channelId}:`, error);
            return null;
        }
    },
    
    findChannelsByAgent: async (agentId: string) => {
        try {
            const channels = await Channel.find({
                participants: agentId,
                active: true
            }).lean();
            return channels;
        } catch (error) {
            logger.error(`Error finding channels for agent ${agentId}:`, error);
            return [];
        }
    },
    
    findPublicChannels: async () => {
        try {
            const channels = await Channel.find({
                isPrivate: { $ne: true },
                active: true
            }).limit(50).lean();
            return channels;
        } catch (error) {
            logger.error('Error finding public channels:', error);
            return [];
        }
    },
    
    findChannelForDiscovery: async (channelId: string, includeUnverified: boolean = false) => {
        try {
            const query: any = { channelId, active: true };
            if (!includeUnverified) {
                query.verified = true;
            }
            const channel = await Channel.findOne(query).lean();
            return channel;
        } catch (error) {
            logger.error(`Error finding channel for discovery ${channelId}:`, error);
            return null;
        }
    },
    
    listChannelsByDomain: async (domain: string, verifiedOnly: boolean = true) => {
        try {
            // Search in channelId, customChannelId, or name for domain pattern
            const query: any = {
                $or: [
                    { channelId: { $regex: domain, $options: 'i' } },
                    { customChannelId: { $regex: domain, $options: 'i' } },
                    { name: { $regex: domain, $options: 'i' } }
                ],
                active: true
            };
            
            if (verifiedOnly) {
                query.verified = true;
            }
            
            const channels = await Channel.find(query).limit(20).lean();
            return channels;
        } catch (error) {
            logger.error(`Error listing channels by domain ${domain}:`, error);
            return [];
        }
    },
    
    searchChannels: async (query: string, verifiedOnly: boolean = true) => {
        try {
            const searchQuery: any = {
                $or: [
                    { name: { $regex: query, $options: 'i' } },
                    { description: { $regex: query, $options: 'i' } },
                    { channelId: { $regex: query, $options: 'i' } }
                ],
                active: true
            };
            
            if (verifiedOnly) {
                searchQuery.verified = true;
            }
            
            const channels = await Channel.find(searchQuery).limit(20).lean();
            return channels;
        } catch (error) {
            logger.error(`Error searching channels with query "${query}":`, error);
            return [];
        }
    },
    
    initializeVerification: async (channelId: string, method: string): Promise<string> => {
        try {
            const token = uuidv4();
            const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
            
            await Channel.updateOne(
                { channelId },
                {
                    verificationToken: token,
                    verificationMethod: method,
                    verificationExpiry: expiry
                }
            );
            
            return token;
        } catch (error) {
            logger.error(`Error initializing verification for channel ${channelId}:`, error);
            throw error;
        }
    }
};

/**
 * Generate a channel ID from channel name (GitHub-style slug)
 * 
 * @param name - Channel name
 * @returns Generated channel ID
 */
const generateChannelId = (name: string): string => {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
        .substring(0, 50); // Limit length
};

/**
 * Register a new channel for an agent
 * @param req - Express request object
 * @param res - Express response object
 */
export const registerChannel = async (req: Request, res: Response): Promise<void> => {
    try {
        // Extract fields from request body
        const { 
            channelId: providedChannelId, 
            customChannelId, 
            name,
            description,
            isPrivate,
            requireApproval,
            maxAgents,
            allowAnonymous,
            metadata
        } = req.body;
        
        // Get user ID from the authenticated request
        const userId = (req as any).user?.id;
        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required to create a channel'
            });
            return;
        }
        
        // Convert userId to string to ensure compatibility with event system
        const userIdString = userId.toString();
        
        // Validate required fields
        validate.assertIsNonEmptyString(name, 'Channel name is required');
        
        // Generate channelId from name if not provided
        const channelId = providedChannelId || generateChannelId(name);
        
        // Add debug logging to help diagnose issues
        
        // Validate the final channelId
        validate.assertIsNonEmptyString(channelId, 'Channel ID could not be generated');
        
        // Check if channel with ID already exists
        const existingChannel = await Channel.findOne({ channelId });
        if (existingChannel) {
            res.status(409).json({
                success: false,
                message: `Channel with ID ${channelId} already exists`
            });
            return;
        }
        
        if (customChannelId) {
            const existingChannel = await Channel.findOne({ customChannelId });
            if (existingChannel) {
                res.status(409).json({
                    success: false,
                    message: `Channel with custom ID ${customChannelId} already exists`
                });
                return;
            }
        }
        
        // Create new channel document
        const channel = new Channel({
            channelId,
            customChannelId,
            name,
            description,
            isPrivate: isPrivate !== undefined ? isPrivate : false,
            requireApproval: requireApproval !== undefined ? requireApproval : false,
            maxAgents: maxAgents || 50,
            allowAnonymous: allowAnonymous !== undefined ? allowAnonymous : true,
            createdBy: userIdString, // Channel is created by the authenticated user
            participants: [], // Initially no participants
            active: true,
            verified: false, // New channels start unverified
            metadata: metadata || {}
        });
        
        // Save channel to database
        await channel.save();
        
        // Emit channel created event with correctly structured payload
        const channelEventData = {
            channelId: channel.channelId,
            name: channel.name,
            customChannelId: channel.customChannelId,
            description: channel.description,
            isPrivate: channel.isPrivate,
            requireApproval: channel.requireApproval,
            maxAgents: channel.maxAgents,
            allowAnonymous: channel.allowAnonymous,
            createdBy: channel.createdBy, // userId who created the channel
            participants: channel.participants,
            active: channel.active,
            verified: channel.verified,
            metadata: channel.metadata,
        };

        EventBus.server.emit(Events.Channel.CREATED, {
            eventId: uuidv4(),
            timestamp: new Date(),
            eventType: Events.Channel.CREATED, // Explicitly set eventType in payload
            agentId: userIdString,                   // User who performed the action
            channelId: channel.channelId,      // The channel affected
            data: channelEventData
        });
        
        
        // Return success response with consistent format
        res.status(201).json({
            success: true,
            message: 'Channel registered successfully',
            channel: {
                id: channel.channelId, // Use channelId as id for frontend compatibility
                channelId: channel.channelId,
                customChannelId: channel.customChannelId,
                name: channel.name,
                description: channel.description,
                status: channel.active ? 'active' : 'inactive',
                participants: channel.participants?.length || 0,
                isPrivate: channel.isPrivate,
                requireApproval: channel.requireApproval,
                maxAgents: channel.maxAgents,
                allowAnonymous: channel.allowAnonymous,
                createdBy: channel.createdBy,
                verified: channel.verified,
                createdAt: channel.createdAt,
                updatedAt: channel.updatedAt
            }
        });
    } catch (error) {
        logger.error('Error registering channel:', error);
        const statusCode = 500; // Default status code
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Find a channel by its ID
 * @param req - Express request object
 * @param res - Express response object
 */
export const findByChannelId = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        const includeUnverified = req.query.includeUnverified === 'true';
        
        // Updated to use the renamed method
        const result = await channelDiscoveryService.findChannelForDiscovery(
            channelId,
            includeUnverified
        );
        
        if (!result) {
            res.status(404).json({
                success: false,
                message: `No agent found with channel ID: ${channelId}`
            });
            return;
        }
        
        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Error finding channel:', error);
        const statusCode = 500; // Default status code
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * List channels by domain
 * @param req - Express request object
 * @param res - Express response object
 */
export const listChannelsByDomain = async (req: Request, res: Response): Promise<void> => {
    try {
        const { domain } = req.params;
        const verifiedOnly = req.query.verifiedOnly !== 'false';
        
        const channels = await channelDiscoveryService.listChannelsByDomain(
            domain,
            verifiedOnly
        );
        
        res.status(200).json({
            success: true,
            count: channels.length,
            data: channels
        });
    } catch (error) {
        logger.error('Error listing channels:', error);
        const statusCode = 500; // Default status code
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Search for channels
 * @param req - Express request object
 * @param res - Express response object
 */
export const searchChannels = async (req: Request, res: Response): Promise<void> => {
    try {
        const { query } = req.query;
        const verifiedOnly = req.query.verifiedOnly !== 'false';
        
        if (!query || typeof query !== 'string') {
            res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
            return;
        }
        
        const channels = await channelDiscoveryService.searchChannels(
            query,
            verifiedOnly
        );
        
        res.status(200).json({
            success: true,
            count: channels.length,
            data: channels
        });
    } catch (error) {
        logger.error('Error searching channels:', error);
        const statusCode = 500; // Default status code
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Initialize channel verification
 * @param req - Express request object
 * @param res - Express response object
 */
export const initializeVerification = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        const { method } = req.body;
        
        if (!method || !['dns', 'email', 'file', 'token'].includes(method)) {
            res.status(400).json({
                success: false,
                message: 'Valid verification method is required'
            });
            return;
        }
        
        const verificationToken = await channelDiscoveryService.initializeVerification(
            channelId,
            method as 'dns' | 'email' | 'file' | 'token'
        );
        
        if (!verificationToken) {
            res.status(400).json({
                success: false,
                message: 'Failed to initialize verification'
            });
            return;
        }
        
        res.status(200).json({
            success: true,
            message: 'Verification initialized',
            data: {
                channelId,
                method,
                verificationToken,
                instructions: getVerificationInstructions(method, channelId, verificationToken)
            }
        });
    } catch (error) {
        logger.error('Error initializing verification:', error);
        const statusCode = 500; // Default status code
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Verify a channel
 * @param req - Express request object
 * @param res - Express response object
 */
export const verifyChannel = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        const { verificationToken, method } = req.body;
        
        if (!method || !['dns', 'email', 'file', 'token'].includes(method)) {
            res.status(400).json({
                success: false,
                message: 'Valid verification method is required'
            });
            return;
        }
        
        const success = await channelDiscoveryService.verifyChannel({
            channelId,
            verificationMethod: method as 'dns' | 'email' | 'file' | 'token',
            verificationToken
        });
        
        if (!success) {
            res.status(400).json({
                success: false,
                message: 'Verification failed'
            });
            return;
        }
        
        res.status(200).json({
            success: true,
            message: 'Channel successfully verified'
        });
    } catch (error) {
        logger.error('Error verifying channel:', error);
        const statusCode = 500; // Default status code
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get or create channel shared memory
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const getOrCreateChannelMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        validate.assertIsNonEmptyString(channelId);
        
        // Find channel by channelId
        let channel = await Channel.findOne({ channelId });
        
        if (!channel) {
            res.status(404).json({
                success: false,
                message: `Channel with ID ${channelId} not found`
            });
            return;
        }
        
        // Initialize shared memory if it doesn't exist
        if (!channel.sharedMemory) {
            channel.sharedMemory = {
                notes: {},
                sharedState: {},
                conversationHistory: [],
                customData: {},
                updatedAt: new Date()
            };
            
            await channel.save();
        }
        
        // Return the shared memory data
        res.status(200).json({
            success: true,
            data: {
                channelId: channel.channelId,
                notes: channel.sharedMemory.notes || {},
                sharedState: channel.sharedMemory.sharedState || {},
                conversationHistory: channel.sharedMemory.conversationHistory || [],
                customData: channel.sharedMemory.customData || {},
                updatedAt: channel.sharedMemory.updatedAt
            }
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Update channel shared memory
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const updateChannelMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        validate.assertIsNonEmptyString(channelId);
        validate.assertIsObject(req.body);
        
        // Find channel by channelId
        const channel = await Channel.findOne({ channelId });
        
        if (!channel) {
            res.status(404).json({
                success: false,
                message: `Channel with ID ${channelId} not found`
            });
            return;
        }
        
        // Initialize shared memory if it doesn't exist
        if (!channel.sharedMemory) {
            channel.sharedMemory = {
                notes: {},
                sharedState: {},
                conversationHistory: [],
                customData: {},
                updatedAt: new Date()
            };
        }
        
        // Update shared memory fields if provided in request
        if (req.body.notes) {
            channel.sharedMemory.notes = {
                ...channel.sharedMemory.notes || {},
                ...req.body.notes
            };
        }
        
        if (req.body.sharedState) {
            channel.sharedMemory.sharedState = {
                ...channel.sharedMemory.sharedState || {},
                ...req.body.sharedState
            };
        }
        
        if (req.body.customData) {
            channel.sharedMemory.customData = {
                ...channel.sharedMemory.customData || {},
                ...req.body.customData
            };
            // Remove keys explicitly set to null (used for deletion)
            for (const key of Object.keys(channel.sharedMemory.customData)) {
                if (channel.sharedMemory.customData[key] === null) {
                    delete channel.sharedMemory.customData[key];
                }
            }
        }
        
        // Handle conversation history (append if provided)
        if (req.body.conversationHistory && Array.isArray(req.body.conversationHistory)) {
            if (!channel.sharedMemory.conversationHistory) {
                channel.sharedMemory.conversationHistory = [];
            }
            channel.sharedMemory.conversationHistory.push(...req.body.conversationHistory);
        }
        
        // Update timestamp
        channel.sharedMemory.updatedAt = new Date();
        
        // Save the updated channel
        await channel.save();
        
        // Return updated memory
        res.status(200).json({
            success: true,
            data: {
                channelId: channel.channelId,
                notes: channel.sharedMemory.notes,
                sharedState: channel.sharedMemory.sharedState,
                conversationHistory: channel.sharedMemory.conversationHistory,
                customData: channel.sharedMemory.customData,
                updatedAt: channel.sharedMemory.updatedAt
            }
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Get a specific channel by ID for the authenticated user
 * @param req - Express request object
 * @param res - Express response object
 */
export const getChannelById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        const user = (req as any).user;
        
        // Validate authentication and channel ID
        validate.assertIsObject(user, 'User authentication required');
        validate.assertIsObject(user.id, 'User ID is required');
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');
        
        // Convert ObjectId to string for database query
        const userId = user.id.toString();
        
        // Find the channel for the authenticated user
        const channel = await Channel.findOne({ 
            channelId, 
            createdBy: userId 
        });
        
        if (!channel) {
            res.status(404).json({
                success: false,
                message: 'Channel not found'
            });
            return;
        }
        
        // Format channel data consistently with getAllChannels
        const formattedChannel = {
            id: channel.channelId,
            channelId: channel.channelId,
            customChannelId: channel.customChannelId,
            name: channel.name,
            description: channel.description,
            status: channel.active ? 'active' : 'inactive',
            participants: channel.participants?.length || 0,
            createdAt: channel.createdAt,
            updatedAt: channel.updatedAt
        };
        
        res.status(200).json({
            success: true,
            channel: formattedChannel
        });
    } catch (error) {
        logger.error('Error getting channel by ID:', error);
        const statusCode = 500;
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get all channels for the authenticated user
 * @param req - Express request object
 * @param res - Express response object
 */
export const getAllChannels = async (req: Request, res: Response): Promise<void> => {
    try {
        // Get user from authentication middleware
        const user = (req as any).user;
        
        // Validate user authentication
        validate.assertIsObject(user, 'User authentication required');
        validate.assertIsObject(user.id, 'User ID is required');
        
        // Convert ObjectId to string for database query
        const userId = user.id.toString();
        
        // Get channels created by the authenticated user
        const channels = await Channel.find({ createdBy: userId });
        
        // Format the channel data for the response
        const formattedChannels = channels.map(channel => ({
            id: channel.channelId, // Use channelId as id for frontend compatibility
            channelId: channel.channelId,
            customChannelId: channel.customChannelId,
            name: channel.name,
            description: channel.description,
            status: channel.active ? 'active' : 'inactive',
            participants: channel.participants?.length || 0,
            verified: channel.verified,
            createdAt: channel.createdAt,
            updatedAt: channel.updatedAt
        }));
        
        res.status(200).json({
            success: true,
            channels: formattedChannels
        });
    } catch (error) {
        logger.error('Error getting channels for user:', error);
        const statusCode = 500; // Default status code
        
        res.status(statusCode).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Create channel workspace - creates a new channel in ChannelService
 * @param req - Express request object
 * @param res - Express response object
 */
export const createChannelWorkspace = async (req: Request, res: Response): Promise<void> => {
    try {
        const { 
            channelId, 
            name, 
            description, 
            isPrivate = false,
            generateKey = false,
            keyName,
            keyExpiresAt 
        } = req.body;
        // Get user ID from JWT auth or agent ID from key auth
        const userId = (req as any).user?.id;
        const agentId = (req as any).agent?.agentId;
        
        // Convert ObjectId to string if needed and ensure non-empty value
        let createdBy: string;
        if (userId) {
            createdBy = userId.toString();
        } else if (agentId) {
            createdBy = agentId.toString();
        } else {
            logger.error('createChannelWorkspace: No valid authentication found');
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }
        
        // Validate required fields
        if (!channelId) {
            res.status(400).json({
                success: false,
                message: 'channelId is required'
            });
            return;
        }
        
        // Create channel using ChannelService singleton
        const channelService = ChannelService.getInstance();
        const channel = await channelService.createChannel(
            channelId,
            name,
            createdBy,
            { description, isPrivate }
        );
        
        if (!channel) {
            res.status(409).json({
                success: false,
                message: 'Channel already exists'
            });
            return;
        }
        
        let generatedKey: any = null;
        
        // Generate key if requested
        if (generateKey) {
            try {
                // Parse expiration date if provided
                let expirationDate: Date | undefined;
                if (keyExpiresAt) {
                    expirationDate = new Date(keyExpiresAt);
                    if (isNaN(expirationDate.getTime())) {
                        logger.warn(`Invalid keyExpiresAt date format: ${keyExpiresAt}`);
                        expirationDate = undefined;
                    }
                }
                
                generatedKey = await channelKeyService.createChannelKey(
                    channelId,
                    createdBy,
                    keyName || `Initial key for ${name || channelId}`,
                    expirationDate
                );
                
            } catch (keyError) {
                logger.error(`Failed to generate key for channel ${channelId}:`, keyError);
                // Continue without key generation - don't fail channel creation
            }
        }
        
        
        const responseData: any = {
            channelId: channel.id,
            name: channel.name,
            active: channel.active,
            createdAt: channel.createdAt
        };
        
        // Include key information if generated
        if (generatedKey) {
            responseData.generatedKey = {
                keyId: generatedKey.keyId,
                secretKey: generatedKey.secretKey, // Only returned on creation
                name: generatedKey.name,
                isActive: generatedKey.isActive,
                expiresAt: generatedKey.expiresAt,
                createdAt: generatedKey.createdAt
            };
        }
        
        res.status(201).json({
            success: true,
            message: generateKey && generatedKey 
                ? 'Channel created successfully with authentication key'
                : 'Channel created successfully',
            data: responseData
        });
    } catch (error) {
        logger.error('Error creating channel:', error);
        
        res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : 'Server error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get verification instructions based on method
 * @param method - Verification method
 * @param channelId - Channel ID
 * @param token - Verification token
 * @returns Instructions for verification
 */
const getVerificationInstructions = (
    method: string,
    channelId: string,
    token: string
): string => {
    switch (method) {
        case 'dns':
            return `Create a TXT record for _acf-verify.${channelId} with the value: ${token}`;
        
        case 'email':
            return 'You will receive an email with verification instructions. Follow the link in the email to complete verification.';
        
        case 'file':
            return `Create a file at /.well-known/acf-verification.txt with the content: ${token}`;
        
        case 'token':
            return 'Use this token to verify your channel through the agent API.';
        
        default:
            return 'Invalid verification method';
    }
};

/**
 * Update channel by channelId
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const updateChannel = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        validate.assertIsNonEmptyString(channelId, 'channelId is required');
        validate.assertIsObject(req.body, 'Request body must be an object');
        
        // Find and update channel
        const channel = await Channel.findOne({ channelId });
        if (!channel) {
            res.status(404).json({
                success: false,
                message: 'Channel not found'
            });
            return;
        }
        
        // Update allowed fields
        const allowedUpdates = ['name', 'description', 'isPrivate', 'requireApproval', 'maxAgents', 'allowAnonymous', 'active'];
        const updates: any = {};
        
        for (const field of allowedUpdates) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }
        
        // Update context if provided
        if (req.body.context) {
            updates.context = { ...channel.context, ...req.body.context };
        }
        
        // Update channel
        const updatedChannel = await Channel.findOneAndUpdate(
            { channelId },
            { $set: updates },
            { new: true, runValidators: true }
        );
        
        // Emit channel updated event with proper payload structure
        const agentId = (req as any).agent?.agentId || 'system';
        const updatedPayload = createChannelEventPayload(
            Events.Channel.UPDATED,
            agentId,
            channelId,
            {
                action: 'updated' as ChannelActionType,
                channelId,
                updates
            }
        );
        EventBus.server.emit(Events.Channel.UPDATED, updatedPayload);
        
        
        res.status(200).json({
            success: true,
            message: 'Channel updated successfully',
            channel: {
                channelId: updatedChannel!.channelId,
                name: updatedChannel!.name,
                description: updatedChannel!.description,
                isPrivate: updatedChannel!.isPrivate,
                active: updatedChannel!.active,
                verified: updatedChannel!.verified,
                updatedAt: updatedChannel!.updatedAt
            }
        });
    } catch (error) {
        logger.error('Error updating channel:', error);
        const errorMessage = error instanceof Error ? error.message : 'Server error';
        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Delete channel by channelId
 *
 * Also deletes the channel's persistent memory from MongoDB.
 *
 * @param req - Express request object
 * @param res - Express response object
 */
export const deleteChannel = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        validate.assertIsNonEmptyString(channelId, 'channelId is required');

        // Find channel first to check if it exists
        const channel = await Channel.findOne({ channelId });
        if (!channel) {
            res.status(404).json({
                success: false,
                message: 'Channel not found'
            });
            return;
        }

        // Delete the channel document
        await Channel.deleteOne({ channelId });

        // Delete channel memory from MongoDB
        const memoryPersistenceService = MemoryPersistenceService.getInstance();
        try {
            const memoryDeleted = await firstValueFrom(
                memoryPersistenceService.deleteMemory(MemoryScope.CHANNEL, channelId)
            );
            if (memoryDeleted) {
                logger.info(`Channel memory deleted for ${channelId}`);
            }
        } catch (memoryError) {
            // Log but don't fail - channel is already deleted
            logger.warn(`Could not delete channel memory for ${channelId}:`, memoryError);
        }

        // Emit channel deleted event
        const agentId = (req as any).agent?.agentId || 'system';
        const deletedPayload = createChannelEventPayload(
            Events.Channel.DELETED,
            agentId,
            channelId,
            {
                action: 'deleted' as ChannelActionType,
                channelId
            }
        );
        EventBus.server.emit(Events.Channel.DELETED, deletedPayload);


        res.status(200).json({
            success: true,
            message: 'Channel and associated memory deleted successfully',
            channelId
        });
    } catch (error) {
        logger.error('Error deleting channel:', error);
        const errorMessage = error instanceof Error ? error.message : 'Server error';
        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Register a channel-scoped MCP server
 */
export const registerChannelMcpServer = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        const serverConfig = req.body;
        const agentId = (req as any).agent?.agentId || (req as any).user?.userId || 'system';

        const channelService = ChannelService.getInstance();

        // Persist to database first
        const result = await channelService.registerChannelMcpServer(channelId, serverConfig, agentId);

        // Then emit event for ExternalMcpServerManager to start the server
        const { McpEvents } = require('../../../shared/events/event-definitions/McpEvents');
        EventBus.server.emit(McpEvents.CHANNEL_SERVER_REGISTER, {
            eventId: require('uuid').v4(),
            eventType: McpEvents.CHANNEL_SERVER_REGISTER,
            timestamp: Date.now(),
            agentId,
            channelId,
            data: { ...serverConfig, channelId }
        });

        res.status(200).json({
            ...result,
            message: 'Channel MCP server registered successfully'
        });
    } catch (error) {
        logger.error('Error registering channel MCP server:', error);
        const errorMessage = error instanceof Error ? error.message : 'Server error';
        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * List channel-scoped MCP servers
 */
export const listChannelMcpServers = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;

        const channelService = ChannelService.getInstance();
        const servers = await channelService.getChannelMcpServers(channelId);

        res.status(200).json({
            success: true,
            servers
        });
    } catch (error) {
        logger.error('Error listing channel MCP servers:', error);
        const errorMessage = error instanceof Error ? error.message : 'Server error';
        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Unregister a channel-scoped MCP server
 */
export const unregisterChannelMcpServer = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId, serverId } = req.params;
        const agentId = (req as any).agent?.agentId || (req as any).user?.userId || 'system';

        const channelService = ChannelService.getInstance();

        // Remove from database first
        const result = await channelService.unregisterChannelMcpServer(channelId, serverId, agentId);

        // Then emit event for ExternalMcpServerManager to stop the server
        const { McpEvents } = require('../../../shared/events/event-definitions/McpEvents');
        EventBus.server.emit(McpEvents.CHANNEL_SERVER_UNREGISTER, {
            eventId: require('uuid').v4(),
            eventType: McpEvents.CHANNEL_SERVER_UNREGISTER,
            timestamp: Date.now(),
            agentId,
            channelId,
            data: { serverId, channelId }
        });

        res.status(200).json({
            success: true,
            message: 'Channel MCP server unregistered successfully'
        });
    } catch (error) {
        logger.error('Error unregistering channel MCP server:', error);
        const errorMessage = error instanceof Error ? error.message : 'Server error';
        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
};
