/**
 * Unit tests for LargeOutputHandler — processes shell command outputs,
 * truncating large outputs and returning previews.
 *
 * Note: MongoDB persistence tests are mocked since they require a live
 * database connection. We test the pure logic (size comparison, line counting,
 * config merging) without hitting the database.
 */

import {
    processOutput,
    DEFAULT_LARGE_OUTPUT_CONFIG,
    LargeOutputConfig,
    ProcessedOutput
} from '@mxf/shared/protocols/mcp/tools/shell/LargeOutputHandler';

// Mock the ShellOutput model to avoid MongoDB dependency
jest.mock('@mxf/shared/models/shellOutput', () => ({
    ShellOutput: {
        create: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(null),
    },
}));

const mockContext = {
    agentId: 'test-agent-123' as any,
    channelId: 'test-channel-456' as any,
    commandHash: 'abc123',
};

// ---------------------------------------------------------------------------
// DEFAULT_LARGE_OUTPUT_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_LARGE_OUTPUT_CONFIG', () => {
    it('has expected default values', () => {
        expect(DEFAULT_LARGE_OUTPUT_CONFIG.previewLines).toBe(200);
        expect(DEFAULT_LARGE_OUTPUT_CONFIG.maxInlineSize).toBe(512 * 1024);
        expect(DEFAULT_LARGE_OUTPUT_CONFIG.maxPersistSize).toBe(64 * 1024 * 1024);
    });

    it('all values are positive numbers', () => {
        expect(DEFAULT_LARGE_OUTPUT_CONFIG.previewLines).toBeGreaterThan(0);
        expect(DEFAULT_LARGE_OUTPUT_CONFIG.maxInlineSize).toBeGreaterThan(0);
        expect(DEFAULT_LARGE_OUTPUT_CONFIG.maxPersistSize).toBeGreaterThan(0);
    });

    it('maxPersistSize is greater than maxInlineSize', () => {
        expect(DEFAULT_LARGE_OUTPUT_CONFIG.maxPersistSize).toBeGreaterThan(
            DEFAULT_LARGE_OUTPUT_CONFIG.maxInlineSize
        );
    });
});

// ---------------------------------------------------------------------------
// processOutput — small output (returned inline)
// ---------------------------------------------------------------------------

describe('processOutput — small output', () => {
    it('returns small output as-is without truncation', async () => {
        const output = 'hello world\nline two\nline three';
        const result = await processOutput(output, mockContext);

        expect(result.inline).toBe(output);
        expect(result.isTruncated).toBe(false);
        expect(result.totalLines).toBe(3);
        expect(result.totalBytes).toBe(Buffer.byteLength(output, 'utf-8'));
        expect(result.persistedOutputId).toBeUndefined();
    });

    it('returns empty string output as-is', async () => {
        const result = await processOutput('', mockContext);

        expect(result.inline).toBe('');
        expect(result.isTruncated).toBe(false);
        expect(result.totalBytes).toBe(0);
        expect(result.totalLines).toBe(1); // ''.split('\n') = ['']
    });

    it('returns single-line output as-is', async () => {
        const output = 'single line';
        const result = await processOutput(output, mockContext);

        expect(result.inline).toBe(output);
        expect(result.isTruncated).toBe(false);
        expect(result.totalLines).toBe(1);
    });

    it('computes totalBytes correctly for multi-byte characters', async () => {
        const output = 'hello \u{1F600}'; // emoji is 4 bytes in UTF-8
        const result = await processOutput(output, mockContext);

        expect(result.totalBytes).toBe(Buffer.byteLength(output, 'utf-8'));
        expect(result.totalBytes).toBeGreaterThan(output.length); // multi-byte chars
    });
});

// ---------------------------------------------------------------------------
// processOutput — large output (truncated)
// ---------------------------------------------------------------------------

describe('processOutput — large output', () => {
    it('truncates output exceeding maxInlineSize', async () => {
        // Use a small maxInlineSize for testing
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 50, previewLines: 2 };
        const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
        const output = lines.join('\n');

        const result = await processOutput(output, mockContext, config);

        expect(result.isTruncated).toBe(true);
        expect(result.totalLines).toBe(100);
        expect(result.totalBytes).toBe(Buffer.byteLength(output, 'utf-8'));
        expect(result.persistedOutputId).toBeDefined();
        // Preview should contain first 2 lines
        expect(result.inline).toContain('line 0');
        expect(result.inline).toContain('line 1');
        // Preview should contain truncation notice
        expect(result.inline).toContain('truncated');
        expect(result.inline).toContain('shell_output_retrieve');
    });

    it('includes outputId in the preview text', async () => {
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 10, previewLines: 1 };
        const output = 'a'.repeat(100);

        const result = await processOutput(output, mockContext, config);

        expect(result.persistedOutputId).toBeDefined();
        expect(result.inline).toContain(result.persistedOutputId!);
    });

    it('preview contains correct totalBytes and totalLines', async () => {
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 10, previewLines: 1 };
        const lines = ['first line', 'second line', 'third line'];
        const output = lines.join('\n');

        const result = await processOutput(output, mockContext, config);

        expect(result.inline).toContain(String(result.totalBytes));
        expect(result.inline).toContain(String(result.totalLines));
    });
});

// ---------------------------------------------------------------------------
// processOutput — config override
// ---------------------------------------------------------------------------

describe('processOutput — config overrides', () => {
    it('merges partial config with defaults', async () => {
        const config: Partial<LargeOutputConfig> = { previewLines: 5 };
        const output = 'small output';
        const result = await processOutput(output, mockContext, config);

        // Should still work - maxInlineSize is from defaults (512KB) so this is small
        expect(result.isTruncated).toBe(false);
    });

    it('custom maxInlineSize determines truncation threshold', async () => {
        // Set maxInlineSize to 5 bytes so even "hello world" triggers truncation
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 5, previewLines: 1 };
        const output = 'hello world';

        const result = await processOutput(output, mockContext, config);

        expect(result.isTruncated).toBe(true);
    });

    it('custom previewLines controls how many lines appear in preview', async () => {
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 10, previewLines: 3 };
        const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
        const output = lines.join('\n');

        const result = await processOutput(output, mockContext, config);

        expect(result.isTruncated).toBe(true);
        // First 3 lines should be in preview
        expect(result.inline).toContain('line-0');
        expect(result.inline).toContain('line-1');
        expect(result.inline).toContain('line-2');
    });
});

// ---------------------------------------------------------------------------
// processOutput — totalBytes and totalLines always computed
// ---------------------------------------------------------------------------

describe('processOutput — metrics always present', () => {
    it('totalBytes is always computed for small output', async () => {
        const output = 'test';
        const result = await processOutput(output, mockContext);
        expect(result.totalBytes).toBe(4);
    });

    it('totalLines is always computed for small output', async () => {
        const output = 'line1\nline2\nline3';
        const result = await processOutput(output, mockContext);
        expect(result.totalLines).toBe(3);
    });

    it('totalBytes is always computed for large output', async () => {
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 5 };
        const output = 'a'.repeat(100);
        const result = await processOutput(output, mockContext, config);
        expect(result.totalBytes).toBe(100);
    });

    it('totalLines is always computed for large output', async () => {
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 5 };
        const output = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
        const result = await processOutput(output, mockContext, config);
        expect(result.totalLines).toBe(50);
    });
});

// ---------------------------------------------------------------------------
// processOutput — MongoDB persistence failure fallback
// ---------------------------------------------------------------------------

describe('processOutput — persistence failure fallback', () => {
    it('returns truncated inline output when MongoDB create fails', async () => {
        // Override the mock to throw
        const { ShellOutput } = require('@mxf/shared/models/shellOutput');
        ShellOutput.create.mockRejectedValueOnce(new Error('MongoDB connection failed'));

        const config: Partial<LargeOutputConfig> = { maxInlineSize: 10 };
        const output = 'a'.repeat(100);

        const result = await processOutput(output, mockContext, config);

        // Should still return a result, not throw
        expect(result.isTruncated).toBe(true);
        expect(result.totalBytes).toBe(100);
        // In degraded mode, no persistedOutputId is set
        expect(result.persistedOutputId).toBeUndefined();
        // Inline content should be truncated to maxInlineSize
        expect(result.inline.length).toBeLessThanOrEqual(10);
    });
});

// ---------------------------------------------------------------------------
// processOutput — boundary conditions
// ---------------------------------------------------------------------------

describe('processOutput — boundary conditions', () => {
    it('output exactly at maxInlineSize threshold is returned inline', async () => {
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 10 };
        // Create a string that is exactly 10 bytes
        const output = 'a'.repeat(10);

        const result = await processOutput(output, mockContext, config);

        expect(result.isTruncated).toBe(false);
        expect(result.inline).toBe(output);
    });

    it('output one byte over maxInlineSize is truncated', async () => {
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 10 };
        const output = 'a'.repeat(11);

        const result = await processOutput(output, mockContext, config);

        expect(result.isTruncated).toBe(true);
    });

    it('previewLines greater than total lines returns all lines in preview', async () => {
        const config: Partial<LargeOutputConfig> = { maxInlineSize: 5, previewLines: 1000 };
        const lines = ['line1', 'line2', 'line3'];
        const output = lines.join('\n');

        const result = await processOutput(output, mockContext, config);

        expect(result.isTruncated).toBe(true);
        // All 3 lines should appear in the preview since previewLines (1000) > totalLines (3)
        expect(result.inline).toContain('line1');
        expect(result.inline).toContain('line2');
        expect(result.inline).toContain('line3');
    });
});
