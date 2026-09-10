import { PhaseStrataRouter } from '@mxf-dev/core/services/orpar-memory/PhaseStrataRouter';
import { StratumManager } from '@mxf-dev/core/services/StratumManager';
import { QValueManager } from '@mxf-dev/core/services/QValueManager';
import { MemoryEntry, MemoryImportance, MemoryStratum, MemoryRetrievalResult } from '@mxf-dev/core/types/MemoryStrataTypes';

jest.mock('@mxf-dev/core/config/orpar-memory.config', () => ({
    isOrparMemoryIntegrationEnabled: (): boolean => true,
    getOrparMemoryConfig: (): { phaseStrataMappings: unknown[] } => ({ phaseStrataMappings: [{
        phase: 'observation', primaryStrata: ['working'], secondaryStrata: ['episodic'], lambda: 0.2
    }] })
}));

const memory = (id: string, accessCount: number): MemoryEntry => ({
    id, accessCount, stratum: MemoryStratum.Working, content: id, contentType: 'text',
    importance: MemoryImportance.Medium, tags: [], source: { type: 'observation', agentId: 'agent' },
    context: { agentId: 'agent', timestamp: new Date() }, relatedMemories: [],
    createdAt: new Date(), lastAccessed: new Date()
});

const result = (entries: Array<[MemoryEntry, number]>): MemoryRetrievalResult => ({
    memories: entries.map(([entry]) => entry),
    scores: new Map(entries.map(([entry, score]) => [entry.id, score])),
    totalCount: entries.length,
    executionTime: 0
});

describe('PhaseStrataRouter query relevance and utility', () => {
    const router = PhaseStrataRouter.getInstance();
    const strata = StratumManager.getInstance();
    const qValues = QValueManager.getInstance();
    let query: jest.SpyInstance;

    beforeEach(() => {
        router.initialize();
        jest.spyOn(strata, 'isEnabled').mockReturnValue(true);
        jest.spyOn(qValues, 'isEnabled').mockReturnValue(true);
        const utilities: Record<string, number> = { popular: 0.9, relevant: 0.1, duplicate: 0.6, channel: 0.7 };
        jest.spyOn(qValues, 'getQValue').mockImplementation(id => utilities[id]);
        query = jest.spyOn(strata, 'queryMemories')
            .mockResolvedValueOnce(result([[memory('popular', 100), 0.1], [memory('duplicate', 20), 0.2]]))
            .mockResolvedValueOnce(result([[memory('relevant', 0), 0.9]]))
            .mockResolvedValueOnce(result([[memory('duplicate', 20), 0.8]]))
            .mockResolvedValueOnce(result([[memory('channel', 10), 0.5]]));
    });

    afterEach(() => jest.restoreAllMocks());

    it.each([
        [0, ['relevant', 'duplicate', 'channel', 'popular']],
        [1, ['popular', 'channel', 'duplicate', 'relevant']],
        [0.5, ['duplicate', 'channel', 'relevant', 'popular']]
    ])('ranks combined scopes by lambda %s and retains each memory once', async (lambda, expected) => {
        const retrieved = await router.retrieve({
            agentId: 'agent', channelId: 'channel', phase: 'observation', query: 'topic', lambda: lambda as number
        });
        expect(retrieved.memories.map(entry => entry.id)).toEqual(expected);
        expect(query).toHaveBeenCalledTimes(4);
    });

    it('uses query relevance across scopes when utility learning is disabled', async () => {
        jest.spyOn(qValues, 'isEnabled').mockReturnValue(false);
        const retrieved = await router.retrieve({
            agentId: 'agent', channelId: 'channel', phase: 'observation', query: 'topic'
        });
        expect(retrieved.memories.map(entry => entry.id)).toEqual(['relevant', 'duplicate', 'channel', 'popular']);
    });
});
