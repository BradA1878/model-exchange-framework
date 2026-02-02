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
 * Knowledge Graph Events
 *
 * Event definitions for the Knowledge Graph system.
 * Includes entity/relationship lifecycle, extraction, and MULS integration events.
 */

import { EntityType, RelationshipType } from '../../types/KnowledgeGraphTypes';

/**
 * Knowledge Graph event names
 */
export const KnowledgeGraphEvents = {
    // Entity lifecycle events
    ENTITY_CREATED: 'kg:entity_created',
    ENTITY_UPDATED: 'kg:entity_updated',
    ENTITY_DELETED: 'kg:entity_deleted',
    ENTITY_MERGED: 'kg:entity_merged',

    // Relationship lifecycle events
    RELATIONSHIP_CREATED: 'kg:relationship_created',
    RELATIONSHIP_UPDATED: 'kg:relationship_updated',
    RELATIONSHIP_DELETED: 'kg:relationship_deleted',

    // Extraction events
    EXTRACTION_STARTED: 'kg:extraction_started',
    EXTRACTION_COMPLETED: 'kg:extraction_completed',
    EXTRACTION_FAILED: 'kg:extraction_failed',

    // MULS integration events
    ENTITY_QVALUE_UPDATED: 'kg:entity_qvalue_updated',
    ENTITY_QVALUE_BATCH_UPDATED: 'kg:entity_qvalue_batch_updated',

    // Surprise detection events
    HIGH_SURPRISE_RELATIONSHIP: 'kg:high_surprise_relationship',
    CONFLICTING_RELATIONSHIP: 'kg:conflicting_relationship',

    // Query events
    GRAPH_QUERY_EXECUTED: 'kg:graph_query_executed',
    CONTEXT_RETRIEVED: 'kg:context_retrieved',

    // Graph update events
    GRAPH_UPDATED: 'kg:graph_updated',
} as const;

export type KnowledgeGraphEventName = typeof KnowledgeGraphEvents[keyof typeof KnowledgeGraphEvents];

/**
 * Entity created event data
 */
export interface EntityCreatedEventData {
    entityId: string;
    channelId: string;
    type: EntityType;
    name: string;
    source: string;
    confidence: number;
}

/**
 * Entity updated event data
 */
export interface EntityUpdatedEventData {
    entityId: string;
    channelId: string;
    changes: Record<string, { old: any; new: any }>;
    updatedBy: string;
}

/**
 * Entity deleted event data
 */
export interface EntityDeletedEventData {
    entityId: string;
    channelId: string;
    deletedBy: string;
    reason?: string;
}

/**
 * Entity merged event data
 */
export interface EntityMergedEventData {
    targetEntityId: string;
    sourceEntityIds: string[];
    channelId: string;
    mergedBy: string;
    similarity: number;
}

/**
 * Relationship created event data
 */
export interface RelationshipCreatedEventData {
    relationshipId: string;
    channelId: string;
    fromEntityId: string;
    toEntityId: string;
    type: RelationshipType;
    confidence: number;
    source: string;
}

/**
 * Relationship updated event data
 */
export interface RelationshipUpdatedEventData {
    relationshipId: string;
    channelId: string;
    changes: Record<string, { old: any; new: any }>;
    updatedBy: string;
}

/**
 * Relationship deleted event data
 */
export interface RelationshipDeletedEventData {
    relationshipId: string;
    channelId: string;
    deletedBy: string;
    reason?: string;
}

/**
 * Extraction started event data
 */
export interface ExtractionStartedEventData {
    extractionId: string;
    channelId: string;
    source: 'memory' | 'text' | 'task';
    sourceId?: string;
    model: string;
}

/**
 * Extraction completed event data
 */
export interface ExtractionCompletedEventData {
    extractionId: string;
    channelId: string;
    entitiesExtracted: number;
    relationshipsExtracted: number;
    executionTimeMs: number;
    entityIds: string[];
    relationshipIds: string[];
}

/**
 * Extraction failed event data
 */
export interface ExtractionFailedEventData {
    extractionId: string;
    channelId: string;
    error: string;
    source: 'memory' | 'text' | 'task';
    sourceId?: string;
}

/**
 * Entity Q-value updated event data
 */
export interface EntityQValueUpdatedEventData {
    entityId: string;
    channelId: string;
    oldQValue: number;
    newQValue: number;
    reason: string;
    taskId?: string;
}

/**
 * Entity Q-value batch updated event data
 */
export interface EntityQValueBatchUpdatedEventData {
    channelId: string;
    updates: Array<{
        entityId: string;
        oldQValue: number;
        newQValue: number;
    }>;
    reason: string;
    taskId?: string;
}

/**
 * High surprise relationship event data
 */
export interface HighSurpriseRelationshipEventData {
    relationshipId: string;
    channelId: string;
    fromEntityId: string;
    toEntityId: string;
    type: RelationshipType;
    surpriseScore: number;
    reason: string;
}

/**
 * Conflicting relationship event data
 */
export interface ConflictingRelationshipEventData {
    newRelationshipId: string;
    existingRelationshipId: string;
    channelId: string;
    conflictType: string;
    description: string;
}

/**
 * Graph query executed event data
 */
export interface GraphQueryExecutedEventData {
    channelId: string;
    queryType: string;
    entitiesFound: number;
    relationshipsFound: number;
    executionTimeMs: number;
}

/**
 * Context retrieved event data
 */
export interface ContextRetrievedEventData {
    channelId: string;
    contextType: string;
    entityCount: number;
    relationshipCount?: number;
    avgQValue?: number;
    executionTimeMs?: number;
}

/**
 * Graph updated event data (for reflection updates)
 */
export interface GraphUpdatedEventData {
    channelId: string;
    source: string;
    entitiesCreated: number;
    relationshipsCreated: number;
    qValuesUpdated: number;
    taskId?: string;
}

/**
 * Knowledge Graph event payloads mapping
 */
export interface KnowledgeGraphPayloads {
    'kg:entity_created': EntityCreatedEventData;
    'kg:entity_updated': EntityUpdatedEventData;
    'kg:entity_deleted': EntityDeletedEventData;
    'kg:entity_merged': EntityMergedEventData;
    'kg:relationship_created': RelationshipCreatedEventData;
    'kg:relationship_updated': RelationshipUpdatedEventData;
    'kg:relationship_deleted': RelationshipDeletedEventData;
    'kg:extraction_started': ExtractionStartedEventData;
    'kg:extraction_completed': ExtractionCompletedEventData;
    'kg:extraction_failed': ExtractionFailedEventData;
    'kg:entity_qvalue_updated': EntityQValueUpdatedEventData;
    'kg:entity_qvalue_batch_updated': EntityQValueBatchUpdatedEventData;
    'kg:high_surprise_relationship': HighSurpriseRelationshipEventData;
    'kg:conflicting_relationship': ConflictingRelationshipEventData;
    'kg:graph_query_executed': GraphQueryExecutedEventData;
    'kg:context_retrieved': ContextRetrievedEventData;
    'kg:graph_updated': GraphUpdatedEventData;
}
