# ORPAR-Memory Integration Demo

This demo showcases the unified cognitive-memory architecture that tightly couples ORPAR phases with memory operations.

## Features Demonstrated

### 1. Phase-Strata Routing

Different ORPAR phases access different memory strata:

| Phase | Primary Strata | Lambda | Purpose |
|-------|---------------|--------|---------|
| OBSERVATION | Working, Short-term | 0.2 | Recent context for gathering |
| REASONING | Episodic, Semantic | 0.5 | Patterns for analysis |
| PLANNING | Semantic, Long-term | 0.7 | Proven strategies |
| ACTION | Working, Short-term | 0.3 | Stay grounded |
| REFLECTION | All strata | 0.6 | Holistic review |

### 2. Surprise Detection

High surprise triggers ORPAR behavior modifications:

- **High surprise (>0.7)**: Trigger 1-3 additional observation cycles
- **Moderate surprise (0.4-0.7)**: Inject surprise context into reasoning
- **Plan surprise (>0.6)**: Flag plan for reconsideration

### 3. Phase-Weighted Rewards

Q-values are updated based on phase contribution to task success:

| Phase | Weight | Rationale |
|-------|--------|-----------|
| OBSERVATION | 15% | Context gathering, indirect impact |
| REASONING | 20% | Analysis quality affects decisions |
| PLANNING | 30% | Strategic decisions are critical |
| ACTION | 25% | Execution directly affects outcome |
| REFLECTION | 10% | Meta-cognition improves future |

### 4. Cycle Consolidation

Memory transitions triggered by ORPAR cycle outcomes:

| Condition | Action |
|-----------|--------|
| Q >= 0.7 AND 3+ successes | PROMOTE to higher stratum |
| Q <= 0.3 AND 5+ failures | ARCHIVE |
| 10+ successes in Long-term | ABSTRACT to Semantic |
| 30+ days stale AND Q < 0.5 | ARCHIVE |

## Prerequisites

1. MXF server running with required features enabled
2. OpenRouter API key (or other LLM provider)

## Running the Demo

### 1. Start the Server

```bash
# Start server with ORPAR-Memory integration enabled
ORPAR_MEMORY_INTEGRATION_ENABLED=true \
MEMORY_STRATA_ENABLED=true \
MEMORY_UTILITY_LEARNING_ENABLED=true \
bun run dev
```

### 2. Run the Demo

```bash
# In another terminal
bun run demo:orpar-memory
```

### 3. Watch the Output

The demo will show:
- `[Phase Change]` - ORPAR phase transitions
- `[Memory Retrieved]` - Phase-specific memory access
- `[Memory Stored]` - Phase-aware memory storage
- `[Surprise Detected]` - Surprise signals
- `[Surprise Decision]` - ORPAR behavior modifications
- `[Reward Attributed]` - Phase-weighted Q-value updates
- `[Consolidation: PROMOTED/DEMOTED/ARCHIVED]` - Memory transitions
- `[ORPAR Cycle Completed]` - Cycle summary

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
# Edit .env with your API keys
```

### Key Environment Variables

```bash
# Required for this demo
ORPAR_MEMORY_INTEGRATION_ENABLED=true
MEMORY_STRATA_ENABLED=true
MEMORY_UTILITY_LEARNING_ENABLED=true

# Optional tuning
SURPRISE_HIGH_THRESHOLD=0.7
SURPRISE_MODERATE_THRESHOLD=0.4
PHASE_WEIGHT_PLANNING=0.30
```

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

## Related Documentation

- [Nested Learning Documentation](../../docs/mxf/nested-learning.md)
- [ORPAR Control Loop](../../docs/mxf/orpar.md)
- [Memory Utility Learning System (MULS)](../../docs/mxf/muls.md)
