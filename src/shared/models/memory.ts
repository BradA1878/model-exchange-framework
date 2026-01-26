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
 * Memory Models
 * 
 * This file contains Mongoose schemas and models for the Memory System.
 * These models define the database structure for different memory types.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryScope,
    MemoryPersistenceLevel
} from '../types/MemoryTypes';
import {
    MemoryUtilitySubdocument,
    QValueHistoryEntry,
    QValueInitSource,
    DEFAULT_UTILITY_SUBDOCUMENT
} from '../types/MemoryUtilityTypes';

/**
 * Base Memory Schema with common fields for all memory types
 */
const baseMemorySchema = new Schema({
    // Unique identifier
    id: {
        type: String,
        required: true,
        unique: true,
        default: () => uuidv4()
    },
    
    // Creation timestamp
    createdAt: {
        type: Date,
        default: Date.now
    },
    
    // Last update timestamp
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    // Persistence level (temporary or persistent)
    persistenceLevel: {
        type: String,
        enum: Object.values(MemoryPersistenceLevel),
        default: MemoryPersistenceLevel.PERSISTENT
    },
    
    // Free-form notes as JSON object
    notes: {
        type: Schema.Types.Mixed,
        default: {}
    },
    
    // Custom data as JSON object
    customData: {
        type: Schema.Types.Mixed,
        default: {}
    },

    // Memory Utility Learning System (MULS) subdocument
    // Tracks Q-values for utility-based retrieval
    utility: {
        type: new Schema({
            // Current Q-value (0-1 range, default 0.5)
            qValue: {
                type: Number,
                default: 0.5,
                min: 0,
                max: 1
            },
            // History of Q-value updates for convergence analysis
            qValueHistory: [{
                value: { type: Number, required: true },
                reward: { type: Number, required: true },
                timestamp: { type: Date, default: Date.now },
                taskId: { type: String },
                phase: { type: String }
            }],
            // Total number of times this memory was retrieved
            retrievalCount: {
                type: Number,
                default: 0
            },
            // Number of successful task completions where this memory was used
            successCount: {
                type: Number,
                default: 0
            },
            // Number of failed task completions where this memory was used
            failureCount: {
                type: Number,
                default: 0
            },
            // Timestamp of last reward update
            lastRewardAt: {
                type: Date,
                default: Date.now
            },
            // How the Q-value was initially set
            initializedFrom: {
                type: String,
                enum: ['default', 'surprise', 'transfer', 'manual'],
                default: 'default'
            }
        }, { _id: false }),
        default: () => ({
            qValue: 0.5,
            qValueHistory: [],
            retrievalCount: 0,
            successCount: 0,
            failureCount: 0,
            lastRewardAt: new Date(),
            initializedFrom: 'default'
        })
    }
}, {
    timestamps: true,
    strict: false, // Allow for flexible schema evolution
    id: false, // Don't create default MongoDB _id field
    toJSON: {
        transform: (doc, ret) => {
            delete ret._id; // Remove MongoDB _id when converting to JSON
            return ret;
        }
    }
});

/**
 * Agent Memory Schema
 */
const agentMemorySchema = new Schema({
    // Reference to Agent ID
    agentId: {
        type: String,
        required: true,
        index: true
    },
    
    // Conversation history
    conversationHistory: {
        type: [Schema.Types.Mixed],
        default: []
    }
});

/**
 * Channel Memory Schema
 */
const channelMemorySchema = new Schema({
    // Reference to Channel ID
    channelId: {
        type: String,
        required: true,
        index: true
    },
    
    // Shared state visible to all agents in the channel
    sharedState: {
        type: Schema.Types.Mixed,
        default: {}
    },
    
    // Conversation history
    conversationHistory: {
        type: [Schema.Types.Mixed],
        default: []
    }
});

/**
 * Relationship Memory Schema
 */
const relationshipMemorySchema = new Schema({
    // First Agent ID
    agentId1: {
        type: String,
        required: true
    },
    
    // Second Agent ID
    agentId2: {
        type: String,
        required: true
    },
    
    // Optional Channel ID where the relationship exists
    channelId: {
        type: String
    },
    
    // Interaction history between agents
    interactionHistory: {
        type: [Schema.Types.Mixed],
        default: []
    }
});

// Create compound index for relationship memory
relationshipMemorySchema.index({ agentId1: 1, agentId2: 1, channelId: 1 }, { unique: true });

// Complete memory models by combining base and specific schemas
const AgentMemorySchema = new Schema({
    ...baseMemorySchema.obj,
    ...agentMemorySchema.obj
});

const ChannelMemorySchema = new Schema({
    ...baseMemorySchema.obj,
    ...channelMemorySchema.obj
});

const RelationshipMemorySchema = new Schema({
    ...baseMemorySchema.obj,
    ...relationshipMemorySchema.obj
});

// Create indexes for Q-value queries (MULS optimization)
// Index for sorting by Q-value descending (top performers)
AgentMemorySchema.index({ 'utility.qValue': -1 });
// Compound index for agent-scoped Q-value queries
AgentMemorySchema.index({ agentId: 1, 'utility.qValue': -1 });

ChannelMemorySchema.index({ 'utility.qValue': -1 });
ChannelMemorySchema.index({ channelId: 1, 'utility.qValue': -1 });

RelationshipMemorySchema.index({ 'utility.qValue': -1 });

// Define document interfaces that properly merge the mongoose Document and our interfaces
// Extended with optional MULS utility subdocument
export interface AgentMemoryDocument extends Omit<mongoose.Document, 'id'>, IAgentMemory {
    utility?: MemoryUtilitySubdocument;
}
export interface ChannelMemoryDocument extends Omit<mongoose.Document, 'id'>, IChannelMemory {
    utility?: MemoryUtilitySubdocument;
}
export interface RelationshipMemoryDocument extends Omit<mongoose.Document, 'id'>, IRelationshipMemory {
    utility?: MemoryUtilitySubdocument;
}

// Pre-save hooks
AgentMemorySchema.pre('save', function(this: AgentMemoryDocument, next) {
    this.updatedAt = new Date();
    next();
});

ChannelMemorySchema.pre('save', function(this: ChannelMemoryDocument, next) {
    this.updatedAt = new Date();
    next();
});

RelationshipMemorySchema.pre('save', function(this: RelationshipMemoryDocument, next) {
    this.updatedAt = new Date();
    next();
});

// Create the Mongoose models
export const AgentMemory: Model<AgentMemoryDocument> = 
    mongoose.models.AgentMemory || mongoose.model<AgentMemoryDocument>('AgentMemory', AgentMemorySchema);

export const ChannelMemory: Model<ChannelMemoryDocument> = 
    mongoose.models.ChannelMemory || mongoose.model<ChannelMemoryDocument>('ChannelMemory', ChannelMemorySchema);

export const RelationshipMemory: Model<RelationshipMemoryDocument> = 
    mongoose.models.RelationshipMemory || mongoose.model<RelationshipMemoryDocument>('RelationshipMemory', RelationshipMemorySchema);

/**
 * Helper function to create a memory model instance based on scope
 * @param scope Memory scope
 * @returns The corresponding memory model
 */
export const getMemoryModelByScope = (scope: MemoryScope): Model<any> => {
    switch (scope) {
        case MemoryScope.AGENT:
            return AgentMemory;
        case MemoryScope.CHANNEL:
            return ChannelMemory;
        case MemoryScope.RELATIONSHIP:
            return RelationshipMemory;
        default:
            throw new Error(`Invalid memory scope: ${scope}`);
    }
};
