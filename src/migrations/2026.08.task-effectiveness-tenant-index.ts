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
 */

/**
 * Replace the legacy globally unique task-effectiveness taskId index with an
 * exact agent + channel + task identity.
 *
 * Run with:
 *   bun run src/migrations/2026.08.task-effectiveness-tenant-index.ts
 */

import mongoose from 'mongoose';
import { requireEnv } from '@mxf-dev/core/utils/env';
import { Logger } from '@mxf-dev/core/utils/Logger';

const logger = new Logger('info', 'TaskEffectivenessTenantIndexMigration');
const COLLECTION_NAME = 'taskeffectiveness';
const LEGACY_TASK_INDEX = 'taskId_1';
const COMPOSITE_TENANT_INDEX = 'agentId_1_channelId_1_taskId_1';

interface IndexInfo {
    name?: string;
    key: Record<string, number>;
    unique?: boolean;
}

export interface TaskEffectivenessIndexMigrationResult {
    compositeCreated: boolean;
    legacyUniqueRemoved: boolean;
}

const hasExactKeys = (index: IndexInfo, expected: Record<string, number>): boolean => {
    const actualEntries = Object.entries(index.key);
    const expectedEntries = Object.entries(expected);
    return actualEntries.length === expectedEntries.length &&
        actualEntries.every(([key, direction], position) =>
            key === expectedEntries[position][0] && direction === expectedEntries[position][1]
        );
};

const findIndex = (indexes: IndexInfo[], name: string): IndexInfo | undefined =>
    indexes.find(index => index.name === name);

/**
 * Perform the idempotent index migration against an existing database.
 *
 * Identity-less legacy rows are rejected instead of being assigned an
 * arbitrary owner. Operators must repair or remove those rows before retrying.
 */
export const migrateTaskEffectivenessTenantIndex = async (
    db: mongoose.mongo.Db
): Promise<TaskEffectivenessIndexMigrationResult> => {
    const collectionExists = await db
        .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
        .hasNext();
    if (!collectionExists) {
        await db.createCollection(COLLECTION_NAME);
    }
    const collection = db.collection(COLLECTION_NAME);
    const canonicalIdentity = /^\S(?:[\s\S]*\S)?$/;
    const missingTenantIdentity = await collection.countDocuments({
        $or: [
            { agentId: { $not: canonicalIdentity } },
            { channelId: { $not: canonicalIdentity } },
            { taskId: { $not: canonicalIdentity } }
        ]
    });

    if (missingTenantIdentity > 0) {
        throw new Error(
            `${missingTenantIdentity} task-effectiveness record(s) have a missing or non-canonical ` +
            'agent/channel/task identity; repair or remove them before migrating indexes'
        );
    }

    let indexes = await collection.indexes() as IndexInfo[];
    const expectedCompositeKeys = { agentId: 1, channelId: 1, taskId: 1 };
    const existingComposite = findIndex(indexes, COMPOSITE_TENANT_INDEX);
    let compositeCreated = false;

    if (existingComposite) {
        if (!existingComposite.unique || !hasExactKeys(existingComposite, expectedCompositeKeys)) {
            throw new Error(`${COMPOSITE_TENANT_INDEX} exists with an unsafe definition`);
        }
    } else {
        await collection.createIndex(expectedCompositeKeys, {
            name: COMPOSITE_TENANT_INDEX,
            unique: true
        });
        compositeCreated = true;
    }

    indexes = await collection.indexes() as IndexInfo[];
    const verifiedComposite = findIndex(indexes, COMPOSITE_TENANT_INDEX);
    if (!verifiedComposite?.unique || !hasExactKeys(verifiedComposite, expectedCompositeKeys)) {
        throw new Error('Composite task-effectiveness tenant index verification failed');
    }

    const legacyIndex = findIndex(indexes, LEGACY_TASK_INDEX);
    let legacyUniqueRemoved = false;
    if (legacyIndex?.unique) {
        if (!hasExactKeys(legacyIndex, { taskId: 1 })) {
            throw new Error(`${LEGACY_TASK_INDEX} exists with an unexpected definition`);
        }
        await collection.dropIndex(LEGACY_TASK_INDEX);
        await collection.createIndex({ taskId: 1 }, { name: LEGACY_TASK_INDEX });
        legacyUniqueRemoved = true;
    } else if (!legacyIndex) {
        await collection.createIndex({ taskId: 1 }, { name: LEGACY_TASK_INDEX });
    }

    indexes = await collection.indexes() as IndexInfo[];
    const verifiedTaskLookup = findIndex(indexes, LEGACY_TASK_INDEX);
    if (!verifiedTaskLookup || verifiedTaskLookup.unique ||
        !hasExactKeys(verifiedTaskLookup, { taskId: 1 })) {
        throw new Error('Non-unique taskId lookup index verification failed');
    }

    return { compositeCreated, legacyUniqueRemoved };
};

const main = async (): Promise<void> => {
    const mongoUri = requireEnv('MONGODB_URI', 'Set the MongoDB connection string in .env.');
    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB');

    try {
        const result = await migrateTaskEffectivenessTenantIndex(mongoose.connection.db!);
        logger.info(
            `Task effectiveness indexes migrated: compositeCreated=${result.compositeCreated}, ` +
            `legacyUniqueRemoved=${result.legacyUniqueRemoved}`
        );
    } finally {
        await mongoose.disconnect();
        logger.info('Disconnected from MongoDB');
    }
};

if (require.main === module) {
    main().catch((error: unknown) => {
        logger.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
