# Development Lifecycle

This section outlines the typical development workflow and code structure for MXF components.

## Repository Structure

```
model-exchange-framework/
├── src/server/         # Backend API server (TypeScript, Express)
├── src/sdk/            # MXF TypeScript SDK client
├── src/shared/         # Shared utilities, tools, events, models
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
- **Validate:** Shared request/response schemas in `src/shared/schemas`

## Dashboard

- **Navigate:** `cd dashboard`
- **Install:** `npm install`
- **Dev Server:** `bun run dev` (http://localhost:5173)
- **Build:** `bun run build` outputs to `dashboard/dist/`
- **Type Check:** `bun run type-check`
- **Lint:** `bun run lint`

## SDK

The SDK is part of the monorepo at `src/sdk/`. It is not published separately.

- **Build:** `bun run build` (builds the entire project including SDK)
- **Test:** Integration tests via `bun run test:integration`
- **CLI:** `bun run sdk:cli -- <command>` for channel/key management

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
