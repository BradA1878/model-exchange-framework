import { MongoKnowledgeGraphRepository } from '@mxf-dev/core/database/adapters/mongodb/MongoKnowledgeGraphRepository';
import { RelationshipModel } from '@mxf-dev/core/models/relationship';

describe('MongoKnowledgeGraphRepository path enumeration', () => {
    afterEach(() => jest.restoreAllMocks());

    it('keeps longer simple paths that reach a shared intermediate vertex', async () => {
        const relationships = [
            { _id: 'ab', fromEntityId: 'a', toEntityId: 'b' },
            { _id: 'ac', fromEntityId: 'a', toEntityId: 'c' },
            { _id: 'cb', fromEntityId: 'c', toEntityId: 'b' },
            { _id: 'bd', fromEntityId: 'b', toEntityId: 'd' },
            { _id: 'ba', fromEntityId: 'b', toEntityId: 'a' }
        ].map(edge => ({ ...edge, channelId: 'channel', confidence: 1, weight: 1 }));
        jest.spyOn(RelationshipModel, 'find').mockImplementation(((query: { fromEntityId: string; channelId: string }) => ({
            lean: async (): Promise<typeof relationships> => relationships.filter(edge =>
                edge.fromEntityId === query.fromEntityId && edge.channelId === query.channelId)
        })) as never);

        const repository = MongoKnowledgeGraphRepository.getInstance();
        const paths = await repository.findAllPaths('a', 'd', 3, 10, 'channel');
        expect(paths.map(path => path.entityIds)).toEqual([
            ['a', 'b', 'd'],
            ['a', 'c', 'b', 'd']
        ]);
        expect(paths.map(path => path.relationshipIds)).toEqual([['ab', 'bd'], ['ac', 'cb', 'bd']]);
        expect((await repository.findAllPaths('a', 'd', 2, 10, 'channel')).map(path => path.entityIds))
            .toEqual([['a', 'b', 'd']]);
        expect((await repository.findAllPaths('a', 'd', 3, 1, 'channel')).map(path => path.entityIds))
            .toEqual([['a', 'b', 'd']]);
    });
});
