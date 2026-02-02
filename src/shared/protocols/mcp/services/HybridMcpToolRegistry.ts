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
 * HybridMcpToolRegistry.ts
 * 
 * Unified tool registry that combines internal MXF tools with external MCP server tools.
 * Provides a seamless interface for tool discovery, registration, and execution
 * across the hybrid MCP architecture.
 */

import { Observable, BehaviorSubject, combineLatest, map } from 'rxjs';
import { McpToolRegistry, ExtendedMcpToolDefinition } from '../../../../server/api/services/McpToolRegistry';
import { ExternalMcpServerManager, ExternalMcpTool } from './ExternalMcpServerManager';
import { createStrictValidator } from '../../../utils/validation';
import { Logger } from '../../../utils/Logger';
import { getExternalServerCategory } from './ExternalServerConfigs';
import { EventBus } from '../../../events/EventBus';
import { McpEvents } from '../../../events/event-definitions/McpEvents';
import { enhanceToolSchema } from './ToolSchemaEnhancements';

// Create logger and validator instances
const logger = new Logger('info', 'HybridMcpToolRegistry', 'server');
const validator = createStrictValidator('HybridMcpToolRegistry');

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
}

/**
 * Tool execution context for routing
 */
export interface ToolExecutionContext {
    toolName: string;
    source: string;
    input: Record<string, any>;
    agentId?: string;
    channelId?: string;
    requestId?: string;
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
        EventBus.server.on(McpEvents.EXTERNAL_SERVER_STARTED, () => {
            this.refreshExternalTools();
        });

        EventBus.server.on(McpEvents.EXTERNAL_SERVER_STOPPED, () => {
            this.refreshExternalTools();
        });

        EventBus.server.on(McpEvents.EXTERNAL_SERVER_TOOLS_DISCOVERED, () => {
            this.refreshExternalTools();
        });

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
     * Refresh external tools from all running servers
     */
    private refreshExternalTools(): void {
        try {
            const externalTools = this.externalServerManager.getAllExternalTools();

            this.externalToolsSubject.next(externalTools);
        } catch (error) {
            logger.error(`❌ Error refreshing external tools: ${error instanceof Error ? error.message : String(error)}`);
            this.externalToolsSubject.next([]);
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
     * Combine internal and external tools into hybrid tool list
     */
    private combineTools(internalTools: ExtendedMcpToolDefinition[], externalTools: ExternalMcpTool[]): HybridMcpTool[] {
        const hybridTools: HybridMcpTool[] = [];

        // Add internal tools with 'internal' source (global scope)
        for (const tool of internalTools) {
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

        // Add external tools with server ID as source and scope metadata
        for (const tool of externalTools) {
            // Enhance the tool schema with examples and additional details
            const enhancedSchema = enhanceToolSchema(tool.name, tool.serverId, tool.inputSchema);

            // Determine scope from server ID format (channelId:serverId for channel scope)
            const isChannelScoped = tool.serverId.includes(':');
            const scope: 'global' | 'channel' | 'agent' = isChannelScoped ? 'channel' : 'global';
            const scopeId = isChannelScoped ? tool.serverId.split(':')[0] : undefined;

            hybridTools.push({
                name: tool.name,
                description: tool.description,
                inputSchema: enhancedSchema,
                source: tool.serverId,
                category: getExternalServerCategory(tool.serverId),
                isExternal: true,
                enabled: true,
                scope,
                scopeId,
                availableToChannels: scopeId ? [scopeId] : undefined,
                handler: async (input: any, context: any) => {
                    // Execute tool on external MCP server using the sendMcpToolCall method
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
        if (toolName.startsWith('control_loop_')) return 'control-loop';
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
     * Get tool execution context for routing
     */
    public getToolExecutionContext(toolName: string, input: Record<string, any>, options: {
        agentId?: string;
        channelId?: string;
        requestId?: string;
    } = {}): ToolExecutionContext | null {
        const tool = this.findTool(toolName);
        if (!tool) {
            logger.warn(`⚠️ Tool not found: ${toolName}`);
            return null;
        }

        return {
            toolName,
            source: tool.source,
            input,
            agentId: options.agentId,
            channelId: options.channelId,
            requestId: options.requestId || this.generateRequestId()
        };
    }

    /**
     * Execute a tool (internal or external)
     */
    public async executeTool(
        toolName: string, 
        input: Record<string, any>, 
        agentId?: string, 
        channelId?: string
    ): Promise<any> {
        const context = this.getToolExecutionContext(toolName, input, { agentId, channelId });
        
        if (!context) {
            throw new Error(`Tool ${toolName} not found`);
        }


        if (context.source === 'internal') {
            // Route to internal MXF tool registry
            return this.executeInternalTool(context);
        } else {
            // Route to external server
            return this.executeExternalTool(context);
        }
    }

    /**
     * Execute an internal MXF tool
     */
    private async executeInternalTool(context: ToolExecutionContext): Promise<any> {
        try {
            // Use the existing internal tool execution method
            // This assumes the McpToolRegistry has an executeTool method
            const result = await (this.internalRegistry as any).executeTool(
                context.toolName, 
                context.input, 
                context.agentId,
                context.channelId
            );

            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Internal tool ${context.toolName} execution failed: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Execute an external server tool
     */
    private async executeExternalTool(context: ToolExecutionContext): Promise<any> {
        try {
            
            // Get the server status
            const serverStatus = this.externalServerManager.getServerStatusById(context.source);
            if (!serverStatus || serverStatus.status !== 'running') {
                throw new Error(`External server ${context.source} is not running`);
            }

            // Find the tool definition
            const tool = serverStatus.tools.find((t: any) => t.name === context.toolName);
            if (!tool) {
                throw new Error(`Tool ${context.toolName} not found on server ${context.source}`);
            }

            // Send MCP tool call via the server manager
            const result = await this.sendMcpToolCall(context.source, context.toolName, context.input);
            
            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ External tool ${context.toolName} execution failed: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Send MCP tool call to external server via JSON-RPC protocol
     */
    private async sendMcpToolCall(serverId: string, toolName: string, input: any, context?: any): Promise<any> {
        try {
            // Use the ExternalMcpServerManager's new executeToolOnServer method
            const result = await this.externalServerManager.executeToolOnServer(
                serverId, 
                toolName, 
                input,
                context?.agentId || 'system',
                context?.channelId || 'default'
            );
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`❌ External tool execution failed: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Generate a unique request ID
     */
    private generateRequestId(): string {
        return `hybrid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
        
        this.internalToolsSubject.complete();
        this.externalToolsSubject.complete();
        this.hybridToolsSubject.complete();

    }
}
