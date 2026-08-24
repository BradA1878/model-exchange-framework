/**
 * Property-based tests for MeilisearchBackfillBatching
 * Uses fast-check to generate random message lists and batch limits and
 * verify the planner's invariants hold regardless of input shape.
 */
import fc from 'fast-check';
import {
    planMeilisearchBackfillBatches,
    BackfillBatchLimits,
    BackfillWireMessage
} from '@mxf-dev/sdk/managers/MeilisearchBackfillBatching';

/** Mixes plain ASCII with characters that inflate under JSON escaping or UTF-8 encoding. */
const CHAR_POOL = ['a', 'B', '9', ' ', '"', "'", '\\', '\n', '\t', '€', '中', '🙂'];

/** Content length in bytes is mostly small, occasionally up to 150KiB, to keep runs fast. */
const contentLengthArb = fc.oneof(
    { weight: 6, arbitrary: fc.integer({ min: 0, max: 2000 }) },
    { weight: 1, arbitrary: fc.integer({ min: 2000, max: 150 * 1024 }) }
);

const contentArb = contentLengthArb.chain(length =>
    fc.array(fc.constantFrom(...CHAR_POOL), { minLength: length, maxLength: length }).map(chars => chars.join(''))
);

const messagesArb: fc.Arbitrary<BackfillWireMessage[]> = fc
    .array(contentArb, { minLength: 0, maxLength: 6 })
    .map(contents => contents.map((content, index) => ({
        id: `msg-${index}`,
        role: 'user' as const,
        content,
        timestamp: index + 1
    })));

const limitsArb: fc.Arbitrary<BackfillBatchLimits> = fc.record({
    maxMessages: fc.integer({ min: 1, max: 50 }),
    maxContentBytes: fc.integer({ min: 1024, max: 600 * 1024 }),
    maxWireBytes: fc.integer({ min: 2048, max: 800 * 1024 }),
    maxMessageBytes: fc.integer({ min: 512, max: 200 * 1024 })
});

/** reservedWireBytes must be a non-negative safe integer strictly below maxWireBytes. */
const limitsWithReservedArb = limitsArb.chain(limits =>
    fc.integer({ min: 0, max: limits.maxWireBytes - 1 }).map(reservedWireBytes => ({ limits, reservedWireBytes }))
);

/** True when `subsequence`'s elements appear in `full` in the same relative order. */
const isSubsequence = (subsequence: readonly string[], full: readonly string[]): boolean => {
    let cursor = 0;
    for (const id of full) {
        if (cursor < subsequence.length && subsequence[cursor] === id) {
            cursor += 1;
        }
    }
    return cursor === subsequence.length;
};

describe('MeilisearchBackfillBatching Property Tests', () => {
    describe('planMeilisearchBackfillBatches', () => {
        it('places every input message in exactly one batch or in skipped, preserving order', () => {
            fc.assert(
                fc.property(messagesArb, limitsWithReservedArb, (messages, { limits, reservedWireBytes }) => {
                    const plan = planMeilisearchBackfillBatches(messages, reservedWireBytes, limits);

                    const batchedIds = plan.batches.flat().map(m => m.id);
                    const skippedIds = plan.skipped.map(s => s.id);
                    const inputIds = messages.map(m => m.id);

                    // Every id appears exactly once across batches + skipped, none invented.
                    const outputIds = [...batchedIds, ...skippedIds];
                    expect([...outputIds].sort()).toEqual([...inputIds].sort());
                    expect(new Set(outputIds).size).toBe(outputIds.length);

                    // Relative order is preserved within each destination.
                    expect(isSubsequence(batchedIds, inputIds)).toBe(true);
                    expect(isSubsequence(skippedIds, inputIds)).toBe(true);

                    return true;
                }),
                { numRuns: 20 }
            );
        });

        it('keeps every batch within all four limits, recomputed independently', () => {
            fc.assert(
                fc.property(messagesArb, limitsWithReservedArb, (messages, { limits, reservedWireBytes }) => {
                    const plan = planMeilisearchBackfillBatches(messages, reservedWireBytes, limits);

                    for (const batch of plan.batches) {
                        expect(batch.length).toBeGreaterThan(0);
                        expect(batch.length).toBeLessThanOrEqual(limits.maxMessages);

                        const contentBytes = batch.reduce(
                            (sum, message) => sum + Buffer.byteLength(message.content, 'utf8'),
                            0
                        );
                        expect(contentBytes).toBeLessThanOrEqual(limits.maxContentBytes);

                        const wireBytes = reservedWireBytes +
                            batch.reduce((sum, message) => sum + Buffer.byteLength(JSON.stringify(message), 'utf8'), 0) +
                            Math.max(0, batch.length - 1);
                        expect(wireBytes).toBeLessThanOrEqual(limits.maxWireBytes);

                        for (const message of batch) {
                            expect(Buffer.byteLength(message.content, 'utf8')).toBeLessThanOrEqual(limits.maxMessageBytes);
                        }
                    }

                    return true;
                }),
                { numRuns: 20 }
            );
        });

        it('only skips a message that could never fit any batch alone', () => {
            fc.assert(
                fc.property(messagesArb, limitsWithReservedArb, (messages, { limits, reservedWireBytes }) => {
                    const plan = planMeilisearchBackfillBatches(messages, reservedWireBytes, limits);

                    for (const skippedMessage of plan.skipped) {
                        const original = messages.find(m => m.id === skippedMessage.id);
                        expect(original).toBeDefined();
                        const contentBytes = Buffer.byteLength(original!.content, 'utf8');
                        const wireBytesAlone = reservedWireBytes + Buffer.byteLength(JSON.stringify(original), 'utf8');
                        const tooLargeAlone = contentBytes > limits.maxMessageBytes ||
                            contentBytes > limits.maxContentBytes ||
                            wireBytesAlone > limits.maxWireBytes;
                        expect(tooLargeAlone).toBe(true);
                    }

                    return true;
                }),
                { numRuns: 20 }
            );
        });
    });
});
