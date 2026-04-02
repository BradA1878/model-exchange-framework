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
 * ShellExecuteHandler.ts
 *
 * Enhanced shell command execution handler that integrates command semantics,
 * destructive warnings, command classification, large output handling, and
 * event emission. Replaces the inline handler in InfrastructureTools.ts.
 *
 * Key improvements over the original inline handler:
 * - Uses spawn() instead of exec() — streams output, no maxBuffer limit
 * - Interprets exit codes semantically (e.g., grep returning 1 = no matches, not error)
 * - Classifies commands (read-only, silent, category) for downstream decision-making
 * - Emits lifecycle events (started, completed, failed, destructive warning)
 * - Processes large output through LargeOutputHandler (truncation + MongoDB persistence)
 * - Surfaces destructive command warnings as informational events
 */

import { spawn } from 'child_process';
import crypto from 'crypto';

import { Events } from '../../../../events/EventNames';
import { EventBus } from '../../../../events/EventBus';
import {
    createShellExecutionStartedPayload,
    createShellExecutionCompletedPayload,
    createShellExecutionFailedPayload,
    createShellDestructiveWarningPayload
} from '../../../../schemas/ShellExecutionEventPayloads';
import { getSecurityGuard, SecurityContext } from '../../security/McpSecurityGuard';
import { getConfirmationManager } from '../../security/McpConfirmationManager';
import { Logger } from '../../../../utils/Logger';
import { createStrictValidator } from '../../../../utils/validation';
import { AgentId, ChannelId } from '../../../../types/ChannelContext';

import { classifyCommand } from './CommandClassification';
import { getDestructiveWarnings } from './DestructiveCommandWarnings';
import { interpretExitCode } from './CommandSemantics';
import { processOutput } from './LargeOutputHandler';
import { extractEffectiveCommands } from './ShellCommandParser';

const logger = new Logger('info', 'ShellExecuteHandler', 'server');
const validator = createStrictValidator('ShellExecuteHandler');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for shell command execution.
 * Matches the shell_execute MCP tool's input schema.
 */
export interface ShellExecuteInput {
    /** Shell command to execute */
    command: string;
    /** Command arguments (shell-escaped and appended) */
    args?: string[];
    /** Working directory for command execution */
    workingDirectory?: string;
    /** Additional environment variables merged with process.env */
    environment?: Record<string, string>;
    /** Command timeout in milliseconds (default: 30000) */
    timeout?: number;
    /** Whether to capture and return stdout/stderr (default: true) */
    captureOutput?: boolean;
    /** Whitelist of allowed base commands (checked before execution) */
    allowedCommands?: string[];
    /** Human-readable description of the command's purpose */
    description?: string;
}

/**
 * Execution context identifying the agent, channel, and request.
 */
export interface ShellExecuteContext {
    /** Agent executing the command */
    agentId: AgentId;
    /** Channel in which the command is being executed */
    channelId: ChannelId;
    /** Unique request identifier for event correlation */
    requestId: string;
}

/**
 * Enhanced result of shell command execution.
 * All new fields are optional to maintain backward compatibility with
 * consumers that only expect the original result shape.
 */
export interface ShellExecuteResult {
    /** The full command string that was executed (including expanded args) */
    command: string;
    /** Human-readable description of the command's purpose */
    description?: string;
    /** Process exit code */
    exitCode: number;
    /** Semantic meaning of the exit code (e.g., "no matches found" for grep 1) */
    exitCodeMeaning?: string;
    /** Whether the exit code represents an actual error (semantic-aware) */
    isError: boolean;
    /** Captured stdout (undefined if captureOutput is false) */
    stdout?: string;
    /** Captured stderr (undefined if captureOutput is false) */
    stderr?: string;
    /** Command classification metadata */
    classification?: {
        /** Primary category (e.g., 'read', 'write', 'git', 'network') */
        category: string;
        /** Whether the command only reads data */
        isReadOnly: boolean;
        /** Whether the command produces no useful stdout on success */
        isSilent: boolean;
    };
    /** Destructive command warnings (informational, does not block execution) */
    warnings?: string[];
    /** Execution time in milliseconds */
    executionTime: number;
    /** Timestamp when execution completed */
    executedAt: number;
    /** Whether stdout was truncated by the large output handler */
    outputTruncated?: boolean;
    /** MongoDB document ID if full output was persisted */
    persistedOutputId?: string;
    /** Total output size in bytes before any truncation */
    totalOutputBytes?: number;
    /** Total number of lines in original output */
    totalOutputLines?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a short SHA-256 hash of a command string for event correlation
 * and large output handler context.
 */
function computeCommandHash(command: string): string {
    return crypto.createHash('sha256').update(command).digest('hex').slice(0, 16);
}

/**
 * Shell-escape an argument by wrapping in single quotes and escaping
 * embedded single quotes. Matches the escaping logic from InfrastructureTools.
 */
function shellEscapeArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the full command string from base command and optional arguments.
 */
function buildFullCommand(command: string, args?: string[]): string {
    if (!args || args.length === 0) {
        return command;
    }
    const escapedArgs = args.map(shellEscapeArg).join(' ');
    return `${command} ${escapedArgs}`;
}

/**
 * Execute a command using spawn() wrapped in a Promise.
 * Returns stdout, stderr, and exit code once the process closes.
 */
function spawnCommand(
    fullCommand: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeout: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
        const child = spawn(fullCommand, [], {
            shell: true,
            cwd,
            env,
            timeout
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderrChunks.push(chunk);
        });

        child.on('error', (err: Error) => {
            // Spawn-level error (e.g., command not found, ENOENT)
            reject(err);
        });

        child.on('close', (exitCode: number | null) => {
            resolve({
                stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
                stderr: Buffer.concat(stderrChunks).toString('utf-8'),
                exitCode: exitCode ?? 1
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Main execute function
// ---------------------------------------------------------------------------

/**
 * Execute a shell command with enhanced semantics, classification, warnings,
 * large output handling, and event emission.
 *
 * This function replaces the inline handler from InfrastructureTools.shellExecTool.
 * It integrates with the Phase 1+2 modules (CommandSemantics, CommandClassification,
 * DestructiveCommandWarnings, LargeOutputHandler) and emits shell execution lifecycle
 * events via EventBus.
 *
 * @param input - Command and execution parameters
 * @param context - Agent/channel/request context for events and security
 * @returns Enhanced execution result with semantic exit codes and classification
 */
export async function execute(
    input: ShellExecuteInput,
    context: ShellExecuteContext
): Promise<ShellExecuteResult> {
    try {
        // ── 1. Validate input ──────────────────────────────────────────────
        validator.assertIsString(input.command, 'command');

        // ── 2. Classify the command ────────────────────────────────────────
        const classification = classifyCommand(input.command);

        // ── 3. Check for destructive warnings (informational only) ─────────
        const destructiveWarnings = getDestructiveWarnings(input.command);
        const warningMessages = destructiveWarnings.map(w => w.warning);

        // ── 4. Security validation ─────────────────────────────────────────
        const securityGuard = getSecurityGuard();
        const confirmationManager = getConfirmationManager();

        const securityContext: SecurityContext = {
            agentId: context.agentId,
            channelId: context.channelId,
            requestId: context.requestId
        };

        const commandValidation = securityGuard.validateCommand(input.command, securityContext);

        if (!commandValidation.allowed) {
            throw new Error(commandValidation.reason || 'Command not allowed');
        }

        // Request confirmation if the security guard requires it
        if (commandValidation.requiresConfirmation) {
            const confirmed = await confirmationManager.requestConfirmation(
                'command',
                'Execute shell command',
                {
                    command: input.command,
                    riskLevel: commandValidation.riskLevel || 'medium',
                    reason: commandValidation.reason || 'Command requires confirmation'
                },
                securityContext,
                input.timeout || 30000
            );

            if (!confirmed) {
                throw new Error('Command execution denied by user');
            }
        }

        // ── 5. Emit destructive warning event if applicable ────────────────
        if (destructiveWarnings.length > 0) {
            logger.warn(`Destructive command warnings for "${input.command}": ${warningMessages.join('; ')}`);

            EventBus.server.emit(
                Events.Shell.SHELL_DESTRUCTIVE_WARNING,
                createShellDestructiveWarningPayload(
                    context.agentId,
                    context.channelId,
                    {
                        requestId: context.requestId,
                        command: input.command,
                        warnings: destructiveWarnings.map(w => ({
                            warning: w.warning,
                            severity: w.severity
                        }))
                    }
                )
            );
        }

        // ── 6. Check allowed commands whitelist ────────────────────────────
        if (input.allowedCommands) {
            // Use the parser to extract the effective command, handling env
            // prefixes (FOO=bar cmd) and wrappers (sudo cmd, timeout 5 cmd)
            const effectiveCommands = extractEffectiveCommands(input.command);
            for (const effectiveCmd of effectiveCommands) {
                if (!input.allowedCommands.includes(effectiveCmd)) {
                    throw new Error(`Command '${effectiveCmd}' not in allowed commands list`);
                }
            }
        }

        // ── 7. Build command string and compute hash ───────────────────────
        const fullCommand = buildFullCommand(input.command, input.args);
        const commandHash = computeCommandHash(input.command);
        const timeout = input.timeout || 30000;
        const captureOutput = input.captureOutput !== false; // default true

        // ── 8. Emit SHELL_EXECUTION_STARTED event ──────────────────────────
        EventBus.server.emit(
            Events.Shell.SHELL_EXECUTION_STARTED,
            createShellExecutionStartedPayload(
                context.agentId,
                context.channelId,
                {
                    requestId: context.requestId,
                    command: fullCommand,
                    description: input.description,
                    commandHash,
                    timeout,
                    classification: {
                        category: classification.category,
                        isReadOnly: classification.isReadOnly
                    },
                    warnings: warningMessages
                }
            )
        );

        // ── 9. Execute the command using spawn() ───────────────────────────
        const startTime = Date.now();
        let stdout = '';
        let stderr = '';
        let exitCode = 0;

        try {
            const result = await spawnCommand(
                fullCommand,
                input.workingDirectory || process.cwd(),
                { ...process.env, ...input.environment } as NodeJS.ProcessEnv,
                timeout
            );
            stdout = result.stdout;
            stderr = result.stderr;
            exitCode = result.exitCode;
        } catch (spawnError: any) {
            // Spawn-level error (ENOENT = command not found, etc.)
            const executionTime = Date.now() - startTime;
            const errorMessage = spawnError.message || String(spawnError);

            logger.error(`Spawn error for "${fullCommand}": ${errorMessage}`);

            // Emit failed event for spawn errors
            EventBus.server.emit(
                Events.Shell.SHELL_EXECUTION_FAILED,
                createShellExecutionFailedPayload(
                    context.agentId,
                    context.channelId,
                    {
                        requestId: context.requestId,
                        command: fullCommand,
                        error: errorMessage,
                        exitCode: 127,
                        executionTime
                    }
                )
            );

            return {
                command: fullCommand,
                description: input.description,
                exitCode: 127,
                exitCodeMeaning: 'Command not found or spawn error',
                isError: true,
                stderr: captureOutput ? errorMessage : undefined,
                classification: {
                    category: classification.category,
                    isReadOnly: classification.isReadOnly,
                    isSilent: classification.isSilent
                },
                warnings: warningMessages.length > 0 ? warningMessages : undefined,
                executionTime,
                executedAt: Date.now()
            };
        }

        const executionTime = Date.now() - startTime;

        // ── 10. Interpret exit code semantically ───────────────────────────
        const semanticResult = interpretExitCode(input.command, exitCode, stdout, stderr);

        // ── 11. Process output through large output handler ────────────────
        let outputTruncated = false;
        let persistedOutputId: string | undefined;
        let totalOutputBytes = 0;
        let totalOutputLines = 0;
        let processedStdout = stdout;

        if (captureOutput && stdout) {
            const processed = await processOutput(
                stdout,
                {
                    agentId: context.agentId,
                    channelId: context.channelId,
                    commandHash
                }
            );
            processedStdout = processed.inline;
            outputTruncated = processed.isTruncated;
            totalOutputBytes = processed.totalBytes;
            totalOutputLines = processed.totalLines;
            persistedOutputId = processed.persistedOutputId;
        }

        // ── 12. Emit completion or failure event ───────────────────────────
        const outputSize = totalOutputBytes || Buffer.byteLength(stdout, 'utf-8');

        if (semanticResult.isError) {
            EventBus.server.emit(
                Events.Shell.SHELL_EXECUTION_FAILED,
                createShellExecutionFailedPayload(
                    context.agentId,
                    context.channelId,
                    {
                        requestId: context.requestId,
                        command: fullCommand,
                        error: stderr || semanticResult.meaning,
                        exitCode,
                        executionTime
                    }
                )
            );
        } else {
            EventBus.server.emit(
                Events.Shell.SHELL_EXECUTION_COMPLETED,
                createShellExecutionCompletedPayload(
                    context.agentId,
                    context.channelId,
                    {
                        requestId: context.requestId,
                        command: fullCommand,
                        exitCode,
                        exitCodeMeaning: semanticResult.meaning,
                        isError: false,
                        executionTime,
                        outputSize,
                        outputTruncated,
                        persistedOutputId
                    }
                )
            );
        }

        // ── 13. Return enhanced result ─────────────────────────────────────
        return {
            command: fullCommand,
            description: input.description,
            exitCode,
            exitCodeMeaning: semanticResult.meaning,
            isError: semanticResult.isError,
            stdout: captureOutput ? processedStdout : undefined,
            stderr: captureOutput ? stderr : undefined,
            classification: {
                category: classification.category,
                isReadOnly: classification.isReadOnly,
                isSilent: classification.isSilent
            },
            warnings: warningMessages.length > 0 ? warningMessages : undefined,
            executionTime,
            executedAt: Date.now(),
            outputTruncated: outputTruncated || undefined,
            persistedOutputId,
            totalOutputBytes: totalOutputBytes || undefined,
            totalOutputLines: totalOutputLines || undefined
        };

    } catch (error) {
        logger.error(`Failed to execute command: ${error}`);
        throw new Error(
            `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
