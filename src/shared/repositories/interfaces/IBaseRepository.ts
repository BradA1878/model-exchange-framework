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

import { PaginationOptions, PaginatedResult } from '../types/PaginationTypes';
import { FilterOptions } from '../types/FilterTypes';

/**
 * Base repository interface that all domain repositories extend.
 * Provides common CRUD operations.
 *
 * @typeParam T - The domain entity type
 * @typeParam CreateDTO - The type for creating new entities
 * @typeParam UpdateDTO - The type for updating entities
 */
export interface IBaseRepository<T, CreateDTO = Partial<T>, UpdateDTO = Partial<T>> {
    /**
     * Find a single entity by its unique identifier
     */
    findById(id: string): Promise<T | null>;

    /**
     * Find multiple entities matching the filter criteria
     */
    findMany(filter?: FilterOptions<T>, pagination?: PaginationOptions): Promise<PaginatedResult<T>>;

    /**
     * Find a single entity matching the filter criteria
     */
    findOne(filter: FilterOptions<T>): Promise<T | null>;

    /**
     * Create a new entity
     */
    create(data: CreateDTO): Promise<T>;

    /**
     * Update an existing entity by ID
     */
    update(id: string, data: UpdateDTO): Promise<T | null>;

    /**
     * Delete an entity by ID
     */
    delete(id: string): Promise<boolean>;

    /**
     * Count entities matching the filter
     */
    count(filter?: FilterOptions<T>): Promise<number>;

    /**
     * Check if an entity exists
     */
    exists(filter: FilterOptions<T>): Promise<boolean>;
}
