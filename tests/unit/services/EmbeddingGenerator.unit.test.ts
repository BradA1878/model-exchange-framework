/**
 * The server's embedding generator — the function MxfMeilisearchService calls
 * for every document and query — cuts its input to the model's token limit
 * before the provider sees it, and picks the provider from the environment.
 * It used to be an inline closure in src/server/index.ts with no length check
 * at all, so a message between the 64 KiB ingress limit and the provider's
 * 8192-token ceiling failed on every attempt.
 */
jest.mock('@mxf-dev/core/protocols/mcp/LlmTestEnvironmentGuard', () => ({
    assertExternalLlmCallAllowed: jest.fn()
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = jest.fn(); warn = jest.fn(); error = jest.fn(); debug = jest.fn();
    }
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from 'gpt-tokenizer/encoding/cl100k_base';
import { createEmbeddingGenerator, type EmbeddingsClient } from '../../../src/server/services/EmbeddingGenerator';

const providerCount = (text: string): number => encode(text, { disallowedSpecial: new Set() }).length;

const embedding = [0.1, 0.2, 0.3];

/** A stand-in for the OpenAI client: records what it was asked to embed. */
const fakeClient = (): { client: EmbeddingsClient; requests: Array<{ model: string; input: string }> } => {
    const requests: Array<{ model: string; input: string }> = [];
    return {
        requests,
        client: {
            embeddings: {
                create: async (
                    request: { model: string; input: string; dimensions?: number }
                ): Promise<{ data: Array<{ embedding: number[] }> }> => {
                    requests.push({ model: request.model, input: request.input });
                    return { data: [{ embedding }] };
                }
            }
        }
    };
};

const longText = 'Quarterly results beat expectations across every segment. '.repeat(1500); // ~15k tokens

describe('createEmbeddingGenerator', () => {
    it('sends text under the limit to the provider verbatim', async () => {
        const { client, requests } = fakeClient();
        const generate = createEmbeddingGenerator(
            { OPENAI_API_KEY: 'k', MEILISEARCH_EMBEDDING_PROVIDER: 'openai' },
            { createClient: () => client }
        );

        await expect(generate('hello world', { model: 'text-embedding-3-small' })).resolves.toEqual(embedding);

        expect(requests).toEqual([{ model: 'text-embedding-3-small', input: 'hello world' }]);
    });

    it('cuts input to the model token limit before the provider sees it', async () => {
        const { client, requests } = fakeClient();
        const generate = createEmbeddingGenerator(
            { OPENAI_API_KEY: 'k', MEILISEARCH_EMBEDDING_PROVIDER: 'openai' },
            { createClient: () => client }
        );

        await generate(longText, { model: 'text-embedding-3-small' });

        expect(requests).toHaveLength(1);
        expect(providerCount(requests[0].input)).toBeLessThanOrEqual(8192);
        expect(providerCount(longText)).toBeGreaterThan(8192);
        expect(longText.startsWith(requests[0].input)).toBe(true);
    });

    it('honours a lower limit from the environment', async () => {
        const { client, requests } = fakeClient();
        const generate = createEmbeddingGenerator(
            { OPENAI_API_KEY: 'k', MEILISEARCH_EMBEDDING_PROVIDER: 'openai', MEILISEARCH_EMBEDDING_MAX_INPUT_TOKENS: '100' },
            { createClient: () => client }
        );

        await generate(longText, { model: 'text-embedding-3-small' });

        expect(providerCount(requests[0].input)).toBeLessThanOrEqual(100);
    });

    it('refuses an invalid limit override at creation, not on the first document', () => {
        const { client } = fakeClient();

        expect(() => createEmbeddingGenerator(
            { OPENAI_API_KEY: 'k', MEILISEARCH_EMBEDDING_MAX_INPUT_TOKENS: 'lots' },
            { createClient: () => client }
        )).toThrow('MEILISEARCH_EMBEDDING_MAX_INPUT_TOKENS');
    });

    it('reads the default model per call, as the inline closure it replaced did', async () => {
        const environment: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'k', MEILISEARCH_EMBEDDING_PROVIDER: 'openai' };
        const { client, requests } = fakeClient();
        const generate = createEmbeddingGenerator(environment, { createClient: () => client });

        environment.MEILISEARCH_EMBEDDING_MODEL = 'text-embedding-3-large';
        await generate('hi');

        expect(requests[0].model).toBe('text-embedding-3-large');
    });

    it('keeps the provider prefix for OpenRouter and strips it for OpenAI direct', async () => {
        const openRouter = fakeClient();
        await createEmbeddingGenerator(
            { OPENROUTER_API_KEY: 'k', MEILISEARCH_EMBEDDING_PROVIDER: 'openrouter' },
            { createClient: () => openRouter.client }
        )('hi', { model: 'openai/text-embedding-3-small' });
        expect(openRouter.requests[0].model).toBe('openai/text-embedding-3-small');

        const openAi = fakeClient();
        await createEmbeddingGenerator(
            { OPENAI_API_KEY: 'k', MEILISEARCH_EMBEDDING_PROVIDER: 'openai' },
            { createClient: () => openAi.client }
        )('hi', { model: 'openai/text-embedding-3-small' });
        expect(openAi.requests[0].model).toBe('text-embedding-3-small');
    });

    it('fails fast on a missing key or an unknown provider, before touching the input', async () => {
        const { client } = fakeClient();

        await expect(createEmbeddingGenerator(
            { MEILISEARCH_EMBEDDING_PROVIDER: 'openai' }, { createClient: () => client }
        )(longText)).rejects.toThrow('OPENAI_API_KEY');
        await expect(createEmbeddingGenerator(
            { MEILISEARCH_EMBEDDING_PROVIDER: 'carrier-pigeon' }, { createClient: () => client }
        )('hi')).rejects.toThrow('Unsupported embedding provider');
    });

    it('is what the server installs on the search service', () => {
        // The factory is only worth testing if the server uses it. The old
        // inline closure built the provider request itself; that must not
        // come back.
        const serverSource = readFileSync(join(__dirname, '../../../src/server/index.ts'), 'utf8');

        expect(serverSource).toContain('const embeddingGenerator = createEmbeddingGenerator();');
        expect(serverSource).not.toContain('embeddings.create(');
    });
});
