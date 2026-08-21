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
 * MCP Event Handlers
 * 
 * This module provides EventBus event handlers for the Model Context Protocol (MCP).
 * It listens to EventBus events and processes MCP tool and resource operations.
 * NO direct socket access - all communications through EventBus.
 */

import { Socket } from 'socket.io';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { CoreSocketEvents, Events } from '@mxf-dev/core/events/EventNames';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import {
    createMcpResourceErrorPayload,
    McpToolCallCompletedLocalData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { McpToolExecution } from '@mxf-dev/core/models/mcpToolExecution';

// Create logger
const logger = new Logger('debug', 'McpEventHandlers', 'server');

// Create validator
const validate = createStrictValidator('McpEventHandlers');

const requireRecord = (value: unknown): Record<string, unknown> => {
    validate.assertIsObject(value);
    return value as Record<string, unknown>;
};

const requireNonEmptyString = (value: unknown): string => {
    validate.assertIsNonEmptyString(value);
    return value as string;
};

const requireNonNegativeNumber = (value: unknown, name: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a finite non-negative number`);
    }
    return value;
};

/**
 * Set up MCP event handlers for EventBus events
 * This function registers EventBus listeners for MCP events
 * @param agentId Agent ID associated with this socket
 * @param channelId Channel ID for the connection context
 */
export const setupMcpEventHandlers = (socket: Socket, agentId: string, channelId: string): void => {

    // Handle resource get events from EventBus
    const resourceGetHandler = (payload: unknown): void => {
        try {
            const event = requireRecord(payload);
            // Validate this event is for this agent/channel
            if (event.agentId !== agentId || event.channelId !== channelId) {
                return; // Ignore events for other agents/channels
            }

            const data = requireRecord(event.data);
            const resourceUri = requireNonEmptyString(data.resourceUri);
            const requestId = requireNonEmptyString(data.requestId);
            EventBus.server.emit(Events.Mcp.RESOURCE_ERROR, createMcpResourceErrorPayload(
                Events.Mcp.RESOURCE_ERROR,
                agentId,
                channelId,
                {
                    resourceUri,
                    requestId,
                    error: {
                        code: 'MCP_RESOURCE_PROVIDER_UNAVAILABLE',
                        message: 'MCP resource retrieval is unavailable because no authoritative resource provider is configured'
                    }
                }
            ));
            
        } catch (error) {
            logger.error(`MCP resource get handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Handle resource list events from EventBus
    const resourceListHandler = (payload: unknown): void => {
        try {
            const event = requireRecord(payload);
            // Validate this event is for this agent/channel
            if (event.agentId !== agentId || event.channelId !== channelId) {
                return; // Ignore events for other agents/channels
            }

            const data = requireRecord(event.data);
            const requestId = requireNonEmptyString(data.requestId);
            EventBus.server.emit(Events.Mcp.RESOURCE_ERROR, createMcpResourceErrorPayload(
                Events.Mcp.RESOURCE_ERROR,
                agentId,
                channelId,
                {
                    resourceUri: 'list',
                    requestId,
                    error: {
                        code: 'MCP_RESOURCE_PROVIDER_UNAVAILABLE',
                        message: 'MCP resource listing is unavailable because no authoritative resource provider is configured'
                    }
                }
            ));
            
        } catch (error) {
            logger.error(`MCP resource list handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Handle client-side tool completion events — persist to MongoDB for history/dashboard.
    // The SDK fires these after executing a tool locally (no server round-trip for execution,
    // but the completion event is sent so the DB has a complete record).
    const toolCallCompletedLocalHandler = (payload: unknown): void => {
        try {
            const event = requireRecord(payload);

            // Validate this event is for this agent/channel
            if (event.agentId !== agentId || event.channelId !== channelId) {
                return;
            }
            const eventData = requireRecord(event.data);
            const timestamp = requireNonNegativeNumber(event.timestamp, 'timestamp');
            const durationMs = requireNonNegativeNumber(eventData.durationMs, 'durationMs');
            const sourceType = requireNonEmptyString(eventData.source);
            if (sourceType !== 'internal' && sourceType !== 'external-mcp') {
                throw new Error('source must be internal or external-mcp');
            }
            const data: McpToolCallCompletedLocalData = {
                callId: requireNonEmptyString(eventData.callId),
                toolName: requireNonEmptyString(eventData.toolName),
                input: eventData.input,
                result: eventData.result,
                durationMs,
                source: sourceType,
                executedOn: 'client'
            };

            // Determine source type for the DB record
            const source = data.source === 'external-mcp' ? 'client-external' : 'client-internal';

            // Persist to MongoDB — fire-and-forget, no ack back to client
            McpToolExecution.create({
                requestId: data.callId,
                toolName: data.toolName,
                source,
                agentId,
                channelId,
                parameters: data.input || {},
                result: data.result,
                status: 'completed',
                startedAt: new Date(timestamp - data.durationMs),
                completedAt: new Date(timestamp),
                durationMs: data.durationMs,
                metadata: {
                    executedOn: 'client',
                }
            }).catch((error: Error) => {
                logger.warn(`Failed to persist client-executed tool call: ${error.message}`);
            });

        } catch (error) {
            logger.error(`Client tool completion handler error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Register EventBus listeners
    EventBus.server.on(Events.Mcp.RESOURCE_GET, resourceGetHandler);
    EventBus.server.on(Events.Mcp.RESOURCE_LIST, resourceListHandler);

    // Listen for client-side tool completions arriving via socket.
    // The socket event is forwarded to EventBus.server so the handler above picks it up.
    socket.on(Events.Mcp.TOOL_CALL_COMPLETED_LOCAL, (payload: unknown): void => {
        try {
            // Inject agentId/channelId from the authenticated socket context.
            const event = requireRecord(payload);
            toolCallCompletedLocalHandler({ ...event, agentId, channelId });
        } catch (error) {
            logger.error(`Client tool completion socket payload error: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // Register EventBus handler for client-side completions (for internal server-side forwarding)
    EventBus.server.on(Events.Mcp.TOOL_CALL_COMPLETED_LOCAL, toolCallCompletedLocalHandler);

    // Handle disconnection - clean up EventBus handlers
    socket.on(CoreSocketEvents.DISCONNECT, (): void => {

        // Remove EventBus listeners
        EventBus.server.off(Events.Mcp.RESOURCE_GET, resourceGetHandler);
        EventBus.server.off(Events.Mcp.RESOURCE_LIST, resourceListHandler);
        EventBus.server.off(Events.Mcp.TOOL_CALL_COMPLETED_LOCAL, toolCallCompletedLocalHandler);
    });
};
