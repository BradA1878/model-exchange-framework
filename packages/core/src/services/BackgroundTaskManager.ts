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
 * @documentation https://mxf-dev.github.io/mxf/
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
import { AgentId, ChannelId } from '../types/ChannelContext.js';
import { Logger } from '../utils/Logger.js';
import { Events } from '../events/EventNames.js';
import { EventBus } from '../events/EventBus.js';
import {
    buildShellChildEnv,
    resolveWorkspacePath
} from '../protocols/mcp/security/McpToolPolicy.js';
import {
    createShellExecutionProgressPayload,
    createShellBackgroundStartedPayload,
    createShellBackgroundCompletedPayload
} from '../schemas/ShellExecutionEventPayloads.js';

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

/** Authenticated principal allowed to inspect or mutate a background task. */
export interface BackgroundTaskPrincipal {
    agentId: AgentId;
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
    /** SIGTERM-to-SIGKILL escalation timer. */
    forceKillTimer?: ReturnType<typeof setTimeout>;
    /** Settles after terminal process callbacks and their final event emission complete. */
    completion: Promise<void>;
    resolveCompletion: () => void;
    /** Guards Node's error-then-close sequence from reporting completion twice. */
    terminalFinalized: boolean;
}

// ---- BackgroundTaskManager ----

export class BackgroundTaskManager {
    private static instance: BackgroundTaskManager | undefined;

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
    private shutdownPromise: Promise<void> | undefined;
    private isShuttingDown = false;

    private constructor() {
        // Start periodic cleanup of completed tasks older than cleanupIntervalMs
        this.cleanupTimer = setInterval(() => this.cleanupCompletedTasks(), this.cleanupIntervalMs);
        // A periodic cleanup sweep must never be the reason a process stays alive. Without
        // unref() this timer holds Node's event loop open, so any process that merely
        // touched this singleton — a test worker, a one-shot CLI run — could not exit.
        this.cleanupTimer.unref();
    }

    /** Get the singleton instance of BackgroundTaskManager */
    static getInstance(): BackgroundTaskManager {
        if (!BackgroundTaskManager.instance) {
            BackgroundTaskManager.instance = new BackgroundTaskManager();
        }
        return BackgroundTaskManager.instance;
    }

    /** Stop the live singleton without constructing one solely for teardown. */
    static async shutdownExisting(): Promise<boolean> {
        const instance = BackgroundTaskManager.instance;
        if (!instance) {
            return false;
        }
        await instance.shutdown();
        return true;
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
        if (this.isShuttingDown) {
            throw new Error('BackgroundTaskManager is shutting down');
        }

        // Validate concurrent task limit
        const runningCount = this.getRunningTaskCount();
        if (runningCount >= this.maxConcurrentTasks) {
            throw new Error(
                `Maximum concurrent background tasks reached (${this.maxConcurrentTasks}). ` +
                `Cancel or wait for existing tasks to complete before starting new ones.`
            );
        }

        const taskId = crypto.randomUUID();

        // Build spawn options.
        //
        // Background tasks are spawned directly rather than through the shell tool, so this
        // path bypassed the security guard entirely and handed every child the full server
        // environment — JWT_SECRET, MONGODB_URI, OPENROUTER_API_KEY and the rest. Children
        // get the same stripped environment the guarded shell path builds.
        const spawnOptions: SpawnOptions = {
            shell: true,
            // The command runs under `sh -c`. On Linux, dash forks the command
            // rather than exec'ing it, so a signal to the shell's pid left the
            // real work running and holding the stdio pipes — `close` never
            // fired and shutdown() waited on it. Each task gets its own process
            // group and is signalled as a group (see signalTask).
            detached: process.platform !== 'win32',
            cwd: resolveWorkspacePath(
                options.workingDirectory,
                'BackgroundTaskManager.startBackground'
            ),
            env: buildShellChildEnv(options.environment),
        };

        const childProcess = spawn(command, [], spawnOptions);

        // Create the internal task entry
        let resolveCompletion!: () => void;
        const completion = new Promise<void>(resolve => {
            resolveCompletion = resolve;
        });
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
            completion,
            resolveCompletion,
            terminalFinalized: false,
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
            if (task.terminalFinalized) {
                return;
            }
            task.terminalFinalized = true;
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
            if (task.forceKillTimer) {
                clearTimeout(task.forceKillTimer);
                task.forceKillTimer = undefined;
            }

            const elapsedSeconds = (task.endTime - task.startTime) / 1000;

            this.logger.info(
                `Background task ${task.status}: ${taskId} — ` +
                `exit code: ${exitCode}, elapsed: ${elapsedSeconds.toFixed(1)}s`
            );

            // Emit SHELL_BACKGROUND_COMPLETED event
            try {
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
            } finally {
                task.resolveCompletion();
            }
        });

        // Handle spawn errors (e.g., command not found)
        childProcess.on('error', (error: Error) => {
            if (task.terminalFinalized) {
                return;
            }
            task.terminalFinalized = true;
            task.status = 'failed';
            task.exitCode = 1;
            task.endTime = Date.now();
            task.process = undefined;

            // Clear timeout timer if set
            if (task.timeoutTimer) {
                clearTimeout(task.timeoutTimer);
                task.timeoutTimer = undefined;
            }
            if (task.forceKillTimer) {
                clearTimeout(task.forceKillTimer);
                task.forceKillTimer = undefined;
            }

            this.logger.error(`Background task error: ${taskId} — ${error.message}`);

            // Emit SHELL_BACKGROUND_COMPLETED with failed status
            try {
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
            } finally {
                task.resolveCompletion();
            }
        });

        // Set up timeout if specified
        if (options.timeout && options.timeout > 0) {
            task.timeoutTimer = setTimeout(() => {
                if (task.status === 'running' && task.process) {
                    this.logger.warn(
                        `Background task timed out after ${options.timeout}s: ${taskId}`
                    );
                    this.signalTask(task, 'SIGTERM');
                    this.scheduleForceKill(task, taskId);
                }
            }, options.timeout * 1000);
            task.timeoutTimer.unref?.();
        }

        return { taskId };
    }

    /**
     * Get status info for a background task.
     *
     * @param taskId - The task identifier returned by startBackground()
     * @returns BackgroundTaskInfo with current status and output preview, or null if not found
     */
    getTaskStatus(taskId: string, principal: BackgroundTaskPrincipal): BackgroundTaskInfo | null {
        const task = this.getOwnedTask(taskId, principal);
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
    getTaskOutput(taskId: string, principal: BackgroundTaskPrincipal): string | null {
        const task = this.getOwnedTask(taskId, principal);
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
    cancelTask(taskId: string, principal: BackgroundTaskPrincipal): boolean {
        const task = this.getOwnedTask(taskId, principal);
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
        this.signalTask(task, 'SIGTERM');

        // Escalate to SIGKILL after 5 seconds if still alive
        this.scheduleForceKill(task, taskId);

        return true;
    }

    /**
     * List background tasks owned by the exact authenticated agent/channel pair.
     *
     * @param principal - Authenticated agent and channel identity
     * @returns Array of BackgroundTaskInfo for matching tasks
     */
    listTasks(principal: BackgroundTaskPrincipal): BackgroundTaskInfo[] {
        const results: BackgroundTaskInfo[] = [];
        for (const task of this.tasks.values()) {
            if (task.agentId !== principal.agentId || task.channelId !== principal.channelId) {
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
    shutdown(): Promise<void> {
        if (!this.shutdownPromise) {
            this.isShuttingDown = true;
            this.shutdownPromise = this.performShutdown().finally((): void => {
                if (BackgroundTaskManager.instance === this) {
                    BackgroundTaskManager.instance = undefined;
                }
            });
        }
        return this.shutdownPromise;
    }

    private async performShutdown(): Promise<void> {
        this.logger.info('Shutting down BackgroundTaskManager...');

        // Clear the periodic cleanup timer
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        const completions: Promise<void>[] = [];

        // Terminate every live child and retain ownership until its terminal
        // callback has emitted the final lifecycle event. A task can already be
        // marked cancelled while its process is still exiting, so process
        // ownership — not status — defines what shutdown must drain.
        for (const task of this.tasks.values()) {
            if (task.timeoutTimer) {
                clearTimeout(task.timeoutTimer);
                task.timeoutTimer = undefined;
            }
            if (task.forceKillTimer) {
                clearTimeout(task.forceKillTimer);
                task.forceKillTimer = undefined;
            }

            if (!task.terminalFinalized && task.process) {
                if (task.status === 'running') {
                    task.status = 'cancelled';
                }
                task.endTime ??= Date.now();
                completions.push(task.completion);
                this.signalTask(task, 'SIGKILL');
            }
        }

        await Promise.all(completions);

        this.logger.info('BackgroundTaskManager shut down successfully');
    }

    private scheduleForceKill(task: InternalTask, taskId: string): void {
        if (task.forceKillTimer) {
            clearTimeout(task.forceKillTimer);
        }
        task.forceKillTimer = setTimeout(() => {
            task.forceKillTimer = undefined;
            if (task.process) {
                this.logger.warn(`Force-killing background task: ${taskId} (SIGKILL)`);
                this.signalTask(task, 'SIGKILL');
            }
        }, 5000);
        task.forceKillTimer.unref?.();
    }

    /**
     * Deliver a signal to a task's whole process group — the shell and every
     * process it started — so the work actually stops and its stdio pipes
     * close. A group that has already exited (ESRCH) is not an error.
     */
    private signalTask(task: InternalTask, signal: NodeJS.Signals): void {
        const child = task.process;
        if (!child) {
            return;
        }
        // No pid means the process never started, so there is no group to
        // signal; Windows has no process groups to signal either.
        if (child.pid === undefined || process.platform === 'win32') {
            child.kill(signal);
            return;
        }
        try {
            process.kill(-child.pid, signal);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                throw error;
            }
        }
    }

    // ---- Private helpers ----

    /**
     * Resolve a task only when it belongs to the authenticated principal. Returning
     * null for both missing and foreign task IDs avoids leaking task existence.
     */
    private getOwnedTask(
        taskId: string,
        principal: BackgroundTaskPrincipal
    ): InternalTask | null {
        const task = this.tasks.get(taskId);
        if (
            !task ||
            task.agentId !== principal.agentId ||
            task.channelId !== principal.channelId
        ) {
            return null;
        }
        return task;
    }

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
