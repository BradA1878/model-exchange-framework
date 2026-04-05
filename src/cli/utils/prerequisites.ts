/**
 * MXF CLI Prerequisite Checks
 *
 * Verifies that required system dependencies (Rust, Docker, Docker Compose)
 * are installed and running before CLI operations that need them.
 * Offers to install Rust automatically via rustup if missing.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PrerequisiteResult } from '../types/config';

const execAsync = promisify(exec);

/**
 * Ensure cargo env is sourced so Rust tools are on PATH.
 * This is a no-op if cargo is already available.
 */
function ensureCargoEnv(): void {
    const cargoEnv = join(homedir(), '.cargo', 'env');
    if (existsSync(cargoEnv)) {
        try {
            // Source the env file and extract PATH updates
            const result = execSync(`. "${cargoEnv}" && echo "$PATH"`, { shell: '/bin/sh', encoding: 'utf-8' });
            process.env.PATH = result.trim();
        } catch {
            // Best-effort — cargo may already be on PATH
        }
    }
}

/** Check if Rust/Cargo is installed (needed for Tauri desktop builds) */
export async function checkRust(): Promise<PrerequisiteResult> {
    ensureCargoEnv();
    try {
        const { stdout } = await execAsync('rustc --version');
        return {
            name: 'Rust',
            available: true,
            version: stdout.trim(),
        };
    } catch {
        return {
            name: 'Rust',
            available: false,
            errorMessage: 'Rust is not installed (needed for Tauri desktop app)',
            helpUrl: 'https://rustup.rs/',
        };
    }
}

/**
 * Install Rust via rustup (non-interactive).
 * Returns true if installation succeeded.
 */
export async function installRust(): Promise<boolean> {
    try {
        // Download and run rustup with default options, no prompts
        execSync('curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y', {
            shell: '/bin/sh',
            stdio: 'inherit',
            timeout: 300000, // 5 minute timeout
        });

        // Source the newly installed cargo env
        ensureCargoEnv();
        return true;
    } catch {
        return false;
    }
}

/**
 * Ensure the user's shell profile sources cargo env on login.
 * Adds `. "$HOME/.cargo/env"` to ~/.zshrc or ~/.bashrc if not already present.
 */
export function ensureCargoInShellProfile(): void {
    const shell = process.env.SHELL || '/bin/zsh';
    const rcFile = shell.includes('zsh')
        ? join(homedir(), '.zshrc')
        : join(homedir(), '.bashrc');

    try {
        const { readFileSync, appendFileSync } = require('fs');
        const contents = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8') : '';
        if (!contents.includes('.cargo/env')) {
            appendFileSync(rcFile, '\n# Rust/Cargo environment (added by mxf install)\n. "$HOME/.cargo/env"\n');
        }
    } catch {
        // Non-critical — user can add manually
    }
}

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
 * Checks Rust, Docker, Docker daemon, and Docker Compose.
 * Rust is checked first — if missing, the caller can offer to install it.
 */
export async function checkAllPrerequisites(): Promise<{
    passed: boolean;
    results: PrerequisiteResult[];
}> {
    const results: PrerequisiteResult[] = [];

    // Check Rust (needed for Tauri desktop builds)
    const rust = await checkRust();
    results.push(rust);
    if (!rust.available) {
        return { passed: false, results };
    }

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
