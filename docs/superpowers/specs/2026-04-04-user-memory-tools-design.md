# User Memory Tools — Design Spec

**Date:** 2026-04-04
**Author:** Brad Anderson
**Status:** Approved

## Problem

MXF agents start every session cold. There is no cross-session memory about the user — their role, preferences, active projects, or feedback on how agents performed. The existing memory system (AgentMemory, ChannelMemory, RelationshipMemory) is agent-scoped and channel-scoped, not user-scoped.

## Solution

A persistent user memory system exposed as MCP tools. Agents can save, recall, and manage memories about the user across sessions. Backed by MongoDB for persistence and Meilisearch for semantic search.

Inspired by Claude Code's memdir system, adapted for MXF's multi-agent architecture with MongoDB + Meilisearch instead of flat files.

---

## Memory Types

Four types, borrowed from memdir's taxonomy:

| Type | Purpose | Staleness Threshold | Example |
|------|---------|---------------------|---------|
| `user` | Role, expertise, preferences | 180 days | "Brad is a senior engineer, prefers terse responses" |
| `feedback` | Corrections or confirmed approaches | 90 days | "Don't mock databases in tests — got burned last quarter" |
| `project` | Goals, deadlines, decisions not in code | 30 days | "Merge freeze begins 2026-03-05 for mobile release" |
| `reference` | Pointers to external systems | 60 days | "Pipeline bugs tracked in Linear project INGEST" |

**What NOT to save:** Code patterns, file paths, architecture, git history, debugging recipes — anything derivable from the current codebase.

---

## Data Model

New Mongoose model: `src/shared/models/userMemory.ts`

```typescript
{
  userId: string,           // Owner — from auth context
  type: 'user' | 'feedback' | 'project' | 'reference',
  title: string,            // Short name (e.g., "Brad's role")
  description: string,      // One-line summary for relevance ranking
  content: string,          // Full memory body
  createdAt: Date,
  updatedAt: Date,
}
```

**MongoDB indexes:**
- `{ userId: 1, type: 1 }` — filtered queries by type
- `{ userId: 1, updatedAt: -1 }` — recent-first listing
- Text index on `title` + `description` + `content` — fallback search

**Meilisearch index:** `mxf-user-memories`
- Document shape mirrors MongoDB fields with string `id`
- Filterable attributes: `userId`, `type`, `updatedAt`
- Hybrid search (keyword + semantic vectors)

---

## UserMemoryService

New singleton: `src/shared/services/UserMemoryService.ts`

Follows MXF's `getInstance()` pattern.

### Methods

```typescript
class UserMemoryService {
  static getInstance(): UserMemoryService

  // CRUD
  save(userId, { type, title, description, content }): Promise<UserMemoryDocument>
  update(userId, memoryId, fields): Promise<UserMemoryDocument>
  forget(userId, { memoryId?, searchTerm? }): Promise<{ deleted: number }>
  purge(userId): Promise<{ deleted: number }>

  // Search & Recall
  recall(userId, query, { type?, limit? }): Promise<UserMemoryDocument[]>
  getSessionContext(userId, limit?: 10): Promise<UserMemoryDocument[]>

  // Maintenance
  shake(userId, thresholdDays?): Promise<UserMemoryDocument[]>

  // Staleness
  getStalenessLabel(memory): string
  isStale(memory, thresholdDays?): boolean
}
```

### Behavior

- **`save()`** — Upserts by `userId + title`. If a memory with the same title exists, updates it instead of duplicating. Writes to MongoDB, then indexes in Meilisearch.
- **`forget()`** — Accepts either `memoryId` (direct delete) or `searchTerm` (finds best match, deletes). Removes from both MongoDB and Meilisearch.
- **`purge()`** — Deletes all memories for a user from both MongoDB and Meilisearch.
- **`recall()`** — Queries Meilisearch with hybrid search, filtered by `userId` and optionally `type`. Attaches staleness labels to results. Falls back to MongoDB text search if Meilisearch unavailable.
- **`getSessionContext()`** — Broad recall for session start. Returns top N most relevant memories across all types, biased toward recent.
- **`shake()`** — Returns memories past their type-specific staleness threshold as deletion candidates. Does NOT auto-delete — the calling agent presents candidates to the user for selective deletion.

### Search Fallback Chain

1. **Meilisearch available** — Hybrid search (keyword + semantic). Best results.
2. **Meilisearch unavailable** — MongoDB `$text` search on the text index.
3. **No query match** — `find({ userId }).sort({ updatedAt: -1 }).limit(N)`. Returns recent memories.

Gated by `ENABLE_MEILISEARCH` flag — step 1 is skipped if Meilisearch is disabled.

### Staleness Thresholds

| Type | Warning Threshold |
|------|-------------------|
| `project` | 30 days |
| `reference` | 60 days |
| `feedback` | 90 days |
| `user` | 180 days |

Memories past their threshold get a staleness label (e.g., "47 days ago") attached to recall results. No auto-deletion — agents use judgment.

### Write Lock

Per-user promise-chain lock to prevent duplicate writes and race conditions.

```typescript
private writeLocks: Map<string, Promise<void>> = new Map();

private async withWriteLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.writeLocks.get(userId) ?? Promise.resolve();
    const next = existing.then(() => fn());
    this.writeLocks.set(userId, next.then(() => {}, () => {}));
    return next;
}
```

- **Write operations** (`save`, `forget`, `purge`, `shake` deletions) — wrapped in `withWriteLock(userId, ...)`
- **Read operations** (`recall`, `getSessionContext`) — no lock, read freely
- Per-userId — different users don't block each other

---

## MCP Tools

New file: `src/shared/protocols/mcp/tools/UserMemoryTools.ts`

### `user_memory_save`

- **Access:** Orchestrators (Concierge, Planner)
- **Input:** `{ type: 'user'|'feedback'|'project'|'reference', title: string, description: string, content: string }`
- **Behavior:** Calls `UserMemoryService.save()`. Upserts by title.
- **Returns:** `"Memory saved: {title} ({type})"`

### `user_memory_recall`

- **Access:** All agents
- **Input:** `{ query: string, type?: string, limit?: number }`
- **Behavior:** Calls `UserMemoryService.recall()`. Each result includes staleness label.
- **Returns:** JSON array of `{ title, type, content, staleness }` or `"No memories found."`

### `user_memory_forget`

- **Access:** Orchestrators (Concierge, Planner)
- **Input:** `{ memoryId?: string, searchTerm?: string }` (one required)
- **Behavior:** Calls `UserMemoryService.forget()`.
- **Returns:** `"Deleted {count} memory/memories."`

### `user_memory_shake`

- **Access:** Orchestrators (Concierge, Planner)
- **Input:** `{ thresholdDays?: number }` (defaults to type-specific thresholds)
- **Behavior:** Calls `UserMemoryService.shake()`. Returns stale candidates for the agent to present to the user via `user_input` multi_select.
- **Returns:** JSON array of `{ id, title, type, age, updatedAt }` or `"No stale memories found."`

**Registration:** `ToolNames.ts` under `USER_MEMORY_TOOLS`, exported from `tools/index.ts`, categorized as `MEMORY`.

---

## Auto-Recall at Session Start

When `InteractiveSessionManager.connect()` runs (used by both TUI and Desktop sidecar), it calls `UserMemoryService.getSessionContext(userId)` and appends the top 10 memories to the agent context. Agents see user context immediately before the first task — no tool call needed.

On-demand recall via `user_memory_recall` is available during task execution for deeper/specific queries.

**Flow:**
1. User connects → `InteractiveSessionManager.connect()` → `UserMemoryService.getSessionContext(userId)` → top 10 memories injected into agent context
2. During tasks → agents call `user_memory_recall` on-demand
3. Agents save memories when they learn something non-obvious

---

## Agent Prompt Updates

### `concierge.md`

**Added tools:** `user_memory_save`, `user_memory_recall`, `user_memory_forget`, `user_memory_shake`

**Added instructions:**
```
## User Memory

You have access to persistent memory about the user across sessions.
Memories are auto-loaded at session start, but you can recall more with
user_memory_recall for specific queries.

Save memories when you learn something non-obvious:
- user: role, expertise, preferences
- feedback: corrections or confirmed approaches (include Why: and How to apply:)
- project: goals, deadlines, decisions not derivable from code
- reference: pointers to external systems (Jira, dashboards, Slack channels)

Do NOT save: code patterns, file paths, git history, debugging recipes —
these are derivable from the codebase.

Periodically run user_memory_shake to clean up stale memories. Present
candidates to the user via user_input for selective deletion.
```

### `planner.md`

**Added tools:** `user_memory_save`, `user_memory_recall`

Same save guidelines, focused on project and feedback types.

### `operator.md`, `executor.md`, `reviewer.md`

**Added tools:** `user_memory_recall` (read-only access)

---

## File Summary

### New Files (3)

| File | Purpose |
|------|---------|
| `src/shared/models/userMemory.ts` | Mongoose model + TypeScript interfaces |
| `src/shared/services/UserMemoryService.ts` | Singleton — CRUD, search, staleness, write lock, auto-recall |
| `src/shared/protocols/mcp/tools/UserMemoryTools.ts` | 4 MCP tools (save, recall, forget, shake) |

### Modified Files (8)

| File | Changes |
|------|---------|
| `src/shared/constants/ToolNames.ts` | Add `USER_MEMORY_TOOLS` namespace |
| `src/shared/protocols/mcp/tools/index.ts` | Import + export + register user memory tools |
| `src/cli/tui/services/InteractiveSessionManager.ts` | Auto-inject session context on connect |
| `src/cli/tui/agents/built-in/concierge.md` | Add 4 tools + user memory instructions |
| `src/cli/tui/agents/built-in/planner.md` | Add save + recall + instructions |
| `src/cli/tui/agents/built-in/operator.md` | Add recall |
| `src/cli/tui/agents/built-in/executor.md` | Add recall |
| `src/cli/tui/agents/built-in/reviewer.md` | Add recall |

### Not Modified

- **`MxfMeilisearchService.ts`** — Already supports dynamic index creation. `UserMemoryService` calls it directly.
- **`MemoryService.ts`** — Left alone. User memory is a separate concern from agent/channel memory.
- **Desktop sidecar/UI** — No changes. Auto-inject flows through `InteractiveSessionManager` which the sidecar already uses.

---

## Verification

1. `npx tsc --noEmit` — no TypeScript errors
2. Agent calls `user_memory_save` with type `feedback` → memory persisted in MongoDB, indexed in Meilisearch
3. Agent calls `user_memory_recall` with query → returns ranked results with staleness labels
4. Meilisearch disabled → `recall` falls back to MongoDB text search
5. Agent calls `user_memory_forget` with searchTerm → best match deleted from both stores
6. Agent calls `user_memory_shake` → returns stale candidates, agent presents to user
7. New session starts → top 10 memories auto-injected into agent context
8. Two concurrent `save` calls for same user → write lock prevents duplicates
9. `purge` clears all user memories from both MongoDB and Meilisearch
