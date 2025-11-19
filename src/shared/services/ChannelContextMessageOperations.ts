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
 * Channel Context Message Operations
 * 
 * Handles all message-related operations for the channel context service.
 * This includes adding, retrieving, and managing messages within channels.
 */

import { Observable, throwError } from 'rxjs';

import { 
    ChannelId,
    AgentId, 
    ChannelContextType, 
    ChannelContextHistoryEntry,
    ChannelMessage
} from '../types/ChannelContext';

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { MemoryScope } from '../types/MemoryTypes';
import { createMemoryGetEventPayload, createMemoryUpdateEventPayload } from '../schemas/EventPayloadSchema';
import { v4 as uuidv4 } from 'uuid';

/**
 * Provides message operations for the channel context service
 */
export class ChannelContextMessageOperations {
    private logger: Logger;
    private eventBus: any; // Will be either EventBus.client or this.eventBus
    
    constructor(isClientContext: boolean = false) {
        const target = isClientContext ? 'client' : 'server';
        this.logger = new Logger('debug', 'ChannelContextMessageOperations', target);
        this.eventBus = isClientContext ? EventBus.client : EventBus.server;
    }
    /**
     * Helper method to handle common memory get/update pattern
     * @param channelId - Channel ID
     * @param messagesMemoryKey - Memory key for messages
     * @param messages - Array of channel messages to add
     * @param updateMetadata - Metadata for the update operation
     * @returns Observable of success status
     */
    private handleMemoryGetAndUpdate = (
        channelId: ChannelId,
        messagesMemoryKey: string,
        messages: ChannelMessage[],
        updateMetadata: any
    ): Observable<boolean> => {
        return new Observable<boolean>(observer => {
            // Set up timeout for bulk operation (longer timeout for larger batches)
            const timeoutMs = Math.min(15000, 5000 + (messages.length * 100)); // Base 5s + 100ms per message, max 15s
            let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
                this.logger.warn(`Bulk message timeout triggered for ${messages.length} messages after ${timeoutMs}ms`);
                
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                this.eventBus.off(Events.Memory.GET_RESULT, getResponseHandler);
                
                // Fallback: save just the new messages without merging
                const fallbackData = { [messagesMemoryKey]: messages };
                const fallbackMetadata = {
                    type: 'channelMessages',
                    channelId: channelId,
                    lastUpdated: Date.now(),
                    isBulkInsert: true,
                    messageCount: messages.length
                };
                
                
                this.eventBus.emit(
                    Events.Memory.UPDATE,
                    createMemoryUpdateEventPayload(
                        Events.Memory.UPDATE,
                        'system',
                        channelId,
                        {
                            operationId: uuidv4(),
                            scope: MemoryScope.CHANNEL,
                            id: channelId,
                            data: fallbackData,
                            metadata: fallbackMetadata
                        }
                    )
                );
                
                observer.next(true);
                observer.complete();
            }, timeoutMs);
            
            // Set up response handler for bulk GET operation
            const getResponseHandler = (response: any): void => {
                
                if (!response?.data || response.data.id !== messagesMemoryKey) {
                    return; // Not our response
                }
                
                // Clear timeout since we got a response
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                
                // Remove the listener since we're handling the response
                this.eventBus.off(Events.Memory.GET_RESULT, getResponseHandler);
                
                
                try {
                    let existingMessages: ChannelMessage[] = [];
                    
                    // Extract existing messages if they exist
                    if (response.data.data && Array.isArray(response.data.data)) {
                        existingMessages = response.data.data
                            .filter((msg: any) => msg && typeof msg === 'object' && msg.messageId && msg.content && msg.senderId)
                            .map((msg: any) => ({
                                messageId: msg.messageId,
                                content: msg.content,
                                senderId: msg.senderId,
                                timestamp: msg.timestamp || Date.now(),
                                type: ['text', 'command', 'response', 'system'].includes(msg.type) ? msg.type : 'text',
                                metadata: typeof msg.metadata === 'object' ? msg.metadata : {}
                            }));
                    }
                    
                    // Merge existing messages with new messages
                    const allMessages = [...existingMessages, ...messages];
                    
                    // Sort by timestamp (oldest first)
                    allMessages.sort((a, b) => a.timestamp - b.timestamp);
                    
                    // Remove duplicates based on messageId (keep the latest)
                    const uniqueMessages = new Map<string, ChannelMessage>();
                    for (const msg of allMessages) {
                        uniqueMessages.set(msg.messageId, msg);
                    }
                    const finalMessages = Array.from(uniqueMessages.values()).sort((a, b) => a.timestamp - b.timestamp);
                    
                    // Prepare update data
                    const updateData = { [messagesMemoryKey]: finalMessages };
                    const updateMetadataWithMessageCount = {
                        ...updateMetadata,
                        messageCount: finalMessages.length,
                        newMessageCount: messages.length
                    };
                    
                    
                    // Update memory with all messages
                    this.eventBus.emit(
                        Events.Memory.UPDATE,
                        createMemoryUpdateEventPayload(
                            Events.Memory.UPDATE,
                            'system',
                            channelId,
                            {
                                operationId: uuidv4(),
                                scope: MemoryScope.CHANNEL,
                                id: channelId,
                                data: updateData,
                                metadata: updateMetadataWithMessageCount
                            }
                        )
                    );
                    
                    observer.next(true);
                    observer.complete();
                    
                } catch (error) {
                    this.logger.error(`[ChannelContextMessageOperations:BULK] Error processing bulk messages: ${error instanceof Error ? error.message : String(error)}`);
                    observer.error(error instanceof Error ? error : new Error(String(error)));
                }
            };
            
            // Listen for the GET response
            this.eventBus.on(Events.Memory.GET_RESULT, getResponseHandler);
            
            
            // Get existing messages first
            this.eventBus.emit(
                Events.Memory.GET,
                createMemoryGetEventPayload(
                    Events.Memory.GET,
                    'system',
                    channelId,
                    {
                        operationId: uuidv4(),
                        scope: MemoryScope.CHANNEL,
                        id: channelId,
                        key: messagesMemoryKey
                    }
                )
            );
            
            // Return cleanup function
            return (): void => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                this.eventBus.off(Events.Memory.GET_RESULT, getResponseHandler);
            };
        });
    };

    /**
     * Add multiple messages to the channel conversation history efficiently
     * @param channelId - Channel ID
     * @param messages - Array of channel messages to add
     * @returns Observable of success status
     */
    public addMessages = (
        channelId: ChannelId,
        messages: ChannelMessage[]
    ): Observable<boolean> => {
        
        try {
            // Use strict validator for fail-fast validation
            const validator = createStrictValidator('ChannelMessages');
            
            // Validate messages array
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('Messages must be a non-empty array');
            }
            
            // Validate each message
            for (const [index, message] of messages.entries()) {
                if (!message.messageId) throw new Error(`Message ${index}: Message ID is required`);
                validator.assertIsString(message.messageId, `Message ${index}: Message ID must be a string`);
                
                if (!message.content) throw new Error(`Message ${index}: Message content is required`);
                
                if (!message.senderId) throw new Error(`Message ${index}: Message sender ID is required`);
                validator.assertIsString(message.senderId, `Message ${index}: Message sender ID must be a string`);
                
                if (!message.timestamp) throw new Error(`Message ${index}: Message timestamp is required`);
                validator.assertIsNumber(message.timestamp, `Message ${index}: Message timestamp must be a number`);
                
                if (!message.type) throw new Error(`Message ${index}: Message type is required`);
                validator.assertIsString(message.type, `Message ${index}: Message type must be a string`);
                if (!['text', 'command', 'response', 'system'].includes(message.type)) {
                    throw new Error(`Message ${index}: Message type must be one of: text, command, response, system`);
                }
            }
        } catch (error) {
            return throwError(() => error instanceof Error ? error : new Error(String(error)));
        }
        
        const messagesMemoryKey = `channel:messages:${channelId}`;
        
        return this.handleMemoryGetAndUpdate(channelId, messagesMemoryKey, messages, {
            type: 'channelMessages',
            channelId: channelId,
            lastUpdated: Date.now(),
            isBulkInsert: true
        });
    };

    /**
     * Add a message to the channel conversation history
     * @param channelId - Channel ID
     * @param message - Channel message
     * @returns Observable of success status
     */
    public addMessage = (
        channelId: ChannelId,
        message: ChannelMessage
    ): Observable<boolean> => {
        // For single messages, delegate to the bulk method for consistency
        return this.addMessages(channelId, [message]);
    };

    /**
     * Get recent channel messages with validation
     * @param channelId - Channel ID
     * @param limit - Maximum number of messages
     * @returns Observable of messages array
     */
    public getMessages = (
        channelId: ChannelId,
        limit?: number
    ): Observable<ChannelMessage[]> => {
        
        // Validate parameters
        if (!channelId) {
            return throwError(() => new Error('Channel ID is required'));
        }
        
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
            return throwError(() => new Error('Limit must be a positive integer'));
        }
        
        const messagesMemoryKey = `channel:messages:${channelId}`;
        
        return new Observable<ChannelMessage[]>(observer => {
            
            // Set up an internal timeout to ensure we don't wait forever
            const internalTimeoutMs = 8000; // 8 seconds - less than controller's 10s
            let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
                this.logger.warn(`Internal timeout triggered for getMessages (channel ${channelId}) after ${internalTimeoutMs}ms`);
                
                // Clean up event listener when timeout occurs
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                this.eventBus.off(Events.Memory.GET_RESULT, responseHandler);
                
                // Try direct database query as a fallback
                // Since this is just a read operation, it's reasonable to complete with empty results
                observer.next([]);
                observer.complete();
            }, internalTimeoutMs);
            
            // Set up response handler with detailed logging
            const responseHandler = (response: any): void => {
                
                // Only process if this is the response we're waiting for
                if (!response?.data) {
                    this.logger.warn('[ChannelContextMessageOperations] Received undefined response or missing data');
                    return;
                }
                
                if (response.data.id !== messagesMemoryKey) {
                    return;
                }
                
                
                // Clear the timeout since we got a response
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                
                // Clean up listener
                this.eventBus.off(Events.Memory.GET_RESULT, responseHandler);
                
                let messages: ChannelMessage[] = [];
                
                if (Array.isArray(response.data.data)) {
                    try {
                        const validator = createStrictValidator('ChannelMessages');
                        
                        // Process and validate each message
                        messages = response.data.data.filter((msg: any) => {
                            // Basic structure validation
                            if (!msg || typeof msg !== 'object') return false;
                            if (!msg.messageId || !msg.content || !msg.senderId) return false;
                            
                            return true;
                        }).map((msg: any) => {
                            // Ensure consistent structure even if some fields are missing
                            return {
                                messageId: msg.messageId,
                                content: msg.content,
                                senderId: msg.senderId,
                                timestamp: msg.timestamp || Date.now(),
                                type: ['text', 'command', 'response', 'system'].includes(msg.type) ? 
                                    msg.type : 'text',
                                metadata: typeof msg.metadata === 'object' ? msg.metadata : {}
                            };
                        });
                        
                        // Sort by timestamp (oldest first)
                        messages.sort((a, b) => a.timestamp - b.timestamp);
                        
                        // Apply limit if specified
                        if (limit && limit > 0 && messages.length > limit) {
                            messages = messages.slice(-limit); // Get most recent messages
                        }
                        
                    } catch (error) {
                        this.logger.error(`Error processing messages: ${error instanceof Error ? error.message : String(error)}`);
                        // Fall back to empty array on error
                        messages = [];
                    }
                } else {
                    this.logger.warn(`No message array found in memory response for id ${messagesMemoryKey}`);
                }
                
                observer.next(messages);
                observer.complete();
            };
            
            // Listen for the response
            this.eventBus.on(Events.Memory.GET_RESULT, responseHandler);
            
            this.eventBus.emit(
                Events.Memory.GET, 
                createMemoryGetEventPayload(
                    Events.Memory.GET, // eventType
                    'system', // agentId - placeholder
                    channelId, // channelId
                    { // MemoryGetEventData
                        operationId: uuidv4(), // Generate a new operationId for this GET request
                        scope: MemoryScope.CHANNEL,
                        id: channelId,
                        key: messagesMemoryKey
                    }
                )
            );
            
            // Return cleanup function
            return (): void => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                this.eventBus.off(Events.Memory.GET_RESULT, responseHandler);
            };
        });
    };
}
