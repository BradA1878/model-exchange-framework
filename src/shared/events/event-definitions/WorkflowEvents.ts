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
 * Workflow Events
 *
 * Event definitions for the P8 Workflow Execution Engine feature.
 * Includes workflow registration, execution, state updates, and template management.
 */

/**
 * Workflow event names
 */
export const WorkflowEvents = {
    // Workflow registration events
    WORKFLOW_REGISTERED: 'workflow:registered',
    WORKFLOW_UNREGISTERED: 'workflow:unregistered',

    // Workflow execution events
    WORKFLOW_STARTED: 'workflow:started',
    WORKFLOW_COMPLETED: 'workflow:completed',
    WORKFLOW_FAILED: 'workflow:failed',
    WORKFLOW_CANCELLED: 'workflow:cancelled',

    // Workflow state events
    WORKFLOW_STATE_UPDATED: 'workflow:state_updated',
    WORKFLOW_STEP_STARTED: 'workflow:step_started',
    WORKFLOW_STEP_COMPLETED: 'workflow:step_completed',
    WORKFLOW_STEP_FAILED: 'workflow:step_failed',

    // Workflow template events
    WORKFLOW_TEMPLATE_REGISTERED: 'workflow:template_registered',
    WORKFLOW_TEMPLATE_UNREGISTERED: 'workflow:template_unregistered',

    // Workflow execution lifecycle
    WORKFLOW_EXECUTION_CREATED: 'workflow:execution_created',
    WORKFLOW_EXECUTION_COMPLETED: 'workflow:execution_completed',
} as const;

export type WorkflowEventName = typeof WorkflowEvents[keyof typeof WorkflowEvents];

/**
 * Workflow registered event data
 */
export interface WorkflowRegisteredEventData {
    workflowId: string;
    workflowName: string;
    version: string;
    stepCount: number;
    createdBy?: string;
}

/**
 * Workflow state updated event data
 */
export interface WorkflowStateUpdatedEventData {
    executionId: string;
    workflowId: string;
    status: string;
    completedSteps?: string[];
    failedSteps?: string[];
    currentStep?: string;
}

/**
 * Workflow execution completed event data
 */
export interface WorkflowExecutionCompletedEventData {
    executionId: string;
    workflowId: string;
    success: boolean;
    duration: number;
    completedSteps?: string[];
    failedSteps?: string[];
    output?: Record<string, unknown>;
    error?: string;
}

/**
 * Workflow template registered event data
 */
export interface WorkflowTemplateRegisteredEventData {
    templateId: string;
    templateName: string;
    category: string;
    description?: string;
    parameterCount?: number;
}

/**
 * Workflow step event data
 */
export interface WorkflowStepEventData {
    executionId: string;
    workflowId: string;
    stepId: string;
    stepName: string;
    status: 'started' | 'completed' | 'failed';
    output?: unknown;
    error?: string;
    duration?: number;
}

/**
 * Workflow event payloads mapping
 */
export interface WorkflowPayloads {
    'workflow:registered': WorkflowRegisteredEventData;
    'workflow:unregistered': { workflowId: string };
    'workflow:started': { executionId: string; workflowId: string; agentId: string };
    'workflow:completed': WorkflowExecutionCompletedEventData;
    'workflow:failed': { executionId: string; workflowId: string; error: string };
    'workflow:cancelled': { executionId: string; workflowId: string; reason?: string };
    'workflow:state_updated': WorkflowStateUpdatedEventData;
    'workflow:step_started': WorkflowStepEventData;
    'workflow:step_completed': WorkflowStepEventData;
    'workflow:step_failed': WorkflowStepEventData;
    'workflow:template_registered': WorkflowTemplateRegisteredEventData;
    'workflow:template_unregistered': { templateId: string };
    'workflow:execution_created': { executionId: string; workflowId: string; agentId: string };
    'workflow:execution_completed': WorkflowExecutionCompletedEventData;
}
