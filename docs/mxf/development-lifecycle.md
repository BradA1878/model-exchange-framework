# Development Lifecycle

This section outlines the typical development workflow and code structure for MXF components.

## Repository Structure

```
model-exchange-framework/
├── src/server/         # Backend API server (TypeScript, Express)
├── packages/sdk/src/            # MXF TypeScript SDK client
├── packages/core/src/         # Shared utilities, tools, events, models
├── dashboard/          # Vue 3 Dashboard application
├── examples/           # 20 demo applications
├── tests/              # Unit, property, integration, mutation tests
└── docs/               # Documentation (API, Dashboard, SDK, MXF)
```

## Backend

- **Install:** `bun install` in project root
- **Run:** `bun run start:dev` for development (hot-reload) or `bun run start` for production
- **Build:** `bun run build` compiles TypeScript to `dist/`
- **Clean:** `bun run clean` removes build artifacts
- **Rebuild:** `bun run rebuild` runs clean + build
- **Validate:** Shared request/response schemas in `packages/core/src/schemas`

## Dashboard

The dashboard is a separate repo + npm package
([mxf-dev/dashboard](https://github.com/mxf-dev/dashboard) /
[`@mxf-dev/dashboard`](https://www.npmjs.com/package/@mxf-dev/dashboard)).

- **Run against this server:** `npx @mxf-dev/dashboard --api-url http://localhost:3001`
- **Develop:** `git clone https://github.com/mxf-dev/dashboard && cd dashboard && npm install && npm run dev`

## SDK

The SDK lives at `packages/sdk/src/` in this repo and is published to npm as `@mxf-dev/sdk` (with `@mxf-dev/core`). Install it with `npm install @mxf-dev/sdk`.

- **Build:** `bun run build` (builds the entire project including SDK)
- **Test:** Integration tests via `bun run test:integration`
- **CLI:** `bun run mxf <command>` for channel/key management

## Testing

```bash
bun run test:unit              # Unit + property tests (no server needed)
bun run test:integration       # All integration tests (server must be running)
bun run test:mutation          # Mutation testing (no server needed)
```

**Important:** Start the server manually (`bun run start:dev`) before running integration tests.

## Documentation

- **Location:** `docs/` folder contains all markdown files
- **Browser:** Open `docs/index.html` for interactive documentation browser
- **Update:** After code changes, synchronize docs with API and config updates

---

By following this lifecycle, contributors can develop, validate, and publish MXF components efficiently.
