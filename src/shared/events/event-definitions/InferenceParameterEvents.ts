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
 * Inference Parameter Events
 *
 * Event definitions for the P1 Dynamic Inference Parameters feature.
 * Includes parameter request, response, and usage tracking events.
 */

import { OrparPhase } from '../../types/InferenceParameterTypes';

/**
 * Inference parameter event names
 */
export const InferenceParameterEvents = {
    // Parameter request events
    PARAMETER_REQUESTED: 'inference:parameter_requested',
    PARAMETER_APPROVED: 'inference:parameter_approved',
    PARAMETER_MODIFIED: 'inference:parameter_modified',
    PARAMETER_DENIED: 'inference:parameter_denied',

    // Parameter reset event
    PARAMETER_RESET: 'inference:parameter_reset',

    // Usage tracking events
    PARAMETER_USAGE_RECORDED: 'inference:usage_recorded',

    // Override lifecycle events
    OVERRIDE_CREATED: 'inference:override_created',
    OVERRIDE_CONSUMED: 'inference:override_consumed',
    OVERRIDE_EXPIRED: 'inference:override_expired',
} as const;

export type InferenceParameterEventName = typeof InferenceParameterEvents[keyof typeof InferenceParameterEvents];

/**
 * Parameter requested event data
 */
export interface ParameterRequestedEventData {
    phase: OrparPhase;
    status: 'approved' | 'modified' | 'denied';
    costDelta: number;
    reason?: string;
}

/**
 * Parameter usage recorded event data
 */
export interface ParameterUsageRecordedEventData {
    phase: OrparPhase;
    model: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    latencyMs: number;
    actualCost: number;
    success: boolean;
}

/**
 * Override created event data
 */
export interface OverrideCreatedEventData {
    overrideId: string;
    phase: OrparPhase;
    scope: 'next_call' | 'session' | 'task' | 'current_phase';
    expiresAt?: number;
}

/**
 * Parameter reset event data
 */
export interface ParameterResetEventData {
    scope: 'all' | 'session' | 'task';
    resetCount: number;
    taskId?: string;
}

/**
 * Inference parameter event payloads mapping
 */
export interface InferenceParameterPayloads {
    'inference:parameter_requested': ParameterRequestedEventData;
    'inference:parameter_approved': ParameterRequestedEventData;
    'inference:parameter_modified': ParameterRequestedEventData;
    'inference:parameter_denied': ParameterRequestedEventData;
    'inference:parameter_reset': ParameterResetEventData;
    'inference:usage_recorded': ParameterUsageRecordedEventData;
    'inference:override_created': OverrideCreatedEventData;
    'inference:override_consumed': { overrideId: string };
    'inference:override_expired': { overrideId: string };
}
