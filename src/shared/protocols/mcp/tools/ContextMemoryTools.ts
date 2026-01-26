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
 * ContextMemoryTools.ts
 * 
 * MCP tools for context and memory management operations including channel context,
 * agent memory, and channel memory. These tools provide capabilities for agents to
 * store, retrieve, and manage contextual information and persistent memory.
 */

import { firstValueFrom } from 'rxjs';
import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { Logger } from '../../../utils/Logger';
import { createStrictValidator } from '../../../utils/validation';
import { ChannelContextService } from '../../../services/ChannelContextService';
import { MemoryService } from '../../../services/MemoryService';
import { IChannelMemory, IAgentMemory } from '../../../types/MemoryTypes';
import { CONTEXT_MEMORY_TOOLS } from '../../../constants/ToolNames';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { QValueManager } from '../../../services/QValueManager';

const logger = new Logger('info', 'ContextMemoryTools', 'server');
const validator = createStrictValidator('ContextMemoryTools');

/**
 * MCP Tool: channel_memory_read
 * Read shared channel memory accessible by all channel agents
 */
export const channelMemoryReadTool = {
    name: CONTEXT_MEMORY_TOOLS.CHANNEL_MEMORY_READ,
    description: 'Read shared channel memory accessible by all channel agents',
    inputSchema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'Memory key to retrieve (optional, returns all if not specified)'
            },
            includeMetadata: {
                type: 'boolean',
                default: true,
                description: 'Include metadata in the response'
            },
            includeExpiration: {
                type: 'boolean',
                default: true,
                description: 'Include expiration information'
            }
        }
    },

    handler: async (input: {
        key?: string;
        includeMetadata?: boolean;
        includeExpiration?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            validator.assertIsNonEmptyString(context.channelId, 'channelId');
            validator.assertIsNonEmptyString(context.agentId, 'agentId');


            // Get channel memory from MemoryService
            const memoryService = MemoryService.getInstance();
            const channelMemory = await firstValueFrom(memoryService.getChannelMemory(context.channelId!));

            let resultData = channelMemory;

            // If specific key requested, extract from notes, sharedState, or customData
            if (input.key) {
                validator.assertIsString(input.key, 'key');
                resultData = channelMemory.notes?.[input.key] || 
                             channelMemory.sharedState?.[input.key] || 
                             channelMemory.customData?.[input.key] || null;
            }

            const result: any = {
                channelId: context.channelId,
                memory: resultData,
                retrievedAt: Date.now()
            };

            // Add metadata if requested
            if (input.includeMetadata !== false) {
                result.metadata = {
                    id: channelMemory.id,
                    channelId: channelMemory.channelId,
                    createdAt: channelMemory.createdAt,
                    updatedAt: channelMemory.updatedAt,
                    persistenceLevel: channelMemory.persistenceLevel
                };
            }

            // Add expiration info if requested
            if (input.includeExpiration !== false) {
                result.hasExpiration = false; // Basic interface doesn't have expiration
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: result
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to read channel memory: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to read channel memory: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: channel_memory_write
 * Write to shared channel memory accessible by all channel agents
 */
export const channelMemoryWriteTool = {
    name: CONTEXT_MEMORY_TOOLS.CHANNEL_MEMORY_WRITE,
    description: 'Write to shared channel memory accessible by all channel agents',
    inputSchema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'Memory key to store data under'
            },
            value: {
                description: 'Value to store (any JSON-serializable data)'
            },
            memorySection: {
                type: 'string',
                enum: ['notes', 'sharedState', 'customData'],
                default: 'sharedState',
                description: 'Which section of memory to store in'
            },
            metadata: {
                type: 'object',
                description: 'Optional metadata for the memory entry'
            },
            overwrite: {
                type: 'boolean',
                default: true,
                description: 'Whether to overwrite existing values'
            }
        },
        required: ['key', 'value']
    },

    handler: async (input: {
        key: string;
        value: any;
        memorySection?: 'notes' | 'sharedState' | 'customData';
        metadata?: Record<string, any>;
        overwrite?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            validator.assertIsNonEmptyString(context.channelId, 'channelId');
            validator.assertIsNonEmptyString(context.agentId, 'agentId');
            validator.assertIsNonEmptyString(input.key, 'key');


            // Get current channel memory
            const memoryService = MemoryService.getInstance();
            const channelMemory = await firstValueFrom(memoryService.getChannelMemory(context.channelId!));

            const section = input.memorySection || 'sharedState';

            // Check if key exists and overwrite is false
            const sectionData = channelMemory[section] || {};
            if (!input.overwrite && sectionData[input.key] !== undefined) {
                throw new Error(`Key '${input.key}' already exists and overwrite is disabled`);
            }

            // Prepare updates
            const updates: any = {
                [section]: {
                    ...sectionData,
                    [input.key]: input.value
                }
            };

            // Update channel memory
            await firstValueFrom(memoryService.updateChannelMemory(context.channelId!, updates));

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    channelId: context.channelId,
                    key: input.key,
                    stored: true,
                    memorySection: section,
                    storedAt: Date.now()
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to write channel memory: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to write channel memory: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: channel_context_read
 * Read channel context (metadata, summary, topics, LLM analysis)
 */
export const channelContextReadTool = {
    name: CONTEXT_MEMORY_TOOLS.CHANNEL_CONTEXT_READ,
    description: 'Read channel context including metadata, summary, topics, and LLM analysis',
    inputSchema: {
        type: 'object',
        properties: {
            includeHistory: {
                type: 'boolean',
                default: false,
                description: 'Include context change history'
            },
            includeTopics: {
                type: 'boolean',
                default: true,
                description: 'Include extracted conversation topics'
            },
            includeSummary: {
                type: 'boolean',
                default: true,
                description: 'Include conversation summary'
            },
            historyLimit: {
                type: 'number',
                default: 10,
                minimum: 1,
                maximum: 100,
                description: 'Maximum number of history entries to include'
            }
        }
    },

    handler: async (input: {
        includeHistory?: boolean;
        includeTopics?: boolean;
        includeSummary?: boolean;
        historyLimit?: number;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }): Promise<{
        content: {
            type: string;
            data: any;
        }
    }> => {
        try {
            validator.assertIsNonEmptyString(context.channelId, 'channelId');
            validator.assertIsNonEmptyString(context.agentId, 'agentId');


            // Tools execute on the SERVER side via MCP protocol
            // Ensure server context is set (default behavior)
            ChannelContextService.setClientContext(false);
            
            // Get channel context from ChannelContextService with timeout
            const contextService = ChannelContextService.getInstance();
            
            // Add timeout to prevent hanging indefinitely
            // Note: ChannelContextMemoryOperations has a 45-second timeout internally
            // We use a slightly longer timeout here to let it complete naturally
            const contextPromise = firstValueFrom(contextService.getContext(context.channelId));
            const timeoutPromise = new Promise<null>((_, reject) => {
                setTimeout(() => reject(new Error('Context retrieval timeout')), 50000); // 50 second timeout (longer than internal 45s)
            });
            
            let channelContext;
            try {
                channelContext = await Promise.race([contextPromise, timeoutPromise]);
            } catch (error) {
                logger.warn(`Context retrieval failed or timed out: ${error}, returning default context`);
                channelContext = null;
            }

            // If no context exists, create a minimal default context
            if (!channelContext) {
                channelContext = {
                    channelId: context.channelId,
                    name: `Channel ${context.channelId}`,
                    description: 'No context available',
                    topics: [],
                    conversationSummary: 'No conversation history available',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    lastActivity: Date.now()
                };
            }

            const result: any = {
                channelId: context.channelId,
                context: channelContext,
                retrievedAt: Date.now()
            };
            

            // Add topics if requested
            if (input.includeTopics !== false && channelContext?.topics) {
                result.topics = channelContext.topics;
            }

            // Add summary if requested
            if (input.includeSummary !== false && channelContext?.conversationSummary) {
                result.summary = channelContext.conversationSummary;
            }

            // Add history if requested
            if (input.includeHistory) {
                try {
                    // Add timeout to prevent hanging indefinitely
                    const historyPromise = firstValueFrom(contextService.getContextHistory(context.channelId, input.historyLimit || 10));
                    const historyTimeoutPromise = new Promise<null>((_, reject) => {
                        setTimeout(() => reject(new Error('History retrieval timeout')), 50000); // 50 second timeout for consistency
                    });
                    
                    const history = await Promise.race([historyPromise, historyTimeoutPromise]);
                    result.history = history || [];
                } catch (historyError) {
                    logger.warn(`Could not retrieve context history: ${historyError}`);
                    result.history = [];
                }
            }

            
            // Wrap in MCP tool handler result format
            return {
                content: {
                    type: 'application/json',
                    data: result
                }
            };
        } catch (error) {
            logger.error(`[CHANNEL_CONTEXT_READ ERROR] Failed to read channel context for requestId ${context?.requestId}: ${error}`);
            // Return error result in MCP format
            return {
                content: {
                    type: 'application/json',
                    data: {
                        channelId: context?.channelId || 'unknown',
                        context: {
                            channelId: context?.channelId || 'unknown',
                            name: 'Error Channel',
                            description: `Failed to read channel context: ${error instanceof Error ? error.message : String(error)}`,
                            topics: [],
                            conversationSummary: 'Error retrieving context',
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            lastActivity: Date.now()
                        },
                        retrievedAt: Date.now()
                    }
                }
            };
        }
    }
};

/**
 * MCP Tool: channel_messages_read
 * Read channel message history with filtering and pagination
 */
export const channelMessagesReadTool = {
    name: CONTEXT_MEMORY_TOOLS.CHANNEL_MESSAGES_READ,
    description: 'Read channel message history with filtering and pagination',
    inputSchema: {
        type: 'object',
        properties: {
            limit: {
                type: 'number',
                default: 50,
                minimum: 1,
                maximum: 1000,
                description: 'Maximum number of messages to retrieve'
            },
            offset: {
                type: 'number',
                default: 0,
                minimum: 0,
                description: 'Number of messages to skip'
            },
            fromSenderId: {
                type: 'string',
                description: 'Filter messages from specific sender'
            },
            afterTimestamp: {
                type: 'number',
                description: 'Only include messages after this timestamp'
            },
            beforeTimestamp: {
                type: 'number',
                description: 'Only include messages before this timestamp'
            },
            includeMetadata: {
                type: 'boolean',
                default: true,
                description: 'Include message metadata'
            }
        }
    },

    handler: async (input: {
        limit?: number;
        offset?: number;
        fromSenderId?: string;
        afterTimestamp?: number;
        beforeTimestamp?: number;
        includeMetadata?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            validator.assertIsNonEmptyString(context.channelId, 'channelId');
            validator.assertIsNonEmptyString(context.agentId, 'agentId');


            // Get messages from ChannelContextService
            const contextService = ChannelContextService.getInstance();
            const limit = input.limit || 50;
            const offset = input.offset || 0;

            // Get messages (ChannelContextService has getMessages method)
            let messages = await firstValueFrom(contextService.getMessages(context.channelId!, limit + offset));

            // Apply filtering
            if (input.fromSenderId) {
                messages = messages.filter(msg => msg.senderId === input.fromSenderId);
            }

            if (input.afterTimestamp) {
                messages = messages.filter(msg => msg.timestamp > input.afterTimestamp!);
            }

            if (input.beforeTimestamp) {
                messages = messages.filter(msg => msg.timestamp < input.beforeTimestamp!);
            }

            // Apply pagination
            const totalCount = messages.length;
            const paginatedMessages = messages.slice(offset, offset + limit);

            // Remove metadata if not requested
            if (input.includeMetadata === false) {
                paginatedMessages.forEach(msg => {
                    delete msg.metadata;
                });
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    channelId: context.channelId,
                    messages: paginatedMessages,
                    totalCount,
                    limit,
                    offset,
                    retrievedAt: Date.now()
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to read channel messages: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to read channel messages: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: agent_context_read
 * Read agent's own context (profile, capabilities, conversation history)
 */
export const agentContextReadTool = {
    name: CONTEXT_MEMORY_TOOLS.AGENT_CONTEXT_READ,
    description: 'Read agent\'s own context including profile, capabilities, and conversation history',
    inputSchema: {
        type: 'object',
        properties: {
            includeMemoryStats: {
                type: 'boolean',
                default: true,
                description: 'Include memory statistics'
            },
            includeActivity: {
                type: 'boolean',
                default: true,
                description: 'Include recent activity summary'
            },
            includeCognitive: {
                type: 'boolean',
                default: false,
                description: 'Include cognitive memory references'
            },
            activityLimit: {
                type: 'number',
                default: 20,
                minimum: 1,
                maximum: 100,
                description: 'Maximum number of recent activities to include'
            }
        }
    },

    handler: async (input: {
        includeMemoryStats?: boolean;
        includeActivity?: boolean;
        includeCognitive?: boolean;
        activityLimit?: number;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            validator.assertIsNonEmptyString(context.agentId, 'agentId');
            validator.assertIsNonEmptyString(context.channelId, 'channelId');


            // Get agent memory from MemoryService
            const memoryService = MemoryService.getInstance();
            const agentMemory = await firstValueFrom(memoryService.getAgentMemory(context.agentId!));

            const result: any = {
                agentId: context.agentId,
                context: {
                    id: agentMemory.id,
                    agentId: agentMemory.agentId,
                    createdAt: agentMemory.createdAt,
                    updatedAt: agentMemory.updatedAt,
                    persistenceLevel: agentMemory.persistenceLevel
                },
                retrievedAt: Date.now()
            };

            // Add memory stats if requested
            if (input.includeMemoryStats !== false) {
                result.memoryStats = {
                    notesCount: Object.keys(agentMemory.notes || {}).length,
                    conversationHistoryCount: (agentMemory.conversationHistory || []).length,
                    customDataCount: Object.keys(agentMemory.customData || {}).length
                };
            }

            // Add cognitive memory references if requested and available
            if (input.includeCognitive && 'cognitiveMemory' in agentMemory) {
                const enhancedMemory = agentMemory as any; // Type assertion for enhanced memory
                result.cognitiveMemory = {
                    observationCount: enhancedMemory.cognitiveMemory?.observationIds?.length || 0,
                    reasoningCount: enhancedMemory.cognitiveMemory?.reasoningIds?.length || 0,
                    planCount: enhancedMemory.cognitiveMemory?.planIds?.length || 0,
                    reflectionCount: enhancedMemory.cognitiveMemory?.reflectionIds?.length || 0
                };
            }

            result.retrievedAt = Date.now();

            const content: McpToolResultContent = {
                type: 'application/json',
                data: result
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to read agent context: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    agentId: context?.agentId || 'unknown',
                    context: {
                        id: context?.agentId || 'unknown',
                        name: 'Error Agent',
                        role: 'error',
                        capabilities: [],
                        description: `Failed to read agent context: ${error instanceof Error ? error.message : String(error)}`
                    },
                    memoryStats: { totalEntries: 0, sections: {} },
                    retrievedAt: Date.now()
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: agent_memory_read
 * Enhanced agent memory operations with metadata and search
 */
export const agentMemoryReadTool = {
    name: CONTEXT_MEMORY_TOOLS.AGENT_MEMORY_READ,
    description: 'Enhanced agent memory operations with metadata and search capabilities',
    inputSchema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'Specific memory key to retrieve (optional)'
            },
            memorySection: {
                type: 'string',
                enum: ['notes', 'conversationHistory', 'customData'],
                description: 'Which section of memory to read from'
            },
            includeMetadata: {
                type: 'boolean',
                default: true,
                description: 'Include metadata in response'
            },
            includeCognitive: {
                type: 'boolean',
                default: false,
                description: 'Include cognitive memory references'
            },
            limit: {
                type: 'number',
                default: 50,
                minimum: 1,
                maximum: 200,
                description: 'Maximum entries to return'
            }
        }
    },

    handler: async (input: {
        key?: string;
        memorySection?: 'notes' | 'conversationHistory' | 'customData';
        includeMetadata?: boolean;
        includeCognitive?: boolean;
        limit?: number;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            validator.assertIsNonEmptyString(context.agentId, 'agentId');
            validator.assertIsNonEmptyString(context.channelId, 'channelId');


            // Get agent memory from MemoryService
            const memoryService = MemoryService.getInstance();
            const agentMemory = await firstValueFrom(memoryService.getAgentMemory(context.agentId!));

            let resultData: any = agentMemory;

            // If specific section requested
            if (input.memorySection) {
                const sectionData = agentMemory[input.memorySection as keyof typeof agentMemory];
                resultData = sectionData || {};
            }

            // If specific key requested, extract just that key
            if (input.key && input.memorySection) {
                validator.assertIsString(input.key, 'key');
                const sectionData = agentMemory[input.memorySection as keyof typeof agentMemory] as Record<string, any>;
                resultData = sectionData?.[input.key] || null;
            }

            const result: any = {
                agentId: context.agentId,
                memory: resultData,
                retrievedAt: Date.now()
            };

            // Add metadata if requested
            if (input.includeMetadata !== false) {
                result.metadata = {
                    id: agentMemory.id,
                    agentId: agentMemory.agentId,
                    createdAt: agentMemory.createdAt,
                    updatedAt: agentMemory.updatedAt,
                    persistenceLevel: agentMemory.persistenceLevel
                };
            }

            // Add cognitive memory references if requested and available
            if (input.includeCognitive && 'cognitiveMemory' in agentMemory) {
                const enhancedMemory = agentMemory as any; // Type assertion for enhanced memory
                result.cognitiveReferences = {
                    observationCount: enhancedMemory.cognitiveMemory?.observationIds?.length || 0,
                    reasoningCount: enhancedMemory.cognitiveMemory?.reasoningIds?.length || 0,
                    planCount: enhancedMemory.cognitiveMemory?.planIds?.length || 0,
                    reflectionCount: enhancedMemory.cognitiveMemory?.reflectionIds?.length || 0
                };
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: result
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to read agent memory: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to read agent memory: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: agent_memory_write
 * Enhanced agent memory operations with metadata and organization
 */
export const agentMemoryWriteTool = {
    name: CONTEXT_MEMORY_TOOLS.AGENT_MEMORY_WRITE,
    description: 'Enhanced agent memory operations with metadata and organization capabilities',
    inputSchema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'Memory key to store data under'
            },
            value: {
                description: 'Value to store (any JSON-serializable data)'
            },
            memorySection: {
                type: 'string',
                enum: ['notes', 'customData'],
                default: 'notes',
                description: 'Which section of memory to store in'
            },
            metadata: {
                type: 'object',
                description: 'Optional metadata for the memory entry'
            },
            overwrite: {
                type: 'boolean',
                default: true,
                description: 'Whether to overwrite existing values'
            }
        },
        required: ['key', 'value']
    },

    handler: async (input: {
        key: string;
        value: any;
        memorySection?: 'notes' | 'customData';
        metadata?: Record<string, any>;
        overwrite?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            validator.assertIsNonEmptyString(context.agentId, 'agentId');
            validator.assertIsNonEmptyString(context.channelId, 'channelId');
            validator.assertIsNonEmptyString(input.key, 'key');


            // Get current agent memory for merge operations
            const memoryService = MemoryService.getInstance();
            const currentMemory = await firstValueFrom(memoryService.getAgentMemory(context.agentId!));

            const section = input.memorySection || 'notes';
            
            // Check if key exists and overwrite is false
            const currentSection = currentMemory[section as keyof typeof currentMemory] as Record<string, any> || {};
            if (!input.overwrite && input.key && currentSection[input.key] !== undefined) {
                throw new Error(`Key '${input.key}' already exists and overwrite is disabled`);
            }

            // Prepare the memory entry with metadata
            const memoryEntry = {
                value: input.value,
                createdAt: Date.now(),
                createdBy: context.agentId,
                channelContext: context.channelId,
                ...(input.metadata || {})
            };

            // Prepare updates
            const updates: Partial<IAgentMemory> = {
                [section]: {
                    ...currentSection,
                    [input.key]: memoryEntry
                }
            } as Partial<IAgentMemory>;

            // Update agent memory
            await firstValueFrom(memoryService.updateAgentMemory(context.agentId!, updates));

            // Register with QValueManager for MULS tracking
            // This ensures new memories start with default Q-value and appear in analytics
            const qValueManager = QValueManager.getInstance();
            if (qValueManager.isEnabled()) {
                qValueManager.setQValueInCache(input.key, qValueManager.getConfig().defaultQValue);
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    agentId: context.agentId,
                    key: input.key,
                    stored: true,
                    memorySection: section,
                    storedAt: Date.now()
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to write agent memory: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to write agent memory: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * Export all context and memory MCP tools
 */
export const contextMemoryTools = [
    channelMemoryReadTool,
    channelMemoryWriteTool,
    channelContextReadTool,
    channelMessagesReadTool,
    agentContextReadTool,
    agentMemoryReadTool,
    agentMemoryWriteTool
];
