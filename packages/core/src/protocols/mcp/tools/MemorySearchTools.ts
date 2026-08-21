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
 * Memory Search Tools - Semantic search across agent memory using Meilisearch
 */

import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes.js';
import { Logger } from '../../../utils/Logger.js';
import { MxfMeilisearchService, SearchParams } from '../../../services/MxfMeilisearchService.js';
import { MemoryService } from '../../../services/MemoryService.js';
import { QValueManager } from '../../../services/QValueManager.js';
import { UtilityScorerService } from '../../../services/UtilityScorerService.js';
import { RewardSignalProcessor } from '../../../services/RewardSignalProcessor.js';
import { MemoryCandidate } from '../../../types/MemoryUtilityTypes.js';
import { getCurrentMemoryPhase } from './OrparTools.js';
import { checkResultSize, PaginationMetadata } from '../../../utils/ToolPaginationUtils.js';

const logger = new Logger('info', 'MemorySearchTools', 'server');

const escapeMeilisearchFilterLiteral = (value: string): string => (
    value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
);

const requireBoundedString = (value: unknown, name: string, maximum: number): string => {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
        throw new Error(`${name} must be a non-empty string of at most ${maximum} characters`);
    }
    return value.trim();
};

const requireInputRecord = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('input must be an object');
    }
    return value as Record<string, unknown>;
};

const requireSearchContext = (context: McpToolHandlerContext): {
    agentId: string;
    channelId: string;
} => ({
    agentId: requireBoundedString(context.agentId, 'context.agentId', 256),
    channelId: requireBoundedString(context.channelId, 'context.channelId', 256)
});

const boundedInteger = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
    name: string
): number => {
    const resolved = value === undefined ? fallback : value;
    if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) ||
        resolved < minimum || resolved > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return resolved;
};

const boundedNumber = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
    name: string
): number => {
    const resolved = value === undefined ? fallback : value;
    if (typeof resolved !== 'number' || !Number.isFinite(resolved) ||
        resolved < minimum || resolved > maximum) {
        throw new Error(`${name} must be a number between ${minimum} and ${maximum}`);
    }
    return resolved;
};

const optionalBoolean = (value: unknown, name: string): boolean | undefined => {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'boolean') {
        throw new Error(`${name} must be a boolean when provided`);
    }
    return value;
};

/**
 * Search conversation history semantically
 */
/**
 * Re-rank search hits by learned utility, and record what was retrieved.
 *
 * This is the join between semantic search and the Memory Utility Learning System.
 * Before this existed, Q-values were computed and stored but no reachable retrieval
 * path consulted them, so learning could not change anything an agent saw — and no
 * production code recorded which memories a task used, so no reward was ever
 * attributed. Both halves of the loop close here.
 *
 * When MULS is disabled this returns the hits untouched, so search behaves exactly as
 * it did before.
 */
async function applyUtilityRanking<T extends { id: string; _rankingScore: number }>(
    query: string,
    hits: T[],
    context: McpToolHandlerContext
): Promise<T[]> {
    const qValueManager = QValueManager.getInstance();
    if (!qValueManager.isEnabled() || hits.length === 0) {
        return hits;
    }

    const { agentId, channelId } = context;
    const memoryIds = hits.map(hit => hit.id);

    // Load Q-values learned in previous runs; without this every memory this process
    // has not seen yet would score at the default and ranking would ignore all learning.
    const memoryService = MemoryService.getInstance();
    await memoryService.hydrateQValues(memoryIds);

    const candidates: MemoryCandidate[] = hits.map(hit => ({
        memoryId: hit.id,
        similarity: hit._rankingScore,
        qValue: qValueManager.getQValue(hit.id)
    }));

    // Phase-specific lambda when the agent is inside an ORPAR cycle; otherwise the
    // configured default. We do not guess a phase.
    const phase = agentId && channelId ? getCurrentMemoryPhase(agentId, channelId) : null;
    const scorer = UtilityScorerService.getInstance();
    const scoringResult = phase
        ? scorer.scoreForPhase(query, candidates, phase)
        : scorer.scoreMemories(query, candidates);

    // Record the retrieval so RewardSignalProcessor can attribute the task's outcome to
    // these memories when it completes.
    if (agentId && channelId) {
        RewardSignalProcessor.getInstance().trackAgentMemoriesUsage(
            agentId,
            channelId,
            scoringResult.memories.map(m => m.memoryId),
            phase ?? 'observation',
            'context'
        );
    }

    const hitsById = new Map(hits.map(hit => [hit.id, hit]));
    const ranked: T[] = [];
    for (const scored of scoringResult.memories) {
        const hit = hitsById.get(scored.memoryId);
        if (hit) {
            ranked.push(hit);
        }
    }
    return ranked;
}

export const memory_search_conversations = {
    name: 'memory_search_conversations',
    description: 'Search your conversation history in the authenticated channel using semantic search. Find relevant past discussions even if they happened hundreds of messages ago.',
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
                description: 'Optional channel assertion. When provided, it must match the authenticated channel.'
            },
            limit: {
                type: 'number',
                description: 'Number of results to return (1-50)',
                default: 10,
                minimum: 1,
                maximum: 50
            },
            offset: {
                type: 'number',
                description: 'Number of results to skip for pagination (default: 0)',
                default: 0,
                minimum: 0
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
    handler: async (input: unknown, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const request = requireInputRecord(input);
            const meilisearch = MxfMeilisearchService.getInstance();
            const identity = requireSearchContext(context);
            const query = requireBoundedString(request.query, 'query', 4096);
            if (request.channelId !== undefined && request.channelId !== identity.channelId) {
                throw new Error('channelId must match the authenticated tool context');
            }

            // Both dimensions are mandatory. An agent id can legitimately be
            // reused in another channel, so filtering by agent alone leaks it.
            let filter = `agentId = "${escapeMeilisearchFilterLiteral(identity.agentId)}"` +
                ` AND channelId = "${escapeMeilisearchFilterLiteral(identity.channelId)}"`;
            if (request.timeRange !== undefined && (
                typeof request.timeRange !== 'object' || request.timeRange === null ||
                Array.isArray(request.timeRange)
            )) {
                throw new Error('timeRange must be an object when provided');
            }
            const timeRange = request.timeRange as Record<string, unknown> | undefined;
            const after = timeRange?.after === undefined
                ? undefined
                : boundedInteger(
                    timeRange.after,
                    0,
                    0,
                    Number.MAX_SAFE_INTEGER,
                    'timeRange.after'
                );
            const before = timeRange?.before === undefined
                ? undefined
                : boundedInteger(
                    timeRange.before,
                    0,
                    0,
                    Number.MAX_SAFE_INTEGER,
                    'timeRange.before'
                );
            if (after !== undefined && before !== undefined && after > before) {
                throw new Error('timeRange.after must not be later than timeRange.before');
            }
            if (after !== undefined) {
                filter += ` AND timestamp >= ${after}`;
            }
            if (before !== undefined) {
                filter += ` AND timestamp <= ${before}`;
            }

            const limit = boundedInteger(request.limit, 10, 1, 50, 'limit');
            const offset = boundedInteger(request.offset, 0, 0, 10_000, 'offset');

            const searchParams: SearchParams = {
                query,
                filter: filter || undefined,
                limit: limit,
                offset: offset,
                hybridRatio: boundedNumber(request.hybridRatio, 0.7, 0, 1, 'hybridRatio')
            };

            const result = await meilisearch.searchConversations(searchParams);

            // Re-rank by learned utility and record the retrieval for reward attribution.
            const rankedHits = await applyUtilityRanking(query, result.hits, context);

            const formattedResults = rankedHits.map(hit => ({
                content: hit.content,
                role: hit.role,
                agentId: hit.agentId,
                channelId: hit.channelId,
                timestamp: hit.timestamp,
                relevance: hit._rankingScore,
                timeAgo: formatTimeAgo(hit.timestamp)
            }));

            // Build pagination metadata
            const totalCount = result.estimatedTotalHits || formattedResults.length;
            const hasMore = offset + formattedResults.length < totalCount;
            const pagination: PaginationMetadata = {
                totalCount,
                limit,
                offset,
                hasMore,
                ...(hasMore ? { nextOffset: offset + limit } : {})
            };

            const responseData = {
                success: true,
                results: formattedResults,
                pagination,
                processingTimeMs: result.processingTimeMs,
                message: `Found ${formattedResults.length} relevant conversations in ${identity.channelId}${hasMore ? ` (${totalCount - offset - formattedResults.length} more available)` : ''}`
            };

            // Check result size and add pagination hint if needed
            const checkedData = checkResultSize(responseData, 'memory_search_conversations', logger);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: checkedData
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
            offset: {
                type: 'number',
                description: 'Number of results to skip for pagination (default: 0)',
                default: 0,
                minimum: 0
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
    handler: async (input: unknown, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const request = requireInputRecord(input);
            const meilisearch = MxfMeilisearchService.getInstance();
            const identity = requireSearchContext(context);
            const query = requireBoundedString(request.query, 'query', 4096);

            let filter = `agentId = "${escapeMeilisearchFilterLiteral(identity.agentId)}"` +
                ` AND channelId = "${escapeMeilisearchFilterLiteral(identity.channelId)}"`;
            if (request.toolName !== undefined) {
                const toolName = requireBoundedString(request.toolName, 'toolName', 256);
                filter += ` AND toolName = "${escapeMeilisearchFilterLiteral(toolName)}"`;
            }
            const successOnly = optionalBoolean(request.successOnly, 'successOnly') ?? false;
            if (successOnly) {
                filter += ' AND success = true';
            }

            const limit = boundedInteger(request.limit, 10, 1, 100, 'limit');
            const offset = boundedInteger(request.offset, 0, 0, 10_000, 'offset');

            const result = await meilisearch.searchActions({
                query,
                filter,
                limit: limit,
                offset: offset,
                hybridRatio: boundedNumber(request.hybridRatio, 0.7, 0, 1, 'hybridRatio')
            });

            const formattedResults = result.hits.map(hit => ({
                toolName: hit.toolName,
                description: hit.description,
                timestamp: hit.timestamp,
                success: hit.success,
                timeAgo: formatTimeAgo(hit.timestamp),
                relevance: hit._rankingScore
            }));

            // Build pagination metadata
            const totalCount = result.estimatedTotalHits || formattedResults.length;
            const hasMore = offset + formattedResults.length < totalCount;
            const pagination: PaginationMetadata = {
                totalCount,
                limit,
                offset,
                hasMore,
                ...(hasMore ? { nextOffset: offset + limit } : {})
            };

            const responseData = {
                success: true,
                results: formattedResults,
                pagination,
                processingTimeMs: result.processingTimeMs
            };

            // Check result size and add pagination hint if needed
            const checkedData = checkResultSize(responseData, 'memory_search_actions', logger);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: checkedData
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
    description: 'Discover successful workflow patterns in the authenticated channel.',
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
                description: 'Must be false; channel-key searches are always scoped to the authenticated channel',
                default: false
            },
            limit: {
                type: 'number',
                description: 'Number of patterns to return',
                default: 5,
                minimum: 1,
                maximum: 20
            },
            offset: {
                type: 'number',
                description: 'Number of patterns to skip for pagination (default: 0)',
                default: 0,
                minimum: 0
            }
        },
        required: ['intent']
    },
    examples: [
        {
            input: {
                intent: 'coordinate multi-agent data processing',
                minEffectiveness: 0.8,
                crossChannel: false
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
    handler: async (input: unknown, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const request = requireInputRecord(input);
            const meilisearch = MxfMeilisearchService.getInstance();
            const identity = requireSearchContext(context);
            const intent = requireBoundedString(request.intent, 'intent', 4096);
            const crossChannel = optionalBoolean(request.crossChannel, 'crossChannel') ?? false;
            if (crossChannel) {
                throw new Error('Cross-channel pattern search is not available to channel-key agents');
            }

            const minEffectiveness = boundedNumber(
                request.minEffectiveness,
                0.7,
                0,
                1,
                'minEffectiveness'
            );
            let filter = `effectiveness >= ${minEffectiveness}`;
            filter += ` AND channelId = "${escapeMeilisearchFilterLiteral(identity.channelId)}"`;

            const limit = boundedInteger(request.limit, 5, 1, 20, 'limit');
            const offset = boundedInteger(request.offset, 0, 0, 10_000, 'offset');

            const result = await meilisearch.searchPatterns({
                query: intent,
                filter,
                limit: limit,
                offset: offset,
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

            // Build pagination metadata
            const totalCount = result.estimatedTotalHits || formattedPatterns.length;
            const hasMore = offset + formattedPatterns.length < totalCount;
            const pagination: PaginationMetadata = {
                totalCount,
                limit,
                offset,
                hasMore,
                ...(hasMore ? { nextOffset: offset + limit } : {})
            };

            const responseData = {
                success: true,
                patterns: formattedPatterns,
                pagination,
                processingTimeMs: result.processingTimeMs,
                message: `Found ${formattedPatterns.length} proven patterns in ${identity.channelId}${hasMore ? ` (${totalCount - offset - formattedPatterns.length} more available)` : ''}`
            };

            // Check result size and add pagination hint if needed
            const checkedData = checkResultSize(responseData, 'memory_search_patterns', logger);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: checkedData
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
