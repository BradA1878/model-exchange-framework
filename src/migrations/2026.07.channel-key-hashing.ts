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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Channel Key Hashing Migration
 *
 * Channel keys used to store their secret in the clear: `channelkeys.secretKey`
 * held the value an agent sends to authenticate, so read access to the database
 * was read access to every agent's credential. ChannelKeyService now stores a
 * bcrypt hash and refuses to authenticate against anything that is not one.
 *
 * This migration hashes the secrets that are already there. Existing keys keep
 * working — the plaintext an agent presents still verifies against the hash we
 * derive from it here.
 *
 * With --bind-derived-agent-ids it also writes `agentId` onto keys that do not
 * have one, using the same keyId+channelId derivation the old code used to
 * produce an agent id at authentication time. That keeps legacy keys usable
 * under the new rule that a key names its agent. Keys minted from now on carry
 * an explicit agentId instead, which is what gives agents their real names.
 *
 * Run:
 *   bun run src/migrations/2026.07.channel-key-hashing.ts
 *   bun run src/migrations/2026.07.channel-key-hashing.ts --bind-derived-agent-ids
 *   bun run src/migrations/2026.07.channel-key-hashing.ts --dry-run
 *
 * Idempotent: keys that already hold a bcrypt hash are left alone, so it is safe
 * to run more than once.
 */

import mongoose from 'mongoose';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { requireEnv } from '@mxf-dev/core/utils/env';
import { Logger } from '@mxf-dev/core/utils/Logger';

const logger = new Logger('info', 'ChannelKeyHashingMigration');

/** bcrypt cost factor. Must match ChannelKeyService. */
const BCRYPT_ROUNDS = 10;

/** Recognizes a value that is already a bcrypt hash. Must match ChannelKeyService. */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/** Shape of the rows this migration touches. */
interface ChannelKeyRow {
    _id: mongoose.Types.ObjectId;
    keyId: string;
    secretKey: string;
    channelId: string;
    agentId?: string;
}

/**
 * Derive an agent id from a key and channel.
 *
 * The same derivation ChannelKeyService.deriveAgentIdFromKey uses, so a legacy
 * key keeps resolving to the identity it always did.
 *
 * @param keyId - Key identifier
 * @param channelId - Channel the key belongs to
 * @returns Derived agent id
 */
const deriveAgentIdFromKey = (keyId: string, channelId: string): string => {
    const hash = crypto
        .createHash('sha256')
        .update(`${keyId}:${channelId}`)
        .digest('hex');

    return `agent-${hash.substring(0, 12)}`;
};

/**
 * Run the migration.
 *
 * @param options.dryRun - Report what would change without writing
 * @param options.bindDerivedAgentIds - Also write derived agentIds onto unbound keys
 * @returns Counts of what was inspected and changed
 */
export const migrateChannelKeys = async (options: {
    dryRun: boolean;
    bindDerivedAgentIds: boolean;
}): Promise<{ total: number; hashed: number; alreadyHashed: number; bound: number }> => {
    // Talk to the collection directly rather than through the model: the point is
    // to rewrite rows that the current schema would reject, and to be able to set
    // `agentId` whether or not the model declares it yet.
    const collection = mongoose.connection.collection('channelkeys');

    const rows = (await collection.find({}).toArray()) as unknown as ChannelKeyRow[];

    let hashed = 0;
    let alreadyHashed = 0;
    let bound = 0;

    for (const row of rows) {
        const updates: Record<string, unknown> = {};

        if (typeof row.secretKey !== 'string' || row.secretKey.length === 0) {
            logger.warn(`Key ${row.keyId} has no secret — skipping`);
            continue;
        }

        if (BCRYPT_HASH_PATTERN.test(row.secretKey)) {
            alreadyHashed++;
        } else {
            updates.secretKey = await bcrypt.hash(row.secretKey, BCRYPT_ROUNDS);
            hashed++;
        }

        if (options.bindDerivedAgentIds && !row.agentId) {
            updates.agentId = deriveAgentIdFromKey(row.keyId, row.channelId);
            bound++;
        }

        if (Object.keys(updates).length === 0) {
            continue;
        }

        updates.updatedAt = new Date();

        if (options.dryRun) {
            logger.info(`[dry run] would update ${row.keyId}: ${Object.keys(updates).join(', ')}`);
            continue;
        }

        await collection.updateOne({ _id: row._id }, { $set: updates });
    }

    return { total: rows.length, hashed, alreadyHashed, bound };
};

/**
 * Connect, migrate, report, disconnect.
 */
const main = async (): Promise<void> => {
    const dryRun = process.argv.includes('--dry-run');
    const bindDerivedAgentIds = process.argv.includes('--bind-derived-agent-ids');

    const mongoUri = requireEnv('MONGODB_URI', 'Set the MongoDB connection string in .env.');

    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB');

    try {
        const result = await migrateChannelKeys({ dryRun, bindDerivedAgentIds });

        logger.info(
            `${dryRun ? '[dry run] ' : ''}Channel keys: ${result.total} inspected, ` +
            `${result.hashed} secrets hashed, ${result.alreadyHashed} already hashed, ` +
            `${result.bound} agent ids bound`
        );

        if (!bindDerivedAgentIds) {
            const unbound = await mongoose.connection
                .collection('channelkeys')
                .countDocuments({ agentId: { $exists: false } });

            if (unbound > 0) {
                logger.warn(
                    `${unbound} key(s) are not bound to an agent and will be refused at socket ` +
                    'authentication. Re-run with --bind-derived-agent-ids to bind them to their ' +
                    'derived ids, or regenerate them with an explicit agentId.'
                );
            }
        }
    } finally {
        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB');
    }
};

// Only run when invoked directly, so the migration can also be imported by tests.
if (require.main === module) {
    main().catch((error) => {
        logger.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
