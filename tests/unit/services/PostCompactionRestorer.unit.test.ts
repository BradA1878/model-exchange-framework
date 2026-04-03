/**
 * Unit tests for PostCompactionRestorer.
 * Validates artifact registration, priority ordering, token budget
 * enforcement, null-content skipping, error handling, and message format.
 */

import {
    PostCompactionRestorer,
    RestorationArtifact,
} from '../../../src/sdk/services/PostCompactionRestorer';
import { ConversationMessage } from '../../../src/shared/interfaces/ConversationMessage';

/** Helper to create a restoration artifact with sensible defaults */
function makeArtifact(
    name: string,
    priority: number,
    content: string | null = `Content for ${name}`,
): RestorationArtifact {
    return {
        name,
        priority,
        getContent: jest.fn().mockResolvedValue(content),
    };
}

/** Helper to create an artifact whose getContent throws */
function makeFailingArtifact(name: string, priority: number): RestorationArtifact {
    return {
        name,
        priority,
        getContent: jest.fn().mockRejectedValue(new Error(`Failed to get ${name}`)),
    };
}

describe('PostCompactionRestorer', () => {
    let restorer: PostCompactionRestorer;

    beforeEach(() => {
        restorer = PostCompactionRestorer.getInstance();
        restorer.clear();
    });

    // -- singleton --
    it('returns the same instance from getInstance()', () => {
        const a = PostCompactionRestorer.getInstance();
        const b = PostCompactionRestorer.getInstance();
        expect(a).toBe(b);
    });

    // -- registerArtifact / listArtifacts --
    describe('registerArtifact', () => {
        it('adds an artifact that appears in listArtifacts', () => {
            const artifact = makeArtifact('task_state', 8);
            restorer.registerArtifact(artifact);
            expect(restorer.listArtifacts()).toContain('task_state');
        });

        it('overwrites an artifact with the same name', () => {
            restorer.registerArtifact(makeArtifact('task_state', 5));
            restorer.registerArtifact(makeArtifact('task_state', 9));
            expect(restorer.listArtifacts()).toEqual(['task_state']);
        });
    });

    // -- unregisterArtifact --
    describe('unregisterArtifact', () => {
        it('removes a registered artifact and returns true', () => {
            restorer.registerArtifact(makeArtifact('task_state', 5));
            expect(restorer.unregisterArtifact('task_state')).toBe(true);
            expect(restorer.listArtifacts()).not.toContain('task_state');
        });

        it('returns false for a non-existent artifact', () => {
            expect(restorer.unregisterArtifact('does_not_exist')).toBe(false);
        });
    });

    // -- clear --
    describe('clear', () => {
        it('removes all registered artifacts', () => {
            restorer.registerArtifact(makeArtifact('a', 1));
            restorer.registerArtifact(makeArtifact('b', 2));
            restorer.registerArtifact(makeArtifact('c', 3));
            restorer.clear();
            expect(restorer.listArtifacts()).toEqual([]);
        });
    });

    // -- restore --
    describe('restore', () => {
        const agentId = 'agent-1';
        const channelId = 'channel-1';

        it('returns empty result when no artifacts are registered', async () => {
            const result = await restorer.restore(agentId, channelId);
            expect(result.messages).toEqual([]);
            expect(result.artifactNames).toEqual([]);
            expect(result.tokensAdded).toBe(0);
        });

        it('includes only artifacts whose getContent returns non-null', async () => {
            restorer.registerArtifact(makeArtifact('present', 5, 'I have content'));
            restorer.registerArtifact(makeArtifact('absent', 5, null));

            const result = await restorer.restore(agentId, channelId);
            expect(result.artifactNames).toEqual(['present']);
            expect(result.messages).toHaveLength(1);
        });

        it('skips artifacts whose getContent returns null', async () => {
            restorer.registerArtifact(makeArtifact('null_content', 10, null));

            const result = await restorer.restore(agentId, channelId);
            expect(result.messages).toHaveLength(0);
            expect(result.artifactNames).toEqual([]);
            expect(result.tokensAdded).toBe(0);
        });

        it('orders restored artifacts by priority (highest first)', async () => {
            restorer.registerArtifact(makeArtifact('low', 1, 'Low priority'));
            restorer.registerArtifact(makeArtifact('high', 10, 'High priority'));
            restorer.registerArtifact(makeArtifact('mid', 5, 'Mid priority'));

            const result = await restorer.restore(agentId, channelId);
            expect(result.artifactNames).toEqual(['high', 'mid', 'low']);
        });

        it('enforces token budget by stopping when budget is exhausted', async () => {
            // Each artifact content generates some tokens. Use a very small budget
            // that only fits the first artifact.
            restorer.registerArtifact(makeArtifact('first', 10, 'Short'));
            restorer.registerArtifact(makeArtifact('second', 5, 'A'.repeat(2000)));

            // Use a small token budget — "Short" is ~2 tokens, so budget of 10 should fit it
            // but "A".repeat(2000) is ~500 tokens, which should exceed the remaining budget.
            const result = await restorer.restore(agentId, channelId, 10);
            expect(result.artifactNames).toContain('first');
            expect(result.artifactNames).not.toContain('second');
        });

        it('handles failed getContent gracefully without throwing', async () => {
            restorer.registerArtifact(makeFailingArtifact('broken', 10));
            restorer.registerArtifact(makeArtifact('working', 5, 'I work fine'));

            const result = await restorer.restore(agentId, channelId);
            // The broken artifact is skipped; the working one is still restored
            expect(result.artifactNames).toEqual(['working']);
            expect(result.messages).toHaveLength(1);
        });

        it('does not throw even when all artifacts fail', async () => {
            restorer.registerArtifact(makeFailingArtifact('broken1', 10));
            restorer.registerArtifact(makeFailingArtifact('broken2', 5));

            const result = await restorer.restore(agentId, channelId);
            expect(result.messages).toEqual([]);
            expect(result.artifactNames).toEqual([]);
        });
    });

    // -- message format --
    describe('restored message format', () => {
        const agentId = 'agent-1';
        const channelId = 'channel-1';

        it('uses system role', async () => {
            restorer.registerArtifact(makeArtifact('task_state', 5, 'Active task: do stuff'));
            const result = await restorer.restore(agentId, channelId);
            expect(result.messages[0].role).toBe('system');
        });

        it('wraps content in system-reminder tags', async () => {
            restorer.registerArtifact(makeArtifact('task_state', 5, 'Active task: do stuff'));
            const result = await restorer.restore(agentId, channelId);
            const content = result.messages[0].content;
            expect(content).toContain('<system-reminder>');
            expect(content).toContain('</system-reminder>');
            expect(content).toContain('task_state');
            expect(content).toContain('Active task: do stuff');
        });

        it('sets ephemeral metadata', async () => {
            restorer.registerArtifact(makeArtifact('orpar_phase', 7, 'Phase: Observation'));
            const result = await restorer.restore(agentId, channelId);
            const meta = result.messages[0].metadata;
            expect(meta).toBeDefined();
            expect(meta!.ephemeral).toBe(true);
            expect(meta!.contextLayer).toBe('system');
            expect(meta!.restorationArtifact).toBe('orpar_phase');
        });

        it('generates a message id containing the artifact name', async () => {
            restorer.registerArtifact(makeArtifact('tool_summary', 3, 'Tools available'));
            const result = await restorer.restore(agentId, channelId);
            expect(result.messages[0].id).toContain('restoration-tool_summary-');
        });
    });

    // -- multiple artifacts with different priorities --
    describe('multiple artifacts with different priorities', () => {
        it('restores all in priority order and tracks tokens', async () => {
            restorer.registerArtifact(makeArtifact('low', 1, 'Low'));
            restorer.registerArtifact(makeArtifact('critical', 10, 'Critical'));
            restorer.registerArtifact(makeArtifact('medium', 5, 'Medium'));
            restorer.registerArtifact(makeArtifact('high', 8, 'High'));

            const result = await restorer.restore('agent-1', 'channel-1');
            expect(result.artifactNames).toEqual(['critical', 'high', 'medium', 'low']);
            expect(result.messages).toHaveLength(4);
            expect(result.tokensAdded).toBeGreaterThan(0);
        });
    });
});
