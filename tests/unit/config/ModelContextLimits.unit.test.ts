/**
 * Unit Tests for ModelContextLimits (Phase 1)
 *
 * Tests context limit lookup (exact, prefix, OpenRouter format),
 * compaction threshold calculation, and runtime model registration.
 */

import {
    getContextLimit,
    getCompactionThreshold,
    registerModelContextLimit,
    listModelContextLimits,
} from '../../../src/shared/config/ModelContextLimits';

describe('ModelContextLimits', () => {
    describe('getContextLimit', () => {
        it('should return exact match for known models', () => {
            expect(getContextLimit('gpt-4o')).toBe(128_000);
            expect(getContextLimit('gpt-4')).toBe(8_192);
            expect(getContextLimit('gpt-3.5-turbo')).toBe(16_385);
            expect(getContextLimit('o3')).toBe(200_000);
            expect(getContextLimit('gemini-2.5-pro')).toBe(1_000_000);
            expect(getContextLimit('gemini-1.5-pro')).toBe(2_000_000);
        });

        it('should return prefix match for versioned model IDs', () => {
            // "claude-opus-4-20250101" should match "claude-opus-4"
            expect(getContextLimit('claude-opus-4-20250101')).toBe(200_000);
            // "claude-3.5-sonnet-20241022" should match "claude-3.5-sonnet"
            expect(getContextLimit('claude-3.5-sonnet-20241022')).toBe(200_000);
            // "gpt-4o-2024-05-13" should match "gpt-4o"
            expect(getContextLimit('gpt-4o-2024-05-13')).toBe(128_000);
        });

        it('should handle OpenRouter format with provider prefix', () => {
            // "anthropic/claude-3.5-sonnet" strips provider, matches "claude-3.5-sonnet"
            expect(getContextLimit('anthropic/claude-3.5-sonnet')).toBe(200_000);
            // "openai/gpt-4o" strips provider, matches "gpt-4o"
            expect(getContextLimit('openai/gpt-4o')).toBe(128_000);
        });

        it('should return 128000 default for unknown models', () => {
            expect(getContextLimit('totally-unknown-model')).toBe(128_000);
            expect(getContextLimit('some-provider/unknown-model')).toBe(128_000);
        });

        it('should prefer longest prefix match', () => {
            // "gpt-4o-mini" should match "gpt-4o-mini" (exact) not "gpt-4o" (prefix)
            expect(getContextLimit('gpt-4o-mini')).toBe(128_000);
            // "gpt-4-turbo" should match "gpt-4-turbo" not "gpt-4"
            expect(getContextLimit('gpt-4-turbo')).toBe(128_000);
        });

        it('should handle Meta Llama models with slash in key', () => {
            expect(getContextLimit('meta-llama/llama-3.3-70b')).toBe(131_072);
            expect(getContextLimit('meta-llama/llama-3.1-405b')).toBe(131_072);
        });
    });

    describe('getCompactionThreshold', () => {
        it('should calculate threshold as floor of limit * percent', () => {
            // 200000 * 0.80 = 160000
            expect(getCompactionThreshold('claude-opus-4', 0.80)).toBe(160_000);
            // 128000 * 0.75 = 96000
            expect(getCompactionThreshold('gpt-4o', 0.75)).toBe(96_000);
            // 8192 * 0.90 = 7372.8 → floor → 7372
            expect(getCompactionThreshold('gpt-4', 0.90)).toBe(7_372);
        });

        it('should handle edge percentages', () => {
            expect(getCompactionThreshold('gpt-4o', 1.0)).toBe(128_000);
            expect(getCompactionThreshold('gpt-4o', 0.0)).toBe(0);
        });
    });

    describe('registerModelContextLimit', () => {
        it('should add a new model and make it retrievable', () => {
            const modelId = 'test-custom-model-' + Date.now();
            registerModelContextLimit(modelId, 500_000);
            expect(getContextLimit(modelId)).toBe(500_000);
        });

        it('should override an existing model limit', () => {
            const modelId = 'test-override-model-' + Date.now();
            registerModelContextLimit(modelId, 100_000);
            expect(getContextLimit(modelId)).toBe(100_000);

            registerModelContextLimit(modelId, 250_000);
            expect(getContextLimit(modelId)).toBe(250_000);
        });
    });

    describe('listModelContextLimits', () => {
        it('should return a copy of all registered limits', () => {
            const limits = listModelContextLimits();
            expect(typeof limits).toBe('object');
            expect(limits['gpt-4o']).toBe(128_000);
            expect(limits['claude-opus-4']).toBe(200_000);
        });

        it('should return a copy, not a reference to internal state', () => {
            const limits = listModelContextLimits();
            limits['gpt-4o'] = 999;
            // Internal state should not be mutated
            expect(getContextLimit('gpt-4o')).toBe(128_000);
        });

        it('should include runtime-registered models', () => {
            const modelId = 'test-list-model-' + Date.now();
            registerModelContextLimit(modelId, 42_000);
            const limits = listModelContextLimits();
            expect(limits[modelId]).toBe(42_000);
        });
    });
});
