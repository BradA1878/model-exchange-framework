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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * How much text an embedding model accepts in one request, in tokens.
 *
 * This ceiling sits next to the search-index ingress limits
 * (MeilisearchIngressLimits) so the two can be compared: a conversation
 * message may be 64 KiB, while the OpenAI embedding models take at most 8192
 * tokens — roughly 32 KiB of English, less for JSON or code. Before this
 * module existed the ceiling lived only on the provider's side, and every
 * message between the two limits was refused with HTTP 400 on every attempt.
 * The server's embedding generator cuts its input to this limit before the
 * request is made; the whole message is still stored and keyword-searchable.
 */

/** Overrides the per-model limit for every model. Use it for a provider this module does not know. */
export const EMBEDDING_INPUT_TOKEN_LIMIT_ENV = 'MEILISEARCH_EMBEDDING_MAX_INPUT_TOKENS';

/** Ceiling for a model this module does not know. Every OpenAI embedding model takes 8192. */
export const DEFAULT_EMBEDDING_INPUT_TOKEN_LIMIT = 8192;

/**
 * Input ceilings by model, as the providers publish them. Keyed by the bare
 * model name; a provider prefix such as `openai/` is stripped before lookup.
 */
const EMBEDDING_INPUT_TOKEN_LIMITS: Record<string, number> = {
    'text-embedding-3-small': 8192,
    'text-embedding-3-large': 8192,
    'text-embedding-ada-002': 8191
};

/**
 * The input token limit for an embedding model: the environment override when
 * set, else the published limit for the model, else the default. A set but
 * invalid override fails fast rather than falling back to a limit that may be
 * wrong for the provider.
 */
export function getEmbeddingInputTokenLimit(
    model: string,
    environment: NodeJS.ProcessEnv = process.env
): number {
    const configured = environment[EMBEDDING_INPUT_TOKEN_LIMIT_ENV]?.trim();
    if (configured !== undefined && configured !== '') {
        const value = Number(configured);
        if (!/^\d+$/.test(configured) || !Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`${EMBEDDING_INPUT_TOKEN_LIMIT_ENV} must be a positive integer number of tokens`);
        }
        return value;
    }

    const bareModel = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
    return EMBEDDING_INPUT_TOKEN_LIMITS[bareModel] ?? DEFAULT_EMBEDDING_INPUT_TOKEN_LIMIT;
}
