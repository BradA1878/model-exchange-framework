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
 * Deferred Tool Schema Registry
 *
 * Classifies tools into tier-1 (always full schema) and tier-2
 * (name-only listing, schema loaded on demand). When total tools
 * exceed the tier-2 threshold, only tier-1 tools get full schemas
 * in the system prompt; tier-2 tools are listed as available and
 * discoverable via the existing tools_recommend meta-tool.
 *
 * Inspired by Claude Code's progressive tool schema disclosure.
 */

import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'DeferredToolSchemaRegistry', 'server');

/** Classification tier for a tool */
export type ToolTier = 'tier1' | 'tier2';

/**
 * Deferred Tool Schema Registry — singleton
 */
export class DeferredToolSchemaRegistry {
    private static instance: DeferredToolSchemaRegistry | null = null;

    /** Tools explicitly assigned to tier-1 (always get full schema) */
    private tier1Tools = new Set<string>();

    /** Tools explicitly assigned to tier-2 (deferred schema) */
    private tier2Tools = new Set<string>();

    /**
     * When total tool count exceeds this threshold, unclassified tools
     * default to tier-2 instead of tier-1.
     */
    private tier2Threshold = 15;

    private constructor() {
        this.registerDefaults();
    }

    /** Get singleton instance */
    public static getInstance(): DeferredToolSchemaRegistry {
        if (!DeferredToolSchemaRegistry.instance) {
            DeferredToolSchemaRegistry.instance = new DeferredToolSchemaRegistry();
        }
        return DeferredToolSchemaRegistry.instance;
    }

    /** Set the tier-2 threshold (tool count above which unclassified tools become tier-2) */
    public setTier2Threshold(threshold: number): void {
        this.tier2Threshold = threshold;
        logger.info('Tier-2 threshold updated', { threshold });
    }

    /** Get the current tier-2 threshold */
    public getTier2Threshold(): number {
        return this.tier2Threshold;
    }

    /** Explicitly assign a tool to tier-1 (always full schema) */
    public setTier1(toolName: string): void {
        this.tier1Tools.add(toolName);
        this.tier2Tools.delete(toolName);
    }

    /** Explicitly assign a tool to tier-2 (deferred schema) */
    public setTier2(toolName: string): void {
        this.tier2Tools.add(toolName);
        this.tier1Tools.delete(toolName);
    }

    /**
     * Classify a tool given the total number of tools available.
     * - Explicitly assigned tools return their assigned tier.
     * - When total tools <= threshold, everything is tier-1.
     * - When total tools > threshold, unclassified tools are tier-2.
     */
    public classify(toolName: string, totalToolCount: number): ToolTier {
        if (this.tier1Tools.has(toolName)) return 'tier1';
        if (this.tier2Tools.has(toolName)) return 'tier2';

        // Below threshold, everything gets full schema
        if (totalToolCount <= this.tier2Threshold) return 'tier1';

        // Above threshold, unclassified tools are deferred
        return 'tier2';
    }

    /**
     * Partition a list of tool names into tier-1 and tier-2 groups.
     * Convenience method for MxfAgentSystemPrompt.buildToolSchemas().
     */
    public partition(toolNames: string[]): { tier1: string[]; tier2: string[] } {
        const total = toolNames.length;
        const tier1: string[] = [];
        const tier2: string[] = [];

        for (const name of toolNames) {
            if (this.classify(name, total) === 'tier1') {
                tier1.push(name);
            } else {
                tier2.push(name);
            }
        }

        logger.debug('Tool schema partition', {
            total,
            tier1Count: tier1.length,
            tier2Count: tier2.length,
            threshold: this.tier2Threshold,
        });

        return { tier1, tier2 };
    }

    /**
     * Build a summary string for deferred (tier-2) tools.
     * This replaces their full schemas in the system prompt.
     *
     * @param tier2Names - Names of deferred tools
     * @param discoveryToolName - Name of the tool used to discover deferred tools (default: 'tools_recommend')
     */
    public buildDeferredSummary(tier2Names: string[], discoveryToolName: string = 'tools_recommend'): string {
        if (tier2Names.length === 0) return '';

        return `## Additional Tools Available

The following ${tier2Names.length} tools are available but not shown in detail. Use \`${discoveryToolName}\` to discover the right tool for your task, or \`tools_validate\` to check parameters.

Available: ${tier2Names.join(', ')}`;
    }

    /** List all explicitly tier-1 tools */
    public listTier1(): string[] {
        return Array.from(this.tier1Tools);
    }

    /** List all explicitly tier-2 tools */
    public listTier2(): string[] {
        return Array.from(this.tier2Tools);
    }

    /** Clear all classifications (useful for testing) */
    public clear(): void {
        this.tier1Tools.clear();
        this.tier2Tools.clear();
    }

    /** Reset to default classifications */
    public reset(): void {
        this.clear();
        this.registerDefaults();
    }

    /**
     * Register default tier-1 tools — these always get full schemas
     * because agents use them frequently and must know their parameters.
     */
    private registerDefaults(): void {
        // ORPAR control loop — core to agent operation
        const alwaysFull = [
            'controlLoop_observe',
            'controlLoop_reason',
            'controlLoop_plan',
            'controlLoop_act',
            'controlLoop_reflect',
            // Communication — used every task
            'messaging_send',
            'agent_broadcast',
            // Task lifecycle
            'task_complete',
            'task_create',
            'task_create_with_plan',
            // Meta tools — needed to discover tier-2 tools
            'tools_recommend',
            'tools_validate',
            'tools_recommend_on_error',
            // Context and memory
            'context_inject',
            'context_get',
            // User interaction
            'user_input',
        ];

        for (const tool of alwaysFull) {
            this.tier1Tools.add(tool);
        }

        logger.info('Default tier-1 tools registered', { count: this.tier1Tools.size });
    }
}
