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
 * TOON Message Middleware
 *
 * This middleware intercepts message payloads before they are injected into agent prompts
 * and applies TOON (Token-Oriented Object Notation) encoding when beneficial.
 *
 * Integration point: Message delivery pipeline in Socket.IO handler, before prompt assembly.
 *
 * Performance requirements:
 * - Eligibility check: < 5ms for payloads under 100KB
 * - Total added latency: < 25ms per message
 * - Silent fallback to JSON on any error
 *
 * Configuration:
 * - TOON_OPTIMIZATION_ENABLED: Global enable/disable (default: true)
 * - Channel-level override via channel.settings.toonOptimization
 */

import { formatMessagePayload, mightBeEligible, recordEncoding, recordError } from '../../../shared/utils/toon';
import { Logger } from '../../../shared/utils/Logger';
import { ChannelId } from '../../../shared/types/ChannelContext';

const logger = new Logger('debug', 'ToonMessageMiddleware', 'server');

/**
 * TOON optimization configuration
 */
export interface ToonMiddlewareConfig {
  /** Global enable/disable flag (default: from env TOON_OPTIMIZATION_ENABLED) */
  enabled: boolean;

  /** Minimum array length to consider for TOON encoding (default: 5) */
  minArrayLength: number;

  /** Minimum eligibility score threshold (default: 0.8) */
  minScore: number;

  /** Delimiter for TOON encoding (default: ',') */
  delimiter: ',' | '\t' | '|';
}

/**
 * Channel-level TOON optimization setting
 */
export type ToonOptimizationMode = 'auto' | 'always' | 'never';

/**
 * Default configuration from environment variables
 */
const DEFAULT_CONFIG: ToonMiddlewareConfig = {
  enabled: process.env.TOON_OPTIMIZATION_ENABLED !== 'false',
  minArrayLength: parseInt(process.env.TOON_MIN_ARRAY_LENGTH || '5', 10),
  minScore: parseFloat(process.env.TOON_MIN_SCORE || '0.8'),
  delimiter: (process.env.TOON_DELIMITER as ',' | '\t' | '|') || ',',
};

/**
 * TOON Message Middleware class
 *
 * This middleware is applied to message payloads before they are injected into agent prompts.
 * It automatically detects eligible payloads and encodes them in TOON format for token savings.
 */
export class ToonMessageMiddleware {
  private config: ToonMiddlewareConfig;

  constructor(config: Partial<ToonMiddlewareConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('ToonMessageMiddleware initialized', {
      enabled: this.config.enabled,
      minArrayLength: this.config.minArrayLength,
      minScore: this.config.minScore,
      delimiter: this.config.delimiter,
    });
  }

  /**
   * Process a message payload before prompt injection
   *
   * This is the main entry point for the middleware. It:
   * 1. Checks if TOON optimization is enabled globally and per-channel
   * 2. Performs quick pre-check for eligibility
   * 3. Encodes eligible payloads in TOON format
   * 4. Falls back to JSON on any error
   * 5. Records metrics for analytics
   *
   * @param payload - The raw payload to process
   * @param channelId - Channel ID for per-channel settings
   * @param channelToonMode - Channel-specific TOON mode override
   * @returns Formatted string ready for prompt injection (TOON or JSON)
   */
  public processPayload(
    payload: unknown,
    channelId?: ChannelId,
    channelToonMode?: ToonOptimizationMode
  ): string {
    const startTime = performance.now();

    try {
      // Check if TOON is enabled globally
      if (!this.config.enabled) {
        logger.debug('TOON optimization disabled globally', { channelId });
        return this.formatAsJson(payload);
      }

      // Check channel-level override
      if (channelToonMode === 'never') {
        logger.debug('TOON optimization disabled for channel', { channelId });
        return this.formatAsJson(payload);
      }

      // Quick pre-check: might this be eligible?
      const startPreCheck = performance.now();
      const mightBeEligibleResult = mightBeEligible(payload);
      const preCheckLatency = performance.now() - startPreCheck;

      if (preCheckLatency > 5) {
        logger.warn('Pre-check exceeded 5ms threshold', {
          latency: preCheckLatency.toFixed(2),
          channelId,
        });
      }

      if (!mightBeEligibleResult && channelToonMode !== 'always') {
        logger.debug('Payload not eligible for TOON (pre-check)', { channelId });
        return this.formatAsJson(payload);
      }

      // Perform full encoding with eligibility check
      const formatted = formatMessagePayload(payload, {
        toonEnabled: true,
        eligibilityOptions: {
          minArrayLength: this.config.minArrayLength,
          minScore: this.config.minScore,
        },
        encodeOptions: {
          delimiter: this.config.delimiter,
          indent: 2,
          wrapInCodeBlock: true,
        },
      });

      const totalLatency = performance.now() - startTime;

      // Warn if total latency exceeds threshold
      if (totalLatency > 25) {
        logger.warn('TOON processing exceeded 25ms threshold', {
          latency: totalLatency.toFixed(2),
          channelId,
        });
      }

      logger.debug('TOON processing completed', {
        latency: totalLatency.toFixed(2),
        channelId,
        eligible: formatted.includes('```toon'),
      });

      return formatted;
    } catch (error) {
      // Silent fallback to JSON on any error
      logger.error('Error in TOON middleware, falling back to JSON', {
        error,
        channelId,
      });
      recordError();
      return this.formatAsJson(payload);
    }
  }

  /**
   * Format payload as JSON (fallback)
   *
   * @param payload - The payload to format
   * @returns JSON string in code block
   */
  private formatAsJson(payload: unknown): string {
    try {
      const jsonString = JSON.stringify(payload, null, 2);
      return `\`\`\`json\n${jsonString}\n\`\`\``;
    } catch (error) {
      logger.error('Error formatting JSON', { error });
      return '```json\n{"error": "Failed to serialize payload"}\n```';
    }
  }

  /**
   * Update middleware configuration
   *
   * @param config - Partial configuration to merge
   */
  public updateConfig(config: Partial<ToonMiddlewareConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('ToonMessageMiddleware configuration updated', this.config);
  }

  /**
   * Get current configuration
   *
   * @returns Current configuration
   */
  public getConfig(): ToonMiddlewareConfig {
    return { ...this.config };
  }
}

/**
 * Singleton instance for global use
 */
let middlewareInstance: ToonMessageMiddleware | null = null;

/**
 * Get the singleton TOON middleware instance
 *
 * @returns ToonMessageMiddleware instance
 */
export function getToonMiddleware(): ToonMessageMiddleware {
  if (!middlewareInstance) {
    middlewareInstance = new ToonMessageMiddleware();
  }
  return middlewareInstance;
}

/**
 * Initialize TOON middleware with custom configuration
 *
 * @param config - Configuration options
 * @returns ToonMessageMiddleware instance
 */
export function initializeToonMiddleware(config: Partial<ToonMiddlewareConfig> = {}): ToonMessageMiddleware {
  middlewareInstance = new ToonMessageMiddleware(config);
  return middlewareInstance;
}

/**
 * Process a message payload through TOON middleware (convenience function)
 *
 * @param payload - The payload to process
 * @param channelId - Optional channel ID
 * @param channelToonMode - Optional channel-specific mode
 * @returns Formatted string ready for prompt injection
 */
export function processToonPayload(
  payload: unknown,
  channelId?: ChannelId,
  channelToonMode?: ToonOptimizationMode
): string {
  return getToonMiddleware().processPayload(payload, channelId, channelToonMode);
}
