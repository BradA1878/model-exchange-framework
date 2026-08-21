import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    resolveWorkspacePath
} from '@mxf-dev/core/protocols/mcp/security/McpToolPolicy';
import {
    getFilesystemServerConfig
} from '@mxf-dev/core/protocols/mcp/services/ExternalServerConfigs';

describe('McpToolPolicy workspace containment', () => {
    let temporaryRoot: string;
    let workspaceRoot: string;
    let outsideRoot: string;
    let originalWorkspaceRoot: string | undefined;

    beforeEach(() => {
        originalWorkspaceRoot = process.env.MXF_WORKSPACE_ROOT;
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mxf-workspace-policy-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        outsideRoot = path.join(temporaryRoot, 'outside');
        fs.mkdirSync(workspaceRoot);
        fs.mkdirSync(outsideRoot);
        process.env.MXF_WORKSPACE_ROOT = workspaceRoot;
    });

    afterEach(() => {
        if (originalWorkspaceRoot === undefined) {
            delete process.env.MXF_WORKSPACE_ROOT;
        } else {
            process.env.MXF_WORKSPACE_ROOT = originalWorkspaceRoot;
        }
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    it('has no cwd or home fallback when MXF_WORKSPACE_ROOT is unset', () => {
        delete process.env.MXF_WORKSPACE_ROOT;
        expect(() => resolveWorkspacePath(undefined, 'test tool')).toThrow(/MXF_WORKSPACE_ROOT is not set/);
    });

    it('defaults to the configured root and resolves in-root paths', () => {
        const nested = path.join(workspaceRoot, 'src');
        fs.mkdirSync(nested);

        expect(resolveWorkspacePath(undefined, 'test tool')).toBe(fs.realpathSync(workspaceRoot));
        expect(resolveWorkspacePath('src', 'test tool')).toBe(fs.realpathSync(nested));
    });

    it('rejects lexical traversal and absolute outside-root paths', () => {
        expect(() => resolveWorkspacePath('../outside', 'test tool')).toThrow(/outside MXF_WORKSPACE_ROOT/);
        expect(() => resolveWorkspacePath(outsideRoot, 'test tool')).toThrow(/outside MXF_WORKSPACE_ROOT/);
    });

    it('rejects an existing symlink that resolves outside the workspace', () => {
        const outsideFile = path.join(outsideRoot, 'secret.json');
        fs.writeFileSync(outsideFile, '{"secret":true}');
        fs.symlinkSync(outsideFile, path.join(workspaceRoot, 'secret-link.json'));

        expect(() => resolveWorkspacePath('secret-link.json', 'test tool')).toThrow(/symlink/);
    });

    it('rejects a non-existent write target beneath an outside-root symlink', () => {
        fs.symlinkSync(outsideRoot, path.join(workspaceRoot, 'escape'), 'dir');

        expect(() => resolveWorkspacePath('escape/new/deep/file.json', 'test tool')).toThrow(/symlink/);
    });

    it('allows a non-existent write target whose nearest ancestor is inside the workspace', () => {
        const expected = path.join(fs.realpathSync(workspaceRoot), 'new', 'deep', 'file.json');
        expect(resolveWorkspacePath('new/deep/file.json', 'test tool')).toBe(expected);
    });

    it('gives the filesystem MCP server only the configured workspace root', () => {
        const config = getFilesystemServerConfig();
        expect(config.args).toEqual([
            '-y',
            '@modelcontextprotocol/server-filesystem',
            path.resolve(workspaceRoot)
        ]);
    });
});
