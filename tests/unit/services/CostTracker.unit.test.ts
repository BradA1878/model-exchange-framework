/**
 * Unit tests for CostTracker budget tracking features.
 * Validates cost estimation accumulation, budget threshold detection,
 * and budget status formatting.
 */

import {
    createInitialCostData,
    trackTokenUsage,
    trackIteration,
    checkBudget,
    formatBudgetStatus,
    estimateCost,
    formatCostSummary,
    type SessionCostData,
} from '../../../src/cli/tui/services/CostTracker';

describe('CostTracker', () => {
    describe('createInitialCostData', () => {
        it('should include budget fields with correct defaults', () => {
            const data = createInitialCostData();
            expect(data.costBudget).toBeNull();
            expect(data.estimatedCost).toBe(0);
            expect(data.budgetWarningEmitted).toBe(false);
            expect(data.budgetExceeded).toBe(false);
        });

        it('should include all original fields', () => {
            const data = createInitialCostData();
            expect(data.agents).toEqual({});
            expect(data.totalIterations).toBe(0);
            expect(data.totalTokens).toBe(0);
            expect(data.startTime).toBeGreaterThan(0);
        });
    });

    describe('trackTokenUsage with cost accumulation', () => {
        it('should accumulate estimatedCost when model is known', () => {
            let data = createInitialCostData();
            // Track 1000 input + 500 output tokens on Claude Sonnet ($3/$15 per 1M)
            data = trackTokenUsage(data, 'agent-1', 'Agent One', 1000, 500, 1500, 'claude-sonnet-4-6');
            // Expected: (1000 * 3 + 500 * 15) / 1_000_000 = (3000 + 7500) / 1_000_000 = 0.0105
            expect(data.estimatedCost).toBeCloseTo(0.0105, 6);
        });

        it('should use default pricing when model is unknown', () => {
            let data = createInitialCostData();
            // Track 1000 input + 500 output tokens with unknown model (default: $3/$15 per 1M)
            data = trackTokenUsage(data, 'agent-1', 'Agent One', 1000, 500, 1500, 'unknown-model-xyz');
            // Default rates: $3/1M input, $15/1M output
            // Expected: (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
            expect(data.estimatedCost).toBeCloseTo(0.0105, 6);
        });

        it('should use default pricing when no model is provided', () => {
            let data = createInitialCostData();
            data = trackTokenUsage(data, 'agent-1', 'Agent One', 1000, 500, 1500);
            // Default rates: $3/1M input, $15/1M output
            expect(data.estimatedCost).toBeCloseTo(0.0105, 6);
        });

        it('should accumulate cost across multiple usage events', () => {
            let data = createInitialCostData();
            data = trackTokenUsage(data, 'agent-1', 'Agent One', 1000, 500, 1500, 'claude-sonnet-4-6');
            data = trackTokenUsage(data, 'agent-1', 'Agent One', 2000, 1000, 3000, 'claude-sonnet-4-6');
            // First: 0.0105, Second: (2000*3 + 1000*15) / 1M = 0.021
            expect(data.estimatedCost).toBeCloseTo(0.0315, 6);
        });

        it('should accumulate cost for Opus pricing', () => {
            let data = createInitialCostData();
            // Track on Opus ($15/$75 per 1M)
            data = trackTokenUsage(data, 'agent-1', 'Agent One', 10000, 5000, 15000, 'claude-opus-4-6');
            // Expected: (10000 * 15 + 5000 * 75) / 1_000_000 = (150000 + 375000) / 1_000_000 = 0.525
            expect(data.estimatedCost).toBeCloseTo(0.525, 6);
        });
    });

    describe('checkBudget', () => {
        it('should return no warning/exceeded when no budget is set', () => {
            const data = createInitialCostData();
            const result = checkBudget(data);
            expect(result.warning).toBe(false);
            expect(result.exceeded).toBe(false);
            expect(result.budget).toBeNull();
        });

        it('should return no warning when cost is below 80%', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 10.0,
                estimatedCost: 5.0, // 50%
            };
            const result = checkBudget(data);
            expect(result.warning).toBe(false);
            expect(result.exceeded).toBe(false);
        });

        it('should return warning when cost reaches 80%', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 10.0,
                estimatedCost: 8.0, // 80%
            };
            const result = checkBudget(data);
            expect(result.warning).toBe(true);
            expect(result.exceeded).toBe(false);
        });

        it('should not return warning if already emitted', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 10.0,
                estimatedCost: 9.0, // 90%
                budgetWarningEmitted: true,
            };
            const result = checkBudget(data);
            expect(result.warning).toBe(false);
            expect(result.exceeded).toBe(false);
        });

        it('should return exceeded when cost reaches 100%', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 5.0,
                estimatedCost: 5.0, // 100%
            };
            const result = checkBudget(data);
            expect(result.exceeded).toBe(true);
        });

        it('should return exceeded when cost exceeds budget', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 5.0,
                estimatedCost: 7.5, // 150%
            };
            const result = checkBudget(data);
            expect(result.exceeded).toBe(true);
            expect(result.estimatedCost).toBe(7.5);
            expect(result.budget).toBe(5.0);
        });

        it('should return warning=true and exceeded=true when at 100%', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 5.0,
                estimatedCost: 5.0,
                budgetWarningEmitted: false,
            };
            const result = checkBudget(data);
            // At 100%, both warning (>=80%) and exceeded (>=100%) should fire
            expect(result.warning).toBe(true);
            expect(result.exceeded).toBe(true);
        });
    });

    describe('formatBudgetStatus', () => {
        it('should show "no budget set" when budget is null', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                estimatedCost: 1.5,
            };
            const status = formatBudgetStatus(data);
            expect(status).toContain('no budget set');
            expect(status).toContain('$1.5000');
        });

        it('should show cost/budget with percentage', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 10.0,
                estimatedCost: 2.5,
            };
            const status = formatBudgetStatus(data);
            expect(status).toContain('$2.5000');
            expect(status).toContain('$10.00');
            expect(status).toContain('25.0%');
        });

        it('should show EXCEEDED when budget is exceeded', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 5.0,
                estimatedCost: 6.0,
                budgetExceeded: true,
            };
            const status = formatBudgetStatus(data);
            expect(status).toContain('EXCEEDED');
            expect(status).toContain('120.0%');
        });
    });

    describe('formatCostSummary with budget', () => {
        it('should include budget line when budget is set', () => {
            const data: SessionCostData = {
                ...createInitialCostData(),
                costBudget: 10.0,
                estimatedCost: 3.0,
            };
            const summary = formatCostSummary(data);
            expect(summary).toContain('Budget:');
            expect(summary).toContain('$10.00');
        });

        it('should not include budget line when no budget is set', () => {
            const data = createInitialCostData();
            const summary = formatCostSummary(data);
            expect(summary).not.toContain('Budget:');
        });
    });

    describe('estimateCost', () => {
        it('should return correct cost for known model', () => {
            // Claude Sonnet: $3/1M input, $15/1M output
            const cost = estimateCost(1_000_000, 1_000_000, 'claude-sonnet-4-6');
            expect(cost).toBe(18); // 3 + 15
        });

        it('should return null for unknown model', () => {
            const cost = estimateCost(1000, 500, 'completely-unknown-model');
            expect(cost).toBeNull();
        });

        it('should match by prefix for versioned model IDs', () => {
            // e.g., "claude-opus-4-6/some-variant" should match "claude-opus-4-6"
            const cost = estimateCost(1_000_000, 0, 'claude-opus-4-6');
            expect(cost).toBe(15); // $15/1M input
        });
    });
});
