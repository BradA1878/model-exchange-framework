import { Application, Request, Response } from 'express';

export type ServerLifecycleState = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface ServerDependencyState {
    api: boolean;
    socket: boolean;
    database: boolean;
}

export interface ServerHealthMetadata {
    environment: string;
    version: string;
    port: number;
}

export interface ServerHealthReport {
    status: 'ok' | 'not_ready';
    lifecycle: ServerLifecycleState;
    timestamp: string;
    uptime: number;
    environment: string;
    version: string;
    servers: {
        api: { status: 'running' | 'not_running'; port: number };
        socket: { status: 'running' | 'not_running'; port: number };
        database: { status: 'connected' | 'not_connected' };
    };
}

/** Authoritative process lifecycle used by readiness and termination paths. */
export class ServerRuntimeState {
    private lifecycle: ServerLifecycleState = 'starting';

    public markReady(): void {
        if (this.lifecycle !== 'starting') {
            throw new Error(`Cannot mark server ready from '${this.lifecycle}'`);
        }
        this.lifecycle = 'ready';
    }

    public markStopping(): void {
        if (this.lifecycle !== 'failed' && this.lifecycle !== 'stopped') {
            this.lifecycle = 'stopping';
        }
    }

    public markStopped(): void {
        if (this.lifecycle !== 'failed') {
            this.lifecycle = 'stopped';
        }
    }

    public markFailed(): void {
        this.lifecycle = 'failed';
    }

    public getLifecycle(): ServerLifecycleState {
        return this.lifecycle;
    }

    /**
     * Process exit code for the lifecycle reached so far. 'failed' is sticky,
     * so a shutdown that completes after a failure (for example a SIGTERM that
     * lands while an initialization failure is already shutting down) still
     * reports the failure.
     */
    public getExitCode(): 0 | 1 {
        return this.lifecycle === 'failed' ? 1 : 0;
    }

    public getHealthReport(
        dependencies: ServerDependencyState,
        metadata: ServerHealthMetadata
    ): ServerHealthReport {
        const ready = this.lifecycle === 'ready' &&
            dependencies.api &&
            dependencies.socket &&
            dependencies.database;

        return {
            status: ready ? 'ok' : 'not_ready',
            lifecycle: this.lifecycle,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: metadata.environment,
            version: metadata.version,
            servers: {
                api: {
                    status: dependencies.api ? 'running' : 'not_running',
                    port: metadata.port
                },
                socket: {
                    status: dependencies.socket ? 'running' : 'not_running',
                    port: metadata.port
                },
                database: {
                    status: dependencies.database ? 'connected' : 'not_connected'
                }
            }
        };
    }
}

/** Mount unauthenticated liveness/readiness routes with an injected dependency probe. */
export const registerServerHealthRoutes = (
    app: Application,
    runtime: ServerRuntimeState,
    getDependencies: () => ServerDependencyState,
    metadata: ServerHealthMetadata
): void => {
    const readinessHandler = (_request: Request, response: Response): void => {
        const report = runtime.getHealthReport(getDependencies(), metadata);
        response.status(report.status === 'ok' ? 200 : 503).json(report);
    };

    app.get('/health', readinessHandler);
    app.get('/health/ready', readinessHandler);
    app.get('/health/live', (_request: Request, response: Response): void => {
        const lifecycle = runtime.getLifecycle();
        const live = lifecycle !== 'failed' && lifecycle !== 'stopped';
        response.status(live ? 200 : 503).json({
            status: live ? 'ok' : 'failed',
            lifecycle,
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });
};
