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
 * CodeExecutionEventPayloads.ts
 *
 * Helper functions for creating properly structured code execution event payloads.
 * All code execution events must use these helpers to ensure compliance with
 * the BaseEventPayload structure.
 */

import { v4 as uuidv4 } from 'uuid';
import { AgentId, ChannelId } from '../types/ChannelContext';
import { BaseEventPayload } from './EventPayloadSchema';
import {
    CodeExecutionStartedPayload,
    CodeExecutionCompletedPayload,
    CodeExecutionFailedPayload,
    CodeValidationStartedPayload,
    CodeValidationCompletedPayload,
    CodeSecurityIssuePayload,
    CodeResourceLimitExceededPayload,
    CodeExecutionTimeoutPayload,
    ExecutionLanguage
} from '../events/event-definitions/CodeExecutionEvents';

/**
 * Creates a CODE_EXECUTION_STARTED event payload
 */
export function createCodeExecutionStartedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        language: ExecutionLanguage;
        codeHash: string;
        codeLength: number;
        timeout: number;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: 'code:execution:started',
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'CodeExecutionSandbox',
        data: {
            ...data,
            eventType: 'code:execution:started'
        }
    };
}

/**
 * Creates a CODE_EXECUTION_COMPLETED event payload
 */
export function createCodeExecutionCompletedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        language: ExecutionLanguage;
        codeHash: string;
        executionTime: number;
        outputSize: number;
        logCount: number;
        resourceUsage: {
            memory: number;
            timeout: boolean;
        };
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: 'code:execution:completed',
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'CodeExecutionSandbox',
        data: {
            ...data,
            eventType: 'code:execution:completed'
        }
    };
}

/**
 * Creates a CODE_EXECUTION_FAILED event payload
 */
export function createCodeExecutionFailedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        language: ExecutionLanguage;
        codeHash: string;
        error: string;
        errorType: 'timeout' | 'validation' | 'runtime' | 'security' | 'resource_limit';
        executionTime: number;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: 'code:execution:failed',
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'CodeExecutionSandbox',
        data: {
            ...data,
            eventType: 'code:execution:failed'
        }
    };
}

/**
 * Creates a CODE_VALIDATION_STARTED event payload
 */
export function createCodeValidationStartedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        codeHash: string;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: 'code:validation:started',
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'CodeExecutionSandbox',
        data: {
            ...data,
            eventType: 'code:validation:started'
        }
    };
}

/**
 * Creates a CODE_VALIDATION_COMPLETED event payload
 */
export function createCodeValidationCompletedPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        codeHash: string;
        safe: boolean;
        errorCount: number;
        warningCount: number;
        validationTime: number;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: 'code:validation:completed',
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'CodeExecutionSandbox',
        data: {
            ...data,
            eventType: 'code:validation:completed'
        }
    };
}

/**
 * Creates a CODE_SECURITY_ISSUE event payload
 */
export function createCodeSecurityIssuePayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        codeHash: string;
        issueType: 'dangerous_pattern' | 'unauthorized_access' | 'malicious_code';
        description: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        pattern?: string;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: 'code:security:issue',
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'CodeExecutionSandbox',
        data: {
            ...data,
            eventType: 'code:security:issue'
        }
    };
}

/**
 * Creates a CODE_RESOURCE_LIMIT_EXCEEDED event payload
 */
export function createCodeResourceLimitExceededPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        codeHash: string;
        resource: 'memory' | 'cpu' | 'time';
        limit: number;
        actual: number;
        executionTime: number;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: 'code:resource:limit:exceeded',
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'CodeExecutionSandbox',
        data: {
            ...data,
            eventType: 'code:resource:limit:exceeded'
        }
    };
}

/**
 * Creates a CODE_EXECUTION_TIMEOUT event payload
 */
export function createCodeExecutionTimeoutPayload(
    agentId: AgentId,
    channelId: ChannelId,
    data: {
        requestId: string;
        codeHash: string;
        timeout: number;
        actualTime: number;
    }
): BaseEventPayload<any> {
    return {
        eventId: uuidv4(),
        eventType: 'code:execution:timeout',
        timestamp: Date.now(),
        agentId,
        channelId,
        source: 'CodeExecutionSandbox',
        data: {
            ...data,
            eventType: 'code:execution:timeout'
        }
    };
}
