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
 * MCP Tool Execution Model
 *
 * Records all MCP tool executions for auditing, analytics, and dashboard display.
 * This tracks both internal MXF tools and external MCP server tools.
 */

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Status of a tool execution
 */
export type McpToolExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

/**
 * Source type for tool execution
 */
export type McpToolSource = 'internal' | 'external';

/**
 * MCP Tool Execution interface
 */
export interface IMcpToolExecution extends Document {
    /** Unique request ID for tracking */
    requestId: string;
    /** Name of the tool being executed */
    toolName: string;
    /** Source of the tool: internal (MXF) or external (MCP server) */
    source: McpToolSource;
    /** Server ID for external tools */
    serverId?: string;
    /** Agent that initiated the tool call */
    agentId?: string;
    /** Channel context for the execution */
    channelId?: string;
    /** Input parameters passed to the tool */
    parameters: Record<string, any>;
    /** Result returned by the tool (if successful) */
    result?: any;
    /** Error message (if failed) */
    errorMessage?: string;
    /** Error code (if failed) */
    errorCode?: string;
    /** Execution status */
    status: McpToolExecutionStatus;
    /** When the execution started */
    startedAt: Date;
    /** When the execution completed */
    completedAt?: Date;
    /** Duration in milliseconds */
    durationMs?: number;
    /** Additional metadata */
    metadata?: Record<string, any>;
    /** Category of the tool */
    category?: string;
}

/**
 * MCP Tool Execution schema
 */
const McpToolExecutionSchema = new Schema<IMcpToolExecution>({
    requestId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    toolName: {
        type: String,
        required: true,
        index: true
    },
    source: {
        type: String,
        enum: ['internal', 'external'],
        required: true,
        index: true
    },
    serverId: {
        type: String,
        index: true
    },
    agentId: {
        type: String,
        index: true
    },
    channelId: {
        type: String,
        index: true
    },
    parameters: {
        type: Schema.Types.Mixed,
        required: true,
        default: {}
    },
    result: {
        type: Schema.Types.Mixed
    },
    errorMessage: {
        type: String
    },
    errorCode: {
        type: String
    },
    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'failed', 'timeout'],
        required: true,
        default: 'pending',
        index: true
    },
    startedAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    completedAt: {
        type: Date
    },
    durationMs: {
        type: Number
    },
    metadata: {
        type: Schema.Types.Mixed
    },
    category: {
        type: String,
        index: true
    }
}, {
    timestamps: true
});

// Compound indexes for common queries
McpToolExecutionSchema.index({ status: 1, startedAt: -1 });
McpToolExecutionSchema.index({ toolName: 1, startedAt: -1 });
McpToolExecutionSchema.index({ agentId: 1, startedAt: -1 });
McpToolExecutionSchema.index({ channelId: 1, startedAt: -1 });

// Create the model
export const McpToolExecution = mongoose.model<IMcpToolExecution>('McpToolExecution', McpToolExecutionSchema);
