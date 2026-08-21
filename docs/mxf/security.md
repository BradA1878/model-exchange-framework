# Security

This section details the security model and best practices in MXF.

## Authentication

- **JWT (Dashboard Users):**
  - Issued via magic link or login endpoint.
  - Sent in `Authorization: Bearer <token>` header.
  - Middleware validates token and attaches user context.

- **Agent Keys (SDK):**
  - Generated and managed through the Dashboard key management APIs.
  - Use the `apiKey` header or `X-API-Key` for requests.
  - Rotate or revoke keys via `/api/agents/keys` endpoints.

### Realtime user-session invalidation

Authenticated Socket.IO user sessions retain their verified user, role, and
credential identity for the lifetime of the connection. MXF therefore hard
disconnects an exact PAT's sockets on revocation, disconnects JWT and PAT
sockets at their verified expiry, and disconnects every JWT/password/PAT socket
for a user after account deletion, deactivation, or a role change. A lifecycle
mutation is not reported as successful if local socket eviction cannot be
completed.

This invalidation registry is process-local. If MXF is deployed with multiple
server processes or hosts, the operator must publish PAT and user invalidation
messages to every instance (for example through Redis pub/sub) and wait for all
instances to apply them. Without that cluster invalidation layer, immediate
revocation is guaranteed only for sockets connected to the process handling the
mutation.

## Authorization

- All protected endpoints enforce JWT or agent key checks.
- Dashboard-only actions require validated JWT with user scope.
- SDK actions use agent key permissions.

### Global agent identity ownership

An `agentId` is a global security identity, not a tenant-local display name.
MXF permanently reserves it to the authenticated owner at the first channel-key
or Agent creation. Key authentication verifies that reservation again before an
agent principal can access memory or tools. Deleting an Agent, expiring a key,
or revoking every key never releases the reservation for another tenant.

During an upgrade, existing `Agent.createdBy` and all ChannelKey owners,
including inactive keys, are treated as ownership evidence. Conflicting owners
fail closed. Ownerless agent memory also blocks a first claim; an administrator
must explicitly migrate, assign, or remove that state before reusing the ID.

Key generation therefore always requires the target identity:

```typescript
const key = await sdk.generateKey('channel-id', 'agent-id', 'Agent key');
```

### Task-effectiveness tenant index upgrade

Task-effectiveness records are identified by the exact `agentId`, `channelId`,
and `taskId` tuple. Before deploying this composite identity over an existing
database, run:

```bash
bun run migrate:task-effectiveness-tenant-index
```

The migration creates and verifies the composite unique index before replacing
the legacy globally unique `taskId` index. It is idempotent and deliberately
fails closed when a legacy row has no authoritative agent/channel identity;
repair or remove ambiguous rows, then rerun it. The migration never guesses an
owner from collaboration metadata.

## Data Validation & Fail-Fast

- Shared validation utilities in `packages/core/src/utils/validation.ts` assert input integrity.
- Request schemas defined in `packages/core/src/schemas/MessageSchemas.ts`.
- Errors return standardized responses with HTTP status codes.

## Encryption & Storage

- Secrets (API keys, tokens) never stored in plain text in client.
- Keys stored securely in MongoDB with creation timestamps.
- Use HTTPS/TLS for all network communication.

## Tool Security

Agents decide which tools to call and with what arguments. Anything a tool can
reach, an agent can reach. Three boundaries are enforced in code, and each is
configured by the operator — never by a tool argument, because an argument is
supplied by the same model the limit is meant to constrain.

Policy lives in `packages/core/src/protocols/mcp/security/McpToolPolicy.ts`.

All tools that can read or mutate the server host are hidden and denied by
default. Enable them only for a trusted workspace: test runners, compilers, Git
hooks, package scripts, and plugins execute as host processes and may contain
code that reaches beyond the workspace. The workspace control below constrains
MXF's explicit path inputs and working directories; it is not an OS sandbox.

```bash
MXF_UNSAFE_HOST_TOOLS_ENABLED=false
```

### The workspace

`MXF_WORKSPACE_ROOT` bounds explicit tool path inputs and child working
directories. It has **no default**, and host tools fail without it. It does not
confine code executed by a compiler, test runner, Git hook, package script, or
plugin; keep `MXF_UNSAFE_HOST_TOOLS_ENABLED=false` for untrusted repositories.

The filesystem MCP server (`ExternalServerConfigs.ts`) is scoped to this
directory. It previously defaulted to `os.homedir()`, which put `~/.ssh`,
`~/.aws`, and `~/.mxf/config.json` — where the MXF CLI keeps its own credentials
— inside every agent's reach.

```bash
MXF_WORKSPACE_ROOT=/Users/you/projects/my-app
```

### Shell execution

Every tool that shells out — git, tsc, eslint, prettier, jest, the rollback and
backup tools — goes through `executeShellCommand` in `InfrastructureTools.ts`,
which:

- validates the command against `McpSecurityGuard`, which parses compound
  expressions (`a && b`, `a; b`) and checks each effective command, so
  `git status; rm -rf /` cannot pass on the strength of its first word;
- prompts through the confirmation manager for anything the guard flags;
- hands the child a **stripped environment** — `PATH`, `HOME`, locale, and
  nothing else. The server's own environment holds `JWT_SECRET`, `MONGODB_URI`
  and `OPENROUTER_API_KEY`, and is never passed to a command an agent chose.

Those internal tools launch fixed binaries with argv arrays, not interpolated
shell strings. `shell_execute` is different because its command is arbitrary:
it has no host execution path and fails unless the Docker sandbox is enabled
and available. Background shell execution is rejected because it cannot yet
preserve that sandbox boundary.

```bash
# Optional allowlist of base commands. Empty means no allowlist; the guard's
# block rules and confirmation prompts still apply. When set, it binds every
# agent-driven command: shell_execute and the host tools that run commands on
# the server (run_full_test_suite, performance_benchmark, the TypeScript,
# test, and code-analysis tools), with wrappers and env prefixes resolved to
# the command they run.
MXF_SHELL_ALLOWED_COMMANDS=git,npm,node,tsc

# Extra environment variables to forward to shell children, on top of the
# minimal base set.
MXF_SHELL_ENV_PASSTHROUGH=CI,NODE_OPTIONS

# Run shell commands inside a Docker container: no network, read-only root,
# all capabilities dropped, memory and PID limits. Requires the
# mxf/shell-executor image (docker build -t mxf/shell-executor docker/shell-executor/).
# When enabled and Docker is unavailable, execution fails — it never falls back
# to running on the host.
MXF_SHELL_SANDBOX_ENABLED=false
```

### Outbound HTTP

The server sits inside the trust boundary: it can reach the MXF API on
localhost, Meilisearch, MongoDB, and — on a cloud host — the instance metadata
endpoint at `169.254.169.254` that hands out IAM credentials. A tool that fetches
an arbitrary URL on a model's behalf turns the server into a proxy across that
boundary.

All browser and HTTP MCP tools are separately disabled unless the operator opts
in. `api_fetch` checks its target through `HttpTargetGuard` before opening a
socket. It resolves the hostname and refuses loopback, RFC1918, link-local, and
carrier-grade-NAT addresses — so a public name that resolves to `127.0.0.1` is
caught as well as a literal IP. Redirects are not followed, because a redirect
can land on a blocked host after the check.

Browser tools install the same policy before navigation and on every Puppeteer
request, covering redirects, frames, scripts, images, and fetch/XHR subresources.
Chromium is launched with its process sandbox enabled; MXF never supplies
`--no-sandbox` or `--disable-setuid-sandbox`. A deployment that cannot launch
Chromium safely must fix its user/kernel/container configuration rather than
weakening the browser boundary.
The DNS lookup and Chromium's connection are not one atomic operation, so this
is not a complete defense against a hostile DNS server that changes its answer
between those moments. Keep browser/network tools disabled unless agents truly
need server-originated internet access, and enforce egress policy at the host or
container network boundary in high-trust deployments.

```bash
# Permit browser and HTTP MCP tools at discovery and execution.
MXF_UNSAFE_NETWORK_TOOLS_ENABLED=false

# Allow enabled network tools to reach private addresses. Local development only.
MXF_HTTP_ALLOW_PRIVATE_HOSTS=false
```

### External MCP servers

External servers are spawned with the same stripped environment as shell children
(`ExternalMcpServerManager`), plus whatever variables their config explicitly
declares. A declared variable that resolves empty fails the spawn rather than
starting the server without it.

`mongodb-lens` is **off by default**. It hands agents a query interface to
whatever database its connection string names, and in a default deployment that
is the framework's own — the one holding users, personal access tokens, and agent
API keys. To enable it, create a read-only user on a *separate* database and
point `MONGODB_LENS_URI` at it. That variable is deliberately distinct from
`MONGODB_URI` so enabling the server cannot silently reuse the framework's own
credentials.

```bash
MONGODB_LENS_URI=mongodb://readonly:pass@localhost:27017/analytics
```

## Best Practices

- Rotate agent keys periodically.
- Use environment variables for sensitive configs.
- Set `MXF_WORKSPACE_ROOT` to the narrowest directory the work actually needs.
- Keep `mongodb-lens` disabled unless it points at a separate, read-only database.
- Keep dependencies up to date and audit for vulnerabilities.
