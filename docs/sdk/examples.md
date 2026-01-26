# SDK Examples Overview

This guide provides a comprehensive overview of all SDK example documentation, organized by topic. Use this page to navigate to specific examples based on your implementation needs.

## Quick Start

If you're new to MXF, start with the [Basic Examples](./examples-basic.md) to understand core concepts.

---

## Example Categories

### Getting Started

| Guide | Description |
|-------|-------------|
| [Basic Examples](./examples-basic.md) | Essential agent creation, connection, and simple interactions |
| [Complete Examples](./examples-complete.md) | Full working examples with all components |

### Core Functionality

| Guide | Description |
|-------|-------------|
| [Task Examples](./examples-tasks.md) | Creating tasks, monitoring progress, handling completion |
| [Events Examples](./examples-events.md) | Event handling, subscriptions, and custom events |
| [Memory Examples](./examples-memory.md) | Agent memory, channel context, and state persistence |

### Advanced Patterns

| Guide | Description |
|-------|-------------|
| [Multi-Agent Examples](./examples-multi-agent.md) | Agent coordination, collaboration, and communication |
| [Code Execution Examples](./examples-code-execution.md) | Secure code execution with Docker isolation |

---

## Prompt Templates

For agent configuration and system prompt examples, see:

| Guide | Description |
|-------|-------------|
| [System Prompt Example](./system-prompt-example.md) | Basic system prompt template |
| [Standard System Prompt](./system-prompt-example-standard.md) | Production-ready system prompt |
| [MXP System Prompt](./system-prompt-example-mxp.md) | System prompt with MXP protocol support |
| [Agent Config Prompt](./agent-config-prompt-example.md) | Agent configuration prompt examples |
| [Task Prompt Example](./task-prompt-example.md) | Task assignment prompt patterns |
| [Conversation Prompt](./conversation-prompt-example.md) | Conversation handling prompts |

---

## Example Projects

For complete working projects, see the [Example Projects](../examples/first-contact.md) section:

- [First Contact Demo](../examples/first-contact.md) - Multi-agent first contact scenario
- [Interview Scheduling](../examples/interview-scheduling.md) - HR automation use case
- [Fog of War Game](../examples/fog-of-war.md) - Strategy game with 8 AI commanders
- [Tic-Tac-Toe AI](../examples/tic-tac-toe.md) - AI vs AI gameplay
- [Go Fish AI](../examples/go-fish.md) - Card game with memory and strategy
- [Code Execution Demo](../examples/code-execution.md) - Secure code execution with Docker + Bun

---

## Code Examples by Feature

### Agent Lifecycle

```typescript
import { MxfSDK } from '@mxf/sdk';

// Initialize SDK with domain key
const sdk = new MxfSDK({
    domainKey: 'your-domain-key',
    host: 'localhost',
    port: 3001,
    secure: false
});

// Create an agent
const agent = await sdk.createAgent({
    agentId: 'example-agent',
    name: 'Example Agent',
    channelId: 'main-channel',
    keyId: 'agent-key-id',
    secretKey: 'agent-secret',
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    agentConfigPrompt: 'You are a helpful assistant.',
    enableTooling: true
});

// Connect and start
await agent.connect();
```

### Event Handling

```typescript
import { Events } from '@mxf/sdk';

// Listen for messages
agent.on(Events.MESSAGE_RECEIVED, (message) => {
    console.log(`Message from ${message.senderId}: ${message.content}`);
});

// Listen for task assignments
agent.on(Events.TASK_ASSIGNED, (task) => {
    console.log(`Assigned task: ${task.taskId}`);
});
```

### Tool Execution

```typescript
// Execute a tool
const result = await agent.executeTool('messaging_send', {
    targetId: 'other-agent',
    content: 'Hello from Example Agent!'
});
```

---

## Learning Path

1. **Start**: [Basic Examples](./examples-basic.md)
2. **Tasks**: [Task Examples](./examples-tasks.md)
3. **Events**: [Events Examples](./examples-events.md)
4. **Memory**: [Memory Examples](./examples-memory.md)
5. **Multi-Agent**: [Multi-Agent Examples](./examples-multi-agent.md)
6. **Advanced**: [Complete Examples](./examples-complete.md)

---

## Related Documentation

- [SDK Overview](./index.md) - SDK architecture and core concepts
- [Interfaces](./interfaces.md) - TypeScript interfaces and types
- [Handlers](./handlers.md) - Event and message handlers
- [Managers](./managers.md) - MCP, Memory, and Task managers
