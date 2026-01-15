# Model Exchange Framework (MXF) Documentation

Welcome to the comprehensive technical documentation for the Model Exchange Framework (MXF). This documentation is designed to help developers, product teams, and contributors understand, use, and extend the MXF platform for building sophisticated multi-agent AI systems.

## Quick Navigation

### 🚀 **New to MXF?**
- **[Getting Started Guide](./getting-started.md)** - Complete introduction with examples
- **[Docker Deployment Guide](./deployment.md)** - Production deployment with Docker

### 📚 **Core Documentation**
- **[SDK Reference](./sdk/index.md)** - TypeScript SDK for building agents
- **[API Reference](./api/index.md)** - REST and WebSocket APIs
- **[Tool Reference](./mxf/tool-reference.md)** - Complete guide to 95+ built-in tools
- **[Core Architecture](./mxf/index.md)** - System design and patterns
- **[Dashboard Guide](./dashboard/index.md)** - Web interface documentation (⚠️ in development)

### 🔍 **Semantic Search & Memory**
- **[Meilisearch Integration Guide](./meilisearch-integration.md)** - Semantic search setup and usage
- **[Docker Deployment](./deployment.md)** - Complete stack deployment

### ⚡ **Optimization & Performance**
- **[MXP 2.0 Protocol](./mxf/mxp-protocol.md)** - Token & bandwidth optimization protocol
- **[MXP Technical Specification](./mxf/mxp-technical-specification.md)** - Detailed MXP architecture
- **[MXP Enterprise Guide](./mxf/mxp-enterprise.md)** - Enterprise deployment and ROI tracking
- **[MXP Monitoring](./mxf/mxp-monitoring.md)** - Production monitoring and analytics
- **[MXP Troubleshooting](./mxf/mxp-troubleshooting.md)** - Diagnostic and resolution guide
- **[Analytics & Metrics](./analytics/index.md)** - Performance tracking

### 🔧 **Developer Resources**
- **[Configuration Management](./sdk/config-manager.md)** - Feature toggles, LLM selection
- **[SDK Managers](./sdk/managers.md)** - MCP, Memory, Prompt, Task managers
- **[SDK Handlers](./sdk/handlers.md)** - Control loop, tools, messaging
- **[Event System](./sdk/events.md)** - Event-driven architecture

---

## What is MXF?

The **Model Exchange Framework (MXF)** is a framework for building autonomous multi-agent AI systems. It provides:

### Core Capabilities

- **🤖 Multi-Agent Collaboration**: Agents work together naturally through goal-oriented task prompting
- **⚡ Real-Time Communication**: WebSocket-based messaging with Socket.IO
- **Hybrid Tool System**: 95+ built-in tools plus external MCP server integration (including 3 memory search tools)
- **🔍 Semantic Search**: Meilisearch integration for intelligent memory retrieval
- **🧠 ORPAR Control Loop**: Structured cognitive cycle (Observation, Reasoning, Planning, Action, Reflection)
- **💾 Multi-Scope Memory**: Agent-private, channel-shared, and relationship memory with semantic search
- **🐳 Docker Deployment**: Docker Compose stack with full service orchestration
- **📊 Enterprise Infrastructure**: MongoDB persistence, Meilisearch search, Redis caching, JWT authentication, comprehensive analytics, optional n8n workflow integration

### Advanced Features

- **MXP 2.0 Protocol**: Token and bandwidth optimization
- **SystemLLM Integration**: AI-powered task assignment and reasoning
- **Pattern Learning**: Cross-agent knowledge sharing with ML-based predictions
- **Proactive Validation**: Pre-execution validation with low latency, risk assessment, and multi-level caching
- **Auto-Correction System**: Intelligent parameter correction with safety guards
- **Error Prediction**: ML-based error prediction using ensemble models
- **Configurable Security**: Four security levels (standard → enhanced → regulated → classified)

## Documentation Structure

### For Developers

**Getting Started**
1. [Getting Started Guide](./getting-started.md) - Installation, first agent, multi-agent systems

**SDK Development**
2. [SDK Index](./sdk/index.md) - Main SDK documentation
3. [Configuration Manager](./sdk/config-manager.md) - Feature toggles and settings
4. [MXP Configuration](./sdk/mxp-config.md) - Optimization configuration
5. [SDK Managers](./sdk/managers.md) - Core manager classes
6. [SDK Handlers](./sdk/handlers.md) - Event and operation handlers
7. [Examples](./sdk/examples.md) - Code examples and patterns

**API Integration**
8. [API Index](./api/index.md) - REST and WebSocket APIs
9. [Channels API](./api/channels.md) - Channel management
10. [Agents API](./api/agents.md) - Agent operations
11. [Tasks API](./api/tasks.md) - Task management
12. [Memory API](./api/memory.md) - Memory persistence

### For Product & Business

**Understanding MXF**
- [Getting Started](./getting-started.md#what-is-mxf) - High-level overview
- [Core Architecture](./mxf/system-overview.md) - System capabilities
- [Key Concepts](./mxf/key-concepts.md) - Fundamental concepts
- [Use Cases](./sdk/examples.md) - Example applications and demos

**Performance & Optimization**
- [MXP 2.0 Benefits](./mxf/mxp-protocol.md) - Cost savings and efficiency
- [Analytics](./analytics/index.md) - Performance metrics
- [Validation System](./mxf/validation-system.md) - Error prevention

**Enterprise Features**
- [Security Model](./mxf/security.md) - Authentication and encryption
- [Extensibility](./mxf/extensibility.md) - Custom integrations
- [Dashboard](./dashboard/index.md) - Management interface (⚠️ in development)

## What's New in MXF

### 🔍 Semantic Search & Memory (Latest)

MXF now includes **Meilisearch integration** for semantic search capabilities:

**Key Features:**
- **Memory Search Tools**: `memory_search_conversations`, `memory_search_actions`, `memory_search_patterns`
- **Intelligent Context Retrieval**: Semantic search reduces token usage by retrieving only relevant context
- **Hybrid Search**: Configurable keyword + semantic search (default 70% semantic)
- **OpenAI Embeddings**: Using text-embedding-3-small for semantic understanding
- **Fast Queries**: Optimized for real-time agent queries
- **Automatic Indexing**: All conversations and tool executions indexed in real-time

📖 **[Learn about Meilisearch Integration →](./meilisearch-integration.md)**

### 🐳 Production Docker Stack

Complete containerization with orchestrated services:

**Services Deployed:**
- **MXF Server**: Node.js application server (Port 3001)
- **MongoDB**: Primary database for persistence (Port 27017)
- **Meilisearch**: Semantic search engine (Port 7700)
- **Redis**: High-performance caching layer (Port 6379)
- **Dashboard**: Vue.js management interface (Port 5173)
- **n8n** (Optional): Workflow automation platform (Port 5678) - requires self-hosted or n8n Cloud

📖 **[Docker Deployment Guide →](./deployment.md)**

### 🛡️ Advanced Validation & Error Handling

Comprehensive error prevention and correction system:

**Capabilities:**
- **Proactive Validation**: Pre-execution checks with risk assessment
- **Auto-Correction**: Intelligent parameter correction with pattern learning
- **ML Error Prediction**: Machine learning models predict and prevent failures
- **Pattern Learning**: Cross-agent knowledge sharing
- **Multi-Level Caching**: Memory → Redis → MongoDB
- **Performance Optimization**: Low-latency validation

📖 **[Proactive Validation API →](./api/proactive-validation.md)** | **[Auto-Correction API →](./api/auto-correction.md)**

### MXP 2.0 Protocol

MXF includes **MXP 2.0**, a modular optimization suite that delivers measurable performance improvements:

**Benefits:**
- **Token optimization** through AI-powered context compression
- **Bandwidth optimization** via binary encoding and enhanced aggregation
- **Progressive security architecture** with four security levels
- **Zero breaking changes** with full backward compatibility
- **Real-time analytics** with cost calculation and performance tracking

**Key Modules:**
- **Token Optimization**: Context compression, prompt optimization, conversation summarization
- **Bandwidth Optimization**: Binary encoding, enhanced message aggregation
- **Security**: Four levels from standard to classified
- **Analytics**: Real-time metrics, cost calculation, performance tracking

📖 **[Learn about MXP 2.0 →](./mxf/mxp-protocol.md)**

### SDK Configuration System

Comprehensive configuration management with:
- **Feature Toggles**: Enable/disable SDK features dynamically
- **LLM Model Management**: Support for multiple providers and models
- **Agent Type System**: Roles, service types, specializations
- **Channel-Level SystemLLM Control**: Fine-grained control over LLM usage

📖 **[Learn about ConfigManager →](./sdk/config-manager.md)**

### Advanced Manager & Handler System

Four core manager classes and five handler categories:
- **MxfMcpClientManager**: MCP client connections and tool discovery
- **MxfMemoryManager**: Conversation history with intelligent deduplication
- **MxfSystemPromptManager**: Dynamic prompt generation with tool filtering
- **MxfTaskExecutionManager**: Task lifecycle and execution coordination

📖 **[Explore SDK Managers →](./sdk/managers.md)** | **[Explore SDK Handlers →](./sdk/handlers.md)**

## Quick Start

### Installation

**Option A: Docker Deployment (Recommended for Production)**

```bash
git clone https://github.com/BradA1878/model-exchange-framework
cd model-exchange-framework

# Configure environment
cp .env.example .env
# Edit .env with your API keys and secrets

# Deploy full stack (MXF + MongoDB + Meilisearch + Redis + Dashboard)
npm run docker:up

# Check service health
npm run docker:health
```

📖 **[Complete Docker Deployment Guide →](./deployment.md)**

**Option B: Local Development**

```bash
git clone https://github.com/BradA1878/model-exchange-framework
cd model-exchange-framework
npm install
npm run build
npm run start
```

### Your First Agent

```typescript
// Import from the SDK (use relative path within the monorepo)
import { MxfSDK, LlmProviderType } from './src/sdk/index';

// Initialize SDK
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create channel and generate keys first
await sdk.createChannel({
    channelId: 'getting-started',
    name: 'Getting Started',
    description: 'First agent channel'
});

const keys = await sdk.generateKey({
    channelId: 'getting-started',
    name: 'first-agent-key'
});

// Create agent
const agent = await sdk.createAgent({
    // Required: Agent identity
    agentId: 'my-first-agent',
    name: 'My First Agent',
    channelId: 'getting-started',

    // Required: Authentication (use generated keys)
    keyId: keys.keyId,
    secretKey: keys.secretKey,

    // Required: LLM configuration
    llmProvider: LlmProviderType.OPENROUTER,
    apiKey: process.env.OPENROUTER_API_KEY!,
    defaultModel: 'anthropic/claude-3.5-sonnet',

    // Required: Agent personality/behavior
    agentConfigPrompt: `You are a helpful AI assistant. Be concise and friendly.`,

    // Optional: LLM parameters
    temperature: 0.7,
    maxTokens: 4000
});

await agent.connect();
```

📖 **[Complete Getting Started Guide →](./getting-started.md)**

## Example Projects

MXF includes comprehensive demos and examples:

```bash
# First Contact Demo - 6 agents in first contact scenario
npm run demo:first-contact

# Interview Scheduling - Multi-agent coordination
npm run demo:interview

# Fog of War Strategy Game - 8 agents in competitive game
npm run demo:fog-of-war

# AI Game Demos - Tic-Tac-Toe and Go Fish
npm run demo:tic-tac-toe
npm run demo:go-fish
```

📖 **[View All Example Documentation →](./examples/first-contact.md)**

## Architecture Highlights

### Event-Driven Design
- Central EventBus for decoupled communication
- Pub/sub pattern for real-time updates
- Event sourcing for audit trails

### Service-Oriented Architecture
- Modular services with single responsibilities
- Dependency injection for testability
- Clear separation of concerns

### Multi-Scope Memory
- Agent-private memory for preferences
- Channel-shared memory for collaboration
- Relationship memory for agent interactions
- Persistent storage with MongoDB

### Tool Handler Patterns

MXF uses standardized tool handler format:

```typescript
// Modern MCP Format (Recommended)
handler: async (input, context): Promise<McpToolHandlerResult> => {
    return { 
        content: { 
            type: 'application/json', 
            data: result 
        } 
    };
}
```

📖 **[Tool Architecture →](./sdk/handlers.md#mcphandler--mcptoolhandlers)**

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **API Framework**: Express.js
- **Real-Time**: Socket.IO
- **Database**: MongoDB with Mongoose
- **Search Engine**: Meilisearch with OpenAI embeddings
- **Caching**: Redis
- **Deployment**: Docker + Docker Compose
- **Authentication**: JWT + API Keys
- **Frontend**: Vue 3 + Vuetify 3
- **AI Integration**: OpenAI, Anthropic, Google AI
- **Protocol**: MXP 2.0 for optimization
- **Encryption**: AES-256-GCM

## Support & Resources

- **📖 Full Documentation**: Browse sections above
- **💻 GitHub Repository**: [Create an issue](https://github.com/BradA1878/model-exchange-framework/issues)
- **🎯 Examples**: See [Example Projects](./examples/first-contact.md) documentation
- **📝 Getting Started**: [Complete guide](./getting-started.md)

## Next Steps

**For Developers:**
1. Follow the [Getting Started Guide](./getting-started.md)
2. Explore [SDK Documentation](./sdk/index.md)
3. Review [Code Examples](./sdk/examples.md)
4. Learn [MXP 2.0 Protocol](./mxf/mxp-protocol.md)

**For Product Teams:**
1. Review [System Overview](./mxf/system-overview.md)
2. Understand [Key Concepts](./mxf/key-concepts.md)
3. Explore [Real-World Use Cases](./use-cases.md)
4. Review [Enterprise Features](./mxf/security.md)
