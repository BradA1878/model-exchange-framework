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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * MCP Socket Executor Service
 * 
 * This service handles the execution of MCP tools within the socket server context,
 * bridging the gap between the MCP protocol and the socket-based communication.
 */

import { Observable, from, of, throwError, firstValueFrom } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { checkResultSize } from '@mxf-dev/core/utils/ToolPaginationUtils';
import { McpToolHandlerContext, McpToolHandlerResult } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import { McpToolInput } from '@mxf-dev/core/protocols/mcp/IMcpClient';
import { Events } from '@mxf-dev/core/events/EventNames';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { validateToolInput, formatValidationError } from '@mxf-dev/core/protocols/mcp/McpToolSchema';
import { createMcpToolErrorPayload, createMcpToolResultPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { McpToolRegistry } from '../../api/services/McpToolRegistry';
import { getHybridMcpToolRegistry } from '../../mcp/services/HybridMcpRegistryAccess';
import { AutoCorrectionService } from '@mxf-dev/core/services/AutoCorrectionService';
import { normalizeOrparParameters } from '@mxf-dev/core/utils/ParameterNormalizer';
import { McpService } from './McpService';
import {
    isAllowedByAgentPolicy,
    isAllowedByChannelPolicy,
    isPrivilegedHostToolEnabled,
    isPrivilegedNetworkToolEnabled,
    UNSAFE_HOST_TOOLS_ENV,
    UNSAFE_NETWORK_TOOLS_ENV,
    ToolAuthorizationError
} from './ToolAuthorizationPolicy';

// Create validator for socket executor
const validator = createStrictValidator('McpSocketExecutor');

/**
 * The failure a tool reported inside its result, or null for a success.
 *
 * defineTool marks failure with `isError` and carries a ToolError's data
 * (`code`, `message`); the registry's wrapper for the older tools turns a
 * thrown error into content of type 'error' whose data is the message.
 */
const describeToolResultFailure = (result: McpToolHandlerResult & { isError?: boolean }): string | null => {
    const content = result.content as { type?: unknown; data?: unknown } | undefined;
    const data = content?.data;
    const asText = (): string => (typeof data === 'string' ? data : JSON.stringify(data));
    if (result.isError === true) {
        if (data && typeof data === 'object') {
            const { code, message } = data as { code?: unknown; message?: unknown };
            if (typeof message === 'string') {
                return typeof code === 'string' ? `${code}: ${message}` : message;
            }
        }
        return asText();
    }
    if (content?.type === 'error' || result.metadata?.error === true) {
        return asText();
    }
    return null;
};

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
        providerId: string;
        channelId: string;
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
        // McpToolRegistry is the sole authority for TOOL_UNREGISTER requests.
        // This executor only mirrors a successful authoritative result; handling
        // the request here as well used to let this independent map acknowledge
        // or delete a tool before registry ownership was checked.
        EventBus.server.on(
            Events.Mcp.TOOL_UNREGISTERED,
            (payload) => {
                validateMcpEventPayload(payload, Events.Mcp.TOOL_UNREGISTERED);
                if (!payload.data?.success || !payload.data?.toolName) {
                    return;
                }

                const mirroredTool = this.tools.get(payload.data.toolName);
                if (!mirroredTool) {
                    return;
                }
                if (mirroredTool.providerId !== payload.agentId ||
                    mirroredTool.channelId !== payload.channelId) {
                    this.logger.error(
                        `Ignoring TOOL_UNREGISTERED mirror cleanup for ${payload.data.toolName}: ` +
                        `event owner does not match the executor mirror owner`
                    );
                    return;
                }

                this.tools.delete(payload.data.toolName);
            }
        );
        
        // Handle tool execution requests
        EventBus.server.on(
            Events.Mcp.TOOL_CALL,
            async (payload): Promise<void> => {
                validateMcpEventPayload(payload, Events.Mcp.TOOL_CALL);
                // Create context
                const context: McpToolHandlerContext = {
                    requestId: payload.data.callId,
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    authorization: payload.authorization,
                    data: {}
                };

                try {
                    // Return one Promise covering the observable so EventBus.drain()
                    // owns the tool and its terminal event through shutdown.
                    const result = await firstValueFrom(
                        this.executeTool(payload.data.toolName, payload.data.arguments, context)
                    );
                    // A handler reports failure inside its result — defineTool's isError
                    // envelope, or the registry's wrapper for a thrown error — and only
                    // `content` crosses the socket. Answer a failed tool with TOOL_ERROR so
                    // the SDK rejects the call, the way it does for a throw here. Forwarded
                    // as a result, the failure passed for a success and a rejected
                    // task_complete ended the agent's turn with the task still open.
                    const failure = describeToolResultFailure(result);
                    if (failure !== null) {
                        this.logger.error(`Tool ${payload.data.toolName} failed: ${failure}`);
                        EventBus.server.emit(Events.Mcp.TOOL_ERROR, createMcpToolErrorPayload(
                            Events.Mcp.TOOL_ERROR,
                            payload.agentId,
                            payload.channelId,
                            {
                                toolName: payload.data.toolName,
                                callId: payload.data.callId,
                                error: failure
                            }
                        ));
                        return;
                    }
                    EventBus.server.emit(Events.Mcp.TOOL_RESULT, createMcpToolResultPayload(
                        Events.Mcp.TOOL_RESULT,
                        payload.agentId,
                        payload.channelId,
                        {
                            toolName: payload.data.toolName,
                            callId: payload.data.callId,
                            result: result.content
                        }
                    ));
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    this.logger.error(`Tool execution error for ${payload.data.toolName}: ${errorMessage}`);

                    EventBus.server.emit(Events.Mcp.TOOL_ERROR, createMcpToolErrorPayload(
                        Events.Mcp.TOOL_ERROR,
                        payload.agentId,
                        payload.channelId,
                        {
                            toolName: payload.data.toolName,
                            callId: payload.data.callId,
                            error: errorMessage
                        }
                    ));
                }
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
        inputSchema: Record<string, unknown>,
        handler: (input: McpToolInput, context: McpToolHandlerContext) => Promise<McpToolHandlerResult>,
        providerId: string,
        channelId: string
    ): Observable<boolean> {
        try {
            // Validate inputs
            validator.assertIsNonEmptyString(name);
            validator.assertIsNonEmptyString(description);
            validator.assertIsObject(inputSchema);
            validator.assertIsFunction(handler);
            validator.assertIsNonEmptyString(providerId);
            validator.assertIsNonEmptyString(channelId);
            
            // Check if tool already exists
            if (this.tools.has(name)) {
                const existingTool = this.tools.get(name)!;
                if (existingTool.providerId === providerId && existingTool.channelId === channelId) {
                    return throwError(() => new Error(`Tool with name ${name} already exists for this owner`));
                }
                return throwError(() => new Error(`Tool with name ${name} is registered by another owner`));
            }
            
            // Register the tool
            this.tools.set(name, {
                name,
                description,
                inputSchema,
                handler,
                enabled: true,
                providerId,
                channelId
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
    public unregisterTool(name: string, providerId: string, channelId: string): Observable<boolean> {
        try {
            // Validate input
            validator.assertIsNonEmptyString(name);
            validator.assertIsNonEmptyString(providerId);
            validator.assertIsNonEmptyString(channelId);
            
            // Check if tool exists
            if (!this.tools.has(name)) {
                return throwError(() => new Error(`Tool with name ${name} does not exist`));
            }

            const existingTool = this.tools.get(name)!;
            if (existingTool.providerId !== providerId || existingTool.channelId !== channelId) {
                return throwError(() => new Error(
                    `Tool with name ${name} is not owned by this agent in this channel`
                ));
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

            // Resolve the requested name through the hybrid registry, channel-scoped.
            // Agents call external tools by their raw name (the only name their
            // allowlists and LLM function lists carry); the registry stores them
            // under the namespaced canonical name. Both must authorize and execute.
            const hybridRegistry = getHybridMcpToolRegistry();
            const resolvedExternal = hybridRegistry?.resolveToolForChannel(
                toolName,
                context.channelId as string,
                context.agentId as string
            );
            const acceptedNames = new Set<string>([toolName]);
            if (resolvedExternal) {
                acceptedNames.add(resolvedExternal.name);
                if (resolvedExternal.externalToolName) {
                    acceptedNames.add(resolvedExternal.externalToolName);
                }
            }

            // Authorization is scoped to the exact validated credential that
            // initiated this request. AgentService is keyed only by agentId and
            // therefore cannot safely carry policy when the same logical agent
            // has keys in multiple channels.
            const credentialPolicy = context.authorization;
            if (!credentialPolicy ||
                typeof credentialPolicy.keyId !== 'string' ||
                credentialPolicy.keyId.trim().length === 0 ||
                (credentialPolicy.allowedTools !== undefined &&
                    !Array.isArray(credentialPolicy.allowedTools))) {
                return throwError(() => new ToolAuthorizationError(
                    'A validated credential-scoped tool policy is required for execution'
                ));
            }

            if (!isAllowedByAgentPolicy(acceptedNames, credentialPolicy.allowedTools)) {
                return throwError(() => new ToolAuthorizationError(
                    `Tool '${toolName}' is not authorized for agent '${context.agentId}'`
                ));
            }

            if (!isPrivilegedHostToolEnabled(acceptedNames)) {
                return throwError(() => new ToolAuthorizationError(
                    `Tool '${toolName}' is a privileged host capability and requires ` +
                    `${UNSAFE_HOST_TOOLS_ENV}=true`
                ));
            }

            if (!isPrivilegedNetworkToolEnabled(acceptedNames)) {
                return throwError(() => new ToolAuthorizationError(
                    `Tool '${toolName}' is a privileged network capability and requires ` +
                    `${UNSAFE_NETWORK_TOOLS_ENV}=true`
                ));
            }

            const channelAllowedTools = McpService.getInstance().getChannelAllowedTools(
                context.channelId as string
            );
            if (channelAllowedTools === undefined) {
                return throwError(() => new ToolAuthorizationError(
                    `Tool policy for channel '${context.channelId}' has not been loaded`
                ));
            }
            if (!isAllowedByChannelPolicy(acceptedNames, channelAllowedTools)) {
                return throwError(() => new ToolAuthorizationError(
                    `Tool '${toolName}' is not authorized in channel '${context.channelId}'`
                ));
            }

            // Get the tool from the registry
            const toolObservable = McpToolRegistry.getInstance().listToolsForChannel(
                context.channelId as string,
                undefined,
                context.agentId as string
            );

            // Check if tool exists
            return toolObservable.pipe(
                mergeMap(tools => {
                    // Exact match first, then the channel-scoped resolution: the
                    // canonical entry carries the handler that routes to the
                    // external server.
                    const tool = tools.find(t => t.name === toolName)
                        ?? (resolvedExternal ? tools.find(t => t.name === resolvedExternal.name) ?? resolvedExternal : undefined);
                    if (!tool) {
                        return throwError(() => new Error(`Tool with name ${toolName} does not exist`));
                    }
                    
                    // Check if tool is enabled
                    if (!tool.enabled) {
                        return throwError(() => new Error(`Tool ${toolName} is disabled`));
                    }

                    // Normalize parameter names before validation (handles LLM variations)
                    // This maps common mistakes like 'reasoning' -> 'analysis' for ORPAR tools
                    const normalizedInput = normalizeOrparParameters(toolName, input);

                    // Default inputConfig for confirm-type user_input (all confirm config fields are optional,
                    // so LLMs naturally omit the entire object — inject empty object to pass validation)
                    if (toolName === 'user_input' && normalizedInput.inputType === 'confirm' && !normalizedInput.inputConfig) {
                        normalizedInput.inputConfig = {};
                    }

                    // Validate input against schema with detailed error reporting
                    const validationResult = validateToolInput(tool.inputSchema, normalizedInput);
                    if (!validationResult.valid) {
                        const errorMessage = formatValidationError(validationResult, toolName, tool.inputSchema, normalizedInput);
                        this.logger.error(`Tool validation failed:\n${errorMessage}`);

                        // Attempt auto-correction before failing
                        return from(this.autoCorrectionService.attemptCorrection(
                            context.agentId as string,  // Already validated above
                            context.channelId as string,  // Already validated above
                            toolName,
                            normalizedInput,
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
                    return of({ tool, correctedInput: validationResult.coercedInput || normalizedInput });
                    
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
                        map(result => {
                            // Apply size checking to the result content for LLM feedback
                            // This adds pagination hints for large results
                            if (result.content && typeof result.content === 'object') {
                                const checkedContent = checkResultSize(result.content, toolName, this.logger);
                                return { ...result, content: checkedContent };
                            }
                            return result;
                        }),
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
     * List MCP tools visible to an authenticated agent/channel context.
     * @param channelId Channel in which the tools will be used
     * @param agentId Authenticated requesting agent
     * @param filter Optional filter pattern for tool names
     * @returns Observable that emits the list of visible tools
     */
    public listTools(channelId: string, agentId: string, filter?: string): Observable<Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
    }>> {
        try {
            validator.assertIsNonEmptyString(channelId);
            validator.assertIsNonEmptyString(agentId);

            const allToolsObservable = McpToolRegistry.getInstance().listToolsForChannel(
                channelId,
                undefined,
                agentId
            );
            
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
