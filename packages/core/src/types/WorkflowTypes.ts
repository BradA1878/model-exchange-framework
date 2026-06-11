/**
 * Workflow Types for MXF Agent Dev Kit
 *
 * Core types for workflow-based task orchestration system.
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  /** Unique step identifier */
  id: string;
  /** Step name for display */
  name: string;
  /** Step description */
  description?: string;
  /** Type of step execution */
  type: WorkflowStepType;
  /** Step configuration */
  config: WorkflowStepConfig;
  /** Dependencies (step IDs that must complete first) */
  dependencies: string[];
  /** Condition for step execution */
  condition?: WorkflowCondition;
  /** Retry policy */
  retryPolicy?: WorkflowRetryPolicy;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Metadata for extensions */
  metadata?: Record<string, unknown>;
}

/**
 * Type of workflow step
 */
export type WorkflowStepType =
  | 'tool_execution'    // Execute an MCP tool
  | 'llm_call'          // Call SystemLLM
  | 'decision'          // Conditional branching
  | 'loop'              // Iteration over data
  | 'parallel'          // Parallel execution
  | 'subprocess'        // Spawn sub-workflow
  | 'wait'              // Wait for event/time
  | 'validation'        // Validate state
  | 'custom';           // Custom handler

/**
 * Configuration for workflow step
 */
export interface WorkflowStepConfig {
  /** Tool name (for tool_execution) */
  tool?: string;
  /** Tool parameters */
  parameters?: Record<string, unknown>;
  /** LLM prompt (for llm_call) */
  prompt?: string;
  /** Decision condition (for decision) */
  branches?: WorkflowBranch[];
  /** Loop configuration (for loop) */
  loop?: WorkflowLoopConfig;
  /** Wait configuration (for wait) */
  wait?: WorkflowWaitConfig;
  /** Custom handler name (for custom) */
  handler?: string;
}

/**
 * Conditional branch in workflow
 */
export interface WorkflowBranch {
  /** Branch condition */
  condition: WorkflowCondition;
  /** Steps to execute if condition is true */
  steps: string[];
}

/**
 * Workflow condition
 */
export interface WorkflowCondition {
  /** Condition type */
  type: 'expression' | 'tool_result' | 'state_check' | 'custom';
  /** Condition expression */
  expression: string;
  /** Variables for condition evaluation */
  variables?: Record<string, unknown>;
}

/**
 * Loop configuration
 */
export interface WorkflowLoopConfig {
  /** Loop type */
  type: 'for' | 'while' | 'foreach';
  /** Iteration variable name */
  variable: string;
  /** Iteration source (array, range, condition) */
  source: unknown;
  /** Maximum iterations */
  maxIterations?: number;
}

/**
 * Wait configuration
 */
export interface WorkflowWaitConfig {
  /** Wait type */
  type: 'duration' | 'event' | 'condition';
  /** Duration in milliseconds (for duration) */
  duration?: number;
  /** Event name (for event) */
  event?: string;
  /** Condition (for condition) */
  condition?: WorkflowCondition;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Retry policy
 */
export interface WorkflowRetryPolicy {
  /** Maximum retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Retry on these error types only */
  retryOnErrors?: string[];
}

/**
 * Workflow definition
 */
export interface WorkflowDefinition {
  /** Unique workflow identifier */
  id: string;
  /** Workflow name */
  name: string;
  /** Workflow description */
  description?: string;
  /** Workflow version */
  version: string;
  /** Workflow steps */
  steps: WorkflowStep[];
  /** Initial state */
  initialState?: WorkflowState;
  /** Workflow metadata */
  metadata?: Record<string, unknown>;
  /** Created timestamp */
  createdAt: Date;
  /** Updated timestamp */
  updatedAt: Date;
  /** Created by agent ID */
  createdBy: string;
}

/**
 * Workflow execution state
 */
export interface WorkflowState {
  /** Current step ID being executed */
  currentStep?: string;
  /** Completed step IDs */
  completedSteps: string[];
  /** Failed step IDs */
  failedSteps: string[];
  /** Step outputs (step ID -> output) */
  stepOutputs: Map<string, unknown>;
  /** Workflow variables */
  variables: Record<string, unknown>;
  /** Execution status */
  status: WorkflowStatus;
  /** Error information */
  error?: WorkflowError;
  /** Start timestamp */
  startedAt?: Date;
  /** End timestamp */
  completedAt?: Date;
}

/**
 * Workflow execution status
 */
export type WorkflowStatus =
  | 'pending'       // Not started
  | 'running'       // In progress
  | 'paused'        // Paused by user or wait step
  | 'completed'     // Successfully completed
  | 'failed'        // Failed with error
  | 'cancelled';    // Cancelled by user

/**
 * Workflow error
 */
export interface WorkflowError {
  /** Error message */
  message: string;
  /** Error code */
  code?: string;
  /** Step ID where error occurred */
  stepId?: string;
  /** Error stack trace */
  stack?: string;
  /** Original error data */
  data?: unknown;
}

/**
 * Workflow execution context
 */
export interface WorkflowExecutionContext {
  /** Workflow ID */
  workflowId: string;
  /** Execution ID */
  executionId: string;
  /** Agent ID executing workflow */
  agentId: string;
  /** Channel ID (if any) */
  channelId?: string;
  /** Current state */
  state: WorkflowState;
  /** Execution configuration */
  config: WorkflowExecutionConfig;
}

/**
 * Workflow execution configuration
 */
export interface WorkflowExecutionConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Override default timeouts */
  defaultTimeout?: number;
  /** Override default retry policy */
  defaultRetryPolicy?: WorkflowRetryPolicy;
  /** Execution mode */
  mode?: 'normal' | 'dry_run' | 'debug';
  /** Callback on step completion */
  onStepComplete?: (stepId: string, output: unknown) => void;
  /** Callback on workflow completion */
  onComplete?: (state: WorkflowState) => void;
  /** Callback on error */
  onError?: (error: WorkflowError) => void;
}

/**
 * Workflow template
 */
export interface WorkflowTemplate {
  /** Template ID */
  id: string;
  /** Template name */
  name: string;
  /** Template description */
  description?: string;
  /** Template category */
  category: string;
  /** Template tags */
  tags: string[];
  /** Workflow definition */
  workflow: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
  /** Template parameters */
  parameters?: WorkflowTemplateParameter[];
  /** Usage examples */
  examples?: WorkflowTemplateExample[];
  /** Is built-in template */
  builtIn: boolean;
}

/**
 * Workflow template parameter
 */
export interface WorkflowTemplateParameter {
  /** Parameter name */
  name: string;
  /** Parameter description */
  description?: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Is required */
  required: boolean;
  /** Default value */
  default?: unknown;
  /** Validation schema */
  schema?: Record<string, unknown>;
}

/**
 * Workflow template example
 */
export interface WorkflowTemplateExample {
  /** Example title */
  title: string;
  /** Example description */
  description?: string;
  /** Example parameters */
  parameters: Record<string, unknown>;
}

/**
 * Workflow execution result
 */
export interface WorkflowExecutionResult {
  /** Execution ID */
  executionId: string;
  /** Workflow ID */
  workflowId: string;
  /** Final state */
  state: WorkflowState;
  /** Total duration in milliseconds */
  duration: number;
  /** Success flag */
  success: boolean;
  /** Output data */
  output?: unknown;
  /** Error (if failed) */
  error?: WorkflowError;
}
