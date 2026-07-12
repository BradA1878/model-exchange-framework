/**
 * MXF CLI Model Catalog
 *
 * The curated model IDs the CLI offers per provider — the single source of
 * truth for `mxf init` (which uses `prompts`) and the TUI's `/model` command
 * (which uses an Ink select). Both used to keep private copies of this list and
 * they had already drifted apart.
 *
 * The catalog stays UI-agnostic: it exports model IDs, and each consumer maps
 * them into whatever choice shape its prompt library wants.
 *
 * Providers without an entry (notably Ollama) have no curated list because
 * their models are user-installed; callers must take a model ID directly rather
 * than presenting someone else's list.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/** Provider identifier → curated model IDs, best/most-capable first */
export const MODEL_CATALOG: Readonly<Record<string, readonly string[]>> = {
    openrouter: [
        'anthropic/claude-sonnet-4.6',
        'anthropic/claude-sonnet-4.5',
        'anthropic/claude-haiku-4.5',
        'anthropic/claude-opus-4.6',
        'openai/gpt-4.1',
        'openai/gpt-4.1-mini',
        'google/gemini-3-pro-preview',
        'google/gemini-3-flash-preview',
        'google/gemini-2.5-pro',
        'google/gemini-2.5-flash',
    ],
    anthropic: [
        'claude-sonnet-4-6',
        'claude-sonnet-4-5',
        'claude-haiku-4-5',
        'claude-opus-4-6',
    ],
    openai: [
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4o',
    ],
    gemini: [
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
    ],
    xai: [
        'grok-3',
        'grok-3-mini',
    ],
};

/**
 * Whether a provider has a curated model list.
 *
 * False for providers whose models are user-installed (Ollama) — those callers
 * must prompt for a model ID instead of showing a list.
 */
export function hasModelCatalog(provider: string): boolean {
    return provider in MODEL_CATALOG;
}

/**
 * Get the curated model IDs for a provider.
 *
 * @param provider - Provider identifier (e.g. 'openrouter')
 * @returns The model IDs for that provider
 * @throws If the provider has no curated list — callers should check
 *   `hasModelCatalog` first and prompt for a model ID instead of silently
 *   showing a different provider's models.
 */
export function getModelIds(provider: string): readonly string[] {
    const models = MODEL_CATALOG[provider];
    if (!models) {
        throw new Error(
            `No model catalog for provider "${provider}". ` +
            `Known providers: ${Object.keys(MODEL_CATALOG).join(', ')}. ` +
            'Specify a model ID directly.',
        );
    }
    return models;
}
