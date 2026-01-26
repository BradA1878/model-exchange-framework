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
 * RetentionGateService
 *
 * Implements adaptive weight decay and retention gates from MIRAS framework.
 * Acts as a regularizer that balances new learning against retaining past knowledge.
 * Manages finite memory capacity through intelligent forgetting.
 *
 * Feature flag: MEMORY_STRATA_ENABLED
 */

import { Logger } from '../utils/Logger';
import { MemoryEntry, MemoryStratum, MemoryImportance } from '../types/MemoryStrataTypes';
import { STRATUM_CAPACITY } from './StratumManager';
import { QValueManager } from './QValueManager';

/**
 * Retention policy configuration per stratum
 */
export interface RetentionPolicy {
  baseDecayRate: number;              // Base decay rate per cycle (0-1)
  capacityThreshold: number;          // Capacity threshold to trigger adaptive decay (0-1)
  accessBoostFactor: number;          // How much recent access reduces decay
  surpriseBoostFactor: number;        // How much surprise score reduces decay
  importanceWeight: number;           // Weight given to importance level
  adaptiveDecayEnabled: boolean;      // Enable adaptive decay based on capacity
  utilityBoostFactor: number;         // How much Q-value (MULS utility) reduces decay (0-1)
}

/**
 * Decay calculation result
 */
export interface DecayResult {
  memoryId: string;
  originalScore: number;
  decayedScore: number;
  shouldRetain: boolean;
  reason: string;
}

/**
 * Retention statistics
 */
export interface RetentionStatistics {
  totalMemories: number;
  retained: number;
  decayed: number;
  avgRetentionScore: number;
  capacityUtilization: number;
}

/**
 * Default retention policies per stratum
 */
const DEFAULT_RETENTION_POLICIES: Record<MemoryStratum, RetentionPolicy> = {
  [MemoryStratum.Working]: {
    baseDecayRate: 0.8,
    capacityThreshold: 0.9,
    accessBoostFactor: 0.1,
    surpriseBoostFactor: 0.2,
    importanceWeight: 0.3,
    adaptiveDecayEnabled: true,
    utilityBoostFactor: 0.1  // Low utility impact for working memory
  },
  [MemoryStratum.ShortTerm]: {
    baseDecayRate: 0.3,
    capacityThreshold: 0.85,
    accessBoostFactor: 0.2,
    surpriseBoostFactor: 0.3,
    importanceWeight: 0.4,
    adaptiveDecayEnabled: true,
    utilityBoostFactor: 0.2  // Moderate utility impact
  },
  [MemoryStratum.Episodic]: {
    baseDecayRate: 0.1,
    capacityThreshold: 0.8,
    accessBoostFactor: 0.3,
    surpriseBoostFactor: 0.4,
    importanceWeight: 0.5,
    adaptiveDecayEnabled: true,
    utilityBoostFactor: 0.3  // Higher utility impact for episodic
  },
  [MemoryStratum.LongTerm]: {
    baseDecayRate: 0.05,
    capacityThreshold: 0.9,
    accessBoostFactor: 0.4,
    surpriseBoostFactor: 0.5,
    importanceWeight: 0.6,
    adaptiveDecayEnabled: false,
    utilityBoostFactor: 0.4  // High utility impact for long-term retention
  },
  [MemoryStratum.Semantic]: {
    baseDecayRate: 0.05,
    capacityThreshold: 0.9,
    accessBoostFactor: 0.4,
    surpriseBoostFactor: 0.5,
    importanceWeight: 0.6,
    adaptiveDecayEnabled: false,
    utilityBoostFactor: 0.4  // High utility impact for semantic knowledge
  }
};

/**
 * RetentionGateService manages adaptive memory decay
 */
export class RetentionGateService {
  private static instance: RetentionGateService;
  private logger: Logger;
  private policies: Map<MemoryStratum, RetentionPolicy>;
  private enabled: boolean = false;

  private constructor() {
    this.logger = new Logger('info', 'RetentionGateService');
    this.policies = new Map();

    // Initialize with default policies
    for (const [stratum, policy] of Object.entries(DEFAULT_RETENTION_POLICIES)) {
      this.policies.set(stratum as MemoryStratum, policy);
    }
  }

  public static getInstance(): RetentionGateService {
    if (!RetentionGateService.instance) {
      RetentionGateService.instance = new RetentionGateService();
    }
    return RetentionGateService.instance;
  }

  /**
   * Initialize the RetentionGateService
   */
  public initialize(config: {
    enabled: boolean;
    customPolicies?: Map<MemoryStratum, Partial<RetentionPolicy>>;
  }): void {
    this.enabled = config.enabled;

    // Apply custom policies if provided
    if (config.customPolicies) {
      for (const [stratum, customPolicy] of config.customPolicies) {
        const defaultPolicy = DEFAULT_RETENTION_POLICIES[stratum];
        this.policies.set(stratum, {
          ...defaultPolicy,
          ...customPolicy
        });
      }
    }

    if (this.enabled) {
      this.logger.info('[RetentionGateService] Initialized with adaptive weight decay');
    }
  }

  /**
   * Check if retention gate is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Calculate retention score for a memory
   *
   * Incorporates MULS utility factor: High-Q memories decay slower, low-Q decay faster.
   * Formula: effectiveDecay = baseDecay * (1 - (normalizedQ * utilityFactor))
   */
  public calculateRetentionScore(
    memory: MemoryEntry,
    surpriseScore?: number,
    qValue?: number
  ): number {
    if (!this.enabled) return 1.0;

    const policy = this.policies.get(memory.stratum);
    if (!policy) return 1.0;

    // Start with base retention (inverse of decay)
    let retentionScore = 1.0 - policy.baseDecayRate;

    // Boost based on access patterns
    const daysSinceAccess = (Date.now() - memory.lastAccessed.getTime()) / (24 * 60 * 60 * 1000);
    const accessBoost = policy.accessBoostFactor * Math.exp(-daysSinceAccess / 7); // Decay over weeks
    retentionScore += accessBoost;

    // Boost based on access frequency
    const accessFrequencyBoost = Math.min(memory.accessCount / 100, 0.2);
    retentionScore += accessFrequencyBoost;

    // Boost based on surprise (if provided)
    if (surpriseScore !== undefined && surpriseScore > 0) {
      const surpriseBoost = policy.surpriseBoostFactor * surpriseScore;
      retentionScore += surpriseBoost;
    }

    // Boost based on importance
    const importanceBoost = policy.importanceWeight * (memory.importance / 5);
    retentionScore += importanceBoost;

    // Boost if memory has relationships
    const relationshipBoost = memory.relatedMemories.length > 0 ? 0.1 : 0;
    retentionScore += relationshipBoost;

    // MULS Utility Factor: High-Q memories get retention boost, low-Q get less
    // Q-value is 0-1 range, default 0.5 is neutral
    // Normalize Q-value so 0.5 is neutral: (q - 0.5) * 2 gives -1 to 1 range
    if (qValue === undefined) {
      // Try to get Q-value from QValueManager if available
      try {
        const qValueManager = QValueManager.getInstance();
        if (qValueManager.isEnabled()) {
          qValue = qValueManager.getQValue(memory.id);
        }
      } catch {
        // QValueManager not available, skip utility boost
      }
    }

    if (qValue !== undefined && policy.utilityBoostFactor > 0) {
      // Normalize Q-value: 0.5 is neutral, 1.0 is max boost, 0.0 is max penalty
      // utilityBoost ranges from -utilityBoostFactor to +utilityBoostFactor
      const normalizedQ = (qValue - 0.5) * 2; // Range: -1 to 1
      const utilityBoost = policy.utilityBoostFactor * normalizedQ;
      retentionScore += utilityBoost;
    }

    // Normalize to 0-1 range
    return Math.min(Math.max(retentionScore, 0), 1);
  }

  /**
   * Apply retention gate to a set of memories
   *
   * @param memories Memories to evaluate for retention
   * @param stratum Memory stratum for policy lookup
   * @param currentCapacity Current capacity usage
   * @param surpriseScores Optional surprise scores from SERC
   * @param qValues Optional Q-values from MULS for utility-based retention
   */
  public applyRetentionGate(
    memories: MemoryEntry[],
    stratum: MemoryStratum,
    currentCapacity: number,
    surpriseScores?: Map<string, number>,
    qValues?: Map<string, number>
  ): DecayResult[] {
    if (!this.enabled || memories.length === 0) {
      return [];
    }

    const policy = this.policies.get(stratum);
    if (!policy) return [];

    const capacity = STRATUM_CAPACITY[stratum];
    const utilizationRatio = currentCapacity / capacity;
    const results: DecayResult[] = [];

    // Calculate adaptive decay rate if capacity is exceeded
    let effectiveDecayRate = policy.baseDecayRate;
    if (policy.adaptiveDecayEnabled && utilizationRatio > policy.capacityThreshold) {
      // Increase decay rate as capacity fills
      const capacityExcess = (utilizationRatio - policy.capacityThreshold) / (1 - policy.capacityThreshold);
      effectiveDecayRate = Math.min(policy.baseDecayRate * (1 + capacityExcess * 2), 0.95);
    }

    for (const memory of memories) {
      const surpriseScore = surpriseScores?.get(memory.id);
      const qValue = qValues?.get(memory.id);
      const originalScore = this.calculateRetentionScore(memory, surpriseScore, qValue);

      // Apply decay
      const decayedScore = originalScore * (1 - effectiveDecayRate);

      // Retention threshold (memories below this are candidates for removal)
      const retentionThreshold = 0.3;
      const shouldRetain = decayedScore >= retentionThreshold;

      let reason: string;
      if (!shouldRetain) {
        reason = `Retention score ${decayedScore.toFixed(3)} below threshold ${retentionThreshold}`;
      } else if (utilizationRatio > policy.capacityThreshold) {
        reason = `Retained despite capacity pressure (score: ${decayedScore.toFixed(3)})`;
      } else {
        reason = `Normal retention (score: ${decayedScore.toFixed(3)})`;
      }

      results.push({
        memoryId: memory.id,
        originalScore,
        decayedScore,
        shouldRetain,
        reason
      });
    }

    // If still over capacity, remove lowest scoring memories
    if (utilizationRatio > 1.0) {
      const toRemove = Math.ceil(currentCapacity - capacity);
      const sortedResults = results
        .filter(r => r.shouldRetain)
        .sort((a, b) => a.decayedScore - b.decayedScore);

      for (let i = 0; i < Math.min(toRemove, sortedResults.length); i++) {
        sortedResults[i].shouldRetain = false;
        sortedResults[i].reason = `Removed due to capacity limit (lowest score: ${sortedResults[i].decayedScore.toFixed(3)})`;
      }
    }

    return results;
  }

  /**
   * Get retention statistics for a set of memories
   */
  public getStatistics(
    results: DecayResult[]
  ): RetentionStatistics {
    if (results.length === 0) {
      return {
        totalMemories: 0,
        retained: 0,
        decayed: 0,
        avgRetentionScore: 0,
        capacityUtilization: 0
      };
    }

    const retained = results.filter(r => r.shouldRetain).length;
    const decayed = results.length - retained;
    const avgRetentionScore = results.reduce((sum, r) => sum + r.decayedScore, 0) / results.length;

    return {
      totalMemories: results.length,
      retained,
      decayed,
      avgRetentionScore,
      capacityUtilization: retained / results.length
    };
  }

  /**
   * Update retention policy for a stratum
   */
  public updatePolicy(
    stratum: MemoryStratum,
    updates: Partial<RetentionPolicy>
  ): void {
    const currentPolicy = this.policies.get(stratum);
    if (!currentPolicy) return;

    this.policies.set(stratum, {
      ...currentPolicy,
      ...updates
    });

    this.logger.info(`[RetentionGateService] Updated retention policy for ${stratum} stratum`);
  }

  /**
   * Get current policy for a stratum
   */
  public getPolicy(stratum: MemoryStratum): RetentionPolicy | undefined {
    return this.policies.get(stratum);
  }

  /**
   * Reset to default policies
   */
  public resetPolicies(): void {
    for (const [stratum, policy] of Object.entries(DEFAULT_RETENTION_POLICIES)) {
      this.policies.set(stratum as MemoryStratum, policy);
    }
    this.logger.info('[RetentionGateService] Reset to default retention policies');
  }
}
