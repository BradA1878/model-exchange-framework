/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * Tool Behavioral Guidance Registry
 *
 * Maps tool names to behavioral hints, preferred alternatives,
 * and required preconditions. Appended to tool descriptions in
 * MxfAgentSystemPrompt when TOOL_BEHAVIORAL_GUIDANCE_ENABLED is true.
 *
 * Inspired by Claude Code's pattern of embedding detailed behavioral
 * guidance directly in each tool's description.
 */

import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'ToolBehavioralGuidance', 'server');

/**
 * Behavioral guidance for a single tool
 */
export interface ToolGuidance {
    /** The tool name this guidance applies to */
    toolName: string;
    /** Behavioral hint appended to the tool's description */
    guidance: string;
    /** Tool to prefer instead of this one in certain contexts (optional) */
    preferredAlternative?: string;
    /** Preconditions that should be met before calling this tool (optional) */
    preconditions?: string[];
}

/**
 * Tool Behavioral Guidance Registry — singleton
 *
 * Stores per-tool behavioral hints that are injected into tool
 * descriptions during system prompt construction.
 */
export class ToolBehavioralGuidance {
    private static instance: ToolBehavioralGuidance | null = null;
    private guidance = new Map<string, ToolGuidance>();

    private constructor() {
        this.registerDefaults();
    }

    /** Get singleton instance */
    public static getInstance(): ToolBehavioralGuidance {
        if (!ToolBehavioralGuidance.instance) {
            ToolBehavioralGuidance.instance = new ToolBehavioralGuidance();
        }
        return ToolBehavioralGuidance.instance;
    }

    /** Register guidance for a tool */
    public register(entry: ToolGuidance): void {
        this.guidance.set(entry.toolName, entry);
        logger.debug('Tool guidance registered', { toolName: entry.toolName });
    }

    /** Get guidance for a tool (undefined if none registered) */
    public get(toolName: string): ToolGuidance | undefined {
        return this.guidance.get(toolName);
    }

    /**
     * Build the guidance string to append to a tool's description.
     * Returns empty string if no guidance is registered.
     */
    public buildGuidanceString(toolName: string): string {
        const entry = this.guidance.get(toolName);
        if (!entry) return '';

        const parts: string[] = [`\n\n**Guidance:** ${entry.guidance}`];

        if (entry.preferredAlternative) {
            parts.push(`**Preferred alternative:** ${entry.preferredAlternative}`);
        }
        if (entry.preconditions && entry.preconditions.length > 0) {
            parts.push(`**Preconditions:** ${entry.preconditions.join('; ')}`);
        }

        return parts.join('\n');
    }

    /** List all registered tool names with guidance */
    public listTools(): string[] {
        return Array.from(this.guidance.keys());
    }

    /** Remove guidance for a tool */
    public unregister(toolName: string): boolean {
        return this.guidance.delete(toolName);
    }

    /** Clear all guidance (useful for testing) */
    public clear(): void {
        this.guidance.clear();
    }

    /** Reset to default guidance */
    public reset(): void {
        this.clear();
        this.registerDefaults();
    }

    /**
     * Register default behavioral guidance for core MXF tools.
     * These mirror the kinds of hints Claude Code embeds in its tool descriptions.
     */
    private registerDefaults(): void {
        // ORPAR control loop tools
        this.register({
            toolName: 'controlLoop_observe',
            guidance: 'Focus on gathering information — do not take action during observation. Read files, check state, and list available resources before reasoning.',
        });

        this.register({
            toolName: 'controlLoop_reason',
            guidance: 'Analyze observations before planning. Identify constraints, dependencies, and risks. Do not skip this phase even for simple tasks.',
        });

        this.register({
            toolName: 'controlLoop_plan',
            guidance: 'Produce a concrete, ordered list of actions. Each step should be a single tool call. Prefer small, reversible steps.',
        });

        this.register({
            toolName: 'controlLoop_act',
            guidance: 'Execute exactly one planned step per Act call. If the step fails, transition to Reflect rather than retrying with the same parameters.',
        });

        this.register({
            toolName: 'controlLoop_reflect',
            guidance: 'Evaluate whether the last action achieved its goal. If not, diagnose why before re-planning. Avoid reflection loops — three reflections without progress should trigger re-observation.',
        });

        // Communication tools
        this.register({
            toolName: 'messaging_send',
            guidance: 'Use direct messages when only one agent needs the information. Prefer messaging_send over agent_broadcast to reduce noise.',
            preferredAlternative: 'Use messaging_send for 1:1, agent_broadcast only for announcements that genuinely affect all agents.',
        });

        this.register({
            toolName: 'agent_broadcast',
            guidance: 'Broadcasting reaches every agent in the channel — use sparingly. Most coordination is better done with direct messages.',
            preferredAlternative: 'messaging_send for targeted communication',
        });

        // Task tools
        this.register({
            toolName: 'task_create',
            guidance: 'Include a clear, actionable description. Set appropriate priority. Assign to a specific agent when possible rather than leaving unassigned.',
        });

        this.register({
            toolName: 'task_complete',
            guidance: 'Include a detailed summary of what was accomplished, any outputs produced, and whether the result fully satisfies the original task description.',
        });

        // File tools
        this.register({
            toolName: 'read_file',
            guidance: 'Read before writing. When you know which section you need, specify offset and limit to reduce token usage.',
            preconditions: ['File path must be absolute or relative to the working directory'],
        });

        this.register({
            toolName: 'write_file',
            guidance: 'Prefer editing existing files over creating new ones. Always read the file first if it already exists.',
            preconditions: ['Read the file first if it exists', 'Ensure parent directory exists'],
        });

        // Code execution
        this.register({
            toolName: 'code_execute',
            guidance: 'Provide complete, self-contained code. Do not assume prior state from earlier executions. Include error handling for external calls.',
        });

        this.register({
            toolName: 'shell_execute',
            guidance: 'Be cautious with destructive commands (rm, drop, reset). Quote file paths with spaces. Prefer non-interactive commands.',
            preconditions: ['Consider whether the command is reversible'],
        });

        // Meta tools
        this.register({
            toolName: 'tools_recommend',
            guidance: 'Use when you are unsure which tool to use for a task. Describe the goal, not the tool name you want.',
        });

        logger.info('Default tool behavioral guidance registered', {
            count: this.guidance.size,
        });
    }
}
