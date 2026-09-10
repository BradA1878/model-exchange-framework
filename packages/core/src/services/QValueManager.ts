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
 * @documentation https://mxf-dev.github.io/mxf/
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

import { Logger } from '../utils/Logger.js';
import { EventBus } from '../events/EventBus.js';
import { Events } from '../events/EventNames.js';
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
} from '../types/MemoryUtilityTypes.js';
import { AgentId, ChannelId } from '../types/ChannelContext.js';
import {
    createMemoryQValueUpdatedPayload,
    createMemoryQValueBatchUpdatedPayload
} from '../schemas/EventPayloadSchema.js';

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
    // Serialize reads and rewards for each memory so a stale hydration cannot
    // replace a learned value, even if that value has since left the cache.
    private pendingUpdates: Map<string, Promise<void>> = new Map();

    // Keep reads and writes paired so eviction does not reset persisted rewards.
    private persistenceCallbacks?: {
        write: (memoryId: string, utility: Partial<MemoryUtilitySubdocument>) => Promise<void>;
        read: (memoryId: string) => Promise<number | undefined>;
    };

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
        this.applyConfiguration({ ...this.config, ...config });
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
     * Register the paired store used to update and reload memory utility.
     * A read returns undefined only when no persisted Q-value exists; failures reject.
     */
    public setPersistenceCallback(
        write: (memoryId: string, utility: Partial<MemoryUtilitySubdocument>) => Promise<void>,
        read: (memoryId: string) => Promise<number | undefined>
    ): void {
        if (typeof write !== 'function' || typeof read !== 'function') {
            throw new Error('Q-value persistence requires both write and read callbacks');
        }
        this.persistenceCallbacks = { write, read };
        this.logger.info('[QValueManager] Persistence read and write callbacks registered');
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
     * Whether a Q-value for this memory is already in the cache.
     *
     * Reports whether scoring can use a local value without reading persistence.
     */
    public isCached(memoryId: string): boolean {
        return this.qValueCache.has(memoryId);
    }

    /**
     * Set Q-value in cache (typically called when loading from persistence)
     */
    public setQValueInCache(memoryId: string, qValue: number): void {
        if (!this.enabled) return;

        // Direct cache writes must not replace dirty rewards or interfere with
        // a queued persistence read or reward update for the same memory.
        if (this.qValueCache.get(memoryId)?.dirty || this.pendingUpdates.has(memoryId)) return;
        this.reserveCacheEntry(memoryId);
        this.qValueCache.set(memoryId, {
            qValue,
            lastAccessed: Date.now(),
            dirty: false
        });
        this.updateCacheAccessOrder(memoryId);
    }

    /**
     * Load missing Q-values while holding the same per-memory queue as rewards.
     * Reserve every key before awaiting so overlapping batches cannot deadlock.
     * Only active operations retain queue entries; eviction needs no version history.
     */
    public async hydrateQValues(
        memoryIds: string[],
        readBatch: (memoryIds: string[]) => Promise<Map<string, number>>
    ): Promise<void> {
        if (!this.enabled) return;

        const reservations = new Map(
            [...new Set(memoryIds)]
                .filter(memoryId => !this.qValueCache.has(memoryId))
                .map(memoryId => [memoryId, this.reserveMemoryOperation(memoryId)] as const)
        );
        if (reservations.size === 0) return;

        try {
            await Promise.all([...reservations.values()].map(reservation => reservation.previous));
            // An earlier reward or hydration may have populated a key while this
            // batch waited. Its queue reservation keeps that cached value current.
            const uncached = [...reservations.keys()].filter(memoryId => !this.qValueCache.has(memoryId));
            if (uncached.length === 0) return;

            const values = await readBatch(uncached);
            // Validate the entire requested batch before admitting any entries.
            for (const memoryId of uncached) {
                if (values.has(memoryId)) this.validatePersistedQValue(memoryId, values.get(memoryId)!);
            }

            for (const memoryId of uncached) {
                if (!this.qValueCache.has(memoryId) && values.has(memoryId)) {
                    this.reserveCacheEntry(memoryId);
                    this.qValueCache.set(memoryId, {
                        qValue: values.get(memoryId)!,
                        lastAccessed: Date.now(),
                        dirty: false
                    });
                    this.updateCacheAccessOrder(memoryId);
                }
                // Release each admitted key promptly so a batch larger than the
                // cache can evict earlier clean entries without exceeding its limit.
                reservations.get(memoryId)!.release();
            }
        } finally {
            // Read, validation and capacity failures must also unblock later rewards.
            for (const reservation of reservations.values()) reservation.release();
        }
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

        const reservation = this.reserveMemoryOperation(memoryId);
        await reservation.previous;

        try {
            return await this.applyQValueUpdate(memoryId, reward, learningRate, agentId, channelId);
        } finally {
            reservation.release();
        }
    }

    /** Append one operation to a memory's queue without retaining completed keys. */
    private reserveMemoryOperation(memoryId: string): { previous: Promise<void>; release: () => void } {
        const previous = this.pendingUpdates.get(memoryId) ?? Promise.resolve();
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        this.pendingUpdates.set(memoryId, pending);

        return {
            previous,
            release: (): void => {
                release();
                if (this.pendingUpdates.get(memoryId) === pending) {
                    this.pendingUpdates.delete(memoryId);
                }
            }
        };
    }

    /** Reject corrupt persisted values before they affect the cache or a reward. */
    private validatePersistedQValue(memoryId: string, qValue: number): void {
        if (!Number.isFinite(qValue) || qValue < 0 || qValue > 1) {
            throw new Error(`Persisted Q-value for ${memoryId} must be a finite number in [0, 1]`);
        }
    }

    /** Apply one serialized reward and retain failed writes as dirty cache entries. */
    private async applyQValueUpdate(
        memoryId: string,
        reward: number,
        learningRate?: number,
        agentId?: AgentId,
        channelId?: ChannelId
    ): Promise<number> {
        // A cache miss may be an evicted learned value, not a new memory. Read
        // under this memory's update lock, preserving the same store for its write.
        const persistence = this.persistenceCallbacks;
        let currentQ = this.qValueCache.get(memoryId)?.qValue;
        if (currentQ === undefined && persistence) {
            const persistedQ = await persistence.read(memoryId);
            if (persistedQ !== undefined) this.validatePersistedQValue(memoryId, persistedQ);
            currentQ = persistedQ;
        }
        // Other memories can occupy capacity while the read is pending. Reserve
        // only after it succeeds, immediately before the synchronous cache mutation.
        this.reserveCacheEntry(memoryId);
        const alpha = learningRate ?? this.config.learningRate;
        currentQ ??= this.config.defaultQValue;

        // EMA update formula
        const newQ = currentQ + alpha * (reward - currentQ);

        // Clamp to [0, 1] range
        const clampedQ = Math.max(0, Math.min(1, newQ));

        // Update cache
        const updatedEntry: QValueCacheEntry = {
            qValue: clampedQ,
            lastAccessed: Date.now(),
            dirty: true
        };
        this.qValueCache.set(memoryId, updatedEntry);
        this.updateCacheAccessOrder(memoryId);

        // Create history entry
        const historyEntry: QValueHistoryEntry = {
            value: clampedQ,
            reward,
            timestamp: new Date()
        };

        // Persist if callback is available
        if (persistence) {
            try {
                await persistence.write(memoryId, {
                    qValue: clampedQ,
                    qValueHistory: [historyEntry],
                    lastRewardAt: new Date()
                });

                // Mark as clean after successful persistence
                if (this.qValueCache.get(memoryId) === updatedEntry) {
                    updatedEntry.dirty = false;
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
     * Reserve capacity before adding an entry. Only persisted values may be
     * evicted; failed or in-flight writes must remain available for recovery.
     * Refuse admission when capacity is entirely occupied by those values.
     */
    private reserveCacheEntry(memoryId: string): void {
        if (this.qValueCache.has(memoryId)) return;
        const maxSize = this.config.cache?.maxSize ?? 1000;
        this.evictPersistedEntries(this.qValueCache.size - maxSize + 1);
    }

    /** Validate a resize before changing configuration or discarding any entries. */
    private applyConfiguration(config: MemoryUtilityConfig): void {
        const maxSize = config.cache?.maxSize ?? 1000;
        if (!Number.isInteger(maxSize) || maxSize < 1) {
            throw new Error('Q-value cache maxSize must be a positive integer');
        }
        this.evictPersistedEntries(this.qValueCache.size - maxSize);
        this.config = config;
    }

    /** Remove only clean, idle entries, preserving their LRU order. */
    private evictPersistedEntries(required: number): void {
        if (required <= 0) return;

        const removable = this.cacheAccessOrder.filter(id => (
            !this.qValueCache.get(id)?.dirty && !this.pendingUpdates.has(id)
        ));
        if (removable.length < required) {
            throw new Error('Q-value cache capacity is occupied by unpersisted or pending rewards');
        }
        for (const id of removable.slice(0, required)) {
            this.clearFromCache(id);
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
        this.applyConfiguration({ ...this.config, ...updates });
        this.enabled = this.config.enabled;
        this.logger.info('[QValueManager] Configuration updated');
    }
}
