/** Operator filesystem admission uses real manager provenance and actual discovery policies. */
const mockHandlers = new Map<string, (payload: unknown) => void>();
const mockEmit = jest.fn();
const mockListAllMcpTools = jest.fn();

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        error = jest.fn(); warn = jest.fn(); info = jest.fn(); debug = jest.fn(); trace = jest.fn();
    }
}));
jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: {
        on: jest.fn((name: string, handler: (payload: unknown) => void) => {
            mockHandlers.set(name, handler);
            return { unsubscribe: jest.fn() };
        }), emit: mockEmit
    } }
}));
jest.mock('@mxf-dev/core/models/mcpTool', () => ({
    listAllMcpTools: mockListAllMcpTools,
    createMcpTool: jest.fn(), findMcpToolByName: jest.fn(),
    updateMcpTool: jest.fn(), deleteMcpTool: jest.fn()
}));
jest.mock('@mxf-dev/core/services/McpToolDocumentationService', () => ({
    McpToolDocumentationService: { getInstance: (): object => ({ registerTool: jest.fn() }) }
}));
jest.mock('@mxf-dev/core/services/AutoCorrectionService', () => ({
    AutoCorrectionService: { getInstance: (): object => ({}) }
}));
jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: { getInstance: (): object => ({ getAgent: (): undefined => undefined }) }
}));
jest.mock('../../../src/server/socket/services/TaskService', () => ({ TaskService: {} }));
jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({ SystemLlmServiceManager: {} }));
jest.mock('../../../src/server/mcp/tools/index', () => ({ mxfMcpToolRegistry: new Map() }));

import { firstValueFrom, of, type Observable } from 'rxjs';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { ExternalMcpServerManager } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';
import { McpToolRegistry, type ExtendedMcpToolDefinition } from '../../../src/server/api/services/McpToolRegistry';
import { HybridMcpToolRegistry } from '../../../src/server/mcp/services/HybridMcpToolRegistry';
import { clearHybridMcpToolRegistry, setHybridMcpToolRegistry } from '../../../src/server/mcp/services/HybridMcpRegistryAccess';
import { McpService } from '../../../src/server/socket/services/McpService';
import {
    isPrivilegedHostToolEnabled,
    UNSAFE_HOST_TOOLS_ENV,
    UNSAFE_NETWORK_TOOLS_ENV,
    type PrivilegedHostToolDescriptor
} from '../../../src/server/socket/services/ToolAuthorizationPolicy';
import { tools_validate } from '../../../src/server/mcp/tools/MetaTools';

const agentId = 'agent-a';
const channelId = 'channel-a';
const serverId = 'filesystem:agent-a';
const names = new Set(['read_file', `${serverId}__read_file`]);
const genuine: PrivilegedHostToolDescriptor = {
    isExternal: true, operatorAgentFilesystem: true,
    source: serverId, scope: 'agent', scopeId: agentId
};

interface ManagerFixtureState {
    servers: Map<string, {
        operatorAgentFilesystemOwner?: string;
        status: { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };
    }>;
    serverScopes: Map<string, { scope: 'agent' | 'channel' | 'global'; scopeId?: string }>;
}

const context = (principal: string, allowedTools: string[]): {
    agentId: string; channelId: string; requestId: string;
    authorization: { keyId: string; allowedTools: string[] };
} => ({
    agentId: principal, channelId, requestId: 'request-a',
    authorization: { keyId: 'key-a', allowedTools }
});

describe('operator agent filesystem host authorization', () => {
    let manager: ExternalMcpServerManager;
    let state: ManagerFixtureState;
    let registry: HybridMcpToolRegistry;
    let apiRegistry: McpToolRegistry;
    let service: McpService;
    let priorService: McpService | null;
    let priorHost: string | undefined;
    let priorNetwork: string | undefined;
    const singleton = McpService as unknown as { instance: McpService | null };

    beforeEach(async () => {
        jest.clearAllMocks();
        mockHandlers.clear();
        priorHost = process.env[UNSAFE_HOST_TOOLS_ENV];
        priorNetwork = process.env[UNSAFE_NETWORK_TOOLS_ENV];
        delete process.env[UNSAFE_HOST_TOOLS_ENV];
        delete process.env[UNSAFE_NETWORK_TOOLS_ENV];
        mockListAllMcpTools.mockResolvedValue([]);
        priorService = singleton.instance;
        singleton.instance = null;
        McpToolRegistry.resetInstance();

        // Seed the private registration records; no subprocess is started. The
        // actual manager methods derive discovery provenance and verify ownership.
        manager = new ExternalMcpServerManager({ skipServerEventHandlers: true });
        state = manager as unknown as ManagerFixtureState;
        state.servers.set(serverId, {
            operatorAgentFilesystemOwner: agentId,
            status: { tools: [{ name: 'read_file', description: 'Read a rooted file', inputSchema: {} }] }
        });
        state.serverScopes.set(serverId, { scope: 'agent', scopeId: agentId });
        const internal = {
            listInternalTools: (): Observable<ExtendedMcpToolDefinition[]> => of([])
        } as unknown as McpToolRegistry;
        registry = new HybridMcpToolRegistry(internal, manager);
        setHybridMcpToolRegistry(registry);
        apiRegistry = McpToolRegistry.getInstance();
        apiRegistry.registerExternalToolsProvider(() => registry.getExternalTools());
        await firstValueFrom(apiRegistry.listInternalTools());
        service = McpService.getInstance();
        apiRegistry.registerChannelToolPolicyReader(id => service.getChannelAllowedTools(id));
        await service.initialize();
        service.hydrateChannelAllowedTools(channelId, ['read_file']);
    });

    afterEach(async () => {
        await registry.shutdown();
        clearHybridMcpToolRegistry();
        apiRegistry.clearExternalToolsProvider();
        McpToolRegistry.resetInstance();
        singleton.instance = priorService;
        if (priorHost === undefined) delete process.env[UNSAFE_HOST_TOOLS_ENV];
        else process.env[UNSAFE_HOST_TOOLS_ENV] = priorHost;
        if (priorNetwork === undefined) delete process.env[UNSAFE_NETWORK_TOOLS_ENV];
        else process.env[UNSAFE_NETWORK_TOOLS_ENV] = priorNetwork;
    });

    const listedByRequest = (principal: string, allowedTools: string[]): string[] => {
        mockEmit.mockClear();
        mockHandlers.get(Events.Mcp.TOOL_LIST)!({
            ...createBaseEventPayload(Events.Mcp.TOOL_LIST, principal, channelId, {
                requestId: 'list-1'
            }),
            authorization: { keyId: 'key-a', allowedTools }
        });
        const result = mockEmit.mock.calls.find(([event]) => event === Events.Mcp.TOOL_LIST_RESULT);
        expect(result).toBeDefined();
        return result![1].data.tools.map((tool: { name: string }) => tool.name);
    };

    it('admits only the exact owner with current private manager provenance', () => {
        expect(manager.getAllExternalTools()[0].operatorAgentFilesystem).toBe(true);
        expect(isPrivilegedHostToolEnabled(names, genuine, agentId)).toBe(true);
        expect(isPrivilegedHostToolEnabled(names, genuine, 'agent-b')).toBe(false);
        expect(isPrivilegedHostToolEnabled(names, genuine)).toBe(false);
        expect(isPrivilegedHostToolEnabled(names)).toBe(false);
        state.servers.get(serverId)!.operatorAgentFilesystemOwner = undefined;
        expect(isPrivilegedHostToolEnabled(names, genuine, agentId)).toBe(false);
    });

    it.each([
        { isExternal: false }, { operatorAgentFilesystem: false },
        { scope: 'global' }, { scope: 'channel' }, { scopeId: 'agent-b' },
        { source: 'filesystem:forged' }, { source: '' }
    ])('rejects a descriptor missing one required ownership condition %#', overrides => {
        expect(isPrivilegedHostToolEnabled(names, { ...genuine, ...overrides }, agentId)).toBe(false);
    });

    it('does not promote names or metadata into trusted provenance', () => {
        const forged = {
            isExternal: true, source: serverId, scope: 'agent', scopeId: agentId,
            metadata: { operatorAgentFilesystem: true, source: serverId, owner: agentId }
        };
        expect(isPrivilegedHostToolEnabled(names, forged, agentId)).toBe(false);
        expect(isPrivilegedHostToolEnabled(new Set(['filesystem__read_file']))).toBe(false);
        clearHybridMcpToolRegistry();
        expect(isPrivilegedHostToolEnabled(names, genuine, agentId)).toBe(false);
    });

    it('requires the real manager agent scope even when the descriptor claims it', () => {
        state.serverScopes.set(serverId, { scope: 'channel', scopeId: agentId });
        expect(isPrivilegedHostToolEnabled(names, genuine, agentId)).toBe(false);
        state.serverScopes.set(serverId, { scope: 'global' });
        expect(isPrivilegedHostToolEnabled(names, genuine, agentId)).toBe(false);
    });

    it('keeps the existing explicit host opt-in and strict configuration behavior', () => {
        process.env[UNSAFE_HOST_TOOLS_ENV] = 'false';
        expect(isPrivilegedHostToolEnabled(names, genuine, agentId)).toBe(true);
        expect(isPrivilegedHostToolEnabled(new Set(['shell_execute']))).toBe(false);
        process.env[UNSAFE_HOST_TOOLS_ENV] = 'true';
        expect(isPrivilegedHostToolEnabled(new Set(['shell_execute']))).toBe(true);
        expect(isPrivilegedHostToolEnabled(names, genuine, 'agent-b')).toBe(true);
        process.env[UNSAFE_HOST_TOOLS_ENV] = 'TRUE';
        expect(() => isPrivilegedHostToolEnabled(names, genuine, agentId)).toThrow(/exactly/);
    });

    it('preserves provenance through registry composition, socket discovery, and meta-tool checks', async () => {
        const composed = await firstValueFrom(apiRegistry.listToolsForChannel(channelId, undefined, agentId));
        expect(composed[0]).toEqual(expect.objectContaining(genuine));
        expect(service.getTools({ channelId, agentId, allowedTools: ['read_file'] }).map(tool => tool.name))
            .toEqual(['read_file']);
        expect(listedByRequest(agentId, ['read_file'])).toEqual(['read_file']);
        expect(await tools_validate.handler({ toolNames: ['read_file'] }, context(agentId, ['read_file'])))
            .toEqual(expect.objectContaining({ availableCount: 1 }));
        expect(service.getTools({ channelId, agentId: 'agent-b', allowedTools: ['read_file'] })).toEqual([]);
        expect(listedByRequest('agent-b', ['read_file'])).toEqual([]);
        expect(await tools_validate.handler({ toolNames: ['read_file'] }, context('agent-b', ['read_file'])))
            .toEqual(expect.objectContaining({ availableCount: 0 }));
        expect(await firstValueFrom(apiRegistry.listTools())).toEqual([]);
    });

    it('does not override an empty credential grant or a restrictive channel grant', async () => {
        expect(service.getTools({ channelId, agentId, allowedTools: [] })).toEqual([]);
        expect(listedByRequest(agentId, [])).toEqual([]);
        expect(await tools_validate.handler({ toolNames: ['read_file'] }, context(agentId, [])))
            .toEqual(expect.objectContaining({ availableCount: 0 }));
        service.hydrateChannelAllowedTools(channelId, ['task_complete']);
        expect(listedByRequest(agentId, ['read_file'])).toEqual([]);
        expect(service.getTools({ channelId, agentId, allowedTools: ['read_file'] })).toEqual([]);
        expect(await tools_validate.handler({ toolNames: ['read_file'] }, context(agentId, ['read_file'])))
            .toEqual(expect.objectContaining({ availableCount: 0 }));
    });

    it.each(['missing channel', 'missing reader'])('fails closed with a correlated discovery error for %s', missing => {
        if (missing === 'missing channel') service.clearChannelAllowedTools(channelId);
        else apiRegistry.clearChannelToolPolicyReader();
        mockEmit.mockClear();
        mockHandlers.get(Events.Mcp.TOOL_LIST)!({
            ...createBaseEventPayload(Events.Mcp.TOOL_LIST, agentId, channelId, { requestId: 'missing-policy' }),
            authorization: { keyId: 'key-a', allowedTools: ['read_file'] }
        });
        expect(mockEmit).toHaveBeenCalledWith(Events.Mcp.TOOL_LIST_ERROR, expect.objectContaining({
            agentId, channelId, data: { requestId: 'missing-policy', error: expect.stringContaining('has not been loaded') }
        }));
        expect(mockEmit.mock.calls.some(([event]) => event === Events.Mcp.TOOL_LIST_RESULT)).toBe(false);
    });

    it('overwrites forged internal provenance instead of granting an external exception', async () => {
        const internal = {
            listInternalTools: (): Observable<ExtendedMcpToolDefinition[]> => of([{
                ...genuine,
                name: 'read_file', description: 'Internal tool with forged fields', inputSchema: {},
                enabled: true, providerId: 'internal', channelId: 'system',
                handler: async () => ({ content: { type: 'text', data: 'internal' } })
            }])
        } as unknown as McpToolRegistry;
        const forgedRegistry = new HybridMcpToolRegistry(internal, manager);
        try {
            const tool = forgedRegistry.getAgentFacingToolsForChannel(channelId, agentId)[0];
            expect(tool).toEqual(expect.objectContaining({
                isExternal: false, operatorAgentFilesystem: false, source: 'internal'
            }));
            expect(isPrivilegedHostToolEnabled(names, tool, agentId)).toBe(false);
        } finally {
            await forgedRegistry.shutdown();
        }
    });

    it('keeps the network opt-in gate independent of filesystem provenance', async () => {
        state.servers.get(serverId)!.status.tools.push({
            name: 'api_fetch', description: 'Unexpected network tool', inputSchema: {}
        });
        await registry.shutdown();
        registry = new HybridMcpToolRegistry({
            listInternalTools: (): Observable<ExtendedMcpToolDefinition[]> => of([])
        } as unknown as McpToolRegistry, manager);
        setHybridMcpToolRegistry(registry);
        service.hydrateChannelAllowedTools(channelId, ['read_file', 'api_fetch']);
        expect(service.getTools({ channelId, agentId, allowedTools: ['api_fetch'] })).toEqual([]);
        expect(listedByRequest(agentId, ['api_fetch'])).toEqual([]);
        expect(await tools_validate.handler({ toolNames: ['api_fetch'] }, context(agentId, ['api_fetch'])))
            .toEqual(expect.objectContaining({ availableCount: 0 }));
        process.env[UNSAFE_NETWORK_TOOLS_ENV] = 'true';
        expect(service.getTools({ channelId, agentId, allowedTools: ['api_fetch'] }).map(tool => tool.name))
            .toEqual(['api_fetch']);
    });

    it('does not retain an exception through cached descriptors after ownership is revoked', async () => {
        expect(listedByRequest(agentId, ['read_file'])).toEqual(['read_file']);
        state.servers.delete(serverId);
        expect(listedByRequest(agentId, ['read_file'])).toEqual([]);
        expect(service.getTools({ channelId, agentId, allowedTools: ['read_file'] })).toEqual([]);
        expect(await tools_validate.handler({ toolNames: ['read_file'] }, context(agentId, ['read_file'])))
            .toEqual(expect.objectContaining({ availableCount: 0 }));
    });
});
