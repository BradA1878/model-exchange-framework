# Agent memory lifetime and task outcomes

These APIs are available in matching `@mxf-dev/core` and `@mxf-dev/sdk` packages
starting with 4.0.0. See the [upgrade guide](../../packages/sdk/README.md#upgrading-to-40)
for changes to exported core contracts.

## Memory lifetime

`MxfSDK.createAgent()` accepts `memoryMode: 'persistent' | 'session'`.

- `persistent` is the default. It loads and saves SDK-managed agent memory and uses
  configured search indexing.
- `session` keeps conversation, observations, reasoning, and plans in the current
  agent instance. It does not automatically load, save, backfill, or index them,
  and does not construct a search client. Local history still obeys its size limits.

A transport reconnect retains the same instance's local memory. To start empty,
create a new agent instance after disconnecting the old one. Session mode does not
erase existing server history, disable explicitly invoked memory tools, or change
application-owned databases and trace storage.

`backfillSearchIndexOnLoad: false` is a separate option: with persistent memory,
it skips the on-load search backfill while retaining memory loading, saving, and
live indexing. It is not a substitute for session mode.

The public creation API also forwards `providerOptions` to the provider adapter.
Configuration replacement validates and initializes the new client before making
it active; failure leaves the previous working configuration intact.

## Task identity

The SDK task manager owns the accepted task. It rejects an overlapping assignment
before changing task context. Asynchronous work captures the execution generation;
a result from an older task cannot append to or complete the next task.

After a terminal event, a newly accepted task waits for the previous turn to return
before preparing its prompt. This prevents overlapping mutations to an instance's
context, including turns started by incoming messages after the original assigned
loop returned. Messages received during task preparation remain in history for its
first response; they cannot start a model call before that preparation completes.
This does not abort a provider request or reverse a tool's side effects.

`createTask()` returns the server's task ID, not a result. Subscribe before creating
the task, then match completed, failed, and cancelled outcomes against that returned
ID. A terminal event can arrive before the creation response. The
[recurring review example](../../examples/recurring-review/README.md) handles that
ordering and disposes its subscriptions.

## Authenticated reconnects

Use `sdk.onReconnected(listener)` for restoring application registrations after the
SDK user connection has reauthenticated. It returns an unsubscribe function. It
does not fire for first authentication or duplicate authentication, and callbacks
are isolated per SDK instance even when two instances use the same user.

The callback receives `{ sdkInstanceId, userId, attempt }`. `attempt` is `null` when
the transport did not provide a retry count. This callback does not itself recreate
application agents or external server registrations; the application owns that work.
