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
 * Gemini MCP Client
 * 
 * This module implements the Model Context Protocol (MCP) client for Google's Gemini API.
 * It uses the official Google Gen AI SDK for TypeScript/JavaScript.
 * 
 * API Reference: https://ai.google.dev/api
 * SDK Repository: https://github.com/googleapis/js-genai
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseMcpClient } from './BaseMcpClient';
import { 
    McpMessage, 
    McpTool, 
    McpApiResponse, 
    McpContentType,
    McpRole
} from '../IMcpClient';
import * as genai from '@google/genai';
import { extractToolCalls, extractToolCallId, extractTextFromContent, convertContentToText } from '../utils/MessageConverters';

// Import types from Google Gen AI SDK
// These types are dynamically imported in the initializeProvider method
type GoogleGenAI = any;
type GenerateContentRequest = any;
type Part = any;
type Content = any;
type FunctionDeclaration = any;
type Type = any;
type FunctionCallingConfigMode = any;

/**
 * Gemini implementation of the MCP client using the official Google Gen AI SDK
 */
export class GeminiMcpClient extends BaseMcpClient {
    // Google GenAI client instance
    private genAiClient: any = null;
    
    // SDK modules (dynamically imported)
    private GoogleGenAI: GoogleGenAI | null = null;
    private Type: Type | null = null;
    private FunctionCallingConfigMode: FunctionCallingConfigMode | null = null;
    
    /**
     * Initialize the Gemini provider
     */
    protected async initializeProvider(): Promise<void> {
        try {
            // Dynamically import the Google Gen AI SDK
            // This allows the SDK to be an optional dependency
            // Use imported genai module
            
            // Store SDK exports for later use
            this.GoogleGenAI = genai.GoogleGenAI;
            this.Type = genai.Type;
            this.FunctionCallingConfigMode = genai.FunctionCallingConfigMode;
            
            // Initialize the Google Gen AI client
            this.genAiClient = new this.GoogleGenAI({ apiKey: this.config.apiKey });
            
            if (!this.genAiClient) {
                throw new Error('Failed to initialize Google Gen AI client');
            }

            // Register Gemini adapter with unified converter
            const { getMessageConverter } = require('../converters/UnifiedMessageConverter');
            const { GeminiMessageAdapter } = require('../converters/adapters/GeminiMessageAdapter');
            const converter = getMessageConverter('client');
            converter.registerAdapter(new GeminiMessageAdapter('client'));

            console.log('✅ Gemini message adapter registered (client context)');
        } catch (error) {
            throw new Error(`Error initializing Gemini client: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Convert MCP messages to Google Gen AI Content format
     * 
     * @param messages MCP messages
     * @returns Google Gen AI Content array
     */
    private convertToGeminiContent(messages: McpMessage[]): Content[] {
        if (!this.genAiClient) {
            throw new Error('Google Gen AI client not initialized');
        }
        
        const contents: Content[] = [];
        let currentRole: string | null = null;
        let currentParts: Part[] = [];
        
        // Process system messages separately - they need to be included with the first user message
        let systemPrompt = '';
        
        // First, extract all system prompts
        messages.forEach(message => {
            if (message.role === McpRole.SYSTEM) {
                const text = this.extractTextFromContent(message.content);
                if (text) {
                    systemPrompt += (systemPrompt ? '\n\n' : '') + text;
                }
            }
        });
        
        // Process remaining messages
        for (const message of messages) {
            // Skip system messages as they're handled separately
            if (message.role === McpRole.SYSTEM) {
                continue;
            }
            
            // Map MCP role to Gemini role
            const role = message.role === McpRole.USER ? 'user' : 'model';
            
            // If role changes, flush the current parts to a Content
            if (currentRole !== null && currentRole !== role) {
                if (currentParts.length > 0) {
                    contents.push({ role: currentRole, parts: [...currentParts] });
                    currentParts = [];
                }
            }
            
            // Set the current role
            currentRole = role;
            
            // Add system prompt to the first user message
            if (role === 'user' && systemPrompt && contents.length === 0 && currentParts.length === 0) {
                currentParts.push({ text: systemPrompt + '\n\n' });
                systemPrompt = ''; // Clear so it's not added again
            }
            
            // Handle tool calls for assistant messages (using utility)
            if (message.role === McpRole.ASSISTANT) {
                const toolCalls = extractToolCalls(message);
                if (toolCalls) {
                    // Add tool calls as text for Gemini (doesn't support structured tool calls)
                    toolCalls.forEach((toolCall: any) => {
                        const toolText = `Tool Call: ${toolCall.function?.name || toolCall.name}\nArguments: ${JSON.stringify(toolCall.function?.arguments || toolCall.input)}`;
                        currentParts.push({ text: toolText });
                    });
                }
            }
            
            // Handle tool results (using utility)
            if (message.role === McpRole.TOOL) {
                const toolCallId = extractToolCallId(message);
                const resultText = convertContentToText(message.content);
                currentParts.push({ text: `Tool Result (${toolCallId || 'unknown'}): ${resultText}` });
            } else {
                // Convert message content to parts
                const parts = this.convertMessageContentToParts(message.content);
                currentParts.push(...parts);
            }
        }
        
        // Add any remaining parts
        if (currentRole !== null && currentParts.length > 0) {
            contents.push({ role: currentRole, parts: [...currentParts] });
        }
        
        return contents;
    }
    
    /**
     * Extract text from MCP content (using utility)
     * 
     * @param content MCP content
     * @returns Extracted text
     */
    private extractTextFromContent(content: any): string {
        return extractTextFromContent(content);
    }
    
    /**
     * Convert MCP message content to Google Gen AI parts
     * 
     * @param content MCP content
     * @returns Array of Google Gen AI parts
     */
    private convertMessageContentToParts(content: any): Part[] {
        const parts: Part[] = [];
        
        if (Array.isArray(content)) {
            content.forEach(item => {
                const part = this.convertContentItemToPart(item);
                if (part) {
                    parts.push(part);
                }
            });
        } else {
            const part = this.convertContentItemToPart(content);
            if (part) {
                parts.push(part);
            }
        }
        
        return parts;
    }
    
    /**
     * Convert a single MCP content item to a Google Gen AI part
     * 
     * @param item MCP content item
     * @returns Google Gen AI part or null if not convertible
     */
    private convertContentItemToPart(item: any): Part | null {
        if (!this.Type) {
            throw new Error('Google Gen AI client not initialized');
        }
        
        // Safety check for null/undefined
        if (!item) return null;
        
        // Handle both single content items and arrays of content
        if (Array.isArray(item)) {
            // If we got an array but expected a single item, use the first item
            if (item.length === 0) return null;
            return this.convertContentItemToPart(item[0]);
        }
        
        switch (item.type) {
            case McpContentType.TEXT:
                return { text: item.text };
            case McpContentType.IMAGE:
                // For images, use the Gemini SDK's inlineData method
                return {
                    inlineData: {
                        data: item.source.data,
                        mimeType: item.source.media_type
                    }
                };
            case McpContentType.TOOL_USE:
            case McpContentType.TOOL_RESULT:
                // Gemini doesn't directly support tool use/result as a content type
                // We'll convert it to text format
                if (item.type === McpContentType.TOOL_USE) {
                    return {
                        text: `Tool: ${item.name}\nInput: ${JSON.stringify(item.input, null, 2)}`
                    };
                } else {
                    // Use utility for tool result conversion
                    const resultText = convertContentToText(item.content);
                    return {
                        text: `Tool Result (${item.tool_use_id}):\n${resultText}`
                    };
                }
            default:
                return null;
        }
    }
    
    /**
     * Convert MCP tools to Google Gen AI function declarations
     * 
     * @param tools MCP tools
     * @returns Google Gen AI function declarations
     */
    private convertToFunctionDeclarations(tools: McpTool[]): FunctionDeclaration[] {
        if (!this.Type) {
            throw new Error('Google Gen AI SDK Type not available');
        }
        
        return tools.map(tool => {
            // Convert the input schema to Gemini format
            const parameters = this.convertJsonSchemaToGeminiSchema(tool.input_schema);
            
            return {
                name: tool.name,
                description: tool.description,
                parameters
            };
        });
    }
    
    /**
     * Convert JSON Schema to Gemini parameter schema
     * 
     * @param schema JSON Schema object
     * @returns Gemini parameter schema
     */
    private convertJsonSchemaToGeminiSchema(schema: Record<string, any>): Record<string, any> {
        if (!this.Type) {
            throw new Error('Google Gen AI SDK Type not available');
        }
        
        // Map JSON Schema types to Gemini Types
        const typeMap: Record<string, any> = {
            'string': this.Type.STRING,
            'number': this.Type.NUMBER,
            'integer': this.Type.NUMBER,
            'boolean': this.Type.BOOLEAN,
            'array': this.Type.ARRAY,
            'object': this.Type.OBJECT
        };
        
        const result: Record<string, any> = {
            type: typeMap[schema.type] || this.Type.OBJECT
        };
        
        // Add description if available
        if (schema.description) {
            result.description = schema.description;
        }
        
        // For objects, process properties
        if (schema.type === 'object' && schema.properties) {
            result.properties = {};
            
            // Process each property
            for (const [key, value] of Object.entries(schema.properties)) {
                result.properties[key] = this.convertJsonSchemaToGeminiSchema(value as Record<string, any>);
            }
            
            // Add required fields if specified
            if (schema.required && Array.isArray(schema.required)) {
                result.required = schema.required;
            }
        }
        
        // For arrays, process items
        if (schema.type === 'array' && schema.items) {
            result.items = this.convertJsonSchemaToGeminiSchema(schema.items as Record<string, any>);
        }
        
        // Handle enum values
        if (schema.enum && Array.isArray(schema.enum)) {
            result.enum = schema.enum;
        }
        
        return result;
    }
    
    /**
     * Convert Google Gen AI response to MCP response
     * 
     * @param response Google Gen AI response
     * @param modelName Model name used in the request
     * @returns MCP response
     */
    private convertToMcpResponse(response: any, modelName: string): McpApiResponse {
        // Extract content from the response
        const content: McpApiResponse['content'] = [];
        
        // Check for text response
        if (response.text) {
            content.push({
                type: McpContentType.TEXT,
                text: response.text
            });
        }
        
        // Check for parts
        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.text) {
                    content.push({
                        type: McpContentType.TEXT,
                        text: part.text
                    });
                } else if (part.inlineData) {
                    content.push({
                        type: McpContentType.IMAGE,
                        source: {
                            type: 'base64',
                            media_type: part.inlineData.mimeType,
                            data: part.inlineData.data
                        }
                    });
                }
            }
        }
        
        // Check for function calls
        if (response.functionCalls && response.functionCalls.length > 0) {
            for (const functionCall of response.functionCalls) {
                content.push({
                    type: McpContentType.TOOL_USE,
                    id: uuidv4(),
                    name: functionCall.name,
                    input: functionCall.args
                });
            }
        }
        
        // Use metadata from the response if available, otherwise estimate
        const promptTokens = response.promptTokenCount || 0;
        const completionTokens = response.candidatesTokenCount || 0;
        const totalTokens = response.totalTokenCount || (promptTokens + completionTokens);
        
        // Create MCP response
        return {
            id: response.promptId || uuidv4(),
            type: 'completion',
            role: 'assistant',
            content,
            model: modelName,
            stop_reason: response.candidates?.[0]?.finishReason || null,
            stop_sequence: null,
            usage: {
                input_tokens: promptTokens,
                output_tokens: completionTokens,
                total_tokens: totalTokens
            }
        };
    }
    
    /**
     * Send a message to Gemini
     * 
     * @param messages MCP messages to send
     * @param tools Optional tools to make available
     * @param options Additional options
     * @returns Promise with the Gemini response
     */
    protected async sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        try {
            if (!this.genAiClient || !this.FunctionCallingConfigMode) {
                throw new Error('Google Gen AI client not initialized');
            }
            
            // Validate messages
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('Messages array cannot be empty');
            }
            
            // Get model name
            const modelName = options?.model || this.config.defaultModel || 'gemini-2.0-flash-001';
            
            // Get the model instance
            const model = this.genAiClient.models.getModel(modelName);
            
            // Convert messages to Google Gen AI format
            const contents = this.convertToGeminiContent(messages);
            
            // Set up the request parameters
            const requestParams: GenerateContentRequest = {
                model: modelName,
                contents: contents,
                // Include temperature if specified
                ...((options?.temperature || this.config.temperature) && {
                    generationConfig: {
                        temperature: options?.temperature || this.config.temperature,
                        maxOutputTokens: options?.maxTokens || this.config.maxTokens || 4096,
                        topK: options?.topK || 40,
                        topP: options?.topP || 0.95
                    }
                })
            };
            
            // Add tools if provided
            if (tools && tools.length > 0) {
                const functionDeclarations = this.convertToFunctionDeclarations(tools);
                
                requestParams.config = {
                    toolConfig: {
                        functionCallingConfig: {
                            mode: options?.requireToolUse === true
                                ? this.FunctionCallingConfigMode.ANY
                                : options?.preferToolUse === true
                                    ? this.FunctionCallingConfigMode.AUTO
                                    : this.FunctionCallingConfigMode.NONE,
                            allowedFunctionNames: functionDeclarations.map(fn => fn.name)
                        }
                    },
                    tools: [{
                        functionDeclarations: functionDeclarations
                    }]
                };
            }
            
            // Add provider-specific options if provided
            if (options?.providerOptions) {
                Object.assign(requestParams, options.providerOptions);
            }
            
            // Generate content
            const response = await this.genAiClient.models.generateContent(requestParams);
            
            // Convert response to MCP format
            return this.convertToMcpResponse(response, modelName);
        } catch (error) {
            throw new Error(`Error sending message to Gemini: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
