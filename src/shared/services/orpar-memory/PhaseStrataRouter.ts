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
 * PhaseStrataRouter
 *
 * Routes memory queries to appropriate strata based on ORPAR phase.
 * This service implements the phase-strata mapping defined in the
 * ORPAR-Memory integration architecture.
 *
 * | Phase       | Primary Strata         | Secondary    | Lambda |
 * |-------------|------------------------|--------------|--------|
 * | OBSERVATION | Working, Short-term    | Episodic     | 0.2    |
 * | REASONING   | Episodic, Semantic     | Long-term    | 0.5    |
 * | PLANNING    | Semantic, Long-term    | Episodic     | 0.7    |
 * | ACTION      | Working, Short-term    | -            | 0.3    |
 * | REFLECTION  | All strata             | -            | 0.6    |
 *
 * Feature flag: ORPAR_MEMORY_INTEGRATION_ENABLED
 */

import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { MemoryStratum, MemoryEntry, MemoryQuery, MemoryRetrievalResult } from '../../types/MemoryStrataTypes';
import { OrparPhase } from '../../types/MemoryUtilityTypes';
import {
    PhaseStrataMapping,
    PhaseStrataRetrievalResult,
    PhaseRetrievalOptions,
    DEFAULT_PHASE_STRATA_MAPPINGS
} from '../../types/OrparMemoryIntegrationTypes';
import { OrparMemoryEvents } from '../../events/event-definitions/OrparMemoryEvents';
import {
    getOrparMemoryConfig,
    isOrparMemoryIntegrationEnabled,
    getPhaseStrataMapping
} from '../../config/orpar-memory.config';
import { StratumManager } from '../StratumManager';
import { QValueManager } from '../QValueManager';
import { AgentId, ChannelId } from '../../types/ChannelContext';

/**
 * PhaseStrataRouter routes memory queries to appropriate strata based on ORPAR phase
 */
export class PhaseStrataRouter {
    private static instance: PhaseStrataRouter;
    private logger: Logger;
    private stratumManager: StratumManager;
    private qValueManager: QValueManager;
    private enabled: boolean = false;

    // Fix #9: Named constant for access count normalization threshold
    private static readonly ACCESS_COUNT_NORMALIZATION_THRESHOLD = 10;

    private constructor() {
        this.logger = new Logger('info', 'PhaseStrataRouter');
        this.stratumManager = StratumManager.getInstance();
        this.qValueManager = QValueManager.getInstance();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): PhaseStrataRouter {
        if (!PhaseStrataRouter.instance) {
            PhaseStrataRouter.instance = new PhaseStrataRouter();
        }
        return PhaseStrataRouter.instance;
    }

    /**
     * Initialize the PhaseStrataRouter
     */
    public initialize(): void {
        this.enabled = isOrparMemoryIntegrationEnabled();

        if (this.enabled) {
            this.logger.info('[PhaseStrataRouter] Initialized with ORPAR-Memory integration');
        } else {
            this.logger.debug('[PhaseStrataRouter] ORPAR-Memory integration is disabled');
        }
    }

    /**
     * Check if the router is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Get the strata mapping for a given ORPAR phase
     *
     * @param phase - The ORPAR phase
     * @returns The strata mapping for that phase
     */
    public getMapping(phase: OrparPhase): PhaseStrataMapping {
        const config = getOrparMemoryConfig();
        const mapping = config.phaseStrataMappings.find(m => m.phase === phase);

        if (!mapping) {
            // Return a default mapping if not found (shouldn't happen with proper config)
            this.logger.warn(`[PhaseStrataRouter] No mapping found for phase ${phase}, using observation defaults`);
            return DEFAULT_PHASE_STRATA_MAPPINGS[0];
        }

        return mapping;
    }

    /**
     * Get the strata to query for a given phase
     *
     * @param phase - The ORPAR phase
     * @param includeSecondary - Whether to include secondary strata
     * @returns Array of strata to query
     */
    public getStrataForPhase(phase: OrparPhase, includeSecondary: boolean = true): MemoryStratum[] {
        const mapping = this.getMapping(phase);
        const strata = [...mapping.primaryStrata];

        if (includeSecondary && mapping.secondaryStrata.length > 0) {
            // Add secondary strata that aren't already in the list
            for (const stratum of mapping.secondaryStrata) {
                if (!strata.includes(stratum)) {
                    strata.push(stratum);
                }
            }
        }

        return strata;
    }

    /**
     * Get the lambda value for a given phase
     *
     * @param phase - The ORPAR phase
     * @returns The lambda value for utility weighting
     */
    public getLambdaForPhase(phase: OrparPhase): number {
        const mapping = this.getMapping(phase);
        return mapping.lambda;
    }

    /**
     * Retrieve memories using phase-aware strata routing
     *
     * @param options - Retrieval options including phase, query, and scope
     * @returns Phase-aware retrieval result
     */
    public async retrieve(options: PhaseRetrievalOptions): Promise<PhaseStrataRetrievalResult> {
        const startTime = Date.now();

        if (!this.enabled || !this.stratumManager.isEnabled()) {
            // Return empty result if disabled
            return {
                memories: [],
                queriedStrata: [],
                phase: options.phase,
                lambdaUsed: options.lambda ?? this.getLambdaForPhase(options.phase),
                metadata: {
                    primaryResultCount: 0,
                    secondaryResultCount: 0,
                    queryTimeMs: 0
                }
            };
        }

        const mapping = this.getMapping(options.phase);
        const lambda = options.lambda ?? mapping.lambda;
        const includeSecondary = options.includeSecondary ?? true;

        // Build the strata list
        const primaryStrata = mapping.primaryStrata;
        const secondaryStrata = includeSecondary ? mapping.secondaryStrata : [];
        const allStrata = [...primaryStrata, ...secondaryStrata.filter(s => !primaryStrata.includes(s))];

        // Build query for each scope
        const query: MemoryQuery = {
            query: options.query,
            strata: allStrata,
            tags: options.tags,
            timeRange: options.timeRange,
            limit: options.maxResults ?? 10
        };

        let allMemories: MemoryEntry[] = [];
        let primaryResultCount = 0;
        let secondaryResultCount = 0;

        // Query agent memories if agentId is provided
        // Fix #5: Wrap queries in try-catch, continue with partial results on failure
        if (options.agentId) {
            // Query primary strata first
            try {
                const primaryQuery: MemoryQuery = { ...query, strata: primaryStrata };
                const primaryResult = await this.stratumManager.queryMemories('agent', options.agentId, primaryQuery);
                primaryResultCount = primaryResult.memories.length;
                allMemories = [...primaryResult.memories];
            } catch (error) {
                this.logger.error(
                    `[PhaseStrataRouter] Failed to query agent primary strata: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
                // Continue with partial results
            }

            // Query secondary strata if needed
            if (secondaryStrata.length > 0 && allMemories.length < (options.maxResults ?? 10)) {
                try {
                    const secondaryQuery: MemoryQuery = { ...query, strata: secondaryStrata };
                    const secondaryResult = await this.stratumManager.queryMemories('agent', options.agentId, secondaryQuery);
                    secondaryResultCount = secondaryResult.memories.length;
                    allMemories = [...allMemories, ...secondaryResult.memories];
                } catch (error) {
                    this.logger.error(
                        `[PhaseStrataRouter] Failed to query agent secondary strata: ` +
                        `${error instanceof Error ? error.message : String(error)}`
                    );
                    // Continue with partial results
                }
            }
        }

        // Query channel memories if channelId is provided
        if (options.channelId) {
            // Query primary strata
            try {
                const primaryQuery: MemoryQuery = { ...query, strata: primaryStrata };
                const primaryResult = await this.stratumManager.queryMemories('channel', options.channelId, primaryQuery);
                primaryResultCount += primaryResult.memories.length;
                allMemories = [...allMemories, ...primaryResult.memories];
            } catch (error) {
                this.logger.error(
                    `[PhaseStrataRouter] Failed to query channel primary strata: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
                // Continue with partial results
            }

            // Query secondary strata if needed
            if (secondaryStrata.length > 0 && allMemories.length < (options.maxResults ?? 10)) {
                try {
                    const secondaryQuery: MemoryQuery = { ...query, strata: secondaryStrata };
                    const secondaryResult = await this.stratumManager.queryMemories('channel', options.channelId, secondaryQuery);
                    secondaryResultCount += secondaryResult.memories.length;
                    allMemories = [...allMemories, ...secondaryResult.memories];
                } catch (error) {
                    this.logger.error(
                        `[PhaseStrataRouter] Failed to query channel secondary strata: ` +
                        `${error instanceof Error ? error.message : String(error)}`
                    );
                    // Continue with partial results
                }
            }
        }

        // If MULS is enabled, apply utility scoring
        if (this.qValueManager.isEnabled() && allMemories.length > 0) {
            allMemories = this.applyUtilityScoring(allMemories, lambda);
        }

        // Limit to max results
        const maxResults = options.maxResults ?? 10;
        if (allMemories.length > maxResults) {
            allMemories = allMemories.slice(0, maxResults);
        }

        const queryTimeMs = Date.now() - startTime;

        // Emit event
        this.emitRetrievalEvent(options, allMemories, allStrata, lambda, queryTimeMs);

        const result: PhaseStrataRetrievalResult = {
            memories: allMemories,
            queriedStrata: allStrata,
            phase: options.phase,
            lambdaUsed: lambda,
            metadata: {
                primaryResultCount,
                secondaryResultCount,
                queryTimeMs
            }
        };

        this.logger.debug(
            `[PhaseStrataRouter] Retrieved ${allMemories.length} memories for phase ${options.phase} ` +
            `(primary: ${primaryResultCount}, secondary: ${secondaryResultCount}, lambda: ${lambda})`
        );

        return result;
    }

    /**
     * Apply utility scoring to sort memories by composite score
     * score = (1-λ) × sim_normalized + λ × Q_normalized
     */
    private applyUtilityScoring(memories: MemoryEntry[], lambda: number): MemoryEntry[] {
        // Get Q-values for all memories
        const memoriesWithScores = memories.map(memory => {
            const qValue = this.qValueManager.getQValue(memory.id);
            // Use access count as a proxy for base relevance (similarity)
            // In a full implementation, this would use actual similarity scores
            // Fix #9: Use named constant instead of magic number
            const baseRelevance = Math.min(
                memory.accessCount / PhaseStrataRouter.ACCESS_COUNT_NORMALIZATION_THRESHOLD,
                1
            );

            // Composite score: (1-λ) × relevance + λ × Q-value
            const compositeScore = (1 - lambda) * baseRelevance + lambda * qValue;

            return { memory, compositeScore };
        });

        // Sort by composite score descending
        memoriesWithScores.sort((a, b) => b.compositeScore - a.compositeScore);

        return memoriesWithScores.map(item => item.memory);
    }

    /**
     * Emit retrieval event for analytics
     */
    private emitRetrievalEvent(
        options: PhaseRetrievalOptions,
        memories: MemoryEntry[],
        queriedStrata: MemoryStratum[],
        lambda: number,
        queryTimeMs: number
    ): void {
        EventBus.server.emit(OrparMemoryEvents.PHASE_MEMORY_RETRIEVED, {
            agentId: options.agentId ?? 'unknown',
            channelId: options.channelId ?? 'unknown',
            phase: options.phase,
            query: options.query,
            queriedStrata,
            memoryCount: memories.length,
            memoryIds: memories.map(m => m.id),
            lambdaUsed: lambda,
            queryTimeMs
        });
    }

    /**
     * Get a summary of the phase-strata mappings for documentation/debugging
     */
    public getMappingSummary(): string {
        const config = getOrparMemoryConfig();
        const lines = ['Phase-Strata Mapping Summary:'];

        for (const mapping of config.phaseStrataMappings) {
            lines.push(
                `  ${mapping.phase.toUpperCase()}: ` +
                `primary=[${mapping.primaryStrata.join(', ')}], ` +
                `secondary=[${mapping.secondaryStrata.join(', ')}], ` +
                `lambda=${mapping.lambda}`
            );
        }

        return lines.join('\n');
    }

    /**
     * Reset the router (useful for testing)
     */
    public reset(): void {
        this.enabled = false;
    }
}
