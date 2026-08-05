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
 * HybridMcpToolRegistry.ts
 * 
 * Unified tool registry that combines internal MXF tools with external MCP server tools.
 * Provides a seamless interface for tool discovery, registration, and execution
 * across the hybrid MCP architecture.
 */

import { Observable, BehaviorSubject, combineLatest, map } from 'rxjs';
import { McpToolRegistry, ExtendedMcpToolDefinition } from '../../api/services/McpToolRegistry';
import { ExternalMcpServerManager, ExternalMcpTool } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { getExternalServerCategory } from '@mxf-dev/core/protocols/mcp/services/ExternalServerConfigs';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { McpEvents } from '@mxf-dev/core/events/event-definitions/McpEvents';

// Create logger instance
const logger = new Logger('info', 'HybridMcpToolRegistry', 'server');

/**
 * Separator between a server id and a tool name in a namespaced external tool.
 *
 * External tools are exposed as `<serverId>__<toolName>`. Without this an external
 * server that happens to expose `task_create` would land in the same flat list as
 * the internal `task_create`, and findTool() — which returns the first match in a
 * list sorted by name — would pick one of them by coin flip.
 *
 * Two underscores, because MCP tool names are `[a-z0-9_-]` and a single underscore
 * is common inside both server ids and tool names.
 */
export const EXTERNAL_TOOL_SEPARATOR = '__';

/**
 * Build the name an external tool is exposed under.
 */
export function namespaceExternalTool(serverId: string, toolName: string): string {
    return `${serverId}${EXTERNAL_TOOL_SEPARATOR}${toolName}`;
}

/**
 * Split a namespaced external tool name back into its server id and tool name.
 *
 * Returns null for a name that is not namespaced — that is an internal tool.
 */
export function parseExternalToolName(
    name: string
): { serverId: string; toolName: string } | null {
    const index = name.indexOf(EXTERNAL_TOOL_SEPARATOR);
    if (index <= 0) {
        return null;
    }
    return {
        serverId: name.slice(0, index),
        toolName: name.slice(index + EXTERNAL_TOOL_SEPARATOR.length)
    };
}

/**
 * Enhanced tool definition that includes server source information
 */
export interface HybridMcpTool extends ExtendedMcpToolDefinition {
    /** Source of the tool: 'internal' for MXF tools, server ID for external tools */
    source: string;
    /** Category for filtering and organization */
    category: string;
    /** Whether the tool is from an external server */
    isExternal: boolean;
    /** Scope of the tool: global, channel, or agent */
    scope: 'global' | 'channel' | 'agent';
    /** Scope identifier (channelId for channel scope, agentId for agent scope) */
    scopeId?: string;
    /** List of channels this tool is available to (for channel-scoped tools) */
    availableToChannels?: string[];
    /** For external tools: the name the origin server knows this tool by */
    externalToolName?: string;
    /**
     * For agent-facing views of an external tool: the namespaced name the
     * registry knows it by. Agent-facing entries carry the raw name in `name`
     * (LLM providers reject ':' — present in every channel server id — in
     * function names), and this field routes execution back to the canonical
     * registry entry.
     */
    canonicalName?: string;
}

/**
 * Unified tool registry for hybrid MCP architecture
 */
export class HybridMcpToolRegistry {
    private internalRegistry: McpToolRegistry;
    private externalServerManager: ExternalMcpServerManager;
    
    // Observable streams for real-time tool updates
    private internalToolsSubject = new BehaviorSubject<ExtendedMcpToolDefinition[]>([]);
    private externalToolsSubject = new BehaviorSubject<ExternalMcpTool[]>([]);
    private hybridToolsSubject = new BehaviorSubject<HybridMcpTool[]>([]);

    /** EventBus subscriptions, kept so shutdown() can detach this instance. */
    private eventSubscriptions: Array<{ unsubscribe: () => void }> = [];

    constructor(internalRegistry: McpToolRegistry, externalServerManager: ExternalMcpServerManager) {
        this.internalRegistry = internalRegistry;
        this.externalServerManager = externalServerManager;


        // Set up internal tools subscription
        this.internalRegistry.listTools().subscribe({
            next: (tools) => {
                this.internalToolsSubject.next(tools);
            },
            error: (error) => {
                logger.error(`❌ Error in internal tools stream: ${error.message}`);
            }
        });

        // Set up external tools monitoring
        this.setupExternalToolsMonitoring();

        // Combine internal and external tools
        this.setupHybridToolsCombination();

    }

    /**
     * Set up monitoring for external server tools
     */
    private setupExternalToolsMonitoring(): void {
        // Monitor external server events for tool updates via EventBus
        this.eventSubscriptions.push(
            EventBus.server.on(McpEvents.EXTERNAL_SERVER_STARTED, () => {
                this.refreshExternalTools();
            }),
            EventBus.server.on(McpEvents.EXTERNAL_SERVER_STOPPED, () => {
                this.refreshExternalTools();
            }),
            EventBus.server.on(McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED, () => {
                this.refreshExternalTools();
            })
        );

        // Initial refresh
        this.refreshExternalTools();
    }

    /**
     * Refresh internal tools snapshot from McpToolRegistry.
     * Call after registering new tools so the hybrid registry picks them up.
     */
    public refreshInternalTools(): void {
        this.internalRegistry.listTools().subscribe({
            next: (tools) => {
                this.internalToolsSubject.next(tools);
            },
            error: (error) => {
                logger.error(`❌ Error refreshing internal tools: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }

    /**
     * Refresh external tools from all running servers.
     *
     * Every change is logged per server. Tools leaving the registry for a
     * server that is still registered is never a healthy state, and this used
     * to happen in complete silence — the registry simply mirrored whatever
     * the manager returned, so an evicted server's tools vanished with
     * nothing to grep for.
     */
    private refreshExternalTools(): void {
        const previous = this.externalToolsSubject.value;
        try {
            const externalTools = this.externalServerManager.getAllExternalTools();

            this.logExternalToolDiff(previous, externalTools);
            this.externalToolsSubject.next(externalTools);
        } catch (error) {
            logger.error(`❌ Error refreshing external tools: ${error instanceof Error ? error.message : String(error)}`);
            this.logExternalToolDiff(previous, []);
            this.externalToolsSubject.next([]);
        }
    }

    /**
     * Report which servers gained or lost tools between two registry snapshots.
     * Removals log at warn — they mean a server stopped serving its tools.
     */
    private logExternalToolDiff(previous: ExternalMcpTool[], next: ExternalMcpTool[]): void {
        const namesByServer = (tools: ExternalMcpTool[]): Map<string, string[]> => {
            const map = new Map<string, string[]>();
            for (const tool of tools) {
                const names = map.get(tool.serverId) ?? [];
                names.push(tool.name);
                map.set(tool.serverId, names);
            }
            return map;
        };

        const before = namesByServer(previous);
        const after = namesByServer(next);
        const serverIds = new Set([...before.keys(), ...after.keys()]);

        for (const serverId of serverIds) {
            const beforeNames = before.get(serverId) ?? [];
            const afterNames = new Set(after.get(serverId) ?? []);
            const beforeSet = new Set(beforeNames);

            const removed = beforeNames.filter(name => !afterNames.has(name));
            const added = [...afterNames].filter(name => !beforeSet.has(name));

            if (removed.length > 0) {
                logger.warn(
                    `External server ${serverId}: ${removed.length} tool(s) removed from the registry` +
                    `${afterNames.size === 0 ? ' (all of them)' : ''}: ${removed.join(', ')}`
                );
            }
            if (added.length > 0) {
                logger.info(`External server ${serverId}: ${added.length} tool(s) added to the registry: ${added.join(', ')}`);
            }
        }
    }

    /**
     * Set up the combination of internal and external tools
     */
    private setupHybridToolsCombination(): void {
        combineLatest([
            this.internalToolsSubject,
            this.externalToolsSubject
        ]).pipe(
            map(([internalTools, externalTools]) => this.combineTools(internalTools, externalTools))
        ).subscribe({
            next: (hybridTools) => {

                this.hybridToolsSubject.next(hybridTools);
            },
            error: (error) => {
                logger.error(`❌ Error combining tools: ${error.message}`);
            }
        });
    }

    /**
     * Combine internal and external tools into one list.
     *
     * Internal tools keep their names. External tools are namespaced as
     * `<serverId>__<toolName>`, so an external server can never take a name an
     * internal tool already uses. Previously the two lists were concatenated with
     * no duplicate check and the combined list sorted by name — an external
     * `task_create` would sit next to the internal one and findTool() would return
     * whichever sorted first.
     */
    private combineTools(internalTools: ExtendedMcpToolDefinition[], externalTools: ExternalMcpTool[]): HybridMcpTool[] {
        const hybridTools: HybridMcpTool[] = [];
        const internalNames = new Set<string>();

        // Add internal tools with 'internal' source (global scope)
        for (const tool of internalTools) {
            // The internal set is validated for uniqueness at the tool index and
            // again at registry reconciliation. If a duplicate still reaches here,
            // say so rather than letting the later copy win by array position.
            if (internalNames.has(tool.name)) {
                logger.error(
                    `Duplicate internal tool name "${tool.name}" reached the hybrid registry. ` +
                    `The first definition is kept; the duplicate is dropped.`
                );
                continue;
            }
            internalNames.add(tool.name);

            hybridTools.push({
                ...tool,
                source: 'internal',
                category: this.getInternalToolCategory(tool.name),
                isExternal: false,
                scope: 'global' as 'global' | 'channel' | 'agent',
                scopeId: undefined,
                availableToChannels: undefined
            });
        }

        // Add external tools under a namespaced name
        for (const tool of externalTools) {
            // Determine scope from server ID format (channelId:serverId for channel scope)
            const isChannelScoped = tool.serverId.includes(':');
            const scope: 'global' | 'channel' | 'agent' = isChannelScoped ? 'channel' : 'global';
            const scopeId = isChannelScoped ? tool.serverId.split(':')[0] : undefined;

            const namespacedName = namespaceExternalTool(tool.serverId, tool.name);

            hybridTools.push({
                name: namespacedName,
                canonicalName: namespacedName,
                externalToolName: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                source: tool.serverId,
                category: getExternalServerCategory(tool.serverId),
                isExternal: true,
                enabled: true,
                scope,
                scopeId,
                availableToChannels: scopeId ? [scopeId] : undefined,
                handler: async (input: any, context: any) => {
                    // Execute tool on external MCP server using the sendMcpToolCall method.
                    // The origin server knows the tool by its unqualified name.
                    try {
                        const result = await this.sendMcpToolCall(tool.serverId, tool.name, input, context);

                        // Transform MCP protocol result format to MXF format
                        // MCP returns: { content: [{ type: "text", text: "..." }] }
                        // MXF expects: { content: { type: "text", data: "..." } }
                        if (result && result.content && Array.isArray(result.content) && result.content.length > 0) {
                            const firstContent = result.content[0];
                            // Transform text content
                            if (firstContent.type === 'text' && 'text' in firstContent) {
                                return {
                                    content: {
                                        type: 'text',
                                        data: firstContent.text
                                    }
                                };
                            }
                            // Transform image content
                            if (firstContent.type === 'image' && 'data' in firstContent) {
                                return {
                                    content: {
                                        type: 'binary',
                                        data: firstContent.data,
                                        mimeType: firstContent.mimeType || 'image/png'
                                    }
                                };
                            }
                            // If we have multiple content items, combine text items
                            const textItems = result.content.filter((c: any) => c.type === 'text' && 'text' in c);
                            if (textItems.length > 0) {
                                return {
                                    content: {
                                        type: 'text',
                                        data: textItems.map((c: any) => c.text).join('\n')
                                    }
                                };
                            }
                        }
                        
                        // Fallback: if result doesn't match expected format, wrap it
                        logger.warn(`⚠️ External tool ${tool.name} returned unexpected format, wrapping result`);
                        return {
                            content: {
                                type: 'application/json',
                                data: result
                            }
                        };
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        logger.error(`❌ Failed to execute external tool ${tool.name} on server ${tool.serverId}: ${errorMessage}`);
                        throw error;
                    }
                }
            });
        }

        // Sort tools alphabetically by name for consistent ordering
        hybridTools.sort((a, b) => a.name.localeCompare(b.name));

        return hybridTools;
    }

    /**
     * Get category for internal MXF tools
     */
    private getInternalToolCategory(toolName: string): string {
        // Use the same logic as the existing MetaTools.ts getToolCategory function
        if (toolName.startsWith('agent_')) return 'communication';
        // orpar_*, not control_loop_*: the old control-loop tools were named
        // controlLoop_* in camelCase, so this test never matched one of them and
        // they all fell through to 'unknown'. That family has since been removed.
        if (toolName.startsWith('orpar_')) return 'control-loop';
        if (toolName.startsWith('fs_') || toolName.startsWith('memory_') || toolName.startsWith('shell_')) return 'infrastructure';
        if (toolName.startsWith('channel_') || toolName.startsWith('agent_context') || toolName.startsWith('agent_memory')) return 'context-memory';
        if (toolName.startsWith('tools_')) return 'meta';
        return 'unknown';
    }

    /**
     * Get all tools (internal + external) as Observable
     */
    public listAllTools(): Observable<HybridMcpTool[]> {
        return this.hybridToolsSubject.asObservable();
    }

    /**
     * Get current snapshot of all tools
     */
    public getAllToolsSnapshot(): HybridMcpTool[] {
        return [...this.hybridToolsSubject.value];
    }

    /**
     * Get tools filtered by category
     */
    public getToolsByCategory(categories: string[]): HybridMcpTool[] {
        return this.hybridToolsSubject.value.filter(tool => 
            categories.includes(tool.category)
        );
    }

    /**
     * Get tools filtered by source (internal, or specific server ID)
     */
    public getToolsBySource(sources: string[]): HybridMcpTool[] {
        return this.hybridToolsSubject.value.filter(tool =>
            sources.includes(tool.source)
        );
    }

    /**
     * Get tools available to a specific channel
     * Returns global tools + channel-scoped tools for this channel
     */
    public getToolsForChannel(channelId: string): HybridMcpTool[] {
        return this.hybridToolsSubject.value.filter(tool => {
            // Include global tools
            if (tool.scope === 'global') {
                return true;
            }

            // Include channel-scoped tools for this specific channel
            if (tool.scope === 'channel' && tool.scopeId === channelId) {
                return true;
            }

            return false;
        });
    }

    /**
     * Get the tools of a channel in their agent-facing shape.
     *
     * Internal tools are returned as-is. External tools are returned under
     * their raw name (`externalToolName`): the raw name is the only name
     * clients ever see — registration returns raw names in toolsDiscovered —
     * and the namespaced name is not even legal as an LLM function name for
     * channel servers, whose server id always contains ':'. `canonicalName`
     * carries the namespaced registry name for execution routing.
     *
     * Collisions are resolved deterministically and loudly:
     *   - an external raw name that matches an internal tool is skipped
     *     (internal tools always win — the namespacing exists so external
     *     servers cannot shadow internal tools)
     *   - two external tools with the same raw name: the lexicographically
     *     first server id wins, the rest are skipped
     */
    public getAgentFacingToolsForChannel(channelId: string): HybridMcpTool[] {
        const scoped = this.getToolsForChannel(channelId);

        const internalNames = new Set(scoped.filter(t => !t.isExternal).map(t => t.name));
        const result: HybridMcpTool[] = scoped.filter(t => !t.isExternal);

        // Deterministic winner for duplicate raw names: sort by server id
        const externals = scoped
            .filter(t => t.isExternal)
            .sort((a, b) => a.source.localeCompare(b.source));

        const claimed = new Map<string, HybridMcpTool>();
        for (const tool of externals) {
            const rawName = tool.externalToolName ?? tool.name;

            if (internalNames.has(rawName)) {
                logger.error(
                    `External tool "${rawName}" from server ${tool.source} collides with an internal tool ` +
                    `and is not exposed to agents. Rename it on the external server.`
                );
                continue;
            }

            const winner = claimed.get(rawName);
            if (winner) {
                logger.error(
                    `External tool "${rawName}" is offered by both ${winner.source} and ${tool.source} ` +
                    `in channel ${channelId}; keeping ${winner.source}, skipping ${tool.source}.`
                );
                continue;
            }

            const agentFacing: HybridMcpTool = {
                ...tool,
                name: rawName,
                canonicalName: tool.name
            };
            claimed.set(rawName, agentFacing);
            result.push(agentFacing);
        }

        return result;
    }

    /**
     * Resolve a tool name as an agent in a channel would use it.
     *
     * Accepts either the canonical registry name (internal name or namespaced
     * external name) or an external tool's raw name, scoped to the channel.
     * Returns the canonical registry entry, so `handler`, `inputSchema`, and
     * `name` are the ones execution needs. Internal tools always win a raw
     * name collision; external raw-name ties resolve to the lexicographically
     * first server id, matching getAgentFacingToolsForChannel().
     */
    public resolveToolForChannel(name: string, channelId: string): HybridMcpTool | undefined {
        const scoped = this.getToolsForChannel(channelId);

        // Exact canonical match first: internal names and namespaced external names
        const exact = scoped.find(tool => tool.name === name);
        if (exact) {
            return exact;
        }

        // Raw external name, deterministic across servers
        const candidates = scoped
            .filter(tool => tool.isExternal && tool.externalToolName === name)
            .sort((a, b) => a.source.localeCompare(b.source));

        return candidates[0];
    }

    /**
     * Get tools available to a specific agent based on their channel memberships
     */
    public getToolsForAgent(agentId: string, channelIds: string[]): HybridMcpTool[] {
        return this.hybridToolsSubject.value.filter(tool => {
            // Include global tools
            if (tool.scope === 'global') {
                return true;
            }

            // Include channel-scoped tools for channels the agent is in
            if (tool.scope === 'channel' && tool.scopeId && channelIds.includes(tool.scopeId)) {
                return true;
            }

            // Include agent-scoped tools for this specific agent
            if (tool.scope === 'agent' && tool.scopeId === agentId) {
                return true;
            }

            return false;
        });
    }

    /**
     * Get external tools only
     */
    public getExternalTools(): HybridMcpTool[] {
        return this.hybridToolsSubject.value.filter(tool => tool.isExternal);
    }

    /**
     * Get internal tools only
     */
    public getInternalTools(): HybridMcpTool[] {
        return this.hybridToolsSubject.value.filter(tool => !tool.isExternal);
    }

    /**
     * Find a specific tool by name
     */
    public findTool(toolName: string): HybridMcpTool | undefined {
        return this.hybridToolsSubject.value.find(tool => tool.name === toolName);
    }

    /**
     * Check if a tool is available
     */
    public isToolAvailable(toolName: string): boolean {
        return this.findTool(toolName) !== undefined;
    }

    /**
     * REMOVED: executeTool / executeInternalTool / executeExternalTool /
     * getToolExecutionContext.
     *
     * That was a second execution path, and it was both dead and broken.
     * executeInternalTool called `(this.internalRegistry as any).executeTool(...)`
     * — a method McpToolRegistry has never had — so the `as any` was hiding a
     * guaranteed TypeError. It never fired only because the sole caller,
     * HybridMcpService, was never instantiated anywhere in the codebase.
     *
     * Tools execute through exactly one path now:
     *   internal → McpToolRegistry's handler, invoked by McpService
     *   external → the handler closure attached in combineTools(), which calls
     *              sendMcpToolCall() below
     *
     * Callers that used to reach for hybridRegistry.executeTool() should invoke
     * the tool's own `handler`, reached via findTool().
     */

    /**
     * Send MCP tool call to external server via JSON-RPC protocol
     */
    private async sendMcpToolCall(serverId: string, toolName: string, input: any, context?: any): Promise<any> {
        // Identity is not optional. Defaulting to 'system'/'default' here made the
        // call unattributable and quietly undid the registry's own requirement that
        // every tool execution carry an agentId and a channelId.
        if (!context?.agentId || typeof context.agentId !== 'string') {
            throw new Error(
                `Cannot execute external tool "${toolName}" on server "${serverId}": ` +
                `the execution context has no agentId. External tool calls must be attributable.`
            );
        }
        if (!context?.channelId || typeof context.channelId !== 'string') {
            throw new Error(
                `Cannot execute external tool "${toolName}" on server "${serverId}": ` +
                `the execution context has no channelId. External tool calls must be attributable.`
            );
        }

        try {
            return await this.externalServerManager.executeToolOnServer(
                serverId,
                toolName,
                input,
                context.agentId,
                context.channelId
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`External tool ${toolName} on ${serverId} failed: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Get tool statistics
     */
    public getToolStats(): {
        total: number;
        internal: number;
        external: number;
        byCategory: Record<string, number>;
        bySource: Record<string, number>;
    } {
        const tools = this.hybridToolsSubject.value;
        
        const stats = {
            total: tools.length,
            internal: tools.filter(t => !t.isExternal).length,
            external: tools.filter(t => t.isExternal).length,
            byCategory: {} as Record<string, number>,
            bySource: {} as Record<string, number>
        };

        // Count by category
        for (const tool of tools) {
            stats.byCategory[tool.category] = (stats.byCategory[tool.category] || 0) + 1;
            stats.bySource[tool.source] = (stats.bySource[tool.source] || 0) + 1;
        }

        return stats;
    }

    /**
     * Get available categories
     */
    public getAvailableCategories(): string[] {
        const categories = new Set<string>();
        for (const tool of this.hybridToolsSubject.value) {
            categories.add(tool.category);
        }
        return Array.from(categories).sort();
    }

    /**
     * Get available sources
     */
    public getAvailableSources(): string[] {
        const sources = new Set<string>();
        for (const tool of this.hybridToolsSubject.value) {
            sources.add(tool.source);
        }
        return Array.from(sources).sort();
    }

    /**
     * Cleanup and shutdown
     */
    public async shutdown(): Promise<void> {

        // Detach from the EventBus so a shut-down registry stops refreshing
        for (const subscription of this.eventSubscriptions) {
            subscription.unsubscribe();
        }
        this.eventSubscriptions = [];

        this.internalToolsSubject.complete();
        this.externalToolsSubject.complete();
        this.hybridToolsSubject.complete();

    }
}
