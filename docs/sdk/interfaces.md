# Core Interfaces

This document provides comprehensive type definitions and interfaces for the MXF SDK.

> **Note**: This is a lower-level reference document. For practical usage, see:
> - [SDK Overview](index.md) - Modern MxfSDK usage patterns
> - [Authentication](authentication.md) - Setup and authentication
> - [Code Examples](examples-basic.md) - Practical examples
>
> **All agents must be created via `MxfSDK.createAgent()`** - direct instantiation of MxfClient/MxfAgent is not supported.

## Core Agent Interfaces

```typescript
// Agent configuration
{{ ... }}
export interface AgentConfig {
    serverUrl: string;
    apiKey: string;
    agentId: string;
    name?: string;
    description?: string;
    role?: string;
    model?: string;
    capabilities?: string[];
    metadata?: Record<string, any>;
    
    // MXP Protocol Configuration
    mxpEnabled?: boolean;                    // Enable MXP protocol (default: false)
    mxpPreferredFormat?: MxpFormat;         // Preferred message format
    mxpForceEncryption?: boolean;           // Force encryption for all messages
}

// MXP Format options
export type MxpFormat = 'auto' | 'mxp' | 'natural-language';

// Agent information
export interface Agent {
    _id: string;
    agentId: string;
    name: string;
    description?: string;
    role?: string;
    model?: string;
    status: AgentStatus;
    capabilities: string[];
    channelMemberships: string[];
    keyId?: string;
    isActive: boolean;
    lastActive?: Date;
    createdAt: Date;
    updatedAt: Date;
    owner: string;
    metadata?: Record<string, any>;
    mxpConfig?: MxpAgentConfig;
}

// Agent status
export type AgentStatus = 'online' | 'offline' | 'busy' | 'away';
```

## MXP Protocol Interfaces

```typescript
// MXP Message structure
export interface MxpMessage {
    version: '1.0';
    type: MxpMessageType;
    encrypted: boolean;
    payload: MxpPayload | EncryptedPayload;
    
    // Message metadata
    messageId: string;
    timestamp: number;
    senderId: string;
    receiverId?: string;
    channelId?: string;
    
    // Protocol negotiation
    capabilities?: string[];
    fallbackFormat?: 'natural-language' | 'json';
}

// Message types
export type MxpMessageType = 
    | 'operation' 
    | 'reasoning' 
    | 'coordination' 
    | 'task' 
    | 'response';

// MXP Payload for unencrypted messages
export interface MxpPayload {
    op: string;              // Operation identifier
    args?: any[];            // Operation arguments
    context?: any;           // Additional context
    reasoning?: string;      // Optional natural language reasoning
    metadata?: {
        priority: number;
        ttl?: number;
        correlationId?: string;
    };
}

// Encrypted payload structure
export interface EncryptedPayload {
    algorithm: 'aes-256-gcm';
    data: string;            // Base64 encrypted payload
    iv: string;              // Initialization vector
    authTag: string;         // Authentication tag
}

// MXP Configuration for agents
export interface MxpAgentConfig {
    enabled: boolean;
    preferredFormat: MxpFormat;
    forceEncryption: boolean;
}

// MXP Statistics
export interface MxpStatistics {
    totalMessages: number;
    naturalLanguageMessages: number;
    mxpMessages: number;
    mxpPercentage: string;
    messagesConverted: number;
    messagesEncrypted: number;
    messagesDecrypted: number;
    encryptionRate: string;
    conversionFailures: number;
    encryptionFailures: number;
    uptime: number;
}
```

## Channel Interfaces

```typescript
// Channel configuration
export interface ChannelConfig {
    id?: string;
    name: string;
    description?: string;
    type?: ChannelType;
    metadata?: Record<string, any>;
    settings?: ChannelSettings;
}

// Channel types (Note: All types require key authentication)
export type ChannelType = 'hidden' | 'discoverable' | 'team' | 'broadcast';

// Channel settings
export interface ChannelSettings {
    maxMembers?: number;
    allowAnonymous?: boolean;
    recordMessages?: boolean;
    retention?: {
        days: number;
        maxMessages?: number;
    };
}

// Channel representation
export interface Channel {
    _id: string;
    channelId: string;
    name: string;
    description?: string;
    type: ChannelType;
    createdBy: string;
    members: ChannelMember[];
    settings: ChannelSettings;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

// Channel member
export interface ChannelMember {
    agentId: string;
    role: 'admin' | 'member' | 'observer';
    joinedAt: Date;
}
```

## Task Interfaces

```typescript
// Task creation
export interface TaskConfig {
    title: string;
    description: string;
    channelId?: string;
    priority?: TaskPriority;
    assigneeId?: string;
    agents?: string[];
    completionAgent?: string;
    metadata?: Record<string, any>;
}

// Task priority levels
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

// Task status
export type TaskStatus = 
    | 'pending' 
    | 'assigned' 
    | 'in_progress' 
    | 'completed' 
    | 'failed' 
    | 'cancelled';

// Task representation
export interface Task {
    _id: string;
    taskId: string;
    channelId: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeId?: string;
    assignerId: string;
    agents?: string[];
    completionAgent?: string;
    result?: any;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    metadata?: Record<string, any>;
}

// Task assignment
export interface TaskAssignment {
    taskId: string;
    agentId: string;
    confidence?: number;
    reasoning?: string;
    capabilities?: string[];
}
```

## Memory Interfaces

```typescript
// Memory entry configuration
export interface MemoryConfig {
    key: string;
    value: any;
    type?: MemoryType;
    scope?: MemoryScope;
    metadata?: Record<string, any>;
    ttl?: number;  // Time to live in seconds
}

// Memory types
export type MemoryType = 
    | 'fact' 
    | 'experience' 
    | 'preference' 
    | 'relationship' 
    | 'context';

// Memory scope
export type MemoryScope = 'agent' | 'channel' | 'global';

// Memory entry
export interface MemoryEntry {
    _id: string;
    key: string;
    value: any;
    type: MemoryType;
    scope: MemoryScope;
    agentId?: string;
    channelId?: string;
    metadata?: Record<string, any>;
    expiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

// Memory query options
export interface MemoryQueryOptions {
    scope?: MemoryScope;
    type?: MemoryType;
    agentId?: string;
    channelId?: string;
    pattern?: string;
    limit?: number;
    includeExpired?: boolean;
}
```

## Tool Interfaces

```typescript
// Tool definition
export interface Tool {
    name: string;
    description: string;
    category: ToolCategory;
    inputSchema: any;  // JSON Schema
    outputSchema?: any;
    handler?: (args: any) => Promise<any>;
    isExternal?: boolean;
    serverName?: string;
}

// Tool categories
export type ToolCategory = 
    | 'communication'
    | 'control-loop'
    | 'task-management'
    | 'memory'
    | 'infrastructure'
    | 'meta-tools'
    | 'external';

// Tool execution request
export interface ToolExecutionRequest {
    toolName: string;
    args: any;
    context?: {
        agentId?: string;
        channelId?: string;
        conversationId?: string;
    };
    options?: {
        timeout?: number;
        retries?: number;
    };
}

// Tool execution result
export interface ToolExecutionResult {
    success: boolean;
    result?: any;
    error?: string;
    executionTime: number;
    toolName: string;
    category: ToolCategory;
}
```

## Message Interfaces

```typescript
// Message sending options
export interface MessageOptions {
    receiverId?: string;
    channelId?: string;
    content: any;
    messageType?: string;
    metadata?: Record<string, any>;
    
    // MXP options
    enableMxp?: boolean;
    preferredFormat?: MxpFormat;
    forceEncryption?: boolean;
}

// Message structure
export interface Message {
    messageId: string;
    senderId: string;
    receiverId?: string;
    channelId?: string;
    content: any;
    messageType: string;
    timestamp: Date;
    metadata?: Record<string, any>;
    mxpFormat?: boolean;
    encrypted?: boolean;
}
```

## Event Interfaces

```typescript
// Event types
export type EventType = 
    | 'agent:connected'
    | 'agent:disconnected'
    | 'agent:status:change'
    | 'channel:created'
    | 'channel:agent:joined'
    | 'channel:agent:left'
    | 'message:channel'
    | 'message:agent'
    | 'task:assigned'
    | 'task:completed'
    | 'task:failed'
    | 'tool:executed'
    | 'mxp:message:converted'
    | 'mxp:message:encrypted'
    | 'error';

// Event payload
export interface EventPayload<T = any> {
    type: EventType;
    timestamp: Date;
    agentId?: string;
    channelId?: string;
    data: T;
}

// Event subscription
export interface EventSubscription {
    event: EventType | EventType[];
    handler: (payload: EventPayload) => void;
    filter?: {
        agentId?: string;
        channelId?: string;
    };
}
```

## Control Loop Interfaces

```typescript
// Control loop configuration
export interface ControlLoopConfig {
    objective: string;
    context?: any;
    maxIterations?: number;
    timeout?: number;
    phases?: ControlLoopPhase[];
}

// Control loop phases
export type ControlLoopPhase = 
    | 'observation'
    | 'reasoning'
    | 'action'
    | 'planning'
    | 'reflection';

// Control loop state
export interface ControlLoopState {
    loopId: string;
    objective: string;
    currentPhase: ControlLoopPhase;
    iteration: number;
    status: 'running' | 'completed' | 'failed' | 'paused';
    observations: any[];
    reasoning: any[];
    actions: any[];
    plans: any[];
    reflections: any[];
    startedAt: Date;
    completedAt?: Date;
}
```

## Authentication Interfaces

```typescript
// Authentication options
export interface AuthOptions {
    apiKey?: string;
    jwt?: string;
    refreshToken?: string;
}

// Authentication result
export interface AuthResult {
    authenticated: boolean;
    agentId?: string;
    permissions?: string[];
    expiresAt?: Date;
}

// API Key
export interface ApiKey {
    keyId: string;
    secretKey?: string;  // Only returned on creation
    agentId: string;
    channelId?: string;
    name?: string;
    permissions: string[];
    isActive: boolean;
    createdAt: Date;
    expiresAt?: Date;
    lastUsed?: Date;
}
```

## Error Interfaces

```typescript
// MXF Error
export interface MxfError {
    code: string;
    message: string;
    details?: any;
    statusCode?: number;
    timestamp: Date;
    requestId?: string;
}

// Error codes
export enum ErrorCode {
    // Authentication errors
    AUTH_INVALID_KEY = 'AUTH_INVALID_KEY',
    AUTH_EXPIRED = 'AUTH_EXPIRED',
    AUTH_MISSING = 'AUTH_MISSING',
    
    // Validation errors
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    INVALID_FORMAT = 'INVALID_FORMAT',
    MISSING_REQUIRED = 'MISSING_REQUIRED',
    
    // Resource errors
    NOT_FOUND = 'NOT_FOUND',
    ALREADY_EXISTS = 'ALREADY_EXISTS',
    QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
    
    // Operation errors
    OPERATION_FAILED = 'OPERATION_FAILED',
    TIMEOUT = 'TIMEOUT',
    RATE_LIMITED = 'RATE_LIMITED',
    
    // MXP errors
    MXP_CONVERSION_FAILED = 'MXP_CONVERSION_FAILED',
    MXP_ENCRYPTION_FAILED = 'MXP_ENCRYPTION_FAILED',
    MXP_DECRYPTION_FAILED = 'MXP_DECRYPTION_FAILED',
    
    // Network errors
    CONNECTION_FAILED = 'CONNECTION_FAILED',
    NETWORK_ERROR = 'NETWORK_ERROR',
    SERVER_ERROR = 'SERVER_ERROR'
}
```

## Client Configuration

```typescript
// MXF Client options
export interface MxfClientOptions {
    serverUrl: string;
    apiKey: string;
    agentId: string;
    
    // Agent configuration
    name?: string;
    description?: string;
    role?: string;
    model?: string;
    capabilities?: string[];
    metadata?: Record<string, any>;
    
    // MXP configuration
    mxpEnabled?: boolean;
    mxpPreferredFormat?: MxpFormat;
    mxpForceEncryption?: boolean;
    
    // Connection options
    autoConnect?: boolean;
    reconnect?: boolean;
    reconnectDelay?: number;
    maxReconnectAttempts?: number;
    
    // Performance options
    batchMessages?: boolean;
    batchSize?: number;
    batchDelay?: number;
    
    // Debug options
    debug?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
}
```

## Usage Example

```typescript
import { 
    MxfClient, 
    MxfClientOptions, 
    Task, 
    Message,
    MxpStatistics 
} from '@mxf-framework/js-sdk';

// Configure client with MXP
const options: MxfClientOptions = {
    serverUrl: 'http://localhost:3001',
    apiKey: 'your-api-key',
    agentId: 'my-agent',
    capabilities: ['analysis', 'communication'],
    mxpEnabled: true,
    mxpPreferredFormat: 'auto'
};

// Create client
const client = new MxfClient(options);

// Connect and use
await client.connect();

// Send MXP-enabled message
const message: MessageOptions = {
    receiverId: 'other-agent',
    content: 'Calculate the sum of 10, 20, and 30',
    enableMxp: true,
    forceEncryption: true
};

await client.sendMessage(message);

// Get MXP statistics
const stats: MxpStatistics = await client.getMxpStats();
console.log(`MXP usage: ${stats.mxpPercentage}%`);
```

## Next Steps

- See [SDK Documentation](index.md) for complete usage guide
- Review [MXP Protocol](../mxf/mxp-protocol.md) for optimization features
- Check [API Documentation](../api/index.md) for REST endpoints
- Explore [Examples](examples.md) for practical implementations