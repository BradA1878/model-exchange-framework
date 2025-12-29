# Agentic Model Selection Guide

This guide helps you choose the best LLM models for agentic tool use in MXF. Models vary significantly in their ability to correctly call tools, follow schemas, chain multi-step operations, and recover from errors.

> **Last Updated**: December 2025
> **Note**: This guide reflects the latest model capabilities as of late 2025, including real-world testing within MXF.

## Quick Recommendations

| Use Case | Recommended Model | Alternative |
|----------|-------------------|-------------|
| **Production Agents** | Claude Opus 4.5 | Gemini 3 Pro |
| **High-Volume/Cost-Sensitive** | Claude Sonnet 4 | Gemini 3 Flash |
| **Local/Self-Hosted** | Qwen 3 (32B+) | Qwen 3-Coder |
| **Speed-Critical** | Gemini 3 Flash | Claude Haiku |
| **Complex Reasoning + Tools** | Claude Opus 4.5 | GPT-5.2 |

## Tier 1: Best for Agentic Tool Use

### Anthropic Claude (Recommended)

Claude models consistently demonstrate the best tool-calling accuracy and lowest error rates in production environments.

**Claude Opus 4.5** (Latest)
- **SWE-bench Verified**: 80.9% (highest score)
- **Tool Calling Errors**: 50-75% reduction vs other frontier models
- **Strengths**: Extended thinking with tool use, parallel tool calls, precise instruction following, excellent schema adherence
- **Best For**: Production agents, complex multi-step workflows, coding agents
- **Cost**: $15/$75 per million tokens (input/output)

**Claude Sonnet 4**
- **SWE-bench Verified**: 72.7-80.2%
- **Terminal-bench**: 43.2%
- **Strengths**: Excellent balance of speed, cost, and capability
- **Best For**: High-volume agentic workloads
- **Cost**: $3/$15 per million tokens

**Claude Haiku**
- **Strengths**: Fast, cost-effective for simple tool calls
- **Best For**: High-volume simple operations, observation phase in ORPAR
- **Latency**: ~500ms average

**Why Claude Excels**:
- Extended thinking mode can use tools during reasoning
- Tools used in parallel without losing context
- Excellent at extracting and saving key facts across sessions
- Lower hallucination rates when calling functions
- Native MCP support (Anthropic created MCP)

### Google Gemini 3

Gemini 3 introduced significant agentic improvements with "Thought Signatures" for reasoning retention during tool use.

**Gemini 3 Pro**
- **SWE-bench Verified**: 76.2%
- **Terminal-Bench 2.0**: 54.2%
- **WebDev Arena**: 1487 Elo (top score)
- **Strengths**: Excellent instruction following, large context window, multimodal tool use
- **Best For**: Web development agents, browser automation, multimodal tasks

**Gemini 3 Flash**
- **Strengths**: Very fast, cost-effective, good tool accuracy
- **Best For**: Speed-critical operations, high-volume tasks
- **Latency**: ~300-500ms

**Key Features**:
- **Thought Signatures**: Encrypted reasoning traces preserved across tool calls
- **Thinking Retention**: Maintains reasoning context during multi-step tool execution
- **Adjustable Logic Depth**: `thinking_level` parameter for per-request reasoning control
- Native bash tool support for agentic workflows

### OpenAI GPT-5.x Series

The GPT-5 series marked a significant improvement in OpenAI's tool-calling reliability, though earlier models (GPT-4, GPT-4o) had notable issues.

**GPT-5.2** (Latest)
- **τ2-bench (Telecom)**: 97% (vs <49% for all previous models)
- **Tool Calling Error Rate**: ~50% lower than other frontier models
- **Strengths**: Preambles for tool-call reasoning, allowed_tools parameter, native compaction
- **Best For**: Enterprise tool orchestration, long-running tasks

**GPT-5.1**
- **Strengths**: Adaptive reasoning, Windows/PowerShell support, Codex integration
- **Best For**: Enterprise environments, cross-platform agents

**GPT-5**
- **SWE-bench Verified**: 74.9%
- **Strengths**: 22% fewer output tokens, 45% fewer tool calls than o3
- **Best For**: Efficient agentic workflows

**Key Improvements in GPT-5.x**:
- "Think before tool call" preambles boost accuracy
- Dynamic `allowed_tools` parameter per request
- Reliable multi-tool chaining (dozens of sequential/parallel calls)
- Better schema compliance

> **MXF Testing Note**: While GPT-5/5.1/5.2 (full models) perform well, the smaller variants (**GPT-5-nano** and **GPT-5-mini**) struggle with long-running agentic tasks in MXF. These smaller models lose context during extended ORPAR cycles and have difficulty maintaining coherent multi-step tool chains. **Avoid GPT-5-nano and GPT-5-mini for production MXF agents.**

**Caution - Earlier OpenAI Models**: GPT-4, GPT-4o, and o1 models have known issues with:
- Tool argument hallucination
- Inconsistent schema adherence
- Poor multi-step tool chaining
- Function call formatting errors

## Tier 2: Capable with Caveats

### DeepSeek V3.2

DeepSeek V3.2 introduced "Thinking in Tool-Use" - reasoning integrated directly into tool execution.

- **Performance**: Comparable to GPT-5
- **DeepSeek V3.2-Speciale**: Surpasses GPT-5, rivals Gemini 3 Pro
- **Strengths**: Thinking retention mechanism, 1,800+ training environments, excellent for complex tool workflows
- **Limitations**: Newer model, less production track record

**Key Innovation**: Thinking Retention Mechanism preserves reasoning traces across tool iterations, unlike traditional models that discard internal reasoning.

**Note**: DeepSeek R1 (reasoning model) does NOT natively support function calling but can use tools via code actions.

### xAI Grok

- **Grok-4**: 33.33% on MCP-Universe benchmark
- **Best For**: Conversational agents with occasional tool use
- **Limitations**: Tool calling not primary strength

## Tier 3: Open Source / Local Models

### Qwen 3 (Recommended for Local)

Qwen models lead open-source options for tool calling by a significant margin.

**Qwen 3 (8B and larger)**
- **F1 Score**: 0.933 (tool calling accuracy)
- **Strengths**: Best open-source tool calling, Hermes-style tool use support
- **Serving**: vLLM (recommended), Ollama, LM Studio
- **Best For**: Local/self-hosted agents, cost-sensitive deployments

**Qwen 3-Coder**
- **Strengths**: Optimized for coding + tool use
- **Browser Automation**: Top performance in MCPToolBench++
- **Best For**: Local coding agents

**Qwen 2.5-Max**
- **Strengths**: File system and finance tool categories
- **Best For**: Document processing agents

**Setup Tips**:
```bash
# Using vLLM (recommended for production)
vllm serve Qwen/Qwen3-32B --tool-parser hermes

# Using Ollama
ollama pull qwen3:32b
```

### Llama Models

- **Llama 3.1/3.2/4**: Basic tool calling support in vLLM and Ollama
- **Limitations**: Lower accuracy than Qwen, higher error rates
- **XLam 8B variant**: 0.570 F1 score (struggles with complex schemas)
- **Best For**: Simple, single-tool operations

## Models to Avoid for MXF Agents

| Model | Issue |
|-------|-------|
| **GPT-5-nano** | Loses context in long-running tasks, poor multi-step chaining |
| **GPT-5-mini** | Struggles with sustained ORPAR cycles, inconsistent tool calls |
| GPT-4 / GPT-4o | Tool argument hallucination, schema issues |
| Watt 8B (quantized) | 0.484 F1 score - unreliable |
| DeepSeek R1 | No native function calling |
| Most small models (<7B) | Poor schema adherence |

## Benchmark Reference

### Enterprise Tool Use (Scale AI ToolComp)

Tests compositional multi-tool chaining for enterprise tasks.

| Model | Notes |
|-------|-------|
| o1 | 0.876 tool selection quality |
| o3-mini | 0.847 tool selection quality |
| Claude Opus 4.5 | Leading in production environments |

### MCP-Universe Benchmark (Salesforce)

Real-world MCP servers across 6 domains, 231 tasks. Even top models struggle:

| Model | Success Rate |
|-------|--------------|
| GPT-5 | 43.72% |
| Grok-4 | 33.33% |
| Claude 4.0-Sonnet | 29.44% |

**Key Insight**: MCP tool use remains challenging - choose models carefully and implement robust error handling.

### Berkeley Function Calling (BFCL v4)

Tests function call generation accuracy across Python, Java, JavaScript, REST APIs.

| Model | Notes |
|-------|-------|
| Claude Opus 4.5 | Top tier |
| GPT-5.x (full) | Improved significantly |
| Qwen 3 | Best open-source |

### MCPToolBench++ Categories

| Category | Best Model |
|----------|------------|
| Browser | Qwen3-Coder |
| File System | Qwen2.5-max |
| Search | Claude-3.7-Sonnet |
| Map | GPT-4o |
| Finance | Qwen2.5-max, GPT-4o |

## MXF Configuration Examples

### Production Setup (Claude)

```typescript
// Recommended for production agents
const agentConfig: AgentConfig = {
    llmProvider: {
        type: LlmProviderType.ANTHROPIC,
        model: 'claude-opus-4-5',  // Best tool calling
        options: {
            temperature: 0.2,      // Lower for consistency
            maxTokens: 4096
        }
    }
};

// Or via OpenRouter for flexibility
const openRouterConfig: AgentConfig = {
    llmProvider: {
        type: LlmProviderType.OPENROUTER,
        model: 'anthropic/claude-opus-4-5',
        options: {
            temperature: 0.2
        }
    }
};
```

### High-Volume Setup (Sonnet)

```typescript
// Cost-effective for high-volume workloads
const agentConfig: AgentConfig = {
    llmProvider: {
        type: LlmProviderType.ANTHROPIC,
        model: 'claude-opus-4.5',
        options: {
            temperature: 0.3,
            maxTokens: 2048
        }
    }
};
```

### Local/Self-Hosted Setup (Qwen)

```typescript
// Self-hosted with Ollama
const agentConfig: AgentConfig = {
    llmProvider: {
        type: LlmProviderType.OLLAMA,
        model: 'qwen3:32b',
        endpoint: 'http://localhost:11434',
        options: {
            temperature: 0.2
        }
    }
};
```

### ORPAR Phase-Optimized Configuration

```typescript
// Different models for different ORPAR phases
// Use capable models for action/planning, faster models for observation
const systemLlmConfig = {
    orparModels: {
        observation: 'google/gemini-2.0-flash',     // Fast observation
        reasoning: 'anthropic/claude-opus-4-5',     // Deep reasoning
        action: 'anthropic/claude-haiku-4.5',       // Reliable tool execution
        planning: 'anthropic/claude-opus-4-5',      // Strategic planning
        reflection: 'anthropic/claude-opus-4.5'    // Meta-cognitive
    }
};

// WARNING: Avoid this configuration - nano/mini struggle with agentic tasks
const badConfig = {
    orparModels: {
        observation: 'openai/gpt-5-nano',   // Too weak for sustained context
        reasoning: 'openai/gpt-5-mini',     // Loses coherence over time
        // ...
    }
};
```

## Best Practices

### 1. Match Model to Task Complexity

| Task Complexity | Recommended Tier |
|-----------------|------------------|
| Simple (1-2 tools) | Haiku, Flash, Qwen 8B |
| Moderate (3-5 tools) | Sonnet, Gemini Flash |
| Complex (6+ tools, chained) | Opus, GPT-5.2, Gemini Pro |
| Long-running (hours) | Opus, Sonnet, Gemini Pro (avoid nano/mini) |

### 2. Implement Fallback Strategies

```typescript
// Example fallback chain
const modelFallback = [
    'anthropic/claude-opus-4-5',      // Primary
    'anthropic/claude-sonnet-4.5',    // Fallback 1
    'google/gemini-3-pro',            // Fallback 2
    'openai/gpt-5'                    // Fallback 3 (full model, not mini)
];
```

### 3. Use Schema Validation

All MXF tools use JSON Schema validation. Models with better schema adherence (Claude, Gemini 3) produce fewer validation errors.

### 4. Monitor Tool Call Metrics

Track these metrics per model:
- Tool call success rate
- Schema validation failures
- Average retry count
- Tool chaining depth achieved
- Context coherence over time (especially for long-running tasks)

### 5. Temperature Settings

| Use Case | Temperature |
|----------|-------------|
| Tool calling | 0.1-0.3 (deterministic) |
| Planning | 0.3-0.5 (some creativity) |
| Reasoning | 0.5-0.7 (exploratory) |

## Provider Comparison Summary

| Provider | Best Model | Tool Strength | Weakness |
|----------|------------|---------------|----------|
| Anthropic | Opus 4.5 | Lowest error rates, MCP native | Cost |
| Google | Gemini 3 Pro | Speed, multimodal, thought retention | Newer |
| OpenAI | GPT-5.2 | Enterprise features, preambles | Smaller models unreliable |
| DeepSeek | V3.2-Speciale | Thinking in tool-use | Production track record |
| Alibaba | Qwen 3 | Best open-source | Requires self-hosting |
| Meta | Llama 4 | Free, flexible | Lower accuracy |

## Migration Notes

### From GPT-4/GPT-4o to GPT-5.x

If you experienced tool-calling issues with GPT-4/4o:
- GPT-5.x (full models) has significantly improved reliability
- Consider enabling preambles for better accuracy
- Use `allowed_tools` to constrain tool selection
- **Do not use GPT-5-nano or GPT-5-mini** as replacements for complex agentic tasks

### From Claude 3.5 to Claude 4.x

- Extended thinking now works with tools
- Parallel tool calls more reliable
- Memory/context capabilities improved

## Related Documentation

- [SystemLLM Service](system-llm.md) - Model configuration for server-side AI
- [MCP Tools](../sdk/mcp.md) - Tool implementation guide
- [Validation System](validation-system.md) - Tool validation and error handling
- [External MCP Servers](../sdk/external-mcp-servers.md) - Integrating external tools

## Sources

Research sources for this guide:

- [Introducing GPT-5 for developers](https://openai.com/index/introducing-gpt-5-for-developers/) - OpenAI
- [Introducing Claude 4](https://www.anthropic.com/news/claude-4) - Anthropic
- [Introducing Claude Opus 4.5](https://www.anthropic.com/news/claude-opus-4-5) - Anthropic
- [Gemini 3 for developers](https://blog.google/technology/developers/gemini-3-developers/) - Google
- [DeepSeek-V3.2 Release](https://api-docs.deepseek.com/news/news251201) - DeepSeek
- [Berkeley Function Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html) - UC Berkeley
- [Scale AI ToolComp Leaderboard](https://scale.com/leaderboard/tool_use_enterprise) - Scale AI
- [MCP-Universe Benchmark](https://arxiv.org/pdf/2508.14704) - Salesforce AI Research
- [Local LLM Tool Calling Evaluation](https://www.docker.com/blog/local-llm-tool-calling-a-practical-evaluation/) - Docker
- [Enhanced Safety in GPT-5.2 Tool Calling](https://cobusgreyling.medium.com/enhanced-safety-predictability-control-in-gpt-5-2-tool-calling-5a2452ed3e6a) - Medium
- MXF internal testing (December 2025)
