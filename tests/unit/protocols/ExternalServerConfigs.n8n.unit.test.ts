/**
 * Unit tests for the n8n MCP server's auto-start gating.
 *
 * N8N_SERVER_CONFIG used to auto-start unconditionally, so every fresh install
 * spawned `npx -y n8n-mcp@latest` with an empty N8N_API_KEY. Most installs have
 * no n8n instance to talk to, so the server could do nothing useful, and its
 * `search_nodes` tool collided with the memory server's tool of the same name —
 * see HybridMcpToolRegistry's raw-name collision handling, which used to log
 * that collision on every tool-list build. autoStart is now gated on
 * N8N_API_KEY being set, the same way FILESYSTEM_SERVER_CONFIG gates on
 * MXF_WORKSPACE_ROOT.
 *
 * autoStart is computed at module load (matching the filesystem entry), so
 * each case needs its own module registry with the environment already set or
 * cleared before the module is required.
 */

/** Load a fresh ExternalServerConfigs module with N8N_API_KEY set as given. */
const loadConfigs = (
    n8nApiKey: string | undefined
): typeof import('@mxf-dev/core/protocols/mcp/services/ExternalServerConfigs') => {
    if (n8nApiKey === undefined) {
        delete process.env.N8N_API_KEY;
    } else {
        process.env.N8N_API_KEY = n8nApiKey;
    }

    let mod!: typeof import('@mxf-dev/core/protocols/mcp/services/ExternalServerConfigs');
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mod = require('@mxf-dev/core/protocols/mcp/services/ExternalServerConfigs');
    });

    return mod;
};

describe('N8N_SERVER_CONFIG auto-start gating', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('does not auto-start when N8N_API_KEY is unset', () => {
        const { N8N_SERVER_CONFIG, getAutoStartConfigs } = loadConfigs(undefined);

        expect(N8N_SERVER_CONFIG.autoStart).toBe(false);
        expect(getAutoStartConfigs().map(config => config.id)).not.toContain('n8n');
    });

    it('does not auto-start when N8N_API_KEY is whitespace only', () => {
        const { N8N_SERVER_CONFIG, getAutoStartConfigs } = loadConfigs('   ');

        expect(N8N_SERVER_CONFIG.autoStart).toBe(false);
        expect(getAutoStartConfigs().map(config => config.id)).not.toContain('n8n');
    });

    it('auto-starts when N8N_API_KEY is set', () => {
        const { N8N_SERVER_CONFIG, getAutoStartConfigs } = loadConfigs('abc');

        expect(N8N_SERVER_CONFIG.autoStart).toBe(true);
        expect(getAutoStartConfigs().map(config => config.id)).toContain('n8n');
    });
});
