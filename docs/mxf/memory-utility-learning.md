# Memory Utility Learning System (MULS)

## Overview

The Memory Utility Learning System (MULS) is an advanced memory retrieval system inspired by MemRL (Memory-augmented Reinforcement Learning). The core innovation: treat memory retrieval as a **decision problem** rather than pure similarity search.

Traditional semantic search ranks memories by similarity to the query. MULS extends this by tracking which memories actually lead to successful task outcomes using Q-values (quality values from reinforcement learning).

**Key Formula:** `score = (1-λ) × similarity_normalized + λ × Q_normalized`

Where:
- `λ` (lambda) controls the balance between similarity and utility
- `similarity_normalized` is the semantic similarity score (z-score normalized within candidates)
- `Q_normalized` is the Q-value (z-score normalized within candidates)

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Memory Utility Learning System                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐│
│  │  QValueManager  │   │ UtilityScorer   │   │ RewardSignal        ││
│  │                 │   │    Service      │   │   Processor         ││
│  │  - Q-value CRUD │   │ - Two-phase     │   │ - Task outcome      ││
│  │  - EMA updates  │   │   retrieval     │   │   attribution       ││
│  │  - Normalization│   │ - Phase-specific│   │ - Reward mapping    ││
│  │  - LRU cache    │   │   lambda        │   │ - Event listeners   ││
│  └────────┬────────┘   └────────┬────────┘   └─────────┬───────────┘│
│           │                     │                      │             │
│           └──────────┬──────────┴──────────────────────┘             │
│                      │                                               │
│              ┌───────▼───────┐                                       │
│              │MemoryService  │                                       │
│              │ Integration   │                                       │
│              └───────────────┘                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Memory Creation**: New memories get default Q-value (0.5)
2. **Retrieval Request**: Agent queries with optional ORPAR phase
3. **Phase A - Similarity Filter**: Meilisearch returns top-k1 candidates above threshold
4. **Phase B - Utility Scoring**: Composite score computed, top-k2 returned
5. **Task Execution**: Memories used during task are tracked
6. **Task Completion**: Reward attributed to all tracked memories
7. **Q-Value Update**: EMA formula updates Q-values

## Two-Phase Retrieval

### Phase A: Similarity Filtering

First, semantic search produces initial candidates:
1. Query sent to Meilisearch with semantic/keyword hybrid search
2. Filter results by minimum similarity threshold (default: 0.3)
3. Take top k1 candidates (default: 20) sorted by similarity

### Phase B: Utility Scoring

Then, composite scoring ranks final results:
1. Fetch Q-values for all candidates
2. Z-score normalize both similarity and Q-values within the candidate pool
3. Apply composite formula: `score = (1-λ) × sim_norm + λ × Q_norm`
4. Return top k2 results (default: 5) sorted by final score

## ORPAR Phase-Specific Lambda

Different ORPAR phases have different retrieval needs:

| Phase | Lambda | Rationale |
|-------|--------|-----------|
| **OBSERVATION** | 0.2 | Prioritize semantic accuracy for gathering context |
| **REASONING** | 0.5 | Balance explore/exploit for analysis |
| **PLANNING** | 0.7 | Exploit proven patterns for strategy |
| **ACTION** | 0.3 | Stay grounded for tool execution |
| **REFLECTION** | 0.6 | Favor memories that led to good assessments |

## Q-Value Updates

Q-values are updated using Exponential Moving Average (EMA):

```
Q_new = Q_old + α × (reward - Q_old)
```

Where:
- `α` (alpha) is the learning rate (default: 0.1)
- `reward` is the task outcome reward (see below)

### Reward Mapping

| Task Outcome | Default Reward |
|--------------|----------------|
| **success** | +1.0 |
| **failure** | -1.0 |
| **partial** | +0.3 |
| **timeout** | -0.5 |

If a task has a quality score (0-1), the reward is modulated: `reward × qualityScore`

## Configuration

### Environment Variables

```bash
# Enable/disable MULS
MEMORY_UTILITY_LEARNING_ENABLED=false

# Q-value settings
QVALUE_DEFAULT=0.5
QVALUE_LEARNING_RATE=0.1

# Default lambda (when phase not specified)
RETRIEVAL_LAMBDA_DEFAULT=0.5

# Phase-specific lambdas
RETRIEVAL_LAMBDA_OBSERVATION=0.2
RETRIEVAL_LAMBDA_REASONING=0.5
RETRIEVAL_LAMBDA_PLANNING=0.7
RETRIEVAL_LAMBDA_ACTION=0.3
RETRIEVAL_LAMBDA_REFLECTION=0.6
```

### Programmatic Configuration

```typescript
import { QValueManager } from '@mxf/shared/services/QValueManager';
import { UtilityScorerService } from '@mxf/shared/services/UtilityScorerService';
import { RewardSignalProcessor } from '@mxf/shared/services/RewardSignalProcessor';

// Initialize with custom config
QValueManager.getInstance().initialize({
    enabled: true,
    defaultQValue: 0.5,
    learningRate: 0.1
});

UtilityScorerService.getInstance().initialize({
    enabled: true,
    lambda: 0.5,
    phaseLambdas: {
        observation: 0.2,
        reasoning: 0.5,
        planning: 0.7,
        action: 0.3,
        reflection: 0.6
    }
});

RewardSignalProcessor.getInstance().initialize({
    enabled: true,
    rewardMapping: {
        success: 1.0,
        failure: -1.0,
        partial: 0.3,
        timeout: -0.5
    }
});
```

## MCP Tools

MULS provides three MCP tools for agent interaction:

### memory_qvalue_analytics

View Q-value distributions, top-performing memories, and convergence metrics.

```json
{
    "name": "memory_qvalue_analytics",
    "input": {
        "agentId": "optional-agent-id",
        "topN": 10,
        "includeHistory": false
    }
}
```

### memory_utility_config

Get or set MULS configuration including lambda values.

```json
{
    "name": "memory_utility_config",
    "input": {
        "action": "set",
        "lambda": 0.6,
        "phaseLambdas": {
            "planning": 0.8
        }
    }
}
```

### memory_inject_reward

Manually inject a reward signal for explicit memory feedback.

```json
{
    "name": "memory_inject_reward",
    "input": {
        "memoryId": "mem-abc123",
        "reward": 0.8,
        "reason": "This memory was particularly helpful"
    }
}
```

## Memory Schema Extension

MULS adds a `utility` subdocument to memory schemas:

```typescript
utility: {
    qValue: number;              // Current Q-value (0-1, default 0.5)
    qValueHistory: [{            // History for convergence analysis
        value: number;
        reward: number;
        timestamp: Date;
        taskId?: string;
        phase?: OrparPhase;
    }];
    retrievalCount: number;      // Times retrieved
    successCount: number;        // Successful task uses
    failureCount: number;        // Failed task uses
    lastRewardAt: Date;          // Last reward update
    initializedFrom: string;     // 'default' | 'surprise' | 'transfer' | 'manual'
}
```

## Integration with RetentionGateService

MULS integrates with the RetentionGateService for adaptive memory decay:

```
effectiveDecay = baseDecay × (1 - normalizedQ × utilityFactor)
```

High-Q memories (proven useful) decay slower, while low-Q memories decay faster. This ensures valuable memories are retained while less useful ones are pruned during capacity management.

## Migration

For existing deployments, run the MULS migration:

```bash
# Apply migration
npx ts-node src/migrations/2026.01.MULS.ts up

# Rollback if needed
npx ts-node src/migrations/2026.01.MULS.ts down
```

The migration:
1. Adds `utility` subdocument to existing memories with default values
2. Creates indexes on `utility.qValue` for efficient queries
3. Creates compound indexes for scoped queries (agentId + qValue, channelId + qValue)

## Best Practices

### 1. Start with MULS Disabled

Enable MULS only after understanding baseline retrieval performance. Compare retrieval quality with and without MULS to measure improvement.

### 2. Monitor Convergence

Use `memory_qvalue_analytics` to track:
- Q-value distribution (mean, stddev)
- Number of stable memories (converged)
- Top performers vs. bottom performers

### 3. Tune Lambda Per Use Case

- **Exploratory tasks**: Lower lambda (0.2-0.4) to discover new relevant content
- **Routine tasks**: Higher lambda (0.6-0.8) to exploit proven patterns
- **Critical tasks**: Moderate lambda (0.4-0.6) for balance

### 4. Use Phase-Specific Lambda

Let ORPAR phases guide retrieval strategy automatically. The default phase lambdas are tuned for typical cognitive workflows.

### 5. Provide Explicit Feedback

When agents notice particularly helpful or unhelpful memories, use `memory_inject_reward` for immediate feedback rather than waiting for task completion.

## Events

MULS emits the following events for monitoring and analytics:

| Event | Description |
|-------|-------------|
| `memory:qvalue_updated` | Single Q-value update |
| `memory:qvalue_batch_updated` | Batch Q-value updates |
| `memory:utility_retrieval_completed` | Utility-based retrieval finished |
| `memory:reward_attributed` | Rewards attributed to memories |
| `memory:tracked` | Memory usage tracked for task |
| `memory:utility_config_updated` | Configuration changed |

## Troubleshooting

### Q-Values Not Updating

1. Check `MEMORY_UTILITY_LEARNING_ENABLED=true`
2. Verify task completion events are being emitted
3. Check memory tracking is active (`trackMemoryUsage: true`)

### Poor Retrieval Quality

1. Lower lambda to rely more on similarity
2. Check similarity threshold isn't too aggressive
3. Verify Meilisearch is returning quality candidates

### Memory Running Out

1. MULS adds ~200 bytes per memory for utility subdocument
2. Limit Q-value history with `qValueHistoryLimit` config
3. Use migration down to remove utility data if needed

## ORPAR Integration

MULS integrates with ORPAR through the PhaseWeightedRewarder and PhaseStrataRouter. See [ORPAR-Memory Integration](orpar-memory-integration.md) for:

- Phase-specific lambda values for retrieval
- Q-value attribution by ORPAR phase
- Consolidation triggers based on cycle outcomes
- Surprise-driven re-observation

## Future Enhancements

Planned improvements:
- **Transfer Learning**: Initialize Q-values from similar memories
- **Surprise Integration**: Boost initial Q-values based on SERC surprise scores
- **Multi-Armed Bandit**: Exploration bonus for under-retrieved memories
- **Contextual Bandits**: Context-aware Q-values (different Q per context type)
