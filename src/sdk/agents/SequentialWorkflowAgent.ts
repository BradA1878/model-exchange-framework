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
 * SequentialWorkflowAgent
 *
 * Executes workflow steps in sequential order.
 * Each step completes before the next begins.
 *
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

import { WorkflowAgent, WorkflowAgentConfig, StepExecutionResult } from './WorkflowAgent';
import { WorkflowExecutionResult } from '../../shared/types/WorkflowTypes';

/**
 * SequentialWorkflowAgent - Executes steps one at a time in order
 *
 * Use cases:
 * - Data processing pipelines
 * - API integration workflows
 * - Multi-step validation processes
 * - Document generation workflows
 */
export class SequentialWorkflowAgent extends WorkflowAgent {
    private currentStepIndex: number = 0;

    constructor(config: WorkflowAgentConfig) {
        super(config);
        this.workflowLogger.info('Initialized SequentialWorkflowAgent', {
            stepCount: this.workflow.steps.length
        });
    }

    /**
     * Execute workflow steps sequentially
     */
    protected async executeWorkflow(): Promise<WorkflowExecutionResult> {
        const startTime = Date.now();
        const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        this.workflowLogger.info('Starting sequential workflow execution', {
            executionId,
            stepCount: this.workflow.steps.length
        });

        // Execute each step in order
        for (let i = 0; i < this.workflow.steps.length; i++) {
            // Check if workflow was paused or cancelled
            if (this.workflowState.status === 'paused') {
                this.workflowLogger.info('Workflow paused, waiting for resume');
                await this.waitForResume();
            }

            if (this.workflowState.status === 'cancelled') {
                this.workflowLogger.info('Workflow cancelled');
                return {
                    executionId,
                    workflowId: this.workflow.id,
                    state: this.workflowState,
                    duration: Date.now() - startTime,
                    success: false,
                    error: {
                        message: 'Workflow cancelled by user',
                        code: 'WORKFLOW_CANCELLED'
                    }
                };
            }

            const step = this.workflow.steps[i];
            this.currentStepIndex = i;

            // Update current step in state
            this.workflowState.currentStep = step.id;

            // Check dependencies
            if (!this.checkDependencies(step)) {
                const error = {
                    message: `Dependencies not met for step ${step.id}`,
                    code: 'DEPENDENCIES_NOT_MET',
                    stepId: step.id
                };

                this.workflowLogger.error('Step dependencies not met', {
                    stepId: step.id,
                    dependencies: step.dependencies
                });

                return {
                    executionId,
                    workflowId: this.workflow.id,
                    state: this.workflowState,
                    duration: Date.now() - startTime,
                    success: false,
                    error
                };
            }

            // Execute step
            const result = await this.executeStep(step);

            // Handle step failure
            if (!result.success) {
                this.workflowLogger.error('Step execution failed', {
                    stepId: step.id,
                    stepIndex: i,
                    error: result.error
                });

                return {
                    executionId,
                    workflowId: this.workflow.id,
                    state: this.workflowState,
                    duration: Date.now() - startTime,
                    success: false,
                    error: result.error
                };
            }

            this.workflowLogger.info('Step completed successfully', {
                stepId: step.id,
                stepIndex: i,
                duration: result.duration
            });
        }

        // All steps completed successfully
        const finalOutput = this.buildFinalOutput();
        const duration = Date.now() - startTime;

        this.workflowLogger.info('Sequential workflow completed successfully', {
            executionId,
            duration,
            stepCount: this.workflow.steps.length
        });

        return {
            executionId,
            workflowId: this.workflow.id,
            state: this.workflowState,
            duration,
            success: true,
            output: finalOutput
        };
    }

    /**
     * Check if all dependencies for a step are met
     */
    private checkDependencies(step: any): boolean {
        if (!step.dependencies || step.dependencies.length === 0) {
            return true;
        }

        // Check if all dependent steps are completed
        for (const depStepId of step.dependencies) {
            if (!this.workflowState.completedSteps.includes(depStepId)) {
                return false;
            }

            // Check if dependent step failed
            if (this.workflowState.failedSteps.includes(depStepId)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Wait for workflow to be resumed
     */
    private async waitForResume(): Promise<void> {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (this.workflowState.status !== 'paused') {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });
    }

    /**
     * Build final output from step outputs
     */
    private buildFinalOutput(): unknown {
        const output: Record<string, unknown> = {};

        this.workflowState.stepOutputs.forEach((value, key) => {
            output[key] = value;
        });

        return output;
    }

    /**
     * Get current step progress
     */
    public getProgress(): {
        currentStep: number;
        totalSteps: number;
        percentComplete: number;
    } {
        const totalSteps = this.workflow.steps.length;
        const currentStep = this.currentStepIndex;
        const percentComplete = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;

        return {
            currentStep,
            totalSteps,
            percentComplete
        };
    }
}
