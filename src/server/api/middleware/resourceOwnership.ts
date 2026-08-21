/**
 * Express adapters for central persisted-resource authorization.
 */

import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    AuthorizationAction,
    AuthorizationResourceKind,
    authorizationService
} from '../services/AuthorizationService';

const logger = new Logger('info', 'ResourceOwnership', 'server');

type ResourceIdResolver = (req: Request) => unknown;

/** Require an authenticated JWT user. */
export const requireUserPrincipal: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const principal = authorizationService.readPrincipal(req);
    const decision = authorizationService.requireUser(principal);

    if (!decision.allowed) {
        res.status(decision.status).json({ success: false, error: decision.reason });
        return;
    }

    next();
};

const createResourceAuthorization = (
    action: AuthorizationAction,
    kind: AuthorizationResourceKind,
    resolveResourceId: ResourceIdResolver
): RequestHandler => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const value = resolveResourceId(req);
        const resourceId = typeof value === 'string' ? value : '';
        const principal = authorizationService.readPrincipal(req);
        const decision = await authorizationService.authorize(
            action,
            kind,
            resourceId,
            principal
        );

        if (!decision.allowed) {
            if (decision.status === 403) {
                logger.warn(
                    `Denied ${req.method} ${req.originalUrl}: ${decision.reason}`
                );
            }
            res.status(decision.status).json({ success: false, error: decision.reason });
            return;
        }

        next();
    } catch (error) {
        logger.error(`Resource authorization failed: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({ success: false, error: 'Server error during authorization' });
    }
};

/** Require the owning user or an administrator for a route-specific resource. */
export const requireResourceOwner = (
    kind: AuthorizationResourceKind,
    resolveResourceId: ResourceIdResolver
): RequestHandler => createResourceAuthorization('manage', kind, resolveResourceId);

/** Require resource ownership or an exact key-bound runtime identity. */
export const requireResourceAccess = (
    kind: AuthorizationResourceKind,
    resolveResourceId: ResourceIdResolver
): RequestHandler => createResourceAuthorization('access', kind, resolveResourceId);
