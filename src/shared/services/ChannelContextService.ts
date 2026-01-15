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
 * Channel Context Service
 * 
 * Core implementation of the channel context service that integrates with
 * the memory system for persistent storage of channel context information.
 * 
 * This service is modularized into several components:
 * - ChannelContextMemoryOperations: Handles memory-related operations
 * - ChannelContextMessageOperations: Handles message operations
 * - SystemLlmService: Handles LLM-powered features
 */

import { Observable, of, throwError } from 'rxjs';
import { map, catchError, mergeMap, tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

import { 
    ChannelId, 
    AgentId, 
    IChannelContextService, 
    ChannelContextType,
    ChannelMessage,
    ChannelContextHistoryEntry,
    ConversationTopic
} from '../types/ChannelContext';

import { ChannelContextMemoryOperations } from './ChannelContextMemoryOperations';
import { ChannelContextMessageOperations } from './ChannelContextMessageOperations';
import { SystemLlmServiceManager } from '../../server/socket/services/SystemLlmServiceManager';

import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events, ChannelActionTypes } from '../events/EventNames';
import { 
    createChannelEventPayload, 
    ChannelEventData,
    ChannelEventPayload,
    createMemoryDeleteEventPayload, 
    MemoryDeleteEventData 
} from '../schemas/EventPayloadSchema';
import { MemoryScope } from '../types/MemoryTypes';

/**
 * Implementation of the Channel Context Service
 * This service integrates the modular components to provide a complete
 * implementation of the IChannelContextService interface.
 */
export class ChannelContextService implements IChannelContextService {
    private static instance: ChannelContextService | null = null;
    private static isClientContext: boolean = false; // Track if we're running in client context
    
    // Instance logger - will be set based on context
    private logger: Logger;
    
    // Cache for channel contexts
    protected contextCache: Map<ChannelId, ChannelContextType> = new Map();
    
    // Service components
    private memoryOps: ChannelContextMemoryOperations;
    private messageOps: ChannelContextMessageOperations;
    
    private constructor() {
        // Initialize logger based on context
        const target = ChannelContextService.isClientContext ? 'client' : 'server';
        this.logger = new Logger('debug', 'ChannelContextService', target);
        // Pass context flag to operations
        this.memoryOps = new ChannelContextMemoryOperations(ChannelContextService.isClientContext);
        this.messageOps = new ChannelContextMessageOperations(ChannelContextService.isClientContext);
        
        // Set up event listeners for context changes
        this.setupEventListeners();
    }
    
    /**
     * Set whether we're running in client context
     * MUST be called before getInstance() on the client side
     */
    public static setClientContext(isClient: boolean): void {
        ChannelContextService.isClientContext = isClient;
    }
    
    /**
     * Get the singleton instance of the Channel Context Service
     */
    public static getInstance(): ChannelContextService {
        if (!ChannelContextService.instance) {
            ChannelContextService.instance = new ChannelContextService();
        }
        return ChannelContextService.instance;
    }
    
    /**
     * Create a new channel context
     * @param channelId - Channel ID
     * @param name - Channel name
     * @param description - Channel description
     * @param creatorId - Creator agent ID
     */
    public createContext = (
        channelId: ChannelId,
        name: string,
        description: string,
        creatorId: AgentId
    ): Observable<ChannelContextType> => {
        
        // Validate inputs
        if (!channelId) return throwError(() => new Error('Channel ID is required'));
        if (!name) return throwError(() => new Error('Channel name is required'));
        if (!creatorId) return throwError(() => new Error('Creator agent ID is required'));
        
        const timestamp = Date.now();
        
        // Create context object
        const context: ChannelContextType = {
            id: uuidv4(),
            channelId,
            name,
            description,
            createdAt: timestamp,
            createdBy: creatorId,
            lastActivity: timestamp,
            participants: [creatorId],
            metadata: {},
            status: 'active',
            messageCount: 0,
            updatedAt: timestamp
        };
        
        
        // Create history entry for creation
        const historyEntry: ChannelContextHistoryEntry = {
            timestamp,
            type: 'create',
            data: { name, description },
            agentId: creatorId
        };
        
        
        // Store in channel memory
        return this.saveContextToMemory(channelId, context, historyEntry).pipe(
            tap(savedContext => {
                // Update cache
                this.contextCache.set(channelId, savedContext);
                
                // Emit context change event through EventBus
                const eventData: ChannelEventData = {
                    action: ChannelActionTypes.CREATE,
                    name: savedContext.name,
                    metadata: { context: savedContext }
                };
                const payload = createChannelEventPayload(
                    Events.Channel.CREATED,
                    creatorId,
                    savedContext.channelId,
                    eventData
                );
                EventBus.server.emit(Events.Channel.CREATED, payload);
                
            })
        );
    };
    
    /**
     * Get channel context
     * @param channelId - Channel ID
     */
    public getContext = (channelId: ChannelId): Observable<ChannelContextType | null> => {
        
        // Check cache first
        if (this.contextCache.has(channelId)) {
            const cachedContext = this.contextCache.get(channelId)!;
            if (cachedContext) {
            }
            return of(cachedContext);
        }
        
        
        // Retrieve from memory system
        return this.memoryOps.getContextFromMemory(channelId).pipe(
            tap(context => {
                // Update cache only if context is not null
                if (context) {
                    this.contextCache.set(channelId, context);
                } else {
        this.logger.warn(`[Service] Context not found in memory for channel ${channelId}`);
                }
            })
        );
    };
    
    /**
     * Update channel context
     * @param channelId - Channel ID
     * @param updates - Context updates
     * @param agentId - Agent making the updates
     */
    public updateContext = (
        channelId: ChannelId,
        updates: Partial<ChannelContextType>,
        agentId: AgentId
    ): Observable<ChannelContextType> => {
        
        // Validate inputs
        if (!channelId) return throwError(() => new Error('Channel ID is required'));
        if (!updates) return throwError(() => new Error('Context updates are required'));
        if (!agentId) return throwError(() => new Error('Agent ID is required'));
        
        return this.getContext(channelId).pipe(
            mergeMap(existingContext => {
                if (!existingContext) {
                    return throwError(() => new Error(`Channel context not found for ID: ${channelId} during updateContext`));
                }

                const timestamp = Date.now();
                
                // Merge updates with existing context
                const updatedContext: ChannelContextType = {
                    ...existingContext,
                    ...updates,
                    id: existingContext.id, // Ensure id is explicitly carried over and is not partial
                    channelId: existingContext.channelId, // Ensure channelId is explicitly carried over
                    updatedAt: timestamp,
                    lastActivity: timestamp
                };
                
                // Create history entry
                const historyEntry: ChannelContextHistoryEntry = {
                    timestamp,
                    type: 'update',
                    data: updates,
                    agentId
                };
                
                // Store in memory
                return this.saveContextToMemory(channelId, updatedContext, historyEntry).pipe(
                    tap(savedContext => {
                        // Emit context change event
                        const eventData: ChannelEventData = {
                            action: ChannelActionTypes.UPDATE,
                            metadata: { context: savedContext }
                        };
                        const payload = createChannelEventPayload(
                            Events.Channel.CONTEXT.UPDATED,
                            agentId,
                            channelId,
                            eventData
                        );
                        EventBus.server.emit(Events.Channel.CONTEXT.UPDATED, payload);
                    })
                );
            })
        );
    };
    
    /**
     * Add an agent to a channel
     * @param channelId - Channel ID
     * @param agentId - Agent ID to add
     */
    public addAgentToChannel = (
        channelId: ChannelId,
        agentId: AgentId
    ): Observable<ChannelContextType> => {
        
        // Validate inputs
        if (!channelId) return throwError(() => new Error('Channel ID is required'));
        if (!agentId) return throwError(() => new Error('Agent ID is required'));
        
        return this.getContext(channelId).pipe(
            mergeMap(existingContext => {
                if (!existingContext) {
                    return throwError(() => new Error(`Channel context not found for ID: ${channelId} during addAgentToChannel`));
                }

                // Check if agent is already a participant
                if (existingContext.participants.includes(agentId)) {
        this.logger.warn(`Agent ${agentId} is already a participant in channel ${channelId}`);
                    return of(existingContext); // Return existing context if agent already present
                }
                
                const timestamp = Date.now();
                
                // Add agent to participants list
                const updatedParticipants = [...existingContext.participants, agentId];
                
                const updatedContext: ChannelContextType = {
                    ...existingContext,
                    participants: updatedParticipants,
                    updatedAt: timestamp,
                    lastActivity: timestamp
                };
                
                // Create history entry
                const historyEntry: ChannelContextHistoryEntry = {
                    timestamp,
                    type: 'join',
                    data: { agentId },
                    agentId // Agent performing the action
                };
                
                // Save updated context
                return this.saveContextToMemory(channelId, updatedContext, historyEntry).pipe(
                    tap(savedContext => {
                        // Emit context update event
                        const contextUpdateEventData: ChannelEventData = {
                            action: ChannelActionTypes.UPDATE, // Context is updated with a new agent
                            metadata: { context: savedContext, addedAgentId: agentId }
                        };
                        const contextUpdatePayload = createChannelEventPayload(
                            Events.Channel.CONTEXT.UPDATED,
                            agentId, // Agent causing this context update
                            channelId,
                            contextUpdateEventData
                        );
                        EventBus.server.emit(Events.Channel.CONTEXT.UPDATED, contextUpdatePayload);
                        
                        // Emit specific agent joined event
                        const agentJoinedEventData: ChannelEventData = {
                            action: ChannelActionTypes.JOIN, // Agent performed a JOIN action resulting in this
                            targetAgentId: agentId // Specific agent that joined
                        };
                        const agentJoinedPayload = createChannelEventPayload(
                            Events.Channel.AGENT_JOINED,
                            agentId, // The agent who joined is the primary agent for this event
                            channelId,
                            agentJoinedEventData
                        );
                        EventBus.server.emit(Events.Channel.AGENT_JOINED, agentJoinedPayload);
                    })
                );
            })
        );
    };
    
    /**
     * Remove an agent from a channel
     * @param channelId - Channel ID
     * @param agentId - Agent ID to remove
     */
    public removeAgentFromChannel = (
        channelId: ChannelId,
        agentId: AgentId
    ): Observable<ChannelContextType> => {
        
        // Validate inputs
        if (!channelId) return throwError(() => new Error('Channel ID is required'));
        if (!agentId) return throwError(() => new Error('Agent ID is required'));
        
        return this.getContext(channelId).pipe(
            mergeMap(existingContext => {
                if (!existingContext) {
                    return throwError(() => new Error(`Channel context not found for ID: ${channelId} during removeAgentFromChannel`));
                }

                // Check if agent is a participant
                if (!existingContext.participants.includes(agentId)) {
        this.logger.warn(`Agent ${agentId} is not a participant in channel ${channelId}`);
                    return of(existingContext); // Return existing context if agent not present
                }
                
                const timestamp = Date.now();
                
                // Remove agent from participants list
                const updatedParticipants = existingContext.participants.filter(p => p !== agentId);
                
                const updatedContext: ChannelContextType = {
                    ...existingContext,
                    participants: updatedParticipants,
                    updatedAt: timestamp,
                    lastActivity: timestamp
                };
                
                // Create history entry
                const historyEntry: ChannelContextHistoryEntry = {
                    timestamp,
                    type: 'leave',
                    data: { agentId },
                    agentId // Agent performing the action (or system if self-leave not directly by agent)
                };
                
                // Save updated context
                return this.saveContextToMemory(channelId, updatedContext, historyEntry).pipe(
                    tap(savedContext => {
                        // Emit context update event
                        const contextUpdateEventData: ChannelEventData = {
                            action: ChannelActionTypes.UPDATE, // Context is updated due to agent removal
                            metadata: { context: savedContext, removedAgentId: agentId }
                        };
                        const contextUpdatePayload = createChannelEventPayload(
                            Events.Channel.CONTEXT.UPDATED,
                            agentId, // Agent causing this context update (or a system/channel agent)
                            channelId,
                            contextUpdateEventData
                        );
                        EventBus.server.emit(Events.Channel.CONTEXT.UPDATED, contextUpdatePayload);
                        
                        // Emit specific agent left event
                        const agentLeftEventData: ChannelEventData = {
                            action: ChannelActionTypes.LEAVE, // Agent performed a LEAVE action (or was removed)
                            targetAgentId: agentId // Specific agent that left
                        };
                        const agentLeftPayload = createChannelEventPayload(
                            Events.Channel.AGENT_LEFT,
                            agentId, // The agent who left is the primary agent for this event
                            channelId,
                            agentLeftEventData
                        );
                        EventBus.server.emit(Events.Channel.AGENT_LEFT, agentLeftPayload);
                    })
                );
            })
        );
    };
    
    /**
     * Set channel metadata
     * @param channelId - Channel ID
     * @param key - Metadata key
     * @param value - Metadata value
     * @param agentId - Agent setting the metadata
     */
    public setMetadata = (
        channelId: ChannelId,
        key: string,
        value: any,
        agentId: AgentId
    ): Observable<ChannelContextType> => {
        
        // Validate inputs
        if (!channelId) return throwError(() => new Error('Channel ID is required'));
        if (!key) return throwError(() => new Error('Metadata key is required'));
        if (!agentId) return throwError(() => new Error('Agent ID is required'));
        
        return this.getContext(channelId).pipe(
            mergeMap(existingContext => {
                if (!existingContext) {
                    return throwError(() => new Error(`Channel context not found for ID: ${channelId} during setMetadata`));
                }

                const timestamp = Date.now();
                
                // Update metadata
                const updatedMetadata = { ...existingContext.metadata, [key]: value };
                
                const updatedContext: ChannelContextType = {
                    ...existingContext,
                    metadata: updatedMetadata,
                    updatedAt: timestamp,
                    lastActivity: timestamp
                };
                
                // Create history entry (optional, could be argued metadata changes don't need full history entry like joins/leaves)
                // For consistency, let's add one if we decide all state changes should be in history
                const historyEntry: ChannelContextHistoryEntry = {
                    timestamp,
                    type: 'update', // Generic update type for metadata change
                    data: { metadataUpdate: { key, value } },
                    agentId
                };
                
                // Save updated context
                return this.saveContextToMemory(channelId, updatedContext, historyEntry).pipe(
                    tap(savedContext => {
                        // Emit context change event
                        const eventData: ChannelEventData = {
                            action: ChannelActionTypes.UPDATE,
                            metadata: { context: savedContext, updatedMetadataKey: key }
                        };
                        const payload = createChannelEventPayload(
                            Events.Channel.CONTEXT.UPDATED,
                            agentId,
                            channelId,
                            eventData
                        );
                        EventBus.server.emit(Events.Channel.CONTEXT.UPDATED, payload);
                    })
                );
            })
        );
    };
    
    /**
     * Get channel metadata
     * @param channelId - Channel ID
     * @param key - Metadata key (optional, if not provided returns all metadata)
     */
    public getMetadata = (
        channelId: ChannelId,
        key?: string
    ): Observable<Record<string, any> | any> => {
        
        return this.getContext(channelId).pipe(
            map(context => { // context here is ChannelContextType | null
                if (context) {
                    // Context is guaranteed to be ChannelContextType here
                    if (key) {
                        // If a specific key is requested
                        if (context.metadata && Object.prototype.hasOwnProperty.call(context.metadata, key)) {
                            return context.metadata[key]; // Should now be safe
                        }
        this.logger.warn(`Metadata key ${key} not found for channel ${channelId}`);
                        return undefined; // Key not found in metadata
                    }
                    // If no key is requested, return all metadata
                    return context.metadata; // Should now be safe
                } else {
                    // Context is null here
                    if (key) {
        this.logger.warn(`Metadata key ${key} not found for channel ${channelId} as context is null.`);
                        return undefined; 
                    }
        this.logger.warn(`Context not found for channel ${channelId} when getting all metadata.`);
                    return {}; // Return empty object if no context and no specific key.
                }
            }),
            catchError(err => {
        this.logger.error(`Error getting metadata for channel ${channelId}: ${err instanceof Error ? err.message : String(err)}`);
                return throwError(() => new Error(`Error getting metadata: ${err instanceof Error ? err.message : String(err)}`));
            })
        );
    };
    
    /**
     * Get channel context history
     * @param channelId - Channel ID
     * @param limit - Maximum number of history entries
     */
    public getContextHistory = (
        channelId: ChannelId,
        limit?: number
    ): Observable<ChannelContextHistoryEntry[]> => {
        return this.memoryOps.getContextHistory(channelId, limit);
    };
    
    /**
     * Delete a channel context
     * @param channelId - Channel ID
     */
    public deleteContext = (channelId: ChannelId): Observable<boolean> => {
        
        // Validate input
        if (!channelId) return throwError(() => new Error('Channel ID is required'));
        
        // Remove from cache
        this.contextCache.delete(channelId);
        
        // Emit memory delete event
        const systemAgentIdForDelete: AgentId = 'system-service' as AgentId; // Or a more appropriate system ID

        const memoryDeleteData: MemoryDeleteEventData = {
            operationId: uuidv4(),
            scope: MemoryScope.CHANNEL, // Corrected from CHANNEL_CONTEXT
            id: channelId, // Corrected: 'id' is the property, not 'ids', and channelId is a string
        };
        
        const memoryDeletePayload = createMemoryDeleteEventPayload(
            Events.Memory.DELETE,    // Corrected from DELETED
            systemAgentIdForDelete, 
            channelId,             
            memoryDeleteData
        );
        EventBus.server.emit(Events.Memory.DELETE, memoryDeletePayload);
        
        // Notify that channel context has been 'updated' to a deleted state
        const channelContextDeletedEventData: ChannelEventData = {
            action: ChannelActionTypes.DELETE, // Signifies the nature of the 'update'
            metadata: { message: `Context for channel ${channelId} has been removed.` }
        };
        const channelContextDeletedPayload = createChannelEventPayload(
            Events.Channel.CONTEXT.UPDATED, // Using CONTEXT.UPDATED to signify change in context state
            systemAgentIdForDelete,       // Agent performing/reporting the deletion
            channelId,                    // The channelId whose context was affected
            channelContextDeletedEventData
        );
        EventBus.server.emit(Events.Channel.CONTEXT.UPDATED, channelContextDeletedPayload); // Emit CONTEXT.UPDATED
        
        return of(true); // Deletion is signaled by event, return true for observable completion
    };
    
    /**
     * Add a message to the channel conversation history
     * @param channelId - Channel ID
     * @param message - Channel message
     */
    public addMessage = (
        channelId: ChannelId,
        message: ChannelMessage
    ): Observable<boolean> => {
        return this.messageOps.addMessage(channelId, message);
    };
    
    /**
     * Get recent channel messages with validation
     * @param channelId - Channel ID
     * @param limit - Maximum number of messages
     */
    public getMessages = (
        channelId: ChannelId,
        limit?: number
    ): Observable<ChannelMessage[]> => {
        return this.messageOps.getMessages(channelId, limit);
    };
    
    /**
     * Extract conversation topics using SystemLlmService
     * @param channelId - Channel ID
     * @param minRelevance - Minimum relevance score (0.0 to 1.0)
     */
    public extractConversationTopics = (
        channelId: ChannelId,
        minRelevance: number = 0.5
    ): Observable<ConversationTopic[]> => {
        // Get messages for the channel and extract topics using SystemLlmService
        return this.getMessages(channelId).pipe(
            mergeMap(messages => {
                if (messages.length === 0) {
                    return of([]);
                }
                
                // Get per-channel SystemLlmService instance
                const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
                if (!systemLlmService) {
                    return of([]);
                }
                
                // Use SystemLlmService to extract topics directly from ChannelMessage[]
                return systemLlmService.extractTopics(messages, { minRelevance });
            })
        );
    };
    
    /**
     * Generate a conversation summary for the channel using SystemLlmService
     * @param channelId - Channel ID
     * @param messageCount - Number of recent messages to include in summary
     */
    public generateConversationSummary = (
        channelId: ChannelId,
        messageCount: number = 50
    ): Observable<string> => {
        return this.getContext(channelId).pipe(
            mergeMap(context => {
                if (!context) {
                    // Fallback: Auto-create a basic channel context if none exists
                    // This ensures summary generation works even for dynamically created channels
                    this.logger.warn(`No context found for channel ${channelId}, creating default context for summary generation`);
                    
                    const defaultContext: ChannelContextType = {
                        id: channelId,
                        channelId: channelId,
                        name: channelId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), // Convert hyphenated to title case
                        description: `Auto-generated context for channel ${channelId}`,
                        createdAt: Date.now(),
                        createdBy: 'system', // Default creator
                        lastActivity: Date.now(),
                        participants: [],
                        metadata: {},
                        status: 'active' as const,
                        messageCount: 0,
                        updatedAt: Date.now()
                    };
                    
                    // Save the default context to memory and cache, then generate summary
                    return this.saveContextToMemory(channelId, defaultContext).pipe(
                        mergeMap(() => {
                            return this.generateSummaryFromMessages(channelId, defaultContext, messageCount);
                        })
                    );
                }
                return this.generateSummaryFromMessages(channelId, context, messageCount);
            })
        );
    };
    
    /**
     * Helper method to generate summary from messages using SystemLlmService
     */
    private generateSummaryFromMessages(
        channelId: ChannelId, 
        context: ChannelContextType, 
        messageCount: number
    ): Observable<string> {
        return this.getMessages(channelId, messageCount).pipe(
            mergeMap(messages => {
                if (messages.length === 0) {
                    return of('No messages to summarize');
                }
                
                // Get per-channel SystemLlmService instance
                const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
                if (!systemLlmService) {
                    return of('No SystemLLM available for summary generation');
                }
                
                // Use SystemLlmService to generate structured summary
                return systemLlmService.generateConversationSummary(messages, {
                    channelName: context.name,
                    channelDescription: context.description
                });
            }),
            map(result => {
                // Extract the summary string from ConversationSummaryResult
                return (result as any).summary || result.toString();
            })
        );
    }
    
    /**
     * Save context to memory system with proper validation and error handling
     * @param channelId - Channel ID
     * @param context - Channel context to save
     * @param historyEntry - Optional history entry to record with this update
     */
    public saveContextToMemory = (
        channelId: ChannelId,
        context: ChannelContextType,
        historyEntry?: ChannelContextHistoryEntry
    ): Observable<ChannelContextType> => {
        return this.memoryOps.saveContextToMemory(channelId, context, historyEntry).pipe(
            tap(savedContext => {
                if (savedContext) {
                }
                this.contextCache.set(channelId, savedContext);
            })
        );
    };
    
    /**
     * Get context from memory system with proper validation and error handling
     * @param channelId - Channel ID
     */
    public getContextFromMemory = (channelId: ChannelId): Observable<ChannelContextType | null> => {
        return this.memoryOps.getContextFromMemory(channelId).pipe(
            tap(context => {
                // Update cache only if context is not null
                if (context) {
                    this.contextCache.set(channelId, context);
                }
            })
        );
    };
    
    /**
     * Set up event listeners for context changes and memory system events
     */
    private setupEventListeners = (): void => {
        // Listen for context update events
        EventBus.server.on(Events.Channel.CONTEXT.UPDATED, (payload: ChannelEventPayload) => {
            
            // Extract context from the correct location in the payload
            const context = payload.data?.metadata?.context;
            
            if (context && payload.channelId) {
                // Update cache when context changes
                this.contextCache.set(payload.channelId, context);
            } else {
        this.logger.warn(`[Service] Invalid context update event - context: ${context ? 'exists' : 'missing'}, channelId: ${payload.channelId ? `"${payload.channelId}"` : 'missing'}`);
            }
        });
        
    };
}