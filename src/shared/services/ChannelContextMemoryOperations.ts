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
 * Channel Context Memory Operations
 * 
 * Handles all memory-related operations for the channel context service.
 * This includes saving, retrieving, and updating contexts in the memory system.
 */

import { Observable, throwError, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid'; // Added import for uuid

import { 
    ChannelId, 
    ChannelContextType, 
    ChannelContextHistoryEntry
} from '../types/ChannelContext';
import { AgentId } from '../types/Agent'; // Added import for AgentId

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { MemoryScope } from '../types/MemoryTypes'; // MemoryGetEventData, MemoryUpdateEventData removed from here
import { 
    createMemoryGetEventPayload, 
    createMemoryUpdateEventPayload, 
    MemoryGetEventData, // Added import here
    MemoryUpdateEventData // Added import here
} from '../schemas/EventPayloadSchema';

const SYSTEM_AGENT_ID: AgentId = 'SYSTEM_AGENT'; // Define SYSTEM_AGENT_ID

/**
 * Provides memory operations for the channel context service
 */
export class ChannelContextMemoryOperations {
    private logger: Logger;
    private eventBus: any; // Will be either EventBus.client or this.eventBus
    
    constructor(isClientContext: boolean = false) {
        const target = isClientContext ? 'client' : 'server';
        this.logger = new Logger('debug', 'ChannelContextMemoryOperations', target);
        this.eventBus = isClientContext ? EventBus.client : EventBus.server;
    }
    /**
     * Save context to memory system with proper validation and error handling
     * @param channelId - Channel ID
     * @param context - Channel context to save
     * @param historyEntry - Optional history entry to record with this update
     * @returns Observable of the saved context
     */
    public saveContextToMemory = (
        channelId: ChannelId,
        context: ChannelContextType,
        historyEntry?: ChannelContextHistoryEntry
    ): Observable<ChannelContextType> => {
        
        try {
            // Validate channelId and context
            if (!channelId) {
                return throwError(() => new Error('Channel ID is required'));
            }
            
            if (!context) {
                return throwError(() => new Error('Context is required'));
            }
            
            // Validate context structure using our validator
            const validator = createStrictValidator();
            
            // Validate essential properties
            validator.assertIsString(context.channelId, 'Context must have a valid channelId');
            validator.assertIsString(context.name, 'Context must have a valid name');
            validator.assertIsString(context.description, 'Context must have a valid description');
            validator.assertIsArray(context.participants, 'Context must have a participants array');

            // Validate metadata if present
            if (context.metadata) {
                validator.assertIsObject(context.metadata, 'Context metadata must be an object');
            }

            // Ensure channelId in context matches the provided channelId
            if (context.channelId !== channelId) {
                return throwError(() => new Error(`Channel ID mismatch: ${context.channelId} vs ${channelId}`));
            }

            // Save context to memory
            const memoryKey = `channel:context:${channelId}`;
            
            // Emit memory update event using standardized payload creator
            const contextDataForEvent = { [memoryKey]: context }; // This is the 'data' part of MemoryUpdateEventData
            const contextMetadataForEvent = {
                channelId: channelId,
                updatedAt: Date.now(),
                key: memoryKey
            };

            const updateData: MemoryUpdateEventData = {
                operationId: uuidv4(),
                scope: MemoryScope.CHANNEL,
                id: memoryKey, // Use the memory key as the id for UPDATE operations
                data: contextDataForEvent,
                metadata: contextMetadataForEvent
            };
            
            
            const payload = createMemoryUpdateEventPayload(Events.Memory.UPDATE, SYSTEM_AGENT_ID, channelId, updateData);
            
            
            
            this.eventBus.emit(
                Events.Memory.UPDATE,
                payload
            );
            
            // Store history entry if provided
            if (historyEntry && historyEntry !== null && historyEntry !== undefined) {
                this.saveHistoryEntry(channelId, historyEntry as ChannelContextHistoryEntry);
            }
            
            // Return the context after emitting the event
            return of(context);
        } catch (error) {
            this.logger.error(`Error saving context to memory: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error instanceof Error ? error : new Error(String(error)));
        }
    };

    /**
     * Get channel context from memory
     * @param channelId - Channel ID
     * @returns Observable of the channel context
     */
    public getContextFromMemory = (channelId: ChannelId): Observable<ChannelContextType | null> => {
        
        return new Observable(observer => {
            const memoryKey = `channel:context:${channelId}`;
            let handled = false;
            let timeoutId: NodeJS.Timeout;

            // Define response handler
            const memoryResponseHandler = (response: any): void => {
                //;
                
                // if (handled || !response || response.key !== memoryKey) {
                //     ;
                //     return; // Already handled or not for us
                // }
                handled = true;
                clearTimeout(timeoutId);
                this.eventBus.off(Events.Memory.GET_RESULT, memoryResponseHandler);
                
                try {
                    if (response.error) {
            this.logger.warn(`Error getting context from memory for key ${memoryKey}: ${response.error}`);
                        observer.next(null);
                    } else {
                        const contextData = response.data ? response.data[memoryKey] : null;
                        observer.next(contextData);
                    }
                    observer.complete();
                } catch (error) {
            this.logger.error(`Error processing memory response for ${memoryKey}: ${error instanceof Error ? error.message : String(error)}`);
                    observer.error(error instanceof Error ? error : new Error(String(error)));
                }
            };
            
            // Set timeout to prevent hanging
            timeoutId = setTimeout(() => {
                if (!handled) {
                    handled = true;
                    this.eventBus.off(Events.Memory.GET_RESULT, memoryResponseHandler);
            this.logger.warn(`Memory get operation timed out for ${memoryKey}`);
                    observer.next(null); // Return null instead of hanging
                    observer.complete();
                }
            }, 45000); // 45 second timeout to accommodate LLM API response times
            
            // Listen for memory get result
            this.eventBus.on(Events.Memory.GET_RESULT, memoryResponseHandler);
            
            // Request context from memory using standardized payload creator
            const getData: MemoryGetEventData = {
                operationId: uuidv4(),
                scope: MemoryScope.CHANNEL,
                id: memoryKey, // Use the memory key as the id for GET operations
                key: memoryKey // Use the memory key for actual lookup
            };
            
            this.eventBus.emit(
                Events.Memory.GET, 
                createMemoryGetEventPayload(Events.Memory.GET, SYSTEM_AGENT_ID, channelId, getData)
            );
            
            // Handle cleanup
            return (): void => {
                if (!handled) {
                    clearTimeout(timeoutId);
                    this.eventBus.off(Events.Memory.GET_RESULT, memoryResponseHandler);
                }
            };
        });
    };

    /**
     * Save a history entry
     * @param channelId - Channel ID
     * @param historyEntry - History entry to save
     */
    private saveHistoryEntry = (channelId: ChannelId, historyEntry: ChannelContextHistoryEntry): void => {
        const historyKey = `channel:context:history:${channelId}`;
        let handled = false;
        
        // Define handler for getting history from memory
        const historyUpdateHandler = (response: any): void => {
            if (handled || !response || response.key !== historyKey) {
                return; // Already handled or not for us
            }
            handled = true;
            this.eventBus.off(Events.Memory.GET_RESULT, historyUpdateHandler);
            
            try {
                // Get existing history or create new array
                const existingHistory = response.data && response.data[historyKey] && Array.isArray(response.data[historyKey]) 
                    ? response.data[historyKey]
                    : [];
                
                // Add new entry
                existingHistory.push(historyEntry);
                
                // Only keep last 100 entries
                const trimmedHistory = existingHistory.slice(-100);
                
                // Save updated history using standardized payload creator
                const historyDataForEvent = { [historyKey]: trimmedHistory }; // This is the 'data' part of MemoryUpdateEventData
                const historyMetadataForEvent = {
                    channelId: channelId,
                    updatedAt: Date.now(),
                    key: historyKey
                };

                const updateData: MemoryUpdateEventData = {
                    operationId: uuidv4(),
                    scope: MemoryScope.CHANNEL,
                    id: historyKey, // Use the memory key as the id for UPDATE operations
                    data: historyDataForEvent,
                    metadata: historyMetadataForEvent
                };
                
                
                const payload = createMemoryUpdateEventPayload(Events.Memory.UPDATE, SYSTEM_AGENT_ID, channelId, updateData);
                
                this.eventBus.emit(
                    Events.Memory.UPDATE,
                    payload
                );
            } catch (error) {
            this.logger.error(`Error updating history for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            }
        };
        
        // Listen for history get result
        this.eventBus.on(Events.Memory.GET_RESULT, historyUpdateHandler);
        
        // Request history from memory using standardized payload creator
        const getData: MemoryGetEventData = {
            operationId: uuidv4(),
            scope: MemoryScope.CHANNEL,
            id: historyKey, // Use the memory key as the id for GET operations
            key: historyKey // Use the memory key for actual lookup
        };
        this.eventBus.emit(
            Events.Memory.GET, 
            createMemoryGetEventPayload(Events.Memory.GET, SYSTEM_AGENT_ID, channelId, getData)
        );
    };

    /**
     * Get channel context history
     * @param channelId - Channel ID
     * @param limit - Maximum number of history entries
     * @returns Observable of history entries
     */
    public getContextHistory = (
        channelId: ChannelId,
        limit?: number
    ): Observable<ChannelContextHistoryEntry[]> => {
        
        return new Observable(observer => {
            const historyKey = `channel:context:history:${channelId}`;
            let handled = false;
            
            // Define handler for getting history from memory
            const historyGetHandler = (response: any): void => {
                // Only process if this is the response we're waiting for
                // Check response.data.id (not response.key) as that's what Memory.GET handler sets
                if (handled || !response || !response.data || response.data.id !== historyKey) {
                    return;
                }
                handled = true;
                // Remove listener to avoid processing multiple times
                this.eventBus.off(Events.Memory.GET_RESULT, historyGetHandler);
                
                try {
                    // Get existing history or create new array
                    // Memory.GET handler returns { data: { memory: data } }
                    const historyData = response.data.memory;
                    const history = Array.isArray(historyData) ? historyData : [];
                    
                    // Apply limit if specified
                    const limitedHistory = limit && limit > 0 
                        ? history.slice(-limit) 
                        : history;
                    
                    observer.next(limitedHistory);
                    observer.complete();
                } catch (error) {
            this.logger.error(`Error getting history for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
                    observer.error(error instanceof Error ? error : new Error(String(error)));
                }
            };
            
            // Listen for history get result
            this.eventBus.on(Events.Memory.GET_RESULT, historyGetHandler);
            
            // Request history from memory using standardized payload creator
            const getData: MemoryGetEventData = {
                operationId: uuidv4(),
                scope: MemoryScope.CHANNEL,
                id: historyKey, // Use the memory key as the id for GET operations
                key: historyKey // Use the memory key for actual lookup
            };
            this.eventBus.emit(
                Events.Memory.GET, 
                createMemoryGetEventPayload(Events.Memory.GET, SYSTEM_AGENT_ID, channelId, getData)
            );
            
            // Handle cleanup
            return (): void => {
                if (!handled) {
                    this.eventBus.off(Events.Memory.GET_RESULT, historyGetHandler);
                }
            };
        });
    };
}
