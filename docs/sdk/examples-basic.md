# MXF SDK Code Examples

Comprehensive examples demonstrating the MXF SDK using modern patterns. All examples are tested and ready to run.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Basic Setup](#basic-setup)
- [Single Agent Examples](#single-agent-examples)
- [Multi-Agent Coordination](#multi-agent-coordination)
- [Event Handling](#event-handling)
- [Memory Operations](#memory-operations)
- [Task Management](#task-management)
- [Complete Working Examples](#complete-working-examples)

## Prerequisites

Before running examples, ensure you have:

1. **MXF Server running** on `http://localhost:3001`
2. **Domain key** from server operator
3. **User account** created
4. **Channel and agent keys** generated via SDK CLI

```bash
# Generate credentials using SDK CLI
bun run sdk:cli -- channel:create \
  --id example-channel \
  --name "Example Channel" \
  --email your@email.com \
  --password your-password

bun run sdk:cli -- key:generate \
  --channel example-channel \
  --agents agent1,agent2,agent3 \
  --email your@email.com \
  --password your-password \
  --output credentials.json
```

### Environment Setup

Create `.env` file:

```env
# Domain key (from server operator)
MXF_DOMAIN_KEY=your-64-char-domain-key

# User credentials
MXF_USERNAME=your-username
MXF_PASSWORD=your-password

# LLM API key
OPENROUTER_API_KEY=your-openrouter-key
```

## Basic Setup

### Minimal Agent Setup

```typescript
import { MxfSDK, Events } from '@mxf/sdk';
import type { MxfAgent } from '@mxf/sdk';
import * as fs from 'fs';

// Load credentials from SDK CLI output
const credentials = JSON.parse(
    fs.readFileSync('./credentials.json', 'utf-8')
);

// Initialize SDK with domain key and user auth
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();
console.log('✓ SDK connected');

// Create agent
const agent = await sdk.createAgent({
    agentId: 'agent1',
    name: 'My First Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await agent.connect();
console.log('✓ Agent connected');
```

## Single Agent Examples

### Example 1: LLM-Powered Assistant

```typescript
import { MxfSDK, Events } from '@mxf/sdk';
import credentials from './credentials.json';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create LLM-powered agent with custom configuration
const assistant = await sdk.createAgent({
    agentId: 'assistant',
    name: 'AI Assistant',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    
    // LLM Configuration
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    temperature: 0.7,
    maxTokens: 100000,
    
    // Agent Identity
    agentConfigPrompt: `You are a helpful AI assistant in the MXF framework.
    You can help users understand and use the framework effectively.
    Be concise, accurate, and friendly.`,
    description: 'Helpful AI assistant',
    capabilities: ['conversation', 'analysis', 'tool-use']
});

await assistant.connect();

// Listen for messages
assistant.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log(`Message from ${payload.data.senderId}:`);
    console.log(payload.data.content);
});

// Send a message
await assistant.channelService.sendMessage('Hello! I am ready to help.');
```

### Example 2: Restricted Agent (Principle of Least Privilege)

```typescript
// Create agent with limited tool access
const restrictedAgent = await sdk.createAgent({
    agentId: 'restricted-agent',
    name: 'Customer Service Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent2.keyId,
    secretKey: credentials.keys.agent2.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    
    // Restrict to specific tools only
    allowedTools: [
        'messaging_send',        // Send messages
        'messaging_coordinate',  // Coordinate with others
        'tools_recommend',       // Discover tools
        'channel_context_get',   // Access context
        'task_complete'          // Complete tasks
    ],
    
    agentConfigPrompt: `You are a customer service agent.
    You can communicate with customers and coordinate with other agents,
    but you cannot access files or perform administrative tasks.`
});

await restrictedAgent.connect();
```


### Example 3: Agent with Error Handling

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

const agent = await sdk.createAgent({
    agentId: 'resilient-agent',
    name: 'Resilient Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

// Error handling
agent.on(Events.Agent.ERROR, (payload) => {
    console.error('Agent error:', payload.data.error);
    console.error('Error type:', payload.data.type);
});

// Disconnection handling with reconnection
agent.on(Events.Agent.DISCONNECTED, async (payload) => {
    console.warn('Agent disconnected, attempting reconnection...');
    
    setTimeout(async () => {
        try {
            await agent.connect();
            console.log('✓ Agent reconnected successfully');
        } catch (error) {
            console.error('✗ Reconnection failed:', error);
        }
    }, 5000);
});

// Connection success
agent.on(Events.Agent.CONNECTED, (payload) => {
    console.log('✓ Agent connected');
});

await agent.connect();
```

### Example 4: Multiple Agents from Single SDK

```typescript
import { MxfSDK } from '@mxf/sdk';
import credentials from './credentials.json';

// Initialize SDK once
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create multiple agents from same SDK instance
const coordinator = await sdk.createAgent({
    agentId: 'coordinator',
    name: 'Team Coordinator',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: 'You coordinate tasks between team members.'
});

const analyst = await sdk.createAgent({
    agentId: 'analyst',
    name: 'Data Analyst',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent2.keyId,
    secretKey: credentials.keys.agent2.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: 'You analyze data and provide insights.',
    allowedTools: ['filesystem_read', 'memory_store', 'memory_retrieve']
});

const executor = await sdk.createAgent({
    agentId: 'executor',
    name: 'Task Executor',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent3.keyId,
    secretKey: credentials.keys.agent3.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: 'You execute tasks assigned to you.',
    allowedTools: ['task_complete', 'messaging_send']
});

// Connect all agents
await Promise.all([
    coordinator.connect(),
    analyst.connect(),
    executor.connect()
]);

console.log('✓ All agents connected');
```

## See Also

- [Multi-Agent Coordination Examples](examples-multi-agent.md)
- [Event Handling Examples](examples-events.md)
- [Memory Operations Examples](examples-memory.md)
- [Task Management Examples](examples-tasks.md)
- [Complete Working Examples](examples-complete.md)
- [SDK Overview](index.md)
- [Authentication Guide](authentication.md)
