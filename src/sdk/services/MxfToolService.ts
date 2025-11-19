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
 * ToolService - Client-side tool management
 * 
 * Handles tool requests via socket events and caches tools locally
 */

import { Logger } from '../../shared/utils/Logger';
import { Events } from '../../shared/events/EventNames';
import { EventBus } from '../../shared/events/EventBus';
import { 
    createMxfToolListPayload, 
    MxfToolListEventData,
    MxfToolListResultEventData,
    BaseEventPayload 
} from '../../shared/schemas/EventPayloadSchema';
import { createStrictValidator } from '../../shared/utils/validation';

/**
 * Public interface for MxfToolService - only exposes what developers should use
 */
export interface IToolService {
    loadTools(filter?: { name?: string; channelId?: string }): Promise<ClientTool[]>;
    getCachedTools(): ClientTool[];
    isLoaded(): boolean;
    getToolCount(): number;
    getTool(name: string): ClientTool | null;
    setupPersistentToolListener(): void;
    onToolsUpdated(callback: (tools: ClientTool[]) => void): void;
    cleanup(): void;
}

/**
 * Tool interface for client-side use
 */
export interface ClientTool {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    enabled: boolean;
    providerId: string;
    channelId: string;
    parameters?: any;
    metadata?: any;
}

/**
 * ToolService for client-side tool management
 */
export class MxfToolService implements IToolService {
    private logger: Logger;
    private validator = createStrictValidator('ToolService');

    // Cached tools
    private tools: ClientTool[] = [];
    private toolsLoaded = false;
    private loadingPromise: Promise<ClientTool[]> | null = null;

    // Persistent listener for unsolicited tool updates
    private persistentListenerActive = false;
    private toolUpdateCallbacks: Array<(tools: ClientTool[]) => void> = [];
    private lastUpdateHash: string = '';  // Deduplication: track last update to prevent redundant regeneration

    constructor(private agentId: string, private channelId: string) {
        this.logger = new Logger('debug', `ToolService-${agentId}`, 'client');
    }

    /**
     * Load tools from server via socket event
     */
    public async loadTools(filter?: { name?: string; channelId?: string }, force?: boolean): Promise<ClientTool[]> {
        // If already loading, return the existing promise (unless force=true)
        if (this.loadingPromise && !force) {
            return this.loadingPromise;
        }

        // If already loaded and no filter and not forcing refresh, return cached tools
        if (this.toolsLoaded && !filter && !force) {
            return this.tools;
        }

        this.loadingPromise = this.performToolLoad(filter);
        return this.loadingPromise;
    }

    /**
     * Perform the actual tool loading via socket event
     */
    private performToolLoad(filter?: { name?: string; channelId?: string }): Promise<ClientTool[]> {
        return new Promise((resolve, reject) => {
            try {
                // Generate request ID for tracking
                const requestId = `tool-load-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                

                // Set up result handler
                const resultSubscription = EventBus.client.on(Events.Mcp.MXF_TOOL_LIST_RESULT, (payload: BaseEventPayload<MxfToolListResultEventData>) => {
                    if (payload.data.requestId === requestId) {
                        try {
                            // Clean up handlers
                            clearTimeout(timeoutHandle);
                            resultSubscription.unsubscribe();
                            errorSubscription.unsubscribe();
                            
                            // Update cache
                            this.tools = payload.data.tools;
                            this.toolsLoaded = true;
                            this.loadingPromise = null;
                            
                            resolve(this.tools);
                        } catch (parseError) {
                            this.logger.error(`Error parsing tool list response: ${parseError}`);
                            reject(parseError);
                        }
                    }
                });

                // Set up error handler
                const errorSubscription = EventBus.client.on(Events.Mcp.MXF_TOOL_LIST_ERROR, (payload: any) => {
                    if (payload.data.requestId === requestId) {
                        try {
                            // Clean up handlers
                            clearTimeout(timeoutHandle);
                            resultSubscription.unsubscribe();
                            errorSubscription.unsubscribe();
                            
                            this.loadingPromise = null;
                            const errorMessage = payload.data?.error || 'Unknown tool list error';
                            this.logger.error(`Tool list error: ${errorMessage}`);
                            reject(new Error(errorMessage));
                        } catch (parseError) {
                            this.logger.error(`Error parsing tool list error response: ${parseError}`);
                            reject(parseError);
                        }
                    }
                });

                // Add timeout mechanism
                const timeoutHandle = setTimeout(() => {
                    resultSubscription.unsubscribe();
                    errorSubscription.unsubscribe();
                    this.loadingPromise = null;
                    
                    const errorMessage = `Tool list request timed out after 10 seconds for requestId ${requestId}`;
                    this.logger.error(errorMessage);
                    reject(new Error(errorMessage));
                }, 10000); // 10 second timeout

                // Send request
                const requestData: MxfToolListEventData = {
                    filter: filter,
                    requestId: requestId
                };

                const requestPayload = createMxfToolListPayload(
                    Events.Mcp.MXF_TOOL_LIST,
                    this.agentId,
                    this.channelId,
                    requestData
                );

                EventBus.client.emit(Events.Mcp.MXF_TOOL_LIST, requestPayload);
                
            } catch (error) {
                this.loadingPromise = null;
                this.logger.error(`Error sending tool list request: ${error}`);
                reject(error);
            }
        });
    }

    /**
     * Get cached tools synchronously
     */
    public getCachedTools(): ClientTool[] {
        return this.tools;
    }

    /**
     * Check if tools are loaded
     */
    public isLoaded(): boolean {
        return this.toolsLoaded;
    }

    /**
     * Get tool count
     */
    public getToolCount(): number {
        return this.tools.length;
    }

    /**
     * Get a specific tool by name
     */
    public getTool(name: string): ClientTool | null {
        this.validator.assertIsNonEmptyString(name, 'Tool name is required');
        return this.tools.find(tool => tool.name === name) || null;
    }

    /**
     * Clear cached tools (force reload on next request)
     */
    private clearCache(): void {
        this.tools = [];
        this.toolsLoaded = false;
        this.loadingPromise = null;
    }

    /**
     * Set up a persistent listener for unsolicited tool list updates from the server
     * This handles cases like Meilisearch backfill completion where the server sends new tools
     */
    public setupPersistentToolListener(): void {
        if (this.persistentListenerActive) {
            return;
        }


        // Listen for ALL MXF_TOOL_LIST_RESULT events, not just ones with matching requestId
        EventBus.client.on(Events.Mcp.MXF_TOOL_LIST_RESULT, (payload: BaseEventPayload<MxfToolListResultEventData>) => {
            try {
                // CRITICAL: Only process events for THIS agent
                // Events are broadcast to entire channel, so we must filter by agentId
                if (payload.agentId !== this.agentId) {
                    return;
                }

                const tools = payload.data.tools;
                const count = tools?.length || 0;

                // Check if this is an unsolicited update (no requestId or special requestId)
                const requestId = payload.data.requestId;
                const isUnsolicitedUpdate = requestId?.startsWith('meilisearch-ready-');

                if (isUnsolicitedUpdate) {
                    // Deduplication: Deep hash of tool definitions to detect schema/description changes
                    const currentHash = this.generateToolHash(tools);

                    if (currentHash === this.lastUpdateHash) {
                        return;
                    }

                    this.lastUpdateHash = currentHash;

                    // Update cache
                    this.tools = tools;
                    this.toolsLoaded = true;

                    // Notify all registered callbacks
                    this.toolUpdateCallbacks.forEach(callback => {
                        try {
                            callback(tools);
                        } catch (error) {
                            this.logger.error(`Error in tool update callback: ${error}`);
                        }
                    });

                }
            } catch (error) {
                this.logger.error(`Error handling persistent tool update: ${error}`);
            }
        });

        this.persistentListenerActive = true;
    }

    /**
     * Register a callback to be notified when tools are updated
     * Useful for regenerating system prompts with new tools
     */
    public onToolsUpdated(callback: (tools: ClientTool[]) => void): void {
        this.toolUpdateCallbacks.push(callback);
    }

    /**
     * Generate deep hash of tool definitions to detect any changes
     * Includes name, description, and inputSchema to catch all meaningful updates
     */
    private generateToolHash(tools: ClientTool[]): string {
        // Sort tools by name for consistent ordering
        const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));

        // Create deterministic string representation of relevant properties
        // Omit metadata and channelId as they change frequently without affecting functionality
        const toolsString = JSON.stringify(sortedTools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            providerId: t.providerId,
            enabled: t.enabled
        })));

        // Use simple hash function for deduplication
        return this.simpleHash(toolsString);
    }

    /**
     * Simple hash function for string-based deduplication
     * Not cryptographically secure, but sufficient for detecting changes
     */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    /**
     * Cleanup method for proper resource management
     * Should be called when agent disconnects
     */
    public cleanup(): void {
        this.tools = [];
        this.toolsLoaded = false;
        this.loadingPromise = null;
        this.persistentListenerActive = false;
        this.toolUpdateCallbacks = [];
        this.lastUpdateHash = '';
        // Note: EventBus subscriptions are cleaned up by EventBus.disconnect()
    }
}
