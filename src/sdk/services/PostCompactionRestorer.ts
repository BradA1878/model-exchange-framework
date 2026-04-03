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
 * Post-Compaction Restorer
 *
 * After context compaction drops messages, critical state can be lost.
 * This service restores artifacts that must survive compaction:
 *   - Current task state (title, description, status)
 *   - Active agents in the channel
 *   - ORPAR cognitive cycle phase
 *   - Recent errors (for error-recovery context)
 *   - Tool availability summary
 *
 * Each artifact has a priority and an async content provider.
 * Restoration messages are injected as system-role messages with
 * metadata.contextLayer = 'system' and metadata.ephemeral = true.
 */

import { Logger } from '../../shared/utils/Logger';
import { estimateTokens } from '../../shared/utils/TokenEstimator';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { AgentId, ChannelId } from '../../shared/types/ChannelContext';

const logger = new Logger('info', 'PostCompactionRestorer', 'client');

/** A registered restoration artifact */
export interface RestorationArtifact {
    /** Unique name (e.g., 'task_state', 'orpar_phase') */
    name: string;
    /** Priority (1–10, higher = restored first) */
    priority: number;
    /** Async function that produces the restoration content, or null if nothing to restore */
    getContent: (agentId: AgentId, channelId: ChannelId) => Promise<string | null>;
}

/** Result of a restoration pass */
export interface RestorationResult {
    /** Messages to inject into the conversation */
    messages: ConversationMessage[];
    /** Names of artifacts that were restored */
    artifactNames: string[];
    /** Total tokens added by restoration */
    tokensAdded: number;
}

/**
 * Post-Compaction Restorer — singleton
 */
export class PostCompactionRestorer {
    private static instance: PostCompactionRestorer | null = null;
    private artifacts = new Map<string, RestorationArtifact>();

    private constructor() {}

    /** Get singleton instance */
    public static getInstance(): PostCompactionRestorer {
        if (!PostCompactionRestorer.instance) {
            PostCompactionRestorer.instance = new PostCompactionRestorer();
        }
        return PostCompactionRestorer.instance;
    }

    /** Register a restoration artifact */
    public registerArtifact(artifact: RestorationArtifact): void {
        this.artifacts.set(artifact.name, artifact);
        logger.debug('Restoration artifact registered', {
            name: artifact.name,
            priority: artifact.priority,
        });
    }

    /** Unregister an artifact */
    public unregisterArtifact(name: string): boolean {
        return this.artifacts.delete(name);
    }

    /**
     * Restore all applicable artifacts after compaction.
     * Returns system-role messages to inject into the conversation.
     *
     * @param agentId - Agent whose context was compacted
     * @param channelId - Channel context
     * @param tokenBudget - Max total tokens for restoration messages (optional)
     */
    public async restore(
        agentId: AgentId,
        channelId: ChannelId,
        tokenBudget?: number,
    ): Promise<RestorationResult> {
        const now = Date.now();
        const sorted = Array.from(this.artifacts.values())
            .sort((a, b) => b.priority - a.priority);

        const messages: ConversationMessage[] = [];
        const artifactNames: string[] = [];
        let tokensAdded = 0;

        for (const artifact of sorted) {
            try {
                const content = await artifact.getContent(agentId, channelId);
                if (!content) continue;

                const tokens = estimateTokens(content);
                // Skip artifacts that don't fit the remaining budget, but continue
                // checking lower-priority artifacts — a smaller one may still fit
                if (tokenBudget && tokensAdded + tokens > tokenBudget) {
                    logger.debug('Artifact exceeds remaining budget, skipping', {
                        artifact: artifact.name,
                        artifactTokens: tokens,
                        tokensAdded,
                        tokenBudget,
                    });
                    continue;
                }

                messages.push({
                    id: `restoration-${artifact.name}-${now}`,
                    role: 'system',
                    content: `<system-reminder>Restored after compaction — ${artifact.name}:\n${content}</system-reminder>`,
                    timestamp: now,
                    metadata: {
                        contextLayer: 'system',
                        messageType: 'system-notice',
                        ephemeral: true,
                        restorationArtifact: artifact.name,
                    },
                });

                artifactNames.push(artifact.name);
                tokensAdded += tokens;
            } catch (error) {
                logger.warn('Restoration artifact failed', {
                    artifact: artifact.name,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        if (artifactNames.length > 0) {
            logger.info('Post-compaction restoration completed', {
                agentId,
                artifactsRestored: artifactNames.length,
                artifactNames,
                tokensAdded,
            });
        }

        return { messages, artifactNames, tokensAdded };
    }

    /** List all registered artifact names */
    public listArtifacts(): string[] {
        return Array.from(this.artifacts.keys());
    }

    /** Clear all artifacts (useful for testing) */
    public clear(): void {
        this.artifacts.clear();
    }
}
