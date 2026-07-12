/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Channel Authorization Middleware
 *
 * Authentication says who the caller is. This says which channel they may act
 * on. Every route with a `:channelId` parameter runs through it, so a caller
 * cannot read or mutate a channel simply by knowing its id.
 *
 * The rule, by principal type:
 *
 * - User (JWT): may act on channels they created. This matches what the read
 *   paths already do — getChannelById and getAllChannels both filter by
 *   `createdBy` — the write paths just never checked.
 *
 * - Agent (channel key): may act on the channel their key is bound to. The key
 *   authenticates a channel, and ChannelKeyService.validateKey returns which
 *   one, so the binding cannot be forged from the request. An agent listed in
 *   the channel's `participants` is also allowed; participants are only ever
 *   added by ChannelService.addParticipant using the channelId from the
 *   authenticated socket, so that list cannot be stuffed either.
 *
 * Anything else is a 403. A channel that does not exist is a 404.
 *
 * The resolved channel is attached to the request as `req.channel` so handlers
 * do not have to load it a second time.
 */

import { Request, Response, NextFunction } from 'express';
import { Channel, IChannel } from '@mxf-dev/core/models/channel';
import { Logger } from '@mxf-dev/core/utils/Logger';

const logger = new Logger('info', 'ChannelAuth', 'server');

/** Request carrying the channel resolved and authorized by this middleware. */
export interface ChannelAuthorizedRequest extends Request {
    channel?: IChannel;
}

/** Why a caller was refused. Returned by authorizeChannel for logs and tests. */
export type ChannelAuthDecision =
    | { allowed: true; channel: IChannel }
    | { allowed: false; status: 401 | 403 | 404; reason: string };

/** The authenticated principal, as attached by the dual-auth middleware. */
export interface ChannelPrincipal {
    /** 'jwt' for users, 'key' for agents. */
    authType?: string;
    /** User id, when authType is 'jwt'. */
    userId?: string;
    /** Agent id, when authType is 'key'. */
    agentId?: string;
    /** Channel the agent's key is bound to, when authType is 'key'. */
    keyChannelId?: string;
}

/**
 * Read the authenticated principal off the request.
 *
 * dualAuth attaches `req.user` (JWT) or `req.agent` (key) plus `req.authType`.
 *
 * @param req - Incoming request
 * @returns The principal, with ids normalized to strings
 */
export const readPrincipal = (req: Request): ChannelPrincipal => {
    const authType = (req as any).authType;
    const user = (req as any).user;
    const agent = (req as any).agent;

    return {
        authType,
        userId: user?.id !== undefined && user?.id !== null ? String(user.id) : undefined,
        agentId: agent?.agentId !== undefined && agent?.agentId !== null ? String(agent.agentId) : undefined,
        keyChannelId: agent?.channelId !== undefined && agent?.channelId !== null ? String(agent.channelId) : undefined
    };
};

/**
 * Decide whether a principal may act on a channel.
 *
 * Kept separate from the Express middleware so the rule can be unit tested
 * without an HTTP server.
 *
 * @param channelId - Channel being acted on
 * @param principal - Authenticated caller
 * @returns The decision, carrying the channel when allowed
 */
export const authorizeChannel = async (
    channelId: string,
    principal: ChannelPrincipal
): Promise<ChannelAuthDecision> => {
    if (typeof channelId !== 'string' || channelId.trim().length === 0) {
        return { allowed: false, status: 404, reason: 'Channel not found' };
    }

    if (!principal.authType) {
        return { allowed: false, status: 401, reason: 'Authentication required' };
    }

    const channel = await Channel.findOne({ channelId });

    if (!channel) {
        return { allowed: false, status: 404, reason: 'Channel not found' };
    }

    if (principal.authType === 'jwt') {
        if (!principal.userId) {
            return { allowed: false, status: 401, reason: 'Authentication required' };
        }

        if (String(channel.createdBy) !== principal.userId) {
            return { allowed: false, status: 403, reason: 'You do not have access to this channel' };
        }

        return { allowed: true, channel };
    }

    if (principal.authType === 'key') {
        if (!principal.agentId) {
            return { allowed: false, status: 401, reason: 'Authentication required' };
        }

        // The key is bound to a channel by ChannelKeyService.validateKey — the
        // caller does not get to choose which one.
        const keyMatchesChannel = principal.keyChannelId === channelId;
        const isParticipant = Array.isArray(channel.participants)
            && channel.participants.includes(principal.agentId);

        if (!keyMatchesChannel && !isParticipant) {
            return { allowed: false, status: 403, reason: 'You do not have access to this channel' };
        }

        return { allowed: true, channel };
    }

    return { allowed: false, status: 403, reason: 'You do not have access to this channel' };
};

/**
 * Express middleware enforcing channel access on any route with `:channelId`.
 *
 * Must run after the dual-auth middleware, which attaches the principal.
 * Attaches the resolved channel to `req.channel` on success.
 *
 * @param req - Incoming request
 * @param res - Response
 * @param next - Next handler
 */
export const requireChannelAccess = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { channelId } = req.params;
        const principal = readPrincipal(req);
        const decision = await authorizeChannel(channelId, principal);

        if (!decision.allowed) {
            if (decision.status === 403) {
                logger.warn(
                    `Denied ${req.method} ${req.originalUrl} — ` +
                    `${principal.authType === 'key' ? `agent ${principal.agentId}` : `user ${principal.userId}`} ` +
                    `may not act on channel ${channelId}`
                );
            }

            res.status(decision.status).json({
                success: false,
                message: decision.reason
            });
            return;
        }

        (req as ChannelAuthorizedRequest).channel = decision.channel;
        next();
    } catch (error) {
        logger.error(`Channel authorization error: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            message: 'Server error during channel authorization'
        });
    }
};
