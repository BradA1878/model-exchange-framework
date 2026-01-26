/**
 * Unit tests for ToolPaginationUtils
 * Tests pagination logic, edge cases, and size checking
 */

import {
    paginateArray,
    paginateMultipleArrays,
    checkResultSize,
    paginationInputSchema,
    RESULT_SIZE_THRESHOLDS,
    PaginatedResult,
    PaginationMetadata
} from '@mxf/shared/utils/ToolPaginationUtils';
import { Logger } from '@mxf/shared/utils/Logger';

// Mock Logger
jest.mock('@mxf/shared/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }))
}));

describe('ToolPaginationUtils', () => {
    describe('paginationInputSchema', () => {
        it('has correct structure for limit property', () => {
            expect(paginationInputSchema.limit).toEqual({
                type: 'number',
                description: expect.any(String),
                default: 50,
                minimum: 1,
                maximum: 500
            });
        });

        it('has correct structure for offset property', () => {
            expect(paginationInputSchema.offset).toEqual({
                type: 'number',
                description: expect.any(String),
                default: 0,
                minimum: 0
            });
        });
    });

    describe('paginateArray', () => {
        const testArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        describe('basic pagination', () => {
            it('returns first page with default parameters', () => {
                const result = paginateArray(testArray);
                expect(result.items).toEqual(testArray);
                expect(result.pagination.totalCount).toBe(10);
                expect(result.pagination.limit).toBe(50);
                expect(result.pagination.offset).toBe(0);
                expect(result.pagination.hasMore).toBe(false);
            });

            it('returns correct subset with limit', () => {
                const result = paginateArray(testArray, 3);
                expect(result.items).toEqual([1, 2, 3]);
                expect(result.pagination.totalCount).toBe(10);
                expect(result.pagination.limit).toBe(3);
                expect(result.pagination.hasMore).toBe(true);
                expect(result.pagination.nextOffset).toBe(3);
            });

            it('returns correct subset with limit and offset', () => {
                const result = paginateArray(testArray, 3, 3);
                expect(result.items).toEqual([4, 5, 6]);
                expect(result.pagination.offset).toBe(3);
                expect(result.pagination.hasMore).toBe(true);
                expect(result.pagination.nextOffset).toBe(6);
            });

            it('returns last page correctly', () => {
                const result = paginateArray(testArray, 3, 9);
                expect(result.items).toEqual([10]);
                expect(result.pagination.hasMore).toBe(false);
                expect(result.pagination.nextOffset).toBeUndefined();
            });
        });

        describe('edge cases', () => {
            it('handles empty array', () => {
                const result = paginateArray([]);
                expect(result.items).toEqual([]);
                expect(result.pagination.totalCount).toBe(0);
                expect(result.pagination.hasMore).toBe(false);
            });

            it('handles offset beyond array length', () => {
                const result = paginateArray(testArray, 5, 100);
                expect(result.items).toEqual([]);
                expect(result.pagination.totalCount).toBe(10);
                expect(result.pagination.offset).toBe(100);
                expect(result.pagination.hasMore).toBe(false);
            });

            it('handles exact pagination boundary', () => {
                const result = paginateArray(testArray, 5, 5);
                expect(result.items).toEqual([6, 7, 8, 9, 10]);
                expect(result.pagination.hasMore).toBe(false);
            });
        });

        describe('limit clamping', () => {
            it('clamps limit below minimum to 1', () => {
                const result = paginateArray(testArray, 0);
                expect(result.pagination.limit).toBe(1);
                expect(result.items).toEqual([1]);
            });

            it('clamps negative limit to 1', () => {
                const result = paginateArray(testArray, -5);
                expect(result.pagination.limit).toBe(1);
            });

            it('clamps limit above maximum to 500', () => {
                const largeArray = Array.from({ length: 1000 }, (_, i) => i);
                const result = paginateArray(largeArray, 999);
                expect(result.pagination.limit).toBe(500);
                expect(result.items.length).toBe(500);
            });
        });

        describe('offset clamping', () => {
            it('clamps negative offset to 0', () => {
                const result = paginateArray(testArray, 5, -10);
                expect(result.pagination.offset).toBe(0);
                expect(result.items).toEqual([1, 2, 3, 4, 5]);
            });
        });
    });

    describe('paginateMultipleArrays', () => {
        const testArrays = {
            imports: [1, 2, 3, 4, 5],
            exports: ['a', 'b', 'c'],
            dependents: ['x', 'y', 'z', 'w']
        };

        it('paginates all arrays with same parameters', () => {
            const { paginatedArrays, metadata } = paginateMultipleArrays(testArrays, 2, 0);

            expect(paginatedArrays.imports).toEqual([1, 2]);
            expect(paginatedArrays.exports).toEqual(['a', 'b']);
            expect(paginatedArrays.dependents).toEqual(['x', 'y']);
        });

        it('calculates combined metadata correctly', () => {
            const { metadata } = paginateMultipleArrays(testArrays, 2, 0);

            expect(metadata.combinedTotalCount).toBe(12); // 5 + 3 + 4
            expect(metadata.anyHasMore).toBe(true);
        });

        it('provides per-array metadata', () => {
            const { metadata } = paginateMultipleArrays(testArrays, 2, 0);

            expect(metadata.imports.totalCount).toBe(5);
            expect(metadata.imports.hasMore).toBe(true);
            expect(metadata.exports.totalCount).toBe(3);
            expect(metadata.exports.hasMore).toBe(true);
            expect(metadata.dependents.totalCount).toBe(4);
            expect(metadata.dependents.hasMore).toBe(true);
        });

        it('handles empty arrays', () => {
            const { paginatedArrays, metadata } = paginateMultipleArrays(
                { empty: [], data: [1, 2, 3] },
                2,
                0
            );

            expect(paginatedArrays.empty).toEqual([]);
            expect(metadata.empty.totalCount).toBe(0);
            expect(metadata.empty.hasMore).toBe(false);
        });

        it('reports anyHasMore as false when no arrays have more', () => {
            const { metadata } = paginateMultipleArrays(testArrays, 50, 0);
            expect(metadata.anyHasMore).toBe(false);
        });
    });

    describe('checkResultSize', () => {
        let mockLogger: any;

        beforeEach(() => {
            mockLogger = {
                warn: jest.fn(),
                error: jest.fn(),
                info: jest.fn(),
                debug: jest.fn()
            };
        });

        it('returns result unchanged when below warning threshold', () => {
            const smallResult = { success: true, data: 'small' };
            const result = checkResultSize(smallResult, 'test_tool', mockLogger);

            expect(result).toEqual(smallResult);
            expect(result._paginationHint).toBeUndefined();
            expect(mockLogger.warn).not.toHaveBeenCalled();
        });

        it('logs warning when between warning and critical threshold', () => {
            // Create a result that exceeds warning (5000) but not critical (8000)
            const mediumData = 'x'.repeat(6000);
            const mediumResult = { success: true, data: mediumData };
            const result = checkResultSize(mediumResult, 'test_tool', mockLogger);

            expect(result._paginationHint).toBeUndefined();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('approaching context window impact threshold')
            );
        });

        it('adds pagination hint when exceeding critical threshold', () => {
            // Create a result that exceeds critical (8000)
            const largeData = 'x'.repeat(10000);
            const largeResult = { success: true, data: largeData };
            const result = checkResultSize(largeResult, 'test_tool', mockLogger);

            expect(result._paginationHint).toBeDefined();
            expect(result._paginationHint?.warning).toContain('Large result detected');
            expect(result._paginationHint?.threshold).toBe(RESULT_SIZE_THRESHOLDS.CRITICAL);
            expect(result._paginationHint?.suggestion).toContain('limit');
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('may impact LLM context window')
            );
        });

        it('preserves original result properties', () => {
            const largeData = 'x'.repeat(10000);
            const originalResult = {
                success: true,
                data: largeData,
                customField: 'preserved',
                nested: { key: 'value' }
            };
            const result = checkResultSize(originalResult, 'test_tool', mockLogger);

            expect(result.success).toBe(true);
            expect(result.customField).toBe('preserved');
            expect(result.nested).toEqual({ key: 'value' });
        });

        it('includes result size in pagination hint', () => {
            const largeData = 'x'.repeat(10000);
            const largeResult = { success: true, data: largeData };
            const result = checkResultSize(largeResult, 'test_tool', mockLogger);

            expect(result._paginationHint?.resultSize).toBeGreaterThan(RESULT_SIZE_THRESHOLDS.CRITICAL);
        });
    });

    describe('RESULT_SIZE_THRESHOLDS', () => {
        it('has warning threshold less than critical', () => {
            expect(RESULT_SIZE_THRESHOLDS.WARNING).toBeLessThan(RESULT_SIZE_THRESHOLDS.CRITICAL);
        });

        it('has reasonable default values', () => {
            expect(RESULT_SIZE_THRESHOLDS.WARNING).toBe(5000);
            expect(RESULT_SIZE_THRESHOLDS.CRITICAL).toBe(8000);
        });
    });
});
