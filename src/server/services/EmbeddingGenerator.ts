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
 * The embedding generator the server installs on MxfMeilisearchService.
 *
 * Picks the provider from the environment (OpenRouter, OpenAI direct, or
 * Voyage) and cuts every input to the model's token limit before the request
 * is made. The limit is known and static, so overrunning it is a bug here,
 * not a provider error for the caller to deal with: a message that passes
 * the 64 KiB ingress check but exceeds 8192 tokens used to fail on every
 * attempt. The whole message is still stored and keyword-searchable; only
 * the vector is built from the prefix.
 */

import OpenAI from 'openai';
import { Logger } from '@mxf-dev/core/utils/Logger';
import type { EmbeddingGenerator } from '@mxf-dev/core/services/MxfMeilisearchService';
import { getEmbeddingInputTokenLimit } from '@mxf-dev/core/config/EmbeddingInputLimits';
import { assertExternalLlmCallAllowed } from '@mxf-dev/core/protocols/mcp/LlmTestEnvironmentGuard';
import { truncateToTokenLimit } from './EmbeddingInput';

const logger = new Logger('info', 'EmbeddingGenerator', 'server');

const DEFAULT_MODEL = 'text-embedding-3-small';

/** The part of the OpenAI client this generator uses; a fake is injected in tests. */
export interface EmbeddingsClient {
    embeddings: {
        create(request: { model: string; input: string; dimensions?: number }): Promise<{
            data?: Array<{ embedding?: number[] }>;
        }>;
    };
}

export interface EmbeddingsClientOptions {
    apiKey: string;
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
}

export interface EmbeddingGeneratorDependencies {
    createClient?: (options: EmbeddingsClientOptions) => EmbeddingsClient;
    fetch?: typeof fetch;
}

/**
 * Build the generator. Reads the provider, model, keys, and the token-limit
 * override from `environment`; an invalid override fails here, at boot,
 * rather than on the first document.
 */
/** The key a provider needs, or the reason it cannot be used — checked before any work on the input. */
const requireProviderKey = (providerStr: string, environment: NodeJS.ProcessEnv): string => {
    if (providerStr === 'openrouter') {
        if (!environment.OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY not set');
        }
        return environment.OPENROUTER_API_KEY;
    }
    if (providerStr === 'openai') {
        if (!environment.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY not set');
        }
        return environment.OPENAI_API_KEY;
    }
    if (providerStr === 'anthropic' || providerStr === 'voyage') {
        if (!environment.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY not set for Voyage embeddings');
        }
        return environment.ANTHROPIC_API_KEY;
    }
    throw new Error(`Unsupported embedding provider: ${providerStr}`);
};

export function createEmbeddingGenerator(
    environment: NodeJS.ProcessEnv = process.env,
    dependencies: EmbeddingGeneratorDependencies = {}
): EmbeddingGenerator {
    const createClient = dependencies.createClient ?? ((options: EmbeddingsClientOptions): EmbeddingsClient => new OpenAI(options));
    const fetchImpl = dependencies.fetch ?? fetch;
    // An invalid limit override fails here, at boot, not on the first document.
    getEmbeddingInputTokenLimit(DEFAULT_MODEL, environment);

    return async (text, options) => {
        // Every setting is read per call, as the inline closure this replaced did.
        const providerStr = (environment.MEILISEARCH_EMBEDDING_PROVIDER || 'openai').toLowerCase();
        assertExternalLlmCallAllowed(`${providerStr} Meilisearch embeddings`);
        const apiKey = requireProviderKey(providerStr, environment);
        const model = options?.model || environment.MEILISEARCH_EMBEDDING_MODEL || DEFAULT_MODEL;

        const input = truncateToTokenLimit(text, getEmbeddingInputTokenLimit(model, environment));
        if (input.truncated) {
            logger.debug(
                `Embedding input for ${model} cut to ${input.tokens} tokens ` +
                `(${text.length - input.text.length} characters dropped); the full text stays keyword-searchable`
            );
        }

        // OpenRouter - proxies OpenAI embedding models
        if (providerStr === 'openrouter') {
            // App attribution shows in OpenRouter Logs dashboard. Override via
            // OPENROUTER_APP_TITLE / OPENROUTER_APP_URL when embedding MXF in
            // another application. The "(Meilisearch)" suffix separates
            // embedding traffic from chat completions.
            const baseTitle = environment.OPENROUTER_APP_TITLE || 'MXF';
            const client = createClient({
                apiKey,
                baseURL: 'https://openrouter.ai/api/v1',
                defaultHeaders: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': environment.OPENROUTER_APP_URL || 'https://mxf.dev',
                    'X-Title': `${baseTitle} (Meilisearch)`
                }
            });

            const response = await client.embeddings.create({
                model, // full model name such as 'openai/text-embedding-3-small'
                input: input.text,
                dimensions: options?.dimensions
            });
            if (!response?.data?.[0]?.embedding) {
                throw new Error('Invalid embedding response from OpenRouter');
            }
            return response.data[0].embedding;
        }

        // OpenAI direct
        if (providerStr === 'openai') {
            const client = createClient({ apiKey });
            const response = await client.embeddings.create({
                model: model.replace('openai/', ''),
                input: input.text
            });
            if (!response?.data?.[0]?.embedding) {
                throw new Error('Invalid embedding response from OpenAI');
            }
            return response.data[0].embedding;
        }

        // Voyage AI (via Anthropic partnership)
        if (providerStr === 'anthropic' || providerStr === 'voyage') {
            const response = await fetchImpl('https://api.voyageai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    input: [input.text],
                    input_type: 'document'
                })
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Voyage API error [${response.status}]: ${errorText.substring(0, 200)}`);
            }
            const result = await response.json() as { data?: Array<{ embedding?: number[] }> };
            if (!result?.data?.[0]?.embedding) {
                throw new Error('Invalid embedding response from Voyage');
            }
            return result.data[0].embedding;
        }

        // requireProviderKey has already refused any other provider.
        throw new Error(`Unsupported embedding provider: ${providerStr}`);
    };
}
