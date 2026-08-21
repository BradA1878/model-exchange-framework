# External MCP Server Registration Example

This directory contains a working example of registering a custom child-process MCP
server through an administrator-authenticated SDK.

Registration runs the supplied command on the MXF host. The server operator must set
`MXF_UNSAFE_STDIO_MCP_ENABLED=true`, and the demo user must have the
`administrator` role. Agent keys cannot manage MCP processes.

## Files

- **`simple-custom-mcp-server.ts`** - Minimal MCP server implementation
  - Implements MCP protocol via stdio (JSON-RPC over stdin/stdout)
  - Provides 3 simple tools: `reverse_string`, `uppercase`, `word_count`
  - Used for testing SDK external server registration

- **`sdk-external-mcp-server-registration.ts`** - Complete test/demo
  - Registers the custom MCP server via SDK
  - Creates an agent and verifies tools are available
  - Executes all 3 custom tools
  - Unregisters the server
  - Proves end-to-end functionality

## Running the Demo

### Prerequisites

1. MXF server running:
   ```bash
   bun run dev
   ```

2. Environment variables set in `.env`:
   ```
   MXF_DOMAIN_KEY=your-domain-key
   MXF_USERNAME=admin-user
   MXF_PASSWORD=admin-password
   OPENROUTER_API_KEY=your-api-key
   ```

### Run

```bash
bun run demo:external-mcp
```

### Expected Output

```
🧪 SDK External MCP Server Registration Test
✅ Connected to MXF server
✅ Custom MCP server registered successfully!
✅ Custom tools discovered:
   - reverse_string
   - uppercase
   - word_count
✅ All custom tool executions successful!
✅ Server unregistered successfully!
🎉 All tests passed!
```

## What This Proves

✅ Developers can create custom MCP servers
✅ Servers can be registered via SDK (no server code changes)
✅ Custom tools become available immediately
✅ Tools execute correctly
✅ Server lifecycle can be managed dynamically

## Use Cases

This pattern enables:
- Domain-specific tool packages for your application
- Integration with third-party MCP servers
- Per-project tool customization
- Rapid prototyping without server modifications

## Architecture

**EventBus-Based Communication**:
```
SDK                          Server
 │                            │
 ├─ registerExternalMcpServer()
 ├─ EXTERNAL_SERVER_REGISTER→│
 │                            ├─ Start server process
 │                            ├─ Discover tools
 │←─ EXTERNAL_SERVER_REGISTERED
 │                            │
 ├─ executeTool('reverse_string', ...)
 │                            ├─ Route to custom server
 │←─ Tool result             │
```

The registration request uses EventBus, and MXF communicates with the child process
through MCP over `stdio`. Runtime HTTP MCP registration is not implemented.

## Next Steps

To create your own MCP server:

1. Implement MCP protocol (see `simple-custom-mcp-server.ts` as template)
2. Define your custom tools in `tools/list` response
3. Implement tool execution in `tools/call` handler
4. Register via SDK: `await sdk.registerExternalMcpServer({ ... })`

See `docs/sdk/external-mcp-servers.md` for complete API reference.
