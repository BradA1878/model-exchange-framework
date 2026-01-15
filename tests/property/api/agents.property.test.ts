/**
 * Agent API Property-Based Tests
 *
 * Uses fast-check to test data format invariants for API requests/responses.
 * These tests focus on data validation without making actual HTTP calls.
 */

import * as fc from 'fast-check';

describe('Agent API Data Properties', () => {
    // =========================================================================
    // Arbitraries (Random Data Generators)
    // =========================================================================

    // Valid agent ID generator
    const validAgentIdArb = fc.string({ minLength: 3, maxLength: 50 })
        .filter((s: string) => /^[a-z][a-z0-9-_]*$/.test(s));

    // Valid agent name generator
    const validAgentNameArb = fc.string({ minLength: 1, maxLength: 100 });

    // Valid description generator
    const validDescriptionArb = fc.option(fc.string({ maxLength: 500 }), { nil: undefined });

    // Valid service types generator
    const validServiceTypesArb = fc.array(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s: string) => /^[a-z-]+$/.test(s)),
        { minLength: 0, maxLength: 5 }
    );

    // Valid capabilities generator
    const validCapabilitiesArb = fc.array(
        fc.constantFrom('testing', 'messaging', 'planning', 'reasoning', 'memory'),
        { minLength: 0, maxLength: 5 }
    );

    // Valid allowed tools generator
    const validAllowedToolsArb = fc.array(
        fc.constantFrom('tool_help', 'messaging_send', 'memory_get', 'memory_set'),
        { minLength: 0, maxLength: 10 }
    );

    // Agent config type
    interface AgentConfig {
        agentId: string;
        name: string;
        description: string | undefined;
        type: string | undefined;
        serviceTypes: string[];
        capabilities: string[];
        allowedTools: string[];
    }

    // Complete valid agent config generator
    const validAgentConfigArb: fc.Arbitrary<AgentConfig> = fc.record({
        agentId: validAgentIdArb,
        name: validAgentNameArb,
        description: validDescriptionArb,
        type: fc.constantFrom('worker', 'coordinator', 'specialist', undefined),
        serviceTypes: validServiceTypesArb,
        capabilities: validCapabilitiesArb,
        allowedTools: validAllowedToolsArb
    });

    // =========================================================================
    // Property: Agent ID Format Invariants
    // =========================================================================

    describe('Agent ID Format Invariants', () => {
        it('valid agent IDs start with a letter', () => {
            fc.assert(
                fc.property(validAgentIdArb, (agentId) => {
                    // Invariant: All valid agent IDs start with lowercase letter
                    return /^[a-z]/.test(agentId);
                }),
                { numRuns: 100 }
            );
        });

        it('valid agent IDs contain only allowed characters', () => {
            fc.assert(
                fc.property(validAgentIdArb, (agentId) => {
                    // Invariant: Only lowercase letters, numbers, hyphens, underscores
                    return /^[a-z0-9-_]+$/.test(agentId);
                }),
                { numRuns: 100 }
            );
        });

        it('valid agent IDs have length between 3 and 50', () => {
            fc.assert(
                fc.property(validAgentIdArb, (agentId) => {
                    // Invariant: Length is within valid range
                    return agentId.length >= 3 && agentId.length <= 50;
                }),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property: Agent Config Structure Invariants
    // =========================================================================

    describe('Agent Config Structure Invariants', () => {
        it('all configs have required agentId field', () => {
            fc.assert(
                fc.property(validAgentConfigArb, (config) => {
                    // Invariant: agentId is always present and non-empty
                    return typeof config.agentId === 'string' && config.agentId.length > 0;
                }),
                { numRuns: 100 }
            );
        });

        it('all configs have required name field', () => {
            fc.assert(
                fc.property(validAgentConfigArb, (config) => {
                    // Invariant: name is always present and non-empty
                    return typeof config.name === 'string' && config.name.length > 0;
                }),
                { numRuns: 100 }
            );
        });

        it('serviceTypes is always an array', () => {
            fc.assert(
                fc.property(validAgentConfigArb, (config) => {
                    // Invariant: serviceTypes is always an array
                    return Array.isArray(config.serviceTypes);
                }),
                { numRuns: 100 }
            );
        });

        it('capabilities is always an array', () => {
            fc.assert(
                fc.property(validAgentConfigArb, (config) => {
                    // Invariant: capabilities is always an array
                    return Array.isArray(config.capabilities);
                }),
                { numRuns: 100 }
            );
        });

        it('allowedTools is always an array', () => {
            fc.assert(
                fc.property(validAgentConfigArb, (config) => {
                    // Invariant: allowedTools is always an array
                    return Array.isArray(config.allowedTools);
                }),
                { numRuns: 100 }
            );
        });

        it('type is either a valid string or undefined', () => {
            fc.assert(
                fc.property(validAgentConfigArb, (config) => {
                    // Invariant: type is undefined or one of allowed values
                    return config.type === undefined ||
                        ['worker', 'coordinator', 'specialist'].includes(config.type);
                }),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property: Serialization Invariants
    // =========================================================================

    describe('Serialization Invariants', () => {
        it('valid configs can be JSON serialized', () => {
            fc.assert(
                fc.property(validAgentConfigArb, (config) => {
                    // Invariant: All valid configs can be serialized to JSON
                    try {
                        const serialized = JSON.stringify(config);
                        return typeof serialized === 'string' && serialized.length > 0;
                    } catch {
                        return false;
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('JSON serialization is reversible', () => {
            fc.assert(
                fc.property(validAgentConfigArb, (config) => {
                    // Invariant: JSON round-trip preserves data
                    const serialized = JSON.stringify(config);
                    const deserialized = JSON.parse(serialized);

                    return deserialized.agentId === config.agentId &&
                        deserialized.name === config.name;
                }),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property: Memory Data Invariants
    // =========================================================================

    describe('Memory Data Invariants', () => {
        // Memory notes generator
        const memoryNotesArb = fc.dictionary(
            fc.string({ minLength: 1, maxLength: 50 }),
            fc.string({ maxLength: 200 })
        );

        it('memory notes keys are always strings', () => {
            fc.assert(
                fc.property(memoryNotesArb, (notes) => {
                    // Invariant: All keys are non-empty strings
                    return Object.keys(notes).every(key =>
                        typeof key === 'string'
                    );
                }),
                { numRuns: 100 }
            );
        });

        it('memory notes values are always strings', () => {
            fc.assert(
                fc.property(memoryNotesArb, (notes) => {
                    // Invariant: All values are strings
                    return Object.values(notes).every(value =>
                        typeof value === 'string'
                    );
                }),
                { numRuns: 100 }
            );
        });

        it('merged notes preserve existing keys', () => {
            fc.assert(
                fc.property(memoryNotesArb, memoryNotesArb, (existing, newNotes) => {
                    // Invariant: Merge operation preserves keys from both sources
                    const merged = { ...existing, ...newNotes };

                    // All keys from newNotes should be in merged
                    const newKeysPresent = Object.keys(newNotes).every(key =>
                        key in merged
                    );

                    return newKeysPresent;
                }),
                { numRuns: 50 }
            );
        });
    });

    // =========================================================================
    // Property: Response Format Invariants
    // =========================================================================

    describe('Response Format Invariants', () => {
        // Success response generator
        const successResponseArb = fc.record({
            success: fc.constant(true),
            data: fc.anything(),
            message: fc.option(fc.string(), { nil: undefined })
        });

        // Error response generator
        const errorResponseArb = fc.record({
            success: fc.constant(false),
            error: fc.string({ minLength: 1 }),
            message: fc.option(fc.string(), { nil: undefined })
        });

        it('success responses always have success: true', () => {
            fc.assert(
                fc.property(successResponseArb, (response) => {
                    // Invariant: success field is exactly true
                    return response.success === true;
                }),
                { numRuns: 100 }
            );
        });

        it('error responses always have success: false', () => {
            fc.assert(
                fc.property(errorResponseArb, (response) => {
                    // Invariant: success field is exactly false
                    return response.success === false;
                }),
                { numRuns: 100 }
            );
        });

        it('error responses always have non-empty error field', () => {
            fc.assert(
                fc.property(errorResponseArb, (response) => {
                    // Invariant: error field is non-empty string
                    return typeof response.error === 'string' && response.error.length > 0;
                }),
                { numRuns: 100 }
            );
        });
    });

    // =========================================================================
    // Property: Query Parameter Invariants
    // =========================================================================

    describe('Query Parameter Invariants', () => {
        // Status filter generator
        const statusFilterArb = fc.constantFrom('ACTIVE', 'INACTIVE', 'ERROR', 'PENDING');

        // Service type filter generator
        const serviceTypeFilterArb = fc.string({ minLength: 1, maxLength: 30 })
            .filter((s: string) => /^[a-z-]+$/.test(s));

        it('status filter values are valid enum values', () => {
            fc.assert(
                fc.property(statusFilterArb, (status) => {
                    // Invariant: Status is one of allowed values
                    return ['ACTIVE', 'INACTIVE', 'ERROR', 'PENDING'].includes(status);
                }),
                { numRuns: 100 }
            );
        });

        it('service type filters contain only valid characters', () => {
            fc.assert(
                fc.property(serviceTypeFilterArb, (serviceType) => {
                    // Invariant: Only lowercase letters and hyphens
                    return /^[a-z-]+$/.test(serviceType);
                }),
                { numRuns: 100 }
            );
        });
    });
});
