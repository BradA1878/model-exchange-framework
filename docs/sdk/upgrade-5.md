# Upgrade to core and SDK 5.0

Upgrade `@mxf-dev/core` and `@mxf-dev/sdk` together, and deploy the matching server.
The default task loop and framework prompts remain the default. This major release
changes tool-result types, the user-message REST contract, and canonical channel
history storage.

## Consumer changes

- `McpToolHandlerResult.content` can now be an internal result object or a native
  MCP content-block array. Narrow with `Array.isArray(result.content)` before
  accessing internal `.data` fields. Preserve all native blocks and the envelope's
  `isError`, `structuredContent`, and `_meta`; do not assume the first item is text.
  External servers must return an explicit `content` array, including `[]` for no
  content. Invalid native envelopes fail instead of receiving invented content.
  Upgrade the SDK with the server: SDK 5.0.0 and 5.0.1 turned every native envelope
  into the word `Success` in the default prompt mode, so the model never received
  an external tool's payload (bare mode was unaffected). Later 5.0.x SDKs send the
  content blocks' text.
- `POST /api/channels/:channelId/messages` is restricted to the owner or administrator
  **user**. Send `{content: string | object, messageType?: string}`. The response is
  `{messageId, timestamp}` after persistence. Sender attribution comes from the
  authenticated username. Agent clients must use messaging tools.
- Tool discovery intersects the exact credential's grants with loaded channel policy,
  as execution does. Missing channel policy returns a correlated error. Provision the
  intended tools on the channel and its credentials as well as SDK `allowedTools`.

## Existing server data

Before resuming writes, stop all channel-history writers and run
`bun run migrate:channel-history` against the deployment's `MONGODB_URI`.
`ChannelMemory.conversationHistory` is the sole runtime history store. The migration
retains legacy source records, preflights divergent duplicate IDs, and can be rerun.
It cannot recover historical DM metadata discarded by older writers. Follow the
[migration procedure](../server-agent-controls.md#canonical-channel-history-and-migration).

## Optional behavior

Use [bare-agent configuration](bare-agents.md) for exact operator prompts,
message-triggered activations, circuit control, request capture, history-trim events,
and provider routing. Use [server controls](../server-agent-controls.md) to disable
correction, MXP, or intelligent assignment; restrict DM visibility; and install
per-agent filesystem roots. Existing defaults remain unchanged unless configured.

When filesystem roots are configured, authentication completes only after the
filesystem is ready, membership is established, and the socket joins its channel.
A socket cannot use channel tools before admission. An explicit channel leave closes
that channel-bound socket; the last socket release terminates the agent's filesystem.
An explicit reconnect after a remote leave installs handlers on the new transport
and preserves local event subscriptions. Automatic reconnect on the same transport
retains the agent session's running/pending message work without reloading memory
or replaying initialization into an active turn.

Review [OpenRouter streaming bounds](openrouter-streaming.md) when choosing an
application deadline. A first-data expiry may make one further attempt with a new
request ID. Keepalive traffic does not satisfy the first-data bound.
