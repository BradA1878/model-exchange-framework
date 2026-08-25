# Model Exchange Framework (MXF)

Author: [Brad Anderson](brada1878@gmail.com)
Copyright 2024-2026 Brad Anderson

## 📜 License

This project is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)

# MXF SDK

The official TypeScript SDK for the Model Exchange Framework (MXF), enabling developers to create intelligent, collaborative AI agents with full LLM integration, tool execution, and real-time communication capabilities.

## 🌟 Features

### Core SDK Capabilities
- **Simple Agent Creation**: Create agents through `MxfSDK` with comprehensive configuration
- **Multiple LLM Providers**: Support for OpenRouter, OpenAI, Anthropic, Google AI, xAI, Azure OpenAI, and Ollama
- **Real-time Communication**: Socket.IO-based messaging between agents and channels
- **Tool Execution**: 100+ built-in tools plus external MCP server integration
- **Event System**: Comprehensive event listening and handling across all agent activities
- **Memory Management**: Agent-private and channel-shared memory operations
- **Task Orchestration**: Create, assign, and coordinate tasks across multiple agents
- **Control Loop Integration**: Full ORPAR (Observation, Reasoning, Planning, Action, Reflection) cycle support

### Advanced Features
- **ORPAR-Memory Integration**: Phase-aware memory coupling with surprise-driven re-observation
- **MULS**: Q-value weighted memory retrieval with retroactive reward propagation
- **Task DAG Tools**: Define complex task dependencies with automatic topological ordering
- **Knowledge Graph Tools**: Entity-relationship modeling with traversal queries
- **Code Execution**: Secure sandboxed code execution via agent tools
- **Memory Strata**: Episodic, semantic, and procedural memory layers

### Authentication & Security
- **Dual Authentication**: User authentication (JWT) and agent authentication (key-based)
- **Channel Isolation**: Secure channel-based agent organization
- **Tool Access Control**: Principle of least privilege with `allowedTools` filtering
- **MXP Encryption**: Optional AES-256-GCM encryption for agent communications

## 📦 Installation

```bash
bun add @mxf-dev/sdk
```

MXF server development uses Bun. The published SDK is ESM-only and supports Bun
>= 1.2 or Node.js >= 20.19 for client applications.

### New in 3.2

3.2 is a set of fixes for memory-load search indexing, plus the read-side
contract for a completed task. One SDK interface loses two methods (below).

- **Memory-load backfill can no longer fail `connect()`.** Persisted history is
  batched to the server's shared limits (`@mxf-dev/core/config/MeilisearchIngressLimits`:
  50 messages, 512 KiB of content, and 768 KiB on the wire per request; 64 KiB
  per message, larger messages are skipped). A backfill problem is reported on
  `Events.Agent.ERROR` with `data.phase === 'memory_backfill'`, as one local
  `BACKFILL_COMPLETE`/`BACKFILL_PARTIAL` summary, and in the error log. Before
  3.2 a dense history was refused on every connect and the agent never ran.
- **`memory_search_*` tools appear after every memory load.** The SDK reports
  its settled load to the server (`meilisearch:backfill:settled`) and reloads
  its tool list before building the system prompt. Since 3.0 those tools were
  missing for agents with no history and for agents without `allowedTools`.
- **Embedding and indexing failures are errors.** A document is indexed without
  a vector only when embeddings are off; a hybrid search whose query cannot be
  embedded fails instead of answering keyword-only.
- **`getTaskCompletionOutput(task)`** (with `isTaskCompletionOutput` and the
  `TaskCompletionOutput` type) reads the summary an agent's `task_complete`
  wrote to `task.result.output`. There is no `result.summary`; readers that
  used it have received `undefined` since 3.0.
- **`IToolService` gains `reloadTools()` and loses `setupPersistentToolListener()`
  and `onToolsUpdated()`.** The server push those two waited for was removed in
  3.0, so they never fired; code that calls them must be removed.

3.2.1 (server-side fixes, no SDK change): embedding input is cut to the
model's token limit before the request, so a message between the 64 KiB ingress
limit and the 8192-token ceiling gets a vector instead of an HTTP 400; and
`agent.on(Events.Mcp.TOOL_CALL)` now fires — the call was never forwarded to the
requesting agent before, so subscribers saw results and no calls.

### New in 3.1

3.1 adds the SystemLLM stance. Nothing changes for existing code; the defaults
keep 3.0 behavior.

- **`createChannel(id, { systemLlmStance })`** accepts `'supportive' | 'critical'
  | 'hostile'`; omit it to inherit the server's `SYSTEMLLM_STANCE`. The effective
  stance arrives in the channel config at join and is rendered into the agent's
  system prompt.
- **`task_complete` can return `status: "completion_challenged"`** in a critical
  or hostile channel, with a `challenge` listing disputed points. The task is
  still the agent's; it answers the points and calls `task_complete` again.
- **Challenge messages are answered.** A channel message from `system` with
  `context.messageType: "systemllm_challenge"` addressed to the agent is stored
  with `requiresResponse` and the agent takes a turn on it. Coordination hints
  are still stored as context only.

See the server's `docs/mxf/system-llm.md`, "Stance".

### Upgrading to 3.0

3.0 tightens the public contract. What changed for code written against 2.x:

- **Root import only.** Deep imports such as `@mxf-dev/sdk/services/MxfService`
  no longer resolve; every supported export comes from `@mxf-dev/sdk`.
- **`mxfService.sendMessage(content, options)`** no longer takes a `fromAgentId`
  argument. The sender is always the authenticated agent.
- **`generateKey()` requires `agentId`.** A key names the agent it authenticates;
  the server rejects a request without one.
- **`agent.setAgentConfigPrompt()` is async.** Await it.
- **MCP server management moved to the SDK level.** `registerMcpServer()` and the
  other process-management methods on `MxfClient`/`MxfAgent` throw
  `AgentMcpProcessManagementError`; use `MxfSDK.registerExternalMcpServer()` and
  channel creation options instead. Only the `stdio` transport is available
  through the SDK.
- **Memory reads fail loudly.** Memory accessors throw on failure instead of
  returning `null`, and `addToSharedConversationHistory()` returns the updated
  history array rather than the channel memory document.
- **`connect()` waits for authentication.** It stays pending while Socket.IO
  retries a boot race, and `reconnectionAttempts` defaults to unlimited. Set a
  finite value to get the old fail-fast behavior.
- **Reconnects are a public signal.** `sdk.onReconnected(listener)` fires after
  the socket manager restores and re-authenticates the user connection
  (`Events.Sdk.RECONNECTED` on the event bus). Code that reached into the private
  `socket` field to watch for `reconnect` can stop doing so.

## 🚀 Quick Start

### 1. Initialize the SDK

```typescript
import { MxfSDK } from '@mxf-dev/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();
```

`sdk.connect()` resolves only after the server authenticates the user session. By
default the administrative connection keeps retrying transient transport failures;
set `reconnectionAttempts` to a finite number when the caller needs bounded retry.
Authentication rejection and configured retry exhaustion reject the promise.

### 2. Create an Agent

```typescript
const agent = await sdk.createAgent({
    agentId: 'my-agent',
    name: 'My First Agent',
    channelId: 'my-channel',
    keyId: 'key-abc123',
    secretKey: 'secret-xyz789',
    llmProvider: 'anthropic',
    defaultModel: 'claude-opus-4.5',
    apiKey: process.env.ANTHROPIC_API_KEY,
    agentConfigPrompt: 'You are a helpful AI assistant.'
});

// connect() throws on failure — a bad key, a rejected registration, or a timeout.
// Do not test its return value; there isn't one.
await agent.connect();
```

### 3. Listen to Events

```typescript
import { Events } from '@mxf-dev/sdk';

// The handler is typed from the event name — `payload` is not `any`.
agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log('Message:', payload.data.content.data);
});
```

### 4. Send Messages

```typescript
await agent.mxfService.sendMessage('Hello from my agent!');
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

### Errors

The SDK fails fast. Operations that can fail **throw**; none of them report failure by
returning `false` or a `{ success: false }` object.

```typescript
try {
    await agent.connect();
} catch (error) {
    // Missing API key, bad channel key, registration timeout, socket refused…
    console.error('Agent failed to connect:', error.message);
    process.exit(1);
}
```

This applies to `connect()`, `registerTool()` / `unregisterTool()`, memory operations,
and acknowledged task lifecycle operations. MCP server process management is
administrative: call the four register/unregister methods on an
administrator-authenticated `MxfSDK`. Caller-supplied `stdio` registration also
requires the server operator to set `MXF_UNSAFE_STDIO_MCP_ENABLED=true`; it is disabled
by default because it starts a process on the MXF host. The deprecated
`MxfClient`/`MxfAgent` variants reject immediately with
`AgentMcpProcessManagementError` and never emit a process-management request.

### Event Patterns

**Agent Events** (`agent.on()`):
- Listen to events specific to this agent's operations
- Examples: `AGENT_MESSAGE`, `TASK_COMPLETED`, `CONTROL_LOOP_UPDATE`
- Only events in the public whitelist are accepted. `on()` and `emit()` **throw** on
  anything else, so a typo'd event name fails loudly instead of producing a listener
  that never fires.
- `off(event, handler)` removes exactly that handler; `off(event)` removes all of them.

```typescript
const onMessage = (payload) => console.log(payload.data.content.data);

agent.on(Events.Message.AGENT_MESSAGE, onMessage);
agent.off(Events.Message.AGENT_MESSAGE, onMessage);  // removes just this one
agent.off(Events.Message.AGENT_MESSAGE);             // removes every handler
```

**Channel Monitoring** (`sdk.createChannel()` return value):
- Filter public channel events received by SDK/agent sockets in this process
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
    defaultModel: 'gpt-5.2',
    apiKey: process.env.OPENAI_API_KEY,
    allowedTools: ['messaging_send', 'messaging_coordinate']
});

await agent.connect();

// Listen for messages
agent.on(Events.Message.AGENT_MESSAGE, async (payload) => {
    console.log(`${payload.data.senderId}: ${payload.data.content.data}`);
    
    // Respond
    await agent.mxfService.sendMessage(`Received your message!`);
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
    defaultModel: 'claude-opus-4.5',
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
// Update canonical channel memory. The resolved value is the persisted document.
const updated = await agent.mxfService.updateSharedMemory({
    notes: { project: 'Q4 Sales Analysis' },
    sharedState: { phase: 'data-collection' }
});

const channelMemory = await agent.mxfService.getSharedMemory();

// Agent-private key/value memory is exposed through the authorized MCP tools.
// The channel key and requested allowedTools must grant both names.
await agent.executeTool('agent_memory_write', {
    key: 'preferences',
    value: { theme: 'dark', language: 'en' },
    memorySection: 'notes'
});

const preferences = await agent.executeTool('agent_memory_read', {
    key: 'preferences',
    memorySection: 'notes'
});
```

### Channel Monitoring

```typescript
// Create a monitor to observe all channel activity
const monitor = await sdk.createChannel('my-channel', { name: 'My Channel' });

// Listen to all messages from all agents
monitor.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log(`[${payload.agentId}] ${payload.data.content.data}`);
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

> **Note:** Model ids change often. The ids in these docs are a snapshot of what was
> available when they were written; providers add, rename, and retire models all the
> time. Check your provider's current list before relying on an id — for OpenRouter,
> <https://openrouter.ai/models>. For Claude on OpenRouter, `~anthropic/claude-opus-latest`,
> `~anthropic/claude-sonnet-latest`, and `~anthropic/claude-haiku-latest` resolve to the
> newest release in each family, so they are the ids to use unless you need a specific
> version. `~anthropic/claude-fable-latest` is the same kind of alias for the top-tier
> family; it is priced well above the others and nothing in MXF selects it by default.

### OpenRouter
```typescript
llmProvider: 'openrouter',
defaultModel: '~anthropic/claude-opus-latest',
apiKey: process.env.OPENROUTER_API_KEY
```

### Anthropic
```typescript
llmProvider: 'anthropic',
defaultModel: 'claude-opus-4.5',
apiKey: process.env.ANTHROPIC_API_KEY
```

### OpenAI
```typescript
llmProvider: 'openai',
defaultModel: 'gpt-5.2',
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
bun run mxf setup:interactive
```

This will prompt you for:
- Email and password (creates user account)
- Project/channel name
- Agent names

All credentials are automatically saved to `.env` file.

### Manual Commands

```bash
# Create a channel
bun run mxf channel:create \
  --id my-channel \
  --name "My Channel" \
  --email user@example.com \
  --password your-password

# Generate agent keys (saved to .env)
bun run mxf key:generate \
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
4. **Tool Access Control**: Treat the channel key's grant as the maximum; an agent can narrow it but cannot expand it
5. **Privileged Capabilities**: Host, network, and `stdio` process capabilities are disabled until the server operator explicitly enables their gates
6. **MXP Encryption**: Enable for sensitive communications in production

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
    reasoning?: { enabled: boolean };  // false explicitly disables models that reason by default (GLM, Qwen, DeepSeek)
    
    // Optional: Tool Access
    // undefined = curated core tools; [] = no tools; non-empty = requested
    // subset of the authenticated channel key's maximum grant
    allowedTools?: string[];
    
    // Optional: MXP Settings
    mxpEnabled?: boolean;
    mxpPreferredFormat?: 'auto' | 'mxp' | 'natural-language';
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
    password: process.env.MXF_PASSWORD!
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
