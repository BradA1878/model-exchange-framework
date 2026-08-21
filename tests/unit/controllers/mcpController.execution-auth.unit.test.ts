import { Request, Response } from 'express';
import { of, throwError } from 'rxjs';

const mockExecuteTool = jest.fn();
const mockLoadActiveChannelRuntimePolicy = jest.fn();

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        error = jest.fn();
        warn = jest.fn();
        info = jest.fn();
        debug = jest.fn();
        trace = jest.fn();
        child(): this { return this; }
    }
}));

jest.mock('@mxf-dev/core/utils/validation', (): object => ({
    createStrictValidator: (): { assertIsObject: jest.Mock } => ({
        assertIsObject: jest.fn()
    })
}));

jest.mock('../../../src/server/api/services/McpToolRegistry', () => ({
    McpToolRegistry: {
        getInstance: jest.fn()
    }
}));

jest.mock('../../../src/server/socket/services/McpSocketExecutor', (): object => ({
    McpSocketExecutor: {
        getInstance: (): { executeTool: typeof mockExecuteTool } => ({
            executeTool: mockExecuteTool
        })
    }
}));

jest.mock('../../../src/server/api/security/ChannelRuntimePolicy', () => ({
    loadActiveChannelRuntimePolicy: mockLoadActiveChannelRuntimePolicy
}));

import { executeTool, registerTool } from '../../../src/server/api/controllers/mcpController';
import { McpToolRegistry } from '../../../src/server/api/services/McpToolRegistry';
import { ToolAuthorizationError } from '../../../src/server/socket/services/ToolAuthorizationPolicy';

type AuthenticatedRequest = Request & {
    authType?: string;
    agent?: {
        agentId?: unknown;
        channelId?: unknown;
        keyId?: string;
    };
};

const makeRequest = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest => ({
    params: { name: 'task_complete' },
    body: { input: {} },
    headers: {},
    ip: '127.0.0.1',
    authType: 'key',
    agent: {
        agentId: 'trusted-agent',
        channelId: 'trusted-channel',
        keyId: 'key-1'
    },
    ...overrides
} as AuthenticatedRequest);

const makeResponse = (): {
    response: Response;
    status: jest.Mock;
    json: jest.Mock;
} => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    return {
        response: { status } as unknown as Response,
        status,
        json
    };
};

describe('mcpController.executeTool authenticated execution context', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockExecuteTool.mockReturnValue(of({
            content: { type: 'text', data: 'ok' }
        }));
        mockLoadActiveChannelRuntimePolicy.mockResolvedValue({
            channelId: 'trusted-channel',
            active: true,
            allowedTools: []
        });
    });

    it('derives agent and channel identity from the authenticated key principal', async () => {
        const req = makeRequest();
        const { response, status } = makeResponse();

        await executeTool(req, response);

        expect(mockExecuteTool).toHaveBeenCalledWith(
            'task_complete',
            {},
            expect.objectContaining({
                agentId: 'trusted-agent',
                channelId: 'trusted-channel'
            })
        );
        expect(status).toHaveBeenCalledWith(200);
    });

    it.each([
        ['x-agent-id', 'spoofed-agent'],
        ['x-channel-id', 'spoofed-channel']
    ])('rejects a spoofed %s assertion', async (header, value) => {
        const req = makeRequest({ headers: { [header]: value } });
        const { response, status } = makeResponse();

        await executeTool(req, response);

        expect(status).toHaveBeenCalledWith(403);
        expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('accepts legacy identity headers only when they match the key principal', async () => {
        const req = makeRequest({
            headers: {
                'x-agent-id': 'trusted-agent',
                'x-channel-id': 'trusted-channel'
            }
        });
        const { response, status } = makeResponse();

        await executeTool(req, response);

        expect(status).toHaveBeenCalledWith(200);
        expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    });

    it('does not let a JWT-authenticated user claim an agent identity', async () => {
        const req = makeRequest({
            authType: 'jwt',
            agent: undefined,
            headers: {
                'x-agent-id': 'trusted-agent',
                'x-channel-id': 'trusted-channel'
            }
        });
        const { response, status } = makeResponse();

        await executeTool(req, response);

        expect(status).toHaveBeenCalledWith(403);
        expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('rejects a missing authenticated principal', async () => {
        const req = makeRequest({ authType: undefined, agent: undefined });
        const { response, status } = makeResponse();

        await executeTool(req, response);

        expect(status).toHaveBeenCalledWith(401);
        expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('maps final-boundary authorization failures to HTTP 403', async () => {
        mockExecuteTool.mockReturnValue(throwError(() => new ToolAuthorizationError(
            "Agent 'ghost-agent' is not registered and cannot execute MCP tools"
        )));
        const req = makeRequest();
        const { response, status, json } = makeResponse();

        await executeTool(req, response);

        expect(status).toHaveBeenCalledWith(403);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            error: expect.stringContaining('not registered')
        }));
    });

    it('loads the exact key-bound channel policy before execution', async () => {
        const req = makeRequest();
        const { response } = makeResponse();

        await executeTool(req, response);

        expect(mockLoadActiveChannelRuntimePolicy).toHaveBeenCalledWith('trusted-channel');
        expect(mockLoadActiveChannelRuntimePolicy.mock.invocationCallOrder[0])
            .toBeLessThan(mockExecuteTool.mock.invocationCallOrder[0]);
    });

    it('does not execute for a missing or inactive key-bound channel', async () => {
        mockLoadActiveChannelRuntimePolicy.mockResolvedValue(null);
        const req = makeRequest();
        const { response, status } = makeResponse();

        await executeTool(req, response);

        expect(status).toHaveBeenCalledWith(403);
        expect(mockExecuteTool).not.toHaveBeenCalled();
    });
});

describe('mcpController.registerTool provider integrity', () => {
    it('fails explicitly without persisting a simulated executable tool', async () => {
        const req = {
            authType: 'jwt',
            user: { id: 'admin-1', role: 'admin' },
            body: {
                name: 'unreachable-provider-tool',
                description: 'Would have no provider invocation path',
                inputSchema: { type: 'object' }
            },
            headers: { 'x-channel-id': 'trusted-channel' }
        } as unknown as Request;
        const { response, status, json } = makeResponse();

        await registerTool(req, response);

        expect(status).toHaveBeenCalledWith(501);
        expect(json).toHaveBeenCalledWith({
            success: false,
            code: 'MCP_PROVIDER_INVOCATION_UNAVAILABLE',
            message: expect.stringContaining('no authenticated provider invocation protocol')
        });
        expect(McpToolRegistry.getInstance).not.toHaveBeenCalled();
    });
});
