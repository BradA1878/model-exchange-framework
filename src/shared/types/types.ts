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
 * Common type definitions for the MXF
 * 
 * This file contains common type definitions used throughout the framework.
 */

/**
 * Type alias for Channel ID
 */
export type ChannelId = string;

/**
 * Type alias for Agent ID
 */
export type AgentId = string;

/**
 * Connection status enum
 */
export enum ConnectionStatus {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    REGISTERED = 'registered', // Added to support registration state
    ERROR = 'error'
}

/**
 * Channel Context interface
 * 
 * Represents the context of a channel, including metadata,
 * participants, and conversation state.
 */
export interface ChannelContext {
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
    topics?: {
        id: string;
        topic: string;
        keywords: string[];
        relevance: number;
    }[];
}

/**
 * Task request interface
 */
export interface TaskRequest {
    taskId: string;
    fromAgentId: string;
    toAgentId: string;
    content: any;
    metadata?: Record<string, any>;
}

/**
 * Task response interface
 */
export interface TaskResponse {
    taskId: string;
    fromAgentId: string;
    toAgentId: string;
    content: any;
    status: 'success' | 'error' | 'pending';
    metadata?: Record<string, any>;
}
