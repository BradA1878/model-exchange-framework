import { appendUniqueChannelMessages, normalizeChannelHistoryMessage } from '@mxf-dev/core/utils/ChannelHistoryMessages';
import { createChannelMessage, createMessageMetadata } from '@mxf-dev/core/schemas/MessageSchemas';

describe('canonical channel history messages', () => {
    it('preserves raw object content, original identity/time and DM metadata without aliasing', () => {
        const message = createChannelMessage('channel-a', 'agent-a', { nested: { value: '$literal text' } }, {
            receiverId: 'agent-b',
            metadata: { messageId: 'original', timestamp: 0, originalMessageType: 'agent-to-agent', targetAgentId: 'agent-b' },
            context: { messageType: 'direct' }
        });
        const result = normalizeChannelHistoryMessage(message, 'channel-a');
        expect(result).toEqual({
            messageId: 'original', timestamp: 0, senderId: 'agent-a', receiverId: 'agent-b', type: 'text',
            content: { nested: { value: '$literal text' } },
            metadata: { messageId: 'original', timestamp: 0, originalMessageType: 'agent-to-agent', targetAgentId: 'agent-b', messageType: 'direct' }
        });
        message.content.data.nested.value = 'changed';
        message.metadata.targetAgentId = 'agent-c';
        expect(result.content).toEqual({ nested: { value: '$literal text' } });
        expect(result.metadata?.targetAgentId).toBe('agent-b');
    });

    it('keeps the first ID immutable across existing history and incoming batches', () => {
        const first = { messageId: 'one', content: { private: true }, metadata: { targetAgentId: 'agent-b' } };
        const second = { messageId: 'two', content: '' };
        const result = appendUniqueChannelMessages([first, first], [
            { ...first, content: 'conflicting replacement' }, second, { ...second, content: 'later' }
        ]);
        expect(result).toEqual([first, second]);
        first.metadata.targetAgentId = 'agent-c';
        second.content = 'changed';
        expect(result).toEqual([
            { messageId: 'one', content: { private: true }, metadata: { targetAgentId: 'agent-b' } },
            { messageId: 'two', content: '' }
        ]);
    });

    it.each([undefined, null, '', ' ', 17])('rejects invalid history identity %p even in existing records', messageId => {
        expect(() => appendUniqueChannelMessages([{ messageId }], [])).toThrow('messageId');
        expect(() => appendUniqueChannelMessages([], [{ messageId }])).toThrow('messageId');
    });

    it.each([null, [], 42, undefined])('rejects unsupported raw content %p', content => {
        const message = createChannelMessage('channel-a', 'agent-a', 'valid');
        message.content.data = content;
        expect(() => normalizeChannelHistoryMessage(message, 'channel-a')).toThrow('content');
    });

    it('accepts empty text, preserves recognized message types, and rejects channel retargeting', () => {
        const message = createChannelMessage('channel-a', 'agent-a', '', { context: { messageType: 'command' } });
        expect(normalizeChannelHistoryMessage(message, 'channel-a')).toMatchObject({ content: '', type: 'command' });
        expect(() => normalizeChannelHistoryMessage(message, 'channel-b')).toThrow('channel');
    });

    it('retains custom metadata and a zero timestamp in the actual schema builder', () => {
        expect(createMessageMetadata({ messageId: 'id', timestamp: 0, custom: { retained: true } }))
            .toEqual({ messageId: 'id', timestamp: 0, custom: { retained: true } });
    });

    it.each([-1, NaN, Infinity, null, '1'])('fails fast on explicit invalid timestamps %p', timestamp => {
        expect(() => createMessageMetadata({ timestamp } as never)).toThrow('timestamp');
    });

    it.each(['', ' ', null, 1])('fails fast on explicit invalid message IDs %p', messageId => {
        expect(() => createMessageMetadata({ messageId } as never)).toThrow('messageId');
    });
});
