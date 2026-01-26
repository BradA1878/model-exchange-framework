# Workflow Patterns Demo

Demonstrates an agent **autonomously analyzing** workflow patterns and deciding which execution pattern (Sequential, Parallel, or Loop) best fits each use case.

## Overview

This demo does **NOT** execute all three workflow patterns blindly. Instead:

- The agent **receives** workflow definitions
- It **analyzes** step dependencies autonomously
- It **reasons** about which pattern fits each use case
- It **recommends** the optimal pattern with rationale
- **No hardcoded decisions** - pure LLM reasoning

## Key MXF Features Demonstrated

### Workflow Patterns

| Pattern | Best For | Key Indicator |
|---------|----------|---------------|
| **Sequential** | Pipelines with dependencies | Each step depends on previous |
| **Parallel** | Independent operations | Multiple steps with no dependencies |
| **Loop** | Optimization tasks | Quality threshold + iterations |

### Pattern Details

**Sequential**
- Steps execute one after another
- Output of step N is input to step N+1
- Failure at any step stops the workflow
- Example: validate → parse → transform → save

**Parallel**
- Independent steps run concurrently
- Results merged at the end
- Significant time savings over sequential
- Example: fetch API1, API2, API3 all at once

**Loop (Iterative)**
- Steps repeat until condition met
- Each iteration improves upon previous
- Has maximum iteration limit
- Example: draft → evaluate → refine → check threshold

## Running the Demo

### Start Server

```bash
bun run dev
```

### Set Up Environment

```bash
cd examples/workflow-patterns-demo
cp .env.example .env
```

### Run the Demo

```bash
bun run demo:workflow-patterns
```

## What to Watch For

The demo outputs show the agent's decision-making process:

```
═══════════════════════════════════════════════════════════════════════════════
WORKFLOW PATTERNS DEMO (Agentic Flow)
═══════════════════════════════════════════════════════════════════════════════

Watch for:
  - [Agent Thinking] Analyzing step dependencies...
  - [Tool Call] planning_create - Creating analysis plan
  - [Agent Decision] Workflow A → Sequential (dependencies)
  - [Agent Decision] Workflow B → Parallel (independent steps)
  - [Agent Decision] Workflow C → Loop (quality threshold)
```

### Tool Calls to Observe

| Tool | Purpose |
|------|---------|
| `tools_recommend` | Agent discovers available analysis tools |
| `planning_create` | Agent creates structured analysis plan |
| `task_complete` | Agent reports findings and recommendations |

## Workflow Definitions Analyzed

### Workflow A: Document Processing Pipeline
```
validate_format → extract_content → transform_data → generate_output → save_results
```
- **Expected Pattern**: Sequential
- **Reason**: Each step depends on the previous step's output

### Workflow B: Multi-Source Data Aggregation
```
fetch_api_1 ─┐
fetch_api_2 ─┼→ merge_results
fetch_database ─┤
fetch_cache ─┤
fetch_file ─┘
```
- **Expected Pattern**: Parallel
- **Reason**: First 5 steps are independent; only merge depends on all

### Workflow C: Content Quality Optimization
```
generate_draft → evaluate_quality → refine_content → check_threshold
       ↑                                    │
       └────────────────────────────────────┘ (repeat if quality < 0.9)
```
- **Expected Pattern**: Loop
- **Reason**: Steps repeat until quality threshold (90%) is met

## Expected Agent Decisions

| Workflow | Pattern | Key Insight |
|----------|---------|-------------|
| Document Processing | **Sequential** | Chained dependencies form linear graph |
| Data Aggregation | **Parallel** | Independent steps with fan-in merge |
| Quality Optimization | **Loop** | Quality threshold requires iteration |

## Learning Points

- **Autonomous Decision Making**: Agent reasons about patterns, not scripted
- **Detailed Analysis**: Agent explains its rationale and key insights
- **Real Intelligence**: Pure LLM reasoning based on dependency analysis
- **Observable Process**: Monitor tool calls and agent thinking
- **Educational**: Learn how to identify workflow patterns

## Source Code

See the full implementation in `examples/workflow-patterns-demo/`

## Related Documentation

- [Workflow System](../mxf/workflow-system.md)
- [Task System](../api/tasks.md)
- [ORPAR Control Loop](../mxf/orpar.md)
