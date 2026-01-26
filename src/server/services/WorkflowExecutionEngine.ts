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
 */

/**
 * WorkflowExecutionEngine
 *
 * Server-side workflow execution and management service.
 * Coordinates workflow execution, state persistence, and monitoring.
 *
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

import { Logger } from '../../shared/utils/Logger';
import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import { createBaseEventPayload } from '../../shared/schemas/EventPayloadSchema';
import {
    WorkflowDefinition,
    WorkflowExecutionContext,
    WorkflowExecutionResult,
    WorkflowState,
    WorkflowStatus,
    WorkflowTemplate
} from '../../shared/types/WorkflowTypes';

// System agent ID for workflow engine operations
const WORKFLOW_ENGINE_AGENT_ID = 'system:workflow-engine';
// Default channel ID for system-level workflow events
const SYSTEM_CHANNEL_ID = 'system:workflows';

/**
 * Workflow execution record
 */
interface WorkflowExecutionRecord {
    /** Execution ID */
    executionId: string;
    /** Workflow ID */
    workflowId: string;
    /** Agent ID */
    agentId: string;
    /** Current state */
    state: WorkflowState;
    /** Start timestamp */
    startedAt: Date;
    /** End timestamp */
    completedAt?: Date;
    /** Result (if completed) */
    result?: WorkflowExecutionResult;
}

/**
 * WorkflowExecutionEngine - Server-side workflow orchestration
 *
 * Responsibilities:
 * - Workflow execution coordination
 * - State persistence and recovery
 * - Execution monitoring and analytics
 * - Workflow template management
 */
export class WorkflowExecutionEngine {
    private static instance: WorkflowExecutionEngine;
    private logger: Logger;

    // In-memory storage (replace with database in production)
    private workflows = new Map<string, WorkflowDefinition>();
    private executions = new Map<string, WorkflowExecutionRecord>();
    private templates = new Map<string, WorkflowTemplate>();

    private constructor() {
        this.logger = new Logger('WorkflowExecutionEngine');

        this.setupEventHandlers();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): WorkflowExecutionEngine {
        if (!WorkflowExecutionEngine.instance) {
            WorkflowExecutionEngine.instance = new WorkflowExecutionEngine();
        }
        return WorkflowExecutionEngine.instance;
    }

    /**
     * Register a workflow definition
     */
    public registerWorkflow(workflow: WorkflowDefinition): void {
        this.logger.info('Registering workflow', {
            workflowId: workflow.id,
            workflowName: workflow.name,
            stepCount: workflow.steps.length
        });

        this.workflows.set(workflow.id, workflow);

        EventBus.server.emit(
            Events.Workflow.WORKFLOW_REGISTERED,
            createBaseEventPayload(
                Events.Workflow.WORKFLOW_REGISTERED,
                workflow.createdBy || WORKFLOW_ENGINE_AGENT_ID,
                SYSTEM_CHANNEL_ID,
                {
                    workflowId: workflow.id,
                    workflowName: workflow.name,
                    version: workflow.version,
                    stepCount: workflow.steps.length,
                    createdBy: workflow.createdBy
                }
            )
        );
    }

    /**
     * Get workflow by ID
     */
    public getWorkflow(workflowId: string): WorkflowDefinition | undefined {
        return this.workflows.get(workflowId);
    }

    /**
     * List all registered workflows
     */
    public listWorkflows(): WorkflowDefinition[] {
        return Array.from(this.workflows.values());
    }

    /**
     * Create workflow execution context
     */
    public createExecutionContext(
        workflowId: string,
        agentId: string,
        channelId?: string
    ): WorkflowExecutionContext | null {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            this.logger.error('Workflow not found', { workflowId });
            return null;
        }

        const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const context: WorkflowExecutionContext = {
            workflowId,
            executionId,
            agentId,
            channelId,
            state: workflow.initialState || {
                completedSteps: [],
                failedSteps: [],
                stepOutputs: new Map(),
                variables: {},
                status: 'pending'
            },
            config: {}
        };

        // Store execution record
        const record: WorkflowExecutionRecord = {
            executionId,
            workflowId,
            agentId,
            state: context.state,
            startedAt: new Date()
        };

        this.executions.set(executionId, record);

        this.logger.info('Created workflow execution context', {
            executionId,
            workflowId,
            agentId
        });

        return context;
    }

    /**
     * Update execution state
     */
    public updateExecutionState(executionId: string, state: WorkflowState): void {
        const record = this.executions.get(executionId);
        if (!record) {
            this.logger.warn('Execution record not found', { executionId });
            return;
        }

        record.state = state;

        EventBus.server.emit(
            Events.Workflow.WORKFLOW_STATE_UPDATED,
            createBaseEventPayload(
                Events.Workflow.WORKFLOW_STATE_UPDATED,
                record.agentId,
                SYSTEM_CHANNEL_ID,
                {
                    executionId,
                    workflowId: record.workflowId,
                    status: state.status,
                    completedSteps: state.completedSteps,
                    failedSteps: state.failedSteps
                }
            )
        );
    }

    /**
     * Complete execution
     */
    public completeExecution(executionId: string, result: WorkflowExecutionResult): void {
        const record = this.executions.get(executionId);
        if (!record) {
            this.logger.warn('Execution record not found', { executionId });
            return;
        }

        record.completedAt = new Date();
        record.result = result;
        record.state = result.state;

        this.logger.info('Workflow execution completed', {
            executionId,
            workflowId: record.workflowId,
            success: result.success,
            duration: result.duration
        });

        EventBus.server.emit(
            Events.Workflow.WORKFLOW_EXECUTION_COMPLETED,
            createBaseEventPayload(
                Events.Workflow.WORKFLOW_EXECUTION_COMPLETED,
                record.agentId,
                SYSTEM_CHANNEL_ID,
                {
                    executionId,
                    workflowId: record.workflowId,
                    success: result.success,
                    duration: result.duration,
                    completedSteps: result.state.completedSteps,
                    failedSteps: result.state.failedSteps
                }
            )
        );
    }

    /**
     * Get execution record
     */
    public getExecution(executionId: string): WorkflowExecutionRecord | undefined {
        return this.executions.get(executionId);
    }

    /**
     * List executions for a workflow
     */
    public listExecutions(workflowId?: string): WorkflowExecutionRecord[] {
        const executions = Array.from(this.executions.values());

        if (workflowId) {
            return executions.filter(e => e.workflowId === workflowId);
        }

        return executions;
    }

    /**
     * Register a workflow template
     */
    public registerTemplate(template: WorkflowTemplate): void {
        this.logger.info('Registering workflow template', {
            templateId: template.id,
            templateName: template.name,
            category: template.category
        });

        this.templates.set(template.id, template);

        EventBus.server.emit(
            Events.Workflow.WORKFLOW_TEMPLATE_REGISTERED,
            createBaseEventPayload(
                Events.Workflow.WORKFLOW_TEMPLATE_REGISTERED,
                WORKFLOW_ENGINE_AGENT_ID,
                SYSTEM_CHANNEL_ID,
                {
                    templateId: template.id,
                    templateName: template.name,
                    category: template.category,
                    description: template.description,
                    parameterCount: template.parameters?.length
                }
            )
        );
    }

    /**
     * Get template by ID
     */
    public getTemplate(templateId: string): WorkflowTemplate | undefined {
        return this.templates.get(templateId);
    }

    /**
     * List templates
     */
    public listTemplates(category?: string): WorkflowTemplate[] {
        const templates = Array.from(this.templates.values());

        if (category) {
            return templates.filter(t => t.category === category);
        }

        return templates;
    }

    /**
     * Create workflow from template
     */
    public createWorkflowFromTemplate(
        templateId: string,
        parameters: Record<string, unknown>,
        createdBy: string
    ): WorkflowDefinition | null {
        const template = this.templates.get(templateId);
        if (!template) {
            this.logger.error('Template not found', { templateId });
            return null;
        }

        // Validate parameters
        if (template.parameters) {
            for (const param of template.parameters) {
                if (param.required && !(param.name in parameters)) {
                    this.logger.error('Missing required parameter', {
                        templateId,
                        parameter: param.name
                    });
                    return null;
                }
            }
        }

        // Create workflow definition
        const workflowId = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date();

        const workflow: WorkflowDefinition = {
            ...template.workflow,
            id: workflowId,
            createdAt: now,
            updatedAt: now,
            createdBy,
            metadata: {
                ...template.workflow.metadata,
                templateId,
                parameters
            }
        };

        this.registerWorkflow(workflow);

        return workflow;
    }

    /**
     * Get workflow execution analytics
     */
    public getAnalytics(workflowId: string): {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        averageDuration: number;
        successRate: number;
    } {
        const executions = this.listExecutions(workflowId);
        const completed = executions.filter(e => e.completedAt);

        const successful = completed.filter(e => e.result?.success);
        const failed = completed.filter(e => !e.result?.success);

        const durations = completed
            .filter(e => e.result?.duration)
            .map(e => e.result!.duration);

        const averageDuration = durations.length > 0
            ? durations.reduce((sum, d) => sum + d, 0) / durations.length
            : 0;

        const successRate = completed.length > 0
            ? (successful.length / completed.length) * 100
            : 0;

        return {
            totalExecutions: executions.length,
            successfulExecutions: successful.length,
            failedExecutions: failed.length,
            averageDuration,
            successRate
        };
    }

    /**
     * Setup event handlers
     */
    private setupEventHandlers(): void {
        // Listen for workflow events from agents
        EventBus.server.on(Events.Workflow.WORKFLOW_STARTED, (data: any) => {
            this.logger.debug('Workflow started', data);
        });

        EventBus.server.on(Events.Workflow.WORKFLOW_COMPLETED, (data: any) => {
            this.logger.debug('Workflow completed', data);
        });

        EventBus.server.on(Events.Workflow.WORKFLOW_FAILED, (data: any) => {
            this.logger.warn('Workflow failed', data);
        });
    }

    /**
     * Cleanup old execution records
     */
    public cleanupOldExecutions(maxAgeMs: number): number {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [executionId, record] of this.executions.entries()) {
            if (record.completedAt) {
                const age = now - record.completedAt.getTime();
                if (age > maxAgeMs) {
                    this.executions.delete(executionId);
                    cleanedCount++;
                }
            }
        }

        if (cleanedCount > 0) {
            this.logger.info('Cleaned up old executions', {
                count: cleanedCount,
                maxAgeMs
            });
        }

        return cleanedCount;
    }
}
