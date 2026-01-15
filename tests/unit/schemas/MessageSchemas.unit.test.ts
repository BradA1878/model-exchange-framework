/**
 * Unit tests for MessageSchemas
 * Tests message creation, format detection, and content wrapping
 */

import {
    createMessageMetadata,
    createChannelMessage,
    createAgentMessage,
    standardizeMessage,
    determineContentFormat,
    createContentWrapper,
    wrapBinaryContent,
    ContentFormat,
    MessageMetadata,
    ChannelMessage,
    AgentMessage
} from '@mxf/shared/schemas/MessageSchemas';

describe('MessageSchemas', () => {
    describe('createMessageMetadata', () => {
        it('generates a message ID', () => {
            const meta = createMessageMetadata();
            expect(meta.messageId).toBeDefined();
            expect(typeof meta.messageId).toBe('string');
            expect(meta.messageId.length).toBeGreaterThan(0);
        });

        it('generates numeric timestamp', () => {
            const before = Date.now();
            const meta = createMessageMetadata();
            const after = Date.now();

            expect(typeof meta.timestamp).toBe('number');
            expect(meta.timestamp).toBeGreaterThanOrEqual(before);
            expect(meta.timestamp).toBeLessThanOrEqual(after);
        });

        it('generates unique IDs across calls', () => {
            const ids = Array.from({ length: 100 }, () => createMessageMetadata().messageId);
            expect(new Set(ids).size).toBe(100);
        });

        it('allows messageId override', () => {
            const customId = 'custom-message-id-123';
            const meta = createMessageMetadata({ messageId: customId });
            expect(meta.messageId).toBe(customId);
        });

        it('allows timestamp override', () => {
            const customTimestamp = 1234567890;
            const meta = createMessageMetadata({ timestamp: customTimestamp });
            expect(meta.timestamp).toBe(customTimestamp);
        });

        it('allows correlationId override', () => {
            const correlationId = 'correlation-123';
            const meta = createMessageMetadata({ correlationId });
            expect(meta.correlationId).toBe(correlationId);
        });

        it('allows priority override', () => {
            const meta = createMessageMetadata({ priority: 10 });
            expect(meta.priority).toBe(10);
        });

        it('allows ttl override', () => {
            const meta = createMessageMetadata({ ttl: 5000 });
            expect(meta.ttl).toBe(5000);
        });
    });

    describe('determineContentFormat', () => {
        it('detects Buffer as BINARY', () => {
            const buffer = Buffer.from('hello');
            expect(determineContentFormat(buffer)).toBe(ContentFormat.BINARY);
        });

        it('detects plain strings as TEXT', () => {
            expect(determineContentFormat('hello world')).toBe(ContentFormat.TEXT);
            expect(determineContentFormat('simple text')).toBe(ContentFormat.TEXT);
        });

        it('detects JSON strings as JSON', () => {
            expect(determineContentFormat('{"key": "value"}')).toBe(ContentFormat.JSON);
            expect(determineContentFormat('[1, 2, 3]')).toBe(ContentFormat.JSON);
        });

        it('detects objects as JSON', () => {
            expect(determineContentFormat({ key: 'value' })).toBe(ContentFormat.JSON);
            expect(determineContentFormat({ nested: { deep: true } })).toBe(ContentFormat.JSON);
        });

        it('detects arrays as JSON', () => {
            expect(determineContentFormat([1, 2, 3])).toBe(ContentFormat.JSON);
            expect(determineContentFormat([])).toBe(ContentFormat.JSON);
        });

        it('handles null as JSON', () => {
            // null is typeof 'object' and treated as JSON
            const result = determineContentFormat(null);
            expect(result).toBe(ContentFormat.JSON);
        });

        it('handles numbers as TEXT', () => {
            expect(determineContentFormat(42)).toBe(ContentFormat.TEXT);
            expect(determineContentFormat(3.14)).toBe(ContentFormat.TEXT);
        });

        it('handles booleans as TEXT', () => {
            expect(determineContentFormat(true)).toBe(ContentFormat.TEXT);
            expect(determineContentFormat(false)).toBe(ContentFormat.TEXT);
        });

        it('handles invalid JSON strings as TEXT', () => {
            expect(determineContentFormat('{invalid json}')).toBe(ContentFormat.TEXT);
            expect(determineContentFormat('not json at all')).toBe(ContentFormat.TEXT);
        });
    });

    describe('createChannelMessage', () => {
        it('requires channelId', () => {
            expect(() => createChannelMessage('', 'agent-1', 'test')).toThrow();
            expect(() => createChannelMessage('   ', 'agent-1', 'test')).toThrow();
        });

        it('requires senderId', () => {
            expect(() => createChannelMessage('channel-1', '', 'test')).toThrow();
            expect(() => createChannelMessage('channel-1', '   ', 'test')).toThrow();
        });

        it('requires content', () => {
            expect(() => createChannelMessage('channel-1', 'agent-1', null)).toThrow();
            expect(() => createChannelMessage('channel-1', 'agent-1', undefined)).toThrow();
        });

        it('creates valid message with minimal input', () => {
            const msg = createChannelMessage('channel-1', 'agent-1', 'hello');

            expect(msg.toolType).toBe('channelMessage');
            expect(msg.senderId).toBe('agent-1');
            expect(msg.context.channelId).toBe('channel-1');
            expect(msg.content.data).toBe('hello');
            expect(msg.metadata.messageId).toBeDefined();
            expect(msg.metadata.timestamp).toBeDefined();
        });

        it('auto-detects TEXT format for strings', () => {
            const msg = createChannelMessage('ch', 'ag', 'plain text');
            expect(msg.content.format).toBe(ContentFormat.TEXT);
        });

        it('auto-detects JSON format for objects', () => {
            const msg = createChannelMessage('ch', 'ag', { foo: 'bar' });
            expect(msg.content.format).toBe(ContentFormat.JSON);
        });

        it('allows explicit format override', () => {
            const msg = createChannelMessage('ch', 'ag', '{"json": true}', {
                format: ContentFormat.TEXT
            });
            expect(msg.content.format).toBe(ContentFormat.TEXT);
        });

        it('includes optional receiverId', () => {
            const msg = createChannelMessage('ch', 'sender', 'msg', {
                receiverId: 'receiver'
            });
            expect(msg.receiverId).toBe('receiver');
        });

        it('sets security when encrypted option is true', () => {
            const msg = createChannelMessage('ch', 'ag', 'secret', {
                encrypted: true
            });
            expect(msg.security).toBeDefined();
            expect(msg.security?.encrypted).toBe(true);
        });

        it('allows custom metadata', () => {
            const msg = createChannelMessage('ch', 'ag', 'msg', {
                metadata: { priority: 5, ttl: 10000 }
            });
            expect(msg.metadata.priority).toBe(5);
            expect(msg.metadata.ttl).toBe(10000);
        });

        it('allows additional context', () => {
            const msg = createChannelMessage('ch', 'ag', 'msg', {
                context: { customField: 'value' }
            });
            expect(msg.context.channelId).toBe('ch');
            expect(msg.context.customField).toBe('value');
        });

        it('rejects invalid format option', () => {
            expect(() => createChannelMessage('ch', 'ag', 'msg', {
                format: 'invalid' as any
            })).toThrow();
        });
    });

    describe('createAgentMessage', () => {
        it('requires senderId', () => {
            expect(() => createAgentMessage('', 'receiver', 'test')).toThrow();
            expect(() => createAgentMessage('   ', 'receiver', 'test')).toThrow();
        });

        it('requires receiverId', () => {
            expect(() => createAgentMessage('sender', '', 'test')).toThrow();
            expect(() => createAgentMessage('sender', '   ', 'test')).toThrow();
        });

        it('requires content', () => {
            expect(() => createAgentMessage('sender', 'receiver', null)).toThrow();
            expect(() => createAgentMessage('sender', 'receiver', undefined)).toThrow();
        });

        it('creates valid message with minimal input', () => {
            const msg = createAgentMessage('sender', 'receiver', 'hello');

            expect(msg.toolType).toBe('agentMessage');
            expect(msg.senderId).toBe('sender');
            expect(msg.receiverId).toBe('receiver');
            expect(msg.content.data).toBe('hello');
            expect(msg.metadata.messageId).toBeDefined();
        });

        it('auto-detects content format', () => {
            const textMsg = createAgentMessage('s', 'r', 'plain text');
            expect(textMsg.content.format).toBe(ContentFormat.TEXT);

            const jsonMsg = createAgentMessage('s', 'r', { data: 'value' });
            expect(jsonMsg.content.format).toBe(ContentFormat.JSON);
        });

        it('allows explicit format override', () => {
            const msg = createAgentMessage('s', 'r', '{"json": true}', {
                format: ContentFormat.TEXT
            });
            expect(msg.content.format).toBe(ContentFormat.TEXT);
        });
    });

    describe('standardizeMessage', () => {
        it('requires senderId', () => {
            expect(() => standardizeMessage('content', '')).toThrow();
            expect(() => standardizeMessage('content', '   ')).toThrow();
        });

        it('requires message content', () => {
            expect(() => standardizeMessage(null, 'sender')).toThrow();
            expect(() => standardizeMessage(undefined, 'sender')).toThrow();
        });

        it('creates standardized message from string', () => {
            const msg = standardizeMessage('hello', 'sender');

            expect(msg.senderId).toBe('sender');
            expect(msg.content.data).toBe('hello');
            expect(msg.content.format).toBe(ContentFormat.TEXT);
            expect(msg.metadata.messageId).toBeDefined();
        });

        it('creates standardized message from object', () => {
            const msg = standardizeMessage({ key: 'value' }, 'sender');

            expect(msg.content.data).toEqual({ key: 'value' });
            expect(msg.content.format).toBe(ContentFormat.JSON);
        });

        it('creates standardized message from Buffer', () => {
            const buffer = Buffer.from('binary data');
            const msg = standardizeMessage(buffer, 'sender');

            expect(msg.content.data).toBe(buffer);
            expect(msg.content.format).toBe(ContentFormat.BINARY);
        });

        it('defaults to agentMessage toolType when no channelId', () => {
            const msg = standardizeMessage('hello', 'sender');
            expect(msg.toolType).toBe('agentMessage');
        });

        it('uses channelMessage toolType when channelId provided', () => {
            const msg = standardizeMessage('hello', 'sender', { channelId: 'ch-1' });
            expect(msg.toolType).toBe('channelMessage');
            expect(msg.context?.channelId).toBe('ch-1');
        });

        it('allows custom toolType override', () => {
            const msg = standardizeMessage('hello', 'sender', { toolType: 'custom' });
            expect(msg.toolType).toBe('custom');
        });

        it('allows explicit format override', () => {
            const msg = standardizeMessage('{"json": true}', 'sender', {
                format: ContentFormat.TEXT
            });
            expect(msg.content.format).toBe(ContentFormat.TEXT);
        });

        it('throws when channelMessage without channelId', () => {
            expect(() => standardizeMessage('hello', 'sender', {
                toolType: 'channelMessage'
            })).toThrow();
        });
    });

    describe('createContentWrapper', () => {
        it('wraps string content with TEXT format', () => {
            const wrapper = createContentWrapper('hello');
            expect(wrapper.format).toBe(ContentFormat.TEXT);
            expect(wrapper.data).toBe('hello');
        });

        it('wraps object content with JSON format', () => {
            const data = { key: 'value' };
            const wrapper = createContentWrapper(data);
            expect(wrapper.format).toBe(ContentFormat.JSON);
            expect(wrapper.data).toBe(data);
        });

        it('wraps Buffer content with BINARY format', () => {
            const buffer = Buffer.from('data');
            const wrapper = createContentWrapper(buffer);
            expect(wrapper.format).toBe(ContentFormat.BINARY);
            expect(wrapper.data).toBe(buffer);
        });
    });

    describe('wrapBinaryContent', () => {
        it('wraps Buffer with BINARY format by default', () => {
            const buffer = Buffer.from('hello');
            const wrapper = wrapBinaryContent(buffer);

            expect(wrapper.format).toBe(ContentFormat.BINARY);
            expect(wrapper.data).toBe(buffer);
        });

        it('wraps string with BASE64 format by default', () => {
            const base64 = Buffer.from('hello').toString('base64');
            const wrapper = wrapBinaryContent(base64);

            expect(wrapper.format).toBe(ContentFormat.BASE64);
            expect(wrapper.data).toBe(base64);
        });

        it('converts Buffer to base64 when BASE64 format specified', () => {
            const buffer = Buffer.from('hello');
            const wrapper = wrapBinaryContent(buffer, ContentFormat.BASE64);

            expect(wrapper.format).toBe(ContentFormat.BASE64);
            expect(wrapper.data).toBe(buffer.toString('base64'));
        });

        it('keeps Buffer as-is when BINARY format specified', () => {
            const buffer = Buffer.from('hello');
            const wrapper = wrapBinaryContent(buffer, ContentFormat.BINARY);

            expect(wrapper.format).toBe(ContentFormat.BINARY);
            expect(wrapper.data).toBe(buffer);
        });

        it('preserves round-trip integrity for base64', () => {
            const original = Buffer.from('binary data with special chars: \x00\xff');
            const wrapper = wrapBinaryContent(original, ContentFormat.BASE64);
            const restored = Buffer.from(wrapper.data as string, 'base64');

            expect(restored.equals(original)).toBe(true);
        });

        it('sets compression to false', () => {
            const buffer = Buffer.from('test');
            const wrapper = wrapBinaryContent(buffer);
            expect(wrapper.compression).toBe(false);
        });
    });
});
