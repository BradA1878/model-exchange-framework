# @mxf-dev/core

Core foundation of the [Model Exchange Framework](https://github.com/BradA1878/model-exchange-framework) (MXF): the event system, payload schemas, shared types and interfaces, runtime configuration, MXP protocol layer, MCP protocol contracts, services, and utilities that the MXF server and the `@mxf-dev/sdk` agent client are built on.

Most applications should depend on [`@mxf-dev/sdk`](https://www.npmjs.com/package/@mxf-dev/sdk) instead — it re-exports the core surface agents need. Depend on `@mxf-dev/core` directly when building server-side extensions or custom tooling.

## Install

```bash
bun add @mxf-dev/core   # or: npm install @mxf-dev/core
```

Requires Node.js >= 20.19 or Bun >= 1.2. ESM-only.

### Upgrading to 5.0

Update core and SDK together. `McpToolHandlerResult.content` now accepts either
the internal result object or a native MCP content-block array. Narrow with
`Array.isArray()` before accessing `.data`; retain native `isError`,
`structuredContent`, `_meta`, and all content blocks. External MCP servers must
return an explicit content array, including `[]` for no content.

New request, activation-limit, and history-trim events expose agent execution.
Server controls add per-agent filesystem roots, private DM reads, and switches
for correction, MXP, and intelligent assignment. Existing server history needs
the explicit channel-history migration before writers resume. See the
[5.0 upgrade guide](https://mxf.dev/#sdk/upgrade-5.md) and
[server controls](https://mxf.dev/#server-agent-controls.md). Use SDK 5.0.2 or
later: earlier 5.0.x SDKs sent the model the word `Success` instead of an
external server's payload in the default prompt mode.

### Upgrading to 4.0

Core and SDK versions must match. Two exported contracts require consumer changes:

- `QValueManager.setPersistenceCallback(write, read)` now requires both callbacks.
  The reader returns the persisted Q-value, or `undefined` if none exists, and
  rejects on storage failure. Persisted values must be finite and in `[0, 1]`.
  Server startup registers `MemoryService`'s reader and writer. Cache eviction now retains
  unpersisted rewards and refuses admission when no clean, idle entry can be evicted.
- `SdkReconnectedEventData` and its payload helper require a nonempty
  `sdkInstanceId`. SDK lifecycle callbacks supply it automatically, isolating
  reconnect notifications between instances signed in as the same user.

This release also fixes provider request settings and usage reporting, nested JSON
path validation, workspace symlink checks, graph path traversal, and memory retrieval
scoring. See the [SDK upgrade guide](../sdk/README.md#upgrading-to-40) for session
memory and task lifecycle changes.

### Optional peer dependencies

Features that need a heavy or platform-specific library declare it as an optional
peer dependency, so installing `@mxf-dev/core` does not drag it in. Each is loaded
on first use and throws a clear install message if it is missing — nothing silently
degrades.

| Package | Install it to use | Why it is optional |
|---------|-------------------|--------------------|
| `puppeteer` | `BrowserManager`, `WebSearchService` | Downloads a ~170MB Chromium |
| `bcrypt` | The `User` model (password hashing) | Native module, compiled at install |
| `@tensorflow/tfjs` | `MxfMLService` (set `TENSORFLOW_ENABLED`) | Large; only needed for ML features |
| `socket.io` | Server-side event transport | Not needed by every consumer |

```bash
bun add puppeteer   # only if you use the browser tools
```

## Usage

```typescript
import { Events, EventBus, Logger, ConfigManager } from '@mxf-dev/core';

// The full module tree is addressable through subpath exports:
import { TokenEstimator } from '@mxf-dev/core/utils/TokenEstimator';
import { createTaskEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
```

Event names always come from `Events` (never string literals), and event payloads are built with the helpers in `@mxf-dev/core/schemas/EventPayloadSchema`.

## License

Apache-2.0
