/**
 * Unit tests for TOON Encoder
 * Tests TOON encoding, decoding, and format conversion
 */

import {
  encodeToon,
  encodeForPrompt,
  decodeToon,
} from '@mxf/shared/utils/toon/encoder';
import { EncodeOptions } from '@mxf/shared/utils/toon/types';

describe('TOON Encoder', () => {
  describe('encodeToon', () => {
    it('should encode eligible array to TOON format', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = encodeToon(payload);

      expect(result.format).toBe('toon');
      expect(result.output).toContain('```toon');
      expect(result.output).toContain('data[5]');
      expect(result.output).toContain('{id,name,status}');
      expect(result.estimatedTokenSavings).toBeGreaterThan(0);
    });

    it('should fall back to JSON for non-eligible payload', () => {
      const payload = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      const result = encodeToon(payload);

      expect(result.format).toBe('json');
      expect(result.output).toContain('```json');
      expect(result.estimatedTokenSavings).toBe(0);
    });

    it('should handle empty arrays', () => {
      const payload: any[] = [];

      const result = encodeToon(payload);

      expect(result.format).toBe('json');
    });

    it('should respect delimiter option', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const options: EncodeOptions = { delimiter: '\t' };
      const result = encodeToon(payload, options);

      if (result.format === 'toon') {
        expect(result.output).toContain('\t');
      }
    });

    it('should respect indent option', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const options: EncodeOptions = { indent: 4 };
      const result = encodeToon(payload, options);

      if (result.format === 'toon') {
        const lines = result.output.split('\n');
        const dataLines = lines.filter((line) => line.startsWith('    '));
        expect(dataLines.length).toBeGreaterThan(0);
      }
    });

    it('should respect wrapInCodeBlock option', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const options: EncodeOptions = { wrapInCodeBlock: false };
      const result = encodeToon(payload, options);

      if (result.format === 'toon') {
        expect(result.output).not.toContain('```');
      }
    });

    it('should handle null values', () => {
      const payload = [
        { id: 1, name: 'Alice', status: null },
        { id: 2, name: 'Bob', status: 'active' },
        { id: 3, name: 'Carol', status: null },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: null },
      ];

      const result = encodeToon(payload);

      expect(result.format).toBe('toon');
    });

    it('should handle boolean values', () => {
      const payload = [
        { id: 1, name: 'Alice', active: true },
        { id: 2, name: 'Bob', active: false },
        { id: 3, name: 'Carol', active: true },
        { id: 4, name: 'Dave', active: true },
        { id: 5, name: 'Eve', active: false },
      ];

      const result = encodeToon(payload);

      expect(result.format).toBe('toon');
      expect(result.output).toContain('true');
      expect(result.output).toContain('false');
    });

    it('should handle numeric values', () => {
      const payload = [
        { id: 1, amount: 100.5, count: 10 },
        { id: 2, amount: 200.75, count: 20 },
        { id: 3, amount: 300.25, count: 30 },
        { id: 4, amount: 400.0, count: 40 },
        { id: 5, amount: 500.5, count: 50 },
      ];

      const result = encodeToon(payload);

      expect(result.format).toBe('toon');
      expect(result.output).toContain('100.5');
      expect(result.output).toContain('200.75');
    });

    it('should escape values with delimiters', () => {
      const payload = [
        { id: 1, name: 'Smith, John', status: 'active' },
        { id: 2, name: 'Doe, Jane', status: 'idle' },
        { id: 3, name: 'Brown, Bob', status: 'active' },
        { id: 4, name: 'Davis, Dave', status: 'active' },
        { id: 5, name: 'Wilson, Will', status: 'idle' },
      ];

      const result = encodeToon(payload);

      expect(result.format).toBe('toon');
      expect(result.output).toContain('"Smith, John"');
      expect(result.output).toContain('"Doe, Jane"');
    });

    it('should escape values with quotes', () => {
      const payload = [
        { id: 1, name: 'John "Johnny" Smith', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = encodeToon(payload);

      expect(result.format).toBe('toon');
      expect(result.output).toContain('""'); // Escaped quote
    });

    it('should track encoding metrics', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = encodeToon(payload);

      expect(result.originalBytes).toBeGreaterThan(0);
      expect(result.encodedBytes).toBeGreaterThan(0);
      expect(result.latencyMs).toBeDefined();
      expect(result.eligibilityScore).toBeDefined();
    });

    it('should provide token savings estimate', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = encodeToon(payload);

      if (result.format === 'toon') {
        expect(result.estimatedTokenSavings).toBeGreaterThan(0);
        expect(result.encodedBytes).toBeLessThan(result.originalBytes);
      }
    });
  });

  describe('encodeForPrompt', () => {
    it('should always wrap output in code blocks', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = encodeForPrompt(payload);

      expect(result.output).toMatch(/^```/);
      expect(result.output).toMatch(/```$/);
    });

    it('should produce format suitable for prompt injection', () => {
      const payload = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const result = encodeForPrompt(payload);

      expect(result.output).toBeDefined();
      expect(typeof result.output).toBe('string');
      expect(result.format).toMatch(/^(toon|json)$/);
    });
  });

  describe('decodeToon', () => {
    it('should decode TOON format back to array', () => {
      const toonString = `\`\`\`toon
data[3]{id,name,status}:
  1,Alice,active
  2,Bob,idle
  3,Carol,active
\`\`\``;

      const result = decodeToon(toonString);

      expect(result).toEqual([
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
      ]);
    });

    it('should handle TOON without code block wrapping', () => {
      const toonString = `data[3]{id,name,status}:
  1,Alice,active
  2,Bob,idle
  3,Carol,active`;

      const result = decodeToon(toonString);

      expect(result).toEqual([
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
      ]);
    });

    it('should handle null values', () => {
      const toonString = `data[3]{id,name,status}:
  1,Alice,
  2,Bob,active
  3,Carol,`;

      const result = decodeToon(toonString);

      expect(result).toEqual([
        { id: 1, name: 'Alice', status: null },
        { id: 2, name: 'Bob', status: 'active' },
        { id: 3, name: 'Carol', status: null },
      ]);
    });

    it('should handle boolean values', () => {
      const toonString = `data[3]{id,name,active}:
  1,Alice,true
  2,Bob,false
  3,Carol,true`;

      const result = decodeToon(toonString);

      expect(result).toEqual([
        { id: 1, name: 'Alice', active: true },
        { id: 2, name: 'Bob', active: false },
        { id: 3, name: 'Carol', active: true },
      ]);
    });

    it('should handle numeric values', () => {
      const toonString = `data[3]{id,amount,count}:
  1,100.5,10
  2,200.75,20
  3,300.25,30`;

      const result = decodeToon(toonString);

      expect(result).toEqual([
        { id: 1, amount: 100.5, count: 10 },
        { id: 2, amount: 200.75, count: 20 },
        { id: 3, amount: 300.25, count: 30 },
      ]);
    });

    it('should handle quoted values with delimiters', () => {
      const toonString = `data[3]{id,name,status}:
  1,"Smith, John",active
  2,"Doe, Jane",idle
  3,"Brown, Bob",active`;

      const result = decodeToon(toonString);

      expect(result).toEqual([
        { id: 1, name: 'Smith, John', status: 'active' },
        { id: 2, name: 'Doe, Jane', status: 'idle' },
        { id: 3, name: 'Brown, Bob', status: 'active' },
      ]);
    });

    it('should handle escaped quotes', () => {
      const toonString = `data[2]{id,name,status}:
  1,"John ""Johnny"" Smith",active
  2,Bob,idle`;

      const result = decodeToon(toonString);

      expect(result).toEqual([
        { id: 1, name: 'John "Johnny" Smith', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
      ]);
    });

    it('should throw error for invalid TOON format', () => {
      const invalidToon = 'not a valid toon format';

      expect(() => decodeToon(invalidToon)).toThrow();
    });
  });

  describe('Round-trip Encoding/Decoding', () => {
    it('should preserve data through encode/decode cycle', () => {
      const original = [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'idle' },
        { id: 3, name: 'Carol', status: 'active' },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: 'idle' },
      ];

      const encoded = encodeToon(original);
      if (encoded.format === 'toon') {
        const decoded = decodeToon(encoded.output);
        expect(decoded).toEqual(original);
      }
    });

    it('should preserve null values through round-trip', () => {
      const original = [
        { id: 1, name: 'Alice', status: null },
        { id: 2, name: 'Bob', status: 'active' },
        { id: 3, name: 'Carol', status: null },
        { id: 4, name: 'Dave', status: 'active' },
        { id: 5, name: 'Eve', status: null },
      ];

      const encoded = encodeToon(original);
      if (encoded.format === 'toon') {
        const decoded = decodeToon(encoded.output);
        expect(decoded).toEqual(original);
      }
    });

    it('should preserve special characters through round-trip', () => {
      const original = [
        { id: 1, name: 'Smith, John', desc: 'Hello "World"' },
        { id: 2, name: 'Doe, Jane', desc: 'Test' },
        { id: 3, name: 'Brown, Bob', desc: 'Another "test"' },
        { id: 4, name: 'Davis, Dave', desc: 'More, commas' },
        { id: 5, name: 'Wilson, Will', desc: 'Final' },
      ];

      const encoded = encodeToon(original);
      if (encoded.format === 'toon') {
        const decoded = decodeToon(encoded.output);
        expect(decoded).toEqual(original);
      }
    });
  });

  describe('Performance', () => {
    it('should complete encoding in under 20ms for moderate payloads', () => {
      const payload = Array(50).fill(null).map((_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        status: 'active',
      }));

      const start = Date.now();
      encodeToon(payload);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(20);
    });
  });
});
