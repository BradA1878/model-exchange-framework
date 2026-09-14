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
import { map, mergeMap, catchError } from 'rxjs/operators';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { checkResultSize } from '@mxf-dev/core/utils/ToolPaginationUtils';
import { McpToolHandlerContext, McpToolHandlerResult, getMcpToolResultData } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
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
import { ToolExecutionPersistenceService } from '../../services/ToolExecutionPersistenceService';
import {
    isAllowedByAgentPolicy,
    isAllowedByChannelPolicy,
    isPrivilegedHostToolEnabled,
    isPrivilegedNetworkToolEnabled,
    UNSAFE_HOST_TOOLS_ENV,
    UNSAFE_NETWORK_TOOLS_ENV,
    ToolAuthorizationError
} from './ToolAuthorizationPolicy';

/** Cancellation settles the request; tool handlers may still have side effects. */
class ToolExecutionCancelledError extends Error {}

interface AdmittedExecution {
    toolName: string;
    startTime: number;
    channelId: string;
    agentId: string;
    context: McpToolHandlerContext;
    start: Promise<void>;
    resolve: (result: McpToolHandlerResult) => void;
    reject: (error: Error) => void;
    cancelled: boolean;
    terminal?: Promise<Error | undefined>;
}

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
    if (Array.isArray(result.content)) {
        if (result.isError !== true) return null;
        const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        return text || JSON.stringify(result.content);
    }
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
    private executions = new Map<string, AdmittedExecution>();

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
                    llmRequestId: payload.requestId,
                    activationId: payload.activationId,
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
                            },
                            { requestId: context.llmRequestId, activationId: context.activationId }
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
                            result: getMcpToolResultData(result)
                        },
                        { requestId: context.llmRequestId, activationId: context.activationId }
                    ));
                } catch (error) {
                    // cancelExecution owns the cancellation event. Its terminal
                    // write and the original request share the same outcome.
                    if (error instanceof ToolExecutionCancelledError) return;
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
                        },
                        { requestId: context.llmRequestId, activationId: context.activationId }
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

            if (!isPrivilegedHostToolEnabled(acceptedNames, resolvedExternal, context.agentId)) {
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

                        // Operator-disabled correction returns the original schema
                        // error without invoking correction or pattern learning.
                        if (!this.autoCorrectionService.getConfig().enabled) {
                            return throwError(() => new Error(errorMessage));
                        }

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
                                        return of({
                                            tool,
                                            correctedInput: correctedValidationResult.coercedInput ?? correctionResult.correctedParameters
                                        });
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
                mergeMap(({ tool, correctedInput }) => from(this.executeAdmittedTool(
                    toolName,
                    correctedInput,
                    context,
                    tool.handler,
                    resolvedExternal?.isExternal ? resolvedExternal.source : undefined
                )))
            );
        } catch (error) {
            // A rejected call never owns another execution's tracking entry.
            return throwError(() => error);
        }
    }
    
    /**
     * Own one admitted operation through its audit writes and terminal outcome.
     * Rejections above this boundary never create an execution record.
     */
    private async executeAdmittedTool(
        toolName: string,
        input: Record<string, unknown>,
        context: McpToolHandlerContext,
        handler: (input: McpToolInput, context: McpToolHandlerContext) => Promise<McpToolHandlerResult> | Observable<McpToolHandlerResult>,
        serverId?: string
    ): Promise<McpToolHandlerResult> {
        if (this.executions.has(context.requestId)) {
            throw new Error(`An execution already exists with requestId ${context.requestId}`);
        }
        // Keep terminal ownership separate from the context handed to a tool.
        // A handler may annotate its copy, but cannot retarget audit/cancellation.
        const executionContext = { ...context };
        let resolve!: AdmittedExecution['resolve'];
        let reject!: AdmittedExecution['reject'];
        const result = new Promise<McpToolHandlerResult>((accept, fail) => {
            resolve = accept;
            reject = fail;
        });
        const execution: AdmittedExecution = {
            toolName,
            startTime: Date.now(),
            agentId: executionContext.agentId!,
            channelId: executionContext.channelId!,
            context: executionContext,
            // Defer the write until this operation owns its tracking entry.
            start: Promise.resolve().then(() => ToolExecutionPersistenceService.getInstance().recordToolCallStart(
                executionContext.requestId,
                toolName,
                serverId ? 'external' : 'internal',
                input,
                {
                    agentId: executionContext.agentId,
                    channelId: executionContext.channelId,
                    serverId,
                    metadata: {
                        requestId: executionContext.llmRequestId,
                        activationId: executionContext.activationId
                    }
                }
            )),
            resolve,
            reject,
            cancelled: false
        };
        this.executions.set(executionContext.requestId, execution);

        // The request waits for the worker unless cancellation settles it first.
        // Terminal ownership prevents a late handler from changing that outcome.
        const run = async (): Promise<void> => {
            try {
                await execution.start;
                if (execution.terminal) return;
                this.logger.info(`Tool called: "${toolName}" by Agent: ${executionContext.agentId}`);
                const handled = await firstValueFrom(from(handler(input, { ...executionContext })));
                if (execution.terminal) return;
                const checked = handled.content && typeof handled.content === 'object' && !Array.isArray(handled.content)
                    ? { ...handled, content: checkResultSize(handled.content, toolName, this.logger) }
                    : handled;
                await this.finishExecution(execution, checked);
            } catch (error) {
                await this.finishExecution(execution, undefined, error instanceof Error ? error : new Error(String(error)));
            }
        };
        void run();
        return result;
    }

    /** Claim exactly one terminal write before any asynchronous persistence. */
    private finishExecution(
        execution: AdmittedExecution,
        result?: McpToolHandlerResult,
        error?: Error
    ): Promise<Error | undefined> {
        if (execution.terminal) return execution.terminal;
        execution.terminal = (async (): Promise<Error | undefined> => {
            let failure = error;
            try {
                await execution.start;
                const persistence = ToolExecutionPersistenceService.getInstance();
                const reportedFailure = error?.message ?? (result ? describeToolResultFailure(result) : null);
                if (reportedFailure !== null) {
                    await persistence.recordToolCallError(execution.context.requestId, reportedFailure);
                } else {
                    await persistence.recordToolCallComplete(execution.context.requestId, result ? getMcpToolResultData(result) : undefined, result?.metadata);
                }
            } catch (auditError) {
                failure = new Error(`Tool execution audit failed: ${auditError instanceof Error ? auditError.message : String(auditError)}`);
                this.logger.error(failure.message);
            }
            if (this.executions.get(execution.context.requestId) === execution) {
                this.executions.delete(execution.context.requestId);
            }
            if (execution.cancelled) {
                execution.reject(new ToolExecutionCancelledError(failure?.message ?? 'Execution canceled'));
            } else if (failure) {
                execution.reject(failure);
            } else {
                execution.resolve(result!);
            }
            return failure;
        })();
        return execution.terminal;
    }

    /**
     * Settle a request as cancelled and retain that terminal audit outcome.
     * Handlers do not accept an abort signal, so their side effects may continue;
     * any late result or failure is observed but cannot publish another outcome.
     */
    public cancelExecution(requestId: string): Observable<boolean> {
        try {
            validator.assertIsNonEmptyString(requestId);
            const execution = this.executions.get(requestId);
            if (!execution || execution.terminal) {
                return throwError(() => new Error(`No execution found with requestId ${requestId}`));
            }
            execution.cancelled = true;
            const cancellation = new ToolExecutionCancelledError('Execution canceled');
            return from(this.finishExecution(execution, undefined, cancellation).then((failure): boolean => {
                EventBus.server.emit(
                    Events.Mcp.TOOL_ERROR,
                    createMcpToolErrorPayload(
                        Events.Mcp.TOOL_ERROR,
                        execution.agentId,
                        execution.channelId,
                        {
                            toolName: execution.toolName,
                            callId: requestId,
                            error: failure?.message ?? cancellation.message
                        },
                        { requestId: execution.context.llmRequestId, activationId: execution.context.activationId }
                    )
                );
                if (failure && failure !== cancellation) throw failure;
                return true;
            }));
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
