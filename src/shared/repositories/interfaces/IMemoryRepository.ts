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
 * Memory repository interface - handles agent, channel, and relationship memory.
 * This interface does not extend IBaseRepository since memory operations
 * have unique patterns (scoped access, multiple entity types).
 */

/**
 * Memory persistence level
 */
export enum MemoryPersistenceLevel {
    TEMPORARY = 'temporary',
    PERSISTENT = 'persistent'
}

/**
 * Memory scope types
 */
export enum MemoryScope {
    AGENT = 'agent',
    CHANNEL = 'channel',
    RELATIONSHIP = 'relationship'
}

/**
 * Base memory entry interface
 */
export interface IMemoryEntry {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    persistenceLevel: MemoryPersistenceLevel;
}

/**
 * Agent memory entity
 */
export interface IAgentMemory extends IMemoryEntry {
    agentId: string;
    notes?: Record<string, any>;
    conversationHistory?: any[];
    customData?: Record<string, any>;
}

/**
 * Channel memory entity
 */
export interface IChannelMemory extends IMemoryEntry {
    channelId: string;
    notes?: Record<string, any>;
    sharedState?: Record<string, any>;
    conversationHistory?: any[];
    customData?: Record<string, any>;
}

/**
 * Relationship memory entity
 */
export interface IRelationshipMemory extends IMemoryEntry {
    agentId1: string;
    agentId2: string;
    notes?: Record<string, any>;
    interactionHistory?: any[];
    customData?: Record<string, any>;
}

/**
 * Memory statistics
 */
export interface MemoryStatistics {
    agentMemoryCount: number;
    channelMemoryCount: number;
    relationshipMemoryCount: number;
    totalSizeBytes?: number;
}

/**
 * Repository interface for Memory entities.
 * Handles agent, channel, and relationship memory.
 */
export interface IMemoryRepository {
    // Agent Memory Operations
    /**
     * Get memory for a specific agent
     */
    getAgentMemory(agentId: string): Promise<IAgentMemory | null>;

    /**
     * Save or update agent memory
     */
    saveAgentMemory(memory: Partial<IAgentMemory> & { agentId: string }): Promise<IAgentMemory>;

    /**
     * Update specific fields in agent memory
     */
    updateAgentMemory(agentId: string, updates: Partial<IAgentMemory>): Promise<IAgentMemory | null>;

    /**
     * Delete agent memory
     */
    deleteAgentMemory(agentId: string): Promise<boolean>;

    // Channel Memory Operations
    /**
     * Get memory for a specific channel
     */
    getChannelMemory(channelId: string): Promise<IChannelMemory | null>;

    /**
     * Save or update channel memory
     */
    saveChannelMemory(memory: Partial<IChannelMemory> & { channelId: string }): Promise<IChannelMemory>;

    /**
     * Update specific fields in channel memory
     */
    updateChannelMemory(channelId: string, updates: Partial<IChannelMemory>): Promise<IChannelMemory | null>;

    /**
     * Delete channel memory
     */
    deleteChannelMemory(channelId: string): Promise<boolean>;

    // Relationship Memory Operations
    /**
     * Get memory for a relationship between two agents
     */
    getRelationshipMemory(agentId1: string, agentId2: string): Promise<IRelationshipMemory | null>;

    /**
     * Save or update relationship memory
     */
    saveRelationshipMemory(memory: Partial<IRelationshipMemory> & { agentId1: string; agentId2: string }): Promise<IRelationshipMemory>;

    /**
     * Get all relationships for an agent
     */
    getAgentRelationships(agentId: string): Promise<IRelationshipMemory[]>;

    /**
     * Delete relationship memory
     */
    deleteRelationshipMemory(agentId1: string, agentId2: string): Promise<boolean>;

    // Bulk Operations
    /**
     * Delete all memory for a scope and ID
     */
    deleteByScope(scope: MemoryScope, id: string): Promise<boolean>;

    /**
     * Get memory statistics
     */
    getStatistics(): Promise<MemoryStatistics>;
}
