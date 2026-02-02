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
 * Repository Interface for Knowledge Graph Operations
 *
 * Provides methods for entity and relationship CRUD operations,
 * graph queries, memory linking, and Q-value management.
 */

import { ChannelId } from '../../types/ChannelContext';
import {
    Entity,
    Relationship,
    CreateEntityRequest,
    CreateRelationshipRequest,
    EntityType,
    RelationshipType,
    EntityFilter,
    RelationshipFilter,
    GraphQuery,
    GraphQueryResult,
    GraphPath,
    GraphContext,
    EntityMergeResult,
    EntitySimilarity,
} from '../../types/KnowledgeGraphTypes';

/**
 * Repository interface for Knowledge Graph operations
 */
export interface IKnowledgeGraphRepository {
    // ========================================================================
    // Entity CRUD Operations
    // ========================================================================

    /**
     * Create a new entity
     *
     * @param request - Entity creation request
     * @returns The created entity
     */
    createEntity(request: CreateEntityRequest): Promise<Entity>;

    /**
     * Get an entity by ID
     *
     * @param entityId - The entity ID
     * @returns The entity or null if not found
     */
    getEntity(entityId: string): Promise<Entity | null>;

    /**
     * Update an entity
     *
     * @param entityId - The entity ID
     * @param updates - Partial entity updates
     * @returns The updated entity or null if not found
     */
    updateEntity(entityId: string, updates: Partial<Entity>): Promise<Entity | null>;

    /**
     * Delete an entity
     *
     * @param entityId - The entity ID
     * @returns true if deleted
     */
    deleteEntity(entityId: string): Promise<boolean>;

    /**
     * Find entities matching filters
     *
     * @param channelId - The channel ID
     * @param filter - Entity filters
     * @param limit - Maximum entities to return
     * @returns Matching entities
     */
    findEntities(
        channelId: ChannelId,
        filter?: EntityFilter,
        limit?: number
    ): Promise<Entity[]>;

    /**
     * Find entity by name (exact or partial match)
     *
     * @param channelId - The channel ID
     * @param name - Name to search for
     * @param exact - Whether to match exactly
     * @returns Matching entities
     */
    findEntityByName(
        channelId: ChannelId,
        name: string,
        exact?: boolean
    ): Promise<Entity[]>;

    /**
     * Find entity by alias
     *
     * @param channelId - The channel ID
     * @param alias - Alias to search for
     * @returns Matching entities
     */
    findEntityByAlias(channelId: ChannelId, alias: string): Promise<Entity[]>;

    /**
     * Find or create entity (idempotent)
     *
     * @param request - Entity creation request
     * @returns The found or created entity
     */
    findOrCreateEntity(request: CreateEntityRequest): Promise<Entity>;

    /**
     * Merge multiple entities into one
     *
     * @param targetEntityId - The entity to merge into
     * @param sourceEntityIds - Entities to merge from (will be marked as merged)
     * @returns Merge result
     */
    mergeEntities(
        targetEntityId: string,
        sourceEntityIds: string[]
    ): Promise<EntityMergeResult>;

    /**
     * Find similar entities for potential merging
     *
     * @param channelId - The channel ID
     * @param threshold - Similarity threshold (0-1)
     * @returns Array of similar entity pairs
     */
    findSimilarEntities(
        channelId: ChannelId,
        threshold?: number
    ): Promise<EntitySimilarity[]>;

    // ========================================================================
    // Relationship CRUD Operations
    // ========================================================================

    /**
     * Create a new relationship
     *
     * @param request - Relationship creation request
     * @returns The created relationship
     */
    createRelationship(request: CreateRelationshipRequest): Promise<Relationship>;

    /**
     * Get a relationship by ID
     *
     * @param relationshipId - The relationship ID
     * @returns The relationship or null if not found
     */
    getRelationship(relationshipId: string): Promise<Relationship | null>;

    /**
     * Update a relationship
     *
     * @param relationshipId - The relationship ID
     * @param updates - Partial relationship updates
     * @returns The updated relationship or null if not found
     */
    updateRelationship(
        relationshipId: string,
        updates: Partial<Relationship>
    ): Promise<Relationship | null>;

    /**
     * Delete a relationship
     *
     * @param relationshipId - The relationship ID
     * @returns true if deleted
     */
    deleteRelationship(relationshipId: string): Promise<boolean>;

    /**
     * Get relationships between two entities
     *
     * @param fromEntityId - Source entity ID
     * @param toEntityId - Target entity ID
     * @param type - Optional relationship type filter
     * @returns Matching relationships
     */
    getRelationshipsBetween(
        fromEntityId: string,
        toEntityId: string,
        type?: RelationshipType
    ): Promise<Relationship[]>;

    /**
     * Get all relationships for an entity (incoming and outgoing)
     *
     * @param entityId - The entity ID
     * @param filter - Optional relationship filter
     * @returns Relationships involving this entity
     */
    getEntityRelationships(
        entityId: string,
        filter?: RelationshipFilter
    ): Promise<Relationship[]>;

    // ========================================================================
    // Graph Query Operations
    // ========================================================================

    /**
     * Get neighbors of an entity
     *
     * @param entityId - The entity ID
     * @param options - Query options
     * @returns Neighboring entities and relationships
     */
    getNeighbors(
        entityId: string,
        options?: {
            direction?: 'incoming' | 'outgoing' | 'both';
            relationshipType?: RelationshipType | RelationshipType[];
            entityType?: EntityType | EntityType[];
            maxDepth?: number;
            limit?: number;
        }
    ): Promise<{
        entities: Entity[];
        relationships: Relationship[];
    }>;

    /**
     * Find shortest path between two entities
     *
     * @param fromEntityId - Source entity ID
     * @param toEntityId - Target entity ID
     * @param maxHops - Maximum hops to search
     * @returns Path or null if not found
     */
    findPath(
        fromEntityId: string,
        toEntityId: string,
        maxHops?: number
    ): Promise<GraphPath | null>;

    /**
     * Find all paths between two entities
     *
     * @param fromEntityId - Source entity ID
     * @param toEntityId - Target entity ID
     * @param maxHops - Maximum hops
     * @param limit - Maximum paths to return
     * @returns Array of paths
     */
    findAllPaths(
        fromEntityId: string,
        toEntityId: string,
        maxHops?: number,
        limit?: number
    ): Promise<GraphPath[]>;

    /**
     * Execute a graph query
     *
     * @param channelId - The channel ID
     * @param query - Graph query
     * @returns Query results
     */
    query(channelId: ChannelId, query: GraphQuery): Promise<GraphQueryResult>;

    /**
     * Get a subgraph around an entity
     *
     * @param entityId - Center entity ID
     * @param depth - How many hops from center
     * @param limit - Maximum entities to return
     * @returns Subgraph
     */
    getSubgraph(
        entityId: string,
        depth?: number,
        limit?: number
    ): Promise<{
        entities: Entity[];
        relationships: Relationship[];
    }>;

    // ========================================================================
    // Memory Linking Operations
    // ========================================================================

    /**
     * Link a memory to entities
     *
     * @param memoryId - The memory ID
     * @param entityIds - Entity IDs to link
     */
    linkMemoryToEntities(memoryId: string, entityIds: string[]): Promise<void>;

    /**
     * Get entities linked to a memory
     *
     * @param memoryId - The memory ID
     * @returns Linked entities
     */
    getEntitiesForMemory(memoryId: string): Promise<Entity[]>;

    /**
     * Get memories linked to an entity
     *
     * @param entityId - The entity ID
     * @returns Array of memory IDs
     */
    getMemoriesForEntity(entityId: string): Promise<string[]>;

    // ========================================================================
    // Q-Value / MULS Operations
    // ========================================================================

    /**
     * Update entity Q-value
     *
     * @param entityId - The entity ID
     * @param newQValue - The new Q-value
     * @param reason - Reason for update
     * @returns Updated entity
     */
    updateEntityQValue(
        entityId: string,
        newQValue: number,
        reason: string
    ): Promise<Entity | null>;

    /**
     * Batch update Q-values
     *
     * @param updates - Array of updates
     */
    batchUpdateQValues(
        updates: Array<{
            entityId: string;
            qValue: number;
            reason: string;
        }>
    ): Promise<void>;

    /**
     * Get entities by Q-value range
     *
     * @param channelId - The channel ID
     * @param minQValue - Minimum Q-value
     * @param maxQValue - Maximum Q-value
     * @param limit - Maximum entities to return
     * @returns Matching entities sorted by Q-value (descending)
     */
    getEntitiesByQValue(
        channelId: ChannelId,
        minQValue?: number,
        maxQValue?: number,
        limit?: number
    ): Promise<Entity[]>;

    /**
     * Increment retrieval count for entities
     *
     * @param entityIds - Entity IDs to update
     */
    incrementRetrievalCount(entityIds: string[]): Promise<void>;

    /**
     * Record success/failure for entities (for Q-value learning)
     *
     * @param entityIds - Entity IDs
     * @param success - Whether outcome was successful
     */
    recordOutcome(entityIds: string[], success: boolean): Promise<void>;

    // ========================================================================
    // Batch Operations
    // ========================================================================

    /**
     * Get multiple entities by their IDs in a single query
     *
     * @param entityIds - Array of entity IDs to fetch
     * @returns Array of found entities (excludes missing IDs)
     */
    getEntitiesByIds(entityIds: string[]): Promise<Entity[]>;

    /**
     * Get all relationships where either endpoint is in the given entity IDs
     *
     * @param entityIds - Array of entity IDs to find relationships for
     * @returns Array of relationships involving the given entities
     */
    getRelationshipsByEntityIds(entityIds: string[]): Promise<Relationship[]>;

    // ========================================================================
    // Context Operations
    // ========================================================================

    /**
     * Get graph context for a task
     *
     * @param channelId - The channel ID
     * @param taskId - The task ID (optional, for task-specific context)
     * @param keywords - Keywords to find relevant entities
     * @returns Graph context
     */
    getGraphContext(
        channelId: ChannelId,
        taskId?: string,
        keywords?: string[]
    ): Promise<GraphContext>;

    /**
     * Get high-utility entities for a channel
     *
     * @param channelId - The channel ID
     * @param limit - Maximum entities to return
     * @returns High Q-value entities
     */
    getHighUtilityEntities(channelId: ChannelId, limit?: number): Promise<Entity[]>;
}
