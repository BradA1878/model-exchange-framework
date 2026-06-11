/**
 * Enhancement Constants for MXF P6-P9 Features
 *
 * Constants for LSP, Workflow System, Memory Strata, and Decentralization features.
 */

/**
 * LSP Constants
 */
export const LSP_CONSTANTS = {
  /** Default LSP server configurations */
  SERVERS: {
    TYPESCRIPT: {
      COMMAND: 'typescript-language-server',
      ARGS: ['--stdio'],
      DEFAULT_MAX_MEMORY: 4096, // MB
    },
    PYTHON: {
      COMMAND: 'pylsp',
      ARGS: [],
      TYPE: 'pylsp' as const,
    },
    GO: {
      COMMAND: 'gopls',
      ARGS: [],
    },
  },

  /** Document management defaults */
  DOCUMENT: {
    SYNC_MODE: 'incremental' as const,
    IDLE_CLOSE_TIMEOUT: 300000, // 5 minutes
    MAX_OPEN_DOCUMENTS: 50,
  },

  /** Lifecycle defaults */
  LIFECYCLE: {
    HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
    STARTUP_TIMEOUT: 30000, // 30 seconds
    SHUTDOWN_TIMEOUT: 10000, // 10 seconds
    MAX_INSTANCES: 10,
    RESTART_POLICY: {
      MAX_RETRIES: 3,
      BACKOFF_MULTIPLIER: 2,
      INITIAL_DELAY: 1000, // 1 second
      MAX_DELAY: 30000, // 30 seconds
    },
  },

  /** Cache defaults */
  CACHE: {
    DIAGNOSTICS_TTL: 5000, // 5 seconds
    SYMBOLS_TTL: 60000, // 1 minute
    COMPLETIONS_TTL: 1000, // 1 second
  },

  /** Timeouts for LSP operations */
  TIMEOUTS: {
    GOTO_DEFINITION: 30000, // 30 seconds
    FIND_REFERENCES: 60000, // 1 minute
    DIAGNOSTICS: 10000, // 10 seconds
    COMPLETIONS: 5000, // 5 seconds
    HOVER: 5000, // 5 seconds
    RENAME: 60000, // 1 minute
    DOCUMENT_SYMBOLS: 10000, // 10 seconds
    WORKSPACE_SYMBOLS: 30000, // 30 seconds
  },

  /** Position indexing */
  POSITION: {
    /** LSP uses 0-indexed positions */
    LSP_INDEXED: 0,
    /** MXF tools use 1-indexed positions */
    TOOL_INDEXED: 1,
  },
} as const;

/**
 * Workflow System Constants
 */
export const WORKFLOW_CONSTANTS = {
  /** Workflow execution defaults */
  EXECUTION: {
    DEFAULT_TIMEOUT: 300000, // 5 minutes
    MAX_PARALLEL_STEPS: 10,
    MAX_WORKFLOW_DURATION: 3600000, // 1 hour
  },

  /** Retry defaults */
  RETRY: {
    DEFAULT_MAX_ATTEMPTS: 3,
    DEFAULT_INITIAL_DELAY: 1000, // 1 second
    DEFAULT_BACKOFF_MULTIPLIER: 2,
    DEFAULT_MAX_DELAY: 30000, // 30 seconds
  },

  /** Loop limits */
  LOOP: {
    DEFAULT_MAX_ITERATIONS: 100,
    SAFETY_MAX_ITERATIONS: 1000,
  },

  /** Wait limits */
  WAIT: {
    DEFAULT_TIMEOUT: 60000, // 1 minute
    MAX_WAIT_DURATION: 3600000, // 1 hour
  },

  /** Step types */
  STEP_TYPES: {
    TOOL_EXECUTION: 'tool_execution',
    LLM_CALL: 'llm_call',
    DECISION: 'decision',
    LOOP: 'loop',
    PARALLEL: 'parallel',
    SUBPROCESS: 'subprocess',
    WAIT: 'wait',
    VALIDATION: 'validation',
    CUSTOM: 'custom',
  } as const,

  /** Workflow statuses */
  STATUSES: {
    PENDING: 'pending',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  } as const,
} as const;

/**
 * Memory Strata Constants
 */
export const MEMORY_STRATA_CONSTANTS = {
  /** Stratum names */
  STRATA: {
    WORKING: 'working',
    SHORT_TERM: 'short_term',
    LONG_TERM: 'long_term',
    EPISODIC: 'episodic',
    SEMANTIC: 'semantic',
  } as const,

  /** Default stratum configurations */
  DEFAULTS: {
    WORKING: {
      MAX_ENTRIES: 100,
      TTL: 3600000, // 1 hour
    },
    SHORT_TERM: {
      MAX_ENTRIES: 500,
      TTL: 86400000, // 24 hours
      CONSOLIDATION_THRESHOLD: 50,
    },
    LONG_TERM: {
      MAX_ENTRIES_PER_AGENT: 10000,
      MIN_IMPORTANCE: 3, // Medium importance
      ARCHIVAL_AGE: 2592000000, // 30 days
    },
    EPISODIC: {
      MAX_EPISODES_PER_AGENT: 1000,
      EPISODE_DURATION: 3600000, // 1 hour
    },
    SEMANTIC: {
      MAX_CONCEPTS_PER_AGENT: 5000,
      MIN_CONFIDENCE: 0.7,
    },
  },

  /** Surprise detection */
  SURPRISE: {
    DEFAULT_THRESHOLD: 0.7, // Surprise score threshold
    ANALYSIS_WINDOW: 100, // Recent memories to analyze
    TYPES: {
      SCHEMA_VIOLATION: 'schema_violation',
      PREDICTION_FAILURE: 'prediction_failure',
      ANOMALY: 'anomaly',
      NOVEL_PATTERN: 'novel_pattern',
      CONTEXT_MISMATCH: 'context_mismatch',
      PERFORMANCE_DEVIATION: 'performance_deviation',
      UNEXPECTED_ERROR: 'unexpected_error',
      UNEXPECTED_SUCCESS: 'unexpected_success',
    } as const,
  },

  /** Consolidation */
  CONSOLIDATION: {
    INTERVAL: 3600000, // 1 hour
    SIMILARITY_THRESHOLD: 0.8,
    TYPES: {
      MERGE: 'merge',
      SUMMARIZE: 'summarize',
      ABSTRACT: 'abstract',
      PROMOTE: 'promote',
      DEMOTE: 'demote',
      ARCHIVE: 'archive',
    } as const,
  },

  /** Pattern detection */
  PATTERNS: {
    MIN_LENGTH: 3, // Minimum pattern elements
    MIN_CONFIDENCE: 0.6,
    ANALYSIS_INTERVAL: 7200000, // 2 hours
  },

  /** Importance levels */
  IMPORTANCE: {
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    TRIVIAL: 1,
  } as const,
} as const;

/**
 * Decentralization Constants
 */
export const DECENTRALIZATION_CONSTANTS = {
  /** Network defaults */
  NETWORK: {
    DEFAULT_PORT: 7000,
    MAX_CONNECTIONS: 50,
    MAX_MESSAGE_SIZE: 1048576, // 1 MB
  },

  /** Discovery defaults */
  DISCOVERY: {
    INTERVAL: 60000, // 1 minute
    METHODS: {
      BOOTSTRAP: 'bootstrap',
      MULTICAST: 'multicast',
      DNS: 'dns',
      TRACKER: 'tracker',
      GOSSIP: 'gossip',
      MANUAL: 'manual',
    } as const,
  },

  /** Gossip protocol */
  GOSSIP: {
    INTERVAL: 5000, // 5 seconds
    FANOUT: 3, // Peers per round
    MAX_HOPS: 7,
    MESSAGE_TTL: 300000, // 5 minutes
    TYPES: {
      PEER_LIST: 'peer_list',
      STATE_UPDATE: 'state_update',
      EVENT: 'event',
      RUMOR: 'rumor',
      ALERT: 'alert',
      HEARTBEAT: 'heartbeat',
    } as const,
  },

  /** DHT (Distributed Hash Table) */
  DHT: {
    REPLICATION_FACTOR: 3,
    BUCKET_SIZE: 20, // k-buckets
    REFRESH_INTERVAL: 3600000, // 1 hour
  },

  /** Routing */
  ROUTING: {
    UPDATE_INTERVAL: 30000, // 30 seconds
    ROUTE_TIMEOUT: 300000, // 5 minutes
    ALGORITHMS: {
      FLOODING: 'flooding',
      DISTANCE_VECTOR: 'distance_vector',
      LINK_STATE: 'link_state',
      DHT_BASED: 'dht_based',
    } as const,
  },

  /** Consensus */
  CONSENSUS: {
    QUORUM_SIZE: 0.67, // 67% agreement
    PROPOSAL_TIMEOUT: 30000, // 30 seconds
    PROTOCOLS: {
      RAFT: 'raft',
      PAXOS: 'paxos',
      PBFT: 'pbft',
      GOSSIP_BASED: 'gossip_based',
      CRDT: 'crdt',
    } as const,
  },

  /** Health monitoring */
  HEALTH: {
    PING_INTERVAL: 10000, // 10 seconds
    PING_TIMEOUT: 5000, // 5 seconds
    UNHEALTHY_THRESHOLD: 3, // Failed pings
    BAN_DURATION: 3600000, // 1 hour
  },

  /** Security */
  SECURITY: {
    MIN_REPUTATION: 0.5,
    TRUST_MODELS: {
      FULL_TRUST: 'full_trust',
      WEB_OF_TRUST: 'web_of_trust',
      REPUTATION_BASED: 'reputation_based',
    } as const,
  },

  /** Message priorities */
  MESSAGE_PRIORITY: {
    CRITICAL: 5,
    HIGH: 4,
    NORMAL: 3,
    LOW: 2,
    BACKGROUND: 1,
  } as const,

  /** Peer statuses */
  PEER_STATUS: {
    CONNECTED: 'connected',
    CONNECTING: 'connecting',
    DISCONNECTED: 'disconnected',
    ERROR: 'error',
    BANNED: 'banned',
  } as const,
} as const;

/**
 * Event names for new features
 */
export const ENHANCEMENT_EVENTS = {
  /** LSP events */
  LSP: {
    SERVER_STARTED: 'lsp:server:started',
    SERVER_STOPPED: 'lsp:server:stopped',
    SERVER_ERROR: 'lsp:server:error',
    SERVER_HEALTH_CHECK: 'lsp:server:health_check',
    DOCUMENT_OPENED: 'lsp:document:opened',
    DOCUMENT_CLOSED: 'lsp:document:closed',
    OPERATION_COMPLETED: 'lsp:operation:completed',
    OPERATION_FAILED: 'lsp:operation:failed',
  },

  /** Workflow events */
  WORKFLOW: {
    CREATED: 'workflow:created',
    STARTED: 'workflow:started',
    STEP_STARTED: 'workflow:step:started',
    STEP_COMPLETED: 'workflow:step:completed',
    STEP_FAILED: 'workflow:step:failed',
    PAUSED: 'workflow:paused',
    RESUMED: 'workflow:resumed',
    COMPLETED: 'workflow:completed',
    FAILED: 'workflow:failed',
    CANCELLED: 'workflow:cancelled',
  },

  /** Memory Strata events */
  MEMORY_STRATA: {
    ENTRY_CREATED: 'memory:entry:created',
    ENTRY_ACCESSED: 'memory:entry:accessed',
    ENTRY_EXPIRED: 'memory:entry:expired',
    SURPRISE_DETECTED: 'memory:surprise:detected',
    CONSOLIDATION_STARTED: 'memory:consolidation:started',
    CONSOLIDATION_COMPLETED: 'memory:consolidation:completed',
    PATTERN_DETECTED: 'memory:pattern:detected',
    TRANSITION: 'memory:transition',
  },

  /** Decentralization events */
  DECENTRALIZATION: {
    PEER_CONNECTED: 'p2p:peer:connected',
    PEER_DISCONNECTED: 'p2p:peer:disconnected',
    PEER_DISCOVERED: 'p2p:peer:discovered',
    MESSAGE_SENT: 'p2p:message:sent',
    MESSAGE_RECEIVED: 'p2p:message:received',
    GOSSIP_PROPAGATED: 'p2p:gossip:propagated',
    CONSENSUS_REACHED: 'p2p:consensus:reached',
    PARTITION_DETECTED: 'p2p:partition:detected',
    PARTITION_HEALED: 'p2p:partition:healed',
    REPUTATION_UPDATED: 'p2p:reputation:updated',
  },
} as const;
