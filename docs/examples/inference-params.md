# Dynamic Inference Parameters Demo

Demonstrates agents **autonomously adjusting their LLM parameters** based on task complexity. The agent's LLM reasons about when to upgrade or downgrade its own model capabilities - true metacognitive control.

## Overview

The inference parameters system allows agents to recognize when their current configuration is insufficient and petition for adjustments. This enables:

- **Cost Optimization**: Use cheap models for simple tasks
- **Quality Assurance**: Upgrade to powerful models when truly needed
- **Metacognitive Awareness**: Agents reason about their own capabilities

## Key MXF Features Demonstrated

### LLM-Driven Tool Usage

Unlike demos that use direct `executeTool()` calls, this demo lets the agent **autonomously decide** which tools to use:

1. Receives a task with problems of varying complexity
2. Reasons about each problem's complexity
3. Decides when to upgrade its model for complex tasks
4. Resets to budget models after complex work (cost savings)
5. All decisions are made by the LLM, not hardcoded

### Expected Tool Call Pattern

```
[Tool Call] get_current_params        ← Agent checks starting config
[Agent Response] Problem 1 is simple, using current settings...
[Tool Call] request_inference_params  ← Agent upgrades for Problem 2
   Reason: This architecture design requires multi-step reasoning
   Suggested: { model: "anthropic/claude-3.5-sonnet", ... }
[Agent Response] <detailed architecture design>
[Tool Call] reset_inference_params    ← Agent resets to save costs
[Agent Response] Problem 3 is simple...
[Tool Call] request_inference_params  ← Agent upgrades for Problem 4
[Agent Response] <comprehensive database comparison>
[Tool Call] reset_inference_params    ← Agent resets again
[Tool Call] task_complete             ← Agent summarizes decisions
```

## Running the Demo

### Start Server

```bash
bun run dev
```

### Set Up Environment

```bash
cd examples/inference-params-demo
cp .env.example .env
```

### Run the Demo

```bash
bun run demo:inference-params
```

## Available Tools (Agent's Perspective)

### Inference Parameter Tools

| Tool | Purpose | When Agent Uses It |
|------|---------|-------------------|
| `get_current_params` | Check current LLM settings | At start, before decisions |
| `request_inference_params` | Request better model | Before complex tasks |
| `reset_inference_params` | Return to defaults | After complex work |
| `get_parameter_status` | View active overrides | Debugging/verification |
| `get_available_models` | List models by tier | Model selection |

### Other Tools

| Tool | Purpose |
|------|---------|
| `task_complete` | Mark task as done |
| `code_execute` | Verify calculations |

## Task Description

The task presents 4 problems:

| Problem | Type | Expected Behavior |
|---------|------|-------------------|
| 1: 15% of 200 + 42 | SIMPLE | No upgrade |
| 2: Microservices architecture | COMPLEX | Upgrade → Solve → Reset |
| 3: Prime numbers 10-30 | SIMPLE | No upgrade |
| 4: SQL vs NoSQL comparison | COMPLEX | Upgrade → Solve → Reset |

## Parameter Scopes

| Scope | Persistence | Use Case |
|-------|-------------|----------|
| `next_call` | Single LLM invocation | Quick one-off |
| `session` | Until socket disconnect | Sustained work |
| `task` | Until task completion | Task-scoped work |

## Model Cost Tiers

| Tier | Models | Cost | Use Case |
|------|--------|------|----------|
| Budget | claude-3.5-haiku | ~$0.0025/1k | Simple tasks |
| Standard | claude-3.5-sonnet | ~$0.015/1k | Complex tasks |
| Premium | claude-sonnet-4 | ~$0.015/1k | Critical reasoning |

## Governance Constraints

The system can enforce limits to prevent excessive costs:

```typescript
const governance = {
  maxCostPerCall: 0.50,       // Max $0.50 per call
  maxCostPerTask: 5.00,       // Max $5.00 per task
  maxRequestsPerPhase: 3,     // Max 3 changes per phase
  allowedModels: ['anthropic/claude-3.5-haiku', 'anthropic/claude-3.5-sonnet'],
  maxReasoningTokens: 8000
};
```

## Learning Points

- **True Metacognition**: Agents reason about their own capabilities
- **Autonomous Decisions**: No hardcoded tool calls
- **Cost Optimization**: Automatic downgrade after complex work
- **Transparency**: Agent explains every parameter decision
- **Governance**: System can enforce limits on upgrades

## Source Code

See the full implementation in `examples/inference-params-demo/`

## Related Documentation

- [Dynamic Inference Parameters](../mxf/dynamic-inference-parameters.md)
- [System LLM](../mxf/system-llm.md)
- [ORPAR Control Loop](../mxf/orpar.md)
