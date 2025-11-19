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
 * Tool Execution Model
 * 
 * Represents a record of a tool execution, including the result and metadata.
 */

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Tool execution interface
 */
export interface IToolExecution extends Document {
    toolId: mongoose.Types.ObjectId;
    parameters: Record<string, any>;
    userId: string;
    result: any;
    executionTime: Date;
    success: boolean;
    errorMessage?: string;
    approvalRequestId?: mongoose.Types.ObjectId;
}

/**
 * Tool execution schema
 */
const ToolExecutionSchema = new Schema<IToolExecution>({
    toolId: { type: Schema.Types.ObjectId, required: true, ref: 'Tool' },
    parameters: { type: Schema.Types.Mixed, required: true },
    userId: { type: String, required: true },
    result: { type: Schema.Types.Mixed },
    executionTime: { type: Date, default: Date.now },
    success: { type: Boolean, required: true },
    errorMessage: { type: String },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: 'ToolApprovalRequest' }
});

// Create indexes
ToolExecutionSchema.index({ toolId: 1 });
ToolExecutionSchema.index({ userId: 1 });
ToolExecutionSchema.index({ executionTime: 1 });
ToolExecutionSchema.index({ success: 1 });

// Create the model
export const ToolExecution = mongoose.model<IToolExecution>('ToolExecution', ToolExecutionSchema);
