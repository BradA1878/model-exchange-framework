import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type OwnedSubprocess = ReturnType<typeof Bun.spawn>;

export interface OwnedGameDemoConfig {
    demoDirectory: string;
    dashboardPort: number;
    name: string;
    tensorflowEnabled?: boolean;
}

const requirePath = (path: string, installHint: string): void => {
    if (!existsSync(path)) {
        throw new Error(`Required demo path is missing: ${path}. ${installHint}`);
    }
};

/** Run an agent/game process and its Vite client under one lifecycle owner. */
export const runOwnedGameDemo = async (config: OwnedGameDemoConfig): Promise<void> => {
    const demoDirectory = resolve(config.demoDirectory);
    const repositoryRoot = resolve(demoDirectory, '..', '..');
    const agentEntrypoint = resolve(demoDirectory, 'connect-agents.ts');
    const clientDirectory = resolve(demoDirectory, 'client');
    const viteEntrypoint = resolve(clientDirectory, 'node_modules', 'vite', 'bin', 'vite.js');
    const children = new Set<OwnedSubprocess>();
    let shutdownPromise: Promise<void> | undefined;
    let receivedSignal: NodeJS.Signals | undefined;

    requirePath(agentEntrypoint, `Restore the ${config.name} agent entrypoint.`);
    requirePath(
        viteEntrypoint,
        `Run \`bun install\` in ${clientDirectory} before starting the dashboard.`
    );

    const spawnOwned = (command: string[], cwd: string): OwnedSubprocess => {
        const child = Bun.spawn({
            cmd: command,
            cwd,
            env: {
                ...process.env,
                NODE_ENV: 'development',
                ...(config.tensorflowEnabled ? { TENSORFLOW_ENABLED: 'true' } : {})
            },
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit'
        });
        children.add(child);
        return child;
    };

    const shutdownChildren = (): Promise<void> => {
        if (!shutdownPromise) {
            shutdownPromise = (async (): Promise<void> => {
                for (const child of children) {
                    if (child.exitCode === null) {
                        child.kill();
                    }
                }
                await Promise.all([...children].map(async (child): Promise<void> => {
                    await child.exited;
                }));
            })();
        }
        return shutdownPromise;
    };

    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const installSignalHandler = (signal: NodeJS.Signals, exitCode: number): void => {
        const handler = (): void => {
            receivedSignal = signal;
            void shutdownChildren().then(
                (): void => { process.exitCode = exitCode; },
                (error: unknown): void => {
                    process.stderr.write(
                        `${config.name} shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`
                    );
                    process.exitCode = 1;
                }
            );
        };
        signalHandlers.set(signal, handler);
        process.once(signal, handler);
    };

    installSignalHandler('SIGINT', 130);
    installSignalHandler('SIGTERM', 143);

    try {
        const agents = spawnOwned(['bun', agentEntrypoint], repositoryRoot);
        const dashboard = spawnOwned([
            'bun', viteEntrypoint, '--port', String(config.dashboardPort), '--strictPort'
        ], clientDirectory);
        const firstExit = await Promise.race([
            agents.exited.then((exitCode): { name: string; exitCode: number } => ({
                name: 'agent/game process',
                exitCode
            })),
            dashboard.exited.then((exitCode): { name: string; exitCode: number } => ({
                name: 'dashboard process',
                exitCode
            }))
        ]);

        await shutdownChildren();
        if (!receivedSignal && firstExit.exitCode !== 0) {
            throw new Error(`${firstExit.name} exited with code ${firstExit.exitCode}`);
        }
    } finally {
        for (const [signal, handler] of signalHandlers) {
            process.off(signal, handler);
        }
        await shutdownChildren();
    }
};

/** Launch from a package script and make failures visible to the shell. */
export const launchOwnedGameDemo = (config: OwnedGameDemoConfig): void => {
    void runOwnedGameDemo(config).catch((error: unknown): void => {
        process.stderr.write(
            `${config.name} demo failed: ${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    });
};
