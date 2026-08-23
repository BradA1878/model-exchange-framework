import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';
import { Channel, IChannel } from '@mxf-dev/core/models/channel';
import { McpService } from '../../socket/services/McpService';
import { isSystemLlmStance, SYSTEMLLM_STANCES } from '@mxf-dev/core/types/SystemLlmStanceTypes';
import { Logger } from '@mxf-dev/core/utils/Logger';

const logger = new Logger('info', 'ChannelRuntimePolicy', 'server');

type PersistedChannelRuntimePolicy = Pick<
    IChannel,
    'channelId' | 'allowedTools' | 'systemLlmEnabled' | 'systemLlmStance'
>;

/**
 * Install a persisted channel's SystemLLM stance into ConfigManager. A
 * document without a stance inherits the server-wide one, so any stale
 * channel-level stance is cleared. A value that is not a stance is a data
 * error and is refused rather than guessed at.
 */
export const hydrateChannelSystemLlmStance = (channelId: string, stance: unknown): void => {
    const configManager = ConfigManager.getInstance();
    if (stance === undefined || stance === null) {
        configManager.clearChannelSystemLlmStance(channelId);
        return;
    }
    if (!isSystemLlmStance(stance)) {
        throw new Error(
            `Channel ${channelId} has an invalid systemLlmStance '${String(stance)}'. ` +
            `Expected one of: ${SYSTEMLLM_STANCES.join(', ')}`
        );
    }
    configManager.setChannelSystemLlmStance(stance, channelId);
    const effective = configManager.getChannelSystemLlmStance(channelId);
    if (effective !== stance) {
        logger.info(
            `Channel ${channelId} asks for SystemLLM stance '${stance}'; SYSTEMLLM_STANCE_MAX caps it at '${effective}'`
        );
    }
};

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
    hydrateChannelSystemLlmStance(channelId, channel.systemLlmStance);
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
