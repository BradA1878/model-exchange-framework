# MXF framework review and implementation record

## Scope

Review the shipped core, SDK, server, tool system, providers, CLI, desktop,
configuration, persistence, tests, packaging, examples, and documentation.
Distinguish reachable runtime behavior from services exercised only by tests or
demonstrations. Sentinel is the concrete consumer used to validate SDK contracts;
its application changes belong in the simulacria.ai repository, never its MXF clone.

The review includes the previously identified lifecycle, task-outcome, trace,
property-test, and documentation changes. Large or uncertain findings require a
record of evidence and impact rather than an unverified rewrite.

## Baseline

- `bun run build`: passed.
- `bun run test:unit`: 238 suites, 3,346 tests passed.
- The server was not started. External LLM calls were disabled for unit tests.
- Existing user changes in both repositories' `CLAUDE.md` and the existing
  backfill handoff document are outside this change.

## Implementation briefs

### 1. Shared SDK contracts

Files: core `interfaces/AgentInterfaces.ts`, `events/event-definitions/SdkEvents.ts`,
`schemas/EventPayloadSchema.ts`; SDK `MxfSDK.ts`, `index.ts`,
`managers/MxfMcpClientManager.ts`, and their unit tests.

- Add `memoryMode: 'persistent' | 'session'`, defaulting to persistent. A session
  means one agent instance; creating a new agent starts empty. Transport reconnects
  retain that instance's local working memory.
- Forward the existing `backfillSearchIndexOnLoad` and provider-specific options
  through the public creation and provider initialization paths.
- Repair the existing authenticated reconnect event: isolate SDK instances even
  when they authenticate as the same user, and ignore duplicate authentication.
- Reconfigure a provider against the previous configuration, not an already
  overwritten copy. Invalid updates must not corrupt a working configuration.
- Use existing event definitions, payload helpers, EventBus, and static imports.

Acceptance: real public creation options reach their consumers; same-user SDK
instances cannot receive one another's reconnect notifications; initial or repeated
authentication is not a reconnect; provider replacement is observable in tests.
Do not touch server authorization or Sentinel in this phase.

### 2. Agent memory and task ownership

Files: SDK `MxfAgent.ts`, `managers/MxfMemoryManager.ts`,
`managers/MxfTaskExecutionManager.ts`, `handlers/TaskHandlers.ts`, and SDK tests.

- Session memory never automatically loads, saves, backfills, or indexes agent
  conversation history, and never constructs a search client. It still supports
  local conversation/observation/plan APIs and reports initialization truthfully.
- Keep local state bounded without accumulating persistence revisions or an
  unbounded authoritative snapshot when persistence is disabled.
- Make the task manager own accepted task identity. Reject an overlapping task
  before it can replace active state. Capture execution identity across asynchronous
  work so a stopped task cannot write into or report for a subsequent task.
- Preserve persistent-memory behavior and explicit application storage/tool use.

Acceptance: session creation works with stale server history and no search
credentials; reconnect preserves local context; a second agent instance starts
empty; delayed work from task A cannot mutate task B; overlapping admission fails
explicitly. Tests must exercise production managers and event handling.

### 3. Production property checks and bounded core defects

Files: `tests/property/knowledge-graph.property.test.ts`,
`tests/property/qvalue.property.test.ts`, core `services/QValueManager.ts`,
`services/StratumManager.ts`, server `services/WorkflowExecutionEngine.ts`, and
focused service tests.

- Replace test-local graph algorithms and EMA updates with production operations;
  mock persistence boundaries rather than reimplementing algorithms under test.
- Enforce the configured Q-value cache bound during reward updates.
- Respect an explicit zero decay rate, validating invalid numeric inputs.
- Give each workflow execution independent initial state, including nested data
  and Maps. Document the engine's actual integration status.

Acceptance: regressions fail on the original behavior; property tests can catch a
production algorithm mutation. Do not change assertion thresholds to accept errors.

### 4. Tool boundaries and authoritative results

Files: core `protocols/mcp/security/McpToolPolicy.ts`,
`protocols/mcp/tools/JsonTools.ts`; server `api/controllers/mcpController.ts`,
`api/routes/n8nWebhooks.ts`; focused security/controller/route tests.

- Refuse dangling symlink paths that would redirect a workspace write outside it.
- Reject prototype-related JSON path segments and build nested paths consistently.
- Preserve explicit tool failure in HTTP responses instead of returning success.
- Create explicitly assigned webhook tasks through the authoritative TaskService
  assignment path. Remove redundant assignment and malformed task-request events.

Acceptance: tests prove no outside write/prototype mutation, HTTP failures remain
failures, and webhook assignment happens once with accurate returned state. Preserve
authentication, key grants, and schema validation.

### 5. Sentinel adoption

Files in simulacria.ai: `mxf/sentinel/src/mxf/{setup,tasks,events,reasoning-capture}.ts`,
their tests, and relevant Sentinel documentation.

- Use the public authenticated reconnect callback and session-memory option.
- Remove direct writes to MXF's memory collection.
- Correlate outcomes by framework task ID, handle completed/failed/cancelled
  outcomes, and dispose pending listeners on task creation failure or teardown.
- Preserve partial traces with explicit terminal status, including failure and
  timeout, and drain persistence on orderly shutdown.

Acceptance: late events cannot settle another run; real failures surface promptly;
failed runs retain diagnostic evidence; no private SDK/socket/database access is
needed for the agent lifecycle. Do not alter decision policy, external messaging,
broker behavior, deployment configuration, or the nested framework clone.

### 6. Broader findings, documentation, and final verification

Review all remaining subsystems, including analytics, startup/shutdown, provider
adapters, event transport, CLI/desktop, packaging, and public claims. Confirm each
reviewer's finding in the implementation before fixing it or recording uncertainty.
Use actual recorded observations for analytics; do not invent histories or confidence.

Update the SDK guides and README around executable behavior and a small recurring
agent workflow. Record dormant or incomplete integrations plainly. Do not publish
an SDK version, sync the mirror, or deploy Sentinel as part of local verification.

The main session runs the build, full unit/property suite, changed-line lint,
package-contract verification, and relevant migration/demo checks on the final code.
Sentinel changes also require its build/typecheck and test suite. Integration checks
requiring a server remain separate from these checks; only Brad starts the server.

## Review results

Reviewed September 6–10, 2026. This is a repository-wide assessment with targeted
source reads, regression tests, and package checks. It is not a claim that every
line or every provider/model combination was audited. No server, broker, or paid
model was started for this review.

### Assessment

MXF has a useful foundation: authenticated channels, persisted task identities,
server-enforced tool grants, a shared event vocabulary, and an SDK that separates
application roles from framework execution. Sentinel demonstrates why those pieces
matter together. One developer using a framework for a real, continuing application
is meaningful evidence of usefulness even without outside adoption.

The principal weakness is uneven maturity. The ordinary task/tool path has concrete
contracts and substantial tests. Some surrounding subsystems expose similarly
confident interfaces while using placeholder inputs, process-local state, or services
that are not connected to runtime execution. That increases the cost of understanding
which guarantees an application can depend on. Broad interfaces, pervasive singleton
state, and large lifecycle classes also make small changes cross several owners.

The most valuable direction is to make Sentinel's recurring workload the reference
contract: fresh context, one accepted task identity, accurate terminal outcomes,
retained failures, bounded memory, truthful usage, and explicit recovery behavior.
Use that workload to decide which abstractions earn their maintenance cost. New
users would benefit most from one small executable example and clear feature
boundaries; feature counts alone do not establish reliability or application value.

### Coverage

| Area | Source and evidence inspected | Limit |
| --- | --- | --- |
| Core/package boundary | Package exports, workspace dependencies, declarations, packed consumer verification | Core still has a broad dependency surface; this is a packaging tradeoff, not itself a defect |
| SDK | Public creation, authenticated reconnects, memory load/save/indexing, task admission, prompt preparation, asynchronous event and model handling | Remote model/tool cancellation and live reconnect were not exercised |
| Server | Startup/shutdown, socket ingress, HTTP routes, task assignment/completion, user input, tool result envelopes | Lifecycle tests exercise production coordination helpers, not a live import of the full server entrypoint |
| Auth/tool security | User versus agent credentials, key grants, channel scoping, feature gates, filesystem policy, JSON paths, external MCP registration | No penetration test or live DNS-rebinding attempt |
| Memory and learning | Production Q-value updates, persistence wiring, retrieval weighting, strata, graph traversal, TensorFlow model/persistence tests | No claim of measured improvement in decision quality |
| Providers/SystemLLM | Request builders, installed Gemini SDK serialization, result conversion, usage accounting and budget lifecycle | Mocked transport; live provider conformance remains separate |
| CLI/desktop | Session creation, model selection, persisted agent preferences, cancellation, desktop session IPC | No end-to-end GUI exercise |
| Workflow/P2P | Definitions, registry callers, examples, public documentation | No shipped cross-server federation or normal workflow-engine dispatch found |
| Sentinel | Task runner, terminal subscriptions, capture/storage/indexing, matrix identity binding, shutdown, current tests | Helper tests do not replace a live recurring-cycle test or route-level matrix race test |

### Implemented corrections

- **SDK lifetime and ownership:** public session memory; forwarded backfill/provider
  options; authenticated reconnect isolation; transactional provider replacement;
  one task owner; overlap rejection before publication; stale asynchronous work
  fenced from later tasks; reconnect prompt reuse; cancellation/cleanup admission.
- **Sentinel:** session memory replaces direct MXF collection wipes; outcomes match
  returned task IDs; failed/cancelled/timeout captures retain partial evidence;
  per-attempt identities avoid overwriting retries; completed-only corpus consumers;
  matrix/task binding; pending task and persistence draining at shutdown. The newer
  September 9 feed-watcher budget and GDELT cooldown changes remain intact.
- **Persistence and algorithms:** bounded Q-value admission, ordered writes,
  hydration under the same per-memory queue, and cache-miss reloads. Admission or
  shrinking fails when dirty or pending entries occupy capacity, preserving those
  rewards. Explicit zero decay and retrieval relevance are retained; graph
  enumeration preserves longer valid simple paths; workflow executions clone nested
  initial state. Property tests now call production graph and Q-value code instead
  of copies of those algorithms.
- **Tool boundaries:** dangling symlink rejection; reserved JSON path rejection and
  correct nested creation; external transport validation before process launch;
  malformed transport returns HTTP 400; tool failure remains failure over HTTP;
  webhook assignment uses the authoritative task path once.
- **Server lifecycle:** startup work is tracked through shutdown; readiness guards
  admission; user-input shutdown prevents late requests from recreating timers.
  Memory-utility initialization now precedes its enabled check and persistence
  registration; the previous order skipped the store on a cold enabled startup.
- **Desktop storage:** save/load/delete validate session IDs as single filename
  components and reject existing or dangling symlink targets. This closes the
  direct `../config` path escape through local IPC; path checks are still a
  non-atomic preflight, not protection against concurrent filesystem replacement.
- **Provider contracts:** explicit temperature zero reaches provider requests;
  Gemini uses the installed SDK request envelope, preserves system instructions
  beside tools, converts text once, and reads reported usage. Missing/invalid Gemini
  usage now fails explicitly because the MCP response contract requires numeric
  counts. SystemLLM records reported usage even when the returned content is unusable.
- **Documentation:** clarified AGENTS.md rules and verification, replaced unsupported
  README/P2P claims, documented workflow integration limits, and added a recurring
  task example compiled against packed packages.

### Remaining findings, ordered by practical impact

**1. Predictive analytics can report scores derived from invented inputs.**
[`PredictiveAnalyticsService`](../../packages/core/src/services/PredictiveAnalyticsService.ts)
returns fixed agent metrics (`getAgentMetrics`), typical tools (`getAgentBehavior`),
latency history (`getPerformanceHistory`), and a constant pattern match. Its live
`TOOL_RESULT` listener reads `event.toolName`, `event.parameters`, and `event.success`,
while [`McpSocketExecutor`](../../src/server/socket/services/McpSocketExecutor.ts)
emits the canonical `event.data.toolName/callId/result` envelope. The missing success
field is interpreted as an error. Its prediction cache also omits channel identity
and retains expired keys until service cleanup. This service is initialized at server
startup and exposed through predictive tools. It needs an explicit observation
schema, truthful unavailable-data behavior, bounded scoped caching, and tests from
canonical events through predictions. Renaming a field alone would leave invented
features in place, so this review records the larger repair rather than claiming it
is complete. Do not use these scores as measured reliability.

**2. Cancellation does not reliably stop underlying work or spending.**
`McpSocketExecutor.cancelExecution()` removes tracking and emits an error, but does
not abort the promise returned by the tool handler. That handler can still finish
and cause side effects. Similarly,
[`OpenRouterMcpClient`](../../packages/core/src/protocols/mcp/providers/OpenRouterMcpClient.ts)
does not connect observable teardown to an abort of its request. The SDK changes
prevent stale results from mutating a later task; they do not cancel remote work.
An end-to-end cancellation contract must carry cancellation through provider and
tool implementations and define what happens to already-completed side effects.

**3. Host output buffering is not bounded by the configured result limit.**
[`ContainerExecutionManager`](../../packages/core/src/services/ContainerExecutionManager.ts)
appends all container stdout/stderr to host strings before checking `maxOutputSize`.
It then truncates stdout before parsing the JSON result, which can make valid large
output unparsable; stderr remains unbounded. Fixing this needs bounded collection
and an explicit oversized-result protocol, with a real container regression. This
review did not start containers or claim the sandbox protects host output memory.

**4. SystemLLM's budget is a process-local admission check.**
[`SystemLlmBudgetService`](../../src/server/socket/services/SystemLlmBudgetService.ts)
starts its spent counter at zero, records usage after calls finish, and does not
reserve for concurrent calls. Restarting resets the counter; concurrent admitted
calls can exceed the stated ceiling. Calls without usable usage evidence cannot be
priced accurately. A durable spending limit requires persisted accounting and a
defined concurrency policy. The README now describes the existing boundary.

**5. Network and file checks have concurrency limits.**
[`McpToolPolicy`](../../packages/core/src/protocols/mcp/security/McpToolPolicy.ts)
checks resolved addresses before a separate fetch/browser connection; it does not
pin that connection to the checked address. DNS rebinding is therefore a potential
gap, not a demonstrated exploit here. Filesystem path checks likewise do not make
later path use atomic. [`JsonTools`](../../packages/core/src/protocols/mcp/tools/JsonTools.ts)
also performs read/modify/write without cross-call serialization; concurrent appends
can lose updates. Addressing these needs connection and storage ownership, not a
claim that preflight validation eliminates races.

**6. CLI/desktop settings can disagree with running agents.**
[`InteractiveSessionManager.setDefaultModel`](../../src/cli/tui/services/InteractiveSessionManager.ts)
changes the displayed default while connected agents retain the model supplied at
creation. [`App.tsx`](../../src/cli/tui/App.tsx) and the
[`desktop bridge`](../../src/desktop/sidecar/bridge.ts) treat absent built-ins as newly
added and reenable them, including deliberately disabled agents. The desktop write
also replaces sibling agent settings such as model overrides. Repair requires a
defined distinction between new and intentionally disabled agents and a model-change
policy for active tasks and per-agent overrides.

**7. Several memory/workflow promises remain integration work.**
[`StratumManager`](../../packages/core/src/services/StratumManager.ts) uses process-local
maps and fixed capacity constants; configuring retention fields does not enforce
all of them. No production caller of `applyDecay()` was found. Phase routing is
connected, but this does not make strata durable or prove an automatic retention
cycle. [`WorkflowExecutionEngine`](../../src/server/services/WorkflowExecutionEngine.ts)
has a tested internal registry without ordinary task dispatch. P2P material does
not correspond to a shipped peer transport. The public documentation now separates
these from implemented task, plan, and DAG behavior.

**8. Recovery and application quality need direct evidence.**
The suite does not establish replay after a process dies between persisted task
state and event delivery, nor live recovery after a provider or server failure.
Orderly shutdown still depends on awaited initializers and external operations
settling. Sentinel capture writes report persistence failures but are not a durable
write-ahead queue; a process crash can lose an in-flight capture. Failed captures
are retained for diagnostics and excluded from the completed corpus. These are
explicit limits, not assertions that a particular production loss occurred.

### Validation record

The main session ran these checks on the completed implementation:

| Check | Result |
| --- | --- |
| `bun run build` | Passed; includes core/server and CLI type checks |
| `bun run test:unit` | 253 suites, 3,534 tests passed |
| `bun run lint:changed` | Passed, zero errors and zero warnings |
| `bun run verify:sdk-package` | Passed runtime imports, strict consumer declarations, private-subpath rejection, and recurring-example compilation |
| `bun run check:migrations` | Passed for 3 migrations |
| `bun run check:demos` | Passed for 22 root demos and 4 owned game launchers |
| QValueManager mutation check | Gate passed at 63.07% against the unchanged 38% threshold; 225 killed, 9 timed out, 90 survived, 47 uncovered, 1 errored mutant |
| Desktop `cargo test --offline` | 3 Rust tests passed |
| Sentinel `bun test` | 1,546 tests across 85 files passed on the current application tree |
| Sentinel with final packed core/SDK | TypeScript build and all 1,546 tests passed in an isolated consumer |

Sentinel was refreshed against commit `44ef58c`, including its September 9 changes.
Application changes are committed in simulacria.ai as `915c9ed`. The isolated
consumer used the application's dependency versions and its actual test preload,
dashboard fixtures, and root provisioning-script fixture. It did not change the
installed SDK, package manifests, lockfiles, or the nested framework clone.

**Release boundary:** Sentinel's installed 3.2.3 SDK does not declare `memoryMode`.
Its normal build therefore reports the two new option usages until matching core
and SDK packages are released/adopted. The isolated package build establishes source
compatibility, not deployment readiness with the old installed package. No package
was published, mirror synced, or application deployed in this work.

Live integration, provider conformance, broker operations, and abrupt process-recovery
tests were not run. Unit regressions and source inspection do not establish those
behaviors. Existing test assertions and mutation thresholds were not relaxed.
The mutation result is limited to QValueManager; its surviving, uncovered, and
errored mutants remain coverage limitations, not a framework-wide reliability score.
