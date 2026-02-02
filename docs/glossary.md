# Glossary of Terms

This glossary defines key terms and concepts used throughout the Model Exchange Framework (MXF) documentation.

---

## A

### Agent
An autonomous AI entity that operates within MXF. Agents have unique identities, can communicate with other agents, execute tools, and collaborate on tasks. Each agent is powered by an LLM and follows the ORPAR control loop.

### Agent Config Prompt
The system prompt that defines an agent's identity, role, capabilities, and behavioral guidelines. This prompt shapes how the agent interprets tasks and interacts with others.

### AgentService
The server-side service responsible for agent lifecycle management including registration, authentication, state tracking, and cleanup.

### API Key
A credential used by agents to authenticate with the MXF server. Each agent requires a unique `keyId` and `secretKey` pair.

---

## C

### Channel
A logical grouping for agents to collaborate. Channels isolate communication and provide shared context. Agents must join a channel to interact with other agents in that channel.

### Channel Context
Shared state and memory associated with a channel, accessible by all agents in that channel.

### ChannelService
The server-side service managing channel creation, membership, and context.

### Circuit Breaker
A pattern that prevents runaway tool execution loops. When an agent calls the same tool repeatedly, the circuit breaker triggers to prevent infinite loops.

### Code Execution Sandbox
A secure, isolated Docker-based environment for running agent-generated code. Supports Bun runtime with CPU, memory, and time limits. See [Code Execution](./mxf/code-execution.md).

### Continuum Memory System
See [Nested Learning](#nested-learning).

### Control Loop
See [ORPAR](#orpar).

---

## D

### DAG (Directed Acyclic Graph)
A graph structure used by MXF's Task DAG system to define complex task dependencies with automatic topological ordering. Tasks are nodes, dependencies are edges, and the acyclic constraint prevents circular dependencies. See [Task DAG & Knowledge Graph](./features/dag-knowledge-graph.md).

### Domain Key
A unique identifier that associates SDK instances with a specific deployment. Used for multi-tenant configurations.

### Dynamic Inference Parameters
A system (P1) that automatically selects optimal LLM models and parameters based on task complexity, enabling complexity-based model switching and per-request temperature tuning.

---

## E

### EventBus
The central event distribution system in MXF. All communication flows through the EventBus using RxJS observables. Events are typed and include payloads defined in `EventNames.ts`.

### External MCP Server
An MCP tool server running as a separate process, connected to MXF via stdio or HTTP. Extends MXF's capabilities with external tools.

---

## H

### Handler
A modular component in the SDK that processes specific event types. Examples include MessageHandlers, ControlLoopHandlers, and TaskHandlers.

### Heartbeat
A periodic signal sent between agents and the server to verify connection health. Default: 30-second intervals with 5-minute timeout.

### Hybrid MCP
The unified tool system that combines internal MXF tools with external MCP servers, providing a single interface for tool discovery and execution.

---

## I

### Internal Tool
A built-in MCP tool provided by MXF (100+ available). These tools handle messaging, memory, tasks, validation, and more.

---

## J

### JWT (JSON Web Token)
A token format used for user authentication in MXF. Users authenticate via JWT; agents use API keys.

---

## K

### Knowledge Graph
A structured data model in MXF for storing entities and their typed relationships. Supports traversal queries, multi-hop reasoning, and optional TransE embeddings via TensorFlow.js. See [Knowledge Graph Guide](./features/dag-knowledge-graph.md).

---

## L

### LLM (Large Language Model)
The AI model powering agent intelligence. MXF supports multiple providers including OpenRouter, OpenAI, Anthropic, Google AI, xAI, Azure OpenAI, and Ollama.

### LLM Provider
The service providing LLM access. Configured via `llmProvider` in agent configuration. Supported values: `openrouter`, `openai`, `anthropic`, `gemini`, `xai`, `azure-openai`, `ollama`.

### LSP (Language Server Protocol)
A protocol for code intelligence features (completion, hover, diagnostics). MXF bridges LSP servers into MCP tools via the LSP-MCP bridge (P7).

---

## M

### Manager
A component in the SDK that coordinates complex operations. Examples include McpManager, MemoryManager, and TaskManager.

### MCP (Model Context Protocol)
An open protocol for providing tools and context to AI models. MXF implements MCP for its tool system.

### McpToolRegistry
The internal registry for MXF's built-in tools. Manages tool registration, discovery, and validation.

### Meilisearch
An open-source search engine used by MXF for semantic search across conversations, actions, and patterns.

### Memory Strata
Three-layer memory architecture: **episodic** (event sequences), **semantic** (factual knowledge), and **procedural** (how-to patterns). Each ORPAR phase routes to specific strata for reads and writes.

### Memory
Persistent state storage in MXF. Three scopes exist:
- **Agent Memory**: Private to a single agent
- **Channel Memory**: Shared among all agents in a channel
- **Relationship Memory**: Between specific agent pairs

### MXF (Model Exchange Framework)
A framework for building autonomous multi-agent AI systems. Provides infrastructure for agent collaboration, task orchestration, and tool execution.

### MxfClient
The main SDK class for creating and managing agents. Handles connection, events, and tool execution.

### MxfSDK
The primary SDK entry point. Manages domain authentication and agent/channel creation.

### MXP (Model Exchange Protocol)
A structured communication protocol for agent-to-agent messaging. Supports AES-256-GCM encryption for secure communication.

### MULS (Memory Utility Learning System)
A Q-value weighted memory retrieval system. Memories are ranked by learned utility scores with ORPAR phase-specific lambdas controlling retrieval weights. Task outcomes propagate retroactive rewards to update memory utility. See [MULS Guide](./mxf/memory-utility-learning.md).

### MxfMLService
The TensorFlow.js singleton service that manages ML model lifecycle (register, build, train, predict, save/load). Supports 7 model architectures: Dense classifiers, autoencoders, LSTMs, DQNs, regression, embeddings, and TransE.

---

## N

### Nested Learning
A multi-timescale memory architecture (P8) providing short-term, mid-term, and long-term memory consolidation. Uses SERC (Structured Experience Replay and Consolidation) for automated memory lifecycle management. See [Nested Learning](./mxf/nested-learning.md).

---

## O

### Observation (ORPAR)
The first phase of the ORPAR control loop where the agent gathers context, reads messages, and identifies relevant information.

### ORPAR
The cognitive control loop used by MXF agents:
- **O**bservation: Gather context and information
- **R**easoning: Analyze and understand the situation
- **P**lanning: Decide on actions to take
- **A**ction: Execute tools and communicate
- **R**eflection: Learn from outcomes

### ORPAR-Memory Integration
The coupling between the ORPAR control loop and the memory subsystem (P11). Features phase-to-strata routing, surprise-driven re-observation, phase-weighted rewards, and cycle consolidation. Controlled by the `ORPAR_MEMORY_INTEGRATION_ENABLED` flag. See [ORPAR-Memory Integration](./mxf/orpar-memory-integration.md).

---

## P

### P2P / Decentralization
The peer-to-peer foundation (P9) enabling agents to negotiate task assignment directly, federate across servers, and coordinate without a central orchestrator. See [P2P Foundation](./mxf/p2p-foundation.md).

### Pattern Memory
A learning system that stores successful patterns from agent operations. Used to improve future task handling through PatternMemoryService.

### Planning (ORPAR)
The third phase of the ORPAR loop where the agent formulates a plan of action based on reasoning.

### Proactive Validation
A validation system that checks tool parameters before execution. Supports multiple levels: ASYNC, BLOCKING, and STRICT.

### Prompt Compaction
An automatic prompt compression system (P3) that reduces token usage when approaching model token limits while preserving critical context through configurable compaction strategies. See [Prompt Auto-Compaction](./mxf/prompt-auto-compaction.md).

---

## Q

### Q-Value
In the MULS system, a learned utility score assigned to each memory. Higher Q-values indicate memories that have historically been more useful for task completion. Updated through retroactive reward propagation.

---

## R

### Reasoning (ORPAR)
The second phase of the ORPAR loop where the agent analyzes observations and applies logic to understand the situation.

### Reflection (ORPAR)
The final phase of the ORPAR loop where the agent evaluates outcomes and stores learnings for future improvement.

---

## S

### SdkEventBus
The client-side event bus used by the SDK layer for intra-agent event distribution, complementing the server-side EventBus.

### Semantic Search
AI-powered search that understands meaning rather than just keywords. Powered by Meilisearch and OpenAI embeddings in MXF.

### SERC (Structured Experience Replay and Consolidation)
The automated memory lifecycle mechanism in the Nested Learning system. Manages memory verification, repair, consolidation, and promotion across timescales.

### Socket.IO
The real-time communication library used for agent-server connections. Supports WebSocket with HTTP long-polling fallback.

### SocketService
The server-side service managing WebSocket connections, agent tracking, and real-time event distribution.

### SystemLLM
The internal LLM service used by MXF for task routing, tool recommendations, and intelligent decision-making at the system level.

### SystemLLMService
The service that interfaces with LLM providers for system-level operations like task analysis and pattern recognition.

### Surprise Detection
A mechanism in the ORPAR-Memory Integration that detects unexpected outcomes during the reflection phase and triggers re-observation to update the agent's understanding.

---

## T

### TensorFlow.js
An on-device machine learning library integrated into MXF (opt-in via `TENSORFLOW_ENABLED=true`). Provides error prediction (Dense classifier), anomaly detection (autoencoder), and knowledge graph embeddings (TransE). Managed by the `MxfMLService` singleton.

### TOON (Token-Optimized Object Notation)
A compact encoding format (P2) that reduces token usage for tool schemas and structured data. Provides lossless compression with full data fidelity through encoding/decoding. See [TOON Optimization](./mxf/toon-optimization.md).

### TransE
A knowledge graph embedding model that represents entities and relationships as vectors, where the relationship acts as a translation operation (head + relation ≈ tail). Available in MXF via TensorFlow.js when `TENSORFLOW_ENABLED=true`.

### Task
A unit of work in MXF. Tasks have lifecycle states: `pending` → `assigned` → `in_progress` → `completed`. Tasks are created with goals and assigned to capable agents.

### TaskService
The server-side service managing task creation, assignment, tracking, and completion.

### Tool
A capability that agents can execute. Tools have schemas defining their parameters and return structured results. MXF provides 100+ built-in tools.

### Tool Recommendation
An AI-powered system (`tools_recommend`) that suggests appropriate tools based on an agent's intent.

### Tool Validation
Parameter checking before tool execution. Uses JSON Schema validation with AJV for detailed error messages.

---

## V

### Validation
The process of checking tool parameters before execution. Includes schema validation, auto-correction, and error prediction.

---

## W

### WebSocket
A protocol providing full-duplex communication between agents and the server. Primary transport for real-time messaging.

### Workflow System
A composable workflow engine (P6) providing sequential, parallel, and loop patterns for multi-agent orchestration. Includes pre-built templates and event-driven execution. See [Workflow System](./mxf/workflow-system.md).

---

## Related Documentation

- [Getting Started](./getting-started.md)
- [Key Concepts](./mxf/key-concepts.md)
- [ORPAR Loop](./mxf/orpar.md)
- [Tool Reference](./mxf/tool-reference.md)
- [SDK Overview](./sdk/index.md)
