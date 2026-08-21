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
 * Handlers for Memory-related operations
 */

import { Observable, Subscription } from 'rxjs';
import { Handler } from './Handler.js';
import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryScope
} from '@mxf-dev/core/types/MemoryTypes';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { MxfMemoryService } from '../services/MxfMemoryService.js';

export class MemoryHandlers extends Handler {
    private agentId: string;
    private agentMemory: IAgentMemory | null = null;
    private channelId: string;
    private memoryService: MxfMemoryService;
    private pendingRequestCancellations = new Map<symbol, () => void>();
    protected validator = createStrictValidator('MemoryHandlers');

    constructor(
        channelId: string,
        agentId: string
    ) {
        super(`MemoryHandlers:${agentId}`);
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string.');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string for MemoryHandlers.');

        this.agentId = agentId;
        this.channelId = channelId;
        this.memoryService = MxfMemoryService.getInstance();
    }

    public cleanup(): void {
        this.agentMemory = null;
        [...this.pendingRequestCancellations.values()].forEach(cancel => cancel());
    }

    private assertAuthenticatedChannel(channelId: string): void {
        if (channelId !== this.channelId) {
            throw new Error(
                `Memory channel '${channelId}' does not match authenticated channel '${this.channelId}'`
            );
        }
    }

    private awaitOperation<T>(operation: Observable<T>, description: string): Promise<T> {
        const requestId = Symbol(description);
        const subscription = new Subscription();

        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const finish = (): boolean => {
                if (settled) {
                    return false;
                }
                settled = true;
                this.pendingRequestCancellations.delete(requestId);
                subscription.unsubscribe();
                return true;
            };
            const rejectRequest = (error: unknown): void => {
                if (finish()) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            };

            this.pendingRequestCancellations.set(requestId, () => rejectRequest(
                new Error(`${description} cancelled because the memory handler was cleaned up`)
            ));
            subscription.add(operation.subscribe({
                next: result => {
                    if (finish()) {
                        resolve(result);
                    }
                },
                error: rejectRequest,
                complete: () => rejectRequest(new Error(`${description} completed without a result`))
            }));
        });
    }

    /**
     * Get agent memory.
     * @returns Promise resolving to the authoritative agent memory.
     */
    public async getAgentMemory(): Promise<IAgentMemory> {
        const retrievedMemory = await this.awaitOperation(
            this.memoryService.getAgentMemory(this.agentId, this.channelId),
            'Get agent memory'
        );
        this.agentMemory = retrievedMemory;
        return retrievedMemory;
    }
    
    /**
     * Update agent memory.
     * @param data Partial data to update agent memory.
     * @returns Promise resolving to the authoritative updated agent memory.
     */
    public async updateAgentMemory(data: Partial<IAgentMemory>): Promise<IAgentMemory> {
        const updatedMemory = await this.awaitOperation(
            this.memoryService.updateAgentMemory(this.agentId, this.channelId, data),
            'Update agent memory'
        );
        this.agentMemory = updatedMemory;
        return updatedMemory;
    }

    /**
     * Delete agent memory.
     * @returns Promise resolving to true when deletion is confirmed.
     */
    public async deleteAgentMemory(): Promise<boolean> {
        await this.awaitOperation(
            this.memoryService.deleteMemory(
                this.agentId,
                this.channelId,
                MemoryScope.AGENT,
                this.agentId
            ),
            'Delete agent memory'
        );
        this.agentMemory = null;
        return true;
    }
    
    /**
     * Add a note to agent memory. Assumes 'notes' is a Record<string, any> on IAgentMemory.
     * @param key Note key.
     * @param value Note value.
     * @returns Promise resolving to the authoritative updated agent memory.
     */
    public async addNote(key: string, value: unknown): Promise<IAgentMemory> {
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
     * @returns Promise resolving to the authoritative updated agent memory.
     */
    public async addToConversationHistory(entry: unknown): Promise<IAgentMemory> {
        
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
     * @returns Promise resolving to the authoritative channel memory.
     */
    public async getChannelMemory(channelId: string): Promise<IChannelMemory> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be provided for getChannelMemory.');
        this.assertAuthenticatedChannel(channelId);
        return this.awaitOperation(
            this.memoryService.getChannelMemory(this.agentId, this.channelId, channelId),
            `Get channel memory '${channelId}'`
        );
    }
    
    /**
     * Update channel memory with new data.
     * @param channelId The channel ID to update memory for.
     * @param data Memory fields to update.
     * @returns Promise resolving to the authoritative updated channel memory.
     */
    public async updateChannelMemory(
        channelId: string,
        data: Partial<IChannelMemory>
    ): Promise<IChannelMemory> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be provided for updateChannelMemory.');
        this.assertAuthenticatedChannel(channelId);
        return this.awaitOperation(
            this.memoryService.updateChannelMemory(
                this.agentId,
                this.channelId,
                channelId,
                data
            ),
            `Update channel memory '${channelId}'`
        );
    }

    /**
     * Delete channel memory for a specific channel.
     * @param channelId The ID of the channel whose memory is to be deleted.
     * @returns Promise resolving to true when deletion is confirmed.
     */
    public async deleteChannelMemory(channelId: string): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be provided for deleteChannelMemory.');
        this.assertAuthenticatedChannel(channelId);
        await this.awaitOperation(
            this.memoryService.deleteMemory(
                this.agentId,
                this.channelId,
                MemoryScope.CHANNEL,
                channelId
            ),
            `Delete channel memory '${channelId}'`
        );
        return true;
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
     * @returns Promise resolving to the authoritative relationship memory.
     */
    public async getRelationshipMemory(
        otherAgentId: string,
        channelId?: string
    ): Promise<IRelationshipMemory> {
        this.validator.assertIsNonEmptyString(otherAgentId, 'Other agent ID must be provided.');
        if (channelId !== undefined) {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID must not be empty.');
        }
        const targetChannelId = channelId ?? this.channelId;
        this.assertAuthenticatedChannel(targetChannelId);
        return this.awaitOperation(
            this.memoryService.getRelationshipMemory(
                this.agentId,
                this.channelId,
                this.agentId,
                otherAgentId,
                targetChannelId
            ),
            `Get relationship memory with '${otherAgentId}'`
        );
    }
    
    /**
     * Update relationship memory with new data.
     * @param otherAgentId The other agent ID for the relationship.
     * @param data Memory fields to update.
     * @param channelId Optional channel ID to scope the relationship to.
     * @returns Promise resolving to the authoritative updated relationship memory.
     */
    public async updateRelationshipMemory(
        otherAgentId: string, 
        data: Partial<IRelationshipMemory>,
        channelId?: string
    ): Promise<IRelationshipMemory> {
        this.validator.assertIsNonEmptyString(otherAgentId, 'Other agent ID must be provided.');
        if (channelId !== undefined) {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID must not be empty.');
        }
        const targetChannelId = channelId ?? this.channelId;
        this.assertAuthenticatedChannel(targetChannelId);
        return this.awaitOperation(
            this.memoryService.updateRelationshipMemory(
                this.agentId,
                this.channelId,
                this.agentId,
                otherAgentId,
                data,
                targetChannelId
            ),
            `Update relationship memory with '${otherAgentId}'`
        );
    }

    /**
     * Deletes relationship memory between this agent and another agent.
     * @param otherAgentId The other agent ID for the relationship.
     * @param channelId Optional channel ID to scope the relationship to.
     * @returns Promise resolving to true when deletion is confirmed.
     */
    public async deleteRelationshipMemory(otherAgentId: string, channelId?: string): Promise<boolean> {
        this.validator.assertIsNonEmptyString(otherAgentId, 'Other agent ID must be provided.');
        const relationshipId = this.generateRelationshipId(otherAgentId);
        if (channelId !== undefined) {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID must not be empty.');
        }
        const targetChannelId = channelId ?? this.channelId;
        this.assertAuthenticatedChannel(targetChannelId);
        await this.awaitOperation(
            this.memoryService.deleteMemory(
                this.agentId,
                this.channelId,
                MemoryScope.RELATIONSHIP,
                [...relationshipId, targetChannelId]
            ),
            `Delete relationship memory with '${otherAgentId}'`
        );
        return true;
    }
}
