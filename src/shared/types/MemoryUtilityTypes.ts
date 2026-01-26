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
 * Memory Utility Learning System (MULS) Types
 *
 * Type definitions for the utility-based memory retrieval system inspired by MemRL.
 * The core innovation: treat memory retrieval as a decision problem rather than
 * similarity search - Q-values track which memories actually lead to successful task outcomes.
 *
 * Key Formula: score = (1-λ) × sim_normalized + λ × Q_normalized
 */

import { AgentId, ChannelId } from './ChannelContext';

// ============================================================================
// ORPAR Phase Types
// ============================================================================

/**
 * ORPAR cognitive phases used for phase-specific lambda values
 */
export type OrparPhase = 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection';

// ============================================================================
// Q-Value Types
// ============================================================================

/**
 * Q-Value update request
 */
export interface QValueUpdate {
    /** The memory ID to update */
    memoryId: string;
    /** The reward signal to incorporate */
    reward: number;
    /** Optional learning rate override */
    learningRate?: number;
    /** Optional context for the update */
    context?: {
        taskId?: string;
        agentId?: AgentId;
        channelId?: ChannelId;
        phase?: OrparPhase;
        timestamp?: number;
    };
}

/**
 * History entry for Q-value changes over time
 */
export interface QValueHistoryEntry {
    /** Q-value after update */
    value: number;
    /** Reward signal that triggered this update */
    reward: number;
    /** Timestamp of the update */
    timestamp: Date;
    /** Task ID associated with the update */
    taskId?: string;
    /** Phase during which the update occurred */
    phase?: OrparPhase;
}

/**
 * Methods for normalizing Q-values across a candidate pool
 */
export type NormalizationMethod = 'z-score' | 'min-max' | 'softmax';

/**
 * Statistics about Q-value distribution for a memory or agent
 */
export interface QValueStatistics {
    /** Mean Q-value */
    mean: number;
    /** Standard deviation of Q-values */
    stdDev: number;
    /** Minimum Q-value */
    min: number;
    /** Maximum Q-value */
    max: number;
    /** Number of Q-values in the distribution */
    count: number;
    /** Percentile distribution */
    percentiles?: {
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        p99: number;
    };
}

// ============================================================================
// Scoring Types
// ============================================================================

/**
 * A memory candidate with both similarity and Q-value scores
 */
export interface MemoryCandidate {
    /** The memory ID */
    memoryId: string;
    /** Similarity score from semantic search (0-1) */
    similarity: number;
    /** Current Q-value (default 0.5) */
    qValue: number;
    /** The actual memory content (optional, for convenience) */
    content?: any;
    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * A scored memory after applying the composite scoring formula
 */
export interface ScoredMemory {
    /** The memory ID */
    memoryId: string;
    /** Final composite score after applying lambda weighting */
    finalScore: number;
    /** Breakdown of score components */
    breakdown?: {
        /** Normalized similarity score (0-1) */
        normalizedSimilarity: number;
        /** Normalized Q-value (z-score) */
        normalizedQValue: number;
        /** Lambda value used */
        lambda: number;
        /** Original similarity before normalization */
        rawSimilarity: number;
        /** Original Q-value before normalization */
        rawQValue: number;
    };
    /** The actual memory content (optional) */
    content?: any;
    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * Options for the scoring operation
 */
export interface ScoringOptions {
    /** Lambda value for utility weighting (0=pure similarity, 1=pure utility) */
    lambda?: number;
    /** Maximum candidates to consider in Phase A */
    maxCandidates?: number;
    /** Maximum results to return after scoring */
    maxResults?: number;
    /** Normalization method for Q-values */
    normalizationMethod?: NormalizationMethod;
    /** Minimum similarity threshold for Phase A filtering */
    similarityThreshold?: number;
    /** Include score breakdown in results */
    includeBreakdown?: boolean;
}

/**
 * Result of a scoring operation
 */
export interface ScoringResult {
    /** Scored memories sorted by final score descending */
    memories: ScoredMemory[];
    /** Statistics about the scoring operation */
    stats: {
        /** Number of candidates considered */
        candidatesConsidered: number;
        /** Number of results returned */
        resultsReturned: number;
        /** Lambda value used */
        lambdaUsed: number;
        /** Time taken for scoring (ms) */
        scoringTimeMs: number;
    };
}

// ============================================================================
// Reward Signal Types
// ============================================================================

/**
 * Task outcome status for reward calculation
 */
export type TaskOutcomeStatus = 'success' | 'failure' | 'partial' | 'timeout';

/**
 * Record of how a memory was used during a task
 */
export interface MemoryUsageRecord {
    /** The memory ID */
    memoryId: string;
    /** Phase when the memory was retrieved */
    phase: OrparPhase;
    /** Timestamp of retrieval */
    retrievedAt: Date;
    /** How the memory was used (if known) */
    usageType?: 'context' | 'reasoning' | 'action-guidance' | 'pattern-match';
    /** Any explicit feedback about the memory's usefulness */
    feedback?: {
        helpful: boolean;
        reason?: string;
    };
}

/**
 * Complete task outcome for reward attribution
 */
export interface TaskOutcome {
    /** The task ID */
    taskId: string;
    /** Agent that executed the task */
    agentId: AgentId;
    /** Channel where the task was executed */
    channelId: ChannelId;
    /** Task completion status */
    status: TaskOutcomeStatus;
    /** All memories used during the task */
    memoriesUsed: MemoryUsageRecord[];
    /** Optional task-level metrics */
    metrics?: {
        /** Time to complete (ms) */
        completionTimeMs?: number;
        /** Number of tool calls made */
        toolCallCount?: number;
        /** Number of errors encountered */
        errorCount?: number;
        /** Task quality score (0-1) if available */
        qualityScore?: number;
    };
    /** Timestamp of task completion */
    completedAt: Date;
}

/**
 * Mapping of task outcomes to reward values
 */
export interface RewardMapping {
    /** Reward for successful task completion */
    success: number;
    /** Reward (penalty) for task failure */
    failure: number;
    /** Reward for partial task completion */
    partial: number;
    /** Reward (penalty) for task timeout */
    timeout: number;
}

/**
 * Default reward mapping values
 */
export const DEFAULT_REWARD_MAPPING: RewardMapping = {
    success: 1.0,
    failure: -1.0,
    partial: 0.3,
    timeout: -0.5
};

/**
 * Step-level outcome for more granular reward attribution
 */
export interface StepOutcome {
    /** The step ID */
    stepId: string;
    /** The parent task ID */
    taskId: string;
    /** Step completion status */
    status: 'success' | 'failure' | 'skipped';
    /** Memories used specifically in this step */
    memoriesUsed: string[];
    /** Optional step quality score */
    qualityScore?: number;
    /** Timestamp */
    timestamp: Date;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Phase-specific lambda configuration
 */
export interface PhaseLambdaConfig {
    observation: number;
    reasoning: number;
    planning: number;
    action: number;
    reflection: number;
}

/**
 * Default phase-specific lambda values
 * Rationale:
 * - OBSERVATION (0.2): Prioritize semantic accuracy for gathering context
 * - REASONING (0.5): Balance explore/exploit for analysis
 * - PLANNING (0.7): Exploit proven patterns for strategy
 * - ACTION (0.3): Stay grounded for tool execution
 * - REFLECTION (0.6): Favor memories that led to good assessments
 */
export const DEFAULT_PHASE_LAMBDAS: PhaseLambdaConfig = {
    observation: 0.2,
    reasoning: 0.5,
    planning: 0.7,
    action: 0.3,
    reflection: 0.6
};

/**
 * Complete MULS configuration
 */
export interface MemoryUtilityConfig {
    /** Whether MULS is enabled */
    enabled: boolean;
    /** Default lambda value when phase not specified */
    lambda: number;
    /** Phase-specific lambda overrides */
    phaseLambdas?: Partial<PhaseLambdaConfig>;
    /** Default Q-value for new memories */
    defaultQValue: number;
    /** Learning rate for EMA updates */
    learningRate: number;
    /** Maximum candidates in Phase A */
    maxCandidates: number;
    /** Maximum results to return */
    maxResults: number;
    /** Similarity threshold for Phase A filtering */
    similarityThreshold: number;
    /** Normalization method */
    normalizationMethod: NormalizationMethod;
    /** Reward mapping configuration */
    rewardMapping: RewardMapping;
    /** Q-value history retention (number of entries per memory) */
    qValueHistoryLimit: number;
    /** Whether to track memory usage for reward attribution */
    trackMemoryUsage: boolean;
    /** Cache configuration */
    cache?: {
        enabled: boolean;
        maxSize: number;
        ttlMs: number;
    };
}

/**
 * Default MULS configuration
 */
export const DEFAULT_MEMORY_UTILITY_CONFIG: MemoryUtilityConfig = {
    enabled: false,
    lambda: 0.5,
    phaseLambdas: DEFAULT_PHASE_LAMBDAS,
    defaultQValue: 0.5,
    learningRate: 0.1,
    maxCandidates: 20,
    maxResults: 5,
    similarityThreshold: 0.3,
    normalizationMethod: 'z-score',
    rewardMapping: DEFAULT_REWARD_MAPPING,
    qValueHistoryLimit: 100,
    trackMemoryUsage: true,
    cache: {
        enabled: true,
        maxSize: 1000,
        ttlMs: 60000
    }
};

// ============================================================================
// Memory Model Extension Types
// ============================================================================

/**
 * Source of Q-value initialization
 */
export type QValueInitSource = 'default' | 'surprise' | 'transfer' | 'manual';

/**
 * Utility subdocument to add to memory schemas
 */
export interface MemoryUtilitySubdocument {
    /** Current Q-value */
    qValue: number;
    /** History of Q-value updates */
    qValueHistory: QValueHistoryEntry[];
    /** Total number of times this memory was retrieved */
    retrievalCount: number;
    /** Number of successful task completions where this memory was used */
    successCount: number;
    /** Number of failed task completions where this memory was used */
    failureCount: number;
    /** Timestamp of last reward update */
    lastRewardAt: Date;
    /** How the Q-value was initially set */
    initializedFrom: QValueInitSource;
}

/**
 * Default utility subdocument values
 */
export const DEFAULT_UTILITY_SUBDOCUMENT: MemoryUtilitySubdocument = {
    qValue: 0.5,
    qValueHistory: [],
    retrievalCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRewardAt: new Date(),
    initializedFrom: 'default'
};

// ============================================================================
// Retrieval Types
// ============================================================================

/**
 * Options for utility-aware memory retrieval
 */
export interface UtilityRetrievalOptions {
    /** Query string for semantic search */
    query: string;
    /** ORPAR phase for phase-specific lambda */
    phase?: OrparPhase;
    /** Agent ID for scoping */
    agentId?: AgentId;
    /** Channel ID for scoping */
    channelId?: ChannelId;
    /** Override default lambda */
    lambda?: number;
    /** Maximum candidates in Phase A */
    maxCandidates?: number;
    /** Maximum results to return */
    maxResults?: number;
    /** Similarity threshold */
    similarityThreshold?: number;
    /** Include score breakdown */
    includeBreakdown?: boolean;
}

/**
 * Retrieved memory with utility scoring information
 */
export interface RetrievedMemoryWithUtility {
    /** The memory ID */
    memoryId: string;
    /** Memory content */
    content: any;
    /** Final composite score */
    score: number;
    /** Score breakdown (if requested) */
    breakdown?: ScoredMemory['breakdown'];
    /** Original memory metadata */
    metadata?: Record<string, any>;
}

/**
 * Result of utility-aware retrieval
 */
export interface UtilityRetrievalResult {
    /** Retrieved memories */
    memories: RetrievedMemoryWithUtility[];
    /** Retrieval metadata */
    metadata: {
        /** Query used */
        query: string;
        /** Phase used for lambda */
        phase?: OrparPhase;
        /** Lambda value used */
        lambda: number;
        /** Total candidates before scoring */
        totalCandidates: number;
        /** Time for semantic search (ms) */
        semanticSearchTimeMs: number;
        /** Time for utility scoring (ms) */
        utilityScoringTimeMs: number;
        /** Total retrieval time (ms) */
        totalTimeMs: number;
    };
}

// ============================================================================
// Analytics Types
// ============================================================================

/**
 * Q-value analytics for an agent or globally
 */
export interface QValueAnalytics {
    /** Overall statistics */
    statistics: QValueStatistics;
    /** Top performing memories by Q-value */
    topPerformers: Array<{
        memoryId: string;
        qValue: number;
        successRate: number;
        retrievalCount: number;
    }>;
    /** Convergence metrics */
    convergence: {
        /** Whether Q-values appear to be converging */
        isConverging: boolean;
        /** Average change in Q-values over recent updates */
        averageRecentChange: number;
        /** Number of memories with stable Q-values (low variance) */
        stableMemoryCount: number;
    };
    /** Reward distribution */
    rewardDistribution: {
        successCount: number;
        failureCount: number;
        partialCount: number;
        timeoutCount: number;
    };
}

// ============================================================================
// Environment Variable Defaults
// ============================================================================

/**
 * Environment variable names for MULS configuration
 */
export const MULS_ENV_VARS = {
    ENABLED: 'MEMORY_UTILITY_LEARNING_ENABLED',
    DEFAULT_QVALUE: 'QVALUE_DEFAULT',
    LEARNING_RATE: 'QVALUE_LEARNING_RATE',
    LAMBDA_DEFAULT: 'RETRIEVAL_LAMBDA_DEFAULT',
    LAMBDA_OBSERVATION: 'RETRIEVAL_LAMBDA_OBSERVATION',
    LAMBDA_REASONING: 'RETRIEVAL_LAMBDA_REASONING',
    LAMBDA_PLANNING: 'RETRIEVAL_LAMBDA_PLANNING',
    LAMBDA_ACTION: 'RETRIEVAL_LAMBDA_ACTION',
    LAMBDA_REFLECTION: 'RETRIEVAL_LAMBDA_REFLECTION'
} as const;

/**
 * Get MULS config from environment variables
 */
export function getMulsConfigFromEnv(): Partial<MemoryUtilityConfig> {
    const getNum = (key: string, defaultVal: number): number => {
        const val = process.env[key];
        return val ? parseFloat(val) : defaultVal;
    };

    const getBool = (key: string, defaultVal: boolean): boolean => {
        const val = process.env[key];
        return val ? val.toLowerCase() === 'true' : defaultVal;
    };

    return {
        enabled: getBool(MULS_ENV_VARS.ENABLED, false),
        defaultQValue: getNum(MULS_ENV_VARS.DEFAULT_QVALUE, 0.5),
        learningRate: getNum(MULS_ENV_VARS.LEARNING_RATE, 0.1),
        lambda: getNum(MULS_ENV_VARS.LAMBDA_DEFAULT, 0.5),
        phaseLambdas: {
            observation: getNum(MULS_ENV_VARS.LAMBDA_OBSERVATION, 0.2),
            reasoning: getNum(MULS_ENV_VARS.LAMBDA_REASONING, 0.5),
            planning: getNum(MULS_ENV_VARS.LAMBDA_PLANNING, 0.7),
            action: getNum(MULS_ENV_VARS.LAMBDA_ACTION, 0.3),
            reflection: getNum(MULS_ENV_VARS.LAMBDA_REFLECTION, 0.6)
        }
    };
}
