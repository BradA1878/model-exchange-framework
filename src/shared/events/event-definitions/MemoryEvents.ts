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
 * Memory System Events
 * 
 * This file defines all memory-related events used in the MXF Memory System.
 * These events integrate with the main event system and follow the same patterns.
 */

import { MemoryScope } from '../../types/MemoryTypes';
export { MemoryScope };

/**
 * Events for memory operations
 */
export const MemoryEvents = {
    // Query events
    GET: 'memory:get', // Get memory
    GET_RESULT: 'memory:get:result', // Get memory result
    GET_ERROR: 'memory:get:error', // Get memory error

    // Update events
    UPDATE: 'memory:update', // Update memory
    UPDATE_RESULT: 'memory:update:result', // Update memory result
    UPDATE_ERROR: 'memory:update:error', // Update memory error

    // Create events
    CREATE: 'memory:create', // Create memory
    CREATE_RESULT: 'memory:create:result', // Create memory result
    CREATE_ERROR: 'memory:create:error', // Create memory error

    // Delete events
    DELETE: 'memory:delete', // Delete memory
    DELETE_RESULT: 'memory:delete:result', // Delete memory result
    DELETE_ERROR: 'memory:delete:error', // Delete memory error
    
    // Clear events
    CLEAR: 'memory:clear', // Clear memory of specific scope
    CLEAR_RESULT: 'memory:clear:result', // Clear memory result
    CLEAR_ERROR: 'memory:clear:error', // Clear memory error
    
    // Clear all events
    CLEAR_ALL: 'memory:clear:all', // Clear all memory
    CLEAR_ALL_RESULT: 'memory:clear:all:result', // Clear all memory result
    CLEAR_ALL_ERROR: 'memory:clear:all:error', // Clear all memory error

    // Memory lifecycle events
    RECALL: 'memory:recall', // Memory recall
    STORE: 'memory:store', // Memory store
    FORGET: 'memory:forget', // Memory forget

    // Memory sync events
    SYNC: 'memory:sync', // Sync memory with persistence layer
    SYNC_COMPLETE: 'memory:sync:complete', // Sync complete
    SYNC_ERROR: 'memory:sync:error', // Sync error

    // Memory expiration events
    EXPIRE: 'memory:expire', // Memory expiration
    EXPIRE_COMPLETE: 'memory:expire:complete', // Expiration complete
    EXPIRE_ERROR: 'memory:expire:error', // Expiration error
};

/**
 * Base memory event interface
 */
export interface MemoryEventBase {
    /**
     * Unique identifier for this memory operation
     */
    operationId: string;
    
    /**
     * Timestamp of the event
     */
    timestamp: number;
    
    /**
     * Scope of the memory (agent, channel, relationship)
     */
    scope: MemoryScope;
}

/**
 * Memory query event payload
 */
export interface MemoryGetEvent extends MemoryEventBase {
    /**
     * ID to get (agentId, channelId, or [agentId1, agentId2] for relationships)
     */
    id: string | string[];
    
    /**
     * Optional key to retrieve specific data
     */
    key?: string;
    
    /**
     * Optional filters
     */
    filters?: Record<string, any>;
}

/**
 * Memory get result event payload
 */
export interface MemoryGetResultEvent extends MemoryEventBase {
    /**
     * ID that was queried
     */
    id: string | string[];
    
    /**
     * Result data
     */
    data: any;
}

/**
 * Memory update event payload
 */
export interface MemoryUpdateEvent extends MemoryEventBase {
    /**
     * ID to update (agentId, channelId, or [agentId1, agentId2] for relationships)
     */
    id: string | string[];
    
    /**
     * Data to update
     */
    data: Record<string, any>;
    
    /**
     * Optional metadata
     */
    metadata?: Record<string, any>;
}

/**
 * Memory update result event payload
 */
export interface MemoryUpdateResultEvent extends MemoryEventBase {
    /**
     * ID that was updated
     */
    id: string | string[];
    
    /**
     * Updated data
     */
    data: any;
    
    /**
     * Success status
     */
    success: boolean;
}

/**
 * Memory create event payload
 */
export interface MemoryCreateEvent extends MemoryEventBase {
    /**
     * ID to create (agentId, channelId, or [agentId1, agentId2] for relationships)
     */
    id: string | string[];
    
    /**
     * Data to store
     */
    data: Record<string, any>;
    
    /**
     * Optional metadata
     */
    metadata?: Record<string, any>;
}

/**
 * Memory create result event payload
 */
export interface MemoryCreateResultEvent extends MemoryEventBase {
    /**
     * ID that was created
     */
    id: string | string[];
    
    /**
     * Created data
     */
    data: any;
    
    /**
     * Success status
     */
    success: boolean;
}

/**
 * Memory delete event payload
 */
export interface MemoryDeleteEvent extends MemoryEventBase {
    /**
     * ID to delete (agentId, channelId, or [agentId1, agentId2] for relationships)
     */
    id: string | string[];
    
    /**
     * Optional key to delete specific data
     */
    key?: string;
}

/**
 * Memory delete result event payload
 */
export interface MemoryDeleteResultEvent extends MemoryEventBase {
    /**
     * ID that was deleted
     */
    id: string | string[];
    
    /**
     * Success status
     */
    success: boolean;
}

/**
 * Memory error event payload
 */
export interface MemoryErrorEvent extends MemoryEventBase {
    /**
     * ID associated with the error
     */
    id: string | string[];
    
    /**
     * Error message
     */
    error: string;
    
    /**
     * Error code
     */
    code?: string;
    
    /**
     * Optional details
     */
    details?: Record<string, any>;
}

/**
 * Memory clear event payload
 */
export interface MemoryClearEvent extends MemoryEventBase {
    /**
     * Scope to clear
     */
    scope: MemoryScope;
}

/**
 * Memory clear result event payload
 */
export interface MemoryClearResultEvent extends MemoryEventBase {
    /**
     * Number of items cleared
     */
    clearedCount: number;
    
    /**
     * Success status
     */
    success: boolean;
}

/**
 * Memory clear all event payload
 */
export interface MemoryClearAllEvent extends Omit<MemoryEventBase, 'scope'> {
    /**
     * Optional scope to clear all
     * For a clear all operation, the scope can be specified to clear all memory of a specific type,
     * or it can be undefined to clear all memory across all scopes
     */
    scope?: MemoryScope;
}

/**
 * Memory clear all result event payload
 */
export interface MemoryClearAllResultEvent extends MemoryEventBase {
    /**
     * Number of items cleared
     */
    clearedCount: number;
    
    /**
     * Success status
     */
    success: boolean;
}

/**
 * Memory sync event payload
 */
export interface MemorySyncEvent extends MemoryEventBase {
    /**
     * IDs to sync (agentId, channelId, or [agentId1, agentId2] for relationships)
     */
    ids: Array<string | string[]>;
}

/**
 * Memory sync result event payload
 */
export interface MemorySyncResultEvent extends MemoryEventBase {
    /**
     * Number of items synced
     */
    syncedCount: number;
    
    /**
     * Success status
     */
    success: boolean;
}

/**
 * All memory event payload types
 */
export interface MemoryPayloads {
    'memory:get': MemoryGetEvent;
    'memory:get:result': MemoryGetResultEvent;
    'memory:get:error': MemoryErrorEvent;
    'memory:update': MemoryUpdateEvent;
    'memory:update:result': MemoryUpdateResultEvent;
    'memory:update:error': MemoryErrorEvent;
    'memory:create': MemoryCreateEvent;
    'memory:create:result': MemoryCreateResultEvent;
    'memory:create:error': MemoryErrorEvent;
    'memory:delete': MemoryDeleteEvent;
    'memory:delete:result': MemoryDeleteResultEvent;
    'memory:delete:error': MemoryErrorEvent;
    'memory:recall': MemoryGetEvent;
    'memory:store': MemoryUpdateEvent;
    'memory:forget': MemoryDeleteEvent;
    'memory:sync': MemorySyncEvent;
    'memory:sync:complete': MemorySyncResultEvent;
    'memory:sync:error': MemoryErrorEvent;
    'memory:clear': MemoryClearEvent;
    'memory:clear:result': MemoryClearResultEvent;
    'memory:clear:error': MemoryErrorEvent;
    'memory:clear:all': MemoryClearAllEvent;
    'memory:clear:all:result': MemoryClearAllResultEvent;
    'memory:clear:all:error': MemoryErrorEvent;
    'memory:expire': { scope: MemoryScope, olderThan?: number };
    'memory:expire:complete': { scope: MemoryScope, expiredCount: number };
    'memory:expire:error': MemoryErrorEvent;
}
