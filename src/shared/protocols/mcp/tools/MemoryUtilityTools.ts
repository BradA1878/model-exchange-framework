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
 * Memory Utility Learning System (MULS) Tools
 *
 * Tools for viewing and configuring the utility-based memory retrieval system.
 * These tools allow agents to:
 * - View Q-value analytics and top-performing memories
 * - Configure lambda values for utility vs similarity weighting
 * - Monitor convergence and learning progress
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { Logger } from '../../../utils/Logger';
import { QValueManager } from '../../../services/QValueManager';
import { UtilityScorerService } from '../../../services/UtilityScorerService';
import { RewardSignalProcessor } from '../../../services/RewardSignalProcessor';
import { OrparPhase, PhaseLambdaConfig } from '../../../types/MemoryUtilityTypes';

const logger = new Logger('info', 'MemoryUtilityTools', 'server');

/**
 * View Q-value analytics and distributions
 */
export const memory_qvalue_analytics: McpToolDefinition = {
    name: 'memory_qvalue_analytics',
    description: 'View Q-value analytics for the Memory Utility Learning System (MULS). Shows distribution statistics, top-performing memories, convergence metrics, and reward history. Use this to understand which memories are most useful for task completion.',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            agentId: {
                type: 'string',
                description: 'Optional: Filter analytics to a specific agent. If omitted, shows global analytics.'
            },
            includeHistory: {
                type: 'boolean',
                description: 'Include Q-value history statistics for trend analysis',
                default: false
            },
            topN: {
                type: 'number',
                description: 'Number of top-performing memories to include (default: 10)',
                default: 10,
                minimum: 1,
                maximum: 50
            }
        },
        required: []
    },
    examples: [
        {
            input: {},
            output: {
                success: true,
                enabled: true,
                statistics: {
                    mean: 0.52,
                    stdDev: 0.15,
                    min: 0.1,
                    max: 0.95,
                    count: 150
                },
                topPerformers: [
                    { memoryId: 'mem-001', qValue: 0.95, retrievalCount: 45 }
                ],
                convergence: {
                    isConverging: true,
                    stableMemoryCount: 120
                }
            },
            description: 'Get global Q-value analytics'
        },
        {
            input: {
                agentId: 'agent-123',
                topN: 5,
                includeHistory: true
            },
            output: {
                success: true,
                enabled: true,
                statistics: {
                    mean: 0.58,
                    stdDev: 0.12,
                    min: 0.25,
                    max: 0.92,
                    count: 35
                }
            },
            description: 'Get agent-specific analytics with history'
        }
    ],
    handler: async (input: any, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const qValueManager = QValueManager.getInstance();
            const rewardProcessor = RewardSignalProcessor.getInstance();

            // Check if MULS is enabled
            if (!qValueManager.isEnabled()) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: true,
                        enabled: false,
                        message: 'Memory Utility Learning System (MULS) is disabled. Set MEMORY_UTILITY_LEARNING_ENABLED=true to enable.',
                        config: qValueManager.getConfig()
                    }
                };
                return { content };
            }

            // Get analytics
            const analytics = qValueManager.getAnalytics(input.agentId);
            const cacheStats = qValueManager.getCacheStats();
            const trackingStats = rewardProcessor.getTrackingStats();

            // Build response
            const response: Record<string, any> = {
                success: true,
                enabled: true,
                statistics: analytics.statistics,
                topPerformers: analytics.topPerformers.slice(0, input.topN || 10),
                convergence: analytics.convergence,
                rewardDistribution: analytics.rewardDistribution,
                cache: cacheStats,
                tracking: trackingStats
            };

            if (input.agentId) {
                response.agentId = input.agentId;
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: response
            };
            return { content };
        } catch (error) {
            logger.error('[memory_qvalue_analytics] Error:', error);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

/**
 * Get or set MULS configuration
 */
export const memory_utility_config: McpToolDefinition = {
    name: 'memory_utility_config',
    description: 'Get or set Memory Utility Learning System (MULS) configuration. Configure lambda values for balancing similarity vs utility scoring, learning rate for Q-value updates, and phase-specific lambda values for ORPAR phases.',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['get', 'set'],
                description: 'Whether to get current config or set new values',
                default: 'get'
            },
            lambda: {
                type: 'number',
                description: 'Global lambda value for utility weighting (0=pure similarity, 1=pure utility). Only used when action=set.',
                minimum: 0,
                maximum: 1
            },
            learningRate: {
                type: 'number',
                description: 'Learning rate for Q-value EMA updates (0.01-0.5). Only used when action=set.',
                minimum: 0.01,
                maximum: 0.5
            },
            phaseLambdas: {
                type: 'object',
                description: 'Phase-specific lambda overrides for ORPAR phases. Only used when action=set.',
                properties: {
                    observation: {
                        type: 'number',
                        description: 'Lambda for OBSERVATION phase (default: 0.2 - prioritize semantic accuracy)',
                        minimum: 0,
                        maximum: 1
                    },
                    reasoning: {
                        type: 'number',
                        description: 'Lambda for REASONING phase (default: 0.5 - balance explore/exploit)',
                        minimum: 0,
                        maximum: 1
                    },
                    planning: {
                        type: 'number',
                        description: 'Lambda for PLANNING phase (default: 0.7 - exploit proven patterns)',
                        minimum: 0,
                        maximum: 1
                    },
                    action: {
                        type: 'number',
                        description: 'Lambda for ACTION phase (default: 0.3 - stay grounded for tools)',
                        minimum: 0,
                        maximum: 1
                    },
                    reflection: {
                        type: 'number',
                        description: 'Lambda for REFLECTION phase (default: 0.6 - favor good assessment memories)',
                        minimum: 0,
                        maximum: 1
                    }
                }
            },
            rewardMapping: {
                type: 'object',
                description: 'Reward values for different task outcomes. Only used when action=set.',
                properties: {
                    success: {
                        type: 'number',
                        description: 'Reward for successful task completion (default: 1.0)'
                    },
                    failure: {
                        type: 'number',
                        description: 'Reward (penalty) for task failure (default: -1.0)'
                    },
                    partial: {
                        type: 'number',
                        description: 'Reward for partial completion (default: 0.3)'
                    },
                    timeout: {
                        type: 'number',
                        description: 'Reward (penalty) for timeout (default: -0.5)'
                    }
                }
            }
        },
        required: []
    },
    examples: [
        {
            input: { action: 'get' },
            output: {
                success: true,
                config: {
                    enabled: true,
                    lambda: 0.5,
                    learningRate: 0.1,
                    phaseLambdas: {
                        observation: 0.2,
                        reasoning: 0.5,
                        planning: 0.7,
                        action: 0.3,
                        reflection: 0.6
                    }
                }
            },
            description: 'Get current MULS configuration'
        },
        {
            input: {
                action: 'set',
                lambda: 0.6,
                phaseLambdas: {
                    planning: 0.8
                }
            },
            output: {
                success: true,
                message: 'Configuration updated',
                config: {
                    lambda: 0.6,
                    phaseLambdas: { planning: 0.8 }
                }
            },
            description: 'Update lambda values'
        }
    ],
    handler: async (input: any, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const qValueManager = QValueManager.getInstance();
            const utilityScorer = UtilityScorerService.getInstance();
            const rewardProcessor = RewardSignalProcessor.getInstance();

            const action = input.action || 'get';

            if (action === 'get') {
                // Return current configuration
                const qConfig = qValueManager.getConfig();
                const scorerConfig = utilityScorer.getConfig();
                const rewardMapping = rewardProcessor.getRewardMapping();
                const phaseLambdas = utilityScorer.getPhaseLambdas();

                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: true,
                        config: {
                            enabled: qConfig.enabled,
                            lambda: scorerConfig.lambda,
                            learningRate: qConfig.learningRate,
                            defaultQValue: qConfig.defaultQValue,
                            maxCandidates: qConfig.maxCandidates,
                            maxResults: qConfig.maxResults,
                            similarityThreshold: qConfig.similarityThreshold,
                            normalizationMethod: qConfig.normalizationMethod,
                            phaseLambdas,
                            rewardMapping
                        }
                    }
                };
                return { content };
            } else if (action === 'set') {
                // Update configuration
                const updates: Record<string, any> = {};
                const scorerUpdates: Record<string, any> = {};

                if (input.lambda !== undefined) {
                    utilityScorer.setLambda(input.lambda, 'global');
                    updates.lambda = input.lambda;
                }

                if (input.learningRate !== undefined) {
                    qValueManager.updateConfig({ learningRate: input.learningRate });
                    updates.learningRate = input.learningRate;
                }

                if (input.phaseLambdas) {
                    for (const [phase, lambda] of Object.entries(input.phaseLambdas)) {
                        if (typeof lambda === 'number' && lambda >= 0 && lambda <= 1) {
                            utilityScorer.setLambda(lambda, phase as OrparPhase);
                            if (!updates.phaseLambdas) updates.phaseLambdas = {};
                            updates.phaseLambdas[phase] = lambda;
                        }
                    }
                }

                if (input.rewardMapping) {
                    rewardProcessor.setRewardMapping(input.rewardMapping);
                    updates.rewardMapping = input.rewardMapping;
                }

                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: true,
                        message: 'Configuration updated',
                        updates,
                        currentConfig: {
                            lambda: utilityScorer.getLambda('global'),
                            learningRate: qValueManager.getConfig().learningRate,
                            phaseLambdas: utilityScorer.getPhaseLambdas(),
                            rewardMapping: rewardProcessor.getRewardMapping()
                        }
                    }
                };
                return { content };
            } else {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        error: `Invalid action: ${action}. Use 'get' or 'set'.`
                    }
                };
                return { content };
            }
        } catch (error) {
            logger.error('[memory_utility_config] Error:', error);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

/**
 * Manually inject a reward for a specific memory
 */
export const memory_inject_reward: McpToolDefinition = {
    name: 'memory_inject_reward',
    description: 'Manually inject a reward signal for a specific memory. Use this to provide explicit feedback about a memory\'s usefulness. Positive rewards increase Q-value, negative rewards decrease it.',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            memoryId: {
                type: 'string',
                description: 'The ID of the memory to reward'
            },
            reward: {
                type: 'number',
                description: 'Reward value to inject (-1.0 to 1.0). Positive = helpful, Negative = unhelpful',
                minimum: -1.0,
                maximum: 1.0
            },
            reason: {
                type: 'string',
                description: 'Reason for the reward (for logging and analytics)'
            }
        },
        required: ['memoryId', 'reward', 'reason']
    },
    examples: [
        {
            input: {
                memoryId: 'mem-abc123',
                reward: 0.8,
                reason: 'This memory provided crucial context for solving the bug'
            },
            output: {
                success: true,
                memoryId: 'mem-abc123',
                newQValue: 0.65
            },
            description: 'Reward a helpful memory'
        },
        {
            input: {
                memoryId: 'mem-xyz789',
                reward: -0.5,
                reason: 'This memory was misleading and caused confusion'
            },
            output: {
                success: true,
                memoryId: 'mem-xyz789',
                newQValue: 0.35
            },
            description: 'Penalize an unhelpful memory'
        }
    ],
    handler: async (input: any, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const rewardProcessor = RewardSignalProcessor.getInstance();

            if (!rewardProcessor.isEnabled()) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        error: 'Memory Utility Learning System (MULS) is disabled. Set MEMORY_UTILITY_LEARNING_ENABLED=true to enable.'
                    }
                };
                return { content };
            }

            // Pass agent and channel context from the tool handler
            const result = await rewardProcessor.injectReward(
                input.memoryId,
                input.reward,
                input.reason,
                context.agentId,
                context.channelId
            );

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: result.success,
                    memoryId: result.memoryId,
                    newQValue: result.newQValue,
                    error: result.error
                }
            };
            return { content };
        } catch (error) {
            logger.error('[memory_inject_reward] Error:', error);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

/**
 * Export all Memory Utility tools
 */
export const MemoryUtilityTools: McpToolDefinition[] = [
    memory_qvalue_analytics,
    memory_utility_config,
    memory_inject_reward
];

export default MemoryUtilityTools;
