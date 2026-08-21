/**
 * Unit tests for ExternalMcpServerManager channel-server lifecycle.
 *
 * Covers the silent-eviction defects from the 2026-08-04 Sentinel production
 * incident (channel-server tools silently evicted after a child restart):
 *   - a child that dies unexpectedly is restarted with tools re-discovered,
 *     loudly, regardless of exit code
 *   - a server whose restart budget is exhausted is unregistered loudly,
 *     never left as a zombie that agents can "join"
 *   - agent join verifies liveness: a missing record heals the zombie scope,
 *     a dead process triggers the restart path, a wedged process is probed
 *   - unregistration is idempotent and cleans both the server record and the
 *     scope tracking, including the keepAlive timer
 *
 * Uses real child processes: a tiny line-delimited JSON-RPC MCP server run
 * through process.execPath, so spawn/exit/restart flows are exercised for real.
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

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: { on: jest.fn(), emit: jest.fn(), off: jest.fn() },
        client: { on: jest.fn(), emit: jest.fn(), off: jest.fn() }
    }
}));

jest.mock('@mxf-dev/core/services/AutoCorrectionService', () => ({
    AutoCorrectionService: {
        getInstance: () => ({
            attemptCorrection: jest.fn().mockResolvedValue({ corrected: false })
        })
    }
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalMcpServerManager } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';
import type { ExternalServerConfig } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';

/**
 * Minimal MCP stdio server. Modes (via FAKE_MODE):
 *   normal                 — answers initialize / tools/list / tools/call / ping forever
 *   wedge-after-first-list — answers the handshake and the first tools/list,
 *                            then goes silent (process alive, MCP dead)
 *   die-on-call            — exits 0 as soon as a tools/call arrives (clean-exit crash)
 *   crash-if-marker        — exits 1 immediately when the FAKE_MARKER file exists
 */
const FAKE_SERVER_SCRIPT = `
const readline = require('readline');
const fs = require('fs');
const mode = process.env.FAKE_MODE || 'normal';
const toolName = process.env.FAKE_TOOL || 'fake_tool';
if (mode === 'crash-if-marker' && process.env.FAKE_MARKER && fs.existsSync(process.env.FAKE_MARKER)) {
    process.exit(1);
}
let listCount = 0;
const reply = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.method === 'initialize') {
        reply({ jsonrpc: '2.0', id: msg.id, result: { serverInfo: { name: 'fake', version: '1.0.0' } } });
    } else if (msg.method === 'tools/list') {
        listCount++;
        if (mode === 'wedge-after-first-list' && listCount > 1) return;
        reply({ jsonrpc: '2.0', id: msg.id, result: { tools: [
            { name: toolName, description: 'a fake tool', inputSchema: { type: 'object', properties: {} } }
        ] } });
    } else if (msg.method === 'tools/call') {
        if (mode === 'die-on-call') process.exit(0);
        reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'ok' }] } });
    } else if (msg.method === 'ping') {
        reply({ jsonrpc: '2.0', id: msg.id, result: {} });
    }
});
`;

const CHANNEL_ID = 'chan-test';

function makeConfig(overrides: Partial<ExternalServerConfig> & { env?: Record<string, string> } = {}): any {
    const { env, ...rest } = overrides;
    return {
        id: 'fake-tools',
        name: 'Fake Tools',
        version: '1.0.0',
        command: process.execPath,
        args: ['-e', FAKE_SERVER_SCRIPT],
        autoStart: true,
        restartOnCrash: true,
        maxRestartAttempts: 3,
        healthCheckInterval: 60_000,
        startupTimeout: 3_000,
        environmentVariables: { FAKE_TOOL: 'alpha_tool', ...(env ?? {}) },
        ...rest
    };
}

function makeManager(opts: Record<string, any> = {}): ExternalMcpServerManager {
    return new ExternalMcpServerManager({
        skipServerEventHandlers: true,
        restartDelayMs: 50,
        ...opts
    } as any);
}

function waitFor(cond: () => boolean, timeoutMs = 4000, label = 'condition'): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
            if (cond()) {
                clearInterval(timer);
                resolve();
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(timer);
                reject(new Error(`Timed out waiting for ${label}`));
            }
        }, 25);
    });
}

/** All log lines captured by a given spy, joined for substring assertions. */
function loggedLines(spy: jest.Mock): string {
    return spy.mock.calls.map(call => String(call[0])).join('\n');
}

describe('ExternalMcpServerManager channel-server lifecycle', () => {
    const managers: ExternalMcpServerManager[] = [];

    function track(manager: ExternalMcpServerManager): ExternalMcpServerManager {
        managers.push(manager);
        return manager;
    }

    afterEach(async () => {
        while (managers.length > 0) {
            const manager = managers.pop()!;
            await manager.shutdown();
        }
        jest.clearAllMocks();
    });

    describe('registration and startup', () => {
        it('registerChannelServer resolves with tools discovered into the registry', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(CHANNEL_ID, makeConfig());

            const tools = manager.getAllExternalTools();
            expect(tools.map(t => t.name)).toContain('alpha_tool');
            expect(tools[0].serverId).toBe(`${CHANNEL_ID}:fake-tools`);
            expect(tools[0]).toEqual(expect.objectContaining({
                scope: 'channel',
                scopeId: CHANNEL_ID
            }));
            expect(manager.getServersByScope('channel', CHANNEL_ID).map(server => server.id))
                .toEqual([`${CHANNEL_ID}:fake-tools`]);
            expect(manager.getServersByScope('channel', 'chan-other')).toEqual([]);

            const status = manager.getServerStatusById(`${CHANNEL_ID}:fake-tools`);
            expect(status?.status).toBe('running');
        });

        it('treats legacy unscoped registrations as global in scoped reads', async () => {
            const manager = track(makeManager());
            await manager.registerServer({
                ...makeConfig(),
                id: 'global-fake-tools',
                autoStart: false
            });

            expect(manager.getServersByScope('global').map(server => server.id))
                .toEqual(['global-fake-tools']);
            expect(manager.getServersByScope('channel', CHANNEL_ID)).toEqual([]);
        });
    });

    describe('unexpected child exit', () => {
        it('restarts a killed child and re-discovers its tools, loudly', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(CHANNEL_ID, makeConfig());
            const serverId = `${CHANNEL_ID}:fake-tools`;

            const firstPid = manager.getServerStatusById(serverId)?.pid;
            expect(firstPid).toBeDefined();

            process.kill(firstPid!, 'SIGKILL');

            // The restart marks the server 'running' at handshake completion and
            // discovers tools right after — poll for the tools, not just the
            // status, so a slow runner cannot observe the in-between state.
            await waitFor(() => {
                const status = manager.getServerStatusById(serverId);
                return status?.status === 'running' && status.pid !== undefined && status.pid !== firstPid
                    && manager.getAllExternalTools().some(t => t.name === 'alpha_tool');
            }, 4000, 'restart with a new pid and rediscovered tools');

            // Tools must be re-discovered into the registry, not just the process restarted
            expect(manager.getAllExternalTools().map(t => t.name)).toContain('alpha_tool');

            // The death was logged at error level — never silent
            expect(loggedLines(logSpies.error)).toContain(serverId);

            // A successful restart earns back the full restart budget
            expect(manager.getServerStatusById(serverId)?.restartCount).toBe(0);
        });

        it('restarts on a clean (code 0) unexpected exit too', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(
                CHANNEL_ID,
                makeConfig({ env: { FAKE_MODE: 'die-on-call' } })
            );
            const serverId = `${CHANNEL_ID}:fake-tools`;
            const firstPid = manager.getServerStatusById(serverId)?.pid;

            // The call makes the child exit 0 before replying
            await expect(
                manager.executeToolOnServer(serverId, 'alpha_tool', {}, 'agent-1', CHANNEL_ID)
            ).rejects.toThrow();

            await waitFor(() => {
                const status = manager.getServerStatusById(serverId);
                return status?.status === 'running' && status.pid !== firstPid
                    && manager.getAllExternalTools().some(t => t.name === 'alpha_tool');
            }, 4000, 'restart after clean exit with rediscovered tools');

            expect(manager.getAllExternalTools().map(t => t.name)).toContain('alpha_tool');
        });

        it('does NOT restart after an intentional stop', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(CHANNEL_ID, makeConfig());
            const serverId = `${CHANNEL_ID}:fake-tools`;

            await manager.stopServer(serverId, undefined, undefined, 'test stop');

            // Give a would-be restart time to fire
            await new Promise(resolve => setTimeout(resolve, 300));

            const status = manager.getServerStatusById(serverId);
            expect(status?.status).toBe('stopped');
            expect(status?.pid).toBeUndefined();
            // No unexpected-exit error was logged for the intentional stop
            expect(loggedLines(logSpies.error)).not.toContain('exited unexpectedly');
        });

        it('unregisters loudly when the restart budget is exhausted — no zombie left', async () => {
            const marker = path.join(os.tmpdir(), `mxf-crash-marker-${process.pid}-${Date.now()}`);
            const manager = track(makeManager());
            await manager.registerChannelServer(
                CHANNEL_ID,
                makeConfig({
                    maxRestartAttempts: 1,
                    env: { FAKE_MODE: 'crash-if-marker', FAKE_MARKER: marker }
                })
            );
            const serverId = `${CHANNEL_ID}:fake-tools`;
            const firstPid = manager.getServerStatusById(serverId)?.pid;

            try {
                // From now on every spawn of this server crashes instantly
                fs.writeFileSync(marker, '1');
                process.kill(firstPid!, 'SIGKILL');

                // Budget: 1 restart attempt, which crashes -> record and scope removed
                await waitFor(
                    () => manager.getServerStatusById(serverId) === undefined,
                    4000,
                    'zombie removal after exhausted restarts'
                );

                // The scope is gone too: an agent join must not "connect" to it
                await manager.onAgentJoinChannel('agent-1', CHANNEL_ID);
                expect(loggedLines(logSpies.info)).not.toContain('connected to channel server');

                // And the removal was logged at error level
                expect(loggedLines(logSpies.error)).toContain(serverId);
            } finally {
                fs.rmSync(marker, { force: true });
            }
        });
    });

    describe('agent join liveness', () => {
        it('heals a zombie scope (record missing) instead of silently connecting the agent', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(CHANNEL_ID, makeConfig({ autoStart: false }));
            const serverId = `${CHANNEL_ID}:fake-tools`;

            // Reproduce the production state: record gone, scope left behind
            (manager as any).servers.delete(serverId);

            await manager.onAgentJoinChannel('agent-1', CHANNEL_ID);

            // The join must be loud about the zombie, and must not claim a connection
            expect(loggedLines(logSpies.error)).toContain(serverId);
            expect(loggedLines(logSpies.info)).not.toContain('connected to channel server');

            // The zombie scope was removed so re-registration is not fighting it
            await manager.registerChannelServer(CHANNEL_ID, makeConfig());
            expect(manager.getServerStatusById(serverId)?.status).toBe('running');
        });

        it('starts a dead (stopped, restartOnCrash=false) server on agent join and re-discovers tools', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(CHANNEL_ID, makeConfig({ restartOnCrash: false }));
            const serverId = `${CHANNEL_ID}:fake-tools`;
            const firstPid = manager.getServerStatusById(serverId)?.pid;

            process.kill(firstPid!, 'SIGKILL');
            await waitFor(
                () => manager.getServerStatusById(serverId)?.status !== 'running',
                4000,
                'child death observed'
            );

            await manager.onAgentJoinChannel('agent-1', CHANNEL_ID);

            const status = manager.getServerStatusById(serverId);
            expect(status?.status).toBe('running');
            expect(status?.pid).not.toBe(firstPid);
            expect(manager.getAllExternalTools().map(t => t.name)).toContain('alpha_tool');
        });

        it('probes a running server at join and restarts it when the MCP connection is dead', async () => {
            const manager = track(makeManager({
                requestTimeoutsMs: { 'tools/list': 250 }
            }));
            await manager.registerChannelServer(
                CHANNEL_ID,
                makeConfig({ env: { FAKE_MODE: 'wedge-after-first-list' } })
            );
            const serverId = `${CHANNEL_ID}:fake-tools`;
            const firstPid = manager.getServerStatusById(serverId)?.pid;

            // Process is alive and status says 'running', but MCP is dead:
            // the join probe must notice and recover
            await manager.onAgentJoinChannel('agent-1', CHANNEL_ID);

            const status = manager.getServerStatusById(serverId);
            expect(status?.status).toBe('running');
            expect(status?.pid).not.toBe(firstPid);
        });
    });

    describe('unregistration', () => {
        it('unregisterServer removes global status, scope enumeration, and provider tools', async () => {
            const manager = track(makeManager());
            await manager.registerServer({
                ...makeConfig(),
                id: 'global-fake-tools'
            });

            expect(manager.getServerStatusById('global-fake-tools')).toBeDefined();
            expect(manager.getServersByScope('global').map(server => server.id))
                .toContain('global-fake-tools');
            expect(manager.getAllExternalTools().map(tool => tool.serverId))
                .toContain('global-fake-tools');

            await manager.unregisterServer('global-fake-tools');

            expect(manager.getServerStatusById('global-fake-tools')).toBeUndefined();
            expect(manager.getServersByScope('global').map(server => server.id))
                .not.toContain('global-fake-tools');
            expect(manager.getAllExternalTools().map(tool => tool.serverId))
                .not.toContain('global-fake-tools');
        });

        it('unregisterChannelServer removes record, scope, and keepAlive timer', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(CHANNEL_ID, makeConfig({ keepAliveMinutes: 60 } as any));
            const serverId = `${CHANNEL_ID}:fake-tools`;

            // Start a keepAlive timer by having the last agent leave
            await manager.onAgentJoinChannel('agent-1', CHANNEL_ID);
            await manager.onAgentLeaveChannel('agent-1', CHANNEL_ID);

            await manager.unregisterChannelServer(CHANNEL_ID, 'fake-tools');

            expect(manager.getServerStatusById(serverId)).toBeUndefined();

            // Fully re-registerable: no zombie scope, no stale keepAlive timer
            await manager.registerChannelServer(CHANNEL_ID, makeConfig());
            expect(manager.getServerStatusById(serverId)?.status).toBe('running');
        });

        it('unregisterChannelServer is idempotent and heals a zombie scope without throwing', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(CHANNEL_ID, makeConfig({ autoStart: false }));
            const serverId = `${CHANNEL_ID}:fake-tools`;

            // Production zombie state: record deleted, scope alive
            (manager as any).servers.delete(serverId);

            await expect(
                manager.unregisterChannelServer(CHANNEL_ID, 'fake-tools')
            ).resolves.toBeUndefined();

            // Second call on fully-clean state also resolves
            await expect(
                manager.unregisterChannelServer(CHANNEL_ID, 'fake-tools')
            ).resolves.toBeUndefined();

            // And the scope really is gone
            await manager.onAgentJoinChannel('agent-1', CHANNEL_ID);
            expect(loggedLines(logSpies.info)).not.toContain('connected to channel server');
        });

        it('permanently retires every runtime for a deleted channel', async () => {
            const manager = track(makeManager());
            await manager.registerChannelServer(
                CHANNEL_ID,
                makeConfig({ autoStart: false })
            );
            const serverId = `${CHANNEL_ID}:fake-tools`;

            await manager.retireChannel(CHANNEL_ID);

            expect(manager.getServerStatusById(serverId)).toBeUndefined();
            expect(manager.getServersByScope('channel', CHANNEL_ID)).toEqual([]);
            await expect(
                manager.registerChannelServer(
                    CHANNEL_ID,
                    makeConfig({ autoStart: false })
                )
            ).rejects.toThrow(/deleted/i);
        });
    });

    describe('health-check recovery', () => {
        it('restarts a wedged server after consecutive failed health probes', async () => {
            const manager = track(makeManager({
                requestTimeoutsMs: { 'tools/list': 150 }
            }));
            await manager.registerChannelServer(
                CHANNEL_ID,
                makeConfig({
                    healthCheckInterval: 200,
                    env: { FAKE_MODE: 'wedge-after-first-list' }
                })
            );
            const serverId = `${CHANNEL_ID}:fake-tools`;
            const firstPid = manager.getServerStatusById(serverId)?.pid;

            // Two consecutive failed probes (~200ms apart, 150ms timeout each)
            // must trigger a restart with a fresh process
            await waitFor(() => {
                const status = manager.getServerStatusById(serverId);
                return status?.pid !== undefined && status.pid !== firstPid && status.status === 'running';
            }, 4500, 'health-check driven restart');

            expect(loggedLines(logSpies.warn) + loggedLines(logSpies.error)).toContain(serverId);
        });
    });
});
