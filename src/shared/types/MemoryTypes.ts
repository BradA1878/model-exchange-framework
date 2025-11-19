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
 * Memory System Types and Interfaces
 * 
 * This file contains all the type definitions for the Memory System.
 * It defines different memory scopes, persistence levels, and standard interfaces
 * used across the MXF framework for memory operations.
 */

import { createStrictValidator } from '../utils/validation';

/**
 * Memory scope defines the visibility and access context of the memory
 */
export enum MemoryScope {
    /**
     * Agent-specific memory only accessible to that agent
     */
    AGENT = 'agent',
    
    /**
     * Channel-wide memory shared by all agents in the channel
     */
    CHANNEL = 'channel',
    
    /**
     * Relationship memory specific to agent-agent interactions
     */
    RELATIONSHIP = 'relationship'
}

/**
 * Memory persistence level defines how long memory is stored
 */
export enum MemoryPersistenceLevel {
    /**
     * Temporary memory that does not survive restarts
     */
    TEMPORARY = 'temporary',
    
    /**
     * Persistent memory stored in database that survives restarts
     */
    PERSISTENT = 'persistent'
}

/**
 * Base memory entry interface with common properties across all memory types
 */
export interface IMemoryEntry {
    /**
     * Unique identifier for the memory entry
     */
    id: string;
    
    /**
     * When the memory was created
     */
    createdAt: Date;
    
    /**
     * When the memory was last updated
     */
    updatedAt: Date;
    
    /**
     * Memory persistence level (temporary or persistent)
     */
    persistenceLevel: MemoryPersistenceLevel;
}

/**
 * Agent memory interface
 */
export interface IAgentMemory extends IMemoryEntry {
    /**
     * Agent ID that owns this memory
     */
    agentId: string;
    
    /**
     * Persistent notes stored by the agent
     */
    notes?: Record<string, any>;
    
    /**
     * History of conversations
     */
    conversationHistory?: any[];
    
    /**
     * Any custom persistent data
     */
    customData?: Record<string, any>;
}

/**
 * Channel memory interface
 */
export interface IChannelMemory extends IMemoryEntry {
    /**
     * Channel ID that owns this memory
     */
    channelId: string;
    
    /**
     * Shared persistent notes
     */
    notes?: Record<string, any>;
    
    /**
     * Shared state between agents
     */
    sharedState?: Record<string, any>;
    
    /**
     * Channel conversation records
     */
    conversationHistory?: any[];
    
    /**
     * Any custom shared data
     */
    customData?: Record<string, any>;
}

/**
 * Relationship memory interface for agent-to-agent memories
 */
export interface IRelationshipMemory extends IMemoryEntry {
    /**
     * First agent in the relationship
     */
    agentId1: string;
    
    /**
     * Second agent in the relationship
     */
    agentId2: string;
    
    /**
     * Optional channel context
     */
    channelId?: string;
    
    /**
     * Interaction history between agents
     */
    interactionHistory?: any[];
    
    /**
     * Relationship-specific notes
     */
    notes?: Record<string, any>;
    
    /**
     * Any custom relationship data
     */
    customData?: Record<string, any>;
}

/**
 * Union type of all memory interfaces
 */
export type MemoryData = IAgentMemory | IChannelMemory | IRelationshipMemory;

/**
 * Memory access permissions
 */
export enum MemoryAccessPermission {
    READ = 'read',
    WRITE = 'write',
    DELETE = 'delete'
}

/**
 * Memory query parameters
 */
export interface MemoryQueryParams {
    /**
     * Memory scope to query (agent, channel, relationship)
     */
    scope: MemoryScope;
    
    /**
     * ID to look up (agentId, channelId, or [agentId1, agentId2] for relationships)
     */
    id: string | string[];
    
    /**
     * Optional filters to apply to the query
     */
    filters?: Record<string, any>;
}

/**
 * Memory update structure
 */
export interface MemoryUpdate<T extends MemoryData> {
    /**
     * Fields to update
     */
    updates: Partial<T>;
}

/**
 * Create a memory validator for runtime type checking
 * @param context The context string for error messages
 * @returns A validator object with memory-specific validation methods
 */
export const createMemoryValidator = (context: string) => {
    const validator = createStrictValidator(context);
    
    return {
        ...validator,
        
        /**
         * Validates a memory scope value
         * @param scope The memory scope to validate
         */
        validateMemoryScope: (scope: any): scope is MemoryScope => {
            if (!Object.values(MemoryScope).includes(scope)) {
                validator.assertIsString(scope, `Invalid memory scope: ${scope}`);
                return false;
            }
            return true;
        },
        
        /**
         * Validates a persistence level value
         * @param level The persistence level to validate
         */
        validatePersistenceLevel: (level: any): level is MemoryPersistenceLevel => {
            if (!Object.values(MemoryPersistenceLevel).includes(level)) {
                validator.assertIsString(level, `Invalid persistence level: ${level}`);
                return false;
            }
            return true;
        },
        
        /**
         * Validates a memory query parameters object
         * @param params The query parameters to validate
         */
        validateQueryParams: (params: any): params is MemoryQueryParams => {
            validator.assertIsObject(params, 'Query parameters must be an object');
            
            if (!params.scope) {
                validator.assertIsString(params.scope, 'Memory scope is required');
                return false;
            }
            
            if (!params.id) {
                validator.assertIsString(params.id, 'ID parameter is required');
                return false;
            }
            
            return true;
        }
    };
};
