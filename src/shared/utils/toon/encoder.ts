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
 * TOON Encoder
 *
 * This module provides TOON (Token-Oriented Object Notation) encoding functionality.
 * TOON is a format optimized for representing tabular data in LLM prompts with
 * 30-60% token reduction compared to JSON.
 *
 * Format example:
 * ```toon
 * users[3]{id,name,status}:
 *   1,Alice,active
 *   2,Bob,idle
 *   3,Carol,active
 * ```
 *
 * Since @toon-format/toon library is not available, this implements a
 * simple TOON encoder following the specification.
 */

import { EncodeOptions, EncodeResult } from './types';
import { evaluateEligibility, extractEligibleArrays } from './eligibility';
import { Logger } from '../Logger';

const logger = new Logger('debug', 'ToonEncoder', 'server');

/**
 * Default encoding options
 */
const DEFAULT_OPTIONS: Required<EncodeOptions> = {
  delimiter: ',',
  indent: 2,
  wrapInCodeBlock: true,
};

/**
 * Escape a value for TOON format
 *
 * Handles special characters and ensures proper encoding:
 * - Null values become empty string
 * - Strings with delimiters or newlines are quoted
 * - Quotes inside strings are escaped
 */
function escapeValue(value: any, delimiter: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  const strValue = String(value);

  // Check if value needs quoting (contains delimiter, quotes, or newlines)
  const needsQuoting =
    strValue.includes(delimiter) ||
    strValue.includes('"') ||
    strValue.includes('\n') ||
    strValue.includes('\r');

  if (needsQuoting) {
    // Escape quotes and wrap in quotes
    return `"${strValue.replace(/"/g, '""')}"`;
  }

  return strValue;
}

/**
 * Encode a single array in TOON format
 *
 * Format: arrayName[length]{field1,field2,...}:
 *   value1,value2,...
 *   value1,value2,...
 *
 * @param arrayName - Name/path of the array
 * @param elements - Array elements to encode
 * @param options - Encoding options
 * @returns TOON-formatted string
 */
function encodeArray(
  arrayName: string,
  elements: Record<string, any>[],
  options: Required<EncodeOptions>
): string {
  if (elements.length === 0) {
    return `${arrayName}[0]{}:`;
  }

  // Get field names from first element (already validated to be uniform)
  const fields = Object.keys(elements[0]).sort();

  // Build header: arrayName[length]{field1,field2,...}:
  const header = `${arrayName}[${elements.length}]{${fields.join(',')}}:`;

  // Build data rows
  const indentStr = ' '.repeat(options.indent);
  const rows = elements.map((element) => {
    const values = fields.map((field) => escapeValue(element[field], options.delimiter));
    return `${indentStr}${values.join(options.delimiter)}`;
  });

  return [header, ...rows].join('\n');
}

/**
 * Encode payload to TOON format
 *
 * This function attempts to encode eligible arrays in TOON format
 * and falls back to JSON for non-eligible portions.
 *
 * @param payload - The payload to encode
 * @param options - Encoding options
 * @returns Encoded result with metadata
 */
export function encodeToon(
  payload: unknown,
  options: EncodeOptions = {}
): EncodeResult {
  const opts: Required<EncodeOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const startTime = Date.now();

  try {
    // Evaluate eligibility
    const eligibility = evaluateEligibility(payload);

    // Calculate original size
    const originalJson = JSON.stringify(payload);
    const originalBytes = Buffer.byteLength(originalJson, 'utf8');

    // If not eligible, return JSON
    if (!eligibility.eligible) {
      const latencyMs = Date.now() - startTime;
      return {
        output: opts.wrapInCodeBlock
          ? `\`\`\`json\n${originalJson}\n\`\`\``
          : originalJson,
        format: 'json',
        originalBytes,
        encodedBytes: originalBytes,
        estimatedTokenSavings: 0,
        latencyMs,
        eligibilityScore: eligibility.score,
      };
    }

    // Extract eligible arrays
    const eligibleArrays = extractEligibleArrays(payload);

    // For simple case: payload is a single eligible array
    if (Array.isArray(payload) && eligibleArrays.length === 1) {
      const toonOutput = encodeArray('data', payload as Record<string, any>[], opts);
      const wrappedOutput = opts.wrapInCodeBlock
        ? `\`\`\`toon\n${toonOutput}\n\`\`\``
        : toonOutput;

      const encodedBytes = Buffer.byteLength(wrappedOutput, 'utf8');
      const tokenSavings = estimateTokenSavings(originalBytes, encodedBytes);
      const latencyMs = Date.now() - startTime;

      return {
        output: wrappedOutput,
        format: 'toon',
        originalBytes,
        encodedBytes,
        estimatedTokenSavings: tokenSavings,
        latencyMs,
        eligibilityScore: eligibility.score,
      };
    }

    // Complex case: mixed payload with multiple arrays
    // For now, encode the largest eligible array and keep rest as JSON
    // This can be enhanced in future to handle mixed formats better
    const largestArray = eligibleArrays.reduce((prev, current) =>
      current.length > prev.length ? current : prev
    );

    const toonOutput = encodeArray(
      largestArray.path,
      largestArray.elements,
      opts
    );

    const wrappedOutput = opts.wrapInCodeBlock
      ? `\`\`\`toon\n${toonOutput}\n\`\`\``
      : toonOutput;

    const encodedBytes = Buffer.byteLength(wrappedOutput, 'utf8');
    const tokenSavings = estimateTokenSavings(originalBytes, encodedBytes);
    const latencyMs = Date.now() - startTime;

    // Log if encoding took too long (>20ms threshold)
    if (latencyMs > 20) {
      logger.warn(`TOON encoding took ${latencyMs}ms (threshold: 20ms)`);
    }

    return {
      output: wrappedOutput,
      format: 'toon',
      originalBytes,
      encodedBytes,
      estimatedTokenSavings: tokenSavings,
      latencyMs,
      eligibilityScore: eligibility.score,
    };
  } catch (error) {
    logger.error('Error encoding to TOON, falling back to JSON', error);

    // Fallback to JSON on any error
    const fallbackJson = JSON.stringify(payload);
    const fallbackBytes = Buffer.byteLength(fallbackJson, 'utf8');
    const latencyMs = Date.now() - startTime;

    return {
      output: opts.wrapInCodeBlock
        ? `\`\`\`json\n${fallbackJson}\n\`\`\``
        : fallbackJson,
      format: 'json',
      originalBytes: fallbackBytes,
      encodedBytes: fallbackBytes,
      estimatedTokenSavings: 0,
      latencyMs,
      eligibilityScore: 0,
    };
  }
}

/**
 * Estimate token savings from encoding
 *
 * Uses a rough heuristic: 1 token ≈ 4 characters for English text
 * This is an approximation and actual tokenization may vary.
 *
 * @param originalBytes - Original payload size
 * @param encodedBytes - Encoded payload size
 * @returns Estimated token savings (positive = savings, negative = overhead)
 */
function estimateTokenSavings(originalBytes: number, encodedBytes: number): number {
  const CHARS_PER_TOKEN = 4;
  const originalTokens = Math.ceil(originalBytes / CHARS_PER_TOKEN);
  const encodedTokens = Math.ceil(encodedBytes / CHARS_PER_TOKEN);
  return originalTokens - encodedTokens;
}

/**
 * Encode payload for prompt injection
 *
 * This is the main entry point for encoding payloads that will be
 * injected into agent prompts. It automatically selects TOON or JSON
 * based on eligibility.
 *
 * @param payload - The payload to encode
 * @param options - Encoding options
 * @returns Encoded result ready for prompt injection
 */
export function encodeForPrompt(
  payload: unknown,
  options: EncodeOptions = {}
): EncodeResult {
  return encodeToon(payload, {
    ...options,
    wrapInCodeBlock: true, // Always use code blocks for prompts
  });
}

/**
 * Decode TOON format back to JSON
 *
 * This is a simple decoder for testing and validation purposes.
 * In production, LLMs parse TOON directly without explicit decoding.
 *
 * @param toonString - TOON-formatted string
 * @returns Parsed array of objects
 */
export function decodeToon(toonString: string): Record<string, any>[] {
  try {
    // Remove code block wrapping if present
    let content = toonString.trim();
    if (content.startsWith('```toon')) {
      content = content.replace(/^```toon\n/, '').replace(/\n```$/, '');
    }

    const lines = content.split('\n');
    if (lines.length === 0) return [];

    // Parse header: arrayName[length]{field1,field2,...}:
    const headerMatch = lines[0].match(/^(.+)\[(\d+)\]\{([^}]+)\}:$/);
    if (!headerMatch) {
      throw new Error('Invalid TOON header format');
    }

    const fields = headerMatch[3].split(',');
    const expectedLength = parseInt(headerMatch[2], 10);

    // Parse data rows
    const results: Record<string, any>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseRow(line);
      if (values.length !== fields.length) {
        throw new Error(`Row ${i} has ${values.length} values, expected ${fields.length}`);
      }

      const obj: Record<string, any> = {};
      for (let j = 0; j < fields.length; j++) {
        obj[fields[j]] = parseValue(values[j]);
      }
      results.push(obj);
    }

    if (results.length !== expectedLength) {
      logger.warn(
        `TOON declared ${expectedLength} elements but parsed ${results.length}`
      );
    }

    return results;
  } catch (error) {
    logger.error('Error decoding TOON format', error);
    throw error;
  }
}

/**
 * Parse a TOON row, handling quoted values and escapes
 */
function parseRow(row: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    const nextChar = row[i + 1];

    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // End of quoted value
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

/**
 * Parse a TOON value to its appropriate type
 */
function parseValue(value: string): any {
  if (value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  const num = Number(value);
  if (!isNaN(num) && value === String(num)) {
    return num;
  }

  return value;
}
