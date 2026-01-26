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
 * Prompt Segment Registry
 *
 * PHASE 4: System prompt optimization through progressive disclosure
 * Manages cached prompt segments with conditional inclusion
 */

import { Logger } from '../utils/Logger';
import { estimateTokens } from '../utils/TokenEstimator';
import { AgentContext } from '../interfaces/AgentContext';

const logger = new Logger('info', 'PromptSegmentRegistry', 'server');

/**
 * A prompt segment with conditional inclusion logic
 */
export interface PromptSegment {
    id: string;
    content: string;
    tokenCount: number;
    priority: number;  // Higher = more important (1-10)
    conditions: (context: SegmentContext) => boolean;
    category: 'core' | 'orpar' | 'collaboration' | 'tools' | 'error-handling' | 'mxp' | 'optional';
}

/**
 * Context for evaluating segment conditions
 */
export interface SegmentContext {
    hasControlLoopTools?: boolean;
    isMultiAgentChannel?: boolean;
    hasErrorOccurred?: boolean;
    isMxpEnabled?: boolean;
    condensedMode?: boolean;
    availableTools?: string[];
    channelAgentCount?: number;
}

/**
 * Registry configuration
 */
export interface PromptSegmentRegistryConfig {
    condensedMode?: boolean;
    maxSystemPromptTokens?: number;
}

/**
 * Prompt Segment Registry - Manages conditional prompt segments
 */
export class PromptSegmentRegistry {
    private static instance: PromptSegmentRegistry | null = null;
    private segments = new Map<string, PromptSegment>();
    private config: PromptSegmentRegistryConfig = {
        condensedMode: false,
        maxSystemPromptTokens: 2500
    };

    private constructor() {
        this.registerDefaultSegments();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): PromptSegmentRegistry {
        if (!PromptSegmentRegistry.instance) {
            PromptSegmentRegistry.instance = new PromptSegmentRegistry();
        }
        return PromptSegmentRegistry.instance;
    }

    /**
     * Update configuration
     */
    public configure(config: Partial<PromptSegmentRegistryConfig>): void {
        this.config = { ...this.config, ...config };
        logger.info('Prompt segment registry configured', this.config);
    }

    /**
     * Register a prompt segment
     */
    public register(segment: PromptSegment): void {
        // Calculate token count if not provided
        if (!segment.tokenCount) {
            segment.tokenCount = estimateTokens(segment.content);
        }

        this.segments.set(segment.id, segment);
        logger.debug('Prompt segment registered', {
            id: segment.id,
            category: segment.category,
            priority: segment.priority,
            tokens: segment.tokenCount
        });
    }

    /**
     * Get applicable segments based on context and budget
     */
    public getApplicableSegments(
        context: SegmentContext,
        budget: number
    ): PromptSegment[] {
        const applicable: PromptSegment[] = [];
        let totalTokens = 0;

        // Sort segments by priority (higher first)
        const sortedSegments = Array.from(this.segments.values())
            .sort((a, b) => b.priority - a.priority);

        for (const segment of sortedSegments) {
            // Check if segment's conditions are met (with error handling)
            try {
                if (!segment.conditions(context)) {
                    continue;
                }
            } catch (error) {
                logger.warn('Segment condition evaluation failed', {
                    segmentId: segment.id,
                    error: error instanceof Error ? error.message : String(error)
                });
                continue;
            }

            // Check if we have budget for this segment
            if (totalTokens + segment.tokenCount <= budget) {
                applicable.push(segment);
                totalTokens += segment.tokenCount;
            } else {
                logger.debug('Segment excluded due to budget', {
                    id: segment.id,
                    tokens: segment.tokenCount,
                    remaining: budget - totalTokens
                });
            }
        }

        logger.info('Applicable segments selected', {
            count: applicable.length,
            totalTokens,
            budget,
            utilizationPercent: ((totalTokens / budget) * 100).toFixed(1)
        });

        return applicable;
    }

    /**
     * Build system prompt from applicable segments
     */
    public buildSystemPrompt(context: SegmentContext, budget?: number): string {
        const maxBudget = budget || this.config.maxSystemPromptTokens || 2500;
        const segments = this.getApplicableSegments(context, maxBudget);

        // Group segments by category for organized output
        const grouped = new Map<string, PromptSegment[]>();
        for (const segment of segments) {
            if (!grouped.has(segment.category)) {
                grouped.set(segment.category, []);
            }
            grouped.get(segment.category)!.push(segment);
        }

        // Build prompt sections
        const sections: string[] = [];

        // Core sections always come first
        if (grouped.has('core')) {
            sections.push(...grouped.get('core')!.map(s => s.content));
        }

        // Other sections in priority order
        const orderedCategories = ['orpar', 'collaboration', 'tools', 'mxp', 'error-handling', 'optional'];
        for (const category of orderedCategories) {
            if (grouped.has(category)) {
                sections.push(...grouped.get(category)!.map(s => s.content));
            }
        }

        return sections.join('\n\n');
    }

    /**
     * Register default framework segments
     */
    private registerDefaultSegments(): void {
        // Core framework behavior (always included)
        this.register({
            id: 'core-framework',
            content: `# MXF Agent Framework

You are operating within the Model Exchange Framework (MXF), a multi-agent collaboration system.
Your actions are tracked, and you can collaborate with other agents through structured communication.`,
            tokenCount: 0, // Will be calculated
            priority: 10,
            category: 'core',
            conditions: () => true // Always include
        });

        // ORPAR guidelines (only if control loop tools present)
        this.register({
            id: 'orpar-cycle',
            content: `## ORPAR Cognitive Cycle

When control loop tools are available, follow the ORPAR cycle:
- Observe: Gather context and data
- Reason: Analyze and understand
- Plan: Decide on actions
- Act: Execute using tools
- Reflect: Evaluate outcomes`,
            tokenCount: 0,
            priority: 8,
            category: 'orpar',
            conditions: (ctx) => ctx.hasControlLoopTools || false
        });

        // Collaboration patterns (only in multi-agent channels)
        this.register({
            id: 'collaboration-patterns',
            content: `## Collaboration Guidelines

You are in a multi-agent channel. Coordinate effectively:
- Use agent_communicate for direct messages
- Use agent_broadcast for group announcements
- Check agent_list_active to see who's available
- Use coordination_propose for formal collaboration`,
            tokenCount: 0,
            priority: 7,
            category: 'collaboration',
            conditions: (ctx) => ctx.isMultiAgentChannel || false
        });

        // Tool usage guidelines (condensed in condensed mode)
        this.register({
            id: 'tool-guidelines-full',
            content: `## Tool Usage

Tools are your primary means of action:
- Always validate tool parameters before calling
- Handle tool errors gracefully
- Use tools_recommend for suggestions
- Check tools_validate before execution
- Document tool usage in your reasoning`,
            tokenCount: 0,
            priority: 6,
            category: 'tools',
            conditions: (ctx) => !ctx.condensedMode
        });

        this.register({
            id: 'tool-guidelines-condensed',
            content: `## Tool Usage

Use tools for all actions. Validate parameters. Handle errors.`,
            tokenCount: 0,
            priority: 6,
            category: 'tools',
            conditions: (ctx) => ctx.condensedMode || false
        });

        // Error handling (only after first error)
        this.register({
            id: 'error-handling',
            content: `## Error Recovery

When errors occur:
- Use error_diagnose to analyze failures
- Use tools_recommend_on_error for alternatives
- Document error patterns for learning
- Don't repeat failed actions without modification`,
            tokenCount: 0,
            priority: 5,
            category: 'error-handling',
            conditions: (ctx) => ctx.hasErrorOccurred || false
        });

        // MXP guidance (only if MXP enabled)
        this.register({
            id: 'mxp-protocol',
            content: `## MXP Protocol

MXP provides structured, encrypted communication:
- Use for sensitive data exchange
- Automatic detection and parsing
- AES-256-GCM encryption
- Natural language conversion available`,
            tokenCount: 0,
            priority: 4,
            category: 'mxp',
            conditions: (ctx) => ctx.isMxpEnabled || false
        });

        logger.info('Default prompt segments registered', {
            count: this.segments.size
        });
    }

    /**
     * Get segment by ID
     */
    public getSegment(id: string): PromptSegment | undefined {
        return this.segments.get(id);
    }

    /**
     * List all registered segments
     */
    public listSegments(): PromptSegment[] {
        return Array.from(this.segments.values());
    }

    /**
     * Remove segment by ID
     */
    public unregister(id: string): boolean {
        return this.segments.delete(id);
    }

    /**
     * Clear all segments (useful for testing)
     */
    public clear(): void {
        this.segments.clear();
    }

    /**
     * Reset to default segments
     */
    public reset(): void {
        this.clear();
        this.registerDefaultSegments();
    }
}
