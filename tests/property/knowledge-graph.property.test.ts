/** Production graph traversal and entity reward properties; only database I/O is stubbed. */
import fc from 'fast-check';
import { EntityModel } from '@mxf-dev/core/models/entity';
import { RelationshipModel } from '@mxf-dev/core/models/relationship';
import { MongoKnowledgeGraphRepository } from '@mxf-dev/core/database/adapters/mongodb/MongoKnowledgeGraphRepository';
import { EntityQValueManager } from '@mxf-dev/core/services/kg/EntityQValueManager';
import { DEFAULT_ENTITY_UTILITY, Entity, EntityType, RelationshipType } from '@mxf-dev/core/types/KnowledgeGraphTypes';

jest.mock('@mxf-dev/core/config/knowledge-graph.config', () => ({
    isKnowledgeGraphEnabled: (): boolean => true,
    isQValueLearningEnabled: (): boolean => true,
    getQValueLearningRate: (): number => 0.1,
    getContextLimits: (): { maxEntities: number; maxRelationships: number } => ({ maxEntities: 50, maxRelationships: 100 })
}));

type Row = Record<string, unknown>;
const channelId = 'property-channel';
const repository = MongoKnowledgeGraphRepository.getInstance();

/** Interpret the Mongo predicates used by these reads; traversal remains in the repository. */
const matches = (row: Row, query: Row): boolean => Object.entries(query).every(([key, value]) => {
    if (key === '$or') return (value as Row[]).some(branch => matches(row, branch));
    if (value && typeof value === 'object' && '$in' in value) {
        return (value as { $in: unknown[] }).$in.includes(row[key]);
    }
    return row[key] === value;
});

interface QueryRows {
    limit(count: number): QueryRows;
    lean(): Promise<Row[]>;
}

const queryResult = (rows: Row[]): QueryRows => {
    let limit = rows.length;
    return {
        limit(count: number): QueryRows { limit = count; return this; },
        async lean(): Promise<Row[]> { return rows.slice(0, limit); }
    };
};

const installRows = (entities: Row[], relationships: Row[]): void => {
    jest.spyOn(EntityModel, 'find').mockImplementation(((query: Row) =>
        queryResult(entities.filter(row => matches(row, query)))) as never);
    jest.spyOn(RelationshipModel, 'find').mockImplementation(((query: Row) =>
        queryResult(relationships.filter(row => matches(row, query)))) as never);
};

const entityRow = (id: string, scope = channelId): Row => ({
    _id: id, channelId: scope, name: id, type: EntityType.Concept,
    merged: false, createdAt: new Date(1), updatedAt: new Date(1)
});

const relationshipRow = (
    id: string, fromEntityId: string, toEntityId: string, scope = channelId
): Row => ({
    _id: id, fromEntityId, toEntityId, channelId: scope,
    type: RelationshipType.RELATED_TO, confidence: 0.8, weight: 2,
    createdAt: new Date(1), updatedAt: new Date(1)
});

describe('Production knowledge-graph traversal properties', () => {
    afterEach(() => jest.restoreAllMocks());

    it('finds generated directed chains within the hop limit and excludes foreign shortcuts', async () => {
        await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async hops => {
            jest.restoreAllMocks();
            const ids = Array.from({ length: hops + 1 }, (_, index) => `node-${index}`);
            const relationships = ids.slice(1).map((id, index) =>
                relationshipRow(`edge-${index}`, ids[index], id));
            relationships.push(relationshipRow('foreign-shortcut', ids[0], ids[hops], 'foreign'));
            // A cycle must not lead traversal to repeat vertices.
            relationships.push(relationshipRow('back-edge', ids[hops], ids[0]));
            installRows(ids.map(id => entityRow(id)), relationships);

            const path = await repository.findPath(ids[0], ids[hops], hops, channelId);
            expect(path?.entityIds).toEqual(ids);
            expect(path?.relationshipIds).toEqual(ids.slice(1).map((_, index) => `edge-${index}`));
            expect(path?.length).toBe(hops);
            expect(path?.totalWeight).toBe(hops * 2);
            expect(path?.confidence).toBeCloseTo(Math.pow(0.8, hops), 12);
            expect(await repository.findPath(ids[0], ids[hops], hops - 1, channelId)).toBeNull();
            expect(await repository.findPath(ids[0], 'absent', hops + 1, channelId)).toBeNull();
        }), { numRuns: 50 });
    });

    it('returns a direct edge as the shortest path when a longer alternative exists', async () => {
        await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 6 }), async middleCount => {
            jest.restoreAllMocks();
            const ids = ['start', ...Array.from({ length: middleCount }, (_, i) => `middle-${i}`), 'end'];
            const edges = ids.slice(1).map((id, i) => relationshipRow(`edge-${i}`, ids[i], id));
            edges.push(relationshipRow('direct', 'start', 'end'));
            installRows(ids.map(id => entityRow(id)), edges);

            expect((await repository.findPath('start', 'end', ids.length, channelId))?.entityIds)
                .toEqual(['start', 'end']);
            expect(await repository.findPath('end', 'start', ids.length, channelId)).toBeNull();
        }), { numRuns: 30 });
    });

    it('returns exactly the requested neighbor directions with matching scoped relationships', async () => {
        await fc.assert(fc.asyncProperty(
            fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
            fc.constantFrom<'incoming' | 'outgoing' | 'both'>('incoming', 'outgoing', 'both'),
            async (outgoing, direction) => {
                jest.restoreAllMocks();
                const ids = outgoing.map((_, index) => `neighbor-${index}`);
                const edges = ids.map((id, index) => relationshipRow(`edge-${index}`,
                    outgoing[index] ? 'center' : id, outgoing[index] ? id : 'center'));
                edges.push(relationshipRow('foreign-edge', 'center', 'foreign-node', 'foreign'));
                installRows([entityRow('center'), ...ids.map(id => entityRow(id)), entityRow('foreign-node', 'foreign')], edges);

                const result = await repository.getNeighbors('center', { direction }, channelId);
                const expected = ids.filter((_, index) => direction === 'both' ||
                    outgoing[index] === (direction === 'outgoing'));
                expect(result.entities.map(entity => entity.id).sort()).toEqual([...expected].sort());
                expect(result.relationships).toHaveLength(expected.length);
                expect(result.relationships.every(edge => edge.channelId === channelId)).toBe(true);
                for (const entity of result.entities) {
                    const reverse = await repository.getNeighbors(entity.id, { direction: 'both' }, channelId);
                    expect(reverse.entities.map(neighbor => neighbor.id)).toContain('center');
                }
            }
        ), { numRuns: 50 });
    });
});

describe('Production entity Q-value properties', () => {
    const manager = EntityQValueManager.getInstance();
    afterEach(() => jest.restoreAllMocks());

    it('updates persisted entities with bounded rewards and converges to the normalized target', async () => {
        await fc.assert(fc.asyncProperty(
            fc.double({ min: 0, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true }),
            async (initialQ, reward) => {
                jest.restoreAllMocks();
                const entity: Entity = {
                    id: 'rewarded', channelId, name: 'Rewarded', type: EntityType.Concept,
                    aliases: [], properties: {}, utility: { ...DEFAULT_ENTITY_UTILITY, qValue: initialQ },
                    confidence: 0.8, source: 'test', sourceMemoryIds: [],
                    createdAt: 1, updatedAt: 1, merged: false
                };
                jest.spyOn(repository, 'getEntity').mockImplementation(async (id, scope) =>
                    id === entity.id && scope === channelId ? entity : null);
                const persist = jest.spyOn(repository, 'updateEntityQValue').mockImplementation(async (id, scope, qValue) => {
                    expect(id).toBe(entity.id);
                    expect(scope).toBe(channelId);
                    entity.utility.qValue = qValue;
                    return entity;
                });

                const target = (reward + 1) / 2;
                for (let iteration = 0; iteration < 80; iteration++) {
                    const result = await manager.updateEntityQValue({
                        entityId: entity.id, channelId, reward, reason: 'property reward'
                    });
                    expect(result?.newQValue).toBeGreaterThanOrEqual(0);
                    expect(result?.newQValue).toBeLessThanOrEqual(1);
                    expect(result?.newQValue).toBe(entity.utility.qValue);
                }
                expect(persist).toHaveBeenCalledTimes(80);
                expect(Math.abs(entity.utility.qValue - target))
                    .toBeLessThanOrEqual(Math.pow(0.9, 80) * Math.abs(initialQ - target) + 1e-12);
            }
        ), { numRuns: 40 });
    });
});
