import type mongoose from 'mongoose';
import { migrateChannelHistory } from '../../../src/migrations/2026.09.channel-history';
import { createChannelMessageAppendUpdate } from '../../../src/server/api/services/MemoryPersistenceService';

const message = {
    messageId: 'original', senderId: 'agent-a', receiverId: 'agent-b', timestamp: 0, type: 'text',
    content: { text: '$literal-content' }, metadata: { originalMessageType: 'agent-to-agent', targetAgentId: 'agent-b' }
};

const database = (legacy: unknown[] = [message]): {
    db: mongoose.mongo.Db;
    source: { channelId: string; sharedMemory: { conversationHistory: unknown[] } }[];
    findOne: jest.Mock;
    updateOne: jest.Mock;
    legacyUpdate: jest.Mock;
    createIndex: jest.Mock;
} => {
    const source = [{ channelId: 'channel-a', sharedMemory: { conversationHistory: legacy } }];
    const findOne = jest.fn().mockResolvedValue(null);
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });
    const legacyUpdate = jest.fn();
    const createIndex = jest.fn().mockResolvedValue('channelId_1');
    const collections = {
        channels: { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(source) })), updateOne: legacyUpdate },
        channelmemories: { findOne, updateOne, createIndex }
    };
    const db = { collection: (name: keyof typeof collections): unknown => collections[name] } as unknown as mongoose.mongo.Db;
    return { db, source, findOne, updateOne, legacyUpdate, createIndex };
};

describe('explicit canonical channel history migration', () => {
    it('copies original DM objects/IDs/times and retains the legacy source on repeat runs', async () => {
        const store = database([message, { ...message, content: { ...message.content }, metadata: { ...message.metadata } }]);
        const sourceBefore = structuredClone(store.source);
        await expect(migrateChannelHistory(store.db)).resolves.toEqual({ channelsScanned: 1, messagesCopied: 1 });
        expect(store.createIndex).toHaveBeenCalledWith({ channelId: 1 }, { unique: true });
        expect(store.updateOne).toHaveBeenCalledWith(
            { channelId: 'channel-a', conversationHistory: { $exists: false } }, expect.any(Array), { upsert: true }
        );
        const update = store.updateOne.mock.calls[0][1];
        expect(update[0].$set.conversationHistory.$let.in.$concatArrays[1].$filter.input).toEqual({ $literal: [message] });
        store.findOne.mockResolvedValue({ channelId: 'channel-a', conversationHistory: [message] });
        await expect(migrateChannelHistory(store.db)).resolves.toEqual({ channelsScanned: 1, messagesCopied: 0 });
        expect(store.updateOne.mock.calls[1][0]).toEqual({ channelId: 'channel-a', conversationHistory: [message] });
        expect(store.source).toEqual(sourceBefore);
        expect(store.legacyUpdate).not.toHaveBeenCalled();
    });

    it('rejects divergent legacy records before writing any channel history', async () => {
        const store = database();
        store.source.push({
            channelId: 'channel-b', sharedMemory: { conversationHistory: [message, { ...message, content: 'conflicting' }] }
        });
        await expect(migrateChannelHistory(store.db)).rejects.toThrow('Conflicting messageId "original" in channel "channel-b"');
        expect(store.updateOne).not.toHaveBeenCalled();
        expect(store.createIndex).not.toHaveBeenCalled();
        expect(store.legacyUpdate).not.toHaveBeenCalled();
    });

    it('rejects an ID whose canonical content or parties differ from legacy content', async () => {
        const store = database();
        store.findOne.mockResolvedValue({ conversationHistory: [{ ...message, receiverId: 'agent-c' }] });
        await expect(migrateChannelHistory(store.db)).rejects.toThrow('Conflicting messageId');
        expect(store.updateOne).not.toHaveBeenCalled();
    });

    it.each([{ ...message, messageId: '' }, { ...message, timestamp: -1 }, { ...message, content: [] }])('rejects malformed legacy records %p', async invalid => {
        const store = database([invalid]);
        await expect(migrateChannelHistory(store.db)).rejects.toThrow();
        expect(store.updateOne).not.toHaveBeenCalled();
    });

    it('surfaces write failure and leaves the source intact for a later explicit retry', async () => {
        const store = database();
        const failure = new Error('write failed');
        store.updateOne.mockRejectedValue(failure);
        await expect(migrateChannelHistory(store.db)).rejects.toBe(failure);
        expect(store.source[0].sharedMemory.conversationHistory).toEqual([message]);
        expect(store.legacyUpdate).not.toHaveBeenCalled();
    });

    it('fails a history change after preflight instead of overwriting it', async () => {
        const store = database();
        store.updateOne.mockRejectedValue(Object.assign(new Error('duplicate channel identity'), { code: 11000 }));
        await expect(migrateChannelHistory(store.db)).rejects.toThrow('history changed after migration preflight');
        expect(store.updateOne).toHaveBeenCalledTimes(1);
    });

    it('builds literal, first-wins append input with explicit fresh-document defaults', () => {
        const now = new Date(100);
        const update = createChannelMessageAppendUpdate('$channel', [message, { ...message, content: 'later' }], now);
        const set = update[0].$set as Record<string, unknown>;
        expect(set).toMatchObject({
            channelId: { $literal: '$channel' }, createdAt: { $ifNull: ['$createdAt', { $literal: now }] },
            notes: { $ifNull: ['$notes', {}] }, sharedState: { $ifNull: ['$sharedState', {}] },
            customData: { $ifNull: ['$customData', {}] }
        });
        const history = set.conversationHistory as { $let: { in: { $concatArrays: unknown[] } } };
        expect(history.$let.in.$concatArrays[1]).toMatchObject({ $filter: { input: { $literal: [message] } } });
        expect(() => createChannelMessageAppendUpdate('channel', [{ messageId: '' }])).toThrow('messageId');
    });
});
