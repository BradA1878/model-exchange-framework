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
 * InfrastructureTools.ts
 * 
 * MCP tools for core infrastructure operations including filesystem, database,
 * memory/storage, and shell operations. These tools provide essential capabilities
 * for agents to interact with system resources through the MCP protocol.
 */

import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { Logger } from '../../../utils/Logger';
import { createStrictValidator } from '../../../utils/validation';
import { INFRASTRUCTURE_TOOLS } from '../../../constants/ToolNames';
import fs from 'fs/promises';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { getSecurityGuard, SecurityContext } from '../security/McpSecurityGuard';
import { getConfirmationManager } from '../security/McpConfirmationManager';
import { execute as shellExecuteHandler } from './shell/ShellExecuteHandler';
import { processOutput } from './shell/LargeOutputHandler';
import { BackgroundTaskManager } from '../../../services/BackgroundTaskManager';
import { MemoryService } from '../../../services/MemoryService';
import { CodeExecutionSandboxService, ExecutionLanguage } from '../../../services/CodeExecutionSandboxService';
import { Events } from '../../../events/EventNames';
import { EventBus } from '../../../events/EventBus';
import { CodeExecution } from '../../../models/codeExecution';
import {
    createCodeExecutionStartedPayload,
    createCodeExecutionCompletedPayload,
    createCodeExecutionFailedPayload,
    createCodeValidationStartedPayload,
    createCodeSecurityIssuePayload,
    createCodeExecutionTimeoutPayload
} from '../../../schemas/CodeExecutionEventPayloads';

const logger = new Logger('info', 'InfrastructureTools', 'server');
const validator = createStrictValidator('InfrastructureTools');
const execAsync = promisify(exec);

// Initialize security modules
const securityGuard = getSecurityGuard(process.cwd());
const confirmationManager = getConfirmationManager();

/**
 * Helper function to execute shell commands - can be used by other tools
 */
export async function executeShellCommand(
    command: string,
    args?: string[],
    options?: {
        workingDirectory?: string;
        environment?: Record<string, string>;
        timeout?: number;
        captureOutput?: boolean;
    }
): Promise<{
    command: string;
    exitCode: number;
    stdout?: string;
    stderr?: string;
    executionTime: number;
    executedAt: number;
}> {
    const startTime = Date.now();
    
    try {
        // Build the full command string with properly escaped arguments
        // Shell-escape each argument by wrapping in single quotes and escaping any embedded single quotes
        const quotedArgs = args ? args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ') : '';
        const fullCommand = args ? `${command} ${quotedArgs}` : command;

        // Execute the command
        const result = await execAsync(fullCommand, {
            cwd: options?.workingDirectory || process.cwd(),
            env: { ...process.env, ...options?.environment },
            timeout: options?.timeout || 30000,
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        
        const executionTime = Date.now() - startTime;
        
        return {
            command: fullCommand,
            exitCode: 0,
            stdout: options?.captureOutput !== false ? result.stdout : undefined,
            stderr: options?.captureOutput !== false ? result.stderr : undefined,
            executionTime,
            executedAt: Date.now()
        };
        
    } catch (execError: any) {
        const executionTime = Date.now() - startTime;
        
        // Handle execution errors (non-zero exit codes)
        return {
            command: command,
            exitCode: execError.code || 1,
            stdout: options?.captureOutput !== false ? execError.stdout || '' : undefined,
            stderr: options?.captureOutput !== false ? execError.stderr || execError.message : undefined,
            executionTime,
            executedAt: Date.now()
        };
    }
}

/**
 * NOTE: Filesystem tools (read, write, list) are provided by the external MCP filesystem server
 * (@modelcontextprotocol/server-filesystem) configured in ExternalServerConfigs.ts
 *
 * The external server provides:
 * - read_file: Read file contents with encoding support
 * - write_file: Write/append to files with safety checks
 * - list_directory: List directory contents with filtering
 * - get_file_info: Get file metadata
 * - search_files: Search for files by name/pattern
 *
 * These tools were removed from internal implementation to avoid duplication
 * and ensure consistent filesystem access through the MCP protocol.
 */

/**
 * MCP Tool: memory_store
 * Store key-value data with expiration and metadata
 */
export const memoryStoreTool = {
    name: INFRASTRUCTURE_TOOLS.MEMORY_STORE,
    description: 'Store key-value data with expiration and metadata',
    inputSchema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'Storage key'
            },
            value: {
                description: 'Value to store (any JSON-serializable data)'
            },
            ttl: {
                type: 'number',
                description: 'Time-to-live in milliseconds',
                minimum: 0
            },
            namespace: {
                type: 'string',
                description: 'Optional namespace for the key',
                default: 'default'
            },
            metadata: {
                type: 'object',
                description: 'Optional metadata to store with the value'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags for categorization'
            }
        },
        required: ['key', 'value']
    },

    async handler(input: {
        key: string;
        value: any;
        ttl?: number;
        namespace?: string;
        metadata?: Record<string, any>;
        tags?: string[];
    }, context: {
        agentId: AgentId;
        channelId: ChannelId;
        requestId: string;
    }): Promise<{
        key: string;
        namespace: string;
        stored: boolean;
        expiresAt?: number;
        storedAt: number;
    }> {
        try {
            validator.assertIsString(input.key, 'key');
            
            const namespace = input.namespace || 'default';
            const fullKey = `${context.agentId}:${namespace}:${input.key}`;
            const expiresAt = input.ttl ? Date.now() + input.ttl : undefined;


            // Use real MemoryService for storage
            const memoryService = MemoryService.getInstance();
            const dataToStore = {
                value: input.value,
                expiresAt,
                metadata: input.metadata,
                tags: input.tags,
                storedBy: context.agentId,
                storedAt: Date.now()
            };
            memoryService.setGeneralData(fullKey, dataToStore);

            return {
                key: input.key,
                namespace,
                stored: true,
                expiresAt,
                storedAt: Date.now()
            };
        } catch (error) {
            logger.error(`Failed to store memory: ${error}`);
            throw new Error(`Failed to store memory: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

/**
 * MCP Tool: memory_retrieve
 * Retrieve stored data with fallback options
 */
export const memoryRetrieveTool = {
    name: INFRASTRUCTURE_TOOLS.MEMORY_RETRIEVE,
    description: 'Retrieve stored data with fallback options',
    inputSchema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'Storage key to retrieve'
            },
            namespace: {
                type: 'string',
                description: 'Optional namespace for the key',
                default: 'default'
            },
            includeMetadata: {
                type: 'boolean',
                default: false,
                description: 'Include metadata in the response'
            },
            defaultValue: {
                description: 'Default value if key not found'
            }
        },
        required: ['key']
    },

    async handler(input: {
        key: string;
        namespace?: string;
        includeMetadata?: boolean;
        defaultValue?: any;
    }, context: {
        agentId: AgentId;
        channelId: ChannelId;
        requestId: string;
    }): Promise<{
        key: string;
        namespace: string;
        value: any;
        found: boolean;
        expiresAt?: number;
        metadata?: Record<string, any>;
        retrievedAt: number;
    }> {
        try {
            validator.assertIsString(input.key, 'key');

            const namespace = input.namespace || 'default';
            const fullKey = `${context.agentId}:${namespace}:${input.key}`;


            // Use real MemoryService for storage
            const memoryService = MemoryService.getInstance();
            const storedData = memoryService.getGeneralData(fullKey);

            const found = storedData !== undefined;
            const value = found ? storedData : input.defaultValue;

            return {
                key: input.key,
                namespace,
                value,
                found,
                expiresAt: found && storedData?.expiresAt ? storedData.expiresAt : undefined,
                metadata: input.includeMetadata && found ? {
                    storedBy: context.agentId,
                    fullKey,
                    timestamp: Date.now()
                } : undefined,
                retrievedAt: Date.now()
            };
        } catch (error) {
            logger.error(`Failed to retrieve memory: ${error}`);
            throw new Error(`Failed to retrieve memory: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

/**
 * MCP Tool: shell_execute
 * Execute shell commands with output capture and safety controls
 */
export const shellExecTool = {
    name: INFRASTRUCTURE_TOOLS.SHELL_EXECUTE,
    description: 'Execute shell commands with output capture and safety controls',
    inputSchema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'Shell command to execute'
            },
            args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Command arguments'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory for command execution'
            },
            environment: {
                type: 'object',
                description: 'Environment variables'
            },
            timeout: {
                type: 'number',
                description: 'Command timeout in milliseconds',
                default: 30000
            },
            captureOutput: {
                type: 'boolean',
                default: true,
                description: 'Whether to capture command output'
            },
            allowedCommands: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of allowed commands (for security)'
            },
            description: {
                type: 'string',
                description: 'Human-readable summary of what this command does (for logging, audit trails, and display)'
            },
            runInBackground: {
                type: 'boolean',
                default: false,
                description: 'Run the command in the background. Returns a taskId immediately that can be queried with shell_task_status.'
            },
            backgroundTimeout: {
                type: 'number',
                description: 'Timeout in seconds for background tasks (only used when runInBackground is true)',
                minimum: 1
            }
        },
        required: ['command']
    },

    /**
     * Delegates to the enhanced ShellExecuteHandler for foreground execution, or
     * to BackgroundTaskManager for background execution.
     *
     * Foreground mode provides:
     * - Command semantics (exit code interpretation)
     * - Destructive command warnings
     * - Command classification (read-only, silent, etc.)
     * - Large output handling (persist + preview)
     * - Event emission throughout lifecycle
     * - spawn() instead of exec() for streaming
     *
     * Background mode provides:
     * - Immediate taskId return
     * - Ring-buffer output accumulation
     * - Throttled progress events via EventBus
     * - Query via shell_task_status tool
     */
    async handler(input: {
        command: string;
        args?: string[];
        workingDirectory?: string;
        environment?: Record<string, string>;
        timeout?: number;
        captureOutput?: boolean;
        allowedCommands?: string[];
        description?: string;
        runInBackground?: boolean;
        backgroundTimeout?: number;
    }, context: {
        agentId: AgentId;
        channelId: ChannelId;
        requestId: string;
    }) {
        // Background execution: delegate to BackgroundTaskManager
        if (input.runInBackground) {
            const btm = BackgroundTaskManager.getInstance();
            const { taskId } = await btm.startBackground(
                input.command,
                {
                    workingDirectory: input.workingDirectory,
                    environment: input.environment,
                    timeout: input.backgroundTimeout,
                    description: input.description
                },
                context
            );
            return {
                taskId,
                command: input.command,
                description: input.description,
                status: 'running',
                message: `Background task started. Use shell_task_status with taskId "${taskId}" to check progress.`
            };
        }

        // Foreground execution: delegate to ShellExecuteHandler
        return shellExecuteHandler(input, context);
    }
};

/**
 * MCP Tool: shell_task_status
 * Query the status and output of background shell tasks started via shell_execute
 * with runInBackground: true.
 */
export const shellTaskStatusTool = {
    name: INFRASTRUCTURE_TOOLS.SHELL_TASK_STATUS,
    description: 'Get status, output preview, or cancel a background shell task. Use after starting a command with runInBackground: true.',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'The taskId returned by shell_execute when runInBackground was true'
            },
            action: {
                type: 'string',
                enum: ['status', 'output', 'cancel', 'list'],
                default: 'status',
                description: 'Action to perform: status (get task info), output (get full output), cancel (stop the task), list (list all tasks)'
            },
            agentId: {
                type: 'string',
                description: 'Filter tasks by agent (only used with action: list)'
            }
        },
        required: []
    },

    async handler(input: {
        taskId?: string;
        action?: 'status' | 'output' | 'cancel' | 'list';
        agentId?: AgentId;
    }, context: {
        agentId: AgentId;
        channelId: ChannelId;
        requestId: string;
    }) {
        const btm = BackgroundTaskManager.getInstance();
        const action = input.action || 'status';

        if (action === 'list') {
            const tasks = btm.listTasks(input.agentId as AgentId);
            return {
                action: 'list',
                count: tasks.length,
                tasks
            };
        }

        if (!input.taskId) {
            throw new Error('taskId is required for status, output, and cancel actions');
        }

        if (action === 'cancel') {
            const cancelled = btm.cancelTask(input.taskId);
            return {
                action: 'cancel',
                taskId: input.taskId,
                cancelled,
                message: cancelled
                    ? 'Task cancellation initiated (SIGTERM sent)'
                    : 'Task not found or not running'
            };
        }

        if (action === 'output') {
            const output = btm.getTaskOutput(input.taskId);
            if (output === null) {
                throw new Error(`Task not found: ${input.taskId}`);
            }
            return {
                action: 'output',
                taskId: input.taskId,
                output,
                outputSize: Buffer.byteLength(output, 'utf-8')
            };
        }

        // Default: status
        const status = btm.getTaskStatus(input.taskId);
        if (!status) {
            throw new Error(`Task not found: ${input.taskId}`);
        }
        return {
            action: 'status',
            ...status
        };
    }
};

/**
 * MCP Tool: code_execute
 * Execute code in a sandboxed environment with security and resource limits
 */
export const codeExecuteTool = {
    name: INFRASTRUCTURE_TOOLS.CODE_EXECUTE,
    description: 'Execute JavaScript or TypeScript code in a secure sandbox with timeout and resource limits. Ideal for data transformation, calculations, and multi-step workflows without model round-trips.',
    inputSchema: {
        type: 'object',
        properties: {
            language: {
                type: 'string',
                enum: ['javascript', 'typescript'],
                description: 'Programming language to execute',
                default: 'javascript'
            },
            code: {
                type: 'string',
                description: 'Code to execute. Should return a value or use console.log for output.',
                minLength: 1
            },
            timeout: {
                type: 'number',
                description: 'Execution timeout in milliseconds',
                default: 5000,
                minimum: 100,
                maximum: 30000
            },
            context: {
                type: 'object',
                description: 'Additional context data available to the code',
                additionalProperties: true
            },
            captureConsole: {
                type: 'boolean',
                description: 'Capture console.log output',
                default: true
            },
            description: {
                type: 'string',
                description: 'Human-readable summary of what this code does (for logging, audit trails, and display)'
            }
        },
        required: ['code'],
        additionalProperties: false
    },
    examples: [
        {
            input: {
                language: 'javascript',
                code: 'const sum = [1, 2, 3, 4, 5].reduce((a, b) => a + b, 0); return sum;'
            },
            description: 'Calculate sum of array'
        },
        {
            input: {
                language: 'javascript',
                code: 'const filtered = context.data.filter(item => item.score > 0.8); return filtered.length;',
                context: {
                    data: [
                        { score: 0.9, name: 'A' },
                        { score: 0.7, name: 'B' },
                        { score: 0.85, name: 'C' }
                    ]
                }
            },
            description: 'Filter data based on score threshold'
        }
    ],

    async handler(input: {
        language?: ExecutionLanguage;
        code: string;
        timeout?: number;
        context?: Record<string, any>;
        captureConsole?: boolean;
    }, context: {
        agentId: AgentId;
        channelId: ChannelId;
        requestId: string;
    }): Promise<{
        content: {
            type: string;
            data: {
                success: boolean;
                output: any;
                logs?: string[];
                executionTime: number;
                codeHash: string;
                error?: string;
                resourceUsage: {
                    memory: number;
                    timeout: boolean;
                };
                outputTruncated?: boolean;
                persistedOutputId?: string;
            };
        };
    }> {
        const startTime = Date.now();
        const language = input.language || 'javascript';

        // Generate code hash early for tracking (even if validation fails)
        const codeHash = crypto.createHash('sha256').update(input.code).digest('hex').substring(0, 16);

        try {
            validator.assertIsString(input.code, 'code');

            // Get sandbox service
            const sandboxService = CodeExecutionSandboxService.getInstance();

            // Validate code safety
            const validation = sandboxService.validateCode(input.code);

            // Emit validation started event
            EventBus.server.emit(
                Events.CodeExecution.CODE_VALIDATION_STARTED,
                createCodeValidationStartedPayload(
                    context.agentId,
                    context.channelId,
                    {
                        requestId: context.requestId,
                        codeHash
                    }
                )
            );

            if (!validation.safe) {
                const errorMessage = validation.issues
                    .filter(i => i.type === 'error')
                    .map(i => i.message)
                    .join('; ');

                // Emit security issue event
                EventBus.server.emit(
                    Events.CodeExecution.CODE_SECURITY_ISSUE,
                    createCodeSecurityIssuePayload(
                        context.agentId,
                        context.channelId,
                        {
                            requestId: context.requestId,
                            codeHash,
                            issueType: 'dangerous_pattern',
                            description: errorMessage,
                            severity: 'high'
                        }
                    )
                );

                throw new Error(`Code validation failed: ${errorMessage}`);
            }


            // Prepare sandbox context
            const sandboxContext = {
                agentId: context.agentId,
                channelId: context.channelId,
                requestId: context.requestId,
                ...(input.context || {})
            };

            // Emit execution started event
            EventBus.server.emit(
                Events.CodeExecution.CODE_EXECUTION_STARTED,
                createCodeExecutionStartedPayload(
                    context.agentId,
                    context.channelId,
                    {
                        requestId: context.requestId,
                        language,
                        codeHash,
                        codeLength: input.code.length,
                        timeout: input.timeout || 5000
                    }
                )
            );

            // Execute code based on language
            let result;
            if (language === 'javascript') {
                result = await sandboxService.executeJavaScript(
                    input.code,
                    sandboxContext,
                    {
                        timeout: input.timeout || 5000,
                        captureConsole: input.captureConsole !== false
                    }
                );
            } else if (language === 'typescript') {
                result = await sandboxService.executeTypeScript(
                    input.code,
                    sandboxContext,
                    {
                        timeout: input.timeout || 5000,
                        captureConsole: input.captureConsole !== false
                    }
                );
            } else {
                throw new Error(`Unsupported language: ${language}`);
            }

            const totalExecutionTime = Date.now() - startTime;

            // Emit appropriate completion event
            if (result.success) {
                EventBus.server.emit(
                    Events.CodeExecution.CODE_EXECUTION_COMPLETED,
                    createCodeExecutionCompletedPayload(
                        context.agentId,
                        context.channelId,
                        {
                            requestId: context.requestId,
                            language,
                            codeHash: result.codeHash,
                            executionTime: result.executionTime,
                            outputSize: JSON.stringify(result.output || '').length,
                            logCount: result.logs.length,
                            resourceUsage: result.resourceUsage
                        }
                    )
                );

            } else {
                // Determine error type
                const errorType = result.resourceUsage.timeout ? 'timeout' :
                                result.error?.includes('validation') ? 'validation' : 'runtime';

                EventBus.server.emit(
                    Events.CodeExecution.CODE_EXECUTION_FAILED,
                    createCodeExecutionFailedPayload(
                        context.agentId,
                        context.channelId,
                        {
                            requestId: context.requestId,
                            language,
                            codeHash: result.codeHash,
                            error: result.error || 'Unknown error',
                            errorType,
                            executionTime: result.executionTime
                        }
                    )
                );

                if (result.resourceUsage.timeout) {
                    EventBus.server.emit(
                        Events.CodeExecution.CODE_EXECUTION_TIMEOUT,
                        createCodeExecutionTimeoutPayload(
                            context.agentId,
                            context.channelId,
                            {
                                requestId: context.requestId,
                                codeHash: result.codeHash,
                                timeout: input.timeout || 5000,
                                actualTime: result.executionTime
                            }
                        )
                    );
                }
            }

            // Persist execution record to MongoDB
            try {
                await CodeExecution.create({
                    agentId: context.agentId,
                    channelId: context.channelId,
                    requestId: context.requestId,
                    language,
                    codeHash: result.codeHash,
                    codeLength: input.code.length,
                    codeSnippet: input.code.substring(0, 500), // Store first 500 chars
                    success: result.success,
                    output: result.output,
                    logs: result.logs,
                    error: result.error,
                    executionTime: result.executionTime,
                    timeout: input.timeout || 5000,
                    memoryUsage: result.resourceUsage.memory,
                    timeoutOccurred: result.resourceUsage.timeout,
                    contextData: input.context,
                    executedAt: new Date()
                });

            } catch (dbError) {
                // Don't fail the execution if database save fails
                logger.error('Failed to persist code execution to database', {
                    error: dbError,
                    codeHash: result.codeHash
                });
            }

            // Apply LargeOutputHandler to code execution output if it's large
            const outputStr = String(result.output ?? '');
            let processedOutput = result.output;
            let outputTruncated = false;
            let persistedOutputId: string | undefined;

            if (Buffer.byteLength(outputStr, 'utf-8') > 512 * 1024) {
                const processed = await processOutput(
                    outputStr,
                    {
                        agentId: context.agentId,
                        channelId: context.channelId,
                        commandHash: result.codeHash
                    }
                );
                processedOutput = processed.inline;
                outputTruncated = processed.isTruncated;
                persistedOutputId = processed.persistedOutputId;
            }

            return {
                content: {
                    type: 'application/json',
                    data: {
                        success: result.success,
                        output: processedOutput,
                        logs: input.captureConsole !== false ? result.logs : undefined,
                        executionTime: result.executionTime,
                        codeHash: result.codeHash,
                        error: result.error,
                        resourceUsage: result.resourceUsage,
                        outputTruncated: outputTruncated || undefined,
                        persistedOutputId
                    }
                }
            };

        } catch (error) {
            const totalExecutionTime = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.error(`Code execution failed: ${error}`, {
                agentId: context.agentId,
                error: errorMessage
            });

            // Emit failure event
            EventBus.server.emit(
                Events.CodeExecution.CODE_EXECUTION_FAILED,
                createCodeExecutionFailedPayload(
                    context.agentId,
                    context.channelId,
                    {
                        requestId: context.requestId,
                        language,
                        codeHash,
                        error: errorMessage,
                        errorType: 'runtime',
                        executionTime: totalExecutionTime
                    }
                )
            );

            // Persist failed execution to MongoDB
            try {
                await CodeExecution.create({
                    agentId: context.agentId,
                    channelId: context.channelId,
                    requestId: context.requestId,
                    language,
                    codeHash,
                    codeLength: input.code.length,
                    codeSnippet: input.code.substring(0, 500),
                    success: false,
                    output: null,
                    logs: [],
                    error: errorMessage,
                    executionTime: totalExecutionTime,
                    timeout: input.timeout || 5000,
                    memoryUsage: 0,
                    timeoutOccurred: false,
                    contextData: input.context,
                    executedAt: new Date()
                });
            } catch (dbError) {
                logger.error('Failed to persist failed execution to database', {
                    error: dbError
                });
            }

            throw new Error(`Code execution failed: ${errorMessage}`);
        }
    }
};

/**
 * Export all infrastructure MCP tools
 *
 * NOTE: Filesystem tools are provided by the external @modelcontextprotocol/server-filesystem
 * MCP server configured in ExternalServerConfigs.ts (autoStart: true)
 */
export const infrastructureTools = [
    memoryStoreTool,
    memoryRetrieveTool,
    shellExecTool,
    shellTaskStatusTool,
    codeExecuteTool
];
