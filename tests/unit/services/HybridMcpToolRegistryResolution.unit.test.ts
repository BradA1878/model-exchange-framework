/**
 * Unit tests for HybridMcpToolRegistry external-tool name resolution and
 * eviction logging.
 *
 * Background (2026-08-04 Sentinel tool-eviction incident): since the external
 * tools were namespaced as `<serverId>__<toolName>` in the registry, every
 * consumer surface kept speaking raw tool names — agent allowlists, channel
 * allowlists, execution, and the `toolsDiscovered` result clients build their
 * configs from. Channel server ids also contain ':' (channelId:serverId),
 * which is illegal in LLM provider function names, so the namespaced name was
 * never a viable agent-facing name. These tests pin the resolution contract:
 *
 *   - the canonical (namespaced) name stays in the registry
 *   - agent-facing exposure and allowlist resolution work with raw names,
 *     channel-scoped, with internal tools always winning collisions
 *   - tools leaving the registry are logged — never silent
 */

const logSpies = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
};

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        error = logSpies.error;
        warn = logSpies.warn;
        info = logSpies.info;
        debug = logSpies.debug;
        trace = jest.fn();
        child(): MockLogger { return this; }
    }
}));

import { of } from 'rxjs';
import {
    HybridMcpToolRegistry,
    namespaceExternalTool
} from '../../../src/server/mcp/services/HybridMcpToolRegistry';
import type {
    ExtendedMcpToolDefinition,
    McpToolRegistry
} from '../../../src/server/api/services/McpToolRegistry';
import type {
    ExternalMcpServerManager,
    ExternalMcpTool
} from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';
import type { McpToolHandlerResult } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { McpEvents } from '@mxf-dev/core/events/event-definitions/McpEvents';
import {
    createExternalMcpServerEventPayload,
    createMcpToolRegistryChangedPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import type { AgentId, ChannelId } from '@mxf-dev/core/types/ChannelContext';

/** A schema-valid server lifecycle payload for triggering registry refreshes. */
function serverEventPayload(
    eventType: string
): ReturnType<typeof createExternalMcpServerEventPayload> {
    return createExternalMcpServerEventPayload(
        eventType,
        'SYSTEM' as AgentId,
        'SYSTEM' as ChannelId,
        { serverId: SERVER_ID, serverName: 'Sentinel Tools', scope: 'channel', scopeId: CHANNEL_ID }
    );
}

const CHANNEL_ID = 'chan-alpha';
const SERVER_ID = `${CHANNEL_ID}:sentinel-tools`;

interface StubExternalTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverId: string;
    scope: 'global' | 'channel' | 'agent';
    scopeId?: string;
}

interface ManagerStubState {
    tools: StubExternalTool[];
}

interface ManagerStubResult {
    state: ManagerStubState;
    manager: ExternalMcpServerManager;
}

const okHandler = async (): Promise<McpToolHandlerResult> => ({
    content: { type: 'text', data: 'ok' }
});

/** Mutable stub standing in for ExternalMcpServerManager. */
function makeManagerStub(initial: StubExternalTool[] = []): ManagerStubResult {
    const state = { tools: initial };
    return {
        state,
        manager: {
            getAllExternalTools: () => [...state.tools] as ExternalMcpTool[]
        } as unknown as ExternalMcpServerManager
    };
}

function makeInternalRegistryStub(names: string[] = ['task_complete']): McpToolRegistry {
    const tools: ExtendedMcpToolDefinition[] = names.map(name => ({
        name,
        description: `internal ${name}`,
        inputSchema: { type: 'object', properties: {} },
        enabled: true,
        providerId: 'mxf-server',
        channelId: 'system',
        handler: okHandler
    }));

    return {
        listInternalTools: () => of([...tools]),
        listTools: () => of([...tools])
    } as unknown as McpToolRegistry;
}

function externalTool(
    name: string,
    serverId: string = SERVER_ID,
    scope: 'global' | 'channel' | 'agent' = 'channel',
    scopeId?: string
): StubExternalTool {
    return {
        name,
        description: `external ${name}`,
        inputSchema: { type: 'object', properties: {} },
        serverId,
        scope,
        scopeId: scope === 'global' ? undefined : (scopeId ?? serverId.split(':')[0])
    };
}

describe('HybridMcpToolRegistry external tool resolution', () => {
    const registries: HybridMcpToolRegistry[] = [];

    function makeRegistry(
        tools: StubExternalTool[],
        internalNames?: string[]
    ): { registry: HybridMcpToolRegistry; state: ManagerStubState } {
        const { state, manager } = makeManagerStub(tools);
        const registry = new HybridMcpToolRegistry(makeInternalRegistryStub(internalNames), manager);
        registries.push(registry);
        return { registry, state };
    }

    afterEach(async () => {
        // Drain state so stale registries stop logging diffs on later refreshes,
        // then shut them down.
        while (registries.length > 0) {
            await registries.pop()!.shutdown();
        }
        jest.clearAllMocks();
    });

    describe('canonical names', () => {
        it('keeps namespaced canonical names in the channel-scoped snapshot', () => {
            const { registry } = makeRegistry([externalTool('fetch_news')]);

            const names = registry.getToolsForChannel(CHANNEL_ID).map(t => t.name);
            expect(names).toContain(namespaceExternalTool(SERVER_ID, 'fetch_news'));
        });

        it('does not feed composed external tools back as global internal tools', () => {
            const canonicalName = namespaceExternalTool(SERVER_ID, 'fetch_news');
            const coreTool = {
                name: 'task_complete',
                description: 'internal task_complete',
                inputSchema: { type: 'object', properties: {} },
                enabled: true,
                providerId: 'mxf-server',
                channelId: 'system',
                handler: okHandler
            };
            const feedbackCopy = {
                ...coreTool,
                name: canonicalName,
                description: 'incorrect composed feedback',
                providerId: 'external-mcp',
                channelId: 'global'
            };
            const internalRegistry = {
                // The hybrid registry must use this source-only view.
                listInternalTools: () => of([coreTool]),
                // This simulates the old composed list that fed the external tool
                // back as global during refreshInternalTools().
                listTools: () => of([coreTool, feedbackCopy])
            } as unknown as McpToolRegistry;
            const manager = {
                getAllExternalTools: () => [externalTool('fetch_news')]
            } as unknown as ExternalMcpServerManager;
            const registry = new HybridMcpToolRegistry(internalRegistry, manager);
            registries.push(registry);

            registry.refreshInternalTools();

            const canonicalMatches = registry.getAllToolsSnapshot()
                .filter(tool => tool.name === canonicalName);
            expect(canonicalMatches).toHaveLength(1);
            expect(canonicalMatches[0]).toEqual(expect.objectContaining({
                isExternal: true,
                scope: 'channel',
                scopeId: CHANNEL_ID
            }));
            expect(registry.getToolsForChannel('chan-other').map(tool => tool.name))
                .not.toContain(canonicalName);
        });
    });

    describe('getAgentFacingToolsForChannel', () => {
        it('exposes external channel tools under their raw names', () => {
            const { registry } = makeRegistry([externalTool('fetch_news'), externalTool('submit_post')]);

            const tools = registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            const names = tools.map(t => t.name);

            expect(names).toContain('fetch_news');
            expect(names).toContain('submit_post');
            expect(names).toContain('task_complete'); // internal untouched

            // The canonical name is preserved for execution routing
            const fetchNews = tools.find(t => t.name === 'fetch_news');
            expect(fetchNews?.canonicalName).toBe(namespaceExternalTool(SERVER_ID, 'fetch_news'));
            expect(fetchNews?.isExternal).toBe(true);
        });

        it('does not expose external tools of another channel', () => {
            const { registry } = makeRegistry([
                externalTool('fetch_news'),
                externalTool('other_tool', 'chan-beta:other-server')
            ]);

            const names = registry.getAgentFacingToolsForChannel(CHANNEL_ID).map(t => t.name);
            expect(names).toContain('fetch_news');
            expect(names).not.toContain('other_tool');
        });

        it('keeps provider-registered internal tools in their registration channel across updates', () => {
            const state = {
                tools: [
                    {
                        name: 'task_complete',
                        description: 'core tool',
                        inputSchema: { type: 'object', properties: {} },
                        enabled: true,
                        providerId: 'mxf-server',
                        channelId: 'system',
                        handler: okHandler
                    },
                    {
                        name: 'provider_tool',
                        description: 'provider v1',
                        inputSchema: { type: 'object', properties: {} },
                        enabled: true,
                        providerId: 'provider-agent',
                        channelId: CHANNEL_ID,
                        handler: okHandler
                    }
                ]
            };
            const internalRegistry = {
                listInternalTools: () => of([...state.tools]),
                listTools: () => of([...state.tools])
            } as unknown as McpToolRegistry;
            const manager = {
                getAllExternalTools: (): ExternalMcpTool[] => []
            } as unknown as ExternalMcpServerManager;
            const registry = new HybridMcpToolRegistry(internalRegistry, manager);
            registries.push(registry);

            expect(registry.getToolsForChannel(CHANNEL_ID).map(tool => tool.name))
                .toContain('provider_tool');
            expect(registry.getToolsForChannel('chan-other').map(tool => tool.name))
                .not.toContain('provider_tool');

            state.tools[1] = { ...state.tools[1], description: 'provider v2' };
            EventBus.server.emit(
                McpEvents.TOOL_REGISTRY_CHANGED,
                createMcpToolRegistryChangedPayload(
                    McpEvents.TOOL_REGISTRY_CHANGED,
                    'provider-agent' as AgentId,
                    CHANNEL_ID as ChannelId,
                    { tools: [] }
                )
            );
            expect(registry.resolveToolForChannel('provider_tool', CHANNEL_ID)?.description)
                .toBe('provider v2');

            state.tools = [state.tools[0]];
            EventBus.server.emit(
                McpEvents.TOOL_REGISTRY_CHANGED,
                createMcpToolRegistryChangedPayload(
                    McpEvents.TOOL_REGISTRY_CHANGED,
                    'provider-agent' as AgentId,
                    CHANNEL_ID as ChannelId,
                    { tools: [] }
                )
            );
            expect(registry.resolveToolForChannel('provider_tool', CHANNEL_ID)).toBeUndefined();
        });

        it('uses authoritative scope rather than punctuation in the server id', () => {
            const { registry } = makeRegistry([
                externalTool('channel_tool', 'opaque-server-id', 'channel', CHANNEL_ID),
                externalTool('global_tool', 'global:server-with-colon', 'global')
            ]);

            const alphaNames = registry.getAgentFacingToolsForChannel(CHANNEL_ID).map(t => t.name);
            const otherNames = registry.getAgentFacingToolsForChannel('chan-other').map(t => t.name);

            expect(alphaNames).toEqual(expect.arrayContaining(['channel_tool', 'global_tool']));
            expect(otherNames).toContain('global_tool');
            expect(otherNames).not.toContain('channel_tool');
        });

        it('shows agent-scoped tools only to the exact agent and gives them collision priority', () => {
            const { registry } = makeRegistry([
                externalTool('private_search', 'global-search', 'global'),
                externalTool('private_search', 'channel-search', 'channel', CHANNEL_ID),
                externalTool('private_search', 'agent-search', 'agent', 'alpha-agent')
            ]);

            const noPrincipal = registry.getAgentFacingToolsForChannel(CHANNEL_ID)
                .find(tool => tool.name === 'private_search');
            const alpha = registry.getAgentFacingToolsForChannel(CHANNEL_ID, 'alpha-agent')
                .find(tool => tool.name === 'private_search');
            const beta = registry.getAgentFacingToolsForChannel(CHANNEL_ID, 'beta-agent')
                .find(tool => tool.name === 'private_search');

            expect(noPrincipal?.source).toBe('channel-search');
            expect(alpha?.source).toBe('agent-search');
            expect(beta?.source).toBe('channel-search');
            expect(registry.resolveToolForChannel(
                'private_search',
                CHANNEL_ID,
                'alpha-agent'
            )?.source).toBe('agent-search');
        });

        it('prefers a channel-specific external tool over a global raw-name collision', () => {
            const globalServer = 'aaa-global';
            const channelServer = 'zzz-channel';
            const { registry } = makeRegistry([
                externalTool('lookup', globalServer, 'global'),
                externalTool('lookup', channelServer, 'channel', CHANNEL_ID)
            ]);

            const alpha = registry.getAgentFacingToolsForChannel(CHANNEL_ID)
                .find(tool => tool.name === 'lookup');
            const other = registry.getAgentFacingToolsForChannel('chan-other')
                .find(tool => tool.name === 'lookup');

            expect(alpha?.canonicalName).toBe(namespaceExternalTool(channelServer, 'lookup'));
            expect(other?.canonicalName).toBe(namespaceExternalTool(globalServer, 'lookup'));
        });

        it('skips an external tool whose raw name collides with an internal tool, loudly', () => {
            const { registry } = makeRegistry([externalTool('task_complete')]);

            const tools = registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            const matches = tools.filter(t => t.name === 'task_complete');

            expect(matches).toHaveLength(1);
            expect(matches[0].isExternal).toBe(false);
            expect(logSpies.error.mock.calls.map(c => String(c[0])).join('\n')).toContain('task_complete');
        });

        it('resolves raw-name collisions between two external servers deterministically, loudly', () => {
            const otherServer = `${CHANNEL_ID}:aaa-server`;
            const { registry } = makeRegistry([
                externalTool('fetch_news'),
                externalTool('fetch_news', otherServer)
            ]);

            const tools = registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            const matches = tools.filter(t => t.name === 'fetch_news');

            // Deterministic winner: lexicographically first server id
            expect(matches).toHaveLength(1);
            expect(matches[0].canonicalName).toBe(namespaceExternalTool(otherServer, 'fetch_news'));
            // Resolved by policy, not an error an operator must act on.
            expect(logSpies.warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('fetch_news');
        });

        it('logs an external-vs-external collision only once no matter how many times the channel is read', () => {
            const otherServer = `${CHANNEL_ID}:aaa-server`;
            const { registry } = makeRegistry([
                externalTool('fetch_news'),
                externalTool('fetch_news', otherServer)
            ]);

            registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            registry.getAgentFacingToolsForChannel(CHANNEL_ID);

            const collisionWarnings = logSpies.warn.mock.calls.filter(c => String(c[0]).includes('fetch_news'));
            expect(collisionWarnings).toHaveLength(1);
        });

        it('logs an external-vs-external collision again after the tool population changes', () => {
            const otherServer = `${CHANNEL_ID}:aaa-server`;
            const { registry } = makeRegistry([
                externalTool('fetch_news'),
                externalTool('fetch_news', otherServer)
            ]);

            registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            expect(
                logSpies.warn.mock.calls.filter(c => String(c[0]).includes('fetch_news'))
            ).toHaveLength(1);

            // A topology change (a new external-tool snapshot) clears the
            // reported-collisions set, even though the collision itself persists.
            (registry as unknown as { refreshExternalTools: () => void }).refreshExternalTools();

            registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            expect(
                logSpies.warn.mock.calls.filter(c => String(c[0]).includes('fetch_news'))
            ).toHaveLength(2);
        });

        it('logs an internal-vs-external collision only once no matter how many times the channel is read', () => {
            const { registry } = makeRegistry([externalTool('task_complete')]);

            registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            registry.getAgentFacingToolsForChannel(CHANNEL_ID);

            const collisionErrors = logSpies.error.mock.calls.filter(c => String(c[0]).includes('task_complete'));
            expect(collisionErrors).toHaveLength(1);
        });

        it('reports the same raw-name collision separately for each channel that has it', () => {
            const betaChannel = 'chan-beta';
            const { registry } = makeRegistry([
                externalTool('fetch_news'),
                externalTool('fetch_news', `${CHANNEL_ID}:aaa-server`),
                externalTool('fetch_news', `${betaChannel}:sentinel-tools`),
                externalTool('fetch_news', `${betaChannel}:aaa-server`)
            ]);

            registry.getAgentFacingToolsForChannel(CHANNEL_ID);
            registry.getAgentFacingToolsForChannel(betaChannel);

            const collisionWarnings = logSpies.warn.mock.calls.filter(c => String(c[0]).includes('fetch_news'));
            expect(collisionWarnings).toHaveLength(2);
            expect(collisionWarnings.some(c => String(c[0]).includes(CHANNEL_ID))).toBe(true);
            expect(collisionWarnings.some(c => String(c[0]).includes(betaChannel))).toBe(true);
        });
    });

    describe('resolveToolForChannel', () => {
        it('resolves a raw external name to its canonical tool, channel-scoped', () => {
            const { registry } = makeRegistry([externalTool('fetch_news')]);

            const tool = registry.resolveToolForChannel('fetch_news', CHANNEL_ID);
            expect(tool?.name).toBe(namespaceExternalTool(SERVER_ID, 'fetch_news'));
            expect(tool?.externalToolName).toBe('fetch_news');
        });

        it('resolves a canonical namespaced name directly', () => {
            const { registry } = makeRegistry([externalTool('fetch_news')]);

            const canonical = namespaceExternalTool(SERVER_ID, 'fetch_news');
            expect(registry.resolveToolForChannel(canonical, CHANNEL_ID)?.name).toBe(canonical);
        });

        it('prefers the internal tool when a raw name collides', () => {
            const { registry } = makeRegistry([externalTool('task_complete')]);

            const tool = registry.resolveToolForChannel('task_complete', CHANNEL_ID);
            expect(tool?.isExternal).toBe(false);
        });

        it('does not resolve an external tool for the wrong channel', () => {
            const { registry } = makeRegistry([externalTool('fetch_news')]);

            expect(registry.resolveToolForChannel('fetch_news', 'chan-other')).toBeUndefined();
        });

        it('returns undefined for unknown names', () => {
            const { registry } = makeRegistry([externalTool('fetch_news')]);

            expect(registry.resolveToolForChannel('nope', CHANNEL_ID)).toBeUndefined();
        });
    });

    describe('refresh composition', () => {
        it('deduplicates repeated snapshots and replaces an updated definition', () => {
            const original = externalTool('fetch_news');
            const { registry, state } = makeRegistry([original, { ...original }]);
            const canonical = namespaceExternalTool(SERVER_ID, 'fetch_news');

            expect(registry.getAllToolsSnapshot().filter(t => t.name === canonical)).toHaveLength(1);

            state.tools = [{
                ...original,
                description: 'updated external fetch_news',
                inputSchema: {
                    type: 'object',
                    properties: { topic: { type: 'string' } },
                    required: ['topic']
                }
            }];
            EventBus.server.emit(
                McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED,
                serverEventPayload(McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED)
            );
            // A duplicate refresh is a no-op with respect to registry cardinality.
            EventBus.server.emit(
                McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED,
                serverEventPayload(McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED)
            );

            const matches = registry.getAllToolsSnapshot().filter(t => t.name === canonical);
            expect(matches).toHaveLength(1);
            expect(matches[0].description).toBe('updated external fetch_news');
            expect(matches[0].inputSchema).toEqual(expect.objectContaining({ required: ['topic'] }));
        });

        it('unregisters one channel snapshot without disturbing another channel', () => {
            const betaServer = 'chan-beta:sentinel-tools';
            const { registry, state } = makeRegistry([
                externalTool('fetch_news'),
                externalTool('fetch_news', betaServer, 'channel', 'chan-beta')
            ]);

            expect(registry.resolveToolForChannel('fetch_news', CHANNEL_ID)).toBeDefined();
            expect(registry.resolveToolForChannel('fetch_news', 'chan-beta')).toBeDefined();

            state.tools = [externalTool('fetch_news', betaServer, 'channel', 'chan-beta')];
            EventBus.server.emit(
                McpEvents.CHANNEL_SERVER_UNREGISTERED,
                serverEventPayload(McpEvents.CHANNEL_SERVER_UNREGISTERED)
            );

            expect(registry.resolveToolForChannel('fetch_news', CHANNEL_ID)).toBeUndefined();
            expect(registry.resolveToolForChannel('fetch_news', 'chan-beta')?.source).toBe(betaServer);
        });
    });

    describe('eviction logging', () => {
        it('logs when a server\'s tools disappear from the registry', () => {
            const { registry, state } = makeRegistry([
                externalTool('fetch_news'),
                externalTool('submit_post')
            ]);

            // Confirm the tools are in
            expect(registry.getToolsForChannel(CHANNEL_ID).some(t => t.isExternal)).toBe(true);
            jest.clearAllMocks();

            // The manager stops reporting the server's tools (production: record deleted)
            state.tools = [];
            EventBus.server.emit(McpEvents.EXTERNAL_SERVER_STOPPED, serverEventPayload(McpEvents.EXTERNAL_SERVER_STOPPED));

            const warned = logSpies.warn.mock.calls.map(c => String(c[0])).join('\n');
            expect(warned).toContain(SERVER_ID);
            expect(warned).toMatch(/removed|dropped|evict/i);

            // And the tools really are gone
            expect(registry.getToolsForChannel(CHANNEL_ID).filter(t => t.isExternal)).toHaveLength(0);
        });

        it('logs when a server\'s tools first appear', () => {
            const { registry, state } = makeRegistry([]);
            jest.clearAllMocks();

            state.tools = [externalTool('fetch_news')];
            EventBus.server.emit(McpEvents.EXTERNAL_SERVER_STARTED, serverEventPayload(McpEvents.EXTERNAL_SERVER_STARTED));

            const logged = logSpies.info.mock.calls.map(c => String(c[0])).join('\n');
            expect(logged).toContain(SERVER_ID);
            expect(registry.getToolsForChannel(CHANNEL_ID).some(t => t.name.endsWith('fetch_news'))).toBe(true);
        });
    });
});
