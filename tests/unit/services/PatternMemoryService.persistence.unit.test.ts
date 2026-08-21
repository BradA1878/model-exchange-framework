/**
 * storePattern must not report completion before its memory write has settled.
 * Callers keep the returned promise inside the EventBus shutdown drain; if the
 * write were left running behind the promise, the database could be closed
 * underneath it.
 */

import { Subject } from 'rxjs';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { PatternMemoryService } from '../../../src/server/services/PatternMemoryService';

describe('PatternMemoryService persistence', () => {
    const patternData = {
        channelId: 'pattern-channel',
        type: 'orpar_sequence' as const,
        pattern: {
            sequence: ['observation', 'reflection'],
            conditions: {},
            outcomes: { success: true },
            toolsUsed: [],
            executionTime: 1,
            complexity: 1
        },
        effectiveness: 0.8,
        agentParticipants: ['pattern-agent'],
        similarPatterns: [],
        tags: ['orpar'],
        metadata: {
            channelContext: 'test',
            systemState: {},
            performanceMetrics: {
                averageExecutionTime: 0,
                minExecutionTime: 0,
                maxExecutionTime: 0,
                standardDeviation: 0
            },
            confidence: 0.9
        }
    };

    beforeEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
        (PatternMemoryService as unknown as { instance?: PatternMemoryService }).instance = undefined;
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
        (PatternMemoryService as unknown as { instance?: PatternMemoryService }).instance = undefined;
    });

    it('settles only after the agent memory write has completed', async () => {
        const write = new Subject<never>();
        const updateAgentMemory = jest
            .spyOn(MemoryService.prototype, 'updateAgentMemory')
            .mockReturnValue(write.asObservable() as never);

        let settled = false;
        const stored = PatternMemoryService.getInstance()
            .storePattern('pattern-channel', 'pattern-agent', patternData)
            .then(() => {
                settled = true;
            });
        await Promise.resolve();
        await Promise.resolve();
        expect(updateAgentMemory).toHaveBeenCalledTimes(1);
        expect(settled).toBe(false);

        write.complete();
        await stored;
        expect(settled).toBe(true);
    });

    it('reports a failed write as a warning and still settles', async () => {
        jest.spyOn(MemoryService.prototype, 'updateAgentMemory').mockImplementation(() => {
            const failing = new Subject<never>();
            queueMicrotask(() => failing.error(new Error('persistence unavailable')));
            return failing.asObservable() as never;
        });
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

        await expect(PatternMemoryService.getInstance()
            .storePattern('pattern-channel', 'pattern-agent', patternData)).resolves.toBeDefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('persistence unavailable'));
    });
});
