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
 * MCP Resource Handlers
 * Handles resource-related MCP events
 */
import { McpHandler } from './McpHandler';
import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import { createStrictValidator } from '../../shared/utils/validation';
import { BaseEventPayload, createBaseEventPayload, McpResourceErrorEventPayload, McpResourceResultEventPayload } from '../../shared/schemas/EventPayloadSchema';
import { McpResourceGetEventPayload, McpResourceEventData, McpResourceListEventPayload } from '../../shared/schemas/EventPayloadSchema';

/**
 * Handles MCP resource events for provider and consumer agents
 */
export class McpResourceHandlers extends McpHandler {
    private agentId: string;
    private channelId: string;
    protected validator = createStrictValidator('McpResourceHandlers');
    
    // Store subscriptions for proper cleanup
    private subscriptions: { unsubscribe: () => void }[] = [];
    
    /**
     * Create a new MCP resource handler
     * @param agentId Agent ID that owns this handler
     */
    constructor(channelId: string, agentId: string) {
        super(`McpResourceHandlers:${agentId}`);
        this.agentId = agentId;
        this.channelId = channelId;
    }
    
    /**
     * Clean up resource event handlers
     */
    public cleanup(): void {
        
        // Unsubscribe from all event subscriptions
        this.subscriptions.forEach(subscription => subscription.unsubscribe());
        this.subscriptions = [];
        
    }
    
    /**
     * Get a resource from the MCP server
     * @param id Resource ID to retrieve
     * @param channelId Channel ID where the resource exists
     * @returns Promise resolving to the resource data
     */
    private getResource = (id: string, channelId: string): Promise<any> => {
        return new Promise((resolve, reject) => {
            try {
                // Generate request ID
                const requestId = `resource-get-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                
                
                // Validate inputs
                this.validator.assertIsNonEmptyString(id);
                this.validator.assertIsNonEmptyString(channelId);
                
                // Set up result handler
                const resultSubscription = EventBus.client.on(Events.Mcp.RESOURCE_RESULT, (payload: McpResourceResultEventPayload) => {
                    if (payload.data.requestId === requestId) {
                        // Clean up handlers using subscriptions
                        resultSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        
                        resolve(payload.data.resource);
                    }
                });
                
                // Set up error handler
                const errorSubscription = EventBus.client.on(Events.Mcp.RESOURCE_ERROR, (payload: McpResourceErrorEventPayload) => {
                    if (payload.data.requestId === requestId) {
                        // Clean up handlers using subscriptions
                        resultSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        
                        this.logger.error(`Resource get error for ${id}: ${payload.data.error}`);
                        reject(new Error(payload.data.error));
                    }
                });
                
                // Register handlers
                this.subscriptions.push(resultSubscription);
                this.subscriptions.push(errorSubscription);
                
                // Send resource get request
                const mcpDataForGet: McpResourceEventData & { requestId: string } = {
                    requestId: requestId,
                    resourceUri: id, // 'id' parameter is the resource URI
                    // resourceType: undefined, // Optionally set if known
                };
                const getPayload: McpResourceGetEventPayload = createBaseEventPayload(
                    Events.Mcp.RESOURCE_GET,
                    this.agentId,
                    channelId, // Use the method parameter channelId
                    mcpDataForGet
                );
                EventBus.client.emit(Events.Mcp.RESOURCE_GET, getPayload);
            } catch (error) {
                this.logger.error(`Error getting resource: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
        });
    };
    
    /**
     * List available resources from the MCP server
     * @param filter Optional filter for resources
     * @param channelId Channel ID to list resources from
     * @returns Promise resolving to array of resources
     */
    private listResources = (filter: string | undefined, channelId: string): Promise<any[]> => {
        return new Promise((resolve, reject) => {
            try {
                // Generate request ID
                const requestId = `resource-list-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                
                
                // Validate inputs
                this.validator.assertIsNonEmptyString(channelId);
                
                // Set up result handler
                const resultSubscription = EventBus.client.on(Events.Mcp.RESOURCE_LIST_RESULT, (payload: McpResourceListEventPayload) => {
                    if (payload.data.requestId === requestId) {
                        // Clean up handlers using subscriptions
                        resultSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        
                        resolve(payload.data.resources || []);
                    }
                });
                
                // Set up error handler
                const errorSubscription = EventBus.client.on(Events.Mcp.RESOURCE_ERROR, (payload: McpResourceErrorEventPayload) => {
                    if (payload.data.requestId === requestId) {
                        // Clean up handlers using subscriptions
                        resultSubscription.unsubscribe();
                        errorSubscription.unsubscribe();
                        
                        this.logger.error(`Resource list error: ${payload.data.error}`);
                        reject(new Error(payload.data.error));
                    }
                });
                
                // Register handlers
                this.subscriptions.push(resultSubscription);
                this.subscriptions.push(errorSubscription);
                
                // Send resource list request
                const mcpDataForList: McpResourceEventData & { requestId: string; filter?: any } = {
                    requestId: requestId,
                    resourceUri: '/', // Assuming '/' as a generic scope for listing within the channel
                    // resourceType: undefined, // Optionally set if applicable for list context
                    filter: filter
                };
                const listPayload: McpResourceListEventPayload = createBaseEventPayload(
                    Events.Mcp.RESOURCE_LIST,
                    this.agentId,
                    channelId, // Use the method parameter channelId
                    mcpDataForList
                );
                EventBus.client.emit(Events.Mcp.RESOURCE_LIST, listPayload);
            } catch (error) {
                this.logger.error(`Error listing resources: ${error instanceof Error ? error.message : String(error)}`);
                reject(error);
            }
        });
    };
}
