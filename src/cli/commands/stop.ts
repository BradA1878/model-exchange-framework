/**
 * MXF CLI Stop Command
 *
 * Stops Docker infrastructure containers (MongoDB, Meilisearch, Redis).
 * Falls back to a default docker-compose.yml path if no config file exists.
 *
 * Does NOT stop the MXF server — that must be stopped manually by the user.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as path from 'path';
import { Command } from 'commander';
import { ConfigService } from '../services/ConfigService';
import { InfraManager } from '../services/InfraManager';
import { HealthChecker } from '../services/HealthChecker';
import { logSuccess, logError, logInfo, logWarning, logHeader } from '../utils/output';

/**
 * Register the `mxf stop` command on the provided Commander program.
 */
export function registerStopCommand(program: Command): void {
    program
        .command('stop')
        .description('Stop MXF Docker infrastructure containers')
        .action(async () => {
            logHeader('MXF Stop');

            // Determine the compose file path from config or default
            const configService = ConfigService.getInstance();
            const config = configService.load();
            let composeFilePath: string;

            if (config) {
                composeFilePath = config.infrastructure.composeFilePath;
            } else {
                logWarning('No config found. Using default docker-compose.yml path.');
                composeFilePath = path.join(process.cwd(), 'docker-compose.yml');
            }

            // Stop infrastructure containers
            logInfo('Stopping infrastructure containers...');

            const infraManager = InfraManager.getInstance();
            await infraManager.stopInfra(composeFilePath);

            logSuccess('Infrastructure containers stopped.');

            // Check if the MXF server is still running
            const serverUrl = config
                ? `http://${config.server.host}:${config.server.port}`
                : 'http://localhost:3001';

            const serverRunning = await HealthChecker.getInstance().isServerRunning(serverUrl);
            if (serverRunning) {
                logWarning('MXF server may still be running. Stop it manually (Ctrl+C in the server terminal).');
            }
        });
}
