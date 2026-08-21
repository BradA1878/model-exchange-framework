# SDK Manager Architecture

`MxfAgent` composes focused managers for MCP client access, conversation memory,
prompt assembly, and task execution. They are implementation components, not
standalone package entry points. `@mxf-dev/sdk` intentionally does not export manager
constructors or manager subpaths.

Create an agent through `MxfSDK` so authentication, identity binding, event routing,
and lifecycle cleanup stay attached to the same connection:

```typescript
import { MxfSDK } from '@mxf-dev/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_ACCESS_TOKEN!
});

await sdk.connect();
const agent = await sdk.createAgent(agentConfig);
await agent.connect();
```

## Supported public operations

### Tools

```typescript
const available = await agent.listTools();
const result = await agent.executeTool('agent_memory_read', {
    memorySection: 'notes'
});

await agent.registerTool(customTool);
await agent.unregisterTool(customTool.name);
```

Discovery and execution use the same credential-bound `allowedTools` policy. A
client can narrow its channel key grant but cannot expand it.

### Conversation memory

The agent-owned memory manager is available for conversation/cognitive state that
belongs to this agent instance:

```typescript
const memory = agent.getMemoryManager();

await memory.addConversationMessage({
    role: 'user',
    content: 'Review the release evidence'
});

const messages = memory.getConversationHistory();
await memory.clearConversationHistory();
```

Every mutation queues an authoritative snapshot. Persistence errors reject the
caller; overlapping saves are serialized so an older write cannot overwrite a newer
state. Do not construct `MxfMemoryManager` yourself—the agent supplies its identity,
memory service, indexing context, and cleanup ownership.

For shared channel memory, use `agent.mxfService.getSharedMemory()`,
`updateSharedMemory()`, and the atomic append method documented in
[Memory Examples](examples-memory.md).

### Prompt configuration

```typescript
await agent.setAgentConfigPrompt(
    'You review release evidence and report concrete failures.'
);

agent.updateConfiguration({
    temperature: 0.2,
    maxIterations: 8
});
```

### Tasks

```typescript
const taskId = await agent.mxfService.createTask({
    title: 'Review evidence',
    description: 'Verify the build, tests, and package boundary',
    assignedAgentIds: ['reviewer']
});

await agent.mxfService.completeTask(taskId, { verdict: 'passed' });
```

Task lifecycle methods await exact server acknowledgements. See
[Task Examples](examples-tasks.md) for failure and cancellation.

## Lifecycle ownership

`agent.connect()` initializes its composed services. `agent.disconnect()` disposes
their EventBus subscriptions, pending acknowledged requests, sockets, and local
state. Constructing an internal manager independently bypasses that ownership and is
unsupported.

For testing a public application, mock the root SDK methods your application calls;
do not import `@mxf-dev/sdk/managers/*`.
