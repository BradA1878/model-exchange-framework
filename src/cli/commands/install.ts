/**
 * MXF CLI Install Command
 *
 * Handles initial MXF infrastructure setup: prerequisite checks, credential
 * generation, Docker container management, user creation, and .env bridge writing.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as crypto from 'crypto';
import { Command } from 'commander';
import axios from 'axios';
import { ConfigService } from '../services/ConfigService';
import { InfraManager } from '../services/InfraManager';
import { HealthChecker } from '../services/HealthChecker';
import { logSuccess, logError, logInfo, logWarning, logHeader, logStep, logSection, maskSecret } from '../utils/output';
import { checkAllPrerequisites } from '../utils/prerequisites';

/**
 * Run Phase A: infrastructure setup (no server required).
 *
 * Steps: check prerequisites, generate credentials, write config,
 * start Docker containers, wait for healthy, write .env bridge file.
 */
async function runPhaseA(force: boolean): Promise<void> {
    logHeader('MXF Install');

    // Check prerequisites (Docker, Docker Compose)
    logInfo('Checking prerequisites...');
    const { passed, results } = await checkAllPrerequisites();

    if (!passed) {
        logError('Prerequisite checks failed:');
        for (const result of results) {
            if (!result.available) {
                logError(`  ${result.name}: ${result.errorMessage}`);
                if (result.helpUrl) {
                    logInfo(`  Help: ${result.helpUrl}`);
                }
            }
        }
        process.exit(1);
    }

    for (const result of results) {
        logSuccess(`${result.name} ${result.version ? `(${result.version})` : ''}`);
    }

    // Check if config already exists
    const configService = ConfigService.getInstance();
    if (configService.exists() && !force) {
        logWarning('MXF config already exists at ~/.mxf/config.json');
        logInfo('Use --force to overwrite the existing configuration.');
        process.exit(1);
    }

    // Step 1: Generate security credentials
    logStep(1, 5, 'Generating security credentials...');
    const config = configService.createDefault();
    logSuccess('Security credentials generated');

    // Step 2: Save config
    try {
        configService.save(config);
        logSuccess('Config saved to ~/.mxf/config.json');
    } catch (error) {
        logError(`Failed to save config: ${error}`);
        process.exit(1);
    }

    // Step 3: Start infrastructure containers
    logStep(2, 5, 'Starting infrastructure containers...');
    try {
        const infraManager = InfraManager.getInstance();
        const preStatus = await infraManager.getStatus();
        const alreadyRunning =
            preStatus.containers.mongodb.status === 'running' &&
            preStatus.containers.meilisearch.status === 'running' &&
            preStatus.containers.redis.status === 'running';

        await infraManager.startInfra(
            config.infrastructure.composeFilePath,
            configService.toEnvironmentVariables()
        );

        if (alreadyRunning) {
            logSuccess('Infrastructure containers already running');
        } else {
            logSuccess('Infrastructure containers started');
        }
    } catch (error) {
        logError(`Failed to start infrastructure: ${error}`);
        process.exit(1);
    }

    // Step 4: Wait for containers to become healthy
    logStep(3, 5, 'Waiting for containers to become healthy...');
    const healthy = await InfraManager.getInstance().waitForHealthy(60000);
    if (healthy) {
        logSuccess('All containers are healthy');
    } else {
        logWarning('Timed out waiting for containers to become healthy. They may still be starting.');
        logInfo('Run `mxf status` to check container health.');
    }

    // Step 5: Write .env bridge file
    logStep(4, 5, 'Writing .env bridge file...');
    try {
        configService.writeEnvFile(process.cwd());
        logSuccess('.env bridge file written to project root');
    } catch (error) {
        logError(`Failed to write .env file: ${error}`);
        process.exit(1);
    }

    logStep(5, 5, 'Phase A complete');

    // Print summary
    logSection('Install Summary');
    logInfo(`Domain Key:   ${maskSecret(config.credentials.domainKey)}`);
    logInfo(`Server Port:  ${config.server.port}`);
    logInfo(`MongoDB:      localhost:${config.infrastructure.mongodb.port}`);
    logInfo(`Meilisearch:  localhost:${config.infrastructure.meilisearch.port}`);
    logInfo(`Redis:        localhost:${config.infrastructure.redis.port}`);

    logSection('Next Steps');
    logInfo('1. Start the MXF server:          bun run dev');
    logInfo('2. Complete setup:                 bun run mxf install --complete-setup');
}

/**
 * Run Phase B: user creation and token generation (server required).
 *
 * Steps: verify server is running, create user via REST API,
 * generate PAT, save access token to config.
 */
async function runPhaseB(): Promise<void> {
    logHeader('MXF Install — Complete Setup');

    // Load and validate config
    const configService = ConfigService.getInstance();
    const config = configService.load();

    if (!config) {
        logError('No MXF config found. Run `mxf install` first (without --complete-setup).');
        process.exit(1);
    }

    const serverUrl = `http://${config.server.host}:${config.server.port}`;

    // Check server is running
    logInfo('Checking MXF server...');
    const running = await HealthChecker.getInstance().isServerRunning(serverUrl);

    if (!running) {
        logError('MXF server is not running.');
        logInfo('Start it with: bun run dev');
        process.exit(1);
    }

    logSuccess('MXF server is running');

    // Generate a password for the local user (hex-safe: only [0-9a-f])
    const password = crypto.randomBytes(16).toString('hex');

    // Step 1: Create local user
    logStep(1, 3, 'Creating local user...');
    let userCreated = false;

    try {
        await axios.post(
            `${serverUrl}/api/users/register`,
            {
                username: 'mxf-user',
                email: 'mxf-cli@mxf.dev',
                password,
                role: 'consumer',
            },
            {
                headers: { 'Content-Type': 'application/json' },
            },
        );
        userCreated = true;
        logSuccess('User "mxf-user" created');
    } catch (error: any) {
        if (error.response?.status === 409 || error.response?.status === 400) {
            logInfo('User "mxf-user" already exists, will log in instead');
        } else {
            const detail = error.response?.data?.message || error.response?.statusText || error.message;
            logError(`Failed to create user: ${detail} (status: ${error.response?.status || 'unknown'})`);
            process.exit(1);
        }
    }

    // Step 2: Generate access token
    logStep(2, 3, 'Generating access token...');

    let jwt: string;
    try {
        const loginResponse = await axios.post<{ data?: { token?: string }; token?: string }>(`${serverUrl}/api/users/login`, {
            username: 'mxf-cli@mxf.dev',
            password,
        });
        const receivedToken = loginResponse.data.data?.token || loginResponse.data.token;
        if (!receivedToken) {
            logError('Login succeeded but no JWT token was returned.');
            process.exit(1);
        }
        jwt = receivedToken;
        logSuccess('Logged in as mxf-user');
    } catch (error: any) {
        if (!userCreated) {
            logError('Cannot log in — user exists but password is unknown.');
            logInfo('If you need to re-create the user, reset the database with: bun run cleanup:db');
        } else {
            logError(`Failed to log in: ${error.response?.data?.message || error.message}`);
        }
        process.exit(1);
    }

    // Create Personal Access Token
    let tokenId: string;
    let secret: string;

    try {
        const tokenResponse = await axios.post<{ data: { tokenId: string; secret: string } }>(
            `${serverUrl}/api/tokens`,
            {
                name: 'MXF CLI Token',
                description: 'Auto-generated by mxf install',
            },
            {
                headers: { Authorization: `Bearer ${jwt}` },
            }
        );

        const tokenData = tokenResponse.data.data;
        tokenId = tokenData.tokenId;
        secret = tokenData.secret;

        if (!tokenId || !secret) {
            logError('Token creation succeeded but tokenId or secret was missing from response.');
            process.exit(1);
        }
        logSuccess('Personal Access Token created');
    } catch (error: any) {
        logError(`Failed to create access token: ${error.response?.data?.message || error.message}`);
        process.exit(1);
    }

    // Step 3: Save access token to config
    logStep(3, 3, 'Saving access token...');

    try {
        const accessToken = `${tokenId}:${secret}`;
        configService.set('user', {
            username: 'mxf-user',
            email: 'mxf-cli@mxf.dev',
            accessToken,
        });
        logSuccess('Access token saved to ~/.mxf/config.json');
    } catch (error) {
        logError(`Failed to save access token to config: ${error}`);
        process.exit(1);
    }

    // Update .env file with the new user token
    try {
        configService.writeEnvFile(process.cwd());
        logSuccess('.env bridge file updated');
    } catch (error) {
        logError(`Failed to update .env file: ${error}`);
        process.exit(1);
    }

    // Print summary
    logSection('Setup Complete');
    logInfo(`User:          mxf-user`);
    logInfo(`Access Token:  ${maskSecret(`${tokenId}:${secret}`)}`);

    logSection('Next Steps');
    logInfo("Run 'mxf init' to configure your LLM provider.");
}

/**
 * Register the `mxf install` command with the CLI program.
 *
 * Phase A (default): Sets up infrastructure without a running server.
 * Phase B (--complete-setup): Creates a user and PAT against the running server.
 */
export function registerInstallCommand(program: Command): void {
    program
        .command('install')
        .description('Set up MXF infrastructure, generate credentials, and create a user')
        .option('--force', 'Overwrite existing configuration')
        .option('--complete-setup', 'Complete setup by creating a user (requires running server)')
        .action(async (options: { force?: boolean; completeSetup?: boolean }) => {
            try {
                if (options.completeSetup) {
                    await runPhaseB();
                } else {
                    await runPhaseA(options.force === true);
                }
            } catch (error) {
                logError(`Install failed: ${error}`);
                process.exit(1);
            }
        });
}
