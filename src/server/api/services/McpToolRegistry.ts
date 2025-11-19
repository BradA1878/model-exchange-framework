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
 * MCP Tool Registry Service
 * 
 * This service manages MCP tools registration and discovery within the MXF.
 * It follows the provider-agnostic implementation of the Model Context Protocol.
 */

import { Observable, of, throwError, from, firstValueFrom } from 'rxjs';
import { map, mergeMap, catchError, switchMap } from 'rxjs/operators';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult } from '../../../shared/protocols/mcp/McpServerTypes';
import { Events } from '../../../shared/events/EventNames';
import { EventBus } from '../../../shared/events/EventBus';
import { createMcpTool, findMcpToolByName, updateMcpTool, deleteMcpTool, listAllMcpTools } from '../../../shared/models/mcpTool';
import { createMcpToolRegistryChangedPayload, createBaseEventPayload, createMcpToolCallPayload } from '../../../shared/schemas/EventPayloadSchema';
import { mxfMcpToolRegistry } from '../../../shared/protocols/mcp/tools/index';
import { McpToolDocumentationService } from '../../../shared/services/McpToolDocumentationService';

// Create validator for tool registry
const validate = createStrictValidator('McpToolRegistry');

/**
 * Extended MCP Tool Definition for internal use
 * Includes additional fields not in the base interface
 */
export interface ExtendedMcpToolDefinition extends McpToolDefinition {
    /** Provider ID that owns this tool */
    providerId?: string;
    /** Channel ID where the tool is available */
    channelId?: string;
    /** Tool parameters */
    parameters?: Array<Record<string, any>>;
}

/**
 * MCP Tool Registry Service
 * 
 * This service manages the registration and listing of MCP tools
 * in a provider-agnostic way.
 */
export class McpToolRegistry {
    private static instance: McpToolRegistry | null = null;
    private logger: Logger;
    private tools: Map<string, ExtendedMcpToolDefinition> = new Map();
    private databaseLoaded: boolean = false;
    private loadingPromise: Promise<void> | null = null;

    // Event name for tool registry changes
    private static readonly TOOL_REGISTRY_CHANGED = Events.Mcp.TOOL_REGISTRY_CHANGED;

    /**
     * Private constructor - use getInstance() instead
     */
    private constructor() {
        this.logger = new Logger('debug', 'McpToolRegistry', 'server');
        this.setupEventHandlers();
        // Don't load tools in constructor - load them lazily when needed
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): McpToolRegistry {
        if (!McpToolRegistry.instance) {
            McpToolRegistry.instance = new McpToolRegistry();
        }
        return McpToolRegistry.instance;
    }

    /**
     * Reset the singleton instance (for testing)
     */
    public static resetInstance(): void {
        McpToolRegistry.instance = null;
    }

    /**
     * Load tools from the database into memory (with promise caching)
     */
    private async loadToolsFromDatabase(): Promise<void> {
        // If already loading, return the existing promise
        if (this.loadingPromise) {
            return this.loadingPromise;
        }

        // If already loaded, return immediately
        if (this.databaseLoaded) {
            return;
        }

        // Cache the loading promise to prevent multiple concurrent loads
        this.loadingPromise = this.performDatabaseLoad();
        
        try {
            await this.loadingPromise;
        } finally {
            // Clear the loading promise whether successful or failed
            this.loadingPromise = null;
        }
    }

    /**
     * Perform the actual database loading operation
     */
    private async performDatabaseLoad(): Promise<void> {
        try {
            
            // Get all tools from the database
            const tools = await firstValueFrom(from(listAllMcpTools()));
            
            
            // Clear existing tools
            this.tools.clear();
            
            // Add tools to memory
            for (const tool of tools) {
                // Check if this tool has a server-side handler available
                const mxfTool = mxfMcpToolRegistry.get(tool.name as any);
                
                // Convert database model to tool definition
                const toolDef: ExtendedMcpToolDefinition = {
                    name: tool.name,
                    description: tool.description || '',
                    inputSchema: mxfTool?.inputSchema || {},
                    enabled: true,
                    providerId: tool.providerId,
                    channelId: tool.channelId,
                    parameters: tool.parameters,
                    metadata: tool.metadata || {},
                    handler: mxfTool?.handler ? (async (input: any, context: McpToolHandlerContext) => {
                        // Adapt MXF tool handler to MCP interface
                        try {
                            // Strict validation for critical security fields
                            if (!context.agentId || typeof context.agentId !== 'string') {
                                throw new Error('Missing or invalid agentId in tool execution context. agentId is required for all MCP operations.');
                            }
                            if (!context.channelId || typeof context.channelId !== 'string') {
                                throw new Error('Missing or invalid channelId in tool execution context. channelId is required for all MCP operations.');
                            }
                            
                            // Convert MCP context to MXF tool context format
                            const mxfContext = {
                                agentId: context.agentId,
                                channelId: context.channelId, 
                                requestId: context.requestId,
                                ...context.data
                            };
                            
                            // Call the MXF tool handler
                            const result = await mxfTool.handler(input, mxfContext);

                            // Check if result is already in proper MCP format with content field
                            if (result && typeof result === 'object' && 'content' in result) {
                                // Tool already returned proper MCP format - return as-is
                                return {
                                    ...result,
                                    metadata: {
                                        ...result.metadata,
                                        executedAt: Date.now(),
                                        toolName: tool.name
                                    }
                                };
                            }

                            // Convert result to MCP format (for legacy tools)
                            return {
                                content: {
                                    type: 'text',
                                    data: typeof result === 'string' ? result : JSON.stringify(result)
                                },
                                metadata: {
                                    executedAt: Date.now(),
                                    toolName: tool.name
                                }
                            };
                        } catch (error) {
                            // Handle execution errors
                            return {
                                content: {
                                    type: 'error',
                                    data: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`
                                },
                                metadata: {
                                    error: true,
                                    executedAt: Date.now(),
                                    toolName: tool.name
                                }
                            };
                        }
                    }) : (async (input, context) => {
                        // Fallback handler for tools without server-side implementation
                        // This routes the call back to the agent for execution
                        this.logger.warn(`No server-side handler found for tool ${tool.name}, routing to agent`);
                        
                        // Strict validation before routing
                        if (!context.agentId || typeof context.agentId !== 'string') {
                            throw new Error('Missing or invalid agentId in tool execution context. agentId is required for all MCP operations.');
                        }
                        if (!context.channelId || typeof context.channelId !== 'string') {
                            throw new Error('Missing or invalid channelId in tool execution context. channelId is required for all MCP operations.');
                        }
                        
                        EventBus.server.emit(Events.Mcp.TOOL_CALL, createMcpToolCallPayload(
                            Events.Mcp.TOOL_CALL,
                            context.agentId,
                            context.channelId,
                            {
                                toolName: tool.name,
                                callId: context.requestId,
                                arguments: input
                            }
                        ));
                        return { 
                            content: {
                                type: 'text',
                                data: 'Tool execution routed to agent'
                            }
                        };
                    })
                };
                
                // Add to memory
                this.tools.set(tool.name, toolDef);
                
                // Register with documentation service
                McpToolDocumentationService.getInstance().registerTool(toolDef);
                
                // Log whether we found a server-side handler
                if (mxfTool?.handler) {
                } else {
                }
            }
            
            this.databaseLoaded = true;
            
        } catch (error) {
            this.logger.error(`Failed to load tools from database: ${error}`);
            throw error;
        }
    }
    
    /**
     * Set up event handlers for MCP tool events
     */
    private setupEventHandlers(): void {
        // Listen for tool events from socket server
        
        // Register a tool via event bus
        EventBus.server.on(
            Events.Mcp.TOOL_REGISTER,
            (payload: any) => {
                // Validate payload structure
                if (!payload || typeof payload !== 'object') {
                    this.logger.error('Invalid payload for tool registration');
                    return;
                }

                // Extract tool info from payload (handle both raw and EventBus structured payloads)
                const toolData = payload.data || payload;
                const toolName = toolData.toolName || toolData.name;
                const description = toolData.description || '';
                const inputSchema = toolData.inputSchema || {};
                const metadata = toolData.metadata || {};
                
                // Get channel and provider information - these are required for all MCP operations
                if (!payload.channelId || typeof payload.channelId !== 'string') {
                    this.logger.error('channelId is required for MCP tool registration');
                    return;
                }
                if (!payload.agentId || typeof payload.agentId !== 'string') {
                    this.logger.error('agentId is required for MCP tool registration');
                    return;
                }
                
                const channelId = payload.channelId;
                const providerId = payload.agentId;

                if (!toolName) {
                    this.logger.error('Tool name is required for registration');
                    return;
                }

                // Create tool definition
                const toolDef: ExtendedMcpToolDefinition = {
                    name: toolName,
                    description: description,
                    inputSchema: inputSchema,
                    handler: async () => {
                        throw new Error('Event-registered tools must handle execution via events');
                    },
                    enabled: true,
                    metadata: metadata,
                };
                
                this.registerTool(toolDef, channelId, providerId).subscribe({
                    next: (success) => {
                        EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_REGISTERED,
                            'system', // agentId for system events
                            'global', // channelId for global registry events
                            {
                                name: toolName,
                                success
                            }
                        ));
                    },
                    error: (error) => {
                        this.logger.error(`Failed to register tool ${toolName}: ${error}`);
                        EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_REGISTERED,
                            'system', // agentId for system events
                            'global', // channelId for global registry events
                            {
                                name: toolName,
                                success: false
                            }
                        ));
                    }
                });
            }
        );
        
        // Unregister a tool via event bus
        EventBus.server.on(
            Events.Mcp.TOOL_UNREGISTER,
            (payload: any) => {
                // Validate payload structure
                if (!payload || typeof payload !== 'object') {
                    this.logger.error('Invalid payload for tool unregistration');
                    return;
                }

                // Extract tool info from payload (handle both raw and EventBus structured payloads)
                const toolData = payload.data || payload;
                const toolName = toolData.toolName || toolData.name;

                if (!toolName) {
                    this.logger.error('Tool name is required for unregistration');
                    return;
                }

                this.unregisterTool(toolName).subscribe({
                    next: (success) => {
                        EventBus.server.emit(Events.Mcp.TOOL_UNREGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_UNREGISTERED,
                            'system', // agentId for system events
                            'global', // channelId for global registry events
                            {
                                name: toolName,
                                success
                            }
                        ));
                    },
                    error: (error) => {
                        this.logger.error(`Failed to unregister tool ${toolName}: ${error}`);
                        EventBus.server.emit(Events.Mcp.TOOL_UNREGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_UNREGISTERED,
                            'system', // agentId for system events
                            'global', // channelId for global registry events
                            {
                                name: toolName,
                                success: false
                            }
                        ));
                    }
                });
            }
        );
        
        // List tools via event bus
        EventBus.server.on(
            Events.Mcp.TOOL_LIST,
            (payload: any) => {
                // Extract filter and requestId from payload (handle both raw and EventBus structured payloads)
                const listData = payload.data || payload;
                const filter = listData.filter || '';
                const requestId = listData.requestId;

                // Only proceed if we have valid agentId, channelId, and requestId
                if (!payload.agentId || !payload.channelId || !requestId) {
                    this.logger.error(`Cannot process TOOL_LIST event - missing required fields. AgentId: ${payload.agentId || '[MISSING]'}, ChannelId: ${payload.channelId || '[MISSING]'}, RequestId: ${requestId || '[MISSING]'}`);
                    return;
                }

                this.listTools(filter).subscribe({
                    next: (tools) => {
                        EventBus.server.emit(Events.Mcp.TOOL_LIST_RESULT, createBaseEventPayload(
                            Events.Mcp.TOOL_LIST_RESULT,
                            payload.agentId, // Use actual agentId from request
                            payload.channelId, // Use actual channelId from request
                            {
                                tools: tools.map(tool => ({
                                    name: tool.name,
                                    description: tool.description,
                                    inputSchema: tool.inputSchema
                                    // Ensure only fields defined in McpPayloads for 'mcp:tool:list:result' are included
                                }))
                            }
                        ));
                    },
                    error: (error) => {
                        this.logger.error(`Failed to list tools: ${error}`);
                        EventBus.server.emit(Events.Mcp.TOOL_LIST_ERROR, createBaseEventPayload(
                            Events.Mcp.TOOL_LIST_ERROR,
                            'system', // agentId for system events
                            'global', // channelId for global registry events
                            {
                                error: error instanceof Error ? error.message : String(error)
                            }
                        ));
                    }
                });
            }
        );
        
        // Listen for requests for tool changes
        EventBus.server.on(McpToolRegistry.TOOL_REGISTRY_CHANGED, () => {
            // This is just an event subscription point for components that need to know
            // when the tool registry changes
        });
    }
    
    /**
     * Notify listeners that the tool registry has changed
     */
    private notifyToolRegistryChanged(): void {
        // TODO: Review if this custom event should be formalized in McpEvents.ts
        // For now, ensuring it emits a valid payload structure.
        // The payload for this custom event is { tools: ExtendedMcpToolDefinition[] }
        EventBus.server.emit(McpToolRegistry.TOOL_REGISTRY_CHANGED, createMcpToolRegistryChangedPayload(
            McpToolRegistry.TOOL_REGISTRY_CHANGED,
            'system', // agentId for system events
            'global', // channelId for global registry events
            {
                tools: Array.from(this.tools.values()).map(tool => ({
                    // Ensure the emitted tool structure is consistent and doesn't expose internal handlers directly
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    enabled: tool.enabled,
                    providerId: tool.providerId,
                    channelId: tool.channelId,
                    parameters: tool.parameters,
                    metadata: tool.metadata
                    // Explicitly omit 'handler' from the emitted event
                }))
            }
        ));
    }
    
    /**
     * Register an MCP tool
     * @param tool Tool definition
     * @param providerId Provider ID that owns this tool
     * @param channelId Channel ID where the tool is available
     * @returns Observable that emits true if the tool was registered successfully
     */
    public registerTool(
        tool: McpToolDefinition, 
        providerId: string, 
        channelId: string
    ): Observable<boolean> {
        try {
            // Validate input
            validate.assertIsObject(tool, 'Tool must be an object');
            validate.assertIsNonEmptyString(tool.name, 'Tool name must be a non-empty string');
            validate.assertIsNonEmptyString(providerId, 'Provider ID must be a non-empty string');
            
            // Validate description is a string (not required to be non-empty)
            if (tool.description !== undefined && typeof tool.description !== 'string') {
                return throwError(() => new Error('Tool description must be a string if provided'));
            }
            
            // Validate inputSchema is an object
            if (tool.inputSchema !== undefined && typeof tool.inputSchema !== 'object') {
                return throwError(() => new Error('Tool inputSchema must be an object if provided'));
            }
            
            // channelId is mandatory for all MCP tool registrations
            if (!channelId || typeof channelId !== 'string') {
                return throwError(() => new Error('channelId is required for MCP tool registration and must be a non-empty string'));
            }
            
            // Check if the tool already exists
            if (this.tools.has(tool.name)) {
                const existingTool = this.tools.get(tool.name)!;
                
                // If it's the same tool from the same provider and channel, just return success
                if (existingTool.providerId === providerId && existingTool.channelId === channelId) {
                    //;
                    return of(true);
                }
                
                // If different provider or channel, log a warning but return success to avoid noise
                return of(true);
            }
            
            // Add provider ID to the tool definition
            const toolWithProvider: ExtendedMcpToolDefinition = {
                ...tool,
                providerId,
                channelId
            };
            
            // Store in memory
            this.tools.set(tool.name, toolWithProvider);
            
            // Register with documentation service
            McpToolDocumentationService.getInstance().registerTool(toolWithProvider);
            
            // Persist to database
            return from(createMcpTool({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema || {},
                enabled: tool.enabled !== undefined ? tool.enabled : true,
                providerId,
                channelId,
                // Extract parameters from toolWithProvider if they exist, or default to empty array
                parameters: toolWithProvider.parameters || [],
                metadata: tool.metadata || {},
                createdAt: new Date(),
                updatedAt: new Date()
            })).pipe(
                map((savedTool) => {
                    // Log successful registration
                    
                    // Notify listeners that the registry has changed
                    this.notifyToolRegistryChanged();
                    
                    return true;
                }),
                catchError(error => {
                    this.logger.error(`Database error registering tool ${tool.name}: ${error}`);
                    
                    // Remove from memory if database persistence fails
                    this.tools.delete(tool.name);
                    
                    return throwError(() => error);
                })
            );
        } catch (error) {
            this.logger.error(`Failed to register tool: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * Register multiple MCP tools in bulk
     * @param tools Array of tools to register
     * @param providerId Provider ID that owns these tools
     * @param channelId Channel ID where the tools are available
     * @returns Observable that emits the array of successfully registered tool names
     */
    public registerTools(
        tools: McpToolDefinition[], 
        providerId: string = 'mxf-server', 
        channelId: string = 'system'
    ): Observable<string[]> {
        try {
            // Validate input
            validate.assertIsArray(tools, 'Tools must be an array');
            validate.assertIsNonEmptyString(providerId, 'Provider ID must be a non-empty string');
            validate.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
            
            
            const registeredTools: string[] = [];
            const registrationPromises = tools.map(tool => 
                firstValueFrom(this.registerTool(tool, providerId, channelId))
                    .then(success => {
                        if (success) {
                            registeredTools.push(tool.name);
                        }
                        return success;
                    })
                    .catch(error => {
                        this.logger.warn(`Failed to register tool ${tool.name}: ${error}`);
                        return false;
                    })
            );
            
            return from(Promise.all(registrationPromises)).pipe(
                map(() => {
                    return registeredTools;
                }),
                catchError(error => {
                    this.logger.error(`Error in bulk tool registration: ${error}`);
                    return of(registeredTools); // Return partial success
                })
            );
        } catch (error) {
            this.logger.error(`Failed to bulk register tools: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * Get an MCP tool by name
     * @param name Tool name
     * @returns Observable that emits the tool if found
     */
    public getTool(name: string): Observable<ExtendedMcpToolDefinition> {
        try {
            // Validate input
            validate.assertIsNonEmptyString(name, 'Tool name must be a non-empty string');
            
            // Ensure database is loaded
            if (!this.databaseLoaded) {
                return from(this.loadToolsFromDatabase()).pipe(
                    switchMap(() => this.getTool(name))
                );
            }
            
            // Check if tool exists in memory
            if (!this.tools.has(name)) {
                return throwError(() => new Error(`Tool with name ${name} does not exist`));
            }
            
            // Return the tool from memory
            return of(this.tools.get(name)!);
        } catch (error) {
            this.logger.error(`Failed to get tool: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * List all registered MCP tools
     * @param filter Optional filter pattern for tool names
     * @returns Observable that emits the list of tools
     */
    public listTools(filter?: string): Observable<ExtendedMcpToolDefinition[]> {
        try {
            // Ensure database is loaded
            if (!this.databaseLoaded) {
                return from(this.loadToolsFromDatabase()).pipe(
                    switchMap(() => this.listTools(filter))
                );
            }
            
            // Get internal tools
            const internalTools = Array.from(this.tools.values());
            
            // Get external tools from hybrid registry if available
            let allTools = internalTools;
            try {
                // Import ServerHybridMcpService dynamically to avoid circular dependencies
                const { ServerHybridMcpService } = require('./ServerHybridMcpService');
                const hybridService = ServerHybridMcpService.getInstance();
                const hybridRegistry = hybridService.getHybridRegistry();
                
                // Get external tools and convert them to ExtendedMcpToolDefinition format
                const externalTools = hybridRegistry.getExternalTools().map((tool: any) => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    handler: tool.handler,
                    enabled: tool.enabled,
                    metadata: tool.metadata || {},
                    providerId: 'external-mcp',
                    channelId: 'global'
                } as ExtendedMcpToolDefinition));
                
                // Combine internal and external tools
                allTools = [...internalTools, ...externalTools];
                
                //;
            } catch (error) {
                // If hybrid service is not available, just use internal tools
            }
            
            // Apply filter if provided
            if (filter) {
                const regex = new RegExp(filter, 'i');
                return of(allTools.filter(tool => regex.test(tool.name)));
            }
            
            return of(allTools);
        } catch (error) {
            this.logger.error(`Failed to list tools: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * Unregister an MCP tool by name
     * @param name Tool name
     * @returns Observable that emits true if the tool was unregistered successfully
     */
    public unregisterTool(name: string): Observable<boolean> {
        try {
            // Validate input
            validate.assertIsNonEmptyString(name, 'Tool name must be a non-empty string');
            
            // Check if tool exists
            if (!this.tools.has(name)) {
                return throwError(() => new Error(`Tool with name ${name} does not exist`));
            }
            
            // Remove from memory
            this.tools.delete(name);
            
            // Remove from database
            return from(deleteMcpTool(name)).pipe(
                map(() => {
                    // Log successful unregistration
                    
                    // Notify listeners that the registry has changed
                    this.notifyToolRegistryChanged();
                    
                    return true;
                }),
                catchError(error => {
                    this.logger.error(`Database error unregistering tool ${name}: ${error}`);
                    return throwError(() => error);
                })
            );
        } catch (error) {
            this.logger.error(`Failed to unregister tool: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * Update an existing MCP tool
     * @param name Tool name to update
     * @param updates Tool definition updates
     * @returns Observable that emits true if the tool was updated successfully
     */
    public updateTool(
        name: string, 
        updates: Partial<McpToolDefinition>
    ): Observable<boolean> {
        try {
            // Validate input
            validate.assertIsNonEmptyString(name, 'Tool name must be a non-empty string');
            validate.assertIsObject(updates, 'Tool updates must be an object');
            
            // Check if tool exists
            if (!this.tools.has(name)) {
                return throwError(() => new Error(`Tool with name ${name} does not exist`));
            }
            
            // Get the existing tool
            const existingTool = this.tools.get(name)!;
            
            // Merge updates with existing tool
            const updatedTool: ExtendedMcpToolDefinition = {
                ...existingTool,
                ...updates,
                // Preserve essential fields
                name: existingTool.name,
                providerId: existingTool.providerId
            };
            
            // Update in memory
            this.tools.set(name, updatedTool);
            
            // Update in database - extract only the fields supported by the database model
            return from(updateMcpTool(name, {
                description: updatedTool.description,
                metadata: updatedTool.metadata || {},
                updatedAt: new Date()
            })).pipe(
                map(() => {
                    // Log successful update
                    
                    // Notify listeners that the registry has changed
                    this.notifyToolRegistryChanged();
                    
                    return true;
                }),
                catchError(error => {
                    this.logger.error(`Database error updating tool ${name}: ${error}`);
                    
                    // Revert memory change if database update fails
                    this.tools.set(name, existingTool);
                    
                    return throwError(() => error);
                })
            );
        } catch (error) {
            this.logger.error(`Failed to update tool: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
}

// Export only the class - instances should be created via getInstance()
