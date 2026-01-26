/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * 
 * P2P Event Definitions (P9 Foundation)
 * EXPERIMENTAL: Event definitions for P2P functionality
 */

import {
    TaskBid,
    TaskAnnouncement,
    TaskSelectionResult,
    FederatedMemoryEntry,
    GossipMessage,
    PeerNode,
    AgentReputationUpdate
} from '../../types/DecentralizationTypes';

export const P2PEvents = {
    // Task Negotiation Events
    TASK_ANNOUNCED: 'p2p:task_announced',
    TASK_BID_SUBMITTED: 'p2p:task_bid_submitted',
    TASK_BID_RECEIVED: 'p2p:task_bid_received',
    TASK_AWARDED: 'p2p:task_awarded',
    TASK_ANNOUNCEMENT_CANCELLED: 'p2p:task_announcement_cancelled',

    // Memory Events
    MEMORY_SHARED: 'p2p:memory_shared',
    MEMORY_SYNC_REQUESTED: 'p2p:memory_sync_requested',

    // Gossip Protocol Events
    GOSSIP_ROUND: 'p2p:gossip_round',
    GOSSIP_PROPAGATED: 'p2p:gossip_propagated',
    GOSSIP_MESSAGE_RECEIVED: 'p2p:gossip_message_received',

    // Peer Discovery Events
    PEER_DISCOVERY_REQUESTED: 'p2p:peer_discovery_requested',
    PEER_ADDED: 'p2p:peer_added',
    PEER_REMOVED: 'p2p:peer_removed',

    // Reputation Events
    REPUTATION_UPDATED: 'p2p:reputation_updated'
} as const;

export interface P2PEventPayloads {
    [P2PEvents.TASK_ANNOUNCED]: {
        announcement: TaskAnnouncement;
        timestamp: number;
    };
    [P2PEvents.TASK_BID_SUBMITTED]: {
        bid: TaskBid;
    };
    [P2PEvents.TASK_BID_RECEIVED]: {
        bid: TaskBid;
        announcementId: string;
        timestamp: number;
    };
    [P2PEvents.TASK_AWARDED]: {
        announcementId: string;
        selectionResult: TaskSelectionResult;
        timestamp: number;
    };
    [P2PEvents.TASK_ANNOUNCEMENT_CANCELLED]: {
        announcementId: string;
        reason: string;
        timestamp: number;
    };
    [P2PEvents.MEMORY_SHARED]: {
        entry: FederatedMemoryEntry;
        timestamp: number;
    };
    [P2PEvents.MEMORY_SYNC_REQUESTED]: {
        timestamp: number;
    };
    [P2PEvents.GOSSIP_ROUND]: {
        peersSelected: number;
        timestamp: number;
    };
    [P2PEvents.GOSSIP_PROPAGATED]: {
        messageId: string;
        type: string;
        peersCount: number;
        timestamp: number;
    };
    [P2PEvents.GOSSIP_MESSAGE_RECEIVED]: {
        message: GossipMessage;
        timestamp: number;
    };
    [P2PEvents.PEER_DISCOVERY_REQUESTED]: {
        timestamp: number;
    };
    [P2PEvents.PEER_ADDED]: {
        peer: PeerNode;
        timestamp: number;
    };
    [P2PEvents.PEER_REMOVED]: {
        peerId: string;
        timestamp: number;
    };
    [P2PEvents.REPUTATION_UPDATED]: {
        agentId: string;
        oldScore: number;
        newScore: number;
        reason: string;
        timestamp: number;
    };
}
