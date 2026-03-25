/**
 * MXF CLI Infrastructure Manager
 *
 * Manages Docker infrastructure containers (MongoDB, Meilisearch, Redis) for MXF.
 * Uses the dockerode library (already a project dependency) for container status checks
 * and shells out to `docker compose` for start/stop operations since docker-compose.yml
 * already defines all the container configuration.
 *
 * Does NOT manage the MXF server process — that is the user's responsibility
 * (per CLAUDE.md: "NEVER run the MXF server in a background process").
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import Docker from 'dockerode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ContainerStatus, InfraStatus } from '../types/config';

const execAsync = promisify(exec);

/** Container names as defined in docker-compose.yml */
const CONTAINER_NAMES = {
    mongodb: 'mxf-mongodb',
    meilisearch: 'mxf-meilisearch',
    redis: 'mxf-redis',
} as const;

/** Default ports as defined in docker-compose.yml */
const DEFAULT_PORTS = {
    mongodb: 27017,
    meilisearch: 7700,
    redis: 6379,
} as const;

export class InfraManager {
    private static instance: InfraManager;
    private docker: Docker;

    constructor() {
        this.docker = new Docker();
    }

    static getInstance(): InfraManager {
        if (!InfraManager.instance) {
            InfraManager.instance = new InfraManager();
        }
        return InfraManager.instance;
    }

    /**
     * Check if Docker is installed and the daemon is running.
     */
    async checkDocker(): Promise<{ installed: boolean; running: boolean }> {
        try {
            await this.docker.ping();
            return { installed: true, running: true };
        } catch (error: any) {
            // If we get a connection error, Docker might be installed but not running
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') {
                // Check if docker CLI exists
                try {
                    await execAsync('docker --version');
                    return { installed: true, running: false };
                } catch {
                    return { installed: false, running: false };
                }
            }
            return { installed: false, running: false };
        }
    }

    /**
     * Get the status of a specific container by name.
     * Uses dockerode to inspect container state and health.
     */
    private async getContainerStatus(containerName: string, port: number): Promise<ContainerStatus> {
        try {
            const container = this.docker.getContainer(containerName);
            const info = await container.inspect();

            const running = info.State.Running;
            const healthStatus = info.State.Health?.Status;

            let health: ContainerStatus['health'] = 'unknown';
            if (healthStatus === 'healthy') health = 'healthy';
            else if (healthStatus === 'unhealthy') health = 'unhealthy';
            else if (healthStatus === 'starting') health = 'starting';
            else if (!info.State.Health) health = 'none';

            return {
                name: containerName,
                status: running ? 'running' : 'stopped',
                port,
                health: running ? health : 'unknown',
            };
        } catch (error: any) {
            // Container not found (404) or other error
            return {
                name: containerName,
                status: 'not_found',
                port,
                health: 'unknown',
            };
        }
    }

    /**
     * Get status of all infrastructure containers.
     */
    async getStatus(): Promise<InfraStatus> {
        const dockerStatus = await this.checkDocker();

        if (!dockerStatus.running) {
            return {
                docker: dockerStatus,
                containers: {
                    mongodb: { name: CONTAINER_NAMES.mongodb, status: 'not_found', port: DEFAULT_PORTS.mongodb, health: 'unknown' },
                    meilisearch: { name: CONTAINER_NAMES.meilisearch, status: 'not_found', port: DEFAULT_PORTS.meilisearch, health: 'unknown' },
                    redis: { name: CONTAINER_NAMES.redis, status: 'not_found', port: DEFAULT_PORTS.redis, health: 'unknown' },
                },
            };
        }

        // Check all containers in parallel
        const [mongodb, meilisearch, redis] = await Promise.all([
            this.getContainerStatus(CONTAINER_NAMES.mongodb, DEFAULT_PORTS.mongodb),
            this.getContainerStatus(CONTAINER_NAMES.meilisearch, DEFAULT_PORTS.meilisearch),
            this.getContainerStatus(CONTAINER_NAMES.redis, DEFAULT_PORTS.redis),
        ]);

        return {
            docker: dockerStatus,
            containers: { mongodb, meilisearch, redis },
        };
    }

    /**
     * Start infrastructure containers (MongoDB, Meilisearch, Redis).
     * Checks if containers are already running before starting.
     * Matches the existing docker:infra:up script pattern from package.json.
     *
     * @param composeFilePath - Path to docker-compose.yml
     * @param envVars - Environment variables to pass to docker compose
     */
    async startInfra(composeFilePath: string, envVars: Record<string, string>): Promise<void> {
        // Check if containers are already running (same logic as docker:infra:up script)
        const status = await this.getStatus();
        const allRunning =
            status.containers.mongodb.status === 'running' &&
            status.containers.meilisearch.status === 'running' &&
            status.containers.redis.status === 'running';

        if (allRunning) {
            return; // Containers already running, nothing to do
        }

        const composeDir = path.dirname(composeFilePath);
        const composeFile = path.basename(composeFilePath);
        const env = { ...process.env, ...envVars };

        try {
            await execAsync(
                `docker compose --project-name mxf -f "${composeFile}" up -d mongodb meilisearch redis`,
                { cwd: composeDir, env, timeout: 60000 }
            );
        } catch (error: any) {
            throw new Error(`Failed to start infrastructure: ${error.stderr || error.message}`);
        }
    }

    /**
     * Stop infrastructure containers.
     *
     * @param composeFilePath - Path to docker-compose.yml
     */
    async stopInfra(composeFilePath: string): Promise<void> {
        const composeDir = path.dirname(composeFilePath);
        const composeFile = path.basename(composeFilePath);

        try {
            await execAsync(
                `docker compose --project-name mxf -f "${composeFile}" stop mongodb meilisearch redis`,
                { cwd: composeDir, timeout: 30000 }
            );
        } catch (error: any) {
            throw new Error(`Failed to stop infrastructure: ${error.stderr || error.message}`);
        }
    }

    /**
     * Wait for all infrastructure containers to become healthy.
     * Polls container health status at 2-second intervals.
     *
     * @param timeoutMs - Maximum time to wait (default: 60 seconds)
     * @returns true if all containers are healthy, false on timeout
     */
    async waitForHealthy(timeoutMs: number = 60000): Promise<boolean> {
        const startTime = Date.now();
        const pollInterval = 2000;

        while (Date.now() - startTime < timeoutMs) {
            const status = await this.getStatus();

            const allRunning =
                status.containers.mongodb.status === 'running' &&
                status.containers.meilisearch.status === 'running' &&
                status.containers.redis.status === 'running';

            if (!allRunning) {
                await this.sleep(pollInterval);
                continue;
            }

            // Check health (containers without health checks report 'none' which is fine)
            const allHealthy =
                (status.containers.mongodb.health === 'healthy' || status.containers.mongodb.health === 'none') &&
                (status.containers.meilisearch.health === 'healthy' || status.containers.meilisearch.health === 'none') &&
                (status.containers.redis.health === 'healthy' || status.containers.redis.health === 'none');

            if (allHealthy) {
                return true;
            }

            await this.sleep(pollInterval);
        }

        return false;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
