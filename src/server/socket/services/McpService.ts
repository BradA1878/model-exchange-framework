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
 * McpService - Socket Server MCP Tool Management
 * 
 * Simple singleton service that loads MCP tools from database and provides
 * them via socket events to connected clients.
 */

import { Logger } from '@mxf-dev/core/utils/Logger';
import { listAllMcpTools } from '@mxf-dev/core/models/mcpTool';
import { Agent } from '@mxf-dev/core/models/agent';
import { firstValueFrom, from } from 'rxjs';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { AgentService } from './AgentService';
import { Events } from '@mxf-dev/core/events/EventNames';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { 
    createMxfToolListResultPayload, 
    createMxfToolListErrorPayload,
    MxfToolListEventData,
    MxfToolListResultEventData,
    MxfToolListErrorEventData,
    BaseEventPayload 
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { getCoreToolsArray } from '@mxf-dev/core/constants/CoreTools';
import { Channel } from '@mxf-dev/core/models/channel';
import { getHybridMcpToolRegistry } from '../../mcp/services/HybridMcpRegistryAccess';
import {
    getToolAuthorizationNames,
    isAllowedByAgentPolicy,
    isAllowedByChannelPolicy,
    isPrivilegedHostToolEnabled,
    isPrivilegedNetworkToolEnabled
} from './ToolAuthorizationPolicy';

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
        EventBus.server.on(Events.Mcp.MXF_TOOL_LIST, async (payload: BaseEventPayload<MxfToolListEventData> & {
            authorization?: { keyId: string; allowedTools?: string[] };
        }) => {
            try {                
                // Validate payload
                this.validator.assertIsNonEmptyString(payload.agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(payload.channelId, 'channelId is required');

                const authorization = payload.authorization;
                if (!authorization ||
                    typeof authorization.keyId !== 'string' ||
                    authorization.keyId.trim().length === 0 ||
                    (authorization.allowedTools !== undefined &&
                        !Array.isArray(authorization.allowedTools))) {
                    throw new Error('Credential-scoped tool policy is required for discovery');
                }
                const allowedTools = authorization.allowedTools;

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
                    payload.agentId,
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
        const hybridRegistry = getHybridMcpToolRegistry();
        let allTools: SocketMcpTool[] = [];

        if (hybridRegistry) {
            // When channelId is provided, use getAgentFacingToolsForChannel() to
            // get only global tools + channel-scoped tools for that specific
            // channel, with external tools under their raw (agent-facing) names.
            // This prevents cross-channel tool duplication (e.g., two channels
            // both registering fetch_weather would cause duplicate function errors
            // from LLM providers like Gemini), and it is what makes external
            // tools reachable at all: agent allowlists and LLM function names
            // speak raw names, never the namespaced registry names.
            const hybridTools = filter?.channelId
                ? hybridRegistry.getAgentFacingToolsForChannel(filter.channelId, filter.agentId)
                : hybridRegistry.getAllToolsSnapshot();

            // Convert hybrid tools to socket format, preserving scope metadata
            allTools = hybridTools.map((tool: any) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema || {},
                enabled: tool.enabled !== false,
                providerId: tool.source || 'internal',
                channelId: tool.scope === 'channel' ? (tool.scopeId || 'global') : 'global',
                parameters: tool.inputSchema,
                metadata: {
                    category: tool.category,
                    source: tool.source,
                    isExternal: tool.isExternal,
                    scope: tool.scope,
                    scopeId: tool.scopeId,
                    // The namespaced registry name behind an agent-facing external
                    // tool. Allowlists may use either name; execution resolves
                    // through resolveToolForChannel().
                    canonicalName: tool.canonicalName
                }
            }));
        } else {
            // Database-only path (hybrid registry not yet available)
            this.logger.warn('Hybrid registry not available, using database tools only');
            allTools = Array.from(this.tools.values());
        }

        // Apply filters if provided
        if (filter) {
            if (filter.name) {
                allTools = allTools.filter(tool => tool.name.includes(filter.name!));
            }
            if (filter.channelId && !hybridRegistry) {
                // Database-only fallback: filter by channelId when hybrid registry is unavailable.
                // When hybrid registry IS available, getToolsForChannel() already handles scoping.
                allTools = allTools.filter(tool =>
                    tool.channelId === 'global' ||
                    tool.channelId === 'system' ||
                    tool.channelId === filter.channelId
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
                allTools = allTools.filter(tool =>
                    isAllowedByChannelPolicy(getToolAuthorizationNames(tool), channelAllowedTools)
                );
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
                allTools = allTools.filter(tool =>
                    isAllowedByAgentPolicy(getToolAuthorizationNames(tool), filter.allowedTools)
                );


                const missing = filter.allowedTools.filter(name =>
                    !allTools.find(tool => getToolAuthorizationNames(tool).has(name))
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
            const coreTools = getCoreToolsArray();

            const availableTools = allTools.map(t => t.name);
            const missingCoreTools = coreTools.filter(ct => !availableTools.includes(ct));
            if (missingCoreTools.length > 0) {
                this.logger.warn(`⚠️ Missing core tools from registry: ${missingCoreTools.join(', ')}`);
            }

            allTools = allTools.filter(tool =>
                isAllowedByAgentPolicy(getToolAuthorizationNames(tool), undefined)
            );
        }

        allTools = allTools.filter(tool =>
            isPrivilegedHostToolEnabled(getToolAuthorizationNames(tool)) &&
            isPrivilegedNetworkToolEnabled(getToolAuthorizationNames(tool))
        );

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
        const hybridRegistry = getHybridMcpToolRegistry();
        if (hybridRegistry) {
            const hybridTool = hybridRegistry.findTool(name);
            if (hybridTool) {
                // Convert to socket format, preserving scope metadata
                return {
                    name: hybridTool.name,
                    description: hybridTool.description,
                    inputSchema: hybridTool.inputSchema || {},
                    enabled: hybridTool.enabled !== false,
                    providerId: hybridTool.source || 'internal',
                    channelId: hybridTool.scope === 'channel' ? (hybridTool.scopeId || 'global') : 'global',
                    parameters: hybridTool.inputSchema,
                    metadata: {
                        category: hybridTool.category,
                        source: hybridTool.source,
                        isExternal: hybridTool.isExternal,
                        scope: hybridTool.scope,
                        scopeId: hybridTool.scopeId
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
        const hybridRegistry = getHybridMcpToolRegistry();
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
        this.hydrateChannelAllowedTools(channelId, allowedTools);
        
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
     * Hydrate channel policy that was already read from persistence.
     *
     * This path is deliberately synchronous and cache-only so an authenticated
     * socket cannot finish joining a cold-loaded channel before its persisted
     * tool restriction is visible to the executor. An empty array retains the
     * channel contract of imposing no additional restriction.
     */
    public hydrateChannelAllowedTools(channelId: string, allowedTools: string[]): void {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
        if (!Array.isArray(allowedTools) ||
            allowedTools.some(toolName => (
                typeof toolName !== 'string' || toolName.trim().length === 0
            ))) {
            throw new Error('Channel allowedTools must be an array of non-empty strings');
        }

        this.channelAllowedTools.set(channelId, [...allowedTools]);
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
