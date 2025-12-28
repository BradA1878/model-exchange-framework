# MXF Tool Reference

Complete reference for MXF's 100+ built-in MCP tools organized by category.

## Overview

MXF provides a comprehensive library of built-in tools that agents can use for communication, task management, development, analytics, and more. All tools follow the Model Context Protocol (MCP) standard and are automatically available to agents based on channel configuration.

### Tool Access Control

Tools can be filtered at the channel level using `allowedTools`:

```typescript
const agent = await sdk.createAgent({
    agentId: 'my-agent',
    channelId: 'my-channel',
    allowedTools: ['messaging_send', 'task_create', 'memory_search_conversations'],
    // ... other config
});
```

---

## Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| [Communication & Collaboration](#communication--collaboration) | 11 | Agent messaging, discovery, and coordination |
| [Control Loop & ORPAR](#control-loop--orpar) | 11 | ORPAR cognitive cycle management |
| [Task Management](#task-management) | 13 | Task creation, tracking, and effectiveness |
| [Memory & Context](#memory--context) | 10 | Memory operations and semantic search |
| [Development & Code](#development--code) | 20 | TypeScript, Git, testing, and code analysis |
| [Infrastructure & System](#infrastructure--system) | 8 | Shell, code execution, and storage |
| [Web & External](#web--external) | 5 | Web search, navigation, and API access |
| [Validation & Safety](#validation--safety) | 8 | Action validation and safety operations |
| [Analytics & Monitoring](#analytics--monitoring) | 10 | Performance metrics and system health |
| [Meta & Help Tools](#meta--help-tools) | 8 | Tool discovery and documentation |
| [Planning & Coordination](#planning--coordination) | 11 | Plans, coordination, and scheduling |

---

## Communication & Collaboration

Tools for agent-to-agent messaging and coordination.

| Tool | Description |
|------|-------------|
| `messaging_send` | Send direct messages between agents with MXP support |
| `messaging_broadcast` | Broadcast announcements to all channel agents |
| `agent_discover` | Discover other agents in the system |
| `agent_coordinate` | Request multi-agent coordination |
| `coordination_request` | Request coordination with other agents |
| `coordination_accept` | Accept a coordination request |
| `coordination_reject` | Reject a coordination request |
| `coordination_status` | Get coordination request status |
| `coordination_update` | Update coordination progress |
| `coordination_complete` | Complete a coordination task |
| `coordination_list` | List active coordinations |

**Source Files:** `AgentCommunicationTools.ts`, `CoordinationTools.ts`

---

## Control Loop & ORPAR

Tools for managing the ORPAR (Observe, Reason, Plan, Act, Reflect) cognitive cycle.

### Lifecycle Management

| Tool | Description |
|------|-------------|
| `controlLoop_start` | Initialize and start the control loop |
| `controlLoop_status` | Get current control loop status |
| `controlLoop_stop` | Stop the running control loop |

### ORPAR Phases

| Tool | Description |
|------|-------------|
| `controlLoop_observe` | Execute observation phase - gather environmental context |
| `controlLoop_reason` | Execute reasoning phase - analyze and decide |
| `controlLoop_plan` | Execute planning phase - create action plans |
| `controlLoop_execute` | Execute action phase - perform planned actions |
| `controlLoop_reflect` | Execute reflection phase - evaluate outcomes |

**Source Files:** `ControlLoopLifecycle.ts`, `ControlLoopPhases.ts`, `ControlLoopTools.ts`

---

## Task Management

Tools for creating, tracking, and completing tasks.

### Core Task Operations

| Tool | Description |
|------|-------------|
| `task_create` | Create a new task |
| `task_query` | Query tasks by criteria |
| `task_update` | Update an existing task |
| `task_complete_bridge` | Complete a task through the bridge |
| `task_status` | Get task status |

### Task Planning

| Tool | Description |
|------|-------------|
| `task_create_with_plan` | Create task with a completion plan |
| `task_create_custom_completion` | Create task with custom completion criteria |
| `task_link_to_plan` | Link an existing task to a plan |
| `task_monitoring_status` | Get task monitoring status |

### Effectiveness Tracking

| Tool | Description |
|------|-------------|
| `task_effectiveness_start` | Start tracking task effectiveness |
| `task_effectiveness_event` | Record an execution event |
| `task_effectiveness_quality` | Evaluate task quality |
| `task_effectiveness_complete` | Complete effectiveness tracking |

**Source Files:** `TaskBridgeTools.ts`, `TaskPlanningTools.ts`, `EffectivenessTools.ts`

---

## Memory & Context

Tools for memory operations and semantic search.

### Channel Memory

| Tool | Description |
|------|-------------|
| `channel_memory_read` | Read shared channel memory |
| `channel_memory_write` | Write to shared channel memory |
| `channel_context_read` | Read channel context information |
| `channel_messages_read` | Read channel messages |

### Agent Memory

| Tool | Description |
|------|-------------|
| `agent_context_read` | Read agent context |
| `agent_memory_read` | Read agent memory |
| `agent_memory_write` | Write to agent memory |

### Semantic Search (Meilisearch)

| Tool | Description |
|------|-------------|
| `memory_search_conversations` | Semantic search across conversation history |
| `memory_search_actions` | Search tool usage patterns and outcomes |
| `memory_search_patterns` | Discover cross-channel patterns and learnings |

**Source Files:** `ContextMemoryTools.ts`, `MemorySearchTools.ts`

---

## Development & Code

Tools for software development workflows.

### TypeScript Tools

| Tool | Description |
|------|-------------|
| `typescript_check` | Type-check TypeScript files |
| `typescript_build` | Build TypeScript project |
| `typescript_format` | Format TypeScript files |
| `typescript_lint` | Lint TypeScript files |
| `typescript_test` | Run TypeScript tests |

### Git Version Control

| Tool | Description |
|------|-------------|
| `git_status` | Get repository status |
| `git_add` | Stage files for commit |
| `git_commit` | Create a commit |
| `git_diff` | Show file differences |
| `git_log` | View commit history |
| `git_branch` | Manage branches |
| `git_push` | Push to remote |
| `git_pull` | Pull from remote |

### Code Analysis

| Tool | Description |
|------|-------------|
| `analyze_codebase` | Analyze codebase structure and quality |
| `find_functions` | Find and list functions in code |
| `trace_dependencies` | Trace dependencies between modules |
| `suggest_refactoring` | Get refactoring suggestions |
| `validate_architecture` | Validate system architecture |

### Testing

| Tool | Description |
|------|-------------|
| `test_jest` | Run Jest tests |
| `test_mocha` | Run Mocha tests |
| `test_vitest` | Run Vitest tests |
| `test_runner` | Universal test runner with auto-detection |

**Source Files:** `TypeScriptTools.ts`, `GitTools.ts`, `CodeAnalysisTools.ts`, `TestTools.ts`

---

## Infrastructure & System

Tools for system operations and code execution.

| Tool | Description |
|------|-------------|
| `memory_store` | Store data in memory |
| `memory_retrieve` | Retrieve data from memory |
| `shell_execute` | Execute shell commands (sandboxed) |
| `code_execute` | Execute code in isolated sandbox |
| `json_append` | Append entry to JSON file |
| `json_read` | Read JSON file |

**Source Files:** `InfrastructureTools.ts`, `JsonTools.ts`

---

## Web & External

Tools for web interactions and external API access.

| Tool | Description |
|------|-------------|
| `web_search` | Perform web searches |
| `web_navigate` | Navigate to URLs and extract content |
| `web_bulk_extract` | Extract content from multiple URLs |
| `web_screenshot` | Capture screenshots of web pages |
| `api_fetch` | Fetch JSON from API endpoints |

**Source Files:** `WebTools.ts`

---

## Validation & Safety

Tools for action validation and safe operations.

### Action Validation

| Tool | Description |
|------|-------------|
| `validate_next_action` | Validate agent's next intended action |
| `no_further_action` | Signal completion without additional tool calls |

### Safety Operations

| Tool | Description |
|------|-------------|
| `create_feature_branch` | Create feature branch for safe testing |
| `run_full_test_suite` | Run comprehensive test suite |
| `performance_benchmark` | Run performance benchmarks |
| `rollback_changes` | Rollback to previous state |
| `create_backup` | Create system backup |
| `code_review_agent` | Request automated code review |

**Source Files:** `ActionValidationTools.ts`, `SafetyTools.ts`

---

## Analytics & Monitoring

Tools for performance tracking and system health.

| Tool | Description |
|------|-------------|
| `analytics_agent_performance` | Get agent performance metrics |
| `analytics_channel_activity` | Analyze channel activity patterns |
| `analytics_system_health` | Monitor system health status |
| `analytics_generate_report` | Generate comprehensive analytics reports |
| `analytics_task_completion` | Track task completion analytics |
| `analytics_validation_metrics` | Get validation performance metrics |
| `analytics_tool_usage` | Analyze tool usage patterns |
| `analytics_compare_performance` | Compare performance across agents/channels |
| `analytics_dashboard_data` | Retrieve real-time dashboard data |
| `analytics_export_data` | Export analytics data |

**Source Files:** `AnalyticsTools.ts`

---

## Meta & Help Tools

Tools for discovering and understanding available tools.

### Tool Discovery

| Tool | Description |
|------|-------------|
| `tools_recommend` | AI-powered tool recommendations based on intent |
| `tools_discover` | Interactive tool exploration with filtering |
| `tools_validate` | Validate tool availability before execution |
| `tools_compare` | Compare tools side-by-side |

### Tool Documentation

| Tool | Description |
|------|-------------|
| `tool_help` | Get detailed documentation for a specific tool |
| `tool_quick_reference` | Quick reference guide for all tools |
| `tool_validate` | Validate tool call format and parameters |
| `tool_validation_tips` | Get validation best practices |

**Source Files:** `MetaTools.ts`, `ToolHelpTools.ts`

---

## Planning & Coordination

Tools for planning and scheduling.

### Plan Management

| Tool | Description |
|------|-------------|
| `planning_create` | Create a structured plan with items |
| `planning_update_item` | Update plan items |
| `planning_view` | View plan details |
| `planning_share` | Share plan with other agents |

### Date & Time

| Tool | Description |
|------|-------------|
| `datetime_now` | Get current date and time with timezone support |
| `datetime_convert` | Convert between timezones |
| `datetime_arithmetic` | Perform date/time calculations |
| `datetime_format` | Format dates/times |

### Effectiveness Analytics

| Tool | Description |
|------|-------------|
| `task_effectiveness_analytics` | Get effectiveness analytics |
| `task_effectiveness_compare` | Compare effectiveness metrics |

**Source Files:** `PlanningTools.ts`, `DateTimeTools.ts`, `EffectivenessTools.ts`

---

## Tool Source Location

All tool implementations are located in:

```
src/shared/protocols/mcp/tools/
├── ActionValidationTools.ts
├── AgentCommunicationTools.ts
├── AnalyticsTools.ts
├── CodeAnalysisTools.ts
├── ContextMemoryTools.ts
├── ControlLoopLifecycle.ts
├── ControlLoopPhases.ts
├── ControlLoopTools.ts
├── CoordinationTools.ts
├── DateTimeTools.ts
├── EffectivenessTools.ts
├── GitTools.ts
├── InfrastructureTools.ts
├── JsonTools.ts
├── MemorySearchTools.ts
├── MetaTools.ts
├── PlanningTools.ts
├── SafetyTools.ts
├── TaskBridgeTools.ts
├── TaskPlanningTools.ts
├── TestTools.ts
├── ToolHelpTools.ts
├── TypeScriptTools.ts
├── WebTools.ts
└── index.ts
```

---

## Adding Custom Tools

To add custom tools, see:
- [External MCP Server Registration](../sdk/external-mcp-servers.md) - Register external MCP servers
- [Channel-Scoped MCP Servers](../sdk/channel-mcp-servers.md) - Register channel-specific tools

## Related Documentation

- [SDK MCP Integration](../sdk/mcp.md)
- [Tool Help Tools](../api/tool-help.md)
- [Validation System](./validation-system.md)
