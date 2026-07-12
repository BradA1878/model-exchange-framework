# @mxf-dev/core

Core foundation of the [Model Exchange Framework](https://github.com/BradA1878/model-exchange-framework) (MXF): the event system, payload schemas, shared types and interfaces, runtime configuration, MXP protocol layer, MCP protocol contracts, services, and utilities that the MXF server and the `@mxf-dev/sdk` agent client are built on.

Most applications should depend on [`@mxf-dev/sdk`](https://www.npmjs.com/package/@mxf-dev/sdk) instead — it re-exports the core surface agents need. Depend on `@mxf-dev/core` directly when building server-side extensions or custom tooling.

## Install

```bash
bun add @mxf-dev/core   # or: npm install @mxf-dev/core
```

Requires Node.js >= 20.19 or Bun >= 1.2. ESM-only.

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
