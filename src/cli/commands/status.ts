/**
 * MXF CLI Status Command
 *
 * Displays comprehensive health information about MXF infrastructure,
 * server status, and configuration. Checks Docker containers, the MXF
 * server health endpoint, and validates the local config file.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import { ConfigService } from '../services/ConfigService';
import { InfraManager } from '../services/InfraManager';
import { HealthChecker } from '../services/HealthChecker';
import { logHeader, logSection, logStatus, logKeyValue, logError, logWarning, maskSecret } from '../utils/output';
import { ContainerStatus } from '../types/config';

/**
 * Convert an uptime in seconds to a human-readable string.
 * Examples: '2h 15m', '45s', '3d 4h', '1m 30s'
 */
function formatUptime(seconds: number): string {
    if (seconds < 60) {
        return `${Math.floor(seconds)}s`;
    }

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.join(' ') || '0s';
}

/**
 * Map a container status string to a logStatus-compatible status value.
 */
function mapContainerStatus(container: ContainerStatus): 'running' | 'stopped' | 'error' | 'unknown' {
    if (container.status === 'running') return 'running';
    if (container.status === 'stopped') return 'stopped';
    if (container.status === 'not_found') return 'unknown';
    return 'unknown';
}

/**
 * Register the `mxf status` command on the provided Commander program.
 */
export function registerStatusCommand(program: Command): void {
    program
        .command('status')
        .description('Display MXF infrastructure, server, and configuration status')
        .action(async () => {
            logHeader('MXF Status');

            const configService = ConfigService.getInstance();
            const config = configService.load();

            if (!config) {
                logWarning('No config found. Run `mxf install`.');
            }

            // --- Infrastructure ---
            logSection('Infrastructure');

            const infraStatus = await InfraManager.getInstance().getStatus();

            logStatus('Docker', infraStatus.docker.running ? 'running' : 'stopped');
            logStatus(
                'MongoDB',
                mapContainerStatus(infraStatus.containers.mongodb),
                `port ${infraStatus.containers.mongodb.port}, ${infraStatus.containers.mongodb.health}`
            );
            logStatus(
                'Meilisearch',
                mapContainerStatus(infraStatus.containers.meilisearch),
                `port ${infraStatus.containers.meilisearch.port}, ${infraStatus.containers.meilisearch.health}`
            );
            logStatus(
                'Redis',
                mapContainerStatus(infraStatus.containers.redis),
                `port ${infraStatus.containers.redis.port}, ${infraStatus.containers.redis.health}`
            );

            // --- Server ---
            logSection('Server');

            if (config) {
                const serverUrl = `http://${config.server.host}:${config.server.port}`;
                const health = await HealthChecker.getInstance().checkServer(serverUrl);

                if (health.reachable) {
                    logStatus(
                        'MXF Server',
                        'running',
                        `port ${config.server.port}, uptime: ${formatUptime(health.uptime)}`
                    );
                } else {
                    logStatus('MXF Server', 'stopped');
                }
            } else {
                logStatus('MXF Server', 'unknown', 'no config — cannot determine server URL');
            }

            // --- Configuration ---
            logSection('Configuration');

            if (config) {
                logKeyValue('Config', configService.getConfigPath());
                logKeyValue('LLM Provider', config.llm?.provider || 'not configured');
                logKeyValue('Default Model', config.llm?.defaultModel || 'not configured');
                logKeyValue('Domain Key', maskSecret(config.credentials.domainKey));
                logKeyValue('User', config.user?.email || 'not created');

                // Validate config and report any issues
                const validation = configService.validate();
                if (!validation.valid) {
                    console.log('');
                    for (const error of validation.errors) {
                        logWarning(error);
                    }
                }
            } else {
                logKeyValue('Config', 'not found');
            }
        });
}
