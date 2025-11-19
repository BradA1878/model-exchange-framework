# MXF Architecture Quick Reference Guide

## File Location Map

### Core Services
```
src/shared/services/
├── SystemLlmService.ts                    [LLM orchestration with ORPAR phases]
├── MxfMeilisearchService.ts               [Search engine with embeddings]
├── ProactiveValidationService.ts          [Pre-execution validation]
├── ValidationPerformanceService.ts        [Validation metrics tracking]
├── PatternLearningService.ts              [Pattern learning from executions]
├── AutoCorrectionService.ts               [Parameter auto-correction]
└── ChannelContextService.ts               [Channel state management]
```

### Tool System
```
src/shared/protocols/mcp/
├── tools/
│   ├── index.ts                           [Tool exports & registry]
│   ├── InfrastructureTools.ts             [Filesystem, shell, memory tools]
│   ├── MetaTools.ts                       [tools_recommend, tools_discover]
│   ├── ToolHelpTools.ts                   [tool_help, tool_validate]
│   ├── MemorySearchTools.ts               [memory_search_conversations, etc]
│   ├── ControlLoopTools.ts                [ORPAR cycle tools]
│   ├── AgentCommunicationTools.ts         [Agent messaging]
│   └── [20+ other tool files]
│
└── services/
    ├── HybridMcpService.ts                [Unified tool service]
    ├── HybridMcpToolRegistry.ts           [Combines internal + external tools]
    └── ExternalMcpServerManager.ts        [External server lifecycle]
```

### Server Services
```
src/server/
├── index.ts                               [Server initialization order - START HERE]
├── api/
│   ├── services/
│   │   ├── McpToolRegistry.ts             [Internal tool registration]
│   │   └── ServerHybridMcpService.ts      [Hybrid service server-side]
│   ├── middleware/
│   │   └── dualAuth.ts                    [JWT + API key authentication]
│   └── controllers/                       [REST API handlers]
│
└── socket/
    ├── services/
    │   ├── SocketService.ts               [Socket.IO management]
    │   ├── AgentService.ts                [Agent lifecycle]
    │   ├── ChannelService.ts              [Channel operations]
    │   └── McpSocketExecutor.ts           [Tool execution via sockets]
    └── handlers/                          [Socket event handlers]
```

### SDK & Client
```
src/sdk/
├── MxfClient.ts                           [Main SDK client class]
├── services/
│   ├── MxfService.ts                      [SDK service layer]
│   ├── MxfToolService.ts                  [Tool management in SDK]
│   └── MxfApiService.ts                   [API communication]
│
└── handlers/
    ├── McpToolHandlers.ts                 [Tool call/register/unregister]
    ├── MessageHandlers.ts                 [Message receiving/sending]
    ├── ControlLoopHandlers.ts             [ORPAR cycle events]
    ├── MemoryHandlers.ts                  [Memory operations]
    ├── TaskHandlers.ts                    [Task lifecycle]
    └── Handler.ts                         [Base handler class]
```

### Events & Types
```
src/shared/
├── events/
│   ├── EventNames.ts                      [ALL event definitions - central registry]
│   ├── EventBus.ts                        [Core event bus implementation]
│   ├── ClientEventBus.ts                  [Client-side event bus]
│   ├── ServerEventBus.ts                  [Server-side event bus]
│   └── event-definitions/
│       ├── McpEvents.ts                   [Tool/MCP events]
│       ├── ControlLoopEvents.ts           [ORPAR events]
│       ├── TaskEvents.ts                  [Task events]
│       └── [other event categories]
│
├── types/
│   ├── toolTypes.ts                       [Tool type definitions]
│   ├── ControlLoopTypes.ts                [ORPAR types]
│   ├── PatternLearningTypes.ts            [Pattern types]
│   └── ValidationPerformanceTypes.ts      [Validation types]
│
└── models/
    ├── toolExecution.ts                   [Execution history]
    ├── controlLoop.ts                     [ORPAR state]
    ├── memory.ts                          [Memory storage]
    ├── PatternLearningModels.ts           [Learned patterns]
    └── mcpTool.ts                         [Tool definition storage]
```

### Security
```
src/shared/protocols/mcp/security/
├── McpSecurityGuard.ts                    [Path validation, directory restrictions]
└── McpConfirmationManager.ts              [Approval workflow for destructive ops]
```

---

## Key Initialization Sequence (Most Important)

**Location**: `src/server/index.ts` lines 107-341

```
1. MemoryService.getInstance() with persistence
2. connectToDatabase()
3. MxfMeilisearchService.getInstance().initialize()
4. Core services: SocketService, McpSocketExecutor, McpToolRegistry, etc.
5. EphemeralEventPatternService.initialize()
6. ServerHybridMcpService.getInstance().initialize()
7. McpService.getInstance().initialize()
8. Load tools from database + register new tools
9. Mount API routes
10. server.listen(PORT)
```

**Why Order Matters**:
- Database must connect before persistence operations
- MCP services depend on EventBus being ready
- Tool registry must load before Hybrid service
- API routes mount after all services initialized

---

## Service Dependency Graph

```
MxfMeilisearchService (search)
    ↓ used by
ValidationPerformanceService (learning)
    ↓ used by
ProactiveValidationService (validation)
    ↑ validates tools for
HybridMcpToolRegistry (unified interface)
    ├── uses: McpToolRegistry (internal)
    └── uses: ExternalMcpServerManager (external)
        
McpToolRegistry (internal tools)
    ├── listTools() → Observable
    └── registerTool() → Observable
    
PatternLearningService (pattern learning)
    ↓ learns from
EventBus.server.on(Events.Mcp.TOOL_RESULT)
EventBus.server.on(Events.Mcp.TOOL_ERROR)
```

---

## Adding New Features

### Adding a New Tool

1. **Create tool file** in `src/shared/protocols/mcp/tools/`
   ```typescript
   export const myNewTool = {
       name: 'my_new_tool',
       description: '...',
       inputSchema: { /* JSON Schema */ },
       examples: [ /* example usages */ ],
       async handler(input, context) {
           // Validation
           validator.assertIsString(input.field);
           
           // Security
           const validation = securityGuard.validatePath(...);
           
           // Logging
           logger.info(`Executing for agent ${context.agentId}`);
           
           // Implementation
           // ...
           
           // Return typed result
           return { /* result */ };
       }
   };
   ```

2. **Export in index.ts**
   ```typescript
   // src/shared/protocols/mcp/tools/index.ts
   import { myNewTool } from './MyNewTools';
   export const allMxfMcpTools = [
       // ... existing tools
       myNewTool
   ];
   ```

3. **Server will auto-register on startup**
   - No other changes needed
   - Tool available via HybridMcpToolRegistry.getToolByName()

### Adding Event Listening

1. **Add event definition** in `src/shared/events/event-definitions/`
   ```typescript
   export const MyEvents = {
       MY_EVENT_NAME: 'my:event:name'
   };
   ```

2. **Use in code**
   ```typescript
   // Emit
   EventBus.server.emit(Events.My.MY_EVENT_NAME, payload);
   
   // Listen
   EventBus.server.on(Events.My.MY_EVENT_NAME, (payload) => {
       // Handle
   });
   ```

### Adding SDK Handler

1. **Create handler class**
   ```typescript
   export class MyFeatureHandlers extends Handler {
       public myFeatureCall = (param: string): Promise<any> => {
           return new Promise((resolve, reject) => {
               const subscription = EventBus.client.on(Events.My.RESPONSE, (payload) => {
                   subscription.unsubscribe();
                   resolve(payload.data);
               });
               EventBus.client.emit(Events.My.REQUEST, { param });
           });
       };
   }
   ```

2. **Add to MxfClient**
   ```typescript
   // src/sdk/MxfClient.ts
   protected myFeatureHandlers: MyFeatureHandlers | null;
   
   // In connect()
   this.myFeatureHandlers = new MyFeatureHandlers(`MyFeatureHandlers:${this.agentId}`);
   ```

---

## Event Payload Pattern

Every event follows this structure:

```typescript
interface BaseEventPayload {
    eventName: string;              // Full event name
    timestamp: number;              // Milliseconds since epoch
    agentId: string;                // Originating agent
    channelId: string;              // Associated channel
    data: Record<string, any>;      // Event-specific data
    metadata?: {
        requestId?: string;         // Tracking request
        source?: 'sdk' | 'server';  // Where it came from
        version?: string;           // Protocol version
    };
}
```

---

## Validation Levels

```typescript
ValidationLevel.NONE        // No validation
ValidationLevel.ASYNC       // Background validation
ValidationLevel.BLOCKING    // Block until valid (default)
ValidationLevel.STRICT      // Enhanced security checks
```

**Assignment Logic**:
- Risk score >= 0.8 → STRICT
- Risk score >= 0.5 → BLOCKING
- Risk score >= 0.2 → ASYNC
- Risk score < 0.2 → Use base level for tool

---

## Tool Naming Conventions

```
agent_*                     // Agent communication tools
channel_*                   // Channel operations
control_loop_*              // ORPAR cycle tools
memory_*                    // Memory operations
fs_*                        // Filesystem operations
shell_*                     // Shell execution
tools_*                     // Meta-tools
```

---

## Important Environment Variables

```
# Server
MONGODB_URI                 // MongoDB connection
JWT_SECRET                  // JWT signing key
AGENT_FRAMEWORK_PORT        // Server port (default: 3001)

# Meilisearch
ENABLE_MEILISEARCH          // true/false
MEILISEARCH_HOST            // Meilisearch URL
MEILISEARCH_MASTER_KEY      // Meilisearch API key
MEILISEARCH_EMBEDDING_MODEL // text-embedding-3-small (default)
MEILISEARCH_EMBEDDING_PROVIDER // openai, openrouter, anthropic

# LLM
OPENROUTER_API_KEY          // OpenRouter for proxying models
OPENAI_API_KEY              // OpenAI API key
ANTHROPIC_API_KEY           // Anthropic API key

# Validation
VALIDATION_DEFAULT_LEVEL    // ASYNC, BLOCKING, STRICT (default: ASYNC)
AUTO_CORRECTION_ENABLED     // true/false (default: true)
```

---

## Testing & Development

```bash
# Start development server with hot reload
npm run start:dev

# Run all tests
npm test

# Run specific test file
NODE_ENV=test ts-node tests/llm-agent-demo.ts

# Build project
npm run build

# Check Meilisearch health
curl http://localhost:7700/health
```

---

## Common Patterns

### Singleton Service Pattern
```typescript
export class MyService {
    private static instance: MyService;
    private constructor() { }
    public static getInstance(): MyService {
        if (!MyService.instance) {
            MyService.instance = new MyService();
        }
        return MyService.instance;
    }
}
```

### Input Validation Pattern
```typescript
const validator = createStrictValidator('MyTool');
validator.assertIsString(input.field, 'field');
validator.assertIsObject(input.config);
validator.assert(input.value > 0, 'value must be positive');
```

### Tool Handler Pattern
```typescript
async handler(input: InputType, context: {
    agentId: string;
    channelId: string;
    requestId: string;
}): Promise<OutputType> {
    try {
        validator.assertIsString(input.param);
        logger.info(`Processing for agent ${context.agentId}`);
        
        // Implementation
        const result = await doSomething(input);
        
        return { success: true, data: result };
    } catch (error) {
        logger.error(`Failed: ${error}`);
        throw new Error(`Tool failed: ${error}`);
    }
}
```

---

## What to Read First

1. **Understanding the architecture**: `src/server/index.ts` (initialization)
2. **Tool system**: `src/shared/protocols/mcp/tools/index.ts` + `HybridMcpService.ts`
3. **Events**: `src/shared/events/EventNames.ts`
4. **SDK**: `src/sdk/MxfClient.ts`
5. **Services**: `src/shared/services/ProactiveValidationService.ts`

## Next: Code Execution Integration

See: `MXF_ARCHITECTURE_ANALYSIS.md` section 7 for:
- How to add code execution tools
- Event integration points
- Database model patterns
- Validation integration
- Pattern learning integration
