/**
 * MXF CLI TUI — Cost Tracker Service
 *
 * Tracks per-agent iteration and token usage metrics for the current session.
 * Each agent message and tool call counts as one iteration.
 * Token usage is tracked via LLM_USAGE events emitted by MxfAgent.
 * Cost estimates are calculated from token counts using model pricing tables.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/** Cost data for a single agent during the session */
export interface AgentCostData {
    /** Agent identifier */
    agentId: string;
    /** Display name */
    agentName: string;
    /** Total LLM iterations (messages + tool calls) */
    iterations: number;
    /** Number of tool calls made */
    toolCalls: number;
    /** Number of agent messages sent */
    messages: number;
    /** Number of tasks completed */
    tasksCompleted: number;
    /** Total input (prompt) tokens consumed */
    inputTokens: number;
    /** Total output (completion) tokens generated */
    outputTokens: number;
    /** Total tokens consumed (input + output) */
    totalTokens: number;
    /** Last model used by this agent (for cost estimation) */
    lastModel?: string;
}

/** Aggregate cost data for the entire session */
export interface SessionCostData {
    /** Per-agent cost breakdown (keyed by agentId) */
    agents: Record<string, AgentCostData>;
    /** Sum of all agent iterations */
    totalIterations: number;
    /** Sum of all tool calls */
    totalToolCalls: number;
    /** Sum of all agent messages */
    totalMessages: number;
    /** Sum of all completed tasks */
    totalTasks: number;
    /** Total input tokens across all agents */
    totalInputTokens: number;
    /** Total output tokens across all agents */
    totalOutputTokens: number;
    /** Total tokens across all agents */
    totalTokens: number;
    /** Session start time (epoch ms) */
    startTime: number;
    /** Budget limit in USD (null = no limit) */
    costBudget: number | null;
    /** Running estimated cost in USD, accumulated from each LLM usage event */
    estimatedCost: number;
    /** Whether the 80% budget warning has already been emitted this session */
    budgetWarningEmitted: boolean;
    /** Whether the budget has been exceeded (cost >= budget) */
    budgetExceeded: boolean;
}

/**
 * Load the cost budget default from ~/.mxf/config.json if present.
 * Reads the `costBudget` field at the config root level.
 *
 * @returns Budget value in USD, or null if not configured
 */
function loadBudgetFromConfig(): number | null {
    try {
        const configPath = `${process.env.HOME || '~'}/.mxf/config.json`;
        const fs = require('fs');
        if (!fs.existsSync(configPath)) return null;
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        if (typeof config.costBudget === 'number' && config.costBudget > 0) {
            return config.costBudget;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Create initial empty cost data for a new session.
 * Loads the default cost budget from ~/.mxf/config.json if configured.
 */
export function createInitialCostData(): SessionCostData {
    return {
        agents: {},
        totalIterations: 0,
        totalToolCalls: 0,
        totalMessages: 0,
        totalTasks: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        startTime: Date.now(),
        costBudget: loadBudgetFromConfig(),
        estimatedCost: 0,
        budgetWarningEmitted: false,
        budgetExceeded: false,
    };
}

/**
 * Record an iteration for a given agent.
 * Returns a new SessionCostData (immutable update for reducer).
 *
 * @param costData - Current session cost data
 * @param agentId - Agent that produced the iteration
 * @param agentName - Display name of the agent
 * @param iterationType - Type of iteration to record
 */
export function trackIteration(
    costData: SessionCostData,
    agentId: string,
    agentName: string,
    iterationType: 'message' | 'tool-call' | 'task-complete',
): SessionCostData {
    // Get or create agent entry
    const existing = costData.agents[agentId] || {
        agentId,
        agentName,
        iterations: 0,
        toolCalls: 0,
        messages: 0,
        tasksCompleted: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };

    const updated: AgentCostData = { ...existing };

    switch (iterationType) {
        case 'message':
            updated.messages++;
            updated.iterations++;
            break;
        case 'tool-call':
            updated.toolCalls++;
            updated.iterations++;
            break;
        case 'task-complete':
            updated.tasksCompleted++;
            break;
    }

    return {
        ...costData,
        agents: { ...costData.agents, [agentId]: updated },
        totalIterations: costData.totalIterations + (iterationType !== 'task-complete' ? 1 : 0),
        totalToolCalls: costData.totalToolCalls + (iterationType === 'tool-call' ? 1 : 0),
        totalMessages: costData.totalMessages + (iterationType === 'message' ? 1 : 0),
        totalTasks: costData.totalTasks + (iterationType === 'task-complete' ? 1 : 0),
    };
}

/**
 * Record token usage for a given agent.
 * Returns a new SessionCostData (immutable update for reducer).
 *
 * @param costData - Current session cost data
 * @param agentId - Agent that consumed the tokens
 * @param agentName - Display name of the agent
 * @param inputTokens - Input tokens consumed
 * @param outputTokens - Output tokens generated
 * @param totalTokens - Total tokens consumed
 * @param model - Model identifier (for cost estimation)
 */
export function trackTokenUsage(
    costData: SessionCostData,
    agentId: string,
    agentName: string,
    inputTokens: number,
    outputTokens: number,
    totalTokens: number,
    model?: string,
): SessionCostData {
    const existing = costData.agents[agentId] || {
        agentId,
        agentName,
        iterations: 0,
        toolCalls: 0,
        messages: 0,
        tasksCompleted: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
    };

    const updated: AgentCostData = {
        ...existing,
        inputTokens: existing.inputTokens + inputTokens,
        outputTokens: existing.outputTokens + outputTokens,
        totalTokens: existing.totalTokens + totalTokens,
        lastModel: model || existing.lastModel,
    };

    // Accumulate estimated cost from this usage event using the model pricing table.
    // Uses a default rate (Sonnet-tier) if the model is not in the pricing table.
    const DEFAULT_INPUT_RATE = 3;   // $/1M input tokens (Sonnet-tier default)
    const DEFAULT_OUTPUT_RATE = 15; // $/1M output tokens (Sonnet-tier default)
    const usageCost = model
        ? (estimateCost(inputTokens, outputTokens, model)
            ?? (inputTokens * DEFAULT_INPUT_RATE + outputTokens * DEFAULT_OUTPUT_RATE) / 1_000_000)
        : (inputTokens * DEFAULT_INPUT_RATE + outputTokens * DEFAULT_OUTPUT_RATE) / 1_000_000;

    return {
        ...costData,
        agents: { ...costData.agents, [agentId]: updated },
        totalInputTokens: costData.totalInputTokens + inputTokens,
        totalOutputTokens: costData.totalOutputTokens + outputTokens,
        totalTokens: costData.totalTokens + totalTokens,
        estimatedCost: costData.estimatedCost + usageCost,
    };
}

/**
 * Context window sizes (in tokens) for common models.
 * Used to detect when an agent is approaching its context limit
 * so the TUI can trigger compaction before the LLM fails.
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
 * Look up the context window size for a model.
 * Tries exact match, then prefix/substring match.
 *
 * @param model - Model identifier
 * @returns Context window size in tokens, or null if unknown
 */
export function getModelContextWindow(model: string): number | null {
    let window = MODEL_CONTEXT_WINDOWS[model];
    if (window) return window;

    const key = Object.keys(MODEL_CONTEXT_WINDOWS).find((k) => model.startsWith(k) || model.includes(k));
    if (key) return MODEL_CONTEXT_WINDOWS[key];

    return null;
}

/**
 * Check if any agent is approaching its model's context window limit.
 * Returns the agentId(s) that need compaction, or an empty array if all are fine.
 *
 * @param costData - Current session cost data
 * @returns Array of { agentId, usedTokens, contextWindow, usageRatio } for agents needing compaction
 */
export function checkContextThresholds(costData: SessionCostData): Array<{
    agentId: string;
    usedTokens: number;
    contextWindow: number;
    usageRatio: number;
}> {
    const results: Array<{ agentId: string; usedTokens: number; contextWindow: number; usageRatio: number }> = [];

    for (const agent of Object.values(costData.agents)) {
        if (!agent.lastModel || agent.totalTokens === 0) continue;

        const contextWindow = getModelContextWindow(agent.lastModel);
        if (!contextWindow) continue;

        const usageRatio = agent.totalTokens / contextWindow;
        if (usageRatio >= CONTEXT_COMPACT_THRESHOLD) {
            results.push({
                agentId: agent.agentId,
                usedTokens: agent.totalTokens,
                contextWindow,
                usageRatio,
            });
        }
    }

    return results;
}

/**
 * Approximate pricing per 1M tokens for common models.
 * Pricing is a rough estimate — actual costs vary by provider.
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
 *
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param model - Model identifier
 * @returns Estimated cost in USD, or null if pricing unknown
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
 * Format cost data as a human-readable summary for the /cost command.
 *
 * @param costData - Session cost data to format
 * @returns Multi-line string summary
 */
export function formatCostSummary(costData: SessionCostData): string {
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
            lines.push(`    ${agent.agentName.padEnd(10)} ${agent.iterations} iters${detail}`);
        }
    }

    lines.push('');
    lines.push(`  Tasks completed: ${costData.totalTasks}`);

    // Aggregate cost estimate
    if (hasTokens) {
        let totalCost: number | null = null;
        for (const agent of agents) {
            if (agent.lastModel && agent.totalTokens > 0) {
                const cost = estimateCost(agent.inputTokens, agent.outputTokens, agent.lastModel);
                if (cost !== null) {
                    totalCost = (totalCost ?? 0) + cost;
                }
            }
        }
        if (totalCost !== null) {
            lines.push(`  Est. cost:   ~$${totalCost.toFixed(4)}`);
        }
    }

    // Append budget status if a budget is set
    if (costData.costBudget !== null) {
        lines.push(`  Budget:      ${formatBudgetStatus(costData)}`);
    }

    return lines.join('\n');
}

/**
 * Get the context usage percentage for a specific agent.
 * Returns the ratio of tokens used to the model's context window, or null
 * if the model or token count is unknown.
 *
 * @param agentId - Agent to check
 * @param costData - Current session cost data
 * @returns Usage percentage (0–100), or null if unknown
 */
export function getContextUsagePercent(agentId: string, costData: SessionCostData): number | null {
    const agent = costData.agents[agentId];
    if (!agent || !agent.lastModel || agent.totalTokens === 0) return null;

    const contextWindow = getModelContextWindow(agent.lastModel);
    if (!contextWindow) return null;

    return Math.round((agent.totalTokens / contextWindow) * 100);
}

/**
 * Format a human-readable token recovery string for compaction feedback.
 *
 * @param tokensBefore - Token count before compaction
 * @param tokensAfter - Token count after compaction
 * @returns Formatted string (e.g., "recovered ~12,800 tokens (38% reduction)")
 */
export function formatTokenRecovery(tokensBefore: number, tokensAfter: number): string {
    const recovered = tokensBefore - tokensAfter;
    if (recovered <= 0) return 'no tokens recovered';

    const pct = tokensBefore > 0 ? Math.round((recovered / tokensBefore) * 100) : 0;
    return `recovered ~${recovered.toLocaleString()} tokens (${pct}% reduction)`;
}

/** Result of checking the current cost against the configured budget */
export interface BudgetCheckResult {
    /** True if cost >= 80% of budget and warning has not yet been emitted */
    warning: boolean;
    /** True if cost >= budget */
    exceeded: boolean;
    /** Current estimated cost in USD */
    estimatedCost: number;
    /** Configured budget limit in USD (null if no budget) */
    budget: number | null;
}

/**
 * Check the current estimated cost against the configured budget.
 * Returns whether a warning should be shown (80% threshold) and whether
 * the budget has been exceeded (100% threshold).
 *
 * @param costData - Current session cost data
 * @returns Budget check result with warning and exceeded flags
 */
export function checkBudget(costData: SessionCostData): BudgetCheckResult {
    const budget = costData.costBudget;
    const cost = costData.estimatedCost;

    if (budget === null || budget <= 0) {
        return { warning: false, exceeded: false, estimatedCost: cost, budget };
    }

    const ratio = cost / budget;
    return {
        warning: ratio >= 0.8 && !costData.budgetWarningEmitted,
        exceeded: ratio >= 1.0,
        estimatedCost: cost,
        budget,
    };
}

/**
 * Format a human-readable budget status string.
 * Shows estimated cost, budget limit, and percentage used.
 *
 * @param costData - Current session cost data
 * @returns Formatted budget status (e.g., "$1.23 / $5.00 (24.6%)")
 */
export function formatBudgetStatus(costData: SessionCostData): string {
    const cost = costData.estimatedCost;
    const budget = costData.costBudget;

    if (budget === null) {
        return `~$${cost.toFixed(4)} (no budget set)`;
    }

    const pct = budget > 0 ? ((cost / budget) * 100).toFixed(1) : '0.0';
    const status = costData.budgetExceeded ? ' EXCEEDED' : '';
    return `~$${cost.toFixed(4)} / $${budget.toFixed(2)} (${pct}%)${status}`;
}
