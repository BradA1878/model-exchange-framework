/**
 * Unit tests for McpService.getTools() external-tool allowlist resolution.
 *
 * The production symptom (2026-08-04 Sentinel tool-eviction incident):
 * agents request their channel server's tools by raw name — the only name the
 * registration flow ever returns to clients — and McpService matched
 * allowlists against the namespaced registry names, so every external tool
 * came back "NOT FOUND in registry" and agents were handed core tools only.
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

jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: {
        getInstance: () => ({
            getAgent: () => undefined
        })
    }
}));

import { of } from 'rxjs';
import { McpService } from '../../../src/server/socket/services/McpService';
import {
    HybridMcpToolRegistry,
    namespaceExternalTool
} from '../../../src/server/mcp/services/HybridMcpToolRegistry';
import {
    setHybridMcpToolRegistry,
    clearHybridMcpToolRegistry
} from '../../../src/server/mcp/services/HybridMcpRegistryAccess';

const CHANNEL_ID = 'chan-alpha';
const SERVER_ID = `${CHANNEL_ID}:sentinel-tools`;

function buildRegistry(externalNames: string[]): HybridMcpToolRegistry {
    const internalRegistry = {
        listInternalTools: () => of([
            {
                name: 'task_complete',
                description: 'internal task_complete',
                inputSchema: { type: 'object', properties: {} },
                enabled: true,
                providerId: 'mxf-server',
                channelId: 'system',
                handler: async () => ({ content: { type: 'text', data: 'ok' } })
            }
        ]),
        listTools: () => of([])
    } as any;

    const manager = {
        getAllExternalTools: () => externalNames.map(name => ({
            name,
            description: `external ${name}`,
            inputSchema: { type: 'object', properties: {} },
            serverId: SERVER_ID,
            scope: 'channel',
            scopeId: CHANNEL_ID
        }))
    } as any;

    return new HybridMcpToolRegistry(internalRegistry, manager);
}

describe('McpService external tool allowlist resolution', () => {
    let registry: HybridMcpToolRegistry;

    beforeEach(() => {
        registry = buildRegistry(['fetch_news', 'submit_post']);
        setHybridMcpToolRegistry(registry);
        // getTools() refuses to answer before the DB tool load has run; these
        // tests exercise the registry path only, so mark the load complete.
        (McpService.getInstance() as any).databaseLoaded = true;
    });

    afterEach(async () => {
        clearHybridMcpToolRegistry();
        await registry.shutdown();
        jest.clearAllMocks();
    });

    it('resolves raw external names in an agent allowlist, channel-scoped', () => {
        const tools = McpService.getInstance().getTools({
            channelId: CHANNEL_ID,
            allowedTools: ['task_complete', 'fetch_news', 'submit_post'],
            agentId: 'agent-1'
        });

        const names = tools.map(t => t.name);
        expect(names).toContain('task_complete');
        expect(names).toContain('fetch_news');
        expect(names).toContain('submit_post');

        // Nothing was reported missing
        const warned = logSpies.warn.mock.calls.map(c => String(c[0])).join('\n');
        expect(warned).not.toContain('NOT FOUND');
    });

    it('agent-facing external tool names are LLM-safe (no ":" from the server id)', () => {
        const tools = McpService.getInstance().getTools({
            channelId: CHANNEL_ID,
            allowedTools: ['fetch_news'],
            agentId: 'agent-1'
        });

        for (const tool of tools) {
            expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
        }
    });

    it('still accepts canonical namespaced names in allowlists', () => {
        const tools = McpService.getInstance().getTools({
            channelId: CHANNEL_ID,
            allowedTools: [namespaceExternalTool(SERVER_ID, 'fetch_news')],
            agentId: 'agent-1'
        });

        expect(tools).toHaveLength(1);
        // Exposed under the raw agent-facing name regardless of how it was allowed
        expect(tools[0].name).toBe('fetch_news');
    });

    it('does not resolve external tools for a different channel', () => {
        const tools = McpService.getInstance().getTools({
            channelId: 'chan-other',
            allowedTools: ['task_complete', 'fetch_news'],
            agentId: 'agent-1'
        });

        const names = tools.map(t => t.name);
        expect(names).toContain('task_complete');
        expect(names).not.toContain('fetch_news');

        const warned = logSpies.warn.mock.calls.map(c => String(c[0])).join('\n');
        expect(warned).toContain('fetch_news');
    });
});
