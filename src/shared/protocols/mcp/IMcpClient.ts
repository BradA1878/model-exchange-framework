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
 * Model Context Protocol (MCP) Client Interface
 * 
 * This module defines the core interface for interacting with LLMs
 * using the Model Context Protocol (MCP) standard for AI model-to-tool interactions.
 * https://github.com/modelcontextprotocol/specification
 */

import { Observable } from 'rxjs';
import { AgentContext } from '../../interfaces/AgentContext';

/**
 * MCP Message Role
 */
export enum McpRole {
    USER = 'user',
    ASSISTANT = 'assistant',
    SYSTEM = 'system',
    TOOL = 'tool'
}

/**
 * MCP Content Block Type
 */
export enum McpContentType {
    TEXT = 'text',
    IMAGE = 'image',
    TOOL_USE = 'tool_use',
    TOOL_RESULT = 'tool_result'
}

/**
 * MCP Text Content Block
 */
export interface McpTextContent {
    type: McpContentType.TEXT;
    text: string;
}

/**
 * MCP Image Content Block
 */
export interface McpImageContent {
    type: McpContentType.IMAGE;
    source: {
        type: 'base64' | 'url';
        media_type: string;
        data: string;
    };
}

/**
 * MCP Tool Input
 */
export interface McpToolInput {
    [key: string]: any;
}

/**
 * MCP Tool Use Content Block
 */
export interface McpToolUseContent {
    type: McpContentType.TOOL_USE;
    id: string;
    name: string;
    input: McpToolInput;
}

/**
 * MCP Tool Result Content Block
 */
export interface McpToolResultContent {
    type: McpContentType.TOOL_RESULT;
    tool_use_id: string;
    content: McpTextContent | McpImageContent | Array<McpTextContent | McpImageContent>;
}

/**
 * MCP Content Union Type
 */
export type McpContent = McpTextContent | McpImageContent | McpToolUseContent | McpToolResultContent;

/**
 * MCP Message
 */
export interface McpMessage {
    role: McpRole;
    content: McpContent | McpContent[];
}

/**
 * MCP API Response
 */
export interface McpApiResponse {
    id: string;
    type: string;
    role: string;
    content: McpContent[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    reasoning?: string;  // Reasoning tokens from reasoning models (e.g., o1, deepseek-reasoner)
    usage: {
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
    };
}

/**
 * MCP Tool Definition
 */
export interface McpTool {
    name: string;
    description: string;
    input_schema: Record<string, any>;
}

/**
 * MCP Resource Options
 */
export interface McpResourceOptions {
    /**
     * Maximum number of resources to return
     */
    limit?: number;
    
    /**
     * URI pattern to filter resources
     */
    pattern?: string;
    
    /**
     * Filter by resource tags
     */
    tags?: string[];
}

/**
 * MCP Resource Content
 */
export interface McpResourceContent {
    /**
     * Resource URI
     */
    uri: string;
    
    /**
     * Resource text content
     */
    text: string;
    
    /**
     * Optional metadata
     */
    metadata?: Record<string, any>;
}

/**
 * MCP Client Configuration
 */
export interface McpClientConfig {
    /**
     * API key for the provider
     */
    apiKey: string;
    
    /**
     * Default model to use
     */
    defaultModel?: string;
    
    /**
     * Maximum tokens to generate
     */
    maxTokens?: number;
    
    /**
     * Temperature for sampling
     */
    temperature?: number;
    
    /**
     * Base URL for API
     */
    baseUrl?: string;
    
    /**
     * Provider-specific configuration options
     */
    providerOptions?: Record<string, any>;
}

/**
 * Interface for MCP Client
 */
export interface IMcpClient {
    /**
     * Initialize client with configuration
     * @param config Client configuration
     */
    initialize(config: McpClientConfig): Observable<boolean>;
    
    /**
     * Send a message to the LLM
     * @param messages Messages to send
     * @param tools Optional tools to make available
     * @param options Additional options (can include systemPrompt, model, etc.)
     * @deprecated Use sendWithContext for better provider-specific handling
     */
    sendMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Observable<McpApiResponse>;
    
    /**
     * Send a message using full agent context (NEW APPROACH)
     * 
     * This is the preferred method that allows each MCP client to:
     * - Structure messages according to provider requirements
     * - Filter conversation history based on metadata
     * - Apply provider-specific optimizations
     * - Avoid lossy reconstruction cycles
     * 
     * Each provider implements this differently:
     * - Azure: Combines system+identity, strict tool ordering
     * - OpenRouter: Different message limits and formatting
     * - Anthropic: Different system message handling
     * 
     * @param context Complete agent context from SDK
     * @param options Additional provider-specific options
     * 
     * NOTE: Optional for now during migration. Will become required in future release.
     */
    sendWithContext?(
        context: AgentContext,
        options?: Record<string, any>
    ): Observable<McpApiResponse>;
    
    /**
     * Register a tool with the MCP
     * @param tool Tool to register
     */
    registerTool(tool: McpTool): Observable<boolean>;
    
    /**
     * Get tools registered with this client
     */
    getRegisteredTools(): Observable<McpTool[]>;
    
    /**
     * Create a text content object
     * @param text Text content
     */
    createTextContent(text: string): McpTextContent;
    
    /**
     * Create an image content object
     * @param source Image source
     */
    createImageContent(source: McpImageContent['source']): McpImageContent;
    
    /**
     * Create a tool use content object
     * @param id Tool use ID
     * @param name Tool name
     * @param input Tool input
     */
    createToolUseContent(id: string, name: string, input: McpToolInput): McpToolUseContent;
    
    /**
     * Create a tool result content object
     * @param toolCallId The ID of the tool call this is a result for
     * @param content Result content
     */
    createToolResultContent(
        toolCallId: string,
        content: McpTextContent | McpImageContent | Array<McpTextContent | McpImageContent>
    ): McpToolResultContent;
    
    /**
     * List available resources
     * @param options Options for listing resources
     */
    listResources(options?: McpResourceOptions): Observable<McpResourceContent[]>;
    
    /**
     * Get a resource by URI
     * @param uri Resource URI
     */
    getResource(uri: string): Observable<McpResourceContent>;
}
