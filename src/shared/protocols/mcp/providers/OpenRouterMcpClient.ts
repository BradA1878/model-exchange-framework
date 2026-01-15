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
 * OpenRouter MCP Client
 * 
 * This module implements the Model Context Protocol (MCP) client for OpenRouter's API.
 * OpenRouter provides access to various AI models through a unified API interface.
 * 
 * API Reference: https://openrouter.ai/docs/api-reference/overview
 */

import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { BaseMcpClient } from './BaseMcpClient';
import { 
    McpMessage, 
    McpTool, 
    McpApiResponse, 
    McpContentType,
    McpRole,
    McpContent,
    McpTextContent
} from '../IMcpClient';
import { AgentContext } from '../../../interfaces/AgentContext';
import { ConversationMessage } from '../../../interfaces/ConversationMessage';
import { Logger } from '../../../utils/Logger';
import {
    NetworkRecoveryConfig,
    DEFAULT_NETWORK_RECOVERY_CONFIG
} from '../../../types/NetworkRecoveryTypes';
import { NetworkRecoveryManager, extractStatusCodeFromError } from '../utils/NetworkRecovery';
import { JsonRecoveryManager } from '../utils/JsonRecovery';
import { 
    extractToolCalls, 
    extractToolCallId, 
    extractToolResultText,
    extractTextFromContent,
    convertContentToText
} from '../utils/MessageConverters';
import { convertToolsToProviderFormat } from '../utils/ToolHandlers';
import { getMessageConverter } from '../converters/UnifiedMessageConverter';
import { MessageFormat, ExtendedMcpMessage } from '../converters/IFormatConverter';

// Type definitions for OpenRouter API
interface OpenRouterMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{
        type: 'text' | 'image_url' | 'tool_call' | 'tool_result';
        text?: string;
        image_url?: {
            url: string;
            detail?: 'auto' | 'low' | 'high';
        };
        tool_call_id?: string;
        name?: string;
        arguments?: Record<string, any>;
    }>;
    name?: string;
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

interface OpenRouterTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, any>;
    };
}

interface OpenRouterResponse {
    id: string;
    model: string;
    created: number;
    object: string;
    choices: Array<{
        index: number;
        message: OpenRouterMessage;
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * OpenRouter implementation of the MCP client with network recovery
 */
export class OpenRouterMcpClient extends BaseMcpClient {
    // Base URL for the OpenRouter API
    private readonly baseUrl = 'https://openrouter.ai/api/v1';

    // Logger instance (using 'client' target so we can see server-side debug logs)
    private logger = new Logger('debug', 'OpenRouterMcpClient', 'client');

    // Exacto-supported models (as of October 2025)
    // These models have vetted providers with superior tool-calling performance
    private static readonly EXACTO_SUPPORTED_MODELS = [
        'moonshotai/kimi-k2-0905',
        'deepseek/deepseek-chat-v3.1-terminus',
        'zhipuai/glm-4-6',
        'gpt-oss/gpt-oss-120b',
        'qwen/qwen3-coder'
    ];
    
    constructor() {
        super();
        this.jsonRecovery = new JsonRecoveryManager('OpenRouterMcpClient');
    }

    /**
     * Check if a model supports the Exacto variant
     * Strips any existing variant suffix before checking
     */
    private static isExactoSupported(modelName: string): boolean {
        // Remove existing variant suffixes (e.g., :free, :thinking, :exacto)
        const baseModel = modelName.split(':')[0];
        return OpenRouterMcpClient.EXACTO_SUPPORTED_MODELS.includes(baseModel);
    }

    /**
     * Apply Exacto variant to a model name if supported and requested
     *
     * @param modelName - Original model name (may include existing variant)
     * @param useExacto - Whether to apply Exacto variant
     * @returns Model name with appropriate variant suffix
     */
    private applyExactoVariant(modelName: string, useExacto: boolean): string {
        if (!useExacto) {
            return modelName;
        }

        // Split model and existing variant
        const parts = modelName.split(':');
        const baseModel = parts[0];
        const existingVariant = parts[1];

        // Check if already has :exacto
        if (existingVariant === 'exacto') {
            return modelName;
        }

        // Check if model supports Exacto
        if (!OpenRouterMcpClient.isExactoSupported(baseModel)) {
            // this.logger.warn(`⚠️ Model ${baseModel} does not support :exacto variant. Supported models: ${OpenRouterMcpClient.EXACTO_SUPPORTED_MODELS.join(', ')}`);
            return modelName; // Return original model name
        }

        // If there's an existing variant (e.g., :free, :thinking), warn about replacement
        if (existingVariant) {
        }

        const exactoModel = `${baseModel}:exacto`;
        return exactoModel;
    }

    // Request queue to prevent concurrent requests that might cause JSON parsing issues
    private static requestQueue: Array<() => Promise<any>> = [];
    private static isProcessingQueue = false;
    // Configurable delay between requests - reduced from 500ms to 100ms default for better performance
    // Set OPENROUTER_REQUEST_QUEUE_DELAY_MS=0 to disable queueing delay entirely
    private static readonly REQUEST_DELAY_MS = parseInt(process.env.OPENROUTER_REQUEST_QUEUE_DELAY_MS || '100', 10);
    
    // Network recovery manager
    private networkRecovery: NetworkRecoveryManager | null = null;
    
    // JSON recovery manager
    private jsonRecovery: JsonRecoveryManager;
    
    /**
     * Process the request queue sequentially to prevent concurrent requests
     */
    private static async processQueue(): Promise<void> {
        if (OpenRouterMcpClient.isProcessingQueue || OpenRouterMcpClient.requestQueue.length === 0) {
            return;
        }
        
        OpenRouterMcpClient.isProcessingQueue = true;
        
        while (OpenRouterMcpClient.requestQueue.length > 0) {
            const request = OpenRouterMcpClient.requestQueue.shift()!;
            try {
                await request();
            } catch (error) {
                // Request will handle its own error, just continue processing
            }
            
            // Wait between requests to prevent rate limiting
            if (OpenRouterMcpClient.requestQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, OpenRouterMcpClient.REQUEST_DELAY_MS));
            }
        }
        
        OpenRouterMcpClient.isProcessingQueue = false;
    }
    
    /**
     * Add a request to the queue and process it
     */
    private static async queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const wrappedRequest = async () => {
                try {
                    const result = await requestFn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };
            
            OpenRouterMcpClient.requestQueue.push(wrappedRequest);
            OpenRouterMcpClient.processQueue();
        });
    }
    
    /**
     * Initialize the OpenRouter provider
     */
    protected async initializeProvider(): Promise<void> {
        // Initialize network recovery configuration from environment or defaults
        const networkRecoveryConfig: NetworkRecoveryConfig = {
            ...DEFAULT_NETWORK_RECOVERY_CONFIG,
            maxRetries: parseInt(process.env.OPENROUTER_MAX_RETRIES || '3'),
            baseDelayMs: parseInt(process.env.OPENROUTER_BASE_DELAY_MS || '1000'),
            maxDelayMs: parseInt(process.env.OPENROUTER_MAX_DELAY_MS || '30000'),
            retryMultiplier: parseFloat(process.env.OPENROUTER_RETRY_MULTIPLIER || '2'),
            circuitBreakerThreshold: parseInt(process.env.OPENROUTER_CIRCUIT_BREAKER_THRESHOLD || '5'),
            circuitBreakerCooldownMs: parseInt(process.env.OPENROUTER_CIRCUIT_BREAKER_COOLDOWN_MS || '60000'),
            requestTimeoutMs: parseInt(process.env.OPENROUTER_REQUEST_TIMEOUT_MS || '30000'),
            enableGracefulDegradation: process.env.OPENROUTER_ENABLE_GRACEFUL_DEGRADATION !== 'false',
            enableDetailedLogging: process.env.OPENROUTER_ENABLE_DETAILED_LOGGING !== 'false'
        };

        // Create network recovery manager
        this.networkRecovery = new NetworkRecoveryManager(networkRecoveryConfig, 'OpenRouterMcpClient');


        // Register OpenRouter adapter with the unified converter
        // Use 'client' context since MCP clients run in SDK (client-side)
        const { OpenRouterMessageAdapter } = require('../converters/adapters/OpenRouterMessageAdapter');
        const converter = getMessageConverter('client');
        converter.registerAdapter(new OpenRouterMessageAdapter('client'));

    }

    /**
     * Convert ConversationMessage directly to OpenRouter format
     * No MCP intermediate step - preserves all metadata
     */
    private convertConversationToOpenRouter(msg: ConversationMessage): any {
        const role = msg.role === 'system' ? 'system' :
                     msg.role === 'assistant' ? 'assistant' :
                     msg.role === 'tool' ? 'tool' : 'user';

        let content = msg.content;

        // Preserve agent attribution for messages from other agents
        if (role === 'user' && msg.metadata?.fromAgentId) {
            const hasPrefix = content.startsWith('[') && content.includes(']:');
            if (!hasPrefix) {
                content = `[${msg.metadata.fromAgentId}]: ${content}`;
            }
        }

        const openRouterMsg: any = { role, content };

        // Preserve tool_calls for assistant messages
        if (msg.role === 'assistant' && (msg as any).tool_calls) {
            openRouterMsg.tool_calls = (msg as any).tool_calls;
        }

        // Preserve tool_call_id for tool messages
        if (msg.role === 'tool' && msg.metadata?.tool_call_id) {
            openRouterMsg.tool_call_id = msg.metadata.tool_call_id;
        }

        return openRouterMsg;
    }

    /**
     * Convert MCP tools to OpenRouter tools (using utility)
     * 
     * @param tools MCP tools
     * @returns OpenRouter tools
     */
    private convertToOpenRouterTools(tools: McpTool[]): OpenRouterTool[] {
        return convertToolsToProviderFormat(tools, 'openrouter') as OpenRouterTool[];
    }
    
    /**
     * Convert OpenRouter response to MCP response
     * 
     * @param response OpenRouter response
     * @returns MCP response
     */
    private convertToMcpResponse(response: OpenRouterResponse): McpApiResponse {
        // Get the choice with the assistant message
        const choice = response.choices[0];
        
        // Convert content to MCP format
        const content: McpApiResponse['content'] = [];
        
        // Handle reasoning tokens for reasoning models (e.g., o1, deepseek-reasoner, gpt-5)
        // These models return both 'reasoning' and 'content' fields
        const messageContent = choice.message.content;
        const messageReasoning = (choice.message as any).reasoning;
        
        
        if (messageReasoning) {
        } else {
        }
        
        // Handle different response formats
        if (typeof messageContent === 'string') {
            // Simple text content (works for both normal and :thinking models)
            content.push({
                type: McpContentType.TEXT,
                text: messageContent
            });
        } else if (Array.isArray(messageContent)) {
            // Array of content blocks
            messageContent.forEach(item => {
                if (item.type === 'text' && item.text) {
                    content.push({
                        type: McpContentType.TEXT,
                        text: item.text
                    });
                } else if (item.type === 'image_url' && item.image_url) {
                    content.push({
                        type: McpContentType.IMAGE,
                        source: {
                            type: 'url',
                            media_type: 'image/jpeg', // Assuming JPEG
                            data: item.image_url.url
                        }
                    });
                }
            });
        }
        
        // Handle tool calls if present
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
            choice.message.tool_calls.forEach(toolCall => {
                if (toolCall.type === 'function') {
                    // Handle empty or invalid arguments from OpenRouter
                    let parsedInput = {};
                    try {
                        // If arguments is empty string or whitespace, use empty object
                        const args = toolCall.function.arguments?.trim();
                        parsedInput = args && args.length > 0 ? JSON.parse(args) : {};
                    } catch (error) {
                        parsedInput = {};
                    }
                    
                    content.push({
                        type: McpContentType.TOOL_USE,
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: parsedInput
                    });
                }
            });
        }
        
        // Create MCP response
        const mcpResponse: McpApiResponse = {
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
        
        // Include reasoning if present (for reasoning models like o1, gpt-5, deepseek-reasoner)
        if (messageReasoning && typeof messageReasoning === 'string') {
            mcpResponse.reasoning = messageReasoning;
        }
        
        return mcpResponse;
    }
    
    /**
     * NEW APPROACH: Send message using full agent context
     * 
     * This method structures messages for OpenRouter based on semantic metadata,
     * eliminating the lossy reconstruction cycle.
     * 
     * OpenRouter-specific structuring:
     * - Combines system prompt + agent identity into single system message
     * - Filters conversation to only dialogue and tool results
     * - Applies OpenRouter's reordering for tool results
     * - Skips framework/action messages (already in system context)
     * 
     * @param context - Complete agent context from SDK
     * @param options - Additional OpenRouter-specific options
     * @returns Observable with OpenRouter response
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
     * Implementation of context-based sending for OpenRouter
     */
    private async sendWithContextImpl(
        context: AgentContext,
        options?: Record<string, any>
    ): Promise<McpApiResponse> {

        // Structure messages for OpenRouter based on context (returns OpenRouter format)
        const openRouterMessages = this.structureMessagesFromContext(context);


        // Apply OpenRouter-specific transformations using adapter
        // CRITICAL: This reorders tool results to immediately follow tool calls
        const converter = getMessageConverter('client');
        const transformedMessages = converter.transform(openRouterMessages, MessageFormat.OPENROUTER);


        // Message count may differ if orphaned tool results were dropped - this is expected
        // and prevents API errors when conversation history is cleared between turns
        if (transformedMessages.length !== openRouterMessages.length) {
            this.logger.debug(`Messages adjusted during transformation: ${openRouterMessages.length} → ${transformedMessages.length} (orphaned tool results dropped)`);
        }

        // Messages are already in OpenRouter format - send directly
        return await OpenRouterMcpClient.queueRequest(async () => {
            if (!this.networkRecovery) {
                throw new Error('Network recovery not initialized');
            }

            const result = await this.networkRecovery.executeWithRetry(
                () => this.executeOpenRouterRequestDirect(transformedMessages, context.availableTools as any, options),
                extractStatusCodeFromError
            );

            if (!result.success) {
                if (result.circuitBreakerTriggered) {
                    throw new Error(result.error!.message);
                }
                throw result.error?.originalError || new Error(result.error!.message);
            }

            return result.data!;
        });
    }
    
    /**
     * Structure messages from AgentContext for OpenRouter
     * 
     * Similar to Azure but applies OpenRouter-specific requirements
     */
    private structureMessagesFromContext(context: AgentContext): any[] {
        const messages: any[] = [];
        
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
        
        // 2. Conversation history: Filter same as Azure for consistency
        // NOTE: Task message is now added AFTER conversation history to maintain chronological order
        // This fixes the bug where subsequent tasks appeared above existing conversation
        const dialogueMessages = context.conversationHistory.filter(msg => {
            const layer = msg.metadata?.contextLayer;
            
            // INCLUDE: SystemLLM messages - they are "held" until the next real prompt
            // and should be bundled with that prompt to provide coordination insights
            // (Previously these were skipped, breaking the SystemLLM flow)
            
            // INCLUDE: Messages with conversation or tool-result layer
            if (layer === 'conversation' || layer === 'tool-result') {
                return true;
            }
            
            // INCLUDE: Tool role messages (always part of tool execution flow)
            if (msg.role === 'tool') {
                return true;
            }
            
            // SKIP: Messages with system/identity/task/action layers (already in system context)
            if (layer === 'system' || layer === 'identity' || layer === 'task' || layer === 'action') {
                return false;
            }
            
            // INCLUDE: Messages without contextLayer (legacy or direct additions)
            // These are likely channel messages, system errors, or other important context
            if (!layer && msg.role !== 'system') {
                return true;
            }
            
            // SKIP: Everything else
            return false;
        });
        

        const toolMessagesInDialogue = dialogueMessages.filter(m => m.role === 'tool');
        if (toolMessagesInDialogue.length > 0) {
            toolMessagesInDialogue.forEach((msg, idx) => {
                const size = msg.content?.length || 0;
                const toolName = msg.metadata?.toolName || 'unknown';
            });
        }

        // Convert directly to OpenRouter format (no MCP round-trip)
        // Reordering will be handled by adapter.transform() in sendWithContextImpl
        const openRouterDialogue = dialogueMessages.map(msg => this.convertConversationToOpenRouter(msg));
        messages.push(...openRouterDialogue);
        
        // 3. Task message (if present) - Added AFTER conversation history for chronological ordering
        // This ensures subsequent task assignments appear after existing conversation
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
     * Legacy MCP message path for simple use cases (SystemLlm, etc.)
     * For complex multi-turn conversations with tools, use sendWithContext()
     *
     * @param messages MCP messages
     * @param tools Optional tools
     * @param options Request options
     */
    protected async sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        // Convert MCP → OpenRouter using adapter
        const converter = getMessageConverter('client');
        const openRouterMessages = converter.convert(
            messages,
            MessageFormat.MCP,
            MessageFormat.OPENROUTER
        );

        // Apply transformations (reordering)
        const transformedMessages = converter.transform(openRouterMessages, MessageFormat.OPENROUTER);


        // Send directly
        return await OpenRouterMcpClient.queueRequest(async () => {
            if (!this.networkRecovery) {
                throw new Error('Network recovery not initialized');
            }

            const result = await this.networkRecovery.executeWithRetry(
                () => this.executeOpenRouterRequestDirect(transformedMessages, tools, options),
                extractStatusCodeFromError
            );

            if (!result.success) {
                if (result.circuitBreakerTriggered) {
                    throw new Error(result.error!.message);
                }
                throw result.error?.originalError || new Error(result.error!.message);
            }

            return result.data!;
        });
    }
    
    /**
     * Execute OpenRouter request with messages already in OpenRouter format
     * Used by sendWithContextImpl to avoid lossy MCP round-trip
     */
    private async executeOpenRouterRequestDirect(
        openRouterMessages: any[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        try {
            // Validate inputs
            if (!Array.isArray(openRouterMessages) || openRouterMessages.length === 0) {
                throw new Error('Messages array cannot be empty');
            }

            // Messages are already in OpenRouter format - just convert tools
            const openRouterTools = tools ? this.convertToOpenRouterTools(tools) : undefined;

            return await this.executeOpenRouterRequestCore(openRouterMessages, openRouterTools, options);
        } catch (error) {
            this.logger.error(`OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Core OpenRouter request execution with messages already in OpenRouter format
     */
    private async executeOpenRouterRequestCore(
        openRouterMessages: any[],
        openRouterTools?: any[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        try {
            
            // Prepare request parameters
            let model = options?.model || this.config.defaultModel || 'openai/gpt-4-turbo';

            // Apply Exacto variant if requested for enhanced tool-calling accuracy
            // Default to true for MXF's tool-heavy architecture unless explicitly disabled
            const useExacto = options?.useExactoVariant !== false; // Default: true
            model = this.applyExactoVariant(model, useExacto);

            const temperature = options?.temperature || this.config.temperature || 0.7;
            const maxTokens = options?.maxTokens || this.config.maxTokens || 4096;
            
            // Prepare request body with model name as-is (OpenRouter handles model variants correctly)
            const requestBody: Record<string, any> = {
                model,
                messages: openRouterMessages,
                temperature,
                max_tokens: maxTokens
            };
            
            // Enable reasoning tokens for reasoning models (o1, gpt-5, deepseek-reasoner)
            // Pass through the full reasoning config to OpenRouter
            if (options?.reasoning?.enabled === true) {
                requestBody.reasoning = {
                    enabled: true,
                    effort: options.reasoning.effort || 'medium',
                    ...(options.reasoning.maxTokens && { maxTokens: options.reasoning.maxTokens }),
                    ...(options.reasoning.exclude !== undefined && { exclude: options.reasoning.exclude })
                };
            }
            
            // Add JSON response format if requested
            if (options?.responseFormat === 'json') {
                requestBody.response_format = { type: 'json_object' };
            }
            
            // Add structured output support using OpenRouter's JSON schema feature
            if (options?.providerOptions?.response_format?.type === 'json_schema') {
                requestBody.response_format = {
                    type: 'json_schema',
                    json_schema: {
                        name: options.providerOptions.response_format.json_schema.name,
                        schema: options.providerOptions.response_format.json_schema.schema,
                        strict: options.providerOptions.response_format.json_schema.strict || true
                    }
                };
            }
            
            // Add tools if provided
            if (openRouterTools && openRouterTools.length > 0) {
                requestBody.tools = openRouterTools;
                // In MXF, agents are designed to work through tools, so prefer tool usage
                requestBody.tool_choice = options?.preferToolUse === false 
                    ? 'auto'  // Still allow some flexibility if explicitly disabled
                    : options?.requireToolUse === true 
                        ? { type: 'function', function: { name: openRouterTools[0].function.name } }
                        : 'auto'; // Strong preference for tool usage in MXF
                
            }
            
            // Add provider-specific options if provided
            if (options?.providerOptions) {
                Object.assign(requestBody, options.providerOptions);
            }
            
            // Add HTTP referer and title for OpenRouter tracking/attribution
            // HTTP-Referer is the primary identifier for app attribution
            // X-Title sets the display name in rankings and analytics
            // Both are needed for proper attribution - see https://openrouter.ai/docs/app-attribution
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
                'HTTP-Referer': options?.referer || 'http://mxf.dev',
                'X-Title': options?.title || 'MXF'
            };
            
            // Log basic request info
            // console.log ('')
            // console.log(`🚀 OpenRouter request: ${requestBody.tools?.length || 0} tools`);
            // console.log(JSON.stringify(requestBody));
            // console.log ('')
            

            // console.log(`\n🔧 REQUEST HAS ${requestBody.tools?.length || 0} TOOLS`);
            if (requestBody.tools && requestBody.tools.length > 0) {
                // console.log(`   Tools: ${requestBody.tools.map((t: any) => t.function.name).join(', ')}`);
            }

            // Make the API request
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody)
            });
            
            // Log response status
            
            // Check for errors with enhanced error information
            if (!response.ok) {
                let errorText = await response.text();
                this.logger.error(`🔧 DEBUG: Error response text: ${errorText}`);
                
                let errorMessage = errorText;
                let rateLimitInfo: Record<string, any> = {};
                
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error?.message || errorText;
                    
                    // Extract rate limit information if available
                    if (response.status === 429) {
                        rateLimitInfo = {
                            retryAfter: response.headers.get('retry-after'),
                            rateLimitLimit: response.headers.get('x-ratelimit-limit'),
                            rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
                            rateLimitReset: response.headers.get('x-ratelimit-reset')
                        };
                    }
                } catch (e) {
                    // Use error text as is if not JSON
                }
                
                // Create detailed error with status code
                const error = new Error(`OpenRouter API error [${response.status}]: ${errorMessage}`);
                (error as any).status = response.status;
                (error as any).statusCode = response.status;
                (error as any).rateLimitInfo = rateLimitInfo;
                
                throw error;
            }
            
            // Get response text for JSON parsing
            const responseText = await response.text();
            
            // Check if response is empty
            if (!responseText || responseText.length === 0) {
                this.logger.error('🔧 ERROR: Empty response from OpenRouter API');
                throw new Error('Empty response from OpenRouter API');
            }
            
            const trimmedResponseText = responseText.trim();
            
            // Only log if there's significant whitespace trimming
            if (trimmedResponseText.length < responseText.length - 10) {
            }
            
            // Parse JSON response using utility with recovery strategies
            const parseResult = this.jsonRecovery.parseWithRecovery<OpenRouterResponse>(trimmedResponseText);
            
            if (!parseResult.success || !parseResult.data) {
                throw parseResult.error || new Error('Failed to parse OpenRouter response: No valid JSON could be obtained');
            }
            
            const openRouterResponse = parseResult.data;
            
            return this.convertToMcpResponse(openRouterResponse);
        } catch (error) {
            this.logger.error(`🔧 ERROR in executeOpenRouterRequest: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                this.logger.error(`🔧 ERROR STACK: ${error.stack}`);
            }
            throw new Error(`Error processing OpenRouter request: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
