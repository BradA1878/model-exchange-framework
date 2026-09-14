import type { ChannelMessage as WireChannelMessage } from '../schemas/MessageSchemas.js';
import type { ChannelMessage } from '../types/ChannelContext.js';

const requireIdentity = (value: unknown, name: string): void => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
};

/** Convert one wire message to canonical history without changing its identity or content. */
export const normalizeChannelHistoryMessage = (wire: WireChannelMessage, channelId: string): ChannelMessage => {
    requireIdentity(channelId, 'Channel ID');
    if (!wire || wire.context?.channelId !== channelId) {
        throw new Error('Message channel must match the history channel');
    }
    requireIdentity(wire.senderId, 'Message sender ID');
    requireIdentity(wire.metadata?.messageId, 'Message ID');
    const timestamp = wire.metadata?.timestamp;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
        throw new Error('Message timestamp must be a finite non-negative number');
    }
    const content: unknown = wire.content?.data;
    if (typeof content !== 'string' && (content === null || typeof content !== 'object' || Array.isArray(content))) {
        throw new Error('Message content must be a string or non-null object, not an array');
    }
    const messageType: unknown = wire.context.messageType;
    const type = messageType === 'command' || messageType === 'response' || messageType === 'system'
        ? messageType : 'text';
    return structuredClone({
        messageId: wire.metadata.messageId,
        senderId: wire.senderId,
        content: content as ChannelMessage['content'],
        timestamp,
        type,
        metadata: {
            ...wire.metadata,
            ...(messageType !== undefined ? { messageType } : {})
        },
        ...(wire.receiverId !== undefined ? { receiverId: wire.receiverId } : {})
    });
};

/**
 * Message IDs are immutable within a channel. Repeated delivery keeps the first
 * record, including its original content and DM parties, and never aliases inputs.
 */
export const appendUniqueChannelMessages = (existing: readonly unknown[], incoming: readonly unknown[]): unknown[] => {
    if (!Array.isArray(existing) || !Array.isArray(incoming)) {
        throw new Error('Channel history and incoming messages must be arrays');
    }
    const result: unknown[] = [];
    const seen = new Set<string>();
    for (const message of [...existing, ...incoming]) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            throw new Error('Channel history records must be objects with a non-empty messageId');
        }
        const messageId: unknown = Reflect.get(message, 'messageId');
        requireIdentity(messageId, 'Channel history messageId');
        if (seen.has(messageId as string)) continue;
        seen.add(messageId as string);
        result.push(structuredClone(message));
    }
    return result;
};
