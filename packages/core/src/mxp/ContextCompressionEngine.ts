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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * MXP 2.0 Context Compression Engine
 *
 * Shrinks conversation context by keeping the most recent messages verbatim and
 * replacing older ones with a summary. Only activates when MXP token
 * optimization is enabled for the channel/agent.
 *
 * ## What this actually does — no LLM is involved
 *
 * Compression is deterministic and local:
 *
 * - **Recency window**: the last `windowSize` messages are kept untouched.
 * - **Structured summary**: older messages are run through StructuredSummaryBuilder,
 *   which extracts the primary request, key decisions, tool executions, errors,
 *   verbatim user directives, and current state.
 * - **Exact-duplicate removal**: byte-identical messages (after whitespace and
 *   punctuation normalization) are collapsed.
 * - **Context references**: very large blocks can be swapped for a reference ID
 *   and retrieved later with getContextByReference().
 *
 * This is LOSSY. Anything not captured by a summary section is gone. Callers get
 * measured token counts and a measured ratio so they can see exactly how much was
 * dropped.
 *
 * A previous version had a method called `compressWithSystemLLM` that called no
 * LLM: it concatenated the messages and cut the string at a byte offset, mid-word,
 * then reported a compression ratio for it. That is gone.
 */

import { Logger } from '../utils/Logger.js';
import { createStrictValidator } from '../utils/validation.js';
import { EventBus } from '../events/EventBus.js';
import { Events } from '../events/EventNames.js';
import { ChannelMessage, AgentMessage } from '../schemas/MessageSchemas.js';
import { createMxpTokenOptimizationEventPayload } from '../schemas/EventPayloadSchema.js';
// EntityTypes imported from interfaces
type ChannelId = string;
type AgentId = string;
import { MxpConfigManager } from './MxpConfigManager.js';
import crypto from 'crypto';
import { StructuredSummaryBuilder } from '../services/StructuredSummaryBuilder.js';
import { loadPromptCompactionConfig } from '../config/PromptCompactionConfig.js';
import { getContextLimit, getCompactionThreshold } from '../config/ModelContextLimits.js';
import { ConversationMessage } from '../interfaces/ConversationMessage.js';

export interface CompressedContext {
    /** The most recent messages, kept verbatim. */
    recent: any[];
    /** Structured summary standing in for the older messages. Lossy. */
    compressed: string;
    /** Measured token estimate of the messages that were summarized. */
    originalTokens: number;
    /** Measured token estimate of the summary that replaced them. */
    compressedTokens: number;
    /** compressedTokens / originalTokens, measured after the fact. */
    ratio: number;
    /** Reference IDs for context stored instead of summarized. */
    contextReferences: string[];
}

export interface CompressionOptions {
    /** Number of recent messages kept verbatim (default: 5). */
    windowSize?: number;
    /** Terms that must appear in the summary even if no section captured them. */
    preserveKeywords?: string[];
    /** Store large blocks as retrievable references instead of summarizing. */
    useContextReferences?: boolean;
    channelId: string;
    agentId?: string;
}

export class ContextCompressionEngine {
    private static instance: ContextCompressionEngine | null = null;
    
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('ContextCompressionEngine');
    private contextCache = new Map<string, any>(); // LRU cache for compressed contexts
    private readonly maxCacheSize = 100;

    /** Counters for getCompressionStats(). Updated on every compression. */
    private readonly stats = {
        totalCompressions: 0,
        totalOriginalTokens: 0,
        totalCompressedTokens: 0
    };

    private constructor() {
        this.logger = new Logger('info', 'ContextCompressionEngine', 'server');
    }

    /**
     * Get the singleton instance of ContextCompressionEngine
     */
    public static getInstance(): ContextCompressionEngine {
        if (!ContextCompressionEngine.instance) {
            ContextCompressionEngine.instance = new ContextCompressionEngine();
        }
        return ContextCompressionEngine.instance;
    }

    /**
     * Replace older conversation history with a structured summary, keeping the
     * most recent `windowSize` messages verbatim.
     *
     * This is LOSSY: detail in the older messages that no summary section
     * captures is discarded. The returned token counts and ratio are measured,
     * not projected, so the caller can see how much was dropped.
     *
     * @returns null when context compression is disabled for this channel/agent.
     * @throws If summarization fails. There is no "return the recent messages and
     *         pretend it worked" path — a caller that thinks it has the earlier
     *         context when it does not will act on missing information.
     */
    public async compressConversation(
        messages: (ChannelMessage | AgentMessage)[],
        options: CompressionOptions
    ): Promise<CompressedContext | null> {
        this.validator.assertIsArray(messages, 'Messages must be an array');
        this.validator.assertIsNonEmptyString(options.channelId, 'Channel ID is required');

        // Check if context compression is enabled for this channel/agent
        const isCompressionEnabled = MxpConfigManager.getInstance().isTokenStrategyEnabled(
            options.channelId,
            'contextCompression',
            options.agentId
        );

        if (!isCompressionEnabled) {
            return null; // No compression - return null to indicate no processing
        }

        const windowSize = options.windowSize || 5;

        // Recency window: keep the newest messages, summarize the rest
        const recentMessages = messages.slice(-windowSize);
        const olderMessages = messages.slice(0, -windowSize);

        // If no older messages, there is nothing to summarize
        if (olderMessages.length === 0) {
            return {
                recent: recentMessages,
                compressed: '',
                originalTokens: this.estimateTokens(messages),
                compressedTokens: this.estimateTokens(recentMessages),
                ratio: 1.0,
                contextReferences: []
            };
        }

        // Get effective configuration for compression settings
        const effectiveConfig = MxpConfigManager.getInstance().getEffectiveConfig(
            options.channelId,
            options.agentId
        );

        const compressionSettings = effectiveConfig.modules.tokenOptimization?.settings.contextWindow;

        // Collapse byte-identical messages if enabled
        let processedOlderMessages = olderMessages;

        const isDeduplicationEnabled = MxpConfigManager.getInstance().isTokenStrategyEnabled(
            options.channelId,
            'entityDeduplication',
            options.agentId
        );

        if (isDeduplicationEnabled) {
            processedOlderMessages = this.removeExactDuplicates(olderMessages);
        }

        // Store the block as a retrievable reference, or summarize it
        let compressed: string;
        const contextReferences: string[] = [];

        const shouldUseReferences = options.useContextReferences &&
            compressionSettings?.referenceMode &&
            processedOlderMessages.length > 20; // Reference mode for > 20 messages

        if (shouldUseReferences) {
            const contextRef = this.createContextReference(
                options.channelId,
                processedOlderMessages
            );
            contextReferences.push(contextRef);
            compressed = `[Context Reference: ${contextRef} - ${processedOlderMessages.length} earlier messages]`;
        } else {
            compressed = this.summarizeMessages(
                processedOlderMessages,
                options.preserveKeywords || []
            );
        }

        const originalTokens = this.estimateTokens(olderMessages);
        const compressedTokens = this.estimateTokens([{ content: compressed }]);
        const actualRatio = originalTokens > 0 ? compressedTokens / originalTokens : 1.0;

        this.stats.totalCompressions++;
        this.stats.totalOriginalTokens += originalTokens;
        this.stats.totalCompressedTokens += compressedTokens;

        // Emit compression event for analytics using proper payload creator
        const compressionEventPayload = createMxpTokenOptimizationEventPayload(
            Events.Mxp.CONTEXT_COMPRESSED,
            options.agentId || 'system',
            options.channelId,
            {
                operationId: crypto.randomUUID(),
                originalTokens,
                optimizedTokens: compressedTokens,
                compressionRatio: actualRatio,
                strategy: 'context_compression',
                timestamp: Date.now(),
                contextWindowReduction: olderMessages.length
            },
            { source: 'ContextCompressionEngine' }
        );
        EventBus.server.emit(Events.Mxp.CONTEXT_COMPRESSED, compressionEventPayload);

        return {
            recent: recentMessages,
            compressed,
            originalTokens,
            compressedTokens,
            ratio: actualRatio,
            contextReferences
        };
    }

    /**
     * Create short reference ID for large context blocks using existing memory system
     */
    private createContextReference(channelId: string, context: any[]): string {
        // Generate hash-based ID (e.g., "ctx_a3f2d1")
        const contextId = `ctx_${crypto.createHash('sha256')
            .update(JSON.stringify(context))
            .digest('hex')
            .substring(0, 8)}`;

        // Store in local cache (in production this would use ChannelContextMemoryOperations)
        this.contextCache.set(contextId, {
            channelId,
            contextData: context,
            timestamp: Date.now(),
            originalSize: JSON.stringify(context).length
        });

        // Implement LRU eviction
        if (this.contextCache.size > this.maxCacheSize) {
            const firstKey = this.contextCache.keys().next().value;
            if (firstKey) {
                this.contextCache.delete(firstKey);
            }
        }

        return contextId;
    }

    /**
     * Retrieve context by reference ID
     */
    public getContextByReference(contextId: string): any[] | null {
        const cached = this.contextCache.get(contextId);
        if (cached) {
            return cached.contextData;
        }
        
        this.logger.warn(`Context reference ${contextId} not found in cache`);
        return null;
    }

    /**
     * Drop messages whose content is identical to one already seen.
     *
     * This is an exact-match filter: content is lowercased, stripped of
     * punctuation and repeated whitespace, then hashed. Messages that merely
     * say the same thing in different words are both kept — there is no
     * semantic similarity here, and the method no longer claims otherwise.
     */
    private removeExactDuplicates(messages: any[]): any[] {
        if (messages.length <= 1) return messages;

        const deduplicated: any[] = [];
        const seenContent = new Set<string>();

        for (const message of messages) {
            const contentText = this.extractContent(message) ?? JSON.stringify(message);

            const normalizedContent = this.normalizeContent(contentText);
            const contentHash = crypto.createHash('md5').update(normalizedContent).digest('hex');

            if (!seenContent.has(contentHash)) {
                seenContent.add(contentHash);
                deduplicated.push(message);
            }
        }

        return deduplicated;
    }

    /**
     * Summarize messages into a structured digest.
     *
     * Delegates to StructuredSummaryBuilder, which extracts the primary request,
     * key decisions, tool executions, errors, verbatim user directives, and
     * current state. Deterministic, local, and lossy — no model is called.
     *
     * @throws If the summary cannot be built.
     */
    private summarizeMessages(messages: any[], preserveKeywords: string[]): string {
        const conversationMessages = messages.map((m, index) => this.toConversationMessage(m, index));

        const builder = StructuredSummaryBuilder.getInstance();
        const summary = builder.buildSummary(conversationMessages);
        const summaryText = builder.formatAsPrompt(summary);

        // Terms the caller asked to keep, which no summary section may have captured.
        const missingKeywords = preserveKeywords.filter(
            keyword => !summaryText.toLowerCase().includes(keyword.toLowerCase())
        );

        if (missingKeywords.length === 0) {
            return summaryText;
        }

        return `${summaryText}\n\nKey terms: ${missingKeywords.join(', ')}`;
    }

    /**
     * Adapt a ChannelMessage/AgentMessage onto the ConversationMessage shape the
     * summary builder consumes.
     */
    private toConversationMessage(message: any, index: number): ConversationMessage {
        const content = this.extractContent(message);
        if (content === null) {
            throw new Error(
                `Cannot summarize message at index ${index}: no readable content ` +
                `(expected a string 'content', 'content.data', or 'directContent').`
            );
        }

        // Messages from the framework carry a senderId rather than a chat role.
        // Anything the system sent is 'system'; everything else is a participant
        // turn, which the builder treats as assistant content.
        const senderId: string | undefined = message.senderId;
        const role: ConversationMessage['role'] = senderId === 'system' ? 'system' : 'assistant';

        return {
            id: message.id ?? message.messageId ?? `ctx-${index}`,
            role,
            content: senderId ? `${senderId}: ${content}` : content,
            timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
            metadata: message.metadata
        };
    }

    /**
     * Pull the text out of the message shapes that flow through the framework.
     * Returns null when there is no readable content.
     */
    private extractContent(message: any): string | null {
        if (typeof message?.content === 'string') {
            return message.content;
        }
        if (typeof message?.content?.data === 'string') {
            return message.content.data;
        }
        if (typeof message?.directContent === 'string') {
            return message.directContent;
        }
        return null;
    }

    /**
     * Normalize message content for exact-duplicate detection
     */
    private normalizeContent(content: string): string {
        return content
            .toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ')    // Normalize whitespace
            .trim();
    }

    /**
     * Estimate token count for messages
     */
    private estimateTokens(messages: any[]): number {
        const totalText = messages
            .map(m => {
                if (typeof m === 'string') return m;
                if (typeof m.content === 'string') return m.content;
                if (m.content?.data) return m.content.data;
                if (m.directContent) return m.directContent;
                return '';
            })
            .join(' ');
        return Math.ceil(totalText.length / 4); // ~4 characters per token
    }

    /**
     * Check if context compression should be applied based on configuration
     */
    public shouldApplyCompression(channelId: string, agentId?: string): boolean {
        return MxpConfigManager.getInstance().isTokenStrategyEnabled(
            channelId,
            'contextCompression',
            agentId
        );
    }

    /**
     * Compression statistics measured from the work this instance actually did.
     *
     * averageCompressionRatio is summarizedTokens/originalTokens across every
     * compression (1.0 = no reduction), and is 0 before anything has been
     * compressed.
     */
    public getCompressionStats(): {
        totalCompressions: number;
        averageCompressionRatio: number;
        cacheSize: number;
        contextReferencesCreated: number;
    } {
        const { totalCompressions, totalOriginalTokens, totalCompressedTokens } = this.stats;

        return {
            totalCompressions,
            averageCompressionRatio: totalOriginalTokens > 0
                ? totalCompressedTokens / totalOriginalTokens
                : 0,
            cacheSize: this.contextCache.size,
            contextReferencesCreated: this.contextCache.size
        };
    }

    /**
     * Reset the compression counters (used by tests).
     */
    public resetCompressionStats(): void {
        this.stats.totalCompressions = 0;
        this.stats.totalOriginalTokens = 0;
        this.stats.totalCompressedTokens = 0;
    }

    /**
     * Clear the context cache (useful for testing or memory management)
     */
    public clearCache(): void {
        this.contextCache.clear();
    }

    // --- Phase 4 additions: structured summaries, preservation, percentage thresholds ---

    /**
     * Check if auto-compaction should trigger based on percentage of model context window.
     * When PERCENTAGE_COMPACTION_ENABLED is true, triggers when total tokens exceed
     * the configured threshold percentage of the model's context limit.
     *
     * @param totalTokens - Current estimated token count
     * @param modelId - Model identifier for context limit lookup
     * @returns Whether compaction should be triggered
     */
    public shouldAutoCompact(totalTokens: number, modelId: string): boolean {
        const config = loadPromptCompactionConfig();
        if (!config.percentageCompactionEnabled) return false;

        const threshold = getCompactionThreshold(modelId, config.compactionThresholdPercent);
        return totalTokens > threshold;
    }

    /**
     * Get the percentage-based compaction threshold for a model.
     * Returns the token count at which compaction should trigger.
     */
    public getAutoCompactionThreshold(modelId: string): number {
        const config = loadPromptCompactionConfig();
        return getCompactionThreshold(modelId, config.compactionThresholdPercent);
    }

    /**
     * Compress conversation history using structured summaries.
     * Replaces the simple truncation approach with heuristic section extraction.
     * Only activates when STRUCTURED_SUMMARIES_ENABLED is true.
     *
     * @param messages - Conversation messages to compress
     * @param keepRecentCount - Number of recent messages to preserve verbatim
     * @returns Compressed messages array (summary + recent), or null if feature disabled
     */
    public compressWithStructuredSummary(
        messages: ConversationMessage[],
        keepRecentCount: number = 5,
    ): ConversationMessage[] | null {
        const config = loadPromptCompactionConfig();
        if (!config.structuredSummariesEnabled) return null;

        if (messages.length <= keepRecentCount) return messages;

        const cutoff = messages.length - keepRecentCount;
        const olderMessages = messages.slice(0, cutoff);
        const recentMessages = messages.slice(cutoff);

        const builder = StructuredSummaryBuilder.getInstance();
        const summary = builder.buildSummary(olderMessages);
        const summaryText = builder.formatAsPrompt(summary);

        const summaryMessage: ConversationMessage = {
            id: `structured-summary-${Date.now()}`,
            role: 'system',
            content: summaryText,
            timestamp: Date.now(),
            metadata: {
                contextLayer: 'system',
                messageType: 'system-notice',
                ephemeral: false,
                compactionSummary: true,
                messagesSummarized: olderMessages.length,
                summarySections: summary.sections,
            },
        };

        this.logger.info('Structured summary compression applied', {
            messagesBefore: messages.length,
            messagesAfter: recentMessages.length + 1,
            summarySections: summary.sections,
        });

        return [summaryMessage, ...recentMessages];
    }

    /**
     * Categorize messages by preservation priority for compaction.
     * Returns messages grouped into three tiers:
     *   - preserve: Must keep verbatim (task descriptions, errors, user directives)
     *   - summarize: Keep summary (tool results — name + status, compress body)
     *   - compress: Can freely compress (routine status updates, verbose outputs)
     */
    public categorizeByPreservation(messages: ConversationMessage[]): {
        preserve: ConversationMessage[];
        summarize: ConversationMessage[];
        compress: ConversationMessage[];
    } {
        const preserve: ConversationMessage[] = [];
        const summarize: ConversationMessage[] = [];
        const compress: ConversationMessage[] = [];

        for (const msg of messages) {
            const layer = msg.metadata?.contextLayer;
            const msgType = msg.metadata?.messageType;

            // Always preserve: task descriptions, error messages, user/task-assigner directives
            if (layer === 'task' || msgType === 'task-description') {
                preserve.push(msg);
            } else if (msg.role === 'user') {
                preserve.push(msg);
            } else if (msg.metadata?.isError === true) {
                preserve.push(msg);
            }
            // Summarize: tool results (keep name + status, compress body)
            else if (msg.role === 'tool' || layer === 'tool-result' || msgType === 'tool-result') {
                summarize.push(msg);
            }
            // Freely compress: everything else
            else {
                compress.push(msg);
            }
        }

        return { preserve, summarize, compress };
    }
}

// Note: Use ContextCompressionEngine.getInstance() to get the singleton instance
