/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * RewardSignalProcessor
 *
 * Converts task outcomes to Q-value updates for the Memory Utility Learning System (MULS).
 * Subscribes to task completion events and attributes rewards to memories that were
 * retrieved and used during task execution.
 *
 * Reward Attribution Strategy:
 * - All memories used during a task receive the same reward signal
 * - Reward is based on task outcome (success, failure, partial, timeout)
 * - Step-level feedback provides more granular attribution (optional)
 * - Manual injection allows explicit feedback for specific memories
 *
 * Feature flag: MEMORY_UTILITY_LEARNING_ENABLED
 */

import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { QValueManager, BatchUpdateResult } from './QValueManager';
import {
    TaskOutcome,
    TaskOutcomeStatus,
    StepOutcome,
    RewardMapping,
    DEFAULT_REWARD_MAPPING,
    MemoryUsageRecord,
    QValueUpdate,
    MemoryUtilityConfig,
    DEFAULT_MEMORY_UTILITY_CONFIG,
    getMulsConfigFromEnv,
    OrparPhase
} from '../types/MemoryUtilityTypes';
import { AgentId, ChannelId } from '../types/ChannelContext';
import { createMemoryRewardAttributedPayload } from '../schemas/EventPayloadSchema';

/**
 * Result of processing a task outcome
 */
export interface ProcessingResult {
    taskId: string;
    memoriesUpdated: number;
    memoriesFailed: number;
    reward: number;
    processingTimeMs: number;
}

/**
 * Result of manual reward injection
 */
export interface InjectionResult {
    memoryId: string;
    success: boolean;
    newQValue?: number;
    error?: string;
}

/**
 * RewardSignalProcessor - Singleton service for task-to-reward conversion
 */
export class RewardSignalProcessor {
    private static instance: RewardSignalProcessor;
    private logger: Logger;
    private qValueManager: QValueManager;
    private config: MemoryUtilityConfig;
    private enabled: boolean = false;

    // Reward mapping
    private rewardMapping: RewardMapping;

    // Memory usage tracking (task ID -> memories used)
    private taskMemoryUsage: Map<string, MemoryUsageRecord[]> = new Map();

    // Event listener cleanup functions
    private eventCleanupFns: (() => void)[] = [];

    private constructor() {
        this.logger = new Logger('info', 'RewardSignalProcessor');
        this.qValueManager = QValueManager.getInstance();
        this.config = {
            ...DEFAULT_MEMORY_UTILITY_CONFIG,
            ...getMulsConfigFromEnv()
        };
        this.rewardMapping = this.config.rewardMapping ?? DEFAULT_REWARD_MAPPING;
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): RewardSignalProcessor {
        if (!RewardSignalProcessor.instance) {
            RewardSignalProcessor.instance = new RewardSignalProcessor();
        }
        return RewardSignalProcessor.instance;
    }

    /**
     * Initialize the RewardSignalProcessor with configuration
     */
    public initialize(config?: Partial<MemoryUtilityConfig>): void {
        if (config) {
            this.config = { ...this.config, ...config };
            if (config.rewardMapping) {
                this.rewardMapping = config.rewardMapping;
            }
        }
        this.enabled = this.config.enabled;

        if (this.enabled) {
            this.setupEventListeners();
            this.logger.info('[RewardSignalProcessor] Initialized with MULS enabled');
            this.logger.info(`[RewardSignalProcessor] Reward mapping: success=${this.rewardMapping.success}, failure=${this.rewardMapping.failure}`);
        } else {
            this.logger.info('[RewardSignalProcessor] MULS is disabled');
        }
    }

    /**
     * Check if MULS is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Set up event listeners for task completion
     */
    private setupEventListeners(): void {
        // Clean up any existing listeners
        this.cleanupEventListeners();

        try {
            // Listen for task completion events
            const taskCompletedHandler = (payload: any) => {
                this.handleTaskCompleted(payload);
            };
            EventBus.server.on(Events.Task.COMPLETED, taskCompletedHandler);
            this.eventCleanupFns.push(() => EventBus.server.off(Events.Task.COMPLETED, taskCompletedHandler));

            // Listen for analytics task completed events (may have evaluation scores)
            const analyticsCompletedHandler = (payload: any) => {
                this.handleAnalyticsTaskCompleted(payload);
            };
            EventBus.server.on(Events.Analytics.TASK_COMPLETED, analyticsCompletedHandler);
            this.eventCleanupFns.push(() => EventBus.server.off(Events.Analytics.TASK_COMPLETED, analyticsCompletedHandler));

            this.logger.info('[RewardSignalProcessor] Event listeners registered');
        } catch (error) {
            this.logger.warn(`[RewardSignalProcessor] Could not set up event listeners: ${error}`);
        }
    }

    /**
     * Clean up event listeners
     */
    private cleanupEventListeners(): void {
        for (const cleanup of this.eventCleanupFns) {
            cleanup();
        }
        this.eventCleanupFns = [];
    }

    /**
     * Handle task completion event
     */
    private async handleTaskCompleted(payload: any): Promise<void> {
        if (!this.enabled) return;

        try {
            const taskId = payload.data?.taskId ?? payload.taskId;
            const status = this.mapStatusToOutcome(payload.data?.status ?? payload.status);
            const agentId = payload.agentId ?? payload.data?.agentId;
            const channelId = payload.channelId ?? payload.data?.channelId;

            // Get memories used during this task
            const memoriesUsed = this.taskMemoryUsage.get(taskId) ?? [];

            if (memoriesUsed.length === 0) {
                this.logger.debug(`[RewardSignalProcessor] No memories tracked for task ${taskId}`);
                return;
            }

            const outcome: TaskOutcome = {
                taskId,
                agentId,
                channelId,
                status,
                memoriesUsed,
                completedAt: new Date()
            };

            await this.processTaskOutcome(outcome);

            // Clean up tracking
            this.taskMemoryUsage.delete(taskId);
        } catch (error) {
            this.logger.error(`[RewardSignalProcessor] Error handling task completion: ${error}`);
        }
    }

    /**
     * Handle analytics task completed event (may have quality scores)
     */
    private async handleAnalyticsTaskCompleted(payload: any): Promise<void> {
        if (!this.enabled) return;

        try {
            const taskId = payload.data?.taskId ?? payload.taskId;
            const qualityScore = payload.data?.qualityScore ?? payload.data?.effectivenessScore;

            // Get memories used during this task
            const memoriesUsed = this.taskMemoryUsage.get(taskId);
            if (!memoriesUsed || memoriesUsed.length === 0) {
                return;
            }

            // If we have a quality score, use it directly as reward
            if (typeof qualityScore === 'number') {
                const outcome: TaskOutcome = {
                    taskId,
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    status: 'success',
                    memoriesUsed,
                    metrics: {
                        qualityScore
                    },
                    completedAt: new Date()
                };

                await this.processTaskOutcome(outcome);
                this.taskMemoryUsage.delete(taskId);
            }
        } catch (error) {
            this.logger.error(`[RewardSignalProcessor] Error handling analytics completion: ${error}`);
        }
    }

    /**
     * Map task status string to TaskOutcomeStatus
     */
    private mapStatusToOutcome(status: string): TaskOutcomeStatus {
        switch (status?.toLowerCase()) {
            case 'completed':
            case 'success':
            case 'succeeded':
                return 'success';
            case 'failed':
            case 'failure':
            case 'error':
                return 'failure';
            case 'partial':
            case 'partially_completed':
                return 'partial';
            case 'timeout':
            case 'timed_out':
                return 'timeout';
            default:
                return 'partial'; // Default to partial for unknown statuses
        }
    }

    /**
     * Process a task outcome and update Q-values for all memories used
     */
    public async processTaskOutcome(outcome: TaskOutcome): Promise<ProcessingResult> {
        const startTime = Date.now();

        if (!this.enabled) {
            return {
                taskId: outcome.taskId,
                memoriesUpdated: 0,
                memoriesFailed: 0,
                reward: 0,
                processingTimeMs: 0
            };
        }

        // Calculate reward based on outcome
        let reward = this.rewardMapping[outcome.status];

        // If we have a quality score, use it to modulate the reward
        if (outcome.metrics?.qualityScore !== undefined) {
            // Quality score is 0-1, modulate reward
            const baseReward = reward;
            const qualityModulator = outcome.metrics.qualityScore;
            reward = baseReward * qualityModulator;
        }

        // Create Q-value updates for all memories used
        const updates: QValueUpdate[] = outcome.memoriesUsed.map(usage => ({
            memoryId: usage.memoryId,
            reward,
            context: {
                taskId: outcome.taskId,
                agentId: outcome.agentId,
                channelId: outcome.channelId,
                phase: usage.phase,
                timestamp: Date.now()
            }
        }));

        // Batch update Q-values
        const result = await this.qValueManager.batchUpdateQValues(updates);

        // Emit reward attribution event
        this.emitRewardAttributionEvent(outcome, reward, result);

        const processingTimeMs = Date.now() - startTime;

        this.logger.info(
            `[RewardSignalProcessor] Processed task ${outcome.taskId}: ` +
            `status=${outcome.status}, reward=${reward.toFixed(3)}, ` +
            `memories=${result.updated}/${updates.length}`
        );

        return {
            taskId: outcome.taskId,
            memoriesUpdated: result.updated,
            memoriesFailed: result.failed,
            reward,
            processingTimeMs
        };
    }

    /**
     * Process a step-level outcome for more granular reward attribution
     */
    public async processStepOutcome(outcome: StepOutcome): Promise<ProcessingResult> {
        if (!this.enabled) {
            return {
                taskId: outcome.taskId,
                memoriesUpdated: 0,
                memoriesFailed: 0,
                reward: 0,
                processingTimeMs: 0
            };
        }

        const startTime = Date.now();

        // Map step status to reward
        let reward: number;
        switch (outcome.status) {
            case 'success':
                reward = outcome.qualityScore ?? this.rewardMapping.success * 0.3; // Smaller than task-level
                break;
            case 'failure':
                reward = this.rewardMapping.failure * 0.3;
                break;
            case 'skipped':
                reward = 0; // Neutral
                break;
            default:
                reward = 0;
        }

        // Create Q-value updates for memories used in this step
        const updates: QValueUpdate[] = outcome.memoriesUsed.map(memoryId => ({
            memoryId,
            reward,
            context: {
                taskId: outcome.taskId,
                timestamp: Date.now()
            }
        }));

        const result = await this.qValueManager.batchUpdateQValues(updates);

        const processingTimeMs = Date.now() - startTime;

        this.logger.debug(
            `[RewardSignalProcessor] Processed step ${outcome.stepId}: ` +
            `status=${outcome.status}, reward=${reward.toFixed(3)}, memories=${result.updated}`
        );

        return {
            taskId: outcome.taskId,
            memoriesUpdated: result.updated,
            memoriesFailed: result.failed,
            reward,
            processingTimeMs
        };
    }

    /**
     * Manually inject a reward for a specific memory
     * @param memoryId - The memory ID to reward
     * @param reward - The reward signal (-1 to 1)
     * @param reason - Reason for the manual injection
     * @param agentId - Optional agent ID for event context (defaults to 'system')
     * @param channelId - Optional channel ID for event context (defaults to 'global')
     */
    public async injectReward(
        memoryId: string,
        reward: number,
        reason: string,
        agentId?: AgentId,
        channelId?: ChannelId
    ): Promise<InjectionResult> {
        if (!this.enabled) {
            return {
                memoryId,
                success: false,
                error: 'MULS is disabled'
            };
        }

        // Use provided context or defaults
        const effectiveAgentId = agentId ?? 'system';
        const effectiveChannelId = channelId ?? 'global';

        try {
            const newQValue = await this.qValueManager.updateQValue(
                memoryId,
                reward,
                undefined, // use default learning rate
                effectiveAgentId,
                effectiveChannelId
            );

            this.logger.info(
                `[RewardSignalProcessor] Manual reward injection: ` +
                `memoryId=${memoryId}, reward=${reward}, reason="${reason}"`
            );

            // Emit event for tracking with context
            this.emitManualInjectionEvent(memoryId, reward, reason, newQValue, effectiveAgentId, effectiveChannelId);

            return {
                memoryId,
                success: true,
                newQValue
            };
        } catch (error) {
            return {
                memoryId,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Track memory usage for a task
     */
    public trackMemoryUsage(
        taskId: string,
        memoryId: string,
        phase: OrparPhase,
        usageType?: MemoryUsageRecord['usageType']
    ): void {
        if (!this.enabled || !this.config.trackMemoryUsage) return;

        let usageRecords = this.taskMemoryUsage.get(taskId);
        if (!usageRecords) {
            usageRecords = [];
            this.taskMemoryUsage.set(taskId, usageRecords);
        }

        // Check if already tracked
        const existing = usageRecords.find(u => u.memoryId === memoryId);
        if (!existing) {
            usageRecords.push({
                memoryId,
                phase,
                retrievedAt: new Date(),
                usageType
            });

            this.logger.debug(
                `[RewardSignalProcessor] Tracked memory ${memoryId} for task ${taskId} (phase=${phase})`
            );
        }
    }

    /**
     * Track multiple memories for a task
     */
    public trackMemoriesUsage(
        taskId: string,
        memoryIds: string[],
        phase: OrparPhase
    ): void {
        for (const memoryId of memoryIds) {
            this.trackMemoryUsage(taskId, memoryId, phase);
        }
    }

    /**
     * Get tracked memories for a task
     */
    public getTrackedMemories(taskId: string): MemoryUsageRecord[] {
        return this.taskMemoryUsage.get(taskId) ?? [];
    }

    /**
     * Clear tracked memories for a task
     */
    public clearTrackedMemories(taskId: string): void {
        this.taskMemoryUsage.delete(taskId);
    }

    /**
     * Get current reward mapping
     */
    public getRewardMapping(): RewardMapping {
        return { ...this.rewardMapping };
    }

    /**
     * Update reward mapping
     */
    public setRewardMapping(mapping: Partial<RewardMapping>): void {
        this.rewardMapping = { ...this.rewardMapping, ...mapping };
        this.logger.info(`[RewardSignalProcessor] Reward mapping updated: ${JSON.stringify(this.rewardMapping)}`);
    }

    /**
     * Emit reward attribution event using proper payload structure
     * @param outcome - Task outcome that triggered the attribution
     * @param reward - Reward value attributed
     * @param result - Batch update result
     */
    private emitRewardAttributionEvent(
        outcome: TaskOutcome,
        reward: number,
        result: BatchUpdateResult
    ): void {
        try {
            // Use agent/channel from outcome or defaults
            const agentId = outcome.agentId ?? 'system';
            const channelId = outcome.channelId ?? 'global';

            EventBus.server.emit(
                Events.MemoryUtility.REWARD_ATTRIBUTED,
                createMemoryRewardAttributedPayload(agentId, channelId, {
                    taskId: outcome.taskId,
                    status: outcome.status,
                    reward,
                    memoriesUpdated: result.updated,
                    memoriesFailed: result.failed,
                    memoryIds: outcome.memoriesUsed.map(u => u.memoryId)
                })
            );
        } catch (error) {
            this.logger.debug(`[RewardSignalProcessor] Could not emit reward_attributed event: ${error}`);
        }
    }

    /**
     * Emit manual injection event using proper payload structure
     * @param memoryId - The memory ID that was rewarded
     * @param reward - Reward value injected
     * @param reason - Reason for manual injection
     * @param newQValue - New Q-value after injection
     * @param agentId - Agent context for the event
     * @param channelId - Channel context for the event
     */
    private emitManualInjectionEvent(
        memoryId: string,
        reward: number,
        reason: string,
        newQValue: number,
        agentId: AgentId,
        channelId: ChannelId
    ): void {
        try {
            EventBus.server.emit(
                Events.MemoryUtility.REWARD_ATTRIBUTED,
                createMemoryRewardAttributedPayload(agentId, channelId, {
                    memoryId,
                    reward,
                    reason,
                    newQValue,
                    isManual: true,
                    memoriesUpdated: 1,
                    memoriesFailed: 0,
                    memoryIds: [memoryId]
                })
            );
        } catch (error) {
            this.logger.debug(`[RewardSignalProcessor] Could not emit manual injection event: ${error}`);
        }
    }

    /**
     * Get tracking statistics
     */
    public getTrackingStats(): { activeTasks: number; totalMemoriesTracked: number } {
        let totalMemories = 0;
        for (const [, records] of this.taskMemoryUsage) {
            totalMemories += records.length;
        }
        return {
            activeTasks: this.taskMemoryUsage.size,
            totalMemoriesTracked: totalMemories
        };
    }

    /**
     * Shutdown and cleanup
     */
    public shutdown(): void {
        this.cleanupEventListeners();
        this.taskMemoryUsage.clear();
        this.logger.info('[RewardSignalProcessor] Shutdown complete');
    }

    /**
     * Get current configuration
     */
    public getConfig(): MemoryUtilityConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    public updateConfig(updates: Partial<MemoryUtilityConfig>): void {
        this.config = { ...this.config, ...updates };
        this.enabled = this.config.enabled;
        if (updates.rewardMapping) {
            this.rewardMapping = updates.rewardMapping;
        }
        this.logger.info('[RewardSignalProcessor] Configuration updated');
    }
}
