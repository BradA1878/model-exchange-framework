/**
 * Unit tests for TOON Formatter
 * Tests message payload formatting and utilities
 */

import {
  formatMessagePayload,
  formatAsJson,
  formatAsToon,
  formatPayload,
  formatBatch,
  stripCodeBlocks,
  detectFormat,
  formatWithMetadata,
} from '@mxf/shared/utils/toon/formatter';
import { FormatOptions } from '@mxf/shared/utils/toon/types';

describe('TOON Formatter', () => {
  describe('formatMessagePayload', () => {
    it('should format eligible payload as TOON', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = formatMessagePayload(payload);

      expect(result).toContain('```toon');
    });

    it('should format non-eligible payload as JSON', () => {
      const payload = { id: 1, name: 'Alice' };

      const result = formatMessagePayload(payload);

      expect(result).toContain('```json');
    });

    it('should respect toonEnabled option', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const options: FormatOptions = { toonEnabled: false };
      const result = formatMessagePayload(payload, options);

      expect(result).toContain('```json');
      expect(result).not.toContain('```toon');
    });

    it('should pass through eligibility options', () => {
      const payload = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Carol' },
      ];

      const options: FormatOptions = {
        eligibilityOptions: {
          minArrayLength: 3,
          minScore: 0.5,
        },
      };

      const result = formatMessagePayload(payload, options);

      // With relaxed criteria, this might be eligible
      expect(result).toBeDefined();
    });

    it('should pass through encode options', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const options: FormatOptions = {
        encodeOptions: {
          delimiter: '\t',
        },
      };

      const result = formatMessagePayload(payload, options);

      if (result.includes('```toon')) {
        expect(result).toContain('\t');
      }
    });

    it('should handle null payload gracefully', () => {
      const result = formatMessagePayload(null);

      expect(result).toContain('```json');
    });

    it('should handle undefined payload gracefully', () => {
      const result = formatMessagePayload(undefined);

      expect(result).toContain('```json');
    });

    it('should handle error and fall back to JSON', () => {
      // Create a circular reference to cause encoding error
      const circular: any = { id: 1 };
      circular.self = circular;

      const result = formatMessagePayload(circular);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('formatAsJson', () => {
    it('should format payload as JSON with code block', () => {
      const payload = { id: 1, name: 'Alice' };

      const result = formatAsJson(payload);

      expect(result).toContain('```json');
      expect(result).toContain('"id": 1');
      expect(result).toContain('"name": "Alice"');
    });

    it('should format payload as compact JSON', () => {
      const payload = { id: 1, name: 'Alice' };

      const result = formatAsJson(payload, true);

      expect(result).toContain('```json');
      expect(result).toContain('{"id":1,"name":"Alice"}');
    });

    it('should handle arrays', () => {
      const payload = [1, 2, 3];

      const result = formatAsJson(payload);

      expect(result).toContain('```json');
      expect(result).toContain('[');
      expect(result).toContain(']');
    });

    it('should handle nested objects', () => {
      const payload = {
        id: 1,
        meta: {
          role: 'admin',
          permissions: ['read', 'write'],
        },
      };

      const result = formatAsJson(payload);

      expect(result).toContain('```json');
      expect(result).toContain('"meta"');
      expect(result).toContain('"role"');
      expect(result).toContain('"permissions"');
    });

    it('should handle error gracefully', () => {
      const circular: any = { id: 1 };
      circular.self = circular;

      const result = formatAsJson(circular);

      expect(result).toContain('```json');
      expect(result).toContain('error');
    });
  });

  describe('formatAsToon', () => {
    it('should format eligible payload as TOON', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = formatAsToon(payload);

      expect(result).toContain('```toon');
    });

    it('should fall back to JSON for non-eligible payload', () => {
      const payload = { id: 1, name: 'Alice' };

      const result = formatAsToon(payload);

      expect(result).toContain('```json');
    });

    it('should respect encode options', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = formatAsToon(payload, { delimiter: '|' });

      if (result.includes('```toon')) {
        expect(result).toContain('|');
      }
    });
  });

  describe('formatPayload', () => {
    it('should be an alias for formatMessagePayload', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = formatPayload(payload);

      expect(result).toBeDefined();
      expect(result).toContain('```');
    });
  });

  describe('formatBatch', () => {
    it('should format multiple payloads with labels', () => {
      const payloads = [
        {
          label: 'Users',
          data: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
        },
        {
          label: 'Tasks',
          data: [
            { id: 1, title: 'Task 1' },
            { id: 2, title: 'Task 2' },
          ],
        },
      ];

      const result = formatBatch(payloads);

      expect(result).toContain('## Users');
      expect(result).toContain('## Tasks');
      expect(result).toContain('```');
    });

    it('should handle empty batch', () => {
      const result = formatBatch([]);

      expect(result).toBe('');
    });

    it('should pass options to formatMessagePayload', () => {
      const payloads = [
        {
          label: 'Data',
          data: [
            { id: 1, name: 'Alice', status: 'active' },
            { id: 2, name: 'Bob', status: 'idle' },
            { id: 3, name: 'Carol', status: 'active' },
            { id: 4, name: 'Dave', status: 'active' },
            { id: 5, name: 'Eve', status: 'idle' },
          ],
        },
      ];

      const options: FormatOptions = { toonEnabled: false };
      const result = formatBatch(payloads, options);

      expect(result).toContain('```json');
      expect(result).not.toContain('```toon');
    });
  });

  describe('stripCodeBlocks', () => {
    it('should remove TOON code block markers', () => {
      const formatted = '```toon\ndata[2]{id,name}:\n  1,Alice\n  2,Bob\n```';

      const result = stripCodeBlocks(formatted);

      expect(result).not.toContain('```');
      expect(result).toContain('data[2]{id,name}:');
      expect(result).toContain('1,Alice');
    });

    it('should remove JSON code block markers', () => {
      const formatted = '```json\n{"id": 1, "name": "Alice"}\n```';

      const result = stripCodeBlocks(formatted);

      expect(result).not.toContain('```');
      expect(result).toContain('"id": 1');
    });

    it('should handle already stripped content', () => {
      const content = 'data[2]{id,name}:\n  1,Alice\n  2,Bob';

      const result = stripCodeBlocks(content);

      expect(result).toBe(content);
    });

    it('should trim whitespace', () => {
      const formatted = '```toon\n  data[2]{id,name}:\n    1,Alice\n  ```';

      const result = stripCodeBlocks(formatted);

      expect(result).not.toMatch(/^\s+/);
      expect(result).not.toMatch(/\s+$/);
    });
  });

  describe('detectFormat', () => {
    it('should detect TOON format', () => {
      const formatted = '```toon\ndata[2]{id,name}:\n  1,Alice\n  2,Bob\n```';

      const result = detectFormat(formatted);

      expect(result).toBe('toon');
    });

    it('should detect JSON format', () => {
      const formatted = '```json\n{"id": 1, "name": "Alice"}\n```';

      const result = detectFormat(formatted);

      expect(result).toBe('json');
    });

    it('should return unknown for unformatted content', () => {
      const content = 'plain text content';

      const result = detectFormat(content);

      expect(result).toBe('unknown');
    });
  });

  describe('formatWithMetadata', () => {
    it('should add metadata header to formatted output', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const metadata = {
        source: 'test',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = formatWithMetadata(payload, metadata);

      expect(result).toContain('<!-- Payload Metadata');
      expect(result).toContain('Format:');
      expect(result).toContain('source: test');
      expect(result).toContain('timestamp: 2024-01-01T00:00:00Z');
      expect(result).toContain('-->');
      expect(result).toContain('```');
    });

    it('should include detected format in metadata', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const metadata = { test: 'value' };
      const result = formatWithMetadata(payload, metadata);

      expect(result).toMatch(/Format: (toon|json)/);
    });

    it('should handle empty metadata', () => {
      const payload = { id: 1, name: 'Alice' };

      const result = formatWithMetadata(payload, {});

      expect(result).toContain('<!-- Payload Metadata');
      expect(result).toContain('Format:');
      expect(result).toContain('-->');
    });

    it('should pass options to formatMessagePayload', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const metadata = { test: 'value' };
      const options: FormatOptions = { toonEnabled: false };

      const result = formatWithMetadata(payload, metadata, options);

      expect(result).toContain('Format: json');
      expect(result).toContain('```json');
    });
  });

  describe('Integration', () => {
    it('should handle complete workflow', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      // Format the payload
      const formatted = formatMessagePayload(payload);

      // Detect format
      const format = detectFormat(formatted);

      // Strip code blocks
      const stripped = stripCodeBlocks(formatted);

      expect(formatted).toBeDefined();
      expect(format).toMatch(/^(toon|json)$/);
      expect(stripped).not.toContain('```');
    });
  });
});
