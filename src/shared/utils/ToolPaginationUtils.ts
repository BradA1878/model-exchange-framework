/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

import { Logger } from './Logger';

/**
 * Tool Pagination Utilities
 *
 * Provides a reusable pagination framework for MCP tools with large result detection
 * and LLM feedback. This helps prevent overwhelming the LLM's context window with
 * excessively large tool results.
 *
 * Features:
 * - Standard pagination input schema properties for tool definitions
 * - Helper function to paginate arrays with metadata
 * - Size checking with warning thresholds
 * - Automatic pagination hints for large results
 */

/**
 * Standard pagination input schema properties for tool definitions.
 * Spread these into your tool's inputSchema.properties to add pagination support.
 *
 * @example
 * inputSchema: {
 *   type: 'object',
 *   properties: {
 *     searchTerm: { type: 'string' },
 *     ...paginationInputSchema
 *   }
 * }
 */
export const paginationInputSchema = {
    limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50)',
        default: 50,
        minimum: 1,
        maximum: 500
    },
    offset: {
        type: 'number',
        description: 'Number of results to skip for pagination (default: 0)',
        default: 0,
        minimum: 0
    }
};

/**
 * Pagination metadata included in paginated responses.
 * Provides the LLM with information about total results and how to get more.
 */
export interface PaginationMetadata {
    /** Total number of items before pagination was applied */
    totalCount: number;
    /** The limit that was applied (may differ from requested if clamped) */
    limit: number;
    /** The offset that was applied */
    offset: number;
    /** Whether more results exist beyond the current page */
    hasMore: boolean;
    /** Convenience field: the offset value to use for the next page (only present if hasMore is true) */
    nextOffset?: number;
}

/**
 * Result of paginating an array.
 */
export interface PaginatedResult<T> {
    /** The paginated subset of items */
    items: T[];
    /** Pagination metadata for the response */
    pagination: PaginationMetadata;
}

/**
 * Pagination hint added to results that exceed size thresholds.
 * Provides guidance to the LLM on how to use pagination to get manageable chunks.
 */
export interface PaginationHint {
    /** Warning message about the large result */
    warning: string;
    /** Size of the result in bytes */
    resultSize: number;
    /** The threshold that was exceeded */
    threshold: number;
    /** Suggested pagination parameters */
    suggestion: string;
}

/**
 * Size thresholds for result checking.
 * Results exceeding these sizes may impact LLM context window efficiency.
 *
 * Thresholds tuned based on demo testing with LSP code intelligence tools
 * which typically return 9-10KB results. These thresholds ensure meaningful
 * pagination hints are provided for typical large tool results.
 */
export const RESULT_SIZE_THRESHOLDS = {
    /** Log a warning at this size (bytes) */
    WARNING: 5000,
    /** Add pagination hint at this size (bytes) */
    CRITICAL: 8000
};

/**
 * Paginate an array and return both the paginated items and metadata.
 *
 * @param items - The full array of items to paginate
 * @param limit - Maximum number of items to return (default: 50, clamped to 1-500)
 * @param offset - Number of items to skip (default: 0, clamped to >= 0)
 * @returns Paginated items and metadata
 *
 * @example
 * const allFunctions = await findAllFunctions();
 * const { items: functions, pagination } = paginateArray(allFunctions, args.limit, args.offset);
 * return {
 *   success: true,
 *   functions,
 *   ...pagination  // totalCount, limit, offset, hasMore, nextOffset
 * };
 */
export function paginateArray<T>(
    items: T[],
    limit: number = 50,
    offset: number = 0
): PaginatedResult<T> {
    // Clamp limit to valid range
    const clampedLimit = Math.max(1, Math.min(500, limit));
    // Clamp offset to non-negative
    const clampedOffset = Math.max(0, offset);

    const totalCount = items.length;
    const paginatedItems = items.slice(clampedOffset, clampedOffset + clampedLimit);
    const hasMore = clampedOffset + clampedLimit < totalCount;

    return {
        items: paginatedItems,
        pagination: {
            totalCount,
            limit: clampedLimit,
            offset: clampedOffset,
            hasMore,
            ...(hasMore ? { nextOffset: clampedOffset + clampedLimit } : {})
        }
    };
}

/**
 * Check the size of a tool result and add a pagination hint if it exceeds the critical threshold.
 * Also logs warnings for large results.
 *
 * @param result - The tool result object to check
 * @param toolName - Name of the tool for logging
 * @param logger - Logger instance to use for warnings
 * @returns The original result, possibly with a _paginationHint property added
 *
 * @example
 * const result = { success: true, functions: [...], totalCount: 500 };
 * return checkResultSize(result, 'find_functions', logger);
 */
export function checkResultSize<T extends object>(
    result: T,
    toolName: string,
    logger: Logger
): T & { _paginationHint?: PaginationHint } {
    const resultString = JSON.stringify(result);
    const resultSize = resultString.length;

    if (resultSize > RESULT_SIZE_THRESHOLDS.CRITICAL) {
        logger.warn(`LARGE TOOL RESULT: ${toolName} returned ${resultSize} bytes - may impact LLM context window. Consider using limit/offset pagination.`);

        return {
            ...result,
            _paginationHint: {
                warning: 'Large result detected. Use limit/offset parameters to paginate.',
                resultSize,
                threshold: RESULT_SIZE_THRESHOLDS.CRITICAL,
                suggestion: 'Try adding { "limit": 25, "offset": 0 } to get first 25 results, then increment offset for more.'
            }
        };
    } else if (resultSize > RESULT_SIZE_THRESHOLDS.WARNING) {
        logger.warn(`LARGE TOOL RESULT: ${toolName} returned ${resultSize} bytes - approaching context window impact threshold.`);
    }

    return result;
}

/**
 * Convenience function to apply pagination to multiple arrays within a result.
 * Useful for tools that return multiple lists (e.g., imports, exports, dependents).
 *
 * @param arrays - Object mapping array names to arrays
 * @param limit - Limit to apply to each array
 * @param offset - Offset to apply to each array
 * @returns Object with paginated arrays and combined metadata
 *
 * @example
 * const {
 *   paginatedArrays: { imports, exports, dependents },
 *   metadata
 * } = paginateMultipleArrays(
 *   { imports: allImports, exports: allExports, dependents: allDependents },
 *   args.limit,
 *   args.offset
 * );
 */
export function paginateMultipleArrays<T extends Record<string, any[]>>(
    arrays: T,
    limit: number = 50,
    offset: number = 0
): {
    paginatedArrays: T;
    metadata: {
        [K in keyof T]: PaginationMetadata;
    } & { combinedTotalCount: number; anyHasMore: boolean };
} {
    const paginatedArrays: any = {};
    const metadata: any = { combinedTotalCount: 0, anyHasMore: false };

    for (const [key, items] of Object.entries(arrays)) {
        const { items: paginatedItems, pagination } = paginateArray(items, limit, offset);
        paginatedArrays[key] = paginatedItems;
        metadata[key] = pagination;
        metadata.combinedTotalCount += pagination.totalCount;
        if (pagination.hasMore) {
            metadata.anyHasMore = true;
        }
    }

    return {
        paginatedArrays,
        metadata
    };
}
