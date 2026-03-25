/**
 * MXF CLI Prerequisite Checks
 *
 * Verifies that required system dependencies (Docker, Docker Compose) are
 * installed and running before CLI operations that need them.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { PrerequisiteResult } from '../types/config';

const execAsync = promisify(exec);

/** Check if Docker CLI is installed */
export async function checkDocker(): Promise<PrerequisiteResult> {
    try {
        const { stdout } = await execAsync('docker --version');
        return {
            name: 'Docker',
            available: true,
            version: stdout.trim(),
        };
    } catch {
        return {
            name: 'Docker',
            available: false,
            errorMessage: 'Docker is not installed',
            helpUrl: 'https://docs.docker.com/get-docker/',
        };
    }
}

/** Check if the Docker daemon is running */
export async function checkDockerRunning(): Promise<PrerequisiteResult> {
    try {
        await execAsync('docker info', { timeout: 10000 });
        return {
            name: 'Docker Daemon',
            available: true,
        };
    } catch {
        return {
            name: 'Docker Daemon',
            available: false,
            errorMessage: 'Docker daemon is not running',
            helpUrl: 'Start Docker Desktop or run: sudo systemctl start docker',
        };
    }
}

/** Check if Docker Compose (v2 plugin) is available */
export async function checkDockerCompose(): Promise<PrerequisiteResult> {
    try {
        const { stdout } = await execAsync('docker compose version');
        return {
            name: 'Docker Compose',
            available: true,
            version: stdout.trim(),
        };
    } catch {
        return {
            name: 'Docker Compose',
            available: false,
            errorMessage: 'Docker Compose plugin not found',
            helpUrl: 'Docker Compose is included with Docker Desktop. For Linux: https://docs.docker.com/compose/install/',
        };
    }
}

/**
 * Run all prerequisite checks and return results.
 * Stops early if Docker itself is not installed.
 */
export async function checkAllPrerequisites(): Promise<{
    passed: boolean;
    results: PrerequisiteResult[];
}> {
    const results: PrerequisiteResult[] = [];

    // Check Docker installed
    const docker = await checkDocker();
    results.push(docker);
    if (!docker.available) {
        return { passed: false, results };
    }

    // Check Docker daemon running
    const daemon = await checkDockerRunning();
    results.push(daemon);
    if (!daemon.available) {
        return { passed: false, results };
    }

    // Check Docker Compose
    const compose = await checkDockerCompose();
    results.push(compose);
    if (!compose.available) {
        return { passed: false, results };
    }

    return { passed: true, results };
}
