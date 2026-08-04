/**
 * Unit tests for AutoCorrectionService type_mismatch string conversion.
 *
 * When a strictly-typed tool declares a string field and the model sends an
 * object, the schema-based type_mismatch strategy converts the value to a
 * string. That conversion used String(value), which yields "[object Object]"
 * — a high-confidence "correction" that passes re-validation while silently
 * destroying the payload, and because the tool then succeeds, the model never
 * sees an error it could learn from. Objects and arrays must be converted
 * with JSON.stringify so the corrected value stays faithful to what the
 * model sent. Primitives keep the String() conversion.
 */

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: { emit: jest.fn(), on: jest.fn() },
        client: { emit: jest.fn(), on: jest.fn() }
    }
}));

jest.mock('@mxf-dev/core/services/ValidationPerformanceService', () => ({
    ValidationPerformanceService: { getInstance: jest.fn().mockReturnValue({}) }
}));

jest.mock('@mxf-dev/core/services/PatternLearningService', () => ({
    PatternLearningService: {
        getInstance: jest.fn().mockReturnValue({
            getEnhancedPatterns: jest.fn().mockResolvedValue({ successful: [], failed: [] }),
            getPatternRecommendations: jest.fn().mockResolvedValue([]),
            storeSuccessfulPattern: jest.fn().mockResolvedValue(undefined)
        })
    }
}));

import { AutoCorrectionService } from '@mxf-dev/core/services/AutoCorrectionService';

// Error text mirrors formatValidationError output for a type failure. It must
// avoid the words "required"/"missing"/"unknown" so only the type_mismatch
// strategy (not missing_required / wrong_parameter_names) claims it.
const typeErrorFor = (field: string): string =>
    `/${field} must be string. Expected: "string". Actual: "object"`;

const stringFieldSchema = (field: string) => ({
    type: 'object',
    properties: {
        [field]: { type: 'string', description: 'a string field' }
    }
});

describe('AutoCorrectionService type_mismatch string conversion', () => {
    let service: AutoCorrectionService;

    beforeEach(() => {
        service = AutoCorrectionService.getInstance();
        // The correction budget is keyed by agent:channel:tool and persists on
        // the singleton; clear it so tests don't starve each other of attempts.
        service.clearCorrectionHistory();
    });

    it('converts an object value for a string field with JSON.stringify, not String()', async () => {
        const payload = { signals_written: 15, key_themes: ['rates'] };

        const result = await service.attemptCorrection(
            'agent-1' as any,
            'channel-1' as any,
            'stringify_object_tool',
            { note: payload },
            typeErrorFor('note'),
            stringFieldSchema('note')
        );

        expect(result.corrected).toBe(true);
        expect(result.correctedParameters?.note).toBe(JSON.stringify(payload));
    });

    it('converts an array value for a string field with JSON.stringify', async () => {
        const payload = ['alpha', { nested: true }];

        const result = await service.attemptCorrection(
            'agent-1' as any,
            'channel-1' as any,
            'stringify_array_tool',
            { note: payload },
            typeErrorFor('note'),
            stringFieldSchema('note')
        );

        expect(result.corrected).toBe(true);
        expect(result.correctedParameters?.note).toBe(JSON.stringify(payload));
    });

    it('keeps String() conversion for primitive values', async () => {
        const result = await service.attemptCorrection(
            'agent-1' as any,
            'channel-1' as any,
            'stringify_number_tool',
            { note: 42 },
            typeErrorFor('note'),
            stringFieldSchema('note')
        );

        expect(result.corrected).toBe(true);
        expect(result.correctedParameters?.note).toBe('42');
    });
});
