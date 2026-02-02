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
 * Task Model for MongoDB
 * 
 * Defines the MongoDB schema for channel tasks with intelligent assignment
 * and SystemLLM integration for task orchestration
 */

import mongoose, { Document, Schema, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { 
    ChannelTask, 
    TaskPriority, 
    TaskStatus, 
    TaskCreatedBy, 
    AssignmentStrategy 
} from '../types/TaskTypes';

/**
 * Interface for Task document - MongoDB specific with Date objects
 */
export interface ITask extends Document {
    // Core task properties
    channelId: string;
    title: string;
    description: string;
    priority: TaskPriority;
    
    // Assignment and routing
    requiredRoles?: string[];
    requiredCapabilities?: string[];
    
    // Enhanced assignment options
    assignedAgentId?: string;           // Legacy single agent assignment (deprecated)
    assignedAgentIds?: string[];        // Multi-agent assignment support
    assignmentScope?: 'single' | 'multiple' | 'channel-wide';
    assignmentDistribution?: 'parallel' | 'sequential' | 'collaborative';
    
    // Channel-wide task options
    channelWideTask?: boolean;          // Broadcast to all agents in channel
    targetAgentRoles?: string[];        // Target specific roles in channel
    excludeAgentIds?: string[];        // Exclude specific agents from assignment
    maxParticipants?: number;          // Limit concurrent participants
    
    // Task coordination
    coordinationMode?: 'independent' | 'collaborative' | 'sequential' | 'hierarchical';
    leadAgentId?: string;              // Primary coordinator for collaborative tasks
    completionAgentId?: string;        // Agent designated to call task_complete (overrides automatic logic)
    
    assignmentStrategy: AssignmentStrategy;
    
    // Status tracking
    status: TaskStatus;
    progress?: number;
    
    // Timing - MongoDB uses Date objects
    createdAt: Date;
    updatedAt: Date;
    dueDate?: Date;
    estimatedDuration?: number;
    actualDuration?: number;
    
    // Creation and ownership
    createdBy: TaskCreatedBy;
    
    // Task context and metadata
    metadata?: Record<string, any>;
    tags?: string[];
    
    // Dependencies and relationships
    dependsOn?: string[];
    blockedBy?: string[];
    
    // Results and outcomes - MongoDB version with Date objects
    result?: {
        success?: boolean;
        output?: any;
        error?: string;
        completedAt?: Date;
        completedBy?: string;
    };
}

/**
 * Task Schema for MongoDB
 */
const TaskSchema: Schema = new Schema(
    {
        // Core task properties
        channelId: {
            type: String,
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200
        },
        description: {
            type: String,
            required: true,
            trim: true,
            maxlength: 20000
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high', 'urgent'],
            default: 'medium',
            index: true
        },
        
        // Assignment and routing
        requiredRoles: {
            type: [String],
            default: [],
            index: true
        },
        requiredCapabilities: {
            type: [String],
            default: [],
            index: true
        },
        assignedAgentId: {
            type: String,
            index: true,
            sparse: true
        },
        assignedAgentIds: {
            type: [String],
            default: [],
            index: true
        },
        assignmentScope: {
            type: String,
            enum: ['single', 'multiple', 'channel-wide'],
            default: 'single',
            index: true
        },
        assignmentDistribution: {
            type: String,
            enum: ['parallel', 'sequential', 'collaborative'],
            default: 'parallel',
            index: true
        },
        channelWideTask: {
            type: Boolean,
            default: false,
            index: true
        },
        targetAgentRoles: {
            type: [String],
            default: [],
            index: true
        },
        excludeAgentIds: {
            type: [String],
            default: [],
            index: true
        },
        maxParticipants: {
            type: Number,
            min: 1,
            default: 1
        },
        coordinationMode: {
            type: String,
            enum: ['independent', 'collaborative', 'sequential', 'hierarchical'],
            default: 'independent',
            index: true
        },
        leadAgentId: {
            type: String,
            index: true,
            sparse: true
        },
        completionAgentId: {
            type: String,
            index: true,
            sparse: true
        },
        assignmentStrategy: {
            type: String,
            enum: ['role_based', 'workload_balanced', 'expertise_driven', 'manual', 'intelligent', 'none'],
            default: 'intelligent',
            index: true
        },
        
        // Status tracking
        status: {
            type: String,
            enum: ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled'],
            default: 'pending',
            index: true
        },
        progress: {
            type: Number,
            min: 0,
            max: 100,
            default: 0
        },
        
        // Timing
        dueDate: {
            type: Date,
            index: true,
            sparse: true
        },
        estimatedDuration: {
            type: Number, // in minutes
            min: 0
        },
        actualDuration: {
            type: Number, // in minutes
            min: 0
        },
        
        // Creation and ownership
        createdBy: {
            type: String,
            required: true,
            index: true
        },
        
        // Task context and metadata
        metadata: {
            type: Schema.Types.Mixed,
            default: {}
        },
        tags: {
            type: [String],
            default: [],
            index: true
        },
        
        // Dependencies and relationships
        dependsOn: {
            type: [String], // Array of task IDs
            default: []
        },
        blockedBy: {
            type: [String], // Array of task IDs
            default: []
        },
        
        // Results and outcomes
        result: {
            success: {
                type: Boolean
            },
            output: {
                type: Schema.Types.Mixed
            },
            error: {
                type: String
            },
            completedAt: {
                type: Date
            },
            completedBy: {
                type: String
            }
        }
    },
    {
        timestamps: true, // Adds createdAt and updatedAt
        collection: 'tasks'
    }
);

// Compound indexes for efficient queries
TaskSchema.index({ channelId: 1, status: 1 });
TaskSchema.index({ assignedAgentId: 1, status: 1 });
TaskSchema.index({ priority: 1, dueDate: 1 });
TaskSchema.index({ status: 1, createdAt: -1 });
TaskSchema.index({ channelId: 1, priority: 1, status: 1 });
TaskSchema.index({ tags: 1, status: 1 });

// Text search index for title and description
TaskSchema.index({ 
    title: 'text', 
    description: 'text' 
}, {
    weights: {
        title: 10,
        description: 5
    },
    name: 'task_text_search'
});

// Virtual for task ID (uses MongoDB _id)
TaskSchema.virtual('id').get(function(this: ITask) {
    return this._id?.toString();
});

// Transform function to include virtual ID in JSON output
TaskSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
    }
});

// Pre-save middleware to handle task validation and updates
TaskSchema.pre('save', function(this: ITask, next) {
    // Set updatedAt timestamp
    this.updatedAt = new Date();
    
    // Validate due date is in the future for new tasks
    if (this.isNew && this.dueDate && this.dueDate <= new Date()) {
        return next(new Error('Due date must be in the future'));
    }
    
    // Set progress based on status
    if (this.status === 'completed') {
        this.progress = 100;
        if (!this.result?.completedAt) {
            if (!this.result) {
                this.result = {
                    success: true,
                    completedAt: new Date(),
                    completedBy: this.assignedAgentId || 'unknown'
                };
            } else {
                this.result.completedAt = new Date();
            }
        }
    } else if (this.status === 'pending') {
        this.progress = 0;
    }
    
    // Calculate actual duration for completed tasks
    if (this.status === 'completed' && this.result?.completedAt && this.createdAt) {
        const duration = Math.round((this.result.completedAt.getTime() - this.createdAt.getTime()) / (1000 * 60));
        this.actualDuration = duration;
    }
    
    next();
});

// Static methods for common queries
TaskSchema.statics.findByChannel = function(channelId: string) {
    return this.find({ channelId }).sort({ priority: -1, createdAt: -1 });
};

TaskSchema.statics.findByAgent = function(agentId: string) {
    return this.find({ assignedAgentId: agentId }).sort({ priority: -1, dueDate: 1 });
};

TaskSchema.statics.findPending = function(channelId?: string) {
    const query: any = { status: 'pending' };
    if (channelId) query.channelId = channelId;
    return this.find(query).sort({ priority: -1, createdAt: 1 });
};

TaskSchema.statics.findOverdue = function() {
    return this.find({
        dueDate: { $lt: new Date() },
        status: { $nin: ['completed', 'failed', 'cancelled'] }
    }).sort({ dueDate: 1 });
};

TaskSchema.statics.findByStatus = function(status: TaskStatus, channelId?: string) {
    const query: any = { status };
    if (channelId) query.channelId = channelId;
    return this.find(query).sort({ updatedAt: -1 });
};

// Export the model
export const Task = mongoose.model<ITask>('Task', TaskSchema);

// Export additional types for type safety
export type TaskDocument = ITask;
export type TaskModel = typeof Task;
