/**
 * Decentralization Types for MXF
 *
 * Type definitions for P2P agent communication and gossip protocol.
 * Feature flag: DECENTRALIZATION_ENABLED
 */

import { AgentId } from './Agent';
import { ChannelTask } from './TaskTypes';

/**
 * Peer node information
 */
export interface PeerNode {
  /** Unique peer ID */
  peerId: string;
  /** Peer display name */
  name?: string;
  /** Peer network address */
  address: PeerAddress;
  /** Peer public key (for encryption) */
  publicKey: string;
  /** Peer capabilities */
  capabilities: PeerCapabilities;
  /** Peer reputation score (0-1) */
  reputation: number;
  /** Connection status */
  status: PeerStatus;
  /** Last seen timestamp */
  lastSeen: Date;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Peer network address
 */
export interface PeerAddress {
  /** Protocol (tcp, ws, wss, etc.) */
  protocol: 'tcp' | 'ws' | 'wss' | 'http' | 'https';
  /** Host/IP address */
  host: string;
  /** Port number */
  port: number;
  /** Full address string */
  full: string;
}

/**
 * Peer capabilities
 */
export interface PeerCapabilities {
  /** Supported protocols */
  protocols: string[];
  /** Supported message types */
  messageTypes: string[];
  /** Available tools/services */
  services: string[];
  /** Maximum message size (bytes) */
  maxMessageSize: number;
  /** Supports encryption */
  supportsEncryption: boolean;
  /** Supports compression */
  supportsCompression: boolean;
}

/**
 * Peer connection status
 */
export type PeerStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'banned';

/**
 * P2P message
 */
export interface P2PMessage {
  /** Message ID */
  id: string;
  /** Message type */
  type: P2PMessageType;
  /** Sender peer ID */
  from: string;
  /** Recipient peer ID (or broadcast) */
  to: string | 'broadcast';
  /** Message payload */
  payload: unknown;
  /** Message timestamp */
  timestamp: Date;
  /** Time-to-live (hops) */
  ttl: number;
  /** Message signature (for verification) */
  signature?: string;
  /** Encryption flag */
  encrypted: boolean;
  /** Compression flag */
  compressed: boolean;
  /** Message priority */
  priority: MessagePriority;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * P2P message type
 */
export type P2PMessageType =
  | 'peer_discovery'
  | 'peer_announcement'
  | 'gossip'
  | 'direct_message'
  | 'broadcast'
  | 'request'
  | 'response'
  | 'error'
  | 'ping'
  | 'pong';

/**
 * Message priority
 */
export enum MessagePriority {
  Critical = 5,
  High = 4,
  Normal = 3,
  Low = 2,
  Background = 1,
}

/**
 * Gossip protocol message
 */
export interface GossipMessage {
  /** Gossip ID (for deduplication) */
  gossipId: string;
  /** Gossip type */
  type: GossipType;
  /** Gossip data */
  data: unknown;
  /** Origin peer ID */
  origin: string;
  /** Propagation path (peer IDs) */
  path: string[];
  /** Created timestamp */
  createdAt: Date;
  /** Expiration timestamp */
  expiresAt: Date;
  /** Number of hops */
  hops: number;
  /** Maximum hops */
  maxHops: number;
}

/**
 * Gossip type
 */
export type GossipType =
  | 'peer_list'         // Peer discovery/announcement
  | 'state_update'      // Distributed state update
  | 'event'             // Event propagation
  | 'rumor'             // General information spreading
  | 'alert'             // Important alert
  | 'heartbeat';        // Liveness signal

/**
 * Distributed hash table (DHT) entry
 */
export interface DHTEntry {
  /** Key */
  key: string;
  /** Value */
  value: unknown;
  /** Owner peer ID */
  owner: string;
  /** Replica peer IDs */
  replicas: string[];
  /** Created timestamp */
  createdAt: Date;
  /** Updated timestamp */
  updatedAt: Date;
  /** Expiration timestamp */
  expiresAt?: Date;
  /** Version number */
  version: number;
}

/**
 * Peer discovery method
 */
export type DiscoveryMethod =
  | 'bootstrap'        // Bootstrap from known nodes
  | 'multicast'        // Local network multicast
  | 'dns'              // DNS-based discovery
  | 'tracker'          // Centralized tracker
  | 'gossip'           // Peer gossip
  | 'manual';          // Manual configuration

/**
 * Peer discovery result
 */
export interface DiscoveryResult {
  /** Discovered peers */
  peers: PeerNode[];
  /** Discovery method used */
  method: DiscoveryMethod;
  /** Discovery timestamp */
  timestamp: Date;
}

/**
 * Connection attempt
 */
export interface ConnectionAttempt {
  /** Target peer ID */
  peerId: string;
  /** Attempt number */
  attemptNumber: number;
  /** Attempt timestamp */
  timestamp: Date;
  /** Result */
  result: 'success' | 'failure' | 'timeout';
  /** Error message (if failed) */
  error?: string;
  /** Latency (milliseconds) */
  latency?: number;
}

/**
 * Routing table entry
 */
export interface RoutingEntry {
  /** Destination peer ID */
  destination: string;
  /** Next hop peer ID */
  nextHop: string;
  /** Hop count */
  hops: number;
  /** Route cost/metric */
  cost: number;
  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * P2P network topology
 */
export interface NetworkTopology {
  /** Local peer ID */
  localPeerId: string;
  /** Connected peers */
  peers: PeerNode[];
  /** Routing table */
  routes: RoutingEntry[];
  /** Network diameter (max hops) */
  diameter: number;
  /** Total nodes in network */
  totalNodes: number;
  /** Network clustering coefficient */
  clusteringCoefficient: number;
}

/**
 * Consensus protocol type
 */
export type ConsensusProtocol =
  | 'raft'              // Raft consensus
  | 'paxos'             // Paxos consensus
  | 'pbft'              // Practical Byzantine Fault Tolerance
  | 'gossip_based'      // Gossip-based eventual consistency
  | 'crdt';             // Conflict-free Replicated Data Types

/**
 * Consensus proposal
 */
export interface ConsensusProposal {
  /** Proposal ID */
  id: string;
  /** Proposer peer ID */
  proposer: string;
  /** Proposal type */
  type: string;
  /** Proposal data */
  data: unknown;
  /** Proposed timestamp */
  proposedAt: Date;
  /** Votes received */
  votes: ConsensusVote[];
  /** Current status */
  status: 'pending' | 'accepted' | 'rejected' | 'timeout';
}

/**
 * Consensus vote
 */
export interface ConsensusVote {
  /** Voter peer ID */
  voter: string;
  /** Vote decision */
  decision: 'accept' | 'reject' | 'abstain';
  /** Vote timestamp */
  timestamp: Date;
  /** Vote reason */
  reason?: string;
  /** Vote signature */
  signature?: string;
}

/**
 * Network partition detection
 */
export interface PartitionDetection {
  /** Is network partitioned? */
  isPartitioned: boolean;
  /** Partition groups (peer IDs) */
  partitions: string[][];
  /** Detection timestamp */
  detectedAt: Date;
  /** Recovery actions suggested */
  recoveryActions?: string[];
}

/**
 * Decentralization configuration
 */
export interface DecentralizationConfig {
  /** Enable P2P mode */
  enabled: boolean;

  /** Local peer configuration */
  peer: {
    /** Peer display name */
    name?: string;
    /** Listen address */
    listenAddress: string;
    /** Listen port */
    listenPort: number;
    /** Public address (for NAT) */
    publicAddress?: string;
    /** Maximum connections */
    maxConnections: number;
  };

  /** Discovery configuration */
  discovery: {
    /** Enabled discovery methods */
    methods: DiscoveryMethod[];
    /** Bootstrap node addresses */
    bootstrapNodes: string[];
    /** Discovery interval (milliseconds) */
    interval: number;
    /** Enable auto-discovery */
    autoDiscovery: boolean;
  };

  /** Gossip protocol configuration */
  gossip: {
    /** Enable gossip protocol */
    enabled: boolean;
    /** Gossip interval (milliseconds) */
    interval: number;
    /** Gossip fanout (peers per round) */
    fanout: number;
    /** Maximum hops for gossip */
    maxHops: number;
    /** Message TTL (milliseconds) */
    messageTtl: number;
  };

  /** DHT configuration */
  dht: {
    /** Enable DHT */
    enabled: boolean;
    /** Replication factor */
    replicationFactor: number;
    /** Bucket size (k-buckets) */
    bucketSize: number;
    /** Refresh interval (milliseconds) */
    refreshInterval: number;
  };

  /** Routing configuration */
  routing: {
    /** Routing algorithm */
    algorithm: 'flooding' | 'distance_vector' | 'link_state' | 'dht_based';
    /** Route update interval (milliseconds) */
    updateInterval: number;
    /** Route timeout (milliseconds) */
    routeTimeout: number;
  };

  /** Consensus configuration */
  consensus: {
    /** Enable consensus */
    enabled: boolean;
    /** Consensus protocol */
    protocol: ConsensusProtocol;
    /** Quorum size (percentage) */
    quorumSize: number;
    /** Proposal timeout (milliseconds) */
    proposalTimeout: number;
  };

  /** Security configuration */
  security: {
    /** Enable encryption */
    encryption: boolean;
    /** Enable message signing */
    signing: boolean;
    /** Trust model */
    trustModel: 'full_trust' | 'web_of_trust' | 'reputation_based';
    /** Minimum reputation for trust */
    minReputation: number;
  };

  /** Performance configuration */
  performance: {
    /** Enable message compression */
    compression: boolean;
    /** Message batch size */
    batchSize: number;
    /** Send buffer size (bytes) */
    sendBufferSize: number;
    /** Receive buffer size (bytes) */
    receiveBufferSize: number;
  };

  /** Health monitoring */
  health: {
    /** Ping interval (milliseconds) */
    pingInterval: number;
    /** Ping timeout (milliseconds) */
    pingTimeout: number;
    /** Unhealthy threshold (failed pings) */
    unhealthyThreshold: number;
    /** Ban duration (milliseconds) */
    banDuration: number;
  };
}

/**
 * P2P network statistics
 */
export interface P2PNetworkStats {
  /** Total peers */
  totalPeers: number;
  /** Connected peers */
  connectedPeers: number;
  /** Messages sent */
  messagesSent: number;
  /** Messages received */
  messagesReceived: number;
  /** Bytes sent */
  bytesSent: number;
  /** Bytes received */
  bytesReceived: number;
  /** Average latency (milliseconds) */
  avgLatency: number;
  /** Message delivery rate (0-1) */
  deliveryRate: number;
  /** Network uptime (milliseconds) */
  uptime: number;
  /** Active gossip messages */
  activeGossips: number;
}

/**
 * Peer reputation update
 */
export interface ReputationUpdate {
  /** Peer ID */
  peerId: string;
  /** Old reputation */
  oldReputation: number;
  /** New reputation */
  newReputation: number;
  /** Update reason */
  reason: string;
  /** Update timestamp */
  timestamp: Date;
}

/**
 * P2P event
 */
export interface P2PEvent {
  /** Event type */
  type: P2PEventType;
  /** Peer ID (if relevant) */
  peerId?: string;
  /** Event data */
  data?: unknown;
  /** Event timestamp */
  timestamp: Date;
}

/**
 * P2P event type
 */
export type P2PEventType =
  | 'peer_connected'
  | 'peer_disconnected'
  | 'peer_discovered'
  | 'message_received'
  | 'message_sent'
  | 'gossip_propagated'
  | 'consensus_reached'
  | 'partition_detected'
  | 'partition_healed'
  | 'reputation_updated'
  | 'route_updated'
  | 'dht_updated'
  | 'error';

// ============================================================================
// P9: P2P Task Negotiation Types
// ============================================================================

/**
 * Task bid from an agent in P2P negotiation
 */
export interface TaskBid {
    bidId: string;
    taskId: string;
    agentId: AgentId;

    // Bid details
    price?: number;                     // Cost in tokens/credits (future)
    estimatedDuration: number;          // Minutes
    confidence: number;                 // 0-1 confidence in ability to complete

    // Agent capabilities for this task
    relevantCapabilities: string[];
    relevantRoles: string[];

    // Reputation factors
    reputationScore: number;            // Overall reputation (0-1)
    relevantTaskHistory: number;        // Count of similar tasks completed
    successRate: number;                // 0-1 success rate on similar tasks

    // Timing
    submittedAt: number;
    expiresAt: number;

    // Optional metadata
    metadata?: Record<string, any>;
}

/**
 * Task announcement in P2P network
 */
export interface TaskAnnouncement {
    announcementId: string;
    task: ChannelTask;

    // Bid window
    bidWindowStart: number;
    bidWindowEnd: number;

    // Selection criteria
    selectionStrategy: TaskSelectionStrategy;
    minBids?: number;                   // Minimum bids required
    maxBids?: number;                   // Maximum bids to accept

    // Announced by
    announcerAgentId: AgentId;

    // Status
    status: 'open' | 'closed' | 'awarded' | 'cancelled';

    metadata?: Record<string, any>;
}

/**
 * Strategy for selecting winning bid
 */
export type TaskSelectionStrategy =
    | 'lowest_price'                    // Cheapest bid
    | 'highest_reputation'              // Most reputable agent
    | 'fastest_completion'              // Quickest estimated completion
    | 'highest_confidence'              // Most confident agent
    | 'best_value'                      // Balanced price/quality
    | 'weighted_score';                 // Custom weighted scoring

/**
 * Result of task selection
 */
export interface TaskSelectionResult {
    taskId: string;
    winningBid: TaskBid;
    alternativeBids?: TaskBid[];        // Runner-up bids
    selectionReasoning: string;
    selectedAt: number;
}

// ============================================================================
// P9: Distributed Memory Layer Types
// ============================================================================

/**
 * Privacy level for memory sharing
 */
export type MemoryPrivacyLevel =
    | 'private'                         // Local only, never shared
    | 'channel'                         // Share within channel
    | 'federated'                       // Share across federated instances
    | 'public';                         // Publicly available

/**
 * Federated memory entry
 */
export interface FederatedMemoryEntry {
    id: string;
    agentId: AgentId;
    channelId?: string;

    // Memory content
    type: 'insight' | 'pattern' | 'learning' | 'context';
    content: any;

    // Privacy and sharing
    privacyLevel: MemoryPrivacyLevel;
    encryptedContent?: string;          // Encrypted version for federated sharing

    // Provenance
    createdAt: number;
    updatedAt: number;
    originInstance?: string;            // Which MXF instance created this

    // Metadata
    tags?: string[];
    relevanceScore?: number;            // 0-1 relevance to current context

    metadata?: Record<string, any>;
}

/**
 * Federated memory sharing protocol interface
 */
export interface FederatedMemoryProtocol {
    // Share memory to peers
    shareMemory(entry: FederatedMemoryEntry): Promise<void>;

    // Query distributed memory
    queryDistributedMemory(query: DistributedMemoryQuery): Promise<FederatedMemoryEntry[]>;

    // Sync with peers
    syncWithPeers(): Promise<void>;
}

/**
 * Memory query for distributed search
 */
export interface DistributedMemoryQuery {
    type?: string[];
    tags?: string[];
    agentId?: AgentId;
    channelId?: string;
    privacyLevel?: MemoryPrivacyLevel[];
    fromTimestamp?: number;
    toTimestamp?: number;
    textQuery?: string;
    limit?: number;
    minRelevance?: number;              // Minimum relevance score
    allowDistributed?: boolean;         // Query peers or local only
}

// ============================================================================
// P9: Agent Reputation System Types
// ============================================================================

/**
 * Agent reputation metrics
 */
export interface AgentReputationMetrics {
    agentId: AgentId;

    // Overall score
    overallScore: number;               // 0-1 overall reputation

    // Task completion metrics
    tasksCompleted: number;
    tasksSucceeded: number;
    tasksFailed: number;
    successRate: number;                // tasksSucceeded / tasksCompleted

    // Quality metrics
    averageConfidence: number;          // Average confidence in task bids
    averageCompletionTime: number;      // Average time to complete (minutes)
    reliabilityScore: number;           // 0-1 reliability in meeting estimates

    // Collaboration metrics
    collaborationScore: number;         // 0-1 score for working with others
    helpfulnessScore: number;           // 0-1 score for helping other agents

    // Timing
    firstSeen: number;
    lastUpdated: number;

    // Historical data
    reputationHistory: ReputationHistoryEntry[];

    metadata?: Record<string, any>;
}

/**
 * Historical reputation entry
 */
export interface ReputationHistoryEntry {
    timestamp: number;
    score: number;
    reason: string;                     // What caused the change
    delta: number;                      // Change in score
    relatedTaskId?: string;
    relatedAgentId?: AgentId;           // If interaction with another agent
}

/**
 * Reputation update event for agents
 */
export interface AgentReputationUpdate {
    agentId: AgentId;
    reason: 'task_completed' | 'task_failed' | 'collaboration' | 'peer_rating' | 'penalty' | 'bonus';
    scoreDelta: number;                 // Change in reputation score
    relatedTaskId?: string;
    relatedAgentId?: AgentId;
    timestamp: number;
    metadata?: Record<string, any>;
}

// ============================================================================
// P9: P2P Coordination Mode Types
// ============================================================================

/**
 * Extended coordination mode including P2P
 */
export type ExtendedCoordinationMode =
    | 'independent'
    | 'collaborative'
    | 'sequential'
    | 'hierarchical'
    | 'p2p_negotiated';                 // NEW: P2P negotiation mode

/**
 * P2P coordination configuration
 */
export interface P2PCoordinationConfig {
    enabled: boolean;

    // Negotiation settings
    enableTaskNegotiation: boolean;
    defaultBidWindowMs: number;
    minBidsRequired: number;

    // Memory sharing settings
    enableFederatedMemory: boolean;
    defaultPrivacyLevel: MemoryPrivacyLevel;

    // Gossip protocol settings
    enableGossipProtocol: boolean;
    gossipInterval: number;             // Milliseconds between gossip rounds
    maxPeerConnections: number;

    // Reputation settings
    enableReputationSystem: boolean;
    reputationDecayRate: number;        // Decay rate for inactive agents

    metadata?: Record<string, any>;
}

// ============================================================================
// P9: Feature Flags
// ============================================================================

/**
 * Feature flags for P2P functionality
 * All disabled by default for experimental foundation
 */
export interface P2PFeatureFlags {
    // Master switch
    P2P_ENABLED: boolean;

    // Individual features
    P2P_NEGOTIATION_ENABLED: boolean;
    P2P_FEDERATED_MEMORY_ENABLED: boolean;
    P2P_GOSSIP_PROTOCOL_ENABLED: boolean;
    P2P_REPUTATION_SYSTEM_ENABLED: boolean;

    // Advanced features (future)
    P2P_BLOCKCHAIN_ENABLED: boolean;
    P2P_TOKEN_ECONOMY_ENABLED: boolean;
}

/**
 * Default feature flags - all disabled
 */
export const DEFAULT_P2P_FEATURE_FLAGS: P2PFeatureFlags = {
    P2P_ENABLED: false,
    P2P_NEGOTIATION_ENABLED: false,
    P2P_FEDERATED_MEMORY_ENABLED: false,
    P2P_GOSSIP_PROTOCOL_ENABLED: false,
    P2P_REPUTATION_SYSTEM_ENABLED: false,
    P2P_BLOCKCHAIN_ENABLED: false,
    P2P_TOKEN_ECONOMY_ENABLED: false,
};
