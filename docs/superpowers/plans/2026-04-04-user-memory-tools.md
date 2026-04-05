# User Memory Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MXF agents persistent cross-session memory about the user via 4 MCP tools backed by MongoDB + Meilisearch.

**Architecture:** New `UserMemory` Mongoose model, `UserMemoryService` singleton (CRUD, search, staleness, write lock), and `UserMemoryTools.ts` with 4 MCP tools (save, recall, forget, shake). Auto-inject at session start via `InteractiveSessionManager`. Meilisearch for hybrid search with MongoDB text search fallback.

**Tech Stack:** TypeScript, Mongoose/MongoDB, Meilisearch (via existing `MxfMeilisearchService`), MCP tool protocol.

**Spec:** `docs/superpowers/specs/2026-04-04-user-memory-tools-design.md`

**Note on userId:** `McpToolHandlerContext` has `agentId` and `channelId` but no `userId`. Tool handlers will use `channelId` as the scoping key — each interactive session creates a unique channel per user. For auto-inject, `InteractiveSessionManager` will hash the `accessToken` to derive a stable userId.

---

### Task 1: UserMemory Mongoose Model

**Files:**
- Create: `src/shared/models/userMemory.ts`

- [ ] **Step 1: Create the model file with schema and interfaces**

```typescript
/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * UserMemory Model
 *
 * Persistent cross-session memory about the user. Stores user preferences,
 * feedback, project context, and references to external systems. Agents
 * save and recall these memories to personalize interactions across sessions.
 *
 * Four memory types:
 * - user: role, expertise, preferences (staleness: 180 days)
 * - feedback: corrections or confirmed approaches (staleness: 90 days)
 * - project: goals, deadlines, decisions not in code (staleness: 30 days)
 * - reference: pointers to external systems (staleness: 60 days)
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types
// ============================================================================

/** The four memory types, following memdir's taxonomy */
export type UserMemoryType = 'user' | 'feedback' | 'project' | 'reference';

/** Core memory fields (without Mongoose internals) */
export interface IUserMemory {
    id: string;
    userId: string;
    type: UserMemoryType;
    title: string;
    description: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
}

/** Mongoose document interface */
export interface UserMemoryDocument extends Omit<Document, 'id'>, IUserMemory {}

/** Input for creating/updating a memory */
export interface UserMemorySaveInput {
    type: UserMemoryType;
    title: string;
    description: string;
    content: string;
}

/** Staleness thresholds in days, keyed by memory type */
export const STALENESS_THRESHOLDS: Record<UserMemoryType, number> = {
    project: 30,
    reference: 60,
    feedback: 90,
    user: 180,
};

// ============================================================================
// Schema
// ============================================================================

const UserMemorySchema = new Schema({
    id: { type: String, default: () => uuidv4(), unique: true, required: true },
    userId: { type: String, required: true, index: true },
    type: {
        type: String,
        required: true,
        enum: ['user', 'feedback', 'project', 'reference'],
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

// Indexes for common query patterns
UserMemorySchema.index({ userId: 1, type: 1 });
UserMemorySchema.index({ userId: 1, updatedAt: -1 });
// Compound unique index to prevent duplicate titles per user
UserMemorySchema.index({ userId: 1, title: 1 }, { unique: true });
// Text index for fallback search when Meilisearch is unavailable
UserMemorySchema.index({ title: 'text', description: 'text', content: 'text' });

// Auto-update timestamp on save
UserMemorySchema.pre('save', function (this: UserMemoryDocument, next) {
    this.updatedAt = new Date();
    next();
});

// ============================================================================
// Model
// ============================================================================

export const UserMemory: Model<UserMemoryDocument> =
    mongoose.models.UserMemory ||
    mongoose.model<UserMemoryDocument>('UserMemory', UserMemorySchema);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i userMemory || echo "No errors"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/models/userMemory.ts
git commit -m "feat: add UserMemory Mongoose model for cross-session user memory"
```

---

### Task 2: UserMemoryService Singleton

**Files:**
- Create: `src/shared/services/UserMemoryService.ts`

- [ ] **Step 1: Create the service file**

```typescript
/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * UserMemoryService
 *
 * Singleton service for persistent cross-session user memory.
 * Handles CRUD, search (Meilisearch + MongoDB fallback), staleness
 * tracking, and per-user write locking.
 *
 * Search fallback chain:
 * 1. Meilisearch hybrid search (keyword + semantic) — best results
 * 2. MongoDB $text search — functional, no semantic ranking
 * 3. Recent memories by updatedAt — guaranteed results
 */

import { Logger } from '../utils/Logger';
import {
    UserMemory,
    UserMemoryDocument,
    UserMemorySaveInput,
    UserMemoryType,
    STALENESS_THRESHOLDS,
} from '../models/userMemory';

const logger = new Logger('info', 'UserMemoryService', 'server');

/** Meilisearch index name for user memories */
const MEILISEARCH_INDEX = 'mxf-user-memories';

/** Result returned from recall operations, enriched with staleness info */
export interface UserMemoryRecallResult {
    id: string;
    type: UserMemoryType;
    title: string;
    description: string;
    content: string;
    staleness: string;
    updatedAt: Date;
}

export class UserMemoryService {
    private static instance: UserMemoryService;
    private writeLocks: Map<string, Promise<void>> = new Map();

    private constructor() {}

    static getInstance(): UserMemoryService {
        if (!UserMemoryService.instance) {
            UserMemoryService.instance = new UserMemoryService();
        }
        return UserMemoryService.instance;
    }

    // ========================================================================
    // Write Lock
    // ========================================================================

    /**
     * Per-user promise-chain write lock. Write operations queue in order;
     * read operations are never blocked.
     */
    private async withWriteLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
        const existing = this.writeLocks.get(userId) ?? Promise.resolve();
        let resolve: () => void;
        const next = new Promise<void>((r) => { resolve = r; });
        this.writeLocks.set(userId, next);

        await existing;
        try {
            return await fn();
        } finally {
            resolve!();
        }
    }

    // ========================================================================
    // CRUD
    // ========================================================================

    /**
     * Save a memory. Upserts by userId + title — if a memory with the same
     * title already exists for this user, it gets updated instead of duplicated.
     */
    async save(userId: string, input: UserMemorySaveInput): Promise<UserMemoryDocument> {
        return this.withWriteLock(userId, async () => {
            const doc = await UserMemory.findOneAndUpdate(
                { userId, title: input.title },
                {
                    $set: {
                        type: input.type,
                        description: input.description,
                        content: input.content,
                        updatedAt: new Date(),
                    },
                    $setOnInsert: {
                        userId,
                        title: input.title,
                        createdAt: new Date(),
                    },
                },
                { upsert: true, new: true, runValidators: true }
            );

            // Index in Meilisearch (best-effort, non-blocking)
            this.indexInMeilisearch(doc).catch((err) =>
                logger.warn(`Failed to index memory in Meilisearch: ${err}`)
            );

            logger.info(`Saved user memory: "${input.title}" (${input.type}) for user ${userId}`);
            return doc;
        });
    }

    /**
     * Update specific fields on an existing memory by ID.
     */
    async update(
        userId: string,
        memoryId: string,
        fields: Partial<UserMemorySaveInput>
    ): Promise<UserMemoryDocument | null> {
        return this.withWriteLock(userId, async () => {
            const update: Record<string, any> = { updatedAt: new Date() };
            if (fields.type) update.type = fields.type;
            if (fields.title) update.title = fields.title;
            if (fields.description) update.description = fields.description;
            if (fields.content) update.content = fields.content;

            const doc = await UserMemory.findOneAndUpdate(
                { id: memoryId, userId },
                { $set: update },
                { new: true }
            );

            if (doc) {
                this.indexInMeilisearch(doc).catch((err) =>
                    logger.warn(`Failed to update Meilisearch index: ${err}`)
                );
            }

            return doc;
        });
    }

    /**
     * Forget (delete) a memory by ID or search term.
     * If searchTerm is provided, finds the best match and deletes it.
     */
    async forget(
        userId: string,
        opts: { memoryId?: string; searchTerm?: string }
    ): Promise<{ deleted: number }> {
        return this.withWriteLock(userId, async () => {
            if (opts.memoryId) {
                const result = await UserMemory.deleteOne({ id: opts.memoryId, userId });
                if (result.deletedCount > 0) {
                    this.removeFromMeilisearch(opts.memoryId).catch((err) =>
                        logger.warn(`Failed to remove from Meilisearch: ${err}`)
                    );
                }
                return { deleted: result.deletedCount };
            }

            if (opts.searchTerm) {
                // Find best match, then delete it
                const matches = await this.recall(userId, opts.searchTerm, { limit: 1 });
                if (matches.length === 0) return { deleted: 0 };

                const best = matches[0];
                const result = await UserMemory.deleteOne({ id: best.id, userId });
                if (result.deletedCount > 0) {
                    this.removeFromMeilisearch(best.id).catch((err) =>
                        logger.warn(`Failed to remove from Meilisearch: ${err}`)
                    );
                }
                return { deleted: result.deletedCount };
            }

            return { deleted: 0 };
        });
    }

    /**
     * Purge all memories for a user. Nuclear option.
     */
    async purge(userId: string): Promise<{ deleted: number }> {
        return this.withWriteLock(userId, async () => {
            const result = await UserMemory.deleteMany({ userId });

            // Clear from Meilisearch
            this.clearUserFromMeilisearch(userId).catch((err) =>
                logger.warn(`Failed to clear user from Meilisearch: ${err}`)
            );

            logger.info(`Purged ${result.deletedCount} memories for user ${userId}`);
            return { deleted: result.deletedCount };
        });
    }

    // ========================================================================
    // Search & Recall
    // ========================================================================

    /**
     * Recall memories matching a query. Uses the search fallback chain:
     * 1. Meilisearch hybrid search
     * 2. MongoDB $text search
     * 3. Recent memories by updatedAt
     */
    async recall(
        userId: string,
        query: string,
        opts: { type?: UserMemoryType; limit?: number } = {}
    ): Promise<UserMemoryRecallResult[]> {
        const limit = Math.min(opts.limit || 10, 50);

        // Try Meilisearch first
        const meilisearchResults = await this.searchMeilisearch(userId, query, opts.type, limit);
        if (meilisearchResults !== null) {
            return meilisearchResults;
        }

        // Fallback to MongoDB text search
        const textFilter: Record<string, any> = {
            userId,
            $text: { $search: query },
        };
        if (opts.type) textFilter.type = opts.type;

        try {
            const docs = await UserMemory.find(textFilter)
                .sort({ score: { $meta: 'textScore' } })
                .limit(limit);

            if (docs.length > 0) {
                return docs.map((d) => this.toRecallResult(d));
            }
        } catch {
            // $text search may fail if index isn't ready — fall through
        }

        // Final fallback: recent memories
        const recentFilter: Record<string, any> = { userId };
        if (opts.type) recentFilter.type = opts.type;

        const docs = await UserMemory.find(recentFilter)
            .sort({ updatedAt: -1 })
            .limit(limit);

        return docs.map((d) => this.toRecallResult(d));
    }

    /**
     * Get top N memories for session-start auto-injection.
     * Returns a broad cross-section biased toward recent, high-value memories.
     */
    async getSessionContext(userId: string, limit: number = 10): Promise<UserMemoryRecallResult[]> {
        const docs = await UserMemory.find({ userId })
            .sort({ updatedAt: -1 })
            .limit(limit);

        return docs.map((d) => this.toRecallResult(d));
    }

    // ========================================================================
    // Maintenance
    // ========================================================================

    /**
     * Find stale memories that are candidates for deletion.
     * Returns them without deleting — the calling agent should present them
     * to the user for selective deletion via user_input.
     */
    async shake(
        userId: string,
        thresholdOverrideDays?: number
    ): Promise<UserMemoryRecallResult[]> {
        const docs = await UserMemory.find({ userId }).sort({ updatedAt: -1 });
        const now = Date.now();
        const stale: UserMemoryRecallResult[] = [];

        for (const doc of docs) {
            const threshold = thresholdOverrideDays ?? STALENESS_THRESHOLDS[doc.type as UserMemoryType];
            const ageDays = Math.floor((now - doc.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
            if (ageDays >= threshold) {
                stale.push(this.toRecallResult(doc));
            }
        }

        return stale;
    }

    // ========================================================================
    // Staleness
    // ========================================================================

    /**
     * Get a human-readable staleness label for a memory.
     * Examples: "2 days ago", "3 months ago", "just now"
     */
    getStalenessLabel(updatedAt: Date): string {
        const days = Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (days === 0) return 'today';
        if (days === 1) return '1 day ago';
        if (days < 30) return `${days} days ago`;
        const months = Math.floor(days / 30);
        if (months === 1) return '1 month ago';
        if (months < 12) return `${months} months ago`;
        const years = Math.floor(months / 12);
        return years === 1 ? '1 year ago' : `${years} years ago`;
    }

    /**
     * Check if a memory is past its type-specific staleness threshold.
     */
    isStale(type: UserMemoryType, updatedAt: Date): boolean {
        const threshold = STALENESS_THRESHOLDS[type];
        const ageDays = Math.floor((Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
        return ageDays >= threshold;
    }

    // ========================================================================
    // Meilisearch Integration
    // ========================================================================

    /**
     * Try to get the MxfMeilisearchService. Returns null if Meilisearch is
     * disabled or the service is unavailable.
     */
    private getMeilisearch(): any | null {
        try {
            // Dynamic import check — Meilisearch may not be enabled
            const { MxfMeilisearchService } = require('../services/MxfMeilisearchService');
            const service = MxfMeilisearchService.getInstance();
            if (!service.isEnabled()) return null;
            return service;
        } catch {
            return null;
        }
    }

    /**
     * Index a memory document in Meilisearch.
     */
    private async indexInMeilisearch(doc: UserMemoryDocument): Promise<void> {
        const meilisearch = this.getMeilisearch();
        if (!meilisearch) return;

        try {
            const client = meilisearch.getClient();
            if (!client) return;

            const index = client.index(MEILISEARCH_INDEX);
            await index.addDocuments([{
                id: doc.id,
                userId: doc.userId,
                type: doc.type,
                title: doc.title,
                description: doc.description,
                content: doc.content,
                updatedAt: doc.updatedAt.getTime(),
            }]);
        } catch (err) {
            logger.warn(`Meilisearch indexing failed: ${err}`);
        }
    }

    /**
     * Remove a memory from the Meilisearch index.
     */
    private async removeFromMeilisearch(memoryId: string): Promise<void> {
        const meilisearch = this.getMeilisearch();
        if (!meilisearch) return;

        try {
            const client = meilisearch.getClient();
            if (!client) return;

            const index = client.index(MEILISEARCH_INDEX);
            await index.deleteDocument(memoryId);
        } catch (err) {
            logger.warn(`Meilisearch removal failed: ${err}`);
        }
    }

    /**
     * Remove all of a user's memories from the Meilisearch index.
     */
    private async clearUserFromMeilisearch(userId: string): Promise<void> {
        const meilisearch = this.getMeilisearch();
        if (!meilisearch) return;

        try {
            const client = meilisearch.getClient();
            if (!client) return;

            const index = client.index(MEILISEARCH_INDEX);
            await index.deleteDocuments({ filter: `userId = "${userId}"` });
        } catch (err) {
            logger.warn(`Meilisearch clear failed: ${err}`);
        }
    }

    /**
     * Search user memories via Meilisearch hybrid search.
     * Returns null if Meilisearch is unavailable (signals caller to fall back).
     */
    private async searchMeilisearch(
        userId: string,
        query: string,
        type: UserMemoryType | undefined,
        limit: number
    ): Promise<UserMemoryRecallResult[] | null> {
        const meilisearch = this.getMeilisearch();
        if (!meilisearch) return null;

        try {
            const client = meilisearch.getClient();
            if (!client) return null;

            const index = client.index(MEILISEARCH_INDEX);

            // Build filter
            let filter = `userId = "${userId}"`;
            if (type) filter += ` AND type = "${type}"`;

            const result = await index.search(query, {
                filter,
                limit,
            });

            return result.hits.map((hit: any) => ({
                id: hit.id,
                type: hit.type,
                title: hit.title,
                description: hit.description,
                content: hit.content,
                staleness: this.getStalenessLabel(new Date(hit.updatedAt)),
                updatedAt: new Date(hit.updatedAt),
            }));
        } catch (err) {
            logger.warn(`Meilisearch search failed, falling back: ${err}`);
            return null;
        }
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Convert a Mongoose document to a recall result with staleness label.
     */
    private toRecallResult(doc: UserMemoryDocument): UserMemoryRecallResult {
        return {
            id: doc.id,
            type: doc.type as UserMemoryType,
            title: doc.title,
            description: doc.description,
            content: doc.content,
            staleness: this.getStalenessLabel(doc.updatedAt),
            updatedAt: doc.updatedAt,
        };
    }

    /**
     * Ensure the Meilisearch index exists with proper filterable attributes.
     * Called once during initialization.
     */
    async ensureMeilisearchIndex(): Promise<void> {
        const meilisearch = this.getMeilisearch();
        if (!meilisearch) return;

        try {
            const client = meilisearch.getClient();
            if (!client) return;

            // Create index if it doesn't exist
            try {
                await client.createIndex(MEILISEARCH_INDEX, { primaryKey: 'id' });
            } catch {
                // Index may already exist — that's fine
            }

            const index = client.index(MEILISEARCH_INDEX);
            await index.updateFilterableAttributes(['userId', 'type', 'updatedAt']);
            await index.updateSearchableAttributes(['title', 'description', 'content']);

            logger.info(`Meilisearch index "${MEILISEARCH_INDEX}" configured`);
        } catch (err) {
            logger.warn(`Failed to configure Meilisearch index: ${err}`);
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i error || echo "No errors"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/services/UserMemoryService.ts
git commit -m "feat: add UserMemoryService singleton for cross-session user memory"
```

---

### Task 3: Register Tool Names in ToolNames.ts

**Files:**
- Modify: `src/shared/constants/ToolNames.ts`

- [ ] **Step 1: Add USER_MEMORY_TOOLS constant**

After the `PROGRESS_TOOLS` block (around line 232), add:

```typescript
/**
 * User Memory Tools - Persistent cross-session user memory
 */
export const USER_MEMORY_TOOLS = {
    USER_MEMORY_SAVE: 'user_memory_save',
    USER_MEMORY_RECALL: 'user_memory_recall',
    USER_MEMORY_FORGET: 'user_memory_forget',
    USER_MEMORY_SHAKE: 'user_memory_shake',
} as const;
```

- [ ] **Step 2: Add to ALL_INTERNAL_TOOLS**

In the `ALL_INTERNAL_TOOLS` object (around line 314), add `...USER_MEMORY_TOOLS,` after `...PROGRESS_TOOLS`:

```typescript
export const ALL_INTERNAL_TOOLS = {
    ...WOLFRAM_TOOLS,
    ...COMMUNICATION_TOOLS,
    ...COORDINATION_TOOLS,
    ...CONTROL_LOOP_TOOLS,
    ...INFRASTRUCTURE_TOOLS,
    ...CONTEXT_MEMORY_TOOLS,
    ...META_TOOLS,
    ...ACTION_VALIDATION_TOOLS,
    ...INFERENCE_PARAMETER_TOOLS,
    ...WEB_TOOLS,
    ...PLANNING_TOOLS,
    ...TASK_PLANNING_TOOLS,
    ...USER_INPUT_TOOLS,
    ...SEARCH_TOOLS,
    ...PROGRESS_TOOLS,
    ...USER_MEMORY_TOOLS
} as const;
```

- [ ] **Step 3: Add USER_MEMORY category to TOOL_CATEGORIES**

In the `TOOL_CATEGORIES` object (around line 367), add after `PROGRESS`:

```typescript
    USER_MEMORY: 'user_memory'
```

- [ ] **Step 4: Add type definition**

After the `ProgressToolName` type (around line 410), add:

```typescript
export type UserMemoryToolName = typeof USER_MEMORY_TOOLS[keyof typeof USER_MEMORY_TOOLS];
```

- [ ] **Step 5: Add category lookup in getToolCategory()**

In the `getToolCategory()` function (around line 490), add before the `return null`:

```typescript
    if (Object.values(USER_MEMORY_TOOLS).includes(toolName as UserMemoryToolName)) {
        return TOOL_CATEGORIES.USER_MEMORY;
    }
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i error || echo "No errors"`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/shared/constants/ToolNames.ts
git commit -m "feat: register user memory tool names and category"
```

---

### Task 4: UserMemoryTools MCP Tool Definitions

**Files:**
- Create: `src/shared/protocols/mcp/tools/UserMemoryTools.ts`

- [ ] **Step 1: Create the tools file with all 4 tools**

```typescript
/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * UserMemoryTools.ts
 *
 * MCP tools for persistent cross-session user memory. Agents use these
 * to save, recall, and manage memories about the user — their preferences,
 * feedback, project context, and references to external systems.
 *
 * Tools:
 * - user_memory_save: Save or update a memory (orchestrators only)
 * - user_memory_recall: Search and retrieve memories (all agents)
 * - user_memory_forget: Delete a memory (orchestrators only)
 * - user_memory_shake: Find stale memories for cleanup (orchestrators only)
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { McpToolInput } from '../IMcpClient';
import { Logger } from '../../../utils/Logger';
import { UserMemoryService } from '../../../services/UserMemoryService';
import { UserMemoryType } from '../../../models/userMemory';
import { USER_MEMORY_TOOLS } from '../../../constants/ToolNames';

const logger = new Logger('info', 'UserMemoryTools', 'server');

const VALID_TYPES: UserMemoryType[] = ['user', 'feedback', 'project', 'reference'];

/**
 * Derive a userId from the tool handler context.
 * Uses channelId as the scoping key — each interactive session
 * creates a unique channel per user.
 */
function getUserId(context: McpToolHandlerContext): string {
    // channelId is unique per user session in TUI/Desktop
    return context.channelId || context.agentId || 'anonymous';
}

// ============================================================================
// user_memory_save
// ============================================================================

export const userMemorySaveTool: McpToolDefinition = {
    name: USER_MEMORY_TOOLS.USER_MEMORY_SAVE,
    description: 'Save a persistent memory about the user. Memories persist across sessions and help agents understand user preferences, project context, and feedback. Upserts by title — if a memory with the same title exists, it gets updated.',
    inputSchema: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                enum: ['user', 'feedback', 'project', 'reference'],
                description: 'Memory type. user: role/preferences. feedback: corrections or confirmed approaches (include Why: and How to apply:). project: goals/deadlines/decisions not in code. reference: pointers to external systems.',
            },
            title: {
                type: 'string',
                description: 'Short, descriptive title (e.g., "Brad\'s role", "Don\'t mock databases")',
            },
            description: {
                type: 'string',
                description: 'One-line summary used for relevance ranking in search results',
            },
            content: {
                type: 'string',
                description: 'Full memory content. For feedback type, structure as: rule, then Why: and How to apply: lines.',
            },
        },
        required: ['type', 'title', 'description', 'content'],
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const type = input.type as string;
        const title = input.title as string;
        const description = input.description as string;
        const content = input.content as string;

        // Validate type
        if (!VALID_TYPES.includes(type as UserMemoryType)) {
            return {
                content: { type: 'text', data: `Error: type must be one of: ${VALID_TYPES.join(', ')}` },
            };
        }

        // Validate required fields are non-empty
        if (!title?.trim()) {
            return { content: { type: 'text', data: 'Error: title is required and must be non-empty.' } };
        }
        if (!description?.trim()) {
            return { content: { type: 'text', data: 'Error: description is required and must be non-empty.' } };
        }
        if (!content?.trim()) {
            return { content: { type: 'text', data: 'Error: content is required and must be non-empty.' } };
        }

        const userId = getUserId(context);
        const service = UserMemoryService.getInstance();

        try {
            await service.save(userId, {
                type: type as UserMemoryType,
                title: title.trim(),
                description: description.trim(),
                content: content.trim(),
            });

            return {
                content: { type: 'text', data: `Memory saved: "${title}" (${type})` },
            };
        } catch (err: any) {
            logger.error(`Failed to save user memory: ${err}`);
            return {
                content: { type: 'text', data: `Error saving memory: ${err.message || err}` },
            };
        }
    },
};

// ============================================================================
// user_memory_recall
// ============================================================================

export const userMemoryRecallTool: McpToolDefinition = {
    name: USER_MEMORY_TOOLS.USER_MEMORY_RECALL,
    description: 'Search and retrieve persistent user memories. Returns the most relevant memories matching your query, with staleness labels. Use at the start of tasks to understand user context, or mid-task for specific queries.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query (e.g., "user preferences", "testing feedback", "active projects")',
            },
            type: {
                type: 'string',
                enum: ['user', 'feedback', 'project', 'reference'],
                description: 'Optional: filter by memory type',
            },
            limit: {
                type: 'number',
                description: 'Max results to return (default: 10, max: 50)',
                minimum: 1,
                maximum: 50,
            },
        },
        required: ['query'],
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const query = input.query as string;
        const type = input.type as UserMemoryType | undefined;
        const limit = input.limit as number | undefined;

        if (!query?.trim()) {
            return { content: { type: 'text', data: 'Error: query is required and must be non-empty.' } };
        }

        if (type && !VALID_TYPES.includes(type)) {
            return {
                content: { type: 'text', data: `Error: type must be one of: ${VALID_TYPES.join(', ')}` },
            };
        }

        const userId = getUserId(context);
        const service = UserMemoryService.getInstance();

        try {
            const results = await service.recall(userId, query.trim(), { type, limit });

            if (results.length === 0) {
                return { content: { type: 'text', data: 'No memories found for this query.' } };
            }

            const formatted = results.map((r) => ({
                id: r.id,
                type: r.type,
                title: r.title,
                content: r.content,
                staleness: r.staleness,
            }));

            const resultContent: McpToolResultContent = {
                type: 'application/json',
                data: formatted,
            };
            return { content: resultContent };
        } catch (err: any) {
            logger.error(`Failed to recall user memories: ${err}`);
            return {
                content: { type: 'text', data: `Error recalling memories: ${err.message || err}` },
            };
        }
    },
};

// ============================================================================
// user_memory_forget
// ============================================================================

export const userMemoryForgetTool: McpToolDefinition = {
    name: USER_MEMORY_TOOLS.USER_MEMORY_FORGET,
    description: 'Delete a user memory by ID or search term. If searchTerm is provided, finds the best match and deletes it. Use when the user asks you to forget something.',
    inputSchema: {
        type: 'object',
        properties: {
            memoryId: {
                type: 'string',
                description: 'Direct memory ID to delete (from recall results)',
            },
            searchTerm: {
                type: 'string',
                description: 'Search term to find and delete the best-matching memory',
            },
        },
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const memoryId = input.memoryId as string | undefined;
        const searchTerm = input.searchTerm as string | undefined;

        if (!memoryId && !searchTerm) {
            return {
                content: { type: 'text', data: 'Error: either memoryId or searchTerm is required.' },
            };
        }

        const userId = getUserId(context);
        const service = UserMemoryService.getInstance();

        try {
            const result = await service.forget(userId, {
                memoryId: memoryId?.trim(),
                searchTerm: searchTerm?.trim(),
            });

            if (result.deleted === 0) {
                return { content: { type: 'text', data: 'No matching memory found to delete.' } };
            }

            return {
                content: {
                    type: 'text',
                    data: `Deleted ${result.deleted} memory${result.deleted > 1 ? 'ies' : ''}.`,
                },
            };
        } catch (err: any) {
            logger.error(`Failed to forget user memory: ${err}`);
            return {
                content: { type: 'text', data: `Error deleting memory: ${err.message || err}` },
            };
        }
    },
};

// ============================================================================
// user_memory_shake
// ============================================================================

export const userMemoryShakeTool: McpToolDefinition = {
    name: USER_MEMORY_TOOLS.USER_MEMORY_SHAKE,
    description: 'Find stale user memories that are candidates for cleanup. Returns memories past their type-specific staleness threshold (project: 30d, reference: 60d, feedback: 90d, user: 180d). Present the results to the user via user_input multi_select for selective deletion.',
    inputSchema: {
        type: 'object',
        properties: {
            thresholdDays: {
                type: 'number',
                description: 'Optional: override all type-specific thresholds with a single value (days)',
                minimum: 1,
            },
        },
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const thresholdDays = input.thresholdDays as number | undefined;
        const userId = getUserId(context);
        const service = UserMemoryService.getInstance();

        try {
            const stale = await service.shake(userId, thresholdDays);

            if (stale.length === 0) {
                return { content: { type: 'text', data: 'No stale memories found.' } };
            }

            const formatted = stale.map((r) => ({
                id: r.id,
                title: r.title,
                type: r.type,
                staleness: r.staleness,
                updatedAt: r.updatedAt.toISOString(),
            }));

            const resultContent: McpToolResultContent = {
                type: 'application/json',
                data: {
                    staleCount: formatted.length,
                    candidates: formatted,
                    instruction: 'Present these to the user via user_input (multi_select) to choose which to delete, then call user_memory_forget for each selected.',
                },
            };
            return { content: resultContent };
        } catch (err: any) {
            logger.error(`Failed to shake user memories: ${err}`);
            return {
                content: { type: 'text', data: `Error finding stale memories: ${err.message || err}` },
            };
        }
    },
};

// ============================================================================
// Export
// ============================================================================

/** All user memory tools as an array for registration */
export const userMemoryTools = [
    userMemorySaveTool,
    userMemoryRecallTool,
    userMemoryForgetTool,
    userMemoryShakeTool,
];
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i error || echo "No errors"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/protocols/mcp/tools/UserMemoryTools.ts
git commit -m "feat: add 4 user memory MCP tools (save, recall, forget, shake)"
```

---

### Task 5: Register Tools in index.ts

**Files:**
- Modify: `src/shared/protocols/mcp/tools/index.ts`

- [ ] **Step 1: Add import**

After the `progressTools` import (line 69), add:

```typescript
import { userMemoryTools } from './UserMemoryTools';
```

- [ ] **Step 2: Add to mxfMcpTools object**

After the `progress: progressTools` entry (line 166), add:

```typescript
    // User memory tools for persistent cross-session user context
    userMemory: userMemoryTools,
```

- [ ] **Step 3: Add to allMxfMcpTools array**

After `...progressTools` (line 206), add:

```typescript
    ...userMemoryTools,
```

- [ ] **Step 4: Add to getMxfMcpToolNames()**

After the `progress:` entry (line 251), add:

```typescript
        userMemory: userMemoryTools.map(tool => tool.name),
```

- [ ] **Step 5: Add to mxfMcpToolMetadata.categories**

In the `categories` array (line 262), add `'userMemory'`.

- [ ] **Step 6: Add to mxfMcpToolMetadata.capabilities**

In the `capabilities` array (around line 350), add:

```typescript
        'persistent cross-session user memory',
        'user preference and feedback tracking',
        'stale memory cleanup and maintenance'
```

- [ ] **Step 7: Add to re-export line**

In the re-export line (line 355), add `userMemoryTools` to the list.

- [ ] **Step 8: Add individual tool re-exports**

At the end of the file, add:

```typescript
export {
    // User Memory Tools
    userMemorySaveTool,
    userMemoryRecallTool,
    userMemoryForgetTool,
    userMemoryShakeTool
} from './UserMemoryTools';
```

- [ ] **Step 9: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i error || echo "No errors"`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/shared/protocols/mcp/tools/index.ts
git commit -m "feat: register user memory tools in tool index"
```

---

### Task 6: Add Tool Descriptions for Desktop UI

**Files:**
- Modify: `src/desktop/src/services/toolDescriptions.ts`

- [ ] **Step 1: Add user memory tool descriptors**

Add these entries to the `TOOL_DESCRIPTORS` object:

```typescript
    user_memory_save: (args) => `Saving memory: ${truncate(String(args.title || ''), 40)}`,
    user_memory_recall: (args) => `Recalling: ${truncate(String(args.query || ''), 40)}`,
    user_memory_forget: (args) => args.searchTerm ? `Forgetting: ${truncate(String(args.searchTerm), 40)}` : 'Deleting memory',
    user_memory_shake: () => 'Checking for stale memories',
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i error || echo "No errors"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/desktop/src/services/toolDescriptions.ts
git commit -m "feat: add user memory tool descriptions for desktop UI"
```

---

### Task 7: Auto-Inject User Memories at Session Start

**Files:**
- Modify: `src/cli/tui/services/InteractiveSessionManager.ts`

- [ ] **Step 1: Import UserMemoryService**

Add at the top of the file with other imports:

```typescript
import { UserMemoryService } from '../../../shared/services/UserMemoryService';
```

- [ ] **Step 2: Add auto-inject after agents connect**

In the `connect()` method, after `this.connected = true;` (line 145), add:

```typescript
        // Auto-inject user memories into session context.
        // Uses a hash of the access token as a stable userId —
        // each user gets their own memory namespace.
        this.injectUserMemories().catch((err) => {
            // Non-fatal: session works without user memories
            logger.warn?.(`Failed to inject user memories: ${err}`);
        });
```

- [ ] **Step 3: Add the injectUserMemories method**

Add this method to the `InteractiveSessionManager` class:

```typescript
    /**
     * Load the user's top memories and inject them into the session context
     * so agents have user context from the very first task.
     */
    private async injectUserMemories(): Promise<void> {
        // Derive a stable userId from the access token
        const crypto = await import('crypto');
        const userId = crypto.createHash('sha256')
            .update(this.config.accessToken)
            .digest('hex')
            .substring(0, 16);

        // Store for later use in task submission
        this.userId = userId;

        const service = UserMemoryService.getInstance();

        // Ensure Meilisearch index exists (idempotent)
        await service.ensureMeilisearchIndex();

        const memories = await service.getSessionContext(userId, 10);
        if (memories.length === 0) return;

        // Format memories as a concise context block
        const lines = memories.map((m) =>
            `[${m.type}] ${m.title} (${m.staleness}): ${m.content}`
        );
        this.userMemoryContext = `\n\nUser memories from previous sessions:\n${lines.join('\n')}`;
    }
```

- [ ] **Step 4: Add the class properties**

Add these properties to the class:

```typescript
    private userId: string = '';
    private userMemoryContext: string = '';
```

- [ ] **Step 5: Inject user memory context into task submissions**

In the `submitTask()` method, after the working directory injection and before the context append, add:

```typescript
        // Inject user memories from previous sessions
        if (this.userMemoryContext) {
            description += this.userMemoryContext;
        }
```

Do the same in `submitTaskToAgent()` if it exists.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i error || echo "No errors"`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/cli/tui/services/InteractiveSessionManager.ts
git commit -m "feat: auto-inject user memories at session start"
```

---

### Task 8: Update Agent Prompts

**Files:**
- Modify: `src/cli/tui/agents/built-in/concierge.md`
- Modify: `src/cli/tui/agents/built-in/planner.md`
- Modify: `src/cli/tui/agents/built-in/operator.md`
- Modify: `src/cli/tui/agents/built-in/executor.md`
- Modify: `src/cli/tui/agents/built-in/reviewer.md`

- [ ] **Step 1: Update concierge.md**

Add 4 tools to `allowedTools` in the frontmatter:

```yaml
allowedTools:
  - task_create_with_plan
  - task_delegate
  - task_complete
  - user_memory_save
  - user_memory_recall
  - user_memory_forget
  - user_memory_shake
```

Add this section before the closing of the markdown body:

```markdown
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

- [ ] **Step 2: Update planner.md**

Add 2 tools to `allowedTools`:

```yaml
  - user_memory_save
  - user_memory_recall
```

Add this section to the prompt:

```markdown
## User Memory

You have access to persistent memory about the user. Memories are auto-loaded
at session start. Use user_memory_recall for specific queries about user
preferences or project context.

Save memories when you learn non-obvious project or feedback context:
- feedback: corrections or confirmed approaches (include Why: and How to apply:)
- project: goals, deadlines, decisions not derivable from code
```

- [ ] **Step 3: Update operator.md**

Add `user_memory_recall` to `allowedTools`.

- [ ] **Step 4: Update executor.md**

Add `user_memory_recall` to `allowedTools`.

- [ ] **Step 5: Update reviewer.md**

Add `user_memory_recall` to `allowedTools`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/tui/agents/built-in/concierge.md src/cli/tui/agents/built-in/planner.md src/cli/tui/agents/built-in/operator.md src/cli/tui/agents/built-in/executor.md src/cli/tui/agents/built-in/reviewer.md
git commit -m "feat: add user memory tools to agent prompts"
```

---

### Task 9: Type-Check and Verify

**Files:**
- All files from Tasks 1-8

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Verify tool registration**

Run: `grep -r 'user_memory' src/shared/constants/ToolNames.ts src/shared/protocols/mcp/tools/index.ts`
Expected: Tool names appear in both files

- [ ] **Step 3: Verify agent prompts**

Run: `grep 'user_memory' src/cli/tui/agents/built-in/*.md`
Expected: All 5 agent files reference at least `user_memory_recall`

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve any type-check issues in user memory implementation"
```

---

## File Summary

### New Files (3)
| File | Task | Purpose |
|------|------|---------|
| `src/shared/models/userMemory.ts` | 1 | Mongoose model, interfaces, staleness thresholds |
| `src/shared/services/UserMemoryService.ts` | 2 | Singleton — CRUD, search fallback chain, staleness, write lock |
| `src/shared/protocols/mcp/tools/UserMemoryTools.ts` | 4 | 4 MCP tools: save, recall, forget, shake |

### Modified Files (8)
| File | Task | Changes |
|------|------|---------|
| `src/shared/constants/ToolNames.ts` | 3 | Add USER_MEMORY_TOOLS, category, type |
| `src/shared/protocols/mcp/tools/index.ts` | 5 | Import, register, export user memory tools |
| `src/desktop/src/services/toolDescriptions.ts` | 6 | Add human-readable descriptions for 4 tools |
| `src/cli/tui/services/InteractiveSessionManager.ts` | 7 | Auto-inject user memories on connect |
| `src/cli/tui/agents/built-in/concierge.md` | 8 | Add 4 tools + user memory instructions |
| `src/cli/tui/agents/built-in/planner.md` | 8 | Add save + recall + instructions |
| `src/cli/tui/agents/built-in/operator.md` | 8 | Add recall |
| `src/cli/tui/agents/built-in/executor.md` | 8 | Add recall |
| `src/cli/tui/agents/built-in/reviewer.md` | 8 | Add recall |
