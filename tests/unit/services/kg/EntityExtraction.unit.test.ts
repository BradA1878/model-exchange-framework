/**
 * Unit tests for Entity Extraction
 * Tests the rule-based entity and relationship extraction logic
 */

import { EntityType, RelationshipType } from '@mxf/shared/types/KnowledgeGraphTypes';

/**
 * Test extraction patterns without service dependencies
 */
describe('Entity Extraction Patterns', () => {
    describe('Person extraction pattern', () => {
        const personPattern = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g;

        it('extracts simple two-word capitalized names', () => {
            const text = 'John Smith discussed the project with Jane Doe.';
            const matches = [...text.matchAll(personPattern)].map(m => m[1]);
            expect(matches).toContain('John Smith');
            expect(matches).toContain('Jane Doe');
        });

        it('does not extract single capitalized words', () => {
            const text = 'JavaScript is a great language.';
            const matches = [...text.matchAll(personPattern)].map(m => m[1]);
            expect(matches).not.toContain('JavaScript');
        });

        it('does not extract all-caps names', () => {
            const text = 'JOHN SMITH works at ACME Corp.';
            const matches = [...text.matchAll(personPattern)].map(m => m[1]);
            // Pattern won't match all-caps
            expect(matches).not.toContain('JOHN SMITH');
        });

        it('handles multiple names in a sentence', () => {
            const text = 'Alice Cooper met Bob Dylan and Charlie Brown at the cafe.';
            const matches = [...text.matchAll(personPattern)].map(m => m[1]);
            expect(matches.length).toBe(3);
        });
    });

    describe('Organization extraction pattern', () => {
        const orgPattern = /\b([A-Z][A-Za-z]+(?:\s+(?:Inc|Corp|LLC|Ltd|Company|Co))?)\b/g;

        it('extracts companies with Inc suffix', () => {
            const text = 'Apple Inc announced new products.';
            const matches = [...text.matchAll(orgPattern)]
                .map(m => m[1])
                .filter(m => /Inc|Corp|LLC|Ltd|Company|Co$/i.test(m));
            expect(matches).toContain('Apple Inc');
        });

        it('extracts companies with Corp suffix', () => {
            const text = 'Microsoft Corp reported earnings.';
            const matches = [...text.matchAll(orgPattern)]
                .map(m => m[1])
                .filter(m => /Inc|Corp|LLC|Ltd|Company|Co$/i.test(m));
            expect(matches).toContain('Microsoft Corp');
        });

        it('extracts companies with LLC suffix', () => {
            const text = 'Acme LLC was founded in 2020.';
            const matches = [...text.matchAll(orgPattern)]
                .map(m => m[1])
                .filter(m => /Inc|Corp|LLC|Ltd|Company|Co$/i.test(m));
            expect(matches).toContain('Acme LLC');
        });
    });

    describe('Technology extraction pattern', () => {
        const techTerms = [
            'JavaScript', 'TypeScript', 'Python', 'React', 'Node.js',
            'MongoDB', 'PostgreSQL', 'Docker', 'Kubernetes', 'AWS',
            'Azure', 'GCP', 'API', 'REST', 'GraphQL', 'Redis', 'Kafka',
        ];

        function extractTechTerms(text: string): string[] {
            return techTerms.filter(term =>
                text.toLowerCase().includes(term.toLowerCase())
            );
        }

        it('extracts JavaScript', () => {
            const text = 'The project uses JavaScript and TypeScript.';
            const extracted = extractTechTerms(text);
            expect(extracted).toContain('JavaScript');
            expect(extracted).toContain('TypeScript');
        });

        it('extracts case-insensitively', () => {
            const text = 'We use MONGODB for storage.';
            const extracted = extractTechTerms(text);
            expect(extracted).toContain('MongoDB');
        });

        it('extracts multiple technologies', () => {
            const text = 'Stack: React, Node.js, MongoDB, and Docker deployed on AWS.';
            const extracted = extractTechTerms(text);
            expect(extracted).toContain('React');
            expect(extracted).toContain('Node.js');
            expect(extracted).toContain('MongoDB');
            expect(extracted).toContain('Docker');
            expect(extracted).toContain('AWS');
        });

        it('handles Node.js with dots', () => {
            const text = 'Built with Node.js for the backend.';
            const extracted = extractTechTerms(text);
            expect(extracted).toContain('Node.js');
        });
    });

    describe('Project extraction pattern', () => {
        const projectPattern = /\b([A-Z][a-zA-Z]+)\s+(?:project|system|application|app|platform)\b/gi;

        it('extracts project names', () => {
            const text = 'The Atlas project is coming along well.';
            const matches = [...text.matchAll(projectPattern)].map(m => m[1]);
            expect(matches).toContain('Atlas');
        });

        it('extracts system names', () => {
            const text = 'The Phoenix system handles authentication.';
            const matches = [...text.matchAll(projectPattern)].map(m => m[1]);
            expect(matches).toContain('Phoenix');
        });

        it('extracts application names', () => {
            const text = 'Users log into the Portal application.';
            const matches = [...text.matchAll(projectPattern)].map(m => m[1]);
            expect(matches).toContain('Portal');
        });

        it('is case insensitive for suffixes', () => {
            const text = 'The Apollo PROJECT and Gemini System are both active.';
            const matches = [...text.matchAll(projectPattern)].map(m => m[1]);
            expect(matches).toContain('Apollo');
            expect(matches).toContain('Gemini');
        });
    });

    describe('Relationship extraction patterns', () => {
        const relationshipPatterns = [
            { pattern: /(\w+)\s+uses\s+(\w+)/gi, type: 'USES' },
            { pattern: /(\w+)\s+works\s+on\s+(\w+)/gi, type: 'WORKS_ON' },
            { pattern: /(\w+)\s+depends\s+on\s+(\w+)/gi, type: 'DEPENDS_ON' },
            { pattern: /(\w+)\s+requires\s+(\w+)/gi, type: 'REQUIRES' },
            { pattern: /(\w+)\s+created\s+(\w+)/gi, type: 'CREATED' },
            { pattern: /(\w+)\s+owns\s+(\w+)/gi, type: 'OWNS' },
        ];

        function extractRelationships(text: string): Array<{ from: string; to: string; type: string }> {
            const relationships: Array<{ from: string; to: string; type: string }> = [];

            for (const { pattern, type } of relationshipPatterns) {
                let match;
                const regex = new RegExp(pattern);
                while ((match = regex.exec(text)) !== null) {
                    relationships.push({
                        from: match[1],
                        to: match[2],
                        type,
                    });
                }
            }

            return relationships;
        }

        it('extracts "uses" relationships', () => {
            const text = 'React uses JavaScript for rendering.';
            const rels = extractRelationships(text);
            const usesRel = rels.find(r => r.type === 'USES');
            expect(usesRel).toBeDefined();
            expect(usesRel?.from).toBe('React');
            expect(usesRel?.to).toBe('JavaScript');
        });

        it('extracts "works on" relationships', () => {
            const text = 'John works on Atlas for the team.';
            const rels = extractRelationships(text);
            const worksOnRel = rels.find(r => r.type === 'WORKS_ON');
            expect(worksOnRel).toBeDefined();
            expect(worksOnRel?.from).toBe('John');
            expect(worksOnRel?.to).toBe('Atlas');
        });

        it('extracts "depends on" relationships', () => {
            const text = 'Frontend depends on API for data.';
            const rels = extractRelationships(text);
            const dependsOnRel = rels.find(r => r.type === 'DEPENDS_ON');
            expect(dependsOnRel).toBeDefined();
            expect(dependsOnRel?.from).toBe('Frontend');
            expect(dependsOnRel?.to).toBe('API');
        });

        it('extracts multiple relationships', () => {
            const text = 'Alice created Portal and Bob uses it daily.';
            const rels = extractRelationships(text);
            expect(rels.length).toBe(2);
        });
    });

    describe('Entity deduplication', () => {
        interface ExtractedEntity {
            name: string;
            type: EntityType;
        }

        function deduplicateEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
            const seen = new Set<string>();
            return entities.filter(e => {
                const key = e.name.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        it('removes duplicate entity names (case-insensitive)', () => {
            const entities: ExtractedEntity[] = [
                { name: 'React', type: EntityType.Technology },
                { name: 'REACT', type: EntityType.Technology },
                { name: 'react', type: EntityType.Technology },
            ];
            const deduped = deduplicateEntities(entities);
            expect(deduped.length).toBe(1);
        });

        it('preserves first occurrence', () => {
            const entities: ExtractedEntity[] = [
                { name: 'JavaScript', type: EntityType.Technology },
                { name: 'javascript', type: EntityType.Concept },
            ];
            const deduped = deduplicateEntities(entities);
            expect(deduped.length).toBe(1);
            expect(deduped[0].type).toBe(EntityType.Technology);
        });

        it('keeps entities with different names', () => {
            const entities: ExtractedEntity[] = [
                { name: 'React', type: EntityType.Technology },
                { name: 'Vue', type: EntityType.Technology },
                { name: 'Angular', type: EntityType.Technology },
            ];
            const deduped = deduplicateEntities(entities);
            expect(deduped.length).toBe(3);
        });
    });

    describe('Confidence scoring', () => {
        interface ExtractedEntity {
            name: string;
            type: EntityType;
            confidence: number;
        }

        function filterByConfidence(
            entities: ExtractedEntity[],
            minConfidence: number
        ): ExtractedEntity[] {
            return entities.filter(e => e.confidence >= minConfidence);
        }

        it('filters out low confidence entities', () => {
            const entities: ExtractedEntity[] = [
                { name: 'React', type: EntityType.Technology, confidence: 0.9 },
                { name: 'Maybe', type: EntityType.Concept, confidence: 0.3 },
                { name: 'MongoDB', type: EntityType.Technology, confidence: 0.85 },
            ];
            const filtered = filterByConfidence(entities, 0.6);
            expect(filtered.length).toBe(2);
            expect(filtered.map(e => e.name)).not.toContain('Maybe');
        });

        it('keeps all entities when threshold is 0', () => {
            const entities: ExtractedEntity[] = [
                { name: 'Test1', type: EntityType.Concept, confidence: 0.1 },
                { name: 'Test2', type: EntityType.Concept, confidence: 0.9 },
            ];
            const filtered = filterByConfidence(entities, 0);
            expect(filtered.length).toBe(2);
        });

        it('filters all when threshold is very high', () => {
            const entities: ExtractedEntity[] = [
                { name: 'Test1', type: EntityType.Concept, confidence: 0.5 },
                { name: 'Test2', type: EntityType.Concept, confidence: 0.7 },
            ];
            const filtered = filterByConfidence(entities, 0.99);
            expect(filtered.length).toBe(0);
        });
    });

    describe('Proximity-based relationship inference', () => {
        function entitiesWithinProximity(
            text: string,
            e1: string,
            e2: string,
            maxDistance: number
        ): boolean {
            const textLower = text.toLowerCase();
            const pos1 = textLower.indexOf(e1.toLowerCase());
            const pos2 = textLower.indexOf(e2.toLowerCase());

            if (pos1 === -1 || pos2 === -1) return false;
            return Math.abs(pos1 - pos2) <= maxDistance;
        }

        it('detects entities in close proximity', () => {
            const text = 'John from Acme Corp is leading the project.';
            expect(entitiesWithinProximity(text, 'John', 'Acme Corp', 20)).toBe(true);
        });

        it('does not detect entities far apart', () => {
            const text = 'John is the lead. Many other things happened. Eventually Acme Corp was founded.';
            expect(entitiesWithinProximity(text, 'John', 'Acme Corp', 20)).toBe(false);
        });

        it('handles same position gracefully', () => {
            const text = 'React is great.';
            expect(entitiesWithinProximity(text, 'React', 'React', 0)).toBe(true);
        });

        it('handles missing entities', () => {
            const text = 'Just some text.';
            expect(entitiesWithinProximity(text, 'John', 'Acme', 100)).toBe(false);
        });
    });
});
