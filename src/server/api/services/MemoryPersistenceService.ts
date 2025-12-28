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
 * Memory Persistence Service
 * 
 * This service provides persistent storage for the Memory System.
 * Pure database operations service - no caching.
 */

import { Observable, from, of, throwError } from 'rxjs';
import { map, catchError, tap, switchMap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

import { 
    IAgentMemory, 
    IChannelMemory, 
    IRelationshipMemory,
    MemoryScope, 
    MemoryPersistenceLevel,
    createMemoryValidator
} from '../../../shared/types/MemoryTypes';

import { Logger } from '../../../shared/utils/Logger';
import { 
    AgentMemory, 
    ChannelMemory, 
    RelationshipMemory
} from '../../../shared/models/memory';

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
export class MemoryPersistenceService implements IMemoryPersistenceService {
    private static instance: MemoryPersistenceService;
    
    // Validator
    private validator = createMemoryValidator('MemoryPersistenceService');
    
    // Logger
    private logger = new Logger('debug', 'MemoryPersistenceService', 'server');
    
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
            tap(memory => {
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


        // Prepare update data - exclude _id, id, createdAt, and conversationHistory
        const { id, _id, createdAt, conversationHistory, ...updateData } = memory as any;

        // Build update operation
        const updateOp: any = {
            $set: {
                ...updateData,
                updatedAt: new Date()
            },
            $setOnInsert: {
                id: memory.id || uuidv4(),
                createdAt: memory.createdAt || new Date()
            }
        };

        // CRITICAL: Check document size before appending to prevent MongoDB 16MB limit
        // Append conversation history with size-based cleanup if needed
        if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
            // First, get existing document to check size
            return from(AgentMemory.findOne({ agentId: memory.agentId }).exec()).pipe(
                switchMap(existingDoc => {
                    // Calculate current document size
                    const currentSize = existingDoc ? Buffer.byteLength(JSON.stringify(existingDoc.toObject()), 'utf8') : 0;
                    const newMessagesSize = Buffer.byteLength(JSON.stringify(conversationHistory), 'utf8');
                    const projectedSize = currentSize + newMessagesSize;

                    // MongoDB 16MB limit, use 12MB as safe threshold (75%)
                    const MONGODB_SAFE_LIMIT = 12 * 1024 * 1024;

                    if (projectedSize > MONGODB_SAFE_LIMIT) {
                        this.logger.warn(
                            `⚠️  Agent ${memory.agentId} memory would exceed limit! ` +
                            `Current: ${(currentSize / 1024 / 1024).toFixed(2)}MB, ` +
                            `New: ${(newMessagesSize / 1024 / 1024).toFixed(2)}MB, ` +
                            `Projected: ${(projectedSize / 1024 / 1024).toFixed(2)}MB. ` +
                            `Using REPLACE instead of APPEND.`
                        );

                        // Use $set to REPLACE conversation history instead of appending
                        // Keep only the new messages to prevent overflow
                        updateOp.$set = {
                            ...updateOp.$set,
                            conversationHistory: conversationHistory  // Replace entire history
                        };
                    } else {
                        // Safe to append
                        updateOp.$push = {
                            conversationHistory: { $each: conversationHistory }
                        };
                    }

                    return from(
                        AgentMemory.findOneAndUpdate(
                            { agentId: memory.agentId },
                            updateOp,
                            { upsert: true, new: true }
                        ).exec()
                    );
                }),
                map(doc => doc.toObject() as IAgentMemory),
                tap(savedMemory => {
                }),
                catchError(error => {
                    // Handle duplicate key errors gracefully (race condition on concurrent saves)
                    if (error.code === 11000 && error.message?.includes('id_1 dup key')) {
                        // Silently retry once - the document now exists so update will succeed
                        return from(
                            AgentMemory.findOneAndUpdate(
                                { agentId: memory.agentId },
                                updateOp,
                                { upsert: false, new: true } // Don't upsert, just update
                            ).exec()
                        ).pipe(
                            map(doc => {
                                if (!doc) {
                                    throw new Error(`Agent memory document disappeared during retry for ${memory.agentId}`);
                                }
                                return doc.toObject() as IAgentMemory;
                            })
                        );
                    }
                    //this.logger.error(`Error saving agent memory for ${memory.agentId}`, error);
                    return throwError(() => error);
                })
            );
        }

        // No conversation history to save, just update other fields
        return from(
            AgentMemory.findOneAndUpdate(
                { agentId: memory.agentId },
                updateOp,
                { upsert: true, new: true }
            ).exec()
        ).pipe(
            map(doc => doc.toObject() as IAgentMemory),
            tap(savedMemory => {
            }),
            catchError(error => {
                // Handle duplicate key errors gracefully (race condition on concurrent saves)
                if (error.code === 11000 && error.message?.includes('id_1 dup key')) {
                    // Silently retry once - the document now exists so update will succeed
                    return from(
                        AgentMemory.findOneAndUpdate(
                            { agentId: memory.agentId },
                            updateOp,
                            { upsert: false, new: true } // Don't upsert, just update
                        ).exec()
                    ).pipe(
                        map(doc => {
                            if (!doc) {
                                throw new Error(`Agent memory document disappeared during retry for ${memory.agentId}`);
                            }
                            return doc.toObject() as IAgentMemory;
                        })
                    );
                }
                //this.logger.error(`Error saving agent memory for ${memory.agentId}`, error);
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
            tap(memory => {
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
            tap(savedMemory => {
            }),
            catchError(error => {
                this.logger.error(`Error saving channel memory for ${memory.channelId}`, error);
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
        
        const query: any = {
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
            tap(memory => {
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
        
        
        const query: any = {
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
            tap(savedMemory => {
            }),
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
        
        switch (scope) {
            case MemoryScope.AGENT:
                if (typeof id === 'string') {
                    return from(AgentMemory.deleteOne({ agentId: id }).exec()).pipe(
                        map(result => result.deletedCount > 0),
                        tap(success => {
                        }),
                        catchError(error => {
                            this.logger.error(`Error deleting agent memory for ${id}`, error);
                            return of(false);
                        })
                    );
                }
                break;
                
            case MemoryScope.CHANNEL:
                if (typeof id === 'string') {
                    return from(ChannelMemory.deleteOne({ channelId: id }).exec()).pipe(
                        map(result => result.deletedCount > 0),
                        tap(success => {
                        }),
                        catchError(error => {
                            this.logger.error(`Error deleting channel memory for ${id}`, error);
                            return of(false);
                        })
                    );
                }
                break;
                
            case MemoryScope.RELATIONSHIP:
                if (Array.isArray(id) && id.length >= 2) {
                    const [agentId1, agentId2] = id;
                    const channelId = id.length > 2 ? id[2] : undefined;
                    const [sortedId1, sortedId2] = [agentId1, agentId2].sort();
                    
                    const query: any = {
                        agentId1: sortedId1,
                        agentId2: sortedId2
                    };
                    
                    if (channelId) {
                        query.channelId = channelId;
                    }
                    
                    return from(RelationshipMemory.deleteOne(query).exec()).pipe(
                        map(result => result.deletedCount > 0),
                        tap(success => {
                        }),
                        catchError(error => {
                            this.logger.error(`Error deleting relationship memory for ${sortedId1}:${sortedId2}${channelId ? `:${channelId}` : ''}`, error);
                            return of(false);
                        })
                    );
                }
                break;
        }
        
        return of(false);
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
