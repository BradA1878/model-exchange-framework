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
 * Channel Controller
 * 
 * Provides API endpoints for channel management and discovery, allowing
 * agents to register channels, verify ownership, and discover other agents.
 */

import { McpEvents } from '@mxf-dev/core/events/event-definitions/McpEvents';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Channel, IChannel } from '@mxf-dev/core/models/channel';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events, ChannelActionType } from '@mxf-dev/core/events/EventNames';
import { ChannelService } from '../../socket/services/ChannelService';
import channelKeyService, { CreatedChannelKey } from '../../socket/services/ChannelKeyService';
import { AgentIdentityOwnershipError } from '../../security/AgentIdentityOwnershipService';
import { createChannelEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MemoryPersistenceService } from '../services/MemoryPersistenceService';
import { MemoryScope } from '@mxf-dev/core/types/MemoryTypes';
import { firstValueFrom } from 'rxjs';
import { UserRole } from '@mxf-dev/core/models/user';
import {
    AuthorizationPrincipal,
    authorizationService
} from '../services/AuthorizationService';
import type { ChannelAuthorizedRequest } from '../middleware/channelAuth';
import { isReservedChannelId } from '@mxf-dev/core/constants/ReservedIdentities';

interface AuthenticatedChannelRequest extends Request {
    authType?: string;
    user?: {
        id?: string | { toString(): string };
        role?: string;
    };
    agent?: {
        agentId?: string;
    };
}

interface ChannelVerificationRequest {
    channelId: string;
    verificationMethod: 'dns' | 'email' | 'file' | 'token';
    verificationToken: string;
}

interface ChannelVerificationResult {
    verified: boolean;
    channelId?: string;
    error?: string;
}

// Create validator for this controller
const validate = createStrictValidator('ChannelController');

// Initialize logger for channel controller
const logger = new Logger('info', 'ChannelController', 'server');

/** Longest accepted channel search term. Bounds the work a single query can cause. */
const MAX_SEARCH_TERM_LENGTH = 100;

/** Fields which are safe to expose through unaffiliated channel discovery. */
const CHANNEL_DISCOVERY_FIELDS = [
    'channelId',
    'customChannelId',
    'name',
    'description',
    'isPrivate',
    'requireApproval',
    'maxAgents',
    'allowAnonymous',
    'showActiveAgents',
    'active',
    'verified',
    'createdAt',
    'updatedAt',
    'lastActive'
] as const;

/** Mongo projection used at the database boundary for discovery reads. */
export const CHANNEL_DISCOVERY_PROJECTION: Record<string, 0 | 1> = {
    _id: 0,
    ...Object.fromEntries(CHANNEL_DISCOVERY_FIELDS.map((field) => [field, 1]))
};

/**
 * Defense-in-depth output allowlist. This remains explicit even though the
 * Mongo query also projects fields, so a future query refactor cannot expose
 * shared memory, verification credentials, metadata, participants, or MCP
 * server configuration/environment values.
 */
export const toSafeChannelDiscoveryView = (channel: Record<string, unknown>): Record<string, unknown> => {
    const safeView: Record<string, unknown> = {};

    for (const field of CHANNEL_DISCOVERY_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(channel, field)) {
            safeView[field] = channel[field];
        }
    }

    return safeView;
};

const getDiscoveryVisibilityFilter = (principal: AuthorizationPrincipal): Record<string, unknown> => {
    if (principal.kind === 'user' && principal.role === UserRole.ADMIN) {
        return {};
    }

    const visibleChannels: Record<string, unknown>[] = [
        { isPrivate: { $ne: true } }
    ];

    if (principal.kind === 'user') {
        visibleChannels.push({ createdBy: principal.userId });
    } else if (principal.kind === 'agent') {
        // Agent credentials are scoped to their authenticated channel. A
        // matching participant name elsewhere does not broaden that scope.
        visibleChannels.push({ channelId: principal.channelId });
    }

    return { $or: visibleChannels };
};

const withDiscoveryVisibility = (
    query: Record<string, unknown>,
    principal: AuthorizationPrincipal,
    includeAffiliatedUnverified: boolean = false
): Record<string, unknown> => {
    const visibility = getDiscoveryVisibilityFilter(principal);
    const accessFilters = [query];

    if (Object.keys(visibility).length > 0) {
        accessFilters.push(visibility);
    }

    if (includeAffiliatedUnverified && !(principal.kind === 'user' && principal.role === UserRole.ADMIN)) {
        const verifiedOrAffiliated: Record<string, unknown>[] = [{ verified: true }];

        if (principal.kind === 'user') {
            verifiedOrAffiliated.push({ createdBy: principal.userId });
        } else if (principal.kind === 'agent') {
            verifiedOrAffiliated.push({ channelId: principal.channelId });
        }

        accessFilters.push({ $or: verifiedOrAffiliated });
    }

    return accessFilters.length === 1 ? query : { $and: accessFilters };
};

/**
 * Neutralize regex metacharacters in a user-supplied search term.
 *
 * The channel search and domain listing build `$regex` filters from caller
 * input. Unescaped, `.*` scans every channel and a nested quantifier such as
 * `(a+)+$` makes the regex engine backtrack exponentially — one request, one
 * pinned CPU. After escaping, the term can only ever match itself literally.
 *
 * @param value - Raw search term
 * @returns The term with every regex metacharacter escaped
 */
const escapeRegex = (value: string): string => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Validate and escape a search term before it becomes a Mongo `$regex`.
 *
 * @param value - Raw term from the query string or path
 * @returns The escaped term
 * @throws If the term is not a string, is empty, or exceeds MAX_SEARCH_TERM_LENGTH
 */
const toSafeSearchPattern = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new Error('Search term must be a string');
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
        throw new Error('Search term must not be empty');
    }

    if (trimmed.length > MAX_SEARCH_TERM_LENGTH) {
        throw new Error(`Search term must be ${MAX_SEARCH_TERM_LENGTH} characters or fewer`);
    }

    return escapeRegex(trimmed);
};

// Channel discovery service - real database implementations
const channelDiscoveryService = {
    registerChannel: async (channel: Record<string, unknown>): Promise<IChannel> => {
        // Create new channel in database
        const newChannel = new Channel(channel);
        return await newChannel.save();
    },
    
    verifyChannel: async (
        verificationData: ChannelVerificationRequest
    ): Promise<ChannelVerificationResult> => {
        const channelId = verificationData.channelId;
        const token = verificationData.verificationToken;
        
        // Find channel and verify token
        const channel = await Channel.findOne({ channelId, active: true });
        if (!channel) {
            return { verified: false, error: 'Channel not found' };
        }
        
        if (channel.verificationToken !== token) {
            return { verified: false, error: 'Invalid verification token' };
        }
        
        if (channel.verificationExpiry && channel.verificationExpiry < new Date()) {
            return { verified: false, error: 'Verification token expired' };
        }
        
        // Update only while the same channel remains active. A concurrent
        // deletion must win without this verification mutating its tombstone.
        const verificationResult = await Channel.updateOne(
            {
                _id: channel._id,
                active: true,
                verificationToken: token
            },
            {
                $set: { verified: true },
                $unset: {
                    verificationToken: '',
                    verificationExpiry: ''
                }
            }
        );
        if (verificationResult.matchedCount !== 1) {
            return { verified: false, error: 'Channel is no longer active' };
        }
        
        return { verified: true, channelId };
    },
    
    findChannelForDiscovery: async (
        channelId: string,
        principal: AuthorizationPrincipal,
        includeUnverified: boolean = false
    ): Promise<Record<string, unknown> | null> => {
        try {
            const query: Record<string, unknown> = { channelId, active: true };
            if (!includeUnverified) {
                query.verified = true;
            }
            const channel = await Channel.findOne(withDiscoveryVisibility(query, principal, includeUnverified))
                .select(CHANNEL_DISCOVERY_PROJECTION)
                .lean();
            return channel ? toSafeChannelDiscoveryView(channel as Record<string, unknown>) : null;
        } catch (error) {
            logger.error(`Error finding channel for discovery ${channelId}:`, error);
            return null;
        }
    },
    
    listChannelsByDomain: async (
        domain: string,
        principal: AuthorizationPrincipal,
        verifiedOnly: boolean = true
    ): Promise<Array<Record<string, unknown>>> => {
        try {
            // Escape before building the $regex — see toSafeSearchPattern
            const pattern = toSafeSearchPattern(domain);

            // Search in channelId, customChannelId, or name for domain pattern
            const query: Record<string, unknown> = {
                $or: [
                    { channelId: { $regex: pattern, $options: 'i' } },
                    { customChannelId: { $regex: pattern, $options: 'i' } },
                    { name: { $regex: pattern, $options: 'i' } }
                ],
                active: true
            };

            if (verifiedOnly) {
                query.verified = true;
            }

            const channels = await Channel.find(withDiscoveryVisibility(query, principal, !verifiedOnly))
                .select(CHANNEL_DISCOVERY_PROJECTION)
                .limit(20)
                .lean();
            return channels.map((channel) => toSafeChannelDiscoveryView(channel as Record<string, unknown>));
        } catch (error) {
            logger.error(`Error listing channels by domain ${domain}:`, error);
            return [];
        }
    },

    searchChannels: async (
        query: string,
        principal: AuthorizationPrincipal,
        verifiedOnly: boolean = true
    ): Promise<Array<Record<string, unknown>>> => {
        try {
            // Escape before building the $regex — see toSafeSearchPattern
            const pattern = toSafeSearchPattern(query);

            const searchQuery: Record<string, unknown> = {
                $or: [
                    { name: { $regex: pattern, $options: 'i' } },
                    { description: { $regex: pattern, $options: 'i' } },
                    { channelId: { $regex: pattern, $options: 'i' } }
                ],
                active: true
            };

            if (verifiedOnly) {
                searchQuery.verified = true;
            }

            const channels = await Channel.find(withDiscoveryVisibility(searchQuery, principal, !verifiedOnly))
                .select(CHANNEL_DISCOVERY_PROJECTION)
                .limit(20)
                .lean();
            return channels.map((channel) => toSafeChannelDiscoveryView(channel as Record<string, unknown>));
        } catch (error) {
            logger.error(`Error searching channels with query "${query}":`, error);
            return [];
        }
    },
    
    initializeVerification: async (channelId: string, method: string): Promise<string> => {
        try {
            const token = uuidv4();
            const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
            
            const result = await Channel.updateOne(
                { channelId, active: true },
                {
                    verificationToken: token,
                    verificationMethod: method,
                    verificationExpiry: expiry
                }
            );
            if (result.matchedCount !== 1) {
                throw new Error(`Active channel ${channelId} not found`);
            }
            
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
        const userId = (req as AuthenticatedChannelRequest).user?.id;
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

        if (isReservedChannelId(channelId)) {
            res.status(400).json({
                success: false,
                message: 'This channelId is reserved for internal MXF routing'
            });
            return;
        }
        
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
        const principal = authorizationService.readPrincipal(req);
        
        // Updated to use the renamed method
        const result = await channelDiscoveryService.findChannelForDiscovery(
            channelId,
            principal,
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
        const principal = authorizationService.readPrincipal(req);

        // Reject over-long terms with a 400 rather than letting them reach the
        // regex builder. The builder escapes them anyway, but the caller should
        // hear about a bad request instead of getting an empty result set.
        if (typeof domain !== 'string' || domain.trim().length === 0 || domain.length > MAX_SEARCH_TERM_LENGTH) {
            res.status(400).json({
                success: false,
                message: `Domain must be a non-empty string of at most ${MAX_SEARCH_TERM_LENGTH} characters`
            });
            return;
        }

        const channels = await channelDiscoveryService.listChannelsByDomain(
            domain,
            principal,
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
        const principal = authorizationService.readPrincipal(req);

        // typeof guard also keeps query operators out: ?query[$ne]= arrives as an object.
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
            return;
        }

        if (query.length > MAX_SEARCH_TERM_LENGTH) {
            res.status(400).json({
                success: false,
                message: `Search query must be ${MAX_SEARCH_TERM_LENGTH} characters or fewer`
            });
            return;
        }

        const channels = await channelDiscoveryService.searchChannels(
            query,
            principal,
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
        
        const verification = await channelDiscoveryService.verifyChannel({
            channelId,
            verificationMethod: method as 'dns' | 'email' | 'file' | 'token',
            verificationToken
        });
        
        if (!verification.verified) {
            res.status(400).json({
                success: false,
                message: verification.error ?? 'Verification failed'
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
 * Get a specific channel by ID for the authenticated user
 * @param req - Express request object
 * @param res - Express response object
 */
export const getChannelById = async (req: Request, res: Response): Promise<void> => {
    try {
        const { channelId } = req.params;
        validate.assertIsNonEmptyString(channelId, 'Channel ID is required');

        // requireChannelOwner resolves the channel and proves ownership before
        // this controller runs. Reusing that record avoids a second query and
        // keeps administrator access consistent with the central policy.
        const channel = (req as ChannelAuthorizedRequest).channel;
        
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
        const user = (req as AuthenticatedChannelRequest).user;
        
        // Validate user authentication
        validate.assertIsObject(user, 'User authentication required');
        if (!user?.id) {
            throw new Error('User ID is required');
        }
        
        // Convert ObjectId to string for database query
        const userId = user.id.toString();
        
        // Get channels created by the authenticated user
        const channels = await Channel.find({ createdBy: userId, active: true });
        
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
            keyAgentId,
            keyName,
            keyExpiresAt,
            keyAllowedTools
        } = req.body;
        // Workspace creation is a credential-management operation. A channel
        // key proves an agent identity inside one channel; it is not authority
        // to create new channels or mint more credentials.
        const authenticatedRequest = req as AuthenticatedChannelRequest;
        const userId = authenticatedRequest.user?.id;
        if (authenticatedRequest.authType !== 'jwt' || !userId) {
            res.status(403).json({
                success: false,
                message: 'A user account is required to create a channel workspace'
            });
            return;
        }

        const createdBy = userId.toString();

        // Validate required fields
        if (typeof channelId !== 'string' || channelId.trim().length === 0) {
            res.status(400).json({
                success: false,
                message: 'channelId is required'
            });
            return;
        }

        if (isReservedChannelId(channelId)) {
            res.status(400).json({
                success: false,
                message: 'This channelId is reserved for internal MXF routing'
            });
            return;
        }

        // Validate every key option before creating the channel. Invalid key
        // input must not leave a partially-created workspace behind.
        let expirationDate: Date | undefined;
        if (generateKey) {
            if (typeof keyAgentId !== 'string' || keyAgentId.trim().length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'keyAgentId is required when generateKey is set — it is the identity the key authenticates as'
                });
                return;
            }

            if (keyExpiresAt) {
                expirationDate = new Date(keyExpiresAt);
                if (isNaN(expirationDate.getTime())) {
                    res.status(400).json({
                        success: false,
                        message: `Invalid keyExpiresAt date format: ${keyExpiresAt}`
                    });
                    return;
                }
            }
        }

        // Never make workspace creation an idempotent "get existing" path.
        // Returning another user's channel here used to flow directly into key
        // generation and allowed channel takeover.
        const existingChannel = await Channel.findOne({ channelId }).select('_id');
        if (existingChannel) {
            res.status(409).json({
                success: false,
                message: 'Channel already exists'
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

        // A concurrent creator can win the unique-index race between the
        // existence check and ChannelService.save(). ChannelService may load
        // that winner for runtime consistency; never mint a key unless the
        // persisted record belongs to this caller.
        const persistedChannel = await Channel.findOne({ channelId, active: true }).select('createdBy');
        if (!persistedChannel || String(persistedChannel.createdBy) !== createdBy) {
            res.status(409).json({
                success: false,
                message: 'Channel already exists'
            });
            return;
        }

        let generatedKey: CreatedChannelKey | null = null;

        // Generate key if requested. A key names the agent it authenticates, so
        // keyAgentId is required whenever generateKey is set — see ChannelKeyService.
        if (generateKey) {
            // A key generation failure is not swallowed: the caller asked for a key,
            // and returning a channel without one would leave them with no way in.
            generatedKey = await channelKeyService.createChannelKey(
                channelId,
                createdBy,
                keyAgentId.trim(),
                keyName || `Initial key for ${name || channelId}`,
                expirationDate,
                keyAllowedTools
            );
        }


        const responseData: Record<string, unknown> = {
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
                agentId: generatedKey.agentId,
                allowedTools: generatedKey.allowedTools,
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

        const statusCode = error instanceof AgentIdentityOwnershipError
            ? error.statusCode
            : 500;
        res.status(statusCode).json({
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
        const channel = await Channel.findOne({ channelId, active: true });
        if (!channel) {
            res.status(404).json({
                success: false,
                message: 'Channel not found'
            });
            return;
        }
        
        // Update allowed fields
        // Lifecycle state is not a generic mutable field. Deactivation must go
        // through the deletion/archive lifecycle so keys, sockets, and runtime
        // services cannot be left live.
        const allowedUpdates = ['name', 'description', 'isPrivate', 'requireApproval', 'maxAgents', 'allowAnonymous'];
        const updates: Record<string, unknown> = {};
        
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
            { channelId, active: true },
            { $set: updates },
            { new: true, runValidators: true }
        );
        if (!updatedChannel) {
            res.status(404).json({
                success: false,
                message: 'Channel is no longer active'
            });
            return;
        }
        
        // Emit channel updated event with proper payload structure
        const agentId = (req as AuthenticatedChannelRequest).agent?.agentId || 'system';
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
                channelId: updatedChannel.channelId,
                name: updatedChannel.name,
                description: updatedChannel.description,
                isPrivate: updatedChannel.isPrivate,
                active: updatedChannel.active,
                verified: updatedChannel.verified,
                updatedAt: updatedChannel.updatedAt
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

        // Route authorization has established the owning user/admin. The
        // service owns the complete lifecycle and emits the sole deletion
        // event; the controller must not hard-delete the channel tombstone or
        // emit a duplicate result.
        const authenticatedRequest = req as AuthenticatedChannelRequest;
        const actorId = authenticatedRequest.user?.id?.toString();
        validate.assertIsNonEmptyString(actorId, 'Authenticated user ID is required');
        if (!actorId) {
            throw new Error('Authenticated user ID is required');
        }
        const channelService = ChannelService.getInstance();
        const deletionReason = typeof req.body?.reason === 'string'
            ? req.body.reason
            : undefined;
        const deleted = authenticatedRequest.user?.role === UserRole.ADMIN
            ? await channelService.deleteChannelAsAdministrator(
                channelId,
                actorId,
                deletionReason
            )
            : await channelService.deleteChannel(channelId, actorId, deletionReason);
        if (!deleted) {
            res.status(404).json({
                success: false,
                message: 'Channel not found or already inactive'
            });
            return;
        }

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
            // The channel is already safely inactive and its keys/sockets are
            // revoked. Memory cleanup is best-effort after that security boundary.
            logger.warn(`Could not delete channel memory for ${channelId}:`, memoryError);
        }

        res.status(200).json({
            success: true,
            message: 'Channel deleted successfully',
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
        // These routes are administrator-only. dualAuth stores the authenticated
        // user identifier at `user.id`; using the legacy `userId` property made
        // every REST registration look as though it had been performed by system.
        const actorId = (req as AuthenticatedChannelRequest).user?.id?.toString();
        validate.assertIsNonEmptyString(actorId, 'Authenticated administrator ID is required');
        if (!actorId) {
            throw new Error('Authenticated administrator ID is required');
        }

        const channelService = ChannelService.getInstance();

        // Persist to database first
        const result = await channelService.registerChannelMcpServer(channelId, serverConfig, actorId);

        // Then emit event for ExternalMcpServerManager to start the server
        EventBus.server.emit(McpEvents.CHANNEL_SERVER_REGISTER, {
            eventId: uuidv4(),
            eventType: McpEvents.CHANNEL_SERVER_REGISTER,
            timestamp: Date.now(),
            agentId: actorId,
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
        // The complete config is intentionally returned only because the route
        // is administrator-only; configs may include environment credentials.
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
        const actorId = (req as AuthenticatedChannelRequest).user?.id?.toString();
        validate.assertIsNonEmptyString(actorId, 'Authenticated administrator ID is required');
        if (!actorId) {
            throw new Error('Authenticated administrator ID is required');
        }

        const channelService = ChannelService.getInstance();

        // Remove from database first
        await channelService.unregisterChannelMcpServer(channelId, serverId, actorId);

        // Then emit event for ExternalMcpServerManager to stop the server
        EventBus.server.emit(McpEvents.CHANNEL_SERVER_UNREGISTER, {
            eventId: uuidv4(),
            eventType: McpEvents.CHANNEL_SERVER_UNREGISTER,
            timestamp: Date.now(),
            agentId: actorId,
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
