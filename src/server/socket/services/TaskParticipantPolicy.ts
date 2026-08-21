import { Channel } from '@mxf-dev/core/models/channel';
import { Task } from '@mxf-dev/core/models/task';

interface ChannelParticipants {
    participants?: unknown;
}

const requireIdentifier = (value: string, field: string): string => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${field} must be a non-empty string`);
    }
    return value.trim();
};

/**
 * Require every explicitly selected task agent to belong to the task's active
 * channel. Persisted channel membership is used so an offline participant may
 * still receive work, while a globally known agent from another tenant cannot.
 */
export const assertTaskAgentsBelongToChannel = async (
    channelId: string,
    requestedAgentIds: readonly (string | undefined)[]
): Promise<void> => {
    const exactChannelId = requireIdentifier(channelId, 'channelId');
    const agentIds = Array.from(new Set(
        requestedAgentIds
            .filter((agentId): agentId is string => agentId !== undefined)
            .map((agentId, index) => requireIdentifier(agentId, `agentIds[${index}]`))
    ));
    if (agentIds.length === 0) {
        return;
    }

    const channel = await Channel.findOne({ channelId: exactChannelId, active: true })
        .select('participants')
        .lean<ChannelParticipants>();
    if (!channel || !Array.isArray(channel.participants)) {
        throw new Error(`Active channel ${exactChannelId} was not found`);
    }

    const participants = new Set(
        channel.participants.filter((participant): participant is string =>
            typeof participant === 'string' && participant.length > 0)
    );
    const foreignAgentIds = agentIds.filter(agentId => !participants.has(agentId));
    if (foreignAgentIds.length > 0) {
        throw new Error(
            `Task agent(s) are not participants of channel ${exactChannelId}: ` +
            foreignAgentIds.sort().join(', ')
        );
    }
};

/** Require every declared dependency to resolve inside the task's channel. */
export const assertTaskDependenciesBelongToChannel = async (
    channelId: string,
    requestedTaskIds: readonly string[]
): Promise<void> => {
    const exactChannelId = requireIdentifier(channelId, 'channelId');
    const taskIds = Array.from(new Set(
        requestedTaskIds.map((taskId, index) => requireIdentifier(taskId, `dependsOn[${index}]`))
    ));
    if (taskIds.length === 0) {
        return;
    }

    const tasks = await Task.find({
        _id: { $in: taskIds },
        channelId: exactChannelId
    }).select('_id').lean<Array<{ _id: unknown }>>();
    const foundTaskIds = new Set(tasks.map(task => String(task._id)));
    const missingTaskIds = taskIds.filter(taskId => !foundTaskIds.has(taskId));
    if (missingTaskIds.length > 0) {
        throw new Error(
            `Task dependencies were not found in channel ${exactChannelId}: ` +
            missingTaskIds.sort().join(', ')
        );
    }
};
