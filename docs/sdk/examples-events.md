# Event Handling Examples

Examples demonstrating MXF's event system, including agent-level and channel-level event handling.

## Prerequisites

See [Basic Examples](examples-basic.md#prerequisites) for setup instructions.

## Event System Overview

MXF provides two ways to listen to events:

1. **Agent-Level Events** (`agent.on`) - Listen across all channels the agent participates in
2. **Channel-Level Events** (`channelService.on`) - Listen only within the agent's channel (auto-filtered)

## Example 1: Basic Event Listening

```typescript
import { MxfSDK, Events } from '@mxf/sdk';
import credentials from './credentials.json';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_ACCESS_TOKEN!
});

await sdk.connect();

const agent = await sdk.createAgent({
    agentId: 'event-listener',
    name: 'Event Listener Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await agent.connect();

// Message events
agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log('Message from:', payload.data.senderId);
    console.log('Content:', payload.data.content);
});

// Task events
agent.on(Events.Task.ASSIGNED, (payload) => {
    console.log('Task assigned:', payload.data.taskId);
});

agent.on(Events.Task.COMPLETED, (payload) => {
    console.log('Task completed:', payload.data.taskId);
});

// Agent lifecycle events
agent.on(Events.Agent.CONNECTED, (payload) => {
    console.log('✓ Agent connected');
});

agent.on(Events.Agent.DISCONNECTED, (payload) => {
    console.log('⚠ Agent disconnected');
});

agent.on(Events.Agent.ERROR, (payload) => {
    console.error('✗ Agent error:', payload.data.error);
});
```

## Example 2: Channel-Level Event Filtering

```typescript
// Channel-level events are automatically filtered to this channel
agent.channelService.on(Events.Message.AGENT_MESSAGE, (payload) => {
    // payload.channelId will always be this agent's channel
    console.log('Message in my channel:', payload.data.content);
});

agent.channelService.on(Events.Task.ASSIGNED, (payload) => {
    console.log('Task in my channel:', payload.data.taskId);
});

// Remove listener when done
agent.channelService.off(Events.Message.AGENT_MESSAGE);
```

## Example 3: Tool Execution Events

```typescript
// Listen to tool calls and results
agent.on(Events.Mcp.TOOL_CALL, (payload) => {
    console.log('Tool called:', payload.data.toolName);
    console.log('Arguments:', payload.data.arguments);
});

agent.on(Events.Mcp.TOOL_RESULT, (payload) => {
    console.log('Tool result:', payload.data.result);
});

agent.on(Events.Mcp.TOOL_ERROR, (payload) => {
    console.error('Tool error:', payload.data.error);
});
```

## Example 4: Memory Events

```typescript
// Listen to memory operations
agent.on(Events.Memory.CREATE_RESULT, (payload) => {
    console.log('Memory created:', payload.data);
});

agent.on(Events.Memory.UPDATE_RESULT, (payload) => {
    console.log('Memory updated:', payload.data);
});

agent.on(Events.Memory.GET_RESULT, (payload) => {
    console.log('Memory retrieved:', payload.data);
});

agent.on(Events.Memory.DELETE_RESULT, (payload) => {
    console.log('Memory deleted:', payload.data);
});
```

## Example 5: Control Loop Events (ORPAR)

```typescript
// Listen to agent cognitive cycle phases
agent.on(Events.ControlLoop.OBSERVATION, (payload) => {
    console.log('Observation phase:', payload.data);
});

agent.on(Events.ControlLoop.REASONING, (payload) => {
    console.log('Reasoning phase:', payload.data);
});

agent.on(Events.ControlLoop.PLAN, (payload) => {
    console.log('Planning phase:', payload.data);
});

agent.on(Events.ControlLoop.ACTION, (payload) => {
    console.log('Action phase:', payload.data);
});

agent.on(Events.ControlLoop.REFLECTION, (payload) => {
    console.log('Reflection phase:', payload.data);
});
```

## Example 6: Channel Events

```typescript
// Monitor channel membership changes
agent.on(Events.Channel.AGENT_JOINED, (payload) => {
    console.log('Agent joined channel:', payload.data.agentId);
});

agent.on(Events.Channel.AGENT_LEFT, (payload) => {
    console.log('Agent left channel:', payload.data.agentId);
});

agent.on(Events.Channel.CREATED, (payload) => {
    console.log('Channel created:', payload.data.channelId);
});

agent.on(Events.Channel.UPDATED, (payload) => {
    console.log('Channel updated:', payload.data.channelId);
});
```

## Example 7: Comprehensive Event Handler

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

class EventMonitor {
    private agent: MxfAgent;
    private eventCounts: Map<string, number> = new Map();

    constructor(agent: MxfAgent) {
        this.agent = agent;
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Track all message events
        this.agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
            this.incrementCount('messages');
            console.log(`[${new Date().toISOString()}] Message:`, payload.data.content);
        });

        // Track all task events
        this.agent.on(Events.Task.ASSIGNED, (payload) => {
            this.incrementCount('tasks_assigned');
        });

        this.agent.on(Events.Task.COMPLETED, (payload) => {
            this.incrementCount('tasks_completed');
        });

        // Track tool usage
        this.agent.on(Events.Mcp.TOOL_CALL, (payload) => {
            this.incrementCount('tool_calls');
            this.incrementCount(`tool_${payload.data.toolName}`);
        });

        // Track errors
        this.agent.on(Events.Agent.ERROR, (payload) => {
            this.incrementCount('errors');
            console.error('Error:', payload.data.error);
        });
    }

    private incrementCount(event: string): void {
        const current = this.eventCounts.get(event) || 0;
        this.eventCounts.set(event, current + 1);
    }

    public getStatistics(): Record<string, number> {
        return Object.fromEntries(this.eventCounts);
    }

    public printStatistics(): void {
        console.log('\n=== Event Statistics ===');
        this.eventCounts.forEach((count, event) => {
            console.log(`${event}: ${count}`);
        });
    }
}

// Usage
const monitor = new EventMonitor(agent);

// Run for a while...
setTimeout(() => {
    monitor.printStatistics();
}, 60000);
```

## See Also

- [Basic Examples](examples-basic.md)
- [Multi-Agent Examples](examples-multi-agent.md)
- [Memory Operations Examples](examples-memory.md)
- [Task Management Examples](examples-tasks.md)
- [Event System Documentation](events.md)
