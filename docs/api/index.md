# MXF API Reference

Comprehensive reference for the Model Exchange Framework (MXF) backend API, covering REST endpoints, WebSocket events, authentication, schemas, and integration patterns.

## Overview

MXF provides two complementary APIs designed for different use cases:

1. **REST API** - Traditional HTTP endpoints for CRUD operations and management
2. **WebSocket API** - Real-time bidirectional communication for agent interactions

**Recent Additions:**
- **Semantic Search API** - Meilisearch-powered memory search endpoints
- **Validation APIs** - Proactive validation and auto-correction endpoints
- **Analytics APIs** - Comprehensive performance and error prediction metrics

### REST API

**Configuration:**
- **Base URL:** `http://localhost:3001/api/`
- **Protocol:** HTTP/HTTPS
- **Format:** JSON over HTTP (RESTful)
- **API Version:** v1 (stable)
- **Rate Limiting:** 100 requests/minute per client

**Authentication Methods:**
- **JWT Tokens** - Dashboard users and external applications
- **Agent API Keys** - SDK agents and programmatic access

**Use Cases:**
- Channel and agent management
- Task creation and tracking
- Analytics and reporting
- Configuration management
- User account operations

### WebSocket API

**Configuration:**
- **Endpoint:** `ws://localhost:3001/socket.io/`
- **Protocol:** Socket.IO v4
- **Transport:** WebSocket with HTTP long-polling fallback
- **Heartbeat:** 30-second keepalive

**Authentication:**
- API key-based handshake on connection
- Per-agent authentication
- Secure channel membership verification

**Use Cases:**
- Real-time agent-to-agent messaging
- Live task updates and notifications
- Control loop coordination
- Tool execution and results
- Event streaming

## Authentication

### JWT Authentication (Dashboard/REST)
- Obtain via magic link or login
- Send as `Authorization: Bearer <token>` header
- Token required for all protected endpoints

### Agent Key Authentication (SDK/WebSocket)
- Obtain via dashboard (Agents tab, Authentication)
- For REST: Send as `x-agent-key: <key>` header
- For WebSocket: Include in connection auth object
- Key required for all agent operations

## Common Response Format

### REST Responses

```json
{
    "success": true,
    "data": { ... }
}
```
- Errors return `success: false` and an `error` field

### WebSocket Events

Events follow a consistent naming pattern:
- Request: `resource:action` (e.g., `message:send`)
- Response: `resource:action:response` or broadcast event
- Error: `resource:error`

## Quick Start

### REST API Example

```bash
# Get all channels (with JWT auth)
curl -X GET http://localhost:3001/api/channels \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

# Create a channel (with Agent Key auth)
curl -X POST http://localhost:3001/api/channels \
  -H "x-agent-key: YOUR_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "project-team",
    "name": "Project Team",
    "description": "Collaborative workspace"
  }'
```

### WebSocket Example

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

// Initialize SDK
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create an agent
const agent = sdk.createAgent({
    agentId: 'my-agent',
    name: 'My Agent',
    channelId: 'project-team'
});

// Send message using event-based API
agent.emit(Events.Message.CHANNEL_MESSAGE, {
    channelId: 'project-team',
    content: 'Hello team!',
    metadata: { type: 'greeting' }
});

// Listen for channel messages
agent.on(Events.Message.CHANNEL_MESSAGE, (payload) => {
    console.log('Received:', payload.data);
});
```

## API Reference

### Core APIs

**Essential endpoints for channel and agent management:**

- **[Channels API](channels.md)** - Create, manage, and query channels
- **[Agents API](agents.md)** - Agent registration, configuration, and monitoring
- **[Tasks API](tasks.md)** - Task creation, assignment, and tracking
- **[Memory API](memory.md)** - Multi-scope memory persistence
- **[Authentication API](auth.md)** - User and agent authentication

### Real-Time Communication

**WebSocket-based real-time APIs:**

- **[WebSocket Events](websocket.md)** - Complete Socket.IO event reference
- **[Control Loop API](control-loop.md)** - ORPAR cycle management and events
- **[MCP API](mcp.md)** - Model Context Protocol tool execution

### Memory & Search

**Semantic search and memory management:**

- **[Memory API](memory.md)** - Multi-scope memory persistence
- **Memory Search Tools** (via MCP):
  - `memory_search_conversations` - Semantic conversation search
  - `memory_search_actions` - Tool usage history search
  - `memory_search_patterns` - Cross-channel pattern discovery

### Analytics & Monitoring

**Performance tracking and system health:**

- **[Analytics API](analytics.md)** - Performance metrics and insights
- **[Validation Analytics API](validation-analytics.md)** - Validation performance metrics
- **[Auto-Correction API](auto-correction.md)** - Error correction analytics
- **[Proactive Validation API](proactive-validation.md)** - Pre-execution validation

### Configuration & Management

**System configuration and administration:**

- **[Config API](config.md)** - System configuration management
- **[Users API](users.md)** - User account management
- **[Dashboard API](dashboard.md)** - Dashboard-specific endpoints

## API Features

### Error Handling

All APIs follow consistent error patterns:

**REST API Errors:**
```json
{
    "success": false,
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "Invalid channel ID format",
        "details": {
            "field": "channelId",
            "expected": "string",
            "received": "number"
        }
    }
}
```

**WebSocket Errors:**
```typescript
socket.on('error', (error) => {
    console.error('Error:', error.code, error.message);
});
```

**Common Error Codes:**
- `AUTHENTICATION_ERROR` - Invalid or missing credentials
- `VALIDATION_ERROR` - Request validation failed
- `NOT_FOUND` - Resource not found
- `PERMISSION_DENIED` - Insufficient permissions
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `INTERNAL_ERROR` - Server error

### Rate Limiting

**REST API:**
- 100 requests per minute per client IP
- 429 status code when exceeded
- `Retry-After` header indicates wait time

**WebSocket API:**
- 1000 events per minute per connection
- Automatic backoff on rate limit
- Connection throttling for abuse prevention

### Pagination

Large result sets use cursor-based pagination:

```bash
# First page
GET /api/channels?limit=20

# Next page
GET /api/channels?limit=20&cursor=eyJpZCI6IjEyMyJ9
```

**Response:**
```json
{
    "success": true,
    "data": [...],
    "pagination": {
        "hasMore": true,
        "nextCursor": "eyJpZCI6IjE0NyJ9",
        "total": 156
    }
}
```

### Filtering & Sorting

Most list endpoints support filtering and sorting:

```bash
# Filter by status
GET /api/tasks?status=in_progress

# Sort by creation date
GET /api/tasks?sort=-createdAt

# Multiple filters
GET /api/agents?role=provider&status=online&sort=name
```

### Webhooks

Configure webhooks for external integrations:

```bash
POST /api/webhooks
{
    "url": "https://your-app.com/webhook",
    "events": ["task:completed", "agent:connected"],
    "secret": "webhook_secret_key"
}
```

**Webhook Payload:**
```json
{
    "event": "task:completed",
    "timestamp": 1698765432000,
    "data": { ... },
    "signature": "sha256=..."
}
```

## Integration Guides

### SDK Integration

The MXF SDK provides TypeScript/JavaScript clients:

```typescript
import { MxfSDK } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

const agent = await sdk.createAgent({
    agentId: 'my-agent',
    name: 'My Agent',
    channelId: 'main',
    keyId: 'key-id',
    secretKey: 'secret'
});

await agent.connect();
```

**See:** [SDK Documentation](../sdk/index.md)

### REST Client Integration

Use any HTTP client library:

```python
# Python example with requests
import requests

headers = {
    'Authorization': f'Bearer {jwt_token}',
    'Content-Type': 'application/json'
}

response = requests.get(
    'http://localhost:3001/api/channels',
    headers=headers
)

channels = response.json()['data']
```

### WebSocket Client Integration

Use Socket.IO clients in any language:

```python
# Python example with python-socketio
import socketio

sio = socketio.Client()

@sio.on('message:received')
def on_message(data):
    print('Message:', data)

sio.connect('http://localhost:3001', auth={
    'agentKey': 'YOUR_KEY',
    'agentId': 'my-agent'
})
```

## Best Practices

### Authentication

1. **Secure Storage**: Store API keys and JWTs securely
2. **Token Rotation**: Rotate tokens regularly
3. **Least Privilege**: Request minimum required permissions
4. **HTTPS**: Always use HTTPS in production

### Performance

1. **Pagination**: Use pagination for large result sets
2. **Caching**: Cache responses when appropriate
3. **Batch Operations**: Use batch endpoints when available
4. **Connection Pooling**: Reuse WebSocket connections

### Error Handling

1. **Retry Logic**: Implement exponential backoff
2. **Error Logging**: Log errors with context
3. **Graceful Degradation**: Handle API unavailability
4. **User Feedback**: Provide clear error messages

### Security

1. **Input Validation**: Validate all inputs client-side
2. **Rate Limiting**: Respect rate limits
3. **Authentication**: Always include credentials
4. **CORS**: Configure CORS appropriately

## API Versioning

Current version: **v1** (stable)

**Version Strategy:**
- Major version in URL: `/api/v1/`, `/api/v2/`
- Backward compatibility within major versions
- Deprecation warnings 6 months before removal
- Version header: `X-API-Version: 1.0`

## Support & Resources

- **API Status**: [status.mxf.dev](https://status.mxf.dev)
- **OpenAPI Spec**: `/api/openapi.json`
- **Postman Collection**: `/api/postman-collection.json`
- **Rate Limits**: Check `X-RateLimit-*` headers
- **Issues**: [GitHub Issues](https://github.com/BradA1878/model-exchange-framework/issues)

## Related Documentation

- **[SDK Reference](../sdk/index.md)** - TypeScript SDK for agents
- **[Getting Started](../getting-started.md)** - Quick start guide
- **[Server Services](../mxf/server-services.md)** - Backend service documentation
- **[Dashboard Guide](../dashboard/index.md)** - Web interface
- **[Core Architecture](../mxf/index.md)** - System design

---

**Ready to integrate?** Start with the [Getting Started Guide](../getting-started.md) or explore specific API endpoints above.
