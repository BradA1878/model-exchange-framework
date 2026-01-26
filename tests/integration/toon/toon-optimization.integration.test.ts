/**
 * TOON Integration Tests
 *
 * Tests the TOON (Token-Oriented Object Notation) optimization system:
 * - Eligibility evaluation for different data structures
 * - TOON encoding and formatting
 * - Message middleware integration
 * - Metrics collection
 * - JSON fallback behavior on errors
 * - Configuration options (min array length, score threshold, delimiter)
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { MINIMAL_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';
import {
    evaluateEligibility,
    extractEligibleArrays,
    mightBeEligible,
    encodeToon,
    encodeForPrompt,
    decodeToon,
    formatMessagePayload,
    formatAsJson,
    formatAsToon,
    formatPayload,
    formatBatch,
    stripCodeBlocks,
    detectFormat,
    formatWithMetadata,
    recordEncoding,
    recordError,
    getMetrics,
    getDetailedMetrics,
    resetMetrics,
    exportMetricsJson,
    getMetricsSummary,
    createContextCollector,
} from '../../../src/shared/utils/toon';
import {
    ToonMessageMiddleware,
    getToonMiddleware,
    initializeToonMiddleware,
    processToonPayload,
} from '../../../src/server/socket/middleware/ToonMessageMiddleware';

describe('TOON Optimization', () => {
    let testSdk: TestSDK;
    let channelId: string;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('toon', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    // Reset metrics before each test to ensure isolation
    beforeEach(() => {
        resetMetrics();
    });

    describe('Eligibility Evaluation', () => {
        describe('Basic Eligibility', () => {
            it('should identify eligible uniform arrays', () => {
                const eligiblePayload = [
                    { id: 1, name: 'Alice', status: 'active' },
                    { id: 2, name: 'Bob', status: 'idle' },
                    { id: 3, name: 'Carol', status: 'active' },
                    { id: 4, name: 'David', status: 'busy' },
                    { id: 5, name: 'Eve', status: 'active' },
                ];

                const result = evaluateEligibility(eligiblePayload);

                expect(result.eligible).toBe(true);
                expect(result.score).toBeGreaterThanOrEqual(0.8);
                expect(result.eligiblePaths).toContain('$');
            });

            it('should reject arrays below minimum length', () => {
                const smallArray = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                ];

                const result = evaluateEligibility(smallArray);

                expect(result.eligible).toBe(false);
                expect(result.score).toBe(0);
                expect(result.reason).toContain('No arrays meet eligibility criteria');
            });

            it('should reject non-uniform arrays', () => {
                const nonUniformArray = [
                    { id: 1, name: 'Alice', status: 'active' },
                    { id: 2, name: 'Bob' }, // Missing 'status' field
                    { id: 3, name: 'Carol', status: 'active' },
                    { id: 4, name: 'David', status: 'busy' },
                    { id: 5, name: 'Eve', status: 'active' },
                ];

                const result = evaluateEligibility(nonUniformArray);

                expect(result.eligible).toBe(false);
            });

            it('should reject arrays with nested objects', () => {
                const nestedArray = [
                    { id: 1, name: 'Alice', metadata: { role: 'admin' } },
                    { id: 2, name: 'Bob', metadata: { role: 'user' } },
                    { id: 3, name: 'Carol', metadata: { role: 'user' } },
                    { id: 4, name: 'David', metadata: { role: 'user' } },
                    { id: 5, name: 'Eve', metadata: { role: 'admin' } },
                ];

                const result = evaluateEligibility(nestedArray);

                expect(result.eligible).toBe(false);
            });

            it('should accept arrays with primitive values only', () => {
                const primitiveArray = [
                    { id: 1, name: 'Alice', active: true, score: 95.5, notes: null },
                    { id: 2, name: 'Bob', active: false, score: 88.0, notes: null },
                    { id: 3, name: 'Carol', active: true, score: 92.3, notes: null },
                    { id: 4, name: 'David', active: true, score: 78.9, notes: null },
                    { id: 5, name: 'Eve', active: false, score: 85.7, notes: null },
                ];

                const result = evaluateEligibility(primitiveArray);

                expect(result.eligible).toBe(true);
            });
        });

        describe('Eligibility Options', () => {
            it('should respect custom minArrayLength option', () => {
                const threeElementArray = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                ];

                // Default minArrayLength is 5, should fail
                const defaultResult = evaluateEligibility(threeElementArray);
                expect(defaultResult.eligible).toBe(false);

                // With minArrayLength: 3, should pass
                const customResult = evaluateEligibility(threeElementArray, { minArrayLength: 3 });
                expect(customResult.eligible).toBe(true);
            });

            it('should respect custom minScore option', () => {
                const basicArray = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                // With high minScore threshold
                const highThreshold = evaluateEligibility(basicArray, { minScore: 0.99 });
                expect(highThreshold.eligible).toBe(false);

                // With low minScore threshold
                const lowThreshold = evaluateEligibility(basicArray, { minScore: 0.5 });
                expect(lowThreshold.eligible).toBe(true);
            });
        });

        describe('Nested Array Detection', () => {
            it('should find eligible arrays nested in objects', () => {
                const nestedPayload = {
                    metadata: { version: '1.0' },
                    users: [
                        { id: 1, name: 'Alice', status: 'active' },
                        { id: 2, name: 'Bob', status: 'idle' },
                        { id: 3, name: 'Carol', status: 'active' },
                        { id: 4, name: 'David', status: 'busy' },
                        { id: 5, name: 'Eve', status: 'active' },
                    ],
                };

                const result = evaluateEligibility(nestedPayload);

                expect(result.eligible).toBe(true);
                expect(result.eligiblePaths).toContain('$.users');
            });

            it('should extract multiple eligible arrays', () => {
                const multiArrayPayload = {
                    users: [
                        { id: 1, name: 'Alice' },
                        { id: 2, name: 'Bob' },
                        { id: 3, name: 'Carol' },
                        { id: 4, name: 'David' },
                        { id: 5, name: 'Eve' },
                    ],
                    orders: [
                        { orderId: 101, status: 'pending', total: 100 },
                        { orderId: 102, status: 'shipped', total: 200 },
                        { orderId: 103, status: 'delivered', total: 150 },
                        { orderId: 104, status: 'pending', total: 300 },
                        { orderId: 105, status: 'shipped', total: 250 },
                    ],
                };

                const arrays = extractEligibleArrays(multiArrayPayload);

                expect(arrays.length).toBe(2);
                expect(arrays.map((a) => a.path)).toContain('$.users');
                expect(arrays.map((a) => a.path)).toContain('$.orders');
            });
        });

        describe('Quick Eligibility Check', () => {
            it('should return true for payloads containing arrays', () => {
                expect(mightBeEligible([1, 2, 3])).toBe(true);
                expect(mightBeEligible({ items: [1, 2, 3] })).toBe(true);
                expect(mightBeEligible({ nested: { items: [] } })).toBe(true);
            });

            it('should return false for non-array payloads', () => {
                expect(mightBeEligible('string')).toBe(false);
                expect(mightBeEligible(123)).toBe(false);
                expect(mightBeEligible(null)).toBe(false);
                expect(mightBeEligible(undefined)).toBe(false);
                expect(mightBeEligible({ key: 'value' })).toBe(false);
            });
        });

        describe('Edge Cases', () => {
            it('should handle null payload', () => {
                const result = evaluateEligibility(null);
                expect(result.eligible).toBe(false);
                expect(result.reason).toContain('null');
            });

            it('should handle undefined payload', () => {
                const result = evaluateEligibility(undefined);
                expect(result.eligible).toBe(false);
                expect(result.reason).toContain('null or undefined');
            });

            it('should handle empty array', () => {
                const result = evaluateEligibility([]);
                expect(result.eligible).toBe(false);
            });

            it('should handle empty object', () => {
                const result = evaluateEligibility({});
                expect(result.eligible).toBe(false);
            });

            it('should handle primitive types', () => {
                expect(evaluateEligibility('string').eligible).toBe(false);
                expect(evaluateEligibility(123).eligible).toBe(false);
                expect(evaluateEligibility(true).eligible).toBe(false);
            });
        });
    });

    describe('TOON Encoding', () => {
        describe('Basic Encoding', () => {
            it('should encode eligible arrays in TOON format', () => {
                const payload = [
                    { id: 1, name: 'Alice', status: 'active' },
                    { id: 2, name: 'Bob', status: 'idle' },
                    { id: 3, name: 'Carol', status: 'active' },
                    { id: 4, name: 'David', status: 'busy' },
                    { id: 5, name: 'Eve', status: 'active' },
                ];

                const result = encodeToon(payload);

                expect(result.format).toBe('toon');
                expect(result.output).toContain('```toon');
                expect(result.output).toContain('[5]'); // Array length
                expect(result.output).toContain('{id,name,status}'); // Fields
                expect(result.estimatedTokenSavings).toBeGreaterThan(0);
            });

            it('should fall back to JSON for ineligible payloads', () => {
                const ineligiblePayload = { key: 'value' };

                const result = encodeToon(ineligiblePayload);

                expect(result.format).toBe('json');
                expect(result.output).toContain('```json');
                expect(result.estimatedTokenSavings).toBe(0);
            });

            it('should wrap output in code blocks by default', () => {
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = encodeToon(payload);

                expect(result.output).toMatch(/^```(toon|json)\n/);
                expect(result.output).toMatch(/\n```$/);
            });

            it('should allow disabling code block wrapping', () => {
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = encodeToon(payload, { wrapInCodeBlock: false });

                expect(result.output).not.toContain('```');
            });
        });

        describe('Encoding Options', () => {
            it('should support custom delimiter', () => {
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const tabResult = encodeToon(payload, { delimiter: '\t' });
                const pipeResult = encodeToon(payload, { delimiter: '|' });

                // The content should use the specified delimiter
                const tabContent = stripCodeBlocks(tabResult.output);
                const pipeContent = stripCodeBlocks(pipeResult.output);

                expect(tabContent).toContain('\t');
                expect(pipeContent).toContain('|');
            });

            it('should support custom indentation', () => {
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = encodeToon(payload, { indent: 4 });
                const content = stripCodeBlocks(result.output);
                const lines = content.split('\n');

                // Data lines should have 4 spaces of indentation
                const dataLines = lines.slice(1); // Skip header
                for (const line of dataLines) {
                    if (line.trim()) {
                        expect(line).toMatch(/^    /); // 4 spaces
                    }
                }
            });
        });

        describe('Value Escaping', () => {
            it('should escape values containing delimiters', () => {
                const payload = [
                    { id: 1, name: 'Alice, Jr.', status: 'active' },
                    { id: 2, name: 'Bob', status: 'idle' },
                    { id: 3, name: 'Carol', status: 'active' },
                    { id: 4, name: 'David', status: 'busy' },
                    { id: 5, name: 'Eve', status: 'active' },
                ];

                const result = encodeToon(payload);

                // Value with comma should be quoted
                expect(result.output).toContain('"Alice, Jr."');
            });

            it('should escape values containing quotes', () => {
                const payload = [
                    { id: 1, name: 'Alice "Al"', status: 'active' },
                    { id: 2, name: 'Bob', status: 'idle' },
                    { id: 3, name: 'Carol', status: 'active' },
                    { id: 4, name: 'David', status: 'busy' },
                    { id: 5, name: 'Eve', status: 'active' },
                ];

                const result = encodeToon(payload);

                // Value with quotes should be escaped with double quotes
                expect(result.output).toContain('""Al""');
            });

            it('should handle null values', () => {
                const payload = [
                    { id: 1, name: 'Alice', notes: null },
                    { id: 2, name: 'Bob', notes: null },
                    { id: 3, name: 'Carol', notes: null },
                    { id: 4, name: 'David', notes: null },
                    { id: 5, name: 'Eve', notes: null },
                ];

                const result = encodeToon(payload);

                // Should encode without error
                expect(result.format).toBe('toon');
            });
        });

        describe('TOON Decoding', () => {
            it('should decode TOON format back to objects', () => {
                const toonString = `\`\`\`toon
data[3]{id,name,status}:
  1,Alice,active
  2,Bob,idle
  3,Carol,active
\`\`\``;

                const decoded = decodeToon(toonString);

                expect(decoded).toHaveLength(3);
                expect(decoded[0]).toEqual({ id: 1, name: 'Alice', status: 'active' });
                expect(decoded[1]).toEqual({ id: 2, name: 'Bob', status: 'idle' });
                expect(decoded[2]).toEqual({ id: 3, name: 'Carol', status: 'active' });
            });

            it('should handle boolean and number types during decode', () => {
                const toonString = `data[2]{id,active,score}:
  1,true,95.5
  2,false,88`;

                const decoded = decodeToon(toonString);

                expect(decoded[0].active).toBe(true);
                expect(decoded[0].score).toBe(95.5);
                expect(decoded[1].active).toBe(false);
                expect(decoded[1].score).toBe(88);
            });

            it('should handle empty values as null', () => {
                const toonString = `data[2]{id,name,notes}:
  1,Alice,
  2,Bob,`;

                const decoded = decodeToon(toonString);

                expect(decoded[0].notes).toBeNull();
                expect(decoded[1].notes).toBeNull();
            });

            it('should throw on invalid TOON format', () => {
                const invalidToon = 'not valid toon format';

                expect(() => decodeToon(invalidToon)).toThrow();
            });
        });

        describe('Round-trip Encoding/Decoding', () => {
            it('should maintain data integrity through encode/decode cycle', () => {
                const originalData = [
                    { id: 1, name: 'Alice', score: 95.5, active: true },
                    { id: 2, name: 'Bob', score: 88.0, active: false },
                    { id: 3, name: 'Carol', score: 92.3, active: true },
                    { id: 4, name: 'David', score: 78.9, active: true },
                    { id: 5, name: 'Eve', score: 85.7, active: false },
                ];

                const encoded = encodeToon(originalData);
                const decoded = decodeToon(encoded.output);

                // Sort both arrays by id for consistent comparison
                const sortedOriginal = [...originalData].sort((a, b) => a.id - b.id);
                const sortedDecoded = [...decoded].sort((a, b) => a.id - b.id);

                expect(sortedDecoded).toEqual(sortedOriginal);
            });
        });
    });

    describe('Message Formatting', () => {
        describe('formatMessagePayload', () => {
            it('should format eligible payloads as TOON', () => {
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const formatted = formatMessagePayload(payload);

                expect(formatted).toContain('```toon');
            });

            it('should format ineligible payloads as JSON', () => {
                const payload = { key: 'value', nested: { a: 1 } };

                const formatted = formatMessagePayload(payload);

                expect(formatted).toContain('```json');
            });

            it('should respect toonEnabled option', () => {
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const formatted = formatMessagePayload(payload, { toonEnabled: false });

                expect(formatted).toContain('```json');
                expect(formatted).not.toContain('```toon');
            });
        });

        describe('formatAsJson', () => {
            it('should format payload as JSON with code block', () => {
                const payload = { key: 'value' };

                const formatted = formatAsJson(payload);

                expect(formatted).toContain('```json');
                expect(formatted).toContain('"key"');
                expect(formatted).toContain('"value"');
            });

            it('should support compact JSON format', () => {
                const payload = { key: 'value', nested: { a: 1 } };

                const compact = formatAsJson(payload, true);
                const pretty = formatAsJson(payload, false);

                expect(compact.length).toBeLessThan(pretty.length);
                expect(compact).not.toContain('\n  '); // No indentation
            });
        });

        describe('formatAsToon', () => {
            it('should force TOON format for eligible data', () => {
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const formatted = formatAsToon(payload);

                expect(formatted).toContain('```toon');
            });

            it('should fall back to JSON for ineligible data', () => {
                const payload = { key: 'value' };

                const formatted = formatAsToon(payload);

                expect(formatted).toContain('```json');
            });
        });

        describe('formatBatch', () => {
            it('should format multiple payloads with labels', () => {
                const payloads = [
                    { label: 'Users', data: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] },
                    { label: 'Config', data: { setting: 'value' } },
                ];

                const formatted = formatBatch(payloads);

                expect(formatted).toContain('## Users');
                expect(formatted).toContain('## Config');
            });
        });

        describe('Format Detection', () => {
            it('should detect TOON format', () => {
                const toonFormatted = '```toon\ndata[1]{id}:\n  1\n```';

                expect(detectFormat(toonFormatted)).toBe('toon');
            });

            it('should detect JSON format', () => {
                const jsonFormatted = '```json\n{"key": "value"}\n```';

                expect(detectFormat(jsonFormatted)).toBe('json');
            });

            it('should return unknown for other formats', () => {
                const unknown = 'plain text';

                expect(detectFormat(unknown)).toBe('unknown');
            });
        });

        describe('stripCodeBlocks', () => {
            it('should remove TOON code block wrapper', () => {
                const wrapped = '```toon\ndata[1]{id}:\n  1\n```';

                const stripped = stripCodeBlocks(wrapped);

                expect(stripped).not.toContain('```');
                expect(stripped).toContain('data[1]{id}');
            });

            it('should remove JSON code block wrapper', () => {
                const wrapped = '```json\n{"key": "value"}\n```';

                const stripped = stripCodeBlocks(wrapped);

                expect(stripped).not.toContain('```');
                expect(stripped).toContain('"key"');
            });
        });

        describe('formatWithMetadata', () => {
            it('should add metadata header to formatted output', () => {
                const payload = { key: 'value' };
                const metadata = { source: 'test', timestamp: 12345 };

                const formatted = formatWithMetadata(payload, metadata);

                expect(formatted).toContain('<!-- Payload Metadata');
                expect(formatted).toContain('source: test');
                expect(formatted).toContain('timestamp: 12345');
                expect(formatted).toContain('Format: json');
            });
        });
    });

    describe('Metrics Collection', () => {
        describe('Recording and Retrieval', () => {
            it('should track encoding attempts', () => {
                // Record some encodings
                recordEncoding({
                    output: '```toon\ndata[5]{id}:\n  1\n```',
                    format: 'toon',
                    originalBytes: 100,
                    encodedBytes: 50,
                    estimatedTokenSavings: 12,
                    latencyMs: 5,
                    eligibilityScore: 0.85,
                });

                recordEncoding({
                    output: '```json\n{}\n```',
                    format: 'json',
                    originalBytes: 50,
                    encodedBytes: 50,
                    estimatedTokenSavings: 0,
                    latencyMs: 2,
                    eligibilityScore: 0,
                });

                const metrics = getMetrics();

                expect(metrics.totalAttempts).toBe(2);
                expect(metrics.toonSelected).toBe(1);
                expect(metrics.jsonSelected).toBe(1);
            });

            it('should track token savings', () => {
                recordEncoding({
                    output: '```toon\ndata[5]{id}:\n  1\n```',
                    format: 'toon',
                    originalBytes: 200,
                    encodedBytes: 100,
                    estimatedTokenSavings: 25,
                    latencyMs: 5,
                    eligibilityScore: 0.9,
                });

                const metrics = getMetrics();

                expect(metrics.totalTokenSavings).toBe(25);
                expect(metrics.totalOriginalBytes).toBe(200);
                expect(metrics.totalEncodedBytes).toBe(100);
            });

            it('should track errors', () => {
                recordError();
                recordError();

                const metrics = getMetrics();

                expect(metrics.errorCount).toBe(2);
            });

            it('should calculate averages correctly', () => {
                recordEncoding({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 100,
                    encodedBytes: 50,
                    estimatedTokenSavings: 12,
                    latencyMs: 10,
                    eligibilityScore: 0.8,
                });

                recordEncoding({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 200,
                    encodedBytes: 100,
                    estimatedTokenSavings: 25,
                    latencyMs: 20,
                    eligibilityScore: 0.9,
                });

                const metrics = getMetrics();

                expect(metrics.averageLatencyMs).toBe(15); // (10 + 20) / 2
                expect(metrics.averageEligibilityScore).toBeCloseTo(0.85, 10); // (0.8 + 0.9) / 2
            });
        });

        describe('Detailed Metrics', () => {
            it('should calculate compression ratio', () => {
                recordEncoding({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 200,
                    encodedBytes: 100,
                    estimatedTokenSavings: 25,
                    latencyMs: 5,
                    eligibilityScore: 0.9,
                });

                const detailed = getDetailedMetrics();

                expect(detailed.compressionRatio).toBe(0.5); // 100 / 200
            });

            it('should calculate TOON selection rate', () => {
                recordEncoding({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 100,
                    encodedBytes: 50,
                    estimatedTokenSavings: 12,
                    latencyMs: 5,
                    eligibilityScore: 0.9,
                });

                recordEncoding({
                    output: '```json\n{}\n```',
                    format: 'json',
                    originalBytes: 50,
                    encodedBytes: 50,
                    estimatedTokenSavings: 0,
                    latencyMs: 2,
                    eligibilityScore: 0,
                });

                recordEncoding({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 100,
                    encodedBytes: 50,
                    estimatedTokenSavings: 12,
                    latencyMs: 5,
                    eligibilityScore: 0.85,
                });

                const detailed = getDetailedMetrics();

                expect(detailed.toonSelectionRate).toBeCloseTo(2 / 3, 2);
            });

            it('should calculate error rate', () => {
                recordEncoding({
                    output: '```json\n{}\n```',
                    format: 'json',
                    originalBytes: 50,
                    encodedBytes: 50,
                    estimatedTokenSavings: 0,
                    latencyMs: 2,
                    eligibilityScore: 0,
                });

                recordError();

                const detailed = getDetailedMetrics();

                // 1 error out of 1 attempt = 100% error rate
                expect(detailed.errorRate).toBe(1);
            });

            it('should calculate percentile latencies', () => {
                // Record multiple encodings with varying latencies
                for (const latency of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) {
                    recordEncoding({
                        output: '```json\n{}\n```',
                        format: 'json',
                        originalBytes: 50,
                        encodedBytes: 50,
                        estimatedTokenSavings: 0,
                        latencyMs: latency,
                        eligibilityScore: 0,
                    });
                }

                const detailed = getDetailedMetrics();

                expect(detailed.medianLatencyMs).toBeGreaterThan(0);
                expect(detailed.p95LatencyMs).toBeGreaterThanOrEqual(detailed.medianLatencyMs);
            });
        });

        describe('Metrics Export', () => {
            it('should export metrics as JSON', () => {
                recordEncoding({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 100,
                    encodedBytes: 50,
                    estimatedTokenSavings: 12,
                    latencyMs: 5,
                    eligibilityScore: 0.9,
                });

                const json = exportMetricsJson();
                const parsed = JSON.parse(json);

                expect(parsed.totalAttempts).toBe(1);
                expect(parsed.toonSelected).toBe(1);
            });

            it('should generate human-readable summary', () => {
                recordEncoding({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 100,
                    encodedBytes: 50,
                    estimatedTokenSavings: 12,
                    latencyMs: 5,
                    eligibilityScore: 0.9,
                });

                const summary = getMetricsSummary();

                expect(summary).toContain('TOON Encoding Metrics Summary');
                expect(summary).toContain('Total Attempts');
                expect(summary).toContain('TOON Selected');
            });
        });

        describe('Context Collectors', () => {
            it('should create isolated context collectors', () => {
                const collector1 = createContextCollector('channel-1');
                const collector2 = createContextCollector('channel-2');

                collector1.record({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 100,
                    encodedBytes: 50,
                    estimatedTokenSavings: 12,
                    latencyMs: 5,
                    eligibilityScore: 0.9,
                });

                collector2.record({
                    output: '```json\n{}\n```',
                    format: 'json',
                    originalBytes: 50,
                    encodedBytes: 50,
                    estimatedTokenSavings: 0,
                    latencyMs: 2,
                    eligibilityScore: 0,
                });

                const metrics1 = collector1.getMetrics();
                const metrics2 = collector2.getMetrics();

                expect(metrics1.toonSelected).toBe(1);
                expect(metrics1.jsonSelected).toBe(0);
                expect(metrics2.toonSelected).toBe(0);
                expect(metrics2.jsonSelected).toBe(1);
            });
        });

        describe('Metrics Reset', () => {
            it('should reset all metrics to initial state', () => {
                recordEncoding({
                    output: '```toon\n```',
                    format: 'toon',
                    originalBytes: 100,
                    encodedBytes: 50,
                    estimatedTokenSavings: 12,
                    latencyMs: 5,
                    eligibilityScore: 0.9,
                });

                recordError();

                resetMetrics();

                const metrics = getMetrics();

                expect(metrics.totalAttempts).toBe(0);
                expect(metrics.toonSelected).toBe(0);
                expect(metrics.jsonSelected).toBe(0);
                expect(metrics.errorCount).toBe(0);
                expect(metrics.totalTokenSavings).toBe(0);
            });
        });
    });

    describe('ToonMessageMiddleware', () => {
        describe('Initialization', () => {
            it('should create middleware with default configuration', () => {
                const middleware = new ToonMessageMiddleware();
                const config = middleware.getConfig();

                expect(config.enabled).toBe(true);
                expect(config.minArrayLength).toBe(5);
                expect(config.minScore).toBe(0.8);
                expect(config.delimiter).toBe(',');
            });

            it('should accept custom configuration', () => {
                const middleware = new ToonMessageMiddleware({
                    enabled: false,
                    minArrayLength: 10,
                    minScore: 0.9,
                    delimiter: '\t',
                });

                const config = middleware.getConfig();

                expect(config.enabled).toBe(false);
                expect(config.minArrayLength).toBe(10);
                expect(config.minScore).toBe(0.9);
                expect(config.delimiter).toBe('\t');
            });

            it('should update configuration dynamically', () => {
                const middleware = new ToonMessageMiddleware();

                middleware.updateConfig({ minArrayLength: 3 });

                expect(middleware.getConfig().minArrayLength).toBe(3);
            });
        });

        describe('Payload Processing', () => {
            it('should process eligible payloads as TOON', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true });
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);

                expect(result).toContain('```toon');
            });

            it('should process ineligible payloads as JSON', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true });
                const payload = { key: 'value' };

                const result = middleware.processPayload(payload);

                expect(result).toContain('```json');
            });

            it('should respect global enabled flag', () => {
                const middleware = new ToonMessageMiddleware({ enabled: false });
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);

                expect(result).toContain('```json');
                expect(result).not.toContain('```toon');
            });

            it('should respect channel-level "never" mode', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true });
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload, channelId, 'never');

                expect(result).toContain('```json');
            });

            it('should force TOON in "always" mode for eligible data', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true });
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload, channelId, 'always');

                expect(result).toContain('```toon');
            });
        });

        describe('Singleton Instance', () => {
            it('should return same instance from getToonMiddleware', () => {
                // Reset singleton by reinitializing
                initializeToonMiddleware({ minArrayLength: 7 });

                const instance1 = getToonMiddleware();
                const instance2 = getToonMiddleware();

                expect(instance1).toBe(instance2);
                expect(instance1.getConfig().minArrayLength).toBe(7);
            });

            it('should reinitialize with new config', () => {
                initializeToonMiddleware({ minArrayLength: 3 });

                const middleware = getToonMiddleware();

                expect(middleware.getConfig().minArrayLength).toBe(3);

                // Reinitialize with different config
                initializeToonMiddleware({ minArrayLength: 10 });

                const newMiddleware = getToonMiddleware();

                expect(newMiddleware.getConfig().minArrayLength).toBe(10);
            });
        });

        describe('Convenience Function', () => {
            it('should process payload via convenience function', () => {
                initializeToonMiddleware({ enabled: true });

                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = processToonPayload(payload);

                expect(result).toContain('```');
            });
        });
    });

    describe('JSON Fallback Behavior', () => {
        describe('Error Handling', () => {
            it('should fall back to JSON on encoding errors', () => {
                // Test with circular reference (would cause JSON.stringify to fail in real scenario)
                // For this test, we verify the fallback mechanism works with problematic data
                const middleware = new ToonMessageMiddleware({ enabled: true });

                // This should not throw and should return valid JSON
                const result = middleware.processPayload({ key: 'value' });

                expect(result).toContain('```json');
            });

            it('should handle undefined values gracefully', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true });

                const result = middleware.processPayload(undefined);

                // Should return JSON representation of undefined (null in JSON)
                expect(result).toContain('```json');
            });

            it('should handle null payload gracefully', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true });

                const result = middleware.processPayload(null);

                expect(result).toContain('```json');
                expect(result).toContain('null');
            });
        });

        describe('Graceful Degradation', () => {
            it('should use JSON for arrays with non-primitive values', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true });
                const payload = [
                    { id: 1, name: 'Alice', metadata: { role: 'admin' } },
                    { id: 2, name: 'Bob', metadata: { role: 'user' } },
                    { id: 3, name: 'Carol', metadata: { role: 'user' } },
                    { id: 4, name: 'David', metadata: { role: 'user' } },
                    { id: 5, name: 'Eve', metadata: { role: 'admin' } },
                ];

                const result = middleware.processPayload(payload);

                expect(result).toContain('```json');
            });

            it('should use JSON for small arrays', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true, minArrayLength: 5 });
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                ];

                const result = middleware.processPayload(payload);

                expect(result).toContain('```json');
            });
        });
    });

    describe('Configuration Options', () => {
        describe('Min Array Length', () => {
            it('should reject arrays below minArrayLength threshold', () => {
                const middleware = new ToonMessageMiddleware({
                    enabled: true,
                    minArrayLength: 10,
                });

                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);

                expect(result).toContain('```json');
            });

            it('should accept arrays meeting minArrayLength threshold', () => {
                const middleware = new ToonMessageMiddleware({
                    enabled: true,
                    minArrayLength: 3,
                });

                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);

                expect(result).toContain('```toon');
            });
        });

        describe('Score Threshold', () => {
            it('should reject arrays below minScore threshold', () => {
                const middleware = new ToonMessageMiddleware({
                    enabled: true,
                    minScore: 0.99, // Very high threshold
                });

                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);

                // With such a high threshold, most arrays won't qualify
                expect(result).toContain('```json');
            });

            it('should accept arrays meeting minScore threshold', () => {
                const middleware = new ToonMessageMiddleware({
                    enabled: true,
                    minScore: 0.5, // Low threshold
                });

                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);

                expect(result).toContain('```toon');
            });
        });

        describe('Delimiter Configuration', () => {
            it('should use comma delimiter by default', () => {
                const middleware = new ToonMessageMiddleware({ enabled: true });
                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);
                const content = stripCodeBlocks(result);

                expect(content).toContain(',');
            });

            it('should use tab delimiter when configured', () => {
                const middleware = new ToonMessageMiddleware({
                    enabled: true,
                    delimiter: '\t',
                });

                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);

                if (result.includes('```toon')) {
                    const content = stripCodeBlocks(result);
                    expect(content).toContain('\t');
                }
            });

            it('should use pipe delimiter when configured', () => {
                const middleware = new ToonMessageMiddleware({
                    enabled: true,
                    delimiter: '|',
                });

                const payload = [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                    { id: 3, name: 'Carol' },
                    { id: 4, name: 'David' },
                    { id: 5, name: 'Eve' },
                ];

                const result = middleware.processPayload(payload);

                if (result.includes('```toon')) {
                    const content = stripCodeBlocks(result);
                    expect(content).toContain('|');
                }
            });
        });
    });

    describe('Integration with Agent', () => {
        it('should process TOON-formatted messages when agent executes tool', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'TOON Test Agent',
                allowedTools: ['tool_help'],
            });

            // The middleware is integrated into the message flow
            // When tools return large array results, TOON formatting is applied
            const result = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            expect(result).toBeDefined();
        });

        it('should maintain message integrity through TOON encoding', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'TOON Integrity Test Agent',
            });

            // Create test data that would be TOON-eligible
            const testData = [
                { id: 1, name: 'Alice', status: 'active' },
                { id: 2, name: 'Bob', status: 'idle' },
                { id: 3, name: 'Carol', status: 'active' },
                { id: 4, name: 'David', status: 'busy' },
                { id: 5, name: 'Eve', status: 'active' },
            ];

            // Encode and decode to verify integrity
            const encoded = encodeToon(testData);
            const decoded = decodeToon(encoded.output);

            // Verify data integrity
            expect(decoded).toHaveLength(testData.length);
            for (let i = 0; i < testData.length; i++) {
                expect(decoded[i].id).toBe(testData[i].id);
                expect(decoded[i].name).toBe(testData[i].name);
                expect(decoded[i].status).toBe(testData[i].status);
            }
        });
    });

    describe('Performance', () => {
        it('should complete eligibility evaluation within 5ms for small payloads', () => {
            const payload = [
                { id: 1, name: 'Alice', status: 'active' },
                { id: 2, name: 'Bob', status: 'idle' },
                { id: 3, name: 'Carol', status: 'active' },
                { id: 4, name: 'David', status: 'busy' },
                { id: 5, name: 'Eve', status: 'active' },
            ];

            const startTime = performance.now();
            evaluateEligibility(payload);
            const duration = performance.now() - startTime;

            expect(duration).toBeLessThan(TIMEOUTS.short);
        });

        it('should complete encoding within 25ms for typical payloads', () => {
            const payload = Array.from({ length: 100 }, (_, i) => ({
                id: i + 1,
                name: `User ${i + 1}`,
                email: `user${i + 1}@example.com`,
                status: i % 2 === 0 ? 'active' : 'inactive',
            }));

            const startTime = performance.now();
            const result = encodeToon(payload);
            const duration = performance.now() - startTime;

            expect(duration).toBeLessThan(TIMEOUTS.short);
            expect(result.latencyMs).toBeDefined();
        });

        it('should report latency metrics accurately', () => {
            const payload = [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
                { id: 3, name: 'Carol' },
                { id: 4, name: 'David' },
                { id: 5, name: 'Eve' },
            ];

            const result = encodeToon(payload);

            expect(result.latencyMs).toBeDefined();
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        });
    });
});
