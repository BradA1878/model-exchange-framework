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
 * MCP Tool Registry Service
 * 
 * This service manages MCP tools registration and discovery within the MXF.
 * It follows the provider-agnostic implementation of the Model Context Protocol.
 */

import { Observable, of, throwError, from, firstValueFrom } from 'rxjs';
import { map, mergeMap, catchError, switchMap } from 'rxjs/operators';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    getToolAuthorizationNames,
    isAllowedByAgentPolicy,
    isPrivilegedHostToolEnabled,
    isPrivilegedNetworkToolEnabled
} from '../../socket/services/ToolAuthorizationPolicy';
import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import { Events } from '@mxf-dev/core/events/EventNames';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { createMcpTool, findMcpToolByName, updateMcpTool, deleteMcpTool, listAllMcpTools } from '@mxf-dev/core/models/mcpTool';
import { createMcpToolRegistryChangedPayload, createBaseEventPayload, createMcpToolCallPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { mxfMcpToolRegistry } from '../../mcp/tools/index';
import { McpToolDocumentationService } from '@mxf-dev/core/services/McpToolDocumentationService';

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
 * Minimal external-tool shape accepted from the hybrid registry.
 * Scope is mandatory so a channel tool can never be treated as global merely
 * because a composition caller omitted context.
 */
export interface ExternalToolProviderEntry extends Pick<
    ExtendedMcpToolDefinition,
    'name' | 'description' | 'inputSchema' | 'handler' | 'enabled' | 'metadata'
> {
    source: string;
    scope: 'global' | 'channel' | 'agent';
    scopeId?: string;
    canonicalName?: string;
    externalToolName?: string;
}

/**
 * MCP Tool Registry Service
 * 
 * This service manages the registration and listing of MCP tools
 * in a provider-agnostic way.
 */
export class McpToolRegistry {
    /**
     * Late-bound supplier of external (hybrid) tools. Registered by
     * ServerHybridMcpService so neither class imports the other.
     */
    private externalToolsProvider: (() => ReadonlyArray<ExternalToolProviderEntry>) | null = null;

    public registerExternalToolsProvider(provider: () => ReadonlyArray<ExternalToolProviderEntry>): void {
        this.externalToolsProvider = provider;
    }

    /** Detach the hybrid provider during service shutdown. */
    public clearExternalToolsProvider(): void {
        this.externalToolsProvider = null;
    }

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

                // Convert database model to tool definition.
                //
                // Code is the source of truth for everything the model sees. The
                // description and the inputSchema are both prompt surface, and
                // serving one from the database and the other from code let them
                // drift apart within a single tool: an edited description did
                // nothing until the collection was wiped, while the schema updated
                // immediately. reconcileTools() writes both back to the database on
                // startup, so a code-defined tool is read from code here.
                const toolDef: ExtendedMcpToolDefinition = {
                    name: tool.name,
                    description: mxfTool?.description ?? tool.description ?? '',
                    inputSchema: mxfTool?.inputSchema ?? {},
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
                                ...context.data,
                                // Trusted execution identity and credential policy
                                // are layered last. Optional context data must never
                                // override the principal established at transport.
                                agentId: context.agentId,
                                channelId: context.channelId,
                                requestId: context.requestId,
                                authorization: context.authorization
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
                        // A tool row in the database with no code handler is a tool
                        // that cannot run here. The old code emitted TOOL_CALL and
                        // returned the string 'Tool execution routed to agent' as the
                        // tool RESULT — indistinguishable, to the caller and to the
                        // model, from a real result. Nothing consumed the event and
                        // no result ever came back.
                        //
                        // Fail instead, and say why. Rows like this are left over from
                        // tools that were removed from code; reconcileTools() prunes
                        // them on startup.
                        if (!context.agentId || typeof context.agentId !== 'string') {
                            throw new Error('Missing or invalid agentId in tool execution context. agentId is required for all MCP operations.');
                        }
                        if (!context.channelId || typeof context.channelId !== 'string') {
                            throw new Error('Missing or invalid channelId in tool execution context. channelId is required for all MCP operations.');
                        }

                        this.logger.error(
                            `Tool "${tool.name}" is registered in the database but has no handler in code. ` +
                            `It cannot be executed.`
                        );

                        throw new Error(
                            `Tool "${tool.name}" has no implementation on this server. ` +
                            `It exists in the tool database but no code defines it, so it cannot run.`
                        );
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

                // A socket payload contains metadata, not an executable handler.
                // The SDK currently has no authenticated inbound provider-call
                // protocol, so accepting this registration would persist an
                // always-throwing tool and report a false success. Keep one
                // authoritative response and fail closed until that protocol exists.
                const error =
                    'Dynamic socket tool registration is unavailable because provider invocation is not implemented';
                this.logger.warn(`Rejected dynamic tool registration ${providerId}/${channelId}/${toolName}: ${error}`);
                EventBus.server.emit(Events.Mcp.TOOL_REGISTERED, createBaseEventPayload(
                    Events.Mcp.TOOL_REGISTERED,
                    providerId,
                    channelId,
                    {
                        toolName,
                        success: false,
                        error
                    }
                ));
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

                if (!payload.agentId || typeof payload.agentId !== 'string' ||
                    !payload.channelId || typeof payload.channelId !== 'string') {
                    this.logger.error('agentId and channelId are required for MCP tool unregistration');
                    return;
                }

                this.unregisterToolForOwner(toolName, payload.agentId, payload.channelId).subscribe({
                    next: (success) => {
                        EventBus.server.emit(Events.Mcp.TOOL_UNREGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_UNREGISTERED,
                            payload.agentId,
                            payload.channelId,
                            {
                                toolName,
                                success
                            }
                        ));
                    },
                    error: (error) => {
                        this.logger.error(`Failed to unregister tool ${toolName}: ${error}`);
                        EventBus.server.emit(Events.Mcp.TOOL_UNREGISTERED, createBaseEventPayload(
                            Events.Mcp.TOOL_UNREGISTERED,
                            payload.agentId,
                            payload.channelId,
                            {
                                toolName,
                                success: false,
                                error: error instanceof Error ? error.message : String(error)
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
                const authorization = payload.authorization;

                // Only proceed if we have valid agentId, channelId, and requestId
                if (!payload.agentId || !payload.channelId || !requestId) {
                    this.logger.error(`Cannot process TOOL_LIST event - missing required fields. AgentId: ${payload.agentId || '[MISSING]'}, ChannelId: ${payload.channelId || '[MISSING]'}, RequestId: ${requestId || '[MISSING]'}`);
                    return;
                }
                if (!authorization ||
                    typeof authorization.keyId !== 'string' ||
                    authorization.keyId.trim().length === 0 ||
                    (authorization.allowedTools !== undefined &&
                        !Array.isArray(authorization.allowedTools))) {
                    this.logger.error('Cannot process TOOL_LIST without credential-scoped policy');
                    EventBus.server.emit(Events.Mcp.TOOL_LIST_ERROR, createBaseEventPayload(
                        Events.Mcp.TOOL_LIST_ERROR,
                        payload.agentId,
                        payload.channelId,
                        { error: 'Credential-scoped tool policy is required', requestId }
                    ));
                    return;
                }

                this.listToolsForChannel(payload.channelId, filter, payload.agentId).subscribe({
                    next: (tools) => {
                        const authorizedTools = tools.filter(tool => {
                            const names = getToolAuthorizationNames(tool);
                            return isAllowedByAgentPolicy(names, authorization.allowedTools) &&
                                isPrivilegedHostToolEnabled(names) &&
                                isPrivilegedNetworkToolEnabled(names);
                        });
                        EventBus.server.emit(Events.Mcp.TOOL_LIST_RESULT, createBaseEventPayload(
                            Events.Mcp.TOOL_LIST_RESULT,
                            payload.agentId, // Use actual agentId from request
                            payload.channelId, // Use actual channelId from request
                            {
                                tools: authorizedTools.map(tool => ({
                                    name: tool.name,
                                    description: tool.description,
                                    inputSchema: tool.inputSchema
                                    // Ensure only fields defined in McpPayloads for 'mcp:tool:list:result' are included
                                })),
                                requestId
                            }
                        ));
                    },
                    error: (error) => {
                        this.logger.error(`Failed to list tools: ${error}`);
                        EventBus.server.emit(Events.Mcp.TOOL_LIST_ERROR, createBaseEventPayload(
                            Events.Mcp.TOOL_LIST_ERROR,
                            payload.agentId,
                            payload.channelId,
                            {
                                error: error instanceof Error ? error.message : String(error),
                                requestId
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
     *
     * This event uses McpToolRegistry.TOOL_REGISTRY_CHANGED as a custom registry-specific event.
     * The event follows the standard payload structure with tools array for registry consistency.
     */
    private notifyToolRegistryChanged(): void {
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

                // Re-registering the identical tool from the same provider and channel
                // is a no-op, not a conflict — startup can run more than once.
                if (existingTool.providerId === providerId && existingTool.channelId === channelId) {
                    return of(true);
                }

                // A different provider or channel claiming a name that is already taken
                // is a collision. The old code returned of(true) here: the caller was
                // told the registration succeeded, while the existing tool silently kept
                // the name and every subsequent call went to the wrong handler.
                const message =
                    `Tool name collision: "${tool.name}" is already registered by ` +
                    `provider "${existingTool.providerId}" on channel "${existingTool.channelId}"; ` +
                    `provider "${providerId}" on channel "${channelId}" tried to claim the same name. ` +
                    `Tool names must be unique — rename one of them.`;

                this.logger.error(message);
                return throwError(() => new Error(message));
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
     * Reconcile the code-defined tool set into the database and into memory.
     *
     * Call this once at startup with every tool the code defines. Code wins: for
     * each tool this writes the current description, inputSchema and metadata into
     * the database, whether or not a row already existed.
     *
     * This replaces the old startup behavior, which registered only tools whose
     * NAMES were new. Under that rule an edited description never reached the
     * model — the database kept serving the original text until someone wiped the
     * collection — while the schema, read from code, updated immediately. The two
     * halves of one tool's contract drifted apart, silently, and descriptions are
     * prompt text.
     *
     * Rows for tools the code no longer defines are removed: they can never
     * execute (there is no handler), so leaving them listed only advertises tools
     * that fail when called.
     *
     * @param tools Every tool defined in code
     * @param providerId Provider that owns them
     * @param channelId Channel they are registered against
     * @returns A summary of what changed
     */
    public async reconcileTools(
        tools: McpToolDefinition[],
        providerId: string = 'mxf-server',
        channelId: string = 'system'
    ): Promise<{ added: number; updated: number; unchanged: number; removed: number }> {
        validate.assertIsArray(tools, 'Tools must be an array');
        validate.assertIsNonEmptyString(providerId, 'Provider ID must be a non-empty string');
        validate.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');

        // Duplicate names inside the code-defined set would make "which handler runs"
        // depend on registration order. Catch it here as well as at the tool index,
        // since tools can also arrive from a caller that assembled its own list.
        const seen = new Set<string>();
        const duplicates = new Set<string>();
        for (const tool of tools) {
            if (seen.has(tool.name)) {
                duplicates.add(tool.name);
            }
            seen.add(tool.name);
        }
        if (duplicates.size > 0) {
            throw new Error(
                `Cannot reconcile tools: duplicate tool names in the code-defined set: ` +
                `${Array.from(duplicates).sort().join(', ')}`
            );
        }

        const existingRows = await listAllMcpTools(false);
        const existingByName = new Map(existingRows.map(row => [row.name, row]));

        const summary = { added: 0, updated: 0, unchanged: 0, removed: 0 };
        const changedNames: string[] = [];

        for (const tool of tools) {
            const existing = existingByName.get(tool.name);
            const description = tool.description ?? '';
            const inputSchema = tool.inputSchema ?? {};
            const metadata = tool.metadata ?? {};

            if (!existing) {
                await createMcpTool({
                    name: tool.name,
                    description,
                    inputSchema,
                    enabled: tool.enabled !== undefined ? tool.enabled : true,
                    providerId,
                    channelId,
                    parameters: [],
                    metadata,
                    createdAt: new Date(),
                    updatedAt: new Date()
                } as any);
                summary.added++;
                changedNames.push(`+${tool.name}`);
                continue;
            }

            // Compare on the fields the model actually sees.
            const descriptionChanged = existing.description !== description;
            const schemaChanged =
                JSON.stringify(existing.inputSchema ?? {}) !== JSON.stringify(inputSchema);

            if (descriptionChanged || schemaChanged) {
                await updateMcpTool(tool.name, {
                    description,
                    inputSchema,
                    metadata,
                    enabled: tool.enabled !== undefined ? tool.enabled : true,
                    providerId,
                    channelId
                } as any);
                summary.updated++;
                changedNames.push(`~${tool.name}`);
            } else {
                summary.unchanged++;
            }
        }

        // Prune rows the code no longer defines.
        for (const row of existingRows) {
            if (!seen.has(row.name)) {
                await deleteMcpTool(row.name);
                summary.removed++;
                changedNames.push(`-${row.name}`);
            }
        }

        // One line, so a description edit is visible in the startup log.
        this.logger.info(
            `MCP tool reconciliation: ${summary.added} added, ${summary.updated} updated, ` +
            `${summary.unchanged} unchanged, ${summary.removed} removed` +
            (changedNames.length > 0 ? ` [${changedNames.join(' ')}]` : '')
        );

        // Force the next read to pick up what we just wrote.
        this.databaseLoaded = false;
        this.tools.clear();
        await this.loadToolsFromDatabase();

        this.notifyToolRegistryChanged();

        return summary;
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

            // This context-free accessor backs the public exact-name endpoint.
            // Resolve through the global-safe composed view rather than the raw
            // internal map, which also contains channel-owned registrations.
            return this.listTools().pipe(
                mergeMap((tools) => {
                    const tool = tools.find(candidate => candidate.name === name);
                    return tool
                        ? of(tool)
                        : throwError(() => new Error(`Tool with name ${name} does not exist`));
                })
            );
        } catch (error) {
            this.logger.error(`Failed to get tool: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }

    /** Apply the registry's literal name filter and deterministic ordering. */
    private filterAndSortTools(
        tools: ExtendedMcpToolDefinition[],
        filter?: string
    ): ExtendedMcpToolDefinition[] {
        let result = tools;
        if (filter) {
            // Treat the user-supplied filter as a literal substring — raw input
            // in new RegExp() allows regex injection / ReDoS.
            const escaped = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'i');
            result = result.filter(tool => regex.test(tool.name));
        }

        return [...result].sort((a, b) => a.name.localeCompare(b.name));
    }

    /** Core/system registrations are the only registry-owned global tools. */
    private isGlobalRegistration(tool: ExtendedMcpToolDefinition): boolean {
        const channelId = tool.channelId?.toLowerCase();
        return !channelId || channelId === 'global' || channelId === 'system';
    }

    /**
     * Merge a pre-filtered external snapshot into an internal view.
     * The caller controls ordering, which also controls deterministic collision
     * precedence. Registry-owned tools always win a public-name collision.
     */
    private composeExternalTools(
        internalTools: ExtendedMcpToolDefinition[],
        externalTools: ReadonlyArray<ExternalToolProviderEntry>,
        filter: string | undefined,
        exposeRawNames: boolean
    ): ExtendedMcpToolDefinition[] {
        const byName = new Map<string, ExtendedMcpToolDefinition>();
        for (const tool of internalTools) {
            byName.set(tool.name, tool);
        }

        for (const tool of externalTools) {
            const canonicalName = tool.canonicalName ?? tool.name;
            const publicName = exposeRawNames
                ? (tool.externalToolName ?? tool.name)
                : canonicalName;

            // Internal definitions always win, and repeated provider snapshots
            // stay idempotent under their public name.
            if (byName.has(publicName)) {
                continue;
            }

            byName.set(publicName, {
                name: publicName,
                description: tool.description,
                inputSchema: tool.inputSchema,
                handler: tool.handler,
                enabled: tool.enabled,
                metadata: {
                    ...(tool.metadata || {}),
                    canonicalName,
                    externalToolName: tool.externalToolName ?? tool.name,
                    externalSource: tool.source,
                    externalScope: tool.scope,
                    externalScopeId: tool.scopeId
                },
                providerId: `external-mcp:${tool.source}`,
                channelId: tool.scope === 'global' ? 'global' : tool.scopeId
            });
        }

        return this.filterAndSortTools(Array.from(byName.values()), filter);
    }

    /**
     * List only tools owned by this registry.
     *
     * HybridMcpToolRegistry must consume this view. Feeding listTools() back
     * into the hybrid registry would re-import its own external provider output
     * as internal tools and erase channel scope on the next refresh.
     */
    public listInternalTools(filter?: string): Observable<ExtendedMcpToolDefinition[]> {
        try {
            if (!this.databaseLoaded) {
                return from(this.loadToolsFromDatabase()).pipe(
                    switchMap(() => this.listInternalTools(filter))
                );
            }

            return of(this.filterAndSortTools(Array.from(this.tools.values()), filter));
        } catch (error) {
            this.logger.error(`Failed to list internal tools: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }

    /**
     * List the administrative registry view.
     *
     * Stored tools are combined with explicitly global external tools only.
     * Channel/agent external tools require a channel-aware hybrid lookup and
     * must never be projected into this context-free list as global entries.
     */
    public listTools(filter?: string): Observable<ExtendedMcpToolDefinition[]> {
        return this.listInternalTools().pipe(
            map((internalTools) => {
                const globalInternalTools = internalTools.filter(tool => this.isGlobalRegistration(tool));
                const globalExternalTools = this.externalToolsProvider
                    ? [...this.externalToolsProvider()]
                        .filter(tool => tool.scope === 'global')
                        .sort((a, b) => {
                            const aName = a.canonicalName ?? a.name;
                            const bName = b.canonicalName ?? b.name;
                            return aName.localeCompare(bName) || a.source.localeCompare(b.source);
                        })
                    : [];

                return this.composeExternalTools(
                    globalInternalTools,
                    globalExternalTools,
                    filter,
                    false
                );
            }),
            catchError((error) => {
                this.logger.error(`Failed to list tools: ${error instanceof Error ? error.message : String(error)}`);
                return throwError(() => error);
            })
        );
    }

    /**
     * List the tools visible inside one authenticated channel context.
     *
     * Core/global tools and registrations owned by this channel are visible.
     * External tools additionally honor their authoritative global/channel/agent
     * scope, and are exposed under their raw agent-facing names while retaining
     * the canonical name in metadata for routing.
     */
    public listToolsForChannel(
        channelId: string,
        filter?: string,
        agentId?: string
    ): Observable<ExtendedMcpToolDefinition[]> {
        try {
            validate.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
            if (agentId !== undefined) {
                validate.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
            }

            return this.listInternalTools().pipe(
                map((internalTools) => {
                    const visibleInternalTools = internalTools.filter(tool =>
                        this.isGlobalRegistration(tool) || tool.channelId === channelId
                    );

                    const scopePriority = (tool: ExternalToolProviderEntry): number => {
                        if (tool.scope === 'agent') return 0;
                        if (tool.scope === 'channel') return 1;
                        return 2;
                    };
                    const visibleExternalTools = this.externalToolsProvider
                        ? [...this.externalToolsProvider()]
                            .filter(tool =>
                                tool.scope === 'global' ||
                                (tool.scope === 'channel' && tool.scopeId === channelId) ||
                                (tool.scope === 'agent' && agentId !== undefined && tool.scopeId === agentId)
                            )
                            .sort((a, b) =>
                                scopePriority(a) - scopePriority(b) ||
                                (a.externalToolName ?? a.name).localeCompare(b.externalToolName ?? b.name) ||
                                a.source.localeCompare(b.source) ||
                                (a.canonicalName ?? a.name).localeCompare(b.canonicalName ?? b.name)
                            )
                        : [];

                    return this.composeExternalTools(
                        visibleInternalTools,
                        visibleExternalTools,
                        filter,
                        true
                    );
                }),
                catchError((error) => {
                    this.logger.error(`Failed to list channel tools: ${error instanceof Error ? error.message : String(error)}`);
                    return throwError(() => error);
                })
            );
        } catch (error) {
            this.logger.error(`Failed to list channel tools: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }

    /** Unregister a channel registration only for its exact provider owner. */
    public unregisterToolForOwner(
        name: string,
        providerId: string,
        channelId: string
    ): Observable<boolean> {
        try {
            validate.assertIsNonEmptyString(name, 'Tool name must be a non-empty string');
            validate.assertIsNonEmptyString(providerId, 'Provider ID must be a non-empty string');
            validate.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');

            if (!this.databaseLoaded) {
                return from(this.loadToolsFromDatabase()).pipe(
                    switchMap(() => this.unregisterToolForOwner(name, providerId, channelId))
                );
            }

            const existingTool = this.tools.get(name);
            if (!existingTool) {
                return throwError(() => new Error(`Tool with name ${name} does not exist`));
            }

            // Core/global registrations are lifecycle-managed by the server and
            // cannot be removed through an agent socket event, even if a caller
            // manages to present reserved-looking identity strings.
            if (this.isGlobalRegistration(existingTool)) {
                return throwError(() => new Error(
                    `Tool "${name}" is a core/global registration and cannot be unregistered by an agent`
                ));
            }

            if (existingTool.providerId !== providerId || existingTool.channelId !== channelId) {
                return throwError(() => new Error(
                    `Tool "${name}" is not owned by agent "${providerId}" in channel "${channelId}"`
                ));
            }

            return this.unregisterTool(name);
        } catch (error) {
            this.logger.error(`Failed to authorize tool unregistration: ${error instanceof Error ? error.message : String(error)}`);
            return throwError(() => error);
        }
    }

    /** Administrative unregistration by name; socket events must use unregisterToolForOwner(). */
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
