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
 * CompactionEvents.ts
 *
 * Event definitions for context compaction operations.
 * Tracks microcompaction, auto-compaction, reactive compaction,
 * post-compaction restoration, and summary generation.
 */

import { AgentId, ChannelId } from '../../types/ChannelContext';

/**
 * Compaction event constants
 */
export const CompactionEvents = {
    /** Tool result microcompaction applied (cheap, no LLM) */
    MICROCOMPACTION_APPLIED: 'compaction:micro:applied',

    /** Auto-compaction triggered (threshold-based) */
    AUTO_COMPACTION_TRIGGERED: 'compaction:auto:triggered',

    /** Reactive compaction triggered (413 error recovery) */
    REACTIVE_COMPACTION_TRIGGERED: 'compaction:reactive:triggered',

    /** Post-compaction artifact restoration completed */
    POST_COMPACTION_RESTORED: 'compaction:restoration:completed',

    /** Structured compaction summary generated */
    COMPACTION_SUMMARY_GENERATED: 'compaction:summary:generated',
} as const;

/**
 * Microcompaction applied event payload
 */
export interface MicrocompactionAppliedPayload {
    /** Event type */
    eventType: typeof CompactionEvents.MICROCOMPACTION_APPLIED;
    /** Agent whose context was microcompacted */
    agentId: AgentId;
    /** Channel context */
    channelId: ChannelId;
    /** Number of tool results stripped */
    toolResultsStripped: number;
    /** Tokens removed by stripping tool result bodies */
    tokensRemoved: number;
    /** Total tokens before microcompaction */
    tokensBefore: number;
    /** Total tokens after microcompaction */
    tokensAfter: number;
    /** Event timestamp */
    timestamp: number;
}

/**
 * Auto-compaction triggered event payload
 */
export interface AutoCompactionTriggeredPayload {
    /** Event type */
    eventType: typeof CompactionEvents.AUTO_COMPACTION_TRIGGERED;
    /** Agent whose context was compacted */
    agentId: AgentId;
    /** Channel context */
    channelId: ChannelId;
    /** Context window usage percentage that triggered compaction */
    usagePercent: number;
    /** Number of messages before compaction */
    messagesBefore: number;
    /** Number of messages after compaction */
    messagesAfter: number;
    /** Tokens before compaction */
    tokensBefore: number;
    /** Tokens after compaction */
    tokensAfter: number;
    /** Event timestamp */
    timestamp: number;
}

/**
 * Reactive compaction triggered event payload
 */
export interface ReactiveCompactionTriggeredPayload {
    /** Event type */
    eventType: typeof CompactionEvents.REACTIVE_COMPACTION_TRIGGERED;
    /** Agent whose context overflowed */
    agentId: AgentId;
    /** Channel context */
    channelId: ChannelId;
    /** HTTP status code that triggered reactive compaction (typically 413) */
    statusCode: number;
    /** Retry attempt number (1-based) */
    retryAttempt: number;
    /** Strategy used for reactive compaction */
    strategy: 'microcompact_all' | 'structured_summary' | 'aggressive_drop';
    /** Tokens before reactive compaction */
    tokensBefore: number;
    /** Tokens after reactive compaction */
    tokensAfter: number;
    /** Event timestamp */
    timestamp: number;
}

/**
 * Post-compaction restoration completed event payload
 */
export interface PostCompactionRestoredPayload {
    /** Event type */
    eventType: typeof CompactionEvents.POST_COMPACTION_RESTORED;
    /** Agent whose context was restored */
    agentId: AgentId;
    /** Channel context */
    channelId: ChannelId;
    /** Number of artifacts restored */
    artifactsRestored: number;
    /** Names of restored artifacts (e.g., 'task_state', 'active_agents', 'orpar_phase') */
    artifactNames: string[];
    /** Tokens added by restoration */
    tokensAdded: number;
    /** Event timestamp */
    timestamp: number;
}

/**
 * Compaction summary generated event payload
 */
export interface CompactionSummaryGeneratedPayload {
    /** Event type */
    eventType: typeof CompactionEvents.COMPACTION_SUMMARY_GENERATED;
    /** Agent whose context was summarized */
    agentId: AgentId;
    /** Channel context */
    channelId: ChannelId;
    /** Summary generation method */
    method: 'heuristic' | 'systemllm';
    /** Number of messages summarized */
    messagesSummarized: number;
    /** Summary sections included */
    sections: string[];
    /** Tokens in the generated summary */
    summaryTokens: number;
    /** Event timestamp */
    timestamp: number;
}

/**
 * Union type of all compaction event payloads
 */
export type CompactionEventPayload =
    | MicrocompactionAppliedPayload
    | AutoCompactionTriggeredPayload
    | ReactiveCompactionTriggeredPayload
    | PostCompactionRestoredPayload
    | CompactionSummaryGeneratedPayload;

/**
 * Compaction event payload map for type-safe event handling
 */
export interface CompactionPayloads {
    [CompactionEvents.MICROCOMPACTION_APPLIED]: MicrocompactionAppliedPayload;
    [CompactionEvents.AUTO_COMPACTION_TRIGGERED]: AutoCompactionTriggeredPayload;
    [CompactionEvents.REACTIVE_COMPACTION_TRIGGERED]: ReactiveCompactionTriggeredPayload;
    [CompactionEvents.POST_COMPACTION_RESTORED]: PostCompactionRestoredPayload;
    [CompactionEvents.COMPACTION_SUMMARY_GENERATED]: CompactionSummaryGeneratedPayload;
}

/** Export event type for use in other modules */
export type CompactionEventType = keyof typeof CompactionEvents;
