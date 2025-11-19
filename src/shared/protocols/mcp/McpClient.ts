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
 * Generic MCP Client
 * 
 * This module provides a provider-agnostic client for the Model Context Protocol (MCP).
 * It delegates to specific provider implementations while presenting a unified interface.
 */

import { Observable, from, of, throwError } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { 
    IMcpClient, 
    McpClientConfig, 
    McpMessage, 
    McpTool, 
    McpApiResponse,
    McpTextContent, 
    McpImageContent, 
    McpToolUseContent, 
    McpToolResultContent, 
    McpToolInput,
    McpContentType,
    McpResourceOptions,
    McpResourceContent
} from './IMcpClient';
import { McpClientFactory } from './McpClientFactory';

/**
 * Configuration for the MCP client
 */
export interface McpConfig extends McpClientConfig {
    /** 
     * Implementation class to use for the client
     * This replaces the provider-specific implementation that was previously used
     */
    implementation: new () => IMcpClient;
}

/**
 * Provider-agnostic MCP client
 */
export class McpClient implements IMcpClient {
    private client?: IMcpClient;
    private config?: McpConfig;
    private initialized = false;
    
    /**
     * Initialize client with configuration
     * @param config Client configuration
     */
    public initialize(config: McpClientConfig): Observable<boolean> {
        if (!this.isValidConfig(config)) {
            return throwError(() => new Error('Invalid MCP configuration'));
        }
        
        const mcpConfig = config as McpConfig;
        this.config = mcpConfig;
        
        return McpClientFactory.createClient(mcpConfig.implementation, config).pipe(
            mergeMap(client => {
                this.client = client;
                return this.client.initialize(config);
            }),
            tap(success => {
                this.initialized = success;
            }),
            catchError(error => {
                return throwError(() => new Error(`Failed to initialize MCP client: ${error}`));
            })
        );
    }
    
    /**
     * Check if the provided configuration is valid for this client
     * @param config Configuration to validate
     * @returns True if the configuration is valid
     */
    private isValidConfig(config: McpClientConfig): boolean {
        const mcpConfig = config as McpConfig;
        return !!mcpConfig.implementation;
    }
    
    /**
     * Send a message to the LLM
     * @param messages Messages to send
     * @param tools Optional tools to make available
     * @param options Additional options
     */
    public sendMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Observable<McpApiResponse> {
        if (!this.initialized || !this.client) {
            return throwError(() => new Error('MCP client not initialized'));
        }
        
        return this.client.sendMessage(messages, tools, options);
    }
    
    /**
     * Register a tool with the MCP
     * @param tool Tool to register
     */
    public registerTool(tool: McpTool): Observable<boolean> {
        if (!this.initialized || !this.client) {
            return throwError(() => new Error('MCP client not initialized'));
        }
        
        return this.client.registerTool(tool);
    }
    
    /**
     * Get tools registered with this client
     */
    public getRegisteredTools(): Observable<McpTool[]> {
        if (!this.initialized || !this.client) {
            return throwError(() => new Error('MCP client not initialized'));
        }
        
        return this.client.getRegisteredTools();
    }
    
    /**
     * Create a text content object
     * @param text Text content
     */
    public createTextContent(text: string): McpTextContent {
        if (!this.client) {
            throw new Error('MCP client not initialized');
        }
        
        return this.client.createTextContent(text);
    }
    
    /**
     * Create an image content object
     * @param source Image source
     */
    public createImageContent(source: McpImageContent['source']): McpImageContent {
        if (!this.client) {
            throw new Error('MCP client not initialized');
        }
        
        return this.client.createImageContent(source);
    }
    
    /**
     * Create a tool use content object
     * @param id Tool use ID
     * @param name Tool name
     * @param input Tool input
     */
    public createToolUseContent(id: string, name: string, input: McpToolInput): McpToolUseContent {
        if (!this.client) {
            throw new Error('MCP client not initialized');
        }
        
        return this.client.createToolUseContent(id, name, input);
    }
    
    /**
     * Create a tool result content object
     * @param toolCallId The ID of the tool call this is a result for
     * @param content Result content
     */
    public createToolResultContent(
        toolCallId: string,
        content: McpTextContent | McpImageContent | Array<McpTextContent | McpImageContent>
    ): McpToolResultContent {
        if (!this.client) {
            throw new Error('MCP client not initialized');
        }
        
        return this.client.createToolResultContent(toolCallId, content);
    }

    /**
     * List available resources
     * @param options Options for listing resources
     */
    public listResources(options?: McpResourceOptions): Observable<McpResourceContent[]> {
        if (!this.initialized || !this.client) {
            return throwError(() => new Error('MCP client not initialized'));
        }
        
        return this.client.listResources(options);
    }
    
    /**
     * Get a resource by URI
     * @param uri Resource URI
     */
    public getResource(uri: string): Observable<McpResourceContent> {
        if (!this.initialized || !this.client) {
            return throwError(() => new Error('MCP client not initialized'));
        }
        
        return this.client.getResource(uri);
    }
}
