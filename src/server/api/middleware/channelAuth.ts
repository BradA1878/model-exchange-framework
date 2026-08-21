/**
 * Express adapters for the central channel authorization policy.
 */

import { NextFunction, Request, RequestHandler, Response } from 'express';
import { IChannel } from '@mxf-dev/core/models/channel';
import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    AuthorizationAction,
    AuthorizationPrincipal,
    authorizationService
} from '../services/AuthorizationService';

const logger = new Logger('info', 'ChannelAuth', 'server');

/** Request carrying the channel resolved by the authorization service. */
export interface ChannelAuthorizedRequest extends Request {
    channel?: IChannel;
}

const describePrincipal = (principal: AuthorizationPrincipal): string => {
    if (principal.kind === 'user') {
        return `user ${principal.userId}`;
    }

    if (principal.kind === 'agent') {
        return `agent ${principal.agentId} in channel ${principal.channelId}`;
    }

    return principal.kind;
};

const createChannelAuthorizationMiddleware = (action: AuthorizationAction): RequestHandler => async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { channelId } = req.params;
        const principal = authorizationService.readPrincipal(req);
        const decision = await authorizationService.authorize<IChannel>(
            action,
            'channel',
            channelId,
            principal
        );

        if (!decision.allowed) {
            if (decision.status === 403) {
                logger.warn(
                    `Denied ${req.method} ${req.originalUrl} to ${describePrincipal(principal)}: ${decision.reason}`
                );
            }

            res.status(decision.status).json({
                success: false,
                message: decision.reason
            });
            return;
        }

        (req as ChannelAuthorizedRequest).channel = decision.resource;
        next();
    } catch (error) {
        logger.error(`Channel authorization error: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            message: 'Server error during channel authorization'
        });
    }
};

/** Allow the owning user, an administrator, or an agent key bound to this exact channel. */
export const requireChannelAccess = createChannelAuthorizationMiddleware('access');

/** Allow only the owning user or an administrator to administer the channel. */
export const requireChannelOwner = createChannelAuthorizationMiddleware('manage');

/**
 * Allow an owner/admin to start deletion or retry a pending inactive tombstone.
 * Other channel routes intentionally continue to ignore inactive channels.
 */
export const requireChannelDeletionOwner = createChannelAuthorizationMiddleware('delete');
