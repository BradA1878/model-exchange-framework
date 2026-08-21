# SystemLLM Service

The **SystemLLM Service** is MXF's centralized AI intelligence layer that powers autonomous agent operations. It provides structured LLM interactions with JSON schema enforcement, dynamic model selection, and comprehensive coordination capabilities.

## Overview

SystemLLM is a server-side service that handles all AI-powered decision-making and reasoning for the MXF framework. Unlike client-side agent LLMs, SystemLLM operates with **one isolated instance per channel** for independent, concurrent operations.

**Key Characteristics**:
- **Server-Side**: Runs on the MXF server, not in agents
- **Per-Channel Isolation**: One SystemLlmService instance per channel (managed by SystemLlmServiceManager)
- **Channel Independence**: Each channel operates with its own configuration, context, and state
- **Schema-Enforced**: All outputs validated against JSON schemas
- **Multi-Provider**: Supports OpenRouter, Gemini, OpenAI, Anthropic, XAI, Ollama
- **Dynamic Selection**: The configured model for an operation can upgrade to a more capable sibling as task complexity increases

## Architecture

### Per-Channel Instance Model

SystemLLM uses a **one-instance-per-channel** architecture:

<div class="mermaid-fallback">

```mermaid
graph TB
    subgraph "Client Layer"
        A1[Agent 1]
        A2[Agent 2]
        A3[Agent 3]
    end

    subgraph "Server Layer"
        SLSM[SystemLlmServiceManager<br/>Singleton]

        subgraph "Channel A"
            SLS1[SystemLlmService<br/>Instance A]
            CL1[ControlLoop A]
        end

        subgraph "Channel B"
            SLS2[SystemLlmService<br/>Instance B]
            CL2[ControlLoop B]
        end

        subgraph "Channel C"
            SLS3[SystemLlmService<br/>Instance C]
            CL3[ControlLoop C]
        end
    end

    subgraph "LLM Providers"
        OR[OpenRouter]
        GEM[Gemini]
        OAI[OpenAI]
        ANT[Anthropic]
    end

    A1 -->|ORPAR Events| CL1
    A2 -->|ORPAR Events| CL2
    A3 -->|ORPAR Events| CL3

    CL1 -->|Request AI| SLS1
    CL2 -->|Request AI| SLS2
    CL3 -->|Request AI| SLS3

    SLSM -->|Creates & Manages| SLS1
    SLSM -->|Creates & Manages| SLS2
    SLSM -->|Creates & Manages| SLS3

    SLS1 -->|API Calls| OR
    SLS2 -->|API Calls| GEM
    SLS3 -->|API Calls| OAI

    style SLSM fill:#f5e1e1
    style SLS1 fill:#e1f5e1
    style SLS2 fill:#e1f5e1
    style SLS3 fill:#e1f5e1
```

</div>

<iframe src="../diagram/per-channel-instance.html" width="100%" height="540" style="border: none; border-radius: 10px; background: var(--bg-secondary);"></iframe>

**Key Benefits**:
- **Isolation**: Channel A's operations don't affect Channel B
- **Concurrency**: All channels operate simultaneously without blocking
- **Configuration**: Each channel can use different providers/models
- **Scalability**: Supports unlimited channels without bottlenecks
- **Context Preservation**: Each instance maintains its own ORPAR context

## Core Responsibilities

### 1. ORPAR Cognitive Operations

SystemLLM powers all five phases of the ORPAR cycle:

#### Observation Processing
```typescript
processObservationData(observations: Observation[], context?: OrparContext): Observable<any>
```
- **Model**: Fast, efficient (e.g., `gemini-2.0-flash-lite-001`)
- **Purpose**: Analyze agent observations for collaboration opportunities
- **Focus**: Cross-agent collaboration, skill synergy, communication optimization

#### Reasoning Analysis
```typescript
// Handled via observation processing with reasoning focus
```
- **Model**: Advanced reasoning (e.g., `claude-3.5-sonnet`)
- **Purpose**: Deep analysis and hypothesis generation
- **Focus**: Strategic insights, pattern detection, coordination strategies

#### Plan Creation
```typescript
createPlan(reasoning: Reasoning, context?: OrparContext, previousPlans?: Plan[]): Observable<Plan>
```
- **Model**: Strategic planning (e.g., `gemini-2.5-pro-preview-05-06`)
- **Purpose**: Generate executable action plans
- **Focus**: Multi-agent coordination, resource sharing, task distribution
- **Output**: JSON schema-validated Plan with ordered actions

#### Action Analysis
```typescript
analyzeActionExecution(action: PlanAction, result: any, context?: OrparContext): Observable<any>
```
- **Model**: Reliable execution (e.g., `gpt-4o-mini`)
- **Purpose**: Analyze action execution and impact
- **Focus**: Multi-agent impact, coordination opportunities, resource implications

#### Reflection Generation
```typescript
generateReflection(plan: Plan, actions: PlanAction[], results: any[], context?: OrparContext): Observable<Reflection>
```
- **Model**: Meta-cognitive (e.g., `claude-3.5-sonnet`)
- **Purpose**: Meta-cognitive analysis of cycle performance
- **Focus**: Coordination effectiveness, learning opportunities, efficiency assessment

### 2. JSON Schema Enforcement

All SystemLLM operations use strict JSON schemas:

```typescript
// Topic Extraction Schema
TOPIC_EXTRACTION_SCHEMA = {
    type: 'object',
    properties: {
        topics: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    relevance: { type: 'number', minimum: 0, maximum: 1 },
                    keywords: { type: 'array', items: { type: 'string' } }
                },
                required: ['name', 'relevance']
            }
        }
    },
    required: ['topics']
};

// Reasoning Analysis Schema
REASONING_ANALYSIS_SCHEMA = {
    type: 'object',
    properties: {
        analysis: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        keyInsights: { type: 'array', items: { type: 'string' } },
        recommendations: { type: 'array', items: { type: 'string' } }
    },
    required: ['analysis', 'confidence']
};

// Plan Creation Schema
PLAN_CREATION_SCHEMA = {
    type: 'object',
    properties: {
        plan: {
            type: 'object',
            properties: {
                goal: { type: 'string' },
                description: { type: 'string' },
                actions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            description: { type: 'string' },
                            action: { type: 'string' },
                            parameters: { type: 'object' },
                            priority: { type: 'number' },
                            dependencies: { type: 'array', items: { type: 'string' } },
                            status: { type: 'string', enum: ['pending', 'executing', 'completed', 'failed'] }
                        },
                        required: ['id', 'description', 'action', 'priority', 'status']
                    }
                }
            },
            required: ['goal', 'actions']
        }
    },
    required: ['plan']
};

// Reflection Schema
REFLECTION_SCHEMA = {
    type: 'object',
    properties: {
        success: { type: 'boolean' },
        insights: { type: 'array', items: { type: 'string' } },
        improvements: { type: 'array', items: { type: 'string' } },
        metrics: {
            type: 'object',
            properties: {
                effectiveness: { type: 'number', minimum: 0, maximum: 1 },
                efficiency: { type: 'number', minimum: 0, maximum: 1 }
            }
        }
    },
    required: ['success', 'insights']
};
```

### 3. Dynamic Model Selection

SystemLLM has no built-in model ids. It selects a model for each ORPAR operation
from what the operator configured, then optionally upgrades that choice based on
task complexity.

#### Operation-Specific Models

`SYSTEMLLM_DEFAULT_MODEL` is the model for every ORPAR operation — observation,
reasoning, action, planning, and reflection — unless that operation has its own
override:

| Operation   | Override variable             |
|-------------|--------------------------------|
| observation | `SYSTEMLLM_MODEL_OBSERVATION`  |
| reasoning   | `SYSTEMLLM_MODEL_REASONING`    |
| action      | `SYSTEMLLM_MODEL_ACTION`       |
| planning    | `SYSTEMLLM_MODEL_PLANNING`     |
| reflection  | `SYSTEMLLM_MODEL_REFLECTION`   |

Coordination suggestions are not an ORPAR operation, but they use the observation
model — they are short, so they use the operation configured for fast, light work.

> **Note:** Model ids change often. The ids in these docs are a snapshot of what was
> available when they were written; providers add, rename, and retire models all the
> time. Check your provider's current list before relying on an id — for OpenRouter,
> <https://openrouter.ai/models>. For Claude on OpenRouter, `~anthropic/claude-opus-latest`,
> `~anthropic/claude-sonnet-latest`, and `~anthropic/claude-haiku-latest` resolve to the
> newest release in each family, so they are the ids to use unless you need a specific
> version. `~anthropic/claude-fable-latest` is the same kind of alias for the top-tier
> family; it is priced well above the others and nothing in MXF selects it by default.

#### Complexity-Based Upgrades

Models automatically upgrade based on context complexity. The upgrade always
starts from the model configured for the operation (`SYSTEMLLM_DEFAULT_MODEL`,
or its per-operation override) — there is no built-in base model to fall back to:

```typescript
getModelForOperationWithComplexity(
    operation: OrparOperationType,
    context?: OrparContext,
    complexityOverride?: 'simple' | 'moderate' | 'complex'
): string
```

**Complexity Assessment Factors**:
- **Phase Completion** (0.2 per phase): More completed phases = higher complexity
- **Error Count** (0.5 per error): More errors = higher complexity
- **Context Richness** (0.1 per element): More context = higher complexity
- **Result Size** (0.3-0.8): Larger results = higher complexity
- **Confidence** ((1 - confidence) * 0.5): Lower confidence = higher complexity
- **Time Elapsed** (0.2 per hour): Longer cycles = higher complexity
- **Model Variance** (0.3-0.5): Frequent model changes = higher complexity

**Complexity Thresholds**:
- **Simple**: < 1.2 → Base models
- **Moderate**: 1.2 - 3.0 → Upgraded models
- **Complex**: > 3.0 → Premium models

Upgrades are off unless `SYSTEMLLM_DYNAMIC_MODEL_SELECTION=true`: an upgrade
changes which model spends the money, so it is the operator's call.

**Upgrade table** (`MODEL_UPGRADES` in `SystemLlmService.ts`, keyed by the
configured model id; an id with no entry is used as configured). On OpenRouter
every target is one of the `~anthropic/claude-*-latest` aliases, so a new
release is picked up at every tier without editing the table:

| Configured model | moderate | complex |
|---|---|---|
| cheap non-Claude (`google/gemini-2.5-flash`, `openai/gpt-5-mini`, `openai/gpt-5-nano`, small Llama/Qwen/Phi) | `~anthropic/claude-haiku-latest` | `~anthropic/claude-sonnet-latest` |
| mid-tier non-Claude (`openai/gpt-5.2`, `google/gemini-2.5-pro`, 70B Llama, Qwen 32B, Grok, Mistral Large, DeepSeek) | `~anthropic/claude-sonnet-latest` | `~anthropic/claude-opus-latest` |
| `~anthropic/claude-haiku-latest` and pinned Haiku releases | `~anthropic/claude-sonnet-latest` | `~anthropic/claude-opus-latest` |
| `~anthropic/claude-sonnet-latest` | `~anthropic/claude-opus-latest` | `~anthropic/claude-opus-latest` |
| pinned Sonnet releases | `~anthropic/claude-sonnet-latest` | `~anthropic/claude-opus-latest` |
| `~anthropic/claude-opus-latest` and pinned Opus releases | `~anthropic/claude-opus-latest` | `~anthropic/claude-opus-latest` |

`~anthropic/claude-fable-latest` is never an upgrade target. Direct-API
providers (OpenAI, Azure OpenAI, Anthropic) have no latest-resolution aliases
and keep release ids in their tables; the other providers have no upgrade paths.

## Configuration

### Environment Variable Configuration

SystemLLM can be configured globally via environment variables:

```env
# Master switch. SystemLLM is on unless this is exactly 'false' — an unset
# variable means on.
SYSTEMLLM_ENABLED=true

# Provider for SystemLLM operations. Default: openrouter
# Options: openrouter, azure-openai, openai, anthropic, gemini, xai, ollama
SYSTEMLLM_PROVIDER=openrouter

# Required whenever SystemLLM is on — there is no built-in model. The server
# refuses to boot without it (and without the provider's credential; see
# below). Check your provider's current model list before choosing an id.
SYSTEMLLM_DEFAULT_MODEL=~anthropic/claude-sonnet-latest

# Optional per-operation overrides. Each, when set, replaces the default
# model for that one ORPAR operation; coordination suggestions use the
# observation model. A variable that is set but blank is a boot error.
# SYSTEMLLM_MODEL_OBSERVATION=
# SYSTEMLLM_MODEL_REASONING=
# SYSTEMLLM_MODEL_ACTION=
# SYSTEMLLM_MODEL_PLANNING=
# SYSTEMLLM_MODEL_REFLECTION=

# Complexity-based upgrades into the latest Claude aliases (see the upgrade
# table above). Off by default for every provider; set to true to enable.
# SYSTEMLLM_DYNAMIC_MODEL_SELECTION=true

# Hard daily spend ceiling in USD. Calls are refused once spend reaches this.
# Default: 10
SYSTEMLLM_DAILY_BUDGET_USD=10

# Fraction of the ceiling at which a warning is logged. Default: 0.8
SYSTEMLLM_BUDGET_WARN_AT=0.8
```

Boot fails fast when SystemLLM is on and misconfigured. Missing
`SYSTEMLLM_DEFAULT_MODEL` fails with:

```
Missing required environment variable SYSTEMLLM_DEFAULT_MODEL. SystemLLM is on
and has no built-in model. Set the model it should use (for example
~anthropic/claude-sonnet-latest on OpenRouter), or set SYSTEMLLM_ENABLED=false.
```

A missing provider credential (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, or the three
`AZURE_OPENAI_*` variables for azure-openai; ollama needs none) fails the same
way. There is no way to opt out of these checks short of `SYSTEMLLM_ENABLED=false`.

**Dynamic Model Selection**:
- When `true`: the model configured for an operation can upgrade to a more capable sibling based on task complexity (simple/moderate/complex)
- When `false`: uses each operation's configured model as-is, with no upgrade attempt
- Default: `true` for OpenRouter, `false` for other providers

**Provider-Specific Examples**:

```env
# Azure OpenAI Example (single model, no dynamic selection)
SYSTEMLLM_ENABLED=true
SYSTEMLLM_PROVIDER=azure-openai
SYSTEMLLM_DEFAULT_MODEL=gpt-4o-mini
SYSTEMLLM_DYNAMIC_MODEL_SELECTION=false
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=your-deployment-name

# OpenRouter Example (one configured model; upgrades opted in)
SYSTEMLLM_ENABLED=true
SYSTEMLLM_PROVIDER=openrouter
SYSTEMLLM_DEFAULT_MODEL=~anthropic/claude-sonnet-latest
SYSTEMLLM_DYNAMIC_MODEL_SELECTION=true
OPENROUTER_API_KEY=your-key
```

### Service Configuration

```typescript
interface SystemLlmServiceConfig {
    providerType?: LlmProviderType;
    defaultModel: string;  // Required — there is no built-in model
    defaultTemperature?: number;
    defaultMaxTokens?: number;
    orparModels?: Partial<OrparModelConfig>;
    enableRealTimeCoordination?: boolean;
    enableDynamicModelSelection?: boolean;  // Control complexity-based model switching
}

// Example - Code-based configuration (overrides environment variables).
// A service is owned by one channel; the manager normally constructs it.
const service = new SystemLlmService('channel-id', {
    providerType: LlmProviderType.OPENROUTER,
    defaultModel: '~anthropic/claude-sonnet-latest',
    defaultTemperature: 0.3,
    defaultMaxTokens: 2000,
    orparModels: {
        reasoning: '~anthropic/claude-opus-latest',  // Override for complex reasoning
        planning: 'openai/o1-preview'          // Override for strategic planning
    },
    enableRealTimeCoordination: true,
    enableDynamicModelSelection: true  // Enable smart model selection
});
```

### Per-Channel Configuration

**IMPORTANT**: SystemLLM creates **one instance per channel** via `SystemLlmServiceManager`. Each channel gets its own isolated SystemLlmService with independent configuration and state.

```typescript
const manager = SystemLlmServiceManager.getInstance();

// Get SystemLlmService instance for a specific channel
// Returns existing instance if already created, otherwise creates new one
const service = manager.getServiceForChannel('channel-123', {
    providerType: LlmProviderType.ANTHROPIC,
    defaultModel: 'claude-3-5-sonnet-20241022',
    orparModels: {
        observation: 'claude-3-5-haiku-20241022',
        reasoning: 'claude-3-5-sonnet-20241022',
        planning: 'claude-3-5-sonnet-20241022',
        reflection: 'claude-3-5-sonnet-20241022'
    }
});

// Returns null if SYSTEMLLM_ENABLED=false
if (!service) {
    console.log('SystemLLM is disabled');
}
```

## Advanced Features

### 1. Batch Processing

Process multiple operations in parallel:

```typescript
// Batch observation processing
batchProcessObservations(
    batches: Array<{
        agentId: string;
        observations: Observation[];
        context?: OrparContext;
    }>
): Observable<Array<{ agentId: string; result: any; error?: Error }>>

// Batch action analysis
batchAnalyzeActions(
    batches: Array<{
        actionId: string;
        action: PlanAction;
        executionResult: any;
        context?: OrparContext;
    }>
): Observable<Array<{ actionId: string; result: any; error?: Error }>>

// Batch plan creation
batchCreatePlans(
    requests: Array<{
        planId: string;
        reasoning: Reasoning;
        context?: OrparContext;
        previousPlans?: Plan[];
    }>
): Observable<Array<{ planId: string; result: Plan | null; error?: Error }>>
```

### 2. Parallel LLM Requests

Execute multiple LLM requests simultaneously with different models:

```typescript
parallelLlmRequests(
    requests: Array<{
        id: string;
        prompt: string;
        operation: OrparOperationType;
        schema?: any;
        context?: OrparContext;
        options?: any;
    }>
): Observable<Array<{ id: string; result: string; model: string; error?: Error }>>
```

### 3. Context-Aware Prompting

Build prompts with full ORPAR context:

```typescript
private buildContextAwarePrompt(basePrompt: string, context?: OrparContext): string {
    if (!context) return basePrompt;
    
    let prompt = basePrompt;
    
    // Add previous phase results
    if (context.previousPhaseResults) {
        prompt += '\n\nPREVIOUS RESULTS:\n';
        // ... include relevant prior results
    }
    
    // Add shared context
    if (context.sharedContext) {
        prompt += '\n\nSHARED CONTEXT:\n';
        prompt += `Goals: ${context.sharedContext.goals.join(', ')}\n`;
        prompt += `Constraints: ${context.sharedContext.constraints.join(', ')}\n`;
        // ... include other shared context
    }
    
    return prompt;
}
```

### 4. Metrics Collection

Comprehensive metrics tracking:

```typescript
interface SystemLlmMetrics {
    requestCount: number;
    totalResponseTime: number;
    errorCount: number;
    lastRequestTime: Date | null;
    operationBreakdown: {
        observation: number;
        reasoning: number;
        planning: number;
        action: number;
        reflection: number;
    };
    responseTimeBreakdown: Map<OrparOperationType, number>;
    modelUsage: Map<string, number>;
    errorBreakdown: Map<string, number>;
}
```

## Event System Integration

SystemLLM emits events for monitoring:

```typescript
// LLM Instruction Events
Events.System.LLM_INSTRUCTION_STARTED
Events.System.LLM_INSTRUCTION_COMPLETED
Events.System.LLM_INSTRUCTION_ERROR

// Event Payload Example
interface LlmInstructionStartedEventData {
    instructionId: string;
    operation: string;
    model?: string;
    timestamp: number;
}

interface LlmInstructionCompletedEventData {
    instructionId: string;
    operation: string;
    result: string;
    duration: number;
    timestamp: number;
}
```

## Error Handling and Recovery

### Network Error Classification

```typescript
enum NetworkErrorType {
    TIMEOUT = 'timeout',
    CONNECTION_REFUSED = 'connection_refused',
    DNS_FAILURE = 'dns_failure',
    RATE_LIMIT = 'rate_limit',
    AUTHENTICATION = 'authentication',
    INVALID_REQUEST = 'invalid_request',
    SERVER_ERROR = 'server_error',
    UNKNOWN = 'unknown'
}
```

### Retry Strategies

```typescript
async sendLlmRequestWithRecovery(
    prompt: string,
    schema: any | null,
    options: any
): Promise<string> {
    const maxRetries = 3;
    const baseDelay = 1000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await this.sendLlmRequest(prompt, schema, options);
        } catch (error) {
            const errorType = classifyNetworkError(error);
            
            if (errorType === NetworkErrorType.RATE_LIMIT) {
                // Exponential backoff for rate limits
                const delay = baseDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            if (attempt === maxRetries) throw error;
        }
    }
}
```

## Performance Characteristics

### Latency

- **Model Selection**: < 5ms
- **Complexity Assessment**: < 10ms
- **Prompt Building**: < 20ms
- **LLM Request** (varies by model):
  - Fast models (flash-lite): 500-1000ms
  - Standard models (sonnet): 1000-2000ms
  - Premium models (opus): 2000-5000ms
  - Reasoning models (o1): 5000-20000ms

### Throughput

- **Concurrent Requests**: 100+ simultaneous requests
- **Batch Processing**: 1000+ operations/batch
- **Channel Instances**: Unlimited (one per channel)

### Resource Usage

- **Memory**: ~50MB per SystemLlmService instance
- **CPU**: Minimal (network I/O bound)
- **Network**: Depends on LLM provider

## Usage Examples

### Basic Usage

```typescript
import { SystemLlmService } from './src/server/socket/services/SystemLlmService';

const systemLlm = new SystemLlmService('channel-id', {
    providerType: LlmProviderType.OPENROUTER,
    defaultModel: '~anthropic/claude-sonnet-latest'
});

// Process observations
const observations = [
    { id: '1', agentId: 'agent-1', source: 'user', content: 'Help me', timestamp: Date.now() }
];

systemLlm.processObservationData(observations).subscribe({
    next: (analysis) => console.log('Analysis:', analysis),
    error: (error) => console.error('Error:', error)
});
```

### ORPAR Cycle Integration

```typescript
// In ControlLoop.ts — the manager owns one service per channel and returns
// null when SystemLLM is off for that channel.
async processObservations(observations: Observation[]): Promise<Reasoning | null> {
    const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(this.channelId);
    if (!systemLlmService) {
        return null;
    }

    try {
        const analysis = await lastValueFrom(
            systemLlmService.processObservationData(observations, this.context)
        );
        
        const reasoning: Reasoning = {
            id: uuidv4(),
            agentId: this.agentId,
            content: analysis,
            timestamp: Date.now()
        };
        
        return reasoning;
    } catch (error) {
        logger.error('Failed to process observations:', error);
        return null;
    }
}
```

### Channel-Specific Configuration

```typescript
import { SystemLlmServiceManager } from './src/server/socket/services/SystemLlmServiceManager';

const manager = SystemLlmServiceManager.getInstance();

// Each call creates a separate SystemLlmService instance for that channel
// Dev channel: Uses fast, cheap models via OpenRouter
const devChannel = manager.getServiceForChannel('dev-channel', {
    providerType: LlmProviderType.OPENROUTER,
    orparModels: {
        observation: 'google/gemini-2.0-flash-lite-001',  // Fast & cheap for dev
        reasoning: 'openai/gpt-4o-mini',
        planning: 'openai/gpt-4o-mini',
        reflection: 'openai/gpt-4o-mini'
    }
});

// Prod channel: Uses high-quality models via Anthropic
// This is a SEPARATE instance from devChannel
const prodChannel = manager.getServiceForChannel('prod-channel', {
    providerType: LlmProviderType.ANTHROPIC,
    orparModels: {
        observation: 'claude-3-5-haiku-20241022',
        reasoning: 'claude-3-5-sonnet-20241022',         // High quality for prod
        planning: 'claude-3-5-sonnet-20241022',
        reflection: 'claude-3-5-sonnet-20241022'
    }
});

// Each instance operates independently:
// - Separate API connections
// - Independent ORPAR context
// - Isolated metrics
// - No shared state
```

## Best Practices

### 1. Model Selection

- **Set `SYSTEMLLM_DEFAULT_MODEL`** — there is no built-in model, and the server will not start without it
- **Override per operation** only when one ORPAR phase genuinely needs a different model
- **Monitor complexity** scores to understand when the upgrade table swaps in a more capable model
- **Watch the daily budget** (`SYSTEMLLM_DAILY_BUDGET_USD`) — calls are refused once it's spent

### 2. Prompt Engineering

- **Be specific** about coordination and collaboration needs
- **Include context** using `OrparContext` for better results
- **Use schemas** to enforce structured outputs
- **Test prompts** across different complexity levels

### 3. Error Handling

- **Implement retries** with exponential backoff
- **Handle rate limits** gracefully
- **Log errors** with sufficient context
- **Fall back** to simpler models on complex model failures

### 4. Performance Optimization

- **Batch operations** when processing multiple items
- **Use parallel requests** for independent operations
- **Cache results** when appropriate
- **Monitor metrics** to identify bottlenecks

### 5. Channel Configuration

- **One instance per channel**: SystemLlmServiceManager automatically creates isolated instances
- **Always use manager**: Call `getServiceForChannel()` to get/create channel-specific instances
- **Avoid direct instantiation**: Never create `new SystemLlmService()` directly - use the manager
- **Share configurations**: Pass same config object for similar channels
- **Automatic cleanup**: Manager handles cleanup when channels are destroyed
- **Check for null**: `getServiceForChannel()` returns `null` when `SYSTEMLLM_ENABLED=false`

## Integration with MXF Components

### ControlLoop
- Each ControlLoop uses its channel's SystemLlmService instance
- Powers all ORPAR phase operations
- Provides AI-driven decision making
- Maintains context across cycles

### PatternLearningService
- Uses channel-specific SystemLlmService instance
- Learns from successful ORPAR patterns
- Optimizes future operations
- Shares insights across agents

### ChannelService
- Triggers SystemLlmServiceManager to create per-channel instances
- Channel-specific configurations
- Independent operation per channel
- Resource isolation

### SystemLlmServiceManager (Singleton)
- **Creates one SystemLlmService instance per channel**
- Manages lifecycle of all channel instances
- Provides `getServiceForChannel(channelId, config?)` API
- Returns `null` when SystemLLM is disabled
- Automatically cleans up when channels are destroyed

### EventBus
- Emits LLM instruction events
- Receives ORPAR phase requests
- Coordinates with other services

## Summary

SystemLLM Service is the AI intelligence backbone of MXF, providing:

1. **Centralized AI Operations**: Single service for all server-side AI needs
2. **ORPAR Integration**: Powers all five cognitive cycle phases
3. **Dynamic Model Selection**: The configured model for an operation can upgrade to a more capable sibling as task complexity increases
4. **JSON Schema Enforcement**: Structured, validated outputs
5. **Multi-Provider Support**: Works with all major LLM providers
6. **Performance Optimization**: Batch processing, parallel execution, caching
7. **Channel Isolation**: Independent configuration per channel
8. **Comprehensive Metrics**: Full observability of AI operations

SystemLLM enables MXF to provide truly intelligent, adaptive, multi-agent coordination at scale.

## Related Documentation

- [ORPAR Cognitive Cycle](orpar.md) - The pattern SystemLLM powers
- [Control Loop API](../api/control-loop.md) - REST and WebSocket APIs
- [Server Services](server-services.md) - Other server services
- [Key Concepts](key-concepts.md) - Fundamental MXF concepts
- [Configuration Manager](../sdk/config-manager.md) - SDK-level configuration
