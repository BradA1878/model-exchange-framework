/**
 * Unit tests for TOON Metrics Tracker
 * Tests metrics collection, aggregation, and reporting
 */

import {
  recordEncoding,
  recordError,
  getMetrics,
  getDetailedMetrics,
  resetMetrics,
  exportMetricsJson,
  getMetricsSummary,
  createContextCollector,
} from '@mxf/shared/utils/toon/metrics';
import { EncodeResult } from '@mxf/shared/utils/toon/types';

describe('TOON Metrics Tracker', () => {
  beforeEach(() => {
    // Reset metrics before each test
    resetMetrics();
  });

  describe('recordEncoding', () => {
    it('should record TOON encoding result', () => {
      const result: EncodeResult = {
        output: '```toon\ndata[5]{id,name}:\n  1,Alice\n```',
        format: 'toon',
        originalBytes: 200,
        encodedBytes: 150,
        estimatedTokenSavings: 12,
        latencyMs: 5,
        eligibilityScore: 0.85,
      };

      recordEncoding(result);

      const metrics = getMetrics();
      expect(metrics.totalAttempts).toBe(1);
      expect(metrics.toonSelected).toBe(1);
      expect(metrics.jsonSelected).toBe(0);
      expect(metrics.totalOriginalBytes).toBe(200);
      expect(metrics.totalEncodedBytes).toBe(150);
      expect(metrics.totalTokenSavings).toBe(12);
    });

    it('should record JSON encoding result', () => {
      const result: EncodeResult = {
        output: '```json\n{"id": 1}\n```',
        format: 'json',
        originalBytes: 100,
        encodedBytes: 100,
        estimatedTokenSavings: 0,
        latencyMs: 2,
        eligibilityScore: 0.3,
      };

      recordEncoding(result);

      const metrics = getMetrics();
      expect(metrics.totalAttempts).toBe(1);
      expect(metrics.toonSelected).toBe(0);
      expect(metrics.jsonSelected).toBe(1);
      expect(metrics.totalTokenSavings).toBe(0);
    });

    it('should track average eligibility score', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
        eligibilityScore: 0.8,
      });

      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
        eligibilityScore: 0.9,
      });

      const metrics = getMetrics();
      expect(metrics.averageEligibilityScore).toBeCloseTo(0.85, 1);
    });

    it('should track average latency', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
        latencyMs: 10,
      });

      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
        latencyMs: 20,
      });

      const metrics = getMetrics();
      expect(metrics.averageLatencyMs).toBe(15);
    });

    it('should accumulate metrics across multiple recordings', () => {
      for (let i = 0; i < 10; i++) {
        recordEncoding({
          output: '',
          format: 'toon',
          originalBytes: 100,
          encodedBytes: 80,
          estimatedTokenSavings: 5,
        });
      }

      const metrics = getMetrics();
      expect(metrics.totalAttempts).toBe(10);
      expect(metrics.toonSelected).toBe(10);
      expect(metrics.totalOriginalBytes).toBe(1000);
      expect(metrics.totalEncodedBytes).toBe(800);
      expect(metrics.totalTokenSavings).toBe(50);
    });
  });

  describe('recordError', () => {
    it('should increment error count', () => {
      recordError();

      const metrics = getMetrics();
      expect(metrics.errorCount).toBe(1);
    });

    it('should track multiple errors', () => {
      recordError();
      recordError();
      recordError();

      const metrics = getMetrics();
      expect(metrics.errorCount).toBe(3);
    });
  });

  describe('getMetrics', () => {
    it('should return snapshot of current metrics', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      const metrics = getMetrics();

      expect(metrics).toHaveProperty('totalAttempts');
      expect(metrics).toHaveProperty('toonSelected');
      expect(metrics).toHaveProperty('jsonSelected');
      expect(metrics).toHaveProperty('totalOriginalBytes');
      expect(metrics).toHaveProperty('totalEncodedBytes');
      expect(metrics).toHaveProperty('totalTokenSavings');
      expect(metrics).toHaveProperty('averageEligibilityScore');
      expect(metrics).toHaveProperty('averageLatencyMs');
      expect(metrics).toHaveProperty('errorCount');
    });

    it('should return independent copy of metrics', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      const metrics1 = getMetrics();
      const metrics2 = getMetrics();

      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });
  });

  describe('getDetailedMetrics', () => {
    it('should include additional statistics', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 200,
        encodedBytes: 150,
        estimatedTokenSavings: 12,
        latencyMs: 10,
      });

      const detailed = getDetailedMetrics();

      expect(detailed).toHaveProperty('compressionRatio');
      expect(detailed).toHaveProperty('toonSelectionRate');
      expect(detailed).toHaveProperty('errorRate');
      expect(detailed).toHaveProperty('medianLatencyMs');
      expect(detailed).toHaveProperty('p95LatencyMs');
    });

    it('should calculate compression ratio correctly', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 200,
        encodedBytes: 150,
        estimatedTokenSavings: 12,
      });

      const detailed = getDetailedMetrics();

      expect(detailed.compressionRatio).toBe(0.75); // 150/200
    });

    it('should calculate TOON selection rate correctly', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      recordEncoding({
        output: '',
        format: 'json',
        originalBytes: 50,
        encodedBytes: 50,
        estimatedTokenSavings: 0,
      });

      const detailed = getDetailedMetrics();

      expect(detailed.toonSelectionRate).toBe(0.5); // 1 out of 2
    });

    it('should calculate error rate correctly', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      recordError();

      const detailed = getDetailedMetrics();

      expect(detailed.errorRate).toBe(1); // 1 error out of 1 attempt
    });

    it('should calculate median latency', () => {
      const latencies = [5, 10, 15, 20, 25];
      for (const latency of latencies) {
        recordEncoding({
          output: '',
          format: 'toon',
          originalBytes: 100,
          encodedBytes: 80,
          estimatedTokenSavings: 5,
          latencyMs: latency,
        });
      }

      const detailed = getDetailedMetrics();

      expect(detailed.medianLatencyMs).toBe(15);
    });

    it('should calculate P95 latency', () => {
      const latencies = Array(100).fill(null).map((_, i) => i + 1);
      for (const latency of latencies) {
        recordEncoding({
          output: '',
          format: 'toon',
          originalBytes: 100,
          encodedBytes: 80,
          estimatedTokenSavings: 5,
          latencyMs: latency,
        });
      }

      const detailed = getDetailedMetrics();

      expect(detailed.p95LatencyMs).toBe(95);
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics to zero', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      recordError();

      resetMetrics();

      const metrics = getMetrics();
      expect(metrics.totalAttempts).toBe(0);
      expect(metrics.toonSelected).toBe(0);
      expect(metrics.jsonSelected).toBe(0);
      expect(metrics.totalOriginalBytes).toBe(0);
      expect(metrics.totalEncodedBytes).toBe(0);
      expect(metrics.totalTokenSavings).toBe(0);
      expect(metrics.averageEligibilityScore).toBe(0);
      expect(metrics.averageLatencyMs).toBe(0);
      expect(metrics.errorCount).toBe(0);
    });
  });

  describe('exportMetricsJson', () => {
    it('should export metrics as JSON string', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      const json = exportMetricsJson();

      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json);
      expect(parsed.totalAttempts).toBe(1);
    });

    it('should include detailed metrics in export', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      const json = exportMetricsJson();
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('compressionRatio');
      expect(parsed).toHaveProperty('toonSelectionRate');
      expect(parsed).toHaveProperty('errorRate');
    });
  });

  describe('getMetricsSummary', () => {
    it('should generate human-readable summary', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 1000,
        encodedBytes: 700,
        estimatedTokenSavings: 75,
      });

      const summary = getMetricsSummary();

      expect(summary).toContain('TOON Encoding Metrics Summary');
      expect(summary).toContain('Total Attempts: 1');
      expect(summary).toContain('TOON Selected: 1');
      expect(summary).toContain('Token Savings: 75');
    });

    it('should include formatted byte sizes', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 2048,
        encodedBytes: 1024,
        estimatedTokenSavings: 256,
      });

      const summary = getMetricsSummary();

      expect(summary).toContain('KB'); // Should format as KB
    });

    it('should include compression ratio', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 1000,
        encodedBytes: 700,
        estimatedTokenSavings: 75,
      });

      const summary = getMetricsSummary();

      expect(summary).toContain('Compression Ratio: 70.0%');
    });
  });

  describe('createContextCollector', () => {
    it('should create independent metrics collector', () => {
      const collector1 = createContextCollector('channel-1');
      const collector2 = createContextCollector('channel-2');

      collector1.record({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      const metrics1 = collector1.getMetrics();
      const metrics2 = collector2.getMetrics();

      expect(metrics1.totalAttempts).toBe(1);
      expect(metrics2.totalAttempts).toBe(0);
    });

    it('should track errors independently', () => {
      const collector1 = createContextCollector('channel-1');
      const collector2 = createContextCollector('channel-2');

      collector1.recordError();

      const metrics1 = collector1.getMetrics();
      const metrics2 = collector2.getMetrics();

      expect(metrics1.errorCount).toBe(1);
      expect(metrics2.errorCount).toBe(0);
    });

    it('should generate context-specific summary', () => {
      const collector = createContextCollector('test-channel');

      collector.record({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      const summary = collector.getSummary();

      expect(summary).toContain('TOON Encoding Metrics Summary');
      expect(summary).toContain('Total Attempts: 1');
    });

    it('should not affect global metrics', () => {
      const collector = createContextCollector('test-channel');

      collector.record({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
      });

      const globalMetrics = getMetrics();
      const contextMetrics = collector.getMetrics();

      expect(globalMetrics.totalAttempts).toBe(0);
      expect(contextMetrics.totalAttempts).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero attempts', () => {
      const metrics = getMetrics();

      expect(metrics.totalAttempts).toBe(0);
      expect(metrics.averageEligibilityScore).toBe(0);
      expect(metrics.averageLatencyMs).toBe(0);
    });

    it('should handle division by zero in detailed metrics', () => {
      const detailed = getDetailedMetrics();

      expect(detailed.compressionRatio).toBe(1);
      expect(detailed.toonSelectionRate).toBe(0);
      expect(detailed.errorRate).toBe(0);
    });

    it('should handle missing optional fields', () => {
      recordEncoding({
        output: '',
        format: 'toon',
        originalBytes: 100,
        encodedBytes: 80,
        estimatedTokenSavings: 5,
        // No latencyMs or eligibilityScore
      });

      const metrics = getMetrics();

      expect(metrics.averageEligibilityScore).toBe(0);
      expect(metrics.averageLatencyMs).toBe(0);
    });
  });

  describe('Integration', () => {
    it('should track realistic usage pattern', () => {
      // Simulate 10 TOON encodings
      for (let i = 0; i < 10; i++) {
        recordEncoding({
          output: '',
          format: 'toon',
          originalBytes: 1000 + i * 100,
          encodedBytes: 700 + i * 70,
          estimatedTokenSavings: 75 + i * 5,
          latencyMs: 10 + i,
          eligibilityScore: 0.8 + i * 0.01,
        });
      }

      // Simulate 5 JSON fallbacks
      for (let i = 0; i < 5; i++) {
        recordEncoding({
          output: '',
          format: 'json',
          originalBytes: 500 + i * 50,
          encodedBytes: 500 + i * 50,
          estimatedTokenSavings: 0,
          latencyMs: 2 + i,
          eligibilityScore: 0.3 + i * 0.05,
        });
      }

      // Simulate 2 errors
      recordError();
      recordError();

      const detailed = getDetailedMetrics();

      expect(detailed.totalAttempts).toBe(15);
      expect(detailed.toonSelected).toBe(10);
      expect(detailed.jsonSelected).toBe(5);
      expect(detailed.toonSelectionRate).toBeCloseTo(0.667, 2);
      expect(detailed.errorCount).toBe(2);
      expect(detailed.totalTokenSavings).toBeGreaterThan(0);
    });
  });
});
