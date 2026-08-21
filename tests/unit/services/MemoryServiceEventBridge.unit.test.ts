import { firstValueFrom, from, Observable, of, throwError } from 'rxjs';
import { Request, Response } from 'express';

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    ChannelMemoryAtomicMutation,
    ChannelMemoryAtomicMutationResult,
    IMemoryPersistence
} from '@mxf-dev/core/interfaces/IMemoryPersistence';
import {
    BaseEventPayload,
    createMemoryDeleteEventPayload,
    createMemoryGetEventPayload,
    createMemoryUpdateEventPayload,
    MemoryDeleteResultEventData,
    MemoryGetResultEventData,
    MemoryUpdateResultEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryPersistenceLevel,
    MemoryScope
} from '@mxf-dev/core/types/MemoryTypes';
import { MemoryUtilitySubdocument } from '@mxf-dev/core/types/MemoryUtilityTypes';
import { deleteAgentMemory } from '../../../src/server/api/controllers/agentLifecycleController';

const AGENT_ID = 'memory-agent-a';
const PEER_AGENT_ID = 'memory-agent-b';
const CHANNEL_ID = 'memory-channel-a';

type MemoryResultData =
    | MemoryGetResultEventData
    | MemoryUpdateResultEventData
    | MemoryDeleteResultEventData;

class FakeMemoryPersistence implements IMemoryPersistence {
    private readonly channelMemories = new Map<string, IChannelMemory>();
    private nextAgentSaveBarrier?: Promise<void>;
    private nextAgentSaveStarted?: () => void;
    private nextChannelSaveBarrier?: Promise<void>;
    private nextChannelSaveStarted?: () => void;
    private nextChannelMutationBarrier?: Promise<void>;
    private nextRelationshipSaveBarrier?: Promise<void>;
    private nextRelationshipSaveStarted?: () => void;

    public readonly getAgentMemory = jest.fn((agentId: string): Observable<IAgentMemory> => of({
        id: `agent-memory-${agentId}`,
        agentId,
        createdAt: new Date(1),
        updatedAt: new Date(1),
        persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
        notes: { seeded: true },
        conversationHistory: [],
        customData: {}
    }));

    public deferNextAgentSave(barrier: Promise<void>, onStarted?: () => void): void {
        this.nextAgentSaveBarrier = barrier;
        this.nextAgentSaveStarted = onStarted;
    }

    public readonly saveAgentMemory = jest.fn((memory: IAgentMemory): Observable<IAgentMemory> => {
        const barrier = this.nextAgentSaveBarrier;
        const onStarted = this.nextAgentSaveStarted;
        this.nextAgentSaveBarrier = undefined;
        this.nextAgentSaveStarted = undefined;
        return from((async (): Promise<IAgentMemory> => {
            onStarted?.();
            if (barrier) await barrier;
            return memory;
        })());
    });

    public readonly getChannelMemory = jest.fn((channelId: string): Observable<IChannelMemory> => {
        const stored = this.channelMemories.get(channelId);
        if (stored) {
            return of(stored);
        }
        const memory: IChannelMemory = {
            id: `channel-memory-${channelId}`,
            channelId,
            createdAt: new Date(1),
            updatedAt: new Date(1),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: { seeded: true },
            sharedState: {},
            conversationHistory: [],
            customData: {}
        };
        this.channelMemories.set(channelId, memory);
        return of(memory);
    });

    public deferNextChannelSave(barrier: Promise<void>, onStarted?: () => void): void {
        this.nextChannelSaveBarrier = barrier;
        this.nextChannelSaveStarted = onStarted;
    }

    public readonly saveChannelMemory = jest.fn((memory: IChannelMemory): Observable<IChannelMemory> => {
        const barrier = this.nextChannelSaveBarrier;
        const onStarted = this.nextChannelSaveStarted;
        this.nextChannelSaveBarrier = undefined;
        this.nextChannelSaveStarted = undefined;
        return from((async (): Promise<IChannelMemory> => {
            onStarted?.();
            if (barrier) await barrier;
            this.channelMemories.set(memory.channelId, memory);
            return memory;
        })());
    });

    public deferNextChannelMutation(barrier: Promise<void>): void {
        this.nextChannelMutationBarrier = barrier;
    }

    private applyChannelMutation(
        channelId: string,
        mutation: ChannelMemoryAtomicMutation
    ): ChannelMemoryAtomicMutationResult {
        const memory = this.channelMemories.get(channelId) ?? {
            id: `channel-memory-${channelId}`,
            channelId,
            createdAt: new Date(1),
            updatedAt: new Date(1),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            sharedState: {},
            conversationHistory: [],
            customData: {}
        };
        let value: unknown;
        switch (mutation.kind) {
            case 'append_messages':
                value = [...(memory.conversationHistory ?? []), ...mutation.messages];
                memory.conversationHistory = value as unknown[];
                break;
            case 'replace_context':
                if (
                    mutation.expectedUpdatedAt === undefined
                        ? memory.sharedState?.context !== undefined
                        : (
                            memory.sharedState?.context as { updatedAt?: unknown } | undefined
                        )?.updatedAt !== mutation.expectedUpdatedAt
                ) {
                    return {
                        found: false,
                        memory,
                        value: memory.sharedState?.context ?? null
                    };
                }
                value = mutation.context;
                memory.sharedState = { ...memory.sharedState, context: value };
                break;
            case 'append_context_history':
                value = [
                    ...((memory.customData?.contextHistory as unknown[] | undefined) ?? []),
                    ...mutation.entries
                ].slice(-mutation.retainLast);
                memory.customData = { ...memory.customData, contextHistory: value };
                break;
            case 'delete_messages':
                value = [];
                memory.conversationHistory = [];
                break;
            case 'delete_context':
                value = null;
                if (memory.sharedState) delete memory.sharedState.context;
                break;
            case 'delete_context_history':
                value = null;
                if (memory.customData) delete memory.customData.contextHistory;
                break;
        }
        memory.updatedAt = new Date();
        this.channelMemories.set(channelId, memory);
        return { found: true, memory, value };
    }

    public readonly mutateChannelMemory = jest.fn((
        channelId: string,
        mutation: ChannelMemoryAtomicMutation
    ): Observable<ChannelMemoryAtomicMutationResult> => {
        const barrier = this.nextChannelMutationBarrier;
        this.nextChannelMutationBarrier = undefined;
        return from((async (): Promise<ChannelMemoryAtomicMutationResult> => {
            if (barrier) await barrier;
            return this.applyChannelMutation(channelId, mutation);
        })());
    });

    public readonly getRelationshipMemory = jest.fn((
        agentId1: string,
        agentId2: string,
        channelId: string
    ): Observable<IRelationshipMemory> => of({
        id: `relationship-memory-${agentId1}-${agentId2}-${channelId}`,
        agentId1,
        agentId2,
        channelId,
        createdAt: new Date(1),
        updatedAt: new Date(1),
        persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
        notes: { seeded: true },
        interactionHistory: [],
        customData: {}
    }));

    public deferNextRelationshipSave(barrier: Promise<void>, onStarted?: () => void): void {
        this.nextRelationshipSaveBarrier = barrier;
        this.nextRelationshipSaveStarted = onStarted;
    }

    public readonly saveRelationshipMemory = jest.fn((
        memory: IRelationshipMemory
    ): Observable<IRelationshipMemory> => {
        const barrier = this.nextRelationshipSaveBarrier;
        const onStarted = this.nextRelationshipSaveStarted;
        this.nextRelationshipSaveBarrier = undefined;
        this.nextRelationshipSaveStarted = undefined;
        return from((async (): Promise<IRelationshipMemory> => {
            onStarted?.();
            if (barrier) await barrier;
            return memory;
        })());
    });

    public readonly deleteMemory = jest.fn((
        _scope: MemoryScope,
        _id: string | string[]
    ): Observable<boolean> => of(true));

    public async updateAgentMemoryUtility(
        _memoryId: string,
        _utility: Partial<MemoryUtilitySubdocument>
    ): Promise<void> {}

    public async getAgentMemoryUtilities(
        _memoryIds: string[]
    ): Promise<Map<string, MemoryUtilitySubdocument>> {
        return new Map();
    }
}

interface ScopeCase {
    label: string;
    scope: MemoryScope;
    id: string | string[];
}

const scopeCases: ScopeCase[] = [
    { label: 'agent', scope: MemoryScope.AGENT, id: AGENT_ID },
    { label: 'channel', scope: MemoryScope.CHANNEL, id: CHANNEL_ID },
    {
        label: 'relationship',
        scope: MemoryScope.RELATIONSHIP,
        id: [AGENT_ID, PEER_AGENT_ID, CHANNEL_ID]
    }
];

const waitForResult = <TData extends MemoryResultData>(
    eventName: string,
    operationId: string,
    emitRequest: () => void
): Promise<BaseEventPayload<TData>> => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error(`Timed out waiting for ${eventName}:${operationId}`));
    }, 1000);
    const subscription = EventBus.server.on(eventName, (payload: BaseEventPayload<TData>) => {
        if (payload.data.operationId !== operationId) {
            return;
        }
        clearTimeout(timeout);
        subscription.unsubscribe();
        resolve(payload);
    });
    emitRequest();
});

describe('MemoryService authoritative event bridge', () => {
    let persistence: FakeMemoryPersistence;

    beforeEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
        persistence = new FakeMemoryPersistence();
        MemoryService.getInstance({ persistenceService: persistence });
    });

    afterEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
    });

    it.each(scopeCases)('GET returns one exactly correlated $label result', async ({ scope, id }) => {
        const operationId = `get-${scope}`;
        const observed: BaseEventPayload<MemoryGetResultEventData>[] = [];
        const capture = EventBus.server.on(
            Events.Memory.GET_RESULT,
            (payload: BaseEventPayload<MemoryGetResultEventData>) => {
                if (payload.data.operationId === operationId) observed.push(payload);
            }
        );

        const result = await waitForResult<MemoryGetResultEventData>(
            Events.Memory.GET_RESULT,
            operationId,
            () => EventBus.server.emit(
                Events.Memory.GET,
                createMemoryGetEventPayload(
                    Events.Memory.GET,
                    AGENT_ID,
                    CHANNEL_ID,
                    { operationId, scope, id }
                )
            )
        );

        expect(result).toEqual(expect.objectContaining({
            agentId: AGENT_ID,
            channelId: CHANNEL_ID,
            data: expect.objectContaining({ operationId, scope, id, memory: expect.any(Object) })
        }));
        expect(observed).toHaveLength(1);
        capture.unsubscribe();
    });

    it.each(scopeCases)('UPDATE persists and returns one exactly correlated $label result', async ({ scope, id }) => {
        const operationId = `update-${scope}`;
        const observed: BaseEventPayload<MemoryUpdateResultEventData>[] = [];
        const capture = EventBus.server.on(
            Events.Memory.UPDATE_RESULT,
            (payload: BaseEventPayload<MemoryUpdateResultEventData>) => {
                if (payload.data.operationId === operationId) observed.push(payload);
            }
        );

        const result = await waitForResult<MemoryUpdateResultEventData>(
            Events.Memory.UPDATE_RESULT,
            operationId,
            () => EventBus.server.emit(
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(
                    Events.Memory.UPDATE,
                    AGENT_ID,
                    CHANNEL_ID,
                    { operationId, scope, id, data: { notes: { updated: true } } }
                )
            )
        );

        expect(result.agentId).toBe(AGENT_ID);
        expect(result.channelId).toBe(CHANNEL_ID);
        expect(result.data).toEqual(expect.objectContaining({ operationId, scope, id }));
        expect(result.data.memory).toEqual(expect.objectContaining({ notes: { seeded: true, updated: true } }));
        expect(observed).toHaveLength(1);
        const expectedSave = scope === MemoryScope.AGENT
            ? persistence.saveAgentMemory
            : scope === MemoryScope.CHANNEL
                ? persistence.saveChannelMemory
                : persistence.saveRelationshipMemory;
        expect(expectedSave).toHaveBeenCalledTimes(1);
        capture.unsubscribe();
    });

    it('keeps a deferred memory write inside the EventBus shutdown drain', async () => {
        let releaseSave!: () => void;
        let markSaveStarted!: () => void;
        const saveBarrier = new Promise<void>(resolve => {
            releaseSave = resolve;
        });
        const saveStarted = new Promise<void>(resolve => {
            markSaveStarted = resolve;
        });
        persistence.deferNextAgentSave(saveBarrier, markSaveStarted);

        EventBus.server.emit(
            Events.Memory.UPDATE,
            createMemoryUpdateEventPayload(
                Events.Memory.UPDATE,
                AGENT_ID,
                CHANNEL_ID,
                {
                    operationId: 'shutdown-drain-update',
                    scope: MemoryScope.AGENT,
                    id: AGENT_ID,
                    data: { notes: { drained: true } }
                }
            )
        );
        await saveStarted;

        let drainSettled = false;
        const drain = EventBus.drain().then((): void => {
            drainSettled = true;
        });
        await Promise.resolve();
        expect(drainSettled).toBe(false);
        expect(EventBus.server.pendingHandlerCount()).toBe(1);

        releaseSave();
        await drain;
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });

    it.each(scopeCases)('DELETE persists and returns one exactly correlated $label result', async ({ scope, id }) => {
        const operationId = `delete-${scope}`;
        const observed: BaseEventPayload<MemoryDeleteResultEventData>[] = [];
        const capture = EventBus.server.on(
            Events.Memory.DELETE_RESULT,
            (payload: BaseEventPayload<MemoryDeleteResultEventData>) => {
                if (payload.data.operationId === operationId) observed.push(payload);
            }
        );

        const result = await waitForResult<MemoryDeleteResultEventData>(
            Events.Memory.DELETE_RESULT,
            operationId,
            () => EventBus.server.emit(
                Events.Memory.DELETE,
                createMemoryDeleteEventPayload(
                    Events.Memory.DELETE,
                    AGENT_ID,
                    CHANNEL_ID,
                    { operationId, scope, id }
                )
            )
        );

        expect(result).toEqual(expect.objectContaining({
            agentId: AGENT_ID,
            channelId: CHANNEL_ID,
            data: { operationId, scope, id, success: true }
        }));
        expect(persistence.deleteMemory).toHaveBeenCalledWith(scope, id);
        expect(observed).toHaveLength(1);
        capture.unsubscribe();
    });

    describe('identity binding', () => {
        const OTHER_AGENT_ID = 'memory-agent-c';
        const OTHER_CHANNEL_ID = 'memory-channel-b';

        interface ForeignCase {
            label: string;
            scope: MemoryScope;
            id: string | string[];
            error: RegExp;
        }

        const foreignCases: ForeignCase[] = [
            {
                label: "another agent's memory",
                scope: MemoryScope.AGENT,
                id: PEER_AGENT_ID,
                error: /limited to the requesting agent/
            },
            {
                label: "another channel's memory document",
                scope: MemoryScope.CHANNEL,
                id: OTHER_CHANNEL_ID,
                error: /limited to the request channel/
            },
            {
                label: 'a relationship the requester is not part of',
                scope: MemoryScope.RELATIONSHIP,
                id: [PEER_AGENT_ID, OTHER_AGENT_ID, CHANNEL_ID],
                error: /participant of the relationship/
            }
        ];

        const persistenceCalls = (): number => [
            persistence.getAgentMemory, persistence.saveAgentMemory,
            persistence.getChannelMemory, persistence.saveChannelMemory,
            persistence.getRelationshipMemory, persistence.saveRelationshipMemory,
            persistence.deleteMemory
        ].reduce((count, spy) => count + (spy as jest.Mock).mock.calls.length, 0);

        it.each(foreignCases)('GET of $label returns an error and reads nothing', async ({ scope, id, error }) => {
            const operationId = `foreign-get-${scope}`;
            const result = await waitForResult<MemoryGetResultEventData>(
                Events.Memory.GET_RESULT,
                operationId,
                () => EventBus.server.emit(
                    Events.Memory.GET,
                    createMemoryGetEventPayload(Events.Memory.GET, AGENT_ID, CHANNEL_ID, {
                        operationId, scope, id
                    })
                )
            );

            expect(result.data).toEqual(expect.objectContaining({
                operationId, memory: null, error: expect.stringMatching(error)
            }));
            expect(persistenceCalls()).toBe(0);
        });

        it.each(foreignCases)('UPDATE of $label returns an error and writes nothing', async ({ scope, id, error }) => {
            const operationId = `foreign-update-${scope}`;
            const result = await waitForResult<MemoryUpdateResultEventData>(
                Events.Memory.UPDATE_RESULT,
                operationId,
                () => EventBus.server.emit(
                    Events.Memory.UPDATE,
                    createMemoryUpdateEventPayload(Events.Memory.UPDATE, AGENT_ID, CHANNEL_ID, {
                        operationId, scope, id, data: { notes: { injected: true } }
                    })
                )
            );

            expect(result.data).toEqual(expect.objectContaining({
                operationId, memory: null, error: expect.stringMatching(error)
            }));
            expect(persistenceCalls()).toBe(0);
        });

        it.each(foreignCases)('DELETE of $label returns an error and deletes nothing', async ({ scope, id, error }) => {
            const operationId = `foreign-delete-${scope}`;
            const result = await waitForResult<MemoryDeleteResultEventData>(
                Events.Memory.DELETE_RESULT,
                operationId,
                () => EventBus.server.emit(
                    Events.Memory.DELETE,
                    createMemoryDeleteEventPayload(Events.Memory.DELETE, AGENT_ID, CHANNEL_ID, {
                        operationId, scope, id
                    })
                )
            );

            expect(result.data).toEqual(expect.objectContaining({
                operationId, error: expect.stringMatching(error)
            }));
            expect(persistenceCalls()).toBe(0);
        });

        it('accepts a relationship request from either participant', async () => {
            const operationId = 'peer-relationship-get';
            const result = await waitForResult<MemoryGetResultEventData>(
                Events.Memory.GET_RESULT,
                operationId,
                () => EventBus.server.emit(
                    Events.Memory.GET,
                    createMemoryGetEventPayload(Events.Memory.GET, PEER_AGENT_ID, CHANNEL_ID, {
                        operationId,
                        scope: MemoryScope.RELATIONSHIP,
                        id: [AGENT_ID, PEER_AGENT_ID, CHANNEL_ID]
                    })
                )
            );

            expect(result.data.error).toBeUndefined();
            expect(result.data.memory).not.toBeNull();
        });
    });

    it('returns a correlated error and no success result when persistence fails', async () => {
        persistence.saveAgentMemory.mockReturnValueOnce(
            throwError(() => new Error('persistence unavailable'))
        );
        const operationId = 'update-agent-failure';

        const result = await waitForResult<MemoryUpdateResultEventData>(
            Events.Memory.UPDATE_RESULT,
            operationId,
            () => EventBus.server.emit(
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(
                    Events.Memory.UPDATE,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId,
                        scope: MemoryScope.AGENT,
                        id: AGENT_ID,
                        data: { notes: { shouldNotPersist: true } }
                    }
                )
            )
        );

        expect(result.agentId).toBe(AGENT_ID);
        expect(result.channelId).toBe(CHANNEL_ID);
        expect(result.data).toEqual({
            operationId,
            scope: MemoryScope.AGENT,
            id: AGENT_ID,
            memory: null,
            error: 'persistence unavailable'
        });
        const memoryAfterFailure = await firstValueFrom(
            MemoryService.getInstance().getAgentMemory(AGENT_ID)
        );
        expect(memoryAfterFailure.notes).toEqual({ seeded: true });
        expect(persistence.getAgentMemory).toHaveBeenCalledTimes(1);
    });

    it.each([
        { conversationHistory: [{ messageId: 'bypass' }] },
        { 'conversationHistory.0': { messageId: 'dotted-bypass' } },
        { sharedState: { context: { channelId: CHANNEL_ID } } },
        { 'sharedState.context.updatedAt': 0 },
        { sharedState: { 'context.updatedAt': 0 } },
        { customData: { contextHistory: [{ timestamp: 1 }] } },
        { 'customData.contextHistory.0': { timestamp: 1 } },
        { customData: { 'contextHistory.0': { timestamp: 1 } } }
    ])('rejects generic writes to reserved atomic channel fields: %p', async data => {
        const operationId = `reserved-${Object.keys(data)[0]}`;
        const result = await waitForResult<MemoryUpdateResultEventData>(
            Events.Memory.UPDATE_RESULT,
            operationId,
            () => EventBus.server.emit(
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(
                    Events.Memory.UPDATE,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId,
                        scope: MemoryScope.CHANNEL,
                        id: CHANNEL_ID,
                        data
                    }
                )
            )
        );

        expect(result.data).toEqual(expect.objectContaining({
            operationId,
            memory: null,
            error: expect.stringContaining('Reserved channel memory fields')
        }));
        expect(persistence.saveChannelMemory).not.toHaveBeenCalled();
        expect(persistence.mutateChannelMemory).not.toHaveBeenCalled();
    });

    it('persists keyed channel context and hydrates it after a service restart', async () => {
        const key = `channel:context:${CHANNEL_ID}`;
        const value = { channelId: CHANNEL_ID, summary: 'durable context' };
        await waitForResult<MemoryUpdateResultEventData>(
            Events.Memory.UPDATE_RESULT,
            'keyed-update',
            () => EventBus.server.emit(
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(
                    Events.Memory.UPDATE,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId: 'keyed-update',
                        scope: MemoryScope.CHANNEL,
                        id: key,
                        data: { [key]: value }
                    }
                )
            )
        );
        expect(persistence.mutateChannelMemory).toHaveBeenCalledTimes(1);

        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
        MemoryService.getInstance({ persistenceService: persistence });
        const result = await waitForResult<MemoryGetResultEventData>(
            Events.Memory.GET_RESULT,
            'keyed-get-after-restart',
            () => EventBus.server.emit(
                Events.Memory.GET,
                createMemoryGetEventPayload(
                    Events.Memory.GET,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId: 'keyed-get-after-restart',
                        scope: MemoryScope.CHANNEL,
                        id: key,
                        key
                    }
                )
            )
        );
        expect(result.data.memory).toEqual(value);
    });

    it('serializes same-agent updates before reading the next snapshot', async () => {
        let releaseFirstSave: (() => void) | undefined;
        persistence.deferNextAgentSave(new Promise<void>(resolve => {
            releaseFirstSave = resolve;
        }));
        const service = MemoryService.getInstance();

        const firstUpdate = firstValueFrom(service.updateAgentMemory(AGENT_ID, {
            notes: { first: true }
        }));
        const secondUpdate = firstValueFrom(service.updateAgentMemory(AGENT_ID, {
            notes: { second: true }
        }));

        await new Promise<void>(resolve => setImmediate(resolve));
        expect(persistence.saveAgentMemory).toHaveBeenCalledTimes(1);
        releaseFirstSave?.();
        const [, secondResult] = await Promise.all([firstUpdate, secondUpdate]);

        expect(persistence.saveAgentMemory).toHaveBeenCalledTimes(2);
        expect(secondResult.notes).toEqual({ seeded: true, first: true, second: true });
    });

    it('makes an acknowledged agent delete final after an in-flight update', async () => {
        let releaseSave: (() => void) | undefined;
        let markSaveStarted: (() => void) | undefined;
        const saveBarrier = new Promise<void>(resolve => {
            releaseSave = resolve;
        });
        const saveStarted = new Promise<void>(resolve => {
            markSaveStarted = resolve;
        });
        persistence.deferNextAgentSave(saveBarrier, () => markSaveStarted?.());
        const service = MemoryService.getInstance();

        const update = firstValueFrom(service.updateAgentMemory(AGENT_ID, {
            notes: { beforeDelete: true }
        }));
        await saveStarted;
        const deletion = firstValueFrom(service.deleteMemory(MemoryScope.AGENT, AGENT_ID));

        expect(persistence.deleteMemory).not.toHaveBeenCalled();
        releaseSave?.();
        await update;
        await expect(deletion).resolves.toBe(true);
        expect(persistence.saveAgentMemory.mock.invocationCallOrder[0])
            .toBeLessThan(persistence.deleteMemory.mock.invocationCallOrder[0]);
        expect(persistence.saveAgentMemory).toHaveBeenCalledTimes(1);
    });

    it('makes an acknowledged channel delete final after an in-flight update', async () => {
        let releaseSave: (() => void) | undefined;
        let markSaveStarted: (() => void) | undefined;
        const saveBarrier = new Promise<void>(resolve => {
            releaseSave = resolve;
        });
        const saveStarted = new Promise<void>(resolve => {
            markSaveStarted = resolve;
        });
        persistence.deferNextChannelSave(saveBarrier, () => markSaveStarted?.());
        const service = MemoryService.getInstance();

        const update = firstValueFrom(service.updateChannelMemory(CHANNEL_ID, {
            notes: { beforeDelete: true }
        }));
        await saveStarted;
        const deletion = firstValueFrom(service.deleteMemory(MemoryScope.CHANNEL, CHANNEL_ID));

        expect(persistence.deleteMemory).not.toHaveBeenCalled();
        releaseSave?.();
        await update;
        await expect(deletion).resolves.toBe(true);
        expect(persistence.saveChannelMemory.mock.invocationCallOrder[0])
            .toBeLessThan(persistence.deleteMemory.mock.invocationCallOrder[0]);
        expect(persistence.saveChannelMemory).toHaveBeenCalledTimes(1);
    });

    it('normalizes relationship identity so reverse-order update cannot outlive deletion', async () => {
        let releaseSave: (() => void) | undefined;
        let markSaveStarted: (() => void) | undefined;
        const saveBarrier = new Promise<void>(resolve => {
            releaseSave = resolve;
        });
        const saveStarted = new Promise<void>(resolve => {
            markSaveStarted = resolve;
        });
        persistence.deferNextRelationshipSave(saveBarrier, () => markSaveStarted?.());
        const service = MemoryService.getInstance();

        const update = firstValueFrom(service.updateRelationshipMemory(
            PEER_AGENT_ID,
            AGENT_ID,
            CHANNEL_ID,
            { notes: { beforeDelete: true } }
        ));
        await saveStarted;
        const deletion = firstValueFrom(service.deleteMemory(
            MemoryScope.RELATIONSHIP,
            [AGENT_ID, PEER_AGENT_ID, CHANNEL_ID]
        ));

        expect(persistence.deleteMemory).not.toHaveBeenCalled();
        releaseSave?.();
        await update;
        await expect(deletion).resolves.toBe(true);
        expect(persistence.saveRelationshipMemory.mock.invocationCallOrder[0])
            .toBeLessThan(persistence.deleteMemory.mock.invocationCallOrder[0]);
        expect(persistence.saveRelationshipMemory).toHaveBeenCalledTimes(1);
    });

    it('purges only the deleted agent cognitive cache after persistence succeeds', async () => {
        const otherAgentId = 'memory-agent-other';
        const service = MemoryService.getInstance();
        await firstValueFrom(service.getAgentMemory(AGENT_ID));
        await firstValueFrom(service.getAgentMemory(otherAgentId));
        await firstValueFrom(service.storeObservation(AGENT_ID, CHANNEL_ID, {
            id: 'deleted-observation',
            agentId: AGENT_ID,
            source: 'test',
            content: 'delete me',
            timestamp: 1
        }));
        await firstValueFrom(service.storeObservation(otherAgentId, CHANNEL_ID, {
            id: 'preserved-observation',
            agentId: otherAgentId,
            source: 'test',
            content: 'keep me',
            timestamp: 2
        }));

        await expect(firstValueFrom(
            service.deleteMemory(MemoryScope.AGENT, AGENT_ID)
        )).resolves.toBe(true);
        await firstValueFrom(service.getAgentMemory(AGENT_ID));

        await expect(firstValueFrom(
            service.queryCognitiveMemory(AGENT_ID, CHANNEL_ID)
        )).resolves.toEqual([]);
        await expect(firstValueFrom(
            service.queryCognitiveMemory(otherAgentId, CHANNEL_ID)
        )).resolves.toEqual([
            expect.objectContaining({
                agentId: otherAgentId,
                content: expect.objectContaining({ content: 'keep me' })
            })
        ]);
    });

    it('serializes deferred keyed batches and returns the authoritative combined value', async () => {
        let releaseFirstMutation: (() => void) | undefined;
        persistence.deferNextChannelMutation(new Promise<void>(resolve => {
            releaseFirstMutation = resolve;
        }));
        const key = `channel:messages:${CHANNEL_ID}`;
        const firstMessage = { messageId: 'first', timestamp: 1 };
        const secondMessage = { messageId: 'second', timestamp: 2 };

        const firstResult = waitForResult<MemoryUpdateResultEventData>(
            Events.Memory.UPDATE_RESULT,
            'append-first',
            () => EventBus.server.emit(
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(
                    Events.Memory.UPDATE,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId: 'append-first',
                        scope: MemoryScope.CHANNEL,
                        id: key,
                        data: { [key]: [firstMessage] }
                    }
                )
            )
        );
        const secondResult = waitForResult<MemoryUpdateResultEventData>(
            Events.Memory.UPDATE_RESULT,
            'append-second',
            () => EventBus.server.emit(
                Events.Memory.UPDATE,
                createMemoryUpdateEventPayload(
                    Events.Memory.UPDATE,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId: 'append-second',
                        scope: MemoryScope.CHANNEL,
                        id: key,
                        data: { [key]: [secondMessage] }
                    }
                )
            )
        );

        await new Promise<void>(resolve => setImmediate(resolve));
        expect(persistence.mutateChannelMemory).toHaveBeenCalledTimes(1);
        releaseFirstMutation?.();
        await expect(Promise.all([firstResult, secondResult])).resolves.toHaveLength(2);
        expect(persistence.mutateChannelMemory).toHaveBeenCalledTimes(2);

        const read = await waitForResult<MemoryGetResultEventData>(
            Events.Memory.GET_RESULT,
            'read-combined-batches',
            () => EventBus.server.emit(
                Events.Memory.GET,
                createMemoryGetEventPayload(
                    Events.Memory.GET,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId: 'read-combined-batches',
                        scope: MemoryScope.CHANNEL,
                        id: key,
                        key
                    }
                )
            )
        );
        expect(read.data.memory).toEqual([firstMessage, secondMessage]);
    });

    it('does not clear cache or report success when persistent deletion returns false', async () => {
        const service = MemoryService.getInstance();
        const cachedMemory = await new Promise<IAgentMemory>((resolve, reject) => {
            service.getAgentMemory(AGENT_ID).subscribe({ next: resolve, error: reject });
        });
        persistence.deleteMemory.mockReturnValueOnce(of(false));

        const result = await waitForResult<MemoryDeleteResultEventData>(
            Events.Memory.DELETE_RESULT,
            'delete-persistence-false',
            () => EventBus.server.emit(
                Events.Memory.DELETE,
                createMemoryDeleteEventPayload(
                    Events.Memory.DELETE,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId: 'delete-persistence-false',
                        scope: MemoryScope.AGENT,
                        id: AGENT_ID
                    }
                )
            )
        );

        expect(result.data.success).toBe(false);
        const memoryAfterFailedDelete = await new Promise<IAgentMemory>((resolve, reject) => {
            service.getAgentMemory(AGENT_ID).subscribe({ next: resolve, error: reject });
        });
        expect(memoryAfterFailedDelete).toBe(cachedMemory);
        expect(persistence.getAgentMemory).toHaveBeenCalledTimes(1);
    });

    it('evicts canonical cache when the agent lifecycle endpoint confirms deletion', async () => {
        const service = MemoryService.getInstance();
        const cachedMemory = await firstValueFrom(service.getAgentMemory(AGENT_ID));
        const json = jest.fn();
        const status = jest.fn().mockReturnValue({ json });

        await deleteAgentMemory(
            { params: { agentId: AGENT_ID } } as unknown as Request,
            { status, json } as unknown as Response
        );

        expect(persistence.deleteMemory).toHaveBeenCalledWith(MemoryScope.AGENT, AGENT_ID);
        expect(status).toHaveBeenCalledWith(200);

        const reloadedMemory = await firstValueFrom(service.getAgentMemory(AGENT_ID));
        expect(reloadedMemory).not.toBe(cachedMemory);
        expect(persistence.getAgentMemory).toHaveBeenCalledTimes(2);
    });
});
