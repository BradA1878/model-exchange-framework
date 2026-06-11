/**
 * Unit tests for MxfMemoryManager — the SDK-side agent memory coordinator.
 *
 * Seeds the SDK-manager coverage the audit found missing (5 managers, 0 tests)
 * and regression-guards the Track A fix: saveAgentMemory must log AND rethrow
 * persistence failures so caller .catch handlers stay live code.
 */
import { of, throwError } from 'rxjs';

// Meilisearch is optional infrastructure; tests run without it.
process.env.ENABLE_MEILISEARCH = 'false';

const updateAgentMemoryMock = jest.fn();

jest.mock('@mxf-dev/sdk/services/MxfMemoryService', () => ({
    MxfMemoryService: {
        getInstance: () => ({
            updateAgentMemory: updateAgentMemoryMock
        })
    }
}));

import { MxfMemoryManager } from '@mxf-dev/sdk/managers/MxfMemoryManager';
import type { Observation } from '@mxf-dev/core/types/ControlLoopTypes';

const makeManager = (overrides: Partial<ConstructorParameters<typeof MxfMemoryManager>[0]> = {}): MxfMemoryManager =>
    new MxfMemoryManager({
        agentId: 'test-agent',
        channelId: 'test-channel',
        maxHistory: 5,
        maxObservations: 3,
        enablePersistence: true,
        ...overrides
    });

const makeObservation = (id: string): Observation => ({
    id,
    agentId: 'test-agent',
    source: 'system',
    content: `observation ${id}`,
    timestamp: Date.now()
});

describe('MxfMemoryManager', () => {
    beforeEach(() => {
        updateAgentMemoryMock.mockReset();
        updateAgentMemoryMock.mockReturnValue(of(undefined));
    });

    describe('saveAgentMemory', () => {
        it('rethrows persistence failures so caller .catch handlers stay live (Track A regression guard)', async () => {
            const manager = makeManager();
            manager.addConversationMessage({ role: 'user', content: 'hello' });
            updateAgentMemoryMock.mockReturnValue(throwError(() => new Error('mongo down')));

            await expect(manager.saveAgentMemory()).rejects.toThrow('mongo down');
        });

        it('skips persistence entirely when enablePersistence is false', async () => {
            const manager = makeManager({ enablePersistence: false });
            manager.addConversationMessage({ role: 'user', content: 'hello' });

            await expect(manager.saveAgentMemory()).resolves.toBeUndefined();
            expect(updateAgentMemoryMock).not.toHaveBeenCalled();
        });

        it('does not call the service when there are no new messages', async () => {
            const manager = makeManager();

            await expect(manager.saveAgentMemory()).resolves.toBeUndefined();
            expect(updateAgentMemoryMock).not.toHaveBeenCalled();
        });

        it('appends only NEW messages on subsequent saves (adds also auto-persist in the background)', async () => {
            const manager = makeManager();
            manager.addConversationMessage({ role: 'user', content: 'first' });
            await manager.saveAgentMemory();

            manager.addConversationMessage({ role: 'assistant', content: 'second' });
            await manager.saveAgentMemory();
            // Let any fire-and-forget auto-saves settle.
            await new Promise(resolve => setImmediate(resolve));

            // Whether the background auto-save or the explicit save won the
            // race, the FINAL persisted batch must contain exactly the new
            // message — never a resend of 'first'.
            const lastCall = updateAgentMemoryMock.mock.calls.at(-1)!;
            const contents = lastCall[3].conversationHistory.map((m: { content: string }) => m.content);
            expect(contents).toEqual(['second']);
        });
    });

    describe('addConversationMessage', () => {
        it('trims history to maxHistory keeping the most recent messages', () => {
            const manager = makeManager({ maxHistory: 5 });
            for (let i = 1; i <= 8; i++) {
                manager.addConversationMessage({ role: 'user', content: `msg-${i}` });
            }

            const history = manager.getConversationHistory();
            expect(history).toHaveLength(5);
            expect(history[0].content).toBe('msg-4');
            expect(history[4].content).toBe('msg-8');
        });

        it('replaces oversized messages with an explicit omission summary', () => {
            const manager = makeManager({ maxMessageSize: 200 });
            manager.addConversationMessage({
                role: 'assistant',
                content: 'x'.repeat(1000),
                metadata: { toolName: 'web_fetch' }
            });

            const [stored] = manager.getConversationHistory();
            expect(stored.content).toContain('Large response omitted');
            expect(stored.metadata?.omittedReason).toBe('exceeded_max_message_size');
            expect(stored.metadata?.omittedSize).toBeGreaterThan(200);
        });
    });

    describe('addObservation', () => {
        it('caps stored observations at maxObservations keeping the newest', () => {
            const manager = makeManager({ maxObservations: 3 });
            for (let i = 1; i <= 6; i++) {
                manager.addObservation(makeObservation(`obs-${i}`));
            }

            const observations = manager.getObservations();
            expect(observations).toHaveLength(3);
            expect(observations.map(o => o.id)).toEqual(['obs-4', 'obs-5', 'obs-6']);
        });
    });
});
