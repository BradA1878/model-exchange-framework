/**
 * Unit tests for InferenceParameterTools
 * Tests dynamic inference parameter control, governance, and cost tracking
 */

import {
    requestInferenceParamsTool,
    resetInferenceParamsTool,
    getCurrentParamsTool,
    getParameterStatusTool,
    getAvailableModelsTool
} from '@mxf/shared/protocols/mcp/tools/InferenceParameterTools';
import {
    DEFAULT_PHASE_PROFILES,
    OBSERVATION_PROFILE,
    REASONING_PROFILE,
    PLANNING_PROFILE,
    ACTION_PROFILE,
    REFLECTION_PROFILE,
    STANDARD_AGENT_DEFAULT,
    DEFAULT_GOVERNANCE_CONFIG,
    getPhaseProfile,
    estimateCost,
    validateProfileAgainstGovernance,
    mergeWithDefaults
} from '@mxf/shared/constants/DefaultPhaseProfiles';
import {
    PhaseParameterProfile,
    OrparPhase,
    ParameterOverrideScope,
    ResetParameterScope,
    InferenceParameterResponse
} from '@mxf/shared/types/InferenceParameterTypes';
import { LlmProviderType } from '@mxf/shared/protocols/mcp/LlmProviders';

describe('InferenceParameterTools', () => {
    describe('DEFAULT_PHASE_PROFILES', () => {
        it('should have profiles for all ORPAR phases', () => {
            expect(DEFAULT_PHASE_PROFILES.observation).toBeDefined();
            expect(DEFAULT_PHASE_PROFILES.reasoning).toBeDefined();
            expect(DEFAULT_PHASE_PROFILES.planning).toBeDefined();
            expect(DEFAULT_PHASE_PROFILES.action).toBeDefined();
            expect(DEFAULT_PHASE_PROFILES.reflection).toBeDefined();
        });

        it('should have valid temperature ranges for all profiles', () => {
            const phases: OrparPhase[] = ['observation', 'reasoning', 'planning', 'action', 'reflection'];
            for (const phase of phases) {
                const profile = DEFAULT_PHASE_PROFILES[phase];
                expect(profile.temperature).toBeGreaterThanOrEqual(0);
                expect(profile.temperature).toBeLessThanOrEqual(2);
            }
        });

        it('should have observation profile optimized for low temperature', () => {
            expect(OBSERVATION_PROFILE.temperature).toBeLessThanOrEqual(0.3);
            expect(OBSERVATION_PROFILE.reasoningTokens).toBe(0);
        });

        it('should have reasoning profile with extended thinking budget', () => {
            expect(REASONING_PROFILE.reasoningTokens).toBeGreaterThan(0);
            expect(REASONING_PROFILE.temperature).toBeGreaterThanOrEqual(0.4);
            expect(REASONING_PROFILE.temperature).toBeLessThanOrEqual(0.6);
        });

        it('should have action profile optimized for determinism', () => {
            expect(ACTION_PROFILE.temperature).toBeLessThanOrEqual(0.2);
            expect(ACTION_PROFILE.reasoningTokens).toBe(0);
        });

        it('should have reflection profile with evaluative settings', () => {
            expect(REFLECTION_PROFILE.reasoningTokens).toBeGreaterThan(0);
            expect(REFLECTION_PROFILE.temperature).toBeGreaterThanOrEqual(0.3);
        });
    });

    describe('getPhaseProfile', () => {
        it('should return correct profile for OpenRouter provider', () => {
            const profile = getPhaseProfile(LlmProviderType.OPENROUTER, 'observation');
            expect(profile.model).toBe('google/gemini-2.5-flash');
        });

        it('should return correct profile for Anthropic provider', () => {
            const profile = getPhaseProfile(LlmProviderType.ANTHROPIC, 'reasoning');
            expect(profile.model).toContain('claude');
        });

        it('should return fallback for unknown provider', () => {
            // Should fall back to default profiles
            const profile = getPhaseProfile('unknown' as LlmProviderType, 'observation');
            expect(profile).toBeDefined();
            expect(profile.model).toBeDefined();
        });
    });

    describe('estimateCost', () => {
        it('should calculate cost for known model', () => {
            const cost = estimateCost('google/gemini-2.5-flash', 1000, 500, 0);
            expect(cost).toBeGreaterThan(0);
            expect(cost).toBeLessThan(0.01); // Ultra-cheap model
        });

        it('should include reasoning token cost when applicable', () => {
            const costWithoutReasoning = estimateCost('anthropic/claude-sonnet-4-5', 1000, 500, 0);
            const costWithReasoning = estimateCost('anthropic/claude-sonnet-4-5', 1000, 500, 2000);
            expect(costWithReasoning).toBeGreaterThan(costWithoutReasoning);
        });

        it('should return default cost for unknown model', () => {
            const cost = estimateCost('unknown/model', 1000, 500, 0);
            expect(cost).toBeGreaterThan(0);
        });
    });

    describe('validateProfileAgainstGovernance', () => {
        it('should validate profile that meets all constraints', () => {
            const profile: PhaseParameterProfile = {
                model: 'google/gemini-2.5-flash',
                temperature: 0.5,
                reasoningTokens: 1000,
                maxOutputTokens: 2000
            };

            const result = validateProfileAgainstGovernance(profile, DEFAULT_GOVERNANCE_CONFIG);
            expect(result.valid).toBe(true);
            expect(result.violations).toHaveLength(0);
        });

        it('should detect temperature violation', () => {
            const profile: PhaseParameterProfile = {
                model: 'test-model',
                temperature: 3.0, // Exceeds max of 2.0
                reasoningTokens: 0,
                maxOutputTokens: 2000
            };

            const governance = { ...DEFAULT_GOVERNANCE_CONFIG, maxTemperature: 2.0 };
            const result = validateProfileAgainstGovernance(profile, governance);
            expect(result.valid).toBe(false);
            expect(result.violations.some(v => v.includes('Temperature'))).toBe(true);
        });

        it('should detect model not in allowed list', () => {
            const profile: PhaseParameterProfile = {
                model: 'unauthorized/model',
                temperature: 0.5,
                reasoningTokens: 0,
                maxOutputTokens: 2000
            };

            const governance = {
                ...DEFAULT_GOVERNANCE_CONFIG,
                allowedModels: ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4-5']
            };

            const result = validateProfileAgainstGovernance(profile, governance);
            expect(result.valid).toBe(false);
            expect(result.violations.some(v => v.includes('not in allowed'))).toBe(true);
        });

        it('should detect reasoning tokens exceeding limit', () => {
            const profile: PhaseParameterProfile = {
                model: 'test-model',
                temperature: 0.5,
                reasoningTokens: 20000, // Exceeds default max
                maxOutputTokens: 2000
            };

            const governance = { ...DEFAULT_GOVERNANCE_CONFIG, maxReasoningTokens: 16000 };
            const result = validateProfileAgainstGovernance(profile, governance);
            expect(result.valid).toBe(false);
            expect(result.violations.some(v => v.includes('Reasoning tokens'))).toBe(true);
        });
    });

    describe('mergeWithDefaults', () => {
        it('should use partial values over defaults', () => {
            const partial = { temperature: 0.8 };
            const defaults: PhaseParameterProfile = OBSERVATION_PROFILE;

            const result = mergeWithDefaults(partial, defaults);
            expect(result.temperature).toBe(0.8);
            expect(result.model).toBe(defaults.model);
            expect(result.maxOutputTokens).toBe(defaults.maxOutputTokens);
        });

        it('should preserve all partial values', () => {
            const partial: Partial<PhaseParameterProfile> = {
                model: 'custom/model',
                temperature: 0.9,
                reasoningTokens: 5000
            };
            const defaults: PhaseParameterProfile = OBSERVATION_PROFILE;

            const result = mergeWithDefaults(partial, defaults);
            expect(result.model).toBe('custom/model');
            expect(result.temperature).toBe(0.9);
            expect(result.reasoningTokens).toBe(5000);
            expect(result.maxOutputTokens).toBe(defaults.maxOutputTokens);
        });

        it('should handle empty partial', () => {
            const result = mergeWithDefaults({}, OBSERVATION_PROFILE);
            expect(result).toEqual(OBSERVATION_PROFILE);
        });
    });

    describe('requestInferenceParamsTool', () => {
        it('should have correct tool name', () => {
            expect(requestInferenceParamsTool.name).toBe('request_inference_params');
        });

        it('should require reason in input schema', () => {
            const required = requestInferenceParamsTool.inputSchema.required;
            expect(required).toContain('reason');
        });

        it('should support all scope values', () => {
            const scopeEnum = requestInferenceParamsTool.inputSchema.properties.scope.enum;
            expect(scopeEnum).toContain('next_call');
            expect(scopeEnum).toContain('session');
            expect(scopeEnum).toContain('task');
            expect(scopeEnum).toContain('current_phase');
        });
    });

    describe('getCurrentParamsTool', () => {
        it('should have correct tool name', () => {
            expect(getCurrentParamsTool.name).toBe('get_current_params');
        });

        it('should require phase in input schema', () => {
            const required = getCurrentParamsTool.inputSchema.required;
            expect(required).toContain('phase');
        });

        it('should support all ORPAR phases', () => {
            const phaseEnum = getCurrentParamsTool.inputSchema.properties.phase.enum;
            expect(phaseEnum).toContain('observation');
            expect(phaseEnum).toContain('reasoning');
            expect(phaseEnum).toContain('planning');
            expect(phaseEnum).toContain('action');
            expect(phaseEnum).toContain('reflection');
        });
    });

    describe('getParameterStatusTool', () => {
        it('should have correct tool name', () => {
            expect(getParameterStatusTool.name).toBe('get_parameter_status');
        });

        it('should not require any input', () => {
            const required = getParameterStatusTool.inputSchema.required;
            expect(required).toHaveLength(0);
        });
    });

    describe('getAvailableModelsTool', () => {
        it('should have correct tool name', () => {
            expect(getAvailableModelsTool.name).toBe('get_available_models');
        });

        it('should support tier filtering', () => {
            const tierEnum = getAvailableModelsTool.inputSchema.properties.tier.enum;
            expect(tierEnum).toContain('ultra_cheap');
            expect(tierEnum).toContain('budget');
            expect(tierEnum).toContain('standard');
            expect(tierEnum).toContain('premium');
            expect(tierEnum).toContain('ultra_premium');
            expect(tierEnum).toContain('all');
        });
    });

    describe('resetInferenceParamsTool', () => {
        it('should have correct tool name', () => {
            expect(resetInferenceParamsTool.name).toBe('reset_inference_params');
        });

        it('should support all reset scope values', () => {
            const scopeEnum = resetInferenceParamsTool.inputSchema.properties.scope.enum;
            expect(scopeEnum).toContain('all');
            expect(scopeEnum).toContain('session');
            expect(scopeEnum).toContain('task');
        });

        it('should have optional taskId parameter', () => {
            const properties = resetInferenceParamsTool.inputSchema.properties;
            expect(properties.taskId).toBeDefined();
            expect(properties.taskId.type).toBe('string');
        });

        it('should not require any mandatory input', () => {
            // The inputSchema has no required property since all inputs are optional
            expect((resetInferenceParamsTool.inputSchema as any).required).toBeUndefined();
        });
    });
});

describe('Phase Profile Recommendations', () => {
    describe('Observation Phase', () => {
        it('should recommend fast, low-cost model', () => {
            const profile = DEFAULT_PHASE_PROFILES.observation;
            // Flash/mini models are typically cheap
            expect(profile.model).toMatch(/flash|mini|nano|haiku/i);
        });

        it('should use low temperature for accuracy', () => {
            const profile = DEFAULT_PHASE_PROFILES.observation;
            expect(profile.temperature).toBeLessThanOrEqual(0.3);
        });
    });

    describe('Reasoning Phase', () => {
        it('should use capable model', () => {
            const profile = DEFAULT_PHASE_PROFILES.reasoning;
            // Sonnet/GPT-4 class models are capable
            expect(profile.model).toMatch(/sonnet|opus|pro|gpt-4/i);
        });

        it('should have extended reasoning budget', () => {
            const profile = DEFAULT_PHASE_PROFILES.reasoning;
            expect(profile.reasoningTokens).toBeGreaterThanOrEqual(4000);
        });
    });

    describe('Planning Phase', () => {
        it('should use structured output model', () => {
            const profile = DEFAULT_PHASE_PROFILES.planning;
            expect(profile.model).toBeDefined();
        });

        it('should use moderate temperature for consistency', () => {
            const profile = DEFAULT_PHASE_PROFILES.planning;
            expect(profile.temperature).toBeLessThanOrEqual(0.4);
        });
    });

    describe('Action Phase', () => {
        it('should be optimized for tool calling', () => {
            const profile = DEFAULT_PHASE_PROFILES.action;
            expect(profile.reasoningTokens).toBe(0);
        });

        it('should use very low temperature for precision', () => {
            const profile = DEFAULT_PHASE_PROFILES.action;
            expect(profile.temperature).toBeLessThanOrEqual(0.2);
        });
    });

    describe('Reflection Phase', () => {
        it('should have evaluative capacity', () => {
            const profile = DEFAULT_PHASE_PROFILES.reflection;
            expect(profile.reasoningTokens).toBeGreaterThan(0);
        });

        it('should use moderate temperature for balanced assessment', () => {
            const profile = DEFAULT_PHASE_PROFILES.reflection;
            expect(profile.temperature).toBeGreaterThanOrEqual(0.3);
            expect(profile.temperature).toBeLessThanOrEqual(0.5);
        });
    });
});

describe('STANDARD_AGENT_DEFAULT Profile', () => {
    it('should have all required fields', () => {
        expect(STANDARD_AGENT_DEFAULT.model).toBeDefined();
        expect(STANDARD_AGENT_DEFAULT.temperature).toBeDefined();
        expect(STANDARD_AGENT_DEFAULT.reasoningTokens).toBeDefined();
        expect(STANDARD_AGENT_DEFAULT.maxOutputTokens).toBeDefined();
    });

    it('should have balanced settings for general-purpose use', () => {
        // Temperature should be moderate for versatility
        expect(STANDARD_AGENT_DEFAULT.temperature).toBeGreaterThanOrEqual(0.5);
        expect(STANDARD_AGENT_DEFAULT.temperature).toBeLessThanOrEqual(0.9);
    });

    it('should have reasonable token budgets', () => {
        expect(STANDARD_AGENT_DEFAULT.reasoningTokens).toBeGreaterThan(0);
        expect(STANDARD_AGENT_DEFAULT.maxOutputTokens).toBeGreaterThanOrEqual(2000);
    });

    it('should use a capable model', () => {
        expect(STANDARD_AGENT_DEFAULT.model).toBeDefined();
        expect(typeof STANDARD_AGENT_DEFAULT.model).toBe('string');
        expect(STANDARD_AGENT_DEFAULT.model.length).toBeGreaterThan(0);
    });
});

describe('Scope Types', () => {
    describe('ParameterOverrideScope', () => {
        it('should include all v1.1 scope values', () => {
            const validScopes: ParameterOverrideScope[] = ['next_call', 'session', 'task', 'current_phase'];
            expect(validScopes).toHaveLength(4);

            // Type assertion - these should compile
            const scope1: ParameterOverrideScope = 'next_call';
            const scope2: ParameterOverrideScope = 'session';
            const scope3: ParameterOverrideScope = 'task';
            const scope4: ParameterOverrideScope = 'current_phase';

            expect([scope1, scope2, scope3, scope4]).toEqual(validScopes);
        });
    });

    describe('ResetParameterScope', () => {
        it('should include all reset scope values', () => {
            const validResetScopes: ResetParameterScope[] = ['all', 'session', 'task'];
            expect(validResetScopes).toHaveLength(3);

            // Type assertion - these should compile
            const reset1: ResetParameterScope = 'all';
            const reset2: ResetParameterScope = 'session';
            const reset3: ResetParameterScope = 'task';

            expect([reset1, reset2, reset3]).toEqual(validResetScopes);
        });
    });
});

describe('InferenceParameterResponse', () => {
    it('should support previousParams field', () => {
        const response: InferenceParameterResponse = {
            status: 'approved',
            activeParams: {
                model: 'test-model',
                temperature: 0.7,
                reasoningTokens: 4000,
                maxOutputTokens: 4000
            },
            previousParams: {
                model: 'old-model',
                temperature: 0.5,
                reasoningTokens: 2000,
                maxOutputTokens: 2000
            }
        };

        expect(response.previousParams).toBeDefined();
        expect(response.previousParams?.model).toBe('old-model');
        expect(response.previousParams?.temperature).toBe(0.5);
    });

    it('should allow previousParams to be undefined', () => {
        const response: InferenceParameterResponse = {
            status: 'approved',
            activeParams: {
                model: 'test-model',
                temperature: 0.7,
                reasoningTokens: 4000,
                maxOutputTokens: 4000
            }
        };

        expect(response.previousParams).toBeUndefined();
    });
});

describe('Governance Configuration', () => {
    describe('DEFAULT_GOVERNANCE_CONFIG', () => {
        it('should have reasonable cost limits', () => {
            expect(DEFAULT_GOVERNANCE_CONFIG.maxCostPerCall).toBeGreaterThan(0);
            expect(DEFAULT_GOVERNANCE_CONFIG.maxCostPerTask).toBeGreaterThan(DEFAULT_GOVERNANCE_CONFIG.maxCostPerCall!);
        });

        it('should have rate limits', () => {
            expect(DEFAULT_GOVERNANCE_CONFIG.maxRequestsPerPhase).toBeGreaterThan(0);
            expect(DEFAULT_GOVERNANCE_CONFIG.maxRequestsPerTask).toBeGreaterThan(DEFAULT_GOVERNANCE_CONFIG.maxRequestsPerPhase!);
        });

        it('should allow temperature range 0-2', () => {
            expect(DEFAULT_GOVERNANCE_CONFIG.minTemperature).toBe(0.0);
            expect(DEFAULT_GOVERNANCE_CONFIG.maxTemperature).toBe(2.0);
        });

        it('should have output token limits', () => {
            expect(DEFAULT_GOVERNANCE_CONFIG.maxOutputTokens).toBeGreaterThan(0);
            expect(DEFAULT_GOVERNANCE_CONFIG.maxReasoningTokens).toBeGreaterThan(0);
        });
    });
});
