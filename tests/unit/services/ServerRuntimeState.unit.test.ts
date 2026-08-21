import { Application, Request, RequestHandler, Response } from 'express';
import {
    registerServerHealthRoutes,
    ServerDependencyState,
    ServerRuntimeState
} from '../../../src/server/services/ServerRuntimeState';

interface CapturedResponse {
    status: number;
    body: Record<string, unknown>;
}

describe('ServerRuntimeState health routes', () => {
    const metadata = {
        environment: 'test',
        version: '2.5.5',
        port: 3001
    };

    const buildRoutes = (
        runtime: ServerRuntimeState,
        dependencies: ServerDependencyState
    ): ((path: string) => CapturedResponse) => {
        const handlers = new Map<string, RequestHandler>();
        const app = {
            get: (path: string, handler: RequestHandler): Application => {
                handlers.set(path, handler);
                return app as unknown as Application;
            }
        } as unknown as Application;
        registerServerHealthRoutes(app, runtime, () => dependencies, metadata);

        return (path: string): CapturedResponse => {
            const handler = handlers.get(path);
            if (!handler) {
                throw new Error(`No captured health handler for ${path}`);
            }

            let status = 0;
            let body: Record<string, unknown> = {};
            const response = {
                status: (value: number): Response => {
                    status = value;
                    return response as unknown as Response;
                },
                json: (value: Record<string, unknown>): Response => {
                    body = value;
                    return response as unknown as Response;
                }
            } as unknown as Response;
            handler({} as Request, response, (): void => undefined);
            return { status, body };
        };
    };

    it('fails readiness while startup is incomplete and identifies each dependency', () => {
        const runtime = new ServerRuntimeState();
        const response = buildRoutes(runtime, {
            api: true,
            socket: false,
            database: false
        })('/health');

        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
            status: 'not_ready',
            lifecycle: 'starting',
            environment: 'test',
            version: '2.5.5',
            servers: {
                api: { status: 'running', port: 3001 },
                socket: { status: 'not_running', port: 3001 },
                database: { status: 'not_connected' }
            }
        });
    });

    it('reports ready only when lifecycle and every required dependency are ready', () => {
        const runtime = new ServerRuntimeState();
        runtime.markReady();
        const dependencies: ServerDependencyState = {
            api: true,
            socket: true,
            database: true
        };
        const request = buildRoutes(runtime, dependencies);

        const ready = request('/health/ready');
        expect(ready.status).toBe(200);
        expect(ready.body.status).toBe('ok');

        dependencies.database = false;
        const degraded = request('/health/ready');
        expect(degraded.status).toBe(503);
        expect(degraded.body).toMatchObject({
            status: 'not_ready',
            lifecycle: 'ready',
            servers: { database: { status: 'not_connected' } }
        });
    });

    it('removes a stopping process from readiness while preserving liveness', () => {
        const runtime = new ServerRuntimeState();
        runtime.markReady();
        runtime.markStopping();
        const request = buildRoutes(runtime, { api: true, socket: true, database: true });

        expect(request('/health/ready').status).toBe(503);
        expect(request('/health/live')).toMatchObject({
            status: 200,
            body: { status: 'ok', lifecycle: 'stopping' }
        });

        runtime.markFailed();
        expect(request('/health/live')).toMatchObject({
            status: 503,
            body: { status: 'failed', lifecycle: 'failed' }
        });
    });

    it('rejects an impossible ready transition after termination begins', () => {
        const runtime = new ServerRuntimeState();
        runtime.markStopping();
        expect(() => runtime.markReady()).toThrow("from 'stopping'");
    });
});

describe('ServerRuntimeState exit code', () => {
    it('exits cleanly after an orderly stop', () => {
        const runtime = new ServerRuntimeState();
        runtime.markReady();
        runtime.markStopping();
        runtime.markStopped();
        expect(runtime.getExitCode()).toBe(0);
    });

    it('keeps a failure exit code when a signal-driven stop completes after the failure', () => {
        // An initialization failure starts the shutdown; SIGTERM arrives while it
        // is still running and its continuation settles last. The process must
        // still exit non-zero.
        const runtime = new ServerRuntimeState();
        runtime.markFailed();
        runtime.markStopping();
        runtime.markStopped();
        expect(runtime.getLifecycle()).toBe('failed');
        expect(runtime.getExitCode()).toBe(1);
    });
});
