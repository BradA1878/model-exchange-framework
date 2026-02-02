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
 * Knowledge Graph Tools for MXF
 *
 * MCP tools for agents to interact with the Knowledge Graph system.
 * Provides tools for entity/relationship management, graph queries,
 * context retrieval, and entity extraction.
 */

import { Logger } from '../../../utils/Logger';
import { KnowledgeGraphService } from '../../../services/kg/KnowledgeGraphService';
import { EntityExtractionService } from '../../../services/kg/EntityExtractionService';
import { OrparGraphIntegration } from '../../../services/kg/OrparGraphIntegration';
import { isKnowledgeGraphEnabled } from '../../../config/knowledge-graph.config';
import { EntityType, RelationshipType } from '../../../types/KnowledgeGraphTypes';

const logger = new Logger('info', 'KnowledgeGraphTools', 'server');

/**
 * Helper to get Knowledge Graph service
 */
function getKgService(): KnowledgeGraphService {
    return KnowledgeGraphService.getInstance();
}

/**
 * Helper to get extraction service
 */
function getExtractionService(): EntityExtractionService {
    return EntityExtractionService.getInstance();
}

/**
 * Helper to get ORPAR integration
 */
function getOrparIntegration(): OrparGraphIntegration {
    return OrparGraphIntegration.getInstance();
}

/**
 * Get an entity by ID
 */
export const kg_get_entity = {
    name: 'kg_get_entity',
    description: 'Get a specific entity from the Knowledge Graph by its ID. Returns entity details including type, name, aliases, description, and utility metrics (Q-value).',
    inputSchema: {
        type: 'object',
        properties: {
            entityId: {
                type: 'string',
                description: 'The unique ID of the entity to retrieve',
            },
        },
        required: ['entityId'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    entity: null,
                    message: 'Knowledge Graph is disabled. Enable with KNOWLEDGE_GRAPH_ENABLED=true',
                };
            }

            const kgService = getKgService();
            const entity = await kgService.getEntity(args.entityId);

            if (!entity) {
                return {
                    success: false,
                    entity: null,
                    message: `Entity not found: ${args.entityId}`,
                };
            }

            return {
                success: true,
                entity,
                message: `Found entity: ${entity.name} (${entity.type})`,
            };
        } catch (error: any) {
            logger.error('Failed to get entity', { error: error.message });
            return {
                success: false,
                entity: null,
                message: 'Failed to get entity',
                error: error.message,
            };
        }
    },
};

/**
 * Find entities by name
 */
export const kg_find_entity = {
    name: 'kg_find_entity',
    description: 'Find entities by name or alias in the Knowledge Graph. Supports exact or partial matching.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            name: {
                type: 'string',
                description: 'Name or alias to search for',
            },
            exact: {
                type: 'boolean',
                default: false,
                description: 'Whether to require exact match (false for partial matching)',
            },
            limit: {
                type: 'number',
                minimum: 1,
                maximum: 50,
                default: 10,
                description: 'Maximum number of entities to return',
            },
        },
        required: ['name'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    entities: [],
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    entities: [],
                    message: 'channelId is required but not provided',
                };
            }

            const kgService = getKgService();
            const entities = await kgService.findEntityByName(
                channelId,
                args.name,
                args.exact || false
            );

            const limitedEntities = entities.slice(0, args.limit || 10);

            return {
                success: true,
                entities: limitedEntities,
                count: limitedEntities.length,
                totalFound: entities.length,
                message: entities.length > 0
                    ? `Found ${entities.length} entities matching "${args.name}"`
                    : `No entities found matching "${args.name}"`,
            };
        } catch (error: any) {
            logger.error('Failed to find entity', { error: error.message });
            return {
                success: false,
                entities: [],
                message: 'Failed to find entity',
                error: error.message,
            };
        }
    },
};

/**
 * Get neighbors of an entity
 */
export const kg_get_neighbors = {
    name: 'kg_get_neighbors',
    description: 'Get entities connected to a specific entity. Returns neighboring entities and the relationships between them.',
    inputSchema: {
        type: 'object',
        properties: {
            entityId: {
                type: 'string',
                description: 'The entity ID to find neighbors for',
            },
            direction: {
                type: 'string',
                enum: ['incoming', 'outgoing', 'both'],
                default: 'both',
                description: 'Direction of relationships to follow',
            },
            relationshipType: {
                type: 'string',
                description: 'Filter by specific relationship type',
            },
            limit: {
                type: 'number',
                minimum: 1,
                maximum: 100,
                default: 20,
                description: 'Maximum number of neighbors to return',
            },
        },
        required: ['entityId'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    entities: [],
                    relationships: [],
                    message: 'Knowledge Graph is disabled',
                };
            }

            const kgService = getKgService();
            const result = await kgService.getNeighbors(args.entityId, {
                direction: args.direction || 'both',
                relationshipType: args.relationshipType as RelationshipType | undefined,
                limit: args.limit || 20,
            });

            return {
                success: true,
                entities: result.entities,
                relationships: result.relationships,
                entityCount: result.entities.length,
                relationshipCount: result.relationships.length,
                message: `Found ${result.entities.length} connected entities`,
            };
        } catch (error: any) {
            logger.error('Failed to get neighbors', { error: error.message });
            return {
                success: false,
                entities: [],
                relationships: [],
                message: 'Failed to get neighbors',
                error: error.message,
            };
        }
    },
};

/**
 * Find path between entities
 */
export const kg_find_path = {
    name: 'kg_find_path',
    description: 'Find the shortest path between two entities in the Knowledge Graph. Returns the sequence of entities and relationships connecting them.',
    inputSchema: {
        type: 'object',
        properties: {
            fromEntityId: {
                type: 'string',
                description: 'Starting entity ID',
            },
            toEntityId: {
                type: 'string',
                description: 'Target entity ID',
            },
            maxHops: {
                type: 'number',
                minimum: 1,
                maximum: 10,
                default: 5,
                description: 'Maximum number of hops (relationships) to traverse',
            },
        },
        required: ['fromEntityId', 'toEntityId'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    path: null,
                    message: 'Knowledge Graph is disabled',
                };
            }

            const kgService = getKgService();
            const path = await kgService.findPath(
                args.fromEntityId,
                args.toEntityId,
                args.maxHops || 5
            );

            if (!path) {
                return {
                    success: true,
                    path: null,
                    found: false,
                    message: `No path found between entities within ${args.maxHops || 5} hops`,
                };
            }

            return {
                success: true,
                path,
                found: true,
                hopCount: path.relationshipIds.length,
                message: `Found path with ${path.relationshipIds.length} hops`,
            };
        } catch (error: any) {
            logger.error('Failed to find path', { error: error.message });
            return {
                success: false,
                path: null,
                message: 'Failed to find path',
                error: error.message,
            };
        }
    },
};

/**
 * Get graph context for a task
 */
export const kg_get_context = {
    name: 'kg_get_context',
    description: 'Get relevant graph context for a task or query. Returns entities, relationships, and high-utility entities based on keywords.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            taskId: {
                type: 'string',
                description: 'Optional task ID for task-specific context',
            },
            keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'Keywords to find relevant entities',
            },
        },
        required: [],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    context: null,
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    context: null,
                    message: 'channelId is required but not provided',
                };
            }

            const kgService = getKgService();
            const graphContext = await kgService.getGraphContext(
                channelId,
                args.taskId,
                args.keywords
            );

            return {
                success: true,
                context: graphContext,
                stats: graphContext.stats,
                message: `Retrieved context with ${graphContext.stats.entityCount} entities and ${graphContext.stats.relationshipCount} relationships`,
            };
        } catch (error: any) {
            logger.error('Failed to get context', { error: error.message });
            return {
                success: false,
                context: null,
                message: 'Failed to get context',
                error: error.message,
            };
        }
    },
};

/**
 * Get high-utility entities
 */
export const kg_get_high_utility_entities = {
    name: 'kg_get_high_utility_entities',
    description: 'Get entities with the highest Q-values (utility scores) in the channel. These are entities that have been most useful in past tasks.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            limit: {
                type: 'number',
                minimum: 1,
                maximum: 50,
                default: 10,
                description: 'Maximum number of entities to return',
            },
        },
        required: [],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    entities: [],
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    entities: [],
                    message: 'channelId is required but not provided',
                };
            }

            const kgService = getKgService();
            const entities = await kgService.getHighUtilityEntities(
                channelId,
                args.limit || 10
            );

            return {
                success: true,
                entities,
                count: entities.length,
                message: `Found ${entities.length} high-utility entities`,
            };
        } catch (error: any) {
            logger.error('Failed to get high utility entities', { error: error.message });
            return {
                success: false,
                entities: [],
                message: 'Failed to get high utility entities',
                error: error.message,
            };
        }
    },
};

/**
 * Create an entity
 */
export const kg_create_entity = {
    name: 'kg_create_entity',
    description: 'Create a new entity in the Knowledge Graph. Use this to manually add entities discovered during tasks.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            name: {
                type: 'string',
                description: 'Name of the entity',
            },
            type: {
                type: 'string',
                enum: Object.values(EntityType),
                description: 'Type of entity (person, organization, project, etc.)',
            },
            aliases: {
                type: 'array',
                items: { type: 'string' },
                description: 'Alternative names for this entity',
            },
            description: {
                type: 'string',
                description: 'Description of the entity',
            },
            confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0.8,
                description: 'Confidence level for this entity (0-1)',
            },
        },
        required: ['name', 'type'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    entity: null,
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    entity: null,
                    message: 'channelId is required but not provided',
                };
            }

            const kgService = getKgService();
            const entity = await kgService.findOrCreateEntity(
                {
                    channelId,
                    name: args.name,
                    type: args.type as EntityType,
                    aliases: args.aliases,
                    description: args.description,
                    confidence: args.confidence || 0.8,
                    source: 'manual',
                },
                context.agentId
            );

            return {
                success: true,
                entity,
                message: `Created entity: ${entity.name} (${entity.type})`,
            };
        } catch (error: any) {
            logger.error('Failed to create entity', { error: error.message });
            return {
                success: false,
                entity: null,
                message: 'Failed to create entity',
                error: error.message,
            };
        }
    },
};

/**
 * Create a relationship
 */
export const kg_create_relationship = {
    name: 'kg_create_relationship',
    description: 'Create a relationship between two entities in the Knowledge Graph.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            fromEntityId: {
                type: 'string',
                description: 'Source entity ID',
            },
            toEntityId: {
                type: 'string',
                description: 'Target entity ID',
            },
            type: {
                type: 'string',
                enum: Object.values(RelationshipType),
                description: 'Type of relationship (WORKS_ON, OWNS, DEPENDS_ON, etc.)',
            },
            label: {
                type: 'string',
                description: 'Optional human-readable label for the relationship',
            },
            confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0.8,
                description: 'Confidence level for this relationship (0-1)',
            },
        },
        required: ['fromEntityId', 'toEntityId', 'type'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    relationship: null,
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    relationship: null,
                    message: 'channelId is required but not provided',
                };
            }

            const kgService = getKgService();
            const relationship = await kgService.createRelationship(
                {
                    channelId,
                    fromEntityId: args.fromEntityId,
                    toEntityId: args.toEntityId,
                    type: args.type as RelationshipType,
                    label: args.label,
                    confidence: args.confidence || 0.8,
                    source: 'manual',
                },
                context.agentId
            );

            return {
                success: true,
                relationship,
                message: `Created relationship: ${args.type}`,
            };
        } catch (error: any) {
            logger.error('Failed to create relationship', { error: error.message });
            return {
                success: false,
                relationship: null,
                message: 'Failed to create relationship',
                error: error.message,
            };
        }
    },
};

/**
 * Extract entities from text
 */
export const kg_extract_from_text = {
    name: 'kg_extract_from_text',
    description: 'Extract entities and relationships from arbitrary text using rule-based extraction. Useful for populating the Knowledge Graph from documents or messages.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            text: {
                type: 'string',
                description: 'Text to extract entities from',
            },
            sourceId: {
                type: 'string',
                description: 'Optional source identifier (e.g., memory ID or document ID)',
            },
        },
        required: ['text'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    result: null,
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    result: null,
                    message: 'channelId is required but not provided',
                };
            }

            const extractionService = getExtractionService();
            const result = await extractionService.extractFromText(
                channelId,
                args.text,
                args.sourceId
            );

            return {
                success: true,
                result,
                entitiesExtracted: result.entitiesExtracted,
                relationshipsExtracted: result.relationshipsExtracted,
                executionTimeMs: result.executionTimeMs,
                message: `Extracted ${result.entitiesExtracted} entities and ${result.relationshipsExtracted} relationships`,
            };
        } catch (error: any) {
            logger.error('Failed to extract from text', { error: error.message });
            return {
                success: false,
                result: null,
                message: 'Failed to extract from text',
                error: error.message,
            };
        }
    },
};

/**
 * Extract entities from a memory
 */
export const kg_extract_from_memory = {
    name: 'kg_extract_from_memory',
    description: 'Extract entities and relationships from a stored memory. Links extracted entities to the memory for future retrieval.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            memoryId: {
                type: 'string',
                description: 'ID of the memory to extract from',
            },
            memoryContent: {
                type: 'string',
                description: 'Content of the memory (if not auto-retrievable)',
            },
        },
        required: ['memoryId', 'memoryContent'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    result: null,
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    result: null,
                    message: 'channelId is required but not provided',
                };
            }

            const extractionService = getExtractionService();
            const result = await extractionService.processMemory(
                channelId,
                args.memoryId,
                args.memoryContent
            );

            return {
                success: true,
                result,
                entitiesExtracted: result.entitiesExtracted,
                relationshipsExtracted: result.relationshipsExtracted,
                executionTimeMs: result.executionTimeMs,
                message: `Extracted ${result.entitiesExtracted} entities and ${result.relationshipsExtracted} relationships from memory`,
            };
        } catch (error: any) {
            logger.error('Failed to extract from memory', { error: error.message });
            return {
                success: false,
                result: null,
                message: 'Failed to extract from memory',
                error: error.message,
            };
        }
    },
};

/**
 * Get ORPAR phase context
 */
export const kg_get_phase_context = {
    name: 'kg_get_phase_context',
    description: 'Get Knowledge Graph context optimized for a specific ORPAR phase. Returns phase-appropriate entities, relationships, and insights.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            phase: {
                type: 'string',
                enum: ['observation', 'reasoning', 'planning', 'action', 'reflection'],
                description: 'ORPAR phase to get context for',
            },
            taskContent: {
                type: 'string',
                description: 'Task or observation content (for observation phase)',
            },
            entityIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Entity IDs to focus on (for reasoning/planning phases)',
            },
        },
        required: ['phase'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    phaseContext: null,
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    phaseContext: null,
                    message: 'channelId is required but not provided',
                };
            }

            const orparIntegration = getOrparIntegration();
            const phaseContext = await orparIntegration.getPhaseContext(
                channelId,
                context.agentId,
                args.phase,
                args.taskContent,
                args.entityIds
            );

            return {
                success: true,
                phaseContext,
                entityCount: phaseContext.entities.length,
                relationshipCount: phaseContext.relationships.length,
                summary: phaseContext.summary,
                executionTimeMs: phaseContext.executionTimeMs,
                message: phaseContext.summary,
            };
        } catch (error: any) {
            logger.error('Failed to get phase context', { error: error.message });
            return {
                success: false,
                phaseContext: null,
                message: 'Failed to get phase context',
                error: error.message,
            };
        }
    },
};

/**
 * Find similar entities (potential duplicates)
 */
export const kg_find_duplicates = {
    name: 'kg_find_duplicates',
    description: 'Find entities that may be duplicates based on name similarity. Useful for graph maintenance and deduplication.',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Channel ID (auto-populated from context if not provided)',
            },
            threshold: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0.8,
                description: 'Similarity threshold (0-1) for considering entities as duplicates',
            },
        },
        required: [],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    duplicates: [],
                    message: 'Knowledge Graph is disabled',
                };
            }

            const channelId = args.channelId || context.channelId;
            if (!channelId) {
                return {
                    success: false,
                    duplicates: [],
                    message: 'channelId is required but not provided',
                };
            }

            const kgService = getKgService();
            const duplicates = await kgService.findSimilarEntities(
                channelId,
                args.threshold || 0.8
            );

            return {
                success: true,
                duplicates,
                count: duplicates.length,
                message: duplicates.length > 0
                    ? `Found ${duplicates.length} potential duplicate pairs`
                    : 'No potential duplicates found',
            };
        } catch (error: any) {
            logger.error('Failed to find duplicates', { error: error.message });
            return {
                success: false,
                duplicates: [],
                message: 'Failed to find duplicates',
                error: error.message,
            };
        }
    },
};

/**
 * Merge entities
 */
export const kg_merge_entities = {
    name: 'kg_merge_entities',
    description: 'Merge multiple entities into a single target entity. Relationships from source entities are transferred to the target.',
    inputSchema: {
        type: 'object',
        properties: {
            targetEntityId: {
                type: 'string',
                description: 'ID of the entity to merge into (will be preserved)',
            },
            sourceEntityIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'IDs of entities to merge (will be deleted after merge)',
            },
        },
        required: ['targetEntityId', 'sourceEntityIds'],
    },
    handler: async (args: any, context: any) => {
        try {
            if (!isKnowledgeGraphEnabled()) {
                return {
                    success: false,
                    result: null,
                    message: 'Knowledge Graph is disabled',
                };
            }

            const kgService = getKgService();
            const result = await kgService.mergeEntities(
                args.targetEntityId,
                args.sourceEntityIds,
                context.agentId
            );

            return {
                success: result.success,
                result,
                message: result.success
                    ? `Successfully merged ${args.sourceEntityIds.length} entities into target`
                    : result.error || 'Merge failed',
            };
        } catch (error: any) {
            logger.error('Failed to merge entities', { error: error.message });
            return {
                success: false,
                result: null,
                message: 'Failed to merge entities',
                error: error.message,
            };
        }
    },
};

/**
 * Export all Knowledge Graph tools
 */
export const knowledgeGraphTools = [
    kg_get_entity,
    kg_find_entity,
    kg_get_neighbors,
    kg_find_path,
    kg_get_context,
    kg_get_high_utility_entities,
    kg_create_entity,
    kg_create_relationship,
    kg_extract_from_text,
    kg_extract_from_memory,
    kg_get_phase_context,
    kg_find_duplicates,
    kg_merge_entities,
];
