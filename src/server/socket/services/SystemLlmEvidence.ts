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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Evidence formatting for SystemLLM prompts that judge or challenge agent work.
 *
 * The completion judge and the stance challenge prompts both need the same
 * thing: what agents actually said and what their tools actually returned,
 * bounded so a long task cannot blow up a prompt. The caps live here so every
 * consumer truncates the same way, and the formatters are pure so they can be
 * unit-tested without a service.
 */

/** Bounds on how much evidence a single prompt carries. */
export const EVIDENCE_CAPS = {
    /** Most recent messages included. */
    messages: 20,
    /** Characters kept per message. */
    messageChars: 400,
    /** Most recent tool calls included. */
    toolCalls: 20,
    /** Characters kept per serialized tool result. */
    toolResultChars: 300,
    /** Characters kept for a free-text artifact (a summary, a plan, a reflection). */
    artifactChars: 2000
} as const;

export interface EvidenceMessage {
    agentId: string;
    content: string;
}

export interface EvidenceToolCall {
    agentId: string;
    toolName: string;
    result: unknown;
}

/**
 * Truncate text to a character budget, marking the cut so the model knows
 * it is not seeing the whole thing.
 */
export function truncateEvidence(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    return `${text.slice(0, maxChars)}… [truncated ${text.length - maxChars} chars]`;
}

/**
 * Serialize a tool result for a prompt. Strings are kept as-is; anything else
 * is JSON. A value that cannot be serialized is named rather than dropped.
 */
export function serializeToolResult(result: unknown): string {
    if (typeof result === 'string') {
        return result;
    }
    if (result === undefined) {
        return 'undefined';
    }
    try {
        return JSON.stringify(result);
    } catch {
        return `[unserializable ${typeof result}]`;
    }
}

/**
 * Format the most recent messages as `[agentId] content` lines.
 * Returns a line saying so when there are none, so the prompt never has an
 * empty section the model might read as "nothing happened".
 */
export function formatMessagesEvidence(messages: ReadonlyArray<EvidenceMessage>): string {
    if (messages.length === 0) {
        return '(no messages recorded)';
    }
    const recent = messages.slice(-EVIDENCE_CAPS.messages);
    const omitted = messages.length - recent.length;
    const lines = recent.map(message =>
        `[${message.agentId}] ${truncateEvidence(message.content, EVIDENCE_CAPS.messageChars)}`
    );
    if (omitted > 0) {
        lines.unshift(`(${omitted} earlier messages omitted)`);
    }
    return lines.join('\n');
}

/**
 * Format the most recent tool calls as `[agentId] toolName -> result` lines.
 */
export function formatToolCallsEvidence(toolCalls: ReadonlyArray<EvidenceToolCall>): string {
    if (toolCalls.length === 0) {
        return '(no tool calls recorded)';
    }
    const recent = toolCalls.slice(-EVIDENCE_CAPS.toolCalls);
    const omitted = toolCalls.length - recent.length;
    const lines = recent.map(call =>
        `[${call.agentId}] ${call.toolName} -> ` +
        truncateEvidence(serializeToolResult(call.result), EVIDENCE_CAPS.toolResultChars)
    );
    if (omitted > 0) {
        lines.unshift(`(${omitted} earlier tool calls omitted)`);
    }
    return lines.join('\n');
}
