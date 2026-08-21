import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';
import { Channel, IChannel } from '@mxf-dev/core/models/channel';
import { McpService } from '../../socket/services/McpService';

type PersistedChannelRuntimePolicy = Pick<
    IChannel,
    'channelId' | 'allowedTools' | 'systemLlmEnabled'
>;

/**
 * Install a persisted channel's runtime policy into the synchronous services
 * that enforce it. Call this before handing an authorized, cold-loaded channel
 * to a controller or tool executor.
 */
export const hydrateChannelRuntimePolicy = (
    channel: PersistedChannelRuntimePolicy
): void => {
    const channelId = String(channel.channelId ?? '').trim();
    if (channelId.length === 0) {
        throw new Error('Cannot hydrate runtime policy without a channel id');
    }

    const allowedTools = Array.isArray(channel.allowedTools)
        ? channel.allowedTools
        : [];
    McpService.getInstance().hydrateChannelAllowedTools(channelId, allowedTools);

    const systemLlmEnabled = channel.systemLlmEnabled !== false;
    ConfigManager.getInstance().setChannelSystemLlmEnabled(
        systemLlmEnabled,
        channelId,
        systemLlmEnabled
            ? undefined
            : 'Channel runtime policy loaded from persistence'
    );
};

/**
 * Load and hydrate an active channel by its exact persisted id.
 *
 * Missing, inactive, malformed, and failed lookups clear any stale tool policy
 * and disable SystemLLM for that id so callers fail closed.
 */
export const loadActiveChannelRuntimePolicy = async (
    channelId: string
): Promise<IChannel | null> => {
    const normalizedChannelId = channelId.trim();
    if (normalizedChannelId.length === 0) {
        throw new Error('Channel id is required to load runtime policy');
    }

    const mcpService = McpService.getInstance();
    const configManager = ConfigManager.getInstance();

    try {
        const channel = await Channel.findOne({
            channelId: normalizedChannelId,
            active: true
        });
        if (!channel) {
            mcpService.clearChannelAllowedTools(normalizedChannelId);
            configManager.setChannelSystemLlmEnabled(
                false,
                normalizedChannelId,
                'Channel is missing or inactive'
            );
            return null;
        }

        hydrateChannelRuntimePolicy(channel);
        return channel;
    } catch (error) {
        mcpService.clearChannelAllowedTools(normalizedChannelId);
        configManager.setChannelSystemLlmEnabled(
            false,
            normalizedChannelId,
            'Channel runtime policy could not be loaded'
        );
        throw error;
    }
};
