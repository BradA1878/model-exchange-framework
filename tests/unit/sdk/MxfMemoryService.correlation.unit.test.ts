import { firstValueFrom, Observable } from 'rxjs';

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    BaseEventPayload,
    BaseMemoryOperationData,
    createAgentEventPayload,
    createMemoryDeleteResultEventPayload,
    createMemoryGetResultEventPayload,
    createMemoryUpdateResultEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryPersistenceLevel,
    MemoryScope
} from '@mxf-dev/core/types/MemoryTypes';
import { MxfMemoryService } from '@mxf-dev/sdk/services/MxfMemoryService';

const AGENT_ID = 'sdk-memory-agent';
const PEER_ID = 'sdk-memory-peer';
const CHANNEL_ID = 'sdk-memory-channel';

const agentMemory: IAgentMemory = {
    id: 'agent-memory',
    agentId: AGENT_ID,
    createdAt: new Date(1),
    updatedAt: new Date(1),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: {},
    conversationHistory: [],
    customData: {}
};

const channelMemory: IChannelMemory = {
    id: 'channel-memory',
    channelId: CHANNEL_ID,
    createdAt: new Date(1),
    updatedAt: new Date(1),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: {},
    sharedState: {},
    conversationHistory: [],
    customData: {}
};

const relationshipMemory: IRelationshipMemory = {
    id: 'relationship-memory',
    agentId1: AGENT_ID,
    agentId2: PEER_ID,
    channelId: CHANNEL_ID,
    createdAt: new Date(1),
    updatedAt: new Date(1),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: {},
    interactionHistory: [],
    customData: {}
};

const memoryForScope = (scope: MemoryScope): IAgentMemory | IChannelMemory | IRelationshipMemory => {
    if (scope === MemoryScope.AGENT) return agentMemory;
    if (scope === MemoryScope.CHANNEL) return channelMemory;
    return relationshipMemory;
};

interface MemoryProxyCase {
    label: string;
    scope: MemoryScope;
    run: (target: MxfMemoryService) => Observable<unknown>;
}

describe('MxfMemoryService correlated memory proxy', () => {
    let service: MxfMemoryService;

    beforeEach(() => {
        EventBus.reset();
        (MxfMemoryService as unknown as { instance?: MxfMemoryService }).instance = undefined;
        service = MxfMemoryService.getInstance();
        jest.spyOn(EventBus.client, 'isRegisteredSocketConnected').mockReturnValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
        (MxfMemoryService as unknown as { instance?: MxfMemoryService }).instance = undefined;
    });

    it.each<MemoryProxyCase>([
        {
            label: 'agent',
            scope: MemoryScope.AGENT,
            run: (target: MxfMemoryService): Observable<unknown> =>
                target.getAgentMemory(AGENT_ID, CHANNEL_ID)
        },
        {
            label: 'channel',
            scope: MemoryScope.CHANNEL,
            run: (target: MxfMemoryService): Observable<unknown> =>
                target.getChannelMemory(AGENT_ID, CHANNEL_ID, CHANNEL_ID)
        },
        {
            label: 'relationship',
            scope: MemoryScope.RELATIONSHIP,
            run: (target: MxfMemoryService): Observable<unknown> => target.getRelationshipMemory(
                AGENT_ID,
                CHANNEL_ID,
                AGENT_ID,
                PEER_ID
            )
        }
    ])('GET ignores unrelated results and returns exact $label memory', async ({ scope, run }) => {
        const emitSpy = jest.spyOn(EventBus.client, 'emitOn').mockImplementation((
            _agentId,
            _event,
            rawPayload
        ) => {
            const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
            EventBus.client.emitLocal(
                Events.Memory.GET_RESULT,
                createMemoryGetResultEventPayload(
                    Events.Memory.GET_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        ...payload.data,
                        operationId: 'unrelated-operation',
                        memory: memoryForScope(scope)
                    }
                )
            );
            EventBus.client.emitLocal(
                Events.Memory.GET_RESULT,
                createMemoryGetResultEventPayload(
                    Events.Memory.GET_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    { ...payload.data, memory: memoryForScope(scope) }
                )
            );
        });

        await expect(firstValueFrom(run(service))).resolves.toBe(memoryForScope(scope));
        expect(emitSpy).toHaveBeenCalledTimes(1);
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
    });

    it.each<MemoryProxyCase>([
        {
            label: 'agent',
            scope: MemoryScope.AGENT,
            run: (target: MxfMemoryService): Observable<unknown> => target.updateAgentMemory(
                AGENT_ID,
                CHANNEL_ID,
                agentMemory
            )
        },
        {
            label: 'channel',
            scope: MemoryScope.CHANNEL,
            run: (target: MxfMemoryService): Observable<unknown> => target.updateChannelMemory(
                AGENT_ID,
                CHANNEL_ID,
                CHANNEL_ID,
                channelMemory
            )
        },
        {
            label: 'relationship',
            scope: MemoryScope.RELATIONSHIP,
            run: (target: MxfMemoryService): Observable<unknown> => target.updateRelationshipMemory(
                AGENT_ID,
                CHANNEL_ID,
                AGENT_ID,
                PEER_ID,
                relationshipMemory
            )
        }
    ])('UPDATE returns exact $label result and cleans its listener', async ({ scope, run }) => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, _event, rawPayload) => {
            const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
            EventBus.client.emitLocal(
                Events.Memory.UPDATE_RESULT,
                createMemoryUpdateResultEventPayload(
                    Events.Memory.UPDATE_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    { ...payload.data, memory: memoryForScope(scope) }
                )
            );
        });

        await expect(firstValueFrom(run(service))).resolves.toBe(memoryForScope(scope));
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_RESULT)).toBe(0);
    });

    it.each([
        { label: 'agent', scope: MemoryScope.AGENT, id: AGENT_ID },
        { label: 'channel', scope: MemoryScope.CHANNEL, id: CHANNEL_ID },
        {
            label: 'relationship',
            scope: MemoryScope.RELATIONSHIP,
            id: [AGENT_ID, PEER_ID, CHANNEL_ID]
        }
    ])('DELETE returns the authoritative $label result', async ({ scope, id }) => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, _event, rawPayload) => {
            const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
            EventBus.client.emitLocal(
                Events.Memory.DELETE_RESULT,
                createMemoryDeleteResultEventPayload(
                    Events.Memory.DELETE_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    { ...payload.data, success: true }
                )
            );
        });

        await expect(firstValueFrom(service.deleteMemory(
            AGENT_ID,
            CHANNEL_ID,
            scope,
            id
        ))).resolves.toBe(true);
        expect(EventBus.client.listenerCount(Events.Memory.DELETE_RESULT)).toBe(0);
    });

    it.each<MemoryProxyCase>([
        {
            label: 'agent',
            scope: MemoryScope.AGENT,
            run: (target: MxfMemoryService): Observable<unknown> =>
                target.getAgentMemory(AGENT_ID, CHANNEL_ID)
        },
        {
            label: 'channel',
            scope: MemoryScope.CHANNEL,
            run: (target: MxfMemoryService): Observable<unknown> =>
                target.getChannelMemory(AGENT_ID, CHANNEL_ID, CHANNEL_ID)
        },
        {
            label: 'relationship',
            scope: MemoryScope.RELATIONSHIP,
            run: (target: MxfMemoryService): Observable<unknown> => target.getRelationshipMemory(
                AGENT_ID,
                CHANNEL_ID,
                AGENT_ID,
                PEER_ID
            )
        }
    ])('rejects a correlated $label GET result-carried error', async ({ run }) => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, _event, rawPayload) => {
            const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
            EventBus.client.emitLocal(
                Events.Memory.GET_RESULT,
                createMemoryGetResultEventPayload(
                    Events.Memory.GET_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    { ...payload.data, memory: null, error: 'GET storage unavailable' }
                )
            );
        });

        await expect(firstValueFrom(run(service))).rejects.toThrow('GET storage unavailable');
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
    });

    it.each<MemoryProxyCase>([
        {
            label: 'agent',
            scope: MemoryScope.AGENT,
            run: (target: MxfMemoryService): Observable<unknown> => target.updateAgentMemory(
                AGENT_ID,
                CHANNEL_ID,
                { notes: { key: 'value' } }
            )
        },
        {
            label: 'channel',
            scope: MemoryScope.CHANNEL,
            run: (target: MxfMemoryService): Observable<unknown> => target.updateChannelMemory(
                AGENT_ID,
                CHANNEL_ID,
                CHANNEL_ID,
                { sharedState: { key: 'value' } }
            )
        },
        {
            label: 'relationship',
            scope: MemoryScope.RELATIONSHIP,
            run: (target: MxfMemoryService): Observable<unknown> => target.updateRelationshipMemory(
                AGENT_ID,
                CHANNEL_ID,
                AGENT_ID,
                PEER_ID,
                { notes: { key: 'value' } }
            )
        }
    ])('rejects a correlated $label UPDATE result-carried error', async ({ run }) => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, _event, rawPayload) => {
            const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
            EventBus.client.emitLocal(
                Events.Memory.UPDATE_RESULT,
                createMemoryUpdateResultEventPayload(
                    Events.Memory.UPDATE_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    { ...payload.data, memory: null, error: 'UPDATE storage unavailable' }
                )
            );
        });

        await expect(firstValueFrom(run(service))).rejects.toThrow('UPDATE storage unavailable');
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_RESULT)).toBe(0);
    });

    it.each([
        { label: 'agent', scope: MemoryScope.AGENT, id: AGENT_ID },
        { label: 'channel', scope: MemoryScope.CHANNEL, id: CHANNEL_ID },
        {
            label: 'relationship',
            scope: MemoryScope.RELATIONSHIP,
            id: [AGENT_ID, PEER_ID, CHANNEL_ID]
        }
    ])('rejects a correlated $label DELETE result-carried error', async ({ scope, id }) => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, _event, rawPayload) => {
            const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
            EventBus.client.emitLocal(
                Events.Memory.DELETE_RESULT,
                createMemoryDeleteResultEventPayload(
                    Events.Memory.DELETE_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    { ...payload.data, success: false, error: 'DELETE storage unavailable' }
                )
            );
        });

        await expect(firstValueFrom(service.deleteMemory(
            AGENT_ID,
            CHANNEL_ID,
            scope,
            id
        ))).rejects.toThrow('DELETE storage unavailable');
        expect(EventBus.client.listenerCount(Events.Memory.DELETE_RESULT)).toBe(0);
    });

    it('rejects an unconfirmed deletion instead of returning false', async () => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, _event, rawPayload) => {
            const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
            EventBus.client.emitLocal(
                Events.Memory.DELETE_RESULT,
                createMemoryDeleteResultEventPayload(
                    Events.Memory.DELETE_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    { ...payload.data, success: false }
                )
            );
        });

        await expect(firstValueFrom(service.deleteMemory(
            AGENT_ID,
            CHANNEL_ID,
            MemoryScope.AGENT,
            AGENT_ID
        ))).rejects.toThrow(/did not confirm deletion/);
    });

    it('rejects an exact correlated error event and removes every request listener', async () => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, _event, rawPayload) => {
            const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
            EventBus.client.emitLocal(
                Events.Memory.GET_ERROR,
                createMemoryGetResultEventPayload(
                    Events.Memory.GET_ERROR,
                    AGENT_ID,
                    CHANNEL_ID,
                    { ...payload.data, memory: null, error: 'read rejected' }
                )
            );
        });

        await expect(firstValueFrom(service.getAgentMemory(AGENT_ID, CHANNEL_ID)))
            .rejects.toThrow('read rejected');
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.GET_ERROR)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
    });

    it('ignores a sibling agent result even when it copied the exact operation ID', async () => {
        let requestPayload: BaseEventPayload<BaseMemoryOperationData> | undefined;
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((
            _agentId,
            _event,
            rawPayload
        ) => {
            requestPayload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
        });

        const request = firstValueFrom(service.getAgentMemory(AGENT_ID, CHANNEL_ID));
        expect(requestPayload).toBeDefined();
        const operationId = requestPayload!.data.operationId;

        EventBus.client.emitLocal(
            Events.Memory.GET_RESULT,
            createMemoryGetResultEventPayload(
                Events.Memory.GET_RESULT,
                'sibling-agent',
                CHANNEL_ID,
                {
                    ...requestPayload!.data,
                    operationId,
                    memory: { ...agentMemory, agentId: 'sibling-agent' }
                }
            )
        );
        await Promise.resolve();
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(1);

        EventBus.client.emitLocal(
            Events.Memory.GET_RESULT,
            createMemoryGetResultEventPayload(
                Events.Memory.GET_RESULT,
                AGENT_ID,
                CHANNEL_ID,
                { ...requestPayload!.data, operationId, memory: agentMemory }
            )
        );

        await expect(request).resolves.toBe(agentMemory);
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
    });

    it('fails immediately without a connected named agent socket and leaks no listeners', async () => {
        jest.mocked(EventBus.client.isRegisteredSocketConnected).mockReturnValue(false);
        const emitSpy = jest.spyOn(EventBus.client, 'emitOn');

        await expect(firstValueFrom(service.getAgentMemory(AGENT_ID, CHANNEL_ID)))
            .rejects.toThrow(/agent socket .* is not connected/);

        expect(emitSpy).not.toHaveBeenCalled();
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.GET_ERROR)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
    });

    it('rejects and cleans every request when the explicit lifecycle hook cancels an agent', async () => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
        const request = firstValueFrom(service.getAgentMemory(AGENT_ID, CHANNEL_ID));

        service.cancelPendingOperations(AGENT_ID, CHANNEL_ID, 'manual disconnect');

        await expect(request).rejects.toThrow(/manual disconnect/);
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.GET_ERROR)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
    });

    it('does not cancel the same agent\'s operation when another channel disconnects', async () => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
        const request = firstValueFrom(service.getAgentMemory(AGENT_ID, CHANNEL_ID));

        service.cancelPendingOperations(AGENT_ID, 'different-channel', 'channel disconnected');
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(1);

        service.cancelPendingOperations(AGENT_ID, CHANNEL_ID, 'own channel disconnected');
        await expect(request).rejects.toThrow(/own channel disconnected/);
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
    });

    it('cancels a pending request on exact-agent disconnect but ignores another agent', async () => {
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
        const request = firstValueFrom(service.getAgentMemory(AGENT_ID, CHANNEL_ID));

        // MxfService emits Agent.DISCONNECT locally for the agent whose socket
        // dropped. Agent.DISCONNECTED is the server's announcement to everyone
        // else and never reaches this client.

        EventBus.client.emitLocal(
            Events.Agent.DISCONNECT,
            createAgentEventPayload(
                Events.Agent.DISCONNECT,
                'different-agent',
                CHANNEL_ID,
                { agentId: 'different-agent' }
            )
        );
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(1);

        EventBus.client.emitLocal(
            Events.Agent.DISCONNECT,
            createAgentEventPayload(
                Events.Agent.DISCONNECT,
                AGENT_ID,
                CHANNEL_ID,
                { agentId: AGENT_ID, reason: 'transport closed' }
            )
        );

        await expect(request).rejects.toThrow(/disconnected: transport closed/);
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.GET_ERROR)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
    });

    it('uses no timer and unsubscribe removes every listener from an unanswered request', () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);

        const subscription = service.getAgentMemory(AGENT_ID, CHANNEL_ID).subscribe();

        expect(setTimeoutSpy).not.toHaveBeenCalled();
        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(1);
        expect(EventBus.client.listenerCount(Events.Memory.GET_ERROR)).toBe(1);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(1);

        subscription.unsubscribe();

        expect(EventBus.client.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.GET_ERROR)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('rejects a forged agent deletion target before emitting', () => {
        const emitSpy = jest.spyOn(EventBus.client, 'emitOn');

        expect(() => service.deleteMemory(
            AGENT_ID,
            CHANNEL_ID,
            MemoryScope.AGENT,
            'victim-agent'
        )).toThrow(/self-scoped/);
        expect(emitSpy).not.toHaveBeenCalled();
    });
});
