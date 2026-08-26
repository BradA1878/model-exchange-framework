# CLAUDE.md

## IMPORTANT: Brad's Rules

- **No tech-bro speak.** Write plainly. No marketing hype, buzzwords, or hype adjectives ("blazing-fast", "game-changer", "supercharge", "leverage", "10x", "seamless", "robust") — in code comments, docs, commit messages, UI copy, or responses. Say what something does, not how impressive it is.
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

## Model routing

Main session is the architect and the only thing trusted. Subagents are hands. Everything below is scoped to this repo. If a change looks like it needs edits elsewhere, stop and say so instead of reaching.

**Investigate.** Fan out parallel read-only subagents (model chosen to fit the task) to map the territory. Synthesis stays in the main session. Before writing the spec, the main session does its own targeted read of the seams the change touches so the plan rests on first-hand reading, not on someone else's summary.

**Plan.** Main session writes the plan as self-contained task briefs: files in scope, interfaces, conventions to follow, acceptance criteria, do-not-touch list. If a brief needs a follow-up question to execute, it isn't finished. Sequence the work into phases: shared plumbing first >> per-unit fan-out on disjoint files >> adversarial review.

**Implement.** Delegate well-specified mechanical tasks to write-capable subagents (model chosen to fit the task). Parallel only when tasks touch disjoint files, otherwise serialize. Novel, cross-cutting, or judgment-heavy work stays in the main session.

**Checkpoint each phase.** Main session runs the build and tests itself, reads the actual `git diff`, then commits. A subagent saying "done" or "tests pass" is a claim, not evidence. Verify the claim before verifying the work, then verify the work.

**Adversarial review.** Fan out reviewers against the briefs and the diff, looking for missed criteria, stubbed or faked implementations, and regressions. Their findings are leads. Main session confirms each one in the code before acting.

**Final audit.** Main session reads the full diff end to end, runs the whole suite, and checks the result against the original acceptance criteria personally.

**Skip all of this** when the work is a single file with no interface change. Direct work is cheaper than orchestration overhead.

### Verification commands

Build:  bun run build
Test:   bun run test:unit
Lint:   bun run lint:changed    # lints only lines changed since main; `bun run lint` carries a pre-existing backlog and is not a gate
Types:  bun run typecheck && bun run typecheck:cli

"Verify" means running these, not reasoning about whether they would pass.

## Essential Commands

```bash
bun install              # Install dependencies
bun run start:dev        # Dev server (hot-reload)
bun run build            # Build
bun run typecheck:cli    # Typecheck the CLI + TUI (excluded from the main build)
bun run clean            # Clean artifacts
bun run rebuild          # Full rebuild
```

CI (`.github/workflows/ci.yml`) runs, on every push and PR: `bun run build` (`tsc -b` + `typecheck:cli`), `verify:sdk-package` (packs the SDK and compiles a consumer against it), `lint:changed`, `check:migrations`, `check:demos`, and `test:unit:ci`. Mutation testing runs as a separate job.

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

**Demos:** `bun run demo:<name>` where name is: `first-contact`, `fog-of-war`, `interview`, `external-mcp`, `channel-mcp`, `code-execution`, `toon-optimization`, `prompt-compaction`, `inference-params`, `workflow-patterns`, `memory-strata`, `mcp-prompts`, `lsp-code-intelligence`, `p2p-task-negotiation`, `nested-learning`, `muls`, `orpar-memory`, `dag`, `kg`, `tensorflow`, `twenty-questions`, `user-input`

## Architecture Overview

MXF is a multi-agent collaboration system built with TypeScript, Bun, Socket.IO, and MongoDB.

### Layer Structure (Bun workspaces)

- **@mxf-dev/core** (`packages/core/src/`): the publishable foundation — 127 MCP tools in `protocols/mcp/tools/`, EventBus (RxJS-based), models, services, types, config, ConfigManager. ESM-only (NodeNext, `.js` extensions on relative imports). Depends on npm only — never on src/** or @mxf-dev/sdk.
- **@mxf-dev/sdk** (`packages/sdk/src/`): the publishable agent client (`MxfSDK.ts`, `MxfClient.ts`, `MxfAgent.ts`, handlers, managers, services). Depends only on @mxf-dev/core.
- **Server** (`src/server/`): Socket.IO real-time services, REST API, dual auth (JWT for users, API keys for agents). Also hosts the 40 server-coupled MCP tools + HybridMcp services in `src/server/mcp/` and ChannelContext/PatternMemory services. Depends on @mxf-dev/core only. (167 tools are registered in total.)
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

- New tools should be written with the `defineTool` factory in `packages/core/src/protocols/mcp/defineTool.ts`. It validates input against the schema on every entry path, wraps the handler in one try/catch, and emits a single result envelope with an explicit `isError` flag. The underlying contract is `McpToolDefinition` in `packages/core/src/protocols/mcp/McpServerTypes.ts` — **not** `types/toolTypes.ts`, which is a stub and does not define `McpTool`.
- Events must be added to `EventNames.ts` with handlers
- Use `Logger` from `packages/core/src/utils/Logger.ts`
- All services use singleton `getInstance()` pattern
- Test files in `tests/` — use existing tests as templates

### Key Environment Variables

```
MONGODB_URI, JWT_SECRET, AGENT_API_KEY, OPENROUTER_API_KEY, PORT (default: 3001)
LOG_LEVEL (server console log level — error|warn|info|debug|trace, default: info)
MEILISEARCH_MASTER_KEY, MEILISEARCH_HOST, ENABLE_MEILISEARCH, ENABLE_SEMANTIC_SEARCH
TENSORFLOW_ENABLED, TENSORFLOW_STORAGE_BACKEND, TENSORFLOW_DEBUG
MXP_ENCRYPTION_KEY, MXP_ENCRYPTION_SALT (REQUIRED together — opting into MXP encryption without a unique salt fails fast; the CLI now generates a random salt per install)
ORPAR_MEMORY_INTEGRATION_ENABLED, MEMORY_UTILITY_LEARNING_ENABLED, MEMORY_STRATA_ENABLED
```

**Tool sandboxing (required for the tools that touch the machine):**
```
MXF_WORKSPACE_ROOT          REQUIRED for filesystem tools. No default — it used to be $HOME,
                            which let any agent read ~/.ssh, ~/.aws and ~/.mxf/config.json.
MXF_SHELL_ALLOWED_COMMANDS  Optional shell allowlist (e.g. git,npm,node). Config-driven —
                            it used to be a tool argument, i.e. chosen by the model it restricts.
MXF_SHELL_ENV_PASSTHROUGH   Extra env vars to pass to shell children. Children otherwise get a
                            stripped env; they used to receive the full server environment,
                            including JWT_SECRET and OPENROUTER_API_KEY.
MXF_HTTP_ALLOW_PRIVATE_HOSTS  Default false. api_fetch refuses loopback/RFC1918/metadata hosts.
MONGODB_LENS_URI            Deliberately NOT MONGODB_URI — give it a read-only user on a
                            separate database, so agents can't query users/PATs/API keys.
```

**Spend and auth:**
```
SYSTEMLLM_DEFAULT_MODEL     Required when SystemLLM is on — there is no built-in model, and
                            the server refuses to boot without it.
SYSTEMLLM_MODEL_<OPERATION> Per-operation override — OBSERVATION, REASONING, ACTION, PLANNING,
                            or REFLECTION — replaces the default model for that one operation.
SYSTEMLLM_DAILY_BUDGET_USD  Daily SystemLLM ceiling (default 10). Calls are refused past it.
SYSTEMLLM_BUDGET_WARN_AT    Warning threshold as a fraction of the ceiling (default 0.8).
SYSTEMLLM_STANCE            supportive (default) | critical | hostile. critical challenges unsupported
                            claims, plans, and completions from evidence; hostile is a disclosed test
                            mode that sends wrong ones on purpose. An unknown value fails boot.
SYSTEMLLM_STANCE_MAX        Ceiling on every channel's effective stance (default hostile, no ceiling).
                            supportive turns challenges off server-wide; critical keeps hostile out.
MXF_WEBHOOK_ENABLED         n8n webhook routes are unmounted unless this is true.
MXF_WEBHOOK_SECRET          Required when webhooks are enabled — HMAC signing key. Fails fast.
MAGIC_LINK_WEBHOOK_URL      Where magic links are delivered. The token is never returned in
                            the HTTP response any more.
AUTH_RATE_LIMIT_MAX / WEBHOOK_RATE_LIMIT_MAX   Per-IP rate limits on auth and webhook routes.
```

**LLM request bounds (OpenRouter):**
```
OPENROUTER_REQUEST_TIMEOUT_MS      Hard cap per completion request (default 300000). Enforced as an
                                   AbortSignal on the fetch and again inside NetworkRecovery. A timeout
                                   is a non-retryable error surfaced to the caller — before this, a hung
                                   request was pure silence until a consumer-side backstop killed the task.
OPENROUTER_STREAM_IDLE_TIMEOUT_MS  Max silence between SSE chunks on the streaming path (default 120000).
                                   OpenRouter sends keepalive comments while a model thinks, so silence
                                   past this means a dead connection, not a slow model. No total-time cap:
                                   an actively producing stream is healthy no matter how long it runs.
OPENROUTER_SLOW_REQUEST_WARN_MS    WARN when a request is still in flight past this (default 60000), with
                                   model, agent, and request size — makes slow-vs-hung visible in logs.
```

**SDK request bounds (agent socket):**
```
MXF_MEMORY_REQUEST_TIMEOUT_MS      Max wait for the server's answer to a memory save or load, or to a
                                   search-index request (default 60000). A request settles on the answer,
                                   on a socket drop, or on cancellation — while the socket stays up and the
                                   server stays silent nothing else settled it, and disconnect() waits on
                                   queued saves, so a server that stopped answering held disconnect() open
                                   for good. Past the bound the request fails loudly and is not retried; a
                                   silent index request ends the drain and the queue is re-indexed from
                                   persisted history at the next memory load.
MXF_MEMORY_BACKFILL_TIMEOUT_MS     Max wait for the server's answer to one backfill batch (default 300000).
                                   The server indexes a batch one message at a time — an embedding call
                                   and a Meilisearch task wait each — so a full 50-message batch takes far
                                   longer than one live request and gets its own bound. A silent batch
                                   ends the backfill; it is reported like any other backfill failure and
                                   cannot fail connect().
```

See `.env.example` or config files in `packages/core/src/config/` for full variable listings and defaults.

## Boy Scout rule

Leave every file cleaner than you found it, and fix real bugs wherever you
find them.

**Cleanup - scoped to files you're already in.** Dead code, stale comments,
misleading names, unused imports, lint noise, formatting drift. Cleanup never
changes behavior: tests pass before and after, same API, same output. No
refactoring crusades - don't restructure working code because you'd have
written it differently.

**Bugs - fix them even when unrelated to the task.** A bug is observably wrong
behavior: wrong output, crash, race, leak, off-by-one, unhandled failure path.
Code you merely dislike is not a bug. If the fix is small and you're confident,
fix it, add or update a test that proves the bug existed and is gone, and put
it in its own commit. If it's large, risky, or you're not certain the behavior
is wrong, leave a TODO with context and flag it instead of fixing it.

**Surface everything.** Every out-of-scope fix and every flagged suspicion goes
in your summary. A silent behavior change buried in a feature diff is worse
than the bug it fixed.

**Keep the diff legible.** Ride-along cleanup is fine, but bug fixes get their
own commits, and anything that would drown the actual change gets split out.
