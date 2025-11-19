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
 * Task Effectiveness Model for MongoDB
 * 
 * Defines the MongoDB schema for universal task effectiveness tracking
 */

import mongoose, { Document, Schema } from 'mongoose';
import { TaskEffectivenessMetrics, TaskDefinition } from '../types/EffectivenessTypes';

/**
 * Interface for TaskEffectiveness document - MongoDB specific
 */
export interface ITaskEffectiveness extends Document {
    taskId: string;
    channelId: string;
    agentIds: string[];
    definition: TaskDefinition;
    metrics: TaskEffectivenessMetrics;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
}

/**
 * Task Effectiveness Schema
 */
const TaskEffectivenessSchema = new Schema<ITaskEffectiveness>({
    taskId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    channelId: {
        type: String,
        required: true,
        index: true
    },
    agentIds: [{
        type: String,
        index: true
    }],
    definition: {
        taskId: String,
        channelId: String,
        taskType: { type: String, index: true },
        description: String,
        successCriteria: {
            required: [String],
            optional: [String],
            targets: Schema.Types.Mixed
        },
        baseline: Schema.Types.Mixed
    },
    metrics: {
        taskId: String,
        metadata: {
            type: { type: String, index: true },
            description: String,
            startTime: { type: Number, index: true },
            endTime: Number,
            status: { 
                type: String, 
                enum: ['in_progress', 'completed', 'failed', 'cancelled'],
                index: true
            }
        },
        performance: {
            completionTime: Number,
            stepCount: { type: Number, default: 0 },
            toolsUsed: { type: Number, default: 0 },
            uniqueTools: [String],
            agentInteractions: { type: Number, default: 0 },
            humanInterventions: { type: Number, default: 0 },
            autonomyScore: { type: Number, default: 1.0, min: 0, max: 1 }
        },
        quality: {
            goalAchieved: { type: Boolean, default: false },
            completenessScore: { type: Number, default: 0, min: 0, max: 1 },
            iterationCount: { type: Number, default: 0 },
            errorCount: { type: Number, default: 0 },
            customMetrics: Schema.Types.Mixed
        },
        resources: {
            totalComputeTime: { type: Number, default: 0 },
            peakConcurrentAgents: { type: Number, default: 0 },
            totalTokens: Number,
            memoryOperations: { type: Number, default: 0 }
        },
        collaboration: {
            participatingAgents: [String],
            messageCount: { type: Number, default: 0 },
            coordinationCount: { type: Number, default: 0 },
            knowledgeTransfers: { type: Number, default: 0 },
            collaborationScore: { type: Number, default: 0, min: 0, max: 1 }
        }
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date,
        index: true
    }
}, {
    timestamps: true,
    collection: 'taskeffectiveness'
});

// Indexes for analytics queries
TaskEffectivenessSchema.index({ channelId: 1, 'metrics.metadata.type': 1 });
TaskEffectivenessSchema.index({ 'metrics.metadata.startTime': 1, 'metrics.metadata.status': 1 });
TaskEffectivenessSchema.index({ agentIds: 1, completedAt: 1 });
TaskEffectivenessSchema.index({ 'metrics.metadata.type': 1, 'metrics.quality.goalAchieved': 1 });

// Pre-save middleware to update timestamps
TaskEffectivenessSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    if (this.metrics.metadata.status === 'completed' && !this.completedAt) {
        this.completedAt = new Date();
    }
    next();
});

// Create and export the model
export const TaskEffectivenessModel = mongoose.model<ITaskEffectiveness>('TaskEffectiveness', TaskEffectivenessSchema);