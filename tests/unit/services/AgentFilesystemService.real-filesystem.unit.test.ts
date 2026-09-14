jest.mock('../../../src/server/api/services/ServerHybridMcpService', () => ({
    ServerHybridMcpService: { getInstance: jest.fn(() => { throw new Error('Unexpected framework service construction'); }) }
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = jest.fn();
        debug = jest.fn();
        warn = jest.fn();
        error = jest.fn();
        trace = jest.fn();
    }
}));
jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { on: jest.fn(), emit: jest.fn() } }
}));
jest.mock('@mxf-dev/core/services/AutoCorrectionService', () => ({
    AutoCorrectionService: { getInstance: (): object => ({
        getConfig: (): object => ({ enabled: false }),
        attemptCorrection: jest.fn(() => { throw new Error('Correction must remain disabled'); })
    }) }
}));

import type { ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    getAgentFilesystemServerConfig,
    getFilesystemServerExecutable
} from '@mxf-dev/core/protocols/mcp/services/AgentFilesystemConfig';
import { ExternalMcpServerManager } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';
import { AgentFilesystemService } from '../../../src/server/socket/services/AgentFilesystemService';

interface FileResult {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
}
const textContent = (result: FileResult): string => result.content.map(part => part.text ?? '').join('\n');

// This test exercises lease lifetime and the installed package's path boundary.
// Executor authorization and raw-name routing are covered by their own suites.
describe('agent leases with the installed filesystem MCP package', () => {
    it('isolates two private roots, shares the configured shared root, and awaits both child exits', async () => {
        const originalRoots = process.env.MXF_AGENT_FILESYSTEM_ROOTS;
        const originalWorkspace = process.env.MXF_WORKSPACE_ROOT;
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mxf-agent-filesystem-'));
        const root = await fs.realpath(temporary);
        const manager = new ExternalMcpServerManager({ skipServerEventHandlers: true });
        const service = new AgentFilesystemService(getAgentFilesystemServerConfig, () => manager);
        const privateA = path.join(root, 'agents', 'agent-a');
        const privateB = path.join(root, 'agents', 'agent-b');
        const shared = path.join(root, 'shared');
        try {
            await Promise.all([privateA, privateB, shared].map(directory => fs.mkdir(directory, { recursive: true })));
            await Promise.all([
                fs.writeFile(path.join(privateA, 'secret.txt'), 'private-content-a'),
                fs.writeFile(path.join(privateB, 'secret.txt'), 'private-content-b'),
                fs.writeFile(path.join(shared, 'common.txt'), 'shared-content'),
                fs.symlink(privateB, path.join(privateA, 'outside-link'))
            ]);
            delete process.env.MXF_WORKSPACE_ROOT;
            process.env.MXF_AGENT_FILESYSTEM_ROOTS = `${path.join(root, 'agents', '{agentId}')},${shared}`;
            expect(getFilesystemServerExecutable().version).toBe('2026.8.31');
            await Promise.all([service.acquire('agent-a', 'socket-a'), service.acquire('agent-b', 'socket-b')]);
            const records = (manager as unknown as { servers: Map<string, { process?: ChildProcess }> }).servers;
            const childA = records.get('filesystem:agent-a')!.process!;
            const childB = records.get('filesystem:agent-b')!.process!;
            expect(childA.pid).not.toBe(childB.pid);
            const readTools = manager.getAllExternalTools().filter(tool => tool.name === 'read_text_file');
            expect(readTools).toEqual(expect.arrayContaining([
                expect.objectContaining({ serverId: 'filesystem:agent-a', scope: 'agent', scopeId: 'agent-a', operatorAgentFilesystem: true }),
                expect.objectContaining({ serverId: 'filesystem:agent-b', scope: 'agent', scopeId: 'agent-b', operatorAgentFilesystem: true })
            ]));
            expect(readTools).toHaveLength(2);
            const read = async (agentId: string, file: string): Promise<FileResult> => manager.executeToolOnServer(
                `filesystem:${agentId}`, 'read_text_file', { path: file }, agentId, 'shared-channel'
            );
            for (const [agentId, privateDirectory, expected] of [
                ['agent-a', privateA, 'private-content-a'],
                ['agent-b', privateB, 'private-content-b']
            ]) {
                const own = await read(agentId, path.join(privateDirectory, 'secret.txt'));
                expect(own.isError).not.toBe(true);
                expect(textContent(own)).toBe(expected);
                const common = await read(agentId, path.join(shared, 'common.txt'));
                expect(common.isError).not.toBe(true);
                expect(textContent(common)).toBe('shared-content');
            }
            for (const [agentId, prohibited, secret] of [
                ['agent-a', path.join(privateB, 'secret.txt'), 'private-content-b'],
                ['agent-b', path.join(privateA, 'secret.txt'), 'private-content-a'],
                ['agent-a', path.join(privateA, 'outside-link', 'secret.txt'), 'private-content-b']
            ]) {
                const denied = await read(agentId, prohibited);
                expect(denied.isError).toBe(true);
                expect(textContent(denied)).toMatch(/outside allowed|access denied/i);
                expect(textContent(denied)).not.toContain(secret);
            }
            await service.release('agent-a', 'socket-a');
            expect(childA.exitCode !== null || childA.signalCode !== null).toBe(true);
            expect(manager.getServerStatusById('filesystem:agent-a')).toBeUndefined();
            expect(manager.getServerStatusById('filesystem:agent-b')?.status).toBe('running');
            expect(textContent(await read('agent-b', path.join(privateB, 'secret.txt')))).toBe('private-content-b');
            await service.release('agent-b', 'socket-b');
            expect(childB.exitCode !== null || childB.signalCode !== null).toBe(true);
            expect(manager.getServerStatus().size).toBe(0);
        } finally {
            try {
                await manager.shutdown();
            } finally {
                if (originalRoots === undefined) delete process.env.MXF_AGENT_FILESYSTEM_ROOTS;
                else process.env.MXF_AGENT_FILESYSTEM_ROOTS = originalRoots;
                if (originalWorkspace === undefined) delete process.env.MXF_WORKSPACE_ROOT;
                else process.env.MXF_WORKSPACE_ROOT = originalWorkspace;
                await fs.rm(temporary, { recursive: true, force: true });
            }
        }
    });
});
