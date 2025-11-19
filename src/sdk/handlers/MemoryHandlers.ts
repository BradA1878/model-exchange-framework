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
 * Handlers for Memory-related operations
 */

import { v4 as uuidv4 } from 'uuid';
import { MemoryEvents } from '../../shared/events/event-definitions/MemoryEvents';
import { EventBus } from '../../shared/events/EventBus';
import { Handler } from './Handler';
import { Subscription } from 'rxjs';
import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryScope
} from '../../shared/types/MemoryTypes';
import {
    BaseEventPayload,
    MemoryGetEventData,
    MemoryUpdateEventData,
    MemoryDeleteEventData,
    MemoryGetResultEventData,
    MemoryUpdateResultEventData,
    MemoryDeleteResultEventData,
    BaseMemoryOperationData,
    MemoryGetEventPayload,
    MemoryUpdateEventPayload,
    MemoryDeleteEventPayload
} from '../../shared/schemas/EventPayloadSchema';
import { IInternalChannelService } from '../services/MxfService'; 
import { createStrictValidator } from '../../shared/utils/validation'; 
import { Logger } from '../../shared/utils/Logger'; 

export class MemoryHandlers extends Handler {
    private agentId: string;
    private mxfService: IInternalChannelService;
    private agentMemory: IAgentMemory | null = null; 
    private channelId: string; 
    protected validator = createStrictValidator('MemoryHandlers'); 
    private requestTimeoutMs: number;

    constructor(
        channelId: string,
        agentId: string, 
        mxfService: IInternalChannelService, 
        requestTimeoutMs: number = 30000, 
    ) {
        super(`MemoryHandlers:${agentId}`); 
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string.');
        this.validator.assert(!!mxfService, 'MxfService instance is required.');
        this.validator.assert(requestTimeoutMs > 0, 'Request timeout must be greater than 0.');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string for MemoryHandlers.');

        this.agentId = agentId;
        this.mxfService = mxfService;
        this.requestTimeoutMs = requestTimeoutMs;
        this.channelId = channelId; 
    }

    public cleanup(): void {
        this.agentMemory = null; 
        // Any EventBus.client.once subscriptions are self-cleaning or managed by EventBus itself upon emit.
    }

    // Core private sender method using EventBus and MxfService.socketEmit
    private async sendMemoryRequestCore<TResponse>(
        eventType: string,
        payload: BaseEventPayload<BaseMemoryOperationData>,
        resultEventName: string,
        errorEventName: string
    ): Promise<TResponse | null> {
        if (!this.mxfService.isConnected()) {
            this.logger.warn(`[${this.agentId}] Cannot send memory request for event ${eventType}: MxfService is not connected.`);
            return null;
        }

        try {
            const operationId = payload.data.operationId;

            return await new Promise<TResponse | null>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    EventBus.client.off(resultEventName, resultHandler);
                    EventBus.client.off(errorEventName, errorHandler);
                    this.logger.warn(`[${this.agentId}] Memory operation ${eventType} for ${operationId} timed out after ${this.requestTimeoutMs}ms`);
                    reject(new Error(`Memory operation (${eventType}) timed out`));
                }, this.requestTimeoutMs);

                const resultHandler = (responsePayload: any) => {
                    if (responsePayload && responsePayload.data && responsePayload.data.operationId === operationId) {
                        clearTimeout(timeoutId);
                        EventBus.client.off(errorEventName, errorHandler);
                        resolve(responsePayload.data as TResponse); 
                    }
                };
                
                const errorHandler = (errorPayload: any) => {
                    if (errorPayload && errorPayload.data && errorPayload.data.operationId === operationId) {
                        clearTimeout(timeoutId);
                        EventBus.client.off(resultEventName, resultHandler);
                        this.logger.error(`[${this.agentId}] Received error for ${eventType} operation ${operationId}`, errorPayload.data?.error || 'Unknown error');
                        reject(new Error(errorPayload.data?.error || `Unknown memory operation error for ${eventType}`));
                    }
                };
                
                EventBus.client.once(resultEventName, resultHandler);
                EventBus.client.once(errorEventName, errorHandler);
                
                this.mxfService.socketEmit(eventType, payload); 
            });

        } catch (error: any) {
            this.logger.error(`[${this.agentId}] Error in sendMemoryRequestCore for ${eventType}: ${error.message}`, error);
            return null;
        }
    }

    /**
     * Get agent memory.
     * @returns Promise resolving to IAgentMemory or null.
     */
    public async getAgentMemory(): Promise<IAgentMemory | null> {
        const eventData: MemoryGetEventData = { 
            operationId: uuidv4(),
            scope: MemoryScope.AGENT,
            id: this.agentId, 
        };
        const payload: MemoryGetEventPayload = {
            eventId: uuidv4(),
            eventType: MemoryEvents.GET,
            agentId: this.agentId,
            timestamp: Date.now(),
            channelId: this.channelId, 
            data: eventData,
        };

        const retrievedMemory = await this.sendMemoryRequestCore<MemoryGetResultEventData>(
            MemoryEvents.GET, 
            payload, 
            MemoryEvents.GET_RESULT, 
            MemoryEvents.GET_ERROR
        );

        if (retrievedMemory && !retrievedMemory.error && retrievedMemory.memory) {
            this.agentMemory = retrievedMemory.memory as IAgentMemory; 
            return this.agentMemory;
        }
        if (retrievedMemory && retrievedMemory.error) {
            const errorMessage: string = retrievedMemory.error;
            this.logger.error(`Error in getAgentMemory: ${errorMessage}`);
        }
        return null;
    }
    
    /**
     * Update agent memory.
     * @param data Partial data to update agent memory.
     * @returns Promise resolving to IAgentMemory or null.
     */
    public async updateAgentMemory(data: Partial<IAgentMemory>): Promise<IAgentMemory | null> {
        const eventData: MemoryUpdateEventData = { 
            operationId: uuidv4(),
            scope: MemoryScope.AGENT,
            id: this.agentId, 
            data: data, 
        };
        const payload: MemoryUpdateEventPayload = {
            eventId: uuidv4(),
            eventType: MemoryEvents.UPDATE,
            agentId: this.agentId,
            timestamp: Date.now(),
            channelId: this.channelId, 
            data: eventData,
        };

        const updatedMemory = await this.sendMemoryRequestCore<MemoryUpdateResultEventData>(
            MemoryEvents.UPDATE, 
            payload, 
            MemoryEvents.UPDATE_RESULT, 
            MemoryEvents.UPDATE_ERROR
        );

        if (updatedMemory && !updatedMemory.error && updatedMemory.memory) {
            this.agentMemory = updatedMemory.memory as IAgentMemory; 
            return this.agentMemory;
        }
        if (updatedMemory && updatedMemory.error) {
            const errorMessage: string = updatedMemory.error;
            this.logger.error(`Error in updateAgentMemory: ${errorMessage}`);
        }
        return null;
    }

    /**
     * Delete agent memory.
     * @returns Promise resolving to true if successful, false otherwise.
     */
    public async deleteAgentMemory(): Promise<boolean> {
        const eventData: MemoryDeleteEventData = { 
            operationId: uuidv4(),
            scope: MemoryScope.AGENT,
            id: this.agentId, 
        };
        const payload: MemoryDeleteEventPayload = {
            eventId: uuidv4(),
            eventType: MemoryEvents.DELETE,
            agentId: this.agentId,
            timestamp: Date.now(),
            channelId: this.channelId,
            data: eventData,
        };

        const result = await this.sendMemoryRequestCore<MemoryDeleteResultEventData>(
            MemoryEvents.DELETE, 
            payload, 
            MemoryEvents.DELETE_RESULT, 
            MemoryEvents.DELETE_ERROR
        );

        if (result && result.success) {
            this.agentMemory = null; 
            return true;
        }
        if (result && result.error) {
            const errorMessage: string = result.error;
            this.logger.error(`Error in deleteAgentMemory: ${errorMessage}`);
        }
        return false;
    }
    
    /**
     * Add a note to agent memory. Assumes 'notes' is a Record<string, any> on IAgentMemory.
     * @param key Note key.
     * @param value Note value.
     * @returns Promise resolving to IAgentMemory or null.
     */
    public async addNote(key: string, value: any): Promise<IAgentMemory | null> {
        this.validator.assertIsNonEmptyString(key, 'Note key');
        
        // Fetch current notes, or initialize if not present, to merge safely.
        const currentNotes = this.agentMemory?.notes || {};
        const updatedNotesData = {
            notes: {
                ...currentNotes,
                [key]: value
            }
        };
        return await this.updateAgentMemory(updatedNotesData as Partial<IAgentMemory>); 
    }
    
    /**
     * Add conversation entry to agent memory. Assumes 'conversationHistory' is an array on IAgentMemory.
     * @param entry Conversation entry to add.
     * @returns Promise resolving to IAgentMemory or null.
     */
    public async addToConversationHistory(entry: any): Promise<IAgentMemory | null> {
        
        // Ensure agentMemory is loaded if not already
        if (!this.agentMemory) {
            await this.getAgentMemory(); 
        }
        
        const currentHistory = this.agentMemory?.conversationHistory || [];
        const updatedHistoryData = {
            conversationHistory: [...currentHistory, entry]
        };
        return await this.updateAgentMemory(updatedHistoryData as Partial<IAgentMemory>);
    }
    
    /**
     * Get channel memory for a specific channel.
     * @param channelId The channel ID to get memory for.
     * @returns Promise resolving to IChannelMemory or null.
     */
    public async getChannelMemory(channelId: string): Promise<IChannelMemory | null> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be provided for getChannelMemory.');
        const eventData: MemoryGetEventData = {
            operationId: uuidv4(),
            scope: MemoryScope.CHANNEL,
            id: channelId, 
        };
        const payload: MemoryGetEventPayload = {
            eventId: uuidv4(),
            eventType: MemoryEvents.GET,
            agentId: this.agentId, 
            timestamp: Date.now(),
            channelId: channelId,  
            data: eventData,
        };
        const resultEventData = await this.sendMemoryRequestCore<MemoryGetResultEventData>(
            MemoryEvents.GET, 
            payload, 
            MemoryEvents.GET_RESULT,
            MemoryEvents.GET_ERROR
        );

        if (resultEventData && !resultEventData.error && resultEventData.memory) {
            return resultEventData.memory as IChannelMemory;
        }
        if (resultEventData && resultEventData.error) {
            const errorMessage: string = resultEventData.error;
            this.logger.error(`Error in getChannelMemory for ${channelId}: ${errorMessage}`);
        }
        return null;
    }
    
    /**
     * Update channel memory with new data.
     * @param channelId The channel ID to update memory for.
     * @param data Memory fields to update.
     * @returns Promise resolving to IChannelMemory or null.
     */
    public async updateChannelMemory(channelId: string, data: Partial<IChannelMemory>): Promise<IChannelMemory | null> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be provided for updateChannelMemory.');
        const eventData: MemoryUpdateEventData = {
            operationId: uuidv4(),
            scope: MemoryScope.CHANNEL,
            id: channelId, 
            data: data,
        };
        const payload: MemoryUpdateEventPayload = {
            eventId: uuidv4(),
            eventType: MemoryEvents.UPDATE,
            agentId: this.agentId,
            timestamp: Date.now(),
            channelId: channelId,  
            data: eventData,
        };
        const resultEventData = await this.sendMemoryRequestCore<MemoryUpdateResultEventData>(
            MemoryEvents.UPDATE, 
            payload, 
            MemoryEvents.UPDATE_RESULT,
            MemoryEvents.UPDATE_ERROR
        );

        if (resultEventData && !resultEventData.error && resultEventData.memory) {
            return resultEventData.memory as IChannelMemory;
        }
        if (resultEventData && resultEventData.error) {
            const errorMessage: string = resultEventData.error;
            this.logger.error(`Error in updateChannelMemory for ${channelId}: ${errorMessage}`);
        }
        return null;
    }

    /**
     * Delete channel memory for a specific channel.
     * @param channelId The ID of the channel whose memory is to be deleted.
     * @returns Promise resolving to true if successful, false otherwise.
     */
    public async deleteChannelMemory(channelId: string): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be provided for deleteChannelMemory.');
        const eventData: MemoryDeleteEventData = {
            operationId: uuidv4(),
            scope: MemoryScope.CHANNEL,
            id: channelId, 
        };
        const payload: MemoryDeleteEventPayload = { 
            eventId: uuidv4(),
            eventType: MemoryEvents.DELETE,
            agentId: this.agentId,
            timestamp: Date.now(),
            channelId: channelId,  
            data: eventData,
        };
        const resultEventData = await this.sendMemoryRequestCore<MemoryDeleteResultEventData>(
            MemoryEvents.DELETE, 
            payload, 
            MemoryEvents.DELETE_RESULT,
            MemoryEvents.DELETE_ERROR
        );

        if (resultEventData && resultEventData.success) {
            return true;
        }
        if (resultEventData && resultEventData.error) {
            const errorMessage: string = resultEventData.error;
            this.logger.error(`Error in deleteChannelMemory for ${channelId}: ${errorMessage}`);
        }
        return false;
    }
    
    /**
     * Generate relationship ID as array format for proper handling
     */
    private generateRelationshipId(otherAgentId: string): string[] {
        this.validator.assertIsNonEmptyString(otherAgentId, 'otherAgentId for relationshipId');
        return [this.agentId, otherAgentId].sort();
    }

    /**
     * Get relationship memory between this agent and another agent.
     * @param otherAgentId The other agent ID for the relationship.
     * @param channelId Optional channel ID to scope the relationship to.
     * @returns Promise resolving to IRelationshipMemory or null.
     */
    public async getRelationshipMemory(otherAgentId: string, channelId?: string): Promise<IRelationshipMemory | null> {
        this.validator.assertIsNonEmptyString(otherAgentId, 'Other agent ID must be provided.');
        const relationshipId = this.generateRelationshipId(otherAgentId);
        if (channelId && typeof channelId !== 'string') {
            throw new Error('channelId must be a string if provided');
        }
        const targetChannelId = channelId || this.channelId; 

        const eventData: MemoryGetEventData = {
            operationId: uuidv4(),
            scope: MemoryScope.RELATIONSHIP,
            id: relationshipId, 
        };
        const payload: MemoryGetEventPayload = {
            eventId: uuidv4(),
            eventType: MemoryEvents.GET,
            agentId: this.agentId,
            timestamp: Date.now(),
            channelId: targetChannelId, 
            data: eventData,
        };
        const resultEventData = await this.sendMemoryRequestCore<MemoryGetResultEventData>(
            MemoryEvents.GET, 
            payload, 
            MemoryEvents.GET_RESULT,
            MemoryEvents.GET_ERROR
        );

        if (resultEventData && !resultEventData.error && resultEventData.memory) {
            return resultEventData.memory as IRelationshipMemory;
        }
        if (resultEventData && resultEventData.error) {
            const errorMessage: string = resultEventData.error;
            this.logger.error(`Error in getRelationshipMemory for ${relationshipId.join(':')}: ${errorMessage}`);
        }
        return null;
    }
    
    /**
     * Update relationship memory with new data.
     * @param otherAgentId The other agent ID for the relationship.
     * @param data Memory fields to update.
     * @param channelId Optional channel ID to scope the relationship to.
     * @returns Promise resolving to IRelationshipMemory or null.
     */
    public async updateRelationshipMemory(
        otherAgentId: string, 
        data: Partial<IRelationshipMemory>,
        channelId?: string
    ): Promise<IRelationshipMemory | null> {
        this.validator.assertIsNonEmptyString(otherAgentId, 'Other agent ID must be provided.');
        const relationshipId = this.generateRelationshipId(otherAgentId);
        if (channelId && typeof channelId !== 'string') {
            throw new Error('channelId must be a string if provided');
        }
        const targetChannelId = channelId || this.channelId;

        const eventData: MemoryUpdateEventData = {
            operationId: uuidv4(),
            scope: MemoryScope.RELATIONSHIP,
            id: relationshipId, 
            data: data,
        };
        const payload: MemoryUpdateEventPayload = {
            eventId: uuidv4(),
            eventType: MemoryEvents.UPDATE,
            agentId: this.agentId,
            timestamp: Date.now(),
            channelId: targetChannelId, 
            data: eventData,
        };
        const resultEventData = await this.sendMemoryRequestCore<MemoryUpdateResultEventData>(
            MemoryEvents.UPDATE, 
            payload, 
            MemoryEvents.UPDATE_RESULT,
            MemoryEvents.UPDATE_ERROR
        );

        if (resultEventData && !resultEventData.error && resultEventData.memory) {
            return resultEventData.memory as IRelationshipMemory;
        }
        if (resultEventData && resultEventData.error) {
            const errorMessage: string = resultEventData.error;
            this.logger.error(`Error in updateRelationshipMemory for ${relationshipId.join(':')}: ${errorMessage}`);
        }
        return null;
    }

    /**
     * Deletes relationship memory between this agent and another agent.
     * @param otherAgentId The other agent ID for the relationship.
     * @param channelId Optional channel ID to scope the relationship to.
     * @returns Promise resolving to true if successful, false otherwise.
     */
    public async deleteRelationshipMemory(otherAgentId: string, channelId?: string): Promise<boolean> {
        this.validator.assertIsNonEmptyString(otherAgentId, 'Other agent ID must be provided.');
        const relationshipId = this.generateRelationshipId(otherAgentId);
        if (channelId && typeof channelId !== 'string') {
            throw new Error('channelId must be a string if provided');
        }
        const targetChannelId = channelId || this.channelId;

        const eventData: MemoryDeleteEventData = { 
            operationId: uuidv4(),
            scope: MemoryScope.RELATIONSHIP,
            id: relationshipId, 
        };
        const payload: MemoryDeleteEventPayload = { 
            eventId: uuidv4(),
            eventType: MemoryEvents.DELETE,
            agentId: this.agentId,
            timestamp: Date.now(),
            channelId: targetChannelId, 
            data: eventData,
        };
        const resultEventData = await this.sendMemoryRequestCore<MemoryDeleteResultEventData>(
            MemoryEvents.DELETE, 
            payload, 
            MemoryEvents.DELETE_RESULT,
            MemoryEvents.DELETE_ERROR
        );

        if (resultEventData && resultEventData.success) {
            return true;
        }
        if (resultEventData && resultEventData.error) {
            const errorMessage: string = resultEventData.error;
            this.logger.error(`Error in deleteRelationshipMemory for ${relationshipId.join(':')}: ${errorMessage}`);
        }
        return false;
    }
}