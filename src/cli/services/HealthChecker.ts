/**
 * MXF CLI Health Checker
 *
 * Checks the health of the MXF server and infrastructure services.
 * Uses the server's GET /health endpoint and Docker container health status.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import axios from 'axios';
import { ServerHealth } from '../types/config';

export class HealthChecker {
    private static instance: HealthChecker;

    static getInstance(): HealthChecker {
        if (!HealthChecker.instance) {
            HealthChecker.instance = new HealthChecker();
        }
        return HealthChecker.instance;
    }

    /**
     * Check if the MXF server is running and healthy.
     * Hits GET /health which returns { status, timestamp, uptime, environment, version, servers }.
     */
    async checkServer(serverUrl: string): Promise<ServerHealth> {
        try {
            const response = await axios.get<{
                status?: string;
                uptime?: number;
                environment?: string;
                version?: string;
            }>(`${serverUrl}/health`, { timeout: 5000 });
            const data = response.data;
            return {
                reachable: true,
                status: data.status || 'unknown',
                uptime: data.uptime || 0,
                environment: data.environment || 'unknown',
                version: data.version || 'unknown',
            };
        } catch {
            return {
                reachable: false,
                status: 'unreachable',
                uptime: 0,
                environment: 'unknown',
                version: 'unknown',
            };
        }
    }

    /**
     * Check if the MXF server is reachable on the given URL.
     * Lightweight check — just confirms the health endpoint responds.
     */
    async isServerRunning(serverUrl: string): Promise<boolean> {
        try {
            const response = await axios.get<{ status?: string }>(`${serverUrl}/health`, { timeout: 3000 });
            return response.status === 200 && response.data?.status === 'ok';
        } catch {
            return false;
        }
    }

    /**
     * Check if Meilisearch is healthy via its HTTP health endpoint.
     */
    async checkMeilisearch(host: string, port: number): Promise<boolean> {
        try {
            const response = await axios.get<{ status?: string }>(`http://${host}:${port}/health`, { timeout: 3000 });
            return response.data?.status === 'available';
        } catch {
            return false;
        }
    }
}
