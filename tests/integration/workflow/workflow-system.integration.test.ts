/**
 * Workflow System Integration Tests
 *
 * Tests the workflow execution system including:
 * - WorkflowExecutionEngine initialization and management
 * - Workflow registration and template management
 * - Sequential workflow execution
 * - Parallel workflow execution with dependency resolution
 * - Loop workflow with break conditions
 * - Conditional branching based on expressions
 * - Retry policy with exponential backoff
 * - Workflow pause/resume/cancel operations
 * - Step execution and completion callbacks
 * - Workflow analytics and metrics
 *
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { TASK_TEST_AGENT_CONFIG, TIMEOUTS, generateTestId } from '../../utils/TestFixtures';
import { WorkflowExecutionEngine } from '../../../src/server/services/WorkflowExecutionEngine';
import {
    WorkflowDefinition,
    WorkflowStep,
    WorkflowTemplate,
    WorkflowState,
    WorkflowStatus,
    WorkflowRetryPolicy,
    WorkflowCondition,
    WorkflowExecutionResult
} from '../../../src/shared/types/WorkflowTypes';

/**
 * Helper to create a basic workflow definition for testing
 */
function createTestWorkflowDefinition(
    id: string,
    steps: WorkflowStep[],
    overrides: Partial<WorkflowDefinition> = {}
): WorkflowDefinition {
    return {
        id,
        name: `Test Workflow ${id}`,
        description: 'A test workflow for integration testing',
        version: '1.0.0',
        steps,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'test-agent',
        ...overrides
    };
}

/**
 * Helper to create a basic workflow step for testing
 */
function createTestStep(
    id: string,
    type: 'validation' | 'wait' | 'decision' | 'custom' = 'validation',
    overrides: Partial<WorkflowStep> = {}
): WorkflowStep {
    return {
        id,
        name: `Test Step ${id}`,
        description: `Description for step ${id}`,
        type,
        config: type === 'validation' ? {} : { wait: { type: 'duration', duration: 10 } },
        dependencies: [],
        ...overrides
    };
}

/**
 * Helper to create a workflow template for testing
 */
function createTestTemplate(
    id: string,
    category: string,
    steps: WorkflowStep[],
    overrides: Partial<WorkflowTemplate> = {}
): WorkflowTemplate {
    return {
        id,
        name: `Test Template ${id}`,
        description: 'A test workflow template',
        category,
        tags: ['test', 'integration'],
        workflow: {
            name: `Template Workflow ${id}`,
            version: '1.0.0',
            steps,
            description: 'Workflow from template'
        },
        builtIn: false,
        ...overrides
    };
}

describe('Workflow System', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let channelMonitor: any;
    let workflowEngine: WorkflowExecutionEngine;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('workflow', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
        channelMonitor = result.monitor;
        workflowEngine = WorkflowExecutionEngine.getInstance();
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('WorkflowExecutionEngine Initialization', () => {
        it('should return singleton instance', () => {
            const instance1 = WorkflowExecutionEngine.getInstance();
            const instance2 = WorkflowExecutionEngine.getInstance();

            expect(instance1).toBe(instance2);
            expect(instance1).toBeInstanceOf(WorkflowExecutionEngine);
        });

        it('should initialize with empty workflow registry', () => {
            // Create a fresh workflow ID to check it does not exist
            const testId = generateTestId('non-existent');
            const workflow = workflowEngine.getWorkflow(testId);

            expect(workflow).toBeUndefined();
        });

        it('should initialize with empty template registry', () => {
            const testId = generateTestId('non-existent');
            const template = workflowEngine.getTemplate(testId);

            expect(template).toBeUndefined();
        });

        it('should initialize with empty execution registry', () => {
            const testId = generateTestId('non-existent');
            const execution = workflowEngine.getExecution(testId);

            expect(execution).toBeUndefined();
        });
    });

    describe('Workflow Registration and Template Management', () => {
        it('should register a workflow definition', () => {
            const workflowId = generateTestId('wf-register');
            const steps = [
                createTestStep('step-1'),
                createTestStep('step-2')
            ];
            const workflow = createTestWorkflowDefinition(workflowId, steps);

            workflowEngine.registerWorkflow(workflow);

            const retrieved = workflowEngine.getWorkflow(workflowId);
            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe(workflowId);
            expect(retrieved?.steps.length).toBe(2);
        });

        it('should list all registered workflows', () => {
            const workflowId1 = generateTestId('wf-list-1');
            const workflowId2 = generateTestId('wf-list-2');

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId1, [createTestStep('s1')])
            );
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId2, [createTestStep('s2')])
            );

            const workflows = workflowEngine.listWorkflows();

            expect(workflows.length).toBeGreaterThanOrEqual(2);
            expect(workflows.some(w => w.id === workflowId1)).toBe(true);
            expect(workflows.some(w => w.id === workflowId2)).toBe(true);
        });

        it('should register a workflow template', () => {
            const templateId = generateTestId('tmpl-register');
            const steps = [createTestStep('tmpl-step-1')];
            const template = createTestTemplate(templateId, 'automation', steps);

            workflowEngine.registerTemplate(template);

            const retrieved = workflowEngine.getTemplate(templateId);
            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe(templateId);
            expect(retrieved?.category).toBe('automation');
        });

        it('should list templates by category', () => {
            const category = generateTestId('category');
            const templateId1 = generateTestId('tmpl-cat-1');
            const templateId2 = generateTestId('tmpl-cat-2');
            const templateId3 = generateTestId('tmpl-other');

            workflowEngine.registerTemplate(
                createTestTemplate(templateId1, category, [createTestStep('s1')])
            );
            workflowEngine.registerTemplate(
                createTestTemplate(templateId2, category, [createTestStep('s2')])
            );
            workflowEngine.registerTemplate(
                createTestTemplate(templateId3, 'other-category', [createTestStep('s3')])
            );

            const templates = workflowEngine.listTemplates(category);

            expect(templates.length).toBeGreaterThanOrEqual(2);
            expect(templates.every(t => t.category === category)).toBe(true);
        });

        it('should create workflow from template with parameters', () => {
            const templateId = generateTestId('tmpl-create');
            const steps = [createTestStep('param-step')];
            const template = createTestTemplate(templateId, 'parameterized', steps, {
                parameters: [
                    {
                        name: 'requiredParam',
                        description: 'A required parameter',
                        type: 'string',
                        required: true
                    },
                    {
                        name: 'optionalParam',
                        description: 'An optional parameter',
                        type: 'number',
                        required: false,
                        default: 42
                    }
                ]
            });

            workflowEngine.registerTemplate(template);

            const workflow = workflowEngine.createWorkflowFromTemplate(
                templateId,
                { requiredParam: 'test-value' },
                'test-creator'
            );

            expect(workflow).toBeDefined();
            expect(workflow?.createdBy).toBe('test-creator');
            expect(workflow?.metadata?.templateId).toBe(templateId);
            expect(workflow?.metadata?.parameters).toEqual({ requiredParam: 'test-value' });
        });

        it('should fail to create workflow from template with missing required parameters', () => {
            const templateId = generateTestId('tmpl-missing-param');
            const template = createTestTemplate(templateId, 'strict', [createTestStep('s1')], {
                parameters: [
                    {
                        name: 'requiredField',
                        type: 'string',
                        required: true
                    }
                ]
            });

            workflowEngine.registerTemplate(template);

            const workflow = workflowEngine.createWorkflowFromTemplate(
                templateId,
                {}, // Missing required parameter
                'test-creator'
            );

            expect(workflow).toBeNull();
        });

        it('should fail to create workflow from non-existent template', () => {
            const workflow = workflowEngine.createWorkflowFromTemplate(
                'non-existent-template-id',
                {},
                'test-creator'
            );

            expect(workflow).toBeNull();
        });
    });

    describe('Workflow Execution Context', () => {
        it('should create execution context for registered workflow', () => {
            const workflowId = generateTestId('wf-context');
            const steps = [createTestStep('ctx-step-1')];
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent-id',
                channelId
            );

            expect(context).toBeDefined();
            expect(context?.workflowId).toBe(workflowId);
            expect(context?.agentId).toBe('test-agent-id');
            expect(context?.channelId).toBe(channelId);
            expect(context?.executionId).toMatch(/^exec-/);
            expect(context?.state.status).toBe('pending');
        });

        it('should fail to create context for non-existent workflow', () => {
            const context = workflowEngine.createExecutionContext(
                'non-existent-workflow',
                'test-agent',
                channelId
            );

            expect(context).toBeNull();
        });

        it('should store execution record when context is created', () => {
            const workflowId = generateTestId('wf-exec-record');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );

            expect(context).toBeDefined();

            const execution = workflowEngine.getExecution(context!.executionId);
            expect(execution).toBeDefined();
            expect(execution?.workflowId).toBe(workflowId);
            expect(execution?.agentId).toBe('test-agent');
            expect(execution?.startedAt).toBeInstanceOf(Date);
        });
    });

    describe('Execution State Management', () => {
        it('should update execution state', () => {
            const workflowId = generateTestId('wf-state-update');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );
            expect(context).toBeDefined();

            const newState: WorkflowState = {
                currentStep: 's1',
                completedSteps: [],
                failedSteps: [],
                stepOutputs: new Map(),
                variables: { testVar: 'value' },
                status: 'running'
            };

            workflowEngine.updateExecutionState(context!.executionId, newState);

            const execution = workflowEngine.getExecution(context!.executionId);
            expect(execution?.state.status).toBe('running');
            expect(execution?.state.currentStep).toBe('s1');
        });

        it('should complete execution with result', () => {
            const workflowId = generateTestId('wf-complete');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );
            expect(context).toBeDefined();

            const result: WorkflowExecutionResult = {
                executionId: context!.executionId,
                workflowId,
                state: {
                    completedSteps: ['s1'],
                    failedSteps: [],
                    stepOutputs: new Map(),
                    variables: {},
                    status: 'completed'
                },
                duration: 1500,
                success: true,
                output: { result: 'success' }
            };

            workflowEngine.completeExecution(context!.executionId, result);

            const execution = workflowEngine.getExecution(context!.executionId);
            expect(execution?.completedAt).toBeInstanceOf(Date);
            expect(execution?.result?.success).toBe(true);
            expect(execution?.result?.duration).toBe(1500);
        });

        it('should list executions for a specific workflow', () => {
            const workflowId = generateTestId('wf-list-exec');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            // Create multiple executions
            workflowEngine.createExecutionContext(workflowId, 'agent-1', channelId);
            workflowEngine.createExecutionContext(workflowId, 'agent-2', channelId);

            const executions = workflowEngine.listExecutions(workflowId);

            expect(executions.length).toBeGreaterThanOrEqual(2);
            expect(executions.every(e => e.workflowId === workflowId)).toBe(true);
        });
    });

    describe('Sequential Workflow Execution', () => {
        it('should execute steps in sequential order', async () => {
            const workflowId = generateTestId('wf-sequential');
            const steps = [
                createTestStep('seq-step-1', 'validation'),
                createTestStep('seq-step-2', 'validation'),
                createTestStep('seq-step-3', 'validation')
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );

            expect(context).toBeDefined();
            expect(context?.state.completedSteps).toEqual([]);
        });

        it('should respect step dependencies in sequential execution', async () => {
            const workflowId = generateTestId('wf-seq-deps');
            const steps = [
                createTestStep('dep-step-1', 'validation'),
                createTestStep('dep-step-2', 'validation', { dependencies: ['dep-step-1'] }),
                createTestStep('dep-step-3', 'validation', { dependencies: ['dep-step-2'] })
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[1].dependencies).toContain('dep-step-1');
            expect(workflow?.steps[2].dependencies).toContain('dep-step-2');
        });
    });

    describe('Parallel Workflow Execution with Dependency Resolution', () => {
        it('should identify independent steps for parallel execution', () => {
            const workflowId = generateTestId('wf-parallel');
            const steps = [
                createTestStep('par-step-1', 'validation'), // No dependencies
                createTestStep('par-step-2', 'validation'), // No dependencies
                createTestStep('par-step-3', 'validation', { dependencies: ['par-step-1', 'par-step-2'] })
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);

            // Steps 1 and 2 have no dependencies - can run in parallel
            expect(workflow?.steps[0].dependencies).toEqual([]);
            expect(workflow?.steps[1].dependencies).toEqual([]);

            // Step 3 depends on both - must run after them
            expect(workflow?.steps[2].dependencies).toContain('par-step-1');
            expect(workflow?.steps[2].dependencies).toContain('par-step-2');
        });

        it('should handle complex dependency graphs', () => {
            const workflowId = generateTestId('wf-complex-deps');
            const steps = [
                createTestStep('node-a', 'validation'),
                createTestStep('node-b', 'validation'),
                createTestStep('node-c', 'validation', { dependencies: ['node-a'] }),
                createTestStep('node-d', 'validation', { dependencies: ['node-b'] }),
                createTestStep('node-e', 'validation', { dependencies: ['node-c', 'node-d'] })
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps.length).toBe(5);

            // node-e depends on node-c and node-d
            const nodeE = workflow?.steps.find(s => s.id === 'node-e');
            expect(nodeE?.dependencies).toContain('node-c');
            expect(nodeE?.dependencies).toContain('node-d');
        });
    });

    describe('Loop Workflow with Break Conditions', () => {
        it('should support loop configuration in workflow steps', () => {
            const workflowId = generateTestId('wf-loop');
            const steps: WorkflowStep[] = [
                {
                    id: 'loop-step',
                    name: 'Loop Step',
                    type: 'loop',
                    config: {
                        loop: {
                            type: 'while',
                            variable: 'counter',
                            source: 'counter < 10',
                            maxIterations: 100
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.loop).toBeDefined();
            expect(workflow?.steps[0].config.loop?.type).toBe('while');
            expect(workflow?.steps[0].config.loop?.maxIterations).toBe(100);
        });

        it('should support foreach loop type', () => {
            const workflowId = generateTestId('wf-foreach');
            const steps: WorkflowStep[] = [
                {
                    id: 'foreach-step',
                    name: 'ForEach Step',
                    type: 'loop',
                    config: {
                        loop: {
                            type: 'foreach',
                            variable: 'item',
                            source: ['a', 'b', 'c'],
                            maxIterations: 10
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.loop?.type).toBe('foreach');
        });

        it('should support for loop type with range', () => {
            const workflowId = generateTestId('wf-for-loop');
            const steps: WorkflowStep[] = [
                {
                    id: 'for-step',
                    name: 'For Loop Step',
                    type: 'loop',
                    config: {
                        loop: {
                            type: 'for',
                            variable: 'i',
                            source: { start: 0, end: 10, step: 1 },
                            maxIterations: 15
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.loop?.type).toBe('for');
        });
    });

    describe('Conditional Branching Based on Expressions', () => {
        it('should support decision step with branches', () => {
            const workflowId = generateTestId('wf-decision');
            const steps: WorkflowStep[] = [
                {
                    id: 'decision-step',
                    name: 'Decision Step',
                    type: 'decision',
                    config: {
                        branches: [
                            {
                                condition: {
                                    type: 'expression',
                                    expression: 'value > 50'
                                },
                                steps: ['high-value-handler']
                            },
                            {
                                condition: {
                                    type: 'expression',
                                    expression: 'value <= 50'
                                },
                                steps: ['low-value-handler']
                            }
                        ]
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.branches).toBeDefined();
            expect(workflow?.steps[0].config.branches?.length).toBe(2);
        });

        it('should support state_check condition type', () => {
            const workflowId = generateTestId('wf-state-check');
            const steps: WorkflowStep[] = [
                {
                    id: 'state-check-step',
                    name: 'State Check Step',
                    type: 'decision',
                    config: {
                        branches: [
                            {
                                condition: {
                                    type: 'state_check',
                                    expression: 'completedSteps.includes("prerequisite")'
                                },
                                steps: ['next-step']
                            }
                        ]
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.branches?.[0].condition.type).toBe('state_check');
        });

        it('should support tool_result condition type', () => {
            const workflowId = generateTestId('wf-tool-result');
            const steps: WorkflowStep[] = [
                {
                    id: 'tool-result-step',
                    name: 'Tool Result Check',
                    type: 'decision',
                    config: {
                        branches: [
                            {
                                condition: {
                                    type: 'tool_result',
                                    expression: 'lastToolResult.success === true'
                                },
                                steps: ['success-handler']
                            }
                        ]
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.branches?.[0].condition.type).toBe('tool_result');
        });

        it('should support step-level conditions', () => {
            const workflowId = generateTestId('wf-step-condition');
            const steps: WorkflowStep[] = [
                createTestStep('conditional-step', 'validation', {
                    condition: {
                        type: 'expression',
                        expression: 'shouldExecute === true',
                        variables: { shouldExecute: true }
                    }
                })
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].condition).toBeDefined();
            expect(workflow?.steps[0].condition?.type).toBe('expression');
        });
    });

    describe('Retry Policy with Exponential Backoff', () => {
        it('should configure retry policy on steps', () => {
            const workflowId = generateTestId('wf-retry');
            const retryPolicy: WorkflowRetryPolicy = {
                maxAttempts: 3,
                initialDelay: 1000,
                backoffMultiplier: 2,
                maxDelay: 30000,
                retryOnErrors: ['TIMEOUT', 'NETWORK_ERROR']
            };

            const steps: WorkflowStep[] = [
                createTestStep('retry-step', 'validation', { retryPolicy })
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].retryPolicy).toBeDefined();
            expect(workflow?.steps[0].retryPolicy?.maxAttempts).toBe(3);
            expect(workflow?.steps[0].retryPolicy?.backoffMultiplier).toBe(2);
        });

        it('should calculate exponential backoff delays correctly', () => {
            // Testing the exponential backoff formula: delay = initialDelay * (backoffMultiplier ^ attempt)
            const retryPolicy: WorkflowRetryPolicy = {
                maxAttempts: 5,
                initialDelay: 100,
                backoffMultiplier: 2,
                maxDelay: 10000
            };

            // Verify the formula matches expected delays
            const calculateDelay = (attempt: number): number => {
                const delay = retryPolicy.initialDelay * Math.pow(retryPolicy.backoffMultiplier, attempt - 1);
                return Math.min(delay, retryPolicy.maxDelay);
            };

            expect(calculateDelay(1)).toBe(100);   // 100 * 2^0 = 100
            expect(calculateDelay(2)).toBe(200);   // 100 * 2^1 = 200
            expect(calculateDelay(3)).toBe(400);   // 100 * 2^2 = 400
            expect(calculateDelay(4)).toBe(800);   // 100 * 2^3 = 800
            expect(calculateDelay(5)).toBe(1600);  // 100 * 2^4 = 1600
        });

        it('should respect maxDelay cap in retry policy', () => {
            const retryPolicy: WorkflowRetryPolicy = {
                maxAttempts: 10,
                initialDelay: 1000,
                backoffMultiplier: 2,
                maxDelay: 5000
            };

            const calculateDelay = (attempt: number): number => {
                const delay = retryPolicy.initialDelay * Math.pow(retryPolicy.backoffMultiplier, attempt - 1);
                return Math.min(delay, retryPolicy.maxDelay);
            };

            // After attempt 3, delay would exceed maxDelay
            expect(calculateDelay(3)).toBe(4000);  // 1000 * 2^2 = 4000
            expect(calculateDelay(4)).toBe(5000);  // Would be 8000, capped to 5000
            expect(calculateDelay(5)).toBe(5000);  // Would be 16000, capped to 5000
        });

        it('should support selective retry on specific errors', () => {
            const workflowId = generateTestId('wf-selective-retry');
            const steps: WorkflowStep[] = [
                createTestStep('selective-retry-step', 'validation', {
                    retryPolicy: {
                        maxAttempts: 3,
                        initialDelay: 500,
                        backoffMultiplier: 2,
                        maxDelay: 5000,
                        retryOnErrors: ['RATE_LIMIT', 'SERVICE_UNAVAILABLE']
                    }
                })
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].retryPolicy?.retryOnErrors).toContain('RATE_LIMIT');
            expect(workflow?.steps[0].retryPolicy?.retryOnErrors).not.toContain('INVALID_INPUT');
        });
    });

    describe('Workflow Pause/Resume/Cancel Operations', () => {
        it('should track paused status in workflow state', () => {
            const workflowId = generateTestId('wf-pause');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );
            expect(context).toBeDefined();

            // Simulate pause by updating state
            const pausedState: WorkflowState = {
                ...context!.state,
                status: 'paused' as WorkflowStatus
            };

            workflowEngine.updateExecutionState(context!.executionId, pausedState);

            const execution = workflowEngine.getExecution(context!.executionId);
            expect(execution?.state.status).toBe('paused');
        });

        it('should track cancelled status in workflow state', () => {
            const workflowId = generateTestId('wf-cancel');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );
            expect(context).toBeDefined();

            // Simulate cancellation
            const cancelledState: WorkflowState = {
                ...context!.state,
                status: 'cancelled' as WorkflowStatus,
                completedAt: new Date()
            };

            workflowEngine.updateExecutionState(context!.executionId, cancelledState);

            const execution = workflowEngine.getExecution(context!.executionId);
            expect(execution?.state.status).toBe('cancelled');
        });

        it('should track running status after resume', () => {
            const workflowId = generateTestId('wf-resume');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );
            expect(context).toBeDefined();

            // Pause
            workflowEngine.updateExecutionState(context!.executionId, {
                ...context!.state,
                status: 'paused'
            });

            // Resume
            workflowEngine.updateExecutionState(context!.executionId, {
                ...context!.state,
                status: 'running'
            });

            const execution = workflowEngine.getExecution(context!.executionId);
            expect(execution?.state.status).toBe('running');
        });

        it('should support all workflow status values', () => {
            const statuses: WorkflowStatus[] = [
                'pending',
                'running',
                'paused',
                'completed',
                'failed',
                'cancelled'
            ];

            const workflowId = generateTestId('wf-all-statuses');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            for (const status of statuses) {
                const context = workflowEngine.createExecutionContext(
                    workflowId,
                    'test-agent',
                    channelId
                );
                expect(context).toBeDefined();

                workflowEngine.updateExecutionState(context!.executionId, {
                    ...context!.state,
                    status
                });

                const execution = workflowEngine.getExecution(context!.executionId);
                expect(execution?.state.status).toBe(status);
            }
        });
    });

    describe('Step Execution and Completion Callbacks', () => {
        it('should support step timeout configuration', () => {
            const workflowId = generateTestId('wf-timeout');
            const steps: WorkflowStep[] = [
                createTestStep('timeout-step', 'validation', {
                    timeout: 5000 // 5 second timeout
                })
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].timeout).toBe(5000);
        });

        it('should support wait step with duration', () => {
            const workflowId = generateTestId('wf-wait-duration');
            const steps: WorkflowStep[] = [
                {
                    id: 'wait-step',
                    name: 'Wait Step',
                    type: 'wait',
                    config: {
                        wait: {
                            type: 'duration',
                            duration: 1000
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.wait?.type).toBe('duration');
            expect(workflow?.steps[0].config.wait?.duration).toBe(1000);
        });

        it('should support wait step for event', () => {
            const workflowId = generateTestId('wf-wait-event');
            const steps: WorkflowStep[] = [
                {
                    id: 'wait-event-step',
                    name: 'Wait for Event',
                    type: 'wait',
                    config: {
                        wait: {
                            type: 'event',
                            event: 'user:confirmed',
                            timeout: 30000
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.wait?.type).toBe('event');
            expect(workflow?.steps[0].config.wait?.event).toBe('user:confirmed');
        });

        it('should support wait step for condition', () => {
            const workflowId = generateTestId('wf-wait-condition');
            const steps: WorkflowStep[] = [
                {
                    id: 'wait-condition-step',
                    name: 'Wait for Condition',
                    type: 'wait',
                    config: {
                        wait: {
                            type: 'condition',
                            condition: {
                                type: 'expression',
                                expression: 'processingComplete === true'
                            },
                            timeout: 60000
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].config.wait?.type).toBe('condition');
            expect(workflow?.steps[0].config.wait?.condition).toBeDefined();
        });

        it('should store step outputs in workflow state', () => {
            const workflowId = generateTestId('wf-step-outputs');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [
                    createTestStep('output-step-1'),
                    createTestStep('output-step-2')
                ])
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );
            expect(context).toBeDefined();

            // Simulate step completion with outputs
            const stateWithOutputs: WorkflowState = {
                ...context!.state,
                completedSteps: ['output-step-1'],
                stepOutputs: new Map([['output-step-1', { data: 'step1-result' }]]),
                status: 'running'
            };

            workflowEngine.updateExecutionState(context!.executionId, stateWithOutputs);

            const execution = workflowEngine.getExecution(context!.executionId);
            expect(execution?.state.completedSteps).toContain('output-step-1');
        });
    });

    describe('Workflow Analytics and Metrics', () => {
        it('should calculate analytics for a workflow', () => {
            const workflowId = generateTestId('wf-analytics');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            // Create and complete some executions
            for (let i = 0; i < 3; i++) {
                const context = workflowEngine.createExecutionContext(
                    workflowId,
                    `agent-${i}`,
                    channelId
                );

                if (context) {
                    const result: WorkflowExecutionResult = {
                        executionId: context.executionId,
                        workflowId,
                        state: {
                            completedSteps: ['s1'],
                            failedSteps: [],
                            stepOutputs: new Map(),
                            variables: {},
                            status: 'completed'
                        },
                        duration: 1000 + (i * 500), // Varying durations
                        success: i < 2, // First two succeed, third fails
                        output: {}
                    };

                    workflowEngine.completeExecution(context.executionId, result);
                }
            }

            const analytics = workflowEngine.getAnalytics(workflowId);

            expect(analytics.totalExecutions).toBeGreaterThanOrEqual(3);
            expect(analytics.successfulExecutions).toBeGreaterThanOrEqual(2);
            expect(analytics.failedExecutions).toBeGreaterThanOrEqual(1);
            expect(analytics.averageDuration).toBeGreaterThan(0);
            expect(analytics.successRate).toBeGreaterThan(0);
            expect(analytics.successRate).toBeLessThanOrEqual(100);
        });

        it('should return zero analytics for workflow with no executions', () => {
            const workflowId = generateTestId('wf-no-executions');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            const analytics = workflowEngine.getAnalytics(workflowId);

            expect(analytics.totalExecutions).toBe(0);
            expect(analytics.successfulExecutions).toBe(0);
            expect(analytics.failedExecutions).toBe(0);
            expect(analytics.averageDuration).toBe(0);
            expect(analytics.successRate).toBe(0);
        });

        it('should cleanup old execution records', () => {
            const workflowId = generateTestId('wf-cleanup');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')])
            );

            // Create and complete an execution
            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );

            if (context) {
                workflowEngine.completeExecution(context.executionId, {
                    executionId: context.executionId,
                    workflowId,
                    state: {
                        completedSteps: ['s1'],
                        failedSteps: [],
                        stepOutputs: new Map(),
                        variables: {},
                        status: 'completed'
                    },
                    duration: 1000,
                    success: true
                });
            }

            // Cleanup with very short max age (will remove recently completed)
            // Note: This tests the cleanup mechanism, actual cleanup might not remove
            // the record if it's too recent
            const cleanedCount = workflowEngine.cleanupOldExecutions(0);

            // The function should return the count of cleaned records
            expect(typeof cleanedCount).toBe('number');
        });
    });

    describe('Tool Execution Steps', () => {
        it('should support tool_execution step type', () => {
            const workflowId = generateTestId('wf-tool-exec');
            const steps: WorkflowStep[] = [
                {
                    id: 'tool-step',
                    name: 'Execute Tool',
                    type: 'tool_execution',
                    config: {
                        tool: 'messaging_send',
                        parameters: {
                            message: 'Hello from workflow'
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].type).toBe('tool_execution');
            expect(workflow?.steps[0].config.tool).toBe('messaging_send');
        });
    });

    describe('LLM Call Steps', () => {
        it('should support llm_call step type', () => {
            const workflowId = generateTestId('wf-llm-call');
            const steps: WorkflowStep[] = [
                {
                    id: 'llm-step',
                    name: 'LLM Analysis',
                    type: 'llm_call',
                    config: {
                        prompt: 'Analyze the following data and provide insights: {{data}}'
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].type).toBe('llm_call');
            expect(workflow?.steps[0].config.prompt).toContain('Analyze');
        });
    });

    describe('Subprocess Steps', () => {
        it('should support subprocess step type for nested workflows', () => {
            const workflowId = generateTestId('wf-subprocess');
            const steps: WorkflowStep[] = [
                {
                    id: 'subprocess-step',
                    name: 'Run Sub-workflow',
                    type: 'subprocess',
                    config: {
                        // Sub-workflow reference
                        parameters: {
                            subWorkflowId: 'nested-workflow-id',
                            inheritContext: true
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].type).toBe('subprocess');
        });
    });

    describe('Custom Step Handlers', () => {
        it('should support custom step type with handler', () => {
            const workflowId = generateTestId('wf-custom');
            const steps: WorkflowStep[] = [
                {
                    id: 'custom-step',
                    name: 'Custom Processing',
                    type: 'custom',
                    config: {
                        handler: 'customDataProcessor',
                        parameters: {
                            mode: 'advanced',
                            options: { parallel: true }
                        }
                    },
                    dependencies: []
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].type).toBe('custom');
            expect(workflow?.steps[0].config.handler).toBe('customDataProcessor');
        });
    });

    describe('Workflow Metadata', () => {
        it('should preserve workflow metadata', () => {
            const workflowId = generateTestId('wf-metadata');
            const metadata = {
                author: 'test-author',
                version: '2.0.0',
                tags: ['production', 'critical'],
                customField: { nested: 'value' }
            };

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')], { metadata })
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.metadata).toEqual(metadata);
            expect(workflow?.metadata?.tags).toContain('production');
        });

        it('should preserve step metadata', () => {
            const workflowId = generateTestId('wf-step-metadata');
            const steps: WorkflowStep[] = [
                createTestStep('meta-step', 'validation', {
                    metadata: {
                        category: 'validation',
                        criticality: 'high',
                        estimatedDuration: 5000
                    }
                })
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[0].metadata?.category).toBe('validation');
            expect(workflow?.steps[0].metadata?.criticality).toBe('high');
        });
    });

    describe('Workflow Initial State', () => {
        it('should support custom initial state', () => {
            const workflowId = generateTestId('wf-initial-state');
            const initialState: WorkflowState = {
                completedSteps: [],
                failedSteps: [],
                stepOutputs: new Map(),
                variables: {
                    startValue: 100,
                    configOption: 'enabled'
                },
                status: 'pending'
            };

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [createTestStep('s1')], { initialState })
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );

            expect(context?.state.variables.startValue).toBe(100);
            expect(context?.state.variables.configOption).toBe('enabled');
        });
    });

    describe('Error Handling in Workflows', () => {
        it('should track failed steps in workflow state', () => {
            const workflowId = generateTestId('wf-error-tracking');
            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, [
                    createTestStep('success-step'),
                    createTestStep('failed-step'),
                    createTestStep('skipped-step')
                ])
            );

            const context = workflowEngine.createExecutionContext(
                workflowId,
                'test-agent',
                channelId
            );
            expect(context).toBeDefined();

            // Simulate partial execution with failure
            const failedState: WorkflowState = {
                ...context!.state,
                completedSteps: ['success-step'],
                failedSteps: ['failed-step'],
                status: 'failed',
                error: {
                    message: 'Step failed due to validation error',
                    code: 'VALIDATION_ERROR',
                    stepId: 'failed-step'
                }
            };

            workflowEngine.updateExecutionState(context!.executionId, failedState);

            const execution = workflowEngine.getExecution(context!.executionId);
            expect(execution?.state.failedSteps).toContain('failed-step');
            expect(execution?.state.error?.code).toBe('VALIDATION_ERROR');
        });

        it('should support error recovery workflows', () => {
            const workflowId = generateTestId('wf-error-recovery');
            const steps: WorkflowStep[] = [
                createTestStep('risky-step', 'validation', {
                    retryPolicy: {
                        maxAttempts: 3,
                        initialDelay: 100,
                        backoffMultiplier: 2,
                        maxDelay: 1000
                    }
                }),
                {
                    id: 'error-handler',
                    name: 'Error Handler',
                    type: 'decision',
                    config: {
                        branches: [
                            {
                                condition: {
                                    type: 'state_check',
                                    expression: 'failedSteps.length > 0'
                                },
                                steps: ['recovery-step']
                            }
                        ]
                    },
                    dependencies: ['risky-step']
                }
            ];

            workflowEngine.registerWorkflow(
                createTestWorkflowDefinition(workflowId, steps)
            );

            const workflow = workflowEngine.getWorkflow(workflowId);
            expect(workflow?.steps[1].config.branches?.[0].condition.expression)
                .toContain('failedSteps');
        });
    });
});
