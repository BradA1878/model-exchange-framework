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
 * Message Converters Utility
 * 
 * Shared utilities for converting MCP messages to various provider formats.
 * This module extracts common message conversion logic to follow DRY principles.
 */

import {
    McpMessage,
    McpContent,
    McpContentType,
    McpTextContent,
    McpImageContent,
    McpToolResultContent,
    McpRole
} from '../IMcpClient';

/**
 * Extract tool_calls field from a message (handles extended message formats)
 * 
 * @param message - Message to extract from
 * @returns Array of tool calls or undefined
 */
export const extractToolCalls = (message: McpMessage): any[] | undefined => {
    return (message as any).tool_calls;
};

/**
 * Extract tool_call_id field from a message (handles extended message formats)
 * 
 * @param message - Message to extract from
 * @returns Tool call ID or undefined
 */
export const extractToolCallId = (message: McpMessage): string | undefined => {
    return (message as any).tool_call_id;
};

/**
 * Extract plain text from tool result content
 * Handles both single content items and arrays
 * 
 * @param toolResult - Tool result content
 * @returns Extracted text
 */
export const extractToolResultText = (toolResult: McpToolResultContent): string => {
    const content = toolResult.content;
    
    if (Array.isArray(content)) {
        return content
            .map(c => {
                if (c.type === McpContentType.TEXT) {
                    return (c as McpTextContent).text;
                } else if (c.type === McpContentType.IMAGE) {
                    return '[Image content]';
                }
                return '';
            })
            .filter(Boolean)
            .join('\n');
    } else if (content.type === McpContentType.TEXT) {
        return (content as McpTextContent).text;
    } else if (content.type === McpContentType.IMAGE) {
        return '[Image content]';
    }
    
    return JSON.stringify(content);
};

/**
 * Extract plain text from any MCP content (single or array)
 * 
 * @param content - MCP content
 * @returns Extracted text
 */
export const extractTextFromContent = (content: McpContent | McpContent[]): string => {
    if (Array.isArray(content)) {
        return content
            .filter(item => item.type === McpContentType.TEXT)
            .map(item => (item as McpTextContent).text)
            .join('\n');
    } else if (content.type === McpContentType.TEXT) {
        return (content as McpTextContent).text;
    }
    return '';
};

/**
 * Check if a message is a tool result message
 * 
 * @param message - Message to check
 * @returns True if message is a tool result
 */
export const isToolResultMessage = (message: McpMessage): boolean => {
    if (message.role === McpRole.TOOL) {
        return true;
    }
    
    // Check content for tool results
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    return contentArray.some(c => c.type === McpContentType.TOOL_RESULT);
};

/**
 * Check if a message is an assistant message with tool calls
 * 
 * @param message - Message to check
 * @returns True if message has tool calls
 */
export const hasToolCalls = (message: McpMessage): boolean => {
    if (message.role !== McpRole.ASSISTANT) {
        return false;
    }
    
    // Check for tool_calls field
    if ((message as any).tool_calls) {
        return true;
    }
    
    // Check content for tool use
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    return contentArray.some(c => c.type === McpContentType.TOOL_USE);
};

/**
 * Extract tool result content from a message
 * 
 * @param message - Message to extract from
 * @returns Tool result content or undefined
 */
export const extractToolResult = (message: McpMessage): McpToolResultContent | undefined => {
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    const toolResult = contentArray.find(c => c.type === McpContentType.TOOL_RESULT);
    return toolResult as McpToolResultContent | undefined;
};

/**
 * Extract all text content items from a message
 * 
 * @param message - Message to extract from
 * @returns Array of text content items
 */
export const extractTextContentItems = (message: McpMessage): McpTextContent[] => {
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    return contentArray.filter(c => c.type === McpContentType.TEXT) as McpTextContent[];
};

/**
 * Extract all image content items from a message
 * 
 * @param message - Message to extract from
 * @returns Array of image content items
 */
export const extractImageContentItems = (message: McpMessage): McpImageContent[] => {
    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
    return contentArray.filter(c => c.type === McpContentType.IMAGE) as McpImageContent[];
};

/**
 * Convert tool result content to a simple text representation
 * Handles nested content arrays gracefully
 * 
 * @param content - Content to convert (can be nested)
 * @returns Text representation
 */
export const convertContentToText = (content: any): string => {
    if (!content) {
        return '';
    }
    
    if (typeof content === 'string') {
        return content;
    }
    
    if (Array.isArray(content)) {
        return content
            .map(item => convertContentToText(item))
            .filter(Boolean)
            .join('\n');
    }
    
    if (typeof content === 'object' && content.type) {
        switch (content.type) {
            case McpContentType.TEXT:
                return content.text || '';
            case McpContentType.IMAGE:
                return '[Image content]';
            case McpContentType.TOOL_USE:
                return `[Tool: ${content.name}]`;
            case McpContentType.TOOL_RESULT:
                return convertContentToText(content.content);
            default:
                return JSON.stringify(content);
        }
    }
    
    return JSON.stringify(content);
};
