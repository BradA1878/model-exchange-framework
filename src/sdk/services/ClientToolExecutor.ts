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
 * ClientToolExecutor
 *
 * SDK service that executes eligible tools locally in the client process,
 * eliminating the Socket.IO round-trip to the server for stateless tools.
 *
 * Tools must pass two gates to execute client-side:
 * 1. Registered in this executor's local registry (loaded via loadInternalTools)
 * 2. Listed in the ClientExecutableManifest allowlist
 *
 * After local execution, a fire-and-forget notification is sent to the server
 * via Socket.IO so the tool call is recorded in MongoDB for history/dashboard.
 */

import { Observable, firstValueFrom } from 'rxjs';
import { Logger } from '../../shared/utils/Logger';
import { createStrictValidator } from '../../shared/utils/validation';
import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import { isClientExecutable } from '../../shared/protocols/mcp/ClientExecutableManifest';
import {
    createMcpToolCallLocalPayload,
    createMcpToolResultLocalPayload,
    createMcpToolErrorLocalPayload,
    createMcpToolCallCompletedLocalPayload,
} from '../../shared/schemas/EventPayloadSchema';
import type { McpToolHandlerContext } from '../../shared/protocols/mcp/McpServerTypes';
import type { MxfService } from './MxfService';
import { dateTimeTools } from '../../shared/protocols/mcp/tools/DateTimeTools';

/** Source origin of a client-registered tool */
type ClientToolSource = 'internal' | 'external-mcp';

/** Minimal tool definition stored in the client registry */
interface ClientToolEntry {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    handler: (input: any, context: McpToolHandlerContext) => Promise<any> | Observable<any>;
    /** Whether this tool is an internal MXF tool or from an external MCP server */
    source: ClientToolSource;
}

export class ClientToolExecutor {
    /** Registry of tools available for local execution */
    private clientToolRegistry: Map<string, ClientToolEntry> = new Map();
    private logger: Logger;
    private validator = createStrictValidator('ClientToolExecutor');
    private enabled: boolean;
    private agentId: string;
    private channelId: string;
    private mxfService: MxfService;

    constructor(agentId: string, channelId: string, mxfService: MxfService, enabled: boolean) {
        this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

        this.agentId = agentId;
        this.channelId = channelId;
        this.mxfService = mxfService;
        this.enabled = enabled;
        this.logger = new Logger('info', 'ClientToolExecutor', 'client');
    }

    /**
     * Check if a tool can be executed client-side.
     * Returns true only if the executor is enabled, the tool is in the local registry,
     * and the tool is in the ClientExecutableManifest allowlist.
     */
    public canExecuteLocally(toolName: string): boolean {
        if (!this.enabled) return false;
        if (!this.clientToolRegistry.has(toolName)) return false;
        if (!isClientExecutable(toolName)) return false;
        return true;
    }

    /**
     * Execute a tool locally in the SDK process.
     * Emits observability events on EventBus.client and sends a fire-and-forget
     * completion notification to the server for DB history recording.
     *
     * @param toolName - Name of the tool to execute
     * @param input - Tool input parameters
     * @param channelId - Channel context for the execution
     * @returns The tool result (extracted from MCP format if applicable)
     */
    public async executeLocally(toolName: string, input: any, channelId: string): Promise<any> {
        this.validator.assertIsNonEmptyString(toolName, 'toolName is required');

        const tool = this.clientToolRegistry.get(toolName);
        if (!tool) {
            throw new Error(`Tool '${toolName}' not found in client tool registry`);
        }

        const callId = `tool-local-${crypto.randomUUID()}`;

        // Emit local call event for observability
        EventBus.client.emit(
            Events.Mcp.TOOL_CALL_LOCAL,
            createMcpToolCallLocalPayload(
                Events.Mcp.TOOL_CALL_LOCAL,
                this.agentId,
                channelId,
                { toolName, callId, arguments: input }
            )
        );

        const startTime = Date.now();

        try {
            // Build handler context
            const context: McpToolHandlerContext = {
                requestId: callId,
                agentId: this.agentId,
                channelId: channelId,
            };

            // Execute handler — handle both Promise and Observable return types
            let rawResult: any;
            const handlerReturn = tool.handler(input || {}, context);
            if (handlerReturn instanceof Observable) {
                rawResult = await firstValueFrom(handlerReturn);
            } else {
                rawResult = await handlerReturn;
            }

            const durationMs = Date.now() - startTime;

            // Extract result data — handlers may return MCP format {content: {type, data}} or raw data
            let result: any;
            if (rawResult && typeof rawResult === 'object' && 'content' in rawResult) {
                const content = rawResult.content;
                if (content && typeof content === 'object' && 'type' in content && 'data' in content) {
                    result = content.data;
                } else {
                    result = content;
                }
            } else {
                // Raw result from handler (DateTime tools return plain objects)
                result = rawResult;
            }

            this.logger.debug(`[local] ${toolName} completed in ${durationMs}ms`);

            // Emit local result event for observability
            EventBus.client.emit(
                Events.Mcp.TOOL_RESULT_LOCAL,
                createMcpToolResultLocalPayload(
                    Events.Mcp.TOOL_RESULT_LOCAL,
                    this.agentId,
                    channelId,
                    { toolName, callId, result, durationMs }
                )
            );

            // Fire-and-forget notification to server for DB history recording
            this.notifyServerOfCompletion(callId, toolName, input, result, durationMs, channelId, tool.source);

            return result;

        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.logger.error(`[local] ${toolName} failed after ${durationMs}ms: ${errorMessage}`);

            // Emit local error event for observability
            EventBus.client.emit(
                Events.Mcp.TOOL_ERROR_LOCAL,
                createMcpToolErrorLocalPayload(
                    Events.Mcp.TOOL_ERROR_LOCAL,
                    this.agentId,
                    channelId,
                    { toolName, callId, error: errorMessage }
                )
            );

            throw error;
        }
    }

    /**
     * Load stateless internal tools into the client registry.
     * Only tools that appear in the ClientExecutableManifest are loaded.
     */
    public loadInternalTools(): void {
        let loaded = 0;
        for (const tool of dateTimeTools) {
            if (isClientExecutable(tool.name)) {
                this.clientToolRegistry.set(tool.name, {
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    handler: tool.handler,
                    source: 'internal',
                });
                loaded++;
            }
        }

        this.logger.info(`Loaded ${loaded} internal tools for client-side execution`);
    }

    /**
     * Register an external MCP tool for local execution.
     * Called by ClientExternalMcpManager when external MCP servers discover tools.
     */
    public registerExternalTool(
        name: string,
        handler: (input: any, context: McpToolHandlerContext) => Promise<any>,
        inputSchema: Record<string, any>,
        description: string
    ): void {
        this.validator.assertIsNonEmptyString(name, 'tool name is required');

        this.clientToolRegistry.set(name, {
            name,
            description,
            inputSchema,
            handler,
            source: 'external-mcp',
        });

        this.logger.debug(`Registered external tool for client execution: ${name}`);
    }

    /**
     * Get the number of tools available for local execution.
     */
    public getLocalToolCount(): number {
        return this.clientToolRegistry.size;
    }

    /**
     * Get names of all locally registered tools.
     */
    public getLocalToolNames(): string[] {
        return Array.from(this.clientToolRegistry.keys());
    }

    /**
     * Clean up the client tool registry and release resources.
     */
    public cleanup(): void {
        this.clientToolRegistry.clear();
        this.logger.debug('Client tool registry cleared');
    }

    /**
     * Send a fire-and-forget notification to the server so the tool call
     * is recorded in MongoDB for history, debugging, and dashboard visibility.
     * The SDK does NOT wait for acknowledgment — the next LLM turn proceeds immediately.
     */
    private notifyServerOfCompletion(
        callId: string,
        toolName: string,
        input: any,
        result: any,
        durationMs: number,
        channelId: string,
        source: 'internal' | 'external-mcp'
    ): void {
        try {
            this.mxfService.socketEmit(
                Events.Mcp.TOOL_CALL_COMPLETED_LOCAL,
                createMcpToolCallCompletedLocalPayload(
                    Events.Mcp.TOOL_CALL_COMPLETED_LOCAL,
                    this.agentId,
                    channelId,
                    {
                        callId,
                        toolName,
                        input,
                        result,
                        durationMs,
                        source,
                        executedOn: 'client',
                    }
                )
            );
        } catch (error) {
            // Non-critical — log but don't propagate. Tool result is already returned to the LLM.
            this.logger.warn(`Failed to notify server of local tool completion: ${error}`);
        }
    }
}
