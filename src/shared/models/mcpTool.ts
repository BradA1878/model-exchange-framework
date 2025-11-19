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
 * MCP Tool Model
 * 
 * Represents a Model Context Protocol (MCP) tool that can be registered and executed
 * within the Model Exchange Framework.
 */

import mongoose, { Document, Schema } from 'mongoose';
import { createStrictValidator } from '../utils/validation';

// Create validator for the MCP tool model
const validate = createStrictValidator('McpToolModel');

/**
 * MCP Tool Parameter interface
 */
export interface IMcpToolParameter {
    name: string;
    type: string;
    description: string;
    required: boolean;
    defaultValue?: any;
}

/**
 * MCP Tool interface
 */
export interface IMcpTool extends Document {
    // Basic tool information
    name: string;
    description: string;
    
    // Tool configuration
    inputSchema: Record<string, any>;
    enabled: boolean;
    
    // Tool parameters
    parameters: Array<Record<string, any>>;
    
    // Tracking information
    providerId: string;
    channelId: string;
    
    // Additional data
    metadata: Record<string, any>;
    
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

/**
 * MCP Tool schema
 */
const McpToolSchema = new Schema<IMcpTool>({
    // Basic tool information
    name: { 
        type: String, 
        required: true,
        index: true
    },
    description: { 
        type: String, 
        required: true 
    },
    
    // Tool configuration
    inputSchema: { 
        type: Schema.Types.Mixed, 
        required: true 
    },
    enabled: { 
        type: Boolean, 
        default: true,
        index: true
    },
    
    // Tool parameters
    parameters: { 
        type: Schema.Types.Mixed, 
        default: [] 
    },
    
    // Tracking information
    providerId: { 
        type: String, 
        required: true,
        index: true
    },
    channelId: { 
        type: String, 
        required: false,
        default: '',  
        index: true
    },
    
    // Additional data
    metadata: { 
        type: Schema.Types.Mixed, 
        default: {} 
    },
    
    // Timestamps
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Create compound indexes for better query performance
McpToolSchema.index({ channelId: 1, enabled: 1 });
McpToolSchema.index({ providerId: 1, enabled: 1 });

// Create unique compound index to prevent duplicate tools
McpToolSchema.index({ name: 1, providerId: 1, channelId: 1 }, { unique: true });

// Pre-save hook to update the updatedAt field
McpToolSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Create the model
export const McpTool = mongoose.model<IMcpTool>('McpTool', McpToolSchema);

/**
 * Create a new MCP tool in the database
 * @param toolData The tool data to save
 * @returns Promise resolving to the created tool
 */
export const createMcpTool = async (toolData: Omit<IMcpTool, keyof Document>): Promise<IMcpTool> => {
    validate.assertIsObject(toolData);
    validate.assertIsNonEmptyString(toolData.name);
    
    // Description can be empty but must be a string if provided
    if (toolData.description !== undefined && typeof toolData.description !== 'string') {
        throw new Error('[McpToolModel] Description must be a string if provided');
    }
    
    validate.assertIsObject(toolData.inputSchema);
    validate.assertIsNonEmptyString(toolData.providerId);
    
    // ChannelId can be empty but must be a string
    if (toolData.channelId !== undefined && typeof toolData.channelId !== 'string') {
        throw new Error('[McpToolModel] ChannelId must be a string if provided');
    }
    
    const tool = await McpTool.findOneAndUpdate(
        { name: toolData.name, providerId: toolData.providerId, channelId: toolData.channelId },
        { $setOnInsert: toolData },
        { new: true, upsert: true }
    );
    return tool;
};

/**
 * Find an MCP tool by name
 * @param name Name of the tool to find
 * @returns Promise resolving to the found tool or null
 */
export const findMcpToolByName = async (name: string): Promise<IMcpTool | null> => {
    validate.assertIsNonEmptyString(name);
    return await McpTool.findOne({ name });
};

/**
 * Find MCP tools by channel ID
 * @param channelId Channel ID to filter by
 * @param enabledOnly Whether to return only enabled tools
 * @returns Promise resolving to an array of found tools
 */
export const findMcpToolsByChannelId = async (
    channelId: string, 
    enabledOnly = true
): Promise<IMcpTool[]> => {
    validate.assertIsNonEmptyString(channelId);
    
    const query: any = { channelId };
    if (enabledOnly) {
        query.enabled = true;
    }
    
    return await McpTool.find(query);
};

/**
 * List all MCP tools
 * @param enabledOnly Whether to return only enabled tools
 * @returns Promise resolving to an array of all tools
 */
export const listAllMcpTools = async (enabledOnly = true): Promise<IMcpTool[]> => {
    const query: any = {};
    if (enabledOnly) {
        query.enabled = true;
    }
    
    return await McpTool.find(query);
};

/**
 * Update an MCP tool
 * @param name Name of the tool to update
 * @param updates Updates to apply to the tool
 * @returns Promise resolving to the updated tool or null if not found
 */
export const updateMcpTool = async (
    name: string, 
    updates: Partial<IMcpTool>
): Promise<IMcpTool | null> => {
    validate.assertIsNonEmptyString(name);
    validate.assertIsObject(updates);
    
    return await McpTool.findOneAndUpdate(
        { name }, 
        { ...updates, updatedAt: new Date() },
        { new: true }
    );
};

/**
 * Delete an MCP tool
 * @param name Name of the tool to delete
 * @returns Promise resolving to true if deleted, false if not found
 */
export const deleteMcpTool = async (name: string): Promise<boolean> => {
    validate.assertIsNonEmptyString(name);
    
    const result = await McpTool.deleteOne({ name });
    return result.deletedCount > 0;
};
