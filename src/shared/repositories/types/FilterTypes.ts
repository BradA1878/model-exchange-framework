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

/**
 * Generic filter options for repository queries.
 * Database adapters translate these to native query syntax.
 */
export interface FilterOptions<T> {
    /** Field equality filters */
    where?: Partial<Record<keyof T, any>>;

    /** Comparison filters */
    comparisons?: ComparisonFilter<T>[];

    /** Array containment filters */
    arrayContains?: ArrayContainsFilter<T>[];

    /** Text search (if supported) */
    textSearch?: string;

    /** Logical OR of multiple filter sets */
    or?: FilterOptions<T>[];

    /** Logical AND of multiple filter sets */
    and?: FilterOptions<T>[];
}

/**
 * Comparison filter for specific field operations
 */
export interface ComparisonFilter<T> {
    field: keyof T;
    operator: ComparisonOperator;
    value: any;
}

/**
 * Comparison operators supported across database adapters
 */
export type ComparisonOperator =
    | 'eq'      // equals
    | 'ne'      // not equals
    | 'gt'      // greater than
    | 'gte'     // greater than or equal
    | 'lt'      // less than
    | 'lte'     // less than or equal
    | 'in'      // in array
    | 'nin'     // not in array
    | 'like'    // pattern match (SQL LIKE)
    | 'regex';  // regex match

/**
 * Array containment filter
 */
export interface ArrayContainsFilter<T> {
    field: keyof T;
    value: any;
    mode: 'any' | 'all'; // contains any of values, or all values
}

/**
 * Date range filter
 */
export interface DateRange {
    start?: Date;
    end?: Date;
}

/**
 * Time granularity for analytics queries
 */
export type TimeGranularity = 'hour' | 'day' | 'week' | 'month' | 'year';
