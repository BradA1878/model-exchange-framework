# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Recent Major Updates

### Meilisearch Semantic Search Integration (Latest)
- **Complete Docker Stack**: Docker Compose deployment with 5 services (MXF + MongoDB + Meilisearch + Redis + Dashboard)
- **Semantic Memory & Search**: Meilisearch integration for intelligent conversation and tool usage retrieval
  - **Efficient Context Retrieval**: Semantic search reduces context size by retrieving only relevant information
  - **Extended Memory**: Search entire conversation history beyond sliding window limits
  - **Hybrid Search**: Configurable keyword + semantic (default 70% semantic, 30% keyword)
  - **Fast Search**: Optimized for real-time agent queries
- **Four Specialized Indexes**: Conversations, actions, patterns, and observations
- **OpenAI Embeddings**: Using text-embedding-3-small (1536 dimensions) for semantic understanding
- **Three New MCP Tools**:
  - `memory_search_conversations` - Semantic search across entire conversation history
  - `memory_search_actions` - Search tool usage patterns and outcomes
  - `memory_search_patterns` - Discover cross-channel patterns and learnings
- **Dual-Write Pattern**: MongoDB for persistence, Meilisearch for search (graceful degradation if Meilisearch fails)
- **Automatic Indexing**: All conversations and tool executions indexed in real-time
- **Production Deployment**:
  - Docker Compose orchestration with health checks
  - One-command deployment via `npm run docker:up`
  - Complete documentation in docs/deployment.md and docs/meilisearch-integration.md

**Key Files**:
- `src/shared/services/MxfMeilisearchService.ts` - Core Meilisearch integration
- `src/shared/protocols/mcp/tools/MemorySearchTools.ts` - 3 new search tools
- `docker-compose.yml` - Complete stack orchestration
- `docs/deployment.md` - Production deployment guide
- `docs/meilisearch-integration.md` - Integration and usage guide

### Advanced Validation & Error Prevention System
- **Proactive Validation Engine**: Pre-execution validation with low latency and risk-based validation levels (ASYNC, BLOCKING, STRICT)
- **Intelligent Auto-Correction**: Automatic parameter correction with loop prevention and pattern learning
- **ML-based Error Prediction**: Error prediction before execution using ensemble models (Random Forest + Gradient Boosting)
- **Enhanced Meta-Tools**: 8 new validation-aware tools including:
  - `tools_recommend` - Enhanced with validation insights, parameter examples, and pattern recommendations
  - `tools_recommend_on_error` - Specialized error recovery assistance with alternative suggestions
  - `validation_preview` - Pre-execution validation results with risk assessment
  - `validation_hints` - IDE-style parameter hints and auto-completion
  - `error_diagnose` - Advanced error analysis with correction suggestions
  - `predict_errors` - ML-based error prediction and prevention strategies
  - `analytics_aggregate` - Validation and performance analytics
  - `validation_config` - Dynamic validation system configuration
- **Advanced Analytics**: Real-time metrics, trend analysis, A/B testing framework, and ROI calculation
- **Performance Optimization**: Automated bottleneck detection, parameter tuning, and multi-level caching (Memory, Redis, MongoDB)

### Channel-Scoped Features
- **Channel-Scoped MCP Servers**: Register MCP servers available only within specific channels via `registerChannelMcpServer()`
- **Channel-Level Tool Access Control**: Restrict which tools are available per channel using `allowedTools` configuration
- **Disable Task Handling**: Option to disable SystemLLM task handling per channel with `disableTaskHandling`
- **SystemLLM Cascading Control**: Fine-grained control over SystemLLM usage at channel level

### Game Example Demos
- **Fog of War Game** (`examples/fog-of-war-game/`): Team strategy game with 8 AI commanders, Vue.js dashboard
- **Tic-Tac-Toe** (`examples/tic-tac-toe/`): AI vs AI with personality-driven gameplay
- **Go Fish** (`examples/go-fish/`): Card game with memory and strategy

### MCP Tool Validation Improvements
- **Enhanced Validation System**: Replaced boolean validation with AJV-based JSON Schema validation providing detailed error messages
- **New Help Tools**: Added 4 meta-tools for agent self-service:
  - `tool_help` - Get detailed documentation, schema, and examples
  - `tool_validate` - Pre-validate tool calls before execution
  - `tool_quick_reference` - List all available tools
  - `tool_validation_tips` - Get common mistakes and best practices
- **Improved Error Messages**: From generic "Invalid input" to specific, actionable feedback showing:
  - Missing required properties with descriptions
  - Unknown properties that were provided
  - Expected schema format
  - Concrete examples of correct usage
- **Test Suite**: Added comprehensive validation tests including LLM behavior testing

## Essential Commands

### Development
```bash
# Install dependencies
npm install

# Start development server (with hot reload)  
npm run start:dev

# Build the project
npm run build

# Clean build artifacts
npm run clean

# Full rebuild
npm run rebuild
```

### Testing
```bash
# Run all tests
npm test

# Run specific test files
NODE_ENV=test ts-node tests/simple-agent-test.ts
NODE_ENV=test ts-node tests/llm-agent-demo.ts
NODE_ENV=test ts-node tests/control-loop-lifecycle-test.ts

# Run multi-agent demos
npm run demo:first-contact   # 6 agents in first contact scenario
npm run demo:fog-of-war      # 8 agents in strategy game
npm run demo:tic-tac-toe     # 2 agents playing tic-tac-toe
npm run demo:go-fish         # 2 agents playing Go Fish
```

### Dashboard Development
```bash
# Start dashboard development server (requires main server running)
cd dashboard && npm run dev

# Build dashboard for production
npm run build:dashboard
```

### Database Operations
```bash
# Clean up database
npm run cleanup:db
```

### Docker Operations
```bash
# Deploy full stack (MXF + MongoDB + Meilisearch + Redis + Dashboard)
npm run docker:up

# Stop all services
npm run docker:down

# View logs (all services)
npm run docker:logs

# View logs (specific service)
npm run docker:logs mxf-server
npm run docker:logs meilisearch

# Check service health
npm run docker:health

# Rebuild and restart services
npm run docker:rebuild

# Restart specific service
npm run docker:restart mxf-server

# Clean volumes and system
npm run docker:clean

# Check Meilisearch stats
npm run docker:meilisearch:stats
```

## Comprehensive Feature Analysis

### Existing Meta Tools and Tool Discovery
- **`tools_recommend`**: AI-powered tool recommendations using SystemLLM with fallback keyword matching
- **`tools_discover`**: Interactive tool exploration with category filtering
- **`tools_validate`**: Tool availability validation before execution
- **`tools_compare`**: Side-by-side tool comparison with alternatives
- **`tool_help`**: Detailed documentation and examples for specific tools
- **`tool_quick_reference`**: Complete tool reference with category filtering
- **HybridMcpToolRegistry**: Unified registry combining internal + external tools
- **McpToolRegistry**: Core tool registration and discovery service
- **McpToolDocumentationService**: Comprehensive tool documentation system

### Memory Search Tools (New)
- **`memory_search_conversations`**: Semantic search across entire conversation history
  - Hybrid search with configurable semantic/keyword ratio
  - Filter by channel, agent, timestamp
  - Returns relevant conversation snippets with context
- **`memory_search_actions`**: Search tool usage patterns and outcomes
  - Find when specific tools were used
  - Filter by success/failure, tool name, agent
  - Analyze tool usage patterns over time
- **`memory_search_patterns`**: Discover cross-channel patterns and learnings
  - Find effective collaboration patterns
  - Filter by effectiveness score, channel
  - Cross-agent knowledge sharing

### Error Handling and Recovery Systems
- **Circuit breaker patterns** in ExternalMcpServerManager with restart policies
- **Retry logic** in ControlLoop with configurable attempts and backoff
- **Fallback mechanisms** in tools_recommend (LLM → keyword-based)
- **Error diagnosis tool** (`error_diagnose`) for analyzing failed tool calls
- **Graceful degradation** across all major services
- **Health monitoring** with automatic recovery for external servers
- **Validation layers** with soft/hard failure modes
- **Advanced Auto-Correction System**:
  - **AutoCorrectionService**: Intelligent parameter correction with pattern learning
  - **CorrectionStrategyEngine**: Multiple correction strategies (type conversion, missing parameters, constraint violations)
  - **Loop Prevention**: Advanced guards prevent infinite retry cycles
  - **Safety Validation**: All corrections validated for safety before application
  - **Pattern Learning**: Continuous improvement from correction outcomes

### Learning and Adaptation Features
- **AgentPerformanceService**: Tracks ORPAR timing, tool usage, collaboration metrics
- **PatternMemoryService**: AI-powered pattern detection using SystemLLM
- **Performance analysis** with optimization suggestions
- **Tool usage analytics** with success/failure tracking
- **Learning progression metrics** for continuous improvement
- **Pattern recommendations** based on historical success
- **ValidationPerformanceService**: Tracks validation success rates, error patterns, and agent performance
- **PatternLearningService**: Learns from successful/failed parameter patterns for cross-agent knowledge sharing
- **PredictiveAnalyticsService**: ML-based error prediction and anomaly detection
- **A/B Testing Framework**: Statistical testing for validation strategies and system optimizations

### Monitoring and Analytics Systems
- **Real-time dashboard** with Vue.js frontend showing:
  - Agent performance metrics
  - Channel activity tracking  
  - Task completion analytics
  - System health monitoring
  - Validation analytics and error prevention metrics
  - Auto-correction success rates and patterns
  - Performance optimization recommendations
  - Error prediction accuracy and model performance
- **Analytics store** with comprehensive data collection
- **Event tracking** across all system interactions
- **Performance benchmarking** and trend analysis
- **Export functionality** for analytics data
- **Responsive UI** with filtering and visualization
- **ValidationAnalyticsService**: Advanced analytics with trend analysis, A/B testing, and ROI calculation
- **PerformanceOptimizationService**: Automated bottleneck detection and system tuning recommendations

### Collaboration Features
- **AgentCommunicationTools**: Direct messaging, broadcasting, agent discovery
- **CoordinationTools**: Formal collaboration workflows with state tracking
- **Channel-based organization** for focused team collaboration
- **Message routing** with priority and metadata support
- **Collaborative task management** with acceptance/rejection flows
- **Knowledge sharing** through shared memory and context
- **Real-time coordination** via Socket.IO

### Developer Tools and Testing Framework
- **Comprehensive test suite** with Jest, Mocha, Vitest support
- **Universal test runner** with auto-detection
- **Action validation tools** to prevent redundant operations
- **Code analysis tools** for TypeScript projects
- **Validation utilities** with configurable severity levels
- **TypeScript tools** for development workflow
- **Safety tools** for dangerous operation validation
- **Git integration tools** for version control
- **Infrastructure tools** for file system and shell operations

## High-Level Architecture

### Core Framework Structure

The Model Exchange Framework (MXF) is a sophisticated multi-agent collaboration system built with TypeScript, Node.js, Socket.IO, and MongoDB. It follows a modular architecture with clear separation of concerns:

#### Key Architectural Layers

1. **SDK Layer (`src/sdk/`)** - Agent client implementation
   - `MxfClient.ts` - Main agent client class with lazy connection and retry logic
   - `handlers/` - Modular event and message handlers:
     - `MessageHandlers` - Chat and MXP protocol handling
     - `ControlLoopHandlers` - ORPAR cycle management
     - `MemoryHandlers` - Agent/channel memory operations
     - `McpToolHandlers` - Tool discovery and execution
     - `TaskHandlers` - Task lifecycle management
   - `managers/` - MCP client, memory, and task execution managers
   - `services/` - API, event handling, and tool services

2. **Server Layer (`src/server/`)** - Core server infrastructure
   - `socket/` - Real-time Socket.IO services with:
     - WebSocket with HTTP long-polling fallback
     - 2-minute ping timeout for LLM operations
     - Agent tracking (agentId ↔ socketId ↔ Socket)
     - 30-second heartbeat with 5-minute timeout
     - Event-to-Socket bridging via EventBus
   - `api/` - REST API with comprehensive endpoints:
     - `/api/agents` - Agent CRUD and lifecycle
     - `/api/channels` - Channel management
     - `/api/tasks` - Task creation/monitoring
     - `/api/mcp` - MCP tool operations
     - `/api/hybrid-mcp` - Hybrid registry access
     - `/api/dashboard` - Analytics/monitoring
     - `/api/effectiveness` - Task metrics
   - Dual authentication system:
     - JWT tokens for users
     - API keys for agents
     - Combined middleware for flexible auth

3. **Shared Layer (`src/shared/`)** - Common utilities and types
   - `mcp/tools/` - 100+ built-in MCP tools organized by category (see [Tool Reference](docs/mxf/tool-reference.md))
   - `events/` - Three-layer EventBus architecture:
     - `EventBusImplementation` - Core RxJS Subject-based
     - `ClientEventBus` - Client-specific with socket integration
     - `ServerEventBus` - Server broadcasting and room management
   - `interfaces/` and `types/` - TypeScript interfaces and types
   - `models/` - MongoDB models for persistence

### Key Concepts

1. **ORPAR Control Loop** - The cognitive cycle for agent intelligence:
   - Observation → Reasoning → Action → Planning → Reflection
   - Powered by SystemLlmService with phase-optimized model selection:
     - `observation`: Fast model for quick data processing
     - `reasoning`: Deep model for complex analysis
     - `action`: Reliable model for tool execution
     - `planning`: Strategic model for long-term planning
     - `reflection`: Meta model for learning & evaluation
   - Performance tracking with timing metrics
   - Structured output parsing for reasoning results

2. **Hybrid Tool System**:
   - Internal tools in `src/shared/mcp/tools/` (100+ tools) - See [Tool Reference](docs/mxf/tool-reference.md)
   - External MCP server integration via stdio/HTTP protocols
   - Three-tier registry architecture:
     - `McpToolRegistry` - Internal tool management
     - `ExternalMcpServerManager` - External server lifecycle
     - `HybridMcpToolRegistry` - Unified interface
   - AI-powered tool recommendations with fallback to keyword matching
   - Circuit breakers and health monitoring for external servers

3. **Channel-Based Communication**:
   - Agents organize into channels for focused collaboration
   - Real-time messaging via Socket.IO with room-based broadcasting
   - Channel context and memory management with MongoDB persistence
   - MXP (Model Exchange Protocol) for structured communication:
     - AES-256-GCM encryption for secure messages
     - Natural language to structured protocol conversion
     - Automatic detection and parsing
   - Collaborative workflows with formal coordination

4. **Task Management**:
   - Autonomous task coordination with SystemLLM analysis
   - Goal-oriented prompting without micromanagement
   - Intelligent task assignment based on capability matching
   - Progress tracking with state transitions:
     - `pending` → `assigned` → `in_progress` → `completed`
   - Completion detection and validation
   - Analytics recording for effectiveness metrics

5. **Learning and Analytics**:
   - Performance metrics collection across ORPAR phases
   - Pattern recognition using PatternMemoryService
   - Cross-agent knowledge sharing via MongoDB
   - Adaptive behavior based on success patterns
   - Comprehensive monitoring dashboard with Vue.js
   - ML-based error prediction and pattern learning
   - A/B testing framework for optimization strategies

### Critical Patterns

1. **Event-Driven Architecture**: 
   - All communication flows through EventBus using RxJS observables
   - Events strictly typed in `EventNames.ts` with corresponding payloads
   - Automatic event forwarding from EventBus to Socket.IO
   - Event categories: Agent, Channel, Message, ControlLoop, Task, System
   - Observable streams enable reactive programming patterns

2. **Dual Authentication**: 
   - Users authenticate via JWT tokens (Bearer auth)
   - Agents authenticate via API keys (x-api-key header)
   - Combined middleware (`authenticateDual`) for flexible endpoints
   - Public endpoint whitelist for registration/health
   - Request context enrichment with auth data

3. **Tool Execution Flow**:
   - Discovery: `tools_recommend` → AI-powered suggestions
   - Validation: ProactiveValidationService with low latency
   - Auto-correction: AutoCorrectionService with pattern learning
   - Execution: HybridMcpService routes to internal/external
   - Result processing: Pattern learning and analytics recording
   - Error recovery: `tools_recommend_on_error` for alternatives

4. **Memory Management**:
   - Three scopes: Agent, Channel, Relationship
   - Pattern-based memory service using SystemLLM for retrieval
   - MongoDB persistence with TTL indexes
   - Multi-level caching: Memory → Redis → MongoDB
   - Semantic search for relevant memory retrieval
   - Context window management for LLM operations

5. **Error Recovery**: 
   - Circuit breakers with configurable thresholds
   - Exponential backoff retry logic (max 3 attempts)
   - Graceful degradation with fallback mechanisms
   - Diagnostic tools: `error_diagnose`, `predict_errors`
   - Health monitoring with automatic server restart
   - Validation layers with soft/hard failure modes

### Tool Categories and Capabilities

1. **Meta Tools & Validation**: Enhanced tool discovery, validation insights, error recovery, and intelligent recommendations
2. **Communication**: Messaging, broadcasting, coordination, discovery
3. **Control Loop**: ORPAR cycle management and state tracking
4. **Infrastructure**: File system, shell commands, memory operations
5. **Context Memory**: Channel and agent memory management
6. **Testing**: Multi-framework test runners and validation
7. **Code Analysis**: TypeScript, Git, and development tools
8. **Safety & Validation**: Pre-execution validation, auto-correction, and approval workflows
9. **Coordination**: Formal collaboration and workflow management
10. **Analytics & Optimization**: Performance tracking, error prediction, and automated optimization
11. **Predictive Tools**: ML-based error prediction, anomaly detection, and risk assessment

### Environment Variables

Key environment variables needed:
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - For user authentication
- `AGENT_API_KEY` - For agent authentication
- `OPENROUTER_API_KEY` - For LLM integration (optional but recommended)
- `PORT` - Server port (default: 3001)

#### Meilisearch Configuration
- `MEILISEARCH_MASTER_KEY` - Master key for Meilisearch (required for semantic search)
- `MEILISEARCH_HOST` - Meilisearch server URL (default: http://localhost:7700)
- `ENABLE_MEILISEARCH` - Enable Meilisearch integration (default: true)
- `ENABLE_SEMANTIC_SEARCH` - Enable semantic search with embeddings (default: true)
- `MEILISEARCH_HYBRID_RATIO` - Semantic/keyword ratio, 0.0-1.0 (default: 0.7)
- `MEILISEARCH_EMBEDDING_MODEL` - OpenAI embedding model (default: text-embedding-3-small)
- `MEILISEARCH_EMBEDDING_DIMENSIONS` - Embedding vector dimensions (default: 1536)
- `MEILISEARCH_BATCH_SIZE` - Batch size for indexing (default: 100)
- `MEILI_MAX_INDEXING_MEMORY` - Max memory for Meilisearch indexing (default: 2GB)
- `MEILI_MAX_INDEXING_THREADS` - Max threads for indexing (default: 4)
- `OPENAI_API_KEY` - Required for generating embeddings if ENABLE_SEMANTIC_SEARCH=true

#### Validation System Configuration
- `VALIDATION_DEFAULT_LEVEL` - Default validation level (ASYNC, BLOCKING, STRICT)
- `VALIDATION_MAX_LATENCY` - Maximum validation latency in ms (default: 50)
- `VALIDATION_CACHE_ENABLED` - Enable multi-level caching (default: true)
- `AUTO_CORRECTION_ENABLED` - Enable auto-correction system (default: true)
- `AUTO_CORRECTION_MAX_RETRIES` - Maximum correction attempts (default: 3)
- `AUTO_CORRECTION_CONFIDENCE_THRESHOLD` - Minimum confidence for corrections (default: 0.7)
- `ANALYTICS_AGGREGATION_INTERVAL` - Analytics data aggregation interval in ms (default: 60000)
- `ANALYTICS_RETENTION_DAYS` - Analytics data retention period (default: 90)
- `OPTIMIZATION_AUTO_TUNE` - Enable automatic performance tuning (default: true)
- `PREDICTION_MODEL_VERSION` - ML model version for error prediction (default: latest)
- `PREDICTION_RETRAIN_INTERVAL` - Model retraining interval in ms (default: 3600000)

### Development Tips

1. When modifying tools, ensure they follow the McpTool interface in `src/shared/types/toolTypes.ts`

2. All new events must be added to `src/shared/events/EventNames.ts` and have corresponding handlers

3. Use the Logger utility (`src/shared/utils/Logger.ts`) for consistent logging

4. Follow existing patterns for error handling and validation using the validation utilities

5. Test files are in `tests/` - use existing tests as templates for new functionality

6. The system already has extensive capabilities - focus on enhancing rather than rebuilding

7. Use existing analytics and performance services to understand system behavior

8. Leverage the pattern memory service for intelligent workflow optimization

## Detailed Architecture Deep Dive

### Server Initialization Sequence (`src/server/index.ts`)

The server follows a carefully orchestrated initialization order to ensure proper dependency resolution:

1. **Database Connection**: MongoDB connection established first
2. **Core Services Initialization**:
   - SocketService - WebSocket management
   - MemoryService - In-memory caching
   - ChannelContextService - Channel state management
3. **Search & Indexing Services**:
   - MxfMeilisearchService - Semantic search engine (optional, graceful degradation)
4. **Infrastructure Services**:
   - McpSocketExecutor - Tool execution engine
   - McpToolRegistry - Internal tool registration
   - ExternalMcpServerManager - External server lifecycle
5. **Event Services**:
   - EphemeralEventPatternService - Pattern detection
   - TaskService - Task orchestration
6. **Domain Services**:
   - ChannelService - Channel operations
   - AgentService - Agent lifecycle
7. **Hybrid MCP Service**: Unified tool interface with graceful failure handling
8. **Tool Pre-Registration**: 100+ internal tools registered at startup (including 3 memory search tools)
9. **API Route Mounting**: Routes mounted after all services ready

**Design Patterns Used**:
- **Singleton Pattern**: All services use `getInstance()` for single instance
- **Dependency Injection**: Services initialized in dependency order
- **Graceful Degradation**: Server continues if optional services fail

### Socket.IO Architecture (`src/server/socket/`)

**SocketService Implementation**:
- **Dual Transport**: WebSocket primary, HTTP long-polling fallback
- **Extended Timeouts**: 2-minute ping timeout for LLM operations
- **Agent State Tracking**: 
  ```typescript
  agentSocketMap: Map<agentId, socketId>
  socketAgentMap: Map<socketId, agentId>
  sockets: Map<socketId, Socket>
  ```
- **Heartbeat System**: 30-second intervals, 5-minute timeout threshold
- **Event Bridging**: EventBus events auto-forward to Socket.IO

**Connection Lifecycle**:
1. Socket connects → Authentication middleware
2. Agent registration → State tracking
3. Channel auto-join → Room subscription
4. Heartbeat monitoring → Connection health
5. Disconnection → Cleanup and state update

### SDK Client Architecture (`src/sdk/MxfClient.ts`)

**Handler System Design**:
The SDK uses a modular handler system for clean separation of concerns:

```typescript
handlers/
├── MessageHandlers.ts      // Chat and MXP protocol
├── ControlLoopHandlers.ts  // ORPAR cycle events
├── MemoryHandlers.ts       // Memory operations
├── McpToolHandlers.ts      // Tool discovery/execution
└── TaskHandlers.ts         // Task management
```

**Configuration Pipeline**:
```typescript
AgentConfig → enrichConfig() → InternalAgentConfig → MxfService
```

**Connection Management**:
- Lazy connection with automatic retry
- Exponential backoff on failures
- State tracking: disconnected → connecting → connected
- Automatic reconnection on network issues

### SystemLLM Service Architecture

**ORPAR-Optimized Model Selection**:
```typescript
const ORPAR_MODEL_CONFIGS = {
  observation: {
    model: 'claude-3-haiku',     // Fast, efficient
    temperature: 0.3,             // Low creativity
    maxTokens: 2000              // Quick responses
  },
  reasoning: {
    model: 'claude-3-opus',       // Deep analysis
    temperature: 0.7,             // Balanced
    maxTokens: 4000              // Detailed reasoning
  },
  action: {
    model: 'gpt-4-turbo',        // Reliable execution
    temperature: 0.2,             // Deterministic
    maxTokens: 2000              // Focused output
  },
  planning: {
    model: 'claude-3-sonnet',     // Strategic thinking
    temperature: 0.5,             // Some creativity
    maxTokens: 3000              // Comprehensive plans
  },
  reflection: {
    model: 'claude-3-opus',       // Meta-cognition
    temperature: 0.6,             // Insightful
    maxTokens: 2500              // Learning extraction
  }
}
```

**Key Operations**:
- Topic extraction with structured output
- Reasoning analysis with JSON parsing
- Plan generation and validation
- Tool recommendation with context
- Pattern recognition and learning

### Validation System Architecture

**ProactiveValidationService**:
- **Risk-Based Validation Levels**:
  - `NONE`: Skip validation
  - `ASYNC`: Non-blocking background
  - `BLOCKING`: Wait for validation
  - `STRICT`: Enhanced security checks
- **Performance Focus**: Low latency validation
- **Caching Strategy**: Memory → Redis → MongoDB
- **Pattern Learning**: Cross-agent knowledge sharing

**AutoCorrectionService**:
- **Correction Strategies**:
  - Type conversion (string → number)
  - Missing parameter inference
  - Constraint violation fixes
  - Format normalization
- **Safety Guards**:
  - Loop prevention (max 3 attempts)
  - Confidence threshold (0.7 minimum)
  - Safety validation before application
- **Pattern Learning**: Continuous improvement from outcomes

### Key Workflows

#### Agent Connection Flow
```
1. SDK creates MxfClient instance
2. Client calls connect() → Socket.IO connection
3. Authentication middleware validates credentials
4. AgentService.register() creates/updates agent
5. ChannelService.join() adds to default channel
6. EventBus.emit(AGENT_JOINED) notifies system
7. Heartbeat monitoring begins
```

#### Tool Execution Flow
```
1. Agent intent → tools_recommend
2. ProactiveValidationService validates parameters
3. AutoCorrectionService fixes issues (if needed)
4. HybridMcpService routes to internal/external
5. Tool execution with timeout/retry logic
6. Result processing and pattern recording
7. Analytics update for future learning
```

#### ORPAR Control Loop Flow
```
1. Trigger event → Observation phase
2. Context gathering → Channel/agent memory
3. Reasoning phase → SystemLLM analysis
4. Planning phase → Goal decomposition
5. Action phase → Tool execution
6. Reflection phase → Performance analysis
7. Pattern storage → Future optimization
```

#### Message Flow with MXP
```
1. Natural language input
2. MXP detector checks for protocol markers
3. Conversion to structured format (if MXP)
4. AES-256-GCM encryption
5. Socket.emit() to server
6. Channel broadcast to members
7. Client-side decryption
8. Message handler processing
```

### Performance Optimizations

1. **Lazy Initialization**: Services created on-demand
2. **Connection Pooling**: Reused database/socket connections
3. **Multi-Level Caching**: Memory → Redis → MongoDB
4. **Batch Processing**: Events aggregated for efficiency
5. **Intelligent Model Selection**: Right-sized models per task
6. **Pattern Caching**: Learned patterns stored for reuse
7. **Parallel Tool Execution**: Concurrent when safe
8. **Stream Processing**: RxJS for efficient event handling

### Security Implementation

1. **Authentication**:
   - JWT with RS256 for users
   - API key with database validation for agents
   - Token refresh mechanism
   - Session management

2. **Encryption**:
   - AES-256-GCM for MXP messages
   - TLS for all network communication
   - Secure key storage in environment

3. **Validation**:
   - Input sanitization on all endpoints
   - JSON Schema validation for tools
   - SQL injection prevention
   - XSS protection

4. **Access Control**:
   - Tool allowlists per agent
   - Channel-based isolation
   - Role-based permissions
   - Audit logging

### Monitoring & Analytics

**Real-time Dashboard Features**:
- Agent performance metrics (ORPAR timings)
- Channel activity visualization
- Task completion rates
- System health indicators
- Tool usage analytics
- Error prediction accuracy
- Auto-correction success rates

**Analytics Data Collection**:
- Event tracking with timestamps
- Performance metrics aggregation
- Pattern detection and storage
- A/B testing results
- ROI calculations
- Trend analysis

### Areas of Excellence

1. **Modularity**: Clean boundaries, plugin architecture
2. **Resilience**: Multiple fallbacks, circuit breakers
3. **Intelligence**: ML-based prediction, pattern learning
4. **Performance**: Optimized caching, lazy loading
5. **Developer Experience**: Strong typing, comprehensive docs
6. **Security**: Defense in depth, encryption
7. **Observability**: Rich analytics, real-time monitoring

### Potential Improvements

1. **Service Dependencies**: Consider formal DI container
2. **Memory Scaling**: Redis for production agent tracking
3. **Event Management**: Event aggregation for related types
4. **Cost Optimization**: Monitor LLM usage per ORPAR cycle
5. **Data Retention**: Implement cleanup policies for patterns