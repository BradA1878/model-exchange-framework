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
 * KnowledgeGraphService
 *
 * Central service for managing the Knowledge Graph.
 * Provides entity/relationship management, graph queries, and Q-value propagation.
 *
 * Features:
 * - Entity CRUD with deduplication
 * - Relationship management
 * - Graph queries and context retrieval
 * - Q-value propagation for MULS integration
 * - Event emission for graph changes
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { KnowledgeGraphEvents } from '../../events/event-definitions/KnowledgeGraphEvents';
import { MongoKnowledgeGraphRepository } from '../../database/adapters/mongodb/MongoKnowledgeGraphRepository';
import {
    isKnowledgeGraphEnabled,
    isQValueLearningEnabled,
    getQValueLearningRate,
    getMinConfidence,
} from '../../config/knowledge-graph.config';
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
import { ChannelId } from '../../types/ChannelContext';
import { AgentId } from '../../types/Agent';
import {
    createBaseEventPayload
} from '../../schemas/EventPayloadSchema';

/**
 * KnowledgeGraphService is the central service for managing the Knowledge Graph
 */
export class KnowledgeGraphService {
    private static instance: KnowledgeGraphService;
    private logger: Logger;
    private enabled: boolean = false;
    private repository: MongoKnowledgeGraphRepository;

    private constructor() {
        this.logger = new Logger('info', 'KnowledgeGraphService', 'server');
        this.repository = MongoKnowledgeGraphRepository.getInstance();
        this.initialize();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): KnowledgeGraphService {
        if (!KnowledgeGraphService.instance) {
            KnowledgeGraphService.instance = new KnowledgeGraphService();
        }
        return KnowledgeGraphService.instance;
    }

    /**
     * Initialize the service
     */
    private initialize(): void {
        this.enabled = isKnowledgeGraphEnabled();

        if (!this.enabled) {
            this.logger.debug('KnowledgeGraphService initialized but disabled');
            return;
        }

        this.logger.info('KnowledgeGraphService initialized');
    }

    /**
     * Check if the service is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    // ========================================================================
    // Entity Operations
    // ========================================================================

    /**
     * Create a new entity
     */
    public async createEntity(
        request: CreateEntityRequest,
        createdBy?: AgentId
    ): Promise<Entity> {
        if (!this.enabled) {
            throw new Error('Knowledge Graph is not enabled');
        }

        // Apply minimum confidence threshold
        if (request.confidence !== undefined && request.confidence < getMinConfidence()) {
            this.logger.debug(
                `Entity ${request.name} confidence ${request.confidence} below threshold ${getMinConfidence()}, skipping`
            );
            throw new Error(`Confidence ${request.confidence} below minimum ${getMinConfidence()}`);
        }

        const entity = await this.repository.createEntity(request);

        // Emit event
        this.emitEvent(KnowledgeGraphEvents.ENTITY_CREATED, request.channelId, createdBy || 'system', {
            entityId: entity.id,
            channelId: request.channelId,
            type: entity.type,
            name: entity.name,
            source: entity.source,
            confidence: entity.confidence,
        });

        return entity;
    }

    /**
     * Find or create entity (idempotent)
     */
    public async findOrCreateEntity(
        request: CreateEntityRequest,
        createdBy?: AgentId
    ): Promise<Entity> {
        if (!this.enabled) {
            throw new Error('Knowledge Graph is not enabled');
        }

        const existing = await this.repository.findEntityByName(
            request.channelId,
            request.name,
            true
        );

        if (existing.length > 0 && existing[0].type === request.type) {
            return existing[0];
        }

        return this.createEntity(request, createdBy);
    }

    /**
     * Get entity by ID
     */
    public async getEntity(entityId: string): Promise<Entity | null> {
        if (!this.enabled) {
            return null;
        }

        return this.repository.getEntity(entityId);
    }

    /**
     * Find entities by name
     */
    public async findEntityByName(
        channelId: ChannelId,
        name: string,
        exact?: boolean
    ): Promise<Entity[]> {
        if (!this.enabled) {
            return [];
        }

        return this.repository.findEntityByName(channelId, name, exact);
    }

    /**
     * Find entities with filters
     */
    public async findEntities(
        channelId: ChannelId,
        filter?: EntityFilter,
        limit?: number
    ): Promise<Entity[]> {
        if (!this.enabled) {
            return [];
        }

        return this.repository.findEntities(channelId, filter, limit);
    }

    /**
     * Update an entity
     */
    public async updateEntity(
        entityId: string,
        updates: Partial<Entity>,
        updatedBy?: AgentId
    ): Promise<Entity | null> {
        if (!this.enabled) {
            return null;
        }

        const original = await this.repository.getEntity(entityId);
        if (!original) {
            return null;
        }

        const updated = await this.repository.updateEntity(entityId, updates);

        if (updated) {
            // Build changes object
            const changes: Record<string, { old: any; new: any }> = {};
            for (const key of Object.keys(updates) as (keyof Entity)[]) {
                if (original[key] !== (updates as any)[key]) {
                    changes[key] = {
                        old: original[key],
                        new: (updates as any)[key],
                    };
                }
            }

            this.emitEvent(KnowledgeGraphEvents.ENTITY_UPDATED, original.channelId, updatedBy || 'system', {
                entityId,
                channelId: original.channelId,
                changes,
                updatedBy: updatedBy || 'system',
            });
        }

        return updated;
    }

    /**
     * Delete an entity
     */
    public async deleteEntity(
        entityId: string,
        deletedBy?: AgentId,
        reason?: string
    ): Promise<boolean> {
        if (!this.enabled) {
            return false;
        }

        const entity = await this.repository.getEntity(entityId);
        if (!entity) {
            return false;
        }

        const deleted = await this.repository.deleteEntity(entityId);

        if (deleted) {
            this.emitEvent(KnowledgeGraphEvents.ENTITY_DELETED, entity.channelId, deletedBy || 'system', {
                entityId,
                channelId: entity.channelId,
                deletedBy: deletedBy || 'system',
                reason,
            });
        }

        return deleted;
    }

    /**
     * Merge entities
     */
    public async mergeEntities(
        targetEntityId: string,
        sourceEntityIds: string[],
        mergedBy?: AgentId
    ): Promise<EntityMergeResult> {
        if (!this.enabled) {
            return { success: false, sourceEntityIds, error: 'Knowledge Graph not enabled' };
        }

        const result = await this.repository.mergeEntities(targetEntityId, sourceEntityIds);

        if (result.success && result.mergedEntity) {
            this.emitEvent(
                KnowledgeGraphEvents.ENTITY_MERGED,
                result.mergedEntity.channelId,
                mergedBy || 'system',
                {
                    targetEntityId,
                    sourceEntityIds,
                    channelId: result.mergedEntity.channelId,
                    mergedBy: mergedBy || 'system',
                    similarity: 1.0,
                }
            );
        }

        return result;
    }

    /**
     * Find similar entities for potential merging
     */
    public async findSimilarEntities(
        channelId: ChannelId,
        threshold?: number
    ): Promise<EntitySimilarity[]> {
        if (!this.enabled) {
            return [];
        }

        return this.repository.findSimilarEntities(channelId, threshold);
    }

    // ========================================================================
    // Relationship Operations
    // ========================================================================

    /**
     * Create a relationship
     */
    public async createRelationship(
        request: CreateRelationshipRequest,
        createdBy?: AgentId
    ): Promise<Relationship> {
        if (!this.enabled) {
            throw new Error('Knowledge Graph is not enabled');
        }

        const relationship = await this.repository.createRelationship(request);

        this.emitEvent(
            KnowledgeGraphEvents.RELATIONSHIP_CREATED,
            request.channelId,
            createdBy || 'system',
            {
                relationshipId: relationship.id,
                channelId: request.channelId,
                fromEntityId: request.fromEntityId,
                toEntityId: request.toEntityId,
                type: request.type,
                confidence: relationship.confidence,
                source: relationship.source,
            }
        );

        return relationship;
    }

    /**
     * Get relationship by ID
     */
    public async getRelationship(relationshipId: string): Promise<Relationship | null> {
        if (!this.enabled) {
            return null;
        }

        return this.repository.getRelationship(relationshipId);
    }

    /**
     * Get relationships between two entities
     */
    public async getRelationshipsBetween(
        fromEntityId: string,
        toEntityId: string,
        type?: RelationshipType
    ): Promise<Relationship[]> {
        if (!this.enabled) {
            return [];
        }

        return this.repository.getRelationshipsBetween(fromEntityId, toEntityId, type);
    }

    /**
     * Update a relationship
     */
    public async updateRelationship(
        relationshipId: string,
        updates: Partial<Relationship>,
        updatedBy?: AgentId
    ): Promise<Relationship | null> {
        if (!this.enabled) {
            return null;
        }

        const original = await this.repository.getRelationship(relationshipId);
        if (!original) {
            return null;
        }

        const updated = await this.repository.updateRelationship(relationshipId, updates);

        if (updated) {
            const changes: Record<string, { old: any; new: any }> = {};
            for (const key of Object.keys(updates) as (keyof Relationship)[]) {
                if (original[key] !== (updates as any)[key]) {
                    changes[key] = {
                        old: original[key],
                        new: (updates as any)[key],
                    };
                }
            }

            this.emitEvent(
                KnowledgeGraphEvents.RELATIONSHIP_UPDATED,
                original.channelId,
                updatedBy || 'system',
                {
                    relationshipId,
                    channelId: original.channelId,
                    changes,
                    updatedBy: updatedBy || 'system',
                }
            );
        }

        return updated;
    }

    /**
     * Delete a relationship
     */
    public async deleteRelationship(
        relationshipId: string,
        deletedBy?: AgentId,
        reason?: string
    ): Promise<boolean> {
        if (!this.enabled) {
            return false;
        }

        const relationship = await this.repository.getRelationship(relationshipId);
        if (!relationship) {
            return false;
        }

        const deleted = await this.repository.deleteRelationship(relationshipId);

        if (deleted) {
            this.emitEvent(
                KnowledgeGraphEvents.RELATIONSHIP_DELETED,
                relationship.channelId,
                deletedBy || 'system',
                {
                    relationshipId,
                    channelId: relationship.channelId,
                    deletedBy: deletedBy || 'system',
                    reason,
                }
            );
        }

        return deleted;
    }

    // ========================================================================
    // Graph Query Operations
    // ========================================================================

    /**
     * Execute a graph query
     */
    public async query(channelId: ChannelId, query: GraphQuery): Promise<GraphQueryResult> {
        if (!this.enabled) {
            return {
                entities: [],
                relationships: [],
                totalCount: 0,
                executionTimeMs: 0,
            };
        }

        const result = await this.repository.query(channelId, query);

        // Emit query event
        this.emitEvent(KnowledgeGraphEvents.GRAPH_QUERY_EXECUTED, channelId, 'system', {
            channelId,
            queryType: 'custom',
            entitiesFound: result.entities.length,
            relationshipsFound: result.relationships.length,
            executionTimeMs: result.executionTimeMs,
        });

        return result;
    }

    /**
     * Get neighbors of an entity
     */
    public async getNeighbors(
        entityId: string,
        options?: {
            direction?: 'incoming' | 'outgoing' | 'both';
            relationshipType?: RelationshipType | RelationshipType[];
            entityType?: EntityType | EntityType[];
            maxDepth?: number;
            limit?: number;
        }
    ): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
        if (!this.enabled) {
            return { entities: [], relationships: [] };
        }

        return this.repository.getNeighbors(entityId, options);
    }

    /**
     * Find path between two entities
     */
    public async findPath(
        fromEntityId: string,
        toEntityId: string,
        maxHops?: number
    ): Promise<GraphPath | null> {
        if (!this.enabled) {
            return null;
        }

        return this.repository.findPath(fromEntityId, toEntityId, maxHops);
    }

    /**
     * Get entity context (subgraph around entity)
     */
    public async getEntityContext(
        entityId: string,
        depth?: number
    ): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
        if (!this.enabled) {
            return { entities: [], relationships: [] };
        }

        return this.repository.getSubgraph(entityId, depth);
    }

    /**
     * Get graph context for a task
     */
    public async getGraphContext(
        channelId: ChannelId,
        taskId?: string,
        keywords?: string[]
    ): Promise<GraphContext> {
        if (!this.enabled) {
            return {
                centralEntities: [],
                relatedEntities: [],
                relationships: [],
                highUtilityEntities: [],
                stats: {
                    entityCount: 0,
                    relationshipCount: 0,
                    avgQValue: 0,
                    maxQValue: 0,
                    avgConfidence: 0,
                },
            };
        }

        const context = await this.repository.getGraphContext(channelId, taskId, keywords);

        // Emit context retrieved event
        this.emitEvent(KnowledgeGraphEvents.CONTEXT_RETRIEVED, channelId, 'system', {
            channelId,
            contextType: taskId ? 'task' : 'query',
            entityCount: context.stats.entityCount,
            relationshipCount: context.stats.relationshipCount,
            avgQValue: context.stats.avgQValue,
        });

        return context;
    }

    /**
     * Find connections between entities.
     * Uses batch queries to avoid N+1 database calls.
     */
    public async findConnections(
        entityIds: string[],
        maxHops?: number
    ): Promise<{ entities: Entity[]; relationships: Relationship[]; paths: GraphPath[] }> {
        if (!this.enabled || entityIds.length < 2) {
            return { entities: [], relationships: [], paths: [] };
        }

        const allPaths: GraphPath[] = [];
        const entitySet = new Set<string>(entityIds);

        // Find paths between all pairs
        for (let i = 0; i < entityIds.length; i++) {
            for (let j = i + 1; j < entityIds.length; j++) {
                const paths = await this.repository.findAllPaths(
                    entityIds[i],
                    entityIds[j],
                    maxHops ?? 3,
                    5
                );
                allPaths.push(...paths);

                // Collect entity IDs from paths
                for (const path of paths) {
                    for (const id of path.entityIds) {
                        entitySet.add(id);
                    }
                }
            }
        }

        // Batch fetch all entities in one query instead of N individual calls
        const entities = await this.repository.getEntitiesByIds(Array.from(entitySet));

        // Batch fetch all relationships involving these entities in one query
        const allRels = await this.repository.getRelationshipsByEntityIds(Array.from(entitySet));

        // Filter to only relationships where both endpoints are in our entity set
        const seenRelIds = new Set<string>();
        const allRelationships: Relationship[] = [];
        for (const rel of allRels) {
            if (
                entitySet.has(rel.fromEntityId) &&
                entitySet.has(rel.toEntityId) &&
                !seenRelIds.has(rel.id)
            ) {
                seenRelIds.add(rel.id);
                allRelationships.push(rel);
            }
        }

        return {
            entities,
            relationships: allRelationships,
            paths: allPaths,
        };
    }

    // ========================================================================
    // Q-Value Operations
    // ========================================================================

    /**
     * Update Q-value for an entity
     */
    public async updateEntityQValue(
        entityId: string,
        reward: number,
        reason: string
    ): Promise<Entity | null> {
        if (!this.enabled || !isQValueLearningEnabled()) {
            return null;
        }

        const entity = await this.repository.getEntity(entityId);
        if (!entity) {
            return null;
        }

        // EMA update: new_q = old_q + alpha * (reward - old_q)
        const alpha = getQValueLearningRate();
        const oldQValue = entity.utility.qValue;
        const newQValue = oldQValue + alpha * (reward - oldQValue);

        const updated = await this.repository.updateEntityQValue(entityId, newQValue, reason);

        if (updated) {
            this.emitEvent(
                KnowledgeGraphEvents.ENTITY_QVALUE_UPDATED,
                entity.channelId,
                'system',
                {
                    entityId,
                    channelId: entity.channelId,
                    oldQValue,
                    newQValue,
                    reason,
                }
            );
        }

        return updated;
    }

    /**
     * Propagate reward to entities involved in a task
     */
    public async propagateReward(
        entityIds: string[],
        reward: number,
        taskId?: string
    ): Promise<void> {
        if (!this.enabled || !isQValueLearningEnabled() || entityIds.length === 0) {
            return;
        }

        const updates: Array<{ entityId: string; qValue: number; reason: string }> = [];
        const alpha = getQValueLearningRate();
        let channelId: ChannelId | null = null;

        for (const entityId of entityIds) {
            const entity = await this.repository.getEntity(entityId);
            if (entity) {
                if (!channelId) channelId = entity.channelId;

                const newQValue = entity.utility.qValue + alpha * (reward - entity.utility.qValue);
                updates.push({
                    entityId,
                    qValue: newQValue,
                    reason: taskId ? `Task ${taskId} outcome` : 'Reward propagation',
                });
            }
        }

        if (updates.length > 0) {
            await this.repository.batchUpdateQValues(updates);

            // Record outcome
            await this.repository.recordOutcome(entityIds, reward > 0.5);

            // Emit batch update event
            if (channelId) {
                this.emitEvent(
                    KnowledgeGraphEvents.ENTITY_QVALUE_BATCH_UPDATED,
                    channelId,
                    'system',
                    {
                        channelId,
                        updates: updates.map((u) => {
                            const entity = entityIds.find((id) => id === u.entityId);
                            return {
                                entityId: u.entityId,
                                oldQValue: 0, // We don't track old values in batch
                                newQValue: u.qValue,
                            };
                        }),
                        reason: taskId ? `Task ${taskId} outcome` : 'Reward propagation',
                        taskId,
                    }
                );
            }
        }
    }

    /**
     * Get high-utility entities
     */
    public async getHighUtilityEntities(
        channelId: ChannelId,
        limit?: number
    ): Promise<Entity[]> {
        if (!this.enabled) {
            return [];
        }

        return this.repository.getHighUtilityEntities(channelId, limit);
    }

    // ========================================================================
    // Memory Linking
    // ========================================================================

    /**
     * Link memory to entities
     */
    public async linkMemoryToEntities(memoryId: string, entityIds: string[]): Promise<void> {
        if (!this.enabled) {
            return;
        }

        await this.repository.linkMemoryToEntities(memoryId, entityIds);
    }

    /**
     * Get entities for a memory
     */
    public async getEntitiesForMemory(memoryId: string): Promise<Entity[]> {
        if (!this.enabled) {
            return [];
        }

        return this.repository.getEntitiesForMemory(memoryId);
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    /**
     * Emit a knowledge graph event
     */
    private emitEvent(
        eventType: string,
        channelId: ChannelId,
        agentId: AgentId | string,
        data: any
    ): void {
        try {
            const payload = createBaseEventPayload(
                eventType,
                agentId,
                channelId,
                data
            );
            EventBus.server.emit(eventType, payload);
        } catch (error: any) {
            this.logger.warn(`Failed to emit event ${eventType}: ${error.message}`);
        }
    }
}
