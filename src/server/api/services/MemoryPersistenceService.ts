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
 * Memory Persistence Service
 * 
 * This service provides persistent storage for the Memory System.
 * Pure database operations service - no caching.
 */

import { Observable, from, throwError } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

import { 
    IAgentMemory, 
    IChannelMemory, 
    IRelationshipMemory,
    MemoryScope, 
    MemoryPersistenceLevel,
    createMemoryValidator
} from '@mxf-dev/core/types/MemoryTypes';

import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    AgentMemory,
    ChannelMemory,
    RelationshipMemory
} from '@mxf-dev/core/models/memory';
import {
    MemoryEntryModel,
    SurpriseHistoryModel,
    MemoryPatternModel
} from '@mxf-dev/core/models/memoryStrata';
import { MemoryUtility } from '@mxf-dev/core/models/memoryUtility';
import { MemoryUtilitySubdocument } from '@mxf-dev/core/types/MemoryUtilityTypes';
import {
    ChannelMemoryAtomicMutation,
    ChannelMemoryAtomicMutationResult,
    IMemoryPersistence
} from '@mxf-dev/core/interfaces/IMemoryPersistence';

/**
 * Memory Persistence Service interface
 */
export interface IMemoryPersistenceService {
    /**
     * Get agent memory from persistent storage
     * @param agentId Agent ID
     * @returns Observable of agent memory
     */
    getAgentMemory(agentId: string): Observable<IAgentMemory>;
    
    /**
     * Save agent memory to persistent storage
     * @param memory Agent memory to save
     * @returns Observable of saved agent memory
     */
    saveAgentMemory(memory: IAgentMemory): Observable<IAgentMemory>;
    
    /**
     * Get channel memory from persistent storage
     * @param channelId Channel ID
     * @returns Observable of channel memory
     */
    getChannelMemory(channelId: string): Observable<IChannelMemory>;
    
    /**
     * Save channel memory to persistent storage
     * @param memory Channel memory to save
     * @returns Observable of saved channel memory
     */
    saveChannelMemory(memory: IChannelMemory): Observable<IChannelMemory>;

    /** Atomically mutate one reserved field in a channel-memory document. */
    mutateChannelMemory(
        channelId: string,
        mutation: ChannelMemoryAtomicMutation
    ): Observable<ChannelMemoryAtomicMutationResult>;
    
    /**
     * Get relationship memory from persistent storage
     * @param agentId1 First agent ID
     * @param agentId2 Second agent ID
     * @param channelId Optional channel ID
     * @returns Observable of relationship memory
     */
    getRelationshipMemory(agentId1: string, agentId2: string, channelId?: string): Observable<IRelationshipMemory>;
    
    /**
     * Save relationship memory to persistent storage
     * @param memory Relationship memory to save
     * @returns Observable of saved relationship memory
     */
    saveRelationshipMemory(memory: IRelationshipMemory): Observable<IRelationshipMemory>;
    
    /**
     * Delete memory from persistent storage
     * @param scope Memory scope
     * @param id ID to delete
     * @returns Observable of success status
     */
    deleteMemory(scope: MemoryScope, id: string | string[]): Observable<boolean>;
}

/**
 * Memory Persistence Service Implementation
 * Pure database operations - no caching
 */
export class MemoryPersistenceService implements IMemoryPersistenceService, IMemoryPersistence {
    private static instance: MemoryPersistenceService;

    /** Cap on retained Q-value history entries per memory. */
    private static readonly Q_VALUE_HISTORY_LIMIT = 50;
    
    // Validator
    private validator = createMemoryValidator('MemoryPersistenceService');
    
    // Logger
    private logger = new Logger('debug', 'MemoryPersistenceService', 'server');

    private isChannelIdentityConflict(error: unknown, channelId: string): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }
        const duplicate = error as {
            code?: unknown;
            keyPattern?: Record<string, unknown>;
            keyValue?: Record<string, unknown>;
        };
        return duplicate.code === 11000 && (
            duplicate.keyPattern?.channelId === 1 ||
            duplicate.keyValue?.channelId === channelId
        );
    }
    
    /**
     * Private constructor for singleton pattern
     */
    private constructor() {
    }
    
    /**
     * Get agent memory from persistent storage
     * @param agentId Agent ID
     * @returns Observable of agent memory
     */
    public getAgentMemory(agentId: string): Observable<IAgentMemory> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        
        
        return from(AgentMemory.findOne({ agentId }).exec()).pipe(
            map(doc => {
                if (!doc) {
                    // Create default agent memory if not found
                    const now = new Date();
                    const defaultMemory: IAgentMemory = {
                        id: uuidv4(),
                        agentId,
                        createdAt: now,
                        updatedAt: now,
                        persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
                        notes: {},
                        conversationHistory: [],
                        customData: {}
                    };
                    return defaultMemory;
                }
                return doc.toObject() as IAgentMemory;
            }),
            catchError(error => {
                this.logger.error(`Error getting agent memory for ${agentId}`, error);
                return throwError(() => error);
            })
        );
    }
    
    /**
     * Save agent memory to persistent storage
     * @param memory Agent memory to save
     * @returns Observable of saved agent memory
     */
    public saveAgentMemory(memory: IAgentMemory): Observable<IAgentMemory> {
        this.validator.assertIsObject(memory, 'Memory must be an object');
        this.validator.assertIsNonEmptyString(memory.agentId, 'Agent ID must be a non-empty string');
        if (!Array.isArray(memory.conversationHistory)) {
            throw new Error('Agent memory save requires an authoritative conversation history array');
        }

        // The SDK sends the full authoritative snapshot. Persist it with `$set` so a
        // second save cannot append the already-stored prefix or make a clear a no-op.
        const updateData: Record<string, unknown> = { ...memory };
        delete updateData.id;
        delete updateData._id;
        delete updateData.createdAt;
        const now = new Date();
        return from(
            AgentMemory.findOneAndUpdate(
                { agentId: memory.agentId },
                {
                    $set: {
                        ...updateData,
                        conversationHistory: [...memory.conversationHistory],
                        updatedAt: now
                    },
                    $setOnInsert: {
                        id: memory.id || uuidv4(),
                        createdAt: memory.createdAt || now
                    }
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).exec()
        ).pipe(
            map(document => {
                if (!document) {
                    throw new Error(`Agent memory save returned no document for ${memory.agentId}`);
                }
                return document.toObject() as IAgentMemory;
            }),
            catchError(error => {
                this.logger.error(`Error saving agent memory for ${memory.agentId}`, error);
                return throwError(() => error);
            })
        );
    }
    
    /**
     * Get channel memory from persistent storage
     * @param channelId Channel ID
     * @returns Observable of channel memory
     */
    public getChannelMemory(channelId: string): Observable<IChannelMemory> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        
        
        return from(ChannelMemory.findOne({ channelId }).exec()).pipe(
            map(doc => {
                if (!doc) {
                    // Create default channel memory if not found
                    const now = new Date();
                    const defaultMemory: IChannelMemory = {
                        id: uuidv4(),
                        channelId,
                        createdAt: now,
                        updatedAt: now,
                        persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
                        notes: {},
                        sharedState: {},
                        conversationHistory: [],
                        customData: {}
                    };
                    return defaultMemory;
                }
                return doc.toObject() as IChannelMemory;
            }),
            catchError(error => {
                this.logger.error(`Error getting channel memory for ${channelId}`, error);
                return throwError(() => error);
            })
        );
    }
    
    /**
     * Save channel memory to persistent storage
     * @param memory Channel memory to save
     * @returns Observable of saved channel memory
     */
    public saveChannelMemory(memory: IChannelMemory): Observable<IChannelMemory> {
        this.validator.assertIsObject(memory, 'Memory must be an object');
        this.validator.assertIsNonEmptyString(memory.channelId, 'Channel ID must be a non-empty string');
        
        
        return from(
            ChannelMemory.findOneAndUpdate(
                { channelId: memory.channelId },
                { ...memory, updatedAt: new Date() },
                { upsert: true, new: true }
            ).exec()
        ).pipe(
            map(doc => doc.toObject() as IChannelMemory),
            catchError(error => {
                this.logger.error(`Error saving channel memory for ${memory.channelId}`, error);
                return throwError(() => error);
            })
        );
    }

    /**
     * Atomically mutate a reserved keyed-channel field.
     *
     * Message and history batches use MongoDB's document-level `$push`, so two
     * writers can never overwrite one another with stale read/modify/write
     * snapshots. Context replacement uses a single `$set`. Every branch returns
     * the database's post-update document as the authoritative result.
     */
    public mutateChannelMemory(
        channelId: string,
        mutation: ChannelMemoryAtomicMutation
    ): Observable<ChannelMemoryAtomicMutationResult> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');

        const now = new Date();
        const insertFields = {
            id: uuidv4(),
            channelId,
            createdAt: now,
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT
        };
        let query: Record<string, unknown> = { channelId };
        let update: Record<string, unknown>;
        let upsert = true;

        switch (mutation.kind) {
            case 'append_messages':
                if (mutation.messages.length === 0) {
                    throw new Error('At least one channel message is required');
                }
                update = {
                    $set: { updatedAt: now },
                    $setOnInsert: insertFields,
                    $push: { conversationHistory: { $each: mutation.messages } }
                };
                break;
            case 'replace_context':
                if (!mutation.context || typeof mutation.context !== 'object') {
                    throw new Error('Channel context must be an object');
                }
                if (
                    mutation.expectedUpdatedAt !== undefined &&
                    (!Number.isFinite(mutation.expectedUpdatedAt) || mutation.expectedUpdatedAt < 0)
                ) {
                    throw new Error('Expected context updatedAt must be a non-negative number');
                }
                query = mutation.expectedUpdatedAt === undefined
                    ? { channelId, 'sharedState.context': { $exists: false } }
                    : {
                        channelId,
                        'sharedState.context.updatedAt': mutation.expectedUpdatedAt
                    };
                upsert = mutation.expectedUpdatedAt === undefined;
                update = {
                    $set: { 'sharedState.context': mutation.context, updatedAt: now },
                    ...(upsert ? { $setOnInsert: insertFields } : {})
                };
                break;
            case 'append_context_history':
                if (mutation.entries.length === 0) {
                    throw new Error('At least one channel context history entry is required');
                }
                if (!Number.isInteger(mutation.retainLast) || mutation.retainLast <= 0) {
                    throw new Error('Context history retention must be a positive integer');
                }
                update = {
                    $set: { updatedAt: now },
                    $setOnInsert: insertFields,
                    $push: {
                        'customData.contextHistory': {
                            $each: mutation.entries,
                            $slice: -mutation.retainLast
                        }
                    }
                };
                break;
            case 'delete_messages':
                query = { channelId, conversationHistory: { $exists: true } };
                update = { $set: { conversationHistory: [], updatedAt: now } };
                upsert = false;
                break;
            case 'delete_context':
                query = { channelId, 'sharedState.context': { $exists: true } };
                update = {
                    $set: { updatedAt: now },
                    $unset: { 'sharedState.context': 1 }
                };
                upsert = false;
                break;
            case 'delete_context_history':
                query = { channelId, 'customData.contextHistory': { $exists: true } };
                update = {
                    $set: { updatedAt: now },
                    $unset: { 'customData.contextHistory': 1 }
                };
                upsert = false;
                break;
        }

        return from(
            ChannelMemory.findOneAndUpdate(
                query,
                update,
                { upsert, new: true, setDefaultsOnInsert: upsert }
            ).exec()
        ).pipe(
            map(document => {
                if (!document) {
                    return { found: false, memory: null, value: null };
                }
                const memory = document.toObject() as IChannelMemory;
                let value: unknown;
                switch (mutation.kind) {
                    case 'append_messages':
                    case 'delete_messages':
                        value = memory.conversationHistory ?? [];
                        break;
                    case 'replace_context':
                    case 'delete_context':
                        value = memory.sharedState?.context ?? null;
                        break;
                    case 'append_context_history':
                    case 'delete_context_history':
                        value = memory.customData?.contextHistory ?? null;
                        break;
                }
                return { found: true, memory, value };
            }),
            catchError(error => {
                if (
                    mutation.kind === 'replace_context' &&
                    mutation.expectedUpdatedAt === undefined &&
                    this.isChannelIdentityConflict(error, channelId)
                ) {
                    // A create-only CAS races by upserting against
                    // `{channelId, context: {$exists: false}}`. If another writer
                    // already owns that unique channel identity, MongoDB reports
                    // E11000. Normalize only that exact identity collision into a
                    // stale-writer result and return the winner's authoritative
                    // context; every other database exception still propagates.
                    return from(ChannelMemory.findOne({ channelId }).exec()).pipe(
                        map(document => {
                            const memory = document?.toObject() as IChannelMemory | undefined;
                            const currentContext = memory?.sharedState?.context;
                            if (!memory || currentContext === undefined) {
                                throw error;
                            }
                            return {
                                found: false,
                                memory,
                                value: currentContext
                            };
                        }),
                        catchError(readError => {
                            this.logger.error(
                                `Error resolving create conflict for channel memory ${channelId}`,
                                readError
                            );
                            return throwError(() => readError);
                        })
                    );
                }
                this.logger.error(
                    `Error applying ${mutation.kind} to channel memory ${channelId}`,
                    error
                );
                return throwError(() => error);
            })
        );
    }
    
    /**
     * Get relationship memory from persistent storage
     * @param agentId1 First agent ID
     * @param agentId2 Second agent ID
     * @param channelId Optional channel ID
     * @returns Observable of relationship memory
     */
    public getRelationshipMemory(agentId1: string, agentId2: string, channelId?: string): Observable<IRelationshipMemory> {
        this.validator.assertIsNonEmptyString(agentId1, 'First agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(agentId2, 'Second agent ID must be a non-empty string');
        
        const [sortedId1, sortedId2] = [agentId1, agentId2].sort();
        
        const query: Record<string, string> = {
            agentId1: sortedId1,
            agentId2: sortedId2
        };
        
        if (channelId) {
            query.channelId = channelId;
        }
        
        return from(RelationshipMemory.findOne(query).exec()).pipe(
            map(doc => {
                if (!doc) {
                    // Create default relationship memory if not found
                    const now = new Date();
                    const defaultMemory: IRelationshipMemory = {
                        id: uuidv4(),
                        agentId1: sortedId1,
                        agentId2: sortedId2,
                        channelId,
                        createdAt: now,
                        updatedAt: now,
                        persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
                        interactionHistory: [],
                        notes: {},
                        customData: {}
                    };
                    return defaultMemory;
                }
                return doc.toObject() as IRelationshipMemory;
            }),
            catchError(error => {
                this.logger.error(`Error getting relationship memory for ${sortedId1}:${sortedId2}${channelId ? `:${channelId}` : ''}`, error);
                return throwError(() => error);
            })
        );
    }
    
    /**
     * Save relationship memory to persistent storage
     * @param memory Relationship memory to save
     * @returns Observable of saved relationship memory
     */
    public saveRelationshipMemory(memory: IRelationshipMemory): Observable<IRelationshipMemory> {
        this.validator.assertIsObject(memory, 'Memory must be an object');
        this.validator.assertIsNonEmptyString(memory.agentId1, 'First agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(memory.agentId2, 'Second agent ID must be a non-empty string');
        
        // Ensure consistent ordering of agent IDs
        const [sortedId1, sortedId2] = [memory.agentId1, memory.agentId2].sort();
        const normalizedMemory = {
            ...memory,
            agentId1: sortedId1,
            agentId2: sortedId2,
            updatedAt: new Date()
        };
        
        
        const query: Record<string, string> = {
            agentId1: sortedId1,
            agentId2: sortedId2
        };
        
        if (memory.channelId) {
            query.channelId = memory.channelId;
        }
        
        return from(
            RelationshipMemory.findOneAndUpdate(
                query,
                normalizedMemory,
                { upsert: true, new: true }
            ).exec()
        ).pipe(
            map(doc => doc.toObject() as IRelationshipMemory),
            catchError(error => {
                this.logger.error(`Error saving relationship memory for ${sortedId1}:${sortedId2}${memory.channelId ? `:${memory.channelId}` : ''}`, error);
                return throwError(() => error);
            })
        );
    }
    
    /**
     * Delete memory from persistent storage
     * @param scope Memory scope
     * @param id ID to delete
     * @returns Observable of success status
     */
    public deleteMemory(scope: MemoryScope, id: string | string[]): Observable<boolean> {
        this.validator.validateMemoryScope(scope);

        switch (scope) {
            case MemoryScope.AGENT: {
                if (typeof id !== 'string') {
                    throw new Error('Agent memory deletion requires one agent ID');
                }
                this.validator.assertIsNonEmptyString(id, 'Agent ID must be a non-empty string');
                // Delete from base AgentMemory collection
                return from(AgentMemory.deleteOne({ agentId: id }).exec()).pipe(
                    switchMap(baseResult => {
                            // Delete from all strata collections in parallel
                            const strataDeletePromises = Promise.all([
                                MemoryEntryModel.deleteMany({ agentId: id }).exec(),
                                SurpriseHistoryModel.deleteMany({ agentId: id }).exec(),
                                MemoryPatternModel.deleteMany({ agentId: id }).exec(),
                                // Delete from RelationshipMemory (both sides of relationships)
                                RelationshipMemory.deleteMany({
                                    $or: [{ agentId1: id }, { agentId2: id }]
                                }).exec()
                            ]);

                            return from(strataDeletePromises).pipe(
                                map(([memoryEntries, surpriseHistory, patterns, relationships]) => {
                                    const totalDeleted = baseResult.deletedCount +
                                        memoryEntries.deletedCount +
                                        surpriseHistory.deletedCount +
                                        patterns.deletedCount +
                                        relationships.deletedCount;

                                    if (totalDeleted > 0) {
                                        this.logger.info(
                                            `Deleted agent memory for ${id}: ` +
                                            `base=${baseResult.deletedCount}, ` +
                                            `entries=${memoryEntries.deletedCount}, ` +
                                            `surprise=${surpriseHistory.deletedCount}, ` +
                                            `patterns=${patterns.deletedCount}, ` +
                                            `relationships=${relationships.deletedCount}`
                                        );
                                    }

                                    return baseResult.deletedCount > 0 || totalDeleted > 0;
                                })
                            );
                    }),
                    catchError(error => {
                        this.logger.error(`Error deleting agent memory for ${id}`, error);
                        return throwError(() => error);
                    })
                );
            }
            case MemoryScope.CHANNEL: {
                if (typeof id !== 'string') {
                    throw new Error('Channel memory deletion requires one channel ID');
                }
                this.validator.assertIsNonEmptyString(id, 'Channel ID must be a non-empty string');
                return from(ChannelMemory.deleteOne({ channelId: id }).exec()).pipe(
                    map(result => result.deletedCount > 0),
                    catchError(error => {
                        this.logger.error(`Error deleting channel memory for ${id}`, error);
                        return throwError(() => error);
                    })
                );
            }
            case MemoryScope.RELATIONSHIP: {
                if (!Array.isArray(id) || (id.length !== 2 && id.length !== 3)) {
                    throw new Error(
                        'Relationship memory deletion requires two agent IDs and an optional channel ID'
                    );
                }
                id.forEach((part, index) => {
                    this.validator.assertIsNonEmptyString(
                        part,
                        `Relationship memory ID part ${index} must be a non-empty string`
                    );
                });
                const [agentId1, agentId2, channelId] = id;
                const [sortedId1, sortedId2] = [agentId1, agentId2].sort();
                const query: Record<string, string> = {
                    agentId1: sortedId1,
                    agentId2: sortedId2
                };

                if (channelId) {
                    query.channelId = channelId;
                }

                return from(RelationshipMemory.deleteOne(query).exec()).pipe(
                    map(result => result.deletedCount > 0),
                    catchError(error => {
                        this.logger.error(`Error deleting relationship memory for ${sortedId1}:${sortedId2}${channelId ? `:${channelId}` : ''}`, error);
                        return throwError(() => error);
                    })
                );
            }
        }
    }
    
    /**
     * Persist the MULS utility subdocument for a single retrieved memory.
     *
     * Registered (via MemoryService.updateMemoryUtility) as QValueManager's persistence
     * callback, so this runs whenever a Q-value changes and when a dirty cache entry is
     * evicted. Upserts because a memory earns a utility record the first time it is
     * actually rewarded, not when it is created.
     *
     * Throws on failure by design: a silent failure here would mean the framework
     * reports learning that it never retained.
     */
    public async updateAgentMemoryUtility(
        memoryId: string,
        utility: Partial<MemoryUtilitySubdocument>
    ): Promise<void> {
        this.validator.assertIsNonEmptyString(memoryId, 'Memory ID must be a non-empty string');

        const update: Record<string, unknown> = { updatedAt: new Date() };

        if (utility.qValue !== undefined) {
            if (!Number.isFinite(utility.qValue)) {
                throw new Error(
                    `[MemoryPersistenceService] Refusing to persist a non-finite Q-value for memory ${memoryId}`
                );
            }
            update.qValue = utility.qValue;
        }
        if (utility.retrievalCount !== undefined) update.retrievalCount = utility.retrievalCount;
        if (utility.successCount !== undefined) update.successCount = utility.successCount;
        if (utility.failureCount !== undefined) update.failureCount = utility.failureCount;
        if (utility.lastRewardAt !== undefined) update.lastRewardAt = utility.lastRewardAt;
        if (utility.initializedFrom !== undefined) update.initializedFrom = utility.initializedFrom;

        const operation: Record<string, unknown> = { $set: update };

        // Keep the convergence history bounded so a long-lived memory cannot grow the
        // document without limit.
        if (utility.qValueHistory && utility.qValueHistory.length > 0) {
            operation.$push = {
                qValueHistory: {
                    $each: utility.qValueHistory,
                    $slice: -MemoryPersistenceService.Q_VALUE_HISTORY_LIMIT
                }
            };
        }

        await MemoryUtility.updateOne({ memoryId }, operation, { upsert: true }).exec();
    }

    /**
     * Load stored utility records for a batch of memories.
     *
     * Memories with no stored utility are absent from the map; the caller keeps the
     * configured default Q-value for those.
     */
    public async getAgentMemoryUtilities(
        memoryIds: string[]
    ): Promise<Map<string, MemoryUtilitySubdocument>> {
        const result = new Map<string, MemoryUtilitySubdocument>();
        if (memoryIds.length === 0) {
            return result;
        }

        const docs = await MemoryUtility.find({ memoryId: { $in: memoryIds } }).lean().exec();

        for (const doc of docs) {
            result.set(doc.memoryId, {
                qValue: doc.qValue,
                qValueHistory: doc.qValueHistory ?? [],
                retrievalCount: doc.retrievalCount ?? 0,
                successCount: doc.successCount ?? 0,
                failureCount: doc.failureCount ?? 0,
                lastRewardAt: doc.lastRewardAt ?? new Date(0),
                initializedFrom: doc.initializedFrom
            } as MemoryUtilitySubdocument);
        }

        return result;
    }

    /**
     * Get singleton instance
     * @returns The memory persistence service instance
     */
    public static getInstance(): MemoryPersistenceService {
        if (!MemoryPersistenceService.instance) {
            MemoryPersistenceService.instance = new MemoryPersistenceService();
        }
        return MemoryPersistenceService.instance;
    }
}
