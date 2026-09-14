# Empty Prompt implementation plan

The Empty Prompt handoff dated September 9, 2026 adds opt-in controls for
operator-only prompts, message-driven turns, observable provider requests,
and server isolation. Existing defaults remain unchanged. The implementation
lives in MXF; the experiment repository consumes the published packages.

## Shared contracts

Add `promptMode`, `activation`, `circuitBreakerEnabled`, and
`captureLlmRequests` to the public creation config and core agent config.
Validate modes and booleans at both SDK creation and direct agent construction.
Bare mode requires a nonblank operator prompt, preserved byte for byte, and
rejects MXP and message aggregation. Message activation rejects aggregation.
Message iteration limits must be positive integers.

Carry prompt mode on AgentContext. Put optional `requestId` and `activationId`
on the event envelope so existing string-valued LLM response data stays intact.
Define LLM_REQUEST, ITERATION_LIMIT, and HISTORY_TRIMMED and payload helpers,
and expose them through PublicEvents. Usage data gains request correlation,
actual provider route/cost when supplied, measured latency, and finish reasons.

Provider request options carry a typed observation callback. Each HTTP attempt
gets its own UUID; the adapter observes a copy of its serialized JSON body
immediately before sending it. Observers cannot mutate the sent body. Response
metadata preserves the attempt ID separately from the provider response ID.
Unsupported capture fails explicitly; it must never report SDK parameters as
an exact wire body. No synthetic cost, route, or token usage is introduced.

Acceptance: invalid combinations fail before connecting; defaults retain
existing behavior; payload helpers preserve string response data and tool
correlation; public declarations compile from packed packages.

## SDK work

Provider adapters own native wire formatting and request observation. Every
adapter omits framework identity/task/action blocks in bare mode, preserves
real dialogue and tool pairing, and uses only `[sender]: ` attribution for
received messages. Tool definitions retain their registry descriptions.

The main session owns MxfAgent's activation lifecycle. A message activation
has an independent UUID and permits one running turn plus one coalesced pending
turn. Reserve pending work before asynchronous persistence yields. Dedupe both
DMs and channel messages by canonical message ID and filter shared EventBus
traffic by owner/channel. Native no-tool responses end message turns; tool
responses continue to the configured limit. Limit exhaustion emits only its
event. Keep task generation, cancellation, and response-drain behavior intact.

Prompt/context managers bypass framework assembly, template replacement,
compaction restoration, and reminders in bare mode. The event handler stores
incoming dialogue once and drops framework/SystemLLM metadata. Tool failures
stay in tool messages without instructional rewrites or deferred user turns.
Empty arguments reach server validation; empty results remain empty. The
circuit switch disables both tracking and intervention. History trimming emits
the actual removed IDs without changing grouping.

Acceptance: wire-body assertions using real adapters and controlled transports;
one request for an idle received message; self messages ignored; arrivals during
a turn cause exactly one follow-up; identical-ID deliveries persist once; all
LLM/tool events retain their activation ID; late paid responses still report
usage without writing stale history. Existing task/cancellation tests pass.

## Server work

Correction-disabled validation returns the server error without correction or
pattern learning. Persist actual tool executions only after authorization and
validation, with awaited start/terminal recording for socket and HTTP calls.
Rejected calls create no execution document. Correlation travels through the
existing tool events, without duplicate emissions.

ChannelMemory.conversationHistory becomes the single new-write history store.
An explicit idempotent migration copies legacy Channel.sharedMemory history,
deduplicating message IDs; no read fallback or dual write. Preserve object
content and original IDs/timestamps/DM parties. A user-only owner/admin REST
publish operation persists and emits one ordinary channel message, attributed
to username. Parties-only visibility filters before pagination/counting at all
agent-readable history/memory boundaries, including cached memory and REST;
derived context that cannot be safely projected must not disclose private DMs.

Agent filesystem roots use a pinned installed filesystem MCP package and
trusted operator configuration. Validate all absolute template-expanded roots
before admission, reject traversal in agent IDs and conflicting global roots,
await readiness before acknowledging a join, reserve the agent server namespace,
and stop processes immediately on leave/disconnect, including startup races.
Keep existing caller-controlled stdio permissions. Explicit autostart lists are
validated; an empty list starts none of the predefined servers. Agent filesystem
servers are controlled independently. Preserve scoped tool resolution and raw
MCP denial errors.

MXP_ENABLED=false removes messaging MXP schema fields, ignores supplied MXP
options, and bypasses message processing and forwarding encryption. Optional
intelligent assignment can be disabled without SystemLLM calls.

Acceptance: owner/admin REST success and other identities rejected; seed and
ordinary broadcast each stored/delivered once; real DM conversion retains tags;
nonparties cannot read DMs through any allowed memory route; malformed calls
have no execution record; two real filesystem child servers enforce private and
shared roots and terminate on disconnect. No MXF server or paid model starts
during verification.

## Phases, ownership, and release

1. Shared config/events/request contracts and contract tests. Main reviews the
   diff and runs build/unit/lint before committing.
2. Disjoint writers handle provider adapters, prompt/context/history handling,
   and server execution/configuration units. Main implements activation and
   caller-visible ownership. Each brief names files, interfaces, tests, and
   exclusions. Storage and filesystem changes follow in separate units.
3. Adversarial reviewers compare the actual diff against the handoff and this
   plan. Main confirms findings in code, fixes them, and reads the full diff.
4. Update API/configuration/prompt docs and docs/index.html. Run build, unit
   tests, changed-line lint, package consumer verification, migration and demo
   checks. Live integration needs Brad's manually started server.
5. Merge to main, push, publish core then SDK in lockstep, verify a fresh registry
   consumer, run sync-to-public.sh, and return the version and public SHA.
   Commit bodies explain behavior, rationale, compatibility, and validation;
   the public mirror commit describes the entire release.

Do not edit the experiment, Sentinel, user-owned CLAUDE.md changes, or the
untracked backfill handoff. Do not add prompt instructions, fabricated analytics,
fallback transports, retries, or arbitrary delays to satisfy these tests.
