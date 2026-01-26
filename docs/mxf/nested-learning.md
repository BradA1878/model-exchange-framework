# Nested Learning / Continuum Memory System

The Nested Learning System implements multi-timescale memory management following Google's Nested Learning paradigm and Agent0-VL's Self-Evolving Reasoning Cycle (SERC), enabling agents to retain knowledge across multiple temporal horizons with intelligent consolidation and surprise-based encoding.

## Overview

Traditional agent memory systems treat all memories equally and lack mechanisms for consolidation across time scales. The Nested Learning System introduces a five-tier memory architecture where information flows from short-term working memory through progressively longer-term storage, with surprise detection and adaptive retention determining what persists.

### Key Innovations

- **Multi-Stratum Memory**: Five memory layers with different update frequencies and retention policies
- **Surprise-Based Encoding**: Titans-style surprise detection for high-value memory retention
- **SERC Orchestration**: Dual-loop reasoning with Solver/Verifier mode switching
- **Semantic Compression**: Intelligent consolidation when promoting between strata
- **Adaptive Retention**: MIRAS-inspired retention gates with process-level rewards
- **Tool-Grounded Verification**: Confidence scoring and self-repair protocols

## Architecture

### Memory Strata

The system implements five distinct memory layers, inspired by human memory systems:

#### 1. Working Memory
- **Purpose**: Immediate context for current reasoning cycle
- **Retention**: Single ORPAR cycle (~seconds to minutes)
- **Capacity**: Limited (current task context)
- **Update Frequency**: Every cycle
- **Use Cases**: Active task state, immediate observations

#### 2. Short-Term Memory
- **Purpose**: Recent history and ongoing conversations
- **Retention**: Session duration (~minutes to hours)
- **Capacity**: Moderate (recent interactions)
- **Update Frequency**: Per interaction
- **Use Cases**: Conversation continuity, recent decisions

#### 3. Episodic Memory
- **Purpose**: Specific events and experiences
- **Retention**: Days to weeks
- **Capacity**: Large (selective retention)
- **Update Frequency**: Significant events
- **Use Cases**: Notable interactions, key decisions, errors/successes

#### 4. Long-Term Memory
- **Purpose**: Persistent knowledge and patterns
- **Retention**: Weeks to months
- **Capacity**: Very large (compressed)
- **Update Frequency**: Periodic consolidation
- **Use Cases**: Learned strategies, user preferences, domain knowledge

#### 5. Semantic Memory
- **Purpose**: Facts, concepts, and abstractions
- **Retention**: Indefinite (until explicitly purged)
- **Capacity**: Unlimited (highly compressed)
- **Update Frequency**: Major learning events
- **Use Cases**: Core knowledge, relationships, principles

### Core Components

#### 1. StratumManager
Manages multi-tier memory storage with different update frequencies per stratum.

**Responsibilities:**
- Memory entry creation and retrieval
- Stratum-based indexing and querying
- Cross-stratum memory promotion
- Importance-based filtering

**Key Operations:**
```typescript
// Store memory in appropriate stratum
await stratumManager.store(entry, MemoryStratum.Working);

// Retrieve memories from specific stratum
const memories = await stratumManager.retrieve(
  MemoryStratum.Episodic,
  { tags: ['success'], importance: MemoryImportance.High }
);

// Promote memory to higher stratum
await stratumManager.promote(memoryId, MemoryStratum.LongTerm);
```

#### 2. SurpriseCalculator
Implements Titans-style surprise detection with momentum tracking for contextual continuity.

**Surprise Metrics:**
- **Expectation Violation**: Deviation from predicted outcomes
- **Novelty Detection**: Presence of unfamiliar patterns
- **Importance Amplification**: Multiplication of base importance by surprise factor
- **Momentum Tracking**: Context-aware surprise normalization

**Formula:**
```
surprise = |expected - actual| / (momentum + epsilon)
retention_score = base_importance * (1 + surprise_factor)
```

**Key Features:**
- Adapts to agent's experience level
- Contextual surprise (considers recent history)
- Surprise decay over time (novelty wears off)
- Cross-agent surprise sharing (channel-level calibration)

#### 3. MemoryCompressor
Performs semantic compression when promoting memories between strata.

**Compression Strategies:**
- **Semantic Clustering**: Group related memories
- **Abstraction Generation**: Extract common patterns
- **Detail Reduction**: Preserve key information, discard noise
- **Link Creation**: Maintain relationships between compressed memories

**Compression Levels:**
- Working → ShortTerm: Minimal (preserve detail)
- ShortTerm → Episodic: Moderate (summarize)
- Episodic → LongTerm: High (extract patterns)
- LongTerm → Semantic: Maximum (abstract concepts)

#### 4. RetentionGateService
MIRAS-inspired adaptive weight decay and retention gates.

**Retention Policies:**
- **Access-Based**: Frequently accessed memories persisted longer
- **Importance-Based**: High-importance memories have lower decay rates
- **Surprise-Based**: Surprising memories bypass normal decay
- **Process Rewards**: Successful outcomes boost retention

**Decay Models:**
```typescript
// Exponential decay with adaptive rate
retention_weight = initial_weight * exp(-decay_rate * time_elapsed)

// Decay rate adjusted by importance and access frequency
decay_rate = base_rate / (1 + importance + log(1 + access_count))
```

**Retention Gates:**
- Automatic promotion on high retention scores
- Automatic demotion on low retention scores
- Periodic cleanup of expired memories
- Emergency purge on capacity limits

#### 5. SERCOrchestrator
Dual-loop reasoning: inner loop (per-cycle ORPAR), outer loop (cross-cycle consolidation) with Solver/Verifier mode switching.

**Inner Loop (ORPAR Cycle):**
1. **Observe**: Gather current context from Working memory
2. **Reason**: Analyze with ShortTerm and Episodic context
3. **Plan**: Strategy formation with LongTerm patterns
4. **Act**: Execute with tool-grounded verification
5. **Reflect**: Update memories based on outcomes

**Outer Loop (Consolidation):**
1. **Pattern Detection**: Identify recurring themes across cycles
2. **Memory Promotion**: Move important memories up strata
3. **Compression**: Apply semantic compression to promoted memories
4. **Relationship Mapping**: Link related memories across strata
5. **Performance Analysis**: Evaluate reasoning effectiveness

**Solver/Verifier Modes:**

**Solver Mode** (default):
- Generates solutions to problems
- Explores possibilities
- Creates new memories
- High creativity temperature

**Verifier Mode** (triggered by errors):
- Validates reasoning steps
- Checks tool outputs
- Issues PATCH instructions
- Low temperature, high precision

**Mode Switching:**
```
Success → Solver Mode (continue exploration)
Failure → Verifier Mode (check reasoning)
Repeated Failure → Self-Repair Protocol
Recovery → Solver Mode (resume)
```

## SERC Features

### Tool-Grounded Verification
All reasoning steps are validated through tool execution with confidence scoring.

**Confidence Metrics:**
- Tool execution success rate
- Output consistency across retries
- Alignment with expected patterns
- Historical accuracy of similar reasoning

**Verification Process:**
1. Execute reasoning step
2. Verify output with tools
3. Calculate confidence score
4. If low confidence → Verifier mode
5. Store confidence with memory

### Self-Repair Protocol
When reasoning fails, SERC issues PATCH instructions to correct errors.

**PATCH Components:**
- **Problem Identification**: What went wrong
- **Root Cause Analysis**: Why it went wrong
- **Correction Strategy**: How to fix it
- **Verification Plan**: How to confirm fix

**Self-Repair Flow:**
```
Error Detection
  ↓
Enter Verifier Mode
  ↓
Analyze Failure
  ↓
Generate PATCH
  ↓
Apply Correction
  ↓
Verify Fix
  ↓
Update Memory (Episodic + LongTerm)
  ↓
Resume Solver Mode
```

### Process-Level Rewards
Memory promotion decisions are influenced by task outcomes.

**Reward Signals:**
- Task completion success
- Tool execution accuracy
- User feedback
- Efficiency metrics

**Reward Integration:**
```typescript
// Successful task completion
if (taskSuccessful) {
  // Boost retention of memories used in task
  await retentionGateService.applyReward(relevantMemories, 1.5);

  // Promote key memories to higher strata
  await stratumManager.promoteSuccessful(relevantMemories);
}
```

### Memory Utility Learning System (MULS)

MULS extends process-level rewards with Q-value based utility tracking. Each memory is assigned a Q-value (0.0 to 1.0) that reflects how useful that memory has been for task completion. Memories with higher Q-values are prioritized during retrieval.

**Key Features:**
- **Automatic Q-Value Registration**: Memories auto-register with QValueManager on write when MULS is enabled
- **EMA Updates**: Q-values update using exponential moving average: `Q_new = Q_old + α(reward - Q_old)`
- **ORPAR Phase-Specific Weights**: Different lambda values for observation, reasoning, planning, action, and reflection phases
- **Utility-Based Retrieval**: Score formula combines similarity with utility: `score = (1-λ) × similarity + λ × Q_normalized`

**Configuration:**
```bash
# Enable MULS
MEMORY_UTILITY_LEARNING_ENABLED=true

# Q-value settings
QVALUE_DEFAULT=0.5
QVALUE_LEARNING_RATE=0.1

# Phase-specific lambda weights (utility vs similarity)
RETRIEVAL_LAMBDA_OBSERVATION=0.2   # Favor similarity for gathering context
RETRIEVAL_LAMBDA_REASONING=0.5     # Balanced
RETRIEVAL_LAMBDA_PLANNING=0.7      # Favor proven useful memories
RETRIEVAL_LAMBDA_ACTION=0.3        # Favor similarity for tool execution
RETRIEVAL_LAMBDA_REFLECTION=0.6    # Favor memories that led to success
```

**MULS Tools:**
- `memory_qvalue_analytics` - View Q-value statistics and distributions
- `memory_inject_reward` - Manually inject reward signal for a memory
- `memory_utility_config` - View/update MULS configuration

**Example: Manual Reward Injection:**
```typescript
// Reward a memory that was particularly useful
await toolExecutor.execute('memory_inject_reward', {
  memoryId: 'mem-abc123',
  reward: 0.8,      // Positive reward (range: -1 to 1)
  reason: 'Memory helped complete task successfully'
});
```

### Surprise-Based Encoding
High-surprise events are automatically encoded with elevated importance.

**Encoding Process:**
1. Calculate surprise score
2. Multiply base importance
3. Tag with surprise metadata
4. Immediate promotion to Episodic
5. Cross-agent sharing (if channel-level)

## MongoDB Schema

### MemoryEntry Collection

```typescript
{
  id: string,
  stratum: 'working' | 'short_term' | 'episodic' | 'long_term' | 'semantic',
  content: string,
  contentType: 'text' | 'structured' | 'embedding',
  structuredData?: object,
  embedding?: number[],
  importance: 1-5,
  tags: string[],
  source: {
    type: string,
    agentId?: string,
    channelId?: string,
    eventId?: string
  },
  context: {
    agentId: string,
    channelId?: string,
    taskId?: string,
    orparPhase?: string
  },
  accessCount: number,
  lastAccessed: Date,
  createdAt: Date,
  expiresAt?: Date,
  relatedMemories: string[],
  metadata?: object
}
```

**Indexes:**
- `{ stratum: 1, agentId: 1, createdAt: -1 }` - Stratum queries
- `{ tags: 1, importance: 1 }` - Tag-based retrieval
- `{ importance: 1, lastAccessed: -1 }` - Retention gate queries
- `{ expiresAt: 1 }` - TTL cleanup

### SurpriseHistory Collection

```typescript
{
  id: string,
  agentId: string,
  channelId?: string,
  surpriseScore: number,
  expectedOutcome: object,
  actualOutcome: object,
  context: object,
  memoryId: string,
  timestamp: Date,
  expiresAt: Date // TTL index for analytics cleanup
}
```

**TTL**: 90 days (configurable via `SURPRISE_HISTORY_TTL_DAYS`)

### MemoryPattern Collection

```typescript
{
  id: string,
  patternType: string,
  description: string,
  frequency: number,
  confidence: number,
  relatedMemories: string[],
  context: object,
  createdAt: Date,
  updatedAt: Date
}
```

**Purpose**: Cross-agent pattern sharing within channels

### Memory Cleanup Behavior

When deleting agent memory (e.g., via `agent_memory_delete`), the system performs comprehensive cleanup across all memory collections:

1. **AgentMemory** - Base agent memory collection
2. **MemoryEntryModel** - Strata memory entries
3. **SurpriseHistoryModel** - Surprise detection history
4. **MemoryPatternModel** - Learned patterns
5. **RelationshipMemory** - Both sides of agent relationships

This ensures no orphaned data remains when an agent's memory is cleared.

## Feature Flags

### MEMORY_STRATA_ENABLED
Enable/disable entire nested learning system.

```bash
# Enable nested learning
MEMORY_STRATA_ENABLED=true

# If disabled, falls back to standard MXF memory system
```

### SERC_ENABLED
Enable/disable SERC orchestration (requires MEMORY_STRATA_ENABLED).

```bash
# Enable SERC dual-loop reasoning
SERC_ENABLED=true

# If disabled, only basic stratum management is active
```

### Configuration Options

```bash
# Surprise detection threshold
SURPRISE_THRESHOLD=0.7

# Memory compression ratio
COMPRESSION_RATIO=0.5

# Retention gate check interval (seconds)
RETENTION_CHECK_INTERVAL=3600

# Automatic promotion threshold
AUTO_PROMOTION_THRESHOLD=0.8

# Cross-agent pattern sharing
ENABLE_PATTERN_SHARING=true
```

## Usage Examples

### Example 1: Storing Important Memory

```typescript
// Agent stores a critical learning
await stratumManager.store({
  stratum: MemoryStratum.Episodic,
  content: 'User prefers detailed explanations',
  contentType: 'text',
  importance: MemoryImportance.High,
  tags: ['preference', 'communication'],
  source: {
    type: 'conversation',
    agentId: 'agent-1',
    channelId: 'support-channel'
  },
  context: {
    agentId: 'agent-1',
    orparPhase: 'reflect'
  }
});
```

### Example 2: Retrieving Relevant Memories

```typescript
// Agent retrieves memories for current task
const relevantMemories = await stratumManager.retrieve(
  MemoryStratum.LongTerm,
  {
    tags: ['code-review', 'best-practices'],
    importance: MemoryImportance.Medium,
    minAccessCount: 3
  }
);
```

### Example 3: Surprise-Based Encoding

```typescript
// Calculate surprise score
const surpriseScore = await surpriseCalculator.calculate({
  expected: { status: 'success', duration: 100 },
  actual: { status: 'failure', duration: 500 },
  context: { task: 'api-call', agent: 'agent-1' }
});

// If surprise is high, automatically elevate importance
if (surpriseScore > 0.7) {
  await stratumManager.store({
    stratum: MemoryStratum.Episodic,
    content: 'Unexpected API failure pattern detected',
    importance: MemoryImportance.Critical,
    tags: ['error', 'api', 'surprise'],
    metadata: { surpriseScore }
  });
}
```

### Example 4: SERC Self-Repair

```typescript
// SERC detects reasoning failure
const patch = await sercOrchestrator.generatePatch({
  error: 'Tool execution failed: invalid parameter type',
  context: reasoningContext,
  attemptedAction: toolCall
});

// Apply patch
await sercOrchestrator.applyPatch(patch);

// Verify fix
const verificationResult = await sercOrchestrator.verify(patch);

if (verificationResult.success) {
  // Store corrected reasoning in memory
  await stratumManager.store({
    stratum: MemoryStratum.LongTerm,
    content: `Learned: ${patch.correction}`,
    importance: MemoryImportance.High,
    tags: ['self-repair', 'learning']
  });
}
```

## Integration with ORPAR

The Nested Learning System enhances each ORPAR phase:

### Observation Phase
- Query Working and ShortTerm memories for immediate context
- Update Working memory with new observations
- Calculate surprise scores for unexpected observations

### Reasoning Phase
- Retrieve Episodic and LongTerm memories for relevant patterns
- Cross-reference Semantic memory for factual knowledge
- Tool-grounded verification of reasoning steps

### Planning Phase
- Access LongTerm memory for successful strategies
- Retrieve similar past scenarios from Episodic memory
- Apply learned patterns from Semantic memory

### Action Phase
- Execute with confidence scoring
- Real-time verification of action outcomes
- Immediate feedback for surprise calculation

### Reflection Phase
- Consolidate Working memory into ShortTerm
- Promote important memories to higher strata
- Update retention weights based on outcomes
- Trigger self-repair if errors detected

## Performance Considerations

### Memory Overhead
- Working: ~1-10 MB per agent (active context)
- ShortTerm: ~10-100 MB per agent (session history)
- Episodic: ~100 MB - 1 GB per agent (selective storage)
- LongTerm: ~1-10 GB per agent (compressed)
- Semantic: ~10-100 GB system-wide (shared knowledge)

### Query Performance
- Working/ShortTerm: O(1) - in-memory cache
- Episodic: O(log n) - indexed MongoDB queries
- LongTerm: O(log n) - indexed with embedding search
- Semantic: O(log n) - heavily indexed

### Consolidation Overhead
- Surprise calculation: ~1-5ms per event
- Memory compression: ~10-50ms per memory
- Retention gate evaluation: ~100-500ms per batch
- SERC outer loop: ~1-5 seconds per consolidation

### Optimization Strategies
1. **Batch Processing**: Consolidate memories in batches
2. **Lazy Loading**: Load memories on-demand
3. **Embedding Caching**: Cache embeddings for frequent queries
4. **Async Consolidation**: Run outer loop in background
5. **Selective Indexing**: Index only frequently-queried fields

## Limitations & Future Enhancements

### Current Limitations
- Single-agent focus (limited cross-agent sharing)
- Fixed stratum count (no dynamic adaptation)
- Manual surprise threshold tuning
- MongoDB-only persistence
- No distributed memory architecture

### Planned Enhancements
- **Multi-Agent Memory Sharing**: Channel-wide semantic memory
- **Dynamic Stratum Creation**: Automatic stratum adaptation
- **Learned Surprise Models**: ML-based surprise prediction
- **Distributed Memory**: Redis + MongoDB hybrid architecture
- **Memory Visualization**: Dashboard for memory exploration

## Research References

### Core Papers & Systems

**Nested Learning (Google):**
- Blog: https://research.google/blog/introducing-nested-learning/
- Hierarchical learning across time scales
- Multi-resolution memory management

**Titans (Memory Architecture):**
- Paper: https://arxiv.org/abs/2501.00663
- Surprise-based memory encoding
- Momentum tracking for context

**MIRAS (Adaptive Retention):**
- Paper: https://arxiv.org/pdf/2504.13173
- Adaptive weight decay
- Process-level rewards

**Agent0-VL (SERC):**
- Repository: https://github.com/aiming-lab/Agent0
- Self-Evolving Reasoning Cycle
- Solver/Verifier mode switching
- Tool-grounded verification
- Self-repair protocols

## ORPAR-Memory Integration

The Nested Learning System integrates with ORPAR through the ORPAR-Memory Integration layer. See [ORPAR-Memory Integration](orpar-memory-integration.md) for details on:

- Phase-specific memory strata routing
- Surprise-driven re-observation triggers
- Phase-weighted Q-value attribution
- Cycle consolidation triggers

## Related Documentation

- **[ORPAR Loop](orpar.md)** - Control loop integration
- **[ORPAR-Memory Integration](orpar-memory-integration.md)** - Phase-aware memory coupling
- **[Memory Utility Learning (MULS)](memory-utility-learning.md)** - Q-value based retrieval
- **[Memory API](../api/memory.md)** - Memory system API
- **[System Overview](system-overview.md)** - MXF architecture
- **[Validation System](validation-system.md)** - Error handling
- **MULS Demo** - See `examples/muls-demo/` for a working demonstration of Memory Utility Learning

---

For questions or contributions related to the Nested Learning System, please refer to the [GitHub repository](https://github.com/BradA1878/model-exchange-framework).
