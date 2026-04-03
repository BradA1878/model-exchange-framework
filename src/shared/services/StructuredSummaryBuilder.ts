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
 * Structured Summary Builder
 *
 * Builds structured summaries from conversation history using
 * heuristic extraction (no LLM required). Produces summaries
 * with specific sections rather than flat text:
 *
 *   - Primary request / task description
 *   - Key decisions made
 *   - Tool executions (name + status + summary)
 *   - Errors encountered
 *   - Current state
 *   - Preserved user messages (verbatim)
 *   - Pending work
 *
 * When a SystemLLM is available, the summary can be enhanced;
 * but the heuristic version alone is far better than truncation.
 */

import { Logger } from '../utils/Logger';
import { estimateTokens } from '../utils/TokenEstimator';
import { ConversationMessage } from '../interfaces/ConversationMessage';

const logger = new Logger('info', 'StructuredSummaryBuilder', 'server');

/** A single tool execution record extracted from the conversation */
export interface ToolExecutionRecord {
    /** Tool name */
    name: string;
    /** Whether the execution succeeded */
    success: boolean;
    /** Brief summary of the result (first ~100 chars) */
    summary: string;
}

/** Structured summary with discrete sections */
export interface StructuredSummary {
    /** The original user/task request (first user or task message) */
    primaryRequest: string | null;
    /** Key decisions and reasoning extracted from assistant messages */
    keyDecisions: string[];
    /** Tool executions with name, status, and brief summary */
    toolExecutions: ToolExecutionRecord[];
    /** Error messages encountered during the conversation */
    errors: string[];
    /** Preserved user messages (verbatim) — user directives must not be lost */
    preservedUserMessages: string[];
    /** Current state indicators (latest ORPAR phase, active task, etc.) */
    currentState: string[];
    /** Pending/incomplete work indicators */
    pendingWork: string[];
    /** Total messages that were summarized */
    messagesSummarized: number;
    /** Sections included in this summary */
    sections: string[];
}

/**
 * Structured Summary Builder — singleton
 */
export class StructuredSummaryBuilder {
    private static instance: StructuredSummaryBuilder | null = null;

    private constructor() {}

    /** Get singleton instance */
    public static getInstance(): StructuredSummaryBuilder {
        if (!StructuredSummaryBuilder.instance) {
            StructuredSummaryBuilder.instance = new StructuredSummaryBuilder();
        }
        return StructuredSummaryBuilder.instance;
    }

    /**
     * Build a structured summary from conversation messages.
     * Uses heuristic extraction — no LLM call required.
     *
     * @param messages - Messages to summarize
     * @returns StructuredSummary with extracted sections
     */
    public buildSummary(messages: ConversationMessage[]): StructuredSummary {
        const summary: StructuredSummary = {
            primaryRequest: null,
            keyDecisions: [],
            toolExecutions: [],
            errors: [],
            preservedUserMessages: [],
            currentState: [],
            pendingWork: [],
            messagesSummarized: messages.length,
            sections: [],
        };

        for (const msg of messages) {
            switch (msg.role) {
                case 'user':
                    this.extractFromUserMessage(msg, summary);
                    break;
                case 'assistant':
                    this.extractFromAssistantMessage(msg, summary);
                    break;
                case 'tool':
                    this.extractFromToolResult(msg, summary);
                    break;
                case 'system':
                    this.extractFromSystemMessage(msg, summary);
                    break;
            }
        }

        // Build sections list for metadata
        if (summary.primaryRequest) summary.sections.push('primary_request');
        if (summary.keyDecisions.length > 0) summary.sections.push('key_decisions');
        if (summary.toolExecutions.length > 0) summary.sections.push('tool_executions');
        if (summary.errors.length > 0) summary.sections.push('errors');
        if (summary.preservedUserMessages.length > 0) summary.sections.push('preserved_user_messages');
        if (summary.currentState.length > 0) summary.sections.push('current_state');
        if (summary.pendingWork.length > 0) summary.sections.push('pending_work');

        logger.debug('Structured summary built', {
            messagesSummarized: summary.messagesSummarized,
            sectionsIncluded: summary.sections.length,
            toolExecutions: summary.toolExecutions.length,
            errors: summary.errors.length,
        });

        return summary;
    }

    /**
     * Format a StructuredSummary as a compact prompt string
     * suitable for injection into conversation history.
     *
     * @param summary - The structured summary to format
     * @returns Formatted prompt string
     */
    public formatAsPrompt(summary: StructuredSummary): string {
        const parts: string[] = ['<conversation-summary>'];

        if (summary.primaryRequest) {
            parts.push(`## Primary Request\n${summary.primaryRequest}`);
        }

        if (summary.preservedUserMessages.length > 0) {
            parts.push(`## User Directives (verbatim)\n${summary.preservedUserMessages.map(m => `- ${m}`).join('\n')}`);
        }

        if (summary.keyDecisions.length > 0) {
            parts.push(`## Key Decisions\n${summary.keyDecisions.map(d => `- ${d}`).join('\n')}`);
        }

        if (summary.toolExecutions.length > 0) {
            const toolLines = summary.toolExecutions.map(t =>
                `- ${t.name}: ${t.success ? 'success' : 'FAILED'} — ${t.summary}`
            );
            parts.push(`## Tool Executions\n${toolLines.join('\n')}`);
        }

        if (summary.errors.length > 0) {
            parts.push(`## Errors Encountered\n${summary.errors.map(e => `- ${e}`).join('\n')}`);
        }

        if (summary.currentState.length > 0) {
            parts.push(`## Current State\n${summary.currentState.map(s => `- ${s}`).join('\n')}`);
        }

        if (summary.pendingWork.length > 0) {
            parts.push(`## Pending Work\n${summary.pendingWork.map(p => `- ${p}`).join('\n')}`);
        }

        parts.push(`\n(Summarized ${summary.messagesSummarized} messages)`);
        parts.push('</conversation-summary>');

        return parts.join('\n\n');
    }

    /**
     * Estimate the token count of a formatted summary.
     */
    public estimateSummaryTokens(summary: StructuredSummary): number {
        const formatted = this.formatAsPrompt(summary);
        return estimateTokens(formatted);
    }

    // --- Extraction methods ---

    /** Extract primary request and preserved directives from user messages */
    private extractFromUserMessage(msg: ConversationMessage, summary: StructuredSummary): void {
        // First user message becomes the primary request (this method is only
        // called for role === 'user', so no additional role check needed)
        if (!summary.primaryRequest) {
            summary.primaryRequest = this.truncate(msg.content, 500);
        }

        // Preserve all user messages verbatim (truncated)
        if (msg.metadata?.contextLayer !== 'system' && msg.metadata?.contextLayer !== 'identity') {
            summary.preservedUserMessages.push(this.truncate(msg.content, 200));
        }
    }

    /** Extract key decisions and pending work from assistant messages */
    private extractFromAssistantMessage(msg: ConversationMessage, summary: StructuredSummary): void {
        const content = msg.content;

        // Extract decisions (lines starting with decision-like patterns)
        const decisionPatterns = [
            /(?:I (?:will|decided|chose|selected|picked))\s+(.+?)(?:\.|$)/gi,
            /(?:The (?:best|right|correct) approach is)\s+(.+?)(?:\.|$)/gi,
            /(?:Let's|Let me|Going to)\s+(.+?)(?:\.|$)/gi,
        ];
        for (const pattern of decisionPatterns) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
                if (match[1] && match[1].length > 10) {
                    summary.keyDecisions.push(this.truncate(match[1].trim(), 150));
                }
            }
        }

        // Cap key decisions to avoid bloat
        if (summary.keyDecisions.length > 10) {
            summary.keyDecisions = summary.keyDecisions.slice(-10);
        }

        // Extract pending work indicators
        const pendingPatterns = [
            /(?:still need to|remaining|TODO|next step|haven't yet)\s+(.+?)(?:\.|$)/gi,
            /(?:will do|will handle|will address)\s+(.+?)(?:\.|$)/gi,
        ];
        for (const pattern of pendingPatterns) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
                if (match[1] && match[1].length > 10) {
                    summary.pendingWork.push(this.truncate(match[1].trim(), 150));
                }
            }
        }

        // Cap pending work
        if (summary.pendingWork.length > 5) {
            summary.pendingWork = summary.pendingWork.slice(-5);
        }
    }

    /** Extract tool execution records from tool result messages */
    private extractFromToolResult(msg: ConversationMessage, summary: StructuredSummary): void {
        const toolName = msg.metadata?.toolName
            || msg.metadata?.tool_call_id?.split('_')[0]
            || 'unknown';

        const isError = msg.metadata?.isError === true
            || msg.metadata?.success === false
            || msg.content.toLowerCase().includes('error:');

        const record: ToolExecutionRecord = {
            name: toolName,
            success: !isError,
            summary: this.truncate(msg.content, 100),
        };

        summary.toolExecutions.push(record);

        // Cap tool executions to prevent summary bloat in long conversations
        if (summary.toolExecutions.length > 20) {
            summary.toolExecutions = summary.toolExecutions.slice(-20);
        }

        // Extract errors
        if (isError) {
            summary.errors.push(`${toolName}: ${this.truncate(msg.content, 200)}`);

            // Cap errors
            if (summary.errors.length > 10) {
                summary.errors = summary.errors.slice(-10);
            }
        }
    }

    /** Extract state information from system messages */
    private extractFromSystemMessage(msg: ConversationMessage, summary: StructuredSummary): void {
        const content = msg.content.toLowerCase();

        // ORPAR phase indicators
        const orparMatch = msg.content.match(/(?:phase|ORPAR):\s*(\w+)/i);
        if (orparMatch) {
            summary.currentState.push(`ORPAR phase: ${orparMatch[1]}`);
        }

        // Task state indicators
        if (content.includes('task assigned') || content.includes('task created')) {
            summary.currentState.push(this.truncate(msg.content, 100));
        }

        // Cap current state
        if (summary.currentState.length > 5) {
            summary.currentState = summary.currentState.slice(-5);
        }
    }

    /** Truncate a string to maxLength, adding ellipsis if truncated */
    private truncate(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }
}
