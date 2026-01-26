/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * 
 * P2P Configuration (P9 Foundation)
 * EXPERIMENTAL: Configuration for P2P features
 * All disabled by default
 */

import { P2PFeatureFlags, DEFAULT_P2P_FEATURE_FLAGS, P2PCoordinationConfig } from '../types/DecentralizationTypes';

/**
 * Load P2P feature flags from environment
 */
export function loadP2PFeatureFlags(): P2PFeatureFlags {
    return {
        P2P_ENABLED: process.env.P2P_ENABLED === 'true' || false,
        P2P_NEGOTIATION_ENABLED: process.env.P2P_NEGOTIATION_ENABLED === 'true' || false,
        P2P_FEDERATED_MEMORY_ENABLED: process.env.P2P_FEDERATED_MEMORY_ENABLED === 'true' || false,
        P2P_GOSSIP_PROTOCOL_ENABLED: process.env.P2P_GOSSIP_PROTOCOL_ENABLED === 'true' || false,
        P2P_REPUTATION_SYSTEM_ENABLED: process.env.P2P_REPUTATION_SYSTEM_ENABLED === 'true' || false,
        P2P_BLOCKCHAIN_ENABLED: false, // Future feature
        P2P_TOKEN_ECONOMY_ENABLED: false // Future feature
    };
}

/**
 * Load P2P coordination configuration from environment
 */
export function loadP2PCoordinationConfig(): P2PCoordinationConfig {
    const featureFlags = loadP2PFeatureFlags();

    return {
        enabled: featureFlags.P2P_ENABLED,
        
        // Task negotiation settings
        enableTaskNegotiation: featureFlags.P2P_NEGOTIATION_ENABLED,
        defaultBidWindowMs: parseInt(process.env.P2P_BID_WINDOW_MS || '30000', 10),
        minBidsRequired: parseInt(process.env.P2P_MIN_BIDS || '1', 10),

        // Federated memory settings
        enableFederatedMemory: featureFlags.P2P_FEDERATED_MEMORY_ENABLED,
        defaultPrivacyLevel: (process.env.P2P_DEFAULT_PRIVACY_LEVEL as any) || 'private',

        // Gossip protocol settings
        enableGossipProtocol: featureFlags.P2P_GOSSIP_PROTOCOL_ENABLED,
        gossipInterval: parseInt(process.env.P2P_GOSSIP_INTERVAL_MS || '5000', 10),
        maxPeerConnections: parseInt(process.env.P2P_MAX_PEERS || '10', 10),

        // Reputation settings
        enableReputationSystem: featureFlags.P2P_REPUTATION_SYSTEM_ENABLED,
        reputationDecayRate: parseFloat(process.env.P2P_REPUTATION_DECAY_RATE || '0.001')
    };
}

/**
 * Get P2P feature flags (singleton)
 */
let cachedFeatureFlags: P2PFeatureFlags | null = null;

export function getP2PFeatureFlags(): P2PFeatureFlags {
    if (!cachedFeatureFlags) {
        cachedFeatureFlags = loadP2PFeatureFlags();
    }
    return cachedFeatureFlags;
}

/**
 * Get P2P coordination config (singleton)
 */
let cachedCoordinationConfig: P2PCoordinationConfig | null = null;

export function getP2PCoordinationConfig(): P2PCoordinationConfig {
    if (!cachedCoordinationConfig) {
        cachedCoordinationConfig = loadP2PCoordinationConfig();
    }
    return cachedCoordinationConfig;
}
