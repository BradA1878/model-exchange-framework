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
 * ParallelWorkflowAgent
 *
 * Executes workflow steps in parallel where possible.
 * Steps are grouped by dependencies and executed concurrently within groups.
 *
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

import { WorkflowAgent, WorkflowAgentConfig, StepExecutionResult } from './WorkflowAgent';
import { WorkflowExecutionResult, WorkflowStep } from '../../shared/types/WorkflowTypes';

/**
 * Step execution group (parallel execution)
 */
interface StepExecutionGroup {
    /** Group index */
    index: number;
    /** Steps in this group (can execute in parallel) */
    steps: WorkflowStep[];
    /** Dependencies (group indexes that must complete first) */
    dependencies: number[];
}

/**
 * ParallelWorkflowAgent - Executes steps in parallel where dependencies allow
 *
 * Use cases:
 * - Data fetching from multiple sources
 * - Parallel API calls
 * - Multi-model LLM calls
 * - Concurrent file processing
 */
export class ParallelWorkflowAgent extends WorkflowAgent {
    private executionGroups: StepExecutionGroup[] = [];
    private currentGroupIndex: number = 0;

    constructor(config: WorkflowAgentConfig) {
        super(config);

        // Build execution groups based on dependencies
        this.buildExecutionGroups();

        this.workflowLogger.info('Initialized ParallelWorkflowAgent', {
            stepCount: this.workflow.steps.length,
            groupCount: this.executionGroups.length
        });
    }

    /**
     * Execute workflow with parallel execution of independent steps
     */
    protected async executeWorkflow(): Promise<WorkflowExecutionResult> {
        const startTime = Date.now();
        const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        this.workflowLogger.info('Starting parallel workflow execution', {
            executionId,
            stepCount: this.workflow.steps.length,
            groupCount: this.executionGroups.length
        });

        // Execute each group in order (groups are parallel, execution between groups is sequential)
        for (let i = 0; i < this.executionGroups.length; i++) {
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

            const group = this.executionGroups[i];
            this.currentGroupIndex = i;

            this.workflowLogger.info('Executing step group', {
                groupIndex: i,
                stepCount: group.steps.length
            });

            // Execute all steps in the group in parallel
            const groupResults = await this.executeStepGroup(group);

            // Check if any step in the group failed
            const failedResults = groupResults.filter(r => !r.success);
            if (failedResults.length > 0) {
                this.workflowLogger.error('Step group execution had failures', {
                    groupIndex: i,
                    failureCount: failedResults.length,
                    failures: failedResults.map(r => ({ stepId: r.stepId, error: r.error }))
                });

                return {
                    executionId,
                    workflowId: this.workflow.id,
                    state: this.workflowState,
                    duration: Date.now() - startTime,
                    success: false,
                    error: failedResults[0].error
                };
            }

            this.workflowLogger.info('Step group completed successfully', {
                groupIndex: i,
                stepCount: group.steps.length,
                totalDuration: groupResults.reduce((sum, r) => sum + r.duration, 0)
            });
        }

        // All groups completed successfully
        const finalOutput = this.buildFinalOutput();
        const duration = Date.now() - startTime;

        this.workflowLogger.info('Parallel workflow completed successfully', {
            executionId,
            duration,
            stepCount: this.workflow.steps.length,
            groupCount: this.executionGroups.length
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
     * Execute a group of steps in parallel
     */
    private async executeStepGroup(group: StepExecutionGroup): Promise<StepExecutionResult[]> {
        const groupStartTime = Date.now();

        this.emitWorkflowEvent('group-started', {
            workflowId: this.workflow.id,
            groupIndex: group.index,
            stepCount: group.steps.length
        });

        // Execute all steps in parallel
        const stepPromises = group.steps.map(step => this.executeStep(step));
        const results = await Promise.all(stepPromises);

        const groupDuration = Date.now() - groupStartTime;

        this.emitWorkflowEvent('group-completed', {
            workflowId: this.workflow.id,
            groupIndex: group.index,
            duration: groupDuration,
            successCount: results.filter(r => r.success).length,
            failureCount: results.filter(r => !r.success).length
        });

        return results;
    }

    /**
     * Build execution groups based on step dependencies
     * Uses topological sorting to determine execution order
     */
    private buildExecutionGroups(): void {
        const steps = this.workflow.steps;
        const stepMap = new Map<string, WorkflowStep>();
        steps.forEach(step => stepMap.set(step.id, step));

        // Calculate level for each step based on dependencies
        const stepLevels = new Map<string, number>();
        const visited = new Set<string>();

        const calculateLevel = (stepId: string): number => {
            if (stepLevels.has(stepId)) {
                return stepLevels.get(stepId)!;
            }

            const step = stepMap.get(stepId);
            if (!step) {
                throw new Error(`Step not found: ${stepId}`);
            }

            // Prevent circular dependencies
            if (visited.has(stepId)) {
                throw new Error(`Circular dependency detected involving step: ${stepId}`);
            }

            visited.add(stepId);

            // If no dependencies, level is 0
            if (!step.dependencies || step.dependencies.length === 0) {
                stepLevels.set(stepId, 0);
                visited.delete(stepId);
                return 0;
            }

            // Level is max(dependency levels) + 1
            const depLevels = step.dependencies.map(depId => calculateLevel(depId));
            const level = Math.max(...depLevels) + 1;

            stepLevels.set(stepId, level);
            visited.delete(stepId);
            return level;
        };

        // Calculate levels for all steps
        steps.forEach(step => calculateLevel(step.id));

        // Group steps by level
        const levelGroups = new Map<number, WorkflowStep[]>();
        stepLevels.forEach((level, stepId) => {
            if (!levelGroups.has(level)) {
                levelGroups.set(level, []);
            }
            const step = stepMap.get(stepId)!;
            levelGroups.get(level)!.push(step);
        });

        // Convert to execution groups
        const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
        this.executionGroups = sortedLevels.map((level, index) => ({
            index,
            steps: levelGroups.get(level)!,
            dependencies: index > 0 ? [index - 1] : []
        }));
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
     * Get current progress
     */
    public getProgress(): {
        currentGroup: number;
        totalGroups: number;
        completedSteps: number;
        totalSteps: number;
        percentComplete: number;
    } {
        const totalGroups = this.executionGroups.length;
        const currentGroup = this.currentGroupIndex;
        const completedSteps = this.workflowState.completedSteps.length;
        const totalSteps = this.workflow.steps.length;
        const percentComplete = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

        return {
            currentGroup,
            totalGroups,
            completedSteps,
            totalSteps,
            percentComplete
        };
    }

    /**
     * Get execution plan (for debugging)
     */
    public getExecutionPlan(): Array<{
        groupIndex: number;
        stepIds: string[];
        stepNames: string[];
    }> {
        return this.executionGroups.map(group => ({
            groupIndex: group.index,
            stepIds: group.steps.map(s => s.id),
            stepNames: group.steps.map(s => s.name)
        }));
    }
}
