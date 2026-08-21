# External MCP Server Registration

MXF can start caller-supplied MCP servers and expose their discovered tools globally
or to one channel. This is host process management, so it is intentionally separate
from agent tool credentials.

## Security boundary

All runtime registration and unregistration methods require:

1. A user-authenticated `MxfSDK` connection whose server-side role is
   `administrator`.
2. Explicit server-operator opt-in with
   `MXF_UNSAFE_STDIO_MCP_ENABLED=true`.

The feature is disabled by default because a `stdio` registration executes a command
on the MXF host. A channel key authorizes an agent to discover and execute granted
tools; it does not authorize that agent to create or kill host processes.

The deprecated `MxfAgent` / `MxfClient` registration methods throw
`AgentMcpProcessManagementError` immediately. They do not emit an event and do not
wait for a timeout.

MXF's external manager currently implements line-delimited MCP over child-process
`stdio` only. HTTP transport registration is not implemented and is rejected.
Commands run with the MXF server process working directory. The public registration
API does not expose a `workingDirectory` override, so relative script arguments must
be relative to the MXF root (or be replaced with an absolute path).

## Administrator connection

```typescript
import { MxfSDK } from '@mxf-dev/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_ADMIN_ACCESS_TOKEN!
});

await sdk.connect();
```

`sdk.connect()` resolving proves the user session authenticated; it does not by
itself claim an administrator role. The server enforces the role on every MCP process
request and rejects a non-administrator.

## Register a global server

```typescript
const { toolsDiscovered } = await sdk.registerExternalMcpServer({
    id: 'company-tools',
    name: 'Company Tools',
    transport: 'stdio',
    command: 'bun',
    args: ['run', './mcp/company-tools.ts'],
    autoStart: true,
    restartOnCrash: true,
    maxRestartAttempts: 3,
    environmentVariables: {
        COMPANY_API_KEY: process.env.COMPANY_API_KEY!
    }
});

console.log('Usable tools:', toolsDiscovered);
```

The promise resolves only after process startup, the MCP initialize handshake, and
tool discovery complete. Its resolved type is:

```typescript
interface McpServerRegistrationResult {
    toolsDiscovered: string[];
}
```

There is no `success` flag. Failure rejects; a resolved value means every reported
tool is already in the registry.

Global tools can be discovered by agents in any channel, subject to the channel key,
agent, and channel allowlists.

## Register a channel server

```typescript
const { toolsDiscovered } = await sdk.registerChannelMcpServer(
    'chess-room',
    {
        id: 'chess-game',
        name: 'Chess Game',
        transport: 'stdio',
        command: 'bun',
        args: ['run', './mcp/chess-server.ts'],
        autoStart: true,
        restartOnCrash: true,
        keepAliveMinutes: 30
    }
);
```

The channel ID is an explicit first argument on the administrator SDK. Tools from
that process are visible only to authorized agents in the named channel. Agents in
the channel share one server instance.

Channel registration does not require creating an agent first. If a channel is being
created at the same time, it may include the same configuration:

```typescript
await sdk.createChannel('chess-room', {
    name: 'Chess Room',
    mcpServers: [{
        id: 'chess-game',
        name: 'Chess Game',
        transport: 'stdio',
        command: 'bun',
        args: ['run', './mcp/chess-server.ts'],
        keepAliveMinutes: 30
    }]
});
```

Channel creation rejects if any requested MCP server fails to register; it does not
return a monitor for a partially configured channel while swallowing the failure.

## Tool names and allowlists

Use the raw names returned in `toolsDiscovered` in the channel key grant, the agent's
`allowedTools`, and `executeTool()`:

```typescript
const registration = await sdk.registerChannelMcpServer('chess-room', {
    id: 'chess-game',
    name: 'Chess Game',
    command: 'bun',
    args: ['run', './mcp/chess-server.ts']
});

const key = await sdk.generateKey(
    'chess-room',
    'player-1',
    'Player 1',
    undefined,
    registration.toolsDiscovered
);

const player = await sdk.createAgent({
    agentId: 'player-1',
    name: 'Player 1',
    channelId: 'chess-room',
    keyId: key.keyId,
    secretKey: key.secretKey,
    llmProvider: 'openrouter',
    defaultModel: '~anthropic/claude-sonnet-latest',
    allowedTools: registration.toolsDiscovered
});

await player.connect();
await player.executeTool('chess_move', { from: 'e2', to: 'e4' });
```

Internally the registry also maintains a canonical
`<serverId>__<toolName>` identifier. Prefer the raw name for models and application
code. If a raw external name collides with an internal tool, the internal tool wins.
If two reachable external servers expose the same raw name, give the tools distinct
names rather than depending on registry ordering.

An agent cannot add a newly discovered tool to its own authority. The administrator
must grant it on the channel key; the agent configuration can only request an equal
or narrower subset.

## Unregister

```typescript
await sdk.unregisterExternalMcpServer('company-tools');
await sdk.unregisterChannelMcpServer('chess-room', 'chess-game');
```

Both methods resolve to `void` after the correlated server acknowledgement. They
reject on authorization or lifecycle failure.

Unregistration is idempotent at the manager boundary: it removes the process, tool
registry entries, channel scope, and pending lifecycle work that still exist. This
makes cleanup safe after a partial failure without returning a fabricated boolean.

## Lifecycle behavior

- An unexpected process exit removes its tools before restart is attempted.
- `restartOnCrash` is bounded by the configured restart budget.
- Exhausting that budget unregisters the server and its channel scope.
- A channel join verifies that scoped servers are alive and complete a tool handshake
  before the agent is counted as connected.
- Disconnect and server shutdown clear owned processes, probes, restart work, and
  keep-alive work.
- Registration responses are correlated to the requesting administrator and server
  ID; concurrent registrations cannot complete one another.

## Environment variables

Only declare values the child process needs:

```typescript
await sdk.registerExternalMcpServer({
    id: 'weather',
    name: 'Weather',
    command: 'bun',
    args: ['run', './mcp/weather.ts'],
    environmentVariables: {
        WEATHER_API_KEY: process.env.WEATHER_API_KEY!
    }
});
```

MXF builds a least-privilege child environment and rejects protected runtime variable
overrides. Do not pass the MXF domain key, user token, agent keys, database URI, or
unrelated provider secrets to a child server.

## Failure handling

```typescript
try {
    await sdk.registerExternalMcpServer({
        id: 'analytics',
        name: 'Analytics',
        command: 'bun',
        args: ['run', './mcp/analytics.ts']
    });
} catch (error) {
    console.error('MCP server is not registered:', error);
}
```

Common causes are:

- the authenticated user is not an administrator;
- `MXF_UNSAFE_STDIO_MCP_ENABLED` is not exactly `true`;
- the command or arguments are invalid;
- the process exits before completing the MCP handshake;
- tool discovery fails or the server ID is already registered.

Do not continue as though the tools exist after rejection. Re-register only after
correcting the cause.

## Registering again after a server restart

A channel MCP server is a child process of the MXF server. When the server
restarts, those processes are gone, and the SDK's socket reconnects to a server
that has no record of them. `sdk.onReconnected()` fires after the socket manager
has re-established and re-authenticated the user connection on its own — it does
not fire for the authentication that settles `connect()` — so it is the place to
register the server again:

```typescript
const stopListening = sdk.onReconnected(({ userId, attempt }) => {
    console.log(`reconnected as ${userId} after ${attempt ?? '?'} attempt(s)`);
    toolServerRegistered = false; // re-register on the next cycle
});

// later
stopListening();
```

The same signal is available on the event bus as `Events.Sdk.RECONNECTED` for
code that already subscribes through `agent.on(...)`. It is delivered locally
and never sent to the server. Before 3.0 there was no public signal; reading the
SDK's private `socket` field was the only way to see a reconnect.

## API reference

```typescript
sdk.registerExternalMcpServer(config): Promise<McpServerRegistrationResult>
sdk.unregisterExternalMcpServer(serverId): Promise<void>

sdk.registerChannelMcpServer(channelId, config): Promise<McpServerRegistrationResult>
sdk.unregisterChannelMcpServer(channelId, serverId): Promise<void>

sdk.onReconnected(listener: (info: SdkReconnectedEventData) => void): () => void
```

See the runnable examples in `examples/external-mcp-registration/` and
`examples/channel-mcp-registration/`.
