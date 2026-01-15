# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## IMPORTANT: Brad's Rules

- **Do not make assumptions - follow the code**
- **No TODOs! Do the work**
- **Add comments and update them**
- **Add tests and update them**
- **Add documentation and update it**
- **Test scripts are meant to find and fix errors - please do not change them to ignore real errors and issues in the framework and SDK.**
- **Logging should use the logger provided by the framework**
- **Do not add fallbacks, timeouts, or simulation to the codebase.**
- **Do not add smoke and mirrors to the codebase.**
- **Add validation for fail-fast behavior in the framework and SDK.**
- **When refactoring please take a clean break approach.**
- **Do not add unit tests to the codebase unless asked.**
- **NEVER run the MXF server in a background process.** The server has SystemLLM enabled which uses Claude Opus 4.5 credits - leaving it running burns through OpenRouter budget ($18+ per day). Always let the user start/stop the server in their own terminal.

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

**Three-Tier Test Architecture:**
| Tier | Command | Tests | Speed | Server Required |
|------|---------|-------|-------|-----------------|
| Unit + Property | `npm run test:unit` | 159 | ~2s | No |
| Integration | `npm run test:integration` | 92 | ~60s | Yes (start manually) |
| Mutation | `npm run test:mutation` | 2317 mutants | ~5m | No |

**Unit & Property Tests (Fast, No Server):**
```bash
npm run test:unit              # Run all unit + property tests
npm run test:property          # Property tests only
npm run test:unit:watch        # Watch mode
npm run test:unit:coverage     # With coverage
npm run test:mutation          # Mutation testing (test quality)
```

**Integration Tests (Jest-based):**

**IMPORTANT:** Start the server manually before running integration tests:
```bash
# Terminal 1: Start the server
npm run dev

# Terminal 2: Run integration tests
npm run test:integration
```

```bash
# Run all integration tests
npm run test:integration

# Run specific test suites
npm run test:integration -- --testPathPattern=agent      # Agent tests
npm run test:integration -- --testPathPattern=channel    # Channel tests
npm run test:integration -- --testPathPattern=tool       # Tool tests
npm run test:integration -- --testPathPattern=prompt     # Prompt system tests
npm run test:integration -- --testPathPattern=task       # Task system tests
npm run test:integration -- --testPathPattern=orpar      # ORPAR tests
npm run test:integration -- --testPathPattern=memory     # Memory tests
npm run test:integration -- --testPathPattern=meilisearch # Meilisearch tests

# Watch mode for development
npm run test:watch

# CI mode
npm run test:ci

# Coverage report
npm run test:coverage
```

**Claude Code Test Commands:**
- `/test` - Run full integration test suite (requires server running)
- `/test-quick` - Run quick smoke tests
- `/test-path` - Run tests for specific path
- `/test-watch` - Run tests in watch mode
- `/test-ci` - Run full test suite (CI mode)

**IMPORTANT: Run tests before completing implementation tasks!**

### Post-Coding Workflow

After completing code changes, spawn these agents in sequence to ensure quality:

1. **test-builder** - Generate unit/property tests for new code
2. **code-cleanup** - Remove unused imports, dead code, formatting issues
3. **docs-updater** - Update documentation to reflect changes

**Quick workflow:**
```
After implementing a feature or fix:
1. Spawn test-builder agent → writes tests for your changes
2. Run npm run test:unit → verify tests pass
3. Spawn code-cleanup agent → clean up the code
4. Spawn docs-updater agent → update docs
5. Run /finalize → commit, test, and create PR
```

**Or use the `/finalize` command** which runs cleanup, docs, tests, and creates a PR automatically.

**Legacy Tests & Demos:**
```bash
# Legacy integration tests
npm run test:meilisearch     # Meilisearch-specific integration test
npm run test:code-execution  # Code execution demo

# Multi-agent demos
npm run demo:first-contact   # 6 agents in first contact scenario
npm run demo:fog-of-war      # 8 agents in strategy game
npm run demo:interview       # Interview scheduling demo
npm run demo:external-mcp    # External MCP server registration demo
npm run demo:channel-mcp     # Channel MCP demo
```

**Test Structure:**
```
tests/
├── setup/                    # Jest global setup/teardown
├── utils/                    # Test utilities (TestSDK, waitFor, etc.)
└── integration/
    ├── agent/                # Agent lifecycle tests
    ├── channel/              # Channel communication tests
    ├── tool/                 # Tool execution tests
    ├── prompt/               # Prompt system tests
    ├── task/                 # Task management tests
    ├── orpar/                # ORPAR control loop tests
    ├── memory/               # Memory operation tests
    ├── meilisearch/          # Semantic search tests
    └── external-mcp/         # External MCP server tests
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
     - `Handler.ts` - Base handler class
     - `MessageHandlers.ts` - Chat and MXP protocol handling
     - `ControlLoopHandlers.ts` - ORPAR cycle management
     - `MemoryHandlers.ts` - Agent/channel memory operations
     - `McpToolHandlers.ts` - Tool discovery and execution
     - `McpHandler.ts` and `McpResourceHandlers.ts` - MCP resource handling
     - `TaskHandlers.ts` - Task lifecycle management
   - `managers/` - MCP client, memory, system prompt, and task execution managers:
     - `MxfMcpClientManager.ts`, `MxfMemoryManager.ts`, `MxfSystemPromptManager.ts`, `MxfTaskExecutionManager.ts`
   - `services/` - Core SDK services:
     - `MxfService.ts` - Main service orchestrator
     - `MxfApiService.ts` - REST API interactions
     - `MxfToolService.ts` - Tool execution
     - `MxfEventHandlerService.ts` - Event handling
     - `MxfMemoryService.ts` - Memory operations
     - `MxfContextBuilder.ts`, `MxfLayeredPromptAssembler.ts`, `MxfStructuredPromptBuilder.ts` - Prompt building
     - `MxfActionHistoryService.ts`, `MxfReasoningHistoryService.ts` - History tracking

2. **Server Layer (`src/server/`)** - Core server infrastructure
   - `socket/` - Real-time Socket.IO services with:
     - WebSocket with HTTP long-polling fallback
     - 2-minute ping timeout for LLM operations
     - Agent tracking (agentId ↔ socketId ↔ Socket)
     - 30-second heartbeat with 5-minute timeout
     - Event-to-Socket bridging via EventBus
   - `api/` - REST API with comprehensive endpoints:
     - `/api/agents` - Agent CRUD and lifecycle (agentKeyRoutes, agentLifecycle)
     - `/api/channels` - Channel management (channelKeyRoutes, channelContextRoutes)
     - `/api/tasks` - Task creation/monitoring
     - `/api/mcp` - MCP tool operations
     - `/api/hybrid-mcp` - Hybrid registry access
     - `/api/dashboard` - Analytics/monitoring
     - `/api/analytics` - Comprehensive analytics
     - `/api/effectiveness` - Task metrics
     - `/api/config` - Configuration management
     - `/api/validation-analytics` - Validation metrics
     - `/api/documents` - Document operations
     - `/api/n8n` - n8n webhook integrations
   - Dual authentication system:
     - JWT tokens for users
     - API keys for agents
     - Combined middleware for flexible auth

3. **Shared Layer (`src/shared/`)** - Common utilities, types, and services
   - `protocols/mcp/tools/` - ~95 built-in MCP tools organized by category
   - `events/` - Three-layer EventBus architecture:
     - `EventBusBase.ts` - Core RxJS Subject-based implementation
     - `ClientEventBus.ts` - Client-specific with socket integration
     - `ServerEventBus.ts` - Server broadcasting and room management
     - `EventNames.ts` - Centralized event name definitions
   - `interfaces/` and `types/` - TypeScript interfaces and types
   - `models/` - MongoDB models for persistence
   - `services/` - Shared services (validation, analytics, pattern learning, etc.)
   - `adapters/` - Data adapters
   - `config/` - Configuration utilities
   - `constants/` - Framework constants
   - `middleware/` - Express middleware
   - `mxp/` - MXP (Model Exchange Protocol) implementation
   - `prompts/` - Prompt templates and builders
   - `schemas/` - JSON schemas for validation
   - `utils/` - Utility functions (Logger, etc.)

### Key Concepts

1. **ORPAR Control Loop** - The cognitive cycle for agent intelligence:
   - Observation → Reasoning → Planning → Action → Reflection
   - Powered by SystemLlmService with phase-optimized model selection:
     - `observation`: Fast model for quick data processing
     - `reasoning`: Deep model for complex analysis
     - `planning`: Strategic model for long-term planning
     - `action`: Reliable model for tool execution
     - `reflection`: Meta model for learning & evaluation
   - Performance tracking with timing metrics
   - Structured output parsing for reasoning results

   **ORPAR Tool Semantics (IMPORTANT):**
   - ORPAR tools (`orpar_observe`, `orpar_reason`, `orpar_plan`, `orpar_act`, `orpar_reflect`) are **documentation tools**
   - They record what the agent did/thought, marking phase completion
   - Correct flow:
     - PLAN phase: Think → call `orpar_plan` with plan → transition to ACT
     - ACT phase: Execute plan (call tools) → call `orpar_act` to document → transition to REFLECT
     - REFLECT phase: Reflect → call `orpar_reflect` → done or new cycle
   - ORPAR tools must be **tool-agnostic** - never reference specific external tools in descriptions
   - Phase-gating: Each `orpar_*` event triggers transition to the next phase's tools

2. **Hybrid Tool System**:
   - Internal tools in `src/shared/protocols/mcp/tools/` (~95 tools) - See [Tool Reference](docs/mxf/tool-reference.md)
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

Tools are organized in `src/shared/protocols/mcp/tools/`:

1. **MetaTools**: Tool discovery, recommendations, validation, error recovery
2. **AgentCommunicationTools**: Messaging, broadcasting, agent discovery
3. **CoordinationTools**: Formal collaboration workflows, state tracking
4. **ControlLoopTools/Lifecycle/Phases**: ORPAR cycle management
5. **OrparTools**: ORPAR-specific operations
6. **TaskBridgeTools & TaskPlanningTools**: Task creation, tracking, planning
7. **EffectivenessTools**: Task effectiveness metrics
8. **InfrastructureTools**: File system, shell commands
9. **ContextMemoryTools & MemorySearchTools**: Memory operations, semantic search
10. **TestTools**: Multi-framework test runners
11. **CodeAnalysisTools & TypeScriptTools**: Code analysis, TypeScript operations
12. **GitTools**: Version control operations
13. **SafetyTools & ActionValidationTools**: Pre-execution validation, safety checks
14. **AnalyticsTools**: Performance tracking, metrics
15. **PlanningTools**: Planning operations
16. **ToolHelpTools**: Tool documentation and help
17. **DateTimeTools**: Date/time operations
18. **JsonTools & WebTools**: JSON and web utilities

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

#### Performance Tuning Configuration
- `EVENT_QUEUE_ENABLED` - Enable event forwarding queue (default: true, set to 'false' to disable)
- `EVENT_QUEUE_DELAY_MS` - Delay between event batch processing in ms (default: 5, was 25)
- `EVENT_QUEUE_BATCH_SIZE` - Events per batch (default: 10)
- `EVENT_QUEUE_MAX_SIZE` - Maximum queue size (default: 1000)
- `EVENT_QUEUE_MAX_RETRIES` - Retry count for failed events (default: 3)
- `OPENROUTER_REQUEST_QUEUE_DELAY_MS` - Delay between LLM API requests in ms (default: 100, was 500)

### Development Tips

1. When modifying tools in `src/shared/protocols/mcp/tools/`, ensure they follow the McpTool interface in `src/shared/types/toolTypes.ts`

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
8. **Tool Pre-Registration**: ~95 internal tools registered at startup (including 3 memory search tools)
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
├── Handler.ts              // Base handler class
├── MessageHandlers.ts      // Chat and MXP protocol
├── ControlLoopHandlers.ts  // ORPAR cycle events
├── MemoryHandlers.ts       // Memory operations
├── McpToolHandlers.ts      // Tool discovery/execution
├── McpHandler.ts           // MCP base handler
├── McpResourceHandlers.ts  // MCP resource handling
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