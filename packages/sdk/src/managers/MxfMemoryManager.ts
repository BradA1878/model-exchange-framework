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
 * Memory Manager for MxfAgent
 * 
 * Manages all memory operations including conversation history,
 * agent memory persistence, and memory optimization for LLM agents.
 */

import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { ConversationMessage } from '@mxf-dev/core/interfaces/ConversationMessage';
import { MxfMemoryService } from '../services/MxfMemoryService.js';
import { IAgentMemory, MemoryPersistenceLevel } from '@mxf-dev/core/types/MemoryTypes';
import { Observation, Reasoning, Plan } from '@mxf-dev/core/types/ControlLoopTypes';
import { v4 as uuidv4 } from 'uuid';
import { firstValueFrom } from 'rxjs';
import { MxfMeilisearchService } from '@mxf-dev/core/services/MxfMeilisearchService';
import {
    BaseEventPayload,
    createAgentEventPayload,
    createMeilisearchIndexEventPayload,
    createMeilisearchBackfillEventPayload,
    MeilisearchIndexEventData,
    MeilisearchBackfillEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { AnyEventName } from '@mxf-dev/core/events/EventBusBase';
import { Events } from '@mxf-dev/core/events/EventNames';

export interface MemoryManagerConfig {
    agentId: string;
    channelId: string;
    maxHistory: number;
    maxObservations: number;
    enablePersistence: boolean;
    enableDeduplication?: boolean;
    maxMessageSize?: number; // Max size in bytes for a single message (default: 100KB)
}

export interface ConversationMessageInput {
    role: ConversationMessage['role'];
    content: string;
    metadata?: ConversationMessage['metadata'];
    tool_calls?: ConversationMessage['tool_calls'];
}

interface ImportedMemoryData {
    conversationHistory?: ConversationMessage[];
    observations?: Observation[];
    currentReasoning?: Reasoning | null;
    currentPlan?: Plan | null;
}

/**
 * The server answered a search-index request with a failure event.
 *
 * `retryAfterMs` is set when the server throttled the request; the indexing
 * queue waits that long and sends the same document again. Any other
 * rejection is final for that document.
 */
export class MeilisearchIndexRejectedError extends Error {
    public readonly retryAfterMs: number | null;

    constructor(message: string, retryAfterMs: number | null) {
        super(message);
        this.name = 'MeilisearchIndexRejectedError';
        this.retryAfterMs = retryAfterMs;
    }
}

/**
 * A search-index request could not be sent, or was cut off, because the
 * agent socket is not connected. Nothing was indexed.
 */
export class MeilisearchTransportUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MeilisearchTransportUnavailableError';
    }
}

export class MxfMemoryManager {
    private readonly config: MemoryManagerConfig;
    private readonly logger: Logger;
    private readonly agentId: string;
    private conversationHistory: ConversationMessage[] = [];
    /**
     * Complete desired persisted history. The working history intentionally rolls at
     * maxHistory, while this snapshot retains older messages until an explicit
     * clear/compact operation replaces it.
     */
    private authoritativeConversationHistory: ConversationMessage[] = [];
    private observations: Observation[] = [];
    private currentReasoning: Reasoning | null = null;
    private currentPlan: Plan | null = null;
    private memoryLoaded = false;
    private readonly enableDeduplication: boolean;
    private meilisearchService: MxfMeilisearchService | null = null; // Meilisearch integration for semantic search
    private readonly eventBus: typeof EventBus = EventBus;
    private readonly maxMessageSize: number;
    private memoryIdentity: Pick<IAgentMemory, 'id' | 'createdAt' | 'persistenceLevel'>;

    /**
     * Every local mutation receives a monotonically increasing revision. Revisions
     * stay queued until the server acknowledges an authoritative snapshot that
     * contains them. A failed write therefore cannot advance the cursor or lose work.
     */
    private nextPersistenceRevision = 0;
    private persistedRevision = 0;
    private pendingPersistenceRevisions: number[] = [];
    private saveInFlight: Promise<void> | null = null;

    /**
     * Search indexing runs behind the conversation, one request at a time, in
     * arrival order. The head of the queue is the request in flight; it leaves
     * the queue only when the server acknowledges it or rejects it for good.
     */
    private readonly indexQueue: ConversationMessage[] = [];
    private indexDrain: Promise<void> | null = null;
    /** Reason indexing was stopped for good (agent disconnect), or null while it runs. */
    private indexingStopped: string | null = null;
    /** The wait for a server retry hint, so stopIndexing() can cut it short. */
    private retryWait: { timer: NodeJS.Timeout; cancel: () => void } | null = null;
    /** Settle functions of index requests in flight, keyed by operation id. */
    private readonly pendingIndexOperations = new Map<string, (error: Error) => void>();

    constructor(config: MemoryManagerConfig) {
        if (typeof config.agentId !== 'string' || config.agentId.trim() === '') {
            throw new Error('MxfMemoryManager requires a non-empty agentId');
        }
        if (typeof config.channelId !== 'string' || config.channelId.trim() === '') {
            throw new Error('MxfMemoryManager requires a non-empty channelId');
        }
        if (!Number.isInteger(config.maxHistory) || config.maxHistory <= 0) {
            throw new Error('MxfMemoryManager maxHistory must be a positive integer');
        }
        if (!Number.isInteger(config.maxObservations) || config.maxObservations <= 0) {
            throw new Error('MxfMemoryManager maxObservations must be a positive integer');
        }
        if (config.maxMessageSize !== undefined &&
            (!Number.isInteger(config.maxMessageSize) || config.maxMessageSize <= 0)) {
            throw new Error('MxfMemoryManager maxMessageSize must be a positive integer');
        }

        this.config = config;
        this.logger = new Logger('debug', `MemoryManager:${config.agentId}`, 'client');
        this.agentId = config.agentId;
        this.enableDeduplication = config.enableDeduplication ?? false;
        this.maxMessageSize = config.maxMessageSize ?? 100 * 1024;
        this.memoryIdentity = {
            id: `agent-memory-${config.agentId}`,
            createdAt: new Date(),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT
        };

        // Initialize Meilisearch service if enabled
        if (process.env.ENABLE_MEILISEARCH === 'true') {
            const host = process.env.MEILISEARCH_HOST;
            const apiKey = process.env.MEILISEARCH_MASTER_KEY;
            if (!host || host.trim() === '') {
                throw new Error('MEILISEARCH_HOST is required when ENABLE_MEILISEARCH=true');
            }
            if (!apiKey || apiKey.trim() === '') {
                throw new Error('MEILISEARCH_MASTER_KEY is required when ENABLE_MEILISEARCH=true');
            }
            this.meilisearchService = MxfMeilisearchService.getInstance({
                host,
                apiKey,
                loggerContext: 'client'
            });
        }
    }

    /**
     * Initialize the memory manager and load existing memory
     */
    public async initialize(): Promise<void> {
        // One manager serves every connect() of its agent. A stop from the
        // previous session (agent disconnect) ends with the next initialize.
        this.indexingStopped = null;

        if (this.config.enablePersistence) {
            await this.loadAgentMemory();
        }
    }

    /**
     * Load agent memory from the memory system
     */
    public async loadAgentMemory(): Promise<void> {
        try {
            // Get memory from the memory service
            const memory = await firstValueFrom(
                MxfMemoryService.getInstance().getAgentMemory(
                    this.config.agentId,
                    this.config.channelId
                )
            );
            this.memoryIdentity = {
                id: memory.id,
                createdAt: memory.createdAt,
                persistenceLevel: memory.persistenceLevel
            };
            
            // If memory has conversation history, index it to Meilisearch but DON'T inject into prompts
            if (memory.conversationHistory && Array.isArray(memory.conversationHistory)) {
                this.authoritativeConversationHistory = [
                    ...memory.conversationHistory as ConversationMessage[]
                ];

                if (this.conversationHistory.length === 0 && memory.conversationHistory.length > 0) {
                    // ✅ NEW ARCHITECTURE: Don't restore to working memory
                    // Historical conversations are indexed to Meilisearch for searching
                    // but NOT injected into prompts to avoid temporal confusion


                    // Backfill historical messages to Meilisearch (async, non-blocking)
                    if (this.meilisearchService) {
                        await this.backfillConversationsToMeilisearch(memory.conversationHistory);
                    } else {
                        this.emitMeilisearchReady();
                    }
                } else if (this.conversationHistory.length === 0 && memory.conversationHistory.length === 0) {
                    // New agent with no history - emit ready event immediately
                    this.emitMeilisearchReady();
                }
            } else {
                this.authoritativeConversationHistory = [];
                // No conversation history at all - new agent
                this.emitMeilisearchReady();
            }

            this.nextPersistenceRevision = 0;
            this.persistedRevision = 0;
            this.pendingPersistenceRevisions = [];

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
            throw error;
        }
    }

    /**
     * Save the complete desired agent-memory state.
     *
     * Writes are serialized and revision-driven. Mutations that arrive while a
     * request is in flight are written by the next loop iteration. The cursor only
     * advances after acknowledgement, so retrying a failed request neither skips nor
     * duplicates a message, even when the working history has rolled.
     */
    public saveAgentMemory(): Promise<void> {
        if (!this.config.enablePersistence || this.pendingPersistenceRevisions.length === 0) {
            return Promise.resolve();
        }

        if (this.saveInFlight) {
            return this.saveInFlight;
        }

        const operation = this.flushPendingMemory();
        this.saveInFlight = operation;
        operation.then(
            () => {
                if (this.saveInFlight === operation) {
                    this.saveInFlight = null;
                }
            },
            () => {
                if (this.saveInFlight === operation) {
                    this.saveInFlight = null;
                }
            }
        );
        return operation;
    }

    private async flushPendingMemory(): Promise<void> {
        while (this.pendingPersistenceRevisions.length > 0) {
            const snapshotRevision = this.pendingPersistenceRevisions.at(-1)!;
            const memoryData = this.createAuthoritativeMemorySnapshot();

            try {
                await firstValueFrom(
                    MxfMemoryService.getInstance().updateAgentMemory(
                        this.config.agentId,
                        this.config.channelId,
                        memoryData
                    )
                );
            } catch (error) {
                this.logger.error(
                    `Error saving agent memory revision ${snapshotRevision}: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
                throw error;
            }

            this.persistedRevision = snapshotRevision;
            this.pendingPersistenceRevisions = this.pendingPersistenceRevisions
                .filter(revision => revision > this.persistedRevision);
        }
    }

    private createAuthoritativeMemorySnapshot(): IAgentMemory {
        const memoryData: IAgentMemory = {
            id: this.memoryIdentity.id,
            agentId: this.config.agentId,
            createdAt: this.memoryIdentity.createdAt,
            updatedAt: new Date(),
            persistenceLevel: this.memoryIdentity.persistenceLevel,
            conversationHistory: [...this.authoritativeConversationHistory],
            notes: {
                recentObservations: [...this.observations],
                currentReasoning: this.currentReasoning,
                currentPlan: this.currentPlan
            }
        };
        const safeDocumentLimit = 12 * 1024 * 1024;
        const estimatedSize = Buffer.byteLength(JSON.stringify(memoryData), 'utf8');
        if (estimatedSize > safeDocumentLimit) {
            throw new Error(
                `Agent memory snapshot is ${(estimatedSize / 1024 / 1024).toFixed(2)}MB, ` +
                `above the 12MB safe persistence limit; compact or clear it explicitly`
            );
        }
        return memoryData;
    }

    private markMemoryDirty(): number {
        this.nextPersistenceRevision += 1;
        this.pendingPersistenceRevisions.push(this.nextPersistenceRevision);
        return this.nextPersistenceRevision;
    }

    private awaitMeilisearchOperation<
        TData extends { operationId: string; success: boolean; error?: string; retryAfterMs?: number }
    >(
        requestEvent: typeof MeilisearchEvents.INDEX_REQUEST |
            typeof MeilisearchEvents.BACKFILL_REQUEST,
        payload: BaseEventPayload<TData>,
        successEvents: readonly AnyEventName[],
        failureEvents: readonly AnyEventName[]
    ): Promise<TData> {
        return new Promise<TData>((resolve, reject) => {
            let settled = false;
            const listeners = new Map<AnyEventName, (rawEvent: unknown) => void>();
            const failureEventSet = new Set(failureEvents);

            const cleanup = (): void => {
                listeners.forEach((handler, eventName) => {
                    this.eventBus.client.off(eventName, handler);
                });
                this.eventBus.client.off(Events.Agent.DISCONNECT, disconnectHandler);
                this.pendingIndexOperations.delete(payload.data.operationId);
            };
            const settleError = (error: unknown): void => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            };
            const responseHandler = (eventName: AnyEventName) => (rawEvent: unknown): void => {
                if (!rawEvent || typeof rawEvent !== 'object') {
                    return;
                }
                const event = rawEvent as {
                    agentId?: string;
                    channelId?: string;
                    data?: Partial<TData>;
                };
                const data = event.data;
                if (event.agentId !== this.agentId ||
                    event.channelId !== this.config.channelId ||
                    data?.operationId !== payload.data.operationId || settled) {
                    return;
                }

                if (failureEventSet.has(eventName) || data.success !== true) {
                    const retryAfterMs = typeof data.retryAfterMs === 'number' &&
                        Number.isFinite(data.retryAfterMs) && data.retryAfterMs > 0
                        ? data.retryAfterMs
                        : null;
                    settleError(new MeilisearchIndexRejectedError(
                        data.error ?? `${String(requestEvent)} failed`,
                        retryAfterMs
                    ));
                    return;
                }

                settled = true;
                cleanup();
                resolve(data as TData);
            };
            const disconnectHandler = (rawEvent: unknown): void => {
                if (!rawEvent || typeof rawEvent !== 'object') {
                    return;
                }
                const event = rawEvent as {
                    agentId?: string;
                    data?: { agentId?: string; reason?: string };
                };
                const disconnectedAgentId = event.agentId ?? event.data?.agentId;
                if (disconnectedAgentId !== this.agentId) {
                    return;
                }
                const reason = event.data?.reason ? `: ${event.data.reason}` : '';
                settleError(new MeilisearchTransportUnavailableError(
                    `${String(requestEvent)} cancelled because agent ${this.agentId} ` +
                    `disconnected${reason}`
                ));
            };

            // MxfService emits Agent.DISCONNECT locally when this agent's socket
            // drops. (Agent.DISCONNECTED is the server's announcement to other
            // sockets and never reaches the agent that disconnected, so waiting
            // for it left this request pending forever.)
            [...successEvents, ...failureEvents].forEach(eventName => {
                const handler = responseHandler(eventName);
                listeners.set(eventName, handler);
                this.eventBus.client.on(eventName, handler);
            });
            this.eventBus.client.on(Events.Agent.DISCONNECT, disconnectHandler);
            this.pendingIndexOperations.set(payload.data.operationId, settleError);

            // emitOn() falls back to the primary socket and only logs when no
            // transport is available, which would leave this request pending
            // forever. Refuse up front instead.
            if (!this.eventBus.client.isRegisteredSocketConnected(this.agentId)) {
                settleError(new MeilisearchTransportUnavailableError(
                    `${String(requestEvent)} not sent: agent ${this.agentId} has no connected socket`
                ));
                return;
            }

            try {
                this.eventBus.client.emitOn(this.agentId, requestEvent, payload);
            } catch (error) {
                settleError(error);
            }
        });
    }

    /**
     * Add a message to the conversation history with optional deduplication
     */
    public async addConversationMessage(message: ConversationMessageInput): Promise<void> {
        // Calculate message size to prevent MongoDB 16MB document limit
        const messageSize = Buffer.byteLength(JSON.stringify(message), 'utf8');
        if (messageSize > this.maxMessageSize) {
            throw new Error(
                `Conversation message is ${messageSize} bytes, above the configured ` +
                `${this.maxMessageSize}-byte persistence limit`
            );
        }

        if (this.enableDeduplication) {
            const isDuplicate = this.isDuplicateMessage(message);

            if (isDuplicate) {
                return;
            }
        }
        const conversationMessage = this.createConversationMessage(message);

        // Add to history
        this.conversationHistory.push(conversationMessage);
        this.authoritativeConversationHistory.push(conversationMessage);
        this.markMemoryDirty();

        // Maintain max history length
        this.trimConversationHistory();

        await this.saveAgentMemory();

        // Search indexing happens behind the conversation: the message is queued
        // and the caller returns once it is in history and persisted. A rejected or
        // throttled index request is handled by the queue (see drainIndexQueue) and
        // never aborts the agent's turn. Before this, the request was awaited here
        // and one throttled index call failed the agent's whole generation loop.
        // Skip system role messages - they contain dynamically generated prompts that are:
        // 1. Redundant (already sent with every LLM request)
        // 2. Large (full tool schemas, guidelines, etc.)
        // 3. Not useful for semantic search (framework boilerplate, not conversation content)
        // Also skip messages with no text: an assistant turn that only calls a tool
        // has empty content, there is nothing to search, and the server refuses an
        // empty document.
        if (this.meilisearchService &&
            message.role !== 'system' &&
            conversationMessage.content.trim().length > 0) {
            this.enqueueConversationIndex(conversationMessage);
        }
    }

    /**
     * Number of conversation messages waiting to be indexed, including the
     * one in flight.
     */
    public pendingIndexCount(): number {
        return this.indexQueue.length;
    }

    /**
     * Resolve once the index queue has drained, or indexing has been stopped.
     * Resolves immediately when nothing is queued. Never rejects: index
     * failures are logged and published as Meilisearch events, not thrown.
     */
    public flushIndexQueue(): Promise<void> {
        return this.indexDrain ?? Promise.resolve();
    }

    /**
     * Stop search indexing for good: cut short a retry wait, settle the request
     * in flight, and drop whatever is queued. Called when the agent disconnects.
     * Messages dropped here are still in persisted history and are indexed
     * from it when the agent's memory is next loaded.
     */
    public stopIndexing(reason: string): void {
        if (this.indexingStopped !== null) {
            return;
        }
        this.indexingStopped = reason;
        const dropped = this.indexQueue.length;
        this.indexQueue.length = 0;
        this.retryWait?.cancel();
        for (const settle of [...this.pendingIndexOperations.values()]) {
            settle(new MeilisearchTransportUnavailableError(`Search indexing stopped: ${reason}`));
        }
        if (dropped > 0) {
            this.logger.info(
                `Search indexing stopped (${reason}); ${dropped} queued message(s) not indexed now — ` +
                'they are indexed from persisted history at the next memory load'
            );
        }
    }

    private enqueueConversationIndex(message: ConversationMessage): void {
        if (this.indexingStopped !== null) {
            this.logger.debug(`Search indexing is stopped (${this.indexingStopped}); not indexing message ${message.id}`);
            return;
        }
        this.indexQueue.push(message);
        if (!this.indexDrain) {
            const drain = this.drainIndexQueue().finally(() => {
                if (this.indexDrain === drain) {
                    this.indexDrain = null;
                }
            });
            this.indexDrain = drain;
        }
    }

    /**
     * Send queued index requests one at a time, in order.
     *
     * - throttled (the server sent a retry hint): wait that long, resend the
     *   same document
     * - rejected for any other reason: drop the document; the failure was
     *   already logged and published as MeilisearchEvents.INDEX_ERROR
     * - no connected agent socket: drop the whole queue once, keep accepting
     *   new messages — persisted history is indexed at the next memory load
     */
    private async drainIndexQueue(): Promise<void> {
        while (this.indexQueue.length > 0 && this.indexingStopped === null) {
            const message = this.indexQueue[0];
            try {
                await this.indexConversationToMeilisearch(message);
                this.indexQueue.shift();
            } catch (error) {
                if (this.indexingStopped !== null) {
                    return;
                }
                if (error instanceof MeilisearchIndexRejectedError && error.retryAfterMs !== null) {
                    this.logger.warn(
                        `Search indexing throttled; retrying message ${message.id} in ${error.retryAfterMs}ms ` +
                        `(${this.indexQueue.length} queued)`
                    );
                    await this.waitForRetry(error.retryAfterMs);
                    continue;
                }
                if (error instanceof MeilisearchTransportUnavailableError) {
                    const dropped = this.indexQueue.length;
                    this.indexQueue.length = 0;
                    this.logger.warn(
                        `${error.message}; ${dropped} queued message(s) not indexed now — ` +
                        'they are indexed from persisted history at the next memory load'
                    );
                    return;
                }
                this.indexQueue.shift();
                this.logger.error(
                    `Search indexing of message ${message.id} failed and is not retried: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    /** Wait for the server's retry hint. stopIndexing() resolves it early. */
    private waitForRetry(retryAfterMs: number): Promise<void> {
        return new Promise<void>(resolve => {
            const finish = (): void => {
                if (this.retryWait?.timer === timer) {
                    this.retryWait = null;
                }
                resolve();
            };
            const timer = setTimeout(finish, retryAfterMs);
            // A pending retry must not be what keeps the process alive.
            timer.unref?.();
            this.retryWait = {
                timer,
                cancel: (): void => {
                    clearTimeout(timer);
                    finish();
                }
            };
        });
    }

    private createConversationMessage(message: ConversationMessageInput): ConversationMessage {
        return {
            id: uuidv4(),
            role: message.role,
            content: message.content,
            timestamp: Date.now(),
            metadata: message.metadata,
            tool_calls: message.tool_calls
        };
    }


    /**
     * Enhanced duplicate message detection
     */
    private isDuplicateMessage(newMessage: ConversationMessageInput): boolean {
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
        newMessage: ConversationMessageInput
    ): boolean {
        // Must be same role
        if (existing.role !== newMessage.role) {
            return false;
        }
        
        // Normalize content for comparison (remove formatting, whitespace, common prefixes)
        const normalizeContent = (content: string): string => {
            return content
                .replace(/^\[[^\]]+\]:\s*/, '') // Remove [agent]: prefix
                .replace(/^(?:🎯|📨|📋|⚡|🛠️|💬)\s*/u, '') // Remove emoji prefixes
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
    public async updateConversationMessage(index: number, message: ConversationMessage): Promise<void> {
        if (!Number.isInteger(index) || index < 0 || index >= this.conversationHistory.length) {
            throw new Error(`Invalid conversation message index: ${index}`);
        }

        const previousMessage = this.conversationHistory[index];
        const authoritativeIndex = this.authoritativeConversationHistory
            .findIndex(candidate => candidate.id === previousMessage.id);
        if (authoritativeIndex < 0) {
            throw new Error(
                `Conversation message '${previousMessage.id}' is missing from authoritative memory`
            );
        }

        this.conversationHistory[index] = message;
        this.authoritativeConversationHistory[authoritativeIndex] = message;
        this.markMemoryDirty();
        await this.saveAgentMemory();
    }

    /**
     * Get the current conversation history
     */
    public getConversationHistory(): ConversationMessage[] {
        return [...this.conversationHistory];
    }

    /**
     * Clear the conversation history, keeping system messages.
     * Awaits the save so callers can guarantee the cleared state is persisted
     * before starting a new turn (prevents stale 10.80MB warnings from racing saves).
     */
    public async clearConversationHistory(): Promise<void> {
        // Keep only system messages
        this.conversationHistory = this.conversationHistory.filter((msg: ConversationMessage) => msg.role === 'system');
        this.authoritativeConversationHistory = [...this.conversationHistory];
        this.markMemoryDirty();
        await this.saveAgentMemory();
    }

    /**
     * Compact the conversation history to free context window space.
     * Keeps the most recent messages and system messages, removes older blocks
     * while preserving tool call-result pair integrity.
     * Emits CONTEXT_COMPACTED event with before/after counts.
     *
     * @param keepRecent - Number of recent non-system messages to keep (default: half of maxHistory)
     * @returns Object with originalMessages and compactedMessages counts
     */
    public async compactConversation(keepRecent?: number): Promise<{ originalMessages: number; compactedMessages: number }> {
        if (keepRecent !== undefined && (!Number.isInteger(keepRecent) || keepRecent < 0)) {
            throw new Error('keepRecent must be a non-negative integer');
        }
        const originalCount = this.conversationHistory.length;

        // Target: keep half of maxHistory by default (aggressive compaction to buy headroom)
        const targetKeep = keepRecent ?? Math.floor(this.config.maxHistory / 2);

        if (originalCount <= targetKeep) {
            this.logger.info(`[MemoryManager] Compact skipped — only ${originalCount} messages (target: ${targetKeep})`);
            return { originalMessages: originalCount, compactedMessages: originalCount };
        }

        // Separate system messages (always kept) from conversation messages
        const systemMessages = this.conversationHistory.filter(m => m.role === 'system');
        const nonSystemMessages = this.conversationHistory.filter(m => m.role !== 'system');

        // Group into conversation blocks to avoid orphaning tool call-result pairs
        const blocks = this.groupIntoConversationBlocks(nonSystemMessages);

        // Keep the newest blocks that fit in the target
        let keptCount = 0;
        const keepBlocks: ConversationMessage[][] = [];
        for (let i = blocks.length - 1; i >= 0; i--) {
            const block = blocks[i];
            if (keptCount + block.length <= targetKeep) {
                keptCount += block.length;
                keepBlocks.unshift(block);
            } else {
                break;
            }
        }

        // Reconstruct with system messages + kept blocks, chronological order
        this.conversationHistory = [
            ...systemMessages,
            ...keepBlocks.flat(),
        ].sort((a, b) => a.timestamp - b.timestamp);

        this.authoritativeConversationHistory = [...this.conversationHistory];
        this.markMemoryDirty();

        const compactedCount = this.conversationHistory.length;
        this.logger.info(
            `[MemoryManager] Compacted conversation: ${originalCount} → ${compactedCount} messages ` +
            `(removed ${originalCount - compactedCount} oldest messages)`
        );

        await this.saveAgentMemory();

        // Emit compaction event for TUI notification
        this.eventBus.client.emit(
            Events.Agent.CONTEXT_COMPACTED,
            createAgentEventPayload(
                Events.Agent.CONTEXT_COMPACTED,
                this.agentId,
                this.config.channelId,
                {
                    agentId: this.agentId,
                    originalMessages: originalCount,
                    compactedMessages: compactedCount,
                    timestamp: Date.now()
                },
                { source: 'MxfMemoryManager' }
            )
        );

        return { originalMessages: originalCount, compactedMessages: compactedCount };
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
            const metadata: NonNullable<MeilisearchIndexEventData['metadata']> & {
                message: Pick<ConversationMessage, 'id' | 'role' | 'content' | 'timestamp'>;
            } = {
                agentId: this.config.agentId,
                channelId: this.config.channelId,
                timestamp: message.timestamp,
                message: {
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    timestamp: message.timestamp
                }
            };
            const eventData: MeilisearchIndexEventData = {
                operationId,
                indexName: 'mxf-conversations',
                documentId: message.id,
                documentType: 'conversation',
                success: true,
                duration: 0,
                metadata
            };

            const payload = createMeilisearchIndexEventPayload(
                MeilisearchEvents.INDEX_REQUEST,
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            await this.awaitMeilisearchOperation(
                MeilisearchEvents.INDEX_REQUEST,
                payload,
                [MeilisearchEvents.INDEX],
                [MeilisearchEvents.INDEX_ERROR]
            );
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
                MeilisearchEvents.INDEX,
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit(MeilisearchEvents.INDEX, payload);

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
                MeilisearchEvents.INDEX_ERROR,
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit(MeilisearchEvents.INDEX_ERROR, payload);

            // The index queue logs the failure once, with the queue's decision.
            throw error;
        }
    }

    /**
     * Send one backfill batch and await its acknowledgement. A throttled batch
     * is sent again after the server's retry hint; any other failure propagates
     * to initialize(), because a missing backfill is a startup problem.
     */
    private async sendBackfillBatch(payload: BaseEventPayload<MeilisearchBackfillEventData>): Promise<void> {
        for (;;) {
            try {
                await this.awaitMeilisearchOperation(
                    MeilisearchEvents.BACKFILL_REQUEST,
                    payload,
                    [MeilisearchEvents.BACKFILL_COMPLETE],
                    [
                        MeilisearchEvents.BACKFILL_PARTIAL,
                        MeilisearchEvents.BACKFILL_ERROR
                    ]
                );
                return;
            } catch (error) {
                if (error instanceof MeilisearchIndexRejectedError && error.retryAfterMs !== null) {
                    this.logger.warn(
                        `Search backfill throttled; retrying batch of ${payload.data.totalDocuments} ` +
                        `in ${error.retryAfterMs}ms`
                    );
                    await this.waitForRetry(error.retryAfterMs);
                    // stopIndexing() cuts the wait short; the batch must not be resent
                    // against a connection that is closing.
                    if (this.indexingStopped !== null) {
                        throw new MeilisearchTransportUnavailableError(
                            `Search indexing stopped: ${this.indexingStopped}`
                        );
                    }
                    continue;
                }
                throw error;
            }
        }
    }

    /**
     * Backfill historical conversation messages to Meilisearch
     * Called when agent memory is loaded from MongoDB
     * @private
     */
    private async backfillConversationsToMeilisearch(history: ConversationMessage[]): Promise<void> {
        if (!this.meilisearchService) {
            return; // Meilisearch not enabled
        }

        // Same rule as live indexing: system prompts are framework boilerplate and
        // a message with no text (a tool-call-only turn) has nothing to search.
        // The server refuses both, and one refusal fails the whole batch.
        const messages = history.filter(message =>
            message.role !== 'system' && message.content.trim().length > 0
        );
        if (messages.length === 0) {
            return; // Nothing to backfill
        }

        const operationId = uuidv4();
        const startTime = Date.now();

        // Check if semantic search (embeddings) is enabled
        const semanticSearchEnabled = process.env.ENABLE_SEMANTIC_SEARCH === 'true';

        if (semanticSearchEnabled) {
            // The authenticated server boundary accepts at most 50 documents per
            // request. Each batch is correlated and acknowledged before the next is
            // sent, so a partial/error response is visible to initialize().
            const semanticBatchSize = 50;
            for (let index = 0; index < messages.length; index += semanticBatchSize) {
                const batch = messages.slice(index, index + semanticBatchSize);
                const batchOperationId = uuidv4();
                const metadata: NonNullable<MeilisearchBackfillEventData['metadata']> & {
                    messages: Array<Pick<
                        ConversationMessage,
                        'id' | 'role' | 'content' | 'timestamp'
                    >>;
                } = {
                    agentId: this.config.agentId,
                    channelId: this.config.channelId,
                    startTimestamp: batch[0].timestamp,
                    endTimestamp: batch[batch.length - 1].timestamp,
                    batchSize: semanticBatchSize,
                    messages: batch.map(message => ({
                        id: message.id,
                        role: message.role,
                        content: message.content,
                        timestamp: message.timestamp
                    }))
                };
                const eventData: MeilisearchBackfillEventData & {
                    documentType: 'conversation';
                } = {
                    operationId: batchOperationId,
                    indexName: 'mxf-conversations',
                    documentType: 'conversation',
                    totalDocuments: batch.length,
                    indexedDocuments: 0,
                    failedDocuments: 0,
                    duration: 0,
                    success: true,
                    source: 'mongodb',
                    metadata
                };

                const payload = createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_REQUEST,
                    this.config.agentId,
                    this.config.channelId,
                    eventData,
                    { source: 'MxfMemoryManager' }
                );

                await this.sendBackfillBatch(payload);
            }
            return;
        }

        // Option 2: SDK handles backfill (keyword search only, no embeddings)
        let indexedCount = 0;

        try {
            // Index messages in batches to avoid overwhelming Meilisearch
            const batchSize = 100;
            for (let i = 0; i < messages.length; i += batchSize) {
                const batch = messages.slice(i, i + batchSize);

                for (const message of batch) {
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
                }
            }

            const duration = Date.now() - startTime;

            // Emit backfill event
            const eventData: MeilisearchBackfillEventData = {
                operationId,
                indexName: 'mxf-conversations',
                totalDocuments: messages.length,
                indexedDocuments: indexedCount,
                failedDocuments: 0,
                duration,
                success: true,
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
                MeilisearchEvents.BACKFILL_COMPLETE,
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit(MeilisearchEvents.BACKFILL_COMPLETE, payload);

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
                MeilisearchEvents.BACKFILL_ERROR,
                this.config.agentId,
                this.config.channelId,
                eventData,
                { source: 'MxfMemoryManager' }
            );

            this.eventBus.client.emit(MeilisearchEvents.BACKFILL_ERROR, payload);

            this.logger.error(`Meilisearch backfill failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
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
                const hasToolCalls = (message.tool_calls?.length ?? 0) > 0;
                
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
    public async addObservation(observation: Observation): Promise<void> {
        this.observations.push(observation);
        
        // Trim observations list if it exceeds the maximum limit
        if (this.observations.length > this.config.maxObservations) {
            this.observations = this.observations.slice(-this.config.maxObservations);
        }

        this.markMemoryDirty();
        await this.saveAgentMemory();
    }

    /**
     * Set current reasoning
     */
    public async setCurrentReasoning(reasoning: Reasoning): Promise<void> {
        this.currentReasoning = reasoning;
        this.markMemoryDirty();
        await this.saveAgentMemory();
    }

    /**
     * Set current plan
     */
    public async setCurrentPlan(plan: Plan): Promise<void> {
        this.currentPlan = plan;
        this.markMemoryDirty();
        await this.saveAgentMemory();
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
            MeilisearchEvents.BACKFILL_COMPLETE,
            this.config.agentId,
            this.config.channelId,
            eventData,
            { source: 'MxfMemoryManager' }
        );

        this.eventBus.client.emit(MeilisearchEvents.BACKFILL_COMPLETE, payload);
    }

    /**
     * Optimize memory by removing old or less important data
     */
    public async optimizeMemory(): Promise<void> {
        
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
        
        
        this.authoritativeConversationHistory = [...this.conversationHistory];
        this.markMemoryDirty();
        await this.saveAgentMemory();
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
    public async importMemory(memoryData: ImportedMemoryData): Promise<void> {
        if (!memoryData || typeof memoryData !== 'object') {
            throw new Error('Imported memory must be an object');
        }

        if (memoryData.conversationHistory !== undefined) {
            if (!Array.isArray(memoryData.conversationHistory)) {
                throw new Error('Imported conversationHistory must be an array');
            }
            this.conversationHistory = [...memoryData.conversationHistory];
            this.trimConversationHistory();
            this.authoritativeConversationHistory = [...memoryData.conversationHistory];
        }

        if (memoryData.observations !== undefined) {
            if (!Array.isArray(memoryData.observations)) {
                throw new Error('Imported observations must be an array');
            }
            this.observations = memoryData.observations.slice(-this.config.maxObservations);
        }

        if (memoryData.currentReasoning !== undefined) {
            this.currentReasoning = memoryData.currentReasoning;
        }

        if (memoryData.currentPlan !== undefined) {
            this.currentPlan = memoryData.currentPlan;
        }

        this.markMemoryDirty();
        await this.saveAgentMemory();
    }
}
