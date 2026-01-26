# Memory Strata Demo

Demonstrates the **multi-timescale memory architecture** with 5 strata and Titans-inspired surprise detection.

## Overview

MXF implements a hierarchical memory system inspired by human memory architecture, where information flows through multiple layers with different persistence and access patterns.

### The 5 Memory Strata

| Stratum | Persistence | Purpose | Max Entries |
|---------|-------------|---------|-------------|
| Working | Seconds | Immediate context | 7 |
| Short-Term | Minutes | Recent history | 50 |
| Episodic | Hours | Specific events | 200 |
| Long-Term | Days | Persistent facts | 1000 |
| Semantic | Weeks | Abstract concepts | 500 |

## What This Demo Shows

1. **Working Memory**: Immediate observations and context
2. **Memory Consolidation**: Promotion between strata
3. **Long-Term Storage**: Persistent knowledge and patterns
4. **Surprise Detection**: Titans-style anomaly detection
5. **Memory Statistics**: Distribution across strata
6. **MXF Integration**: Agent-based memory analysis

## Running the Demo

1. Ensure MXF server is running:
   ```bash
   bun run dev
   ```

2. Set up environment:
   ```bash
   cd examples/memory-strata-demo
   cp .env.example .env
   ```

3. Run the demo:
   ```bash
   bun run memory-strata-demo.ts
   ```

## Expected Output

```
======================================================================
  Memory Strata Demo (Multi-Timescale Architecture)
======================================================================

[Step 1] Working Memory (Immediate Context)
  Added 3 entries to working memory
  TTL: 30s, Max: 7 entries

[Step 2] Memory Consolidation (Promotion)
  Promoted "User requested analysis..." to short-term: true
  Promoted to episodic memory: true

[Step 4] Surprise Detection (Titans-Inspired)
  ✓ [  0%] Q4 shows expected holiday revenue...
  ⚠️ [ 85%] Unexpected Q1 spike in summer...
       Type: anomaly - Unexpected pattern detected
```

## Memory Operations

### Adding Memories
```typescript
store.add(MemoryStratum.Working, 'content', importance, ['tags']);
```

### Promotion (Consolidation)
```typescript
store.promote(memoryId, MemoryStratum.LongTerm);
```

### Demotion (Decay)
```typescript
store.demote(memoryId);
```

### Querying
```typescript
store.getByStratum(MemoryStratum.Semantic);
```

## Surprise Detection

Titans-inspired surprise detection identifies unexpected patterns:

| Score | Type | Description |
|-------|------|-------------|
| 0-30% | normal | Matches expectations |
| 30-50% | prediction_failure | Doesn't match patterns |
| 50-70% | schema_violation | Partially unexpected |
| 70-100% | anomaly | Completely unexpected |

## Configuration

```typescript
const STRATUM_CONFIG = {
  working: {
    maxEntries: 7,
    ttlMs: 30000,
    decayRate: 0.9,
    minImportance: 1
  },
  // ... other strata
};
```

## Key Benefits

- **Cognitive Model**: Mirrors human memory architecture
- **Automatic Decay**: Memories naturally fade over time
- **Surprise Detection**: Identifies anomalies for attention
- **Consolidation**: Important memories become persistent
- **Pattern Recognition**: Semantic memory stores abstractions
