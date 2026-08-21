/**
 * MXF_SHELL_ALLOWED_COMMANDS is documented as the allowlist for commands agents
 * may run. shell_execute applied it; the host tools that run commands through
 * executeShellCommand (run_full_test_suite, performance_benchmark, the
 * TypeScript, test, and analysis tools) did not. The allowlist must bind every
 * agent-driven command, wrappers and env prefixes included.
 */

import * as childProcess from 'child_process';

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execFile: jest.fn()
}));

import { executeShellCommand } from '@mxf-dev/core/protocols/mcp/tools/InfrastructureTools';

describe('executeShellCommand allowlist', () => {
    const mockedExecFile = childProcess.execFile as unknown as jest.Mock;
    const context = { agentId: 'agent-a', channelId: 'channel-a', requestId: 'request-a' };
    const originalEnv = { ...process.env };

    beforeEach(() => {
        mockedExecFile.mockReset();
        mockedExecFile.mockImplementation((_command: string, _args: string[], _options: unknown, callback: (error: null, result: { stdout: string; stderr: string }) => void) => {
            callback(null, { stdout: 'ok', stderr: '' });
            return { pid: 1 };
        });
        process.env.MXF_WORKSPACE_ROOT = process.cwd();
        process.env.MXF_SHELL_ALLOWED_COMMANDS = 'git,bun';
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('refuses a binary outside MXF_SHELL_ALLOWED_COMMANDS before anything runs', async () => {
        await expect(executeShellCommand('python', ['-c', 'print(1)'], { context }))
            .rejects.toThrow(/not in the configured allowlist/);

        expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it('resolves wrappers and env prefixes to the effective command', async () => {
        await expect(executeShellCommand('env', ['FOO=bar', 'python', '-c', 'print(1)'], { context }))
            .rejects.toThrow(/not in the configured allowlist/);

        expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it('runs an allowlisted binary', async () => {
        await expect(executeShellCommand('git', ['status'], { context }))
            .resolves.toEqual(expect.objectContaining({ exitCode: 0 }));

        expect(mockedExecFile).toHaveBeenCalledWith('git', ['status'], expect.any(Object), expect.any(Function));
    });

    it('applies no allowlist when none is configured', async () => {
        delete process.env.MXF_SHELL_ALLOWED_COMMANDS;

        await expect(executeShellCommand('git', ['status'], { context }))
            .resolves.toEqual(expect.objectContaining({ exitCode: 0 }));
    });
});
