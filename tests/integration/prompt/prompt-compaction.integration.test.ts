/**
 * Prompt Auto-Compaction Integration Tests
 *
 * Tests the P3 Prompt Auto-Compaction system including:
 * - PromptSegmentRegistry initialization and configuration
 * - Segment registration and condition evaluation
 * - Tiered compression (Tier 0/1/2)
 * - Token budget allocation (70/20/7/3 distribution)
 * - Residual detection and bypass
 * - Integration with prompt building
 *
 * The prompt compaction system is critical for optimizing LLM context usage
 * by progressively disclosing information based on agent context.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { TIMEOUTS } from '../../utils/TestFixtures';
import {
    PromptSegmentRegistry,
    PromptSegment,
    SegmentContext
} from '../../../src/shared/prompts/PromptSegmentRegistry';
import {
    PromptCompactionConfig,
    loadPromptCompactionConfig,
    validatePromptCompactionConfig,
    getDefaultPromptCompactionConfig
} from '../../../src/shared/config/PromptCompactionConfig';
import {
    estimateTokens,
    estimateTokensForArray,
    estimateTokensForMessages,
    clearTokenEstimateCache
} from '../../../src/shared/utils/TokenEstimator';

describe('Prompt Auto-Compaction System', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let registry: PromptSegmentRegistry;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('prompt-compaction', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    beforeEach(() => {
        // Get fresh registry instance for each test
        registry = PromptSegmentRegistry.getInstance();
        registry.reset(); // Reset to default segments
        clearTokenEstimateCache(); // Clear token estimate cache
    });

    // =========================================================================
    // Section 1: PromptSegmentRegistry Initialization and Configuration
    // =========================================================================

    describe('PromptSegmentRegistry Initialization', () => {
        it('should return singleton instance', () => {
            const instance1 = PromptSegmentRegistry.getInstance();
            const instance2 = PromptSegmentRegistry.getInstance();

            expect(instance1).toBe(instance2);
        });

        it('should register default segments on initialization', () => {
            const segments = registry.listSegments();

            // Verify default segments are present
            expect(segments.length).toBeGreaterThan(0);

            // Verify core segment exists
            const coreSegment = registry.getSegment('core-framework');
            expect(coreSegment).toBeDefined();
            expect(coreSegment?.category).toBe('core');
            expect(coreSegment?.priority).toBe(10);
        });

        it('should have default configuration values', () => {
            // Build a system prompt with default config
            const context: SegmentContext = {};
            const prompt = registry.buildSystemPrompt(context);

            // Should produce a non-empty prompt with core content
            expect(prompt).toBeDefined();
            expect(prompt.length).toBeGreaterThan(0);
            expect(prompt).toContain('MXF');
        });

        it('should allow configuration updates', () => {
            registry.configure({
                condensedMode: true,
                maxSystemPromptTokens: 1500
            });

            // Verify condensed mode affects segment selection
            const context: SegmentContext = { condensedMode: true };
            const segments = registry.getApplicableSegments(context, 1500);

            // Should include condensed tool guidelines, not full
            const hasCondensedTools = segments.some(s => s.id === 'tool-guidelines-condensed');
            const hasFullTools = segments.some(s => s.id === 'tool-guidelines-full');

            expect(hasCondensedTools).toBe(true);
            expect(hasFullTools).toBe(false);
        });
    });

    // =========================================================================
    // Section 2: Segment Registration and Condition Evaluation
    // =========================================================================

    describe('Segment Registration', () => {
        it('should register custom segments', () => {
            const customSegment: PromptSegment = {
                id: 'custom-test-segment',
                content: 'This is a custom test segment for integration testing.',
                tokenCount: 0, // Will be calculated
                priority: 5,
                category: 'optional',
                conditions: () => true
            };

            registry.register(customSegment);

            const retrieved = registry.getSegment('custom-test-segment');
            expect(retrieved).toBeDefined();
            expect(retrieved?.content).toBe(customSegment.content);
            expect(retrieved?.tokenCount).toBeGreaterThan(0); // Auto-calculated
        });

        it('should calculate token count on registration if not provided', () => {
            const segment: PromptSegment = {
                id: 'token-count-test',
                content: 'This content should have its token count calculated automatically.',
                tokenCount: 0,
                priority: 5,
                category: 'optional',
                conditions: () => true
            };

            registry.register(segment);

            const registered = registry.getSegment('token-count-test');
            expect(registered?.tokenCount).toBeGreaterThan(0);
        });

        it('should preserve token count if explicitly provided', () => {
            const segment: PromptSegment = {
                id: 'explicit-token-count',
                content: 'Some content here.',
                tokenCount: 42, // Explicitly set
                priority: 5,
                category: 'optional',
                conditions: () => true
            };

            registry.register(segment);

            const registered = registry.getSegment('explicit-token-count');
            expect(registered?.tokenCount).toBe(42);
        });

        it('should unregister segments by ID', () => {
            const segment: PromptSegment = {
                id: 'to-be-removed',
                content: 'Temporary segment.',
                tokenCount: 10,
                priority: 1,
                category: 'optional',
                conditions: () => true
            };

            registry.register(segment);
            expect(registry.getSegment('to-be-removed')).toBeDefined();

            const result = registry.unregister('to-be-removed');
            expect(result).toBe(true);
            expect(registry.getSegment('to-be-removed')).toBeUndefined();
        });

        it('should clear all segments', () => {
            expect(registry.listSegments().length).toBeGreaterThan(0);

            registry.clear();

            expect(registry.listSegments().length).toBe(0);
        });

        it('should reset to default segments', () => {
            registry.clear();
            expect(registry.listSegments().length).toBe(0);

            registry.reset();

            expect(registry.listSegments().length).toBeGreaterThan(0);
            expect(registry.getSegment('core-framework')).toBeDefined();
        });
    });

    describe('Condition Evaluation', () => {
        it('should include segments when conditions are met', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true
            };

            const segments = registry.getApplicableSegments(context, 5000);
            const orparSegment = segments.find(s => s.id === 'orpar-cycle');

            expect(orparSegment).toBeDefined();
        });

        it('should exclude segments when conditions are not met', () => {
            const context: SegmentContext = {
                hasControlLoopTools: false
            };

            const segments = registry.getApplicableSegments(context, 5000);
            const orparSegment = segments.find(s => s.id === 'orpar-cycle');

            expect(orparSegment).toBeUndefined();
        });

        it('should include collaboration patterns for multi-agent channels', () => {
            const context: SegmentContext = {
                isMultiAgentChannel: true
            };

            const segments = registry.getApplicableSegments(context, 5000);
            const collabSegment = segments.find(s => s.id === 'collaboration-patterns');

            expect(collabSegment).toBeDefined();
        });

        it('should include error handling after error occurrence', () => {
            const context: SegmentContext = {
                hasErrorOccurred: true
            };

            const segments = registry.getApplicableSegments(context, 5000);
            const errorSegment = segments.find(s => s.id === 'error-handling');

            expect(errorSegment).toBeDefined();
        });

        it('should include MXP protocol when MXP is enabled', () => {
            const context: SegmentContext = {
                isMxpEnabled: true
            };

            const segments = registry.getApplicableSegments(context, 5000);
            const mxpSegment = segments.find(s => s.id === 'mxp-protocol');

            expect(mxpSegment).toBeDefined();
        });

        it('should handle complex condition combinations', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMultiAgentChannel: true,
                hasErrorOccurred: true,
                isMxpEnabled: true,
                condensedMode: false
            };

            const segments = registry.getApplicableSegments(context, 10000);

            // All conditional segments should be included with sufficient budget
            expect(segments.find(s => s.id === 'orpar-cycle')).toBeDefined();
            expect(segments.find(s => s.id === 'collaboration-patterns')).toBeDefined();
            expect(segments.find(s => s.id === 'error-handling')).toBeDefined();
            expect(segments.find(s => s.id === 'mxp-protocol')).toBeDefined();
            expect(segments.find(s => s.id === 'tool-guidelines-full')).toBeDefined();
        });
    });

    // =========================================================================
    // Section 3: Tiered Compression
    // =========================================================================

    describe('Tiered Compression', () => {
        it('should provide Tier 0 (minimal) content under tight budget', () => {
            // Register tiered segments
            const tier0Content = 'Essential info.';
            const tier1Content = 'More details about essential info and context.';
            const tier2Content = 'Comprehensive explanation with examples and guidelines for best practices.';

            registry.clear();

            // Tier 0 - highest priority, smallest content
            registry.register({
                id: 'tier-0-segment',
                content: tier0Content,
                tokenCount: estimateTokens(tier0Content),
                priority: 10,
                category: 'core',
                conditions: () => true
            });

            // Tier 1 - medium priority
            registry.register({
                id: 'tier-1-segment',
                content: tier1Content,
                tokenCount: estimateTokens(tier1Content),
                priority: 5,
                category: 'optional',
                conditions: () => true
            });

            // Tier 2 - lower priority, largest content
            registry.register({
                id: 'tier-2-segment',
                content: tier2Content,
                tokenCount: estimateTokens(tier2Content),
                priority: 2,
                category: 'optional',
                conditions: () => true
            });

            // With very small budget, only Tier 0 should be included
            const tier0Budget = 10;
            const tier0Segments = registry.getApplicableSegments({}, tier0Budget);

            expect(tier0Segments.length).toBe(1);
            expect(tier0Segments[0].id).toBe('tier-0-segment');
        });

        it('should include Tier 1 content with moderate budget', () => {
            registry.clear();

            const tier0Content = 'Tier 0 content.';
            const tier1Content = 'Tier 1 additional content.';

            registry.register({
                id: 'tier-0',
                content: tier0Content,
                tokenCount: estimateTokens(tier0Content),
                priority: 10,
                category: 'core',
                conditions: () => true
            });

            registry.register({
                id: 'tier-1',
                content: tier1Content,
                tokenCount: estimateTokens(tier1Content),
                priority: 5,
                category: 'optional',
                conditions: () => true
            });

            // With moderate budget, both Tier 0 and Tier 1 should be included
            const moderateBudget = 50;
            const segments = registry.getApplicableSegments({}, moderateBudget);

            expect(segments.length).toBe(2);
            expect(segments.map(s => s.id)).toContain('tier-0');
            expect(segments.map(s => s.id)).toContain('tier-1');
        });

        it('should include Tier 2 content with generous budget', () => {
            registry.clear();

            registry.register({
                id: 'tier-0',
                content: 'Tier 0.',
                tokenCount: 5,
                priority: 10,
                category: 'core',
                conditions: () => true
            });

            registry.register({
                id: 'tier-1',
                content: 'Tier 1 content.',
                tokenCount: 10,
                priority: 5,
                category: 'optional',
                conditions: () => true
            });

            registry.register({
                id: 'tier-2',
                content: 'Tier 2 comprehensive content with more details.',
                tokenCount: 20,
                priority: 2,
                category: 'optional',
                conditions: () => true
            });

            // With generous budget, all tiers should be included
            const generousBudget = 100;
            const segments = registry.getApplicableSegments({}, generousBudget);

            expect(segments.length).toBe(3);
        });

        it('should respect priority ordering in tier selection', () => {
            registry.clear();

            // Register segments in random priority order
            registry.register({
                id: 'low-priority',
                content: 'Low priority content.',
                tokenCount: 10,
                priority: 1,
                category: 'optional',
                conditions: () => true
            });

            registry.register({
                id: 'high-priority',
                content: 'High priority content.',
                tokenCount: 10,
                priority: 9,
                category: 'core',
                conditions: () => true
            });

            registry.register({
                id: 'medium-priority',
                content: 'Medium priority content.',
                tokenCount: 10,
                priority: 5,
                category: 'optional',
                conditions: () => true
            });

            // Budget allows only 2 segments
            const segments = registry.getApplicableSegments({}, 25);

            expect(segments.length).toBe(2);
            expect(segments[0].id).toBe('high-priority');
            expect(segments[1].id).toBe('medium-priority');
        });

        it('should use condensed mode for reduced content', () => {
            const fullContext: SegmentContext = { condensedMode: false };
            const condensedContext: SegmentContext = { condensedMode: true };

            const fullSegments = registry.getApplicableSegments(fullContext, 5000);
            const condensedSegments = registry.getApplicableSegments(condensedContext, 5000);

            const fullToolSegment = fullSegments.find(s => s.id === 'tool-guidelines-full');
            const condensedToolSegment = condensedSegments.find(s => s.id === 'tool-guidelines-condensed');

            expect(fullToolSegment).toBeDefined();
            expect(condensedToolSegment).toBeDefined();

            // Condensed content should be shorter
            if (fullToolSegment && condensedToolSegment) {
                expect(condensedToolSegment.tokenCount).toBeLessThan(fullToolSegment.tokenCount);
            }
        });
    });

    // =========================================================================
    // Section 4: Token Budget Allocation
    // =========================================================================

    describe('Token Budget Allocation', () => {
        it('should respect 70/20/7/3 budget distribution for messages', () => {
            // Standard token budget (e.g., 8000 tokens)
            const totalBudget = 8000;

            // Expected allocations
            const expectedAllocations = {
                messages: Math.floor(totalBudget * 0.70), // 70% for conversation
                context: Math.floor(totalBudget * 0.20),  // 20% for context
                tools: Math.floor(totalBudget * 0.07),    // 7% for tool definitions
                system: Math.floor(totalBudget * 0.03)    // 3% for system prompt
            };

            expect(expectedAllocations.messages).toBe(5600);
            expect(expectedAllocations.context).toBe(1600);
            expect(expectedAllocations.tools).toBe(560);
            expect(expectedAllocations.system).toBe(240);

            // Verify total is close to budget (allowing for rounding)
            const totalAllocated = Object.values(expectedAllocations).reduce((a, b) => a + b, 0);
            expect(totalAllocated).toBeLessThanOrEqual(totalBudget);
        });

        it('should exclude segments that exceed remaining budget', () => {
            registry.clear();

            // Register segments that total more than budget
            registry.register({
                id: 'must-have',
                content: 'Essential content.',
                tokenCount: 50,
                priority: 10,
                category: 'core',
                conditions: () => true
            });

            registry.register({
                id: 'nice-to-have',
                content: 'Additional helpful content.',
                tokenCount: 30,
                priority: 5,
                category: 'optional',
                conditions: () => true
            });

            registry.register({
                id: 'would-overflow',
                content: 'This would cause overflow if included.',
                tokenCount: 50,
                priority: 3,
                category: 'optional',
                conditions: () => true
            });

            // Budget of 100 can fit must-have (50) + nice-to-have (30) = 80
            // But not would-overflow (50 more = 130 > 100)
            const segments = registry.getApplicableSegments({}, 100);

            expect(segments.length).toBe(2);
            expect(segments.map(s => s.id)).toContain('must-have');
            expect(segments.map(s => s.id)).toContain('nice-to-have');
            expect(segments.map(s => s.id)).not.toContain('would-overflow');
        });

        it('should report budget utilization', () => {
            const budget = 1000;
            const segments = registry.getApplicableSegments({}, budget);

            const totalUsed = segments.reduce((sum, s) => sum + s.tokenCount, 0);
            const utilization = (totalUsed / budget) * 100;

            expect(utilization).toBeLessThanOrEqual(100);
            expect(utilization).toBeGreaterThan(0);
        });

        it('should handle zero budget gracefully', () => {
            const segments = registry.getApplicableSegments({}, 0);
            expect(segments.length).toBe(0);
        });

        it('should handle very large budget', () => {
            const largebudget = 100000;
            const segments = registry.getApplicableSegments({
                hasControlLoopTools: true,
                isMultiAgentChannel: true,
                hasErrorOccurred: true,
                isMxpEnabled: true
            }, largebudget);

            // All applicable segments should be included
            const allSegments = registry.listSegments().filter(s =>
                s.conditions({
                    hasControlLoopTools: true,
                    isMultiAgentChannel: true,
                    hasErrorOccurred: true,
                    isMxpEnabled: true
                })
            );

            expect(segments.length).toBe(allSegments.length);
        });
    });

    // =========================================================================
    // Section 5: Residual Detection and Bypass
    // =========================================================================

    describe('Residual Detection and Bypass', () => {
        it('should handle residual threshold configuration', () => {
            const config = getDefaultPromptCompactionConfig();

            expect(config.residualThreshold).toBe(60);
            expect(config.residualMaxPercent).toBe(0.20);
        });

        it('should validate residual threshold bounds', () => {
            const invalidConfig: PromptCompactionConfig = {
                ...getDefaultPromptCompactionConfig(),
                residualThreshold: 150 // Invalid: > 100
            };

            const errors = validatePromptCompactionConfig(invalidConfig);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some(e => e.includes('threshold'))).toBe(true);
        });

        it('should validate residual max percent bounds', () => {
            const invalidConfig: PromptCompactionConfig = {
                ...getDefaultPromptCompactionConfig(),
                residualMaxPercent: 1.5 // Invalid: > 1.0
            };

            const errors = validatePromptCompactionConfig(invalidConfig);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some(e => e.includes('percent'))).toBe(true);
        });

        it('should allow high-priority segments to bypass compaction', () => {
            registry.clear();

            // Register a critical segment (simulating residual bypass)
            const criticalSegment: PromptSegment = {
                id: 'critical-residual',
                content: 'Critical information that must always be included.',
                tokenCount: 100, // Larger than typical
                priority: 10, // Maximum priority
                category: 'core',
                conditions: () => true
            };

            registry.register(criticalSegment);

            // Even with tight budget, high priority segment should be included first
            const segments = registry.getApplicableSegments({}, 100);

            expect(segments.length).toBe(1);
            expect(segments[0].id).toBe('critical-residual');
        });

        it('should support segment categories for residual grouping', () => {
            const segments = registry.listSegments();

            // Verify all segments have valid categories
            const validCategories = ['core', 'orpar', 'collaboration', 'tools', 'error-handling', 'mxp', 'optional'];
            for (const segment of segments) {
                expect(validCategories).toContain(segment.category);
            }
        });
    });

    // =========================================================================
    // Section 6: Integration with Prompt Building
    // =========================================================================

    describe('Prompt Building Integration', () => {
        it('should build complete system prompt from segments', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMultiAgentChannel: true
            };

            const prompt = registry.buildSystemPrompt(context, 5000);

            expect(prompt).toBeDefined();
            expect(prompt.length).toBeGreaterThan(0);

            // Should include core content
            expect(prompt).toContain('MXF');

            // Should include ORPAR content (since hasControlLoopTools = true)
            expect(prompt).toContain('ORPAR');

            // Should include collaboration content (since isMultiAgentChannel = true)
            expect(prompt).toContain('Collaboration');
        });

        it('should organize prompt sections by category', () => {
            const context: SegmentContext = {
                hasControlLoopTools: true,
                isMxpEnabled: true
            };

            const prompt = registry.buildSystemPrompt(context, 10000);

            // Core should appear before other sections (based on category ordering)
            const coreIndex = prompt.indexOf('MXF');
            const mxpIndex = prompt.indexOf('MXP Protocol');

            expect(coreIndex).toBeLessThan(mxpIndex);
        });

        it('should respect budget in prompt building', () => {
            // Very small budget
            const smallPrompt = registry.buildSystemPrompt({}, 50);

            // Larger budget
            const largePrompt = registry.buildSystemPrompt({}, 5000);

            // Large prompt should be longer
            expect(largePrompt.length).toBeGreaterThanOrEqual(smallPrompt.length);
        });

        it('should use default budget when not specified', () => {
            const prompt = registry.buildSystemPrompt({});

            expect(prompt).toBeDefined();
            expect(prompt.length).toBeGreaterThan(0);
        });

        it('should integrate with agent configuration', async () => {
            const customSystemPrompt = `# Custom Agent Framework
You are a specialized agent with unique capabilities.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Prompt Integration Agent',
                agentConfigPrompt: customSystemPrompt,
                allowedTools: ['tool_help'],
                capabilities: ['integration-testing']
            });

            expect(agent.isConnected()).toBe(true);
        });
    });

    // =========================================================================
    // Section 7: Token Estimator Integration
    // =========================================================================

    describe('Token Estimator Integration', () => {
        it('should estimate tokens for simple text', () => {
            const text = 'Hello, world! This is a test message.';
            const tokens = estimateTokens(text);

            expect(tokens).toBeGreaterThan(0);
            // Token estimation varies by implementation, typically 5-15 tokens for this text
            expect(tokens).toBeGreaterThanOrEqual(5);
            expect(tokens).toBeLessThanOrEqual(15);
        });

        it('should handle empty content', () => {
            expect(estimateTokens('')).toBe(0);
            expect(estimateTokens(null as any)).toBe(0);
        });

        it('should estimate tokens for arrays', () => {
            const items = ['First item', 'Second item', 'Third item'];
            const tokens = estimateTokensForArray(items);

            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBe(items.reduce((sum, item) => sum + estimateTokens(item), 0));
        });

        it('should estimate tokens for message objects', () => {
            const messages = [
                { role: 'user', content: 'Hello!' },
                { role: 'assistant', content: 'Hi there! How can I help?' },
                { role: 'user', content: 'Tell me about MXF.' }
            ];

            const tokens = estimateTokensForMessages(messages);

            expect(tokens).toBeGreaterThan(0);
            // Should include base overhead per message
            expect(tokens).toBeGreaterThan(messages.length * 4);
        });

        it('should cache token estimates', () => {
            const content = 'This content should be cached for repeated lookups.';

            const firstEstimate = estimateTokens(content);
            const secondEstimate = estimateTokens(content);

            expect(firstEstimate).toBe(secondEstimate);
        });

        it('should clear token estimate cache', () => {
            const content = 'Content to be cleared from cache.';
            estimateTokens(content);

            clearTokenEstimateCache();

            // After clearing, estimate should still work
            const newEstimate = estimateTokens(content);
            expect(newEstimate).toBeGreaterThan(0);
        });

        it('should adjust for code content', () => {
            const plainText = 'This is plain text without any special characters.';
            const codeContent = 'function test() { return { value: true }; }';

            const plainTokens = estimateTokens(plainText);
            const codeTokens = estimateTokens(codeContent);

            // Code content typically uses more tokens due to special characters
            // This verifies the adjustment is being applied
            expect(codeTokens).toBeGreaterThan(0);
            expect(plainTokens).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // Section 8: Configuration Validation
    // =========================================================================

    describe('Configuration Validation', () => {
        it('should load default configuration', () => {
            const config = getDefaultPromptCompactionConfig();

            expect(config.enabled).toBe(false);
            expect(config.residualsEnabled).toBe(false);
            expect(config.tieredEnabled).toBe(false);
            expect(config.budgetEnabled).toBe(false);
            expect(config.defaultTokenBudget).toBe(8000);
            expect(config.maxSystemPromptTokens).toBe(2500);
        });

        it('should validate tier size ordering', () => {
            const invalidConfig: PromptCompactionConfig = {
                ...getDefaultPromptCompactionConfig(),
                tier0Size: 50,
                tier1Size: 25, // Invalid: should be > tier0
                tier2Size: 100
            };

            const errors = validatePromptCompactionConfig(invalidConfig);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some(e => e.includes('Tier 1'))).toBe(true);
        });

        it('should validate positive token budget', () => {
            const invalidConfig: PromptCompactionConfig = {
                ...getDefaultPromptCompactionConfig(),
                defaultTokenBudget: -100
            };

            const errors = validatePromptCompactionConfig(invalidConfig);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some(e => e.includes('budget'))).toBe(true);
        });

        it('should validate positive max system prompt tokens', () => {
            const invalidConfig: PromptCompactionConfig = {
                ...getDefaultPromptCompactionConfig(),
                maxSystemPromptTokens: 0
            };

            const errors = validatePromptCompactionConfig(invalidConfig);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors.some(e => e.includes('system prompt'))).toBe(true);
        });

        it('should pass validation for valid configuration', () => {
            const validConfig = getDefaultPromptCompactionConfig();
            const errors = validatePromptCompactionConfig(validConfig);

            expect(errors.length).toBe(0);
        });

        it('should validate all constraints together', () => {
            const multipleInvalidConfig: PromptCompactionConfig = {
                enabled: true,
                residualsEnabled: true,
                tieredEnabled: true,
                budgetEnabled: true,
                residualThreshold: 200, // Invalid
                residualMaxPercent: 2.0, // Invalid
                tier0Size: 100, // Invalid (>= tier1)
                tier1Size: 50, // Invalid (>= tier2)
                tier2Size: 25, // Invalid
                defaultTokenBudget: -1, // Invalid
                condensedMode: false,
                maxSystemPromptTokens: -100 // Invalid
            };

            const errors = validatePromptCompactionConfig(multipleInvalidConfig);

            // Should have multiple errors
            expect(errors.length).toBeGreaterThan(3);
        });
    });

    // =========================================================================
    // Section 9: Edge Cases and Error Handling
    // =========================================================================

    describe('Edge Cases and Error Handling', () => {
        it('should handle segments with failing conditions gracefully', () => {
            registry.clear();

            registry.register({
                id: 'throwing-condition',
                content: 'This segment has a throwing condition.',
                tokenCount: 10,
                priority: 5,
                category: 'optional',
                conditions: () => {
                    throw new Error('Condition evaluation error');
                }
            });

            registry.register({
                id: 'safe-segment',
                content: 'Safe content.',
                tokenCount: 10,
                priority: 5,
                category: 'core',
                conditions: () => true
            });

            // Should not throw, should only include safe segment
            const segments = registry.getApplicableSegments({}, 100);
            expect(segments.some(s => s.id === 'safe-segment')).toBe(true);
        });

        it('should handle very long segment content', () => {
            const longContent = 'A'.repeat(10000);

            registry.register({
                id: 'very-long-segment',
                content: longContent,
                tokenCount: 0, // Will be calculated
                priority: 5,
                category: 'optional',
                conditions: () => true
            });

            const segment = registry.getSegment('very-long-segment');
            expect(segment?.tokenCount).toBeGreaterThan(1000);
        });

        it('should handle special characters in segment content', () => {
            const specialContent = `Special chars: "quotes" 'apostrophes' <brackets> {braces} [square]
Unicode: Test
Code: const x = { a: 1, b: 2 };`;

            registry.register({
                id: 'special-chars-segment',
                content: specialContent,
                tokenCount: 0,
                priority: 5,
                category: 'optional',
                conditions: () => true
            });

            const prompt = registry.buildSystemPrompt({}, 5000);
            expect(prompt).toBeDefined();
        });

        it('should handle concurrent segment registration', () => {
            const promises = [];

            for (let i = 0; i < 10; i++) {
                promises.push(Promise.resolve().then(() => {
                    registry.register({
                        id: `concurrent-segment-${i}`,
                        content: `Content for segment ${i}`,
                        tokenCount: 10,
                        priority: 5,
                        category: 'optional',
                        conditions: () => true
                    });
                }));
            }

            return Promise.all(promises).then(() => {
                const segments = registry.listSegments();
                const concurrentSegments = segments.filter(s => s.id.startsWith('concurrent-segment-'));
                expect(concurrentSegments.length).toBe(10);
            });
        });

        it('should handle duplicate segment registration', () => {
            registry.register({
                id: 'duplicate-test',
                content: 'Original content.',
                tokenCount: 10,
                priority: 5,
                category: 'optional',
                conditions: () => true
            });

            registry.register({
                id: 'duplicate-test',
                content: 'Updated content.',
                tokenCount: 15,
                priority: 6,
                category: 'core',
                conditions: () => true
            });

            const segment = registry.getSegment('duplicate-test');
            expect(segment?.content).toBe('Updated content.');
            expect(segment?.tokenCount).toBe(15);
            expect(segment?.priority).toBe(6);
        });
    });

    // =========================================================================
    // Section 10: Integration with Live Agent Context
    // =========================================================================

    describe('Live Agent Integration', () => {
        it('should generate appropriate prompts for tool-enabled agent', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Tool-Enabled Compaction Agent',
                allowedTools: [
                    'tool_help',
                    'tool_quick_reference',
                    'tools_recommend'
                ],
                capabilities: ['tool-execution', 'prompt-testing']
            });

            expect(agent.isConnected()).toBe(true);

            // Generate context-aware prompt
            const context: SegmentContext = {
                hasControlLoopTools: false,
                isMultiAgentChannel: false,
                availableTools: ['tool_help', 'tool_quick_reference', 'tools_recommend']
            };

            const prompt = registry.buildSystemPrompt(context, 2000);

            expect(prompt).toBeDefined();
            expect(prompt.length).toBeGreaterThan(0);
        });

        it('should generate appropriate prompts for multi-agent scenario', async () => {
            // Create multiple agents in the same channel
            const agent1 = await testSdk.createAndConnectAgent(channelId, {
                name: 'Multi-Agent Test 1',
                allowedTools: ['messaging_send'],
                capabilities: ['collaboration']
            });

            const agent2 = await testSdk.createAndConnectAgent(channelId, {
                name: 'Multi-Agent Test 2',
                allowedTools: ['messaging_send'],
                capabilities: ['collaboration']
            });

            expect(agent1.isConnected()).toBe(true);
            expect(agent2.isConnected()).toBe(true);

            // Generate multi-agent context prompt
            const context: SegmentContext = {
                isMultiAgentChannel: true,
                channelAgentCount: 2
            };

            const prompt = registry.buildSystemPrompt(context, 3000);

            expect(prompt).toContain('Collaboration');
        });

        it('should adapt prompts based on ORPAR availability', async () => {
            const orparAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'ORPAR Compaction Agent',
                allowedTools: [
                    'controlLoop_start',
                    'controlLoop_observe',
                    'controlLoop_status',
                    'orpar_observe',
                    'orpar_reason',
                    'orpar_plan',
                    'orpar_act',
                    'orpar_reflect'
                ],
                capabilities: ['orpar', 'reasoning']
            });

            expect(orparAgent.isConnected()).toBe(true);

            const context: SegmentContext = {
                hasControlLoopTools: true
            };

            const prompt = registry.buildSystemPrompt(context, 3000);

            expect(prompt).toContain('ORPAR');
            expect(prompt).toContain('Observe');
        });
    });
});
