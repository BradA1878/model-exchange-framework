/**
 * MXF CLI TUI — Agent Role Definitions
 *
 * Defines the AgentDefinition interface and provides functions for loading
 * agent definitions from `.md` files. Built-in agents ship as markdown files
 * in `built-in/`. Users can add custom agents to `~/.mxf/agents/`.
 *
 * The Planner (orchestrator) decomposes tasks and delegates via
 * task_create_with_plan / messaging_send. Specialist agents execute subtasks
 * and report results back to the Planner.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { loadAll } from './AgentLoader';

/** Definition for a single agent role */
export interface AgentDefinition {
    /** Unique agent identifier (e.g., 'mxf-planner') */
    agentId: string;
    /** Display name (e.g., 'Planner') */
    name: string;
    /** Short description of what the agent does */
    description: string;
    /** Agent role: 'orchestrator' for the planner, 'specialist' for workers */
    role: string;
    /** Role-specific system prompt (loaded from .md file body) */
    systemPrompt: string;
    /** MCP tools this agent is allowed to call */
    allowedTools: string[];
    /** LLM temperature (lower = more deterministic) */
    temperature: number;
    /** Max output tokens per LLM call */
    maxTokens: number;
    /** Max ORPAR iterations before forced completion */
    maxIterations: number;
    /** TUI display color (chalk color name) */
    color: string;
    /** Enable extended thinking/reasoning for this agent */
    reasoningEnabled: boolean;
    /** Reasoning effort level: low (~20%), medium (~50%), high (~80% of maxTokens) */
    reasoningEffort: 'low' | 'medium' | 'high';
}

/**
 * Build name and color maps from a set of agent definitions.
 *
 * Used by TUI components that need agent display names and colors
 * (event monitor, confirmation prompts, conversation entries).
 *
 * @param definitions - The active agent definitions
 * @returns name and color maps keyed by agentId
 */
export function getAgentMaps(definitions: AgentDefinition[]): {
    names: Record<string, string>;
    colors: Record<string, string>;
} {
    const names: Record<string, string> = {};
    const colors: Record<string, string> = {};
    for (const d of definitions) {
        names[d.agentId] = d.name;
        colors[d.agentId] = d.color;
    }
    return { names, colors };
}

/**
 * Load all available agent definitions (built-in + custom).
 *
 * Optionally filter to only the enabled agent IDs. If no filter is provided,
 * returns all available agents.
 *
 * @param enabledIds - Agent IDs to include (undefined = all agents)
 * @param customDir - Override custom agents directory
 * @returns Filtered array of AgentDefinition objects
 */
export function getEnabledAgentDefinitions(
    enabledIds?: string[],
    customDir?: string,
): AgentDefinition[] {
    const all = loadAll(customDir);

    if (!enabledIds || enabledIds.length === 0) {
        return all;
    }

    return all.filter(d => enabledIds.includes(d.agentId));
}
