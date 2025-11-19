# Model Exchange Framework (MXF)

Author: [Brad Anderson](brada1878@gmail.com)
Copyright 2024 Brad Anderson

## 📜 License

This project is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)

# MXF SDK

The official TypeScript SDK for the Model Exchange Framework (MXF), enabling developers to create intelligent, collaborative AI agents with full LLM integration, tool execution, and real-time communication capabilities.

## 🌟 Features

### Core SDK Capabilities
- **Simple Agent Creation**: Create agents through `MxfSDK` with comprehensive configuration
- **Multiple LLM Providers**: Support for OpenRouter, OpenAI, Anthropic, Google AI, xAI, Azure OpenAI, and Ollama
- **Real-time Communication**: Socket.IO-based messaging between agents and channels
- **Tool Execution**: 75+ built-in tools plus external MCP server integration
- **Event System**: Comprehensive event listening and handling across all agent activities
- **Memory Management**: Agent-private and channel-shared memory operations
- **Task Orchestration**: Create, assign, and coordinate tasks across multiple agents
- **Control Loop Integration**: Full ORPAR (Observation, Reasoning, Planning, Action, Reflection) cycle support

### Authentication & Security
- **Dual Authentication**: User authentication (JWT) and agent authentication (key-based)
- **Channel Isolation**: Secure channel-based agent organization
- **Tool Access Control**: Principle of least privilege with `allowedTools` filtering
- **MXP Encryption**: Optional AES-256-GCM encryption for agent communications

## 📦 Installation

```bash
# The SDK is part of the MXF monorepo
npm install

# Build the framework
npm run build
```

**Note**: The SDK will be published as `@mxf/sdk` when separated from the monorepo.

## 🚀 Quick Start

### 1. Initialize the SDK

```typescript
import { MxfSDK } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();
```

### 2. Create an Agent

```typescript
const agent = await sdk.createAgent({
    agentId: 'my-agent',
    name: 'My First Agent',
    channelId: 'my-channel',
    keyId: 'key-abc123',
    secretKey: 'secret-xyz789',
    llmProvider: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    apiKey: process.env.ANTHROPIC_API_KEY,
    agentConfigPrompt: 'You are a helpful AI assistant.'
});

await agent.connect();
```

### 3. Listen to Events

```typescript
import { Events } from '@mxf/sdk';

agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log('Message:', payload.data.content);
});
```

### 4. Send Messages

```typescript
await agent.channelService.sendMessage('Hello from my agent!');
```

## 📚 Core Concepts

### SDK Entry Point

The `MxfSDK` class is the **only** entry point for all MXF functionality:

- ✅ **Use**: `sdk.createAgent()` - Always create agents through the SDK
- ❌ **Don't Use**: `new MxfAgent()` - Never instantiate agents directly

### Agent Lifecycle

1. **Initialize SDK** → Connect to server
2. **Create Agent** → Configure and initialize agent instance
3. **Connect Agent** → Establish WebSocket connection
4. **Use Agent** → Send messages, execute tools, listen to events
5. **Disconnect** → Clean shutdown when done

### Event Patterns

**Agent Events** (`agent.on()`):
- Listen to events specific to this agent's operations
- Examples: `AGENT_MESSAGE`, `TASK_COMPLETED`, `CONTROL_LOOP_UPDATE`

**Channel Monitoring** (`sdk.createChannelMonitor()`):
- Monitor ALL events from ALL agents in a channel
- Useful for orchestration, dashboards, and coordinators

## 🎯 Common Use Cases

### Basic Messaging Agent

```typescript
const agent = await sdk.createAgent({
    agentId: 'messenger',
    name: 'Messenger Agent',
    channelId: 'team-chat',
    keyId: credentials.keyId,
    secretKey: credentials.secretKey,
    llmProvider: 'openai',
    defaultModel: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY,
    allowedTools: ['messaging_send', 'messaging_coordinate']
});

await agent.connect();

// Listen for messages
agent.on(Events.Message.AGENT_MESSAGE, async (payload) => {
    console.log(`${payload.data.senderId}: ${payload.data.content}`);
    
    // Respond
    await agent.channelService.sendMessage(`Received your message!`);
});
```

### LLM-Powered Autonomous Agent

```typescript
const aiAgent = await sdk.createAgent({
    agentId: 'ai-assistant',
    name: 'AI Assistant',
    channelId: 'support',
    keyId: credentials.keyId,
    secretKey: credentials.secretKey,
    llmProvider: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    apiKey: process.env.ANTHROPIC_API_KEY,
    agentConfigPrompt: `You are a helpful AI assistant. 
    You can help users with their questions using the available tools.
    Be concise, accurate, and friendly.`,
    description: 'Helpful AI assistant',
    capabilities: ['conversation', 'analysis', 'tool-use'],
    temperature: 0.7,
    maxTokens: 100000
});

await aiAgent.connect();

// Agent will automatically:
// - Respond to messages using LLM
// - Discover and use available tools
// - Maintain conversation history
```

### Task Coordination

```typescript
// Create a task for multiple agents
await agent.mxfService.createTask({
    title: 'Data Analysis Project',
    description: `Analyze the Q4 sales data and generate insights.
    Data Analyst: Process the CSV files and identify trends.
    Report Writer: Create a summary report based on the analysis.`,
    assignmentScope: 'multiple',
    assignedAgentIds: ['data-analyst', 'report-writer'],
    priority: 'high',
    metadata: {
        deadline: '2025-12-31',
        department: 'sales'
    }
});

// Monitor task completion
agent.on(Events.Task.COMPLETED, (payload) => {
    console.log('Task completed:', payload.data.taskId);
    console.log('Result:', payload.data.result);
});
```

### Memory Operations

```typescript
// Store agent-private memory
await agent.channelService.updateMemory('agent', 'preferences', {
    theme: 'dark',
    language: 'en',
    notifications: true
});

// Store channel-shared memory
await agent.channelService.updateMemory('channel', 'project-context', {
    projectName: 'Q4 Sales Analysis',
    phase: 'data-collection',
    deadline: '2025-12-31'
});

// Retrieve memory
const preferences = await agent.channelService.getMemory('agent', 'preferences');
const context = await agent.channelService.getMemory('channel', 'project-context');
```

### Channel Monitoring

```typescript
// Create a monitor to observe all channel activity
const monitor = sdk.createChannelMonitor('my-channel');

// Listen to all messages from all agents
monitor.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log(`[${payload.agentId}] ${payload.data.content}`);
});

// Monitor task events
monitor.on(Events.Task.CREATED, (payload) => {
    console.log('New task:', payload.data.title);
});

monitor.on(Events.Task.COMPLETED, (payload) => {
    console.log('Task completed:', payload.data.taskId);
});
```

## 🔌 Supported LLM Providers

### OpenRouter
```typescript
llmProvider: 'openrouter',
defaultModel: 'anthropic/claude-3.5-sonnet',
apiKey: process.env.OPENROUTER_API_KEY
```

### Anthropic
```typescript
llmProvider: 'anthropic',
defaultModel: 'claude-3-5-sonnet-20241022',
apiKey: process.env.ANTHROPIC_API_KEY
```

### OpenAI
```typescript
llmProvider: 'openai',
defaultModel: 'gpt-4o',
apiKey: process.env.OPENAI_API_KEY
```

### Google AI (Gemini)
```typescript
llmProvider: 'gemini',
defaultModel: 'gemini-pro',
apiKey: process.env.GOOGLE_AI_API_KEY
```

### xAI (Grok)
```typescript
llmProvider: 'xai',
defaultModel: 'grok-beta',
apiKey: process.env.XAI_API_KEY
```

### Ollama (Local)
```typescript
llmProvider: 'ollama',
defaultModel: 'llama2',
baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
// No API key needed
```

### Azure OpenAI
```typescript
llmProvider: 'azure',
defaultModel: 'gpt-4',
apiKey: process.env.AZURE_OPENAI_API_KEY,
// Additional Azure configuration needed
```

## 🛠️ SDK CLI Tools

The SDK includes CLI tools for channel and key management.

### Interactive Setup (Recommended)

The easiest way to set up a new project:

```bash
npm run sdk:cli -- setup:interactive
```

This will prompt you for:
- Email and password (creates user account)
- Project/channel name
- Agent names

All credentials are automatically saved to `.env` file.

### Manual Commands

```bash
# Create a channel
npm run sdk:cli -- channel:create \
  --id my-channel \
  --name "My Channel" \
  --email user@example.com \
  --password your-password

# Generate agent keys (saved to .env)
npm run sdk:cli -- key:generate \
  --channel my-channel \
  --agents agent1,agent2,agent3 \
  --email user@example.com \
  --password your-password \
  --output .env
```

Credentials are saved to `.env` file in the format:
```env
MXF_MY_CHANNEL_AGENT1_KEY_ID="key-abc123"
MXF_MY_CHANNEL_AGENT1_SECRET_KEY="secret-xyz789"
```

See [SDK CLI Documentation](../../docs/sdk/cli.md) for complete details.

## 📖 Documentation

### Complete References
- **[Getting Started Guide](../../docs/getting-started.md)** - Quick start tutorial
- **[SDK Documentation](../../docs/sdk/index.md)** - Comprehensive SDK reference
- **[Event System](../../docs/sdk/events.md)** - Event types and patterns
- **[Managers](../../docs/sdk/managers.md)** - Memory, MCP, Task, and Prompt managers
- **[Handlers](../../docs/sdk/handlers.md)** - Control loop and tool handlers
- **[Code Examples](../../docs/sdk/examples-basic.md)** - Real-world examples

### Architecture
- **[Architecture Overview](../../docs/mxf/index.md)** - System architecture
- **[Interactive Diagram](../../docs/diagram/mxf-architecture.html)** - Visual exploration
- **[API Documentation](../../docs/api/index.md)** - REST and WebSocket APIs

## 🔒 Security Best Practices

1. **Domain Key**: Keep `MXF_DOMAIN_KEY` secure, never commit to version control
2. **User Credentials**: Use environment variables for username/password or JWT tokens
3. **Agent Keys**: Store keys in separate credentials file (e.g., `credentials.json`)
4. **Tool Access Control**: Use `allowedTools` array to restrict tool access based on agent role
5. **MXP Encryption**: Enable for sensitive communications in production

## ⚙️ Configuration Options

### Agent Creation Options

```typescript
interface AgentCreationConfig {
    // Required
    agentId: string;
    name: string;
    channelId: string;
    keyId: string;
    secretKey: string;
    llmProvider: LlmProviderType;
    defaultModel: string;
    
    // Optional: Agent Identity
    agentConfigPrompt?: string;
    description?: string;
    capabilities?: string[];
    
    // Optional: LLM Settings
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    reasoning?: { enabled: boolean };
    
    // Optional: Tool Access
    allowedTools?: string[];
    
    // Optional: MXP Settings
    mxpEnabled?: boolean;
    mxpPreferredFormat?: 'auto' | 'binary' | 'text';
    mxpForceEncryption?: boolean;
}
```

## 🐛 Troubleshooting

### Connection Issues

```bash
# Verify server is running
curl http://localhost:3001/api/health

# Check environment variables
echo $MXF_DOMAIN_KEY
echo $MXF_USERNAME
```

### Authentication Errors

```typescript
// Verify credentials
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!,
    logLevel: 'debug'  // Enable debug logging
});
```

### Agent Creation Errors

- Ensure channel exists before creating agents
- Verify agent keys are valid for the channel
- Check that LLM provider API key is set
- Verify `allowedTools` array contains valid tool names

## 📞 Support

- **Documentation**: [Full documentation](../../docs/index.html)
- **GitHub Issues**: [Report bugs](https://github.com/BradA1878/model-exchange-framework/issues)
- **Examples**: Check `/examples` directory for complete applications

## 📄 License

This project is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
