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
 * QValueManager
 *
 * Centralized service for Q-value storage, retrieval, and EMA (Exponential Moving Average) updates.
 * Part of the Memory Utility Learning System (MULS) inspired by MemRL.
 *
 * Q-values track which memories actually lead to successful task outcomes.
 * Update formula: Q_new = Q_old + α(reward - Q_old)
 *
 * Feature flag: MEMORY_UTILITY_LEARNING_ENABLED
 */

import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import {
    QValueUpdate,
    QValueHistoryEntry,
    QValueStatistics,
    NormalizationMethod,
    MemoryUtilityConfig,
    DEFAULT_MEMORY_UTILITY_CONFIG,
    getMulsConfigFromEnv,
    DEFAULT_UTILITY_SUBDOCUMENT,
    MemoryUtilitySubdocument,
    QValueAnalytics,
    OrparPhase
} from '../types/MemoryUtilityTypes';
import { AgentId, ChannelId } from '../types/ChannelContext';
import {
    createMemoryQValueUpdatedPayload,
    createMemoryQValueBatchUpdatedPayload
} from '../schemas/EventPayloadSchema';

/**
 * Cache entry for Q-values
 */
interface QValueCacheEntry {
    qValue: number;
    lastAccessed: number;
    dirty: boolean;
}

/**
 * Result of a batch Q-value update
 */
export interface BatchUpdateResult {
    updated: number;
    failed: number;
    errors: Array<{ memoryId: string; error: string }>;
}

/**
 * QValueManager - Singleton service for managing memory Q-values
 */
export class QValueManager {
    private static instance: QValueManager;
    private logger: Logger;
    private config: MemoryUtilityConfig;
    private enabled: boolean = false;

    // LRU cache for hot Q-values
    private qValueCache: Map<string, QValueCacheEntry> = new Map();
    private cacheAccessOrder: string[] = [];

    // Persistence callback (set by MemoryService)
    private persistenceCallback?: (memoryId: string, utility: Partial<MemoryUtilitySubdocument>) => Promise<void>;

    private constructor() {
        this.logger = new Logger('info', 'QValueManager');
        this.config = {
            ...DEFAULT_MEMORY_UTILITY_CONFIG,
            ...getMulsConfigFromEnv()
        };
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): QValueManager {
        if (!QValueManager.instance) {
            QValueManager.instance = new QValueManager();
        }
        return QValueManager.instance;
    }

    /**
     * Initialize the QValueManager with configuration
     */
    public initialize(config?: Partial<MemoryUtilityConfig>): void {
        if (config) {
            this.config = { ...this.config, ...config };
        }
        this.enabled = this.config.enabled;

        if (this.enabled) {
            this.logger.info('[QValueManager] Initialized with MULS enabled');
            this.logger.info(`[QValueManager] Config: learningRate=${this.config.learningRate}, defaultQValue=${this.config.defaultQValue}`);
        } else {
            this.logger.info('[QValueManager] MULS is disabled');
        }
    }

    /**
     * Check if MULS is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Set the persistence callback for updating memory documents
     */
    public setPersistenceCallback(callback: (memoryId: string, utility: Partial<MemoryUtilitySubdocument>) => Promise<void>): void {
        this.persistenceCallback = callback;
        this.logger.info('[QValueManager] Persistence callback registered');
    }

    /**
     * Get Q-value for a single memory
     */
    public getQValue(memoryId: string): number {
        if (!this.enabled) {
            return this.config.defaultQValue;
        }

        // Check cache first
        const cached = this.qValueCache.get(memoryId);
        if (cached) {
            this.updateCacheAccessOrder(memoryId);
            cached.lastAccessed = Date.now();
            return cached.qValue;
        }

        // Return default if not in cache (will be populated on retrieval)
        return this.config.defaultQValue;
    }

    /**
     * Get Q-values for multiple memories
     */
    public getQValues(memoryIds: string[]): Map<string, number> {
        const result = new Map<string, number>();

        for (const memoryId of memoryIds) {
            result.set(memoryId, this.getQValue(memoryId));
        }

        return result;
    }

    /**
     * Set Q-value in cache (typically called when loading from persistence)
     */
    public setQValueInCache(memoryId: string, qValue: number): void {
        if (!this.enabled) return;

        this.qValueCache.set(memoryId, {
            qValue,
            lastAccessed: Date.now(),
            dirty: false
        });
        this.updateCacheAccessOrder(memoryId);
        this.enforceCacheLimit();
    }

    /**
     * Update Q-value using EMA formula: Q_new = Q_old + α(reward - Q_old)
     * @param memoryId - The memory ID to update
     * @param reward - The reward signal (-1 to 1)
     * @param learningRate - Optional custom learning rate
     * @param agentId - Optional agent ID for event context (defaults to 'system')
     * @param channelId - Optional channel ID for event context (defaults to 'global')
     */
    public async updateQValue(
        memoryId: string,
        reward: number,
        learningRate?: number,
        agentId?: AgentId,
        channelId?: ChannelId
    ): Promise<number> {
        if (!this.enabled) {
            return this.config.defaultQValue;
        }

        const alpha = learningRate ?? this.config.learningRate;
        const currentQ = this.getQValue(memoryId);

        // EMA update formula
        const newQ = currentQ + alpha * (reward - currentQ);

        // Clamp to [0, 1] range
        const clampedQ = Math.max(0, Math.min(1, newQ));

        // Update cache
        this.qValueCache.set(memoryId, {
            qValue: clampedQ,
            lastAccessed: Date.now(),
            dirty: true
        });
        this.updateCacheAccessOrder(memoryId);

        // Create history entry
        const historyEntry: QValueHistoryEntry = {
            value: clampedQ,
            reward,
            timestamp: new Date()
        };

        // Persist if callback is available
        if (this.persistenceCallback) {
            try {
                await this.persistenceCallback(memoryId, {
                    qValue: clampedQ,
                    qValueHistory: [historyEntry],
                    lastRewardAt: new Date()
                });

                // Mark as clean after successful persistence
                const cached = this.qValueCache.get(memoryId);
                if (cached) {
                    cached.dirty = false;
                }
            } catch (error) {
                this.logger.warn(`[QValueManager] Failed to persist Q-value for ${memoryId}: ${error}`);
            }
        }

        // Emit event for analytics (use provided context or defaults)
        this.emitQValueUpdatedEvent(
            memoryId,
            currentQ,
            clampedQ,
            reward,
            agentId ?? 'system',
            channelId ?? 'global'
        );

        this.logger.debug(`[QValueManager] Updated Q-value for ${memoryId}: ${currentQ.toFixed(4)} -> ${clampedQ.toFixed(4)} (reward=${reward})`);

        return clampedQ;
    }

    /**
     * Batch update Q-values efficiently
     * @param updates - Array of Q-value updates to perform
     * @param agentId - Optional agent ID for event context (defaults to 'system')
     * @param channelId - Optional channel ID for event context (defaults to 'global')
     */
    public async batchUpdateQValues(
        updates: QValueUpdate[],
        agentId?: AgentId,
        channelId?: ChannelId
    ): Promise<BatchUpdateResult> {
        const result: BatchUpdateResult = {
            updated: 0,
            failed: 0,
            errors: []
        };

        if (!this.enabled || updates.length === 0) {
            return result;
        }

        // Use provided context or extract from first update's context, or use defaults
        const effectiveAgentId = agentId ?? updates[0]?.context?.agentId ?? 'system';
        const effectiveChannelId = channelId ?? updates[0]?.context?.channelId ?? 'global';

        const updatePromises = updates.map(async (update) => {
            try {
                // Use update-specific context if available, otherwise use batch context
                const updateAgentId = update.context?.agentId ?? effectiveAgentId;
                const updateChannelId = update.context?.channelId ?? effectiveChannelId;

                await this.updateQValue(
                    update.memoryId,
                    update.reward,
                    update.learningRate,
                    updateAgentId,
                    updateChannelId
                );
                result.updated++;
            } catch (error) {
                result.failed++;
                result.errors.push({
                    memoryId: update.memoryId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });

        await Promise.all(updatePromises);

        // Emit batch update event with context
        this.emitBatchUpdateEvent(updates.length, result, effectiveAgentId, effectiveChannelId);

        this.logger.info(`[QValueManager] Batch update completed: ${result.updated} updated, ${result.failed} failed`);

        return result;
    }

    /**
     * Get normalized Q-values for a set of memories
     */
    public getNormalizedQValues(
        memoryIds: string[],
        method: NormalizationMethod = 'z-score'
    ): Map<string, number> {
        const qValues = this.getQValues(memoryIds);
        const values = Array.from(qValues.values());

        if (values.length === 0) {
            return new Map();
        }

        switch (method) {
            case 'z-score':
                return this.normalizeZScore(qValues, values);
            case 'min-max':
                return this.normalizeMinMax(qValues, values);
            case 'softmax':
                return this.normalizeSoftmax(qValues, values);
            default:
                return this.normalizeZScore(qValues, values);
        }
    }

    /**
     * Z-score normalization: (x - mean) / stddev
     */
    private normalizeZScore(qValues: Map<string, number>, values: number[]): Map<string, number> {
        const result = new Map<string, number>();
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

        // Handle edge case: all identical or near-identical values
        // Use tolerance to handle floating-point precision issues
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        // Use epsilon tolerance for floating-point comparisons
        const EPSILON = 1e-10;
        if (stdDev < EPSILON) {
            // All values are effectively identical, return 0 for all
            for (const [id] of qValues) {
                result.set(id, 0);
            }
            return result;
        }

        for (const [id, q] of qValues) {
            result.set(id, (q - mean) / stdDev);
        }

        return result;
    }

    /**
     * Min-max normalization: (x - min) / (max - min)
     */
    private normalizeMinMax(qValues: Map<string, number>, values: number[]): Map<string, number> {
        const result = new Map<string, number>();
        const min = Math.min(...values);
        const max = Math.max(...values);

        // Handle edge case: all identical values
        if (max === min) {
            for (const [id] of qValues) {
                result.set(id, 0.5);
            }
            return result;
        }

        for (const [id, q] of qValues) {
            result.set(id, (q - min) / (max - min));
        }

        return result;
    }

    /**
     * Softmax normalization: exp(x) / sum(exp(x))
     */
    private normalizeSoftmax(qValues: Map<string, number>, values: number[]): Map<string, number> {
        const result = new Map<string, number>();

        // Use temperature scaling to prevent overflow
        const maxVal = Math.max(...values);
        const expValues = values.map(v => Math.exp(v - maxVal));
        const sumExp = expValues.reduce((sum, v) => sum + v, 0);

        for (const [id, q] of qValues) {
            const exp = Math.exp(q - maxVal);
            result.set(id, exp / sumExp);
        }

        return result;
    }

    /**
     * Get Q-value distribution statistics
     */
    public getQValueDistribution(agentId?: AgentId): QValueStatistics {
        const values: number[] = [];

        for (const [, entry] of this.qValueCache) {
            values.push(entry.qValue);
        }

        if (values.length === 0) {
            return {
                mean: this.config.defaultQValue,
                stdDev: 0,
                min: this.config.defaultQValue,
                max: this.config.defaultQValue,
                count: 0
            };
        }

        values.sort((a, b) => a - b);

        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        const getPercentile = (p: number): number => {
            const index = Math.floor((p / 100) * values.length);
            return values[Math.min(index, values.length - 1)];
        };

        return {
            mean,
            stdDev,
            min: values[0],
            max: values[values.length - 1],
            count: values.length,
            percentiles: {
                p25: getPercentile(25),
                p50: getPercentile(50),
                p75: getPercentile(75),
                p90: getPercentile(90),
                p99: getPercentile(99)
            }
        };
    }

    /**
     * Get comprehensive Q-value analytics
     */
    public getAnalytics(agentId?: AgentId): QValueAnalytics {
        const statistics = this.getQValueDistribution(agentId);

        // Get top performers
        const entries = Array.from(this.qValueCache.entries())
            .sort((a, b) => b[1].qValue - a[1].qValue)
            .slice(0, 10);

        const topPerformers = entries.map(([memoryId, entry]) => ({
            memoryId,
            qValue: entry.qValue,
            successRate: 0, // Would need to track this separately
            retrievalCount: 0 // Would need to track this separately
        }));

        // Calculate convergence metrics
        const qValues = Array.from(this.qValueCache.values()).map(e => e.qValue);
        const isConverging = statistics.stdDev < 0.1;
        const stableMemoryCount = qValues.filter(q => Math.abs(q - statistics.mean) < 0.1).length;

        return {
            statistics,
            topPerformers,
            convergence: {
                isConverging,
                averageRecentChange: 0, // Would need history tracking
                stableMemoryCount
            },
            rewardDistribution: {
                successCount: 0, // Would need to track
                failureCount: 0,
                partialCount: 0,
                timeoutCount: 0
            }
        };
    }

    /**
     * Clear Q-value from cache
     */
    public clearFromCache(memoryId: string): void {
        this.qValueCache.delete(memoryId);
        const index = this.cacheAccessOrder.indexOf(memoryId);
        if (index > -1) {
            this.cacheAccessOrder.splice(index, 1);
        }
    }

    /**
     * Clear all cached Q-values
     */
    public clearCache(): void {
        this.qValueCache.clear();
        this.cacheAccessOrder = [];
        this.logger.info('[QValueManager] Cache cleared');
    }

    /**
     * Get cache statistics
     */
    public getCacheStats(): { size: number; maxSize: number; hitRate: number } {
        return {
            size: this.qValueCache.size,
            maxSize: this.config.cache?.maxSize ?? 1000,
            hitRate: 0 // Would need hit/miss tracking
        };
    }

    /**
     * Update cache access order for LRU eviction
     */
    private updateCacheAccessOrder(memoryId: string): void {
        const index = this.cacheAccessOrder.indexOf(memoryId);
        if (index > -1) {
            this.cacheAccessOrder.splice(index, 1);
        }
        this.cacheAccessOrder.push(memoryId);
    }

    /**
     * Enforce cache size limit using LRU eviction
     */
    private enforceCacheLimit(): void {
        const maxSize = this.config.cache?.maxSize ?? 1000;

        while (this.qValueCache.size > maxSize && this.cacheAccessOrder.length > 0) {
            const oldestId = this.cacheAccessOrder.shift();
            if (oldestId) {
                const entry = this.qValueCache.get(oldestId);
                // Only evict if not dirty, otherwise persist first
                if (entry && !entry.dirty) {
                    this.qValueCache.delete(oldestId);
                } else if (entry && entry.dirty && this.persistenceCallback) {
                    // Persist dirty entry before eviction
                    this.persistenceCallback(oldestId, { qValue: entry.qValue })
                        .then(() => this.qValueCache.delete(oldestId))
                        .catch(err => this.logger.warn(`[QValueManager] Failed to persist dirty entry ${oldestId}: ${err}`));
                }
            }
        }
    }

    /**
     * Emit Q-value updated event using proper payload structure
     * @param memoryId - The memory ID that was updated
     * @param oldValue - Previous Q-value
     * @param newValue - New Q-value
     * @param reward - Reward signal that triggered the update
     * @param agentId - Agent context for the event
     * @param channelId - Channel context for the event
     */
    private emitQValueUpdatedEvent(
        memoryId: string,
        oldValue: number,
        newValue: number,
        reward: number,
        agentId: AgentId,
        channelId: ChannelId
    ): void {
        try {
            EventBus.server.emit(
                Events.MemoryUtility.QVALUE_UPDATED,
                createMemoryQValueUpdatedPayload(agentId, channelId, {
                    memoryId,
                    oldValue,
                    newValue,
                    reward,
                    delta: newValue - oldValue
                })
            );
        } catch (error) {
            // EventBus may not be initialized in all contexts
            this.logger.debug(`[QValueManager] Could not emit qvalue_updated event: ${error}`);
        }
    }

    /**
     * Emit batch update event using proper payload structure
     * @param totalUpdates - Total number of updates attempted
     * @param result - Batch update result
     * @param agentId - Agent context for the event
     * @param channelId - Channel context for the event
     */
    private emitBatchUpdateEvent(
        totalUpdates: number,
        result: BatchUpdateResult,
        agentId: AgentId,
        channelId: ChannelId
    ): void {
        try {
            EventBus.server.emit(
                Events.MemoryUtility.QVALUE_BATCH_UPDATED,
                createMemoryQValueBatchUpdatedPayload(agentId, channelId, {
                    totalUpdates,
                    updated: result.updated,
                    failed: result.failed,
                    errors: result.errors.length > 0 ? result.errors : undefined
                })
            );
        } catch (error) {
            // EventBus may not be initialized in all contexts
            this.logger.debug(`[QValueManager] Could not emit batch_updated event: ${error}`);
        }
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
        this.logger.info('[QValueManager] Configuration updated');
    }
}
