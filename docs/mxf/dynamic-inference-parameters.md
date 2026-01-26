# Dynamic Inference Parameters (ORPAR)

## Overview

Dynamic Inference Parameters enable agents to operate with phase-optimized LLM configurations during ORPAR (Observation, Reasoning, Planning, Action, Reflection) cognitive cycles. This feature provides metacognitive control, allowing agents to request parameter adjustments when they recognize their current configuration is insufficient for the task at hand.

## Key Features

- **Phase-Aware Profiles**: Optimized parameter sets for each ORPAR phase
- **Configuration Hierarchy**: Task → Agent → Channel → Defaults
- **Runtime Adjustment**: Agents can request parameter changes via MCP tools
- **Cost Governance**: Budget limits and rate limiting for cost control
- **Pattern Learning**: Analytics feed into adaptive optimization
- **Provider Support**: Pre-configured profiles for OpenRouter, Gemini, OpenAI, Anthropic, XAI, Ollama

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONFIGURATION HIERARCHY                       │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │  Task    │→ │  Agent   │→ │ Channel  │→ │ Defaults │       │
│   │ Override │  │  Config  │  │ Defaults │  │ (System) │       │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ORPAR PHASE PROFILES                          │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │Observ    │  │Reasoning │  │ Planning │  │ Action   │       │
│   │Fast/Low  │  │Deep/High │  │Struct/Med│  │Precise   │       │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                ┌──────────┐                     │
│                                │Reflection│                     │
│                                │Eval/Med  │                     │
│                                └──────────┘                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  INFERENCE PARAMETER SERVICE                     │
│   • Request Processing                                          │
│   • Governance Evaluation                                       │
│   • Override State Management                                   │
│   • Cost Tracking & Analytics                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Default Phase Profiles

### Observation Phase
**Purpose**: Accurate data intake without hallucination

```typescript
{
  model: 'google/gemini-2.5-flash',
  temperature: 0.2,              // Low for deterministic output
  reasoningTokens: 0,            // No extended thinking needed
  maxOutputTokens: 2000,
  topP: 0.9
}
```

### Reasoning Phase
**Purpose**: Deep analysis and solution space exploration

```typescript
{
  model: 'anthropic/claude-sonnet-4-5',
  temperature: 0.5,              // Moderate for exploratory thinking
  reasoningTokens: 8000,         // Extended thinking budget
  maxOutputTokens: 4000,
  topP: 0.95
}
```

### Planning Phase
**Purpose**: Structured, deterministic plan generation

```typescript
{
  model: 'google/gemini-2.5-pro',
  temperature: 0.3,              // Low for consistent planning
  reasoningTokens: 4000,         // Strategic thinking budget
  maxOutputTokens: 4000,
  topP: 0.9
}
```

### Action Phase
**Purpose**: Reliable, precise tool execution

```typescript
{
  model: 'openai/gpt-4.1-mini',
  temperature: 0.1,              // Very low for deterministic behavior
  reasoningTokens: 0,            // Actions should be deterministic
  maxOutputTokens: 2000,
  topP: 0.8
}
```

### Reflection Phase
**Purpose**: Genuine evaluative assessment

```typescript
{
  model: 'anthropic/claude-sonnet-4-5',
  temperature: 0.4,              // Moderate for balanced evaluation
  reasoningTokens: 4000,         // Evaluation thinking budget
  maxOutputTokens: 2000,
  topP: 0.9
}
```

## MCP Tools

### request_inference_params

Request inference parameter modifications for improved task performance.

**When to Use:**
- Complex reasoning task needs more reasoning tokens
- Precision task needs lower temperature
- Creative task needs higher temperature
- Resource-intensive task needs a more capable model

**Input Schema:**
```typescript
{
  reason: string,              // Required: Why the adjustment is needed
  suggested: {
    model?: string,            // e.g., "anthropic/claude-sonnet-4-5"
    temperature?: number,      // 0.0-2.0
    reasoningTokens?: number,  // Extended thinking budget
    maxOutputTokens?: number,  // Response length limit
    topP?: number              // 0.0-1.0
  },
  scope?: 'next_call' | 'current_phase' | 'remaining_task'
}
```

**Response:**
```typescript
{
  status: 'approved' | 'modified' | 'denied',
  activeParams: PhaseParameterProfile,
  rationale?: string,          // For modified/denied requests
  costDelta?: number,          // Estimated cost change (USD)
  overrideId?: string,         // Tracking ID
  expiresAt?: string           // When override expires
}
```

**Example:**
```typescript
const response = await agent.callTool('request_inference_params', {
  reason: 'This complex algorithm requires deep analysis with extended reasoning',
  suggested: {
    reasoningTokens: 12000,
    maxOutputTokens: 5000
  },
  scope: 'current_phase'
});

if (response.status === 'approved') {
  console.log('Reasoning tokens increased to:', response.activeParams.reasoningTokens);
}
```

### get_current_params

Get the current resolved parameters for a specific ORPAR phase.

**Input:**
```typescript
{
  phase: 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection'
}
```

**Response:**
```typescript
{
  phase: string,
  currentParams: PhaseParameterProfile,
  defaultParams: PhaseParameterProfile,
  hasActiveOverride: boolean
}
```

### get_parameter_status

Get status of active parameter overrides and request tracking.

**Response:**
```typescript
{
  serviceStats: {
    activeOverrides: number,
    requestTrackers: number,
    agentConfigs: number,
    channelDefaults: number,
    usageMetricsCount: number
  },
  allPhaseProfiles: OrparPhaseProfiles
}
```

### get_available_models

Get list of available models with capabilities and cost tiers.

**Input:**
```typescript
{
  tier?: 'ultra_cheap' | 'budget' | 'standard' | 'premium' | 'ultra_premium' | 'all'
}
```

**Response:**
```typescript
{
  models: Array<{
    model: string,
    tier: string,
    inputCostPer1k: number,
    outputCostPer1k: number,
    reasoningCostPer1k: number | null,
    supportsReasoning: boolean
  }>,
  totalCount: number,
  tiers: Record<string, string>
}
```

### get_parameter_cost_analytics

Get cost analytics for inference parameter usage.

**Input:**
```typescript
{
  timeRange?: '1h' | '24h' | '7d' | '30d',
  groupBy?: 'phase' | 'model' | 'agent' | 'hour'
}
```

**Response:**
```typescript
{
  timeRange: string,
  groupBy: string,
  summary: {
    totalExecutions: number,
    totalCost: string,
    avgCostPerExecution: string
  },
  breakdown: Array<{
    executions: number,
    totalCost: string,
    avgCost: string,
    avgLatencyMs: number,
    successRate: string
  }>,
  optimizationTips: string[]
}
```

## Configuration Hierarchy

Parameters are resolved in priority order:

1. **Task Overrides** (Highest Priority)
   - Temporary overrides for specific tasks
   - Scope: `next_call`, `current_phase`, or `remaining_task`

2. **Agent Configuration**
   - Agent-specific parameter profiles
   - Set during agent initialization or via API

3. **Channel Defaults**
   - Channel-wide default profiles
   - Applied to all agents in channel

4. **System Defaults** (Lowest Priority)
   - Global default profiles by provider
   - Defined in `DefaultPhaseProfiles.ts`

## Governance & Cost Control

### Default Governance Configuration

```typescript
{
  maxCostPerCall: 0.50,        // $0.50 max per LLM call
  maxCostPerTask: 5.00,        // $5.00 max per task
  maxRequestsPerPhase: 3,      // Max 3 parameter changes per phase
  maxRequestsPerTask: 10,      // Max 10 parameter changes per task
  allowedModels: [],           // Empty = all models allowed
  minTemperature: 0.0,
  maxTemperature: 2.0,
  maxReasoningTokens: 16000,
  maxOutputTokens: 8000,
  allowModelDowngrade: true,
  requireSystemLlmApproval: false
}
```

### Strict Governance (Production/Security)

```typescript
{
  maxCostPerCall: 0.10,        // $0.10 max per LLM call
  maxCostPerTask: 1.00,        // $1.00 max per task
  maxRequestsPerPhase: 1,      // Max 1 parameter change per phase
  maxRequestsPerTask: 3,       // Max 3 parameter changes per task
  allowedModels: [             // Limited to proven models
    'google/gemini-2.5-flash',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4.1-mini'
  ],
  minTemperature: 0.0,
  maxTemperature: 1.0,
  maxReasoningTokens: 4000,
  maxOutputTokens: 4000,
  allowModelDowngrade: false,
  requireSystemLlmApproval: true
}
```

## Model Cost Tiers

### Ultra-Cheap Tier (< $0.10/1M tokens)
- `google/gemini-2.5-flash` - $0.07/$0.30 per 1K tokens
- `openai/gpt-4.1-nano` - $0.10/$0.40 per 1K tokens

### Budget Tier (< $1.00/1M tokens)
- `openai/gpt-4.1-mini` - $0.15/$0.60 per 1K tokens
- `anthropic/claude-haiku-4` - $0.25/$1.25 per 1K tokens

### Standard Tier (< $5.00/1M tokens)
- `google/gemini-2.5-pro` - $1.25/$5.00 per 1K tokens (with reasoning)
- `anthropic/claude-sonnet-4` - $3.00/$15.00 per 1K tokens (with reasoning)

### Premium Tier (< $15.00/1M tokens)
- `anthropic/claude-sonnet-4-5` - $3.00/$15.00 per 1K tokens (with reasoning)
- `openai/gpt-4.1` - $2.50/$10.00 per 1K tokens (with reasoning)

### Ultra-Premium Tier (Most Capable)
- `anthropic/claude-opus-4-5` - $15.00/$75.00 per 1K tokens (with reasoning)

## Provider-Specific Profiles

### OpenRouter (Default)
Uses the default cross-provider profiles shown above.

### Gemini (Google AI)
```typescript
{
  observation: 'gemini-2.5-flash',
  reasoning: 'gemini-2.5-pro',
  planning: 'gemini-2.5-pro',
  action: 'gemini-2.5-flash',
  reflection: 'gemini-2.5-pro'
}
```

### OpenAI
```typescript
{
  observation: 'gpt-4.1-mini',
  reasoning: 'gpt-4.1',
  planning: 'gpt-4.1',
  action: 'gpt-4.1-mini',
  reflection: 'gpt-4.1'
}
```

### Anthropic
```typescript
{
  observation: 'claude-haiku-4',
  reasoning: 'claude-sonnet-4-5',
  planning: 'claude-sonnet-4-5',
  action: 'claude-haiku-4',
  reflection: 'claude-sonnet-4-5'
}
```

### Ollama (Local Models)
```typescript
{
  observation: 'llama3.2:3b',
  reasoning: 'llama3.1:8b',
  planning: 'llama3.1:8b',
  action: 'llama3.2:3b',
  reflection: 'llama3.1:8b'
}
```

## Usage Examples

### Example 1: Agent Requests More Reasoning Tokens

```typescript
// During reasoning phase, agent recognizes complexity
const response = await agent.callTool('request_inference_params', {
  reason: 'This algorithmic problem requires extensive search space exploration',
  suggested: {
    reasoningTokens: 12000,  // Increase from default 8000
    maxOutputTokens: 6000
  },
  scope: 'current_phase'
});

console.log(`Request ${response.status}`);
console.log(`Active reasoning tokens: ${response.activeParams.reasoningTokens}`);
console.log(`Estimated cost increase: $${response.costDelta}`);
```

### Example 2: Check Current Configuration

```typescript
// Check current parameters before requesting changes
const current = await agent.callTool('get_current_params', {
  phase: 'reasoning'
});

console.log(`Current model: ${current.currentParams.model}`);
console.log(`Reasoning tokens: ${current.currentParams.reasoningTokens}`);
console.log(`Has override: ${current.hasActiveOverride}`);
```

### Example 3: Analyze Cost Patterns

```typescript
// Review cost analytics to optimize parameter usage
const analytics = await agent.callTool('get_parameter_cost_analytics', {
  timeRange: '24h',
  groupBy: 'phase'
});

console.log(`Total cost: ${analytics.summary.totalCost}`);
console.log(`Avg per execution: ${analytics.summary.avgCostPerExecution}`);

analytics.breakdown.forEach(item => {
  console.log(`${item.phase}: ${item.totalCost} (${item.successRate} success)`);
});

analytics.optimizationTips.forEach(tip => {
  console.log(`TIP: ${tip}`);
});
```

### Example 4: Request Lower Temperature for Precision

```typescript
// Action phase needs deterministic tool execution
const response = await agent.callTool('request_inference_params', {
  reason: 'Critical data validation requires deterministic output',
  suggested: {
    temperature: 0.0,  // Maximum determinism
  },
  scope: 'next_call'
});
```

## Parameter Override Scopes

### next_call
Apply only to the immediately following LLM invocation.

```typescript
scope: 'next_call'
// Override consumed after one LLM call
```

### current_phase
Persist through the current ORPAR phase.

```typescript
scope: 'current_phase'
// Override active until phase changes (e.g., reasoning → planning)
```

### remaining_task
Persist until task completion.

```typescript
scope: 'remaining_task'
// Override active until task marked complete
```

## Analytics & Pattern Learning

The system tracks parameter usage metrics for optimization:

```typescript
interface ParameterUsageMetrics {
  profile: PhaseParameterProfile,
  phase: OrparPhase,
  taskType?: string,
  success: boolean,
  latencyMs: number,
  tokensUsed: {
    input: number,
    output: number,
    reasoning?: number
  },
  actualCost: number,
  qualityScore?: number,  // From reflection phase (0-1)
  timestamp: number
}
```

### Adaptive Profile Recommendations

Based on pattern learning and outcome correlation, the system can generate recommendations:

```typescript
interface AdaptiveProfileRecommendation {
  phase: OrparPhase,
  taskPattern?: string,
  recommendedChanges: Partial<PhaseParameterProfile>,
  confidence: number,  // 0-1
  expectedImprovement: {
    successRate?: number,
    costReduction?: number,
    latencyReduction?: number
  },
  sampleSize: number,
  generatedAt: number
}
```

## Environment Variables

Configure dynamic inference parameters via environment:

```bash
# Feature flag
DYNAMIC_INFERENCE_PARAMS_ENABLED=true

# Default governance
MAX_COST_PER_CALL=0.50
MAX_COST_PER_TASK=5.00
MAX_REQUESTS_PER_PHASE=3
MAX_REQUESTS_PER_TASK=10

# Model restrictions (comma-separated)
ALLOWED_MODELS=google/gemini-2.5-flash,anthropic/claude-sonnet-4-5

# Parameter limits
MIN_TEMPERATURE=0.0
MAX_TEMPERATURE=2.0
MAX_REASONING_TOKENS=16000
MAX_OUTPUT_TOKENS=8000

# Governance options
ALLOW_MODEL_DOWNGRADE=true
REQUIRE_SYSTEMLLM_APPROVAL=false
```

## Best Practices

1. **Start with Defaults**: Use default profiles and only request changes when necessary
2. **Provide Clear Reasons**: Help governance evaluation with specific explanations
3. **Monitor Costs**: Use analytics tools to track spending patterns
4. **Scope Appropriately**: Use `next_call` for one-off adjustments, `current_phase` for phase optimization
5. **Review Governance**: Adjust governance config based on use case (development vs production)
6. **Track Success**: Monitor success rates and quality scores to inform adaptive optimization
7. **Budget Awareness**: Use `get_available_models` to understand cost implications

## Troubleshooting

### Request Denied

**Check:**
- Governance configuration limits
- Cost per call/task budgets
- Allowed models list
- Rate limits (requests per phase/task)

### Request Modified

**Reasons:**
- Requested parameters exceed governance limits
- Model downgrade requested but not allowed
- Cost estimate exceeds budget
- SystemLLM suggested alternative

### High Costs

**Actions:**
- Review analytics with `get_parameter_cost_analytics`
- Check for excessive reasoning token usage
- Consider lower-tier models for simpler phases
- Implement stricter governance configuration

## Related Documentation

- [ORPAR Control Loop](orpar.md)
- [MXP Protocol](mxp-protocol.md)
- [Tool Reference](tool-reference.md)
- [System Overview](system-overview.md)

## Implementation Files

**Types**: `src/shared/types/InferenceParameterTypes.ts`
**Defaults**: `src/shared/constants/DefaultPhaseProfiles.ts`
**Tools**: `src/shared/protocols/mcp/tools/InferenceParameterTools.ts`
**Service**: `src/server/socket/services/InferenceParameterService.ts`
