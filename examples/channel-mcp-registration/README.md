# Channel-Scoped MCP Server Registration Example

This directory contains a complete working example of registering **channel-scoped** MCP servers via the SDK.

## Key Difference: Channel vs Global MCP Servers

| Feature | Global MCP Server | Channel MCP Server |
|---------|------------------|-------------------|
| **Scope** | Available to all agents | Only agents in the channel |
| **Lifecycle** | Manual start/stop | Auto-start when first agent joins |
| **Cleanup** | Manual unregister | Auto-stop with keepAlive after last agent leaves |
| **Use Case** | System-wide tools | Channel-specific collaboration tools |
| **Server ID** | Simple: `my-server` | Namespaced: `channelId:my-server` |

## Files

- **`channel-mcp-demo.ts`** - Complete demo showing:
  - Creating a channel
  - Registering a channel-scoped MCP server
  - Multiple agents joining and using the same server instance
  - Automatic server lifecycle management
  - Reference counting and keepAlive cleanup

- **`simple-custom-mcp-server.ts`** - Minimal MCP server (reused from external-mcp-registration)
  - Provides 3 simple tools: `reverse_string`, `uppercase`, `word_count`
  - Used for testing channel-scoped registration

## Running the Demo

### Prerequisites

1. MXF server running:
   ```bash
   bun run dev
   ```

2. Environment variables set in `.env`:
   ```
   MXF_DOMAIN_KEY=your-domain-key
   MXF_DEMO_USERNAME=demo-user
   MXF_DEMO_PASSWORD=demo-password-1234
   OPENROUTER_API_KEY=your-api-key
   ```

### Run

```bash
bun run demo:channel-mcp
```

### Expected Output

```
🧪 Channel-Scoped MCP Server Registration Demo
═══════════════════════════════════════════════

📡 Step 1: Creating channel and agents...
✅ Channel 'game-room' created
✅ Agent 1 connected to channel
✅ Agent 2 connected to channel

📦 Step 2: Agent 1 registers channel MCP server...
✅ Channel MCP server registered successfully!
   Tools discovered: reverse_string, uppercase, word_count

🔧 Step 3: Both agents can use the same MCP server...
   Agent 1 executing: reverse_string
   Result: !FXM olleH

   Agent 2 executing: uppercase
   Result: HELLO WORLD

📊 Step 4: Server lifecycle demonstration...
✅ Agent 1 leaves channel (1 agent remaining)
   Server still running (reference count: 1)

✅ Agent 2 leaves channel (0 agents remaining)
   KeepAlive timer started (5 minutes)
   Server will auto-stop after keepAlive expires

🎉 Demo complete!
```

## What This Demonstrates

✅ **Channel-Scoped Servers** - MCP server only available to agents in the channel
✅ **Shared Instance** - Multiple agents share the same server process
✅ **Auto-Start** - Server starts when first agent joins channel
✅ **Reference Counting** - Tracks how many agents are using the server
✅ **KeepAlive Cleanup** - Graceful shutdown after last agent leaves
✅ **Tool Isolation** - Tools only visible to channel members

## Use Cases

This pattern enables:

### 1. **Game Servers**
```typescript
// Chess channel
await agent.registerChannelMcpServer({
  id: 'chess-game',
  name: 'Chess Server',
  command: 'npx',
  args: ['-y', '@mcp/chess'],
  keepAliveMinutes: 30  // Keep game state for 30min
});
```

### 2. **Collaborative Tools**
```typescript
// Design review channel
await agent.registerChannelMcpServer({
  id: 'figma-integration',
  name: 'Figma Collaboration',
  command: 'npx',
  args: ['-y', '@mcp/figma'],
  keepAliveMinutes: 15
});
```

### 3. **Project-Specific Integrations**
```typescript
// Project XYZ channel
await agent.registerChannelMcpServer({
  id: 'project-database',
  name: 'Project XYZ Database',
  command: 'npx',
  args: ['-y', '@mcp/postgresql'],
  environmentVariables: {
    DB_NAME: 'project_xyz'
  },
  keepAliveMinutes: 10
});
```

## Architecture

**Hybrid Communication** (EventBus for writes, REST API for reads):
```
SDK (Agent 1)                    Server                    MCP Server Process
    │                               │                              │
    ├─ registerChannelMcpServer()   │                              │
    ├─ CHANNEL_SERVER_REGISTER ────>│                              │
    │                               ├─ Spawn process ─────────────>│
    │                               ├─ Initialize MCP               │
    │                               ├─ Discover tools               │
    │<─ CHANNEL_SERVER_REGISTERED ──│                              │
    │                               │                              │
SDK (Agent 2) joins channel         │                              │
    │                               │                              │
    ├─ joinChannel() ──────────────>│                              │
    │                               ├─ onAgentJoinChannel()        │
    │                               ├─ Reference count: 2           │
    │                               ├─ Server already running ✓     │
    │<─ Tools available ────────────│                              │
    │                               │                              │
    ├─ executeTool('uppercase')────>│──────────────────────────────>│
    │<─ Result ──────────────────────│<──────────────────────────────│
```

## Configuration Options

```typescript
interface ChannelMcpServerConfig {
  id: string;                       // Unique server ID within channel
  name: string;                     // Display name
  command?: string;                 // Command to execute (e.g., 'npx', 'node')
  args?: string[];                  // Command arguments
  transport?: 'stdio' | 'http';     // Communication protocol (default: stdio)
  url?: string;                     // HTTP URL if transport is 'http'
  autoStart?: boolean;              // Auto-start on registration (default: true)
  environmentVariables?: Record<string, string>;  // Environment variables
  restartOnCrash?: boolean;         // Restart after an unexpected exit (default: true)
  maxRestartAttempts?: number;      // Restart budget (default: 3)
  keepAliveMinutes?: number;        // Minutes to keep alive after last agent leaves (default: 5)
}
```

## Tool Names

Agents call channel server tools by the raw name the server reports — the names that come back in `toolsDiscovered` (`reverse_string`, `uppercase`, `word_count` in this demo). Use those names in `allowedTools` and in `executeTool()`.

The registry stores each external tool under a canonical namespaced name, `<serverId>__<toolName>`, where a channel server's registry id is `<channelId>:<serverId>` — `game-room:channel-mcp-demo__uppercase`, for example. Allowlists accept either form, but prefer the raw name: LLM providers reject `:` in function names.

## Lifecycle Notes

- Registration resolves after the MCP handshake and tool discovery, so a resolved call means the discovered tools are in the registry.
- An unexpected exit is logged at error level and the server's tools are removed from the registry; with `restartOnCrash` the server restarts and re-discovers its tools, up to `maxRestartAttempts`. A completed startup resets the restart count.
- Exhausting the restart budget unregisters the server (record and channel scope removed) — re-register it to get the tools back.
- Agent join verifies the server is alive (probe with `tools/list`) and starts or restarts it as needed before counting the agent as connected.
- Unregistration is idempotent and clears the record, the scope entry, and any keepAlive timer.

## API Reference

### SDK Methods

```typescript
// Register channel-scoped MCP server
await agent.registerChannelMcpServer(config);

// List channel MCP servers
const servers = await agent.listChannelMcpServers(channelId?);

// Unregister channel MCP server
await agent.unregisterChannelMcpServer(serverId, channelId?);

// List tools (includes channel-scoped tools)
const tools = await agent.listTools();

// Execute channel tool (same as any other tool)
const result = await agent.executeTool('tool_name', { ...params });
```

### REST API Endpoints

```http
# Register channel MCP server
POST /api/channels/:channelId/mcp-servers
Content-Type: application/json
{ "id": "server-id", "name": "Server Name", ... }

# List channel MCP servers
GET /api/channels/:channelId/mcp-servers

# Unregister channel MCP server
DELETE /api/channels/:channelId/mcp-servers/:serverId
```

## Next Steps

To create your own channel-scoped MCP server:

1. **Create your MCP server** (see `simple-custom-mcp-server.ts` as template)
2. **Define your tools** in the `tools/list` response
3. **Implement tool execution** in the `tools/call` handler
4. **Register via SDK**: `await agent.registerChannelMcpServer({ ... })`
5. **Tools automatically available** to all channel members

See `docs/sdk/external-mcp-servers.md` for the complete API reference, including the tool naming contract and server lifecycle rules.
