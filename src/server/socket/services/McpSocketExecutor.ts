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
 * MCP Socket Executor Service
 * 
 * This service handles the execution of MCP tools within the socket server context,
 * bridging the gap between the MCP protocol and the socket-based communication.
 */

import { Observable, from, of, throwError, firstValueFrom } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { McpToolHandlerContext, McpToolHandlerResult } from '../../../shared/protocols/mcp/McpServerTypes';
import { Events } from '../../../shared/events/EventNames';
import { EventBus } from '../../../shared/events/EventBus';
import { validateToolInput, formatValidationError } from '../../../shared/protocols/mcp/McpToolSchema';
import { createBaseEventPayload, createMcpToolCallPayload, createMcpToolErrorPayload, createMcpToolResultPayload, createMcpToolRegisterPayload } from '../../../shared/schemas/EventPayloadSchema';
import { McpToolRegistry, ExtendedMcpToolDefinition } from '../../api/services/McpToolRegistry';
import { v4 as uuidv4 } from 'uuid';
import { AutoCorrectionService } from '../../../shared/services/AutoCorrectionService';

// Create validator for socket executor
const validator = createStrictValidator('McpSocketExecutor');

/**
 * Validates that event payload has required agentId and channelId
 * @param payload Event payload to validate
 * @param eventType Event type for error context
 */
const validateMcpEventPayload = (payload: any, eventType: string): void => {
    if (!payload) {
        throw new Error(`[McpSocketExecutor] Missing payload for ${eventType} event`);
    }
    
    if (!payload.agentId || typeof payload.agentId !== 'string') {
        throw new Error(`[McpSocketExecutor] Missing or invalid agentId in ${eventType} event. agentId is required for all MCP operations.`);
    }
    
    if (!payload.channelId || typeof payload.channelId !== 'string') {
        throw new Error(`[McpSocketExecutor] Missing or invalid channelId in ${eventType} event. channelId is required for all MCP operations.`);
    }
};

/**
 * MCP Socket Executor Service
 * 
 * This service handles the execution of MCP tools within the socket server context,
 * bridging the gap between the MCP protocol and the socket-based communication.
 */
export class McpSocketExecutor {
    private static instance: McpSocketExecutor | null = null;
    
    // Map of registered tools by name
    private tools: Map<string, {
        name: string;
        description: string;
        inputSchema: Record<string, any>;
        handler: (input: any, context: McpToolHandlerContext) => Promise<McpToolHandlerResult>;
        enabled: boolean;
    }> = new Map();
    
    // Map of ongoing tool executions by request ID
    private executions: Map<string, { 
        toolName: string; 
        startTime: number;
        channelId: string;
        agentId: string;
    }> = new Map();
    
    // Logger for socket executor
    private logger: Logger;
    
    // Auto-correction service
    private autoCorrectionService: AutoCorrectionService;
    
    /**
     * Create a new MCP Socket Executor (private constructor for singleton)
     */
    private constructor() {
        this.logger = new Logger('info', 'McpSocketExecutor', 'server');
        this.autoCorrectionService = AutoCorrectionService.getInstance();
        this.setupEventHandlers();
    }

    /**
     * Get the singleton instance of McpSocketExecutor
     * @returns The singleton instance
     */
    public static getInstance(): McpSocketExecutor {
        if (!McpSocketExecutor.instance) {
            McpSocketExecutor.instance = new McpSocketExecutor();
        }
        return McpSocketExecutor.instance;
    }
    
    /**
     * Set up event handlers for socket executor events
     */
    private setupEventHandlers(): void {
        // Handle tool registration
        EventBus.server.on(
            Events.Mcp.TOOL_REGISTER,
            (payload) => {
                validateMcpEventPayload(payload, Events.Mcp.TOOL_REGISTER);
                
                // Check if the tool already exists in the registry
                const existingTool = this.tools.get(payload.data.toolName);
                if (existingTool) {
                    // Tool already exists - just acknowledge agent's capability to use it
                    
                    // Emit success event
                    EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createBaseEventPayload(
                        Events.Mcp.TOOL_REGISTERED,
                        payload.agentId,
                        payload.channelId,
                        {
                            name: payload.data.toolName,
                            success: true
                        }
                    ));
                    return;
                }

                // Tool doesn't exist - register it with the implementation provided
                this.registerTool(
                    payload.data.toolName,
                    payload.data.description,
                    payload.data.inputSchema,
                    async (input, context) => {
                        // This tool handler should directly execute functionality
                        // NOT emit TOOL_CALL events to avoid infinite loops
                        
                        
                        // For registered tools, we need to delegate to the actual MCP tool execution
                        // This should be handled by looking up and executing the actual tool implementation
                        throw new Error(`Tool '${payload.data.toolName}' was registered but has no implementation. This tool should be handled by MCP tool providers.`);
                    }
                ).subscribe({
                    next: (success) => {
                        EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_REGISTERED,
                            payload.agentId,
                            payload.channelId,
                            {
                                name: payload.data.toolName,
                                success
                            }
                        ));
                    },
                    error: (error) => {
                        this.logger.error(`Failed to register tool ${payload.data.toolName}: ${error}`);
                        EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_REGISTERED,
                            payload.agentId,
                            payload.channelId,
                            {
                                name: payload.data.toolName,
                                success: false
                            }
                        ));
                    }
                });
            }
        );
        
        // Handle tool unregistration
        EventBus.server.on(
            Events.Mcp.TOOL_UNREGISTER,
            (payload) => {
                validateMcpEventPayload(payload, Events.Mcp.TOOL_UNREGISTER);
                
                this.unregisterTool(payload.data.toolName).subscribe({
                    next: (success) => {
                        EventBus.server.emit(Events.Mcp.TOOL_UNREGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_UNREGISTERED,
                            payload.agentId,
                            payload.channelId,
                            {
                                name: payload.data.toolName,
                                success
                            }
                        ));
                    },
                    error: (error) => {
                        this.logger.error(`Failed to unregister tool ${payload.data.toolName}: ${error}`);
                        EventBus.server.emit(Events.Mcp.TOOL_UNREGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_UNREGISTERED,
                            payload.agentId,
                            payload.channelId,
                            {
                                name: payload.data.toolName,
                                success: false
                            }
                        ));
                    }
                });
            }
        );
        
        // Handle tool execution requests
        EventBus.server.on(
            Events.Mcp.TOOL_CALL,
            (payload) => {
                validateMcpEventPayload(payload, Events.Mcp.TOOL_CALL);
                
                
                // Only handle executions from the socket context
                if (!this.tools.has(payload.data.toolName)) {
                    return;
                }
                
                // Create context
                const context: McpToolHandlerContext = {
                    requestId: payload.data.callId,
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    data: {}
                };
                
                // Execute the tool
                this.executeTool(payload.data.toolName, payload.data.arguments, context).subscribe({
                    next: (result) => {
                        EventBus.server.emit(Events.Mcp.TOOL_RESULT, createMcpToolResultPayload(
                            Events.Mcp.TOOL_RESULT,
                            payload.agentId,
                            payload.channelId,
                            {
                                toolName: payload.data.toolName,
                                callId: payload.requestId,
                                result: result.content
                            }
                        ));
                    },
                    error: (error) => {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        this.logger.error(`Tool execution error for ${payload.name}: ${errorMessage}`);
                        
                        EventBus.server.emit(Events.Mcp.TOOL_ERROR, createMcpToolErrorPayload(
                            Events.Mcp.TOOL_ERROR,
                            payload.agentId,
                            payload.channelId,
                            {
                                toolName: payload.name,
                                callId: payload.requestId,
                                error: errorMessage
                            }
                        ));
                    }
                });
            }
        );
        
        // Handle tool list requests
        EventBus.server.on(
            Events.Mcp.TOOL_LIST,
            (payload) => {
                validateMcpEventPayload(payload, Events.Mcp.TOOL_LIST);
                
                this.listTools(payload.data?.filter).subscribe({
                    next: (tools) => {
                        EventBus.server.emit(Events.Mcp.TOOL_LIST_RESULT, createBaseEventPayload(
                            Events.Mcp.TOOL_LIST_RESULT,
                            payload.agentId,
                            payload.channelId,
                            {
                                tools: tools.map(tool => ({
                                    name: tool.name,
                                    description: tool.description,
                                    inputSchema: tool.inputSchema
                                }))
                            }
                        ));
                    },
                    error: (error) => {
                        this.logger.error(`Failed to list tools: ${error}`);
                        EventBus.server.emit(Events.Mcp.TOOL_LIST_RESULT, createBaseEventPayload(
                            Events.Mcp.TOOL_LIST_RESULT,
                            payload.agentId,
                            payload.channelId,
                            {
                                tools: []
                            }
                        ));
                    }
                });
            }
        );
    }
    
    /**
     * Register a new MCP tool
     * @param name Tool name
     * @param description Tool description
     * @param inputSchema Tool input schema
     * @param handler Tool handler function
     * @returns Observable that emits true if the tool was registered successfully
     */
    public registerTool(
        name: string,
        description: string,
        inputSchema: Record<string, any>,
        handler: (input: any, context: McpToolHandlerContext) => Promise<McpToolHandlerResult>
    ): Observable<boolean> {
        try {
            // Validate inputs
            validator.assertIsNonEmptyString(name);
            validator.assertIsNonEmptyString(description);
            validator.assertIsObject(inputSchema);
            validator.assertIsFunction(handler);
            
            // Check if tool already exists
            if (this.tools.has(name)) {
                return throwError(() => new Error(`Tool with name ${name} already exists`));
            }
            
            // Register the tool
            this.tools.set(name, {
                name,
                description,
                inputSchema,
                handler,
                enabled: true
            });
            
            
            return of(true);
        } catch (error) {
            this.logger.error(`Failed to register tool: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * Unregister an MCP tool
     * @param name Tool name
     * @returns Observable that emits true if the tool was unregistered successfully
     */
    public unregisterTool(name: string): Observable<boolean> {
        try {
            // Validate input
            validator.assertIsNonEmptyString(name);
            
            // Check if tool exists
            if (!this.tools.has(name)) {
                return throwError(() => new Error(`Tool with name ${name} does not exist`));
            }
            
            // Unregister the tool
            this.tools.delete(name);
            
            
            return of(true);
        } catch (error) {
            this.logger.error(`Failed to unregister tool: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * Execute an MCP tool
     * @param toolName Name of the tool to execute
     * @param input Tool input parameters
     * @param context Tool execution context
     * @returns Observable that emits the tool execution result
     */
    public executeTool(
        toolName: string, 
        input: Record<string, any>, 
        context: McpToolHandlerContext
    ): Observable<McpToolHandlerResult> {
        try {
            // Validate inputs
            validator.assertIsNonEmptyString(toolName);
            validator.assertIsObject(input);
            validator.assertIsObject(context);
            validator.assertIsNonEmptyString(context.requestId);
            validator.assertIsNonEmptyString(context.agentId);
            validator.assertIsNonEmptyString(context.channelId);
            
            // Get the tool from the registry
            const toolObservable = McpToolRegistry.getInstance().listTools();
            
            // Check if tool exists
            return toolObservable.pipe(
                mergeMap(tools => {
                    const tool = tools.find(t => t.name === toolName);
                    if (!tool) {
                        return throwError(() => new Error(`Tool with name ${toolName} does not exist`));
                    }
                    
                    // Check if tool is enabled
                    if (!tool.enabled) {
                        return throwError(() => new Error(`Tool ${toolName} is disabled`));
                    }
                    
                    // Validate input against schema with detailed error reporting
                    const validationResult = validateToolInput(tool.inputSchema, input);
                    if (!validationResult.valid) {
                        const errorMessage = formatValidationError(validationResult, toolName, tool.inputSchema, input);
                        this.logger.error(`Tool validation failed:\n${errorMessage}`);
                        
                        // Attempt auto-correction before failing
                        return from(this.autoCorrectionService.attemptCorrection(
                            context.agentId as string,  // Already validated above
                            context.channelId as string,  // Already validated above
                            toolName,
                            input,
                            errorMessage,
                            tool.inputSchema
                        )).pipe(
                            mergeMap(correctionResult => {
                                if (correctionResult.corrected && correctionResult.correctedParameters) {
                                    
                                    // Re-validate the corrected parameters
                                    const correctedValidationResult = validateToolInput(tool.inputSchema, correctionResult.correctedParameters);
                                    if (correctedValidationResult.valid) {
                                        // Use the corrected parameters
                                        input = correctionResult.correctedParameters;
                                        
                                        // Continue with the corrected input by returning an observable that continues the flow
                                        return of({ tool, correctedInput: correctionResult.correctedParameters });
                                    } else {
                                        // Corrected parameters still invalid
                                        const correctedErrorMessage = formatValidationError(correctedValidationResult, toolName, tool.inputSchema, correctionResult.correctedParameters);
                                        this.logger.error(`Auto-corrected parameters still invalid:\n${correctedErrorMessage}`);
                                        return throwError(() => new Error(errorMessage));
                                    }
                                } else {
                                    // Auto-correction failed
                                    return throwError(() => new Error(errorMessage));
                                }
                            }),
                            catchError(correctionError => {
                                this.logger.error(`Auto-correction error: ${correctionError}`);
                                return throwError(() => new Error(errorMessage));
                            })
                        );
                    }
                    
                    // Validation passed, use coerced input (handles LLM type errors like "true" → true)
                    return of({ tool, correctedInput: validationResult.coercedInput || input });
                    
                }),
                mergeMap(({ tool, correctedInput }) => {
                    // Track execution - agentId and channelId are guaranteed to exist after validation
                    this.executions.set(context.requestId, {
                        toolName,
                        startTime: Date.now(),
                        channelId: context.channelId as string,
                        agentId: context.agentId as string
                    });

                    // Log execution
                    this.logger.info(`🔧 Tool called: "${toolName}" by Agent: ${context.agentId}`);

                    // Execute the tool handler with the potentially corrected input
                    return from(tool.handler(correctedInput, context)).pipe(
                        tap(result => {
                            // Log successful result
                            // Remove from tracking on success
                            this.executions.delete(context.requestId);
                        }),
                        catchError(error => {
                            // Log error
                            this.logger.error(`[MCP EXECUTOR ERROR] Tool ${toolName} failed, requestId: ${context.requestId}, error: ${error}`);
                            // Remove from tracking on error
                            this.executions.delete(context.requestId);
                            return throwError(() => error);
                        })
                    );
                })
            );
        } catch (error) {
            // Clean up on validation error
            if (context && context.requestId) {
                this.executions.delete(context.requestId);
            }
            return throwError(() => error);
        }
    }
    
    /**
     * Cancel a tool execution
     * @param requestId Request ID to cancel
     * @returns Observable that emits true if the execution was canceled
     */
    public cancelExecution(requestId: string): Observable<boolean> {
        try {
            // Validate input
            validator.assertIsNonEmptyString(requestId);
            
            // Check if execution exists
            const executionDetails = this.executions.get(requestId);
            if (!executionDetails) {
                return throwError(() => new Error(`No execution found with requestId ${requestId}`));
            }
            
            // Validate agentId and channelId
            if (!executionDetails.agentId || !executionDetails.channelId) {
                return throwError(() => new Error(`Invalid execution details for requestId ${requestId}`));
            }
            
            // Remove from tracking
            this.executions.delete(requestId);
            
            // Log cancellation
            
            // Emit cancellation event
            EventBus.server.emit(
                Events.Mcp.TOOL_ERROR, 
                createMcpToolErrorPayload(
                    Events.Mcp.TOOL_ERROR,
                    executionDetails.agentId,
                    executionDetails.channelId,
                    {
                        toolName: executionDetails.toolName,
                        callId: requestId,
                        error: 'Execution canceled'
                    }
                )
            );
            
            return of(true);
        } catch (error) {
            return throwError(() => error);
        }
    }
    
    /**
     * List all registered MCP tools
     * @param filter Optional filter pattern for tool names
     * @returns Observable that emits the list of tools
     */
    public listTools(filter?: string): Observable<Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
    }>> {
        try {
            // Get all tools
            const allToolsObservable = McpToolRegistry.getInstance().listTools();
            
            // Apply filter if provided
            return allToolsObservable.pipe(
                map(allTools => {
                    const filteredTools = filter
                        ? allTools.filter(tool => 
                            tool.name.includes(filter) || 
                            tool.description.includes(filter))
                        : allTools;
                        
                    return filteredTools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema
                    }));
                })
            );
        } catch (error) {
            this.logger.error(`Failed to list tools: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * Get tool by name
     * @param name Tool name
     * @returns Observable that emits the tool if found
     */
    public getTool(name: string): Observable<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
    }> {
        try {
            // Validate input
            validator.assertIsNonEmptyString(name);
            
            // Check if tool exists
            const toolObservable = McpToolRegistry.getInstance().listTools();
            
            return toolObservable.pipe(
                mergeMap(tools => {
                    const tool = tools.find(t => t.name === name);
                    if (!tool) {
                        return throwError(() => new Error(`Tool with name ${name} does not exist`));
                    }
                    
                    // Check if tool is enabled
                    if (!tool.enabled) {
                        return throwError(() => new Error(`Tool ${name} is disabled`));
                    }
                    
                    return of({
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema
                    });
                })
            );
        } catch (error) {
            this.logger.error(`Failed to get tool: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }
    
    /**
     * Get active tool executions
     * @returns Array of active executions
     */
    public getActiveExecutions(): Array<{
        requestId: string;
        toolName: string;
        startTime: number;
        runTime: number;
        channelId: string;
        agentId: string;
    }> {
        const now = Date.now();
        
        return Array.from(this.executions.entries()).map(([requestId, execution]) => ({
            requestId,
            toolName: execution.toolName,
            startTime: execution.startTime,
            runTime: now - execution.startTime,
            channelId: execution.channelId,
            agentId: execution.agentId
        }));
    }

    /**
     * List registered MCP tools
     * @returns Promise that resolves to array of registered tools
     */
    public async listRegisteredTools(): Promise<Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
    }>> {
        try {
            // Get tools from registry using listTools method
            const tools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
            return tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            }));
        } catch (error) {
            this.logger.error(`Failed to list registered tools: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
}
