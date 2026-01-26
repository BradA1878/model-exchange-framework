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

import { Channel, IChannel } from '../../../models/channel';
import { IChannelEntity, IChannelRepository, ChannelStatistics } from '../../../repositories/interfaces/IChannelRepository';
import { MongoBaseRepository } from './MongoBaseRepository';

/**
 * MongoDB implementation of IChannelRepository.
 * Uses the existing Channel Mongoose model and translates to domain entities.
 */
export class MongoChannelRepository
    extends MongoBaseRepository<IChannelEntity, IChannel>
    implements IChannelRepository {

    constructor() {
        super(Channel);
    }

    /**
     * Convert Mongoose document to domain entity
     */
    protected toEntity(doc: any): IChannelEntity {
        return {
            channelId: doc.channelId,
            name: doc.name,
            description: doc.description,
            customChannelId: doc.customChannelId,
            isPrivate: doc.isPrivate,
            requireApproval: doc.requireApproval,
            maxAgents: doc.maxAgents,
            allowAnonymous: doc.allowAnonymous,
            showActiveAgents: doc.showActiveAgents,
            active: doc.active,
            participants: doc.participants || [],
            createdBy: doc.createdBy,
            context: doc.context,
            sharedMemory: doc.sharedMemory,
            mcpServers: doc.mcpServers,
            verified: doc.verified,
            verificationMethod: doc.verificationMethod,
            verificationToken: doc.verificationToken,
            verificationExpiry: doc.verificationExpiry,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            lastActive: doc.lastActive,
            metadata: doc.metadata || {},
            allowedTools: doc.allowedTools,
            systemLlmEnabled: doc.systemLlmEnabled
        };
    }

    /**
     * Find channel by its unique channelId
     */
    async findByChannelId(channelId: string): Promise<IChannelEntity | null> {
        const doc = await this.model.findOne({ channelId }).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Find channels that an agent is a participant of
     */
    async findByParticipant(agentId: string): Promise<IChannelEntity[]> {
        const docs = await this.model.find({ participants: agentId }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Find channels created by a specific user/agent
     */
    async findByCreator(creatorId: string): Promise<IChannelEntity[]> {
        const docs = await this.model.find({ createdBy: creatorId }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Add a participant to a channel (ensures no duplicates)
     */
    async addParticipant(channelId: string, participantId: string): Promise<IChannelEntity | null> {
        const doc = await this.model.findOneAndUpdate(
            { channelId },
            { $addToSet: { participants: participantId } },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Remove a participant from a channel
     */
    async removeParticipant(channelId: string, participantId: string): Promise<IChannelEntity | null> {
        const doc = await this.model.findOneAndUpdate(
            { channelId },
            { $pull: { participants: participantId } },
            { new: true }
        ).lean();
        return doc ? this.toEntity(doc) : null;
    }

    /**
     * Get all participants of a channel
     */
    async getParticipants(channelId: string): Promise<string[]> {
        const doc = await this.model.findOne({ channelId }).select('participants').lean();
        return doc?.participants || [];
    }

    /**
     * Check if an agent is a participant in a channel
     */
    async isParticipant(channelId: string, agentId: string): Promise<boolean> {
        const doc = await this.model.findOne({
            channelId,
            participants: agentId
        }).select('_id').lean();
        return doc !== null;
    }

    /**
     * Update channel's last active timestamp
     */
    async updateLastActive(channelId: string, timestamp = new Date()): Promise<void> {
        await this.model.updateOne(
            { channelId },
            { $set: { lastActive: timestamp } }
        );
    }

    /**
     * Search channels by name (partial match)
     */
    async searchByName(query: string): Promise<IChannelEntity[]> {
        const docs = await this.model.find({
            name: { $regex: query, $options: 'i' }
        }).lean();
        return docs.map(doc => this.toEntity(doc));
    }

    /**
     * Get channel statistics
     * Note: messageCount and taskCount require joining with other collections
     * For now, returning basic stats
     */
    async getStatistics(channelId: string): Promise<ChannelStatistics> {
        const doc = await this.model.findOne({ channelId }).lean();

        if (!doc) {
            throw new Error(`Channel ${channelId} not found`);
        }

        return {
            participantCount: doc.participants?.length || 0,
            messageCount: 0, // Would require joining with messages collection
            taskCount: 0, // Would require joining with tasks collection
            lastActiveAt: doc.lastActive,
            createdAt: doc.createdAt
        };
    }

    /**
     * Find active channels
     */
    async findActive(): Promise<IChannelEntity[]> {
        const docs = await this.model.find({ active: true }).lean();
        return docs.map(doc => this.toEntity(doc));
    }
}
