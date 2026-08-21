# User Memory

Persistent memory about the user that survives across sessions, exposed to
agents as four MCP tools. Agent, channel, and relationship memory are scoped to
the agents and channels doing the work; user memory records what the agents
have learned about the person they are working for: role, preferences,
corrections, active projects, and pointers to external systems.

Storage is MongoDB, with Meilisearch for search when it is enabled.

## Memory types

| Type | Purpose | Stale after | Example |
|------|---------|-------------|---------|
| `user` | Role, expertise, preferences | 180 days | "Senior engineer, prefers terse responses" |
| `feedback` | Corrections or confirmed approaches | 90 days | "Don't mock databases in tests" |
| `project` | Goals, deadlines, decisions not in code | 30 days | "Merge freeze starts 2026-03-05" |
| `reference` | Pointers to external systems | 60 days | "Pipeline bugs are tracked in Linear project INGEST" |

Do not save anything derivable from the codebase: code patterns, file paths,
architecture, git history, debugging recipes.

## Data model

`packages/core/src/models/userMemory.ts`

```typescript
{
  userId: string,       // scope key, see "Scope" below
  type: 'user' | 'feedback' | 'project' | 'reference',
  title: string,        // short name; save() upserts on userId + title
  description: string,  // one-line summary used for relevance ranking
  content: string,      // full memory body
  createdAt: Date,
  updatedAt: Date
}
```

MongoDB indexes: `{ userId, type }`, `{ userId, updatedAt: -1 }`, and a text
index over `title`, `description`, and `content` for the search fallback.

Meilisearch index `mxf-user-memories` mirrors the document with a string `id`;
`userId`, `type`, and `updatedAt` are filterable. Identifiers are escaped
before they are interpolated into a filter.

## Scope

The tools key every memory by the authenticated identity of the caller,
`JSON.stringify([agentId, channelId])`
(`getUserMemoryScopeKey` in `UserMemoryTools.ts`). Both values come from the
tool context the server attaches after authentication, never from tool input,
so one tenant cannot read or delete another's memories by naming them.

The interactive CLI's session-start recall (below) uses a different key: the
first 16 hex characters of `sha256(accessToken)`. The two scopes are separate
today, so memories saved through the tools are not the ones injected at
session start. A shared user identity in the tool context is the fix, and is
not in place yet.

## UserMemoryService

`packages/core/src/services/UserMemoryService.ts`, a `getInstance()` singleton.

| Method | Behavior |
|--------|----------|
| `save(userId, { type, title, description, content })` | Upserts on `userId + title`; writes MongoDB, then indexes in Meilisearch. |
| `update(userId, memoryId, fields)` | Partial update of one memory. |
| `forget(userId, { memoryId?, searchTerm? })` | Deletes by id, or the best match for a search term, from both stores. |
| `purge(userId)` | Deletes every memory in the scope from both stores. |
| `recall(userId, query, { type?, limit? })` | Search with staleness labels attached to each result. |
| `getSessionContext(userId, limit = 10)` | Broad, recency-biased recall for session start. |
| `shake(userId, thresholdDays?)` | Returns memories past their staleness threshold. Never deletes. |

Search runs through a three-tier chain: Meilisearch hybrid search when
`ENABLE_MEILISEARCH` is on and the index is reachable; otherwise MongoDB
`$text` search; and when neither matches, the most recent entries in the
scope.

Writes (`save`, `forget`, `purge`) are serialized per scope key through a
promise-chain lock so concurrent saves cannot duplicate or overwrite each
other. Reads take no lock.

Staleness is reported as a label on each result ("47 days ago", "3 months
ago"). Thresholds are per type (`STALENESS_THRESHOLDS` in the model) and only
mark candidates; nothing is deleted automatically.

## Tools

All four are registered under `USER_MEMORY_TOOLS` in `ToolNames.ts`.

### `user_memory_save`

Input: `{ type, title, description, content }`. Upserts on title.
Returns `Memory saved: "<title>" (<type>)`.

### `user_memory_recall`

Input: `{ query, type?, limit? }` (`limit` 1–50, default 5).
Returns a JSON array of `{ title, type, content, staleness }`, or
`No memories found.`

### `user_memory_forget`

Input: `{ memoryId? , searchTerm? }`, one of the two required.
Returns `Deleted <n> memory|memories.`

### `user_memory_shake`

Input: `{ thresholdDays? }`. When omitted the per-type thresholds apply.
Returns a JSON array of stale candidates `{ id, title, type, age, updatedAt }`,
or `No stale memories found.` The calling agent is expected to present the
candidates to the user (for example through `user_input` multi-select) rather
than delete them on its own.

## Session-start recall in the interactive CLI

`InteractiveSessionManager.connect()` calls
`UserMemoryService.getSessionContext(userId, 10)` and appends the result to the
agent context as a short block, one line per memory:

```
[feedback] Don't mock databases (12 days ago): ...
```

Agents can still call `user_memory_recall` during a task for a specific query.
