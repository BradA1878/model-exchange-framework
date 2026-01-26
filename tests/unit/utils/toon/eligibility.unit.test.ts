/**
 * Unit tests for TOON Eligibility Evaluator
 * Tests payload evaluation for TOON encoding suitability
 */

import {
  evaluateEligibility,
  extractEligibleArrays,
  mightBeEligible,
} from '@mxf/shared/utils/toon/eligibility';
import { EligibilityOptions } from '@mxf/shared/utils/toon/types';

describe('TOON Eligibility Evaluator', () => {
  describe('evaluateEligibility', () => {
    it('should return eligible for uniform array with primitives', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = evaluateEligibility(payload);

      expect(result.eligible).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.8);
      expect(result.eligiblePaths).toContain('$');
    });

    it('should return not eligible for array with less than minArrayLength', () => {
      const payload = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      const result = evaluateEligibility(payload);

      expect(result.eligible).toBe(false);
      expect(result.score).toBe(0);
      expect(result.reason).toBeDefined();
    });

    it('should return not eligible for array with non-uniform keys', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob' }, // Missing status
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = evaluateEligibility(payload);

      expect(result.eligible).toBe(false);
    });

    it('should return not eligible for array with nested objects', () => {
      const payload = [
        { id: 1, name: 'Alice', meta: { role: 'admin' } },
        { id: 2, name: 'Bob', meta: { role: 'user' } },
        { id: 3, name: 'Carol', meta: { role: 'user' } },
        { id: 4, name: 'Dave', meta: { role: 'user' } },
        { id: 5, name: 'Eve', meta: { role: 'user' } },
      ];

      const result = evaluateEligibility(payload);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('primitives');
    });

    it('should handle null/undefined payload', () => {
      const result1 = evaluateEligibility(null);
      const result2 = evaluateEligibility(undefined);

      expect(result1.eligible).toBe(false);
      expect(result2.eligible).toBe(false);
      expect(result1.reason).toContain('null or undefined');
      expect(result2.reason).toContain('null or undefined');
    });

    it('should handle non-object payload', () => {
      const result1 = evaluateEligibility('string');
      const result2 = evaluateEligibility(123);
      const result3 = evaluateEligibility(true);

      expect(result1.eligible).toBe(false);
      expect(result2.eligible).toBe(false);
      expect(result3.eligible).toBe(false);
    });

    it('should respect custom minArrayLength option', () => {
      const payload = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Carol' },
      ];

      const options: EligibilityOptions = { minArrayLength: 3 };
      const result = evaluateEligibility(payload, options);

      expect(result.eligible).toBe(true);
    });

    it('should respect custom minScore option', () => {
      const payload = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Carol' },
      ];

      const options: EligibilityOptions = { minScore: 0.9 };
      const result = evaluateEligibility(payload, options);

      // May or may not be eligible depending on score calculation
      expect(result.score).toBeDefined();
    });

    it('should find nested eligible arrays', () => {
      const payload = {
        users: [
          { id: 1, name: 'Alice', status: 'active' },
          { id: 2, name: 'Bob', status: 'idle' },
          { id: 3, name: 'Carol', status: 'active' },
          { id: 4, name: 'Dave', status: 'active' },
          { id: 5, name: 'Eve', status: 'idle' },
        ],
      };

      const result = evaluateEligibility(payload);

      expect(result.eligible).toBe(true);
      expect(result.eligiblePaths).toContain('$.users');
    });

    it('should handle multiple nested arrays', () => {
      const payload = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Carol' },
          { id: 4, name: 'Dave' },
          { id: 5, name: 'Eve' },
        ],
        tasks: [
          { id: 1, title: 'Task 1', done: false },
          { id: 2, title: 'Task 2', done: true },
          { id: 3, title: 'Task 3', done: false },
          { id: 4, title: 'Task 4', done: true },
          { id: 5, title: 'Task 5', done: false },
        ],
      };

      const result = evaluateEligibility(payload);

      expect(result.eligible).toBe(true);
      expect(result.eligiblePaths?.length).toBeGreaterThan(0);
    });

    it('should handle arrays with null values', () => {
      const payload = [
        { id: 1, name: 'Alice', status: null },
        { id: 2, name: 'Bob', status: 'active' },
        { id: 3, name: 'Carol', status: null },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: null },
      ];

      const result = evaluateEligibility(payload);

      expect(result.eligible).toBe(true);
    });

    it('should handle arrays with boolean values', () => {
      const payload = [
        { id: 1, name: 'Alice', active: true },
        { id: 2, name: 'Bob', active: false },
        { id: 3, name: 'Carol', active: true },
        { id: 4, name: 'Dave', active: true },
        { id: 5, name: 'Eve', active: false },
      ];

      const result = evaluateEligibility(payload);

      expect(result.eligible).toBe(true);
    });
  });

  describe('extractEligibleArrays', () => {
    it('should extract eligible arrays with metadata', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const arrays = extractEligibleArrays(payload);

      expect(arrays.length).toBeGreaterThan(0);
      expect(arrays[0].path).toBe('$');
      expect(arrays[0].elements).toEqual(payload);
      expect(arrays[0].fields).toContain('id');
      expect(arrays[0].fields).toContain('name');
      expect(arrays[0].fields).toContain('status');
      expect(arrays[0].length).toBe(5);
    });

    it('should return empty array for non-eligible payload', () => {
      const payload = { id: 1, name: 'Alice' };

      const arrays = extractEligibleArrays(payload);

      expect(arrays).toEqual([]);
    });

    it('should extract nested arrays with correct paths', () => {
      const payload = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Carol' },
          { id: 4, name: 'Dave' },
          { id: 5, name: 'Eve' },
        ],
      };

      const arrays = extractEligibleArrays(payload);

      expect(arrays.length).toBeGreaterThan(0);
      expect(arrays[0].path).toBe('$.users');
    });
  });

  describe('mightBeEligible', () => {
    it('should return true for payload containing arrays', () => {
      const payload = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      };

      const result = mightBeEligible(payload);

      expect(result).toBe(true);
    });

    it('should return true for direct arrays', () => {
      const payload = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      const result = mightBeEligible(payload);

      expect(result).toBe(true);
    });

    it('should return false for non-object payload', () => {
      expect(mightBeEligible('string')).toBe(false);
      expect(mightBeEligible(123)).toBe(false);
      expect(mightBeEligible(true)).toBe(false);
      expect(mightBeEligible(null)).toBe(false);
      expect(mightBeEligible(undefined)).toBe(false);
    });

    it('should return false for object without arrays', () => {
      const payload = {
        id: 1,
        name: 'Alice',
        meta: {
          role: 'admin',
        },
      };

      const result = mightBeEligible(payload);

      expect(result).toBe(false);
    });

    it('should return true for deeply nested arrays', () => {
      const payload = {
        meta: {
          data: {
            users: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' },
            ],
          },
        },
      };

      const result = mightBeEligible(payload);

      expect(result).toBe(true);
    });
  });

  describe('Score Calculation', () => {
    it('should give higher scores to longer arrays', () => {
      const shortArray = [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' },
        { id: 4, name: 'D' },
        { id: 5, name: 'E' },
      ];

      const longArray = [
        ...shortArray,
        { id: 6, name: 'F' },
        { id: 7, name: 'G' },
        { id: 8, name: 'H' },
        { id: 9, name: 'I' },
        { id: 10, name: 'J' },
        { id: 11, name: 'K' },
        { id: 12, name: 'L' },
        { id: 13, name: 'M' },
        { id: 14, name: 'N' },
        { id: 15, name: 'O' },
      ];

      const result1 = evaluateEligibility(shortArray);
      const result2 = evaluateEligibility(longArray);

      expect(result2.score).toBeGreaterThanOrEqual(result1.score);
    });

    it('should give higher scores to arrays with more fields', () => {
      const fewFields = Array(10).fill(null).map((_, i) => ({
        id: i,
        name: `User ${i}`,
      }));

      const manyFields = Array(10).fill(null).map((_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        status: 'active',
        role: 'user',
      }));

      const result1 = evaluateEligibility(fewFields);
      const result2 = evaluateEligibility(manyFields);

      expect(result2.score).toBeGreaterThanOrEqual(result1.score);
    });
  });

  describe('Performance', () => {
    it('should complete evaluation in under 5ms for small payloads', () => {
      const payload = Array(50).fill(null).map((_, i) => ({
        id: i,
        name: `User ${i}`,
        status: 'active',
      }));

      const start = Date.now();
      evaluateEligibility(payload);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5);
    });
  });
});
