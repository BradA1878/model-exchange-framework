/**
 * Memory Utility model (MULS).
 *
 * Stores the learned Q-value and reward statistics for a single *retrievable* memory —
 * the unit QValueManager actually learns about, which is a document in the search index
 * (a conversation message, action, or pattern), identified by its search-index id.
 *
 * Why this is its own collection: the `utility` subdocument on AgentMemory /
 * ChannelMemory / RelationshipMemory is keyed by the id of a whole memory-scope
 * document, whereas retrieval returns individual indexed items. Those are different
 * granularities, so utility written onto a scope document would never match the id a
 * retrieval learned about. That mismatch is why the previous persistence path silently
 * matched nothing. Keying by the retrieved memory id is what makes learning durable.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { QValueInitSource } from '../types/MemoryUtilityTypes.js';

export interface IMemoryUtilityDocument extends Document {
    /** The retrieved memory's id — matches the search-index document id. */
    memoryId: string;
    /** Agent this memory's utility was learned for (scoping and analytics). */
    agentId?: string;
    /** Channel this memory's utility was learned in (scoping and analytics). */
    channelId?: string;
    qValue: number;
    qValueHistory: Array<{ value: number; reward: number; timestamp: Date; phase?: string }>;
    retrievalCount: number;
    successCount: number;
    failureCount: number;
    lastRewardAt?: Date;
    initializedFrom: QValueInitSource;
    updatedAt: Date;
}

const memoryUtilitySchema = new Schema<IMemoryUtilityDocument>({
    memoryId: { type: String, required: true, unique: true, index: true },
    agentId: { type: String, index: true },
    channelId: { type: String, index: true },

    qValue: { type: Number, default: 0.5, min: 0, max: 1 },

    qValueHistory: [{
        value: { type: Number, required: true },
        reward: { type: Number, required: true },
        timestamp: { type: Date, default: Date.now },
        phase: { type: String }
    }],

    retrievalCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    lastRewardAt: { type: Date },
    initializedFrom: { type: String, default: 'default' },
    updatedAt: { type: Date, default: Date.now }
});

// Ranking reads sort by Q-value, scoped by agent or channel.
memoryUtilitySchema.index({ agentId: 1, qValue: -1 });
memoryUtilitySchema.index({ channelId: 1, qValue: -1 });

export const MemoryUtility: Model<IMemoryUtilityDocument> =
    mongoose.models.MemoryUtility ||
    mongoose.model<IMemoryUtilityDocument>('MemoryUtility', memoryUtilitySchema);
