jest.mock('../../../src/server/api/services/ServerHybridMcpService', () => ({
    ServerHybridMcpService: { getInstance: jest.fn(() => { throw new Error('Unexpected framework service construction'); }) }
}));

import type { ExternalServerConfig } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';
import { AgentFilesystemService } from '../../../src/server/socket/services/AgentFilesystemService';

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void } => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
    return { promise, resolve, reject };
};
const configuration = (agentId: string): ExternalServerConfig => ({
    id: `filesystem:${agentId}`, name: 'Filesystem fixture', version: '1',
    command: process.execPath, args: [], autoStart: true, restartOnCrash: false,
    maxRestartAttempts: 0, healthCheckInterval: 30000, startupTimeout: 10000
});
const fixture = (): {
    service: AgentFilesystemService;
    resolveConfig: jest.Mock<Promise<ExternalServerConfig | undefined>, [string]>;
    getManager: jest.Mock;
    manager: {
        registerAgentFilesystemServer: jest.Mock<Promise<void>, [ExternalServerConfig, string]>;
        unregisterServer: jest.Mock<Promise<void>, [string]>;
        isOperatorAgentFilesystem: jest.Mock<boolean, [string, string]>;
    };
    owned: Set<string>;
} => {
    const owned = new Set<string>();
    const manager = {
        registerAgentFilesystemServer: jest.fn(async (config: ExternalServerConfig, agentId: string): Promise<void> => {
            if (config.id !== `filesystem:${agentId}`) throw new Error('Invalid fixture server ID');
            owned.add(config.id);
        }),
        unregisterServer: jest.fn(async (id: string): Promise<void> => { owned.delete(id); }),
        isOperatorAgentFilesystem: jest.fn((id: string, agentId: string): boolean => id === `filesystem:${agentId}` && owned.has(id))
    };
    const resolveConfig = jest.fn(async (agentId: string): Promise<ExternalServerConfig | undefined> => configuration(agentId));
    const getManager = jest.fn(() => manager);
    return { service: new AgentFilesystemService(resolveConfig, getManager), resolveConfig, getManager, manager, owned };
};

const originalRoots = process.env.MXF_AGENT_FILESYSTEM_ROOTS;
const originalWorkspace = process.env.MXF_WORKSPACE_ROOT;

describe('AgentFilesystemService socket leases', () => {
    beforeEach(() => {
        process.env.MXF_AGENT_FILESYSTEM_ROOTS = '/tmp/mxf-unit-agents/{agentId}';
        delete process.env.MXF_WORKSPACE_ROOT;
    });
    afterEach(() => {
        if (originalRoots === undefined) delete process.env.MXF_AGENT_FILESYSTEM_ROOTS;
        else process.env.MXF_AGENT_FILESYSTEM_ROOTS = originalRoots;
        if (originalWorkspace === undefined) delete process.env.MXF_WORKSPACE_ROOT;
        else process.env.MXF_WORKSPACE_ROOT = originalWorkspace;
    });

    it('does not construct a manager or resolve roots when agent filesystems are unset', async () => {
        delete process.env.MXF_AGENT_FILESYSTEM_ROOTS;
        const { service, resolveConfig, getManager } = fixture();
        await service.acquire('agent-a', 'socket-a');
        await service.release('agent-a', 'socket-a');
        expect(resolveConfig).not.toHaveBeenCalled();
        expect(getManager).not.toHaveBeenCalled();
    });

    it('a disconnect during root validation prevents registration', async () => {
        const { service, resolveConfig, manager } = fixture();
        const entered = deferred<void>();
        const roots = deferred<ExternalServerConfig | undefined>();
        resolveConfig.mockImplementationOnce((): Promise<ExternalServerConfig | undefined> => {
            entered.resolve();
            return roots.promise;
        });
        const admission = service.acquire('agent-a', 'socket-a').catch((error: unknown) => error);
        await entered.promise;
        await service.release('agent-a', 'socket-a');
        roots.resolve(configuration('agent-a'));
        expect(await admission).toEqual(expect.objectContaining({ message: expect.stringContaining('cancelled') }));
        expect(manager.registerAgentFilesystemServer).not.toHaveBeenCalled();
        expect(manager.unregisterServer).not.toHaveBeenCalled();
    });

    it('a disconnect stops an admitted child without waiting for its pending handshake', async () => {
        const { service, manager, owned } = fixture();
        const entered = deferred<void>();
        const ready = deferred<void>();
        manager.registerAgentFilesystemServer.mockImplementationOnce((config: ExternalServerConfig): Promise<void> => {
            owned.add(config.id);
            entered.resolve();
            return ready.promise;
        });
        const admission = service.acquire('agent-a', 'socket-a').catch((error: unknown) => error);
        await entered.promise;
        await service.release('agent-a', 'socket-a');
        expect(manager.unregisterServer).toHaveBeenCalledWith('filesystem:agent-a');
        expect(owned.size).toBe(0);
        ready.resolve();
        expect(await admission).toEqual(expect.objectContaining({ message: expect.stringContaining('cancelled') }));
    });

    it('two sockets share one server and only the last release stops it', async () => {
        const { service, manager, resolveConfig } = fixture();
        await Promise.all([service.acquire('agent-a', 'socket-a'), service.acquire('agent-a', 'socket-b')]);
        await service.acquire('agent-a', 'socket-a');
        expect(resolveConfig).toHaveBeenCalledTimes(1);
        expect(manager.registerAgentFilesystemServer).toHaveBeenCalledTimes(1);
        await service.release('agent-a', 'socket-a');
        expect(manager.unregisterServer).not.toHaveBeenCalled();
        await service.release('agent-a', 'socket-b');
        await service.release('agent-a', 'socket-b');
        expect(manager.unregisterServer).toHaveBeenCalledTimes(1);
    });

    it('agents have separate ownership even when given the same socket string', async () => {
        const { service, manager, owned } = fixture();
        await Promise.all([service.acquire('agent-a', 'socket'), service.acquire('agent-b', 'socket')]);
        expect(owned).toEqual(new Set(['filesystem:agent-a', 'filesystem:agent-b']));
        await service.release('agent-a', 'socket');
        expect(owned).toEqual(new Set(['filesystem:agent-b']));
        expect(manager.unregisterServer).toHaveBeenCalledTimes(1);
        await service.release('agent-b', 'socket');
        expect(owned.size).toBe(0);
    });

    it('a replacement waits for the previous child to finish stopping', async () => {
        const { service, manager, resolveConfig, owned } = fixture();
        await service.acquire('agent-a', 'old-socket');
        const stopped = deferred<void>();
        manager.unregisterServer.mockImplementationOnce(async (id: string): Promise<void> => {
            await stopped.promise;
            owned.delete(id);
        });
        const leaving = service.release('agent-a', 'old-socket');
        const joining = service.acquire('agent-a', 'new-socket');
        await Promise.resolve();
        expect(resolveConfig).toHaveBeenCalledTimes(1);
        expect(manager.registerAgentFilesystemServer).toHaveBeenCalledTimes(1);
        stopped.resolve();
        await Promise.all([leaving, joining]);
        expect(manager.registerAgentFilesystemServer).toHaveBeenCalledTimes(2);
        expect(owned).toEqual(new Set(['filesystem:agent-a']));
        await service.release('agent-a', 'new-socket');
    });

    it('a replacement that disconnects while waiting never validates or spawns', async () => {
        const { service, manager, resolveConfig } = fixture();
        await service.acquire('agent-a', 'old-socket');
        const stopped = deferred<void>();
        manager.unregisterServer.mockImplementationOnce((): Promise<void> => stopped.promise);
        const oldLeaving = service.release('agent-a', 'old-socket');
        const joining = service.acquire('agent-a', 'new-socket').catch((error: unknown) => error);
        const newLeaving = service.release('agent-a', 'new-socket');
        stopped.resolve();
        await Promise.all([oldLeaving, newLeaving]);
        expect(await joining).toEqual(expect.objectContaining({ message: expect.stringContaining('cancelled') }));
        expect(resolveConfig).toHaveBeenCalledTimes(1);
        expect(manager.registerAgentFilesystemServer).toHaveBeenCalledTimes(1);
        expect(manager.unregisterServer).toHaveBeenCalledTimes(1);
    });

    it('stop failure blocks later admission without another register or stop attempt', async () => {
        const { service, manager, resolveConfig } = fixture();
        await service.acquire('agent-a', 'old-socket');
        const failure = new Error('Child stop failed');
        manager.unregisterServer.mockRejectedValueOnce(failure);
        await expect(service.release('agent-a', 'old-socket')).rejects.toBe(failure);
        await expect(service.acquire('agent-a', 'new-socket')).rejects.toBe(failure);
        expect(resolveConfig).toHaveBeenCalledTimes(1);
        expect(manager.registerAgentFilesystemServer).toHaveBeenCalledTimes(1);
        expect(manager.unregisterServer).toHaveBeenCalledTimes(1);
    });

    it('validation failure does not unregister anything and a subsequent socket can retry', async () => {
        const { service, manager, resolveConfig } = fixture();
        const failure = new Error('Root does not exist');
        resolveConfig.mockRejectedValueOnce(failure);
        await expect(service.acquire('agent-a', 'bad-socket')).rejects.toBe(failure);
        expect(manager.registerAgentFilesystemServer).not.toHaveBeenCalled();
        expect(manager.unregisterServer).not.toHaveBeenCalled();
        await service.acquire('agent-a', 'good-socket');
        expect(manager.registerAgentFilesystemServer).toHaveBeenCalledTimes(1);
        await service.release('agent-a', 'good-socket');
    });

    it('startup failure waits for cleanup before rejecting admission', async () => {
        const { service, manager, owned } = fixture();
        const failure = new Error('MCP discovery failed');
        const cleanupEntered = deferred<void>();
        const cleanup = deferred<void>();
        manager.registerAgentFilesystemServer.mockImplementationOnce(async (config: ExternalServerConfig): Promise<void> => {
            owned.add(config.id);
            throw failure;
        });
        manager.unregisterServer.mockImplementationOnce(async (id: string): Promise<void> => {
            cleanupEntered.resolve();
            await cleanup.promise;
            owned.delete(id);
        });
        let settled = false;
        const admission = service.acquire('agent-a', 'socket-a').catch((error: unknown) => {
            settled = true;
            return error;
        });
        await cleanupEntered.promise;
        expect(settled).toBe(false);
        expect(owned).toEqual(new Set(['filesystem:agent-a']));
        cleanup.resolve();
        expect(await admission).toBe(failure);
        expect(owned.size).toBe(0);
        expect(manager.unregisterServer).toHaveBeenCalledTimes(1);
    });

    it('an existing operator record is rejected without unregistering someone else’s ownership', async () => {
        const { service, manager, owned } = fixture();
        owned.add('filesystem:agent-a');
        await expect(service.acquire('agent-a', 'socket-a')).rejects.toThrow(/already|existing|owned|registered/i);
        expect(manager.registerAgentFilesystemServer).not.toHaveBeenCalled();
        expect(manager.unregisterServer).not.toHaveBeenCalled();
        expect(owned).toEqual(new Set(['filesystem:agent-a']));
    });

    it('a synchronous STOP observer acquiring a replacement waits for the claimed stop promise', async () => {
        const { service, manager, resolveConfig, owned } = fixture();
        await service.acquire('agent-a', 'old-socket');
        const stopped = deferred<void>();
        let joining!: Promise<void>;
        manager.unregisterServer.mockImplementationOnce(async (id: string): Promise<void> => {
            // The real manager emits STOP before unregisterServer returns its promise.
            joining = service.acquire('agent-a', 'replacement-socket');
            await stopped.promise;
            owned.delete(id);
        });
        const leaving = service.release('agent-a', 'old-socket');
        await Promise.resolve();
        expect(resolveConfig).toHaveBeenCalledTimes(1);
        expect(manager.registerAgentFilesystemServer).toHaveBeenCalledTimes(1);
        stopped.resolve();
        await Promise.all([leaving, joining]);
        expect(manager.registerAgentFilesystemServer).toHaveBeenCalledTimes(2);
        expect(owned).toEqual(new Set(['filesystem:agent-a']));
        await service.release('agent-a', 'replacement-socket');
    });
});
