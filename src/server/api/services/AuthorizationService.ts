/**
 * Central authorization policy for authenticated HTTP principals.
 *
 * Authentication middleware establishes identity. This service is the single
 * place that decides whether that identity may access or administer a concrete
 * MXF resource. Keeping the decision independent from Express makes the policy
 * usable at every HTTP boundary and directly testable.
 */

import { Request } from 'express';
import { Agent } from '@mxf-dev/core/models/agent';
import { Channel, IChannel } from '@mxf-dev/core/models/channel';
import ChannelKey from '@mxf-dev/core/models/channelKey';
import { UserRole } from '@mxf-dev/core/models/user';
import { hydrateChannelRuntimePolicy } from '../security/ChannelRuntimePolicy';

export type AuthorizationResourceKind = 'channel' | 'agent' | 'agent-key' | 'key';
export type AuthorizationAction = 'access' | 'manage' | 'delete';

export type AuthorizationPrincipal =
    | { kind: 'user'; userId: string; role?: string }
    | { kind: 'agent'; agentId: string; channelId: string; keyId: string }
    | { kind: 'unauthenticated' }
    | { kind: 'invalid'; authType: string };

export interface AuthorizationResource {
    createdBy?: unknown;
    channelId?: string;
    agentId?: string;
    keyId?: string;
}

export type AuthorizationDecision<T extends AuthorizationResource = AuthorizationResource> =
    | { allowed: true; resource: T }
    | { allowed: false; status: 401 | 403 | 404; reason: string };

export type ChannelAuthorizationScope =
    | { unrestricted: true }
    | { unrestricted: false; channelIds: string[] };

export type ChannelScopeDecision =
    | { allowed: true; scope: ChannelAuthorizationScope }
    | { allowed: false; status: 401 | 403; reason: string };

interface AuthenticationRequest extends Request {
    authType?: string;
    user?: {
        id?: unknown;
        role?: string;
    };
    agent?: {
        agentId?: unknown;
        channelId?: unknown;
        keyId?: unknown;
    };
}

const normalizeIdentifier = (value: unknown): string | undefined => {
    if (value === undefined || value === null) {
        return undefined;
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : undefined;
};

export class AuthorizationService {
    private static instance: AuthorizationService | null = null;

    private constructor() {}

    public static getInstance(): AuthorizationService {
        if (!AuthorizationService.instance) {
            AuthorizationService.instance = new AuthorizationService();
        }

        return AuthorizationService.instance;
    }

    /** Read identity exclusively from data attached by authentication middleware. */
    public readPrincipal(req: Request): AuthorizationPrincipal {
        const authenticationRequest = req as AuthenticationRequest;

        if (!authenticationRequest.authType) {
            return { kind: 'unauthenticated' };
        }

        if (authenticationRequest.authType === 'jwt') {
            const userId = normalizeIdentifier(authenticationRequest.user?.id);
            if (!userId) {
                return { kind: 'unauthenticated' };
            }

            return {
                kind: 'user',
                userId,
                role: authenticationRequest.user?.role
            };
        }

        if (authenticationRequest.authType === 'key') {
            const agentId = normalizeIdentifier(authenticationRequest.agent?.agentId);
            const channelId = normalizeIdentifier(authenticationRequest.agent?.channelId);
            const keyId = normalizeIdentifier(authenticationRequest.agent?.keyId);
            if (!agentId || !channelId || !keyId) {
                return { kind: 'unauthenticated' };
            }

            return { kind: 'agent', agentId, channelId, keyId };
        }

        return { kind: 'invalid', authType: authenticationRequest.authType };
    }

    public requireUser(principal: AuthorizationPrincipal): AuthorizationDecision {
        if (principal.kind === 'unauthenticated') {
            return {
                allowed: false,
                status: 401,
                reason: 'A user account is required to manage this resource'
            };
        }

        if (principal.kind !== 'user') {
            return {
                allowed: false,
                status: 403,
                reason: 'A user account is required to manage this resource'
            };
        }

        return { allowed: true, resource: {} };
    }

    /**
     * Resolve the channel set a principal may use for collection queries.
     *
     * Item routes should continue to call `authorize()` for the concrete
     * channel they resolved. Collection routes cannot do that when no channel
     * filter was supplied, so they use this scope to constrain the database
     * query itself rather than fetching every tenant's records and filtering in
     * application memory.
     */
    public async resolveChannelScope(
        principal: AuthorizationPrincipal
    ): Promise<ChannelScopeDecision> {
        if (principal.kind === 'unauthenticated') {
            return { allowed: false, status: 401, reason: 'Authentication required' };
        }

        if (principal.kind === 'invalid') {
            return { allowed: false, status: 403, reason: 'Unsupported authentication principal' };
        }

        if (principal.kind === 'agent') {
            return {
                allowed: true,
                scope: { unrestricted: false, channelIds: [principal.channelId] }
            };
        }

        if (principal.role === UserRole.ADMIN) {
            return { allowed: true, scope: { unrestricted: true } };
        }

        const channels = await Channel.find({ createdBy: principal.userId, active: true })
            .select('channelId')
            .lean();
        const channelIds = Array.from(new Set(
            channels
                .map(channel => normalizeIdentifier(channel.channelId))
                .filter((channelId): channelId is string => channelId !== undefined)
        ));

        return {
            allowed: true,
            scope: { unrestricted: false, channelIds }
        };
    }

    /**
     * Authorize access to a persisted resource.
     *
     * `access` permits a channel-bound agent to use only that exact channel.
     * Being a participant elsewhere is deliberately insufficient: credentials
     * are scoped to both agent and channel, and one channel key must never act as
     * a bearer credential for every channel the same agent has joined.
     *
     * `manage` is reserved for the owning user or an administrator.
     */
    public async authorize<T extends AuthorizationResource = AuthorizationResource>(
        action: AuthorizationAction,
        kind: AuthorizationResourceKind,
        resourceId: string,
        principal: AuthorizationPrincipal
    ): Promise<AuthorizationDecision<T>> {
        const principalRejection = this.rejectPrincipal(action, kind, resourceId, principal);
        if (principalRejection) {
            return principalRejection;
        }

        const resource = await this.loadResource(kind, resourceId, action);
        if (!resource) {
            return {
                allowed: false,
                status: 404,
                reason: `${kind} not found`
            };
        }

        if (principal.kind === 'user') {
            if (principal.role === UserRole.ADMIN || String(resource.createdBy) === principal.userId) {
                // A deletion retry is allowed to resolve an inactive pending
                // tombstone. Never hydrate that tombstone back into runtime
                // policy caches while authorizing the cleanup.
                if (action !== 'delete') {
                    this.hydrateAuthorizedResource(kind, resource);
                }
                return { allowed: true, resource: resource as T };
            }

            return {
                allowed: false,
                status: 403,
                reason: `You do not have permission to ${action} this ${kind}`
            };
        }

        if (action === 'access' && principal.kind === 'agent') {
            const channelKeyMatches = kind === 'channel'
                && principal.channelId === resourceId
                && resource.channelId === resourceId;
            const agentKeyMatches = kind === 'agent-key'
                && principal.keyId === resourceId
                && resource.keyId === resourceId
                && resource.agentId === principal.agentId;

            if (channelKeyMatches || agentKeyMatches) {
                this.hydrateAuthorizedResource(kind, resource);
                return { allowed: true, resource: resource as T };
            }
        }

        return {
            allowed: false,
            status: 403,
            reason: `You do not have permission to ${action} this ${kind}`
        };
    }

    /**
     * Channel authorization is also the cold-load boundary for runtime policy.
     * Keeping this here covers direct service callers as well as Express
     * middleware adapters without creating per-route policy gaps.
     */
    private hydrateAuthorizedResource(
        kind: AuthorizationResourceKind,
        resource: AuthorizationResource
    ): void {
        if (kind === 'channel') {
            hydrateChannelRuntimePolicy(resource as IChannel);
        }
    }

    private rejectPrincipal(
        action: AuthorizationAction,
        kind: AuthorizationResourceKind,
        resourceId: string,
        principal: AuthorizationPrincipal
    ): Extract<AuthorizationDecision, { allowed: false }> | null {
        if (principal.kind === 'unauthenticated') {
            return { allowed: false, status: 401, reason: 'Authentication required' };
        }

        if (principal.kind === 'invalid') {
            return { allowed: false, status: 403, reason: 'Unsupported authentication principal' };
        }

        if (typeof resourceId !== 'string' || resourceId.trim().length === 0) {
            return { allowed: false, status: 404, reason: `${kind} not found` };
        }

        if ((action === 'manage' || action === 'delete') && principal.kind !== 'user') {
            return {
                allowed: false,
                status: 403,
                reason: `A user account is required to manage this ${kind}`
            };
        }

        if (action === 'access' && kind !== 'channel' && kind !== 'agent-key') {
            return {
                allowed: false,
                status: 403,
                reason: `Access policy is not defined for ${kind}`
            };
        }

        return null;
    }

    private async loadResource(
        kind: AuthorizationResourceKind,
        resourceId: string,
        action: AuthorizationAction
    ): Promise<AuthorizationResource | null> {
        if (kind === 'channel') {
            if (action === 'delete') {
                return Channel.findOne({
                    channelId: resourceId,
                    $or: [
                        { active: true },
                        {
                            active: false,
                            'metadata.deletionCleanupStatus': 'pending'
                        }
                    ]
                });
            }
            return Channel.findOne({ channelId: resourceId, active: true });
        }

        if (kind === 'agent') {
            return Agent.findOne({ agentId: resourceId }).select('createdBy');
        }

        if (kind === 'agent-key') {
            return Agent.findOne({ keyId: resourceId }).select('createdBy agentId keyId');
        }

        return ChannelKey.findOne({ keyId: resourceId }).select('createdBy');
    }
}

export const authorizationService = AuthorizationService.getInstance();
