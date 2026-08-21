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
 * Memory Utility Learning System (MULS) Tools
 *
 * Agent-facing boundaries for the utility-based memory retrieval system.
 * The current backing store is process-global and does not retain authoritative
 * agent/channel ownership, so analytics, configuration, and reward mutation
 * fail closed until a tenant-scoped persistence contract exists.
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes.js';
import { Logger } from '../../../utils/Logger.js';

const logger = new Logger('info', 'MemoryUtilityTools', 'server');

interface MemoryUtilityIdentity {
    agentId: string;
    channelId: string;
}

const requireMemoryUtilityIdentity = (
    context: McpToolHandlerContext
): MemoryUtilityIdentity => {
    if (typeof context.agentId !== 'string' || context.agentId.trim().length === 0 ||
        typeof context.channelId !== 'string' || context.channelId.trim().length === 0) {
        throw new Error('Authenticated agentId and channelId are required for Memory Utility tools');
    }
    return {
        agentId: context.agentId.trim(),
        channelId: context.channelId.trim()
    };
};

const requireInputRecord = (input: unknown): Record<string, unknown> => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('input must be an object');
    }
    return input as Record<string, unknown>;
};

const unavailableResult = (code: string, error: string): McpToolHandlerResult => ({
    content: {
        type: 'application/json',
        data: { success: false, code, error }
    }
});

/**
 * View Q-value analytics and distributions
 */
export const memory_qvalue_analytics: McpToolDefinition = {
    name: 'memory_qvalue_analytics',
    description: 'Request agent-scoped MULS analytics. This fails closed until utility storage can enforce authoritative agent and channel ownership.',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            agentId: {
                type: 'string',
                description: 'Optional self assertion. It must match the authenticated agent.'
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
                success: false,
                code: 'MULS_AGENT_ANALYTICS_UNAVAILABLE'
            },
            description: 'Agent analytics fail closed while the backing store is process-global'
        },
        {
            input: {
                agentId: 'another-agent',
                topN: 5,
                includeHistory: true
            },
            output: {
                success: false,
                code: 'MULS_ANALYTICS_SCOPE_DENIED'
            },
            description: 'An agent cannot request another agent identity\'s analytics'
        }
    ],
    handler: async (input: unknown, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const identity = requireMemoryUtilityIdentity(context);
            const request = requireInputRecord(input);
            if (request.agentId !== undefined && request.agentId !== identity.agentId) {
                return unavailableResult(
                    'MULS_ANALYTICS_SCOPE_DENIED',
                    'An agent may request analytics only for its authenticated identity'
                );
            }

            // QValueManager's in-memory cache is process-global and does not retain
            // authoritative agent/channel ownership for every entry. Returning its
            // apparent "agent" view would therefore disclose global values.
            return unavailableResult(
                'MULS_AGENT_ANALYTICS_UNAVAILABLE',
                'Agent-scoped MULS analytics are unavailable until utility storage is authoritatively partitioned by agent and channel'
            );
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
    description: 'Global MULS configuration is unavailable from an agent MCP context and requires a separate trusted administration plane.',
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
                success: false,
                code: 'MULS_ADMIN_CONTEXT_REQUIRED'
            },
            description: 'Global configuration reads require a trusted administration plane'
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
                success: false,
                code: 'MULS_ADMIN_CONTEXT_REQUIRED'
            },
            description: 'Global configuration mutation is unavailable to ordinary agents'
        }
    ],
    handler: async (_input: unknown, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            requireMemoryUtilityIdentity(context);
            return unavailableResult(
                'MULS_ADMIN_CONTEXT_REQUIRED',
                'Global MULS configuration is unavailable from an agent MCP context'
            );
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
    description: 'Manual MULS reward injection is unavailable from an agent MCP context until memory ownership can be authoritatively verified.',
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
                success: false,
                code: 'MULS_MEMORY_OWNERSHIP_UNAVAILABLE'
            },
            description: 'Reward mutation fails closed without authoritative memory ownership'
        },
        {
            input: {
                memoryId: 'mem-xyz789',
                reward: -0.5,
                reason: 'This memory was misleading and caused confusion'
            },
            output: {
                success: false,
                code: 'MULS_MEMORY_OWNERSHIP_UNAVAILABLE'
            },
            description: 'Penalty mutation also fails closed without authoritative memory ownership'
        }
    ],
    handler: async (_input: unknown, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            requireMemoryUtilityIdentity(context);
            return unavailableResult(
                'MULS_MEMORY_OWNERSHIP_UNAVAILABLE',
                'Manual reward injection is unavailable from an agent MCP context because memory ownership cannot be authoritatively verified'
            );
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
