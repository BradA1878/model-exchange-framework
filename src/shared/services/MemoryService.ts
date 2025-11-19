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
 * Unified Memory Service Implementation
 * 
 * This service provides the core functionality for the MXF Memory System.
 * It handles different memory scopes (agent, channel, relationship) and
 * persistence levels (temporary, persistent).
 * 
 * CONSOLIDATED: Includes cognitive operations from AgentMemoryService
 * for LLM workflows (observations, reasoning, plans, reflections).
 */

import { Observable, of } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import { 
    IAgentMemory, 
    IChannelMemory, 
    IRelationshipMemory,
    MemoryScope, 
    MemoryPersistenceLevel,
    MemoryData,
    MemoryQueryParams,
    createMemoryValidator
} from '../types/MemoryTypes';

// Cognitive operation types from control loop
import {
    Observation,
    Reasoning,
    Plan,
    Reflection
} from '../models/controlLoop';

import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { MemoryGetEvent, MemoryUpdateEvent } from '../events/event-definitions/MemoryEvents';
import {
    createMemoryUpdateResultEventPayload,
    createMemoryDeleteResultEventPayload,
    MemoryDeleteResultEventData,
    MemoryUpdateResultEventData,
    MemoryGetEventPayload,
    MemoryUpdateEventPayload,
    createMemoryGetResultEventPayload,
    MemoryGetResultEventData
} from '../schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '../types/ChannelContext';

/**
 * Types of cognitive memory content
 */
export enum CognitiveMemoryType {
    SHORT_TERM = 'short_term',     // Temporary observations and immediate context
    WORKING = 'working',           // Active reasoning and planning
    LONG_TERM = 'long_term'        // Persistent reflections and learned patterns
}

/**
 * Cognitive memory entry with metadata
 */
export interface CognitiveMemoryEntry<T> {
    id: string;
    agentId: AgentId;
    channelId: ChannelId;
    memoryType: CognitiveMemoryType;
    content: T;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
    labels: string[];
    relevance?: number;
}

/**
 * Query options for cognitive memory
 */
export interface CognitiveMemoryQueryOptions {
    memoryTypes?: CognitiveMemoryType[];
    limit?: number;
    offset?: number;
    sortBy?: 'createdAt' | 'updatedAt' | 'relevance';
    sortDirection?: 'asc' | 'desc';
    labels?: string[];
    fromTimestamp?: number;
    toTimestamp?: number;
    textQuery?: string;
}

/**
 * Enhanced Agent Memory with cognitive operations
 */
export interface IEnhancedAgentMemory extends IAgentMemory {
    // Cognitive Memory References
    cognitiveMemory: {
        observationIds: string[];
        reasoningIds: string[];
        planIds: string[];
        reflectionIds: string[];
    };
}

/**
 * Enhanced Channel Memory with shared cognitive insights
 */
export interface IEnhancedChannelMemory extends IChannelMemory {
    // Channel activity tracking
    lastActivity?: number;
    messageCount?: number;
    participants?: string[];
    topics?: string[];
    summary?: string;
    
    // Shared Cognitive Insights
    sharedCognitiveInsights: {
        systemSummaries: string[];
        topicExtractions: string[];
        collaborativeReflections: string[];
    };
}

/**
 * Configuration options for Memory Service
 */
interface MemoryServiceConfig {
    enablePersistence?: boolean;
    cacheSize?: number;
    persistenceService?: any; // Optional persistence service (server-only)
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: MemoryServiceConfig = {
    enablePersistence: true,
    cacheSize: 100
};

/**
 * Memory Service
 * 
 * Core service for managing the Memory System and handling in-memory cache.
 */
export class MemoryService {
    // Singleton instance
    private static instance: MemoryService;
    
    // Memory cache
    private agentMemory: Map<string, IEnhancedAgentMemory> = new Map();
    private channelMemory: Map<string, IEnhancedChannelMemory> = new Map();
    private relationshipMemory: Map<string, IRelationshipMemory> = new Map();
    private generalData: Map<string, any> = new Map();
    private cognitiveMemory: Map<string, CognitiveMemoryEntry<any>> = new Map();
    
    // Configuration
    private config: MemoryServiceConfig;

    // Optional persistence service (server-only)
    private persistenceService?: any;

    // Validator
    private validator = createMemoryValidator('MemoryService');
    
    // Logger
    private logger = new Logger('debug', 'MemoryService', "server");
    
    /**
     * Private constructor for singleton pattern
     * @param config Configuration options
     */
    private constructor(config: MemoryServiceConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.persistenceService = config.persistenceService;

        if (this.persistenceService) {
        } else {
        }

        // Set up event listeners
        this.setupEventListeners();
    }
    
    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        // Listen for memory update events to keep cache in sync
        EventBus.server.on(Events.Memory.UPDATE_RESULT, (data: { scope: MemoryScope, id: string, memory: any }) => {
            if (data.scope === MemoryScope.AGENT && data.memory) {
                this.agentMemory.set(data.id, data.memory);
                // ;
            } else if (data.scope === MemoryScope.CHANNEL && data.memory) {
                this.channelMemory.set(data.id, data.memory);
                // ;
            } else if (data.scope === MemoryScope.RELATIONSHIP && data.memory) {
                this.relationshipMemory.set(data.id, data.memory);
                // ;
            }
        });
        
        // Set up EventBus bridge for Memory.UPDATE events
        // This bridges EventBus memory events to internal memory operations
        // Required for ChannelContextMemoryOperations to save data
        EventBus.server.on(Events.Memory.UPDATE, (event: MemoryUpdateEventPayload) => {
            try {
                // Extract memory operation data from the event (handle EventBus forwarding nesting)
                const memoryEventData = event.data.scope ? event.data : (event.data as any).data;
                
                // Validate required fields
                this.validator.assertIsString(memoryEventData.scope, 'Memory scope is required');
                this.validator.assertIsString(memoryEventData.operationId, 'Operation ID is required');
                
                // Determine the action based on memory scope and handle UPDATE operations
                if (memoryEventData.scope === MemoryScope.CHANNEL) {
                    // For channel data, store by key (e.g., "channel:context:${channelId}")
                    const memoryKey = memoryEventData.id; // Use the id as the key
                    const memoryData = memoryEventData.data;
                    
                    if (memoryKey && memoryData) {
                        // Store the data in generalData map (in-memory cache)
                        this.generalData.set(memoryKey, memoryData);
                        
                        // Also persist to MongoDB for durability (if persistence service available)
                        // Extract actual context data - it's wrapped in another object with the key
                        const actualContextData = memoryData[memoryKey];
                        if (actualContextData && actualContextData.channelId && this.persistenceService) {
                            try {
                                // Convert to IChannelMemory format for persistence
                                const channelMemoryUpdate: any = {
                                    id: `${actualContextData.channelId}-context`,
                                    channelId: actualContextData.channelId,
                                    createdAt: new Date(actualContextData.createdAt || Date.now()),
                                    updatedAt: new Date(),
                                    persistenceLevel: 'persistent' as any,
                                    sharedState: { context: actualContextData },
                                    notes: { channelContext: 'Auto-saved from ChannelContextService' },
                                    conversationHistory: [],
                                    customData: { contextMetadata: memoryEventData.metadata || {} }
                                };

                                // Persist to MongoDB (fire and forget for performance)
                                this.persistenceService.saveChannelMemory(channelMemoryUpdate)
                                    .subscribe({
                                        next: () => this.logger.info(`Channel context persisted to MongoDB for ${actualContextData.channelId}`),
                                        error: (err: Error) => this.logger.warn(`Failed to persist channel context to MongoDB: ${err.message}`)
                                    });
                            } catch (persistError) {
                                this.logger.warn(`Error persisting channel context: ${persistError}`);
                            }
                        }
                        
                        // Create success result payload
                        const updateResultData: MemoryUpdateResultEventData = {
                            operationId: memoryEventData.operationId,
                            scope: MemoryScope.CHANNEL,
                            id: memoryKey,
                            memory: memoryData
                        };
                        
                        const systemAgentId: AgentId = 'SYSTEM_AGENT';
                        const channelId: ChannelId = event.channelId || 'NO_CHANNEL';
                        
                        const payload = createMemoryUpdateResultEventPayload(
                            Events.Memory.UPDATE_RESULT,
                            systemAgentId,
                            channelId,
                            updateResultData
                        );
                        
                        EventBus.server.emit(Events.Memory.UPDATE_RESULT, payload);
                    } else {
                        this.logger.warn(`Invalid UPDATE data - missing key or data: key=${memoryKey}, data=${!!memoryData}`);
                    }
                }
            } catch (error) {
                this.logger.error(`Error handling Memory.UPDATE event: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        
        // Set up EventBus bridge for Memory.GET events
        // This bridges EventBus memory events to internal memory operations
        // Required for ChannelContextMessageOperations to work with the memory system
        EventBus.server.on(Events.Memory.GET, (event: MemoryGetEventPayload) => {
            try {
                // Extract memory operation data from the event (handle EventBus forwarding nesting)
                const memoryEventData = event.data.scope ? event.data : (event.data as any).data;
                
                // Validate required fields
                this.validator.assertIsString(memoryEventData.scope, 'Memory scope is required');
                this.validator.assertIsString(memoryEventData.operationId, 'Operation ID is required');
                
                let memoryObservable: any = null;
                
                // Determine the action based on memory scope and handle GET operations
                switch (memoryEventData.scope) {
                    case MemoryScope.CHANNEL:
                        // Determine the memory key to look up - prioritize key field over id field
                        const memoryKey = memoryEventData.key || (Array.isArray(memoryEventData.id) ? memoryEventData.id[0] : memoryEventData.id);
                        
                        if (memoryKey) {
                            // For channel data, look up by key (e.g., "channel:messages:${channelId}" or "channel:context:${channelId}")
                            const channelMemory = this.generalData.get(memoryKey);
                            
                            // Create result payload
                            const getResultData: MemoryGetResultEventData = {
                                operationId: memoryEventData.operationId,
                                scope: MemoryScope.CHANNEL,
                                id: memoryKey, // Use the memory key as the id for proper matching
                                memory: channelMemory || null
                            };
                            
                            const systemAgentId: AgentId = 'SYSTEM_AGENT';
                            const noChannelId: ChannelId = 'NO_CHANNEL';
                            
                            const payload = createMemoryGetResultEventPayload(
                                Events.Memory.GET_RESULT,
                                systemAgentId,
                                noChannelId,
                                getResultData
                            );
                            
                            //// this.logger.info(`[CRITICAL] MemoryService emitting GET_RESULT:`, Object.keys(payload));
                            EventBus.server.emit(Events.Memory.GET_RESULT, payload);
                        } else {
                            this.logger.warn(`[DEBUG] No memory key found in GET event data`);
                        }
                        break;
                        
                    case MemoryScope.AGENT:
                        if (typeof memoryEventData.id === 'string') {
                            // ;
                            memoryObservable = this.getAgentMemory(memoryEventData.id);
                            
                            // Subscribe to the observable and emit result
                            memoryObservable.subscribe({
                                next: (agentMemory: IEnhancedAgentMemory) => {
                                    // Create result payload
                                    const getResultData: MemoryGetResultEventData = {
                                        operationId: memoryEventData.operationId,
                                        scope: MemoryScope.AGENT,
                                        id: memoryEventData.id as string,
                                        memory: agentMemory || null
                                    };
                                    
                                    const payload = createMemoryGetResultEventPayload(
                                        Events.Memory.GET_RESULT,
                                        event.agentId,
                                        event.channelId,
                                        getResultData
                                    );
                                    
                                    EventBus.server.emit(Events.Memory.GET_RESULT, payload);
                                },
                                error: (error: Error) => {
                                    this.logger.error(`Error getting agent memory: ${error}`);
                                    
                                    // Create error result payload
                                    const getResultData: MemoryGetResultEventData = {
                                        operationId: memoryEventData.operationId,
                                        scope: MemoryScope.AGENT,
                                        id: memoryEventData.id as string,
                                        memory: null
                                    };
                                    
                                    const payload = createMemoryGetResultEventPayload(
                                        Events.Memory.GET_RESULT,
                                        event.agentId,
                                        event.channelId,
                                        getResultData
                                    );
                                    
                                    EventBus.server.emit(Events.Memory.GET_RESULT, payload);
                                }
                            });
                        }
                        break;
                        
                    case MemoryScope.RELATIONSHIP:
                        // Handle relationship memory GET
                        break;
                        
                    default:
                        this.logger.warn(`Unsupported memory scope: ${memoryEventData.scope}`);
                }
                
            } catch (error) {
                this.logger.error('[ERROR] Error processing EventBus Memory.GET:', error);
                
                // Log error details for debugging without creating fake event payloads
                const operationId = event.data?.operationId || '[NO_OPERATION_ID]';
                const memoryId = event.data?.id || event.data?.key || '[NO_MEMORY_ID]';
                this.logger.error(`Memory GET operation failed - OperationId: ${operationId}, MemoryId: ${memoryId}, Error: ${(error as Error).message}`);
                
                // Cannot emit GET_RESULT event without valid agentId and channelId from original request
                // Original event should have contained these required identifiers
                this.logger.warn('Cannot emit Memory.GET_RESULT event - original event lacked valid agentId/channelId. Memory operation errors should be handled by the requesting component.');
            }
        });
        
        // Set up EventBus bridge for Memory.UPDATE events
        EventBus.server.on(Events.Memory.UPDATE, (event: MemoryUpdateEventPayload) => {
            try {
                // Extract memory operation data from the event (handle EventBus forwarding nesting)
                const memoryEventData = event.data.scope ? event.data : (event.data as any).data;
                
                // Validate required fields
                this.validator.assertIsString(memoryEventData.scope, 'Memory scope is required');
                this.validator.assertIsString(memoryEventData.operationId, 'Operation ID is required');
                
                // Handle UPDATE operations
                switch (memoryEventData.scope) {
                    case MemoryScope.CHANNEL:
                        // For UPDATE operations, the id field contains the memory key
                        const updateMemoryKey = Array.isArray(memoryEventData.id) ? memoryEventData.id[0] : memoryEventData.id;
                        
                        // Handle the actual data structure from ChannelContextMessageOperations and ChannelContextMemoryOperations
                        // Data comes in format: 
                        // - { "channel:messages:${channelId}": [...messages] } for messages
                        // - { "channel:context:${channelId}": {...context} } for context
                        if (memoryEventData.data && typeof memoryEventData.data === 'object') {
                            // Check if the data is already properly keyed or needs to be keyed
                            const dataKeys = Object.keys(memoryEventData.data);
                            
                            if (updateMemoryKey.startsWith('channel:')) {
                                // Direct storage: id field is the memory key, data field contains the actual data
                                // ;
                                
                                // If data has nested structure with the same key, extract the nested data
                                const actualData = memoryEventData.data[updateMemoryKey] || memoryEventData.data;
                                
                                // Check if data has actually changed before updating
                                const existingData = this.generalData.get(updateMemoryKey);
                                const dataHasChanged = !this.isDataEqual(existingData, actualData);
                                
                                if (!dataHasChanged) {
                                    // ;
                                    return; // Skip update and event emission
                                }
                                
                                // ;
                                this.generalData.set(updateMemoryKey, actualData);
                                
                                // Create success result payload
                                const updateResult: MemoryUpdateResultEventData = {
                                    operationId: memoryEventData.operationId,
                                    scope: MemoryScope.CHANNEL,
                                    id: updateMemoryKey, // Use the memory key as the id for proper matching
                                    memory: actualData
                                };
                                
                                const systemAgentId: AgentId = 'SYSTEM_AGENT';
                                const noChannelId: ChannelId = 'NO_CHANNEL';
                                
                                const payload = createMemoryUpdateResultEventPayload(
                                    Events.Memory.UPDATE_RESULT,
                                    systemAgentId,
                                    noChannelId,
                                    updateResult
                                );
                                
                                // ;
                                EventBus.server.emit(Events.Memory.UPDATE_RESULT, payload);
                            } else {
                                // Legacy format: Find any channel-related key and data in the data object
                                const channelKey = dataKeys.find(key => 
                                    key.startsWith('channel:messages:') || key.startsWith('channel:context:')
                                );
                                
                                if (channelKey && memoryEventData.data[channelKey]) {
                                    // ;
                                    
                                    const newData = memoryEventData.data[channelKey];
                                    
                                    // Check if data has actually changed before updating
                                    const existingData = this.generalData.get(channelKey);
                                    const dataHasChanged = !this.isDataEqual(existingData, newData);
                                    
                                    if (!dataHasChanged) {
                                        // ;
                                        return; // Skip update and event emission
                                    }
                                    
                                    // Store the data by the key (messages array or context object)
                                    // ;
                                    this.generalData.set(channelKey, newData);
                                    
                                    // Create success result payload
                                    const updateResult: MemoryUpdateResultEventData = {
                                        operationId: memoryEventData.operationId,
                                        scope: MemoryScope.CHANNEL,
                                        id: channelKey, // Use the memory key as the id for proper matching
                                        memory: newData
                                    };
                                    
                                    const systemAgentId: AgentId = 'SYSTEM_AGENT';
                                    const noChannelId: ChannelId = 'NO_CHANNEL';
                                    
                                    const payload = createMemoryUpdateResultEventPayload(
                                        Events.Memory.UPDATE_RESULT,
                                        systemAgentId,
                                        noChannelId,
                                        updateResult
                                    );
                                    
                                    // ;
                                    EventBus.server.emit(Events.Memory.UPDATE_RESULT, payload);
                                } else {
                                    this.logger.warn(`No recognized channel key found in data keys: ${dataKeys.join(', ')}`);
                                }
                            }
                        }
                        break;
                        
                    case MemoryScope.AGENT:
                        // Handle agent memory UPDATE
                        if (typeof memoryEventData.id === 'string' && memoryEventData.data) {
                            // CRITICAL: Must subscribe to Observable to trigger execution!
                            this.updateAgentMemory(memoryEventData.id, memoryEventData.data).subscribe({
                                next: () => null,
                                error: (err) => this.logger.error(`Agent memory update failed for ${memoryEventData.id}: ${err}`)
                            });
                        }
                        break;
                        
                    case MemoryScope.RELATIONSHIP:
                        // Handle relationship memory UPDATE
                        break;
                        
                    default:
                        this.logger.warn(`Unsupported memory scope: ${memoryEventData.scope}`);
                }
                
            } catch (error) {
                this.logger.error('[ERROR] Error processing EventBus Memory.UPDATE:', error);
                
                // Log error details for debugging without creating fake event payloads
                const operationId = event.data?.operationId || '[NO_OPERATION_ID]';
                const memoryId = event.data?.id || '[NO_MEMORY_ID]';
                this.logger.error(`Memory UPDATE operation failed - OperationId: ${operationId}, MemoryId: ${memoryId}, Error: ${(error as Error).message}`);
                
                // Cannot emit UPDATE_RESULT event without valid agentId and channelId from original request
                // Original event should have contained these required identifiers
                this.logger.warn('Cannot emit Memory.UPDATE_RESULT event - original event lacked valid agentId/channelId. Memory operation errors should be handled by the requesting component.');
            }
        });
        
    }
    
    /**
     * Get the singleton instance
     * @param config Configuration options
     * @returns The memory service instance
     */
    public static getInstance(config?: MemoryServiceConfig): MemoryService {
        if (!MemoryService.instance) {
            MemoryService.instance = new MemoryService(config);
        } else if (config?.persistenceService && !MemoryService.instance.persistenceService) {
            // Upgrade existing instance with persistence service (for server initialization)
            MemoryService.instance.persistenceService = config.persistenceService;
            MemoryService.instance.logger.info('Memory Service upgraded with MongoDB persistence');
        }
        return MemoryService.instance;
    }
    
    /**
     * Get agent memory
     * @param agentId Agent ID
     * @returns Observable of agent memory
     */
    public getAgentMemory(agentId: string): Observable<IEnhancedAgentMemory> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');

        // Return existing memory from cache if available (fast path)
        const existingMemory = this.agentMemory.get(agentId);
        if (existingMemory) {
            return of(existingMemory);
        }

        // If persistence service is available, try loading from MongoDB
        if (this.persistenceService) {
            return new Observable<IEnhancedAgentMemory>(observer => {
                this.persistenceService.getAgentMemory(agentId).subscribe({
                    next: (loadedMemory: any) => {
                        // Enhance the loaded memory with cognitive memory structure
                        const enhancedMemory: IEnhancedAgentMemory = {
                            ...loadedMemory,
                            cognitiveMemory: loadedMemory.cognitiveMemory || {
                                observationIds: [],
                                reasoningIds: [],
                                planIds: [],
                                reflectionIds: []
                            }
                        };

                        // Cache the loaded memory
                        this.agentMemory.set(agentId, enhancedMemory);


                        observer.next(enhancedMemory);
                        observer.complete();
                    },
                    error: (error: any) => {
                        this.logger.warn(`Failed to load agent memory from MongoDB for ${agentId}: ${error.message}`);
                        // Fall back to creating new memory
                        const newMemory = this.createNewAgentMemory(agentId);
                        observer.next(newMemory);
                        observer.complete();
                    }
                });
            });
        }

        // No persistence service - create new memory
        const newMemory = this.createNewAgentMemory(agentId);
        return of(newMemory);
    }

    /**
     * Create new agent memory
     * @param agentId Agent ID
     * @returns New agent memory
     */
    private createNewAgentMemory(agentId: string): IEnhancedAgentMemory {
        const newMemory: IEnhancedAgentMemory = {
            id: uuidv4(),
            agentId,
            createdAt: new Date(),
            updatedAt: new Date(),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            conversationHistory: [],
            customData: {},
            cognitiveMemory: {
                observationIds: [],
                reasoningIds: [],
                planIds: [],
                reflectionIds: []
            }
        };

        this.agentMemory.set(agentId, newMemory);

        const operationId_agent_get_new = uuidv4();
        const systemAgentId_agent_get_new: AgentId = 'SYSTEM_AGENT';
        const noChannelId_agent_get_new: ChannelId = 'NO_CHANNEL';
        const updateResultData_agent_get_new: MemoryUpdateResultEventData = {
            operationId: operationId_agent_get_new,
            scope: MemoryScope.AGENT,
            id: agentId,
            memory: newMemory
        };
        EventBus.server.emit(
            Events.Memory.UPDATE_RESULT,
            createMemoryUpdateResultEventPayload(
                Events.Memory.UPDATE_RESULT,
                systemAgentId_agent_get_new,
                noChannelId_agent_get_new,
                updateResultData_agent_get_new
            )
        );

        return newMemory;
    }
    
    /**
     * Update agent memory
     * @param pAgentId Agent ID
     * @param updates Memory updates
     * @returns Observable of updated agent memory
     */
    public updateAgentMemory(pAgentId: string, updates: Partial<IEnhancedAgentMemory>): Observable<IEnhancedAgentMemory> {
        this.validator.assertIsNonEmptyString(pAgentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsObject(updates, 'Updates must be an object');
        
        // Get existing memory or create new one
        return new Observable<IEnhancedAgentMemory>(observer => {
            this.getAgentMemory(pAgentId).subscribe(originalAgentMemory => {
                // Apply updates
                const updatedMemory: IEnhancedAgentMemory = {
                    ...originalAgentMemory,
                    ...updates,
                    updatedAt: new Date(),
                    // Ensure these fields can't be overridden
                    id: originalAgentMemory.id,
                    agentId: originalAgentMemory.agentId,
                    createdAt: originalAgentMemory.createdAt
                };
                
                // Deep merge for nested objects
                if (updates.notes) {
                    updatedMemory.notes = { ...originalAgentMemory.notes, ...updates.notes };
                }
                
                if (updates.customData) {
                    updatedMemory.customData = { ...originalAgentMemory.customData, ...updates.customData };
                }
                
                if (updates.cognitiveMemory) {
                    updatedMemory.cognitiveMemory = {
                        ...originalAgentMemory.cognitiveMemory,
                        ...updates.cognitiveMemory
                    };
                }
                
                // Replace conversation history if provided (SDK sends full array, not incremental)
                if (updates.conversationHistory !== undefined) {
                    updatedMemory.conversationHistory = updates.conversationHistory;
                }
                
                // Store updated memory in cache
                this.agentMemory.set(pAgentId, updatedMemory);

                // Persist to MongoDB if persistence service is available (async, non-blocking)
                if (this.persistenceService) {
                    this.persistenceService.saveAgentMemory(updatedMemory)
                        .subscribe({
                            next: () => null,
                            error: (err: any) => this.logger.warn(`Failed to persist agent memory to MongoDB for ${pAgentId}: ${err.message}`)
                        });
                }

                // Emit update event through EventBus
                const operationId = uuidv4(); // Generate operationId for the event data
                const updateResultData: MemoryUpdateResultEventData = {
                    operationId,
                    scope: MemoryScope.AGENT,
                    id: pAgentId,
                    memory: updatedMemory
                };

                // Define standard agentId and channelId for system-level memory events
                const systemAgentId: AgentId = 'SYSTEM_AGENT'; // Or a more specific system agent ID
                const noChannelId: ChannelId = 'NO_CHANNEL';   // Or a more specific system channel ID or null if appropriate

                const payload = createMemoryUpdateResultEventPayload(
                    Events.Memory.UPDATE_RESULT,
                    systemAgentId,
                    noChannelId,
                    updateResultData
                );
                EventBus.server.emit(Events.Memory.UPDATE_RESULT, payload);
                
                observer.next(updatedMemory);
                observer.complete();
            }, error => {
                const operationId_agent_update_error = uuidv4();
                const updateResultData_agent_update_error: MemoryUpdateResultEventData = {
                    operationId: operationId_agent_update_error,
                    scope: MemoryScope.AGENT,
                    id: pAgentId,
                    memory: null,
                    error: (error as Error).message
                };
                const systemAgentId_agent_update_error: AgentId = 'SYSTEM_AGENT'; // Or a more specific system agent ID
                const noChannelId_agent_update_error: ChannelId = 'NO_CHANNEL';   // Or a more specific system channel ID or null if appropriate
                EventBus.server.emit(
                    Events.Memory.UPDATE_RESULT, 
                    createMemoryUpdateResultEventPayload(
                        Events.Memory.UPDATE_RESULT,
                        systemAgentId_agent_update_error,
                        noChannelId_agent_update_error,
                        updateResultData_agent_update_error
                    )
                );
                observer.error(error);
            });
        });
    }
    
    /**
     * Channel-scoped validation for cognitive operations
     * @param agentId Agent ID
     * @param channelId Channel ID
     */
    private validateCognitiveAccess(agentId: AgentId, channelId: ChannelId): void {
        const agentMemory = this.agentMemory.get(agentId);
        if (!agentMemory) {
            throw new Error(`Agent ${agentId} not found in memory`);
        }
        // Note: Agent memory doesn't currently store channelId, but in the unified architecture it should
        // For now, we'll validate that the agent exists and the channel is provided
        if (!channelId) {
            throw new Error(`Channel ID required for cognitive operations`);
        }
    }
    
    /**
     * Store an observation in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param observation The observation to store
     * @returns Observable of observation ID
     */
    public storeObservation(agentId: AgentId, channelId: ChannelId, observation: Observation): Observable<string> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(observation, 'Observation must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const observationId = `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Create cognitive memory entry
        const cognitiveEntry: CognitiveMemoryEntry<Observation> = {
            id: observationId,
            agentId,
            channelId,
            memoryType: CognitiveMemoryType.SHORT_TERM,
            content: {
                ...observation,
                id: observationId,
                agentId,
                timestamp: observation.timestamp || Date.now()
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            labels: ['observation'],
            relevance: 1.0
        };
        
        // Store in cognitive memory
        this.cognitiveMemory.set(observationId, cognitiveEntry);
        
        // Update agent memory references
        this.updateAgentMemory(agentId, {
            cognitiveMemory: {
                observationIds: [...(this.agentMemory.get(agentId)?.cognitiveMemory.observationIds || []), observationId],
                reasoningIds: this.agentMemory.get(agentId)?.cognitiveMemory.reasoningIds || [],
                planIds: this.agentMemory.get(agentId)?.cognitiveMemory.planIds || [],
                reflectionIds: this.agentMemory.get(agentId)?.cognitiveMemory.reflectionIds || []
            }
        }).subscribe();
        
        // ;
        
        return of(observationId);
    }
    
    /**
     * Get recent observations for an agent
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param limit Maximum number of observations to retrieve
     * @returns Observable of observations
     */
    public getRecentObservations(agentId: AgentId, channelId: ChannelId, limit: number = 10): Observable<Observation[]> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const agentMemory = this.agentMemory.get(agentId);
        if (!agentMemory) {
            return of([]);
        }
        
        // Get observations from cognitive memory
        const observations: Observation[] = agentMemory.cognitiveMemory.observationIds
            .map(id => this.cognitiveMemory.get(id))
            .filter(entry => entry && entry.channelId === channelId)
            .sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0))
            .slice(0, limit)
            .map(entry => entry!.content)
            .filter(obs => obs) as Observation[];
        
        return of(observations);
    }
    
    /**
     * Store reasoning in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param reasoning The reasoning to store
     * @returns Observable of reasoning ID
     */
    public storeReasoning(agentId: AgentId, channelId: ChannelId, reasoning: Reasoning): Observable<string> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(reasoning, 'Reasoning must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const reasoningId = `reason-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Create cognitive memory entry
        const cognitiveEntry: CognitiveMemoryEntry<Reasoning> = {
            id: reasoningId,
            agentId,
            channelId,
            memoryType: CognitiveMemoryType.WORKING,
            content: {
                ...reasoning,
                id: reasoningId,
                agentId,
                timestamp: reasoning.timestamp || Date.now()
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            labels: ['reasoning'],
            relevance: reasoning.confidence || 1.0
        };
        
        // Store in cognitive memory
        this.cognitiveMemory.set(reasoningId, cognitiveEntry);
        
        // Update agent memory references
        this.updateAgentMemory(agentId, {
            cognitiveMemory: {
                observationIds: this.agentMemory.get(agentId)?.cognitiveMemory.observationIds || [],
                reasoningIds: [...(this.agentMemory.get(agentId)?.cognitiveMemory.reasoningIds || []), reasoningId],
                planIds: this.agentMemory.get(agentId)?.cognitiveMemory.planIds || [],
                reflectionIds: this.agentMemory.get(agentId)?.cognitiveMemory.reflectionIds || []
            }
        }).subscribe();
        
        // ;
        
        return of(reasoningId);
    }
    
    /**
     * Store a plan in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param plan The plan to store
     * @returns Observable of plan ID
     */
    public storePlan(agentId: AgentId, channelId: ChannelId, plan: Plan): Observable<string> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(plan, 'Plan must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const planId = `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Create cognitive memory entry
        const cognitiveEntry: CognitiveMemoryEntry<Plan> = {
            id: planId,
            agentId,
            channelId,
            memoryType: CognitiveMemoryType.WORKING,
            content: {
                ...plan,
                id: planId,
                agentId,
                timestamp: plan.timestamp || Date.now()
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            labels: ['plan'],
            relevance: 1.0
        };
        
        // Store in cognitive memory
        this.cognitiveMemory.set(planId, cognitiveEntry);
        
        // Update agent memory references
        this.updateAgentMemory(agentId, {
            cognitiveMemory: {
                observationIds: this.agentMemory.get(agentId)?.cognitiveMemory.observationIds || [],
                reasoningIds: this.agentMemory.get(agentId)?.cognitiveMemory.reasoningIds || [],
                planIds: [...(this.agentMemory.get(agentId)?.cognitiveMemory.planIds || []), planId],
                reflectionIds: this.agentMemory.get(agentId)?.cognitiveMemory.reflectionIds || []
            }
        }).subscribe();
        
        // ;
        
        return of(planId);
    }
    
    /**
     * Update a plan in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param plan The updated plan
     * @returns Observable of success status
     */
    public updatePlan(agentId: AgentId, channelId: ChannelId, plan: Plan): Observable<boolean> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(plan, 'Plan must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const existingEntry = this.cognitiveMemory.get(plan.id);
        if (!existingEntry || existingEntry.agentId !== agentId || existingEntry.channelId !== channelId) {
            return of(false);
        }
        
        // Update cognitive memory entry
        const updatedEntry: CognitiveMemoryEntry<Plan> = {
            ...existingEntry,
            content: {
                ...plan,
                timestamp: plan.timestamp || Date.now()
            },
            updatedAt: Date.now()
        };
        
        this.cognitiveMemory.set(plan.id, updatedEntry);
        
        // ;
        
        return of(true);
    }
    
    /**
     * Store a reflection in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param reflection The reflection to store
     * @returns Observable of reflection ID
     */
    public storeReflection(agentId: AgentId, channelId: ChannelId, reflection: Reflection): Observable<string> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(reflection, 'Reflection must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const reflectionId = `reflect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Create cognitive memory entry
        const cognitiveEntry: CognitiveMemoryEntry<Reflection> = {
            id: reflectionId,
            agentId,
            channelId,
            memoryType: CognitiveMemoryType.LONG_TERM,
            content: {
                ...reflection,
                id: reflectionId,
                agentId,
                timestamp: reflection.timestamp || Date.now()
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            labels: ['reflection'],
            relevance: 1.0
        };
        
        // Store in cognitive memory
        this.cognitiveMemory.set(reflectionId, cognitiveEntry);
        
        // Update agent memory references
        this.updateAgentMemory(agentId, {
            cognitiveMemory: {
                observationIds: this.agentMemory.get(agentId)?.cognitiveMemory.observationIds || [],
                reasoningIds: this.agentMemory.get(agentId)?.cognitiveMemory.reasoningIds || [],
                planIds: this.agentMemory.get(agentId)?.cognitiveMemory.planIds || [],
                reflectionIds: [...(this.agentMemory.get(agentId)?.cognitiveMemory.reflectionIds || []), reflectionId]
            }
        }).subscribe();
        
        // ;
        
        return of(reflectionId);
    }
    
    /**
     * Query cognitive memory with filtering options
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param options Query options
     * @returns Observable of cognitive memory entries
     */
    public queryCognitiveMemory(agentId: AgentId, channelId: ChannelId, options: CognitiveMemoryQueryOptions = {}): Observable<CognitiveMemoryEntry<any>[]> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        // Get all cognitive memory entries for this agent and channel
        const entries = Array.from(this.cognitiveMemory.values())
            .filter(entry => entry.agentId === agentId && entry.channelId === channelId);
        
        // Apply filters
        let filteredEntries = entries;
        
        if (options.memoryTypes && options.memoryTypes.length > 0) {
            filteredEntries = filteredEntries.filter(entry => options.memoryTypes!.includes(entry.memoryType));
        }
        
        if (options.labels && options.labels.length > 0) {
            filteredEntries = filteredEntries.filter(entry => 
                options.labels!.some(label => entry.labels.includes(label))
            );
        }
        
        if (options.fromTimestamp) {
            filteredEntries = filteredEntries.filter(entry => entry.createdAt >= options.fromTimestamp!);
        }
        
        if (options.toTimestamp) {
            filteredEntries = filteredEntries.filter(entry => entry.createdAt <= options.toTimestamp!);
        }
        
        // Sort results
        const sortBy = options.sortBy || 'createdAt';
        const sortDirection = options.sortDirection || 'desc';
        filteredEntries.sort((a, b) => {
            const aVal = a[sortBy] || 0;
            const bVal = b[sortBy] || 0;
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });
        
        // Apply pagination
        const offset = options.offset || 0;
        const limit = options.limit || 50;
        filteredEntries = filteredEntries.slice(offset, offset + limit);
        
        return of(filteredEntries);
    }
    
    /**
     * Get channel memory
     * @param channelId Channel ID
     * @returns Observable of channel memory
     */
    public getChannelMemory(channelId: string): Observable<IEnhancedChannelMemory> {
        // ;
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        
        // Return from cache if available
        if (this.channelMemory.has(channelId)) {
            const memory = this.channelMemory.get(channelId)!;
            // ;
            return of(memory);
        }
        
        
        // Create new memory
        const newMemory: IEnhancedChannelMemory = {
            id: uuidv4(),
            channelId,
            createdAt: new Date(),
            updatedAt: new Date(),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            sharedState: {},
            conversationHistory: [],
            customData: {},
            lastActivity: undefined,
            messageCount: undefined,
            participants: undefined,
            topics: undefined,
            summary: undefined,
            sharedCognitiveInsights: {
                systemSummaries: [],
                topicExtractions: [],
                collaborativeReflections: []
            }
        };
        
        this.channelMemory.set(channelId, newMemory);
        
        const operationId_channel_get_new = uuidv4();
        const systemAgentId_channel_get_new: AgentId = 'SYSTEM_AGENT';
        const noChannelId_channel_get_new: ChannelId = 'NO_CHANNEL';
        const updateResultData_channel_get_new: MemoryUpdateResultEventData = {
            operationId: operationId_channel_get_new,
            scope: MemoryScope.CHANNEL,
            id: channelId,
            memory: newMemory
        };
        EventBus.server.emit(
            Events.Memory.UPDATE_RESULT, 
            createMemoryUpdateResultEventPayload(
                Events.Memory.UPDATE_RESULT,
                systemAgentId_channel_get_new,
                noChannelId_channel_get_new,
                updateResultData_channel_get_new
            )
        );
        
        return of(newMemory);
    }
    
    /**
     * Update channel memory
     * @param channelId Channel ID
     * @param updates Channel memory updates
     * @returns Observable of updated channel memory
     */
    public updateChannelMemory(channelId: ChannelId, updates: Partial<IEnhancedChannelMemory>): Observable<IEnhancedChannelMemory> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');

        return new Observable<IEnhancedChannelMemory>(observer => {
            this.getChannelMemory(channelId).subscribe(originalChannelMemory => {
                // Create updated memory by merging with original
                const updatedMemory: IEnhancedChannelMemory = {
                    ...originalChannelMemory, // This spreads all base properties
                    channelId,
                    lastActivity: updates.lastActivity || originalChannelMemory.lastActivity || Date.now(),
                    messageCount: updates.messageCount !== undefined ? updates.messageCount : originalChannelMemory.messageCount,
                    participants: updates.participants 
                        ? [...new Set([...(originalChannelMemory.participants || []), ...updates.participants])] 
                        : originalChannelMemory.participants,
                    topics: updates.topics 
                        ? [...new Set([...(originalChannelMemory.topics || []), ...updates.topics])] 
                        : originalChannelMemory.topics,
                    summary: updates.summary || originalChannelMemory.summary,
                    conversationHistory: [...(originalChannelMemory.conversationHistory || [])],
                    sharedCognitiveInsights: {
                        ...originalChannelMemory.sharedCognitiveInsights,
                        ...updates.sharedCognitiveInsights
                    }
                };

                // Handle conversation history updates  
                if (updates.conversationHistory && updates.conversationHistory.length > 0) {
                    updatedMemory.conversationHistory = [
                        ...(originalChannelMemory.conversationHistory || []),
                        ...updates.conversationHistory
                    ];
                }

                // Store updated memory in cache
                this.channelMemory.set(channelId, updatedMemory);

                // Emit update event through EventBus
                const operationId = uuidv4();
                const updateResultData: MemoryUpdateResultEventData = {
                    operationId,
                    scope: MemoryScope.CHANNEL,
                    id: channelId,
                    memory: updatedMemory
                };

                // Define standard agentId and channelId for system-level memory events
                const systemAgentId: AgentId = 'SYSTEM_AGENT';
                const systemChannelId: ChannelId = channelId; // Use the actual channel ID for channel operations

                const payload = createMemoryUpdateResultEventPayload(
                    Events.Memory.UPDATE_RESULT,
                    systemAgentId,
                    systemChannelId,
                    updateResultData
                );
                EventBus.server.emit(Events.Memory.UPDATE_RESULT, payload);

                observer.next(updatedMemory);
                observer.complete();
            }, error => {
                const operationId_channel_update_error = uuidv4();
                const updateResultData_channel_update_error: MemoryUpdateResultEventData = {
                    operationId: operationId_channel_update_error,
                    scope: MemoryScope.CHANNEL,
                    id: channelId,
                    memory: null,
                    error: (error as Error).message
                };
                const systemAgentId_channel_update_error: AgentId = 'SYSTEM_AGENT';
                const systemChannelId_channel_update_error: ChannelId = channelId;
                EventBus.server.emit(
                    Events.Memory.UPDATE_RESULT,
                    createMemoryUpdateResultEventPayload(
                        Events.Memory.UPDATE_RESULT,
                        systemAgentId_channel_update_error,
                        systemChannelId_channel_update_error,
                        updateResultData_channel_update_error
                    )
                );
                observer.error(error);
            });
        });
    }
    
    /**
     * Get relationship memory
     * @param agentId1 First agent ID
     * @param agentId2 Second agent ID
     * @param channelId Optional channel ID
     * @returns Observable of relationship memory
     */
    public getRelationshipMemory(agentId1: string, agentId2: string, channelId?: string): Observable<IRelationshipMemory> {
        this.validator.assertIsNonEmptyString(agentId1, 'First agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(agentId2, 'Second agent ID must be a non-empty string');
        
        // Sort agent IDs for consistent key generation
        const [sortedId1, sortedId2] = [agentId1, agentId2].sort();
        
        // Create a composite key
        const relationshipKey = channelId 
            ? `${sortedId1}:${sortedId2}:${channelId}`
            : `${sortedId1}:${sortedId2}`;
        
        // Return existing memory if available
        const existingMemory = this.relationshipMemory.get(relationshipKey);
        if (existingMemory) {
            return of(existingMemory);
        }
        
        // Create new memory
        const newMemory: IRelationshipMemory = {
            id: uuidv4(),
            agentId1: sortedId1,
            agentId2: sortedId2,
            channelId,
            createdAt: new Date(),
            updatedAt: new Date(),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            interactionHistory: [],
            customData: {}
        };
        
        this.relationshipMemory.set(relationshipKey, newMemory);
        
        const operationId_rel_get_new = uuidv4();
        const systemAgentId_rel_get_new: AgentId = 'SYSTEM_AGENT';
        const noChannelId_rel_get_new: ChannelId = 'NO_CHANNEL';
        const updateResultData_rel_get_new: MemoryUpdateResultEventData = {
            operationId: operationId_rel_get_new,
            scope: MemoryScope.RELATIONSHIP,
            id: relationshipKey,
            memory: newMemory
        };
        EventBus.server.emit(
            Events.Memory.UPDATE_RESULT, 
            createMemoryUpdateResultEventPayload(
                Events.Memory.UPDATE_RESULT,
                systemAgentId_rel_get_new,
                noChannelId_rel_get_new,
                updateResultData_rel_get_new
            )
        );
        
        return of(newMemory);
    }
    
    /**
     * Update relationship memory
     * @param pAgentId1 Agent ID 1
     * @param pAgentId2 Agent ID 2
     * @param pChannelId Channel ID (optional, for context)
     * @param updates Memory updates
     * @returns Observable of updated relationship memory
     */
    public updateRelationshipMemory(pAgentId1: string, pAgentId2: string, pChannelId: string, updates: Partial<IRelationshipMemory>): Observable<IRelationshipMemory> {
        this.validator.assertIsNonEmptyString(pAgentId1, 'Agent ID 1 must be a non-empty string');
        this.validator.assertIsNonEmptyString(pAgentId2, 'Agent ID 2 must be a non-empty string');
        this.validator.assertIsNonEmptyString(pChannelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(updates, 'Updates must be an object');
        
        const relationshipKey = this.getRelationshipKey(pAgentId1, pAgentId2, pChannelId);
        
        // Get existing memory or create new one
        return new Observable<IRelationshipMemory>(observer => {
            this.getRelationshipMemory(pAgentId1, pAgentId2, pChannelId).subscribe(originalRelationshipMemory => {
                // Apply updates
                const updatedMemory: IRelationshipMemory = {
                    ...originalRelationshipMemory,
                    ...updates,
                    updatedAt: new Date(),
                    // Ensure these fields can't be overridden
                    id: originalRelationshipMemory.id,
                    agentId1: originalRelationshipMemory.agentId1,
                    agentId2: originalRelationshipMemory.agentId2,
                    channelId: originalRelationshipMemory.channelId,
                    createdAt: originalRelationshipMemory.createdAt
                };
                
                // Deep merge for nested objects (if any)
                // Example: if (updates.customData) { updatedMemory.customData = { ...originalRelationshipMemory.customData, ...updates.customData }; }
                
                // Update in-memory store
                this.relationshipMemory.set(relationshipKey, updatedMemory);
                
                const operationId_rel_update_success = uuidv4();
                const systemAgentId_rel_update_success: AgentId = 'SYSTEM_AGENT';
                const noChannelId_rel_update_success: ChannelId = 'NO_CHANNEL'; // General system event
                const updateResultData_rel_update_success: MemoryUpdateResultEventData = {
                    operationId: operationId_rel_update_success,
                    scope: MemoryScope.RELATIONSHIP,
                    id: relationshipKey,
                    memory: updatedMemory
                };
                EventBus.server.emit(
                    Events.Memory.UPDATE_RESULT, 
                    createMemoryUpdateResultEventPayload(
                        Events.Memory.UPDATE_RESULT,
                        systemAgentId_rel_update_success,
                        noChannelId_rel_update_success,
                        updateResultData_rel_update_success
                    )
                );
                
                // Return updated memory
                observer.next(updatedMemory);
                observer.complete();
            }, error => { // This 'error' is from getRelationshipMemory()
                const operationId_rel_update_error = uuidv4();
                const systemAgentId_rel_update_error: AgentId = 'SYSTEM_AGENT';
                const noChannelId_rel_update_error: ChannelId = 'NO_CHANNEL';
                // Reconstruct the key for the 'id' field as it was the one attempted for the update.
                const attemptedRelationshipKey = this.getRelationshipKey(pAgentId1, pAgentId2, pChannelId);
                const updateResultData_rel_update_error: MemoryUpdateResultEventData = {
                    operationId: operationId_rel_update_error,
                    scope: MemoryScope.RELATIONSHIP,
                    id: attemptedRelationshipKey, // Use the key that was attempted
                    memory: null,
                    error: (error as Error).message
                };
                EventBus.server.emit(
                    Events.Memory.UPDATE_RESULT, 
                    createMemoryUpdateResultEventPayload(
                        Events.Memory.UPDATE_RESULT,
                        systemAgentId_rel_update_error,
                        noChannelId_rel_update_error,
                        updateResultData_rel_update_error
                    )
                );
                observer.error(error);
            });
        });
    }
    
    /**
     * Delete memory by scope and ID
     * @param scope Memory scope
     * @param id Entity ID
     * @returns Observable of success status
     */
    public deleteMemory(scope: MemoryScope, id: string): Observable<boolean> {
        this.validator.validateMemoryScope(scope);
        this.validator.assertIsNonEmptyString(id, 'ID must be a non-empty string');
        
        let success = false;
        const operationId = uuidv4(); // Generate operationId for the event data

        switch (scope) {
            case MemoryScope.AGENT:
                success = this.agentMemory.delete(id);
                break;
            case MemoryScope.CHANNEL:
                success = this.channelMemory.delete(id);
                break;
            case MemoryScope.RELATIONSHIP:
                success = this.relationshipMemory.delete(id);
                break;
        }
        
        // Emit delete event through EventBus
        const deleteResultData: MemoryDeleteResultEventData = {
            operationId,
            scope,
            id,
            success
        };

        // Define standard agentId and channelId for system-level memory events
        const systemAgentId: AgentId = 'SYSTEM_AGENT'; // Or a more specific system agent ID
        const noChannelId: ChannelId = 'NO_CHANNEL';   // Or a more specific system channel ID or null if appropriate

        const payload = createMemoryDeleteResultEventPayload(
            Events.Memory.DELETE_RESULT,
            systemAgentId,
            noChannelId,
            deleteResultData
        );
        EventBus.server.emit(Events.Memory.DELETE_RESULT, payload);
        
        return of(success);
    }
    
    /**
     * Clear all memory of a specific scope
     * @param scope Memory scope
     * @returns Observable of success status
     */
    public clearMemory(scope: MemoryScope): Observable<boolean> {
        this.validator.validateMemoryScope(scope);
        
        switch (scope) {
            case MemoryScope.AGENT:
                this.agentMemory.clear();
                break;
            case MemoryScope.CHANNEL:
                this.channelMemory.clear();
                break;
            case MemoryScope.RELATIONSHIP:
                this.relationshipMemory.clear();
                break;
        }
        
        // Emit clear event through EventBus
        EventBus.server.emit(Events.Memory.CLEAR_RESULT, {
            scope,
            timestamp: Date.now()
        });
        
        return of(true);
    }
    
    /**
     * Clear all memory
     * @returns Observable of success status
     */
    public clearAllMemory(): Observable<boolean> {
        this.agentMemory.clear();
        this.channelMemory.clear();
        this.relationshipMemory.clear();
        this.generalData.clear();
        this.cognitiveMemory.clear();

        // Emit clear all event through EventBus
        EventBus.server.emit(Events.Memory.CLEAR_ALL_RESULT, {
            timestamp: Date.now()
        });

        return of(true);
    }

    /**
     * Get general key-value data
     * Used for tool-level key-value storage
     */
    public getGeneralData(key: string): any {
        return this.generalData.get(key);
    }

    /**
     * Set general key-value data
     * Used for tool-level key-value storage
     */
    public setGeneralData(key: string, value: any): void {
        this.generalData.set(key, value);
    }

    /**
     * Delete general key-value data
     */
    public deleteGeneralData(key: string): boolean {
        return this.generalData.delete(key);
    }
    
    private getRelationshipKey(agentId1: string, agentId2: string, channelId?: string): string {
        const [sortedId1, sortedId2] = [agentId1, agentId2].sort();
        return channelId ? `${sortedId1}:${sortedId2}:${channelId}` : `${sortedId1}:${sortedId2}`;
    }

    /**
     * Compare two data objects to determine if they are equal
     * Uses deep comparison for objects and arrays
     */
    private isDataEqual(data1: any, data2: any): boolean {
        // Handle null/undefined cases
        if (data1 === data2) return true;
        if (data1 == null || data2 == null) return false;
        
        // Handle primitive types
        if (typeof data1 !== 'object' || typeof data2 !== 'object') {
            return data1 === data2;
        }
        
        // Handle arrays
        if (Array.isArray(data1) && Array.isArray(data2)) {
            if (data1.length !== data2.length) return false;
            return data1.every((item, index) => this.isDataEqual(item, data2[index]));
        }
        
        // Handle objects
        if (Array.isArray(data1) || Array.isArray(data2)) return false;
        
        const keys1 = Object.keys(data1);
        const keys2 = Object.keys(data2);
        
        if (keys1.length !== keys2.length) return false;
        
        return keys1.every(key => 
            keys2.includes(key) && this.isDataEqual(data1[key], data2[key])
        );
    }
}
