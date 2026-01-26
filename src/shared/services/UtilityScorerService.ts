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
 * UtilityScorerService
 *
 * Two-phase retrieval scoring service for the Memory Utility Learning System (MULS).
 * Combines similarity scores with Q-values using a configurable lambda parameter.
 *
 * Key Formula: score = (1-λ) × sim_normalized + λ × Q_normalized
 *
 * Phase-Specific Lambda Rationale:
 * - OBSERVATION (0.2): Prioritize semantic accuracy for gathering context
 * - REASONING (0.5): Balance explore/exploit for analysis
 * - PLANNING (0.7): Exploit proven patterns for strategy
 * - ACTION (0.3): Stay grounded for tool execution
 * - REFLECTION (0.6): Favor memories that led to good assessments
 *
 * Feature flag: MEMORY_UTILITY_LEARNING_ENABLED
 */

import { Logger } from '../utils/Logger';
import { QValueManager } from './QValueManager';
import {
    MemoryCandidate,
    ScoredMemory,
    ScoringOptions,
    ScoringResult,
    OrparPhase,
    NormalizationMethod,
    DEFAULT_PHASE_LAMBDAS,
    PhaseLambdaConfig,
    MemoryUtilityConfig,
    DEFAULT_MEMORY_UTILITY_CONFIG,
    getMulsConfigFromEnv
} from '../types/MemoryUtilityTypes';

/**
 * Internal normalized candidate for scoring
 */
interface NormalizedCandidate {
    memoryId: string;
    rawSimilarity: number;
    rawQValue: number;
    normalizedSimilarity: number;
    normalizedQValue: number;
    content?: any;
    metadata?: Record<string, any>;
}

/**
 * UtilityScorerService - Singleton service for composite memory scoring
 */
export class UtilityScorerService {
    private static instance: UtilityScorerService;
    private logger: Logger;
    private qValueManager: QValueManager;
    private config: MemoryUtilityConfig;
    private enabled: boolean = false;

    // Lambda overrides for different scopes
    private globalLambda: number;
    private phaseLambdas: PhaseLambdaConfig;

    private constructor() {
        this.logger = new Logger('info', 'UtilityScorerService');
        this.qValueManager = QValueManager.getInstance();
        this.config = {
            ...DEFAULT_MEMORY_UTILITY_CONFIG,
            ...getMulsConfigFromEnv()
        };
        this.globalLambda = this.config.lambda;
        this.phaseLambdas = { ...DEFAULT_PHASE_LAMBDAS, ...this.config.phaseLambdas };
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): UtilityScorerService {
        if (!UtilityScorerService.instance) {
            UtilityScorerService.instance = new UtilityScorerService();
        }
        return UtilityScorerService.instance;
    }

    /**
     * Initialize the UtilityScorerService with configuration
     */
    public initialize(config?: Partial<MemoryUtilityConfig>): void {
        if (config) {
            this.config = { ...this.config, ...config };
            this.globalLambda = this.config.lambda;
            if (config.phaseLambdas) {
                this.phaseLambdas = { ...this.phaseLambdas, ...config.phaseLambdas };
            }
        }
        this.enabled = this.config.enabled;

        if (this.enabled) {
            this.logger.info('[UtilityScorerService] Initialized with MULS enabled');
            this.logger.info(`[UtilityScorerService] Global lambda=${this.globalLambda}`);
            this.logger.info(`[UtilityScorerService] Phase lambdas: ${JSON.stringify(this.phaseLambdas)}`);
        } else {
            this.logger.info('[UtilityScorerService] MULS is disabled - pure similarity scoring');
        }
    }

    /**
     * Check if MULS is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Score memories using composite formula
     *
     * @param query The search query (for logging/tracking)
     * @param candidates Memory candidates with similarity and Q-value scores
     * @param options Scoring options
     * @returns Scored memories sorted by final score descending
     */
    public scoreMemories(
        query: string,
        candidates: MemoryCandidate[],
        options?: ScoringOptions
    ): ScoringResult {
        const startTime = Date.now();

        // If MULS is disabled, return pure similarity ranking
        if (!this.enabled) {
            return this.pureSimilarityScoring(candidates, startTime);
        }

        const opts = this.mergeOptions(options);
        const lambda = opts.lambda ?? this.globalLambda;

        // Step 1: Normalize similarity scores (min-max within candidate pool)
        const normalizedCandidates = this.normalizeCandidates(candidates, opts.normalizationMethod ?? 'z-score');

        // Step 2: Apply composite scoring formula
        const scoredMemories = normalizedCandidates.map(candidate => {
            const finalScore = (1 - lambda) * candidate.normalizedSimilarity + lambda * candidate.normalizedQValue;

            const scored: ScoredMemory = {
                memoryId: candidate.memoryId,
                finalScore,
                content: candidate.content,
                metadata: candidate.metadata
            };

            if (opts.includeBreakdown) {
                scored.breakdown = {
                    normalizedSimilarity: candidate.normalizedSimilarity,
                    normalizedQValue: candidate.normalizedQValue,
                    lambda,
                    rawSimilarity: candidate.rawSimilarity,
                    rawQValue: candidate.rawQValue
                };
            }

            return scored;
        });

        // Step 3: Sort by final score descending
        scoredMemories.sort((a, b) => b.finalScore - a.finalScore);

        // Step 4: Limit results
        const maxResults = opts.maxResults ?? this.config.maxResults;
        const limitedMemories = scoredMemories.slice(0, maxResults);

        const scoringTimeMs = Date.now() - startTime;

        this.logger.debug(`[UtilityScorerService] Scored ${candidates.length} candidates in ${scoringTimeMs}ms (lambda=${lambda})`);

        return {
            memories: limitedMemories,
            stats: {
                candidatesConsidered: candidates.length,
                resultsReturned: limitedMemories.length,
                lambdaUsed: lambda,
                scoringTimeMs
            }
        };
    }

    /**
     * Score memories for a specific ORPAR phase
     *
     * @param query The search query
     * @param candidates Memory candidates
     * @param phase The ORPAR phase for phase-specific lambda
     * @returns Scored memories
     */
    public scoreForPhase(
        query: string,
        candidates: MemoryCandidate[],
        phase: OrparPhase
    ): ScoringResult {
        const phaseLambda = this.getLambdaForPhase(phase);

        this.logger.debug(`[UtilityScorerService] Scoring for phase '${phase}' with lambda=${phaseLambda}`);

        return this.scoreMemories(query, candidates, { lambda: phaseLambda });
    }

    /**
     * Get the lambda value for a specific ORPAR phase
     */
    public getLambdaForPhase(phase: OrparPhase): number {
        return this.phaseLambdas[phase] ?? this.globalLambda;
    }

    /**
     * Set the global lambda value
     */
    public setLambda(lambda: number, scope?: 'global' | OrparPhase): void {
        if (lambda < 0 || lambda > 1) {
            throw new Error(`Lambda must be between 0 and 1, got ${lambda}`);
        }

        if (!scope || scope === 'global') {
            this.globalLambda = lambda;
            this.logger.info(`[UtilityScorerService] Global lambda set to ${lambda}`);
        } else {
            this.phaseLambdas[scope] = lambda;
            this.logger.info(`[UtilityScorerService] Lambda for phase '${scope}' set to ${lambda}`);
        }
    }

    /**
     * Get the current lambda value
     */
    public getLambda(scope?: 'global' | OrparPhase): number {
        if (!scope || scope === 'global') {
            return this.globalLambda;
        }
        return this.phaseLambdas[scope] ?? this.globalLambda;
    }

    /**
     * Get all phase lambdas
     */
    public getPhaseLambdas(): PhaseLambdaConfig {
        return { ...this.phaseLambdas };
    }

    /**
     * Reset lambdas to default values
     */
    public resetLambdas(): void {
        this.globalLambda = DEFAULT_MEMORY_UTILITY_CONFIG.lambda;
        this.phaseLambdas = { ...DEFAULT_PHASE_LAMBDAS };
        this.logger.info('[UtilityScorerService] Reset lambdas to default values');
    }

    /**
     * Pure similarity scoring (when MULS is disabled)
     */
    private pureSimilarityScoring(candidates: MemoryCandidate[], startTime: number): ScoringResult {
        const scoredMemories: ScoredMemory[] = candidates.map(c => ({
            memoryId: c.memoryId,
            finalScore: c.similarity,
            content: c.content,
            metadata: c.metadata
        }));

        scoredMemories.sort((a, b) => b.finalScore - a.finalScore);
        const limited = scoredMemories.slice(0, this.config.maxResults);

        return {
            memories: limited,
            stats: {
                candidatesConsidered: candidates.length,
                resultsReturned: limited.length,
                lambdaUsed: 0,
                scoringTimeMs: Date.now() - startTime
            }
        };
    }

    /**
     * Normalize candidates for scoring
     */
    private normalizeCandidates(
        candidates: MemoryCandidate[],
        method: NormalizationMethod
    ): NormalizedCandidate[] {
        if (candidates.length === 0) {
            return [];
        }

        // Extract raw values
        const similarities = candidates.map(c => c.similarity);
        const qValues = candidates.map(c => c.qValue);

        // Normalize
        const normalizedSims = this.normalizeArray(similarities, method);
        const normalizedQs = this.normalizeArray(qValues, method);

        // Build normalized candidates
        return candidates.map((candidate, i) => ({
            memoryId: candidate.memoryId,
            rawSimilarity: candidate.similarity,
            rawQValue: candidate.qValue,
            normalizedSimilarity: normalizedSims[i],
            normalizedQValue: normalizedQs[i],
            content: candidate.content,
            metadata: candidate.metadata
        }));
    }

    /**
     * Normalize an array of values using the specified method
     */
    private normalizeArray(values: number[], method: NormalizationMethod): number[] {
        if (values.length === 0) {
            return [];
        }

        switch (method) {
            case 'z-score':
                return this.zScoreNormalize(values);
            case 'min-max':
                return this.minMaxNormalize(values);
            case 'softmax':
                return this.softmaxNormalize(values);
            default:
                return this.zScoreNormalize(values);
        }
    }

    /**
     * Z-score normalization: (x - mean) / stddev
     */
    private zScoreNormalize(values: number[]): number[] {
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        // Handle edge case: all identical values
        if (stdDev === 0) {
            return values.map(() => 0);
        }

        return values.map(v => (v - mean) / stdDev);
    }

    /**
     * Min-max normalization: (x - min) / (max - min)
     */
    private minMaxNormalize(values: number[]): number[] {
        const min = Math.min(...values);
        const max = Math.max(...values);

        // Handle edge case: all identical values
        if (max === min) {
            return values.map(() => 0.5);
        }

        return values.map(v => (v - min) / (max - min));
    }

    /**
     * Softmax normalization: exp(x) / sum(exp(x))
     */
    private softmaxNormalize(values: number[]): number[] {
        const maxVal = Math.max(...values);
        const expValues = values.map(v => Math.exp(v - maxVal));
        const sumExp = expValues.reduce((sum, v) => sum + v, 0);

        return expValues.map(v => v / sumExp);
    }

    /**
     * Merge options with defaults
     */
    private mergeOptions(options?: ScoringOptions): ScoringOptions {
        return {
            lambda: options?.lambda ?? this.globalLambda,
            maxCandidates: options?.maxCandidates ?? this.config.maxCandidates,
            maxResults: options?.maxResults ?? this.config.maxResults,
            normalizationMethod: options?.normalizationMethod ?? this.config.normalizationMethod,
            similarityThreshold: options?.similarityThreshold ?? this.config.similarityThreshold,
            includeBreakdown: options?.includeBreakdown ?? false
        };
    }

    /**
     * Get current configuration
     */
    public getConfig(): MemoryUtilityConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    public updateConfig(updates: Partial<MemoryUtilityConfig>): void {
        this.config = { ...this.config, ...updates };
        this.enabled = this.config.enabled;
        if (updates.lambda !== undefined) {
            this.globalLambda = updates.lambda;
        }
        if (updates.phaseLambdas) {
            this.phaseLambdas = { ...this.phaseLambdas, ...updates.phaseLambdas };
        }
        this.logger.info('[UtilityScorerService] Configuration updated');
    }
}
