# Event System Documentation

The MXF SDK uses a comprehensive event-driven architecture for real-time bidirectional communication between agents and the server.

## Overview

The event system provides:
- **Two listening modes**: Agent-level (multi-channel) and Channel-level (auto-filtered)
- **Public events whitelist**: Only safe, SDK-appropriate events are exposed
- **Type-safe event handling**: Using the `Events` enum for all event names
- Real-time message passing between agents
- Asynchronous task notifications
- Memory synchronization across agents
- Control loop phase tracking
- Tool execution monitoring

## Import Events

```typescript
import { MxfSDK, Events } from '@mxf/sdk';
import type { MxfAgent } from '@mxf/sdk';
```

## Event Listening Patterns

### Agent-Level Events (Multi-Channel)

Listen to events across all channels the agent participates in:

```typescript
agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log('Channel:', payload.channelId);
    console.log('From:', payload.data.senderId);
});
```

### Channel-Level Events (Auto-Filtered)

Listen only within the agent's specific channel:

```typescript
agent.channelService.on(Events.Message.AGENT_MESSAGE, (payload) => {
    // payload.channelId is always this agent's channel
    console.log('Message in my channel:', payload.data.content);
});

// Remove listener
agent.channelService.off(Events.Message.AGENT_MESSAGE);
```

### Channel Monitoring (Observer Pattern)

Monitor ALL events from ALL agents in a channel without creating an agent:

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

// Initialize SDK
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create a channel monitor (no agent needed)
const monitor = sdk.createChannelMonitor('my-channel');

// Listen to all messages in the channel
monitor.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log(`Message from ${payload.agentId}:`, payload.data);
});

// Listen to task events
monitor.on(Events.Task.CREATED, (payload) => {
    console.log('New task:', payload.data.title);
});

monitor.on(Events.Task.COMPLETED, (payload) => {
    console.log('Task completed:', payload.data.taskId);
});
```

**Use Cases for Channel Monitoring:**
- Dashboard applications observing channel activity
- Orchestrators coordinating multiple agents
- Analytics and logging systems
- Debugging and development tools

## Core Event Categories

### Agent Lifecycle Events

Events related to agent status and lifecycle:

```typescript
import { Events } from '@mxf/sdk';

// Agent connected
agent.on(Events.Agent.CONNECTED, (payload) => {
    console.log('✓ Agent connected');
});

// Agent disconnected
agent.on(Events.Agent.DISCONNECTED, (payload) => {
    console.log('⚠ Agent disconnected');
    // Implement reconnection logic
});

// Agent registered
agent.on(Events.Agent.REGISTERED, (payload) => {
    console.log('Agent registered:', payload.data.agentId);
});

// Agent errors
agent.on(Events.Agent.ERROR, (payload) => {
    console.error('Agent error:', payload.data.error);
    console.error('Error type:', payload.data.type);
});

// Channel operations
agent.on(Events.Agent.JOIN_CHANNEL, (payload) => {
    console.log('Joined channel:', payload.data.channelId);
});

agent.on(Events.Agent.LEAVE_CHANNEL, (payload) => {
    console.log('Left channel:', payload.data.channelId);
});
```

### Message Events

Events for agent and channel messaging:

```typescript
import { Events } from '@mxf/sdk';

// Agent-to-agent messages
agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log('From:', payload.data.senderId);
    console.log('Content:', payload.data.content);
    console.log('Channel:', payload.channelId);
});

// Channel-wide messages
agent.on(Events.Message.CHANNEL_MESSAGE, (payload) => {
    console.log('Channel message:', payload.data.content);
});

// Message delivery confirmation
agent.on(Events.Message.AGENT_MESSAGE_DELIVERED, (payload) => {
    console.log('Message delivered:', payload.data.messageId);
});

agent.on(Events.Message.CHANNEL_MESSAGE_DELIVERED, (payload) => {
    console.log('Channel message delivered:', payload.data.messageId);
});

// Message failures
agent.on(Events.Message.MESSAGE_SEND_FAILED, (payload) => {
    console.error('Message send failed:', payload.data.error);
});
```

### Task Events

Task lifecycle and progress tracking:

```typescript
import { Events } from '@mxf/sdk';

// Task created
agent.on(Events.Task.CREATED, (payload) => {
    console.log('Task created:', payload.data.taskId);
});

// Task assigned
agent.on(Events.Task.ASSIGNED, (payload) => {
    console.log('Task assigned:', payload.data.taskId);
    console.log('Assigned to:', payload.data.assignedTo);
    // Process the task
});

// Task progress updates
agent.on(Events.Task.PROGRESS_UPDATED, (payload) => {
    console.log(`Task ${payload.data.taskId}: ${payload.data.progress}%`);
});

// Task completion
agent.on(Events.Task.COMPLETED, (payload) => {
    console.log('Task completed:', payload.data.taskId);
    console.log('Result:', payload.data.result);
});

// Task failure
agent.on(Events.Task.FAILED, (payload) => {
    console.error('Task failed:', payload.data.taskId);
    console.error('Error:', payload.data.error);
});
```

### Memory Events

Memory CRUD operations across different scopes:

```typescript
import { Events } from '@mxf/sdk';

// Memory created
agent.on(Events.Memory.CREATE_RESULT, (payload) => {
    console.log('Memory created:', payload.data);
});

// Memory updated
agent.on(Events.Memory.UPDATE_RESULT, (payload) => {
    console.log('Memory updated:', payload.data.key);
    console.log('Scope:', payload.data.scope);
});

// Memory retrieved
agent.on(Events.Memory.GET_RESULT, (payload) => {
    console.log('Memory retrieved:', payload.data);
});

// Memory deleted
agent.on(Events.Memory.DELETE_RESULT, (payload) => {
    console.log('Memory deleted:', payload.data.key);
});
```

### Control Loop Events (ORPAR)

ORPAR cognitive cycle events:

```typescript
import { Events } from '@mxf/sdk';

// Observation phase
agent.on(Events.ControlLoop.OBSERVATION, (payload) => {
    console.log('Observation:', payload.data);
});

// Reasoning phase
agent.on(Events.ControlLoop.REASONING, (payload) => {
    console.log('Reasoning:', payload.data);
});

// Planning phase
agent.on(Events.ControlLoop.PLAN, (payload) => {
    console.log('Plan:', payload.data);
});

// Action phase
agent.on(Events.ControlLoop.ACTION, (payload) => {
    console.log('Action:', payload.data);
});

// Reflection phase
agent.on(Events.ControlLoop.REFLECTION, (payload) => {
    console.log('Reflection:', payload.data);
});
```

### MCP Tool Events

Model Context Protocol tool execution:

```typescript
import { Events } from '@mxf/sdk';

// Tool called
agent.on(Events.Mcp.TOOL_CALL, (payload) => {
    console.log('Tool called:', payload.data.toolName);
    console.log('Arguments:', payload.data.arguments);
});

// Tool result
agent.on(Events.Mcp.TOOL_RESULT, (payload) => {
    console.log('Tool result:', payload.data.result);
});

// Tool error
agent.on(Events.Mcp.TOOL_ERROR, (payload) => {
    console.error('Tool error:', payload.data.error);
});

// Tool registered
agent.on(Events.Mcp.TOOL_REGISTERED, (payload) => {
    console.log('New tool available:', payload.data.toolName);
});
```

### Channel Events

Channel management and participation:

```typescript
import { Events } from '@mxf/sdk';

// Agent joined channel
agent.on(Events.Channel.AGENT_JOINED, (payload) => {
    console.log('Agent joined:', payload.data.agentId);
    console.log('Channel:', payload.data.channelId);
});

// Agent left channel
agent.on(Events.Channel.AGENT_LEFT, (payload) => {
    console.log('Agent left:', payload.data.agentId);
});

// Channel created
agent.on(Events.Channel.CREATED, (payload) => {
    console.log('Channel created:', payload.data.channelId);
});

// Channel updated
agent.on(Events.Channel.UPDATED, (payload) => {
    console.log('Channel updated:', payload.data.channelId);
});
```

## Complete Event Reference

All available events organized by category:

### Message Events
- `Events.Message.CHANNEL_MESSAGE`
- `Events.Message.AGENT_MESSAGE`
- `Events.Message.CHANNEL_MESSAGE_DELIVERED`
- `Events.Message.AGENT_MESSAGE_DELIVERED`
- `Events.Message.MESSAGE_SEND_FAILED`

### Task Events
- `Events.Task.CREATED`
- `Events.Task.ASSIGNED`
- `Events.Task.COMPLETED`
- `Events.Task.FAILED`
- `Events.Task.PROGRESS_UPDATED`

### Memory Events
- `Events.Memory.CREATE_RESULT`
- `Events.Memory.UPDATE_RESULT`
- `Events.Memory.GET_RESULT`
- `Events.Memory.DELETE_RESULT`

### MCP/Tool Events
- `Events.Mcp.TOOL_CALL`
- `Events.Mcp.TOOL_RESULT`
- `Events.Mcp.TOOL_ERROR`
- `Events.Mcp.TOOL_REGISTERED`

### Control Loop Events
- `Events.ControlLoop.OBSERVATION`
- `Events.ControlLoop.REASONING`
- `Events.ControlLoop.PLAN`
- `Events.ControlLoop.ACTION`
- `Events.ControlLoop.REFLECTION`

### Agent Events
- `Events.Agent.CONNECTED`
- `Events.Agent.DISCONNECTED`
- `Events.Agent.REGISTERED`
- `Events.Agent.ERROR`
- `Events.Agent.JOIN_CHANNEL`
- `Events.Agent.LEAVE_CHANNEL`

### Channel Events
- `Events.Channel.AGENT_JOINED`
- `Events.Channel.AGENT_LEFT`
- `Events.Channel.CREATED`
- `Events.Channel.UPDATED`

## See Also

- [SDK Overview](index.md)
- [Event Handling Examples](examples-events.md)
- [Basic Examples](examples-basic.md)
- [Multi-Agent Examples](examples-multi-agent.md)
