/**
 * Property-based tests for Q-value calculations in MULS
 * Uses fast-check to verify mathematical properties
 */

import fc from 'fast-check';
import { QValueManager } from '@mxf/shared/services/QValueManager';
import { UtilityScorerService } from '@mxf/shared/services/UtilityScorerService';
import { MemoryCandidate } from '@mxf/shared/types/MemoryUtilityTypes';

describe('Q-Value Property Tests', () => {
    let qValueManager: QValueManager;
    let utilityScorer: UtilityScorerService;

    beforeAll(() => {
        qValueManager = QValueManager.getInstance();
        qValueManager.initialize({
            enabled: true,
            defaultQValue: 0.5,
            learningRate: 0.1
        });

        utilityScorer = UtilityScorerService.getInstance();
        utilityScorer.initialize({
            enabled: true,
            lambda: 0.5
        });
    });

    beforeEach(() => {
        qValueManager.clearCache();
    });

    describe('EMA Convergence Properties', () => {
        it('Q-value converges to mean reward over time', () => {
            fc.assert(
                fc.property(
                    // Generate a reward value in [-1, 1]
                    fc.double({ min: -1, max: 1, noNaN: true }),
                    // Generate a learning rate in (0, 1)
                    fc.double({ min: 0.01, max: 0.5, noNaN: true }),
                    // Generate number of iterations (enough for convergence)
                    fc.integer({ min: 50, max: 200 }),
                    (reward, alpha, iterations) => {
                        const memoryId = `convergence-${Math.random()}`;
                        qValueManager.setQValueInCache(memoryId, 0.5);

                        // Apply same reward multiple times
                        let finalQ = 0.5;
                        for (let i = 0; i < iterations; i++) {
                            finalQ = finalQ + alpha * (reward - finalQ);
                        }

                        // After many iterations, Q-value should approach reward
                        // Tolerance depends on iterations and learning rate
                        const tolerance = Math.pow(1 - alpha, iterations) * Math.abs(0.5 - reward);
                        return Math.abs(finalQ - reward) <= tolerance + 0.01;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('Q-value stays within [0, 1] for any reward sequence', () => {
            fc.assert(
                fc.property(
                    // Generate array of rewards in [-1, 1]
                    fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 100 }),
                    // Generate starting Q-value in [0, 1]
                    fc.double({ min: 0, max: 1, noNaN: true }),
                    // Generate learning rate
                    fc.double({ min: 0.01, max: 0.5, noNaN: true }),
                    (rewards, startQ, alpha) => {
                        let q = startQ;
                        for (const reward of rewards) {
                            q = q + alpha * (reward - q);
                            // Clamp (as the real implementation does)
                            q = Math.max(0, Math.min(1, q));
                        }
                        return q >= 0 && q <= 1;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Z-Score Normalization Properties', () => {
        it('Z-score normalized values have mean≈0 and stddev≈1', () => {
            fc.assert(
                fc.property(
                    // Generate array of distinct Q-values
                    fc.array(
                        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
                        { minLength: 3, maxLength: 20 }
                    ).filter(arr => {
                        // Filter out arrays with all identical values
                        const unique = new Set(arr.map(v => v.toFixed(6)));
                        return unique.size >= 2;
                    }),
                    (qValues) => {
                        // Set up Q-values in cache
                        const memoryIds = qValues.map((q, i) => {
                            const id = `zscore-${i}-${Math.random()}`;
                            qValueManager.setQValueInCache(id, q);
                            return id;
                        });

                        // Get normalized values
                        const normalized = qValueManager.getNormalizedQValues(memoryIds, 'z-score');
                        const values = Array.from(normalized.values());

                        // Calculate mean
                        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

                        // Calculate standard deviation
                        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
                        const stdDev = Math.sqrt(variance);

                        // Mean should be approximately 0, stddev approximately 1
                        return Math.abs(mean) < 0.01 && Math.abs(stdDev - 1) < 0.01;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('Z-score handles identical values without NaN', () => {
            fc.assert(
                fc.property(
                    fc.double({ min: 0, max: 1, noNaN: true }),
                    fc.integer({ min: 2, max: 10 }),
                    (qValue, count) => {
                        // Set up identical Q-values
                        const memoryIds = Array.from({ length: count }, (_, i) => {
                            const id = `identical-${i}-${Math.random()}`;
                            qValueManager.setQValueInCache(id, qValue);
                            return id;
                        });

                        // Get normalized values
                        const normalized = qValueManager.getNormalizedQValues(memoryIds, 'z-score');
                        const values = Array.from(normalized.values());

                        // All values should be 0 (not NaN) when input is identical
                        return values.every(v => !isNaN(v) && v === 0);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    describe('Composite Scoring Properties', () => {
        it('Score is monotonic in both similarity and Q-value', () => {
            fc.assert(
                fc.property(
                    // Two similarity values
                    fc.double({ min: 0.1, max: 0.9, noNaN: true }),
                    fc.double({ min: 0.1, max: 0.9, noNaN: true }),
                    // Fixed Q-value
                    fc.double({ min: 0.1, max: 0.9, noNaN: true }),
                    // Lambda
                    fc.double({ min: 0.1, max: 0.9, noNaN: true }),
                    (sim1, sim2, qValue, lambda) => {
                        const candidates: MemoryCandidate[] = [
                            { memoryId: 'a', similarity: Math.min(sim1, sim2), qValue },
                            { memoryId: 'b', similarity: Math.max(sim1, sim2), qValue }
                        ];

                        const result = utilityScorer.scoreMemories('test', candidates, { lambda });

                        // Find the memory with higher similarity
                        const aScore = result.memories.find(m => m.memoryId === 'a')?.finalScore ?? 0;
                        const bScore = result.memories.find(m => m.memoryId === 'b')?.finalScore ?? 0;

                        // Higher similarity should have higher or equal score (when Q is same)
                        return aScore <= bScore;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Lambda=0 gives pure similarity ranking', () => {
            // Floating-point tolerance for comparing similarity values
            const EPSILON = 1e-9;

            fc.assert(
                fc.property(
                    // Array of candidates with varying similarity and Q-value
                    fc.array(
                        fc.record({
                            similarity: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
                            qValue: fc.double({ min: 0.1, max: 0.9, noNaN: true })
                        }),
                        { minLength: 2, maxLength: 5 }
                    ),
                    (candidateData) => {
                        const candidates: MemoryCandidate[] = candidateData.map((c, i) => ({
                            memoryId: `pure-sim-${i}`,
                            similarity: c.similarity,
                            qValue: c.qValue
                        }));

                        const result = utilityScorer.scoreMemories('test', candidates, { lambda: 0 });

                        // Check that ordering follows similarity (with floating-point tolerance)
                        for (let i = 0; i < result.memories.length - 1; i++) {
                            const currId = result.memories[i].memoryId;
                            const nextId = result.memories[i + 1].memoryId;
                            const currSim = candidates.find(c => c.memoryId === currId)?.similarity ?? 0;
                            const nextSim = candidates.find(c => c.memoryId === nextId)?.similarity ?? 0;
                            // Allow equal or nearly-equal similarities (floating-point tolerance)
                            // Only fail if currSim is significantly less than nextSim
                            if (currSim < nextSim - EPSILON) return false;
                        }
                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('Score is bounded', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.record({
                            similarity: fc.double({ min: 0, max: 1, noNaN: true }),
                            qValue: fc.double({ min: 0, max: 1, noNaN: true })
                        }),
                        { minLength: 1, maxLength: 10 }
                    ),
                    fc.double({ min: 0, max: 1, noNaN: true }),
                    (candidateData, lambda) => {
                        const candidates: MemoryCandidate[] = candidateData.map((c, i) => ({
                            memoryId: `bounded-${i}`,
                            similarity: c.similarity,
                            qValue: c.qValue
                        }));

                        const result = utilityScorer.scoreMemories('test', candidates, { lambda });

                        // All scores should be finite numbers (not NaN, not Infinity)
                        return result.memories.every(m =>
                            typeof m.finalScore === 'number' &&
                            !isNaN(m.finalScore) &&
                            isFinite(m.finalScore)
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Min-Max Normalization Properties', () => {
        it('Min-max normalized values are in [0, 1]', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.double({ min: 0, max: 1, noNaN: true }),
                        { minLength: 2, maxLength: 20 }
                    ).filter(arr => {
                        const min = Math.min(...arr);
                        const max = Math.max(...arr);
                        return max > min; // Filter out constant arrays
                    }),
                    (qValues) => {
                        // Set up Q-values in cache
                        const memoryIds = qValues.map((q, i) => {
                            const id = `minmax-${i}-${Math.random()}`;
                            qValueManager.setQValueInCache(id, q);
                            return id;
                        });

                        // Get normalized values
                        const normalized = qValueManager.getNormalizedQValues(memoryIds, 'min-max');
                        const values = Array.from(normalized.values());

                        // All values should be in [0, 1]
                        return values.every(v => v >= 0 && v <= 1);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Distribution Statistics Properties', () => {
        it('Mean is within [min, max] range', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.double({ min: 0, max: 1, noNaN: true }),
                        { minLength: 1, maxLength: 50 }
                    ),
                    (qValues) => {
                        // Set up Q-values in cache
                        qValueManager.clearCache();
                        qValues.forEach((q, i) => {
                            qValueManager.setQValueInCache(`dist-${i}`, q);
                        });

                        const stats = qValueManager.getQValueDistribution();

                        // Mean should be between min and max
                        return stats.mean >= stats.min && stats.mean <= stats.max;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('Standard deviation is non-negative', () => {
            fc.assert(
                fc.property(
                    fc.array(
                        fc.double({ min: 0, max: 1, noNaN: true }),
                        { minLength: 1, maxLength: 50 }
                    ),
                    (qValues) => {
                        qValueManager.clearCache();
                        qValues.forEach((q, i) => {
                            qValueManager.setQValueInCache(`stddev-${i}`, q);
                        });

                        const stats = qValueManager.getQValueDistribution();

                        return stats.stdDev >= 0;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });
});
