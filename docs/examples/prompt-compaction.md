# Prompt Auto-Compaction Demo

Demonstrates **ResNet-inspired context compression** for long conversations, achieving 30-60% token savings while preserving critical information.

## Overview

Prompt compaction uses a multi-tiered compression strategy inspired by ResNet's skip connections to preserve important context while reducing token usage in long conversations.

## Key MXF Features Demonstrated

### Importance Scoring (0-100 points)

- **Recency**: 0-30 points (more recent = higher score)
- **Decision language**: +20 points ("decided", "will", "must")
- **Error context**: +25 points (tool failures, errors)
- **Critical keywords**: +15 points ("important", "critical", "remember")
- **System messages**: +10 points (always important)

### Tiered Compression (ResNet-inspired)

| Tier | Messages | Preservation |
|------|----------|--------------|
| Tier 0 | Most recent 5 | 100% |
| Tier 1 | Next 10 | 75% |
| Tier 2 | Next 20 | 50% |
| Tier 3 | Remaining | 25% |

### Skip Connections (Residuals)

Messages with importance >= 60 are preserved in full regardless of their tier, acting as "skip connections" that carry critical context forward.

## Running the Demo

### Start Server

```bash
bun run dev
```

### Set Up Environment

```bash
cd examples/prompt-compaction-demo
cp .env.example .env
```

### Run the Demo

```bash
bun run demo:prompt-compaction
```

## Expected Output

```
======================================================================
  Prompt Auto-Compaction Demo (ResNet-Inspired)
======================================================================

[Step 1] Importance Scoring
  [ 15] user: "What database should we use?..."
  [ 45] assistant: "I decided we should use PostgreSQL..." [DECISION]
  [ 55] user: "IMPORTANT: Remember we need HIPAA..." [CRITICAL]
  [ 70] assistant: "The previous query failed with..." [ERROR]
  [ 30] user: "Can you explain the caching strategy?..."

[Step 3] Long Conversation Compression
Conversation with 100 messages:
  Original tokens:   4500
  Compressed tokens: 2100
  Token savings:     53%
  Residuals (skip connections): 12
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Conversation History                    │
├─────────────────────────────────────────────────────────┤
│  Tier 3 (25%)  │  Tier 2 (50%)  │  Tier 1  │   Tier 0   │
│   Oldest       │    Older       │  Recent  │   Latest   │
│                │                │   (75%)  │   (100%)   │
├────────────────┴────────────────┴──────────┴────────────┤
│              ↑ Skip Connections (Residuals) ↑            │
│        High-importance messages preserved in full        │
└─────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROMPT_COMPACTION_ENABLED` | Enable compaction | `false` |
| `PROMPT_COMPACTION_RESIDUALS_ENABLED` | Enable skip connections | `false` |
| `PROMPT_COMPACTION_TIERED_ENABLED` | Enable tiered compression | `false` |
| `PROMPT_COMPACTION_TIER0_SIZE` | Messages at 100% | `10` |
| `PROMPT_COMPACTION_TIER1_SIZE` | Messages at 75% | `25` |
| `PROMPT_COMPACTION_TIER2_SIZE` | Messages at 50% | `50` |
| `PROMPT_COMPACTION_RESIDUAL_THRESHOLD` | Min importance for skip | `60` |
| `PROMPT_COMPACTION_DEFAULT_BUDGET` | Default token budget | `8000` |

## When to Use

Prompt compaction is most effective when:

- Conversations exceed 20+ messages
- Token budget is limited
- Context windows are constrained
- Cost optimization is a priority

## Learning Points

- **Intelligent preservation**: Critical context never lost
- **Tiered compression**: Recent context prioritized
- **Skip connections**: High-importance messages bypass compression
- **30-60% savings**: Significant reduction in token usage
- **Configurable**: Adjust tier sizes and thresholds

## Source Code

See the full implementation in `examples/prompt-compaction-demo/`

## Related Documentation

- [Prompt Auto-Compaction](../mxf/prompt-auto-compaction.md)
- [TOON Optimization](../mxf/toon-optimization.md)
- [Token Optimization](../mxf/dynamic-inference-parameters.md)
