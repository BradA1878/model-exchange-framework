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
 * InferenceParameterTools.ts
 *
 * MCP tools for dynamic inference parameter control.
 * Provides agents with the ability to request parameter adjustments
 * during task execution for metacognitive control over inference behavior.
 *
 * This system is architecture-independent - it works with any agent execution
 * pattern including ORPAR cognitive cycles, simple request-response agents,
 * and custom workflows.
 *
 * Key Tools:
 * - request_inference_params: Request parameter changes with governance
 * - reset_inference_params: Revert parameters to defaults
 * - get_current_params: Get current resolved parameters for a phase
 * - get_parameter_status: Get status of active parameter overrides
 * - get_available_models: List available models with cost information
 * - get_parameter_cost_analytics: Get cost analytics for parameter usage
 *
 * @see Feature 2: Inference Parameter Meta-Tool in requirements
 */

import { Logger } from '../../../utils/Logger';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { INFERENCE_PARAMETER_TOOLS } from '../../../constants/ToolNames';
import {
    OrparPhase,
    ParameterOverrideScope,
    ResetParameterScope,
    InferenceParameterRequest,
    InferenceParameterResponse
} from '../../../types/InferenceParameterTypes';
import {
    DEFAULT_PHASE_PROFILES,
    getPhaseProfile
} from '../../../constants/DefaultPhaseProfiles';
import { LlmProviderType } from '../LlmProviders';

const logger = new Logger('info', 'InferenceParameterTools', 'server');

/**
 * MCP Tool: request_inference_params
 *
 * Allows agents to request inference parameter modifications during task execution.
 * This enables metacognitive control - agents can recognize when their current
 * configuration is insufficient and petition for adjustment.
 *
 * This tool is architecture-independent and works with any agent execution pattern.
 *
 * @see TR-5: Tool Definition in requirements
 */
export const requestInferenceParamsTool = {
    name: 'request_inference_params',
    description: `Request inference parameter modifications for improved task performance.
Use this tool when you recognize that your current LLM configuration is insufficient for the task at hand.

Examples of when to use:
- Complex reasoning task needs more reasoning tokens
- Precision task needs lower temperature
- Creative task needs higher temperature
- Resource-intensive task needs a more capable model

The system will evaluate your request against governance constraints (budget limits,
rate limits, permissions) and return the approved parameters along with the previous
parameters for comparison.`,

    inputSchema: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                minLength: 1,
                description: 'Required explanation of why the parameter adjustment is needed. Be specific about the task requirement that exceeds current configuration.'
            },
            suggested: {
                type: 'object',
                description: 'Suggested parameter changes (all optional)',
                properties: {
                    model: {
                        type: 'string',
                        description: 'Requested model identifier (e.g., "anthropic/claude-sonnet-4-5")'
                    },
                    temperature: {
                        type: 'number',
                        minimum: 0,
                        maximum: 2,
                        description: 'Requested temperature (0.0-2.0). Lower = more deterministic, higher = more creative.'
                    },
                    reasoningTokens: {
                        type: 'number',
                        minimum: 0,
                        description: 'Requested reasoning token budget for extended thinking.'
                    },
                    maxOutputTokens: {
                        type: 'number',
                        minimum: 100,
                        description: 'Requested maximum output token limit.'
                    },
                    topP: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1,
                        description: 'Requested nucleus sampling parameter (0.0-1.0).'
                    }
                }
            },
            scope: {
                type: 'string',
                enum: ['next_call', 'session', 'task', 'current_phase'],
                default: 'next_call',
                description: 'How long the parameter override should persist. "next_call" applies to only the next LLM invocation, "session" persists for the remainder of the current session (until disconnect), "task" persists until task completion, "current_phase" persists through the current ORPAR phase (ORPAR agents only).'
            }
        },
        required: ['reason']
    },

    handler: async (
        input: {
            reason: string;
            suggested?: {
                model?: string;
                temperature?: number;
                reasoningTokens?: number;
                maxOutputTokens?: number;
                topP?: number;
            };
            scope?: ParameterOverrideScope;
        },
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            logger.info(`Parameter request from ${context.agentId}: ${input.reason}`);

            // Get the InferenceParameterService (lazy import to avoid circular dependencies)
            const { getInferenceParameterService } = await import(
                '../../../../server/socket/services/InferenceParameterService'
            );

            const service = getInferenceParameterService();

            // Determine current phase from context or default to 'observation'
            const phase: OrparPhase = (context.data?.phase as OrparPhase) || 'observation';
            const taskId = context.data?.taskId as string | undefined;

            // Build the request
            const request: InferenceParameterRequest = {
                reason: input.reason,
                suggested: input.suggested || {},
                scope: input.scope || 'next_call'
            };

            // Process the request through the service
            const response: InferenceParameterResponse = await service.processParameterRequest(
                context.agentId!,
                context.channelId!,
                taskId,
                phase,
                request
            );

            logger.info(
                `Parameter request ${response.status} for ${context.agentId}: ` +
                `model=${response.activeParams.model}, temp=${response.activeParams.temperature}`
            );

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    status: response.status,
                    activeParams: {
                        model: response.activeParams.model,
                        temperature: response.activeParams.temperature,
                        reasoningTokens: response.activeParams.reasoningTokens,
                        maxOutputTokens: response.activeParams.maxOutputTokens,
                        topP: response.activeParams.topP
                    },
                    previousParams: response.previousParams ? {
                        model: response.previousParams.model,
                        temperature: response.previousParams.temperature,
                        reasoningTokens: response.previousParams.reasoningTokens,
                        maxOutputTokens: response.previousParams.maxOutputTokens,
                        topP: response.previousParams.topP
                    } : undefined,
                    rationale: response.rationale,
                    costDelta: response.costDelta,
                    overrideId: response.overrideId,
                    expiresAt: response.expiresAt
                        ? new Date(response.expiresAt).toISOString()
                        : undefined
                }
            };

            return { content };
        } catch (error) {
            logger.error(`Failed to process parameter request: ${error}`);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    status: 'denied',
                    rationale: `Error processing request: ${error instanceof Error ? error.message : String(error)}`,
                    activeParams: null,
                    previousParams: null
                }
            };

            return { content };
        }
    }
};

/**
 * MCP Tool: get_current_params
 *
 * Get the current resolved parameters for a specific ORPAR phase.
 * Useful for agents to understand their current configuration before
 * deciding whether to request changes.
 */
export const getCurrentParamsTool = {
    name: 'get_current_params',
    description: `Get the current resolved inference parameters for a specific ORPAR phase.
Use this to understand your current configuration before deciding whether to request parameter changes.
Returns the effective parameters after applying all configuration hierarchy overrides.`,

    inputSchema: {
        type: 'object',
        properties: {
            phase: {
                type: 'string',
                enum: ['observation', 'reasoning', 'planning', 'action', 'reflection'],
                description: 'The ORPAR phase to get parameters for.'
            }
        },
        required: ['phase']
    },

    handler: async (
        input: { phase: OrparPhase },
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            // Get the InferenceParameterService
            const { getInferenceParameterService } = await import(
                '../../../../server/socket/services/InferenceParameterService'
            );

            const service = getInferenceParameterService();
            const taskId = context.data?.taskId as string | undefined;

            // Resolve current parameters
            const params = service.resolveParameters({
                agentId: context.agentId!,
                channelId: context.channelId!,
                phase: input.phase,
                taskId
            });

            // Also get the default profile for comparison
            const defaultProfile = getPhaseProfile(LlmProviderType.OPENROUTER, input.phase);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    phase: input.phase,
                    currentParams: {
                        model: params.model,
                        temperature: params.temperature,
                        reasoningTokens: params.reasoningTokens,
                        maxOutputTokens: params.maxOutputTokens,
                        topP: params.topP
                    },
                    defaultParams: {
                        model: defaultProfile.model,
                        temperature: defaultProfile.temperature,
                        reasoningTokens: defaultProfile.reasoningTokens,
                        maxOutputTokens: defaultProfile.maxOutputTokens,
                        topP: defaultProfile.topP
                    },
                    hasActiveOverride: JSON.stringify(params) !== JSON.stringify(defaultProfile)
                }
            };

            return { content };
        } catch (error) {
            logger.error(`Failed to get current params: ${error}`);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to get parameters: ${error instanceof Error ? error.message : String(error)}`
                }
            };

            return { content };
        }
    }
};

/**
 * MCP Tool: get_parameter_status
 *
 * Get status of active parameter overrides and request tracking.
 * Useful for understanding current parameter state and rate limit status.
 */
export const getParameterStatusTool = {
    name: 'get_parameter_status',
    description: `Get status of active parameter overrides and request tracking.
Use this to understand your current parameter override state and rate limit status
before making additional parameter change requests.`,

    inputSchema: {
        type: 'object',
        properties: {},
        required: []
    },

    handler: async (
        input: {},
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            // Get the InferenceParameterService
            const { getInferenceParameterService } = await import(
                '../../../../server/socket/services/InferenceParameterService'
            );

            const service = getInferenceParameterService();
            const stats = service.getStats();

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    serviceStats: {
                        activeOverrides: stats.activeOverrides,
                        requestTrackers: stats.requestTrackers,
                        agentConfigs: stats.agentConfigs,
                        channelDefaults: stats.channelDefaults,
                        usageMetricsCount: stats.usageMetrics
                    },
                    allPhaseProfiles: {
                        observation: DEFAULT_PHASE_PROFILES.observation,
                        reasoning: DEFAULT_PHASE_PROFILES.reasoning,
                        planning: DEFAULT_PHASE_PROFILES.planning,
                        action: DEFAULT_PHASE_PROFILES.action,
                        reflection: DEFAULT_PHASE_PROFILES.reflection
                    }
                }
            };

            return { content };
        } catch (error) {
            logger.error(`Failed to get parameter status: ${error}`);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to get status: ${error instanceof Error ? error.message : String(error)}`
                }
            };

            return { content };
        }
    }
};

/**
 * MCP Tool: get_available_models
 *
 * Get list of available models with their capabilities and cost tiers.
 * Helps agents make informed decisions when requesting model changes.
 */
export const getAvailableModelsTool = {
    name: 'get_available_models',
    description: `Get list of available models with their capabilities and cost tiers.
Use this to understand what models are available and their characteristics
before requesting a model change.`,

    inputSchema: {
        type: 'object',
        properties: {
            tier: {
                type: 'string',
                enum: ['ultra_cheap', 'budget', 'standard', 'premium', 'ultra_premium', 'all'],
                default: 'all',
                description: 'Filter models by cost tier.'
            }
        }
    },

    handler: async (
        input: { tier?: string },
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            const { MODEL_COST_ESTIMATES } = await import(
                '../../../constants/DefaultPhaseProfiles'
            );

            let models = Object.entries(MODEL_COST_ESTIMATES);

            // Filter by tier if specified
            if (input.tier && input.tier !== 'all') {
                models = models.filter(([_, info]) => info.tier === input.tier);
            }

            const modelList = models.map(([model, info]) => ({
                model,
                tier: info.tier,
                inputCostPer1k: info.inputCostPer1k,
                outputCostPer1k: info.outputCostPer1k,
                reasoningCostPer1k: info.reasoningCostPer1k || null,
                supportsReasoning: !!info.reasoningCostPer1k
            }));

            // Sort by tier and then by input cost
            const tierOrder = ['ultra_cheap', 'budget', 'standard', 'premium', 'ultra_premium'];
            modelList.sort((a, b) => {
                const tierDiff = tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier);
                if (tierDiff !== 0) return tierDiff;
                return a.inputCostPer1k - b.inputCostPer1k;
            });

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    models: modelList,
                    totalCount: modelList.length,
                    tiers: {
                        ultra_cheap: 'Under $0.10/1M tokens - fast, efficient models',
                        budget: 'Under $1.00/1M tokens - good balance of cost and capability',
                        standard: 'Under $5.00/1M tokens - capable models for complex tasks',
                        premium: 'Under $15.00/1M tokens - high-capability models',
                        ultra_premium: 'Most capable models - best for critical tasks'
                    }
                }
            };

            return { content };
        } catch (error) {
            logger.error(`Failed to get available models: ${error}`);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to get models: ${error instanceof Error ? error.message : String(error)}`
                }
            };

            return { content };
        }
    }
};

/**
 * MCP Tool: get_parameter_cost_analytics
 *
 * Get cost analytics for inference parameter usage.
 * Provides insights into cost patterns, model usage, and optimization opportunities.
 *
 * @see TR-11: Parameter Metrics in requirements
 */
export const getParameterCostAnalyticsTool = {
    name: 'get_parameter_cost_analytics',
    description: `Get cost analytics for inference parameter usage.
Provides insights into cost patterns by phase, model usage distribution,
and potential cost optimization opportunities.`,

    inputSchema: {
        type: 'object',
        properties: {
            timeRange: {
                type: 'string',
                enum: ['1h', '24h', '7d', '30d'],
                default: '24h',
                description: 'Time range for analytics.'
            },
            groupBy: {
                type: 'string',
                enum: ['phase', 'model', 'agent', 'hour'],
                default: 'phase',
                description: 'How to group the cost data.'
            }
        }
    },

    handler: async (
        input: { timeRange?: string; groupBy?: string },
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            // Get the InferenceParameterService
            const { getInferenceParameterService } = await import(
                '../../../../server/socket/services/InferenceParameterService'
            );

            const service = getInferenceParameterService();

            // Calculate time range
            const timeRangeMs: Record<string, number> = {
                '1h': 3600000,
                '24h': 86400000,
                '7d': 604800000,
                '30d': 2592000000
            };

            const endTime = Date.now();
            const startTime = endTime - (timeRangeMs[input.timeRange || '24h'] || 86400000);

            // Get usage metrics
            const metrics = service.getUsageMetrics({
                startTime,
                endTime
            });

            // Calculate aggregations based on groupBy
            const groupBy = input.groupBy || 'phase';
            const aggregations: Record<string, {
                count: number;
                totalCost: number;
                avgCost: number;
                avgLatency: number;
                successRate: number;
            }> = {};

            for (const metric of metrics) {
                let key: string;
                switch (groupBy) {
                    case 'phase':
                        key = metric.phase;
                        break;
                    case 'model':
                        key = metric.profile.model;
                        break;
                    case 'agent':
                        key = 'all'; // Would need agentId in metrics
                        break;
                    case 'hour':
                        key = new Date(metric.timestamp).getHours().toString().padStart(2, '0') + ':00';
                        break;
                    default:
                        key = 'unknown';
                }

                if (!aggregations[key]) {
                    aggregations[key] = {
                        count: 0,
                        totalCost: 0,
                        avgCost: 0,
                        avgLatency: 0,
                        successRate: 0
                    };
                }

                aggregations[key].count++;
                aggregations[key].totalCost += metric.actualCost;
                aggregations[key].avgLatency += metric.latencyMs;
                if (metric.success) {
                    aggregations[key].successRate += 1;
                }
            }

            // Calculate averages
            for (const key of Object.keys(aggregations)) {
                const agg = aggregations[key];
                agg.avgCost = agg.count > 0 ? agg.totalCost / agg.count : 0;
                agg.avgLatency = agg.count > 0 ? agg.avgLatency / agg.count : 0;
                agg.successRate = agg.count > 0 ? agg.successRate / agg.count : 0;
            }

            // Calculate totals
            const totalCost = Object.values(aggregations).reduce((sum, a) => sum + a.totalCost, 0);
            const totalExecutions = Object.values(aggregations).reduce((sum, a) => sum + a.count, 0);
            const avgCostPerExecution = totalExecutions > 0 ? totalCost / totalExecutions : 0;

            // Identify optimization opportunities
            const optimizationTips: string[] = [];

            // Check for expensive phases
            if (aggregations['reasoning'] && aggregations['reasoning'].avgCost > 0.01) {
                optimizationTips.push('Consider reducing reasoning tokens for simpler reasoning tasks');
            }
            if (aggregations['reflection'] && aggregations['reflection'].avgCost > 0.01) {
                optimizationTips.push('Reflection phase costs could be reduced with a lighter model');
            }

            // Check for low success rates
            for (const [key, agg] of Object.entries(aggregations)) {
                if (agg.successRate < 0.8 && agg.count > 5) {
                    optimizationTips.push(`Low success rate (${(agg.successRate * 100).toFixed(1)}%) for ${key} - consider parameter adjustments`);
                }
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    timeRange: input.timeRange || '24h',
                    groupBy,
                    summary: {
                        totalExecutions,
                        totalCost: `$${totalCost.toFixed(4)}`,
                        avgCostPerExecution: `$${avgCostPerExecution.toFixed(6)}`
                    },
                    breakdown: Object.entries(aggregations).map(([key, agg]) => ({
                        [groupBy]: key,
                        executions: agg.count,
                        totalCost: `$${agg.totalCost.toFixed(4)}`,
                        avgCost: `$${agg.avgCost.toFixed(6)}`,
                        avgLatencyMs: Math.round(agg.avgLatency),
                        successRate: `${(agg.successRate * 100).toFixed(1)}%`
                    })),
                    optimizationTips
                }
            };

            return { content };
        } catch (error) {
            logger.error(`Failed to get cost analytics: ${error}`);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to get analytics: ${error instanceof Error ? error.message : String(error)}`
                }
            };

            return { content };
        }
    }
};

/**
 * MCP Tool: reset_inference_params
 *
 * Allows agents to reset inference parameters to their defaults.
 * Use this to revert any active parameter overrides and return to
 * the default configuration for the agent/channel.
 */
export const resetInferenceParamsTool = {
    name: 'reset_inference_params',
    description: `Reset inference parameters to defaults.
Use this to revert any active parameter overrides and return to
the default configuration for your agent/channel.

This is useful when:
- You want to start fresh with default parameters
- A previous override is no longer appropriate
- You need to clear session or task-specific overrides`,

    inputSchema: {
        type: 'object',
        properties: {
            scope: {
                type: 'string',
                enum: ['all', 'session', 'task'],
                default: 'all',
                description: 'Which overrides to reset. "all" resets all active overrides, "session" resets only session-scoped overrides, "task" resets only task-scoped overrides for the current task.'
            },
            taskId: {
                type: 'string',
                description: 'Task ID (required when scope is "task", optional otherwise).'
            }
        }
    },

    handler: async (
        input: {
            scope?: ResetParameterScope;
            taskId?: string;
        },
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            logger.info(`Parameter reset request from ${context.agentId} with scope ${input.scope || 'all'}`);

            // Get the InferenceParameterService
            const { getInferenceParameterService } = await import(
                '../../../../server/socket/services/InferenceParameterService'
            );

            const service = getInferenceParameterService();
            const scope = input.scope || 'all';
            const taskId = input.taskId || (context.data?.taskId as string | undefined);

            // Validate taskId is provided when scope is 'task'
            if (scope === 'task' && !taskId) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        message: 'taskId is required when scope is "task"',
                        resetCount: 0
                    }
                };
                return { content };
            }

            // Reset parameters
            const result = service.resetParameters(
                context.agentId!,
                context.channelId!,
                scope,
                taskId
            );

            logger.info(`Parameter reset completed for ${context.agentId}: ${result.message}`);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    message: result.message,
                    resetCount: result.resetCount,
                    scope
                }
            };

            return { content };
        } catch (error) {
            logger.error(`Failed to reset parameters: ${error}`);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    message: `Error resetting parameters: ${error instanceof Error ? error.message : String(error)}`,
                    resetCount: 0
                }
            };

            return { content };
        }
    }
};

/**
 * Export all inference parameter tools
 */
export const inferenceParameterTools = [
    requestInferenceParamsTool,
    resetInferenceParamsTool,
    getCurrentParamsTool,
    getParameterStatusTool,
    getAvailableModelsTool,
    getParameterCostAnalyticsTool
];

// Export individual tools for selective imports
export {
    requestInferenceParamsTool as request_inference_params,
    resetInferenceParamsTool as reset_inference_params,
    getCurrentParamsTool as get_current_params,
    getParameterStatusTool as get_parameter_status,
    getAvailableModelsTool as get_available_models,
    getParameterCostAnalyticsTool as get_parameter_cost_analytics
};
