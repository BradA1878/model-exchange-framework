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
 * ORPAR-Memory Integration Types
 *
 * Type definitions for the unified cognitive-memory architecture that tightly couples
 * ORPAR phases with memory operations. This integration enables:
 * - Phase-specific memory strata routing
 * - Surprise-driven ORPAR control decisions
 * - Phase-weighted reward attribution
 * - ORPAR cycle-triggered memory consolidation
 *
 * Feature flag: ORPAR_MEMORY_INTEGRATION_ENABLED
 */

import { MemoryStratum, MemoryEntry, SurpriseDetection } from './MemoryStrataTypes';
import { OrparPhase, MemoryUsageRecord, QValueUpdate } from './MemoryUtilityTypes';
import { AgentId, ChannelId } from './ChannelContext';

// ============================================================================
// Phase-Strata Routing Types
// ============================================================================

/**
 * Mapping of an ORPAR phase to its preferred memory strata
 */
export interface PhaseStrataMapping {
    /** ORPAR phase */
    phase: OrparPhase;
    /** Primary strata to query (higher priority) */
    primaryStrata: MemoryStratum[];
    /** Secondary strata to query (lower priority, used as fallback) */
    secondaryStrata: MemoryStratum[];
    /** Lambda value for utility weighting in this phase */
    lambda: number;
    /** Rationale for this mapping */
    rationale: string;
}

/**
 * Default phase-strata mappings following the cognitive architecture
 */
export const DEFAULT_PHASE_STRATA_MAPPINGS: PhaseStrataMapping[] = [
    {
        phase: 'observation',
        primaryStrata: [MemoryStratum.Working, MemoryStratum.ShortTerm],
        secondaryStrata: [MemoryStratum.Episodic],
        lambda: 0.2,
        rationale: 'Recent context for gathering - prioritize semantic accuracy'
    },
    {
        phase: 'reasoning',
        primaryStrata: [MemoryStratum.Episodic, MemoryStratum.Semantic],
        secondaryStrata: [MemoryStratum.LongTerm],
        lambda: 0.5,
        rationale: 'Patterns for analysis - balance explore/exploit'
    },
    {
        phase: 'planning',
        primaryStrata: [MemoryStratum.Semantic, MemoryStratum.LongTerm],
        secondaryStrata: [MemoryStratum.Episodic],
        lambda: 0.7,
        rationale: 'Proven strategies - exploit historical success'
    },
    {
        phase: 'action',
        primaryStrata: [MemoryStratum.Working, MemoryStratum.ShortTerm],
        secondaryStrata: [],
        lambda: 0.3,
        rationale: 'Stay grounded for tool execution'
    },
    {
        phase: 'reflection',
        primaryStrata: [
            MemoryStratum.Working,
            MemoryStratum.ShortTerm,
            MemoryStratum.Episodic,
            MemoryStratum.LongTerm,
            MemoryStratum.Semantic
        ],
        secondaryStrata: [],
        lambda: 0.6,
        rationale: 'Holistic review across all strata'
    }
];

/**
 * Result of phase-aware memory retrieval
 */
export interface PhaseStrataRetrievalResult {
    /** Retrieved memories */
    memories: MemoryEntry[];
    /** Which strata were queried */
    queriedStrata: MemoryStratum[];
    /** The phase that drove the retrieval */
    phase: OrparPhase;
    /** Lambda value used */
    lambdaUsed: number;
    /** Retrieval metadata */
    metadata: {
        /** Primary strata results count */
        primaryResultCount: number;
        /** Secondary strata results count */
        secondaryResultCount: number;
        /** Total query time in ms */
        queryTimeMs: number;
    };
}

// ============================================================================
// Surprise-ORPAR Adapter Types
// ============================================================================

/**
 * Decision made by the SurpriseOrparAdapter based on surprise signals
 */
export interface SurpriseOrparDecision {
    /** Type of decision */
    type: SurpriseDecisionType;
    /** Number of additional observation cycles to trigger (for RE_OBSERVE) */
    additionalObservations?: number;
    /** Surprise context to inject into reasoning (for INJECT_CONTEXT) */
    surpriseContext?: SurpriseContext;
    /** Whether the current plan should be reconsidered (for RECONSIDER_PLAN) */
    planReconsideration?: PlanReconsiderationInfo;
    /** Whether to extend reasoning phase (for EXTEND_REASONING) */
    extendReasoning?: boolean;
    /** Original surprise detection that triggered this decision */
    surpriseDetection: SurpriseDetection;
    /** Confidence in this decision (0-1) */
    confidence: number;
}

/**
 * Types of decisions the SurpriseOrparAdapter can make
 */
export type SurpriseDecisionType =
    | 'NO_ACTION'           // Surprise is too low to act on
    | 'RE_OBSERVE'          // High surprise - trigger additional observation cycles
    | 'INJECT_CONTEXT'      // Moderate surprise - inject context into reasoning
    | 'RECONSIDER_PLAN'     // Plan surprise - flag plan for reconsideration
    | 'EXTEND_REASONING';   // Momentum accumulation - extend reasoning phase

/**
 * Context information about surprise to inject into reasoning
 */
export interface SurpriseContext {
    /** The surprising observation */
    observation: string;
    /** Why it was surprising */
    explanation: string;
    /** The expectation that was violated */
    violatedExpectation?: string;
    /** Suggested areas to focus reasoning on */
    focusAreas: string[];
    /** Surprise score for weighting */
    surpriseScore: number;
}

/**
 * Information about why a plan should be reconsidered
 */
export interface PlanReconsiderationInfo {
    /** Reason for reconsideration */
    reason: string;
    /** Specific aspects of the plan to review */
    aspectsToReview: string[];
    /** Alternative approaches to consider */
    alternativesToConsider: string[];
    /** Severity of the reconsideration need */
    severity: 'low' | 'medium' | 'high';
}

/**
 * Configuration for surprise thresholds
 */
export interface SurpriseThresholds {
    /** Threshold for high surprise (triggers RE_OBSERVE) */
    high: number;
    /** Threshold for moderate surprise (triggers INJECT_CONTEXT) */
    moderate: number;
    /** Threshold for plan-level surprise (triggers RECONSIDER_PLAN) */
    plan: number;
    /** Maximum additional observation cycles for high surprise */
    maxExtraObservations: number;
}

/**
 * Default surprise thresholds
 */
export const DEFAULT_SURPRISE_THRESHOLDS: SurpriseThresholds = {
    high: 0.7,
    moderate: 0.4,
    plan: 0.6,
    maxExtraObservations: 3
};

// ============================================================================
// Phase-Weighted Reward Types
// ============================================================================

/**
 * Weights for each ORPAR phase in reward attribution
 */
export interface PhaseWeightConfig {
    /** Weight for observation phase contributions */
    observation: number;
    /** Weight for reasoning phase contributions */
    reasoning: number;
    /** Weight for planning phase contributions */
    planning: number;
    /** Weight for action phase contributions */
    action: number;
    /** Weight for reflection phase contributions */
    reflection: number;
}

/**
 * Default phase weights for reward attribution
 *
 * Rationale:
 * - OBSERVATION (0.15): Context gathering has indirect impact
 * - REASONING (0.20): Analysis quality affects decisions
 * - PLANNING (0.30): Strategic decisions are critical
 * - ACTION (0.25): Execution directly affects outcome
 * - REFLECTION (0.10): Meta-cognition improves future cycles
 */
export const DEFAULT_PHASE_WEIGHTS: PhaseWeightConfig = {
    observation: 0.15,
    reasoning: 0.20,
    planning: 0.30,
    action: 0.25,
    reflection: 0.10
};

/**
 * Record of memory usage during an ORPAR cycle
 */
export interface CycleMemoryUsage {
    /** Unique cycle identifier */
    cycleId: string;
    /** Agent executing the cycle */
    agentId: AgentId;
    /** Channel where cycle occurred */
    channelId: ChannelId;
    /** Task ID if associated with a task */
    taskId?: string;
    /** Memory usage records per phase */
    phaseUsage: {
        observation: MemoryUsageRecord[];
        reasoning: MemoryUsageRecord[];
        planning: MemoryUsageRecord[];
        action: MemoryUsageRecord[];
        reflection: MemoryUsageRecord[];
    };
    /** Cycle start timestamp */
    startedAt: Date;
    /** Cycle end timestamp */
    completedAt?: Date;
    /** Cycle outcome status */
    outcome?: CycleOutcome;
}

/**
 * Fix #7: Typed metadata interface for CycleOutcome
 * Provides type safety for common metadata fields while still allowing extension
 */
export interface CycleOutcomeMetadata {
    /** Source that generated this outcome */
    source?: 'controlLoop' | 'orparTools' | string;
    /** Learnings extracted from reflection */
    learnings?: string[];
    /** Adjustments suggested for future cycles */
    adjustments?: string[];
    /** Feedback from the reflection phase */
    feedback?: string;
    /** Task-specific metadata */
    taskMetadata?: Record<string, unknown>;
    /** Allow additional unknown fields for extensibility */
    [key: string]: unknown;
}

/**
 * Outcome of an ORPAR cycle
 */
export interface CycleOutcome {
    /** Whether the cycle was successful */
    success: boolean;
    /** Quality score (0-1) if available */
    qualityScore?: number;
    /** Number of errors encountered */
    errorCount: number;
    /** Number of tool calls made */
    toolCallCount: number;
    /** Whether task was completed */
    taskCompleted: boolean;
    /** Additional outcome metadata - Fix #7: Now uses typed interface */
    metadata?: CycleOutcomeMetadata;
}

/**
 * Phase-weighted reward calculation result
 */
export interface PhaseWeightedRewardResult {
    /** Memory ID */
    memoryId: string;
    /** Calculated reward value */
    reward: number;
    /** Breakdown of contribution by phase */
    phaseContributions: Partial<Record<OrparPhase, number>>;
    /** Base reward before phase weighting */
    baseReward: number;
    /** Sum of phase weights where memory was used */
    totalPhaseWeight: number;
    /** Q-value update to apply */
    qValueUpdate: QValueUpdate;
}

// ============================================================================
// Cycle Consolidation Types
// ============================================================================

/**
 * Rule for triggering memory consolidation based on cycle outcomes
 */
export interface ConsolidationRule {
    /** Rule identifier */
    id: string;
    /** Rule name */
    name: string;
    /** Condition function that returns true if rule should trigger */
    condition: ConsolidationCondition;
    /** Action to take when rule triggers */
    action: ConsolidationAction;
    /** Priority (higher = checked first) */
    priority: number;
}

/**
 * Condition that can trigger consolidation
 */
export interface ConsolidationCondition {
    /** Minimum Q-value threshold (optional) */
    minQValue?: number;
    /** Maximum Q-value threshold (optional) */
    maxQValue?: number;
    /** Minimum success count (optional) */
    minSuccessCount?: number;
    /** Minimum failure count (optional) */
    minFailureCount?: number;
    /** Days since last access (optional) */
    daysSinceAccess?: number;
    /** Current stratum must be one of these (optional) */
    currentStrata?: MemoryStratum[];
}

/**
 * Action to take during consolidation
 */
export type ConsolidationAction =
    | { type: 'PROMOTE'; targetStratum: MemoryStratum }
    | { type: 'DEMOTE'; targetStratum: MemoryStratum }
    | { type: 'ARCHIVE' }
    | { type: 'ABSTRACT'; targetStratum: MemoryStratum };

/**
 * Default consolidation rules following the plan
 */
export const DEFAULT_CONSOLIDATION_RULES: ConsolidationRule[] = [
    {
        id: 'promote-high-performers',
        name: 'Promote High Performers',
        condition: {
            minQValue: 0.7,
            minSuccessCount: 3,
            currentStrata: [MemoryStratum.Working, MemoryStratum.ShortTerm]
        },
        action: { type: 'PROMOTE', targetStratum: MemoryStratum.LongTerm },
        priority: 100
    },
    {
        id: 'demote-low-performers',
        name: 'Demote Low Performers',
        condition: {
            maxQValue: 0.3,
            minFailureCount: 5,
            currentStrata: [MemoryStratum.ShortTerm, MemoryStratum.LongTerm]
        },
        action: { type: 'ARCHIVE' },
        priority: 90
    },
    {
        id: 'abstract-proven-patterns',
        name: 'Abstract Proven Patterns',
        condition: {
            minQValue: 0.7,
            minSuccessCount: 10,
            currentStrata: [MemoryStratum.LongTerm]
        },
        action: { type: 'ABSTRACT', targetStratum: MemoryStratum.Semantic },
        priority: 80
    },
    {
        id: 'archive-stale',
        name: 'Archive Stale Memories',
        condition: {
            maxQValue: 0.5,
            daysSinceAccess: 30
        },
        action: { type: 'ARCHIVE' },
        priority: 70
    }
];

/**
 * Result of consolidation rule evaluation
 */
export interface ConsolidationTriggerResult {
    /** Memory ID that triggered */
    memoryId: string;
    /** Rule that triggered */
    rule: ConsolidationRule;
    /** Action to execute */
    action: ConsolidationAction;
    /** Memory's current state */
    memoryState: {
        currentStratum: MemoryStratum;
        qValue: number;
        successCount: number;
        failureCount: number;
        daysSinceAccess: number;
    };
    /** Timestamp of trigger */
    triggeredAt: Date;
}

// ============================================================================
// Phase Memory Operations Types
// ============================================================================

/**
 * Specification for phase-specific memory storage
 */
export interface PhaseStorageSpec {
    /** Phase this spec applies to */
    phase: OrparPhase;
    /** Target stratum for storage */
    targetStratum: MemoryStratum;
    /** Default importance level */
    defaultImportance: 'critical' | 'high' | 'medium' | 'low' | 'trivial';
    /** Content type */
    contentType: 'observation' | 'analysis' | 'plan' | 'action_result' | 'learning';
    /** Auto-tagging rules */
    autoTags: string[];
}

/**
 * Default phase storage specifications
 */
export const DEFAULT_PHASE_STORAGE_SPECS: PhaseStorageSpec[] = [
    {
        phase: 'observation',
        targetStratum: MemoryStratum.Working,
        defaultImportance: 'medium',
        contentType: 'observation',
        autoTags: ['observation', 'context']
    },
    {
        phase: 'reasoning',
        targetStratum: MemoryStratum.Episodic,
        defaultImportance: 'high',
        contentType: 'analysis',
        autoTags: ['reasoning', 'analysis']
    },
    {
        phase: 'planning',
        targetStratum: MemoryStratum.ShortTerm,
        defaultImportance: 'high',
        contentType: 'plan',
        autoTags: ['planning', 'strategy']
    },
    {
        phase: 'action',
        targetStratum: MemoryStratum.Working,
        defaultImportance: 'medium',
        contentType: 'action_result',
        autoTags: ['action', 'tool_result']
    },
    {
        phase: 'reflection',
        targetStratum: MemoryStratum.LongTerm,
        defaultImportance: 'high',
        contentType: 'learning',
        autoTags: ['reflection', 'learning', 'insight']
    }
];

/**
 * Options for phase-aware memory retrieval
 */
export interface PhaseRetrievalOptions {
    /** Query text for semantic search */
    query: string;
    /** ORPAR phase driving the retrieval */
    phase: OrparPhase;
    /** Agent ID for scoping */
    agentId: AgentId;
    /** Channel ID for scoping */
    channelId?: ChannelId;
    /** Maximum results to return */
    maxResults?: number;
    /** Override default lambda */
    lambda?: number;
    /** Include secondary strata in search */
    includeSecondary?: boolean;
    /** Additional tags to filter by */
    tags?: string[];
    /** Time range filter */
    timeRange?: {
        start?: Date;
        end?: Date;
    };
}

/**
 * Options for phase-aware memory storage
 */
export interface PhaseStorageOptions {
    /** Content to store */
    content: string;
    /** ORPAR phase during storage */
    phase: OrparPhase;
    /** Agent ID for attribution */
    agentId: AgentId;
    /** Channel ID for scoping */
    channelId?: ChannelId;
    /** Task ID if associated */
    taskId?: string;
    /** Override target stratum */
    targetStratum?: MemoryStratum;
    /** Override importance level */
    importance?: 'critical' | 'high' | 'medium' | 'low' | 'trivial';
    /** Additional tags */
    tags?: string[];
    /** Related memory IDs */
    relatedMemories?: string[];
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

// ============================================================================
// Coordinator Types
// ============================================================================

/**
 * Complete ORPAR-Memory integration configuration
 */
export interface OrparMemoryIntegrationConfig {
    /** Whether the integration is enabled */
    enabled: boolean;
    /** Phase-strata mappings */
    phaseStrataMappings: PhaseStrataMapping[];
    /** Surprise thresholds */
    surpriseThresholds: SurpriseThresholds;
    /** Phase weights for reward attribution */
    phaseWeights: PhaseWeightConfig;
    /** Consolidation rules */
    consolidationRules: ConsolidationRule[];
    /** Phase storage specifications */
    phaseStorageSpecs: PhaseStorageSpec[];
    /** Debug mode - extra logging */
    debug: boolean;
}

/**
 * Default ORPAR-Memory integration configuration
 */
export const DEFAULT_ORPAR_MEMORY_CONFIG: OrparMemoryIntegrationConfig = {
    enabled: false,
    phaseStrataMappings: DEFAULT_PHASE_STRATA_MAPPINGS,
    surpriseThresholds: DEFAULT_SURPRISE_THRESHOLDS,
    phaseWeights: DEFAULT_PHASE_WEIGHTS,
    consolidationRules: DEFAULT_CONSOLIDATION_RULES,
    phaseStorageSpecs: DEFAULT_PHASE_STORAGE_SPECS,
    debug: false
};

/**
 * Environment variable names for ORPAR-Memory configuration
 */
export const ORPAR_MEMORY_ENV_VARS = {
    ENABLED: 'ORPAR_MEMORY_INTEGRATION_ENABLED',

    // Phase-Strata weights (comma-separated strata names)
    PHASE_STRATA_OBSERVATION_PRIMARY: 'PHASE_STRATA_OBSERVATION_PRIMARY',
    PHASE_STRATA_REASONING_PRIMARY: 'PHASE_STRATA_REASONING_PRIMARY',
    PHASE_STRATA_PLANNING_PRIMARY: 'PHASE_STRATA_PLANNING_PRIMARY',

    // Surprise thresholds
    SURPRISE_HIGH_THRESHOLD: 'SURPRISE_HIGH_THRESHOLD',
    SURPRISE_MODERATE_THRESHOLD: 'SURPRISE_MODERATE_THRESHOLD',
    SURPRISE_MAX_EXTRA_OBSERVATIONS: 'SURPRISE_MAX_EXTRA_OBSERVATIONS',

    // Phase weights
    PHASE_WEIGHT_OBSERVATION: 'PHASE_WEIGHT_OBSERVATION',
    PHASE_WEIGHT_REASONING: 'PHASE_WEIGHT_REASONING',
    PHASE_WEIGHT_PLANNING: 'PHASE_WEIGHT_PLANNING',
    PHASE_WEIGHT_ACTION: 'PHASE_WEIGHT_ACTION',
    PHASE_WEIGHT_REFLECTION: 'PHASE_WEIGHT_REFLECTION',

    // Consolidation rules
    CONSOLIDATION_PROMOTION_QVALUE: 'CONSOLIDATION_PROMOTION_QVALUE',
    CONSOLIDATION_DEMOTION_QVALUE: 'CONSOLIDATION_DEMOTION_QVALUE',

    // Debug
    DEBUG: 'ORPAR_MEMORY_DEBUG'
} as const;

/**
 * Get ORPAR-Memory config from environment variables
 */
export function getOrparMemoryConfigFromEnv(): Partial<OrparMemoryIntegrationConfig> {
    const getNum = (key: string, defaultVal: number): number => {
        const val = process.env[key];
        return val ? parseFloat(val) : defaultVal;
    };

    const getBool = (key: string, defaultVal: boolean): boolean => {
        const val = process.env[key];
        return val ? val.toLowerCase() === 'true' : defaultVal;
    };

    return {
        enabled: getBool(ORPAR_MEMORY_ENV_VARS.ENABLED, false),
        surpriseThresholds: {
            high: getNum(ORPAR_MEMORY_ENV_VARS.SURPRISE_HIGH_THRESHOLD, 0.7),
            moderate: getNum(ORPAR_MEMORY_ENV_VARS.SURPRISE_MODERATE_THRESHOLD, 0.4),
            plan: 0.6,
            maxExtraObservations: getNum(ORPAR_MEMORY_ENV_VARS.SURPRISE_MAX_EXTRA_OBSERVATIONS, 3)
        },
        phaseWeights: {
            observation: getNum(ORPAR_MEMORY_ENV_VARS.PHASE_WEIGHT_OBSERVATION, 0.15),
            reasoning: getNum(ORPAR_MEMORY_ENV_VARS.PHASE_WEIGHT_REASONING, 0.20),
            planning: getNum(ORPAR_MEMORY_ENV_VARS.PHASE_WEIGHT_PLANNING, 0.30),
            action: getNum(ORPAR_MEMORY_ENV_VARS.PHASE_WEIGHT_ACTION, 0.25),
            reflection: getNum(ORPAR_MEMORY_ENV_VARS.PHASE_WEIGHT_REFLECTION, 0.10)
        },
        debug: getBool(ORPAR_MEMORY_ENV_VARS.DEBUG, false)
    };
}

// ============================================================================
// Coordinator Event Types
// ============================================================================

/**
 * ORPAR cycle state tracked by the coordinator
 */
export interface OrparCycleState {
    /** Unique cycle identifier */
    cycleId: string;
    /** Agent executing the cycle */
    agentId: AgentId;
    /** Channel where cycle is occurring */
    channelId: ChannelId;
    /** Current ORPAR phase */
    currentPhase: OrparPhase;
    /** Phase start times */
    phaseStartTimes: Partial<Record<OrparPhase, Date>>;
    /** Memory usage during cycle */
    memoryUsage: CycleMemoryUsage;
    /** Surprise detections during cycle */
    surpriseDetections: SurpriseDetection[];
    /** Additional observations queued */
    additionalObservationsQueued: number;
    /** Whether cycle is complete */
    isComplete: boolean;
    /** Cycle start timestamp */
    startedAt: Date;
}
