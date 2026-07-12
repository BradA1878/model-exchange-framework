/**
 * SystemLLM Budget Unit Tests
 *
 * SystemLLM defaults reasoning and reflection to anthropic/claude-opus-4.5 and had
 * cooldowns but no ceiling — CLAUDE.md records this costing $18+ a day. These tests
 * pin the daily cap: what a call costs, when calls stop, and that an unfamiliar
 * model cannot slip past the meter.
 */

const emitted: Array<{ eventType: string; payload: any }> = [];

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn((eventType: string, payload: any) => {
                emitted.push({ eventType, payload });
            })
        }
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import { priceCall } from '../../../src/server/socket/services/SystemLlmBudgetService';
import { LlmBudgetEvents } from '@mxf-dev/core/events/event-definitions/LlmBudgetEvents';

/**
 * Load a fresh budget service with the given environment.
 *
 * The ceiling is read once in the constructor, and the service is a singleton, so
 * each configuration needs its own module registry.
 */
const loadService = (env: Record<string, string | undefined>) => {
    jest.resetModules();

    const previous = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../../../src/server/socket/services/SystemLlmBudgetService');
        return mod.SystemLlmBudgetService.getInstance();
    } finally {
        // Restore even when the constructor rejected the configuration, so a case
        // that asserts a throw does not leak its bad value into the next one.
        process.env = previous;
    }
};

describe('SystemLlmBudgetService', () => {
    beforeEach(() => {
        emitted.length = 0;
    });

    describe('priceCall', () => {
        it('prices a known model from real token counts', () => {
            // Opus: $15/1M in, $75/1M out
            const cost = priceCall('anthropic/claude-opus-4.5', {
                inputTokens: 1_000_000,
                outputTokens: 1_000_000
            });

            expect(cost).toBeCloseTo(90, 6);
        });

        it('matches a model with or without its provider prefix', () => {
            const withPrefix = priceCall('anthropic/claude-sonnet-4.5', {
                inputTokens: 1_000_000,
                outputTokens: 0
            });
            const bare = priceCall('claude-sonnet-4.5', {
                inputTokens: 1_000_000,
                outputTokens: 0
            });

            expect(withPrefix).toBeCloseTo(3, 6);
            expect(bare).toBeCloseTo(3, 6);
        });

        it('charges an unknown model at the most expensive tier, not zero', () => {
            const seen: string[] = [];

            const cost = priceCall(
                'someone/brand-new-model',
                { inputTokens: 1_000_000, outputTokens: 0 },
                (model) => seen.push(model)
            );

            expect(cost).toBeCloseTo(15, 6);
            expect(cost).toBeGreaterThan(0);
            expect(seen).toEqual(['someone/brand-new-model']);
        });

        it('charges a cheap model less than an expensive one', () => {
            const usage = { inputTokens: 100_000, outputTokens: 50_000 };

            expect(priceCall('google/gemini-2.5-flash', usage))
                .toBeLessThan(priceCall('anthropic/claude-opus-4.5', usage));
        });

        it('costs nothing for a call that used no tokens', () => {
            expect(priceCall('anthropic/claude-opus-4.5', { inputTokens: 0, outputTokens: 0 })).toBe(0);
        });
    });

    describe('daily ceiling', () => {
        it('allows calls while under the ceiling', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '10' });

            service.recordUsage('anthropic/claude-opus-4.5', {
                inputTokens: 100_000, // $1.50
                outputTokens: 0
            });

            expect(service.isExhausted()).toBe(false);
            expect(() => service.assertWithinBudget('anthropic/claude-opus-4.5')).not.toThrow();
        });

        it('refuses calls once spend reaches the ceiling', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '1' });

            // $15/1M in → 100k input tokens is $1.50, past a $1 ceiling
            service.recordUsage('anthropic/claude-opus-4.5', {
                inputTokens: 100_000,
                outputTokens: 0
            });

            expect(service.isExhausted()).toBe(true);
            expect(() => service.assertWithinBudget('anthropic/claude-opus-4.5'))
                .toThrow(/daily budget exhausted/i);
        });

        it('emits an exceeded event exactly once', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '1' });

            service.recordUsage('anthropic/claude-opus-4.5', { inputTokens: 100_000, outputTokens: 0 });
            service.recordUsage('anthropic/claude-opus-4.5', { inputTokens: 100_000, outputTokens: 0 });

            const exceeded = emitted.filter((e) => e.eventType === LlmBudgetEvents.EXCEEDED);
            expect(exceeded).toHaveLength(1);
            expect(exceeded[0].payload.data.limitUsd).toBe(1);
            expect(exceeded[0].payload.data.spentUsd).toBeGreaterThanOrEqual(1);
        });

        it('warns before it stops, once', () => {
            const service = loadService({
                SYSTEMLLM_DAILY_BUDGET_USD: '10',
                SYSTEMLLM_BUDGET_WARN_AT: '0.5'
            });

            // $6 of a $10 ceiling → past the 50% warning, short of the cap
            service.recordUsage('anthropic/claude-opus-4.5', { inputTokens: 400_000, outputTokens: 0 });

            const warnings = emitted.filter((e) => e.eventType === LlmBudgetEvents.WARNING);
            expect(warnings).toHaveLength(1);
            expect(service.isExhausted()).toBe(false);

            service.recordUsage('anthropic/claude-opus-4.5', { inputTokens: 10_000, outputTokens: 0 });
            expect(emitted.filter((e) => e.eventType === LlmBudgetEvents.WARNING)).toHaveLength(1);
        });

        it('an unknown model still counts against the ceiling', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '1' });

            service.recordUsage('someone/unlisted-model', { inputTokens: 100_000, outputTokens: 0 });

            expect(service.isExhausted()).toBe(true);
        });

        it('accumulates spend across calls', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '10' });

            service.recordUsage('anthropic/claude-sonnet-4.5', { inputTokens: 1_000_000, outputTokens: 0 }); // $3
            service.recordUsage('anthropic/claude-sonnet-4.5', { inputTokens: 1_000_000, outputTokens: 0 }); // $3

            expect(service.getStatus().spentUsd).toBeCloseTo(6, 6);
            expect(service.getStatus().utilization).toBeCloseTo(0.6, 6);
        });

        it('treats a zero budget as SystemLLM disabled', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '0' });

            expect(service.isExhausted()).toBe(true);
            expect(() => service.assertWithinBudget('anything')).toThrow(/disabled/i);
        });

        it('defaults to a ten dollar ceiling', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: undefined });

            expect(service.getStatus().limitUsd).toBe(10);
        });

        it('ignores negative token counts rather than crediting spend back', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '10' });

            service.recordUsage('anthropic/claude-sonnet-4.5', { inputTokens: 1_000_000, outputTokens: 0 });
            service.recordUsage('anthropic/claude-sonnet-4.5', { inputTokens: -5_000_000, outputTokens: 0 });

            expect(service.getStatus().spentUsd).toBeCloseTo(3, 6);
        });
    });

    describe('configuration validation', () => {
        it('rejects a negative budget', () => {
            expect(() => loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '-5' })).toThrow();
        });

        it('rejects a non-numeric budget', () => {
            expect(() => loadService({ SYSTEMLLM_DAILY_BUDGET_USD: 'plenty' })).toThrow();
        });

        it('rejects a warning threshold outside (0, 1]', () => {
            expect(() =>
                loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '10', SYSTEMLLM_BUDGET_WARN_AT: '1.5' })
            ).toThrow();

            expect(() =>
                loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '10', SYSTEMLLM_BUDGET_WARN_AT: '0' })
            ).toThrow();
        });
    });

    describe('getStatus', () => {
        it('reports spend, ceiling, and whether calls are refused', () => {
            const service = loadService({ SYSTEMLLM_DAILY_BUDGET_USD: '10' });

            service.recordUsage('anthropic/claude-sonnet-4.5', { inputTokens: 1_000_000, outputTokens: 0 });

            const status = service.getStatus();

            expect(status.spentUsd).toBeCloseTo(3, 6);
            expect(status.limitUsd).toBe(10);
            expect(status.exhausted).toBe(false);
            expect(status.periodStart).toBeInstanceOf(Date);
        });
    });
});
