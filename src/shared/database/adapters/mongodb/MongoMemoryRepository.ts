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

import {
    AgentMemory,
    ChannelMemory,
    RelationshipMemory,
    AgentMemoryDocument,
    ChannelMemoryDocument,
    RelationshipMemoryDocument
} from '../../../models/memory';
import {
    IMemoryRepository,
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryScope,
    MemoryStatistics
} from '../../../repositories/interfaces/IMemoryRepository';

/**
 * MongoDB implementation of IMemoryRepository.
 * Uses the existing Memory Mongoose models and translates to domain entities.
 */
export class MongoMemoryRepository implements IMemoryRepository {

    /**
     * Convert agent memory document to domain entity
     */
    private toAgentMemoryEntity(doc: any): IAgentMemory {
        return {
            id: doc.id,
            agentId: doc.agentId,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            persistenceLevel: doc.persistenceLevel,
            notes: doc.notes,
            conversationHistory: doc.conversationHistory,
            customData: doc.customData
        };
    }

    /**
     * Convert channel memory document to domain entity
     */
    private toChannelMemoryEntity(doc: any): IChannelMemory {
        return {
            id: doc.id,
            channelId: doc.channelId,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            persistenceLevel: doc.persistenceLevel,
            notes: doc.notes,
            sharedState: doc.sharedState,
            conversationHistory: doc.conversationHistory,
            customData: doc.customData
        };
    }

    /**
     * Convert relationship memory document to domain entity
     */
    private toRelationshipMemoryEntity(doc: any): IRelationshipMemory {
        return {
            id: doc.id,
            agentId1: doc.agentId1,
            agentId2: doc.agentId2,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            persistenceLevel: doc.persistenceLevel,
            notes: doc.notes,
            interactionHistory: doc.interactionHistory,
            customData: doc.customData
        };
    }

    // Agent Memory Operations

    async getAgentMemory(agentId: string): Promise<IAgentMemory | null> {
        const doc = await AgentMemory.findOne({ agentId }).lean();
        return doc ? this.toAgentMemoryEntity(doc) : null;
    }

    async saveAgentMemory(memory: Partial<IAgentMemory> & { agentId: string }): Promise<IAgentMemory> {
        const doc = await AgentMemory.findOneAndUpdate(
            { agentId: memory.agentId },
            { $set: memory },
            { new: true, upsert: true }
        ).lean();

        return this.toAgentMemoryEntity(doc);
    }

    async updateAgentMemory(agentId: string, updates: Partial<IAgentMemory>): Promise<IAgentMemory | null> {
        const doc = await AgentMemory.findOneAndUpdate(
            { agentId },
            { $set: updates },
            { new: true }
        ).lean();

        return doc ? this.toAgentMemoryEntity(doc) : null;
    }

    async deleteAgentMemory(agentId: string): Promise<boolean> {
        const result = await AgentMemory.deleteOne({ agentId });
        return result.deletedCount > 0;
    }

    // Channel Memory Operations

    async getChannelMemory(channelId: string): Promise<IChannelMemory | null> {
        const doc = await ChannelMemory.findOne({ channelId }).lean();
        return doc ? this.toChannelMemoryEntity(doc) : null;
    }

    async saveChannelMemory(memory: Partial<IChannelMemory> & { channelId: string }): Promise<IChannelMemory> {
        const doc = await ChannelMemory.findOneAndUpdate(
            { channelId: memory.channelId },
            { $set: memory },
            { new: true, upsert: true }
        ).lean();

        return this.toChannelMemoryEntity(doc);
    }

    async updateChannelMemory(channelId: string, updates: Partial<IChannelMemory>): Promise<IChannelMemory | null> {
        const doc = await ChannelMemory.findOneAndUpdate(
            { channelId },
            { $set: updates },
            { new: true }
        ).lean();

        return doc ? this.toChannelMemoryEntity(doc) : null;
    }

    async deleteChannelMemory(channelId: string): Promise<boolean> {
        const result = await ChannelMemory.deleteOne({ channelId });
        return result.deletedCount > 0;
    }

    // Relationship Memory Operations

    async getRelationshipMemory(agentId1: string, agentId2: string): Promise<IRelationshipMemory | null> {
        // Try both orderings since relationships are bidirectional
        const doc = await RelationshipMemory.findOne({
            $or: [
                { agentId1, agentId2 },
                { agentId1: agentId2, agentId2: agentId1 }
            ]
        }).lean();

        return doc ? this.toRelationshipMemoryEntity(doc) : null;
    }

    async saveRelationshipMemory(memory: Partial<IRelationshipMemory> & { agentId1: string; agentId2: string }): Promise<IRelationshipMemory> {
        // Ensure consistent ordering to avoid duplicates
        const [id1, id2] = [memory.agentId1, memory.agentId2].sort();

        const doc = await RelationshipMemory.findOneAndUpdate(
            { agentId1: id1, agentId2: id2 },
            { $set: { ...memory, agentId1: id1, agentId2: id2 } },
            { new: true, upsert: true }
        ).lean();

        return this.toRelationshipMemoryEntity(doc);
    }

    async getAgentRelationships(agentId: string): Promise<IRelationshipMemory[]> {
        const docs = await RelationshipMemory.find({
            $or: [
                { agentId1: agentId },
                { agentId2: agentId }
            ]
        }).lean();

        return docs.map(doc => this.toRelationshipMemoryEntity(doc));
    }

    async deleteRelationshipMemory(agentId1: string, agentId2: string): Promise<boolean> {
        const result = await RelationshipMemory.deleteOne({
            $or: [
                { agentId1, agentId2 },
                { agentId1: agentId2, agentId2: agentId1 }
            ]
        });

        return result.deletedCount > 0;
    }

    // Bulk Operations

    async deleteByScope(scope: MemoryScope, id: string): Promise<boolean> {
        let result;

        switch (scope) {
            case MemoryScope.AGENT:
                result = await AgentMemory.deleteMany({ agentId: id });
                break;
            case MemoryScope.CHANNEL:
                result = await ChannelMemory.deleteMany({ channelId: id });
                break;
            case MemoryScope.RELATIONSHIP:
                result = await RelationshipMemory.deleteMany({
                    $or: [{ agentId1: id }, { agentId2: id }]
                });
                break;
            default:
                return false;
        }

        return result.deletedCount > 0;
    }

    async getStatistics(): Promise<MemoryStatistics> {
        const [agentCount, channelCount, relationshipCount] = await Promise.all([
            AgentMemory.countDocuments(),
            ChannelMemory.countDocuments(),
            RelationshipMemory.countDocuments()
        ]);

        return {
            agentMemoryCount: agentCount,
            channelMemoryCount: channelCount,
            relationshipMemoryCount: relationshipCount
        };
    }
}
