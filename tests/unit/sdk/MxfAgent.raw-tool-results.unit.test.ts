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

    it('recognizes explicit MCP failures and missing results without throwing during classification', () => {
        type Result = Parameters<typeof ToolExecutionHelpers.isToolExecutionSuccessful>[0];
        expect(ToolExecutionHelpers.isToolExecutionSuccessful({ isError: true } as unknown as Result)).toBe(false);
        expect(ToolExecutionHelpers.isToolExecutionSuccessful(null as unknown as Result)).toBe(false);
        expect(ToolExecutionHelpers.isToolExecutionSuccessful('' as unknown as Result)).toBe(true);
    });
});
