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

// Memory Service for the SDK

import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import { createMemoryGetEventPayload, createMemoryUpdateEventPayload, createMemoryDeleteEventPayload } from '../../shared/schemas/EventPayloadSchema';
import { createStrictValidator } from '../../shared/utils/validation';
import { Logger } from '../../shared/utils/Logger';

import { 
    MemoryScope, 
    IAgentMemory, 
    IChannelMemory, 
    IRelationshipMemory,
    MemoryData
} from '../../shared/types/MemoryTypes';

/**
 * Memory Service for the SDK
 * Pure client proxy for the unified Memory System
 */
export class MxfMemoryService {
    // Validator
    private validator = createStrictValidator('MxfMemoryService');
    
    // Logger
    private logger = new Logger('debug', 'MxfMemoryService', 'client');
    
    // Singleton instance
    private static instance: MxfMemoryService;
    
    /**
     * Create a new Memory Service instance
     */
    private constructor() {
    }
    
    /**
     * Get the singleton instance
     * @returns The memory service instance
     */
    public static getInstance(): MxfMemoryService {
        if (!MxfMemoryService.instance) {
            MxfMemoryService.instance = new MxfMemoryService();
        }
        return MxfMemoryService.instance;
    }
    
    /**
     * Generate a unique operation ID
     * @returns Unique operation ID
     */
    private generateOperationId = (): string => {
        return uuidv4();
    };
    
    /**
     * Get agent memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param targetAgentId Target Agent ID
     * @returns Observable of agent memory
     */
    public getAgentMemory = (callerAgentId: string, callerChannelId: string, targetAgentId: string): Observable<IAgentMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(targetAgentId, 'Target Agent ID must be a non-empty string');
        
        // Create operation ID for tracking
        const operationId = this.generateOperationId();
        
        // Create an observable that emits when we receive a response
        return new Observable<IAgentMemory>((observer) => {
            // Listen for the response with this operation ID
            const handler = (event: any) => {
                if (event && event.data && event.data.operationId === operationId) {
                    // Clean up the listener
                    EventBus.client.off(Events.Memory.GET_RESULT, handler);
                    
                    if (event.error) {
                        observer.error(new Error(event.error));
                    } else if (event.data.memory) {
                        observer.next(event.data.memory as IAgentMemory);
                        observer.complete();
                    } else {
                        observer.error(new Error('Invalid response from server'));
                    }
                }
            };
            
            // Register the event handler
            EventBus.client.on(Events.Memory.GET_RESULT, handler);
            
            // Send the get request using standardized payload creator
            EventBus.client.emitOn(callerAgentId,
                Events.Memory.GET,
                createMemoryGetEventPayload(Events.Memory.GET, callerAgentId, callerChannelId, { operationId, scope: MemoryScope.AGENT, id: targetAgentId })
            );
            
            // Return cleanup function
            return () => {
                EventBus.client.off(Events.Memory.GET_RESULT, handler);
            };
        });
    };

    /**
     * Get channel memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param targetChannelId Target Channel ID
     * @returns Observable of channel memory
     */
    public getChannelMemory = (callerAgentId: string, callerChannelId: string, targetChannelId: string): Observable<IChannelMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(targetChannelId, 'Target Channel ID must be a non-empty string');
        
        // Create operation ID for tracking
        const operationId = this.generateOperationId();
        
        // Create an observable that emits when we receive a response
        return new Observable<IChannelMemory>((observer) => {
            // Listen for the response with this operation ID
            const handler = (event: any) => {
                if (event && event.data && event.data.operationId === operationId) {
                    // Clean up the listener
                    EventBus.client.off(Events.Memory.GET_RESULT, handler);
                    
                    if (event.error) {
                        observer.error(new Error(event.error));
                    } else if (event.data.memory) {
                        observer.next(event.data.memory as IChannelMemory);
                        observer.complete();
                    } else {
                        observer.error(new Error('Invalid response from server'));
                    }
                }
            };
            
            // Register the event handler
            EventBus.client.on(Events.Memory.GET_RESULT, handler);
            
            // Send the get request using standardized payload creator
            EventBus.client.emitOn(callerAgentId,
                Events.Memory.GET,
                createMemoryGetEventPayload(Events.Memory.GET, callerAgentId, callerChannelId, { operationId, scope: MemoryScope.CHANNEL, id: targetChannelId })
            );
            
            // Return cleanup function
            return () => {
                EventBus.client.off(Events.Memory.GET_RESULT, handler);
            };
        });
    };

    /**
     * Get relationship memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param agentId1 First agent ID
     * @param agentId2 Second agent ID
     * @param channelId Channel ID (optional for global relationships)
     * @returns Observable of relationship memory
     */
    public getRelationshipMemory = (callerAgentId: string, callerChannelId: string, agentId1: string, agentId2: string, channelId?: string): Observable<IRelationshipMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(agentId1, 'First Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(agentId2, 'Second Agent ID must be a non-empty string');
        
        // Create operation ID for tracking
        const operationId = this.generateOperationId();
        
        // Create an observable that emits when we receive a response
        return new Observable<IRelationshipMemory>((observer) => {
            // Listen for the response with this operation ID
            const handler = (event: any) => {
                if (event && event.data && event.data.operationId === operationId) {
                    // Clean up the listener
                    EventBus.client.off(Events.Memory.GET_RESULT, handler);
                    
                    if (event.error) {
                        observer.error(new Error(event.error));
                    } else if (event.data.memory) {
                        observer.next(event.data.memory as IRelationshipMemory);
                        observer.complete();
                    } else {
                        observer.error(new Error('Invalid response from server'));
                    }
                }
            };
            
            // Register the event handler
            EventBus.client.on(Events.Memory.GET_RESULT, handler);
            
            // Prepare ID array for relationship memory
            const relationshipPayloadId = channelId ? [agentId1, agentId2, channelId] : [agentId1, agentId2];
            
            // Send the get request using standardized payload creator
            EventBus.client.emitOn(callerAgentId,
                Events.Memory.GET,
                createMemoryGetEventPayload(Events.Memory.GET, callerAgentId, callerChannelId, { operationId, scope: MemoryScope.RELATIONSHIP, id: relationshipPayloadId })
            );
            
            // Return cleanup function
            return () => {
                EventBus.client.off(Events.Memory.GET_RESULT, handler);
            };
        });
    };

    /**
     * Update agent memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param targetAgentId Target Agent ID
     * @param memoryData Memory data to update
     * @returns Observable of updated agent memory
     */
    public updateAgentMemory = (callerAgentId: string, callerChannelId: string, targetAgentId: string, memoryData: MemoryData): Observable<IAgentMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(targetAgentId, 'Target Agent ID must be a non-empty string');
        this.validator.assertIsObject(memoryData, 'Memory data must be an object');

        // Create operation ID for tracking
        const operationId = this.generateOperationId();
        
        // Create an observable that emits when we receive a response
        return new Observable<IAgentMemory>((observer) => {
            // Listen for the response with this operation ID
            const handler = (event: any) => {
                if (event && event.data && event.data.operationId === operationId) {
                    // Clean up the listener
                    EventBus.client.off(Events.Memory.UPDATE_RESULT, handler);
                    
                    if (event.error) {
                        observer.error(new Error(event.error));
                    } else if (event.data.memory) {
                        observer.next(event.data.memory as IAgentMemory);
                        observer.complete();
                    } else {
                        observer.error(new Error('Invalid response from server'));
                    }
                }
            };
            
            // Register the event handler
            EventBus.client.on(Events.Memory.UPDATE_RESULT, handler);
            
            // Send the update request using standardized payload creator
            EventBus.client.emitOn(callerAgentId,
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(Events.Memory.UPDATE, callerAgentId, callerChannelId, { operationId, scope: MemoryScope.AGENT, id: targetAgentId, data: memoryData })
            );
            
            // Return cleanup function
            return () => {
                EventBus.client.off(Events.Memory.UPDATE_RESULT, handler);
            };
        });
    };

    /**
     * Update channel memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param targetChannelId Target Channel ID
     * @param memoryData Memory data to update
     * @returns Observable of updated channel memory
     */
    public updateChannelMemory = (callerAgentId: string, callerChannelId: string, targetChannelId: string, memoryData: MemoryData): Observable<IChannelMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(targetChannelId, 'Target Channel ID must be a non-empty string');
        this.validator.assertIsObject(memoryData, 'Memory data must be an object');

        // Create operation ID for tracking
        const operationId = this.generateOperationId();
        
        // Create an observable that emits when we receive a response
        return new Observable<IChannelMemory>((observer) => {
            // Listen for the response with this operation ID
            const handler = (event: any) => {
                if (event && event.data && event.data.operationId === operationId) {
                    // Clean up the listener
                    EventBus.client.off(Events.Memory.UPDATE_RESULT, handler);
                    
                    if (event.error) {
                        observer.error(new Error(event.error));
                    } else if (event.data.memory) {
                        observer.next(event.data.memory as IChannelMemory);
                        observer.complete();
                    } else {
                        observer.error(new Error('Invalid response from server'));
                    }
                }
            };
            
            // Register the event handler
            EventBus.client.on(Events.Memory.UPDATE_RESULT, handler);
            
            // Send the update request using standardized payload creator
            EventBus.client.emitOn(callerAgentId,
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(Events.Memory.UPDATE, callerAgentId, callerChannelId, { operationId, scope: MemoryScope.CHANNEL, id: targetChannelId, data: memoryData })
            );
            
            // Return cleanup function
            return () => {
                EventBus.client.off(Events.Memory.UPDATE_RESULT, handler);
            };
        });
    };

    /**
     * Update relationship memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param r_agentId1 First agent ID
     * @param r_agentId2 Second agent ID
     * @param memoryData Memory data to update
     * @param r_channelId Channel ID (optional for global relationships)
     * @returns Observable of updated relationship memory
     */
    public updateRelationshipMemory = (callerAgentId: string, callerChannelId: string, r_agentId1: string, r_agentId2: string, memoryData: MemoryData, r_channelId?: string): Observable<IRelationshipMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(r_agentId1, 'First Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(r_agentId2, 'Second Agent ID must be a non-empty string');
        this.validator.assertIsObject(memoryData, 'Memory data must be an object');

        // Create operation ID for tracking
        const operationId = this.generateOperationId();
        
        // Create an observable that emits when we receive a response
        return new Observable<IRelationshipMemory>((observer) => {
            // Listen for the response with this operation ID
            const handler = (event: any) => {
                if (event && event.data && event.data.operationId === operationId) {
                    // Clean up the listener
                    EventBus.client.off(Events.Memory.UPDATE_RESULT, handler);
                    
                    if (event.error) {
                        observer.error(new Error(event.error));
                    } else if (event.data.memory) {
                        observer.next(event.data.memory as IRelationshipMemory);
                        observer.complete();
                    } else {
                        observer.error(new Error('Invalid response from server'));
                    }
                }
            };
            
            // Register the event handler
            EventBus.client.on(Events.Memory.UPDATE_RESULT, handler);
            
            // Prepare ID array for relationship memory
            const relationshipPayloadId = r_channelId ? [r_agentId1, r_agentId2, r_channelId] : [r_agentId1, r_agentId2];
            
            // Send the update request using standardized payload creator
            EventBus.client.emitOn(callerAgentId,
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(Events.Memory.UPDATE, callerAgentId, callerChannelId, { operationId, scope: MemoryScope.RELATIONSHIP, id: relationshipPayloadId, data: memoryData })
            );
            
            // Return cleanup function
            return () => {
                EventBus.client.off(Events.Memory.UPDATE_RESULT, handler);
            };
        });
    };
    
    /**
     * Delete memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param scope Memory scope
     * @param idToDelete ID or ID array to delete
     * @returns Observable of success status
     */
    public deleteMemory = (callerAgentId: string, callerChannelId: string, scope: MemoryScope, idToDelete: string | string[]): Observable<boolean> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        // Validate memory scope - we can't use validateMemoryScope directly
        this.validator.assertIsString(scope, `Memory scope must be a string`);
        if (!Object.values(MemoryScope).includes(scope as MemoryScope)) {
            throw new Error(`Invalid memory scope: ${scope}`);
        }
        // Validate idToDelete based on scope
        if (scope === MemoryScope.AGENT || scope === MemoryScope.CHANNEL) {
            this.validator.assertIsNonEmptyString(idToDelete as string, 'ID for agent/channel memory must be a non-empty string');
        } else if (scope === MemoryScope.RELATIONSHIP) {
            this.validator.assertIsArray(idToDelete, 'ID for relationship memory must be an array');
            // Further validation for array elements if needed
        }

        // Create operation ID for tracking
        const operationId = this.generateOperationId();
        
        // Create an observable that emits when we receive a response
        return new Observable<boolean>((observer) => {
            // Listen for the response with this operation ID
            const handler = (event: any) => {
                if (event && event.data && event.data.operationId === operationId) {
                    // Clean up the listener
                    EventBus.client.off(Events.Memory.DELETE_RESULT, handler);
                    
                    if (event.error) {
                        observer.error(new Error(event.error));
                    } else {
                        observer.next(event.success === true);
                        observer.complete();
                    }
                }
            };
            
            // Register the event handler
            EventBus.client.on(Events.Memory.DELETE_RESULT, handler);
            
            // Send the delete request using standardized payload creator
            EventBus.client.emitOn(callerAgentId,
                Events.Memory.DELETE,
                createMemoryDeleteEventPayload(Events.Memory.DELETE, callerAgentId, callerChannelId, { operationId, scope, id: idToDelete })
            );
            
            // Return cleanup function
            return () => {
                EventBus.client.off(Events.Memory.DELETE_RESULT, handler);
            };
        });
    };
}
