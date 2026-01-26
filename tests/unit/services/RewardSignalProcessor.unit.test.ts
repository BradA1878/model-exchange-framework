/**
 * Unit tests for RewardSignalProcessor
 * Tests reward mapping correctness and batch attribution
 */

import { RewardSignalProcessor } from '@mxf/shared/services/RewardSignalProcessor';
import { QValueManager } from '@mxf/shared/services/QValueManager';
import { TaskOutcome, DEFAULT_REWARD_MAPPING } from '@mxf/shared/types/MemoryUtilityTypes';

describe('RewardSignalProcessor Unit Tests', () => {
    let rewardProcessor: RewardSignalProcessor;
    let qValueManager: QValueManager;

    beforeAll(() => {
        qValueManager = QValueManager.getInstance();
        qValueManager.initialize({
            enabled: true,
            defaultQValue: 0.5,
            learningRate: 0.1
        });

        rewardProcessor = RewardSignalProcessor.getInstance();
        rewardProcessor.initialize({
            enabled: true,
            rewardMapping: DEFAULT_REWARD_MAPPING,
            trackMemoryUsage: true
        });
    });

    beforeEach(() => {
        qValueManager.clearCache();
    });

    describe('Reward Mapping', () => {
        it('should use correct reward for success', async () => {
            const memoryId = 'success-mem';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const outcome: TaskOutcome = {
                taskId: 'task-1',
                agentId: 'agent-1',
                channelId: 'channel-1',
                status: 'success',
                memoriesUsed: [
                    { memoryId, phase: 'action', retrievedAt: new Date() }
                ],
                completedAt: new Date()
            };

            const result = await rewardProcessor.processTaskOutcome(outcome);

            expect(result.reward).toBe(1.0); // default success reward
            expect(result.memoriesUpdated).toBe(1);
        });

        it('should use correct reward for failure', async () => {
            const memoryId = 'failure-mem';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const outcome: TaskOutcome = {
                taskId: 'task-2',
                agentId: 'agent-1',
                channelId: 'channel-1',
                status: 'failure',
                memoriesUsed: [
                    { memoryId, phase: 'action', retrievedAt: new Date() }
                ],
                completedAt: new Date()
            };

            const result = await rewardProcessor.processTaskOutcome(outcome);

            expect(result.reward).toBe(-1.0); // default failure reward
        });

        it('should use correct reward for partial', async () => {
            const memoryId = 'partial-mem';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const outcome: TaskOutcome = {
                taskId: 'task-3',
                agentId: 'agent-1',
                channelId: 'channel-1',
                status: 'partial',
                memoriesUsed: [
                    { memoryId, phase: 'action', retrievedAt: new Date() }
                ],
                completedAt: new Date()
            };

            const result = await rewardProcessor.processTaskOutcome(outcome);

            expect(result.reward).toBe(0.3); // default partial reward
        });

        it('should use correct reward for timeout', async () => {
            const memoryId = 'timeout-mem';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const outcome: TaskOutcome = {
                taskId: 'task-4',
                agentId: 'agent-1',
                channelId: 'channel-1',
                status: 'timeout',
                memoriesUsed: [
                    { memoryId, phase: 'action', retrievedAt: new Date() }
                ],
                completedAt: new Date()
            };

            const result = await rewardProcessor.processTaskOutcome(outcome);

            expect(result.reward).toBe(-0.5); // default timeout reward
        });
    });

    describe('Batch Attribution', () => {
        it('should attribute reward to all retrieved memories', async () => {
            const memoryIds = ['batch-1', 'batch-2', 'batch-3'];
            memoryIds.forEach(id => qValueManager.setQValueInCache(id, 0.5));

            const outcome: TaskOutcome = {
                taskId: 'batch-task',
                agentId: 'agent-1',
                channelId: 'channel-1',
                status: 'success',
                memoriesUsed: memoryIds.map(memoryId => ({
                    memoryId,
                    phase: 'reasoning' as const,
                    retrievedAt: new Date()
                })),
                completedAt: new Date()
            };

            const result = await rewardProcessor.processTaskOutcome(outcome);

            expect(result.memoriesUpdated).toBe(3);
            expect(result.memoriesFailed).toBe(0);

            // All memories should have updated Q-values (higher than initial 0.5)
            for (const memoryId of memoryIds) {
                const newQ = qValueManager.getQValue(memoryId);
                expect(newQ).toBeGreaterThan(0.5);
            }
        });

        it('should handle empty memories list', async () => {
            const outcome: TaskOutcome = {
                taskId: 'empty-task',
                agentId: 'agent-1',
                channelId: 'channel-1',
                status: 'success',
                memoriesUsed: [],
                completedAt: new Date()
            };

            const result = await rewardProcessor.processTaskOutcome(outcome);

            expect(result.memoriesUpdated).toBe(0);
            expect(result.memoriesFailed).toBe(0);
        });
    });

    describe('Quality Score Modulation', () => {
        it('should modulate reward by quality score when provided', async () => {
            const memoryId = 'quality-mem';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const outcome: TaskOutcome = {
                taskId: 'quality-task',
                agentId: 'agent-1',
                channelId: 'channel-1',
                status: 'success',
                memoriesUsed: [
                    { memoryId, phase: 'action', retrievedAt: new Date() }
                ],
                metrics: {
                    qualityScore: 0.5 // Half quality
                },
                completedAt: new Date()
            };

            const result = await rewardProcessor.processTaskOutcome(outcome);

            // Success reward (1.0) * quality (0.5) = 0.5
            expect(result.reward).toBeCloseTo(0.5, 5);
        });
    });

    describe('Memory Usage Tracking', () => {
        it('should track memory usage for a task', () => {
            const taskId = 'tracking-task';

            rewardProcessor.trackMemoryUsage(taskId, 'track-mem-1', 'observation');
            rewardProcessor.trackMemoryUsage(taskId, 'track-mem-2', 'reasoning');
            rewardProcessor.trackMemoryUsage(taskId, 'track-mem-3', 'action');

            const tracked = rewardProcessor.getTrackedMemories(taskId);

            expect(tracked.length).toBe(3);
            expect(tracked.map(t => t.memoryId)).toContain('track-mem-1');
            expect(tracked.map(t => t.memoryId)).toContain('track-mem-2');
            expect(tracked.map(t => t.memoryId)).toContain('track-mem-3');
        });

        it('should track multiple memories at once', () => {
            const taskId = 'bulk-tracking-task';

            rewardProcessor.trackMemoriesUsage(
                taskId,
                ['bulk-1', 'bulk-2', 'bulk-3'],
                'planning'
            );

            const tracked = rewardProcessor.getTrackedMemories(taskId);
            expect(tracked.length).toBe(3);
            expect(tracked.every(t => t.phase === 'planning')).toBe(true);
        });

        it('should not duplicate tracked memories', () => {
            const taskId = 'dedup-task';

            rewardProcessor.trackMemoryUsage(taskId, 'dedup-mem', 'observation');
            rewardProcessor.trackMemoryUsage(taskId, 'dedup-mem', 'observation');
            rewardProcessor.trackMemoryUsage(taskId, 'dedup-mem', 'observation');

            const tracked = rewardProcessor.getTrackedMemories(taskId);
            expect(tracked.length).toBe(1);
        });

        it('should clear tracked memories', () => {
            const taskId = 'clear-tracking-task';

            rewardProcessor.trackMemoryUsage(taskId, 'clear-mem', 'action');
            expect(rewardProcessor.getTrackedMemories(taskId).length).toBe(1);

            rewardProcessor.clearTrackedMemories(taskId);
            expect(rewardProcessor.getTrackedMemories(taskId).length).toBe(0);
        });
    });

    describe('Manual Reward Injection', () => {
        it('should inject positive reward', async () => {
            const memoryId = 'inject-pos';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const result = await rewardProcessor.injectReward(
                memoryId,
                0.8,
                'Manually marked as helpful'
            );

            expect(result.success).toBe(true);
            expect(result.newQValue).toBeGreaterThan(0.5);
        });

        it('should inject negative reward', async () => {
            const memoryId = 'inject-neg';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const result = await rewardProcessor.injectReward(
                memoryId,
                -0.8,
                'Manually marked as unhelpful'
            );

            expect(result.success).toBe(true);
            expect(result.newQValue).toBeLessThan(0.5);
        });
    });

    describe('Reward Mapping Configuration', () => {
        it('should get current reward mapping', () => {
            const mapping = rewardProcessor.getRewardMapping();

            expect(mapping.success).toBe(1.0);
            expect(mapping.failure).toBe(-1.0);
            expect(mapping.partial).toBe(0.3);
            expect(mapping.timeout).toBe(-0.5);
        });

        it('should update reward mapping', () => {
            rewardProcessor.setRewardMapping({ success: 0.9 });

            const mapping = rewardProcessor.getRewardMapping();
            expect(mapping.success).toBe(0.9);

            // Reset
            rewardProcessor.setRewardMapping({ success: 1.0 });
        });
    });

    describe('Tracking Statistics', () => {
        it('should return tracking statistics', () => {
            // Add some tracking
            rewardProcessor.trackMemoryUsage('stats-task-1', 'stats-mem-1', 'observation');
            rewardProcessor.trackMemoryUsage('stats-task-2', 'stats-mem-2', 'reasoning');
            rewardProcessor.trackMemoryUsage('stats-task-2', 'stats-mem-3', 'planning');

            const stats = rewardProcessor.getTrackingStats();

            expect(stats.activeTasks).toBeGreaterThanOrEqual(2);
            expect(stats.totalMemoriesTracked).toBeGreaterThanOrEqual(3);
        });
    });

    describe('Step-Level Outcomes', () => {
        it('should process step-level success', async () => {
            const memoryId = 'step-success-mem';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const result = await rewardProcessor.processStepOutcome({
                stepId: 'step-1',
                taskId: 'step-task',
                status: 'success',
                memoriesUsed: [memoryId],
                timestamp: new Date()
            });

            expect(result.memoriesUpdated).toBe(1);
            expect(result.reward).toBeGreaterThan(0);
        });

        it('should process step-level failure', async () => {
            const memoryId = 'step-failure-mem';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const result = await rewardProcessor.processStepOutcome({
                stepId: 'step-2',
                taskId: 'step-task',
                status: 'failure',
                memoriesUsed: [memoryId],
                timestamp: new Date()
            });

            expect(result.memoriesUpdated).toBe(1);
            expect(result.reward).toBeLessThan(0);
        });

        it('should give neutral reward for skipped step', async () => {
            const memoryId = 'step-skipped-mem';
            qValueManager.setQValueInCache(memoryId, 0.5);

            const result = await rewardProcessor.processStepOutcome({
                stepId: 'step-3',
                taskId: 'step-task',
                status: 'skipped',
                memoriesUsed: [memoryId],
                timestamp: new Date()
            });

            expect(result.reward).toBe(0);
        });
    });
});
