# WebSocket API Documentation

MXF uses Socket.IO for real-time bidirectional communication between agents and the server. This document covers the WebSocket API, events, and protocols.

## Connection

### WebSocket Endpoint

```
ws://localhost:3001/socket.io/
```

### Connection Parameters

```typescript
import { MxfSDK } from '@mxf/sdk';

// Initialize SDK with authentication
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!,
    // Optional connection settings
    timeout: 600000, // 10 minutes for LLM operations
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

await sdk.connect();

// Create an agent in a channel
const agent = sdk.createAgent({
    agentId: 'agent-123',
    name: 'My Agent',
    channelId: 'channel-456'
});
```

## Authentication Protocol

### Initial Handshake

1. SDK connects with authentication credentials
2. Server validates credentials using secure authentication
3. SDK registers agent and joins channel automatically
4. Agent emits confirmation events

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

// Initialize SDK with authentication
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create and register agent
const agent = sdk.createAgent({
    agentId: 'agent-123',
    name: 'Research Agent',
    channelId: 'research-channel',
    capabilities: ['research', 'analysis'],
    metadata: {
        version: '1.0.0',
        environment: 'production'
    }
});

// Listen for registration confirmation
agent.on(Events.Agent.REGISTERED, (payload) => {
    console.log('Agent registered:', payload.agentId);
});
```

## Core Events

### Agent Events

#### agent:register
Register an agent with the server.

**Emit:**
```javascript
socket.emit('agent:register', {
    agentId: string,
    name: string,
    channelId: string,
    role?: string,
    capabilities?: string[],
    model?: string,
    description?: string,
    metadata?: object
});
```

**Response Events:**
- `agent:registered` - Success
- `agent:error` - Registration failed

#### agent:update
Update agent properties.

**Emit:**
```javascript
socket.emit('agent:update', {
    agentId: string,
    updates: {
        name?: string,
        status?: 'online' | 'busy' | 'away' | 'offline',
        capabilities?: string[],
        metadata?: object
    }
});
```

#### agent:status
Get agent status information.

**Emit:**
```javascript
socket.emit('agent:status', {
    agentId: string
});
```

**Response:**
```javascript
socket.on('agent:status:response', (status) => {
    // status: { online: boolean, lastSeen: Date, ... }
});
```

### Message Events

#### message:send
Send a message to a channel.

**Emit:**
```javascript
socket.emit('message:send', {
    channelId: string,
    content: string,
    metadata?: {
        priority?: 'low' | 'normal' | 'high',
        tags?: string[],
        replyTo?: string,
        [key: string]: any
    }
});
```

**Broadcast to channel:**
```javascript
socket.on('message', (message) => {
    // message: { from: string, content: string, timestamp: Date, ... }
});
```

#### message:direct
Send a direct message to another agent.

**Emit:**
```javascript
socket.emit('message:direct', {
    targetAgentId: string,
    content: string,
    metadata?: object
});
```

**Received by target:**
```javascript
socket.on('direct_message', (message) => {
    // Private message received
});
```

#### message:broadcast
Broadcast to all agents in a channel.

**Emit:**
```javascript
socket.emit('message:broadcast', {
    channelId: string,
    content: string,
    type: 'announcement' | 'alert' | 'update'
});
```

### Channel Events

#### channel:join
Join a channel.

**Emit:**
```javascript
socket.emit('channel:join', {
    channelId: string,
    agentId: string
});
```

**Response Events:**
- `channel:joined` - Successfully joined
- `channel:participants` - List of current participants
- `channel:error` - Join failed

#### channel:leave
Leave a channel.

**Emit:**
```javascript
socket.emit('channel:leave', {
    channelId: string,
    agentId: string
});
```

#### channel:update
Update channel information.

**Emit:**
```javascript
socket.emit('channel:update', {
    channelId: string,
    updates: {
        name?: string,
        description?: string,
        metadata?: object
    }
});
```

### Task Events

#### task:create
Create a new task.

**Emit:**
```javascript
socket.emit('task:create', {
    channelId: string,
    task: {
        name: string,
        description: string,
        requirements?: string[],
        assignmentStrategy?: 'capability' | 'workload' | 'llm' | 'role',
        priority?: 'low' | 'normal' | 'high' | 'urgent',
        deadline?: string, // ISO date
        metadata?: object
    }
});
```

**Response:**
```javascript
socket.on('task:created', (task) => {
    // task: { taskId: string, assignedTo: string, ... }
});
```

#### task:assign
Manually assign a task.

**Emit:**
```javascript
socket.emit('task:assign', {
    taskId: string,
    agentId: string,
    reason?: string
});
```

#### task:progress
Update task progress.

**Emit:**
```javascript
socket.emit('task:progress', {
    taskId: string,
    progress: {
        status: 'pending' | 'in_progress' | 'completed' | 'failed',
        percentage?: number, // 0-100
        message?: string,
        metadata?: object
    }
});
```

#### task:complete
Complete a task.

**Emit:**
```javascript
socket.emit('task:complete', {
    taskId: string,
    result: {
        success: boolean,
        output?: any,
        error?: string,
        metadata?: object
    }
});
```

### Memory Events

#### memory:get
Retrieve memory entries.

**Emit:**
```javascript
socket.emit('memory:get', {
    scope: 'agent' | 'channel' | 'relationship',
    targetId: string,
    key?: string // Optional: get specific key
});
```

**Response:**
```javascript
socket.on('memory:data', (memory) => {
    // memory: { entries: MemoryEntry[], scope: string, ... }
});
```

#### memory:update
Create or update memory.

**Emit:**
```javascript
socket.emit('memory:update', {
    scope: 'agent' | 'channel' | 'relationship',
    targetId: string,
    key: string,
    value: any,
    metadata?: {
        persistent?: boolean,
        expiresAt?: string,
        tags?: string[]
    }
});
```

#### memory:delete
Delete memory entries.

**Emit:**
```javascript
socket.emit('memory:delete', {
    scope: 'agent' | 'channel' | 'relationship',
    targetId: string,
    key?: string // Optional: delete specific key
});
```

#### memory:bulk
Bulk memory operations.

**Emit:**
```javascript
socket.emit('memory:bulk', {
    operations: [{
        action: 'create' | 'update' | 'delete',
        scope: 'agent' | 'channel' | 'relationship',
        targetId: string,
        key: string,
        value?: any
    }]
});
```

### Control Loop Events

#### control_loop:init
Initialize a control loop.

**Emit:**
```javascript
socket.emit('control_loop:init', {
    agentId: string,
    config: {
        observationModel?: string,
        reasoningModel?: string,
        planningModel?: string,
        reflectionModel?: string,
        cycleInterval?: number,
        maxCycles?: number
    }
});
```

#### control_loop:observation
Submit an observation.

**Emit:**
```javascript
socket.emit('control_loop:observation', {
    controlLoopId: string,
    observation: {
        type: string,
        data: any,
        source: string,
        timestamp?: string
    }
});
```

**ORPAR Cycle Events (Received):**
```javascript
// Observation processed
socket.on('control_loop:observation:processed', (data) => {
    // data: { controlLoopId, analysis, insights }
});

// Reasoning complete
socket.on('control_loop:reasoning:complete', (data) => {
    // data: { controlLoopId, reasoning, understanding }
});

// Action planned
socket.on('control_loop:action:planned', (data) => {
    // data: { controlLoopId, plan, actions }
});

// Progress update
socket.on('control_loop:progress:update', (data) => {
    // data: { controlLoopId, status, completed }
});

// Reflection complete
socket.on('control_loop:reflection:complete', (data) => {
    // data: { controlLoopId, insights, learnings }
});
```

### MCP Tool Events

#### mcp:tool:list
List available tools.

**Emit:**
```javascript
socket.emit('mcp:tool:list', {
    category?: string,
    provider?: string
});
```

**Response:**
```javascript
socket.on('mcp:tool:list:response', (tools) => {
    // tools: ToolDefinition[]
});
```

#### mcp:tool:execute
Execute a tool.

**Emit:**
```javascript
socket.emit('mcp:tool:execute', {
    toolName: string,
    arguments: object,
    options?: {
        timeout?: number,
        retries?: number
    }
});
```

**Response:**
```javascript
socket.on('mcp:tool:result', (result) => {
    // result: { success: boolean, output: any, error?: string }
});
```

#### mcp:tool:register
Register a custom tool.

**Emit:**
```javascript
socket.emit('mcp:tool:register', {
    name: string,
    description: string,
    inputSchema: object, // JSON Schema
    category?: string,
    handler?: string // Server-side handler name
});
```

## Error Handling

### Error Events

All operations may emit error events:

```javascript
socket.on('error', (error) => {
    console.error('Socket error:', error);
    // error: { code: string, message: string, details?: any }
});

// Specific error events
socket.on('agent:error', (error) => { });
socket.on('channel:error', (error) => { });
socket.on('task:error', (error) => { });
socket.on('memory:error', (error) => { });
socket.on('mcp:error', (error) => { });
```

### Error Codes

| Code | Description |
|------|-------------|
| `AUTH_FAILED` | Authentication failed |
| `INVALID_KEY` | Invalid API key |
| `CHANNEL_NOT_FOUND` | Channel doesn't exist |
| `AGENT_NOT_FOUND` | Agent doesn't exist |
| `PERMISSION_DENIED` | Insufficient permissions |
| `RATE_LIMITED` | Too many requests |
| `VALIDATION_ERROR` | Invalid request data |
| `INTERNAL_ERROR` | Server error |

## Rate Limiting

WebSocket connections are subject to rate limiting:

- **Message sending**: 100 messages per minute
- **Tool execution**: 30 executions per minute
- **Memory operations**: 200 operations per minute
- **Control loop cycles**: 10 per minute

Exceeded limits result in `RATE_LIMITED` errors.

## MXP Protocol Support

MXF supports the Model Exchange Protocol (MXP) for efficient agent-to-agent communication. MXP messages are automatically detected and processed by the server.

### MXP Message Format

```javascript
// Natural language message (traditional)
socket.emit('message:send', {
    channelId: 'channel-123',
    content: 'Calculate the sum of 10, 20, and 30'
});

// MXP format (efficient)
socket.emit('message:send', {
    channelId: 'channel-123',
    content: {
        version: '1.0',
        type: 'operation',
        encrypted: true,
        payload: {
            op: 'calc.sum',
            args: [10, 20, 30]
        }
    }
});
```

### MXP Benefits

- **80%+ bandwidth reduction**: Structured messages use less data
- **Encrypted by default**: AES-256-GCM encryption for security
- **Automatic conversion**: Server converts suitable messages to MXP
- **Backward compatible**: Mix MXP and natural language freely

### Enabling MXP

Agents can enable MXP through configuration:

```javascript
const agent = await sdk.createAgent({
    agentId: 'my-agent',
    name: 'My Agent',
    channelId: 'main',
    keyId: 'key-123',
    secretKey: 'secret-456',
    mxpEnabled: true,
    mxpPreferredFormat: 'auto' // 'auto' | 'mxp' | 'natural-language'
});
```

## Best Practices

### 1. Connection Management

```javascript
// Handle connection lifecycle
socket.on('connect', () => {
    console.log('Connected to MXF');
    // Re-register agent after reconnection
    registerAgent();
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    if (reason === 'io server disconnect') {
        // Server initiated disconnect, reconnect manually
        socket.connect();
    }
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
});
```

### 2. Event Acknowledgments

For critical operations, use acknowledgments:

```javascript
socket.emit('task:complete', taskData, (ack) => {
    if (ack.success) {
        console.log('Task marked complete');
    } else {
        console.error('Failed to complete task:', ack.error);
    }
});
```

### 3. Event Timeouts

Set timeouts for operations:

```javascript
const timeout = setTimeout(() => {
    console.error('Operation timed out');
}, 30000);

socket.emit('mcp:tool:execute', toolRequest);

socket.once('mcp:tool:result', (result) => {
    clearTimeout(timeout);
    processResult(result);
});
```

### 4. Error Recovery

Implement robust error handling:

```javascript
socket.on('error', (error) => {
    switch (error.code) {
        case 'AUTH_FAILED':
            // Re-authenticate
            refreshCredentials();
            break;
        case 'RATE_LIMITED':
            // Implement backoff
            setTimeout(() => retryOperation(), 60000);
            break;
        case 'CHANNEL_NOT_FOUND':
            // Handle missing channel
            createOrJoinAlternativeChannel();
            break;
        default:
            console.error('Unhandled error:', error);
    }
});
```

### 5. Message Queuing

Queue messages during disconnection:

```javascript
const messageQueue = [];
let isConnected = false;

socket.on('connect', () => {
    isConnected = true;
    // Send queued messages
    while (messageQueue.length > 0) {
        const msg = messageQueue.shift();
        socket.emit('message:send', msg);
    }
});

socket.on('disconnect', () => {
    isConnected = false;
});

function sendMessage(message) {
    if (isConnected) {
        socket.emit('message:send', message);
    } else {
        messageQueue.push(message);
    }
}
```

## Testing WebSocket Connections

### Using MXF SDK

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

const testConnection = async (): Promise<void> => {
    // Initialize SDK
    const sdk = new MxfSDK({
        serverUrl: 'http://localhost:3001',
        domainKey: process.env.MXF_DOMAIN_KEY!,
        username: process.env.MXF_USERNAME!,
        password: process.env.MXF_PASSWORD!
    });
    
    console.log('✓ Connecting...');
    await sdk.connect();
    console.log('✓ Connected');
    
    // Create test agent
    const agent = sdk.createAgent({
        agentId: 'test-agent',
        name: 'Test Agent',
        channelId: 'test-channel'
    });
    
    console.log('✓ Agent registered');
    
    // Listen for channel messages
    agent.on(Events.Message.CHANNEL_MESSAGE, (payload) => {
        console.log('✓ Message received:', payload.data.content);
        sdk.disconnect();
    });
    
    // Send test message
    agent.emit(Events.Message.CHANNEL_MESSAGE, {
        channelId: 'test-channel',
        content: 'Test message'
    });
};

testConnection().catch(console.error);
```

### Using wscat

```bash
# Install wscat
npm install -g wscat

# Connect with headers
wscat -c "ws://localhost:3001/socket.io/?EIO=4&transport=websocket" \
  -H "Authorization: Bearer YOUR_KEY"
```

## Performance Considerations

1. **Connection Pooling**: Reuse connections when possible
2. **Event Debouncing**: Throttle high-frequency events
3. **Payload Size**: Keep payloads under 1MB
4. **Binary Data**: Use Socket.IO binary support for large data
5. **Compression**: Enable perMessageDeflate for text data

## Security

1. **TLS/SSL**: Use WSS in production
2. **Authentication**: Validate keys on every reconnection
3. **Input Validation**: Validate all incoming data
4. **Rate Limiting**: Implement per-agent limits
5. **Monitoring**: Log suspicious activity

## Next Steps

- Review [Event System](../sdk/events.md) for SDK-level event handling
- See [Authentication](auth.md) for security details
- Explore [API Reference](index.md) for REST endpoints
- Check [MCP Documentation](../sdk/mcp.md) for tool details