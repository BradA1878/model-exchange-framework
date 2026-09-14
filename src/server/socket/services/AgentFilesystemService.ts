import { getAgentFilesystemServerConfig, readAgentFilesystemRootTemplates } from '@mxf-dev/core/protocols/mcp/services/AgentFilesystemConfig';
import type { ExternalMcpServerManager, ExternalServerConfig } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';
import { ServerHybridMcpService } from '../../api/services/ServerHybridMcpService';

type FilesystemManager = Pick<ExternalMcpServerManager, 'registerAgentFilesystemServer' | 'unregisterServer' | 'isOperatorAgentFilesystem'>;

interface FilesystemLease {
    agentId: string;
    sockets: Set<string>;
    ready: Promise<void>;
    predecessor?: Promise<void>;
    closing: boolean;
    manager?: FilesystemManager;
    registered: boolean;
    stopped?: Promise<void>;
}

/**
 * Own one operator filesystem process per agent, leased by exact socket IDs.
 * A last disconnect cancels admission synchronously, including root validation
 * and MCP initialization. A replacement waits for actual process termination.
 */
export class AgentFilesystemService {
    private static instance: AgentFilesystemService | undefined;
    private readonly agents = new Map<string, FilesystemLease>();
    private readonly sockets = new Map<string, FilesystemLease>();

    public constructor(
        private readonly resolveConfig: (agentId: string) => Promise<ExternalServerConfig | undefined> = getAgentFilesystemServerConfig,
        private readonly getManager: () => FilesystemManager = () => ServerHybridMcpService.getInstance().getExternalServerManager()
    ) {}

    public static getInstance(): AgentFilesystemService {
        return this.instance ??= new AgentFilesystemService();
    }

    public acquire(agentId: string, socketId: string): Promise<void> {
        if (!agentId || !socketId) throw new Error('Agent and socket IDs are required for filesystem admission');
        const key = JSON.stringify([agentId, socketId]);
        const existing = this.sockets.get(key);
        if (existing) return existing.ready.then(() => this.assertLive(existing, socketId));
        if (readAgentFilesystemRootTemplates() === undefined) return Promise.resolve();

        let lease = this.agents.get(agentId);
        if (!lease || lease.closing) {
            const predecessor = lease?.stopped;
            lease = {
                agentId, sockets: new Set(), closing: false, registered: false,
                predecessor, ready: Promise.resolve()
            };
            const admission = lease;
            this.agents.set(agentId, admission);
            // Defer initialization until the owner and readiness promise exist.
            admission.ready = Promise.resolve().then(() => this.initialize(admission)).catch(async error => {
                try {
                    await this.close(admission);
                } catch (cleanupError) {
                    throw Object.assign(new Error(`Filesystem admission and cleanup failed for ${agentId}`), { causes: [error, cleanupError] });
                }
                throw error;
            });
        }
        lease.sockets.add(socketId);
        this.sockets.set(key, lease);
        const admission = lease;
        return admission.ready.then(() => this.assertLive(admission, socketId)).catch(async error => {
            await this.release(agentId, socketId);
            throw error;
        });
    }

    private assertLive(lease: FilesystemLease, socketId?: string): void {
        if (lease.closing || this.agents.get(lease.agentId) !== lease || lease.sockets.size === 0 ||
            (socketId !== undefined && !lease.sockets.has(socketId))) {
            throw new Error(`Filesystem admission cancelled for agent ${lease.agentId}`);
        }
    }

    private async initialize(lease: FilesystemLease): Promise<void> {
        await lease.predecessor;
        this.assertLive(lease);
        const config = await this.resolveConfig(lease.agentId);
        this.assertLive(lease);
        if (!config) return;
        lease.manager = this.getManager();
        if (lease.manager.isOperatorAgentFilesystem(config.id, lease.agentId)) {
            throw new Error(`An operator filesystem for ${lease.agentId} is already owned outside this socket lease`);
        }
        // Registration reserves its manager record before yielding. Mark our
        // ownership first so a reentrant disconnect can immediately stop it.
        lease.registered = true;
        await lease.manager.registerAgentFilesystemServer(config, lease.agentId);
        this.assertLive(lease);
    }

    public release(agentId: string, socketId: string): Promise<void> {
        const key = JSON.stringify([agentId, socketId]);
        const lease = this.sockets.get(key);
        if (!lease) return Promise.resolve();
        this.sockets.delete(key);
        lease.sockets.delete(socketId);
        return lease.sockets.size === 0 ? this.close(lease) : Promise.resolve();
    }

    private close(lease: FilesystemLease): Promise<void> {
        if (lease.stopped) return lease.stopped;
        lease.closing = true;
        // Never await startup here: a live child may still be waiting for its
        // initialize reply. unregisterServer owns and awaits that child's exit.
        let resolveStop!: () => void;
        let rejectStop!: (error: unknown) => void;
        lease.stopped = new Promise<void>((resolve, reject) => {
            resolveStop = resolve;
            rejectStop = reject;
        });
        // Claim the promise before unregister emits STOP. A reentrant acquire
        // must already have a predecessor to wait on when that event is sent.
        void (async (): Promise<void> => {
            if (lease.registered) {
                await lease.manager!.unregisterServer(`filesystem:${lease.agentId}`);
            } else {
                await lease.predecessor;
            }
            if (this.agents.get(lease.agentId) === lease) this.agents.delete(lease.agentId);
        })().then(resolveStop, rejectStop);
        // On a failed stop retain this closing generation. A new socket must
        // observe the failure, rather than start a second process over it.
        return lease.stopped;
    }
}
