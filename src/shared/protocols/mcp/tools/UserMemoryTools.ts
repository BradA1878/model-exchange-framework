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
 * UserMemoryTools.ts
 *
 * MCP tools for persistent cross-session user memory. Allows agents to save,
 * recall, forget, and shake (identify stale) memories associated with a user.
 *
 * Tools:
 * - user_memory_save:   Create or update a named memory entry
 * - user_memory_recall: Search memories by query with optional type filter
 * - user_memory_forget: Delete a memory by ID or by search term
 * - user_memory_shake:  Identify stale memories that may need pruning
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { McpToolInput } from '../IMcpClient';
import { Logger } from '../../../utils/Logger';
import { UserMemoryService } from '../../../services/UserMemoryService';
import { UserMemoryType } from '../../../models/userMemory';
import { USER_MEMORY_TOOLS } from '../../../constants/ToolNames';

const logger = new Logger('info', 'UserMemoryTools', 'server');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Valid memory types — used for input validation across all tools */
const VALID_TYPES: UserMemoryType[] = ['user', 'feedback', 'project', 'reference'];

/**
 * Resolves the userId from context. Prefers channelId (session-scoped) over
 * agentId, falling back to 'anonymous' if neither is set.
 */
function getUserId(context: McpToolHandlerContext): string {
    return context.channelId || context.agentId || 'anonymous';
}

// ─── Tool: user_memory_save ───────────────────────────────────────────────────

/**
 * user_memory_save — Create or update a user memory entry.
 * Upserts by userId + title, so re-saving with the same title updates in place.
 */
export const userMemorySaveTool: McpToolDefinition = {
    name: USER_MEMORY_TOOLS.USER_MEMORY_SAVE,
    description: 'Save a memory entry for the user. If a memory with the same title already exists it will be updated in place. Use "user" type for personal preferences and traits, "feedback" for lessons learned, "project" for project context, and "reference" for reference data.',
    inputSchema: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                enum: VALID_TYPES,
                description: 'Category of the memory: "user" (preferences/traits), "feedback" (lessons/corrections), "project" (project context), "reference" (reference data).'
            },
            title: {
                type: 'string',
                minLength: 1,
                description: 'Short unique label for this memory (used as the upsert key per user).'
            },
            description: {
                type: 'string',
                minLength: 1,
                description: 'Brief summary or context for the memory entry.'
            },
            content: {
                type: 'string',
                minLength: 1,
                description: 'Full content of the memory entry.'
            }
        },
        required: ['type', 'title', 'description', 'content']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const { type, title, description, content } = input as {
            type: UserMemoryType;
            title: string;
            description: string;
            content: string;
        };

        // Validate type is a recognised value
        if (!VALID_TYPES.includes(type)) {
            return {
                content: {
                    type: 'text',
                    data: `Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}.`
                }
            };
        }

        // Validate required string fields are non-empty
        if (!title?.trim()) {
            return { content: { type: 'text', data: 'title must not be empty.' } };
        }
        if (!description?.trim()) {
            return { content: { type: 'text', data: 'description must not be empty.' } };
        }
        if (!content?.trim()) {
            return { content: { type: 'text', data: 'content must not be empty.' } };
        }

        try {
            const userId = getUserId(context);
            const service = UserMemoryService.getInstance();
            await service.save(userId, { type, title, description, content });
            logger.info(`Saved user memory "${title}" (${type}) for userId=${userId}`);
            return {
                content: {
                    type: 'text',
                    data: `Memory saved: "${title}" (${type})`
                }
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('user_memory_save failed', err);
            return {
                content: {
                    type: 'text',
                    data: `Failed to save memory: ${message}`
                }
            };
        }
    }
};

// ─── Tool: user_memory_recall ─────────────────────────────────────────────────

/**
 * user_memory_recall — Search user memories by query string.
 * Uses a three-tier search (Meilisearch → MongoDB $text → recency) and returns
 * the top matches with staleness labels.
 */
export const userMemoryRecallTool: McpToolDefinition = {
    name: USER_MEMORY_TOOLS.USER_MEMORY_RECALL,
    description: 'Search the user\'s memories by a query string. Returns the most relevant entries with staleness labels. Use this before tasks to surface relevant user context, preferences, or prior feedback.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                minLength: 1,
                description: 'Search query — can be keywords, a question, or a topic to look up.'
            },
            type: {
                type: 'string',
                enum: VALID_TYPES,
                description: 'Optional: restrict results to a specific memory type.'
            },
            limit: {
                type: 'number',
                minimum: 1,
                maximum: 50,
                description: 'Maximum number of results to return (1–50, default 5).'
            }
        },
        required: ['query']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const { query, type, limit } = input as {
            query: string;
            type?: UserMemoryType;
            limit?: number;
        };

        // Validate query is non-empty
        if (!query?.trim()) {
            return { content: { type: 'text', data: 'query must not be empty.' } };
        }

        // Validate optional type
        if (type !== undefined && !VALID_TYPES.includes(type)) {
            return {
                content: {
                    type: 'text',
                    data: `Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}.`
                }
            };
        }

        // Clamp limit to 1–50
        const resolvedLimit = limit !== undefined ? Math.min(50, Math.max(1, limit)) : 5;

        try {
            const userId = getUserId(context);
            const service = UserMemoryService.getInstance();
            const results = await service.recall(userId, query, { type, limit: resolvedLimit });

            if (results.length === 0) {
                return { content: { type: 'text', data: 'No memories found.' } };
            }

            // Return a compact JSON array with only the fields useful to the agent
            const payload = results.map(r => ({
                id: r.id,
                type: r.type,
                title: r.title,
                content: r.content,
                staleness: r.staleness
            }));

            return {
                content: {
                    type: 'application/json',
                    data: payload
                }
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('user_memory_recall failed', err);
            return {
                content: {
                    type: 'text',
                    data: `Failed to recall memories: ${message}`
                }
            };
        }
    }
};

// ─── Tool: user_memory_forget ─────────────────────────────────────────────────

/**
 * user_memory_forget — Delete a user memory by explicit ID or by search term.
 * Provide memoryId for precision, or searchTerm to fuzzy-match and delete the
 * closest result. At least one must be supplied.
 */
export const userMemoryForgetTool: McpToolDefinition = {
    name: USER_MEMORY_TOOLS.USER_MEMORY_FORGET,
    description: 'Delete a user memory by ID or by searching for the best title match. Provide memoryId for a precise delete, or searchTerm to find and remove the closest match. At least one parameter is required.',
    inputSchema: {
        type: 'object',
        properties: {
            memoryId: {
                type: 'string',
                description: 'Exact ID of the memory to delete (from user_memory_recall results).'
            },
            searchTerm: {
                type: 'string',
                description: 'Search term used to find the best matching memory to delete.'
            }
        }
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const { memoryId, searchTerm } = input as {
            memoryId?: string;
            searchTerm?: string;
        };

        // Require at least one deletion target
        if (!memoryId?.trim() && !searchTerm?.trim()) {
            return {
                content: {
                    type: 'text',
                    data: 'At least one of memoryId or searchTerm must be provided.'
                }
            };
        }

        try {
            const userId = getUserId(context);
            const service = UserMemoryService.getInstance();
            const { deleted } = await service.forget(userId, {
                memoryId: memoryId?.trim() || undefined,
                searchTerm: searchTerm?.trim() || undefined
            });

            if (deleted === 0) {
                return { content: { type: 'text', data: 'No matching memory found.' } };
            }

            const noun = deleted === 1 ? 'memory' : 'memories';
            logger.info(`Deleted ${deleted} ${noun} for userId=${userId}`);
            return {
                content: {
                    type: 'text',
                    data: `Deleted ${deleted} ${noun}.`
                }
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('user_memory_forget failed', err);
            return {
                content: {
                    type: 'text',
                    data: `Failed to delete memory: ${message}`
                }
            };
        }
    }
};

// ─── Tool: user_memory_shake ──────────────────────────────────────────────────

/**
 * user_memory_shake — Identify stale memories that may need pruning.
 * Returns candidate entries that have exceeded their type-specific staleness
 * threshold (or a custom override). Does NOT delete — the agent should present
 * candidates to the user via user_input (multi_select) and then call
 * user_memory_forget for each selected ID.
 */
export const userMemoryShakeTool: McpToolDefinition = {
    name: USER_MEMORY_TOOLS.USER_MEMORY_SHAKE,
    description: 'Identify stale user memories that may need pruning. Returns candidates that have exceeded their type-specific staleness threshold (project=30d, reference=60d, feedback=90d, user=180d) or a custom override. Does NOT delete anything — present the candidates to the user via user_input (multi_select) then call user_memory_forget for each selected ID.',
    inputSchema: {
        type: 'object',
        properties: {
            thresholdDays: {
                type: 'number',
                minimum: 1,
                description: 'Override staleness threshold in days applied uniformly to all types. If omitted the per-type defaults are used.'
            }
        }
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const { thresholdDays } = input as { thresholdDays?: number };

        // Validate thresholdDays if provided
        if (thresholdDays !== undefined && (typeof thresholdDays !== 'number' || thresholdDays < 1)) {
            return {
                content: {
                    type: 'text',
                    data: 'thresholdDays must be a number >= 1.'
                }
            };
        }

        try {
            const userId = getUserId(context);
            const service = UserMemoryService.getInstance();
            const stale = await service.shake(userId, thresholdDays);

            if (stale.length === 0) {
                return { content: { type: 'text', data: 'No stale memories found.' } };
            }

            const candidates = stale.map(r => ({
                id: r.id,
                title: r.title,
                type: r.type,
                staleness: r.staleness,
                updatedAt: r.updatedAt
            }));

            return {
                content: {
                    type: 'application/json',
                    data: {
                        staleCount: stale.length,
                        candidates,
                        instruction: 'Present these to the user via user_input (multi_select) to choose which to delete, then call user_memory_forget for each selected.'
                    }
                }
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('user_memory_shake failed', err);
            return {
                content: {
                    type: 'text',
                    data: `Failed to shake memories: ${message}`
                }
            };
        }
    }
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const userMemoryTools = [
    userMemorySaveTool,
    userMemoryRecallTool,
    userMemoryForgetTool,
    userMemoryShakeTool
];
