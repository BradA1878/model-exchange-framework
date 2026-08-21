import { firstValueFrom } from 'rxjs';

import { ChannelMemoryAtomicMutation } from '@mxf-dev/core/interfaces/IMemoryPersistence';
import { AgentMemory, ChannelMemory, RelationshipMemory } from '@mxf-dev/core/models/memory';
import {
    MemoryEntryModel,
    MemoryPatternModel,
    SurpriseHistoryModel
} from '@mxf-dev/core/models/memoryStrata';
import {
    IAgentMemory,
    IChannelMemory,
    MemoryPersistenceLevel,
    MemoryScope
} from '@mxf-dev/core/types/MemoryTypes';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { MemoryPersistenceService } from '../../../src/server/api/services/MemoryPersistenceService';

const CHANNEL_ID = 'atomic-channel';

const channelMemory = (overrides: Partial<IChannelMemory> = {}): IChannelMemory => ({
    id: 'channel-memory-id',
    channelId: CHANNEL_ID,
    createdAt: new Date(1),
    updatedAt: new Date(2),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: {},
    sharedState: {},
    conversationHistory: [],
    customData: {},
    ...overrides
});

const agentMemory = (
    conversationHistory: unknown[]
): IAgentMemory => ({
    id: 'agent-memory-id',
    agentId: 'atomic-agent',
    createdAt: new Date(1),
    updatedAt: new Date(2),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: {},
    conversationHistory,
    customData: {}
});

const documentFor = <TMemory>(memory: TMemory): { toObject(): TMemory } => ({
    toObject: () => memory
});

const channelIdentityConflict = (): Error & {
    code: number;
    keyPattern: { channelId: number };
    keyValue: { channelId: string };
} => Object.assign(new Error('duplicate channel identity'), {
    code: 11000,
    keyPattern: { channelId: 1 },
    keyValue: { channelId: CHANNEL_ID }
});

describe('MemoryPersistenceService atomic channel mutations', () => {
    let service: MemoryPersistenceService;

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        service = MemoryPersistenceService.getInstance();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('enforces one authoritative document for every memory identity', () => {
        const agentIndexes = AgentMemory.schema.indexes().filter(([fields]) =>
            Object.keys(fields).length === 1 && fields.agentId === 1
        );
        const channelIndexes = ChannelMemory.schema.indexes().filter(([fields]) =>
            Object.keys(fields).length === 1 && fields.channelId === 1
        );
        const relationshipIndexes = RelationshipMemory.schema.indexes().filter(([fields]) =>
            Object.keys(fields).length === 3 &&
            fields.agentId1 === 1 &&
            fields.agentId2 === 1 &&
            fields.channelId === 1
        );

        expect(agentIndexes).toHaveLength(1);
        expect(channelIndexes).toHaveLength(1);
        expect(relationshipIndexes).toHaveLength(1);
        expect(agentIndexes[0][1]).toEqual(expect.objectContaining({ unique: true }));
        expect(channelIndexes[0][1]).toEqual(expect.objectContaining({ unique: true }));
        expect(relationshipIndexes[0][1]).toEqual(expect.objectContaining({ unique: true }));
    });

    it('replaces full agent-history snapshots without duplicating the stored prefix', async () => {
        const first = { role: 'user', content: 'first' };
        const second = { role: 'assistant', content: 'second' };
        const save = jest.spyOn(AgentMemory, 'findOneAndUpdate')
            .mockReturnValueOnce({
                exec: jest.fn().mockResolvedValue(documentFor(agentMemory([first])))
            } as never)
            .mockReturnValueOnce({
                exec: jest.fn().mockResolvedValue(documentFor(agentMemory([first, second])))
            } as never);

        await firstValueFrom(service.saveAgentMemory(agentMemory([first])));
        const result = await firstValueFrom(
            service.saveAgentMemory(agentMemory([first, second]))
        );

        const firstUpdate = save.mock.calls[0][1] as {
            $set: { conversationHistory: unknown[] };
            $push?: unknown;
        };
        const secondUpdate = save.mock.calls[1][1] as {
            $set: { conversationHistory: unknown[] };
            $push?: unknown;
        };
        expect(firstUpdate.$set.conversationHistory).toEqual([first]);
        expect(secondUpdate.$set.conversationHistory).toEqual([first, second]);
        expect(firstUpdate.$push).toBeUndefined();
        expect(secondUpdate.$push).toBeUndefined();
        expect(result.conversationHistory).toEqual([first, second]);
    });

    it('durably clears agent history and propagates save failures', async () => {
        const save = jest.spyOn(AgentMemory, 'findOneAndUpdate')
            .mockReturnValueOnce({
                exec: jest.fn().mockResolvedValue(documentFor(agentMemory([])))
            } as never);

        const cleared = await firstValueFrom(service.saveAgentMemory(agentMemory([])));
        const clearUpdate = save.mock.calls[0][1] as {
            $set: { conversationHistory: unknown[] };
        };
        expect(clearUpdate.$set.conversationHistory).toEqual([]);
        expect(cleared.conversationHistory).toEqual([]);

        const outage = new Error('agent memory write failed');
        save.mockReturnValueOnce({
            exec: jest.fn().mockRejectedValue(outage)
        } as never);
        await expect(firstValueFrom(service.saveAgentMemory(agentMemory([]))))
            .rejects.toBe(outage);
    });

    it('appends each message batch with one atomic database update', async () => {
        const first = { messageId: 'first', timestamp: 1 };
        const second = { messageId: 'second', timestamp: 2 };
        const stored = channelMemory({ conversationHistory: [first, second] });
        const exec = jest.fn().mockResolvedValue(documentFor(stored));
        const update = jest.spyOn(ChannelMemory, 'findOneAndUpdate')
            .mockReturnValue({ exec } as never);
        const mutation: ChannelMemoryAtomicMutation = {
            kind: 'append_messages',
            messages: [second]
        };

        const result = await firstValueFrom(
            service.mutateChannelMemory(CHANNEL_ID, mutation)
        );

        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith(
            { channelId: CHANNEL_ID },
            expect.objectContaining({
                $push: { conversationHistory: { $each: [second] } }
            }),
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        expect(result).toEqual({ found: true, memory: stored, value: [first, second] });
    });

    it('appends and bounds context history in the same atomic update', async () => {
        const entry = { timestamp: 2, type: 'update' };
        const stored = channelMemory({ customData: { contextHistory: [entry] } });
        const update = jest.spyOn(ChannelMemory, 'findOneAndUpdate')
            .mockReturnValue({
                exec: jest.fn().mockResolvedValue(documentFor(stored))
            } as never);

        const result = await firstValueFrom(service.mutateChannelMemory(CHANNEL_ID, {
            kind: 'append_context_history',
            entries: [entry],
            retainLast: 100
        }));

        expect(update).toHaveBeenCalledWith(
            { channelId: CHANNEL_ID },
            expect.objectContaining({
                $push: {
                    'customData.contextHistory': {
                        $each: [entry],
                        $slice: -100
                    }
                }
            }),
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        expect(result.value).toEqual([entry]);
    });

    it('uses the persisted context revision as a compare-and-set predicate', async () => {
        const update = jest.spyOn(ChannelMemory, 'findOneAndUpdate').mockReturnValue({
            exec: jest.fn().mockResolvedValue(null)
        } as never);

        const result = await firstValueFrom(service.mutateChannelMemory(CHANNEL_ID, {
            kind: 'replace_context',
            context: { channelId: CHANNEL_ID, updatedAt: 8 },
            expectedUpdatedAt: 7
        }));

        expect(update).toHaveBeenCalledWith(
            {
                channelId: CHANNEL_ID,
                'sharedState.context.updatedAt': 7
            },
            expect.objectContaining({
                $set: expect.objectContaining({
                    'sharedState.context': { channelId: CHANNEL_ID, updatedAt: 8 }
                })
            }),
            { upsert: false, new: true, setDefaultsOnInsert: false }
        );
        expect(result).toEqual({ found: false, memory: null, value: null });
    });

    it('normalizes create-only CAS against an existing context into an honest conflict', async () => {
        const winningContext = { channelId: CHANNEL_ID, updatedAt: 7, name: 'winner' };
        const stored = channelMemory({ sharedState: { context: winningContext } });
        jest.spyOn(ChannelMemory, 'findOneAndUpdate').mockReturnValue({
            exec: jest.fn().mockRejectedValue(channelIdentityConflict())
        } as never);
        const find = jest.spyOn(ChannelMemory, 'findOne').mockReturnValue({
            exec: jest.fn().mockResolvedValue(documentFor(stored))
        } as never);

        const result = await firstValueFrom(service.mutateChannelMemory(CHANNEL_ID, {
            kind: 'replace_context',
            context: { channelId: CHANNEL_ID, updatedAt: 8, name: 'stale creator' }
        }));

        expect(find).toHaveBeenCalledWith({ channelId: CHANNEL_ID });
        expect(result).toEqual({
            found: false,
            memory: stored,
            value: winningContext
        });
    });

    it('lets exactly one simultaneous context creator win without leaking E11000', async () => {
        const firstContext = { channelId: CHANNEL_ID, updatedAt: 1, name: 'first' };
        const secondContext = { channelId: CHANNEL_ID, updatedAt: 2, name: 'second' };
        const stored = channelMemory({ sharedState: { context: firstContext } });
        let resolveWinner: ((document: ReturnType<typeof documentFor<IChannelMemory>>) => void) | undefined;
        let rejectLoser: ((error: unknown) => void) | undefined;
        const winnerWrite = new Promise<ReturnType<typeof documentFor<IChannelMemory>>>(resolve => {
            resolveWinner = resolve;
        });
        const loserWrite = new Promise<never>((_resolve, reject) => {
            rejectLoser = reject;
        });
        const update = jest.spyOn(ChannelMemory, 'findOneAndUpdate')
            .mockReturnValueOnce({ exec: jest.fn(() => winnerWrite) } as never)
            .mockReturnValueOnce({ exec: jest.fn(() => loserWrite) } as never);
        jest.spyOn(ChannelMemory, 'findOne').mockReturnValue({
            exec: jest.fn().mockResolvedValue(documentFor(stored))
        } as never);

        const winner = firstValueFrom(service.mutateChannelMemory(CHANNEL_ID, {
            kind: 'replace_context',
            context: firstContext
        }));
        const loser = firstValueFrom(service.mutateChannelMemory(CHANNEL_ID, {
            kind: 'replace_context',
            context: secondContext
        }));
        const resultsPromise = Promise.allSettled([winner, loser]);

        expect(update).toHaveBeenCalledTimes(2);
        resolveWinner?.(documentFor(stored));
        rejectLoser?.(channelIdentityConflict());
        const results = await resultsPromise;

        expect(results).toEqual([
            { status: 'fulfilled', value: { found: true, memory: stored, value: firstContext } },
            { status: 'fulfilled', value: { found: false, memory: stored, value: firstContext } }
        ]);
    });

    it('distinguishes an exact missing delete target from a database outage', async () => {
        const deleteOne = jest.spyOn(ChannelMemory, 'deleteOne');
        deleteOne.mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue({ deletedCount: 0 })
        } as never);

        await expect(firstValueFrom(
            service.deleteMemory(MemoryScope.CHANNEL, CHANNEL_ID)
        )).resolves.toBe(false);

        const outage = new Error('database unavailable');
        deleteOne.mockReturnValueOnce({
            exec: jest.fn().mockRejectedValue(outage)
        } as never);

        await expect(firstValueFrom(
            service.deleteMemory(MemoryScope.CHANNEL, CHANNEL_ID)
        )).rejects.toBe(outage);
    });

    it('keeps agent not-found distinct from a base or strata database outage', async () => {
        const notDeleted = { deletedCount: 0 };
        const baseDelete = jest.spyOn(AgentMemory, 'deleteOne').mockReturnValue({
            exec: jest.fn().mockResolvedValue(notDeleted)
        } as never);
        jest.spyOn(MemoryEntryModel, 'deleteMany').mockReturnValue({
            exec: jest.fn().mockResolvedValue(notDeleted)
        } as never);
        jest.spyOn(SurpriseHistoryModel, 'deleteMany').mockReturnValue({
            exec: jest.fn().mockResolvedValue(notDeleted)
        } as never);
        const patternDelete = jest.spyOn(MemoryPatternModel, 'deleteMany').mockReturnValue({
            exec: jest.fn().mockResolvedValue(notDeleted)
        } as never);
        jest.spyOn(RelationshipMemory, 'deleteMany').mockReturnValue({
            exec: jest.fn().mockResolvedValue(notDeleted)
        } as never);

        await expect(firstValueFrom(
            service.deleteMemory(MemoryScope.AGENT, 'missing-agent')
        )).resolves.toBe(false);

        const baseOutage = new Error('agent collection unavailable');
        baseDelete.mockReturnValueOnce({
            exec: jest.fn().mockRejectedValue(baseOutage)
        } as never);
        await expect(firstValueFrom(
            service.deleteMemory(MemoryScope.AGENT, 'missing-agent')
        )).rejects.toBe(baseOutage);

        baseDelete.mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue(notDeleted)
        } as never);
        const strataOutage = new Error('agent strata unavailable');
        patternDelete.mockReturnValueOnce({
            exec: jest.fn().mockRejectedValue(strataOutage)
        } as never);
        await expect(firstValueFrom(
            service.deleteMemory(MemoryScope.AGENT, 'missing-agent')
        )).rejects.toBe(strataOutage);
    });

    it('keeps relationship not-found distinct from a database outage', async () => {
        const deleteOne = jest.spyOn(RelationshipMemory, 'deleteOne');
        deleteOne.mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue({ deletedCount: 0 })
        } as never);

        await expect(firstValueFrom(service.deleteMemory(
            MemoryScope.RELATIONSHIP,
            ['peer-z', 'peer-a', CHANNEL_ID]
        ))).resolves.toBe(false);
        expect(deleteOne).toHaveBeenLastCalledWith({
            agentId1: 'peer-a',
            agentId2: 'peer-z',
            channelId: CHANNEL_ID
        });

        const outage = new Error('relationship collection unavailable');
        deleteOne.mockReturnValueOnce({
            exec: jest.fn().mockRejectedValue(outage)
        } as never);
        await expect(firstValueFrom(service.deleteMemory(
            MemoryScope.RELATIONSHIP,
            ['peer-z', 'peer-a', CHANNEL_ID]
        ))).rejects.toBe(outage);
    });

    it('propagates atomic update failures without publishing a false result', async () => {
        const outage = new Error('write concern failed');
        jest.spyOn(ChannelMemory, 'findOneAndUpdate').mockReturnValue({
            exec: jest.fn().mockRejectedValue(outage)
        } as never);

        await expect(firstValueFrom(service.mutateChannelMemory(CHANNEL_ID, {
            kind: 'replace_context',
            context: { channelId: CHANNEL_ID }
        }))).rejects.toBe(outage);
    });
});
