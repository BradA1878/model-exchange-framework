/**
 * Copy legacy Channel.sharedMemory.conversationHistory to ChannelMemory.
 *
 * Run explicitly with channel writers stopped. Every channel is preflighted
 * before history writes begin; divergent records sharing an ID require repair.
 * Source history is retained. There is no runtime read fallback or dual write.
 * Older DM writers discarded party metadata and sometimes nested content wrappers;
 * this migration preserves those original records and cannot infer lost DM parties.
 */
import mongoose from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { requireEnv } from '@mxf-dev/core/utils/env';
import { appendUniqueChannelMessages, normalizeChannelHistoryMessage } from '@mxf-dev/core/utils/ChannelHistoryMessages';
import { ContentFormat } from '@mxf-dev/core/schemas/MessageSchemas';
import { createChannelMessageAppendUpdate } from '../server/api/services/MemoryPersistenceService';

const logger = new Logger('info', 'ChannelHistoryMigration');

export interface ChannelHistoryMigrationResult {
    channelsScanned: number;
    messagesCopied: number;
}

/** Validate persisted flat records without rewriting historical fields. */
const validateHistory = (channelId: string, history: unknown, source: string): unknown[] => {
    if (!Array.isArray(history)) throw new Error(`${source} history for ${channelId} must be an array`);
    appendUniqueChannelMessages([], history);
    for (const value of history) {
        const record = value as Record<string, unknown>;
        if (!['text', 'command', 'response', 'system'].includes(String(record.type))) {
            throw new Error(`${source} message ${String(record.messageId)} in ${channelId} has an invalid type`);
        }
        normalizeChannelHistoryMessage({
            toolType: 'channelMessage', senderId: record.senderId as string,
            content: { format: ContentFormat.JSON, data: record.content },
            metadata: { messageId: record.messageId as string, timestamp: record.timestamp as number },
            context: { channelId, messageType: record.type }
        }, channelId);
    }
    return history;
};

/** An idempotent migration whose database dependency is explicit and safe to import. */
export const migrateChannelHistory = async (db: mongoose.mongo.Db): Promise<ChannelHistoryMigrationResult> => {
    const channels = db.collection('channels');
    const memories = db.collection('channelmemories');
    const legacyChannels = await channels.find({ 'sharedMemory.conversationHistory': { $exists: true } }).toArray();
    const plans: Array<{ channelId: string; messages: unknown[]; existing: unknown[] | undefined; copied: number }> = [];
    for (const channel of legacyChannels) {
        if (typeof channel.channelId !== 'string' || channel.channelId.trim().length === 0) {
            throw new Error('Legacy history has a missing channelId; repair it before migrating');
        }
        const channelId = channel.channelId;
        const legacy = validateHistory(channelId, channel.sharedMemory?.conversationHistory, 'Legacy');
        const memory = await memories.findOne({ channelId });
        const existing = memory?.conversationHistory === undefined
            ? undefined : validateHistory(channelId, memory.conversationHistory, 'Canonical');
        const byId = new Map<string, unknown>();
        for (const record of [...(existing ?? []), ...legacy]) {
            const messageId = (record as { messageId: string }).messageId;
            if (byId.has(messageId) && !isDeepStrictEqual(byId.get(messageId), record)) {
                throw new Error(`Conflicting messageId ${JSON.stringify(messageId)} in channel ${JSON.stringify(channelId)}; repair divergent history before migrating`);
            }
            byId.set(messageId, record);
        }
        const existingIds = new Set((existing ?? []).map(record => (record as { messageId: string }).messageId));
        const uniqueLegacy = appendUniqueChannelMessages([], legacy);
        plans.push({
            channelId, messages: uniqueLegacy, existing,
            copied: uniqueLegacy.filter(record => !existingIds.has((record as { messageId: string }).messageId)).length
        });
    }

    // The model declares this same index. Verify it for explicit migrations too,
    // so a concurrent history change cannot cause the guarded upsert to fork it.
    await memories.createIndex({ channelId: 1 }, { unique: true });
    let messagesCopied = 0;
    for (const plan of plans) {
        if (plan.messages.length === 0) continue;
        // Match the preflight history as well as the identity. A changed history
        // must fail this migration instead of silently accepting a new conflict.
        const filter = {
            channelId: plan.channelId,
            conversationHistory: plan.existing === undefined ? { $exists: false } : plan.existing
        };
        const result = await memories.updateOne(
            filter, createChannelMessageAppendUpdate(plan.channelId, plan.messages), { upsert: true }
        ).catch((error: unknown) => {
            if (error && typeof error === 'object' && Reflect.get(error, 'code') === 11000) {
                throw new Error(`Channel ${plan.channelId} history changed after migration preflight: ${error instanceof Error ? error.message : String(error)}`);
            }
            throw error;
        });
        if (result.matchedCount !== 1 && result.upsertedCount !== 1) {
            throw new Error(`Channel ${plan.channelId} history changed after migration preflight`);
        }
        messagesCopied += plan.copied;
    }
    return { channelsScanned: legacyChannels.length, messagesCopied };
};

const main = async (): Promise<void> => {
    await mongoose.connect(requireEnv('MONGODB_URI', 'Set the MongoDB connection string in .env.'));
    try {
        const result = await migrateChannelHistory(mongoose.connection.db!);
        logger.info(`Scanned ${result.channelsScanned} channels; copied ${result.messagesCopied} messages. Legacy source history retained.`);
    } finally {
        await mongoose.disconnect();
    }
};

if (require.main === module) {
    main().catch((error: unknown) => {
        logger.error(`Channel history migration failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
