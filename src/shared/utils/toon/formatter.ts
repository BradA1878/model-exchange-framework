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
 * TOON Message Formatter
 *
 * This module provides high-level formatting functions for converting
 * message payloads to TOON or JSON format for prompt injection.
 *
 * It handles:
 * - Automatic eligibility evaluation
 * - Format selection (TOON vs JSON)
 * - Fenced code block wrapping
 * - Silent fallback on errors
 */

import { FormatOptions } from './types';
import { encodeForPrompt } from './encoder';
import { mightBeEligible, evaluateEligibility } from './eligibility';
import { Logger } from '../Logger';

const logger = new Logger('debug', 'ToonFormatter', 'server');

/**
 * Default format options
 */
const DEFAULT_FORMAT_OPTIONS: Required<FormatOptions> = {
  toonEnabled: true,
  eligibilityOptions: {
    minArrayLength: 5,
    minScore: 0.8,
  },
  encodeOptions: {
    delimiter: ',',
    indent: 2,
    wrapInCodeBlock: true,
  },
};

/**
 * Format a message payload for prompt injection
 *
 * This is the main entry point for formatting payloads. It automatically:
 * 1. Checks if TOON optimization is enabled
 * 2. Evaluates payload eligibility
 * 3. Encodes to TOON or JSON as appropriate
 * 4. Returns formatted string ready for prompt injection
 *
 * @param payload - The payload to format
 * @param options - Format options
 * @returns Formatted string (TOON or JSON in code block)
 */
export function formatMessagePayload(
  payload: unknown,
  options: FormatOptions = {}
): string {
  const opts: Required<FormatOptions> = {
    ...DEFAULT_FORMAT_OPTIONS,
    ...options,
    eligibilityOptions: {
      ...DEFAULT_FORMAT_OPTIONS.eligibilityOptions,
      ...options.eligibilityOptions,
    },
    encodeOptions: {
      ...DEFAULT_FORMAT_OPTIONS.encodeOptions,
      ...options.encodeOptions,
    },
  };

  try {
    // If TOON is disabled, use JSON
    if (!opts.toonEnabled) {
      return formatAsJson(payload);
    }

    // Quick pre-check: does payload look eligible?
    if (!mightBeEligible(payload)) {
      return formatAsJson(payload);
    }

    // Full eligibility check with minArrayLength and minScore thresholds
    const eligibility = evaluateEligibility(payload, opts.eligibilityOptions);
    if (!eligibility.eligible) {
      return formatAsJson(payload);
    }

    // Perform full encoding
    const result = encodeForPrompt(payload, opts.encodeOptions);

    return result.output;
  } catch (error) {
    logger.error('Error formatting payload, falling back to JSON', error);
    return formatAsJson(payload);
  }
}

/**
 * Format payload as JSON with code block
 *
 * @param payload - The payload to format
 * @param compact - Whether to use compact (single-line) JSON
 * @returns JSON string in code block
 */
export function formatAsJson(payload: unknown, compact: boolean = false): string {
  try {
    const jsonString = compact
      ? JSON.stringify(payload)
      : JSON.stringify(payload, null, 2);

    return `\`\`\`json\n${jsonString}\n\`\`\``;
  } catch (error) {
    logger.error('Error formatting JSON', error);
    return '```json\n{"error": "Failed to serialize payload"}\n```';
  }
}

/**
 * Format payload as TOON (force TOON encoding)
 *
 * This function forces TOON encoding without eligibility check.
 * Use with caution - will fall back to JSON on error.
 *
 * @param payload - The payload to format
 * @param options - Encode options
 * @returns TOON string in code block, or JSON on failure
 */
export function formatAsToon(
  payload: unknown,
  options: FormatOptions['encodeOptions'] = {}
): string {
  try {
    const result = encodeForPrompt(payload, {
      delimiter: ',',
      indent: 2,
      wrapInCodeBlock: true,
      ...options,
    });

    // Return the output regardless of format
    // (encoder will fall back to JSON if not eligible)
    return result.output;
  } catch (error) {
    logger.error('Error formatting as TOON, falling back to JSON', error);
    return formatAsJson(payload);
  }
}

/**
 * Format payload with automatic format detection
 *
 * This is an alias for formatMessagePayload with sensible defaults.
 *
 * @param payload - The payload to format
 * @returns Formatted string (TOON or JSON)
 */
export function formatPayload(payload: unknown): string {
  return formatMessagePayload(payload);
}

/**
 * Format multiple payloads as a batch
 *
 * This function formats multiple payloads and combines them with labels.
 * Useful for batch operations or multi-payload messages.
 *
 * @param payloads - Array of labeled payloads
 * @param options - Format options
 * @returns Combined formatted string
 */
export function formatBatch(
  payloads: Array<{ label: string; data: unknown }>,
  options: FormatOptions = {}
): string {
  const formatted = payloads.map(({ label, data }) => {
    const formattedData = formatMessagePayload(data, options);
    return `## ${label}\n\n${formattedData}`;
  });

  return formatted.join('\n\n');
}

/**
 * Strip code block wrapping from formatted output
 *
 * This is useful when you need the raw TOON/JSON content without
 * the markdown code block syntax.
 *
 * @param formatted - Formatted string with code blocks
 * @returns Content without code blocks
 */
export function stripCodeBlocks(formatted: string): string {
  return formatted
    .replace(/^```(?:toon|json)\n/, '')
    .replace(/\n```$/, '')
    .trim();
}

/**
 * Detect format of a formatted string
 *
 * @param formatted - Formatted string
 * @returns Format type ('toon', 'json', or 'unknown')
 */
export function detectFormat(formatted: string): 'toon' | 'json' | 'unknown' {
  if (formatted.includes('```toon')) {
    return 'toon';
  }
  if (formatted.includes('```json')) {
    return 'json';
  }
  return 'unknown';
}

/**
 * Format with metadata header
 *
 * Adds a metadata header to the formatted output for context.
 * Useful for debugging and tracking format selection.
 *
 * @param payload - The payload to format
 * @param metadata - Metadata to include
 * @param options - Format options
 * @returns Formatted string with metadata header
 */
export function formatWithMetadata(
  payload: unknown,
  metadata: Record<string, any>,
  options: FormatOptions = {}
): string {
  const formatted = formatMessagePayload(payload, options);
  const format = detectFormat(formatted);

  const metadataLines = [
    '<!-- Payload Metadata',
    `Format: ${format}`,
    ...Object.entries(metadata).map(([key, value]) => `${key}: ${value}`),
    '-->',
  ];

  return `${metadataLines.join('\n')}\n\n${formatted}`;
}
