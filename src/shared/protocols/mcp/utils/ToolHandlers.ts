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
 * Tool Handlers Utility
 * 
 * Shared utilities for handling tool calls, tool results, and tool definitions.
 * Extracted to follow DRY principles across all MCP providers.
 */

import {
    McpTool,
    McpMessage,
    McpContent,
    McpContentType,
    McpToolUseContent,
    McpToolResultContent,
    McpRole
} from '../IMcpClient';
import { extractToolCalls, extractToolCallId, extractToolResult } from './MessageConverters';

/**
 * Build tool_calls array from MCP message content
 * Converts TOOL_USE content items to provider-specific tool call format
 * 
 * @param message - Message to extract tool calls from
 * @param format - Tool call format ('openrouter' | 'openai' | 'anthropic' | 'xai' | 'gemini')
 * @returns Array of tool calls or undefined
 */
export const buildToolCallsFromContent = (
    message: McpMessage,
    format: 'openrouter' | 'openai' | 'anthropic' | 'xai' | 'gemini' = 'openrouter'
): any[] | undefined => {
    // First check if tool_calls already exist on the message
    const existingToolCalls = extractToolCalls(message);
    if (existingToolCalls) {
        return existingToolCalls;
    }
    
    // Extract tool use content items
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    const toolUseItems = contentArray.filter(c => c.type === McpContentType.TOOL_USE) as McpToolUseContent[];
    
    if (toolUseItems.length === 0) {
        return undefined;
    }
    
    // Convert to provider format
    switch (format) {
        case 'openai':
        case 'openrouter':
        case 'xai':
            // OpenAI, OpenRouter, and xAI use the same tool call format
            return toolUseItems.map(tool => ({
                id: tool.id,
                type: 'function' as const,
                function: {
                    name: tool.name,
                    arguments: JSON.stringify(tool.input)
                }
            }));
            
        case 'anthropic':
            // Anthropic uses a different format (handled in content blocks)
            return toolUseItems.map(tool => ({
                type: 'tool_use',
                id: tool.id,
                name: tool.name,
                input: tool.input
            }));
            
        case 'gemini':
            // Gemini uses function call format similar to OpenAI
            return toolUseItems.map(tool => ({
                name: tool.name,
                args: tool.input
            }));
            
        default:
            return toolUseItems.map(tool => ({
                id: tool.id,
                type: 'function',
                function: {
                    name: tool.name,
                    arguments: JSON.stringify(tool.input)
                }
            }));
    }
};

/**
 * Extract tool_call_id from a tool result message
 * Handles both message-level and content-level tool_call_id
 * 
 * @param message - Message to extract from
 * @returns Tool call ID or undefined
 */
export const extractToolCallIdFromMessage = (message: McpMessage): string | undefined => {
    // Check message level first
    const messageToolCallId = extractToolCallId(message);
    if (messageToolCallId) {
        return messageToolCallId;
    }
    
    // Check content level
    const toolResult = extractToolResult(message);
    if (toolResult) {
        return toolResult.tool_use_id;
    }
    
    return undefined;
};

/**
 * Check if message should be treated as a tool message
 * 
 * @param message - Message to check
 * @returns True if message is a tool result
 */
export const isToolMessage = (message: McpMessage): boolean => {
    return message.role === McpRole.TOOL;
};

/**
 * Check if assistant message has tool calls
 * 
 * @param message - Message to check
 * @returns True if message has tool calls
 */
export const hasToolCallsInMessage = (message: McpMessage): boolean => {
    if (message.role !== McpRole.ASSISTANT) {
        return false;
    }
    
    // Check for explicit tool_calls field
    if (extractToolCalls(message)) {
        return true;
    }
    
    // Check content for TOOL_USE items
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    return contentArray.some(c => c.type === McpContentType.TOOL_USE);
};

/**
 * Convert MCP tool definitions to provider-specific format
 * 
 * @param tools - MCP tools
 * @param format - Provider format
 * @returns Converted tools
 */
export const convertToolsToProviderFormat = (
    tools: McpTool[],
    format: 'openrouter' | 'openai' | 'anthropic' | 'xai' | 'gemini'
): any[] => {
    switch (format) {
        case 'openrouter':
        case 'openai':
            return tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: {
                        type: 'object',
                        properties: (tool as any).inputSchema?.properties || tool.input_schema?.properties || {},
                        required: (tool as any).inputSchema?.required || tool.input_schema?.required || []
                    }
                }
            }));
            
        case 'anthropic':
            return tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.input_schema
            }));
            
        case 'xai':
            return tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema
            }));
            
        case 'gemini':
            // Gemini requires schema conversion - handled separately in GeminiMcpClient
            return tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema
            }));
            
        default:
            return tools;
    }
};

/**
 * Parse tool arguments safely
 * Handles empty strings, invalid JSON, etc.
 * 
 * @param args - Arguments string to parse
 * @returns Parsed arguments object
 */
export const parseToolArguments = (args: string | undefined): Record<string, any> => {
    if (!args || args.trim().length === 0) {
        return {};
    }
    
    try {
        return JSON.parse(args);
    } catch (error) {
        // Return empty object if parsing fails
        return {};
    }
};

/**
 * Validate tool call structure
 * 
 * @param toolCall - Tool call to validate
 * @returns True if valid
 */
export const isValidToolCall = (toolCall: any): boolean => {
    return (
        toolCall &&
        typeof toolCall === 'object' &&
        typeof toolCall.id === 'string' &&
        typeof toolCall.name === 'string'
    );
};

/**
 * Extract all tool use content from message
 * 
 * @param message - Message to extract from
 * @returns Array of tool use content items
 */
export const extractToolUseContent = (message: McpMessage): McpToolUseContent[] => {
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    return contentArray.filter(c => c.type === McpContentType.TOOL_USE) as McpToolUseContent[];
};

/**
 * Extract all tool result content from message
 * 
 * @param message - Message to extract from
 * @returns Array of tool result content items
 */
export const extractToolResultContent = (message: McpMessage): McpToolResultContent[] => {
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    return contentArray.filter(c => c.type === McpContentType.TOOL_RESULT) as McpToolResultContent[];
};
