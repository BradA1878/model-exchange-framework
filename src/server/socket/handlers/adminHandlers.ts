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
 * Admin Event Handlers
 * 
 * Handles administrative operations via Socket.IO events:
 * - Channel creation
 * - Channel key generation
 * - Key management
 * 
 * These provide the same functionality as the HTTP API but via event-driven architecture
 * for use by agents/SDK without requiring HTTP calls.
 */

import { Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { BaseEventPayload, createBaseEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { ChannelService } from '../services/ChannelService';
import channelKeyService from '../services/ChannelKeyService';
import { IChannelKey } from '../../../shared/models/channelKey';
import { createStrictValidator } from '../../../shared/utils/validation';
import { v4 as uuidv4 } from 'uuid';

// Create module logger and validator
const logger = new Logger('info', 'AdminHandlers', 'server');
const validator = createStrictValidator('AdminHandlers');

/**
 * Setup admin event handlers
 * 
 * Wires up event-driven admin operations to call the same services
 * that the HTTP API uses, ensuring consistent behavior regardless
 * of whether operations are triggered via REST or Socket.IO events.
 */
export const setupAdminEventHandlers = (): void => {
    
    // Handle channel creation via events
    EventBus.server.on(Events.Channel.CREATE, async (payload: BaseEventPayload<{
        name: string;
        metadata?: Record<string, any>;
        systemLlmEnabled?: boolean;
        allowedTools?: string[];
    }>) => {
        try {
            
            // Validate payload
            validator.assert(!!payload.data, 'Channel creation data is required');
            validator.assertIsNonEmptyString(payload.data.name, 'Channel name is required');
            validator.assertIsNonEmptyString(payload.channelId, 'Channel ID is required');
            validator.assertIsNonEmptyString(payload.agentId, 'Agent ID is required');
            
            const { name, metadata, systemLlmEnabled, allowedTools } = payload.data;
            const channelId = payload.channelId;
            const createdBy = payload.agentId;
            
            // Merge systemLlmEnabled and allowedTools into metadata for ChannelService
            const fullMetadata = {
                ...metadata,
                systemLlmEnabled,
                allowedTools
            };
            
            // Get ChannelService instance
            const channelService = ChannelService.getInstance();
            
            // Create the channel using the service
            const channel = await channelService.createChannel(
                channelId,
                name,
                createdBy,
                fullMetadata
            );
            
            if (!channel) {
                // Channel creation failed
                const failedPayload = createBaseEventPayload(
                    Events.Channel.CREATION_FAILED,
                    payload.agentId,
                    channelId,
                    {
                        error: 'Failed to create channel'
                    }
                );
                
                EventBus.server.emit(Events.Channel.CREATION_FAILED, failedPayload);
                logger.error(`Failed to create channel ${channelId}`);
                return;
            }
            
            // Emit success event
            const createdPayload = createBaseEventPayload(
                Events.Channel.CREATED,
                payload.agentId,
                channelId,
                {
                    channelId: channel.id,
                    name: channel.name
                }
            );
            
            EventBus.server.emit(Events.Channel.CREATED, createdPayload);
            
        } catch (error: any) {
            logger.error(`Error handling channel:create event: ${error.message}`);
            
            const failedPayload = createBaseEventPayload(
                Events.Channel.CREATION_FAILED,
                payload.agentId,
                payload.channelId,
                {
                    error: error.message || 'Unknown error during channel creation'
                }
            );
            
            EventBus.server.emit(Events.Channel.CREATION_FAILED, failedPayload);
        }
    });
    
    // Handle key generation via events
    EventBus.server.on(Events.Key.GENERATE, async (payload: BaseEventPayload<{
        channelId: string;
        agentId?: string;
        name?: string;
        expiresAt?: string;
    }>) => {
        try {
            
            // Validate payload
            validator.assert(!!payload.data, 'Key generation data is required');
            validator.assertIsNonEmptyString(payload.data.channelId, 'Channel ID is required');
            validator.assertIsNonEmptyString(payload.agentId, 'Agent ID is required');
            
            const { channelId, agentId, name, expiresAt } = payload.data;
            const createdBy = payload.agentId; // The agent requesting the key creation
            
            // Parse expiration date if provided
            let expirationDate: Date | undefined;
            if (expiresAt) {
                expirationDate = new Date(expiresAt);
                if (isNaN(expirationDate.getTime())) {
                    throw new Error('Invalid expiration date format');
                }
            }
            
            // Generate the key using the service
            const keyRecord = await channelKeyService.createChannelKey(
                channelId,
                createdBy,
                name || `Key for ${agentId || 'agent'}`,
                expirationDate
            );
            
            // Emit success event
            const generatedPayload = createBaseEventPayload(
                Events.Key.GENERATED,
                payload.agentId,
                channelId,
                {
                    keyId: keyRecord.keyId,
                    secretKey: keyRecord.secretKey,
                    channelId: keyRecord.channelId,
                    agentId: agentId,
                    expiresAt: keyRecord.expiresAt?.toISOString()
                }
            );
            
            EventBus.server.emit(Events.Key.GENERATED, generatedPayload);
            
        } catch (error: any) {
            logger.error(`Error handling key:generate event: ${error.message}`);
            
            const failedPayload = createBaseEventPayload(
                Events.Key.GENERATION_FAILED,
                payload.agentId,
                payload.data?.channelId || payload.channelId,
                {
                    channelId: payload.data?.channelId || payload.channelId,
                    error: error.message || 'Unknown error during key generation'
                }
            );
            
            EventBus.server.emit(Events.Key.GENERATION_FAILED, failedPayload);
        }
    });
    
    // Handle key deactivation via events
    EventBus.server.on(Events.Key.DEACTIVATE, async (payload: BaseEventPayload<{
        keyId: string;
    }>) => {
        try {
            
            // Validate payload
            validator.assert(!!payload.data, 'Key deactivation data is required');
            validator.assertIsNonEmptyString(payload.data.keyId, 'Key ID is required');
            
            const { keyId } = payload.data;
            
            // Deactivate the key using the service
            const success = await channelKeyService.deactivateChannelKey(keyId);
            
            if (!success) {
                const failedPayload = createBaseEventPayload(
                    Events.Key.DEACTIVATION_FAILED,
                    payload.agentId,
                    payload.channelId,
                    {
                        keyId,
                        error: 'Failed to deactivate key'
                    }
                );
                
                EventBus.server.emit(Events.Key.DEACTIVATION_FAILED, failedPayload);
                logger.error(`Failed to deactivate key ${keyId}`);
                return;
            }
            
            // Emit success event
            const deactivatedPayload = createBaseEventPayload(
                Events.Key.DEACTIVATED,
                payload.agentId,
                payload.channelId,
                {
                    keyId,
                    channelId: payload.channelId
                }
            );
            
            EventBus.server.emit(Events.Key.DEACTIVATED, deactivatedPayload);
            
        } catch (error: any) {
            logger.error(`Error handling key:deactivate event: ${error.message}`);
            
            const failedPayload = createBaseEventPayload(
                Events.Key.DEACTIVATION_FAILED,
                payload.agentId,
                payload.channelId,
                {
                    keyId: payload.data?.keyId || 'unknown',
                    error: error.message || 'Unknown error during key deactivation'
                }
            );
            
            EventBus.server.emit(Events.Key.DEACTIVATION_FAILED, failedPayload);
        }
    });
    
    // Handle key listing via events
    EventBus.server.on(Events.Key.LIST, async (payload: BaseEventPayload<{
        channelId: string;
        activeOnly?: boolean;
    }>) => {
        try {
            
            // Validate payload
            validator.assert(!!payload.data, 'Key list data is required');
            validator.assertIsNonEmptyString(payload.data.channelId, 'Channel ID is required');
            
            const { channelId, activeOnly = true } = payload.data;
            
            // List keys using the service
            const keys = await channelKeyService.listChannelKeys(channelId, activeOnly);
            
            // Map keys to response format (exclude secret keys for security)
            const keyList = keys.map((key: IChannelKey) => ({
                keyId: key.keyId,
                name: key.name,
                isActive: key.isActive,
                expiresAt: key.expiresAt?.toISOString(),
                createdAt: key.createdAt.toISOString(),
                lastUsed: key.lastUsed?.toISOString()
            }));
            
            // Emit success event
            const listedPayload = createBaseEventPayload(
                Events.Key.LISTED,
                payload.agentId,
                channelId,
                {
                    channelId,
                    keys: keyList
                }
            );
            
            EventBus.server.emit(Events.Key.LISTED, listedPayload);
            
        } catch (error: any) {
            logger.error(`Error handling key:list event: ${error.message}`);
            
            const failedPayload = createBaseEventPayload(
                Events.Key.LIST_FAILED,
                payload.agentId,
                payload.data?.channelId || payload.channelId,
                {
                    channelId: payload.data?.channelId || payload.channelId,
                    error: error.message || 'Unknown error during key listing'
                }
            );
            
            EventBus.server.emit(Events.Key.LIST_FAILED, failedPayload);
        }
    });
    
};
