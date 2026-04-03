/**
 * Unit Tests for DeferredToolSchemaRegistry (Phase 1)
 *
 * Tests tool tier classification, partitioning, deferred summary
 * generation, and threshold-based behavior.
 */

import { DeferredToolSchemaRegistry } from '../../../src/shared/prompts/DeferredToolSchemaRegistry';

describe('DeferredToolSchemaRegistry', () => {
    let registry: DeferredToolSchemaRegistry;

    beforeEach(() => {
        registry = DeferredToolSchemaRegistry.getInstance();
        registry.reset();
    });

    describe('getInstance', () => {
        it('should return the same instance on repeated calls', () => {
            const a = DeferredToolSchemaRegistry.getInstance();
            const b = DeferredToolSchemaRegistry.getInstance();
            expect(a).toBe(b);
        });
    });

    describe('default tier-1 tools', () => {
        it('should include ORPAR control loop tools as tier-1', () => {
            const tier1 = registry.listTier1();
            expect(tier1).toContain('controlLoop_observe');
            expect(tier1).toContain('controlLoop_reason');
            expect(tier1).toContain('controlLoop_plan');
            expect(tier1).toContain('controlLoop_act');
            expect(tier1).toContain('controlLoop_reflect');
        });

        it('should include messaging and task tools as tier-1', () => {
            const tier1 = registry.listTier1();
            expect(tier1).toContain('messaging_send');
            expect(tier1).toContain('task_complete');
            expect(tier1).toContain('task_create');
        });

        it('should include meta tools as tier-1', () => {
            const tier1 = registry.listTier1();
            expect(tier1).toContain('tools_recommend');
            expect(tier1).toContain('tools_validate');
        });
    });

    describe('classify', () => {
        it('should classify explicit tier-1 tools as tier-1 regardless of total count', () => {
            expect(registry.classify('controlLoop_observe', 100)).toBe('tier1');
            expect(registry.classify('messaging_send', 50)).toBe('tier1');
        });

        it('should classify all unclassified tools as tier-1 when total <= threshold', () => {
            // Default threshold is 15
            expect(registry.classify('some_unknown_tool', 10)).toBe('tier1');
            expect(registry.classify('another_tool', 15)).toBe('tier1');
        });

        it('should classify unclassified tools as tier-2 when total > threshold', () => {
            expect(registry.classify('some_unknown_tool', 16)).toBe('tier2');
            expect(registry.classify('another_tool', 100)).toBe('tier2');
        });

        it('should respect explicit tier-2 assignment', () => {
            registry.setTier2('forced_tier2_tool');
            // Even with low total count, explicit tier-2 stays tier-2
            expect(registry.classify('forced_tier2_tool', 5)).toBe('tier2');
        });
    });

    describe('setTier1 / setTier2', () => {
        it('should move a tool from tier-2 to tier-1', () => {
            registry.setTier2('my_tool');
            expect(registry.classify('my_tool', 100)).toBe('tier2');

            registry.setTier1('my_tool');
            expect(registry.classify('my_tool', 100)).toBe('tier1');
            expect(registry.listTier1()).toContain('my_tool');
            expect(registry.listTier2()).not.toContain('my_tool');
        });

        it('should move a tool from tier-1 to tier-2', () => {
            registry.setTier1('my_tool');
            expect(registry.classify('my_tool', 100)).toBe('tier1');

            registry.setTier2('my_tool');
            expect(registry.classify('my_tool', 100)).toBe('tier2');
            expect(registry.listTier2()).toContain('my_tool');
            expect(registry.listTier1()).not.toContain('my_tool');
        });
    });

    describe('setTier2Threshold', () => {
        it('should change the threshold for tier-2 classification', () => {
            registry.setTier2Threshold(5);
            expect(registry.getTier2Threshold()).toBe(5);

            // 6 tools > threshold of 5, so unclassified tools become tier-2
            expect(registry.classify('unknown_tool', 6)).toBe('tier2');
            // 5 tools <= threshold of 5, so unclassified tools stay tier-1
            expect(registry.classify('unknown_tool', 5)).toBe('tier1');
        });
    });

    describe('partition', () => {
        it('should split tools into tier-1 and tier-2 groups', () => {
            // Create a list larger than threshold (15) with known tier-1 tools
            const tools = [
                'controlLoop_observe',
                'messaging_send',
                'task_complete',
                'tools_recommend',
                'custom_tool_a',
                'custom_tool_b',
                'custom_tool_c',
                'custom_tool_d',
                'custom_tool_e',
                'custom_tool_f',
                'custom_tool_g',
                'custom_tool_h',
                'custom_tool_i',
                'custom_tool_j',
                'custom_tool_k',
                'custom_tool_l',
            ];

            const result = registry.partition(tools);

            // Known tier-1 tools should be in tier1
            expect(result.tier1).toContain('controlLoop_observe');
            expect(result.tier1).toContain('messaging_send');

            // Custom tools should be in tier2 (total=16 > threshold=15)
            expect(result.tier2).toContain('custom_tool_a');
            expect(result.tier2).toContain('custom_tool_l');

            // All tools accounted for
            expect(result.tier1.length + result.tier2.length).toBe(tools.length);
        });

        it('should put all tools in tier-1 when total is below threshold', () => {
            const tools = ['controlLoop_observe', 'custom_tool_a', 'custom_tool_b'];
            const result = registry.partition(tools);

            expect(result.tier1.length).toBe(3);
            expect(result.tier2.length).toBe(0);
        });
    });

    describe('buildDeferredSummary', () => {
        it('should generate summary text listing tier-2 tools', () => {
            const tier2Names = ['tool_a', 'tool_b', 'tool_c'];
            const summary = registry.buildDeferredSummary(tier2Names);

            expect(summary).toContain('Additional Tools Available');
            expect(summary).toContain('3 tools');
            expect(summary).toContain('tool_a');
            expect(summary).toContain('tool_b');
            expect(summary).toContain('tool_c');
            expect(summary).toContain('tools_recommend');
        });

        it('should return empty string for empty tier-2 list', () => {
            expect(registry.buildDeferredSummary([])).toBe('');
        });
    });

    describe('clear and reset', () => {
        it('should clear all classifications', () => {
            registry.clear();
            expect(registry.listTier1().length).toBe(0);
            expect(registry.listTier2().length).toBe(0);
        });

        it('should restore defaults on reset', () => {
            registry.clear();
            expect(registry.listTier1().length).toBe(0);

            registry.reset();
            expect(registry.listTier1().length).toBeGreaterThan(0);
            expect(registry.listTier1()).toContain('controlLoop_observe');
        });
    });
});
