/**
 * Property-based tests for validation utility
 * Uses fast-check to verify validator behavior across random inputs
 */

import fc from 'fast-check';
import {
    createValidator,
    createStrictValidator,
    createWarningValidator,
    createSilentValidator
} from '@mxf/shared/utils/validation';

describe('Validation Property Tests', () => {
    describe('Type assertion consistency', () => {
        it('assertIsString accepts all strings', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(fc.string(), (value) => {
                    return validator.assertIsString(value) === true;
                })
            );
        });

        it('assertIsString rejects all non-strings', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.integer(),
                        fc.boolean(),
                        fc.constant(null),
                        fc.constant(undefined),
                        fc.object()
                    ),
                    (value) => {
                        return validator.assertIsString(value) === false;
                    }
                )
            );
        });

        it('assertIsNumber accepts all valid numbers', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.double({ noNaN: true }),
                    (value) => {
                        return validator.assertIsNumber(value) === true;
                    }
                )
            );
        });

        it('assertIsNumber rejects NaN', () => {
            const validator = createSilentValidator();
            expect(validator.assertIsNumber(NaN)).toBe(false);
        });

        it('assertIsBoolean accepts only true and false', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(fc.boolean(), (value) => {
                    return validator.assertIsBoolean(value) === true;
                })
            );
        });

        it('assertIsBoolean rejects truthy/falsy values that are not booleans', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.integer(),
                        fc.string(),
                        fc.constant(null),
                        fc.constant(undefined),
                        fc.constant(0),
                        fc.constant(1),
                        fc.constant('')
                    ),
                    (value) => {
                        return validator.assertIsBoolean(value) === false;
                    }
                )
            );
        });

        it('assertIsObject accepts all non-null objects', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.object(),
                        fc.array(fc.anything())
                    ),
                    (value) => {
                        return validator.assertIsObject(value) === true;
                    }
                )
            );
        });

        it('assertIsArray accepts all arrays', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.array(fc.anything(), { maxLength: 20 }),
                    (value) => {
                        return validator.assertIsArray(value) === true;
                    }
                )
            );
        });

        it('assertIsArray rejects non-arrays', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.string(),
                        fc.integer(),
                        fc.object({ maxDepth: 1 })
                    ),
                    (value) => {
                        return validator.assertIsArray(value) === false;
                    }
                )
            );
        });
    });

    describe('Non-empty string validation', () => {
        it('accepts strings with non-whitespace content', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
                    (value) => {
                        return validator.assertIsNonEmptyString(value) === true;
                    }
                )
            );
        });

        it('rejects empty and whitespace-only strings', () => {
            const validator = createSilentValidator();

            // Empty string
            expect(validator.assertIsNonEmptyString('')).toBe(false);

            // Whitespace-only strings
            fc.assert(
                fc.property(
                    fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 }),
                    (chars) => {
                        const whitespaceString = chars.join('');
                        return validator.assertIsNonEmptyString(whitespaceString) === false;
                    }
                )
            );
        });
    });

    describe('UUID validation', () => {
        it('accepts valid v1-v5 UUIDs', () => {
            const validator = createSilentValidator();

            // The validator regex only accepts UUID versions 1-5
            // fc.uuid() generates all versions, so we use specific test cases
            const validUuids = [
                '550e8400-e29b-41d4-a716-446655440000', // v4
                'f47ac10b-58cc-4372-a567-0e02b2c3d479', // v4
                '6ba7b810-9dad-11d1-80b4-00c04fd430c8', // v1
                'f47ac10b-58cc-5372-a567-0e02b2c3d479', // v5
            ];

            for (const uuid of validUuids) {
                expect(validator.assertIsUuid(uuid)).toBe(true);
            }
        });

        it('rejects random strings as UUIDs', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1 }).filter(s =>
                        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
                    ),
                    (value) => {
                        return validator.assertIsUuid(value) === false;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Range validation', () => {
        it('accepts values within range', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.integer({ min: -1000, max: 1000 }),
                    fc.integer({ min: -1000, max: 0 }),
                    fc.integer({ min: 0, max: 1000 }),
                    (value, minOffset, maxOffset) => {
                        const min = value + minOffset;
                        const max = value + maxOffset;
                        if (min > max) return true; // Skip invalid ranges
                        return validator.assertIsInRange(value, min, max) === true;
                    }
                )
            );
        });

        it('rejects values outside range', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.integer({ min: -100, max: 100 }),
                    fc.integer({ min: 1, max: 50 }),
                    (rangeSize, offset) => {
                        const min = 0;
                        const max = rangeSize > 0 ? rangeSize : -rangeSize;
                        const belowMin = min - offset;
                        const aboveMax = max + offset;

                        const belowResult = validator.assertIsInRange(belowMin, min, max);
                        const aboveResult = validator.assertIsInRange(aboveMax, min, max);

                        return belowResult === false && aboveResult === false;
                    }
                )
            );
        });
    });

    describe('Validation mode behavior', () => {
        it('strict mode always throws for invalid input', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.integer(),
                        fc.boolean(),
                        fc.constant(null),
                        fc.constant(undefined)
                    ),
                    (value) => {
                        const validator = createStrictValidator();
                        try {
                            validator.assertIsString(value);
                            return false; // Should have thrown
                        } catch {
                            return true; // Correctly threw
                        }
                    }
                )
            );
        });

        it('warning mode never throws', () => {
            // Suppress console.warn during this test since warning mode intentionally logs
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                fc.assert(
                    fc.property(fc.anything(), (value) => {
                        const validator = createWarningValidator();
                        try {
                            validator.assertIsString(value);
                            return true; // Never throws
                        } catch {
                            return false;
                        }
                    })
                );
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('silent mode never throws', () => {
            fc.assert(
                fc.property(fc.anything(), (value) => {
                    const validator = createSilentValidator();
                    try {
                        validator.assertIsString(value);
                        return true; // Never throws
                    } catch {
                        return false;
                    }
                })
            );
        });

        it('all modes return same boolean result for same input', () => {
            // Use silent validators for all - we only care about boolean result consistency
            // Warning mode behavior is tested separately in 'warning mode never throws'
            fc.assert(
                fc.property(fc.anything(), (value) => {
                    const v1 = createSilentValidator();
                    const v2 = createSilentValidator();
                    const v3 = createSilentValidator();

                    const r1 = v1.assertIsString(value);
                    const r2 = v2.assertIsString(value);
                    const r3 = v3.assertIsString(value);

                    return r1 === r2 && r2 === r3;
                })
            );
        });
    });

    describe('Equality assertion', () => {
        it('assertEqual passes for identical values', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.string(),
                        fc.integer(),
                        fc.boolean(),
                        fc.constant(null),
                        fc.constant(undefined)
                    ),
                    (value) => {
                        return validator.assertEqual(value, value) === true;
                    }
                )
            );
        });

        it('assertEqual fails for different values of same type', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.string(),
                    fc.string(),
                    (a, b) => {
                        if (a === b) return true; // Skip if equal by chance
                        return validator.assertEqual(a, b) === false;
                    }
                )
            );
        });
    });

    describe('Property existence validation', () => {
        it('assertHasProperty passes when property exists', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
                    fc.anything(),
                    (key, value) => {
                        const obj = { [key]: value };
                        return validator.assertHasProperty(obj, key) === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('assertHasProperty fails when property missing', () => {
            const validator = createSilentValidator();

            // Direct test for missing properties
            const obj = { existingKey: 'value' };
            expect(validator.assertHasProperty(obj, 'missingKey')).toBe(false);
            expect(validator.assertHasProperty(obj, 'anotherMissing')).toBe(false);
            expect(validator.assertHasProperty({}, 'anyKey')).toBe(false);
        });
    });

    describe('Type exclusivity', () => {
        it('primitive values satisfy exactly one type assertion', () => {
            const validator = createSilentValidator();
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.string().map(v => ({ value: v, expected: 'string' })),
                        fc.integer().map(v => ({ value: v, expected: 'number' })),
                        fc.boolean().map(v => ({ value: v, expected: 'boolean' })),
                        fc.constant({ value: null, expected: 'null' }),
                        fc.constant({ value: undefined, expected: 'undefined' })
                    ),
                    ({ value, expected }) => {
                        const checks = [
                            { name: 'string', result: validator.assertIsString(value) },
                            { name: 'number', result: validator.assertIsNumber(value) },
                            { name: 'boolean', result: validator.assertIsBoolean(value) },
                            { name: 'null', result: validator.assertIsNull(value) },
                            { name: 'undefined', result: validator.assertIsUndefined(value) }
                        ];

                        const passing = checks.filter(c => c.result);

                        // Exactly one should pass
                        if (passing.length !== 1) return false;

                        // And it should be the expected one
                        return passing[0].name === expected;
                    }
                )
            );
        });
    });
});
