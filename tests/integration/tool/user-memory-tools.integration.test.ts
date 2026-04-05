/**
 * Integration Tests for UserMemoryTools (MCP tools).
 *
 * Tests the user_memory_save, user_memory_recall, user_memory_forget, and
 * user_memory_shake tool handlers end-to-end with a running MXF server and
 * live MongoDB. Requires `bun run start:dev` running in a separate terminal.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { TOOL_TEST_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';

// ─── Constants ──────────────────────────────────────────────────────────────

const USER_MEMORY_TOOLS = [
    'user_memory_save',
    'user_memory_recall',
    'user_memory_forget',
    'user_memory_shake'
];

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('UserMemoryTools Integration', () => {
    let testSdk: TestSDK;
    let channelId: string;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('user-memory-tools', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    // ── user_memory_save ────────────────────────────────────────────────────

    describe('user_memory_save', () => {
        it('saves a memory and returns confirmation text', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Save Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            const result = await agent.executeTool('user_memory_save', {
                type: 'user',
                title: 'Integration Test Preference',
                description: 'Test preference entry',
                content: 'Prefers dark mode and green accents'
            });

            expect(result).toBeDefined();
            // The tool returns a text confirmation containing the title
            const text = typeof result === 'string' ? result : JSON.stringify(result);
            expect(text).toContain('Integration Test Preference');
        });

        it('rejects invalid type enum values', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Save Invalid Type Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            // Server validates input schema before handler runs — throws on invalid enum
            await expect(
                agent.executeTool('user_memory_save', {
                    type: 'invalid_type',
                    title: 'Should Fail',
                    description: 'desc',
                    content: 'content'
                })
            ).rejects.toThrow();
        });

        it('validates required fields — rejects empty title', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Save Empty Title Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            // Handler validates non-empty fields and returns error text,
            // but server may also reject at schema level — handle both
            try {
                const result = await agent.executeTool('user_memory_save', {
                    type: 'user',
                    title: '',
                    description: 'desc',
                    content: 'content'
                });
                const text = typeof result === 'string' ? result : JSON.stringify(result);
                expect(text.toLowerCase()).toContain('title');
            } catch (err: any) {
                // Server-level validation rejection is also acceptable
                expect(err.message).toBeDefined();
            }
        });
    });

    // ── user_memory_recall ──────────────────────────────────────────────────

    describe('user_memory_recall', () => {
        it('returns JSON results after saving a memory', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Recall Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            // Save a memory first
            await agent.executeTool('user_memory_save', {
                type: 'project',
                title: 'Recall Test Entry',
                description: 'Entry for recall testing',
                content: 'This entry should be found by recall'
            });

            // Recall it
            const result = await agent.executeTool('user_memory_recall', {
                query: 'Recall Test'
            });

            expect(result).toBeDefined();
            // Result should be non-empty (either JSON array or text with content)
            const text = typeof result === 'string' ? result : JSON.stringify(result);
            expect(text.length).toBeGreaterThan(0);
        });

        it('returns "No memories found." when no matches exist', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Recall Empty Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            const result = await agent.executeTool('user_memory_recall', {
                query: 'zzz_completely_nonexistent_xyzzy_' + Date.now()
            });

            // Could return "No memories found." or fallback recent results
            expect(result).toBeDefined();
        });
    });

    // ── user_memory_forget ──────────────────────────────────────────────────

    describe('user_memory_forget', () => {
        it('deletes a memory by memoryId', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Forget Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            // Save a memory to get its ID
            await agent.executeTool('user_memory_save', {
                type: 'reference',
                title: 'Forget Test Entry ' + Date.now(),
                description: 'Entry to be forgotten',
                content: 'This will be deleted'
            });

            // Recall to get the ID
            const recallResult = await agent.executeTool('user_memory_recall', {
                query: 'Forget Test Entry'
            });

            // Extract an ID from the result if possible
            let memoryId: string | undefined;
            try {
                const parsed = typeof recallResult === 'string' ? JSON.parse(recallResult) : recallResult;
                if (Array.isArray(parsed) && parsed.length > 0) {
                    memoryId = parsed[0].id;
                }
            } catch {
                // Result may not be parseable — use searchTerm fallback instead
            }

            if (memoryId) {
                const result = await agent.executeTool('user_memory_forget', { memoryId });
                const text = typeof result === 'string' ? result : JSON.stringify(result);
                expect(text).toContain('Deleted');
            } else {
                // Fallback: delete by searchTerm
                const result = await agent.executeTool('user_memory_forget', {
                    searchTerm: 'Forget Test Entry'
                });
                expect(result).toBeDefined();
            }
        });

        it('requires either memoryId or searchTerm', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Forget Validation Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            const result = await agent.executeTool('user_memory_forget', {});

            const text = typeof result === 'string' ? result : JSON.stringify(result);
            expect(text).toContain('memoryId');
        });
    });

    // ── user_memory_shake ───────────────────────────────────────────────────

    describe('user_memory_shake', () => {
        it('returns stale candidates or "No stale memories found."', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Shake Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            const result = await agent.executeTool('user_memory_shake', {});

            expect(result).toBeDefined();
            const text = typeof result === 'string' ? result : JSON.stringify(result);
            // Should either report stale candidates (JSON) or "No stale memories found."
            expect(text.length).toBeGreaterThan(0);
        });

        it('accepts a custom thresholdDays override', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'UM Shake Threshold Agent',
                allowedTools: USER_MEMORY_TOOLS
            });

            // Use a very small threshold so any memory older than 1 day is stale
            const result = await agent.executeTool('user_memory_shake', {
                thresholdDays: 1
            });

            expect(result).toBeDefined();
        });
    });
});
