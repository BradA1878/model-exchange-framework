# AGENTS.md

Model Exchange Framework (MXF) — a multi-agent AI orchestration framework built with TypeScript, Bun, Socket.IO, and MongoDB.

## Build & Run

```bash
bun install                # Install dependencies
bun run build              # TypeScript build
bun run clean              # Remove build artifacts
bun run rebuild            # Clean + build
bun run lint               # ESLint
```

**Runtime:** Bun (not Node). The package manager is also Bun. The dashboard (`dashboard/`) uses npm separately.

**Do NOT start the MXF server in a background process.** The server has SystemLLM enabled which uses LLM credits via OpenRouter. Always let the developer start/stop the server manually.

## Testing

| Tier | Command | Server Required |
|------|---------|-----------------|
| Unit + Property | `bun run test:unit` | No |
| Integration | `bun run test:integration` | Yes — start manually with `bun run dev` |
| Mutation | `bun run test:mutation` | No |

```bash
bun run test:unit                                          # Unit + property tests
bun run test:integration                                   # All integration tests (server must be running)
bun run test:integration -- --testPathPattern=<suite>      # Specific suite
bun run test:mutation                                      # Mutation testing (Stryker)
```

Available integration test suites: `agent`, `channel`, `tool`, `prompt`, `task`, `orpar`, `memory`, `meilisearch`, `code-execution`.

Test framework is Jest (not Vitest). Config files are in `tests/jest.config.ts` and `tests/jest.unit.config.ts`.

## Project Structure

```
src/
├── sdk/          # Agent client SDK (MxfClient.ts), handlers, managers, services
├── server/       # Socket.IO server, REST API, auth (JWT for users, API keys for agents)
├── shared/       # Shared code: 100+ MCP tools, EventBus (RxJS), models, services, types, config
│   ├── events/           # Event system (EventNames.ts, event-definitions/)
│   ├── protocols/mcp/tools/  # All MCP tool implementations
│   ├── schemas/          # Event payload schemas (EventPayloadSchema.ts)
│   ├── services/         # Shared services (orpar-memory/, etc.)
│   ├── types/            # Type definitions (toolTypes.ts, etc.)
│   ├── utils/            # Logger.ts and utilities
│   └── config/           # Configuration files
├── migrations/   # Database migrations
tests/
├── integration/  # Integration tests (require running server)
├── unit/         # Unit tests
├── property/     # Property-based tests (fast-check)
├── utils/        # Test utilities
└── setup/        # Test setup files
dashboard/        # Vue 3 + Vuetify dashboard (separate npm project)
examples/         # Demo scripts (run via `bun run demo:<name>`)
```

## Code Style & Conventions

- **TypeScript strict mode.** All code is TypeScript.
- **Singleton pattern:** All services use `getInstance()`.
- **Logging:** Use `Logger` from `src/shared/utils/Logger.ts`. Never use `console.log`.
- **No TODOs in code.** Complete the work.
- **No fallbacks, timeouts, or simulation.** Fail fast with validation.
- **Clean break refactoring.** When refactoring, don't leave backwards-compatibility shims.

### MCP Tools

Tools follow the `McpTool` interface defined in `src/shared/types/toolTypes.ts`. Tool implementations live in `src/shared/protocols/mcp/tools/`. Use existing tools as templates when adding new ones.

### Event System

All events must follow this pattern — no exceptions:

- Event names: import from `src/shared/events/EventNames.ts`
- Payload helpers: import from `src/shared/schemas/EventPayloadSchema.ts`
- New event definitions: create in `src/shared/events/event-definitions/`
- Always use `EventBus.client` or `EventBus.server` — never emit/listen directly on the socket
- Never use string literals for event names or raw object payloads

```typescript
import { Events } from '../../../events/EventNames';
import { createPlanStepCompletedEventPayload } from '../../../schemas/EventPayloadSchema';

EventBus.server.emit(
    Events.Plan.PLAN_STEP_COMPLETED,
    createPlanStepCompletedEventPayload(
        Events.Plan.PLAN_STEP_COMPLETED, context.agentId, context.channelId,
        { planId, stepId, completedBy }
    )
);
```

Adding a new event type requires three changes: (1) definition in `event-definitions/`, (2) export from `EventNames.ts`, (3) payload helper in `EventPayloadSchema.ts`.

## Key Architectural Concepts

- **ORPAR Control Loop:** Observation → Reasoning → Planning → Action → Reflection. ORPAR tools are documentation tools that record what happened and trigger phase transitions. They must be tool-agnostic.
- **Hybrid Tool System:** Internal tools + external MCP servers unified via `HybridMcpToolRegistry`.
- **Channel-Based Communication:** Socket.IO rooms with MXP protocol using AES-256-GCM encryption.
- **Task Management:** States flow `pending` → `assigned` → `in_progress` → `completed`.
- **Memory System:** Three scopes (Agent, Channel, Relationship), multi-level caching, semantic search via Meilisearch.
- **MULS:** Memory Utility Learning System — Q-value weighted retrieval with ORPAR phase-specific lambdas.
- **TensorFlow.js** (flag: `TENSORFLOW_ENABLED`): `MxfMLService` singleton with lazy import. Consumers get `number[]` from inference, never raw tensors.

## Environment Variables

Required variables (see `.env.example` or `src/shared/config/` for full listings):

```
MONGODB_URI, JWT_SECRET, AGENT_API_KEY, OPENROUTER_API_KEY, PORT (default: 3001)
MEILISEARCH_MASTER_KEY, MEILISEARCH_HOST, ENABLE_MEILISEARCH, ENABLE_SEMANTIC_SEARCH
TENSORFLOW_ENABLED, TENSORFLOW_STORAGE_BACKEND, TENSORFLOW_DEBUG
ORPAR_MEMORY_INTEGRATION_ENABLED, MEMORY_UTILITY_LEARNING_ENABLED
```

## Infrastructure

```bash
bun run docker:infra:up    # Start MongoDB, Meilisearch, Redis containers
bun run docker:infra:down  # Stop infrastructure containers
bun run docker:up          # Full stack deploy
bun run docker:down        # Stop all services
bun run cleanup:db         # Clean database
```

## PR & Commit Guidelines

- Run `bun run lint` before committing.
- Run `bun run test:unit` before creating a PR.
- Test scripts exist to find real errors — do not modify them to hide issues.
