/**
 * Unit tests for ToolResultMicrocompactor.
 * Validates tool result stripping, threshold gating, preservation of
 * recent messages, idempotency, and immutability of input.
 */

import { ToolResultMicrocompactor } from '../../../src/sdk/services/ToolResultMicrocompactor';
import { ConversationMessage } from '../../../src/shared/interfaces/ConversationMessage';

/** Helper to create a ConversationMessage with sensible defaults */
function msg(overrides: Partial<ConversationMessage> & { role: ConversationMessage['role']; content: string }): ConversationMessage {
    return {
        id: overrides.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
        role: overrides.role,
        content: overrides.content,
        timestamp: overrides.timestamp ?? Date.now(),
        metadata: overrides.metadata,
        tool_calls: overrides.tool_calls,
    };
}

/** Build a tool-role message with large content to push over token thresholds */
function toolMsg(content: string, metadata?: Record<string, any>): ConversationMessage {
    return msg({ role: 'tool', content, metadata });
}

/** Build a conversation that has enough tokens to exceed a given threshold */
function buildConversation(toolResultCount: number, toolContentSize: number = 500): ConversationMessage[] {
    const messages: ConversationMessage[] = [
        msg({ role: 'user', content: 'Please do the task.' }),
        msg({ role: 'assistant', content: 'I will use tools to complete this.' }),
    ];
    for (let i = 0; i < toolResultCount; i++) {
        messages.push(
            msg({ role: 'assistant', content: `Calling tool ${i}`, tool_calls: [{ id: `call_${i}`, type: 'function', function: { name: `tool_${i}` } }] }),
            toolMsg('x'.repeat(toolContentSize), { toolName: `tool_${i}`, tool_call_id: `call_${i}`, success: true }),
        );
    }
    messages.push(msg({ role: 'assistant', content: 'All done.' }));
    return messages;
}

describe('ToolResultMicrocompactor', () => {
    let compactor: ToolResultMicrocompactor;

    beforeAll(() => {
        compactor = ToolResultMicrocompactor.getInstance();
    });

    // -- singleton --
    it('returns the same instance from getInstance()', () => {
        expect(ToolResultMicrocompactor.getInstance()).toBe(compactor);
    });

    // -- below threshold --
    describe('when below tokenThreshold', () => {
        it('returns messages unchanged and wasApplied = false', () => {
            const messages = [
                msg({ role: 'user', content: 'hi' }),
                toolMsg('short result', { toolName: 'echo' }),
            ];
            const result = compactor.compact(messages, 999_999);
            expect(result.wasApplied).toBe(false);
            expect(result.toolResultsStripped).toBe(0);
            expect(result.charsRemoved).toBe(0);
            expect(result.tokensBefore).toBe(result.tokensAfter);
            // Same reference when not applied
            expect(result.messages).toBe(messages);
        });
    });

    // -- stripping behavior --
    describe('stripping tool results', () => {
        it('replaces tool-role message content with summary placeholder', () => {
            const conversation = buildConversation(3, 600);
            // Use threshold 0 to force compaction; preserve last 1 message only
            const result = compactor.compact(conversation, 0, 1);
            expect(result.wasApplied).toBe(true);

            const strippedTools = result.messages.filter(
                m => m.role === 'tool' && m.content.startsWith('[Tool result:'),
            );
            // All tool messages except those in the preserved tail should be stripped
            expect(strippedTools.length).toBeGreaterThan(0);

            // Verify placeholder format: [Tool result: <name> - <status> - <N chars removed>]
            for (const m of strippedTools) {
                expect(m.content).toMatch(/^\[Tool result: .+ - (success|error) - \d+ chars removed\]$/);
            }
        });

        it('preserves non-tool messages (user, assistant, system)', () => {
            const conversation = [
                msg({ role: 'system', content: 'System instructions' }),
                msg({ role: 'user', content: 'Do something' }),
                msg({ role: 'assistant', content: 'Sure' }),
                toolMsg('big result '.repeat(100), { toolName: 'readFile' }),
                msg({ role: 'assistant', content: 'Done' }),
            ];
            const result = compactor.compact(conversation, 0, 0);
            // Non-tool messages should have unchanged content
            expect(result.messages[0].content).toBe('System instructions');
            expect(result.messages[1].content).toBe('Do something');
            expect(result.messages[2].content).toBe('Sure');
            expect(result.messages[4].content).toBe('Done');
        });
    });

    // -- preserve recent messages --
    describe('preserveRecentCount', () => {
        it('leaves the last N messages untouched', () => {
            const conversation = buildConversation(5, 400);
            // Preserve last 3 messages — those should NOT be stripped
            const result = compactor.compact(conversation, 0, 3);
            const lastThree = result.messages.slice(-3);

            for (const m of lastThree) {
                if (m.role === 'tool') {
                    expect(m.content).not.toMatch(/^\[Tool result:/);
                }
            }
        });

        it('defaults preserveRecentCount to 10', () => {
            // Build conversation with 12 messages total (some tool msgs in the old region)
            const conversation = buildConversation(6, 300); // 2 + 6*2 + 1 = 15 messages
            const result = compactor.compact(conversation, 0);
            // Only messages at index < 15-10 = 5 are eligible for stripping
            const eligible = result.messages.slice(0, 5);
            const strippedCount = eligible.filter(m => m.role === 'tool' && m.content.startsWith('[Tool result:')).length;
            // There should be at least one tool result in the eligible zone
            const toolsInZone = conversation.slice(0, 5).filter(m => m.role === 'tool').length;
            expect(strippedCount).toBe(toolsInZone);
        });
    });

    // -- tool_call_id preservation --
    describe('tool_call_id preservation', () => {
        it('keeps tool_call_id in metadata after stripping', () => {
            const messages = [
                msg({ role: 'assistant', content: 'calling', tool_calls: [{ id: 'call_abc123' }] }),
                toolMsg('Result data here '.repeat(50), { tool_call_id: 'call_abc123', toolName: 'readFile' }),
            ];
            const result = compactor.compact(messages, 0, 0);
            const toolResult = result.messages.find(m => m.role === 'tool')!;
            expect(toolResult.metadata?.tool_call_id).toBe('call_abc123');
        });
    });

    // -- idempotency --
    describe('idempotency', () => {
        it('does not re-strip already-stripped messages', () => {
            const messages = [
                toolMsg('[Tool result: readFile - success - 500 chars removed]', { toolName: 'readFile', microcompacted: true }),
            ];
            const result = compactor.compact(messages, 0, 0);
            // Already-stripped message should pass through unchanged
            expect(result.messages[0].content).toBe('[Tool result: readFile - success - 500 chars removed]');
            expect(result.toolResultsStripped).toBe(0);
            expect(result.charsRemoved).toBe(0);
        });

        it('double-compacting produces the same result', () => {
            const conversation = buildConversation(4, 500);
            const first = compactor.compact(conversation, 0, 0);
            const second = compactor.compact(first.messages, 0, 0);
            expect(second.toolResultsStripped).toBe(0);
            expect(second.charsRemoved).toBe(0);
            expect(second.messages.map(m => m.content)).toEqual(first.messages.map(m => m.content));
        });
    });

    // -- compactAll --
    describe('compactAll', () => {
        it('strips ALL tool results regardless of recency', () => {
            const conversation = buildConversation(3, 400);
            const result = compactor.compactAll(conversation);
            const toolMessages = result.messages.filter(m => m.role === 'tool');
            for (const m of toolMessages) {
                expect(m.content).toMatch(/^\[Tool result:/);
            }
            expect(result.toolResultsStripped).toBe(3);
        });
    });

    // -- counters --
    describe('counters', () => {
        it('correctly counts toolResultsStripped', () => {
            const conversation = buildConversation(5, 300);
            const result = compactor.compact(conversation, 0, 0);
            expect(result.toolResultsStripped).toBe(5);
        });

        it('correctly counts charsRemoved', () => {
            const contentSize = 400;
            const conversation = [
                toolMsg('A'.repeat(contentSize), { toolName: 'toolA' }),
            ];
            const result = compactor.compact(conversation, 0, 0);
            // charsRemoved = originalLength - replacement.length
            const replacement = result.messages[0].content;
            expect(result.charsRemoved).toBe(contentSize - replacement.length);
        });
    });

    // -- immutability --
    describe('immutability', () => {
        it('does not mutate the original messages array', () => {
            const original = buildConversation(3, 500);
            const originalContents = original.map(m => m.content);
            compactor.compact(original, 0, 0);
            // Original array contents should be unchanged
            expect(original.map(m => m.content)).toEqual(originalContents);
        });

        it('does not mutate individual message objects', () => {
            const toolMessage = toolMsg('Some big result '.repeat(50), { toolName: 'test', success: true });
            const originalContent = toolMessage.content;
            compactor.compact([toolMessage], 0, 0);
            expect(toolMessage.content).toBe(originalContent);
        });
    });

    // -- status extraction --
    describe('status extraction', () => {
        it('extracts error status from metadata.isError', () => {
            const messages = [
                toolMsg('Something went wrong internally', { toolName: 'failTool', isError: true }),
            ];
            const result = compactor.compact(messages, 0, 0);
            expect(result.messages[0].content).toContain('error');
        });

        it('extracts error status from metadata.success = false', () => {
            const messages = [
                toolMsg('No luck with that', { toolName: 'failTool', success: false }),
            ];
            const result = compactor.compact(messages, 0, 0);
            expect(result.messages[0].content).toContain('error');
        });

        it('extracts error status from content heuristics', () => {
            const messages = [
                toolMsg('Error: file not found at /some/path', { toolName: 'readFile' }),
            ];
            const result = compactor.compact(messages, 0, 0);
            expect(result.messages[0].content).toContain('error');
        });

        it('extracts success status for normal results', () => {
            const messages = [
                toolMsg('File contents: hello world', { toolName: 'readFile', success: true }),
            ];
            const result = compactor.compact(messages, 0, 0);
            expect(result.messages[0].content).toContain('success');
        });
    });

    // -- tool name extraction --
    describe('tool name extraction', () => {
        it('extracts tool name from metadata.toolName', () => {
            const messages = [
                toolMsg('result data', { toolName: 'mySpecialTool' }),
            ];
            const result = compactor.compact(messages, 0, 0);
            expect(result.messages[0].content).toContain('mySpecialTool');
        });

        it('falls back to "unknown" when only tool_call_id is present (IDs do not encode tool names)', () => {
            const messages = [
                toolMsg('some data', { tool_call_id: 'call_abc123xyz' }),
            ];
            const result = compactor.compact(messages, 0, 0);
            // tool_call_id is not used for name extraction — falls back to unknown
            expect(result.messages[0].content).toContain('unknown');
        });

        it('uses "unknown" when no tool name is available', () => {
            // Content must NOT match the extractToolName regex patterns
            // (e.g., "Result <word>" would be parsed as a tool name)
            const messages = [
                toolMsg('some arbitrary output with no tool name clues'),
            ];
            const result = compactor.compact(messages, 0, 0);
            expect(result.messages[0].content).toContain('unknown');
        });
    });

    // -- microcompacted metadata flag --
    describe('metadata flags', () => {
        it('sets microcompacted flag and originalContentLength on stripped messages', () => {
            const originalContent = 'A'.repeat(300);
            const messages = [toolMsg(originalContent, { toolName: 'test' })];
            const result = compactor.compact(messages, 0, 0);
            const stripped = result.messages[0];
            expect(stripped.metadata?.microcompacted).toBe(true);
            expect(stripped.metadata?.originalContentLength).toBe(300);
        });
    });
});
