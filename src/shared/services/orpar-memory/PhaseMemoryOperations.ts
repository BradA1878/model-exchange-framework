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
 * PhaseMemoryOperations
 *
 * Unified interface for phase-specific store/retrieve semantics.
 * This service provides a clean API for ORPAR phases to interact with memory.
 *
 * | Phase       | Retrieves From                    | Stores To    | Content Type    |
 * |-------------|-----------------------------------|--------------|-----------------|
 * | OBSERVATION | Working, Short-term, Episodic     | Working      | Raw observations|
 * | REASONING   | Episodic, Semantic, Long-term     | Episodic     | Analysis        |
 * | PLANNING    | Semantic, Long-term, Episodic     | Short-term   | Plans           |
 * | ACTION      | Working, Short-term               | Working      | Tool results    |
 * | REFLECTION  | All strata                        | Long-term    | Learnings       |
 *
 * Feature flag: ORPAR_MEMORY_INTEGRATION_ENABLED
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import {
    MemoryStratum,
    MemoryEntry,
    MemoryImportance,
    MemorySource,
    MemoryContext
} from '../../types/MemoryStrataTypes';
import { OrparPhase, MemoryUsageRecord } from '../../types/MemoryUtilityTypes';
import {
    PhaseStorageSpec,
    PhaseStorageOptions,
    PhaseRetrievalOptions,
    PhaseStrataRetrievalResult,
    DEFAULT_PHASE_STORAGE_SPECS
} from '../../types/OrparMemoryIntegrationTypes';
import { OrparMemoryEvents } from '../../events/event-definitions/OrparMemoryEvents';
import {
    getOrparMemoryConfig,
    isOrparMemoryIntegrationEnabled,
    getPhaseStorageSpec
} from '../../config/orpar-memory.config';
import { StratumManager } from '../StratumManager';
import { PhaseStrataRouter } from './PhaseStrataRouter';
import { AgentId, ChannelId } from '../../types/ChannelContext';

/**
 * Result of a phase-aware storage operation
 */
export interface PhaseStorageResult {
    /** The created memory entry */
    memory: MemoryEntry;
    /** Target stratum where memory was stored */
    stratum: MemoryStratum;
    /** Tags applied to the memory */
    tags: string[];
    /** Phase that drove the storage */
    phase: OrparPhase;
}

/**
 * PhaseMemoryOperations provides a unified interface for phase-specific memory operations
 */
export class PhaseMemoryOperations {
    private static instance: PhaseMemoryOperations;
    private logger: Logger;
    private stratumManager: StratumManager;
    private phaseStrataRouter: PhaseStrataRouter;
    private enabled: boolean = false;
    private storageSpecs: PhaseStorageSpec[];

    private constructor() {
        this.logger = new Logger('info', 'PhaseMemoryOperations');
        this.stratumManager = StratumManager.getInstance();
        this.phaseStrataRouter = PhaseStrataRouter.getInstance();
        this.storageSpecs = DEFAULT_PHASE_STORAGE_SPECS;
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): PhaseMemoryOperations {
        if (!PhaseMemoryOperations.instance) {
            PhaseMemoryOperations.instance = new PhaseMemoryOperations();
        }
        return PhaseMemoryOperations.instance;
    }

    /**
     * Initialize the PhaseMemoryOperations
     */
    public initialize(): void {
        this.enabled = isOrparMemoryIntegrationEnabled();
        const config = getOrparMemoryConfig();
        this.storageSpecs = config.phaseStorageSpecs;

        if (this.enabled) {
            this.logger.info('[PhaseMemoryOperations] Initialized with ORPAR-Memory integration');
        } else {
            this.logger.debug('[PhaseMemoryOperations] ORPAR-Memory integration is disabled');
        }
    }

    /**
     * Check if operations are enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Retrieve memories for a specific ORPAR phase
     *
     * Uses PhaseStrataRouter to determine which strata to query based on the phase.
     *
     * @param options - Retrieval options
     * @returns Phase-aware retrieval result
     */
    public async retrieve(options: PhaseRetrievalOptions): Promise<PhaseStrataRetrievalResult> {
        if (!this.enabled) {
            return {
                memories: [],
                queriedStrata: [],
                phase: options.phase,
                lambdaUsed: 0.5,
                metadata: {
                    primaryResultCount: 0,
                    secondaryResultCount: 0,
                    queryTimeMs: 0
                }
            };
        }

        // Delegate to PhaseStrataRouter for phase-aware retrieval
        const result = await this.phaseStrataRouter.retrieve(options);

        this.logger.debug(
            `[PhaseMemoryOperations] Retrieved ${result.memories.length} memories for ${options.phase} phase`
        );

        return result;
    }

    /**
     * Store a memory for a specific ORPAR phase
     *
     * Uses the phase storage spec to determine target stratum and auto-tagging.
     *
     * @param options - Storage options
     * @returns The stored memory entry
     */
    public async store(options: PhaseStorageOptions): Promise<PhaseStorageResult> {
        if (!this.enabled || !this.stratumManager.isEnabled()) {
            throw new Error('PhaseMemoryOperations or StratumManager is not enabled');
        }

        // Get the storage spec for this phase
        const spec = this.getStorageSpec(options.phase);

        // Determine target stratum
        const targetStratum = options.targetStratum ?? spec.targetStratum;

        // Build tags
        const tags = [...spec.autoTags];
        if (options.tags) {
            for (const tag of options.tags) {
                if (!tags.includes(tag)) {
                    tags.push(tag);
                }
            }
        }

        // Map importance string to enum value
        const importanceMap: Record<string, MemoryImportance> = {
            'critical': MemoryImportance.Critical,
            'high': MemoryImportance.High,
            'medium': MemoryImportance.Medium,
            'low': MemoryImportance.Low,
            'trivial': MemoryImportance.Trivial
        };
        const importance = importanceMap[options.importance ?? spec.defaultImportance];

        // Build memory source
        const source: MemorySource = {
            type: this.mapContentTypeToSourceType(spec.contentType),
            agentId: options.agentId,
            channelId: options.channelId
        };

        // Build memory context
        const context: MemoryContext = {
            agentId: options.agentId,
            channelId: options.channelId,
            taskId: options.taskId,
            orparPhase: this.mapPhaseToContextPhase(options.phase),
            timestamp: new Date()
        };

        // Store in stratum manager
        const memory = await this.stratumManager.addMemory(
            'agent',
            options.agentId,
            targetStratum,
            {
                stratum: targetStratum,
                content: options.content,
                contentType: 'text',
                importance,
                tags,
                source,
                context,
                relatedMemories: options.relatedMemories ?? [],
                metadata: options.metadata
            }
        );

        // Emit storage event
        EventBus.server.emit(OrparMemoryEvents.PHASE_MEMORY_STORED, {
            agentId: options.agentId,
            channelId: options.channelId ?? 'unknown',
            phase: options.phase,
            memoryId: memory.id,
            targetStratum,
            contentType: spec.contentType,
            tags
        });

        this.logger.debug(
            `[PhaseMemoryOperations] Stored memory ${memory.id} in ${targetStratum} for ${options.phase} phase`
        );

        return {
            memory,
            stratum: targetStratum,
            tags,
            phase: options.phase
        };
    }

    /**
     * Create a memory usage record for tracking
     *
     * @param memoryId - The memory ID
     * @param phase - The ORPAR phase
     * @param usageType - How the memory was used
     * @returns A memory usage record
     */
    public createUsageRecord(
        memoryId: string,
        phase: OrparPhase,
        usageType: 'context' | 'reasoning' | 'action-guidance' | 'pattern-match' = 'context'
    ): MemoryUsageRecord {
        return {
            memoryId,
            phase,
            retrievedAt: new Date(),
            usageType
        };
    }

    /**
     * Record memory usage for a phase
     *
     * @param agentId - Agent ID
     * @param channelId - Channel ID
     * @param cycleId - Cycle ID
     * @param phase - ORPAR phase
     * @param memoryId - Memory ID
     * @param usageType - How the memory was used
     */
    public recordUsage(
        agentId: AgentId,
        channelId: ChannelId,
        cycleId: string,
        phase: OrparPhase,
        memoryId: string,
        usageType: string = 'context'
    ): void {
        EventBus.server.emit(OrparMemoryEvents.CYCLE_MEMORY_USAGE_RECORDED, {
            agentId,
            channelId,
            cycleId,
            phase,
            memoryId,
            usageType
        });
    }

    /**
     * Get the storage spec for a phase
     */
    public getStorageSpec(phase: OrparPhase): PhaseStorageSpec {
        const spec = this.storageSpecs.find(s => s.phase === phase);
        if (!spec) {
            // Return a default spec
            this.logger.warn(`[PhaseMemoryOperations] No storage spec for phase ${phase}, using observation defaults`);
            return DEFAULT_PHASE_STORAGE_SPECS[0];
        }
        return spec;
    }

    /**
     * Get the recommended stratum for storing content from a phase
     */
    public getTargetStratum(phase: OrparPhase): MemoryStratum {
        return this.getStorageSpec(phase).targetStratum;
    }

    /**
     * Get the recommended tags for a phase
     */
    public getAutoTags(phase: OrparPhase): string[] {
        return [...this.getStorageSpec(phase).autoTags];
    }

    /**
     * Map content type to memory source type
     */
    private mapContentTypeToSourceType(contentType: string): MemorySource['type'] {
        const mapping: Record<string, MemorySource['type']> = {
            'observation': 'observation',
            'analysis': 'reasoning',
            'plan': 'reasoning',
            'action_result': 'observation',
            'learning': 'reflection'
        };
        return mapping[contentType] ?? 'observation';
    }

    /**
     * Map ORPAR phase to memory context phase
     */
    private mapPhaseToContextPhase(phase: OrparPhase): MemoryContext['orparPhase'] {
        const mapping: Record<OrparPhase, MemoryContext['orparPhase']> = {
            'observation': 'observe',
            'reasoning': 'reason',
            'planning': 'plan',
            'action': 'act',
            'reflection': 'reflect'
        };
        return mapping[phase];
    }

    /**
     * Store observation content (convenience method)
     */
    public async storeObservation(
        agentId: AgentId,
        content: string,
        options?: Partial<PhaseStorageOptions>
    ): Promise<PhaseStorageResult> {
        return this.store({
            content,
            phase: 'observation',
            agentId,
            ...options
        });
    }

    /**
     * Store reasoning/analysis content (convenience method)
     */
    public async storeReasoning(
        agentId: AgentId,
        content: string,
        options?: Partial<PhaseStorageOptions>
    ): Promise<PhaseStorageResult> {
        return this.store({
            content,
            phase: 'reasoning',
            agentId,
            ...options
        });
    }

    /**
     * Store plan content (convenience method)
     */
    public async storePlan(
        agentId: AgentId,
        content: string,
        options?: Partial<PhaseStorageOptions>
    ): Promise<PhaseStorageResult> {
        return this.store({
            content,
            phase: 'planning',
            agentId,
            ...options
        });
    }

    /**
     * Store action result content (convenience method)
     */
    public async storeActionResult(
        agentId: AgentId,
        content: string,
        options?: Partial<PhaseStorageOptions>
    ): Promise<PhaseStorageResult> {
        return this.store({
            content,
            phase: 'action',
            agentId,
            ...options
        });
    }

    /**
     * Store reflection/learning content (convenience method)
     */
    public async storeReflection(
        agentId: AgentId,
        content: string,
        options?: Partial<PhaseStorageOptions>
    ): Promise<PhaseStorageResult> {
        return this.store({
            content,
            phase: 'reflection',
            agentId,
            ...options
        });
    }

    /**
     * Retrieve memories for observation phase (convenience method)
     */
    public async retrieveForObservation(
        agentId: AgentId,
        query: string,
        options?: Partial<PhaseRetrievalOptions>
    ): Promise<PhaseStrataRetrievalResult> {
        return this.retrieve({
            query,
            phase: 'observation',
            agentId,
            ...options
        });
    }

    /**
     * Retrieve memories for reasoning phase (convenience method)
     */
    public async retrieveForReasoning(
        agentId: AgentId,
        query: string,
        options?: Partial<PhaseRetrievalOptions>
    ): Promise<PhaseStrataRetrievalResult> {
        return this.retrieve({
            query,
            phase: 'reasoning',
            agentId,
            ...options
        });
    }

    /**
     * Retrieve memories for planning phase (convenience method)
     */
    public async retrieveForPlanning(
        agentId: AgentId,
        query: string,
        options?: Partial<PhaseRetrievalOptions>
    ): Promise<PhaseStrataRetrievalResult> {
        return this.retrieve({
            query,
            phase: 'planning',
            agentId,
            ...options
        });
    }

    /**
     * Retrieve memories for action phase (convenience method)
     */
    public async retrieveForAction(
        agentId: AgentId,
        query: string,
        options?: Partial<PhaseRetrievalOptions>
    ): Promise<PhaseStrataRetrievalResult> {
        return this.retrieve({
            query,
            phase: 'action',
            agentId,
            ...options
        });
    }

    /**
     * Retrieve memories for reflection phase (convenience method)
     */
    public async retrieveForReflection(
        agentId: AgentId,
        query: string,
        options?: Partial<PhaseRetrievalOptions>
    ): Promise<PhaseStrataRetrievalResult> {
        return this.retrieve({
            query,
            phase: 'reflection',
            agentId,
            ...options
        });
    }

    /**
     * Reset the operations service (useful for testing)
     */
    public reset(): void {
        this.enabled = false;
        this.storageSpecs = DEFAULT_PHASE_STORAGE_SPECS;
    }
}
