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
 * Anthropic MCP Client
 * 
 * This module implements the Model Context Protocol (MCP) client for Anthropic's API (Claude).
 * It handles the specific API interactions required by Anthropic while adhering to the
 * MCP interface for provider-agnostic usage.
 * 
 * API Reference: https://docs.anthropic.com/claude/reference/messages_post
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
    McpTextContent,
    McpImageContent
} from '../IMcpClient';
import { extractToolCalls, extractToolCallId, extractToolResultText } from '../utils/MessageConverters';
import { convertToolsToProviderFormat } from '../utils/ToolHandlers';
import { Observable } from 'rxjs';
import { AgentContext } from '../../../interfaces/AgentContext';
import { ConversationMessage } from '../../../interfaces/ConversationMessage';

// Type definitions for Anthropic API
interface AnthropicContentBlock {
    type: 'text' | 'image' | 'tool_use' | 'tool_result';
    text?: string;
    source?: {
        type: 'base64' | 'url';
        media_type: string;
        data: string;
    };
    id?: string;
    name?: string;
    input?: Record<string, any>;
    tool_use_id?: string;
    content?: AnthropicContentBlock[];
}

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: AnthropicContentBlock[];
}

interface AnthropicTool {
    name: string;
    description: string;
    input_schema: Record<string, any>;
}

interface AnthropicResponse {
    id: string;
    type: string;
    role: string;
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

/**
 * Anthropic implementation of the MCP client
 */
export class AnthropicMcpClient extends BaseMcpClient {
    // Base URL for the Anthropic API
    private readonly baseUrl = 'https://api.anthropic.com/v1';
    
    // API version
    private readonly apiVersion = '2023-06-01';
    
    /**
     * Initialize the Anthropic provider
     */
    protected async initializeProvider(): Promise<void> {
        // No additional initialization required for Anthropic
        // The API key is already stored in the config

        // Register Anthropic adapter with unified converter
        const { getMessageConverter } = require('../converters/UnifiedMessageConverter');
        const { AnthropicMessageAdapter } = require('../converters/adapters/AnthropicMessageAdapter');
        const converter = getMessageConverter('client');
        converter.registerAdapter(new AnthropicMessageAdapter('client'));

        console.log('✅ Anthropic message adapter registered (client context)');
    }

    /**
     * Convert MCP messages to Anthropic format
     * 
     * @param messages MCP messages
     * @returns Anthropic messages
     */
    private convertToAnthropicMessages(messages: McpMessage[]): AnthropicMessage[] {
        // Anthropic requires system prompt to be prepended to the first user message
        let systemPrompt = '';
        const processedMessages: AnthropicMessage[] = [];
        
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            
            // Handle system messages differently for Anthropic
            if (message.role === McpRole.SYSTEM) {
                systemPrompt += (systemPrompt ? '\n\n' : '') + this.extractTextContent(message.content);
                continue;
            }
            
            // Handle tool result messages (McpRole.TOOL)
            if (message.role === McpRole.TOOL) {
                // For tool results, use assistant role with tool_result content
                const contentBlocks = this.convertContent(message.content);
                processedMessages.push({
                    role: 'user',  // Anthropic requires tool results as user messages
                    content: contentBlocks
                });
                continue;
            }
            
            // Convert content to Anthropic format
            const contentBlocks = this.convertContent(message.content);
            
            // For the first user message, prepend system prompt if available
            if (message.role === McpRole.USER && systemPrompt && !processedMessages.some(m => m.role === 'user')) {
                contentBlocks.unshift({
                    type: 'text',
                    text: systemPrompt
                });
                systemPrompt = ''; // Clear so it's not added again
            }
            
            // Add the message
            processedMessages.push({
                role: message.role === McpRole.USER ? 'user' : 'assistant',
                content: contentBlocks
            });
        }
        
        // If we have a system prompt but no user message yet, create one
        if (systemPrompt && !processedMessages.some(m => m.role === 'user')) {
            processedMessages.push({
                role: 'user',
                content: [{
                    type: 'text',
                    text: systemPrompt
                }]
            });
        }
        
        return processedMessages;
    }
    
    /**
     * Extract text content from an MCP content block
     * 
     * @param content MCP content
     * @returns Extracted text
     */
    private extractTextContent(content: McpMessage['content']): string {
        if (Array.isArray(content)) {
            return content
                .filter(item => item.type === McpContentType.TEXT)
                .map(item => (item.type === McpContentType.TEXT) ? item.text : '')
                .join('\n');
        } else if (content.type === McpContentType.TEXT) {
            return content.text;
        } else {
            return JSON.stringify(content);
        }
    }
    
    /**
     * Convert MCP content to Anthropic content blocks
     * 
     * @param content MCP content
     * @returns Anthropic content blocks
     */
    private convertContent(content: McpMessage['content']): AnthropicContentBlock[] {
        if (Array.isArray(content)) {
            return content.map(item => this.convertContentItem(item));
        } else {
            return [this.convertContentItem(content)];
        }
    }
    
    /**
     * Convert a single MCP content item to Anthropic format
     * 
     * @param item MCP content item
     * @returns Anthropic content block
     */
    private convertContentItem(item: McpContent): AnthropicContentBlock {
        switch (item.type) {
            case McpContentType.TEXT:
                return {
                    type: 'text',
                    text: item.text
                };
            case McpContentType.IMAGE:
                return {
                    type: 'image',
                    source: {
                        type: item.source.type as 'base64' | 'url',
                        media_type: item.source.media_type,
                        data: item.source.data
                    }
                };
            case McpContentType.TOOL_USE:
                return {
                    type: 'tool_use',
                    id: item.id,
                    name: item.name,
                    input: item.input
                };
            case McpContentType.TOOL_RESULT:
                const resultContent = Array.isArray(item.content) 
                    ? item.content 
                    : [item.content];
                
                return {
                    type: 'tool_result',
                    tool_use_id: item.tool_use_id,
                    content: resultContent.map(c => this.convertContentItem(c))
                };
            default:
                throw new Error(`Unsupported content type: ${(item as any).type}`);
        }
    }
    
    /**
     * Convert MCP tools to Anthropic format (using utility)
     * 
     * @param tools MCP tools
     * @returns Anthropic tools
     */
    private convertToAnthropicTools(tools: McpTool[]): AnthropicTool[] {
        return convertToolsToProviderFormat(tools, 'anthropic') as AnthropicTool[];
    }
    
    /**
     * Convert Anthropic response to MCP response
     * 
     * @param response Anthropic response
     * @returns MCP response
     */
    private convertToMcpResponse(response: AnthropicResponse): McpApiResponse {
        // Convert Anthropic content blocks to MCP content
        const content: McpContent[] = response.content.map(item => {
            switch (item.type) {
                case 'text':
                    return {
                        type: McpContentType.TEXT,
                        text: item.text || ''
                    };
                case 'image':
                    return {
                        type: McpContentType.IMAGE,
                        source: {
                            type: item.source?.type || 'url',
                            media_type: item.source?.media_type || 'image/jpeg',
                            data: item.source?.data || ''
                        }
                    };
                case 'tool_use':
                    return {
                        type: McpContentType.TOOL_USE,
                        id: item.id || uuidv4(),
                        name: item.name || '',
                        input: item.input || {}
                    };
                case 'tool_result':
                    // Convert nested content to only include text and image content types
                    // as required by McpToolResultContent
                    const resultContent = item.content?.map(c => {
                        if (c.type === 'text') {
                            return {
                                type: McpContentType.TEXT,
                                text: c.text || ''
                            };
                        } else if (c.type === 'image') {
                            return {
                                type: McpContentType.IMAGE,
                                source: {
                                    type: c.source?.type || 'url',
                                    media_type: c.source?.media_type || 'image/jpeg',
                                    data: c.source?.data || ''
                                }
                            };
                        }
                        // For any other type, convert to text
                        return {
                            type: McpContentType.TEXT,
                            text: JSON.stringify(c)
                        };
                    }) || [{
                        type: McpContentType.TEXT,
                        text: 'Tool result content not available'
                    }];
                    
                    return {
                        type: McpContentType.TOOL_RESULT,
                        tool_use_id: item.tool_use_id || '',
                        content: resultContent as Array<McpTextContent | McpImageContent>
                    };
                default:
                    return {
                        type: McpContentType.TEXT,
                        text: JSON.stringify(item)
                    };
            }
        });
        
        // Ensure total_tokens is calculated
        const totalTokens = (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
        
        // Create MCP response
        return {
            id: response.id,
            type: response.type || 'completion',
            role: response.role || 'assistant',
            content,
            model: response.model,
            stop_reason: response.stop_reason || null,
            stop_sequence: response.stop_sequence || null,
            usage: {
                input_tokens: response.usage.input_tokens || 0,
                output_tokens: response.usage.output_tokens || 0,
                total_tokens: totalTokens
            }
        };
    }
    
    /**
     * Send a message to Anthropic
     * 
     * @param messages MCP messages to send
     * @param tools Optional tools to make available
     * @param options Additional options
     * @returns Promise with the Anthropic response
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
            
            // Convert messages and tools to Anthropic format
            const anthropicMessages = this.convertToAnthropicMessages(messages);
            const anthropicTools = tools ? this.convertToAnthropicTools(tools) : undefined;
            
            // Prepare request parameters
            const model = options?.model || this.config.defaultModel || 'claude-3-opus-20240229';
            const temperature = options?.temperature || this.config.temperature || 0.7;
            const maxTokens = options?.maxTokens || this.config.maxTokens || 4096;
            
            // Prepare request body
            const requestBody: Record<string, any> = {
                model,
                messages: anthropicMessages,
                temperature,
                max_tokens: maxTokens
            };
            
            // Add tools if provided
            if (anthropicTools && anthropicTools.length > 0) {
                requestBody.tools = anthropicTools;
            }
            
            // Add provider-specific options if provided
            if (options?.providerOptions) {
                Object.assign(requestBody, options.providerOptions);
            }
            
            // Make the API request
            const response = await fetch(`${this.baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.config.apiKey,
                    'anthropic-version': this.apiVersion
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
                throw new Error(`Anthropic API error [${response.status}]: ${errorText}`);
            }
            
            // Parse and convert response
            const anthropicResponse = await response.json() as AnthropicResponse;
            return this.convertToMcpResponse(anthropicResponse);
        } catch (error) {
            throw new Error(`Error sending message to Anthropic: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Send message using full agent context
     * 
     * This method structures messages for Anthropic based on semantic metadata,
     * ensuring proper chronological ordering of tasks and conversation history.
     * 
     * @param context - Complete agent context from SDK
     * @param options - Additional Anthropic-specific options
     * @returns Observable with Anthropic response
     */
    public sendWithContext(
        context: AgentContext,
        options?: Record<string, any>
    ): Observable<McpApiResponse> {
        return new Observable<McpApiResponse>(subscriber => {
            this.sendWithContextImpl(context, options)
                .then(response => {
                    subscriber.next(response);
                    subscriber.complete();
                })
                .catch(error => subscriber.error(error));
        });
    }

    /**
     * Implementation of context-based sending for Anthropic
     */
    private async sendWithContextImpl(
        context: AgentContext,
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        // Structure messages for Anthropic based on context
        const { systemPrompt, messages } = this.structureMessagesFromContext(context);

        // Convert tools
        const anthropicTools = context.availableTools && context.availableTools.length > 0
            ? convertToolsToProviderFormat(context.availableTools as McpTool[], 'anthropic') as AnthropicTool[]
            : undefined;

        // Prepare request parameters
        const model = options?.model || this.config.defaultModel || 'claude-3-opus-20240229';
        const temperature = options?.temperature || this.config.temperature || 0.7;
        const maxTokens = options?.maxTokens || this.config.maxTokens || 4096;

        // Prepare request body - Anthropic uses system as a top-level parameter
        const requestBody: Record<string, any> = {
            model,
            system: systemPrompt,
            messages,
            temperature,
            max_tokens: maxTokens
        };

        // Add tools if provided
        if (anthropicTools && anthropicTools.length > 0) {
            requestBody.tools = anthropicTools;
        }

        // Make the API request
        const response = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.config.apiKey,
                'anthropic-version': this.apiVersion
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
            throw new Error(`Anthropic API error [${response.status}]: ${errorText}`);
        }

        // Parse and convert response
        const anthropicResponse = await response.json() as AnthropicResponse;
        return this.convertToMcpResponse(anthropicResponse);
    }

    /**
     * Structure messages from AgentContext for Anthropic
     * 
     * Anthropic uses a separate system parameter, so we return both.
     * Message ordering:
     * 1. Conversation history (chronological)
     * 2. Task prompt (if present) - AFTER conversation for proper ordering
     * 3. Recent actions (if needed)
     */
    private structureMessagesFromContext(context: AgentContext): { systemPrompt: string; messages: AnthropicMessage[] } {
        // Build system prompt
        const systemContent = [
            context.systemPrompt,
            '',
            `## Your Agent Identity`,
            `**You are**: ${(context.agentConfig as any).purpose || context.agentConfig.agentId}`,
            `**Your Agent ID**: ${context.agentId}`,
            ...(context.agentConfig.capabilities ? [`**Capabilities**: ${context.agentConfig.capabilities.join(', ')}`] : [])
        ].join('\n');

        const messages: AnthropicMessage[] = [];

        // 1. Conversation history: Filter to actual dialogue and tool results
        const dialogueMessages = context.conversationHistory.filter(msg => {
            const layer = msg.metadata?.contextLayer;

            // INCLUDE: SystemLLM messages - they are "held" until the next real prompt
            // and should be bundled with that prompt to provide coordination insights
            // (Previously these were skipped, breaking the SystemLLM flow)

            // INCLUDE: Messages with conversation or tool-result layer
            if (layer === 'conversation' || layer === 'tool-result') {
                return true;
            }

            // INCLUDE: Tool role messages
            if (msg.role === 'tool') {
                return true;
            }

            // SKIP: Messages with system/identity/task/action layers
            if (layer === 'system' || layer === 'identity' || layer === 'task' || layer === 'action') {
                return false;
            }

            // INCLUDE: Messages without contextLayer (legacy or direct additions)
            if (!layer && msg.role !== 'system') {
                return true;
            }

            return false;
        });

        // Convert to Anthropic format
        for (const msg of dialogueMessages) {
            const anthropicMsg = this.convertConversationToAnthropic(msg);
            if (anthropicMsg) {
                messages.push(anthropicMsg);
            }
        }

        // 2. Task message (if present) - Added AFTER conversation history for chronological ordering
        if (context.currentTask) {
            messages.push({
                role: 'user',
                content: [{ type: 'text', text: `## Current Task\n${context.currentTask.description}` }]
            });
        }

        // 3. Recent actions (if needed for context)
        if (context.recentActions.length > 0) {
            const actionsContent = [
                `## Your Recent Actions`,
                ...context.recentActions.map(a => `- ${a.action}${a.result ? `: ${a.result}` : ''}`)
            ].join('\n');

            messages.push({
                role: 'user',
                content: [{ type: 'text', text: actionsContent }]
            });
        }

        return { systemPrompt: systemContent, messages };
    }

    /**
     * Convert ConversationMessage to Anthropic format
     */
    private convertConversationToAnthropic(msg: ConversationMessage): AnthropicMessage | null {
        // Skip system messages - they go in the system parameter
        if (msg.role === 'system') {
            return null;
        }

        const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
        const content: AnthropicContentBlock[] = [{ type: 'text', text: msg.content }];

        return { role, content };
    }
}
