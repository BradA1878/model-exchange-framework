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
 * MXP Token Optimizer
 * 
 * Provides intelligent token reduction for MXF messages using multiple optimization strategies.
 * This is a foundational implementation ready for integration with existing MXF services.
 */

import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { createStrictValidator } from '../utils/validation';
import { ChannelMessage, AgentMessage } from '../schemas/MessageSchemas';
import { 
    MxpConfig, 
    TokenOptimizationStrategy, 
    MxpOptimizationResult 
} from '../types/MxpTypes';
import { MxpConfigManager } from './MxpConfigManager';
import { ContextCompressionEngine, CompressedContext } from './ContextCompressionEngine';

/**
 * MXP Token Optimizer - Foundational Implementation
 * Ready for integration with existing MXF services
 */
export class MxpTokenOptimizer {
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('MxpTokenOptimizer');
    private readonly eventBus = EventBus.server;
    
    // Performance tracking
    private optimizationStats = {
        totalOptimizations: 0,
        totalTokensSaved: 0,
        averageCompressionRatio: 0
    };

    constructor(private config: MxpConfig) {
        this.logger = new Logger('info', 'MxpTokenOptimizer', 'server');
    }

    /**
     * Optimize a message for token reduction with configuration-aware processing
     * Respects channel and agent-level MXP settings
     */
    public async optimizeMessage(
        message: ChannelMessage | AgentMessage,
        options: {
            strategy?: TokenOptimizationStrategy;
            compressionLevel?: 'light' | 'standard' | 'aggressive';
            channelId?: string;
            agentId?: string;
        } = {}
    ): Promise<MxpOptimizationResult> {
        this.validator.assertIsObject(message, 'Message must be a valid object');
        
        const originalSize = JSON.stringify(message).length;
        const channelId = options.channelId || message.context?.channelId || 'default';
        const agentId = options.agentId || message.senderId || 'system';
        
        
        // Check if MXP token optimization is enabled for this channel/agent combination
        const isTokenOptimizationEnabled = MxpConfigManager.getInstance().isFeatureEnabled(
            channelId, 
            'tokenOptimization', 
            agentId
        );
        
        if (!isTokenOptimizationEnabled) {
            return {
                operationId: `mxp_disabled_${Date.now()}`,
                timestamp: Date.now(),
                agentId: agentId as any,
                channelId: channelId as any,
                tokenOptimization: {
                    originalTokens: originalSize,
                    optimizedTokens: originalSize,
                    reductionPercentage: 0,
                    strategy: 'disabled_by_config'
                },
                performance: {
                    processingTimeMs: 0.1,
                    memoryUsageMb: 0.01,
                    cpuUtilization: 0.001
                }
            };
        }
        
        // Check if the specific strategy is enabled
        const strategy = options.strategy || 'context_compression';
        const strategyKey = this.mapStrategyToConfigKey(strategy);
        const isStrategyEnabled = MxpConfigManager.getInstance().isTokenStrategyEnabled(
            channelId,
            strategyKey,
            agentId
        );
        
        if (!isStrategyEnabled) {
            return {
                operationId: `mxp_strategy_disabled_${Date.now()}`,
                timestamp: Date.now(),
                agentId: agentId as any,
                channelId: channelId as any,
                tokenOptimization: {
                    originalTokens: originalSize,
                    optimizedTokens: originalSize,
                    reductionPercentage: 0,
                    strategy: `${strategy}_disabled`
                },
                performance: {
                    processingTimeMs: 0.1,
                    memoryUsageMb: 0.01,
                    cpuUtilization: 0.001
                }
            };
        }
        
        // Update statistics
        this.optimizationStats.totalOptimizations++;
        
        // Get effective configuration for this channel/agent
        const effectiveConfig = MxpConfigManager.getInstance().getEffectiveConfig(channelId, agentId);
        
        // Apply optimization based on configuration
        const result: MxpOptimizationResult = {
            operationId: `mxp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            agentId: agentId as any,
            channelId: channelId as any,
            
            tokenOptimization: {
                originalTokens: originalSize,
                optimizedTokens: originalSize, // Will be enhanced with actual optimization
                reductionPercentage: 0,
                strategy: strategy
            },
            
            performance: {
                processingTimeMs: 1,
                memoryUsageMb: 0.1,
                cpuUtilization: 0.01
            }
        };
        
        
        return result;
    }

    /**
     * Apply context compression to a conversation history
     * Integrates with ContextCompressionEngine for intelligent compression
     */
    public async compressConversationContext(
        messages: (ChannelMessage | AgentMessage)[],
        options: {
            channelId: string;
            agentId?: string;
            windowSize?: number;
            compressionRatio?: number;
            preserveKeywords?: string[];
        }
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
            return null; // Return null when disabled to avoid processing
        }


        try {
            // Use ContextCompressionEngine for intelligent compression
            const compressed = await ContextCompressionEngine.getInstance().compressConversation(messages, {
                channelId: options.channelId,
                agentId: options.agentId,
                windowSize: options.windowSize || 5,
                compressionRatio: options.compressionRatio || 0.3,
                preserveKeywords: options.preserveKeywords || [],
                useContextReferences: true
            });

            if (compressed) {
                // Update our internal statistics
                this.optimizationStats.totalOptimizations++;
                this.optimizationStats.totalTokensSaved += (compressed.originalTokens - compressed.compressedTokens);
                
                // Recalculate average compression ratio
                const totalProcessed = this.optimizationStats.totalOptimizations;
                this.optimizationStats.averageCompressionRatio = 
                    ((this.optimizationStats.averageCompressionRatio * (totalProcessed - 1)) + compressed.ratio) / totalProcessed;

            }

            return compressed;

        } catch (error) {
            this.logger.error('Context compression failed', {
                error: error instanceof Error ? error.message : String(error),
                channelId: options.channelId,
                messageCount: messages.length
            });
            return null; // Fail gracefully
        }
    }
    
    /**
     * Get optimization statistics
     */
    public getOptimizationStats(): {
        totalOptimizations: number;
        totalTokensSaved: number;
        averageCompressionRatio: number;
    } {
        return { ...this.optimizationStats };
    }

    /**
     * Map TokenOptimizationStrategy to configuration key names
     */
    private mapStrategyToConfigKey(strategy: TokenOptimizationStrategy): 
        'contextCompression' | 'promptOptimization' | 'templateMatching' | 'entityDeduplication' | 'toolSchemaReduction' | 'conversationSummarization' {
        switch (strategy) {
            case 'context_compression':
                return 'contextCompression';
            case 'prompt_optimization':
                return 'promptOptimization';
            case 'template_matching':
                return 'templateMatching';
            case 'entity_deduplication':
                return 'entityDeduplication';
            case 'tool_schema_reduction':
                return 'toolSchemaReduction';
            case 'conversation_summarization':
                return 'conversationSummarization';
            default:
                return 'contextCompression'; // Default fallback
        }
    }
}
