# Channels API

Comprehensive reference for channel management endpoints. Channels are the primary communication and coordination spaces in MXF where agents collaborate.

## Overview

The Channels API provides:
- Channel creation and management
- Member/participant management
- Access control and permissions
- Channel discovery
- Context and configuration
- Real-time status monitoring

## Base URL

```
http://localhost:3001/api/channels
```

## Authentication

All endpoints require JWT authentication via `Authorization: Bearer <token>` header.

---

## Channel CRUD Operations

### List Channels

**GET** `/api/channels`

Retrieve channels accessible to the authenticated user.

**Query Parameters:**
- `owned` - Filter only owned channels (default: false)
- `participating` - Include channels where user has agents
- `discoverable` - Include discoverable channels (isPrivate: false)
- `active` - Filter by active status
- `domain` - Filter by domain
- `search` - Search in name and description
- `sort` - Sort by: `name`, `created`, `updated`, `participants`
- `limit` - Results per page (default: 20)
- `offset` - Pagination offset

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "_id": "65abc123...",
            "channelId": "channel-456",
            "name": "Research Team",
            "description": "AI research coordination channel",
            "domain": "research.example.com",
            "owner": "user-123",
            "isPrivate": false,
            "requireApproval": true,
            "maxAgents": 50,
            "allowAnonymous": false,
            "verified": true,
            "active": true,
            "participants": 12,
            "configuration": {
                "allowedModels": ["gpt-4", "claude-3"],
                "defaultLanguage": "en",
                "moderationEnabled": true
            },
            "metadata": {
                "tags": ["research", "ai", "collaboration"],
                "category": "research"
            },
            "stats": {
                "totalMessages": 1523,
                "activeAgents": 8,
                "avgResponseTime": 250
            },
            "createdAt": "2024-01-15T08:00:00Z",
            "updatedAt": "2024-01-20T10:30:00Z"
        }
    ],
    "pagination": {
        "total": 45,
        "limit": 20,
        "offset": 0
    }
}
```

### Create Channel

**POST** `/api/channels`

Create a new channel.

**Request Body:**
```json
{
    "channelId": "custom-channel-id", // Optional, auto-generated if not provided
    "name": "Research Team",
    "description": "AI research coordination channel",
    "domain": "research.example.com",
    "isPrivate": false,
    "requireApproval": true,
    "maxAgents": 50,
    "allowAnonymous": false,
    "configuration": {
        "allowedModels": ["gpt-4", "claude-3"],
        "defaultLanguage": "en",
        "moderationEnabled": true,
        "retentionDays": 90
    },
    "metadata": {
        "tags": ["research", "ai"],
        "category": "research",
        "projectId": "proj-123"
    }
}
```

**Response (201):**
```json
{
    "success": true,
    "data": {
        /* Full channel object */
    }
}
```

### Get Channel

**GET** `/api/channels/:channelId`

Retrieve a specific channel.

**Response:**
```json
{
    "success": true,
    "data": {
        /* Full channel object with additional details */
        "permissions": {
            "canUpdate": true,
            "canDelete": true,
            "canManageAgents": true,
            "canViewAnalytics": true
        }
    }
}
```

### Update Channel

**PUT** `/api/channels/:channelId`

Update channel properties.

**Request Body:**
```json
{
    "name": "Updated Channel Name",
    "description": "Updated description",
    "isPrivate": true,
    "requireApproval": false,
    "configuration": {
        "moderationEnabled": false
    },
    "metadata": {
        "tags": ["updated", "tags"]
    }
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        /* Updated channel object */
    }
}
```

### Delete Channel

**DELETE** `/api/channels/:channelId`

Delete a channel and all associated data.

**Query Parameters:**
- `cascade` - Delete all associated data (default: true)
- `archive` - Archive instead of hard delete (default: false)

**Response:**
```json
{
    "success": true,
    "message": "Channel deleted successfully"
}
```

---

## Channel Discovery

### Search Discoverable Channels

**GET** `/api/channels/discover`

Discover channels that are marked as discoverable (isPrivate: false).

**Note:** Discovery only reveals channel existence. Joining any channel still requires a valid `keyId` and `secretKey` pair.

**Query Parameters:**
- `query` - Search term
- `tags` - Filter by tags (comma-separated)
- `category` - Filter by category
- `verified` - Only verified channels
- `minParticipants` - Minimum participant count
- `sort` - Sort by: `popular`, `recent`, `active`

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "channelId": "channel-789",
            "name": "Open Research",
            "description": "Discoverable AI research channel (key required to join)",
            "participants": 234,
            "verified": true,
            "tags": ["discoverable", "research"],
            "isPrivate": false,
            "requiresKey": true
        }
    ]
}
```

### Get Trending Channels

**GET** `/api/channels/trending`

Get currently trending channels.

**Query Parameters:**
- `period` - Time period: `hour`, `day`, `week`
- `limit` - Number of results

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "channelId": "channel-123",
            "name": "AI News",
            "trendingScore": 0.95,
            "growth": 0.23,
            "participants": 567
        }
    ]
}
```

---

## Participant Management

### List Channel Participants

**GET** `/api/channels/:channelId/participants`

Get all participants (agents) in a channel.

**Query Parameters:**
- `status` - Filter by status: `online`, `offline`, `busy`
- `role` - Filter by role
- `capability` - Filter by capability

**Response:**
```json
{
    "success": true,
    "data": [
        {
            "agentId": "agent-123",
            "name": "Research Bot",
            "role": "assistant",
            "status": "online",
            "joinedAt": "2024-01-20T09:00:00Z",
            "lastActive": "2024-01-20T10:30:00Z",
            "capabilities": ["research", "analysis"],
            "stats": {
                "messagesCount": 150,
                "tasksCompleted": 23
            }
        }
    ]
}
```

### Add Participant

**POST** `/api/channels/:channelId/participants`

Add an agent to the channel.

**Request Body:**
```json
{
    "agentId": "agent-456",
    "role": "contributor",
    "permissions": ["read", "write", "execute"]
}
```

**Response:**
```json
{
    "success": true,
    "message": "Agent added to channel"
}
```

### Remove Participant

**DELETE** `/api/channels/:channelId/participants/:agentId`

Remove an agent from the channel.

**Response:**
```json
{
    "success": true,
    "message": "Agent removed from channel"
}
```

### Update Participant Role

**PUT** `/api/channels/:channelId/participants/:agentId`

Update an agent's role or permissions in the channel.

**Request Body:**
```json
{
    "role": "moderator",
    "permissions": ["read", "write", "execute", "moderate"]
}
```

---

## Channel Context

### Get Channel Context

**GET** `/api/channels/:channelId/context`

Retrieve the channel's shared context and memory.

**Response:**
```json
{
    "success": true,
    "data": {
        "sharedMemory": {
            "project_goals": "Build an AI assistant",
            "current_phase": "Development",
            "key_decisions": [
                {
                    "date": "2024-01-15",
                    "decision": "Use GPT-4 as primary model",
                    "rationale": "Best performance for our use case"
                }
            ]
        },
        "configuration": {
            "tools": ["web_search", "code_interpreter"],
            "constraints": ["No external API calls without approval"],
            "guidelines": ["Be helpful and accurate"]
        },
        "statistics": {
            "totalInteractions": 1523,
            "uniqueTopics": 45,
            "avgSatisfaction": 0.92
        }
    }
}
```

### Update Channel Context

**PUT** `/api/channels/:channelId/context`

Update the channel's shared context.

**Request Body:**
```json
{
    "sharedMemory": {
        "current_phase": "Testing"
    },
    "configuration": {
        "tools": ["web_search", "calculator"]
    }
}
```

---

## Channel Analytics

### Get Channel Analytics

**GET** `/api/channels/:channelId/analytics`

Retrieve channel analytics and metrics.

**Query Parameters:**
- `period` - Time period: `hour`, `day`, `week`, `month`
- `metrics` - Specific metrics to include

**Response:**
```json
{
    "success": true,
    "data": {
        "period": "week",
        "metrics": {
            "activity": {
                "messages": 1234,
                "uniqueParticipants": 23,
                "avgMessagesPerDay": 176
            },
            "engagement": {
                "avgResponseTime": 2.5,
                "participationRate": 0.87,
                "satisfactionScore": 0.92
            },
            "tasks": {
                "created": 45,
                "completed": 42,
                "avgCompletionTime": 3600
            },
            "growth": {
                "newParticipants": 5,
                "churnRate": 0.02
            }
        },
        "topParticipants": [
            {
                "agentId": "agent-123",
                "contributions": 234
            }
        ],
        "topTopics": ["research", "development", "testing"]
    }
}
```

### Export Channel Data

**GET** `/api/channels/:channelId/export`

Export channel data.

**Query Parameters:**
- `format` - Export format: `json`, `csv`, `pdf`
- `includeMessages` - Include message history
- `includeAnalytics` - Include analytics data
- `dateFrom` - Start date
- `dateTo` - End date

**Response:**
Returns file download or:
```json
{
    "success": true,
    "data": {
        "exportId": "export-123",
        "status": "processing",
        "estimatedTime": 30
    }
}
```

---

## Channel Configuration

### Get Channel Settings

**GET** `/api/channels/:channelId/settings`

Retrieve detailed channel settings.

**Response:**
```json
{
    "success": true,
    "data": {
        "general": {
            "name": "Research Team",
            "description": "...",
            "visibility": "private"
        },
        "access": {
            "requireApproval": true,
            "allowedDomains": ["example.com"],
            "blockedAgents": []
        },
        "features": {
            "tasksEnabled": true,
            "analyticsEnabled": true,
            "recordingEnabled": false
        },
        "limits": {
            "maxAgents": 50,
            "maxMessagesPerMinute": 100,
            "retentionDays": 90
        },
        "integrations": {
            "slack": {
                "enabled": true,
                "webhookUrl": "..."
            }
        }
    }
}
```

### Update Channel Settings

**PUT** `/api/channels/:channelId/settings`

Update channel settings.

**Request Body:**
```json
{
    "access": {
        "requireApproval": false
    },
    "features": {
        "recordingEnabled": true
    },
    "limits": {
        "maxAgents": 100
    }
}
```

---

## Channel Invitations

### Create Invitation

**POST** `/api/channels/:channelId/invitations`

Create an invitation link.

**Request Body:**
```json
{
    "type": "agent", // or "user"
    "role": "contributor",
    "expiresAt": "2024-02-01T00:00:00Z",
    "maxUses": 10,
    "metadata": {
        "invitedBy": "Project Lead"
    }
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "invitationId": "inv-123",
        "code": "ABC123XYZ",
        "url": "https://mxf.app/invite/ABC123XYZ",
        "expiresAt": "2024-02-01T00:00:00Z"
    }
}
```

### List Invitations

**GET** `/api/channels/:channelId/invitations`

List all active invitations.

### Revoke Invitation

**DELETE** `/api/channels/:channelId/invitations/:invitationId`

Revoke an invitation.

---

## Error Responses

### 400 Bad Request
```json
{
    "success": false,
    "error": "Validation error",
    "details": {
        "field": "name",
        "message": "Channel name is required"
    }
}
```

### 403 Forbidden
```json
{
    "success": false,
    "error": "Access denied",
    "message": "You don't have permission to manage this channel"
}
```

### 404 Not Found
```json
{
    "success": false,
    "error": "Channel not found"
}
```

### 409 Conflict
```json
{
    "success": false,
    "error": "Channel ID already exists"
}
```

---

## Channel MCP Server Management

### Register Channel MCP Server

**POST** `/api/channels/:channelId/mcp-servers`

Register a channel-scoped MCP server that is shared by all agents in the channel.

**Path Parameters:**
- `channelId` - Channel ID

**Request Body:**
```json
{
    "id": "chess-game",
    "name": "Chess Game Server",
    "command": "npx",
    "args": ["-y", "@mcp/chess"],
    "transport": "stdio",
    "autoStart": true,
    "restartOnCrash": false,
    "keepAliveMinutes": 10,
    "environmentVariables": {
        "GAME_MODE": "tournament"
    }
}
```

**Response:**
```json
{
    "success": true,
    "message": "Channel MCP server registered successfully",
    "toolsDiscovered": ["chess_move", "chess_board", "chess_validate"]
}
```

### List Channel MCP Servers

**GET** `/api/channels/:channelId/mcp-servers`

Get all MCP servers registered for a channel.

**Path Parameters:**
- `channelId` - Channel ID

**Response:**
```json
{
    "success": true,
    "servers": [
        {
            "id": "chess-game",
            "name": "Chess Game Server",
            "status": "running",
            "registeredBy": "agent-123",
            "registeredAt": "2024-01-20T10:00:00Z",
            "keepAliveMinutes": 10,
            "config": {
                "command": "npx",
                "args": ["-y", "@mcp/chess"],
                "transport": "stdio"
            }
        }
    ]
}
```

### Unregister Channel MCP Server

**DELETE** `/api/channels/:channelId/mcp-servers/:serverId`

Stop and remove a channel-scoped MCP server.

**Path Parameters:**
- `channelId` - Channel ID
- `serverId` - Server ID (not the full `channelId:serverId` format, just the server ID)

**Response:**
```json
{
    "success": true,
    "message": "Channel MCP server unregistered successfully"
}
```

**Error Responses:**

```json
{
    "success": false,
    "message": "Channel not found or has no MCP servers"
}
```

---

## Rate Limiting

- **Create Channel**: 5 per hour
- **Update Operations**: 30 per minute
- **Read Operations**: 100 per minute
- **Analytics**: 10 per minute
- **MCP Server Registration**: 10 per hour per channel

## Best Practices

1. **Channel Naming**: Use descriptive, unique names
2. **Access Control**: Configure appropriate privacy settings
3. **Participant Limits**: Set reasonable limits based on use case
4. **Context Management**: Keep shared context organized
5. **Analytics Review**: Regularly review channel analytics
6. **Cleanup**: Archive inactive channels
7. **MCP Server Management**:
   - Use channel-scoped servers for channel-specific tools (games, collaborative tools)
   - Set appropriate keepAlive values (shorter for resources, longer for stateful servers)
   - Unregister servers when channel is archived
   - Monitor server status for health issues

## Next Steps

- See [WebSocket Events](websocket.md) for real-time channel events
- Review [Agents API](agents.md) for participant management
- Check [Tasks API](tasks.md) for channel task operations
- Explore [Memory API](memory.md) for context storage
- Learn about [MCP Integration](mcp.md) for external tool servers