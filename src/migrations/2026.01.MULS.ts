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
 * MULS (Memory Utility Learning System) Migration
 *
 * This migration adds the utility subdocument to existing memory documents
 * and creates indexes for Q-value queries.
 *
 * Run with: npx ts-node src/migrations/2026.01.MULS.ts
 */

import mongoose from 'mongoose';
import { Logger } from '../shared/utils/Logger';

const logger = new Logger('info', 'MULS-Migration');

/**
 * Default utility subdocument values for migration
 */
const DEFAULT_UTILITY = {
    qValue: 0.5,
    qValueHistory: [],
    retrievalCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRewardAt: new Date(),
    initializedFrom: 'default'
};

/**
 * Migration interface
 */
interface Migration {
    name: string;
    up: (db: mongoose.mongo.Db) => Promise<void>;
    down: (db: mongoose.mongo.Db) => Promise<void>;
}

/**
 * MULS Migration
 */
export const MULSMigration: Migration = {
    name: '2026.01.MULS',

    /**
     * Up migration: Add utility fields and indexes
     */
    up: async (db: mongoose.mongo.Db): Promise<void> => {
        logger.info('[MULS Migration] Starting up migration...');

        // Collections to update
        const collections = ['agentmemories', 'channelmemories', 'relationshipmemories'];

        for (const collectionName of collections) {
            try {
                const collection = db.collection(collectionName);

                // Check if collection exists
                const collectionExists = await collection.countDocuments().catch(() => -1);
                if (collectionExists === -1) {
                    logger.info(`[MULS Migration] Collection ${collectionName} does not exist, skipping...`);
                    continue;
                }

                // Add utility subdocument to documents that don't have it
                const result = await collection.updateMany(
                    { utility: { $exists: false } },
                    {
                        $set: {
                            utility: {
                                qValue: DEFAULT_UTILITY.qValue,
                                qValueHistory: DEFAULT_UTILITY.qValueHistory,
                                retrievalCount: DEFAULT_UTILITY.retrievalCount,
                                successCount: DEFAULT_UTILITY.successCount,
                                failureCount: DEFAULT_UTILITY.failureCount,
                                lastRewardAt: DEFAULT_UTILITY.lastRewardAt,
                                initializedFrom: DEFAULT_UTILITY.initializedFrom
                            }
                        }
                    }
                );

                logger.info(`[MULS Migration] Updated ${result.modifiedCount} documents in ${collectionName}`);

                // Create Q-value index
                await collection.createIndex(
                    { 'utility.qValue': -1 },
                    { name: 'utility_qValue_desc', background: true }
                );
                logger.info(`[MULS Migration] Created utility.qValue index on ${collectionName}`);

                // Create compound indexes for scoped queries
                if (collectionName === 'agentmemories') {
                    await collection.createIndex(
                        { agentId: 1, 'utility.qValue': -1 },
                        { name: 'agentId_qValue_compound', background: true }
                    );
                    logger.info(`[MULS Migration] Created agentId + qValue compound index`);
                }

                if (collectionName === 'channelmemories') {
                    await collection.createIndex(
                        { channelId: 1, 'utility.qValue': -1 },
                        { name: 'channelId_qValue_compound', background: true }
                    );
                    logger.info(`[MULS Migration] Created channelId + qValue compound index`);
                }
            } catch (error) {
                logger.error(`[MULS Migration] Error processing ${collectionName}: ${error}`);
                throw error;
            }
        }

        logger.info('[MULS Migration] Up migration completed successfully');
    },

    /**
     * Down migration: Remove utility fields and indexes
     */
    down: async (db: mongoose.mongo.Db): Promise<void> => {
        logger.info('[MULS Migration] Starting down migration...');

        const collections = ['agentmemories', 'channelmemories', 'relationshipmemories'];

        for (const collectionName of collections) {
            try {
                const collection = db.collection(collectionName);

                // Check if collection exists
                const collectionExists = await collection.countDocuments().catch(() => -1);
                if (collectionExists === -1) {
                    logger.info(`[MULS Migration] Collection ${collectionName} does not exist, skipping...`);
                    continue;
                }

                // Remove utility subdocument
                const result = await collection.updateMany(
                    { utility: { $exists: true } },
                    { $unset: { utility: '' } }
                );
                logger.info(`[MULS Migration] Removed utility from ${result.modifiedCount} documents in ${collectionName}`);

                // Drop indexes (ignore errors if they don't exist)
                try {
                    await collection.dropIndex('utility_qValue_desc');
                    logger.info(`[MULS Migration] Dropped utility.qValue index on ${collectionName}`);
                } catch {
                    logger.debug(`[MULS Migration] Index utility_qValue_desc not found on ${collectionName}`);
                }

                if (collectionName === 'agentmemories') {
                    try {
                        await collection.dropIndex('agentId_qValue_compound');
                        logger.info(`[MULS Migration] Dropped agentId + qValue compound index`);
                    } catch {
                        logger.debug(`[MULS Migration] Index agentId_qValue_compound not found`);
                    }
                }

                if (collectionName === 'channelmemories') {
                    try {
                        await collection.dropIndex('channelId_qValue_compound');
                        logger.info(`[MULS Migration] Dropped channelId + qValue compound index`);
                    } catch {
                        logger.debug(`[MULS Migration] Index channelId_qValue_compound not found`);
                    }
                }
            } catch (error) {
                logger.error(`[MULS Migration] Error processing ${collectionName}: ${error}`);
                throw error;
            }
        }

        logger.info('[MULS Migration] Down migration completed successfully');
    }
};

/**
 * Run migration from command line
 */
async function runMigration(): Promise<void> {
    const direction = process.argv[2] || 'up';

    // Get MongoDB URI from environment
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf';

    logger.info(`[MULS Migration] Connecting to MongoDB: ${mongoUri.replace(/\/\/[^@]+@/, '//<credentials>@')}`);

    try {
        await mongoose.connect(mongoUri);
        logger.info('[MULS Migration] Connected to MongoDB');

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Failed to get database connection');
        }

        if (direction === 'up') {
            await MULSMigration.up(db);
        } else if (direction === 'down') {
            await MULSMigration.down(db);
        } else {
            logger.error(`[MULS Migration] Unknown direction: ${direction}. Use 'up' or 'down'.`);
            process.exit(1);
        }

        await mongoose.disconnect();
        logger.info('[MULS Migration] Disconnected from MongoDB');
        process.exit(0);
    } catch (error) {
        logger.error(`[MULS Migration] Migration failed: ${error}`);
        await mongoose.disconnect();
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    runMigration();
}

export default MULSMigration;
