/**
 * Unit Tests for PromptSegmentRegistry (Phase 4)
 */

import { PromptSegmentRegistry, PromptSegment, SegmentContext } from '../../../src/shared/prompts/PromptSegmentRegistry';

describe('PromptSegmentRegistry (Phase 4)', () => {
    let registry: PromptSegmentRegistry;

    beforeEach(() => {
        registry = PromptSegmentRegistry.getInstance();
        registry.reset(); // Reset to default segments
    });

    describe('register and retrieval', () => {
        it('should register custom segments', () => {
            const segment: PromptSegment = {
                id: 'custom-test',
                content: 'Custom test content',
                tokenCount: 10,
                priority: 5,
                category: 'optional',
                conditions: () => true
            };

            registry.register(segment);

            const retrieved = registry.getSegment('custom-test');
            expect(retrieved).toBeDefined();
            expect(retrieved!.id).toBe('custom-test');
        });

        it('should calculate token count if not provided', () => {
            const segment: PromptSegment = {
                id: 'auto-token',
                content: 'This content needs token counting',
                tokenCount: 0,
                priority: 5,
                category: 'optional',
                conditions: () => true
            };

            registry.register(segment);

            const retrieved = registry.getSegment('auto-token');
            expect(retrieved!.tokenCount).toBeGreaterThan(0);
        });

        it('should list all registered segments', () => {
            const segments = registry.listSegments();
            expect(segments.length).toBeGreaterThan(0); // Default segments
        });
    });

    describe('getApplicableSegments', () => {
        it('should return only segments meeting conditions', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMultiAgentChannel: false,
                hasErrorOccurred: false,
                isMxpEnabled: false,
                condensedMode: false
            };

            const segments = registry.getApplicableSegments(context, 5000);

            // Core segment should always be present
            expect(segments.some(s => s.id === 'core-framework')).toBe(true);

            // ORPAR segment should be present (control loop tools available)
            expect(segments.some(s => s.id === 'orpar-cycle')).toBe(true);

            // Collaboration segment should NOT be present (single agent)
            expect(segments.some(s => s.id === 'collaboration-patterns')).toBe(false);
        });

        it('should respect token budget', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMultiAgentChannel: true,
                hasErrorOccurred: true,
                isMxpEnabled: true,
                condensedMode: false
            };

            const smallBudget = 50; // Very small budget
            const segments = registry.getApplicableSegments(context, smallBudget);

            const totalTokens = segments.reduce((sum, s) => sum + s.tokenCount, 0);
            expect(totalTokens).toBeLessThanOrEqual(smallBudget);
        });

        it('should prioritize higher priority segments', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMultiAgentChannel: true,
                hasErrorOccurred: true,
                isMxpEnabled: true,
                condensedMode: false
            };

            const segments = registry.getApplicableSegments(context, 1000);

            // Core (priority 10) should be included
            expect(segments.some(s => s.priority === 10)).toBe(true);

            // If budget is constrained, lower priority may be excluded
            // Verify that included segments are sorted by priority
            for (let i = 0; i < segments.length - 1; i++) {
                expect(segments[i].priority).toBeGreaterThanOrEqual(segments[i + 1].priority);
            }
        });

        it('should use condensed mode segments when enabled', () => {
            const context: SegmentContext = {
                condensedMode: true
            };

            const segments = registry.getApplicableSegments(context, 5000);

            // Condensed tool guidelines should be present
            expect(segments.some(s => s.id === 'tool-guidelines-condensed')).toBe(true);

            // Full tool guidelines should NOT be present
            expect(segments.some(s => s.id === 'tool-guidelines-full')).toBe(false);
        });

        it('should exclude error handling until first error', () => {
            const contextNoError: SegmentContext = {
                hasErrorOccurred: false
            };

            const segmentsNoError = registry.getApplicableSegments(contextNoError, 5000);
            expect(segmentsNoError.some(s => s.id === 'error-handling')).toBe(false);

            const contextWithError: SegmentContext = {
                hasErrorOccurred: true
            };

            const segmentsWithError = registry.getApplicableSegments(contextWithError, 5000);
            expect(segmentsWithError.some(s => s.id === 'error-handling')).toBe(true);
        });
    });

    describe('buildSystemPrompt', () => {
        it('should build prompt from applicable segments', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMultiAgentChannel: false,
                condensedMode: false
            };

            const prompt = registry.buildSystemPrompt(context);

            expect(prompt).toBeTruthy();
            expect(prompt).toContain('MXF Agent Framework'); // Core segment
            expect(prompt).toContain('ORPAR'); // ORPAR segment
        });

        it('should respect max token budget', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMultiAgentChannel: true,
                hasErrorOccurred: true,
                isMxpEnabled: true
            };

            const maxBudget = 100;
            const prompt = registry.buildSystemPrompt(context, maxBudget);

            // Estimate tokens (rough check)
            const estimatedTokens = Math.ceil(prompt.length / 4);
            expect(estimatedTokens).toBeLessThanOrEqual(maxBudget * 1.2); // 20% tolerance
        });

        it('should organize sections by category', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMultiAgentChannel: true
            };

            const prompt = registry.buildSystemPrompt(context);

            // Core should appear before other sections
            const coreIndex = prompt.indexOf('MXF Agent Framework');
            const orparIndex = prompt.indexOf('ORPAR');

            expect(coreIndex).toBeGreaterThan(-1);
            expect(orparIndex).toBeGreaterThan(-1);
            expect(coreIndex).toBeLessThan(orparIndex);
        });
    });

    describe('configure', () => {
        it('should update configuration', () => {
            registry.configure({
                condensedMode: true,
                maxSystemPromptTokens: 1000
            });

            // Verify configuration is applied (through behavior)
            const context: SegmentContext = {};
            const prompt = registry.buildSystemPrompt(context);

            // With small budget, prompt should be shorter
            expect(prompt.length).toBeGreaterThan(0);
        });
    });

    describe('segment management', () => {
        it('should unregister segments', () => {
            const segment: PromptSegment = {
                id: 'temp-segment',
                content: 'Temporary content',
                tokenCount: 10,
                priority: 5,
                category: 'optional',
                conditions: () => true
            };

            registry.register(segment);
            expect(registry.getSegment('temp-segment')).toBeDefined();

            const removed = registry.unregister('temp-segment');
            expect(removed).toBe(true);
            expect(registry.getSegment('temp-segment')).toBeUndefined();
        });

        it('should clear all segments', () => {
            registry.clear();
            const segments = registry.listSegments();
            expect(segments.length).toBe(0);
        });

        it('should reset to default segments', () => {
            registry.clear();
            expect(registry.listSegments().length).toBe(0);

            registry.reset();
            expect(registry.listSegments().length).toBeGreaterThan(0);
        });
    });
});
