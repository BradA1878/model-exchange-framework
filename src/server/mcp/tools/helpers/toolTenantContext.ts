/**
 * Fail-closed tenant guards for server-hosted MCP tools.
 *
 * Tool arguments are model-controlled. The authenticated MCP context is the
 * only authority for agent and channel identity. Current ChannelService
 * membership is separately required by communication and coordination tools;
 * database-only tools must also work for an authenticated cold REST request.
 */
import { McpToolHandlerContext } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import { ChannelService } from '../../../socket/services/ChannelService';

export interface ExactToolTenantContext {
    agentId: string;
    channelId: string;
}

export function requireExactToolTenantContext(
    context: McpToolHandlerContext,
    requestedChannelId?: unknown
): ExactToolTenantContext {
    const agentId = context.agentId;
    const channelId = context.channelId;

    if (typeof agentId !== 'string' || agentId.trim() === '') {
        throw new Error('Authenticated agent context is required');
    }
    if (typeof channelId !== 'string' || channelId.trim() === '') {
        throw new Error('Authenticated channel context is required');
    }
    if (requestedChannelId !== undefined && requestedChannelId !== channelId) {
        throw new Error('Requested channel does not match the authenticated channel');
    }

    return { agentId, channelId };
}

export function requireCurrentChannelParticipant(channelId: string, agentId: string): void {
    if (!ChannelService.getInstance().isParticipant(channelId, agentId)) {
        throw new Error('Authenticated agent is not a current participant of the channel');
    }
}

/**
 * Validate every recipient before any persistence or event emission occurs.
 * The generic error intentionally avoids enumerating channel membership.
 */
export function requireChannelParticipants(channelId: string, agentIds: readonly unknown[]): string[] {
    if (!Array.isArray(agentIds) || agentIds.length === 0) {
        throw new Error('At least one target agent is required');
    }

    const normalizedAgentIds = [...new Set(agentIds.map((agentId) => {
        if (typeof agentId !== 'string' || agentId.trim() === '') {
            throw new Error('Target agent IDs must be non-empty strings');
        }
        return agentId;
    }))];

    const channelService = ChannelService.getInstance();
    if (normalizedAgentIds.some((agentId) => !channelService.isParticipant(channelId, agentId))) {
        throw new Error('One or more target agents are not current participants of the authenticated channel');
    }

    return normalizedAgentIds;
}
