# MXF MCP Tools

A comprehensive collection of MCP (Model Context Protocol) tools designed specifically for the Model Exchange Framework (MXF). These tools enable agents to communicate, coordinate, and interact with system resources through standardized MCP interfaces while leveraging existing MXF event infrastructure.

## 🎯 Design Principles

- **No Event Duplication**: Leverages existing `MessageEvents`, `AgentEvents`, `ControlLoopEvents`, and `McpEvents`
- **DRY Architecture**: Reuses existing validation, event emission, and message handling infrastructure
- **MCP Compliant**: All tools follow MCP protocol standards for registration and execution
- **Type Safety**: Full TypeScript support with comprehensive input validation
- **Security Focused**: Built-in safety checks and access controls

## 📚 Tool Categories

### 🤝 Agent Communication Tools (4 tools)

Enable agents to communicate and coordinate with each other through the MXF messaging infrastructure.

#### `agent_message`
Send direct messages between agents using the standardized `AgentMessage` schema.

```typescript
await mcpTool.call('agent_message', {
    targetAgentId: 'agent-123',
    message: 'Hello from agent-456',
    messageType: 'direct',
    priority: 7,
    metadata: { topic: 'collaboration' }
});
```

#### `agent_broadcast`
Broadcast messages to multiple agents or entire channels.

```typescript
await mcpTool.call('agent_broadcast', {
    targetChannelId: 'channel-abc',
    message: 'System announcement',
    messageType: 'broadcast',
    excludeSelf: true,
    metadata: { urgency: 'high' }
});
```

#### `agent_discover`
Discover available agents and their capabilities within channels.

```typescript
const result = await mcpTool.call('agent_discover', {
    channelId: 'channel-abc',
    capabilities: ['messaging', 'control-loop']
});
```

#### `agent_coordinate`
Request coordination with other agents for collaborative tasks.

```typescript
await mcpTool.call('agent_coordinate', {
    targetAgentIds: ['agent-123', 'agent-456'],
    coordinationType: 'collaborate',
    taskDescription: 'Analyze data and generate report',
    deadline: Date.now() + 3600000 // 1 hour
});
```

### 🧠 Control Loop Tools (7 tools)

Manage ORPAR (Observation, Reasoning, Action, Planning, Reflection) cognitive cycles using existing control loop infrastructure.

#### `control_loop_start`
Initialize and start an agent's control loop with configuration.

```typescript
await mcpTool.call('control_loop_start', {
    loopId: 'analysis-loop-1',
    config: {
        maxIterations: 5,
        timeoutMs: 300000,
        observationInterval: 2000,
        autoReflection: true,
        phases: ['observation', 'reasoning', 'action', 'planning', 'reflection']
    },
    initialObservations: [
        { type: 'data', data: { source: 'sensors', values: [1, 2, 3] } }
    ]
});
```

#### `control_loop_observe`
Submit observations to a running control loop.

```typescript
await mcpTool.call('control_loop_observe', {
    loopId: 'analysis-loop-1',
    observations: [
        {
            type: 'sensor_data',
            data: { temperature: 25.3, humidity: 65 },
            source: 'iot-sensor-1',
            confidence: 0.95
        }
    ],
    priority: 8
});
```

#### `control_loop_reason`
Trigger reasoning phase with specific context and parameters.

```typescript
await mcpTool.call('control_loop_reason', {
    loopId: 'analysis-loop-1',
    reasoningContext: {
        focus: 'anomaly_detection',
        constraints: { maxProcessingTime: 10000 },
        goals: ['identify_patterns', 'flag_anomalies'],
        timeoutMs: 30000
    },
    includeHistory: true
});
```

#### `control_loop_plan`
Generate or modify plans based on reasoning results.

```typescript
await mcpTool.call('control_loop_plan', {
    loopId: 'analysis-loop-1',
    planningMode: 'create',
    planningConstraints: {
        maxSteps: 8,
        timeConstraint: 60000,
        resources: { memory: '512MB', cpu: '2cores' },
        priorities: ['accuracy', 'efficiency']
    }
});
```

#### `control_loop_execute`
Execute specific plan actions or steps.

```typescript
await mcpTool.call('control_loop_execute', {
    loopId: 'analysis-loop-1',
    actions: [
        {
            actionType: 'data_processing',
            parameters: { algorithm: 'kmeans', clusters: 3 },
            priority: 9,
            timeout: 15000
        }
    ],
    executionMode: 'sequential'
});
```

#### `control_loop_reflect`
Generate reflections on completed control loop cycles.

```typescript
await mcpTool.call('control_loop_reflect', {
    loopId: 'analysis-loop-1',
    reflectionScope: 'cycle',
    reflectionAspects: ['effectiveness', 'efficiency', 'learning', 'improvements'],
    includeMetrics: true
});
```

#### `control_loop_status`
Get current state and metrics of control loops.

```typescript
const status = await mcpTool.call('control_loop_status', {
    loopId: 'analysis-loop-1',
    includeMetrics: true,
    includeHistory: false
});
```

### 🛠️ Infrastructure Tools (6 tools)

Provide essential system interaction capabilities for file operations, memory management, and shell access.

#### `fs_read`
Read file contents with encoding options and safety checks.

```typescript
const file = await mcpTool.call('fs_read', {
    path: '/data/config.json',
    encoding: 'utf8',
    maxSize: 1048576, // 1MB limit
    startByte: 0,
    endByte: 1000
});
```

#### `fs_write`
Write content to files with safety checks and backup options.

```typescript
await mcpTool.call('fs_write', {
    path: '/data/output.txt',
    content: 'Analysis results...',
    encoding: 'utf8',
    mode: 'write',
    createBackup: true,
    permissions: '644'
});
```

#### `fs_list`
List directory contents with filtering and metadata.

```typescript
const listing = await mcpTool.call('fs_list', {
    path: '/data',
    recursive: false,
    includeHidden: false,
    filter: {
        extensions: ['json', 'txt'],
        minSize: 1024,
        modifiedAfter: Date.now() - 86400000 // Last 24 hours
    },
    includeStats: true
});
```

#### `memory_store`
Store key-value data with expiration and metadata.

```typescript
await mcpTool.call('memory_store', {
    key: 'analysis_results',
    value: { accuracy: 0.95, patterns: ['trend1', 'trend2'] },
    ttl: 3600000, // 1 hour
    namespace: 'experiments',
    metadata: { experiment_id: 'exp_001' },
    tags: ['analysis', 'ml_results']
});
```

#### `memory_retrieve`
Retrieve stored data with fallback options.

```typescript
const data = await mcpTool.call('memory_retrieve', {
    key: 'analysis_results',
    namespace: 'experiments',
    includeMetadata: true,
    defaultValue: { accuracy: 0.0, patterns: [] }
});
```

#### `shell_exec`
Execute shell commands with output capture and safety controls.

```typescript
const result = await mcpTool.call('shell_exec', {
    command: 'python',
    args: ['analyze.py', '--input', 'data.csv'],
    workingDirectory: '/scripts',
    timeout: 30000,
    captureOutput: true,
    allowedCommands: ['python', 'node', 'curl']
});
```

### 🧠 Meta-Tools & Validation (8 tools)

Intelligent tool discovery, validation, and recommendation capabilities with pattern learning and error prevention.

#### `tools_recommend` - Enhanced Intelligence Tool Selection

AI-powered tool recommendations with validation insights and pattern-based suggestions:

```typescript
const result = await mcpTool.call('tools_recommend', {
    intent: "I need to process and analyze some data files",
    includeValidationInsights: true,
    includeParameterExamples: true,
    includePatternRecommendations: true,
    maxRecommendations: 5
});

// Enhanced result includes validation success rates and parameter examples
console.log(result.recommendedTools[0].validationInsights.successRate); // 0.95
console.log(result.recommendedTools[0].parameterExamples); // Successful patterns
console.log(result.patternRecommendations); // Pattern-based suggestions
```

#### `tools_recommend_on_error` - Error Recovery Assistance

Specialized tool for immediate assistance when tool executions fail:

```typescript
const result = await mcpTool.call('tools_recommend_on_error', {
    failedTool: 'write_file',
    errorMessage: 'Expected string but received number for parameter: content',
    failedParameters: { path: '/test.txt', content: 12345 },
    intent: 'I was trying to save configuration data',
    includeParameterCorrections: true
});

// Result provides immediate error recovery assistance
console.log(result.errorType); // "typeMismatch"
console.log(result.alternatives); // Alternative tools
console.log(result.parameterCorrections); // Parameter fixes
console.log(result.preventionTips); // How to avoid similar errors
```

#### `validation_preview` - Pre-execution Validation

Preview validation results before executing tools:

```typescript
const preview = await mcpTool.call('validation_preview', {
    toolName: 'file_write',
    parameters: { path: '/tmp/test.txt', content: 'Hello' },
    includeHints: true,
    validationLevel: 'STRICT'
});

// Preview includes validation results and recommendations
console.log(preview.valid); // true/false
console.log(preview.errors); // Validation errors if any
console.log(preview.suggestions); // Improvement suggestions
console.log(preview.riskAssessment); // Risk level assessment
```

#### `validation_hints` - Real-time Parameter Hints

Get IDE-style parameter hints and suggestions:

```typescript
const hints = await mcpTool.call('validation_hints', {
    toolName: 'web_search',
    currentParameters: { query: 'TypeScript' },
    cursorPosition: { parameter: 'query', position: 10 }
});

// Hints include completions and documentation
console.log(hints.parameterHints); // Parameter suggestions
console.log(hints.completions); // Auto-completion options
console.log(hints.documentation); // Contextual help
```

#### `error_diagnose` - Advanced Error Analysis

Comprehensive error diagnosis with correction suggestions:

```typescript
const diagnosis = await mcpTool.call('error_diagnose', {
    toolName: 'calculator',
    parameters: { operation: 'divide', a: 10, b: 0 },
    errorMessage: 'Division by zero',
    includeAlternatives: true
});

// Diagnosis includes detailed analysis and solutions
console.log(diagnosis.errorCategory); // Error classification
console.log(diagnosis.rootCause); // Underlying issue
console.log(diagnosis.suggestedSolutions); // Fix recommendations
```

#### `validation_config` - Validation System Configuration

Configure validation behavior and levels:

```typescript
await mcpTool.call('validation_config', {
    action: 'set',
    service: 'validation',
    config: {
        defaultLevel: 'BLOCKING',
        enableAutoCorrection: true,
        learningEnabled: true
    }
});

// Returns updated configuration status
```

#### `analytics_aggregate` - Validation Analytics

Get aggregated validation and performance metrics:

```typescript
const metrics = await mcpTool.call('analytics_aggregate', {
    timeRange: 'hour',
    metrics: ['validation_success_rate', 'error_prevention_count', 'auto_correction_rate'],
    includeDetails: true
});

// Returns comprehensive analytics data
console.log(metrics.validationSuccessRate); // Success rate
console.log(metrics.errorsPreventedCount); // Errors blocked
console.log(metrics.trends); // Performance trends
```

#### `predict_errors` - ML-based Error Prediction

Use machine learning to predict potential errors before execution:

```typescript
const prediction = await mcpTool.call('predict_errors', {
    toolName: 'file_read',
    parameters: { path: '/nonexistent/file.txt' },
    includeConfidence: true
});

// Prediction includes error probability and suggestions
console.log(prediction.errorProbability); // 0.8 (80% chance of error)
console.log(prediction.predictedErrors); // Likely error types
console.log(prediction.preventionSuggestions); // How to avoid errors
```

## 🚀 Usage

### Tool Registration

```typescript
import { allMxfMcpTools, mxfMcpToolRegistry } from './src/shared/mcp/tools';

// Register all tools
for (const tool of allMxfMcpTools) {
    await mcpServer.registerTool(tool);
}

// Or register specific categories
import { agentCommunicationTools } from './src/shared/mcp/tools';
for (const tool of agentCommunicationTools) {
    await mcpServer.registerTool(tool);
}
```

### Tool Execution

```typescript
// Execute via MCP protocol
const result = await mcpClient.callTool('agent_message', {
    targetAgentId: 'target-agent',
    message: 'Hello world'
});

// Or use the registry directly
const tool = mxfMcpToolRegistry.get('control_loop_start');
if (tool) {
    const result = await tool.handler(params, context);
}
```

### Integration with MXF Events

All tools emit appropriate MXF events through the existing `EventBus`:

```typescript
// Tools automatically emit events like:
EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
EventBus.server.emit(Events.ControlLoop.INITIALIZE, payload);
```

## 🔧 Architecture Integration

### Event Infrastructure Reuse
- **MessageEvents**: Used for agent communication (`AGENT_MESSAGE`, `CHANNEL_MESSAGE`)
- **ControlLoopEvents**: Used for ORPAR management (`INITIALIZE`, `OBSERVATION`, `REASONING`, etc.)
- **McpEvents**: Used for tool lifecycle (`TOOL_REGISTER`, `TOOL_CALL`, `TOOL_RESULT`)

### Schema Reuse
- **AgentMessage/ChannelMessage**: Used for standardized messaging
- **ControlLoopSpecificData**: Used for control loop payloads
- **EventPayloadSchema**: Used for all event payload creation

### Validation Integration
- Uses existing `validation.ts` utilities for input validation
- Leverages existing TypeScript interfaces for type safety
- Integrates with existing error handling patterns

## 🛡️ Security Features

### Path Traversal Protection
```typescript
if (input.path.includes('..') || input.path.includes('~')) {
    throw new Error('Path traversal not allowed');
}
```

### Command Execution Safety
```typescript
const dangerousCommands = ['rm', 'del', 'format', 'mkfs', 'dd', 'sudo', 'su'];
if (dangerousCommands.some(cmd => input.command.includes(cmd))) {
    throw new Error('Potentially dangerous command detected');
}
```

### Resource Limits
- File size limits for read/write operations
- Command execution timeouts
- Memory TTL for automatic cleanup
- Namespace isolation for multi-agent environments

## 📊 Tool Metadata

```typescript
import { mxfMcpToolMetadata, getMxfMcpToolNames } from './src/shared/mcp/tools';

console.log(mxfMcpToolMetadata);
// {
//   version: '1.0.0',
//   totalTools: 25,
//   categories: ['communication', 'controlLoop', 'infrastructure', 'metaTools', 'validation'],
//   capabilities: ['agent-to-agent messaging', 'ORPAR cycle management', 'validation & error prevention', 'ML-based predictions', ...]
// }

console.log(getMxfMcpToolNames());
// {
//   communication: ['agent_message', 'agent_broadcast', ...],
//   controlLoop: ['control_loop_start', 'control_loop_observe', ...],
//   infrastructure: ['fs_read', 'fs_write', ...],
//   metaTools: ['tools_recommend', 'tools_recommend_on_error', 'error_diagnose', ...],
//   validation: ['validation_preview', 'validation_hints', 'validation_config', 'predict_errors', 'analytics_aggregate', ...],
//   all: [...] // All 25 tool names
// }
```

## 🧪 Testing

Tools are designed to integrate with existing MXF test infrastructure:

```typescript
// Example test using MxfAgent
const agent = new MxfAgent(config);
await agent.connect();

const result = await agent.callMcpTool('agent_message', {
    targetAgentId: 'test-agent',
    message: 'Test message'
});

expect(result.delivered).toBe(true);
```

## 🔄 Future Enhancements

- **Phase-Specific Tools**: Additional tools for observation, action, planning, and reflection phases
- **Workflow Orchestration**: Tools for complex multi-agent workflow management
- **Performance Monitoring**: Enhanced metrics and performance tracking
- **Plugin Architecture**: Support for custom tool extensions
- **Real-time Integration**: Live data streaming and monitoring capabilities

## 📝 Contributing

When adding new MCP tools:

1. Follow existing patterns in tool structure and naming
2. Leverage existing MXF event infrastructure - avoid creating new events
3. Use existing validation and schema utilities
4. Include comprehensive JSDoc documentation
5. Add appropriate security checks and input validation
6. Update the main index.ts file to include new tools
7. Add examples to this README

## 📄 License

Part of the Model Exchange Framework (MXF) - see main project license.
