/**
 * Unit tests for MxfMemoryManager — the SDK-side agent memory coordinator.
 *
 * Seeds the SDK-manager coverage the audit found missing (5 managers, 0 tests)
 * and regression-guards the Track A fix: saveAgentMemory must log AND rethrow
 * persistence failures so caller .catch handlers stay live code.
 */
import { of, Subject, throwError } from 'rxjs';

// Meilisearch is optional infrastructure; tests run without it.
process.env.ENABLE_MEILISEARCH = 'false';

const updateAgentMemoryMock = jest.fn();
const getAgentMemoryMock = jest.fn();
const indexConversationMock = jest.fn();

jest.mock('@mxf-dev/sdk/services/MxfMemoryService', () => ({
    MxfMemoryService: {
        getInstance: (): { getAgentMemory: typeof getAgentMemoryMock; updateAgentMemory: typeof updateAgentMemoryMock } => ({
            getAgentMemory: getAgentMemoryMock,
            updateAgentMemory: updateAgentMemoryMock
        })
    }
}));

jest.mock('@mxf-dev/core/services/MxfMeilisearchService', () => ({
    MxfMeilisearchService: {
        getInstance: (): { indexConversation: typeof indexConversationMock } => ({
            indexConversation: indexConversationMock
        })
    }
}));

import { MxfMemoryManager } from '@mxf-dev/sdk/managers/MxfMemoryManager';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import type { ConversationMessage } from '@mxf-dev/core/interfaces/ConversationMessage';
import type { Observation } from '@mxf-dev/core/types/ControlLoopTypes';
import { IAgentMemory, MemoryPersistenceLevel } from '@mxf-dev/core/types/MemoryTypes';
import {
    BaseEventPayload,
    createAgentEventPayload,
    createMeilisearchBackfillEventPayload,
    createMeilisearchIndexEventPayload,
    MeilisearchBackfillEventData,
    MeilisearchIndexEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';

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

const makeMessage = (
    id: string,
    role: ConversationMessage['role'],
    content: string,
    timestamp: number
): ConversationMessage => ({ id, role, content, timestamp });

const persistedMemory = (conversationHistory: ConversationMessage[] = []): IAgentMemory => ({
    id: 'persisted-agent-memory',
    agentId: 'test-agent',
    createdAt: new Date(1),
    updatedAt: new Date(1),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: {},
    conversationHistory
});

const enableSemanticSearch = (): void => {
    process.env.ENABLE_MEILISEARCH = 'true';
    process.env.ENABLE_SEMANTIC_SEARCH = 'true';
    process.env.MEILISEARCH_HOST = 'http://meilisearch.test';
    process.env.MEILISEARCH_MASTER_KEY = 'test-key';
};

/** The manager only sends index requests over a connected agent socket. */
const connectAgentSocket = (): jest.SpyInstance<boolean, [string]> =>
    jest.spyOn(EventBus.client, 'isRegisteredSocketConnected').mockReturnValue(true);

type IndexAnswer = Partial<Pick<MeilisearchIndexEventData, 'success' | 'error' | 'retryAfterMs'>>;

/** Answer every index request the way the server would, synchronously. */
const answerIndexRequests = (answer: () => IndexAnswer): jest.SpyInstance =>
    jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
        if (eventName !== MeilisearchEvents.INDEX_REQUEST) {
            return;
        }
        const payload = rawPayload as BaseEventPayload<MeilisearchIndexEventData>;
        const response = answer();
        const responseEvent = response.success === false ? MeilisearchEvents.INDEX_ERROR : MeilisearchEvents.INDEX;
        EventBus.client.emitLocal(responseEvent, createMeilisearchIndexEventPayload(
            responseEvent, 'test-agent', 'test-channel', { ...payload.data, success: true, ...response }
        ));
    });

const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
    }
};

describe('MxfMemoryManager', () => {
    beforeEach(() => {
        EventBus.reset();
        process.env.ENABLE_MEILISEARCH = 'false';
        delete process.env.ENABLE_SEMANTIC_SEARCH;
        updateAgentMemoryMock.mockReset();
        updateAgentMemoryMock.mockReturnValue(of(undefined));
        getAgentMemoryMock.mockReset();
        getAgentMemoryMock.mockReturnValue(of(persistedMemory()));
        indexConversationMock.mockReset();
        indexConversationMock.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        EventBus.reset();
        process.env.ENABLE_MEILISEARCH = 'false';
        delete process.env.ENABLE_SEMANTIC_SEARCH;
    });

    describe('saveAgentMemory', () => {
        it('rethrows persistence failures so callers can observe the failed revision', async () => {
            const manager = makeManager();
            const pendingWrite = new Subject<unknown>();
            updateAgentMemoryMock.mockReturnValue(pendingWrite.asObservable());
            const save = manager.addConversationMessage({ role: 'user', content: 'hello' });

            pendingWrite.error(new Error('mongo down'));

            await expect(save).rejects.toThrow('mongo down');
        });

        it('skips persistence entirely when enablePersistence is false', async () => {
            const manager = makeManager({ enablePersistence: false });
            await manager.addConversationMessage({ role: 'user', content: 'hello' });

            await expect(manager.saveAgentMemory()).resolves.toBeUndefined();
            expect(updateAgentMemoryMock).not.toHaveBeenCalled();
        });

        it('does not call the service when there are no new messages', async () => {
            const manager = makeManager();

            await expect(manager.saveAgentMemory()).resolves.toBeUndefined();
            expect(updateAgentMemoryMock).not.toHaveBeenCalled();
        });

        it('persists authoritative snapshots instead of lossy append-only batches', async () => {
            const manager = makeManager();
            await manager.addConversationMessage({ role: 'user', content: 'first' });

            await manager.addConversationMessage({ role: 'assistant', content: 'second' });
            const lastCall = updateAgentMemoryMock.mock.calls.at(-1)!;
            const contents = lastCall[2].conversationHistory
                .map((message: ConversationMessage) => message.content);
            expect(contents).toEqual(['first', 'second']);
        });

        it('serializes concurrent appends without skipping rolled-out local messages', async () => {
            const manager = makeManager({ maxHistory: 1 });
            const firstWrite = new Subject<unknown>();
            updateAgentMemoryMock
                .mockReturnValueOnce(firstWrite.asObservable())
                .mockReturnValue(of(undefined));

            const firstAppend = manager.addConversationMessage({ role: 'user', content: 'first' });
            const secondAppend = manager.addConversationMessage({ role: 'assistant', content: 'second' });

            expect(manager.getConversationHistory().map(message => message.content)).toEqual(['second']);
            expect(updateAgentMemoryMock).toHaveBeenCalledTimes(1);
            expect(updateAgentMemoryMock.mock.calls[0][2].conversationHistory
                .map((message: ConversationMessage) => message.content)).toEqual(['first']);

            firstWrite.next(undefined);
            firstWrite.complete();
            await Promise.all([firstAppend, secondAppend]);

            expect(updateAgentMemoryMock).toHaveBeenCalledTimes(2);
            expect(updateAgentMemoryMock.mock.calls[1][2].conversationHistory
                .map((message: ConversationMessage) => message.content))
                .toEqual(['first', 'second']);
        });

        it('keeps a failed snapshot queued and retries it without duplication', async () => {
            const manager = makeManager();
            const failedWrite = new Subject<unknown>();
            updateAgentMemoryMock.mockReturnValue(failedWrite.asObservable());

            const firstAttempt = manager.addConversationMessage({ role: 'user', content: 'preserve-me' });
            failedWrite.error(new Error('storage unavailable'));
            await expect(firstAttempt).rejects.toThrow('storage unavailable');

            updateAgentMemoryMock.mockReturnValue(of(undefined));
            await manager.saveAgentMemory();

            expect(updateAgentMemoryMock).toHaveBeenCalledTimes(2);
            expect(updateAgentMemoryMock.mock.calls[1][2].conversationHistory
                .map((message: ConversationMessage) => message.content))
                .toEqual(['preserve-me']);
        });

        it('retains loaded persistent history outside the rolling prompt buffer', async () => {
            const historical = makeMessage('historical', 'user', 'from-last-session', 1);
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([historical])));
            const manager = makeManager({ maxHistory: 1 });

            await manager.initialize();
            expect(manager.getConversationHistory()).toEqual([]);
            await manager.addConversationMessage({ role: 'assistant', content: 'current-session' });

            expect(updateAgentMemoryMock.mock.calls.at(-1)![2].conversationHistory
                .map((message: ConversationMessage) => message.content))
                .toEqual(['from-last-session', 'current-session']);
            expect(updateAgentMemoryMock.mock.calls.at(-1)![2]).toEqual(expect.objectContaining({
                id: 'persisted-agent-memory',
                createdAt: new Date(1),
                persistenceLevel: MemoryPersistenceLevel.PERSISTENT
            }));
        });
    });

    describe('authoritative replacement operations', () => {
        it('clear replaces persisted history with only current system messages', async () => {
            const manager = makeManager();
            await manager.addConversationMessage({ role: 'system', content: 'rules' });
            await manager.addConversationMessage({ role: 'user', content: 'discard' });

            await manager.clearConversationHistory();

            expect(updateAgentMemoryMock.mock.calls.at(-1)![2].conversationHistory
                .map((message: ConversationMessage) => message.content)).toEqual(['rules']);
        });

        it('compact replaces persisted history and preserves newest complete blocks', async () => {
            const manager = makeManager({ maxHistory: 10 });
            await manager.addConversationMessage({ role: 'system', content: 'rules' });
            for (let index = 1; index <= 4; index++) {
                await manager.addConversationMessage({ role: 'user', content: `message-${index}` });
            }

            await expect(manager.compactConversation(2)).resolves.toEqual({
                originalMessages: 5,
                compactedMessages: 3
            });

            expect(updateAgentMemoryMock.mock.calls.at(-1)![2].conversationHistory
                .map((message: ConversationMessage) => message.content))
                .toEqual(['rules', 'message-3', 'message-4']);
        });

        it('update replaces the exact persisted message instead of appending a second copy', async () => {
            const manager = makeManager();
            await manager.addConversationMessage({ role: 'system', content: 'old-rules' });
            const replacement = makeMessage('replacement', 'system', 'new-rules', 2);

            await manager.updateConversationMessage(0, replacement);

            expect(updateAgentMemoryMock.mock.calls.at(-1)![2].conversationHistory)
                .toEqual([replacement]);
        });

        it('does not swallow replacement failures and preserves the replacement for retry', async () => {
            const manager = makeManager();
            await manager.addConversationMessage({ role: 'user', content: 'discard' });
            updateAgentMemoryMock.mockReturnValue(throwError(() => new Error('write denied')));

            await expect(manager.clearConversationHistory()).rejects.toThrow('write denied');

            updateAgentMemoryMock.mockReturnValue(of(undefined));
            await manager.saveAgentMemory();
            expect(updateAgentMemoryMock.mock.calls.at(-1)![2].conversationHistory).toEqual([]);
        });

        it('fails fast on an invalid update index without touching persistence', async () => {
            const manager = makeManager();

            await expect(manager.updateConversationMessage(
                0,
                makeMessage('replacement', 'system', 'new-rules', 2)
            )).rejects.toThrow('Invalid conversation message index');
            expect(updateAgentMemoryMock).not.toHaveBeenCalled();
        });
    });

    describe('addConversationMessage', () => {
        it('trims history to maxHistory keeping the most recent messages', async () => {
            const manager = makeManager({ maxHistory: 5 });
            for (let i = 1; i <= 8; i++) {
                await manager.addConversationMessage({ role: 'user', content: `msg-${i}` });
            }

            const history = manager.getConversationHistory();
            expect(history).toHaveLength(5);
            expect(history[0].content).toBe('msg-4');
            expect(history[4].content).toBe('msg-8');
        });

        it('rejects oversized messages without fabricating persisted content', async () => {
            const manager = makeManager({ maxMessageSize: 200 });
            await expect(manager.addConversationMessage({
                role: 'assistant',
                content: 'x'.repeat(1000),
                metadata: { toolName: 'web_fetch' }
            })).rejects.toThrow(/above the configured 200-byte persistence limit/);

            expect(manager.getConversationHistory()).toEqual([]);
            expect(updateAgentMemoryMock).not.toHaveBeenCalled();
        });
    });

    describe('addObservation', () => {
        it('caps stored observations at maxObservations keeping the newest', async () => {
            const manager = makeManager({ maxObservations: 3 });
            for (let i = 1; i <= 6; i++) {
                await manager.addObservation(makeObservation(`obs-${i}`));
            }

            const observations = manager.getObservations();
            expect(observations).toHaveLength(3);
            expect(observations.map(o => o.id)).toEqual(['obs-4', 'obs-5', 'obs-6']);
        });
    });

    describe('Meilisearch configuration', () => {
        it('fails construction when search is enabled without explicit connection settings', () => {
            process.env.ENABLE_MEILISEARCH = 'true';
            delete process.env.MEILISEARCH_HOST;
            delete process.env.MEILISEARCH_MASTER_KEY;

            expect(() => makeManager()).toThrow(
                'MEILISEARCH_HOST is required when ENABLE_MEILISEARCH=true'
            );
        });

        it('surfaces historical backfill failure from initialize', async () => {
            process.env.ENABLE_MEILISEARCH = 'true';
            process.env.ENABLE_SEMANTIC_SEARCH = 'false';
            process.env.MEILISEARCH_HOST = 'http://meilisearch.test';
            process.env.MEILISEARCH_MASTER_KEY = 'test-key';
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical', 'user', 'history', 1)
            ])));
            indexConversationMock.mockRejectedValue(new Error('index offline'));

            const manager = makeManager();

            await expect(manager.initialize()).rejects.toThrow('index offline');
        });

        it('keeps the caller going when the index rejects a message, and retries nothing', async () => {
            enableSemanticSearch();
            connectAgentSocket();
            const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
            const failures: MeilisearchIndexEventData[] = [];
            EventBus.client.on(MeilisearchEvents.INDEX_ERROR, (payload) => { failures.push(payload.data); });
            const emitOn = answerIndexRequests(() => ({ success: false, error: 'embedding index unavailable' }));
            const manager = makeManager();

            // The message is in the conversation and persisted; indexing is a
            // background concern and its failure must not abort the agent's turn.
            await expect(manager.addConversationMessage({ role: 'user', content: 'index this' }))
                .resolves.toBeUndefined();
            await manager.flushIndexQueue();

            expect(manager.getConversationHistory().map(m => m.content)).toContain('index this');
            expect(emitOn).toHaveBeenCalledTimes(1);
            expect(manager.pendingIndexCount()).toBe(0);
            expect(failures).toHaveLength(1);
            expect(failures[0].error).toBe('embedding index unavailable');
            expect(EventBus.client.listenerCount(MeilisearchEvents.INDEX)).toBe(0);
            expect(EventBus.client.listenerCount(MeilisearchEvents.INDEX_ERROR)).toBe(1); // the test's own
            expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
            expect(setTimeoutSpy).not.toHaveBeenCalled();
        });

        it('sends one index request at a time, in arrival order', async () => {
            enableSemanticSearch();
            connectAgentSocket();
            const pending: Array<BaseEventPayload<MeilisearchIndexEventData>> = [];
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName === MeilisearchEvents.INDEX_REQUEST) {
                    pending.push(rawPayload as BaseEventPayload<MeilisearchIndexEventData>);
                }
            });
            const manager = makeManager();

            await manager.addConversationMessage({ role: 'user', content: 'first' });
            await manager.addConversationMessage({ role: 'user', content: 'second' });
            await manager.addConversationMessage({ role: 'user', content: 'third' });
            expect(pending).toHaveLength(1);
            expect(manager.pendingIndexCount()).toBe(3);

            const acknowledge = (): void => {
                const request = pending[pending.length - 1];
                EventBus.client.emitLocal(MeilisearchEvents.INDEX, createMeilisearchIndexEventPayload(
                    MeilisearchEvents.INDEX, 'test-agent', 'test-channel', { ...request.data, success: true }
                ));
            };
            acknowledge();
            await flushMicrotasks();
            expect(pending).toHaveLength(2);
            acknowledge();
            await flushMicrotasks();
            expect(pending).toHaveLength(3);
            acknowledge();
            await manager.flushIndexQueue();

            const contents = pending.map(request =>
                (request.data.metadata as { message?: { content?: string } } | undefined)?.message?.content
            );
            expect(contents).toEqual(['first', 'second', 'third']);
            expect(manager.pendingIndexCount()).toBe(0);
        });

        it('waits the server\'s retry hint and sends the same document again when throttled', async () => {
            jest.useFakeTimers();
            enableSemanticSearch();
            connectAgentSocket();
            let attempts = 0;
            const emitOn = answerIndexRequests(() => {
                attempts += 1;
                return attempts === 1
                    ? { success: false, error: 'Meilisearch request rate limit exceeded; retry after 250ms', retryAfterMs: 250 }
                    : { success: true };
            });
            const manager = makeManager();

            await manager.addConversationMessage({ role: 'user', content: 'throttled' });
            await flushMicrotasks();
            expect(emitOn).toHaveBeenCalledTimes(1);
            expect(manager.pendingIndexCount()).toBe(1);
            expect(jest.getTimerCount()).toBe(1);

            await jest.advanceTimersByTimeAsync(249);
            expect(emitOn).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(1);
            await manager.flushIndexQueue();

            expect(emitOn).toHaveBeenCalledTimes(2);
            const documentIds = emitOn.mock.calls.map(call =>
                (call[2] as BaseEventPayload<MeilisearchIndexEventData>).data.documentId
            );
            expect(documentIds[0]).toBe(documentIds[1]);
            expect(manager.pendingIndexCount()).toBe(0);
            expect(jest.getTimerCount()).toBe(0);
        });

        it('stopIndexing drops the queue, cancels a retry wait, and leaves no timer behind', async () => {
            jest.useFakeTimers();
            enableSemanticSearch();
            connectAgentSocket();
            const emitOn = answerIndexRequests(() => ({
                success: false, error: 'rate limit exceeded; retry after 60000ms', retryAfterMs: 60_000
            }));
            const manager = makeManager();

            await manager.addConversationMessage({ role: 'user', content: 'one' });
            await manager.addConversationMessage({ role: 'user', content: 'two' });
            await flushMicrotasks();
            expect(jest.getTimerCount()).toBe(1);

            manager.stopIndexing('agent disconnecting');
            await manager.flushIndexQueue();

            expect(jest.getTimerCount()).toBe(0);
            expect(manager.pendingIndexCount()).toBe(0);
            expect(emitOn).toHaveBeenCalledTimes(1);

            await manager.addConversationMessage({ role: 'user', content: 'after stop' });
            await manager.flushIndexQueue();
            expect(emitOn).toHaveBeenCalledTimes(1);
            expect(manager.getConversationHistory().map(m => m.content)).toContain('after stop');
        });

        it('indexes again after a reconnect: initialize() lifts a stop from the previous session', async () => {
            enableSemanticSearch();
            connectAgentSocket();
            const emitOn = answerIndexRequests(() => ({ success: true }));
            const manager = makeManager();
            await manager.initialize();

            manager.stopIndexing('agent disconnecting');
            await manager.addConversationMessage({ role: 'user', content: 'while stopped' });
            await manager.flushIndexQueue();
            expect(emitOn).not.toHaveBeenCalledWith(expect.anything(), MeilisearchEvents.INDEX_REQUEST, expect.anything());

            // The same manager instance serves the agent's next connect().
            await manager.initialize();
            await manager.addConversationMessage({ role: 'user', content: 'after reconnect' });
            await manager.flushIndexQueue();

            const indexed = emitOn.mock.calls
                .filter(call => call[1] === MeilisearchEvents.INDEX_REQUEST)
                .map(call => (call[2] as BaseEventPayload<MeilisearchIndexEventData>).data.documentId);
            expect(indexed).toHaveLength(1);
            expect(manager.pendingIndexCount()).toBe(0);
        });

        it('stopIndexing during a throttled backfill wait fails initialize() instead of resending the batch', async () => {
            jest.useFakeTimers();
            enableSemanticSearch();
            connectAgentSocket();
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical-1', 'user', 'history', 1)
            ])));
            let attempts = 0;
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                attempts += 1;
                const payload = rawPayload as BaseEventPayload<MeilisearchBackfillEventData>;
                EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_ERROR, createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_ERROR, 'test-agent', 'test-channel',
                    { ...payload.data, success: false, error: 'rate limit exceeded; retry after 60000ms', retryAfterMs: 60_000 }
                ));
            });
            const manager = makeManager();

            const initialized = manager.initialize();
            await flushMicrotasks();
            expect(attempts).toBe(1);
            expect(jest.getTimerCount()).toBe(1);

            manager.stopIndexing('agent disconnecting');
            await expect(initialized).rejects.toThrow('Search indexing stopped: agent disconnecting');
            expect(attempts).toBe(1);
            expect(jest.getTimerCount()).toBe(0);
        });

        it('a dropped agent socket settles the request in flight and stops indexing', async () => {
            enableSemanticSearch();
            const socketConnected = connectAgentSocket();
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();

            await manager.addConversationMessage({ role: 'user', content: 'in flight' });
            await manager.addConversationMessage({ role: 'user', content: 'queued' });
            await flushMicrotasks();
            expect(emitOn).toHaveBeenCalledTimes(1);

            // MxfService emits this locally when the agent socket disconnects.
            socketConnected.mockReturnValue(false);
            EventBus.client.emitLocal(Events.Agent.DISCONNECT, createAgentEventPayload(
                Events.Agent.DISCONNECT, 'test-agent', 'test-channel',
                { status: 'disconnected', reason: 'transport close' }
            ));
            await manager.flushIndexQueue();

            expect(emitOn).toHaveBeenCalledTimes(1);
            expect(manager.pendingIndexCount()).toBe(0);
            expect(EventBus.client.listenerCount(MeilisearchEvents.INDEX)).toBe(0);
            expect(EventBus.client.listenerCount(MeilisearchEvents.INDEX_ERROR)).toBe(0);
            expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
        });

        it('does not send an index request while the agent socket is not connected', async () => {
            enableSemanticSearch();
            jest.spyOn(EventBus.client, 'isRegisteredSocketConnected').mockReturnValue(false);
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();

            await manager.addConversationMessage({ role: 'user', content: 'offline' });
            await manager.flushIndexQueue();

            expect(emitOn).not.toHaveBeenCalledWith(expect.anything(), MeilisearchEvents.INDEX_REQUEST, expect.anything());
            expect(manager.pendingIndexCount()).toBe(0);
        });

        it('retries a throttled backfill batch after the server\'s delay', async () => {
            jest.useFakeTimers();
            enableSemanticSearch();
            connectAgentSocket();
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical-1', 'user', 'history', 1)
            ])));
            let attempts = 0;
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                attempts += 1;
                const payload = rawPayload as BaseEventPayload<MeilisearchBackfillEventData>;
                if (attempts === 1) {
                    EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_ERROR, createMeilisearchBackfillEventPayload(
                        MeilisearchEvents.BACKFILL_ERROR, 'test-agent', 'test-channel',
                        { ...payload.data, success: false, error: 'rate limit exceeded; retry after 500ms', retryAfterMs: 500 }
                    ));
                    return;
                }
                EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_COMPLETE, createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_COMPLETE, 'test-agent', 'test-channel',
                    { ...payload.data, indexedDocuments: payload.data.totalDocuments, success: true }
                ));
            });
            const manager = makeManager();

            const initialized = manager.initialize();
            await flushMicrotasks();
            expect(attempts).toBe(1);
            await jest.advanceTimersByTimeAsync(500);
            await expect(initialized).resolves.toBeUndefined();
            expect(attempts).toBe(2);
            expect(jest.getTimerCount()).toBe(0);
        });

        it('does not send a message with no text to the search index', async () => {
            // An assistant turn that only calls a tool has empty content. There is
            // nothing to search, and the server's ingress policy refuses an empty
            // document, so the request must not be made at all — before this, the
            // refusal propagated out of addConversationMessage and aborted the
            // agent's generation loop mid tool call.
            process.env.ENABLE_MEILISEARCH = 'true';
            process.env.ENABLE_SEMANTIC_SEARCH = 'true';
            process.env.MEILISEARCH_HOST = 'http://meilisearch.test';
            process.env.MEILISEARCH_MASTER_KEY = 'test-key';
            // Answer any index request the way the server's ingress policy does.
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation((
                _agentId,
                eventName,
                rawPayload
            ) => {
                if (eventName !== MeilisearchEvents.INDEX_REQUEST) {
                    return;
                }
                const payload = rawPayload as BaseEventPayload<MeilisearchIndexEventData>;
                EventBus.client.emitLocal(
                    MeilisearchEvents.INDEX_ERROR,
                    createMeilisearchIndexEventPayload(
                        MeilisearchEvents.INDEX_ERROR,
                        'test-agent',
                        'test-channel',
                        { ...payload.data, success: false, error: 'message.content must be a non-empty string' }
                    )
                );
            });
            const manager = makeManager();

            await manager.addConversationMessage({
                role: 'assistant',
                content: '',
                toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'messaging_send', arguments: '{}' } }]
            } as never);
            await manager.addConversationMessage({ role: 'tool', content: '   ' } as never);

            expect(emitOn).not.toHaveBeenCalledWith(
                expect.anything(),
                MeilisearchEvents.INDEX_REQUEST,
                expect.anything()
            );
            expect(manager.getConversationHistory().filter(m => m.role !== 'system')).toHaveLength(2);
        });

        it('batches semantic backfill at the authenticated boundary and awaits each result', async () => {
            process.env.ENABLE_MEILISEARCH = 'true';
            process.env.ENABLE_SEMANTIC_SEARCH = 'true';
            process.env.MEILISEARCH_HOST = 'http://meilisearch.test';
            process.env.MEILISEARCH_MASTER_KEY = 'test-key';
            connectAgentSocket();
            const history = Array.from({ length: 51 }, (_, index) =>
                makeMessage(`historical-${index}`, 'user', `history-${index}`, index + 1)
            );
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(history)));
            const batchSizes: number[] = [];
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation((
                _agentId,
                eventName,
                rawPayload
            ) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                const payload = rawPayload as BaseEventPayload<
                    MeilisearchBackfillEventData & { documentType: 'conversation' }
                >;
                batchSizes.push(payload.data.totalDocuments);
                expect(payload.data.documentType).toBe('conversation');
                EventBus.client.emitLocal(
                    MeilisearchEvents.BACKFILL_COMPLETE,
                    createMeilisearchBackfillEventPayload(
                        MeilisearchEvents.BACKFILL_COMPLETE,
                        'test-agent',
                        'test-channel',
                        {
                            ...payload.data,
                            indexedDocuments: payload.data.totalDocuments,
                            success: true
                        }
                    )
                );
            });
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(batchSizes).toEqual([50, 1]);
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_COMPLETE)).toBe(0);
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_PARTIAL)).toBe(0);
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_ERROR)).toBe(0);
        });

        it('backfills only messages the search index can hold', async () => {
            // Persisted history carries system prompts and tool-call turns with no
            // text. The server refuses those documents, and one refusal fails the
            // whole batch and initialize(), so they are not sent.
            process.env.ENABLE_MEILISEARCH = 'true';
            process.env.ENABLE_SEMANTIC_SEARCH = 'true';
            process.env.MEILISEARCH_HOST = 'http://meilisearch.test';
            process.env.MEILISEARCH_MASTER_KEY = 'test-key';
            connectAgentSocket();
            const history = [
                makeMessage('sys', 'system', 'You are an agent', 1),
                makeMessage('call', 'assistant', '', 2),
                makeMessage('blank-tool', 'tool', '   ', 3),
                makeMessage('user-1', 'user', 'hello', 4),
                makeMessage('reply', 'assistant', 'hi there', 5)
            ];
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(history)));
            const sentIds: string[][] = [];
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation((
                _agentId,
                eventName,
                rawPayload
            ) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                const payload = rawPayload as BaseEventPayload<
                    MeilisearchBackfillEventData & { metadata: { messages: Array<{ id: string }> } }
                >;
                sentIds.push(payload.data.metadata.messages.map(message => message.id));
                EventBus.client.emitLocal(
                    MeilisearchEvents.BACKFILL_COMPLETE,
                    createMeilisearchBackfillEventPayload(
                        MeilisearchEvents.BACKFILL_COMPLETE,
                        'test-agent',
                        'test-channel',
                        { ...payload.data, indexedDocuments: payload.data.totalDocuments, success: true }
                    )
                );
            });
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(sentIds).toEqual([['user-1', 'reply']]);
        });
    });
});
