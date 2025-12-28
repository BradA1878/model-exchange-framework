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
 * Ollama MCP Client
 * 
 * This module implements the Model Context Protocol (MCP) client for Ollama's local API.
 * Ollama provides local hosting for various open-source AI models.
 * 
 * API Reference: https://github.com/ollama/ollama/blob/main/docs/api.md
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
import { Logger } from '../../../utils/Logger';
import { extractToolCalls, extractToolCallId, convertContentToText } from '../utils/MessageConverters';
import { convertToolsToProviderFormat } from '../utils/ToolHandlers';
import { Observable } from 'rxjs';
import { AgentContext } from '../../../interfaces/AgentContext';
import { ConversationMessage } from '../../../interfaces/ConversationMessage';

// Type definitions for Ollama API
interface OllamaMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

interface OllamaRequest {
    model: string;
    messages: OllamaMessage[];
    tools?: Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, any>;
        };
    }>;
    stream?: boolean;
    format?: 'json' | string;
    options?: {
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
        stop?: string[];
    };
}

interface OllamaResponse {
    model: string;
    created_at: string;
    message: {
        role: 'assistant';
        content: string;
        tool_calls?: Array<{
            id: string;
            type: 'function';
            function: {
                name: string;
                arguments: string;
            };
        }>;
    };
    done: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

interface OllamaErrorResponse {
    error: string;
}

const logger = new Logger('debug', 'OllamaMcpClient', 'server');

/**
 * Ollama MCP Client implementation
 */
export class OllamaMcpClient extends BaseMcpClient {
    private baseUrl: string;
    private timeout: number;

    constructor() {
        super();
        this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.timeout = parseInt(process.env.OLLAMA_TIMEOUT || '30000');
    }

    /**
     * Convert MCP message to Ollama format
     */
    private convertToOllamaMessage(message: McpMessage): OllamaMessage {
        const contentArray = Array.isArray(message.content) ? message.content : [message.content];
        const content = convertContentToText(contentArray);

        const ollamaMessage: OllamaMessage = {
            role: message.role === McpRole.ASSISTANT ? 'assistant' : 
                  message.role === McpRole.USER ? 'user' : 
                  message.role === McpRole.TOOL ? 'tool' : 'system',
            content
        };

        // CRITICAL: Include tool_calls for assistant messages (using utility)
        if (message.role === McpRole.ASSISTANT) {
            const toolCalls = extractToolCalls(message);
            if (toolCalls) {
                ollamaMessage.tool_calls = toolCalls;
            }
        }
        
        // Include tool_call_id for tool result messages (using utility)
        if (message.role === McpRole.TOOL) {
            const toolCallId = extractToolCallId(message);
            if (toolCallId) {
                ollamaMessage.tool_call_id = toolCallId;
            }
        }

        return ollamaMessage;
    }

    /**
     * Convert MCP tool to Ollama format (using utility)
     */
    private convertToOllamaTool(tool: McpTool) {
        const formatted = convertToolsToProviderFormat([tool], 'openrouter')[0];
        return formatted;
    }

    /**
     * Make API request to Ollama
     */
    private async makeRequest(request: OllamaRequest): Promise<OllamaResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(request),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json() as OllamaErrorResponse;
                throw new Error(`Ollama API error: ${response.status} - ${errorData.error}`);
            }

            const data = await response.json() as OllamaResponse;
            return data;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`Ollama request timeout after ${this.timeout}ms`);
            }
            throw error;
        }
    }

    /**
     * Provider-specific initialization logic
     */
    protected async initializeProvider(): Promise<void> {
        // Check if Ollama is available
        const available = await this.isAvailable();
        if (!available) {
            throw new Error('Ollama service is not available');
        }
    }

    /**
     * Provider-specific message sending logic
     */
    protected async sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        const model = this.config.defaultModel || 'llama3.2';
        return this.sendMessageWithModel(messages, model, tools, options);
    }

    /**
     * Send messages to Ollama API with specific model
     */
    async sendMessageWithModel(
        messages: McpMessage[],
        model: string,
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        const requestId = uuidv4();

        try {
            const opts = options || {};
            const ollamaMessages = messages.map(m => this.convertToOllamaMessage(m));
            const ollamaTools = tools?.map(t => this.convertToOllamaTool(t));

            const request: OllamaRequest = {
                model,
                messages: ollamaMessages,
                tools: ollamaTools,
                stream: false,
                format: opts.format,
                options: {
                    temperature: opts.temperature,
                    top_p: opts.topP,
                    max_tokens: opts.maxTokens,
                    stop: opts.stopSequences
                }
            };

            const response = await this.makeRequest(request);

            const content: McpApiResponse['content'] = [];
            
            // Add text content
            if (response.message.content) {
                content.push({
                    type: McpContentType.TEXT,
                    text: response.message.content
                });
            }
            
            // Handle tool calls if present
            if (response.message.tool_calls && response.message.tool_calls.length > 0) {
                response.message.tool_calls.forEach(toolCall => {
                    if (toolCall.type === 'function') {
                        const args = toolCall.function.arguments;
                        const parsedInput = args && args.length > 0 ? JSON.parse(args) : {};
                        
                        content.push({
                            type: McpContentType.TOOL_USE,
                            id: toolCall.id,
                            name: toolCall.function.name,
                            input: parsedInput
                        });
                    }
                });
            }
            
            const mcpResponse: McpApiResponse = {
                id: requestId,
                type: 'message',
                model: response.model,
                role: McpRole.ASSISTANT,
                content,
                stop_reason: response.done ? 'stop' : 'length',
                stop_sequence: null,
                usage: {
                    input_tokens: response.prompt_eval_count || 0,
                    output_tokens: response.eval_count || 0,
                    total_tokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
                }
            };

            return mcpResponse;

        } catch (error) {
            logger.error(`Error in Ollama request ${requestId}:`, error);
            throw error;
        }
    }

    /**
     * Get available models from Ollama
     */
    async getAvailableModels(): Promise<string[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                throw new Error(`Failed to get models: ${response.status}`);
            }
            
            const data = await response.json() as { models?: Array<{ name: string }> };
            return data.models?.map((model) => model.name) || [];
        } catch (error) {
            logger.error('Error getting available models:', error);
            return [];
        }
    }

    /**
     * Check if Ollama is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/version`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get provider name
     */
    getProviderName(): string {
        return 'ollama';
    }

    /**
     * Send message using full agent context
     * 
     * This method structures messages for Ollama based on semantic metadata,
     * ensuring proper chronological ordering of tasks and conversation history.
     * 
     * @param context - Complete agent context from SDK
     * @param options - Additional Ollama-specific options
     * @returns Observable with Ollama response
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
     * Implementation of context-based sending for Ollama
     */
    private async sendWithContextImpl(
        context: AgentContext,
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        // Structure messages for Ollama based on context
        const ollamaMessages = this.structureMessagesFromContext(context);

        // Convert tools - Ollama uses OpenAI-compatible format
        const ollamaTools = context.availableTools && context.availableTools.length > 0
            ? convertToolsToProviderFormat(context.availableTools as McpTool[], 'openai')
            : undefined;

        // Prepare request
        const request: OllamaRequest = {
            model: options?.model || this.config.defaultModel || 'llama3.2',
            messages: ollamaMessages,
            stream: false,
            options: {
                temperature: options?.temperature || this.config.temperature || 0.7,
                max_tokens: options?.maxTokens || this.config.maxTokens || 4096
            }
        };

        // Add tools if provided
        if (ollamaTools) {
            request.tools = ollamaTools as OllamaRequest['tools'];
        }

        // Make request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json() as OllamaErrorResponse;
                throw new Error(`Ollama API error: ${errorData.error || response.statusText}`);
            }

            const ollamaResponse = await response.json() as OllamaResponse;

            // Convert to MCP response
            return {
                id: `ollama-${Date.now()}`,
                type: 'completion',
                role: 'assistant',
                content: [{
                    type: McpContentType.TEXT,
                    text: ollamaResponse.message.content
                }],
                model: ollamaResponse.model,
                stop_reason: ollamaResponse.done ? 'stop' : null,
                stop_sequence: null,
                usage: {
                    input_tokens: ollamaResponse.prompt_eval_count || 0,
                    output_tokens: ollamaResponse.eval_count || 0,
                    total_tokens: (ollamaResponse.prompt_eval_count || 0) + (ollamaResponse.eval_count || 0)
                }
            };
        } catch (error) {
            clearTimeout(timeoutId);
            throw new Error(`Error sending message to Ollama: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Structure messages from AgentContext for Ollama
     * 
     * Message ordering:
     * 1. System message (framework rules + agent identity)
     * 2. Conversation history (chronological)
     * 3. Task prompt (if present) - AFTER conversation for proper ordering
     * 4. Recent actions (if needed)
     */
    private structureMessagesFromContext(context: AgentContext): OllamaMessage[] {
        const messages: OllamaMessage[] = [];

        // 1. System message: Combine framework rules + agent identity
        const systemContent = [
            context.systemPrompt,
            '',
            `## Your Agent Identity`,
            `**You are**: ${(context.agentConfig as any).purpose || context.agentConfig.agentId}`,
            `**Your Agent ID**: ${context.agentId}`,
            ...(context.agentConfig.capabilities ? [`**Capabilities**: ${context.agentConfig.capabilities.join(', ')}`] : [])
        ].join('\n');

        messages.push({
            role: 'system',
            content: systemContent
        });

        // 2. Conversation history: Filter to actual dialogue and tool results
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

        // Convert to Ollama format
        for (const msg of dialogueMessages) {
            const ollamaMsg = this.convertConversationToOllama(msg);
            messages.push(ollamaMsg);
        }

        // 3. Task message (if present) - Added AFTER conversation history for chronological ordering
        if (context.currentTask) {
            messages.push({
                role: 'user',
                content: `## Current Task\n${context.currentTask.description}`
            });
        }

        // 4. Recent actions (if needed for context)
        if (context.recentActions.length > 0) {
            const actionsContent = [
                `## Your Recent Actions`,
                ...context.recentActions.map(a => `- ${a.action}${a.result ? `: ${a.result}` : ''}`)
            ].join('\n');

            messages.push({
                role: 'user',
                content: actionsContent
            });
        }

        return messages;
    }

    /**
     * Convert ConversationMessage to Ollama format
     */
    private convertConversationToOllama(msg: ConversationMessage): OllamaMessage {
        const ollamaMsg: OllamaMessage = {
            role: msg.role === 'assistant' ? 'assistant' : 
                  msg.role === 'tool' ? 'tool' : 
                  msg.role === 'system' ? 'system' : 'user',
            content: msg.content
        };

        // Add tool_call_id for tool messages
        if (msg.role === 'tool' && msg.metadata?.tool_call_id) {
            ollamaMsg.tool_call_id = msg.metadata.tool_call_id;
        }

        // Preserve tool_calls for assistant messages
        if (msg.role === 'assistant' && (msg as any).tool_calls) {
            ollamaMsg.tool_calls = (msg as any).tool_calls;
        }

        return ollamaMsg;
    }
}