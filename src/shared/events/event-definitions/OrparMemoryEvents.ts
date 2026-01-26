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
 * Events related to ORPAR-Memory integration operations
 *
 * These events connect the ORPAR control loop with the Nested Learning memory
 * system and MULS utility learning. They enable:
 * - Phase-aware memory retrieval/storage
 * - Surprise-driven ORPAR decisions
 * - Phase-weighted reward attribution
 * - ORPAR-triggered memory consolidation
 */

import { MemoryStratum } from '../../types/MemoryStrataTypes';
import { OrparPhase } from '../../types/MemoryUtilityTypes';
import {
    SurpriseOrparDecision,
    PhaseWeightedRewardResult,
    ConsolidationTriggerResult,
    CycleOutcome,
    OrparCycleState
} from '../../types/OrparMemoryIntegrationTypes';

/**
 * ORPAR-Memory Integration event names
 */
export const OrparMemoryEvents = {
    // Phase-Strata Routing Events
    /** Memory retrieved using phase-aware strata routing */
    PHASE_MEMORY_RETRIEVED: 'orparMemory:phase:memory:retrieved',
    /** Memory stored using phase-aware storage spec */
    PHASE_MEMORY_STORED: 'orparMemory:phase:memory:stored',
    /** Phase-strata routing configuration updated */
    PHASE_STRATA_CONFIG_UPDATED: 'orparMemory:phase:strata:config:updated',

    // Surprise-ORPAR Events
    /** Surprise detected and processed */
    SURPRISE_DETECTED: 'orparMemory:surprise:detected',
    /** ORPAR decision made based on surprise */
    SURPRISE_DECISION_MADE: 'orparMemory:surprise:decision:made',
    /** Additional observation cycle queued due to surprise */
    ADDITIONAL_OBSERVATION_QUEUED: 'orparMemory:surprise:observation:queued',
    /** Surprise context injected into reasoning */
    SURPRISE_CONTEXT_INJECTED: 'orparMemory:surprise:context:injected',
    /** Plan reconsideration triggered */
    PLAN_RECONSIDERATION_TRIGGERED: 'orparMemory:surprise:plan:reconsider',

    // Phase-Weighted Reward Events
    /** Phase-weighted reward calculated for memory */
    PHASE_REWARD_CALCULATED: 'orparMemory:reward:calculated',
    /** Phase-weighted rewards attributed to memories */
    PHASE_REWARD_ATTRIBUTED: 'orparMemory:reward:attributed',
    /** Batch of phase-weighted rewards applied */
    PHASE_REWARDS_BATCH_APPLIED: 'orparMemory:reward:batch:applied',

    // Consolidation Events
    /** Consolidation rule triggered */
    CONSOLIDATION_TRIGGERED: 'orparMemory:consolidation:triggered',
    /** Memory promoted to higher stratum */
    MEMORY_PROMOTED: 'orparMemory:consolidation:promoted',
    /** Memory demoted to lower stratum */
    MEMORY_DEMOTED: 'orparMemory:consolidation:demoted',
    /** Memory archived */
    MEMORY_ARCHIVED: 'orparMemory:consolidation:archived',
    /** Memory abstracted to semantic stratum */
    MEMORY_ABSTRACTED: 'orparMemory:consolidation:abstracted',

    // Cycle Coordination Events
    /** ORPAR cycle started with memory integration */
    CYCLE_STARTED: 'orparMemory:cycle:started',
    /** ORPAR phase changed */
    PHASE_CHANGED: 'orparMemory:cycle:phase:changed',
    /** ORPAR cycle completed */
    CYCLE_COMPLETED: 'orparMemory:cycle:completed',
    /** Cycle memory usage recorded */
    CYCLE_MEMORY_USAGE_RECORDED: 'orparMemory:cycle:memory:recorded',

    // Error Events
    /** Error in phase-strata routing */
    PHASE_ROUTING_ERROR: 'orparMemory:error:phase:routing',
    /** Error in surprise processing */
    SURPRISE_PROCESSING_ERROR: 'orparMemory:error:surprise',
    /** Error in reward attribution */
    REWARD_ATTRIBUTION_ERROR: 'orparMemory:error:reward',
    /** Error in consolidation */
    CONSOLIDATION_ERROR: 'orparMemory:error:consolidation'
} as const;

// ============================================================================
// Event Data Interfaces
// ============================================================================

/**
 * Data for phase memory retrieved event
 */
export interface PhaseMemoryRetrievedEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** ORPAR phase that drove retrieval */
    phase: OrparPhase;
    /** Query used */
    query: string;
    /** Strata that were queried */
    queriedStrata: MemoryStratum[];
    /** Number of memories retrieved */
    memoryCount: number;
    /** Memory IDs retrieved */
    memoryIds: string[];
    /** Lambda value used */
    lambdaUsed: number;
    /** Query time in milliseconds */
    queryTimeMs: number;
}

/**
 * Data for phase memory stored event
 */
export interface PhaseMemoryStoredEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** ORPAR phase during storage */
    phase: OrparPhase;
    /** Memory ID created */
    memoryId: string;
    /** Target stratum */
    targetStratum: MemoryStratum;
    /** Content type */
    contentType: string;
    /** Tags applied */
    tags: string[];
}

/**
 * Data for surprise detected event
 */
export interface SurpriseDetectedEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** Cycle ID */
    cycleId: string;
    /** Surprise score */
    surpriseScore: number;
    /** Surprise type */
    surpriseType: string;
    /** The surprising observation */
    observation: string;
    /** Explanation */
    explanation?: string;
}

/**
 * Data for surprise decision made event
 */
export interface SurpriseDecisionMadeEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** Cycle ID */
    cycleId: string;
    /** Decision made */
    decision: SurpriseOrparDecision;
}

/**
 * Data for phase reward attributed event
 */
export interface PhaseRewardAttributedEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** Cycle ID */
    cycleId: string;
    /** Task ID if applicable */
    taskId?: string;
    /** Reward results for each memory */
    rewardResults: PhaseWeightedRewardResult[];
    /** Total memories rewarded */
    totalMemoriesRewarded: number;
    /** Cycle outcome that triggered rewards */
    cycleOutcome: CycleOutcome;
}

/**
 * Data for consolidation triggered event
 */
export interface ConsolidationTriggeredEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** Trigger result */
    triggerResult: ConsolidationTriggerResult;
}

/**
 * Data for cycle started event
 */
export interface CycleStartedEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** Cycle ID */
    cycleId: string;
    /** Task ID if associated */
    taskId?: string;
    /** Initial phase */
    initialPhase: OrparPhase;
}

/**
 * Data for phase changed event
 */
export interface PhaseChangedEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** Cycle ID */
    cycleId: string;
    /** Previous phase */
    previousPhase: OrparPhase;
    /** New phase */
    newPhase: OrparPhase;
    /** Duration of previous phase in ms */
    previousPhaseDurationMs: number;
}

/**
 * Data for cycle completed event
 */
export interface CycleCompletedEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** Cycle ID */
    cycleId: string;
    /** Task ID if associated */
    taskId?: string;
    /** Cycle outcome */
    outcome: CycleOutcome;
    /** Total cycle duration in ms */
    totalDurationMs: number;
    /** Phase durations */
    phaseDurations: Partial<Record<OrparPhase, number>>;
    /** Number of memories used */
    memoriesUsedCount: number;
    /** Number of surprise detections */
    surpriseCount: number;
    /** Final cycle state */
    finalState: OrparCycleState;
}

/**
 * Data for error events
 */
export interface OrparMemoryErrorEventData {
    /** Agent ID */
    agentId: string;
    /** Channel ID */
    channelId: string;
    /** Cycle ID if applicable */
    cycleId?: string;
    /** Error message */
    error: string;
    /** Error context */
    context?: Record<string, unknown>;
    /** Stack trace if available */
    stack?: string;
}

// ============================================================================
// Payload Type Map
// ============================================================================

/**
 * Payload types for ORPAR-Memory events
 */
export interface OrparMemoryPayloads {
    // Phase-Strata Routing
    'orparMemory:phase:memory:retrieved': PhaseMemoryRetrievedEventData;
    'orparMemory:phase:memory:stored': PhaseMemoryStoredEventData;
    'orparMemory:phase:strata:config:updated': { config: Record<string, unknown> };

    // Surprise-ORPAR
    'orparMemory:surprise:detected': SurpriseDetectedEventData;
    'orparMemory:surprise:decision:made': SurpriseDecisionMadeEventData;
    'orparMemory:surprise:observation:queued': {
        agentId: string;
        channelId: string;
        cycleId: string;
        queuedCount: number;
    };
    'orparMemory:surprise:context:injected': {
        agentId: string;
        channelId: string;
        cycleId: string;
        surpriseScore: number;
        focusAreas: string[];
    };
    'orparMemory:surprise:plan:reconsider': {
        agentId: string;
        channelId: string;
        cycleId: string;
        reason: string;
        severity: 'low' | 'medium' | 'high';
    };

    // Phase-Weighted Reward
    'orparMemory:reward:calculated': {
        agentId: string;
        channelId: string;
        memoryId: string;
        reward: number;
        phaseContributions: Partial<Record<OrparPhase, number>>;
    };
    'orparMemory:reward:attributed': PhaseRewardAttributedEventData;
    'orparMemory:reward:batch:applied': {
        agentId: string;
        channelId: string;
        cycleId: string;
        memoriesUpdated: number;
        totalRewardApplied: number;
    };

    // Consolidation
    'orparMemory:consolidation:triggered': ConsolidationTriggeredEventData;
    'orparMemory:consolidation:promoted': {
        agentId: string;
        channelId: string;
        memoryId: string;
        fromStratum: MemoryStratum;
        toStratum: MemoryStratum;
        qValue: number;
    };
    'orparMemory:consolidation:demoted': {
        agentId: string;
        channelId: string;
        memoryId: string;
        fromStratum: MemoryStratum;
        toStratum: MemoryStratum;
        qValue: number;
    };
    'orparMemory:consolidation:archived': {
        agentId: string;
        channelId: string;
        memoryId: string;
        previousStratum: MemoryStratum;
        reason: string;
    };
    'orparMemory:consolidation:abstracted': {
        agentId: string;
        channelId: string;
        memoryId: string;
        newMemoryId: string;
        fromStratum: MemoryStratum;
    };

    // Cycle Coordination
    'orparMemory:cycle:started': CycleStartedEventData;
    'orparMemory:cycle:phase:changed': PhaseChangedEventData;
    'orparMemory:cycle:completed': CycleCompletedEventData;
    'orparMemory:cycle:memory:recorded': {
        agentId: string;
        channelId: string;
        cycleId: string;
        phase: OrparPhase;
        memoryId: string;
        usageType: string;
    };

    // Errors
    'orparMemory:error:phase:routing': OrparMemoryErrorEventData;
    'orparMemory:error:surprise': OrparMemoryErrorEventData;
    'orparMemory:error:reward': OrparMemoryErrorEventData;
    'orparMemory:error:consolidation': OrparMemoryErrorEventData;
}
