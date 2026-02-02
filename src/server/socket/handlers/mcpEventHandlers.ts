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
 * MCP Event Handlers
 * 
 * This module provides EventBus event handlers for the Model Context Protocol (MCP).
 * It listens to EventBus events and processes MCP tool and resource operations.
 * NO direct socket access - all communications through EventBus.
 */

import { Socket } from 'socket.io';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Events } from '../../../shared/events/EventNames';
import { EventBus } from '../../../shared/events/EventBus';
import { McpSocketExecutor } from '../services/McpSocketExecutor';
import { v4 as uuidv4 } from 'uuid';
import {
    createMcpToolCallPayload,
    createMcpToolResultPayload,
    createMcpToolErrorPayload,
    createMcpResourceResultPayload,
    createMcpToolRegisteredPayload
} from '../../../shared/schemas/EventPayloadSchema';

// Constants
const MCP_TOOL_EXECUTION_TIMEOUT_MS = 30000; // 30 seconds timeout for tool execution

// Create logger
const logger = new Logger('debug', 'McpEventHandlers', 'server');

// Create validator
const validate = createStrictValidator('McpEventHandlers');

/**
 * Set up MCP event handlers for EventBus events
 * This function registers EventBus listeners for MCP events
 * @param agentId Agent ID associated with this socket
 * @param channelId Channel ID for the connection context
 */
export const setupMcpEventHandlers = (socket: Socket, agentId: string, channelId: string): void => {

    // Handle tool call events from EventBus
    // This per-agent handler is the primary executor for built-in tools (~95 tools).
    // The global handler in McpSocketExecutor.setupEventHandlers() only handles
    // dynamically registered tools (its this.tools guard drops built-in tool events).
    const toolCallHandler = (payload: any) => {
        try {

            // Validate this event is for this agent/channel
            if (payload.agentId !== agentId || payload.channelId !== channelId) {
                return; // Ignore events for other agents/channels
            }

            validate.assertIsObject(payload);
            validate.assertIsObject(payload.data);
            validate.assertIsNonEmptyString(payload.data.toolName);
            validate.assertIsNonEmptyString(payload.data.callId);


            // Get the tool executor and execute the tool
            const executor = McpSocketExecutor.getInstance();
            executor.executeTool(
                payload.data.toolName,
                payload.data.arguments || {},
                {
                    requestId: payload.data.callId,
                    agentId,
                    channelId
                }
            ).subscribe({
                next: (result) => {
                    // Emit tool result event through EventBus
                    EventBus.server.emit(Events.Mcp.TOOL_RESULT, createMcpToolResultPayload(
                        Events.Mcp.TOOL_RESULT,
                        agentId,
                        channelId,
                        {
                            toolName: payload.data.toolName,
                            callId: payload.data.callId,
                            result: result.content
                        }
                    ));
                },
                error: (error) => {
                    // Emit tool error event through EventBus
                    EventBus.server.emit(Events.Mcp.TOOL_ERROR, createMcpToolErrorPayload(
                        Events.Mcp.TOOL_ERROR,
                        agentId,
                        channelId,
                        {
                            toolName: payload.data.toolName,
                            callId: payload.data.callId,
                            error: error instanceof Error ? error.message : String(error)
                        }
                    ));
                }
            });

        } catch (error) {
            logger.error(`MCP tool call handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Handle tool registration events from EventBus
    const toolRegisterHandler = (payload: any) => {
        try {
            // Validate this event is for this agent/channel
            if (payload.agentId !== agentId || payload.channelId !== channelId) {
                return; // Ignore events for other agents/channels
            }

            // Validate payload structure
            validate.assertIsObject(payload);
            validate.assertIsObject(payload.data);
            validate.assertIsNonEmptyString(payload.data.toolName);
            validate.assertIsNonEmptyString(payload.data.description);
            validate.assertIsObject(payload.data.inputSchema);
            
            
            // Get the tool executor and register the tool
            const executor = McpSocketExecutor.getInstance();
            executor.registerTool(
                payload.data.toolName,
                payload.data.description,
                payload.data.inputSchema,
                async (input, context) => {
                    // Route tool execution back to the registering agent via EventBus
                    // This allows the actual tool implementation to be executed on the client side
                    
                    const callId = context.requestId || uuidv4();
                    
                    // Emit tool call event to the registering agent
                    EventBus.server.emit(Events.Mcp.TOOL_CALL, createMcpToolCallPayload(
                        Events.Mcp.TOOL_CALL,
                        agentId, // Route back to the agent that registered this tool
                        channelId,
                        {
                            toolName: payload.data.toolName,
                            callId: callId,
                            arguments: input
                        }
                    ));
                    
                    // Return a promise that resolves when we get the result back
                    return new Promise((resolve, reject) => {
                        // Set up one-time listeners for the result
                        const resultSubscription = EventBus.server.on(Events.Mcp.TOOL_RESULT, (resultPayload: any) => {
                            if (resultPayload.data.callId === callId) {
                                resultSubscription.unsubscribe();
                                errorSubscription.unsubscribe();
                                resolve(resultPayload.data.result);
                            }
                        });
                        
                        const errorSubscription = EventBus.server.on(Events.Mcp.TOOL_ERROR, (errorPayload: any) => {
                            if (errorPayload.data.callId === callId) {
                                resultSubscription.unsubscribe();
                                errorSubscription.unsubscribe();
                                reject(new Error(errorPayload.data.error));
                            }
                        });
                        
                        // Timeout after MCP_TOOL_EXECUTION_TIMEOUT_MS
                        setTimeout(() => {
                            resultSubscription.unsubscribe();
                            errorSubscription.unsubscribe();
                            reject(new Error(`Tool execution timeout for ${payload.data.toolName}`));
                        }, MCP_TOOL_EXECUTION_TIMEOUT_MS);
                    });
                }
            ).subscribe({
                next: (success) => {
                    
                    // Emit success response back to client
                    EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createMcpToolRegisteredPayload(
                        Events.Mcp.TOOL_REGISTERED,
                        agentId,
                        channelId,
                        {
                            toolName: payload.data.toolName,
                            success: true
                        }
                    ));
                },
                error: (error) => {
                    // This is often expected when tool already exists from database loading
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    if (errorMsg.includes('already exists')) {
                        
                        // Emit success response since tool is already registered
                        EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createMcpToolRegisteredPayload(
                            Events.Mcp.TOOL_REGISTERED,
                            agentId,
                            channelId,
                            {
                                toolName: payload.data.toolName,
                                success: true
                            }
                        ));
                    } else {
                        logger.error(`MCP executor registration failed for ${payload.data.toolName}: ${errorMsg}`);
                        
                        // Emit error response back to client
                        EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createMcpToolRegisteredPayload(
                            Events.Mcp.TOOL_REGISTERED,
                            agentId,
                            channelId,
                            {
                                toolName: payload.data.toolName,
                                success: false,
                                error: errorMsg
                            }
                        ));
                    }
                }
            });
            
        } catch (error) {
            logger.error(`MCP tool registration handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Handle resource get events from EventBus
    const resourceGetHandler = (payload: any) => {
        try {
            // Validate this event is for this agent/channel
            if (payload.agentId !== agentId || payload.channelId !== channelId) {
                return; // Ignore events for other agents/channels
            }

            // Validate payload structure
            validate.assertIsObject(payload);
            validate.assertIsObject(payload.data);
            validate.assertIsNonEmptyString(payload.data.resourceUri);
            validate.assertIsNonEmptyString(payload.data.requestId);
            
            
            // Emit resource result (placeholder implementation)
            EventBus.server.emit(Events.Mcp.RESOURCE_RESULT, createMcpResourceResultPayload(
                Events.Mcp.RESOURCE_RESULT,
                agentId,
                channelId,
                {
                    resourceUri: payload.data.resourceUri,
                    requestId: payload.data.requestId,
                    data: { content: `Resource ${payload.data.resourceUri} content`, mimeType: 'text/plain' }
                }
            ));
            
        } catch (error) {
            logger.error(`MCP resource get handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Handle resource list events from EventBus
    const resourceListHandler = (payload: any) => {
        try {
            // Validate this event is for this agent/channel
            if (payload.agentId !== agentId || payload.channelId !== channelId) {
                return; // Ignore events for other agents/channels
            }

            // Validate payload structure
            validate.assertIsObject(payload);
            validate.assertIsObject(payload.data);
            validate.assertIsNonEmptyString(payload.data.requestId);
            
            
            // Emit resource list result (placeholder implementation)
            EventBus.server.emit(Events.Mcp.RESOURCE_LIST_RESULT, createMcpResourceResultPayload(
                Events.Mcp.RESOURCE_LIST_RESULT,
                agentId,
                channelId,
                {
                    resourceUri: 'list',
                    requestId: payload.data.requestId,
                    data: { resources: [] } // Empty list for now
                }
            ));
            
        } catch (error) {
            logger.error(`MCP resource list handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Register EventBus listeners
    EventBus.server.on(Events.Mcp.TOOL_CALL, toolCallHandler);
    EventBus.server.on(Events.Mcp.TOOL_REGISTER, toolRegisterHandler);
    EventBus.server.on(Events.Mcp.RESOURCE_GET, resourceGetHandler);
    EventBus.server.on(Events.Mcp.RESOURCE_LIST, resourceListHandler);
    
    // Handle disconnection - clean up EventBus handlers
    socket.on('disconnect', () => {
        
        // Remove EventBus listeners
        EventBus.server.off(Events.Mcp.TOOL_CALL, toolCallHandler);
        EventBus.server.off(Events.Mcp.TOOL_REGISTER, toolRegisterHandler);
        EventBus.server.off(Events.Mcp.RESOURCE_GET, resourceGetHandler);
        EventBus.server.off(Events.Mcp.RESOURCE_LIST, resourceListHandler);
    });
};
