/**
 * Framework-mode formatting of tool results the model receives.
 *
 * Since 5.0 the server forwards an external server's native MCP result
 * envelope unchanged: {content: ContentBlock[], isError?, structuredContent?,
 * _meta?}. getDetailedToolResultMessage, used for every tool result unless
 * promptMode is 'bare', predates array content: the envelope is truthy, has no
 * content.data or content.text, and carries no top-level data or result, so it
 * fell through to the word "Success". On 5.0.1 Sentinel ran fourteen cycles
 * with every payload intact on the channel monitor and none reaching a model.
 */
import { ToolExecutionHelpers } from '@mxf-dev/sdk/MxfAgentHelpers';
import type { ToolExecutionResult } from '@mxf-dev/sdk/MxfAgentHelpers';

const format = (result: unknown, toolName = 'sentinel_read_portfolio'): string =>
    ToolExecutionHelpers.getDetailedToolResultMessage(result as ToolExecutionResult, toolName, {});

describe('framework-mode formatting of native MCP result envelopes', () => {
    it('returns the text of a native envelope instead of "Success"', () => {
        expect(format({ content: [{ type: 'text', text: '{"a":1}' }] })).toBe('{"a":1}');
    });

    it('joins every text block of a multi-block result', () => {
        expect(format({ content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }))
            .toBe('first\nsecond');
    });

    it('keeps the envelope fields a native result may carry from hiding the payload', () => {
        expect(format({
            content: [{ type: 'text', text: '{"windowHours":24}' }],
            isError: false, structuredContent: { windowHours: 24 }, _meta: { traceId: 'trace-1' }
        })).toBe('{"windowHours":24}');
    });

    it('returns an empty native result as empty text, not a stand-in word', () => {
        expect(format({ content: [] })).toBe('');
        expect(format({ content: [{ type: 'text', text: '' }] })).toBe('');
    });

    it('formats a bare content-block array the same way', () => {
        expect(format([{ type: 'text', text: '{"a":1}' }])).toBe('{"a":1}');
    });

    it('keeps the internal result shapes unchanged', () => {
        expect(format({ content: { type: 'text', data: 'from data' } })).toBe('from data');
        expect(format({ content: { type: 'application/json', data: { a: 1 } } })).toBe('{"a":1}');
        expect(format({ content: { type: 'text', text: 'from text' } })).toBe('from text');
        expect(format({ result: { value: 1 } })).toBe('{"value":1}');
        expect(format({ success: true, count: 2 })).toBe('{"success":true,"count":2}');
        expect(format({ error: 'refused' })).toBe('Error: refused');
    });
});

describe('framework-mode formatting never replaces a payload with a stand-in word', () => {
    it('returns a plain string result as it is instead of JSON-quoting it', () => {
        expect(format('line one\nline two')).toBe('line one\nline two');
    });

    it('keeps falsy payloads that used to read as "Success"', () => {
        expect(format({ content: { type: 'application/json', data: false } })).toBe('false');
        expect(format({ content: { type: 'application/json', data: 0 } })).toBe('0');
        expect(format({ content: { type: 'text', data: '' } })).toBe('');
        expect(format({ content: { type: 'text', text: '' } })).toBe('');
    });

    it('returns an unrecognized shape as its payload instead of "Success"', () => {
        expect(format({ content: 'body', messageId: 'message-1' })).toBe('{"content":"body","messageId":"message-1"}');
        expect(format({ content: { type: 'resource', uri: 'file:///x' } })).toBe('{"type":"resource","uri":"file:///x"}');
    });
});
