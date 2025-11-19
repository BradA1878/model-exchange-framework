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
 * Interface for Agent document
 */
export interface IAgent extends Document {
    agentId: string;
    name?: string;
    description?: string;
    type?: string;
    serviceTypes: string[];
    capabilities?: string[];
    status: 'ACTIVE' | 'INACTIVE' | 'ERROR';
    createdBy: string; // User ID who created the agent
    createdAt: Date;
    lastActive: Date;
    metadata?: Record<string, any>;
    
    // New fields for LLM-based agents
    keyId?: string;            // API key used as lookup for this agent
    role?: string;             // Agent's role (e.g., "assistant", "specialist")
    specialization?: string;   // Agent's area of specialization
    allowedTools?: string[];   // Tool access control - list of allowed MCP tools
    
    // Agent context (read-only)
    context?: {
        identity?: string;     // Agent's identity description
        instructions?: string; // Specific instructions for the agent
        constraints?: string[];// Operational constraints
        examples?: string[];   // Example interactions or behaviors
        updatedAt?: Date;      // When context was last updated
    };
    
    // Agent memory (read/write)
    memory?: {
        notes?: Record<string, any>;     // Persistent notes
        conversationHistory?: any[];     // Previous conversation records
        customData?: Record<string, any>;// Any custom persistent data
        updatedAt?: Date;                // When memory was last updated
    };
}

/**
 * Schema for Agent
 */
const AgentSchema: Schema = new Schema(
    {
        agentId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        name: {
            type: String,
            required: false
        },
        description: {
            type: String,
            required: false
        },
        type: {
            type: String,
            required: false
        },
        serviceTypes: {
            type: [String],
            required: true,
            index: true
        },
        capabilities: {
            type: [String],
            required: false
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'INACTIVE', 'ERROR'],
            default: 'INACTIVE'
        },
        lastActive: {
            type: Date,
            default: Date.now
        },
        metadata: {
            type: Schema.Types.Mixed,
            required: false
        },
        createdBy: {
            type: String,
            required: true,
            index: true
        },
        
        // New fields for LLM-based agents
        keyId: {
            type: String,
            index: true,
            sparse: true
        },
        role: {
            type: String
        },
        specialization: {
            type: String
        },
        allowedTools: {
            type: [String],
            required: false,
            default: undefined  // undefined = all tools allowed
        },
        
        // Agent context
        context: {
            identity: String,
            instructions: String,
            constraints: [String],
            examples: [String],
            updatedAt: Date
        },
        
        // Agent memory
        memory: {
            notes: Schema.Types.Mixed,
            conversationHistory: [Schema.Types.Mixed],
            customData: Schema.Types.Mixed,
            updatedAt: {
                type: Date,
                default: Date.now
            }
        }
    },
    {
        timestamps: true
    }
);

// Create indexes
AgentSchema.index({ serviceTypes: 1 });
AgentSchema.index({ status: 1, serviceTypes: 1 });
AgentSchema.index({ lastActive: -1 });
AgentSchema.index({ keyId: 1 });

// Export the model
export const Agent = mongoose.model<IAgent>('Agent', AgentSchema);
