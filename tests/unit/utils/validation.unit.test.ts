/**
 * Unit tests for validation utility
 * Tests validator creation and all assertion methods
 */

import {
    createValidator,
    createStrictValidator,
    createWarningValidator,
    createSilentValidator,
    ValidationMode
} from '@mxf/shared/utils/validation';

describe('Validation Framework', () => {
    describe('createStrictValidator (hard mode)', () => {
        const validator = createStrictValidator('test');

        describe('assertIsString', () => {
            it('accepts valid strings', () => {
                expect(validator.assertIsString('hello')).toBe(true);
                expect(validator.assertIsString('')).toBe(true);
                expect(validator.assertIsString('  ')).toBe(true);
            });

            it('throws for non-strings', () => {
                expect(() => validator.assertIsString(123)).toThrow();
                expect(() => validator.assertIsString(null)).toThrow();
                expect(() => validator.assertIsString(undefined)).toThrow();
                expect(() => validator.assertIsString({})).toThrow();
                expect(() => validator.assertIsString([])).toThrow();
            });

            it('accepts custom error message', () => {
                expect(() => validator.assertIsString(123, 'Custom error'))
                    .toThrow('Custom error');
            });
        });

        describe('assertIsNonEmptyString', () => {
            it('accepts non-empty strings', () => {
                expect(validator.assertIsNonEmptyString('hello')).toBe(true);
                expect(validator.assertIsNonEmptyString('a')).toBe(true);
            });

            it('throws for empty strings', () => {
                expect(() => validator.assertIsNonEmptyString('')).toThrow();
            });

            it('throws for whitespace-only strings', () => {
                expect(() => validator.assertIsNonEmptyString('   ')).toThrow();
                expect(() => validator.assertIsNonEmptyString('\t\n')).toThrow();
            });

            it('throws for non-strings', () => {
                expect(() => validator.assertIsNonEmptyString(123)).toThrow();
                expect(() => validator.assertIsNonEmptyString(null)).toThrow();
            });
        });

        describe('assertIsNumber', () => {
            it('accepts valid numbers', () => {
                expect(validator.assertIsNumber(0)).toBe(true);
                expect(validator.assertIsNumber(-1)).toBe(true);
                expect(validator.assertIsNumber(3.14)).toBe(true);
                expect(validator.assertIsNumber(Number.MAX_VALUE)).toBe(true);
            });

            it('throws for NaN', () => {
                expect(() => validator.assertIsNumber(NaN)).toThrow();
            });

            it('throws for non-numbers', () => {
                expect(() => validator.assertIsNumber('123')).toThrow();
                expect(() => validator.assertIsNumber(null)).toThrow();
                expect(() => validator.assertIsNumber(undefined)).toThrow();
            });

            it('accepts Infinity (valid number type)', () => {
                // Infinity is typeof number and not NaN
                expect(validator.assertIsNumber(Infinity)).toBe(true);
                expect(validator.assertIsNumber(-Infinity)).toBe(true);
            });
        });

        describe('assertIsBoolean', () => {
            it('accepts true and false', () => {
                expect(validator.assertIsBoolean(true)).toBe(true);
                expect(validator.assertIsBoolean(false)).toBe(true);
            });

            it('throws for non-booleans', () => {
                expect(() => validator.assertIsBoolean(0)).toThrow();
                expect(() => validator.assertIsBoolean(1)).toThrow();
                expect(() => validator.assertIsBoolean('true')).toThrow();
                expect(() => validator.assertIsBoolean(null)).toThrow();
            });
        });

        describe('assertIsObject', () => {
            it('accepts objects', () => {
                expect(validator.assertIsObject({})).toBe(true);
                expect(validator.assertIsObject({ key: 'value' })).toBe(true);
                expect(validator.assertIsObject([])).toBe(true); // arrays are objects
            });

            it('throws for null', () => {
                expect(() => validator.assertIsObject(null)).toThrow();
            });

            it('throws for primitives', () => {
                expect(() => validator.assertIsObject('string')).toThrow();
                expect(() => validator.assertIsObject(123)).toThrow();
                expect(() => validator.assertIsObject(undefined)).toThrow();
            });
        });

        describe('assertIsArray', () => {
            it('accepts arrays', () => {
                expect(validator.assertIsArray([])).toBe(true);
                expect(validator.assertIsArray([1, 2, 3])).toBe(true);
                expect(validator.assertIsArray(['a', 'b'])).toBe(true);
            });

            it('throws for non-arrays', () => {
                expect(() => validator.assertIsArray({})).toThrow();
                expect(() => validator.assertIsArray('[]')).toThrow();
                expect(() => validator.assertIsArray(null)).toThrow();
            });
        });

        describe('assertIsNull', () => {
            it('accepts null', () => {
                expect(validator.assertIsNull(null)).toBe(true);
            });

            it('throws for non-null', () => {
                expect(() => validator.assertIsNull(undefined)).toThrow();
                expect(() => validator.assertIsNull('')).toThrow();
                expect(() => validator.assertIsNull(0)).toThrow();
            });
        });

        describe('assertIsUndefined', () => {
            it('accepts undefined', () => {
                expect(validator.assertIsUndefined(undefined)).toBe(true);
            });

            it('throws for defined values', () => {
                expect(() => validator.assertIsUndefined(null)).toThrow();
                expect(() => validator.assertIsUndefined('')).toThrow();
                expect(() => validator.assertIsUndefined(0)).toThrow();
            });
        });

        describe('assertIsFunction', () => {
            it('accepts functions', () => {
                expect(validator.assertIsFunction(() => {})).toBe(true);
                expect(validator.assertIsFunction(function() {})).toBe(true);
                expect(validator.assertIsFunction(Math.max)).toBe(true);
            });

            it('throws for non-functions', () => {
                expect(() => validator.assertIsFunction({})).toThrow();
                expect(() => validator.assertIsFunction(null)).toThrow();
            });
        });

        describe('assertIsUuid', () => {
            it('accepts valid UUIDs', () => {
                const validUuids = [
                    '550e8400-e29b-41d4-a716-446655440000',
                    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                    '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
                ];

                for (const uuid of validUuids) {
                    expect(validator.assertIsUuid(uuid)).toBe(true);
                }
            });

            it('throws for invalid UUIDs', () => {
                const invalidUuids = [
                    'not-a-uuid',
                    '550e8400-e29b-41d4-a716',  // too short
                    '550e8400-e29b-41d4-a716-446655440000-extra', // too long
                    '',
                    '00000000-0000-0000-0000-000000000000', // version 0 not valid
                ];

                for (const uuid of invalidUuids) {
                    expect(() => validator.assertIsUuid(uuid)).toThrow();
                }
            });

            it('throws for non-strings', () => {
                expect(() => validator.assertIsUuid(123)).toThrow();
                expect(() => validator.assertIsUuid(null)).toThrow();
            });
        });

        describe('assertIsIsoDateString', () => {
            it('accepts valid ISO date strings', () => {
                expect(validator.assertIsIsoDateString('2024-01-15T10:30:00Z')).toBe(true);
                expect(validator.assertIsIsoDateString('2024-01-15T10:30:00.000Z')).toBe(true);
                expect(validator.assertIsIsoDateString('2024-01-15T10:30:00+00:00')).toBe(true);
            });

            it('throws for non-ISO date strings', () => {
                expect(() => validator.assertIsIsoDateString('2024-01-15')).toThrow(); // No T
                expect(() => validator.assertIsIsoDateString('not a date')).toThrow();
                expect(() => validator.assertIsIsoDateString('')).toThrow();
            });

            it('throws for non-strings', () => {
                expect(() => validator.assertIsIsoDateString(Date.now())).toThrow();
            });
        });

        describe('assertHasProperty', () => {
            it('passes when property exists', () => {
                expect(validator.assertHasProperty({ name: 'test' }, 'name')).toBe(true);
                expect(validator.assertHasProperty({ a: 1, b: 2 }, 'a')).toBe(true);
            });

            it('throws when property missing', () => {
                expect(() => validator.assertHasProperty({}, 'name')).toThrow();
                expect(() => validator.assertHasProperty({ other: 1 }, 'name')).toThrow();
            });

            it('throws for non-objects', () => {
                expect(() => validator.assertHasProperty(null as any, 'name')).toThrow();
                expect(() => validator.assertHasProperty('string' as any, 'length')).toThrow();
            });
        });

        describe('assertHasFunction', () => {
            it('passes when property is a function', () => {
                const obj = { method: () => {} };
                expect(validator.assertHasFunction(obj, 'method')).toBe(true);
            });

            it('throws when property is not a function', () => {
                expect(() => validator.assertHasFunction({ prop: 'value' }, 'prop')).toThrow();
            });

            it('throws when property missing', () => {
                expect(() => validator.assertHasFunction({}, 'method')).toThrow();
            });
        });

        describe('assert', () => {
            it('passes when condition is true', () => {
                expect(validator.assert(true)).toBe(true);
                expect(validator.assert(1 === 1)).toBe(true);
            });

            it('throws when condition is false', () => {
                expect(() => validator.assert(false)).toThrow();
                const falseCondition = (1 as number) === (2 as number);
                expect(() => validator.assert(falseCondition)).toThrow();
            });

            it('uses custom message', () => {
                expect(() => validator.assert(false, 'Custom assertion failed'))
                    .toThrow('Custom assertion failed');
            });
        });

        describe('assertEqual', () => {
            it('passes when values are equal', () => {
                expect(validator.assertEqual(5, 5)).toBe(true);
                expect(validator.assertEqual('a', 'a')).toBe(true);
                expect(validator.assertEqual(null, null)).toBe(true);
            });

            it('throws when values differ', () => {
                expect(() => validator.assertEqual(5, 10)).toThrow();
                expect(() => validator.assertEqual('a', 'b')).toThrow();
            });

            it('uses strict equality', () => {
                expect(() => validator.assertEqual(5 as any, '5')).toThrow();
                expect(() => validator.assertEqual(0 as any, false)).toThrow();
            });
        });

        describe('assertIsGreaterThanOrEqual', () => {
            it('passes when value >= min', () => {
                expect(validator.assertIsGreaterThanOrEqual(5, 5)).toBe(true);
                expect(validator.assertIsGreaterThanOrEqual(10, 5)).toBe(true);
                expect(validator.assertIsGreaterThanOrEqual(0, -1)).toBe(true);
            });

            it('throws when value < min', () => {
                expect(() => validator.assertIsGreaterThanOrEqual(4, 5)).toThrow();
                expect(() => validator.assertIsGreaterThanOrEqual(-10, 0)).toThrow();
            });
        });

        describe('assertIsInRange', () => {
            it('passes when value is in range (inclusive)', () => {
                expect(validator.assertIsInRange(5, 0, 10)).toBe(true);
                expect(validator.assertIsInRange(0, 0, 10)).toBe(true);
                expect(validator.assertIsInRange(10, 0, 10)).toBe(true);
            });

            it('throws when value is out of range', () => {
                expect(() => validator.assertIsInRange(-1, 0, 10)).toThrow();
                expect(() => validator.assertIsInRange(11, 0, 10)).toThrow();
            });
        });

        describe('assertIsEventPayload', () => {
            it('passes for valid event payloads', () => {
                const payload = {
                    agentId: 'agent-1',
                    channelId: 'channel-1',
                    timestamp: Date.now()
                };
                expect(validator.assertIsEventPayload(payload)).toBe(true);
            });

            it('throws when missing required fields', () => {
                expect(() => validator.assertIsEventPayload({ agentId: 'a' })).toThrow();
                expect(() => validator.assertIsEventPayload({ channelId: 'c' })).toThrow();
                expect(() => validator.assertIsEventPayload({})).toThrow();
            });
        });
    });

    describe('createWarningValidator (soft mode)', () => {
        // Mock console.warn
        let warnSpy: jest.SpyInstance;

        beforeEach(() => {
            warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        });

        afterEach(() => {
            warnSpy.mockRestore();
        });

        it('logs warning instead of throwing', () => {
            const validator = createWarningValidator('test');

            // Should not throw
            expect(() => validator.assertIsString(123)).not.toThrow();

            // Should return false
            expect(validator.assertIsString(123)).toBe(false);
        });

        it('returns false for invalid values', () => {
            const validator = createWarningValidator('test');

            expect(validator.assertIsNumber('not a number')).toBe(false);
            expect(validator.assertIsBoolean(0)).toBe(false);
            expect(validator.assertIsArray({})).toBe(false);
        });

        it('returns true for valid values', () => {
            const validator = createWarningValidator('test');

            expect(validator.assertIsString('hello')).toBe(true);
            expect(validator.assertIsNumber(42)).toBe(true);
            expect(validator.assertIsBoolean(true)).toBe(true);
        });
    });

    describe('createSilentValidator (silent mode)', () => {
        // Mock console methods to ensure nothing is logged
        let warnSpy: jest.SpyInstance;
        let errorSpy: jest.SpyInstance;

        beforeEach(() => {
            warnSpy = jest.spyOn(console, 'warn').mockImplementation();
            errorSpy = jest.spyOn(console, 'error').mockImplementation();
        });

        afterEach(() => {
            warnSpy.mockRestore();
            errorSpy.mockRestore();
        });

        it('neither throws nor logs', () => {
            const validator = createSilentValidator('test');

            // Should not throw
            expect(() => validator.assertIsString(123)).not.toThrow();

            // Should not log anything
            expect(warnSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('returns false for invalid values', () => {
            const validator = createSilentValidator('test');

            expect(validator.assertIsString(123)).toBe(false);
            expect(validator.assertIsNumber('nope')).toBe(false);
        });

        it('returns true for valid values', () => {
            const validator = createSilentValidator('test');

            expect(validator.assertIsString('hello')).toBe(true);
            expect(validator.assertIsNumber(42)).toBe(true);
        });
    });

    describe('createValidator with config object', () => {
        it('respects hard mode', () => {
            const validator = createValidator({ mode: 'hard' });
            expect(() => validator.assertIsString(123)).toThrow();
        });

        it('respects soft mode', () => {
            // Suppress console.warn since soft mode intentionally logs warnings
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const validator = createValidator({ mode: 'soft' });
                expect(() => validator.assertIsString(123)).not.toThrow();
                expect(validator.assertIsString(123)).toBe(false);
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('respects silent mode', () => {
            const validator = createValidator({ mode: 'silent' });
            expect(() => validator.assertIsString(123)).not.toThrow();
            expect(validator.assertIsString(123)).toBe(false);
        });

        it('includes label in error messages', () => {
            const validator = createValidator({ mode: 'hard', label: 'MyComponent' });

            expect(() => validator.assertIsString(123))
                .toThrow(/MyComponent/);
        });
    });

    describe('type guards', () => {
        it('assertIsString narrows type', () => {
            const validator = createSilentValidator();
            const value: unknown = 'hello';

            if (validator.assertIsString(value)) {
                // TypeScript should know value is string here
                const len: number = value.length;
                expect(len).toBe(5);
            }
        });

        it('assertIsNumber narrows type', () => {
            const validator = createSilentValidator();
            const value: unknown = 42;

            if (validator.assertIsNumber(value)) {
                // TypeScript should know value is number here
                const doubled: number = value * 2;
                expect(doubled).toBe(84);
            }
        });

        it('assertIsArray narrows type', () => {
            const validator = createSilentValidator();
            const value: unknown = [1, 2, 3];

            if (validator.assertIsArray(value)) {
                // TypeScript should know value is array here
                const len: number = value.length;
                expect(len).toBe(3);
            }
        });
    });
});
