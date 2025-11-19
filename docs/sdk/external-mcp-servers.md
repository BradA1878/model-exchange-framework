# External MCP Server Registration via SDK

## Overview

The MXF SDK now supports **dynamic external MCP server registration**, allowing developers to add their own MCP servers to extend agent capabilities without modifying server code or configuration files.

## Key Features

✅ **EventBus-Based**: Uses EventBus events (no HTTP API dependency)
✅ **stdio Support**: Register npm packages or local executables
✅ **HTTP Support**: Connect to remote MCP servers
✅ **Dynamic Registration**: Add/remove servers at runtime
✅ **Auto-Discovery**: Tools from registered servers become available immediately
✅ **Lifecycle Management**: Automatic startup, health checks, and crash recovery

---

## Quick Start

### Basic Registration (stdio)

```typescript
import { MxfSDK } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: 'your-username',
    password: 'your-password'
});

await sdk.connect();

// Register an external MCP server
await sdk.registerExternalMcpServer({
    id: 'my-custom-server',
    name: 'My Custom Server',
    command: 'npx',
    args: ['-y', '@my-org/my-mcp-package'],
    autoStart: true
});
```

### HTTP-Based Server

```typescript
await sdk.registerExternalMcpServer({
    id: 'remote-server',
    name: 'Remote MCP Server',
    transport: 'http',
    url: 'https://my-mcp-server.example.com/mcp',
    autoStart: true
});
```

---

## Configuration Options

### ServerConfig Interface

```typescript
{
    // Required fields
    id: string;                      // Unique identifier
    name: string;                    // Display name

    // stdio transport (for npm packages, local executables)
    command?: string;                // Executable command (e.g., 'npx', 'node')
    args?: string[];                 // Command arguments

    // HTTP transport (for remote servers)
    transport?: 'stdio' | 'http';   // Connection type (default: 'stdio')
    url?: string;                    // HTTP endpoint URL

    // Lifecycle options
    autoStart?: boolean;             // Start immediately (default: true)
    restartOnCrash?: boolean;        // Auto-restart on failure (default: true)
    maxRestartAttempts?: number;     // Max restart attempts (default: 3)

    // Advanced options
    environmentVariables?: Record<string, string>;  // Env vars for the process
    healthCheckInterval?: number;    // Health check interval ms (default: 30000)
    startupTimeout?: number;          // Startup timeout ms (default: 10000)
}
```

---

## Complete Examples

### Example 1: Register npm Package

```typescript
// Register the official MCP weather server
await sdk.registerExternalMcpServer({
    id: 'weather-server',
    name: 'Weather MCP Server',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-weather'],
    autoStart: true,
    environmentVariables: {
        WEATHER_API_KEY: process.env.WEATHER_API_KEY!
    }
});

// Tools from the weather server are now available
const agent = await sdk.createAgent({
    agentId: 'weather-agent',
    // ... config ...
});

await agent.connect();

// Use weather tools
const forecast = await agent.executeTool('get_forecast', {
    location: 'San Francisco',
    days: 7
});
```

### Example 2: Register Local Development Server

```typescript
// Register your custom MCP server during development
await sdk.registerExternalMcpServer({
    id: 'my-dev-server',
    name: 'My Development Server',
    command: 'node',
    args: ['./my-mcp-servers/dev-server.js'],
    autoStart: true,
    restartOnCrash: false,  // Don't auto-restart during development
    environmentVariables: {
        DEBUG: 'true',
        NODE_ENV: 'development'
    }
});
```

### Example 3: Register Production HTTP Server

```typescript
// Connect to a production HTTP MCP server
await sdk.registerExternalMcpServer({
    id: 'prod-analytics',
    name: 'Production Analytics Server',
    transport: 'http',
    url: 'https://mcp.mycompany.com/analytics',
    autoStart: true,
    healthCheckInterval: 60000,  // Check every minute
    maxRestartAttempts: 5        // Retry 5 times on connection loss
});
```

### Example 4: Conditional Registration

```typescript
// Register different servers based on environment
const environment = process.env.NODE_ENV || 'development';

if (environment === 'production') {
    // Use production HTTP server
    await sdk.registerExternalMcpServer({
        id: 'data-server',
        name: 'Production Data Server',
        transport: 'http',
        url: process.env.PROD_MCP_URL!
    });
} else {
    // Use local development server
    await sdk.registerExternalMcpServer({
        id: 'data-server',
        name: 'Development Data Server',
        command: 'npm',
        args: ['run', 'dev:mcp-server']
    });
}
```

### Example 5: Unregister Server

```typescript
// Stop and remove an external server
await sdk.unregisterExternalMcpServer('my-custom-server');

console.log('Server stopped and removed');
// Tools from this server are no longer available
```

---

## Tool Discovery After Registration

After registering an external MCP server, its tools become available to all agents:

```typescript
// Register server
await sdk.registerExternalMcpServer({
    id: 'calculator-pro',
    name: 'Advanced Calculator',
    command: 'npx',
    args: ['-y', '@myorg/calculator-pro-mcp']
});

// Create agent
const agent = await sdk.createAgent({
    agentId: 'math-agent',
    // ... config ...
});

await agent.connect();

// List all tools (includes tools from calculator-pro)
const tools = await agent.listTools();

// Filter to see calculator tools
const calcTools = tools.filter(t => t.metadata?.source === 'calculator-pro');
console.log('Calculator tools:', calcTools.map(t => t.name));

// Use a tool from the custom server
const result = await agent.executeTool('advanced_integration', {
    function: 'sin(x)',
    lowerBound: 0,
    upperBound: Math.PI
});
```

---

## Error Handling

### Registration Errors

```typescript
try {
    await sdk.registerExternalMcpServer({
        id: 'my-server',
        name: 'My Server',
        command: 'invalid-command',
        args: []
    });
} catch (error) {
    if (error.message.includes('timeout')) {
        console.error('Registration timeout - server took too long to start');
    } else if (error.message.includes('already registered')) {
        console.error('Server ID already in use');
    } else {
        console.error('Registration failed:', error.message);
    }
}
```

### Server Lifecycle Errors

The system automatically handles:
- **Startup failures**: Retries up to `maxRestartAttempts`
- **Crash recovery**: Auto-restarts if `restartOnCrash: true`
- **Health check failures**: Monitors server health and attempts recovery
- **Tool discovery failures**: Logs errors but doesn't crash MXF

---

## Best Practices

### 1. Use Unique Server IDs

```typescript
// ✅ Good: Descriptive unique ID
id: 'acme-weather-v2'

// ❌ Bad: Generic ID (might conflict)
id: 'server1'
```

### 2. Set Appropriate Restart Policies

```typescript
// Development: Don't auto-restart (debug crashes)
restartOnCrash: false

// Production: Auto-restart for reliability
restartOnCrash: true,
maxRestartAttempts: 5
```

### 3. Provide Environment Variables

```typescript
environmentVariables: {
    API_KEY: process.env.MY_API_KEY!,
    LOG_LEVEL: 'info',
    TIMEOUT: '30000'
}
```

### 4. Handle Registration Errors

```typescript
const registered = await sdk.registerExternalMcpServer(config);

if (!registered) {
    console.error('Registration failed - check server logs');
    // Fallback behavior
}
```

---

## Architecture

### EventBus Communication

Registration uses EventBus (not HTTP API):

```
SDK                           Server
 │                             │
 ├─ EXTERNAL_SERVER_REGISTER →│
 │                             ├─ ExternalMcpServerManager.registerServer()
 │                             ├─ Start server process
 │                             ├─ Discover tools
 │                             │
 │← EXTERNAL_SERVER_REGISTERED─┤
 │  (success/failure)          │
```

**Benefits**:
- No HTTP dependency
- Works over WebSocket
- Real-time notifications
- Consistent with MXF architecture

### Tool Discovery Flow

```
1. SDK registers server via EventBus
2. ExternalMcpServerManager starts server process
3. MCP initialize handshake
4. Tools discovered via tools/list
5. HybridMcpToolRegistry updated
6. Tools available to all agents immediately
```

---

## Comparison with Pre-Configured Servers

### Before (Hardcoded Configuration)

```typescript
// Server code modification required
// File: src/shared/protocols/mcp/services/ExternalServerConfigs.ts

export const MY_SERVER_CONFIG: ExternalServerConfig = {
    id: 'my-server',
    name: 'My Server',
    command: 'npx',
    args: ['-y', 'my-mcp-package']
};

// Rebuild and restart server
```

### After (SDK Registration)

```typescript
// No server code modification needed
// Runtime registration via SDK

await sdk.registerExternalMcpServer({
    id: 'my-server',
    name: 'My Server',
    command: 'npx',
    args: ['-y', 'my-mcp-package']
});

// Ready immediately
```

---

## Limitations & Future Enhancements

### Current Limitations

1. **No Agent-Private Servers**: Registered servers are available to all agents in MXF
2. **No Per-Channel Servers**: Servers are global, not channel-specific
3. **No Handler Upload**: Can't upload JavaScript handler code, must use external process

### Planned Enhancements

- Agent-private server registration
- Channel-scoped server visibility
- Server health monitoring API
- Tool usage analytics per server

---

## Troubleshooting

### Server Won't Start

```
Error: External server registration timeout after 30 seconds
```

**Solutions**:
- Check command/args are correct
- Verify package is installed (`npx -y package-name`)
- Check environment variables are set
- Review server logs in MXF output

### Tools Not Appearing

```
Tools from my-server not showing up
```

**Solutions**:
- Wait for tool discovery (can take 2-5 seconds)
- Check server started successfully (check MXF logs)
- Verify server implements MCP protocol correctly
- List tools with `agent.listTools()` to debug

### Registration Fails

```
Error: Server ID already registered
```

**Solutions**:
- Use unique server ID
- Unregister old server first: `await sdk.unregisterExternalMcpServer(id)`
- Check server isn't pre-configured in `ExternalServerConfigs.ts`

---

## Additional Resources

- [MCP Server Specification](https://spec.modelcontextprotocol.io/)
- [Building MCP Servers](https://modelcontextprotocol.io/docs/building)
- [MCP SDK Repository](https://github.com/modelcontextprotocol/typescript-sdk)
- [Example MCP Servers](https://github.com/modelcontextprotocol/servers)

---

**Status**: ✅ Feature Complete - SDK-based external MCP server registration fully implemented

For questions or issues, see the main SDK documentation or open an issue on GitHub.
