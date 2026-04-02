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
 * BackgroundTaskManager.ts
 *
 * Singleton service for managing long-running background shell processes.
 * Uses child_process.spawn() for streaming output, emits progress events
 * via EventBus, and enforces memory-safe output buffering with ring-buffer
 * semantics (keeps last ~512KB per task).
 *
 * Key behaviors:
 * - Limits concurrent background tasks to prevent resource exhaustion
 * - Throttles progress events to at most one per second per task
 * - Automatically cleans up completed tasks older than 1 hour
 * - Graceful cancellation with SIGTERM followed by SIGKILL after 5 seconds
 */

import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import * as crypto from 'crypto';
import { AgentId, ChannelId } from '../types/ChannelContext';
import { Logger } from '../utils/Logger';
import { Events } from '../events/EventNames';
import { EventBus } from '../events/EventBus';
import {
    createShellExecutionProgressPayload,
    createShellBackgroundStartedPayload,
    createShellBackgroundCompletedPayload
} from '../schemas/ShellExecutionEventPayloads';

// ---- Types ----

export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** Internal representation of a background task with all accumulated state */
export interface BackgroundTask {
    /** Unique identifier for this background task */
    taskId: string;
    /** The shell command being executed */
    command: string;
    /** Optional human-readable description of what the task does */
    description?: string;
    /** Current lifecycle status of the task */
    status: BackgroundTaskStatus;
    /** Accumulated stdout (kept to last ~512KB to prevent memory pressure) */
    output: string;
    /** Accumulated stderr */
    stderr: string;
    /** Process exit code (set when the process exits) */
    exitCode?: number;
    /** Unix timestamp (ms) when the task was started */
    startTime: number;
    /** Unix timestamp (ms) when the task ended (set on completion/failure/cancel) */
    endTime?: number;
    /** Agent that initiated this background task */
    agentId: AgentId;
    /** Channel context for event routing */
    channelId: ChannelId;
    /** Request identifier for correlation with the originating tool call */
    requestId: string;
}

/** Public-facing task information returned by status and list queries */
export interface BackgroundTaskInfo {
    /** Unique identifier for this background task */
    taskId: string;
    /** The shell command being executed */
    command: string;
    /** Optional human-readable description */
    description?: string;
    /** Current lifecycle status */
    status: BackgroundTaskStatus;
    /** Process exit code (undefined while running) */
    exitCode?: number;
    /** Last 50 lines of output for a quick preview */
    outputPreview: string;
    /** Total bytes accumulated (may exceed buffer size due to ring-buffer trimming) */
    outputSize: number;
    /** Unix timestamp (ms) when the task was started */
    startTime: number;
    /** Unix timestamp (ms) when the task ended (undefined while running) */
    endTime?: number;
    /** Wall-clock elapsed time in seconds */
    elapsedSeconds: number;
    /** Agent that initiated this background task */
    agentId: AgentId;
    /** Channel context */
    channelId: ChannelId;
}

/** Internal task entry extending BackgroundTask with the child process handle and tracking metadata */
interface InternalTask extends BackgroundTask {
    /** The spawned child process (cleared after exit) */
    process?: ChildProcess;
    /** Total bytes ever written to stdout (not trimmed by ring buffer) */
    totalOutputBytes: number;
    /** Timestamp of last progress event emission (for throttling) */
    lastProgressEmit: number;
    /** Timeout timer handle (if a timeout was specified) */
    timeoutTimer?: ReturnType<typeof setTimeout>;
}

// ---- BackgroundTaskManager ----

export class BackgroundTaskManager {
    private static instance: BackgroundTaskManager;

    /** Map of taskId -> internal task state */
    private tasks: Map<string, InternalTask> = new Map();

    private logger = new Logger('info', 'BackgroundTaskManager', 'server');

    /** Maximum number of concurrently running background tasks */
    private maxConcurrentTasks = 10;

    /** Maximum stdout buffer size per task in bytes (ring-buffer trim threshold) */
    private maxOutputBufferSize = 512 * 1024; // 512KB

    /** Interval between automatic cleanup sweeps for stale completed tasks */
    private cleanupIntervalMs = 60 * 60 * 1000; // 1 hour

    /** Handle for the periodic cleanup timer */
    private cleanupTimer?: ReturnType<typeof setInterval>;

    private constructor() {
        // Start periodic cleanup of completed tasks older than cleanupIntervalMs
        this.cleanupTimer = setInterval(() => this.cleanupCompletedTasks(), this.cleanupIntervalMs);
    }

    /** Get the singleton instance of BackgroundTaskManager */
    static getInstance(): BackgroundTaskManager {
        if (!BackgroundTaskManager.instance) {
            BackgroundTaskManager.instance = new BackgroundTaskManager();
        }
        return BackgroundTaskManager.instance;
    }

    /**
     * Start a command in the background. Returns immediately with a taskId that
     * can be used to query status, retrieve output, or cancel the task.
     *
     * @param command - Shell command to execute
     * @param options - Execution options (working directory, environment, timeout, description)
     * @param context - Agent/channel/request context for event routing and tracking
     * @returns Object containing the assigned taskId
     * @throws Error if the maximum concurrent task limit is reached
     */
    async startBackground(
        command: string,
        options: {
            workingDirectory?: string;
            environment?: Record<string, string>;
            timeout?: number;
            description?: string;
        },
        context: { agentId: AgentId; channelId: ChannelId; requestId: string }
    ): Promise<{ taskId: string }> {
        // Validate concurrent task limit
        const runningCount = this.getRunningTaskCount();
        if (runningCount >= this.maxConcurrentTasks) {
            throw new Error(
                `Maximum concurrent background tasks reached (${this.maxConcurrentTasks}). ` +
                `Cancel or wait for existing tasks to complete before starting new ones.`
            );
        }

        const taskId = crypto.randomUUID();

        // Build spawn options
        const spawnOptions: SpawnOptions = {
            shell: true,
            cwd: options.workingDirectory || process.cwd(),
            env: options.environment
                ? { ...process.env, ...options.environment }
                : process.env,
        };

        const childProcess = spawn(command, [], spawnOptions);

        // Create the internal task entry
        const task: InternalTask = {
            taskId,
            command,
            description: options.description,
            status: 'running',
            output: '',
            stderr: '',
            startTime: Date.now(),
            agentId: context.agentId,
            channelId: context.channelId,
            requestId: context.requestId,
            process: childProcess,
            totalOutputBytes: 0,
            lastProgressEmit: 0,
        };

        this.tasks.set(taskId, task);

        this.logger.info(`Background task started: ${taskId} — command: "${command}"`);

        // Emit SHELL_BACKGROUND_STARTED event
        EventBus.server.emit(
            Events.Shell.SHELL_BACKGROUND_STARTED,
            createShellBackgroundStartedPayload(
                context.agentId,
                context.channelId,
                {
                    requestId: context.requestId,
                    taskId,
                    command,
                    description: options.description,
                    timeout: options.timeout || 0
                }
            )
        );

        // Set up stdout listener with ring-buffer accumulation and throttled progress events
        if (childProcess.stdout) {
            childProcess.stdout.on('data', (data: Buffer) => {
                const chunk = data.toString();
                this.appendOutput(task, chunk, false);
            });
        }

        // Set up stderr listener with similar accumulation
        if (childProcess.stderr) {
            childProcess.stderr.on('data', (data: Buffer) => {
                const chunk = data.toString();
                this.appendOutput(task, chunk, true);
            });
        }

        // Handle process exit
        childProcess.on('close', (code: number | null) => {
            const exitCode = code ?? 1;
            task.exitCode = exitCode;
            task.endTime = Date.now();
            // Preserve 'cancelled' status if cancelTask() already set it
            if (task.status !== 'cancelled') {
                task.status = exitCode === 0 ? 'completed' : 'failed';
            }
            task.process = undefined;

            // Clear timeout timer if set
            if (task.timeoutTimer) {
                clearTimeout(task.timeoutTimer);
                task.timeoutTimer = undefined;
            }

            const elapsedSeconds = (task.endTime - task.startTime) / 1000;

            this.logger.info(
                `Background task ${task.status}: ${taskId} — ` +
                `exit code: ${exitCode}, elapsed: ${elapsedSeconds.toFixed(1)}s`
            );

            // Emit SHELL_BACKGROUND_COMPLETED event
            EventBus.server.emit(
                Events.Shell.SHELL_BACKGROUND_COMPLETED,
                createShellBackgroundCompletedPayload(
                    task.agentId,
                    task.channelId,
                    {
                        requestId: task.requestId,
                        taskId,
                        command: task.command,
                        exitCode,
                        isError: exitCode !== 0,
                        executionTime: (task.endTime! - task.startTime),
                        outputSize: task.totalOutputBytes
                    }
                )
            );
        });

        // Handle spawn errors (e.g., command not found)
        childProcess.on('error', (error: Error) => {
            task.status = 'failed';
            task.endTime = Date.now();
            task.process = undefined;

            // Clear timeout timer if set
            if (task.timeoutTimer) {
                clearTimeout(task.timeoutTimer);
                task.timeoutTimer = undefined;
            }

            this.logger.error(`Background task error: ${taskId} — ${error.message}`);

            const elapsedSeconds = (task.endTime - task.startTime) / 1000;

            // Emit SHELL_BACKGROUND_COMPLETED with failed status
            EventBus.server.emit(
                Events.Shell.SHELL_BACKGROUND_COMPLETED,
                createShellBackgroundCompletedPayload(
                    task.agentId,
                    task.channelId,
                    {
                        requestId: task.requestId,
                        taskId,
                        command: task.command,
                        exitCode: 1,
                        isError: true,
                        executionTime: (task.endTime! - task.startTime),
                        outputSize: task.totalOutputBytes
                    }
                )
            );
        });

        // Set up timeout if specified
        if (options.timeout && options.timeout > 0) {
            task.timeoutTimer = setTimeout(() => {
                if (task.status === 'running' && task.process) {
                    this.logger.warn(
                        `Background task timed out after ${options.timeout}s: ${taskId}`
                    );
                    task.process.kill('SIGTERM');
                    // Force kill after 5 seconds if SIGTERM didn't work
                    setTimeout(() => {
                        if (task.status === 'running' && task.process) {
                            task.process.kill('SIGKILL');
                        }
                    }, 5000);
                }
            }, options.timeout * 1000);
        }

        return { taskId };
    }

    /**
     * Get status info for a background task.
     *
     * @param taskId - The task identifier returned by startBackground()
     * @returns BackgroundTaskInfo with current status and output preview, or null if not found
     */
    getTaskStatus(taskId: string): BackgroundTaskInfo | null {
        const task = this.tasks.get(taskId);
        if (!task) {
            return null;
        }
        return this.toTaskInfo(task);
    }

    /**
     * Get the full accumulated output for a task. Note that output is limited
     * to the last ~512KB due to ring-buffer trimming.
     *
     * @param taskId - The task identifier returned by startBackground()
     * @returns The accumulated stdout output, or null if the task is not found
     */
    getTaskOutput(taskId: string): string | null {
        const task = this.tasks.get(taskId);
        if (!task) {
            return null;
        }
        return task.output;
    }

    /**
     * Cancel a running background task. Sends SIGTERM first and escalates
     * to SIGKILL after 5 seconds if the process hasn't exited.
     *
     * @param taskId - The task identifier returned by startBackground()
     * @returns true if the task was found and cancellation was initiated, false otherwise
     */
    cancelTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task) {
            this.logger.warn(`Cannot cancel task: ${taskId} — task not found`);
            return false;
        }

        if (task.status !== 'running') {
            this.logger.warn(`Cannot cancel task: ${taskId} — task is ${task.status}`);
            return false;
        }

        if (!task.process) {
            this.logger.warn(`Cannot cancel task: ${taskId} — no process handle`);
            return false;
        }

        this.logger.info(`Cancelling background task: ${taskId}`);

        // Set status to cancelled immediately so the close handler knows this was intentional
        task.status = 'cancelled';

        // Clear timeout timer if set
        if (task.timeoutTimer) {
            clearTimeout(task.timeoutTimer);
            task.timeoutTimer = undefined;
        }

        // Send SIGTERM for graceful shutdown
        task.process.kill('SIGTERM');

        // Escalate to SIGKILL after 5 seconds if still alive
        const killTimer = setTimeout(() => {
            if (task.process) {
                this.logger.warn(`Force-killing background task: ${taskId} (SIGKILL)`);
                task.process.kill('SIGKILL');
            }
        }, 5000);

        // Clean up the kill timer when the process actually exits
        const originalClose = task.process;
        originalClose.on('close', () => {
            clearTimeout(killTimer);
        });

        return true;
    }

    /**
     * List all background tasks, optionally filtered by agent.
     *
     * @param agentId - If provided, only tasks belonging to this agent are returned
     * @returns Array of BackgroundTaskInfo for matching tasks
     */
    listTasks(agentId?: AgentId): BackgroundTaskInfo[] {
        const results: BackgroundTaskInfo[] = [];
        for (const task of this.tasks.values()) {
            if (agentId && task.agentId !== agentId) {
                continue;
            }
            results.push(this.toTaskInfo(task));
        }
        return results;
    }

    /**
     * Shutdown the manager: cancel all running tasks, clear timers, and release resources.
     * Called during server shutdown to ensure clean process cleanup.
     */
    shutdown(): void {
        this.logger.info('Shutting down BackgroundTaskManager...');

        // Clear the periodic cleanup timer
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        // Cancel all running tasks
        for (const task of this.tasks.values()) {
            if (task.status === 'running' && task.process) {
                // Clear any timeout timers
                if (task.timeoutTimer) {
                    clearTimeout(task.timeoutTimer);
                    task.timeoutTimer = undefined;
                }

                task.status = 'cancelled';
                task.endTime = Date.now();
                task.process.kill('SIGKILL');
                task.process = undefined;
            }
        }

        this.logger.info('BackgroundTaskManager shut down successfully');
    }

    // ---- Private helpers ----

    /**
     * Append output to a task's buffer with ring-buffer semantics.
     * When the buffer exceeds maxOutputBufferSize, the front is trimmed.
     * Emits throttled SHELL_EXECUTION_PROGRESS events.
     */
    private appendOutput(task: InternalTask, chunk: string, isStderr: boolean): void {
        const chunkBytes = Buffer.byteLength(chunk, 'utf-8');
        task.totalOutputBytes += chunkBytes;

        if (isStderr) {
            task.stderr += chunk;
            // Apply ring-buffer trimming to stderr as well
            if (Buffer.byteLength(task.stderr, 'utf-8') > this.maxOutputBufferSize) {
                task.stderr = this.trimToSize(task.stderr, this.maxOutputBufferSize);
            }
        } else {
            task.output += chunk;
            // Apply ring-buffer trimming: keep only the last maxOutputBufferSize bytes
            if (Buffer.byteLength(task.output, 'utf-8') > this.maxOutputBufferSize) {
                task.output = this.trimToSize(task.output, this.maxOutputBufferSize);
            }
        }

        // Emit progress events throttled to at most once per second
        const now = Date.now();
        if (now - task.lastProgressEmit >= 1000) {
            task.lastProgressEmit = now;

            const elapsedSeconds = (now - task.startTime) / 1000;
            const totalLines = task.output.split('\n').length;

            EventBus.server.emit(
                Events.Shell.SHELL_EXECUTION_PROGRESS,
                createShellExecutionProgressPayload(
                    task.agentId,
                    task.channelId,
                    {
                        requestId: task.requestId,
                        taskId: task.taskId,
                        output: chunk,
                        fullOutputSize: task.totalOutputBytes,
                        elapsedTimeSeconds: elapsedSeconds,
                        totalLines,
                        totalBytes: task.totalOutputBytes
                    }
                )
            );
        }
    }

    /**
     * Trim a string from the front so that the resulting string is at most
     * targetSize bytes. Trims to the nearest newline to avoid splitting lines.
     */
    private trimToSize(text: string, targetSize: number): string {
        // Find a position that brings us under the target size
        const currentSize = Buffer.byteLength(text, 'utf-8');
        const excess = currentSize - targetSize;
        if (excess <= 0) {
            return text;
        }

        // Remove at least `excess` bytes from the front.
        // Walk forward to find the right character offset.
        let bytesRemoved = 0;
        let charOffset = 0;
        while (charOffset < text.length && bytesRemoved < excess) {
            const charBytes = Buffer.byteLength(text[charOffset], 'utf-8');
            bytesRemoved += charBytes;
            charOffset++;
        }

        // Advance to the next newline to avoid splitting a line
        const nextNewline = text.indexOf('\n', charOffset);
        if (nextNewline !== -1 && nextNewline < charOffset + 200) {
            charOffset = nextNewline + 1;
        }

        return text.substring(charOffset);
    }

    /**
     * Convert an internal task to the public BackgroundTaskInfo format.
     */
    private toTaskInfo(task: InternalTask): BackgroundTaskInfo {
        const endOrNow = task.endTime || Date.now();
        const elapsedSeconds = (endOrNow - task.startTime) / 1000;

        // Extract last 50 lines for the preview
        const lines = task.output.split('\n');
        const previewLines = lines.slice(-50);
        const outputPreview = previewLines.join('\n');

        return {
            taskId: task.taskId,
            command: task.command,
            description: task.description,
            status: task.status,
            exitCode: task.exitCode,
            outputPreview,
            outputSize: task.totalOutputBytes,
            startTime: task.startTime,
            endTime: task.endTime,
            elapsedSeconds,
            agentId: task.agentId,
            channelId: task.channelId,
        };
    }

    /**
     * Count the number of currently running tasks.
     */
    private getRunningTaskCount(): number {
        let count = 0;
        for (const task of this.tasks.values()) {
            if (task.status === 'running') {
                count++;
            }
        }
        return count;
    }

    /**
     * Clean up completed, failed, and cancelled tasks older than cleanupIntervalMs.
     * Called periodically by the cleanup timer to prevent unbounded memory growth.
     */
    private cleanupCompletedTasks(): void {
        const now = Date.now();
        const staleThreshold = now - this.cleanupIntervalMs;
        let cleaned = 0;

        for (const [taskId, task] of this.tasks.entries()) {
            if (task.status === 'running') {
                continue;
            }

            // Remove tasks that ended before the stale threshold
            if (task.endTime && task.endTime < staleThreshold) {
                this.tasks.delete(taskId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.info(`Cleaned up ${cleaned} stale background task(s)`);
        }
    }
}
