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
 * Entity Mongoose Model
 *
 * Represents entities in the Knowledge Graph.
 * Includes MULS utility fields for Q-value learning.
 */

import mongoose, { Schema, Document } from 'mongoose';
import {
    EntityType,
    EntityUtility,
    DEFAULT_ENTITY_UTILITY,
} from '../types/KnowledgeGraphTypes';

/**
 * Entity document interface
 */
export interface IEntity extends Document {
    channelId: string;
    type: EntityType;
    name: string;
    aliases: string[];
    description?: string;
    properties: Map<string, any>;
    utility: EntityUtility;
    confidence: number;
    source: string;
    sourceMemoryIds: string[];
    createdAt: Date;
    updatedAt: Date;
    merged: boolean;
    mergedInto?: string;
    customType?: string;
}

/**
 * Entity utility schema
 */
const EntityUtilitySchema = new Schema(
    {
        qValue: { type: Number, default: 0.5 },
        retrievalCount: { type: Number, default: 0 },
        successCount: { type: Number, default: 0 },
        failureCount: { type: Number, default: 0 },
        lastAccessedAt: { type: Number, default: 0 },
        lastQValueUpdateAt: { type: Number, default: 0 },
        qValueConfidence: { type: Number, default: 0 },
    },
    { _id: false }
);

/**
 * Entity schema
 */
const EntitySchema = new Schema<IEntity>(
    {
        channelId: {
            type: String,
            required: true,
            index: true,
        },
        type: {
            type: String,
            required: true,
            enum: Object.values(EntityType),
            index: true,
        },
        name: {
            type: String,
            required: true,
        },
        aliases: {
            type: [String],
            default: [],
        },
        description: {
            type: String,
        },
        properties: {
            type: Map,
            of: Schema.Types.Mixed,
            default: new Map(),
        },
        utility: {
            type: EntityUtilitySchema,
            default: () => ({ ...DEFAULT_ENTITY_UTILITY }),
        },
        confidence: {
            type: Number,
            default: 1.0,
            min: 0,
            max: 1,
        },
        source: {
            type: String,
            required: true,
            default: 'manual',
        },
        sourceMemoryIds: {
            type: [String],
            default: [],
        },
        merged: {
            type: Boolean,
            default: false,
            index: true,
        },
        mergedInto: {
            type: String,
        },
        customType: {
            type: String,
        },
    },
    {
        timestamps: true,
        collection: 'entities',
    }
);

// Compound indexes for common queries
EntitySchema.index({ channelId: 1, type: 1 });
EntitySchema.index({ channelId: 1, 'utility.qValue': -1 });
EntitySchema.index({ channelId: 1, merged: 1 });
EntitySchema.index({ sourceMemoryIds: 1 });

// Text index for name and aliases search
EntitySchema.index(
    { name: 'text', aliases: 'text', description: 'text' },
    {
        weights: { name: 10, aliases: 5, description: 1 },
        name: 'entity_text_index'
    }
);

// Index for Q-value queries
EntitySchema.index({ channelId: 1, merged: 1, 'utility.qValue': -1 });

/**
 * Pre-save middleware to update timestamps in utility
 */
EntitySchema.pre('save', function (next) {
    if (this.isNew) {
        this.utility.lastAccessedAt = Date.now();
    }
    next();
});

/**
 * Entity model
 */
export const EntityModel = mongoose.model<IEntity>('Entity', EntitySchema);

/**
 * Helper function to convert document to plain Entity object
 */
export function toEntityObject(doc: IEntity): any {
    return {
        id: doc._id?.toString() || doc.id,
        channelId: doc.channelId,
        type: doc.type,
        name: doc.name,
        aliases: doc.aliases,
        description: doc.description,
        properties: doc.properties instanceof Map
            ? Object.fromEntries(doc.properties)
            : doc.properties || {},
        utility: {
            qValue: doc.utility?.qValue ?? DEFAULT_ENTITY_UTILITY.qValue,
            retrievalCount: doc.utility?.retrievalCount ?? 0,
            successCount: doc.utility?.successCount ?? 0,
            failureCount: doc.utility?.failureCount ?? 0,
            lastAccessedAt: doc.utility?.lastAccessedAt ?? 0,
            lastQValueUpdateAt: doc.utility?.lastQValueUpdateAt ?? 0,
            qValueConfidence: doc.utility?.qValueConfidence ?? 0,
        },
        confidence: doc.confidence,
        source: doc.source,
        sourceMemoryIds: doc.sourceMemoryIds,
        createdAt: doc.createdAt?.getTime() || Date.now(),
        updatedAt: doc.updatedAt?.getTime() || Date.now(),
        merged: doc.merged,
        mergedInto: doc.mergedInto,
        customType: doc.customType,
    };
}
