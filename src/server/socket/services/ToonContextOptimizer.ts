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
 * TOON Context Optimizer
 *
 * This service optimizes context data for SystemLlmService using TOON encoding.
 * It applies TOON optimization to eligible context sections before they are
 * injected into LLM prompts, reducing token consumption while preserving clarity.
 *
 * Integration points:
 * - SystemLlmService context assembly (ORPAR cycles)
 * - Memory retrieval formatting (search results)
 * - Agent pool status arrays
 * - Task queue batches
 *
 * Performance requirements:
 * - < 25ms total latency per context optimization
 * - Silent fallback to JSON on errors
 * - Metrics collection for analytics
 */

import {
  formatMessagePayload,
  formatBatch,
  mightBeEligible,
  recordEncoding,
  recordError,
  FormatOptions
} from '../../../shared/utils/toon';
import { Logger } from '../../../shared/utils/Logger';

const logger = new Logger('debug', 'ToonContextOptimizer', 'server');

/**
 * Context section with label and data
 */
export interface ContextSection {
  /** Label for the context section */
  label: string;

  /** Data to be formatted */
  data: unknown;

  /** Force TOON or JSON format (optional) */
  forceFormat?: 'toon' | 'json';
}

/**
 * TOON Context Optimizer Service
 *
 * Singleton service for optimizing context data across the MXF framework.
 * Primarily used by SystemLlmService to reduce token consumption in ORPAR cycles.
 */
export class ToonContextOptimizer {
  private static instance: ToonContextOptimizer | null = null;
  private enabled: boolean;
  private formatOptions: FormatOptions;

  private constructor() {
    this.enabled = process.env.TOON_OPTIMIZATION_ENABLED !== 'false';
    this.formatOptions = {
      toonEnabled: this.enabled,
      eligibilityOptions: {
        minArrayLength: parseInt(process.env.TOON_MIN_ARRAY_LENGTH || '5', 10),
        minScore: parseFloat(process.env.TOON_MIN_SCORE || '0.8'),
      },
      encodeOptions: {
        delimiter: (process.env.TOON_DELIMITER as ',' | '\t' | '|') || ',',
        indent: 2,
        wrapInCodeBlock: true,
      },
    };

    logger.info('ToonContextOptimizer initialized', {
      enabled: this.enabled,
      minArrayLength: this.formatOptions.eligibilityOptions?.minArrayLength,
      minScore: this.formatOptions.eligibilityOptions?.minScore,
    });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ToonContextOptimizer {
    if (!ToonContextOptimizer.instance) {
      ToonContextOptimizer.instance = new ToonContextOptimizer();
    }
    return ToonContextOptimizer.instance;
  }

  /**
   * Optimize a single context section
   *
   * This method formats a single data payload for prompt injection.
   * It's used for individual context sections like agent status or task queues.
   *
   * @param data - The data to optimize
   * @param label - Optional label for the context section
   * @returns Formatted string (TOON or JSON)
   */
  public optimizeContext(data: unknown, label?: string): string {
    const startTime = performance.now();

    try {
      if (!this.enabled) {
        return this.formatAsJson(data);
      }

      // Quick pre-check
      if (!mightBeEligible(data)) {
        return this.formatAsJson(data);
      }

      // Format with TOON optimization
      const formatted = formatMessagePayload(data, this.formatOptions);

      const latency = performance.now() - startTime;
      if (latency > 25) {
        logger.warn('Context optimization exceeded 25ms threshold', {
          latency: latency.toFixed(2),
          label,
        });
      }

      logger.debug('Context optimized', {
        latency: latency.toFixed(2),
        label,
        format: formatted.includes('```toon') ? 'toon' : 'json',
      });

      return formatted;
    } catch (error) {
      logger.error('Error optimizing context, falling back to JSON', {
        error,
        label,
      });
      recordError();
      return this.formatAsJson(data);
    }
  }

  /**
   * Optimize multiple context sections as a batch
   *
   * This method formats multiple labeled context sections and combines them.
   * Useful for ORPAR cycles with multiple context types (agents, tasks, memory).
   *
   * @param sections - Array of context sections with labels
   * @returns Combined formatted string
   */
  public optimizeBatch(sections: ContextSection[]): string {
    const startTime = performance.now();

    try {
      if (!this.enabled) {
        return this.formatBatchAsJson(sections);
      }

      // Process each section
      const formatted = sections.map(({ label, data, forceFormat }) => {
        if (forceFormat === 'json') {
          return `## ${label}\n\n${this.formatAsJson(data)}`;
        }

        if (forceFormat === 'toon' || mightBeEligible(data)) {
          const optimized = formatMessagePayload(data, this.formatOptions);
          return `## ${label}\n\n${optimized}`;
        }

        return `## ${label}\n\n${this.formatAsJson(data)}`;
      });

      const latency = performance.now() - startTime;
      if (latency > 25) {
        logger.warn('Batch optimization exceeded 25ms threshold', {
          latency: latency.toFixed(2),
          sectionCount: sections.length,
        });
      }

      logger.debug('Batch optimized', {
        latency: latency.toFixed(2),
        sectionCount: sections.length,
      });

      return formatted.join('\n\n');
    } catch (error) {
      logger.error('Error optimizing batch, falling back to JSON', {
        error,
        sectionCount: sections.length,
      });
      recordError();
      return this.formatBatchAsJson(sections);
    }
  }

  /**
   * Optimize agent pool status array
   *
   * Convenience method for formatting agent pool status for ORPAR observation phase.
   *
   * @param agents - Array of agent status objects
   * @returns Formatted string
   */
  public optimizeAgentPool(agents: unknown[]): string {
    return this.optimizeContext(agents, 'Agent Pool Status');
  }

  /**
   * Optimize task queue
   *
   * Convenience method for formatting task queue for ORPAR planning phase.
   *
   * @param tasks - Array of task objects
   * @returns Formatted string
   */
  public optimizeTaskQueue(tasks: unknown[]): string {
    return this.optimizeContext(tasks, 'Task Queue');
  }

  /**
   * Optimize memory search results
   *
   * Convenience method for formatting memory search results.
   *
   * @param results - Array of search result objects
   * @param searchType - Type of search (conversations, actions, patterns)
   * @returns Formatted string
   */
  public optimizeMemoryResults(results: unknown[], searchType: string): string {
    return this.optimizeContext(results, `Memory Search: ${searchType}`);
  }

  /**
   * Optimize observation data for ORPAR
   *
   * Formats observation data for the ORPAR observation phase.
   *
   * @param observations - Array of observation objects
   * @returns Formatted string
   */
  public optimizeObservations(observations: unknown[]): string {
    return this.optimizeContext(observations, 'Observations');
  }

  /**
   * Format data as JSON (fallback)
   *
   * @param data - The data to format
   * @returns JSON string in code block
   */
  private formatAsJson(data: unknown): string {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      return `\`\`\`json\n${jsonString}\n\`\`\``;
    } catch (error) {
      logger.error('Error formatting JSON', { error });
      return '```json\n{"error": "Failed to serialize data"}\n```';
    }
  }

  /**
   * Format batch as JSON (fallback)
   *
   * @param sections - Context sections to format
   * @returns Combined JSON string
   */
  private formatBatchAsJson(sections: ContextSection[]): string {
    return sections
      .map(({ label, data }) => `## ${label}\n\n${this.formatAsJson(data)}`)
      .join('\n\n');
  }

  /**
   * Check if TOON optimization is enabled
   *
   * @returns True if enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable TOON optimization
   *
   * @param enabled - Whether to enable TOON optimization
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.formatOptions.toonEnabled = enabled;
    logger.info('ToonContextOptimizer enabled state changed', { enabled });
  }

  /**
   * Update format options
   *
   * @param options - Partial format options to merge
   */
  public updateFormatOptions(options: Partial<FormatOptions>): void {
    this.formatOptions = {
      ...this.formatOptions,
      ...options,
      eligibilityOptions: {
        ...this.formatOptions.eligibilityOptions,
        ...options.eligibilityOptions,
      },
      encodeOptions: {
        ...this.formatOptions.encodeOptions,
        ...options.encodeOptions,
      },
    };
    logger.info('ToonContextOptimizer format options updated', this.formatOptions);
  }
}

/**
 * Get the singleton TOON context optimizer instance
 *
 * @returns ToonContextOptimizer instance
 */
export function getToonContextOptimizer(): ToonContextOptimizer {
  return ToonContextOptimizer.getInstance();
}

/**
 * Optimize context data (convenience function)
 *
 * @param data - The data to optimize
 * @param label - Optional label
 * @returns Formatted string
 */
export function optimizeContext(data: unknown, label?: string): string {
  return getToonContextOptimizer().optimizeContext(data, label);
}

/**
 * Optimize batch of context sections (convenience function)
 *
 * @param sections - Array of context sections
 * @returns Combined formatted string
 */
export function optimizeBatch(sections: ContextSection[]): string {
  return getToonContextOptimizer().optimizeBatch(sections);
}
