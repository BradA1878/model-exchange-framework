/**
 * Unit Tests for DynamicContextProvider (Phase 1)
 *
 * Tests the DynamicContextRegistry singleton: provider registration,
 * priority ordering, token budget enforcement, and error resilience.
 */

import {
    DynamicContextRegistry,
    DynamicContextProviderEntry,
    DynamicContextInput,
} from '../../../src/shared/prompts/DynamicContextProvider';

/** Helper to create a minimal DynamicContextInput */
function makeInput(overrides: Partial<DynamicContextInput> = {}): DynamicContextInput {
    return {
        agentId: 'agent-1',
        channelId: 'channel-1',
        ...overrides,
    };
}

/** Helper to create a simple provider */
function makeProvider(
    id: string,
    priority: number,
    content: string,
    shouldActivate = true,
): DynamicContextProviderEntry {
    return {
        id,
        name: `Provider ${id}`,
        priority,
        shouldActivate: () => shouldActivate,
        getContent: async () => content,
    };
}

describe('DynamicContextRegistry', () => {
    let registry: DynamicContextRegistry;

    beforeEach(() => {
        registry = DynamicContextRegistry.getInstance();
        registry.clear();
    });

    describe('getInstance', () => {
        it('should return the same instance on repeated calls', () => {
            const a = DynamicContextRegistry.getInstance();
            const b = DynamicContextRegistry.getInstance();
            expect(a).toBe(b);
        });
    });

    describe('register and listProviders', () => {
        it('should register a provider and list it', () => {
            registry.register(makeProvider('p1', 5, 'Content 1'));
            expect(registry.listProviders()).toEqual(['p1']);
        });

        it('should register multiple providers', () => {
            registry.register(makeProvider('p1', 5, 'Content 1'));
            registry.register(makeProvider('p2', 3, 'Content 2'));
            registry.register(makeProvider('p3', 8, 'Content 3'));

            const ids = registry.listProviders();
            expect(ids).toContain('p1');
            expect(ids).toContain('p2');
            expect(ids).toContain('p3');
            expect(ids.length).toBe(3);
        });

        it('should override provider with same ID', () => {
            registry.register(makeProvider('p1', 5, 'Original'));
            registry.register(makeProvider('p1', 10, 'Replacement'));

            expect(registry.listProviders().length).toBe(1);
            const provider = registry.getProvider('p1');
            expect(provider!.priority).toBe(10);
        });
    });

    describe('unregister', () => {
        it('should remove a registered provider', () => {
            registry.register(makeProvider('p1', 5, 'Content'));
            expect(registry.unregister('p1')).toBe(true);
            expect(registry.listProviders().length).toBe(0);
        });

        it('should return false for non-existent provider', () => {
            expect(registry.unregister('nonexistent')).toBe(false);
        });
    });

    describe('gatherContext', () => {
        it('should return empty string when no providers are registered', async () => {
            const result = await registry.gatherContext(makeInput());
            expect(result).toBe('');
        });

        it('should only include activated providers', async () => {
            registry.register(makeProvider('active', 5, 'Active content', true));
            registry.register(makeProvider('inactive', 5, 'Inactive content', false));

            const result = await registry.gatherContext(makeInput());
            expect(result).toContain('Active content');
            expect(result).not.toContain('Inactive content');
        });

        it('should order output by priority (highest first)', async () => {
            registry.register(makeProvider('low', 1, 'Low priority'));
            registry.register(makeProvider('high', 10, 'High priority'));
            registry.register(makeProvider('mid', 5, 'Mid priority'));

            const result = await registry.gatherContext(makeInput());
            const highIndex = result.indexOf('High priority');
            const midIndex = result.indexOf('Mid priority');
            const lowIndex = result.indexOf('Low priority');

            expect(highIndex).toBeLessThan(midIndex);
            expect(midIndex).toBeLessThan(lowIndex);
        });

        it('should enforce token budget', async () => {
            // Each content is ~40 chars = ~10 tokens
            registry.register(makeProvider('p1', 10, 'A'.repeat(40)));
            registry.register(makeProvider('p2', 5, 'B'.repeat(40)));
            registry.register(makeProvider('p3', 1, 'C'.repeat(40)));

            // Budget of 15 tokens should include p1 (10 tokens) but not all three
            const result = await registry.gatherContext(makeInput(), 15);
            expect(result).toContain('A'.repeat(40));
            // p2 would push to ~20 tokens, exceeding 15
            expect(result).not.toContain('C'.repeat(40));
        });

        it('should skip failed providers gracefully', async () => {
            registry.register(makeProvider('good', 5, 'Good content'));
            registry.register({
                id: 'broken',
                name: 'Broken Provider',
                priority: 10,
                shouldActivate: () => true,
                getContent: async () => { throw new Error('Provider failure'); },
            });

            // Should not throw and should still include the good provider
            const result = await registry.gatherContext(makeInput());
            expect(result).toContain('Good content');
        });

        it('should skip providers that return empty content', async () => {
            registry.register(makeProvider('empty', 10, ''));
            registry.register(makeProvider('nonempty', 5, 'Has content'));

            const result = await registry.gatherContext(makeInput());
            expect(result).toBe('Has content');
        });

        it('should pass input to shouldActivate', async () => {
            const activateFn = jest.fn().mockReturnValue(true);
            registry.register({
                id: 'checker',
                name: 'Checker',
                priority: 5,
                shouldActivate: activateFn,
                getContent: async () => 'Content',
            });

            const input = makeInput({ orparPhase: 'observe', hasRecentErrors: true });
            await registry.gatherContext(input);

            expect(activateFn).toHaveBeenCalledWith(input);
        });

        it('should join multiple sections with double newlines', async () => {
            registry.register(makeProvider('a', 10, 'Section A'));
            registry.register(makeProvider('b', 5, 'Section B'));

            const result = await registry.gatherContext(makeInput());
            expect(result).toBe('Section A\n\nSection B');
        });
    });

    describe('clear', () => {
        it('should remove all providers', () => {
            registry.register(makeProvider('p1', 5, 'Content'));
            registry.register(makeProvider('p2', 3, 'Content'));
            registry.clear();
            expect(registry.listProviders().length).toBe(0);
        });
    });

    describe('getProvider', () => {
        it('should return provider by ID', () => {
            registry.register(makeProvider('p1', 7, 'Content'));
            const provider = registry.getProvider('p1');
            expect(provider).toBeDefined();
            expect(provider!.id).toBe('p1');
            expect(provider!.priority).toBe(7);
        });

        it('should return undefined for non-existent provider', () => {
            expect(registry.getProvider('nonexistent')).toBeUndefined();
        });
    });
});
