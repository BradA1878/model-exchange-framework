# Agents API

Comprehensive reference for agent management endpoints, including CRUD operations, authentication, lifecycle management, and memory operations.

## Overview

The Agents API provides:
- Agent registration and management
- Key-based authentication setup
- Agent lifecycle controls
- Memory and context management
- Real-time status monitoring
- Capability declarations

## Base URL

```
http://localhost:3001/api/agents
```

## Authentication

All endpoints require JWT authentication via `Authorization: Bearer <token>` header.

---

## Agent CRUD Operations

### List Agents

**GET** `/api/agents`

Retrieve all agents created by the authenticated user.

**Query Parameters:**
- `status` - Filter by status: `online`, `offline`, `busy`, `away`
- `channelId` - Filter by channel membership
- `capability` - Filter by capability (can be repeated)
- `model` - Filter by AI model
- `sort` - Sort by: `name`, `created`, `lastActive` (default: `lastActive`)
- `limit` - Number of results (default: 50)
- `offset` - Pagination offset

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "_id": "65abc123...",
            "agentId": "agent-123",
            "name": "Research Assistant",
            "description": "AI-powered research agent",
            "role": "assistant",
            "status": "online",
            "model": "gpt-4",
            "capabilities": ["research", "analysis", "summarization"],
            "channelMemberships": ["channel-456", "channel-789"],
            "keyId": "ck_1234567890",
            "isActive": true,
            "lastActive": "2024-01-20T10:30:00Z",
            "createdAt": "2024-01-15T08:00:00Z",
            "updatedAt": "2024-01-20T10:30:00Z",
            "owner": "user-123",
            "metadata": {
                "version": "1.0.0",
                "environment": "production"
            },
            "mxpConfig": {
                "enabled": true,
                "preferredFormat": "auto",
                "forceEncryption": false
            }
        }
    ],
    "pagination": {
        "total": 25,
        "limit": 50,
        "offset": 0
    }
}
```

### Create Agent

**POST** `/api/agents`

Create a new agent.

**Request Body:**
```json
{
    "agentId": "agent-123",
    "name": "Research Assistant",
    "description": "AI-powered research agent",
    "channelId": "channel-456",
    "role": "assistant",
    "model": "gpt-4",
    "capabilities": ["research", "analysis", "summarization"],
    "metadata": {
        "version": "1.0.0",
        "environment": "production"
    },
    "mxpEnabled": true,
    "mxpPreferredFormat": "auto",
    "mxpForceEncryption": false
}
```

**Response (201):**
```json
{
    "success": true,
    "data": {
        "agent": {
            "_id": "65abc123...",
            "agentId": "agent-123",
            "name": "Research Assistant",
            /* ... full agent object ... */
        },
        "keyId": "ck_1234567890",
        "secretKey": "sk_abcdef123456" // Only returned on creation
    }
}
```

### Get Agent

**GET** `/api/agents/:agentId`

Retrieve a specific agent.

**Response:**
```json
{
    "success": true,
    "data": {
        /* Full agent object */
    }
}
```

### Update Agent

**PUT** `/api/agents/:agentId`

Update agent properties.

**Request Body:**
```json
{
    "name": "Updated Name",
    "description": "Updated description",
    "capabilities": ["research", "coding"],
    "status": "busy",
    "metadata": {
        "custom": "data"
    },
    "mxpEnabled": true,
    "mxpPreferredFormat": "mxp",
    "mxpForceEncryption": true
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        /* Updated agent object */
    }
}
```

### Delete Agent

**DELETE** `/api/agents/:agentId`

Delete an agent and all associated data.

**Response:**
```json
{
    "success": true,
    "message": "Agent deleted successfully"
}
```

---

## Key Management

### Generate Agent Key

**POST** `/api/agents/:agentId/keys`

Generate authentication credentials for an agent.

**Request Body:**
```json
{
    "channelId": "channel-456",
    "name": "Production Key",
    "expiresAt": "2024-12-31T23:59:59Z" // Optional
}
```

**Response (201):**
```json
{
    "success": true,
    "data": {
        "agentId": "agent-123",
        "keyId": "ck_1234567890",
        "secretKey": "sk_abcdef123456", // Only shown once!
        "channelId": "channel-456",
        "name": "Production Key",
        "createdAt": "2024-01-20T10:00:00Z",
        "expiresAt": "2024-12-31T23:59:59Z"
    }
}
```

### Get Agent Keys

**GET** `/api/agents/:agentId/keys`

List all keys for an agent (without secrets).

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "keyId": "ck_1234567890",
            "name": "Production Key",
            "channelId": "channel-456",
            "isActive": true,
            "createdAt": "2024-01-20T10:00:00Z",
            "expiresAt": null,
            "lastUsed": "2024-01-20T15:30:00Z"
        }
    ]
}
```

### Rotate Agent Key

**POST** `/api/agents/:agentId/keys/rotate`

Deactivate current key and generate a new one.

**Request Body:**
```json
{
    "channelId": "channel-456",
    "reason": "Regular rotation"
}
```

**Response:**
Same as Generate Agent Key.

### Revoke Agent Key

**DELETE** `/api/agents/:agentId/keys/:keyId`

Revoke a specific key.

**Response:**
```json
{
    "success": true,
    "message": "Key revoked successfully"
}
```

### Preview Key Generation

**POST** `/api/agents/keys/generate`

Generate a preview key pair before creating an agent.

**Request Body:**
```json
{
    "channelId": "channel-456",
    "agentName": "Test Agent"
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "keyId": "ck_preview_123",
        "secretKey": "sk_preview_456"
    }
}
```

### Cleanup Preview Key

**DELETE** `/api/agents/keys/cleanup/:keyId`

Clean up unused preview keys.

**Response:**
```json
{
    "success": true,
    "message": "Preview key cleaned up"
}
```

---

## Lifecycle Management

### Get Agent Status

**GET** `/api/agents/:agentId/status`

Get real-time agent status.

**Response:**
```json
{
    "success": true,
    "data": {
        "agentId": "agent-123",
        "status": "online",
        "connectionStatus": "connected",
        "lastSeen": "2024-01-20T10:30:00Z",
        "uptime": 3600,
        "activeChannels": ["channel-456"],
        "currentTasks": 2,
        "performance": {
            "messagesProcessed": 150,
            "avgResponseTime": 250,
            "errorRate": 0.02
        }
    }
}
```

### Start Agent

**POST** `/api/agents/:agentId/start`

Start an offline agent.

**Request Body:**
```json
{
    "config": {
        "autoReconnect": true,
        "maxRetries": 5
    }
}
```

**Response:**
```json
{
    "success": true,
    "message": "Agent started successfully"
}
```

### Stop Agent

**POST** `/api/agents/:agentId/stop`

Gracefully stop an agent.

**Request Body:**
```json
{
    "reason": "Maintenance",
    "force": false
}
```

**Response:**
```json
{
    "success": true,
    "message": "Agent stopped successfully"
}
```

### Restart Agent

**POST** `/api/agents/:agentId/restart`

Restart an agent.

**Request Body:**
```json
{
    "reason": "Configuration update",
    "delay": 5000 // milliseconds
}
```

**Response:**
```json
{
    "success": true,
    "message": "Agent restarting"
}
```

### Pause Agent

**POST** `/api/agents/:agentId/pause`

Temporarily pause agent message processing.

**Response:**
```json
{
    "success": true,
    "message": "Agent paused"
}
```

### Resume Agent

**POST** `/api/agents/:agentId/resume`

Resume a paused agent.

**Response:**
```json
{
    "success": true,
    "message": "Agent resumed"
}
```

---

## Memory and Context

### Get Agent Memory

**GET** `/api/agents/:agentId/memory`

Retrieve agent's memory store.

**Query Parameters:**
- `scope` - Memory scope: `agent`, `channel`, `relationship`
- `key` - Specific memory key
- `includeMetadata` - Include metadata (default: true)

**Response:**
```json
{
    "success": true,
    "data": {
        "agentMemory": {
            "identity": {
                "value": "I am a research assistant...",
                "metadata": {
                    "updatedAt": "2024-01-20T10:00:00Z",
                    "version": 2
                }
            },
            "preferences": {
                "value": {
                    "responseStyle": "concise",
                    "language": "en"
                },
                "metadata": {
                    "persistent": true
                }
            }
        }
    }
}
```

### Update Agent Memory

**PUT** `/api/agents/:agentId/memory`

Update agent's memory.

**Request Body:**
```json
{
    "updates": {
        "preferences": {
            "responseStyle": "detailed",
            "language": "en"
        },
        "skills": ["python", "javascript", "go"]
    },
    "metadata": {
        "source": "user_update",
        "timestamp": "2024-01-20T10:00:00Z"
    }
}
```

### Get Agent Context

**GET** `/api/agents/:agentId/context`

Retrieve agent's operational context.

**Response:**
```json
{
    "success": true,
    "data": {
        "systemPrompt": "You are a helpful research assistant...",
        "role": "assistant",
        "constraints": [
            "Always cite sources",
            "Be factual and accurate"
        ],
        "examples": [
            {
                "input": "What is quantum computing?",
                "output": "Quantum computing is..."
            }
        ],
        "activeTools": ["web_search", "calculator"],
        "contextWindow": {
            "current": 2048,
            "max": 4096
        }
    }
}
```

### Update Agent Context

**PUT** `/api/agents/:agentId/context`

Update agent's context.

**Request Body:**
```json
{
    "systemPrompt": "Updated prompt...",
    "constraints": ["New constraint"],
    "activeTools": ["web_search", "code_interpreter"]
}
```

---

## Metrics and Analytics

### Get Agent Metrics

**GET** `/api/agents/:agentId/metrics`

Retrieve performance metrics.

**Query Parameters:**
- `period` - Time period: `hour`, `day`, `week`, `month`
- `metrics` - Comma-separated metrics to include

**Response:**
```json
{
    "success": true,
    "data": {
        "period": "day",
        "metrics": {
            "messages": {
                "sent": 150,
                "received": 200,
                "failed": 3
            },
            "tasks": {
                "assigned": 20,
                "completed": 18,
                "failed": 1,
                "inProgress": 1
            },
            "performance": {
                "avgResponseTime": 250,
                "p95ResponseTime": 500,
                "uptime": 0.99,
                "errorRate": 0.015
            },
            "resources": {
                "cpuUsage": 0.15,
                "memoryUsage": 0.25,
                "networkBandwidth": 1024
            }
        }
    }
}
```

### Get Agent Logs

**GET** `/api/agents/:agentId/logs`

Retrieve agent activity logs.

**Query Parameters:**
- `level` - Log level: `debug`, `info`, `warn`, `error`
- `from` - Start timestamp
- `to` - End timestamp
- `limit` - Number of entries

**Response:**
```json
{
    "success": true,
    "data": {
        "logs": [
            {
                "timestamp": "2024-01-20T10:00:00Z",
                "level": "info",
                "message": "Processing message from channel-456",
                "metadata": {
                    "messageId": "msg-123",
                    "channelId": "channel-456"
                }
            }
        ]
    }
}
```

---

## Batch Operations

### Batch Create Agents

**POST** `/api/agents/batch`

Create multiple agents at once.

**Request Body:**
```json
{
    "agents": [
        {
            "agentId": "agent-1",
            "name": "Agent 1",
            "channelId": "channel-456"
        },
        {
            "agentId": "agent-2",
            "name": "Agent 2",
            "channelId": "channel-456"
        }
    ]
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "created": 2,
        "failed": 0,
        "agents": [/* created agents with keys */]
    }
}
```

### Batch Update Status

**PUT** `/api/agents/batch/status`

Update status for multiple agents.

**Request Body:**
```json
{
    "agentIds": ["agent-1", "agent-2"],
    "status": "offline",
    "reason": "Maintenance"
}
```

---

## Error Responses

All endpoints may return these error responses:

### 400 Bad Request
```json
{
    "success": false,
    "error": "Validation error",
    "details": {
        "field": "agentId",
        "message": "Agent ID already exists"
    }
}
```

### 401 Unauthorized
```json
{
    "success": false,
    "error": "Authentication required"
}
```

### 403 Forbidden
```json
{
    "success": false,
    "error": "Access denied",
    "message": "You don't have permission to access this agent"
}
```

### 404 Not Found
```json
{
    "success": false,
    "error": "Agent not found"
}
```

### 500 Internal Server Error
```json
{
    "success": false,
    "error": "Internal server error",
    "message": "An unexpected error occurred"
}
```

## Rate Limiting

- **Create Agent**: 10 per minute
- **Update Operations**: 30 per minute
- **Read Operations**: 100 per minute
- **Key Operations**: 5 per minute

Exceeded limits return 429 Too Many Requests.

## MXP Configuration

### Agent MXP Settings

When creating or updating agents, you can configure MXP (Model Exchange Protocol) settings for efficient agent-to-agent communication:

```json
{
    "mxpEnabled": true,                    // Enable MXP protocol
    "mxpPreferredFormat": "auto",         // "auto" | "mxp" | "natural-language"
    "mxpForceEncryption": false           // Force encryption for all messages
}
```

#### Configuration Options:

- **mxpEnabled** (boolean): Enable or disable MXP protocol for this agent
  - `true`: Agent uses MXP for efficient communication
  - `false`: Agent uses only natural language messages

- **mxpPreferredFormat** (string): Message format preference
  - `"auto"`: Automatically detect and convert suitable messages
  - `"mxp"`: Prefer MXP format for all compatible messages
  - `"natural-language"`: Use natural language even when MXP is enabled

- **mxpForceEncryption** (boolean): Encryption requirement
  - `true`: All MXP messages are encrypted with AES-256-GCM
  - `false`: Encryption is optional based on message content

### MXP Statistics Endpoint

**GET** `/api/agents/:agentId/mxp/stats`

Retrieve MXP protocol statistics for an agent.

**Response:**
```json
{
    "success": true,
    "data": {
        "totalMessages": 1000,
        "naturalLanguageMessages": 200,
        "mxpMessages": 800,
        "mxpPercentage": "80.00%",
        "messagesConverted": 750,
        "messagesEncrypted": 800,
        "encryptionRate": "100.00%",
        "conversionFailures": 50,
        "bandwidthSaved": "75.5MB",
        "tokensSaved": 40000
    }
}
```

### Reset MXP Statistics

**POST** `/api/agents/:agentId/mxp/stats/reset`

Reset MXP statistics counters for an agent.

**Response:**
```json
{
    "success": true,
    "message": "MXP statistics reset successfully"
}
```

## Best Practices

1. **Agent Naming**: Use descriptive, unique names
2. **Key Rotation**: Rotate keys regularly for security
3. **Capability Declaration**: Accurately declare agent capabilities
4. **Memory Management**: Clean up unused memory periodically
5. **Error Handling**: Implement retry logic for transient failures
6. **Monitoring**: Track agent metrics for performance optimization
7. **MXP Configuration**: 
   - Start with `mxpPreferredFormat: "auto"` for gradual adoption
   - Enable `mxpForceEncryption` for sensitive data
   - Monitor MXP statistics to optimize performance
   - Use MXP for high-frequency agent communication

## Next Steps

- See [WebSocket Events](websocket.md) for real-time agent events
- Review [Memory API](memory.md) for detailed memory operations
- Check [Tasks API](tasks.md) for task assignment
- Explore [SDK Documentation](../sdk/index.md) for client implementation