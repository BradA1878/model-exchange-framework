# Memory Operations Examples

MXF persists agent, channel, and relationship memory as canonical documents. Public
SDK calls resolve to the server-confirmed value or reject; they do not return a local
success guess, silently substitute an empty document, or wait on an uncorrelated event.

## Prerequisites

See [Basic Examples](examples-basic.md#prerequisites) for authentication and agent
creation. Memory tools must be present in both the channel key grant and the agent's
requested `allowedTools` subset.

## Channel memory

`agent.mxfService` exposes the supported channel-memory document API:

```typescript
import type { ChannelMemory } from '@mxf-dev/sdk';

const saved: ChannelMemory = await agent.mxfService.updateSharedMemory({
    notes: {
        project: 'MXF hardening'
    },
    sharedState: {
        phase: 'verification',
        reviewer: 'agent-2'
    }
});

const current: ChannelMemory = await agent.mxfService.getSharedMemory();
console.log(current.sharedState?.phase);
```

The convenience methods use the same canonical persistence boundary:

```typescript
await agent.mxfService.addSharedNote('decision', 'Ship after the proof suite passes');
await agent.mxfService.updateSharedState('phase', 'complete');

// This append is atomic. Concurrent agents cannot overwrite one another by doing a
// client-side read/modify/write cycle.
const history = await agent.mxfService.addToSharedConversationHistory({
    senderId: agent.agentId,
    content: 'Verification complete',
    timestamp: Date.now()
});
```

Do not implement an append by reading the whole document and writing a copied array.
Use `addToSharedConversationHistory()` so MXF performs the append atomically.

## Agent-private memory

Agent key/value memory is exposed through the MCP memory tools. The server derives
the owner from the authenticated agent credential; callers cannot select another
agent's memory.

```typescript
const writer = await sdk.createAgent({
    agentId: 'memory-agent',
    name: 'Memory Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.memoryAgent.keyId,
    secretKey: credentials.keys.memoryAgent.secretKey,
    llmProvider: 'openrouter',
    defaultModel: '~anthropic/claude-sonnet-latest',
    apiKey: process.env.OPENROUTER_API_KEY,
    allowedTools: ['agent_memory_read', 'agent_memory_write']
});

await writer.connect();

await writer.executeTool('agent_memory_write', {
    key: 'preferences',
    value: { theme: 'dark', language: 'en' },
    memorySection: 'notes',
    overwrite: true
});

const result = await writer.executeTool('agent_memory_read', {
    key: 'preferences',
    memorySection: 'notes',
    includeMetadata: true
});
```

An explicit `allowedTools: []` grants no tools. Omitting `allowedTools` selects the
curated core set, which includes `agent_memory_read` but not
`agent_memory_write`. The channel key remains the maximum grant: requesting a name
outside that credential grant is rejected.

## Channel key/value memory tools

LLM-directed workflows can use the channel memory tools instead of the document API:

```typescript
await agent.executeTool('channel_memory_write', {
    key: 'release',
    value: { status: 'approved', commit: 'abc123' },
    memorySection: 'sharedState'
});

const release = await agent.executeTool('channel_memory_read', {
    key: 'release',
    memorySection: 'sharedState',
    includeMetadata: true
});
```

MXF reserves internal keyed-memory fields used for atomic coordination. Attempts to
write those reserved fields through the generic tool fail instead of corrupting the
document.

## Failure handling

Memory operations reject with the authoritative persistence or authorization error.
Handle the error at the call site; do not treat `null` or `false` as a failed write.

```typescript
try {
    await agent.mxfService.updateSharedState('deployment', 'approved');
} catch (error) {
    console.error('Channel memory was not updated:', error);
}
```

## Scope and isolation

- Agent memory is exact-self for agent credentials.
- Channel memory requires membership in that exact channel.
- Relationship memory requires the authenticated agent to be one of the two
  participants and, when channel-scoped, a member of that channel.
- HTTP and socket memory surfaces use the same canonical `MemoryService`; neither
  reads or mutates legacy embedded `Agent.memory` / `Channel.sharedMemory` fields.

## See also

- [Basic Examples](examples-basic.md)
- [Event Handling Examples](examples-events.md)
- [Task Management Examples](examples-tasks.md)
