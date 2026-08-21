import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execFile: jest.fn()
}));

import { search_project_tool } from '@mxf-dev/core/protocols/mcp/tools/SearchProjectTools';

describe('search_project host safety', () => {
    const mockedExecFile = childProcess.execFile as unknown as jest.Mock;
    let temporaryRoot: string;
    let workspaceRoot: string;
    let outsideRoot: string;
    let originalWorkspaceRoot: string | undefined;

    beforeEach(() => {
        mockedExecFile.mockClear();
        originalWorkspaceRoot = process.env.MXF_WORKSPACE_ROOT;
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mxf-search-project-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        outsideRoot = path.join(temporaryRoot, 'outside');
        fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
        fs.mkdirSync(outsideRoot);
        fs.writeFileSync(path.join(workspaceRoot, 'src', 'inside.ts'), 'export const inside = true;');
        fs.writeFileSync(path.join(outsideRoot, 'outside.ts'), 'export const outside = true;');
        fs.symlinkSync(outsideRoot, path.join(workspaceRoot, 'linked-outside'), 'dir');
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

    it('performs filename search with a bounded filesystem walk and no process', async () => {
        const result = await search_project_tool.handler({
            mode: 'search_files',
            pattern: '*.ts',
            fileTypes: ['ts']
        }) as { success: boolean; files: string[] };

        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(result.files).toEqual(['src/inside.ts']);
        expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it('rejects a fileTypes shell-injection payload before starting a process', async () => {
        const result = await search_project_tool.handler({
            mode: 'search_content',
            pattern: 'inside',
            fileTypes: ["ts'; touch /tmp/mxf-search-injected; #"]
        }) as { success: boolean; error: string };

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/valid file extension/);
        expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it('rejects traversal and outside-root working directories before starting a process', async () => {
        const traversal = await search_project_tool.handler({
            mode: 'search_content',
            pattern: 'inside',
            workingDirectory: '../outside'
        }) as { success: boolean; error: string };
        const absoluteOutside = await search_project_tool.handler({
            mode: 'search_content',
            pattern: 'inside',
            workingDirectory: outsideRoot
        }) as { success: boolean; error: string };

        expect(traversal.success).toBe(false);
        expect(absoluteOutside.success).toBe(false);
        expect(traversal.error).toMatch(/outside MXF_WORKSPACE_ROOT/);
        expect(absoluteOutside.error).toMatch(/outside MXF_WORKSPACE_ROOT/);
        expect(mockedExecFile).not.toHaveBeenCalled();
    });
});

describe('search_files glob matching', () => {
    let temporaryRoot: string;
    let workspaceRoot: string;
    let originalWorkspaceRoot: string | undefined;

    const runSearch = async (pattern: string, caseSensitive?: boolean): Promise<string[]> => {
        const result = await search_project_tool.handler({
            mode: 'search_files',
            pattern,
            caseSensitive
        }) as { success: boolean; files: string[]; error?: string };
        if (!result.success) {
            throw new Error(`search_files failed: ${result.error}`);
        }
        return [...result.files].sort();
    };

    beforeEach(() => {
        originalWorkspaceRoot = process.env.MXF_WORKSPACE_ROOT;
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mxf-search-glob-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.mkdirSync(path.join(workspaceRoot, 'src', 'nested'), { recursive: true });
        fs.writeFileSync(path.join(workspaceRoot, 'src', 'inside.ts'), '');
        fs.writeFileSync(path.join(workspaceRoot, 'src', 'nested', 'deep.ts'), '');
        fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '');
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

    it('finishes a pathological wildcard pattern without blocking the process', async () => {
        // One legal 40-character filename. Under a backtracking regex, a
        // `*a*a*…b` pattern against this name took ~20 seconds per test()
        // and the walk runs it for every entry.
        fs.writeFileSync(path.join(workspaceRoot, 'src', `${'a'.repeat(37)}c.ts`), '');

        const startedAt = performance.now();
        const files = await runSearch(`${'*a'.repeat(14)}b`);
        const elapsedMs = performance.now() - startedAt;

        expect(files).toEqual([]);
        expect(elapsedMs).toBeLessThan(1000);
    }, 5000);

    it('applies standard glob semantics for *, **, ? and case folding', async () => {
        // A pattern without "/" matches against the file name.
        expect(await runSearch('*.ts')).toEqual(['src/inside.ts', 'src/nested/deep.ts']);
        // "*" never crosses a path separator.
        expect(await runSearch('src/*.ts')).toEqual(['src/inside.ts']);
        // A "**" segment spans zero or more directories.
        expect(await runSearch('src/**/*.ts')).toEqual(['src/inside.ts', 'src/nested/deep.ts']);
        expect(await runSearch('**/deep.ts')).toEqual(['src/nested/deep.ts']);
        // "?" matches exactly one character.
        expect(await runSearch('src/in?ide.ts')).toEqual(['src/inside.ts']);
        expect(await runSearch('src/in?de.ts')).toEqual([]);
        // Case folding is opt-in.
        expect(await runSearch('SRC/INSIDE.TS', false)).toEqual(['src/inside.ts']);
        expect(await runSearch('SRC/INSIDE.TS', true)).toEqual([]);
        // Regex metacharacters in a pattern are literal.
        expect(await runSearch('README.md')).toEqual(['README.md']);
        expect(await runSearch('READMEXmd')).toEqual([]);
    });

    it('rejects a pattern with more wildcards than the matcher bounds', async () => {
        const result = await search_project_tool.handler({
            mode: 'search_files',
            pattern: '*a'.repeat(33)
        }) as { success: boolean; error: string };

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/wildcard/i);
    });
});
