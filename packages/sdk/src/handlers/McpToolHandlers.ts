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
 * MCP Tool Handlers
 * Handles tool-related MCP events
 */
import { Logger } from '@mxf-dev/core/utils/Logger';
import { McpHandler } from './McpHandler.js';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { MxfService, IInternalChannelService } from '../services/MxfService.js';
import { v4 as uuidv4 } from 'uuid';
import { awaitEventResponse, EventRequestError } from '../services/internal/EventRequest.js';
import {
    BaseEventPayload,
    McpToolRegisteredEventPayload,
    McpToolUnregisteredEventPayload,
    McpToolCallEventPayload,
    McpToolResultEventPayload,
    McpToolErrorEventPayload,
    McpToolEventData,
    createBaseEventPayload,
    createMcpToolRegisterPayload,
    createMcpToolUnregisterPayload,
    createMcpToolCallPayload,
    createMcpToolResultPayload,
    createMcpToolErrorPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';

/** How long to wait for the server to answer a tool register/unregister request. */
const TOOL_REGISTRATION_TIMEOUT_MS = 30_000;

/**
 * Handles MCP tool events for provider and consumer agents
 */
export class McpToolHandlers extends McpHandler {
    private agentId: string;
    private channelId: string;
    private mxfService: IInternalChannelService;
    private registeredTools: Map<string, any> = new Map(); // Tools registered by this client
    private serverTools: Map<string, any> = new Map(); // Tools discovered from server
    private resultCallbacks: Map<string, (result: any) => void> = new Map();
    private errorCallbacks: Map<string, (error: any) => void> = new Map();
    protected validator = createStrictValidator('McpToolHandlers');
    
    // Store subscriptions for proper cleanup
    private subscriptions: { unsubscribe: () => void }[] = [];
    
    /**
     * Create a new MCP tool handler
     * @param agentId Agent ID that owns this handler
     */
    constructor(
        channelId: string, 
        agentId: string,
        mxfService: IInternalChannelService
    ) {
        super(`McpToolHandlers:${agentId}`);
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assert(!!mxfService, 'MxfService instance is required');
        
        this.channelId = channelId;
        this.agentId = agentId;
        this.mxfService = mxfService;
    }
    
    /**
     * Register a tool with the MCP server.
     *
     * @param tool Tool definition to register
     * @param channelId Channel ID where the tool should be registered
     * @returns Promise that resolves once the server has accepted the tool
     * @throws EventRequestError if the server rejects the registration
     * @throws EventRequestTimeoutError if the server does not answer
     */
    public registerTool = async (tool: any, channelId: string): Promise<void> => {
        this.validator.assertIsObject(tool);
        this.validator.assertIsNonEmptyString(tool.name);
        this.validator.assertIsNonEmptyString(tool.description);
        this.validator.assertIsObject(tool.inputSchema);
        this.validator.assertIsNonEmptyString(channelId);

        const mcpDataForRegister: McpToolEventData & { registrationDetails: any } = {
            toolName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            registrationDetails: {
                metadata: tool.metadata,
                enabled: tool.enabled
            }
        };

        await awaitEventResponse<void>({
            emitEvent: Events.Mcp.TOOL_REGISTER,
            payload: createMcpToolRegisterPayload(
                Events.Mcp.TOOL_REGISTER,
                this.agentId,
                channelId,
                mcpDataForRegister
            ),
            route: { via: 'agent', agentId: this.agentId },
            successEvent: Events.Mcp.TOOL_REGISTERED,
            correlate: (payload: McpToolRegisteredEventPayload) => payload?.data?.toolName === tool.name,
            mapResult: (payload: McpToolRegisteredEventPayload) => {
                // The server answers on TOOL_REGISTERED even when it refused the tool,
                // so success:false has to become a rejection here. It used to resolve
                // `false` and the caller had no idea why.
                if (!payload.data.success) {
                    throw new EventRequestError(
                        payload.data.error || `Failed to register tool '${tool.name}'`,
                        Events.Mcp.TOOL_REGISTERED,
                        payload
                    );
                }
                this.registeredTools.set(tool.name, tool);
            },
            timeoutMs: TOOL_REGISTRATION_TIMEOUT_MS,
            description: `Tool registration for '${tool.name}'`,
            logger: this.logger,
        });
    };

    /**
     * Unregister a tool from the MCP server.
     *
     * @param name Tool name to unregister
     * @param channelId Channel ID where the tool is registered
     * @returns Promise that resolves once the server has removed the tool
     * @throws EventRequestError if the server rejects the request
     * @throws EventRequestTimeoutError if the server does not answer
     */
    public unregisterTool = async (name: string, channelId: string): Promise<void> => {
        this.validator.assertIsNonEmptyString(name);
        this.validator.assertIsNonEmptyString(channelId);

        const mcpDataForUnregister: McpToolEventData = { toolName: name };

        await awaitEventResponse<void>({
            emitEvent: Events.Mcp.TOOL_UNREGISTER,
            payload: createMcpToolUnregisterPayload(
                Events.Mcp.TOOL_UNREGISTER,
                this.agentId,
                channelId,
                mcpDataForUnregister
            ),
            route: { via: 'agent', agentId: this.agentId },
            successEvent: Events.Mcp.TOOL_UNREGISTERED,
            correlate: (payload: McpToolUnregisteredEventPayload) => payload?.data?.toolName === name,
            mapResult: (payload: McpToolUnregisteredEventPayload) => {
                if (!payload.data.success) {
                    throw new EventRequestError(
                        payload.data.error || `Failed to unregister tool '${name}'`,
                        Events.Mcp.TOOL_UNREGISTERED,
                        payload
                    );
                }
                this.registeredTools.delete(name);
            },
            timeoutMs: TOOL_REGISTRATION_TIMEOUT_MS,
            description: `Tool unregistration for '${name}'`,
            logger: this.logger,
        });
    };
    
    /**
     * Call a tool and handle result
     * @param name Tool name to call
     * @param input Input parameters for the tool
     * @param channelId Channel ID where to call the tool
     * @returns Promise resolving to the tool result
     */
    public callTool = (name: string, input: any, channelId: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            try {
                // Generate request ID
                const requestId = `tool-call-${uuidv4()}`;
                const toolName = name;
                
                // Validate inputs
                this.validator.assertIsNonEmptyString(name);
                this.validator.assertIsObject(input);
                this.validator.assertIsNonEmptyString(channelId);
                
                let timeoutId: NodeJS.Timeout;
                
                // Clean up function
                const cleanup = (): void => {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (resultSubscription) resultSubscription.unsubscribe();
                    if (errorSubscription) errorSubscription.unsubscribe();
                };
                
                // Set up result handler
                const resultSubscription = EventBus.client.on(Events.Mcp.TOOL_RESULT, (payload: McpToolResultEventPayload): void => {
                    if (payload.data.callId === requestId) {
                        // Clean up handlers using subscriptions
                        cleanup();


                        // Extract data from MCP result format
                        const result = payload.data.result;

                        // If result has type and data fields (MCP format), extract the data
                        if (result && typeof result === 'object' && 'type' in result && 'data' in result) {
                            resolve(result.data);
                        } else {
                            // Legacy format or direct data
                            resolve(result);
                        }
                    }
                });
                
                // Set up error handler
                const errorSubscription = EventBus.client.on(Events.Mcp.TOOL_ERROR, (payload: McpToolErrorEventPayload): void => {
                    if (payload.data.callId === requestId) { 
                        // Clean up handlers using subscriptions
                        cleanup();
                        
                        this.logger.debug(`Tool call error for ${requestId}: ${payload.data.error}`);
                        reject(new Error(payload.data.error || 'Unknown tool call error'));
                    }
                });
                
                // Interactive tools (user_input, request_user_input) block on human
                // response and can take minutes. Use a 10-minute timeout for these;
                // standard tools get the default 30-second timeout.
                const INTERACTIVE_TOOLS = ['user_input', 'request_user_input'];
                const timeoutMs = INTERACTIVE_TOOLS.includes(name) ? 600_000 : 30_000;

                timeoutId = setTimeout(() => {
                    cleanup();
                    this.logger.warn(`Tool call timeout for ${name} (${requestId}) after ${timeoutMs / 1000} seconds`);
                    reject(new Error(`Tool call timeout: ${name} did not respond within ${timeoutMs / 1000} seconds`));
                }, timeoutMs);
                
                // Send tool call request using proper MCP payload helper
                const mcpDataForCall: McpToolEventData & { callId: string; arguments: any } = {
                    toolName: name,
                    callId: requestId, // The existing requestId serves as the callId
                    arguments: input
                };
                const callPayload = createMcpToolCallPayload(
                    Events.Mcp.TOOL_CALL,
                    this.agentId,
                    channelId, // Use the method parameter channelId
                    mcpDataForCall
                );
                this.mxfService.socketEmit(Events.Mcp.TOOL_CALL, callPayload); // Revert previous change and use mxfService.socketEmit for proper server routing
            } catch (error) {
                this.logger.error(`Error calling tool: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
        });
    };
    
    /**
     * List available tools from the MCP server
     * @param filter Optional filter for tools
     * @param channelId Channel ID to list tools from
     * @returns Promise resolving to array of tool definitions
     */
    private listTools = (filter: string | undefined, channelId: string): Promise<any[]> => {
        return new Promise((resolve, reject) => {
            try {
                // Generate request ID
                const requestId = `tool-list-${uuidv4()}`;
                
                
                // Validate inputs
                this.validator.assertIsNonEmptyString(channelId);
                
                // Set up result handler - Listen for TOOL_LIST_RESULT event
                const resultSubscription = EventBus.client.on(Events.Mcp.TOOL_LIST_RESULT, (payload: any): void => {
                    // TOOL_LIST_RESULT events have tools array directly in payload.data.tools
                    // No need to check callId since this is a broadcast-style response
                    try {
                        // Clean up handlers and timeout
                        clearTimeout(timeoutHandle);
                        resultSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        
                        // Extract tools from the payload data
                        const tools = payload.data?.tools || [];
                        
                        // Update the serverTools map with the received tools
                        tools.forEach((tool: any) => {
                            this.serverTools.set(tool.name, tool);
                        });
                        
                        resolve(tools);
                    } catch (parseError) {
                        this.logger.error(`Error parsing tool list response: ${parseError}`);
                        reject(parseError);
                    }
                });
                
                // Set up error handler - Listen for TOOL_LIST_ERROR event  
                const errorSubscription = EventBus.client.on(Events.Mcp.TOOL_LIST_ERROR, (payload: any): void => {
                    try {
                        // Clean up handlers and timeout
                        clearTimeout(timeoutHandle);
                        resultSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        
                        const errorMessage = payload.data?.error || 'Unknown tool list error';
                        this.logger.error(`Tool list error for requestId ${requestId}: ${errorMessage}`);
                        reject(new Error(errorMessage));
                    } catch (parseError) {
                        this.logger.error(`Error parsing tool list error response: ${parseError}`);
                        reject(parseError);
                    }
                });
                
                // Add timeout mechanism to prevent indefinite waiting
                const timeoutHandle = setTimeout(() => {
                    resultSubscription.unsubscribe();
                    errorSubscription.unsubscribe();
                    
                    const errorMessage = `Tool list request timed out after 10 seconds for requestId ${requestId}`;
                    this.logger.error(errorMessage);
                    reject(new Error(errorMessage));
                }, 10000); // 10 second timeout
                
                // Send tool list request using schema-defined structure
                const mcpDataForList = {
                    filter: filter, // Use the schema-defined structure
                    requestId: requestId // Add requestId for server-side processing
                };
                const listPayload = createBaseEventPayload(
                    Events.Mcp.TOOL_LIST,
                    this.agentId,
                    channelId,
                    mcpDataForList
                );
                EventBus.client.emitOn(this.agentId,Events.Mcp.TOOL_LIST, listPayload);
            } catch (error) {
                this.logger.error(`Error listing tools: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
        });
    };
    
    /**
     * Clean up tool event handlers
     */
    public cleanup(): void {
        
        // Unsubscribe from all event subscriptions
        this.subscriptions.forEach(subscription => subscription.unsubscribe());
        this.subscriptions = [];
        
        this.registeredTools.clear();
        this.serverTools.clear();
        this.resultCallbacks.clear();
        this.errorCallbacks.clear();
        
    }
    
    /**
     * Get a registered tool by name
     * @param name Tool name
     * @returns Tool definition or undefined if not found
     */
    private getTool = (name: string): any | undefined => {
        return this.registeredTools.get(name);
    };
    
    /**
     * Get all registered tools
     * @returns Array of tool definitions
     */
    private getRegisteredTools = (): any[] => {
        return Array.from(this.registeredTools.values());
    };
    
    /**
     * Get a server tool by name
     * @param name Tool name
     * @returns Tool definition or undefined if not found
     */
    private getServerTool = (name: string): any | undefined => {
        return this.serverTools.get(name);
    };
    
    /**
     * Get all server tools
     * @returns Array of tool definitions
     */
    private getServerTools = (): any[] => {
        return Array.from(this.serverTools.values());
    };
}
