# Channel-Scoped MCP Server Registration

Channel-scoped registration starts an MCP child process on the MXF host and exposes
its tools only to agents in one channel.

## Security boundary

Process registration is an administrative operation. It requires both:

1. A user-authenticated `MxfSDK` connection whose server-side role is
   `administrator`.
2. `MXF_UNSAFE_STDIO_MCP_ENABLED=true` in the MXF server environment.

The opt-in is disabled by default because the registered command executes on the MXF
host. Agent keys can discover and execute granted tools, but cannot start or stop MCP
processes. The deprecated process-management methods on `MxfAgent` and `MxfClient`
throw `AgentMcpProcessManagementError`.

Runtime registration supports MCP over child-process `stdio` only. HTTP MCP
registration and URL-based server configuration are not implemented.

## Connect an administrator SDK

```typescript
import { MxfSDK } from '@mxf-dev/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_ADMIN_ACCESS_TOKEN!
});

await sdk.connect();
```

The server checks the authenticated user's role for each process-management request.

## Create the channel

`createChannel` takes the channel ID as its first argument:

```typescript
const channelMonitor = await sdk.createChannel('game-room-42', {
    name: 'Game Room 42',
    description: 'Private game room with custom tools',
    allowedTools: ['game_move', 'game_attack', 'game_status']
});
```

The returned `MxfChannelMonitor` observes public events for the new channel. The
channel ID remains `game-room-42`; it is not read from the monitor.

## Register a stdio MCP process

```typescript
const registration = await sdk.registerChannelMcpServer('game-room-42', {
    id: 'game-tools',
    name: 'Game Tools Server',
    transport: 'stdio',
    command: 'bun',
    args: ['run', './mcp/game-tools.ts'],
    autoStart: true,
    restartOnCrash: true,
    keepAliveMinutes: 10,
    environmentVariables: {
        GAME_DATA_PATH: '/srv/mxf/game-data'
    }
});

console.log(registration.toolsDiscovered);
// ['game_move', 'game_attack', 'game_status']
```

Registration rejects on authorization, configuration, process startup, MCP
handshake, or tool-discovery failure. There is no `success` flag: a resolved result
means every name in `toolsDiscovered` is registered.

The command runs on the MXF server host, not on the machine running this SDK code.
Only pass environment variables the child needs. MXF rejects protected runtime
variable overrides.

## Grant and use the tools

The administrator grants the raw discovered names when generating an agent key:

```typescript
const key = await sdk.generateKey(
    'game-room-42',
    'game-player',
    'Game Player',
    undefined,
    registration.toolsDiscovered
);

const player = await sdk.createAgent({
    agentId: 'game-player',
    name: 'Game Player',
    channelId: 'game-room-42',
    keyId: key.keyId,
    secretKey: key.secretKey,
    llmProvider: 'openrouter',
    defaultModel: '~anthropic/claude-sonnet-latest',
    allowedTools: registration.toolsDiscovered
});

await player.connect();
await player.executeTool('game_move', { x: 3, y: 4 });
```

An agent configuration can request an equal or narrower tool set than its key. It
cannot add authority that the administrator did not grant.

Other authorized agents in `game-room-42` share the channel process. Agents in a
different channel do not discover its tools.

## Tool names

Use the raw names returned in `toolsDiscovered` for keys, agent `allowedTools`, and
`executeTool()`. The registry also stores a canonical
`<serverId>__<toolName>` identifier. If a raw external name collides with an internal
MXF tool, the internal tool wins. Give tools distinct raw names rather than depending
on registry ordering.

## Read and cleanup operations

An agent may list the channel servers it can see:

```typescript
const servers = await player.listChannelMcpServers();
```

Only the administrator SDK can stop the process:

```typescript
await sdk.unregisterChannelMcpServer('game-room-42', 'game-tools');
await player.disconnect();
channelMonitor.destroy();
await sdk.disconnect();
```

## Configuration

```typescript
interface ChannelMcpServerConfig {
    id: string;
    name: string;
    command?: string;
    args?: string[];
    transport?: 'stdio';
    autoStart?: boolean;
    environmentVariables?: Record<string, string>;
    restartOnCrash?: boolean;
    keepAliveMinutes?: number;
}
```

## Lifecycle behavior

- Registration resolves after process startup, the MCP initialize handshake, and
  tool discovery.
- An unexpected exit removes the process's tools before restart is attempted.
- `restartOnCrash` uses the server's restart budget. Exhausting that budget
  unregisters the process and its channel scope.
- A channel join verifies that its scoped processes are running and answer an MCP
  tool probe.
- Unregistration removes the process, registry entries, channel scope, and owned
  lifecycle work that still exist.

See the runnable implementation in `examples/channel-mcp-registration/` and the
[external MCP server reference](../sdk/external-mcp-servers.md).
