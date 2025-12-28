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

### Control Loop
See [ORPAR](#orpar).

---

## D

### Domain Key
A unique identifier that associates SDK instances with a specific deployment. Used for multi-tenant configurations.

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

## L

### LLM (Large Language Model)
The AI model powering agent intelligence. MXF supports multiple providers including OpenRouter, OpenAI, Anthropic, and Azure OpenAI.

### LLM Provider
The service providing LLM access. Configured via `llmProvider` in agent configuration. Supported values: `openrouter`, `openai`, `anthropic`, `azure-openai`.

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

---

## P

### Pattern Memory
A learning system that stores successful patterns from agent operations. Used to improve future task handling through PatternMemoryService.

### Planning (ORPAR)
The third phase of the ORPAR loop where the agent formulates a plan of action based on reasoning.

### Proactive Validation
A validation system that checks tool parameters before execution. Supports multiple levels: ASYNC, BLOCKING, and STRICT.

---

## R

### Reasoning (ORPAR)
The second phase of the ORPAR loop where the agent analyzes observations and applies logic to understand the situation.

### Reflection (ORPAR)
The final phase of the ORPAR loop where the agent evaluates outcomes and stores learnings for future improvement.

---

## S

### Semantic Search
AI-powered search that understands meaning rather than just keywords. Powered by Meilisearch and OpenAI embeddings in MXF.

### Socket.IO
The real-time communication library used for agent-server connections. Supports WebSocket with HTTP long-polling fallback.

### SocketService
The server-side service managing WebSocket connections, agent tracking, and real-time event distribution.

### SystemLLM
The internal LLM service used by MXF for task routing, tool recommendations, and intelligent decision-making at the system level.

### SystemLLMService
The service that interfaces with LLM providers for system-level operations like task analysis and pattern recognition.

---

## T

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

---

## Related Documentation

- [Getting Started](./getting-started.md)
- [Key Concepts](./mxf/key-concepts.md)
- [ORPAR Loop](./mxf/orpar.md)
- [Tool Reference](./mxf/tool-reference.md)
- [SDK Overview](./sdk/index.md)
