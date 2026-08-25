/**
 * Embedding input is cut to the model's token limit before the provider is
 * called, counted with the tokenizer the OpenAI embedding models use
 * (cl100k_base), not estimated from characters. Before this, a message under
 * the 64 KiB ingress limit but over the provider's 8192-token ceiling failed
 * to embed on every attempt — 83 times in one production day.
 *
 * The provider counts the text it receives as a whole, so every assertion on
 * "fits" re-encodes the kept text whole with the same tokenizer.
 */
import { encode } from 'gpt-tokenizer/encoding/cl100k_base';
import { truncateToTokenLimit } from '../../../src/server/services/EmbeddingInput';

const providerCount = (text: string): number => encode(text, { disallowedSpecial: new Set() }).length;

const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(400); // ~4000 tokens
const denseJson = JSON.stringify(Array.from({ length: 300 }, (_, index) => ({
    id: index,
    url: `https://example.com/feed/${index}?utm_source=rss&utm_medium=feed`,
    title: `Item ${index}: quarterly results beat expectations`,
    published: '2026-08-25T09:11:00Z'
})));

describe('truncateToTokenLimit', () => {
    it('leaves input under the limit untouched and reports its token count', () => {
        const result = truncateToTokenLimit('hello world', 8192);

        expect(result.text).toBe('hello world');
        expect(result.truncated).toBe(false);
        expect(result.tokens).toBe(providerCount('hello world'));
    });

    it('counts whitespace-separated text exactly as the provider does, across slice boundaries', () => {
        for (const text of [prose, denseJson]) {
            const result = truncateToTokenLimit(text, 1_000_000);

            expect(result.truncated).toBe(false);
            expect(result.text).toBe(text);
            expect(result.tokens).toBe(providerCount(text));
        }
    });

    it('cuts prose to the limit, keeping a prefix of the original', () => {
        const result = truncateToTokenLimit(prose, 100);

        expect(result.truncated).toBe(true);
        expect(result.tokens).toBe(100);
        expect(providerCount(result.text)).toBe(100);
        expect(prose.startsWith(result.text)).toBe(true);
    });

    it('cuts dense JSON by real tokens, where a characters-per-token guess is wrong', () => {
        const result = truncateToTokenLimit(denseJson, 500);

        expect(providerCount(result.text)).toBeLessThanOrEqual(500);
        // Dense JSON runs well under four characters per token; a 4-chars-per-token
        // budget would have kept far more than 500 tokens.
        expect(result.text.length).toBeLessThan(500 * 4);
        expect(denseJson.startsWith(result.text)).toBe(true);
    });

    it('never ends the cut inside a multi-byte character or after a joiner', () => {
        const emoji = '🙂'.repeat(200);
        const families = '👨‍👩‍👧‍👦'.repeat(100);

        for (const text of [emoji, families]) {
            const result = truncateToTokenLimit(text, 50);

            expect(result.text).not.toMatch(/�/);
            expect(result.text).not.toMatch(/[\uD800-\uDBFF]$/);
            expect(result.text).not.toMatch(/‍$/);
            expect(providerCount(result.text)).toBeLessThanOrEqual(50);
            expect(text.startsWith(result.text)).toBe(true);
        }
    });

    it('stays fast on a long run with no whitespace, letters, or digits', () => {
        // A BPE tokenizer's cost grows with the length of one pre-tokenizer
        // piece. Emoji-heavy feed content is the input that produced the bug
        // report; a 64 KiB run of it took over a minute with the first
        // implementation tried, blocking the whole server. Slicing caps the
        // piece length and stops once the budget is spent.
        const inputs = [
            '🙂'.repeat(16_000),
            'abcdefghij'.repeat(6_500),
            '!?.,;:'.repeat(11_000),
            '👨‍👩‍👧‍👦'.repeat(2_900)
        ];

        for (const text of inputs) {
            const started = performance.now();
            const result = truncateToTokenLimit(text, 8192);
            const elapsed = performance.now() - started;

            expect(result.truncated).toBe(true);
            expect(providerCount(result.text)).toBeLessThanOrEqual(8192);
            expect(elapsed).toBeLessThan(1000);
        }
    });

    it.each([0, -5, 1.5, Number.NaN])('refuses a limit of %p', (limit) => {
        expect(() => truncateToTokenLimit('text', limit)).toThrow(/token limit/i);
    });
});
