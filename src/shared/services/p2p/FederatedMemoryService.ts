/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * 
 * Federated Memory Service (P9 Foundation)
 * EXPERIMENTAL: Foundation for distributed memory sharing
 * Disabled by default via feature flags
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import {
    FederatedMemoryEntry,
    FederatedMemoryProtocol,
    DistributedMemoryQuery,
    MemoryPrivacyLevel,
    P2PFeatureFlags,
    DEFAULT_P2P_FEATURE_FLAGS
} from '../../types/DecentralizationTypes';
import { AgentId } from '../../types/Agent';

export class FederatedMemoryService implements FederatedMemoryProtocol {
    private static instance: FederatedMemoryService;
    private readonly logger: Logger;
    private featureFlags: P2PFeatureFlags;
    private localMemoryStore = new Map<string, FederatedMemoryEntry>();

    private constructor(featureFlags: P2PFeatureFlags = DEFAULT_P2P_FEATURE_FLAGS) {
        this.logger = new Logger('debug', 'FederatedMemoryService', 'server');
        this.featureFlags = featureFlags;

        if (this.isEnabled()) {
            this.logger.info('Federated Memory initialized (EXPERIMENTAL)');
        } else {
            this.logger.info('Federated Memory disabled by feature flags');
        }
    }

    public static getInstance(featureFlags?: P2PFeatureFlags): FederatedMemoryService {
        if (!FederatedMemoryService.instance) {
            FederatedMemoryService.instance = new FederatedMemoryService(featureFlags);
        }
        return FederatedMemoryService.instance;
    }

    /**
     * Reset the singleton instance (for testing only)
     */
    public static resetInstance(): void {
        FederatedMemoryService.instance = undefined as unknown as FederatedMemoryService;
    }

    private isEnabled(): boolean {
        return (
            this.featureFlags.P2P_ENABLED &&
            this.featureFlags.P2P_FEDERATED_MEMORY_ENABLED
        );
    }

    public async shareMemory(entry: FederatedMemoryEntry): Promise<void> {
        if (!this.isEnabled()) {
            throw new Error('Federated memory is disabled');
        }

        this.localMemoryStore.set(entry.id, entry);

        EventBus.server.emit('p2p:memory_shared', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {
                entry
            }
        });

        this.logger.debug(`Memory shared: ${entry.id}`, {
            type: entry.type,
            privacyLevel: entry.privacyLevel
        });
    }

    public async queryDistributedMemory(query: DistributedMemoryQuery): Promise<FederatedMemoryEntry[]> {
        if (!this.isEnabled()) {
            throw new Error('Federated memory is disabled');
        }

        let results = Array.from(this.localMemoryStore.values());

        if (query.type) {
            results = results.filter(e => query.type!.includes(e.type));
        }
        if (query.agentId) {
            results = results.filter(e => e.agentId === query.agentId);
        }
        if (query.channelId) {
            results = results.filter(e => e.channelId === query.channelId);
        }
        if (query.privacyLevel) {
            results = results.filter(e => query.privacyLevel!.includes(e.privacyLevel));
        }
        if (query.fromTimestamp) {
            results = results.filter(e => e.createdAt >= query.fromTimestamp!);
        }
        if (query.toTimestamp) {
            results = results.filter(e => e.createdAt <= query.toTimestamp!);
        }
        if (query.minRelevance) {
            results = results.filter(e => (e.relevanceScore || 0) >= query.minRelevance!);
        }
        if (query.limit) {
            results = results.slice(0, query.limit);
        }

        return results;
    }

    public async syncWithPeers(): Promise<void> {
        if (!this.isEnabled()) {
            throw new Error('Federated memory is disabled');
        }

        EventBus.server.emit('p2p:memory_sync_requested', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {}
        });

        this.logger.debug('Memory sync with peers requested');
    }

    public getLocalMemoryCount(): number {
        return this.localMemoryStore.size;
    }
}
