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
 * Memory Search Tools - Semantic search across agent memory using Meilisearch
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { Logger } from '../../../utils/Logger';
import { MxfMeilisearchService, SearchParams } from '../../../services/MxfMeilisearchService';

const logger = new Logger('info', 'MemorySearchTools', 'server');

/**
 * Search conversation history semantically
 */
export const memory_search_conversations = {
    name: 'memory_search_conversations',
    description: 'Search your entire conversation history using semantic search. Find relevant past discussions even if they happened hundreds of messages ago. Use this when you need to recall "that time we talked about X".',
    category: 'context-memory',
    tags: ['memory', 'search', 'semantic', 'conversations', 'history'],
    version: '2.0',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'What to search for (natural language). Example: "authentication implementation discussion" or "API error handling approach"'
            },
            channelId: {
                type: 'string',
                description: 'Optional: Limit search to specific channel. If omitted, searches all channels you have access to.'
            },
            limit: {
                type: 'number',
                description: 'Number of results to return (1-50)',
                default: 5,
                minimum: 1,
                maximum: 50
            },
            hybridRatio: {
                type: 'number',
                description: 'Search mode: 0.0 = keyword only, 1.0 = semantic only, 0.7 = balanced (default)',
                default: 0.7,
                minimum: 0,
                maximum: 1
            },
            timeRange: {
                type: 'object',
                description: 'Optional: Filter by time range',
                properties: {
                    after: {
                        type: 'number',
                        description: 'Unix timestamp - show results after this time'
                    },
                    before: {
                        type: 'number',
                        description: 'Unix timestamp - show results before this time'
                    }
                }
            }
        },
        required: ['query']
    },
    examples: [
        {
            input: {
                query: 'How did we implement authentication?',
                limit: 3
            },
            output: {
                success: true,
                results: [
                    {
                        content: 'We decided to use JWT tokens with refresh token rotation...',
                        agentId: 'AgentA',
                        timestamp: 1234567890,
                        relevance: 0.95
                    }
                ]
            },
            description: 'Find relevant past discussions about authentication'
        },
        {
            input: {
                query: 'error handling patterns for API calls',
                channelId: 'dev-channel',
                hybridRatio: 0.8
            },
            output: {
                success: true,
                results: [
                    {
                        content: 'For API errors, we use exponential backoff with circuit breakers...',
                        agentId: 'AgentB',
                        timestamp: 1234567800,
                        relevance: 0.88
                    }
                ]
            },
            description: 'Search specific channel with semantic emphasis'
        }
    ],
    handler: async (input: any, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const meilisearch = MxfMeilisearchService.getInstance();

            // Build filter
            let filter = '';
            if (context.agentId) {
                filter = `agentId = "${context.agentId}"`;
            }
            if (input.channelId) {
                filter = filter ? `${filter} AND channelId = "${input.channelId}"` : `channelId = "${input.channelId}"`;
            }
            if (input.timeRange) {
                if (input.timeRange.after) {
                    filter = filter ? `${filter} AND timestamp >= ${input.timeRange.after}` : `timestamp >= ${input.timeRange.after}`;
                }
                if (input.timeRange.before) {
                    filter = filter ? `${filter} AND timestamp <= ${input.timeRange.before}` : `timestamp <= ${input.timeRange.before}`;
                }
            }

            const searchParams: SearchParams = {
                query: input.query,
                filter: filter || undefined,
                limit: input.limit || 5,
                hybridRatio: input.hybridRatio || 0.7 // Enable hybrid search when embeddings available
            };

            const result = await meilisearch.searchConversations(searchParams);

            const formattedResults = result.hits.map(hit => ({
                content: hit.content,
                role: hit.role,
                agentId: hit.agentId,
                channelId: hit.channelId,
                timestamp: hit.timestamp,
                relevance: hit._rankingScore,
                timeAgo: formatTimeAgo(hit.timestamp)
            }));

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    results: formattedResults,
                    totalResults: result.estimatedTotalHits,
                    processingTimeMs: result.processingTimeMs,
                    message: `Found ${formattedResults.length} relevant conversations${input.channelId ? ` in ${input.channelId}` : ''}`
                }
            };
            return { content };

        } catch (error) {
            logger.error('Memory search failed', error);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    error: error instanceof Error ? error.message : 'Search failed',
                    results: []
                }
            };
            return { content };
        }
    }
};

/**
 * Search action history semantically
 */
export const memory_search_actions = {
    name: 'memory_search_actions',
    description: 'Search your tool usage history semantically. Find when you performed specific actions or used particular tools. Example: "When did I last send a message to AgentB?" or "How many times did I use the calculation tools?"',
    category: 'context-memory',
    tags: ['memory', 'search', 'actions', 'tools', 'history'],
    version: '2.0',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'What action to search for. Example: "send message to AgentB" or "calculation tools"'
            },
            toolName: {
                type: 'string',
                description: 'Optional: Filter by specific tool name'
            },
            successOnly: {
                type: 'boolean',
                description: 'Only show successful actions',
                default: false
            },
            limit: {
                type: 'number',
                description: 'Number of results',
                default: 10,
                minimum: 1,
                maximum: 100
            },
            hybridRatio: {
                type: 'number',
                description: 'Search mode (0.0-1.0)',
                default: 0.7
            }
        },
        required: ['query']
    },
    examples: [
        {
            input: {
                query: 'send message to AgentB',
                limit: 1
            },
            output: {
                success: true,
                results: [
                    {
                        toolName: 'messaging_send',
                        description: 'Sent message to AgentB',
                        timestamp: 1234567890,
                        success: true
                    }
                ]
            },
            description: 'Find when you last messaged an agent'
        }
    ],
    handler: async (input: any, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const meilisearch = MxfMeilisearchService.getInstance();

            let filter = `agentId = "${context.agentId}"`;
            if (input.toolName) {
                filter += ` AND toolName = "${input.toolName}"`;
            }
            if (input.successOnly) {
                filter += ' AND success = true';
            }

            const result = await meilisearch.searchActions({
                query: input.query,
                filter,
                limit: input.limit || 10,
                hybridRatio: input.hybridRatio || 0.7 // Enable hybrid search when embeddings available
            });

            const formattedResults = result.hits.map(hit => ({
                toolName: hit.toolName,
                description: hit.description,
                timestamp: hit.timestamp,
                success: hit.success,
                timeAgo: formatTimeAgo(hit.timestamp),
                relevance: hit._rankingScore
            }));

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    results: formattedResults,
                    totalResults: result.estimatedTotalHits,
                    processingTimeMs: result.processingTimeMs
                }
            };
            return { content };

        } catch (error) {
            logger.error('Action search failed', error);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    error: error instanceof Error ? error.message : 'Search failed',
                    results: []
                }
            };
            return { content };
        }
    }
};

/**
 * Discover patterns from across the system
 */
export const memory_search_patterns = {
    name: 'memory_search_patterns',
    description: 'Discover successful workflow patterns from across the entire system. Find proven approaches that worked well in similar situations, even from other channels. Use this to learn from collective experience.',
    category: 'context-memory',
    tags: ['memory', 'search', 'patterns', 'workflows', 'learning'],
    version: '2.0',
    inputSchema: {
        type: 'object',
        properties: {
            intent: {
                type: 'string',
                description: 'What you are trying to accomplish. Example: "multi-agent API integration" or "error recovery workflow"'
            },
            minEffectiveness: {
                type: 'number',
                description: 'Minimum effectiveness score (0.0-1.0)',
                default: 0.7,
                minimum: 0,
                maximum: 1
            },
            crossChannel: {
                type: 'boolean',
                description: 'Search all channels (true) or only current channel (false)',
                default: false
            },
            limit: {
                type: 'number',
                description: 'Number of patterns to return',
                default: 5,
                minimum: 1,
                maximum: 20
            }
        },
        required: ['intent']
    },
    examples: [
        {
            input: {
                intent: 'coordinate multi-agent data processing',
                minEffectiveness: 0.8,
                crossChannel: true
            },
            output: {
                success: true,
                patterns: [
                    {
                        type: 'collaboration_flow',
                        description: 'Split data, parallel process, merge results',
                        toolsInvolved: ['task_create', 'messaging_send', 'coordination_sync'],
                        effectiveness: 0.92,
                        usageCount: 15
                    }
                ]
            },
            description: 'Find proven multi-agent coordination patterns'
        }
    ],
    handler: async (input: any, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const meilisearch = MxfMeilisearchService.getInstance();

            let filter = `effectiveness >= ${input.minEffectiveness || 0.7}`;
            if (!input.crossChannel && context.channelId) {
                filter += ` AND channelId = "${context.channelId}"`;
            }

            const result = await meilisearch.searchPatterns({
                query: input.intent,
                filter,
                limit: input.limit || 5,
                hybridRatio: 0.7 // Enable hybrid search when embeddings available
            });

            const formattedPatterns = result.hits.map(hit => ({
                type: hit.type,
                description: hit.description,
                toolsInvolved: hit.toolsInvolved,
                effectiveness: hit.effectiveness,
                usageCount: hit.usageCount,
                channelId: hit.channelId,
                relevance: hit._rankingScore
            }));

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    patterns: formattedPatterns,
                    totalPatterns: result.estimatedTotalHits,
                    processingTimeMs: result.processingTimeMs,
                    message: `Found ${formattedPatterns.length} proven patterns${input.crossChannel ? ' across all channels' : ''}`
                }
            };
            return { content };

        } catch (error) {
            logger.error('Pattern search failed', error);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    error: error instanceof Error ? error.message : 'Search failed',
                    patterns: []
                }
            };
            return { content };
        }
    }
};

/**
 * Helper function to format time ago
 */
function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

export const MemorySearchTools = [
    memory_search_conversations,
    memory_search_actions,
    memory_search_patterns
];
