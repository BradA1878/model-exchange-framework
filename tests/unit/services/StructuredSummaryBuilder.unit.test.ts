/**
 * Unit tests for StructuredSummaryBuilder.
 * Validates heuristic extraction of structured summaries from
 * conversation history, prompt formatting, and token estimation.
 */

import { StructuredSummaryBuilder } from '../../../src/shared/services/StructuredSummaryBuilder';
import { ConversationMessage } from '../../../src/shared/interfaces/ConversationMessage';

/** Helper to create a ConversationMessage */
function msg(role: ConversationMessage['role'], content: string, metadata?: Record<string, any>): ConversationMessage {
    return {
        id: `msg-${Math.random().toString(36).slice(2, 8)}`,
        role,
        content,
        timestamp: Date.now(),
        metadata,
    };
}

describe('StructuredSummaryBuilder', () => {
    let builder: StructuredSummaryBuilder;

    beforeAll(() => {
        builder = StructuredSummaryBuilder.getInstance();
    });

    // -- singleton --
    it('returns the same instance from getInstance()', () => {
        expect(StructuredSummaryBuilder.getInstance()).toBe(builder);
    });

    // -- empty input --
    describe('empty input', () => {
        it('produces an empty summary with no sections', () => {
            const summary = builder.buildSummary([]);
            expect(summary.primaryRequest).toBeNull();
            expect(summary.keyDecisions).toEqual([]);
            expect(summary.toolExecutions).toEqual([]);
            expect(summary.errors).toEqual([]);
            expect(summary.preservedUserMessages).toEqual([]);
            expect(summary.currentState).toEqual([]);
            expect(summary.pendingWork).toEqual([]);
            expect(summary.messagesSummarized).toBe(0);
            expect(summary.sections).toEqual([]);
        });
    });

    // -- primaryRequest --
    describe('primaryRequest extraction', () => {
        it('extracts primaryRequest from first user message', () => {
            const messages = [
                msg('user', 'Write a function that sorts an array'),
                msg('assistant', 'Sure, I will write that.'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.primaryRequest).toBe('Write a function that sorts an array');
        });

        it('extracts primaryRequest from task-description metadata', () => {
            const messages = [
                msg('system', 'You are an agent.'),
                msg('user', 'Implement the sorting feature', { messageType: 'task-description' }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.primaryRequest).toBe('Implement the sorting feature');
        });

        it('truncates long primary requests', () => {
            const longRequest = 'A'.repeat(600);
            const messages = [msg('user', longRequest)];
            const summary = builder.buildSummary(messages);
            expect(summary.primaryRequest!.length).toBeLessThanOrEqual(500);
            expect(summary.primaryRequest!.endsWith('...')).toBe(true);
        });
    });

    // -- preservedUserMessages --
    describe('preserved user messages', () => {
        it('preserves all user messages verbatim', () => {
            const messages = [
                msg('user', 'First instruction'),
                msg('assistant', 'OK'),
                msg('user', 'Second instruction'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.preservedUserMessages).toContain('First instruction');
            expect(summary.preservedUserMessages).toContain('Second instruction');
        });

        it('excludes system-layer and identity-layer user messages', () => {
            const messages = [
                msg('user', 'System config data', { contextLayer: 'system' }),
                msg('user', 'Identity config', { contextLayer: 'identity' }),
                msg('user', 'Real user request'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.preservedUserMessages).toEqual(['Real user request']);
        });
    });

    // -- toolExecutions --
    describe('tool execution extraction', () => {
        it('extracts tool execution records with name and success status', () => {
            const messages = [
                msg('tool', 'File contents: hello world', { toolName: 'readFile', success: true }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.toolExecutions).toHaveLength(1);
            expect(summary.toolExecutions[0].name).toBe('readFile');
            expect(summary.toolExecutions[0].success).toBe(true);
            expect(summary.toolExecutions[0].summary).toContain('File contents');
        });

        it('extracts tool name from tool_call_id prefix', () => {
            const messages = [
                msg('tool', 'result data', { tool_call_id: 'writeFile_xyz' }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.toolExecutions[0].name).toBe('writeFile');
        });

        it('uses "unknown" when no tool name available', () => {
            const messages = [msg('tool', 'some result')];
            const summary = builder.buildSummary(messages);
            expect(summary.toolExecutions[0].name).toBe('unknown');
        });

        it('truncates long tool result summaries', () => {
            const messages = [
                msg('tool', 'R'.repeat(200), { toolName: 'bigTool' }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.toolExecutions[0].summary.length).toBeLessThanOrEqual(100);
        });
    });

    // -- errors --
    describe('error extraction', () => {
        it('identifies errors from isError metadata', () => {
            const messages = [
                msg('tool', 'Something broke', { toolName: 'failTool', isError: true }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.errors).toHaveLength(1);
            expect(summary.errors[0]).toContain('failTool');
        });

        it('identifies errors from success=false metadata', () => {
            const messages = [
                msg('tool', 'Could not connect', { toolName: 'httpCall', success: false }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.errors).toHaveLength(1);
        });

        it('identifies errors from content heuristic (error:)', () => {
            const messages = [
                msg('tool', 'Error: file not found', { toolName: 'readFile' }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.errors).toHaveLength(1);
            expect(summary.toolExecutions[0].success).toBe(false);
        });

        it('does not flag successful results as errors', () => {
            const messages = [
                msg('tool', 'File written successfully', { toolName: 'writeFile', success: true }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.errors).toHaveLength(0);
        });
    });

    // -- keyDecisions --
    describe('key decisions extraction', () => {
        it('extracts "I will" decisions from assistant messages', () => {
            const messages = [
                msg('assistant', 'I will use the readFile tool to check the contents of the configuration.'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.keyDecisions.length).toBeGreaterThanOrEqual(1);
            expect(summary.keyDecisions[0]).toContain('readFile');
        });

        it('extracts "Let\'s" decisions from assistant messages', () => {
            const messages = [
                msg('assistant', "Let's start by analyzing the data structure in detail."),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.keyDecisions.length).toBeGreaterThanOrEqual(1);
        });

        it('extracts "decided" decisions from assistant messages', () => {
            const messages = [
                msg('assistant', 'I decided to refactor the module into smaller components.'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.keyDecisions.length).toBeGreaterThanOrEqual(1);
        });

        it('caps key decisions to 10', () => {
            // Generate many assistant messages with decisions
            const messages = Array.from({ length: 15 }, (_, i) =>
                msg('assistant', `I will perform action number ${i} on the system now.`),
            );
            const summary = builder.buildSummary(messages);
            expect(summary.keyDecisions.length).toBeLessThanOrEqual(10);
        });

        it('ignores very short decision matches (< 10 chars)', () => {
            const messages = [
                msg('assistant', 'I will do it.'), // "do it" is only 5 chars — too short
            ];
            const summary = builder.buildSummary(messages);
            // Short matches should be filtered out
            const shortDecisions = summary.keyDecisions.filter(d => d.length < 10);
            expect(shortDecisions).toHaveLength(0);
        });
    });

    // -- pendingWork --
    describe('pending work extraction', () => {
        it('extracts "still need to" patterns', () => {
            const messages = [
                msg('assistant', 'I still need to implement the validation layer for inputs.'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.pendingWork.length).toBeGreaterThanOrEqual(1);
        });

        it('extracts "TODO" patterns', () => {
            const messages = [
                msg('assistant', 'TODO update the configuration file with new settings.'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.pendingWork.length).toBeGreaterThanOrEqual(1);
        });

        it('caps pending work to 5', () => {
            const messages = Array.from({ length: 10 }, (_, i) =>
                msg('assistant', `I still need to handle edge case number ${i} in the system.`),
            );
            const summary = builder.buildSummary(messages);
            expect(summary.pendingWork.length).toBeLessThanOrEqual(5);
        });
    });

    // -- currentState (ORPAR phase) --
    describe('current state / ORPAR phase', () => {
        it('extracts ORPAR phase from system messages', () => {
            const messages = [
                msg('system', 'ORPAR phase: observe'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.currentState.length).toBeGreaterThanOrEqual(1);
            expect(summary.currentState.some(s => s.includes('observe'))).toBe(true);
        });

        it('extracts phase with "Phase:" prefix', () => {
            const messages = [
                msg('system', 'Phase: planning'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.currentState.some(s => s.includes('planning'))).toBe(true);
        });

        it('extracts task state indicators', () => {
            const messages = [
                msg('system', 'Task assigned: Implement feature X'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.currentState.length).toBeGreaterThanOrEqual(1);
        });
    });

    // -- sections --
    describe('sections list', () => {
        it('lists which sections have content', () => {
            const messages = [
                msg('user', 'Do the thing'),
                msg('assistant', 'I will start the process by reading the relevant files.'),
                msg('tool', 'file data', { toolName: 'readFile', success: true }),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.sections).toContain('primary_request');
            expect(summary.sections).toContain('preserved_user_messages');
            expect(summary.sections).toContain('tool_executions');
            expect(summary.sections).toContain('key_decisions');
        });

        it('does not include sections that are empty', () => {
            const messages = [msg('user', 'Hello')];
            const summary = builder.buildSummary(messages);
            expect(summary.sections).not.toContain('errors');
            expect(summary.sections).not.toContain('pending_work');
        });
    });

    // -- messagesSummarized --
    describe('messagesSummarized', () => {
        it('equals the input message count', () => {
            const messages = [
                msg('user', 'a'),
                msg('assistant', 'b'),
                msg('tool', 'c'),
                msg('system', 'd'),
            ];
            const summary = builder.buildSummary(messages);
            expect(summary.messagesSummarized).toBe(4);
        });
    });

    // -- formatAsPrompt --
    describe('formatAsPrompt', () => {
        it('wraps output in <conversation-summary> tags', () => {
            const summary = builder.buildSummary([msg('user', 'Do something')]);
            const prompt = builder.formatAsPrompt(summary);
            expect(prompt.startsWith('<conversation-summary>')).toBe(true);
            expect(prompt.endsWith('</conversation-summary>')).toBe(true);
        });

        it('includes all non-empty sections', () => {
            const messages = [
                msg('user', 'Build the feature'),
                msg('assistant', 'I will read the codebase first to understand the structure.'),
                msg('tool', 'Error: permission denied', { toolName: 'readFile', isError: true }),
                msg('system', 'ORPAR phase: observe'),
            ];
            const summary = builder.buildSummary(messages);
            const prompt = builder.formatAsPrompt(summary);
            expect(prompt).toContain('## Primary Request');
            expect(prompt).toContain('## Key Decisions');
            expect(prompt).toContain('## Tool Executions');
            expect(prompt).toContain('## Errors Encountered');
            expect(prompt).toContain('## Current State');
        });

        it('omits empty sections', () => {
            const messages = [msg('user', 'Just a question')];
            const summary = builder.buildSummary(messages);
            const prompt = builder.formatAsPrompt(summary);
            expect(prompt).not.toContain('## Tool Executions');
            expect(prompt).not.toContain('## Errors Encountered');
            expect(prompt).not.toContain('## Pending Work');
        });

        it('includes message count', () => {
            const messages = [msg('user', 'hi'), msg('assistant', 'hello')];
            const summary = builder.buildSummary(messages);
            const prompt = builder.formatAsPrompt(summary);
            expect(prompt).toContain('Summarized 2 messages');
        });

        it('formats tool executions with success/FAILED labels', () => {
            const messages = [
                msg('tool', 'All good', { toolName: 'successTool', success: true }),
                msg('tool', 'Error: crash', { toolName: 'failTool', isError: true }),
            ];
            const summary = builder.buildSummary(messages);
            const prompt = builder.formatAsPrompt(summary);
            expect(prompt).toContain('successTool: success');
            expect(prompt).toContain('failTool: FAILED');
        });
    });

    // -- estimateSummaryTokens --
    describe('estimateSummaryTokens', () => {
        it('returns > 0 for a non-empty summary', () => {
            const messages = [
                msg('user', 'Explain quantum computing in detail'),
                msg('assistant', 'I will break this down into key concepts and provide examples.'),
            ];
            const summary = builder.buildSummary(messages);
            const tokens = builder.estimateSummaryTokens(summary);
            expect(tokens).toBeGreaterThan(0);
        });

        it('returns a small value for an empty summary', () => {
            const summary = builder.buildSummary([]);
            const tokens = builder.estimateSummaryTokens(summary);
            // Even empty summary has the wrapper tags and "(Summarized 0 messages)"
            expect(tokens).toBeGreaterThan(0);
        });
    });
});
