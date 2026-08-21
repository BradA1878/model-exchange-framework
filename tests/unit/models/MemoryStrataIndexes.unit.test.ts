import {
    MemoryEntryModel,
    SurpriseHistoryModel
} from '../../../packages/core/src/models/memoryStrata';

const duplicateIndexKeys = (
    indexes: Array<[Record<string, unknown>, Record<string, unknown>]>
): string[] => {
    const counts = new Map<string, number>();
    for (const [keys] of indexes) {
        const signature = JSON.stringify(keys);
        counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
    return [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([signature]) => signature);
};

describe('memory strata index declarations', () => {
    it('declares each MemoryEntry index key exactly once', () => {
        expect(duplicateIndexKeys(MemoryEntryModel.schema.indexes())).toEqual([]);
        expect(MemoryEntryModel.schema.indexes()).toContainEqual([
            { expiresAt: 1 },
            expect.objectContaining({ expireAfterSeconds: 0 })
        ]);
    });

    it('keeps one SurpriseHistory TTL index alongside its compound query index', () => {
        expect(duplicateIndexKeys(SurpriseHistoryModel.schema.indexes())).toEqual([]);
        expect(SurpriseHistoryModel.schema.indexes()).toContainEqual([
            { timestamp: 1 },
            expect.objectContaining({ expireAfterSeconds: 7776000 })
        ]);
        expect(SurpriseHistoryModel.schema.indexes()).toContainEqual([
            { agentId: 1, timestamp: -1 },
            expect.any(Object)
        ]);
    });
});
