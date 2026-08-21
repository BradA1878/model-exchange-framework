import { NextFunction, Request, RequestHandler, Response, Router } from 'express';

const mockTokenService = {
    createToken: jest.fn(),
    listTokens: jest.fn(),
    getTokenStats: jest.fn(),
    revokeToken: jest.fn(),
    validateTokenForRequester: jest.fn()
};

jest.mock('../../../src/server/api/services/PersonalAccessTokenService', () => ({
    PersonalAccessTokenService: {
        getInstance: jest.fn(() => mockTokenService)
    }
}));

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { find: jest.fn(), findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/agent', () => ({
    Agent: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/channelKey', () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import tokenRoutes from '../../../src/server/api/routes/tokenRoutes';

interface RouterLayer {
    handle: RequestHandler;
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
    };
}

const routerStack = (tokenRoutes as Router as unknown as { stack: RouterLayer[] }).stack;

const getUserGate = (): RequestHandler => {
    const firstLayer = routerStack[0];
    if (!firstLayer || firstLayer.route) {
        throw new Error('Token router user-principal middleware must be registered first');
    }
    return firstLayer.handle;
};

const getRouteHandler = (path: string, method: string): RequestHandler => {
    const layer = routerStack.find(candidate =>
        candidate.route?.path === path && candidate.route.methods[method]
    );
    if (!layer?.route?.stack[0]) {
        throw new Error(`Token route ${method.toUpperCase()} ${path} was not registered`);
    }
    return layer.route.stack[0].handle;
};

const buildResponse = (): Response => {
    const response: Partial<Response> = {};
    response.status = jest.fn().mockReturnValue(response);
    response.json = jest.fn().mockReturnValue(response);
    return response as Response;
};

const invokeUserGate = (req: Request): { res: Response; next: NextFunction & jest.Mock } => {
    const res = buildResponse();
    const next = jest.fn() as NextFunction & jest.Mock;
    getUserGate()(req, res, next);
    return { res, next };
};

const invokeValidate = async (
    principal: { id: string; role: string }
): Promise<Response> => {
    const req = {
        authType: 'jwt',
        user: principal,
        body: { accessToken: 'mxf_target:secret' }
    } as unknown as Request;
    const res = buildResponse();

    await Promise.resolve(getRouteHandler('/validate', 'post')(req, res, jest.fn()));
    return res;
};

describe('personal access token route authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTokenService.validateTokenForRequester.mockResolvedValue({ valid: false });
    });

    it('puts the user-principal gate before every token-management route', () => {
        const registeredRoutes = routerStack
            .map((layer, index) => ({ layer, index }))
            .filter(({ layer }) => layer.route);

        expect(registeredRoutes).toHaveLength(5);
        registeredRoutes.forEach(({ index }) => expect(index).toBeGreaterThan(0));

        const { res, next } = invokeUserGate({
            authType: 'key',
            agent: { agentId: 'agent-a', channelId: 'channel-a', keyId: 'key-a' }
        } as unknown as Request);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        Object.values(mockTokenService).forEach(method => expect(method).not.toHaveBeenCalled());
    });

    it('requires authentication before token management', () => {
        const { res, next } = invokeUserGate({} as Request);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('allows an authenticated user through the router gate', () => {
        const { res, next } = invokeUserGate({
            authType: 'jwt',
            user: { id: 'user-a', role: 'consumer' }
        } as unknown as Request);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('scopes validation to the authenticated user', async () => {
        mockTokenService.validateTokenForRequester.mockResolvedValue({
            valid: true,
            userId: 'user-a',
            scopes: ['sdk']
        });

        const res = await invokeValidate({ id: 'user-a', role: 'consumer' });

        expect(res.status).not.toHaveBeenCalled();
        expect(mockTokenService.validateTokenForRequester).toHaveBeenCalledWith(
            'mxf_target',
            'secret',
            { userId: 'user-a', isAdmin: false }
        );
    });

    it('passes administrator scope explicitly for operational validation', async () => {
        const res = await invokeValidate({ id: 'admin-a', role: 'admin' });

        expect(res.status).not.toHaveBeenCalled();
        expect(mockTokenService.validateTokenForRequester).toHaveBeenCalledWith(
            'mxf_target',
            'secret',
            { userId: 'admin-a', isAdmin: true }
        );
    });
});
