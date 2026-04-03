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
 * Tool Result Microcompactor
 *
 * The cheapest compaction layer — strips old tool result bodies
 * without any LLM call. Preserves:
 *   - tool name, call ID, success/failure status
 *   - tool_call_id linkage (required by LLM APIs for tool_calls/results pairing)
 *   - conversation structure and message ordering
 *
 * Replaces tool result body with:
 *   [Tool result: <name> - <status> - <N chars removed>]
 *
 * Only triggers when total tokens exceed the configured threshold.
 * Processes messages oldest-first, skipping the most recent N messages.
 */

import { Logger } from '../../shared/utils/Logger';
import { estimateTokens } from '../../shared/utils/TokenEstimator';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { AgentId, ChannelId } from '../../shared/types/ChannelContext';

const logger = new Logger('info', 'ToolResultMicrocompactor', 'client');

/** Result of a microcompaction pass */
export interface MicrocompactionResult {
    /** The compacted conversation history */
    messages: ConversationMessage[];
    /** Number of tool results that were stripped */
    toolResultsStripped: number;
    /** Characters removed from tool result bodies */
    charsRemoved: number;
    /** Estimated tokens before microcompaction */
    tokensBefore: number;
    /** Estimated tokens after microcompaction */
    tokensAfter: number;
    /** Whether any compaction was applied */
    wasApplied: boolean;
}

/**
 * Tool Result Microcompactor — singleton
 *
 * Strips old tool result bodies from conversation history
 * to reclaim context space without any LLM call.
 */
export class ToolResultMicrocompactor {
    private static instance: ToolResultMicrocompactor | null = null;

    private constructor() {}

    /** Get singleton instance */
    public static getInstance(): ToolResultMicrocompactor {
        if (!ToolResultMicrocompactor.instance) {
            ToolResultMicrocompactor.instance = new ToolResultMicrocompactor();
        }
        return ToolResultMicrocompactor.instance;
    }

    /**
     * Apply microcompaction to a conversation history.
     *
     * Strips tool result bodies from older messages while preserving
     * recent messages untouched. Does not mutate the input array.
     *
     * @param messages - Full conversation history
     * @param tokenThreshold - Only compact if total tokens exceed this
     * @param preserveRecentCount - Number of recent messages to leave untouched (default 10)
     * @returns MicrocompactionResult with the compacted history
     */
    public compact(
        messages: ConversationMessage[],
        tokenThreshold: number,
        preserveRecentCount: number = 10,
    ): MicrocompactionResult {
        // Estimate current token count
        const tokensBefore = this.estimateHistoryTokens(messages);

        // Skip if below threshold
        if (tokensBefore <= tokenThreshold) {
            return {
                messages,
                toolResultsStripped: 0,
                charsRemoved: 0,
                tokensBefore,
                tokensAfter: tokensBefore,
                wasApplied: false,
            };
        }

        // Determine which messages are eligible for stripping
        // (everything except the most recent `preserveRecentCount` messages)
        const cutoffIndex = Math.max(0, messages.length - preserveRecentCount);

        let toolResultsStripped = 0;
        let charsRemoved = 0;

        const compacted = messages.map((msg, index) => {
            // Skip recent messages
            if (index >= cutoffIndex) return msg;

            // Only strip tool-role messages
            if (msg.role !== 'tool') return msg;

            // Already stripped (idempotent)
            if (msg.content.startsWith('[Tool result:')) return msg;

            // Extract tool name from metadata or content
            const toolName = this.extractToolName(msg);
            const status = this.extractStatus(msg);
            const originalLength = msg.content.length;

            // Build replacement content
            const replacement = `[Tool result: ${toolName} - ${status} - ${originalLength} chars removed]`;

            charsRemoved += originalLength - replacement.length;
            toolResultsStripped++;

            return {
                ...msg,
                content: replacement,
                metadata: {
                    ...msg.metadata,
                    microcompacted: true,
                    originalContentLength: originalLength,
                },
            };
        });

        const tokensAfter = this.estimateHistoryTokens(compacted);

        logger.info('Microcompaction applied', {
            toolResultsStripped,
            charsRemoved,
            tokensBefore,
            tokensAfter,
            tokensRecovered: tokensBefore - tokensAfter,
        });

        return {
            messages: compacted,
            toolResultsStripped,
            charsRemoved,
            tokensBefore,
            tokensAfter,
            wasApplied: toolResultsStripped > 0,
        };
    }

    /**
     * Aggressively strip ALL tool results regardless of recency.
     * Used by reactive compaction (413 recovery) as a first escalation step.
     *
     * @param messages - Full conversation history
     * @returns MicrocompactionResult with all tool results stripped
     */
    public compactAll(messages: ConversationMessage[]): MicrocompactionResult {
        return this.compact(messages, 0, 0);
    }

    /** Estimate total tokens for a conversation history */
    private estimateHistoryTokens(messages: ConversationMessage[]): number {
        let total = 0;
        for (const msg of messages) {
            total += estimateTokens(msg.content);
            // Account for tool_calls JSON if present
            if (msg.tool_calls) {
                total += estimateTokens(JSON.stringify(msg.tool_calls));
            }
        }
        return total;
    }

    /**
     * Extract tool name from a tool-role message.
     * Checks metadata.toolName first (most reliable), then content patterns.
     */
    private extractToolName(msg: ConversationMessage): string {
        // Most reliable: explicit tool name in metadata
        if (msg.metadata?.toolName) return msg.metadata.toolName;

        // Try to parse from content (common patterns)
        const match = msg.content.match(/^(?:Tool|Result|Output)\s+(?:for\s+)?["`']?(\w+)["`']?/i);
        if (match) return match[1];

        return 'unknown';
    }

    /** Extract success/failure status from a tool result message */
    private extractStatus(msg: ConversationMessage): string {
        if (msg.metadata?.isError === true) return 'error';
        if (msg.metadata?.success === false) return 'error';
        if (msg.metadata?.success === true) return 'success';

        // Heuristic: check for error indicators in content
        const lower = msg.content.toLowerCase();
        if (lower.includes('error:') || lower.includes('failed') || lower.includes('exception')) {
            return 'error';
        }

        return 'success';
    }
}
