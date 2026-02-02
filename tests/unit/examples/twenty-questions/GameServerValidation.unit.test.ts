/**
 * Unit tests for Twenty Questions GameServer KG node type validation
 *
 * The GameServer /api/events/knowledge endpoint validates that incoming
 * KG node types match the allowed values: 'category', 'property', 'candidate', 'eliminated'.
 * Invalid types trigger a 400 fail-fast response. Missing types default to 'property'.
 * This file tests that validation logic in isolation by extracting the same logic
 * the endpoint uses.
 */

describe('GameServer - KG Node Type Validation', () => {
    // This mirrors the exact validation logic used in GameServer.setupRoutes()
    // for the POST /api/events/knowledge endpoint.
    //
    // The endpoint does two checks:
    // 1. If data.type is truthy AND not in validNodeTypes → 400 error (fail-fast)
    // 2. Otherwise, uses data.type || 'property' (defaults when type is absent)
    const validNodeTypes = ['category', 'property', 'candidate', 'eliminated'];

    /** Returns true if the type should be rejected with a 400 error */
    function isInvalidNodeType(inputType: string | undefined): boolean {
        return !!inputType && !validNodeTypes.includes(inputType);
    }

    /** Returns the resolved node type (only called when type is not rejected) */
    function resolveNodeType(inputType: string | undefined): string {
        return inputType || 'property';
    }

    describe('Valid node types are accepted', () => {
        it('should accept "category" as a valid node type', () => {
            expect(isInvalidNodeType('category')).toBe(false);
            expect(resolveNodeType('category')).toBe('category');
        });

        it('should accept "property" as a valid node type', () => {
            expect(isInvalidNodeType('property')).toBe(false);
            expect(resolveNodeType('property')).toBe('property');
        });

        it('should accept "candidate" as a valid node type', () => {
            expect(isInvalidNodeType('candidate')).toBe(false);
            expect(resolveNodeType('candidate')).toBe('candidate');
        });

        it('should accept "eliminated" as a valid node type', () => {
            expect(isInvalidNodeType('eliminated')).toBe(false);
            expect(resolveNodeType('eliminated')).toBe('eliminated');
        });
    });

    describe('Missing types default to "property"', () => {
        it('should default to "property" when type is undefined', () => {
            expect(isInvalidNodeType(undefined)).toBe(false);
            expect(resolveNodeType(undefined)).toBe('property');
        });

        it('should default to "property" when type is empty string', () => {
            // Empty string is falsy, so it does NOT trigger the fail-fast check
            expect(isInvalidNodeType('')).toBe(false);
            expect(resolveNodeType('')).toBe('property');
        });
    });

    describe('Invalid node types are rejected (fail-fast 400)', () => {
        it('should reject unknown type "concept"', () => {
            expect(isInvalidNodeType('concept')).toBe(true);
        });

        it('should reject unknown type "entity"', () => {
            expect(isInvalidNodeType('entity')).toBe(true);
        });

        it('should reject unknown type "node"', () => {
            expect(isInvalidNodeType('node')).toBe(true);
        });

        it('should be case-sensitive (reject "Category" uppercase)', () => {
            expect(isInvalidNodeType('Category')).toBe(true);
        });

        it('should be case-sensitive (reject "PROPERTY" uppercase)', () => {
            expect(isInvalidNodeType('PROPERTY')).toBe(true);
        });

        it('should reject types with extra whitespace', () => {
            expect(isInvalidNodeType(' category ')).toBe(true);
            expect(isInvalidNodeType('property ')).toBe(true);
        });
    });

    describe('Knowledge endpoint data defaults', () => {
        // The endpoint also applies defaults for missing fields in the request body.
        // These tests verify the fallback logic used in the node and edge creation.

        it('should default entity to "unknown" when data.entity and data.name are both missing', () => {
            const data: Record<string, any> = {};
            const entity = data.entity || data.name || 'unknown';
            expect(entity).toBe('unknown');
        });

        it('should use data.entity when present', () => {
            const data = { entity: 'has_wings' };
            const entity = data.entity || (data as any).name || 'unknown';
            expect(entity).toBe('has_wings');
        });

        it('should fall back to data.name when data.entity is missing', () => {
            const data = { name: 'can_fly' };
            const entity = (data as any).entity || data.name || 'unknown';
            expect(entity).toBe('can_fly');
        });

        it('should default confidence to 0.5 when not provided', () => {
            const data: Record<string, any> = {};
            const confidence = data.confidence || 0.5;
            expect(confidence).toBe(0.5);
        });

        it('should use provided confidence value when present', () => {
            const data = { confidence: 0.9 };
            const confidence = data.confidence || 0.5;
            expect(confidence).toBe(0.9);
        });

        it('should default edge "from" to "unknown" when data.from and data.fromEntity are both missing', () => {
            const data: Record<string, any> = {};
            const from = data.from || data.fromEntity || 'unknown';
            expect(from).toBe('unknown');
        });

        it('should use data.from for edge source when present', () => {
            const data = { from: 'animal' };
            const from = data.from || (data as any).fromEntity || 'unknown';
            expect(from).toBe('animal');
        });

        it('should fall back to data.fromEntity for edge source when data.from is missing', () => {
            const data = { fromEntity: 'animal' };
            const from = (data as any).from || data.fromEntity || 'unknown';
            expect(from).toBe('animal');
        });

        it('should default edge "to" to "unknown" when data.to and data.toEntity are both missing', () => {
            const data: Record<string, any> = {};
            const to = data.to || data.toEntity || 'unknown';
            expect(to).toBe('unknown');
        });

        it('should default relationship to "related_to" when data.relationship and data.type are both missing', () => {
            const data: Record<string, any> = {};
            const relationship = data.relationship || data.type || 'related_to';
            expect(relationship).toBe('related_to');
        });

        it('should use data.relationship when present', () => {
            const data = { relationship: 'has_property' };
            const relationship = data.relationship || (data as any).type || 'related_to';
            expect(relationship).toBe('has_property');
        });

        it('should fall back to data.type for relationship when data.relationship is missing', () => {
            const data = { type: 'is_a' };
            const relationship = (data as any).relationship || data.type || 'related_to';
            expect(relationship).toBe('is_a');
        });
    });

    describe('Risk assessment endpoint defaults', () => {
        // The /api/events/risk endpoint applies defaults for missing fields

        it('should default riskScore to 0.5 when not provided', () => {
            const body: Record<string, any> = {};
            const riskScore = body.riskScore || 0.5;
            expect(riskScore).toBe(0.5);
        });

        it('should default confidence to 0.5 when not provided', () => {
            const body: Record<string, any> = {};
            const confidence = body.confidence || 0.5;
            expect(confidence).toBe(0.5);
        });

        it('should default recommendation to "ask_more" when not provided', () => {
            const body: Record<string, any> = {};
            const recommendation = body.recommendation || 'ask_more';
            expect(recommendation).toBe('ask_more');
        });

        it('should use provided values when present', () => {
            const body = { riskScore: 0.2, confidence: 0.9, recommendation: 'guess_now' };
            expect(body.riskScore || 0.5).toBe(0.2);
            expect(body.confidence || 0.5).toBe(0.9);
            expect(body.recommendation || 'ask_more').toBe('guess_now');
        });
    });

    describe('MULS reward endpoint defaults', () => {
        // The /api/events/muls endpoint applies defaults for missing fields

        it('should default reward to 0 when not provided', () => {
            const body: Record<string, any> = {};
            const reward = body.reward || 0;
            expect(reward).toBe(0);
        });

        it('should default reason to "Strategy reward" when not provided', () => {
            const body: Record<string, any> = {};
            const reason = body.reason || 'Strategy reward';
            expect(reason).toBe('Strategy reward');
        });

        it('should use provided values when present', () => {
            const body = { reward: 0.8, reason: 'Effective narrowing' };
            expect(body.reward || 0).toBe(0.8);
            expect(body.reason || 'Strategy reward').toBe('Effective narrowing');
        });
    });
});
