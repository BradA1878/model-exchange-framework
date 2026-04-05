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
 * Singleton service for persistent cross-session user memory. Provides CRUD
 * operations, semantic search via Meilisearch (with MongoDB text search and
 * recency fallbacks), staleness tracking, and per-user write-lock serialization
 * to prevent race conditions during concurrent updates.
 */

import {
    UserMemory,
    UserMemoryDocument,
    UserMemorySaveInput,
    UserMemoryType,
    STALENESS_THRESHOLDS
} from '../models/userMemory';
import { Logger } from '../utils/Logger';

// ─── Constants ───────────────────────────────────────────────────────────────

const MEILISEARCH_INDEX = 'mxf-user-memories';

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger = new Logger('info', 'UserMemoryService', 'server');

// ─── Exported Interfaces ─────────────────────────────────────────────────────

/** Result shape returned by recall and getSessionContext */
export interface UserMemoryRecallResult {
    id: string;
    type: UserMemoryType;
    title: string;
    description: string;
    content: string;
    /** Human-readable staleness label, e.g. "today", "3 months ago" */
    staleness: string;
    updatedAt: Date;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Shape of a document stored in the Meilisearch user-memories index */
interface UserMemoryMeilisearchDoc {
    id: string;
    userId: string;
    type: UserMemoryType;
    title: string;
    description: string;
    content: string;
    updatedAt: number; // Unix timestamp (ms) for filtering
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class UserMemoryService {
    private static instance: UserMemoryService;

    /** Per-user promise chain to serialize writes and prevent race conditions */
    private writeLocks: Map<string, Promise<void>> = new Map();

    private constructor() {}

    /** Returns the singleton instance of UserMemoryService */
    static getInstance(): UserMemoryService {
        if (!UserMemoryService.instance) {
            UserMemoryService.instance = new UserMemoryService();
        }
        return UserMemoryService.instance;
    }

    // ─── Write Lock ──────────────────────────────────────────────────────────

    /**
     * Serializes writes per user via a chained promise. Each new write waits
     * for the previous one to complete before executing.
     */
    private async withWriteLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
        const existing = this.writeLocks.get(userId) ?? Promise.resolve();
        let resolve!: () => void;
        const next = new Promise<void>((r) => { resolve = r; });
        this.writeLocks.set(userId, next);
        await existing;
        try {
            return await fn();
        } finally {
            resolve();
        }
    }

    // ─── CRUD Methods ────────────────────────────────────────────────────────

    /**
     * Creates or updates a memory entry identified by userId + title.
     * After MongoDB write, indexes the document in Meilisearch (best-effort).
     */
    async save(userId: string, input: UserMemorySaveInput): Promise<UserMemoryDocument> {
        return this.withWriteLock(userId, async () => {
            const now = new Date();
            const doc = await UserMemory.findOneAndUpdate(
                { userId, title: input.title },
                {
                    $set: {
                        userId,
                        type: input.type,
                        title: input.title,
                        description: input.description,
                        content: input.content,
                        updatedAt: now
                    },
                    $setOnInsert: { createdAt: now }
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ) as UserMemoryDocument;

            // Index in Meilisearch (best-effort — never block the response)
            this.indexInMeilisearch(doc).catch((err) => {
                logger.warn('Failed to index user memory in Meilisearch', err);
            });

            return doc;
        });
    }

    /**
     * Updates specific fields on an existing memory entry by its ID.
     */
    async update(
        userId: string,
        memoryId: string,
        fields: Partial<UserMemorySaveInput>
    ): Promise<UserMemoryDocument | null> {
        return this.withWriteLock(userId, async () => {
            const now = new Date();
            const doc = await UserMemory.findOneAndUpdate(
                { id: memoryId, userId },
                { $set: { ...fields, updatedAt: now } },
                { new: true }
            ) as UserMemoryDocument | null;

            if (doc) {
                this.indexInMeilisearch(doc).catch((err) => {
                    logger.warn('Failed to re-index updated user memory in Meilisearch', err);
                });
            }

            return doc;
        });
    }

    /**
     * Deletes a memory entry by ID or by searching for the best title match.
     * Returns the count of deleted documents.
     */
    async forget(
        userId: string,
        { memoryId, searchTerm }: { memoryId?: string; searchTerm?: string }
    ): Promise<{ deleted: number }> {
        return this.withWriteLock(userId, async () => {
            if (memoryId) {
                // Delete by explicit ID
                const result = await UserMemory.deleteOne({ id: memoryId, userId });
                if (result.deletedCount > 0) {
                    this.removeFromMeilisearch(memoryId).catch((err) => {
                        logger.warn('Failed to remove user memory from Meilisearch', err);
                    });
                }
                return { deleted: result.deletedCount };
            }

            if (searchTerm) {
                // Find best match via recall, then delete it
                const matches = await this.recall(userId, searchTerm, { limit: 1 });
                if (matches.length === 0) {
                    return { deleted: 0 };
                }
                const targetId = matches[0].id;
                const result = await UserMemory.deleteOne({ id: targetId, userId });
                if (result.deletedCount > 0) {
                    this.removeFromMeilisearch(targetId).catch((err) => {
                        logger.warn('Failed to remove user memory from Meilisearch', err);
                    });
                }
                return { deleted: result.deletedCount };
            }

            return { deleted: 0 };
        });
    }

    /**
     * Deletes all memory entries for a user and clears them from Meilisearch.
     */
    async purge(userId: string): Promise<{ deleted: number }> {
        return this.withWriteLock(userId, async () => {
            const result = await UserMemory.deleteMany({ userId });

            this.clearUserFromMeilisearch(userId).catch((err) => {
                logger.warn('Failed to clear user memories from Meilisearch', err);
            });

            return { deleted: result.deletedCount };
        });
    }

    // ─── Search Methods ──────────────────────────────────────────────────────

    /**
     * Searches memories for a user using a three-tier fallback chain:
     * 1. Meilisearch hybrid search (preferred)
     * 2. MongoDB $text search (if Meilisearch is unavailable)
     * 3. Most-recent entries sorted by updatedAt (if no text matches)
     */
    async recall(
        userId: string,
        query: string,
        { type, limit = 5 }: { type?: UserMemoryType; limit?: number } = {}
    ): Promise<UserMemoryRecallResult[]> {
        // Tier 1: Meilisearch hybrid search
        const meilisearchResults = await this.searchMeilisearch(userId, query, type, limit);
        if (meilisearchResults !== null) {
            return meilisearchResults;
        }

        // Tier 2: MongoDB $text search fallback
        const textFilter: Record<string, unknown> = { userId, $text: { $search: query } };
        if (type) textFilter['type'] = type;

        const textDocs = await UserMemory.find(textFilter)
            .sort({ score: { $meta: 'textScore' } })
            .limit(limit)
            .lean<UserMemoryDocument[]>();

        if (textDocs.length > 0) {
            return textDocs.map((doc) => this.toRecallResult(doc));
        }

        // Tier 3: Recent entries as final fallback
        const recentFilter: Record<string, unknown> = { userId };
        if (type) recentFilter['type'] = type;

        const recentDocs = await UserMemory.find(recentFilter)
            .sort({ updatedAt: -1 })
            .limit(limit)
            .lean<UserMemoryDocument[]>();

        return recentDocs.map((doc) => this.toRecallResult(doc));
    }

    /**
     * Returns the N most-recently updated memories for a user with staleness labels.
     * Intended for injecting user context at the start of a session.
     */
    async getSessionContext(userId: string, limit = 10): Promise<UserMemoryRecallResult[]> {
        const docs = await UserMemory.find({ userId })
            .sort({ updatedAt: -1 })
            .limit(limit)
            .lean<UserMemoryDocument[]>();

        return docs.map((doc) => this.toRecallResult(doc));
    }

    // ─── Maintenance ─────────────────────────────────────────────────────────

    /**
     * Identifies stale memory entries for a user based on type-specific
     * staleness thresholds. Does NOT delete — callers decide what to do.
     */
    async shake(
        userId: string,
        thresholdOverrideDays?: number
    ): Promise<UserMemoryRecallResult[]> {
        const docs = await UserMemory.find({ userId }).lean<UserMemoryDocument[]>();

        return docs
            .filter((doc) => {
                if (thresholdOverrideDays !== undefined) {
                    const thresholdMs = thresholdOverrideDays * 24 * 60 * 60 * 1000;
                    return Date.now() - doc.updatedAt.getTime() > thresholdMs;
                }
                return this.isStale(doc.type, doc.updatedAt);
            })
            .map((doc) => this.toRecallResult(doc));
    }

    // ─── Staleness Helpers ───────────────────────────────────────────────────

    /**
     * Returns a human-readable staleness label for a given updatedAt timestamp.
     * Examples: "today", "1 day ago", "5 days ago", "1 month ago"
     */
    getStalenessLabel(updatedAt: Date): string {
        const diffMs = Date.now() - updatedAt.getTime();
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

        if (diffDays === 0) return 'today';
        if (diffDays === 1) return '1 day ago';
        if (diffDays < 30) return `${diffDays} days ago`;

        const diffMonths = Math.floor(diffDays / 30);
        if (diffMonths === 1) return '1 month ago';
        if (diffMonths < 12) return `${diffMonths} months ago`;

        const diffYears = Math.floor(diffMonths / 12);
        if (diffYears === 1) return '1 year ago';
        return `${diffYears} years ago`;
    }

    /**
     * Returns true if the memory entry has exceeded its type-specific staleness threshold.
     */
    isStale(type: UserMemoryType, updatedAt: Date): boolean {
        const thresholdDays = STALENESS_THRESHOLDS[type];
        const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
        return Date.now() - updatedAt.getTime() > thresholdMs;
    }

    // ─── Private Meilisearch Methods ─────────────────────────────────────────

    /**
     * Returns the MxfMeilisearchService instance if Meilisearch is enabled and
     * available, or null if it should be skipped. Uses require() for conditional
     * dependency resolution (not a singleton pattern — safe to use here).
     */
    private getMeilisearch(): import('./MxfMeilisearchService').MxfMeilisearchService | null {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { MxfMeilisearchService } = require('./MxfMeilisearchService') as typeof import('./MxfMeilisearchService');
            const service = MxfMeilisearchService.getInstance();
            if (!service.isEnabled()) {
                return null;
            }
            return service;
        } catch {
            return null;
        }
    }

    /**
     * Adds or updates a user memory document in the Meilisearch index.
     */
    private async indexInMeilisearch(doc: UserMemoryDocument): Promise<void> {
        const service = this.getMeilisearch();
        if (!service) return;

        try {
            await this.ensureMeilisearchIndex(service);
            const client = service.getClient();
            const document: UserMemoryMeilisearchDoc = {
                id: doc.id,
                userId: doc.userId,
                type: doc.type,
                title: doc.title,
                description: doc.description,
                content: doc.content,
                updatedAt: doc.updatedAt.getTime()
            };
            await client.index(MEILISEARCH_INDEX).addDocuments([document]);
        } catch (err) {
            logger.warn('indexInMeilisearch failed', err);
        }
    }

    /**
     * Removes a single user memory document from the Meilisearch index by its ID.
     */
    private async removeFromMeilisearch(memoryId: string): Promise<void> {
        const service = this.getMeilisearch();
        if (!service) return;

        try {
            const client = service.getClient();
            await client.index(MEILISEARCH_INDEX).deleteDocument(memoryId);
        } catch (err) {
            logger.warn('removeFromMeilisearch failed', err);
        }
    }

    /**
     * Removes all user memory documents for a given userId from the Meilisearch
     * index using a filter expression.
     */
    private async clearUserFromMeilisearch(userId: string): Promise<void> {
        const service = this.getMeilisearch();
        if (!service) return;

        try {
            const client = service.getClient();
            await client.index(MEILISEARCH_INDEX).deleteDocuments({
                filter: `userId = "${userId}"`
            });
        } catch (err) {
            logger.warn('clearUserFromMeilisearch failed', err);
        }
    }

    /**
     * Performs a hybrid search in Meilisearch for user memories.
     * Returns null if Meilisearch is unavailable (signals caller to use fallback).
     */
    private async searchMeilisearch(
        userId: string,
        query: string,
        type: UserMemoryType | undefined,
        limit: number
    ): Promise<UserMemoryRecallResult[] | null> {
        const service = this.getMeilisearch();
        if (!service) return null;

        try {
            await this.ensureMeilisearchIndex(service);
            const client = service.getClient();

            // Build filter expression: always filter by userId, optionally by type
            const filters = [`userId = "${userId}"`];
            if (type) filters.push(`type = "${type}"`);
            const filter = filters.join(' AND ');

            const result = await client.index(MEILISEARCH_INDEX).search<UserMemoryMeilisearchDoc>(
                query,
                {
                    filter,
                    limit,
                    attributesToRetrieve: ['id', 'userId', 'type', 'title', 'description', 'content', 'updatedAt']
                }
            );

            return result.hits.map((hit) => ({
                id: hit.id,
                type: hit.type,
                title: hit.title,
                description: hit.description,
                content: hit.content,
                staleness: this.getStalenessLabel(new Date(hit.updatedAt)),
                updatedAt: new Date(hit.updatedAt)
            }));
        } catch (err) {
            logger.warn('searchMeilisearch failed — falling back to MongoDB', err);
            return null;
        }
    }

    /**
     * Ensures the mxf-user-memories Meilisearch index exists with the correct
     * primary key, filterable attributes, and searchable attributes.
     */
    private async ensureMeilisearchIndex(
        service: import('./MxfMeilisearchService').MxfMeilisearchService
    ): Promise<void> {
        try {
            const client = service.getClient();

            // Create index with primary key if it doesn't already exist
            const indexes = await client.getIndexes();
            const exists = indexes.results.some((idx) => idx.uid === MEILISEARCH_INDEX);
            if (!exists) {
                await client.createIndex(MEILISEARCH_INDEX, { primaryKey: 'id' });
            }

            // Configure filterable and searchable attributes
            const index = client.index(MEILISEARCH_INDEX);
            await index.updateFilterableAttributes(['userId', 'type', 'updatedAt']);
            await index.updateSearchableAttributes(['title', 'description', 'content']);
        } catch (err) {
            logger.warn('ensureMeilisearchIndex failed', err);
        }
    }

    // ─── Private Helpers ─────────────────────────────────────────────────────

    /**
     * Converts a lean UserMemoryDocument into a UserMemoryRecallResult with
     * a computed staleness label.
     */
    private toRecallResult(doc: UserMemoryDocument): UserMemoryRecallResult {
        return {
            id: doc.id,
            type: doc.type,
            title: doc.title,
            description: doc.description,
            content: doc.content,
            staleness: this.getStalenessLabel(doc.updatedAt),
            updatedAt: doc.updatedAt
        };
    }
}

export default UserMemoryService;
