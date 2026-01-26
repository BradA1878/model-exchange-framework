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
 * Token Estimator - Fast token counting without LLM calls
 *
 * PHASE 3: Token budget allocation utility
 * Provides accurate token estimation for budget planning
 */

import { Logger } from './Logger';

const logger = new Logger('debug', 'TokenEstimator', 'server');

/**
 * Token estimation cache to avoid repeated calculations
 */
const tokenEstimateCache = new Map<string, number>();
const MAX_CACHE_SIZE = 1000;

/**
 * Estimate token count for text content
 *
 * Uses character-based heuristics as fallback when tiktoken is unavailable.
 * Rule of thumb: ~4 characters per token for English text.
 *
 * @param content Text content to estimate
 * @param model Model name (for future tiktoken integration)
 * @returns Estimated token count
 */
export function estimateTokens(content: string, model: string = 'gpt-4'): number {
    if (!content || content.length === 0) {
        return 0;
    }

    // Check cache first
    const cacheKey = `${model}:${content.substring(0, 100)}`;
    if (tokenEstimateCache.has(cacheKey)) {
        return tokenEstimateCache.get(cacheKey)!;
    }

    // Character-based estimation (conservative estimate)
    // ~4 characters per token is typical for English
    // Adjust for special characters and whitespace
    const baseEstimate = Math.ceil(content.length / 4);

    // Adjust for whitespace (doesn't count as heavily)
    const whitespaceCount = (content.match(/\s/g) || []).length;
    const whitespaceAdjustment = Math.floor(whitespaceCount * 0.5);

    // Adjust for code/technical content (tends to use more tokens)
    const codeMarkers = (content.match(/[{}();=><\[\]]/g) || []).length;
    const codeAdjustment = Math.floor(codeMarkers * 0.2);

    const estimate = baseEstimate - whitespaceAdjustment + codeAdjustment;

    // Cache the result
    tokenEstimateCache.set(cacheKey, estimate);

    // Implement LRU eviction
    if (tokenEstimateCache.size > MAX_CACHE_SIZE) {
        const firstKey = tokenEstimateCache.keys().next().value;
        if (firstKey) {
            tokenEstimateCache.delete(firstKey);
        }
    }

    return Math.max(1, estimate); // Minimum 1 token
}

/**
 * Estimate tokens for an array of content items
 */
export function estimateTokensForArray(items: string[], model: string = 'gpt-4'): number {
    return items.reduce((total, item) => total + estimateTokens(item, model), 0);
}

/**
 * Estimate tokens for structured message objects
 */
export function estimateTokensForMessages(messages: any[], model: string = 'gpt-4'): number {
    let total = 0;

    for (const message of messages) {
        // Base overhead per message (role, metadata, etc.)
        total += 4;

        // Content
        if (typeof message.content === 'string') {
            total += estimateTokens(message.content, model);
        } else if (message.content) {
            total += estimateTokens(JSON.stringify(message.content), model);
        }

        // Tool calls (if present)
        if (message.tool_calls || message.toolCalls) {
            const toolCalls = message.tool_calls || message.toolCalls;
            total += estimateTokens(JSON.stringify(toolCalls), model);
        }

        // Metadata (lighter weight)
        if (message.metadata) {
            total += Math.ceil(JSON.stringify(message.metadata).length / 6);
        }
    }

    return total;
}

/**
 * Clear the token estimate cache (useful for testing)
 */
export function clearTokenEstimateCache(): void {
    tokenEstimateCache.clear();
}
