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
 * Code Execution Model
 *
 * Represents a record of code execution in the sandbox, including metrics,
 * output, and resource usage. Includes TTL index for automatic cleanup.
 */

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Code execution interface
 */
export interface ICodeExecution extends Document {
    agentId: string;
    channelId: string;
    requestId: string;

    // Code information
    language: 'javascript' | 'typescript';
    codeHash: string;
    codeLength: number;
    codeSnippet?: string; // Optional: store first 500 chars for debugging

    // Execution results
    success: boolean;
    output: any;
    logs: string[];
    error?: string;

    // Performance metrics
    executionTime: number; // milliseconds
    timeout: number; // configured timeout

    // Resource usage
    memoryUsage: number; // MB
    timeoutOccurred: boolean;

    // Context data
    contextData?: Record<string, any>;

    // Timestamps
    executedAt: Date;
    createdAt: Date;
}

/**
 * Code execution schema
 */
const CodeExecutionSchema = new Schema<ICodeExecution>({
    agentId: {
        type: String,
        required: true,
        index: true
    },
    channelId: {
        type: String,
        required: true,
        index: true
    },
    requestId: {
        type: String,
        required: true,
        unique: true
    },

    // Code information
    language: {
        type: String,
        required: true,
        enum: ['javascript', 'typescript']
    },
    codeHash: {
        type: String,
        required: true,
        index: true
    },
    codeLength: {
        type: Number,
        required: true
    },
    codeSnippet: {
        type: String
    },

    // Execution results
    success: {
        type: Boolean,
        required: true,
        index: true
    },
    output: {
        type: Schema.Types.Mixed
    },
    logs: {
        type: [String],
        default: []
    },
    error: {
        type: String
    },

    // Performance metrics
    executionTime: {
        type: Number,
        required: true
    },
    timeout: {
        type: Number,
        required: true
    },

    // Resource usage
    memoryUsage: {
        type: Number,
        required: true
    },
    timeoutOccurred: {
        type: Boolean,
        default: false
    },

    // Context data
    contextData: {
        type: Schema.Types.Mixed
    },

    // Timestamps
    executedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Performance indexes
CodeExecutionSchema.index({ agentId: 1, executedAt: -1 });
CodeExecutionSchema.index({ channelId: 1, executedAt: -1 });
CodeExecutionSchema.index({ codeHash: 1, success: 1 });
CodeExecutionSchema.index({ language: 1, success: 1 });

// TTL index: auto-delete records after 30 days
CodeExecutionSchema.index({ executedAt: 1 }, { expireAfterSeconds: 2592000 });

// Compound indexes for analytics queries
CodeExecutionSchema.index({ agentId: 1, success: 1, executedAt: -1 });
CodeExecutionSchema.index({ channelId: 1, language: 1, executedAt: -1 });

/**
 * Static method to get execution statistics for an agent
 */
CodeExecutionSchema.statics.getAgentStats = async function(
    agentId: string,
    since?: Date
): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    timeoutCount: number;
    languageBreakdown: Record<string, number>;
}> {
    const matchStage: any = { agentId };
    if (since) {
        matchStage.executedAt = { $gte: since };
    }

    const stats = await this.aggregate([
        { $match: matchStage },
        {
            $group: {
                _id: null,
                totalExecutions: { $sum: 1 },
                successfulExecutions: {
                    $sum: { $cond: ['$success', 1, 0] }
                },
                failedExecutions: {
                    $sum: { $cond: ['$success', 0, 1] }
                },
                averageExecutionTime: { $avg: '$executionTime' },
                timeoutCount: {
                    $sum: { $cond: ['$timeoutOccurred', 1, 0] }
                }
            }
        }
    ]);

    const languageStats = await this.aggregate([
        { $match: matchStage },
        {
            $group: {
                _id: '$language',
                count: { $sum: 1 }
            }
        }
    ]);

    const languageBreakdown: Record<string, number> = {};
    languageStats.forEach((stat: any) => {
        languageBreakdown[stat._id] = stat.count;
    });

    return {
        totalExecutions: stats[0]?.totalExecutions || 0,
        successfulExecutions: stats[0]?.successfulExecutions || 0,
        failedExecutions: stats[0]?.failedExecutions || 0,
        averageExecutionTime: stats[0]?.averageExecutionTime || 0,
        timeoutCount: stats[0]?.timeoutCount || 0,
        languageBreakdown
    };
};

/**
 * Static method to find similar executions by code hash
 */
CodeExecutionSchema.statics.findByCodeHash = function(
    codeHash: string,
    limit: number = 10
) {
    return this.find({ codeHash })
        .sort({ executedAt: -1 })
        .limit(limit)
        .select('-output -logs') // Exclude large fields
        .lean();
};

/**
 * Static method to get recent failures for debugging
 */
CodeExecutionSchema.statics.getRecentFailures = function(
    agentId: string,
    limit: number = 20
) {
    return this.find({
        agentId,
        success: false
    })
        .sort({ executedAt: -1 })
        .limit(limit)
        .select('codeHash language error executionTime executedAt')
        .lean();
};

// Create the model
export const CodeExecution = mongoose.model<ICodeExecution>('CodeExecution', CodeExecutionSchema);

// Export types for use in other modules
export type CodeExecutionDocument = ICodeExecution;
export type CodeExecutionLanguage = 'javascript' | 'typescript';
