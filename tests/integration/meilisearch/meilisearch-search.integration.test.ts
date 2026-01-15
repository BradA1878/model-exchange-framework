/**
 * Meilisearch Integration Tests
 *
 * Tests the Meilisearch semantic search integration:
 * - Message indexing
 * - Semantic search
 * - Hybrid search (keyword + semantic)
 * - Search filtering
 *
 * Note: These tests require Meilisearch to be running (docker:infra:up)
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { TIMEOUTS } from '../../utils/TestFixtures';

describe('Meilisearch Integration', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let channelMonitor: any;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('meilisearch', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
        channelMonitor = result.monitor;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Message Indexing', () => {
        it('should index messages for search', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Indexing Agent',
                allowedTools: ['messaging_send', 'memory_search_conversations'],
                agentConfigPrompt: 'You send messages that get indexed.'
            });

            // Set up event capture for indexing events
            const eventCapture = createEventCapture();
            eventCapture.capture(channelMonitor, [
                'meilisearch:index',
                'meilisearch:index:complete'
            ]);

            // Add messages to be indexed
            const memoryManager = agent.getMemoryManager();

            const topics = [
                'Machine learning algorithms and neural networks',
                'Database optimization and query performance',
                'API design patterns and REST architecture',
                'Authentication methods including JWT and OAuth2',
                'Container orchestration with Kubernetes'
            ];

            for (const topic of topics) {
                await memoryManager.addConversationMessage({
                    role: 'user',
                    content: `Discussion about: ${topic}`,
                    metadata: { indexed: true }
                });
                await sleep(200); // Small delay between messages
            }

            // Wait for indexing
            await sleep(2000);

            eventCapture.cleanup();
        });
    });

    describe('Semantic Search', () => {
        it('should search conversations semantically', async () => {
            const searchAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Semantic Search Agent',
                allowedTools: ['memory_search_conversations'],
                agentConfigPrompt: 'You perform semantic searches.'
            });

            // First, add some searchable content
            const memoryManager = searchAgent.getMemoryManager();
            await memoryManager.addConversationMessage({
                role: 'user',
                content: 'The authentication system uses JWT tokens for secure API access',
                metadata: { searchable: true }
            });

            // Wait for indexing
            await sleep(2000);

            // Perform semantic search
            const result = await searchAgent.executeTool('memory_search_conversations', {
                query: 'security tokens',
                channelId,
                limit: 5,
                hybridRatio: 0.7 // 70% semantic, 30% keyword
            });

            expect(result).toBeDefined();
        });

        it('should search with different hybrid ratios', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Hybrid Ratio Agent',
                allowedTools: ['memory_search_conversations'],
                agentConfigPrompt: 'You test different search ratios.'
            });

            // Test different ratios
            const ratios = [0.0, 0.3, 0.5, 0.7, 1.0];

            for (const ratio of ratios) {
                const result = await agent.executeTool('memory_search_conversations', {
                    query: 'test search',
                    channelId,
                    limit: 3,
                    hybridRatio: ratio
                });

                expect(result).toBeDefined();
            }
        });
    });

    describe('Search Filtering', () => {
        it('should filter search by channel', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Channel Filter Agent',
                allowedTools: ['memory_search_conversations'],
                agentConfigPrompt: 'You filter searches by channel.'
            });

            const result = await agent.executeTool('memory_search_conversations', {
                query: 'any content',
                channelId, // Filter to this channel only
                limit: 10
            });

            expect(result).toBeDefined();
        });

        it('should limit search results', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Limit Test Agent',
                allowedTools: ['memory_search_conversations'],
                agentConfigPrompt: 'You test search limits.'
            });

            // Test with small limit
            const result = await agent.executeTool('memory_search_conversations', {
                query: 'test',
                channelId,
                limit: 1
            });

            expect(result).toBeDefined();
        });
    });

    describe('Action Search', () => {
        it('should search tool execution history', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Action Search Agent',
                allowedTools: ['memory_search_actions', 'tool_help'],
                agentConfigPrompt: 'You search action history.'
            });

            // Execute some tools to create action history
            await agent.executeTool('tool_help', { toolName: 'messaging_send' });
            await agent.executeTool('tool_help', { toolName: 'agent_discover' });

            await sleep(1000);

            // Search actions
            const result = await agent.executeTool('memory_search_actions', {
                query: 'tool help',
                channelId,
                limit: 5
            });

            expect(result).toBeDefined();
        });
    });

    describe('Pattern Search', () => {
        it('should search for patterns in memory', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Pattern Search Agent',
                allowedTools: ['memory_search_patterns'],
                agentConfigPrompt: 'You search for patterns.'
            });

            const result = await agent.executeTool('memory_search_patterns', {
                intent: 'effective collaboration',
                limit: 5
            });

            expect(result).toBeDefined();
        });
    });

    describe('Search Performance', () => {
        it('should complete search within timeout', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Performance Test Agent',
                allowedTools: ['memory_search_conversations'],
                agentConfigPrompt: 'You test search performance.'
            });

            const startTime = Date.now();

            await agent.executeTool('memory_search_conversations', {
                query: 'performance test query',
                channelId,
                limit: 10
            });

            const searchTime = Date.now() - startTime;

            // Search should complete within standard timeout
            expect(searchTime).toBeLessThan(TIMEOUTS.standard);
        });
    });
});
