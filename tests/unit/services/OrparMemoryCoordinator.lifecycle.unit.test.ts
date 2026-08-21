import type { Subscription } from 'rxjs';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events, ControlLoopEvents } from '@mxf-dev/core/events/EventNames';
import { KnowledgeGraphEvents } from '@mxf-dev/core/events/event-definitions/KnowledgeGraphEvents';
import { OrparMemoryEvents } from '@mxf-dev/core/events/event-definitions/OrparMemoryEvents';
import { resetKnowledgeGraphConfig } from '@mxf-dev/core/config/knowledge-graph.config';
import { resetOrparMemoryConfig } from '@mxf-dev/core/config/orpar-memory.config';
import { OrparMemoryCoordinator } from '@mxf-dev/core/services/orpar-memory/OrparMemoryCoordinator';
import { createTaskEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';

interface CoordinatorLifecycleInternals {
    initialized: boolean;
    eventSubscriptions: Subscription[];
    cleanupIntervalId: NodeJS.Timeout | null;
    recentlyCompletedCycles: Map<string, unknown>;
    recentlyCompletedExpiryTimers: Map<string, NodeJS.Timeout>;
    scheduleRecentlyCompletedExpiry(cacheKey: string): void;
}

const ENV_KEYS = [
    'ORPAR_MEMORY_INTEGRATION_ENABLED',
    'KNOWLEDGE_GRAPH_ENABLED',
    'KG_SURPRISE_ENABLED',
] as const;

describe('OrparMemoryCoordinator lifecycle', () => {
    const coordinator = OrparMemoryCoordinator.getInstance();
    const internals = coordinator as unknown as CoordinatorLifecycleInternals;
    const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]));

    beforeEach(() => {
        coordinator.reset();
        EventBus.reset();
        jest.useFakeTimers();

        process.env.ORPAR_MEMORY_INTEGRATION_ENABLED = 'true';
        process.env.KNOWLEDGE_GRAPH_ENABLED = 'true';
        process.env.KG_SURPRISE_ENABLED = 'true';
        resetOrparMemoryConfig();
        resetKnowledgeGraphConfig();
    });

    afterEach(() => {
        coordinator.reset();
        EventBus.reset();
        jest.restoreAllMocks();
        jest.clearAllTimers();
        jest.useRealTimers();
        resetKnowledgeGraphConfig();
    });

    afterAll(() => {
        for (const [key, value] of originalEnv) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        resetOrparMemoryConfig();
        resetKnowledgeGraphConfig();
    });

    it('owns every enabled timer and subscription across idempotent shutdown and reinitialization', () => {
        expect(jest.getTimerCount()).toBe(0);
        expect(EventBus.server.listenerCount(ControlLoopEvents.OBSERVATION)).toBe(0);

        coordinator.initialize();

        const firstCoordinatorSubscriptions = [...internals.eventSubscriptions];
        expect(internals.initialized).toBe(true);
        expect(firstCoordinatorSubscriptions).toHaveLength(12);
        expect(EventBus.server.listenerCount(ControlLoopEvents.OBSERVATION)).toBe(1);
        expect(EventBus.server.listenerCount(Events.Task.COMPLETED)).toBe(1);
        expect(EventBus.server.listenerCount(OrparMemoryEvents.CYCLE_COMPLETED)).toBe(1);
        expect(EventBus.server.listenerCount(KnowledgeGraphEvents.HIGH_SURPRISE_RELATIONSHIP)).toBe(1);
        expect(jest.getTimerCount()).toBe(1);
        expect(internals.cleanupIntervalId?.hasRef()).toBe(false);

        coordinator.initialize();

        expect(internals.eventSubscriptions).toHaveLength(12);
        expect(EventBus.server.listenerCount(ControlLoopEvents.OBSERVATION)).toBe(1);
        expect(EventBus.server.listenerCount(OrparMemoryEvents.CYCLE_COMPLETED)).toBe(1);

        const cacheKey = 'agent-a:task-a';
        internals.recentlyCompletedCycles.set(cacheKey, {});
        internals.scheduleRecentlyCompletedExpiry(cacheKey);
        const expiryTimer = internals.recentlyCompletedExpiryTimers.get(cacheKey);

        expect(expiryTimer).toBeDefined();
        expect(expiryTimer?.hasRef()).toBe(false);
        expect(jest.getTimerCount()).toBe(2);

        coordinator.shutdown();
        coordinator.shutdown();

        expect(internals.initialized).toBe(false);
        expect(firstCoordinatorSubscriptions.every(subscription => subscription.closed)).toBe(true);
        expect(internals.eventSubscriptions).toHaveLength(0);
        expect(internals.recentlyCompletedCycles.size).toBe(0);
        expect(internals.recentlyCompletedExpiryTimers.size).toBe(0);
        expect(EventBus.server.listenerCount(ControlLoopEvents.OBSERVATION)).toBe(0);
        expect(EventBus.server.listenerCount(Events.Task.COMPLETED)).toBe(0);
        expect(EventBus.server.listenerCount(OrparMemoryEvents.CYCLE_COMPLETED)).toBe(0);
        expect(EventBus.server.listenerCount(KnowledgeGraphEvents.HIGH_SURPRISE_RELATIONSHIP)).toBe(0);
        expect(jest.getTimerCount()).toBe(0);

        coordinator.initialize();

        expect(internals.eventSubscriptions).toHaveLength(12);
        expect(internals.eventSubscriptions[0]).not.toBe(firstCoordinatorSubscriptions[0]);
        expect(EventBus.server.listenerCount(ControlLoopEvents.OBSERVATION)).toBe(1);
        expect(EventBus.server.listenerCount(OrparMemoryEvents.CYCLE_COMPLETED)).toBe(1);
        expect(EventBus.server.listenerCount(KnowledgeGraphEvents.HIGH_SURPRISE_RELATIONSHIP)).toBe(1);
        expect(jest.getTimerCount()).toBe(1);
    });

    it('keeps a deferred retroactive reward update inside the EventBus shutdown drain', async () => {
        coordinator.initialize();

        let releaseRewardUpdate!: () => void;
        const deferredRewardUpdate = new Promise<{ rewards: []; updated: number }>(resolve => {
            releaseRewardUpdate = (): void => resolve({ rewards: [], updated: 1 });
        });
        const processOutcome = jest
            .spyOn(coordinator.getPhaseRewarder(), 'processOutcome')
            .mockReturnValueOnce(deferredRewardUpdate);

        internals.recentlyCompletedCycles.set('agent-a:task-a', {
            cycleMemoryUsage: {
                cycleId: 'cycle-a',
                agentId: 'agent-a',
                channelId: 'channel-a',
                taskId: 'task-a',
                phaseUsage: {
                    observation: [],
                    reasoning: [],
                    planning: [],
                    action: [],
                    reflection: [],
                },
                startedAt: new Date(),
            },
            outcome: {
                success: false,
                errorCount: 1,
                toolCallCount: 1,
                taskCompleted: false,
            },
            completedAt: Date.now(),
        });

        EventBus.server.emit(
            Events.Task.COMPLETED,
            createTaskEventPayload(Events.Task.COMPLETED, 'agent-a', 'channel-a', {
                taskId: 'task-a',
                task: {
                    title: 'Deferred reward task',
                    description: 'Prove the reward write is drained',
                    assignmentStrategy: 'manual',
                },
            })
        );
        expect(processOutcome).toHaveBeenCalledTimes(1);

        let drainSettled = false;
        const drain = EventBus.drain().then((): void => {
            drainSettled = true;
        });
        await Promise.resolve();

        expect(drainSettled).toBe(false);
        expect(EventBus.server.pendingHandlerCount()).toBe(1);

        releaseRewardUpdate();
        await drain;

        expect(EventBus.server.pendingHandlerCount()).toBe(0);
        expect(internals.recentlyCompletedCycles.has('agent-a:task-a')).toBe(false);
    });
});
