# Model Exchange Framework (MXF) Documentation

Welcome to the comprehensive technical documentation for the Model Exchange Framework (MXF). This documentation is designed to help developers, product teams, and contributors understand, use, and extend the MXF platform for building sophisticated multi-agent AI systems.

## Quick Navigation

### 🚀 **New to MXF?**
- **[Getting Started Guide](./getting-started.md)** - Complete introduction with examples
- **[Docker Deployment Guide](./deployment.md)** - Production deployment with Docker

### 📚 **Core Documentation**
- **[SDK Reference](./sdk/index.md)** - TypeScript SDK for building agents
- **[API Reference](./api/index.md)** - REST and WebSocket APIs
- **[Tool Reference](./mxf/tool-reference.md)** - Complete guide to 100+ built-in tools
- **[Core Architecture](./mxf/index.md)** - System design and patterns
- **[Dashboard Guide](./dashboard/index.md)** - Web interface documentation (⚠️ in development)

### 🔍 **Semantic Search & Memory**
- **[Meilisearch Integration Guide](./meilisearch-integration.md)** - Semantic search setup and usage
- **[Docker Deployment](./deployment.md)** - Complete stack deployment

### 🔀 **DAG, Knowledge Graph & ML**
- **[Task DAG & Knowledge Graph](./features/dag-knowledge-graph.md)** - DAG workflows and KG operations
- **[DAG API Tools](./api/dag-tools.md)** - DAG tool reference
- **[Knowledge Graph API Tools](./api/knowledge-graph-tools.md)** - KG tool reference
- **[Memory Utility Learning (MULS)](./mxf/memory-utility-learning.md)** - Q-value weighted memory retrieval
- **[ORPAR-Memory Integration](./mxf/orpar-memory-integration.md)** - Phase-aware memory coupling

### 🤖 **Advanced Systems**
- **[TensorFlow.js Integration](./mxf/index.md#tensorflow)** - On-device ML models
- **[Code Execution](./mxf/code-execution.md)** - Secure sandboxed execution
- **[Workflow System](./mxf/workflow-system.md)** - Sequential, parallel, loop patterns
- **[LSP Integration](./mxf/lsp-integration.md)** - Language Server Protocol bridge
- **[P2P Foundation](./mxf/p2p-foundation.md)** - Decentralized coordination
- **[Nested Learning](./mxf/nested-learning.md)** - Multi-timescale memory
- **[Dynamic Inference Parameters](./mxf/dynamic-inference-parameters.md)** - Complexity-based model selection
- **[TOON Optimization](./mxf/toon-optimization.md)** - Token-optimized encoding
- **[Prompt Auto-Compaction](./mxf/prompt-auto-compaction.md)** - Automatic prompt compression

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
- **Hybrid Tool System**: 100+ built-in tools plus external MCP server integration (including 3 memory search tools)
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
- **Error Prediction**: ML-based error prediction using a TF.js Dense classifier when `TENSORFLOW_ENABLED=true`, with heuristic fallback when disabled
- **Anomaly Detection**: TF.js autoencoder (12->8->4->8->12) detects parameter anomalies via reconstruction error when `TENSORFLOW_ENABLED=true`, with heuristic distance-based isolation score fallback when disabled
- **Configurable Security**: Four security levels (standard → enhanced → regulated → classified)
- **TensorFlow.js Integration**: On-device ML models for error prediction (Phase 2 Dense classifier), anomaly detection (Phase 3 autoencoder), and knowledge graph embeddings (opt-in via `TENSORFLOW_ENABLED=true`)

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

## What's New in MXF (Q1 2026)

### Task DAG & Knowledge Graph

MXF now includes a **Task DAG** system for defining complex task dependencies with automatic topological ordering and parallel execution, plus a **Knowledge Graph** for entity-relationship modeling with traversal queries and TransE embeddings.

📖 **[Task DAG & Knowledge Graph Guide →](./features/dag-knowledge-graph.md)**

### Memory Utility Learning System (MULS)

The **MULS** system adds Q-value weighted memory retrieval with ORPAR phase-specific lambdas, retroactive reward propagation, and memory strata (episodic, semantic, procedural).

📖 **[MULS Guide →](./mxf/memory-utility-learning.md)** | **[ORPAR-Memory Integration →](./mxf/orpar-memory-integration.md)**

### Advanced Feature Systems

- **[Workflow System](./mxf/workflow-system.md)** - Sequential, parallel, and loop workflow patterns
- **[LSP Integration](./mxf/lsp-integration.md)** - Language Server Protocol bridge for code intelligence
- **[Nested Learning](./mxf/nested-learning.md)** - Multi-timescale memory consolidation
- **[P2P Foundation](./mxf/p2p-foundation.md)** - Decentralized agent coordination
- **[Code Execution](./mxf/code-execution.md)** - Secure Docker sandboxed execution
- **[Dynamic Inference Parameters](./mxf/dynamic-inference-parameters.md)** - Complexity-based model selection
- **[TOON Optimization](./mxf/toon-optimization.md)** - Token-optimized encoding
- **[Prompt Auto-Compaction](./mxf/prompt-auto-compaction.md)** - Automatic prompt compression
- **[Database Abstraction](./mxf/database-abstraction.md)** - Swappable database backends

### TensorFlow.js Integration

MXF now includes an opt-in **TensorFlow.js integration** for on-device machine learning:

**Phase 1 -- Foundation Layer (MxfMLService):**
- **MxfMLService Singleton**: Manages TF.js model lifecycle (register, build, train, predict, save/load)
- **7 Model Architectures**: Dense classifiers, autoencoders, LSTMs, DQNs, regression, embeddings, TransE knowledge graph embeddings
- **Safe Inference API**: `predict()` and `predictBatch()` encapsulate `tf.tidy()` -- consumers receive plain `number[]` values, never touching tensors
- **Custom Training Loops**: `trainCustom()` supports contrastive loss, experience replay, and margin-based ranking
- **Anomaly Detection**: `predictWithReconstruction()` for autoencoder-based anomaly scoring via reconstruction error
- **GridFS Model Persistence**: Models saved/loaded to MongoDB GridFS (production) or filesystem (development)
- **Tensor Memory Monitoring**: Periodic `tf.memory()` logging with `MEMORY_WARNING` events when usage exceeds threshold
- **Graceful Degradation**: Heuristic fallback when TF.js is disabled or models are untrained -- zero overhead when feature flag is off
- **10 Typed Events**: Full observability via model lifecycle, inference, and memory events

**Phase 2 -- Error Prediction (PredictiveAnalyticsService):**
- **Real TF.js Error Prediction Model**: Dense(12->32->16->1) binary classifier with binary cross-entropy loss replaces the heuristic-only prediction when `TENSORFLOW_ENABLED=true`
- **12-Feature Input Vector**: Tool complexity, parameter count, pattern match, agent experience, error rate, time-of-day, day-of-week, system load, concurrent requests, recent errors, recent successes, average latency
- **Automatic Training**: Collects labeled training data from tool execution results; trains via `MxfMLService.train()` when 100+ samples are available (batch size 32, 10 epochs, 0.2 validation split)
- **Auto-Retrain Scheduling**: Retraining managed by `MxfMLService.scheduleRetrain()` with configurable intervals
- **Three-Tier Fallback**: TF.js model inference -> heuristic rule-based prediction -> conservative default (30% error probability, 50% confidence)
- **INFERENCE_FALLBACK Events**: Emitted when falling back to heuristic, enabling monitoring of model readiness
- **Model Persistence**: Trained model saved to/loaded from GridFS automatically

**Phase 3 -- Anomaly Detection Autoencoder (PredictiveAnalyticsService):**
- **TF.js Autoencoder Model**: Architecture `input(12) -> Dense(8, relu) -> Dense(4, relu) -> Dense(8, relu) -> Dense(12, linear)` with MSE loss and Adam optimizer (lr=0.001)
- **Encoder-Decoder Design**: Encoder compresses the 12-feature vector to a 4-dimensional bottleneck; decoder reconstructs the original input. Normal patterns reconstruct well; anomalies produce high reconstruction error
- **Same 12-Feature Input Vector**: Reuses the error prediction feature vector for consistency across models
- **Unsupervised Training**: Trains on ALL collected feature vectors (input = output) -- no labels needed. Learns "normal" parameter patterns regardless of error outcomes (minimum 100 samples, batch size 32, 20 epochs, 0.1 validation split)
- **Anomaly Scoring**: MSE between input and reconstruction, normalized to 0-1 via scale factor of 10 (calibrated so MSE ~0.08 maps to the 0.8 anomaly threshold)
- **Graceful Degradation**: TF.js autoencoder -> heuristic distance-based isolation score when TF.js is disabled or autoencoder is untrained
- **INFERENCE_FALLBACK Events**: Emitted when falling back to heuristic, enabling monitoring of autoencoder readiness
- **Model Persistence**: Trained autoencoder saved to/loaded from GridFS automatically

**Quick Start:**
```bash
# Start server with TensorFlow.js enabled
TENSORFLOW_ENABLED=true bun run dev

# Run the TensorFlow.js demo
bun run demo:tensorflow
```

### 🔍 Semantic Search & Memory

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
- **MXF Server**: Bun application server (Port 3001)
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
- **ML Error Prediction**: TF.js Dense(12->32->16->1) classifier predicts and prevents failures (heuristic fallback when TF.js is disabled)
- **ML Anomaly Detection**: TF.js autoencoder (12->8->4->8->12) detects unusual parameter patterns via reconstruction error (heuristic fallback when TF.js is disabled)
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
bun run docker:up

# Check service health
bun run docker:health
```

📖 **[Complete Docker Deployment Guide →](./deployment.md)**

**Option B: Local Development**

```bash
git clone https://github.com/BradA1878/model-exchange-framework
cd model-exchange-framework
bun install
bun run build
bun run start
```

### Your First Agent

```typescript
// Import from the SDK (use relative path within the monorepo)
import { MxfSDK, LlmProviderType } from './src/sdk/index';

// Initialize SDK with Personal Access Token (recommended)
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_DEMO_ACCESS_TOKEN!
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

MXF includes 20 comprehensive demos and examples:

```bash
# Strategy & Collaboration
bun run demo:first-contact       # First contact scenario (6 agents)
bun run demo:fog-of-war          # Strategy game with 8 agents
bun run demo:interview           # Interview scheduling

# Memory & Learning
bun run demo:orpar-memory        # ORPAR-Memory integration
bun run demo:muls                # Memory Utility Learning System
bun run demo:nested-learning     # Nested learning / continuum memory
bun run demo:memory-strata       # Memory strata demo

# Advanced Features
bun run demo:dag                 # Task DAG workflows
bun run demo:kg                  # Knowledge Graph operations
bun run demo:tensorflow          # TensorFlow.js ML models (requires TENSORFLOW_ENABLED=true)
bun run demo:code-execution      # Sandboxed code execution
bun run demo:workflow-patterns   # Workflow system patterns
bun run demo:lsp-code-intelligence  # LSP integration
bun run demo:p2p-task-negotiation   # P2P task negotiation

# Optimization
bun run demo:toon-optimization   # TOON encoding
bun run demo:prompt-compaction   # Prompt auto-compaction
bun run demo:inference-params    # Dynamic inference parameters
bun run demo:mcp-prompts         # MCP prompt templates

# SDK Patterns
bun run demo:external-mcp        # External MCP server registration
bun run demo:channel-mcp         # Channel-scoped MCP registration
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

- **Runtime**: Bun with TypeScript
- **API Framework**: Express.js
- **Real-Time**: Socket.IO
- **Database**: MongoDB with Mongoose
- **Search Engine**: Meilisearch with OpenAI embeddings
- **Caching**: Redis
- **Deployment**: Docker + Docker Compose
- **Authentication**: JWT + API Keys
- **Frontend**: Vue 3 + Vuetify 3
- **AI Integration**: OpenAI, Anthropic, Google AI
- **Machine Learning**: TensorFlow.js (opt-in) for on-device ML models
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
