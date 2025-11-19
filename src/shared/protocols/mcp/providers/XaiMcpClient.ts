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
 * Xai MCP Client
 * 
 * This module implements the Model Context Protocol (MCP) client for X.ai (Grok).
 * It handles the specific API interactions required by X.ai while adhering to the
 * MCP interface for provider-agnostic usage.
 * 
 * API Reference: https://x.ai/api
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseMcpClient } from './BaseMcpClient';
import { 
    McpMessage, 
    McpTool, 
    McpApiResponse, 
    McpContentType,
    McpRole,
    McpContent,
    McpToolUseContent,
    McpTextContent
} from '../IMcpClient';
import { Logger } from '../../../utils/Logger';
import { extractToolCalls, extractToolCallId, extractToolResultText } from '../utils/MessageConverters';
import { convertToolsToProviderFormat } from '../utils/ToolHandlers';

// Create logger instance for Xai MCP client
const logger = new Logger('warn', 'XaiMcpClient', 'server');

// Type definitions for Xai API
interface XaiMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{
        type: 'text' | 'image' | 'tool_call' | 'tool_result';
        text?: string;
        image?: {
            data: string;
            mime_type: string;
        };
        tool_call_id?: string;
        name?: string;
        args?: Record<string, any>;
    }>;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        name: string;
        args: Record<string, any>;
    }>;
}

interface XaiTool {
    name: string;
    description: string;
    parameters: Record<string, any>;
}

interface XaiResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: XaiMessage;
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * X.ai (Grok) implementation of the MCP client
 */
export class XaiMcpClient extends BaseMcpClient {
    // Base URL for the X.ai API
    private readonly baseUrl = 'https://api.x.ai/v1';
    
    /**
     * Initialize the X.ai provider
     * @returns Promise that resolves when initialization is complete
     */
    protected async initializeProvider(): Promise<void> {
        // No additional initialization required for X.ai
        // The API key is already stored in the config

        // Register xAI adapter with unified converter (xAI uses OpenAI-compatible format)
        const { getMessageConverter } = require('../converters/UnifiedMessageConverter');
        const { XaiMessageAdapter } = require('../converters/adapters/XaiMessageAdapter');
        const converter = getMessageConverter('client');
        converter.registerAdapter(new XaiMessageAdapter('client'));

    }

    /**
     * Convert MCP messages to X.ai format
     * @param messages - MCP messages to convert
     * @returns X.ai formatted messages
     */
    private convertToXaiMessages(messages: McpMessage[]): XaiMessage[] {
        return messages.map(message => {
            // Handle different content formats
            let content: XaiMessage['content'];
            
            if (Array.isArray(message.content)) {
                content = message.content.map(item => {
                    switch (item.type) {
                        case McpContentType.TEXT:
                            return {
                                type: 'text',
                                text: item.text
                            };
                        case McpContentType.IMAGE:
                            return {
                                type: 'image',
                                image: {
                                    data: item.source.data,
                                    mime_type: item.source.media_type
                                }
                            };
                        case McpContentType.TOOL_USE:
                            return {
                                type: 'tool_call',
                                tool_call_id: item.id,
                                name: item.name,
                                args: item.input
                            };
                        case McpContentType.TOOL_RESULT:
                            // Safely convert tool result content to text using utility
                            const resultText = extractToolResultText(item);
                            
                            return {
                                type: 'tool_result',
                                tool_call_id: item.tool_use_id,
                                text: resultText
                            };
                        default:
                            throw new Error(`Unsupported content type: ${(item as any).type}`);
                    }
                });
            } else if (message.content) {
                // Simple text content for single content item
                if (typeof message.content === 'object' && 'type' in message.content) {
                    if (message.content.type === McpContentType.TEXT) {
                        content = (message.content as McpTextContent).text;
                    } else {
                        // For other content types, convert to string representation
                        content = JSON.stringify(message.content);
                    }
                } else {
                    // Handle primitive content or content without type
                    content = typeof message.content === 'object' ? 
                        JSON.stringify(message.content) : 
                        String(message.content);
                }
            } else {
                content = ''; // Fallback for empty content
            }
            
            const xaiMessage: XaiMessage = {
                role: this.mapRoleToXai(message.role),
                content
            };
            
            // CRITICAL: Include tool_calls for assistant messages (using utility)
            if (message.role === McpRole.ASSISTANT) {
                const toolCalls = extractToolCalls(message);
                if (toolCalls) {
                    xaiMessage.tool_calls = toolCalls as any;
                }
            }
            
            // Include tool_call_id for tool result messages (using utility)
            if (message.role === McpRole.TOOL) {
                const toolCallId = extractToolCallId(message);
                if (toolCallId) {
                    xaiMessage.tool_call_id = toolCallId;
                }
            }
            
            return xaiMessage;
        });
    }
    
    /**
     * Map MCP role to X.ai role
     * @param role - MCP role to map
     * @returns X.ai role
     */
    private mapRoleToXai(role: McpRole): XaiMessage['role'] {
        switch (role) {
            case McpRole.SYSTEM:
                return 'system';
            case McpRole.USER:
                return 'user';
            case McpRole.ASSISTANT:
                return 'assistant';
            case McpRole.TOOL:
                return 'tool';
            default:
                logger.warn(`Unknown role: ${role}, defaulting to 'user'`);
                return 'user';
        }
    }
    
    /**
     * Convert MCP tools to X.ai tools (using utility)
     * @param tools - MCP tools to convert
     * @returns X.ai formatted tools
     */
    private convertToXaiTools(tools: McpTool[]): XaiTool[] {
        return convertToolsToProviderFormat(tools, 'xai') as XaiTool[];
    }
    
    /**
     * Convert X.ai response to MCP response
     * @param response - X.ai response to convert
     * @returns MCP formatted response
     */
    private convertToMcpResponse(response: XaiResponse): McpApiResponse {
        // Get first choice from response
        if (!response.choices || response.choices.length === 0) {
            throw new Error('X.ai response does not contain any choices');
        }
        
        const choice = response.choices[0];
        if (!choice.message) {
            throw new Error('X.ai response choice does not contain a message');
        }
        
        // Parse content from message
        const content: McpContent[] = [];
        
        if (typeof choice.message.content === 'string') {
            // Simple text content
            content.push({
                type: McpContentType.TEXT,
                text: choice.message.content
            });
        } else if (Array.isArray(choice.message.content)) {
            // Complex content (text, images, tool calls)
            choice.message.content.forEach(item => {
                if (item.type === 'text' && item.text) {
                    content.push({
                        type: McpContentType.TEXT,
                        text: item.text
                    });
                } else if (item.type === 'image' && item.image) {
                    content.push({
                        type: McpContentType.IMAGE,
                        source: {
                            type: 'base64',
                            media_type: item.image.mime_type,
                            data: item.image.data
                        }
                    });
                }
                // Note: Tool calls are handled separately below
            });
        }
        
        // Handle tool calls if present
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
            choice.message.tool_calls.forEach(toolCall => {
                const toolUseContent: McpToolUseContent = {
                    type: McpContentType.TOOL_USE,
                    id: toolCall.id,
                    name: toolCall.name,
                    input: toolCall.args
                };
                content.push(toolUseContent);
            });
        }
        
        // Create MCP response
        return {
            id: response.id,
            type: 'completion',
            role: 'assistant',
            content,
            model: response.model,
            stop_reason: choice.finish_reason || null,
            stop_sequence: null,
            usage: {
                input_tokens: response.usage.prompt_tokens,
                output_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens
            }
        };
    }
    
    /**
     * Send a message to X.ai
     * @param messages - MCP messages to send
     * @param tools - Optional tools to make available
     * @param options - Additional options
     * @returns Promise with the X.ai response converted to MCP format
     */
    protected async sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        try {
            // Validate inputs
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('Messages array cannot be empty');
            }
            
            // Convert messages and tools to X.ai format
            const xaiMessages = this.convertToXaiMessages(messages);
            const xaiTools = tools ? this.convertToXaiTools(tools) : undefined;
            
            // Prepare request parameters
            const model = options?.model || this.config.defaultModel || 'grok-1';
            const temperature = options?.temperature || this.config.temperature || 0.7;
            const maxTokens = options?.maxTokens || this.config.maxTokens || 4096;
            
            // Prepare request body
            const requestBody: Record<string, any> = {
                model,
                messages: xaiMessages,
                temperature,
                max_tokens: maxTokens
            };
            
            // Add tools if provided
            if (xaiTools && xaiTools.length > 0) {
                requestBody.tools = xaiTools;
                requestBody.tool_choice = options?.requireToolUse === true 
                    ? 'required' 
                    : options?.preferToolUse === true 
                        ? 'auto' 
                        : 'none';
            }
            
            // Add provider-specific options if provided
            if (options?.providerOptions) {
                Object.assign(requestBody, options.providerOptions);
            }
            
            // Make the API request
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });
            
            // Check for errors
            if (!response.ok) {
                let errorText = await response.text();
                try {
                    const errorJson = JSON.parse(errorText);
                    errorText = errorJson.error?.message || errorText;
                } catch (e) {
                    // Use error text as is if not JSON
                }
                throw new Error(`X.ai API error [${response.status}]: ${errorText}`);
            }
            
            // Parse and convert response
            const xaiResponse: XaiResponse = await response.json();
            return this.convertToMcpResponse(xaiResponse);
        } catch (error) {
            throw new Error(`Error sending message to X.ai: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
