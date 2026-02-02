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
 * Relationship Mongoose Model
 *
 * Represents relationships between entities in the Knowledge Graph.
 * Includes surprise score for unexpected relationship detection.
 */

import mongoose, { Schema, Document } from 'mongoose';
import { RelationshipType } from '../types/KnowledgeGraphTypes';

/**
 * Relationship document interface
 */
export interface IRelationship extends Document {
    channelId: string;
    fromEntityId: string;
    toEntityId: string;
    type: RelationshipType;
    label?: string;
    properties: Map<string, any>;
    confidence: number;
    surpriseScore: number;
    source: string;
    sourceMemoryIds: string[];
    createdAt: Date;
    updatedAt: Date;
    weight: number;
    customType?: string;
}

/**
 * Relationship schema
 */
const RelationshipSchema = new Schema<IRelationship>(
    {
        channelId: {
            type: String,
            required: true,
            index: true,
        },
        fromEntityId: {
            type: String,
            required: true,
            index: true,
        },
        toEntityId: {
            type: String,
            required: true,
            index: true,
        },
        type: {
            type: String,
            required: true,
            enum: Object.values(RelationshipType),
            index: true,
        },
        label: {
            type: String,
        },
        properties: {
            type: Map,
            of: Schema.Types.Mixed,
            default: new Map(),
        },
        confidence: {
            type: Number,
            default: 1.0,
            min: 0,
            max: 1,
        },
        surpriseScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
            index: true,
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
        weight: {
            type: Number,
            default: 1.0,
        },
        customType: {
            type: String,
        },
    },
    {
        timestamps: true,
        collection: 'relationships',
    }
);

// Compound indexes for efficient graph traversal
RelationshipSchema.index({ fromEntityId: 1, type: 1 });
RelationshipSchema.index({ toEntityId: 1, type: 1 });
RelationshipSchema.index({ channelId: 1, fromEntityId: 1, toEntityId: 1 });
RelationshipSchema.index({ channelId: 1, type: 1 });
RelationshipSchema.index({ sourceMemoryIds: 1 });

// Index for surprise-based queries
RelationshipSchema.index({ channelId: 1, surpriseScore: -1 });

// Ensure unique relationship between entities of same type
RelationshipSchema.index(
    { fromEntityId: 1, toEntityId: 1, type: 1 },
    { unique: true }
);

/**
 * Relationship model
 */
export const RelationshipModel = mongoose.model<IRelationship>('Relationship', RelationshipSchema);

/**
 * Helper function to convert document to plain Relationship object
 */
export function toRelationshipObject(doc: IRelationship): any {
    return {
        id: doc._id?.toString() || doc.id,
        channelId: doc.channelId,
        fromEntityId: doc.fromEntityId,
        toEntityId: doc.toEntityId,
        type: doc.type,
        label: doc.label,
        properties: doc.properties instanceof Map
            ? Object.fromEntries(doc.properties)
            : doc.properties || {},
        confidence: doc.confidence,
        surpriseScore: doc.surpriseScore,
        source: doc.source,
        sourceMemoryIds: doc.sourceMemoryIds,
        createdAt: doc.createdAt?.getTime() || Date.now(),
        updatedAt: doc.updatedAt?.getTime() || Date.now(),
        weight: doc.weight,
        customType: doc.customType,
    };
}
