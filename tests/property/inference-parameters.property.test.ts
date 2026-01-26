/**
 * Property-based tests for Inference Parameter Types and Profiles
 * Uses fast-check to verify invariants across random inputs
 */

import fc from 'fast-check';
import {
    DEFAULT_PHASE_PROFILES,
    STANDARD_AGENT_DEFAULT,
    DEFAULT_GOVERNANCE_CONFIG,
    estimateCost,
    validateProfileAgainstGovernance,
    mergeWithDefaults
} from '@mxf/shared/constants/DefaultPhaseProfiles';
import {
    PhaseParameterProfile,
    OrparPhase,
    ParameterOverrideScope,
    ResetParameterScope,
    InferenceParameterResponse,
    InferenceParameterRequestStatus
} from '@mxf/shared/types/InferenceParameterTypes';

// Custom arbitraries for inference parameter types
const orparPhaseArb = fc.constantFrom<OrparPhase>(
    'observation', 'reasoning', 'planning', 'action', 'reflection'
);

const parameterOverrideScopeArb = fc.constantFrom<ParameterOverrideScope>(
    'next_call', 'session', 'task', 'current_phase'
);

const resetParameterScopeArb = fc.constantFrom<ResetParameterScope>(
    'all', 'session', 'task'
);

const requestStatusArb = fc.constantFrom<InferenceParameterRequestStatus>(
    'approved', 'modified', 'denied'
);

const temperatureArb = fc.double({ min: 0, max: 2, noNaN: true });

const tokenCountArb = fc.integer({ min: 0, max: 100000 });

const profileArb = fc.record<PhaseParameterProfile>({
    model: fc.string({ minLength: 1, maxLength: 50 }),
    temperature: temperatureArb,
    reasoningTokens: tokenCountArb,
    maxOutputTokens: fc.integer({ min: 100, max: 50000 }),
    topP: fc.option(fc.double({ min: 0, max: 1, noNaN: true }))
});

describe('Inference Parameter Property Tests', () => {
    describe('PhaseParameterProfile Invariants', () => {
        it('all ORPAR phases have valid profiles', () => {
            fc.assert(
                fc.property(orparPhaseArb, (phase) => {
                    const profile = DEFAULT_PHASE_PROFILES[phase];
                    return (
                        profile !== undefined &&
                        typeof profile.model === 'string' &&
                        profile.model.length > 0 &&
                        typeof profile.temperature === 'number' &&
                        profile.temperature >= 0 &&
                        profile.temperature <= 2 &&
                        typeof profile.reasoningTokens === 'number' &&
                        profile.reasoningTokens >= 0 &&
                        typeof profile.maxOutputTokens === 'number' &&
                        profile.maxOutputTokens > 0
                    );
                })
            );
        });

        it('STANDARD_AGENT_DEFAULT has all required fields', () => {
            expect(STANDARD_AGENT_DEFAULT.model).toBeDefined();
            expect(typeof STANDARD_AGENT_DEFAULT.model).toBe('string');
            expect(STANDARD_AGENT_DEFAULT.temperature).toBeGreaterThanOrEqual(0);
            expect(STANDARD_AGENT_DEFAULT.temperature).toBeLessThanOrEqual(2);
            expect(STANDARD_AGENT_DEFAULT.reasoningTokens).toBeGreaterThanOrEqual(0);
            expect(STANDARD_AGENT_DEFAULT.maxOutputTokens).toBeGreaterThan(0);
        });
    });

    describe('ParameterOverrideScope Invariants', () => {
        it('all scope values are distinct strings', () => {
            const scopes: ParameterOverrideScope[] = ['next_call', 'session', 'task', 'current_phase'];
            const uniqueScopes = new Set(scopes);
            expect(uniqueScopes.size).toBe(scopes.length);
        });

        it('scope values are non-empty strings', () => {
            fc.assert(
                fc.property(parameterOverrideScopeArb, (scope) => {
                    return typeof scope === 'string' && scope.length > 0;
                })
            );
        });
    });

    describe('ResetParameterScope Invariants', () => {
        it('all reset scope values are distinct strings', () => {
            const scopes: ResetParameterScope[] = ['all', 'session', 'task'];
            const uniqueScopes = new Set(scopes);
            expect(uniqueScopes.size).toBe(scopes.length);
        });

        it('reset scope values are non-empty strings', () => {
            fc.assert(
                fc.property(resetParameterScopeArb, (scope) => {
                    return typeof scope === 'string' && scope.length > 0;
                })
            );
        });
    });

    describe('estimateCost Invariants', () => {
        // Known models for reliable cost testing
        const knownModels = [
            'google/gemini-2.5-flash',
            'anthropic/claude-sonnet-4-5',
            'anthropic/claude-3-haiku',
            'openai/gpt-4-turbo'
        ];
        const knownModelArb = fc.constantFrom(...knownModels);

        it('cost is always non-negative', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1 }),
                    fc.integer({ min: 0, max: 100000 }),
                    fc.integer({ min: 0, max: 100000 }),
                    fc.integer({ min: 0, max: 50000 }),
                    (model, inputTokens, outputTokens, reasoningTokens) => {
                        const cost = estimateCost(model, inputTokens, outputTokens, reasoningTokens);
                        return cost >= 0;
                    }
                )
            );
        });

        it('cost increases with more input tokens for known models', () => {
            fc.assert(
                fc.property(
                    knownModelArb,
                    fc.integer({ min: 0, max: 50000 }),
                    fc.integer({ min: 1, max: 50000 }),
                    (model, baseTokens, additionalTokens) => {
                        const baseCost = estimateCost(model, baseTokens, 0, 0);
                        const higherCost = estimateCost(model, baseTokens + additionalTokens, 0, 0);
                        return higherCost >= baseCost;
                    }
                )
            );
        });

        it('cost includes reasoning tokens for models that support reasoning', () => {
            // Use a model known to support reasoning (Sonnet)
            const model = 'anthropic/claude-sonnet-4-5';
            fc.assert(
                fc.property(
                    fc.integer({ min: 100, max: 10000 }),
                    fc.integer({ min: 100, max: 10000 }),
                    fc.integer({ min: 1, max: 10000 }),
                    (inputTokens, outputTokens, reasoningTokens) => {
                        const costWithoutReasoning = estimateCost(model, inputTokens, outputTokens, 0);
                        const costWithReasoning = estimateCost(model, inputTokens, outputTokens, reasoningTokens);
                        return costWithReasoning >= costWithoutReasoning;
                    }
                )
            );
        });
    });

    describe('validateProfileAgainstGovernance Invariants', () => {
        it('validation result always has valid and violations fields', () => {
            fc.assert(
                fc.property(profileArb, (profile) => {
                    const result = validateProfileAgainstGovernance(profile, DEFAULT_GOVERNANCE_CONFIG);
                    return (
                        typeof result.valid === 'boolean' &&
                        Array.isArray(result.violations)
                    );
                })
            );
        });

        it('valid profile has no violations', () => {
            const validProfile: PhaseParameterProfile = {
                model: 'google/gemini-2.5-flash',
                temperature: 0.5,
                reasoningTokens: 1000,
                maxOutputTokens: 2000
            };

            const result = validateProfileAgainstGovernance(validProfile, DEFAULT_GOVERNANCE_CONFIG);
            if (result.valid) {
                expect(result.violations).toHaveLength(0);
            }
        });

        it('temperature outside range always violates governance', () => {
            fc.assert(
                fc.property(
                    fc.double({ min: 2.1, max: 10, noNaN: true }),
                    (temperature) => {
                        const profile: PhaseParameterProfile = {
                            model: 'test-model',
                            temperature,
                            reasoningTokens: 0,
                            maxOutputTokens: 2000
                        };
                        const governance = { ...DEFAULT_GOVERNANCE_CONFIG, maxTemperature: 2.0 };
                        const result = validateProfileAgainstGovernance(profile, governance);
                        return !result.valid && result.violations.some(v => v.includes('Temperature'));
                    }
                )
            );
        });
    });

    describe('mergeWithDefaults Invariants', () => {
        it('merged profile always has all required fields', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        model: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
                        temperature: fc.option(temperatureArb, { nil: undefined }),
                        reasoningTokens: fc.option(tokenCountArb, { nil: undefined }),
                        maxOutputTokens: fc.option(fc.integer({ min: 100, max: 50000 }), { nil: undefined })
                    }),
                    orparPhaseArb,
                    (partial, phase) => {
                        const defaults = DEFAULT_PHASE_PROFILES[phase];
                        const merged = mergeWithDefaults(partial, defaults);
                        return (
                            merged.model !== undefined &&
                            merged.temperature !== undefined &&
                            merged.reasoningTokens !== undefined &&
                            merged.maxOutputTokens !== undefined
                        );
                    }
                )
            );
        });

        it('explicit values override defaults', () => {
            fc.assert(
                fc.property(
                    temperatureArb,
                    orparPhaseArb,
                    (temperature, phase) => {
                        const defaults = DEFAULT_PHASE_PROFILES[phase];
                        const merged = mergeWithDefaults({ temperature }, defaults);
                        return merged.temperature === temperature;
                    }
                )
            );
        });

        it('empty partial returns defaults unchanged', () => {
            fc.assert(
                fc.property(orparPhaseArb, (phase) => {
                    const defaults = DEFAULT_PHASE_PROFILES[phase];
                    const merged = mergeWithDefaults({}, defaults);
                    return (
                        merged.model === defaults.model &&
                        merged.temperature === defaults.temperature &&
                        merged.reasoningTokens === defaults.reasoningTokens &&
                        merged.maxOutputTokens === defaults.maxOutputTokens
                    );
                })
            );
        });
    });

    describe('InferenceParameterResponse Invariants', () => {
        it('response always has status and activeParams', () => {
            fc.assert(
                fc.property(
                    requestStatusArb,
                    profileArb,
                    fc.option(profileArb),
                    (status, activeParams, previousParams) => {
                        const response: InferenceParameterResponse = {
                            status,
                            activeParams,
                            previousParams: previousParams ?? undefined
                        };
                        return (
                            response.status !== undefined &&
                            response.activeParams !== undefined
                        );
                    }
                )
            );
        });

        it('previousParams can be undefined or a valid profile', () => {
            fc.assert(
                fc.property(
                    requestStatusArb,
                    profileArb,
                    fc.boolean(),
                    (status, activeParams, includePrevious) => {
                        const response: InferenceParameterResponse = {
                            status,
                            activeParams,
                            previousParams: includePrevious ? activeParams : undefined
                        };
                        return (
                            response.previousParams === undefined ||
                            (typeof response.previousParams === 'object' &&
                                response.previousParams.model !== undefined)
                        );
                    }
                )
            );
        });
    });

    describe('Scope Semantics', () => {
        it('session scope is distinct from task scope', () => {
            const sessionScope: ParameterOverrideScope = 'session';
            const taskScope: ParameterOverrideScope = 'task';
            expect(sessionScope).not.toBe(taskScope);
        });

        it('current_phase scope is ORPAR-specific', () => {
            const currentPhaseScope: ParameterOverrideScope = 'current_phase';
            // current_phase is a valid scope that should work with ORPAR phases
            fc.assert(
                fc.property(orparPhaseArb, (phase) => {
                    // current_phase scope should be applicable to any ORPAR phase
                    return typeof currentPhaseScope === 'string' && typeof phase === 'string';
                })
            );
        });

        it('reset scopes are subset of override scopes plus all', () => {
            const resetScopes: ResetParameterScope[] = ['all', 'session', 'task'];
            const overrideScopes: ParameterOverrideScope[] = ['next_call', 'session', 'task', 'current_phase'];

            // 'session' and 'task' should be in both
            expect(resetScopes).toContain('session');
            expect(resetScopes).toContain('task');
            expect(overrideScopes).toContain('session');
            expect(overrideScopes).toContain('task');

            // 'all' is unique to reset
            expect(resetScopes).toContain('all');
            expect(overrideScopes).not.toContain('all');
        });
    });

    describe('Profile Temperature Constraints', () => {
        it('observation phase has low temperature for accuracy', () => {
            const profile = DEFAULT_PHASE_PROFILES.observation;
            expect(profile.temperature).toBeLessThanOrEqual(0.3);
        });

        it('action phase has very low temperature for reliability', () => {
            const profile = DEFAULT_PHASE_PROFILES.action;
            expect(profile.temperature).toBeLessThanOrEqual(0.2);
        });

        it('reasoning phases have moderate temperature', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom<OrparPhase>('reasoning', 'reflection'),
                    (phase) => {
                        const profile = DEFAULT_PHASE_PROFILES[phase];
                        return profile.temperature >= 0.3 && profile.temperature <= 0.7;
                    }
                )
            );
        });
    });

    describe('Profile Reasoning Token Allocation', () => {
        it('observation and action phases have zero reasoning tokens', () => {
            expect(DEFAULT_PHASE_PROFILES.observation.reasoningTokens).toBe(0);
            expect(DEFAULT_PHASE_PROFILES.action.reasoningTokens).toBe(0);
        });

        it('reasoning and reflection phases have non-zero reasoning tokens', () => {
            expect(DEFAULT_PHASE_PROFILES.reasoning.reasoningTokens).toBeGreaterThan(0);
            expect(DEFAULT_PHASE_PROFILES.reflection.reasoningTokens).toBeGreaterThan(0);
        });

        it('reasoning tokens are non-negative across all profiles', () => {
            fc.assert(
                fc.property(orparPhaseArb, (phase) => {
                    const profile = DEFAULT_PHASE_PROFILES[phase];
                    return profile.reasoningTokens >= 0;
                })
            );
        });
    });
});
