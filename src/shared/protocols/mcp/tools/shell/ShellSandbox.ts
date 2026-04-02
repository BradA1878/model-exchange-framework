/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * ShellSandbox.ts
 *
 * Docker-based sandboxing for shell commands, reusing the existing
 * ContainerExecutionManager infrastructure for Docker availability checks.
 *
 * Security Model:
 * - Container isolation is the PRIMARY security barrier
 * - No network access by default (opt-in via config)
 * - Read-only root filesystem with tmpfs /tmp
 * - Runs as non-root user (1000:1000)
 * - All Linux capabilities dropped
 * - Resource limits (memory, CPU, PID)
 * - No new privileges escalation
 *
 * The sandbox is opt-in: enabled defaults to false for backward compatibility.
 * When Docker is unavailable, execution fails with an error — there is no
 * silent fallback to host execution.
 */

import crypto from 'crypto';
import Docker from 'dockerode';
import { Logger } from '../../../../utils/Logger';
import { ContainerExecutionManager } from '../../../../services/ContainerExecutionManager';

const logger = new Logger('info', 'ShellSandbox', 'server');

/** Docker image used for shell sandbox containers */
const SHELL_EXECUTOR_IMAGE = 'mxf/shell-executor:latest';

/**
 * Configuration for the shell sandbox.
 * Controls Docker container behavior for sandboxed shell execution.
 */
export interface ShellSandboxConfig {
    /** Whether sandbox mode is enabled. Default: false (opt-in) */
    enabled: boolean;
    /** Whether the sandboxed container has network access. Default: false */
    networkAccess: boolean;
    /** Paths to mount as read-write inside the container */
    writablePaths: string[];
    /** Custom mount configurations */
    mountPaths: Array<{
        host: string;
        container: string;
        readOnly: boolean;
    }>;
    /** Memory limit in MB for the container. Default: 256 */
    memoryLimit: number;
    /** CPU limit (fractional cores). Default: 1.0 */
    cpuLimit: number;
}

/**
 * Result from sandboxed shell command execution.
 */
export interface SandboxedShellResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    executionTime: number;
    sandboxed: true;
}

/**
 * Default shell sandbox configuration.
 * Sandbox is opt-in (enabled: false) to maintain backward compatibility.
 * All security constraints are maximally restrictive by default.
 */
export const DEFAULT_SHELL_SANDBOX_CONFIG: ShellSandboxConfig = {
    enabled: false,
    networkAccess: false,
    writablePaths: [],
    mountPaths: [],
    memoryLimit: 256,
    cpuLimit: 1.0
};

/**
 * Check if the shell sandbox is available (Docker is accessible and image exists).
 *
 * Attempts to initialize the ContainerExecutionManager if it has not already
 * been initialized, then verifies that Docker is reachable.
 *
 * @returns true if Docker is available and the shell-executor image can be used
 */
export async function isSandboxAvailable(): Promise<boolean> {
    try {
        const manager = ContainerExecutionManager.getInstance();

        // Initialize if not already done — this checks Docker daemon connectivity
        if (!manager.isInitialized()) {
            await manager.initialize();
        }

        return manager.isDockerAvailable();
    } catch (error: any) {
        logger.warn(`Shell sandbox availability check failed: ${error.message}`);
        return false;
    }
}

/**
 * Execute a shell command inside a Docker sandbox container.
 * Uses an Alpine-based container with common CLI tools.
 *
 * The container:
 * - Has no network access by default
 * - Runs as non-root user (1000:1000)
 * - Has a read-only root filesystem
 * - Has /tmp mounted as writable tmpfs
 * - Drops all Linux capabilities
 * - Has resource limits (memory, CPU)
 *
 * @param command - The shell command to execute
 * @param config - Partial sandbox configuration (merged with defaults)
 * @param options - Execution options (timeout, working directory, environment)
 * @returns The execution result including stdout, stderr, exit code, and timing
 * @throws Error if Docker is not available or the shell-executor image is missing
 */
export async function executeInSandbox(
    command: string,
    config: Partial<ShellSandboxConfig>,
    options: {
        timeout?: number;
        workingDirectory?: string;
        environment?: Record<string, string>;
    } = {}
): Promise<SandboxedShellResult> {
    const startTime = Date.now();

    // Merge provided config with defaults
    const mergedConfig: ShellSandboxConfig = {
        ...DEFAULT_SHELL_SANDBOX_CONFIG,
        ...config
    };

    // Verify Docker is available — fail fast, never fall back to host execution
    const available = await isSandboxAvailable();
    if (!available) {
        throw new Error('Shell sandbox requires Docker but Docker is not available');
    }

    // Check if the shell-executor image exists
    const imageExists = await checkShellExecutorImageExists();
    if (!imageExists) {
        logger.error(
            `Docker image ${SHELL_EXECUTOR_IMAGE} not found. ` +
            `Build it with: docker build -t ${SHELL_EXECUTOR_IMAGE} docker/shell-executor/`
        );
        throw new Error(
            `Shell sandbox image ${SHELL_EXECUTOR_IMAGE} not found. ` +
            `Build it with: docker build -t ${SHELL_EXECUTOR_IMAGE} docker/shell-executor/`
        );
    }

    // Build Docker volume mounts
    const binds = buildBindMounts(mergedConfig, options.workingDirectory);

    // Build environment variables for the container
    const envVars = options.environment
        ? Object.entries(options.environment).map(([k, v]) => `${k}=${v}`)
        : [];

    // Determine the working directory inside the container
    const containerWorkDir = options.workingDirectory
        ? mapHostPathToContainer(options.workingDirectory)
        : '/workspace';

    const containerId = `mxf-shell-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const timeout = options.timeout || 30000;

    logger.info(`Executing sandboxed shell command in container ${containerId}`, {
        command: command.substring(0, 200),
        networkAccess: mergedConfig.networkAccess,
        memoryLimit: mergedConfig.memoryLimit,
        cpuLimit: mergedConfig.cpuLimit,
        timeout
    });

    // ContainerExecutionManager's Docker client is private, so we create a separate
    // instance here. This is safe — Dockerode clients are stateless HTTP wrappers
    // over the Docker socket, not persistent connections.
    const docker = new Docker();

    let container: any;

    try {
        // Create container with security constraints
        container = await docker.createContainer({
            name: containerId,
            Image: SHELL_EXECUTOR_IMAGE,
            // Dockerfile ENTRYPOINT is ["/bin/bash", "-c"], so Cmd is the script argument
            Cmd: [command],
            WorkingDir: containerWorkDir,
            Env: envVars,
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
            User: '1000:1000',
            HostConfig: {
                // Network: disabled by default, opt-in via config
                NetworkMode: mergedConfig.networkAccess ? 'bridge' : 'none',

                // Filesystem: read-only root, tmpfs for /tmp
                ReadonlyRootfs: true,
                Tmpfs: {
                    '/tmp': 'rw,noexec,nosuid,size=64m'
                },

                // Capabilities: drop all
                CapDrop: ['ALL'],

                // No privilege escalation
                Privileged: false,
                SecurityOpt: ['no-new-privileges:true'],

                // Resource limits
                Memory: mergedConfig.memoryLimit * 1024 * 1024,
                MemorySwap: mergedConfig.memoryLimit * 1024 * 1024, // No swap
                NanoCpus: Math.floor(mergedConfig.cpuLimit * 1e9),

                // PID limit — prevents fork bombs
                PidsLimit: 128,

                // Volume mounts
                Binds: binds,

                // Auto-remove disabled — we handle cleanup manually
                AutoRemove: false
            }
        });

        // Start the container
        await container.start();

        // Set up timeout to kill the container if it runs too long
        const timeoutHandle = setTimeout(async () => {
            try {
                await container.stop({ t: 0 });
                logger.warn(`Shell sandbox container ${containerId} killed due to timeout (${timeout}ms)`);
            } catch {
                // Container may have already stopped
            }
        }, timeout);

        // Wait for the container to finish and collect output
        const { stdout, stderr, exitCode } = await collectContainerOutput(container);

        clearTimeout(timeoutHandle);

        const executionTime = Date.now() - startTime;

        logger.info(`Shell sandbox execution completed`, {
            containerId,
            exitCode,
            executionTime,
            stdoutLength: stdout.length,
            stderrLength: stderr.length
        });

        return {
            exitCode,
            stdout,
            stderr,
            executionTime,
            sandboxed: true
        };

    } catch (error: any) {
        const executionTime = Date.now() - startTime;
        logger.error(`Shell sandbox execution failed: ${error.message}`, {
            containerId,
            executionTime
        });

        // Attempt to stop and remove the container on failure
        if (container) {
            try {
                await container.stop({ t: 0 }).catch(() => {});
                await container.remove({ force: true }).catch(() => {});
            } catch {
                // Best-effort cleanup
            }
        }

        throw error;

    } finally {
        // Clean up the container
        if (container) {
            try {
                await container.remove({ force: true });
            } catch {
                // Container may have been auto-removed or already cleaned up
            }
        }
    }
}

/**
 * Check if the mxf/shell-executor Docker image exists locally.
 *
 * @returns true if the image is available
 */
async function checkShellExecutorImageExists(): Promise<boolean> {
    try {
        const dockerClient = new Docker();
        const image = dockerClient.getImage(SHELL_EXECUTOR_IMAGE);
        await image.inspect();
        return true;
    } catch {
        return false;
    }
}

/**
 * Build Docker bind mount strings from sandbox configuration.
 * The project directory is mounted read-only at /workspace by default.
 * Additional writable paths and custom mounts are added from config.
 *
 * @param config - The merged sandbox configuration
 * @param workingDirectory - Optional host working directory to mount
 * @returns Array of Docker bind mount strings (e.g., '/host/path:/container/path:ro')
 */
function buildBindMounts(
    config: ShellSandboxConfig,
    workingDirectory?: string
): string[] {
    const binds: string[] = [];

    // Mount the project directory (or working directory) as read-only at /workspace
    const projectDir = workingDirectory || process.cwd();
    binds.push(`${projectDir}:/workspace:ro`);

    // Mount writable paths — each gets mounted at the same path inside the container
    for (const writablePath of config.writablePaths) {
        binds.push(`${writablePath}:${writablePath}:rw`);
    }

    // Mount custom mount configurations
    for (const mount of config.mountPaths) {
        const mode = mount.readOnly ? 'ro' : 'rw';
        binds.push(`${mount.host}:${mount.container}:${mode}`);
    }

    return binds;
}

/**
 * Map a host filesystem path to its corresponding container path.
 * The project root (process.cwd()) is mounted at /workspace, so subdirectories
 * are resolved as relative paths under /workspace.
 *
 * @param hostPath - The host filesystem path
 * @returns The corresponding path inside the container
 */
function mapHostPathToContainer(hostPath: string): string {
    const projectRoot = process.cwd();
    const resolved = require('path').resolve(hostPath);

    // If the host path is within the project root, compute relative path
    if (resolved.startsWith(projectRoot)) {
        const relative = resolved.substring(projectRoot.length);
        return `/workspace${relative}`;
    }

    // Path is outside the project root — default to /workspace
    return '/workspace';
}

/**
 * Collect stdout and stderr from a Docker container after it finishes.
 * Waits for the container to exit, then reads logs.
 *
 * @param container - The Docker container instance
 * @returns Object with stdout, stderr, and exitCode
 */
async function collectContainerOutput(
    container: any
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Wait for the container to exit
    const waitResult = await container.wait();
    const exitCode: number = waitResult.StatusCode;

    // Collect logs (stdout and stderr separately)
    const logStream = await container.logs({
        follow: false,
        stdout: true,
        stderr: true
    });

    // Docker log output is a Buffer with multiplexed stdout/stderr frames.
    // Each frame has an 8-byte header: [stream_type(1), 0, 0, 0, size(4)]
    // stream_type: 1 = stdout, 2 = stderr
    const rawBuffer = Buffer.isBuffer(logStream) ? logStream : Buffer.from(logStream);
    let stdout = '';
    let stderr = '';
    let offset = 0;

    while (offset < rawBuffer.length) {
        // Need at least 8 bytes for the header
        if (offset + 8 > rawBuffer.length) {
            break;
        }

        const streamType = rawBuffer.readUInt8(offset);
        const frameSize = rawBuffer.readUInt32BE(offset + 4);
        offset += 8;

        // Ensure we don't read past the buffer
        if (offset + frameSize > rawBuffer.length) {
            break;
        }

        const frameData = rawBuffer.slice(offset, offset + frameSize).toString('utf-8');
        offset += frameSize;

        if (streamType === 1) {
            stdout += frameData;
        } else if (streamType === 2) {
            stderr += frameData;
        }
    }

    return { stdout, stderr, exitCode };
}
