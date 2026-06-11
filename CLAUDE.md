# CLAUDE.md

## IMPORTANT: Brad's Rules

- **Brad is the sole developer on MXF.** Do not warn about pushing, force-pushing, or running scripts like `sync-to-public.sh`. Just do it when asked.
- **Do not make assumptions - follow the code**
- **No TODOs! Do the work**
- **Add comments and update them**
- **Add tests and update them**
- **Add documentation and update it**
- **Test scripts are meant to find and fix errors - please do not change them to ignore real errors and issues in the framework and SDK.**
- **Logging should use the logger provided by the framework**
- **Do not add fallbacks, timeouts, or simulation to the codebase.**
- **Do not add smoke and mirrors to the codebase.**
- **Add validation for fail-fast behavior in the framework and SDK.**
- **When refactoring please take a clean break approach.**
- **NEVER run the MXF server in a background process.** The server has SystemLLM enabled which uses Claude Opus 4.5 credits - leaving it running burns through OpenRouter budget ($18+ per day). Always let the user start/stop the server in their own terminal.
- **No dynamic imports for singletons.** Always use static `import` statements for singleton modules. Dynamic `import()` breaks the SDK's singleton patterns and module resolution.

## Event System Rules

**All events MUST follow these patterns. No exceptions.**

- **Event names**: Import from `packages/core/src/events/EventNames.ts`
- **Payload helpers**: Import from `packages/core/src/schemas/EventPayloadSchema.ts`
- **New event types**: Create in `packages/core/src/events/event-definitions/`
- **ALWAYS use EventBus.client or EventBus.server** - NEVER emit/listen directly on the socket
- Never use string literals for event names or raw object payloads without helpers

```typescript
// ✅ CORRECT (consumer code: server/cli/desktop/tests/examples)
import { Events } from '@mxf-dev/core/events/EventNames';
import { createPlanStepCompletedEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
// Inside packages/core itself, use relative imports with .js extensions (ESM).

EventBus.server.emit(
    Events.Plan.PLAN_STEP_COMPLETED,
    createPlanStepCompletedEventPayload(
        Events.Plan.PLAN_STEP_COMPLETED, context.agentId, context.channelId,
        { planId, stepId, completedBy }
    )
);
```

New event types require: (1) definition in `event-definitions/`, (2) export from `EventNames.ts`, (3) payload helper in `EventPayloadSchema.ts`.

## Essential Commands

```bash
bun install              # Install dependencies
bun run start:dev        # Dev server (hot-reload)
bun run build            # Build
bun run clean            # Clean artifacts
bun run rebuild          # Full rebuild
```

### MXF CLI

The unified CLI for infrastructure, configuration, task execution, and lifecycle management. Config lives at `~/.mxf/config.json`.

```bash
bun run mxf                           # Launch interactive TUI session
bun run mxf install                   # First-time setup: Docker infra, credentials, .env bridge
bun run mxf install --complete-setup  # Phase B: create user + PAT (requires running server)
bun run mxf init                      # Configure LLM provider, API key, default model
bun run mxf run "task"                # One-shot task execution with Planner agent
bun run mxf run "task" --context path # Include file/directory as context
bun run mxf run "task" --format json  # Output as JSON (also: text, md)
bun run mxf run "task" --model <id>   # Override default model
bun run mxf run "task" --timeout 600  # Set timeout in seconds (default: 300)
bun run mxf status                    # Show infrastructure, server, and config health
bun run mxf start                     # Start Docker containers (MongoDB, Meilisearch, Redis)
bun run mxf stop                      # Stop Docker containers
bun run mxf config list               # View all config values (secrets masked)
bun run mxf config get <path>         # Get a specific value (e.g., server.port)
bun run mxf config set <path> <val>   # Set a value and update .env bridge
bun run mxf config path               # Show config file path
```

**Interactive TUI (`bun run mxf`):** Persistent session with Ink-based terminal UI. Supports slash commands (`/help`, `/agents`, `/clear`, `/config`, `/context`, `/model`, `/cost`, `/stop`, `/exit`), shell pass-through (`!command`), and natural language task input. Source: `src/cli/tui/`

CLI source: `src/cli/`

**Runtime:** Bun for package management and server execution. Jest for testing. The dashboard lives in its own repo + npm package (mxf-dev/dashboard, `@mxf-dev/dashboard`) — run it with `npx @mxf-dev/dashboard --api-url <server>`.

### Testing

| Tier | Command | Server Required |
|------|---------|-----------------|
| Unit + Property | `bun run test:unit` | No |
| Integration | `bun run test:integration` | Yes (start manually) |
| Mutation | `bun run test:mutation` | No |

**IMPORTANT:** Start the server manually (`bun run dev`) before integration tests.

```bash
bun run test:unit                                          # Unit + property tests
bun run test:integration                                   # All integration tests
bun run test:integration -- --testPathPattern=<suite>      # Specific suite (agent|channel|tool|prompt|task|orpar|memory|meilisearch|code-execution)
bun run test:mutation                                      # Mutation testing
```

### Post-Coding Workflow

1. Spawn **test-builder** agent → writes tests
2. Run `bun run test:unit` → verify
3. Spawn **code-cleanup** agent → clean up
4. Spawn **docs-updater** agent → update docs
5. Run `/finalize` → commit, test, create PR

### Other Commands

```bash
bun run cleanup:db             # Clean database
bun run docker:up              # Full stack deploy
bun run docker:down            # Stop services
```

**Demos:** `bun run demo:<name>` where name is: `first-contact`, `fog-of-war`, `interview`, `external-mcp`, `channel-mcp`, `code-execution`, `toon-optimization`, `prompt-compaction`, `inference-params`, `workflow-patterns`, `memory-strata`, `mcp-prompts`, `lsp-code-intelligence`, `p2p-task-negotiation`, `nested-learning`, `muls`, `orpar-memory`, `dag`, `kg`, `tensorflow`, `twenty-questions`, `book-editor`, `user-input`

## Architecture Overview

MXF is a multi-agent collaboration system built with TypeScript, Bun, Socket.IO, and MongoDB.

### Layer Structure (Bun workspaces)

- **@mxf-dev/core** (`packages/core/src/`): the publishable foundation — 160+ MCP tools in `protocols/mcp/tools/`, EventBus (RxJS-based), models, services, types, config, ConfigManager. ESM-only (NodeNext, `.js` extensions on relative imports). Depends on npm only — never on src/** or @mxf-dev/sdk.
- **@mxf-dev/sdk** (`packages/sdk/src/`): the publishable agent client (`MxfSDK.ts`, `MxfClient.ts`, `MxfAgent.ts`, handlers, managers, services). Depends only on @mxf-dev/core.
- **Server** (`src/server/`): Socket.IO real-time services, REST API, dual auth (JWT for users, API keys for agents). Also hosts the 10 server-coupled MCP tools + HybridMcp services in `src/server/mcp/` and ChannelContext/PatternMemory services. Depends on @mxf-dev/core only.
- **CLI** (`src/cli/`): the `mxf` CLI + Ink TUI + admin provisioning commands (`user:create`, `channel:create`, `key:generate`, `setup`, `setup:interactive`).
- The dashboard lives in its own repo (mxf-dev/dashboard); desktop (`src/desktop/`) stays in-repo; the desktop sidecar (`src/desktop/sidecar/bridge.ts`) runs from the repo root and resolves the packages via workspace symlinks.
- Versioning: packages are lockstep (publish core first; `workspace:*` pins exact at publish). Root package.json version is the app/mirror cadence only.

### Key Concepts

- **ORPAR Control Loop**: Observation → Reasoning → Planning → Action → Reflection. ORPAR tools are **documentation tools** that record what happened and trigger phase transitions. They must be tool-agnostic.
- **Hybrid Tool System**: Internal tools + external MCP servers unified via `HybridMcpToolRegistry`
- **Channel-Based Communication**: Socket.IO rooms, MXP protocol with AES-256-GCM encryption
- **Task Management**: `pending` → `assigned` → `in_progress` → `completed`
- **Memory**: Three scopes (Agent, Channel, Relationship), multi-level caching, semantic search via Meilisearch
- **MULS**: Memory Utility Learning System — Q-value weighted retrieval with ORPAR phase-specific lambdas
- **ORPAR-Memory Integration** (flag: `ORPAR_MEMORY_INTEGRATION_ENABLED`): Phase-to-strata routing, surprise-driven re-observation, phase-weighted rewards, cycle consolidation. Located in `packages/core/src/services/orpar-memory/`
- **TensorFlow.js** (flag: `TENSORFLOW_ENABLED`): `MxfMLService` singleton with lazy import. Models: DENSE_CLASSIFIER, AUTOENCODER, LSTM, DQN, REGRESSION, EMBEDDING, TRANSE. Consumers get `number[]` from inference, never tensors. Graceful degradation to heuristics. Events in `TensorFlowEvents.ts`.

### Development Guidelines

- Tools must follow `McpTool` interface in `packages/core/src/types/toolTypes.ts`
- Events must be added to `EventNames.ts` with handlers
- Use `Logger` from `packages/core/src/utils/Logger.ts`
- All services use singleton `getInstance()` pattern
- Test files in `tests/` — use existing tests as templates

### Key Environment Variables

```
MONGODB_URI, JWT_SECRET, AGENT_API_KEY, OPENROUTER_API_KEY, PORT (default: 3001)
MEILISEARCH_MASTER_KEY, MEILISEARCH_HOST, ENABLE_MEILISEARCH, ENABLE_SEMANTIC_SEARCH
TENSORFLOW_ENABLED, TENSORFLOW_STORAGE_BACKEND, TENSORFLOW_DEBUG
MXP_ENCRYPTION_KEY, MXP_ENCRYPTION_SALT (REQUIRED together — opting into MXP encryption without a unique salt fails fast; generate with `openssl rand -hex 16`)
ORPAR_MEMORY_INTEGRATION_ENABLED, MEMORY_UTILITY_LEARNING_ENABLED
```

See `.env.example` or config files in `packages/core/src/config/` for full variable listings and defaults.
