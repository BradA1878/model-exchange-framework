# Channel-Scoped MCP Registration Demo

This demo registers a child-process MCP server for one channel, connects two agents,
and has both agents call tools from the shared process.

## Security requirements

Runtime process management is disabled by default. Before starting MXF, set:

```bash
MXF_UNSAFE_STDIO_MCP_ENABLED=true
```

The access token used by the demo must belong to an `administrator`. Registration is
performed by the user-authenticated `MxfSDK`; agent credentials cannot start or stop
host processes.

MXF supports runtime MCP registration over child-process `stdio` only. The demo does
not register an HTTP MCP endpoint.

## Files

- `channel-mcp-demo.ts` creates a channel, connects two agents, registers and
  unregisters the channel process, and executes its tools.
- `simple-custom-mcp-server.ts` implements line-delimited MCP over stdin/stdout and
  exposes `reverse_string`, `uppercase`, and `word_count`.

## Run

Start the MXF server manually, then run the demo from another terminal:

```bash
bun run demo:channel-mcp
```

Configure the administrator credentials and provider key in `.env`:

```dotenv
MXF_DOMAIN_KEY=your-domain-key
MXF_DEMO_USERNAME=admin-user
MXF_DEMO_PASSWORD=admin-password
OPENROUTER_API_KEY=your-api-key
```

## Registration flow

The demo uses the administrator SDK directly:

```typescript
import { MxfSDK } from '@mxf-dev/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_ADMIN_ACCESS_TOKEN!
});

await sdk.connect();

const registration = await sdk.registerChannelMcpServer('game-room', {
    id: 'game-tools',
    name: 'Game Tools MCP Server',
    transport: 'stdio',
    command: 'bun',
    args: ['run', './examples/channel-mcp-registration/simple-custom-mcp-server.ts'],
    autoStart: true,
    restartOnCrash: false,
    keepAliveMinutes: 5
});

console.log(registration.toolsDiscovered);
// ['reverse_string', 'uppercase', 'word_count']
```

Registration rejects on failure. Its result has `toolsDiscovered`; it does not have a
`success` property.

The process is shared by authorized agents in `game-room`. Agents use the raw names
returned in `toolsDiscovered`:

```typescript
await agent1.executeTool('reverse_string', { text: 'Hello MXF!' });
await agent2.executeTool('uppercase', { text: 'hello world' });
```

Cleanup also uses the administrator SDK:

```typescript
await sdk.unregisterChannelMcpServer('game-room', 'game-tools');
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

Registration resolves only after the process starts, completes the MCP initialize
handshake, and reports its tools. Unexpected exits remove those tools before any
configured restart. Exhausting the restart budget unregisters the process.

See `docs/sdk/external-mcp-servers.md` for the complete process-management contract.
