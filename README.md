# Model Exchange Framework (MXF)

Author: [Brad Anderson](brada1878@gmail.com)
Copyright 2024 Brad Anderson

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](http://www.apache.org/licenses/LICENSE-2.0)
[![Version](https://img.shields.io/badge/version-0.47.4-blue.svg)](https://github.com/BradA1878/model-exchange-framework)
[![Node.js](https://img.shields.io/badge/node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)


---

📚 **[Read the Full Technical Documentation (API, Dashboard, SDK, Architecture)](docs/index.md)**

---

A sophisticated framework for **autonomous multi-agent collaboration**, communication, and tool execution. MXF enables intelligent agents to work together naturally through goal-oriented task prompting, real-time messaging protocols, intelligent tool discovery, and task completion coordination.

## 🌟 Features

### 🎉 **Autonomous Multi-Agent Collaboration** 🚀
- **Goal-Oriented Task Prompting**: Simplified, natural task descriptions that encourage agent creativity and autonomy
- **Intelligent Messaging Protocols**: Clear messaging_send patterns for reliable problem distribution and solution exchange
- **MXP Protocol Support**: Efficient bandwidth usage with encrypted, structured agent communication
- **Natural Task Completion**: Agents recognize completion conditions and signal task completion decisively
- **Cross-Agent Tool Discovery**: Agents dynamically discover and recommend tools for collaborative problem-solving
- **Autonomous Math Collaboration**: System for complex mathematical problem solving across multiple agents
- **Zero-Micromanagement Design**: Agents work naturally without rigid step-by-step constraints

### 🤖 **Multi-Agent Architecture**
- **Real-time Communication**: Socket.IO-based instant messaging between agents
- **Agent Discovery**: Automatic agent registration and capability broadcasting
- **Channel-based Organization**: Organize agents into focused collaboration channels
- **Rich Agent Profiles**: Detailed agent metadata, capabilities, and role definitions

### 🛠️ **Hybrid Tool System**
- **100+ Built-in Tools**: Comprehensive tool library across 11 categories including memory search, analytics, coordination, and more - See [Tool Reference](docs/mxf/tool-reference.md)
- **External MCP Server Integration**: Support for Model Context Protocol servers
- **Channel-Scoped MCP Servers**: Register MCP servers available only within specific channels
- **Channel-Level Tool Access Control**: Restrict which tools are available per channel using `allowedTools`
- **Dynamic Tool Discovery**: Real-time tool registration and capability updates
- **Unified Tool Execution**: Routing between internal and external tools
- **Intelligent Validation**: Pre-execution validation with low latency
- **Auto-Correction Engine**: Automatic parameter correction and error recovery
- **ML-based Error Prediction**: Proactive error prevention and pattern learning

### 🧠 **ORPAR Control Loop**
- **Observation**: Environmental awareness and context gathering
- **Reasoning**: LLM-powered logical analysis and decision making
- **Planning**: Comprehensive goal decomposition and workflow creation
- **Action**: Strategic action planning with dependency tracking  
- **Reflection**: Deep analytical review of completed actions

### 🔌 **LLM Integration**
- **SystemLlmService**: Unified LLM operations across multiple providers
- **Model-Specific Optimization**: Different models for different cognitive tasks
- **Real-time Processing**: Observable-based reactive LLM operations
- **Fallback Mechanisms**: Robust error handling with graceful degradation

### 📊 **Infrastructure**
- **MongoDB Integration**: Persistent storage for tools, agents, and conversations
- **Meilisearch Integration**: Semantic search engine with OpenAI embeddings for efficient context retrieval
- **Redis Caching**: High-performance multi-level caching (Memory → Redis → MongoDB)
- **n8n Workflow Automation**: Optional integration (requires self-hosted or n8n Cloud instance)
- **Docker Deployment**: Docker Compose stack with core services
- **Event-Driven Architecture**: RxJS-powered reactive event system
- **Authentication**: Dual authentication (JWT for users, key-based for agents)
- **Production Monitoring**: Comprehensive logging and performance tracking
- **Advanced Analytics**: Real-time validation metrics, trend analysis, and ROI calculation
- **Performance Optimization**: Automated bottleneck detection and parameter tuning
- **Proactive Validation**: Pre-execution validation middleware with low latency
- **Error Recovery System**: Intelligent auto-correction with pattern learning
- **MXP Protocol**: Efficient binary protocol with AES-256-GCM encryption for secure agent communication

### 🧠 **SystemLLM & ORPAR Integration**

The SystemLlmService is a cornerstone of MXF's intelligent agent capabilities, providing sophisticated LLM integration throughout the ORPAR (Observation, Reasoning, Planning, Action, Reflection) cognitive cycle:

#### **ORPAR Lifecycle Integration**
- **Observation**: Generates contextual environmental analysis using agent conversation history and channel state
- **Reasoning**: Performs multi-step logical analysis using specialized thinking models for complex problem decomposition  
- **Action**: Creates strategic action plans with dependency tracking and resource allocation
- **Planning**: Comprehensive goal decomposition with milestone tracking and success criteria
- **Reflection**: Deep analytical review of completed actions with learning integration and performance insights

#### **Model-Agnostic Architecture**
- **Provider Flexibility**: Works with any LLM provider (OpenRouter, OpenAI, Anthropic, local models)
- **Strategic Model Selection**: Different models optimized for different cognitive tasks (fast models for reasoning, comprehensive models for reflection)
- **Fallback Mechanisms**: Robust error handling with graceful degradation when LLM services are unavailable
- **Observable Streams**: RxJS-based reactive processing for real-time ORPAR event handling

#### **Agent Intelligence Enhancement**
- **Context-Aware Processing**: Rich agent context integration with capabilities, metadata, and conversation history
- **Coordination Analysis**: Multi-agent collaboration pattern detection and optimization suggestions
- **Tool Recommendation**: Intelligent tool selection based on agent objectives and current context
- **Adaptive Behavior**: Learning from interaction patterns to improve future agent performance

### 🎯 **Meta-Tool Intelligence System**

MXF includes sophisticated meta-tools that provide intelligent tool discovery and recommendation capabilities:

#### **`tools_recommend` - Intelligent Tool Selection**
- **Context Analysis**: Analyzes agent objectives, conversation history, and current task context
- **Capability Matching**: Maps agent needs to optimal tool combinations from available tools
- **Cross-Domain Intelligence**: Discovers tool synergies across communication, control loop, memory, and infrastructure categories
- **LLM-Powered Insights**: Uses SystemLlmService to generate contextual recommendations with confidence scoring

#### **Benefits of Meta-Tool System**
- **Reduced Discovery Time**: Agents quickly find relevant tools without manual exploration
- **Optimal Tool Selection**: AI-powered recommendations improve task execution efficiency  
- **Learning Integration**: Recommendations improve based on successful tool usage patterns
- **Cross-Agent Intelligence**: Shares successful tool combinations across the agent ecosystem
- **Dynamic Adaptation**: Recommendations adapt as new tools are added to the registry

### 🛡️ **Advanced Validation & Error Prevention System**

MXF includes a comprehensive validation and auto-correction system that prevents errors before they occur and automatically recovers from failures:

#### **Proactive Validation Engine**
- **Pre-execution Validation**: All tool calls validated before execution with low latency
- **Risk-based Validation Levels**: ASYNC, BLOCKING, and STRICT validation modes based on operation risk
- **Multi-layer Caching**: Memory, Redis, and MongoDB caching for optimal performance
- **Pattern-based Validation**: Uses successful patterns from other agents for validation

#### **Intelligent Auto-Correction**
- **Automatic Parameter Correction**: Fixes common parameter errors using learned patterns
- **Error Recovery Strategies**: Multiple correction approaches for different error types
- **Loop Prevention**: Advanced guards prevent infinite retry loops
- **Safe Correction Validation**: All corrections validated for safety before application

#### **Pattern Learning & Cross-Agent Intelligence**
- **Parameter Pattern Storage**: MongoDB-based storage of successful parameter combinations
- **Cross-Agent Learning**: Patterns shared across agents within channels for collaborative improvement
- **Pattern Evolution**: Tracks pattern success over time with confidence scoring
- **Intelligent Recommendations**: Uses learned patterns to suggest corrections and prevent errors

#### **Advanced Analytics & Optimization**
- **Real-time Metrics**: Validation success rates, error prevention counts, auto-correction rates
- **Trend Analysis**: Statistical analysis with forecasting and seasonality detection
- **A/B Testing Framework**: Test validation configurations with statistical significance
- **ROI Calculation**: Quantify the business value of error prevention and time savings
- **Performance Optimization**: Automated bottleneck detection and parameter tuning

### 🔐 **MXP (Model Exchange Protocol)**

MXP is a groundbreaking protocol that dramatically improves agent-to-agent communication efficiency while maintaining security and backward compatibility:

#### **Key Benefits**
- **Bandwidth Efficiency**: Structured messages replace verbose natural language
- **Fast Parsing**: Binary format eliminates ambiguity and parsing overhead
- **End-to-End Encryption**: AES-256-GCM encryption for sensitive agent communications
- **Automatic Conversion**: Intelligent detection converts suitable messages to MXP format
- **Backward Compatible**: Agents can send/receive both MXP and natural language

#### **Protocol Features**
- **Message Types**: Operations, reasoning, coordination, tasks, and responses
- **Smart Detection**: Automatically identifies convertible message patterns
- **Statistics Tracking**: Real-time monitoring of protocol usage and efficiency
- **Flexible Configuration**: Per-agent control over MXP behavior
- **Key Management**: Built-in utilities for secure key generation

#### **Quick MXP Setup**
```bash
# Generate encryption keys
npm run mxp:generate-key

# Add to .env
MXP_ENCRYPTION_KEY=your-generated-key
MXP_ENCRYPTION_ENABLED=true
```

```typescript
// Enable in agents
const agent = await sdk.createAgent({
    // ... other config
    mxpEnabled: true,
    mxpPreferredFormat: 'auto'
});
```

📖 **[Complete MXP Protocol Guide](docs/mxf/mxp-protocol.md)**

### 🎯 **Task Management & Orchestration**

MXF provides a comprehensive task management system that enables intelligent coordination of work across multiple agents with autonomous collaboration patterns and SystemLLM-powered optimization:

#### **Autonomous Task Coordination**
- **Natural Collaboration Patterns**: Agents coordinate using goal-oriented task prompts without micromanagement
- **Intelligent Messaging Protocols**: Clear communication patterns for problem distribution, solution exchange, and completion signaling
- **Dynamic Role Assignment**: Flexible completion agent designation with both automatic and manual assignment modes
- **Real-Time Task Completion**: Agents recognize completion conditions and signal task completion decisively

#### **Intelligent Task Assignment**
- **SystemLLM Integration**: AI-powered task assignment based on agent capabilities and workload analysis
- **Capability Matching**: Automatic assignment of tasks to agents with optimal skill sets
- **Confidence Scoring**: Task assignments include confidence levels and reasoning for transparency
- **Multi-Agent Coordination**: Support for tasks requiring collaboration between multiple agents

#### **Task Lifecycle Management**
- **Complete Workflow**: Task creation → Intelligent assignment → Execution → Completion tracking
- **Event-Driven Architecture**: Real-time task status updates via Socket.IO event system
- **Flexible Payload Handling**: Robust event processing supporting various payload structures
- **Fail-Fast Validation**: Strict validation with comprehensive error handling and debugging

#### **Workload Analysis & Optimization**
- **Real-Time Monitoring**: Live workload analysis across channels and agents
- **Performance Metrics**: Task throughput, completion times, and agent utilization tracking
- **Overload Detection**: Automatic identification of overloaded agents with rebalancing suggestions
- **Assistance Coordination**: Intelligent matching of helper agents for struggling workloads

#### **Task Orchestration Features**
- **Channel-Aware Assignment**: Tasks assigned within specific agent channels for focused collaboration
- **Database Persistence**: Complete task history with MongoDB integration for analytics
- **REST API Integration**: HTTP endpoints for external task creation and management
- **Production Monitoring**: Comprehensive logging and performance tracking for enterprise deployment

### 🔍 **Semantic Memory & Search**

MXF integrates Meilisearch, an open-source semantic search engine, to provide intelligent memory retrieval:

#### **Key Benefits**
- **Efficient Context Retrieval**: Semantic search reduces context size by retrieving only relevant information
- **Extended Memory**: Search entire conversation history beyond sliding window limits
- **Hybrid Search**: Configurable keyword + semantic search (default 70% semantic, 30% keyword)
- **Cross-Channel Intelligence**: Discover patterns and learnings across all agent conversations
- **Tool Usage History**: Semantic search through all tool executions and outcomes

#### **Meilisearch Features**
- **Four Specialized Indexes**: Conversations, actions, patterns, and observations
- **OpenAI Embeddings**: Using text-embedding-3-small (1536 dimensions) for semantic understanding
- **Fast Search**: Optimized for real-time agent queries
- **Automatic Indexing**: Dual-write pattern indexes all conversations and tool usage
- **Docker Deployment**: Docker Compose deployment with health monitoring

#### **Memory Search Tools**
```typescript
// Search conversation history semantically
const results = await agent.executeTool('memory_search_conversations', {
  query: 'authentication implementation discussion',
  channelId: 'dev-channel',
  limit: 5,
  hybridRatio: 0.7
});

// Search tool usage patterns
const actions = await agent.executeTool('memory_search_actions', {
  query: 'send message to AgentB',
  successOnly: true,
  limit: 10
});

// Discover cross-channel patterns
const patterns = await agent.executeTool('memory_search_patterns', {
  intent: 'multi-agent coordination workflow',
  minEffectiveness: 0.8,
  crossChannel: true
});
```

📖 **[Complete Meilisearch Integration Guide](docs/meilisearch-integration.md)**
📖 **[Docker Deployment Guide](docs/deployment.md)**

## 📚 API Documentation

### 🚀 **Complete REST APIs**

MXF provides comprehensive REST APIs for complete framework management:

#### **APIs**
**[📖 Complete API Documentation →](./docs/api/index.md)**

#### **API Status Dashboard**
| API Category | Status | CRUD Complete | Real Data | Documentation |
|-------------|--------|---------------|-----------|---------------|
| **Channels** | 🟢 PRODUCTION | ✅ | ✅ | ✅ |
| **Agents** | 🟢 PRODUCTION | ✅ | ✅ | ✅ |
| **Tasks** | 🟢 PRODUCTION | ✅ | ✅ | ✅ |
| **Memory** | 🟢 PRODUCTION | ✅ | ✅ | ✅ |
| **Users** | 🟢 PRODUCTION | ✅ | ✅ | ✅ |
| **MCP** | 🟢 PRODUCTION | ✅ | ✅ | ✅ |

---

## 🔧 Available Tools

### Communication & Discovery (8 tools)
- Agent discovery and capability querying
- Channel management and message routing
- Real-time status monitoring

### Control Loop Operations (4 tools)
- ORPAR cycle execution and management
- Plan creation and action tracking
- Reflection generation and analysis

### Task Management (9 tools)
- Task creation and lifecycle management
- Intelligent task assignment with SystemLLM
- Workload analysis and optimization
- Multi-agent coordination and assistance
- Task orchestration and monitoring

### Context & Memory (9 tools)
- Conversation summarization and topic extraction
- Memory storage and retrieval operations
- Context-aware information processing
- Semantic conversation search across entire history
- Tool usage pattern discovery and analysis
- Cross-channel pattern recognition and learning

### Infrastructure (6 tools)
- Framework status and health monitoring
- Performance metrics and diagnostics
- Configuration management
- File system operations and shell access

### Meta-Tools & Validation (8 tools)
- Enhanced tool recommendation with validation insights
- Error recovery assistance and parameter correction
- Pre-execution validation and risk assessment
- ML-based error prediction and prevention
- Real-time parameter hints and auto-completion
- Advanced error diagnosis and analysis

### Analytics & Optimization (6 tools)
- Real-time validation metrics and trend analysis
- Performance bottleneck detection and tuning
- A/B testing framework for validation strategies
- ROI calculation and business value metrics
- Predictive analytics and anomaly detection
- Automated optimization recommendations

### External MCP Servers (43 tools)
- **Calculator Server**: Advanced mathematical operations
- **Memory Server**: Knowledge graph operations  
- **Filesystem Server**: File system interactions
- **MongoDB Lens**: Database analysis and optimization
- **Sequential Thinking**: Structured problem solving

## 🚀 Quick Start

### Prerequisites

**Option A: Docker (Recommended for Production)**
- **Docker 24.0+** and **Docker Compose 2.0+**
- **OpenAI API Key** (for embeddings)
- **LLM Provider API Key** (optional, for LLM-powered agents)

**Option B: Local Development**
- **Node.js 18+**
- **MongoDB** (local or cloud instance)
- **LLM Provider API Key** (optional, for LLM-powered agents) - Choose from:
  - [OpenRouter](https://openrouter.ai/) - Access to 200+ models
  - [OpenAI](https://platform.openai.com/) - GPT models
  - [Anthropic](https://console.anthropic.com/) - Claude models
  - [Google AI](https://ai.google.dev/) - Gemini models
  - [xAI](https://x.ai/) - Grok models
  - Azure OpenAI - Enterprise GPT
  - [Ollama](https://ollama.ai/) - Local models (no API key needed)

### Installation

**Option A: Docker Deployment (Recommended)**

```bash
# Clone the repository
git clone https://github.com/BradA1878/model-exchange-framework
cd model-exchange-framework

# Copy environment template
cp .env.example .env

# Generate secure keys
openssl rand -base64 32  # MEILISEARCH_MASTER_KEY
openssl rand -base64 64  # JWT_SECRET
openssl rand -base64 32  # AGENT_API_KEY

# Edit .env and set:
# - MEILISEARCH_MASTER_KEY
# - JWT_SECRET
# - AGENT_API_KEY
# - OPENAI_API_KEY (for embeddings)
# - OPENROUTER_API_KEY (optional, for SystemLLM)
nano .env

# Deploy full stack (MXF + MongoDB + Meilisearch + Redis + Dashboard)
npm run docker:up

# View logs
npm run docker:logs

# Check service health
npm run docker:health
```

**Services deployed:**
- MXF Server: `http://localhost:3001`
- Dashboard: `http://localhost:5173`
- Meilisearch: `http://localhost:7700`
- MongoDB: `localhost:27017`
- Redis: `localhost:6379`

📖 **[Complete Docker Deployment Guide](docs/deployment.md)**

**Option B: Local Development**

```bash
# Clone the repository
git clone https://github.com/BradA1878/model-exchange-framework
cd model-exchange-framework

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Add your LLM provider API key to .env:
# See .env.example for all supported providers

# Build the project
npm run build

# Start development server
npm run start:dev
```

### 🖥️ **Dashboard Interface**

> ⚠️ **Note:** The Dashboard is currently in development. Some features may be incomplete.

MXF includes a modern Vue 3 dashboard for managing channels, agents, analytics, and more:

```bash
# Start the MXF server (port 3001)
npm run start:dev

# In another terminal, start the dashboard (port 5173)
cd dashboard
npm install
npm run dev
```

**Dashboard Features:**
- **Channel Management**: Create and manage collaboration channels
- **Real-time Analytics**: View system performance and agent metrics
- **Document Management**: Upload and organize documents across channels  
- **Context Management**: Handle channel context data with full CRUD operations
- **User Authentication**: Secure magic link authentication
- **Data Export**: Export analytics data as CSV files
- **Validation Analytics**: Monitor validation success rates and error prevention
- **Auto-Correction Dashboard**: Track correction attempts and success patterns
- **Performance Optimization**: View bottlenecks and optimization recommendations
- **Error Prediction Monitoring**: ML model accuracy and prediction effectiveness

📖 **[Complete Dashboard Documentation](dashboard/README.md)**

### 🎬 **Run Multi-Agent Demos**

#### First Contact Demo
**Experience 6 AI agents collaborating in real-time for a first contact scenario:**

```bash
# Start the MXF server (in one terminal)
npm run start:dev

# Run the first contact demo (in another terminal)
npm run demo:first-contact
```

#### Software Development Team Demo
**Watch a realistic dev team build a web application with varying skill levels:**

```bash
# Start the MXF server (in one terminal)
npm run start:dev

# Run the software dev team demo (in another terminal)
npx tsx examples/software-dev-team/software-dev-team.ts
```

#### MXP Protocol Demo
**See the efficiency gains of MXP protocol in action:**

```bash
# Start the MXF server (in one terminal)
npm run start:dev

# Run the MXP demo (in another terminal)
npm run demo:mxp

# Commands in demo:
# - sum 10 20 30      (sends MXP calculation)
# - average 5 10 15   (sends MXP average)
# - stats             (view protocol statistics)
```

**What you'll see in First Contact:**
- **Commander Kane**: Leading the first contact mission
- **Dr. Chen**: Analyzing alien technology
- **Lt. Rodriguez**: Providing tactical assessments
- **Ensign Park**: Managing communications
- **Dr. Xenara**: Translating alien language
- **Commander Zenth**: Sending symbolic messages

**What you'll see in Software Dev Team:**
- **Sarah (PM)**: Managing sprint and tracking progress
- **Alex (Architect)**: Designing system architecture
- **David (Senior)**: Writing complex code and mentoring
- **Emma (Mid-Level)**: Building features collaboratively
- **Charlie (Junior)**: Learning and trying creative solutions (with realistic mistakes!)

**✨ Clean, professional output with sophisticated cross-agent messaging!**

### 🎯 **What Makes This Special**

**Reliable Queue System**: Our LLM provider integrations use a request queue that eliminates JSON parsing errors and enables robust multi-agent coordination.

**Clean Logging Architecture**: Separate client/server logging pathways provide clean demo output while maintaining full debugging capabilities when needed.

**Real Autonomous Collaboration**: Agents truly work together - no simulation, no smoke and mirrors. They discover each other, exchange messages, and complete tasks naturally.

### 🎨 **Example Demos**

Explore our collection of multi-agent demos in the `/examples` directory:

**Strategy & Collaboration:**
- **First Contact Demo**: Starship crew encounters alien vessel (6 agents)
- **Software Dev Team Demo**: PM, architect, and developers build web app (5 agents with varying skill levels)
- **Interview Scheduling Demo**: Multi-agent coordination for scheduling

**AI Game Demos:**
- **Fog of War Game**: Team strategy game with 8 AI commanders competing for resources
- **Tic-Tac-Toe**: AI vs AI with personality-driven trash talk (2 agents)
- **Go Fish**: Card game with memory, strategy, and character personalities (2 agents)

**SDK Patterns:**
- **Channel MCP Registration**: Example of channel-scoped MCP server registration
- **External MCP Registration**: Example of global MCP server registration

```bash
# Run game demos
npm run demo:fog-of-war    # Strategy game with 8 agents
npm run demo:tic-tac-toe   # Quick AI vs AI game
npm run demo:go-fish       # Card game with 2 agents
```

### 🧪 **Other Ways to Explore MXF**

```bash
# Explore the codebase
npm run start:dev                 # Start development server
# Then connect your own agents using the MXF SDK

# View interactive architecture diagram
open docs/diagram/mxf-architecture.html
```

### Environment Configuration

```env
# Database
MONGODB_URI=mongodb://localhost:27017/mxf

# Authentication
JWT_SECRET=your_jwt_secret_key
AGENT_API_KEY=your_agent_api_key

# Meilisearch (Required for semantic search)
MEILISEARCH_MASTER_KEY=your_secure_meilisearch_master_key
MEILISEARCH_HOST=http://localhost:7700
ENABLE_MEILISEARCH=true
ENABLE_SEMANTIC_SEARCH=true
MEILISEARCH_HYBRID_RATIO=0.7
MEILISEARCH_EMBEDDING_MODEL=text-embedding-3-small
MEILISEARCH_EMBEDDING_DIMENSIONS=1536
MEILISEARCH_BATCH_SIZE=100

# LLM Provider API Keys
# OpenAI - Required for embeddings if ENABLE_SEMANTIC_SEARCH=true
OPENAI_API_KEY=sk-your-openai-key

# Additional LLM Providers (Optional - choose your provider)
# OpenRouter - Access to 200+ models
# OPENROUTER_API_KEY=your-openrouter-key
# Anthropic - Claude models
# ANTHROPIC_API_KEY=your-anthropic-key
# Google AI - Gemini models
# GOOGLE_AI_API_KEY=your-google-key
# xAI - Grok models
# XAI_API_KEY=your-xai-key
# Ollama - Local models
# OLLAMA_BASE_URL=http://localhost:11434
# Azure OpenAI - Enterprise GPT
# AZURE_OPENAI_API_KEY=your-azure-key
# AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/

# SystemLLM Configuration (for ORPAR control loop, pattern learning, coordination)
SYSTEMLLM_ENABLED=true
SYSTEMLLM_PROVIDER=openrouter  # Options: openrouter, azure-openai, openai, anthropic, gemini, xai, ollama
# SYSTEMLLM_DEFAULT_MODEL=google/gemini-2.5-flash  # Optional model override
SYSTEMLLM_DYNAMIC_MODEL_SELECTION=true  # Enable complexity-based model switching (recommended for OpenRouter)

# MXP Protocol (Optional - for efficient agent communication)
MXP_ENCRYPTION_KEY=your_secure_key_here
MXP_ENCRYPTION_ENABLED=true

# Server Configuration
PORT=3001
NODE_ENV=development

# Validation System (Optional - for enhanced validation features)
VALIDATION_DEFAULT_LEVEL=ASYNC
VALIDATION_MAX_LATENCY=50
VALIDATION_CACHE_ENABLED=true

# Auto-Correction System (Optional)
AUTO_CORRECTION_ENABLED=true
AUTO_CORRECTION_MAX_RETRIES=3
AUTO_CORRECTION_CONFIDENCE_THRESHOLD=0.7

# Analytics & Optimization (Optional)
ANALYTICS_AGGREGATION_INTERVAL=60000
ANALYTICS_RETENTION_DAYS=90
OPTIMIZATION_AUTO_TUNE=true
```

## 🏗️ Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                      MXF Framework                          │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Agent SDK     │   Server Core   │   External MCP Servers  │
│                 │                 │                         │
│ • Agent Client  │ • Socket.IO     │ • Calculator Server     │
│ • Tool Executor │ • REST API      │ • Memory Server         │
│ • Event System  │ • Auth System   │ • Filesystem Server     │
│ • Control Loop  │ • Tool Registry │ • MongoDB Lens          │
│ • Validation    │ • LLM Service   │ • Sequential Thinking   │
│                 │                 │                         │
│ Validation Layer│ Validation Core │ Analytics & Optimization│
│ • Pre-execution │ • Auto-Correct  │ • ML Predictions        │
│ • Error Prevent │ • Pattern Learn │ • Performance Tuning   │
│ • Risk Scoring  │ • Cache System  │ • A/B Testing          │
└─────────────────┴─────────────────┴─────────────────────────┘
                           │
         ┌─────────────────┴──────────────────┐
         │         Data Layer (Docker)        │
         ├────────────────────────────────────┤
         │ • MongoDB (Persistence)            │
         │ • Meilisearch (Semantic Search)   │
         │ • Redis (Caching)                  │
         └────────────────────────────────────┘
```

### Data Flow

1. **Agent Registration** → Authentication → Channel Assignment
2. **Tool Discovery** → Registry Sync → Capability Broadcasting
3. **Message Exchange** → Event Processing → Real-time Delivery → Meilisearch Indexing
4. **Tool Execution** → Pre-validation → Routing → Internal/External Processing → Action Indexing
5. **Validation Middleware** → Error Prevention → Auto-Correction → Pattern Learning
6. **Control Loop** → ORPAR Cycle → LLM Integration → Reflection
7. **Analytics Pipeline** → Metrics Collection → Trend Analysis → Optimization
8. **Semantic Search** → Query Analysis → Hybrid Search → Context Retrieval

## 📚 Documentation

### Complete Documentation
- **[Full Documentation](docs/index.html)** - Interactive documentation browser
- **[Getting Started Guide](docs/getting-started.md)** - Quick start tutorial
- **[Meilisearch Integration Guide](docs/meilisearch-integration.md)** - Semantic search setup and usage
- **[Docker Deployment Guide](docs/deployment.md)** - Production deployment with Docker
- **[Interactive Architecture Diagram](docs/diagram/mxf-architecture.html)** - Visual system exploration
- **[SDK Documentation](docs/sdk/index.md)** - TypeScript SDK reference
- **[API Documentation](docs/api/index.md)** - REST and WebSocket APIs
- **[Dashboard Documentation](dashboard/README.md)** - Dashboard guide

## License

MXF is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

### Commercial Licensing

For commercial support, enterprise features, or custom licensing arrangements, contact: BradA1878@pm.me

### Why Apache 2.0?

We chose Apache 2.0 to encourage widespread adoption while maintaining the ability to offer commercial services and enterprise features. You're free to use MXF in your products, modify it, and distribute it.

## Author

**Brad Anderson** - Senior TypeScript Developer & AI Systems Architect

Creator of MXF - building the future of multi-agent AI orchestration from the high altitude forests of New Mexico.

- 📧 BradA1878@pm.me
- 💻 [GitHub: @BradA1878](https://github.com/BradA1878)
- 🔗 [LinkedIn](https://linkedin.com/in/BradA1878)
- 🐦 [Twitter: @BradA1878](https://twitter.com/BradA1878)

Currently seeking opportunities to build the next generation of AI infrastructure.

## 📖 Development

### Project Structure

```
src/
├── sdk/                    # Agent SDK and client libraries
├── server/                 # Core server implementation
│   ├── api/               # REST API controllers and services
│   ├── socket/            # Socket.IO services and handlers
│   └── index.ts           # Server entry point
└── shared/                # Shared utilities and types
    ├── mcp/               # MCP tool implementations
    ├── models/            # Data models and schemas
    ├── constants/         # Framework constants
    └── utils/             # Utility functions
```

### Development Workflow

```bash
# Start development server with hot reload
npm run start:dev

# Build for production
npm run build

# Clean build artifacts
npm run clean
```

### Creating Custom Tools

```typescript
import { McpTool } from '../shared/types/McpTool';

export const customTool: McpTool = {
    name: 'custom_operation',
    description: 'Performs a custom operation',
    inputSchema: {
        type: 'object',
        properties: {
            input: { type: 'string', description: 'Input parameter' }
        },
        required: ['input']
    },
    handler: async (args: { input: string }) => {
        // Tool implementation
        return { result: `Processed: ${args.input}` };
    }
};
```

## 🤝 Agent SDK Usage

### Basic Agent Setup

```typescript
import { MxfSDK } from '@mxf/sdk';

// Initialize SDK
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create agent through SDK
const agent = await sdk.createAgent({
    agentId: 'my-agent-01',
    name: 'Data Analyst',
    channelId: 'data-analysis-project',
    keyId: 'key-abc123',
    secretKey: 'secret-xyz789',
    llmProvider: 'openai',
    defaultModel: 'gpt-5.2',
    apiKey: process.env.OPENAI_API_KEY,
    capabilities: ['analysis', 'communication'],
    metadata: {
        role: 'Data Analyst',
        expertise: ['statistics', 'visualization']
    }
});

await agent.connect();

// Execute tools (with automatic validation)
const result = await agent.toolService.executeTool('add', { a: 5, b: 3 });

// Preview validation before execution
const preview = await agent.toolService.executeTool('validation_preview', {
    toolName: 'file_write',
    parameters: { path: '/tmp/test.txt', content: 'Hello' }
});

// Get intelligent tool recommendations
const recommendations = await agent.toolService.executeTool('tools_recommend', {
    intent: 'analyze data and create visualizations',
    includeValidationInsights: true
});

// Send messages to other agents
await agent.sendMessage('analysis-results', { 
    findings: 'Key insights discovered...',
    confidence: 0.85 
});
```

### Autonomous Multi-Agent Collaboration

```typescript
// Create collaborative task for multiple agents
const task = await agent.createTask({
    title: 'Multi-Agent Math Problem Collaboration',
    description: `
        Professor Puzzle: Create a challenging math problem and send it to Professor Calculator via messaging_send.
        When you receive the solution message back, immediately call task_complete.
        
        Professor Calculator: When you receive a math problem message, solve it and send your complete solution 
        back to Professor Puzzle using messaging_send.
    `,
    agents: ['problem-creator-agent', 'mathematician-agent'],
    completionAgent: 'problem-creator-agent'  // Designate completion agent
});

// Agents collaborate autonomously:
// 1. Problem Creator generates complex math problem
// 2. Problem Creator sends problem via messaging_send
// 3. Mathematician receives problem and uses tools_recommend to find calculator tools
// 4. Mathematician solves problem and sends solution via messaging_send
// 5. Problem Creator receives solution and calls task_complete

// Monitor task completion
agent.onTaskCompleted((completedTask) => {
    console.log('Multi-agent collaboration completed successfully!', completedTask);
});
```

### Control Loop Integration

```typescript
// Start ORPAR control loop
const controlLoop = await agent.startControlLoop({
    objective: 'Analyze sales data and generate insights',
    context: { dataSource: 'Q4_sales.csv', priority: 'high' }
});

// Monitor control loop events
agent.onControlLoopEvent((event) => {
    console.log(`Control Loop ${event.phase}: ${event.data}`);
});
```

## 🔐 Security

### Authentication Methods

- **User Authentication**: JWT-based authentication for user interfaces
- **Agent Authentication**: API key-based authentication for programmatic access
- **Channel Security**: Role-based access control for agent channels

### Security Features

- **Input Validation**: Comprehensive validation using Joi schemas
- **SQL Injection Protection**: MongoDB with proper query sanitization
- **Rate Limiting**: Built-in rate limiting for API endpoints
- **Secure Communication**: WebSocket connections with authentication

## 📊 Monitoring & Observability

### Logging

The framework uses a custom logging system for structured application monitoring:

```typescript
// Application logs
logger.info('Agent connected', { agentId, channelId });
logger.error('Tool execution failed', { toolName, error });

// Performance monitoring
logger.debug('LLM processing time', { duration, model, operation });
```

### Metrics

- **Agent Activity**: Connection counts, message rates, tool usage
- **Performance**: Response times, throughput, error rates
- **Resource Usage**: Memory consumption, database queries, LLM calls
- **Validation Metrics**: Success rates, error prevention counts, validation latency
- **Auto-Correction Metrics**: Correction attempts, success rates, pattern effectiveness
- **Predictive Analytics**: Error prediction accuracy, anomaly detection rates, risk scores

## 🛣️ Roadmap

### Current Focus
- Continuous improvement of agent coordination patterns
- Enhanced tool discovery and recommendation algorithms
- Performance optimization and monitoring enhancements

## 📜 License

This project is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)

## 🙏 Acknowledgments

- **Model Context Protocol**: For the foundation of external tool integration
- **OpenRouter**: For providing access to multiple LLM providers
- **Socket.IO**: For real-time communication infrastructure
- **MongoDB**: For robust data persistence and querying

## 📞 Support

For questions, issues, or contributions:

- **Author**: [Brad Anderson](https://brada1878.github.io/model-exchange-framework/)
- **Documentation**: [Full documentation](https://brada1878.github.io/model-exchange-framework/)
- **GitHub Issues**: [Report bugs](https://github.com/BradA1878/model-exchange-framework/issues)
- **Examples**: Check `/examples` directory
- **Architecture**: View the [interactive architecture diagram](./docs/diagram/mxf-architecture.html)

