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
 * MongoDB Knowledge Graph Repository
 *
 * Implements IKnowledgeGraphRepository using MongoDB with Mongoose models.
 * Provides entity and relationship CRUD, graph queries, and Q-value operations.
 */

import { v4 as uuidv4 } from 'uuid';
import { EntityModel, IEntity, toEntityObject } from '../../../models/entity';
import { RelationshipModel, IRelationship, toRelationshipObject } from '../../../models/relationship';
import { IKnowledgeGraphRepository } from '../../../repositories/interfaces/IKnowledgeGraphRepository';
import { ChannelId } from '../../../types/ChannelContext';
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
    DEFAULT_ENTITY_UTILITY,
} from '../../../types/KnowledgeGraphTypes';
import { isKnowledgeGraphEnabled, getContextLimits } from '../../../config/knowledge-graph.config';
import { Logger } from '../../../utils/Logger';

const logger = new Logger('info', 'MongoKnowledgeGraphRepository', 'server');

/**
 * MongoDB implementation of IKnowledgeGraphRepository
 */
export class MongoKnowledgeGraphRepository implements IKnowledgeGraphRepository {
    private static instance: MongoKnowledgeGraphRepository;

    private constructor() {}

    /**
     * Get singleton instance
     */
    public static getInstance(): MongoKnowledgeGraphRepository {
        if (!MongoKnowledgeGraphRepository.instance) {
            MongoKnowledgeGraphRepository.instance = new MongoKnowledgeGraphRepository();
        }
        return MongoKnowledgeGraphRepository.instance;
    }

    // ========================================================================
    // Entity CRUD Operations
    // ========================================================================

    async createEntity(request: CreateEntityRequest): Promise<Entity> {
        const entity = new EntityModel({
            channelId: request.channelId,
            type: request.type,
            name: request.name,
            aliases: request.aliases || [],
            description: request.description,
            properties: request.properties || {},
            utility: { ...DEFAULT_ENTITY_UTILITY },
            confidence: request.confidence ?? 1.0,
            source: request.source || 'manual',
            sourceMemoryIds: request.sourceMemoryIds || [],
            merged: false,
            customType: request.customType,
        });

        const saved = await entity.save();
        logger.debug(`Created entity: ${saved.name} (${saved.type}) in channel ${request.channelId}`);
        return toEntityObject(saved);
    }

    async getEntity(entityId: string): Promise<Entity | null> {
        const doc = await EntityModel.findById(entityId);
        return doc ? toEntityObject(doc) : null;
    }

    async updateEntity(entityId: string, updates: Partial<Entity>): Promise<Entity | null> {
        const doc = await EntityModel.findByIdAndUpdate(
            entityId,
            { $set: updates },
            { new: true }
        );
        return doc ? toEntityObject(doc) : null;
    }

    async deleteEntity(entityId: string): Promise<boolean> {
        const result = await EntityModel.deleteOne({ _id: entityId });
        if (result.deletedCount > 0) {
            // Also delete relationships involving this entity
            await RelationshipModel.deleteMany({
                $or: [
                    { fromEntityId: entityId },
                    { toEntityId: entityId },
                ],
            });
            return true;
        }
        return false;
    }

    async findEntities(
        channelId: ChannelId,
        filter?: EntityFilter,
        limit?: number
    ): Promise<Entity[]> {
        const query: any = { channelId, merged: false };

        if (filter) {
            if (filter.type) {
                query.type = Array.isArray(filter.type) ? { $in: filter.type } : filter.type;
            }
            if (filter.name) {
                query.name = filter.name;
            }
            if (filter.nameContains) {
                query.name = { $regex: filter.nameContains, $options: 'i' };
            }
            if (filter.alias) {
                query.aliases = filter.alias;
            }
            if (filter.minQValue !== undefined) {
                query['utility.qValue'] = { $gte: filter.minQValue };
            }
            if (filter.maxQValue !== undefined) {
                query['utility.qValue'] = {
                    ...query['utility.qValue'],
                    $lte: filter.maxQValue,
                };
            }
            if (filter.minConfidence !== undefined) {
                query.confidence = { $gte: filter.minConfidence };
            }
        }

        let q = EntityModel.find(query).sort({ 'utility.qValue': -1 });
        if (limit) {
            q = q.limit(limit);
        }

        const docs = await q.lean();
        return docs.map((doc: any) => toEntityObject(doc as IEntity));
    }

    async findEntityByName(
        channelId: ChannelId,
        name: string,
        exact?: boolean
    ): Promise<Entity[]> {
        const query: any = { channelId, merged: false };

        if (exact) {
            query.name = name;
        } else {
            query.$or = [
                { name: { $regex: name, $options: 'i' } },
                { aliases: { $regex: name, $options: 'i' } },
            ];
        }

        const docs = await EntityModel.find(query).lean();
        return docs.map((doc: any) => toEntityObject(doc as IEntity));
    }

    async findEntityByAlias(channelId: ChannelId, alias: string): Promise<Entity[]> {
        const docs = await EntityModel.find({
            channelId,
            merged: false,
            aliases: { $regex: alias, $options: 'i' },
        }).lean();
        return docs.map((doc: any) => toEntityObject(doc as IEntity));
    }

    async findOrCreateEntity(request: CreateEntityRequest): Promise<Entity> {
        // Try to find existing entity by name
        const existing = await EntityModel.findOne({
            channelId: request.channelId,
            type: request.type,
            name: { $regex: `^${request.name}$`, $options: 'i' },
            merged: false,
        });

        if (existing) {
            // Update aliases if new ones provided
            if (request.aliases && request.aliases.length > 0) {
                const newAliases = request.aliases.filter(
                    (a) => !existing.aliases.includes(a)
                );
                if (newAliases.length > 0) {
                    existing.aliases.push(...newAliases);
                    await existing.save();
                }
            }
            return toEntityObject(existing);
        }

        return this.createEntity(request);
    }

    async mergeEntities(
        targetEntityId: string,
        sourceEntityIds: string[]
    ): Promise<EntityMergeResult> {
        const target = await EntityModel.findById(targetEntityId);
        if (!target) {
            return {
                success: false,
                sourceEntityIds,
                error: 'Target entity not found',
            };
        }

        const sources = await EntityModel.find({ _id: { $in: sourceEntityIds } });
        if (sources.length === 0) {
            return {
                success: false,
                sourceEntityIds,
                error: 'No source entities found',
            };
        }

        // Merge aliases
        const allAliases = new Set(target.aliases);
        for (const source of sources) {
            allAliases.add(source.name);
            source.aliases.forEach((a: string) => allAliases.add(a));
        }
        target.aliases = Array.from(allAliases);

        // Merge source memory IDs
        const allMemoryIds = new Set(target.sourceMemoryIds);
        for (const source of sources) {
            source.sourceMemoryIds.forEach((id: string) => allMemoryIds.add(id));
        }
        target.sourceMemoryIds = Array.from(allMemoryIds);

        // Mark sources as merged
        await EntityModel.updateMany(
            { _id: { $in: sourceEntityIds } },
            {
                $set: {
                    merged: true,
                    mergedInto: targetEntityId,
                },
            }
        );

        // Update relationships to point to target
        await RelationshipModel.updateMany(
            { fromEntityId: { $in: sourceEntityIds } },
            { $set: { fromEntityId: targetEntityId } }
        );
        await RelationshipModel.updateMany(
            { toEntityId: { $in: sourceEntityIds } },
            { $set: { toEntityId: targetEntityId } }
        );

        await target.save();

        logger.info(`Merged ${sources.length} entities into ${target.name}`);

        return {
            success: true,
            mergedEntity: toEntityObject(target),
            sourceEntityIds,
        };
    }

    async findSimilarEntities(
        channelId: ChannelId,
        threshold?: number
    ): Promise<EntitySimilarity[]> {
        const similarityThreshold = threshold ?? 0.8;
        const entities = await this.findEntities(channelId);

        const similarities: EntitySimilarity[] = [];

        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const e1 = entities[i];
                const e2 = entities[j];

                // Skip different types
                if (e1.type !== e2.type) continue;

                // Calculate similarity
                const nameSimilarity = this.calculateStringSimilarity(e1.name, e2.name);
                const aliasSimilarity = this.calculateAliasSimilarity(e1.aliases, e2.aliases);

                const similarity = Math.max(nameSimilarity, aliasSimilarity);

                if (similarity >= similarityThreshold) {
                    const reasons: string[] = [];
                    if (nameSimilarity >= similarityThreshold) {
                        reasons.push(`Similar names: "${e1.name}" / "${e2.name}"`);
                    }
                    if (aliasSimilarity >= similarityThreshold) {
                        reasons.push('Overlapping aliases');
                    }

                    similarities.push({
                        entity1: e1,
                        entity2: e2,
                        similarity,
                        reasons,
                    });
                }
            }
        }

        return similarities.sort((a, b) => b.similarity - a.similarity);
    }

    private calculateStringSimilarity(s1: string, s2: string): number {
        const str1 = s1.toLowerCase();
        const str2 = s2.toLowerCase();

        if (str1 === str2) return 1;

        // Simple Levenshtein-based similarity
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1;

        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    private levenshteinDistance(s1: string, s2: string): number {
        const dp: number[][] = Array(s1.length + 1)
            .fill(null)
            .map(() => Array(s2.length + 1).fill(0));

        for (let i = 0; i <= s1.length; i++) dp[i][0] = i;
        for (let j = 0; j <= s2.length; j++) dp[0][j] = j;

        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }

        return dp[s1.length][s2.length];
    }

    private calculateAliasSimilarity(aliases1: string[], aliases2: string[]): number {
        if (aliases1.length === 0 || aliases2.length === 0) return 0;

        const set1 = new Set(aliases1.map((a) => a.toLowerCase()));
        const set2 = new Set(aliases2.map((a) => a.toLowerCase()));

        let intersection = 0;
        for (const a of set1) {
            if (set2.has(a)) intersection++;
        }

        const union = set1.size + set2.size - intersection;
        return union > 0 ? intersection / union : 0;
    }

    // ========================================================================
    // Relationship CRUD Operations
    // ========================================================================

    async createRelationship(request: CreateRelationshipRequest): Promise<Relationship> {
        const relationship = new RelationshipModel({
            channelId: request.channelId,
            fromEntityId: request.fromEntityId,
            toEntityId: request.toEntityId,
            type: request.type,
            label: request.label,
            properties: request.properties || {},
            confidence: request.confidence ?? 1.0,
            surpriseScore: 0,
            source: request.source || 'manual',
            sourceMemoryIds: request.sourceMemoryIds || [],
            weight: request.weight ?? 1.0,
            customType: request.customType,
        });

        const saved = await relationship.save();
        logger.debug(
            `Created relationship: ${request.fromEntityId} -[${request.type}]-> ${request.toEntityId}`
        );
        return toRelationshipObject(saved);
    }

    async getRelationship(relationshipId: string): Promise<Relationship | null> {
        const doc = await RelationshipModel.findById(relationshipId);
        return doc ? toRelationshipObject(doc) : null;
    }

    async updateRelationship(
        relationshipId: string,
        updates: Partial<Relationship>
    ): Promise<Relationship | null> {
        const doc = await RelationshipModel.findByIdAndUpdate(
            relationshipId,
            { $set: updates },
            { new: true }
        );
        return doc ? toRelationshipObject(doc) : null;
    }

    async deleteRelationship(relationshipId: string): Promise<boolean> {
        const result = await RelationshipModel.deleteOne({ _id: relationshipId });
        return result.deletedCount > 0;
    }

    async getRelationshipsBetween(
        fromEntityId: string,
        toEntityId: string,
        type?: RelationshipType
    ): Promise<Relationship[]> {
        const query: any = { fromEntityId, toEntityId };
        if (type) {
            query.type = type;
        }

        const docs = await RelationshipModel.find(query).lean();
        return docs.map((doc: any) => toRelationshipObject(doc as IRelationship));
    }

    async getEntityRelationships(
        entityId: string,
        filter?: RelationshipFilter
    ): Promise<Relationship[]> {
        const query: any = {
            $or: [{ fromEntityId: entityId }, { toEntityId: entityId }],
        };

        if (filter) {
            if (filter.type) {
                query.type = Array.isArray(filter.type) ? { $in: filter.type } : filter.type;
            }
            if (filter.minConfidence !== undefined) {
                query.confidence = { $gte: filter.minConfidence };
            }
            if (filter.maxSurpriseScore !== undefined) {
                query.surpriseScore = { $lte: filter.maxSurpriseScore };
            }
            if (filter.minSurpriseScore !== undefined) {
                query.surpriseScore = {
                    ...query.surpriseScore,
                    $gte: filter.minSurpriseScore,
                };
            }
            if (filter.minWeight !== undefined) {
                query.weight = { $gte: filter.minWeight };
            }
        }

        const docs = await RelationshipModel.find(query).lean();
        return docs.map((doc: any) => toRelationshipObject(doc as IRelationship));
    }

    // ========================================================================
    // Graph Query Operations
    // ========================================================================

    async getNeighbors(
        entityId: string,
        options?: {
            direction?: 'incoming' | 'outgoing' | 'both';
            relationshipType?: RelationshipType | RelationshipType[];
            entityType?: EntityType | EntityType[];
            maxDepth?: number;
            limit?: number;
        }
    ): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
        const direction = options?.direction || 'both';
        const limit = options?.limit || 100;

        let relationshipQuery: any = {};

        if (direction === 'outgoing') {
            relationshipQuery = { fromEntityId: entityId };
        } else if (direction === 'incoming') {
            relationshipQuery = { toEntityId: entityId };
        } else {
            relationshipQuery = {
                $or: [{ fromEntityId: entityId }, { toEntityId: entityId }],
            };
        }

        if (options?.relationshipType) {
            relationshipQuery.type = Array.isArray(options.relationshipType)
                ? { $in: options.relationshipType }
                : options.relationshipType;
        }

        const relationships = await RelationshipModel.find(relationshipQuery)
            .limit(limit)
            .lean();

        const neighborIds = new Set<string>();
        for (const rel of relationships) {
            if (rel.fromEntityId !== entityId) neighborIds.add(rel.fromEntityId);
            if (rel.toEntityId !== entityId) neighborIds.add(rel.toEntityId);
        }

        let entityQuery: any = {
            _id: { $in: Array.from(neighborIds) },
            merged: false,
        };

        if (options?.entityType) {
            entityQuery.type = Array.isArray(options.entityType)
                ? { $in: options.entityType }
                : options.entityType;
        }

        const entities = await EntityModel.find(entityQuery).lean();

        return {
            entities: entities.map((doc: any) => toEntityObject(doc as IEntity)),
            relationships: relationships.map((doc: any) => toRelationshipObject(doc as IRelationship)),
        };
    }

    async findPath(
        fromEntityId: string,
        toEntityId: string,
        maxHops?: number
    ): Promise<GraphPath | null> {
        const paths = await this.findAllPaths(fromEntityId, toEntityId, maxHops, 1);
        return paths.length > 0 ? paths[0] : null;
    }

    async findAllPaths(
        fromEntityId: string,
        toEntityId: string,
        maxHops?: number,
        limit?: number
    ): Promise<GraphPath[]> {
        const maxDepth = maxHops ?? 5;
        const maxPaths = limit ?? 10;

        // BFS to find paths
        const paths: GraphPath[] = [];
        const queue: Array<{
            currentId: string;
            path: string[];
            relationships: string[];
            confidence: number;
            weight: number;
        }> = [
            {
                currentId: fromEntityId,
                path: [fromEntityId],
                relationships: [],
                confidence: 1,
                weight: 0,
            },
        ];

        const visited = new Map<string, number>(); // Track minimum path length to each node

        while (queue.length > 0 && paths.length < maxPaths) {
            const current = queue.shift()!;

            if (current.path.length > maxDepth + 1) continue;

            // Check if we've found a shorter path to this node before
            const prevLength = visited.get(current.currentId);
            if (prevLength !== undefined && prevLength < current.path.length) {
                continue;
            }
            visited.set(current.currentId, current.path.length);

            if (current.currentId === toEntityId && current.path.length > 1) {
                paths.push({
                    entityIds: current.path,
                    relationshipIds: current.relationships,
                    length: current.path.length - 1,
                    confidence: current.confidence,
                    totalWeight: current.weight,
                });
                continue;
            }

            // Get outgoing relationships
            const rels = await RelationshipModel.find({
                fromEntityId: current.currentId,
            }).lean();

            for (const rel of rels) {
                if (!current.path.includes(rel.toEntityId)) {
                    queue.push({
                        currentId: rel.toEntityId,
                        path: [...current.path, rel.toEntityId],
                        relationships: [...current.relationships, rel._id.toString()],
                        confidence: current.confidence * rel.confidence,
                        weight: current.weight + rel.weight,
                    });
                }
            }
        }

        return paths.sort((a, b) => a.length - b.length);
    }

    async query(channelId: ChannelId, query: GraphQuery): Promise<GraphQueryResult> {
        const startTime = Date.now();

        const entities: Entity[] = [];
        const relationships: Relationship[] = [];

        // Start with entities
        if (query.startFilters) {
            const found = await this.findEntities(channelId, query.startFilters, query.limit);
            entities.push(...found);
        }

        // If no start filters, get all entities
        if (!query.startFilters && entities.length === 0) {
            const all = await this.findEntities(channelId, undefined, query.limit);
            entities.push(...all);
        }

        // Get relationships for found entities
        if (entities.length > 0) {
            const entityIds = entities.map((e) => e.id);

            const relQuery: any = {
                channelId,
                $or: [
                    { fromEntityId: { $in: entityIds } },
                    { toEntityId: { $in: entityIds } },
                ],
            };

            if (query.relationshipFilters) {
                if (query.relationshipFilters.type) {
                    relQuery.type = Array.isArray(query.relationshipFilters.type)
                        ? { $in: query.relationshipFilters.type }
                        : query.relationshipFilters.type;
                }
                if (query.relationshipFilters.minConfidence !== undefined) {
                    relQuery.confidence = { $gte: query.relationshipFilters.minConfidence };
                }
            }

            const rels = await RelationshipModel.find(relQuery).lean();
            relationships.push(...rels.map((doc: any) => toRelationshipObject(doc as IRelationship)));
        }

        return {
            entities,
            relationships,
            totalCount: entities.length,
            executionTimeMs: Date.now() - startTime,
        };
    }

    async getSubgraph(
        entityId: string,
        depth?: number,
        limit?: number
    ): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
        const maxDepth = depth ?? 2;
        const maxEntities = limit ?? 50;

        const entityIds = new Set<string>([entityId]);
        const relationships: Relationship[] = [];

        let currentLevel = [entityId];

        for (let d = 0; d < maxDepth && entityIds.size < maxEntities; d++) {
            const nextLevel: string[] = [];

            for (const id of currentLevel) {
                const neighbors = await this.getNeighbors(id, {
                    limit: Math.min(10, maxEntities - entityIds.size),
                });

                for (const rel of neighbors.relationships) {
                    if (!relationships.find((r) => r.id === rel.id)) {
                        relationships.push(rel);
                    }
                }

                for (const entity of neighbors.entities) {
                    if (!entityIds.has(entity.id) && entityIds.size < maxEntities) {
                        entityIds.add(entity.id);
                        nextLevel.push(entity.id);
                    }
                }
            }

            currentLevel = nextLevel;
        }

        const entities = await EntityModel.find({
            _id: { $in: Array.from(entityIds) },
        }).lean();

        return {
            entities: entities.map((doc: any) => toEntityObject(doc as IEntity)),
            relationships,
        };
    }

    // ========================================================================
    // Batch Operations
    // ========================================================================

    async getEntitiesByIds(entityIds: string[]): Promise<Entity[]> {
        if (entityIds.length === 0) {
            return [];
        }

        const docs = await EntityModel.find({
            _id: { $in: entityIds },
            merged: false,
        }).lean();
        return docs.map((doc: any) => toEntityObject(doc as IEntity));
    }

    async getRelationshipsByEntityIds(entityIds: string[]): Promise<Relationship[]> {
        if (entityIds.length === 0) {
            return [];
        }

        const docs = await RelationshipModel.find({
            $or: [
                { fromEntityId: { $in: entityIds } },
                { toEntityId: { $in: entityIds } },
            ],
        }).lean();
        return docs.map((doc: any) => toRelationshipObject(doc as IRelationship));
    }

    // ========================================================================
    // Memory Linking Operations
    // ========================================================================

    async linkMemoryToEntities(memoryId: string, entityIds: string[]): Promise<void> {
        await EntityModel.updateMany(
            { _id: { $in: entityIds } },
            { $addToSet: { sourceMemoryIds: memoryId } }
        );
    }

    async getEntitiesForMemory(memoryId: string): Promise<Entity[]> {
        const docs = await EntityModel.find({
            sourceMemoryIds: memoryId,
            merged: false,
        }).lean();
        return docs.map((doc: any) => toEntityObject(doc as IEntity));
    }

    async getMemoriesForEntity(entityId: string): Promise<string[]> {
        const entity = await EntityModel.findById(entityId);
        return entity?.sourceMemoryIds || [];
    }

    // ========================================================================
    // Q-Value / MULS Operations
    // ========================================================================

    async updateEntityQValue(
        entityId: string,
        newQValue: number,
        reason: string
    ): Promise<Entity | null> {
        const doc = await EntityModel.findByIdAndUpdate(
            entityId,
            {
                $set: {
                    'utility.qValue': newQValue,
                    'utility.lastQValueUpdateAt': Date.now(),
                },
            },
            { new: true }
        );

        if (doc) {
            logger.debug(`Updated Q-value for ${doc.name}: ${newQValue} (${reason})`);
        }

        return doc ? toEntityObject(doc) : null;
    }

    async batchUpdateQValues(
        updates: Array<{ entityId: string; qValue: number; reason: string }>
    ): Promise<void> {
        const bulkOps = updates.map((update) => ({
            updateOne: {
                filter: { _id: update.entityId },
                update: {
                    $set: {
                        'utility.qValue': update.qValue,
                        'utility.lastQValueUpdateAt': Date.now(),
                    },
                },
            },
        }));

        if (bulkOps.length > 0) {
            await EntityModel.bulkWrite(bulkOps);
            logger.debug(`Batch updated ${bulkOps.length} entity Q-values`);
        }
    }

    async getEntitiesByQValue(
        channelId: ChannelId,
        minQValue?: number,
        maxQValue?: number,
        limit?: number
    ): Promise<Entity[]> {
        const query: any = { channelId, merged: false };

        if (minQValue !== undefined || maxQValue !== undefined) {
            query['utility.qValue'] = {};
            if (minQValue !== undefined) {
                query['utility.qValue'].$gte = minQValue;
            }
            if (maxQValue !== undefined) {
                query['utility.qValue'].$lte = maxQValue;
            }
        }

        let q = EntityModel.find(query).sort({ 'utility.qValue': -1 });
        if (limit) {
            q = q.limit(limit);
        }

        const docs = await q.lean();
        return docs.map((doc: any) => toEntityObject(doc as IEntity));
    }

    async incrementRetrievalCount(entityIds: string[]): Promise<void> {
        await EntityModel.updateMany(
            { _id: { $in: entityIds } },
            {
                $inc: { 'utility.retrievalCount': 1 },
                $set: { 'utility.lastAccessedAt': Date.now() },
            }
        );
    }

    async recordOutcome(entityIds: string[], success: boolean): Promise<void> {
        const field = success ? 'utility.successCount' : 'utility.failureCount';
        await EntityModel.updateMany(
            { _id: { $in: entityIds } },
            { $inc: { [field]: 1 } }
        );
    }

    // ========================================================================
    // Context Operations
    // ========================================================================

    async getGraphContext(
        channelId: ChannelId,
        taskId?: string,
        keywords?: string[]
    ): Promise<GraphContext> {
        const limits = getContextLimits();

        // Get high-utility entities
        const highUtilityEntities = await this.getEntitiesByQValue(
            channelId,
            0.6, // Higher Q-value threshold for context
            undefined,
            Math.floor(limits.maxEntities / 2)
        );

        // Get entities matching keywords
        let keywordEntities: Entity[] = [];
        if (keywords && keywords.length > 0) {
            for (const keyword of keywords.slice(0, 5)) {
                const found = await this.findEntityByName(channelId, keyword, false);
                keywordEntities.push(...found);
            }
            // Deduplicate
            const seen = new Set<string>();
            keywordEntities = keywordEntities.filter((e) => {
                if (seen.has(e.id)) return false;
                seen.add(e.id);
                return true;
            });
        }

        // Combine entities
        const allEntityIds = new Set<string>();
        const centralEntities: Entity[] = [];
        const relatedEntities: Entity[] = [];

        // Keywords are central
        for (const e of keywordEntities) {
            if (!allEntityIds.has(e.id) && centralEntities.length < limits.maxEntities) {
                allEntityIds.add(e.id);
                centralEntities.push(e);
            }
        }

        // High utility as related
        for (const e of highUtilityEntities) {
            if (!allEntityIds.has(e.id) && relatedEntities.length < limits.maxEntities / 2) {
                allEntityIds.add(e.id);
                relatedEntities.push(e);
            }
        }

        // Get relationships between context entities
        const entityIdArray = Array.from(allEntityIds);
        const relationships = await RelationshipModel.find({
            channelId,
            fromEntityId: { $in: entityIdArray },
            toEntityId: { $in: entityIdArray },
        })
            .limit(limits.maxRelationships)
            .lean();

        // Calculate stats
        const allEntities = [...centralEntities, ...relatedEntities];
        const qValues = allEntities.map((e) => e.utility.qValue);
        const avgQValue = qValues.length > 0 ? qValues.reduce((a, b) => a + b, 0) / qValues.length : 0;
        const maxQValue = qValues.length > 0 ? Math.max(...qValues) : 0;
        const confidences = allEntities.map((e) => e.confidence);
        const avgConfidence =
            confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

        return {
            centralEntities,
            relatedEntities,
            relationships: relationships.map((doc: any) => toRelationshipObject(doc as IRelationship)),
            highUtilityEntities,
            stats: {
                entityCount: allEntities.length,
                relationshipCount: relationships.length,
                avgQValue,
                maxQValue,
                avgConfidence,
            },
        };
    }

    async getHighUtilityEntities(channelId: ChannelId, limit?: number): Promise<Entity[]> {
        return this.getEntitiesByQValue(channelId, 0.5, undefined, limit || 20);
    }
}
