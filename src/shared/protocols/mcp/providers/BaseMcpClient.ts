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
 * Base MCP Client
 * 
 * This abstract class provides a foundation for all Model Context Protocol (MCP) client implementations.
 * It implements common functionality while requiring provider-specific implementations to handle
 * the actual API interactions.
 */

import { Observable, from, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { createStrictValidator } from '../../../utils/validation';
import { 
    IMcpClient, 
    McpClientConfig, 
    McpMessage, 
    McpTool, 
    McpApiResponse,
    McpRole,
    McpContentType,
    McpTextContent,
    McpImageContent,
    McpToolUseContent,
    McpToolResultContent,
    McpToolInput,
    McpResourceOptions,
    McpResourceContent
} from '../IMcpClient';

/**
 * Abstract base class for MCP client implementations
 */
export abstract class BaseMcpClient implements IMcpClient {
    // Configuration for this client - initialize with empty defaults to satisfy TypeScript
    protected config: McpClientConfig = {
        apiKey: '',
        defaultModel: '',
        maxTokens: 4096,
        temperature: 0.7
    };
    
    // Registered tools
    protected tools: McpTool[] = [];
    
    // Validator for input validation
    protected validator = createStrictValidator('BaseMcpClient');
    
    // Flag indicating if the client is initialized
    protected isInitialized = false;
    
    /**
     * Initialize the client with the given configuration
     * 
     * @param config Client configuration
     * @returns Observable that resolves to true if initialization is successful
     */
    public initialize(config: McpClientConfig): Observable<boolean> {
        try {
            // Validate API key
            this.validator.assertIsNonEmptyString(config.apiKey);
            
            // Store configuration
            this.config = {
                ...config,
                temperature: config.temperature || 0.7,
                maxTokens: config.maxTokens || 4096,
            };
            
            // Mark as initialized
            this.isInitialized = true;
            
            // Perform provider-specific initialization
            return from(this.initializeProvider()).pipe(
                map(() => true),
                catchError(error => {
                    this.isInitialized = false;
                    return throwError(() => new Error(`Provider initialization failed: ${error instanceof Error ? error.message : String(error)}`));
                })
            );
        } catch (error) {
            return throwError(() => new Error(`Client initialization failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    
    /**
     * Provider-specific initialization logic
     * 
     * @returns Promise that resolves when provider-specific initialization is complete
     */
    protected abstract initializeProvider(): Promise<void>;
    
    /**
     * Provider-specific message sending logic
     * 
     * @param messages Messages to send
     * @param tools Optional tools to make available
     * @param options Additional options
     * @returns Promise that resolves to the provider-specific response
     */
    protected abstract sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse>;
    
    /**
     * Send a message to the LLM
     * 
     * @param messages Messages to send
     * @param tools Optional tools to make available
     * @param options Additional options
     * @returns Observable that resolves to the API response
     */
    public sendMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Observable<McpApiResponse> {
        if (!this.isInitialized) {
            return throwError(() => new Error('Client not initialized'));
        }
        
        try {
            // Validate messages array
            this.validator.assertIsArray(messages);
            if (messages.length === 0) {
                throw new Error('Messages array cannot be empty');
            }
            
            // Combine tools - merge provided tools with registered tools
            const mergedTools = tools 
                ? [...this.tools, ...tools] 
                : this.tools.length > 0 
                    ? this.tools 
                    : undefined;
            
            return from(this.sendProviderMessage(messages, mergedTools, options)).pipe(
                catchError(error => throwError(() => new Error(`Error sending message: ${error instanceof Error ? error.message : String(error)}`)))
            );
        } catch (error) {
            return throwError(() => new Error(`Error preparing message: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    
    /**
     * Register a tool with the MCP
     * 
     * @param tool Tool to register
     * @returns Observable that resolves to true if registration is successful
     */
    public registerTool(tool: McpTool): Observable<boolean> {
        try {
            // Validate tool
            this.validator.assertIsObject(tool);
            this.validator.assertIsNonEmptyString(tool.name);
            this.validator.assertIsNonEmptyString(tool.description);
            this.validator.assertIsObject(tool.input_schema);
            
            // Check if tool with same name already exists
            const existingTool = this.tools.find(t => t.name === tool.name);
            if (existingTool) {
                // Update existing tool
                const index = this.tools.indexOf(existingTool);
                this.tools[index] = tool;
            } else {
                // Add new tool
                this.tools.push(tool);
            }
            
            return of(true);
        } catch (error) {
            return throwError(() => new Error(`Error registering tool: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    
    /**
     * Get tools registered with this client
     * 
     * @returns Observable that resolves to an array of registered tools
     */
    public getRegisteredTools(): Observable<McpTool[]> {
        return of([...this.tools]);
    }
    
    /**
     * Create a text content object
     * 
     * @param text Text content
     * @returns Text content object
     */
    public createTextContent(text: string): McpTextContent {
        return {
            type: McpContentType.TEXT,
            text
        };
    }
    
    /**
     * Create an image content object
     * 
     * @param source Image source
     * @returns Image content object
     */
    public createImageContent(source: McpImageContent['source']): McpImageContent {
        return {
            type: McpContentType.IMAGE,
            source
        };
    }
    
    /**
     * Create a tool use content object
     * 
     * @param id Tool use ID
     * @param name Tool name
     * @param input Tool input
     * @returns Tool use content object
     */
    public createToolUseContent(id: string, name: string, input: McpToolInput): McpToolUseContent {
        return {
            type: McpContentType.TOOL_USE,
            id,
            name,
            input
        };
    }
    
    /**
     * Create a tool result content object
     * 
     * @param toolUseId The ID of the tool call this is a result for
     * @param content Result content
     * @returns Tool result content object
     */
    public createToolResultContent(
        toolUseId: string,
        content: McpTextContent | McpImageContent | Array<McpTextContent | McpImageContent>
    ): McpToolResultContent {
        return {
            type: McpContentType.TOOL_RESULT,
            tool_use_id: toolUseId,
            content: Array.isArray(content) ? content : [content]
        };
    }
    
    /**
     * List available resources
     * 
     * @param options Options for listing resources
     * @returns Observable that resolves to an array of resources
     */
    public listResources(options?: McpResourceOptions): Observable<McpResourceContent[]> {
        return of([]);
    }
    
    /**
     * Get a resource by URI
     * 
     * @param uri Resource URI
     * @returns Observable that resolves to the resource content
     */
    public getResource(uri: string): Observable<McpResourceContent> {
        return throwError(() => new Error('Resource retrieval not implemented for this provider'));
    }
}
