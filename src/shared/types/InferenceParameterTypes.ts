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
 * InferenceParameterTypes.ts
 *
 * Defines types and interfaces for dynamic inference parameter control within MXF.
 * This system is architecture-independent - it works with any agent execution pattern
 * including ORPAR cognitive cycles, simple request-response agents, and custom workflows.
 *
 * Key Features:
 * - Universal parameter profiles for any agent execution pattern
 * - ORPAR phase-aware profiles as an optional enhancement
 * - Configuration hierarchy resolution (task -> agent -> channel -> defaults)
 * - Runtime parameter adjustment request/response types
 * - Cost tracking integration types
 */

import { AgentId, ChannelId } from './ChannelContext';

/**
 * ORPAR Phase Type
 * Represents the cognitive phases in the ORPAR control loop
 */
export type OrparPhase = 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection';

/**
 * PhaseParameterProfile
 *
 * Defines the inference parameters for a specific ORPAR phase.
 * Each phase can be optimized with different model configurations
 * to balance performance, cost, and task requirements.
 *
 * @see TR-1: Parameter Profile Schema in requirements
 */
export interface PhaseParameterProfile {
    /**
     * Model identifier in OpenRouter format (e.g., 'anthropic/claude-sonnet-4-5')
     * This determines which LLM is used for the phase
     */
    model: string;

    /**
     * Temperature setting (0.0-2.0)
     * Controls output randomness:
     * - Lower values (0.1-0.3): More deterministic, focused outputs
     * - Higher values (0.6-1.0): More creative, exploratory outputs
     */
    temperature: number;

    /**
     * Reasoning token budget
     * Number of tokens allocated for extended thinking (model-dependent)
     * Set to 0 for models that don't support extended reasoning
     */
    reasoningTokens: number;

    /**
     * Maximum output tokens
     * Limits the response length to control costs and latency
     */
    maxOutputTokens: number;

    /**
     * Nucleus sampling parameter (0.0-1.0)
     * Optional - controls the cumulative probability threshold for token selection
     * Lower values = more focused, higher values = more diverse
     */
    topP?: number;
}

/**
 * OrparPhaseProfiles
 *
 * Complete set of parameter profiles for all ORPAR phases.
 * Enables phase-specific optimization of LLM behavior.
 */
export interface OrparPhaseProfiles {
    observation: PhaseParameterProfile;
    reasoning: PhaseParameterProfile;
    planning: PhaseParameterProfile;
    action: PhaseParameterProfile;
    reflection: PhaseParameterProfile;
}

/**
 * ParameterOverrideScope
 *
 * Defines how long a parameter override should persist.
 * These scopes are architecture-independent except for 'current_phase' which is ORPAR-specific.
 */
export type ParameterOverrideScope =
    | 'next_call'        // Apply only to the immediately following LLM invocation
    | 'session'          // Persist for remainder of current session (until socket disconnect)
    | 'task'             // Persist until task completion
    | 'current_phase';   // ORPAR-specific: persist through the current ORPAR phase

/**
 * ResetParameterScope
 *
 * Defines which overrides should be reset by the reset_inference_params tool.
 */
export type ResetParameterScope =
    | 'all'              // Reset all active overrides for this agent
    | 'session'          // Reset only session-scoped overrides
    | 'task';            // Reset only task-scoped overrides

/**
 * InferenceParameterRequest
 *
 * Structure for agent-initiated parameter change requests.
 * Allows agents to request parameter adjustments when they
 * recognize their current configuration is insufficient.
 *
 * @see TR-5: Tool Definition in requirements
 */
export interface InferenceParameterRequest {
    /**
     * Explanation of why the parameter adjustment is needed
     * Required for governance evaluation and audit logging
     */
    reason: string;

    /**
     * Suggested parameter changes (all optional)
     */
    suggested: {
        model?: string;
        temperature?: number;
        reasoningTokens?: number;
        maxOutputTokens?: number;
        topP?: number;
    };

    /**
     * How long the override should persist
     * Defaults to 'next_call' if not specified
     */
    scope?: ParameterOverrideScope;
}

/**
 * InferenceParameterRequestStatus
 *
 * Status codes for parameter request evaluation results
 */
export type InferenceParameterRequestStatus = 'approved' | 'modified' | 'denied';

/**
 * InferenceParameterResponse
 *
 * Response structure for parameter change requests.
 * Includes the decision, actual parameters, previous parameters for comparison,
 * and cost implications.
 *
 * @see TR-7: Response Schema in requirements
 */
export interface InferenceParameterResponse {
    /**
     * Request evaluation result
     */
    status: InferenceParameterRequestStatus;

    /**
     * The parameter profile that will actually be used
     * May differ from requested if status is 'modified'
     */
    activeParams: PhaseParameterProfile;

    /**
     * The parameter profile that was in effect before this request
     * Allows agents to compare and understand the changes made
     */
    previousParams?: PhaseParameterProfile;

    /**
     * Explanation for modified or denied requests
     * Helps agents understand governance decisions
     */
    rationale?: string;

    /**
     * Estimated cost change from this adjustment
     * Positive values indicate increased cost
     */
    costDelta?: number;

    /**
     * Unique identifier for tracking this parameter override
     */
    overrideId?: string;

    /**
     * Timestamp when the override expires (if applicable)
     */
    expiresAt?: number;
}

/**
 * ParameterGovernanceConfig
 *
 * Configuration for parameter request governance.
 * Defines limits and constraints for parameter adjustments.
 *
 * @see PR-5: Request Governance in requirements
 */
export interface ParameterGovernanceConfig {
    /**
     * Maximum allowed cost per LLM call (in USD)
     * Requests exceeding this require approval or are denied
     */
    maxCostPerCall?: number;

    /**
     * Maximum allowed cost per task (in USD)
     */
    maxCostPerTask?: number;

    /**
     * Maximum parameter change requests per phase
     * Prevents excessive parameter churn
     */
    maxRequestsPerPhase?: number;

    /**
     * Maximum parameter change requests per task
     */
    maxRequestsPerTask?: number;

    /**
     * Allowed models for this agent/channel
     * Empty array means all models allowed
     */
    allowedModels?: string[];

    /**
     * Minimum temperature allowed
     */
    minTemperature?: number;

    /**
     * Maximum temperature allowed
     */
    maxTemperature?: number;

    /**
     * Maximum reasoning tokens allowed
     */
    maxReasoningTokens?: number;

    /**
     * Maximum output tokens allowed
     */
    maxOutputTokens?: number;

    /**
     * Whether model downgrades are allowed
     * May be false for security-classified tasks
     */
    allowModelDowngrade?: boolean;

    /**
     * Whether SystemLLM approval is required for ambiguous requests
     */
    requireSystemLlmApproval?: boolean;
}

/**
 * ParameterOverrideState
 *
 * Tracks active parameter overrides for proper scope management.
 * Ensures overrides are cleaned up correctly across task boundaries.
 *
 * @see TR-8: State Management in requirements
 */
export interface ParameterOverrideState {
    /**
     * Unique identifier for this override
     */
    id: string;

    /**
     * Agent that requested the override
     */
    agentId: AgentId;

    /**
     * Channel where the override applies
     */
    channelId: ChannelId;

    /**
     * Task ID if scope is 'task'
     */
    taskId?: string;

    /**
     * Current ORPAR phase if scope is 'current_phase'
     */
    phase?: OrparPhase;

    /**
     * The override scope
     */
    scope: ParameterOverrideScope;

    /**
     * The overridden parameters
     */
    params: Partial<PhaseParameterProfile>;

    /**
     * When the override was created
     */
    createdAt: number;

    /**
     * When the override expires (optional)
     */
    expiresAt?: number;

    /**
     * Whether this override has been consumed (for 'next_call' scope)
     */
    consumed?: boolean;

    /**
     * Reason for the override (from the request)
     */
    reason: string;
}

/**
 * ParameterResolutionContext
 *
 * Context information needed to resolve the correct parameter profile.
 * Used by the configuration hierarchy resolution logic.
 *
 * @see TR-2: Configuration Hierarchy in requirements
 */
export interface ParameterResolutionContext {
    /**
     * Agent requesting the parameters
     */
    agentId: AgentId;

    /**
     * Channel where the operation is occurring
     */
    channelId: ChannelId;

    /**
     * Current ORPAR phase
     */
    phase: OrparPhase;

    /**
     * Task ID if within a task context
     */
    taskId?: string;

    /**
     * Task-level parameter overrides (highest priority)
     */
    taskOverrides?: Partial<PhaseParameterProfile>;

    /**
     * Agent-level parameter configuration
     */
    agentConfig?: Partial<OrparPhaseProfiles>;

    /**
     * Channel-level parameter defaults
     */
    channelDefaults?: Partial<OrparPhaseProfiles>;
}

/**
 * ParameterCostEstimate
 *
 * Estimated cost information for a parameter configuration.
 * Used for cost tracking and budget enforcement.
 *
 * @see TR-11: Parameter Metrics in requirements
 */
export interface ParameterCostEstimate {
    /**
     * Estimated cost per 1000 input tokens (USD)
     */
    inputCostPer1k: number;

    /**
     * Estimated cost per 1000 output tokens (USD)
     */
    outputCostPer1k: number;

    /**
     * Estimated cost per 1000 reasoning tokens (USD)
     * Only applicable for models with extended thinking
     */
    reasoningCostPer1k?: number;

    /**
     * Model capability tier (affects pricing)
     */
    tier: 'ultra_cheap' | 'budget' | 'standard' | 'premium' | 'ultra_premium';
}

/**
 * ParameterUsageMetrics
 *
 * Metrics for tracking parameter configuration usage and outcomes.
 * Feeds into the pattern learning system for adaptive optimization.
 *
 * @see TR-9: Outcome Correlation in requirements
 */
export interface ParameterUsageMetrics {
    /**
     * The parameter profile that was used
     */
    profile: PhaseParameterProfile;

    /**
     * ORPAR phase this was used for
     */
    phase: OrparPhase;

    /**
     * Task type/category if known
     */
    taskType?: string;

    /**
     * Whether the task was successful
     */
    success: boolean;

    /**
     * Response latency in milliseconds
     */
    latencyMs: number;

    /**
     * Actual tokens used
     */
    tokensUsed: {
        input: number;
        output: number;
        reasoning?: number;
    };

    /**
     * Actual cost incurred (USD)
     */
    actualCost: number;

    /**
     * Quality score (0-1) from reflection phase if available
     */
    qualityScore?: number;

    /**
     * Timestamp of the usage
     */
    timestamp: number;
}

/**
 * PhaseParameterAnalytics
 *
 * Analytics data for parameter performance analysis.
 * Aggregates usage metrics for reporting and optimization.
 */
export interface PhaseParameterAnalytics {
    /**
     * Phase being analyzed
     */
    phase: OrparPhase;

    /**
     * Time period for the analytics
     */
    period: {
        start: number;
        end: number;
    };

    /**
     * Number of executions
     */
    executionCount: number;

    /**
     * Success rate (0-1)
     */
    successRate: number;

    /**
     * Average latency in milliseconds
     */
    avgLatencyMs: number;

    /**
     * Average cost per execution
     */
    avgCostPerExecution: number;

    /**
     * Total cost for the period
     */
    totalCost: number;

    /**
     * Model usage breakdown
     */
    modelUsage: Record<string, number>;

    /**
     * Parameter adjustment request count
     */
    adjustmentRequests: number;

    /**
     * Approval rate for adjustment requests
     */
    adjustmentApprovalRate: number;

    /**
     * Average quality score if available
     */
    avgQualityScore?: number;
}

/**
 * AdaptiveProfileRecommendation
 *
 * System-generated recommendation for profile updates.
 * Based on pattern learning and outcome correlation.
 *
 * @see TR-10: Adaptive Defaults in requirements
 */
export interface AdaptiveProfileRecommendation {
    /**
     * Phase the recommendation applies to
     */
    phase: OrparPhase;

    /**
     * Task pattern this recommendation is based on
     */
    taskPattern?: string;

    /**
     * Recommended profile changes
     */
    recommendedChanges: Partial<PhaseParameterProfile>;

    /**
     * Confidence in the recommendation (0-1)
     */
    confidence: number;

    /**
     * Expected improvement metrics
     */
    expectedImprovement: {
        successRate?: number;
        costReduction?: number;
        latencyReduction?: number;
    };

    /**
     * Number of data points this recommendation is based on
     */
    sampleSize: number;

    /**
     * When this recommendation was generated
     */
    generatedAt: number;
}
