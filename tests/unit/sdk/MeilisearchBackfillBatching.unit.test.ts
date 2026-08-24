/**
 * Unit tests for MeilisearchBackfillBatching — the pure planner that splits
 * persisted conversation history into batches the server's Meilisearch
 * ingress will accept.
 *
 * Regression-guards the backfill-batching bug: before this module existed,
 * MxfMemoryManager batched purely by message count (50 per request) while
 * the server also rejects a batch whose summed content bytes, or whose
 * serialized wire size, cross its own limits. A dense enough persisted
 * history could never be backfilled: the same oversized batch was rejected
 * on every connect.
 */
import {
    planMeilisearchBackfillBatches,
    DEFAULT_BACKFILL_BATCH_LIMITS,
    BackfillBatchLimits,
    BackfillWireMessage
} from '@mxf-dev/sdk/managers/MeilisearchBackfillBatching';
import {
    MAX_MEILISEARCH_MESSAGE_BYTES,
    MAX_MEILISEARCH_BACKFILL_MESSAGES,
    MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
    MAX_MEILISEARCH_BACKFILL_WIRE_BYTES
} from '@mxf-dev/core/config/MeilisearchIngressLimits';

const makeMessage = (id: string, content: string, timestamp = 1): BackfillWireMessage => ({
    id,
    role: 'user',
    content,
    timestamp
});

/** UTF-8 bytes of a message once it is serialized alone on the wire — the same measure the module uses. */
const wireBytesOf = (message: BackfillWireMessage): number => Buffer.byteLength(JSON.stringify(message), 'utf8');

describe('MeilisearchBackfillBatching', () => {
    describe('DEFAULT_BACKFILL_BATCH_LIMITS', () => {
        it('is wired to the shared core ingress limits, not a local copy', () => {
            expect(DEFAULT_BACKFILL_BATCH_LIMITS).toEqual({
                maxMessages: MAX_MEILISEARCH_BACKFILL_MESSAGES,
                maxContentBytes: MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
                maxWireBytes: MAX_MEILISEARCH_BACKFILL_WIRE_BYTES,
                maxMessageBytes: MAX_MEILISEARCH_MESSAGE_BYTES
            });
        });
    });

    describe('planMeilisearchBackfillBatches', () => {
        it('returns an empty plan for no messages', () => {
            const plan = planMeilisearchBackfillBatches([], 0);
            expect(plan).toEqual({ batches: [], skipped: [] });
        });

        it('splits on the message-count limit when content and wire bytes are tiny', () => {
            const messages = Array.from({ length: 51 }, (_, i) => makeMessage(`m${i}`, 'hi', i + 1));

            const plan = planMeilisearchBackfillBatches(messages, 200);

            expect(plan.batches.map(batch => batch.length)).toEqual([50, 1]);
            expect(plan.skipped).toEqual([]);
            expect(plan.batches.flat().map(m => m.id)).toEqual(messages.map(m => m.id));
        });

        it('splits on the content-byte limit before the count limit is reached', () => {
            // 8 * 60KiB = 480KiB, under the 512KiB default content limit.
            // 9 * 60KiB = 540KiB, over it — so batches close at 8, well short of 50.
            const messages = Array.from({ length: 20 }, (_, i) => makeMessage(`m${i}`, 'y'.repeat(60 * 1024), i + 1));

            const plan = planMeilisearchBackfillBatches(messages, 200);

            expect(plan.batches.map(batch => batch.length)).toEqual([8, 8, 4]);
            expect(plan.skipped).toEqual([]);
            for (const batch of plan.batches) {
                const contentBytes = batch.reduce((sum, m) => sum + Buffer.byteLength(m.content, 'utf8'), 0);
                expect(contentBytes).toBeLessThanOrEqual(DEFAULT_BACKFILL_BATCH_LIMITS.maxContentBytes);
            }
        });

        it('splits on the wire-byte limit even when content bytes alone would fit', () => {
            // Quote characters double in size once JSON-escaped (" -> \"), so the
            // wire size of these messages is much larger than their content bytes —
            // the content limit alone would never force a split here.
            const messages = Array.from({ length: 4 }, (_, i) => makeMessage(`m${i}`, '"'.repeat(500), i + 1));
            const reservedWireBytes = 100;
            const perMessageWireBytes = wireBytesOf(messages[0]);
            const limits: BackfillBatchLimits = {
                maxMessages: 100,
                maxContentBytes: 100_000,
                maxMessageBytes: 100_000,
                // Room for exactly two messages plus the comma between them.
                maxWireBytes: reservedWireBytes + perMessageWireBytes * 2 + 1
            };

            const plan = planMeilisearchBackfillBatches(messages, reservedWireBytes, limits);

            expect(plan.batches.map(batch => batch.length)).toEqual([2, 2]);
            expect(plan.skipped).toEqual([]);
            // Confirms the content limit was not what forced this split.
            const totalContentBytes = messages.reduce((sum, m) => sum + Buffer.byteLength(m.content, 'utf8'), 0);
            expect(totalContentBytes).toBeLessThan(limits.maxContentBytes);
        });

        it('skips a message whose own content exceeds the per-message limit, and still batches the rest', () => {
            const big = makeMessage('big', 'x'.repeat(MAX_MEILISEARCH_MESSAGE_BYTES + 1), 1);
            const messages = [big, makeMessage('small-1', 'hello', 2), makeMessage('small-2', 'world', 3)];

            const plan = planMeilisearchBackfillBatches(messages, 200);

            expect(plan.batches).toEqual([[messages[1], messages[2]]]);
            expect(plan.skipped).toHaveLength(1);
            expect(plan.skipped[0].id).toBe('big');
            expect(plan.skipped[0].contentBytes).toBe(MAX_MEILISEARCH_MESSAGE_BYTES + 1);
            expect(plan.skipped[0].reason).toContain('per-message limit');
        });

        it('skips a single message that cannot fit an otherwise-empty batch under a custom content limit', () => {
            // Under the per-message limit (default 64KiB) but over a custom, much
            // smaller batch content limit — reachable only with non-default limits.
            const message = makeMessage('too-big-for-any-batch', 'z'.repeat(200), 1);
            const limits: BackfillBatchLimits = {
                maxMessages: 50,
                maxContentBytes: 100,
                maxWireBytes: DEFAULT_BACKFILL_BATCH_LIMITS.maxWireBytes,
                maxMessageBytes: DEFAULT_BACKFILL_BATCH_LIMITS.maxMessageBytes
            };

            const plan = planMeilisearchBackfillBatches([message], 200, limits);

            expect(plan.batches).toEqual([]);
            expect(plan.skipped).toHaveLength(1);
            expect(plan.skipped[0].id).toBe('too-big-for-any-batch');
            expect(plan.skipped[0].reason).toContain('content limit');
        });

        it('preserves input order across batches and skipped messages', () => {
            const oversized = makeMessage('oversized', 'x'.repeat(MAX_MEILISEARCH_MESSAGE_BYTES + 1), 2);
            const messages = [
                makeMessage('first', 'a', 1),
                oversized,
                makeMessage('third', 'c', 3),
                makeMessage('fourth', 'd', 4)
            ];

            const plan = planMeilisearchBackfillBatches(messages, 200);

            expect(plan.batches.flat().map(m => m.id)).toEqual(['first', 'third', 'fourth']);
            expect(plan.skipped.map(s => s.id)).toEqual(['oversized']);
        });

        it('rejects a negative reservedWireBytes', () => {
            expect(() => planMeilisearchBackfillBatches([], -1)).toThrow(/reservedWireBytes/);
        });

        it('rejects a reservedWireBytes at or above the wire limit', () => {
            const limits: BackfillBatchLimits = { ...DEFAULT_BACKFILL_BATCH_LIMITS, maxWireBytes: 1000 };
            expect(() => planMeilisearchBackfillBatches([], 1000, limits)).toThrow(/reservedWireBytes/);
            expect(() => planMeilisearchBackfillBatches([], 1500, limits)).toThrow(/reservedWireBytes/);
        });

        it('rejects a non-integer reservedWireBytes', () => {
            expect(() => planMeilisearchBackfillBatches([], 10.5)).toThrow(/reservedWireBytes/);
        });

        it.each([
            ['maxMessages', { maxMessages: 0 }],
            ['maxMessages', { maxMessages: -1 }],
            ['maxMessages', { maxMessages: 1.5 }],
            ['maxContentBytes', { maxContentBytes: 0 }],
            ['maxWireBytes', { maxWireBytes: 0 }],
            ['maxMessageBytes', { maxMessageBytes: 0 }]
        ])('rejects an invalid %s limit', (field, override) => {
            const limits: BackfillBatchLimits = { ...DEFAULT_BACKFILL_BATCH_LIMITS, ...override };
            expect(() => planMeilisearchBackfillBatches([], 0, limits)).toThrow(new RegExp(field));
        });
    });
});
