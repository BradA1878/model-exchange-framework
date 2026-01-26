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
 * LoopWorkflowAgent
 *
 * Executes workflow steps in a loop until a condition is met.
 * Supports multiple loop types: for, while, foreach.
 *
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

import { WorkflowAgent, WorkflowAgentConfig, StepExecutionResult } from './WorkflowAgent';
import { WorkflowExecutionResult, WorkflowStep, WorkflowCondition } from '../../shared/types/WorkflowTypes';

/**
 * Loop iteration result
 */
interface LoopIterationResult {
    /** Iteration number */
    iteration: number;
    /** Step results for this iteration */
    stepResults: StepExecutionResult[];
    /** Iteration duration */
    duration: number;
    /** Success flag */
    success: boolean;
}

/**
 * Configuration for LoopWorkflowAgent
 */
export interface LoopWorkflowAgentConfig extends WorkflowAgentConfig {
    /** Loop condition (evaluated before each iteration) */
    loopCondition?: WorkflowCondition;
    /** Maximum iterations (default: 100) */
    maxIterations?: number;
    /** Minimum iterations (default: 1) */
    minIterations?: number;
    /** Break on first failure (default: true) */
    breakOnFailure?: boolean;
}

/**
 * LoopWorkflowAgent - Executes steps repeatedly until condition is met
 *
 * Use cases:
 * - Data processing batches
 * - Retry patterns with complex logic
 * - Iterative optimization
 * - Event polling and monitoring
 */
export class LoopWorkflowAgent extends WorkflowAgent {
    private loopCondition?: WorkflowCondition;
    private maxIterations: number;
    private minIterations: number;
    private breakOnFailure: boolean;
    private currentIteration: number = 0;
    private iterationResults: LoopIterationResult[] = [];

    constructor(config: LoopWorkflowAgentConfig) {
        super(config);

        this.loopCondition = config.loopCondition;
        this.maxIterations = config.maxIterations || 100;
        this.minIterations = config.minIterations || 1;
        this.breakOnFailure = config.breakOnFailure !== false; // Default true

        this.workflowLogger.info('Initialized LoopWorkflowAgent', {
            stepCount: this.workflow.steps.length,
            maxIterations: this.maxIterations,
            minIterations: this.minIterations
        });
    }

    /**
     * Execute workflow in a loop
     */
    protected async executeWorkflow(): Promise<WorkflowExecutionResult> {
        const startTime = Date.now();
        const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        this.workflowLogger.info('Starting loop workflow execution', {
            executionId,
            stepCount: this.workflow.steps.length,
            maxIterations: this.maxIterations
        });

        let iterations = 0;
        let shouldContinue = true;

        // Execute loop
        while (shouldContinue && iterations < this.maxIterations) {
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

            iterations++;
            this.currentIteration = iterations;

            this.workflowLogger.info('Starting loop iteration', {
                iteration: iterations,
                maxIterations: this.maxIterations
            });

            // Evaluate loop condition before iteration (if specified)
            if (this.loopCondition) {
                const conditionMet = await this.evaluateCondition(this.loopCondition);

                if (!conditionMet && iterations > this.minIterations) {
                    this.workflowLogger.info('Loop condition not met, ending loop', {
                        iteration: iterations
                    });
                    shouldContinue = false;
                    break;
                }
            }

            // Execute iteration
            const iterationResult = await this.executeIteration(iterations);
            this.iterationResults.push(iterationResult);

            // Check if iteration failed
            if (!iterationResult.success) {
                if (this.breakOnFailure) {
                    this.workflowLogger.error('Iteration failed, breaking loop', {
                        iteration: iterations,
                        failures: iterationResult.stepResults.filter(r => !r.success).length
                    });

                    return {
                        executionId,
                        workflowId: this.workflow.id,
                        state: this.workflowState,
                        duration: Date.now() - startTime,
                        success: false,
                        error: {
                            message: `Loop failed at iteration ${iterations}`,
                            code: 'LOOP_ITERATION_FAILED',
                            data: iterationResult
                        }
                    };
                } else {
                    this.workflowLogger.warn('Iteration failed, continuing loop', {
                        iteration: iterations
                    });
                }
            }

            this.workflowLogger.info('Iteration completed', {
                iteration: iterations,
                duration: iterationResult.duration,
                success: iterationResult.success
            });

            // Check if we should continue (can be overridden by step logic)
            shouldContinue = this.shouldContinueLoop(iterationResult);
        }

        // Check if we hit max iterations
        if (iterations >= this.maxIterations) {
            this.workflowLogger.warn('Reached maximum iterations', {
                maxIterations: this.maxIterations
            });
        }

        // Build final output
        const finalOutput = this.buildFinalOutput();
        const duration = Date.now() - startTime;

        this.workflowLogger.info('Loop workflow completed', {
            executionId,
            duration,
            iterations,
            successfulIterations: this.iterationResults.filter(r => r.success).length
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
     * Execute a single iteration of the loop
     */
    private async executeIteration(iteration: number): Promise<LoopIterationResult> {
        const iterationStartTime = Date.now();

        this.emitWorkflowEvent('iteration-started', {
            workflowId: this.workflow.id,
            iteration
        });

        // Store iteration number in state variables
        this.workflowState.variables['__iteration'] = iteration;

        const stepResults: StepExecutionResult[] = [];

        // Execute each step in the iteration
        for (const step of this.workflow.steps) {
            const result = await this.executeStep(step);
            stepResults.push(result);

            // Break on first failure if configured
            if (!result.success && this.breakOnFailure) {
                break;
            }
        }

        const iterationDuration = Date.now() - iterationStartTime;
        const success = stepResults.every(r => r.success);

        this.emitWorkflowEvent('iteration-completed', {
            workflowId: this.workflow.id,
            iteration,
            duration: iterationDuration,
            success,
            stepCount: stepResults.length
        });

        return {
            iteration,
            stepResults,
            duration: iterationDuration,
            success
        };
    }

    /**
     * Determine if loop should continue
     * Can be overridden by subclasses for custom logic
     */
    protected shouldContinueLoop(iterationResult: LoopIterationResult): boolean {
        // Check if any step set a loop control variable
        const shouldBreak = this.workflowState.variables['__break'];
        if (shouldBreak) {
            this.workflowLogger.info('Break flag detected, ending loop');
            return false;
        }

        // Default: continue if no condition specified
        if (!this.loopCondition) {
            return true;
        }

        // Will be evaluated at start of next iteration
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
     * Build final output from all iterations
     */
    private buildFinalOutput(): unknown {
        return {
            iterations: this.iterationResults.length,
            successfulIterations: this.iterationResults.filter(r => r.success).length,
            failedIterations: this.iterationResults.filter(r => !r.success).length,
            totalDuration: this.iterationResults.reduce((sum, r) => sum + r.duration, 0),
            iterationResults: this.iterationResults,
            finalState: this.workflowState.variables
        };
    }

    /**
     * Get current progress
     */
    public getProgress(): {
        currentIteration: number;
        maxIterations: number;
        completedIterations: number;
        successfulIterations: number;
        failedIterations: number;
        percentComplete: number;
    } {
        const completedIterations = this.iterationResults.length;
        const successfulIterations = this.iterationResults.filter(r => r.success).length;
        const failedIterations = this.iterationResults.filter(r => !r.success).length;
        const percentComplete = this.maxIterations > 0
            ? (completedIterations / this.maxIterations) * 100
            : 0;

        return {
            currentIteration: this.currentIteration,
            maxIterations: this.maxIterations,
            completedIterations,
            successfulIterations,
            failedIterations,
            percentComplete
        };
    }

    /**
     * Set loop condition dynamically
     */
    public setLoopCondition(condition: WorkflowCondition): void {
        this.loopCondition = condition;
        this.workflowLogger.info('Loop condition updated', {
            conditionType: condition.type
        });
    }

    /**
     * Set break flag to stop loop after current iteration
     */
    public breakLoop(): void {
        this.workflowState.variables['__break'] = true;
        this.workflowLogger.info('Loop break flag set');
    }
}
