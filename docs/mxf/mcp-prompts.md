# MCP Prompts Integration

## Overview

MXF now supports the Model Context Protocol (MCP) Prompts feature, enabling dynamic prompt templates that can be discovered and invoked with intelligent argument resolution. This integration positions MCP Prompts as a contract layer between MXF's orchestration logic and its MCP tool servers.

## Key Features

- **Prompt Discovery**: Automatic discovery of available prompts from connected MCP servers
- **Smart Caching**: Configurable caching with TTL for optimal performance
- **Argument Resolution**: Multi-source argument resolution with fallback hierarchy
- **SystemLLM Integration**: AI-powered inference for missing arguments
- **Prompt Composition**: Combine multiple prompts into single agent contexts
- **MXP Integration**: Token tracking and compression for embedded resources

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MXF ORCHESTRATION LAYER                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              MxfPromptsManager                          │   │
│   │   • Prompt Discovery & Caching                          │   │
│   │   • Argument Resolution                                 │   │
│   │   • Template Composition                                │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MCP SERVER LAYER                            │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │ Tool Srvr│  │ Memory   │  │ External │  │ Custom   │       │
│   │ (100+)   │  │ Server   │  │ APIs     │  │ Prompts  │       │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## Usage

### Basic Usage

```typescript
import { MxfPromptsManager } from './sdk/managers/MxfPromptsManager';
import { loadPromptsConfig } from './shared/config/McpPromptsConfig';

// Initialize with configuration
const config = loadPromptsConfig({
    enabled: true,
    cache: {
        strategy: 'memory',
        ttlSeconds: 300,
        maxEntries: 1000
    }
});

const promptsManager = new MxfPromptsManager(config);

// Register MCP clients
promptsManager.registerMcpClient(mcpClient);

// Start periodic discovery
promptsManager.startPeriodicDiscovery();
```

### Listing Available Prompts

```typescript
// List all prompts
const allPrompts = await promptsManager.listPrompts();

// List prompts from specific server
const serverPrompts = await promptsManager.listPrompts('server-id');

console.log(`Found ${allPrompts.length} prompts`);
allPrompts.forEach(prompt => {
    console.log(`- ${prompt.name}: ${prompt.description}`);
});
```

### Resolving Prompts

```typescript
// Resolve with explicit arguments
const resolved = await promptsManager.getPrompt('persona:researcher', {
    explicitArgs: {
        specialty: 'machine learning',
        depth: 'comprehensive'
    }
});

console.log(`Resolved prompt with ${resolved.messages.length} messages`);
console.log(`Token estimate: ${resolved.metadata.tokenEstimate}`);

// Use in agent context
agent.addSystemMessage(resolved.messages);
```

### Argument Resolution Hierarchy

Arguments are resolved in the following priority order:

1. **Explicit Arguments**: Directly provided by caller
2. **Task Context**: From current task parameters
3. **Agent Context**: From agent configuration and state
4. **Channel Context**: From channel metadata
5. **SystemLLM Inference**: AI-powered inference from available context
6. **Default Values**: From prompt definition

```typescript
const context: PromptResolutionContext = {
    agentId: 'agent-123',
    channelId: 'channel-456',
    taskContext: {
        operation: 'code_review'
    },
    agentContext: {
        role: 'reviewer',
        currentFile: 'example.ts'
    },
    explicitArgs: {
        language: 'typescript'
    }
};

const resolved = await promptsManager.getPrompt('code_review', context);
```

### Prompt Composition

Combine multiple prompts into a single agent context:

```typescript
// Compose persona and task prompts
const composed = await promptsManager.composePrompts(
    ['persona:analyst', 'task:research', 'constraints:time_limit'],
    {
        timeLimit: '2 hours',
        specialty: 'quantum computing'
    }
);

// All messages combined in order
console.log(`Composed ${composed.messages.length} messages`);
console.log(`Total tokens: ${composed.metadata.tokenEstimate}`);
```

### MxfMcpClientManager Integration

The MxfMcpClientManager now includes prompts support:

```typescript
import { MxfMcpClientManager } from './sdk/managers/MxfMcpClientManager';

const mcpManager = new MxfMcpClientManager(agentId, agentConfig);

// Initialize prompts support
mcpManager.initializePromptsManager({
    enabled: true,
    cache: { strategy: 'memory', ttlSeconds: 300, maxEntries: 1000 }
});

// Use prompts
const prompts = await mcpManager.listPrompts();
const resolved = await mcpManager.getPrompt('persona:researcher', context);

// Cache management
mcpManager.invalidatePromptsCache('server-id');
const stats = mcpManager.getPromptsCacheStats();
```

## Configuration

### Environment Variables

Configure MCP Prompts using environment variables:

```bash
# Enable/disable prompts feature
MCP_PROMPTS_ENABLED=true

# Cache configuration
MCP_PROMPTS_CACHE_STRATEGY=memory  # memory | redis | none
MCP_PROMPTS_CACHE_TTL=300          # seconds
MCP_PROMPTS_CACHE_MAX_ENTRIES=1000

# Discovery configuration
MCP_PROMPTS_REFRESH_INTERVAL=60    # seconds
MCP_PROMPTS_TIMEOUT=5000           # milliseconds

# Resource limits
MCP_PROMPTS_MAX_RESOURCE_SIZE=1048576  # bytes (1MB)
MCP_PROMPTS_ALLOWED_SCHEMES=resource://,file://

# MXP integration
MCP_PROMPTS_COMPRESS_RESOURCES=true
MCP_PROMPTS_TRACK_TOKENS=true
```

### Programmatic Configuration

```typescript
import { loadPromptsConfig, validatePromptsConfig } from './shared/config/McpPromptsConfig';

const config = loadPromptsConfig({
    enabled: true,
    cache: {
        strategy: 'redis',
        ttlSeconds: 600,
        maxEntries: 5000
    },
    discovery: {
        refreshIntervalSeconds: 120,
        timeoutMs: 10000
    },
    resolution: {
        maxEmbeddedResourceSize: 5 * 1024 * 1024, // 5MB
        allowedResourceSchemes: ['resource://', 'file://', 'https://']
    },
    mxpIntegration: {
        compressEmbeddedResources: true,
        trackTokenUsage: true
    }
});

// Validate configuration
const errors = validatePromptsConfig(config);
if (errors.length > 0) {
    console.error('Configuration errors:', errors);
}
```

## Use Cases

### 1. Dynamic Agent Personas

Load agent behaviors dynamically without redeployment:

```typescript
// Agent joins channel
const persona = await promptsManager.getPrompt('persona:code_reviewer', {
    agentContext: {
        name: agent.name,
        specialization: 'security',
        strictness: 'high'
    }
});

// Inject as system context
agent.setSystemPrompt(persona.messages);
```

### 2. Task Decomposition Templates

Use reusable reasoning patterns:

```typescript
// SystemLLM identifies task type
const taskType = 'research_synthesis';

// Fetch decomposition template
const template = await promptsManager.getPrompt(`task:${taskType}`, {
    taskContext: {
        topic: 'quantum entanglement',
        depth: 'comprehensive',
        constraints: ['academic sources', 'peer-reviewed']
    }
});

// Use template for subtask generation
const subtasks = systemLLM.generateSubtasks(template);
```

### 3. External API Integration Contracts

Self-documenting API structures:

```typescript
// Tool server provides prompt describing expected format
const apiPrompt = await promptsManager.getPrompt('api:weather_query', {
    explicitArgs: {
        location: 'San Francisco',
        units: 'metric'
    }
});

// Use prompt to format request correctly
const request = formatFromPrompt(apiPrompt);
```

### 4. Multi-Modal Context Injection

Seamless handling of images, audio, and resources:

```typescript
// Prompt with embedded visual context
const visualPrompt = await promptsManager.getPrompt('analyze:screenshot', {
    explicitArgs: {
        screenshot_uri: 'resource://memory/screenshot-123'
    }
});

// MXP automatically handles compression
// Agent receives optimized multi-modal context
```

## SystemLLM Integration

The `PromptArgumentInferenceService` uses SystemLLM to intelligently infer missing arguments:

```typescript
import { PromptArgumentInferenceService } from './shared/services/PromptArgumentInferenceService';

const inferenceService = PromptArgumentInferenceService.getInstance();

// Register SystemLLM service (done during server init)
inferenceService.setSystemLlmService(systemLlmService);

// Inference happens automatically during resolution
const resolved = await promptsManager.getPrompt('code_review', {
    agentContext: {
        currentFile: 'example.ts',
        role: 'reviewer'
    }
    // 'language' argument will be inferred as 'typescript' from file extension
});
```

Inference confidence threshold: **0.7** (70%)

## Cache Management

Monitor and manage the prompt cache:

```typescript
// Get cache statistics
const stats = promptsManager.getCacheStats();
console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
console.log(`Cache size: ${stats.size}/${stats.maxSize}`);
console.log(`Hits: ${stats.hits}, Misses: ${stats.misses}`);

// Invalidate cache for specific server
promptsManager.invalidateCache('server-id');

// Clear all cache
promptsManager.invalidateCache();

// Listen for cache events
promptsManager.on('promptsDiscovered', ({ serverId, prompts }) => {
    console.log(`Discovered ${prompts.length} prompts from ${serverId}`);
});
```

## Performance Considerations

### Discovery Performance

- **Target**: < 500ms for up to 100 MCP servers
- **Pagination**: Automatic handling of large prompt catalogs
- **Caching**: 90%+ hit rate during normal operation

### Resolution Performance

- **Target**: < 200ms for prompts without embedded resources
- **Timeout**: Configurable (default 5000ms)
- **Retry**: Exponential backoff with max 3 attempts

### Token Tracking

Token estimates are automatically calculated for:
- Text content
- Embedded resources (rough estimates)
- Composed prompts (aggregated)

MXP integration enables compression and optimization for large prompts.

## Error Handling

The system handles errors gracefully:

```typescript
try {
    const resolved = await promptsManager.getPrompt('my_prompt', context);
} catch (error) {
    if (error.message.includes('Prompt not found')) {
        // Handle missing prompt
    } else if (error.message.includes('Required argument')) {
        // Handle missing argument
    } else if (error.message.includes('not available')) {
        // Handle server unavailable
    }
}
```

Fallback strategies:
1. Cache hit during server outage
2. Default values for optional arguments
3. Graceful degradation to static prompts

## Testing

Run the comprehensive test suite:

```bash
# Unit tests
bun run test:unit -- --testPathPattern=prompts

# Integration tests (requires running server)
bun run dev  # Terminal 1
bun run test:integration -- --testPathPattern=prompt  # Terminal 2
```

## Migration Path

For existing deployments:

1. **Phase 1**: Enable feature with discovery only
2. **Phase 2**: Add argument resolution to specific prompts
3. **Phase 3**: Enable SystemLLM inference
4. **Phase 4**: Full prompt composition support

## Best Practices

1. **Argument Design**: Keep required arguments minimal
2. **Default Values**: Provide sensible defaults for optional arguments
3. **Cache Strategy**: Use Redis for production, memory for development
4. **Discovery Interval**: Balance freshness vs. load (60-300 seconds)
5. **Resource Size**: Limit embedded resources to essential content
6. **Token Budget**: Monitor token estimates for cost control
7. **Error Messages**: Provide clear descriptions for arguments
8. **Versioning**: Use descriptive prompt names with optional version suffixes

## Related Documentation

- [MCP Specification - Prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)
- [Tool Reference](tool-reference.md)
- [Architecture Overview](../index.md)

## Troubleshooting

### Prompts not discovered

- Check MCP server connection: `client.isConnected()`
- Verify server supports prompts: check server capabilities
- Check discovery timeout: increase if needed
- Review server logs for errors

### Arguments not resolved

- Check resolution context completeness
- Verify argument names match prompt definition
- Review SystemLLM inference logs
- Check confidence threshold (0.7 minimum)

### Cache issues

- Check cache strategy configuration
- Verify TTL settings
- Monitor cache size limits
- Use `invalidateCache()` to force refresh

### Performance issues

- Reduce discovery interval
- Increase cache size
- Use Redis instead of memory cache
- Limit embedded resource sizes
- Monitor token estimates
