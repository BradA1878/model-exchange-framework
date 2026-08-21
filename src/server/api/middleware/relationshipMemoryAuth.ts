/** Tenant policy for channel-scoped relationship memory. */

import { NextFunction, Request, RequestHandler, Response } from 'express';
import { authorizationService } from '../services/AuthorizationService';
import type { ChannelAuthorizedRequest } from './channelAuth';

export const requireRelationshipMemoryAccess: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const channel = (req as ChannelAuthorizedRequest).channel;
    if (!channel) {
        res.status(500).json({
            success: false,
            message: 'Relationship memory authorization requires an authorized channel'
        });
        return;
    }

    const { agentId1, agentId2 } = req.params;
    if (!agentId1 || !agentId2 || agentId1 === agentId2) {
        res.status(400).json({
            success: false,
            message: 'Relationship memory requires two distinct agent IDs'
        });
        return;
    }

    const participants = new Set(channel.participants);
    if (!participants.has(agentId1) || !participants.has(agentId2)) {
        res.status(404).json({ success: false, message: 'Relationship memory not found' });
        return;
    }

    const principal = authorizationService.readPrincipal(req);
    if (
        principal.kind === 'agent' &&
        principal.agentId !== agentId1 &&
        principal.agentId !== agentId2
    ) {
        res.status(403).json({
            success: false,
            message: 'An agent may access only its own relationship memory'
        });
        return;
    }

    next();
};
