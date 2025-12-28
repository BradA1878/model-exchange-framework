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
 * Memory Manager for MxfAgent
 * 
 * Manages all memory operations including conversation history,
 * agent memory persistence, and memory optimization for LLM agents.
 */

import { Logger } from '../../shared/utils/Logger';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { MxfMemoryService } from '../services/MxfMemoryService';
import { IAgentMemory, MemoryPersistenceLevel } from '../../shared/types/MemoryTypes';
import { Observation, Reasoning, Plan } from '../../shared/types/ControlLoopTypes';
import { v4 as uuidv4 } from 'uuid';
import { firstValueFrom } from 'rxjs';
import { MxfMeilisearchService } from '../../shared/services/MxfMeilisearchService';
import {
    createMeilisearchIndexEventPayload,
    createMeilisearchBackfillEventPayload,
    MeilisearchIndexEventData,
    MeilisearchBackfillEventData
} from '../../shared/schemas/EventPayloadSchema';
import { EventBus } from '../../shared/events/EventBus';

export interface MemoryManagerConfig {
    agentId: string;
    channelId: string;
    maxHistory: number;
    maxObservations: number;
    enablePersistence: boolean;
    enableDeduplication?: boolean;
    maxMessageSize?: number; // Max size in bytes for a single message (default: 100KB)
}

export class MxfMemoryManager {
    private config: MemoryManagerConfig;
    private memoryService: any; // Memory service interface
    private logger: Logger;
    private agentId: string;
    private conversationHistory: ConversationMessage[] = [];
    private observations: Observation[] = [];
    private currentReasoning: Reasoning | null = null;
    private currentPlan: Plan | null = null;
    private memoryLoaded: boolean = false;
    private maxHistorySize: number = 50; // Default max messages to keep
    private maxObservations: number = 100; // Default max observations
    private memoryOperations?: any; // Memory operations interface
    private enableDeduplication: boolean = false; // DISABLED by default - was causing more issues than solving
    private meilisearchService: MxfMeilisearchService | null = null; // Meilisearch integration for semantic search
    private eventBus: typeof EventBus = EventBus; // Event bus for emitting indexing events
    private lastSavedMessageCount: number = 0; // Track how many messages were already saved to MongoDB
    private maxMessageSize: number = 100 * 1024; // Default 100KB max per message to prevent MongoDB overflow

    constructor(config: MemoryManagerConfig) {
        this.config = config;
        this.logger = new Logger('debug', `MemoryManager:${config.agentId}`, 'client');
        this.agentId = config.agentId;
        this.maxHistorySize = config.maxHistory || this.maxHistorySize;
        this.maxObservations = config.maxObservations || this.maxObservations;
        this.enableDeduplication = config.enableDeduplication || this.enableDeduplication;
        this.maxMessageSize = config.maxMessageSize || this.maxMessageSize;

        // Initialize Meilisearch service if enabled
        if (process.env.ENABLE_MEILISEARCH !== 'false') {
            try {
                // Pass client context for proper logging
                this.meilisearchService = MxfMeilisearchService.getInstance({
                    host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
                    apiKey: process.env.MEILISEARCH_MASTER_KEY || '',
                    loggerContext: 'client'
                });
            } catch (error) {
                this.logger.warn(`Failed to initialize Meilisearch service: ${error instanceof Error ? error.message : String(error)}`);
                this.meilisearchService = null;
            }
        } else {
        }
    }

    /**
     * Initialize the memory manager and load existing memory
     */
    public async initialize(): Promise<void> {
        
        if (this.config.enablePersistence) {
            await this.loadAgentMemory();
        }
        
    }

    /**
     * Load agent memory from the memory system
     */
    public async loadAgentMemory(): Promise<void> {
        try {
            if (!this.config.agentId) {
                this.logger.warn('Cannot load memory: agent ID not set');
                return;
            }
            
            
            // Get memory from the memory service
            const memory = await firstValueFrom(
                MxfMemoryService.getInstance().getAgentMemory(
                    this.config.agentId, 
                    this.config.channelId, 
                    this.config.agentId
                )
            );
            
            // If memory has conversation history, index it to Meilisearch but DON'T inject into prompts
            if (memory.conversationHistory && Array.isArray(memory.conversationHistory)) {
                // Track the count of historical messages for append-only saves
                this.lastSavedMessageCount = memory.conversationHistory.length;

                if (this.conversationHistory.length === 0 && memory.conversationHistory.length > 0) {
                    // ✅ NEW ARCHITECTURE: Don't restore to working memory
                    // Historical conversations are indexed to Meilisearch for searching
                    // but NOT injected into prompts to avoid temporal confusion


                    // Backfill historical messages to Meilisearch (async, non-blocking)
                    if (this.meilisearchService) {
                        this.backfillConversationsToMeilisearch(memory.conversationHistory).catch(error => {
                            // Error already logged in backfillConversationsToMeilisearch, just prevent unhandled rejection
                        });
                    } else {
                        // No Meilisearch - historical data not accessible (but also won't pollute prompts)
                        this.logger.warn(`⚠️  ${memory.conversationHistory.length} historical messages exist but Meilisearch disabled - history not searchable`);
                        this.emitMeilisearchReady();
                    }
                } else if (this.conversationHistory.length === 0 && memory.conversationHistory.length === 0) {
                    // New agent with no history - emit ready event immediately
                    this.emitMeilisearchReady();
                }
            } else {
                // No conversation history at all - new agent
                this.emitMeilisearchReady();
            }

            // Restore other memory components if available
            if (memory.notes) {
                if (memory.notes.recentObservations) {
                    this.observations = memory.notes.recentObservations as Observation[];
                }
                if (memory.notes.currentReasoning) {
                    this.currentReasoning = memory.notes.currentReasoning as Reasoning;
                }
                if (memory.notes.currentPlan) {
                    this.currentPlan = memory.notes.currentPlan as Plan;
                }
            }

            // Mark memory as loaded
            this.memoryLoaded = true;
        } catch (error) {
            this.logger.error(`Error loading agent memory: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Save agent memory to the memory system
     * CRITICAL: Appends new messages instead of replacing entire history
     */
    public async saveAgentMemory(): Promise<void> {
        try {
            if (!this.config.enablePersistence) {
                return; // Skip if persistence is disabled
            }

            if (!this.config.agentId) {
                this.logger.warn('Cannot save memory: agent ID not set');
                return;
            }

            // Determine which messages are NEW (not yet saved to MongoDB)
            const newMessages = this.conversationHistory.slice(this.lastSavedMessageCount);

            if (newMessages.length === 0) {
                return; // Nothing new to append
            }

            // Calculate total document size to prevent MongoDB 16MB limit
            const estimatedDocSize = Buffer.byteLength(JSON.stringify({
                conversationHistory: this.conversationHistory,
                notes: {
                    recentObservations: this.observations,
                    currentReasoning: this.currentReasoning,
                    currentPlan: this.currentPlan
                }
            }), 'utf8');

            // MongoDB has a 16MB limit, use 12MB as safety threshold (75% of limit)
            const MONGODB_SAFE_LIMIT = 12 * 1024 * 1024; // 12MB

            if (estimatedDocSize > MONGODB_SAFE_LIMIT) {
                this.logger.warn(
                    `⚠️  Agent memory approaching MongoDB limit! ` +
                    `Current: ${(estimatedDocSize / 1024 / 1024).toFixed(2)}MB, ` +
                    `Limit: ${(MONGODB_SAFE_LIMIT / 1024 / 1024).toFixed(0)}MB. ` +
                    `Forcing aggressive cleanup...`
                );

                // Aggressive cleanup: keep only last 20 messages
                const messagesToKeep = 20;
                this.conversationHistory = this.conversationHistory.slice(-messagesToKeep);
                this.observations = this.observations.slice(-10);
                this.lastSavedMessageCount = 0; // Reset since we truncated

                this.logger.info(`Trimmed conversation to ${this.conversationHistory.length} messages`);
            }

            // Determine which messages are NEW after potential cleanup
            const newMessagesAfterCleanup = this.conversationHistory.slice(this.lastSavedMessageCount);

            if (newMessagesAfterCleanup.length === 0) {
                return; // Nothing new to append after cleanup
            }

            // Truncate individual large messages (legacy safety check)
            const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5MB per message
            const truncatedMessages = newMessagesAfterCleanup.map(msg => {
                if (msg.content && msg.content.length > MAX_CONTENT_LENGTH) {
                    this.logger.warn(`Truncating large message content: ${msg.content.length} bytes → ${MAX_CONTENT_LENGTH} bytes (role: ${msg.role})`);
                    return {
                        ...msg,
                        content: msg.content.substring(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated for MongoDB storage - full content indexed in Meilisearch]',
                        metadata: {
                            ...msg.metadata,
                            truncated: true,
                            originalSize: msg.content.length
                        }
                    };
                }
                return msg;
            });


            // Prepare memory data with ONLY new messages (truncated if necessary)
            // The server will APPEND these to existing conversationHistory
            const memoryData: IAgentMemory = {
                id: `agent-memory-${this.config.agentId}`,
                agentId: this.config.agentId,
                createdAt: new Date(),
                updatedAt: new Date(),
                persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
                conversationHistory: truncatedMessages,  // Truncated messages to prevent MongoDB 16MB limit
                notes: {
                    recentObservations: this.observations,
                    currentReasoning: this.currentReasoning,
                    currentPlan: this.currentPlan
                }
            };

            // Save memory using the memory service
            await firstValueFrom(
                MxfMemoryService.getInstance().updateAgentMemory(
                    this.config.agentId,
                    this.config.channelId,
                    this.config.agentId,
                    memoryData
                )
            );

            // Update the saved count
            this.lastSavedMessageCount = this.conversationHistory.length;

        } catch (error) {
            //this.logger.error(`Error saving agent memory: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Add a message to the conversation history with optional deduplication
     */
    public addConversationMessage(message: { role: string; content: string; metadata?: Record<string, any>; tool_calls?: any[] }): void {
        // Calculate message size to prevent MongoDB 16MB document limit
        const messageSize = Buffer.byteLength(JSON.stringify(message), 'utf8');

        if (messageSize > this.maxMessageSize) {
            this.logger.warn(
                `⚠️  Skipping large message (${(messageSize / 1024).toFixed(1)}KB > ${(this.maxMessageSize / 1024).toFixed(0)}KB limit). ` +
                `Role: ${message.role}, Tool: ${message.metadata?.toolName || 'N/A'}`
            );

            // Store a summary instead of the full message to preserve conversation flow
            const summaryMessage: ConversationMessage = {
                id: uuidv4(),
                role: message.role as 'user' | 'assistant' | 'system',
                content: `[Large response omitted - ${(messageSize / 1024).toFixed(1)}KB]`,
                timestamp: Date.now(),
                metadata: {
                    ...message.metadata,
                    omittedSize: messageSize,
                    omittedReason: 'exceeded_max_message_size'
                },
                tool_calls: message.tool_calls
            };

            this.conversationHistory.push(summaryMessage);
            this.trimConversationHistory();
            return;
        }

        // Only check for duplicates if deduplication is enabled
        if (this.enableDeduplication) {
            const isDuplicate = this.isDuplicateMessage(message);

            if (isDuplicate) {
                return;
            }
        }

        const conversationMessage: ConversationMessage = {
            id: uuidv4(),
            role: message.role as 'user' | 'assistant' | 'system',
            content: message.content,
            timestamp: Date.now(),
            metadata: message.metadata,
            tool_calls: message.tool_calls // CRITICAL: Preserve tool_calls for assistant messages
        };

        // Add to history
        this.conversationHistory.push(conversationMessage);

        // Maintain max history length
        this.trimConversationHistory();

        // Index to Meilisearch asynchronously (non-blocking)
        // Skip system role messages - they contain dynamically generated prompts that are:
        // 1. Redundant (already sent with every LLM request)
        // 2. Large (full tool schemas, guidelines, etc.)
        // 3. Not useful for semantic search (framework boilerplate, not conversation content)
        if (this.meilisearchService && message.role !== 'system') {
            this.indexConversationToMeilisearch(conversationMessage).catch(error => {
                // Error already logged in indexConversationToMeilisearch, just prevent unhandled rejection
            });
        }

        // Save memory asynchronously
        this.saveAgentMemory().catch(error => {
            this.logger.error(`Error saving conversation to memory: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    /**
     * Enhanced duplicate message detection
     */
    private isDuplicateMessage(newMessage: { role: string; content: string; metadata?: Record<string, any>; tool_calls?: any[] }): boolean {
        // CRITICAL: Never deduplicate tool results - they may have same content but different tool_call_ids
        if (newMessage.role === 'tool' || (newMessage.metadata && newMessage.metadata.isToolResult)) {
            return false; // Tool results must never be deduplicated
        }
        
        // CRITICAL: Never deduplicate assistant messages with tool_calls - they must be preserved for proper pairing
        if (newMessage.role === 'assistant' && newMessage.tool_calls && newMessage.tool_calls.length > 0) {
            return false; // Assistant messages with tool_calls must never be deduplicated
        }
        
        // Check recent messages for duplicates (last 10 messages, 30 second window)
        const recentMessages = this.conversationHistory.slice(-10);
        const now = Date.now();
        
        for (const existing of recentMessages) {
            // Time-based check - within 30 seconds
            if (Math.abs(now - existing.timestamp) > 30000) {
                continue;
            }
            
            // Exact content and role match
            if (existing.role === newMessage.role && existing.content === newMessage.content) {
                return true;
            }
            
            // Check for semantic duplicates - same message with different formatting
            if (this.areSemanticallySimilar(existing, newMessage)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Check if two messages are semantically similar (same core content, different formatting)
     */
    private areSemanticallySimilar(
        existing: ConversationMessage, 
        newMessage: { role: string; content: string; metadata?: Record<string, any>; tool_calls?: any[] }
    ): boolean {
        // Must be same role
        if (existing.role !== newMessage.role) {
            return false;
        }
        
        // Normalize content for comparison (remove formatting, whitespace, common prefixes)
        const normalizeContent = (content: string): string => {
            return content
                .replace(/^\[[^\]]+\]:\s*/, '') // Remove [agent]: prefix
                .replace(/^[🎯📨📋⚡🛠️💬]\s*/, '') // Remove emoji prefixes
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim()
                .toLowerCase();
        };
        
        const existingNormalized = normalizeContent(existing.content);
        const newNormalized = normalizeContent(newMessage.content);
        
        // Exact match after normalization
        if (existingNormalized === newNormalized) {
            return true;
        }
        
        // Check if one is a substring of the other (common with tool result formatting)
        if (existingNormalized.length > 50 && newNormalized.length > 50) {
            return existingNormalized.includes(newNormalized) || newNormalized.includes(existingNormalized);
        }
        
        // Check for messages that are clearly the same conversation turn but formatted differently
        // E.g., same metadata indicating same message source
        if (existing.metadata && newMessage.metadata) {
            const existingFromAgent = existing.metadata.fromAgentId || existing.metadata.agentId || existing.metadata.senderId;
            const newFromAgent = newMessage.metadata.fromAgentId || newMessage.metadata.agentId || newMessage.metadata.senderId;
            
            // Same sender, similar content length, and high content overlap
            if (existingFromAgent && existingFromAgent === newFromAgent) {
                const contentSimilarity = this.calculateContentSimilarity(existingNormalized, newNormalized);
                if (contentSimilarity > 0.8) { // 80% similarity threshold
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Calculate content similarity between two normalized strings
     */
    private calculateContentSimilarity(content1: string, content2: string): number {
        const words1 = new Set(content1.split(' ').filter(w => w.length > 2));
        const words2 = new Set(content2.split(' ').filter(w => w.length > 2));
        
        const intersection = new Set([...words1].filter(word => words2.has(word)));
        const union = new Set([...words1, ...words2]);
        
        return union.size > 0 ? intersection.size / union.size : 0;
    }

    /**
     * Update a conversation message at a specific index
     */
    public updateConversationMessage(index: number, message: ConversationMessage): void {
        if (index >= 0 && index < this.conversationHistory.length) {
            this.conversationHistory[index] = message;
            
            // Save memory asynchronously
            this.saveAgentMemory().catch(error => {
                this.logger.error(`Error saving updated conversation to memory: ${error instanceof Error ? error.message : String(error)}`);
            });
        } else {
            this.logger.warn(`Invalid conversation message index: ${index}`);
        }
    }

    /**
     * Get the current conversation history
     */
    public getConversationHistory(): ConversationMessage[] {
        return [...this.conversationHistory];
    }

    /**
     * Clear the conversation history, keeping system messages
     */
    public clearConversationHistory(): void {
        // Keep only system messages
        this.conversationHistory = this.conversationHistory.filter((msg: ConversationMessage) => msg.role === 'system');
        
        // Save the change
        this.saveAgentMemory().catch(error => {
            this.logger.error(`Error saving cleared conversation history: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    /**
     * Smart conversation history trimming that preserves tool call-result pairs
     */
    private trimConversationHistory(): void {
        if (this.conversationHistory.length <= this.config.maxHistory) {
            return; // No trimming needed
        }
        
        
        // Strategy: Remove complete conversation blocks while preserving tool call-result pairs
        const systemMessages = this.conversationHistory.filter(m => m.role === 'system');
        const nonSystemMessages = this.conversationHistory.filter(m => m.role !== 'system');
        
        // Group messages into conversation blocks (assistant + tool results + user responses)
        const conversationBlocks = this.groupIntoConversationBlocks(nonSystemMessages);
        
        // Remove oldest complete blocks until we're under the limit
        let totalMessages = systemMessages.length;
        const keepBlocks: ConversationMessage[][] = [];
        
        // Start from newest blocks and work backwards
        for (let i = conversationBlocks.length - 1; i >= 0; i--) {
            const block = conversationBlocks[i];
            if (totalMessages + block.length <= this.config.maxHistory) {
                totalMessages += block.length;
                keepBlocks.unshift(block); // Add to beginning to maintain order
            } else {
                break; // Stop here to stay under limit
            }
        }
        
        // Reconstruct conversation history with system messages + kept blocks
        this.conversationHistory = [
            ...systemMessages,
            ...keepBlocks.flat()
        ].sort((a, b) => a.timestamp - b.timestamp); // Maintain chronological order
        
    }

    /**
     * Index a conversation message to Meilisearch for semantic search
     * @private
     */
    private async indexConversationToMeilisearch(message: ConversationMessage): Promise<void> {
        if (!this.meilisearchService) {
            return; // Meilisearch not enabled
        }

        const operationId = uuidv4();
        const startTime = Date.now();

        // Check if semantic search (embeddings) is enabled
        const semanticSearchEnabled = process.env.ENABLE_SEMANTIC_SEARCH === 'true';

        if (semanticSearchEnabled) {
            // Option 1: Server handles indexing with embeddings
            // Emit event to server to index this message

            const eventData: MeilisearchIndexEventData = {
                operationId,
                indexName: 'mxf-conversations',
                documentId: message.id,
                documentType: 'conversation',
                success: true,
                duration: 0,
                metadata: {
                    agentId: this.config.agentId,
                    channelId: this.config.channelId,
                    timestamp: message.timestamp,
                    message: {
                        id: message.id,
                        role: message.role,
                        content: message.content,
                        timestamp: message.timestamp
                    }
                } as any // Extended metadata for indexing request
            };

            const payload = createMeilisearchIndexEventPayload(
                'meilisearch:index:request',
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit('meilisearch:index:request', payload);
            return;
        }

        // Option 2: SDK handles indexing (keyword search only, no embeddings)
        try {
            // Index the message to Meilisearch
            await this.meilisearchService.indexConversation({
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                metadata: {
                    agentId: this.config.agentId,
                    channelId: this.config.channelId,
                    ...message.metadata
                }
            });

            const duration = Date.now() - startTime;

            // Emit success event
            const eventData: MeilisearchIndexEventData = {
                operationId,
                indexName: 'mxf-conversations',
                documentId: message.id,
                documentType: 'conversation',
                success: true,
                duration,
                metadata: {
                    agentId: this.config.agentId,
                    channelId: this.config.channelId,
                    timestamp: message.timestamp
                }
            };

            const payload = createMeilisearchIndexEventPayload(
                'meilisearch:index',
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit('meilisearch:index', payload);

        } catch (error) {
            const duration = Date.now() - startTime;

            // Emit failure event
            const eventData: MeilisearchIndexEventData = {
                operationId,
                indexName: 'mxf-conversations',
                documentId: message.id,
                documentType: 'conversation',
                success: false,
                duration,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    agentId: this.config.agentId,
                    channelId: this.config.channelId,
                    timestamp: message.timestamp
                }
            };

            const payload = createMeilisearchIndexEventPayload(
                'meilisearch:index:error',
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit('meilisearch:index:error', payload);

            this.logger.warn(`Failed to index conversation to Meilisearch: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Backfill historical conversation messages to Meilisearch
     * Called when agent memory is loaded from MongoDB
     * @private
     */
    private async backfillConversationsToMeilisearch(messages: ConversationMessage[]): Promise<void> {
        if (!this.meilisearchService || messages.length === 0) {
            return; // Meilisearch not enabled or no messages to backfill
        }

        const operationId = uuidv4();
        const startTime = Date.now();

        // Check if semantic search (embeddings) is enabled
        const semanticSearchEnabled = process.env.ENABLE_SEMANTIC_SEARCH === 'true';

        if (semanticSearchEnabled) {
            // Option 1: Server handles backfill with embeddings
            // Emit event to server to backfill these messages

            const eventData: MeilisearchBackfillEventData = {
                operationId,
                indexName: 'mxf-conversations',
                totalDocuments: messages.length,
                indexedDocuments: 0,
                failedDocuments: 0,
                duration: 0,
                success: true,
                source: 'mongodb',
                metadata: {
                    agentId: this.config.agentId,
                    channelId: this.config.channelId,
                    startTimestamp: messages.length > 0 ? messages[0].timestamp : Date.now(),
                    endTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : Date.now(),
                    batchSize: 100,
                    messages: messages.map(m => ({
                        id: m.id,
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp
                    }))
                } as any // Extended metadata for backfill request
            };

            const payload = createMeilisearchBackfillEventPayload(
                'meilisearch:backfill:request',
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit('meilisearch:backfill:request', payload);
            return;
        }

        // Option 2: SDK handles backfill (keyword search only, no embeddings)
        let indexedCount = 0;
        let failedCount = 0;


        try {
            // Index messages in batches to avoid overwhelming Meilisearch
            const batchSize = 100;
            for (let i = 0; i < messages.length; i += batchSize) {
                const batch = messages.slice(i, i + batchSize);

                for (const message of batch) {
                    try {
                        await this.meilisearchService.indexConversation({
                            id: message.id,
                            role: message.role,
                            content: message.content,
                            timestamp: message.timestamp,
                            metadata: {
                                agentId: this.config.agentId,
                                channelId: this.config.channelId,
                                ...message.metadata
                            }
                        });
                        indexedCount++;
                    } catch (error) {
                        failedCount++;
                    }
                }

                // Small delay between batches to be gentle on Meilisearch
                if (i + batchSize < messages.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            const duration = Date.now() - startTime;
            const success = failedCount === 0;

            // Emit backfill event
            const eventData: MeilisearchBackfillEventData = {
                operationId,
                indexName: 'mxf-conversations',
                totalDocuments: messages.length,
                indexedDocuments: indexedCount,
                failedDocuments: failedCount,
                duration,
                success,
                source: 'mongodb',
                metadata: {
                    agentId: this.config.agentId,
                    channelId: this.config.channelId,
                    startTimestamp: messages.length > 0 ? messages[0].timestamp : Date.now(),
                    endTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : Date.now(),
                    batchSize
                }
            };

            const payload = createMeilisearchBackfillEventPayload(
                success ? 'meilisearch:backfill:complete' : 'meilisearch:backfill:partial',
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit(success ? 'meilisearch:backfill:complete' : 'meilisearch:backfill:partial', payload);

        } catch (error) {
            const duration = Date.now() - startTime;

            // Emit failure event
            const eventData: MeilisearchBackfillEventData = {
                operationId,
                indexName: 'mxf-conversations',
                totalDocuments: messages.length,
                indexedDocuments: indexedCount,
                failedDocuments: messages.length - indexedCount,
                duration,
                success: false,
                source: 'mongodb',
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    agentId: this.config.agentId,
                    channelId: this.config.channelId,
                    batchSize: 100
                }
            };

            const payload = createMeilisearchBackfillEventPayload(
                'meilisearch:backfill:error',
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit('meilisearch:backfill:error', payload);

            this.logger.error(`Meilisearch backfill failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Group messages into conversation blocks that should stay together
     */
    private groupIntoConversationBlocks(messages: ConversationMessage[]): ConversationMessage[][] {
        const blocks: ConversationMessage[][] = [];
        let currentBlock: ConversationMessage[] = [];
        
        for (const message of messages) {
            currentBlock.push(message);
            
            // Start new block after assistant responses that don't have pending tool results
            if (message.role === 'assistant') {
                // Check if this assistant message has tool_calls
                const hasToolCalls = (message as any).tool_calls && (message as any).tool_calls.length > 0;
                
                if (!hasToolCalls) {
                    // No tool calls, complete this block
                    blocks.push(currentBlock);
                    currentBlock = [];
                } else {
                    // Has tool calls, keep collecting until we see all tool results
                    // This will be completed when we see the next assistant message or user message
                    // that isn't a tool result
                }
            }
            
            // User messages that aren't tool results can end a block
            if (message.role === 'user' && !message.metadata?.isToolResult) {
                blocks.push(currentBlock);
                currentBlock = [];
            }
        }
        
        // Add any remaining messages as the final block
        if (currentBlock.length > 0) {
            blocks.push(currentBlock);
        }
        
        return blocks;
    }

    /**
     * Add an observation to the memory
     */
    public addObservation(observation: Observation): void {
        this.observations.push(observation);
        
        // Trim observations list if it exceeds the maximum limit
        if (this.observations.length > this.config.maxObservations) {
            this.observations = this.observations.slice(-this.config.maxObservations);
        }
        
        // Save memory asynchronously
        this.saveAgentMemory().catch(error => {
            this.logger.error(`Error saving observations to memory: ${error}`);
        });
    }

    /**
     * Set current reasoning
     */
    public setCurrentReasoning(reasoning: Reasoning): void {
        this.currentReasoning = reasoning;
        
        // Save memory asynchronously
        this.saveAgentMemory().catch(error => {
            this.logger.error(`Error saving reasoning to memory: ${error}`);
        });
    }

    /**
     * Set current plan
     */
    public setCurrentPlan(plan: Plan): void {
        this.currentPlan = plan;
        
        // Save memory asynchronously
        this.saveAgentMemory().catch(error => {
            this.logger.error(`Error saving plan to memory: ${error}`);
        });
    }

    /**
     * Get current observations
     */
    public getObservations(): Observation[] {
        return [...this.observations];
    }

    /**
     * Get current reasoning
     */
    public getCurrentReasoning(): Reasoning | null {
        return this.currentReasoning;
    }

    /**
     * Get current plan
     */
    public getCurrentPlan(): Plan | null {
        return this.currentPlan;
    }

    /**
     * Check if memory has been loaded
     */
    public isMemoryLoaded(): boolean {
        return this.memoryLoaded;
    }

    /**
     * Get memory statistics
     */
    public getMemoryStats(): {
        conversationMessages: number;
        observations: number;
        hasReasoning: boolean;
        hasPlan: boolean;
        memoryLoaded: boolean;
    } {
        return {
            conversationMessages: this.conversationHistory.length,
            observations: this.observations.length,
            hasReasoning: this.currentReasoning !== null,
            hasPlan: this.currentPlan !== null,
            memoryLoaded: this.memoryLoaded
        };
    }

    /**
     * Emit Meilisearch ready event (no backfill needed)
     * @private
     */
    private emitMeilisearchReady(): void {
        const eventData: MeilisearchBackfillEventData = {
            operationId: uuidv4(),
            indexName: 'mxf-conversations',
            totalDocuments: 0,
            indexedDocuments: 0,
            failedDocuments: 0,
            duration: 0,
            success: true,
            source: 'memory',
            metadata: {
                agentId: this.config.agentId,
                channelId: this.config.channelId,
                startTimestamp: Date.now(),
                endTimestamp: Date.now(),
                batchSize: 0
            }
        };

        const payload = createMeilisearchBackfillEventPayload(
            'meilisearch:backfill:complete',
            this.config.agentId,
            this.config.channelId,
            eventData,
            { source: 'MxfMemoryManager' }
        );

        this.eventBus.client.emit('meilisearch:backfill:complete', payload);
    }

    /**
     * Optimize memory by removing old or less important data
     */
    public optimizeMemory(): void {
        
        // Trim conversation history more aggressively if needed
        const targetHistorySize = Math.floor(this.config.maxHistory * 0.8);
        if (this.conversationHistory.length > targetHistorySize) {
            const systemMessages = this.conversationHistory.filter(m => m.role === 'system');
            const nonSystemMessages = this.conversationHistory.filter(m => m.role !== 'system');
            
            // Keep most recent non-system messages
            const trimmedNonSystem = nonSystemMessages.slice(-targetHistorySize + systemMessages.length);
            this.conversationHistory = [...systemMessages, ...trimmedNonSystem];
        }
        
        // Trim observations
        const targetObservationSize = Math.floor(this.config.maxObservations * 0.8);
        if (this.observations.length > targetObservationSize) {
            this.observations = this.observations.slice(-targetObservationSize);
        }
        
        
        // Save optimized memory
        this.saveAgentMemory().catch(error => {
            this.logger.error(`Error saving optimized memory: ${error}`);
        });
    }

    /**
     * Export memory for backup or analysis
     */
    public exportMemory(): {
        agentId: string;
        timestamp: number;
        conversationHistory: ConversationMessage[];
        observations: Observation[];
        currentReasoning: Reasoning | null;
        currentPlan: Plan | null;
        stats: {
            conversationMessages: number;
            observations: number;
            hasReasoning: boolean;
            hasPlan: boolean;
            memoryLoaded: boolean;
        };
    } {
        return {
            agentId: this.config.agentId,
            timestamp: Date.now(),
            conversationHistory: this.getConversationHistory(),
            observations: this.getObservations(),
            currentReasoning: this.getCurrentReasoning(),
            currentPlan: this.getCurrentPlan(),
            stats: this.getMemoryStats()
        };
    }

    /**
     * Import memory from backup
     */
    public async importMemory(memoryData: any): Promise<void> {
        try {
            
            if (memoryData.conversationHistory && Array.isArray(memoryData.conversationHistory)) {
                this.conversationHistory = memoryData.conversationHistory;
            }
            
            if (memoryData.observations && Array.isArray(memoryData.observations)) {
                this.observations = memoryData.observations;
            }
            
            if (memoryData.currentReasoning) {
                this.currentReasoning = memoryData.currentReasoning;
            }
            
            if (memoryData.currentPlan) {
                this.currentPlan = memoryData.currentPlan;
            }
            
            // Save imported memory
            await this.saveAgentMemory();

        } catch (error) {
            this.logger.error(`Error importing memory: ${error}`);
            throw error;
        }
    }
}