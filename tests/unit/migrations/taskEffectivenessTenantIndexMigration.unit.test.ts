import mongoose from 'mongoose';
import {
    migrateTaskEffectivenessTenantIndex
} from '../../../src/migrations/2026.08.task-effectiveness-tenant-index';

interface TestIndex {
    name: string;
    key: Record<string, number>;
    unique?: boolean;
}

const createDatabase = (
    initialIndexes: TestIndex[],
    missingTenantIdentity = 0,
    applyIndexWrites = true,
    collectionExists = true
): {
    db: mongoose.mongo.Db;
    indexes: TestIndex[];
    countDocuments: jest.Mock;
    listIndexes: jest.Mock;
    createIndex: jest.Mock;
    dropIndex: jest.Mock;
    createCollection: jest.Mock;
} => {
    const indexes = initialIndexes.map(index => ({ ...index, key: { ...index.key } }));
    const countDocuments = jest.fn().mockResolvedValue(missingTenantIdentity);
    const listIndexes = jest.fn().mockImplementation(async () =>
        indexes.map(index => ({ ...index, key: { ...index.key } }))
    );
    const createIndex = jest.fn().mockImplementation(async (
        key: Record<string, number>,
        options: { name: string; unique?: boolean }
    ) => {
        if (applyIndexWrites) {
            indexes.push({ name: options.name, key: { ...key }, unique: options.unique });
        }
        return options.name;
    });
    const dropIndex = jest.fn().mockImplementation(async (name: string) => {
        if (applyIndexWrites) {
            const position = indexes.findIndex(index => index.name === name);
            if (position >= 0) {
                indexes.splice(position, 1);
            }
        }
    });
    const collection = {
        countDocuments,
        indexes: listIndexes,
        createIndex,
        dropIndex
    };
    const createCollection = jest.fn().mockResolvedValue(collection);
    const db = {
        listCollections: jest.fn().mockReturnValue({
            hasNext: jest.fn().mockResolvedValue(collectionExists)
        }),
        createCollection,
        collection: jest.fn().mockReturnValue(collection)
    } as unknown as mongoose.mongo.Db;

    return {
        db,
        indexes,
        countDocuments,
        listIndexes,
        createIndex,
        dropIndex,
        createCollection
    };
};

describe('task-effectiveness tenant index migration', () => {
    it('verifies a composite unique index before replacing the global unique taskId index', async () => {
        const database = createDatabase([
            { name: '_id_', key: { _id: 1 }, unique: true },
            { name: 'taskId_1', key: { taskId: 1 }, unique: true }
        ]);

        await expect(migrateTaskEffectivenessTenantIndex(database.db)).resolves.toEqual({
            compositeCreated: true,
            legacyUniqueRemoved: true
        });
        expect(database.createIndex).toHaveBeenNthCalledWith(
            1,
            { agentId: 1, channelId: 1, taskId: 1 },
            { name: 'agentId_1_channelId_1_taskId_1', unique: true }
        );
        expect(database.dropIndex).toHaveBeenCalledWith('taskId_1');
        expect(database.createIndex).toHaveBeenNthCalledWith(
            2,
            { taskId: 1 },
            { name: 'taskId_1' }
        );
        expect(database.indexes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'agentId_1_channelId_1_taskId_1',
                unique: true
            }),
            expect.objectContaining({ name: 'taskId_1', unique: undefined })
        ]));
    });

    it('is idempotent after the safe indexes already exist', async () => {
        const database = createDatabase([
            { name: '_id_', key: { _id: 1 }, unique: true },
            {
                name: 'agentId_1_channelId_1_taskId_1',
                key: { agentId: 1, channelId: 1, taskId: 1 },
                unique: true
            },
            { name: 'taskId_1', key: { taskId: 1 } }
        ]);

        await expect(migrateTaskEffectivenessTenantIndex(database.db)).resolves.toEqual({
            compositeCreated: false,
            legacyUniqueRemoved: false
        });
        expect(database.createIndex).not.toHaveBeenCalled();
        expect(database.dropIndex).not.toHaveBeenCalled();
    });

    it('creates the collection and safe indexes on a fresh database', async () => {
        const database = createDatabase([], 0, true, false);

        await expect(migrateTaskEffectivenessTenantIndex(database.db)).resolves.toEqual({
            compositeCreated: true,
            legacyUniqueRemoved: false
        });
        expect(database.createCollection).toHaveBeenCalledWith('taskeffectiveness');
        expect(database.createIndex).toHaveBeenCalledWith(
            { agentId: 1, channelId: 1, taskId: 1 },
            { name: 'agentId_1_channelId_1_taskId_1', unique: true }
        );
        expect(database.createIndex).toHaveBeenCalledWith(
            { taskId: 1 },
            { name: 'taskId_1' }
        );
    });

    it('fails before index changes when legacy rows lack authoritative tenant identity', async () => {
        const database = createDatabase([
            { name: 'taskId_1', key: { taskId: 1 }, unique: true }
        ], 2);

        await expect(migrateTaskEffectivenessTenantIndex(database.db)).rejects.toThrow(
            '2 task-effectiveness record(s) have a missing or non-canonical agent/channel/task identity'
        );
        expect(database.createIndex).not.toHaveBeenCalled();
        expect(database.dropIndex).not.toHaveBeenCalled();
    });

    it('preflights every composite identity field as a canonical non-whitespace string', async () => {
        const database = createDatabase([
            { name: 'taskId_1', key: { taskId: 1 }, unique: true }
        ], 1);

        await expect(migrateTaskEffectivenessTenantIndex(database.db)).rejects.toThrow(
            'missing or non-canonical agent/channel/task identity'
        );
        const query = database.countDocuments.mock.calls[0][0] as {
            $or: Array<Record<string, { $not: RegExp }>>;
        };
        const fields = query.$or.map(condition => Object.keys(condition)[0]);
        expect(fields).toEqual(['agentId', 'channelId', 'taskId']);
        for (const condition of query.$or) {
            const pattern = Object.values(condition)[0].$not;
            expect(pattern.test('tenant-id')).toBe(true);
            expect(pattern.test(' tenant-id')).toBe(false);
            expect(pattern.test('tenant-id ')).toBe(false);
            expect(pattern.test('   ')).toBe(false);
            expect(pattern.test('')).toBe(false);
        }
        expect(database.createIndex).not.toHaveBeenCalled();
        expect(database.dropIndex).not.toHaveBeenCalled();
    });

    it('does not remove the legacy unique index when composite verification fails', async () => {
        const database = createDatabase([
            { name: 'taskId_1', key: { taskId: 1 }, unique: true }
        ], 0, false);

        await expect(migrateTaskEffectivenessTenantIndex(database.db)).rejects.toThrow(
            'Composite task-effectiveness tenant index verification failed'
        );
        expect(database.dropIndex).not.toHaveBeenCalled();
    });

    it('rejects an existing composite index with unsafe uniqueness', async () => {
        const database = createDatabase([
            {
                name: 'agentId_1_channelId_1_taskId_1',
                key: { agentId: 1, channelId: 1, taskId: 1 }
            },
            { name: 'taskId_1', key: { taskId: 1 }, unique: true }
        ]);

        await expect(migrateTaskEffectivenessTenantIndex(database.db)).rejects.toThrow(
            'exists with an unsafe definition'
        );
        expect(database.dropIndex).not.toHaveBeenCalled();
    });
});
