# CLAUDE.md

## IMPORTANT: Brad's Rules

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
- **Do not add unit tests to the codebase unless asked.**
- **NEVER run the MXF server in a background process.** The server has SystemLLM enabled which uses Claude Opus 4.5 credits - leaving it running burns through OpenRouter budget ($18+ per day). Always let the user start/stop the server in their own terminal.

## Event System Rules

**All events MUST follow these patterns. No exceptions.**

- **Event names**: Import from `src/shared/events/EventNames.ts`
- **Payload helpers**: Import from `src/shared/schemas/EventPayloadSchema.ts`
- **New event types**: Create in `src/shared/events/event-definitions/`
- **ALWAYS use EventBus.client or EventBus.server** - NEVER emit/listen directly on the socket
- Never use string literals for event names or raw object payloads without helpers

```typescript
// ✅ CORRECT
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

New event types require: (1) definition in `event-definitions/`, (2) export from `EventNames.ts`, (3) payload helper in `EventPayloadSchema.ts`.

## Essential Commands

```bash
bun install              # Install dependencies
bun run start:dev        # Dev server (hot-reload)
bun run build            # Build
bun run clean            # Clean artifacts
bun run rebuild          # Full rebuild
```

**Runtime:** Bun for package management and server execution. Jest for testing. Dashboard (`dashboard/`) uses npm separately.

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
cd dashboard && bun run dev    # Dashboard dev server
bun run build:dashboard        # Build dashboard
bun run cleanup:db             # Clean database
bun run docker:up              # Full stack deploy
bun run docker:down            # Stop services
```

**Demos:** `bun run demo:<name>` where name is: `first-contact`, `fog-of-war`, `interview`, `external-mcp`, `channel-mcp`, `code-execution`, `toon-optimization`, `prompt-compaction`, `inference-params`, `workflow-patterns`, `memory-strata`, `mcp-prompts`, `lsp-code-intelligence`, `p2p-task-negotiation`, `nested-learning`, `muls`, `orpar-memory`, `dag`, `kg`, `tensorflow`, `twenty-questions`

## Architecture Overview

MXF is a multi-agent collaboration system built with TypeScript, Bun, Socket.IO, and MongoDB.

### Layer Structure

- **SDK** (`src/sdk/`): Agent client (`MxfClient.ts`), modular handlers, managers, services
- **Server** (`src/server/`): Socket.IO real-time services, REST API, dual auth (JWT for users, API keys for agents)
- **Shared** (`src/shared/`): 100+ MCP tools in `protocols/mcp/tools/`, EventBus (RxJS-based), models, services, types, config

### Key Concepts

- **ORPAR Control Loop**: Observation → Reasoning → Planning → Action → Reflection. ORPAR tools are **documentation tools** that record what happened and trigger phase transitions. They must be tool-agnostic.
- **Hybrid Tool System**: Internal tools + external MCP servers unified via `HybridMcpToolRegistry`
- **Channel-Based Communication**: Socket.IO rooms, MXP protocol with AES-256-GCM encryption
- **Task Management**: `pending` → `assigned` → `in_progress` → `completed`
- **Memory**: Three scopes (Agent, Channel, Relationship), multi-level caching, semantic search via Meilisearch
- **MULS**: Memory Utility Learning System — Q-value weighted retrieval with ORPAR phase-specific lambdas
- **ORPAR-Memory Integration** (flag: `ORPAR_MEMORY_INTEGRATION_ENABLED`): Phase-to-strata routing, surprise-driven re-observation, phase-weighted rewards, cycle consolidation. Located in `src/shared/services/orpar-memory/`
- **TensorFlow.js** (flag: `TENSORFLOW_ENABLED`): `MxfMLService` singleton with lazy import. Models: DENSE_CLASSIFIER, AUTOENCODER, LSTM, DQN, REGRESSION, EMBEDDING, TRANSE. Consumers get `number[]` from inference, never tensors. Graceful degradation to heuristics. Events in `TensorFlowEvents.ts`.

### Development Guidelines

- Tools must follow `McpTool` interface in `src/shared/types/toolTypes.ts`
- Events must be added to `EventNames.ts` with handlers
- Use `Logger` from `src/shared/utils/Logger.ts`
- All services use singleton `getInstance()` pattern
- Test files in `tests/` — use existing tests as templates

### Key Environment Variables

```
MONGODB_URI, JWT_SECRET, AGENT_API_KEY, OPENROUTER_API_KEY, PORT (default: 3001)
MEILISEARCH_MASTER_KEY, MEILISEARCH_HOST, ENABLE_MEILISEARCH, ENABLE_SEMANTIC_SEARCH
TENSORFLOW_ENABLED, TENSORFLOW_STORAGE_BACKEND, TENSORFLOW_DEBUG
ORPAR_MEMORY_INTEGRATION_ENABLED, MEMORY_UTILITY_LEARNING_ENABLED
```

See `.env.example` or config files in `src/shared/config/` for full variable listings and defaults.
