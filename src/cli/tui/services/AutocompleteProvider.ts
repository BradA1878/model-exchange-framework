/**
 * MXF CLI TUI — Autocomplete Provider
 *
 * Generates tab completions based on partial input. Supports:
 * - `/` prefix: complete slash command names from the registry
 * - `@` prefix: complete agent names for @mention routing
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/**
 * Generate autocomplete suggestions for the given input.
 *
 * @param input - Current input string (may be partial)
 * @param commandNames - Available slash command names (without `/` prefix)
 * @param agentNames - Available agent names (lowercase, without `@` prefix)
 * @returns Array of complete suggestion strings, or empty if no matches
 */
export function getCompletions(
    input: string,
    commandNames: string[],
    agentNames: string[],
): string[] {
    if (!input) return [];

    // Slash command completion: /he → /help
    if (input.startsWith('/')) {
        const partial = input.substring(1).toLowerCase();
        if (!partial) {
            // Just "/" typed — show all commands
            return commandNames.map((c) => `/${c}`);
        }
        return commandNames
            .filter((c) => c.startsWith(partial))
            .map((c) => `/${c}`);
    }

    // Agent mention completion: @op → @operator
    if (input.startsWith('@')) {
        const partial = input.substring(1).toLowerCase();
        if (!partial) {
            // Just "@" typed — show all agents
            return agentNames.map((n) => `@${n} `);
        }
        // Only complete the agent name part (before any space)
        const spaceIdx = partial.indexOf(' ');
        if (spaceIdx !== -1) {
            // Already have agent name + space + message — no completion
            return [];
        }
        return agentNames
            .filter((n) => n.startsWith(partial))
            .map((n) => `@${n} `);
    }

    return [];
}
