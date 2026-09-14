import type { McpApiResponse } from '../IMcpClient.js';

/** Preserve unreported usage as absent and distinguish it from reported zero counts. */
export function reportedTokenUsage(
    provider: string,
    input: unknown,
    output: unknown,
    total: unknown
): McpApiResponse['usage'] {
    if (input === undefined && output === undefined && total === undefined) return undefined;
    if ([input, output, total].some(count => typeof count !== 'number' || !Number.isFinite(count) || count < 0)) {
        throw new Error(`${provider} response has missing or invalid token usage`);
    }
    return { input_tokens: input as number, output_tokens: output as number, total_tokens: total as number };
}
