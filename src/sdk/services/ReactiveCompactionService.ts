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
 * Reactive Compaction Service
 *
 * Emergency handler for context overflow (HTTP 413) errors.
 * Applies escalating compaction strategies and retries:
 *
 *   1. Microcompact ALL tool results (cheapest)
 *   2. Structured summary — keep only last 3 messages + summary
 *   3. Aggressive drop — keep only last 2 messages + summary
 *
 * Max 2 retry attempts to prevent infinite loops.
 * Emits REACTIVE_COMPACTION_TRIGGERED events for visibility.
 */

import { Logger } from '../../shared/utils/Logger';
import { estimateTokens } from '../../shared/utils/TokenEstimator';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { AgentId, ChannelId } from '../../shared/types/ChannelContext';
import { ToolResultMicrocompactor } from './ToolResultMicrocompactor';
import { StructuredSummaryBuilder } from '../../shared/services/StructuredSummaryBuilder';
import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import { createReactiveCompactionTriggeredPayload } from '../../shared/schemas/EventPayloadSchema';

const logger = new Logger('info', 'ReactiveCompactionService', 'client');

/** Strategy applied during reactive compaction */
export type ReactiveCompactionStrategy = 'microcompact_all' | 'structured_summary' | 'aggressive_drop';

/** Result of a reactive compaction attempt */
export interface ReactiveCompactionResult {
    /** The compacted conversation history */
    messages: ConversationMessage[];
    /** Strategy that was applied */
    strategy: ReactiveCompactionStrategy;
    /** Tokens before compaction */
    tokensBefore: number;
    /** Tokens after compaction */
    tokensAfter: number;
    /** Whether compaction was successful (at least 10% token reduction) */
    success: boolean;
}

/**
 * Reactive Compaction Service — singleton
 *
 * Handles emergency context overflow by applying escalating
 * compaction strategies.
 */
export class ReactiveCompactionService {
    private static instance: ReactiveCompactionService | null = null;
    /** Max retry attempts to prevent infinite compaction loops */
    private static readonly MAX_RETRIES = 2;

    private constructor() {}

    /** Get singleton instance */
    public static getInstance(): ReactiveCompactionService {
        if (!ReactiveCompactionService.instance) {
            ReactiveCompactionService.instance = new ReactiveCompactionService();
        }
        return ReactiveCompactionService.instance;
    }

    /**
     * Check if an error is a context overflow (413) that reactive compaction can handle.
     */
    public isContextOverflowError(error: any): boolean {
        if (!error) return false;

        // HTTP 413 status code
        if (error.status === 413 || error.statusCode === 413) return true;

        // Error message patterns from various LLM providers
        const message = (error.message || error.error || '').toLowerCase();
        return message.includes('context length exceeded') ||
            message.includes('maximum context length') ||
            message.includes('too many tokens') ||
            message.includes('request too large') ||
            message.includes('payload too large') ||
            message.includes('context_length_exceeded');
    }

    /**
     * Apply reactive compaction with escalating strategies.
     *
     * @param messages - Current conversation history
     * @param agentId - Agent whose context overflowed
     * @param channelId - Channel context
     * @param retryAttempt - Current retry attempt (1-based, starts at 1)
     * @param statusCode - HTTP status code that triggered this (typically 413)
     * @returns ReactiveCompactionResult with compacted messages
     */
    public async compact(
        messages: ConversationMessage[],
        agentId: AgentId,
        channelId: ChannelId,
        retryAttempt: number = 1,
        statusCode: number = 413,
    ): Promise<ReactiveCompactionResult> {
        // Guard against infinite loops
        if (retryAttempt > ReactiveCompactionService.MAX_RETRIES) {
            logger.error('Reactive compaction max retries exceeded', {
                agentId, retryAttempt,
            });
            return {
                messages,
                strategy: 'aggressive_drop',
                tokensBefore: this.estimateHistoryTokens(messages),
                tokensAfter: this.estimateHistoryTokens(messages),
                success: false,
            };
        }

        const tokensBefore = this.estimateHistoryTokens(messages);

        // Choose strategy based on retry attempt
        const strategy = this.getStrategy(retryAttempt);
        logger.info('Reactive compaction triggered', {
            agentId, channelId, retryAttempt, strategy, tokensBefore,
        });

        let compacted: ConversationMessage[];

        switch (strategy) {
            case 'microcompact_all':
                compacted = this.applyMicrocompactAll(messages);
                break;
            case 'structured_summary':
                compacted = this.applyStructuredSummary(messages, 3);
                break;
            case 'aggressive_drop':
                compacted = this.applyStructuredSummary(messages, 2);
                break;
        }

        const tokensAfter = this.estimateHistoryTokens(compacted);

        // Emit event for observability
        try {
            const payload = createReactiveCompactionTriggeredPayload(
                agentId, channelId,
                {
                    statusCode,
                    retryAttempt,
                    strategy,
                    tokensBefore,
                    tokensAfter,
                },
            );
            EventBus.client.emit(Events.Compaction.REACTIVE_COMPACTION_TRIGGERED, payload);
        } catch (eventError) {
            // Don't fail compaction because of event emission
            logger.warn('Failed to emit reactive compaction event', {
                error: eventError instanceof Error ? eventError.message : String(eventError),
            });
        }

        // Require at least 10% reduction to count as successful — a near-no-op
        // compaction should not halt retry escalation prematurely
        const success = tokensBefore > 0 && (tokensBefore - tokensAfter) / tokensBefore >= 0.10;

        logger.info('Reactive compaction completed', {
            agentId, strategy, tokensBefore, tokensAfter,
            tokensRecovered: tokensBefore - tokensAfter,
            success,
        });

        return { messages: compacted, strategy, tokensBefore, tokensAfter, success };
    }

    /**
     * Get the compaction strategy for a given retry attempt.
     * Escalates from cheapest to most aggressive.
     */
    public getStrategy(retryAttempt: number): ReactiveCompactionStrategy {
        switch (retryAttempt) {
            case 1: return 'microcompact_all';
            case 2: return 'structured_summary';
            default: return 'aggressive_drop';
        }
    }

    /** Strategy 1: Microcompact all tool results (cheapest, no LLM) */
    private applyMicrocompactAll(messages: ConversationMessage[]): ConversationMessage[] {
        const microcompactor = ToolResultMicrocompactor.getInstance();
        const result = microcompactor.compactAll(messages);
        return result.messages;
    }

    /**
     * Strategy 2/3: Build a structured summary of older messages, keep only
     * the most recent N messages verbatim.
     */
    private applyStructuredSummary(
        messages: ConversationMessage[],
        keepRecentCount: number,
    ): ConversationMessage[] {
        const cutoff = Math.max(0, messages.length - keepRecentCount);
        const olderMessages = messages.slice(0, cutoff);
        const recentMessages = messages.slice(cutoff);

        if (olderMessages.length === 0) {
            return recentMessages;
        }

        // Build structured summary of older messages
        const summaryBuilder = StructuredSummaryBuilder.getInstance();
        const summary = summaryBuilder.buildSummary(olderMessages);
        const summaryText = summaryBuilder.formatAsPrompt(summary);

        // Create a summary message to replace the older messages
        const summaryMessage: ConversationMessage = {
            id: `compaction-summary-${Date.now()}`,
            role: 'system',
            content: summaryText,
            timestamp: Date.now(),
            metadata: {
                contextLayer: 'system',
                messageType: 'system-notice',
                ephemeral: false,
                compactionSummary: true,
                messagesSummarized: olderMessages.length,
            },
        };

        return [summaryMessage, ...recentMessages];
    }

    /** Estimate total tokens for a conversation history */
    private estimateHistoryTokens(messages: ConversationMessage[]): number {
        let total = 0;
        for (const msg of messages) {
            total += estimateTokens(msg.content);
            if (msg.tool_calls) {
                total += estimateTokens(JSON.stringify(msg.tool_calls));
            }
        }
        return total;
    }
}
