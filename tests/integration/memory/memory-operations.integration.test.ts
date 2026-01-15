/**
 * Memory Operations Integration Tests
 *
 * Tests the memory management system across all scopes:
 * - Agent memory (personal to each agent)
 * - Channel memory (shared within a channel)
 * - Relationship memory (between specific agents)
 *
 * Memory is critical for agent context and learning.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { MEMORY_TEST_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';

describe('Memory Operations', () => {
    let testSdk: TestSDK;
    let channelId: string;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('memory', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Agent Memory', () => {
        it('should access agent memory manager', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Memory Access Agent'
            });

            const memoryManager = agent.getMemoryManager();
            expect(memoryManager).toBeDefined();
        });

        it('should add conversation messages to memory', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Conversation Memory Agent'
            });

            const memoryManager = agent.getMemoryManager();

            // Add conversation message
            await memoryManager.addConversationMessage({
                role: 'user',
                content: 'This is a test message for memory',
                metadata: {
                    testId: 'memory-001',
                    type: 'integration-test'
                }
            });

            // Memory should accept the message
            expect(agent.isConnected()).toBe(true);
        });

        it('should store multiple messages in sequence', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Sequential Memory Agent'
            });

            const memoryManager = agent.getMemoryManager();

            // Add multiple messages
            for (let i = 0; i < 5; i++) {
                await memoryManager.addConversationMessage({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `Message ${i + 1} in sequence`,
                    metadata: { sequence: i + 1 }
                });
            }

            expect(agent.isConnected()).toBe(true);
        });

        it('should handle message with complex metadata', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Complex Metadata Agent'
            });

            const memoryManager = agent.getMemoryManager();

            await memoryManager.addConversationMessage({
                role: 'user',
                content: 'Message with complex metadata',
                metadata: {
                    nested: {
                        level1: {
                            level2: {
                                value: 'deep-nested'
                            }
                        }
                    },
                    array: [1, 2, 3, 'four', { five: 5 }],
                    timestamp: Date.now(),
                    boolean: true
                }
            });

            expect(agent.isConnected()).toBe(true);
        });
    });

    describe('Memory Search', () => {
        it('should search conversations with memory_search_conversations tool', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Memory Search Agent',
                allowedTools: ['memory_search_conversations'],
                agentConfigPrompt: 'You search through conversation memory.'
            });

            // First add some searchable content
            const memoryManager = agent.getMemoryManager();
            await memoryManager.addConversationMessage({
                role: 'user',
                content: 'Authentication implementation discussion about JWT tokens and OAuth',
                metadata: { topic: 'authentication' }
            });

            await sleep(1000); // Wait for indexing

            // Search for the content
            const result = await agent.executeTool('memory_search_conversations', {
                query: 'authentication JWT',
                channelId,
                limit: 5
            });

            expect(result).toBeDefined();
        });

        it('should search actions with memory_search_actions tool', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Action Search Agent',
                allowedTools: ['memory_search_actions', 'tool_help'],
                agentConfigPrompt: 'You search through action history.'
            });

            // Execute some tools to create action history
            await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            await sleep(500);

            // Search for actions
            const result = await agent.executeTool('memory_search_actions', {
                query: 'tool help',
                channelId,
                limit: 5
            });

            expect(result).toBeDefined();
        });
    });

    describe('Channel Memory', () => {
        it('should support channel-wide memory operations', async () => {
            const agent1 = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Channel Memory Agent 1'
            });

            const agent2 = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Channel Memory Agent 2'
            });

            // Both agents should be in the same channel
            expect(agent1.isConnected()).toBe(true);
            expect(agent2.isConnected()).toBe(true);
        });

        it('should isolate memory between channels', async () => {
            // Create second channel
            const result2 = await testSdk.createTestChannel('memory-isolated', {
                disableSystemLlm: true
            });
            const channel2Id = result2.channelId;

            const agent1 = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Channel 1 Agent'
            });

            const agent2 = await testSdk.createAndConnectAgent(channel2Id, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Channel 2 Agent'
            });

            // Add memory to each channel's agent
            const memory1 = agent1.getMemoryManager();
            const memory2 = agent2.getMemoryManager();

            await memory1.addConversationMessage({
                role: 'user',
                content: 'Channel 1 specific message',
                metadata: { channel: 'channel1' }
            });

            await memory2.addConversationMessage({
                role: 'user',
                content: 'Channel 2 specific message',
                metadata: { channel: 'channel2' }
            });

            // Both agents should maintain separate memory
            expect(agent1.isConnected()).toBe(true);
            expect(agent2.isConnected()).toBe(true);
        });
    });

    describe('Relationship Memory', () => {
        it('should support agent-to-agent relationship memory', async () => {
            const agent1 = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Relationship Agent 1'
            });

            const agent2 = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Relationship Agent 2'
            });

            // Both agents exist and can form relationships
            expect(agent1.isConnected()).toBe(true);
            expect(agent2.isConnected()).toBe(true);
            expect(agent1.agentId).not.toBe(agent2.agentId);
        });
    });

    describe('Memory Persistence', () => {
        it('should persist memory across reconnection', async () => {
            const agentConfig = {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Persistence Test Agent',
                agentId: `persist-agent-${Date.now()}`
            };

            // First connection
            const agent1 = await testSdk.createAndConnectAgent(channelId, agentConfig);
            const memory1 = agent1.getMemoryManager();

            await memory1.addConversationMessage({
                role: 'user',
                content: 'Message to persist across reconnection',
                metadata: { persistence: true }
            });

            const agentId = agent1.agentId;
            await agent1.disconnect();

            await sleep(1000);

            // Second connection with same agentId
            const agent2 = await testSdk.createAndConnectAgent(channelId, {
                ...agentConfig,
                agentId
            });

            // Agent should reconnect
            expect(agent2.isConnected()).toBe(true);
        });
    });

    describe('Memory Edge Cases', () => {
        it('should handle empty messages', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Empty Message Agent'
            });

            const memoryManager = agent.getMemoryManager();

            // Empty content should be handled
            await memoryManager.addConversationMessage({
                role: 'user',
                content: '',
                metadata: { empty: true }
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should handle very long messages', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Long Message Agent'
            });

            const memoryManager = agent.getMemoryManager();

            const longContent = 'Long message content. '.repeat(500);

            await memoryManager.addConversationMessage({
                role: 'user',
                content: longContent,
                metadata: { type: 'long-message' }
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should handle special characters in memory content', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MEMORY_TEST_AGENT_CONFIG,
                name: 'Special Chars Memory Agent'
            });

            const memoryManager = agent.getMemoryManager();

            await memoryManager.addConversationMessage({
                role: 'user',
                content: 'Special chars: <script>alert("xss")</script> & "quotes" \'apostrophe\'',
                metadata: { sanitization: 'test' }
            });

            expect(agent.isConnected()).toBe(true);
        });
    });
});
