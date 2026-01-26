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
 * StratumManager Service
 *
 * Manages the lifecycle of memory strata following the Nested Learning paradigm.
 * Implements multi-timescale memory updates with different frequencies per stratum.
 *
 * Feature flags: MEMORY_STRATA_ENABLED
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/Logger';
import {
  MemoryEntry,
  MemoryStratum,
  MemoryImportance,
  MemoryQuery,
  MemoryRetrievalResult,
  MemoryTransition,
  MemoryStatistics,
  MemoryStrataConfig,
  ConsolidationType
} from '../types/MemoryStrataTypes';

/**
 * Stratum update frequency configuration (in ORPAR cycles)
 */
export const STRATUM_UPDATE_FREQUENCIES = {
  [MemoryStratum.Working]: 1,        // Every cycle
  [MemoryStratum.ShortTerm]: 3,      // Every 3-5 cycles
  [MemoryStratum.Episodic]: 10,      // Every 10-20 cycles
  [MemoryStratum.LongTerm]: 50,      // Every 50+ cycles
  [MemoryStratum.Semantic]: 50       // Every 50+ cycles
};

/**
 * Default decay rates per stratum (per cycle)
 */
export const DEFAULT_DECAY_RATES = {
  [MemoryStratum.Working]: 0.8,      // Aggressive decay
  [MemoryStratum.ShortTerm]: 0.3,    // Moderate decay
  [MemoryStratum.Episodic]: 0.1,     // Conservative decay
  [MemoryStratum.LongTerm]: 0.05,    // Minimal decay
  [MemoryStratum.Semantic]: 0.05     // Minimal decay
};

/**
 * Stratum capacity limits
 */
export const STRATUM_CAPACITY = {
  [MemoryStratum.Working]: 50,
  [MemoryStratum.ShortTerm]: 200,
  [MemoryStratum.Episodic]: 500,
  [MemoryStratum.LongTerm]: 2000,
  [MemoryStratum.Semantic]: 1000
};

/**
 * Memory stratum storage interface
 */
interface StratumStorage {
  memories: Map<string, MemoryEntry>;
  cyclesSinceLastUpdate: number;
  lastUpdateTimestamp: Date;
}

/**
 * StratumManager handles memory lifecycle across temporal scales
 */
export class StratumManager {
  private static instance: StratumManager;
  private logger: Logger;

  // In-memory storage per agent/channel
  private agentStrata: Map<string, Map<MemoryStratum, StratumStorage>>;
  private channelStrata: Map<string, Map<MemoryStratum, StratumStorage>>;

  // Transition history for analytics
  private transitionHistory: MemoryTransition[] = [];

  // Configuration
  private config: MemoryStrataConfig | null = null;
  private enabled: boolean = false;

  private constructor() {
    this.logger = new Logger('info', 'StratumManager');
    this.agentStrata = new Map();
    this.channelStrata = new Map();
  }

  public static getInstance(): StratumManager {
    if (!StratumManager.instance) {
      StratumManager.instance = new StratumManager();
    }
    return StratumManager.instance;
  }

  /**
   * Initialize the StratumManager with configuration
   */
  public initialize(config: MemoryStrataConfig): void {
    this.config = config;
    this.enabled = config.enabled;

    if (this.enabled) {
      this.logger.info('[StratumManager] Initialized with Nested Learning memory strata');
    }
  }

  /**
   * Check if stratum system is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Add a memory entry to a specific stratum
   */
  public async addMemory(
    scope: 'agent' | 'channel',
    scopeId: string,
    stratum: MemoryStratum,
    entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessed' | 'accessCount'>
  ): Promise<MemoryEntry> {
    if (!this.enabled) {
      throw new Error('Memory strata system is not enabled');
    }

    const memoryEntry: MemoryEntry = {
      ...entry,
      id: uuidv4(),
      createdAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 0
    };

    const storage = this.getOrCreateStorage(scope, scopeId, stratum);
    storage.memories.set(memoryEntry.id, memoryEntry);

    this.logger.debug(`[StratumManager] Added memory ${memoryEntry.id} to ${scope}:${scopeId} ${stratum} stratum`);

    return memoryEntry;
  }

  /**
   * Retrieve memories from specified strata
   */
  public async queryMemories(
    scope: 'agent' | 'channel',
    scopeId: string,
    query: MemoryQuery
  ): Promise<MemoryRetrievalResult> {
    if (!this.enabled) {
      return {
        memories: [],
        totalCount: 0,
        scores: new Map(),
        executionTime: 0
      };
    }

    const startTime = Date.now();
    const strata = query.strata || Object.values(MemoryStratum);
    const memories: MemoryEntry[] = [];
    const scores = new Map<string, number>();

    for (const stratum of strata) {
      const storage = this.getStorage(scope, scopeId, stratum);
      if (!storage) continue;

      for (const [id, memory] of storage.memories) {
        // Apply filters
        if (query.minImportance && memory.importance < query.minImportance) {
          continue;
        }

        if (query.tags && query.tags.length > 0) {
          const hasMatchingTag = query.tags.some(tag => memory.tags.includes(tag));
          if (!hasMatchingTag) continue;
        }

        if (query.timeRange) {
          if (query.timeRange.start && memory.createdAt < query.timeRange.start) continue;
          if (query.timeRange.end && memory.createdAt > query.timeRange.end) continue;
        }

        // Simple text matching (could be enhanced with semantic search)
        const matchScore = this.calculateMatchScore(memory, query.query);
        if (matchScore > 0) {
          memories.push(memory);
          scores.set(id, matchScore);

          // Update access tracking
          memory.accessCount++;
          memory.lastAccessed = new Date();
        }
      }
    }

    // Sort by relevance score
    memories.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));

    // Apply limit
    const limit = query.limit || memories.length;
    const limitedMemories = memories.slice(0, limit);

    const executionTime = Date.now() - startTime;

    this.logger.debug(`[StratumManager] Query returned ${limitedMemories.length}/${memories.length} memories in ${executionTime}ms`);

    return {
      memories: limitedMemories,
      totalCount: memories.length,
      scores,
      executionTime
    };
  }

  /**
   * Transition a memory between strata (promotion/demotion)
   */
  public async transitionMemory(
    scope: 'agent' | 'channel',
    scopeId: string,
    memoryId: string,
    fromStratum: MemoryStratum,
    toStratum: MemoryStratum,
    reason: string
  ): Promise<boolean> {
    if (!this.enabled) return false;

    const fromStorage = this.getStorage(scope, scopeId, fromStratum);
    if (!fromStorage || !fromStorage.memories.has(memoryId)) {
      this.logger.warn(`[StratumManager] Memory ${memoryId} not found in ${fromStratum} stratum`);
      return false;
    }

    const memory = fromStorage.memories.get(memoryId)!;
    const toStorage = this.getOrCreateStorage(scope, scopeId, toStratum);

    // Update stratum
    memory.stratum = toStratum;

    // Move memory
    fromStorage.memories.delete(memoryId);
    toStorage.memories.set(memoryId, memory);

    // Record transition
    const transition: MemoryTransition = {
      memoryId,
      fromStratum,
      toStratum,
      reason,
      timestamp: new Date()
    };
    this.transitionHistory.push(transition);

    this.logger.info(`[StratumManager] Transitioned memory ${memoryId} from ${fromStratum} to ${toStratum}: ${reason}`);

    return true;
  }

  /**
   * Apply decay to memories in a stratum
   */
  public async applyDecay(
    scope: 'agent' | 'channel',
    scopeId: string,
    stratum: MemoryStratum,
    decayRate?: number
  ): Promise<number> {
    if (!this.enabled) return 0;

    const storage = this.getStorage(scope, scopeId, stratum);
    if (!storage) return 0;

    const rate = decayRate || DEFAULT_DECAY_RATES[stratum];
    const memoriesToRemove: string[] = [];

    for (const [id, memory] of storage.memories) {
      // Calculate age factor
      const ageMs = Date.now() - memory.lastAccessed.getTime();
      const ageFactor = Math.min(ageMs / (24 * 60 * 60 * 1000), 1); // Normalize to 0-1 over 24 hours

      // Decay probability increases with age and base rate
      const decayProbability = rate * ageFactor;

      if (Math.random() < decayProbability) {
        // Check if memory should be removed
        if (memory.accessCount === 0 || ageFactor > 0.9) {
          memoriesToRemove.push(id);
        }
      }
    }

    // Remove decayed memories
    for (const id of memoriesToRemove) {
      storage.memories.delete(id);
    }

    if (memoriesToRemove.length > 0) {
      this.logger.debug(`[StratumManager] Decayed ${memoriesToRemove.length} memories from ${stratum} stratum`);
    }

    return memoriesToRemove.length;
  }

  /**
   * Check if a stratum needs updating based on cycle count
   */
  public shouldUpdateStratum(
    scope: 'agent' | 'channel',
    scopeId: string,
    stratum: MemoryStratum
  ): boolean {
    if (!this.enabled) return false;

    const storage = this.getStorage(scope, scopeId, stratum);
    if (!storage) return true; // First update

    const frequency = STRATUM_UPDATE_FREQUENCIES[stratum];
    return storage.cyclesSinceLastUpdate >= frequency;
  }

  /**
   * Mark a stratum as updated
   */
  public markStratumUpdated(
    scope: 'agent' | 'channel',
    scopeId: string,
    stratum: MemoryStratum
  ): void {
    const storage = this.getOrCreateStorage(scope, scopeId, stratum);
    storage.cyclesSinceLastUpdate = 0;
    storage.lastUpdateTimestamp = new Date();
  }

  /**
   * Increment cycle counter for all strata
   */
  public incrementCycles(scope: 'agent' | 'channel', scopeId: string): void {
    const strata = this.getStrataMap(scope).get(scopeId);
    if (!strata) return;

    for (const [stratum, storage] of strata) {
      storage.cyclesSinceLastUpdate++;
    }
  }

  /**
   * Get statistics for memory strata
   */
  public getStatistics(scope: 'agent' | 'channel', scopeId: string): MemoryStatistics {
    const strata = this.getStrataMap(scope).get(scopeId);

    const entriesPerStratum: Record<MemoryStratum, number> = {
      [MemoryStratum.Working]: 0,
      [MemoryStratum.ShortTerm]: 0,
      [MemoryStratum.LongTerm]: 0,
      [MemoryStratum.Episodic]: 0,
      [MemoryStratum.Semantic]: 0
    };

    const entriesPerImportance: Record<MemoryImportance, number> = {
      [MemoryImportance.Critical]: 0,
      [MemoryImportance.High]: 0,
      [MemoryImportance.Medium]: 0,
      [MemoryImportance.Low]: 0,
      [MemoryImportance.Trivial]: 0
    };

    let totalAccessCount = 0;
    let totalEntries = 0;
    const accessCounts: Array<{ id: string; count: number }> = [];
    let memoryUsage = 0;

    if (strata) {
      for (const [stratum, storage] of strata) {
        entriesPerStratum[stratum] = storage.memories.size;

        for (const [id, memory] of storage.memories) {
          totalEntries++;
          totalAccessCount += memory.accessCount;
          accessCounts.push({ id, count: memory.accessCount });
          entriesPerImportance[memory.importance]++;

          // Estimate memory usage
          memoryUsage += JSON.stringify(memory).length;
        }
      }
    }

    // Sort by access count
    accessCounts.sort((a, b) => b.count - a.count);
    const mostAccessed = accessCounts.slice(0, 10).map(a => a.id);

    return {
      entriesPerStratum,
      entriesPerImportance,
      avgAccessCount: totalEntries > 0 ? totalAccessCount / totalEntries : 0,
      mostAccessed,
      recentSurprises: 0, // Will be populated by SurpriseCalculator
      detectedPatterns: 0, // Will be populated by pattern detection
      memoryUsage
    };
  }

  /**
   * Clear all memories for a scope
   */
  public clear(scope: 'agent' | 'channel', scopeId: string): void {
    this.getStrataMap(scope).delete(scopeId);
    this.logger.info(`[StratumManager] Cleared all strata for ${scope}:${scopeId}`);
  }

  /**
   * Remove a specific memory by ID from all strata
   * Used for archiving/deleting memories during consolidation
   */
  public async removeMemory(
    scope: 'agent' | 'channel',
    scopeId: string,
    memoryId: string
  ): Promise<boolean> {
    const strataMap = this.getStrataMap(scope).get(scopeId);
    if (!strataMap) {
      return false;
    }

    // Search all strata for the memory
    for (const [stratum, storage] of strataMap) {
      if (storage.memories.has(memoryId)) {
        storage.memories.delete(memoryId);
        this.logger.debug(`[StratumManager] Removed memory ${memoryId} from ${scope}:${scopeId} ${stratum} stratum`);
        return true;
      }
    }

    return false;
  }

  // Private helper methods

  private getStrataMap(scope: 'agent' | 'channel'): Map<string, Map<MemoryStratum, StratumStorage>> {
    return scope === 'agent' ? this.agentStrata : this.channelStrata;
  }

  private getStorage(
    scope: 'agent' | 'channel',
    scopeId: string,
    stratum: MemoryStratum
  ): StratumStorage | undefined {
    const strata = this.getStrataMap(scope).get(scopeId);
    return strata?.get(stratum);
  }

  private getOrCreateStorage(
    scope: 'agent' | 'channel',
    scopeId: string,
    stratum: MemoryStratum
  ): StratumStorage {
    const strataMap = this.getStrataMap(scope);

    if (!strataMap.has(scopeId)) {
      strataMap.set(scopeId, new Map());
    }

    const strata = strataMap.get(scopeId)!;

    if (!strata.has(stratum)) {
      strata.set(stratum, {
        memories: new Map(),
        cyclesSinceLastUpdate: 0,
        lastUpdateTimestamp: new Date()
      });
    }

    return strata.get(stratum)!;
  }

  private calculateMatchScore(memory: MemoryEntry, query: string): number {
    if (!query) return 1.0;

    const queryLower = query.toLowerCase();
    const contentLower = memory.content.toLowerCase();

    // Simple keyword matching
    const queryWords = queryLower.split(/\s+/);
    const matchingWords = queryWords.filter(word => contentLower.includes(word));

    if (matchingWords.length === 0) return 0;

    const score = matchingWords.length / queryWords.length;

    // Boost by importance
    const importanceBoost = memory.importance / 5;

    // Boost by access count (popular memories)
    const accessBoost = Math.min(memory.accessCount / 10, 0.2);

    return Math.min(score + importanceBoost * 0.2 + accessBoost, 1.0);
  }
}
