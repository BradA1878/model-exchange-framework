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
 * OrparGraphIntegration
 *
 * Integrates Knowledge Graph with ORPAR control loop phases.
 * Provides phase-specific context from the graph to enhance
 * agent reasoning, planning, and reflection.
 *
 * Phase-specific behavior:
 * - Observation: Get entities mentioned in task context
 * - Reasoning: Expanded subgraph with high-utility entities
 * - Planning: Dependencies, blockers, resources from graph
 * - Action: Relevant tools and resources for the task
 * - Reflection: Update graph based on task outcomes
 */

import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { KnowledgeGraphEvents } from '../../events/event-definitions/KnowledgeGraphEvents';
import { KnowledgeGraphService } from './KnowledgeGraphService';
import { EntityExtractionService } from './EntityExtractionService';
import { EntityQValueManager } from './EntityQValueManager';
import { GraphSurpriseCalculator, SurpriseAnalysis } from './GraphSurpriseCalculator';
import {
    isKnowledgeGraphEnabled,
    isOrparIntegrationEnabled,
} from '../../config/knowledge-graph.config';
import {
    Entity,
    Relationship,
    GraphContext,
    EntityType,
    RelationshipType,
} from '../../types/KnowledgeGraphTypes';
import { ChannelId } from '../../types/ChannelContext';
import { AgentId } from '../../types/Agent';
import { OrparPhase } from '../../types/MemoryUtilityTypes';
import { createBaseEventPayload } from '../../schemas/EventPayloadSchema';

/**
 * Context for a specific ORPAR phase
 */
export interface PhaseGraphContext {
    /** ORPAR phase this context is for */
    phase: OrparPhase;
    /** Entities relevant to this phase */
    entities: Entity[];
    /** Relationships relevant to this phase */
    relationships: Relationship[];
    /** High-utility entities (sorted by Q-value) */
    highUtilityEntities: Entity[];
    /** Surprising relationships that may warrant attention */
    surprisingRelationships: SurpriseAnalysis[];
    /** Summary text for agent consumption */
    summary: string;
    /** Execution time in milliseconds */
    executionTimeMs: number;
}

/**
 * Observation context - entities mentioned in task content
 */
export interface ObservationContext extends PhaseGraphContext {
    /** Keywords extracted from observation */
    extractedKeywords: string[];
    /** Entities that match keywords */
    matchingEntities: Entity[];
}

/**
 * Reasoning context - expanded subgraph for deeper analysis
 */
export interface ReasoningContext extends PhaseGraphContext {
    /** Paths between key entities */
    entityPaths: Array<{
        from: Entity;
        to: Entity;
        path: Entity[];
        relationships: Relationship[];
    }>;
    /** Conflicting information in the graph */
    conflicts: Array<{
        entity1: Entity;
        entity2: Entity;
        conflict: string;
    }>;
}

/**
 * Planning context - resources and dependencies
 */
export interface PlanningContext extends PhaseGraphContext {
    /** Entities that may block progress */
    blockers: Entity[];
    /** Required resources from the graph */
    requiredResources: Entity[];
    /** Dependencies that must be satisfied */
    dependencies: Array<{
        entity: Entity;
        dependsOn: Entity[];
        type: string;
    }>;
}

/**
 * Reflection update - changes to apply to the graph
 */
export interface ReflectionUpdate {
    /** New entities to create */
    newEntities: Array<{
        name: string;
        type: EntityType;
        description?: string;
    }>;
    /** New relationships to create */
    newRelationships: Array<{
        fromEntityName: string;
        toEntityName: string;
        type: RelationshipType;
        label?: string;
    }>;
    /** Entity Q-value updates */
    qValueUpdates: Array<{
        entityId: string;
        reward: number;
        reason: string;
    }>;
    /** Entities involved in the task outcome */
    involvedEntityIds: string[];
    /** Whether the task was successful */
    taskSuccess: boolean;
    /** Task ID if applicable */
    taskId?: string;
}

/**
 * OrparGraphIntegration service
 */
export class OrparGraphIntegration {
    private static instance: OrparGraphIntegration;
    private logger: Logger;
    private enabled: boolean = false;
    private kgService: KnowledgeGraphService;
    private extractionService: EntityExtractionService;
    private qValueManager: EntityQValueManager;
    private surpriseCalculator: GraphSurpriseCalculator;

    private constructor() {
        this.logger = new Logger('info', 'OrparGraphIntegration', 'server');
        this.kgService = KnowledgeGraphService.getInstance();
        this.extractionService = EntityExtractionService.getInstance();
        this.qValueManager = EntityQValueManager.getInstance();
        this.surpriseCalculator = GraphSurpriseCalculator.getInstance();
        this.initialize();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): OrparGraphIntegration {
        if (!OrparGraphIntegration.instance) {
            OrparGraphIntegration.instance = new OrparGraphIntegration();
        }
        return OrparGraphIntegration.instance;
    }

    /**
     * Initialize the service
     */
    private initialize(): void {
        this.enabled = isKnowledgeGraphEnabled() && isOrparIntegrationEnabled();

        if (!this.enabled) {
            this.logger.debug('OrparGraphIntegration initialized but disabled');
            return;
        }

        this.logger.info('OrparGraphIntegration initialized');
    }

    /**
     * Check if the service is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Get observation context - entities mentioned in task content
     */
    public async getObservationContext(
        channelId: ChannelId,
        agentId: AgentId,
        taskContent: string,
        keywords?: string[]
    ): Promise<ObservationContext> {
        const startTime = Date.now();

        if (!this.enabled) {
            return this.createEmptyObservationContext(startTime);
        }

        // Extract keywords from content if not provided
        const extractedKeywords = keywords || this.extractKeywords(taskContent);

        // Find entities matching keywords
        const matchingEntities: Entity[] = [];
        for (const keyword of extractedKeywords) {
            const entities = await this.kgService.findEntityByName(channelId, keyword, false);
            for (const entity of entities) {
                if (!matchingEntities.find((e) => e.id === entity.id)) {
                    matchingEntities.push(entity);
                }
            }
        }

        // Get relationships between matching entities
        const relationships: Relationship[] = [];
        for (const entity of matchingEntities) {
            const neighbors = await this.kgService.getNeighbors(entity.id, { limit: 5 });
            for (const rel of neighbors.relationships) {
                if (!relationships.find((r) => r.id === rel.id)) {
                    relationships.push(rel);
                }
            }
        }

        // Get high-utility entities
        const highUtilityEntities = await this.kgService.getHighUtilityEntities(channelId, 10);

        // Get surprising relationships
        const surprisingRelationships = await this.surpriseCalculator.analyzeChannelSurprises(channelId);

        const executionTimeMs = Date.now() - startTime;

        // Build summary
        const summary = this.buildObservationSummary(matchingEntities, extractedKeywords);

        // Emit event
        this.emitPhaseContextEvent(channelId, agentId, 'observation', matchingEntities.length, executionTimeMs);

        return {
            phase: 'observation',
            entities: matchingEntities,
            relationships,
            highUtilityEntities,
            surprisingRelationships: surprisingRelationships.slice(0, 5),
            summary,
            executionTimeMs,
            extractedKeywords,
            matchingEntities,
        };
    }

    /**
     * Get reasoning context - expanded subgraph for deeper analysis
     */
    public async getReasoningContext(
        channelId: ChannelId,
        agentId: AgentId,
        centralEntityIds: string[],
        keywords?: string[]
    ): Promise<ReasoningContext> {
        const startTime = Date.now();

        if (!this.enabled) {
            return this.createEmptyReasoningContext(startTime);
        }

        // Get graph context around central entities
        const graphContext = await this.kgService.getGraphContext(channelId, undefined, keywords);

        // Get expanded subgraph for central entities
        const allEntities: Entity[] = [...graphContext.centralEntities, ...graphContext.relatedEntities];
        const allRelationships: Relationship[] = [...graphContext.relationships];

        // If graph context is empty (new graph, no high-Q entities yet), fall back to high-utility entities
        if (allEntities.length === 0) {
            const fallbackEntities = await this.kgService.getHighUtilityEntities(channelId, 10);
            allEntities.push(...fallbackEntities);
        }

        for (const entityId of centralEntityIds) {
            const subgraph = await this.kgService.getEntityContext(entityId, 2);
            for (const entity of subgraph.entities) {
                if (!allEntities.find((e) => e.id === entity.id)) {
                    allEntities.push(entity);
                }
            }
            for (const rel of subgraph.relationships) {
                if (!allRelationships.find((r) => r.id === rel.id)) {
                    allRelationships.push(rel);
                }
            }
        }

        // Find paths between central entities
        const entityPaths: ReasoningContext['entityPaths'] = [];
        if (centralEntityIds.length >= 2) {
            for (let i = 0; i < centralEntityIds.length - 1; i++) {
                const path = await this.kgService.findPath(
                    centralEntityIds[i],
                    centralEntityIds[i + 1],
                    3
                );
                if (path) {
                    const fromEntity = allEntities.find((e) => e.id === centralEntityIds[i]);
                    const toEntity = allEntities.find((e) => e.id === centralEntityIds[i + 1]);
                    if (fromEntity && toEntity) {
                        const pathEntities = path.entityIds
                            .map((id) => allEntities.find((e) => e.id === id))
                            .filter((e): e is Entity => e !== undefined);
                        const pathRelationships = path.relationshipIds
                            .map((id) => allRelationships.find((r) => r.id === id))
                            .filter((r): r is Relationship => r !== undefined);

                        entityPaths.push({
                            from: fromEntity,
                            to: toEntity,
                            path: pathEntities,
                            relationships: pathRelationships,
                        });
                    }
                }
            }
        }

        // Detect conflicts (entities with CONFLICTS_WITH relationships)
        const conflicts: ReasoningContext['conflicts'] = [];
        for (const rel of allRelationships) {
            if (rel.type === RelationshipType.CONFLICTS_WITH) {
                const entity1 = allEntities.find((e) => e.id === rel.fromEntityId);
                const entity2 = allEntities.find((e) => e.id === rel.toEntityId);
                if (entity1 && entity2) {
                    conflicts.push({
                        entity1,
                        entity2,
                        conflict: rel.label || 'Conflict detected',
                    });
                }
            }
        }

        const executionTimeMs = Date.now() - startTime;
        const summary = this.buildReasoningSummary(allEntities, entityPaths, conflicts);

        this.emitPhaseContextEvent(channelId, agentId, 'reasoning', allEntities.length, executionTimeMs);

        return {
            phase: 'reasoning',
            entities: allEntities,
            relationships: allRelationships,
            highUtilityEntities: graphContext.highUtilityEntities,
            surprisingRelationships: await this.surpriseCalculator.analyzeChannelSurprises(channelId),
            summary,
            executionTimeMs,
            entityPaths,
            conflicts,
        };
    }

    /**
     * Get planning context - resources and dependencies
     */
    public async getPlanningContext(
        channelId: ChannelId,
        agentId: AgentId,
        taskEntityIds: string[]
    ): Promise<PlanningContext> {
        const startTime = Date.now();

        if (!this.enabled) {
            return this.createEmptyPlanningContext(startTime);
        }

        const entities: Entity[] = [];
        const relationships: Relationship[] = [];
        const blockers: Entity[] = [];
        const requiredResources: Entity[] = [];
        const dependencies: PlanningContext['dependencies'] = [];

        // Get entities and their dependencies
        for (const entityId of taskEntityIds) {
            const entity = await this.kgService.getEntity(entityId);
            if (entity) {
                entities.push(entity);

                // Get relationships for this entity
                const neighbors = await this.kgService.getNeighbors(entityId, {
                    direction: 'both',
                    limit: 20,
                });

                for (const rel of neighbors.relationships) {
                    if (!relationships.find((r) => r.id === rel.id)) {
                        relationships.push(rel);
                    }

                    // Identify blockers
                    if (rel.type === RelationshipType.CONFLICTS_WITH) {
                        const blocker = neighbors.entities.find((e) => e.id === rel.toEntityId);
                        if (blocker && !blockers.find((b) => b.id === blocker.id)) {
                            blockers.push(blocker);
                        }
                    }

                    // Identify required resources
                    if (
                        rel.type === RelationshipType.REQUIRES ||
                        rel.type === RelationshipType.DEPENDS_ON
                    ) {
                        const resource = neighbors.entities.find((e) => e.id === rel.toEntityId);
                        if (resource && !requiredResources.find((r) => r.id === resource.id)) {
                            requiredResources.push(resource);
                        }

                        // Build dependency structure
                        const existingDep = dependencies.find((d) => d.entity.id === entity.id);
                        if (existingDep) {
                            if (resource && !existingDep.dependsOn.find((d) => d.id === resource.id)) {
                                existingDep.dependsOn.push(resource);
                            }
                        } else {
                            dependencies.push({
                                entity,
                                dependsOn: resource ? [resource] : [],
                                type: rel.type,
                            });
                        }
                    }
                }
            }
        }

        // Get high-utility entities
        const highUtilityEntities = await this.kgService.getHighUtilityEntities(channelId, 10);

        // If no task-specific entities were found, use high-utility entities as the main entity set
        if (entities.length === 0 && highUtilityEntities.length > 0) {
            entities.push(...highUtilityEntities);
        }

        const executionTimeMs = Date.now() - startTime;
        const summary = this.buildPlanningSummary(entities, blockers, dependencies);

        this.emitPhaseContextEvent(channelId, agentId, 'planning', entities.length, executionTimeMs);

        return {
            phase: 'planning',
            entities,
            relationships,
            highUtilityEntities,
            surprisingRelationships: [],
            summary,
            executionTimeMs,
            blockers,
            requiredResources,
            dependencies,
        };
    }

    /**
     * Update graph based on reflection/task outcome
     */
    public async applyReflectionUpdate(
        channelId: ChannelId,
        agentId: AgentId,
        update: ReflectionUpdate
    ): Promise<{
        entitiesCreated: number;
        relationshipsCreated: number;
        qValuesUpdated: number;
    }> {
        if (!this.enabled) {
            return { entitiesCreated: 0, relationshipsCreated: 0, qValuesUpdated: 0 };
        }

        let entitiesCreated = 0;
        let relationshipsCreated = 0;
        let qValuesUpdated = 0;

        // Create new entities
        const entityNameToId = new Map<string, string>();
        for (const entityDef of update.newEntities) {
            try {
                const entity = await this.kgService.findOrCreateEntity({
                    channelId,
                    type: entityDef.type,
                    name: entityDef.name,
                    description: entityDef.description,
                    source: 'reflection',
                    confidence: 0.8,
                });
                entityNameToId.set(entityDef.name.toLowerCase(), entity.id);
                entitiesCreated++;
            } catch (error: any) {
                this.logger.warn(`Failed to create entity ${entityDef.name}: ${error.message}`);
            }
        }

        // Create new relationships
        for (const relDef of update.newRelationships) {
            const fromId = entityNameToId.get(relDef.fromEntityName.toLowerCase());
            const toId = entityNameToId.get(relDef.toEntityName.toLowerCase());

            if (fromId && toId) {
                try {
                    await this.kgService.createRelationship({
                        channelId,
                        fromEntityId: fromId,
                        toEntityId: toId,
                        type: relDef.type,
                        label: relDef.label,
                        source: 'reflection',
                        confidence: 0.7,
                    });
                    relationshipsCreated++;
                } catch (error: any) {
                    this.logger.debug(`Failed to create relationship: ${error.message}`);
                }
            }
        }

        // Apply Q-value updates
        for (const qUpdate of update.qValueUpdates) {
            const result = await this.qValueManager.updateEntityQValue({
                entityId: qUpdate.entityId,
                reward: qUpdate.reward,
                reason: qUpdate.reason,
            });
            if (result) {
                qValuesUpdated++;
            }
        }

        // Propagate task outcome to involved entities
        if (update.involvedEntityIds.length > 0) {
            const results = await this.qValueManager.propagateTaskReward(
                channelId,
                update.involvedEntityIds,
                {
                    taskId: update.taskId || `reflection-${Date.now()}`,
                    success: update.taskSuccess,
                }
            );
            qValuesUpdated += results.length;
        }

        // Emit reflection update event
        this.emitEvent(KnowledgeGraphEvents.GRAPH_UPDATED, channelId, agentId, {
            channelId,
            source: 'reflection',
            entitiesCreated,
            relationshipsCreated,
            qValuesUpdated,
            taskId: update.taskId,
        });

        this.logger.info(
            `Reflection update applied: ${entitiesCreated} entities, ${relationshipsCreated} relationships, ${qValuesUpdated} Q-values`
        );

        return { entitiesCreated, relationshipsCreated, qValuesUpdated };
    }

    /**
     * Get general phase context
     */
    public async getPhaseContext(
        channelId: ChannelId,
        agentId: AgentId,
        phase: OrparPhase,
        taskContent?: string,
        entityIds?: string[]
    ): Promise<PhaseGraphContext> {
        switch (phase) {
            case 'observation':
                return this.getObservationContext(channelId, agentId, taskContent || '');
            case 'reasoning':
                return this.getReasoningContext(channelId, agentId, entityIds || []);
            case 'planning':
                return this.getPlanningContext(channelId, agentId, entityIds || []);
            case 'action':
                // Action phase uses planning context
                return this.getPlanningContext(channelId, agentId, entityIds || []);
            case 'reflection':
                // Reflection phase doesn't need pre-context, it applies updates
                return this.createEmptyPhaseContext(phase, Date.now());
            default:
                return this.createEmptyPhaseContext(phase, Date.now());
        }
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    /**
     * Extract keywords from text
     */
    private extractKeywords(text: string): string[] {
        // Simple keyword extraction - extract capitalized words and tech terms
        const keywords: string[] = [];

        // Extract capitalized words (potential entities)
        const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
        let match;
        while ((match = capitalizedPattern.exec(text)) !== null) {
            if (!keywords.includes(match[0].toLowerCase())) {
                keywords.push(match[0].toLowerCase());
            }
        }

        // Extract common tech terms
        const techTerms = [
            'api', 'database', 'server', 'client', 'service', 'component',
            'function', 'method', 'class', 'interface', 'module', 'package',
        ];
        for (const term of techTerms) {
            if (text.toLowerCase().includes(term) && !keywords.includes(term)) {
                keywords.push(term);
            }
        }

        return keywords.slice(0, 20); // Limit keywords
    }

    /**
     * Build observation summary
     */
    private buildObservationSummary(entities: Entity[], keywords: string[]): string {
        if (entities.length === 0) {
            return 'No entities found matching the observation keywords.';
        }

        const entityTypes = new Map<string, number>();
        for (const entity of entities) {
            entityTypes.set(entity.type, (entityTypes.get(entity.type) || 0) + 1);
        }

        const typesSummary = Array.from(entityTypes.entries())
            .map(([type, count]) => `${count} ${type}(s)`)
            .join(', ');

        return `Found ${entities.length} entities (${typesSummary}) matching keywords: ${keywords.slice(0, 5).join(', ')}${keywords.length > 5 ? '...' : ''}.`;
    }

    /**
     * Build reasoning summary
     */
    private buildReasoningSummary(
        entities: Entity[],
        paths: ReasoningContext['entityPaths'],
        conflicts: ReasoningContext['conflicts']
    ): string {
        const parts: string[] = [];

        parts.push(`Expanded graph contains ${entities.length} entities.`);

        if (paths.length > 0) {
            parts.push(`Found ${paths.length} path(s) between key entities.`);
        }

        if (conflicts.length > 0) {
            parts.push(`Detected ${conflicts.length} potential conflict(s) to consider.`);
        }

        return parts.join(' ');
    }

    /**
     * Build planning summary
     */
    private buildPlanningSummary(
        entities: Entity[],
        blockers: Entity[],
        dependencies: PlanningContext['dependencies']
    ): string {
        const parts: string[] = [];

        parts.push(`Planning context includes ${entities.length} entities.`);

        if (blockers.length > 0) {
            parts.push(`${blockers.length} potential blocker(s) identified.`);
        }

        if (dependencies.length > 0) {
            const totalDeps = dependencies.reduce((sum, d) => sum + d.dependsOn.length, 0);
            parts.push(`${totalDeps} dependency relationship(s) to consider.`);
        }

        return parts.join(' ');
    }

    /**
     * Create empty observation context
     */
    private createEmptyObservationContext(startTime: number): ObservationContext {
        return {
            phase: 'observation',
            entities: [],
            relationships: [],
            highUtilityEntities: [],
            surprisingRelationships: [],
            summary: 'Knowledge graph integration is disabled.',
            executionTimeMs: Date.now() - startTime,
            extractedKeywords: [],
            matchingEntities: [],
        };
    }

    /**
     * Create empty reasoning context
     */
    private createEmptyReasoningContext(startTime: number): ReasoningContext {
        return {
            phase: 'reasoning',
            entities: [],
            relationships: [],
            highUtilityEntities: [],
            surprisingRelationships: [],
            summary: 'Knowledge graph integration is disabled.',
            executionTimeMs: Date.now() - startTime,
            entityPaths: [],
            conflicts: [],
        };
    }

    /**
     * Create empty planning context
     */
    private createEmptyPlanningContext(startTime: number): PlanningContext {
        return {
            phase: 'planning',
            entities: [],
            relationships: [],
            highUtilityEntities: [],
            surprisingRelationships: [],
            summary: 'Knowledge graph integration is disabled.',
            executionTimeMs: Date.now() - startTime,
            blockers: [],
            requiredResources: [],
            dependencies: [],
        };
    }

    /**
     * Create empty phase context
     */
    private createEmptyPhaseContext(phase: OrparPhase, startTime: number): PhaseGraphContext {
        return {
            phase,
            entities: [],
            relationships: [],
            highUtilityEntities: [],
            surprisingRelationships: [],
            summary: 'Knowledge graph integration is disabled.',
            executionTimeMs: Date.now() - startTime,
        };
    }

    /**
     * Emit phase context event
     */
    private emitPhaseContextEvent(
        channelId: ChannelId,
        agentId: AgentId,
        phase: OrparPhase,
        entityCount: number,
        executionTimeMs: number
    ): void {
        this.emitEvent(KnowledgeGraphEvents.CONTEXT_RETRIEVED, channelId, agentId, {
            channelId,
            contextType: `orpar_${phase}`,
            entityCount,
            executionTimeMs,
        });
    }

    /**
     * Emit event
     */
    private emitEvent(
        eventType: string,
        channelId: ChannelId,
        agentId: AgentId,
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
