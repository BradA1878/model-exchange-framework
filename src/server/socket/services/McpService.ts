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
 * McpService - Socket Server MCP Tool Management
 * 
 * Simple singleton service that loads MCP tools from database and provides
 * them via socket events to connected clients.
 */

import { Logger } from '../../../shared/utils/Logger';
import { listAllMcpTools } from '../../../shared/models/mcpTool';
import { Agent } from '../../../shared/models/agent';
import { firstValueFrom, from } from 'rxjs';
import { createStrictValidator } from '../../../shared/utils/validation';
import { AgentService } from './AgentService';
import { Events } from '../../../shared/events/EventNames';
import { EventBus } from '../../../shared/events/EventBus';
import { 
    createMxfToolListResultPayload, 
    createMxfToolListErrorPayload,
    MxfToolListEventData,
    MxfToolListResultEventData,
    MxfToolListErrorEventData,
    BaseEventPayload 
} from '../../../shared/schemas/EventPayloadSchema';
import { CORE_MXF_TOOLS, getCoreToolsArray } from '../../../shared/constants/CoreTools';
import { Channel } from '../../../shared/models/channel';

/**
 * Simplified tool definition for socket communication
 */
export interface SocketMcpTool {
    name: string;
    description: string;
    inputSchema: any;
    enabled: boolean;
    providerId: string;
    channelId: string;
    parameters?: any;
    metadata?: any;
}

/**
 * McpService singleton for socket server
 */
export class McpService {
    private static instance: McpService | null = null;
    private logger: Logger;
    private validator = createStrictValidator('McpService');
    
    // Tools loaded from database
    private tools: Map<string, SocketMcpTool> = new Map();
    private databaseLoaded = false;
    private loadingPromise: Promise<void> | null = null;
    
    // Channel allowedTools cache for synchronous access
    private channelAllowedTools: Map<string, string[]> = new Map();

    private constructor() {
        this.logger = new Logger('debug', 'McpService', 'server');
        this.tools = new Map();
        this.loadingPromise = null;
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): McpService {
        if (!McpService.instance) {
            McpService.instance = new McpService();
        }
        return McpService.instance;
    }

    /**
     * Initialize service by loading tools from database and setting up event handlers
     */
    public async initialize(): Promise<void> {
        if (this.loadingPromise) {
            return this.loadingPromise;
        }

        this.loadingPromise = this.performInitialization();
        return this.loadingPromise;
    }

    /**
     * Perform initialization: load database and set up event handlers
     */
    private async performInitialization(): Promise<void> {
        // Load tools from database
        await this.performDatabaseLoad();
        
        // Set up event handlers
        this.setupEventHandlers();
    }

    /**
     * Load tools from database (similar to McpToolRegistry)
     */
    private async performDatabaseLoad(): Promise<void> {
        try {
            
            // Get all tools from the database
            const dbTools = await firstValueFrom(from(listAllMcpTools()));
            
            
            // Clear existing tools
            this.tools.clear();
            
            // Convert database tools to socket tool format
            for (const dbTool of dbTools) {
                const socketTool: SocketMcpTool = {
                    name: dbTool.name,
                    description: dbTool.description || '',
                    inputSchema: dbTool.inputSchema || {},
                    enabled: true,
                    providerId: dbTool.providerId,
                    channelId: dbTool.channelId,
                    parameters: dbTool.parameters,
                    metadata: dbTool.metadata || {}
                };
                
                this.tools.set(dbTool.name, socketTool);
            }
            
            this.databaseLoaded = true;
            
        } catch (error) {
            this.logger.error(`Failed to load tools from database: ${error}`);
            throw error;
        }
    }

    /**
     * Set up MXF tool list event handlers
     */
    private setupEventHandlers(): void {
        // Handle MXF_TOOL_LIST requests
        EventBus.server.on(Events.Mcp.MXF_TOOL_LIST, async (payload: BaseEventPayload<MxfToolListEventData>) => {
            try {                
                // Validate payload
                this.validator.assertIsNonEmptyString(payload.agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(payload.channelId, 'channelId is required');

                // 🚨 CRITICAL: Look up agent configuration to get allowedTools from in-memory AgentService
                let allowedTools: string[] | undefined;
                try {
                    // Get agent data from the in-memory AgentService (where agents register)
                    const agentService = AgentService.getInstance();
                    const agentData = agentService.getAgent(payload.agentId);
                    allowedTools = agentData?.allowedTools;



                    // Log the filtering strategy clearly
                    if (!allowedTools || allowedTools.length === 0) {
                    } else {
                    }
                } catch (error) {
                    this.logger.warn(`Failed to lookup agent config for ${payload.agentId}: ${error}`);
                }

                // Get tools with optional filter including channelId, allowedTools, and agentId
                const filter = {
                    ...payload.data?.filter || {},
                    channelId: payload.channelId, // Pass channelId for channel-level tool filtering
                    allowedTools: allowedTools,
                    agentId: payload.agentId // Pass agentId for Meilisearch readiness check
                };
                const tools = this.getTools(filter);


                // Send response using proper payload helper
                const responseData: MxfToolListResultEventData = {
                    tools: tools,
                    requestId: payload.data?.requestId,
                    count: tools.length
                };

                const responsePayload = createMxfToolListResultPayload(
                    Events.Mcp.MXF_TOOL_LIST_RESULT,
                    payload.agentId,  // Use actual agent ID, not 'SYSTEM_AGENT'
                    payload.channelId,
                    responseData
                );

                EventBus.server.emit(Events.Mcp.MXF_TOOL_LIST_RESULT, responsePayload);

            } catch (error) {
                this.logger.error(`Error handling MXF_TOOL_LIST: ${error}`);
                
                // Send error response using proper payload helper
                const errorData: MxfToolListErrorEventData = { 
                    error: error instanceof Error ? error.message : String(error),
                    requestId: payload.data?.requestId
                };

                const errorPayload = createMxfToolListErrorPayload(
                    Events.Mcp.MXF_TOOL_LIST_ERROR,
                    'SYSTEM_AGENT',
                    payload.channelId,
                    errorData
                );

                EventBus.server.emit(Events.Mcp.MXF_TOOL_LIST_ERROR, errorPayload);
            }
        });

    }

    /**
     * Get all tools as array (for socket communication)
     */
    public getTools(filter?: { name?: string; channelId?: string; allowedTools?: string[]; agentId?: string }): SocketMcpTool[] {
        if (!this.databaseLoaded) {
            this.logger.warn('Tools requested before database load completed');
            return [];
        }

        if (filter?.agentId) {
        }

        // Check if hybrid registry is available for external tools
        const hybridRegistry = (global as any).hybridMcpToolRegistry;
        let allTools: SocketMcpTool[] = [];

        if (hybridRegistry) {
            // Get tools from hybrid registry (includes external tools)
            const hybridTools = hybridRegistry.getAllToolsSnapshot();
            // ;

            // Convert hybrid tools to socket format
            allTools = hybridTools.map((tool: any) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema || {},
                enabled: tool.enabled !== false,
                providerId: tool.source || 'internal',
                channelId: 'global', // External tools are globally available
                parameters: tool.inputSchema,
                metadata: {
                    category: tool.category,
                    source: tool.source,
                    isExternal: tool.isExternal
                }
            }));
        } else {
            // Fallback to database tools only
            this.logger.warn('Hybrid registry not available, using database tools only');
            allTools = Array.from(this.tools.values());
        }

        // Apply filters if provided
        if (filter) {
            if (filter.name) {
                allTools = allTools.filter(tool => tool.name.includes(filter.name!));
            }
            if (filter.channelId) {
                // Global-scoped tools (internal or external) are available to all channels
                // 'global' = hybrid registry tools, 'system' = database tools (fallback)
                allTools = allTools.filter(tool => 
                    tool.metadata?.isExternal ||  // External tools are global
                    tool.channelId === 'global' ||  // Hybrid registry internal tools
                    tool.channelId === 'system' ||  // Database system tools (fallback path)
                    tool.channelId === filter.channelId  // Channel-specific tools
                );
            }
        }
        
        // 🚨 CRITICAL: Filter out Meilisearch tools FIRST if not ready or disabled
        // This must happen BEFORE allowedTools filtering to ensure search tools
        // are never available when Meilisearch is disabled or not ready
        // Track which tools are being filtered out for better logging later
        const filteredOutTools: string[] = [];
        const meilisearchEnabled = process.env.ENABLE_MEILISEARCH === 'true';
        if (meilisearchEnabled && filter?.agentId) {
            const agentService = AgentService.getInstance();
            const agentData = agentService.getAgent(filter.agentId);
            const meilisearchReady = agentData?.meilisearchReady || false;

            if (!meilisearchReady) {
                const beforeCount = allTools.length;
                const searchTools = allTools.filter(tool => tool.name.startsWith('memory_search_'));
                filteredOutTools.push(...searchTools.map(t => t.name));
                allTools = allTools.filter(tool => !tool.name.startsWith('memory_search_'));
            }
        } else if (!meilisearchEnabled) {
            const beforeCount = allTools.length;
            const searchTools = allTools.filter(tool => tool.name.startsWith('memory_search_'));
            if (searchTools.length > 0) {
                filteredOutTools.push(...searchTools.map(t => t.name));
            }
            allTools = allTools.filter(tool => !tool.name.startsWith('memory_search_'));
            if (beforeCount > allTools.length) {
            }
        }

        // 🚨 SECURITY: Apply channel-level tool restrictions FIRST
        // If channel has non-empty allowedTools, restrict to those tools only
        if (filter?.channelId) {
            const channelAllowedTools = this.channelAllowedTools.get(filter.channelId);
            if (channelAllowedTools && channelAllowedTools.length > 0) {
                // Channel has tool restrictions - filter to only allowed tools
                const beforeChannelFilter = allTools.length;
                allTools = allTools.filter(tool => channelAllowedTools.includes(tool.name));
                if (beforeChannelFilter !== allTools.length) {
                    this.logger.debug(`Channel ${filter.channelId} tool filter: ${beforeChannelFilter} -> ${allTools.length} tools`);
                }
            }
        }

        // 🚨 CRITICAL: ALWAYS apply tool restrictions for agents
        // Agents should NEVER get all 189 tools - only core MXF tools at most
        if (filter && filter.allowedTools !== undefined) {
            // allowedTools explicitly specified (could be empty array)
            if (filter.allowedTools.length > 0) {
                // Specific tools requested - filter to only those that are available
                const originalCount = allTools.length;


                allTools = allTools.filter(tool => filter.allowedTools!.includes(tool.name));


                const missing = filter.allowedTools.filter(name =>
                    !allTools.find(t => t.name === name)
                );
                if (missing.length > 0) {
                    // Separate tools that were intentionally filtered vs truly missing
                    const intentionallyFiltered = missing.filter(name => filteredOutTools.includes(name));
                    const actuallyMissing = missing.filter(name => !filteredOutTools.includes(name));

                    if (intentionallyFiltered.length > 0) {
                    }
                    if (actuallyMissing.length > 0) {
                        this.logger.warn(`⚠️  Requested tools NOT FOUND in registry: ${actuallyMissing.join(', ')}`);
                    }
                }
            } else {
                // Empty array means no tools allowed
                allTools = [];
            }
        } else {
            // No allowedTools specified (undefined) - use core MXF tools as default
            // NEVER give agents all 189 tools
            const originalCount = allTools.length;
            const coreTools = getCoreToolsArray();

            const availableTools = allTools.map(t => t.name);
            const missingCoreTools = coreTools.filter(ct => !availableTools.includes(ct));
            if (missingCoreTools.length > 0) {
                this.logger.warn(`⚠️ Missing core tools from registry: ${missingCoreTools.join(', ')}`);
            }

            allTools = allTools.filter(tool => coreTools.includes(tool.name));
        }

        // Filter out mxpOptions from tools if MXP is not enabled for the agent
        // Check agent's mxpEnabled flag and only remove mxpOptions if MXP is disabled
        let mxpEnabled = false;
        if (filter?.agentId) {
            const agentService = AgentService.getInstance();
            const agentData = agentService.getAgent(filter.agentId);
            // Check agent metadata for mxpEnabled flag (set during agent configuration)
            mxpEnabled = agentData?.metadata?.mxpEnabled === true;
        }

        // Only filter out mxpOptions if MXP is not enabled for this agent
        if (!mxpEnabled) {
            allTools = allTools.map(tool => {
                // Only modify tools that have mxpOptions in their input schema
                if (tool.inputSchema?.properties?.mxpOptions) {
                    // Clone the tool to avoid mutating the original
                    const clonedTool = JSON.parse(JSON.stringify(tool));
                    // Remove mxpOptions from the input schema properties
                    delete clonedTool.inputSchema.properties.mxpOptions;
                    // Update description to remove MXP references if present
                    if (clonedTool.description?.includes('MXP')) {
                        clonedTool.description = clonedTool.description.replace('. Supports MXP protocol for structured communication', '');
                    }
                    return clonedTool;
                }
                return tool;
            });
        }

        return allTools;
    }

    /**
     * Get a specific tool by name
     */
    public getTool(name: string): SocketMcpTool | null {
        this.validator.assertIsNonEmptyString(name, 'Tool name is required');
        
        // Check hybrid registry first
        const hybridRegistry = (global as any).hybridMcpToolRegistry;
        if (hybridRegistry) {
            const hybridTool = hybridRegistry.findTool(name);
            if (hybridTool) {
                // Convert to socket format
                return {
                    name: hybridTool.name,
                    description: hybridTool.description,
                    inputSchema: hybridTool.inputSchema || {},
                    enabled: hybridTool.enabled !== false,
                    providerId: hybridTool.source || 'internal',
                    channelId: 'global',
                    parameters: hybridTool.inputSchema,
                    metadata: {
                        category: hybridTool.category,
                        source: hybridTool.source,
                        isExternal: hybridTool.isExternal
                    }
                };
            }
        }
        
        // Fallback to database tools
        return this.tools.get(name) || null;
    }

    /**
     * Check if service is ready
     */
    public isReady(): boolean {
        return this.databaseLoaded;
    }

    /**
     * Get tool count
     */
    public getToolCount(): number {
        const hybridRegistry = (global as any).hybridMcpToolRegistry;
        if (hybridRegistry) {
            const tools = hybridRegistry.getAllToolsSnapshot();
            return tools.length;
        }
        return this.tools.size;
    }

    /**
     * Set channel allowed tools for synchronous filtering in getTools
     * Called when channel is created or updated
     * Also persists to database for write-back sync
     */
    public async setChannelAllowedTools(channelId: string, allowedTools: string[]): Promise<void> {
        // Update in-memory cache
        this.channelAllowedTools.set(channelId, allowedTools);
        
        // Persist to database (write-back sync)
        try {
            const result = await Channel.updateOne(
                { channelId },
                { $set: { allowedTools } }
            );
            if (result.modifiedCount > 0) {
                this.logger.info(`Channel ${channelId} allowedTools updated in database (${allowedTools.length} tools)`);
            }
        } catch (error) {
            this.logger.error(`Error persisting allowedTools for channel ${channelId}: ${error}`);
        }
    }

    /**
     * Get channel allowed tools from cache
     */
    public getChannelAllowedTools(channelId: string): string[] | undefined {
        return this.channelAllowedTools.get(channelId);
    }

    /**
     * Clear channel allowed tools cache entry
     */
    public clearChannelAllowedTools(channelId: string): void {
        this.channelAllowedTools.delete(channelId);
    }
}
