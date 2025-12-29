# Channel-Scoped MCP Server Registration Example

This example demonstrates how to register MCP servers that are scoped to a specific channel, making tools available only to agents within that channel.

## Overview

Channel-scoped MCP registration is ideal for:

- **Game servers** where tools should only be available during gameplay
- **Project-specific tools** that shouldn't pollute the global tool registry
- **Multi-tenant deployments** where different channels need different tools
- **Temporary tooling** that should be automatically cleaned up

## Key Difference from Global Registration

| Feature | Global MCP Server | Channel MCP Server |
|---------|------------------|-------------------|
| **Scope** | Available to all agents | Only agents in the channel |
| **Lifecycle** | Manual start/stop | Auto-start when first agent joins |
| **Cleanup** | Manual unregister | Auto-stop with keepAlive after last agent leaves |
| **Use Case** | System-wide tools | Channel-specific collaboration tools |
| **Server ID** | Simple: `my-server` | Namespaced: `channelId:my-server` |

## Implementation

### 1. Create the Channel

```typescript
import { MxfSDK } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: 'admin',
    password: 'admin-password'
});

await sdk.connect();

// Create a channel for the collaboration
const channel = await sdk.createChannel({
    name: 'game-room-42',
    description: 'Private game room with custom tools'
});
```

### 2. Create an Agent and Join Channel

```typescript
// Create an agent that will use the channel tools
const agent = await sdk.createAgent({
    agentId: 'game-player',
    name: 'Game Player',
    channelId: channel.id,
    provider: 'openrouter',
    model: 'anthropic/claude-haiku-4.5'
});
```

### 3. Register Channel-Scoped MCP Server

```typescript
// Register MCP server scoped to this channel
const result = await agent.registerChannelMcpServer({
    id: 'game-tools',
    name: 'Game Tools Server',
    transport: 'http',
    url: 'http://localhost:3002/mcp',
    autoStart: true,
    keepAliveMinutes: 10  // Auto-cleanup 10 min after last agent leaves
});

console.log('Registration result:', result);
// { success: true, toolsDiscovered: ['game_move', 'game_attack', 'game_status'] }
```

### 4. Tools Are Available to Channel Agents

```typescript
// Get available tools - includes channel-scoped tools
const tools = await agent.getAvailableTools();

// Channel tools have metadata indicating their scope
const gameTools = tools.filter(t => t.name.startsWith('game_'));
console.log('Game tools available:', gameTools.map(t => t.name));
```

### 5. Other Agents in Same Channel Also See Tools

```typescript
// Create another agent in the same channel
const agent2 = await sdk.createAgent({
    agentId: 'game-player-2',
    name: 'Game Player 2',
    channelId: channel.id,
    provider: 'openrouter',
    model: 'openai/gpt-4'
});

// Agent2 automatically has access to channel tools
const tools2 = await agent2.getAvailableTools();
const gameTools2 = tools2.filter(t => t.name.startsWith('game_'));
console.log('Player 2 also sees:', gameTools2.map(t => t.name));
// Same tools as agent1!
```

### 6. Agents in Other Channels Don't See Tools

```typescript
// Create agent in a different channel
const otherAgent = await sdk.createAgent({
    agentId: 'other-agent',
    name: 'Other Agent',
    channelId: 'different-channel',
    provider: 'openrouter',
    model: 'anthropic/claude-haiku-4.5'
});

// This agent does NOT see the game tools
const otherTools = await otherAgent.getAvailableTools();
const otherGameTools = otherTools.filter(t => t.name.startsWith('game_'));
console.log('Other agent sees game tools:', otherGameTools.length);
// 0 - channel-scoped tools are isolated
```

### 7. List Channel Servers

```typescript
// List all MCP servers registered to the channel
const servers = await agent.listChannelMcpServers();
console.log('Channel servers:', servers);
// [{ id: 'game-tools', name: 'Game Tools Server', status: 'running' }]
```

### 8. Cleanup

```typescript
// Explicitly unregister (optional - happens automatically with keepAlive)
await agent.unregisterChannelMcpServer('game-tools');

// Disconnect agents
await agent.disconnect();
await agent2.disconnect();
await sdk.disconnect();
```

## Configuration Options

```typescript
interface ChannelServerConfig {
    // Required
    id: string;           // Unique within channel
    name: string;         // Display name

    // Transport (same as global)
    command?: string;
    args?: string[];
    transport?: 'stdio' | 'http';
    url?: string;

    // Lifecycle
    autoStart?: boolean;
    restartOnCrash?: boolean;
    maxRestartAttempts?: number;

    // Channel-specific
    keepAliveMinutes?: number;  // How long to keep server alive after last agent leaves

    // Environment
    environmentVariables?: Record<string, string>;
}
```

## Use Cases

### Game Servers

```typescript
// Each game room gets its own MCP server instance
await agent.registerChannelMcpServer({
    id: 'chess-game',
    name: 'Chess Game Server',
    transport: 'http',
    url: `http://localhost:${gamePort}/mcp`,
    keepAliveMinutes: 30
});
```

### Project Collaboration

```typescript
// Project-specific tools for a development team
await agent.registerChannelMcpServer({
    id: 'project-tools',
    name: 'Project X Tools',
    command: 'npx',
    args: ['-y', '@company/project-x-mcp'],
    environmentVariables: {
        PROJECT_API_KEY: process.env.PROJECT_X_KEY
    }
});
```

### Testing Environments

```typescript
// Isolated test tools per test channel
await testAgent.registerChannelMcpServer({
    id: 'test-fixtures',
    name: 'Test Fixtures Server',
    command: 'node',
    args: ['./test-fixtures-mcp.js'],
    keepAliveMinutes: 5  // Short keepAlive for tests
});
```

## Best Practices

1. **Use meaningful IDs** - IDs are scoped to channel, but use descriptive names
2. **Set appropriate keepAlive** - Balance between cleanup and restart overhead
3. **Handle reconnection** - Tools refresh automatically when agents rejoin
4. **Consider lifecycle** - Channel servers start/stop with agent presence
5. **Test isolation** - Verify tools don't leak to other channels

## Source Code

See the full implementation in `examples/channel-mcp-registration/`
