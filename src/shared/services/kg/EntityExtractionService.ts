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
 * EntityExtractionService
 *
 * LLM-powered extraction of entities and relationships from text.
 * Integrates with memory system to extract knowledge from stored memories.
 *
 * Features:
 * - Extract entities from arbitrary text
 * - Extract relationships between entities
 * - Process memories on promotion
 * - Deduplication of similar entities
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { KnowledgeGraphEvents } from '../../events/event-definitions/KnowledgeGraphEvents';
import { KnowledgeGraphService } from './KnowledgeGraphService';
import {
    isExtractionEnabled,
    getExtractionModel,
    getMinConfidence,
} from '../../config/knowledge-graph.config';
import {
    Entity,
    Relationship,
    EntityType,
    RelationshipType,
    CreateEntityRequest,
    CreateRelationshipRequest,
} from '../../types/KnowledgeGraphTypes';
import { ChannelId } from '../../types/ChannelContext';
import { createBaseEventPayload } from '../../schemas/EventPayloadSchema';

/**
 * Extracted entity from text
 */
interface ExtractedEntity {
    name: string;
    type: EntityType;
    aliases?: string[];
    description?: string;
    confidence: number;
}

/**
 * Extracted relationship from text
 */
interface ExtractedRelationship {
    fromEntityName: string;
    toEntityName: string;
    type: RelationshipType;
    label?: string;
    confidence: number;
}

/**
 * Extraction result
 */
export interface ExtractionResult {
    extractionId: string;
    entities: Entity[];
    relationships: Relationship[];
    entitiesExtracted: number;
    relationshipsExtracted: number;
    executionTimeMs: number;
    errors?: string[];
}

/**
 * EntityExtractionService handles LLM-powered entity extraction
 */
export class EntityExtractionService {
    private static instance: EntityExtractionService;
    private logger: Logger;
    private enabled: boolean = false;
    private kgService: KnowledgeGraphService;

    private constructor() {
        this.logger = new Logger('info', 'EntityExtractionService', 'server');
        this.kgService = KnowledgeGraphService.getInstance();
        this.initialize();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): EntityExtractionService {
        if (!EntityExtractionService.instance) {
            EntityExtractionService.instance = new EntityExtractionService();
        }
        return EntityExtractionService.instance;
    }

    /**
     * Initialize the service
     */
    private initialize(): void {
        this.enabled = isExtractionEnabled();

        if (!this.enabled) {
            this.logger.debug('EntityExtractionService initialized but disabled');
            return;
        }

        this.logger.info(`EntityExtractionService initialized (model: ${getExtractionModel()})`);
    }

    /**
     * Check if the service is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Extract entities and relationships from text
     */
    public async extractFromText(
        channelId: ChannelId,
        text: string,
        sourceId?: string
    ): Promise<ExtractionResult> {
        const extractionId = uuidv4();
        const startTime = Date.now();

        if (!this.enabled) {
            return {
                extractionId,
                entities: [],
                relationships: [],
                entitiesExtracted: 0,
                relationshipsExtracted: 0,
                executionTimeMs: 0,
                errors: ['Extraction service is disabled'],
            };
        }

        // Emit extraction started event
        this.emitEvent(KnowledgeGraphEvents.EXTRACTION_STARTED, channelId, 'system', {
            extractionId,
            channelId,
            source: 'text',
            sourceId,
            model: getExtractionModel(),
        });

        try {
            // Extract entities
            const extractedEntities = await this.extractEntitiesFromText(text);

            // Extract relationships
            const extractedRelationships = await this.extractRelationshipsFromText(
                text,
                extractedEntities
            );

            // Create entities in knowledge graph
            const createdEntities: Entity[] = [];
            const entityNameToId = new Map<string, string>();

            for (const extracted of extractedEntities) {
                if (extracted.confidence < getMinConfidence()) {
                    continue;
                }

                try {
                    const entity = await this.kgService.findOrCreateEntity({
                        channelId,
                        type: extracted.type,
                        name: extracted.name,
                        aliases: extracted.aliases,
                        description: extracted.description,
                        confidence: extracted.confidence,
                        source: 'extraction',
                        sourceMemoryIds: sourceId ? [sourceId] : [],
                    });

                    createdEntities.push(entity);
                    entityNameToId.set(extracted.name.toLowerCase(), entity.id);
                } catch (error: any) {
                    this.logger.warn(`Failed to create entity ${extracted.name}: ${error.message}`);
                }
            }

            // Create relationships in knowledge graph
            const createdRelationships: Relationship[] = [];

            for (const extracted of extractedRelationships) {
                if (extracted.confidence < getMinConfidence()) {
                    continue;
                }

                const fromId = entityNameToId.get(extracted.fromEntityName.toLowerCase());
                const toId = entityNameToId.get(extracted.toEntityName.toLowerCase());

                if (!fromId || !toId) {
                    continue;
                }

                try {
                    const relationship = await this.kgService.createRelationship({
                        channelId,
                        fromEntityId: fromId,
                        toEntityId: toId,
                        type: extracted.type,
                        label: extracted.label,
                        confidence: extracted.confidence,
                        source: 'extraction',
                        sourceMemoryIds: sourceId ? [sourceId] : [],
                    });

                    createdRelationships.push(relationship);
                } catch (error: any) {
                    // Likely duplicate relationship, ignore
                    this.logger.debug(
                        `Failed to create relationship: ${error.message}`
                    );
                }
            }

            const executionTimeMs = Date.now() - startTime;

            // Emit extraction completed event
            this.emitEvent(KnowledgeGraphEvents.EXTRACTION_COMPLETED, channelId, 'system', {
                extractionId,
                channelId,
                entitiesExtracted: createdEntities.length,
                relationshipsExtracted: createdRelationships.length,
                executionTimeMs,
                entityIds: createdEntities.map((e) => e.id),
                relationshipIds: createdRelationships.map((r) => r.id),
            });

            return {
                extractionId,
                entities: createdEntities,
                relationships: createdRelationships,
                entitiesExtracted: createdEntities.length,
                relationshipsExtracted: createdRelationships.length,
                executionTimeMs,
            };
        } catch (error: any) {
            const executionTimeMs = Date.now() - startTime;

            // Emit extraction failed event
            this.emitEvent(KnowledgeGraphEvents.EXTRACTION_FAILED, channelId, 'system', {
                extractionId,
                channelId,
                error: error.message,
                source: 'text',
                sourceId,
            });

            return {
                extractionId,
                entities: [],
                relationships: [],
                entitiesExtracted: 0,
                relationshipsExtracted: 0,
                executionTimeMs,
                errors: [error.message],
            };
        }
    }

    /**
     * Process a memory for entity extraction
     */
    public async processMemory(
        channelId: ChannelId,
        memoryId: string,
        memoryContent: string
    ): Promise<ExtractionResult> {
        return this.extractFromText(channelId, memoryContent, memoryId);
    }

    /**
     * Extract entities from text using rule-based extraction
     * (In production, this would use LLM via OpenRouter)
     */
    private async extractEntitiesFromText(text: string): Promise<ExtractedEntity[]> {
        const entities: ExtractedEntity[] = [];

        // Simple rule-based extraction for common patterns
        // In production, this would call an LLM for more sophisticated extraction

        // Extract potential Person entities (capitalized names)
        const personPattern = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g;
        let match;
        while ((match = personPattern.exec(text)) !== null) {
            const name = match[1];
            if (!entities.find((e) => e.name.toLowerCase() === name.toLowerCase())) {
                entities.push({
                    name,
                    type: EntityType.Person,
                    confidence: 0.7,
                });
            }
        }

        // Extract potential Organization entities (all caps or ending with Inc/Corp/LLC)
        const orgPattern = /\b([A-Z][A-Za-z]+(?:\s+(?:Inc|Corp|LLC|Ltd|Company|Co))?)\b/g;
        while ((match = orgPattern.exec(text)) !== null) {
            const name = match[1];
            if (
                name.length > 3 &&
                !entities.find((e) => e.name.toLowerCase() === name.toLowerCase())
            ) {
                // Check if it looks like an organization
                if (/Inc|Corp|LLC|Ltd|Company|Co$/i.test(name)) {
                    entities.push({
                        name,
                        type: EntityType.Organization,
                        confidence: 0.8,
                    });
                }
            }
        }

        // Extract potential Technology entities (common tech terms)
        const techTerms = [
            'JavaScript',
            'TypeScript',
            'Python',
            'React',
            'Node.js',
            'MongoDB',
            'PostgreSQL',
            'Docker',
            'Kubernetes',
            'AWS',
            'Azure',
            'GCP',
            'API',
            'REST',
            'GraphQL',
            'Redis',
            'Kafka',
        ];

        for (const term of techTerms) {
            if (text.toLowerCase().includes(term.toLowerCase())) {
                if (!entities.find((e) => e.name.toLowerCase() === term.toLowerCase())) {
                    entities.push({
                        name: term,
                        type: EntityType.Technology,
                        confidence: 0.9,
                    });
                }
            }
        }

        // Extract potential Project entities (words followed by "project" or "system")
        const projectPattern = /\b([A-Z][a-zA-Z]+)\s+(?:project|system|application|app|platform)\b/gi;
        while ((match = projectPattern.exec(text)) !== null) {
            const name = match[1];
            if (!entities.find((e) => e.name.toLowerCase() === name.toLowerCase())) {
                entities.push({
                    name,
                    type: EntityType.Project,
                    confidence: 0.75,
                });
            }
        }

        return entities;
    }

    /**
     * Extract relationships from text based on extracted entities
     * (In production, this would use LLM for more sophisticated extraction)
     */
    private async extractRelationshipsFromText(
        text: string,
        entities: ExtractedEntity[]
    ): Promise<ExtractedRelationship[]> {
        const relationships: ExtractedRelationship[] = [];
        const textLower = text.toLowerCase();

        // Simple pattern matching for common relationship indicators
        const relationshipPatterns: Array<{
            pattern: RegExp;
            type: RelationshipType;
        }> = [
            { pattern: /(\w+)\s+uses\s+(\w+)/gi, type: RelationshipType.USES },
            { pattern: /(\w+)\s+works\s+on\s+(\w+)/gi, type: RelationshipType.WORKS_ON },
            { pattern: /(\w+)\s+depends\s+on\s+(\w+)/gi, type: RelationshipType.DEPENDS_ON },
            { pattern: /(\w+)\s+requires\s+(\w+)/gi, type: RelationshipType.REQUIRES },
            { pattern: /(\w+)\s+created\s+(\w+)/gi, type: RelationshipType.CREATED },
            { pattern: /(\w+)\s+owns\s+(\w+)/gi, type: RelationshipType.OWNS },
            { pattern: /(\w+)\s+implements\s+(\w+)/gi, type: RelationshipType.IMPLEMENTS },
        ];

        const entityNames = new Set(entities.map((e) => e.name.toLowerCase()));

        for (const { pattern, type } of relationshipPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const fromName = match[1];
                const toName = match[2];

                // Check if both entities exist
                if (entityNames.has(fromName.toLowerCase()) && entityNames.has(toName.toLowerCase())) {
                    relationships.push({
                        fromEntityName: fromName,
                        toEntityName: toName,
                        type,
                        confidence: 0.7,
                    });
                }
            }
        }

        // Infer relationships between co-occurring entities
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const e1 = entities[i];
                const e2 = entities[j];

                // Check if entities appear close together in text
                const pos1 = textLower.indexOf(e1.name.toLowerCase());
                const pos2 = textLower.indexOf(e2.name.toLowerCase());

                if (pos1 !== -1 && pos2 !== -1 && Math.abs(pos1 - pos2) < 100) {
                    // Close proximity suggests a relationship
                    // Determine relationship type based on entity types
                    let relType = RelationshipType.RELATED_TO;

                    if (e1.type === EntityType.Person && e2.type === EntityType.Project) {
                        relType = RelationshipType.WORKS_ON;
                    } else if (e1.type === EntityType.Project && e2.type === EntityType.Technology) {
                        relType = RelationshipType.USES;
                    } else if (e1.type === EntityType.Person && e2.type === EntityType.Organization) {
                        relType = RelationshipType.WORKS_ON;
                    }

                    // Only add if not already exists
                    const exists = relationships.find(
                        (r) =>
                            r.fromEntityName.toLowerCase() === e1.name.toLowerCase() &&
                            r.toEntityName.toLowerCase() === e2.name.toLowerCase()
                    );

                    if (!exists && relType !== RelationshipType.RELATED_TO) {
                        relationships.push({
                            fromEntityName: e1.name,
                            toEntityName: e2.name,
                            type: relType,
                            confidence: 0.5,
                        });
                    }
                }
            }
        }

        return relationships;
    }

    /**
     * Find potential duplicate entities
     */
    public async findDuplicates(channelId: ChannelId): Promise<Array<{
        entity1: Entity;
        entity2: Entity;
        similarity: number;
    }>> {
        if (!this.enabled) {
            return [];
        }

        return this.kgService.findSimilarEntities(channelId);
    }

    /**
     * Emit a knowledge graph event
     */
    private emitEvent(
        eventType: string,
        channelId: ChannelId,
        agentId: string,
        data: any
    ): void {
        try {
            const payload = createBaseEventPayload(eventType, agentId, channelId, data);
            EventBus.server.emit(eventType, payload);
        } catch (error: any) {
            this.logger.warn(`Failed to emit event ${eventType}: ${error.message}`);
        }
    }
}
