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

import axios from 'axios';
import { createStrictValidator } from '../../shared/utils/validation';
import { Logger } from '../../shared/utils/Logger';

/**
 * Agent context interface - read-only part of agent data
 */
export interface AgentContext {
    keyId: string;
    identity?: string;
    role?: string;
    specialization?: string;
    instructions?: string;
    constraints?: string[];
    examples?: string[];
}

/**
 * Agent memory interface - read/write part of agent data
 */
export interface AgentMemory {
    keyId: string;
    notes?: Record<string, any>;
    conversationHistory?: any[];
    customData?: Record<string, any>;
    updatedAt?: Date;
}

/**
 * Channel context interface - matches server-side ChannelContextType
 */
export interface ChannelContext {
    id: string;
    channelId: string;
    name: string;
    description: string;
    createdAt: number;
    createdBy: string; // AgentId
    lastActivity: number;
    participants: string[]; // AgentId[]
    metadata: Record<string, any>;
    status: 'active' | 'inactive' | 'archived';
    messageCount: number;
    conversationSummary?: string;
    updatedAt: number;
    topics?: {
        id: string;
        topic: string;
        keywords: string[];
        relevance: number;
    }[];
}

/**
 * Conversation topic interface - matches server-side ConversationTopic
 */
export interface ConversationTopic {
    id: string;
    topic: string;
    keywords: string[];
    relatedAgents: string[];
    firstMentioned: number;
    lastMentioned: number;
    relevanceScore: number;
    messageReferences: string[];
}

/**
 * Channel context history entry interface
 */
export interface ChannelContextHistoryEntry {
    type: 'create' | 'update' | 'join' | 'leave';
    timestamp: number;
    agentId: string;
    data: any;
}

/**
 * Channel message interface
 */
export interface ChannelMessage {
    messageId: string;
    content: string | Record<string, any>;
    senderId: string;
    timestamp: number;
    type: 'text' | 'command' | 'response' | 'system';
    metadata?: Record<string, any>;
}

/**
 * Channel memory interface - read/write part of channel data
 */
export interface ChannelMemory {
    channelId: string;
    notes?: Record<string, any>;
    sharedState?: Record<string, any>;
    conversationHistory?: any[];
    customData?: Record<string, any>;
    updatedAt?: Date;
}

/**
 * API Service Configuration
 */
export interface ApiServiceConfig {
    baseUrl: string;
    keyId?: string;
    secretKey?: string;
    timeout?: number;
    logger?: Logger;
}

/**
 * API Service for the MXF SDK
 * 
 * Provides HTTP API access to server endpoints for context, memory, and other features.
 * 
 * Includes interfaces for channel context operations and memory functionality.
 */
export class ApiService {
    private baseUrl: string;
    private keyId?: string;
    private secretKey?: string;
    private timeout: number;
    private validator = createStrictValidator('ApiService');
    private logger: Logger;

    /**
     * Create a new API service instance
     * 
     * @param config Service configuration
     */
    constructor(config: ApiServiceConfig) {
        // Validate configuration
        this.validator.assertIsObject(config);
        this.validator.assertIsNonEmptyString(config.baseUrl);
        
        // Initialize properties
        this.baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
        this.keyId = config.keyId;
        this.secretKey = config.secretKey;
        this.timeout = config.timeout || 10000; // Default 10s timeout
        this.logger = config.logger || new Logger('debug', 'ApiService', 'client');
    }
    
    /**
     * Make an authenticated API request
     * 
     * @param method HTTP method
     * @param path API path (without leading slash)
     * @param data Optional request body
     * @returns API response
     */
    private async request<T>(method: string, path: string, data?: any): Promise<T> {
        try {
            // Ensure path is properly formatted
            const url = `${this.baseUrl}/${path.startsWith('/') ? path.substring(1) : path}`;
            
            // Create request configuration
            const config: any = {
                method,
                url,
                timeout: this.timeout,
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            // Add auth headers if credentials are available
            if (this.keyId && this.secretKey) {
                config.headers['x-key-id'] = this.keyId;
                config.headers['x-secret-key'] = this.secretKey;
            }
            
            // Add request data for non-GET requests
            if (method !== 'GET' && data) {
                config.data = data;
            }
            
            // Make request
            const response = await axios(config);
            return response.data as T;
        } catch (error: any) {
            if (error.response) {
                throw new Error(`API error (${error.response.status}): ${error.response.data?.message || error.message}`);
            }
            throw error;
        }
    }
    
    /**
     * Fetch agent context by key ID
     * 
     * @param keyId Agent's API key ID
     * @returns Promise resolving to agent context
     */
    public async fetchAgentContext(keyId: string): Promise<AgentContext> {
        this.validator.assertIsNonEmptyString(keyId);
        return this.request<AgentContext>('GET', `agents/context/${keyId}`);
    }
    
    /**
     * Get or create agent memory by key ID
     * 
     * @param keyId Agent's API key ID
     * @returns Promise resolving to agent memory
     */
    public async getOrCreateAgentMemory(keyId: string): Promise<AgentMemory> {
        this.validator.assertIsNonEmptyString(keyId);
        return this.request<AgentMemory>('GET', `agents/memory/${keyId}`);
    }
    
    /**
     * Update agent memory
     * 
     * @param keyId Agent's API key ID
     * @param update Memory updates to apply
     * @returns Promise resolving to updated agent memory
     */
    public async updateAgentMemory(keyId: string, update: Partial<AgentMemory>): Promise<AgentMemory> {
        this.validator.assertIsNonEmptyString(keyId);
        this.validator.assertIsObject(update);
        return this.request<AgentMemory>('PATCH', `agents/memory/${keyId}`, update);
    }
    
    /**
     * Fetch channel context by channel ID
     * 
     * @param channelId Channel ID
     * @returns Promise resolving to channel context
     */
    public async fetchChannelContext(channelId: string): Promise<ChannelContext> {
        this.validator.assertIsNonEmptyString(channelId);
        return this.request<ChannelContext>('GET', `channels/context/${channelId}`);
    }
    
    /**
     * Get or create channel memory by channel ID
     * 
     * @param channelId Channel ID
     * @returns Promise resolving to channel memory
     */
    public async getOrCreateChannelMemory(channelId: string): Promise<ChannelMemory> {
        this.validator.assertIsNonEmptyString(channelId);
        return this.request<ChannelMemory>('GET', `channels/memory/${channelId}`);
    }
    
    /**
     * Update channel memory
     * 
     * @param channelId Channel ID
     * @param update Memory updates to apply
     * @returns Promise resolving to updated channel memory
     */
    public async updateChannelMemory(channelId: string, update: Partial<ChannelMemory>): Promise<ChannelMemory> {
        this.validator.assertIsNonEmptyString(channelId);
        this.validator.assertIsObject(update);
        return this.request<ChannelMemory>('PATCH', `channels/memory/${channelId}`, update);
    }
    
    /**
     * Generic GET request to the API
     * 
     * @param path API path
     * @returns Promise resolving to the response
     */
    public async get<T = any>(path: string): Promise<T> {
        this.validator.assertIsNonEmptyString(path);
        return this.request<T>('GET', path);
    }
    
    /**
     * Generic POST request to the API
     * 
     * @param path API path
     * @param data Request body
     * @returns Promise resolving to the response
     */
    public async post<T = any>(path: string, data: any): Promise<T> {
        this.validator.assertIsNonEmptyString(path);
        return this.request<T>('POST', path, data);
    }
    
    /**
     * Generic PATCH request to the API
     * 
     * @param path API path
     * @param data Request body
     * @returns Promise resolving to the response
     */
    public async patch<T = any>(path: string, data: any): Promise<T> {
        this.validator.assertIsNonEmptyString(path);
        return this.request<T>('PATCH', path, data);
    }
    
    /**
     * Get or create relationship memory between two agents
     * @param agentId First agent ID
     * @param otherAgentId Second agent ID
     * @param channelId Channel ID to scope the relationship to
     * @returns Promise resolving to relationship memory
     */
    public async getOrCreateRelationshipMemory(
        agentId: string,
        otherAgentId: string,
        channelId: string
    ): Promise<any> {
        try {
            // Construct the path to the relationship memory resource
            const path = `api/memory/relationships/${channelId}/${agentId}/${otherAgentId}`;
            
            // Try to get existing memory first
            const response = await this.get(path);
            
            // If relationship memory exists, return it
            if (response && response.success !== false) {
                return response;
            }
            
            // If no memory exists, create a new one with default structure
            const defaultMemory = {
                agentId,
                targetAgentId: otherAgentId,
                channelId,
                customData: {},
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            
            // Create new relationship memory
            const createResponse = await this.post(path, defaultMemory);
            return createResponse;
        } catch (error) {
            this.logger.error(`Failed to get or create relationship memory: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Update relationship memory between two agents
     * @param agentId First agent ID
     * @param otherAgentId Second agent ID
     * @param channelId Channel ID to scope the relationship to
     * @param update Memory data to update
     * @returns Promise resolving to updated relationship memory
     */
    public async updateRelationshipMemory(
        agentId: string,
        otherAgentId: string,
        channelId: string,
        update: any
    ): Promise<any> {
        try {
            // Construct the path to the relationship memory resource
            const path = `api/memory/relationships/${channelId}/${agentId}/${otherAgentId}`;
            
            // Add updatedAt timestamp to the update
            const updatedData = {
                ...update,
                updatedAt: Date.now()
            };
            
            // Update relationship memory
            const response = await this.patch(path, updatedData);
            return response;
        } catch (error) {
            this.logger.error(`Failed to update relationship memory: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Create a new channel context
     * 
     * @param channelId Channel ID
     * @param name Channel name
     * @param description Channel description
     * @param creatorId Creator agent ID
     * @returns Promise resolving to created channel context
     */
    public async createChannelContext(
        channelId: string,
        name: string,
        description: string,
        creatorId: string
    ): Promise<ChannelContext> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            this.validator.assertIsNonEmptyString(name, 'Channel name is required');
            this.validator.assertIsNonEmptyString(creatorId, 'Creator agent ID is required');
            
            // Make API request to create context
            const response = await this.post(`channels/${channelId}/context`, {
                name,
                description,
                creatorId
            });
            
            // Validate response
            if (!response || !response.channelId) {
                throw new Error('Invalid response from context creation API');
            }
            
            return response;
        } catch (error) {
            this.logger.error(`Failed to create context for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Add an agent to a channel
     * 
     * @param channelId Channel ID
     * @param agentId Agent ID to add
     * @returns Promise resolving to success status
     */
    public async addAgentToChannel(channelId: string, agentId: string): Promise<boolean> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            this.validator.assertIsNonEmptyString(agentId, 'Agent ID is required');
            
            // Make API request to add agent
            const response = await this.post(`channels/${channelId}/agents/${agentId}`, {});
            
            return response?.success === true;
        } catch (error) {
            this.logger.error(`Failed to add agent ${agentId} to channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Remove an agent from a channel
     * 
     * @param channelId Channel ID
     * @param agentId Agent ID to remove
     * @returns Promise resolving to success status
     */
    public async removeAgentFromChannel(channelId: string, agentId: string): Promise<boolean> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            this.validator.assertIsNonEmptyString(agentId, 'Agent ID is required');
            
            // Make API request to remove agent - use DELETE method based on the pattern in other methods
            const response = await this.request('DELETE', `channels/${channelId}/agents/${agentId}`);
            
            // Check if the response indicates success
            return Boolean(response && typeof response === 'object' && (response as any).success === true);
        } catch (error) {
            this.logger.error(`Failed to remove agent ${agentId} from channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Set channel metadata
     * 
     * @param channelId Channel ID
     * @param key Metadata key
     * @param value Metadata value
     * @param agentId Agent setting the metadata
     * @returns Promise resolving to success status
     */
    public async setChannelMetadata(
        channelId: string,
        key: string,
        value: any,
        agentId: string
    ): Promise<boolean> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            this.validator.assertIsNonEmptyString(key, 'Metadata key is required');
            this.validator.assertIsNonEmptyString(agentId, 'Agent ID is required');
            
            // Make API request to set metadata
            const response = await this.post(`channels/${channelId}/metadata/${key}`, {
                value,
                agentId
            });
            
            return response?.success === true;
        } catch (error) {
            this.logger.error(`Failed to set metadata for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get channel metadata
     * 
     * @param channelId Channel ID
     * @param key Optional metadata key (if not provided, returns all metadata)
     * @returns Promise resolving to metadata value or record of all metadata
     */
    public async getChannelMetadata(channelId: string, key?: string): Promise<any> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            
            // Make API request to get metadata
            const path = key ? 
                `channels/${channelId}/metadata/${key}` : 
                `channels/${channelId}/metadata`;
                
            const response = await this.get(path);
            
            return response?.metadata || (key ? null : {});
        } catch (error) {
            this.logger.error(`Failed to get metadata for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get channel context history
     * 
     * @param channelId Channel ID
     * @param limit Maximum number of history entries
     * @returns Promise resolving to array of history entries
     */
    public async getChannelContextHistory(
        channelId: string,
        limit?: number
    ): Promise<ChannelContextHistoryEntry[]> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            
            // Make API request to get history
            const response = await this.get(`channels/${channelId}/history${limit ? `?limit=${limit}` : ''}`);
            
            // Validate response
            if (!response || !Array.isArray(response.history)) {
                return [];
            }
            
            return response.history;
        } catch (error) {
            this.logger.error(`Failed to get history for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Add a message to the channel conversation history
     * 
     * @param channelId Channel ID
     * @param message Channel message to add
     * @returns Promise resolving to success status
     */
    public async addChannelMessage(channelId: string, message: ChannelMessage): Promise<boolean> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            this.validator.assertIsObject(message, 'Message must be an object');
            
            // Make API request to add message
            const response = await this.post(`channels/${channelId}/messages`, message);
            
            return response?.success === true;
        } catch (error) {
            this.logger.error(`Failed to add message to channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Get channel messages
     * 
     * @param channelId Channel ID
     * @param limit Maximum number of messages
     * @returns Promise resolving to array of channel messages
     */
    public async getChannelMessages(
        channelId: string,
        limit?: number
    ): Promise<ChannelMessage[]> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            
            // Make API request to get messages
            const response = await this.get(`channels/${channelId}/messages${limit ? `?limit=${limit}` : ''}`);
            
            // Validate response
            if (!response || !Array.isArray(response.messages)) {
                return [];
            }
            
            return response.messages;
        } catch (error) {
            this.logger.error(`Failed to get messages for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Extract conversation topics from recent channel messages
     * 
     * @param channelId Channel ID to extract topics from
     * @param minRelevance Minimum relevance score (0.0-1.0)
     * @returns Promise resolving to array of conversation topics
     */
    public async extractChannelTopics(channelId: string, minRelevance: number = 0.5): Promise<ConversationTopic[]> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            this.validator.assertIsInRange(minRelevance, 0, 1, 'Relevance must be between 0 and 1');
            
            // Make API request to extract topics
            const response = await this.post(`channels/${channelId}/topics`, { minRelevance });
            
            // Assert response contains topics array
            if (!response || !Array.isArray(response.topics)) {
                throw new Error('Invalid response from topic extraction API');
            }
            
            return response.topics;
        } catch (error) {
            this.logger.error(`Failed to extract topics for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Generate a summary of a channel's conversation
     * 
     * @param channelId Channel ID to summarize
     * @returns Promise resolving to conversation summary
     */
    public async generateChannelSummary(channelId: string): Promise<string> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            
            // Make API request to generate summary
            const response = await this.post(`channels/${channelId}/summary`, {});
            
            // Assert response contains summary
            if (!response || typeof response.summary !== 'string') {
                throw new Error('Invalid response from summary generation API');
            }
            
            return response.summary;
        } catch (error) {
            this.logger.error(`Failed to generate summary for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Update channel context
     * 
     * @param channelId Channel ID
     * @param updates Context updates to apply
     * @param agentId ID of the agent making the update
     * @returns Promise resolving to updated channel context
     */
    public async updateChannelContext(channelId: string, updates: any, agentId: string): Promise<ChannelContext> {
        try {
            this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
            this.validator.assertIsObject(updates, 'Updates must be an object');
            this.validator.assertIsNonEmptyString(agentId, 'Agent ID is required');
            
            // Make API request to update context
            const response = await this.patch(`channels/${channelId}/context`, {
                ...updates,
                updatedBy: agentId,
                updatedAt: Date.now()
            });
            
            // Validate response
            if (!response || !response.channelId) {
                throw new Error('Invalid response from context update API');
            }
            
            return response;
        } catch (error) {
            this.logger.error(`Failed to update context for channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
