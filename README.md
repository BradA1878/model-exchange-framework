# Model Exchange Framework (MXF)

MXF is a TypeScript framework for running agents that share tasks, tools, messages,
and memory through a server. It is developed by Brad Anderson and used as the
foundation of long-running applications, including Sentinel.

The server owns authentication, channel membership, tool permissions, and persisted
task outcomes. The SDK runs each agent's model and tool loop. An application supplies
the agent roles, input data, permitted tools, and rules for using the results.

[Documentation](docs/index.md) · [SDK guide](docs/sdk/index.md) ·
[API reference](docs/api/index.md) · [Framework review](docs/reviews/2026-09-06-framework-review.md)

## What runs today

- Agents communicate through Socket.IO channels. User credentials and agent keys
  have separate roles; channel keys set the maximum tool grant an agent can request.
- Tasks have persisted identities, assignments, progress, and terminal outcomes.
  `task_complete` must be accepted by the server before the SDK treats it as success.
- Built-in tools and registered external MCP processes share discovery and execution
  paths. External process registration requires administrator authority and explicit
  server opt-in. The current registration manager implements stdio transport.
- MongoDB stores application records and persistent agent history. Meilisearch adds
  indexed memory search when configured. Session memory keeps an agent instance's
  working context local without automatically loading or indexing prior history.
- ORPAR records observation, reasoning, planning, action, and reflection. Optional
  SystemLLM operations can contribute analysis and challenge task completions.
- Task DAG operations validate dependencies. Knowledge-graph operations store and
  traverse entities and relationships. Optional TensorFlow.js services provide model
  training, inference, and persistence.
- The CLI provides setup, task execution, and an interactive terminal session. A
  Tauri desktop application is in this repository; the dashboard is a separate package.

These are different levels of machinery. Having a model architecture, a service,
or a demonstration does not establish that it improves an application's results.
The [review record](docs/reviews/2026-09-06-framework-review.md) distinguishes tested
contracts, runtime integrations, and remaining gaps.

## Start with one task

For an application connecting to an existing server:

```bash
bun add @mxf-dev/sdk
```

Use root imports from `@mxf-dev/sdk`. Its supported package API is described in the
[SDK README](packages/sdk/README.md). This checkout uses core and SDK 4.0.0; see the
[upgrade guide](packages/sdk/README.md#upgrading-to-40) before updating a 3.x consumer.

For server development:

```bash
git clone https://github.com/BradA1878/model-exchange-framework.git
cd model-exchange-framework
bun install
bun run mxf install
bun run mxf init
bun run build
```

Setup configures infrastructure and credentials. Follow its output and
[installation guide](docs/getting-started.md). Start the server in a terminal you
control:

```bash
bun run start:dev
```

Keep that terminal open while running clients. SystemLLM makes paid provider calls
when enabled; select its model explicitly in configuration. Its current budget
counter is process-local and checks admission between calls, not a durable account
spending limit.

In another terminal, complete provisioning when needed and run a task:

```bash
bun run mxf install --complete-setup
bun run mxf run "Summarize the supplied evidence and identify unanswered questions" --context ./notes
```

For a recurring application, start with one bounded unit of work, record its actual
task ID and outcome, and retain failures alongside successes. The
[recurring review example](examples/recurring-review/README.md) runs that pattern
with a fresh session for each invocation. Its application owns the schedule and
stores the result.

## Repository map

| Area | Responsibility |
| --- | --- |
| [`packages/core/src`](packages/core/src) | Events, schemas, tools, models, configuration, provider adapters, shared services |
| [`packages/sdk/src`](packages/sdk/src) | Public client API, agent execution, memory and connection lifecycle |
| [`src/server`](src/server) | Authentication, HTTP and socket ingress, task coordination, server tool execution |
| [`src/cli`](src/cli) | Infrastructure setup, configuration, task runner, terminal interface |
| [`src/desktop`](src/desktop) | Tauri application and SDK sidecar |
| [`tests`](tests) | Unit, property, integration, and mutation checks |
| [`examples`](examples) | Applications and demonstrations |

Core is published separately and depends on npm packages rather than the SDK or
server source tree. The SDK depends on core. Core and SDK versions are published
together; the root application version has a separate release cadence.

## Feature boundaries

| Area | Current boundary |
| --- | --- |
| Agent session memory | One agent instance; reconnect retains local context. Explicit memory tools and application storage remain separate. |
| ORPAR memory strata | Process-local collections participate in phase routing. Configuration alone does not provide durable strata storage or enforce every retention setting. |
| Workflow definitions | Public types are available. The internal workflow registry is exercised by tests and is not wired into normal task execution. Use the implemented task, plan, and DAG APIs. |
| P2P and federation | Design material and a task-negotiation demonstration; no shipped cross-server peer transport or federated memory service. |
| Predictive analytics | Event listeners and model code coexist with broken tool-result ingestion and fabricated historical inputs. Do not treat all prediction scores as measured reliability. |
| Provider support | Adapters exist for several providers; adapter presence is not a live conformance test for every provider/model combination. |

Details: [workflow contracts](docs/mxf/workflow-system.md),
[P2P status](docs/mxf/p2p-foundation.md),
[ORPAR memory](docs/mxf/orpar-memory-integration.md),
[task DAG](docs/api/dag-tools.md) and [knowledge graph](docs/api/knowledge-graph-tools.md).

## Validation

```bash
bun run build
bun run test:unit
bun run lint:changed
bun run verify:sdk-package
bun run check:migrations
bun run check:demos
```

`build` includes the CLI type check. `test:unit` includes property tests and does
not require the server. Package verification packs core and SDK, imports them as
an external consumer, and checks their declarations and export boundary.

Integration tests need a server you start and stop yourself:

```bash
bun run test:integration
```

Mutation testing runs separately with `bun run test:mutation`. It covers selected
modules; its score does not describe the whole framework. Passing unit tests also
does not establish live provider behavior, restart recovery, or application quality.

Contributors should read [AGENTS.md](AGENTS.md) for repository conventions and the
verification workflow. New tools use `defineTool`; events use the event definitions,
payload helpers, and EventBus. Tests should exercise production behavior rather
than a copy of the algorithm inside the test.

## Links and license

- [SDK usage and examples](docs/sdk/index.md)
- [Tool reference](docs/mxf/tool-reference.md)
- [Configuration](.env.example)
- [CLI](docs/sdk/cli.md)
- [Issue tracker](https://github.com/BradA1878/model-exchange-framework/issues)
- [Dashboard repository](https://github.com/mxf-dev/dashboard)

Copyright 2024–2026 Brad Anderson. Licensed under [Apache 2.0](LICENSE).
