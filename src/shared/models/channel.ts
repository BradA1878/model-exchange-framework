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
 * Channel Model
 * 
 * Defines the data schema for channels in the communication framework.
 * Channels are communication spaces where agents can exchange messages.
 * This model stores both channel configuration and context.
 */

import mongoose, { Document, Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { createStrictValidator } from '../utils/validation';

/**
 * Interface for Channel document
 */
export interface IChannel extends Document {
    // Core channel properties
    channelId: string;
    name: string;
    description?: string;
    
    // Custom channel identifier (migration from channelRegistry)
    customChannelId?: string;
    
    // Channel configuration
    isPrivate: boolean;
    requireApproval: boolean;
    maxAgents: number;
    allowAnonymous: boolean;
    showActiveAgents: boolean; // Whether agents can see other agents in the channel
    
    // Channel state
    active: boolean;
    participants: string[]; // Array of agent IDs
    
    // Creator information
    createdBy: string; // Agent ID
    
    // Channel context (semantic information)
    context?: {
        // Original context fields
        topics?: Array<{
            id: string;
            topic: string;
            keywords: string[];
            relevance: number;
        }>;
        summary?: string;
        lastActivity: number;
        
        // Extended context for LLM-based channels
        purpose?: string;       // The purpose/focus of the channel
        guidelines?: string;    // Channel behavior guidelines
        instructions?: string;  // Channel-specific instructions
        updatedAt?: Date;       // When context was last updated
    };
    
    // Channel shared memory (read/write for all participants)
    sharedMemory?: {
        notes?: Record<string, any>;      // Shared persistent notes
        sharedState?: Record<string, any>;// Shared state between agents
        conversationHistory?: any[];      // Channel conversation records
        customData?: Record<string, any>; // Any custom shared data
        updatedAt?: Date;                 // When memory was last updated
    };

    // Channel-scoped MCP servers (shared by all agents in channel)
    mcpServers?: {
        servers: Array<{
            id: string;                   // Unique server ID
            name: string;                 // Display name
            config: Record<string, any>;  // Full server configuration
            registeredBy: string;         // Agent ID who registered
            registeredAt: Date;           // When registered
            status: 'stopped' | 'starting' | 'running' | 'error';
            keepAliveMinutes?: number;    // Keep alive after last agent leaves
        }>;
        updatedAt?: Date;                 // When server list was last updated
    };

    // Verification details (migration from channelRegistry)
    verified: boolean;
    verificationMethod?: 'dns' | 'email' | 'file' | 'token';
    verificationToken?: string;
    verificationExpiry?: Date;
    
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
    lastActive: Date;
    
    // Additional data
    metadata: Record<string, any>;
}

/**
 * Schema for Channel
 */
const ChannelSchema: Schema = new Schema(
    {
        channelId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        name: {
            type: String,
            required: true
        },
        description: {
            type: String,
            required: false
        },
        customChannelId: {
            type: String,
            sparse: true,
            unique: true,
            index: true
        },
        isPrivate: {
            type: Boolean,
            default: false
        },
        requireApproval: {
            type: Boolean,
            default: false
        },
        maxAgents: {
            type: Number,
            default: 50
        },
        allowAnonymous: {
            type: Boolean,
            default: true
        },
        showActiveAgents: {
            type: Boolean,
            default: true // By default, agents can see other agents in the channel
        },
        active: {
            type: Boolean,
            default: true
        },
        participants: {
            type: [String],
            default: [],
            index: true
        },
        createdBy: {
            type: String,
            required: true,
            ref: 'Agent'
        },
        context: {
            topics: [{
                id: String,
                topic: String,
                keywords: [String],
                relevance: Number
            }],
            summary: String,
            lastActivity: Number,
            
            // Extended context fields
            purpose: String,
            guidelines: String,
            instructions: String,
            updatedAt: Date
        },
        
        // New shared memory section
        sharedMemory: {
            notes: Schema.Types.Mixed,
            sharedState: Schema.Types.Mixed,
            conversationHistory: [Schema.Types.Mixed],
            customData: Schema.Types.Mixed,
            updatedAt: {
                type: Date,
                default: Date.now
            }
        },

        // Channel-scoped MCP servers
        mcpServers: {
            servers: [{
                id: {
                    type: String,
                    required: true
                },
                name: {
                    type: String,
                    required: true
                },
                config: {
                    type: Schema.Types.Mixed,
                    required: true
                },
                registeredBy: {
                    type: String,
                    required: true,
                    ref: 'Agent'
                },
                registeredAt: {
                    type: Date,
                    default: Date.now
                },
                status: {
                    type: String,
                    enum: ['stopped', 'starting', 'running', 'error'],
                    default: 'stopped'
                },
                keepAliveMinutes: {
                    type: Number,
                    default: 5
                }
            }],
            updatedAt: {
                type: Date,
                default: Date.now
            }
        },

        // Verification fields (from channelRegistry)
        verified: {
            type: Boolean,
            default: false
        },
        verificationMethod: {
            type: String,
            enum: ['dns', 'email', 'file', 'token']
        },
        verificationToken: {
            type: String
        },
        verificationExpiry: {
            type: Date
        },
        lastActive: {
            type: Date,
            default: Date.now
        },
        metadata: {
            type: Schema.Types.Mixed,
            default: {}
        },
        
        // Channel-level tool access control
        // Empty array means no restrictions (agents can use any tool in their allowedTools)
        // Non-empty array restricts agents to only use tools that are in BOTH the channel's and agent's allowedTools
        allowedTools: {
            type: [String],
            default: []
        },
        
        // Disable SystemLLM for this channel (game channels, custom orchestration, etc.)
        systemLlmEnabled: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

/**
 * Pre-save hook to ensure channelId exists
 */
ChannelSchema.pre<IChannel>('save', function(next) {
    const validate = createStrictValidator('Channel.preSave');
    
    // Validate critical fields before saving - no fallbacks, fail-fast approach
    validate.assertIsNonEmptyString(this.channelId, 'channelId is required');
    validate.assertIsNonEmptyString(this.name, 'name is required');
    validate.assertIsArray(this.participants, 'participants must be an array');
    
    // Update lastActive timestamp
    this.lastActive = new Date();
    next();
});

// Export the model
export const Channel = mongoose.model<IChannel>('Channel', ChannelSchema);
