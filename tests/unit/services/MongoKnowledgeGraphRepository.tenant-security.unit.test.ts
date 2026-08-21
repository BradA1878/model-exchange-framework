const mockEntityFindOne = jest.fn();
const mockEntityFind = jest.fn();
const mockEntityUpdateMany = jest.fn();
const mockEntityFindOneAndUpdate = jest.fn();
const mockEntityDeleteOne = jest.fn();
const mockEntityBulkWrite = jest.fn();
const mockRelationshipUpdateMany = jest.fn();
const mockRelationshipFindOneAndUpdate = jest.fn();
const mockRelationshipDeleteOne = jest.fn();
const mockRelationshipDeleteMany = jest.fn();
const mockRelationshipFind = jest.fn();

jest.mock('@mxf-dev/core/models/entity', () => ({
    EntityModel: {
        findOne: mockEntityFindOne,
        find: mockEntityFind,
        updateMany: mockEntityUpdateMany,
        findOneAndUpdate: mockEntityFindOneAndUpdate,
        deleteOne: mockEntityDeleteOne,
        bulkWrite: mockEntityBulkWrite
    },
    toEntityObject: jest.fn((document: unknown) => document)
}));

jest.mock('@mxf-dev/core/models/relationship', () => ({
    RelationshipModel: {
        updateMany: mockRelationshipUpdateMany,
        findOneAndUpdate: mockRelationshipFindOneAndUpdate,
        deleteOne: mockRelationshipDeleteOne,
        deleteMany: mockRelationshipDeleteMany,
        find: mockRelationshipFind
    },
    toRelationshipObject: jest.fn((document: unknown) => document)
}));

jest.mock('@mxf-dev/core/config/knowledge-graph.config', () => ({
    isKnowledgeGraphEnabled: jest.fn(() => true),
    getContextLimits: jest.fn(() => ({ maxEntities: 50, maxRelationships: 100 }))
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import { MongoKnowledgeGraphRepository } from '@mxf-dev/core/database/adapters/mongodb/MongoKnowledgeGraphRepository';

describe('MongoKnowledgeGraphRepository tenant predicates', () => {
    const repository = MongoKnowledgeGraphRepository.getInstance();

    beforeEach(() => {
        jest.clearAllMocks();
        mockEntityUpdateMany.mockResolvedValue({ modifiedCount: 1 });
        mockRelationshipUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    });

    it('binds direct entity lookup to the supplied channel', async () => {
        mockEntityFindOne.mockResolvedValue({
            id: 'entity-a',
            channelId: 'channel-a',
            name: 'Entity A'
        });

        await repository.getEntity('entity-a', 'channel-a');

        expect(mockEntityFindOne).toHaveBeenCalledWith({
            _id: 'entity-a',
            channelId: 'channel-a'
        });
    });

    it('rejects a mixed-channel merge before any mutation', async () => {
        mockEntityFindOne.mockResolvedValue({
            id: 'target-a',
            channelId: 'channel-a',
            aliases: [],
            sourceMemoryIds: [],
            name: 'Target A',
            save: jest.fn()
        });
        mockEntityFind.mockResolvedValue([
            {
                id: 'source-a',
                channelId: 'channel-a',
                aliases: [],
                sourceMemoryIds: [],
                name: 'Source A'
            }
        ]);

        const result = await repository.mergeEntities(
            'target-a',
            ['source-a', 'foreign-source'],
            'channel-a'
        );

        expect(mockEntityFind).toHaveBeenCalledWith({
            _id: { $in: ['source-a', 'foreign-source'] },
            channelId: 'channel-a'
        });
        expect(result).toEqual(expect.objectContaining({ success: false }));
        expect(mockEntityUpdateMany).not.toHaveBeenCalled();
        expect(mockRelationshipUpdateMany).not.toHaveBeenCalled();
    });

    it('keeps every same-channel merge mutation channel-scoped', async () => {
        const targetSave = jest.fn().mockResolvedValue(undefined);
        mockEntityFindOne.mockResolvedValue({
            id: 'target-a',
            channelId: 'channel-a',
            aliases: [],
            sourceMemoryIds: [],
            name: 'Target A',
            save: targetSave
        });
        mockEntityFind.mockResolvedValue([
            {
                id: 'source-a',
                channelId: 'channel-a',
                aliases: [],
                sourceMemoryIds: [],
                name: 'Source A'
            }
        ]);

        const result = await repository.mergeEntities(
            'target-a',
            ['source-a'],
            'channel-a'
        );

        expect(mockEntityUpdateMany).toHaveBeenCalledWith(
            { _id: { $in: ['source-a'] }, channelId: 'channel-a' },
            expect.any(Object)
        );
        expect(mockRelationshipUpdateMany).toHaveBeenCalledWith(
            { fromEntityId: { $in: ['source-a'] }, channelId: 'channel-a' },
            { $set: { fromEntityId: 'target-a' } }
        );
        expect(mockRelationshipUpdateMany).toHaveBeenCalledWith(
            { toEntityId: { $in: ['source-a'] }, channelId: 'channel-a' },
            { $set: { toEntityId: 'target-a' } }
        );
        expect(targetSave).toHaveBeenCalledTimes(1);
        expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    describe('mutations and id-list reads carry the channel predicate', () => {
        beforeEach(() => {
            mockEntityFindOneAndUpdate.mockResolvedValue({ id: 'entity-a', channelId: 'channel-a' });
            mockEntityDeleteOne.mockResolvedValue({ deletedCount: 1 });
            mockEntityBulkWrite.mockResolvedValue({});
            mockRelationshipFindOneAndUpdate.mockResolvedValue({ id: 'rel-a', channelId: 'channel-a' });
            mockRelationshipDeleteOne.mockResolvedValue({ deletedCount: 1 });
            mockRelationshipDeleteMany.mockResolvedValue({ deletedCount: 1 });
            mockEntityFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
            mockRelationshipFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
        });

        it('updates an entity only inside its channel', async () => {
            await repository.updateEntity('entity-a', 'channel-a', { name: 'Renamed' });

            expect(mockEntityFindOneAndUpdate).toHaveBeenCalledWith(
                { _id: 'entity-a', channelId: 'channel-a' },
                { $set: { name: 'Renamed' } },
                { new: true }
            );
        });

        it('deletes an entity and its relationships only inside its channel', async () => {
            await repository.deleteEntity('entity-a', 'channel-a');

            expect(mockEntityDeleteOne).toHaveBeenCalledWith({ _id: 'entity-a', channelId: 'channel-a' });
            expect(mockRelationshipDeleteMany).toHaveBeenCalledWith(expect.objectContaining({
                channelId: 'channel-a'
            }));
        });

        it('updates and deletes a relationship only inside its channel', async () => {
            await repository.updateRelationship('rel-a', 'channel-a', { surpriseScore: 0.9 });
            await repository.deleteRelationship('rel-a', 'channel-a');

            expect(mockRelationshipFindOneAndUpdate).toHaveBeenCalledWith(
                { _id: 'rel-a', channelId: 'channel-a' },
                { $set: { surpriseScore: 0.9 } },
                { new: true }
            );
            expect(mockRelationshipDeleteOne).toHaveBeenCalledWith({ _id: 'rel-a', channelId: 'channel-a' });
        });

        it('scopes Q-value, outcome, and retrieval bookkeeping to the channel', async () => {
            await repository.updateEntityQValue('entity-a', 'channel-a', 0.7, 'test');
            await repository.batchUpdateQValues('channel-a', [{ entityId: 'entity-a', qValue: 0.4, reason: 'r' }]);
            await repository.recordOutcome('channel-a', ['entity-a'], true);
            await repository.incrementRetrievalCount('channel-a', ['entity-a']);

            expect(mockEntityFindOneAndUpdate).toHaveBeenCalledWith(
                { _id: 'entity-a', channelId: 'channel-a' },
                expect.any(Object),
                { new: true }
            );
            expect(mockEntityBulkWrite).toHaveBeenCalledWith([
                expect.objectContaining({
                    updateOne: expect.objectContaining({
                        filter: { _id: 'entity-a', channelId: 'channel-a' }
                    })
                })
            ]);
            expect(mockEntityUpdateMany).toHaveBeenCalledWith(
                { _id: { $in: ['entity-a'] }, channelId: 'channel-a' },
                { $inc: { 'utility.successCount': 1 } }
            );
            expect(mockEntityUpdateMany).toHaveBeenCalledWith(
                { _id: { $in: ['entity-a'] }, channelId: 'channel-a' },
                expect.objectContaining({ $inc: { 'utility.retrievalCount': 1 } })
            );
        });

        it('reads entities and relationships by id only inside the channel', async () => {
            await repository.getEntitiesByIds('channel-a', ['entity-a']);
            await repository.getRelationshipsByEntityIds('channel-a', ['entity-a']);

            expect(mockEntityFind).toHaveBeenCalledWith(expect.objectContaining({
                _id: { $in: ['entity-a'] },
                channelId: 'channel-a'
            }));
            expect(mockRelationshipFind).toHaveBeenCalledWith(expect.objectContaining({
                channelId: 'channel-a'
            }));
        });

        it('refuses a mutation without a channel', async () => {
            await expect(repository.updateEntity('entity-a', '', { name: 'x' })).rejects.toThrow(/channelId/);
            await expect(repository.deleteRelationship('rel-a', '   ')).rejects.toThrow(/channelId/);
            expect(mockEntityFindOneAndUpdate).not.toHaveBeenCalled();
            expect(mockRelationshipDeleteOne).not.toHaveBeenCalled();
        });
    });
});
