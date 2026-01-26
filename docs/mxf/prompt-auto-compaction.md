# Prompt Auto-Compaction

## Overview

Prompt Auto-Compaction is a sophisticated multi-phase system that intelligently compresses conversation history while preserving critical information. Using a ResNet-inspired architecture with skip connections (residuals), it maintains high-importance content while applying tiered compression to less critical messages.

## Key Features

- **ResNet-Inspired Architecture**: Skip connections (residuals) preserve critical information
- **Tiered Compression**: Four-tier hierarchy with 0%, 30%, 60%, and 85% compression
- **Importance Scoring**: Objective scoring based on decision language, tool results, and recency
- **Token Budget Allocation**: Intelligent distribution across fixed and variable components
- **Adaptive Optimization**: Pattern learning informs future compression strategies
- **Caching Layer**: Content-hash-based caching with LRU eviction

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   IMPORTANCE SCORING                             │
│   For each message: Decision lang, Tool results, Recency, etc.  │
│   → ImportanceScore { score: 0-100, isResidual: boolean }       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   RESIDUAL EXTRACTION                            │
│   Extract messages with score ≥ 60 (threshold configurable)     │
│   Budget limit: Max 20% of total messages                        │
│   → Residuals bypass ALL compression                            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TIER ASSIGNMENT                                │
│   Non-residual messages assigned to tiers by recency:           │
│   • Tier 0: Last 10 msgs (0% compression - raw)                 │
│   • Tier 1: Msgs 10-25 (30% compression - 70% preserved)        │
│   • Tier 2: Msgs 25-50 (60% compression - 40% preserved)        │
│   • Tier 3: Msgs 50+ (85% compression - 15% preserved)          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TIER SUMMARIZATION                             │
│   SystemLLM generates summaries for Tier 1-3                    │
│   Intelligent truncation with keyword preservation              │
│   Content-hash caching with LRU eviction                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TOKEN BUDGET ALLOCATION                        │
│   Fixed: system, identity, task, actions, SystemLLM            │
│   Priority: Residuals (20% max)                                 │
│   Distribution: Tier0 (70%), Tier1 (20%), Tier2 (7%), Tier3 (3%)│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PROMPT ASSEMBLY                                │
│   Order: System → Identity → Actions → SystemLLM → History      │
│   → Task → Current Message                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Importance Scoring System

### Scoring Factors

Messages are scored on a 0-100 scale using multiple contributing factors:

**Decision Language Detection** (+50 points):
- Pattern: `/\b(decided|concluded|agreed|will do|won't do|determined|resolved)\b/i`
- Highest priority for action conclusions

**Tool Error Detection** (+40 points):
- Detects: `message.metadata.isToolError`
- Condition: `toolResult.success === false` OR content includes 'error' + 'tool'/'failed'

**Tool Success Detection** (+30 points):
- Detects: `message.metadata.toolResult?.success`
- Excluded if already marked as error

**Explicit Importance Markers**:
- High importance: +40 points
- Medium importance: +20 points

**Reference Counting** (+20 points):
- 2+ references to message in conversation: +20 points

**Recency Scoring**:
- < 5 minutes: +15 points
- < 1 hour: +5 points

**Task-Related Content** (+20 points):
- `message.type === 'task'`
- Content includes 'task' or 'objective'

### ImportanceScore Interface

```typescript
interface ImportanceScore {
  score: number;           // 0-100
  factors: string[];       // Contributing factors for debugging
  isResidual: boolean;     // score >= threshold (bypasses compression)
}
```

### Residual Detection

```typescript
// Default threshold: 60 points
const residualThreshold = parseInt(
  process.env.PROMPT_COMPACTION_RESIDUAL_THRESHOLD || '60'
);
const isResidual = score >= residualThreshold;
```

**Key Aspects**:
- Default threshold: 60 points
- Residual budget limit: 20% of total messages
- Messages exceeding threshold bypass all compression tiers
- Budget-enforced: If residuals exceed 20%, demote lowest-scoring ones

### Example Scoring

```typescript
const message1: MemoryEntry = {
  id: 'msg-123',
  content: 'We decided to implement authentication using OAuth 2.0 with PKCE flow.',
  type: 'decision',
  importance: 'high',
  timestamp: new Date(),
  metadata: { agent: 'architect' }
};

const score1 = scoreMessageImportance(message1);
// Output:
// {
//   score: 110,  // 50 (decision) + 40 (high importance) + 20 (recent)
//   factors: ['decision_language', 'explicit_high_importance', 'very_recent'],
//   isResidual: true  // 110 > 60 threshold
// }

const message2: MemoryEntry = {
  id: 'msg-456',
  content: 'Hello, how are you?',
  type: 'conversation',
  timestamp: new Date(Date.now() - 7200000),  // 2 hours ago
  metadata: {}
};

const score2 = scoreMessageImportance(message2);
// Output:
// {
//   score: 0,
//   factors: [],
//   isResidual: false  // 0 < 60 threshold
// }
```

## Tiered Compression Architecture

### Four-Tier Hierarchy

| Tier | Message Range | Compression | Preservation | Use Case |
|------|---------------|-------------|--------------|----------|
| **Tier 0** | 0-10 (last 10) | None | 100% | Most recent, uncompressed context |
| **Tier 1** | 10-25 | Light | 70% | Short-term activity & key details |
| **Tier 2** | 25-50 | Medium | 40% | Main topics & decisions |
| **Tier 3** | 50+ (oldest) | Heavy | 15% | Brief historical context |
| **Residuals** | All tiers | Skip | 100% | High-importance content (bypass) |

### Tier Configuration

```typescript
interface TierConfig {
  tier0Size: number;    // Recent messages (uncompressed)
  tier1Size: number;    // Short-term (light compression - 70% preserved)
  tier2Size: number;    // Medium-term (medium compression - 40% preserved)
  // Beyond tier2Size = Tier 3 (heavy compression - 15% preserved)
}

// Default configuration
const tierConfig: TierConfig = {
  tier0Size: 10,  // Most recent 10 messages (raw)
  tier1Size: 25,  // Messages 10-25 (light compression)
  tier2Size: 50   // Messages 25-50 (medium compression)
  // Beyond 50 = Tier 3 (heavy compression)
};
```

### Summarization Strategy per Tier

**Tier 1 (70% compression)**:
- Preserve participants and their roles
- Actions taken and their outcomes
- Important decisions or conclusions
- Key technical details or data

**Tier 2 (40% compression)**:
- Main topics discussed
- Important decisions made
- Unresolved items or open questions
- Critical context for future reference

**Tier 3 (15% compression)**:
- What was this conversation about?
- What was concluded or decided?
- Any critical outcomes?

### Tiered Compression Flow

```typescript
async function compressConversationTiered(messages, options) {
  // 1. Extract residuals (skip-connected high-importance content)
  const residuals = await extractResiduals(messages);

  // 2. Filter residuals from tier processing
  const nonResidualMessages = messages.filter(m => !isResidual(m));

  // 3. Assign non-residual messages to tiers by recency
  const tier0 = nonResidualMessages.slice(-10);
  const tier1 = nonResidualMessages.slice(-25, -10);
  const tier2 = nonResidualMessages.slice(-50, -25);
  const tier3 = nonResidualMessages.slice(0, -50);

  // 4. Generate summaries for each tier using SystemLLM
  const tier1Summary = await summarizeTier(tier1, 'tier1');
  const tier2Summary = await summarizeTier(tier2, 'tier2');
  const tier3Summary = await summarizeTier(tier3, 'tier3');

  // 5. Calculate token metrics
  const originalTokens = estimateTokens(messages);
  const compressedTokens = estimateTokens({
    tier0, tier1Summary, tier2Summary, tier3Summary, residuals
  });

  // 6. Emit compression event for analytics
  EventBus.server.emit(Events.Mxp.CONTEXT_COMPRESSED, {
    originalTokens,
    optimizedTokens: compressedTokens,
    compressionRatio: compressedTokens / originalTokens
  });

  // 7. Return TieredCompressedContext
  return {
    tiers: { tier0, tier1Summary, tier2Summary, tier3Summary },
    residuals,
    originalTokens,
    compressedTokens,
    ratio: compressedTokens / originalTokens
  };
}
```

### Intelligent Truncation with Keyword Preservation

```typescript
function intelligentTruncate(content: string, targetLength: number, keywords: string[]) {
  // 1. Split content into sentences
  const sentences = content.split(/[.!?]+/);

  // 2. Score each sentence
  const scoredSentences = sentences.map(sentence => {
    let score = 0;

    // +10 for each preserved keyword match
    keywords.forEach(keyword => {
      if (sentence.toLowerCase().includes(keyword.toLowerCase())) {
        score += 10;
      }
    });

    // +5 for decision language
    if (/\b(decided|concluded|agreed|will|won't|must|should)\b/i.test(sentence)) {
      score += 5;
    }

    // +3 for importance markers
    if (/\b(important|critical|key|essential|note)\b/i.test(sentence)) {
      score += 3;
    }

    return { sentence, score };
  });

  // 3. Sort by score and select until target length reached
  scoredSentences.sort((a, b) => b.score - a.score);

  let result = '';
  for (const { sentence } of scoredSentences) {
    if (result.length + sentence.length <= targetLength) {
      result += sentence + '. ';
    }
  }

  // 4. Fallback: simple truncation if no sentences fit
  return result || content.substring(0, targetLength) + '...';
}
```

## Token Budget Allocation

### TokenBudget Interface

```typescript
interface TokenBudget {
  total: number;
  allocated: {
    systemPrompt: number;        // Fixed (cached)
    agentIdentity: number;       // Fixed (cached)
    residuals: number;           // Priority: always allocated first
    tier0: number;               // 70% of remaining
    tier1: number;               // 20% of remaining
    tier2: number;               // 7% of remaining
    tier3: number;               // 3% of remaining
    taskPrompt: number;          // Fixed (measured)
    actions: number;             // Fixed (measured)
    systemLLM: number;           // Fixed (measured)
    currentMessage: number;      // 50 tokens reserved
  };
  remaining: number;
  utilizationPercent: number;
}
```

### Budget Allocation Algorithm

```typescript
function allocateTokenBudget(
  tokenBudget: number,
  structure: PromptStructure,
  dynamicSizes: DynamicComponentSizes
): TokenBudget {
  // Step 1: Calculate Fixed Allocations
  const systemPrompt = estimateTokens(structure.systemPrompt);
  const agentIdentity = estimateTokens(structure.agentIdentity);
  const taskPrompt = structure.taskPrompt ? estimateTokens(structure.taskPrompt) : 0;
  const actions = estimateTokens(structure.recentActions);
  const systemLLM = structure.systemLLMInsight ? estimateTokens(structure.systemLLMInsight) : 0;
  const currentMessage = 50;  // Reserved

  const fixedTotal = systemPrompt + agentIdentity + taskPrompt + actions + systemLLM + currentMessage;

  // Step 2: Calculate Variable Budget
  const conversationBudget = Math.max(0, tokenBudget - fixedTotal - 100);  // 100 safety margin

  // Step 3: Allocate Residuals (Priority 1)
  const maxResidualBudget = tokenBudget * 0.20;  // 20% of total budget
  const residuals = Math.min(dynamicSizes.residuals, maxResidualBudget);

  // Step 4: Distribute Remaining Across Tiers
  const remaining = conversationBudget - residuals;
  const tier0 = Math.floor(remaining * 0.70);  // 70%
  const tier1 = Math.floor(remaining * 0.20);  // 20%
  const tier2 = Math.floor(remaining * 0.07);  // 7%
  const tier3 = Math.floor(remaining * 0.03);  // 3%

  // Step 5: Redistribute Unused Budget
  // Any tier surplus → allocated to tier0 (most recent context)

  return {
    total: tokenBudget,
    allocated: {
      systemPrompt,
      agentIdentity,
      residuals,
      tier0,
      tier1,
      tier2,
      tier3,
      taskPrompt,
      actions,
      systemLLM,
      currentMessage
    },
    remaining: tokenBudget - (fixedTotal + residuals + tier0 + tier1 + tier2 + tier3),
    utilizationPercent: ((fixedTotal + residuals + tier0 + tier1 + tier2 + tier3) / tokenBudget) * 100
  };
}
```

### Practical Example

```typescript
// Assume: totalBudget = 4000 tokens

// Fixed Allocations:
const fixed = {
  systemPrompt: 500,
  agentIdentity: 200,
  taskPrompt: 150,
  actions: 100,
  systemLLM: 50,
  currentMessage: 50
};
// Total Fixed: 1050 tokens

// Available for Compression:
// 4000 - 1050 - 100(safety) = 2850 tokens

// Residuals (Priority):
// maxResiduals = 4000 * 0.20 = 800 tokens
// allocated = MIN(400_actual, 800) = 400 tokens

// Tier Distribution (remaining = 2850 - 400 = 2450):
const tiers = {
  tier0: 2450 * 0.70 = 1715,
  tier1: 2450 * 0.20 = 490,
  tier2: 2450 * 0.07 = 171,
  tier3: 2450 * 0.03 = 73
};

// Final Result:
// Total allocated: 1050 + 400 + 1715 + 490 + 171 + 73 = 3899 tokens
// Remaining: 4000 - 3899 = 101 tokens
// Utilization: 97.5%
```

## Residual Handling

### Residual Extraction Process

```typescript
async function extractResiduals(messages: any[]): Promise<any[]> {
  // 1. Feature flag check
  const isEnabled = process.env.PROMPT_COMPACTION_RESIDUALS_ENABLED === 'true';
  if (!isEnabled) return [];

  // 2. Score each message
  const residuals = [];
  for (const message of messages) {
    const memoryEntry = convertToMemoryEntry(message);
    const importanceScore = scoreMessageImportance(memoryEntry, messages);

    if (importanceScore.isResidual) {
      residuals.push(message);
    }
  }

  // 3. Enforce budget limit
  const maxResidualPercent = parseFloat(
    process.env.PROMPT_COMPACTION_RESIDUAL_MAX_PERCENT || '0.20'
  );
  const maxResiduals = Math.ceil(messages.length * maxResidualPercent);

  // 4. Demote if budget exceeded
  if (residuals.length > maxResiduals) {
    residuals.sort((a, b) => {
      const scoreA = scoreMessageImportance(a, messages).score;
      const scoreB = scoreMessageImportance(b, messages).score;
      return scoreB - scoreA;
    });
    return residuals.slice(0, maxResiduals);
  }

  return residuals;
}
```

### How Residuals Bypass Compression

```typescript
// Residuals extracted FIRST, before tier assignment
const residuals = await extractResiduals(messages);
const residualIds = new Set(residuals.map(m => m.id));

// Filter residuals OUT of tier processing
const nonResidualMessages = messages.filter(m => !residualIds.has(m.id));

// Only non-residuals are compressed into tiers
const tier0Messages = nonResidualMessages.slice(-10);
const tier1Messages = nonResidualMessages.slice(-25, -10);
// ... etc

// Result: Residuals preserved in full + compressed tiers
return {
  tiers: { tier0, tier1Summary, tier2Summary, tier3Summary },
  residuals  // ← These bypass ALL compression
};
```

## Context Reference System

For very large contexts, use reference-based storage:

```typescript
async function createContextReference(channelId: string, context: any[]): Promise<string> {
  // Generate deterministic ID from content hash
  const contextId = `ctx_${crypto.createHash('sha256')
    .update(JSON.stringify(context))
    .digest('hex')
    .substring(0, 8)}`;

  // Store in local cache with metadata
  contextCache.set(contextId, {
    channelId,
    contextData: context,
    timestamp: Date.now(),
    originalSize: JSON.stringify(context).length
  });

  // Implement LRU eviction
  if (contextCache.size > maxCacheSize) {
    const firstKey = contextCache.keys().next().value;
    contextCache.delete(firstKey);
  }

  return contextId;
}
```

## Configuration

### Environment Variables

```bash
# Residual Detection
PROMPT_COMPACTION_RESIDUALS_ENABLED=true
PROMPT_COMPACTION_RESIDUAL_THRESHOLD=60
PROMPT_COMPACTION_RESIDUAL_MAX_PERCENT=0.20

# Tiered Compression
PROMPT_COMPACTION_TIERED_ENABLED=true

# Token Budget
PROMPT_COMPACTION_BUDGET_ENABLED=true

# Meilisearch Integration
ENABLE_MEILISEARCH=true
```

## Usage Examples

### Example 1: Compress with Tiered Architecture

```typescript
import { ContextCompressionEngine } from '@/shared/mxp/ContextCompressionEngine';

const engine = ContextCompressionEngine.getInstance();
const messages = [...]; // Large conversation history

const compressed = await engine.compressConversationTiered(messages, {
  channelId: 'design-team',
  agentId: 'architect',
  enableTieredCompression: true,
  tierConfig: {
    tier0Size: 10,
    tier1Size: 25,
    tier2Size: 50
  }
});

console.log(`Original: ${compressed.originalTokens} tokens`);
console.log(`Compressed: ${compressed.compressedTokens} tokens`);
console.log(`Ratio: ${(compressed.ratio * 100).toFixed(1)}%`);
console.log(`Residuals: ${compressed.residuals.length} messages`);
```

### Example 2: Token Budget Allocation

```typescript
import { MxfStructuredPromptBuilder } from '@/sdk/services/MxfStructuredPromptBuilder';

const builder = new MxfStructuredPromptBuilder(agent);

const { structure, budget } = await builder.buildPromptStructureWithBudget(
  systemPrompt,
  taskPrompt,
  conversationHistory,
  4000  // Token budget
);

console.log(`Total: ${budget.total}`);
console.log(`Residuals: ${budget.allocated.residuals}`);
console.log(`Tier 0: ${budget.allocated.tier0}`);
console.log(`Tier 1: ${budget.allocated.tier1}`);
console.log(`Tier 2: ${budget.allocated.tier2}`);
console.log(`Tier 3: ${budget.allocated.tier3}`);
console.log(`Utilization: ${budget.utilizationPercent.toFixed(1)}%`);
```

### Example 3: Progressive Disclosure with Segment Registry

```typescript
import { PromptSegmentRegistry } from '@/shared/prompts/PromptSegmentRegistry';

const registry = PromptSegmentRegistry.getInstance();

const context = {
  hasControlLoopTools: true,
  isMultiAgentChannel: true,
  hasErrorOccurred: false,
  isMxpEnabled: true,
  condensedMode: false,
  channelAgentCount: 5
};

const systemPrompt = registry.buildSystemPrompt(context, 2500);
// Includes: core-framework, orpar-cycle, collaboration-patterns,
//           tool-guidelines-full, mxp-protocol
// Excludes: error-handling (not occurred), tool-guidelines-condensed
```

## Performance Characteristics

### Compression Ratios

- **Tier 0**: 0% compression (100% preserved)
- **Tier 1**: 30% compression (70% preserved)
- **Tier 2**: 60% compression (40% preserved)
- **Tier 3**: 85% compression (15% preserved)
- **Residuals**: 0% compression (100% preserved, skip-connected)

### Typical Results

For a 1000-message conversation:
- **Original**: ~5200 tokens
- **Compressed**: ~1600 tokens
- **Ratio**: 31% (69% reduction)
- **Residuals**: 2-5% of messages
- **Latency**: < 500ms

## Best Practices

1. **Enable Feature Flags**: Ensure all environment variables are set
2. **Monitor Residuals**: Track residual extraction rate and budget usage
3. **Tune Thresholds**: Adjust `RESIDUAL_THRESHOLD` based on use case
4. **Cache Summaries**: Leverage content-hash caching for repeated patterns
5. **Budget First**: Always allocate residuals before tiers
6. **Progressive Disclosure**: Use segment registry for conditional system prompts
7. **Track Metrics**: Monitor compression ratios and token savings

## Troubleshooting

### High Residual Count

**Actions**:
- Increase `RESIDUAL_THRESHOLD` (e.g., 70 or 80)
- Review importance scoring logic
- Check for excessive decision language in conversation

### Poor Compression

**Check**:
- Tier configuration (adjust tier sizes)
- SystemLLM summarization quality
- Keyword preservation effectiveness
- Cache hit rate

### Budget Overrun

**Actions**:
- Reduce fixed component sizes
- Increase total token budget
- Lower residual max percent
- Compress tier0 (currently uncompressed)

## Related Documentation

- [Dynamic Inference Parameters](dynamic-inference-parameters.md)
- [TOON Optimization](toon-optimization.md)
- [MXP Protocol](mxp-protocol.md)
- [System Overview](system-overview.md)

## Implementation Files

**Core**: `src/shared/mxp/ContextCompressionEngine.ts`
**Scoring**: `src/shared/prompts/MemoryPromptInjector.ts`
**Builder**: `src/sdk/services/MxfStructuredPromptBuilder.ts`
**Registry**: `src/shared/prompts/PromptSegmentRegistry.ts`
