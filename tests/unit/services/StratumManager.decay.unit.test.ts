import { StratumManager } from '@mxf-dev/core/services/StratumManager';
import { getMemoryStrataConfig } from '@mxf-dev/core/config/memory-strata.config';
import { MemoryImportance, MemoryStratum } from '@mxf-dev/core/types/MemoryStrataTypes';

describe('StratumManager explicit decay rate', () => {
    const manager = StratumManager.getInstance();
    const agentId = 'decay-rate-agent';

    beforeEach(async () => {
        manager.initialize({ ...getMemoryStrataConfig(), enabled: true });
        const memory = await manager.addMemory('agent', agentId, MemoryStratum.Working, {
            stratum: MemoryStratum.Working,
            content: 'retained memory',
            contentType: 'text',
            importance: MemoryImportance.High,
            tags: [],
            source: { type: 'observation', agentId },
            context: { agentId, timestamp: new Date() },
            relatedMemories: []
        });
        memory.lastAccessed = new Date(Date.now() - 86_400_000);
        jest.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        manager.clear('agent', agentId);
        jest.restoreAllMocks();
    });

    it('retains aged memories when the explicit rate is zero', async () => {
        expect(await manager.applyDecay('agent', agentId, MemoryStratum.Working, 0)).toBe(0);
        expect((await manager.queryMemories('agent', agentId, { query: 'retained' })).totalCount).toBe(1);
    });

    it('uses the configured stratum default when the rate is omitted', async () => {
        expect(await manager.applyDecay('agent', agentId, MemoryStratum.Working)).toBe(1);
    });

    it.each([NaN, Infinity, -Infinity, -0.1, 1.1])('rejects invalid decay rate %s', async rate => {
        await expect(manager.applyDecay('agent', agentId, MemoryStratum.Working, rate))
            .rejects.toThrow(/finite.*\[0, 1\]/);
        expect((await manager.queryMemories('agent', agentId, { query: 'retained' })).totalCount).toBe(1);
    });
});
