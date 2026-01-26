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
 * TOON (Token-Oriented Object Notation) Integration Types
 *
 * This module defines TypeScript interfaces for the TOON integration system.
 * TOON reduces token consumption by 30-60% for uniform array data while
 * improving LLM parsing accuracy.
 */

/**
 * Result of eligibility evaluation for TOON encoding
 */
export interface EligibilityResult {
  /** Whether the payload is eligible for TOON encoding */
  eligible: boolean;

  /** Eligibility score from 0.0 to 1.0 */
  score: number;

  /** Reason for ineligibility, if applicable */
  reason?: string;

  /** JSON paths of arrays eligible for TOON encoding */
  eligiblePaths?: string[];
}

/**
 * Options for eligibility evaluation
 */
export interface EligibilityOptions {
  /** Minimum array length to consider for TOON encoding (default: 5) */
  minArrayLength?: number;

  /** Minimum eligibility score threshold (default: 0.8) */
  minScore?: number;
}

/**
 * Options for TOON encoding
 */
export interface EncodeOptions {
  /** Delimiter for separating values (default: ',') */
  delimiter?: ',' | '\t' | '|';

  /** Indentation spaces for formatting (default: 2) */
  indent?: number;

  /** Whether to wrap output in fenced code block (default: true) */
  wrapInCodeBlock?: boolean;
}

/**
 * Result of TOON encoding operation
 */
export interface EncodeResult {
  /** The encoded output string (TOON or JSON) */
  output: string;

  /** Format used for encoding */
  format: 'toon' | 'json';

  /** Original payload size in bytes */
  originalBytes: number;

  /** Encoded payload size in bytes */
  encodedBytes: number;

  /** Estimated token savings (positive = savings, negative = overhead) */
  estimatedTokenSavings: number;

  /** Encoding latency in milliseconds */
  latencyMs?: number;

  /** Eligibility score that was calculated */
  eligibilityScore?: number;
}

/**
 * Options for message payload formatting
 */
export interface FormatOptions {
  /** Whether TOON optimization is enabled (default: true) */
  toonEnabled?: boolean;

  /** Eligibility evaluation options */
  eligibilityOptions?: EligibilityOptions;

  /** Encoding options */
  encodeOptions?: EncodeOptions;
}

/**
 * Metrics tracked for TOON encoding operations
 */
export interface ToonMetrics {
  /** Total number of encoding attempts */
  totalAttempts: number;

  /** Number of times TOON was selected */
  toonSelected: number;

  /** Number of times JSON was used */
  jsonSelected: number;

  /** Total original bytes processed */
  totalOriginalBytes: number;

  /** Total encoded bytes after optimization */
  totalEncodedBytes: number;

  /** Total estimated token savings */
  totalTokenSavings: number;

  /** Average eligibility score */
  averageEligibilityScore: number;

  /** Average encoding latency in milliseconds */
  averageLatencyMs: number;

  /** Number of encoding errors/fallbacks */
  errorCount: number;
}

/**
 * Internal structure representing a TOON-encodable array
 */
export interface ToonArray {
  /** JSON path to the array */
  path: string;

  /** Array elements */
  elements: Record<string, any>[];

  /** Field names in consistent order */
  fields: string[];

  /** Array length */
  length: number;
}

/**
 * Primitive types allowed in TOON format
 */
export type ToonPrimitive = string | number | boolean | null;

/**
 * Configuration for TOON optimization system
 */
export interface ToonConfig {
  /** Global enable/disable flag */
  enabled: boolean;

  /** Default eligibility options */
  defaultEligibilityOptions: EligibilityOptions;

  /** Default encoding options */
  defaultEncodeOptions: EncodeOptions;

  /** Maximum payload size to attempt encoding (bytes) */
  maxPayloadSize?: number;

  /** Enable metrics collection */
  collectMetrics?: boolean;
}
