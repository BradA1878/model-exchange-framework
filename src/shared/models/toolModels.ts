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
 * MongoDB models for tool system
 * 
 * Defines the database schemas for tool servers, tools, and tool call logs
 * in the Model Exchange Framework.
 */

import mongoose, { Schema, Document } from 'mongoose';
import {
    ToolAccessLevel,
    ToolParameterType,
    ToolServerAuthType,
    ToolServerConnectionType,
    ToolServerStatus,
    ToolCallStatus
} from '../types/toolTypes';

/**
 * Tool server schema
 */
const ToolServerSchema = new Schema({
    name: { 
        type: String, 
        required: true, 
        unique: true,
        index: true
    },
    description: { 
        type: String, 
        required: true 
    },
    version: { 
        type: String, 
        required: true 
    },
    url: { 
        type: String, 
        required: true 
    },
    status: { 
        type: String, 
        enum: Object.values(ToolServerStatus),
        default: ToolServerStatus.DISCONNECTED
    },
    connectionType: { 
        type: String, 
        enum: Object.values(ToolServerConnectionType),
        required: true 
    },
    authType: { 
        type: String, 
        enum: Object.values(ToolServerAuthType),
        default: ToolServerAuthType.NONE
    },
    authConfig: { 
        type: Object 
    },
    supportedTools: [{ 
        type: String 
    }],
    disabled: { 
        type: Boolean, 
        default: false 
    },
    metadata: { 
        type: Object, 
        default: {} 
    },
    createdAt: { 
        type: Date, 
        default: Date.now,
        index: true
    },
    updatedAt: { 
        type: Date, 
        default: Date.now,
        index: true
    }
});

// Add index for faster lookups
ToolServerSchema.index({ disabled: 1, status: 1 });

/**
 * Tool parameter schema
 */
const ToolParameterSchema = new Schema({
    name: { 
        type: String, 
        required: true 
    },
    description: { 
        type: String, 
        required: true 
    },
    type: { 
        type: String, 
        enum: Object.values(ToolParameterType),
        required: true 
    },
    required: { 
        type: Boolean, 
        default: false 
    },
    default: { 
        type: Schema.Types.Mixed 
    },
    enum: [{ 
        type: String 
    }],
    validation: {
        min: { type: Number },
        max: { type: Number },
        pattern: { type: String }
    }
});

/**
 * Tool return type schema
 */
const ToolReturnTypeSchema = new Schema({
    description: { 
        type: String, 
        required: true 
    },
    type: { 
        type: String, 
        enum: Object.values(ToolParameterType),
        required: true 
    },
    schema: { 
        type: Object 
    }
});

/**
 * Tool schema
 */
const ToolSchema = new Schema({
    name: { 
        type: String, 
        required: true,
        index: true
    },
    description: { 
        type: String, 
        required: true 
    },
    version: { 
        type: String, 
        required: true 
    },
    serverId: { 
        type: Schema.Types.ObjectId, 
        ref: 'ToolServer',
        required: true,
        index: true
    },
    serverName: { 
        type: String, 
        required: true 
    },
    requiresApproval: { 
        type: Boolean, 
        default: true 
    },
    autoApprove: { 
        type: Boolean, 
        default: false 
    },
    isAsync: { 
        type: Boolean, 
        default: false 
    },
    accessLevel: { 
        type: String, 
        enum: Object.values(ToolAccessLevel),
        default: ToolAccessLevel.RESTRICTED
    },
    parameters: [ToolParameterSchema],
    returns: ToolReturnTypeSchema,
    tags: [{ 
        type: String,
        index: true
    }],
    category: { 
        type: String,
        index: true
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Add compound index for faster searches
ToolSchema.index({ accessLevel: 1, category: 1 });

/**
 * Tool call error schema
 */
const ToolCallErrorSchema = new Schema({
    code: { 
        type: String, 
        required: true 
    },
    message: { 
        type: String, 
        required: true 
    },
    details: { 
        type: Object 
    }
});

/**
 * Tool call audit log schema
 */
const ToolCallAuditSchema = new Schema({
    toolId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Tool',
        required: true,
        index: true
    },
    toolName: { 
        type: String, 
        required: true,
        index: true
    },
    serverId: { 
        type: Schema.Types.ObjectId, 
        ref: 'ToolServer',
        required: true,
        index: true
    },
    serverName: { 
        type: String, 
        required: true 
    },
    requesterId: { 
        type: String, 
        required: true,
        index: true
    },
    requesterType: { 
        type: String, 
        required: true 
    },
    conversationId: { 
        type: String, 
        required: true,
        index: true
    },
    requestId: { 
        type: String, 
        required: true,
        unique: true,
        index: true
    },
    parameters: { 
        type: Object, 
        required: true 
    },
    status: { 
        type: String, 
        enum: Object.values(ToolCallStatus),
        required: true,
        index: true
    },
    result: { 
        type: Schema.Types.Mixed 
    },
    error: ToolCallErrorSchema,
    executionTime: { 
        type: Number 
    },
    requestTimestamp: { 
        type: Date, 
        required: true,
        index: true
    },
    responseTimestamp: { 
        type: Date 
    },
    approvedBy: { 
        type: String 
    },
    approvalTimestamp: { 
        type: Date 
    },
    metadata: { 
        type: Object, 
        default: {} 
    }
});

// Add time-based index for log queries
ToolCallAuditSchema.index({ 
    requestTimestamp: -1,
    status: 1
});

/**
 * Document interfaces for MongoDB models
 */
export interface IToolServer extends Document {
    name: string;
    description: string;
    version: string;
    url: string;
    status: ToolServerStatus;
    connectionType: ToolServerConnectionType;
    authType: ToolServerAuthType;
    authConfig?: Record<string, unknown>;
    supportedTools: string[];
    disabled: boolean;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export interface IToolParameter extends Document {
    name: string;
    description: string;
    type: ToolParameterType;
    required: boolean;
    default?: unknown;
    enum?: string[];
    validation?: {
        min?: number;
        max?: number;
        pattern?: string;
    };
}

/**
 * Interface for Tool Return Type
 */
export interface IToolReturnType {
    description: string;
    type: ToolParameterType;
    schema?: Record<string, unknown>;
}

/**
 * Interface for Tool document in MongoDB
 */
export interface ITool extends Document {
    name: string;
    description: string;
    version: string;
    serverId: mongoose.Types.ObjectId | string;
    serverName: string;
    requiresApproval: boolean;
    autoApprove: boolean;
    isAsync: boolean;
    accessLevel: ToolAccessLevel;
    parameters: IToolParameter[];
    returns: IToolReturnType;
    tags: string[];
    category: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface IToolCallError extends Document {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface IToolCallAudit extends Document {
    toolId: mongoose.Types.ObjectId | string;
    toolName: string;
    serverId: mongoose.Types.ObjectId | string;
    serverName: string;
    requesterId: string;
    requesterType: string;
    conversationId: string;
    requestId: string;
    parameters: Record<string, unknown>;
    status: ToolCallStatus;
    result?: unknown;
    error?: IToolCallError;
    executionTime?: number;
    requestTimestamp: Date;
    responseTimestamp?: Date;
    approvedBy?: string;
    approvalTimestamp?: Date;
    metadata: Record<string, unknown>;
}

/**
 * Create and export Mongoose models
 */
export const ToolServer = mongoose.model<IToolServer>('ToolServer', ToolServerSchema);
export const Tool = mongoose.model<ITool>('Tool', ToolSchema);
export const ToolCallAudit = mongoose.model<IToolCallAudit>('ToolCallAudit', ToolCallAuditSchema);
