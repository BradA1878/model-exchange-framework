# TOON (Token-Oriented Object Notation) Optimization

## Overview

TOON is a specialized text format optimized for representing tabular data in LLM prompts, achieving **30-60% token reduction** compared to JSON while improving LLM parsing accuracy. It eliminates key repetition and reduces syntax overhead for array-based data structures.

## Key Features

- **30-60% Token Savings**: Compared to equivalent JSON representation
- **Automatic Format Selection**: Eligibility-based conversion with JSON fallback
- **Improved Parsing**: More natural for LLMs to understand tabular data
- **Channel-Level Control**: Override global settings per channel
- **Performance Monitoring**: Built-in latency tracking and metrics
- **Type Safety**: Primitive-only values for reliable parsing

## TOON Format Structure

### Basic Example

**JSON (Traditional)**:
```json
[
  {"id": 1, "name": "Alice", "status": "active"},
  {"id": 2, "name": "Bob", "status": "idle"},
  {"id": 3, "name": "Carol", "status": "active"}
]
```

**TOON (Optimized)**:
``````toon
users[3]{id,name,status}:
  1,Alice,active
  2,Bob,idle
  3,Carol,active
``````

### Format Components

1. **Header**: `arrayName[length]{field1,field2,...}:`
   - Array name (customizable)
   - Element count in brackets
   - Field names in braces (alphabetically sorted)

2. **Data Rows**: Indented values matching field order
   - Delimiter-separated (default: comma)
   - Consistent ordering per header
   - Quoted values for special characters

3. **Markdown Wrapper**: ` ```toon...``` ` code block (optional)

## Eligibility Criteria

Arrays must meet ALL requirements for TOON encoding:

### 1. Minimum Array Length
- **Default**: ≥ 5 elements
- **Configurable**: `TOON_MIN_ARRAY_LENGTH` env var
- **Rationale**: Overhead not worth it for small arrays

### 2. Uniform Structure
- All elements must be objects
- Identical keys across all elements
- Same key count in every object

### 3. Primitive Values Only
- Allowed types: `string`, `number`, `boolean`, `null`
- No nested objects or arrays
- Ensures consistent field width

### 4. Eligibility Score
- **Minimum**: 0.8 (80%)
- **Configurable**: `TOON_MIN_SCORE` env var
- **Calculation**:
  ```typescript
  score = (lengthScore * 0.3) + (fieldScore * 0.3) + (uniformityScore * 0.4)

  // Length score: 5 elements = 0.8, 10 = 0.9, 15+ = 1.0
  lengthScore = Math.min(0.6 + (elements.length / 25), 1.0)

  // Field score: 2 fields = 0.8, 3 = 0.87, 5+ = 1.0
  fieldScore = Math.min(0.7 + (fieldCount / 15), 1.0)

  // Uniformity: All same keys = 1.0, otherwise = 0.0
  uniformityScore = hasUniformKeys(elements) ? 1.0 : 0.0
  ```

### Eligibility Examples

**✅ Eligible**:
```typescript
const eligible = [
  { id: 1, name: 'Alice', status: 'active' },
  { id: 2, name: 'Bob', status: 'idle' },
  { id: 3, name: 'Carol', status: 'active' },
  { id: 4, name: 'Dave', status: 'busy' },
  { id: 5, name: 'Eve', status: 'active' }
];
// ✓ 5+ elements
// ✓ Uniform keys
// ✓ Primitive values only
// → Score: 1.0 (perfect)
```

**❌ Ineligible - Nested Object**:
```typescript
const ineligible = [
  { id: 1, user: { name: 'Alice' } },  // Nested object
  { id: 2, user: { name: 'Bob' } }
];
// ✗ Contains nested object
```

**❌ Ineligible - Inconsistent Keys**:
```typescript
const ineligible = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob', status: 'idle' }  // Extra key
];
// ✗ Inconsistent keys
```

**❌ Ineligible - Too Few Elements**:
```typescript
const ineligible = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' }
];
// ✗ Only 2 elements (< 5 minimum)
```

## Token Savings Mechanisms

### 1. Key Repetition Elimination

**JSON**: Keys repeated for every object
```json
[
  {"id": 1, "name": "Alice", "status": "active"},
  {"id": 2, "name": "Bob", "status": "idle"},
  {"id": 3, "name": "Carol", "status": "active"}
]
// Keys "id", "name", "status" appear 3 times each = 9 instances
```

**TOON**: Keys listed once in header
``````toon
data[3]{id,name,status}:
  1,Alice,active
  2,Bob,idle
  3,Carol,active
``````
// Keys appear once in header = 3 instances
// **Savings**: 6 key instances eliminated

### 2. Reduced Syntax Overhead

**JSON Syntax per Object**:
- Opening/closing braces: `{}`
- Key quotes: `"key"`
- Colons: `:`
- Commas between pairs: `,`

**TOON Syntax**:
- Single delimiter per value: `,`
- No quotes (unless value contains delimiter)
- No braces or colons

### 3. Structural Metadata

**JSON**: Structure implied by content
**TOON**: Explicit declaration in header
- Array length declared upfront
- Field count known immediately
- Structure validation efficient

### Token Estimation

```typescript
function estimateTokenSavings(originalBytes: number, encodedBytes: number): number {
  const CHARS_PER_TOKEN = 4;  // Heuristic: 1 token ≈ 4 characters
  const originalTokens = Math.ceil(originalBytes / CHARS_PER_TOKEN);
  const encodedTokens = Math.ceil(encodedBytes / CHARS_PER_TOKEN);
  return originalTokens - encodedTokens;  // Positive = savings
}
```

## Configuration

### Environment Variables

```bash
# Global Enable/Disable
TOON_OPTIMIZATION_ENABLED=true

# Eligibility Thresholds
TOON_MIN_ARRAY_LENGTH=5           # Minimum elements for eligibility
TOON_MIN_SCORE=0.8                # Minimum eligibility score (0.0-1.0)

# Formatting Options
TOON_DELIMITER=,                  # Options: ',' | '\t' | '|'
TOON_INDENT=2                     # Spaces for data row indentation
TOON_WRAP_CODE_BLOCK=true         # Wrap in ```toon...``` blocks

# Performance
TOON_MAX_PAYLOAD_SIZE=1048576     # Bytes (1MB default)
TOON_COLLECT_METRICS=true         # Track usage metrics
```

### Programmatic Configuration

```typescript
import { formatMessagePayload } from '@/shared/utils/toon';

const formatted = formatMessagePayload(payload, {
  toonEnabled: true,
  eligibilityOptions: {
    minArrayLength: 10,           // Stricter eligibility
    minScore: 0.9
  },
  encodeOptions: {
    delimiter: '\t',              // Tab-separated
    indent: 4,                    // 4 spaces
    wrapInCodeBlock: true
  }
});
```

### Channel-Level Overrides

```typescript
// In channel configuration
channelConfig.toonOptimizationMode = 'auto' | 'always' | 'never';

// 'auto' = automatic eligibility check (default)
// 'always' = force TOON even if ineligible
// 'never' = always use JSON
```

## Usage

### Basic Encoding

```typescript
import { encodeToon } from '@/shared/utils/toon';

const agents = [
  { id: 1, name: 'Alice', status: 'active' },
  { id: 2, name: 'Bob', status: 'idle' },
  { id: 3, name: 'Carol', status: 'active' },
  { id: 4, name: 'Dave', status: 'busy' },
  { id: 5, name: 'Eve', status: 'active' }
];

const result = encodeToon(agents);

console.log(`Format: ${result.format}`);  // 'toon' or 'json'
console.log(`Original: ${result.originalBytes} bytes`);
console.log(`Encoded: ${result.encodedBytes} bytes`);
console.log(`Token savings: ${result.estimatedTokenSavings}`);
console.log(`Eligibility: ${result.eligibilityScore}`);

console.log(result.output);
// ```toon
// data[5]{id,name,status}:
//   1,Alice,active
//   2,Bob,idle
//   3,Carol,active
//   4,Dave,busy
//   5,Eve,active
// ```
```

### Eligibility Checking

```typescript
import { evaluateEligibility } from '@/shared/utils/toon';

const payload = [/* data */];
const eligibility = evaluateEligibility(payload);

if (eligibility.eligible) {
  console.log(`Eligible! Score: ${eligibility.score}`);
  console.log(`Paths: ${eligibility.eligiblePaths}`);
} else {
  console.log(`Ineligible: ${eligibility.reason}`);
}
```

### Message Formatting

```typescript
import { formatMessagePayload } from '@/shared/utils/toon';

// Automatic format selection
const formatted = formatMessagePayload(payload);

// With custom options
const formatted = formatMessagePayload(payload, {
  toonEnabled: true,
  eligibilityOptions: {
    minArrayLength: 10,
    minScore: 0.7
  },
  encodeOptions: {
    delimiter: ',',
    indent: 2
  }
});
```

### Batch Formatting

```typescript
import { formatBatch } from '@/shared/utils/toon';

const sections = [
  { label: 'Active Agents', data: activeAgents },
  { label: 'Pending Tasks', data: pendingTasks },
  { label: 'Recent Events', data: recentEvents }
];

const formatted = formatBatch(sections);

// Output:
// ## Active Agents
//
// ```toon
// ...
// ```
//
// ## Pending Tasks
//
// ```toon
// ...
// ```
//
// ## Recent Events
//
// ```json
// ...  (if ineligible for TOON)
// ```
```

### Decoding TOON

```typescript
import { decodeToon } from '@/shared/utils/toon';

const toonString = `\`\`\`toon
data[3]{id,name,status}:
  1,Alice,active
  2,Bob,idle
  3,Carol,active
\`\`\``;

const decoded = decodeToon(toonString);
// Returns: [
//   { id: 1, name: 'Alice', status: 'active' },
//   { id: 2, name: 'Bob', status: 'idle' },
//   { id: 3, name: 'Carol', status: 'active' }
// ]
```

## Middleware Integration

### ToonMessageMiddleware

Automatically processes payloads in the message delivery pipeline:

```typescript
import { getToonMiddleware, processToonPayload } from
  '@/server/socket/middleware/ToonMessageMiddleware';

// Via middleware instance
const middleware = getToonMiddleware();
const formatted = middleware.processPayload(payload, channelId, 'auto');

// Via convenience function
const formatted = processToonPayload(payload, channelId, 'auto');
```

**Processing Flow**:
1. Global enable/disable check
2. Channel-level override check
3. Fast pre-check (`mightBeEligible`)
4. Full encoding with eligibility check
5. Performance monitoring (< 25ms threshold)
6. Metrics recording

### Performance Requirements

**Thresholds**:
- Eligibility check: < 5ms for payloads under 100KB
- Total added latency: < 25ms per message
- Silent fallback to JSON on any error

**Monitoring**:
```typescript
// Pre-check latency
if (preCheckLatency > 5) {
  logger.warn('Pre-check exceeded 5ms threshold', {
    latency: preCheckLatency.toFixed(2),
    channelId,
  });
}

// Total latency
if (totalLatency > 25) {
  logger.warn('TOON processing exceeded 25ms threshold', {
    latency: totalLatency.toFixed(2),
    channelId,
  });
}
```

## Context Optimization

### ToonContextOptimizer Service

Specialized service for optimizing context data:

```typescript
import { getToonContextOptimizer } from
  '@/server/socket/services/ToonContextOptimizer';

const optimizer = getToonContextOptimizer();

// Single context section
const formatted = optimizer.optimizeContext(agents, 'Agent Pool Status');

// Batch optimization
const formatted = optimizer.optimizeBatch([
  { label: 'Agents', data: agents },
  { label: 'Tasks', data: tasks },
  { label: 'Memory', data: memoryResults }
]);

// Convenience methods
const agentStatus = optimizer.optimizeAgentPool(agents);
const taskStatus = optimizer.optimizeTaskQueue(tasks);
const memoryContext = optimizer.optimizeMemoryResults(results, 'conversations');
const observations = optimizer.optimizeObservations(observationData);
```

**Integration Points**:
- ORPAR cycle context assembly
- Agent pool status updates
- Task queue representations
- Memory search results
- SystemLLM context reduction

## Metrics & Analytics

### Recording Metrics

```typescript
import { recordEncoding, getMetrics, getDetailedMetrics } from '@/shared/utils/toon';

// After encoding
const result = encodeToon(payload);
recordEncoding(result);

// Get metrics
const metrics = getMetrics();
console.log(`TOON selected: ${metrics.toonSelected} times`);
console.log(`JSON selected: ${metrics.jsonSelected} times`);
console.log(`Total token savings: ${metrics.totalTokenSavings}`);
console.log(`Avg eligibility: ${metrics.averageEligibilityScore}`);
console.log(`Avg latency: ${metrics.averageLatencyMs}ms`);
```

### Detailed Metrics

```typescript
const detailed = getDetailedMetrics();
console.log(`Compression ratio: ${detailed.compressionRatio}`);
console.log(`TOON selection rate: ${(detailed.toonSelectionRate * 100).toFixed(1)}%`);
console.log(`Median latency: ${detailed.medianLatencyMs.toFixed(2)}ms`);
console.log(`P95 latency: ${detailed.p95LatencyMs.toFixed(2)}ms`);
```

### Context-Specific Metrics

```typescript
import { createContextCollector } from '@/shared/utils/toon';

// Track metrics per channel or agent
const channelMetrics = createContextCollector('channel-123');

// Record operations
channelMetrics.record(encodeResult);
channelMetrics.recordError();

// Get context-specific metrics
const metrics = channelMetrics.getMetrics();
const summary = channelMetrics.getSummary();

console.log(summary);
// "TOON Metrics (channel-123): 45 attempts, 38 TOON (84.4%), 7 JSON,
//  12,450 tokens saved, avg latency: 3.2ms"
```

### Metrics Interface

```typescript
interface ToonMetrics {
  totalAttempts: number;
  toonSelected: number;
  jsonSelected: number;
  totalOriginalBytes: number;
  totalEncodedBytes: number;
  totalTokenSavings: number;
  averageEligibilityScore: number;
  averageLatencyMs: number;
  errorCount: number;
}
```

## Special Features

### Nested Array Extraction

TOON can extract eligible arrays from complex nested structures:

```typescript
const complexPayload = {
  metadata: { version: '1.0' },
  users: [  // ← Eligible array
    { id: 1, name: 'Alice', status: 'active' },
    { id: 2, name: 'Bob', status: 'idle' },
    { id: 3, name: 'Carol', status: 'active' },
    { id: 4, name: 'Dave', status: 'busy' },
    { id: 5, name: 'Eve', status: 'active' }
  ],
  timestamp: Date.now()
};

const result = encodeToon(complexPayload);
// Automatically extracts 'users' array and encodes in TOON
// Other fields remain in JSON
```

### Quoted Value Handling

Values containing delimiters or quotes are automatically quoted:

```typescript
const data = [
  { id: 1, name: 'Smith, John', role: 'Engineer' },
  { id: 2, name: 'O\'Brien', role: 'Manager' },
  { id: 3, name: 'Chen', role: 'Analyst' }
];

// Result:
// data[3]{id,name,role}:
//   1,"Smith, John",Engineer
//   2,"O'Brien",Manager
//   3,Chen,Analyst
```

### Empty/Null Value Handling

```typescript
const data = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: null },
  { id: 3, name: 'Carol', email: '' }
];

// Result:
// data[3]{email,id,name}:
//   alice@example.com,1,Alice
//   ,2,Bob
//   ,3,Carol
```

## Use Cases

### 1. Agent Pool Status

```typescript
const agentPool = [
  { agentId: 'agent-1', status: 'active', tasks: 3, load: 0.6 },
  { agentId: 'agent-2', status: 'idle', tasks: 0, load: 0.0 },
  { agentId: 'agent-3', status: 'busy', tasks: 5, load: 0.9 },
  { agentId: 'agent-4', status: 'active', tasks: 2, load: 0.4 },
  { agentId: 'agent-5', status: 'active', tasks: 4, load: 0.7 }
];

const formatted = optimizer.optimizeAgentPool(agentPool);
// 40-50% token reduction for SystemLLM context
```

### 2. Task Queue Display

```typescript
const taskQueue = [
  { taskId: 'task-1', status: 'pending', priority: 'high', assignee: 'agent-1' },
  { taskId: 'task-2', status: 'in_progress', priority: 'medium', assignee: 'agent-2' },
  { taskId: 'task-3', status: 'pending', priority: 'low', assignee: null },
  { taskId: 'task-4', status: 'in_progress', priority: 'high', assignee: 'agent-3' },
  { taskId: 'task-5', status: 'completed', priority: 'medium', assignee: 'agent-1' }
];

const formatted = optimizer.optimizeTaskQueue(taskQueue);
// Ideal for ORPAR observation phase
```

### 3. Memory Search Results

```typescript
const searchResults = [
  { id: 'mem-1', content: 'User prefers dark mode', score: 0.95, timestamp: 1705000000 },
  { id: 'mem-2', content: 'Database uses PostgreSQL', score: 0.87, timestamp: 1705001000 },
  { id: 'mem-3', content: 'API key rotates monthly', score: 0.82, timestamp: 1705002000 },
  { id: 'mem-4', content: 'Team meeting at 2pm', score: 0.76, timestamp: 1705003000 },
  { id: 'mem-5', content: 'Bug in auth module', score: 0.71, timestamp: 1705004000 }
];

const formatted = optimizer.optimizeMemoryResults(searchResults, 'agent_memory');
// Optimized context for memory-augmented generation
```

### 4. Observation Data Compression

```typescript
const observations = [
  { source: 'sensor-1', type: 'temperature', value: 72.5, unit: 'F', timestamp: 1705000000 },
  { source: 'sensor-2', type: 'humidity', value: 45, unit: '%', timestamp: 1705000000 },
  { source: 'sensor-3', type: 'pressure', value: 1013, unit: 'hPa', timestamp: 1705000000 },
  { source: 'sensor-4', type: 'co2', value: 420, unit: 'ppm', timestamp: 1705000000 },
  { source: 'sensor-5', type: 'light', value: 850, unit: 'lux', timestamp: 1705000000 }
];

const formatted = optimizer.optimizeObservations(observations);
// Efficient sensor data representation
```

## Best Practices

1. **Use for Tabular Data**: TOON excels with uniform, structured data
2. **Check Eligibility First**: Use fast pre-check to avoid unnecessary processing
3. **Monitor Performance**: Track latency metrics to ensure < 25ms target
4. **Set Appropriate Thresholds**: Adjust `minArrayLength` and `minScore` based on use case
5. **Cache Results**: TOON-encoded strings can be cached for repeated use
6. **Handle Errors Gracefully**: Always have JSON fallback for reliability
7. **Test with Real Data**: Validate token savings with actual payloads
8. **Channel-Level Tuning**: Use overrides for specific channel requirements

## Troubleshooting

### TOON Not Being Used

**Check**:
1. Global flag: `TOON_OPTIMIZATION_ENABLED=true`
2. Payload eligibility: Run `evaluateEligibility()`
3. Array length: Must have ≥ 5 elements (or configured minimum)
4. Uniform structure: All objects must have identical keys
5. Primitive values: No nested objects or arrays

### Performance Issues

**Actions**:
1. Reduce eligibility check complexity
2. Increase cache size
3. Lower `minArrayLength` to avoid processing small arrays
4. Use `mightBeEligible` pre-check to skip obvious failures
5. Monitor latency with metrics

### Incorrect Encoding

**Check**:
1. Special characters in values (should be quoted)
2. Delimiter conflicts (change delimiter if needed)
3. Field ordering (alphabetically sorted)
4. Null/empty value handling

## Related Documentation

- [MXP Protocol](mxp-protocol.md)
- [Context Compression](prompt-auto-compaction.md)
- [System Overview](system-overview.md)

## Implementation Files

**Core**: `src/shared/utils/toon/`
- `encoder.ts` - Encoding/decoding logic
- `eligibility.ts` - Eligibility evaluation
- `formatter.ts` - Message formatting
- `metrics.ts` - Analytics tracking
- `types.ts` - TypeScript interfaces

**Integration**:
- `src/server/socket/middleware/ToonMessageMiddleware.ts` - Message pipeline
- `src/server/socket/services/ToonContextOptimizer.ts` - Context optimization
