/**
 * Unit tests for the shared CLI model catalog.
 *
 * The catalog exists because `mxf init` and the TUI's /model command each kept
 * a private copy of the model list, and the copies had drifted — init's
 * OpenRouter list was missing anthropic/claude-opus-4.6.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { MODEL_CATALOG, getModelIds, hasModelCatalog } from '../../../src/cli/models';

describe('Model catalog', () => {
    it('lists a model set for every managed provider', () => {
        for (const provider of ['openrouter', 'anthropic', 'openai', 'gemini', 'xai']) {
            expect(hasModelCatalog(provider)).toBe(true);
            expect(getModelIds(provider).length).toBeGreaterThan(0);
        }
    });

    it('includes the opus model that init.ts had drifted away from', () => {
        expect(getModelIds('openrouter')).toContain('anthropic/claude-opus-4.6');
    });

    it('has no duplicate model IDs within a provider', () => {
        for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
            expect(new Set(models).size).toBe(models.length);
            expect(provider).toBeTruthy();
        }
    });

    it('reports no catalog for providers whose models are user-installed', () => {
        // Ollama models are whatever the user has pulled locally, so there is no
        // list to show — callers must take a model ID directly.
        expect(hasModelCatalog('ollama')).toBe(false);
    });

    it('throws rather than silently returning another provider\'s models', () => {
        // The TUI used to fall back to the OpenRouter list, offering models that
        // do not exist on the configured provider.
        expect(() => getModelIds('ollama')).toThrow(/No model catalog for provider "ollama"/);
        expect(() => getModelIds('nonsense')).toThrow(/Specify a model ID directly/);
    });
});
