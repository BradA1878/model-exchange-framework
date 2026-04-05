/**
 * MXF Desktop — Cost Tracker Service
 *
 * Tracks per-agent iteration and token usage metrics for the current session.
 * Each agent message and tool call counts as one iteration.
 * Token usage is tracked via LLM_USAGE events emitted by MxfAgent.
 * Cost estimates are calculated from token counts using model pricing tables.
 *
 * Ported from the TUI's CostTracker — all pure functions, no Node.js deps.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/**
 * Context window sizes (in tokens) for common models.
 * Used to detect when an agent is approaching its context limit
 * so the app can trigger compaction before the LLM fails.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // Anthropic
    'claude-opus-4-6': 200_000,
    'claude-sonnet-4-6': 200_000,
    'claude-opus-4-5': 200_000,
    'claude-sonnet-4-5': 200_000,
    'claude-haiku-4-5': 200_000,
    // OpenAI
    'gpt-4.1': 1_047_576,
    'gpt-4.1-mini': 1_047_576,
    'gpt-4o': 128_000,
    'gpt-4o-mini': 128_000,
    'o1': 200_000,
    'o3-mini': 200_000,
    // Google
    'gemini-3-pro-preview': 1_000_000,
    'gemini-3-flash-preview': 1_000_000,
    'gemini-2.5-pro': 1_048_576,
    'gemini-2.5-flash': 1_048_576,
    'gemini-2.0-flash': 1_048_576,
    // xAI
    'grok-3': 131_072,
    'grok-3-mini': 131_072,
    // Meta
    'meta-llama/llama-3.1-405b-instruct': 128_000,
    'meta-llama/llama-3.1-70b-instruct': 128_000,
    // DeepSeek
    'deepseek/deepseek-chat': 128_000,
    'deepseek/deepseek-reasoner': 128_000,
};

/** Fraction of the context window at which compaction is triggered */
const CONTEXT_COMPACT_THRESHOLD = 0.75;

/**
 * Approximate pricing per 1M tokens for common models.
 * Format: { input: $/1M input tokens, output: $/1M output tokens }
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    // Anthropic (current generation)
    'claude-opus-4-6': { input: 15, output: 75 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-opus-4-5': { input: 15, output: 75 },
    'claude-sonnet-4-5': { input: 3, output: 15 },
    'claude-haiku-4-5': { input: 0.80, output: 4 },
    // OpenAI
    'gpt-4.1': { input: 2, output: 8 },
    'gpt-4.1-mini': { input: 0.40, output: 1.60 },
    'gpt-4o': { input: 2.50, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'o1': { input: 15, output: 60 },
    'o3-mini': { input: 1.10, output: 4.40 },
    // Google
    'gemini-3-pro-preview': { input: 2, output: 12 },
    'gemini-3-flash-preview': { input: 0.50, output: 3 },
    'gemini-2.5-pro': { input: 1.25, output: 10 },
    'gemini-2.5-flash': { input: 0.15, output: 0.60 },
    'gemini-2.0-flash': { input: 0.10, output: 0.40 },
    // xAI
    'grok-3': { input: 3, output: 15 },
    'grok-3-mini': { input: 0.30, output: 0.50 },
    // Meta (via providers)
    'meta-llama/llama-3.1-405b-instruct': { input: 3, output: 3 },
    'meta-llama/llama-3.1-70b-instruct': { input: 0.52, output: 0.75 },
    // DeepSeek
    'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
    'deepseek/deepseek-reasoner': { input: 0.55, output: 2.19 },
};

/**
 * Estimate cost in USD for a given token usage and model.
 * Returns null if the model is not in the pricing table.
 */
export function estimateCost(inputTokens: number, outputTokens: number, model: string): number | null {
    // Try exact match first, then prefix match for versioned model IDs
    let pricing = MODEL_PRICING[model];
    if (!pricing) {
        const key = Object.keys(MODEL_PRICING).find((k) => model.startsWith(k) || model.includes(k));
        if (key) pricing = MODEL_PRICING[key];
    }
    if (!pricing) return null;

    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Look up the context window size for a model.
 * Tries exact match, then prefix/substring match.
 */
export function getModelContextWindow(model: string): number | null {
    const window = MODEL_CONTEXT_WINDOWS[model];
    if (window) return window;

    const key = Object.keys(MODEL_CONTEXT_WINDOWS).find((k) => model.startsWith(k) || model.includes(k));
    if (key) return MODEL_CONTEXT_WINDOWS[key]!;

    return null;
}

/**
 * Check if any agent is approaching its model's context window limit.
 * Returns agents that need compaction.
 */
export function checkContextThresholds(agents: Record<string, { totalTokens: number; lastModel: string | null }>): Array<{
    agentId: string;
    usedTokens: number;
    contextWindow: number;
    usageRatio: number;
}> {
    const results: Array<{ agentId: string; usedTokens: number; contextWindow: number; usageRatio: number }> = [];

    for (const [agentId, agent] of Object.entries(agents)) {
        if (!agent.lastModel || agent.totalTokens === 0) continue;

        const contextWindow = getModelContextWindow(agent.lastModel);
        if (!contextWindow) continue;

        const usageRatio = agent.totalTokens / contextWindow;
        if (usageRatio >= CONTEXT_COMPACT_THRESHOLD) {
            results.push({ agentId, usedTokens: agent.totalTokens, contextWindow, usageRatio });
        }
    }

    return results;
}

/** Result of checking the current cost against the configured budget */
export interface BudgetCheckResult {
    /** True if cost >= 80% of budget and warning has not yet been emitted */
    warning: boolean;
    /** True if cost >= budget */
    exceeded: boolean;
    estimatedCost: number;
    budget: number | null;
}

/**
 * Check the current estimated cost against the configured budget.
 */
export function checkBudget(estimatedCost: number, costBudget: number | null, budgetWarningEmitted: boolean): BudgetCheckResult {
    if (costBudget === null || costBudget <= 0) {
        return { warning: false, exceeded: false, estimatedCost, budget: costBudget };
    }

    const ratio = estimatedCost / costBudget;
    return {
        warning: ratio >= 0.8 && !budgetWarningEmitted,
        exceeded: ratio >= 1.0,
        estimatedCost,
        budget: costBudget,
    };
}

/**
 * Format a human-readable budget status string.
 */
export function formatBudgetStatus(estimatedCost: number, costBudget: number | null, budgetExceeded: boolean): string {
    if (costBudget === null) {
        return `~$${estimatedCost.toFixed(4)} (no budget set)`;
    }

    const pct = costBudget > 0 ? ((estimatedCost / costBudget) * 100).toFixed(1) : '0.0';
    const status = budgetExceeded ? ' EXCEEDED' : '';
    return `~$${estimatedCost.toFixed(4)} / $${costBudget.toFixed(2)} (${pct}%)${status}`;
}

/**
 * Format cost data as a human-readable summary for the /cost command.
 */
export function formatCostSummary(costData: {
    agents: Record<string, { agentName: string; iterations: number; messages: number; toolCalls: number; inputTokens: number; outputTokens: number; totalTokens: number; lastModel: string | null; tasksCompleted: number }>;
    totalIterations: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTasks: number;
    startTime: number;
    costBudget: number | null;
    estimatedCost: number;
    budgetExceeded: boolean;
}): string {
    const elapsed = Date.now() - costData.startTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const elapsedStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    const hasTokens = costData.totalTokens > 0;

    const lines: string[] = [
        'Session Cost Summary:',
        `  Elapsed:     ${elapsedStr}`,
        `  Iterations:  ${costData.totalIterations} total`,
    ];

    if (hasTokens) {
        lines.push(`  Tokens:      ${costData.totalTokens.toLocaleString()} total (${costData.totalInputTokens.toLocaleString()} in / ${costData.totalOutputTokens.toLocaleString()} out)`);
    }

    lines.push('');
    lines.push('  Agent Breakdown:');

    const agents = Object.values(costData.agents);
    if (agents.length === 0) {
        lines.push('    (no agent activity yet)');
    } else {
        for (const agent of agents) {
            const parts: string[] = [];
            if (agent.messages > 0) parts.push(`${agent.messages} msg`);
            if (agent.toolCalls > 0) parts.push(`${agent.toolCalls} tools`);
            if (agent.totalTokens > 0) parts.push(`${agent.totalTokens.toLocaleString()} tokens`);
            if (agent.lastModel) {
                const cost = estimateCost(agent.inputTokens, agent.outputTokens, agent.lastModel);
                if (cost !== null) parts.push(`~$${cost.toFixed(4)}`);
            }
            const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
            lines.push(`    ${agent.agentName.padEnd(12)} ${agent.iterations} iters${detail}`);
        }
    }

    lines.push('');
    lines.push(`  Tasks completed: ${costData.totalTasks}`);

    // Aggregate cost estimate
    if (costData.estimatedCost > 0) {
        lines.push(`  Est. cost:   ~$${costData.estimatedCost.toFixed(4)}`);
    }

    // Budget status
    if (costData.costBudget !== null) {
        lines.push(`  Budget:      ${formatBudgetStatus(costData.estimatedCost, costData.costBudget, costData.budgetExceeded)}`);
    }

    return lines.join('\n');
}

/**
 * Format a human-readable token recovery string for compaction feedback.
 */
export function formatTokenRecovery(tokensBefore: number, tokensAfter: number): string {
    const recovered = tokensBefore - tokensAfter;
    if (recovered <= 0) return 'no tokens recovered';

    const pct = tokensBefore > 0 ? Math.round((recovered / tokensBefore) * 100) : 0;
    return `recovered ~${recovered.toLocaleString()} tokens (${pct}% reduction)`;
}

/**
 * Get the context usage percentage for a specific agent.
 */
export function getContextUsagePercent(totalTokens: number, lastModel: string | null): number | null {
    if (!lastModel || totalTokens === 0) return null;

    const contextWindow = getModelContextWindow(lastModel);
    if (!contextWindow) return null;

    return Math.round((totalTokens / contextWindow) * 100);
}
