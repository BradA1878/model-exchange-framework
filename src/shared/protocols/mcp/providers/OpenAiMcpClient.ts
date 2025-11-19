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

import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { Observable, of, throwError } from 'rxjs';
import { BaseMcpClient } from './BaseMcpClient';
import { Logger } from '../../../utils/Logger';
import { 
    McpMessage, 
    McpTool, 
    McpApiResponse, 
    McpContentType,
    McpRole,
    McpContent,
    McpTextContent,
    McpImageContent,
    McpToolUseContent,
    McpToolResultContent,
    McpResourceOptions,
    McpResourceContent
} from '../IMcpClient';
import { extractToolCalls, extractToolCallId, extractToolResult } from '../utils/MessageConverters';

// Extended MCP Message with optional name field
interface ExtendedMcpMessage extends McpMessage {
    name?: string;
}

/**
 * Helper type guard functions for content types
 */
function isTextContent(content: McpContent): content is McpTextContent {
    return content.type === McpContentType.TEXT;
}

function isImageContent(content: McpContent): content is McpImageContent {
    return content.type === McpContentType.IMAGE;
}

function isToolUseContent(content: McpContent): content is McpToolUseContent {
    return content.type === McpContentType.TOOL_USE;
}

function isToolResultContent(content: McpContent): content is McpToolResultContent {
    return content.type === McpContentType.TOOL_RESULT;
}

/**
 * OpenAI implementation of the MCP client
 */
export class OpenAiMcpClient extends BaseMcpClient {
    // OpenAI API client
    private apiClient: OpenAI | null = null;
    // Logger
    protected logger = new Logger('info', 'OpenAiMcpClient', 'server');

    /**
     * Initialize the OpenAI provider by creating a client instance
     */
    protected async initializeProvider(): Promise<void> {
        this.apiClient = new OpenAI({
            apiKey: this.config.apiKey,
            maxRetries: 3,
            timeout: 60000, // 60 seconds
            dangerouslyAllowBrowser: false
        });

        // Register OpenAI adapter with unified converter
        const { getMessageConverter } = require('../converters/UnifiedMessageConverter');
        const { OpenAiMessageAdapter } = require('../converters/adapters/OpenAiMessageAdapter');
        const converter = getMessageConverter('client');
        converter.registerAdapter(new OpenAiMessageAdapter('client'));

    }

    /**
     * Extract text from tool result content
     * @param toolContent The tool result content
     * @returns The extracted text
     */
    private extractTextFromToolResult(toolContent: McpToolResultContent): string {
        if (Array.isArray(toolContent.content)) {
            // Find all text content items and join them
            return toolContent.content
                .filter(isTextContent)
                .map(textContent => textContent.text)
                .join('\n');
        } else if (isTextContent(toolContent.content)) {
            // Single text content
            return toolContent.content.text;
        } else {
            // Other content type, stringify as fallback
            return JSON.stringify(toolContent.content);
        }
    }

    /**
     * Convert MCP messages to OpenAI format
     * 
     * @param messages MCP messages
     * @returns OpenAI messages
     */
    private convertToOpenAiMessages(messages: ExtendedMcpMessage[]): OpenAI.ChatCompletionMessageParam[] {
        return messages.map(message => {
            // Base message structure with appropriate type casting
            const baseRole = this.mapRoleToOpenAi(message.role);
            
            // Tool message handling
            if (message.role === 'tool' as McpRole) {
                // Extract tool_call_id from message object (not from content)
                const toolCallId = extractToolCallId(message);
                const toolContent = Array.isArray(message.content) 
                    ? message.content.find(isToolResultContent)
                    : isToolResultContent(message.content) ? message.content : null;
                
                if (toolCallId && toolContent) {
                    return {
                        role: 'tool' as const,
                        tool_call_id: toolCallId,
                        content: this.extractTextFromToolResult(toolContent)
                    } as OpenAI.ChatCompletionToolMessageParam;
                }
            }

            // Handle assistant messages with tool calls
            if (message.role === McpRole.ASSISTANT) {
                // Check for tool_calls directly on message (from conversation history)
                const directToolCalls = extractToolCalls(message);
                
                // Also check for tool_use contents in message.content
                let toolCalls = directToolCalls;
                if (!toolCalls && Array.isArray(message.content)) {
                    const toolUseContents = message.content.filter(isToolUseContent);
                    if (toolUseContents.length > 0) {
                        // Create OpenAI tool calls from MCP tool uses
                        toolCalls = toolUseContents.map(toolUse => ({
                            id: toolUse.id,
                            type: 'function' as const,
                            function: {
                                name: toolUse.name,
                                arguments: JSON.stringify(toolUse.input)
                            }
                        }));
                    }
                }
                
                if (toolCalls) {
                    // Find text content to use as the message content
                    const contentArray = Array.isArray(message.content) ? message.content : [message.content];
                    const textContents = contentArray.filter(isTextContent);
                    const textContent = textContents.length > 0 
                        ? textContents.map(tc => tc.text).join('\n')
                        : '';
                    
                    const assistantMessage: OpenAI.ChatCompletionAssistantMessageParam = {
                        role: 'assistant',
                        content: textContent || null,
                        tool_calls: toolCalls
                    };
                    
                    return assistantMessage;
                }
            }
            
            // Handle content array for regular messages
            let content: string | null = null;
            
            if (Array.isArray(message.content)) {
                // Extract text from all text content items
                const textParts = message.content
                    .filter(isTextContent)
                    .map(item => item.text);
                
                content = textParts.length > 0 ? textParts.join('\n') : null;
                
                // Handle image content for user messages
                const imageContents = message.content.filter(isImageContent);
                if (message.role === McpRole.USER && imageContents.length > 0 && baseRole === 'user') {
                    return {
                        role: 'user',
                        content: [
                            ...(content ? [{ type: 'text', text: content }] : []),
                            ...imageContents.map(img => ({
                                type: 'image_url',
                                image_url: {
                                    url: img.source.data,
                                    detail: 'auto'
                                }
                            }))
                        ]
                    } as OpenAI.ChatCompletionUserMessageParam;
                }
            } else if (isTextContent(message.content)) {
                // Single text content
                content = message.content.text;
            } else if (isImageContent(message.content) && message.role === McpRole.USER && baseRole === 'user') {
                // Single image content for user
                return {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: message.content.source.data,
                                detail: 'auto'
                            }
                        }
                    ]
                } as OpenAI.ChatCompletionUserMessageParam;
            }
            
            // Create appropriate message based on role
            if (baseRole === 'user') {
                return { 
                    role: 'user', 
                    content: content || '' 
                } as OpenAI.ChatCompletionUserMessageParam;
            } else if (baseRole === 'assistant') {
                return { 
                    role: 'assistant', 
                    content: content || '' 
                } as OpenAI.ChatCompletionAssistantMessageParam;
            } else if (baseRole === 'system') {
                return { 
                    role: 'system', 
                    content: content || '' 
                } as OpenAI.ChatCompletionSystemMessageParam;
            } else if (baseRole === 'function') {
                if (message.name) {
                    return {
                        role: 'function',
                        name: message.name,
                        content: content || ''
                    } as OpenAI.ChatCompletionFunctionMessageParam;
                }
                throw new Error('Function messages must have a name property');
            }
            
            // Fallback
            return { 
                role: baseRole, 
                content: content || '' 
            } as OpenAI.ChatCompletionMessageParam;
        });
    }

    /**
     * Map MCP role to OpenAI role
     * 
     * @param role MCP role
     * @returns OpenAI role
     */
    private mapRoleToOpenAi(role: McpRole): OpenAI.ChatCompletionMessageParam['role'] {
        switch (role) {
            case McpRole.USER:
                return 'user';
            case McpRole.ASSISTANT:
                return 'assistant';
            case McpRole.SYSTEM:
                return 'system';
            case 'function' as McpRole:
                return 'function';
            case 'tool' as McpRole:
                return 'tool';
            default:
                // Default to user if unknown
                this.logger.warn(`Unknown role: ${role}, defaulting to user`);
                return 'user';
        }
    }

    /**
     * Convert MCP tools to OpenAI tools
     * 
     * @param tools MCP tools
     * @returns OpenAI tools
     */
    private convertToOpenAiTools(tools: McpTool[]): OpenAI.ChatCompletionTool[] {
        return tools.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema
            }
        }));
    }

    /**
     * Convert OpenAI response to MCP response
     * 
     * @param response OpenAI response
     * @returns MCP response
     */
    private convertToMcpResponse(response: OpenAI.ChatCompletion): McpApiResponse {
        const content: McpContent[] = [];
        
        // Process message content
        const message = response.choices[0]?.message;
        
        if (message) {
            // Handle text content
            if (typeof message.content === 'string' && message.content) {
                content.push({
                    type: McpContentType.TEXT,
                    text: message.content
                });
            }
            
            // Handle tool calls
            if (message.tool_calls && message.tool_calls.length > 0) {
                message.tool_calls.forEach(toolCall => {
                    if (toolCall.type === 'function') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            content.push({
                                type: McpContentType.TOOL_USE,
                                id: toolCall.id,
                                name: toolCall.function.name,
                                input: args
                            });
                        } catch (error) {
                            this.logger.error(`Error parsing tool arguments: ${error}`);
                            // Still include the tool call even if parsing fails
                            content.push({
                                type: McpContentType.TOOL_USE,
                                id: toolCall.id,
                                name: toolCall.function.name,
                                input: { raw: toolCall.function.arguments }
                            });
                        }
                    }
                });
            }
        }
        
        // Fallback for content array
        if (content.length === 0 && typeof message?.content === 'string') {
            content.push({
                type: McpContentType.TEXT,
                text: message.content || ''
            });
        }
        
        // Create MCP API response
        return {
            id: response.id,
            type: 'message',
            role: 'assistant',
            model: response.model,
            content,
            stop_reason: response.choices[0]?.finish_reason || null,
            stop_sequence: null,
            usage: {
                input_tokens: response.usage?.prompt_tokens || 0,
                output_tokens: response.usage?.completion_tokens || 0,
                total_tokens: response.usage?.total_tokens || 0
            }
        };
    }

    /**
     * Convert response API response to MCP format
     * 
     * @param response The response API response
     * @returns MCP API response
     */
    private convertResponseToMcpResponse(response: any): McpApiResponse {
        const content: McpContent[] = [];
        
        // Add text content
        content.push({
            type: McpContentType.TEXT,
            text: response.text || ''
        });
        
        // Create MCP API response
        return {
            id: response.id,
            type: 'message',
            role: 'assistant',
            model: response.model,
            content,
            stop_reason: response.stop_reason || null,
            stop_sequence: null,
            usage: {
                input_tokens: response.usage?.input_tokens || 0,
                output_tokens: response.usage?.output_tokens || 0,
                total_tokens: response.usage?.total_tokens || 0
            }
        };
    }

    /**
     * Send a message to OpenAI
     * 
     * @param messages MCP messages to send
     * @param tools Optional tools to make available
     * @param options Additional options
     * @returns Promise with the OpenAI response
     */
    protected async sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        try {
            // Ensure the API client is initialized
            if (!this.apiClient) {
                await this.initializeProvider();
                if (!this.apiClient) {
                    throw new Error('Failed to initialize OpenAI API client');
                }
            }
            
            // Use the completions-based API for most requests
            // This is more flexible for complex interactions
            
            // Convert messages to OpenAI format
            const openaiMessages = this.convertToOpenAiMessages(messages as ExtendedMcpMessage[]);
            
            // Convert tools to OpenAI format if provided
            const openaiTools = tools && tools.length > 0 
                ? this.convertToOpenAiTools(tools) 
                : undefined;
            
            // Prepare request parameters
            const params: OpenAI.ChatCompletionCreateParams = {
                model: options?.model || this.config.defaultModel || 'gpt-4o',
                messages: openaiMessages,
                temperature: options?.temperature ?? this.config.temperature ?? 0.7,
                max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 1024
            };
            
            // Add JSON response format if requested
            if (options?.responseFormat === 'json') {
                params.response_format = { 
                    type: 'json_object' 
                };
            }
            
            // Add tools if provided
            if (openaiTools && openaiTools.length > 0) {
                params.tools = openaiTools;
                
                // Set tool_choice based on options
                if (options?.requireTool) {
                    params.tool_choice = 'required';
                } else if (options?.preferTool) {
                    // Let the model decide when to use tools
                    params.tool_choice = 'auto';
                } else {
                    // Don't use tools unless explicitly requested
                    params.tool_choice = 'none';
                }
            }
            
            // Add parallel tool calling if supported by the model and requested
            if (openaiTools && openaiTools.length > 1 && options?.parallelToolCalls === true) {
                // @ts-ignore - This property might not be in the type definitions yet
                params.parallel_tool_calls = true;
            }
            
            // Add seed for deterministic results if provided
            if (options?.seed !== undefined && typeof options.seed === 'number') {
                params.seed = options.seed;
            }
            
            // Add any provider-specific options
            if (options?.providerOptions) {
                Object.assign(params, options.providerOptions);
            }
            
            // Make the API request using the OpenAI SDK
            const response = await this.apiClient.chat.completions.create(params);
            
            // Convert the response to MCP format
            return this.convertToMcpResponse(response);
        } catch (error) {
            // Handle OpenAI-specific errors
            if (error instanceof OpenAI.APIError) {
                throw new Error(`OpenAI API error [${error.status}]: ${error.message}, Request ID: ${error.request_id}`);
            }
            throw new Error(`Error sending message to OpenAI: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Send a request using the new responses.create API format
     * @param instructions The system instructions
     * @param input The user input
     * @param options Additional options
     * @returns Promise with the MCP response
     */
    private async sendInstructionsBasedRequest(
        instructions: string,
        input: McpContent | McpContent[] | undefined,
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        // Ensure the API client is initialized
        if (!this.apiClient) {
            await this.initializeProvider();
            if (!this.apiClient) {
                throw new Error('Failed to initialize OpenAI API client');
            }
        }
        
        // Extract text from input content
        let inputText = '';
        
        if (Array.isArray(input)) {
            // If it's an array, extract text from all text content items
            inputText = input
                .filter(isTextContent)
                .map(item => item.text)
                .join('\n');
        } else if (input && isTextContent(input)) {
            // If it's a single text content
            inputText = input.text;
        }
        
        // Prepare request parameters
        const params: any = {
            model: options?.model || this.config.defaultModel || 'gpt-4.1',
            instructions,
            input: inputText
        };
        
        // Add optional parameters
        if (options?.temperature) {
            params.temperature = options.temperature;
        }
        
        if (options?.maxTokens) {
            params.max_tokens = options.maxTokens;
        }
        
        try {
            // Make the API request using the OpenAI SDK
            const response = await this.apiClient.responses.create(params);
            
            // Convert to MCP response
            return this.convertResponseToMcpResponse(response);
        } catch (error) {
            // Handle OpenAI-specific errors
            if (error instanceof OpenAI.APIError) {
                throw new Error(`OpenAI API error [${error.status}]: ${error.message}, Request ID: ${error.request_id}`);
            }
            throw new Error(`Error sending message to OpenAI: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * List available resources
     * @param options Options for listing resources
     */
    public listResources(options?: McpResourceOptions): Observable<McpResourceContent[]> {
        // OpenAI doesn't have a built-in resource management system
        // Return an empty array for now
        this.logger.warn('listResources is not implemented for OpenAI');
        return of([]);
    }
    
    /**
     * Get a resource by URI
     * @param uri Resource URI
     */
    public getResource(uri: string): Observable<McpResourceContent> {
        // OpenAI doesn't have a built-in resource management system
        this.logger.warn(`getResource is not implemented for OpenAI, attempted for URI: ${uri}`);
        return throwError(() => new Error('Resource access not supported for OpenAI provider'));
    }
}
