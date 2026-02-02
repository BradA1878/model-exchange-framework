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
 * GraphSurpriseCalculator
 *
 * Detects surprising relationships in the Knowledge Graph.
 * Identifies unexpected connections, conflicts, and anomalies that
 * may warrant additional observation or investigation.
 *
 * Features:
 * - Calculate surprise scores for new relationships
 * - Detect conflicting relationships
 * - Identify anomalous patterns
 * - Integration with ORPAR surprise detection
 */

import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { KnowledgeGraphEvents } from '../../events/event-definitions/KnowledgeGraphEvents';
import { MongoKnowledgeGraphRepository } from '../../database/adapters/mongodb/MongoKnowledgeGraphRepository';
import {
    isKnowledgeGraphEnabled,
    isSurpriseDetectionEnabled,
    getSurpriseThreshold,
} from '../../config/knowledge-graph.config';
import {
    Relationship,
    RelationshipType,
    Entity,
    EntityType,
} from '../../types/KnowledgeGraphTypes';
import { ChannelId } from '../../types/ChannelContext';
import { createBaseEventPayload } from '../../schemas/EventPayloadSchema';

/**
 * Surprise analysis result
 */
export interface SurpriseAnalysis {
    relationship: Relationship;
    surpriseScore: number;
    reasons: string[];
    conflictsWith?: Relationship[];
    isHighSurprise: boolean;
}

/**
 * Conflicting relationship types - these types conflict with each other
 */
const CONFLICTING_TYPES: Map<RelationshipType, RelationshipType[]> = new Map([
    [RelationshipType.OWNS, [RelationshipType.REPORTS_TO]],
    [RelationshipType.REPORTS_TO, [RelationshipType.OWNS]],
    [RelationshipType.PRECEDES, [RelationshipType.FOLLOWS]],
    [RelationshipType.FOLLOWS, [RelationshipType.PRECEDES]],
    [RelationshipType.CONFLICTS_WITH, [RelationshipType.COLLABORATES_WITH]],
    [RelationshipType.COLLABORATES_WITH, [RelationshipType.CONFLICTS_WITH]],
]);

/**
 * Expected relationship patterns (entity type pairs -> likely relationship types)
 */
const EXPECTED_PATTERNS: Map<string, RelationshipType[]> = new Map([
    ['person->project', [RelationshipType.WORKS_ON, RelationshipType.CREATED, RelationshipType.OWNS]],
    ['person->organization', [RelationshipType.WORKS_ON, RelationshipType.REPORTS_TO]],
    ['project->technology', [RelationshipType.USES, RelationshipType.DEPENDS_ON, RelationshipType.IMPLEMENTS]],
    ['organization->project', [RelationshipType.OWNS, RelationshipType.CREATED]],
    ['person->person', [RelationshipType.COLLABORATES_WITH, RelationshipType.REPORTS_TO]],
    ['technology->technology', [RelationshipType.DEPENDS_ON, RelationshipType.EXTENDS, RelationshipType.IMPLEMENTS]],
]);

/**
 * GraphSurpriseCalculator detects surprising relationships
 */
export class GraphSurpriseCalculator {
    private static instance: GraphSurpriseCalculator;
    private logger: Logger;
    private enabled: boolean = false;
    private repository: MongoKnowledgeGraphRepository;

    private constructor() {
        this.logger = new Logger('info', 'GraphSurpriseCalculator', 'server');
        this.repository = MongoKnowledgeGraphRepository.getInstance();
        this.initialize();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): GraphSurpriseCalculator {
        if (!GraphSurpriseCalculator.instance) {
            GraphSurpriseCalculator.instance = new GraphSurpriseCalculator();
        }
        return GraphSurpriseCalculator.instance;
    }

    /**
     * Initialize the service
     */
    private initialize(): void {
        this.enabled = isKnowledgeGraphEnabled() && isSurpriseDetectionEnabled();

        if (!this.enabled) {
            this.logger.debug('GraphSurpriseCalculator initialized but disabled');
            return;
        }

        this.logger.info(`GraphSurpriseCalculator initialized (threshold: ${getSurpriseThreshold()})`);
    }

    /**
     * Check if the service is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Calculate surprise score for a new relationship
     */
    public async calculateGraphSurprise(
        relationship: Relationship,
        fromEntity: Entity,
        toEntity: Entity
    ): Promise<SurpriseAnalysis> {
        const reasons: string[] = [];
        let surpriseScore = 0;

        // 1. Check for conflicting relationships
        const conflictingRelationships = await this.findConflictingRelationships(relationship);
        if (conflictingRelationships.length > 0) {
            surpriseScore += 0.4;
            reasons.push(`Conflicts with ${conflictingRelationships.length} existing relationship(s)`);
        }

        // 2. Check if relationship type matches expected pattern for entity types
        const patternSurprise = this.calculatePatternSurprise(
            fromEntity.type,
            toEntity.type,
            relationship.type
        );
        if (patternSurprise > 0) {
            surpriseScore += patternSurprise * 0.3;
            reasons.push(`Unexpected relationship type for ${fromEntity.type} -> ${toEntity.type}`);
        }

        // 3. Check entity Q-value differential (high utility connecting to low utility)
        const qValueDiff = Math.abs(fromEntity.utility.qValue - toEntity.utility.qValue);
        if (qValueDiff > 0.5) {
            surpriseScore += qValueDiff * 0.2;
            reasons.push(`Large Q-value differential: ${fromEntity.utility.qValue.toFixed(2)} vs ${toEntity.utility.qValue.toFixed(2)}`);
        }

        // 4. Check if entities have many existing connections
        const fromConnections = await this.repository.getEntityRelationships(fromEntity.id);
        const toConnections = await this.repository.getEntityRelationships(toEntity.id);

        // New connection between isolated entities is surprising
        if (fromConnections.length === 0 || toConnections.length === 0) {
            surpriseScore += 0.1;
            reasons.push('Connection involving isolated entity');
        }

        // 5. Check confidence - low confidence relationships are inherently surprising
        if (relationship.confidence < 0.5) {
            surpriseScore += (1 - relationship.confidence) * 0.2;
            reasons.push(`Low confidence relationship: ${relationship.confidence.toFixed(2)}`);
        }

        // Clamp surprise score
        surpriseScore = Math.min(1, surpriseScore);

        const threshold = getSurpriseThreshold();
        const isHighSurprise = surpriseScore >= threshold;

        const analysis: SurpriseAnalysis = {
            relationship,
            surpriseScore,
            reasons,
            conflictsWith: conflictingRelationships.length > 0 ? conflictingRelationships : undefined,
            isHighSurprise,
        };

        // Emit events for high surprise
        if (isHighSurprise) {
            this.emitHighSurpriseEvent(analysis, relationship.channelId);
        }

        if (conflictingRelationships.length > 0) {
            this.emitConflictEvent(relationship, conflictingRelationships[0], relationship.channelId);
        }

        return analysis;
    }

    /**
     * Find relationships that conflict with the given relationship
     */
    private async findConflictingRelationships(relationship: Relationship): Promise<Relationship[]> {
        const conflictingTypes = CONFLICTING_TYPES.get(relationship.type);
        if (!conflictingTypes || conflictingTypes.length === 0) {
            return [];
        }

        const conflicts: Relationship[] = [];

        // Check for same-direction conflicts
        for (const conflictType of conflictingTypes) {
            const existing = await this.repository.getRelationshipsBetween(
                relationship.fromEntityId,
                relationship.toEntityId,
                conflictType
            );
            conflicts.push(...existing);
        }

        // Also check reverse direction for some types
        const reverseConflictTypes = [RelationshipType.PRECEDES, RelationshipType.FOLLOWS];
        if (reverseConflictTypes.includes(relationship.type)) {
            const reverseExisting = await this.repository.getRelationshipsBetween(
                relationship.toEntityId,
                relationship.fromEntityId,
                relationship.type
            );
            conflicts.push(...reverseExisting);
        }

        return conflicts;
    }

    /**
     * Calculate how surprising a relationship type is given entity types
     */
    private calculatePatternSurprise(
        fromType: EntityType,
        toType: EntityType,
        relType: RelationshipType
    ): number {
        const key = `${fromType.toLowerCase()}->${toType.toLowerCase()}`;
        const expectedTypes = EXPECTED_PATTERNS.get(key);

        if (!expectedTypes) {
            // No known pattern - moderately surprising
            return 0.5;
        }

        if (expectedTypes.includes(relType)) {
            // Expected relationship type
            return 0;
        }

        // Unexpected relationship type
        return 0.7;
    }

    /**
     * Analyze a channel for surprising patterns
     */
    public async analyzeChannelSurprises(
        channelId: ChannelId
    ): Promise<SurpriseAnalysis[]> {
        if (!this.enabled) {
            return [];
        }

        const analyses: SurpriseAnalysis[] = [];

        // Get all relationships with high surprise scores
        const entities = await this.repository.findEntities(channelId);
        const entityMap = new Map(entities.map((e) => [e.id, e]));

        for (const entity of entities) {
            const relationships = await this.repository.getEntityRelationships(entity.id);

            for (const rel of relationships) {
                // Only analyze once per relationship (from the "from" side)
                if (rel.fromEntityId !== entity.id) continue;

                const toEntity = entityMap.get(rel.toEntityId);
                if (!toEntity) continue;

                if (rel.surpriseScore > 0.5) {
                    analyses.push({
                        relationship: rel,
                        surpriseScore: rel.surpriseScore,
                        reasons: ['Previously flagged as surprising'],
                        isHighSurprise: rel.surpriseScore >= getSurpriseThreshold(),
                    });
                }
            }
        }

        return analyses.sort((a, b) => b.surpriseScore - a.surpriseScore);
    }

    /**
     * Update surprise score for a relationship after analysis
     */
    public async updateRelationshipSurprise(
        relationshipId: string,
        surpriseScore: number
    ): Promise<void> {
        if (!this.enabled) {
            return;
        }

        await this.repository.updateRelationship(relationshipId, { surpriseScore });
    }

    /**
     * Emit high surprise relationship event
     */
    private emitHighSurpriseEvent(analysis: SurpriseAnalysis, channelId: ChannelId): void {
        try {
            const payload = createBaseEventPayload(
                KnowledgeGraphEvents.HIGH_SURPRISE_RELATIONSHIP,
                'system',
                channelId,
                {
                    relationshipId: analysis.relationship.id,
                    channelId,
                    fromEntityId: analysis.relationship.fromEntityId,
                    toEntityId: analysis.relationship.toEntityId,
                    type: analysis.relationship.type,
                    surpriseScore: analysis.surpriseScore,
                    reason: analysis.reasons.join('; '),
                }
            );
            EventBus.server.emit(KnowledgeGraphEvents.HIGH_SURPRISE_RELATIONSHIP, payload);

            this.logger.info(
                `High surprise relationship detected: ${analysis.relationship.fromEntityId} -[${analysis.relationship.type}]-> ${analysis.relationship.toEntityId} (score: ${analysis.surpriseScore.toFixed(2)})`
            );
        } catch (error: any) {
            this.logger.warn(`Failed to emit high surprise event: ${error.message}`);
        }
    }

    /**
     * Emit conflicting relationship event
     */
    private emitConflictEvent(
        newRel: Relationship,
        existingRel: Relationship,
        channelId: ChannelId
    ): void {
        try {
            const payload = createBaseEventPayload(
                KnowledgeGraphEvents.CONFLICTING_RELATIONSHIP,
                'system',
                channelId,
                {
                    newRelationshipId: newRel.id,
                    existingRelationshipId: existingRel.id,
                    channelId,
                    conflictType: 'type_conflict',
                    description: `New ${newRel.type} relationship conflicts with existing ${existingRel.type} relationship`,
                }
            );
            EventBus.server.emit(KnowledgeGraphEvents.CONFLICTING_RELATIONSHIP, payload);
        } catch (error: any) {
            this.logger.warn(`Failed to emit conflict event: ${error.message}`);
        }
    }
}
