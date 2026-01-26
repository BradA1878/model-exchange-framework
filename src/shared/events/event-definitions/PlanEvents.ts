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
 * Plan Events
 *
 * Event definitions for the planning system events.
 * Includes plan creation, updates, step completion, and sharing.
 */

/**
 * Plan event names
 */
export const PlanEvents = {
    // Plan lifecycle events
    PLAN_CREATED: 'plan:created',
    PLAN_UPDATED: 'plan:updated',
    PLAN_DELETED: 'plan:deleted',

    // Plan step events
    PLAN_STEP_COMPLETED: 'plan:step_completed',
    PLAN_STEP_STARTED: 'plan:step_started',
    PLAN_STEP_BLOCKED: 'plan:step_blocked',

    // Plan collaboration events
    PLAN_SHARED: 'plan:shared',
} as const;

export type PlanEventName = typeof PlanEvents[keyof typeof PlanEvents];

/**
 * Plan created event data
 */
export interface PlanCreatedEventData {
    planId: string;
    title: string;
    createdBy: string;
    itemCount: number;
}

/**
 * Plan updated event data
 */
export interface PlanUpdatedEventData {
    planId: string;
    updatedBy: string;
    itemId?: string;
    changes?: Record<string, unknown>;
}

/**
 * Plan step completed event data
 */
export interface PlanStepCompletedEventData {
    planId: string;
    stepId: string;
    completedBy: string;
}

/**
 * Plan step started event data
 */
export interface PlanStepStartedEventData {
    planId: string;
    stepId: string;
    startedBy: string;
}

/**
 * Plan step blocked event data
 */
export interface PlanStepBlockedEventData {
    planId: string;
    stepId: string;
    blockedBy: string;
    reason?: string;
}

/**
 * Plan shared event data
 */
export interface PlanSharedEventData {
    planId: string;
    sharedBy: string;
    sharedWith: string[];
}

/**
 * Plan deleted event data
 */
export interface PlanDeletedEventData {
    planId: string;
    deletedBy: string;
}

/**
 * Plan event payloads mapping
 */
export interface PlanPayloads {
    'plan:created': PlanCreatedEventData;
    'plan:updated': PlanUpdatedEventData;
    'plan:deleted': PlanDeletedEventData;
    'plan:step_completed': PlanStepCompletedEventData;
    'plan:step_started': PlanStepStartedEventData;
    'plan:step_blocked': PlanStepBlockedEventData;
    'plan:shared': PlanSharedEventData;
}
