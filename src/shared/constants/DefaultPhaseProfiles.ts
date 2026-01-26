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
 * DefaultPhaseProfiles.ts
 *
 * Default phase parameter profiles for ORPAR cognitive cycles.
 * These profiles are optimized for typical cognitive demands of each phase
 * and serve as the system-wide defaults when no overrides are specified.
 *
 * Profile Design Philosophy:
 * - Observation: Fast, accurate data intake without hallucination
 * - Reasoning: Exploratory, capable of deep analysis
 * - Planning: Deterministic, structured output generation
 * - Action: Reliable, precise tool execution
 * - Reflection: Evaluative, genuine assessment capability
 *
 * @see PR-1: Default Phase Profiles in requirements
 */

import {
    PhaseParameterProfile,
    OrparPhaseProfiles,
    ParameterGovernanceConfig,
    ParameterCostEstimate
} from '../types/InferenceParameterTypes';
import { LlmProviderType } from '../protocols/mcp/LlmProviders';

// =============================================================================
// DEFAULT PHASE PROFILES (System-Wide Defaults)
// =============================================================================

/**
 * Observation Phase Profile
 *
 * Optimized for accurate data intake without hallucination.
 * - Low temperature for deterministic, focused outputs
 * - Fast model for efficient observation processing
 * - Minimal reasoning tokens (not needed for observation)
 * - Moderate output limit for structured observations
 */
export const OBSERVATION_PROFILE: PhaseParameterProfile = {
    model: 'google/gemini-2.5-flash',
    temperature: 0.2,
    reasoningTokens: 0,  // Reasoning not needed for observation
    maxOutputTokens: 2000,
    topP: 0.9
};

/**
 * Reasoning Phase Profile
 *
 * Optimized for deep analysis and solution space exploration.
 * - Moderate temperature for exploratory thinking
 * - High-capability model for complex inference
 * - Extended reasoning token budget for deep thinking
 * - Generous output limit for detailed analysis
 */
export const REASONING_PROFILE: PhaseParameterProfile = {
    model: 'anthropic/claude-sonnet-4-5',
    temperature: 0.5,
    reasoningTokens: 8000,  // Extended thinking budget
    maxOutputTokens: 4000,
    topP: 0.95
};

/**
 * Planning Phase Profile
 *
 * Optimized for structured, deterministic plan generation.
 * - Low temperature for consistent planning
 * - Strategic model with good structured output
 * - Moderate reasoning for strategic thinking
 * - Generous output for detailed plans
 */
export const PLANNING_PROFILE: PhaseParameterProfile = {
    model: 'google/gemini-2.5-pro',
    temperature: 0.3,
    reasoningTokens: 4000,  // Strategic thinking budget
    maxOutputTokens: 4000,
    topP: 0.9
};

/**
 * Action Phase Profile
 *
 * Optimized for reliable, precise tool execution.
 * - Very low temperature for deterministic behavior
 * - Reliable execution model with good tool calling
 * - Minimal reasoning overhead
 * - Moderate output for action results
 */
export const ACTION_PROFILE: PhaseParameterProfile = {
    model: 'openai/gpt-4.1-mini',
    temperature: 0.1,
    reasoningTokens: 0,  // Actions should be deterministic
    maxOutputTokens: 2000,
    topP: 0.8
};

/**
 * Reflection Phase Profile
 *
 * Optimized for genuine evaluative assessment.
 * - Moderate temperature for balanced evaluation
 * - High-capability model for nuanced assessment
 * - Extended reasoning for thorough evaluation
 * - Moderate output for insights and improvements
 */
export const REFLECTION_PROFILE: PhaseParameterProfile = {
    model: 'anthropic/claude-sonnet-4-5',
    temperature: 0.4,
    reasoningTokens: 4000,  // Evaluation thinking budget
    maxOutputTokens: 2000,
    topP: 0.9
};

/**
 * DEFAULT_PHASE_PROFILES
 *
 * Complete set of default profiles for all ORPAR phases.
 * These are the system-wide defaults used when no overrides are specified.
 */
export const DEFAULT_PHASE_PROFILES: OrparPhaseProfiles = {
    observation: OBSERVATION_PROFILE,
    reasoning: REASONING_PROFILE,
    planning: PLANNING_PROFILE,
    action: ACTION_PROFILE,
    reflection: REFLECTION_PROFILE
};

// =============================================================================
// STANDARD AGENT DEFAULT PROFILE (Non-ORPAR Agents)
// =============================================================================

/**
 * STANDARD_AGENT_DEFAULT
 *
 * Default parameter profile for non-ORPAR agents.
 * Provides a balanced configuration suitable for general-purpose agent execution
 * without the phase-specific optimizations of ORPAR agents.
 *
 * This profile is used as the baseline for:
 * - Simple request-response agents
 * - Custom workflow agents
 * - Any agent not using the ORPAR control loop
 *
 * Characteristics:
 * - Balanced model with good general capabilities
 * - Moderate temperature for versatile output
 * - Reasonable reasoning token budget
 * - Standard output limit for typical responses
 */
export const STANDARD_AGENT_DEFAULT: PhaseParameterProfile = {
    model: 'anthropic/claude-sonnet-4-5',
    temperature: 0.7,
    reasoningTokens: 4000,
    maxOutputTokens: 4000,
    topP: 0.9
};

// =============================================================================
// PROVIDER-SPECIFIC PROFILES
// =============================================================================

/**
 * Provider-specific phase profiles
 * Each provider has optimized model selections for their available models
 */
export const PROVIDER_PHASE_PROFILES: Record<LlmProviderType, OrparPhaseProfiles> = {
    [LlmProviderType.OPENROUTER]: DEFAULT_PHASE_PROFILES,

    [LlmProviderType.GEMINI]: {
        observation: {
            model: 'gemini-2.5-flash',
            temperature: 0.2,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.9
        },
        reasoning: {
            model: 'gemini-2.5-pro',
            temperature: 0.5,
            reasoningTokens: 8000,
            maxOutputTokens: 4000,
            topP: 0.95
        },
        planning: {
            model: 'gemini-2.5-pro',
            temperature: 0.3,
            reasoningTokens: 4000,
            maxOutputTokens: 4000,
            topP: 0.9
        },
        action: {
            model: 'gemini-2.5-flash',
            temperature: 0.1,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.8
        },
        reflection: {
            model: 'gemini-2.5-pro',
            temperature: 0.4,
            reasoningTokens: 4000,
            maxOutputTokens: 2000,
            topP: 0.9
        }
    },

    [LlmProviderType.OPENAI]: {
        observation: {
            model: 'gpt-4.1-mini',
            temperature: 0.2,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.9
        },
        reasoning: {
            model: 'gpt-4.1',
            temperature: 0.5,
            reasoningTokens: 8000,
            maxOutputTokens: 4000,
            topP: 0.95
        },
        planning: {
            model: 'gpt-4.1',
            temperature: 0.3,
            reasoningTokens: 4000,
            maxOutputTokens: 4000,
            topP: 0.9
        },
        action: {
            model: 'gpt-4.1-mini',
            temperature: 0.1,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.8
        },
        reflection: {
            model: 'gpt-4.1',
            temperature: 0.4,
            reasoningTokens: 4000,
            maxOutputTokens: 2000,
            topP: 0.9
        }
    },

    [LlmProviderType.ANTHROPIC]: {
        observation: {
            model: 'claude-haiku-4',
            temperature: 0.2,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.9
        },
        reasoning: {
            model: 'claude-sonnet-4-5',
            temperature: 0.5,
            reasoningTokens: 8000,
            maxOutputTokens: 4000,
            topP: 0.95
        },
        planning: {
            model: 'claude-sonnet-4-5',
            temperature: 0.3,
            reasoningTokens: 4000,
            maxOutputTokens: 4000,
            topP: 0.9
        },
        action: {
            model: 'claude-haiku-4',
            temperature: 0.1,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.8
        },
        reflection: {
            model: 'claude-sonnet-4-5',
            temperature: 0.4,
            reasoningTokens: 4000,
            maxOutputTokens: 2000,
            topP: 0.9
        }
    },

    [LlmProviderType.AZURE_OPENAI]: {
        observation: {
            model: 'gpt-4.1-mini',
            temperature: 0.2,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.9
        },
        reasoning: {
            model: 'gpt-4.1',
            temperature: 0.5,
            reasoningTokens: 8000,
            maxOutputTokens: 4000,
            topP: 0.95
        },
        planning: {
            model: 'gpt-4.1',
            temperature: 0.3,
            reasoningTokens: 4000,
            maxOutputTokens: 4000,
            topP: 0.9
        },
        action: {
            model: 'gpt-4.1-mini',
            temperature: 0.1,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.8
        },
        reflection: {
            model: 'gpt-4.1',
            temperature: 0.4,
            reasoningTokens: 4000,
            maxOutputTokens: 2000,
            topP: 0.9
        }
    },

    [LlmProviderType.XAI]: {
        observation: {
            model: 'grok-2-1212',
            temperature: 0.2,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.9
        },
        reasoning: {
            model: 'grok-2-1212',
            temperature: 0.5,
            reasoningTokens: 8000,
            maxOutputTokens: 4000,
            topP: 0.95
        },
        planning: {
            model: 'grok-2-1212',
            temperature: 0.3,
            reasoningTokens: 4000,
            maxOutputTokens: 4000,
            topP: 0.9
        },
        action: {
            model: 'grok-2-1212',
            temperature: 0.1,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.8
        },
        reflection: {
            model: 'grok-2-1212',
            temperature: 0.4,
            reasoningTokens: 4000,
            maxOutputTokens: 2000,
            topP: 0.9
        }
    },

    [LlmProviderType.OLLAMA]: {
        observation: {
            model: 'llama3.2:3b',
            temperature: 0.2,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.9
        },
        reasoning: {
            model: 'llama3.1:8b',
            temperature: 0.5,
            reasoningTokens: 0,  // Local models typically don't support reasoning tokens
            maxOutputTokens: 4000,
            topP: 0.95
        },
        planning: {
            model: 'llama3.1:8b',
            temperature: 0.3,
            reasoningTokens: 0,
            maxOutputTokens: 4000,
            topP: 0.9
        },
        action: {
            model: 'llama3.2:3b',
            temperature: 0.1,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.8
        },
        reflection: {
            model: 'llama3.1:8b',
            temperature: 0.4,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.9
        }
    },

    [LlmProviderType.CUSTOM]: {
        observation: {
            model: 'custom-fast-model',
            temperature: 0.2,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.9
        },
        reasoning: {
            model: 'custom-reasoning-model',
            temperature: 0.5,
            reasoningTokens: 4000,
            maxOutputTokens: 4000,
            topP: 0.95
        },
        planning: {
            model: 'custom-planning-model',
            temperature: 0.3,
            reasoningTokens: 2000,
            maxOutputTokens: 4000,
            topP: 0.9
        },
        action: {
            model: 'custom-action-model',
            temperature: 0.1,
            reasoningTokens: 0,
            maxOutputTokens: 2000,
            topP: 0.8
        },
        reflection: {
            model: 'custom-reflection-model',
            temperature: 0.4,
            reasoningTokens: 2000,
            maxOutputTokens: 2000,
            topP: 0.9
        }
    },

    [LlmProviderType.PROVIDER_TYPE_1]: {
        observation: { model: 'provider-1-fast', temperature: 0.2, reasoningTokens: 0, maxOutputTokens: 2000 },
        reasoning: { model: 'provider-1-reasoning', temperature: 0.5, reasoningTokens: 4000, maxOutputTokens: 4000 },
        planning: { model: 'provider-1-planning', temperature: 0.3, reasoningTokens: 2000, maxOutputTokens: 4000 },
        action: { model: 'provider-1-action', temperature: 0.1, reasoningTokens: 0, maxOutputTokens: 2000 },
        reflection: { model: 'provider-1-reflection', temperature: 0.4, reasoningTokens: 2000, maxOutputTokens: 2000 }
    },

    [LlmProviderType.PROVIDER_TYPE_2]: {
        observation: { model: 'provider-2-fast', temperature: 0.2, reasoningTokens: 0, maxOutputTokens: 2000 },
        reasoning: { model: 'provider-2-reasoning', temperature: 0.5, reasoningTokens: 4000, maxOutputTokens: 4000 },
        planning: { model: 'provider-2-planning', temperature: 0.3, reasoningTokens: 2000, maxOutputTokens: 4000 },
        action: { model: 'provider-2-action', temperature: 0.1, reasoningTokens: 0, maxOutputTokens: 2000 },
        reflection: { model: 'provider-2-reflection', temperature: 0.4, reasoningTokens: 2000, maxOutputTokens: 2000 }
    },

    [LlmProviderType.PROVIDER_TYPE_3]: {
        observation: { model: 'provider-3-fast', temperature: 0.2, reasoningTokens: 0, maxOutputTokens: 2000 },
        reasoning: { model: 'provider-3-reasoning', temperature: 0.5, reasoningTokens: 4000, maxOutputTokens: 4000 },
        planning: { model: 'provider-3-planning', temperature: 0.3, reasoningTokens: 2000, maxOutputTokens: 4000 },
        action: { model: 'provider-3-action', temperature: 0.1, reasoningTokens: 0, maxOutputTokens: 2000 },
        reflection: { model: 'provider-3-reflection', temperature: 0.4, reasoningTokens: 2000, maxOutputTokens: 2000 }
    }
};

// =============================================================================
// DEFAULT GOVERNANCE CONFIGURATION
// =============================================================================

/**
 * DEFAULT_GOVERNANCE_CONFIG
 *
 * Default governance configuration for parameter requests.
 * These limits provide reasonable defaults for cost and rate limiting.
 */
export const DEFAULT_GOVERNANCE_CONFIG: ParameterGovernanceConfig = {
    maxCostPerCall: 0.50,        // $0.50 max per LLM call
    maxCostPerTask: 5.00,        // $5.00 max per task
    maxRequestsPerPhase: 3,      // Max 3 parameter changes per phase
    maxRequestsPerTask: 10,      // Max 10 parameter changes per task
    allowedModels: [],           // Empty = all models allowed
    minTemperature: 0.0,
    maxTemperature: 2.0,
    maxReasoningTokens: 16000,
    maxOutputTokens: 8000,
    allowModelDowngrade: true,
    requireSystemLlmApproval: false
};

/**
 * STRICT_GOVERNANCE_CONFIG
 *
 * Stricter governance for production or security-sensitive environments.
 */
export const STRICT_GOVERNANCE_CONFIG: ParameterGovernanceConfig = {
    maxCostPerCall: 0.10,        // $0.10 max per LLM call
    maxCostPerTask: 1.00,        // $1.00 max per task
    maxRequestsPerPhase: 1,      // Max 1 parameter change per phase
    maxRequestsPerTask: 3,       // Max 3 parameter changes per task
    allowedModels: [             // Limited to proven, reliable models
        'google/gemini-2.5-flash',
        'anthropic/claude-sonnet-4-5',
        'openai/gpt-4.1-mini'
    ],
    minTemperature: 0.0,
    maxTemperature: 1.0,
    maxReasoningTokens: 4000,
    maxOutputTokens: 4000,
    allowModelDowngrade: false,
    requireSystemLlmApproval: true
};

// =============================================================================
// MODEL COST ESTIMATES
// =============================================================================

/**
 * MODEL_COST_ESTIMATES
 *
 * Estimated costs for common models (OpenRouter pricing as reference).
 * Used for cost tracking and budget enforcement.
 * Values are approximate and should be updated based on actual pricing.
 */
export const MODEL_COST_ESTIMATES: Record<string, ParameterCostEstimate> = {
    // Ultra-cheap tier (under $0.10/1M tokens)
    'google/gemini-2.5-flash': {
        inputCostPer1k: 0.00007,
        outputCostPer1k: 0.00030,
        tier: 'ultra_cheap'
    },
    'openai/gpt-4.1-nano': {
        inputCostPer1k: 0.00010,
        outputCostPer1k: 0.00040,
        tier: 'ultra_cheap'
    },

    // Budget tier (under $1.00/1M tokens)
    'openai/gpt-4.1-mini': {
        inputCostPer1k: 0.00015,
        outputCostPer1k: 0.00060,
        tier: 'budget'
    },
    'anthropic/claude-haiku-4': {
        inputCostPer1k: 0.00025,
        outputCostPer1k: 0.00125,
        tier: 'budget'
    },

    // Standard tier (under $5.00/1M tokens)
    'google/gemini-2.5-pro': {
        inputCostPer1k: 0.00125,
        outputCostPer1k: 0.00500,
        reasoningCostPer1k: 0.00500,
        tier: 'standard'
    },
    'anthropic/claude-sonnet-4': {
        inputCostPer1k: 0.00300,
        outputCostPer1k: 0.01500,
        reasoningCostPer1k: 0.01500,
        tier: 'standard'
    },

    // Premium tier (under $15.00/1M tokens)
    'anthropic/claude-sonnet-4-5': {
        inputCostPer1k: 0.00300,
        outputCostPer1k: 0.01500,
        reasoningCostPer1k: 0.01500,
        tier: 'premium'
    },
    'openai/gpt-4.1': {
        inputCostPer1k: 0.00250,
        outputCostPer1k: 0.01000,
        reasoningCostPer1k: 0.01000,
        tier: 'premium'
    },

    // Ultra-premium tier (most capable models)
    'anthropic/claude-opus-4-5': {
        inputCostPer1k: 0.01500,
        outputCostPer1k: 0.07500,
        reasoningCostPer1k: 0.07500,
        tier: 'ultra_premium'
    }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the phase profile for a specific provider and phase
 */
export function getPhaseProfile(
    provider: LlmProviderType,
    phase: keyof OrparPhaseProfiles
): PhaseParameterProfile {
    const profiles = PROVIDER_PHASE_PROFILES[provider] || DEFAULT_PHASE_PROFILES;
    return profiles[phase];
}

/**
 * Get all phase profiles for a specific provider
 */
export function getProviderProfiles(provider: LlmProviderType): OrparPhaseProfiles {
    return PROVIDER_PHASE_PROFILES[provider] || DEFAULT_PHASE_PROFILES;
}

/**
 * Estimate cost for a model/token configuration
 */
export function estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    reasoningTokens: number = 0
): number {
    // Use hasOwnProperty to avoid prototype pollution (e.g., model="toString")
    if (!Object.prototype.hasOwnProperty.call(MODEL_COST_ESTIMATES, model)) {
        // Default to standard tier pricing if model not found
        return (inputTokens * 0.003 + outputTokens * 0.015 + reasoningTokens * 0.015) / 1000;
    }
    const costInfo = MODEL_COST_ESTIMATES[model];

    const inputCost = (inputTokens * costInfo.inputCostPer1k) / 1000;
    const outputCost = (outputTokens * costInfo.outputCostPer1k) / 1000;
    const reasoningCost = costInfo.reasoningCostPer1k
        ? (reasoningTokens * costInfo.reasoningCostPer1k) / 1000
        : 0;

    return inputCost + outputCost + reasoningCost;
}

/**
 * Validate that a profile meets governance constraints
 */
export function validateProfileAgainstGovernance(
    profile: PhaseParameterProfile,
    governance: ParameterGovernanceConfig
): { valid: boolean; violations: string[] } {
    const violations: string[] = [];

    if (governance.allowedModels && governance.allowedModels.length > 0) {
        if (!governance.allowedModels.includes(profile.model)) {
            violations.push(`Model '${profile.model}' is not in allowed models list`);
        }
    }

    if (governance.minTemperature !== undefined && profile.temperature < governance.minTemperature) {
        violations.push(`Temperature ${profile.temperature} is below minimum ${governance.minTemperature}`);
    }

    if (governance.maxTemperature !== undefined && profile.temperature > governance.maxTemperature) {
        violations.push(`Temperature ${profile.temperature} exceeds maximum ${governance.maxTemperature}`);
    }

    if (governance.maxReasoningTokens !== undefined && profile.reasoningTokens > governance.maxReasoningTokens) {
        violations.push(`Reasoning tokens ${profile.reasoningTokens} exceeds maximum ${governance.maxReasoningTokens}`);
    }

    if (governance.maxOutputTokens !== undefined && profile.maxOutputTokens > governance.maxOutputTokens) {
        violations.push(`Output tokens ${profile.maxOutputTokens} exceeds maximum ${governance.maxOutputTokens}`);
    }

    return {
        valid: violations.length === 0,
        violations
    };
}

/**
 * Merge a partial profile with defaults
 */
export function mergeWithDefaults(
    partial: Partial<PhaseParameterProfile>,
    defaults: PhaseParameterProfile
): PhaseParameterProfile {
    return {
        model: partial.model ?? defaults.model,
        temperature: partial.temperature ?? defaults.temperature,
        reasoningTokens: partial.reasoningTokens ?? defaults.reasoningTokens,
        maxOutputTokens: partial.maxOutputTokens ?? defaults.maxOutputTokens,
        topP: partial.topP ?? defaults.topP
    };
}
