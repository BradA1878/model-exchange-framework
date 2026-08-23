/**
 * The evidence formatters feed SystemLLM prompts that judge or challenge agent
 * work. They must show the model the real content, bounded the same way for
 * every consumer, and never present "nothing" as an empty section.
 */

import {
    EVIDENCE_CAPS,
    formatMessagesEvidence,
    formatToolCallsEvidence,
    serializeToolResult,
    truncateEvidence
} from '../../../src/server/socket/services/SystemLlmEvidence';

describe('SystemLlmEvidence', () => {
    it('truncates long text and says how much was cut', () => {
        const text = 'x'.repeat(50);
        expect(truncateEvidence(text, 50)).toBe(text);
        expect(truncateEvidence(text, 10)).toBe(`${'x'.repeat(10)}… [truncated 40 chars]`);
    });

    it('serializes tool results without dropping unserializable ones', () => {
        expect(serializeToolResult('plain')).toBe('plain');
        expect(serializeToolResult({ ok: true })).toBe('{"ok":true}');
        expect(serializeToolResult(undefined)).toBe('undefined');
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(serializeToolResult(circular)).toBe('[unserializable object]');
    });

    it('formats messages as [agentId] content lines and caps the count', () => {
        const messages = Array.from({ length: EVIDENCE_CAPS.messages + 3 }, (_, index) => ({
            agentId: `agent-${index}`,
            content: `message ${index}`
        }));
        const formatted = formatMessagesEvidence(messages);
        const lines = formatted.split('\n');

        expect(lines[0]).toBe('(3 earlier messages omitted)');
        expect(lines).toHaveLength(EVIDENCE_CAPS.messages + 1);
        expect(lines[1]).toBe('[agent-3] message 3');
        expect(lines[lines.length - 1]).toBe(`[agent-${EVIDENCE_CAPS.messages + 2}] message ${EVIDENCE_CAPS.messages + 2}`);
    });

    it('caps each message to the character budget', () => {
        const formatted = formatMessagesEvidence([
            { agentId: 'a', content: 'y'.repeat(EVIDENCE_CAPS.messageChars + 5) }
        ]);
        expect(formatted).toBe(`[a] ${'y'.repeat(EVIDENCE_CAPS.messageChars)}… [truncated 5 chars]`);
    });

    it('formats tool calls with their serialized results and caps both count and size', () => {
        const calls = Array.from({ length: EVIDENCE_CAPS.toolCalls + 1 }, (_, index) => ({
            agentId: 'worker',
            toolName: `tool_${index}`,
            result: { index }
        }));
        const formatted = formatToolCallsEvidence(calls);
        const lines = formatted.split('\n');

        expect(lines[0]).toBe('(1 earlier tool calls omitted)');
        expect(lines[1]).toBe('[worker] tool_1 -> {"index":1}');

        const big = formatToolCallsEvidence([
            { agentId: 'w', toolName: 'file_read', result: 'z'.repeat(EVIDENCE_CAPS.toolResultChars + 1) }
        ]);
        expect(big).toContain('… [truncated 1 chars]');
    });

    it('names an empty section instead of leaving it blank', () => {
        expect(formatMessagesEvidence([])).toBe('(no messages recorded)');
        expect(formatToolCallsEvidence([])).toBe('(no tool calls recorded)');
    });
});
