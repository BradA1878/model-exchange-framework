# Getting Started with MXF

This guide provides a comprehensive introduction to the Model Exchange Framework (MXF), covering installation, basic concepts, and building your first AI agent application.

## What is MXF?

The Model Exchange Framework (MXF) is a platform for building autonomous multi-agent AI systems. It provides:

- **Multi-Agent Collaboration**: Agents work together naturally through goal-oriented messaging
- **Real-Time Communication**: WebSocket-based instant messaging with Socket.IO
- **Hybrid Tool System**: 78+ built-in tools plus external MCP server integration
- **Semantic Search & Memory**: Meilisearch integration for intelligent memory retrieval (87% prompt reduction)
- **Docker Deployment**: Docker Compose stack with full service orchestration
- **Intelligent Optimization**: MXP 2.0 provides token and bandwidth optimization
- **Enterprise Infrastructure**: MongoDB persistence, Meilisearch search, domain key authentication, comprehensive analytics
- **ORPAR Control Loop**: Structured cognitive cycle for intelligent decision-making

## Prerequisites

### Option A: Docker Deployment (Recommended)

- **Docker 24.0+** and **Docker Compose 2.0+** installed
- **OpenAI API Key** (for embeddings, required if using semantic search)
- **LLM Provider API Key(s)** (optional, for LLM-powered agents)
- Basic knowledge of Docker and TypeScript/JavaScript

### Option B: Local Development

- **Node.js 18+** installed
- **MongoDB** running (local or cloud instance)
- **LLM Provider API Key(s)** (optional, for LLM-powered agents) - Choose from (mix and match):
  - [OpenRouter](https://openrouter.ai/) - Access to 200+ models
  - [OpenAI](https://platform.openai.com/) - GPT models
  - [Anthropic](https://console.anthropic.com/) - Claude models
  - [Google AI](https://ai.google.dev/) - Gemini models
  - [xAI](https://x.ai/) - Grok models
  - Azure OpenAI - Enterprise GPT
  - [Ollama](https://ollama.ai/) - Local models (no API key needed)
- Basic knowledge of TypeScript/JavaScript
- Familiarity with async/await patterns

## Installation

### Option A: Docker Deployment (Recommended)

**This deploys the complete MXF stack: Server + MongoDB + Meilisearch + Redis + Dashboard**

#### 1. Clone Repository

```bash
git clone https://github.com/BradA1878/model-exchange-framework
cd model-exchange-framework
```

#### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Generate secure keys
openssl rand -base64 32  # Use for MEILISEARCH_MASTER_KEY
openssl rand -base64 64  # Use for JWT_SECRET
openssl rand -base64 32  # Use for AGENT_API_KEY
```

Edit `.env` with your configuration (required fields):

```env
# Security - REQUIRED
MEILISEARCH_MASTER_KEY=<your-generated-key>
JWT_SECRET=<your-generated-secret>
AGENT_API_KEY=<your-generated-api-key>
MONGODB_PASSWORD=<secure-password>
REDIS_PASSWORD=<secure-password>

# LLM Integration - REQUIRED for semantic search
OPENAI_API_KEY=sk-<your-openai-key>

# Optional: SystemLLM for ORPAR control loop
OPENROUTER_API_KEY=sk-or-v1-<your-openrouter-key>

# Meilisearch Configuration
ENABLE_MEILISEARCH=true
ENABLE_SEMANTIC_SEARCH=true
MEILISEARCH_HYBRID_RATIO=0.7
```

#### 3. Deploy Full Stack

```bash
# Build and start all services
npm run docker:up

# View logs
npm run docker:logs

# Check service health
npm run docker:health
```

#### 4. Access Services

- **MXF Server**: `http://localhost:3001`
- **Dashboard**: `http://localhost:5173`
- **Meilisearch**: `http://localhost:7700`
- **MongoDB**: `localhost:27017`
- **Redis**: `localhost:6379`

📖 **[Complete Docker Deployment Guide →](./deployment.md)**
📖 **[Meilisearch Integration Guide →](./meilisearch-integration.md)**

---

### Option B: Local Development

#### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/BradA1878/model-exchange-framework
cd model-exchange-framework

# Install dependencies
npm install

# Build the project
npm run build
```

#### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/mxf

# Server Authentication (REQUIRED)
JWT_SECRET=your_secure_random_jwt_secret
MXF_DOMAIN_KEY=generate_with_server_cli_below

# LLM Provider API Keys (Optional - choose your provider)
# OpenRouter - Access to 200+ models
# OPENROUTER_API_KEY=your-openrouter-key-here

# Anthropic - Claude models
# ANTHROPIC_API_KEY=your-anthropic-key-here

# OpenAI - GPT models
# OPENAI_API_KEY=your-openai-key-here

# Google AI - Gemini models
# GOOGLE_AI_API_KEY=your-google-ai-key-here

# xAI - Grok models
# XAI_API_KEY=your-xai-key-here

# Azure OpenAI - Enterprise GPT
# AZURE_OPENAI_API_KEY=your-azure-key-here
# AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
# AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4-1-mini
# AZURE_OPENAI_API_VERSION=2024-04-01-preview
# AZURE_OPENAI_MODEL_NAME=gpt-4.1-mini
# Note: You can also configure Azure settings per-agent using providerOptions in agent config

# Ollama - Local models (no API key needed, just endpoint)
# OLLAMA_BASE_URL=http://localhost:11434

# SystemLLM Configuration (for ORPAR control loop, pattern learning, coordination)
# Master switch to enable/disable SystemLLM features
SYSTEMLLM_ENABLED=true
# Provider for SystemLLM operations (openrouter, azure-openai, openai, anthropic, gemini, xai, ollama)
SYSTEMLLM_PROVIDER=openrouter
# Default model for SystemLLM (optional - defaults to provider-specific model)
# SYSTEMLLM_DEFAULT_MODEL=google/gemini-2.5-flash
# Enable dynamic model selection based on complexity (recommended for OpenRouter only)
SYSTEMLLM_DYNAMIC_MODEL_SELECTION=true

# MXP Protocol (Optional)
MXP_ENCRYPTION_KEY=generate_with_npm_run_mxp_generate_key
MXP_ENCRYPTION_ENABLED=true

# Server Configuration
PORT=3001
NODE_ENV=development
```

### 3. Generate Security Keys

```bash
# Generate domain key (REQUIRED for SDK authentication)
npm run server:cli -- domain-key:generate

# Generate MXP encryption key (Optional)
npm run mxp:generate-key

# Keys are automatically saved to your .env file
```

### 4. Create Server User

**Quick Demo Setup (Recommended):**
```bash
# Automatically create demo user with standard credentials (demo-user/demo-password-1234)
npm run server:cli -- demo:setup
# This auto-adds MXF_DEMO_USERNAME and MXF_DEMO_PASSWORD to .env
```

**Or Create Custom User:**
```bash
# Create a user account with custom credentials
npm run server:cli -- user:create \
  --email your-email@example.com \
  --password your-password \
  --username your-username
```

### 5. Start the Server

```bash
# Development mode with hot reload
npm run start:dev

# Production mode
npm run build
npm start
```

The server will start on `http://localhost:3001`.

## Core Concepts

### Agents

Agents are autonomous AI entities that can:
- Communicate with other agents
- Execute tools and access resources
- Make decisions using LLM reasoning
- Store and retrieve memory
- Complete assigned tasks

### Channels

Channels are communication spaces where agents collaborate:
- Organize agents by project or purpose
- Share context and memory
- Enable group messaging
- Configure channel-specific settings

### Tools

Tools extend agent capabilities:
- **Built-in Tools**: 78+ tools for common operations (including 3 semantic search tools)
- **External MCP Servers**: Integrate custom tool providers
- **Tool Discovery**: Agents dynamically discover available tools
- **Tool Filtering**: Control which tools agents can access
- **Memory Search Tools**: Semantic search across conversations, actions, and patterns

### Memory

Multi-scope memory system with semantic search:
- **Agent Memory**: Private to each agent
- **Channel Memory**: Shared within a channel
- **Relationship Memory**: Between two agents
- **Persistent Storage**: Backed by MongoDB
- **Semantic Search**: Meilisearch indexes all conversations for intelligent retrieval
- **Infinite History**: Search beyond the 50-message window limit
- **Hybrid Search**: Configurable keyword + semantic search (default 70/30)

### Control Loop (ORPAR)

Structured cognitive cycle:
1. **Observation**: Gather environmental context
2. **Reasoning**: Analyze situation with LLM
3. **Planning**: Create comprehensive plans
4. **Action**: Execute planned actions
5. **Reflection**: Learn from outcomes

## SDK Setup for Developers

### 1. Install the SDK (If Using as Package)

```bash
npm install @mxf/sdk
```

**Note**: Currently, the SDK is part of the monorepo. Use the built SDK from `src/sdk/`.

### 2. Set Up Your Environment

Create a `.env` file for your application:

```env
# Domain key provided by MXF server operator
MXF_DOMAIN_KEY=your-64-char-domain-key

# User credentials (from server operator)
MXF_USERNAME=demo-user
MXF_PASSWORD=demo-password-1234

# Or use JWT token
# MXF_USER_TOKEN=your-jwt-token

# LLM Provider API Key (choose your provider)
OPENROUTER_API_KEY=your-openrouter-api-key
# or ANTHROPIC_API_KEY=your-anthropic-key
# or OPENAI_API_KEY=your-openai-key
# or GOOGLE_AI_API_KEY=your-google-key
# or XAI_API_KEY=your-xai-key
```

### 3. Generate Channel and Keys

Use the SDK CLI to set up your workspace:

```bash
# Create a channel
npm run sdk:cli -- channel:create \
  --id getting-started \
  --name "Getting Started Channel" \
  --email demo@example.com \
  --password demo-password-1234

# Generate agent keys
npm run sdk:cli -- key:generate \
  --channel getting-started \
  --agents hello-agent,ai-assistant \
  --email demo@example.com \
  --password demo-password-1234 \
  --output credentials.json
```

The CLI will create a `credentials.json` file with your agent keys:
```json
{
  "channelId": "getting-started",
  "keys": {
    "hello-agent": {
      "keyId": "key-abc123",
      "secretKey": "secret-xyz789"
    },
    "ai-assistant": {
      "keyId": "key-def456",
      "secretKey": "secret-uvw012"
    }
  }
}
```

## Your First Agent

### Basic Agent Pattern

**IMPORTANT**: All agents must be created through `MxfSDK` - you cannot instantiate agents directly.

```typescript
import { MxfSDK, Events } from '@mxf/sdk';
import type { MxfAgent } from '@mxf/sdk';

// 1. Initialize the SDK with domain key and user authentication
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

// Connect the SDK
await sdk.connect();

// 2. Create agent through SDK (ONLY way to create agents)
const agent = await sdk.createAgent({
    agentId: 'hello-agent',
    name: 'Hello Agent',
    channelId: 'getting-started',
    keyId: 'key-abc123',
    secretKey: 'secret-xyz789',
    llmProvider: 'openrouter',  // Options: 'openrouter', 'anthropic', 'openai', 'gemini', 'xai', 'ollama'
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY  // Use appropriate key for your provider
});

// 3. Connect the agent
await agent.connect();

// 4. Listen to events
agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log('Received:', payload.data.content);
    console.log('From:', payload.data.senderId);
});

// 5. Send messages
await agent.channelService.sendMessage('Hello from my first agent!');
```

### LLM-Powered Agent

Create an intelligent agent with full LLM capabilities:

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create LLM-powered agent with all configuration options
const aiAgent = await sdk.createAgent({
    // Required fields
    agentId: 'ai-assistant',
    name: 'AI Assistant',
    channelId: 'getting-started',
    keyId: 'key-def456',
    secretKey: 'secret-uvw012',
    llmProvider: 'anthropic',  // Options: 'openrouter', 'anthropic', 'openai', 'gemini', 'xai', 'ollama'
    defaultModel: 'claude-3-5-sonnet-20241022',
    
    // Optional: Agent identity
    agentConfigPrompt: `You are a helpful AI assistant in the MXF framework.
    You can help users understand and use the framework effectively.
    Be concise, accurate, and friendly.`,
    description: 'Helpful AI assistant',
    capabilities: ['conversation', 'analysis', 'tool-use'],
    
    // Optional: LLM settings
    apiKey: process.env.ANTHROPIC_API_KEY,  // Use appropriate key for your provider
    temperature: 0.7,
    maxTokens: 100000,
    reasoning: { enabled: false },
    
    // Optional: MXP settings
    mxpEnabled: false,
    mxpPreferredFormat: 'auto',
    mxpForceEncryption: false
});

await aiAgent.connect();

// The agent will now automatically:
// - Respond to messages using its LLM
// - Discover and use available tools
// - Maintain conversation history
// - Participate in autonomous coordination
```

### Agent with Custom Tool Access

Control which tools your agent can access (principle of least privilege):

```typescript
const restrictedAgent = await sdk.createAgent({
    agentId: 'restricted-agent',
    name: 'Restricted Agent',
    channelId: 'getting-started',
    keyId: 'key-ghi789',
    secretKey: 'secret-rst345',
    llmProvider: 'openai',  // Options: 'openrouter', 'anthropic', 'openai', 'gemini', 'xai', 'ollama'
    defaultModel: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY,  // Use appropriate key for your provider
    
    // Restrict to specific tools only
    allowedTools: [
        'messaging_send',        // Send messages
        'messaging_coordinate',  // Coordinate with others
        'tools_recommend',       // Discover relevant tools
        'channel_context_get',   // Access channel context
        'task_complete'          // Complete tasks
    ]
});

await restrictedAgent.connect();
```

## Building a Multi-Agent System

### Create Specialized Agents

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

// Initialize SDK once for all agents
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Project Manager Agent
const pmAgent = await sdk.createAgent({
    agentId: 'pm-sarah',
    name: 'Sarah (Project Manager)',
    channelId: 'dev-team',
    keyId: 'pm-key',
    secretKey: 'pm-secret',
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    
    agentConfigPrompt: `You are Sarah, an experienced project manager.
    Your role is to coordinate team activities, track progress,
    and ensure project objectives are met.`,
    
    capabilities: ['coordination', 'workflow_management', 'task_assignment'],
    
    allowedTools: [
        'messaging_send',
        'messaging_coordinate',
        'messaging_broadcast',
        'task_create',
        'task_assign',
        'task_complete',
        'tools_recommend'
    ]
});

// Developer Agent
const devAgent = await sdk.createAgent({
    agentId: 'dev-alex',
    name: 'Alex (Senior Developer)',
    channelId: 'dev-team',
    keyId: 'dev-key',
    secretKey: 'dev-secret',
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    
    agentConfigPrompt: `You are Alex, a senior software developer.
    You excel at system architecture, code review, and mentoring.
    You work collaboratively with the team.`,
    
    capabilities: ['development', 'architecture', 'code_review'],
    
    allowedTools: [
        'messaging_send',
        'filesystem_read',
        'filesystem_write',
        'shell_execute',
        'memory_store',
        'memory_retrieve',
        'task_complete'
    ]
});

// Connect all agents
await Promise.all([
    pmAgent.connect(),
    devAgent.connect()
]);

// Agents can now collaborate automatically!
```

### Autonomous Collaboration

Agents collaborate using goal-oriented task descriptions:

```typescript
// PM creates a task for the team
await pmAgent.channelService.createTask({
    taskId: 'auth-system',
    title: 'Build User Authentication',
    description: `
        Team: Build a secure user authentication system.
        
        Alex: Design the architecture and implement the core auth logic.
        
        When complete, call task_complete with your results.
    `,
    assignedAgents: ['dev-alex'],
    priority: 'high',
    metadata: {
        deadline: '2025-12-31',
        completionAgent: 'dev-alex'
    }
});

// Alex automatically:
// 1. Receives the task via Events.Task.ASSIGNED
// 2. Plans the architecture using LLM reasoning
// 3. Implements the solution using allowed tools
// 4. Signals completion via task_complete tool
```

## Using the Dashboard

> ⚠️ **Note:** The Dashboard is currently in development. Some features may be incomplete.

MXF includes a Vue 3 dashboard for management:

```bash
# Start the dashboard (in a separate terminal)
cd dashboard
npm install
npm run dev
```

Access the dashboard at `http://localhost:5173`

### Dashboard Features

- **Channel Management**: Create and configure channels
- **Agent Monitoring**: View active agents and their status
- **Task Tracking**: Monitor task assignments and completion
- **Analytics**: View system performance metrics
- **Memory Management**: Browse and manage agent memory
- **Configuration**: Manage feature toggles and settings

## Configuration

### Event Listening

The SDK provides two ways to listen to events:

#### Agent-Level Events (Multi-Channel)

Listen to events across all channels the agent participates in:

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

const sdk = new MxfSDK({ /* ... */ });
await sdk.connect();
const agent = await sdk.createAgent({ /* ... */ });
await agent.connect();

// Listen to messages from all channels
agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log('Message from:', payload.data.senderId);
    console.log('Channel:', payload.channelId);
    console.log('Content:', payload.data.content);
});

// Listen to task assignments
agent.on(Events.Task.ASSIGNED, (payload) => {
    console.log('New task:', payload.data.taskId);
});

// Listen to tool results
agent.on(Events.Mcp.TOOL_RESULT, (payload) => {
    console.log('Tool:', payload.data.toolName);
    console.log('Result:', payload.data.result);
});

// Method chaining supported
agent
    .on(Events.Message.AGENT_MESSAGE, handleMessage)
    .on(Events.Task.COMPLETED, handleTaskComplete)
    .on(Events.Agent.ERROR, handleError);
```

#### Channel-Level Events (Agent-Specific)

Listen to events specific to this agent's operations in its channel:

```typescript
// Events for this agent's channel activities
agent.channelService.on(Events.Message.AGENT_MESSAGE, (payload) => {
    // Events related to this agent's channel operations
    console.log('Message in my channel:', payload.data.content);
});

agent.channelService.on(Events.Channel.AGENT_JOINED, (payload) => {
    console.log('Agent joined:', payload.data.agentId);
});

// Remove event listener
agent.channelService.off(Events.Message.AGENT_MESSAGE);
```

#### Channel Monitor (All Channel Events)

Monitor ALL public events from ALL agents in a channel (useful for orchestration and monitoring):

```typescript
// Create a channel monitor to observe all channel activity
const monitor = sdk.createChannelMonitor('my-channel');

// Listen to all messages from all agents in the channel
monitor.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log(`Message from ${payload.agentId}:`, payload.data);
});

// Monitor all channel events
monitor.on(Events.Channel.AGENT_JOINED, (payload) => {
    console.log('Agent joined channel:', payload.data.agentId);
});

monitor.on(Events.Task.COMPLETED, (payload) => {
    console.log('Task completed:', payload.data.taskId);
});
```

### MXP 2.0 Configuration

Enable token and bandwidth optimization:

```typescript
import { MxpConfigManager, SecurityLevel } from './src/shared/mxp/MxpConfigManager';

const mxpManager = MxpConfigManager.getInstance();

// Configure channel with optimization
mxpManager.createChannelConfig('my-channel', {
    enableTokenOptimization: true,
    enableBandwidthOptimization: true,
    securityLevel: SecurityLevel.ENHANCED,
    
    tokenStrategies: {
        contextCompression: true,
        promptOptimization: true,
        conversationSummarization: true,
        templateMatching: true,
        entityDeduplication: false,
        toolSchemaReduction: false
    }
});

// Configure agent-specific overrides
mxpManager.setAgentConfig('special-agent', {
    scope: {
        agentId: 'special-agent',
        inheritFromChannel: true,
        overrideSettings: true
    },
    modules: {
        tokenOptimization: {
            enabled: false  // Disable for this agent
        }
    }
});
```

## Common Patterns

### Task Assignment

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

const sdk = new MxfSDK({ /* ... */ });
await sdk.connect();
const agent = await sdk.createAgent({ /* ... */ });
await agent.connect();

// Create and assign a task
await agent.channelService.createTask({
    taskId: 'sales-analysis',
    title: 'Analyze Sales Data',
    description: 'Analyze Q4 sales data and provide insights',
    assignedAgents: ['data-analyst'],
    priority: 'high',
    metadata: {
        deadline: '2025-12-31',
        department: 'analytics'
    }
});

// Monitor task completion
agent.on(Events.Task.COMPLETED, (payload) => {
    console.log('Task completed:', payload.data.taskId);
    console.log('Result:', payload.data.result);
});

agent.on(Events.Task.PROGRESS_UPDATED, (payload) => {
    console.log('Progress:', payload.data.progress);
});
```

### Memory Management

```typescript
// Memory operations are handled through the channel service
// Agent-private memory (specific to this agent)
await agent.channelService.updateMemory('agent', 'preferences', {
    theme: 'dark',
    language: 'en',
    notifications: true
});

// Channel-shared memory (visible to all agents in channel)
await agent.channelService.updateMemory('channel', 'project-context', {
    projectName: 'User Auth System',
    phase: 'development',
    deadline: '2025-12-31'
});

// Retrieve memory
const preferences = await agent.channelService.getMemory('agent', 'preferences');
const projectContext = await agent.channelService.getMemory('channel', 'project-context');

// Delete memory
await agent.channelService.deleteMemory('agent', 'old-preference');
```

### Tool Discovery

```typescript
// Agents automatically discover and use tools via LLM reasoning
// To see available tools in logs, check tool_recommend events

agent.on(Events.Mcp.TOOL_CALL, (payload) => {
    console.log('Tool called:', payload.data.toolName);
    console.log('Arguments:', payload.data.arguments);
});

agent.on(Events.Mcp.TOOL_RESULT, (payload) => {
    console.log('Tool result:', payload.data.result);
});

// Agents with allowedTools will only see their permitted tools
```

### Error Handling

```typescript
// Handle agent errors
agent.on(Events.Agent.ERROR, (payload) => {
    console.error('Agent error:', payload.data.error);
    
    // Attempt reconnection for connection errors
    if (payload.data.type === 'connection') {
        setTimeout(async () => {
            await agent.connect();
        }, 5000);
    }
});

// Handle message send failures
agent.on(Events.Message.MESSAGE_SEND_FAILED, (payload) => {
    console.error('Failed to send message:', payload.data.error);
    // Retry logic here
});

// Handle tool errors
agent.on(Events.Mcp.TOOL_ERROR, (payload) => {
    console.error('Tool error:', payload.data.toolName, payload.data.error);
});
```

## Running Example Demos

MXF includes example demos:

### First Contact Demo

6 AI agents in a first contact scenario:

```bash
# Start the server
npm run start:dev

# Run the demo (in another terminal)
npx run demo:first-contact
```

### Interview Scheduling Demo

Agents coordinate to schedule interviews:

```bash
# Start the server
npm run start:dev

# Run the demo (in another terminal)
npm run demo:interview
```

## Next Steps

Now that you have the basics, explore:

1. **[SDK Documentation](./sdk/index.md)** - Comprehensive SDK reference
2. **[API Documentation](./api/index.md)** - REST and WebSocket APIs
3. **[MXP 2.0 Guide](./mxf/mxp-migration-guide.md)** - Enable optimization
4. **[Architecture Overview](./mxf/index.md)** - System architecture
5. **[Configuration Manager](./sdk/config-manager.md)** - Feature toggles and settings
6. **[SDK Managers](./sdk/managers.md)** - Memory, MCP, Prompt, Task managers
7. **[SDK Handlers](./sdk/handlers.md)** - Control loop, tools, messaging

## Common Issues

### Connection Errors

```bash
# Check MongoDB is running
mongosh

# Check server is running
curl http://localhost:3001/api/health
```

### Authentication Errors

```bash
# Verify API key in .env
echo $AGENT_API_KEY

# Check agent key configuration
# Keys should be consistent between agent and server
```

### Tool Execution Errors

```typescript
// Enable debug logging
const agent = await sdk.createAgent({
    agentId: 'debug-agent',
    name: 'Debug Agent',
    channelId: 'main',
    keyId: 'key-123',
    secretKey: 'secret-456',
    logLevel: 'debug'
});

// Check tool availability
const tools = await agent.toolService.getAvailableTools();
console.log('Available tools:', tools.map(t => t.name));
```

### LLM Errors

```bash
# Verify your LLM provider API key is set
echo $OPENROUTER_API_KEY    # or
echo $ANTHROPIC_API_KEY     # or
echo $OPENAI_API_KEY        # or
echo $GOOGLE_AI_API_KEY     # or
echo $XAI_API_KEY

# Check API key is valid at your provider's website
```

## Best Practices

### SDK Usage

1. **Single SDK Instance**: Create one `MxfSDK` instance per application, reuse for all agents
2. **Proper Imports**: Only import from `@mxf/sdk`, never from internal paths
3. **Type Safety**: Use TypeScript types: `import type { MxfAgent } from '@mxf/sdk'`
4. **Agent Creation**: Always create agents via `sdk.createAgent()`, never directly
5. **Connection Management**: Connect SDK once, then create and connect individual agents

### Agent Design

1. **Clear Identity**: Provide descriptive `agentConfigPrompt` defining role and responsibilities
2. **Tool Filtering**: Use `allowedTools` for security (principle of least privilege)
3. **Event Handling**: Use `agent.on()` for agent-specific events, `sdk.createChannelMonitor()` for monitoring all channel activity
4. **Error Handling**: Listen to `Events.Agent.ERROR` and implement reconnection logic
5. **Memory Management**: Use appropriate scopes (agent vs channel memory)
6. **Dynamic Templates**: System prompts support 17 dynamic templates (date/time, context, config) that update on every API request

> **💡 Tip**: Use templates like `{{DATE_TIME}}`, `{{ACTIVE_AGENTS_COUNT}}`, and `{{LLM_PROVIDER}}` in your system prompts to give agents real-time environmental awareness. See [Dynamic Template System](./sdk/system-prompt-example.md#dynamic-template-system) for complete list.

### Multi-Agent Systems

1. **Goal-Oriented Tasks**: Use clear task descriptions with completion criteria
2. **Autonomous Coordination**: Let agents use LLM reasoning to make decisions
3. **Task-Based Triggering**: Use `createTask()` to activate agent workflows
4. **Completion Signals**: Agents use `task_complete` tool to signal completion
5. **Event Monitoring**: Listen to task events for workflow orchestration

### Performance

1. **Enable MXP 2.0**: Configure token and bandwidth optimization when needed
2. **Tool Filtering**: Reduce context size with `allowedTools` array
3. **Channel Monitoring**: Use `sdk.createChannelMonitor()` to observe all channel activity efficiently
4. **Connection Reuse**: Connect SDK once, create multiple agents from same instance
5. **Efficient Prompts**: Keep `agentConfigPrompt` concise but informative

### Security

1. **Domain Key**: Keep `MXF_DOMAIN_KEY` secure, never commit to version control
2. **User Credentials**: Use environment variables for username/password or JWT tokens
3. **Agent Keys**: Store keys in separate credentials file (e.g., `credentials.json`)
4. **Tool Access Control**: Restrict tools via `allowedTools` based on agent role
5. **MXP Encryption**: Enable for sensitive communications in production

## Support & Resources

- **Documentation**: [Full documentation](./index.md)
- **GitHub Issues**: [Report bugs](https://github.com/BradA1878/model-exchange-framework/issues)
- **Examples**: Check `/examples` directory

## Quick Reference

### Common Commands

```bash
# Server
npm run start:dev        # Development server
npm run build           # Build for production
npm start               # Production server

# Dashboard
cd dashboard && npm run dev

# Demos
npm run demo:first-contact
npm run demo:interview
npm run demo:mxp

```

### Environment Variables

**Server Operator (.env on server):**
```env
# Required
MONGODB_URI              # MongoDB connection string
JWT_SECRET              # JWT secret for auth
MXF_DOMAIN_KEY          # Domain key for SDK authentication (REQUIRED)

# Optional - LLM Provider API Keys
OPENROUTER_API_KEY      # LLM provider API keys (choose your provider)
ANTHROPIC_API_KEY       # or Anthropic
OPENAI_API_KEY          # or OpenAI
GOOGLE_AI_API_KEY       # or Google AI
XAI_API_KEY             # or xAI
AZURE_OPENAI_API_KEY    # or Azure OpenAI
AZURE_OPENAI_ENDPOINT   # Azure endpoint (if using Azure)
OLLAMA_BASE_URL         # or Ollama (local)

# Optional - SystemLLM Configuration
SYSTEMLLM_ENABLED              # Enable/disable SystemLLM (default: true)
SYSTEMLLM_PROVIDER             # Provider for SystemLLM (default: openrouter)
SYSTEMLLM_DEFAULT_MODEL        # Model override (optional)
SYSTEMLLM_DYNAMIC_MODEL_SELECTION  # Complexity-based model switching (default: true)

# Optional - Other
MXP_ENCRYPTION_KEY      # MXP encryption key
PORT                    # Server port (default: 3001)
NODE_ENV                # Environment (development/production)
```

**SDK Developer (.env for SDK app):**
```env
# Required (from server operator)
MXF_DOMAIN_KEY          # Domain key provided by server operator

# Required (user credentials)
MXF_USERNAME            # Your username
MXF_PASSWORD            # Your password
# OR use JWT token
MXF_USER_TOKEN          # JWT token from login

# Required (LLM provider - choose one or more)
OPENROUTER_API_KEY      # OpenRouter API key
ANTHROPIC_API_KEY       # or Anthropic API key
OPENAI_API_KEY          # or OpenAI API key
GOOGLE_AI_API_KEY       # or Google AI API key
XAI_API_KEY             # or xAI API key
OLLAMA_BASE_URL         # or Ollama endpoint

# Optional (agent keys from SDK CLI)
# These are usually loaded from credentials.json instead
```

### Key Imports

```typescript
// SDK (ONLY entry point)
import { MxfSDK } from '@mxf/sdk';

// Events for listening
import { Events } from '@mxf/sdk';

// Types (for type annotations)
import type { MxfAgent } from '@mxf/sdk';
import type { AgentCreationConfig, TaskConfig } from '@mxf/sdk';
import type { PublicEventName } from '@mxf/sdk';

// MXP 2.0 Configuration
import { MxpConfigManager, SecurityLevel } from '@mxf/sdk';

// LLM Provider Types
import { LlmProviderType } from '@mxf/sdk';

// Connection Status
import { ConnectionStatus } from '@mxf/sdk';
```

---

**Ready to build intelligent multi-agent systems? Start with the examples above and explore the comprehensive documentation!**
