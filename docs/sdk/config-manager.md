# SDK Configuration Manager

The **ConfigManager** provides a comprehensive configuration system for managing LLM model selection, agent types, and channel-level SystemLLM settings in the MXF SDK. It enables dynamic configuration of agent behaviors and capabilities without code changes.

## Overview

The ConfigManager follows a singleton pattern and provides:

- **LLM Model Configuration**: Manage multiple LLM providers and model selection
- **Agent Type Management**: Define roles, service types, and specializations
- **Channel SystemLLM Control**: Configure SystemLLM at the channel level
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

### Channel-Level SystemLLM Control

Control SystemLLM behavior at the channel level:

- **Global Enable/Disable**: Turn off SystemLLM for entire channel
- **Operation-Specific Overrides**: Control individual operations (taskAssignment, reasoning, interpretation, reflection, coordination)
- **Inheritance**: Agent and task-level settings respect channel configuration

## Usage

### Getting the Singleton Instance

```typescript
import { ConfigManager } from './src/sdk/config/ConfigManager';

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

### Channel SystemLLM Configuration

```typescript
// Check if SystemLLM is enabled
const isEnabled = configManager.isChannelSystemLlmEnabled();

// Check specific operation
const isTaskAssignmentEnabled = configManager.isChannelSystemLlmEnabled('taskAssignment');

// Disable SystemLLM for the channel
configManager.setChannelSystemLlmEnabled(false, 'Reducing API costs').subscribe(success => {
    console.log('SystemLLM disabled:', success);
});

// Set operation-specific override
configManager.setChannelSystemLlmOperationOverride('reasoning', false).subscribe(success => {
    console.log('Reasoning operation disabled:', success);
});

// Get full configuration
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

**Note:** The ConfigManager has legacy default models. In practice, MXF supports and recommends modern models:

**Recommended Models (2024+):**

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
- `anthropic/claude-3.5-sonnet` - Via OpenRouter
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

1. **Channel-Level First**: Set channel-level SystemLLM settings before agent/task settings
2. **Operation Granularity**: Use operation-specific overrides for fine-grained control
3. **Document Reasons**: Always provide reasons when disabling SystemLLM
4. **Monitor Impact**: Track system behavior when SystemLLM is disabled

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
import { MxfSDK } from './src/sdk/MxfSDK';
import { ConfigManager } from './src/sdk/config/ConfigManager';

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
} from './src/sdk/config/ConfigManager';

// Type-safe configuration
const config: SdkConfig = configManager.getConfig();

// Type-safe model
const model: LlmModelConfig | null = configManager.getLlmModel();

// Type-safe feature
const feature: FeatureToggle | null = configManager.getFeature('mcp_integration');
```

## Related Documentation

- [SDK Index](./index.md) - Main SDK documentation
- [MxfAgent](../mxf/index.md) - Agent implementation
- [Event System](./events.md) - Event handling patterns
- [MXP Configuration](./mxp-config.md) - MXP-specific configuration

---

For questions or issues with ConfigManager, refer to the source code at `/src/sdk/config/ConfigManager.ts`.
