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

import { Agent, IAgent } from '../../../models/agent';
import { IAgentEntity, IAgentRepository } from '../../../repositories/interfaces/IAgentRepository';
import { MongoBaseRepository } from './MongoBaseRepository';

/**
 * MongoDB implementation of IAgentRepository.
 * Uses the existing Agent Mongoose model and translates to domain entities.
 */
export class MongoAgentRepository
    extends MongoBaseRepository<IAgentEntity, IAgent>
    implements IAgentRepository {

    constructor() {
        super(Agent);
    }

    /**
     * Convert Mongoose document to domain entity
     */
    protected toEntity(doc: any): IAgentEntity {
        return {
            agentId: doc.agentId,
            name: doc.name,
            description: doc.description,
            type: doc.type,
            serviceTypes: doc.serviceTypes || [],
            capabilities: doc.capabilities || [],
            status: doc.status,
            createdBy: doc.createdBy,
            createdAt: doc.createdAt,
            lastActive: doc.lastActive,
            metadata: doc.metadata,
            keyId: doc.keyId,
            role: doc.role,
            specialization: doc.specialization,
            allowedTools: doc.allowedTools,
            context: doc.context,
            memory: doc.memory
        };
    }

    /**
     * Find agent by its unique agentId
     */
    async findByAgentId(agentId: string): Promise<IAgentEntity | null> {
        const doc = await this.model.findOne({ agentId }).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Find agent by API key identifier
     */
    async findByKeyId(keyId: string): Promise<IAgentEntity | null> {
        const doc = await this.model.findOne({ keyId }).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Find agents by their service types
     */
    async findByServiceTypes(types: string[], matchAll = false): Promise<IAgentEntity[]> {
        const query = matchAll
            ? { serviceTypes: { $all: types } }
            : { serviceTypes: { $in: types } };
        const docs = await this.model.find(query).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find agents by status
     */
    async findByStatus(status: 'ACTIVE' | 'INACTIVE' | 'ERROR'): Promise<IAgentEntity[]> {
        const docs = await this.model.find({ status }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find agents created by a specific user
     */
    async findByCreator(createdBy: string): Promise<IAgentEntity[]> {
        const docs = await this.model.find({ createdBy }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Update agent's status
     */
    async updateStatus(agentId: string, status: 'ACTIVE' | 'INACTIVE' | 'ERROR'): Promise<IAgentEntity | null> {
        const doc = await this.model.findOneAndUpdate(
            { agentId },
            { $set: { status, lastActive: new Date() } },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Update agent's last active timestamp
     */
    async updateLastActive(agentId: string, timestamp = new Date()): Promise<void> {
        await this.model.updateOne(
            { agentId },
            { $set: { lastActive: timestamp } }
        );
    }

    /**
     * Find agents with stale activity
     */
    async findStaleAgents(thresholdMs: number): Promise<IAgentEntity[]> {
        const threshold = new Date(Date.now() - thresholdMs);
        const docs = await this.model.find({
            status: 'ACTIVE',
            lastActive: { $lt: threshold }
        }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Bulk update status for multiple agents
     */
    async bulkUpdateStatus(agentIds: string[], status: 'ACTIVE' | 'INACTIVE' | 'ERROR'): Promise<number> {
        const result = await this.model.updateMany(
            { agentId: { $in: agentIds } },
            { $set: { status } }
        );
        return result.modifiedCount;
    }

    /**
     * Update agent's allowed tools list
     */
    async updateAllowedTools(agentId: string, allowedTools: string[]): Promise<IAgentEntity | null> {
        const doc = await this.model.findOneAndUpdate(
            { agentId },
            { $set: { allowedTools } },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Update agent's capabilities
     */
    async updateCapabilities(agentId: string, capabilities: string[]): Promise<IAgentEntity | null> {
        const doc = await this.model.findOneAndUpdate(
            { agentId },
            { $set: { capabilities } },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Delete agent by its unique agentId
     */
    async deleteByAgentId(agentId: string): Promise<boolean> {
        const result = await this.model.deleteOne({ agentId });
        return result.deletedCount > 0;
    }
}
