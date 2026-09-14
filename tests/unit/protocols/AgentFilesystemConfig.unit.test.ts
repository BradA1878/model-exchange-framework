import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    getAgentFilesystemServerConfig,
    getFilesystemServerExecutable,
    readAgentFilesystemRootTemplates
} from '@mxf-dev/core/protocols/mcp/services/AgentFilesystemConfig';
import {
    EXTERNAL_SERVER_CONFIGS,
    FILESYSTEM_SERVER_CONFIG,
    getAutoStartConfigs,
    getFilesystemServerConfig,
    WAVE_SERVER_CONFIG
} from '@mxf-dev/core/protocols/mcp/services/ExternalServerConfigs';

const configurationVariables = [
    'MXF_AGENT_FILESYSTEM_ROOTS',
    'MXF_WORKSPACE_ROOT',
    'MXF_EXTERNAL_MCP_AUTOSTART',
    'DISABLE_EXTERNAL_MCP_SERVERS',
    'MXF_UNSAFE_STDIO_MCP_ENABLED'
] as const;

describe('operator filesystem configuration', () => {
    let temporaryRoot: string;
    let originalEnvironment: Map<string, string | undefined>;

    beforeEach(() => {
        originalEnvironment = new Map(configurationVariables.map(name => [name, process.env[name]]));
        for (const name of configurationVariables) {
            delete process.env[name];
        }
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mxf-agent-filesystem-config-'));
    });

    afterEach(() => {
        for (const [name, value] of originalEnvironment) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    it('leaves agent filesystems disabled when roots are unset', async () => {
        expect(readAgentFilesystemRootTemplates()).toBeUndefined();
        expect(await getAgentFilesystemServerConfig('agent-a')).toBeUndefined();
    });

    it('reads absolute templates without creating directories', () => {
        const privateTemplate = path.join(temporaryRoot, '{agentId}', '{agentId}');
        const sharedRoot = path.join(temporaryRoot, 'shared');
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = ` ${privateTemplate} , ${sharedRoot} `;

        expect(readAgentFilesystemRootTemplates()).toEqual([privateTemplate, sharedRoot]);
        expect(fs.readdirSync(temporaryRoot)).toEqual([]);
    });

    it.each(['', ' ', ',', '/work,', ',/work', 'work/{agentId}', '/work\0/agent'])(
        'rejects malformed root lists %j', configured => {
            process.env.MXF_AGENT_FILESYSTEM_ROOTS = configured;
            expect(() => readAgentFilesystemRootTemplates()).toThrow(/non-empty absolute root templates/);
        }
    );

    it.each(['/work/{unknown}', '/work/{agentId', '/work/agentId}', '/work/{{agentId}}'])(
        'rejects unsupported or malformed placeholders %s', configured => {
            process.env.MXF_AGENT_FILESYSTEM_ROOTS = configured;
            expect(() => readAgentFilesystemRootTemplates()).toThrow(/only \{agentId\} placeholders/);
        }
    );

    it('rejects both filesystem configurations even with no predefined autostarts', () => {
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = path.join(temporaryRoot, '{agentId}');
        process.env.MXF_WORKSPACE_ROOT = temporaryRoot;
        process.env.MXF_EXTERNAL_MCP_AUTOSTART = '';

        expect(() => readAgentFilesystemRootTemplates()).toThrow(/cannot both be configured/);
        expect(() => getAutoStartConfigs()).toThrow(/cannot both be configured/);
        expect(() => getFilesystemServerConfig()).toThrow(/cannot both be configured/);
    });

    it.each(['', '   '])('treats blank workspace root %j as unconfigured', workspace => {
        process.env.MXF_WORKSPACE_ROOT = workspace;
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = temporaryRoot;
        expect(readAgentFilesystemRootTemplates()).toEqual([temporaryRoot]);
    });

    it.each(['', ' ', '.', '..', '../b', 'a/b', 'a\\b', '/absolute', 'a\0b'])(
        'rejects unsafe agent ID %j before resolving its root', async agentId => {
            process.env.MXF_AGENT_FILESYSTEM_ROOTS = path.join(temporaryRoot, '{agentId}');
            await expect(getAgentFilesystemServerConfig(agentId)).rejects.toThrow(/single path component/);
            expect(fs.readdirSync(temporaryRoot)).toEqual([]);
        }
    );

    it('uses the installed pinned executable and every canonical private/shared root', async () => {
        const agentRoot = path.join(temporaryRoot, 'agent-a');
        const sharedRoot = path.join(temporaryRoot, 'shared');
        fs.mkdirSync(agentRoot);
        fs.mkdirSync(sharedRoot);
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = `${temporaryRoot}/{agentId},${sharedRoot}`;
        process.env.MXF_EXTERNAL_MCP_AUTOSTART = '';
        process.env.DISABLE_EXTERNAL_MCP_SERVERS = 'true';
        process.env.MXF_UNSAFE_STDIO_MCP_ENABLED = 'false';

        const config = await getAgentFilesystemServerConfig('agent-a');
        const packagePath = require.resolve('@modelcontextprotocol/server-filesystem/package.json');
        expect(config).toEqual(expect.objectContaining({
            id: 'filesystem:agent-a',
            version: '2026.8.31',
            command: process.execPath,
            args: [
                path.join(path.dirname(packagePath), 'dist/index.js'),
                fs.realpathSync(agentRoot),
                fs.realpathSync(sharedRoot)
            ],
            autoStart: true
        }));
        expect(getAutoStartConfigs()).toEqual([]);
    });

    it('replaces every placeholder and preserves literal replacement characters in agent IDs', async () => {
        const agentId = 'agent-$&';
        const agentRoot = path.join(temporaryRoot, agentId, agentId);
        fs.mkdirSync(agentRoot, { recursive: true });
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = path.join(temporaryRoot, '{agentId}', '{agentId}');

        const config = await getAgentFilesystemServerConfig(agentId);
        expect(config?.args.slice(1)).toEqual([fs.realpathSync(agentRoot)]);
        expect(config?.id).toBe(`filesystem:${agentId}`);
    });

    it('resolves a configured directory symlink to its canonical directory', async () => {
        const actualRoot = path.join(temporaryRoot, 'actual');
        const linkedRoot = path.join(temporaryRoot, 'agent-a');
        fs.mkdirSync(actualRoot);
        fs.symlinkSync(actualRoot, linkedRoot, 'dir');
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = `${temporaryRoot}/{agentId}`;

        const config = await getAgentFilesystemServerConfig('agent-a');
        expect(config?.args.slice(1)).toEqual([fs.realpathSync(actualRoot)]);
    });

    it('rejects a missing root even when another root exists, without creating it', async () => {
        const missingRoot = path.join(temporaryRoot, 'missing');
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = `${temporaryRoot},${missingRoot}`;

        await expect(getAgentFilesystemServerConfig('a')).rejects.toThrow(
            `Invalid filesystem root ${JSON.stringify(missingRoot)} for agent "a"`
        );
        expect(fs.existsSync(missingRoot)).toBe(false);
    });

    it('rejects files and dangling directory symlinks as roots', async () => {
        const fileRoot = path.join(temporaryRoot, 'file');
        fs.writeFileSync(fileRoot, 'not a directory');
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = fileRoot;
        await expect(getAgentFilesystemServerConfig('a')).rejects.toThrow(/root is not a directory/);

        const linkRoot = path.join(temporaryRoot, 'dangling');
        fs.symlinkSync(path.join(temporaryRoot, 'missing'), linkRoot, 'dir');
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = linkRoot;
        await expect(getAgentFilesystemServerConfig('a')).rejects.toThrow(/Invalid filesystem root/);
    });

    it('uses the installed executable for legacy global filesystem configuration', () => {
        process.env.MXF_WORKSPACE_ROOT = temporaryRoot;
        const executable = getFilesystemServerExecutable();
        const config = getFilesystemServerConfig();

        expect(config.version).toBe('2026.8.31');
        expect(config.command).toBe(process.execPath);
        expect(config.args).toEqual([executable.entryPoint, temporaryRoot]);
        expect(FILESYSTEM_SERVER_CONFIG.command).toBe(process.execPath);
        expect(FILESYSTEM_SERVER_CONFIG.args[0]).toBe(executable.entryPoint);
    });

    it('keeps the predefined defaults when the autostart variable is unset', () => {
        const expected = EXTERNAL_SERVER_CONFIGS
            .filter(config => config.id !== 'filesystem' && config.autoStart)
            .map(config => config.id);
        expect(getAutoStartConfigs().map(config => config.id)).toEqual(expected);

        process.env.MXF_WORKSPACE_ROOT = temporaryRoot;
        expect(getAutoStartConfigs().map(config => config.id)).toContain('filesystem');
    });

    it.each(['', '  '])('selects no predefined servers for empty autostart %j', configured => {
        process.env.MXF_EXTERNAL_MCP_AUTOSTART = configured;
        expect(getAutoStartConfigs()).toEqual([]);
    });

    it('selects explicit IDs despite defaults, deduplicates, and leaves defaults unchanged', () => {
        process.env.MXF_EXTERNAL_MCP_AUTOSTART = ' wave, calculator, wave ';
        const selected = getAutoStartConfigs();

        expect(selected.map(config => config.id)).toEqual(['wave', 'calculator']);
        expect(selected.every(config => config.autoStart)).toBe(true);
        expect(WAVE_SERVER_CONFIG.autoStart).toBe(false);
        selected[0].args.push('caller-change');
        expect(WAVE_SERVER_CONFIG.args).toEqual(['-y', 'mcp-wave']);
    });

    it.each(['unknown', 'calculator,unknown', 'calculator,', ',calculator'])(
        'rejects unknown or empty autostart entries %j', configured => {
            process.env.MXF_EXTERNAL_MCP_AUTOSTART = configured;
            expect(() => getAutoStartConfigs()).toThrow(/Unknown predefined MCP server/);
        }
    );

    it('rejects explicit global filesystem selection without a workspace', () => {
        process.env.MXF_EXTERNAL_MCP_AUTOSTART = 'filesystem';
        expect(() => getAutoStartConfigs()).toThrow(/MXF_WORKSPACE_ROOT is not set/);
    });

    it('still validates malformed agent filesystem settings when autostart is empty', () => {
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = '/work/{other}';
        process.env.MXF_EXTERNAL_MCP_AUTOSTART = '';
        expect(() => getAutoStartConfigs()).toThrow(/only \{agentId\} placeholders/);
    });
});
