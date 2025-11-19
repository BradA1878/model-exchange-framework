# SDK Handler Classes

The MXF SDK includes specialized handler classes that process specific types of events and operations. These handlers provide the foundational logic for control loops, MCP operations, memory management, messaging, and task handling.

## Overview

The SDK provides five core handler categories:

1. **ControlLoopHandlers**: ORPAR cycle execution (Observation, Reasoning, Action, Planning, Reflection)
2. **McpHandler & McpToolHandlers**: Model Context Protocol tool execution
3. **McpResourceHandlers**: MCP resource management
4. **MemoryHandlers**: Memory operations and persistence
5. **MessageHandlers**: Agent-to-agent messaging
6. **TaskHandlers**: Task lifecycle management

## ControlLoopHandlers

Implements the ORPAR (Observation, Reasoning, Action, Planning, Reflection) cognitive cycle for intelligent agent behavior.

### Purpose

The ORPAR control loop provides structured decision-making:
- **Observation**: Gather environmental context
- **Reasoning**: Analyze situation using LLM
- **Action**: Execute planned actions
- **Planning**: Create comprehensive action plans
- **Reflection**: Learn from completed actions

### Key Features

- **SystemLLM Integration**: Uses SystemLlmService for cognitive operations
- **Event-Driven**: Emits events at each phase
- **State Management**: Tracks control loop state
- **Context-Aware**: Incorporates agent and channel context
- **Async Processing**: Non-blocking execution

### Usage

```typescript
import { ControlLoopHandlers } from './src/sdk/handlers/ControlLoopHandlers';

// Initialize control loop handlers
const controlLoopHandlers = new ControlLoopHandlers(agent, config);

// Start observation phase
await controlLoopHandlers.startObservation({
    type: 'environment',
    context: {
        channelId: 'channel-1',
        agentId: 'agent-1',
        environmentData: { ... }
    }
});

// Execute reasoning phase
const reasoningResult = await controlLoopHandlers.performReasoning({
    observation: observationData,
    objective: 'Analyze current situation'
});

// Create action plan
const actionPlan = await controlLoopHandlers.createPlan({
    reasoning: reasoningResult,
    objective: 'Complete task X',
    constraints: ['time', 'resources']
});

// Execute action
const actionResult = await controlLoopHandlers.executeAction({
    action: 'send_message',
    parameters: { content: 'Hello' }
});

// Perform reflection
const reflection = await controlLoopHandlers.performReflection({
    actions: completedActions,
    results: actionResults,
    objective: originalObjective
});
```

### ORPAR Cycle Flow

```typescript
// Complete ORPAR cycle
async function runORPARCycle(agent, objective) {
    // 1. Observation
    const observation = await agent.observe({
        type: 'environment',
        scope: 'channel'
    });
    
    // 2. Reasoning
    const reasoning = await agent.reason({
        observation,
        objective,
        context: agent.getContext()
    });
    
    // 3. Planning
    const plan = await agent.plan({
        reasoning,
        objective,
        capabilities: agent.getCapabilities()
    });
    
    // 4. Action
    const results = [];
    for (const action of plan.actions) {
        const result = await agent.executeAction(action);
        results.push(result);
    }
    
    // 5. Reflection
    const reflection = await agent.reflect({
        plan,
        results,
        objective,
        learnings: agent.getLearnings()
    });
    
    return { observation, reasoning, plan, results, reflection };
}
```

### Control Loop Events

```typescript
import { Events } from '@mxf/sdk';

// Listen to control loop phases
agent.on(Events.ControlLoop.OBSERVATION, (data) => {
    console.log('Observation:', data);
});

agent.on(Events.ControlLoop.REASONING, (data) => {
    console.log('Reasoning:', data);
});

agent.on(Events.ControlLoop.PLAN, (data) => {
    console.log('Plan:', data);
});

agent.on(Events.ControlLoop.ACTION, (data) => {
    console.log('Action executed:', data);
});

agent.on(Events.ControlLoop.REFLECTION, (data) => {
    console.log('Reflection:', data);
});
```

## McpHandler & McpToolHandlers

Handles Model Context Protocol tool execution and management.

### Purpose

- Execute MCP tools (internal and external)
- Validate tool parameters
- Format tool results
- Handle tool errors
- Support tool call batching

### Key Features

- **Unified Tool Execution**: Single interface for all tools
- **Parameter Validation**: Validates inputs against tool schemas
- **Error Recovery**: Graceful error handling with fallbacks
- **Result Formatting**: Standardized result format
- **Tool Discovery**: Dynamic tool discovery and registration

### Usage

```typescript
import { McpToolHandlers } from './src/sdk/handlers/McpToolHandlers';

// Execute a tool
const result = await McpToolHandlers.executeTool({
    name: 'messaging_send',
    arguments: {
        recipientId: 'agent-2',
        content: 'Hello from agent-1'
    },
    context: {
        agentId: 'agent-1',
        channelId: 'channel-1'
    }
});

// Batch execute multiple tools
const results = await McpToolHandlers.batchExecuteTools([
    { name: 'tool1', arguments: { ... } },
    { name: 'tool2', arguments: { ... } },
    { name: 'tool3', arguments: { ... } }
]);

// List available tools
const tools = await McpToolHandlers.listTools({
    category: 'communication',
    allowedTools: ['messaging_send', 'messaging_coordinate']
});
```

### Tool Call Handling

```typescript
// Handle tool calls from LLM response
async function handleToolCalls(toolCalls, agent) {
    const results = [];
    
    for (const toolCall of toolCalls) {
        try {
            const result = await McpToolHandlers.executeTool({
                name: toolCall.function.name,
                arguments: JSON.parse(toolCall.function.arguments),
                context: {
                    agentId: agent.agentId,
                    channelId: agent.channelId,
                    toolCallId: toolCall.id
                }
            });
            
            results.push({
                tool_call_id: toolCall.id,
                role: 'tool',
                content: JSON.stringify(result)
            });
        } catch (error) {
            // Add error as tool result
            results.push({
                tool_call_id: toolCall.id,
                role: 'tool',
                content: JSON.stringify({
                    error: error.message,
                    success: false
                })
            });
        }
    }
    
    return results;
}
```

### Tool Result Format

Tools return results in standardized MCP format:

```typescript
// Modern MCP Format (Recommended)
{
    content: {
        type: 'application/json' | 'text/plain' | 'binary',
        data: actualResult
    }
}

// Legacy Format (Still Supported)
{
    result: actualResult
}
```

**Important**: The framework handles both formats, but new tools should use the Modern MCP Format for consistency.

## McpResourceHandlers

Handles MCP resource operations (read, list, subscribe).

### Purpose

- Access external resources via MCP
- List available resources
- Subscribe to resource updates
- Cache resource data

### Usage

```typescript
import { McpResourceHandlers } from './src/sdk/handlers/McpResourceHandlers';

// Read a resource
const resource = await McpResourceHandlers.readResource({
    uri: 'file:///path/to/resource',
    context: { agentId: 'agent-1' }
});

// List resources
const resources = await McpResourceHandlers.listResources({
    pattern: '*.json',
    context: { agentId: 'agent-1' }
});

// Subscribe to resource updates
await McpResourceHandlers.subscribeToResource({
    uri: 'file:///path/to/resource',
    callback: (update) => {
        console.log('Resource updated:', update);
    }
});
```

## MemoryHandlers

Handles memory operations and persistence across different scopes.

### Purpose

- Store and retrieve agent memory
- Manage channel memory
- Handle relationship memory
- Support memory scopes (agent, channel, shared, relationship)

### Memory Scopes

```typescript
enum MemoryScope {
    AGENT = 'agent',           // Private to agent
    CHANNEL = 'channel',       // Shared with channel
    SHARED = 'shared',         // Global
    RELATIONSHIP = 'relationship'  // Between two agents
}
```

### Usage

```typescript
import { MemoryHandlers } from './src/sdk/handlers/MemoryHandlers';

// Store agent memory
await MemoryHandlers.storeMemory({
    scope: MemoryScope.AGENT,
    agentId: 'agent-1',
    key: 'preferences',
    value: {
        theme: 'dark',
        language: 'en'
    }
});

// Retrieve memory
const memory = await MemoryHandlers.retrieveMemory({
    scope: MemoryScope.AGENT,
    agentId: 'agent-1',
    key: 'preferences'
});

// Store channel memory
await MemoryHandlers.storeMemory({
    scope: MemoryScope.CHANNEL,
    channelId: 'channel-1',
    key: 'shared_context',
    value: {
        topic: 'Research Project X',
        status: 'active'
    }
});

// Get relationship memory
const relationshipMemory = await MemoryHandlers.getRelationshipMemory({
    agentId1: 'agent-1',
    agentId2: 'agent-2'
});

// Update relationship memory
await MemoryHandlers.updateRelationshipMemory({
    agentId1: 'agent-1',
    agentId2: 'agent-2',
    interactions: 15,
    lastInteraction: Date.now(),
    trust: 0.85
});
```

### Memory Patterns

```typescript
// Persistent preferences
async function saveAgentPreferences(agent, preferences) {
    await MemoryHandlers.storeMemory({
        scope: MemoryScope.AGENT,
        agentId: agent.agentId,
        key: 'preferences',
        value: preferences
    });
}

// Channel-wide context
async function updateChannelContext(channelId, context) {
    await MemoryHandlers.storeMemory({
        scope: MemoryScope.CHANNEL,
        channelId,
        key: 'context',
        value: context
    });
}

// Agent relationships
async function recordInteraction(agent1, agent2, interactionType) {
    const memory = await MemoryHandlers.getRelationshipMemory({
        agentId1: agent1.agentId,
        agentId2: agent2.agentId
    });
    
    await MemoryHandlers.updateRelationshipMemory({
        agentId1: agent1.agentId,
        agentId2: agent2.agentId,
        interactions: (memory?.interactions || 0) + 1,
        lastInteraction: Date.now(),
        types: [...(memory?.types || []), interactionType]
    });
}
```

## MessageHandlers

Handles agent-to-agent messaging and communication patterns.

### Purpose

- Send messages between agents
- Handle direct messages
- Support broadcast messages
- Coordinate multi-agent communication
- Format messages for different protocols (standard, MXP)

### Usage

```typescript
import { MessageHandlers } from './src/sdk/handlers/MessageHandlers';

// Send direct message
await MessageHandlers.sendMessage({
    senderId: 'agent-1',
    recipientId: 'agent-2',
    content: 'Hello, Agent 2!',
    metadata: {
        priority: 'high',
        type: 'request'
    }
});

// Send broadcast message
await MessageHandlers.broadcastMessage({
    senderId: 'agent-1',
    channelId: 'channel-1',
    content: 'Announcement to all agents',
    metadata: {
        type: 'announcement'
    }
});

// Coordinate with multiple agents
await MessageHandlers.coordinateMessage({
    senderId: 'agent-1',
    recipientIds: ['agent-2', 'agent-3', 'agent-4'],
    content: 'Let\'s coordinate on task X',
    metadata: {
        type: 'coordination',
        taskId: 'task-123'
    }
});

// Handle incoming message
MessageHandlers.onMessage('agent-1', (message) => {
    console.log('Received message:', message);
    
    // Process message
    if (message.metadata?.type === 'request') {
        handleRequest(message);
    }
});
```

### Message Formats

```typescript
// Standard message format
{
    senderId: string,
    recipientId?: string,  // Omit for broadcast
    channelId: string,
    content: string,
    metadata: {
        timestamp: number,
        type: string,
        priority?: 'low' | 'normal' | 'high',
        requiresResponse?: boolean
    }
}

// MXP message format (automatically converted)
{
    senderId: string,
    recipientId: string,
    channelId: string,
    content: Buffer,  // Binary encoded
    encoding: 'mxp',
    metadata: { ... }
}
```

### Communication Patterns

```typescript
// Request-Response Pattern
async function requestResponse(agent, recipientId, request) {
    const requestId = generateRequestId();
    
    // Send request
    await MessageHandlers.sendMessage({
        senderId: agent.agentId,
        recipientId,
        content: JSON.stringify({
            type: 'request',
            requestId,
            data: request
        })
    });
    
    // Wait for response
    return new Promise((resolve) => {
        MessageHandlers.onMessage(agent.agentId, (message) => {
            const data = JSON.parse(message.content);
            if (data.type === 'response' && data.requestId === requestId) {
                resolve(data.data);
            }
        });
    });
}

// Publish-Subscribe Pattern
async function publishEvent(agent, eventType, eventData) {
    await MessageHandlers.broadcastMessage({
        senderId: agent.agentId,
        channelId: agent.channelId,
        content: JSON.stringify({
            type: 'event',
            eventType,
            data: eventData
        })
    });
}

// Multi-Agent Coordination
async function coordinateTask(coordinator, workers, task) {
    // Distribute task
    await MessageHandlers.coordinateMessage({
        senderId: coordinator.agentId,
        recipientIds: workers.map(w => w.agentId),
        content: JSON.stringify({
            type: 'task_assignment',
            task
        })
    });
    
    // Collect responses
    const responses = [];
    MessageHandlers.onMessage(coordinator.agentId, (message) => {
        const data = JSON.parse(message.content);
        if (data.type === 'task_response') {
            responses.push(data);
        }
    });
}
```

## TaskHandlers

Handles task lifecycle management and execution.

### Purpose

- Receive task assignments
- Track task progress
- Report task results
- Handle task failures
- Support autonomous task completion

### Usage

```typescript
import { TaskHandlers } from './src/sdk/handlers/TaskHandlers';

// Register task handler
TaskHandlers.registerTaskHandler('agent-1', async (task) => {
    console.log('Received task:', task);
    
    // Process task
    try {
        const result = await processTask(task);
        
        // Report success
        return {
            success: true,
            result,
            metadata: {
                processingTime: Date.now() - task.receivedAt
            }
        };
    } catch (error) {
        // Report failure
        return {
            success: false,
            error: error.message
        };
    }
});

// Update task progress
await TaskHandlers.updateProgress({
    taskId: 'task-123',
    agentId: 'agent-1',
    status: 'in_progress',
    progress: 50,
    message: 'Processing data...'
});

// Complete task
await TaskHandlers.completeTask({
    taskId: 'task-123',
    agentId: 'agent-1',
    result: {
        success: true,
        data: finalResult
    }
});

// Report task failure
await TaskHandlers.failTask({
    taskId: 'task-123',
    agentId: 'agent-1',
    error: 'Task failed',
    reason: 'Invalid input data'
});
```

### Task Completion Patterns

```typescript
// Autonomous completion (agent signals when done)
TaskHandlers.registerTaskHandler('agent-1', async (task) => {
    if (task.autonomous) {
        // Agent will call task_complete tool when done
        // Start processing asynchronously
        processTaskAsync(task).then((result) => {
            // Agent calls tool: task_complete
        });
        
        return {
            success: true,
            message: 'Task processing started'
        };
    }
    
    // Traditional synchronous completion
    const result = await processTask(task);
    return { success: true, result };
});

// Multi-step task with progress
TaskHandlers.registerTaskHandler('agent-1', async (task) => {
    const steps = task.steps || [];
    const totalSteps = steps.length;
    
    for (let i = 0; i < totalSteps; i++) {
        // Update progress
        await TaskHandlers.updateProgress({
            taskId: task.id,
            agentId: 'agent-1',
            status: 'in_progress',
            progress: ((i + 1) / totalSteps) * 100,
            message: `Step ${i + 1} of ${totalSteps}`
        });
        
        // Execute step
        await executeStep(steps[i]);
    }
    
    return {
        success: true,
        result: 'All steps completed'
    };
});
```

### Task Events

```typescript
// Listen to task events
agent.on(Events.Task.ASSIGNED, (task) => {
    console.log('New task assigned:', task);
});

agent.on(Events.Task.PROGRESS_UPDATED, (update) => {
    console.log('Task progress:', update);
});

agent.on(Events.Task.COMPLETED, (result) => {
    console.log('Task completed:', result);
});

agent.on(Events.Task.FAILED, (error) => {
    console.error('Task failed:', error);
});
```

## Handler Integration

Handlers work together within the agent:

```typescript
class MxfAgent extends MxfClient {
    private controlLoopHandlers: ControlLoopHandlers;
    private mcpHandlers: McpToolHandlers;
    private memoryHandlers: MemoryHandlers;
    private messageHandlers: MessageHandlers;
    private taskHandlers: TaskHandlers;
    
    async handleIncomingMessage(message) {
        // 1. Store in memory
        await this.memoryHandlers.storeMessage(message);
        
        // 2. Trigger observation in control loop
        await this.controlLoopHandlers.startObservation({
            type: 'message',
            data: message
        });
        
        // 3. Reason about message
        const reasoning = await this.controlLoopHandlers.performReasoning({
            observation: message
        });
        
        // 4. Determine action (e.g., respond)
        if (reasoning.shouldRespond) {
            const response = await this.generateResponse(message);
            
            // 5. Send response via message handler
            await this.messageHandlers.sendMessage({
                senderId: this.agentId,
                recipientId: message.senderId,
                content: response
            });
        }
        
        // 6. Reflect on interaction
        await this.controlLoopHandlers.performReflection({
            interaction: { message, response },
            outcome: 'success'
        });
    }
}
```

## Best Practices

### Control Loop

1. **Complete Cycles**: Always complete all ORPAR phases
2. **Context Tracking**: Maintain context throughout cycle
3. **Error Handling**: Gracefully handle failures at each phase
4. **Event Emission**: Emit events for observability

### Tool Execution

1. **Validate Inputs**: Always validate tool parameters
2. **Handle Errors**: Provide meaningful error messages
3. **Format Results**: Use standardized result format
4. **Result Preservation**: Never deduplicate tool results

### Memory Management

1. **Appropriate Scopes**: Use correct memory scope for data
2. **Cleanup**: Periodically clean up old memory
3. **Consistency**: Maintain consistency across scopes
4. **Privacy**: Respect agent privacy with proper scoping

### Messaging

1. **Clear Content**: Use clear, structured message content
2. **Metadata**: Include relevant metadata for routing
3. **Error Handling**: Handle messaging failures gracefully
4. **Protocol Support**: Support both standard and MXP formats

### Task Handling

1. **Progress Updates**: Provide regular progress updates
2. **Clear Results**: Return clear success/failure results
3. **Error Details**: Include detailed error information
4. **State Tracking**: Maintain accurate task state

## Error Handling Patterns

```typescript
// Graceful degradation
async function executeWithFallback(handler, fallback) {
    try {
        return await handler();
    } catch (error) {
        console.warn('Handler failed, using fallback:', error);
        return fallback();
    }
}

// Retry logic
async function executeWithRetry(handler, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await handler();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await delay(1000 * (i + 1));
        }
    }
}

// Circuit breaker
class CircuitBreaker {
    private failures = 0;
    private threshold = 5;
    private isOpen = false;
    
    async execute(handler) {
        if (this.isOpen) {
            throw new Error('Circuit breaker is open');
        }
        
        try {
            const result = await handler();
            this.failures = 0;
            return result;
        } catch (error) {
            this.failures++;
            if (this.failures >= this.threshold) {
                this.isOpen = true;
                setTimeout(() => {
                    this.isOpen = false;
                    this.failures = 0;
                }, 60000);
            }
            throw error;
        }
    }
}
```

## Type Safety

All handlers are fully typed:

```typescript
import {
    ControlLoopHandlers,
    McpToolHandlers,
    McpResourceHandlers,
    MemoryHandlers,
    MessageHandlers,
    TaskHandlers
} from './src/sdk/handlers';
```

## Related Documentation

- [SDK Managers](./managers.md) - Manager classes
- [MxfAgent](./index.md) - Main agent implementation
- [Event System](./events.md) - Event handling
- [MCP Integration](./mcp.md) - MCP details
- [Control Loop API](../api/control-loop.md) - Server-side control loop
- [Memory API](../api/memory.md) - Memory persistence

---

For source code reference:
- `/src/sdk/handlers/ControlLoopHandlers.ts`
- `/src/sdk/handlers/McpHandler.ts`
- `/src/sdk/handlers/McpToolHandlers.ts`
- `/src/sdk/handlers/McpResourceHandlers.ts`
- `/src/sdk/handlers/MemoryHandlers.ts`
- `/src/sdk/handlers/MessageHandlers.ts`
- `/src/sdk/handlers/TaskHandlers.ts`
