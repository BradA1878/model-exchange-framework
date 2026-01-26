# TOON Optimization Demo

Demonstrates **30-60% token savings** when processing tabular data using TOON (Table-Oriented Object Notation) format.

## Overview

TOON is a token-optimized format for representing arrays of objects. It eliminates repeated key names by using a header row followed by CSV-style data rows.

### Format Comparison

**Standard JSON:**
```json
[
  {"name":"Alice","age":30,"city":"NYC"},
  {"name":"Bob","age":25,"city":"LA"}
]
```

**TOON Format:**
```
[#name,age,city]
Alice,30,NYC
Bob,25,LA
```

The `#` prefix in the header row indicates TOON format. Subsequent rows contain only values.

## What This Demo Shows

1. **Format Comparison**: Side-by-side view of JSON vs TOON encoding
2. **Token Savings Analysis**: Measured savings across different dataset sizes
3. **Scaling Analysis**: How savings increase with more records
4. **MXF Integration**: Agent-based data analysis using TOON optimization

## Running the Demo

1. Ensure MXF server is running:
   ```bash
   bun run dev
   ```

2. Set up environment:
   ```bash
   cd examples/toon-optimization-demo
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. Run the demo:
   ```bash
   bun run toon-optimization-demo.ts
   # Or use npm script:
   bun run demo:toon-optimization
   ```

## Expected Output

```
======================================================================
  TOON (Table-Oriented Object Notation) Optimization Demo
======================================================================

[Step 1] Format Comparison
...

[Step 2] Token Savings Analysis
Employees (5 records):
  JSON tokens: ~150
  TOON tokens: ~85
  Savings: 43%

Products (8 records):
  JSON tokens: ~280
  TOON tokens: ~140
  Savings: 50%

[Step 3] Scaling Analysis
  Records  | JSON Tokens | TOON Tokens | Savings
  ---------|-------------|-------------|--------
       10 |         400 |         180 |     55%
       50 |        2000 |         700 |     65%
      100 |        4000 |        1300 |     68%
      500 |       20000 |        6000 |     70%
```

## Key Benefits

- **Eliminates redundancy**: Key names appear only once in the header
- **30-60% token reduction**: Significant savings for tabular data
- **Automatic detection**: MXF detects arrays eligible for TOON
- **Cost reduction**: Lower LLM API costs for data-heavy operations
- **Seamless integration**: Works transparently with MXF agents

## When to Use TOON

TOON is most effective for:
- Arrays of objects with consistent schemas
- Large datasets (10+ records)
- Objects with multiple string keys
- Frequently transmitted tabular data

TOON is less effective for:
- Single objects or small arrays (< 5 records)
- Objects with nested structures
- Arrays with heterogeneous schemas

## Configuration

TOON optimization can be configured per-channel in MXF:

```typescript
// Enable TOON for a channel
MxpConfigManager.getInstance().setChannelConfig(channelId, {
  tokenOptimization: {
    enabled: true,
    strategies: {
      toonEncoding: true
    }
  }
});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MXP_TOON_ENABLED` | Enable TOON optimization | `true` |
| `MXP_TOON_MIN_RECORDS` | Minimum records to trigger TOON | `3` |
| `MXP_TOON_AUTO_DETECT` | Auto-detect eligible arrays | `true` |
