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
 * EntityQValueManager
 *
 * Manages Q-value updates for entities in the Knowledge Graph.
 * Integrates with the existing MULS (Memory Utility Learning System) for
 * consistent reward propagation across memories and entities.
 *
 * Features:
 * - EMA-based Q-value updates
 * - Reward propagation from task outcomes
 * - Integration with RewardSignalProcessor
 * - Batch updates for efficiency
 */

import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { KnowledgeGraphEvents } from '../../events/event-definitions/KnowledgeGraphEvents';
import { MongoKnowledgeGraphRepository } from '../../database/adapters/mongodb/MongoKnowledgeGraphRepository';
import {
    isKnowledgeGraphEnabled,
    isQValueLearningEnabled,
    getQValueLearningRate,
} from '../../config/knowledge-graph.config';
import { Entity } from '../../types/KnowledgeGraphTypes';
import { ChannelId } from '../../types/ChannelContext';
import { createBaseEventPayload } from '../../schemas/EventPayloadSchema';

/**
 * Reward signal for entity Q-value update
 */
export interface EntityRewardSignal {
    entityId: string;
    reward: number; // -1 to 1
    reason: string;
    taskId?: string;
    agentId?: string;
}

/**
 * Q-value update result
 */
export interface QValueUpdateResult {
    entityId: string;
    oldQValue: number;
    newQValue: number;
    delta: number;
}

/**
 * EntityQValueManager handles Q-value learning for entities
 */
export class EntityQValueManager {
    private static instance: EntityQValueManager;
    private logger: Logger;
    private enabled: boolean = false;
    private repository: MongoKnowledgeGraphRepository;

    private constructor() {
        this.logger = new Logger('info', 'EntityQValueManager', 'server');
        this.repository = MongoKnowledgeGraphRepository.getInstance();
        this.initialize();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): EntityQValueManager {
        if (!EntityQValueManager.instance) {
            EntityQValueManager.instance = new EntityQValueManager();
        }
        return EntityQValueManager.instance;
    }

    /**
     * Initialize the service
     */
    private initialize(): void {
        this.enabled = isKnowledgeGraphEnabled() && isQValueLearningEnabled();

        if (!this.enabled) {
            this.logger.debug('EntityQValueManager initialized but disabled');
            return;
        }

        this.logger.info(`EntityQValueManager initialized (learning rate: ${getQValueLearningRate()})`);
    }

    /**
     * Check if the service is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Update Q-value for a single entity using EMA formula
     *
     * Q_new = Q_old + α * (reward - Q_old)
     */
    public async updateEntityQValue(signal: EntityRewardSignal): Promise<QValueUpdateResult | null> {
        if (!this.enabled) {
            return null;
        }

        const entity = await this.repository.getEntity(signal.entityId);
        if (!entity) {
            this.logger.warn(`Entity not found for Q-value update: ${signal.entityId}`);
            return null;
        }

        const alpha = getQValueLearningRate();
        const oldQValue = entity.utility.qValue;

        // Normalize reward to 0-1 range for EMA
        const normalizedReward = (signal.reward + 1) / 2;

        // EMA update
        const newQValue = oldQValue + alpha * (normalizedReward - oldQValue);

        // Clamp to valid range
        const clampedQValue = Math.max(0, Math.min(1, newQValue));

        // Update in database
        await this.repository.updateEntityQValue(signal.entityId, clampedQValue, signal.reason);

        const result: QValueUpdateResult = {
            entityId: signal.entityId,
            oldQValue,
            newQValue: clampedQValue,
            delta: clampedQValue - oldQValue,
        };

        // Emit event
        this.emitQValueUpdatedEvent(entity.channelId, signal, oldQValue, clampedQValue);

        this.logger.debug(
            `Updated Q-value for ${entity.name}: ${oldQValue.toFixed(3)} -> ${clampedQValue.toFixed(3)} (${signal.reason})`
        );

        return result;
    }

    /**
     * Propagate task reward to involved entities
     */
    public async propagateTaskReward(
        channelId: ChannelId,
        entityIds: string[],
        taskOutcome: {
            taskId: string;
            success: boolean;
            reward?: number;
            agentId?: string;
        }
    ): Promise<QValueUpdateResult[]> {
        if (!this.enabled || entityIds.length === 0) {
            return [];
        }

        // Calculate reward based on outcome
        const baseReward = taskOutcome.reward ?? (taskOutcome.success ? 0.8 : -0.3);

        const results: QValueUpdateResult[] = [];
        const updates: Array<{ entityId: string; qValue: number; reason: string }> = [];

        for (const entityId of entityIds) {
            const entity = await this.repository.getEntity(entityId);
            if (!entity) continue;

            const alpha = getQValueLearningRate();
            const oldQValue = entity.utility.qValue;
            const normalizedReward = (baseReward + 1) / 2;
            const newQValue = Math.max(0, Math.min(1, oldQValue + alpha * (normalizedReward - oldQValue)));

            results.push({
                entityId,
                oldQValue,
                newQValue,
                delta: newQValue - oldQValue,
            });

            updates.push({
                entityId,
                qValue: newQValue,
                reason: `Task ${taskOutcome.taskId} ${taskOutcome.success ? 'succeeded' : 'failed'}`,
            });
        }

        // Batch update
        if (updates.length > 0) {
            await this.repository.batchUpdateQValues(updates);

            // Record outcomes for statistics
            await this.repository.recordOutcome(entityIds, taskOutcome.success);

            // Emit batch event
            this.emitBatchQValueUpdatedEvent(channelId, results, taskOutcome.taskId);
        }

        return results;
    }

    /**
     * Decay Q-values for entities that haven't been accessed recently
     * Called periodically to prevent stale entities from dominating
     */
    public async decayUnusedEntities(
        channelId: ChannelId,
        decayThresholdMs: number = 7 * 24 * 60 * 60 * 1000, // 7 days
        decayRate: number = 0.95
    ): Promise<number> {
        if (!this.enabled) {
            return 0;
        }

        const cutoffTime = Date.now() - decayThresholdMs;
        const entities = await this.repository.findEntities(channelId);

        const updates: Array<{ entityId: string; qValue: number; reason: string }> = [];

        for (const entity of entities) {
            if (entity.utility.lastAccessedAt < cutoffTime && entity.utility.qValue > 0.3) {
                // Apply decay
                const newQValue = entity.utility.qValue * decayRate;
                updates.push({
                    entityId: entity.id,
                    qValue: Math.max(0.1, newQValue), // Don't decay below minimum
                    reason: 'Periodic decay for unused entity',
                });
            }
        }

        if (updates.length > 0) {
            await this.repository.batchUpdateQValues(updates);
            this.logger.info(`Decayed Q-values for ${updates.length} unused entities in channel ${channelId}`);
        }

        return updates.length;
    }

    /**
     * Boost Q-value for retrieved entities
     * Called when entities are used in context retrieval
     */
    public async boostRetrievedEntities(entityIds: string[], boostAmount: number = 0.05): Promise<void> {
        if (!this.enabled || entityIds.length === 0) {
            return;
        }

        // Increment retrieval counts
        await this.repository.incrementRetrievalCount(entityIds);

        // Small Q-value boost for being retrieved
        const updates: Array<{ entityId: string; qValue: number; reason: string }> = [];

        for (const entityId of entityIds) {
            const entity = await this.repository.getEntity(entityId);
            if (entity) {
                const newQValue = Math.min(1, entity.utility.qValue + boostAmount);
                if (newQValue !== entity.utility.qValue) {
                    updates.push({
                        entityId,
                        qValue: newQValue,
                        reason: 'Retrieved for context',
                    });
                }
            }
        }

        if (updates.length > 0) {
            await this.repository.batchUpdateQValues(updates);
        }
    }

    /**
     * Get entities ranked by utility (Q-value * retrieval frequency)
     */
    public async getTopUtilityEntities(
        channelId: ChannelId,
        limit: number = 20
    ): Promise<Entity[]> {
        if (!this.enabled) {
            return [];
        }

        // Get high Q-value entities
        return this.repository.getEntitiesByQValue(channelId, 0.5, undefined, limit);
    }

    /**
     * Emit Q-value updated event
     */
    private emitQValueUpdatedEvent(
        channelId: ChannelId,
        signal: EntityRewardSignal,
        oldQValue: number,
        newQValue: number
    ): void {
        try {
            const payload = createBaseEventPayload(
                KnowledgeGraphEvents.ENTITY_QVALUE_UPDATED,
                signal.agentId || 'system',
                channelId,
                {
                    entityId: signal.entityId,
                    channelId,
                    oldQValue,
                    newQValue,
                    reason: signal.reason,
                    taskId: signal.taskId,
                }
            );
            EventBus.server.emit(KnowledgeGraphEvents.ENTITY_QVALUE_UPDATED, payload);
        } catch (error: any) {
            this.logger.warn(`Failed to emit Q-value updated event: ${error.message}`);
        }
    }

    /**
     * Emit batch Q-value updated event
     */
    private emitBatchQValueUpdatedEvent(
        channelId: ChannelId,
        results: QValueUpdateResult[],
        taskId?: string
    ): void {
        try {
            const payload = createBaseEventPayload(
                KnowledgeGraphEvents.ENTITY_QVALUE_BATCH_UPDATED,
                'system',
                channelId,
                {
                    channelId,
                    updates: results.map((r) => ({
                        entityId: r.entityId,
                        oldQValue: r.oldQValue,
                        newQValue: r.newQValue,
                    })),
                    reason: taskId ? `Task ${taskId} outcome` : 'Batch update',
                    taskId,
                }
            );
            EventBus.server.emit(KnowledgeGraphEvents.ENTITY_QVALUE_BATCH_UPDATED, payload);
        } catch (error: any) {
            this.logger.warn(`Failed to emit batch Q-value updated event: ${error.message}`);
        }
    }
}
