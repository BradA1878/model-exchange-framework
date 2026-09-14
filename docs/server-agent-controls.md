# Server controls for message-driven agents

Use this guide when an application supplies its own prompts and messaging policy.
The SDK controls what an agent sends to its model; the server controls admission,
tool execution, channel history, and filesystem access. Configure both sides.
Upgrading an existing application also requires the
[core/SDK 5.0 consumer changes](sdk/upgrade-5.md).

## SDK switches

These are `sdk.createAgent()` options, not server environment variables.

| Option | Default | Opt-in behavior |
| --- | --- | --- |
| `promptMode` | `'framework'` | `'bare'` preserves the nonblank `agentConfigPrompt` byte for byte and omits framework-authored prompt sections and feedback. |
| `activation` | `'task'` | `'message'` starts turns from received channel messages or addressed DMs, without a task. One turn runs at a time; arrivals during it coalesce into one follow-up. |
| `circuitBreakerEnabled` | `true` | `false` disables repeated-tool tracking and intervention. `maxIterations` still bounds each message activation. |
| `captureLlmRequests` | `false` | `true` emits `LLM_REQUEST` for each supported provider transport attempt, containing its actual serialized JSON body. |
| `maxHistory` | `500` | Automatic trimming emits `HISTORY_TRIMMED` with actual dropped IDs/count and retained count. Manual compaction keeps its separate event. |
| `providerOptions` | Unset | Forwards provider-native request options, including OpenRouter's `provider` routing object. |

Bare mode rejects MXP and message aggregation; message activation rejects aggregation
and requires a positive integer `maxIterations` when supplied. Pair message activation
with `disableTaskHandling: true` when assigned tasks must not trigger the base client's
automatic handling. A no-tool model response is stored as an assistant turn and ends
the activation; agents send messages to others through tools. The iteration limit emits
`ITERATION_LIMIT` without adding instructions or failing a task.

Read [bare prompts and message activation](sdk/bare-agents.md) for the full contract,
[events](sdk/events.md#request-and-activation-observation) for request/activation IDs,
and [OpenRouter streaming bounds](sdk/openrouter-streaming.md) for first-data expiry
and retry behavior. Capture support is provider-specific: Gemini capture fails before
sending because the installed SDK has no final-body observation hook. Usage records
actual provider token counts, route and cost when supplied, plus measured latency;
missing provider facts are omitted.

## Server settings and defaults

Set these before starting the server. Invalid enum or boolean settings fail validation.

| Environment variable | Unset behavior | Configuration |
| --- | --- | --- |
| `AUTO_CORRECTION_ENABLED` | `true` | Exactly `true` or `false`. `false` disables parameter correction and its pattern-learning reads/writes. |
| `MXP_ENABLED` | `true` | Exactly `true` or `false`. `false` removes `mxpOptions` from messaging schemas, ignores supplied MXP options, and skips server MXP detection/encoding/encryption. |
| `TASK_INTELLIGENT_ASSIGNMENT_ENABLED` | `true` | Exactly `true` or `false`. `false` prevents automatic and explicitly requested intelligent assignment and cannot be reversed through runtime configuration. |
| `MXF_CHANNEL_HISTORY_DM_VISIBILITY` | `all` | `parties` restricts agent-readable DM history to the recorded sender and recipient. |
| `MXF_AGENT_FILESYSTEM_ROOTS` | Disabled | Comma-separated absolute directory templates. Only `{agentId}` is substituted. Empty, malformed or nonexistent roots fail admission. |
| `MXF_EXTERNAL_MCP_AUTOSTART` | Existing predefined selection | Comma-separated predefined server IDs. Empty starts none; unknown IDs fail. Independent of per-agent filesystems. |

The existing boot selection starts `calculator`, `sequential-thinking`, and `memory`,
plus global `filesystem` when `MXF_WORKSPACE_ROOT` is configured and `n8n` when its API
key is configured. An explicit autostart list replaces that selection. Some predefined
servers use `npx`; an empty list prevents those predefined boot launches. Filesystem
servers use the installed dependency described below. The legacy
`DISABLE_EXTERNAL_MCP_SERVERS` variable does not control per-agent filesystem admission;
use the explicit autostart list to control predefined boot launches.

## Canonical channel history and migration

`ChannelMemory.conversationHistory` is the canonical channel history. Broadcasts,
mirrored DMs, bulk appends, and owner-published messages use the same acknowledged
append path. Records retain their original message ID, timestamp (including zero),
sender, string or object content, and DM metadata. Repeated delivery of a message ID
keeps its first record. MongoDB appends deduplicate atomically; in-process appends use
the same first-ID-wins rule.

Existing deployments with history in `Channel.sharedMemory.conversationHistory` must
run the explicit migration before resuming channel traffic. The runtime does not read
the legacy field as a fallback or write both stores.

1. Stop every server or other process that writes channel history. Keep MongoDB running.
2. Install this checkout's dependencies and select its database with `MONGODB_URI`.
3. From the repository root, run:

   ```bash
   bun run migrate:channel-history
   ```

4. Check the reported channels scanned and messages copied, then start the server in
   your own terminal. A second migration run copies no additional messages.

The migration validates all selected histories before writing history. Identical
same-ID records are deduplicated. Divergent same-ID records, invalid IDs/timestamps,
and malformed historical records fail with an error identifying what requires repair.
The write also checks that canonical history still matches the preflight snapshot.
This is an idempotent per-channel migration, not a database-wide transaction: a later
storage failure may leave earlier channels copied, and rerunning is supported.

Legacy history is retained; the migration never deletes it. It preserves recorded
content and metadata without guessing their meaning. Historical DM tags or recipients
discarded by an older writer cannot be recovered. A record without a DM tag cannot
be distinguished from a broadcast; review such data before relying on parties-only
visibility for an existing database. A tagged DM with no recipient is visible only
to its recorded sender.

## Publish the initial message as a user

`POST /api/channels/:channelId/messages` accepts an authenticated channel owner or
administrator user. Agent keys receive 403; agents use `messaging_broadcast`.
The body is `{content: string | object, messageType?: string}`. Arrays, null, and
other primitives are rejected; an empty string is valid. A supplied `messageType`
must be a nonblank string and defaults to `user` when omitted.

The server takes the sender from the authenticated user's username, records its
user ID, and creates the message ID and timestamp. Caller-supplied attribution,
IDs, or timestamps do not replace those values. It awaits canonical persistence,
then emits one ordinary channel message. HTTP 200 returns `{messageId, timestamp}`;
a persistence failure returns an error and emits no seed message.

Use an existing owner user's access token and an existing channel:

```bash
curl --fail-with-body --request POST \
  "$MXF_SERVER_URL/api/channels/$CHANNEL_ID/messages" \
  --header "Authorization: Bearer $MXF_ACCESS_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"content":"Hello.","messageType":"user"}'
```

Bare agents see `[username]: Hello.`. A username is not automatically an agent
participant; a DM to it uses the normal participant checks. See the
[channels API](api/channels.md#channel-messages-and-context) for read endpoints.

## DM visibility at remote boundaries

With `MXF_CHANNEL_HISTORY_DM_VISIBILITY=parties`, a tagged DM is returned only to
its sender or `metadata.targetAgentId`. Broadcasts remain visible to all channel
agents. Filtering occurs before text filters, limits, pagination, and counts on
agent message reads. It applies to MCP memory tools, channel memory socket results,
channel messages REST, and channel memory GET/PATCH responses. Canonical memory and
cached records remain complete and unchanged by projection. Authorized owner/admin
user REST reads retain the full history.

Stored summaries, topics, metadata, context history, cognitive insights, and activity
counts may include other agents' DMs. Agent context responses therefore return only
channel identity/configuration fields: ID, channel ID, name, description, creation
time/creator, status, and participants. Agent reads of derived metadata, context
history, topics and summary REST routes are denied with 403. Channel memory projections
also omit derived top-level summary/topics/messageCount/lastActivity and updatedAt.
Explicitly shared notes, shared state, and unrelated custom data remain shared.

New public SystemLLM summaries and topic prompts exclude tagged DMs; shared
coordination also excludes DMs before updating activity or counts. The setting does
not rewrite older aggregates. With the default `all`, existing visibility remains.
See [memory API](api/memory.md#canonical-channel-history-and-visibility).

## Per-agent filesystem processes

Create every allowed directory before connecting its agent. For example, directories
`/srv/mxf-work/agent-a`, `/srv/mxf-work/agent-b`, and `/srv/mxf-work/shared` support:

```dotenv
MXF_AGENT_FILESYSTEM_ROOTS=/srv/mxf-work/{agentId},/srv/mxf-work/shared
MXF_EXTERNAL_MCP_AUTOSTART=
```

Leave `MXF_WORKSPACE_ROOT` unset. Configuring both a nonempty global root and per-agent
roots fails. Templates must be absolute paths; only `{agentId}` placeholders are
accepted. Agent IDs must be single path components without separators, NUL, `.` or
`..`. Each expanded root is resolved and checked to be an existing directory.

MXF starts one `filesystem:<agentId>` MCP process using the installed
`@modelcontextprotocol/server-filesystem` dependency pinned to `2026.8.31`. It uses
the current runtime executable and the resolved package entry point, not an `npx`
download. Keep this runtime dependency in the server deployment. The filesystem
package enforces its allowed roots, including private/shared-directory access.

Agent authentication waits for root validation, process initialization, and tool
discovery before acknowledging success. Multiple sockets for the same agent share
one process. The last socket release stops it immediately, including disconnects
during startup; a replacement admission waits for the previous process to exit.

Agents discover permitted raw tool names such as `read_file`; the internal registry
uses names such as `filesystem:agent-a__read_file`. Resolution is scoped to the
authenticated agent. The `filesystem:` namespace is reserved for this operator path.
It does not grant every tool: credential and channel allowlists still apply, and the
SDK's `allowedTools` must include the desired names. Apply the same resolved list
when provisioning the channel, its credentials, and each agent.
Discovery and execution both apply the credential and channel policies; an unloaded
channel policy produces a correlated error rather than a wider tool list.

This operator-managed path does not require `MXF_UNSAFE_STDIO_MCP_ENABLED` or the
broad host-tools switch. Caller-controlled stdio registration retains its separate
administrator-only opt-in; other host tools retain their own policy. Per-agent
filesystems do not depend on `DISABLE_EXTERNAL_MCP_SERVERS` or the autostart list.
See [external MCP servers](sdk/external-mcp-servers.md).

External tools must return an MCP result with a `content` array, which may be empty.
MXF preserves the full native content array, `isError`, `structuredContent`, and
`_meta` rather than replacing the result with its first text item. Invalid envelopes
fail explicitly; MIME types and content blocks are not invented. SDK tool messages
retain text blocks and serialize other returned data for the model. A filesystem denial
retains the package's error content and produces a tool error event.

## Minimal server profile

This profile selects the opt-ins; supply real authentication/database settings through
the normal installation flow. Provision directories, channel, user and agent keys
before starting agents. It does not supply credentials or model responses.

```dotenv
SYSTEMLLM_ENABLED=false
SYSTEMLLM_DAILY_BUDGET_USD=0
EVENT_QUEUE_ENABLED=false
AUTO_CORRECTION_ENABLED=false
MXP_ENABLED=false
TASK_INTELLIGENT_ASSIGNMENT_ENABLED=false
MXF_CHANNEL_HISTORY_DM_VISIBILITY=parties
MXF_AGENT_FILESYSTEM_ROOTS=/srv/mxf-work/{agentId},/srv/mxf-work/shared
MXF_EXTERNAL_MCP_AUTOSTART=
```

Also set `systemLlmEnabled: false` on the channel. Configure each agent's actual model,
provider credential, prompt, iteration/history limits, and allowlist as shown in the
[bare-agent guide](sdk/bare-agents.md). Set OpenRouter routing options per chosen model
and record observed route/cost from usage events. Review the stream attempt budget
before choosing an application-wide deadline.

Disabling auto-correction leaves deterministic schema-driven type coercion enabled.
Wrong-name or otherwise invalid arguments return validation errors without correction
or pattern learning. Authorization and validation rejection create no tool execution
document. Admitted socket/HTTP executor calls await their start and terminal audit
writes; audit failures remain failures. Cancellation owns one terminal outcome but
cannot undo external side effects from a handler that cannot be cancelled.
