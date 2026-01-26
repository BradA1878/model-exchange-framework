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
 * ContainerExecutionManager.ts
 *
 * Manages Docker containers for sandboxed code execution.
 * Creates fresh containers per execution with strict security constraints.
 *
 * Security Model:
 * - Container isolation is the PRIMARY security barrier
 * - Pre-validation catches obvious dangerous patterns early
 * - Each execution runs in a fresh, isolated container
 */

import Docker from 'dockerode';
import { Logger } from '../utils/Logger';
import { Writable } from 'stream';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Container execution configuration
 */
export interface ContainerExecutionConfig {
    // Execution limits
    defaultTimeout: number; // ms
    maxTimeout: number; // ms
    timeoutBuffer: number; // ms - buffer for container overhead
    memoryLimit: number; // MB
    cpuLimit: number; // CPU cores (fractional)

    // Output limits
    maxOutputSize: number; // bytes - truncate stdout if larger

    // Image configuration
    imageName: string;
    imageTag: string;
}

/**
 * @deprecated Use ContainerExecutionConfig instead
 * Type alias for backwards compatibility
 */
export type ContainerPoolConfig = ContainerExecutionConfig;

/**
 * Execution request for container
 */
export interface ContainerExecutionRequest {
    code: string;
    language: 'javascript' | 'typescript';
    timeout: number;
    context: {
        agentId: string;
        channelId: string;
        requestId: string;
        [key: string]: any;
    };
}

/**
 * Execution result from container
 */
export interface ContainerExecutionResult {
    success: boolean;
    output: any;
    logs: string[];
    executionTime: number;
    error?: string;
    timeout: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: ContainerExecutionConfig = {
    defaultTimeout: parseInt(process.env.CODE_EXEC_TIMEOUT_DEFAULT || '5000'),
    maxTimeout: parseInt(process.env.CODE_EXEC_TIMEOUT_MAX || '30000'),
    timeoutBuffer: parseInt(process.env.CODE_EXEC_TIMEOUT_BUFFER || '1000'),
    memoryLimit: parseInt(process.env.CODE_EXEC_MEMORY_LIMIT || '128'),
    cpuLimit: parseFloat(process.env.CODE_EXEC_CPU_LIMIT || '0.5'),
    maxOutputSize: parseInt(process.env.CODE_EXEC_MAX_OUTPUT || '10240'), // 10KB default
    imageName: process.env.CODE_EXEC_IMAGE?.split(':')[0] || 'mxf/code-executor',
    imageTag: process.env.CODE_EXEC_IMAGE?.split(':')[1] || 'latest'
};

/**
 * Container Execution Manager
 *
 * Manages Docker containers for code execution with:
 * - Fresh container per execution (no pooling)
 * - Security constraints (no network, read-only, cgroups)
 * - Resource limits (memory, CPU)
 * - Automatic cleanup after execution
 */
export class ContainerExecutionManager {
    private static instance: ContainerExecutionManager;
    private logger: Logger;
    private docker: Docker;
    private config: ContainerExecutionConfig;
    private initialized: boolean = false;
    private dockerAvailable: boolean = false;

    private constructor(config?: Partial<ContainerExecutionConfig>) {
        this.logger = new Logger('info', 'ContainerExecutionManager', 'server');
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.docker = new Docker();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(config?: Partial<ContainerExecutionConfig>): ContainerExecutionManager {
        if (!ContainerExecutionManager.instance) {
            ContainerExecutionManager.instance = new ContainerExecutionManager(config);
        }
        return ContainerExecutionManager.instance;
    }

    /**
     * Initialize the container execution manager
     * Checks Docker availability and builds image if needed
     * Auto-rebuilds image if source files are newer than the image
     */
    public async initialize(): Promise<boolean> {
        if (this.initialized) {
            return this.dockerAvailable;
        }

        try {
            // Check Docker daemon is running
            await this.docker.ping();
            this.dockerAvailable = true;
            this.logger.info('Docker daemon is available');

            // Check for force rebuild environment variable
            if (process.env.FORCE_REBUILD_CODE_EXECUTOR === 'true') {
                this.logger.info('FORCE_REBUILD_CODE_EXECUTOR=true - forcing image rebuild');
                const buildSuccess = await this.buildImage();
                if (!buildSuccess) {
                    this.logger.warn('Failed to force rebuild code executor image. Code execution will not be available.');
                    this.dockerAvailable = false;
                } else {
                    this.logger.info('Code executor image force rebuilt successfully');
                }
                this.initialized = true;
                return this.dockerAvailable;
            }

            // Check if image exists
            const imageExists = await this.checkImageExists();

            if (imageExists) {
                // Check if source files are newer than image
                const sourceModTime = this.getSourceFilesModTime();
                const imageCreatedTime = await this.getImageCreatedTime();

                if (sourceModTime > 0 && sourceModTime > imageCreatedTime) {
                    this.logger.info('Code executor source files modified after image build. Rebuilding...');
                    this.logger.info(`  Source modified: ${new Date(sourceModTime).toISOString()}`);
                    this.logger.info(`  Image built: ${new Date(imageCreatedTime).toISOString()}`);

                    const buildSuccess = await this.buildImage();
                    if (!buildSuccess) {
                        this.logger.warn('Failed to rebuild code executor image. Using existing image.');
                    } else {
                        this.logger.info('Code executor image rebuilt successfully');
                    }
                } else {
                    this.logger.info(`Code executor image ${this.getImageName()} is up to date`);
                }
            } else {
                // Build image from scratch
                this.logger.info(`Code executor image ${this.getImageName()} not found, attempting to build...`);
                const buildSuccess = await this.buildImage();
                if (!buildSuccess) {
                    this.logger.warn('Failed to build code executor image. Code execution will not be available.');
                    this.dockerAvailable = false;
                }
            }

            this.initialized = true;
            return this.dockerAvailable;

        } catch (error: any) {
            this.logger.error(`Docker initialization failed: ${error.message}`);
            this.dockerAvailable = false;
            this.initialized = true; // Mark as initialized even on failure
            return false;
        }
    }

    /**
     * Build the code executor Docker image from ./docker/code-executor
     */
    private async buildImage(): Promise<boolean> {
        try {
            // Find the docker/code-executor directory
            // Check relative to current working directory first
            const possiblePaths = [
                path.join(process.cwd(), 'docker', 'code-executor'),
                path.join(__dirname, '..', '..', '..', 'docker', 'code-executor'),
                path.join(__dirname, '..', '..', '..', '..', 'docker', 'code-executor')
            ];

            let dockerfilePath: string | null = null;
            for (const p of possiblePaths) {
                const dockerfileLoc = path.join(p, 'Dockerfile');
                if (fs.existsSync(dockerfileLoc)) {
                    dockerfilePath = p;
                    break;
                }
            }

            if (!dockerfilePath) {
                this.logger.error('Could not find docker/code-executor/Dockerfile');
                return false;
            }

            this.logger.info(`Building Docker image from ${dockerfilePath}...`);

            // Build image using Docker API
            const stream = await this.docker.buildImage(
                {
                    context: dockerfilePath,
                    src: ['Dockerfile', 'executor.ts']
                },
                {
                    t: this.getImageName(),
                    dockerfile: 'Dockerfile'
                }
            );

            // Wait for build to complete and log output
            await new Promise<void>((resolve, reject) => {
                this.docker.modem.followProgress(
                    stream,
                    (err: Error | null, result: any) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    },
                    (event: any) => {
                        if (event.stream) {
                            const line = event.stream.trim();
                            if (line) {
                                this.logger.debug(`Docker build: ${line}`);
                            }
                        }
                        if (event.error) {
                            this.logger.error(`Docker build error: ${event.error}`);
                        }
                    }
                );
            });

            this.logger.info(`Successfully built Docker image ${this.getImageName()}`);
            return true;

        } catch (error: any) {
            this.logger.error(`Failed to build Docker image: ${error.message}`);
            return false;
        }
    }

    /**
     * Execute code in a container
     * Creates a new container, executes code, and removes container
     */
    public async execute(request: ContainerExecutionRequest): Promise<ContainerExecutionResult> {
        if (!this.dockerAvailable) {
            return {
                success: false,
                output: null,
                logs: [],
                executionTime: 0,
                error: 'Docker is not available',
                timeout: false
            };
        }

        const startTime = Date.now();
        const containerId = `mxf-exec-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Validate and cap timeout
        const timeout = Math.min(
            request.timeout || this.config.defaultTimeout,
            this.config.maxTimeout
        );

        try {
            // Create container with security constraints
            const container = await this.createSecureContainer(containerId);

            // Start container
            await container.start();

            // Send execution request via stdin and read stdout
            const result = await this.executeInContainer(container, {
                ...request,
                timeout
            });

            // Cleanup container
            await this.destroyContainer(container, request.context?.requestId);

            return result;

        } catch (error: any) {
            this.logger.error(`Container execution failed: ${error.message}`, {
                containerId,
                requestId: request.context?.requestId
            });

            // Attempt cleanup with logging
            await this.cleanupFailedContainer(containerId, request.context?.requestId);

            return {
                success: false,
                output: null,
                logs: [],
                executionTime: Date.now() - startTime,
                error: error.message || String(error),
                timeout: error.message?.includes('timeout')
            };
        }
    }

    /**
     * Cleanup a failed container with proper logging
     */
    private async cleanupFailedContainer(containerId: string, requestId?: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerId);
            await container.stop({ t: 0 }).catch(() => {});
            await container.remove({ force: true }).catch(() => {});
        } catch (cleanupError: any) {
            this.logger.warn(`Container cleanup failed for ${containerId}`, {
                error: cleanupError.message,
                requestId
            });
        }
    }

    /**
     * Create a secure container with all security constraints
     */
    private async createSecureContainer(name: string): Promise<Docker.Container> {
        const container = await this.docker.createContainer({
            name,
            Image: this.getImageName(),
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            OpenStdin: true,
            StdinOnce: true,
            Tty: false,
            HostConfig: {
                // Network: Disabled - no network access
                NetworkMode: 'none',

                // Filesystem: Read-only root, tmpfs for /tmp
                ReadonlyRootfs: true,
                Tmpfs: {
                    '/tmp': 'rw,noexec,nosuid,size=64m'
                },

                // Capabilities: Drop all
                CapDrop: ['ALL'],

                // Privileged: No
                Privileged: false,

                // Security: No new privileges
                SecurityOpt: ['no-new-privileges:true'],

                // Resource limits
                Memory: this.config.memoryLimit * 1024 * 1024, // Convert MB to bytes
                MemorySwap: this.config.memoryLimit * 1024 * 1024, // No swap
                NanoCpus: Math.floor(this.config.cpuLimit * 1e9), // Convert to nanocpus

                // PID limit
                PidsLimit: 64,

                // Ulimits
                Ulimits: [
                    { Name: 'nofile', Soft: 64, Hard: 64 },
                    { Name: 'nproc', Soft: 32, Hard: 32 }
                ],

                // Auto remove after exit
                AutoRemove: false // We handle removal manually
            },
            // User: Non-root
            User: '1000:1000'
        });

        return container;
    }

    /**
     * Execute code inside a running container
     *
     * CRITICAL: This method waits for BOTH container exit AND stream demultiplexing
     * to complete before reading output. The demuxStream() call is asynchronous and
     * sets up listeners that may still be processing data when container.wait() resolves.
     * Without waiting for streams to finish, stdout may be empty or incomplete.
     */
    private async executeInContainer(
        container: Docker.Container,
        request: ContainerExecutionRequest
    ): Promise<ContainerExecutionResult> {
        return new Promise(async (resolve) => {
            // Prevent double-resolution from timeout vs success race
            let resolved = false;
            const resolveOnce = (result: ContainerExecutionResult) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    resolve(result);
                }
            };

            // Use configurable timeout buffer
            const timeoutId = setTimeout(() => {
                resolveOnce({
                    success: false,
                    output: null,
                    logs: [],
                    executionTime: request.timeout,
                    error: 'Execution timeout',
                    timeout: true
                });
            }, request.timeout + this.config.timeoutBuffer);

            try {
                // Attach to container streams
                const stream = await container.attach({
                    stream: true,
                    stdin: true,
                    stdout: true,
                    stderr: true,
                    hijack: true
                });

                // Collect output
                let stdout = '';
                let stderr = '';

                // Demux the stream - these Writable streams receive demultiplexed data
                const stdoutStream = new Writable({
                    write(chunk, encoding, callback) {
                        stdout += chunk.toString();
                        callback();
                    }
                });

                const stderrStream = new Writable({
                    write(chunk, encoding, callback) {
                        stderr += chunk.toString();
                        callback();
                    }
                });

                // Create a promise that resolves when all streams are fully processed
                // This is CRITICAL: demuxStream() is async and container.wait() may resolve
                // before the demux pipeline finishes writing to our Writable streams
                const streamEndPromise = new Promise<void>((resolveStream, rejectStream) => {
                    let sourceEnded = false;
                    let stdoutFinished = false;
                    let stderrFinished = false;

                    const checkCompletion = () => {
                        if (sourceEnded && stdoutFinished && stderrFinished) {
                            resolveStream();
                        }
                    };

                    // Source stream 'end' event - triggered when container closes stdout
                    stream.on('end', () => {
                        sourceEnded = true;
                        // Signal EOF to our writable streams so they emit 'finish'
                        stdoutStream.end();
                        stderrStream.end();
                        checkCompletion();
                    });

                    // Handle unexpected close (e.g., container killed)
                    stream.on('close', () => {
                        if (!sourceEnded) {
                            sourceEnded = true;
                            stdoutStream.end();
                            stderrStream.end();
                            checkCompletion();
                        }
                    });

                    // Stream error - reject the promise
                    stream.on('error', (err) => {
                        rejectStream(err);
                    });

                    // Writable 'finish' events - triggered after end() and all writes complete
                    stdoutStream.on('finish', () => {
                        stdoutFinished = true;
                        checkCompletion();
                    });

                    stderrStream.on('finish', () => {
                        stderrFinished = true;
                        checkCompletion();
                    });

                    // Handle writable stream errors
                    stdoutStream.on('error', (err) => {
                        rejectStream(err);
                    });

                    stderrStream.on('error', (err) => {
                        rejectStream(err);
                    });
                });

                // Docker multiplexes stdout/stderr - use demuxStream to split them
                // NOTE: demuxStream() sets up 'data' listeners and returns immediately (async!)
                container.modem.demuxStream(stream, stdoutStream, stderrStream);

                // Write request to stdin with newline delimiter
                // The newline signals end of input to the executor (which reads until newline/valid JSON)
                const requestJson = JSON.stringify(request);
                this.logger.debug(`[ContainerExecution] Sending to container (${requestJson.length} chars)`);
                this.logger.debug(`[ContainerExecution] Request JSON preview: ${requestJson.substring(0, 500)}`);
                stream.write(requestJson + '\n', 'utf8');
                stream.end();

                // Wait for BOTH container exit AND stream processing to complete
                // This prevents the race condition where container exits but demux hasn't finished
                await Promise.all([
                    container.wait(),
                    streamEndPromise
                ]);

                this.logger.debug(`[ContainerExecution] Container exited and streams finished. stdout=${stdout.length} chars, stderr=${stderr.length} chars`);

                // Check for empty output - indicates container produced nothing
                if (!stdout.trim()) {
                    resolveOnce({
                        success: false,
                        output: null,
                        logs: stderr ? [stderr] : [],
                        executionTime: request.timeout,
                        error: 'Container produced no output',
                        timeout: false
                    });
                    return;
                }

                // Parse result from stdout
                try {
                    // Truncate stdout before parsing if too large (performance optimization)
                    let outputToParse = stdout;
                    if (stdout.length > this.config.maxOutputSize) {
                        this.logger.warn(`Container output truncated from ${stdout.length} to ${this.config.maxOutputSize} bytes`);
                        outputToParse = stdout.substring(0, this.config.maxOutputSize);
                    }

                    // Clean stdout - may have header bytes from docker multiplexing
                    const cleanStdout = outputToParse.replace(/^[\x00-\x1f]+/, '').trim();
                    const result: ContainerExecutionResult = JSON.parse(cleanStdout);
                    resolveOnce(result);
                } catch (parseError: any) {
                    // Failed to parse result - return raw output (truncated)
                    const truncatedOutput = stdout.substring(0, 200);
                    this.logger.error(`[ContainerExecution] Failed to parse JSON: ${parseError.message}. Raw output: ${truncatedOutput}`);
                    resolveOnce({
                        success: false,
                        output: truncatedOutput,
                        logs: stderr ? [stderr] : [],
                        executionTime: request.timeout,
                        error: `Failed to parse execution result: ${parseError.message}`,
                        timeout: false
                    });
                }

            } catch (error: any) {
                this.logger.error(`[ContainerExecution] Execution error: ${error.message}`);
                resolveOnce({
                    success: false,
                    output: null,
                    logs: [],
                    executionTime: 0,
                    error: error.message || String(error),
                    timeout: false
                });
            }
        });
    }

    /**
     * Destroy a container with logging
     */
    private async destroyContainer(container: Docker.Container, requestId?: string): Promise<void> {
        try {
            // Stop if running
            try {
                await container.stop({ t: 0 });
            } catch {
                // May already be stopped
            }

            // Remove
            await container.remove({ force: true });
        } catch (error: any) {
            this.logger.warn(`Failed to destroy container`, {
                error: error.message,
                requestId
            });
        }
    }

    /**
     * Check if the code executor image exists
     */
    private async checkImageExists(): Promise<boolean> {
        try {
            const image = this.docker.getImage(this.getImageName());
            await image.inspect();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get full image name with tag
     */
    private getImageName(): string {
        return `${this.config.imageName}:${this.config.imageTag}`;
    }

    /**
     * Get the latest modification time of source files (Dockerfile and executor.ts)
     * Returns 0 if source files cannot be found
     */
    private getSourceFilesModTime(): number {
        const possiblePaths = [
            path.join(process.cwd(), 'docker', 'code-executor'),
            path.join(__dirname, '..', '..', '..', 'docker', 'code-executor'),
            path.join(__dirname, '..', '..', '..', '..', 'docker', 'code-executor')
        ];

        for (const basePath of possiblePaths) {
            const dockerfilePath = path.join(basePath, 'Dockerfile');
            const executorPath = path.join(basePath, 'executor.ts');

            if (fs.existsSync(dockerfilePath) && fs.existsSync(executorPath)) {
                const dockerfileMtime = fs.statSync(dockerfilePath).mtimeMs;
                const executorMtime = fs.statSync(executorPath).mtimeMs;
                return Math.max(dockerfileMtime, executorMtime);
            }
        }
        return 0; // Can't find source files
    }

    /**
     * Get the Docker image creation timestamp
     * Returns 0 if image doesn't exist or can't be inspected
     */
    private async getImageCreatedTime(): Promise<number> {
        try {
            const image = this.docker.getImage(this.getImageName());
            const inspectData = await image.inspect();
            const createdStr = inspectData.Created; // ISO 8601 timestamp
            return new Date(createdStr).getTime();
        } catch {
            return 0; // Image doesn't exist
        }
    }

    /**
     * Check if Docker is available
     */
    public isDockerAvailable(): boolean {
        return this.dockerAvailable;
    }

    /**
     * Check if the service is initialized
     */
    public isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Get current configuration
     */
    public getConfig(): ContainerExecutionConfig {
        return { ...this.config };
    }

    /**
     * Shutdown the execution manager
     */
    public async shutdown(): Promise<void> {
        this.logger.info('Shutting down container execution manager');
        this.initialized = false;
        this.dockerAvailable = false;
    }
}

// Export alias for backwards compatibility during migration
export { ContainerExecutionManager as ContainerPoolManager };
