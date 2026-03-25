/**
 * MXF CLI Start Command
 *
 * Starts Docker infrastructure containers (MongoDB, Meilisearch, Redis),
 * waits for them to become healthy, and writes the .env bridge file so
 * `bun run dev` can pick up the correct environment variables.
 *
 * Does NOT start the MXF server itself — that is the user's responsibility.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import { ConfigService } from '../services/ConfigService';
import { InfraManager } from '../services/InfraManager';
import { logSuccess, logError, logInfo, logWarning, logHeader, logStep } from '../utils/output';
import { checkAllPrerequisites } from '../utils/prerequisites';

/**
 * Register the `mxf start` command on the provided Commander program.
 */
export function registerStartCommand(program: Command): void {
    program
        .command('start')
        .description('Start MXF Docker infrastructure containers')
        .action(async () => {
            logHeader('MXF Start');

            // Load and validate config
            const configService = ConfigService.getInstance();
            const config = configService.load();

            if (!config) {
                logError('No config found. Run `mxf install` first.');
                process.exit(1);
            }

            const validation = configService.validate();
            if (!validation.valid) {
                logError('Configuration is invalid:');
                for (const error of validation.errors) {
                    logWarning(`  ${error}`);
                }
                process.exit(1);
            }

            // Check prerequisites (Docker, Docker Compose)
            const prereqs = await checkAllPrerequisites();
            if (!prereqs.passed) {
                logError('Prerequisites not met:');
                for (const result of prereqs.results) {
                    if (!result.available) {
                        logError(`  ${result.name}: ${result.errorMessage}`);
                        if (result.helpUrl) {
                            logInfo(`  ${result.helpUrl}`);
                        }
                    }
                }
                process.exit(1);
            }

            // Step 1: Start infrastructure containers
            logStep(1, 3, 'Starting infrastructure containers...');

            const infraManager = InfraManager.getInstance();
            const envVars = configService.toEnvironmentVariables();

            await infraManager.startInfra(config.infrastructure.composeFilePath, envVars);

            // Step 2: Wait for containers to become healthy
            logStep(2, 3, 'Waiting for containers to become healthy...');

            const healthy = await infraManager.waitForHealthy(60000);
            if (!healthy) {
                logWarning('Some containers may not be fully healthy yet. Check with `mxf status`.');
            }

            // Step 3: Write .env bridge file
            logStep(3, 3, 'Writing .env bridge file...');

            configService.writeEnvFile(process.cwd());

            logSuccess('Infrastructure started.');
            logInfo('Start the MXF server with: bun run dev');
        });
}
