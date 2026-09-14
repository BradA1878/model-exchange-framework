import { classifyChannelMemoryId } from '@mxf-dev/core/utils/ChannelMemoryResourceIds';
import {
    projectChannelContext, projectChannelMemory,
    projectChannelMessages, readChannelHistoryDmVisibility
} from '@mxf-dev/core/utils/ChannelHistoryVisibility';
import { MemoryPersistenceLevel } from '@mxf-dev/core/types/MemoryTypes';
import { Types } from 'mongoose';

const messages = [
    { messageId: 'private', senderId: 'a', content: { secret: 'for b' }, metadata: { originalMessageType: 'agent-to-agent', targetAgentId: 'b' } },
    { messageId: 'public', senderId: 'b', content: 'Hello', metadata: { public: true } },
    { messageId: 'missing-party', senderId: 'a', content: 'private without recipient', metadata: { originalMessageType: 'agent-to-agent' } }
];

describe('channel history visibility projections', () => {
    const previousVisibility = process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
    afterEach(() => {
        if (previousVisibility === undefined) delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
        else process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY = previousVisibility;
    });

    it('keeps the current default and rejects invalid operator settings', () => {
        delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
        expect(readChannelHistoryDmVisibility()).toBe('all');
        for (const value of ['', 'private', 'ALL', ' parties ']) {
            process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY = value;
            expect(readChannelHistoryDmVisibility).toThrow(/must be all or parties/);
        }
    });

    it('returns DMs only to their recorded parties and broadcasts to everyone', () => {
        expect(projectChannelMessages(messages, 'a', 'parties').map(m => m.messageId)).toEqual(['private', 'public', 'missing-party']);
        expect(projectChannelMessages(messages, 'b', 'parties').map(m => m.messageId)).toEqual(['private', 'public']);
        expect(projectChannelMessages(messages, 'c', 'parties').map(m => m.messageId)).toEqual(['public']);
        expect(projectChannelMessages(messages, 'c', 'all')).toEqual(messages);
    });

    it('copies nested content and metadata before callers remove or edit fields', () => {
        const projected = projectChannelMessages(messages, 'a', 'parties');
        (projected[0].content as { secret: string }).secret = 'changed';
        delete projected[0].metadata.targetAgentId;
        expect(messages[0].content).toEqual({ secret: 'for b' });
        expect(messages[0].metadata.targetAgentId).toBe('b');
    });

    it('omits stored aggregates and activity counts while retaining explicit shared state', () => {
        const context = {
            id: 'channel', channelId: 'channel', name: 'Test', participants: ['a', 'b', 'c'],
            conversationSummary: 'for b', topics: [{ topic: 'for b' }], metadata: { summary: 'for b' },
            messageCount: 3, lastActivity: 123, updatedAt: 123
        };
        const memory = {
            _id: new Types.ObjectId('000000000000000000000001'),
            id: 'memory', channelId: 'channel', createdAt: new Date(1), updatedAt: new Date(2),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT, conversationHistory: messages,
            notes: { shared: 'deliberately public' }, sharedState: { context, shared: 'also public' },
            customData: { contextHistory: [{ data: { summary: 'for b' } }], shared: 1 },
            sharedCognitiveInsights: { systemSummaries: ['for b'] },
            // Older enhanced ChannelMemory documents also stored these at the top level.
            summary: 'for b', topics: [{ topic: 'for b' }], messageCount: 3, lastActivity: new Date(123)
        };
        const original = JSON.stringify(memory);
        const projected = projectChannelMemory(memory, 'c', 'parties');
        expect(projected.conversationHistory).toEqual([messages[1]]);
        expect(projected.sharedState?.context).toEqual({ id: 'channel', channelId: 'channel', name: 'Test', participants: ['a', 'b', 'c'] });
        expect(projected.notes).toEqual(memory.notes);
        expect(projected.customData).toEqual({ shared: 1 });
        expect(projected.updatedAt).toBeUndefined();
        expect(projected).not.toHaveProperty('sharedCognitiveInsights');
        for (const key of ['summary', 'topics', 'messageCount', 'lastActivity']) {
            expect(projected).not.toHaveProperty(key);
        }
        expect(projected.createdAt).toEqual(new Date(1));
        expect(projected.createdAt).toBeInstanceOf(Date);
        expect(projected.createdAt).not.toBe(memory.createdAt);
        expect(Reflect.get(projected, '_id')).toBeInstanceOf(Types.ObjectId);
        expect(JSON.parse(JSON.stringify(projected))._id).toBe(memory._id.toHexString());
        expect(memory.customData.contextHistory).toHaveLength(1);
        expect(projectChannelMemory(memory, 'c', 'all')).toEqual(memory);
        // Editing the projected JSON/Date fields must not alter the cached source.
        projected.createdAt?.setTime(999);
        if (projected.notes) projected.notes.shared = 'changed';
        expect(JSON.stringify(memory)).toBe(original);
        expect(memory._id).toBeInstanceOf(Types.ObjectId);
        expect(memory.lastActivity).toEqual(new Date(123));
        expect(projectChannelContext({ conversationSummary: 'secret' }, 'parties')).toEqual({});
        expect(projectChannelMemory({ ...memory, sharedState: { context: 'secret' } }, 'c', 'parties').sharedState).toEqual({});
    });

    it('resolves exact IDs even when legal channel names contain reserved-looking prefixes', () => {
        for (const channelId of ['normal', 'history:a', 'channel:messages:a', 'a:b']) {
            expect(classifyChannelMemoryId(channelId, channelId)).toBe('whole');
            expect(classifyChannelMemoryId(`channel:messages:${channelId}`, channelId)).toBe('messages');
            expect(classifyChannelMemoryId(`channel:context:${channelId}`, channelId)).toBe('context');
            expect(classifyChannelMemoryId(`channel:context:history:${channelId}`, channelId)).toBe('history');
        }
        expect(() => classifyChannelMemoryId('channel:messages:other', 'a')).toThrow(/match the request channel/);
    });
});
