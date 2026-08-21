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
 * Channel Context Memory Operations
 * 
 * Handles all memory-related operations for the channel context service.
 * This includes saving, retrieving, and updating contexts in the memory system.
 */

import { Observable, of, throwError } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid'; // Added import for uuid

import { 
    ChannelId, 
    ChannelContextType, 
    ChannelContextHistoryEntry
} from '../types/ChannelContext.js';
import { AgentId } from '../types/Agent.js'; // Added import for AgentId

import { Logger } from '../utils/Logger.js';
import { createStrictValidator } from '../utils/validation.js';
import { EventBus } from '../events/EventBus.js';
import { EventBusBase } from '../events/EventBusBase.js';
import { Events } from '../events/EventNames.js';
import { MemoryScope } from '../types/MemoryTypes.js'; // MemoryGetEventData, MemoryUpdateEventData removed from here
import { 
    createMemoryGetEventPayload, 
    createMemoryDeleteEventPayload,
    createMemoryUpdateEventPayload, 
    MemoryDeleteEventData,
    MemoryGetEventData, // Added import here
    MemoryUpdateEventData // Added import here
} from '../schemas/EventPayloadSchema.js';

const SYSTEM_AGENT_ID: AgentId = 'SYSTEM_AGENT'; // Define SYSTEM_AGENT_ID

interface MemoryOperationResponseData {
    operationId?: string;
    id?: string | string[];
    memory?: unknown;
    success?: boolean;
    error?: string;
}

interface MemoryOperationResponse {
    data?: MemoryOperationResponseData;
}

type MemoryEventBus = EventBusBase & {
    emit(event: string, payload: unknown): void;
};

/**
 * Provides memory operations for the channel context service
 */
export class ChannelContextMemoryOperations {
    private logger: Logger;
    private eventBus: MemoryEventBus;
    
    constructor(isClientContext: boolean = false) {
        const target = isClientContext ? 'client' : 'server';
        this.logger = new Logger('debug', 'ChannelContextMemoryOperations', target);
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
    /**
     * Save context to memory system with proper validation and error handling
     * @param channelId - Channel ID
     * @param context - Channel context to save
     * @param historyEntry - Optional history entry to record with this update
     * @param expectedContextUpdatedAt - Persisted revision required for an update
     * @returns Observable of the saved context
     */
    public saveContextToMemory = (
        channelId: ChannelId,
        context: ChannelContextType,
        historyEntry?: ChannelContextHistoryEntry,
        expectedContextUpdatedAt?: number
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
                key: memoryKey,
                expectedContextUpdatedAt
            };

            const operationId = uuidv4();
            const updateData: MemoryUpdateEventData = {
                operationId,
                scope: MemoryScope.CHANNEL,
                id: memoryKey, // Use the memory key as the id for UPDATE operations
                data: contextDataForEvent,
                metadata: contextMetadataForEvent
            };
            
            
            const payload = createMemoryUpdateEventPayload(Events.Memory.UPDATE, SYSTEM_AGENT_ID, channelId, updateData);
            
            
            
            return this.requestMemoryResult(
                Events.Memory.UPDATE_RESULT,
                operationId,
                () => this.eventBus.emit(Events.Memory.UPDATE, payload)
            ).pipe(
                mergeMap(() => historyEntry
                    ? this.saveHistoryEntry(channelId, historyEntry).pipe(map(() => context))
                    : of(context)
                )
            );
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
        
        const memoryKey = `channel:context:${channelId}`;
        const operationId = uuidv4();
        const getData: MemoryGetEventData = {
            operationId,
            scope: MemoryScope.CHANNEL,
            id: memoryKey,
            key: memoryKey
        };

        return this.requestMemoryResult(
            Events.Memory.GET_RESULT,
            operationId,
            () => this.eventBus.emit(
                Events.Memory.GET,
                createMemoryGetEventPayload(Events.Memory.GET, SYSTEM_AGENT_ID, channelId, getData)
            )
        ).pipe(
            map(result => (result.memory as ChannelContextType | null | undefined) ?? null)
        );
    };

    /**
     * Save a history entry
     * @param channelId - Channel ID
     * @param historyEntry - History entry to save
     */
    private saveHistoryEntry = (
        channelId: ChannelId,
        historyEntry: ChannelContextHistoryEntry
    ): Observable<void> => {
        const historyKey = `channel:context:history:${channelId}`;
        const updateOperationId = uuidv4();
        const updateData: MemoryUpdateEventData = {
            operationId: updateOperationId,
            scope: MemoryScope.CHANNEL,
            id: historyKey,
            data: { [historyKey]: [historyEntry] },
            metadata: { channelId, updatedAt: Date.now(), key: historyKey }
        };

        return this.requestMemoryResult(
            Events.Memory.UPDATE_RESULT,
            updateOperationId,
            () => this.eventBus.emit(
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(
                    Events.Memory.UPDATE,
                    SYSTEM_AGENT_ID,
                    channelId,
                    updateData
                )
            )
        ).pipe(map(() => undefined));
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
        
        const historyKey = `channel:context:history:${channelId}`;
        const operationId = uuidv4();
        const getData: MemoryGetEventData = {
            operationId,
            scope: MemoryScope.CHANNEL,
            id: historyKey,
            key: historyKey
        };
        return this.requestMemoryResult(
            Events.Memory.GET_RESULT,
            operationId,
            () => this.eventBus.emit(
                Events.Memory.GET,
                createMemoryGetEventPayload(
                    Events.Memory.GET,
                    SYSTEM_AGENT_ID,
                    channelId,
                    getData
                )
            )
        ).pipe(
            map(result => {
                const history = Array.isArray(result.memory)
                    ? result.memory as ChannelContextHistoryEntry[]
                    : [];
                return limit && limit > 0 ? history.slice(-limit) : history;
            })
        );
    };

    /**
     * Delete the exact persisted context field for a channel and await the
     * authoritative memory bridge acknowledgement.
     */
    public deleteContextFromMemory = (channelId: ChannelId): Observable<boolean> => {
        if (!channelId) {
            return throwError(() => new Error('Channel ID is required'));
        }
        const memoryKey = `channel:context:${channelId}`;
        const operationId = uuidv4();
        const deleteData: MemoryDeleteEventData = {
            operationId,
            scope: MemoryScope.CHANNEL,
            id: memoryKey
        };

        return this.requestMemoryResult(
            Events.Memory.DELETE_RESULT,
            operationId,
            () => this.eventBus.emit(
                Events.Memory.DELETE,
                createMemoryDeleteEventPayload(
                    Events.Memory.DELETE,
                    SYSTEM_AGENT_ID,
                    channelId,
                    deleteData
                )
            )
        ).pipe(map(result => result.success === true));
    };
}
