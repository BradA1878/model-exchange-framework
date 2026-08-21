/**
 * McpToolRegistry composition boundaries.
 *
 * The hybrid registry consumes listInternalTools(), while context-free
 * administrative listing may add global external tools. Channel-scoped
 * external tools must never be projected into that global view or fed back as
 * internal tools on the next hybrid refresh.
 */

import { of, firstValueFrom } from 'rxjs';

const mockEventHandlers = new Map<string, (payload: unknown) => void>();
const mockEventEmit = jest.fn();
const mockListAllMcpTools = jest.fn();
const mockDeleteMcpTool = jest.fn();
const mockCoreHandler = jest.fn(async () => ({ content: { type: 'text', data: 'ok' } }));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn((event: string, handler: (payload: unknown) => void) => {
                mockEventHandlers.set(event, handler);
                return { unsubscribe: jest.fn() };
            }),
            emit: mockEventEmit
        }
    }
}));

jest.mock('@mxf-dev/core/models/mcpTool', () => ({
    createMcpTool: jest.fn().mockResolvedValue({}),
    findMcpToolByName: jest.fn(),
    updateMcpTool: jest.fn().mockResolvedValue({}),
    deleteMcpTool: mockDeleteMcpTool,
    listAllMcpTools: mockListAllMcpTools
}));

jest.mock('@mxf-dev/core/services/McpToolDocumentationService', () => ({
    McpToolDocumentationService: {
        getInstance: jest.fn().mockReturnValue({
            registerTool: jest.fn(),
            unregisterTool: jest.fn()
        })
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('../../../src/server/mcp/tools/index', () => {
    return {
        mxfMcpToolRegistry: new Map([
            ['core_tool', {
                name: 'core_tool',
                description: 'Core tool',
                inputSchema: { type: 'object', properties: {} },
                handler: mockCoreHandler
            }]
        ])
    };
});

import { Events } from '@mxf-dev/core/events/EventNames';
import { McpToolRegistry } from '../../../src/server/api/services/McpToolRegistry';

const handler = async (): Promise<{ content: { type: string; data: string } }> => ({
    content: { type: 'text', data: 'ok' }
});

describe('McpToolRegistry composition', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEventHandlers.clear();
        mockListAllMcpTools.mockResolvedValue([{
            name: 'core_tool',
            description: 'stored description',
            inputSchema: {},
            enabled: true,
            providerId: 'mxf-server',
            channelId: 'system',
            parameters: [],
            metadata: {}
        }]);
        mockDeleteMcpTool.mockResolvedValue(true);
        McpToolRegistry.resetInstance();
    });

    it('keeps the internal view provider-free and composes global externals only', async () => {
        const registry = McpToolRegistry.getInstance();
        const provider = jest.fn().mockReturnValue([
            {
                name: 'chan-alpha:news__fetch_news',
                canonicalName: 'chan-alpha:news__fetch_news',
                externalToolName: 'fetch_news',
                description: 'Channel news',
                inputSchema: { type: 'object', properties: {} },
                handler,
                enabled: true,
                metadata: {},
                source: 'chan-alpha:news',
                scope: 'channel',
                scopeId: 'chan-alpha'
            },
            {
                name: 'global-search__lookup',
                canonicalName: 'global-search__lookup',
                externalToolName: 'lookup',
                description: 'Global lookup',
                inputSchema: { type: 'object', properties: {} },
                handler,
                enabled: true,
                metadata: {},
                source: 'global-search',
                scope: 'global'
            },
            // Repeated provider snapshots remain one canonical entry.
            {
                name: 'global-search__lookup',
                canonicalName: 'global-search__lookup',
                externalToolName: 'lookup',
                description: 'Global lookup',
                inputSchema: { type: 'object', properties: {} },
                handler,
                enabled: true,
                metadata: {},
                source: 'global-search',
                scope: 'global'
            }
        ]);
        registry.registerExternalToolsProvider(provider);

        const internal = await firstValueFrom(registry.listInternalTools());
        expect(internal.map(tool => tool.name)).toEqual(['core_tool']);
        expect(provider).not.toHaveBeenCalled();

        const composed = await firstValueFrom(registry.listTools());
        expect(composed.map(tool => tool.name)).toEqual([
            'core_tool',
            'global-search__lookup'
        ]);
        expect(composed.find(tool => tool.name === 'global-search__lookup'))
            .toEqual(expect.objectContaining({
                providerId: 'external-mcp:global-search',
                channelId: 'global'
            }));
        expect(composed.map(tool => tool.name)).not.toContain('chan-alpha:news__fetch_news');

        registry.clearExternalToolsProvider();
        const afterDetach = await firstValueFrom(registry.listTools());
        expect(afterDetach.map(tool => tool.name)).toEqual(['core_tool']);
    });

    it('layers trusted execution identity after optional context data', async () => {
        const registry = McpToolRegistry.getInstance();
        const [coreTool] = await firstValueFrom(registry.listInternalTools());

        await coreTool.handler({}, {
            requestId: 'trusted-request',
            agentId: 'trusted-agent',
            channelId: 'trusted-channel',
            authorization: {
                keyId: 'trusted-key',
                allowedTools: ['core_tool']
            },
            data: {
                requestId: 'forged-request',
                agentId: 'forged-agent',
                channelId: 'forged-channel',
                authorization: { keyId: 'forged-key', allowedTools: [] }
            }
        });

        expect(mockCoreHandler).toHaveBeenCalledWith({}, expect.objectContaining({
            requestId: 'trusted-request',
            agentId: 'trusted-agent',
            channelId: 'trusted-channel',
            authorization: {
                keyId: 'trusted-key',
                allowedTools: ['core_tool']
            }
        }));
    });

    it('fails dynamic socket registration closed with one authoritative response', () => {
        const registry = McpToolRegistry.getInstance();
        const registerSpy = jest.spyOn(registry, 'registerTool').mockReturnValue(of(true));
        const registrationHandler = mockEventHandlers.get(Events.Mcp.TOOL_REGISTER);

        expect(registrationHandler).toBeDefined();
        registrationHandler!({
            agentId: 'provider-agent',
            channelId: 'chan-alpha',
            data: {
                toolName: 'provider_tool',
                description: 'Provider tool',
                inputSchema: { type: 'object', properties: {} },
                metadata: {}
            }
        });

        expect(registerSpy).not.toHaveBeenCalled();
        const responses = mockEventEmit.mock.calls.filter(
            ([event]) => event === Events.Mcp.TOOL_REGISTERED
        );
        expect(responses).toHaveLength(1);
        expect(responses[0][1]).toEqual(expect.objectContaining({
            agentId: 'provider-agent',
            channelId: 'chan-alpha',
            data: expect.objectContaining({
                toolName: 'provider_tool',
                success: false,
                error: expect.stringContaining('provider invocation is not implemented')
            })
        }));
    });

    it('keeps context-free listings global and isolates channel/provider tools', async () => {
        mockListAllMcpTools.mockResolvedValue([
            {
                name: 'core_tool',
                description: 'Core tool',
                inputSchema: {},
                enabled: true,
                providerId: 'mxf-server',
                channelId: 'system',
                parameters: [],
                metadata: {}
            },
            {
                name: 'alpha_provider_tool',
                description: 'Alpha provider tool',
                inputSchema: {},
                enabled: true,
                providerId: 'alpha-agent',
                channelId: 'chan-alpha',
                parameters: [],
                metadata: {}
            },
            {
                name: 'beta_provider_tool',
                description: 'Beta provider tool',
                inputSchema: {},
                enabled: true,
                providerId: 'beta-agent',
                channelId: 'chan-beta',
                parameters: [],
                metadata: {}
            }
        ]);
        const registry = McpToolRegistry.getInstance();
        registry.registerExternalToolsProvider(() => [
            {
                name: 'global-search__lookup',
                canonicalName: 'global-search__lookup',
                externalToolName: 'lookup',
                description: 'Global lookup',
                inputSchema: {},
                handler,
                enabled: true,
                metadata: {},
                source: 'global-search',
                scope: 'global'
            },
            {
                name: 'alpha-news__fetch_news',
                canonicalName: 'alpha-news__fetch_news',
                externalToolName: 'fetch_news',
                description: 'Alpha news',
                inputSchema: {},
                handler,
                enabled: true,
                metadata: {},
                source: 'alpha-news',
                scope: 'channel',
                scopeId: 'chan-alpha'
            },
            {
                name: 'beta-news__fetch_news',
                canonicalName: 'beta-news__fetch_news',
                externalToolName: 'fetch_news',
                description: 'Beta news',
                inputSchema: {},
                handler,
                enabled: true,
                metadata: {},
                source: 'beta-news',
                scope: 'channel',
                scopeId: 'chan-beta'
            }
        ]);

        const contextFree = await firstValueFrom(registry.listTools());
        expect(contextFree.map(tool => tool.name)).toEqual([
            'core_tool',
            'global-search__lookup'
        ]);

        const alpha = await firstValueFrom(
            registry.listToolsForChannel('chan-alpha', undefined, 'alpha-agent')
        );
        const beta = await firstValueFrom(
            registry.listToolsForChannel('chan-beta', undefined, 'beta-agent')
        );

        expect(alpha.map(tool => tool.name)).toEqual([
            'alpha_provider_tool',
            'core_tool',
            'fetch_news',
            'lookup'
        ]);
        expect(beta.map(tool => tool.name)).toEqual([
            'beta_provider_tool',
            'core_tool',
            'fetch_news',
            'lookup'
        ]);
        expect(alpha.find(tool => tool.name === 'fetch_news')?.metadata)
            .toEqual(expect.objectContaining({ canonicalName: 'alpha-news__fetch_news' }));
        expect(beta.find(tool => tool.name === 'fetch_news')?.metadata)
            .toEqual(expect.objectContaining({ canonicalName: 'beta-news__fetch_news' }));
    });

    it('routes TOOL_LIST through the authenticated channel view', () => {
        const registry = McpToolRegistry.getInstance();
        const globalListSpy = jest.spyOn(registry, 'listTools');
        const channelListSpy = jest.spyOn(registry, 'listToolsForChannel').mockReturnValue(of([
            {
                name: 'alpha_provider_tool',
                description: 'Alpha provider tool',
                inputSchema: {},
                enabled: true,
                providerId: 'alpha-agent',
                channelId: 'chan-alpha',
                handler
            }
        ]));
        const listHandler = mockEventHandlers.get(Events.Mcp.TOOL_LIST);
        expect(listHandler).toBeDefined();

        listHandler!({
            agentId: 'alpha-agent',
            channelId: 'chan-alpha',
            authorization: {
                keyId: 'key-alpha',
                allowedTools: ['alpha_provider_tool']
            },
            data: { filter: 'provider', requestId: 'request-alpha' }
        });

        expect(channelListSpy).toHaveBeenCalledWith(
            'chan-alpha',
            'provider',
            'alpha-agent'
        );
        expect(globalListSpy).not.toHaveBeenCalled();
        expect(mockEventEmit).toHaveBeenCalledWith(
            Events.Mcp.TOOL_LIST_RESULT,
            expect.objectContaining({
                agentId: 'alpha-agent',
                channelId: 'chan-alpha',
                data: expect.objectContaining({
                    requestId: 'request-alpha',
                    tools: [expect.objectContaining({ name: 'alpha_provider_tool' })]
                })
            })
        );
    });

    it('does not expose a channel registration through context-free exact lookup', async () => {
        mockListAllMcpTools.mockResolvedValue([
            {
                name: 'core_tool',
                description: 'Core tool',
                inputSchema: {},
                enabled: true,
                providerId: 'mxf-server',
                channelId: 'system',
                parameters: [],
                metadata: {}
            },
            {
                name: 'alpha_private_tool',
                description: 'Alpha private tool',
                inputSchema: {},
                enabled: true,
                providerId: 'alpha-agent',
                channelId: 'chan-alpha',
                parameters: [],
                metadata: {}
            }
        ]);
        const registry = McpToolRegistry.getInstance();

        await expect(firstValueFrom(registry.getTool('core_tool')))
            .resolves.toEqual(expect.objectContaining({ name: 'core_tool' }));
        await expect(firstValueFrom(registry.getTool('alpha_private_tool')))
            .rejects.toThrow('does not exist');
        await expect(firstValueFrom(
            registry.listToolsForChannel('chan-alpha', undefined, 'alpha-agent')
        )).resolves.toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'alpha_private_tool' })
        ]));
    });

    it('fails closed when an event tries to unregister another owner or a core tool', async () => {
        mockListAllMcpTools.mockResolvedValue([
            {
                name: 'core_tool',
                description: 'Core tool',
                inputSchema: {},
                enabled: true,
                providerId: 'mxf-server',
                channelId: 'system',
                parameters: [],
                metadata: {}
            },
            {
                name: 'alpha_provider_tool',
                description: 'Alpha provider tool',
                inputSchema: {},
                enabled: true,
                providerId: 'alpha-agent',
                channelId: 'chan-alpha',
                parameters: [],
                metadata: {}
            }
        ]);
        const registry = McpToolRegistry.getInstance();
        await firstValueFrom(registry.listInternalTools());
        const unregisterHandler = mockEventHandlers.get(Events.Mcp.TOOL_UNREGISTER);
        expect(unregisterHandler).toBeDefined();

        unregisterHandler!({
            agentId: 'beta-agent',
            channelId: 'chan-beta',
            data: { toolName: 'alpha_provider_tool' }
        });
        unregisterHandler!({
            agentId: 'mxf-server',
            channelId: 'system',
            data: { toolName: 'core_tool' }
        });

        expect(mockDeleteMcpTool).not.toHaveBeenCalled();
        const rejected = mockEventEmit.mock.calls
            .filter(([event]) => event === Events.Mcp.TOOL_UNREGISTERED)
            .map(([, payload]) => payload);
        expect(rejected).toEqual(expect.arrayContaining([
            expect.objectContaining({
                agentId: 'beta-agent',
                channelId: 'chan-beta',
                data: expect.objectContaining({
                    toolName: 'alpha_provider_tool',
                    success: false
                })
            }),
            expect.objectContaining({
                data: expect.objectContaining({ toolName: 'core_tool', success: false })
            })
        ]));

        unregisterHandler!({
            agentId: 'alpha-agent',
            channelId: 'chan-alpha',
            data: { toolName: 'alpha_provider_tool' }
        });
        await Promise.resolve();
        expect(mockDeleteMcpTool).toHaveBeenCalledWith('alpha_provider_tool');
        expect(mockEventEmit).toHaveBeenCalledWith(
            Events.Mcp.TOOL_UNREGISTERED,
            expect.objectContaining({
                agentId: 'alpha-agent',
                channelId: 'chan-alpha',
                data: expect.objectContaining({
                    toolName: 'alpha_provider_tool',
                    success: true
                })
            })
        );
    });
});
