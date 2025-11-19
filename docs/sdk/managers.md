# SDK Manager Classes

The MXF SDK includes several manager classes that handle specific aspects of agent functionality. These managers work together to provide comprehensive agent capabilities including MCP client management, memory management, system prompt management, and task execution.

## Overview

The SDK provides four core manager classes:

1. **MxfMcpClientManager**: Manages MCP (Model Context Protocol) client connections and tool discovery
2. **MxfMemoryManager**: Handles conversation history and memory deduplication
3. **MxfSystemPromptManager**: Manages system prompts and tool documentation
4. **MxfTaskExecutionManager**: Coordinates task execution and result handling

These managers are used internally by `MxfAgent` and `MxfClient` but can also be used independently for custom agent implementations.

## MxfMcpClientManager

Manages MCP client connections for accessing external tools and resources.

### Purpose

- Initialize and manage MCP client connections
- Handle tool discovery from MCP servers
- Cache tool metadata for performance
- Provide tool access to agents

### Key Features

- **Lazy Connection**: MCP clients connect only when tools are needed
- **Tool Caching**: Discovered tools are cached to minimize API calls
- **Error Handling**: Graceful degradation if MCP servers are unavailable
- **Multiple Providers**: Supports connections to multiple MCP servers

### Usage

```typescript
import { MxfMcpClientManager } from './src/sdk/managers/MxfMcpClientManager';

// Typically used within MxfAgent, but can be used standalone
const mcpManager = new MxfMcpClientManager(agentId, config);

// Get available tools from all connected MCP servers
const tools = await mcpManager.getAvailableTools();

// Execute a tool
const result = await mcpManager.executeTool({
    name: 'calculator_add',
    arguments: { a: 5, b: 3 }
});
```

### Integration Points

- Integrates with `ServerHybridMcpService` for server-side tool execution
- Uses `McpToolRegistry` for tool discovery
- Leverages `EventBus` for tool execution events

## MxfMemoryManager

Manages conversation history with intelligent deduplication and memory scoping.

### Purpose

- Store and retrieve conversation messages
- Prevent duplicate messages in conversation history
- Manage conversation context window
- Support multiple memory scopes (agent, channel, shared)

### Key Features

- **Intelligent Deduplication**: Prevents duplicate messages while preserving tool results
- **Tool Result Preservation**: Never deduplicates tool results (critical for LLM providers)
- **Conversation Windowing**: Maintains optimal context window size
- **Memory Scoping**: Supports agent-private, channel-shared, and global memory

### Usage

```typescript
import { MxfMemoryManager } from './src/sdk/managers/MxfMemoryManager';

// Create memory manager for an agent
const memoryManager = new MxfMemoryManager(agentId, channelId);

// Add message to conversation history
memoryManager.addMessage({
    role: 'user',
    content: 'Hello, agent!'
});

// Get conversation history
const messages = memoryManager.getConversationHistory();

// Get recent messages (last N)
const recentMessages = memoryManager.getRecentMessages(10);

// Clear conversation history
memoryManager.clearConversation();

// Check if message would be duplicate
const isDuplicate = memoryManager.isDuplicateMessage(newMessage);
```

### Critical Implementation Details

#### Tool Result Deduplication

**IMPORTANT**: The MxfMemoryManager has special handling for tool results:

```typescript
// Tool results are NEVER deduplicated, even if content is identical
// This is critical for LLM providers like OpenRouter and Bedrock

if (newMessage.role === 'tool' || 
    (newMessage.metadata && newMessage.metadata.isToolResult)) {
    return false; // Never mark tool results as duplicates
}
```

**Why This Matters**:
- Multiple tools can return identical content (e.g., "Success")
- Each tool result has a unique `tool_call_id`
- LLM providers require 1:1 pairing of tool_call → tool_result
- Deduplicating tool results breaks this pairing and causes API errors

#### Single Source of Truth

Tool results exist ONLY in conversation history. There is no dual-tracking mechanism (e.g., no `pendingToolResults` array). This ensures:
- No duplicate tool results in conversation
- Proper ordering via `createMcpMessages()` reordering
- Clean conversation flow

### Memory Scopes

```typescript
enum MemoryScope {
    AGENT = 'agent',      // Private to agent
    CHANNEL = 'channel',  // Shared with channel
    SHARED = 'shared',    // Global/shared
    RELATIONSHIP = 'relationship'  // Between two agents
}

// Get memory for specific scope
const agentMemory = await agent.getMemory(MemoryScope.AGENT);
const channelMemory = await agent.getMemory(MemoryScope.CHANNEL);
```

## MxfSystemPromptManager

Manages system prompts and tool documentation for LLM interactions.

### Purpose

- Generate comprehensive system prompts for agents
- Include tool documentation in prompts
- Filter tools based on agent permissions (`allowedTools`)
- Support both standard and MXP-optimized prompts

### Key Features

- **Dynamic Tool Documentation**: Automatically generates tool documentation
- **Tool Filtering**: Respects `allowedTools` configuration
- **MXP Support**: Can generate MXP-optimized prompts
- **Layered Prompts**: Supports layered prompt assembly
- **Context Awareness**: Includes channel and agent context
- **Dynamic Template Replacement**: Real-time template replacement on every API request

### Usage

```typescript
import { MxfSystemPromptManager } from './src/sdk/managers/MxfSystemPromptManager';

// Create system prompt manager
const promptManager = new MxfSystemPromptManager(agentConfig);

// Get system prompt with tool documentation
const systemPrompt = await promptManager.getSystemPrompt({
    includeTools: true,
    allowedTools: ['messaging_send', 'task_complete'],  // Filter tools
    channelContext: channelData
});

// Get MXP-optimized prompt
const mxpPrompt = await promptManager.getMxpOptimizedPrompt({
    includeTools: true,
    compressionLevel: 'standard'
});
```

### Tool Filtering

The System Prompt Manager respects the `allowedTools` configuration:

```typescript
// Only document allowed tools
const filteredPrompt = await promptManager.getSystemPrompt({
    includeTools: true,
    allowedTools: [
        'messaging_send',
        'messaging_coordinate',
        'tools_recommend',
        'channel_context_get'
    ]
});
```

**Benefits**:
- Reduces prompt size by excluding forbidden tools
- Prevents agents from attempting to use unavailable tools
- Improves LLM focus on relevant tools
- Enhances security through least-privilege principle

### Dynamic Template Replacement

The System Prompt Manager includes a powerful template replacement system that updates dynamic values on **every API request** without modifying the cached system prompt.

#### Available Templates

**Temporal Templates** (always fresh):
- `{{DATE_TIME}}` - Full formatted date/time (e.g., "Friday, October 10, 2025 at 5:17:32 PM MDT")
- `{{DAY_OF_WEEK}}` - Day name (e.g., "Friday")
- `{{CURRENT_YEAR}}` - Current year (e.g., "2025")
- `{{CURRENT_MONTH}}` - Month name (e.g., "October")
- `{{CURRENT_DAY}}` - Day of month (e.g., "10")
- `{{TIME_ZONE}}` - IANA timezone (e.g., "America/Denver")
- `{{ISO_TIMESTAMP}}` - ISO 8601 format (e.g., "2025-10-10T17:17:32.000Z")
- `{{OS_PLATFORM}}` - Operating system (e.g., "macOS", "Linux", "Windows")

**Context Templates** (updated per request):
- `{{AGENT_ID}}` - Agent identifier
- `{{CHANNEL_ID}}` - Channel identifier
- `{{CHANNEL_NAME}}` - Human-readable channel name
- `{{ACTIVE_AGENTS_COUNT}}` - Number of active agents in channel
- `{{ACTIVE_AGENTS_LIST}}` - Comma-separated list of active agents

**Configuration Templates**:
- `{{LLM_PROVIDER}}` - LLM provider name (e.g., "azure-openai", "openrouter")
- `{{LLM_MODEL}}` - Model name (e.g., "gpt-4o-mini", "claude-3-5-sonnet")
- `{{SYSTEM_LLM_STATUS}}` - "Enabled" or "Disabled"

**Control Loop Templates**:
- `{{CURRENT_ORPAR_PHASE}}` - Current ORPAR phase (Observe/Reason/Plan/Act/Reflect)

#### How It Works

Templates are replaced via `PromptTemplateReplacer.replaceTemplates()` in `MxfContextBuilder.buildContext()`:

```typescript
// System prompt is built once with templates
const systemPrompt = `
**Current Date/Time**: {{DATE_TIME}}
**Your Timezone**: {{TIME_ZONE}}
**Active Agents**: {{ACTIVE_AGENTS_COUNT}}
`;

// Templates are replaced fresh on every API request
const enhancedSystemPrompt = PromptTemplateReplacer.replaceTemplates(systemPrompt, {
    agentId: 'my-agent',
    channelId: 'channel-123',
    llmProvider: 'azure-openai',
    llmModel: 'gpt-4o-mini',
    systemLlmEnabled: true
});
```

**Result on Oct 10, 2025 at 5:17 PM**:
```markdown
**Current Date/Time**: Friday, October 10, 2025 at 5:17:32 PM MDT
**Your Timezone**: America/Denver
**Active Agents**: 3
```

#### Benefits

- **Always Current**: Date/time values are fresh on every request
- **No Cache Pollution**: Cached system prompts preserve templates
- **Context Awareness**: Agents know their environment and collaborators
- **Scheduling Capable**: Agents can make time-based decisions
- **Collaboration Ready**: Agents know who they can work with
- **Environment Aware**: OS platform info for environment-specific operations

#### Example Agent Identity Section

When templates are replaced, agents see:

```markdown
## Your Agent Identity

**You are**: DateTime Agent
**Your Agent ID**: datetime-agent
**Operating in Channel ID**: azure-simple-demo-123

**Current Date/Time**: Friday, October 10, 2025 at 5:17:32 PM MDT
**Day**: Friday, October 10, 2025
**Your Timezone**: America/Denver
**OS Platform**: macOS

**Active Agents in Channel**: 3
**Available for Collaboration**: scheduler-bot, calendar-agent, datetime-agent

**Your LLM Configuration**: azure-openai (gpt-4o-mini)
**SystemLLM Status**: Enabled

You are operating in real-time. The information above is updated automatically 
with each request. Always consider the current context when responding to 
time-sensitive or collaborative requests.
```

### Integration with MxfStructuredPromptBuilder

The System Prompt Manager uses `MxfStructuredPromptBuilder` internally for layered prompt assembly:

```typescript
// Layered prompt structure
{
    systemPrompt: "Base system instructions",
    toolDocumentation: "Available tools and their usage",
    context: {
        channel: "Channel-specific context",
        agent: "Agent-specific context",
        memory: "Relevant memory"
    },
    constraints: "Operational constraints"
}
```

## MxfTaskExecutionManager

Coordinates task execution and result handling for agents.

### Purpose

- Manage task lifecycle (received, in_progress, completed, failed)
- Track task progress and execution state
- Handle task result reporting
- Coordinate with server-side task management

### Key Features

- **State Management**: Track task execution state
- **Progress Updates**: Report task progress to server
- **Result Handling**: Format and submit task results
- **Error Recovery**: Handle task failures gracefully
- **Event Integration**: Emit task-related events

### Usage

```typescript
import { MxfTaskExecutionManager } from './src/sdk/managers/MxfTaskExecutionManager';

// Create task execution manager
const taskManager = new MxfTaskExecutionManager(agentId, socketConnection);

// Register task handler
taskManager.setTaskHandler(async (task) => {
    // Execute task
    const result = await processTask(task);
    
    // Return result
    return {
        success: true,
        result: result,
        metadata: { processingTime: Date.now() }
    };
});

// Update task progress
await taskManager.updateTaskProgress(taskId, {
    status: 'in_progress',
    progress: 50,
    message: 'Processing...'
});

// Report task completion
await taskManager.reportTaskComplete(taskId, {
    success: true,
    result: finalResult
});

// Report task failure
await taskManager.reportTaskFailure(taskId, {
    error: 'Task failed',
    reason: 'Invalid input'
});
```

### Task Lifecycle

```
received → in_progress → completed
                ↓
            failed
```

### Task Completion Patterns

The Task Execution Manager supports autonomous task completion:

```typescript
// Autonomous task completion
taskManager.setTaskHandler(async (task) => {
    if (task.description.includes('task_complete')) {
        // Agent should call task_complete tool when done
        return {
            success: true,
            message: 'Agent will signal completion via task_complete'
        };
    }
    
    // Traditional immediate completion
    return {
        success: true,
        result: await executeTask(task)
    };
});
```

## Manager Interaction Patterns

The managers work together within `MxfAgent`:

```typescript
class MxfAgent extends MxfClient {
    private mcpManager: MxfMcpClientManager;
    private memoryManager: MxfMemoryManager;
    private promptManager: MxfSystemPromptManager;
    private taskManager: MxfTaskExecutionManager;
    
    async processLlmRequest() {
        // 1. Get system prompt with tools
        const systemPrompt = await this.promptManager.getSystemPrompt({
            includeTools: true,
            allowedTools: this.config.allowedTools
        });
        
        // 2. Get conversation history
        const messages = this.memoryManager.getConversationHistory();
        
        // 3. Get available tools
        const tools = await this.mcpManager.getAvailableTools();
        
        // 4. Call LLM
        const response = await this.callLlm({
            systemPrompt,
            messages,
            tools
        });
        
        // 5. Add response to memory
        this.memoryManager.addMessage(response);
        
        // 6. If tool calls, execute via mcpManager
        if (response.tool_calls) {
            for (const toolCall of response.tool_calls) {
                const result = await this.mcpManager.executeTool(toolCall);
                
                // Add tool result to memory (will NOT be deduplicated)
                this.memoryManager.addMessage({
                    role: 'tool',
                    content: result,
                    tool_call_id: toolCall.id
                });
            }
        }
    }
}
```

## Advanced Usage Patterns

### Custom Memory Manager

Create a custom memory manager with different deduplication logic:

```typescript
class CustomMemoryManager extends MxfMemoryManager {
    protected isDuplicateMessage(message: ConversationMessage): boolean {
        // Custom deduplication logic
        
        // Always preserve tool results
        if (message.role === 'tool') {
            return false;
        }
        
        // Custom logic for other messages
        return super.isDuplicateMessage(message);
    }
}
```

### Custom Tool Filtering

Implement dynamic tool filtering:

```typescript
class DynamicPromptManager extends MxfSystemPromptManager {
    async getSystemPrompt(options: PromptOptions) {
        // Dynamically determine allowed tools based on context
        const allowedTools = this.determineAllowedTools(options.channelContext);
        
        return super.getSystemPrompt({
            ...options,
            allowedTools
        });
    }
    
    private determineAllowedTools(context: any): string[] {
        // Logic to determine tools based on context
        if (context.securityLevel === 'high') {
            return ['messaging_send', 'task_complete'];
        }
        
        return undefined; // All tools
    }
}
```

### Task Progress Tracking

Implement detailed task progress tracking:

```typescript
taskManager.setTaskHandler(async (task) => {
    const totalSteps = 5;
    
    for (let step = 1; step <= totalSteps; step++) {
        // Update progress
        await taskManager.updateTaskProgress(task.id, {
            status: 'in_progress',
            progress: (step / totalSteps) * 100,
            message: `Step ${step} of ${totalSteps}`
        });
        
        // Execute step
        await executeStep(step);
    }
    
    // Report completion
    return {
        success: true,
        result: 'All steps completed'
    };
});
```

## Best Practices

### Memory Management

1. **Preserve Tool Results**: Never implement custom logic that deduplicates tool results
2. **Conversation Windowing**: Clear old messages to maintain optimal context window
3. **Scope Appropriately**: Use correct memory scope for data isolation
4. **Monitor Size**: Track conversation history size to prevent token limit issues

### Tool Management

1. **Lazy Loading**: Tools are loaded only when needed
2. **Error Handling**: Gracefully handle MCP server unavailability
3. **Caching**: Leverage tool caching to minimize server calls
4. **Filtering**: Always filter tools based on agent permissions

### Prompt Management

1. **Dynamic Generation**: Generate prompts dynamically based on current tool set
2. **Tool Filtering**: Use `allowedTools` for security and optimization
3. **Context Inclusion**: Include relevant channel and agent context
4. **Compression**: Use MXP-optimized prompts for token reduction

### Task Management

1. **Progress Updates**: Provide regular progress updates for long-running tasks
2. **Error Handling**: Always report task failures with clear error messages
3. **State Tracking**: Maintain accurate task state throughout lifecycle
4. **Event Emission**: Emit events for task state changes

## Error Handling

All managers implement robust error handling:

```typescript
try {
    const tools = await mcpManager.getAvailableTools();
} catch (error) {
    // Graceful degradation - agent can still function without tools
    console.warn('Failed to load tools:', error);
    const tools = []; // Empty tool set
}

try {
    await memoryManager.addMessage(message);
} catch (error) {
    // Memory errors should not crash agent
    console.error('Failed to add message to memory:', error);
}

try {
    await taskManager.reportTaskComplete(taskId, result);
} catch (error) {
    // Task reporting errors are logged but don't block agent
    console.error('Failed to report task completion:', error);
}
```

## Performance Considerations

### Memory Manager

- **Deduplication Performance**: O(n) where n is conversation history size
- **History Retrieval**: O(1) for full history, O(n) for filtered retrieval
- **Memory Usage**: Linear with conversation history size

### MCP Manager

- **Tool Discovery**: Cached after first discovery
- **Tool Execution**: Varies by tool complexity
- **Connection Management**: Lazy connection reduces startup time

### Prompt Manager

- **Prompt Generation**: O(n) where n is number of tools
- **Tool Documentation**: Cached when possible
- **Filtering**: O(n) where n is total tool count

### Task Manager

- **State Updates**: O(1) for task state changes
- **Progress Reporting**: Asynchronous, non-blocking
- **Event Emission**: Efficient event-driven architecture

## Type Safety

All managers are fully typed for TypeScript safety:

```typescript
import { MxfMcpClientManager } from './src/sdk/managers/MxfMcpClientManager';
import { MxfMemoryManager } from './src/sdk/managers/MxfMemoryManager';
import { MxfSystemPromptManager } from './src/sdk/managers/MxfSystemPromptManager';
import { MxfTaskExecutionManager } from './src/sdk/managers/MxfTaskExecutionManager';
import { ConversationMessage } from './src/shared/interfaces/ConversationMessage';
import { Task } from './src/shared/interfaces/TaskInterfaces';
```

## Related Documentation

- [MxfAgent](./index.md#llm-powered-agent) - Main agent implementation
- [MxfClient](./index.md#basic-agent-connection) - Base client implementation
- [Event System](./events.md) - Event-driven architecture
- [Memory API](../api/memory.md) - Server-side memory API
- [MCP Integration](./mcp.md) - Model Context Protocol details
- [Task Management](../api/tasks.md) - Task API documentation

---

For source code reference:
- `/src/sdk/managers/MxfMcpClientManager.ts`
- `/src/sdk/managers/MxfMemoryManager.ts`
- `/src/sdk/managers/MxfSystemPromptManager.ts`
- `/src/sdk/managers/MxfTaskExecutionManager.ts`
