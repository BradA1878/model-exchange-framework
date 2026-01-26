/**
 * ORPAR-Memory Integration Demo
 *
 * This demo shows the full ORPAR-Memory integration:
 * 1. Agent running ORPAR cycle with phase-specific memory retrieval
 * 2. Surprise detection triggering extra observation cycles
 * 3. Phase-weighted rewards after task completion
 * 4. Memory consolidation on successful cycle
 *
 * @prerequisites
 * - MXF server running with ORPAR_MEMORY_INTEGRATION_ENABLED=true
 * - Environment variables configured (see .env.example)
 *
 * @example
 * ```bash
 * # Start server with ORPAR-Memory integration enabled
 * ORPAR_MEMORY_INTEGRATION_ENABLED=true MEMORY_STRATA_ENABLED=true MEMORY_UTILITY_LEARNING_ENABLED=true bun run dev
 *
 * # In another terminal, run demo
 * bun run demo:orpar-memory
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
    channelId: `orpar-memory-demo-${timestamp}`
};

/**
 * Display demo banner
 */
const displayBanner = (): void => {
    console.log('\n' + '='.repeat(70));
    console.log('ORPAR-MEMORY INTEGRATION DEMO');
    console.log('='.repeat(70));
    console.log('');
    console.log('This demo shows the unified cognitive-memory architecture:');
    console.log('');
    console.log('  1. Phase-Strata Routing: Memories retrieved based on ORPAR phase');
    console.log('     - OBSERVATION: Working, Short-term (lambda=0.2)');
    console.log('     - REASONING: Episodic, Semantic (lambda=0.5)');
    console.log('     - PLANNING: Semantic, Long-term (lambda=0.7)');
    console.log('     - ACTION: Working, Short-term (lambda=0.3)');
    console.log('     - REFLECTION: All strata (lambda=0.6)');
    console.log('');
    console.log('  2. Surprise Detection: High surprise triggers extra observations');
    console.log('     - High (>0.7): 1-3 additional observation cycles');
    console.log('     - Moderate (0.4-0.7): Context injection into reasoning');
    console.log('');
    console.log('  3. Phase-Weighted Rewards: Q-values updated by phase contribution');
    console.log('     - OBSERVATION: 15% weight');
    console.log('     - REASONING: 20% weight');
    console.log('     - PLANNING: 30% weight');
    console.log('     - ACTION: 25% weight');
    console.log('     - REFLECTION: 10% weight');
    console.log('');
    console.log('  4. Cycle Consolidation: Memory transitions on success');
    console.log('     - Q >= 0.7 + 3 successes: PROMOTE');
    console.log('     - Q <= 0.3 + 5 failures: ARCHIVE');
    console.log('');
    console.log('Watch for:');
    console.log('  - [Phase Change] ORPAR phase transitions');
    console.log('  - [Memory Retrieved] Phase-specific memory access');
    console.log('  - [Surprise Detected] Surprise-driven decisions');
    console.log('  - [Reward Attributed] Phase-weighted Q-value updates');
    console.log('  - [Consolidation] Memory stratum transitions');
    console.log('='.repeat(70));
    console.log('');
};

/**
 * Setup channel monitoring for ORPAR-Memory events
 */
const setupMonitoring = (channel: MxfChannelMonitor): Promise<void> => {
    return new Promise((resolve) => {
        const processedIds = new Set<string>();
        let taskCompleted = false;

        // Listen for LLM reasoning/thinking
        channel.on(Events.Agent.LLM_REASONING, (payload: any) => {
            const reasoning = payload.data?.reasoning || payload.data?.content || payload.data || '';
            if (reasoning && typeof reasoning === 'string' && reasoning.length > 0) {
                console.log(`\n${'─'.repeat(70)}`);
                console.log('[Agent Thinking]');
                console.log('─'.repeat(70));
                console.log(reasoning.substring(0, 500) + (reasoning.length > 500 ? '...' : ''));
                console.log('─'.repeat(70) + '\n');
            }
        });

        // Listen for LLM responses
        channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
            const response = payload.data?.response || payload.data?.content || payload.data || '';
            if (response && typeof response === 'string' && response.length > 0) {
                console.log(`\n${'═'.repeat(70)}`);
                console.log('[Agent Response]');
                console.log('═'.repeat(70));
                console.log(response.substring(0, 500) + (response.length > 500 ? '...' : ''));
                console.log('═'.repeat(70) + '\n');
            }
        });

        // Listen for agent messages
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
                    const displayContent = content.length > 500
                        ? content.substring(0, 500) + '...'
                        : content;
                    console.log(`\n[Agent Message]\n${displayContent}\n`);
                }
            } catch (error) {
                // Silent fail
            }
        });

        // Listen for tool calls
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Highlight ORPAR and memory-related tool calls
            const relevantTools = [
                'orpar_observe', 'orpar_reason', 'orpar_plan', 'orpar_act', 'orpar_reflect',
                'agent_memory_write', 'agent_memory_read',
                'memory_qvalue_analytics', 'memory_inject_reward',
                'task_complete'
            ];

            if (relevantTools.includes(toolName)) {
                console.log(`\n[Tool Call] ${toolName}`);
                if (Object.keys(args).length > 0) {
                    const argStr = JSON.stringify(args, null, 2);
                    console.log(`  Args: ${argStr.substring(0, 200)}${argStr.length > 200 ? '...' : ''}`);
                }
            }
        });

        // Listen for tool results
        channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
            const toolName = payload.data?.toolName || 'unknown';
            const result = payload.data?.result;
            const data = result?.data;

            const relevantTools = [
                'orpar_observe', 'orpar_reason', 'orpar_plan', 'orpar_act', 'orpar_reflect',
                'agent_memory_write', 'agent_memory_read', 'task_complete'
            ];

            if (relevantTools.includes(toolName)) {
                const isSuccess = data?.success === true || (data && !data?.error);
                console.log(`[Tool Result] ${toolName}: ${isSuccess ? 'Success' : 'Failed'}`);
            }
        });

        // Listen for task completion
        channel.on(Events.Task.COMPLETED, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;
            console.log(`\n${'═'.repeat(50)}`);
            console.log('[Task Completed]');
            if (payload.data?.summary) {
                console.log(`Summary: ${payload.data.summary}`);
            }
            console.log(`${'═'.repeat(50)}\n`);
            setTimeout(resolve, 1000);
        });

        // Also resolve after a timeout in case task completion event is missed
        setTimeout(() => {
            if (!taskCompleted) {
                console.log('\n[Demo Timeout - completing]');
                resolve();
            }
        }, 120000); // 2 minute timeout
    });
};

/**
 * Create the ORPAR-Memory demo agent
 */
const createDemoAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'OrparMemoryDemoAgent',
        name: 'ORPAR-Memory Demo Agent',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'An agent demonstrating ORPAR-Memory integration',

        // LLM configuration
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.3,
        maxTokens: 8000,

        // Tools available to the agent
        allowedTools: [
            // ORPAR tools
            'orpar_observe', 'orpar_reason', 'orpar_plan', 'orpar_act', 'orpar_reflect',
            // Memory tools
            'agent_memory_write', 'agent_memory_read',
            // Basic tools
            'tools_recommend', 'task_complete'
        ],

        // Detailed agent behavior prompt
        agentConfigPrompt: `You are an AI agent demonstrating the ORPAR-Memory integration.

Your goal is to demonstrate how ORPAR phases work with the memory system by completing ONE full ORPAR cycle.

## ORPAR CYCLE PHASES

1. OBSERVATION: Observe the current state
   - Call orpar_observe with your observations
   - System retrieves memories from Working + Short-term strata (lambda=0.2)

2. REASONING: Analyze the observations
   - Call orpar_reason with your analysis
   - System retrieves memories from Episodic + Semantic strata (lambda=0.5)

3. PLANNING: Create a plan
   - Call orpar_plan with your plan
   - System retrieves memories from Semantic + Long-term strata (lambda=0.7)

4. ACTION: Execute the plan
   - Call orpar_act with the action result
   - System retrieves memories from Working + Short-term strata (lambda=0.3)

5. REFLECTION: Reflect on the outcome
   - Call orpar_reflect with your learnings
   - System retrieves memories from ALL strata (lambda=0.6)

## YOUR TASK

Complete ONE full ORPAR cycle about a topic of your choice:
1. Use orpar_observe to observe something (e.g., "The weather today" or "A coding pattern")
2. Use orpar_reason to reason about what you observed
3. Use orpar_plan to create a simple plan based on your reasoning
4. Use orpar_act to describe executing one step of your plan
5. Use orpar_reflect to reflect on what you learned

After completing all 5 phases, call task_complete with a summary.

## IMPORTANT

- Call each ORPAR tool in order: observe → reason → plan → act → reflect
- After each tool call, briefly explain what you did
- Use memory tools (agent_memory_write/read) if you want to store/retrieve specific memories
- Finish by calling task_complete`
    });

    await agent.connect();
    return agent;
};

// Cleanup state for signal handler access
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
        // Delete agent memory via API
        await fetch(`${config.serverUrl}/api/agents/OrparMemoryDemoAgent/memory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        // Delete channel via API
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

// Handle Ctrl+C and termination signals
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

    console.log('Initializing MxfSDK...\n');

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
            name: 'ORPAR-Memory Demo Channel',
            description: 'Demonstrating ORPAR-Memory integration',
            systemLlmEnabled: true  // Enable SystemLLM for ORPAR control
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring - returns promise that resolves on task completion
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'ORPAR-Memory Demo Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Create agent
        console.log('Creating ORPAR-Memory demo agent...');
        const agent = await createDemoAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create the task for the agent
        console.log('Creating demonstration task...');
        const taskId = await agent.mxfService.createTask({
            title: 'Complete ORPAR-Memory Demonstration',
            description: `Demonstrate the ORPAR-Memory integration by completing one full ORPAR cycle.

Go through all 5 phases:
1. OBSERVATION: Use orpar_observe to observe something
2. REASONING: Use orpar_reason to analyze your observation
3. PLANNING: Use orpar_plan to create a plan
4. ACTION: Use orpar_act to execute part of your plan
5. REFLECTION: Use orpar_reflect to reflect on the outcome

After completing all phases, call task_complete with a summary of what you demonstrated.`,
            assignmentScope: 'single',
            assignmentStrategy: 'manual',
            assignedAgentIds: ['OrparMemoryDemoAgent'],
            completionAgentId: 'OrparMemoryDemoAgent',
            priority: 'high',
            tags: ['orpar-memory', 'demo'],
            metadata: {
                demo: 'orpar-memory',
                scenario: 'integration-demo'
            }
        });
        console.log(`Task created: ${taskId}\n`);

        console.log('Agent is now working through the ORPAR cycle...\n');
        console.log('─'.repeat(70) + '\n');

        // Race between task completion and timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (2 minutes) - exiting demo');
                resolve();
            }, 120000);
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

        console.log('\n' + '='.repeat(70));
        console.log('DEMO COMPLETE');
        console.log('='.repeat(70));
        console.log('');
        console.log('Key takeaways:');
        console.log('  - Different ORPAR phases access different memory strata');
        console.log('  - Phase-specific lambda values weight similarity vs utility');
        console.log('  - Q-values are updated with phase-weighted rewards');
        console.log('  - Successful cycles trigger memory consolidation');
        console.log('');
        console.log('ORPAR-Memory Configuration:');
        console.log('  Phase       | Primary Strata          | Lambda');
        console.log('  ------------|-------------------------|-------');
        console.log('  OBSERVATION | Working, Short-term     | 0.2');
        console.log('  REASONING   | Episodic, Semantic      | 0.5');
        console.log('  PLANNING    | Semantic, Long-term     | 0.7');
        console.log('  ACTION      | Working, Short-term     | 0.3');
        console.log('  REFLECTION  | All strata              | 0.6');
        console.log('');

    } finally {
        await cleanup();
    }

    process.exit(0);
}

// Run the demo
demo().catch((error) => {
    console.error('Demo error:', error);
    cleanup().then(() => process.exit(1));
});
