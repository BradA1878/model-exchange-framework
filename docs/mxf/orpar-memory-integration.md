# ORPAR-Memory Integration

The ORPAR-Memory Integration system tightly couples the ORPAR cognitive cycle with MXF's memory architecture, enabling phase-aware memory retrieval, surprise-driven re-observation, and Q-value reward attribution based on phase contributions.

## Overview

Traditional agent memory systems treat all cognitive phases equally. The ORPAR-Memory Integration introduces intelligent coupling where:

- **Different ORPAR phases access different memory strata** with optimized retrieval strategies
- **Surprise signals from memory** can trigger ORPAR behavior modifications
- **Q-value rewards are attributed** based on phase contribution to task success
- **Memory consolidation is triggered** by ORPAR cycle outcomes

### Key Innovations

- **Phase-Strata Routing**: Each ORPAR phase routes queries to optimal memory strata
- **Surprise-Driven Re-Observation**: High surprise triggers additional observation cycles
- **Phase-Weighted Rewards**: Q-values updated based on phase contribution weights
- **Cycle Consolidation**: ORPAR completion triggers memory promotion/demotion decisions

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 OrparMemoryCoordinator                          │
│  Central orchestration service connecting ORPAR and memory      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ PhaseStrataRouter│  │SurpriseOrpar     │  │PhaseWeighted  │  │
│  │                  │  │Adapter           │  │Rewarder       │  │
│  │ Maps phases to   │  │                  │  │               │  │
│  │ preferred strata │  │ Surprise→ORPAR   │  │ Phase-based   │  │
│  │ for retrieval    │  │ decisions        │  │ Q-value       │  │
│  └──────────────────┘  └──────────────────┘  └───────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │CycleConsolidation│  │PhaseMemory       │                     │
│  │Trigger           │  │Operations        │                     │
│  │                  │  │                  │                     │
│  │ ORPAR completion │  │ Unified store/   │                     │
│  │ → memory promote │  │ retrieve per     │                     │
│  └──────────────────┘  │ phase            │                     │
│                        └──────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. OrparMemoryCoordinator

Central orchestration service that connects ORPAR events with memory operations. It:

- Listens for ORPAR phase transitions
- Routes memory queries through PhaseStrataRouter
- Processes surprise signals through SurpriseOrparAdapter
- Triggers consolidation on cycle completion

#### 2. PhaseStrataRouter

Maps ORPAR phases to their optimal memory strata for retrieval:

| Phase | Primary Strata | Lambda | Purpose |
|-------|---------------|--------|---------|
| **OBSERVATION** | Working, Short-term | 0.2 | Recent context for gathering |
| **REASONING** | Episodic, Semantic | 0.5 | Patterns for analysis |
| **PLANNING** | Semantic, Long-term | 0.7 | Proven strategies |
| **ACTION** | Working, Short-term | 0.3 | Stay grounded |
| **REFLECTION** | All strata | 0.6 | Holistic review |

**Lambda values** control the balance between semantic similarity and Q-value utility in memory retrieval (see [MULS documentation](memory-utility-learning.md)).

#### 3. SurpriseOrparAdapter

Converts Titans-style surprise signals from the memory system into ORPAR behavior modifications:

| Surprise Level | Threshold | Action |
|----------------|-----------|--------|
| **High** | > 0.7 | Trigger 1-3 additional observation cycles |
| **Moderate** | 0.4 - 0.7 | Inject surprise context into reasoning |
| **Plan Surprise** | > 0.6 | Flag plan for reconsideration |

When high surprise is detected:
1. The adapter calculates how many extra observations are needed
2. ORPAR is signaled to return to the observation phase
3. Additional context is gathered before proceeding

#### 4. PhaseWeightedRewarder

Attributes Q-value rewards based on each phase's contribution to task outcomes:

| Phase | Weight | Rationale |
|-------|--------|-----------|
| **OBSERVATION** | 15% | Context gathering, indirect impact |
| **REASONING** | 20% | Analysis quality affects decisions |
| **PLANNING** | 30% | Strategic decisions are critical |
| **ACTION** | 25% | Execution directly affects outcome |
| **REFLECTION** | 10% | Meta-cognition improves future |

When a task completes successfully, memories used in each phase receive Q-value updates proportional to these weights.

#### 5. CycleConsolidationTrigger

Triggers memory transitions based on ORPAR cycle outcomes:

| Condition | Action |
|-----------|--------|
| Q >= 0.7 AND 3+ successes | PROMOTE to higher stratum |
| Q <= 0.3 AND 5+ failures | ARCHIVE |
| 10+ successes in Long-term | ABSTRACT to Semantic |
| 30+ days stale AND Q < 0.5 | ARCHIVE |

#### 6. PhaseMemoryOperations

Unified interface for phase-specific memory store/retrieve operations. Provides:

- Phase-aware storage with automatic stratum selection
- Retrieval optimized for current ORPAR phase
- Automatic Q-value tracking for used memories

## Configuration

### Environment Variables

```bash
# Enable ORPAR-Memory integration (opt-in)
ORPAR_MEMORY_INTEGRATION_ENABLED=true

# Also requires these features enabled
MEMORY_STRATA_ENABLED=true
MEMORY_UTILITY_LEARNING_ENABLED=true

# Phase-Strata Routing Configuration
PHASE_STRATA_OBSERVATION_PRIMARY=working,short_term
PHASE_STRATA_REASONING_PRIMARY=episodic,semantic
PHASE_STRATA_PLANNING_PRIMARY=semantic,long_term

# Surprise Thresholds
SURPRISE_HIGH_THRESHOLD=0.7
SURPRISE_MODERATE_THRESHOLD=0.4
SURPRISE_MAX_EXTRA_OBSERVATIONS=3

# Phase Weights for Q-Value Attribution
PHASE_WEIGHT_OBSERVATION=0.15
PHASE_WEIGHT_REASONING=0.20
PHASE_WEIGHT_PLANNING=0.30
PHASE_WEIGHT_ACTION=0.25
PHASE_WEIGHT_REFLECTION=0.10

# Consolidation Thresholds
CONSOLIDATION_PROMOTION_QVALUE=0.7
CONSOLIDATION_DEMOTION_QVALUE=0.3

# Debug logging
ORPAR_MEMORY_DEBUG=false
```

## Events

The integration emits these events for monitoring and debugging:

| Event | Description |
|-------|-------------|
| `orpar_memory:phase_change` | ORPAR phase transition with memory context |
| `orpar_memory:strata_routed` | Memory query routed to strata |
| `orpar_memory:surprise_detected` | Surprise signal processed |
| `orpar_memory:surprise_decision` | ORPAR behavior modification triggered |
| `orpar_memory:reward_attributed` | Phase-weighted Q-value update |
| `orpar_memory:consolidation_triggered` | Memory promotion/demotion triggered |
| `orpar_memory:cycle_completed` | Full ORPAR cycle completed |

## Usage Examples

### Enabling the Integration

```bash
# Start server with ORPAR-Memory integration enabled
ORPAR_MEMORY_INTEGRATION_ENABLED=true \
MEMORY_STRATA_ENABLED=true \
MEMORY_UTILITY_LEARNING_ENABLED=true \
bun run dev
```

### Listening for Events

```typescript
import { EventBus } from '@mxf/shared/events/EventBus';

// Monitor surprise decisions
EventBus.server.on('orpar_memory:surprise_decision', (payload) => {
    console.log('Surprise decision:', {
        surpriseLevel: payload.data.surpriseLevel,
        action: payload.data.action,
        extraObservations: payload.data.extraObservations
    });
});

// Monitor consolidation
EventBus.server.on('orpar_memory:consolidation_triggered', (payload) => {
    console.log('Consolidation:', {
        memoryId: payload.data.memoryId,
        action: payload.data.action, // 'PROMOTE' | 'ARCHIVE' | 'ABSTRACT'
        fromStratum: payload.data.fromStratum,
        toStratum: payload.data.toStratum
    });
});
```

### Custom Phase Configuration

```typescript
import { PhaseStrataRouter } from '@mxf/shared/services/orpar-memory/PhaseStrataRouter';

// Customize strata routing for a specific use case
const router = PhaseStrataRouter.getInstance();

router.configure({
    observation: {
        primaryStrata: ['working', 'short_term'],
        lambda: 0.2
    },
    planning: {
        primaryStrata: ['semantic', 'long_term', 'episodic'],
        lambda: 0.8  // Favor proven patterns even more
    }
});
```

## How It Works

### Phase-Strata Routing Flow

1. Agent enters OBSERVATION phase
2. PhaseStrataRouter determines primary strata: Working, Short-term
3. Memory retrieval uses lambda=0.2 (favor semantic similarity)
4. Results inform agent's observations
5. Phase transitions to REASONING
6. Router switches to Episodic, Semantic strata with lambda=0.5

### Surprise-Driven Re-Observation Flow

1. Agent retrieves memory during REASONING
2. SurpriseCalculator detects high surprise (0.85)
3. SurpriseOrparAdapter receives signal
4. Adapter determines: 2 extra observation cycles needed
5. ORPAR transitions back to OBSERVATION
6. Agent gathers additional context
7. Returns to REASONING with enriched context

### Phase-Weighted Reward Flow

1. Agent completes task successfully
2. RewardSignalProcessor receives task outcome
3. PhaseWeightedRewarder activates
4. Memories used in PLANNING receive 30% of reward
5. Memories used in ACTION receive 25% of reward
6. Q-values updated via EMA formula

### Cycle Consolidation Flow

1. ORPAR cycle completes
2. CycleConsolidationTrigger evaluates memories
3. Memory with Q=0.82 and 4 successes detected
4. Trigger decision: PROMOTE
5. Memory moves from Short-term to Episodic stratum
6. Event emitted for monitoring

## Best Practices

### 1. Start with Defaults

The default configuration is tuned for general-purpose agents. Enable the integration and observe behavior before customizing.

### 2. Monitor Surprise Events

Use the `orpar_memory:surprise_decision` event to understand when and why re-observation occurs. This helps identify:
- Whether surprise thresholds are appropriate
- If agents are getting stuck in observation loops
- Patterns that consistently trigger surprise

### 3. Tune Phase Weights by Domain

Different domains may benefit from different phase weight distributions:

**Analysis-Heavy Tasks:**
```bash
PHASE_WEIGHT_REASONING=0.35
PHASE_WEIGHT_PLANNING=0.25
```

**Execution-Heavy Tasks:**
```bash
PHASE_WEIGHT_ACTION=0.35
PHASE_WEIGHT_PLANNING=0.25
```

### 4. Balance Lambda Values

Higher lambda values favor utility (proven memories) over similarity. For exploratory tasks, lower lambda values encourage discovery:

```bash
# Exploratory configuration
RETRIEVAL_LAMBDA_OBSERVATION=0.1
RETRIEVAL_LAMBDA_REASONING=0.3
```

## Related Documentation

- **[ORPAR Control Loop](orpar.md)** - Core cognitive cycle documentation
- **[Memory Utility Learning System (MULS)](memory-utility-learning.md)** - Q-value based retrieval
- **[Nested Learning / Memory Strata](nested-learning.md)** - Multi-timescale memory architecture
- **[ORPAR-Memory Demo](../examples/orpar-memory.md)** - Working demonstration

---

For questions or contributions, please refer to the [GitHub repository](https://github.com/BradA1878/model-exchange-framework).
