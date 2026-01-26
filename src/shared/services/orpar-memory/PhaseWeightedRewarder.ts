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
 * PhaseWeightedRewarder
 *
 * Attributes Q-value rewards based on phase contribution to task success.
 * This service implements phase-weighted reward attribution for the MULS system.
 *
 * Phase Weights:
 * | Phase       | Weight | Rationale                                |
 * |-------------|--------|------------------------------------------|
 * | OBSERVATION | 0.15   | Context gathering, indirect impact       |
 * | REASONING   | 0.20   | Analysis quality affects decisions       |
 * | PLANNING    | 0.30   | Strategic decisions are critical         |
 * | ACTION      | 0.25   | Execution directly affects outcome       |
 * | REFLECTION  | 0.10   | Meta-cognition improves future cycles    |
 *
 * Algorithm:
 * For each memory used in ORPAR cycle:
 *   totalWeight = sum of weights for phases where memory was used
 *   memoryReward = baseReward × (usedPhaseWeights / totalWeight)
 *   Apply EMA update: Q_new = Q_old + α(memoryReward - Q_old)
 *
 * Feature flag: ORPAR_MEMORY_INTEGRATION_ENABLED
 */

import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import {
    OrparPhase,
    QValueUpdate,
    MemoryUsageRecord,
    TaskOutcomeStatus,
    DEFAULT_REWARD_MAPPING
} from '../../types/MemoryUtilityTypes';
import {
    PhaseWeightConfig,
    PhaseWeightedRewardResult,
    CycleMemoryUsage,
    CycleOutcome,
    DEFAULT_PHASE_WEIGHTS
} from '../../types/OrparMemoryIntegrationTypes';
import { OrparMemoryEvents } from '../../events/event-definitions/OrparMemoryEvents';
import {
    getOrparMemoryConfig,
    isOrparMemoryIntegrationEnabled,
    getPhaseWeights,
    getPhaseWeight
} from '../../config/orpar-memory.config';
import { QValueManager } from '../QValueManager';
import { AgentId, ChannelId } from '../../types/ChannelContext';

/**
 * PhaseWeightedRewarder attributes Q-value rewards based on phase contribution
 */
export class PhaseWeightedRewarder {
    private static instance: PhaseWeightedRewarder;
    private logger: Logger;
    private qValueManager: QValueManager;
    private enabled: boolean = false;
    private phaseWeights: PhaseWeightConfig;
    private learningRate: number = 0.1;

    private constructor() {
        this.logger = new Logger('info', 'PhaseWeightedRewarder');
        this.qValueManager = QValueManager.getInstance();
        this.phaseWeights = DEFAULT_PHASE_WEIGHTS;
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): PhaseWeightedRewarder {
        if (!PhaseWeightedRewarder.instance) {
            PhaseWeightedRewarder.instance = new PhaseWeightedRewarder();
        }
        return PhaseWeightedRewarder.instance;
    }

    /**
     * Initialize the PhaseWeightedRewarder
     */
    public initialize(): void {
        this.enabled = isOrparMemoryIntegrationEnabled();
        this.phaseWeights = getPhaseWeights();

        if (this.enabled) {
            this.logger.info('[PhaseWeightedRewarder] Initialized with ORPAR-Memory integration');
            this.logger.info(
                `[PhaseWeightedRewarder] Phase weights: ` +
                `obs=${this.phaseWeights.observation}, ` +
                `reasoning=${this.phaseWeights.reasoning}, ` +
                `planning=${this.phaseWeights.planning}, ` +
                `action=${this.phaseWeights.action}, ` +
                `reflection=${this.phaseWeights.reflection}`
            );
        } else {
            this.logger.debug('[PhaseWeightedRewarder] ORPAR-Memory integration is disabled');
        }
    }

    /**
     * Check if the rewarder is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Calculate phase-weighted rewards for all memories used in a cycle
     *
     * @param cycleMemoryUsage - Memory usage records from the cycle
     * @param outcome - The cycle outcome
     * @returns Array of reward results for each memory
     */
    public calculateRewards(
        cycleMemoryUsage: CycleMemoryUsage,
        outcome: CycleOutcome
    ): PhaseWeightedRewardResult[] {
        if (!this.enabled) {
            return [];
        }

        // Calculate base reward from outcome
        const baseReward = this.calculateBaseReward(outcome);

        // Collect all unique memory IDs and their phase usage
        const memoryPhaseUsage = this.collectMemoryPhaseUsage(cycleMemoryUsage);

        // Calculate rewards for each memory
        const results: PhaseWeightedRewardResult[] = [];

        for (const [memoryId, phases] of memoryPhaseUsage) {
            const result = this.calculateMemoryReward(
                memoryId,
                phases,
                baseReward,
                cycleMemoryUsage
            );
            results.push(result);

            // Emit event for each calculation
            this.emitRewardCalculatedEvent(result, cycleMemoryUsage);
        }

        this.logger.info(
            `[PhaseWeightedRewarder] Calculated rewards for ${results.length} memories ` +
            `(baseReward: ${baseReward.toFixed(3)}, outcome: ${outcome.success ? 'success' : 'failure'})`
        );

        return results;
    }

    /**
     * Apply rewards to memories via QValueManager
     *
     * @param rewards - Calculated rewards
     * @param context - Context for the update
     * @returns Number of memories updated
     */
    public async applyRewards(
        rewards: PhaseWeightedRewardResult[],
        context: {
            agentId: AgentId;
            channelId: ChannelId;
            cycleId: string;
            taskId?: string;
        }
    ): Promise<number> {
        if (!this.enabled || !this.qValueManager.isEnabled()) {
            return 0;
        }

        // Batch update Q-values
        const updates: QValueUpdate[] = rewards.map(r => r.qValueUpdate);
        const result = await this.qValueManager.batchUpdateQValues(updates);

        // Fix #8: Emit batch applied event with error handling
        const totalReward = rewards.reduce((sum, r) => sum + r.reward, 0);
        try {
            EventBus.server.emit(OrparMemoryEvents.PHASE_REWARDS_BATCH_APPLIED, {
                agentId: context.agentId,
                channelId: context.channelId,
                cycleId: context.cycleId,
                memoriesUpdated: result.updated,
                totalRewardApplied: totalReward
            });
        } catch (error) {
            this.logger.warn(
                `[PhaseWeightedRewarder] Failed to emit PHASE_REWARDS_BATCH_APPLIED event: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
            // Don't fail the operation - the Q-values were already updated
        }

        this.logger.info(
            `[PhaseWeightedRewarder] Applied rewards to ${result.updated} memories ` +
            `(failed: ${result.failed}, totalReward: ${totalReward.toFixed(3)})`
        );

        return result.updated;
    }

    /**
     * Calculate and apply rewards in one operation
     *
     * @param cycleMemoryUsage - Memory usage records from the cycle
     * @param outcome - The cycle outcome
     * @returns Reward results and number of memories updated
     */
    public async processOutcome(
        cycleMemoryUsage: CycleMemoryUsage,
        outcome: CycleOutcome
    ): Promise<{ rewards: PhaseWeightedRewardResult[]; updated: number }> {
        const rewards = this.calculateRewards(cycleMemoryUsage, outcome);

        if (rewards.length === 0) {
            return { rewards, updated: 0 };
        }

        const updated = await this.applyRewards(rewards, {
            agentId: cycleMemoryUsage.agentId,
            channelId: cycleMemoryUsage.channelId,
            cycleId: cycleMemoryUsage.cycleId,
            taskId: cycleMemoryUsage.taskId
        });

        // Emit attributed event
        EventBus.server.emit(OrparMemoryEvents.PHASE_REWARD_ATTRIBUTED, {
            agentId: cycleMemoryUsage.agentId,
            channelId: cycleMemoryUsage.channelId,
            cycleId: cycleMemoryUsage.cycleId,
            taskId: cycleMemoryUsage.taskId,
            rewardResults: rewards,
            totalMemoriesRewarded: updated,
            cycleOutcome: outcome
        });

        return { rewards, updated };
    }

    /**
     * Calculate base reward from cycle outcome
     */
    private calculateBaseReward(outcome: CycleOutcome): number {
        let baseReward: number;

        if (outcome.success) {
            baseReward = DEFAULT_REWARD_MAPPING.success;
            // Modulate by quality score if available
            if (outcome.qualityScore !== undefined) {
                baseReward *= outcome.qualityScore;
            }
        } else {
            // Partial success if some tool calls succeeded
            if (outcome.taskCompleted) {
                baseReward = DEFAULT_REWARD_MAPPING.partial;
            } else if (outcome.errorCount > 0) {
                baseReward = DEFAULT_REWARD_MAPPING.failure;
            } else {
                baseReward = DEFAULT_REWARD_MAPPING.timeout;
            }
        }

        return baseReward;
    }

    /**
     * Collect memory usage by phase
     */
    private collectMemoryPhaseUsage(
        cycleMemoryUsage: CycleMemoryUsage
    ): Map<string, Set<OrparPhase>> {
        const memoryPhases = new Map<string, Set<OrparPhase>>();

        const phases: OrparPhase[] = ['observation', 'reasoning', 'planning', 'action', 'reflection'];

        for (const phase of phases) {
            const phaseUsage = cycleMemoryUsage.phaseUsage[phase];
            for (const record of phaseUsage) {
                let phases = memoryPhases.get(record.memoryId);
                if (!phases) {
                    phases = new Set();
                    memoryPhases.set(record.memoryId, phases);
                }
                phases.add(phase);
            }
        }

        return memoryPhases;
    }

    /**
     * Calculate reward for a single memory
     */
    private calculateMemoryReward(
        memoryId: string,
        usedInPhases: Set<OrparPhase>,
        baseReward: number,
        cycleMemoryUsage: CycleMemoryUsage
    ): PhaseWeightedRewardResult {
        // Calculate total weight of phases where memory was used
        let usedPhaseWeightSum = 0;
        const phaseContributions: Partial<Record<OrparPhase, number>> = {};

        for (const phase of usedInPhases) {
            const weight = this.phaseWeights[phase];
            usedPhaseWeightSum += weight;
            phaseContributions[phase] = weight;
        }

        // Calculate total possible weight (always 1.0 if weights are normalized)
        const totalPossibleWeight = Object.values(this.phaseWeights).reduce((a, b) => a + b, 0);

        // Calculate proportional reward
        // memoryReward = baseReward × (usedPhaseWeights / totalPossibleWeight)
        const proportionalFactor = totalPossibleWeight > 0
            ? usedPhaseWeightSum / totalPossibleWeight
            : 0;
        const memoryReward = baseReward * proportionalFactor;

        // Create Q-value update
        const qValueUpdate: QValueUpdate = {
            memoryId,
            reward: memoryReward,
            learningRate: this.learningRate,
            context: {
                taskId: cycleMemoryUsage.taskId,
                agentId: cycleMemoryUsage.agentId,
                channelId: cycleMemoryUsage.channelId,
                timestamp: Date.now()
            }
        };

        return {
            memoryId,
            reward: memoryReward,
            phaseContributions,
            baseReward,
            totalPhaseWeight: usedPhaseWeightSum,
            qValueUpdate
        };
    }

    /**
     * Emit reward calculated event
     */
    private emitRewardCalculatedEvent(
        result: PhaseWeightedRewardResult,
        cycleMemoryUsage: CycleMemoryUsage
    ): void {
        EventBus.server.emit(OrparMemoryEvents.PHASE_REWARD_CALCULATED, {
            agentId: cycleMemoryUsage.agentId,
            channelId: cycleMemoryUsage.channelId,
            memoryId: result.memoryId,
            reward: result.reward,
            phaseContributions: result.phaseContributions
        });
    }

    /**
     * Get the weight for a specific phase
     */
    public getPhaseWeight(phase: OrparPhase): number {
        return this.phaseWeights[phase];
    }

    /**
     * Get all phase weights
     */
    public getPhaseWeights(): PhaseWeightConfig {
        return { ...this.phaseWeights };
    }

    /**
     * Update phase weights at runtime
     */
    public updatePhaseWeights(weights: Partial<PhaseWeightConfig>): void {
        this.phaseWeights = {
            ...this.phaseWeights,
            ...weights
        };

        // Validate weights sum to approximately 1.0
        const sum = Object.values(this.phaseWeights).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1.0) > 0.01) {
            this.logger.warn(
                `[PhaseWeightedRewarder] Phase weights sum to ${sum.toFixed(3)}, expected ~1.0`
            );
        }
    }

    /**
     * Set the learning rate for Q-value updates
     */
    public setLearningRate(rate: number): void {
        if (rate <= 0 || rate > 1) {
            throw new Error('Learning rate must be between 0 and 1');
        }
        this.learningRate = rate;
    }

    /**
     * Reset the rewarder (useful for testing)
     */
    public reset(): void {
        this.enabled = false;
        this.phaseWeights = DEFAULT_PHASE_WEIGHTS;
        this.learningRate = 0.1;
    }
}
