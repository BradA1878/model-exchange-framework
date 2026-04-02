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
 * Shell Output Model
 *
 * Stores large shell command outputs that exceed the inline size limit.
 * Agents can retrieve persisted outputs by ID using the shell_output_retrieve
 * tool. Includes a 24-hour TTL index for automatic cleanup.
 */

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Shell output document interface
 */
export interface IShellOutput extends Document {
    /** Unique output identifier for retrieval */
    outputId: string;
    /** Full output content */
    content: string;
    /** Hash of the command that produced this output */
    commandHash: string;
    /** Agent that executed the command */
    agentId: string;
    /** Channel context */
    channelId: string;
    /** Total size in bytes */
    totalBytes: number;
    /** Total number of lines */
    totalLines: number;
    /** Timestamps */
    createdAt: Date;
}

/**
 * Shell output schema
 */
const ShellOutputSchema = new Schema<IShellOutput>({
    outputId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    content: {
        type: String,
        required: true
    },
    commandHash: {
        type: String,
        required: true
    },
    agentId: {
        type: String,
        required: true,
        index: true
    },
    channelId: {
        type: String,
        required: true
    },
    totalBytes: {
        type: Number,
        required: true
    },
    totalLines: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400 // 24-hour TTL
    }
}, {
    timestamps: { createdAt: true, updatedAt: false }
});

// Compound indexes for querying outputs by agent or channel
ShellOutputSchema.index({ agentId: 1, createdAt: -1 });
ShellOutputSchema.index({ channelId: 1, createdAt: -1 });

// Create the model
export const ShellOutput = mongoose.model<IShellOutput>('ShellOutput', ShellOutputSchema);
