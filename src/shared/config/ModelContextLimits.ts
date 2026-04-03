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
 * Model Context Limits
 *
 * Maps model IDs to their context window sizes (in tokens).
 * Used by percentage-based compaction to know when to trigger.
 * Generous fallback (128k) for unknown models with a logged warning.
 */

import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'ModelContextLimits', 'server');

/** Default context limit for unknown models */
const DEFAULT_CONTEXT_LIMIT = 128_000;

/**
 * Known model context window sizes (tokens).
 * Keyed by model ID prefix — lookup tries exact match first,
 * then walks prefixes so "claude-3.5-sonnet-20241022" matches "claude-3.5-sonnet".
 */
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
    // Claude models
    'claude-opus-4': 200_000,
    'claude-sonnet-4': 200_000,
    'claude-3.5-sonnet': 200_000,
    'claude-3.5-haiku': 200_000,
    'claude-3-opus': 200_000,
    'claude-3-sonnet': 200_000,
    'claude-3-haiku': 200_000,

    // OpenAI models
    'gpt-4o': 128_000,
    'gpt-4o-mini': 128_000,
    'gpt-4-turbo': 128_000,
    'gpt-4-1106': 128_000,
    'gpt-4': 8_192,
    'gpt-3.5-turbo': 16_385,
    'o1': 200_000,
    'o1-mini': 128_000,
    'o1-preview': 128_000,
    'o3': 200_000,
    'o3-mini': 200_000,
    'o4-mini': 200_000,

    // Google models
    'gemini-2.5-pro': 1_000_000,
    'gemini-2.5-flash': 1_000_000,
    'gemini-2.0-flash': 1_000_000,
    'gemini-1.5-pro': 2_000_000,
    'gemini-1.5-flash': 1_000_000,

    // Meta / Llama models
    'meta-llama/llama-3.3-70b': 131_072,
    'meta-llama/llama-3.1-405b': 131_072,
    'meta-llama/llama-3.1-70b': 131_072,
    'meta-llama/llama-3.1-8b': 131_072,

    // Mistral models
    'mistral-large': 128_000,
    'mistral-medium': 32_000,
    'mistral-small': 32_000,

    // DeepSeek models
    'deepseek-chat': 128_000,
    'deepseek-coder': 128_000,
    'deepseek-r1': 128_000,

    // Qwen models
    'qwen-2.5-72b': 131_072,
    'qwen-2.5-coder-32b': 131_072,
};

/**
 * Get the context window size (tokens) for a model.
 * Tries exact match first, then prefix match, then falls back to DEFAULT_CONTEXT_LIMIT.
 */
export function getContextLimit(modelId: string): number {
    // Exact match
    if (MODEL_CONTEXT_LIMITS[modelId] !== undefined) {
        return MODEL_CONTEXT_LIMITS[modelId];
    }

    // Prefix match — find the longest matching prefix
    let bestMatch = '';
    for (const key of Object.keys(MODEL_CONTEXT_LIMITS)) {
        if (modelId.startsWith(key) && key.length > bestMatch.length) {
            bestMatch = key;
        }
    }
    if (bestMatch) {
        return MODEL_CONTEXT_LIMITS[bestMatch];
    }

    // OpenRouter format: "provider/model-name" — try without provider prefix
    if (modelId.includes('/')) {
        const modelPart = modelId.split('/').pop()!;
        const result = getContextLimit(modelPart);
        if (result !== DEFAULT_CONTEXT_LIMIT) {
            return result;
        }
    }

    logger.warn('Unknown model, using default context limit', {
        modelId,
        defaultLimit: DEFAULT_CONTEXT_LIMIT,
    });
    return DEFAULT_CONTEXT_LIMIT;
}

/**
 * Get the token count at which compaction should trigger for a model.
 * @param modelId - The model identifier
 * @param percent - Usage threshold (0.0–1.0), e.g. 0.80 for 80%
 */
export function getCompactionThreshold(modelId: string, percent: number): number {
    const limit = getContextLimit(modelId);
    return Math.floor(limit * percent);
}

/**
 * Register a custom model context limit at runtime.
 * Useful for models launched after deployment.
 */
export function registerModelContextLimit(modelId: string, contextTokens: number): void {
    MODEL_CONTEXT_LIMITS[modelId] = contextTokens;
    logger.info('Custom model context limit registered', { modelId, contextTokens });
}

/**
 * Get all registered model IDs and their limits (for diagnostics).
 */
export function listModelContextLimits(): Record<string, number> {
    return { ...MODEL_CONTEXT_LIMITS };
}
