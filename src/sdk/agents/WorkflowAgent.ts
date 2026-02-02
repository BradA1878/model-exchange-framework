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
 * WorkflowAgent Base Class
 *
 * Extends MxfAgent with workflow execution capabilities.
 * Provides structured step-by-step execution patterns.
 *
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

import { MxfAgent } from '../MxfAgent';
import { AgentConfig } from '../../shared/interfaces/AgentInterfaces';
import { Logger } from '../../shared/utils/Logger';
import {
    WorkflowStep,
    WorkflowState,
    WorkflowDefinition,
    WorkflowExecutionContext,
    WorkflowExecutionConfig,
    WorkflowExecutionResult,
    WorkflowError,
    WorkflowStatus,
    WorkflowStepType
} from '../../shared/types/WorkflowTypes';
import { EventBus } from '../../shared/events/EventBus';

/**
 * Configuration for WorkflowAgent
 */
export interface WorkflowAgentConfig extends AgentConfig {
    /** Workflow definition */
    workflow: WorkflowDefinition;
    /** Execution configuration */
    executionConfig?: WorkflowExecutionConfig;
}

/**
 * Step execution result
 */
export interface StepExecutionResult {
    /** Step ID */
    stepId: string;
    /** Success flag */
    success: boolean;
    /** Output data */
    output?: unknown;
    /** Error (if failed) */
    error?: WorkflowError;
    /** Execution duration in milliseconds */
    duration: number;
}

/**
 * WorkflowAgent - Base class for workflow-based agents
 *
 * Provides infrastructure for executing structured workflows with:
 * - Step validation and error handling
 * - State management
 * - Event emission for monitoring
 * - Retry logic
 * - Timeout handling
 */
export abstract class WorkflowAgent extends MxfAgent {
    protected workflowLogger: Logger;
    protected workflow: WorkflowDefinition;
    protected workflowState: WorkflowState;
    protected executionContext?: WorkflowExecutionContext;
    protected executionConfig: WorkflowExecutionConfig;

    constructor(config: WorkflowAgentConfig) {
        super(config);

        this.workflowLogger = new Logger('WorkflowAgent');

        this.workflow = config.workflow;
        this.executionConfig = config.executionConfig || {};

        // Initialize workflow state
        this.workflowState = config.workflow.initialState || {
            completedSteps: [],
            failedSteps: [],
            stepOutputs: new Map(),
            variables: {},
            status: 'pending'
        };
    }

    /**
     * Execute the workflow
     * Must be implemented by subclasses to define execution strategy
     */
    protected abstract executeWorkflow(): Promise<WorkflowExecutionResult>;

    /**
     * Start workflow execution
     */
    public async startWorkflow(): Promise<WorkflowExecutionResult> {
        this.workflowLogger.info('Starting workflow execution', {
            workflowId: this.workflow.id,
            workflowName: this.workflow.name
        });

        const startTime = Date.now();
        this.workflowState.status = 'running';
        this.workflowState.startedAt = new Date();

        this.emitWorkflowEvent('workflow-started', {
            workflowId: this.workflow.id,
            agentId: this.getAgentId()
        });

        try {
            const result = await this.executeWorkflow();

            this.workflowState.status = result.success ? 'completed' : 'failed';
            this.workflowState.completedAt = new Date();

            this.emitWorkflowEvent('workflow-completed', {
                workflowId: this.workflow.id,
                agentId: this.getAgentId(),
                success: result.success,
                duration: result.duration
            });

            return result;
        } catch (error: any) {
            const workflowError: WorkflowError = {
                message: error.message,
                code: error.code,
                stack: error.stack,
                data: error
            };

            this.workflowState.status = 'failed';
            this.workflowState.error = workflowError;
            this.workflowState.completedAt = new Date();

            this.emitWorkflowEvent('workflow-failed', {
                workflowId: this.workflow.id,
                agentId: this.getAgentId(),
                error: workflowError
            });

            return {
                executionId: this.executionContext?.executionId || 'unknown',
                workflowId: this.workflow.id,
                state: this.workflowState,
                duration: Date.now() - startTime,
                success: false,
                error: workflowError
            };
        }
    }

    /**
     * Execute a single workflow step
     */
    protected async executeStep(step: WorkflowStep): Promise<StepExecutionResult> {
        this.workflowLogger.info('Executing step', {
            stepId: step.id,
            stepName: step.name,
            stepType: step.type
        });

        const startTime = Date.now();

        this.emitWorkflowEvent('step-started', {
            workflowId: this.workflow.id,
            stepId: step.id,
            stepName: step.name
        });

        // Check condition if present
        if (step.condition && !(await this.evaluateCondition(step.condition))) {
            this.workflowLogger.info('Step condition not met, skipping', {
                stepId: step.id
            });

            return {
                stepId: step.id,
                success: true,
                duration: Date.now() - startTime
            };
        }

        // Execute with retry logic
        let lastError: WorkflowError | undefined;
        const maxAttempts = step.retryPolicy?.maxAttempts || 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Set timeout if specified
                const timeout = step.timeout || this.executionConfig.defaultTimeout;
                const output = timeout
                    ? await this.executeStepWithTimeout(step, timeout)
                    : await this.executeStepLogic(step);

                // Store output
                this.workflowState.stepOutputs.set(step.id, output);
                this.workflowState.completedSteps.push(step.id);

                const duration = Date.now() - startTime;

                this.emitWorkflowEvent('step-completed', {
                    workflowId: this.workflow.id,
                    stepId: step.id,
                    duration,
                    attempt
                });

                // Call callback if provided
                this.executionConfig.onStepComplete?.(step.id, output);

                return {
                    stepId: step.id,
                    success: true,
                    output,
                    duration
                };
            } catch (error: any) {
                lastError = {
                    message: error.message,
                    code: error.code,
                    stepId: step.id,
                    stack: error.stack,
                    data: error
                };

                this.workflowLogger.warn('Step execution failed', {
                    stepId: step.id,
                    attempt,
                    maxAttempts,
                    error: error.message
                });

                // Check if we should retry
                if (attempt < maxAttempts) {
                    const delay = this.calculateRetryDelay(step, attempt);
                    this.workflowLogger.info('Retrying step', {
                        stepId: step.id,
                        attempt: attempt + 1,
                        delayMs: delay
                    });
                    await this.sleep(delay);
                } else {
                    // Max attempts reached
                    this.workflowState.failedSteps.push(step.id);

                    this.emitWorkflowEvent('step-failed', {
                        workflowId: this.workflow.id,
                        stepId: step.id,
                        error: lastError,
                        attempts: maxAttempts
                    });
                }
            }
        }

        // All attempts failed
        return {
            stepId: step.id,
            success: false,
            error: lastError,
            duration: Date.now() - startTime
        };
    }

    /**
     * Execute step logic based on step type
     */
    protected async executeStepLogic(step: WorkflowStep): Promise<unknown> {
        switch (step.type) {
            case 'tool_execution':
                return await this.executeToolStep(step);
            case 'llm_call':
                return await this.executeLlmStep(step);
            case 'decision':
                return await this.executeDecisionStep(step);
            case 'validation':
                return await this.executeValidationStep(step);
            case 'wait':
                return await this.executeWaitStep(step);
            case 'custom':
                return await this.executeCustomStep(step);
            default:
                throw new Error(`Unsupported step type: ${step.type}`);
        }
    }

    /**
     * Execute tool step
     */
    protected async executeToolStep(step: WorkflowStep): Promise<unknown> {
        const toolName = step.config.tool;
        if (!toolName) {
            throw new Error(`Tool name not specified for step ${step.id}`);
        }

        const parameters = step.config.parameters || {};

        // Use MxfAgent's tool execution capabilities
        // This will be handled by subclasses that have access to tool execution
        throw new Error('Tool execution must be implemented by subclass');
    }

    /**
     * Execute LLM step
     */
    protected async executeLlmStep(step: WorkflowStep): Promise<unknown> {
        const prompt = step.config.prompt;
        if (!prompt) {
            throw new Error(`Prompt not specified for LLM step ${step.id}`);
        }

        // Use MxfAgent's LLM capabilities
        throw new Error('LLM execution must be implemented by subclass');
    }

    /**
     * Execute decision step
     */
    protected async executeDecisionStep(step: WorkflowStep): Promise<unknown> {
        const branches = step.config.branches;
        if (!branches || branches.length === 0) {
            throw new Error(`No branches specified for decision step ${step.id}`);
        }

        for (const branch of branches) {
            if (await this.evaluateCondition(branch.condition)) {
                return {
                    selectedBranch: branch,
                    condition: branch.condition
                };
            }
        }

        return {
            selectedBranch: null,
            condition: null
        };
    }

    /**
     * Execute validation step
     */
    protected async executeValidationStep(step: WorkflowStep): Promise<unknown> {
        // Validate current workflow state
        const isValid = this.validateWorkflowState();

        if (!isValid) {
            throw new Error(`Workflow state validation failed at step ${step.id}`);
        }

        return { valid: true };
    }

    /**
     * Execute wait step
     */
    protected async executeWaitStep(step: WorkflowStep): Promise<unknown> {
        const waitConfig = step.config.wait;
        if (!waitConfig) {
            throw new Error(`Wait configuration not specified for step ${step.id}`);
        }

        switch (waitConfig.type) {
            case 'duration':
                if (waitConfig.duration) {
                    await this.sleep(waitConfig.duration);
                }
                break;
            case 'event':
                if (waitConfig.event) {
                    await this.waitForEvent(waitConfig.event, waitConfig.timeout);
                }
                break;
            case 'condition':
                if (waitConfig.condition) {
                    await this.waitForCondition(waitConfig.condition, waitConfig.timeout);
                }
                break;
        }

        return { waited: true };
    }

    /**
     * Execute custom step
     */
    protected async executeCustomStep(step: WorkflowStep): Promise<unknown> {
        const handler = step.config.handler;
        if (!handler) {
            throw new Error(`Handler not specified for custom step ${step.id}`);
        }

        throw new Error('Custom step handlers must be implemented by subclass');
    }

    /**
     * Execute step with timeout
     */
    protected async executeStepWithTimeout(step: WorkflowStep, timeout: number): Promise<unknown> {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Step ${step.id} timed out after ${timeout}ms`));
            }, timeout);

            try {
                const result = await this.executeStepLogic(step);
                clearTimeout(timer);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    /**
     * Evaluate workflow condition
     */
    protected async evaluateCondition(condition: any): Promise<boolean> {
        // Basic condition evaluation
        // Subclasses can override for more complex logic
        return true;
    }

    /**
     * Validate workflow state
     */
    protected validateWorkflowState(): boolean {
        // Basic validation
        // Subclasses can override for custom validation
        return true;
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    protected calculateRetryDelay(step: WorkflowStep, attempt: number): number {
        if (!step.retryPolicy) {
            return 0;
        }

        const { initialDelay, backoffMultiplier, maxDelay } = step.retryPolicy;
        const delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
        return Math.min(delay, maxDelay);
    }

    /**
     * Wait for event
     */
    protected async waitForEvent(eventName: string, timeout?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = timeout ? setTimeout(() => {
                reject(new Error(`Timeout waiting for event: ${eventName}`));
            }, timeout) : null;

            const subscription = EventBus.client.on(eventName, () => {
                if (timer) clearTimeout(timer);
                subscription.unsubscribe();
                resolve();
            });
        });
    }

    /**
     * Wait for condition to be true
     */
    protected async waitForCondition(condition: any, timeout?: number): Promise<void> {
        const startTime = Date.now();
        const checkInterval = 1000; // Check every second

        while (true) {
            if (await this.evaluateCondition(condition)) {
                return;
            }

            if (timeout && Date.now() - startTime > timeout) {
                throw new Error('Timeout waiting for condition');
            }

            await this.sleep(checkInterval);
        }
    }

    /**
     * Sleep utility
     */
    protected sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Emit workflow event
     */
    protected emitWorkflowEvent(eventName: string, data: any): void {
        EventBus.client.emitOn(this.agentId, eventName, {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get agent ID helper
     */
    protected getAgentId(): string {
        // Access the agentId from config which is available via parent constructor
        return (this as any).agentId || 'unknown';
    }

    /**
     * Pause workflow execution
     */
    public pauseWorkflow(): void {
        this.workflowState.status = 'paused';
        this.emitWorkflowEvent('workflow-paused', {
            workflowId: this.workflow.id,
            agentId: this.getAgentId()
        });
    }

    /**
     * Resume workflow execution
     */
    public resumeWorkflow(): void {
        if (this.workflowState.status === 'paused') {
            this.workflowState.status = 'running';
            this.emitWorkflowEvent('workflow-resumed', {
                workflowId: this.workflow.id,
                agentId: this.getAgentId()
            });
        }
    }

    /**
     * Cancel workflow execution
     */
    public cancelWorkflow(): void {
        this.workflowState.status = 'cancelled';
        this.workflowState.completedAt = new Date();
        this.emitWorkflowEvent('workflow-cancelled', {
            workflowId: this.workflow.id,
            agentId: this.getAgentId()
        });
    }

    /**
     * Get current workflow state
     */
    public getWorkflowState(): WorkflowState {
        return { ...this.workflowState };
    }
}
