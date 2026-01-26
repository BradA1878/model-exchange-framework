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
 * TOON Metrics Tracker
 *
 * This module tracks metrics for TOON encoding operations including:
 * - Encoding attempts and format selection
 * - Size/token savings
 * - Performance metrics
 * - Error rates
 *
 * Metrics are collected in-memory and can be exported for analytics.
 */

import { ToonMetrics, EncodeResult } from './types';
import { Logger } from '../Logger';

const logger = new Logger('debug', 'ToonMetrics', 'server');

/**
 * Global metrics collector
 */
class ToonMetricsCollector {
  private metrics: ToonMetrics;
  private eligibilityScores: number[] = [];
  private latencies: number[] = [];

  constructor() {
    this.metrics = this.createEmptyMetrics();
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): ToonMetrics {
    return {
      totalAttempts: 0,
      toonSelected: 0,
      jsonSelected: 0,
      totalOriginalBytes: 0,
      totalEncodedBytes: 0,
      totalTokenSavings: 0,
      averageEligibilityScore: 0,
      averageLatencyMs: 0,
      errorCount: 0,
    };
  }

  /**
   * Record an encoding operation
   *
   * @param result - The encode result to record
   */
  public recordEncoding(result: EncodeResult): void {
    try {
      this.metrics.totalAttempts++;

      if (result.format === 'toon') {
        this.metrics.toonSelected++;
      } else {
        this.metrics.jsonSelected++;
      }

      this.metrics.totalOriginalBytes += result.originalBytes;
      this.metrics.totalEncodedBytes += result.encodedBytes;
      this.metrics.totalTokenSavings += result.estimatedTokenSavings;

      // Track eligibility score
      if (result.eligibilityScore !== undefined) {
        this.eligibilityScores.push(result.eligibilityScore);
        this.metrics.averageEligibilityScore = this.calculateAverage(this.eligibilityScores);
      }

      // Track latency
      if (result.latencyMs !== undefined) {
        this.latencies.push(result.latencyMs);
        this.metrics.averageLatencyMs = this.calculateAverage(this.latencies);
      }
    } catch (error) {
      logger.error('Error recording encoding metrics', error);
    }
  }

  /**
   * Record an encoding error
   */
  public recordError(): void {
    this.metrics.errorCount++;
  }

  /**
   * Get current metrics snapshot
   *
   * @returns Current metrics
   */
  public getMetrics(): ToonMetrics {
    return { ...this.metrics };
  }

  /**
   * Get detailed metrics with additional stats
   *
   * @returns Detailed metrics object
   */
  public getDetailedMetrics(): ToonMetrics & {
    compressionRatio: number;
    toonSelectionRate: number;
    errorRate: number;
    medianLatencyMs: number;
    p95LatencyMs: number;
  } {
    const compressionRatio =
      this.metrics.totalOriginalBytes > 0
        ? this.metrics.totalEncodedBytes / this.metrics.totalOriginalBytes
        : 1;

    const toonSelectionRate =
      this.metrics.totalAttempts > 0
        ? this.metrics.toonSelected / this.metrics.totalAttempts
        : 0;

    const errorRate =
      this.metrics.totalAttempts > 0
        ? this.metrics.errorCount / this.metrics.totalAttempts
        : 0;

    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const medianLatencyMs = this.calculatePercentile(sortedLatencies, 50);
    const p95LatencyMs = this.calculatePercentile(sortedLatencies, 95);

    return {
      ...this.metrics,
      compressionRatio,
      toonSelectionRate,
      errorRate,
      medianLatencyMs,
      p95LatencyMs,
    };
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    this.metrics = this.createEmptyMetrics();
    this.eligibilityScores = [];
    this.latencies = [];
    logger.info('TOON metrics reset');
  }

  /**
   * Calculate average of an array
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  /**
   * Export metrics as JSON
   *
   * @returns JSON string of current metrics
   */
  public exportJson(): string {
    return JSON.stringify(this.getDetailedMetrics(), null, 2);
  }

  /**
   * Get metrics summary as human-readable string
   *
   * @returns Human-readable summary
   */
  public getSummary(): string {
    const detailed = this.getDetailedMetrics();
    const lines = [
      'TOON Encoding Metrics Summary',
      '============================',
      '',
      `Total Attempts: ${detailed.totalAttempts}`,
      `TOON Selected: ${detailed.toonSelected} (${(detailed.toonSelectionRate * 100).toFixed(1)}%)`,
      `JSON Selected: ${detailed.jsonSelected}`,
      '',
      `Original Size: ${this.formatBytes(detailed.totalOriginalBytes)}`,
      `Encoded Size: ${this.formatBytes(detailed.totalEncodedBytes)}`,
      `Compression Ratio: ${(detailed.compressionRatio * 100).toFixed(1)}%`,
      `Token Savings: ${detailed.totalTokenSavings} tokens`,
      '',
      `Average Eligibility Score: ${detailed.averageEligibilityScore.toFixed(2)}`,
      `Average Latency: ${detailed.averageLatencyMs.toFixed(2)}ms`,
      `Median Latency: ${detailed.medianLatencyMs.toFixed(2)}ms`,
      `P95 Latency: ${detailed.p95LatencyMs.toFixed(2)}ms`,
      '',
      `Errors: ${detailed.errorCount} (${(detailed.errorRate * 100).toFixed(1)}%)`,
    ];

    return lines.join('\n');
  }

  /**
   * Format bytes as human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}

/**
 * Global metrics collector instance
 */
const globalCollector = new ToonMetricsCollector();

/**
 * Record an encoding operation
 *
 * @param result - The encode result to record
 */
export function recordEncoding(result: EncodeResult): void {
  globalCollector.recordEncoding(result);
}

/**
 * Record an encoding error
 */
export function recordError(): void {
  globalCollector.recordError();
}

/**
 * Get current metrics
 *
 * @returns Current metrics snapshot
 */
export function getMetrics(): ToonMetrics {
  return globalCollector.getMetrics();
}

/**
 * Get detailed metrics with additional statistics
 *
 * @returns Detailed metrics object
 */
export function getDetailedMetrics(): ReturnType<typeof globalCollector.getDetailedMetrics> {
  return globalCollector.getDetailedMetrics();
}

/**
 * Reset all metrics
 */
export function resetMetrics(): void {
  globalCollector.reset();
}

/**
 * Export metrics as JSON string
 *
 * @returns JSON string of metrics
 */
export function exportMetricsJson(): string {
  return globalCollector.exportJson();
}

/**
 * Get metrics summary as human-readable string
 *
 * @returns Human-readable summary
 */
export function getMetricsSummary(): string {
  return globalCollector.getSummary();
}

/**
 * Log current metrics summary
 */
export function logMetricsSummary(): void {
  logger.info('\n' + globalCollector.getSummary());
}

/**
 * Create a metrics snapshot for a specific context
 *
 * This is useful for tracking metrics per-channel or per-agent.
 *
 * @param context - Context identifier
 * @returns Metrics collector for this context
 */
export function createContextCollector(context: string): {
  record: (result: EncodeResult) => void;
  recordError: () => void;
  getMetrics: () => ToonMetrics;
  getSummary: () => string;
} {
  const contextLogger = new Logger('debug', `ToonMetrics:${context}`, 'server');
  const collector = new ToonMetricsCollector();

  return {
    record: (result: EncodeResult) => {
      collector.recordEncoding(result);
      contextLogger.debug(`Recorded encoding: ${result.format}`);
    },
    recordError: () => {
      collector.recordError();
      contextLogger.warn('Recorded encoding error');
    },
    getMetrics: () => collector.getMetrics(),
    getSummary: () => collector.getSummary(),
  };
}
