# SDK Configuration Manager

The **ConfigManager** provides a comprehensive configuration system for managing LLM model selection, agent types, and channel-level SystemLLM settings in the MXF SDK. It enables dynamic configuration of agent behaviors and capabilities without code changes.

## Overview

The ConfigManager follows a singleton pattern and provides:

- **LLM Model Configuration**: Manage multiple LLM providers and model selection
- **Agent Type Management**: Define roles, service types, and specializations
- **Process-Local SystemLLM Settings**: Read and adjust SystemLLM settings for the process the ConfigManager runs in
- **Observable Configuration**: React to configuration changes in real-time
- **Environment-Specific Settings**: Support for development, staging, and production

**Note:** For feature-level control (MXP optimization, binary protocol, etc.), use the [MXP Configuration](mxp-config.md) system instead.

## Key Features

### Agent Type Configuration

Comprehensive agent type management with:

- **Supported Roles**: consumer, provider, admin
- **Service Types**: assistant, specialist, coordinator, memory, tool_provider, data_processor, workflow_manager, monitoring, integration
- **Specializations**: 17+ specializations including code_assistant, data_analyst, pattern_recognition, etc.
- **Capability Mapping**: Automatic capability assignment based on service types
- **Role Permissions**: Fine-grained permission control per role

### SystemLLM Settings Are Process-Local

The ConfigManager is a singleton inside one process. Its SystemLLM methods
(`isChannelSystemLlmEnabled`, `setChannelSystemLlmEnabled`,
`setChannelSystemLlmOperationOverride`, `getChannelSystemLlmConfig`) read and
change the configuration of *that process*. Calling them in an SDK client does
not configure a remote MXF server: the server decides whether SystemLLM runs for
a channel from the channel record it persisted at creation.

To control SystemLLM for a channel, set it when the channel is created:

```typescript
const channel = await sdk.createChannel('demo-channel', {
    name: 'Demo channel',
    systemLlmEnabled: false   // agents coordinate on their own; no SystemLLM spend
});
```

Operation-specific overrides (taskAssignment, reasoning, interpretation,
reflection, coordination) apply within the process that hosts SystemLLM, which
is the MXF server.

## Usage

### Getting the Singleton Instance

```typescript
import { ConfigManager } from '@mxf-dev/sdk';

const configManager = ConfigManager.getInstance();
```

### Managing LLM Models

```typescript
// Get the default LLM model
const defaultModel = configManager.getLlmModel();
console.log(defaultModel?.name); // "Claude 3 Opus"

// Get a specific model
const gpt4 = configManager.getLlmModel('gpt-4-turbo');
console.log(gpt4?.contextWindow); // 128000

// Set default model
configManager.setDefaultLlmModel('gpt-4-turbo').subscribe(success => {
    console.log('Default model updated:', success);
});
```

### Agent Type Management

```typescript
// Get supported agent roles
const roles = configManager.getSupportedAgentRoles();
// ['consumer', 'provider', 'admin']

// Get capabilities for a service type
const capabilities = configManager.getAgentCapabilities('specialist');
// ['domain_expertise', 'advanced_reasoning', 'specialized_tools']

// Validate agent configuration
const isValid = configManager.validateAgentConfig(
    'provider',                              // role
    ['specialist', 'coordinator'],           // serviceTypes
    'pattern_recognition'                    // specialization
);

// Get recommended capabilities
const recommended = configManager.getRecommendedCapabilities(
    ['assistant', 'specialist'],
    'code_assistant'
);
```

### Reading SystemLLM Settings

These calls report the configuration of the current process. In an SDK client
they describe the client, not the server; see "SystemLLM Settings Are
Process-Local" above for how to turn SystemLLM off for a channel.

```typescript
// Is SystemLLM enabled in this process?
const isEnabled = configManager.isChannelSystemLlmEnabled();

// Is a specific operation enabled in this process?
const isTaskAssignmentEnabled = configManager.isChannelSystemLlmEnabled('taskAssignment');

// Full configuration for this process
const systemLlmConfig = configManager.getChannelSystemLlmConfig();
console.log(systemLlmConfig);
```

### Observable Configuration

```typescript
// Subscribe to configuration changes
configManager.getConfigObservable().subscribe(config => {
    console.log('Configuration updated:', config.version);
    
    // React to changes
    if (config.features.mcp_integration.enabled) {
        console.log('MCP is now enabled');
    }
});

// Update configuration
configManager.updateConfig({
    parameters: {
        logLevel: 'debug',
        messageRetryCount: 5
    }
}).subscribe(updatedConfig => {
    console.log('Config updated with new parameters');
});
```

### Custom Parameters

```typescript
// Get parameter with default
const timeout = configManager.getParameter<number>('agentConnectTimeout', 30000);

// Set parameter
configManager.setParameter('customSetting', 'myValue').subscribe(success => {
    console.log('Parameter set:', success);
});
```

### Loading Configuration

```typescript
// Load from object
configManager.loadConfig({
    features: {
        binary_protocol: {
            ...configManager.getFeature('binary_protocol'),
            enabled: false
        }
    },
    parameters: {
        logLevel: 'debug'
    }
}).subscribe(config => {
    console.log('Configuration loaded');
});
```

## Default Configuration

### LLM Models

**Note:** The ConfigManager has legacy default models. In practice, MXF supports and recommends modern models.

> **Note:** Model ids change often. The ids in these docs are a snapshot of what was
> available when they were written; providers add, rename, and retire models all the
> time. Check your provider's current list before relying on an id — for OpenRouter,
> <https://openrouter.ai/models>. For Claude on OpenRouter, `~anthropic/claude-opus-latest`,
> `~anthropic/claude-sonnet-latest`, and `~anthropic/claude-haiku-latest` resolve to the
> newest release in each family, so they are the ids to use unless you need a specific
> version. `~anthropic/claude-fable-latest` is the same kind of alias for the top-tier
> family; it is priced well above the others and nothing in MXF selects it by default.

**Recommended Models:**

**Anthropic:**
- `claude-3-5-sonnet-20241022` - Latest Sonnet (200K context, best reasoning)
- `claude-3-5-haiku-20241022` - Fast, cost-effective (200K context)
- `claude-3-opus-20240229` - Highest capability (200K context)

**OpenAI:**
- `gpt-4o` - Multimodal, fast (128K context)
- `gpt-4o-mini` - Cost-effective (128K context)
- `o1-preview` - Advanced reasoning
- `o1-mini` - Reasoning on budget

**Google:**
- `gemini-2.0-flash-exp` - Fast, experimental (1M context)
- `gemini-1.5-pro` - Stable release (2M context)
- `gemini-1.5-flash` - Fast, cost-effective (1M context)

**OpenRouter (Multi-Provider):**
- `~anthropic/claude-opus-latest` - Newest Claude Opus, via OpenRouter's latest-resolution alias
- `~anthropic/claude-sonnet-latest` - Newest Claude Sonnet
- `~anthropic/claude-haiku-latest` - Newest Claude Haiku
- `~anthropic/claude-fable-latest` - Newest Claude Fable; the most capable and the most expensive, never selected by default
- `openai/gpt-4o` - Via OpenRouter
- `google/gemini-2.0-flash-lite-001` - Ultra-fast observation
- `x-ai/grok-3` - XAI's latest

**XAI:**
- `grok-2-1212` - Latest Grok model

See [SystemLlmService](../../src/server/socket/services/SystemLlmService.ts) for operation-specific model recommendations.

### Feature Defaults

| Feature | Enabled by Default | Requires |
|---------|-------------------|----------|
| binary_protocol | ✅ Yes | - |
| control_loop | ✅ Yes | - |
| memory_system | ✅ Yes | - |
| self_reflection | ✅ Yes | memory_system |
| agent_specialization | ✅ Yes | - |
| channel_context | ✅ Yes | - |
| mcp_integration | ✅ Yes | - |
| reinforcement_learning | ❌ No | self_reflection |
| transitional_intelligence | ❌ No | control_loop |

### Service Type Capabilities

| Service Type | Capabilities |
|--------------|--------------|
| assistant | conversation, task_execution, tool_use |
| specialist | domain_expertise, advanced_reasoning, specialized_tools |
| coordinator | multi_agent_communication, task_delegation, workflow_management |
| memory | data_storage, pattern_recognition, context_management |
| tool_provider | tool_execution, external_integration, resource_management |
| data_processor | data_analysis, transformation, aggregation |
| workflow_manager | process_orchestration, dependency_management, scheduling |
| monitoring | system_observation, performance_tracking, alerting |
| integration | external_api_access, protocol_translation, data_synchronization |

### Role Permissions

| Role | Permissions |
|------|-------------|
| consumer | read_channel, send_message, use_tools |
| provider | All consumer permissions + provide_tools, coordinate_agents |
| admin | All provider permissions + manage_channel, system_admin |

## Configuration Events

> **⚠️ IMPORTANT**: Configuration events are **internal/sensitive** and NOT available via `agent.on()`.  
> These events are blocked by the PUBLIC_EVENTS whitelist for security reasons.  
> Config changes happen server-side and are not exposed to agent SDK consumers.

### Internal Event Reference (Not Available via agent.on())

The following events exist internally but are **not accessible** through the agent SDK:

```typescript
// ❌ NOT AVAILABLE - Config events are internal only
// EventBus.client.on(ConfigEvents.CONFIG_UPDATED, ...) 
// EventBus.client.on(ConfigEvents.FEATURE_STATE_CHANGED, ...)
// EventBus.client.on(ConfigEvents.LLM_MODEL_CHANGED, ...)
// EventBus.client.on(ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED, ...)

// These are used internally by the framework but blocked from agent.on()
```

### Why Config Events Are Not Public

1. **Security**: Configuration changes are sensitive system operations
2. **Separation of Concerns**: Agents should not react to config changes directly
3. **Framework Control**: Config management is a server-side responsibility

If you need to react to configuration changes in your agent, consider:
- Using agent memory to store preferences
- Implementing feature detection via available tools
- Monitoring relevant public events (e.g., Events.Agent.STATUS_CHANGE)

## Best Practices

### Feature Management

{{ ... }}
2. **Use Events**: Subscribe to configuration events for reactive updates
3. **Fail-Safe Defaults**: Design code to work with features disabled
4. **Test Configurations**: Test with various feature combinations

### Agent Configuration

1. **Validate Early**: Use `validateAgentConfig()` during agent setup
2. **Use Recommended Capabilities**: Leverage `getRecommendedCapabilities()` for consistency
3. **Role-Based Access**: Always configure appropriate role permissions
4. **Specialization Matters**: Choose specializations that match agent purpose

### SystemLLM Control

1. **Decide at Channel Creation**: Pass `systemLlmEnabled` to `sdk.createChannel()`; the server persists it with the channel
2. **Do Not Expect Remote Effect**: `setChannelSystemLlmEnabled()` in a client process changes only that process
3. **Monitor Impact**: Track system behavior when SystemLLM is disabled

### Performance

1. **Singleton Pattern**: Always use `getInstance()` - don't create new instances
2. **Cache Feature Checks**: Store frequently-checked feature states
3. **Batch Updates**: Use `updateConfig()` for multiple changes at once
4. **Observable Cleanup**: Unsubscribe from observables when no longer needed

## Environment-Specific Configuration

```typescript
// Development environment
configManager.updateConfig({
    environment: {
        name: 'development',
        overrides: {
            parameters: {
                logLevel: 'debug',
                messageRetryCount: 5
            },
            features: {
                reinforcement_learning: {
                    ...configManager.getFeature('reinforcement_learning'),
                    enabled: true // Enable experimental features in dev
                }
            }
        }
    }
});

// Production environment
configManager.updateConfig({
    environment: {
        name: 'production',
        overrides: {
            parameters: {
                logLevel: 'info',
                messageRetryCount: 3
            }
        }
    }
});
```

## Integration with MxfAgent

The ConfigManager is integrated into MxfAgent and automatically configures agent behavior:

```typescript
import { ConfigManager, MxfSDK } from '@mxf-dev/sdk';

// Configure before creating agents
const configManager = ConfigManager.getInstance();
configManager.enableFeature('mcp_integration');

// Agent automatically uses current configuration
const agent = await sdk.createAgent({
    agentId: 'my-agent',
    name: 'My Agent',
    channelId: 'channel-1',
    keyId: 'key-id',
    secretKey: 'secret',
    // Agent respects all ConfigManager settings
});
```

## Type Safety

All ConfigManager methods are fully typed for TypeScript safety:

```typescript
import { 
    SdkConfig, 
    LlmModelConfig, 
    FeatureToggle,
    ConfigUpdateEvent,
    FeatureStateChangeEvent
} from '@mxf-dev/core/config/ConfigManager';

// Type-safe configuration
const config: SdkConfig = configManager.getConfig();

// Type-safe model
const model: LlmModelConfig | null = configManager.getLlmModel();

// Type-safe feature
const feature: FeatureToggle | null = configManager.getFeature('mcp_integration');
```

## Prompt Compaction Configuration

The `PromptCompactionConfig` controls the multi-layer compaction pipeline. All flags default to `false` and can be enabled via environment variables or programmatically.

```typescript
import { PromptCompactionConfig } from '@mxf-dev/core/config/PromptCompactionConfig';

// Check if a feature is enabled
const config = PromptCompactionConfig.getInstance();

// Environment variable overrides (set before server start):
// MICROCOMPACTION_ENABLED=true
// REACTIVE_COMPACTION_ENABLED=true
// POST_COMPACTION_RESTORATION_ENABLED=true
// SYSTEM_REMINDERS_ENABLED=true
// STRUCTURED_SUMMARIES_ENABLED=true
// DEFERRED_TOOL_SCHEMAS_ENABLED=true
// TOOL_BEHAVIORAL_GUIDANCE_ENABLED=true
// DYNAMIC_CONTEXT_INJECTION_ENABLED=true
```

| Flag | Default | Description |
|------|---------|-------------|
| `MICROCOMPACTION_ENABLED` | `false` | Strip old tool result bodies, keep metadata |
| `REACTIVE_COMPACTION_ENABLED` | `false` | Escalating compaction on 413 or threshold exceeded |
| `POST_COMPACTION_RESTORATION_ENABLED` | `false` | Restore high-priority artifacts after compaction |
| `SYSTEM_REMINDERS_ENABLED` | `false` | Inject contextual reminders on triggers |
| `STRUCTURED_SUMMARIES_ENABLED` | `false` | Heuristic summary builder for compaction |
| `DEFERRED_TOOL_SCHEMAS_ENABLED` | `false` | Tier-1/tier-2 tool schema splitting |
| `TOOL_BEHAVIORAL_GUIDANCE_ENABLED` | `false` | Per-tool behavioral hints |
| `DYNAMIC_CONTEXT_INJECTION_ENABLED` | `false` | Runtime context injection providers |

See [Compaction Pipeline](../mxf/compaction-pipeline.md) and [Prompting Enhancements](../mxf/prompting-enhancements.md) for detailed documentation.

## Related Documentation

- [SDK Index](./index.md) - Main SDK documentation
- [MxfAgent](../mxf/index.md) - Agent implementation
- [Event System](./events.md) - Event handling patterns
- [MXP Configuration](./mxp-config.md) - MXP-specific configuration
- [Compaction Pipeline](../mxf/compaction-pipeline.md) - Multi-layer compaction system
- [Prompting Enhancements](../mxf/prompting-enhancements.md) - Behavioral guidance and deferred schemas

---

For questions or issues with ConfigManager, refer to the source code at `/packages/sdk/src/config/ConfigManager.ts`.
