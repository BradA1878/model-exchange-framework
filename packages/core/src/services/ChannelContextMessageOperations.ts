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
 * Channel Context Message Operations
 * 
 * Handles all message-related operations for the channel context service.
 * This includes adding, retrieving, and managing messages within channels.
 */

import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';

import { 
    ChannelId,
    ChannelMessage
} from '../types/ChannelContext.js';

import { createStrictValidator } from '../utils/validation.js';
import { EventBus } from '../events/EventBus.js';
import { EventBusBase } from '../events/EventBusBase.js';
import { Events } from '../events/EventNames.js';
import { MemoryScope } from '../types/MemoryTypes.js';
import { createMemoryGetEventPayload, createMemoryUpdateEventPayload } from '../schemas/EventPayloadSchema.js';
import { v4 as uuidv4 } from 'uuid';

interface MemoryOperationResponseData {
    operationId?: string;
    memory?: unknown;
    error?: string;
}

interface MemoryOperationResponse {
    data?: MemoryOperationResponseData;
}

type MemoryEventBus = EventBusBase & {
    emit(event: string, payload: unknown): void;
};

const SYSTEM_AGENT_ID = 'SYSTEM_AGENT';

/**
 * Provides message operations for the channel context service
 */
export class ChannelContextMessageOperations {
    private eventBus: MemoryEventBus;
    
    constructor(isClientContext: boolean = false) {
        this.eventBus = (isClientContext ? EventBus.client : EventBus.server) as MemoryEventBus;
    }

    private requestMemoryResult(
        resultEvent: string,
        operationId: string,
        emitRequest: () => void
    ): Observable<MemoryOperationResponseData> {
        return new Observable(observer => {
            let settled = false;
            const handler = (response: unknown): void => {
                if (!response || typeof response !== 'object') return;
                const data = (response as MemoryOperationResponse).data;
                if (data?.operationId !== operationId || settled) return;
                settled = true;
                if (data.error) {
                    observer.error(new Error(data.error));
                    return;
                }
                observer.next(data);
                observer.complete();
            };
            const subscription = this.eventBus.on(resultEvent, handler);
            try {
                emitRequest();
            } catch (error) {
                settled = true;
                observer.error(error instanceof Error ? error : new Error(String(error)));
            }
            return () => subscription.unsubscribe();
        });
    }

    private isChannelMessage(value: unknown): value is ChannelMessage {
        if (!value || typeof value !== 'object') return false;
        const message = value as Partial<ChannelMessage>;
        return typeof message.messageId === 'string' &&
            (typeof message.content === 'string' || (
                message.content !== null && typeof message.content === 'object'
            )) &&
            typeof message.senderId === 'string' &&
            typeof message.timestamp === 'number' &&
            ['text', 'command', 'response', 'system'].includes(message.type ?? '');
    }
    /**
     * Append a message batch through the authoritative atomic memory bridge.
     * @param channelId - Channel ID
     * @param messagesMemoryKey - Memory key for messages
     * @param messages - Array of channel messages to add
     * @param updateMetadata - Metadata for the update operation
     * @returns Observable of success status
     */
    private appendMessages = (
        channelId: ChannelId,
        messagesMemoryKey: string,
        messages: ChannelMessage[],
        updateMetadata: Record<string, unknown>
    ): Observable<boolean> => {
        const uniqueMessages = [...new Map(
            messages.map(message => [message.messageId, message])
        ).values()];
        const operationId = uuidv4();
        return this.requestMemoryResult(
            Events.Memory.UPDATE_RESULT,
            operationId,
            () => this.eventBus.emit(
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(
                    Events.Memory.UPDATE,
                    SYSTEM_AGENT_ID,
                    channelId,
                    {
                        operationId,
                        scope: MemoryScope.CHANNEL,
                        id: messagesMemoryKey,
                        data: { [messagesMemoryKey]: uniqueMessages },
                        metadata: {
                            ...updateMetadata,
                            newMessageCount: uniqueMessages.length
                        }
                    }
                )
            )
        ).pipe(map(() => true));
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
        
        return this.appendMessages(channelId, messagesMemoryKey, messages, {
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

        const operationId = uuidv4();
        return this.requestMemoryResult(
            Events.Memory.GET_RESULT,
            operationId,
            () => this.eventBus.emit(
                Events.Memory.GET,
                createMemoryGetEventPayload(
                    Events.Memory.GET,
                    SYSTEM_AGENT_ID,
                    channelId,
                    {
                        operationId,
                        scope: MemoryScope.CHANNEL,
                        id: messagesMemoryKey,
                        key: messagesMemoryKey
                    }
                )
            )
        ).pipe(
            map(result => {
                const messages = Array.isArray(result.memory)
                    ? result.memory.filter((message): message is ChannelMessage =>
                        this.isChannelMessage(message))
                    : [];
                messages.sort((left, right) => left.timestamp - right.timestamp);
                return limit && limit > 0 && messages.length > limit
                    ? messages.slice(-limit)
                    : messages;
            })
        );
    };
}
