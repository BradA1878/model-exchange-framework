/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * 
 * Gossip Protocol Service (P9 Foundation)
 * EXPERIMENTAL: Foundation for P2P gossip communication
 * Disabled by default via feature flags
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import {
    GossipMessage,
    PeerNode,
    P2PFeatureFlags,
    DEFAULT_P2P_FEATURE_FLAGS
} from '../../types/DecentralizationTypes';

export interface GossipConfig {
    enabled: boolean;
    gossipInterval: number;
    maxHops: number;
    fanout: number;
}

const DEFAULT_GOSSIP_CONFIG: GossipConfig = {
    enabled: false,
    gossipInterval: 5000,
    maxHops: 5,
    fanout: 3
};

export class GossipProtocolService {
    private static instance: GossipProtocolService;
    private readonly logger: Logger;
    private config: GossipConfig;
    private featureFlags: P2PFeatureFlags;
    private knownPeers = new Map<string, PeerNode>();
    private seenMessages = new Set<string>();
    private gossipInterval?: NodeJS.Timeout;

    private constructor(
        config: Partial<GossipConfig> = {},
        featureFlags: P2PFeatureFlags = DEFAULT_P2P_FEATURE_FLAGS
    ) {
        this.logger = new Logger('debug', 'GossipProtocolService', 'server');
        this.config = { ...DEFAULT_GOSSIP_CONFIG, ...config };
        this.featureFlags = featureFlags;

        if (this.isEnabled()) {
            this.logger.info('Gossip Protocol initialized (EXPERIMENTAL)');
            this.startGossipCycle();
        } else {
            this.logger.info('Gossip Protocol disabled by feature flags');
        }
    }

    public static getInstance(
        config?: Partial<GossipConfig>,
        featureFlags?: P2PFeatureFlags
    ): GossipProtocolService {
        if (!GossipProtocolService.instance) {
            GossipProtocolService.instance = new GossipProtocolService(config, featureFlags);
        }
        return GossipProtocolService.instance;
    }

    /**
     * Reset the singleton instance (for testing only)
     */
    public static resetInstance(): void {
        if (GossipProtocolService.instance) {
            GossipProtocolService.instance.cleanup();
        }
        GossipProtocolService.instance = undefined as unknown as GossipProtocolService;
    }

    private cleanup(): void {
        if (this.gossipInterval) {
            clearInterval(this.gossipInterval);
            this.gossipInterval = undefined;
        }
        this.knownPeers.clear();
        this.seenMessages.clear();
    }

    private isEnabled(): boolean {
        return (
            this.featureFlags.P2P_ENABLED &&
            this.featureFlags.P2P_GOSSIP_PROTOCOL_ENABLED &&
            this.config.enabled
        );
    }

    private startGossipCycle(): void {
        if (this.gossipInterval) {
            clearInterval(this.gossipInterval);
        }

        this.gossipInterval = setInterval(() => {
            this.performGossipRound();
        }, this.config.gossipInterval);
    }

    private performGossipRound(): void {
        const peers = this.selectGossipPeers();
        if (peers.length === 0) {
            return;
        }

        EventBus.server.emit('p2p:gossip_round', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {
                peersSelected: peers.length
            }
        });
    }

    private selectGossipPeers(): PeerNode[] {
        const peers = Array.from(this.knownPeers.values())
            .filter(p => p.status === 'connected');
        
        const selected: PeerNode[] = [];
        const fanout = Math.min(this.config.fanout, peers.length);

        for (let i = 0; i < fanout; i++) {
            const randomIndex = Math.floor(Math.random() * peers.length);
            selected.push(peers[randomIndex]);
        }

        return selected;
    }

    public async propagate(message: GossipMessage): Promise<void> {
        if (!this.isEnabled()) {
            throw new Error('Gossip protocol is disabled');
        }

        if (message.hops >= message.maxHops || this.seenMessages.has(message.gossipId)) {
            return;
        }

        this.seenMessages.add(message.gossipId);
        message.path.push(message.origin);

        const peers = this.selectGossipPeers();

        EventBus.server.emit('p2p:gossip_propagated', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {
                messageId: message.gossipId,
                type: message.type,
                peersCount: peers.length
            }
        });

        this.logger.debug(`Gossip propagated: ${message.gossipId}`, {
            type: message.type,
            hops: message.hops,
            peersCount: peers.length
        });
    }

    public async handleMessage(message: GossipMessage): Promise<void> {
        if (!this.isEnabled()) {
            throw new Error('Gossip protocol is disabled');
        }

        if (this.seenMessages.has(message.gossipId)) {
            return;
        }

        message.hops++;
        if (message.hops < message.maxHops) {
            await this.propagate(message);
        }

        EventBus.server.emit('p2p:gossip_message_received', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {
                message
            }
        });
    }

    public async discoverPeers(): Promise<PeerNode[]> {
        if (!this.isEnabled()) {
            throw new Error('Gossip protocol is disabled');
        }

        EventBus.server.emit('p2p:peer_discovery_requested', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {}
        });

        return Array.from(this.knownPeers.values());
    }

    public getKnownPeers(): PeerNode[] {
        return Array.from(this.knownPeers.values());
    }

    public addPeer(peer: PeerNode): void {
        this.knownPeers.set(peer.peerId, peer);

        EventBus.server.emit('p2p:peer_added', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {
                peer
            }
        });
    }

    public removePeer(peerId: string): void {
        this.knownPeers.delete(peerId);

        EventBus.server.emit('p2p:peer_removed', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {
                peerId
            }
        });
    }

    public shutdown(): void {
        if (this.gossipInterval) {
            clearInterval(this.gossipInterval);
        }
    }
}
