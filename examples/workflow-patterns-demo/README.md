# Workflow Patterns Demo (Agentic Flow)

Demonstrates an agent **AUTONOMOUSLY analyzing** workflow patterns and deciding which execution pattern (Sequential, Parallel, or Loop) best fits each use case.

## Key Difference from Traditional Demos

This demo does **NOT** execute all three workflow patterns blindly. Instead:

- The agent **receives** workflow definitions
- It **analyzes** step dependencies autonomously
- It **reasons** about which pattern fits each use case
- It **recommends** the optimal pattern with rationale
- **No hardcoded decisions** - pure LLM reasoning

## Workflow Patterns Explained

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

1. Ensure MXF server is running:
   ```bash
   bun run dev
   ```

2. Set up environment:
   ```bash
   cd examples/workflow-patterns-demo
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. Run the demo:
   ```bash
   bun run workflow-patterns-demo.ts
   # Or use npm script:
   bun run demo:workflow-patterns
   ```

## What to Watch For

The demo outputs show the agent's decision-making process:

```
═══════════════════════════════════════════════════════════════════════════════
WORKFLOW PATTERNS DEMO (Agentic Flow)
═══════════════════════════════════════════════════════════════════════════════

This demo shows an agent AUTONOMOUSLY analyzing workflow patterns:
  - The agent receives workflow definitions
  - It reasons about which pattern fits each use case
  - No hardcoded decisions - pure LLM reasoning

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

The agent should autonomously conclude:

| Workflow | Pattern | Key Insight |
|----------|---------|-------------|
| Document Processing | **Sequential** | Chained dependencies form linear graph |
| Data Aggregation | **Parallel** | Independent steps with fan-in merge |
| Quality Optimization | **Loop** | Quality threshold requires iteration |

## Sample Output

```
[Agent Thinking] I'll analyze each workflow's dependency structure...

────────────────────────────────────────────────────────────
[Tool Call] planning_create
   Plan Name: Workflow Pattern Analysis
   Steps: 4 items
────────────────────────────────────────────────────────────

[Agent Response]
Analyzing Workflow A: Document Processing Pipeline...
The dependencies form a linear chain: validate → extract → transform → generate → save

────────────────────────────────────────────────────────────
[Agent Decision]
Workflow A: Document Processing Pipeline
  Pattern: Sequential
  Rationale: Each step requires the output of the previous step.
  Key Insight: Dependencies form a strict A → B → C → D → E chain.
────────────────────────────────────────────────────────────

[Agent Decision]
Workflow B: Multi-Source Data Aggregation
  Pattern: Parallel
  Rationale: Five steps have zero dependencies and can execute concurrently.
  Key Insight: Fan-in pattern where independent fetches merge at the end.
────────────────────────────────────────────────────────────

[Agent Decision]
Workflow C: Content Quality Optimization
  Pattern: Loop
  Rationale: Steps repeat until quality score reaches 90% threshold.
  Key Insight: Iterative refinement with convergence check.
────────────────────────────────────────────────────────────

════════════════════════════════════════════════════════════
[Task Completed]
Summary: Analyzed 3 workflows - Sequential for pipelines, Parallel for
independent fetches, Loop for optimization with quality thresholds.
════════════════════════════════════════════════════════════
```

## Comparison: Before vs After Agentification

| Aspect | Before (Hardcoded) | After (Agentic) |
|--------|-------------------|-----------------|
| Pattern Selection | Script runs all 3 | Agent chooses optimal |
| Tool Usage | Only `code_execute` | `tools_recommend`, `planning_create`, `task_complete` |
| Agent Prompt | 1 generic line | 280+ lines of detailed guidance |
| Execution | Simulated random values | Real analysis and reasoning |
| Output | Pre-computed results | Agent's autonomous analysis |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Patterns Demo                    │
├─────────────────────────────────────────────────────────────┤
│  displayBanner()      - Explain demo purpose                │
│  setupMonitoring()    - Watch tool calls & decisions        │
│  createAgent()        - Agent with 280+ line prompt         │
│  createTask()         - Workflow definitions for analysis   │
│  demo()               - Orchestrate the flow                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 WorkflowPatternAnalyst Agent                 │
├─────────────────────────────────────────────────────────────┤
│  Role: Analyze workflows and recommend patterns             │
│  Tools: tools_recommend, planning_create, task_complete     │
│  Behavior: Pure LLM reasoning, no hardcoded decisions       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Agent Workflow                          │
├─────────────────────────────────────────────────────────────┤
│  1. Receive workflow definitions                            │
│  2. Analyze dependency structures                           │
│  3. Identify pattern signals (chain, fan-in, iteration)     │
│  4. Recommend optimal pattern for each                      │
│  5. Explain rationale and key insights                      │
│  6. Complete task with findings                             │
└─────────────────────────────────────────────────────────────┘
```

## Key Benefits

- **Autonomous Decision Making**: Agent reasons about patterns, not scripted
- **Detailed Analysis**: Agent explains its rationale and key insights
- **Real Intelligence**: Pure LLM reasoning based on dependency analysis
- **Observable Process**: Monitor tool calls and agent thinking
- **Educational**: Learn how to identify workflow patterns

## Cleanup

The demo automatically cleans up after completion:
- Disconnects agent
- Deletes agent memory
- Deletes demo channel
- Disconnects SDK

Ctrl+C during execution also triggers cleanup.
