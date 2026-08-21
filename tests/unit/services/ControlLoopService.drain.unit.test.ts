/**
 * ORPAR pattern persistence must be visible to the EventBus shutdown drain.
 *
 * A completed observation → reflection cycle triggers pattern analysis and a
 * memory write. If that chain is not returned from the event handler, the
 * drain reports no pending work and the database can be closed underneath
 * the write.
 */

const analyzeSequenceForPatterns = jest.fn();
const storePattern = jest.fn();

jest.mock('../../../src/server/services/PatternMemoryService', () => ({
    PatternMemoryService: {
        getInstance: jest.fn(() => ({ analyzeSequenceForPatterns, storePattern }))
    }
}));

jest.mock('@mxf-dev/core/services/AgentPerformanceService', () => ({
    AgentPerformanceService: { getInstance: jest.fn(() => ({})) }
}));

jest.mock('../../../src/server/socket/services/SystemLlmService', () => ({
    SystemLlmService: jest.fn()
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: jest.fn()
}));

const executeActionCalls: Array<{ resolve: () => void }> = [];

jest.mock('../../../src/server/socket/implementations/ControlLoop', () => ({
    ControlLoop: class MockControlLoop {
        public constructor(
            private readonly agentId: string,
            private readonly loopId: string
        ) {}

        public initialize(): Promise<boolean> {
            return Promise.resolve(true);
        }

        public start(): Promise<boolean> {
            return Promise.resolve(true);
        }

        public stop(): Promise<boolean> {
            return Promise.resolve(true);
        }

        public getLoopId(): string {
            return this.loopId;
        }

        public executeAction(): Promise<void> {
            return new Promise<void>(resolve => {
                executeActionCalls.push({ resolve });
            });
        }
    }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { ControlLoopEvents } from '@mxf-dev/core/events/event-definitions/ControlLoopEvents';
import { createControlLoopEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { ControlLoopService } from '../../../src/server/socket/services/ControlLoopService';

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('ControlLoopService ORPAR pattern drain', () => {
    beforeEach(() => {
        EventBus.reset();
        analyzeSequenceForPatterns.mockReset();
        storePattern.mockReset();
        executeActionCalls.length = 0;
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        new ControlLoopService();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
    });

    it('keeps a pending pattern analysis and store inside the EventBus drain', async () => {
        const analysis = deferred<{
            patternDetected: boolean;
            confidence: number;
            metadata: Record<string, unknown>;
        }>();
        const store = deferred<void>();
        analyzeSequenceForPatterns.mockReturnValueOnce(analysis.promise);
        storePattern.mockReturnValueOnce(store.promise);

        const agentId = 'orpar-agent';
        const channelId = 'orpar-channel';
        for (const phase of [
            ControlLoopEvents.OBSERVATION,
            ControlLoopEvents.REASONING,
            ControlLoopEvents.PLAN,
            ControlLoopEvents.ACTION,
            ControlLoopEvents.REFLECTION
        ]) {
            EventBus.server.emit(
                phase,
                createControlLoopEventPayload(phase, agentId, channelId, { loopId: 'orpar-loop', phase })
            );
        }
        expect(analyzeSequenceForPatterns).toHaveBeenCalledTimes(1);

        let drainSettled = false;
        const drain = EventBus.drain().then((): void => {
            drainSettled = true;
        });
        await Promise.resolve();
        expect(drainSettled).toBe(false);

        analysis.resolve({
            patternDetected: true,
            confidence: 0.9,
            metadata: { toolsInvolved: [], complexity: 1, estimatedEffectiveness: 0.8 }
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(storePattern).toHaveBeenCalledTimes(1);
        expect(drainSettled).toBe(false);

        store.resolve();
        await drain;
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });

    it('keeps an in-flight action execution inside the EventBus drain', async () => {
        const agentId = 'action-agent';
        const channelId = 'action-channel';
        const loopId = 'action-loop';
        const clientRequest = (eventType: string, data: Record<string, unknown>): Record<string, unknown> => ({
            eventId: `${eventType}-${agentId}`,
            eventType,
            timestamp: Date.now(),
            agentId,
            channelId,
            source: 'client',
            data: { loopId, ...data }
        });

        EventBus.server.emit(
            ControlLoopEvents.INITIALIZE,
            clientRequest(ControlLoopEvents.INITIALIZE, { config: { loopId } }) as never
        );
        await new Promise<void>(resolve => setImmediate(resolve));

        EventBus.server.emit(
            ControlLoopEvents.EXECUTION_REQUEST,
            clientRequest(ControlLoopEvents.EXECUTION_REQUEST, {
                action: { id: 'action-1', type: 'execute' }
            }) as never
        );
        expect(executeActionCalls).toHaveLength(1);

        let drainSettled = false;
        const drain = EventBus.drain().then((): void => {
            drainSettled = true;
        });
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(drainSettled).toBe(false);

        executeActionCalls[0].resolve();
        await drain;
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });
});
