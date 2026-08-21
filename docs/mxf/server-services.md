# MXF Server Services

The MXF server includes a comprehensive suite of services that power the framework's core functionality. These services handle everything from agent connections and messaging to AI-powered task coordination and system optimization.

## Overview

MXF server services are organized into several categories:

1. **Core Services**: Socket management, channel operations, agent lifecycle
2. **AI Services**: SystemLLM integration, mode detection, reflection
3. **Task Services**: Task management, completion monitoring
4. **MCP Services**: Tool execution, MCP integration
5. **Pattern Services**: Ephemeral events, pattern detection
6. **Optimization Services**: Performance tuning, validation

## Core Services

### SocketService

Manages WebSocket connections between agents and the server.

**Purpose:**
- Handle agent socket connections
- Manage heartbeat/keep-alive
- Route messages between agents
- Handle connection lifecycle (connect, disconnect, reconnect)

**Key Features:**
- **Heartbeat Monitoring**: 30-second heartbeat interval
- **Connection State Tracking**: Track agent online/offline status
- **Event Emission**: Emits connection events for monitoring
- **Error Handling**: Graceful handling of connection failures

**Usage:**
```typescript
import { SocketService } from './src/server/socket/services/SocketService';

const socketService = SocketService.getInstance();

// Initialize with HTTP server
socketService.initialize(httpServer);

// Get connected agents
const agents = socketService.getConnectedAgents();

// Send message to agent
socketService.sendToAgent(agentId, 'message_event', data);
```

**Events Emitted:**
- `agent:connected` - Agent connects to server
- `agent:disconnected` - Agent disconnects
- `agent:heartbeat` - Heartbeat received
- `connection:error` - Connection error occurred

### ChannelService

Manages channel lifecycle and agent membership.

**Purpose:**
- Create and manage channels
- Handle agent channel membership
- Broadcast messages to channels
- Track channel activity and metrics

**Key Features:**
- **Channel CRUD**: Create, read, update, delete channels
- **Membership Management**: Add/remove agents from channels
- **Broadcasting**: Send messages to all channel members
- **Activity Tracking**: Monitor channel usage patterns
- **Event-Driven**: Emits events for all channel operations

**Usage:**
```typescript
import { ChannelService } from './src/server/socket/services/ChannelService';

const channelService = ChannelService.getInstance();

// Create channel
await channelService.createChannel({
    channelId: 'project-team',
    name: 'Project Team',
    description: 'Collaboration channel'
});

// Add agent to channel
await channelService.addAgentToChannel('agent-1', 'project-team');

// Broadcast message
await channelService.broadcastToChannel('project-team', {
    type: 'announcement',
    content: 'Team meeting in 10 minutes'
});

// Get channel members
const members = await channelService.getChannelMembers('project-team');
```

**Events Emitted:**
- `channel:created` - New channel created
- `channel:updated` - Channel updated
- `channel:deleted` - Channel deleted
- `agent:joined_channel` - Agent joined channel
- `agent:left_channel` - Agent left channel

### AgentService

Manages agent lifecycle, registration, and session data.

**Purpose:**
- Agent registration and authentication
- Session management
- Agent-to-agent messaging
- Agent status tracking

**Key Features:**
- **Registration**: Handle new agent registration
- **Authentication**: Verify agent credentials
- **Session Management**: Track active agent sessions
- **Status Updates**: Monitor agent online/offline/idle status
- **Direct Messaging**: Route agent-to-agent messages

**Usage:**
```typescript
import { AgentService } from './src/server/socket/services/AgentService';

const agentService = AgentService.getInstance();

// Register agent
await agentService.registerAgent({
    agentId: 'agent-1',
    name: 'AI Assistant',
    role: 'assistant',
    capabilities: ['chat', 'analysis']
});

// Update agent status
await agentService.updateAgentStatus('agent-1', 'active');

// Send direct message
await agentService.sendDirectMessage({
    from: 'agent-1',
    to: 'agent-2',
    content: 'Hello!'
});

// Get agent info
const agent = await agentService.getAgent('agent-1');
```

**Agent Status:**
- `online` - Agent connected and active
- `idle` - Agent connected but inactive
- `offline` - Agent disconnected
- `busy` - Agent processing task

## AI Services

### SystemLlmService

Provides AI-powered decision-making and reasoning for the framework.

**Purpose:**
- Task assignment and agent selection
- Intelligent reasoning and analysis
- Structured LLM interactions with JSON schema enforcement
- Multi-provider support (OpenRouter, Gemini, OpenAI, Anthropic)

**Key Features:**
- **Provider Agnostic**: Works with any LLM provider
- **Schema Enforcement**: JSON schema validation for structured outputs
- **Retry Logic**: Automatic retries with exponential backoff
- **Error Handling**: Graceful degradation on LLM failures
- **Context Management**: Efficient context handling
- **Cost Tracking**: Monitor token usage and costs

**Operations:**
- `taskAssignment` - Select best agent for task
- `reasoning` - Analyze situations and provide insights
- `interpretation` - Interpret agent communications
- `reflection` - Analyze outcomes and generate learnings
- `coordination` - Coordinate multi-agent activities

**Usage:**
```typescript
import { SystemLlmService } from './src/server/socket/services/SystemLlmService';

const systemLlm = new SystemLlmService({
    provider: 'openrouter',
    model: '~anthropic/claude-sonnet-latest',
    apiKey: process.env.OPENROUTER_API_KEY,
    temperature: 0.7
});

// Task assignment
const assignment = await systemLlm.assignTask({
    task: {
        title: 'Analyze sales data',
        description: 'Generate quarterly sales report',
        requirements: ['data analysis', 'visualization']
    },
    availableAgents: [
        {
            agentId: 'data-analyst',
            capabilities: ['data_analysis', 'visualization'],
            currentLoad: 2
        }
    ],
    channelContext: {
        projectName: 'Q4 Analysis'
    }
});

// Reasoning
const reasoning = await systemLlm.reason({
    situation: 'Multiple agents reported conflicting data',
    context: { dataPoints: [...] },
    objective: 'Determine data accuracy'
});

// Reflection
const reflection = await systemLlm.reflect({
    action: 'data_processing',
    outcome: { success: true, timeTaken: 500 },
    learnings: []
});
```

**Schema Enforcement:**
```typescript
// Define expected schema
const schema = {
    type: 'object',
    properties: {
        selectedAgent: { type: 'string' },
        confidence: { type: 'number' },
        reasoning: { type: 'string' }
    },
    required: ['selectedAgent', 'confidence', 'reasoning']
};

// LLM response automatically validated against schema
const result = await systemLlm.processWithSchema(prompt, schema);
```

### SystemLlmServiceManager

**Singleton service** that manages per-channel SystemLlmService instances for independent channel configurations.

**Architecture:**
- **One instance per channel**: Each channel gets its own isolated SystemLlmService
- **Lazy instantiation**: Instances created on first request for a channel
- **Automatic cleanup**: Removes instances when channels are destroyed
- **Null safety**: Returns `null` when `SYSTEMLLM_ENABLED=false`

**Purpose:**
- Create and manage SystemLLM instances per channel
- Support channel-specific LLM configurations
- Prevent resource bottlenecks via isolation
- Efficient resource management
- Centralized service lifecycle

**Environment Configuration:**
- `loadSystemLlmEnvironmentConfig()` reads the `SYSTEMLLM_*` variables and returns a `SystemLlmServiceConfig`, or `null` when SystemLLM is off. It throws when SystemLLM is on and the provider's credentials or `SYSTEMLLM_DEFAULT_MODEL` are missing — there is no built-in model to fall back to.
- `assertSystemLlmConfigured()` calls it once at server boot, next to the JWT and Mongo checks, so a misconfigured SystemLLM stops the server from starting instead of failing on the first request.

**Usage:**
```typescript
import { SystemLlmServiceManager } from './src/server/socket/services/SystemLlmServiceManager';
import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';

const manager = SystemLlmServiceManager.getInstance();

// Get or create SystemLlmService instance for a channel
// Returns existing instance if already created, otherwise creates new one
const service = manager.getServiceForChannel('channel-1', {
    providerType: LlmProviderType.OPENROUTER,
    defaultModel: '~anthropic/claude-sonnet-latest',
    orparModels: {
        reasoning: '~anthropic/claude-sonnet-latest',
        planning: 'openai/o1-preview'
    }
});

// Returns null if SystemLLM is disabled
if (!service) {
    console.log('SystemLLM is disabled');
    return;
}

// Use channel-specific service
const result = await service.processObservationData(observations);

// Cleanup happens automatically when channel is destroyed
// Manager listens to CHANNEL_DESTROYED events
```

### ModeDetectionService

Detects agent operational modes and suggests appropriate behaviors.

**Purpose:**
- Analyze agent communication patterns
- Detect operational modes (exploration, execution, coordination, etc.)
- Provide contextual guidance
- Optimize agent behavior

**Detected Modes:**
- `exploration` - Agent discovering capabilities
- `execution` - Agent actively executing tasks
- `coordination` - Multi-agent coordination
- `learning` - Agent learning from interactions
- `idle` - Agent waiting for input
- `error_recovery` - Agent recovering from errors

**Usage:**
```typescript
import { ModeDetectionService } from './src/server/socket/services/ModeDetectionService';

const modeDetector = new ModeDetectionService();

// Detect mode from agent activity
const mode = await modeDetector.detectMode({
    agentId: 'agent-1',
    recentMessages: [...],
    toolUsage: [...],
    taskStatus: 'in_progress'
});

console.log('Current mode:', mode.mode);
console.log('Confidence:', mode.confidence);
console.log('Guidance:', mode.guidanceMessage);
```

### ServerReflectionService

Handles server-side reflection processing for agent learning.

**Purpose:**
- Process agent reflections
- Generate learning insights
- Store reflection data
- Support pattern recognition

**Usage:**
```typescript
import { ServerReflectionService } from './src/server/socket/services/ServerReflectionService';

const reflectionService = new ServerReflectionService();

// Process reflection
const reflection = await reflectionService.processReflection({
    agentId: 'agent-1',
    action: 'task_completion',
    outcome: {
        success: true,
        metrics: { duration: 500, quality: 0.9 }
    },
    context: { taskType: 'data_analysis' }
});

// Get agent learnings
const learnings = await reflectionService.getAgentLearnings('agent-1');
```

## Task Services

### TaskService

Manages task lifecycle, assignment, and tracking.

**Purpose:**
- Task CRUD operations
- Task assignment to agents
- Progress tracking
- Completion monitoring
- Task analytics

**Key Features:**
- **Task Creation**: Create and validate tasks
- **Assignment**: Assign tasks to appropriate agents
- **Status Tracking**: Monitor task progress
- **Completion Detection**: Detect when tasks are complete
- **Analytics**: Track task performance metrics

**Usage:**
```typescript
import { TaskService } from './src/server/socket/services/TaskService';

const taskService = TaskService.getInstance();

// Create task
const task = await taskService.createTask({
    title: 'Analyze Q4 Data',
    description: 'Generate comprehensive Q4 analysis report',
    priority: 'high',
    channelId: 'analytics-team',
    createdBy: 'pm-agent'
});

// Assign task
await taskService.assignTask(task.id, 'data-analyst-agent');

// Update progress
await taskService.updateTaskProgress(task.id, {
    status: 'in_progress',
    progress: 50,
    message: 'Processing data...'
});

// Complete task
await taskService.completeTask(task.id, {
    success: true,
    result: { reportUrl: '/reports/q4-2024.pdf' }
});

// Get task analytics
const analytics = await taskService.getTaskAnalytics('analytics-team');
```

**Task Status Lifecycle:**
```
pending → assigned → in_progress → completed
                            ↓
                         failed
```

### TaskCompletionMonitoringService

Monitors autonomous task completion through agent tool calls.

**Purpose:**
- Monitor for task_complete tool calls
- Validate task completion
- Trigger completion workflows
- Handle completion events

**Key Features:**
- **Autonomous Completion**: Agents signal completion via tool
- **Validation**: Validate completion data
- **Event Emission**: Emit completion events
- **Workflow Triggers**: Trigger post-completion workflows

**Usage:**
```typescript
import { TaskCompletionMonitoringService } from './src/server/socket/services/TaskCompletionMonitoringService';

const monitor = TaskCompletionMonitoringService.getInstance();

// Start monitoring task
monitor.startMonitoring(taskId, {
    agentId: 'agent-1',
    channelId: 'channel-1',
    timeout: 300000 // 5 minutes
});

// Agent calls task_complete tool
// Monitor automatically detects and processes completion

// Get task status
const status = monitor.getTaskStatus(taskId);
```

## MCP Services

### McpService

Manages Model Context Protocol integration for tool access.

**Purpose:**
- MCP server connections
- Tool discovery and registration
- Tool execution coordination
- Resource management

**Usage:**
```typescript
import { McpService } from './src/server/socket/services/McpService';

const mcpService = McpService.getInstance();

// Initialize MCP connections
await mcpService.initialize();

// Get available tools
const tools = await mcpService.getAvailableTools();

// Execute tool
const result = await mcpService.executeTool({
    name: 'filesystem_read',
    arguments: { path: '/data/file.txt' }
});
```

### McpSocketExecutor

Executes MCP tools within the socket server context.

**Purpose:**
- Bridge MCP protocol and socket communication
- Execute tools on behalf of agents
- Handle tool results
- Support both internal and external tools

**Key Features:**
- **Unified Execution**: Single interface for all tools
- **Result Formatting**: Standardize tool results
- **Error Handling**: Graceful error handling
- **Context Injection**: Inject agent/channel context

**Tool Handler Format:**
```typescript
// Modern MCP Format (Recommended)
{
    handler: async (input, context): Promise<McpToolHandlerResult> => {
        const result = await performOperation(input);
        return {
            content: {
                type: 'application/json',
                data: result
            }
        };
    }
}
```

**Usage:**
```typescript
import { McpSocketExecutor } from './src/server/socket/services/McpSocketExecutor';

const executor = McpSocketExecutor.getInstance();

// Register tool
executor.registerTool({
    name: 'custom_tool',
    description: 'Custom tool for specific operation',
    schema: { ... },
    handler: async (input, context) => {
        // Tool implementation
        return {
            content: {
                type: 'application/json',
                data: { success: true, result: 'Done' }
            }
        };
    }
});

// Execute tool
const result = await executor.executeTool('custom_tool', {
    param: 'value'
}, {
    agentId: 'agent-1',
    channelId: 'channel-1'
});
```

### HybridMcpToolRegistry

Combines internal MXF tools with tools from external MCP servers into one registry.

**Purpose:**
- Single tool list per channel (global tools + that channel's server tools)
- Name resolution between the agent-facing and canonical forms of an external tool
- Routing execution to the origin MCP server

**Tool naming:**

External tools are stored under a canonical namespaced name, `<serverId>__<toolName>` (for a channel server the registry's server id is `<channelId>:<serverId>`). Agents see and call them by the raw name the origin server reports, because that is the only name clients ever receive and because LLM providers reject `:` in function names.

```typescript
// Agent-facing view: internal tools as-is, external tools under their raw name
// with `canonicalName` carrying the namespaced registry name
const tools = hybridRegistry.getAgentFacingToolsForChannel('channel-1');

// Resolve either form (raw or canonical) to the canonical registry entry
const tool = hybridRegistry.resolveToolForChannel('chess_move', 'channel-1');
```

`McpService` builds agent tool lists with `getAgentFacingToolsForChannel()`, and `McpSocketExecutor` authorizes and executes through `resolveToolForChannel()`, so allowlists work with either name.

**Collisions:**
- External raw name matching an internal tool: the internal tool wins, the external one is not exposed, and the registry logs an error.
- Same raw name from two external servers in one channel: the lexicographically first server id wins, the other is skipped, and the registry logs an error.

Tools entering or leaving the registry are logged per server — additions at info, removals at warn.

### ExternalMcpServerManager

Owns the lifecycle of external and channel-scoped MCP server processes (`packages/core/src/protocols/mcp/services/ExternalMcpServerManager.ts`).

**Purpose:**
- Spawn, handshake with, and monitor MCP server processes
- Discover their tools and keep the registry in step with their state
- Track channel scope: which agents are connected, and the keepAlive timer

**Key methods:**
```typescript
// Register a channel-scoped server (id becomes `${channelId}:${config.id}`)
await manager.registerChannelServer(channelId, config, registrationContext?);

// Remove a channel-scoped server, or any server by its full id
await manager.unregisterChannelServer(channelId, serverId);
await manager.unregisterServer(serverId);

// Start/restart resolve after the MCP handshake AND tool discovery
await manager.startServer(serverId);
await manager.restartServer(serverId);
```

The `CHANNEL_SERVER_REGISTER`, `CHANNEL_SERVER_UNREGISTER`, and `EXTERNAL_SERVER_UNREGISTER` EventBus handlers delegate to these methods.

**Lifecycle rules:**
- A resolved `startServer()`/`restartServer()` means the server's tools are in the registry. A rejection means they are not.
- An unexpected process exit is logged at error level and its tools are removed from the registry. Any exit that was not requested counts, including `exit 0`.
- With `restartOnCrash`, the server is restarted after `restartDelayMs` and its tools re-discovered, up to `maxRestartAttempts`. A completed startup resets the restart count.
- Exhausting the restart budget unregisters the server (record and scope removed) at error level, rather than leaving a record agents can attach to.
- Health checks probe `tools/list` on `healthCheckInterval`; two consecutive failures restart a `restartOnCrash` server.
- Agent join verifies each channel server: a missing record removes the orphaned scope entry with an error log, a stopped server is started, and a "running" server is probed and restarted if it does not answer.
- Unregistration is idempotent — it removes the record, the scope entry, and any keepAlive timer, and heals half-removed state instead of failing with "not found".

**Constructor options** (beyond `toolEventEmitter` / `skipServerEventHandlers`): `restartDelayMs` and `requestTimeoutsMs` override the restart delay and the per-method JSON-RPC reply timeouts, mainly for tests and tuning.

## Pattern Services

### EphemeralEventPatternService

Detects patterns in agent behavior and triggers ephemeral events for cross-agent coordination.

**Purpose:**
- Pattern detection in agent activities
- Ephemeral event generation
- Cross-agent coordination signals
- Intelligent event triggers

**Patterns Detected:**
- Repeated failures requiring intervention
- Collaborative opportunities
- Resource contention
- Communication bottlenecks
- Learning opportunities

**Usage:**
```typescript
import { EphemeralEventPatternService } from './src/server/socket/services/EphemeralEventPatternService';

const patternService = EphemeralEventPatternService.getInstance();

// Pattern detection happens automatically
// Service monitors agent activities and emits events

// Listen for pattern events
EventBus.server.on('ephemeral:pattern_detected', (event) => {
    console.log('Pattern detected:', event.pattern);
    console.log('Affected agents:', event.agents);
    console.log('Recommended action:', event.recommendation);
});
```

## Control Loop Services

### ControlLoopService

Manages ORPAR control loops for intelligent agent behavior.

**Purpose:**
- Initialize control loops per agent
- Handle control loop phases
- Process observations, reasoning, actions, planning, reflection
- Coordinate with SystemLLM

**ORPAR Phases:**
1. **Observation**: Gather environmental context
2. **Reasoning**: Analyze with LLM
3. **Action**: Execute planned actions
4. **Planning**: Create action plans
5. **Reflection**: Learn from outcomes

**Usage:**
```typescript
import { ControlLoopService } from './src/server/socket/services/ControlLoopService';

const controlLoopService = new ControlLoopService();

// Initialize control loop
await controlLoopService.initialize({
    agentId: 'agent-1',
    channelId: 'channel-1'
});

// Start control loop
await controlLoopService.startControlLoop('agent-1');

// Process observation
await controlLoopService.processObservation({
    agentId: 'agent-1',
    observation: { type: 'message', data: {...} }
});

// Control loop automatically proceeds through phases
```

## Service Integration Patterns

Services work together to provide comprehensive functionality:

```typescript
// Example: Task execution with multiple services

// 1. TaskService creates task
const task = await taskService.createTask({...});

// 2. SystemLLM assigns task to best agent
const assignment = await systemLlmService.assignTask({
    task,
    availableAgents: [...],
    channelContext: {...}
});

// 3. AgentService notifies assigned agent
await agentService.notifyAgent(assignment.selectedAgent, {
    type: 'task_assigned',
    task: task
});

// 4. ControlLoopService coordinates agent execution
await controlLoopService.processObservation({
    agentId: assignment.selectedAgent,
    observation: { type: 'task', data: task }
});

// 5. McpSocketExecutor executes tools as needed
const toolResults = await mcpSocketExecutor.executeTool(...);

// 6. TaskCompletionMonitoringService detects completion
// (automatically triggered when agent calls task_complete)

// 7. ServerReflectionService processes learnings
await reflectionService.processReflection({
    agentId: assignment.selectedAgent,
    action: 'task_completion',
    outcome: { success: true }
});

// 8. ChannelService broadcasts task completion
await channelService.broadcastToChannel(task.channelId, {
    type: 'task_completed',
    taskId: task.id
});
```

## Service Lifecycle

All services follow consistent lifecycle patterns:

### Singleton Pattern
```typescript
class MyService {
    private static instance: MyService;
    
    public static getInstance(): MyService {
        if (!MyService.instance) {
            MyService.instance = new MyService();
        }
        return MyService.instance;
    }
    
    private constructor() {
        // Initialization
    }
}
```

### Initialization
```typescript
// Initialize service
await service.initialize(config);

// Start service operations
await service.start();

// Use service
await service.performOperation();

// Stop service
await service.stop();

// Cleanup
await service.cleanup();
```

## Error Handling

All services implement robust error handling:

```typescript
try {
    const result = await service.performOperation();
} catch (error) {
    if (error instanceof ValidationError) {
        // Handle validation errors
    } else if (error instanceof ServiceUnavailableError) {
        // Handle service unavailability
    } else {
        // Handle unexpected errors
    }
    
    // Log error
    logger.error('Operation failed', { error, context });
    
    // Emit error event
    EventBus.server.emit('service:error', {
        service: 'MyService',
        operation: 'performOperation',
        error: error.message
    });
}
```

## Performance Considerations

### Caching
Services implement caching where appropriate:
- Tool metadata cached after discovery
- Agent session data cached for quick access
- Channel membership cached for broadcasting

### Resource Management
- Connection pooling for database operations
- LLM request queuing to avoid rate limits
- Event batching for high-volume operations

### Monitoring
All services emit performance metrics:
```typescript
EventBus.server.emit('service:metrics', {
    service: 'TaskService',
    operation: 'createTask',
    duration: 150,
    success: true
});
```

## Best Practices

### Service Development

1. **Singleton Pattern**: Use for services that should have single instance
2. **Validation**: Always validate inputs with `createStrictValidator`
3. **Error Handling**: Implement comprehensive error handling
4. **Event Emission**: Emit events for important operations
5. **Logging**: Use structured logging with context

### Integration

1. **Dependency Injection**: Pass dependencies via constructor
2. **Service Discovery**: Use getInstance() for singletons
3. **Event-Driven**: Prefer events over direct coupling
4. **Async Operations**: Use async/await consistently
5. **Type Safety**: Leverage TypeScript types

### Testing

1. **Unit Tests**: Test service logic in isolation
2. **Integration Tests**: Test service interactions
3. **Mocking**: Mock external dependencies
4. **Error Cases**: Test error handling paths
5. **Performance**: Test under load

## Related Documentation

- [Architecture Overview](./index.md) - Overall system architecture
- [Event System](../sdk/events.md) - Event-driven patterns and SDK events
- [API Reference](../api/index.md) - REST and WebSocket APIs
- [SDK Documentation](../sdk/index.md) - Client-side SDK
- [Validation System](./validation-system.md) - Validation services

---

For source code reference, see `/src/server/socket/services/` directory.
