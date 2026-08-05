/**
 * Unit tests for HybridMcpToolRegistry external-tool name resolution and
 * eviction logging.
 *
 * Background (HANDOFF-channel-server-tool-eviction.md): since the external
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
        child() { return this; }
    }
}));

import { of } from 'rxjs';
import {
    HybridMcpToolRegistry,
    namespaceExternalTool
} from '../../../src/server/mcp/services/HybridMcpToolRegistry';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { McpEvents } from '@mxf-dev/core/events/event-definitions/McpEvents';
import { createExternalMcpServerEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import type { AgentId, ChannelId } from '@mxf-dev/core/types/ChannelContext';

/** A schema-valid server lifecycle payload for triggering registry refreshes. */
function serverEventPayload(eventType: string) {
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
    inputSchema: Record<string, any>;
    serverId: string;
}

/** Mutable stub standing in for ExternalMcpServerManager. */
function makeManagerStub(initial: StubExternalTool[] = []) {
    const state = { tools: initial };
    return {
        state,
        manager: {
            getAllExternalTools: () => [...state.tools]
        } as any
    };
}

function makeInternalRegistryStub(names: string[] = ['task_complete']) {
    return {
        listTools: () => of(names.map(name => ({
            name,
            description: `internal ${name}`,
            inputSchema: { type: 'object', properties: {} },
            enabled: true,
            handler: async () => ({ content: { type: 'text', data: 'ok' } })
        })))
    } as any;
}

function externalTool(name: string, serverId: string = SERVER_ID): StubExternalTool {
    return {
        name,
        description: `external ${name}`,
        inputSchema: { type: 'object', properties: {} },
        serverId
    };
}

describe('HybridMcpToolRegistry external tool resolution', () => {
    const registries: HybridMcpToolRegistry[] = [];

    function makeRegistry(tools: StubExternalTool[], internalNames?: string[]) {
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
            expect(logSpies.error.mock.calls.map(c => String(c[0])).join('\n')).toContain('fetch_news');
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
