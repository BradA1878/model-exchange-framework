# MXF Codebase Architecture - Detailed Analysis

## Executive Summary

The Model Exchange Framework (MXF) is a sophisticated TypeScript/Node.js multi-agent collaboration system with:
- **Advanced service patterns**: Singleton services with dependency injection and initialization ordering
- **Hybrid MCP architecture**: Unified tool system combining 75+ internal tools + external server tools
- **Event-driven design**: RxJS-based EventBus with three-layer architecture (core, client, server)
- **Security-first approach**: Dual authentication (JWT + API keys), path validation, confirmation managers
- **Validation & learning**: Proactive validation, pattern learning, auto-correction with analytics
- **Semantic search**: Meilisearch integration with vector embeddings for conversation/action indexing

---

## 1. SERVICE PATTERNS & ARCHITECTURE

### 1.1 Service Structure Pattern

All major services follow a consistent singleton pattern with:

```typescript
// Pattern used across MXF services
export class ServiceName {
    private static instance: ServiceName;
    private constructor() { }
    
    public static getInstance(): ServiceName {
        if (!ServiceName.instance) {
            ServiceName.instance = new ServiceName();
        }
        return ServiceName.instance;
    }
}
```

**Key Services & Their Patterns:**

#### 1.1.1 SystemLlmService (Service Pattern for LLM Integration)
**File**: Not directly visible but referenced throughout
**Pattern**: Provides ORPAR-phase-optimized model selection:
- `observation`: Fast model (Haiku) for quick processing
- `reasoning`: Deep model (Opus) for analysis
- `action`: Reliable model for tool execution
- `planning`: Strategic model for goal decomposition
- `reflection`: Meta model for learning

#### 1.1.2 MxfMeilisearchService (Service Pattern for Search Infrastructure)
**File**: `/Users/bradanderson/Development/model-exchange-framework/src/shared/services/MxfMeilisearchService.ts`

**Service Pattern Characteristics**:
```typescript
export class MxfMeilisearchService {
    private static instance: MxfMeilisearchService;
    private client: MeiliSearch;
    private embeddingGenerator?: EmbeddingGenerator;
    private config: MeilisearchServiceConfig;
    private initialized: boolean = false;
    
    private constructor(config: MeilisearchServiceConfig) { }
    
    public static getInstance(config?: MeilisearchServiceConfig): MxfMeilisearchService { }
    public async initialize(): Promise<void> { }
}
```

**Key Characteristics**:
- **Lazy initialization**: Optional embedding generator injected after singleton creation
- **Configuration pipeline**: Environment variables → config object → instance state
- **Graceful degradation**: Indexing failures don't break main flow; returns undefined for embeddings
- **Multi-index management**: Separate indexes for conversations, actions, patterns, observations
- **Dual-write pattern**: MongoDB persistence + Meilisearch search

**Index Configuration**:
```typescript
MeilisearchIndex {
    CONVERSATIONS = 'mxf-conversations'    // With vector embeddings
    ACTIONS = 'mxf-actions'                // Tool usage patterns
    PATTERNS = 'mxf-patterns'              // Learned patterns
    OBSERVATIONS = 'mxf-observations'      // Observation data
}
```

**Vector Embedder Setup**:
```typescript
embedders: {
    default: {
        source: 'userProvided',
        dimensions: 1536  // text-embedding-3-small dimensions
    }
}
```

#### 1.1.3 ProactiveValidationService (Service Pattern for Validation)
**File**: `/Users/bradanderson/Development/model-exchange-framework/src/shared/services/ProactiveValidationService.ts`

**Validation Levels** (Risk-based):
```typescript
enum ValidationLevel {
    NONE = 'NONE'                    // No validation, direct execution
    ASYNC = 'ASYNC'                  // Background validation, don't block
    BLOCKING = 'BLOCKING'            // Block until validation passes
    STRICT = 'STRICT'                // Enhanced checks with security validation
}
```

**Core Method Signature**:
```typescript
public async validateToolCall(
    agentId: AgentId,
    channelId: ChannelId,
    toolName: string,
    parameters: Record<string, any>,
    requestId: string
): Promise<ValidationResult>
```

**Validation Result Structure**:
```typescript
interface ValidationResult {
    valid: boolean;
    validationId: string;
    errors: ValidationError[];        // SCHEMA, BUSINESS_LOGIC, SECURITY, PERFORMANCE, PATTERN
    warnings: ValidationWarning[];    // PERFORMANCE, BEST_PRACTICE, DEPRECATION, PATTERN
    suggestions: ValidationSuggestion[]; // PARAMETER_IMPROVEMENT, ALTERNATIVE_TOOL, PATTERN_USAGE
    confidenceScore: number;
    executionTime: number;
    riskAssessment: RiskAssessment;
    cachedResult: boolean;
}
```

**Service Dependencies**:
- `ValidationPerformanceService`: Tracks validation metrics and agent performance
- `PatternLearningService`: Learns from failed/successful validations
- `EventBus`: Listens to tool events for learning

---

### 1.2 Service Initialization Order

**Critical Sequence** (from `src/server/index.ts`):

```
1. MemoryService with persistence
   ↓
2. Database connection (MongoDB)
   ↓
3. Meilisearch initialization (if enabled)
   ↓
4. Core services instantiation
   - SocketService
   - MemoryService (already init)
   - ChannelContextService
   - McpSocketExecutor
   - McpToolRegistry
   - EphemeralEventPatternService
   - TaskService
   - ModeDetectionService
   ↓
5. Hybrid MCP Service initialization
   ↓
6. McpService initialization
   ↓
7. Load & register MCP tools from database
   ↓
8. Mount API routes
   ↓
9. Start server
```

**Why This Order Matters**:
- Services can depend on each other in well-defined ways
- Event listeners are set up before tools are registered
- Database is connected before any persistence operations
- MCP tools are loaded after tool registry is ready

---

### 1.3 Dependencies Between Services

```
McpToolRegistry
├── Stores tools in memory from database
├── Used by: HybridMcpService, MetaTools
└── Broadcasts: TOOL_REGISTRY_CHANGED events

HybridMcpService
├── Combines: McpToolRegistry (internal) + ExternalMcpServerManager (external)
├── Exports: HybridMcpToolRegistry (unified interface)
└── Provides: listAllTools(), getToolByName(), executeToolCall()

ProactiveValidationService
├── Uses: ValidationPerformanceService, PatternLearningService
├── Listens to: McpEvents.TOOL_ERROR, McpEvents.TOOL_RESULT
└── Learns: Risk profiles, error patterns, success rates

EventBus (three-layer architecture)
├── EventBusImplementation (core RxJS Subject-based)
├── ClientEventBus (client with socket integration)
└── ServerEventBus (server with room management)
    └── Auto-forwards to Socket.IO for real-time updates
```

---

## 2. TOOL SYSTEM ARCHITECTURE

### 2.1 Tool Definition Interface

**Base Tool Contract** (`src/shared/protocols/mcp/tools/` structure):

Each tool follows this pattern:
```typescript
{
    name: string;                    // Unique identifier
    description: string;              // Human-readable description
    inputSchema: {                   // JSON Schema for parameters
        type: 'object';
        properties: { ... };
        required: [ ... ];
        additionalProperties: false;
    };
    examples?: Array<{               // Example usage patterns
        input: Record<string, any>;
        description: string;
    }>;
    handler: async (input, context) => {
        // Actual implementation
        // context contains: agentId, channelId, requestId
    };
}
```

### 2.2 Tool Categories (75+ Tools)

**Location**: `/Users/bradanderson/Development/model-exchange-framework/src/shared/protocols/mcp/tools/`

```
Tool Categories:
├── Communication (AgentCommunicationTools)
│   ├── agent_message_send
│   ├── agent_broadcast
│   └── agent_discover
│
├── Coordination (CoordinationTools)
│   ├── channel_coordinate_task
│   └── channel_create_workflow
│
├── Control Loop (ControlLoopTools)
│   ├── control_loop_create
│   ├── control_loop_execute
│   └── control_loop_observe
│
├── Infrastructure (InfrastructureTools)
│   ├── filesystem_read
│   ├── filesystem_write
│   ├── shell_execute
│   └── memory_store
│
├── Context & Memory (ContextMemoryTools + MemorySearchTools)
│   ├── channel_context_get
│   ├── channel_context_set
│   ├── agent_memory_recall
│   └── memory_search_conversations
│
├── Meta-Tools (MetaTools)
│   ├── tools_recommend
│   ├── tools_discover
│   ├── tools_compare
│   └── tools_validate
│
├── Help Tools (ToolHelpTools)
│   ├── tool_help
│   ├── tool_validate
│   ├── tool_quick_reference
│   └── tool_validation_tips
│
├── Web & Search (WebTools)
│   ├── web_search
│   ├── web_fetch
│   └── web_navigate
│
├── Git (GitTools)
│   ├── git_clone
│   ├── git_commit
│   └── git_push
│
├── TypeScript (TypeScriptTools)
│   ├── typescript_compile
│   └── typescript_analyze
│
├── Testing (TestTools)
│   ├── test_run
│   └── test_discover
│
├── Code Analysis (CodeAnalysisTools)
│   ├── code_analyze
│   └── code_metrics
│
├── Safety (SafetyTools)
│   ├── action_validate
│   └── safety_check
│
├── Planning (PlanningTools)
│   ├── plan_create
│   └── plan_decompose
│
├── Task Planning (TaskPlanningTools)
│   ├── task_plan_completion
│   └── task_intelligent_assign
│
├── Effectiveness (EffectivenessTools)
│   ├── effectiveness_analyze
│   └── effectiveness_record
│
├── Analytics (AnalyticsTools)
│   ├── analytics_aggregate
│   └── analytics_trend
│
└── Utilities
    ├── DateTimeTools
    └── JsonTools
```

### 2.3 Tool Registration & Discovery Flow

**Registration Flow**:

```
1. Server starts
   └─ allMxfMcpTools array loaded from /tools/index.ts

2. McpToolRegistry.getInstance() created
   └─ Lazy loads tools from database via listTools()

3. ExternalMcpServerManager initialized
   └─ Discovers tools from external servers

4. HybridMcpToolRegistry created
   ├─ Subscribes to internal registry updates
   ├─ Subscribes to external server events
   └─ Combines both into unified tool list

5. ServerHybridMcpService.initialize()
   ├─ Waits for internal registry to have tools
   ├─ Starts priority external servers
   └─ Makes HybridMcpToolRegistry globally available
       └─ (global).hybridMcpToolRegistry = registry

6. McpService.initialize()
   └─ Sets up socket-based tool communication

7. Tools are loaded from database and registered if new
   ├─ Check existing tool names in database
   ├─ Filter for new tools not yet in database
   └─ Register new tools via McpToolRegistry.registerTool()
```

### 2.4 Tool Execution Path

```
Agent calls tool via SDK/Socket
    ↓
McpToolHandlers.callTool()
    ├─ Generates requestId
    ├─ Validates input
    ├─ Sets up response listener
    └─ Emits Events.Mcp.TOOL_CALL event
        ↓
    Server receives TOOL_CALL event
    ├─ ProactiveValidationService.validateToolCall()
    │   ├─ Risk assessment
    │   ├─ Schema validation
    │   ├─ Pattern validation
    │   └─ Returns ValidationResult
    │
    ├─ If validation fails with HIGH severity
    │   └─ Emit Events.Mcp.TOOL_ERROR
    │
    └─ HybridMcpToolRegistry.executeTool()
        ├─ Determine source (internal vs external)
        ├─ Internal: Call McpToolRegistry handler directly
        └─ External: Route via ExternalMcpServerManager.executeToolCall()
            ↓
        Tool execution
            ├─ Captures: result, errors, timing
            ├─ Emits: Events.Mcp.TOOL_RESULT or Events.Mcp.TOOL_ERROR
            └─ Records: ValidationPerformanceService updates
                ↓
            Client receives result via socket listener
                ↓
            callTool() Promise resolves with result
```

### 2.5 Internal Tool Structure Example

**From InfrastructureTools.ts**:

```typescript
export const fsReadTool = {
    name: INFRASTRUCTURE_TOOLS.FILESYSTEM_READ,
    description: 'Read file contents with encoding options and safety checks',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'File path to read from',
                minLength: 1
            },
            encoding: {
                type: 'string',
                enum: ['utf8', 'ascii', 'base64', 'binary', 'hex'],
                default: 'utf8'
            },
            maxSize: {
                type: 'number',
                default: 10485760,  // 10MB
                minimum: 0,
                maximum: 104857600  // 100MB
            },
            startByte: { type: 'number', minimum: 0 },
            endByte: { type: 'number', minimum: 0 }
        },
        required: ['path'],
        additionalProperties: false
    },
    examples: [
        {
            input: { path: '/tmp/test.txt' },
            description: 'Read a text file with default UTF-8 encoding'
        }
    ],
    async handler(input: {
        path: string;
        encoding?: string;
        maxSize?: number;
        startByte?: number;
        endByte?: number;
    }, context: {
        agentId: AgentId;
        channelId: ChannelId;
        requestId: string;
    }): Promise<{
        content: string | Buffer;
        size: number;
        encoding: string;
        path: string;
        readAt: number;
    }> {
        try {
            validator.assertIsString(input.path, 'path');
            
            // Path validation with security guard
            const pathValidation = securityGuard.validatePath(input.path, 'read');
            if (!pathValidation.allowed) {
                throw new Error(pathValidation.reason);
            }
            
            logger.info(`Reading file ${input.path} for agent ${context.agentId}`);
            
            // Actual implementation would read file here
            // ...
            
            return {
                content: mockContent,
                size: mockContent.length,
                encoding: input.encoding || 'utf8',
                path: input.path,
                readAt: Date.now()
            };
        } catch (error) {
            logger.error(`Failed to read file: ${error}`);
            throw new Error(`Failed to read file: ${error}`);
        }
    }
};
```

**Key Patterns**:
1. **Input validation**: Use createStrictValidator()
2. **Security checks**: Call securityGuard.validatePath()
3. **Logging context**: Include agentId and context info
4. **Error handling**: Catch and throw with descriptive messages
5. **Return typing**: Strongly typed return object

### 2.6 Tool Lookup & Discovery

**HybridMcpToolRegistry Methods**:

```typescript
export class HybridMcpToolRegistry {
    // List all tools (internal + external)
    listAllTools(): Observable<HybridMcpTool[]>
    
    // Get tool by name
    getToolByName(toolName: string): HybridMcpTool | undefined
    
    // Execute tool call
    async executeToolCall(
        toolName: string,
        input: Record<string, any>,
        context: ToolExecutionContext
    ): Promise<any>
    
    // Filter tools by source
    getToolsBySource(source: 'internal' | string): HybridMcpTool[]
    
    // Get tools by category
    getToolsByCategory(category: string): HybridMcpTool[]
}
```

**Tool Source Convention**:
- Internal tools: source = 'internal'
- External tools: source = `${serverId}` (e.g., 'calculator', 'sequential-thinking')

---

## 3. SDK INTEGRATION POINTS

### 3.1 MxfClient Structure

**File**: `/Users/bradanderson/Development/model-exchange-framework/src/sdk/MxfClient.ts`

**Core Properties**:
```typescript
export class MxfClient {
    public agentId: string;
    public name: string;
    public channelId?: string;
    public mxfService!: MxfService;
    
    protected status: ConnectionStatus;
    protected responseHandlers: Map<string, (response: SimpleTaskResponse) => void>;
    protected taskRequestHandler: TaskRequestHandler | null;
    
    // Handler modules for different event types
    protected messageHandlers: MessageHandlers | null;
    protected controlLoopHandlers: ControlLoopHandlers | null;
    protected memoryHandlers: MemoryHandlers | null;
    protected mcpToolHandlers: McpToolHandlers | null;
    protected mcpResourceHandlers: McpResourceHandlers | null;
    protected taskHandlers: TaskHandlers | null;
    protected toolService: MxfToolService | null;
    
    // Lazy connection management
    private connectionPromise: Promise<void> | null;
    private isFullyConnected: boolean = false;
}
```

### 3.2 Handler System Design

**Pattern**: Each handler module manages a specific event category

```
SDK Handlers (src/sdk/handlers/):
├── MessageHandlers
│   └─ Handles: Chat messages, MXP protocol parsing/conversion
├── ControlLoopHandlers
│   └─ Handles: ORPAR cycle events (observation, reasoning, etc.)
├── MemoryHandlers
│   └─ Handles: Agent/channel/relationship memory operations
├── McpToolHandlers
│   └─ Handles: Tool registration, calls, results, errors
├── McpResourceHandlers
│   └─ Handles: Resource access operations
├── TaskHandlers
│   └─ Handles: Task lifecycle events
└── Handler (base class)
    └─ Provides: Base subscribe/emit patterns
```

**Handler Pattern - McpToolHandlers Example**:

```typescript
export class McpToolHandlers extends McpHandler {
    private agentId: string;
    private channelId: string;
    private mxfService: IInternalChannelService;
    private registeredTools: Map<string, any>;
    private serverTools: Map<string, any>;
    private resultCallbacks: Map<string, (result: any) => void>;
    
    /**
     * Register a tool with the server
     */
    public registerTool = (tool: any, channelId: string): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            // Validate inputs
            validator.assertIsObject(tool);
            validator.assertIsNonEmptyString(tool.name);
            
            // Set up one-time response handler
            const subscription = EventBus.client.on(
                Events.Mcp.TOOL_REGISTERED,
                (payload) => {
                    subscription.unsubscribe();
                    if (payload.data.success) {
                        this.registeredTools.set(tool.name, tool);
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                }
            );
            
            // Emit registration request
            const registerPayload = createMcpToolRegisterPayload(...);
            EventBus.client.emit(Events.Mcp.TOOL_REGISTER, registerPayload);
        });
    };
    
    /**
     * Call a tool and wait for result
     */
    public callTool = (name: string, input: any, channelId: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            const requestId = `tool-call-${Date.now()}-${random()}`;
            
            // Set up result listener with timeout
            const subscription = EventBus.client.on(Events.Mcp.TOOL_RESULT, (payload) => {
                if (payload.data.requestId === requestId) {
                    subscription.unsubscribe();
                    clearTimeout(timeoutId);
                    resolve(payload.data.result);
                }
            });
            
            // Timeout after 30 seconds
            const timeoutId = setTimeout(() => {
                subscription.unsubscribe();
                reject(new Error(`Tool call timeout: ${name}`));
            }, 30000);
            
            // Emit tool call request
            const toolCallPayload = createMcpToolCallPayload(
                requestId, name, input, ...
            );
            EventBus.client.emit(Events.Mcp.TOOL_CALL, toolCallPayload);
        });
    };
}
```

### 3.3 Adding New Capabilities to SDK

**Option 1: Add a new tool to existing category**

1. Add tool to appropriate file in `src/shared/protocols/mcp/tools/`
2. Export in `src/shared/protocols/mcp/tools/index.ts`
3. Tool automatically registered on server start

**Option 2: Add a new handler module**

1. Create new handler extending `Handler` base class
2. In `MxfClient`, add:
   ```typescript
   protected newFeatureHandlers: NewFeatureHandlers | null;
   ```
3. Initialize in `connect()` method
4. Expose public methods that use EventBus

**Option 3: Add a new SDK service**

```typescript
// In src/sdk/services/NewFeatureService.ts
export class NewFeatureService {
    private mxfService: MxfService;
    
    constructor(mxfService: MxfService) {
        this.mxfService = mxfService;
    }
    
    async performFeature(): Promise<void> {
        // Implementation using mxfService
    }
}

// Expose via MxfClient
public newFeatureService: NewFeatureService;
// Initialize in connect() or constructor
```

---

## 4. EVENT SYSTEM ARCHITECTURE

### 4.1 Event Structure

**File**: `/Users/bradanderson/Development/model-exchange-framework/src/shared/events/EventNames.ts`

**Three-Layer Architecture**:

```
Layer 1: EventBusImplementation (Core)
├─ RxJS Subject-based observable streams
├─ .on() to listen, .emit() to publish
└─ Core filtering and routing

Layer 2: ClientEventBus
├─ Wraps: EventBusImplementation + Socket.IO
├─ Auto-forwards events to Socket.IO
└─ Used in: SDK clients

Layer 3: ServerEventBus
├─ Wraps: EventBusImplementation + Socket.IO + EventBridge
├─ Room-based broadcasting
├─ Automatic Socket.IO integration
└─ Used in: Server
```

### 4.2 Event Categories

```typescript
// Event namespace organization
Events = {
    Agent: {
        AGENT_REGISTERED,
        AGENT_JOINED,
        AGENT_LEFT,
        AGENT_DISCONNECTED,
        AGENT_HEARTBEAT,
        // ... more agent events
    },
    
    Message: {
        MESSAGE_SENT,
        MESSAGE_RECEIVED,
        MESSAGE_BROADCAST,
        MXP_MESSAGE,  // Model Exchange Protocol
        // ... more message events
    },
    
    Channel: {
        CHANNEL_CREATED,
        CHANNEL_CONTEXT_UPDATED,
        CHANNEL_MEMBERS_CHANGED,
        // ... more channel events
    },
    
    Memory: {
        MEMORY_CREATE,
        MEMORY_UPDATE,
        MEMORY_DELETE,
        MEMORY_GET,
        MEMORY_SYNC,
        // ... more memory events
    },
    
    Task: {
        TASK_REQUESTED,
        TASK_ASSIGNED,
        TASK_COMPLETED,
        TASK_FAILED,
        // ... more task events
    },
    
    Mcp: {
        TOOL_CALL,
        TOOL_RESULT,
        TOOL_ERROR,
        TOOL_REGISTER,
        TOOL_REGISTERED,
        TOOL_UNREGISTER,
        TOOL_UNREGISTERED,
        TOOL_REGISTRY_CHANGED,
        EXTERNAL_SERVER_STARTED,
        EXTERNAL_SERVER_STOPPED,
        EXTERNAL_SERVER_TOOLS_DISCOVERED,
        // ... more MCP events
    },
    
    ControlLoop: {
        CONTROL_LOOP_START,
        CONTROL_LOOP_OBSERVATION,
        CONTROL_LOOP_REASONING,
        CONTROL_LOOP_PLANNING,
        CONTROL_LOOP_ACTION,
        CONTROL_LOOP_REFLECTION,
        CONTROL_LOOP_COMPLETE,
        // ... more control loop events
    },
    
    Analytics: {
        ANALYTICS_RECORD,
        ANALYTICS_QUERY,
        // ... more analytics events
    },
    
    System: {
        SYSTEM_READY,
        SYSTEM_ERROR,
        SYSTEM_SHUTDOWN,
        // ... more system events
    }
}
```

### 4.3 Event Payload Structure

**Generic Event Payload**:

```typescript
interface BaseEventPayload {
    eventName: string;
    timestamp: number;
    agentId: string;
    channelId: string;
    data: Record<string, any>;
    metadata?: {
        requestId?: string;
        source?: 'sdk' | 'server';
        version?: string;
    };
}
```

**Example: MCP Tool Call Event**:

```typescript
interface McpToolCallEventPayload extends BaseEventPayload {
    data: {
        requestId: string;
        toolName: string;
        input: Record<string, any>;
    };
    metadata: {
        requestId: string;
        priority?: 'normal' | 'high' | 'urgent';
        timeout?: number;
    };
}
```

### 4.4 Event Listening Pattern

**Client Side**:

```typescript
// One-time listener
const subscription = EventBus.client.on(Events.Mcp.TOOL_RESULT, (payload) => {
    if (payload.data.requestId === targetRequestId) {
        subscription.unsubscribe();
        // Handle result
    }
});

// Persistent listener
EventBus.client.on(Events.Message.MESSAGE_RECEIVED, (payload) => {
    // Always listen for messages
    processMessage(payload.data);
});
```

**Server Side**:

```typescript
// Emit to all connected clients in channel
EventBus.server.emit(Events.Message.MESSAGE_SENT, payload);

// Listen in room
EventBus.server.on(Events.Agent.AGENT_JOINED, (payload) => {
    // Handle agent joining
});
```

---

## 5. DATABASE & MODELS

### 5.1 MongoDB Model Pattern

**File**: `/Users/bradanderson/Development/model-exchange-framework/src/shared/models/toolExecution.ts`

**Example Pattern**:

```typescript
import mongoose, { Document, Schema } from 'mongoose';

interface IToolExecution extends Document {
    toolId: mongoose.Types.ObjectId;
    parameters: Record<string, any>;
    userId: string;
    result: any;
    executionTime: Date;
    success: boolean;
    errorMessage?: string;
    approvalRequestId?: mongoose.Types.ObjectId;
}

const ToolExecutionSchema = new Schema<IToolExecution>({
    toolId: { type: Schema.Types.ObjectId, required: true, ref: 'Tool' },
    parameters: { type: Schema.Types.Mixed, required: true },
    userId: { type: String, required: true },
    result: { type: Schema.Types.Mixed },
    executionTime: { type: Date, default: Date.now },
    success: { type: Boolean, required: true },
    errorMessage: { type: String },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ToolApprovalRequest' }
});

// Indexes for performance
ToolExecutionSchema.index({ toolId: 1 });
ToolExecutionSchema.index({ userId: 1 });
ToolExecutionSchema.index({ executionTime: 1 });
ToolExecutionSchema.index({ success: 1 });

export const ToolExecution = mongoose.model<IToolExecution>(
    'ToolExecution',
    ToolExecutionSchema
);
```

**Model Pattern Characteristics**:
1. **Type-safe**: Interface extending Document for TypeScript support
2. **Schema definition**: Mongoose schema with types and constraints
3. **Indexes**: Performance optimization for common queries
4. **Timestamps**: Automatic tracking of creation/modification
5. **References**: Support for relationships via `ref`

### 5.2 Models Related to Code Execution

**Relevant Models**:
- `toolExecution.ts`: Stores tool call results and history
- `controlLoop.ts`: ORPAR cycle state and progress
- `memory.ts`: Agent/channel memory storage
- `PatternLearningModels.ts`: Learned execution patterns
- `taskEffectiveness.ts`: Task completion metrics

---

## 6. SECURITY & VALIDATION

### 6.1 Dual Authentication

**File**: `/Users/bradanderson/Development/model-exchange-framework/src/server/api/middleware/dualAuth.ts`

**Flow**:

```
Request arrives
    ↓
authenticateDual middleware
    ├─ Try JWT Authentication
    │  ├─ Extract Bearer token from Authorization header
    │  ├─ Verify with JWT_SECRET
    │  ├─ Validate userId in token
    │  └─ If success: attach user data, return
    │
    └─ Try Key-Based Authentication
       ├─ Look for keyId and secretKey in:
       │  ├─ Headers (x-key-id, x-secret-key)
       │  ├─ Query parameters (keyId, secretKey)
       │  ├─ Request body (keyId, secretKey)
       │  └─ URL parameters (legacy support)
       │
       ├─ Validate key credentials with KeyAuthHelper
       └─ If success: attach agent data, return
           
        If both fail: Return 401 Unauthorized
```

**JWT Authentication**:
```typescript
// User authentication
const token = authHeader.split(' ')[1];
const decoded = jwt.verify(token, process.env.JWT_SECRET);
const user = await User.findById(decoded.userId);
// Returns: { id, username, email, role }
```

**Key-Based Authentication**:
```typescript
// Agent authentication
const validation = await KeyAuthHelper.getInstance()
    .validateKey(keyId, secretKey);
// Returns: { valid, agentId, channelId }
```

### 6.2 Path Validation for Tools

**Security Guard Pattern** (from InfrastructureTools):

```typescript
import { getSecurityGuard, SecurityContext } from '../security/McpSecurityGuard';

const securityGuard = getSecurityGuard(process.cwd());

// Usage in tool handler
const pathValidation = securityGuard.validatePath(input.path, 'read');
if (!pathValidation.allowed) {
    throw new Error(pathValidation.reason);
}
```

**Validation includes**:
- Path traversal prevention
- Restricted directory checks
- Symbolic link validation
- Permission verification

### 6.3 Confirmation Manager

**Pattern** (used by destructive operations):

```typescript
import { getConfirmationManager } from '../security/McpConfirmationManager';

const confirmationManager = getConfirmationManager();

// Require approval for destructive operations
if (!input.confirmed) {
    // Request confirmation from user/agent
    // Return: { requiresConfirmation: true, confirmationId: "..." }
}
```

---

## 7. HOW CODE EXECUTION FEATURES FIT IN

### 7.1 Natural Integration Points

**Option A: Add to InfrastructureTools** (if shell-like execution)

```typescript
// src/shared/protocols/mcp/tools/CodeExecutionTools.ts

export const codeExecuteTool = {
    name: INFRASTRUCTURE_TOOLS.CODE_EXECUTE,
    description: 'Execute code in various languages with sandboxing',
    inputSchema: {
        type: 'object',
        properties: {
            language: {
                type: 'string',
                enum: ['javascript', 'python', 'typescript', 'shell'],
                description: 'Language to execute'
            },
            code: {
                type: 'string',
                description: 'Code to execute',
                minLength: 1
            },
            timeout: {
                type: 'number',
                default: 5000,
                description: 'Execution timeout in milliseconds'
            },
            environment: {
                type: 'object',
                description: 'Environment variables to pass',
                additionalProperties: { type: 'string' }
            },
            captureOutput: {
                type: 'boolean',
                default: true,
                description: 'Capture stdout/stderr'
            }
        },
        required: ['language', 'code'],
        additionalProperties: false
    },
    examples: [
        {
            input: {
                language: 'javascript',
                code: 'console.log("Hello"); return 42;'
            },
            description: 'Execute JavaScript code'
        }
    ],
    async handler(input: {
        language: string;
        code: string;
        timeout?: number;
        environment?: Record<string, string>;
        captureOutput?: boolean;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) {
        try {
            validator.assertIsString(input.language);
            validator.assertIsString(input.code);
            
            // Path validation for temp files if needed
            const pathValidation = securityGuard.validatePath(
                process.cwd(),
                'write'
            );
            if (!pathValidation.allowed) {
                throw new Error('Cannot execute code in this directory');
            }
            
            const startTime = Date.now();
            
            // Route to appropriate executor
            let result;
            switch (input.language) {
                case 'javascript':
                    result = await executeJavaScript(input.code, input);
                    break;
                case 'python':
                    result = await executePython(input.code, input);
                    break;
                case 'typescript':
                    result = await executeTypeScript(input.code, input);
                    break;
                case 'shell':
                    result = await executeShell(input.code, input);
                    break;
                default:
                    throw new Error(`Unsupported language: ${input.language}`);
            }
            
            const executionTime = Date.now() - startTime;
            
            // Record in analytics
            await ValidationPerformanceService.getInstance()
                .recordToolExecution({
                    toolName: 'code_execute',
                    agentId: context.agentId,
                    channelId: context.channelId,
                    success: result.exitCode === 0,
                    executionTime,
                    metadata: {
                        language: input.language,
                        outputLength: result.stdout?.length || 0
                    }
                });
            
            return {
                exitCode: result.exitCode,
                stdout: input.captureOutput !== false ? result.stdout : undefined,
                stderr: input.captureOutput !== false ? result.stderr : undefined,
                executionTime,
                executedAt: Date.now()
            };
        } catch (error) {
            logger.error(`Code execution failed: ${error}`);
            throw new Error(`Code execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
```

**Option B: Create new CodeExecutionTools category**

1. Create `/src/shared/protocols/mcp/tools/CodeExecutionTools.ts`
2. Export tools in `/src/shared/protocols/mcp/tools/index.ts`:
   ```typescript
   import { codeExecutionTools } from './CodeExecutionTools';
   
   export const mxfMcpTools = {
       // ... existing categories
       codeExecution: codeExecutionTools
   };
   
   export const allMxfMcpTools = [
       // ... existing tools
       ...codeExecutionTools
   ];
   ```

### 7.2 Event Integration for Code Execution

**Events to emit**:

```typescript
// When code execution starts
EventBus.server.emit(Events.System.CODE_EXECUTION_STARTED, {
    eventName: Events.System.CODE_EXECUTION_STARTED,
    timestamp: Date.now(),
    agentId: context.agentId,
    channelId: context.channelId,
    data: {
        language: input.language,
        codeLength: input.code.length,
        timeout: input.timeout
    }
});

// When code execution completes
EventBus.server.emit(Events.System.CODE_EXECUTION_COMPLETED, {
    eventName: Events.System.CODE_EXECUTION_COMPLETED,
    timestamp: Date.now(),
    agentId: context.agentId,
    channelId: context.channelId,
    data: {
        language: input.language,
        success: result.exitCode === 0,
        executionTime,
        outputSize: result.stdout?.length || 0
    }
});
```

### 7.3 Database Storage Pattern

```typescript
// Create new model for code execution history
interface ICodeExecution extends Document {
    agentId: string;
    channelId: string;
    language: string;
    codeHash: string;        // Hash of code for deduplication
    codeLength: number;
    exitCode: number;
    stdout: string;
    stderr?: string;
    executionTime: number;
    timestamp: Date;
    success: boolean;
    errorMessage?: string;
    environment?: Record<string, string>;
    requestId: string;
}

const CodeExecutionSchema = new Schema<ICodeExecution>({
    agentId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    language: { type: String, required: true },
    codeHash: { type: String, required: true },
    codeLength: { type: Number, required: true },
    exitCode: { type: Number, required: true },
    stdout: { type: String, required: true },
    stderr: { type: String },
    executionTime: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now, index: true },
    success: { type: Boolean, required: true },
    errorMessage: { type: String },
    environment: { type: Schema.Types.Mixed },
    requestId: { type: String, required: true, unique: true }
});

// TTL index: auto-delete after 30 days
CodeExecutionSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

export const CodeExecution = mongoose.model<ICodeExecution>(
    'CodeExecution',
    CodeExecutionSchema
);
```

### 7.4 Validation Integration

**Code execution would trigger**:

```typescript
// Pre-execution validation
const validation = await ProactiveValidationService.getInstance()
    .validateToolCall(
        context.agentId,
        context.channelId,
        'code_execute',
        {
            language: input.language,
            code: input.code,
            timeout: input.timeout
        },
        context.requestId
    );

if (!validation.valid) {
    // Check severity of errors
    const highSeverityErrors = validation.errors
        .filter(e => e.severity === 'HIGH');
    
    if (highSeverityErrors.length > 0) {
        // Block execution
        throw new Error(
            `Validation failed: ${highSeverityErrors[0].message}`
        );
    }
}

// Proceed with execution...
```

### 7.5 Pattern Learning Integration

```typescript
// After code execution completes, record pattern
const pattern = {
    toolName: 'code_execute',
    language: input.language,
    codeLength: input.code.length,
    timeout: input.timeout,
    success: result.exitCode === 0,
    executionTime,
    errorType: !result.success ? result.stderr : null
};

await PatternLearningService.getInstance()
    .recordToolExecution(
        context.agentId,
        context.channelId,
        'code_execute',
        { language: input.language, timeout: input.timeout },
        result.success,
        {
            executionTime,
            pattern: pattern.codeLength,
            errorMessage: pattern.errorType
        }
    );
```

---

## 8. SUMMARY OF KEY INTEGRATION PATTERNS

### Code Execution Natural Fit:

1. **Tool Category**: InfrastructureTools (most natural) or new CodeExecutionTools
2. **Event emissions**: System.CODE_EXECUTION_* events for monitoring
3. **Validation**: ProactiveValidationService with BLOCKING level by default
4. **Database**: CodeExecution model with TTL indexes for history
5. **Analytics**: Record via ValidationPerformanceService and PatternLearningService
6. **Security**: Path validation + code analysis for safety
7. **SDK Integration**: Expose via McpToolHandlers.callTool('code_execute', input)

### Key Leverage Points:

- **Validation System**: Automatically prevents unsafe patterns
- **Pattern Learning**: Learns from execution history across agents
- **Analytics**: Tracks success rates, performance, error patterns
- **Event System**: Real-time monitoring and coordination
- **Tool Discovery**: auto-recommended by tools_recommend based on intent
- **Error Recovery**: tools_recommend_on_error suggests alternatives

---

## Key Files Reference

```
Core Architecture:
- src/server/index.ts                    // Server initialization order
- src/shared/services/SystemLlmService.ts // LLM orchestration
- src/shared/services/MxfMeilisearchService.ts // Search engine
- src/shared/services/ProactiveValidationService.ts // Validation
- src/shared/services/ValidationPerformanceService.ts // Learning

Tool System:
- src/shared/protocols/mcp/tools/index.ts // Tool exports
- src/shared/protocols/mcp/services/HybridMcpToolRegistry.ts // Unified registry
- src/shared/protocols/mcp/services/HybridMcpService.ts // Service
- src/server/api/services/McpToolRegistry.ts // Internal registry

SDK & Events:
- src/sdk/MxfClient.ts                   // SDK main class
- src/sdk/handlers/McpToolHandlers.ts    // Tool event handlers
- src/shared/events/EventNames.ts        // Event definitions
- src/shared/events/EventBus.ts          // Event bus implementation

Security:
- src/server/api/middleware/dualAuth.ts  // Authentication
- src/shared/protocols/mcp/security/McpSecurityGuard.ts // Path validation

Models:
- src/shared/models/toolExecution.ts     // Execution history
- src/shared/models/controlLoop.ts       // Control state
- src/shared/models/PatternLearningModels.ts // Pattern storage
```

