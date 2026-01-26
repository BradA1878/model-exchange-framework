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
 * Memory Utility Learning System (MULS) Events
 *
 * Events emitted by the MULS components for analytics, monitoring, and debugging.
 * These events track Q-value updates, utility-based retrieval, and reward attribution.
 *
 * Feature flag: MEMORY_UTILITY_LEARNING_ENABLED
 */

import { OrparPhase, TaskOutcomeStatus } from '../../types/MemoryUtilityTypes';

/**
 * MULS event names
 */
export const MemoryUtilityEvents = {
    /** Emitted when a single Q-value is updated */
    QVALUE_UPDATED: 'memory:qvalue_updated',

    /** Emitted when multiple Q-values are updated in a batch */
    QVALUE_BATCH_UPDATED: 'memory:qvalue_batch_updated',

    /** Emitted when utility-based retrieval is completed */
    UTILITY_RETRIEVAL_COMPLETED: 'memory:utility_retrieval_completed',

    /** Emitted when rewards are attributed to memories after task completion */
    REWARD_ATTRIBUTED: 'memory:reward_attributed',

    /** Emitted when memory usage is tracked for a task */
    MEMORY_TRACKED: 'memory:tracked',

    /** Emitted when MULS configuration changes */
    CONFIG_UPDATED: 'memory:utility_config_updated'
} as const;

/**
 * Type for MULS event names
 */
export type MemoryUtilityEventName = typeof MemoryUtilityEvents[keyof typeof MemoryUtilityEvents];

/**
 * Base payload for all MULS events
 */
export interface MemoryUtilityBasePayload {
    /** Event type */
    eventType: MemoryUtilityEventName;
    /** Timestamp of the event */
    timestamp: number;
}

/**
 * Payload for QVALUE_UPDATED event
 */
export interface QValueUpdatedPayload extends MemoryUtilityBasePayload {
    eventType: typeof MemoryUtilityEvents.QVALUE_UPDATED;
    data: {
        /** The memory ID that was updated */
        memoryId: string;
        /** Q-value before the update */
        oldValue: number;
        /** Q-value after the update */
        newValue: number;
        /** Reward signal that triggered the update */
        reward: number;
        /** Change in Q-value (newValue - oldValue) */
        delta: number;
        /** Optional task ID that triggered the update */
        taskId?: string;
        /** Optional agent ID */
        agentId?: string;
        /** Optional channel ID */
        channelId?: string;
        /** Optional ORPAR phase */
        phase?: OrparPhase;
    };
}

/**
 * Payload for QVALUE_BATCH_UPDATED event
 */
export interface QValueBatchUpdatedPayload extends MemoryUtilityBasePayload {
    eventType: typeof MemoryUtilityEvents.QVALUE_BATCH_UPDATED;
    data: {
        /** Total number of updates attempted */
        totalUpdates: number;
        /** Number of successful updates */
        updated: number;
        /** Number of failed updates */
        failed: number;
        /** Optional task ID that triggered the batch update */
        taskId?: string;
        /** Optional summary of errors */
        errors?: Array<{ memoryId: string; error: string }>;
    };
}

/**
 * Payload for UTILITY_RETRIEVAL_COMPLETED event
 */
export interface UtilityRetrievalCompletedPayload extends MemoryUtilityBasePayload {
    eventType: typeof MemoryUtilityEvents.UTILITY_RETRIEVAL_COMPLETED;
    data: {
        /** Query used for retrieval */
        query: string;
        /** ORPAR phase (if specified) */
        phase?: OrparPhase;
        /** Lambda value used for scoring */
        lambda: number;
        /** Number of candidates in Phase A */
        totalCandidates: number;
        /** Number of results returned */
        resultsReturned: number;
        /** Time for semantic search (ms) */
        semanticSearchTimeMs: number;
        /** Time for utility scoring (ms) */
        utilityScoringTimeMs: number;
        /** Total retrieval time (ms) */
        totalTimeMs: number;
        /** IDs of retrieved memories */
        memoryIds: string[];
        /** Optional agent ID */
        agentId?: string;
        /** Optional channel ID */
        channelId?: string;
    };
}

/**
 * Payload for REWARD_ATTRIBUTED event
 */
export interface RewardAttributedPayload extends MemoryUtilityBasePayload {
    eventType: typeof MemoryUtilityEvents.REWARD_ATTRIBUTED;
    data: {
        /** Task ID (if task-level attribution) */
        taskId?: string;
        /** Task outcome status */
        status?: TaskOutcomeStatus;
        /** Reward value attributed */
        reward: number;
        /** Number of memories that received the reward */
        memoriesUpdated: number;
        /** Number of memories that failed to update */
        memoriesFailed: number;
        /** IDs of memories that received the reward */
        memoryIds: string[];
        /** Whether this was a manual injection */
        isManual?: boolean;
        /** Reason for manual injection */
        reason?: string;
        /** New Q-value (for single memory manual injection) */
        newQValue?: number;
        /** Single memory ID (for manual injection) */
        memoryId?: string;
    };
}

/**
 * Payload for MEMORY_TRACKED event
 */
export interface MemoryTrackedPayload extends MemoryUtilityBasePayload {
    eventType: typeof MemoryUtilityEvents.MEMORY_TRACKED;
    data: {
        /** Task ID the memory is tracked for */
        taskId: string;
        /** Memory ID being tracked */
        memoryId: string;
        /** ORPAR phase when tracked */
        phase: OrparPhase;
        /** Usage type */
        usageType?: 'context' | 'reasoning' | 'action-guidance' | 'pattern-match';
        /** Timestamp of tracking */
        trackedAt: Date;
    };
}

/**
 * Payload for CONFIG_UPDATED event
 */
export interface ConfigUpdatedPayload extends MemoryUtilityBasePayload {
    eventType: typeof MemoryUtilityEvents.CONFIG_UPDATED;
    data: {
        /** Whether MULS is now enabled */
        enabled: boolean;
        /** New global lambda value */
        lambda?: number;
        /** New learning rate */
        learningRate?: number;
        /** Updated phase lambdas */
        phaseLambdas?: Record<OrparPhase, number>;
        /** Source of the update */
        source: 'api' | 'config' | 'env' | 'tool';
    };
}

/**
 * Union type for all MULS payloads
 */
export type MemoryUtilityPayload =
    | QValueUpdatedPayload
    | QValueBatchUpdatedPayload
    | UtilityRetrievalCompletedPayload
    | RewardAttributedPayload
    | MemoryTrackedPayload
    | ConfigUpdatedPayload;

/**
 * Payload types for MULS events (indexed by event name)
 */
export interface MemoryUtilityPayloads {
    'memory:qvalue_updated': QValueUpdatedPayload;
    'memory:qvalue_batch_updated': QValueBatchUpdatedPayload;
    'memory:utility_retrieval_completed': UtilityRetrievalCompletedPayload;
    'memory:reward_attributed': RewardAttributedPayload;
    'memory:tracked': MemoryTrackedPayload;
    'memory:utility_config_updated': ConfigUpdatedPayload;
}
