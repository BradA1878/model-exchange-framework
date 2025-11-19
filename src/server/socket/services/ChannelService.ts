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

import { EventEmitter } from 'events';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { ServerEventBus } from '../../../shared/events/ServerEventBus';
import { EventName, ChannelActionTypes, ChannelActionType } from '../../../shared/events/EventNames';
import { MessagePersistFailedPayload, MessageSendFailedPayload } from '../../../shared/events/event-definitions/MessageEvents';
import { ChannelEventData, MessageEventData, BaseEventPayload, createMessageEventPayload, createMessagePersistFailedEventPayload, createMessageSendFailedEventPayload, createChannelEventPayload, createChannelMessageEventPayload } from '../../../shared/schemas/EventPayloadSchema'; 
import { ChannelMessage, ContentFormat, MessageMetadata, ContentWrapper, createChannelMessage } from '../../../shared/schemas/MessageSchemas'; 
import { ChannelId, AgentId } from '../../../shared/types/ChannelContext';
import { ChannelContextMessageOperations } from '../../../shared/services/ChannelContextMessageOperations';
import { Server } from 'socket.io'; 
import { IChannel } from '../../../shared/interfaces/Channel'; 
import { lastValueFrom } from 'rxjs';
import { Channel } from '../../../shared/models/channel';

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
                    agentMessage.content,            // content (3rd parameter)
                    {
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
            this.validator.assert(channelMessage.content?.data !== undefined, 'payload.message.content.data is required');
            this.validator.assert(!!channelMessage.metadata, 'payload.message.metadata is required');
            const messageId = channelMessage.metadata?.messageId;
            this.validator.assertIsNonEmptyString(messageId, 'payload.message.metadata.messageId is required');

            try {
                // Call the persistChannelMessage method
                await this.persistChannelMessage(
                    channelId,                                  // channelId
                    messageId,                                  // messageId
                    channelMessage.senderId,                    // fromAgentId (sender)
                    channelMessage.content.data,                // content
                    channelMessage.senderId,                    // agentId (assuming sender persists their own message here)
                    channelMessage.metadata,                    // metadata
                    payload.timestamp,                          // clientTimestamp
                    'text'                                      // messageType (channel messages are 'text' type)
                );
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
        // TODO: Define 'message_posted' as a valid ChannelActionType in ChannelEventData schema
        this.eventBus.on(Events.Channel.UPDATED as EventName, (payload: BaseEventPayload<ChannelEventData>) => { 
            if ((payload.data.action as string) === 'message_posted') { 
                // Potentially trigger persistence or other logic if messages are posted via general channel updates
                // This would require the payload.data to contain full message details.
            }
        });

        // Listen for bulk message persistence requests
        this.eventBus.on('PERSIST_BULK_CHANNEL_MESSAGES_REQUEST', async (payload: any) => {
            try {
                this.validator.assert(!!payload, 'Bulk persistence payload cannot be null');
                this.validator.assert(!!payload.data, 'payload.data is required');
                this.validator.assert(Array.isArray(payload.data.messages), 'payload.data.messages must be an array');
                this.validator.assertIsNonEmptyString(payload.data.channelId, 'payload.data.channelId is required');

                const { channelId, messages } = payload.data;

                await this.persistChannelMessagesBulk(channelId, messages);
                
                
            } catch (error) {
                this.logger.error(`Error processing bulk message persistence: ${error instanceof Error ? error.message : String(error)}`);
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

        // Check if channel already exists in memory
        if (this.channels.has(channelId)) {
            this.logger.warn(`Channel with ID ${channelId} already exists in memory.`);
            return this.channels.get(channelId) || null;
        }

        // Check if channel exists in database first
        try {
            const existingChannel = await Channel.findOne({ channelId });
            if (existingChannel) {
                
                // Convert database document to IChannel interface
                const channelObj: IChannel = {
                    id: existingChannel.channelId,
                    name: existingChannel.name,
                    active: existingChannel.active,
                    createdAt: existingChannel.createdAt,
                    updatedAt: existingChannel.updatedAt,
                    metadata: existingChannel.metadata || {}
                };
                
                // Add to in-memory store
                this.channels.set(channelId, channelObj);
                
                // Initialize participant tracking if not already done
                if (!this.channelParticipants.has(channelId)) {
                    this.channelParticipants.set(channelId, new Set(existingChannel.participants));
                }
                
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
                metadata: newChannel.metadata
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
                        const channelObj: IChannel = {
                            id: existingChannel.channelId,
                            name: existingChannel.name,
                            active: existingChannel.active,
                            createdAt: existingChannel.createdAt,
                            updatedAt: existingChannel.updatedAt,
                            metadata: existingChannel.metadata || {}
                        };
                        
                        // Add to in-memory store
                        this.channels.set(channelId, channelObj);
                        
                        // Initialize participant tracking
                        if (!this.channelParticipants.has(channelId)) {
                            this.channelParticipants.set(channelId, new Set(existingChannel.participants));
                        }
                        
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

        try {
            const channel = this.channels.get(channelId);
            if (!channel) {
                this.logger.warn(`Attempted to delete non-existent channel ${channelId}.`);
                
                // Emit delete failed event
                const failedPayload = createChannelEventPayload(
                    Events.Channel.DELETE_FAILED,
                    agentId,
                    channelId,
                    {
                        action: 'delete' as ChannelActionType,
                        channelId,
                        error: 'Channel not found'
                    }
                );
                this.eventBus.emit(Events.Channel.DELETE_FAILED, failedPayload);
                return false;
            }

            // Update channel in memory
            channel.active = false;
            channel.updatedAt = new Date();
            if (channel.metadata) {
                channel.metadata.deletedBy = agentId;
                channel.metadata.deletedAt = channel.updatedAt.toISOString();
                if (reason) {
                    channel.metadata.deletionReason = reason;
                }
            }

            // Remove from in-memory store
            this.channels.delete(channelId);
            this.channelParticipants.delete(channelId);

            // Update in database
            try {
                await Channel.findOneAndUpdate(
                    { channelId },
                    { 
                        active: false,
                        updatedAt: new Date(),
                        $set: {
                            'metadata.deletedBy': agentId,
                            'metadata.deletedAt': new Date().toISOString(),
                            'metadata.deletionReason': reason
                        }
                    }
                );
            } catch (dbError) {
                this.logger.error(`Failed to update channel ${channelId} in database: ${dbError}`);
            }


            // Emit channel deleted event
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
            
            return true;
        } catch (error) {
            this.logger.error(`Error deleting channel ${channelId}: ${error}`);
            
            // Emit delete failed event
            const failedPayload = createChannelEventPayload(
                Events.Channel.DELETE_FAILED,
                agentId,
                channelId,
                {
                    action: 'delete' as ChannelActionType,
                    channelId,
                    error: error instanceof Error ? error.message : String(error)
                }
            );
            this.eventBus.emit(Events.Channel.DELETE_FAILED, failedPayload);
            return false;
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
                    { channelId },
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
                const channelDoc = await Channel.findOne({ channelId });
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
                { channelId },
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
                    { channelId },
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
     * Persists a single channel message
     * @param channelId Channel ID
     * @param messageId Message ID
     * @param fromAgentId Agent ID of the sender
     * @param content Message content
     * @param agentId Agent ID performing the operation
     * @param metadata Optional message metadata
     * @param clientTimestamp Optional client timestamp
     * @param messageType Optional message type
     */
    private async persistChannelMessage(
        channelId: ChannelId,
        messageId: string,
        fromAgentId: AgentId, 
        content: any, 
        agentId: AgentId, 
        metadata?: Partial<MessageMetadata>, 
        clientTimestamp?: number, 
        messageType: string = 'text'
    ): Promise<ChannelMessage> { 
        this.validator.assertIsNonEmptyString(channelId, 'channelId for persistChannelMessage');
        this.validator.assertIsNonEmptyString(messageId, 'messageId for persistChannelMessage');
        this.validator.assertIsNonEmptyString(fromAgentId, 'fromAgentId for persistChannelMessage');
        this.validator.assert(content !== undefined, 'content for persistChannelMessage cannot be undefined');
        this.validator.assertIsNonEmptyString(agentId, 'agentId for persistChannelMessage');

        const serverTimestamp = Date.now();

        // Construct the ContentWrapper
        const messageContent: ContentWrapper = {
            format: ContentFormat.TEXT, // Defaulting to TEXT, adjust as necessary
            data: content,
        };

        // Construct the full MessageMetadata
        const messageFullMetadata: MessageMetadata = {
            messageId: messageId,
            timestamp: serverTimestamp,
            ...(metadata || {}), // Spread provided metadata, messageId and timestamp take precedence
            // clientTimestamp is not a direct field of MessageMetadata. If needed, it goes into the general metadata obj.
        };

        // Create the ChannelMessage object
        const channelMessageToPersist: ChannelMessage = {
            toolType: 'channelMessage', // Or determine dynamically
            senderId: fromAgentId,
            content: messageContent,
            metadata: messageFullMetadata,
            context: {
                channelId: channelId,
                // Add other relevant context if needed
                // 'messageType' could be stored here or in metadata if not part of a stricter schema
                // For example: messageType: messageType
            },
            // 'type' field for ChannelMessage (text, command, etc.) could be set here from messageType
        } as ChannelMessage; // Casting, ensure all required fields are present

        try {
            // ;
            
            // TODO: Implement message persistence if needed
            
            return channelMessageToPersist; // Return the persisted message

        } catch (error: any) {
            this.logger.error(`Failed to persist message ${messageId} in channel ${channelId}: ${error.message}`);
            // Parameters of persistChannelMessage are in scope here:
            // channelId, messageId, fromAgentId, content, agentId, metadata, clientTimestamp, messageType

            const errorData: MessagePersistFailedPayload = {
                error: error.message, // Use the actual error message
                originalMessage: { // Construct a partial message for the payload
                    senderId: fromAgentId,
                    content: { data: content, format: ContentFormat.TEXT } as ContentWrapper,
                    metadata: { 
                        messageId: messageId, // from parameter
                        timestamp: clientTimestamp || serverTimestamp, // Use client or server timestamp
                        // Spread original partial metadata if available
                        ...(metadata || {}),
                    },
                    context: { 
                        channelId: channelId, // from parameter
                        // If messageType was part of context, include it here
                        // channelContextType: 'CONVERSATION_HISTORY' as any // Example, adjust as needed
                    }
                    // type: messageType // If 'type' is a direct field
                },
                timestamp: Date.now(), // Timestamp of the error event
                fromAgentId: fromAgentId, // Sender of the original message
                channelId: channelId, // Channel ID
                messageId: messageId // Original message ID
            };

            const errorPayload = createMessagePersistFailedEventPayload(
                Events.Message.MESSAGE_PERSIST_FAILED,
                agentId, // Agent attempting the operation
                channelId,
                errorData
            );
            
            this.eventBus.emit(Events.Message.MESSAGE_PERSIST_FAILED, errorPayload);
            throw error; // Re-throw the error to be caught by sendMessage if called from there
        }
    }

    /**
     * Sends a message to a channel.
     * This involves persisting it and then broadcasting it.
     * @param channelId The ID of the channel.
     * @param messageId Unique ID for the message.
     * @param fromAgentId The ID of the agent sending the message.
     * @param content The content of the message.
     * @param messageType The type of message (e.g., 'text', 'command').
     * @param clientTimestamp Optional client-side timestamp.
     * @param metadata Optional additional metadata for the message.
     * @returns A promise that resolves with the persisted ChannelMessage.
     */
    public async sendMessage(
        channelId: ChannelId,
        messageId: string,
        fromAgentId: AgentId,
        content: any, // Should ideally be typed, e.g., string | Record<string, any>
        messageType: string = 'text',
        clientTimestamp?: number, 
        metadata?: Partial<MessageMetadata> // Allow partial metadata override
    ): Promise<ChannelMessage> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId for sendMessage');
        this.validator.assertIsNonEmptyString(messageId, 'messageId for sendMessage');
        this.validator.assertIsNonEmptyString(fromAgentId, 'fromAgentId for sendMessage');
        this.validator.assert(content !== undefined, 'content for sendMessage cannot be undefined');

        const serverTimestamp = Date.now();

        // Prepare the message content for persistence and event emission
        const channelMessageContent: ContentWrapper = {
            format: ContentFormat.TEXT, // TODO: Determine format dynamically or based on messageType
            data: content,
        };

        // Construct metadata, ensuring messageId is present
        const messageFullMetadata: MessageMetadata = {
            messageId: messageId,
            timestamp: serverTimestamp,
            // clientTimestamp is not a direct field of MessageMetadata, so it's omitted here
            // If it needs to be stored, it should be part of a custom field within the broader metadata object if ChannelMessage allows
            ...(metadata || {}),
        };

        // Create the ChannelMessage object for persistence
        // Note: The persistChannelMessage method will handle the actual DB interaction
        const messageToPersist: ChannelMessage = {
            toolType: 'channelMessage',
            senderId: fromAgentId,
            content: channelMessageContent,
            metadata: messageFullMetadata,
            context: {
                channelId: channelId,
                // Add other relevant context if needed, e.g., fromAgentId, messageType
            },
        } as ChannelMessage; // Cast to ensure type compatibility, review if ChannelMessage structure has more specific context requirements


        try {
            // Log before attempting to persist and broadcast

            // Persist the message first
            // The persistChannelMessage method in ChannelContextMessageOperations expects a specific structure.
            // We will call our own persistChannelMessage which should correctly adapt the message.
            const persistedMessage = await this.persistChannelMessage(
                channelId, 
                messageId, 
                fromAgentId, 
                content, 
                fromAgentId, // agentId for persistence context, typically sender
                metadata,    // Pass existing metadata
                clientTimestamp, 
                messageType
            );

            // Broadcast the message to the channel using Socket.IO
            // The payload for Socket.IO emission should be what clients expect, typically MessageEventData
            const messageEventPayload: MessageEventData = {
                message: persistedMessage, // Use the message returned by persistChannelMessage
                timestamp: serverTimestamp, 
                // clientTimestamp can be part of the payload if your MessageEventData schema includes it
            };

            this.io.to(channelId).emit(Events.Message.CHANNEL_MESSAGE, messageEventPayload);

            // Notify via event bus for internal listeners (e.g., logging, metrics)
            // Use proper EventBus payload structure with createChannelMessageEventPayload
            const eventBusPayload = createChannelMessageEventPayload(
                Events.Message.CHANNEL_MESSAGE_DELIVERED,
                fromAgentId,
                persistedMessage // This is the ChannelMessage with proper structure
            );
            this.eventBus.emit(Events.Message.CHANNEL_MESSAGE_DELIVERED, eventBusPayload);

            // Return the persisted message (or the messageToPersist object, as persist returns void now)
            // For consistency, if persistChannelMessage were to return the persisted object, that would be ideal.
            // For now, returning the constructed message.
            return persistedMessage;

        } catch (error: any) {
            this.logger.error(`Error sending message in channel ${channelId}: ${error.message}`);
            // Use the new specific event for send failure
            const errorData: MessageSendFailedPayload = {
                error: error.message, 
                originalMessage: { // Construct a partial message for the payload
                    senderId: fromAgentId,
                    content: { data: content, format: ContentFormat.TEXT } as ContentWrapper, 
                    metadata: { 
                        messageId: messageId,
                        timestamp: serverTimestamp, // Use serverTimestamp for error metadata
                        ...(metadata || {}), 
                        // clientTimestamp removed
                    },
                    context: { channelId, channelContextType: 'CONVERSATION_HISTORY' as any }
                },
                timestamp: Date.now(),
                fromAgentId: fromAgentId,
                channelId: channelId,
                messageId: messageId
            };
            const errorPayload = createMessageSendFailedEventPayload(
                Events.Message.MESSAGE_SEND_FAILED,
                fromAgentId, // Agent attempting the operation
                channelId,
                errorData
            );
            
            this.eventBus.emit(Events.Message.MESSAGE_SEND_FAILED, errorPayload);
            throw error; 
        }
    }

    /**
     * Persists multiple channel messages efficiently in bulk
     * @param channelId - Channel ID to persist messages to  
     * @param messages - Array of channel messages to persist
     */
    public persistChannelMessagesBulk = async (channelId: ChannelId, messages: ChannelMessage[]): Promise<void> => {
        try {
            // Validate inputs
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('Messages array is required and must not be empty');
            }

            
            // Convert ChannelMessage (from schemas) to ChannelMessage (from types) for operations
            const convertedMessages = messages.map(msg => ({
                messageId: msg.metadata?.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                content: typeof msg.content?.data === 'string' ? msg.content.data : JSON.stringify(msg.content?.data || ''),
                senderId: msg.senderId,
                timestamp: msg.metadata?.timestamp || Date.now(),
                type: 'text' as const,
                metadata: msg.metadata || {}
            }));

            const channelModel = new Channel();
            // TODO: Implement bulk message persistence if needed
            
            // Emit bulk persistence success event
            this.eventBus.emit(Events.Channel.BULK_MESSAGES_PERSISTED, {
                channelId: channelId,
                messageCount: messages.length,
                messageIds: convertedMessages.map(m => m.messageId),
                timestamp: Date.now()
            });
            
        } catch (error) {
            this.logger.error(`Failed to persist ${messages.length} messages to channel ${channelId} in bulk:`, error instanceof Error ? error.message : String(error));
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
            const errorData: ChannelEventData = {
                // TODO: Define 'error' as a valid ChannelActionType in ChannelEventData schema
                action: 'error' as ChannelActionType, // Cast action for now
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
