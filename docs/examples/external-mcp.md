# External MCP Server Registration Example

This example demonstrates how to dynamically register external MCP servers via the SDK, making custom tools available to all agents in your MXF deployment.

## Overview

External MCP server registration allows you to:

- Add custom tools at runtime without server restart
- Integrate third-party MCP servers (npm packages)
- Create domain-specific tooling for your agents
- Manage server lifecycle programmatically

## Key Concepts

### Global vs Channel-Scoped

| Scope | Method | Availability |
|-------|--------|--------------|
| Global | `sdk.registerExternalMcpServer()` | All agents, all channels |
| Channel | `agent.registerChannelMcpServer()` | Agents in specific channel only |

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
import { MxfSDK } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: 'admin',
    password: 'admin-password'
});

await sdk.connect();

// Register the external MCP server
const result = await sdk.registerExternalMcpServer({
    id: 'simple-custom-server',
    name: 'Simple Custom Server',
    command: 'npx',
    args: ['tsx', './simple-custom-mcp-server.ts'],
    autoStart: true,
    restartOnCrash: true,
    maxRestartAttempts: 3
});

console.log('Registration result:', result);
// { success: true, toolsDiscovered: ['reverse_string', 'uppercase'] }
```

### 3. Use the Tools

```typescript
// Create an agent
const agent = await sdk.createAgent({
    agentId: 'tool-user',
    name: 'Tool User Agent',
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet'
});

// Tools are automatically available
const tools = await agent.getAvailableTools();
console.log('Available tools:', tools.map(t => t.name));
// Includes 'reverse_string', 'uppercase', plus all built-in tools

// Execute a tool
const result = await agent.executeTool('reverse_string', { text: 'Hello MXF!' });
console.log('Result:', result); // '!FXM olleH'
```

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
    command?: string;     // Executable (e.g., 'npx', 'node')
    args?: string[];      // Command arguments

    // Transport: http
    transport?: 'stdio' | 'http';
    url?: string;         // HTTP endpoint for http transport

    // Lifecycle
    autoStart?: boolean;          // Start immediately (default: true)
    restartOnCrash?: boolean;     // Auto-restart on failure (default: true)
    maxRestartAttempts?: number;  // Max restart attempts (default: 3)

    // Environment
    environmentVariables?: Record<string, string>;
}
```

## Using npm Packages

You can register any npm MCP package:

```typescript
// Example: Register the official filesystem MCP server
await sdk.registerExternalMcpServer({
    id: 'filesystem',
    name: 'Filesystem Server',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/allowed/path'],
    autoStart: true
});
```

## Error Handling

```typescript
try {
    const result = await sdk.registerExternalMcpServer(config);

    if (!result.success) {
        console.error('Registration failed');
    }
} catch (error) {
    if (error.message.includes('timeout')) {
        console.error('Server did not start within 30 seconds');
    } else {
        console.error('Registration error:', error.message);
    }
}
```

## Best Practices

1. **Use unique IDs** - Server IDs must be unique across the system
2. **Handle cleanup** - Always unregister servers when shutting down
3. **Set resource limits** - Use `maxRestartAttempts` to prevent infinite restart loops
4. **Test locally first** - Verify your MCP server works before registering
5. **Use environment variables** - Pass secrets via `environmentVariables`, not args

## Source Code

See the full implementation in `examples/external-mcp-registration/`
