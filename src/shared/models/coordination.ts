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
 * Coordination State
 */
export enum CoordinationState {
    REQUESTED = 'requested',
    ACCEPTED = 'accepted',
    REJECTED = 'rejected',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    CANCELLED = 'cancelled'
}

/**
 * Coordination Type
 */
export enum CoordinationType {
    COLLABORATE = 'collaborate',
    DELEGATE = 'delegate',
    REVIEW = 'review',
    ASSIST = 'assist',
    PARALLEL = 'parallel',
    SEQUENTIAL = 'sequential'
}

/**
 * Rejected Agent Info
 */
export interface IRejectedAgent {
    agentId: string;
    reason: string;
}

/**
 * Coordination document interface
 */
export interface ICoordination extends Document {
    coordinationId: string;
    type: CoordinationType;
    state: CoordinationState;
    requestingAgent: string;
    targetAgents: string[];
    acceptedAgents: string[];
    rejectedAgents: IRejectedAgent[];
    taskDescription: string;
    requirements?: Record<string, any>;
    deadline?: Date;
    results?: Record<string, any>;
    channelId?: string;
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
}

/**
 * Rejected Agent Schema
 */
const RejectedAgentSchema = new Schema({
    agentId: {
        type: String,
        required: true
    },
    reason: {
        type: String,
        required: true
    }
}, { _id: false });

/**
 * Coordination Schema
 */
const CoordinationSchema: Schema = new Schema(
    {
        coordinationId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        type: {
            type: String,
            enum: Object.values(CoordinationType),
            required: true
        },
        state: {
            type: String,
            enum: Object.values(CoordinationState),
            default: CoordinationState.REQUESTED
        },
        requestingAgent: {
            type: String,
            required: true,
            index: true
        },
        targetAgents: {
            type: [String],
            required: true,
            index: true
        },
        acceptedAgents: {
            type: [String],
            default: []
        },
        rejectedAgents: {
            type: [RejectedAgentSchema],
            default: []
        },
        taskDescription: {
            type: String,
            required: true
        },
        requirements: {
            type: Schema.Types.Mixed,
            required: false
        },
        deadline: {
            type: Date,
            required: false
        },
        results: {
            type: Schema.Types.Mixed,
            required: false
        },
        channelId: {
            type: String,
            required: false,
            index: true
        },
        completedAt: {
            type: Date,
            required: false
        }
    },
    {
        timestamps: true
    }
);

// Add compound indexes for common queries
CoordinationSchema.index({ requestingAgent: 1, state: 1, createdAt: -1 });
CoordinationSchema.index({ targetAgents: 1, state: 1 });
CoordinationSchema.index({ channelId: 1, state: 1 });
CoordinationSchema.index({ state: 1, createdAt: -1 });

export default mongoose.model<ICoordination>('Coordination', CoordinationSchema);
