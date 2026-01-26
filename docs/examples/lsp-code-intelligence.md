# LSP Code Intelligence Demo

Demonstrates an agent **autonomously using MXF's code analysis tools** to analyze and understand a real codebase. The agent receives a task and decides which tools to use - no hardcoded tool calls.

## Overview

This demo shows an agent with true code intelligence capabilities. Unlike scripted demos, this agent:

- Receives a task to analyze the MXF dashboard codebase
- Autonomously decides which code analysis tools to use
- Uses pure LLM reasoning to navigate the analysis workflow
- Produces real insights about actual code

## Key MXF Features Demonstrated

### Available Code Analysis Tools

| Tool | Description |
|------|-------------|
| `analyze_codebase` | Analyze structure, dependencies, and architecture patterns |
| `find_functions` | Find function definitions and signatures across the codebase |
| `trace_dependencies` | Trace imports and exports for impact analysis |
| `suggest_refactoring` | Identify refactoring opportunities |
| `validate_architecture` | Validate against architectural principles |
| `typescript_check` | Type-check TypeScript files |
| `typescript_lint` | Lint TypeScript files with ESLint |

### Features Shown

1. **Agentic Decision Making**: The agent decides which tools to use based on the task
2. **Real Code Analysis**: Tools analyze actual files in the dashboard codebase
3. **Systematic Workflow**: Agent follows a logical progression:
   - Structure analysis → Function discovery → Dependency tracing → Quality assessment
4. **Actionable Insights**: Results include specific file paths and recommendations

## Running the Demo

### Start Server

```bash
bun run dev
```

### Set Up Environment

```bash
cd examples/lsp-code-intelligence-demo
cp .env.example .env
```

### Run the Demo

```bash
bun run demo:lsp-code-intelligence
```

## Expected Output

```
================================================================================
CODE INTELLIGENCE DEMO (Agentic Flow)
================================================================================

This demo shows an agent with CODE ANALYSIS capabilities:
  - The agent receives a task to analyze the MXF dashboard codebase
  - It autonomously decides which code analysis tools to use
  - No hardcoded executeTool() calls - pure LLM reasoning

Available Code Analysis Tools:
  - analyze_codebase     : Analyze structure, dependencies, architecture
  - find_functions       : Find function definitions and signatures
  - trace_dependencies   : Trace imports and exports for impact analysis
  - suggest_refactoring  : Identify refactoring opportunities
  ...

------------------------------------------------------------
[Tool Call] analyze_codebase
   Directory: /path/to/dashboard/src
------------------------------------------------------------

[Tool Result] analyze_codebase: Success - 42 files found

------------------------------------------------------------
[Tool Call] find_functions
   Function: fetch
------------------------------------------------------------

[Tool Result] find_functions: Success - 15 functions found
...

============================================================
[Task Completed]
Summary: Analyzed dashboard codebase...
============================================================
```

## Target Codebase

The agent analyzes the MXF Dashboard at `dashboard/src/`:

- **src/stores/** - Pinia stores (analytics, agents, tasks, channels, auth)
- **src/views/** - Vue views (Dashboard, Login, Channels, admin views)
- **src/components/** - Vue components (CoordinationPanel, analytics)
- **src/plugins/** - Configuration plugins (axios, theme, vuetify)
- **src/layouts/** - Layout components

## Key Differences from Scripted Demos

| Aspect | Scripted Demo | Agentic Demo |
|--------|---------------|--------------|
| Tool calls | Hardcoded sequence | Agent decides |
| Code analysis | Simulated/fake | Real tools on real code |
| Workflow | Predetermined | LLM reasoning |
| Output | Static examples | Dynamic based on actual analysis |

## Architecture Flow

```
Task Creation
    |
    v
Agent Receives Task
    |
    v
LLM Reasoning -> Decide Next Tool
    |
    v
Execute Tool (analyze_codebase, find_functions, etc.)
    |
    v
Process Results -> Update Understanding
    |
    v
Repeat until analysis complete
    |
    v
task_complete with Summary
```

## Learning Points

- **Autonomous Operation**: Agent makes its own decisions
- **Real Analysis**: Actual code intelligence on real files
- **Systematic Approach**: Follows logical analysis workflow
- **Actionable Results**: Specific file paths and recommendations

## Source Code

See the full implementation in `examples/lsp-code-intelligence-demo/`

## Related Documentation

- [LSP Integration](../mxf/lsp-integration.md)
- [Code Analysis Tools](../mxf/tool-reference.md)
- [ORPAR Control Loop](../mxf/orpar.md)
