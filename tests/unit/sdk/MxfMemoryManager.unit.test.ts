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
const findIndexedConversationIdsMock = jest.fn();

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
        getInstance: (): {
            indexConversation: typeof indexConversationMock;
            findIndexedConversationIds: typeof findIndexedConversationIdsMock;
        } => ({
            indexConversation: indexConversationMock,
            findIndexedConversationIds: findIndexedConversationIdsMock
        })
    }
}));

import { MxfMemoryManager } from '@mxf-dev/sdk/managers/MxfMemoryManager';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
    MAX_MEILISEARCH_BACKFILL_WIRE_BYTES
} from '@mxf-dev/core/config/MeilisearchIngressLimits';
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

/** The BACKFILL_COMPLETE/PARTIAL summary carries a skip count beyond the shared event type. */
type BackfillSummaryData = MeilisearchBackfillEventData & { skippedDocuments: number };

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
        findIndexedConversationIdsMock.mockReset();
        findIndexedConversationIdsMock.mockResolvedValue(new Set());
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        EventBus.reset();
        process.env.ENABLE_MEILISEARCH = 'false';
        delete process.env.ENABLE_SEMANTIC_SEARCH;
        delete process.env.MXF_MEMORY_REQUEST_TIMEOUT_MS;
        delete process.env.MXF_MEMORY_BACKFILL_TIMEOUT_MS;
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

    describe('flushPersistence', () => {
        it('resolves once every queued revision is persisted, so disconnect() can wait for it', async () => {
            // disconnect() closed the socket under the save that
            // addConversationMessage() was awaiting: the task's final turn then
            // failed with "Cannot start memory operation … not connected" and
            // was reported as a task failure into the closed socket.
            const inFlight = new Subject<void>();
            updateAgentMemoryMock.mockReturnValueOnce(inFlight.asObservable()).mockReturnValue(of(undefined));
            const manager = makeManager();

            const firstAdd = manager.addConversationMessage({ role: 'user', content: 'first' });
            await flushMicrotasks();
            const secondAdd = manager.addConversationMessage({ role: 'user', content: 'second' });
            await flushMicrotasks();
            expect(updateAgentMemoryMock).toHaveBeenCalledTimes(1);

            let flushed = false;
            const flushing = manager.flushPersistence().then(() => { flushed = true; });
            await flushMicrotasks();
            expect(flushed).toBe(false);

            inFlight.next(); inFlight.complete();
            await Promise.all([firstAdd, secondAdd, flushing]);

            expect(flushed).toBe(true);
            expect(updateAgentMemoryMock).toHaveBeenCalledTimes(2);
            const lastSnapshot = updateAgentMemoryMock.mock.calls[1][2] as IAgentMemory;
            expect(lastSnapshot.conversationHistory?.map(message => message.content)).toEqual(['first', 'second']);
        });

        it('rejects when a save fails, instead of pretending the memory is persisted', async () => {
            updateAgentMemoryMock.mockReturnValue(throwError(() => new Error('memory service down')));
            const manager = makeManager();
            await expect(manager.addConversationMessage({ role: 'user', content: 'unsaved' })).rejects.toThrow('memory service down');

            await expect(manager.flushPersistence()).rejects.toThrow('memory service down');
        });

        it('resolves at once when nothing is queued', async () => {
            const manager = makeManager();

            await expect(manager.flushPersistence()).resolves.toBeUndefined();
            expect(updateAgentMemoryMock).not.toHaveBeenCalled();
        });

        it('resolves at once when persistence is disabled, even with dirty revisions', async () => {
            // Every mutation marks a revision dirty whether or not persistence is
            // on; with it off, saveAgentMemory() is a no-op and the list never
            // drains. Waiting for it here would spin disconnect() forever.
            const manager = makeManager({ enablePersistence: false });
            await manager.addConversationMessage({ role: 'user', content: 'not persisted' });

            await expect(manager.flushPersistence()).resolves.toBeUndefined();
            expect(updateAgentMemoryMock).not.toHaveBeenCalled();
        });

        it('stopPersistence keeps later messages in working memory without a save, until the next initialize()', async () => {
            // disconnect() stops persistence once it has drained the queue, the
            // way it stops indexing: a message stored while the socket closes is
            // kept for the turn but no save is queued against a closing connection.
            const manager = makeManager();
            await manager.addConversationMessage({ role: 'user', content: 'before' });
            expect(updateAgentMemoryMock).toHaveBeenCalledTimes(1);

            manager.stopPersistence('agent disconnecting');
            await expect(manager.addConversationMessage({ role: 'user', content: 'during' })).resolves.toBeUndefined();
            await expect(manager.flushPersistence()).resolves.toBeUndefined();

            expect(updateAgentMemoryMock).toHaveBeenCalledTimes(1);
            expect(manager.getConversationHistory().map(message => message.content)).toContain('during');

            // The same manager serves the next connect(); a stop from the previous session ends with it.
            await manager.initialize();
            await manager.addConversationMessage({ role: 'user', content: 'after' });
            expect(updateAgentMemoryMock).toHaveBeenCalledTimes(2);
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

        it('resolves initialize() when historical backfill fails, and reports the failure instead', async () => {
            // Before this, a backfill failure rejected initialize()/connect() outright:
            // conversation memory was already loaded from MongoDB by this point, so a
            // search-index problem is not a reason to fail the agent's whole startup.
            process.env.ENABLE_MEILISEARCH = 'true';
            process.env.ENABLE_SEMANTIC_SEARCH = 'false';
            process.env.MEILISEARCH_HOST = 'http://meilisearch.test';
            process.env.MEILISEARCH_MASTER_KEY = 'test-key';
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical', 'user', 'history', 1)
            ])));
            indexConversationMock.mockRejectedValue(new Error('index offline'));
            const errorSpy = jest.spyOn(Logger.prototype, 'error');
            const emitOn = jest.spyOn(EventBus.client, 'emitOn');
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_PARTIAL, (payload) => { summaries.push(payload.data); });

            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not indexed'));
            const agentErrors = emitOn.mock.calls.filter(call => call[1] === Events.Agent.ERROR);
            expect(agentErrors).toHaveLength(1);
            const agentErrorPayload = agentErrors[0][2] as BaseEventPayload<{ phase: string }>;
            expect(agentErrorPayload.data.phase).toBe('memory_backfill');
            expect(summaries).toHaveLength(1);
            expect(summaries[0].success).toBe(false);
        });

        it('keeps the caller going when the index rejects a message, and retries nothing', async () => {
            enableSemanticSearch();
            jest.useFakeTimers();
            connectAgentSocket();
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
            // No retry wait was scheduled; the request's own bound went with the answer.
            expect(jest.getTimerCount()).toBe(0);
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

        it('stopIndexing during a throttled backfill wait resolves initialize() and reports the batch as failed', async () => {
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
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_PARTIAL, (payload) => { summaries.push(payload.data); });
            const manager = makeManager();

            const initialized = manager.initialize();
            await flushMicrotasks();
            expect(attempts).toBe(1);
            expect(jest.getTimerCount()).toBe(1);

            manager.stopIndexing('agent disconnecting');
            await expect(initialized).resolves.toBeUndefined();

            // The batch was not resent after the stop cut the wait short.
            expect(attempts).toBe(1);
            expect(jest.getTimerCount()).toBe(0);
            expect(summaries).toHaveLength(1);
            expect(summaries[0].success).toBe(false);
            expect(summaries[0].failedDocuments).toBe(1);
            // A failed backfill leaves no request subscribers behind (the PARTIAL one is this test's own).
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_COMPLETE)).toBe(0);
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_ERROR)).toBe(0);
            expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
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

        it('ends an index request the server never answers after MXF_MEMORY_REQUEST_TIMEOUT_MS, so flushIndexQueue() returns', async () => {
            // Before this bound, a server that stopped answering held the index
            // drain — and disconnect(), which waits for it — for as long as the
            // socket stayed up.
            jest.useFakeTimers();
            enableSemanticSearch();
            connectAgentSocket();
            process.env.MXF_MEMORY_REQUEST_TIMEOUT_MS = '5000';
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const warnSpy = jest.spyOn(Logger.prototype, 'warn');
            const manager = makeManager();

            await manager.addConversationMessage({ role: 'user', content: 'one' });
            await manager.addConversationMessage({ role: 'user', content: 'two' });
            await flushMicrotasks();
            expect(emitOn).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(1);

            let flushed = false;
            const flushing = manager.flushIndexQueue().then(() => { flushed = true; });
            await jest.advanceTimersByTimeAsync(4999);
            expect(flushed).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            await flushing;

            // One unanswered request ends the drain: the second message is not
            // sent to wait out another bound. Both are indexed from persisted
            // history at the next memory load.
            expect(emitOn).toHaveBeenCalledTimes(1);
            expect(manager.pendingIndexCount()).toBe(0);
            expect(jest.getTimerCount()).toBe(0);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(
                /timed out after 5000ms waiting for the server's answer; 2 queued message\(s\) not indexed now/
            ));
        });

        it('reports a backfill batch the server never answers as failed after MXF_MEMORY_BACKFILL_TIMEOUT_MS, and initialize() resolves', async () => {
            // The server indexes a batch one message at a time — an embedding
            // call and a Meilisearch task wait each — so a full batch takes far
            // longer than one live request. The batch has its own bound; the
            // per-request one must not cut it short.
            jest.useFakeTimers();
            enableSemanticSearch();
            connectAgentSocket();
            process.env.MXF_MEMORY_REQUEST_TIMEOUT_MS = '1000';
            process.env.MXF_MEMORY_BACKFILL_TIMEOUT_MS = '5000';
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical-1', 'user', 'history', 1)
            ])));
            const errorSpy = jest.spyOn(Logger.prototype, 'error');
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_PARTIAL, (payload) => { summaries.push(payload.data); });
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();

            let initialized = false;
            const initializing = manager.initialize().then(() => { initialized = true; });
            await jest.advanceTimersByTimeAsync(4999);
            expect(initialized).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            await initializing;

            expect(summaries).toHaveLength(1);
            expect(summaries[0].failedDocuments).toBe(1);
            expect(summaries[0].error).toMatch(/timed out after 5000ms waiting for the server's answer/);
            expect(emitOn.mock.calls.filter(call => call[1] === Events.Agent.ERROR)).toHaveLength(1);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
        });

        it('waits five minutes for a backfill batch when MXF_MEMORY_BACKFILL_TIMEOUT_MS is not set', async () => {
            jest.useFakeTimers();
            enableSemanticSearch();
            connectAgentSocket();
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical-1', 'user', 'history', 1)
            ])));
            jest.spyOn(Logger.prototype, 'error');
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();

            let initialized = false;
            const initializing = manager.initialize().then(() => { initialized = true; });
            await jest.advanceTimersByTimeAsync(299_999);
            expect(initialized).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            await initializing;

            expect(initialized).toBe(true);
            expect(jest.getTimerCount()).toBe(0);
        });

        it('skips the on-load backfill when backfillSearchIndexOnLoad is false, and still reports the load as settled', async () => {
            // An agent whose history is intentionally ephemeral has nothing old
            // worth indexing; the settled report still makes it ready for the
            // search tools over what it indexes live.
            enableSemanticSearch();
            connectAgentSocket();
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical-1', 'user', 'history', 1)
            ])));
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager({ backfillSearchIndexOnLoad: false });

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(emitOn).not.toHaveBeenCalledWith(expect.anything(), MeilisearchEvents.BACKFILL_REQUEST, expect.anything());
            const settled = emitOn.mock.calls.filter(call => call[1] === MeilisearchEvents.BACKFILL_SETTLED);
            expect(settled).toHaveLength(1);
            expect((settled[0][2] as BaseEventPayload<MeilisearchBackfillEventData>).data).toEqual(
                expect.objectContaining({ totalDocuments: 0, indexedDocuments: 0, failedDocuments: 0, success: true })
            );
        });

        it('does not index again what the index already has, on the keyword path', async () => {
            process.env.ENABLE_MEILISEARCH = 'true';
            process.env.MEILISEARCH_HOST = 'http://meilisearch.test';
            process.env.MEILISEARCH_MASTER_KEY = 'test-key';
            connectAgentSocket();
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical-1', 'user', 'one', 1),
                makeMessage('historical-2', 'user', 'two', 2),
                makeMessage('historical-3', 'user', 'three', 3)
            ])));
            findIndexedConversationIdsMock.mockResolvedValue(new Set(['historical-2']));
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_COMPLETE, (payload) => { summaries.push(payload.data); });
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(findIndexedConversationIdsMock).toHaveBeenCalledWith(['historical-1', 'historical-2', 'historical-3']);
            expect(indexConversationMock).toHaveBeenCalledTimes(2);
            expect(indexConversationMock).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'historical-2' }));
            expect(summaries).toHaveLength(1);
            expect(summaries[0]).toEqual(expect.objectContaining({
                totalDocuments: 3, indexedDocuments: 3, alreadyIndexedDocuments: 1, failedDocuments: 0, success: true
            }));
        });

        it('carries the server\'s already-indexed count into the load summary and the settled report', async () => {
            enableSemanticSearch();
            connectAgentSocket();
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical-1', 'user', 'one', 1),
                makeMessage('historical-2', 'user', 'two', 2)
            ])));
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_COMPLETE, (payload) => { summaries.push(payload.data); });
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                const payload = rawPayload as BaseEventPayload<MeilisearchBackfillEventData>;
                EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_COMPLETE, createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_COMPLETE, 'test-agent', 'test-channel',
                    { ...payload.data, indexedDocuments: payload.data.totalDocuments, alreadyIndexedDocuments: 1, success: true }
                ));
            });
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            // Both the server's per-batch answer and the SDK's load summary arrive
            // as BACKFILL_COMPLETE locally; the summary is the one from the manager.
            const summary = summaries.find(data => data.totalDocuments === 2 && data.duration === 0);
            expect(summary).toEqual(expect.objectContaining({ indexedDocuments: 2, alreadyIndexedDocuments: 1, success: true }));
            const settled = emitOn.mock.calls.filter(call => call[1] === MeilisearchEvents.BACKFILL_SETTLED);
            expect(settled).toHaveLength(1);
            expect((settled[0][2] as BaseEventPayload<MeilisearchBackfillEventData>).data.alreadyIndexedDocuments).toBe(1);
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
            // text. The server refuses those documents, so they are filtered out
            // before a batch is ever built, rather than sent and rejected.
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

        it('reports a partly-failed semantic backfill and still resolves initialize()', async () => {
            // The server refuses the batch outright (no retryAfterMs) — the kind of
            // rejection that used to reject initialize()/connect() and brick the
            // agent until someone edited MongoDB.
            enableSemanticSearch();
            connectAgentSocket();
            const history = Array.from({ length: 51 }, (_, index) =>
                makeMessage(`historical-${index}`, 'user', `history-${index}`, index + 1)
            );
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(history)));
            const errorSpy = jest.spyOn(Logger.prototype, 'error');
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_PARTIAL, (payload) => { summaries.push(payload.data); });
            let attempts = 0;
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                attempts += 1;
                const payload = rawPayload as BaseEventPayload<MeilisearchBackfillEventData>;
                if (attempts === 1) {
                    EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_ERROR, createMeilisearchBackfillEventPayload(
                        MeilisearchEvents.BACKFILL_ERROR, 'test-agent', 'test-channel',
                        { ...payload.data, success: false, error: 'backfill content exceeds 262144 bytes' }
                    ));
                    return;
                }
                EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_COMPLETE, createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_COMPLETE, 'test-agent', 'test-channel',
                    { ...payload.data, indexedDocuments: payload.data.totalDocuments, success: true }
                ));
            });
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            const requests = emitOn.mock.calls.filter(call => call[1] === MeilisearchEvents.BACKFILL_REQUEST);
            expect(requests).toHaveLength(2);
            expect(summaries).toHaveLength(1);
            expect(summaries[0].success).toBe(false);
            expect(summaries[0].failedDocuments).toBe(50); // first (rejected) batch
            expect(summaries[0].indexedDocuments).toBe(1); // second (accepted) batch

            const agentErrors = emitOn.mock.calls.filter(call => call[1] === Events.Agent.ERROR);
            expect(agentErrors).toHaveLength(1);
            const agentErrorPayload = agentErrors[0][2] as BaseEventPayload<{
                phase: string;
                totalDocuments: number;
                indexedDocuments: number;
                failedDocuments: number;
                skippedDocuments: number;
            }>;
            expect(agentErrorPayload.data.phase).toBe('memory_backfill');
            expect(agentErrorPayload.data.totalDocuments).toBe(51);
            expect(agentErrorPayload.data.indexedDocuments).toBe(1);
            expect(agentErrorPayload.data.failedDocuments).toBe(50);
            expect(agentErrorPayload.data.skippedDocuments).toBe(0);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_COMPLETE)).toBe(0);
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_ERROR)).toBe(0);
            expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
        });

        it('skips a message larger than the per-message limit and still backfills the rest', async () => {
            enableSemanticSearch();
            connectAgentSocket();
            const history = [
                makeMessage('big', 'user', 'x'.repeat(65 * 1024), 1),
                makeMessage('small-1', 'user', 'hello', 2),
                makeMessage('small-2', 'assistant', 'hi there', 3)
            ];
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(history)));
            const errorSpy = jest.spyOn(Logger.prototype, 'error');
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_PARTIAL, (payload) => { summaries.push(payload.data); });
            const sentIds: string[][] = [];
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                const payload = rawPayload as BaseEventPayload<
                    MeilisearchBackfillEventData & { metadata: { messages: Array<{ id: string }> } }
                >;
                sentIds.push(payload.data.metadata.messages.map(message => message.id));
                EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_COMPLETE, createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_COMPLETE, 'test-agent', 'test-channel',
                    { ...payload.data, indexedDocuments: payload.data.totalDocuments, success: true }
                ));
            });
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(sentIds.flat()).toEqual(['small-1', 'small-2']);
            expect(sentIds.flat()).not.toContain('big');
            expect(summaries).toHaveLength(1);
            expect(summaries[0].success).toBe(false);
            expect(summaries[0].skippedDocuments).toBe(1);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toEqual(expect.stringContaining('per-message limit'));
        });

        it('caps semantic backfill batches by content bytes, not just message count', async () => {
            enableSemanticSearch();
            connectAgentSocket();
            const history = Array.from({ length: 20 }, (_, index) =>
                makeMessage(`big-${index}`, 'user', 'y'.repeat(60 * 1024), index + 1)
            );
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(history)));
            const batchSizes: number[] = [];
            const contentBytesPerBatch: number[] = [];
            jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                const payload = rawPayload as BaseEventPayload<
                    MeilisearchBackfillEventData & { metadata: { messages: Array<{ content: string }> } }
                >;
                batchSizes.push(payload.data.totalDocuments);
                contentBytesPerBatch.push(payload.data.metadata.messages.reduce(
                    (sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0
                ));
                EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_COMPLETE, createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_COMPLETE, 'test-agent', 'test-channel',
                    { ...payload.data, indexedDocuments: payload.data.totalDocuments, success: true }
                ));
            });
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(batchSizes).toEqual([8, 8, 4]); // 8 * 60KiB = 480KiB fits under 512KiB; 9 does not
            for (const contentBytes of contentBytesPerBatch) {
                expect(contentBytes).toBeLessThanOrEqual(MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES);
            }
        });

        it('credits the documents the server did index when a batch comes back partial', async () => {
            // The server indexes a batch one document at a time and answers
            // BACKFILL_PARTIAL with how many it managed. Those counts are the
            // truth for that batch; the whole batch must not be written off.
            enableSemanticSearch();
            connectAgentSocket();
            const history = Array.from({ length: 51 }, (_, index) =>
                makeMessage(`historical-${index}`, 'user', `history-${index}`, index + 1)
            );
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(history)));
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_PARTIAL, (payload) => {
                // The server's per-batch answer arrives on this event too (the mock below
                // emits it locally); the load summary is the one carrying a skip count.
                if ('skippedDocuments' in payload.data) {
                    summaries.push(payload.data);
                }
            });
            let attempts = 0;
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                attempts += 1;
                const payload = rawPayload as BaseEventPayload<MeilisearchBackfillEventData>;
                if (attempts === 1) {
                    // 48 of 50 indexed; the server sends no error text for a partial answer.
                    EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_PARTIAL, createMeilisearchBackfillEventPayload(
                        MeilisearchEvents.BACKFILL_PARTIAL, 'test-agent', 'test-channel',
                        { ...payload.data, indexedDocuments: 48, failedDocuments: 2, success: false }
                    ));
                    return;
                }
                EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_COMPLETE, createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_COMPLETE, 'test-agent', 'test-channel',
                    { ...payload.data, indexedDocuments: payload.data.totalDocuments, success: true }
                ));
            });
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(attempts).toBe(2);
            expect(summaries).toHaveLength(1);
            expect(summaries[0].indexedDocuments).toBe(49); // 48 from the partial batch + 1
            expect(summaries[0].failedDocuments).toBe(2);
            expect(summaries[0].error).toContain('indexed 48 of 50');
            const agentErrors = emitOn.mock.calls.filter(call => call[1] === Events.Agent.ERROR);
            expect(agentErrors).toHaveLength(1);
            const agentErrorPayload = agentErrors[0][2] as BaseEventPayload<{
                indexedDocuments: number;
                failedDocuments: number;
            }>;
            expect(agentErrorPayload.data.indexedDocuments).toBe(49);
            expect(agentErrorPayload.data.failedDocuments).toBe(2);
        });

        it('reports a failure inside the backfill path itself instead of rejecting initialize()', async () => {
            // A throw from planning or payload building is a bug in the SDK, not a
            // server answer. It is still a search-index problem: conversation memory
            // is already loaded, so it is reported like any other backfill failure.
            enableSemanticSearch();
            connectAgentSocket();
            getAgentMemoryMock.mockReturnValue(of(persistedMemory([
                makeMessage('historical', 'user', 'history', 1)
            ])));
            const errorSpy = jest.spyOn(Logger.prototype, 'error');
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_PARTIAL, (payload) => { summaries.push(payload.data); });
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();
            // A reservation that leaves no room for messages makes the planner throw.
            jest.spyOn(manager as unknown as { reservedBackfillWireBytes: () => number }, 'reservedBackfillWireBytes')
                .mockReturnValue(MAX_MEILISEARCH_BACKFILL_WIRE_BYTES);

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(emitOn).not.toHaveBeenCalledWith(expect.anything(), MeilisearchEvents.BACKFILL_REQUEST, expect.anything());
            expect(summaries).toHaveLength(1);
            expect(summaries[0].failedDocuments).toBe(1);
            expect(summaries[0].indexedDocuments).toBe(0);
            expect(summaries[0].error).toContain('reservedWireBytes');
            expect(emitOn.mock.calls.filter(call => call[1] === Events.Agent.ERROR)).toHaveLength(1);
            expect(errorSpy).toHaveBeenCalledTimes(1);
        });

        it('a dropped agent socket during a backfill request ends the backfill and resolves initialize()', async () => {
            enableSemanticSearch();
            const socketConnected = connectAgentSocket();
            const history = Array.from({ length: 51 }, (_, index) =>
                makeMessage(`historical-${index}`, 'user', `history-${index}`, index + 1)
            );
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(history)));
            const summaries: BackfillSummaryData[] = [];
            EventBus.client.on(MeilisearchEvents.BACKFILL_PARTIAL, (payload) => { summaries.push(payload.data); });
            // The server never answers the first request.
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();

            const initialized = manager.initialize();
            await flushMicrotasks();
            expect(emitOn.mock.calls.filter(call => call[1] === MeilisearchEvents.BACKFILL_REQUEST)).toHaveLength(1);

            // MxfService emits this locally when the agent socket disconnects.
            socketConnected.mockReturnValue(false);
            EventBus.client.emitLocal(Events.Agent.DISCONNECT, createAgentEventPayload(
                Events.Agent.DISCONNECT, 'test-agent', 'test-channel',
                { status: 'disconnected', reason: 'transport close' }
            ));

            await expect(initialized).resolves.toBeUndefined();
            // The second planned batch was never sent: the transport is gone.
            expect(emitOn.mock.calls.filter(call => call[1] === MeilisearchEvents.BACKFILL_REQUEST)).toHaveLength(1);
            expect(summaries).toHaveLength(1);
            expect(summaries[0].indexedDocuments).toBe(0);
            expect(summaries[0].failedDocuments).toBe(51);
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_COMPLETE)).toBe(0);
            expect(EventBus.client.listenerCount(MeilisearchEvents.BACKFILL_ERROR)).toBe(0);
            expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
        });
        it('reports the settled load to the server with the final counts', async () => {
            // The server marks the agent ready for memory_search_* from this
            // report, and logs what the client managed to index.
            enableSemanticSearch();
            connectAgentSocket();
            const history = Array.from({ length: 51 }, (_, index) =>
                makeMessage(`historical-${index}`, 'user', `history-${index}`, index + 1)
            );
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(history)));
            let attempts = 0;
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
                if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
                    return;
                }
                attempts += 1;
                const payload = rawPayload as BaseEventPayload<MeilisearchBackfillEventData>;
                if (attempts === 1) {
                    EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_ERROR, createMeilisearchBackfillEventPayload(
                        MeilisearchEvents.BACKFILL_ERROR, 'test-agent', 'test-channel',
                        { ...payload.data, success: false, error: 'backfill content exceeds 262144 bytes' }
                    ));
                    return;
                }
                EventBus.client.emitLocal(MeilisearchEvents.BACKFILL_COMPLETE, createMeilisearchBackfillEventPayload(
                    MeilisearchEvents.BACKFILL_COMPLETE, 'test-agent', 'test-channel',
                    { ...payload.data, indexedDocuments: payload.data.totalDocuments, success: true }
                ));
            });
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            const settled = emitOn.mock.calls.filter(call => call[1] === MeilisearchEvents.BACKFILL_SETTLED);
            expect(settled).toHaveLength(1);
            expect((settled[0][2] as BaseEventPayload<MeilisearchBackfillEventData>).data).toMatchObject({
                documentType: 'conversation',
                totalDocuments: 51,
                indexedDocuments: 1,
                failedDocuments: 50,
                skippedDocuments: 0,
                success: false,
                error: 'backfill content exceeds 262144 bytes'
            });
            // The report goes out after the last batch was answered.
            const order = emitOn.mock.calls.map(call => call[1]);
            expect(order.lastIndexOf(MeilisearchEvents.BACKFILL_REQUEST)).toBeLessThan(order.indexOf(MeilisearchEvents.BACKFILL_SETTLED));
        });

        it('reports a settled load with nothing to index for a new agent', async () => {
            enableSemanticSearch();
            connectAgentSocket();
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            const settled = emitOn.mock.calls.filter(call => call[1] === MeilisearchEvents.BACKFILL_SETTLED);
            expect(settled).toHaveLength(1);
            expect((settled[0][2] as BaseEventPayload<MeilisearchBackfillEventData>).data).toMatchObject({
                totalDocuments: 0, indexedDocuments: 0, failedDocuments: 0, skippedDocuments: 0, success: true
            });
        });

        it('reports a settled load on reconnect when the working history was already indexed live', async () => {
            // The same manager serves every connect(). After a reconnect the
            // working history is non-empty and nothing is backfilled — the live
            // path indexed it — but the server still needs to hear that the load
            // settled, or an agent that reconnects to a restarted server never
            // gets its search tools back.
            enableSemanticSearch();
            connectAgentSocket();
            const emitOn = answerIndexRequests(() => ({ success: true }));
            const manager = makeManager();
            await manager.initialize();
            await manager.addConversationMessage({ role: 'user', content: 'indexed live' });
            await manager.flushIndexQueue();
            getAgentMemoryMock.mockReturnValue(of(persistedMemory(manager.getConversationHistory())));
            emitOn.mockClear();

            await manager.initialize();

            expect(emitOn).not.toHaveBeenCalledWith(expect.anything(), MeilisearchEvents.BACKFILL_REQUEST, expect.anything());
            const settled = emitOn.mock.calls.filter(call => call[1] === MeilisearchEvents.BACKFILL_SETTLED);
            expect(settled).toHaveLength(1);
            expect((settled[0][2] as BaseEventPayload<MeilisearchBackfillEventData>).data).toMatchObject({
                totalDocuments: 0, success: true
            });
        });
        it('does not report a settled load to the server when Meilisearch is disabled on the client', async () => {
            // Nothing is indexed from this client, so it must not tell the server
            // the agent is ready for search tools it could never have populated.
            process.env.ENABLE_MEILISEARCH = 'false';
            connectAgentSocket();
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(emitOn).not.toHaveBeenCalledWith(expect.anything(), MeilisearchEvents.BACKFILL_SETTLED, expect.anything());
        });

        it('logs instead of reporting a settled load when the agent socket is not connected', async () => {
            // emitOn() falls back to a primary socket agents never register and
            // drops the event with only a debug line; the report is not retried,
            // so the drop has to be visible. The next connect() reports again.
            enableSemanticSearch();
            jest.spyOn(EventBus.client, 'isRegisteredSocketConnected').mockReturnValue(false);
            const emitOn = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
            const errorSpy = jest.spyOn(Logger.prototype, 'error');
            const manager = makeManager();

            await expect(manager.initialize()).resolves.toBeUndefined();

            expect(emitOn).not.toHaveBeenCalledWith(expect.anything(), MeilisearchEvents.BACKFILL_SETTLED, expect.anything());
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('settled report not sent'));
        });
    });
});
