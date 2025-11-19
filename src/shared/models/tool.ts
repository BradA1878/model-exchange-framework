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
 * Tool Model
 * 
 * Represents a tool that can be executed by the framework.
 */

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Tool parameter interface
 */
export interface IToolParameter {
    name: string;
    type: string;
    description: string;
    required: boolean;
    defaultValue?: any;
}

/**
 * Tool interface
 */
export interface ITool extends Document {
    name: string;
    description: string;
    endpoint: string;
    parameters: IToolParameter[];
    serverId: mongoose.Types.ObjectId;
    requiresApproval: boolean;
    accessLevel: string;
    category: string;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Tool parameter schema
 */
const ToolParameterSchema = new Schema<IToolParameter>({
    name: { type: String, required: true },
    type: { type: String, required: true },
    description: { type: String, required: true },
    required: { type: Boolean, required: true, default: false },
    defaultValue: { type: Schema.Types.Mixed }
});

/**
 * Tool schema
 */
const ToolSchema = new Schema<ITool>({
    name: { type: String, required: true },
    description: { type: String, required: true },
    endpoint: { type: String, required: true },
    parameters: [ToolParameterSchema],
    serverId: { type: Schema.Types.ObjectId, required: true, ref: 'ToolServer' },
    requiresApproval: { type: Boolean, default: true },
    accessLevel: { 
        type: String, 
        enum: ['public', 'private', 'restricted'], 
        default: 'restricted' 
    },
    category: { type: String, default: 'uncategorized' },
    tags: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Create indexes
ToolSchema.index({ name: 1 });
ToolSchema.index({ serverId: 1 });
ToolSchema.index({ category: 1 });
ToolSchema.index({ tags: 1 });

// Pre-save hook to update the updatedAt field
ToolSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Create the model
export const Tool = mongoose.model<ITool>('Tool', ToolSchema);
