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
 * Shared State Management Service for MXP Token Optimization
 * 
 * Manages shared conversational state and context references to reduce token usage
 * in multi-agent conversations through intelligent state compression and referencing.
 * Updated to work with MXP 2.0.
 */

import { Logger } from '../utils/Logger.js';
import { MxpOperation, createMxpMessage, MxpMessageType } from '../schemas/MxpProtocolSchemas.js';

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

    /** How long an untouched state entry is kept before cleanup (24 hours). */
    private static readonly STATE_TTL_MS = 24 * 60 * 60 * 1000;

    /** How often the cleanup sweep runs (1 hour). */
    private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

    private cleanupInterval: NodeJS.Timeout | null = null;

    private constructor() {
        // This is a process-lifetime singleton holding an unbounded Map, so the
        // sweep has to be driven by something. cleanupOldStates() existed but had
        // no callers anywhere, so stateStore/channelStates simply grew forever.
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldStates();
        }, SharedStateService.CLEANUP_INTERVAL_MS);

        // Do not hold the event loop open on account of a garbage-collection timer.
        this.cleanupInterval.unref?.();
    }

    public static getInstance(): SharedStateService {
        if (!SharedStateService.instance) {
            SharedStateService.instance = new SharedStateService();
        }
        return SharedStateService.instance;
    }

    /**
     * Stop the cleanup timer. For tests and shutdown.
     */
    public stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
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
     * Drop states that have not been touched within the TTL.
     *
     * Runs on a timer from the constructor; also callable directly.
     *
     * @param maxAgeMs Age past which a state is dropped (default: 24 hours)
     * @returns The number of states removed
     */
    public cleanupOldStates(maxAgeMs: number = SharedStateService.STATE_TTL_MS): number {
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

                const channelStateIds = this.channelStates.get(state.channelId);
                if (channelStateIds) {
                    channelStateIds.delete(stateId);
                    // Drop the channel entry too, or channelStates grows forever
                    // with empty Sets for channels that are long gone.
                    if (channelStateIds.size === 0) {
                        this.channelStates.delete(state.channelId);
                    }
                }
            }
        }

        if (toDelete.length > 0) {
            logger.debug(`Removed ${toDelete.length} shared state entries older than ${maxAgeMs}ms`);
        }

        return toDelete.length;
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
