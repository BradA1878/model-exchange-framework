/**
 * AgentPerformanceService and ValidationPerformanceService own EventBus
 * subscriptions and write metrics to agent memory. Like every other
 * validation service they must release those subscriptions on shutdown, and
 * their metric writes must stay visible to the EventBus shutdown drain.
 */

import { Subject } from 'rxjs';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { AgentPerformanceService } from '@mxf-dev/core/services/AgentPerformanceService';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { ValidationPerformanceService } from '@mxf-dev/core/services/ValidationPerformanceService';
import { Logger } from '@mxf-dev/core/utils/Logger';

type SingletonHolder<T> = { instance?: T };

const resetSingletons = (): void => {
    (AgentPerformanceService as unknown as SingletonHolder<AgentPerformanceService>).instance = undefined;
    (ValidationPerformanceService as unknown as SingletonHolder<ValidationPerformanceService>).instance = undefined;
    (MemoryService as unknown as SingletonHolder<MemoryService>).instance = undefined;
};

const toolResult = (toolName: string): ReturnType<typeof createBaseEventPayload> =>
    createBaseEventPayload(Events.Mcp.TOOL_RESULT, 'perf-agent', 'perf-channel', {
        toolName,
        result: { ok: true }
    });

describe('performance services lifecycle', () => {
    beforeEach(() => {
        EventBus.reset();
        resetSingletons();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
        resetSingletons();
    });

    it('releases every EventBus subscription on shutdown and resets the singletons', () => {
        const validationPerformance = ValidationPerformanceService.getInstance();
        const agentPerformance = AgentPerformanceService.getInstance();
        expect(EventBus.server.listenerCount(Events.Mcp.TOOL_RESULT)).toBe(2);
        expect(EventBus.server.listenerCount(Events.ControlLoop.OBSERVATION)).toBe(1);

        validationPerformance.shutdown();
        agentPerformance.shutdown();
        // Safe to repeat.
        validationPerformance.shutdown();
        agentPerformance.shutdown();

        expect(EventBus.server.allListenerCount()).toBe(0);
        expect(AgentPerformanceService.getInstance()).not.toBe(agentPerformance);
        expect(ValidationPerformanceService.getInstance()).not.toBe(validationPerformance);
    });

    it('keeps a pending metrics write inside the EventBus drain', async () => {
        const write = new Subject<never>();
        const updateAgentMemory = jest
            .spyOn(MemoryService.prototype, 'updateAgentMemory')
            .mockReturnValue(write.asObservable() as never);
        AgentPerformanceService.getInstance();

        EventBus.server.emit(Events.Mcp.TOOL_RESULT, toolResult('perf_tool'));

        let drainSettled = false;
        const drain = EventBus.drain().then((): void => {
            drainSettled = true;
        });
        for (let tick = 0; tick < 6; tick += 1) {
            await Promise.resolve();
        }
        expect(updateAgentMemory).toHaveBeenCalled();
        expect(drainSettled).toBe(false);
        expect(EventBus.server.pendingHandlerCount()).toBe(1);

        write.complete();
        await drain;
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });

    it('reports a failed metrics write as a warning instead of an unhandled rejection', async () => {
        jest.spyOn(MemoryService.prototype, 'updateAgentMemory').mockImplementation(() => {
            const failing = new Subject<never>();
            queueMicrotask(() => failing.error(new Error('metrics store unavailable')));
            return failing.asObservable() as never;
        });
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        AgentPerformanceService.getInstance();

        EventBus.server.emit(Events.Mcp.TOOL_RESULT, toolResult('perf_tool'));
        await EventBus.drain();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('metrics store unavailable'));
    });
});
