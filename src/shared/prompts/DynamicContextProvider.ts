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
 * Dynamic Context Provider
 *
 * Interface and registry for dynamic context providers that inject
 * runtime information (task progress, recent errors, channel state,
 * memory index) into agent system prompts.
 *
 * Providers are priority-ordered and conditionally activated based
 * on the current agent context.
 */

import { Logger } from '../utils/Logger';
import { estimateTokens } from '../utils/TokenEstimator';
import { AgentId, ChannelId } from '../types/ChannelContext';

const logger = new Logger('info', 'DynamicContextProvider', 'server');

/**
 * Runtime context passed to providers to decide activation and content.
 */
export interface DynamicContextInput {
    /** Agent receiving the context */
    agentId: AgentId;
    /** Current channel */
    channelId: ChannelId;
    /** Current ORPAR phase (if active) */
    orparPhase?: string;
    /** Whether errors have occurred recently */
    hasRecentErrors?: boolean;
    /** Number of agents in the channel */
    channelAgentCount?: number;
    /** Current task ID (if any) */
    currentTaskId?: string;
    /** Current task title (if any) */
    currentTaskTitle?: string;
    /** Iteration count for the current task */
    iterationCount?: number;
    /** Total tokens used so far */
    totalTokens?: number;
    /** Model context window size */
    contextLimit?: number;
}

/**
 * A single dynamic context provider that can contribute content
 * to an agent's system prompt at runtime.
 */
export interface DynamicContextProviderEntry {
    /** Unique identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Priority (higher = injected first, 1–10) */
    priority: number;
    /** Whether this provider should activate given the current context */
    shouldActivate: (input: DynamicContextInput) => boolean;
    /** Generate the context content string to inject */
    getContent: (input: DynamicContextInput) => Promise<string>;
}

/**
 * Dynamic Context Registry — singleton
 *
 * Manages dynamic context providers and gathers their output
 * for injection into system prompts.
 */
export class DynamicContextRegistry {
    private static instance: DynamicContextRegistry | null = null;
    private providers = new Map<string, DynamicContextProviderEntry>();

    private constructor() {}

    /** Get singleton instance */
    public static getInstance(): DynamicContextRegistry {
        if (!DynamicContextRegistry.instance) {
            DynamicContextRegistry.instance = new DynamicContextRegistry();
        }
        return DynamicContextRegistry.instance;
    }

    /** Register a context provider */
    public register(provider: DynamicContextProviderEntry): void {
        this.providers.set(provider.id, provider);
        logger.debug('Dynamic context provider registered', {
            id: provider.id,
            name: provider.name,
            priority: provider.priority,
        });
    }

    /** Unregister a provider by ID */
    public unregister(id: string): boolean {
        return this.providers.delete(id);
    }

    /**
     * Gather context from all active providers, ordered by priority.
     * Returns a single string with all provider outputs joined,
     * or empty string if no providers are active.
     *
     * @param input - Current runtime context
     * @param tokenBudget - Max tokens for the combined output (optional soft cap)
     */
    public async gatherContext(
        input: DynamicContextInput,
        tokenBudget?: number,
    ): Promise<string> {
        // Sort by priority (highest first)
        const sorted = Array.from(this.providers.values())
            .sort((a, b) => b.priority - a.priority);

        const sections: string[] = [];
        let estimatedTokens = 0;

        for (const provider of sorted) {
            try {
                if (!provider.shouldActivate(input)) continue;

                const content = await provider.getContent(input);
                if (!content) continue;

                const contentTokens = estimateTokens(content);
                if (tokenBudget && estimatedTokens + contentTokens > tokenBudget) {
                    logger.debug('Dynamic context budget exhausted, skipping provider', {
                        providerId: provider.id,
                        estimatedTokens,
                        tokenBudget,
                    });
                    break;
                }

                sections.push(content);
                estimatedTokens += contentTokens;
            } catch (error) {
                logger.warn('Dynamic context provider failed', {
                    providerId: provider.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        if (sections.length > 0) {
            logger.debug('Dynamic context gathered', {
                activeProviders: sections.length,
                estimatedTokens,
            });
        }

        return sections.join('\n\n');
    }

    /** List all registered provider IDs */
    public listProviders(): string[] {
        return Array.from(this.providers.keys());
    }

    /** Get a provider by ID */
    public getProvider(id: string): DynamicContextProviderEntry | undefined {
        return this.providers.get(id);
    }

    /** Clear all providers (useful for testing) */
    public clear(): void {
        this.providers.clear();
    }
}
