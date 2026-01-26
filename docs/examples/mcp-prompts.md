# MCP Prompts Integration Demo

Demonstrates **dynamic prompt template discovery** from MCP servers and **intelligent argument resolution** from multiple sources.

## Overview

MCP Prompts allow agents to discover and use reusable prompt templates from MCP servers. Arguments are resolved hierarchically from explicit values, task context, agent config, channel memory, or LLM inference.

## Key MXF Features Demonstrated

### Argument Resolution Hierarchy

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | Explicit | Provided directly in the call |
| 2 | Task | From current task context |
| 3 | Agent | From agent configuration |
| 4 | Channel | From channel memory |
| 5 | SystemLLM | Inferred by LLM (last resort) |

### Features Shown

1. **Prompt Discovery**: Finding prompts from MCP servers
2. **Argument Resolution**: Hierarchical source resolution
3. **Resolution Demo**: Live argument resolution example
4. **Prompt Composition**: Combining multiple templates
5. **Cache Behavior**: Cache hits/misses tracking
6. **MXF Integration**: Agent-based prompt processing

## Running the Demo

### Start Server

```bash
bun run dev
```

### Set Up Environment

```bash
cd examples/mcp-prompts-demo
cp .env.example .env
```

### Run the Demo

```bash
bun run mcp-prompts-demo.ts
```

## Sample Prompts

The demo includes these sample prompts:

| Prompt | Required Args | Optional Args |
|--------|---------------|---------------|
| code_review | language, code | focus |
| summarize_document | document | length, format |
| generate_test_cases | function_signature | framework, coverage |
| explain_concept | concept | audience, examples |

## Prompt Definition

```typescript
const prompt: PromptDefinition = {
  name: 'code_review',
  description: 'Review code for best practices',
  arguments: [
    { name: 'language', description: 'Programming language', required: true },
    { name: 'code', description: 'Code to review', required: true },
    { name: 'focus', description: 'Review focus', required: false }
  ]
};
```

## Using Prompts

```typescript
// Register MCP client for prompt discovery
promptsManager.registerMcpClient(mcpClient);

// Get a prompt with resolved arguments
const resolved = await promptsManager.getPrompt('code_review', {
  code: 'function hello() { ... }',
  // Other args resolved from context
});
```

## Configuration

```typescript
const config = {
  enabled: true,
  cache: {
    strategy: 'memory',
    ttlSeconds: 300,
    maxEntries: 1000
  },
  discovery: {
    refreshIntervalSeconds: 60,
    timeoutMs: 5000
  },
  resolution: {
    maxEmbeddedResourceSize: 1048576,  // 1MB
    allowedResourceSchemes: ['resource://', 'file://']
  }
};
```

## Learning Points

- **Reusability**: Define prompts once, use everywhere
- **Discoverability**: Find prompts from any MCP server
- **Context Awareness**: Arguments from multiple sources
- **Caching**: Efficient prompt template caching
- **Composition**: Combine prompts for complex tasks

## Source Code

See the full implementation in `examples/mcp-prompts-demo/`

## Related Documentation

- [MCP Prompts](../mxf/mcp-prompts.md)
- [MCP Integration](../sdk/mcp.md)
- [External MCP Servers](../sdk/external-mcp-servers.md)
