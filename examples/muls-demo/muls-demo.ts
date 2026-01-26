/**
 * Memory Utility Learning System (MULS) Demo
 *
 * This demo is FULLY AGENTIC - the agent autonomously:
 * 1. Stores test memories in the system
 * 2. Views initial Q-value analytics (all memories start at 0.5)
 * 3. Injects reward signals to simulate task outcomes
 * 4. Views updated Q-value analytics showing learned utility
 * 5. Demonstrates configuration of lambda values
 *
 * All MULS operations happen through actual tool calls - no local simulation.
 *
 * @prerequisites
 * - MXF server running with MEMORY_UTILITY_LEARNING_ENABLED=true
 * - Environment variables configured (see .env.example)
 *
 * @example
 * ```bash
 * # Start server with MULS enabled
 * MEMORY_UTILITY_LEARNING_ENABLED=true bun run dev
 *
 * # In another terminal, run demo
 * bun run demo:muls
 * ```
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `muls-demo-${timestamp}`
};

/**
 * Display demo banner
 */
const displayBanner = (): void => {
    console.log('\n' + '='.repeat(70));
    console.log('MEMORY UTILITY LEARNING SYSTEM (MULS) - AGENTIC DEMO');
    console.log('='.repeat(70));
    console.log('');
    console.log('This demo shows an agent AUTONOMOUSLY demonstrating MULS:');
    console.log('');
    console.log('  1. Store test memories using agent_memory_write');
    console.log('  2. View initial Q-values using memory_qvalue_analytics');
    console.log('  3. Inject rewards using memory_inject_reward');
    console.log('  4. View updated Q-values showing learned utility');
    console.log('  5. Configure lambda values using memory_utility_config');
    console.log('');
    console.log('Key MULS Concepts:');
    console.log('  - Q-Value Formula: Q_new = Q_old + 0.1 * (reward - Q_old)');
    console.log('  - Scoring Formula: score = (1-lambda) * similarity + lambda * Q');
    console.log('  - Rewards: success=+1.0, failure=-1.0, partial=+0.3');
    console.log('');
    console.log('Watch for:');
    console.log('  - [Agent Thinking] The LLM\'s reasoning process');
    console.log('  - [Agent Response] The LLM\'s full response');
    console.log('  - [MULS Tool Call] Tool calls with arguments');
    console.log('  - [Analytics Result] Q-value statistics');
    console.log('='.repeat(70));
    console.log('');
};

/**
 * Setup channel monitoring for tool calls, messages, and LLM thinking
 */
const setupMonitoring = (channel: MxfChannelMonitor): Promise<void> => {
    return new Promise((resolve) => {
        const processedIds = new Set<string>();
        const processedToolResults = new Set<string>(); // Dedup for TOOL_RESULT events
        let taskCompleted = false;

        // Listen for LLM reasoning/thinking - shows the agent's internal thought process
        channel.on(Events.Agent.LLM_REASONING, (payload: any) => {
            const reasoning = payload.data?.reasoning || payload.data?.content || payload.data || '';
            if (reasoning && typeof reasoning === 'string' && reasoning.length > 0) {
                console.log(`\n${'─'.repeat(70)}`);
                console.log('[Agent Thinking]');
                console.log('─'.repeat(70));
                console.log(reasoning);  // Full output, no truncation
                console.log('─'.repeat(70) + '\n');
            }
        });

        // Listen for LLM responses - shows the agent's full response
        channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
            const response = payload.data?.response || payload.data?.content || payload.data || '';
            if (response && typeof response === 'string' && response.length > 0) {
                console.log(`\n${'═'.repeat(70)}`);
                console.log('[Agent Response]');
                console.log('═'.repeat(70));
                console.log(response);  // Full output, no truncation
                console.log('═'.repeat(70) + '\n');
            }
        });

        // Listen for agent messages (channel broadcast)
        channel.on(Events.Message.AGENT_MESSAGE, (payload: any) => {
            try {
                const messageId = payload.data?.metadata?.messageId ||
                    `${payload.agentId}-${payload.timestamp || Date.now()}`;

                if (processedIds.has(messageId)) return;
                processedIds.add(messageId);
                setTimeout(() => processedIds.delete(messageId), 5000);

                let content = payload.data?.content || payload.data?.message || '';
                if (typeof content === 'object') {
                    content = content.data || content.content || JSON.stringify(content);
                }

                if (content && content.length > 0) {
                    console.log(`\n[Agent Broadcast Message]\n${content}\n`);  // Full output
                }
            } catch (error) {
                // Silent fail
            }
        });

        // Listen for tool calls - this is the key to seeing MULS in action
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Highlight MULS-related tool calls
            const mulsTools = [
                'memory_qvalue_analytics',
                'memory_utility_config',
                'memory_inject_reward',
                'agent_memory_write',
                'agent_memory_read'
            ];

            if (mulsTools.includes(toolName)) {
                console.log(`\n${'='.repeat(50)}`);
                console.log(`[MULS Tool Call] ${toolName}`);
                console.log(`${'='.repeat(50)}`);

                // Pretty print relevant args - full output, no truncation
                if (toolName === 'memory_inject_reward') {
                    console.log(`  Memory ID: ${args.memoryId}`);
                    console.log(`  Reward: ${args.reward > 0 ? '+' : ''}${args.reward}`);
                    console.log(`  Reason: ${args.reason}`);
                } else if (toolName === 'agent_memory_write') {
                    console.log(`  Key: ${args.key}`);
                    console.log(`  Value: ${JSON.stringify(args.value, null, 2)}`);
                } else if (toolName === 'memory_utility_config') {
                    console.log(`  Action: ${args.action || 'get'}`);
                    if (args.lambda !== undefined) console.log(`  Lambda: ${args.lambda}`);
                    if (args.phaseLambdas) console.log(`  Phase Lambdas: ${JSON.stringify(args.phaseLambdas)}`);
                } else {
                    console.log(`  Args: ${JSON.stringify(args, null, 2)}`);
                }
            } else if (toolName === 'task_complete') {
                console.log(`\n[Task Complete] ${args.summary || 'Demo finished'}`);
            }
        });

        // Listen for tool results (with deduplication)
        channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
            // Deduplicate based on callId to prevent showing duplicate results
            const callId = payload.data?.callId || payload.eventId || '';
            if (callId && processedToolResults.has(callId)) {
                return; // Skip duplicate
            }
            if (callId) {
                processedToolResults.add(callId);
                // Clean up old entries after 5 seconds
                setTimeout(() => processedToolResults.delete(callId), 5000);
            }

            const toolName = payload.data?.toolName || 'unknown';
            const result = payload.data?.result || payload.data?.content || {};

            // Helper to unwrap McpToolResultContent: { type: 'application/json', data: {...} }
            const unwrapResult = (rawResult: any): any => {
                if (typeof rawResult === 'string') {
                    return JSON.parse(rawResult);
                }
                // Check for McpToolResultContent wrapper structure
                if (rawResult && rawResult.type === 'application/json' && rawResult.data !== undefined) {
                    return rawResult.data;
                }
                return rawResult;
            };

            // Show MULS tool results
            if (toolName === 'memory_qvalue_analytics') {
                console.log(`\n[Analytics Result]`);
                try {
                    const data = unwrapResult(result);
                    if (data.enabled === false) {
                        console.log('  MULS is DISABLED - enable with MEMORY_UTILITY_LEARNING_ENABLED=true');
                    } else if (data.statistics) {
                        console.log(`  Enabled: ${data.enabled}`);
                        console.log(`  Memory Count: ${data.statistics?.count || 0}`);
                        console.log(`  Mean Q-Value: ${data.statistics?.mean?.toFixed(4) || 'N/A'}`);
                        console.log(`  Std Dev: ${data.statistics?.stdDev?.toFixed(4) || 'N/A'}`);
                        console.log(`  Min: ${data.statistics?.min?.toFixed(4) || 'N/A'}`);
                        console.log(`  Max: ${data.statistics?.max?.toFixed(4) || 'N/A'}`);
                        if (data.topPerformers?.length > 0) {
                            console.log(`  Top Performers:`);
                            data.topPerformers.slice(0, 3).forEach((m: any, i: number) => {
                                console.log(`    ${i + 1}. ${m.memoryId}: Q=${m.qValue?.toFixed(3)}`);
                            });
                        }
                    }
                } catch (e) {
                    console.log(`  ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'memory_inject_reward') {
                console.log(`\n[Reward Injection Result]`);
                try {
                    const data = unwrapResult(result);
                    if (data.success) {
                        console.log(`  Success: Memory ${data.memoryId}`);
                        console.log(`  New Q-Value: ${data.newQValue?.toFixed(4)}`);
                    } else {
                        console.log(`  Failed: ${data.error}`);
                    }
                } catch (e) {
                    console.log(`  ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'memory_utility_config') {
                console.log(`\n[MULS Config Result]`);
                try {
                    const data = unwrapResult(result);
                    console.log(JSON.stringify(data, null, 2));
                } catch (e) {
                    console.log(`  ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'agent_memory_write') {
                console.log(`\n[Memory Write Result]`);
                try {
                    const data = unwrapResult(result);
                    if (data.success !== false) {
                        console.log(`  Success: Memory stored`);
                    } else {
                        console.log(`  Failed: ${data.error || 'Unknown error'}`);
                    }
                } catch (e) {
                    console.log(`  ${JSON.stringify(result, null, 2)}`);
                }
            }
        });

        // Listen for task completion
        channel.on(Events.Task.COMPLETED, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;

            console.log('\n' + '='.repeat(70));
            console.log('[Demo Complete]');
            if (payload.data?.summary) {
                console.log(`Summary: ${payload.data.summary}`);
            }
            console.log('='.repeat(70) + '\n');

            setTimeout(() => resolve(), 1000);
        });
    });
};

/**
 * Create the MULS demonstration agent
 */
const createMULSAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'MULSAgent',
        name: 'MULS Demonstration Agent',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'Agent demonstrating Memory Utility Learning System through actual tool calls',

        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.3,
        maxTokens: 4000,
        maxIterations: 25, // Increased from default 10 to handle 13+ tool calls in MULS demo

        // Tools for the full MULS demonstration
        allowedTools: [
            // Memory operations
            'agent_memory_write',
            'agent_memory_read',
            // MULS-specific tools
            'memory_qvalue_analytics',
            'memory_utility_config',
            'memory_inject_reward',
            // Task completion
            'task_complete'
        ],

        agentConfigPrompt: `You are demonstrating the Memory Utility Learning System (MULS).

## YOUR MISSION

Execute a complete MULS demonstration by performing these steps IN ORDER:

### STEP 1: Check MULS Configuration
Call memory_utility_config with action="get" to verify MULS is enabled and show current settings.

### STEP 2: Store Test Memories
Create 5 test memories using agent_memory_write with these exact keys and values:
- Key: "muls_pattern_auth", Value: { "type": "pattern", "content": "JWT authentication with refresh tokens", "domain": "security" }
- Key: "muls_pattern_cache", Value: { "type": "pattern", "content": "Redis caching with TTL and invalidation", "domain": "performance" }
- Key: "muls_pattern_error", Value: { "type": "pattern", "content": "Circuit breaker pattern for fault tolerance", "domain": "reliability" }
- Key: "muls_pattern_logging", Value: { "type": "pattern", "content": "Structured JSON logging with correlation IDs", "domain": "observability" }
- Key: "muls_pattern_api", Value: { "type": "pattern", "content": "RESTful API design with versioning", "domain": "architecture" }

### STEP 3: View Initial Analytics
Call memory_qvalue_analytics to show the initial Q-value distribution.
Note: New memories start with Q-value = 0.5 (neutral).

### STEP 4: Simulate Task Outcomes via Reward Injection
Inject rewards to simulate which memories led to successful vs failed tasks:

SUCCESSFUL patterns (positive rewards):
- memory_inject_reward: memoryId="muls_pattern_auth", reward=0.8, reason="Successfully implemented secure authentication"
- memory_inject_reward: memoryId="muls_pattern_logging", reward=0.9, reason="Greatly improved debugging capabilities"

FAILED patterns (negative rewards):
- memory_inject_reward: memoryId="muls_pattern_cache", reward=-0.6, reason="Caching strategy caused stale data issues"

PARTIAL SUCCESS:
- memory_inject_reward: memoryId="muls_pattern_error", reward=0.3, reason="Partially effective error handling"

### STEP 5: View Updated Analytics
Call memory_qvalue_analytics again to show how Q-values changed.
Explain the EMA update formula: Q_new = Q_old + 0.1 * (reward - Q_old)

### STEP 6: Explain MULS Benefits
Briefly explain how these Q-values would affect future retrieval:
- Higher Q-value memories are prioritized when lambda > 0
- ORPAR phases use different lambda values (planning=0.7 exploits proven patterns)

### STEP 7: Complete
Call task_complete with a summary of what was demonstrated.

## IMPORTANT RULES
- Execute ALL steps in order
- Use the EXACT memory keys specified (with "muls_" prefix)
- Show your work by explaining what each tool call does
- If MULS is disabled, explain how to enable it and still demonstrate the concept`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the MULS demonstration task
 */
const createMULSTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating MULS demonstration task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'MULS End-to-End Demonstration',
        description: `# Memory Utility Learning System (MULS) Demo

Demonstrate MULS by executing these steps:

1. **Check Configuration** - Verify MULS is enabled
2. **Store Memories** - Create 5 test pattern memories
3. **View Initial Q-Values** - Show all start at 0.5
4. **Inject Rewards** - Simulate task outcomes (success/failure)
5. **View Updated Q-Values** - Show learned utility
6. **Explain Benefits** - How Q-values affect retrieval
7. **Complete** - Summarize the demonstration

Use the actual MULS tools - this is not a simulation!`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['MULSAgent'],
        completionAgentId: 'MULSAgent',
        priority: 'high',
        tags: ['muls', 'memory-utility', 'demo', 'agentic'],
        metadata: {
            demo: 'muls',
            scenario: 'end-to-end-demonstration'
        }
    });

    console.log(`Task created: ${taskId}\n`);
    return taskId;
};

// Cleanup state
let cleanupState: {
    agent: MxfAgent | null;
    sdk: MxfSDK | null;
    credentials: { keyId: string; secretKey: string } | null;
    cleanupDone: boolean;
} = {
    agent: null,
    sdk: null,
    credentials: null,
    cleanupDone: false
};

/**
 * Cleanup function
 */
async function cleanup(): Promise<void> {
    if (cleanupState.cleanupDone) return;
    cleanupState.cleanupDone = true;

    console.log('\nCleaning up...');

    if (cleanupState.agent) {
        await cleanupState.agent.disconnect().catch(() => {});
    }

    if (cleanupState.credentials) {
        // Delete agent memory (including our test memories)
        await fetch(`${config.serverUrl}/api/agents/MULSAgent/memory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        // Delete channel
        await fetch(`${config.serverUrl}/api/channels/${config.channelId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});
    }

    if (cleanupState.sdk) {
        await cleanupState.sdk.disconnect().catch(() => {});
    }

    console.log('Cleanup complete');
}

// Handle signals
process.on('SIGINT', async () => {
    console.log('\nInterrupted (Ctrl+C)');
    await cleanup();
    process.exit(130);
});

process.on('SIGTERM', async () => {
    console.log('\nTerminated');
    await cleanup();
    process.exit(143);
});

/**
 * Main demo function
 */
async function demo() {
    displayBanner();

    // Initialize SDK
    const sdk = new MxfSDK({
        serverUrl: config.serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY!,
        username: process.env.MXF_DEMO_USERNAME || 'demo-user',
        password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
    });

    cleanupState.sdk = sdk;

    try {
        await sdk.connect();
        console.log('SDK connected\n');

        // Create channel
        console.log('Creating demo channel...');
        const channel = await sdk.createChannel(config.channelId, {
            name: 'MULS Demo Channel',
            description: 'Demonstrating Memory Utility Learning System',
            systemLlmEnabled: false
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'MULS Agent Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Create agent
        console.log('Creating MULS demonstration agent...');
        const agent = await createMULSAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create task
        await createMULSTask(agent);

        console.log('Agent is now executing the MULS demonstration...');
        console.log('Watch for [MULS Tool Call] messages below.\n');
        console.log('-'.repeat(70) + '\n');

        // Wait for completion with timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (3 minutes) - the agent may still be working');
                resolve();
            }, 180000); // 3 minutes for full demo
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

    } catch (error) {
        console.error('\nDemo failed:', error);
        console.log('\nTroubleshooting:');
        console.log('  1. Ensure MXF server is running: bun run dev');
        console.log('  2. Enable MULS: MEMORY_UTILITY_LEARNING_ENABLED=true bun run dev');
        console.log('  3. Check OPENROUTER_API_KEY is set');
    } finally {
        await cleanup();
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('MULS DEMO SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log('What was demonstrated:');
    console.log('  - Real memory storage via agent_memory_write');
    console.log('  - Q-value analytics via memory_qvalue_analytics');
    console.log('  - Reward injection via memory_inject_reward');
    console.log('  - Configuration viewing via memory_utility_config');
    console.log('');
    console.log('Key MULS Formulas:');
    console.log('  - Q-Value Update: Q_new = Q_old + alpha * (reward - Q_old)');
    console.log('  - Composite Score: score = (1-lambda) * similarity + lambda * Q');
    console.log('');
    console.log('ORPAR Phase Lambdas (how much to weight utility vs similarity):');
    console.log('  - OBSERVATION: 0.2 (favor semantic accuracy)');
    console.log('  - REASONING:   0.5 (balanced)');
    console.log('  - PLANNING:    0.7 (exploit proven patterns)');
    console.log('  - ACTION:      0.3 (stay grounded)');
    console.log('  - REFLECTION:  0.6 (favor good assessments)');
    console.log('');
}

// Run demo
demo()
    .then(() => {
        console.log('Demo completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Demo failed:', error);
        process.exit(1);
    });

export { demo };
