# SDK Event and Operation Handlers

MXF uses internal handler classes to translate socket events into the public agent
API. Handler constructors are not package exports. Applications should use the
root-level `MxfSDK`, `MxfAgent` type, `Events`, and the methods below.

## Public event handling

```typescript
import { Events } from '@mxf-dev/sdk';

const onAssigned = (payload: unknown): void => {
    console.log('Task assignment:', payload);
};

agent.on(Events.Task.ASSIGNED, onAssigned);
agent.off(Events.Task.ASSIGNED, onAssigned);
```

`on()` and `emit()` accept only the public event whitelist and throw for an internal
or unknown event. `off(event, handler)` removes exactly that handler;
`off(event)` removes all handlers owned by the agent for that event.

For a channel-filtered view of events already received by this process:

```typescript
agent.mxfService.on(Events.Message.AGENT_MESSAGE, payload => {
    console.log(payload.data.content.data);
});
```

## Message operations

```typescript
await agent.mxfService.sendMessage('Build proof is ready');

await agent.mxfService.sendMessage('Review this result', {
    receiverId: 'reviewer-agent',
    metadata: { correlationId: 'review-42' }
});
```

The service derives the sender from its authenticated identity. There is no public
sender-ID parameter that a caller can use to spoof a sibling agent.

## Memory operations

```typescript
const channelMemory = await agent.mxfService.getSharedMemory();
const updated = await agent.mxfService.updateSharedMemory({
    sharedState: { phase: 'complete' }
});
```

Agent-private key/value memory is available through authorized
`agent_memory_read` / `agent_memory_write` tools. Relationship and channel access is
checked against the authenticated participant and channel. See
[Memory Examples](examples-memory.md).

## Task operations

```typescript
const taskId = await agent.mxfService.createTask({
    title: 'Verify package',
    description: 'Check root exports and reject internal subpaths',
    assignedAgentIds: ['package-reviewer']
});

await agent.mxfService.completeTask(taskId, { passed: true });
await agent.mxfService.failTask(taskId, 'Package root could not be loaded');
await agent.mxfService.cancelTask(taskId, 'Review superseded');
```

These methods resolve only after the exact channel/agent/request response is
received. Cleanup or disconnect rejects pending work rather than leaving a promise
waiting indefinitely.

## User input

```typescript
agent.onUserInput(async request => {
    return renderUserPrompt(request);
});
```

The user-input handler is owned by the agent lifecycle. Register it through the
agent, not by constructing `UserInputHandlers`.

## MCP process management

Registering or killing an MCP server is not an agent handler operation. Use the
administrator-authenticated `MxfSDK` methods and enable the server's explicit
`MXF_UNSAFE_STDIO_MCP_ENABLED` gate. See
[External MCP Servers](external-mcp-servers.md).

## Testing

Test application behavior through public methods and events. Internal handler imports
such as `@mxf-dev/sdk/handlers/*` are intentionally blocked by the published package
export map.
