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

import { IBaseRepository } from './IBaseRepository';

/**
 * Domain entity type for Channel (database-agnostic)
 */
export interface IChannelEntity {
    channelId: string;
    name: string;
    description?: string;
    customChannelId?: string;
    isPrivate: boolean;
    requireApproval: boolean;
    maxAgents: number;
    allowAnonymous: boolean;
    showActiveAgents: boolean;
    active: boolean;
    participants: string[];
    createdBy: string;
    context?: {
        topics?: Array<{
            id: string;
            topic: string;
            keywords: string[];
            relevance: number;
        }>;
        summary?: string;
        lastActivity: number;
        purpose?: string;
        guidelines?: string;
        instructions?: string;
        updatedAt?: Date;
    };
    sharedMemory?: {
        notes?: Record<string, any>;
        sharedState?: Record<string, any>;
        conversationHistory?: any[];
        customData?: Record<string, any>;
        updatedAt?: Date;
    };
    mcpServers?: {
        servers: Array<{
            id: string;
            name: string;
            config: Record<string, any>;
            registeredBy: string;
            registeredAt: Date;
            status: 'stopped' | 'starting' | 'running' | 'error';
            keepAliveMinutes?: number;
        }>;
        updatedAt?: Date;
    };
    verified: boolean;
    verificationMethod?: 'dns' | 'email' | 'file' | 'token';
    verificationToken?: string;
    verificationExpiry?: Date;
    createdAt: Date;
    updatedAt: Date;
    lastActive: Date;
    metadata: Record<string, any>;
    allowedTools?: string[];
    systemLlmEnabled?: boolean;
}

/**
 * Channel statistics interface
 */
export interface ChannelStatistics {
    participantCount: number;
    messageCount: number;
    taskCount: number;
    lastActiveAt: Date | null;
    createdAt: Date;
}

/**
 * Repository interface for Channel entities.
 */
export interface IChannelRepository extends IBaseRepository<IChannelEntity> {
    /**
     * Find channel by its unique channelId
     */
    findByChannelId(channelId: string): Promise<IChannelEntity | null>;

    /**
     * Find channels that an agent is a participant of
     */
    findByParticipant(agentId: string): Promise<IChannelEntity[]>;

    /**
     * Find channels created by a specific user/agent
     */
    findByCreator(creatorId: string): Promise<IChannelEntity[]>;

    /**
     * Add a participant to a channel
     * Ensures no duplicates are added
     */
    addParticipant(channelId: string, participantId: string): Promise<IChannelEntity | null>;

    /**
     * Remove a participant from a channel
     */
    removeParticipant(channelId: string, participantId: string): Promise<IChannelEntity | null>;

    /**
     * Get all participants of a channel
     */
    getParticipants(channelId: string): Promise<string[]>;

    /**
     * Check if an agent is a participant in a channel
     */
    isParticipant(channelId: string, agentId: string): Promise<boolean>;

    /**
     * Update channel's last active timestamp
     */
    updateLastActive(channelId: string, timestamp?: Date): Promise<void>;

    /**
     * Search channels by name (partial match)
     */
    searchByName(query: string): Promise<IChannelEntity[]>;

    /**
     * Get channel statistics (participant count, message count, etc.)
     */
    getStatistics(channelId: string): Promise<ChannelStatistics>;

    /**
     * Find active channels (active = true)
     */
    findActive(): Promise<IChannelEntity[]>;
}
