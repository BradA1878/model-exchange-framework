import { classifyChannelMemoryId } from './ChannelMemoryResourceIds.js';
import type { ChannelContextType, ChannelMessage } from '../types/ChannelContext.js';
import type { IChannelMemory } from '../types/MemoryTypes.js';

export type ChannelHistoryDmVisibility = 'all' | 'parties';

/** Invalid visibility settings must fail before a server accepts agent traffic. */
export const readChannelHistoryDmVisibility = (): ChannelHistoryDmVisibility => {
    const value = process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY ?? 'all';
    if (value !== 'all' && value !== 'parties') {
        throw new Error('MXF_CHANNEL_HISTORY_DM_VISIBILITY must be all or parties');
    }
    return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** Copy JSON data without changing Date or database identifier representations. */
const copyValue = <T>(value: T): T => {
    if (Array.isArray(value)) return value.map(item => copyValue(item)) as T;
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)])) as T;
    }
    return value;
};

/** Canonical channel history records retain the original DM sender and recipient. */
export const isPrivateChannelMessage = (message: { metadata?: unknown }): boolean =>
    isRecord(message.metadata) && message.metadata.originalMessageType === 'agent-to-agent';

/** Global summaries may only use broadcasts when private DMs are enabled. */
export const publicChannelMessages = <T extends { metadata?: unknown }>(
    messages: readonly T[], visibility = readChannelHistoryDmVisibility()
): T[] => messages.filter(message => visibility === 'all' || !isPrivateChannelMessage(message)).map(message => copyValue(message));

/** Filter before counting or pagination, and never hand callers a mutable cache entry. */
export const projectChannelMessages = <T extends Pick<ChannelMessage, 'senderId' | 'metadata'>>(
    messages: readonly T[],
    viewerId: string,
    visibility = readChannelHistoryDmVisibility()
): T[] => messages.filter(message => {
    if (visibility === 'all' || !isPrivateChannelMessage(message)) return true;
    // A historical DM missing its recipient is visible only to its recorded sender.
    return message.senderId === viewerId || message.metadata?.targetAgentId === viewerId;
}).map(message => copyValue(message));

/**
 * Stored summaries, topics, arbitrary context metadata, and activity counters may
 * include other agents' DMs. Only the channel's identity/configuration is safe to
 * return without generating and storing separate per-viewer aggregates.
 */
export const projectChannelContext = (
    context: Partial<ChannelContextType>,
    visibility = readChannelHistoryDmVisibility()
): Partial<ChannelContextType> => {
    if (visibility === 'all') return copyValue(context);
    const result: Partial<ChannelContextType> = {};
    const safeKeys = ['id', 'channelId', 'name', 'description', 'createdAt', 'createdBy', 'status', 'participants'] as const;
    for (const key of safeKeys) {
        if (Object.prototype.hasOwnProperty.call(context, key)) Object.assign(result, { [key]: copyValue(context[key]) });
    }
    return result;
};

/**
 * Project at an authenticated remote boundary, leaving internal canonical memory
 * complete. Explicitly shared notes/state remain shared; history-derived fields
 * cannot be returned merely because the caller selected a different memory API.
 */
export const projectChannelMemory = (
    memory: IChannelMemory,
    viewerId: string,
    visibility = readChannelHistoryDmVisibility()
): Partial<IChannelMemory> => {
    const result = copyValue(memory) as Partial<IChannelMemory> & { sharedCognitiveInsights?: unknown };
    if (memory.conversationHistory) {
        result.conversationHistory = projectChannelMessages(memory.conversationHistory, viewerId, visibility);
    }
    if (visibility === 'parties') {
        delete result.updatedAt;
        delete result.sharedCognitiveInsights;
        // Enhanced memory can carry aggregates beside the canonical fields too,
        // including records imported from an older server.
        for (const key of ['summary', 'topics', 'messageCount', 'lastActivity']) Reflect.deleteProperty(result, key);
        if (result.sharedState && Object.prototype.hasOwnProperty.call(result.sharedState, 'context')) {
            if (isRecord(result.sharedState.context)) {
                result.sharedState.context = projectChannelContext(result.sharedState.context, visibility);
            } else {
                delete result.sharedState.context;
            }
        }
        if (result.customData) delete result.customData.contextHistory;
    }
    return result;
};

/** Project the exact sub-resource returned by the socket memory event bridge. */
export const projectChannelMemoryResource = (
    memory: unknown, id: string, channelId: string, viewerId: string,
    visibility = readChannelHistoryDmVisibility()
): unknown => {
    const kind = classifyChannelMemoryId(id, channelId);
    if (memory === null || memory === undefined || visibility === 'all') return copyValue(memory);
    if (kind === 'history') throw new Error('Channel context history is unavailable with parties-only DM visibility');
    if (kind === 'messages') {
        if (!Array.isArray(memory)) throw new Error('Channel message history must be an array');
        return projectChannelMessages(memory, viewerId, visibility);
    }
    if (!isRecord(memory)) throw new Error('Channel memory response must be an object');
    if (kind === 'context') return projectChannelContext(memory, visibility);
    if (memory.channelId !== channelId) throw new Error('Channel memory response must belong to the request channel');
    return projectChannelMemory(memory as unknown as IChannelMemory, viewerId, visibility);
};
