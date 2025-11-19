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
 * Shared State Management Service for MXP Token Optimization
 * 
 * Manages shared conversational state and context references to reduce token usage
 * in multi-agent conversations through intelligent state compression and referencing.
 * Updated to work with MXP 2.0.
 */

import { Logger } from '../utils/Logger';
import { MxpOperation, createMxpMessage, MxpMessageType } from '../schemas/MxpProtocolSchemas';

const logger = new Logger('debug', 'SharedStateService', 'server');

export interface SharedStateEntry {
    id: string;
    data: any;
    channelId: string;
    createdBy: string;
    createdAt: number;
    lastUpdatedBy?: string;
    lastUpdatedAt?: number;
    version: number;
    description?: string;
}

/**
 * Shared State Management for MXP-enabled agents
 * Reduces token usage by allowing state references instead of full context transmission
 */
export class SharedStateService {
    private static instance: SharedStateService;
    private stateStore = new Map<string, SharedStateEntry>();
    private channelStates = new Map<string, Set<string>>(); // channelId -> Set of stateIds
    
    private constructor() {
    }
    
    public static getInstance(): SharedStateService {
        if (!SharedStateService.instance) {
            SharedStateService.instance = new SharedStateService();
        }
        return SharedStateService.instance;
    }
    
    /**
     * Store collaborative state that can be referenced by ID
     * Only used when agents have mxpEnabled=true
     */
    public storeState(
        stateId: string,
        data: any,
        channelId: string,
        createdBy: string,
        description?: string
    ): void {
        const timestamp = Date.now();
        
        const existingState = this.stateStore.get(stateId);
        const version = existingState ? existingState.version + 1 : 1;
        
        const stateEntry: SharedStateEntry = {
            id: stateId,
            data,
            channelId,
            createdBy,
            createdAt: existingState?.createdAt || timestamp,
            lastUpdatedBy: createdBy,
            lastUpdatedAt: timestamp,
            version,
            description
        };
        
        this.stateStore.set(stateId, stateEntry);
        
        // Track by channel
        if (!this.channelStates.has(channelId)) {
            this.channelStates.set(channelId, new Set());
        }
        this.channelStates.get(channelId)!.add(stateId);
        
    }
    
    /**
     * Retrieve state by ID
     */
    public getState(stateId: string): SharedStateEntry | null {
        return this.stateStore.get(stateId) || null;
    }
    
    /**
     * Create MXP message referencing shared state instead of full context
     * Significant token savings for collaborative workflows
     */
    public createStateReference(
        stateId: string,
        senderId: string,
        options: {
            receiverId?: string;
            channelId?: string;
            operation?: 'reference' | 'update' | 'sync';
            updateData?: any;
        } = {}
    ): any {
        const operation = options.operation || 'reference';
        let mxpOperation: string;
        let args: any[];
        
        switch (operation) {
            case 'update':
                mxpOperation = MxpOperation.STATE_UPDATE;
                args = [stateId, options.updateData];
                break;
            case 'sync':
                mxpOperation = MxpOperation.STATE_SYNC;
                args = [stateId];
                break;
            default:
                mxpOperation = MxpOperation.STATE_REFERENCE;
                args = [stateId];
        }
        
        const state = this.getState(stateId);
        const context = state ? {
            version: state.version,
            description: state.description,
            lastUpdatedBy: state.lastUpdatedBy
        } : undefined;
        
        return createMxpMessage(
            MxpMessageType.COORDINATION,
            senderId,
            {
                op: mxpOperation,
                args,
                context,
                metadata: {
                    priority: 7,
                    correlationId: stateId
                }
            },
            {
                receiverId: options.receiverId,
                channelId: options.channelId
            }
        );
    }
    
    /**
     * Get all states for a channel
     */
    public getChannelStates(channelId: string): SharedStateEntry[] {
        const stateIds = this.channelStates.get(channelId);
        if (!stateIds) return [];
        
        return Array.from(stateIds)
            .map(id => this.stateStore.get(id))
            .filter(state => state !== undefined) as SharedStateEntry[];
    }
    
    /**
     * Clean up old states to prevent memory leaks
     */
    public cleanupOldStates(maxAgeMs: number = 24 * 60 * 60 * 1000): void { // Default 24 hours
        const now = Date.now();
        const toDelete: string[] = [];
        
        for (const [stateId, state] of this.stateStore.entries()) {
            const age = now - (state.lastUpdatedAt || state.createdAt);
            if (age > maxAgeMs) {
                toDelete.push(stateId);
            }
        }
        
        for (const stateId of toDelete) {
            const state = this.stateStore.get(stateId);
            if (state) {
                this.stateStore.delete(stateId);
                this.channelStates.get(state.channelId)?.delete(stateId);
            }
        }
        
    }
    
    /**
     * Get statistics for monitoring
     */
    public getStats(): {
        totalStates: number;
        statesByChannel: Record<string, number>;
        oldestState: number | null;
        newestState: number | null;
    } {
        const statesByChannel: Record<string, number> = {};
        let oldestState: number | null = null;
        let newestState: number | null = null;
        
        for (const [channelId, stateIds] of this.channelStates.entries()) {
            statesByChannel[channelId] = stateIds.size;
        }
        
        for (const state of this.stateStore.values()) {
            const timestamp = state.lastUpdatedAt || state.createdAt;
            if (oldestState === null || timestamp < oldestState) {
                oldestState = timestamp;
            }
            if (newestState === null || timestamp > newestState) {
                newestState = timestamp;
            }
        }
        
        return {
            totalStates: this.stateStore.size,
            statesByChannel,
            oldestState,
            newestState
        };
    }
}

// Export singleton instance
export const sharedStateService = SharedStateService.getInstance();
