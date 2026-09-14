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

import { firstValueFrom } from 'rxjs';
import { EventEmitter } from 'events';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { ServerEventBus } from '@mxf-dev/core/events/ServerEventBus';
import { EventName, ChannelActionTypes, ChannelActionType } from '@mxf-dev/core/events/EventNames';
import { MessagePersistFailedPayload } from '@mxf-dev/core/events/event-definitions/MessageEvents';
import { ChannelEventData, MessageEventData, BaseEventPayload, createMessageEventPayload, createMessagePersistFailedEventPayload, createMessageSendFailedEventPayload, createChannelEventPayload, createChannelMessageEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema'; 
import { ChannelMessage, ContentFormat, MessageMetadata, createChannelMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import { ChannelId, AgentId } from '@mxf-dev/core/types/ChannelContext';
import { ChannelContextMessageOperations } from '@mxf-dev/core/services/ChannelContextMessageOperations';
import { Server } from 'socket.io'; 
import { IChannel } from '@mxf-dev/core/interfaces/Channel'; 
import { Channel } from '@mxf-dev/core/models/channel';
import { User, UserRole } from '@mxf-dev/core/models/user';
import { McpService } from './McpService';
import channelKeyService from './ChannelKeyService';
import { SystemLlmServiceManager } from './SystemLlmServiceManager';
import { ServerHybridMcpService } from '../../api/services/ServerHybridMcpService';
// Import shared config events (NOT from SDK - that's client-side only)
import { ConfigEvents, ChannelSystemLlmChangeEvent } from '@mxf-dev/core/events/event-definitions/ConfigEvents';
import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';
import { hydrateChannelSystemLlmStance } from '../../api/security/ChannelRuntimePolicy';
import { isSystemLlmStance, SYSTEMLLM_STANCES } from '@mxf-dev/core/types/SystemLlmStanceTypes';
import { isReservedChannelId } from '@mxf-dev/core/constants/ReservedIdentities';
import { normalizeChannelHistoryMessage } from '@mxf-dev/core/utils/ChannelHistoryMessages';

/** A terminal channel tombstone exists, but one or more required cleanups need retry. */
export class ChannelDeletionCleanupError extends Error {
    public readonly channelId: ChannelId;
    public readonly failures: string[];

    constructor(channelId: ChannelId, failures: string[]) {
        super(
            `Channel ${channelId} is inactive but deletion cleanup is incomplete: ` +
            failures.join(', ')
        );
        this.name = 'ChannelDeletionCleanupError';
        this.channelId = channelId;
        this.failures = [...failures];
    }
}

/**
 * ChannelService manages channel lifecycle and interactions.
 */
export class ChannelService extends EventEmitter {
    private static instance: ChannelService;
    private validator: ReturnType<typeof createStrictValidator>;
    private io: Server; 
    private eventBus: ServerEventBus; 

    // Store channels in memory (consider a more persistent store for production)
    private channels: Map<ChannelId, IChannel> = new Map();
    private channelParticipants: Map<ChannelId, Set<AgentId>> = new Map();
    private readonly channelMessageOperations: ChannelContextMessageOperations;
    private readonly logger: Logger;

    private constructor(io: Server) { 
        super();
        this.io = io; 
        this.logger = new Logger('debug','ChannelService', 'server');
        this.channels = new Map<ChannelId, IChannel>();
        this.channelMessageOperations = new ChannelContextMessageOperations();
        this.validator = createStrictValidator('ChannelService');
        this.eventBus = EventBus.server as ServerEventBus; 
        this.setupEventListeners();
    }

    /**
     * Get the singleton instance of ChannelService
     */
    public static getInstance(io?: Server): ChannelService {
        if (!ChannelService.instance) {
            if (!io) {
                throw new Error('ChannelService requires io parameter on first initialization');
            }
            ChannelService.instance = new ChannelService(io);
        }
        return ChannelService.instance;
    }

    private setupEventListeners(): void {
        
        // Listen for incoming channel messages and convert them to persistence requests
        this.eventBus.on(Events.Message.CHANNEL_MESSAGE, async (payload: BaseEventPayload<ChannelMessage>) => {
            try {
                
                // Validate the payload structure
                this.validator.assert(!!payload, 'CHANNEL_MESSAGE payload cannot be null');
                this.validator.assert(!!payload.data, 'CHANNEL_MESSAGE payload.data is required');
                this.validator.assertIsNonEmptyString(payload.agentId, 'CHANNEL_MESSAGE payload.agentId is required');
                this.validator.assertIsNonEmptyString(payload.channelId, 'CHANNEL_MESSAGE payload.channelId is required');
                
                const channelMessage = payload.data as ChannelMessage;
                
                // Create MessageEventData for the persistence request
                const messageEventData: MessageEventData = {
                    message: channelMessage
                };
                
                // Create properly typed persistence request payload using createMessageEventPayload
                const persistPayload = createMessageEventPayload(
                    Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST,
                    payload.agentId,
                    payload.channelId,
                    messageEventData,
                    {
                        eventId: payload.eventId,
                        timestamp: payload.timestamp
                    }
                );
                
                
                // Emit the persistence request event
                this.eventBus.emit(Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST, persistPayload);
                
            } catch (error) {
                this.logger.error(`Error processing CHANNEL_MESSAGE event: ${error instanceof Error ? error.message : String(error)}`);
            }
        });


        // Listen for agent-to-agent messages and convert them to channel messages for persistence
        // This bridges the gap between messaging_send and channel_messages_read tools
        this.eventBus.on(Events.Message.AGENT_MESSAGE, async (payload: BaseEventPayload<any>) => {
            try {
                
                // Validate the payload structure
                this.validator.assert(!!payload, 'AGENT_MESSAGE payload cannot be null');
                this.validator.assert(!!payload.data, 'AGENT_MESSAGE payload.data is required');
                this.validator.assertIsNonEmptyString(payload.agentId, 'AGENT_MESSAGE payload.agentId is required');
                this.validator.assertIsNonEmptyString(payload.channelId, 'AGENT_MESSAGE payload.channelId is required');
                
                const agentMessage = payload.data;

                // Convert AgentMessage to ChannelMessage format
                const channelMessage = createChannelMessage(
                    payload.channelId,               // channelId (1st parameter)
                    agentMessage.senderId,           // senderId (2nd parameter)
                    agentMessage.content.data,       // unwrap the wire content exactly once
                    {
                        receiverId: agentMessage.receiverId,
                        format: agentMessage.content.format,
                        context: { ...agentMessage.context, channelId: payload.channelId },
                        metadata: {
                            ...agentMessage.metadata,
                            originalMessageType: 'agent-to-agent',
                            targetAgentId: agentMessage.receiverId,
                            convertedFromAgentMessage: true
                        }
                    }
                );
                
                // Create MessageEventData for the persistence request
                const messageEventData: MessageEventData = {
                    message: channelMessage
                };
                
                // Create properly typed persistence request payload
                const persistPayload = createMessageEventPayload(
                    Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST,
                    payload.agentId,
                    payload.channelId,
                    messageEventData,
                    {
                        eventId: payload.eventId,
                        timestamp: payload.timestamp
                    }
                );
                                
                // Emit the persistence request event
                this.eventBus.emit(Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST, persistPayload);
                
            } catch (error) {
                this.logger.error(`Error processing AGENT_MESSAGE event: ${error instanceof Error ? error.message : String(error)}`);
            }
        });


        // Listen for messages that need to be persisted
        this.eventBus.on(Events.Message.PERSIST_CHANNEL_MESSAGE_REQUEST, async (payload: BaseEventPayload<MessageEventData>) => {
            this.validator.assert(!!payload, 'Payload for PERSIST_CHANNEL_MESSAGE_REQUEST cannot be null');
            this.validator.assert(!!payload.data, 'payload.data is required');
            const channelMessage = payload.data.message as ChannelMessage;
            
            // Ensure context and channelId are present
            this.validator.assert(!!channelMessage.context, 'payload.message.context is required');
            const channelId = channelMessage.context?.channelId as ChannelId;
            this.validator.assertIsNonEmptyString(channelId, 'payload.message.context.channelId is required');
            
            this.validator.assertIsNonEmptyString(channelMessage.senderId, 'payload.message.senderId is required');

            // Persistence requests are generated internally from an already
            // authenticated message envelope. Never let nested message fields
            // retarget that request to another channel or attribute it to a
            // different sender if a future caller reaches this bus event.
            if (channelId !== payload.channelId || channelMessage.senderId !== payload.agentId) {
                this.logger.warn(
                    `Rejected message persistence identity mismatch: outer=${payload.agentId}/${payload.channelId} ` +
                    `nested=${channelMessage.senderId}/${channelId}`
                );
                return;
            }

            this.validator.assert(channelMessage.content?.data !== undefined, 'payload.message.content.data is required');
            this.validator.assert(!!channelMessage.metadata, 'payload.message.metadata is required');
            const messageId = channelMessage.metadata?.messageId;
            this.validator.assertIsNonEmptyString(messageId, 'payload.message.metadata.messageId is required');

            try {
                // Call the persistChannelMessage method
                await this.persistChannelMessage(channelMessage);
            } catch (error: any) {
                this.logger.error(`Error persisting message from event listener: ${error.message}`);
                
                // Create error payload data
                const errorPayloadData: MessagePersistFailedPayload = {
                    error: error.message, // Use the actual error message
                    originalMessage: channelMessage, // Use the original message
                    timestamp: Date.now(),
                    fromAgentId: channelMessage.senderId,
                    channelId: channelMessage.context?.channelId as ChannelId,
                    messageId: channelMessage.metadata.messageId 
                };
                
                // Create and emit error event using helper function
                const errorPayload = createMessagePersistFailedEventPayload(
                    Events.Message.MESSAGE_PERSIST_FAILED,
                    channelMessage.senderId, // Agent attempting the operation
                    channelMessage.context?.channelId as ChannelId,
                    errorPayloadData
                );
                
                this.eventBus.emit(Events.Message.MESSAGE_PERSIST_FAILED, errorPayload);
            }
        });

        // Example listener for a generic channel event that might lead to persistence or other actions
        // Note: 'message_posted' is defined in ChannelActionTypes in ChannelEvents.ts
        this.eventBus.on(Events.Channel.UPDATED as EventName, (payload: BaseEventPayload<ChannelEventData>) => {
            if (payload.data.action === 'message_posted') { 
                // Potentially trigger persistence or other logic if messages are posted via general channel updates
                // This would require the payload.data to contain full message details.
            }
        });

        // The bulk-persistence listener that lived here keyed off the string literal
        // 'PERSIST_BULK_CHANNEL_MESSAGES_REQUEST' — an event name that was never defined in
        // EventNames.ts, matched by a literal on the SDK side. The SDK now sends messages
        // through the normal Events.Message.CHANNEL_MESSAGE flow, which this service already
        // persists, so nothing emits the literal any more and the listener is removed.
        // Restoring a bulk path means defining a real Channel event and payload helper first.

        // Listen for agent join/leave events to manage channel MCP servers
        this.eventBus.on(Events.Channel.AGENT_JOINED, async (payload: any) => {
            try {
                const agentId = payload.agentId;
                const channelId = payload.channelId;

                // Notify ExternalMcpServerManager via ServerHybridMcpService
                const manager = ServerHybridMcpService.getExistingInstance()?.getExternalServerManager();
                if (manager) {
                    await manager.onAgentJoinChannel(agentId, channelId);
                }
            } catch (error) {
                this.logger.error(`Error handling agent join for MCP servers: ${error instanceof Error ? error.message : String(error)}`);
            }
        });

        this.eventBus.on(Events.Channel.AGENT_LEFT, async (payload: any) => {
            try {
                const agentId = payload.agentId;
                const channelId = payload.channelId;

                // Notify ExternalMcpServerManager via ServerHybridMcpService
                const manager = ServerHybridMcpService.getExistingInstance()?.getExternalServerManager();
                if (manager) {
                    await manager.onAgentLeaveChannel(agentId, channelId);
                }
            } catch (error) {
                this.logger.error(`Error handling agent leave for MCP servers: ${error instanceof Error ? error.message : String(error)}`);
            }
        });

        // Listen for channel MCP server registration events to persist to database
        // This runs alongside ExternalMcpServerManager's handler (which starts the process)
        const { McpEvents } = require('@mxf-dev/core/events/event-definitions/McpEvents');

        this.eventBus.on(McpEvents.CHANNEL_SERVER_REGISTER, async (payload: any) => {
            try {
                const channelId = payload.data?.channelId || payload.channelId;
                const serverConfig = payload.data;
                const agentId = payload.agentId;

                this.logger.info(`ChannelService handling CHANNEL_SERVER_REGISTER for ${serverConfig.id}`);

                // Re-registration refreshes the stored record instead of refusing.
                // The old warn-and-return kept stale config forever and made the
                // database claim "already registered" for servers whose runtime
                // record had been lost — re-registration is how clients recover
                // from exactly that state.
                const registeredAt = new Date();
                const refreshed = await Channel.updateOne(
                    {
                        channelId,
                        active: true,
                        'mcpServers.servers.id': serverConfig.id
                    },
                    {
                        $set: {
                            'mcpServers.servers.$.config': serverConfig,
                            'mcpServers.servers.$.registeredBy': agentId,
                            'mcpServers.servers.$.registeredAt': registeredAt,
                            'mcpServers.servers.$.keepAliveMinutes': serverConfig.keepAliveMinutes || 5,
                            'mcpServers.updatedAt': registeredAt
                        }
                    }
                );
                if (refreshed.matchedCount > 0) {
                    this.logger.info(`Server ${serverConfig.id} re-registered for channel ${channelId} — database record refreshed`);
                    return;
                }

                const inserted = await Channel.updateOne(
                    {
                        channelId,
                        active: true,
                        'mcpServers.servers.id': { $ne: serverConfig.id }
                    },
                    {
                        $push: {
                            'mcpServers.servers': {
                                id: serverConfig.id,
                                name: serverConfig.name,
                                config: serverConfig,
                                registeredBy: agentId,
                                registeredAt,
                                status: 'stopped',
                                keepAliveMinutes: serverConfig.keepAliveMinutes || 5
                            }
                        },
                        $set: { 'mcpServers.updatedAt': registeredAt }
                    }
                );
                if (inserted.matchedCount === 0) {
                    this.logger.warn(
                        `Ignored MCP server registration for missing, inactive, or concurrently changed channel ${channelId}`
                    );
                    return;
                }

                this.logger.info(`Channel ${channelId} saved with MCP server ${serverConfig.id}`);

            } catch (error) {
                this.logger.error(`Error persisting channel MCP server to database: ${error instanceof Error ? error.message : String(error)}`);
            }
        });

        // Listen for channel MCP server unregistration events to remove from database
        this.eventBus.on(McpEvents.CHANNEL_SERVER_UNREGISTER, async (payload: any) => {
            try {
                const channelId = payload.data?.channelId || payload.channelId;
                const serverId = payload.data?.serverId;

                this.logger.info(`ChannelService handling CHANNEL_SERVER_UNREGISTER for ${serverId}`);

                const result = await Channel.updateOne(
                    { channelId, active: true },
                    {
                        $pull: { 'mcpServers.servers': { id: serverId } },
                        $set: { 'mcpServers.updatedAt': new Date() }
                    }
                );
                if (result.matchedCount === 0) {
                    this.logger.warn(`Active channel ${channelId} not found during MCP unregistration`);
                    return;
                }

                this.logger.info(`Channel ${channelId} server ${serverId} removed`);

            } catch (error) {
                this.logger.error(`Error removing channel MCP server from database: ${error instanceof Error ? error.message : String(error)}`);
            }
        });

        // Listen for systemLlmEnabled changes to persist to database
        this.eventBus.on(ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED, async (payload: BaseEventPayload<ChannelSystemLlmChangeEvent>) => {
            try {
                const data = payload.data;
                const channelId = data?.channelId;

                // Only persist channel-specific changes (not global)
                if (!channelId) {
                    return;
                }

                // Update database. The stance rides along only when the change
                // set one, so an enabled/override change never clears it.
                const result = await Channel.updateOne(
                    { channelId, active: true },
                    {
                        $set: {
                            systemLlmEnabled: data.enabled,
                            ...(data.stance !== undefined ? { systemLlmStance: data.stance } : {})
                        }
                    }
                );

                if (result.modifiedCount > 0) {
                    this.logger.info(
                        `Channel ${channelId} systemLlmEnabled updated to ${data.enabled}` +
                        `${data.stance !== undefined ? `, systemLlmStance to ${data.stance}` : ''} in database`
                    );
                }
            } catch (error) {
                this.logger.error(`Error persisting systemLlmEnabled change: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }

    /**
     * Creates a new channel.
     * @param channelId Unique ID for the channel.
     * @param name Optional name for the channel.
     * @param createdBy Agent ID of the creator.
     * @param metadata Optional metadata for the channel.
     * @returns The created channel object or null if creation failed.
     */
    public async createChannel(channelId: ChannelId, name: string | undefined, createdBy: AgentId, metadata?: Record<string, any>): Promise<IChannel | null> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(createdBy, 'createdBy');

        if (isReservedChannelId(channelId)) {
            throw new Error(
                `Channel identity "${channelId}" is reserved for internal MXF routing; choose a different channelId.`
            );
        }

        // Check if channel already exists in memory
        if (this.channels.has(channelId)) {
            this.logger.warn(`Channel with ID ${channelId} already exists in memory.`);
            const existingChannel = this.channels.get(channelId);
            if (!existingChannel || !existingChannel.active ||
                String(existingChannel.metadata?.createdBy ?? '') !== String(createdBy)) {
                this.logger.warn(
                    `Rejected inactive or foreign-owned channel ${channelId} reuse by ${createdBy}`
                );
                return null;
            }
            return existingChannel;
        }

        // Check if channel exists in database first
        try {
            const existingChannel = await Channel.findOne({ channelId });
            if (existingChannel) {
                if (!existingChannel.active ||
                    String(existingChannel.createdBy) !== String(createdBy)) {
                    this.logger.warn(
                        `Rejected inactive or foreign-owned persisted channel ${channelId} reuse by ${createdBy}`
                    );
                    return null;
                }
                
                // Convert database document to IChannel interface
                const channelObj: IChannel = {
                    id: existingChannel.channelId,
                    name: existingChannel.name,
                    active: existingChannel.active,
                    createdAt: existingChannel.createdAt,
                    updatedAt: existingChannel.updatedAt,
                    metadata: {
                        ...(existingChannel.metadata || {}),
                        createdBy: String(existingChannel.createdBy)
                    }
                };
                
                // Add to in-memory store
                this.channels.set(channelId, channelObj);
                
                // Initialize participant tracking if not already done
                if (!this.channelParticipants.has(channelId)) {
                    this.channelParticipants.set(channelId, new Set(existingChannel.participants));
                }
                
                // Type assertion needed because Mongoose model type doesn't include schema extensions
                const channelDoc = existingChannel as any;
                const systemLlmEnabled = channelDoc.systemLlmEnabled !== false; // Default to true
                this.logger.debug(`[LOAD_CHANNEL] Channel ${channelId} systemLlmEnabled=${systemLlmEnabled}`);

                // Sync DB-persisted systemLlmEnabled to ConfigManager in-memory state.
                // Handles named sessions reconnecting to existing channels.
                ConfigManager.getInstance().setChannelSystemLlmEnabled(
                    systemLlmEnabled,
                    channelId,
                    systemLlmEnabled ? undefined : 'Channel loaded from DB with systemLlmEnabled=false'
                );
                hydrateChannelSystemLlmStance(channelId, channelDoc.systemLlmStance);

                // Install persisted policy synchronously before returning this
                // cold-loaded channel to an authenticating socket.
                McpService.getInstance().hydrateChannelAllowedTools(
                    channelId,
                    Array.isArray(channelDoc.allowedTools) ? channelDoc.allowedTools : []
                );
                
                return channelObj;
            }
        } catch (error) {
            this.logger.error(`Error checking for existing channel ${channelId}: ${error}`);
            // Continue with creation attempt
        }

        const now = new Date();
        const newChannel: IChannel = {
            id: channelId,
            name: name || `Channel ${channelId}`,
            active: true, 
            createdAt: now,
            updatedAt: now, 
            metadata: { ...(metadata || {}), createdBy: createdBy } 
        };

        // A requested stance must be a stance; refuse anything else before it is stored.
        const requestedStance: unknown = metadata?.systemLlmStance;
        if (requestedStance !== undefined && requestedStance !== null && !isSystemLlmStance(requestedStance)) {
            throw new Error(
                `Cannot create channel ${channelId}: invalid systemLlmStance '${String(requestedStance)}'. ` +
                `Expected one of: ${SYSTEMLLM_STANCES.join(', ')}`
            );
        }

        // Persist to database first
        try {
            const channelDoc = new Channel({
                channelId,
                name: newChannel.name,
                description: metadata?.description || '',
                createdBy: createdBy,
                participants: [],
                active: true,
                isPrivate: metadata?.isPrivate || false,
                metadata: newChannel.metadata,
                // New fields for channel-level access control
                allowedTools: metadata?.allowedTools || [],
                systemLlmEnabled: metadata?.systemLlmEnabled !== false, // Default to true
                // Absent means the channel follows the server's SYSTEMLLM_STANCE.
                ...(requestedStance ? { systemLlmStance: requestedStance } : {})
            });
            await channelDoc.save();
        } catch (error) {
            // Check if this is a duplicate key error
            if (error instanceof Error && error.message.includes('E11000 duplicate key')) {
                this.logger.warn(`Channel ${channelId} already exists in database (duplicate key), attempting to load existing channel.`);
                
                // Try to load the existing channel
                try {
                    const existingChannel = await Channel.findOne({ channelId });
                    if (existingChannel) {
                        // Close the post-preflight race: another owner may have
                        // won the unique insert after the caller observed 404.
                        if (!existingChannel.active ||
                            String(existingChannel.createdBy) !== String(createdBy)) {
                            this.logger.warn(
                                `Rejected inactive or foreign-owned raced channel ${channelId} reuse by ${createdBy}`
                            );
                            return null;
                        }
                        const channelObj: IChannel = {
                            id: existingChannel.channelId,
                            name: existingChannel.name,
                            active: existingChannel.active,
                            createdAt: existingChannel.createdAt,
                            updatedAt: existingChannel.updatedAt,
                            metadata: {
                                ...(existingChannel.metadata || {}),
                                createdBy: String(existingChannel.createdBy)
                            }
                        };
                        
                        // Add to in-memory store
                        this.channels.set(channelId, channelObj);
                        
                        // Initialize participant tracking
                        if (!this.channelParticipants.has(channelId)) {
                            this.channelParticipants.set(channelId, new Set(existingChannel.participants));
                        }

                        // Sync systemLlmEnabled from existing DB document to ConfigManager
                        const existingSystemLlmEnabled = (existingChannel as any).systemLlmEnabled !== false;
                        ConfigManager.getInstance().setChannelSystemLlmEnabled(
                            existingSystemLlmEnabled,
                            channelId,
                            existingSystemLlmEnabled ? undefined : 'Channel loaded from DB (dup key recovery) with systemLlmEnabled=false'
                        );
                        hydrateChannelSystemLlmStance(channelId, existingChannel.systemLlmStance);

                        McpService.getInstance().hydrateChannelAllowedTools(
                            channelId,
                            Array.isArray(existingChannel.allowedTools)
                                ? existingChannel.allowedTools
                                : []
                        );

                        return channelObj;
                    }
                } catch (loadError) {
                    this.logger.error(`Failed to load existing channel ${channelId}: ${loadError}`);
                }
            } else {
                this.logger.error(`Failed to persist channel ${channelId} to database: ${error}`);
            }
            return null;
        }

        // Add to in-memory store
        this.channels.set(channelId, newChannel);
        
        // Initialize participant tracking
        if (!this.channelParticipants.has(channelId)) {
            this.channelParticipants.set(channelId, new Set());
        }
        
        // Cache the already-persisted policy without writing it back.
        const channelAllowedTools = metadata?.allowedTools || [];
        McpService.getInstance().hydrateChannelAllowedTools(
            channelId,
            channelAllowedTools
        );
        
        // Log systemLlmEnabled setting (stored in MongoDB channel document)
        const systemLlmEnabled = metadata?.systemLlmEnabled !== false; // Default to true
        this.logger.info(`[CREATE_CHANNEL] Channel ${channelId} systemLlmEnabled=${systemLlmEnabled}`);

        // Sync systemLlmEnabled to ConfigManager in-memory state so SystemLlmService guards work.
        // Without this, ConfigManager.isChannelSystemLlmEnabled() falls through to global default (true).
        ConfigManager.getInstance().setChannelSystemLlmEnabled(
            systemLlmEnabled,
            channelId,
            systemLlmEnabled ? undefined : 'Channel created with systemLlmEnabled=false'
        );
        hydrateChannelSystemLlmStance(channelId, requestedStance ?? undefined);
        if (requestedStance) {
            this.logger.info(`[CREATE_CHANNEL] Channel ${channelId} systemLlmStance=${String(requestedStance)}`);
        }

        this.notifyChannelEvent(Events.Channel.CREATED as EventName, {
            action: 'created', 
            channelId: newChannel.id,
            name: newChannel.name,
            metadata: { 
                ...newChannel.metadata,
                createdBy: createdBy, 
                createdAt: newChannel.createdAt.toISOString() 
            }
        }, createdBy); 

        return newChannel;
    }

    /**
     * Deletes a channel.
     * @param channelId The ID of the channel to delete.
     * @param agentId The ID of the agent performing the deletion.
     * @param reason Optional reason for deletion.
     * @returns True if the channel was deleted, false otherwise.
     */
    public async deleteChannel(channelId: ChannelId, agentId: AgentId, reason?: string): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(agentId, 'agentId');

        // The normal entry point is owner-only even when called outside HTTP.
        // Administrators use the explicitly verified method below.
        return this.deleteAuthorizedChannel(
            channelId,
            agentId,
            reason,
            { createdBy: agentId }
        );
    }

    /** Delete another owner's channel only after verifying a live admin account. */
    public async deleteChannelAsAdministrator(
        channelId: ChannelId,
        administratorId: AgentId,
        reason?: string
    ): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(administratorId, 'administratorId');

        const administrator = await User.exists({
            _id: administratorId,
            role: UserRole.ADMIN,
            isActive: true
        });
        if (!administrator) {
            throw new Error('An active administrator is required to delete another owner\'s channel');
        }

        return this.deleteAuthorizedChannel(channelId, administratorId, reason, {});
    }

    /**
     * Authoritative, retryable deletion implementation. The supplied owner
     * predicate is either the exact caller owner or an empty filter reached
     * only through the database-verified administrator entry point.
     */
    private async deleteAuthorizedChannel(
        channelId: ChannelId,
        agentId: AgentId,
        reason: string | undefined,
        ownershipFilter: { createdBy?: string }
    ): Promise<boolean> {
        let deactivatedChannel: unknown;

        try {
            // Persistence is the authoritative lifecycle boundary. The unique
            // channelId document is retained as an inactive tombstone so the id
            // can never be recreated by another owner. Nothing else is cleaned
            // up until this fail-closed state has committed.
            const deletedAt = new Date();
            const deletionFields: Record<string, unknown> = {
                active: false,
                systemLlmEnabled: false,
                participants: [],
                updatedAt: deletedAt,
                'metadata.deletedBy': agentId,
                'metadata.deletedAt': deletedAt.toISOString(),
                'metadata.deletionCleanupStatus': 'pending',
                'metadata.deletionCleanupFailures': []
            };
            if (reason !== undefined) {
                deletionFields['metadata.deletionReason'] = reason;
            }

            deactivatedChannel = await Channel.findOneAndUpdate(
                { channelId, active: true, ...ownershipFilter },
                { $set: deletionFields },
                { new: true }
            );
            if (!deactivatedChannel) {
                // A previous attempt may already have committed the tombstone
                // before a cleanup failed. Re-enter that exact pending state;
                // every cleanup below is intentionally idempotent.
                deactivatedChannel = await Channel.findOne({
                    channelId,
                    active: false,
                    'metadata.deletionCleanupStatus': 'pending',
                    ...ownershipFilter
                });
                if (!deactivatedChannel) {
                    this.logger.warn(
                        `Attempted to delete missing, unauthorized, or completed channel ${channelId}.`
                    );
                    this.emitChannelDeleteFailure(
                        channelId,
                        agentId,
                        'Channel not found, not owned by caller, or already deleted'
                    );
                    return false;
                }
            }

            const cleanupFailures: string[] = [];
            const runCleanup = async (
                label: string,
                cleanup: () => void | Promise<void>
            ): Promise<void> => {
                try {
                    await cleanup();
                } catch (error) {
                    cleanupFailures.push(label);
                    this.logger.error(
                        `Channel ${channelId} ${label} cleanup failed: ` +
                        `${error instanceof Error ? error.message : String(error)}`
                    );
                }
            };

            // Remove synchronous authorization/runtime state immediately after
            // persistence is inactive. These guards stay disabled because the
            // channel id tombstone can never be reused.
            await runCleanup('SystemLLM policy', () => {
                ConfigManager.getInstance().setChannelSystemLlmEnabled(
                    false,
                    channelId,
                    'Channel deleted'
                );
            });
            await runCleanup('MCP tool policy', () => {
                McpService.getInstance().clearChannelAllowedTools(channelId);
            });
            await runCleanup('SystemLLM service', () => {
                SystemLlmServiceManager.getInstance().removeServiceForChannel(channelId);
            });

            // Clear local channel state before disconnect handlers run. Their
            // idempotent participant cleanup must not be able to revive it.
            this.channels.delete(channelId);
            this.channelParticipants.delete(channelId);

            await runCleanup('credential revocation', async () => {
                await channelKeyService.deactivateChannelKeys(channelId);
            });
            await runCleanup('socket eviction', () => {
                this.disconnectChannelSockets(channelId);
            });
            await runCleanup('MCP runtime', async () => {
                await this.retireChannelMcpRuntime(channelId);
            });

            if (cleanupFailures.length > 0) {
                // Keep the durable retry marker and make failure explicit to
                // every caller. No successful lifecycle event is emitted while
                // live credentials, sockets, or processes may remain.
                try {
                    await Channel.updateOne(
                        {
                            channelId,
                            active: false,
                            'metadata.deletionCleanupStatus': 'pending',
                            ...ownershipFilter
                        },
                        {
                            $set: {
                                'metadata.deletionCleanupFailures': cleanupFailures,
                                'metadata.deletionCleanupUpdatedAt': new Date().toISOString()
                            }
                        }
                    );
                } catch (error) {
                    cleanupFailures.push('cleanup status persistence');
                    this.logger.error(
                        `Failed to persist deletion cleanup state for ${channelId}: ` +
                        `${error instanceof Error ? error.message : String(error)}`
                    );
                }

                const cleanupError = new ChannelDeletionCleanupError(channelId, cleanupFailures);
                this.emitChannelDeleteFailure(channelId, agentId, cleanupError.message);
                throw cleanupError;
            }

            // Atomically win completion before emitting. Concurrent retries can
            // perform idempotent cleanup, but only one transitions pending to
            // completed and therefore only one emits CHANNEL_DELETED.
            const finalized = await Channel.findOneAndUpdate(
                {
                    channelId,
                    active: false,
                    'metadata.deletionCleanupStatus': 'pending',
                    ...ownershipFilter
                },
                {
                    $set: {
                        'metadata.deletionCleanupStatus': 'completed',
                        'metadata.deletionCleanupFailures': [],
                        'metadata.deletionCleanupUpdatedAt': new Date().toISOString()
                    }
                },
                { new: true }
            );
            if (finalized) {
                const deletedPayload = createChannelEventPayload(
                    Events.Channel.DELETED,
                    agentId,
                    channelId,
                    {
                        action: 'delete' as ChannelActionType,
                        channelId
                    }
                );
                this.eventBus.emit(Events.Channel.DELETED, deletedPayload);
            }

            return true;
        } catch (error) {
            if (error instanceof ChannelDeletionCleanupError) {
                throw error;
            }
            this.logger.error(`Error deleting channel ${channelId}: ${error}`);
            this.emitChannelDeleteFailure(
                channelId,
                agentId,
                error instanceof Error ? error.message : String(error)
            );
            throw error;
        }
    }

    private emitChannelDeleteFailure(
        channelId: ChannelId,
        agentId: AgentId,
        error: string
    ): void {
        const failedPayload = createChannelEventPayload(
            Events.Channel.DELETE_FAILED,
            agentId,
            channelId,
            {
                action: 'delete' as ChannelActionType,
                channelId,
                error
            }
        );
        this.eventBus.emit(Events.Channel.DELETE_FAILED, failedPayload);
    }

    /** Disconnect every socket authenticated into one exact channel. */
    private disconnectChannelSockets(channelId: ChannelId): number {
        const sockets = this.io.sockets?.sockets;
        const matchingSockets = sockets
            ? Array.from(sockets.values()).filter(socket => socket.data?.channelId === channelId)
            : [];
        const failures: string[] = [];

        for (const socket of matchingSockets) {
            try {
                socket.disconnect(true);
            } catch (error) {
                failures.push(socket.id);
                this.logger.error(
                    `Failed to disconnect socket ${socket.id} from deleted channel ${channelId}: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // Also evict any room member whose legacy socket data was incomplete.
        // The normalized room is exact, so no other channel is affected.
        this.io.in(`channel:${channelId}`).disconnectSockets(true);

        if (failures.length > 0) {
            throw new Error(`Failed to disconnect ${failures.length} channel socket(s)`);
        }
        return matchingSockets.length;
    }

    /** Stop channel MCP processes and remove their persisted configuration. */
    private async retireChannelMcpRuntime(channelId: ChannelId): Promise<void> {
        const hybridService = ServerHybridMcpService.getExistingInstance();
        if (hybridService) {
            await hybridService.getExternalServerManager().retireChannel(channelId);
        }

        const result = await Channel.updateOne(
            { channelId, active: false },
            {
                $set: {
                    'mcpServers.servers': [],
                    'mcpServers.updatedAt': new Date()
                }
            }
        );
        if (result.matchedCount !== 1) {
            throw new Error(`Inactive channel ${channelId} disappeared during MCP cleanup`);
        }
    }

    /**
     * Archives a channel.
     * @param channelId The ID of the channel to archive.
     * @param agentId The ID of the agent performing the archival.
     * @param reason Optional reason for archival.
     * @returns True if the channel was archived, false otherwise.
     */
    public async archiveChannel(channelId: ChannelId, agentId: AgentId, reason?: string): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(agentId, 'agentId');

        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                this.logger.warn(`Attempted to archive non-existent channel ${channelId}.`);
                
                // Emit archive failed event
                const failedPayload = createChannelEventPayload(
                    Events.Channel.ARCHIVE_FAILED,
                    agentId,
                    channelId,
                    {
                        action: 'archive' as ChannelActionType,
                        channelId,
                        error: 'Channel not found'
                    }
                );
                this.eventBus.emit(Events.Channel.ARCHIVE_FAILED, failedPayload);
                return false;
            }

            // Update channel in memory
            const archiveMetadata = {
                archivedBy: agentId,
                archivedAt: new Date().toISOString(),
                archiveReason: reason,
                wasActive: channel.active
            };

            channel.active = false;
            channel.updatedAt = new Date();
            if (channel.metadata) {
                channel.metadata = { ...channel.metadata, ...archiveMetadata };
            } else {
                channel.metadata = archiveMetadata;
            }

            // Keep in memory but marked as archived (unlike delete which removes from memory)
            this.channels.set(channelId, channel);

            // Update in database
            try {
                await Channel.findOneAndUpdate(
                    { channelId, active: true },
                    { 
                        active: false,
                        updatedAt: new Date(),
                        $set: {
                            'metadata.archivedBy': agentId,
                            'metadata.archivedAt': new Date().toISOString(),
                            'metadata.archiveReason': reason,
                            'metadata.wasActive': channel.active
                        }
                    }
                );
            } catch (dbError) {
                this.logger.error(`Failed to update channel ${channelId} in database: ${dbError}`);
            }


            // Emit channel archived event
            const archivedPayload = createChannelEventPayload(
                Events.Channel.ARCHIVED,
                agentId,
                channelId,
                {
                    action: 'archive' as ChannelActionType,
                    channelId,
                    metadata: archiveMetadata
                }
            );
            this.eventBus.emit(Events.Channel.ARCHIVED, archivedPayload);
            
            return true;
        } catch (error) {
            this.logger.error(`Error archiving channel ${channelId}: ${error}`);
            
            // Emit archive failed event
            const failedPayload = createChannelEventPayload(
                Events.Channel.ARCHIVE_FAILED,
                agentId,
                channelId,
                {
                    action: 'archive' as ChannelActionType,
                    channelId,
                    error: error instanceof Error ? error.message : String(error)
                }
            );
            this.eventBus.emit(Events.Channel.ARCHIVE_FAILED, failedPayload);
            return false;
        }
    }

    /**
     * Adds a participant to a channel.
     * @param channelId The ID of the channel.
     * @param participantId The ID of the participant to add.
     * @param agentId The ID of the agent performing the action (e.g., an admin or the participant themselves).
     * @returns True if the participant was added, false otherwise.
     */
    public async addParticipant(channelId: ChannelId, participantId: AgentId, agentId: AgentId): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(participantId, 'participantId');
        this.validator.assertIsNonEmptyString(agentId, 'agentId');

        let channel = this.channels.get(channelId);
        
        // If channel not in memory, try to load from database
        if (!channel) {
            //;
            try {
                const channelDoc = await Channel.findOne({ channelId, active: true });
                if (channelDoc) {
                    // Load channel into memory from database
                    channel = {
                        id: channelDoc.channelId,
                        name: channelDoc.name,
                        active: channelDoc.active,
                        createdAt: channelDoc.createdAt,
                        updatedAt: channelDoc.updatedAt,
                        metadata: {
                            description: channelDoc.description || '',
                            participants: channelDoc.participants || [],
                            isPrivate: channelDoc.isPrivate || false,
                            createdBy: channelDoc.createdBy
                        }
                    };
                    this.channels.set(channelId, channel);

                    // Sync systemLlmEnabled from DB to ConfigManager when loading channel in addParticipant
                    const participantSystemLlmEnabled = (channelDoc as any).systemLlmEnabled !== false;
                    ConfigManager.getInstance().setChannelSystemLlmEnabled(
                        participantSystemLlmEnabled,
                        channelId,
                        participantSystemLlmEnabled ? undefined : 'Channel loaded in addParticipant with systemLlmEnabled=false'
                    );
                    hydrateChannelSystemLlmStance(channelId, channelDoc.systemLlmStance);

                    McpService.getInstance().hydrateChannelAllowedTools(
                        channelId,
                        Array.isArray(channelDoc.allowedTools) ? channelDoc.allowedTools : []
                    );
                } else {
                    this.logger.error(`Channel ${channelId} does not exist in database.`);
                    return false;
                }
            } catch (error) {
                this.logger.error(`Failed to load channel ${channelId} from database: ${error}`);
                return false;
            }
        }

        if (!channel || !channel.active) {
            this.logger.error(`Channel ${channelId} is inactive or does not exist.`);
            return false;
        }


        // Add participant to in-memory store
        if (!this.channelParticipants.has(channelId)) {
            this.channelParticipants.set(channelId, new Set<AgentId>());
        }
        this.channelParticipants.get(channelId)?.add(participantId);

        // Add participant to database using atomic operation
        try {
            // Use atomic $addToSet operation to avoid version conflicts and duplicates
            const result = await Channel.findOneAndUpdate(
                { channelId, active: true },
                { 
                    $addToSet: { participants: participantId },
                    $set: { lastActive: new Date() }
                },
                { new: true }
            );
            
            if (!result) {
                this.logger.error(`Channel ${channelId} unexpectedly missing from database.`);
                return false;
            }
        } catch (error) {
            this.logger.error(`Failed to persist participant ${participantId} to channel ${channelId}: ${error}`);
            return false;
        }

        this.notifyChannelEvent(Events.Channel.AGENT_JOINED as EventName, { 
            action: ChannelActionTypes.JOIN, 
            channelId: channelId,
            targetAgentId: participantId, 
            metadata: { addedBy: agentId }
        }, agentId); 
        return true;
    }

    /**
     * Removes a participant from a channel.
     * @param channelId The ID of the channel.
     * @param participantId The ID of the participant to remove.
     * @param agentId The ID of the agent performing the action.
     * @returns True if the participant was removed, false otherwise.
     */
    public async removeParticipant(channelId: ChannelId, participantId: AgentId, agentId: AgentId): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(participantId, 'participantId');
        this.validator.assertIsNonEmptyString(agentId, 'agentId');

        const channel = this.channels.get(channelId);
        if (channel) {

            // Remove participant from in-memory store
            let remainingAgents = 0;
            if (this.channelParticipants.has(channelId)) {
                this.channelParticipants.get(channelId)?.delete(participantId);
                remainingAgents = this.channelParticipants.get(channelId)?.size || 0;
            }

            // Remove participant from database using atomic operation
            try {
                // Use atomic $pull operation to avoid version conflicts
                const result = await Channel.findOneAndUpdate(
                    { channelId, active: true },
                    { 
                        $pull: { participants: participantId },
                        $set: { lastActive: new Date() }
                    },
                    { new: true }
                );
                
                if (!result) {
                    this.logger.warn(`Channel ${channelId} not found in database when removing participant ${participantId}`);
                }
            } catch (error) {
                this.logger.error(`Failed to remove participant ${participantId} from channel ${channelId}: ${error}`);
            }

            // Emit AGENT_LEFT event with remaining agents count
            const agentLeftPayload = createChannelEventPayload(
                Events.Channel.AGENT_LEFT,
                agentId,
                channelId,
                {
                    action: ChannelActionTypes.LEAVE,
                    channelId: channelId,
                    targetAgentId: participantId,
                    metadata: { 
                        removedBy: agentId,
                        remainingAgents 
                    }
                }
            );
            this.eventBus.emit(Events.Channel.AGENT_LEFT, agentLeftPayload); 
            return true;
        }
        this.logger.warn(`Attempted to remove participant from non-existent channel ${channelId}.`);
        return false;
    }

    /**
     * Register a channel-scoped MCP server
     * @param channelId Channel ID
     * @param serverConfig Server configuration
     * @param agentId Agent ID performing the registration
     * @returns Promise resolving to success status and tools discovered
     */
    public async registerChannelMcpServer(
        channelId: ChannelId,
        serverConfig: any,
        agentId: AgentId
    ): Promise<{ success: boolean; toolsDiscovered?: string[] }> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(agentId, 'agentId');

        const registeredAt = new Date();
        const serverRecord = {
            id: serverConfig.id,
            name: serverConfig.name,
            config: serverConfig,
            registeredBy: agentId,
            registeredAt,
            status: 'stopped',
            keepAliveMinutes: serverConfig.keepAliveMinutes || 5
        };
        const result = await Channel.updateOne(
            {
                channelId,
                active: true,
                'mcpServers.servers.id': { $ne: serverConfig.id }
            },
            {
                $push: { 'mcpServers.servers': serverRecord },
                $set: { 'mcpServers.updatedAt': registeredAt }
            }
        );

        if (result.matchedCount === 0) {
            const activeChannel = await Channel.exists({ channelId, active: true });
            if (!activeChannel) {
                throw new Error(`Channel ${channelId} not found or inactive`);
            }
            throw new Error(`Server ${serverConfig.id} already registered for channel ${channelId}`);
        }

        this.logger.info(`Channel ${channelId} saved with MCP server ${serverConfig.id}`);

        return { success: true };
    }

    /**
     * Get channel-scoped MCP servers
     * @param channelId Channel ID
     * @returns List of channel MCP servers
     */
    public async getChannelMcpServers(channelId: ChannelId): Promise<any[]> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');

        const channel = await Channel.findOne({ channelId, active: true });

        this.logger.debug(`Getting MCP servers for channel ${channelId}`);
        this.logger.debug(`Channel found: ${!!channel}`);
        this.logger.debug(`Channel has mcpServers: ${!!channel?.mcpServers}`);
        this.logger.debug(`Servers count: ${channel?.mcpServers?.servers?.length || 0}`);

        if (!channel || !channel.mcpServers) {
            return [];
        }

        return channel.mcpServers.servers || [];
    }

    /**
     * Unregister a channel-scoped MCP server
     * @param channelId Channel ID
     * @param serverId Server ID
     * @param agentId Agent ID performing the unregistration
     * @returns Promise resolving to true if successful
     */
    public async unregisterChannelMcpServer(
        channelId: ChannelId,
        serverId: string,
        agentId: AgentId
    ): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(serverId, 'serverId');

        const result = await Channel.updateOne(
            { channelId, active: true, 'mcpServers.servers.id': serverId },
            {
                $pull: { 'mcpServers.servers': { id: serverId } },
                $set: { 'mcpServers.updatedAt': new Date() }
            }
        );
        if (result.matchedCount === 0) {
            throw new Error(
                `Active channel ${channelId} not found or has no MCP server ${serverId}`
            );
        }

        this.logger.info(`Channel ${channelId} server ${serverId} removed from database`);

        return true;
    }

    /** Persist one canonical history record before reporting success to the caller. */
    private async persistChannelMessage(message: ChannelMessage): Promise<ChannelMessage> {
        const channelId = message.context.channelId;
        const historyMessage = normalizeChannelHistoryMessage(message, channelId);
        await firstValueFrom(this.channelMessageOperations.addMessage(channelId, historyMessage));
        // Channel activity remains channel metadata; history lives only in ChannelMemory.
        await Channel.updateOne({ channelId, active: true }, { $set: { lastActive: new Date() } });
        return message;
    }

    /** Persist a channel message, then publish it through the ordinary EventBus route. */
    public async sendMessage(
        channelId: ChannelId,
        messageId: string,
        fromAgentId: AgentId,
        content: ChannelMessage['content']['data'],
        messageType: string = 'text',
        clientTimestamp?: number,
        metadata?: Partial<MessageMetadata>
    ): Promise<ChannelMessage> {
        const message = createChannelMessage(channelId, fromAgentId, content, {
            format: messageType === 'json' ? ContentFormat.JSON
                : messageType === 'binary' || Buffer.isBuffer(content) ? ContentFormat.BINARY
                    : messageType === 'base64' ? ContentFormat.BASE64 : undefined,
            metadata: {
                ...metadata,
                messageId,
                timestamp: metadata?.timestamp ?? clientTimestamp ?? Date.now()
            },
            context: { messageType }
        });
        try {
            await this.persistChannelMessage(message);
            // The normal listener may append again. Canonical message-ID dedupe
            // makes that persistence attempt idempotent; only this event is sent.
            this.eventBus.emit(Events.Message.CHANNEL_MESSAGE, createChannelMessageEventPayload(
                Events.Message.CHANNEL_MESSAGE, fromAgentId, message
            ));
            return message;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error sending message in channel ${channelId}: ${errorMessage}`);
            this.eventBus.emit(Events.Message.MESSAGE_SEND_FAILED, createMessageSendFailedEventPayload(
                Events.Message.MESSAGE_SEND_FAILED, fromAgentId, channelId,
                { error: errorMessage, originalMessage: message, timestamp: Date.now(), fromAgentId, channelId, messageId }
            ));
            throw error;
        }
    }

    /** Append a validated batch to canonical history without changing its raw content. */
    public persistChannelMessagesBulk = async (channelId: ChannelId, messages: ChannelMessage[]): Promise<void> => {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('Messages array is required and must not be empty');
            }
            const convertedMessages = messages.map(message => normalizeChannelHistoryMessage(message, channelId));
            await firstValueFrom(this.channelMessageOperations.addMessages(channelId, convertedMessages));
            await Channel.updateOne({ channelId, active: true }, { $set: { lastActive: new Date() } });
            this.eventBus.emit(Events.Channel.BULK_MESSAGES_PERSISTED, createChannelEventPayload(
                Events.Channel.BULK_MESSAGES_PERSISTED, convertedMessages[0].senderId, channelId,
                {
                    action: 'updated', channelId, messageCount: messages.length,
                    messageIds: convertedMessages.map(message => message.messageId)
                }
            ));
        } catch (error) {
            this.logger.error(`Failed to persist message batch to channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    };

    /**
     * Notifies relevant parties about a channel event.
     * @param eventType The type of channel event.
     * @param data The data associated with the event.
     * @param agentId The ID of the agent performing the action (required).
     */
    private notifyChannelEvent(eventType: EventName, data: ChannelEventData, agentId: AgentId): void {
        this.validator.assert(!!data, 'data for notifyChannelEvent cannot be null');
        this.validator.assert(!!data.channelId, 'data.channelId is required for notifyChannelEvent');
        this.validator.assert(!!data.action, 'data.action is required for notifyChannelEvent'); 
        this.validator.assertIsNonEmptyString(agentId, 'agentId is required for notifyChannelEvent');

        // Create channel event payload using helper function
        const payload = createChannelEventPayload(
            eventType,
            agentId, 
            data.channelId,
            data
        );
        
        this.eventBus.emit(eventType, payload);
    }

    /**
     * Handles errors by logging them and optionally notifying via event bus.
     * @param channelId The ID of the channel (optional).
     * @param agentId The ID of the agent performing the action (optional).
     * @param eventType The type of error event.
     * @param message The error message.
     * @param error The error object (optional).
     * @param details Additional details for the error (optional).
     */
    private handleError(channelId: ChannelId | undefined, agentId: AgentId | undefined, eventType: EventName, message: string, error?: any, details?: Record<string, any>): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`${message}: ${errorMessage}`, details ? JSON.stringify(details) : '');

        if (channelId && agentId) { 
            // Create channel event data for error
            // Note: 'error' is defined in ChannelActionTypes in ChannelEvents.ts
            const errorData: ChannelEventData = {
                action: 'error' as ChannelActionType,
                error: message, 
                errorMessage: errorMessage, 
                details: details,
                channelId: channelId 
            };
            
            // Create error payload using helper function
            const errorPayload = createChannelEventPayload(
                eventType,
                agentId, 
                channelId,
                errorData
            );
            
            this.eventBus.emit(eventType, errorPayload);
        } else {
            this.logger.warn(`Cannot emit error event ${eventType} due to missing channelId or agentId.`);
        }
    }

    /**
     * Get participants in a channel
     * @param channelId The ID of the channel
     * @returns Array of participant agent IDs
     */
    public getChannelParticipants(channelId: ChannelId): AgentId[] {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        
        const participants = this.channelParticipants.get(channelId);
        return participants ? Array.from(participants) : [];
    }

    /**
     * Check if an agent is a participant in a channel
     * @param channelId The ID of the channel
     * @param agentId The ID of the agent
     * @returns True if the agent is a participant
     */
    public isParticipant(channelId: ChannelId, agentId: AgentId): boolean {
        this.validator.assertIsNonEmptyString(channelId, 'channelId');
        this.validator.assertIsNonEmptyString(agentId, 'agentId');
        
        const participants = this.channelParticipants.get(channelId);
        return participants ? participants.has(agentId) : false;
    }
}
