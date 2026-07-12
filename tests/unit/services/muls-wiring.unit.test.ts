/**
 * MULS wiring tests — does memory-utility learning actually influence anything?
 *
 * These tests exist because the existing MULS unit and integration tests all called the
 * learning services directly (QValueManager.updateQValue(...), SurpriseCalculator
 * .calculateSurprise(...), and so on). Every one of them passed while the entire pipeline
 * was disconnected in production: no code recorded which memories a task used, no
 * reachable retrieval path applied Q-weighted ranking, and the Q-value persistence sink
 * was never implemented — so nothing was learned, ranked, or retained.
 *
 * The distinction this file enforces is between "the components work" and "the components
 * are wired together". So these tests drive the real production entry points — the actual
 * memory_search_conversations tool handler and a real Events.Task.COMPLETED on the event
 * bus — and assert that a Q-value moved and was persisted. Calling the learning services
 * directly here would reproduce the original blind spot.
 *
 * Meilisearch and MongoDB are the only things stubbed; they are external systems, not the
 * behaviour under test.
 */

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { QValueManager } from '@mxf-dev/core/services/QValueManager';
import { RewardSignalProcessor } from '@mxf-dev/core/services/RewardSignalProcessor';
import { UtilityScorerService } from '@mxf-dev/core/services/UtilityScorerService';
import { MxfMeilisearchService } from '@mxf-dev/core/services/MxfMeilisearchService';
import { memory_search_conversations } from '@mxf-dev/core/protocols/mcp/tools/MemorySearchTools';
import { IMemoryPersistence } from '@mxf-dev/core/interfaces/IMemoryPersistence';
import { MemoryUtilitySubdocument, DEFAULT_REWARD_MAPPING } from '@mxf-dev/core/types/MemoryUtilityTypes';

const AGENT_ID = 'muls-agent';
const CHANNEL_ID = 'muls-channel';
const DEFAULT_Q = 0.5;

/**
 * In-memory stand-in for the server's MemoryPersistenceService. Records every write so a
 * test can assert that a learned Q-value actually reached persistence.
 */
class FakeMemoryPersistence implements IMemoryPersistence {
    public readonly writes: Array<{ memoryId: string; utility: Partial<MemoryUtilitySubdocument> }> = [];
    private readonly stored = new Map<string, MemoryUtilitySubdocument>();

    getAgentMemory(): any { throw new Error('not used in these tests'); }
    saveAgentMemory(): any { throw new Error('not used in these tests'); }
    saveChannelMemory(): any { throw new Error('not used in these tests'); }

    async updateAgentMemoryUtility(
        memoryId: string,
        utility: Partial<MemoryUtilitySubdocument>
    ): Promise<void> {
        this.writes.push({ memoryId, utility });
        const existing = this.stored.get(memoryId);
        this.stored.set(memoryId, { ...existing, ...utility } as MemoryUtilitySubdocument);
    }

    async getAgentMemoryUtilities(memoryIds: string[]): Promise<Map<string, MemoryUtilitySubdocument>> {
        const result = new Map<string, MemoryUtilitySubdocument>();
        for (const id of memoryIds) {
            const found = this.stored.get(id);
            if (found) result.set(id, found);
        }
        return result;
    }

    /** Seed a stored Q-value, as if it had been learned in a previous run. */
    seed(memoryId: string, qValue: number): void {
        this.stored.set(memoryId, { qValue } as MemoryUtilitySubdocument);
    }
}

/** Build a Meilisearch hit in the shape ConversationDocument search returns. */
const hit = (id: string, rankingScore: number) => ({
    id,
    agentId: AGENT_ID,
    channelId: CHANNEL_ID,
    role: 'assistant' as const,
    content: `content of ${id}`,
    timestamp: Date.now(),
    _rankingScore: rankingScore
});

/** Stub the Meilisearch client so search returns a fixed candidate set. */
const stubSearch = (hits: ReturnType<typeof hit>[]) => {
    jest.spyOn(MxfMeilisearchService, 'getInstance').mockReturnValue({
        searchConversations: jest.fn().mockResolvedValue({
            hits,
            query: 'q',
            processingTimeMs: 1,
            limit: hits.length,
            offset: 0,
            estimatedTotalHits: hits.length
        })
    } as unknown as MxfMeilisearchService);
};

const runSearch = () =>
    memory_search_conversations.handler(
        { query: 'deployment rollback' },
        { requestId: 'req-1', agentId: AGENT_ID, channelId: CHANNEL_ID, data: {} }
    );

/**
 * Emit a real task-completion event in the shape the server actually forwards: the task
 * object lives at `data.task` (TaskEventData), and its status lives on that object.
 */
const completeTask = async (taskId: string, status: 'completed' | 'failed') => {
    const event = status === 'completed' ? Events.Task.COMPLETED : Events.Task.FAILED;
    EventBus.server.emit(
        event,
        createBaseEventPayload(event, AGENT_ID, CHANNEL_ID, {
            taskId,
            task: { id: taskId, status }
        })
    );
    // handleTaskCompleted is async; let its microtasks settle.
    await new Promise(resolve => setImmediate(resolve));
};

describe('MULS wiring — learning must reach retrieval and persistence', () => {
    let persistence: FakeMemoryPersistence;
    let qValueManager: QValueManager;
    let memoryService: MemoryService;

    beforeEach(() => {
        jest.restoreAllMocks();

        persistence = new FakeMemoryPersistence();

        qValueManager = QValueManager.getInstance();
        qValueManager.initialize({ enabled: true, defaultQValue: DEFAULT_Q, learningRate: 0.5 });
        qValueManager.clearCache();

        UtilityScorerService.getInstance().initialize({ enabled: true });

        RewardSignalProcessor.getInstance().initialize({
            enabled: true,
            rewardMapping: DEFAULT_REWARD_MAPPING,
            trackMemoryUsage: true
        });

        memoryService = MemoryService.getInstance({ persistenceService: persistence });
        // MemoryService is a singleton, so a prior test may have constructed it without
        // persistence. Inject explicitly to keep these tests order-independent.
        (memoryService as unknown as { persistenceService: IMemoryPersistence }).persistenceService = persistence;

        // The registration performed at server boot (src/server/index.ts, Step 0.1).
        qValueManager.setPersistenceCallback((memoryId, utility) =>
            memoryService.updateMemoryUtility(memoryId, utility)
        );
    });

    it('records retrieved memories so a completed task can reward them', async () => {
        stubSearch([hit('mem-a', 0.9), hit('mem-b', 0.8)]);

        await runSearch();

        // Retrieval must have registered the memories against the agent, otherwise the
        // reward processor has nothing to attribute the task outcome to.
        const stats = RewardSignalProcessor.getInstance().getTrackingStats();
        expect(stats.bufferedMemories).toBe(2);
    });

    it('raises the Q-value of memories used by a successful task, and persists it', async () => {
        stubSearch([hit('mem-a', 0.9)]);

        await runSearch();
        await completeTask('task-success', 'completed');

        // Learned in memory...
        expect(qValueManager.getQValue('mem-a')).toBeGreaterThan(DEFAULT_Q);

        // ...and actually written through to persistence. This is the assertion that
        // fails if the persistence callback is not registered, or if the persistence
        // method silently no-ops — the original bug.
        const write = persistence.writes.find(w => w.memoryId === 'mem-a');
        expect(write).toBeDefined();
        expect(write!.utility.qValue).toBeGreaterThan(DEFAULT_Q);
    });

    it('lowers the Q-value of memories used by a failed task', async () => {
        stubSearch([hit('mem-c', 0.9)]);

        await runSearch();
        await completeTask('task-failed', 'failed');

        expect(qValueManager.getQValue('mem-c')).toBeLessThan(DEFAULT_Q);
    });

    it('lets a learned Q-value outrank a more semantically similar memory', async () => {
        // 'weak' is the better keyword match; 'strong' has been learned to be more useful.
        // If utility scoring is not applied on the retrieval path, ranking is decided by
        // similarity alone and 'weak' wins — which is what happened before this wiring.
        persistence.seed('strong', 0.95);
        stubSearch([hit('weak', 0.90), hit('strong', 0.70)]);

        const result: any = await runSearch();
        const returned = result.content.data.results.map((r: any) => r.content);

        expect(returned[0]).toBe('content of strong');
    });

    it('hydrates Q-values from persistence, so learning survives a restart', async () => {
        // Simulate a previous run having learned this value, with an empty process cache.
        persistence.seed('mem-persisted', 0.9);
        qValueManager.clearCache();
        expect(qValueManager.getQValue('mem-persisted')).toBe(DEFAULT_Q);

        stubSearch([hit('mem-persisted', 0.5)]);
        await runSearch();

        expect(qValueManager.getQValue('mem-persisted')).toBeCloseTo(0.9, 5);
    });

    it('leaves search untouched when MULS is disabled', async () => {
        qValueManager.initialize({ enabled: false, defaultQValue: DEFAULT_Q, learningRate: 0.5 });
        stubSearch([hit('mem-x', 0.9), hit('mem-y', 0.8)]);

        const result: any = await runSearch();

        expect(result.content.data.results).toHaveLength(2);
        expect(persistence.writes).toHaveLength(0);
    });
});
