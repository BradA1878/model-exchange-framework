/**
 * The embedding provider's input ceiling, represented next to the ingress
 * limits so the two can be compared: a message may be 64 KiB, the embedder
 * accepts about 8192 tokens. Before this existed the limit lived only on the
 * provider's side, and every message between the two ceilings failed to embed.
 */
import {
    DEFAULT_EMBEDDING_INPUT_TOKEN_LIMIT,
    EMBEDDING_INPUT_TOKEN_LIMIT_ENV,
    getEmbeddingInputTokenLimit
} from '@mxf-dev/core/config/EmbeddingInputLimits';

describe('getEmbeddingInputTokenLimit', () => {
    it('knows the OpenAI embedding models', () => {
        expect(getEmbeddingInputTokenLimit('text-embedding-3-small', {})).toBe(8192);
        expect(getEmbeddingInputTokenLimit('text-embedding-3-large', {})).toBe(8192);
        expect(getEmbeddingInputTokenLimit('text-embedding-ada-002', {})).toBe(8191);
    });

    it('ignores a provider prefix on the model name', () => {
        expect(getEmbeddingInputTokenLimit('openai/text-embedding-3-small', {})).toBe(8192);
    });

    it('falls back to the default for a model it does not know', () => {
        expect(getEmbeddingInputTokenLimit('voyage-3', {})).toBe(DEFAULT_EMBEDDING_INPUT_TOKEN_LIMIT);
    });

    it('lets the environment override the limit', () => {
        expect(getEmbeddingInputTokenLimit('text-embedding-3-small', {
            [EMBEDDING_INPUT_TOKEN_LIMIT_ENV]: '4000'
        })).toBe(4000);
    });

    it('treats an empty override as unset', () => {
        expect(getEmbeddingInputTokenLimit('text-embedding-3-small', {
            [EMBEDDING_INPUT_TOKEN_LIMIT_ENV]: '  '
        })).toBe(8192);
    });

    it.each(['0', '-1', '1.5', 'many'])('refuses an override of %j', (value) => {
        expect(() => getEmbeddingInputTokenLimit('text-embedding-3-small', {
            [EMBEDDING_INPUT_TOKEN_LIMIT_ENV]: value
        })).toThrow(EMBEDDING_INPUT_TOKEN_LIMIT_ENV);
    });
});
