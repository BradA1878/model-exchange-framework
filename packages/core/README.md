# @mxf-dev/core

Core foundation of the [Model Exchange Framework](https://github.com/BradA1878/model-exchange-framework) (MXF): the event system, payload schemas, shared types and interfaces, runtime configuration, MXP protocol layer, MCP protocol contracts, services, and utilities that the MXF server and the `@mxf-dev/sdk` agent client are built on.

Most applications should depend on [`@mxf-dev/sdk`](https://www.npmjs.com/package/@mxf-dev/sdk) instead — it re-exports the core surface agents need. Depend on `@mxf-dev/core` directly when building server-side extensions or custom tooling.

## Install

```bash
bun add @mxf-dev/core   # or: npm install @mxf-dev/core
```

Requires Node.js >= 20.19 or Bun >= 1.2. ESM-only.

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
