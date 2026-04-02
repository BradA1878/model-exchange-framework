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
 * ShellExecutionEventPayloads.ts
 *
 * Helper functions for creating properly structured shell execution event payloads.
 * All shell execution events must use these helpers to ensure compliance with
 * the BaseEventPayload structure.
 */

import { v4 as uuidv4 } from 'uuid';
import { AgentId, ChannelId } from '../types/ChannelContext';
import { BaseEventPayload } from './EventPayloadSchema';
import { ShellExecutionEvents } from '../events/event-definitions/ShellExecutionEvents';

/**
 * Creates a SHELL_EXECUTION_STARTED event payload
 */
export function createShellExecutionStartedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        command: string;
        description?: string;
        commandHash: string;
        timeout: number;
        classification: {
            category: string;
            isReadOnly: boolean;
        };
        warnings: string[];
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: ShellExecutionEvents.SHELL_EXECUTION_STARTED,
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'ShellExecute',
        data: {
            ...data,
            eventType: ShellExecutionEvents.SHELL_EXECUTION_STARTED
        }
    };
}

/**
 * Creates a SHELL_EXECUTION_COMPLETED event payload
 */
export function createShellExecutionCompletedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        command: string;
        exitCode: number;
        exitCodeMeaning?: string;
        isError: boolean;
        executionTime: number;
        outputSize: number;
        outputTruncated: boolean;
        persistedOutputId?: string;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: ShellExecutionEvents.SHELL_EXECUTION_COMPLETED,
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'ShellExecute',
        data: {
            ...data,
            eventType: ShellExecutionEvents.SHELL_EXECUTION_COMPLETED
        }
    };
}

/**
 * Creates a SHELL_EXECUTION_FAILED event payload
 */
export function createShellExecutionFailedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        command: string;
        error: string;
        exitCode: number;
        executionTime: number;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: ShellExecutionEvents.SHELL_EXECUTION_FAILED,
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'ShellExecute',
        data: {
            ...data,
            eventType: ShellExecutionEvents.SHELL_EXECUTION_FAILED
        }
    };
}

/**
 * Creates a SHELL_EXECUTION_PROGRESS event payload
 */
export function createShellExecutionProgressPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        taskId: string;
        output: string;
        fullOutputSize: number;
        elapsedTimeSeconds: number;
        totalLines: number;
        totalBytes: number;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: ShellExecutionEvents.SHELL_EXECUTION_PROGRESS,
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'ShellExecute',
        data: {
            ...data,
            eventType: ShellExecutionEvents.SHELL_EXECUTION_PROGRESS
        }
    };
}

/**
 * Creates a SHELL_DESTRUCTIVE_WARNING event payload
 */
export function createShellDestructiveWarningPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        command: string;
        warnings: Array<{
            warning: string;
            severity: string;
        }>;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: ShellExecutionEvents.SHELL_DESTRUCTIVE_WARNING,
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'ShellExecute',
        data: {
            ...data,
            eventType: ShellExecutionEvents.SHELL_DESTRUCTIVE_WARNING
        }
    };
}

/**
 * Creates a SHELL_BACKGROUND_STARTED event payload
 */
export function createShellBackgroundStartedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        taskId: string;
        command: string;
        description?: string;
        timeout: number;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: ShellExecutionEvents.SHELL_BACKGROUND_STARTED,
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'ShellExecute',
        data: {
            ...data,
            eventType: ShellExecutionEvents.SHELL_BACKGROUND_STARTED
        }
    };
}

/**
 * Creates a SHELL_BACKGROUND_COMPLETED event payload
 */
export function createShellBackgroundCompletedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        taskId: string;
        command: string;
        exitCode: number;
        isError: boolean;
        executionTime: number;
        outputSize: number;
        persistedOutputId?: string;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: ShellExecutionEvents.SHELL_BACKGROUND_COMPLETED,
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'ShellExecute',
        data: {
            ...data,
            eventType: ShellExecutionEvents.SHELL_BACKGROUND_COMPLETED
        }
    };
}

/**
 * Creates a SHELL_OUTPUT_PERSISTED event payload
 */
export function createShellOutputPersistedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        outputId: string;
        totalBytes: number;
        totalLines: number;
        command: string;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: ShellExecutionEvents.SHELL_OUTPUT_PERSISTED,
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'ShellExecute',
        data: {
            ...data,
            eventType: ShellExecutionEvents.SHELL_OUTPUT_PERSISTED
        }
    };
}
