/** Resolve a channel's exact wire IDs; channel IDs themselves may contain colons. */
export const classifyChannelMemoryId = (
    id: string,
    channelId: string
): 'whole' | 'messages' | 'context' | 'history' => {
    if (id === channelId) return 'whole';
    if (id === `channel:messages:${channelId}`) return 'messages';
    if (id === `channel:context:${channelId}`) return 'context';
    if (id === `channel:context:history:${channelId}`) return 'history';
    throw new Error('Channel memory key must match the request channel');
};
