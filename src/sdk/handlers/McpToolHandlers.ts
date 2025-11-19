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
 * MCP Tool Handlers
 * Handles tool-related MCP events
 */
import { Logger } from '../../shared/utils/Logger';
import { McpHandler } from './McpHandler';
import { createStrictValidator } from '../../shared/utils/validation';
import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import { MxfService, IInternalChannelService } from '../services/MxfService';
import { v4 as uuidv4 } from 'uuid';
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
} from '../../shared/schemas/EventPayloadSchema';

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
     * Register a tool with the MCP server
     * @param tool Tool definition to register
     * @param channelId Channel ID where the tool should be registered
     * @returns Promise resolving to success status
     */
    public registerTool = (tool: any, channelId: string): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            try {
                
                // Validate inputs
                this.validator.assertIsObject(tool);
                this.validator.assertIsNonEmptyString(tool.name);
                this.validator.assertIsNonEmptyString(tool.description);
                this.validator.assertIsObject(tool.inputSchema);
                this.validator.assertIsNonEmptyString(channelId);
                
                // Set up one-time handler for registration response
                const subscription = EventBus.client.on(Events.Mcp.TOOL_REGISTERED, (payload: McpToolRegisteredEventPayload): void => {
                    if (payload.data.toolName === tool.name) { 
                        // Remove one-time handler using the subscription
                        subscription.unsubscribe();
                        
                        if (payload.data.success) {
                            this.registeredTools.set(tool.name, tool);
                            resolve(true);
                        } else {
                            this.logger.error(`Failed to register tool ${tool.name}: ${payload.data.error || 'Unknown error'}`);
                            resolve(false);
                        }
                    }
                });
                
                // Send registration request using proper MCP payload helper
                const mcpDataForRegister: McpToolEventData & { registrationDetails: any } = {
                    toolName: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    registrationDetails: {
                        metadata: tool.metadata,
                        enabled: tool.enabled
                    }
                };
                
                // Use the proper MCP payload creation helper
                const registerPayload = createMcpToolRegisterPayload(
                    Events.Mcp.TOOL_REGISTER,
                    this.agentId,
                    channelId,
                    mcpDataForRegister
                );
                
                EventBus.client.emit(Events.Mcp.TOOL_REGISTER, registerPayload);
            } catch (error) {
                this.logger.error(`Error registering tool: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
        });
    };
    
    /**
     * Unregister a tool from the MCP server
     * @param name Tool name to unregister
     * @param channelId Channel ID where the tool is registered
     * @returns Promise resolving to success status
     */
    public unregisterTool = (name: string, channelId: string): Promise<boolean> => {
        return new Promise((resolve, reject) => {
            try {
                
                // Validate inputs
                this.validator.assertIsNonEmptyString(name);
                this.validator.assertIsNonEmptyString(channelId);
                
                // Set up one-time handler for unregistration response
                const subscription = EventBus.client.on(Events.Mcp.TOOL_UNREGISTERED, (payload: McpToolUnregisteredEventPayload): void => {
                    if (payload.data.toolName === name) { 
                        // Remove one-time handler using the subscription
                        subscription.unsubscribe();
                        
                        if (payload.data.success) {
                            this.registeredTools.delete(name);
                            resolve(true);
                        } else {
                            this.logger.error(`Failed to unregister tool ${name}: ${payload.data.error || 'Unknown error'}`);
                            resolve(false);
                        }
                    }
                });
                
                // Send unregistration request using proper MCP payload helper
                const mcpDataForUnregister: McpToolEventData = {
                    toolName: name
                };
                const unregisterPayload = createMcpToolUnregisterPayload(
                    Events.Mcp.TOOL_UNREGISTER,
                    this.agentId,
                    channelId,
                    mcpDataForUnregister
                );
                EventBus.client.emit(Events.Mcp.TOOL_UNREGISTER, unregisterPayload);
            } catch (error) {
                this.logger.error(`Error unregistering tool: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
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
                const requestId = `tool-call-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
                        
                        this.logger.error(`Tool call error for ${requestId}: ${payload.data.error}`);
                        reject(new Error(payload.data.error || 'Unknown tool call error'));
                    }
                });
                
                // Set up timeout handler (30 seconds for tool calls)
                timeoutId = setTimeout(() => {
                    cleanup();
                    this.logger.warn(`Tool call timeout for ${name} (${requestId}) after 30 seconds`);
                    reject(new Error(`Tool call timeout: ${name} did not respond within 30 seconds`));
                }, 30000);
                
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
                const requestId = `tool-list-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                
                
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
                EventBus.client.emit(Events.Mcp.TOOL_LIST, listPayload);
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
