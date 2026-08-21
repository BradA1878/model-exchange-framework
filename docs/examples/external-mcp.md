# External MCP Server Registration Example

This example shows how an administrator can register a child-process MCP server and
make its tools available to authorized agents.

## Security requirements

Runtime registration requires an administrator-authenticated `MxfSDK` connection
and `MXF_UNSAFE_STDIO_MCP_ENABLED=true` on the MXF server. The flag is disabled by
default because the supplied command runs on the MXF host. Agent keys cannot start
or stop MCP processes.

MXF currently implements runtime MCP registration over child-process `stdio` only.
HTTP MCP endpoints and URL-based registration are not supported.

## Overview

External MCP server registration allows you to:

- Add custom tools at runtime without server restart
- Integrate third-party MCP packages
- Create domain-specific tooling for your agents
- Manage server lifecycle programmatically

## Key Concepts

### Global vs Channel-Scoped

| Scope | Method | Availability |
|-------|--------|--------------|
| Global | `sdk.registerExternalMcpServer()` | All agents, all channels |
| Channel | `sdk.registerChannelMcpServer(channelId, config)` | Authorized agents in one channel |

This example focuses on **global registration**. See [Channel MCP Registration](channel-mcp.md) for channel-scoped servers.

## Implementation

### 1. Create a Custom MCP Server

```typescript
// simple-custom-mcp-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({
    name: 'simple-custom-server',
    version: '1.0.0'
}, {
    capabilities: { tools: {} }
});

// Define tools
server.setRequestHandler('tools/list', async () => ({
    tools: [
        {
            name: 'reverse_string',
            description: 'Reverses a string',
            inputSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'Text to reverse' }
                },
                required: ['text']
            }
        },
        {
            name: 'uppercase',
            description: 'Converts text to uppercase',
            inputSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'Text to uppercase' }
                },
                required: ['text']
            }
        }
    ]
}));

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
        case 'reverse_string':
            return { content: [{ type: 'text', text: args.text.split('').reverse().join('') }] };
        case 'uppercase':
            return { content: [{ type: 'text', text: args.text.toUpperCase() }] };
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 2. Register via SDK

```typescript
import { LlmProviderType, MxfSDK } from '@mxf-dev/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_ADMIN_ACCESS_TOKEN!
});

await sdk.connect();

// Register the external MCP server
const result = await sdk.registerExternalMcpServer({
    id: 'simple-custom-server',
    name: 'Simple Custom Server',
    transport: 'stdio',
    command: 'bun',
    args: ['run', './simple-custom-mcp-server.ts'],
    autoStart: true,
    restartOnCrash: true,
    maxRestartAttempts: 3
});

console.log('Registration result:', result);
// { toolsDiscovered: ['reverse_string', 'uppercase'] }
```

### 3. Use the Tools

```typescript
// Create an agent
const agent = await sdk.createAgent({
    agentId: 'tool-user',
    name: 'Tool User Agent',
    channelId: 'tool-testing',
    keyId: process.env.TOOL_USER_KEY_ID!,
    secretKey: process.env.TOOL_USER_SECRET_KEY!,
    llmProvider: LlmProviderType.OPENROUTER,
    defaultModel: '~anthropic/claude-haiku-latest'
});

await agent.connect();

// Tools are automatically available
const tools = await agent.listTools();
console.log('Available tools:', tools.map(t => t.name));
// Includes 'reverse_string', 'uppercase', plus all built-in tools

// Execute a tool
const result = await agent.executeTool('reverse_string', { text: 'Hello MXF!' });
console.log('Result:', result); // '!FXM olleH'
```

Agents see and call external tools by the raw name the server reports — the names returned in `toolsDiscovered`. Use those names in `allowedTools` too. The registry additionally keeps a canonical namespaced name, `<serverId>__<toolName>` (`simple-custom-server__reverse_string` here), which allowlists accept as an alternative. A raw name that collides with an internal MXF tool is not exposed to agents: the internal tool wins and the registry logs an error.

### 4. Cleanup

```typescript
// Unregister when done
await sdk.unregisterExternalMcpServer('simple-custom-server');

// Disconnect
await sdk.disconnect();
```

## Configuration Options

```typescript
interface ExternalServerConfig {
    // Required
    id: string;           // Unique identifier
    name: string;         // Display name

    // Transport: stdio (default)
    command?: string;     // Executable (for example, 'bun' or 'bunx')
    args?: string[];      // Command arguments

    transport?: 'stdio'; // The only supported runtime transport

    // Lifecycle
    autoStart?: boolean;          // Start immediately (default: true)
    restartOnCrash?: boolean;     // Restart after an unexpected exit (default: true)
    maxRestartAttempts?: number;  // Restart budget (default: 3)

    // Environment
    environmentVariables?: Record<string, string>;
}
```

Registration resolves after the MCP handshake and tool discovery, so a resolved call means the discovered tools are in the registry. An unexpected exit — including a clean `exit 0` — is logged at error level and removes the server's tools from the registry; with `restartOnCrash` the server restarts and re-discovers its tools, and a completed startup resets the restart count. Exhausting `maxRestartAttempts` unregisters the server, so re-register it to get its tools back. See [External MCP Server Registration](../sdk/external-mcp-servers.md#lifecycle-behavior) for the full lifecycle rules.

## Using registry packages

You can register an MCP package through `bunx`:

```typescript
// Example: Register the official filesystem MCP server
await sdk.registerExternalMcpServer({
    id: 'filesystem',
    name: 'Filesystem Server',
    command: 'bunx',
    args: ['@modelcontextprotocol/server-filesystem', '/allowed/path'],
    autoStart: true
});
```

## Error Handling

```typescript
try {
    const result = await sdk.registerExternalMcpServer(config);
    console.log('Registered tools:', result.toolsDiscovered);
} catch (error) {
    console.error('Registration failed:', error);
}
```

There is no `success` property. Failure rejects the promise; do not continue as if
the tools exist after a rejection.

## Best Practices

1. **Use unique IDs** - Server IDs must be unique across the system
2. **Handle cleanup** - Always unregister servers when shutting down
3. **Set resource limits** - Use `maxRestartAttempts` to prevent infinite restart loops
4. **Enable registration deliberately** - Keep the server-side opt-in disabled on hosts that do not need it
5. **Use environment variables** - Pass secrets via `environmentVariables`, not args

## Source Code

See the full implementation in `examples/external-mcp-registration/`
