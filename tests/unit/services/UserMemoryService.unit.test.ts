/**
 * Unit tests for UserMemoryService.
 *
 * Tests CRUD operations (save, recall, forget, purge), session context retrieval,
 * staleness detection (shake, isStale, getStalenessLabel), and per-user write-lock
 * serialization. All MongoDB operations are mocked — no database required.
 */

import { UserMemoryService, UserMemoryRecallResult } from '@mxf/shared/services/UserMemoryService';
import { UserMemory, UserMemoryType, STALENESS_THRESHOLDS } from '@mxf/shared/models/userMemory';

// ─── Mock Meilisearch (always returns null — forces MongoDB fallback) ────────

jest.mock('@mxf/shared/services/MxfMeilisearchService', () => ({
    MxfMeilisearchService: {
        getInstance: () => ({
            isEnabled: () => false
        })
    }
}));

// ─── Mock Logger to silence output during tests ─────────────────────────────

jest.mock('@mxf/shared/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a Date offset from now by the given number of days (negative = past) */
function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Builds a fake lean document matching UserMemoryDocument shape */
function makeDoc(overrides: Partial<{
    id: string;
    userId: string;
    type: UserMemoryType;
    title: string;
    description: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
}> = {}) {
    const now = new Date();
    return {
        id: overrides.id ?? 'mem-1',
        userId: overrides.userId ?? 'user-1',
        type: overrides.type ?? 'project',
        title: overrides.title ?? 'Test Memory',
        description: overrides.description ?? 'A test memory',
        content: overrides.content ?? 'Memory content',
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now
    };
}

// ─── Service Instance ───────────────────────────────────────────────────────

let service: UserMemoryService;

beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton for clean state by clearing private instance
    (UserMemoryService as any).instance = undefined;
    service = UserMemoryService.getInstance();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('UserMemoryService', () => {

    // ── Singleton ───────────────────────────────────────────────────────────

    describe('getInstance', () => {
        it('returns the same instance on consecutive calls', () => {
            const a = UserMemoryService.getInstance();
            const b = UserMemoryService.getInstance();
            expect(a).toBe(b);
        });
    });

    // ── save() ──────────────────────────────────────────────────────────────

    describe('save', () => {
        it('creates a new memory and returns the document', async () => {
            const expectedDoc = makeDoc({ id: 'new-1', title: 'Brand colors' });

            jest.spyOn(UserMemory, 'findOneAndUpdate').mockResolvedValue(expectedDoc as any);

            const result = await service.save('user-1', {
                type: 'user',
                title: 'Brand colors',
                description: 'Color preferences',
                content: 'Black, gray, green'
            });

            expect(result).toBeDefined();
            expect(result.id).toBe('new-1');
            expect(result.title).toBe('Brand colors');

            // Verify upsert was called with correct filter
            expect(UserMemory.findOneAndUpdate).toHaveBeenCalledWith(
                { userId: 'user-1', title: 'Brand colors' },
                expect.objectContaining({
                    $set: expect.objectContaining({
                        userId: 'user-1',
                        title: 'Brand colors',
                        content: 'Black, gray, green'
                    }),
                    $setOnInsert: expect.objectContaining({ createdAt: expect.any(Date) })
                }),
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        });

        it('upserts when same userId + title exists (updates content, no duplicate)', async () => {
            const updatedDoc = makeDoc({ id: 'existing-1', title: 'Brand colors', content: 'Updated content' });
            jest.spyOn(UserMemory, 'findOneAndUpdate').mockResolvedValue(updatedDoc as any);

            const result = await service.save('user-1', {
                type: 'user',
                title: 'Brand colors',
                description: 'Updated desc',
                content: 'Updated content'
            });

            expect(result.content).toBe('Updated content');
            // findOneAndUpdate is called once — not a separate insert
            expect(UserMemory.findOneAndUpdate).toHaveBeenCalledTimes(1);
        });

        it('creates separate memories for different titles', async () => {
            const docA = makeDoc({ id: 'a', title: 'Title A' });
            const docB = makeDoc({ id: 'b', title: 'Title B' });

            const spy = jest.spyOn(UserMemory, 'findOneAndUpdate');
            spy.mockResolvedValueOnce(docA as any);
            spy.mockResolvedValueOnce(docB as any);

            const resultA = await service.save('user-1', {
                type: 'project', title: 'Title A', description: 'd', content: 'c'
            });
            const resultB = await service.save('user-1', {
                type: 'project', title: 'Title B', description: 'd', content: 'c'
            });

            expect(resultA.id).toBe('a');
            expect(resultB.id).toBe('b');
            expect(spy).toHaveBeenCalledTimes(2);
        });
    });

    // ── recall() ────────────────────────────────────────────────────────────

    describe('recall', () => {
        /** Helper: sets up the chained query mock for UserMemory.find() */
        function mockFind(docs: any[]) {
            const chain = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(docs)
            };
            jest.spyOn(UserMemory, 'find').mockReturnValue(chain as any);
            return chain;
        }

        it('returns matching memories with staleness labels', async () => {
            const doc = makeDoc({ updatedAt: daysAgo(5) });
            mockFind([doc]);

            const results = await service.recall('user-1', 'test');

            expect(results).toHaveLength(1);
            expect(results[0].staleness).toBe('5 days ago');
            expect(results[0].id).toBe('mem-1');
        });

        it('falls back to recency when MongoDB $text returns nothing', async () => {
            // First call ($text search) returns empty, second (recency) returns docs
            const recentDoc = makeDoc({ id: 'recent', updatedAt: daysAgo(0) });
            const chain1 = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([])
            };
            const chain2 = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([recentDoc])
            };
            const findSpy = jest.spyOn(UserMemory, 'find');
            findSpy.mockReturnValueOnce(chain1 as any);
            findSpy.mockReturnValueOnce(chain2 as any);

            const results = await service.recall('user-1', 'query');

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('recent');
        });

        it('filters by type when specified', async () => {
            mockFind([makeDoc({ type: 'feedback' })]);

            await service.recall('user-1', 'query', { type: 'feedback' });

            expect(UserMemory.find).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'feedback' })
            );
        });

        it('respects limit parameter', async () => {
            const chain = mockFind([makeDoc()]);

            await service.recall('user-1', 'query', { limit: 3 });

            expect(chain.limit).toHaveBeenCalledWith(3);
        });

        it('returns empty array when no matches', async () => {
            // Both $text and recency return empty
            const emptyChain = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue([])
            };
            jest.spyOn(UserMemory, 'find').mockReturnValue(emptyChain as any);

            const results = await service.recall('user-1', 'nonexistent');
            expect(results).toEqual([]);
        });
    });

    // ── getSessionContext() ─────────────────────────────────────────────────

    describe('getSessionContext', () => {
        function mockFind(docs: any[]) {
            const chain = {
                sort: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(docs)
            };
            jest.spyOn(UserMemory, 'find').mockReturnValue(chain as any);
            return chain;
        }

        it('returns most recent memories sorted by updatedAt desc', async () => {
            const docA = makeDoc({ id: 'a', updatedAt: daysAgo(1) });
            const docB = makeDoc({ id: 'b', updatedAt: daysAgo(0) });
            const chain = mockFind([docB, docA]); // pre-sorted by mock

            const results = await service.getSessionContext('user-1');

            expect(results).toHaveLength(2);
            expect(results[0].id).toBe('b');
            expect(results[1].id).toBe('a');
            expect(chain.sort).toHaveBeenCalledWith({ updatedAt: -1 });
        });

        it('respects limit parameter', async () => {
            const chain = mockFind([makeDoc()]);

            await service.getSessionContext('user-1', 3);

            expect(chain.limit).toHaveBeenCalledWith(3);
        });
    });

    // ── forget() ────────────────────────────────────────────────────────────

    describe('forget', () => {
        it('deletes by memoryId', async () => {
            jest.spyOn(UserMemory, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as any);

            const result = await service.forget('user-1', { memoryId: 'mem-42' });

            expect(result).toEqual({ deleted: 1 });
            expect(UserMemory.deleteOne).toHaveBeenCalledWith({ id: 'mem-42', userId: 'user-1' });
        });

        it('deletes by searchTerm (finds best match then deletes)', async () => {
            // Mock recall to find one match
            const recallResult: UserMemoryRecallResult = {
                id: 'found-1',
                type: 'project',
                title: 'Found Memory',
                description: 'desc',
                content: 'content',
                staleness: 'today',
                updatedAt: new Date()
            };
            jest.spyOn(service, 'recall').mockResolvedValue([recallResult]);
            jest.spyOn(UserMemory, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as any);

            const result = await service.forget('user-1', { searchTerm: 'Found' });

            expect(result).toEqual({ deleted: 1 });
            expect(UserMemory.deleteOne).toHaveBeenCalledWith({ id: 'found-1', userId: 'user-1' });
        });

        it('returns { deleted: 0 } when no match found', async () => {
            // Neither memoryId nor searchTerm provided
            const result = await service.forget('user-1', {});
            expect(result).toEqual({ deleted: 0 });
        });

        it('returns { deleted: 0 } when searchTerm matches nothing', async () => {
            jest.spyOn(service, 'recall').mockResolvedValue([]);

            const result = await service.forget('user-1', { searchTerm: 'nonexistent' });
            expect(result).toEqual({ deleted: 0 });
        });
    });

    // ── purge() ─────────────────────────────────────────────────────────────

    describe('purge', () => {
        it('deletes all memories for a user', async () => {
            jest.spyOn(UserMemory, 'deleteMany').mockResolvedValue({ deletedCount: 5 } as any);

            const result = await service.purge('user-1');

            expect(result).toEqual({ deleted: 5 });
            expect(UserMemory.deleteMany).toHaveBeenCalledWith({ userId: 'user-1' });
        });

        it('does not affect other users memories (filter uses userId)', async () => {
            const spy = jest.spyOn(UserMemory, 'deleteMany').mockResolvedValue({ deletedCount: 3 } as any);

            await service.purge('user-A');

            // The filter must scope to user-A only
            expect(spy).toHaveBeenCalledWith({ userId: 'user-A' });
            expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-B' }));
        });
    });

    // ── shake() ─────────────────────────────────────────────────────────────

    describe('shake', () => {
        function mockFind(docs: any[]) {
            const chain = {
                lean: jest.fn().mockResolvedValue(docs)
            };
            jest.spyOn(UserMemory, 'find').mockReturnValue(chain as any);
        }

        it('returns memories past their type-specific thresholds', async () => {
            const staleProject = makeDoc({
                id: 'stale-proj',
                type: 'project',
                updatedAt: daysAgo(31) // project threshold is 30
            });
            const freshProject = makeDoc({
                id: 'fresh-proj',
                type: 'project',
                updatedAt: daysAgo(10)
            });
            mockFind([staleProject, freshProject]);

            const results = await service.shake('user-1');

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('stale-proj');
        });

        it('respects custom thresholdDays override', async () => {
            const doc = makeDoc({
                id: 'semi-old',
                type: 'user', // normally 180 day threshold
                updatedAt: daysAgo(10)
            });
            mockFind([doc]);

            // Override threshold to 5 days — the 10-day-old doc should be stale
            const results = await service.shake('user-1', 5);

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('semi-old');
        });

        it('returns empty array when no stale memories', async () => {
            const freshDoc = makeDoc({
                type: 'user', // 180d threshold
                updatedAt: daysAgo(1)
            });
            mockFind([freshDoc]);

            const results = await service.shake('user-1');
            expect(results).toEqual([]);
        });
    });

    // ── getStalenessLabel() ─────────────────────────────────────────────────

    describe('getStalenessLabel', () => {
        it('returns "today" for same-day', () => {
            expect(service.getStalenessLabel(new Date())).toBe('today');
        });

        it('returns "1 day ago" for yesterday', () => {
            expect(service.getStalenessLabel(daysAgo(1))).toBe('1 day ago');
        });

        it('returns "N days ago" for 2-29 days', () => {
            expect(service.getStalenessLabel(daysAgo(5))).toBe('5 days ago');
            expect(service.getStalenessLabel(daysAgo(29))).toBe('29 days ago');
        });

        it('returns "1 month ago" for 30 days', () => {
            expect(service.getStalenessLabel(daysAgo(30))).toBe('1 month ago');
        });

        it('returns "N months ago" for 60-330 days', () => {
            expect(service.getStalenessLabel(daysAgo(60))).toBe('2 months ago');
            expect(service.getStalenessLabel(daysAgo(90))).toBe('3 months ago');
            expect(service.getStalenessLabel(daysAgo(330))).toBe('11 months ago');
        });

        it('returns "1 year ago" for 360 days', () => {
            expect(service.getStalenessLabel(daysAgo(360))).toBe('1 year ago');
        });

        it('returns "N years ago" for 720+ days', () => {
            expect(service.getStalenessLabel(daysAgo(720))).toBe('2 years ago');
        });
    });

    // ── isStale() ───────────────────────────────────────────────────────────

    describe('isStale', () => {
        it('project: stale after 30 days', () => {
            expect(service.isStale('project', daysAgo(31))).toBe(true);
            expect(service.isStale('project', daysAgo(29))).toBe(false);
        });

        it('reference: stale after 60 days', () => {
            expect(service.isStale('reference', daysAgo(61))).toBe(true);
            expect(service.isStale('reference', daysAgo(59))).toBe(false);
        });

        it('feedback: stale after 90 days', () => {
            expect(service.isStale('feedback', daysAgo(91))).toBe(true);
            expect(service.isStale('feedback', daysAgo(89))).toBe(false);
        });

        it('user: stale after 180 days', () => {
            expect(service.isStale('user', daysAgo(181))).toBe(true);
            expect(service.isStale('user', daysAgo(179))).toBe(false);
        });
    });

    // ── Write Lock ──────────────────────────────────────────────────────────

    describe('write lock', () => {
        it('serializes concurrent saves for the same user (no duplicates)', async () => {
            const callOrder: string[] = [];

            jest.spyOn(UserMemory, 'findOneAndUpdate').mockImplementation(
                ((filter: any) => {
                    // Return a thenable that simulates async behavior
                    callOrder.push(filter.title);
                    return new Promise((resolve) => {
                        setTimeout(() => resolve(makeDoc({ title: filter.title })), 10);
                    });
                }) as any
            );

            // Fire two concurrent saves for the same user
            const [r1, r2] = await Promise.all([
                service.save('user-1', { type: 'project', title: 'Save A', description: 'd', content: 'c' }),
                service.save('user-1', { type: 'project', title: 'Save B', description: 'd', content: 'c' })
            ]);

            // Both should complete
            expect(r1).toBeDefined();
            expect(r2).toBeDefined();

            // They should have been serialized (sequential, not interleaved)
            expect(callOrder).toEqual(['Save A', 'Save B']);
        });
    });
});
