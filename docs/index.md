# Model Exchange Framework (MXF) Documentation

MXF runs agents that share tasks, tools, messages, and memory through a server.
The server owns authentication, channel membership, tool permissions, and persisted
outcomes. The SDK runs each agent's model and tool loop. Applications supply the
roles, evidence, permitted tools, and rules for using the results.

## Start here

- [Getting started](getting-started.md): install and configure MXF.
- [SDK guide](sdk/index.md): connect an application and create agents.
- [Core and SDK 4.0 upgrade guide](../packages/sdk/README.md#upgrading-to-40):
  changed persistence and reconnect contracts, plus the new session-memory option.
- [Agent memory lifetime and task outcomes](sdk/session-memory.md): persistent
  versus session memory, task identity, and authenticated reconnects.
- [Recurring evidence review example](../examples/recurring-review/README.md):
  one input file, one task, the actual terminal outcome, and connection cleanup.
- [Framework review](reviews/2026-09-06-framework-review.md): implemented fixes,
  remaining defects, test results, and the limits of that evidence.

## What is MXF?

Core, SDK, and server have separate responsibilities:

| Component | Responsibility |
| --- | --- |
| `@mxf-dev/core` | Events, payload schemas, shared types, provider adapters, tools, configuration, and services |
| `@mxf-dev/sdk` | Application client, agent execution, local context, memory synchronization, and reconnect handling |
| Server | HTTP and Socket.IO ingress, authentication, channel and tool access, task coordination, and persistence |
| CLI | Provisioning, configuration, interactive sessions, and task execution |
| Desktop | Tauri application with a local SDK sidecar |
| Dashboard | Separate `@mxf-dev/dashboard` package connecting to the server |

Core and SDK are published together; this checkout uses 4.0.0. The root application
version has a separate release cadence. Use SDK root imports in applications and
read the upgrade guide before moving a 3.x consumer to 4.0.

## Current feature boundaries

These distinctions matter when choosing an API for a running application. A service,
model architecture, or demonstration alone does not establish an end-to-end contract.

| Area | Implemented behavior and remaining limits |
| --- | --- |
| Tasks and tools | Task identities, assignments, and outcomes are persisted. Tool grants are enforced by the server. Failed tool execution remains a failure over HTTP and sockets. |
| Session memory | `memoryMode: 'session'` keeps SDK-managed history in one agent instance without automatic remote loading, saving, backfill, or indexing. Reconnect retains that context; a new instance starts empty. Explicit memory tools and application storage remain independent. |
| Task lifecycle | One accepted task owns an agent's execution context. Older asynchronous responses cannot mutate a successor task. Local cancellation does not guarantee that an issued provider request or remote tool was aborted. |
| Memory utility | Retrieval blends relevance with learned Q-values. Persistence reads and writes are paired; cache admission is bounded and preserves unpersisted rewards. This is not evidence of improved application decisions. |
| ORPAR memory strata | Phase routing uses process-local collections. Configuration alone does not provide durable strata storage or enforce every retention setting. |
| Workflows | Definitions and an internal execution engine exist. The engine is tested but is not wired into normal task execution. Use the implemented task, plan, and DAG APIs. |
| P2P and federation | Design material and a task-negotiation demonstration exist. Cross-server peer transport and federated memory are not shipped. |
| Predictive analytics | Event listeners and model code exist, but tool-result ingestion is broken and some historical inputs are fabricated. Prediction scores must not be presented as measured reliability. These issues remain open after the review. |
| TensorFlow.js | Optional model training, inference, and persistence are implemented. Their presence does not establish that every analytics consumer receives real observations or produces validated predictions. |
| SystemLLM spending | Usage is recorded, including charged responses with unusable content. The daily budget counter is process-local and checks admission between calls; it is not a durable account spending limit. |
| Provider support | Adapters exist for multiple providers. Mocked request and response tests do not replace live conformance checks for each provider and model. |

The [review record](reviews/2026-09-06-framework-review.md) contains the source
locations, consequences, and verification limits behind these findings. Older design
and feature documents should be read alongside these current boundaries.

## Quick start

For an application connecting to an existing MXF server:

```bash
bun add @mxf-dev/sdk
```

The SDK is ESM-only and supports Bun >= 1.2 or Node.js >= 20.19. Follow the
[SDK guide](sdk/index.md) for credentials and agent configuration. The
[recurring review example](../examples/recurring-review/README.md) provides a
complete task-outcome pattern and is compiled by the packed-package check.

For server development:

```bash
git clone https://github.com/BradA1878/model-exchange-framework.git
cd model-exchange-framework
bun install
bun run mxf install
bun run mxf init
bun run build
bun run start:dev
```

Follow the setup output and [installation guide](getting-started.md). Keep the server
in a terminal you control. SystemLLM makes paid provider calls when enabled; select
its model explicitly. In another terminal, complete provisioning if needed:

```bash
bun run mxf install --complete-setup
bun run mxf run "Summarize the supplied evidence and identify unanswered questions" --context ./notes
```

## Documentation structure

### SDK, API, and tools

- [SDK reference](sdk/index.md), [authentication](sdk/authentication.md), and [examples](sdk/examples.md)
- [Configuration](sdk/config-manager.md), [managers](sdk/managers.md), and [handlers](sdk/handlers.md)
- [Event system](sdk/events.md) and [MCP integration](sdk/mcp.md)
- [REST and WebSocket APIs](api/index.md): [channels](api/channels.md), [agents](api/agents.md), [tasks](api/tasks.md), and [memory](api/memory.md)
- [Tool reference](mxf/tool-reference.md) and [extensibility](mxf/extensibility.md)
- [Interactive CLI](mxf/interactive-cli.md) and [dashboard](dashboard/index.md)

### Memory, graphs, and execution

- [Session memory and task outcomes](sdk/session-memory.md)
- [Meilisearch integration](meilisearch-integration.md) and [user memory](mxf/user-memory.md)
- [Memory utility learning](mxf/memory-utility-learning.md), [ORPAR memory routing](mxf/orpar-memory-integration.md), and [nested learning](mxf/nested-learning.md)
- [Task DAG tools](api/dag-tools.md) and [knowledge graph tools](api/knowledge-graph-tools.md)
- [Workflow implementation status](mxf/workflow-system.md) and [P2P implementation status](mxf/p2p-foundation.md)
- [Code execution](mxf/code-execution.md), [shell execution](mxf/shell-execution.md), and [LSP integration](mxf/lsp-integration.md)
- [Database abstraction](mxf/database-abstraction.md) and [architecture](mxf/index.md)

### Context, transport, and analytics

- [Compaction pipeline](mxf/compaction-pipeline.md), [prompting](mxf/prompting-enhancements.md), and [prompt auto-compaction](mxf/prompt-auto-compaction.md)
- [Dynamic inference parameters](mxf/dynamic-inference-parameters.md) and [TOON encoding](mxf/toon-optimization.md)
- [MXP protocol](mxf/mxp-protocol.md), [technical specification](mxf/mxp-technical-specification.md), and [configuration](sdk/mxp-config.md)
- [Analytics documentation](analytics/index.md), [MXP monitoring](mxf/mxp-monitoring.md), and [troubleshooting](mxf/mxp-troubleshooting.md)
- [Validation](mxf/validation-system.md), [validation API](api/proactive-validation.md), and [auto-correction API](api/auto-correction.md)

Analytics, workflow, and P2P links include existing design and implementation detail;
their current runtime limits are stated above and in the review.

### Operations and development

- [Docker deployment](deployment.md) and [security](mxf/security.md)
- [System overview](mxf/system-overview.md) and [key concepts](mxf/key-concepts.md)
- [Repository examples](../examples) and [framework review](reviews/2026-09-06-framework-review.md)
- [Report an issue](https://github.com/BradA1878/model-exchange-framework/issues)

Build and run the unit/property suite without starting a server:

```bash
bun run build
bun run test:unit
bun run lint:changed
bun run verify:sdk-package
```

Integration tests require a server started manually. Provider and demonstration runs
may make paid model calls. See the review for which checks were actually run; passing
unit tests does not establish live integration or prediction accuracy.
