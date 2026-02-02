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
 * Knowledge Graph Types
 *
 * Defines interfaces and types for the Knowledge Graph system.
 * Provides entity-relationship graph for semantic reasoning.
 *
 * Key concepts:
 * - Entity: Named concepts with type, aliases, and MULS utility fields
 * - Relationship: Typed directed edges between entities
 * - GraphQuery: Pattern-based graph queries
 * - GraphContext: Relevant subgraph for a specific task/context
 */

import { ChannelId } from './ChannelContext';

/**
 * Entity types in the knowledge graph
 */
export enum EntityType {
    /** A person or individual */
    Person = 'person',

    /** An organization or company */
    Organization = 'organization',

    /** A project or initiative */
    Project = 'project',

    /** A system or application */
    System = 'system',

    /** A technology, framework, or tool */
    Technology = 'technology',

    /** A concept or abstract idea */
    Concept = 'concept',

    /** A location or place */
    Location = 'location',

    /** A document or artifact */
    Document = 'document',

    /** A task or action item */
    Task = 'task',

    /** A goal or objective */
    Goal = 'goal',

    /** A resource or asset */
    Resource = 'resource',

    /** A custom entity type */
    Custom = 'custom',
}

/**
 * Relationship types between entities
 */
export enum RelationshipType {
    /** Entity owns or controls another */
    OWNS = 'OWNS',

    /** Entity requires another */
    REQUIRES = 'REQUIRES',

    /** Entity depends on another */
    DEPENDS_ON = 'DEPENDS_ON',

    /** Entity works on another */
    WORKS_ON = 'WORKS_ON',

    /** Entity is part of another */
    PART_OF = 'PART_OF',

    /** Entity contains another */
    CONTAINS = 'CONTAINS',

    /** Entity relates to another (generic) */
    RELATED_TO = 'RELATED_TO',

    /** Entity created another */
    CREATED = 'CREATED',

    /** Entity uses another */
    USES = 'USES',

    /** Entity implements another */
    IMPLEMENTS = 'IMPLEMENTS',

    /** Entity extends another */
    EXTENDS = 'EXTENDS',

    /** Entity conflicts with another */
    CONFLICTS_WITH = 'CONFLICTS_WITH',

    /** Entity collaborates with another */
    COLLABORATES_WITH = 'COLLABORATES_WITH',

    /** Entity is located in another */
    LOCATED_IN = 'LOCATED_IN',

    /** Entity is responsible for another */
    RESPONSIBLE_FOR = 'RESPONSIBLE_FOR',

    /** Entity reports to another */
    REPORTS_TO = 'REPORTS_TO',

    /** Entity is assigned to another */
    ASSIGNED_TO = 'ASSIGNED_TO',

    /** Entity precedes another (temporal) */
    PRECEDES = 'PRECEDES',

    /** Entity follows another (temporal) */
    FOLLOWS = 'FOLLOWS',

    /** Entity is similar to another */
    SIMILAR_TO = 'SIMILAR_TO',

    /** Custom relationship type */
    CUSTOM = 'CUSTOM',
}

/**
 * MULS utility fields for entities
 */
export interface EntityUtility {
    /** Q-value (learned utility) for this entity */
    qValue: number;

    /** Number of times this entity has been retrieved */
    retrievalCount: number;

    /** Number of times this entity was used in successful outcomes */
    successCount: number;

    /** Number of times this entity was used in failed outcomes */
    failureCount: number;

    /** Last time the entity was accessed */
    lastAccessedAt: number;

    /** Last time the Q-value was updated */
    lastQValueUpdateAt: number;

    /** Confidence in the Q-value (higher with more observations) */
    qValueConfidence: number;
}

/**
 * Default utility values for new entities
 */
export const DEFAULT_ENTITY_UTILITY: EntityUtility = {
    qValue: 0.5,
    retrievalCount: 0,
    successCount: 0,
    failureCount: 0,
    lastAccessedAt: 0,
    lastQValueUpdateAt: 0,
    qValueConfidence: 0,
};

/**
 * An entity in the knowledge graph
 */
export interface Entity {
    /** Unique identifier */
    id: string;

    /** Channel this entity belongs to */
    channelId: ChannelId;

    /** Entity type */
    type: EntityType;

    /** Primary name of the entity */
    name: string;

    /** Alternative names/aliases */
    aliases: string[];

    /** Description of the entity */
    description?: string;

    /** Structured properties/attributes */
    properties: Record<string, any>;

    /** MULS utility fields */
    utility: EntityUtility;

    /** Confidence in entity existence/accuracy (0-1) */
    confidence: number;

    /** Source of the entity (e.g., 'extraction', 'manual', 'memory') */
    source: string;

    /** Memory IDs this entity was extracted from */
    sourceMemoryIds: string[];

    /** Timestamp when entity was created */
    createdAt: number;

    /** Timestamp when entity was last updated */
    updatedAt: number;

    /** Whether entity has been merged with another */
    merged: boolean;

    /** ID of entity this was merged into (if merged) */
    mergedInto?: string;

    /** Custom entity type name (when type is Custom) */
    customType?: string;
}

/**
 * A relationship between two entities
 */
export interface Relationship {
    /** Unique identifier */
    id: string;

    /** Channel this relationship belongs to */
    channelId: ChannelId;

    /** Source entity ID */
    fromEntityId: string;

    /** Target entity ID */
    toEntityId: string;

    /** Relationship type */
    type: RelationshipType;

    /** Optional label/description */
    label?: string;

    /** Relationship properties */
    properties: Record<string, any>;

    /** Confidence in the relationship (0-1) */
    confidence: number;

    /** Surprise score (how unexpected this relationship is) */
    surpriseScore: number;

    /** Source of the relationship */
    source: string;

    /** Memory IDs this relationship was extracted from */
    sourceMemoryIds: string[];

    /** Timestamp when created */
    createdAt: number;

    /** Timestamp when last updated */
    updatedAt: number;

    /** Weight/strength of the relationship */
    weight: number;

    /** Custom relationship type name (when type is CUSTOM) */
    customType?: string;
}

/**
 * Request to create an entity
 */
export interface CreateEntityRequest {
    channelId: ChannelId;
    type: EntityType;
    name: string;
    aliases?: string[];
    description?: string;
    properties?: Record<string, any>;
    confidence?: number;
    source?: string;
    sourceMemoryIds?: string[];
    customType?: string;
}

/**
 * Request to create a relationship
 */
export interface CreateRelationshipRequest {
    channelId: ChannelId;
    fromEntityId: string;
    toEntityId: string;
    type: RelationshipType;
    label?: string;
    properties?: Record<string, any>;
    confidence?: number;
    source?: string;
    sourceMemoryIds?: string[];
    weight?: number;
    customType?: string;
}

/**
 * Graph query for finding patterns
 */
export interface GraphQuery {
    /** Starting entity filters */
    startFilters?: EntityFilter;

    /** Relationship filters */
    relationshipFilters?: RelationshipFilter;

    /** End entity filters */
    endFilters?: EntityFilter;

    /** Maximum hops from start */
    maxHops?: number;

    /** Maximum results */
    limit?: number;

    /** Minimum confidence for results */
    minConfidence?: number;

    /** Whether to include utility information */
    includeUtility?: boolean;
}

/**
 * Filter for entities
 */
export interface EntityFilter {
    /** Filter by type */
    type?: EntityType | EntityType[];

    /** Filter by name (partial match) */
    nameContains?: string;

    /** Filter by exact name */
    name?: string;

    /** Filter by alias */
    alias?: string;

    /** Minimum Q-value */
    minQValue?: number;

    /** Maximum Q-value */
    maxQValue?: number;

    /** Minimum confidence */
    minConfidence?: number;

    /** Custom property filters */
    properties?: Record<string, any>;
}

/**
 * Filter for relationships
 */
export interface RelationshipFilter {
    /** Filter by type */
    type?: RelationshipType | RelationshipType[];

    /** Minimum confidence */
    minConfidence?: number;

    /** Maximum surprise score (to find expected relationships) */
    maxSurpriseScore?: number;

    /** Minimum surprise score (to find unexpected relationships) */
    minSurpriseScore?: number;

    /** Minimum weight */
    minWeight?: number;
}

/**
 * Result of a graph query
 */
export interface GraphQueryResult {
    /** Matched entities */
    entities: Entity[];

    /** Matched relationships */
    relationships: Relationship[];

    /** Paths found (if path query) */
    paths?: GraphPath[];

    /** Total matches (before limit) */
    totalCount: number;

    /** Query execution time in ms */
    executionTimeMs: number;
}

/**
 * A path through the graph
 */
export interface GraphPath {
    /** Ordered list of entity IDs in the path */
    entityIds: string[];

    /** Ordered list of relationship IDs connecting entities */
    relationshipIds: string[];

    /** Total path length */
    length: number;

    /** Combined confidence (product of relationship confidences) */
    confidence: number;

    /** Total weight (sum of relationship weights) */
    totalWeight: number;
}

/**
 * Graph pattern for matching
 */
export interface GraphPattern {
    /** Pattern name for reference */
    name: string;

    /** Entity patterns (nodes) */
    nodes: GraphPatternNode[];

    /** Edge patterns */
    edges: GraphPatternEdge[];
}

/**
 * Node in a graph pattern
 */
export interface GraphPatternNode {
    /** Variable name for this node */
    variable: string;

    /** Entity type filter */
    type?: EntityType | EntityType[];

    /** Property constraints */
    properties?: Record<string, any>;
}

/**
 * Edge in a graph pattern
 */
export interface GraphPatternEdge {
    /** Source node variable */
    from: string;

    /** Target node variable */
    to: string;

    /** Relationship type filter */
    type?: RelationshipType | RelationshipType[];

    /** Whether edge direction matters */
    directed?: boolean;
}

/**
 * Context subgraph relevant to a specific task
 */
export interface GraphContext {
    /** Central entities */
    centralEntities: Entity[];

    /** Related entities */
    relatedEntities: Entity[];

    /** Relationships between entities */
    relationships: Relationship[];

    /** High-utility entities */
    highUtilityEntities: Entity[];

    /** Summary statistics */
    stats: {
        entityCount: number;
        relationshipCount: number;
        avgQValue: number;
        maxQValue: number;
        avgConfidence: number;
    };
}

/**
 * Configuration for knowledge graph
 */
export interface KnowledgeGraphConfig {
    /** Whether knowledge graph is enabled */
    enabled: boolean;

    /** Whether automatic extraction is enabled */
    extractionEnabled: boolean;

    /** Model to use for extraction */
    extractionModel: string;

    /** Minimum confidence for extracted entities */
    minConfidence: number;

    /** Threshold for automatic entity merging */
    autoMergeThreshold: number;

    /** Whether Q-value learning is enabled */
    qValueEnabled: boolean;

    /** Learning rate for Q-value updates */
    qValueLearningRate: number;

    /** Whether surprise detection is enabled */
    surpriseEnabled: boolean;

    /** Threshold for high surprise alerts */
    surpriseThreshold: number;

    /** Maximum entities to return in context */
    maxContextEntities: number;

    /** Maximum relationships to return in context */
    maxContextRelationships: number;

    /** Whether ORPAR integration is enabled */
    orparIntegrationEnabled: boolean;

    /** Debug mode */
    debug: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_KNOWLEDGE_GRAPH_CONFIG: KnowledgeGraphConfig = {
    enabled: false,
    extractionEnabled: false,
    extractionModel: 'anthropic/claude-3-haiku',
    minConfidence: 0.7,
    autoMergeThreshold: 0.85,
    qValueEnabled: true,
    qValueLearningRate: 0.1,
    surpriseEnabled: true,
    surpriseThreshold: 0.8,
    maxContextEntities: 50,
    maxContextRelationships: 100,
    orparIntegrationEnabled: false,
    debug: false,
};

/**
 * Environment variable names for configuration
 */
export const KNOWLEDGE_GRAPH_ENV_VARS = {
    ENABLED: 'KNOWLEDGE_GRAPH_ENABLED',
    EXTRACTION_ENABLED: 'KG_EXTRACTION_ENABLED',
    EXTRACTION_MODEL: 'KG_EXTRACTION_MODEL',
    MIN_CONFIDENCE: 'KG_MIN_CONFIDENCE',
    AUTO_MERGE_THRESHOLD: 'KG_AUTO_MERGE_THRESHOLD',
    QVALUE_ENABLED: 'KG_QVALUE_ENABLED',
    QVALUE_LEARNING_RATE: 'KG_QVALUE_LEARNING_RATE',
    SURPRISE_ENABLED: 'KG_SURPRISE_ENABLED',
    SURPRISE_THRESHOLD: 'KG_SURPRISE_THRESHOLD',
    MAX_CONTEXT_ENTITIES: 'KG_MAX_CONTEXT_ENTITIES',
    MAX_CONTEXT_RELATIONSHIPS: 'KG_MAX_CONTEXT_RELATIONSHIPS',
    ORPAR_INTEGRATION_ENABLED: 'KG_ORPAR_INTEGRATION_ENABLED',
    DEBUG: 'KG_DEBUG',
} as const;

/**
 * Entity merge result
 */
export interface EntityMergeResult {
    /** Whether merge was successful */
    success: boolean;

    /** The merged entity */
    mergedEntity?: Entity;

    /** IDs of entities that were merged */
    sourceEntityIds: string[];

    /** Error message if failed */
    error?: string;
}

/**
 * Entity similarity result
 */
export interface EntitySimilarity {
    /** First entity */
    entity1: Entity;

    /** Second entity */
    entity2: Entity;

    /** Similarity score (0-1) */
    similarity: number;

    /** Reasons for similarity */
    reasons: string[];
}
