import express, { NextFunction, Request, Response } from 'express';
import supertest from 'supertest';
import { Observable, of } from 'rxjs';

jest.mock('@mxf-dev/core/models/agent', () => ({
    Agent: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/channelKey', () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('../../../src/server/api/security/ChannelRuntimePolicy', () => ({
    hydrateChannelRuntimePolicy: jest.fn()
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    ChannelMemoryAtomicMutation,
    ChannelMemoryAtomicMutationResult,
    IMemoryPersistence
} from '@mxf-dev/core/interfaces/IMemoryPersistence';
import { Agent } from '@mxf-dev/core/models/agent';
import { Channel } from '@mxf-dev/core/models/channel';
import {
    BaseEventPayload,
    createMemoryGetEventPayload,
    createMemoryUpdateEventPayload,
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
import memoryRoutes from '../../../src/server/api/routes/memoryRoutes';

const AGENT_A1 = 'tenant-a-agent-1';
const AGENT_A2 = 'tenant-a-agent-2';
const AGENT_B1 = 'tenant-b-agent-1';
const CHANNEL_A = 'tenant-a-channel';
const CHANNEL_B = 'tenant-b-channel';

interface TestAgent {
    agentId: string;
    keyId: string;
    createdBy: string;
    memory: { notes: Record<string, unknown> };
}

const agentsByKey: Record<string, TestAgent> = {
    'key-a1': {
        agentId: AGENT_A1,
        keyId: 'key-a1',
        createdBy: 'user-a',
        memory: { notes: { legacyEmbeddedAgentMemory: true } }
    },
    'key-a2': {
        agentId: AGENT_A2,
        keyId: 'key-a2',
        createdBy: 'user-a',
        memory: { notes: { legacyEmbeddedAgentMemory: true } }
    },
    'key-b1': {
        agentId: AGENT_B1,
        keyId: 'key-b1',
        createdBy: 'user-b',
        memory: { notes: { legacyEmbeddedAgentMemory: true } }
    }
};

const channelsById = {
    [CHANNEL_A]: {
        channelId: CHANNEL_A,
        createdBy: 'user-a',
        participants: [AGENT_A1, AGENT_A2],
        sharedMemory: { notes: { legacyEmbeddedChannelMemory: true } },
        active: true,
        allowedTools: [],
        systemLlmEnabled: false
    },
    [CHANNEL_B]: {
        channelId: CHANNEL_B,
        createdBy: 'user-b',
        participants: [AGENT_B1],
        sharedMemory: { notes: { legacyEmbeddedChannelMemory: true } },
        active: true,
        allowedTools: [],
        systemLlmEnabled: false
    }
};

class InMemoryPersistence implements IMemoryPersistence {
    private readonly agentMemories = new Map<string, IAgentMemory>();
    private readonly channelMemories = new Map<string, IChannelMemory>();
    private readonly relationshipMemories = new Map<string, IRelationshipMemory>();

    public readonly saveAgentMemory = jest.fn((memory: IAgentMemory): Observable<IAgentMemory> => {
        this.agentMemories.set(memory.agentId, memory);
        return of(memory);
    });

    public readonly saveChannelMemory = jest.fn((memory: IChannelMemory): Observable<IChannelMemory> => {
        this.channelMemories.set(memory.channelId, memory);
        return of(memory);
    });

    public readonly saveRelationshipMemory = jest.fn((
        memory: IRelationshipMemory
    ): Observable<IRelationshipMemory> => {
        this.relationshipMemories.set(this.relationshipKey(
            memory.agentId1,
            memory.agentId2,
            memory.channelId
        ), memory);
        return of(memory);
    });

    public getAgentMemory(agentId: string): Observable<IAgentMemory> {
        const existing = this.agentMemories.get(agentId);
        if (existing) return of(existing);
        const memory: IAgentMemory = {
            id: `agent-memory-${agentId}`,
            agentId,
            createdAt: new Date(1),
            updatedAt: new Date(1),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            conversationHistory: [],
            customData: {}
        };
        this.agentMemories.set(agentId, memory);
        return of(memory);
    }

    public getChannelMemory(channelId: string): Observable<IChannelMemory> {
        const existing = this.channelMemories.get(channelId);
        if (existing) return of(existing);
        const memory: IChannelMemory = {
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
        this.channelMemories.set(channelId, memory);
        return of(memory);
    }

    public getRelationshipMemory(
        agentId1: string,
        agentId2: string,
        channelId?: string
    ): Observable<IRelationshipMemory> {
        const key = this.relationshipKey(agentId1, agentId2, channelId);
        const existing = this.relationshipMemories.get(key);
        if (existing) return of(existing);
        const [firstAgentId, secondAgentId] = [agentId1, agentId2].sort();
        const memory: IRelationshipMemory = {
            id: `relationship-memory-${key}`,
            agentId1: firstAgentId,
            agentId2: secondAgentId,
            channelId,
            createdAt: new Date(1),
            updatedAt: new Date(1),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            interactionHistory: [],
            customData: {}
        };
        this.relationshipMemories.set(key, memory);
        return of(memory);
    }

    public mutateChannelMemory(
        channelId: string,
        mutation: ChannelMemoryAtomicMutation
    ): Observable<ChannelMemoryAtomicMutationResult> {
        let memory: IChannelMemory | undefined;
        this.getChannelMemory(channelId).subscribe(value => {
            memory = value;
        });
        if (!memory) {
            throw new Error(`Channel memory ${channelId} was not loaded`);
        }

        let value: unknown;
        if (mutation.kind === 'append_messages') {
            value = [...(memory.conversationHistory ?? []), ...mutation.messages];
            memory = { ...memory, conversationHistory: value as unknown[] };
        } else if (mutation.kind === 'replace_context') {
            value = mutation.context;
            memory = { ...memory, sharedState: { ...memory.sharedState, context: value } };
        } else if (mutation.kind === 'append_context_history') {
            value = [
                ...((memory.customData?.contextHistory as unknown[] | undefined) ?? []),
                ...mutation.entries
            ].slice(-mutation.retainLast);
            memory = { ...memory, customData: { ...memory.customData, contextHistory: value } };
        } else if (mutation.kind === 'delete_messages') {
            value = [];
            memory = { ...memory, conversationHistory: [] };
        } else if (mutation.kind === 'delete_context') {
            const sharedState = { ...memory.sharedState };
            delete sharedState.context;
            value = null;
            memory = { ...memory, sharedState };
        } else {
            const customData = { ...memory.customData };
            delete customData.contextHistory;
            value = null;
            memory = { ...memory, customData };
        }

        this.channelMemories.set(channelId, memory);
        return of({ found: true, memory, value });
    }

    public deleteMemory(): Observable<boolean> {
        return of(true);
    }

    public async updateAgentMemoryUtility(
        _memoryId: string,
        _utility: Partial<MemoryUtilitySubdocument>
    ): Promise<void> {}

    public async getAgentMemoryUtilities(
        _memoryIds: string[]
    ): Promise<Map<string, MemoryUtilitySubdocument>> {
        return new Map();
    }

    private relationshipKey(agentId1: string, agentId2: string, channelId?: string): string {
        return `${[agentId1, agentId2].sort().join(':')}:${channelId ?? ''}`;
    }
}

type PrincipalName = 'agent-a1' | 'agent-a-generic' | 'agent-b1' | 'user-a' | 'user-b';

const attachTestPrincipal = (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.header('x-test-principal') as PrincipalName | undefined;
    if (principal === 'agent-a1') {
        Object.assign(req, {
            authType: 'key',
            agent: { agentId: AGENT_A1, channelId: CHANNEL_A, keyId: 'key-a1' }
        });
    } else if (principal === 'agent-a-generic') {
        Object.assign(req, {
            authType: 'key',
            agent: { agentId: AGENT_A1, channelId: CHANNEL_A, keyId: 'generic-key-a1' }
        });
    } else if (principal === 'agent-b1') {
        Object.assign(req, {
            authType: 'key',
            agent: { agentId: AGENT_B1, channelId: CHANNEL_B, keyId: 'key-b1' }
        });
    } else if (principal === 'user-a' || principal === 'user-b') {
        Object.assign(req, {
            authType: 'jwt',
            user: { id: principal, role: 'consumer' }
        });
    }
    next();
};

const buildApp = (): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(attachTestPrincipal);
    app.use(memoryRoutes);
    return app;
};

const emitAndWait = <TData>(
    resultEvent: string,
    operationId: string,
    emit: () => void
): Promise<BaseEventPayload<TData>> => new Promise(resolve => {
    const subscription = EventBus.server.on(
        resultEvent,
        (payload: BaseEventPayload<TData & { operationId: string }>) => {
            if (payload.data.operationId !== operationId) return;
            subscription.unsubscribe();
            resolve(payload as BaseEventPayload<TData>);
        }
    );
    emit();
});

describe('canonical memory REST and EventBus surfaces', () => {
    let persistence: InMemoryPersistence;

    beforeEach(() => {
        jest.clearAllMocks();
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
        persistence = new InMemoryPersistence();
        MemoryService.getInstance({ persistenceService: persistence });

        (Agent.findOne as jest.Mock).mockImplementation(({ keyId }: { keyId: string }) => ({
            select: jest.fn().mockResolvedValue(agentsByKey[keyId] ?? null)
        }));
        (Channel.findOne as jest.Mock).mockImplementation(
            ({ channelId }: { channelId: string }) => Promise.resolve(
                channelsById[channelId as keyof typeof channelsById] ?? null
            )
        );
    });

    afterEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
    });

    it.each([
        {
            label: 'agent',
            scope: MemoryScope.AGENT,
            id: AGENT_A1,
            path: '/agents/memory/key-a1',
            saveCount: (): number => persistence.saveAgentMemory.mock.calls.length
        },
        {
            label: 'channel',
            scope: MemoryScope.CHANNEL,
            id: CHANNEL_A,
            path: `/channels/memory/${CHANNEL_A}`,
            saveCount: (): number => persistence.saveChannelMemory.mock.calls.length
        },
        {
            label: 'relationship',
            scope: MemoryScope.RELATIONSHIP,
            id: [AGENT_A1, AGENT_A2, CHANNEL_A],
            path: `/relationships/memory/${CHANNEL_A}/${AGENT_A1}/${AGENT_A2}`,
            saveCount: (): number => persistence.saveRelationshipMemory.mock.calls.length
        }
    ])(
        'keeps $label memory coherent across EventBus and HTTP and denies a foreign tenant',
        async ({ label, scope, id, path, saveCount }) => {
            const updateOperationId = `event-update-${label}`;
            await emitAndWait<MemoryUpdateResultEventData>(
                Events.Memory.UPDATE_RESULT,
                updateOperationId,
                () => EventBus.server.emit(
                    Events.Memory.UPDATE,
                    createMemoryUpdateEventPayload(
                        Events.Memory.UPDATE,
                        AGENT_A1,
                        CHANNEL_A,
                        {
                            operationId: updateOperationId,
                            scope,
                            id,
                            data: { notes: { fromEventBus: label } }
                        }
                    )
                )
            );

            const authorizedGet = await supertest(buildApp())
                .get(path)
                .set('x-test-principal', 'agent-a1');
            expect(authorizedGet.status).toBe(200);
            expect(authorizedGet.body.data.notes).toEqual({ fromEventBus: label });
            expect(authorizedGet.body.data.data).toBeUndefined();

            const authorizedPatch = await supertest(buildApp())
                .patch(path)
                .set('x-test-principal', 'agent-a1')
                .set('Content-Type', 'application/json')
                .send({ notes: { fromHttp: label } });
            expect(authorizedPatch.status).toBe(200);
            expect(authorizedPatch.body.data.notes).toEqual({
                fromEventBus: label,
                fromHttp: label
            });

            const getOperationId = `event-get-${label}`;
            const eventRead = await emitAndWait<MemoryGetResultEventData>(
                Events.Memory.GET_RESULT,
                getOperationId,
                () => EventBus.server.emit(
                    Events.Memory.GET,
                    createMemoryGetEventPayload(
                        Events.Memory.GET,
                        AGENT_A1,
                        CHANNEL_A,
                        { operationId: getOperationId, scope, id }
                    )
                )
            );
            expect(eventRead.data.memory).toEqual(expect.objectContaining({
                notes: { fromEventBus: label, fromHttp: label }
            }));

            const savesBeforeForeignMutation = saveCount();
            const foreignPatch = await supertest(buildApp())
                .patch(path)
                .set('x-test-principal', 'agent-b1')
                .set('Content-Type', 'application/json')
                .send({ notes: { stolen: true } });
            expect(foreignPatch.status).toBe(403);
            expect(saveCount()).toBe(savesBeforeForeignMutation);

            const foreignOwnerPatch = await supertest(buildApp())
                .patch(path)
                .set('x-test-principal', 'user-b')
                .set('Content-Type', 'application/json')
                .send({ notes: { stolenByOwner: true } });
            expect(foreignOwnerPatch.status).toBe(403);
            expect(saveCount()).toBe(savesBeforeForeignMutation);
        }
    );

    it('rejects non-participant and self-relationship identities before memory access', async () => {
        const nonParticipantPath = `/relationships/memory/${CHANNEL_A}/${AGENT_A1}/${AGENT_B1}`;
        const selfPath = `/relationships/memory/${CHANNEL_A}/${AGENT_A1}/${AGENT_A1}`;

        const nonParticipant = await supertest(buildApp())
            .get(nonParticipantPath)
            .set('x-test-principal', 'user-a');
        const selfRelationship = await supertest(buildApp())
            .get(selfPath)
            .set('x-test-principal', 'user-a');

        expect(nonParticipant.status).toBe(404);
        expect(selfRelationship.status).toBe(400);
        expect(persistence.saveRelationshipMemory).not.toHaveBeenCalled();
    });

    it('rejects identity fields smuggled into an authorized update', async () => {
        const response = await supertest(buildApp())
            .patch('/agents/memory/key-a1')
            .set('x-test-principal', 'agent-a1')
            .set('Content-Type', 'application/json')
            .send({ agentId: AGENT_B1, notes: { stolen: true } });

        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/unsupported memory update field: agentId/i);
        expect(persistence.saveAgentMemory).not.toHaveBeenCalled();
    });

    it('does not treat a same-agent generic channel key as the designated Agent.keyId', async () => {
        const designatedKeyTarget = await supertest(buildApp())
            .get('/agents/memory/key-a1')
            .set('x-test-principal', 'agent-a-generic');
        const genericKeyTarget = await supertest(buildApp())
            .get('/agents/memory/generic-key-a1')
            .set('x-test-principal', 'agent-a-generic');

        expect(designatedKeyTarget.status).toBe(403);
        expect(genericKeyTarget.status).toBe(404);
        expect(persistence.saveAgentMemory).not.toHaveBeenCalled();
    });

    it('rejects non-atomic channel conversation history updates', async () => {
        const response = await supertest(buildApp())
            .patch(`/channels/memory/${CHANNEL_A}`)
            .set('x-test-principal', 'agent-a1')
            .set('Content-Type', 'application/json')
            .send({ conversationHistory: [{ content: 'racy append' }] });

        expect(response.status).toBe(400);
        expect(response.body.message).toMatch(/unsupported memory update field: conversationHistory/i);
        expect(persistence.saveChannelMemory).not.toHaveBeenCalled();
        expect(persistence.saveAgentMemory).not.toHaveBeenCalled();
    });

    it.each([
        {
            update: { sharedState: { context: { phase: 'racy overwrite' } } },
            reservedField: 'sharedState.context'
        },
        {
            update: { customData: { contextHistory: [{ phase: 'racy overwrite' }] } },
            reservedField: 'customData.contextHistory'
        }
    ])(
        'rejects the atomic $reservedField field without persisting any mutation',
        async ({ update, reservedField }) => {
            const response = await supertest(buildApp())
                .patch(`/channels/memory/${CHANNEL_A}`)
                .set('x-test-principal', 'agent-a1')
                .set('Content-Type', 'application/json')
                .send(update);

            expect(response.status).toBe(400);
            expect(response.body.message).toContain(reservedField);
            expect(persistence.saveChannelMemory).not.toHaveBeenCalled();
            expect(persistence.saveAgentMemory).not.toHaveBeenCalled();
            expect(persistence.saveRelationshipMemory).not.toHaveBeenCalled();
        }
    );
});
