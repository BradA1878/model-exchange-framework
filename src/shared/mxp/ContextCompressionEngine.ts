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
 * MXP 2.0 Context Compression Engine
 * 
 * Implements intelligent context compression using SystemLLM and existing MXF services.
 * Features sliding window compression, context references, and semantic deduplication.
 * Only activates when MXP token optimization is enabled.
 */

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { ChannelMessage, AgentMessage } from '../schemas/MessageSchemas';
import { createMxpTokenOptimizationEventPayload } from '../schemas/EventPayloadSchema';
// EntityTypes imported from interfaces
type ChannelId = string;
type AgentId = string;
import { MxpConfigManager } from './MxpConfigManager';
import crypto from 'crypto';

export interface CompressedContext {
    recent: any[];                    // Uncompressed recent messages
    compressed: string;               // Compressed older content
    originalTokens: number;
    compressedTokens: number;
    ratio: number;
    contextReferences: string[];      // Reference IDs for stored context
}

export interface CompressionOptions {
    windowSize?: number;              // Full context window (default: 5 messages)
    compressionRatio?: number;        // Target compression (default: 0.3 = 70% reduction)
    preserveKeywords?: string[];      // Important terms to preserve
    useContextReferences?: boolean;   // Store large contexts as references
    channelId: string;
    agentId?: string;
}

export class ContextCompressionEngine {
    private static instance: ContextCompressionEngine | null = null;
    
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('ContextCompressionEngine');
    private contextCache = new Map<string, any>(); // LRU cache for compressed contexts
    private readonly maxCacheSize = 100;

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
     * Compress conversation history using intelligent sliding window approach
     * Only processes if context compression is enabled for the channel/agent
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

        const startTime = Date.now();
        const windowSize = options.windowSize || 5;
        const targetRatio = options.compressionRatio || 0.3;


        // Sliding window logic: keep recent messages, compress older ones
        const recentMessages = messages.slice(-windowSize);
        const olderMessages = messages.slice(0, -windowSize);

        // If no older messages, no compression needed
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
        const actualCompressionRatio = compressionSettings?.compressionRatio || targetRatio;

        try {
            // Apply semantic deduplication if enabled
            let processedOlderMessages = olderMessages;
            
            const isDeduplicationEnabled = MxpConfigManager.getInstance().isTokenStrategyEnabled(
                options.channelId,
                'entityDeduplication',
                options.agentId
            );

            if (isDeduplicationEnabled) {
                processedOlderMessages = await this.applySemanticDeduplication(olderMessages);
            }

            // Create context reference if messages are too large
            let compressed: string;
            let contextReferences: string[] = [];

            const shouldUseReferences = options.useContextReferences && 
                compressionSettings?.referenceMode &&
                processedOlderMessages.length > 20; // Reference mode for > 20 messages

            if (shouldUseReferences) {
                const contextRef = await this.createContextReference(
                    options.channelId,
                    processedOlderMessages
                );
                contextReferences.push(contextRef);
                compressed = `[Context Reference: ${contextRef} - ${processedOlderMessages.length} earlier messages]`;
            } else {
                // Use SystemLLM for intelligent summarization (only if enabled)
                compressed = await this.compressWithSystemLLM(
                    processedOlderMessages,
                    actualCompressionRatio,
                    options.preserveKeywords || []
                );
            }

            const originalTokens = this.estimateTokens(olderMessages);
            const compressedTokens = this.estimateTokens([{ content: compressed }]);
            const actualRatio = compressedTokens / originalTokens;

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

            const result: CompressedContext = {
                recent: recentMessages,
                compressed,
                originalTokens,
                compressedTokens,
                ratio: actualRatio,
                contextReferences
            };


            return result;

        } catch (error) {
            this.logger.error('Context compression failed', { 
                error: error instanceof Error ? error.message : String(error),
                channelId: options.channelId,
                messageCount: messages.length
            });
            
            // Fallback: return recent messages only
            return {
                recent: recentMessages,
                compressed: `[Compression failed, showing recent ${windowSize} messages only]`,
                originalTokens: this.estimateTokens(messages),
                compressedTokens: this.estimateTokens(recentMessages),
                ratio: recentMessages.length / messages.length,
                contextReferences: []
            };
        }
    }

    /**
     * Create short reference ID for large context blocks using existing memory system
     */
    private async createContextReference(channelId: string, context: any[]): Promise<string> {
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
     * Apply semantic deduplication to remove similar messages
     * This is a simplified version - in full implementation would use PatternLearningService
     */
    private async applySemanticDeduplication(messages: any[]): Promise<any[]> {
        if (messages.length <= 1) return messages;

        const deduplicated: any[] = [];
        const seenContent = new Set<string>();

        for (const message of messages) {
            // Extract content from different possible structures
            let contentText = '';
            if (typeof message.content === 'string') {
                contentText = message.content;
            } else if (message.content?.data) {
                contentText = message.content.data;
            } else if (message.directContent) {
                contentText = message.directContent;
            } else {
                // Fallback to message itself as string
                contentText = JSON.stringify(message);
            }

            // Simple content-based deduplication (in full implementation would use semantic similarity)
            const normalizedContent = this.normalizeContent(contentText);
            const contentHash = crypto.createHash('md5').update(normalizedContent).digest('hex').substring(0, 8);
            
            if (!seenContent.has(contentHash)) {
                seenContent.add(contentHash);
                deduplicated.push(message);
            } else {
            }
        }

        return deduplicated;
    }

    /**
     * Compress content using SystemLLM (placeholder - integrates with existing SystemLlmService)
     */
    private async compressWithSystemLLM(
        messages: any[], 
        compressionRatio: number,
        preserveKeywords: string[]
    ): Promise<string> {
        // In full implementation, this would call SystemLlmService.optimizeContextForMxp()
        // For now, return a simple summary
        
        const totalContent = messages.map(m => {
            // Extract content from different possible structures
            let contentText = '';
            if (typeof m.content === 'string') {
                contentText = m.content;
            } else if (m.content?.data) {
                contentText = m.content.data;
            } else if (m.directContent) {
                contentText = m.directContent;
            } else {
                contentText = 'unknown content';
            }
            return `${m.senderId}: ${contentText}`;
        }).join('\n');
        
        const targetLength = Math.floor(totalContent.length * compressionRatio);
        
        // Simple truncation with ellipsis (placeholder for SystemLLM integration)
        if (totalContent.length <= targetLength) {
            return totalContent;
        }
        
        const compressed = totalContent.substring(0, targetLength - 3) + '...';
        
        // Ensure preserved keywords are included
        if (preserveKeywords.length > 0) {
            const keywordSection = `\nKey terms: ${preserveKeywords.join(', ')}`;
            return compressed + keywordSection;
        }
        
        return compressed;
    }

    /**
     * Normalize message content for deduplication
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
     * Get compression statistics for monitoring
     */
    public getCompressionStats(): {
        totalCompressions: number;
        averageCompressionRatio: number;
        cacheSize: number;
        contextReferencesCreated: number;
    } {
        return {
            totalCompressions: 0, // Would be tracked in full implementation
            averageCompressionRatio: 0.3,
            cacheSize: this.contextCache.size,
            contextReferencesCreated: this.contextCache.size
        };
    }

    /**
     * Clear the context cache (useful for testing or memory management)
     */
    public clearCache(): void {
        this.contextCache.clear();
    }
}

// Note: Use ContextCompressionEngine.getInstance() to get the singleton instance
