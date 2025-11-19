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
 * Channel Context
 * 
 * This module provides a semantic framework for agent interactions.
 * It maintains contextual information for channels, enabling more
 * meaningful and coherent agent communication.
 */

import { Observable } from 'rxjs';

/**
 * Type alias for Channel ID
 */
export type ChannelId = string;

/**
 * Type alias for Agent ID
 */
export type AgentId = string;

/**
 * Channel Context interface
 * 
 * Represents the context of a channel, including metadata,
 * participants, and conversation state.
 */
export interface ChannelContextType {
    id: ChannelId;
    channelId: ChannelId;
    name: string;
    description: string;
    createdAt: number;
    createdBy: AgentId;
    lastActivity: number;
    participants: AgentId[];
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
 * Channel metadata entry
 */
export interface ChannelMetadataEntry {
    key: string;
    value: any;
    timestamp: number;
    agentId: AgentId; // Agent that set this metadata
}

/**
 * Channel context history entry
 */
export interface ChannelContextHistoryEntry {
    /**
     * Type of operation
     */
    type: 'create' | 'update' | 'join' | 'leave';
    
    /**
     * Timestamp of the operation
     */
    timestamp: number;
    
    /**
     * Agent ID that performed the operation
     */
    agentId: AgentId;
    
    /**
     * Related data for the operation
     */
    data: Partial<ChannelContextType> | Record<string, any>;
}

/**
 * Message in a channel
 */
export interface ChannelMessage {
    messageId: string;
    content: string | Record<string, any>;
    senderId: AgentId;
    timestamp: number;
    type: 'text' | 'command' | 'response' | 'system';
    metadata?: Record<string, any>;
    receiverId?: AgentId;
    conversationId?: string;
    parentId?: string;
    threadId?: string;
}

/**
 * Topic in a channel conversation
 */
export interface ConversationTopic {
    id: string;
    topic: string;
    keywords: string[];
    relatedAgents: AgentId[];
    firstMentioned: number;
    lastMentioned: number;
    relevanceScore: number;
    messageReferences: string[]; // IDs of messages that mention this topic
}

/**
 * Channel context service interface
 */
export interface IChannelContextService {
    /**
     * Create a new channel context
     * @param channelId - Channel ID
     * @param name - Channel name
     * @param description - Channel description
     * @param creatorId - Creator agent ID
     */
    createContext(
        channelId: ChannelId,
        name: string,
        description: string,
        creatorId: AgentId
    ): Observable<ChannelContextType>;
    
    /**
     * Get channel context
     * @param channelId - Channel ID
     */
    getContext(channelId: ChannelId): Observable<ChannelContextType | null>;
    
    /**
     * Update channel context
     * @param channelId - Channel ID
     * @param updates - Context updates
     * @param agentId - Agent making the updates
     */
    updateContext(
        channelId: ChannelId,
        updates: Partial<ChannelContextType>,
        agentId: AgentId
    ): Observable<ChannelContextType>;
    
    /**
     * Add an agent to a channel
     * @param channelId - Channel ID
     * @param agentId - Agent ID to add
     */
    addAgentToChannel(
        channelId: ChannelId,
        agentId: AgentId
    ): Observable<ChannelContextType>;
    
    /**
     * Remove an agent from a channel
     * @param channelId - Channel ID
     * @param agentId - Agent ID to remove
     */
    removeAgentFromChannel(
        channelId: ChannelId,
        agentId: AgentId
    ): Observable<ChannelContextType>;
    
    /**
     * Set channel metadata
     * @param channelId - Channel ID
     * @param key - Metadata key
     * @param value - Metadata value
     * @param agentId - Agent setting the metadata
     */
    setMetadata(
        channelId: ChannelId,
        key: string,
        value: any,
        agentId: AgentId
    ): Observable<ChannelContextType>;
    
    /**
     * Get channel metadata
     * @param channelId - Channel ID
     * @param key - Metadata key (optional, if not provided returns all metadata)
     */
    getMetadata(
        channelId: ChannelId,
        key?: string
    ): Observable<Record<string, any> | any>;
    
    /**
     * Get channel context history
     * @param channelId - Channel ID
     * @param limit - Maximum number of history entries
     */
    getContextHistory(
        channelId: ChannelId,
        limit?: number
    ): Observable<ChannelContextHistoryEntry[]>;
    
    /**
     * Delete a channel context
     * @param channelId - Channel ID
     */
    deleteContext(channelId: ChannelId): Observable<boolean>;
    
    /**
     * Add a message to the channel conversation history
     * @param channelId - Channel ID
     * @param message - Channel message
     */
    addMessage(
        channelId: ChannelId,
        message: ChannelMessage
    ): Observable<boolean>;
    
    /**
     * Get recent channel messages
     * @param channelId - Channel ID
     * @param limit - Maximum number of messages
     */
    getMessages(
        channelId: ChannelId,
        limit?: number
    ): Observable<ChannelMessage[]>;
    
    /**
     * Extract conversation topics from the channel
     * @param channelId - Channel ID
     * @param minRelevance - Minimum relevance score
     */
    extractConversationTopics(
        channelId: ChannelId,
        minRelevance?: number
    ): Observable<ConversationTopic[]>;
    
    /**
     * Generate a summary of the conversation in the channel
     * @param channelId - Channel ID
     * @param messageCount - Number of most recent messages to consider
     */
    generateConversationSummary(
        channelId: ChannelId,
        messageCount?: number
    ): Observable<string>;
    
    /**
     * Save context to memory system with proper validation and error handling
     * @param channelId - Channel ID
     * @param context - Channel context to save
     * @param historyEntry - Optional history entry to record with this update
     * @returns Observable of the saved context
     */
    saveContextToMemory(
        channelId: ChannelId,
        context: ChannelContextType,
        historyEntry?: ChannelContextHistoryEntry
    ): Observable<ChannelContextType>;
    
    /**
     * Get context from memory system with validation
     * @param channelId - Channel ID to retrieve context for
     * @returns Observable of channel context, creates a default one if not found
     */
    getContextFromMemory(channelId: ChannelId): Observable<ChannelContextType | null>;
}
