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
 * Domain entity type for Agent (database-agnostic)
 */
export interface IAgentEntity {
    agentId: string;
    name?: string;
    description?: string;
    type?: string;
    serviceTypes: string[];
    capabilities?: string[];
    status: 'ACTIVE' | 'INACTIVE' | 'ERROR';
    createdBy: string;
    createdAt: Date;
    lastActive: Date;
    metadata?: Record<string, any>;
    keyId?: string;
    role?: string;
    specialization?: string;
    allowedTools?: string[];
    context?: {
        identity?: string;
        instructions?: string;
        constraints?: string[];
        examples?: string[];
        updatedAt?: Date;
    };
    memory?: {
        notes?: Record<string, any>;
        conversationHistory?: any[];
        customData?: Record<string, any>;
        updatedAt?: Date;
    };
}

/**
 * Repository interface for Agent entities.
 * Extends base CRUD with agent-specific operations.
 */
export interface IAgentRepository extends IBaseRepository<IAgentEntity> {
    /**
     * Find agent by its unique agentId (not MongoDB _id)
     */
    findByAgentId(agentId: string): Promise<IAgentEntity | null>;

    /**
     * Find agent by API key identifier
     */
    findByKeyId(keyId: string): Promise<IAgentEntity | null>;

    /**
     * Find agents by their service types
     * @param types - Array of service type strings to match
     * @param matchAll - If true, agent must have ALL types; if false, ANY type
     */
    findByServiceTypes(types: string[], matchAll?: boolean): Promise<IAgentEntity[]>;

    /**
     * Find agents by status
     */
    findByStatus(status: 'ACTIVE' | 'INACTIVE' | 'ERROR'): Promise<IAgentEntity[]>;

    /**
     * Find agents created by a specific user
     */
    findByCreator(createdBy: string): Promise<IAgentEntity[]>;

    /**
     * Update agent's status
     */
    updateStatus(agentId: string, status: 'ACTIVE' | 'INACTIVE' | 'ERROR'): Promise<IAgentEntity | null>;

    /**
     * Update agent's last active timestamp
     */
    updateLastActive(agentId: string, timestamp?: Date): Promise<void>;

    /**
     * Find agents with stale activity (for cleanup)
     * @param thresholdMs - Milliseconds since last activity to consider stale
     */
    findStaleAgents(thresholdMs: number): Promise<IAgentEntity[]>;

    /**
     * Bulk update status for multiple agents
     */
    bulkUpdateStatus(agentIds: string[], status: 'ACTIVE' | 'INACTIVE' | 'ERROR'): Promise<number>;

    /**
     * Update agent's allowed tools list
     */
    updateAllowedTools(agentId: string, allowedTools: string[]): Promise<IAgentEntity | null>;

    /**
     * Update agent's capabilities
     */
    updateCapabilities(agentId: string, capabilities: string[]): Promise<IAgentEntity | null>;

    /**
     * Delete agent by its unique agentId (not MongoDB _id)
     * @returns true if an agent was deleted, false if not found
     */
    deleteByAgentId(agentId: string): Promise<boolean>;
}
