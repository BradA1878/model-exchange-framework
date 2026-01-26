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
 * TOON (Token-Oriented Object Notation) Integration for MXF
 *
 * This module provides automatic prompt optimization through TOON encoding,
 * reducing token consumption by 30-60% for uniform array data while
 * improving LLM parsing accuracy.
 *
 * Usage:
 * ```typescript
 * import { formatMessagePayload } from '@/shared/utils/toon';
 *
 * const payload = [
 *   { id: 1, name: 'Alice', status: 'active' },
 *   { id: 2, name: 'Bob', status: 'idle' },
 *   { id: 3, name: 'Carol', status: 'active' }
 * ];
 *
 * const formatted = formatMessagePayload(payload);
 * // Returns TOON-formatted string ready for prompt injection
 * ```
 *
 * @module toon
 */

// Export all types
export * from './types';

// Export eligibility functions
export {
  evaluateEligibility,
  extractEligibleArrays,
  mightBeEligible,
} from './eligibility';

// Export encoder functions
export {
  encodeToon,
  encodeForPrompt,
  decodeToon,
} from './encoder';

// Export formatter functions
export {
  formatMessagePayload,
  formatAsJson,
  formatAsToon,
  formatPayload,
  formatBatch,
  stripCodeBlocks,
  detectFormat,
  formatWithMetadata,
} from './formatter';

// Export metrics functions
export {
  recordEncoding,
  recordError,
  getMetrics,
  getDetailedMetrics,
  resetMetrics,
  exportMetricsJson,
  getMetricsSummary,
  logMetricsSummary,
  createContextCollector,
} from './metrics';

// Re-export main functions as default for convenience
export { formatMessagePayload as default } from './formatter';
