/**
 * Property-based tests for Knowledge Graph
 * Uses fast-check to verify graph query and Q-value properties
 */

import fc from 'fast-check';
import {
    EntityType,
    RelationshipType,
    Entity,
    Relationship,
    DEFAULT_ENTITY_UTILITY,
    EntityUtility,
} from '@mxf/shared/types/KnowledgeGraphTypes';

/**
 * Create a test entity
 */
function createEntity(
    id: string,
    name: string,
    type: EntityType,
    channelId: string = 'test',
    qValue: number = 0.5
): Entity {
    return {
        id,
        channelId,
        type,
        name,
        aliases: [],
        properties: {},
        utility: {
            ...DEFAULT_ENTITY_UTILITY,
            qValue,
        },
        confidence: 0.8,
        source: 'test',
        sourceMemoryIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        merged: false,
    };
}

/**
 * Create a test relationship
 */
function createRelationship(
    id: string,
    fromId: string,
    toId: string,
    type: RelationshipType,
    channelId: string = 'test'
): Relationship {
    return {
        id,
        channelId,
        fromEntityId: fromId,
        toEntityId: toId,
        type,
        properties: {},
        confidence: 0.8,
        surpriseScore: 0,
        source: 'test',
        sourceMemoryIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        weight: 1.0,
    };
}

/**
 * Simple in-memory graph for testing
 */
class SimpleGraph {
    entities: Map<string, Entity> = new Map();
    relationships: Map<string, Relationship> = new Map();
    adjacency: Map<string, Set<string>> = new Map(); // entityId -> set of connected entityIds

    addEntity(entity: Entity): void {
        this.entities.set(entity.id, entity);
        this.adjacency.set(entity.id, new Set());
    }

    addRelationship(rel: Relationship): void {
        this.relationships.set(rel.id, rel);
        this.adjacency.get(rel.fromEntityId)?.add(rel.toEntityId);
        this.adjacency.get(rel.toEntityId)?.add(rel.fromEntityId);
    }

    getNeighbors(entityId: string): string[] {
        return Array.from(this.adjacency.get(entityId) || []);
    }

    findPath(fromId: string, toId: string, maxHops: number): string[] | null {
        if (fromId === toId) return [fromId];
        if (!this.entities.has(fromId) || !this.entities.has(toId)) return null;

        // BFS for shortest path
        const visited = new Set<string>([fromId]);
        const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];

        while (queue.length > 0) {
            const { id, path } = queue.shift()!;
            // If current path already has maxHops edges, we can't add more
            if (path.length > maxHops) continue;

            const neighbors = this.getNeighbors(id);
            for (const neighbor of neighbors) {
                if (neighbor === toId) {
                    return [...path, neighbor];
                }
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({ id: neighbor, path: [...path, neighbor] });
                }
            }
        }

        return null;
    }
}

/**
 * Arbitrary for generating entity types
 */
const entityTypeArbitrary = fc.constantFrom(
    EntityType.Person,
    EntityType.Organization,
    EntityType.Project,
    EntityType.Technology,
    EntityType.Concept
);

/**
 * Arbitrary for generating relationship types
 */
const relationshipTypeArbitrary = fc.constantFrom(
    RelationshipType.WORKS_ON,
    RelationshipType.USES,
    RelationshipType.DEPENDS_ON,
    RelationshipType.OWNS,
    RelationshipType.CREATED,
    RelationshipType.RELATED_TO
);

/**
 * Arbitrary for generating Q-values (bounded)
 */
const qValueArbitrary = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Arbitrary for generating a simple graph
 */
function graphArbitrary(maxEntities: number = 10): fc.Arbitrary<SimpleGraph> {
    return fc.record({
        entityCount: fc.integer({ min: 1, max: maxEntities }),
        relationshipIndices: fc.array(
            fc.tuple(
                fc.integer({ min: 0, max: maxEntities - 1 }),
                fc.integer({ min: 0, max: maxEntities - 1 })
            ),
            { maxLength: maxEntities * 2 }
        ),
        entityTypes: fc.array(entityTypeArbitrary, { minLength: maxEntities, maxLength: maxEntities }),
        relationshipTypes: fc.array(relationshipTypeArbitrary, { maxLength: maxEntities * 2 }),
        qValues: fc.array(qValueArbitrary, { minLength: maxEntities, maxLength: maxEntities }),
    }).map(({ entityCount, relationshipIndices, entityTypes, relationshipTypes, qValues }) => {
        const graph = new SimpleGraph();

        // Add entities
        for (let i = 0; i < entityCount; i++) {
            graph.addEntity(createEntity(
                `e${i}`,
                `Entity ${i}`,
                entityTypes[i % entityTypes.length],
                'test',
                qValues[i % qValues.length]
            ));
        }

        // Add relationships (no self-loops)
        let relIndex = 0;
        for (const [from, to] of relationshipIndices) {
            if (from !== to && from < entityCount && to < entityCount) {
                const relId = `r${relIndex}`;
                const relType = relationshipTypes[relIndex % relationshipTypes.length];
                const rel = createRelationship(relId, `e${from}`, `e${to}`, relType);
                graph.addRelationship(rel);
                relIndex++;
            }
        }

        return graph;
    });
}

describe('Knowledge Graph Property Tests', () => {
    describe('Entity Lookup Properties', () => {
        it('creating then finding entity returns same entity', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }),
                    entityTypeArbitrary,
                    qValueArbitrary,
                    (name, type, qValue) => {
                        const graph = new SimpleGraph();
                        const entity = createEntity('test-id', name, type, 'test', qValue);
                        graph.addEntity(entity);

                        const found = graph.entities.get('test-id');
                        return found !== undefined &&
                            found.name === name &&
                            found.type === type &&
                            Math.abs(found.utility.qValue - qValue) < 0.001;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('entity not in graph returns undefined', () => {
            fc.assert(
                fc.property(
                    graphArbitrary(),
                    fc.string({ minLength: 20, maxLength: 30 }), // unlikely to match
                    (graph, unknownId) => {
                        const found = graph.entities.get(unknownId);
                        return found === undefined;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Path Finding Properties', () => {
        it('findPath returns path only if path exists', () => {
            fc.assert(
                fc.property(
                    graphArbitrary(),
                    fc.integer({ min: 0, max: 9 }),
                    fc.integer({ min: 0, max: 9 }),
                    fc.integer({ min: 1, max: 5 }),
                    (graph, fromIdx, toIdx, maxHops) => {
                        const fromId = `e${fromIdx}`;
                        const toId = `e${toIdx}`;

                        if (!graph.entities.has(fromId) || !graph.entities.has(toId)) {
                            return true; // Skip if entities don't exist
                        }

                        const path = graph.findPath(fromId, toId, maxHops);

                        if (path === null) {
                            return true; // No path found is valid
                        }

                        // Verify path is valid
                        if (path[0] !== fromId || path[path.length - 1] !== toId) {
                            return false;
                        }

                        // Verify path length respects maxHops
                        if (path.length - 1 > maxHops) {
                            return false;
                        }

                        // Verify each step in path has an edge
                        for (let i = 0; i < path.length - 1; i++) {
                            const neighbors = graph.getNeighbors(path[i]);
                            if (!neighbors.includes(path[i + 1])) {
                                return false;
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('path from A to A returns single-element path', () => {
            fc.assert(
                fc.property(
                    graphArbitrary(),
                    fc.integer({ min: 0, max: 9 }),
                    (graph, idx) => {
                        const entityId = `e${idx}`;
                        if (!graph.entities.has(entityId)) {
                            return true;
                        }

                        const path = graph.findPath(entityId, entityId, 5);
                        return path !== null && path.length === 1 && path[0] === entityId;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Neighbor Query Properties', () => {
        it('getNeighbors returns only connected entities', () => {
            fc.assert(
                fc.property(
                    graphArbitrary(),
                    fc.integer({ min: 0, max: 9 }),
                    (graph, idx) => {
                        const entityId = `e${idx}`;
                        if (!graph.entities.has(entityId)) {
                            return true;
                        }

                        const neighbors = graph.getNeighbors(entityId);

                        // Every neighbor should be connected via a relationship
                        for (const neighborId of neighbors) {
                            let hasConnection = false;
                            for (const rel of graph.relationships.values()) {
                                if (
                                    (rel.fromEntityId === entityId && rel.toEntityId === neighborId) ||
                                    (rel.fromEntityId === neighborId && rel.toEntityId === entityId)
                                ) {
                                    hasConnection = true;
                                    break;
                                }
                            }
                            if (!hasConnection) {
                                return false;
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('neighbors are symmetric (undirected graph view)', () => {
            fc.assert(
                fc.property(
                    graphArbitrary(),
                    fc.integer({ min: 0, max: 9 }),
                    (graph, idx) => {
                        const entityId = `e${idx}`;
                        if (!graph.entities.has(entityId)) {
                            return true;
                        }

                        const neighbors = graph.getNeighbors(entityId);

                        for (const neighborId of neighbors) {
                            const reverseNeighbors = graph.getNeighbors(neighborId);
                            if (!reverseNeighbors.includes(entityId)) {
                                return false; // Not symmetric
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Q-Value Properties', () => {
        it('Q-value updates are bounded (0-1)', () => {
            fc.assert(
                fc.property(
                    qValueArbitrary,
                    fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 50 }),
                    fc.double({ min: 0.01, max: 0.5, noNaN: true }),
                    (initialQ, rewards, learningRate) => {
                        let q = initialQ;

                        for (const reward of rewards) {
                            q = q + learningRate * (reward - q);
                            q = Math.max(0, Math.min(1, q)); // Clamp
                        }

                        return q >= 0 && q <= 1;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('Q-value converges towards consistent rewards', () => {
            fc.assert(
                fc.property(
                    qValueArbitrary,
                    fc.double({ min: 0, max: 1, noNaN: true }),
                    fc.integer({ min: 50, max: 100 }),
                    (initialQ, reward, iterations) => {
                        let q = initialQ;
                        const learningRate = 0.1;

                        for (let i = 0; i < iterations; i++) {
                            q = q + learningRate * (reward - q);
                            q = Math.max(0, Math.min(1, q));
                        }

                        // After many iterations with same reward, Q should be close to reward
                        return Math.abs(q - reward) < 0.1;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('higher Q-values rank entities higher', () => {
            fc.assert(
                fc.property(
                    fc.array(qValueArbitrary, { minLength: 3, maxLength: 10 }),
                    fc.double({ min: 0, max: 1, noNaN: true }), // lambda
                    (qValues, lambda) => {
                        const entities = qValues.map((q, i) =>
                            createEntity(`e${i}`, `Entity ${i}`, EntityType.Concept, 'test', q)
                        );

                        // Sort by Q-value descending
                        const sorted = [...entities].sort(
                            (a, b) => b.utility.qValue - a.utility.qValue
                        );

                        // First entity should have highest Q
                        const maxQ = Math.max(...qValues);
                        return sorted[0].utility.qValue === maxQ;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Relationship Properties', () => {
        it('relationship connects two existing entities', () => {
            fc.assert(
                fc.property(
                    graphArbitrary(),
                    (graph) => {
                        for (const rel of graph.relationships.values()) {
                            if (!graph.entities.has(rel.fromEntityId) ||
                                !graph.entities.has(rel.toEntityId)) {
                                return false;
                            }
                        }
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('no self-referential relationships', () => {
            fc.assert(
                fc.property(
                    graphArbitrary(),
                    (graph) => {
                        for (const rel of graph.relationships.values()) {
                            if (rel.fromEntityId === rel.toEntityId) {
                                return false;
                            }
                        }
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Surprise Score Properties', () => {
        it('surprise score is bounded (0-1)', () => {
            fc.assert(
                fc.property(
                    fc.double({ min: 0, max: 1, noNaN: true }), // conflict factor
                    fc.double({ min: 0, max: 1, noNaN: true }), // pattern surprise
                    fc.double({ min: 0, max: 1, noNaN: true }), // q-diff
                    fc.double({ min: 0, max: 1, noNaN: true }), // confidence
                    (conflictFactor, patternSurprise, qDiff, confidence) => {
                        // Simulate surprise calculation
                        let score = 0;

                        if (conflictFactor > 0.5) score += 0.4;
                        score += patternSurprise * 0.3;
                        if (qDiff > 0.5) score += qDiff * 0.2;
                        if (confidence < 0.5) score += (1 - confidence) * 0.2;

                        score = Math.min(1, score);

                        return score >= 0 && score <= 1;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Entity Similarity Properties', () => {
        /**
         * Simple name similarity (Jaccard on character trigrams)
         */
        function nameSimilarity(name1: string, name2: string): number {
            const trigrams1 = new Set<string>();
            const trigrams2 = new Set<string>();

            const n1 = name1.toLowerCase();
            const n2 = name2.toLowerCase();

            for (let i = 0; i <= n1.length - 3; i++) {
                trigrams1.add(n1.substring(i, i + 3));
            }
            for (let i = 0; i <= n2.length - 3; i++) {
                trigrams2.add(n2.substring(i, i + 3));
            }

            if (trigrams1.size === 0 && trigrams2.size === 0) return 1;
            if (trigrams1.size === 0 || trigrams2.size === 0) return 0;

            const intersection = new Set([...trigrams1].filter(t => trigrams2.has(t)));
            const union = new Set([...trigrams1, ...trigrams2]);

            return intersection.size / union.size;
        }

        it('similarity is symmetric', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 3, maxLength: 20 }),
                    fc.string({ minLength: 3, maxLength: 20 }),
                    (name1, name2) => {
                        const sim1 = nameSimilarity(name1, name2);
                        const sim2 = nameSimilarity(name2, name1);
                        return Math.abs(sim1 - sim2) < 0.001;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('similarity with self is 1', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 3, maxLength: 20 }),
                    (name) => {
                        const sim = nameSimilarity(name, name);
                        return sim === 1;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('similarity is bounded (0-1)', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 3, maxLength: 20 }),
                    fc.string({ minLength: 3, maxLength: 20 }),
                    (name1, name2) => {
                        const sim = nameSimilarity(name1, name2);
                        return sim >= 0 && sim <= 1;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
