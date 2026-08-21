import * as childProcess from 'child_process';

jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    spawn: jest.fn()
}));

import { execute } from '@mxf-dev/core/protocols/mcp/tools/shell/ShellExecuteHandler';

describe('ShellExecuteHandler sandbox boundary', () => {
    const mockedSpawn = childProcess.spawn as unknown as jest.Mock;
    let originalWorkspaceRoot: string | undefined;
    let originalSandboxEnabled: string | undefined;

    beforeEach(() => {
        mockedSpawn.mockClear();
        originalWorkspaceRoot = process.env.MXF_WORKSPACE_ROOT;
        originalSandboxEnabled = process.env.MXF_SHELL_SANDBOX_ENABLED;
        process.env.MXF_WORKSPACE_ROOT = process.cwd();
        process.env.MXF_SHELL_SANDBOX_ENABLED = 'false';
    });

    afterEach(() => {
        if (originalWorkspaceRoot === undefined) {
            delete process.env.MXF_WORKSPACE_ROOT;
        } else {
            process.env.MXF_WORKSPACE_ROOT = originalWorkspaceRoot;
        }
        if (originalSandboxEnabled === undefined) {
            delete process.env.MXF_SHELL_SANDBOX_ENABLED;
        } else {
            process.env.MXF_SHELL_SANDBOX_ENABLED = originalSandboxEnabled;
        }
    });

    it('does not spawn a host process when the Docker sandbox is disabled', async () => {
        await expect(execute(
            { command: 'cat /etc/passwd' },
            { agentId: 'agent', channelId: 'channel', requestId: 'request' }
        )).rejects.toThrow(/requires MXF_SHELL_SANDBOX_ENABLED=true/);

        expect(mockedSpawn).not.toHaveBeenCalled();
    });
});
