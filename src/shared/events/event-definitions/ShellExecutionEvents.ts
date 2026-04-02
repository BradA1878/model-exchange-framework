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
 * ShellExecutionEvents.ts
 *
 * Event definitions for shell execution operations.
 * These events track shell command execution lifecycle, progress,
 * destructive command warnings, background execution, and output persistence.
 */

import { AgentId, ChannelId } from '../../types/ChannelContext';

/**
 * Shell execution event constants
 */
export const ShellExecutionEvents = {
    /** Shell command execution started */
    SHELL_EXECUTION_STARTED: 'shell:execution:started',

    /** Shell command execution completed successfully */
    SHELL_EXECUTION_COMPLETED: 'shell:execution:completed',

    /** Shell command execution failed */
    SHELL_EXECUTION_FAILED: 'shell:execution:failed',

    /** Shell command execution progress update */
    SHELL_EXECUTION_PROGRESS: 'shell:execution:progress',

    /** Destructive command warning issued */
    SHELL_DESTRUCTIVE_WARNING: 'shell:destructive:warning',

    /** Background shell command started */
    SHELL_BACKGROUND_STARTED: 'shell:background:started',

    /** Background shell command completed */
    SHELL_BACKGROUND_COMPLETED: 'shell:background:completed',

    /** Shell output persisted to storage */
    SHELL_OUTPUT_PERSISTED: 'shell:output:persisted',
} as const;

/**
 * Shell execution started event payload
 */
export interface ShellExecutionStartedPayload {
    /** Event type */
    eventType: typeof ShellExecutionEvents.SHELL_EXECUTION_STARTED;

    /** Agent executing the command */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Shell command being executed */
    command: string;

    /** Human-readable description of the command */
    description?: string;

    /** Hash of the command for tracking */
    commandHash: string;

    /** Execution timeout in milliseconds */
    timeout: number;

    /** Command classification */
    classification: {
        /** Command category (e.g., 'file_system', 'network', 'process') */
        category: string;

        /** Whether the command is read-only (no side effects) */
        isReadOnly: boolean;
    };

    /** Warnings about the command */
    warnings: string[];

    /** Start timestamp */
    timestamp: number;
}

/**
 * Shell execution completed event payload
 */
export interface ShellExecutionCompletedPayload {
    /** Event type */
    eventType: typeof ShellExecutionEvents.SHELL_EXECUTION_COMPLETED;

    /** Agent executing the command */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Shell command that was executed */
    command: string;

    /** Process exit code */
    exitCode: number;

    /** Human-readable meaning of the exit code */
    exitCodeMeaning?: string;

    /** Whether the exit code indicates an error */
    isError: boolean;

    /** Execution time in milliseconds */
    executionTime: number;

    /** Output size in bytes */
    outputSize: number;

    /** Whether the output was truncated */
    outputTruncated: boolean;

    /** ID of the persisted output, if output was persisted */
    persistedOutputId?: string;

    /** Completion timestamp */
    timestamp: number;
}

/**
 * Shell execution failed event payload
 */
export interface ShellExecutionFailedPayload {
    /** Event type */
    eventType: typeof ShellExecutionEvents.SHELL_EXECUTION_FAILED;

    /** Agent executing the command */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Shell command that failed */
    command: string;

    /** Error message */
    error: string;

    /** Process exit code */
    exitCode: number;

    /** Execution time before failure in milliseconds */
    executionTime: number;

    /** Failure timestamp */
    timestamp: number;
}

/**
 * Shell execution progress event payload
 */
export interface ShellExecutionProgressPayload {
    /** Event type */
    eventType: typeof ShellExecutionEvents.SHELL_EXECUTION_PROGRESS;

    /** Agent executing the command */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Background task identifier */
    taskId: string;

    /** Latest output chunk */
    output: string;

    /** Total output size so far in bytes */
    fullOutputSize: number;

    /** Elapsed time in seconds */
    elapsedTimeSeconds: number;

    /** Total number of output lines so far */
    totalLines: number;

    /** Total number of output bytes so far */
    totalBytes: number;

    /** Progress timestamp */
    timestamp: number;
}

/**
 * Shell destructive command warning event payload
 */
export interface ShellDestructiveWarningPayload {
    /** Event type */
    eventType: typeof ShellExecutionEvents.SHELL_DESTRUCTIVE_WARNING;

    /** Agent executing the command */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Shell command that triggered the warning */
    command: string;

    /** List of warnings with severity */
    warnings: Array<{
        /** Warning message */
        warning: string;

        /** Severity level */
        severity: string;
    }>;

    /** Warning timestamp */
    timestamp: number;
}

/**
 * Shell background command started event payload
 */
export interface ShellBackgroundStartedPayload {
    /** Event type */
    eventType: typeof ShellExecutionEvents.SHELL_BACKGROUND_STARTED;

    /** Agent executing the command */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Background task identifier */
    taskId: string;

    /** Shell command being executed in background */
    command: string;

    /** Human-readable description of the command */
    description?: string;

    /** Execution timeout in milliseconds */
    timeout: number;

    /** Start timestamp */
    timestamp: number;
}

/**
 * Shell background command completed event payload
 */
export interface ShellBackgroundCompletedPayload {
    /** Event type */
    eventType: typeof ShellExecutionEvents.SHELL_BACKGROUND_COMPLETED;

    /** Agent executing the command */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Background task identifier */
    taskId: string;

    /** Shell command that was executed */
    command: string;

    /** Process exit code */
    exitCode: number;

    /** Whether the exit code indicates an error */
    isError: boolean;

    /** Execution time in milliseconds */
    executionTime: number;

    /** Output size in bytes */
    outputSize: number;

    /** ID of the persisted output, if output was persisted */
    persistedOutputId?: string;

    /** Completion timestamp */
    timestamp: number;
}

/**
 * Shell output persisted event payload
 */
export interface ShellOutputPersistedPayload {
    /** Event type */
    eventType: typeof ShellExecutionEvents.SHELL_OUTPUT_PERSISTED;

    /** Agent that executed the command */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Persisted output identifier */
    outputId: string;

    /** Total bytes of persisted output */
    totalBytes: number;

    /** Total lines of persisted output */
    totalLines: number;

    /** Shell command whose output was persisted */
    command: string;

    /** Persistence timestamp */
    timestamp: number;
}

/**
 * Union type of all shell execution event payloads
 */
export type ShellExecutionEventPayload =
    | ShellExecutionStartedPayload
    | ShellExecutionCompletedPayload
    | ShellExecutionFailedPayload
    | ShellExecutionProgressPayload
    | ShellDestructiveWarningPayload
    | ShellBackgroundStartedPayload
    | ShellBackgroundCompletedPayload
    | ShellOutputPersistedPayload;

/**
 * Shell execution event payload map for type-safe event handling
 */
export interface ShellExecutionPayloads {
    [ShellExecutionEvents.SHELL_EXECUTION_STARTED]: ShellExecutionStartedPayload;
    [ShellExecutionEvents.SHELL_EXECUTION_COMPLETED]: ShellExecutionCompletedPayload;
    [ShellExecutionEvents.SHELL_EXECUTION_FAILED]: ShellExecutionFailedPayload;
    [ShellExecutionEvents.SHELL_EXECUTION_PROGRESS]: ShellExecutionProgressPayload;
    [ShellExecutionEvents.SHELL_DESTRUCTIVE_WARNING]: ShellDestructiveWarningPayload;
    [ShellExecutionEvents.SHELL_BACKGROUND_STARTED]: ShellBackgroundStartedPayload;
    [ShellExecutionEvents.SHELL_BACKGROUND_COMPLETED]: ShellBackgroundCompletedPayload;
    [ShellExecutionEvents.SHELL_OUTPUT_PERSISTED]: ShellOutputPersistedPayload;
}

/** Export event type for use in other modules */
export type ShellExecutionEventType = keyof typeof ShellExecutionEvents;
