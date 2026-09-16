import { ToolExecutionHelpers } from '@mxf-dev/sdk/MxfAgentHelpers';

describe('bare tool payload fidelity', () => {
    it.each([
        { content: 'body', messageId: 'message' },
        { data: ['row'], count: 1 },
        { result: { value: false }, source: 'database' },
        { error: 'Business data', status: 'recorded' },
        ['first', 'second'], [], false, 0, null
    ])('preserves business data without treating its fields as an MCP envelope: %p', value => {
        expect(ToolExecutionHelpers.getRawToolResultMessage(value)).toBe(JSON.stringify(value));
    });

    it('extracts actual MCP text blocks without replacing empty content', () => {
        expect(ToolExecutionHelpers.getRawToolResultMessage({ content: [{ type: 'text', text: '' }] })).toBe('');
        expect(ToolExecutionHelpers.getRawToolResultMessage({ content: [], isError: false })).toBe('');
        expect(ToolExecutionHelpers.getRawToolResultMessage({ content: { type: 'application/json', data: false } })).toBe('false');
        expect(ToolExecutionHelpers.getRawToolResultMessage({ content: [{ type: 'text', text: 'Denied' }], isError: true })).toBe('Denied');
    });

    it('recognizes a native envelope that carries structuredContent', () => {
        // The MCP envelope's own fields are content, structuredContent, isError, and
        // _meta (metadata is MXF's). structuredContent was missing from the envelope
        // check, so a spec-conformant result that carried it was sent to the model
        // as the JSON of the whole envelope instead of its text blocks.
        expect(ToolExecutionHelpers.getRawToolResultMessage({
            content: [{ type: 'text', text: '{"windowHours":24}' }],
            structuredContent: { windowHours: 24 }, isError: false, _meta: { traceId: 'trace-1' }
        })).toBe('{"windowHours":24}');
    });

    it('recognizes explicit MCP failures and missing results without throwing during classification', () => {
        type Result = Parameters<typeof ToolExecutionHelpers.isToolExecutionSuccessful>[0];
        expect(ToolExecutionHelpers.isToolExecutionSuccessful({ isError: true } as unknown as Result)).toBe(false);
        expect(ToolExecutionHelpers.isToolExecutionSuccessful(null as unknown as Result)).toBe(false);
        expect(ToolExecutionHelpers.isToolExecutionSuccessful('' as unknown as Result)).toBe(true);
    });
});
