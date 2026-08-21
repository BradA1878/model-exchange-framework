import { NextFunction, Request, RequestHandler, Response, Router } from 'express';

const createChannelKey = jest.fn();
const deactivateChannelKey = jest.fn();

const channelFindOne = jest.fn();
const agentFindOne = jest.fn();
const keyFindOne = jest.fn();

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { findOne: channelFindOne }
}));

jest.mock('@mxf-dev/core/models/agent', () => ({
    Agent: { findOne: agentFindOne }
}));

jest.mock('@mxf-dev/core/models/channelKey', () => ({
    __esModule: true,
    default: { findOne: keyFindOne }
}));

jest.mock('../../../src/server/socket/services/ChannelKeyService', () => ({
    __esModule: true,
    default: {
        createChannelKey,
        deactivateChannelKey,
        listChannelKeys: jest.fn(),
        describeKey: jest.fn(),
        validateKey: jest.fn(),
        updateChannelKeyAssociation: jest.fn()
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import channelKeyRoutes from '../../../src/server/api/routes/channelKeyRoutes';
import agentKeyRoutes from '../../../src/server/api/routes/agentKeyRoutes';

const selectedResult = (value: unknown): { select: jest.Mock } => ({
    select: jest.fn().mockResolvedValue(value)
});

interface RouteLayer {
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
    };
}

const getFirstRouteHandler = (router: Router, path: string, method: string): RequestHandler => {
    const routeStack = (router as unknown as { stack: RouteLayer[] }).stack;
    const layer = routeStack.find(candidate =>
        candidate.route?.path === path && candidate.route.methods[method]
    );

    if (!layer?.route?.stack[0]) {
        throw new Error(`Route ${method.toUpperCase()} ${path} was not registered`);
    }

    return layer.route.stack[0].handle;
};

const invokeFirstRouteHandler = async (
    router: Router,
    path: string,
    method: string,
    principal: {
        authType: string;
        user?: { id: string; role: string };
        agent?: { agentId: string; channelId: string; keyId: string };
    },
    params: Record<string, string> = {},
    body: Record<string, unknown> = {}
): Promise<{ res: Response; next: jest.Mock }> => {
    const req = {
        ...principal,
        params,
        body,
        method: method.toUpperCase(),
        originalUrl: path
    } as unknown as Request;
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    const next = jest.fn() as NextFunction & jest.Mock;

    await Promise.resolve(getFirstRouteHandler(router, path, method)(req, res as Response, next));
    return { res: res as Response, next };
};

describe('credential route ownership', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('prevents another user from minting a key for a channel', async () => {
        channelFindOne.mockReturnValue(selectedResult({ createdBy: 'owner-user' }));

        const { res, next } = await invokeFirstRouteHandler(
            channelKeyRoutes,
            '/',
            'post',
            { authType: 'jwt', user: { id: 'attacker-user', role: 'consumer' } },
            {},
            { channelId: 'victim-channel', agentId: 'attacker-agent' }
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
        expect(createChannelKey).not.toHaveBeenCalled();
    });

    it('prevents another user from revoking a key', async () => {
        keyFindOne.mockReturnValue(selectedResult({ createdBy: 'owner-user' }));

        const { res, next } = await invokeFirstRouteHandler(
            channelKeyRoutes,
            '/:keyId',
            'delete',
            { authType: 'jwt', user: { id: 'attacker-user', role: 'consumer' } },
            { keyId: 'victim-key' }
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
        expect(deactivateChannelKey).not.toHaveBeenCalled();
    });

    it('prevents another user from replacing an agent credential', async () => {
        agentFindOne.mockReturnValue(selectedResult({ createdBy: 'owner-user' }));

        const { res, next } = await invokeFirstRouteHandler(
            agentKeyRoutes,
            '/:agentId/keys',
            'post',
            { authType: 'jwt', user: { id: 'attacker-user', role: 'consumer' } },
            { agentId: 'victim-agent' },
            { channelId: 'victim-channel' }
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
        expect(createChannelKey).not.toHaveBeenCalled();
    });

    it('prevents a channel-key agent from administering credentials', async () => {
        const { res, next } = await invokeFirstRouteHandler(
            channelKeyRoutes,
            '/',
            'post',
            {
                authType: 'key',
                agent: { agentId: 'agent-1', channelId: 'channel-1', keyId: 'key-1' }
            },
            {},
            { channelId: 'channel-1', agentId: 'agent-1' }
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
        expect(channelFindOne).not.toHaveBeenCalled();
        expect(createChannelKey).not.toHaveBeenCalled();
    });

    it('keeps cross-agent status enumeration admin-only', async () => {
        const { res, next } = await invokeFirstRouteHandler(
            agentKeyRoutes,
            '/keys/status',
            'get',
            { authType: 'jwt', user: { id: 'ordinary-user', role: 'consumer' } }
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
        expect(agentFindOne).not.toHaveBeenCalled();
    });
});
