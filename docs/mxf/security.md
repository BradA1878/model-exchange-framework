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

## Authorization

- All protected endpoints enforce JWT or agent key checks.
- Dashboard-only actions require validated JWT with user scope.
- SDK actions use agent key permissions.

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

### The workspace

`MXF_WORKSPACE_ROOT` names the single directory agents may work in. It has **no
default**, and features that hand out filesystem reach fail to start without it.

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

```bash
# Optional allowlist of base commands. Empty means no allowlist; the guard's
# block rules and confirmation prompts still apply.
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

`api_fetch` therefore checks its target through `HttpTargetGuard` before opening
a socket. It resolves the hostname and refuses loopback, RFC1918, link-local,
and carrier-grade-NAT addresses — so a public name that resolves to `127.0.0.1`
is caught as well as a literal IP. Redirects are not followed, because a redirect
can land on a blocked host after the check.

```bash
# Allow api_fetch to reach loopback and private addresses. Local development only.
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
