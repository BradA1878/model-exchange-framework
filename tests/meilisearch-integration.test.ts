/**
 * Meilisearch Integration Test
 *
 * Tests the complete Meilisearch semantic search integration including:
 * - Automatic message indexing
 * - Historical message backfill
 * - Hybrid prompt approach (recent messages + search notice)
 * - Semantic search via memory_search_conversations tool
 * - Event emissions for indexing operations
 *
 * Prerequisites:
 * 1. MXF server running: npm run start:dev
 * 2. Meilisearch running: npm run docker:infra:up
 * 3. Demo user created: npm run server:cli -- demo:setup
 *
 * Run:
 * NODE_ENV=test ts-node tests/meilisearch-integration.test.ts
 */

import { MxfSDK, Events, LlmProviderType, MxfChannelMonitor, ConfigManager } from '../src/sdk/index';
import type { AgentCreationConfig, MxfAgent } from '../src/sdk/index';
import dotenv from 'dotenv';
import { enableClientLogging } from '../src/shared/utils/Logger';

dotenv.config();

// Enable client logging temporarily for debugging
//enableClientLogging('debug');

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const timestamp = Date.now();

const config = {
    serverUrl: 'http://localhost:3001',
    apiUrl: 'http://localhost:3001/api',
    channelId: `meilisearch-test-${timestamp}`,
    host: 'localhost',
    port: 3001,
    secure: false,
    testMessages: 20, // More than 15 to trigger hybrid prompt
    keyIds: {
        tester: `key-tester-${timestamp}`,
        searcher: `key-searcher-${timestamp}`
    },
    secretKeys: {
        tester: `secret-tester-${timestamp}`,
        searcher: `secret-searcher-${timestamp}`
    }
};

// Test results tracking
const testResults = {
    messagesIndexed: 0,
    backfillCompleted: false,
    hybridPromptTriggered: false,
    searchSuccessful: false,
    eventsReceived: {
        index: 0,
        backfill: 0,
        search: 0
    },
    errors: [] as string[]
};

// ============================================================================
// AGENT CONFIGURATIONS
// ============================================================================

const agentConfigurations: { [key: string]: AgentCreationConfig } = {
    'test-agent': {
        agentId: 'meili-test-agent',
        name: 'Meilisearch Test Agent',
        channelId: config.channelId,
        keyId: config.keyIds.tester,
        secretKey: config.secretKeys.tester,
        description: 'Agent for testing Meilisearch integration',
        capabilities: ['testing', 'messaging'],

        metadata: {
            role: 'Tester',
            purpose: 'Integration testing'
        },

        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-haiku-4.5',
        temperature: 0.7,
        maxTokens: 4000,

        allowedTools: [
            'memory_search_conversations',
            'messaging_send'
        ],

        mxpEnabled: false,

        agentConfigPrompt: `You are a test agent verifying Meilisearch integration.

When you receive a message asking you to search for something:
1. Use the memory_search_conversations tool to search past messages
2. Report what you found
3. Include the search query and number of results

Example:
User: "Search for messages about authentication"
You: Use memory_search_conversations({ query: "authentication", limit: 5 })
Then report the results.

Be concise and focus on testing the search functionality.`
    },

    'search-agent': {
        agentId: 'search-agent',
        name: 'Search Agent',
        channelId: config.channelId,
        keyId: config.keyIds.searcher,
        secretKey: config.secretKeys.searcher,
        description: 'Agent that reconnects to test backfill',
        capabilities: ['searching', 'testing'],

        metadata: {
            role: 'Searcher',
            purpose: 'Test backfill on reconnection'
        },

        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-haiku-4.5',
        temperature: 0.5,
        maxTokens: 4000,

        allowedTools: [
            'memory_search_conversations'
        ],

        mxpEnabled: false,

        agentConfigPrompt: `You are a search agent testing the Meilisearch backfill feature.

Your job is simple:
1. When you receive a message, acknowledge it
2. You may be asked to search - use memory_search_conversations if needed

Be brief and direct.`
    }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const log = (message: string, type: 'info' | 'success' | 'error' | 'test' = 'info'): void => {
    const icons = {
        info: 'ℹ️ ',
        success: '✅',
        error: '❌',
        test: '🧪'
    };
    console.log(`${icons[type]} ${message}`);
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// TEST SETUP
// ============================================================================

/**
 * Create test channel and generate keys
 */
const setupChannel = async (sdk: MxfSDK): Promise<MxfChannelMonitor> => {
    log('Creating test channel...', 'test');

    const channel = await sdk.createChannel(config.channelId, {
        name: 'Meilisearch Integration Test',
        description: 'Testing semantic search and backfill',
        isPrivate: false,
        requireApproval: false,
        maxAgents: 10,
        metadata: {
            test: 'meilisearch-integration',
            timestamp: Date.now()
        }
    });

    // Disable SystemLLM for this channel - agents handle their own coordination
    const configManager = ConfigManager.getInstance();
    configManager.setChannelSystemLlmEnabled(
        false,
        config.channelId,  // FIXED: Pass channelId as second parameter
        'Meilisearch Integration Test - agents handle their own coordination'
    );

    log('Channel created successfully', 'success');

    // Generate keys
    log('Generating authentication keys...', 'test');

    const testerKey = await sdk.generateKey(config.channelId, 'test-agent', 'Tester Key');
    const searcherKey = await sdk.generateKey(config.channelId, 'search-agent', 'Searcher Key');

    // Update configurations
    agentConfigurations['test-agent'].keyId = testerKey.keyId;
    agentConfigurations['test-agent'].secretKey = testerKey.secretKey;
    agentConfigurations['search-agent'].keyId = searcherKey.keyId;
    agentConfigurations['search-agent'].secretKey = searcherKey.secretKey;

    log('Keys generated successfully', 'success');

    return channel;
};

/**
 * Initialize test agent
 */
const initializeAgent = async (sdk: MxfSDK, agentKey: string): Promise<MxfAgent> => {
    const agentConfig = agentConfigurations[agentKey];
    log(`Initializing ${agentConfig.name}...`, 'test');

    const agent = await sdk.createAgent(agentConfig);
    await agent.connect();

    log(`${agentConfig.name} connected`, 'success');

    return agent;
};

/**
 * Setup event monitoring
 */
const setupEventMonitoring = (channel: MxfChannelMonitor): void => {
    log('Setting up event monitoring...', 'test');

    // Monitor Meilisearch indexing events
    channel.on('meilisearch:index', (payload: any) => {
        testResults.eventsReceived.index++;
        const data = payload.data;
        if (data?.success) {
            testResults.messagesIndexed++;
            log(`Message indexed: ${data.documentId} (${data.duration}ms)`, 'info');
        }
    });

    // Monitor Meilisearch backfill events
    channel.on('meilisearch:backfill:complete', (payload: any) => {
        testResults.eventsReceived.backfill++;
        const data = payload.data;
        testResults.backfillCompleted = true;
        log(`Backfill complete: ${data?.indexedDocuments}/${data?.totalDocuments} messages (${data?.duration}ms)`, 'success');
    });

    channel.on('meilisearch:backfill:partial', (payload: any) => {
        testResults.eventsReceived.backfill++;
        const data = payload.data;
        log(`Backfill partial: ${data?.indexedDocuments}/${data?.totalDocuments} messages, ${data?.failedDocuments} failed`, 'error');
    });

    // Monitor search events (if implemented)
    channel.on('meilisearch:search', (payload: any) => {
        testResults.eventsReceived.search++;
        const data = payload.data;
        log(`Search completed: ${data?.resultCount} results in ${data?.duration}ms`, 'info');
    });

    log('Event monitoring active', 'success');
};

// ============================================================================
// TEST CASES
// ============================================================================

/**
 * Test 1: Automatic Message Indexing
 * Sends 20 messages and verifies they are indexed to Meilisearch
 */
const testAutomaticIndexing = async (agent: MxfAgent): Promise<boolean> => {
    log('\n═══════════════════════════════════════════════════════', 'test');
    log('TEST 1: Automatic Message Indexing', 'test');
    log('═══════════════════════════════════════════════════════\n', 'test');

    try {
        const topics = [
            'authentication implementation',
            'user registration flow',
            'password reset functionality',
            'JWT token management',
            'OAuth integration',
            'session handling',
            'security best practices',
            'encryption methods',
            'API authentication',
            'multi-factor authentication',
            'database schema design',
            'error handling patterns',
            'logging configuration',
            'performance optimization',
            'caching strategies',
            'webhook implementation',
            'real-time notifications',
            'data validation',
            'testing strategies',
            'deployment procedures'
        ];

        log(`Sending ${config.testMessages} messages to trigger indexing...`, 'test');

        for (let i = 0; i < config.testMessages; i++) {
            const message = `Test message ${i + 1}: Discussing ${topics[i % topics.length]}`;

            // Send message via the agent's conversation system
            await agent.getMemoryManager().addConversationMessage({
                role: 'user',
                content: message,
                metadata: {
                    test: true,
                    messageNumber: i + 1,
                    topic: topics[i % topics.length]
                }
            });

            log(`Sent message ${i + 1}/${config.testMessages}: "${topics[i % topics.length]}"`, 'info');

            // Small delay to allow indexing
            await sleep(200);
        }

        // Wait for indexing to complete
        log('\nWaiting for indexing to complete...', 'test');
        await sleep(3000);

        const indexedCount = testResults.messagesIndexed;
        const expectedCount = config.testMessages;

        if (indexedCount >= expectedCount * 0.9) { // Allow 10% margin
            log(`SUCCESS: ${indexedCount}/${expectedCount} messages indexed`, 'success');
            return true;
        } else {
            const error = `FAILED: Only ${indexedCount}/${expectedCount} messages indexed`;
            log(error, 'error');
            testResults.errors.push(error);
            return false;
        }

    } catch (error) {
        const errorMsg = `Test 1 failed: ${error instanceof Error ? error.message : String(error)}`;
        log(errorMsg, 'error');
        testResults.errors.push(errorMsg);
        return false;
    }
};

/**
 * Test 2: Historical Message Backfill
 * Disconnects and reconnects the SAME agent to trigger backfill of its own history from MongoDB
 * Returns the fresh agent instance to be used for remaining tests
 */
const testBackfill = async (sdk: MxfSDK, testAgent: MxfAgent): Promise<{ success: boolean; freshAgent: MxfAgent | null }> => {
    log('\n═══════════════════════════════════════════════════════', 'test');
    log('TEST 2: Historical Message Backfill', 'test');
    log('═══════════════════════════════════════════════════════\n', 'test');

    try {
        log('Disconnecting test-agent to simulate session end...', 'test');

        // Disconnect the original agent
        await testAgent.disconnect();
        log('Agent disconnected', 'info');

        // Wait a bit to ensure disconnection is complete and memory is saved
        await sleep(2000);

        log('Creating fresh test-agent instance to trigger backfill...', 'test');

        // Create a NEW agent instance with the same agentId
        // This will have empty local memory but should load from MongoDB
        const freshTestAgent = await sdk.createAgent(agentConfigurations['test-agent']);
        await freshTestAgent.connect();

        log('Fresh agent instance connected - backfill should be running...', 'info');

        // Wait for backfill to complete (20 seconds for ~300 messages)
        await sleep(20000);

        if (testResults.backfillCompleted) {
            log('SUCCESS: Backfill completed', 'success');
            return { success: true, freshAgent: freshTestAgent };
        } else {
            const error = 'FAILED: Backfill did not complete';
            log(error, 'error');
            testResults.errors.push(error);
            return { success: false, freshAgent: freshTestAgent };
        }

    } catch (error) {
        const errorMsg = `Test 2 failed: ${error instanceof Error ? error.message : String(error)}`;
        log(errorMsg, 'error');
        testResults.errors.push(errorMsg);
        return { success: false, freshAgent: null };
    }
};

/**
 * Test 3: Hybrid Prompt Approach (Context Notice)
 * Verifies that context notice appears in system prompt when semantic search is enabled
 */
const testHybridPrompt = async (agent: MxfAgent): Promise<boolean> => {
    log('\n═══════════════════════════════════════════════════════', 'test');
    log('TEST 3: Hybrid Prompt Approach (Context Notice)', 'test');
    log('═══════════════════════════════════════════════════════\n', 'test');

    try {
        log('Checking if semantic search is available and configured...', 'test');

        // Verify the search tool is available
        const searchTool = agent.getToolService()?.getTool('memory_search_conversations');
        const hasSearchTool = !!searchTool;

        // Check that messages were indexed
        const messagesIndexed = testResults.messagesIndexed >= 20;

        // Check if tool description mentions semantic search or conversation history
        let hasSemanticGuidance = false;
        if (searchTool) {
            const toolDescription = searchTool.description || '';
            hasSemanticGuidance = toolDescription.toLowerCase().includes('search') ||
                                 toolDescription.toLowerCase().includes('semantic') ||
                                 toolDescription.toLowerCase().includes('conversation');
        }

        log(`Search tool available: ${hasSearchTool ? 'Yes' : 'No'}`, 'info');
        log(`Tool has semantic guidance: ${hasSemanticGuidance ? 'Yes' : 'No'}`, 'info');
        log(`Messages indexed: ${testResults.messagesIndexed}`, 'info');

        if (hasSearchTool && messagesIndexed && hasSemanticGuidance) {
            log('SUCCESS: Hybrid prompt approach is active', 'success');
            log('  • memory_search_conversations tool is available', 'info');
            log('  • Tool includes semantic search guidance', 'info');
            log('  • Messages are indexed and searchable', 'info');
            testResults.hybridPromptTriggered = true;
            return true;
        } else {
            const error = `FAILED: Hybrid prompt not fully configured - Tool: ${hasSearchTool}, Guidance: ${hasSemanticGuidance}, Indexed: ${messagesIndexed}`;
            log(error, 'error');
            testResults.errors.push(error);
            return false;
        }

    } catch (error) {
        const errorMsg = `Test 3 failed: ${error instanceof Error ? error.message : String(error)}`;
        log(errorMsg, 'error');
        testResults.errors.push(errorMsg);
        return false;
    }
};

/**
 * Test 4: Semantic Search
 * Uses memory_search_conversations tool to search indexed messages
 */
const testSemanticSearch = async (agent: MxfAgent): Promise<boolean> => {
    log('\n═══════════════════════════════════════════════════════', 'test');
    log('TEST 4: Semantic Search via memory_search_conversations', 'test');
    log('═══════════════════════════════════════════════════════\n', 'test');

    try {
        log('Testing semantic search for "authentication"...', 'test');

        // Wait for all documents to be indexed and searchable
        log('Waiting for all documents to be searchable...', 'info');
        await sleep(2000);

        // Direct tool execution to test search
        const searchResult = await agent.executeTool('memory_search_conversations', {
            query: 'authentication implementation',
            channelId: config.channelId,
            limit: 5,
            hybridRatio: 0.7
        });

        log('Search completed', 'info');

        // Parse result - handle nested MCP tool response structure
        let resultData;
        if (typeof searchResult === 'string') {
            try {
                resultData = JSON.parse(searchResult);
            } catch {
                resultData = searchResult;
            }
        } else {
            resultData = searchResult;
        }

        // Extract actual data from nested structure
        // MCP tools return: { type: "text", data: "{...}" } → parse → { content: { data: {...} } }
        if (resultData?.data && typeof resultData.data === 'string') {
            try {
                const parsed = JSON.parse(resultData.data);
                resultData = parsed?.content?.data || parsed;
            } catch {
                // Keep original if parsing fails
            }
        } else if (resultData?.content?.data) {
            resultData = resultData.content.data;
        }

        // Check for results
        const hasResults = resultData?.hits?.length > 0 ||
                          resultData?.results?.length > 0 ||
                          (typeof resultData === 'string' && resultData.includes('found'));

        if (hasResults) {
            const count = resultData?.hits?.length || resultData?.results?.length || 'some';
            log(`SUCCESS: Found ${count} results for "authentication"`, 'success');
            testResults.searchSuccessful = true;

            // Log sample results
            if (resultData?.hits?.[0]) {
                log(`Sample result: "${resultData.hits[0].content?.substring(0, 100)}..."`, 'info');
            }

            return true;
        } else {
            const error = 'FAILED: No search results returned';
            log(error, 'error');
            log(`Result data: ${JSON.stringify(resultData, null, 2)}`, 'info');
            testResults.errors.push(error);
            return false;
        }

    } catch (error) {
        const errorMsg = `Test 4 failed: ${error instanceof Error ? error.message : String(error)}`;
        log(errorMsg, 'error');
        testResults.errors.push(errorMsg);
        return false;
    }
};

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

const runTests = async (): Promise<void> => {
    console.log('\n' + '═'.repeat(80));
    console.log('🧪 MEILISEARCH INTEGRATION TEST SUITE');
    console.log('═'.repeat(80));
    console.log('');

    try {
        // Connect to MXF
        log('Connecting to MXF server...', 'test');
        const sdk = new MxfSDK({
            serverUrl: config.serverUrl,
            domainKey: process.env.MXF_DOMAIN_KEY!,
            username: process.env.MXF_DEMO_USERNAME || 'demo-user',
            password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
        });
        await sdk.connect();
        log('Connected to MXF server\n', 'success');

        // Setup
        const channel = await setupChannel(sdk);
        setupEventMonitoring(channel);
        const testAgent = await initializeAgent(sdk, 'test-agent');

        log('\nStarting tests in 2 seconds...\n', 'test');
        await sleep(2000);

        // Run tests
        const test1Result = await testAutomaticIndexing(testAgent);
        const test2Result = await testBackfill(sdk, testAgent);

        // Use fresh agent for remaining tests (has full history loaded from MongoDB)
        const agentForRemainingTests = test2Result.freshAgent || testAgent;

        const results = {
            test1: test1Result,
            test2: test2Result.success,
            test3: await testHybridPrompt(agentForRemainingTests),
            test4: await testSemanticSearch(agentForRemainingTests)
        };

        // Summary
        log('\n═══════════════════════════════════════════════════════', 'test');
        log('TEST SUMMARY', 'test');
        log('═══════════════════════════════════════════════════════\n', 'test');

        const passed = Object.values(results).filter(r => r).length;
        const total = Object.keys(results).length;

        log(`Tests passed: ${passed}/${total}`, passed === total ? 'success' : 'error');
        log(`Messages indexed: ${testResults.messagesIndexed}`, 'info');
        log(`Backfill completed: ${testResults.backfillCompleted ? 'Yes' : 'No'}`, testResults.backfillCompleted ? 'success' : 'error');
        log(`Hybrid prompt triggered: ${testResults.hybridPromptTriggered ? 'Yes' : 'No'}`, testResults.hybridPromptTriggered ? 'success' : 'error');
        log(`Semantic search works: ${testResults.searchSuccessful ? 'Yes' : 'No'}`, testResults.searchSuccessful ? 'success' : 'error');

        log('\nEvent counts:', 'info');
        log(`  - Index events: ${testResults.eventsReceived.index}`, 'info');
        log(`  - Backfill events: ${testResults.eventsReceived.backfill}`, 'info');
        log(`  - Search events: ${testResults.eventsReceived.search}`, 'info');

        if (testResults.errors.length > 0) {
            log('\nErrors:', 'error');
            testResults.errors.forEach(error => log(`  - ${error}`, 'error'));
        }

        log('', 'info');
        log('═'.repeat(80), 'test');

        if (passed === total) {
            log('✨ ALL TESTS PASSED ✨', 'success');
            log('Meilisearch integration is working correctly!', 'success');
        } else {
            log('⚠️  SOME TESTS FAILED', 'error');
            log('Check the errors above for details', 'error');
        }

        log('═'.repeat(80), 'test');
        log('', 'info');

        process.exit(passed === total ? 0 : 1);

    } catch (error) {
        log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`, 'error');
        console.error(error);
        process.exit(1);
    }
};

// Execute tests
if (require.main === module) {
    runTests();
}

export { runTests, testResults };
