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
 * CodeExecutionEvents.ts
 *
 * Event definitions for code execution operations in the sandbox.
 * These events track code execution lifecycle, performance, and security.
 */

import { AgentId, ChannelId } from '../../types/ChannelContext';

/**
 * Code execution event constants
 */
export const CodeExecutionEvents = {
    /** Code execution started */
    CODE_EXECUTION_STARTED: 'code:execution:started',

    /** Code execution completed successfully */
    CODE_EXECUTION_COMPLETED: 'code:execution:completed',

    /** Code execution failed */
    CODE_EXECUTION_FAILED: 'code:execution:failed',

    /** Code validation started */
    CODE_VALIDATION_STARTED: 'code:validation:started',

    /** Code validation completed */
    CODE_VALIDATION_COMPLETED: 'code:validation:completed',

    /** Security issue detected in code */
    CODE_SECURITY_ISSUE: 'code:security:issue',

    /** Resource limit exceeded during execution */
    CODE_RESOURCE_LIMIT_EXCEEDED: 'code:resource:limit:exceeded',

    /** Code execution timeout */
    CODE_EXECUTION_TIMEOUT: 'code:execution:timeout'
} as const;

/**
 * Execution language enum
 */
export type ExecutionLanguage = 'javascript' | 'typescript';

/**
 * Code execution started event payload
 */
export interface CodeExecutionStartedPayload {
    /** Event type */
    eventType: typeof CodeExecutionEvents.CODE_EXECUTION_STARTED;

    /** Agent executing the code */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Execution language */
    language: ExecutionLanguage;

    /** Code hash for tracking */
    codeHash: string;

    /** Code length in characters */
    codeLength: number;

    /** Execution timeout setting */
    timeout: number;

    /** Start timestamp */
    timestamp: number;
}

/**
 * Code execution completed event payload
 */
export interface CodeExecutionCompletedPayload {
    /** Event type */
    eventType: typeof CodeExecutionEvents.CODE_EXECUTION_COMPLETED;

    /** Agent executing the code */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Execution language */
    language: ExecutionLanguage;

    /** Code hash for tracking */
    codeHash: string;

    /** Execution time in milliseconds */
    executionTime: number;

    /** Output size in characters */
    outputSize: number;

    /** Number of console logs captured */
    logCount: number;

    /** Resource usage */
    resourceUsage: {
        /** Memory used in MB */
        memory: number;

        /** Whether timeout occurred */
        timeout: boolean;
    };

    /** Completion timestamp */
    timestamp: number;
}

/**
 * Code execution failed event payload
 */
export interface CodeExecutionFailedPayload {
    /** Event type */
    eventType: typeof CodeExecutionEvents.CODE_EXECUTION_FAILED;

    /** Agent executing the code */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Execution language */
    language: ExecutionLanguage;

    /** Code hash for tracking */
    codeHash: string;

    /** Error message */
    error: string;

    /** Error type */
    errorType: 'timeout' | 'validation' | 'runtime' | 'security' | 'resource_limit';

    /** Execution time before failure */
    executionTime: number;

    /** Failure timestamp */
    timestamp: number;
}

/**
 * Code validation started event payload
 */
export interface CodeValidationStartedPayload {
    /** Event type */
    eventType: typeof CodeExecutionEvents.CODE_VALIDATION_STARTED;

    /** Agent executing the code */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Code hash for tracking */
    codeHash: string;

    /** Start timestamp */
    timestamp: number;
}

/**
 * Code validation completed event payload
 */
export interface CodeValidationCompletedPayload {
    /** Event type */
    eventType: typeof CodeExecutionEvents.CODE_VALIDATION_COMPLETED;

    /** Agent executing the code */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Code hash for tracking */
    codeHash: string;

    /** Whether validation passed */
    safe: boolean;

    /** Number of errors found */
    errorCount: number;

    /** Number of warnings found */
    warningCount: number;

    /** Validation time in milliseconds */
    validationTime: number;

    /** Completion timestamp */
    timestamp: number;
}

/**
 * Security issue detected event payload
 */
export interface CodeSecurityIssuePayload {
    /** Event type */
    eventType: typeof CodeExecutionEvents.CODE_SECURITY_ISSUE;

    /** Agent executing the code */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Code hash for tracking */
    codeHash: string;

    /** Security issue type */
    issueType: 'dangerous_pattern' | 'unauthorized_access' | 'malicious_code';

    /** Issue description */
    description: string;

    /** Severity level */
    severity: 'low' | 'medium' | 'high' | 'critical';

    /** Detected pattern (if applicable) */
    pattern?: string;

    /** Detection timestamp */
    timestamp: number;
}

/**
 * Resource limit exceeded event payload
 */
export interface CodeResourceLimitExceededPayload {
    /** Event type */
    eventType: typeof CodeExecutionEvents.CODE_RESOURCE_LIMIT_EXCEEDED;

    /** Agent executing the code */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Code hash for tracking */
    codeHash: string;

    /** Resource that exceeded limit */
    resource: 'memory' | 'cpu' | 'time';

    /** Limit value */
    limit: number;

    /** Actual value reached */
    actual: number;

    /** Execution time before limit exceeded */
    executionTime: number;

    /** Event timestamp */
    timestamp: number;
}

/**
 * Code execution timeout event payload
 */
export interface CodeExecutionTimeoutPayload {
    /** Event type */
    eventType: typeof CodeExecutionEvents.CODE_EXECUTION_TIMEOUT;

    /** Agent executing the code */
    agentId: AgentId;

    /** Channel context */
    channelId: ChannelId;

    /** Unique request identifier */
    requestId: string;

    /** Code hash for tracking */
    codeHash: string;

    /** Timeout setting in milliseconds */
    timeout: number;

    /** Actual time before timeout */
    actualTime: number;

    /** Event timestamp */
    timestamp: number;
}

/**
 * Union type of all code execution event payloads
 */
export type CodeExecutionEventPayload =
    | CodeExecutionStartedPayload
    | CodeExecutionCompletedPayload
    | CodeExecutionFailedPayload
    | CodeValidationStartedPayload
    | CodeValidationCompletedPayload
    | CodeSecurityIssuePayload
    | CodeResourceLimitExceededPayload
    | CodeExecutionTimeoutPayload;

/**
 * Code execution event payload map for type-safe event handling
 */
export interface CodeExecutionPayloads {
    [CodeExecutionEvents.CODE_EXECUTION_STARTED]: CodeExecutionStartedPayload;
    [CodeExecutionEvents.CODE_EXECUTION_COMPLETED]: CodeExecutionCompletedPayload;
    [CodeExecutionEvents.CODE_EXECUTION_FAILED]: CodeExecutionFailedPayload;
    [CodeExecutionEvents.CODE_VALIDATION_STARTED]: CodeValidationStartedPayload;
    [CodeExecutionEvents.CODE_VALIDATION_COMPLETED]: CodeValidationCompletedPayload;
    [CodeExecutionEvents.CODE_SECURITY_ISSUE]: CodeSecurityIssuePayload;
    [CodeExecutionEvents.CODE_RESOURCE_LIMIT_EXCEEDED]: CodeResourceLimitExceededPayload;
    [CodeExecutionEvents.CODE_EXECUTION_TIMEOUT]: CodeExecutionTimeoutPayload;
}

// Export event type for use in other modules
export type CodeExecutionEventType = keyof typeof CodeExecutionEvents;
