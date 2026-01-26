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
 * TOON Eligibility Evaluator
 *
 * This module evaluates whether a payload is suitable for TOON encoding.
 * Eligible payloads contain arrays of uniform objects with primitive values.
 *
 * Eligibility criteria:
 * - Array contains at least minArrayLength elements (default: 5)
 * - Array elements are objects with identical keys
 * - All values are primitives (string, number, boolean, null)
 * - Calculated eligibility score >= minScore (default: 0.8)
 */

import { EligibilityResult, EligibilityOptions, ToonArray, ToonPrimitive } from './types';
import { Logger } from '../Logger';

const logger = new Logger('debug', 'ToonEligibility', 'server');

/**
 * Default eligibility options
 */
const DEFAULT_OPTIONS: Required<EligibilityOptions> = {
  minArrayLength: 5,
  minScore: 0.8,
};

/**
 * Check if a value is a primitive type allowed in TOON format
 */
function isPrimitive(value: any): value is ToonPrimitive {
  const type = typeof value;
  return (
    value === null ||
    type === 'string' ||
    type === 'number' ||
    type === 'boolean'
  );
}

/**
 * Check if all elements in an array are objects with the same keys
 */
function hasUniformKeys(elements: any[]): boolean {
  if (elements.length === 0) return false;
  if (!elements[0] || typeof elements[0] !== 'object') return false;

  // Get keys from first element as reference
  const referenceKeys = Object.keys(elements[0]).sort();

  // Check all elements have the same keys
  for (let i = 1; i < elements.length; i++) {
    if (!elements[i] || typeof elements[i] !== 'object') {
      return false;
    }

    const currentKeys = Object.keys(elements[i]).sort();
    if (currentKeys.length !== referenceKeys.length) {
      return false;
    }

    for (let j = 0; j < referenceKeys.length; j++) {
      if (currentKeys[j] !== referenceKeys[j]) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if all values in array elements are primitives
 */
function hasOnlyPrimitiveValues(elements: any[]): boolean {
  for (const element of elements) {
    for (const key in element) {
      if (!isPrimitive(element[key])) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Calculate eligibility score for an array
 *
 * Score calculation factors:
 * - Array length (longer arrays benefit more from TOON)
 * - Number of fields (more fields = more key repetition savings)
 * - Value complexity (primitives only = higher score)
 *
 * Score formula:
 * score = (lengthScore * 0.3) + (fieldScore * 0.3) + (uniformityScore * 0.4)
 *
 * Scoring is designed to give arrays meeting minimum criteria (5+ elements, 2+ fields, uniform)
 * a baseline score of ~0.8, with improvements for larger/more complex arrays.
 */
function calculateArrayScore(elements: any[]): number {
  if (elements.length === 0) return 0;

  // Length score: normalize array length with more generous curve
  // 5 elements = 0.8, 10 = 0.9, 15+ = 1.0
  const lengthScore = Math.min(0.6 + (elements.length / 25), 1.0);

  // Field score: more fields = better TOON benefit
  // 2 fields = 0.8, 3 = 0.87, 5+ = 1.0
  const fieldCount = Object.keys(elements[0]).length;
  const fieldScore = Math.min(0.7 + (fieldCount / 15), 1.0);

  // Uniformity score: all elements have same structure
  // This is critical - non-uniform arrays get 0 score
  const uniformityScore = hasUniformKeys(elements) ? 1.0 : 0.0;

  // Weighted average - uniformity is most important
  return (lengthScore * 0.3) + (fieldScore * 0.3) + (uniformityScore * 0.4);
}

/**
 * Find all TOON-eligible arrays in a payload recursively
 */
function findEligibleArrays(
  payload: any,
  options: Required<EligibilityOptions>,
  path: string = '$'
): ToonArray[] {
  const eligibleArrays: ToonArray[] = [];

  // Check if current value is an array
  if (Array.isArray(payload)) {
    // Check basic eligibility
    if (
      payload.length >= options.minArrayLength &&
      hasUniformKeys(payload) &&
      hasOnlyPrimitiveValues(payload)
    ) {
      const score = calculateArrayScore(payload);
      if (score >= options.minScore) {
        eligibleArrays.push({
          path,
          elements: payload,
          fields: Object.keys(payload[0]).sort(),
          length: payload.length,
        });
      }
    }
  }

  // Recursively check nested objects and arrays
  if (payload && typeof payload === 'object') {
    for (const key in payload) {
      if (payload.hasOwnProperty(key)) {
        const nestedPath = Array.isArray(payload) ? `${path}[${key}]` : `${path}.${key}`;
        const nested = findEligibleArrays(payload[key], options, nestedPath);
        eligibleArrays.push(...nested);
      }
    }
  }

  return eligibleArrays;
}

/**
 * Evaluate whether a payload is eligible for TOON encoding
 *
 * This function performs a comprehensive analysis of the payload structure
 * to determine if TOON encoding would provide benefits.
 *
 * @param payload - The payload to evaluate
 * @param options - Eligibility options
 * @returns Eligibility result with score and details
 */
export function evaluateEligibility(
  payload: unknown,
  options: EligibilityOptions = {}
): EligibilityResult {
  const opts: Required<EligibilityOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  // Start timing
  const startTime = Date.now();

  try {
    // Handle null/undefined
    if (payload === null || payload === undefined) {
      return {
        eligible: false,
        score: 0,
        reason: 'Payload is null or undefined',
      };
    }

    // Handle non-object types
    if (typeof payload !== 'object') {
      return {
        eligible: false,
        score: 0,
        reason: 'Payload is not an object or array',
      };
    }

    // Find all eligible arrays in the payload
    const eligibleArrays = findEligibleArrays(payload, opts);

    // Calculate evaluation latency
    const latencyMs = Date.now() - startTime;

    // Log if evaluation took too long (>5ms threshold)
    if (latencyMs > 5) {
      logger.warn(`Eligibility evaluation took ${latencyMs}ms (threshold: 5ms)`);
    }

    // No eligible arrays found
    if (eligibleArrays.length === 0) {
      return {
        eligible: false,
        score: 0,
        reason: 'No arrays meet eligibility criteria (uniform structure, primitives only, min length)',
      };
    }

    // Calculate overall score based on best eligible array
    const scores = eligibleArrays.map((arr) => calculateArrayScore(arr.elements));
    const maxScore = Math.max(...scores);

    return {
      eligible: true,
      score: maxScore,
      eligiblePaths: eligibleArrays.map((arr) => arr.path),
    };
  } catch (error) {
    logger.error('Error evaluating eligibility', error);
    return {
      eligible: false,
      score: 0,
      reason: `Evaluation error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Extract eligible arrays from a payload
 *
 * This is a helper function that returns the actual array data
 * that can be encoded in TOON format.
 *
 * @param payload - The payload to extract from
 * @param options - Eligibility options
 * @returns Array of TOON-eligible arrays with their paths
 */
export function extractEligibleArrays(
  payload: unknown,
  options: EligibilityOptions = {}
): ToonArray[] {
  const opts: Required<EligibilityOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  return findEligibleArrays(payload, opts);
}

/**
 * Quick check if a value looks like it might be TOON-eligible
 *
 * This is a fast pre-check that can be used before doing full evaluation.
 * It doesn't guarantee eligibility but filters out obvious non-candidates.
 *
 * @param payload - The payload to check
 * @returns True if payload might be eligible (requires full evaluation to confirm)
 */
export function mightBeEligible(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  // Check if payload contains any arrays (with circular reference protection)
  const hasArrays = (obj: any, visited = new WeakSet()): boolean => {
    if (Array.isArray(obj)) return true;
    if (typeof obj === 'object' && obj !== null) {
      // Detect circular references
      if (visited.has(obj)) return false;
      visited.add(obj);
      return Object.values(obj).some((value) => hasArrays(value, visited));
    }
    return false;
  };

  return hasArrays(payload);
}
