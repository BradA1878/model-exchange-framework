# Prompting Enhancements

## Overview

MXF includes a suite of advanced prompt engineering features that improve agent behavior quality and reduce tool schema overhead in system prompts. These features are inspired by patterns used in Claude Code's own tooling and are designed to work together within the existing system prompt pipeline.

All features are behind feature flags (default `false`) for safe, incremental rollout. They integrate into the system prompt at build time via `MxfAgentSystemPrompt.buildToolSchemas()` and `MxfSystemPromptManager.loadCompleteSystemPrompt()`.

**Source files:**

- `src/shared/prompts/ToolBehavioralGuidance.ts`
- `src/shared/prompts/DeferredToolSchemaRegistry.ts`
- `src/shared/prompts/DynamicContextProvider.ts`
- `src/shared/prompts/PromptSegmentRegistry.ts`
- `src/shared/prompts/MxfAgentSystemPrompt.ts`
- `src/sdk/managers/MxfSystemPromptManager.ts`
- `src/shared/config/PromptCompactionConfig.ts`

## Tool Behavioral Guidance

The `ToolBehavioralGuidance` singleton registry maps tool names to behavioral hints, preferred alternatives, and preconditions. When enabled, these hints are appended directly to each tool's description in the system prompt, giving the LLM per-tool usage guidance without a separate instructions section.

### Interface

```typescript
interface ToolGuidance {
    toolName: string;
    guidance: string;                   // Behavioral hint appended to tool description
    preferredAlternative?: string;      // Tool to prefer in certain contexts
    preconditions?: string[];           // Conditions to check before calling
}
```

### Default Registrations

The registry ships with guidance for core tools including ORPAR control loop tools (`controlLoop_observe`, `controlLoop_reason`, etc.), communication tools (`messaging_send`, `agent_broadcast`), task tools (`task_create`, `task_complete`), file tools (`read_file`, `write_file`), and meta tools (`tools_recommend`).

### Registering Custom Guidance

```typescript
import { ToolBehavioralGuidance } from '../prompts/ToolBehavioralGuidance';

const guidance = ToolBehavioralGuidance.getInstance();
guidance.register({
    toolName: 'my_custom_tool',
    guidance: 'Only use this tool after verifying the target resource exists.',
    preferredAlternative: 'my_safer_tool for read-only operations',
    preconditions: ['Target resource must be in an active state'],
});
```

The `buildGuidanceString()` method formats the entry as a markdown block appended to the tool's description during system prompt construction.

**Feature flag:** `TOOL_BEHAVIORAL_GUIDANCE_ENABLED` (default `false`)

## Deferred Tool Schema Registry

When agents have access to many tools (MXF ships 100+), including full JSON schemas for every tool in the system prompt wastes context window tokens. The `DeferredToolSchemaRegistry` classifies tools into two tiers:

- **Tier-1** -- always receive full schema documentation in the system prompt
- **Tier-2** -- listed by name only, with a note to use `tools_recommend` for discovery

### Classification Logic

```
If tool is explicitly assigned tier-1 -> tier-1
If tool is explicitly assigned tier-2 -> tier-2
If total tool count <= threshold (15) -> tier-1 (everything gets full schema)
If total tool count > threshold       -> tier-2 (unclassified tools are deferred)
```

The `partition()` method splits a list of tool names into `{ tier1, tier2 }` groups based on these rules.

### Default Tier-1 Tools

ORPAR control loop tools, communication tools (`messaging_send`, `agent_broadcast`), task lifecycle tools (`task_complete`, `task_create`, `task_create_with_plan`), meta tools (`tools_recommend`, `tools_validate`, `tools_recommend_on_error`), context tools (`context_inject`, `context_get`), and `user_input`.

### Deferred Summary Output

For tier-2 tools, the registry generates a compact summary block:

```
## Additional Tools Available

The following 42 tools are available but not shown in detail.
Use `tools_recommend` to discover the right tool for your task,
or `tools_validate` to check parameters.

Available: planning_create, memory_store, shell_execute, ...
```

### Customizing Classification

```typescript
import { DeferredToolSchemaRegistry } from '../prompts/DeferredToolSchemaRegistry';

const registry = DeferredToolSchemaRegistry.getInstance();
registry.setTier1('my_critical_tool');      // Always full schema
registry.setTier2('my_rare_tool');          // Always deferred
registry.setTier2Threshold(20);            // Adjust threshold (default: 15)
```

**Feature flag:** `DEFERRED_TOOL_SCHEMAS_ENABLED` (default `false`)

## Dynamic Context Providers

The `DynamicContextRegistry` allows runtime information -- task progress, recent errors, channel state -- to be injected into agent system prompts on each prompt rebuild. Providers are priority-ordered and conditionally activated based on the current agent context.

### Interfaces

```typescript
interface DynamicContextInput {
    agentId: AgentId;
    channelId: ChannelId;
    orparPhase?: string;
    hasRecentErrors?: boolean;
    channelAgentCount?: number;
    currentTaskId?: string;
    currentTaskTitle?: string;
    iterationCount?: number;
    totalTokens?: number;
    contextLimit?: number;
}

interface DynamicContextProviderEntry {
    id: string;
    name: string;
    priority: number;                                      // 1-10, higher = injected first
    shouldActivate: (input: DynamicContextInput) => boolean;
    getContent: (input: DynamicContextInput) => Promise<string>;
}
```

### Registering a Custom Provider

```typescript
import { DynamicContextRegistry } from '../prompts/DynamicContextProvider';

const registry = DynamicContextRegistry.getInstance();
registry.register({
    id: 'error-summary',
    name: 'Recent Error Summary',
    priority: 8,
    shouldActivate: (input) => input.hasRecentErrors === true,
    getContent: async (input) => {
        return `## Recent Errors\nErrors occurred in task ${input.currentTaskId}. Diagnose before retrying.`;
    },
});
```

### Token Budget

The `gatherContext()` method accepts an optional `tokenBudget` parameter. Providers are evaluated in priority order; once the budget is exhausted, remaining providers are skipped. The budget defaults to the `DYNAMIC_CONTEXT_TOKEN_BUDGET` env var (1000 tokens).

**Feature flag:** `DYNAMIC_CONTEXT_INJECTION_ENABLED` (default `false`)

## Anti-Pattern Segment

The `PromptSegmentRegistry` includes a default `anti-patterns` segment registered with `category: 'core'` and `priority: 7`. It is always included in the system prompt (its condition returns `true` unconditionally) and contains guidance to prevent common agent mistakes:

- Do not broadcast when a direct message suffices
- Do not skip the Reflect phase
- Do not retry failed tool calls with identical parameters
- Do not send empty or placeholder tool parameters
- Do not loop between Observe and Plan without an Act step
- Do not call `task_complete` without a meaningful summary

This segment is registered alongside other default segments (ORPAR cycle, collaboration patterns, tool usage, error handling, MXP protocol) in `PromptSegmentRegistry.registerDefaultSegments()`.

## Integration

### System Prompt Construction

**`MxfAgentSystemPrompt.buildToolSchemas()`** is the integration point for Tool Behavioral Guidance and Deferred Tool Schemas:

1. Loads `PromptCompactionConfig` to check feature flags
2. If `deferredToolSchemasEnabled`, calls `DeferredToolSchemaRegistry.partition()` to split tools into tier-1 (full docs) and tier-2 (name-only summary)
3. For each tool receiving full documentation, if `toolBehavioralGuidanceEnabled`, calls `ToolBehavioralGuidance.buildGuidanceString()` and appends the result to the tool's description
4. Appends the deferred summary block (if any) after all full tool schemas

**`MxfSystemPromptManager.loadCompleteSystemPrompt()`** is the integration point for Dynamic Context Providers:

1. Builds the framework system prompt via `MxfAgentSystemPrompt.buildFrameworkSystemPrompt()`
2. Appends channel context, memory context, and MXP context
3. If `dynamicContextInjectionEnabled`, constructs a `DynamicContextInput` from the current agent/channel state and calls `DynamicContextRegistry.gatherContext()` with the configured token budget
4. Appends the gathered dynamic context to the system prompt

## Configuration

All feature flags are defined in `src/shared/config/PromptCompactionConfig.ts` and loaded from environment variables. Every flag defaults to `false`.

| Feature | Env Var | Default | Description |
|---------|---------|---------|-------------|
| Tool Behavioral Guidance | `TOOL_BEHAVIORAL_GUIDANCE_ENABLED` | `false` | Append per-tool behavioral hints to tool descriptions |
| Deferred Tool Schemas | `DEFERRED_TOOL_SCHEMAS_ENABLED` | `false` | Tier-1/tier-2 progressive schema disclosure |
| Dynamic Context Injection | `DYNAMIC_CONTEXT_INJECTION_ENABLED` | `false` | Runtime context providers in system prompts |
| Dynamic Context Budget | `DYNAMIC_CONTEXT_TOKEN_BUDGET` | `1000` | Max tokens for dynamic context output |

Enable features by setting the env var to `true` in your `.env` file or via `mxf config set`:

```bash
# Enable all prompting enhancements
TOOL_BEHAVIORAL_GUIDANCE_ENABLED=true
DEFERRED_TOOL_SCHEMAS_ENABLED=true
DYNAMIC_CONTEXT_INJECTION_ENABLED=true
```

## See Also

- [Prompt Auto-Compaction](prompt-auto-compaction.md) -- conversation-level compaction features
- [Tool Reference](tool-reference.md) -- full MCP tool catalog
- [ORPAR Control Loop](orpar.md) -- the cognitive cycle these features augment
