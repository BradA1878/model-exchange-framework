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
 * Azure OpenAI MCP Client
 * 
 * This module implements the Model Context Protocol (MCP) client for Azure OpenAI Service.
 * It provides integration with Azure's OpenAI offerings while maintaining compatibility
 * with the MXF architecture.
 * 
 * Configuration Options:
 * - apiKey: Azure OpenAI API key (required)
 * - providerOptions.endpoint: Azure endpoint URL (e.g., https://your-resource.openai.azure.com/)
 * - providerOptions.deployment: Deployment name (e.g., gpt-4-1-mini)
 * - providerOptions.apiVersion: API version (default: 2024-04-01-preview)
 * 
 * Example:
 * ```typescript
 * const mcpConfig = {
 *   apiKey: 'your-api-key',
 *   defaultModel: 'gpt-4.1-mini',
 *   providerOptions: {
 *     endpoint: 'https://cybercoders-ai-prod.openai.azure.com/',
 *     deployment: 'gpt-4.1-mini',
 *     apiVersion: '2024-04-01-preview'
 *   }
 * };
 * ```
 * 
 * API Reference: https://learn.microsoft.com/en-us/azure/ai-services/openai/reference
 */

import { Observable } from 'rxjs';
import { AzureOpenAI } from 'openai';
import { BaseMcpClient } from './BaseMcpClient';
import {
    McpMessage,
    McpTool,
    McpApiResponse,
    McpContentType,
    McpRole,
    McpContent,
    McpTextContent,
    McpImageContent,
    McpToolUseContent
} from '../IMcpClient';
import { AgentContext, getDialogueMessages } from '../../../interfaces/AgentContext';
import { ConversationMessage } from '../../../interfaces/ConversationMessage';
import { Logger } from '../../../utils/Logger';
import { extractToolCalls, extractToolCallId, extractToolResult } from '../utils/MessageConverters';
import { convertToolsToProviderFormat } from '../utils/ToolHandlers';

// Create logger instance for Azure OpenAI MCP client
const logger = new Logger('debug', 'AzureOpenAiMcpClient', 'client');

/**
 * Azure OpenAI implementation of the MCP client
 */
export class AzureOpenAiMcpClient extends BaseMcpClient {
    // Azure OpenAI client instance
    private apiClient: AzureOpenAI | null = null;
    
    /**
     * Initialize the Azure OpenAI provider
     * @returns Promise that resolves when initialization is complete
     */
    protected async initializeProvider(): Promise<void> {
        // Get Azure-specific configuration from providerOptions or environment variables
        const providerOptions = this.config.providerOptions || {};
        
        const endpoint = providerOptions.endpoint || process.env.AZURE_OPENAI_ENDPOINT;
        const apiKey = this.config.apiKey || process.env.AZURE_OPENAI_API_KEY;
        const apiVersion = providerOptions.apiVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-04-01-preview';
        const deployment = providerOptions.deployment || process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
        
        if (!endpoint) {
            throw new Error('Azure OpenAI endpoint is required. Set via providerOptions.endpoint or AZURE_OPENAI_ENDPOINT environment variable (e.g., https://your-resource.openai.azure.com/)');
        }
        
        if (!apiKey) {
            throw new Error('Azure OpenAI API key is required. Set via apiKey config or AZURE_OPENAI_API_KEY environment variable');
        }
        
        if (!deployment) {
            throw new Error('Azure OpenAI deployment name is required. Set via providerOptions.deployment or AZURE_OPENAI_DEPLOYMENT_NAME environment variable (e.g., gpt-4-1-mini)');
        }
        
        // Initialize the Azure OpenAI client with Azure-specific options
        this.apiClient = new AzureOpenAI({
            endpoint,
            apiKey,
            apiVersion,
            deployment,
            maxRetries: 3,
            timeout: 30000
        });
        

        // Register OpenAI adapter with unified converter (Azure uses OpenAI format)
        const { getMessageConverter } = require('../converters/UnifiedMessageConverter');
        const { OpenAiMessageAdapter } = require('../converters/adapters/OpenAiMessageAdapter');
        const converter = getMessageConverter('client');
        converter.registerAdapter(new OpenAiMessageAdapter('client'));

    }
    
    /**
     * AZURE-SPECIFIC: Reorder messages to ensure strict tool call → tool result ordering
     * 
     * Azure requires:
     * 1. Tool messages IMMEDIATELY follow their assistant message with tool_calls
     * 2. Assistant messages (with or without tool_calls) are kept for conversation context
     * 
     * Unlike OpenRouter, Azure needs to see:
     * - Natural conversation flow with assistant responses
     * - "Dialogue" assistant messages that contain actual agent responses
     * - All user messages as they arrive
     * 
     * This reordering ensures Azure compliance while preserving conversation context.
     */
    private filterMessagesForAzure(messages: McpMessage[]): McpMessage[] {
        //console.log('\n🔍 AZURE FILTER: Input messages:', messages.length);
        
        const result: McpMessage[] = [];
        const pendingToolResults = new Map<string, McpMessage>();
        
        // First pass: collect all tool results by tool_call_id
        for (const message of messages) {
            if (message.role === McpRole.TOOL) {
                const toolCallId = extractToolCallId(message);
                if (toolCallId) {
                    pendingToolResults.set(toolCallId, message);
                    // console.log(`  📦 Collected tool result: ${toolCallId}`);
                }
            }
        }
        
        // Second pass: rebuild conversation with proper ordering and merge duplicate assistants
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            
            // Skip tool messages - we'll add them after their assistant messages
            if (message.role === McpRole.TOOL) {
                // console.log(`  ⏭️  Skipping tool message (will add after assistant)`);
                continue;
            }
            
            // CRITICAL: Handle duplicate assistant messages
            // When SDK creates both a text response AND a tool call, they come as two separate assistant messages
            // Azure gets confused by: assistant(text) + assistant(tool_calls)
            // Solution: Skip text-only assistant messages if followed immediately by assistant with tool_calls
            // EXCEPTION: Keep responses that follow SYSTEM INTERVENTION messages (they're learning context, not duplicates)
            if (message.role === McpRole.ASSISTANT && !(message as any).tool_calls) {
                // Check if previous message was a SYSTEM INTERVENTION
                const previousMessage = i > 0 ? messages[i - 1] : null;
                const previousContent = previousMessage?.content;
                const previousText = typeof previousContent === 'string' 
                    ? previousContent 
                    : Array.isArray(previousContent) 
                        ? previousContent.map(c => (c as any).text || '').join(' ')
                        : (previousContent as any)?.text || '';
                
                const isResponseToIntervention = previousText.includes('SYSTEM INTERVENTION') || 
                                                  previousText.includes('🚨');
                
                // If this is a response to intervention, ALWAYS keep it (it's learning context)
                if (isResponseToIntervention) {
                    // console.log(`  ✅ KEEPING assistant response to SYSTEM INTERVENTION (critical learning context)`);
                } else {
                    // Look ahead to see if next assistant message has tool_calls
                    const nextAssistantIndex = messages.findIndex((m, idx) => 
                        idx > i && m.role === McpRole.ASSISTANT && (m as any).tool_calls
                    );
                    
                    if (nextAssistantIndex !== -1) {
                        // Check if there are only tool/user messages between current and next assistant
                        const messagesBetween = messages.slice(i + 1, nextAssistantIndex);
                        const hasOnlyToolOrUser = messagesBetween.every(m => 
                            m.role === McpRole.TOOL || m.role === McpRole.USER
                        );
                        
                        if (hasOnlyToolOrUser) {
                            const contentStr = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
                            // console.log(`  🚫 SKIPPING duplicate assistant text (tool_call version follows): "${contentStr.substring(0, 50)}..."`);
                            continue;
                        }
                    }
                }
            }
            
            // Log what we're keeping
            if (message.role === McpRole.USER) {
                const contentStr = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
                // console.log(`  ✅ Keeping user message: "${contentStr.substring(0, 50)}..."`);
            } else if (message.role === McpRole.ASSISTANT) {
                const hasToolCalls = !!(message as any).tool_calls;
                const contentStr = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
                // console.log(`  ✅ Keeping assistant ${hasToolCalls ? 'WITH' : 'WITHOUT'} tool_calls: "${contentStr.substring(0, 50)}..."`);
            } else if (message.role === McpRole.SYSTEM) {
                // console.log(`  ✅ Keeping system message`);
            }
            
            // Add the message
            result.push(message);
            
            // If this is an assistant message with tool_calls, add matching tool results immediately after
            if (message.role === McpRole.ASSISTANT && (message as any).tool_calls) {
                const toolCalls = (message as any).tool_calls;
                for (const toolCall of toolCalls) {
                    const toolResult = pendingToolResults.get(toolCall.id);
                    if (toolResult) {
                        // console.log(`  ➕ Adding tool result for: ${toolCall.id}`);
                        result.push(toolResult);
                        pendingToolResults.delete(toolCall.id); // Remove so we don't add it twice
                    } else {
                        // console.log(`  ⚠️  NO tool result found for: ${toolCall.id}`);
                    }
                }
            }
        }
        
        //console.log(`🔍 AZURE FILTER: Output messages: ${result.length}\n`);
        return result;
    }
    
    /**
     * Convert MCP messages to Azure OpenAI format
     * @param messages - MCP messages to convert
     * @returns Azure OpenAI formatted messages
     */
    private convertToAzureOpenAiMessages(messages: McpMessage[]): any[] {
        //console.log('\n📥 SDK → AZURE MCP CLIENT: Received', messages.length, 'messages from SDK');
        messages.forEach((msg, idx) => {
            const hasToolCalls = !!(msg as any).tool_calls;
            const contentStr = typeof msg.content === 'string' 
                ? msg.content 
                : JSON.stringify(msg.content);
            const contentPreview = contentStr.substring(0, 60);
            // console.log(`  [${idx}] role=${msg.role} ${hasToolCalls ? 'HAS_TOOL_CALLS' : ''} content="${contentPreview}..."`);
        });
        //console.log('');
        
        // AZURE-SPECIFIC FIX: Filter conversation to ensure strict tool call → tool result ordering
        // Azure rejects conversations where tool messages don't immediately follow their tool calls
        const filteredMessages = this.filterMessagesForAzure(messages);
        
        return filteredMessages.map((message: any) => {
            // Handle tool result messages (role: 'tool')
            if (message.role === McpRole.TOOL) {
                // Extract tool_call_id from message object (not from content)
                const toolCallId = extractToolCallId(message);
                const toolResult = extractToolResult(message);
                
                if (toolCallId && toolResult) {
                    return {
                        role: 'tool' as const,
                        tool_call_id: toolCallId,
                        content: this.extractTextFromToolResult(toolResult)
                    };
                } else if (toolCallId) {
                    // AZURE-SPECIFIC FIX: Tool messages may have content as string/object, not TOOL_RESULT type
                    // extractToolResult() returns null for these, but we still need to send them to Azure as tool messages
                    // This prevents tool messages from falling through and becoming user messages
                    let content: string;
                    if (typeof message.content === 'string') {
                        content = message.content;
                    } else if (Array.isArray(message.content)) {
                        // Handle array of content (extract text)
                        content = message.content
                            .filter((c: any) => c.type === McpContentType.TEXT)
                            .map((c: any) => (c as McpTextContent).text)
                            .join('\n');
                    } else {
                        // Handle object content
                        content = JSON.stringify(message.content);
                    }
                    
                    return {
                        role: 'tool' as const,
                        tool_call_id: toolCallId,
                        content: content
                    };
                }
                // If no tool_call_id, this is malformed - log warning and fall through to user message
                logger.warn(`Tool message without tool_call_id will be converted to user message`);
            }
            
            // Handle assistant messages
            if (message.role === McpRole.ASSISTANT) {
                const contentArray = Array.isArray(message.content) ? message.content : [message.content];
                const textContent = contentArray
                    .filter((c: any) => c.type === McpContentType.TEXT)
                    .map((c: any) => (c as McpTextContent).text)
                    .join('\n');
                
                const assistantMessage: any = {
                    role: 'assistant',
                    content: textContent || null
                };
                
                // Include tool_calls if present (using utility)
                const toolCalls = extractToolCalls(message);
                if (toolCalls) {
                    assistantMessage.tool_calls = toolCalls;
                }
                
                return assistantMessage;
            }
            
            // Handle user and system messages
            const role = message.role === McpRole.SYSTEM ? 'system' : 'user';
            const contentArray = Array.isArray(message.content) ? message.content : [message.content];
            
            // Check if we have images
            const hasImages = contentArray.some((c: any) => c.type === McpContentType.IMAGE);
            
            if (hasImages) {
                // Multi-modal content
                const content = contentArray.map((item: any) => {
                    if (item.type === McpContentType.TEXT) {
                        return {
                            type: 'text' as const,
                            text: (item as McpTextContent).text
                        };
                    } else if (item.type === McpContentType.IMAGE) {
                        const imageItem = item as McpImageContent;
                        const imageUrl = imageItem.source.type === 'url' 
                            ? (imageItem.source as any).url 
                            : `data:${imageItem.source.media_type};base64,${imageItem.source.data}`;
                        
                        return {
                            type: 'image_url' as const,
                            image_url: { url: imageUrl }
                        };
                    }
                    return null;
                }).filter(Boolean);
                
                return { role, content };
            } else {
                // Text-only content
                const text = contentArray
                    .filter((c: any) => c.type === McpContentType.TEXT)
                    .map((c: any) => (c as McpTextContent).text)
                    .join('\n');
                
                return { role, content: text };
            }
        });
    }
    
    /**
     * Extract text from tool result content
     * @param toolResult - Tool result to extract from
     * @returns Extracted text
     */
    private extractTextFromToolResult(toolResult: any): string {
        const content = toolResult.content;
        
        if (Array.isArray(content)) {
            return content
                .filter(c => c.type === McpContentType.TEXT)
                .map(c => (c as McpTextContent).text)
                .join('\n');
        } else if (content?.type === McpContentType.TEXT) {
            return (content as McpTextContent).text;
        }
        
        return JSON.stringify(content);
    }
    
    /**
     * Convert MCP tools to Azure OpenAI format (using utility)
     * @param tools - MCP tools to convert
     * @returns Azure OpenAI formatted tools
     */
    private convertToAzureOpenAiTools(tools: McpTool[]): any[] {
        return convertToolsToProviderFormat(tools, 'openai');
    }
    
    /**
     * Convert Azure OpenAI response to MCP response
     * @param response - Azure OpenAI response to convert
     * @returns MCP formatted response
     */
    private convertToMcpResponse(response: any): McpApiResponse {
        // Get first choice from response
        if (!response.choices || response.choices.length === 0) {
            throw new Error('Azure OpenAI response does not contain any choices');
        }
        
        const choice = response.choices[0];
        const message = choice.message;
        
        // Build content array
        const content: McpContent[] = [];
        
        // Add text content if present
        if (message.content) {
            content.push({
                type: McpContentType.TEXT,
                text: message.content
            });
        }
        
        // Add tool calls if present
        if (message.tool_calls && message.tool_calls.length > 0) {
            message.tool_calls.forEach((toolCall: any) => {
                if (toolCall.type === 'function') {
                    const toolUseContent: McpToolUseContent = {
                        type: McpContentType.TOOL_USE,
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: JSON.parse(toolCall.function.arguments || '{}')
                    };
                    content.push(toolUseContent);
                }
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
                input_tokens: response.usage?.prompt_tokens || 0,
                output_tokens: response.usage?.completion_tokens || 0,
                total_tokens: response.usage?.total_tokens || 0
            }
        };
    }
    
    /**
     * NEW APPROACH: Send message using full agent context
     * 
     * This method structures messages for Azure based on semantic metadata,
     * eliminating the lossy reconstruction cycle that was creating duplicate messages.
     * 
     * Azure-specific structuring:
     * - Combines system prompt + agent identity into single system message
     * - Filters conversation to only dialogue and tool results
     * - Ensures strict tool_call → tool_result ordering
     * - Skips framework/action messages (already in system context)
     * 
     * @param context - Complete agent context from SDK
     * @param options - Additional Azure-specific options
     * @returns Promise with Azure OpenAI response
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
     * Implementation of context-based sending
     */
    private async sendWithContextImpl(
        context: AgentContext,
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        
        // Structure messages for Azure based on context
        const azureMessages = this.structureMessagesFromContext(context);
        
        
        // Pass tools as-is to sendProviderMessage - it will convert them
        // DO NOT pre-convert here to avoid double conversion
        const messages = this.convertAzureToMcpMessages(azureMessages);
        return this.sendProviderMessage(messages, context.availableTools as any, options);
    }
    
    /**
     * Structure messages from AgentContext for Azure
     * 
     * This is where we FIX the duplicate message issue by using metadata
     * to intelligently filter and structure messages.
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
        
        // 2. Conversation history: ONLY actual dialogue and tool results
        // NOTE: Task message is now added AFTER conversation history to maintain chronological order
        // This fixes the bug where subsequent tasks appeared above existing conversation
        // This is the KEY FIX - we filter using metadata to avoid duplicates
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
            // We include them unless they're explicitly system messages
            if (!layer && msg.role !== 'system') {
                return true;
            }
            
            // SKIP: Everything else (system messages without contextLayer)
            return false;
        });
        
        
        // Apply Azure-specific filtering and reordering
        const filteredMessages = this.filterMessagesForAzure(
            dialogueMessages.map(msg => this.convertConversationToMcp(msg))
        );
        
        // Convert to Azure format
        const azureDialogue = this.convertToAzureOpenAiMessages(filteredMessages);
        messages.push(...azureDialogue);
        
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
     * Convert ConversationMessage to McpMessage (for compatibility with existing filters)
     */
    private convertConversationToMcp(msg: ConversationMessage): McpMessage {
        let role: McpRole;
        switch (msg.role) {
            case 'system': role = McpRole.SYSTEM; break;
            case 'assistant': role = McpRole.ASSISTANT; break;
            case 'tool': role = McpRole.TOOL; break;
            default: role = McpRole.USER; break;
        }
        
        // CRITICAL: Preserve agent attribution for messages from other agents
        // Messages from other agents need [agentId]: prefix so the LLM knows who sent them
        let content = msg.content;
        if (role === McpRole.USER && msg.metadata?.fromAgentId) {
            // Check if content already has attribution prefix (防止双重前缀)
            const hasPrefix = content.startsWith('[') && content.includes(']:');
            if (!hasPrefix) {
                // This is a message FROM another agent - add attribution
                content = `[${msg.metadata.fromAgentId}]: ${content}`;
            }
        } else if (role === McpRole.USER && msg.metadata?.originalAgentId) {
            // Fallback: check originalAgentId (from StructuredPromptBuilder)
            const hasPrefix = content.startsWith('[') && content.includes(']:');
            if (!hasPrefix) {
                content = `[${msg.metadata.originalAgentId}]: ${content}`;
            }
        }
        
        const mcpMessage: any = {
            role,
            content: {
                type: McpContentType.TEXT,
                text: content
            }
        };
        
        // Preserve tool_calls for assistant messages
        if (msg.role === 'assistant' && msg.tool_calls) {
            mcpMessage.tool_calls = msg.tool_calls;
        }
        
        // Preserve tool_call_id for tool messages
        if (msg.role === 'tool' && msg.metadata?.tool_call_id) {
            mcpMessage.tool_call_id = msg.metadata.tool_call_id;
        }
        
        return mcpMessage;
    }
    
    /**
     * Convert Azure messages back to MCP format (for compatibility)
     */
    private convertAzureToMcpMessages(azureMessages: any[]): McpMessage[] {
        return azureMessages.map(msg => ({
            role: msg.role === 'system' ? McpRole.SYSTEM : 
                  msg.role === 'assistant' ? McpRole.ASSISTANT :
                  msg.role === 'tool' ? McpRole.TOOL : McpRole.USER,
            content: {
                type: McpContentType.TEXT,
                text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }
        }));
    }
    
    /**
     * Send a message to Azure OpenAI (LEGACY METHOD)
     * @param messages - MCP messages to send
     * @param tools - Optional tools to make available
     * @param options - Additional options
     * @returns Promise with the Azure OpenAI response converted to MCP format
     */
    protected async sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        if (!this.apiClient) {
            throw new Error('Azure OpenAI client not initialized');
        }
        
        try {
            // Validate inputs
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('Messages array cannot be empty');
            }
            
            // Convert messages to Azure OpenAI format
            const azureMessages = this.convertToAzureOpenAiMessages(messages);
            
            // Prepare request parameters
            // For Azure OpenAI, the model name is specified in the deployment, 
            // but we still pass it to the create call
            const modelName = options?.model || this.config.defaultModel || process.env.AZURE_OPENAI_MODEL_NAME || 'gpt-4';
            
            const requestParams: any = {
                model: modelName,
                messages: azureMessages,
                temperature: options?.temperature || this.config.temperature || 1,
                max_completion_tokens: options?.maxTokens || this.config.maxTokens || 4096,
                top_p: options?.topP || 1,
                frequency_penalty: options?.frequencyPenalty || 0,
                presence_penalty: options?.presencePenalty || 0
            };
            
            // Add tools if provided
            if (tools && tools.length > 0) {
                requestParams.tools = this.convertToAzureOpenAiTools(tools);
                
                // Set tool_choice based on options
                if (options?.requireToolUse) {
                    requestParams.tool_choice = 'required';
                } else if (options?.preferToolUse) {
                    requestParams.tool_choice = 'auto';
                }
            }
            
            // Add stop sequences if provided
            if (options?.stopSequences && Array.isArray(options.stopSequences)) {
                requestParams.stop = options.stopSequences;
            }

            // console.log('');
            // console.log('requestParams', JSON.stringify(requestParams));
            // console.log('');
            
            // Make the API request
            const response = await this.apiClient.chat.completions.create(requestParams);

            // console.log('');
            // console.log('response', JSON.stringify(response));
            // console.log('');
            
            // Convert and return response
            return this.convertToMcpResponse(response);
        } catch (error: any) {
            // Handle Azure OpenAI specific errors
            if (error?.status) {
                logger.error(`Azure OpenAI API error [${error.status}]: ${error.message}`);
                throw new Error(`Azure OpenAI API error [${error.status}]: ${error.message}`);
            }
            
            logger.error(`Error sending message to Azure OpenAI: ${error.message}`);
            throw new Error(`Error sending message to Azure OpenAI: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Get provider name
     * @returns Provider name
     */
    getProviderName(): string {
        return 'azure-openai';
    }
}
