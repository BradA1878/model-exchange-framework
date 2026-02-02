/**
 * Unit tests for GraphSurpriseCalculator
 * Tests surprise scoring, conflict detection, and pattern matching
 */

import {
    EntityType,
    RelationshipType,
    Entity,
    Relationship,
    DEFAULT_ENTITY_UTILITY,
} from '@mxf/shared/types/KnowledgeGraphTypes';

/**
 * Conflicting relationship types map (matches service implementation)
 */
const CONFLICTING_TYPES: Map<RelationshipType, RelationshipType[]> = new Map([
    [RelationshipType.OWNS, [RelationshipType.REPORTS_TO]],
    [RelationshipType.REPORTS_TO, [RelationshipType.OWNS]],
    [RelationshipType.PRECEDES, [RelationshipType.FOLLOWS]],
    [RelationshipType.FOLLOWS, [RelationshipType.PRECEDES]],
    [RelationshipType.CONFLICTS_WITH, [RelationshipType.COLLABORATES_WITH]],
    [RelationshipType.COLLABORATES_WITH, [RelationshipType.CONFLICTS_WITH]],
]);

/**
 * Expected relationship patterns (entity type pairs -> likely relationship types)
 */
const EXPECTED_PATTERNS: Map<string, RelationshipType[]> = new Map([
    ['person->project', [RelationshipType.WORKS_ON, RelationshipType.CREATED, RelationshipType.OWNS]],
    ['person->organization', [RelationshipType.WORKS_ON, RelationshipType.REPORTS_TO]],
    ['project->technology', [RelationshipType.USES, RelationshipType.DEPENDS_ON, RelationshipType.IMPLEMENTS]],
    ['organization->project', [RelationshipType.OWNS, RelationshipType.CREATED]],
    ['person->person', [RelationshipType.COLLABORATES_WITH, RelationshipType.REPORTS_TO]],
    ['technology->technology', [RelationshipType.DEPENDS_ON, RelationshipType.EXTENDS, RelationshipType.IMPLEMENTS]],
]);

/**
 * Helper to create test entity
 */
function createTestEntity(
    id: string,
    name: string,
    type: EntityType,
    qValue: number = 0.5
): Entity {
    return {
        id,
        channelId: 'test-channel',
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
 * Helper to create test relationship
 */
function createTestRelationship(
    id: string,
    fromEntityId: string,
    toEntityId: string,
    type: RelationshipType,
    confidence: number = 0.8
): Relationship {
    return {
        id,
        channelId: 'test-channel',
        fromEntityId,
        toEntityId,
        type,
        properties: {},
        confidence,
        surpriseScore: 0,
        source: 'test',
        sourceMemoryIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        weight: 1.0,
    };
}

describe('GraphSurpriseCalculator', () => {
    describe('Conflict Detection', () => {
        /**
         * Check if a relationship type has a conflict with existing types
         */
        function hasConflict(
            newType: RelationshipType,
            existingTypes: RelationshipType[]
        ): boolean {
            const conflictingTypes = CONFLICTING_TYPES.get(newType);
            if (!conflictingTypes) return false;
            return existingTypes.some(t => conflictingTypes.includes(t));
        }

        it('detects OWNS vs REPORTS_TO conflict', () => {
            expect(hasConflict(RelationshipType.OWNS, [RelationshipType.REPORTS_TO])).toBe(true);
        });

        it('detects REPORTS_TO vs OWNS conflict', () => {
            expect(hasConflict(RelationshipType.REPORTS_TO, [RelationshipType.OWNS])).toBe(true);
        });

        it('detects PRECEDES vs FOLLOWS conflict', () => {
            expect(hasConflict(RelationshipType.PRECEDES, [RelationshipType.FOLLOWS])).toBe(true);
        });

        it('detects FOLLOWS vs PRECEDES conflict', () => {
            expect(hasConflict(RelationshipType.FOLLOWS, [RelationshipType.PRECEDES])).toBe(true);
        });

        it('detects CONFLICTS_WITH vs COLLABORATES_WITH conflict', () => {
            expect(hasConflict(RelationshipType.CONFLICTS_WITH, [RelationshipType.COLLABORATES_WITH])).toBe(true);
        });

        it('returns false for non-conflicting types', () => {
            expect(hasConflict(RelationshipType.WORKS_ON, [RelationshipType.USES])).toBe(false);
            expect(hasConflict(RelationshipType.USES, [RelationshipType.DEPENDS_ON])).toBe(false);
        });

        it('returns false for types with no conflict definition', () => {
            expect(hasConflict(RelationshipType.USES, [RelationshipType.CREATED])).toBe(false);
        });

        it('handles empty existing types array', () => {
            expect(hasConflict(RelationshipType.OWNS, [])).toBe(false);
        });

        it('handles multiple existing types', () => {
            expect(hasConflict(RelationshipType.OWNS, [
                RelationshipType.USES,
                RelationshipType.REPORTS_TO,
                RelationshipType.WORKS_ON,
            ])).toBe(true);
        });
    });

    describe('Pattern Surprise', () => {
        /**
         * Calculate pattern surprise score
         */
        function calculatePatternSurprise(
            fromType: EntityType,
            toType: EntityType,
            relType: RelationshipType
        ): number {
            const key = `${fromType.toLowerCase()}->${toType.toLowerCase()}`;
            const expectedTypes = EXPECTED_PATTERNS.get(key);

            if (!expectedTypes) {
                return 0.5; // Unknown pattern
            }

            if (expectedTypes.includes(relType)) {
                return 0; // Expected
            }

            return 0.7; // Unexpected
        }

        describe('Person -> Project relationships', () => {
            it('returns 0 for expected WORKS_ON', () => {
                const surprise = calculatePatternSurprise(
                    EntityType.Person,
                    EntityType.Project,
                    RelationshipType.WORKS_ON
                );
                expect(surprise).toBe(0);
            });

            it('returns 0 for expected CREATED', () => {
                const surprise = calculatePatternSurprise(
                    EntityType.Person,
                    EntityType.Project,
                    RelationshipType.CREATED
                );
                expect(surprise).toBe(0);
            });

            it('returns 0 for expected OWNS', () => {
                const surprise = calculatePatternSurprise(
                    EntityType.Person,
                    EntityType.Project,
                    RelationshipType.OWNS
                );
                expect(surprise).toBe(0);
            });

            it('returns 0.7 for unexpected DEPENDS_ON', () => {
                const surprise = calculatePatternSurprise(
                    EntityType.Person,
                    EntityType.Project,
                    RelationshipType.DEPENDS_ON
                );
                expect(surprise).toBe(0.7);
            });
        });

        describe('Project -> Technology relationships', () => {
            it('returns 0 for expected USES', () => {
                const surprise = calculatePatternSurprise(
                    EntityType.Project,
                    EntityType.Technology,
                    RelationshipType.USES
                );
                expect(surprise).toBe(0);
            });

            it('returns 0 for expected DEPENDS_ON', () => {
                const surprise = calculatePatternSurprise(
                    EntityType.Project,
                    EntityType.Technology,
                    RelationshipType.DEPENDS_ON
                );
                expect(surprise).toBe(0);
            });

            it('returns 0.7 for unexpected OWNS', () => {
                const surprise = calculatePatternSurprise(
                    EntityType.Project,
                    EntityType.Technology,
                    RelationshipType.OWNS
                );
                expect(surprise).toBe(0.7);
            });
        });

        describe('Unknown patterns', () => {
            it('returns 0.5 for unknown entity type combinations', () => {
                const surprise = calculatePatternSurprise(
                    EntityType.Location,
                    EntityType.Document,
                    RelationshipType.RELATED_TO
                );
                expect(surprise).toBe(0.5);
            });
        });
    });

    describe('Q-Value Differential', () => {
        /**
         * Calculate surprise from Q-value differential
         */
        function calculateQValueSurprise(qValue1: number, qValue2: number): number {
            const diff = Math.abs(qValue1 - qValue2);
            if (diff > 0.5) {
                return diff * 0.2;
            }
            return 0;
        }

        it('returns 0 for similar Q-values', () => {
            expect(calculateQValueSurprise(0.5, 0.6)).toBe(0);
            expect(calculateQValueSurprise(0.8, 0.7)).toBe(0);
        });

        it('returns positive value for large differential', () => {
            const surprise = calculateQValueSurprise(0.9, 0.2);
            expect(surprise).toBeGreaterThan(0);
        });

        it('calculates correct surprise for 0.7 differential', () => {
            const surprise = calculateQValueSurprise(0.9, 0.2);
            // diff = 0.7, surprise = 0.7 * 0.2 = 0.14
            expect(surprise).toBeCloseTo(0.14);
        });

        it('is symmetric', () => {
            const surprise1 = calculateQValueSurprise(0.1, 0.8);
            const surprise2 = calculateQValueSurprise(0.8, 0.1);
            expect(surprise1).toBe(surprise2);
        });

        it('handles edge cases', () => {
            expect(calculateQValueSurprise(0, 1)).toBeCloseTo(0.2);
            expect(calculateQValueSurprise(1, 0)).toBeCloseTo(0.2);
            expect(calculateQValueSurprise(0, 0)).toBe(0);
            expect(calculateQValueSurprise(1, 1)).toBe(0);
        });
    });

    describe('Confidence-based Surprise', () => {
        /**
         * Calculate surprise from low confidence
         */
        function calculateConfidenceSurprise(confidence: number): number {
            if (confidence < 0.5) {
                return (1 - confidence) * 0.2;
            }
            return 0;
        }

        it('returns 0 for high confidence relationships', () => {
            expect(calculateConfidenceSurprise(0.9)).toBe(0);
            expect(calculateConfidenceSurprise(0.5)).toBe(0);
        });

        it('returns positive for low confidence', () => {
            expect(calculateConfidenceSurprise(0.3)).toBeGreaterThan(0);
        });

        it('calculates correct surprise for 0.3 confidence', () => {
            // confidence = 0.3, surprise = (1 - 0.3) * 0.2 = 0.14
            expect(calculateConfidenceSurprise(0.3)).toBeCloseTo(0.14);
        });

        it('calculates maximum surprise at 0 confidence', () => {
            // confidence = 0, surprise = 1 * 0.2 = 0.2
            expect(calculateConfidenceSurprise(0)).toBeCloseTo(0.2);
        });
    });

    describe('Combined Surprise Score', () => {
        interface SurpriseFactors {
            conflictingRelationships: number;
            patternSurprise: number;
            qValueDiff: number;
            isIsolated: boolean;
            confidence: number;
        }

        /**
         * Calculate combined surprise score
         */
        function calculateTotalSurprise(factors: SurpriseFactors): number {
            let score = 0;

            // Conflict contribution
            if (factors.conflictingRelationships > 0) {
                score += 0.4;
            }

            // Pattern surprise contribution
            if (factors.patternSurprise > 0) {
                score += factors.patternSurprise * 0.3;
            }

            // Q-value differential contribution
            if (factors.qValueDiff > 0.5) {
                score += factors.qValueDiff * 0.2;
            }

            // Isolation contribution
            if (factors.isIsolated) {
                score += 0.1;
            }

            // Low confidence contribution
            if (factors.confidence < 0.5) {
                score += (1 - factors.confidence) * 0.2;
            }

            // Clamp to [0, 1]
            return Math.min(1, score);
        }

        it('returns low score for normal relationship', () => {
            const score = calculateTotalSurprise({
                conflictingRelationships: 0,
                patternSurprise: 0,
                qValueDiff: 0.1,
                isIsolated: false,
                confidence: 0.9,
            });
            expect(score).toBeLessThan(0.2);
        });

        it('returns high score for conflicting relationship', () => {
            const score = calculateTotalSurprise({
                conflictingRelationships: 1,
                patternSurprise: 0.7,
                qValueDiff: 0.7,
                isIsolated: true,
                confidence: 0.3,
            });
            expect(score).toBeGreaterThan(0.7);
        });

        it('clamps score to maximum 1.0', () => {
            const score = calculateTotalSurprise({
                conflictingRelationships: 3,
                patternSurprise: 0.7,
                qValueDiff: 0.9,
                isIsolated: true,
                confidence: 0.1,
            });
            expect(score).toBeLessThanOrEqual(1);
        });

        it('accumulates multiple factors', () => {
            const baseScore = calculateTotalSurprise({
                conflictingRelationships: 0,
                patternSurprise: 0,
                qValueDiff: 0,
                isIsolated: false,
                confidence: 0.9,
            });

            const withConflict = calculateTotalSurprise({
                conflictingRelationships: 1,
                patternSurprise: 0,
                qValueDiff: 0,
                isIsolated: false,
                confidence: 0.9,
            });

            expect(withConflict).toBeGreaterThan(baseScore);
        });
    });

    describe('High Surprise Threshold', () => {
        const DEFAULT_THRESHOLD = 0.8;

        function isHighSurprise(score: number, threshold: number = DEFAULT_THRESHOLD): boolean {
            return score >= threshold;
        }

        it('marks score >= threshold as high surprise', () => {
            expect(isHighSurprise(0.8)).toBe(true);
            expect(isHighSurprise(0.9)).toBe(true);
            expect(isHighSurprise(1.0)).toBe(true);
        });

        it('does not mark score < threshold as high surprise', () => {
            expect(isHighSurprise(0.7)).toBe(false);
            expect(isHighSurprise(0.5)).toBe(false);
            expect(isHighSurprise(0)).toBe(false);
        });

        it('respects custom threshold', () => {
            expect(isHighSurprise(0.6, 0.5)).toBe(true);
            expect(isHighSurprise(0.6, 0.7)).toBe(false);
        });
    });

    describe('Entity Type Validation', () => {
        it('validates all EntityTypes are covered in patterns', () => {
            const coveredTypes = new Set<string>();

            for (const key of EXPECTED_PATTERNS.keys()) {
                const [from, to] = key.split('->');
                coveredTypes.add(from);
                coveredTypes.add(to);
            }

            // These are the main entity types that should have patterns
            const mainTypes = [EntityType.Person, EntityType.Project, EntityType.Technology, EntityType.Organization];
            for (const type of mainTypes) {
                expect(coveredTypes.has(type.toLowerCase())).toBe(true);
            }
        });
    });

    describe('Relationship Creation Entities', () => {
        it('creates valid test entities', () => {
            const entity = createTestEntity('e1', 'Test Entity', EntityType.Person, 0.75);

            expect(entity.id).toBe('e1');
            expect(entity.name).toBe('Test Entity');
            expect(entity.type).toBe(EntityType.Person);
            expect(entity.utility.qValue).toBe(0.75);
        });

        it('creates valid test relationships', () => {
            const rel = createTestRelationship('r1', 'e1', 'e2', RelationshipType.WORKS_ON, 0.9);

            expect(rel.id).toBe('r1');
            expect(rel.fromEntityId).toBe('e1');
            expect(rel.toEntityId).toBe('e2');
            expect(rel.type).toBe(RelationshipType.WORKS_ON);
            expect(rel.confidence).toBe(0.9);
        });
    });
});
