/**
 * Memory Strata Types for MXF
 *
 * Type definitions for multi-layered memory architecture with surprise detection.
 * Feature flag: MEMORY_STRATA_ENABLED
 */

/**
 * Memory layer/stratum level
 */
export enum MemoryStratum {
  /** Working memory (immediate context) */
  Working = 'working',
  /** Short-term memory (recent history) */
  ShortTerm = 'short_term',
  /** Long-term memory (persistent knowledge) */
  LongTerm = 'long_term',
  /** Episodic memory (specific events) */
  Episodic = 'episodic',
  /** Semantic memory (facts and concepts) */
  Semantic = 'semantic',
}

/**
 * Memory importance level
 */
export enum MemoryImportance {
  Critical = 5,
  High = 4,
  Medium = 3,
  Low = 2,
  Trivial = 1,
}

/**
 * Memory entry
 */
export interface MemoryEntry {
  /** Unique entry ID */
  id: string;
  /** Memory stratum */
  stratum: MemoryStratum;
  /** Entry content */
  content: string;
  /** Content type */
  contentType: 'text' | 'structured' | 'embedding';
  /** Structured data (if contentType is structured) */
  structuredData?: Record<string, unknown>;
  /** Embedding vector (if contentType is embedding) */
  embedding?: number[];
  /** Importance level */
  importance: MemoryImportance;
  /** Related tags */
  tags: string[];
  /** Source of memory */
  source: MemorySource;
  /** Context when memory was created */
  context: MemoryContext;
  /** Access count */
  accessCount: number;
  /** Last accessed timestamp */
  lastAccessed: Date;
  /** Created timestamp */
  createdAt: Date;
  /** Expiration timestamp (optional) */
  expiresAt?: Date;
  /** Links to related memories */
  relatedMemories: string[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Memory source
 */
export interface MemorySource {
  /** Source type */
  type: 'conversation' | 'observation' | 'reasoning' | 'reflection' | 'learning' | 'external';
  /** Source agent ID */
  agentId?: string;
  /** Source channel ID */
  channelId?: string;
  /** Source event ID */
  eventId?: string;
  /** Additional source data */
  data?: Record<string, unknown>;
}

/**
 * Memory context
 */
export interface MemoryContext {
  /** Agent ID */
  agentId: string;
  /** Channel ID */
  channelId?: string;
  /** Task ID */
  taskId?: string;
  /** ORPAR phase */
  orparPhase?: 'observe' | 'reason' | 'plan' | 'act' | 'reflect';
  /** Timestamp */
  timestamp: Date;
  /** Additional context data */
  data?: Record<string, unknown>;
}

/**
 * Surprise detection result
 */
export interface SurpriseDetection {
  /** Is this surprising? */
  isSurprising: boolean;
  /** Surprise score (0-1) */
  surpriseScore: number;
  /** Surprise type */
  type?: SurpriseType;
  /** Explanation of why it's surprising */
  explanation?: string;
  /** Expectation that was violated */
  expectation?: MemoryExpectation;
  /** Actual observation */
  observation: string;
  /** Suggested actions */
  suggestedActions?: string[];
}

/**
 * Surprise type
 */
export type SurpriseType =
  | 'schema_violation'      // Violates known schema/pattern
  | 'prediction_failure'    // Prediction was wrong
  | 'anomaly'              // Statistical anomaly
  | 'novel_pattern'        // New pattern detected
  | 'context_mismatch'     // Context doesn't match expectations
  | 'performance_deviation' // Performance differs from baseline
  | 'unexpected_error'     // Unexpected error occurred
  | 'unexpected_success';  // Unexpected success occurred

/**
 * Memory expectation
 */
export interface MemoryExpectation {
  /** Expected value or pattern */
  expected: unknown;
  /** Confidence in expectation (0-1) */
  confidence: number;
  /** Source of expectation */
  source: 'pattern' | 'rule' | 'learning' | 'prior';
  /** Related memory IDs */
  basedOn: string[];
}

/**
 * Memory consolidation result
 */
export interface MemoryConsolidation {
  /** Memories consolidated */
  consolidatedMemories: string[];
  /** New consolidated memory */
  newMemory: MemoryEntry;
  /** Consolidation type */
  type: ConsolidationType;
  /** Consolidation reason */
  reason: string;
}

/**
 * Consolidation type
 */
export type ConsolidationType =
  | 'merge'           // Merge similar memories
  | 'summarize'       // Summarize multiple memories
  | 'abstract'        // Abstract common pattern
  | 'promote'         // Promote to higher stratum
  | 'demote'          // Demote to lower stratum
  | 'archive';        // Archive old memories

/**
 * Memory retrieval query
 */
export interface MemoryQuery {
  /** Query text */
  query: string;
  /** Strata to search */
  strata?: MemoryStratum[];
  /** Minimum importance */
  minImportance?: MemoryImportance;
  /** Tags filter */
  tags?: string[];
  /** Context filter */
  context?: Partial<MemoryContext>;
  /** Time range filter */
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  /** Maximum results */
  limit?: number;
  /** Include embeddings in results */
  includeEmbeddings?: boolean;
}

/**
 * Memory retrieval result
 */
export interface MemoryRetrievalResult {
  /** Retrieved memories */
  memories: MemoryEntry[];
  /** Total count (before limit) */
  totalCount: number;
  /** Retrieval scores (memory ID -> score) */
  scores: Map<string, number>;
  /** Query execution time (milliseconds) */
  executionTime: number;
}

/**
 * Memory pattern
 */
export interface MemoryPattern {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Pattern description */
  description?: string;
  /** Pattern type */
  type: 'sequential' | 'causal' | 'correlational' | 'structural';
  /** Pattern elements */
  elements: MemoryPatternElement[];
  /** Pattern confidence (0-1) */
  confidence: number;
  /** Supporting evidence (memory IDs) */
  evidence: string[];
  /** Times observed */
  observationCount: number;
  /** Last observed */
  lastObserved: Date;
  /** Created timestamp */
  createdAt: Date;
}

/**
 * Memory pattern element
 */
export interface MemoryPatternElement {
  /** Element position in pattern */
  position: number;
  /** Element description */
  description: string;
  /** Element constraints */
  constraints?: Record<string, unknown>;
  /** Temporal relation to previous element */
  temporalRelation?: 'before' | 'after' | 'during' | 'concurrent';
}

/**
 * Memory strata configuration
 */
export interface MemoryStrataConfig {
  /** Enable memory strata system */
  enabled: boolean;

  /** Working memory configuration */
  working: {
    /** Maximum entries */
    maxEntries: number;
    /** Time-to-live (milliseconds) */
    ttl: number;
  };

  /** Short-term memory configuration */
  shortTerm: {
    /** Maximum entries */
    maxEntries: number;
    /** Time-to-live (milliseconds) */
    ttl: number;
    /** Consolidation threshold */
    consolidationThreshold: number;
  };

  /** Long-term memory configuration */
  longTerm: {
    /** Maximum entries per agent */
    maxEntriesPerAgent: number;
    /** Minimum importance for storage */
    minImportance: MemoryImportance;
    /** Enable automatic archival */
    enableArchival: boolean;
    /** Archival age threshold (milliseconds) */
    archivalAge: number;
  };

  /** Episodic memory configuration */
  episodic: {
    /** Maximum episodes per agent */
    maxEpisodesPerAgent: number;
    /** Episode duration threshold (milliseconds) */
    episodeDuration: number;
  };

  /** Semantic memory configuration */
  semantic: {
    /** Maximum concepts per agent */
    maxConceptsPerAgent: number;
    /** Minimum confidence for storage */
    minConfidence: number;
  };

  /** Surprise detection */
  surprise: {
    /** Enable surprise detection */
    enabled: boolean;
    /** Surprise threshold (0-1) */
    threshold: number;
    /** Analysis window (number of recent memories) */
    analysisWindow: number;
  };

  /** Consolidation */
  consolidation: {
    /** Enable automatic consolidation */
    enabled: boolean;
    /** Consolidation interval (milliseconds) */
    interval: number;
    /** Similarity threshold for merging */
    similarityThreshold: number;
  };

  /** Pattern detection */
  patterns: {
    /** Enable pattern detection */
    enabled: boolean;
    /** Minimum pattern length */
    minLength: number;
    /** Minimum confidence */
    minConfidence: number;
    /** Analysis interval (milliseconds) */
    analysisInterval: number;
  };
}

/**
 * Memory statistics
 */
export interface MemoryStatistics {
  /** Total entries per stratum */
  entriesPerStratum: Record<MemoryStratum, number>;
  /** Total entries per importance */
  entriesPerImportance: Record<MemoryImportance, number>;
  /** Average access count */
  avgAccessCount: number;
  /** Most accessed memories */
  mostAccessed: string[];
  /** Recent surprises */
  recentSurprises: number;
  /** Detected patterns */
  detectedPatterns: number;
  /** Memory usage (bytes) */
  memoryUsage: number;
}

/**
 * Memory transition event
 */
export interface MemoryTransition {
  /** Memory ID */
  memoryId: string;
  /** Source stratum */
  fromStratum: MemoryStratum;
  /** Destination stratum */
  toStratum: MemoryStratum;
  /** Transition reason */
  reason: string;
  /** Transition timestamp */
  timestamp: Date;
}
