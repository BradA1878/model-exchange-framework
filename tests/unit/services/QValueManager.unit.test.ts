/**
 * Unit tests for QValueManager
 * Tests Q-value storage, EMA updates, normalization, and cache behavior
 */

import { QValueManager } from '@mxf/shared/services/QValueManager';
import { DEFAULT_MEMORY_UTILITY_CONFIG } from '@mxf/shared/types/MemoryUtilityTypes';

describe('QValueManager Unit Tests', () => {
    let qValueManager: QValueManager;

    beforeAll(() => {
        qValueManager = QValueManager.getInstance();
        qValueManager.initialize({
            enabled: true,
            defaultQValue: 0.5,
            learningRate: 0.1
        });
    });

    beforeEach(() => {
        // Clear cache before each test
        qValueManager.clearCache();
    });

    describe('Q-Value Retrieval', () => {
        it('should return default Q-value for unknown memory', () => {
            const qValue = qValueManager.getQValue('unknown-memory');
            expect(qValue).toBe(0.5);
        });

        it('should return cached Q-value after setting', () => {
            qValueManager.setQValueInCache('test-memory', 0.75);
            const qValue = qValueManager.getQValue('test-memory');
            expect(qValue).toBe(0.75);
        });

        it('should return multiple Q-values via batch', () => {
            qValueManager.setQValueInCache('mem-1', 0.6);
            qValueManager.setQValueInCache('mem-2', 0.8);
            qValueManager.setQValueInCache('mem-3', 0.4);

            const qValues = qValueManager.getQValues(['mem-1', 'mem-2', 'mem-3', 'unknown']);
            expect(qValues.get('mem-1')).toBe(0.6);
            expect(qValues.get('mem-2')).toBe(0.8);
            expect(qValues.get('mem-3')).toBe(0.4);
            expect(qValues.get('unknown')).toBe(0.5); // default
        });
    });

    describe('EMA Update Formula', () => {
        it('should apply EMA formula correctly: Q_new = Q_old + α(reward - Q_old)', async () => {
            const memoryId = 'ema-test';
            qValueManager.setQValueInCache(memoryId, 0.5);

            // With α=0.1 and reward=1.0: Q_new = 0.5 + 0.1*(1.0 - 0.5) = 0.55
            const newQ = await qValueManager.updateQValue(memoryId, 1.0, 0.1);
            expect(newQ).toBeCloseTo(0.55, 5);
        });

        it('should converge towards reward value over time', async () => {
            const memoryId = 'convergence-test';
            qValueManager.setQValueInCache(memoryId, 0.5);

            // Apply same reward multiple times - should converge to reward
            let currentQ = 0.5;
            const reward = 1.0;
            const alpha = 0.1;

            for (let i = 0; i < 50; i++) {
                currentQ = await qValueManager.updateQValue(memoryId, reward, alpha);
            }

            // After many iterations, should be very close to reward
            expect(currentQ).toBeGreaterThan(0.99);
        });

        it('should decrease Q-value with negative reward', async () => {
            const memoryId = 'negative-test';
            qValueManager.setQValueInCache(memoryId, 0.7);

            // With α=0.1 and reward=-1.0: Q_new = 0.7 + 0.1*(-1.0 - 0.7) = 0.53
            const newQ = await qValueManager.updateQValue(memoryId, -1.0, 0.1);
            expect(newQ).toBeCloseTo(0.53, 5);
        });

        it('should clamp Q-value to [0, 1] range', async () => {
            const memoryId = 'clamp-test';

            // Test upper bound
            qValueManager.setQValueInCache(memoryId, 0.98);
            let newQ = await qValueManager.updateQValue(memoryId, 1.5, 0.5);
            expect(newQ).toBeLessThanOrEqual(1.0);

            // Test lower bound
            qValueManager.setQValueInCache(memoryId, 0.02);
            newQ = await qValueManager.updateQValue(memoryId, -1.5, 0.5);
            expect(newQ).toBeGreaterThanOrEqual(0.0);
        });
    });

    describe('Batch Updates', () => {
        it('should handle batch updates efficiently', async () => {
            const updates = [
                { memoryId: 'batch-1', reward: 0.8 },
                { memoryId: 'batch-2', reward: 0.2 },
                { memoryId: 'batch-3', reward: -0.5 }
            ];

            // Initialize
            updates.forEach(u => qValueManager.setQValueInCache(u.memoryId, 0.5));

            const result = await qValueManager.batchUpdateQValues(updates);

            expect(result.updated).toBe(3);
            expect(result.failed).toBe(0);
            expect(result.errors).toHaveLength(0);
        });
    });

    describe('Z-Score Normalization', () => {
        it('should normalize Q-values with mean≈0 and stddev≈1', () => {
            // Set up test values
            qValueManager.setQValueInCache('zscore-1', 0.2);
            qValueManager.setQValueInCache('zscore-2', 0.4);
            qValueManager.setQValueInCache('zscore-3', 0.6);
            qValueManager.setQValueInCache('zscore-4', 0.8);

            const normalized = qValueManager.getNormalizedQValues(
                ['zscore-1', 'zscore-2', 'zscore-3', 'zscore-4'],
                'z-score'
            );

            // Calculate mean of normalized values
            const values = Array.from(normalized.values());
            const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
            const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
            const stdDev = Math.sqrt(variance);

            expect(mean).toBeCloseTo(0, 5);
            expect(stdDev).toBeCloseTo(1, 5);
        });

        it('should handle all identical values gracefully', () => {
            // All same Q-values - edge case
            qValueManager.setQValueInCache('identical-1', 0.5);
            qValueManager.setQValueInCache('identical-2', 0.5);
            qValueManager.setQValueInCache('identical-3', 0.5);

            const normalized = qValueManager.getNormalizedQValues(
                ['identical-1', 'identical-2', 'identical-3'],
                'z-score'
            );

            // All should be 0 when all values are identical
            for (const value of normalized.values()) {
                expect(value).toBe(0);
            }
        });
    });

    describe('Cache Behavior', () => {
        it('should track cache statistics', () => {
            qValueManager.setQValueInCache('cache-1', 0.5);
            qValueManager.setQValueInCache('cache-2', 0.6);

            const stats = qValueManager.getCacheStats();
            expect(stats.size).toBeGreaterThanOrEqual(2);
            expect(stats.maxSize).toBeGreaterThan(0);
        });

        it('should clear specific memory from cache', () => {
            qValueManager.setQValueInCache('clear-test', 0.75);
            expect(qValueManager.getQValue('clear-test')).toBe(0.75);

            qValueManager.clearFromCache('clear-test');
            expect(qValueManager.getQValue('clear-test')).toBe(0.5); // default
        });

        it('should clear all cache entries', () => {
            qValueManager.setQValueInCache('clear-all-1', 0.6);
            qValueManager.setQValueInCache('clear-all-2', 0.7);

            qValueManager.clearCache();

            expect(qValueManager.getQValue('clear-all-1')).toBe(0.5);
            expect(qValueManager.getQValue('clear-all-2')).toBe(0.5);
        });
    });

    describe('Q-Value Distribution', () => {
        it('should calculate distribution statistics', () => {
            qValueManager.setQValueInCache('dist-1', 0.2);
            qValueManager.setQValueInCache('dist-2', 0.4);
            qValueManager.setQValueInCache('dist-3', 0.6);
            qValueManager.setQValueInCache('dist-4', 0.8);

            const stats = qValueManager.getQValueDistribution();

            expect(stats.count).toBeGreaterThanOrEqual(4);
            expect(stats.min).toBe(0.2);
            expect(stats.max).toBe(0.8);
            expect(stats.mean).toBeCloseTo(0.5, 2);
        });

        it('should return default stats for empty cache', () => {
            qValueManager.clearCache();

            const stats = qValueManager.getQValueDistribution();

            expect(stats.count).toBe(0);
            expect(stats.mean).toBe(0.5); // default
        });
    });

    describe('Configuration', () => {
        it('should return current configuration', () => {
            const config = qValueManager.getConfig();

            expect(config.enabled).toBe(true);
            expect(config.defaultQValue).toBe(0.5);
            expect(config.learningRate).toBe(0.1);
        });

        it('should update configuration', () => {
            qValueManager.updateConfig({ learningRate: 0.2 });

            const config = qValueManager.getConfig();
            expect(config.learningRate).toBe(0.2);

            // Reset
            qValueManager.updateConfig({ learningRate: 0.1 });
        });
    });
});
