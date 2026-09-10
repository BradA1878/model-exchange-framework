# Recurring evidence review

This example reads one local text file, creates one assigned task, writes the
actual task ID and terminal outcome as JSON, and disconnects. Run it again for the
next input. Each invocation creates a new agent instance with session memory.
Your application owns scheduling, storing the output, and deciding what to do with it.

It requires a running MXF server, a provisioned channel and agent key whose tool
grant includes `task_complete`, user access credentials, and a provider key. Configure:

```text
MXF_SERVER_URL
MXF_DOMAIN_KEY
MXF_ACCESS_TOKEN
MXF_CHANNEL_ID
MXF_AGENT_ID
MXF_AGENT_KEY_ID
MXF_AGENT_SECRET_KEY
MXF_MODEL
OPENROUTER_API_KEY
```

From this repository, after building core and SDK:

```bash
bun run examples/recurring-review/run.ts ./evidence.txt
```

The example uses the session-memory API available in `@mxf-dev/sdk` 4.0.0 and later.
An external application needs matching core and SDK versions. Do not run concurrent
copies with the same agent identity.

The outcome listener is installed before task creation and binds to the ID returned
by the server. It handles an outcome arriving before the creation response, ignores
other task IDs, and removes all its listeners on completion, failure, cancellation,
creation error, or application interruption. A failed or cancelled task still emits
its real outcome JSON and exits unsuccessfully. Connection and task-creation errors
are logged and exit unsuccessfully. A permanent disconnect after creation leaves
the outcome wait pending until a terminal event arrives or the application is interrupted.

SIGINT/SIGTERM cancel the local wait and disconnect. They do not promise that an
already-issued remote tool or model request was aborted. There is no application
timeout or invented completion. Unit tests exercise event ordering and cleanup;
the packed-package check compiles this example. Running it against a live model
requires the server and incurs provider usage.
