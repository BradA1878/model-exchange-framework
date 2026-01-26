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
✅ **Channel-Scoped Servers**: Share MCP server instances per channel (NEW!)

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

## Server Scopes: Global vs Channel

MXF supports two scopes for external MCP servers:

### Global Scope (Default)

Servers registered with `registerExternalMcpServer()` are **globally available** to all agents:

```typescript
// Global server - available to ALL agents
await sdk.registerExternalMcpServer({
    id: 'global-calculator',
    name: 'Global Calculator',
    command: 'npx',
    args: ['-y', '@mcp/calculator']
});

// Any agent in any channel can use these tools
```

**Use Cases**:
- System-wide utilities (calculators, converters, etc.)
- Shared services (weather, time, etc.)
- Company-wide integrations (Slack, email, etc.)

### Channel Scope (NEW!)

Servers registered with `registerChannelMcpServer()` are **channel-specific**:

```typescript
// Channel server - only for agents in THIS channel
await agent.registerChannelMcpServer({
    id: 'chess-game',
    name: 'Chess Game Server',
    command: 'npx',
    args: ['-y', '@mcp/chess'],
    keepAliveMinutes: 10  // Keep alive 10min after last agent leaves
});

// Only agents in this channel can use chess tools
```

**Use Cases**:
- Game servers (chess, tic-tac-toe, etc.)
- Project-specific databases
- Collaborative design tools (Figma, Miro)
- Team-specific integrations

**Key Benefits**:
- **Shared Instance**: All channel agents use the same server process
- **Auto-Start**: Server starts when first agent joins channel
- **Auto-Stop**: Server stops after keepAlive when last agent leaves
- **Resource Efficient**: One server per channel (not per agent)
- **Tool Isolation**: Tools only visible to channel members

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

### Example 6: Channel-Scoped Game Server

```typescript
// Create a game channel
const channel = await sdk.createChannel('chess-room', {
    name: 'Chess Championship',
    description: 'Chess game with AI opponents'
});

// Create player agents
const player1 = await sdk.createAgent({
    agentId: 'player-1',
    channelId: 'chess-room',
    // ... config ...
});

await player1.connect();

// Register channel-scoped chess server
await player1.registerChannelMcpServer({
    id: 'chess-game',
    name: 'Chess Server',
    command: 'npx',
    args: ['-y', '@mcp/chess'],
    keepAliveMinutes: 30,  // Keep game state for 30 minutes
    environmentVariables: {
        GAME_MODE: 'tournament'
    }
});

// Player 2 joins and can use the same chess server
const player2 = await sdk.createAgent({
    agentId: 'player-2',
    channelId: 'chess-room',
    // ... config ...
});

await player2.connect();

// Both players use the same chess server instance
await player1.executeTool('chess_move', { from: 'e2', to: 'e4' });
await player2.executeTool('chess_move', { from: 'e7', to: 'e5' });

// List channel servers
const servers = await player1.listChannelMcpServers();
console.log(`Channel has ${servers.length} MCP server(s)`);

// When both players leave, server stops after 30 min keepAlive
```

### Example 7: Multi-Channel Isolation

```typescript
// Channel 1: Chess game
const chessAgent = await sdk.createAgent({
    agentId: 'chess-player',
    channelId: 'chess-room',
    // ... config ...
});

await chessAgent.connect();
await chessAgent.registerChannelMcpServer({
    id: 'chess-server',
    name: 'Chess',
    command: 'npx',
    args: ['-y', '@mcp/chess']
});

// Channel 2: Tic-tac-toe game
const tttAgent = await sdk.createAgent({
    agentId: 'ttt-player',
    channelId: 'tictactoe-room',
    // ... config ...
});

await tttAgent.connect();
await tttAgent.registerChannelMcpServer({
    id: 'tictactoe-server',
    name: 'Tic-Tac-Toe',
    command: 'npx',
    args: ['-y', '@mcp/tictactoe']
});

// chessAgent sees: chess_move, chess_board, etc.
// tttAgent sees: ttt_move, ttt_check_winner, etc.
// No overlap! Complete isolation.
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

## API Reference

### Global Server Methods

```typescript
// Register global MCP server (available to all agents)
await sdk.registerExternalMcpServer(config: ExternalServerConfig): Promise<{ success: boolean; toolsDiscovered?: string[] }>

// Unregister global MCP server
await sdk.unregisterExternalMcpServer(serverId: string): Promise<boolean>
```

### Channel Server Methods

```typescript
// Register channel-scoped MCP server (agent must be in a channel)
await agent.registerChannelMcpServer(config: ChannelServerConfig): Promise<{ success: boolean; toolsDiscovered?: string[] }>

// List channel MCP servers
await agent.listChannelMcpServers(channelId?: string): Promise<ChannelMcpServer[]>

// Unregister channel MCP server
await agent.unregisterChannelMcpServer(serverId: string, channelId?: string): Promise<boolean>
```

### Configuration Interfaces

```typescript
interface ExternalServerConfig {
    id: string;
    name: string;
    command?: string;
    args?: string[];
    transport?: 'stdio' | 'http';
    url?: string;
    autoStart?: boolean;
    environmentVariables?: Record<string, string>;
    restartOnCrash?: boolean;
    maxRestartAttempts?: number;
}

interface ChannelServerConfig extends ExternalServerConfig {
    keepAliveMinutes?: number;  // Keep server alive after last agent leaves (default: 5)
}
```

---

## Limitations & Future Enhancements

### Current Limitations

1. **No Agent-Private Servers**: Can't create servers exclusive to a single agent (use channel with one member as workaround)
2. **No Handler Upload**: Can't upload JavaScript handler code, must use external process
3. **No Cross-Channel Sharing**: Channel servers can't be shared across multiple channels (register separately if needed)

### Recently Added

✅ **Channel-Scoped Servers**: Share MCP server instances per channel (v1.1.0)
✅ **Reference Counting**: Automatic lifecycle based on connected agents
✅ **KeepAlive Cleanup**: Graceful shutdown with configurable delay

### Planned Enhancements

- Agent-private server registration (agent scope)
- Server health monitoring API
- Tool usage analytics per server
- Cross-channel server sharing (multi-channel scope)

---

## Troubleshooting

### Global Servers

#### Server Won't Start

```
Error: External server registration timeout after 30 seconds
```

**Solutions**:
- Check command/args are correct
- Verify package is installed (`npx -y package-name`)
- Check environment variables are set
- Review server logs in MXF output

#### Tools Not Appearing

```
Tools from my-server not showing up
```

**Solutions**:
- Wait for tool discovery (can take 2-5 seconds)
- Check server started successfully (check MXF logs)
- Verify server implements MCP protocol correctly
- List tools with `agent.listTools()` to debug

#### Registration Fails

```
Error: Server ID already registered
```

**Solutions**:
- Use unique server ID
- Unregister old server first: `await sdk.unregisterExternalMcpServer(id)`
- Check server isn't pre-configured in `ExternalServerConfigs.ts`

### Channel Servers

#### Agent Not in Channel

```
Error: Cannot register channel MCP server: agent not in a channel
```

**Solutions**:
- Ensure agent has joined a channel first
- Check `agent.channelId` is set
- Call `await agent.connect()` after creating agent with channelId

#### Tools Only Visible to Channel Members

```
Why can't agents in other channels see my tools?
```

**This is by design!** Channel-scoped servers are intentionally isolated:
- Tools only visible to agents in the same channel
- Use `registerExternalMcpServer()` for global tools
- Use separate channel servers for each channel

#### Server Not Auto-Starting

```
Channel server registered but not starting when agent joins
```

**Solutions**:
- Check `autoStart: true` in config (default)
- Verify agent successfully joined channel (listen for AGENT_JOINED event)
- Check server logs for startup errors
- Ensure command/args are valid

---

## Additional Resources

- [MCP Server Specification](https://spec.modelcontextprotocol.io/)
- [Building MCP Servers](https://modelcontextprotocol.io/docs/building)
- [MCP SDK Repository](https://github.com/modelcontextprotocol/typescript-sdk)
- [Example MCP Servers](https://github.com/modelcontextprotocol/servers)

### Working Examples

- **Global Servers**: `examples/external-mcp-registration/`
  - Run: `bun run demo:external-mcp`
  - Shows global server registration and tool usage

- **Channel Servers**: `examples/channel-mcp-registration/`
  - Run: `bun run demo:channel-mcp`
  - Shows channel-scoped servers, multi-agent sharing, lifecycle management

---

## Decision Matrix: When to Use Each Scope

| Scenario | Use Global Server | Use Channel Server |
|----------|------------------|-------------------|
| System utilities (calculator, time, etc.) | ✅ | ❌ |
| Company-wide integrations (Slack, email) | ✅ | ❌ |
| Game servers (chess, poker, etc.) | ❌ | ✅ |
| Project-specific databases | ❌ | ✅ |
| Collaborative tools (Figma, Miro) | ❌ | ✅ |
| Shared state across agents | ❌ | ✅ |
| One-off tool for single agent | ❌ | ✅ (or global) |

---

**Status**: ✅ **Feature Complete** - Global and channel-scoped MCP server registration fully implemented (v1.1.0)

For questions or issues, see the main SDK documentation or open an issue on GitHub.
