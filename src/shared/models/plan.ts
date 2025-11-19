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

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Plan Item interface
 */
export interface IPlanItem {
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked';
    assignee?: string;
    dependencies?: string[];
    estimatedTime?: string;
    priority?: 'low' | 'medium' | 'high';
}

/**
 * Plan document interface
 */
export interface IPlan extends Document {
    planId: string;
    title: string;
    createdBy: string;
    channelId?: string;
    items: IPlanItem[];
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Plan Item Schema
 */
const PlanItemSchema = new Schema({
    id: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: false
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'blocked'],
        default: 'pending'
    },
    assignee: {
        type: String,
        required: false
    },
    dependencies: {
        type: [String],
        default: []
    },
    estimatedTime: {
        type: String,
        required: false
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    }
}, { _id: false });

/**
 * Plan Schema
 */
const PlanSchema: Schema = new Schema(
    {
        planId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        title: {
            type: String,
            required: true
        },
        createdBy: {
            type: String,
            required: true,
            index: true
        },
        channelId: {
            type: String,
            required: false,
            index: true
        },
        items: {
            type: [PlanItemSchema],
            default: []
        },
        metadata: {
            type: Schema.Types.Mixed,
            required: false
        }
    },
    {
        timestamps: true
    }
);

// Add compound indexes for common queries
PlanSchema.index({ createdBy: 1, createdAt: -1 });
PlanSchema.index({ channelId: 1, createdAt: -1 });
PlanSchema.index({ 'items.assignee': 1 });

export default mongoose.model<IPlan>('Plan', PlanSchema);
