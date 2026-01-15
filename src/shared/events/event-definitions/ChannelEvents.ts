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
 * Channel Events
 * 
 * This module defines all channel-related events used in the framework.
 * It centralizes event names and payload types for channel operations.
 */

import { ChannelId, AgentId } from '../../types/ChannelContext';
import {
    // Channel Creation
    ChannelCreationEventData,
    ChannelCreationEventPayload,
    
    // Context Operations
    ContextGetEventData,
    ContextGotEventData,
    ContextGetFailedEventData,
    ContextUpdateEventData,
    ContextUpdatedEventData,
    ContextUpdateFailedEventData,
    
    // Metadata Operations
    MetadataSetEventData,
    MetadataSetSuccessEventData,
    MetadataSetFailedEventData,
    MetadataGetEventData,
    MetadataGotEventData,
    MetadataGetFailedEventData,
    
    // Topics Operations
    TopicsExtractEventData,
    TopicsExtractedEventData,
    TopicsExtractFailedEventData,
    
    // Summary Operations
    SummaryGenerateEventData,
    SummaryGeneratedEventData,
    SummaryGenerateFailedEventData
} from '../../schemas/EventPayloadSchema';

/**
 * Type definition for channel creation events imported from EventPayloadSchema
 * @deprecated BACKWARD-COMPATIBILITY: Import from src/shared/schemas/EventPayloadSchema.ts instead
 * This type alias is maintained for backward compatibility and will be removed in a future release
 */
export type ChannelCreationEvent = ChannelCreationEventData;

/**
 * Channel action types enum
 */
export const ChannelActionTypes = {
    CREATE: 'create',
    JOIN: 'join',
    LEAVE: 'leave',
    UPDATE: 'update',
    DELETE: 'delete',
    GET_CONTEXT: 'get_context',
    UPDATE_CONTEXT: 'update_context',
    SET_METADATA: 'set_metadata',
    GET_METADATA: 'get_metadata',
    MESSAGE_POSTED: 'message_posted',
    ERROR: 'error'
} as const;

/**
 * Type for channel action types
 */
export type ChannelActionType = typeof ChannelActionTypes[keyof typeof ChannelActionTypes];

/**
 * Events related to channels
 */
export const Events = {
    // Channel creation
    CREATE: 'channel:create', // Create a new channel
    CREATED: 'channel:created', // Channel has been created
    CREATION_FAILED: 'channel:creation:failed', // Channel creation failed
    
    // Channel updates
    UPDATE: 'channel:update', // Update a channel
    UPDATED: 'channel:updated', // Channel has been updated
    UPDATE_FAILED: 'channel:update:failed', // Channel update failed
    
    // Channel deletion and archival
    DELETE: 'channel:delete', // Delete a channel
    DELETED: 'channel:deleted', // Channel has been deleted
    DELETE_FAILED: 'channel:delete:failed', // Channel deletion failed
    
    ARCHIVE: 'channel:archive', // Archive a channel
    ARCHIVED: 'channel:archived', // Channel has been archived
    ARCHIVE_FAILED: 'channel:archive:failed', // Channel archival failed
    
    // Agent events within channels
    AGENT_JOINED: 'channel:agent:joined', // Agent joined the channel
    AGENT_LEFT: 'channel:agent:left', // Agent left the channel
    
    // Channel context operations
    CONTEXT: {
        GET: 'channel:context:get', // Get channel context
        GOT: 'channel:context:got', // Channel context retrieved
        GET_FAILED: 'channel:context:get:failed', // Failed to get channel context
        
        UPDATE: 'channel:context:update', // Update channel context
        UPDATED: 'channel:context:updated', // Channel context updated
        UPDATE_FAILED: 'channel:context:update:failed', // Failed to update channel context
        
        METADATA_SET: 'channel:context:metadata:set', // Set channel metadata
        METADATA_SET_SUCCESS: 'channel:context:metadata:set:success', // Channel metadata set successfully
        METADATA_SET_FAILED: 'channel:context:metadata:set:failed', // Failed to set channel metadata
        
        METADATA_GET: 'channel:context:metadata:get', // Get channel metadata
        METADATA_GOT: 'channel:context:metadata:got', // Channel metadata retrieved
        METADATA_GET_FAILED: 'channel:context:metadata:get:failed', // Failed to get channel metadata
        
        TOPICS_EXTRACT: 'channel:context:topics:extract', // Extract topics from channel conversation
        TOPICS_EXTRACTED: 'channel:context:topics:extracted', // Topics extracted from channel conversation
        TOPICS_EXTRACT_FAILED: 'channel:context:topics:extract:failed', // Failed to extract topics
        
        SUMMARY_GENERATE: 'channel:context:summary:generate', // Generate channel conversation summary
        SUMMARY_GENERATED: 'channel:context:summary:generated', // Channel summary generated
        SUMMARY_GENERATE_FAILED: 'channel:context:summary:generate:failed' // Failed to generate summary
    },
    
    // Bulk message operations
    BULK_MESSAGES_PERSISTED: 'channel:bulk:messages:persisted' // Bulk messages have been persisted
};

/**
 * Channel context operation payload types
 * Using type aliases to EventPayloadSchema.ts definitions
 * 
 * @deprecated BACKWARD-COMPATIBILITY: All these types should be imported directly from src/shared/schemas/EventPayloadSchema.ts
 * These type aliases are maintained for backward compatibility and will be removed in a future release
 * Used by: src/server/socket/services/ChannelContextService.ts, src/shared/services/ChannelContextService.ts
 */

// Context operations
export type ContextGetPayload = ContextGetEventData;
export type ContextGotPayload = ContextGotEventData;
export type ContextGetFailedPayload = ContextGetFailedEventData;
export type ContextUpdatePayload = ContextUpdateEventData;
export type ContextUpdatedPayload = ContextUpdatedEventData;
export type ContextUpdateFailedPayload = ContextUpdateFailedEventData;

// Metadata operations
export type MetadataSetPayload = MetadataSetEventData;
export type MetadataSetSuccessPayload = MetadataSetSuccessEventData;
export type MetadataSetFailedPayload = MetadataSetFailedEventData;
export type MetadataGetPayload = MetadataGetEventData;
export type MetadataGotPayload = MetadataGotEventData;
export type MetadataGetFailedPayload = MetadataGetFailedEventData;

// Topics operations
export type TopicsExtractPayload = TopicsExtractEventData;
export type TopicsExtractedPayload = TopicsExtractedEventData;
export type TopicsExtractFailedPayload = TopicsExtractFailedEventData;

// Summary operations
export type SummaryGeneratePayload = SummaryGenerateEventData;
export type SummaryGeneratedPayload = SummaryGeneratedEventData;
export type SummaryGenerateFailedPayload = SummaryGenerateFailedEventData;

/**
 * Payload types for Channel events
 */
export interface ChannelPayloads {
    // Basic channel operations
    'channel:create': { name: string, metadata?: Record<string, any> };
    'channel:created': { channelId: string, name: string };
    'channel:creation:failed': { error: string };
    'channel:update': { channelId: string, name?: string, metadata?: Record<string, any> };
    'channel:updated': { channelId: string };
    'channel:update:failed': { channelId: string, error: string };
    
    // Channel deletion and archival
    'channel:delete': { channelId: string, reason?: string };
    'channel:deleted': { channelId: string };
    'channel:delete:failed': { channelId: string, error: string };
    
    'channel:archive': { channelId: string, reason?: string };
    'channel:archived': { channelId: string, metadata?: Record<string, any> };
    'channel:archive:failed': { channelId: string, error: string };
    
    // Channel notifications (channel perspective) - these stay in Channel events
    'channel:agent:joined': { channelId: string, agentId: string };
    'channel:agent:left': { channelId: string, agentId: string, data?: { remainingAgents?: number } };
    
    // Channel context operations
    'channel:context:get': ContextGetPayload;
    'channel:context:got': ContextGotPayload;
    'channel:context:get:failed': ContextGetFailedPayload;
    'channel:context:update': ContextUpdatePayload;
    'channel:context:updated': ContextUpdatedPayload;
    'channel:context:update:failed': ContextUpdateFailedPayload;
    'channel:context:metadata:set': MetadataSetPayload;
    'channel:context:metadata:set:success': MetadataSetSuccessPayload;
    'channel:context:metadata:set:failed': MetadataSetFailedPayload;
    'channel:context:metadata:get': MetadataGetPayload;
    'channel:context:metadata:got': MetadataGotPayload;
    'channel:context:metadata:get:failed': MetadataGetFailedPayload;
    'channel:context:topics:extract': TopicsExtractPayload;
    'channel:context:topics:extracted': TopicsExtractedPayload;
    'channel:context:topics:extract:failed': TopicsExtractFailedPayload;
    'channel:context:summary:generate': SummaryGeneratePayload;
    'channel:context:summary:generated': SummaryGeneratedPayload;
    'channel:context:summary:generate:failed': SummaryGenerateFailedPayload;
    
    // Bulk message operations
    'channel:bulk:messages:persisted': { channelId: string, messageIds: string[] };
}
