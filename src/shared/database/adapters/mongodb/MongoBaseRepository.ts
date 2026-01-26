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

import { Model, Document, FilterQuery, UpdateQuery } from 'mongoose';
import { IBaseRepository } from '../../../repositories/interfaces/IBaseRepository';
import { FilterOptions, ComparisonOperator } from '../../../repositories/types/FilterTypes';
import { PaginationOptions, PaginatedResult } from '../../../repositories/types/PaginationTypes';

/**
 * Base MongoDB repository implementation.
 * Provides common CRUD operations using Mongoose.
 * Subclasses must implement toEntity() to convert MongoDB documents to domain entities.
 */
export abstract class MongoBaseRepository<T, D extends Document, CreateDTO = Partial<T>, UpdateDTO = Partial<T>>
    implements IBaseRepository<T, CreateDTO, UpdateDTO> {

    constructor(protected readonly model: Model<D>) {}

    /**
     * Find a single entity by its MongoDB _id
     */
    async findById(id: string): Promise<T | null> {
        const doc = await this.model.findById(id).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Find a single entity matching the filter
     */
    async findOne(filter: FilterOptions<T>): Promise<T | null> {
        const mongoFilter = this.buildMongoFilter(filter);
        const doc = await this.model.findOne(mongoFilter).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Find multiple entities with pagination
     */
    async findMany(
        filter?: FilterOptions<T>,
        pagination?: PaginationOptions
    ): Promise<PaginatedResult<T>> {
        const mongoFilter = filter ? this.buildMongoFilter(filter) : {};
        const { limit = 20, offset = 0, sortBy, sortOrder = 'desc' } = pagination || {};

        const [docs, total] = await Promise.all([
            this.model
                .find(mongoFilter)
                .sort(sortBy ? { [sortBy]: sortOrder === 'asc' ? 1 : -1 } : { createdAt: -1 })
                .skip(offset)
                .limit(limit)
                .lean(),
            this.model.countDocuments(mongoFilter)
        ]);

        return {
            items: docs.map(doc => this.toEntity(doc)),
            total,
            hasMore: offset + docs.length < total,
            pagination: {
                limit,
                offset,
                page: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Create a new entity
     */
    async create(data: CreateDTO): Promise<T> {
        const doc = await this.model.create(data);
        return this.toEntity(doc.toObject());
    }

    /**
     * Update an existing entity by ID
     */
    async update(id: string, data: UpdateDTO): Promise<T | null> {
        const doc = await this.model.findByIdAndUpdate(
            id,
            { $set: data } as UpdateQuery<D>,
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Delete an entity by ID
     */
    async delete(id: string): Promise<boolean> {
        const result = await this.model.deleteOne({ _id: id } as any);
        return result.deletedCount > 0;
    }

    /**
     * Count entities matching the filter
     */
    async count(filter?: FilterOptions<T>): Promise<number> {
        const mongoFilter = filter ? this.buildMongoFilter(filter) : {};
        return this.model.countDocuments(mongoFilter);
    }

    /**
     * Check if an entity exists matching the filter
     */
    async exists(filter: FilterOptions<T>): Promise<boolean> {
        const mongoFilter = this.buildMongoFilter(filter);
        const doc = await this.model.findOne(mongoFilter).select('_id').lean();
        return doc !== null;
    }

    /**
     * Convert Mongoose document to domain entity.
     * Subclasses must implement this method for custom mapping.
     */
    protected abstract toEntity(doc: any): T;

    /**
     * Build MongoDB filter from generic FilterOptions.
     * Translates database-agnostic filter to Mongoose query format.
     */
    protected buildMongoFilter(filter: FilterOptions<T>): FilterQuery<D> {
        const mongoFilter: any = {};

        // Direct equality filters
        if (filter.where) {
            Object.assign(mongoFilter, filter.where);
        }

        // Comparison filters
        if (filter.comparisons) {
            for (const comp of filter.comparisons) {
                const mongoOp = this.mapComparisonOperator(comp.operator);
                mongoFilter[comp.field] = { [mongoOp]: comp.value };
            }
        }

        // Array contains filters
        if (filter.arrayContains) {
            for (const arr of filter.arrayContains) {
                if (arr.mode === 'any') {
                    mongoFilter[arr.field] = { $in: Array.isArray(arr.value) ? arr.value : [arr.value] };
                } else {
                    mongoFilter[arr.field] = { $all: Array.isArray(arr.value) ? arr.value : [arr.value] };
                }
            }
        }

        // Text search
        if (filter.textSearch) {
            mongoFilter.$text = { $search: filter.textSearch };
        }

        // OR conditions
        if (filter.or && filter.or.length > 0) {
            mongoFilter.$or = filter.or.map(f => this.buildMongoFilter(f));
        }

        // AND conditions
        if (filter.and && filter.and.length > 0) {
            mongoFilter.$and = filter.and.map(f => this.buildMongoFilter(f));
        }

        return mongoFilter as FilterQuery<D>;
    }

    /**
     * Map comparison operator to MongoDB operator
     */
    private mapComparisonOperator(op: ComparisonOperator): string {
        const mapping: Record<string, string> = {
            'eq': '$eq',
            'ne': '$ne',
            'gt': '$gt',
            'gte': '$gte',
            'lt': '$lt',
            'lte': '$lte',
            'in': '$in',
            'nin': '$nin',
            'regex': '$regex'
        };
        return mapping[op] || '$eq';
    }
}
