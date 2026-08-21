import { of } from 'rxjs';
import { Request, Response } from 'express';

const mockReadPrincipal = jest.fn();
const mockAuthorize = jest.fn();
const mockListTools = jest.fn();
const mockListToolsForChannel = jest.fn();
const mockGetExternalServerStatuses = jest.fn();
const mockGetServersByScope = jest.fn();
const mockGetServerStatusById = jest.fn();
const mockUnregisterServer = jest.fn();
const mockGetService = jest.fn();

jest.mock('../../../src/server/api/services/AuthorizationService', () => ({
    authorizationService: {
        readPrincipal: mockReadPrincipal,
        authorize: mockAuthorize
    }
}));

jest.mock('../../../src/server/api/services/McpToolRegistry', () => ({
    McpToolRegistry: {
        getInstance: (): {
            listTools: typeof mockListTools;
            listToolsForChannel: typeof mockListToolsForChannel;
        } => ({
            listTools: mockListTools,
            listToolsForChannel: mockListToolsForChannel
        })
    }
}));

jest.mock('../../../src/server/api/services/ServerHybridMcpService', () => ({
    ServerHybridMcpService: {
        getInstance: mockGetService
    }
}));

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: (): {
        assertIsNonEmptyString: jest.Mock;
        assertIsArray: jest.Mock;
    } => ({
        assertIsNonEmptyString: jest.fn(),
        assertIsArray: jest.fn()
    })
}));

jest.mock('@mxf-dev/core/protocols/mcp/security/ExternalMcpRegistrationPolicy', () => ({
    assertUnsafeStdioMcpEnabled: jest.fn()
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import {
    getAllTools,
    getExternalServers,
    getServerStatus,
    unregisterExternalServer
} from '../../../src/server/api/controllers/hybridMcpController';

const makeResponse = (): Response => {
    const response: Partial<Response> = {};
    response.status = jest.fn().mockReturnValue(response);
    response.json = jest.fn().mockReturnValue(response);
    return response as Response;
};

const status = (id: string): {
    id: string;
    name: string;
    status: string;
    restartCount: number;
    tools: never[];
} => ({
    id,
    name: id,
    status: 'running',
    restartCount: 0,
    tools: []
});

describe('hybrid MCP controller scoping', () => {
    const manager = {
        getServersByScope: mockGetServersByScope,
        getServerStatusById: mockGetServerStatusById,
        unregisterServer: mockUnregisterServer
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthorize.mockResolvedValue({ allowed: true, resource: { channelId: 'chan-alpha' } });
        mockGetExternalServerStatuses.mockReturnValue({
            global: status('global'),
            alpha: status('alpha'),
            beta: status('beta')
        });
        mockGetServersByScope.mockImplementation((scope: string, scopeId?: string) => {
            if (scope === 'global') return [status('global')];
            if (scope === 'channel' && scopeId === 'chan-alpha') return [status('alpha')];
            if (scope === 'agent' && scopeId === 'alpha-agent') return [status('agent-alpha')];
            return [];
        });
        mockGetServerStatusById.mockImplementation((id: string) => status(id));
        mockUnregisterServer.mockResolvedValue(undefined);
        mockGetService.mockReturnValue({
            getExternalServerManager: () => manager,
            getExternalServerStatuses: mockGetExternalServerStatuses
        });
        mockListTools.mockReturnValue(of([]));
        mockListToolsForChannel.mockImplementation(
            (_channelId: string, _filter?: string, agentId?: string) => of([
                {
                    name: 'core_tool',
                    description: 'Core',
                    inputSchema: {},
                    enabled: true,
                    providerId: 'mxf-server',
                    channelId: 'system'
                },
                {
                    name: 'alpha_provider_tool',
                    description: 'Alpha provider',
                    inputSchema: {},
                    enabled: true,
                    providerId: 'alpha-agent',
                    channelId: 'chan-alpha'
                },
                {
                    name: 'fetch_news',
                    description: 'Alpha external',
                    inputSchema: {},
                    enabled: true,
                    providerId: 'external-mcp:alpha-news',
                    channelId: 'chan-alpha',
                    metadata: {
                        canonicalName: 'alpha-news__fetch_news',
                        externalSource: 'alpha-news',
                        externalScope: 'channel'
                    }
                },
                ...(agentId === 'alpha-agent' ? [{
                    name: 'search_private_notes',
                    description: 'Agent external',
                    inputSchema: {},
                    enabled: true,
                    providerId: 'external-mcp:alpha-private',
                    channelId: 'chan-alpha',
                    metadata: {
                        canonicalName: 'alpha-private__search_private_notes',
                        externalSource: 'alpha-private',
                        externalScope: 'agent'
                    }
                }] : [])
            ])
        );
    });

    it('rejects a non-admin global topology request before touching services', async () => {
        mockReadPrincipal.mockReturnValue({ kind: 'user', userId: 'user-1', role: 'consumer' });
        const req = { params: {} } as Request;
        const res = makeResponse();

        await getAllTools(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockGetService).not.toHaveBeenCalled();
        expect(mockListTools).not.toHaveBeenCalled();
    });

    it('uses the exact authorized channel view and preserves raw/canonical external names', async () => {
        mockReadPrincipal.mockReturnValue({
            kind: 'agent',
            agentId: 'alpha-agent',
            channelId: 'chan-alpha',
            keyId: 'key-alpha'
        });
        const req = { params: { channelId: 'chan-alpha' } } as unknown as Request;
        const res = makeResponse();

        await getAllTools(req, res);

        expect(mockAuthorize).toHaveBeenCalledWith(
            'access',
            'channel',
            'chan-alpha',
            expect.objectContaining({ agentId: 'alpha-agent' })
        );
        expect(mockListToolsForChannel).toHaveBeenCalledWith(
            'chan-alpha',
            undefined,
            'alpha-agent'
        );
        expect(mockListTools).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                external: expect.arrayContaining([
                    expect.objectContaining({
                        name: 'fetch_news',
                        canonicalName: 'alpha-news__fetch_news',
                        serverId: 'alpha-news'
                    }),
                    expect.objectContaining({
                        name: 'search_private_notes',
                        canonicalName: 'alpha-private__search_private_notes',
                        serverId: 'alpha-private'
                    })
                ])
            })
        }));
    });

    it('returns global, exact-channel, and exact-agent server status entries to an agent key', async () => {
        mockReadPrincipal.mockReturnValue({
            kind: 'agent',
            agentId: 'alpha-agent',
            channelId: 'chan-alpha',
            keyId: 'key-alpha'
        });
        const req = { params: { channelId: 'chan-alpha' } } as unknown as Request;
        const res = makeResponse();

        await getExternalServers(req, res);

        expect(mockGetExternalServerStatuses).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            count: 3,
            data: {
                global: expect.objectContaining({ id: 'global' }),
                alpha: expect.objectContaining({ id: 'alpha' }),
                'agent-alpha': expect.objectContaining({ id: 'agent-alpha' })
            }
        }));
    });

    it('omits agent-scoped tools and servers for a JWT channel owner', async () => {
        mockReadPrincipal.mockReturnValue({
            kind: 'user',
            userId: 'owner-user',
            role: 'consumer'
        });
        const req = { params: { channelId: 'chan-alpha' } } as unknown as Request;
        const toolsRes = makeResponse();
        const serversRes = makeResponse();

        await getAllTools(req, toolsRes);
        await getExternalServers(req, serversRes);

        expect(mockListToolsForChannel).toHaveBeenCalledWith(
            'chan-alpha',
            undefined,
            undefined
        );
        const toolsBody = (toolsRes.json as jest.Mock).mock.calls[0][0];
        expect(toolsBody.data.external.map((tool: { name: string }) => tool.name))
            .toEqual(['fetch_news']);
        expect(mockGetServersByScope).not.toHaveBeenCalledWith('agent', expect.anything());
        expect(serversRes.json).toHaveBeenCalledWith(expect.objectContaining({
            count: 2,
            data: {
                global: expect.objectContaining({ id: 'global' }),
                alpha: expect.objectContaining({ id: 'alpha' })
            }
        }));
    });

    it('allows an agent to read the status of its exact agent-scoped server', async () => {
        mockReadPrincipal.mockReturnValue({
            kind: 'agent',
            agentId: 'alpha-agent',
            channelId: 'chan-alpha',
            keyId: 'key-alpha'
        });
        const req = {
            params: { channelId: 'chan-alpha', serverId: 'agent-alpha' }
        } as unknown as Request;
        const res = makeResponse();

        await getServerStatus(req, res);

        expect(mockGetServerStatusById).toHaveBeenCalledWith('agent-alpha');
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            status: expect.objectContaining({ id: 'agent-alpha' })
        });
    });

    it('hides an out-of-scope server id rather than revealing its status', async () => {
        mockReadPrincipal.mockReturnValue({
            kind: 'agent',
            agentId: 'alpha-agent',
            channelId: 'chan-alpha',
            keyId: 'key-alpha'
        });
        const req = {
            params: { channelId: 'chan-alpha', serverId: 'beta' }
        } as unknown as Request;
        const res = makeResponse();

        await getServerStatus(req, res);

        expect(mockGetServerStatusById).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('uses the manager unregistration path instead of merely stopping a server', async () => {
        mockReadPrincipal.mockReturnValue({ kind: 'user', userId: 'admin-1', role: 'admin' });
        const req = { params: { serverId: 'global' } } as unknown as Request;
        const res = makeResponse();

        await unregisterExternalServer(req, res);

        expect(mockGetServerStatusById).toHaveBeenCalledWith('global');
        expect(mockUnregisterServer).toHaveBeenCalledWith('global');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
});
