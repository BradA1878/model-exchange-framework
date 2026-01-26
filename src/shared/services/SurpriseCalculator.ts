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
 * SurpriseCalculator Service
 *
 * Implements surprise-based memory encoding from Google's Titans architecture.
 * Surprise is the gradient magnitude - the difference between expected and actual outcomes.
 * Includes momentum tracking to capture contextually related information.
 *
 * Feature flag: MEMORY_STRATA_ENABLED
 */

import { Logger } from '../utils/Logger';
import { SurpriseDetection, SurpriseType, MemoryExpectation } from '../types/MemoryStrataTypes';

/**
 * Prediction for calculating surprise
 */
export interface Prediction {
  id: string;
  agentId: string;
  content: string;
  predictedOutcome: unknown;
  confidence: number;
  timestamp: Date;
  context?: Record<string, unknown>;
}

/**
 * Actual outcome for comparison
 */
export interface Outcome {
  id: string;
  agentId: string;
  content: string;
  actualOutcome: unknown;
  timestamp: Date;
  context?: Record<string, unknown>;
  predictionId?: string;
}

/**
 * Surprise signal with momentum
 */
export interface SurpriseSignal {
  momentarySurprise: number;      // Current cycle surprise (0-1)
  pastSurprise: number;           // Momentum accumulator (0-1)
  effectiveSurprise: number;      // Combined surprise score (0-1)
  detection: SurpriseDetection;   // Detailed detection result
}

/**
 * Momentum accumulator for surprise tracking
 */
interface MomentumAccumulator {
  value: number;
  lastUpdate: Date;
  decayRate: number;
}

/**
 * SurpriseCalculator handles surprise detection with momentum
 */
export class SurpriseCalculator {
  private static instance: SurpriseCalculator;
  private logger: Logger;

  // Prediction storage per agent
  private predictions: Map<string, Prediction[]>;

  // Surprise history per agent (for baseline calculation)
  private surpriseHistory: Map<string, number[]>;

  // Momentum accumulator per agent
  private momentumAccumulators: Map<string, MomentumAccumulator>;

  // Configuration
  private surpriseThreshold: number = 0.5;
  private momentumDecayRate: number = 0.7;
  private momentumBoostFactor: number = 2.0;
  private historyWindowSize: number = 50;
  private enabled: boolean = false;

  private constructor() {
    this.logger = new Logger('info', 'SurpriseCalculator');
    this.predictions = new Map();
    this.surpriseHistory = new Map();
    this.momentumAccumulators = new Map();
  }

  public static getInstance(): SurpriseCalculator {
    if (!SurpriseCalculator.instance) {
      SurpriseCalculator.instance = new SurpriseCalculator();
    }
    return SurpriseCalculator.instance;
  }

  /**
   * Initialize the SurpriseCalculator
   */
  public initialize(config: {
    enabled: boolean;
    threshold?: number;
    momentumDecayRate?: number;
    momentumBoostFactor?: number;
  }): void {
    this.enabled = config.enabled;
    if (config.threshold !== undefined) this.surpriseThreshold = config.threshold;
    if (config.momentumDecayRate !== undefined) this.momentumDecayRate = config.momentumDecayRate;
    if (config.momentumBoostFactor !== undefined) this.momentumBoostFactor = config.momentumBoostFactor;

    if (this.enabled) {
      this.logger.info('[SurpriseCalculator] Initialized with Titans-style surprise detection');
    }
  }

  /**
   * Check if surprise calculation is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Store a prediction for future surprise calculation
   */
  public async storePrediction(prediction: Prediction): Promise<void> {
    if (!this.enabled) return;

    const agentPredictions = this.predictions.get(prediction.agentId) || [];
    agentPredictions.push(prediction);

    // Keep only recent predictions
    if (agentPredictions.length > this.historyWindowSize) {
      agentPredictions.shift();
    }

    this.predictions.set(prediction.agentId, agentPredictions);

    this.logger.debug(`[SurpriseCalculator] Stored prediction ${prediction.id} for agent ${prediction.agentId}`);
  }

  /**
   * Calculate surprise signal with momentum
   */
  public async calculateSurprise(outcome: Outcome): Promise<SurpriseSignal> {
    if (!this.enabled) {
      return this.createDefaultSurpriseSignal();
    }

    // Find matching prediction
    const agentPredictions = this.predictions.get(outcome.agentId) || [];
    const prediction = outcome.predictionId
      ? agentPredictions.find(p => p.id === outcome.predictionId)
      : this.findMatchingPrediction(agentPredictions, outcome);

    // Calculate momentary surprise
    const momentarySurprise = prediction
      ? this.calculatePredictionError(prediction, outcome)
      : this.calculateNovelty(outcome);

    // Get or create momentum accumulator
    const accumulator = this.getOrCreateAccumulator(outcome.agentId);

    // Apply decay to momentum
    this.decayMomentum(accumulator);

    // Get past surprise from momentum
    const pastSurprise = accumulator.value;

    // Calculate effective surprise
    const effectiveSurprise = Math.min(momentarySurprise + pastSurprise * 0.3, 1.0);

    // Update momentum if surprise is significant
    if (momentarySurprise > this.surpriseThreshold) {
      accumulator.value = Math.min(
        accumulator.value + momentarySurprise * this.momentumBoostFactor,
        1.0
      );
      accumulator.lastUpdate = new Date();
    }

    // Store in history
    this.addToHistory(outcome.agentId, effectiveSurprise);

    // Create detection result
    const detection = this.createSurpriseDetection(
      effectiveSurprise,
      prediction,
      outcome
    );

    this.logger.debug(
      `[SurpriseCalculator] Agent ${outcome.agentId}: momentary=${momentarySurprise.toFixed(3)}, ` +
      `past=${pastSurprise.toFixed(3)}, effective=${effectiveSurprise.toFixed(3)}`
    );

    return {
      momentarySurprise,
      pastSurprise,
      effectiveSurprise,
      detection
    };
  }

  /**
   * Calculate surprise without a prior prediction (novelty-based)
   */
  public async calculateNoveltyScore(
    agentId: string,
    content: string,
    context?: Record<string, unknown>
  ): Promise<number> {
    if (!this.enabled) return 0;

    const outcome: Outcome = {
      id: `novelty-${Date.now()}`,
      agentId,
      content,
      actualOutcome: context,
      timestamp: new Date(),
      context
    };

    const surpriseSignal = await this.calculateSurprise(outcome);
    return surpriseSignal.effectiveSurprise;
  }

  /**
   * Get surprise statistics for an agent
   */
  public getStatistics(agentId: string): {
    avgSurprise: number;
    recentSurprises: number;
    momentum: number;
    predictionCount: number;
  } {
    const history = this.surpriseHistory.get(agentId) || [];
    const accumulator = this.momentumAccumulators.get(agentId);
    const predictions = this.predictions.get(agentId) || [];

    const avgSurprise = history.length > 0
      ? history.reduce((sum, s) => sum + s, 0) / history.length
      : 0;

    const recentSurprises = history.filter(s => s > this.surpriseThreshold).length;

    return {
      avgSurprise,
      recentSurprises,
      momentum: accumulator?.value || 0,
      predictionCount: predictions.length
    };
  }

  /**
   * Clear surprise data for an agent
   */
  public clear(agentId: string): void {
    this.predictions.delete(agentId);
    this.surpriseHistory.delete(agentId);
    this.momentumAccumulators.delete(agentId);
    this.logger.info(`[SurpriseCalculator] Cleared surprise data for agent ${agentId}`);
  }

  // Private helper methods

  private calculatePredictionError(prediction: Prediction, outcome: Outcome): number {
    // Calculate error based on prediction confidence and outcome match
    const contentMatch = this.calculateContentSimilarity(
      prediction.content,
      outcome.content
    );

    // Surprise is inverse of match, weighted by confidence
    const error = (1 - contentMatch) * prediction.confidence;

    // Normalize to 0-1
    return Math.min(Math.max(error, 0), 1);
  }

  private calculateNovelty(outcome: Outcome): number {
    // Calculate novelty based on historical patterns
    const history = this.surpriseHistory.get(outcome.agentId) || [];

    if (history.length === 0) {
      // First observation is moderately novel
      return 0.5;
    }

    // Calculate variance from historical average
    const avgSurprise = history.reduce((sum, s) => sum + s, 0) / history.length;
    const variance = history.reduce((sum, s) => sum + Math.pow(s - avgSurprise, 2), 0) / history.length;

    // High variance means unpredictable, so assume moderate surprise
    const baseNovelty = Math.min(variance * 2, 0.7);

    return baseNovelty;
  }

  private calculateContentSimilarity(content1: string, content2: string): number {
    // Simple word-overlap similarity
    const words1 = new Set(content1.toLowerCase().split(/\s+/));
    const words2 = new Set(content2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private findMatchingPrediction(predictions: Prediction[], outcome: Outcome): Prediction | undefined {
    // Find most recent prediction within time window
    const recentPredictions = predictions.filter(p => {
      const timeDiff = outcome.timestamp.getTime() - p.timestamp.getTime();
      return timeDiff > 0 && timeDiff < 60000; // Within 1 minute
    });

    if (recentPredictions.length === 0) return undefined;

    // Return most confident recent prediction
    return recentPredictions.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );
  }

  private getOrCreateAccumulator(agentId: string): MomentumAccumulator {
    if (!this.momentumAccumulators.has(agentId)) {
      this.momentumAccumulators.set(agentId, {
        value: 0,
        lastUpdate: new Date(),
        decayRate: this.momentumDecayRate
      });
    }
    return this.momentumAccumulators.get(agentId)!;
  }

  private decayMomentum(accumulator: MomentumAccumulator): void {
    const now = Date.now();
    const elapsed = now - accumulator.lastUpdate.getTime();
    const cyclesElapsed = Math.floor(elapsed / 1000); // Assume 1 second per cycle

    if (cyclesElapsed > 0) {
      accumulator.value *= Math.pow(accumulator.decayRate, cyclesElapsed);
      accumulator.lastUpdate = new Date();
    }
  }

  private addToHistory(agentId: string, surprise: number): void {
    const history = this.surpriseHistory.get(agentId) || [];
    history.push(surprise);

    if (history.length > this.historyWindowSize) {
      history.shift();
    }

    this.surpriseHistory.set(agentId, history);
  }

  private createSurpriseDetection(
    surpriseScore: number,
    prediction: Prediction | undefined,
    outcome: Outcome
  ): SurpriseDetection {
    const isSurprising = surpriseScore > this.surpriseThreshold;

    let type: SurpriseType | undefined;
    let explanation: string | undefined;
    let expectation: MemoryExpectation | undefined;

    if (isSurprising) {
      if (prediction) {
        type = 'prediction_failure';
        explanation = `Predicted outcome did not match actual outcome (confidence: ${prediction.confidence.toFixed(2)})`;
        expectation = {
          expected: prediction.predictedOutcome,
          confidence: prediction.confidence,
          source: 'learning',
          basedOn: [prediction.id]
        };
      } else {
        type = 'novel_pattern';
        explanation = 'Encountered unexpected pattern without prior prediction';
        expectation = {
          expected: null,
          confidence: 0,
          source: 'prior',
          basedOn: []
        };
      }
    }

    return {
      isSurprising,
      surpriseScore,
      type,
      explanation,
      expectation,
      observation: outcome.content,
      suggestedActions: isSurprising
        ? ['Promote to slower memory stratum', 'Analyze pattern', 'Update expectations']
        : undefined
    };
  }

  private createDefaultSurpriseSignal(): SurpriseSignal {
    return {
      momentarySurprise: 0,
      pastSurprise: 0,
      effectiveSurprise: 0,
      detection: {
        isSurprising: false,
        surpriseScore: 0,
        observation: ''
      }
    };
  }
}
