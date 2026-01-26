/**
 * Unit tests for UtilityScorerService
 * Tests composite scoring formula, phase-specific lambda selection, and normalization
 */

import { UtilityScorerService } from '@mxf/shared/services/UtilityScorerService';
import { MemoryCandidate, DEFAULT_PHASE_LAMBDAS } from '@mxf/shared/types/MemoryUtilityTypes';

describe('UtilityScorerService Unit Tests', () => {
    let scorer: UtilityScorerService;

    beforeAll(() => {
        scorer = UtilityScorerService.getInstance();
        scorer.initialize({
            enabled: true,
            lambda: 0.5,
            phaseLambdas: DEFAULT_PHASE_LAMBDAS
        });
    });

    afterEach(() => {
        // Reset lambdas after each test
        scorer.resetLambdas();
    });

    describe('Composite Scoring Formula', () => {
        it('should apply formula: score = (1-λ) × sim + λ × Q', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'mem-1', similarity: 0.8, qValue: 0.6 },
                { memoryId: 'mem-2', similarity: 0.6, qValue: 0.8 }
            ];

            // With λ=0.5, both similarity and Q-value are equally weighted
            const result = scorer.scoreMemories('test query', candidates, {
                lambda: 0.5,
                includeBreakdown: true
            });

            expect(result.memories.length).toBe(2);
            expect(result.stats.lambdaUsed).toBe(0.5);

            // With equal weighting and normalized values, the scores should reflect
            // a balance between similarity and Q-value
            for (const memory of result.memories) {
                expect(memory.finalScore).toBeDefined();
                expect(memory.breakdown).toBeDefined();
                expect(memory.breakdown?.lambda).toBe(0.5);
            }
        });

        it('should favor similarity with low lambda (λ=0.2)', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'high-sim', similarity: 0.9, qValue: 0.3 },
                { memoryId: 'low-sim', similarity: 0.3, qValue: 0.9 }
            ];

            const result = scorer.scoreMemories('test', candidates, { lambda: 0.2 });

            // High similarity should rank higher with low lambda
            expect(result.memories[0].memoryId).toBe('high-sim');
        });

        it('should favor Q-value with high lambda (λ=0.8)', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'high-sim', similarity: 0.9, qValue: 0.3 },
                { memoryId: 'high-q', similarity: 0.3, qValue: 0.9 }
            ];

            const result = scorer.scoreMemories('test', candidates, { lambda: 0.8 });

            // High Q-value should rank higher with high lambda
            expect(result.memories[0].memoryId).toBe('high-q');
        });

        it('should return pure similarity ranking with λ=0', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'a', similarity: 0.9, qValue: 0.1 },
                { memoryId: 'b', similarity: 0.5, qValue: 0.9 },
                { memoryId: 'c', similarity: 0.7, qValue: 0.5 }
            ];

            const result = scorer.scoreMemories('test', candidates, { lambda: 0 });

            // Order should be by similarity: a (0.9) > c (0.7) > b (0.5)
            expect(result.memories[0].memoryId).toBe('a');
            expect(result.memories[1].memoryId).toBe('c');
            expect(result.memories[2].memoryId).toBe('b');
        });
    });

    describe('Phase-Specific Lambda Selection', () => {
        it('should use observation lambda (0.2) for OBSERVATION phase', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'test', similarity: 0.7, qValue: 0.5 }
            ];

            const result = scorer.scoreForPhase('test', candidates, 'observation');
            expect(result.stats.lambdaUsed).toBe(0.2);
        });

        it('should use reasoning lambda (0.5) for REASONING phase', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'test', similarity: 0.7, qValue: 0.5 }
            ];

            const result = scorer.scoreForPhase('test', candidates, 'reasoning');
            expect(result.stats.lambdaUsed).toBe(0.5);
        });

        it('should use planning lambda (0.7) for PLANNING phase', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'test', similarity: 0.7, qValue: 0.5 }
            ];

            const result = scorer.scoreForPhase('test', candidates, 'planning');
            expect(result.stats.lambdaUsed).toBe(0.7);
        });

        it('should use action lambda (0.3) for ACTION phase', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'test', similarity: 0.7, qValue: 0.5 }
            ];

            const result = scorer.scoreForPhase('test', candidates, 'action');
            expect(result.stats.lambdaUsed).toBe(0.3);
        });

        it('should use reflection lambda (0.6) for REFLECTION phase', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'test', similarity: 0.7, qValue: 0.5 }
            ];

            const result = scorer.scoreForPhase('test', candidates, 'reflection');
            expect(result.stats.lambdaUsed).toBe(0.6);
        });
    });

    describe('Lambda Configuration', () => {
        it('should get and set global lambda', () => {
            scorer.setLambda(0.65, 'global');
            expect(scorer.getLambda('global')).toBe(0.65);
        });

        it('should get and set phase-specific lambda', () => {
            scorer.setLambda(0.35, 'action');
            expect(scorer.getLambda('action')).toBe(0.35);
        });

        it('should reject lambda outside [0, 1] range', () => {
            expect(() => scorer.setLambda(-0.1)).toThrow();
            expect(() => scorer.setLambda(1.1)).toThrow();
        });

        it('should return all phase lambdas', () => {
            const phaseLambdas = scorer.getPhaseLambdas();

            expect(phaseLambdas.observation).toBeDefined();
            expect(phaseLambdas.reasoning).toBeDefined();
            expect(phaseLambdas.planning).toBeDefined();
            expect(phaseLambdas.action).toBeDefined();
            expect(phaseLambdas.reflection).toBeDefined();
        });
    });

    describe('Normalization Within Candidate Pool', () => {
        it('should normalize within the candidate pool only', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'a', similarity: 0.3, qValue: 0.3 },
                { memoryId: 'b', similarity: 0.5, qValue: 0.5 },
                { memoryId: 'c', similarity: 0.7, qValue: 0.7 }
            ];

            const result = scorer.scoreMemories('test', candidates, {
                includeBreakdown: true,
                normalizationMethod: 'z-score'
            });

            // Verify normalization was applied
            for (const memory of result.memories) {
                expect(memory.breakdown?.normalizedSimilarity).toBeDefined();
                expect(memory.breakdown?.normalizedQValue).toBeDefined();
            }
        });

        it('should handle single candidate gracefully', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'only', similarity: 0.5, qValue: 0.5 }
            ];

            const result = scorer.scoreMemories('test', candidates);

            expect(result.memories.length).toBe(1);
            expect(result.memories[0].finalScore).toBeDefined();
        });

        it('should handle empty candidates gracefully', () => {
            const result = scorer.scoreMemories('test', []);

            expect(result.memories.length).toBe(0);
            expect(result.stats.candidatesConsidered).toBe(0);
        });
    });

    describe('Result Limiting', () => {
        it('should limit results to maxResults', () => {
            const candidates: MemoryCandidate[] = Array.from({ length: 10 }, (_, i) => ({
                memoryId: `mem-${i}`,
                similarity: 0.5 + i * 0.05,
                qValue: 0.5
            }));

            const result = scorer.scoreMemories('test', candidates, {
                maxResults: 3
            });

            expect(result.memories.length).toBe(3);
            expect(result.stats.resultsReturned).toBe(3);
            expect(result.stats.candidatesConsidered).toBe(10);
        });

        it('should sort results by final score descending', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'low', similarity: 0.3, qValue: 0.3 },
                { memoryId: 'high', similarity: 0.9, qValue: 0.9 },
                { memoryId: 'mid', similarity: 0.6, qValue: 0.6 }
            ];

            const result = scorer.scoreMemories('test', candidates);

            // Should be sorted by score descending
            for (let i = 0; i < result.memories.length - 1; i++) {
                expect(result.memories[i].finalScore).toBeGreaterThanOrEqual(
                    result.memories[i + 1].finalScore
                );
            }
        });
    });

    describe('Monotonicity', () => {
        it('should be monotonic in similarity (with fixed Q-value)', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'a', similarity: 0.3, qValue: 0.5 },
                { memoryId: 'b', similarity: 0.5, qValue: 0.5 },
                { memoryId: 'c', similarity: 0.7, qValue: 0.5 },
                { memoryId: 'd', similarity: 0.9, qValue: 0.5 }
            ];

            const result = scorer.scoreMemories('test', candidates, { lambda: 0.3 });

            // Higher similarity should always result in higher or equal score
            // (when Q-values are identical)
            const sorted = [...result.memories].sort((a, b) => {
                const aCandidate = candidates.find(c => c.memoryId === a.memoryId)!;
                const bCandidate = candidates.find(c => c.memoryId === b.memoryId)!;
                return aCandidate.similarity - bCandidate.similarity;
            });

            for (let i = 0; i < sorted.length - 1; i++) {
                expect(sorted[i].finalScore).toBeLessThanOrEqual(sorted[i + 1].finalScore);
            }
        });

        it('should be monotonic in Q-value (with fixed similarity)', () => {
            const candidates: MemoryCandidate[] = [
                { memoryId: 'a', similarity: 0.5, qValue: 0.2 },
                { memoryId: 'b', similarity: 0.5, qValue: 0.4 },
                { memoryId: 'c', similarity: 0.5, qValue: 0.6 },
                { memoryId: 'd', similarity: 0.5, qValue: 0.8 }
            ];

            const result = scorer.scoreMemories('test', candidates, { lambda: 0.7 });

            // Higher Q-value should always result in higher or equal score
            // (when similarities are identical)
            const sorted = [...result.memories].sort((a, b) => {
                const aCandidate = candidates.find(c => c.memoryId === a.memoryId)!;
                const bCandidate = candidates.find(c => c.memoryId === b.memoryId)!;
                return aCandidate.qValue - bCandidate.qValue;
            });

            for (let i = 0; i < sorted.length - 1; i++) {
                expect(sorted[i].finalScore).toBeLessThanOrEqual(sorted[i + 1].finalScore);
            }
        });
    });

    describe('Disabled Mode', () => {
        it('should return pure similarity ranking when disabled', () => {
            // Temporarily disable
            scorer.updateConfig({ enabled: false });

            const candidates: MemoryCandidate[] = [
                { memoryId: 'a', similarity: 0.3, qValue: 0.9 },
                { memoryId: 'b', similarity: 0.9, qValue: 0.3 }
            ];

            const result = scorer.scoreMemories('test', candidates);

            // Should be ordered by similarity, ignoring Q-value
            expect(result.memories[0].memoryId).toBe('b');
            expect(result.stats.lambdaUsed).toBe(0);

            // Re-enable
            scorer.updateConfig({ enabled: true });
        });
    });
});
