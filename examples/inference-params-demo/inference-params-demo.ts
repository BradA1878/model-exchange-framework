/**
 * Dynamic Inference Parameters Demo (LLM-Driven)
 *
 * Demonstrates agents autonomously adjusting their inference parameters based
 * on task complexity. The agent's LLM reasons about when to upgrade or downgrade
 * its own model capabilities - true metacognitive control.
 *
 * KEY DIFFERENCE: This demo does NOT use direct executeTool() calls.
 * Instead, the agent receives a task and autonomously decides which tools to use.
 *
 * @prerequisites
 * - MXF server running (`npm run dev`)
 * - Environment variables configured
 *
 * @example
 * ```bash
 * cd examples/inference-params-demo
 * cp .env.example .env
 * npx ts-node inference-params-demo.ts
 * ```
 *
 * Run with: npm run demo:inference-params
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `inference-params-demo-${timestamp}`
};

/**
 * Display demo banner
 */
const displayBanner = (): void => {
    console.log('\n' + '═'.repeat(80));
    console.log('🧠 DYNAMIC INFERENCE PARAMETERS DEMO (LLM-Driven)');
    console.log('═'.repeat(80));
    console.log('');
    console.log('This demo shows an agent with METACOGNITIVE awareness:');
    console.log('  • The agent receives problems of varying complexity');
    console.log('  • It autonomously decides when to upgrade its model (complex tasks)');
    console.log('  • It autonomously resets to defaults after complex work (save costs)');
    console.log('  • No hardcoded executeTool() calls - pure LLM reasoning');
    console.log('');
    console.log('Watch for:');
    console.log('  • [Tool Call] request_inference_params - upgrading for complex tasks');
    console.log('  • [Tool Call] reset_inference_params - returning to defaults');
    console.log('  • [Agent Thinking] - reasoning about parameter decisions');
    console.log('═'.repeat(80));
    console.log('');
};

/**
 * Setup channel monitoring for observing agent behavior
 * Returns a promise that resolves when task is completed
 */
const setupMonitoring = (channel: MxfChannelMonitor): Promise<void> => {
    return new Promise((resolve) => {
        // Track messages to prevent duplicates
        const processedIds = new Set<string>();
        let taskCompleted = false;

        // Listen for agent messages (thinking/responses)
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
                    // Truncate long messages for readability
                    const displayContent = content.length > 500
                        ? content.substring(0, 500) + '...'
                        : content;
                    console.log(`\n[Agent Response]\n${displayContent}\n`);
                }
            } catch (error) {
                // Silent fail
            }
        });

        // Listen for tool calls - this is where we see the metacognitive decisions
        // Use Events.Mcp.TOOL_CALL (public event) instead of Events.Agent.TOOL_CALL
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Highlight parameter-related tool calls
            if (toolName.includes('inference_params') || toolName.includes('_params')) {
                console.log(`\n${'─'.repeat(60)}`);
                console.log(`🔧 [Tool Call] ${toolName}`);
                if (args.reason) {
                    console.log(`   Reason: ${args.reason}`);
                }
                if (args.suggested) {
                    console.log(`   Suggested: ${JSON.stringify(args.suggested, null, 2).split('\n').join('\n   ')}`);
                }
                if (args.scope) {
                    console.log(`   Scope: ${args.scope}`);
                }
                console.log(`${'─'.repeat(60)}\n`);
            } else {
                console.log(`[Tool Call] ${toolName}: ${JSON.stringify(args)}`);
            }
        });

        // Listen for tool results
        // Use Events.Mcp.TOOL_RESULT (public event) instead of Events.Agent.TOOL_RESULT
        channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
            const toolName = payload.data?.toolName || 'unknown';
            const result = payload.data?.result;
            const data = result?.data;

            // Different inference parameter tools have different success indicators:
            // - request_inference_params: status === 'approved'
            // - reset_inference_params: success === true
            // - get_current_params: currentParams exists (no error field)
            // - get_parameter_status/get_available_models: data exists without error
            let isSuccess = false;
            if (toolName === 'request_inference_params') {
                isSuccess = data?.status === 'approved';
            } else if (toolName === 'reset_inference_params') {
                isSuccess = data?.success === true;
            } else if (toolName === 'get_current_params') {
                isSuccess = data?.currentParams !== undefined && !data?.error;
            } else if (toolName.includes('_params')) {
                // Other param tools: success if data exists without error
                isSuccess = data !== undefined && !data?.error;
            }

            if (toolName.includes('inference_params') || toolName.includes('_params')) {
                console.log(`[Tool Result] ${toolName}: ${isSuccess ? '✅ Success' : '❌ Failed'}`);
            }
        });

        // Listen for task completion - resolve promise when task completes
        channel.on(Events.Task.COMPLETED, (payload: any) => {
            if (taskCompleted) return; // Prevent duplicate handling
            taskCompleted = true;

            console.log(`\n${'═'.repeat(60)}`);
            console.log('✅ [Task Completed]');
            if (payload.data?.summary) {
                console.log(`Summary: ${payload.data.summary}`);
            }
            console.log(`${'═'.repeat(60)}\n`);

            // Give a moment for any final logs, then resolve
            setTimeout(() => resolve(), 1000);
        });

        // Listen for LLM responses (optional - shows internal thinking)
        channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
            const response = payload.data?.content || payload.data || '';
            if (response && typeof response === 'string' && response.length > 0 && response.length < 300) {
                console.log(`💭 [Agent Thinking] ${response}`);
            }
        });
    });
};

/**
 * Create the metacognitive agent with inference parameter tools
 */
const createMetacognitiveAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'MetacognitiveAgent',
        name: 'Metacognitive Problem Solver',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'An agent that adapts its own inference parameters based on task complexity',

        // LLM configuration - starts with a budget model
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-haiku',
        temperature: 0.5,
        maxTokens: 8000,

        // Tools the agent can use - these enable metacognitive control
        allowedTools: [
            // Inference parameter tools - for metacognitive control
            'request_inference_params',   // Request better model/settings
            'get_current_params',         // Check current configuration
            'get_parameter_status',       // View active overrides
            'get_available_models',       // List models by tier
            'reset_inference_params',     // Return to defaults
            // Task tools
            'task_complete',              // Mark task complete
            // Utility tools for solving problems
            'code_execute'                // Execute code to solve problems
        ],

        // Agent behavior prompt - instructs the agent on metacognitive behavior
        agentConfigPrompt: `You are a metacognitive agent that solves problems while managing your own inference parameters.

## AVAILABLE TOOLS

### Inference Parameter Tools (Metacognitive Control)
- **get_current_params**: Check your current LLM settings for a specific ORPAR phase
  - Parameters: phase (required: 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection')
  - Use phase='reasoning' to check parameters for complex reasoning tasks
- **request_inference_params**: Request a more capable model for complex tasks
  - Parameters: reason (why you need it), suggested (model, temperature, reasoningTokens, maxOutputTokens), scope (task|session|next_call)
- **get_parameter_status**: View any active parameter overrides (no parameters needed)
- **reset_inference_params**: Return to default settings after complex work
  - Parameters: scope (all|session|task)
- **get_available_models**: List available models by tier (budget|standard|premium)

### Task Tools
- **task_complete**: Mark the task as completed with a summary
- **code_execute**: Execute code to verify calculations

## METACOGNITIVE WORKFLOW

For each problem you encounter:

1. **ASSESS COMPLEXITY** - Before solving, evaluate:
   - SIMPLE (arithmetic, lookups, factual): Use current settings
   - COMPLEX (multi-step reasoning, architecture, deep analysis): Upgrade first

2. **ADJUST PARAMETERS** (for complex tasks only):
   - Call get_current_params with phase="reasoning" to see your current model
   - Call request_inference_params with:
     - reason: Explain why this task needs better capabilities
     - suggested: { model: "anthropic/claude-3.5-sonnet", reasoningTokens: 4000, maxOutputTokens: 4000 }
     - scope: "task"

3. **SOLVE THE PROBLEM** - Apply your reasoning

4. **RESET AFTER COMPLEX WORK** - Call reset_inference_params to save costs

5. **DOCUMENT YOUR DECISIONS** - Always explain WHY you're adjusting parameters

## COST AWARENESS
- Budget models (haiku): ~$0.0025/1k tokens - use for simple tasks
- Standard models (sonnet): ~$0.015/1k tokens - use for complex tasks
- Resetting after complex work prevents unnecessary costs

## IMPORTANT
- Start by checking your current parameters
- Only upgrade for genuinely complex tasks
- Always reset after complex reasoning to save costs
- Explain your metacognitive decisions as you work
- Call task_complete when all problems are solved`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the main task for the agent
 */
const createProblemSolvingTask = async (agent: MxfAgent): Promise<string> => {
    console.log('📋 Creating problem-solving task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'Solve Problems with Adaptive Inference Parameters',
        description: `# Metacognitive Problem-Solving Task

You will solve problems of varying complexity. For each problem:
1. Assess its complexity (simple vs complex)
2. Decide whether to adjust your inference parameters
3. Solve the problem
4. Reset parameters after complex work

## Problems to Solve

### Problem 1: SIMPLE - Basic Arithmetic
Calculate 15% of 200, then add 42.

### Problem 2: COMPLEX - System Architecture
Design a microservices architecture for an e-commerce platform with:
- Inventory management (track stock, handle reservations)
- Order processing (cart, checkout, payment integration)
- Notification service (email, SMS, push notifications)
- User authentication (OAuth2, session management)

Consider: fault tolerance, scalability, data consistency, inter-service communication.
Provide a detailed architecture with service boundaries and communication patterns.

### Problem 3: SIMPLE - Prime Numbers
List all prime numbers between 10 and 30.

### Problem 4: COMPLEX - Database Comparison
Provide a comprehensive comparison of SQL vs NoSQL databases:
- When to choose each approach
- Specific use cases with examples
- Performance characteristics
- Scalability considerations
- Data consistency trade-offs
- Real-world scenarios where each excels

## Requirements

- Start by checking your current inference parameters
- For SIMPLE problems: solve directly with current settings
- For COMPLEX problems: request_inference_params BEFORE attempting to solve
- After each COMPLEX problem: reset_inference_params to save costs
- Explain your parameter decisions as you work
- Call task_complete when done with a summary of your parameter decisions

## Expected Behavior

Your tool usage should look something like:
1. get_current_params(phase="reasoning") - check starting configuration
2. [Solve Problem 1 - simple, no upgrade needed]
3. request_inference_params - upgrade for Problem 2
4. [Solve Problem 2 - complex architecture]
5. reset_inference_params - back to defaults
6. [Solve Problem 3 - simple, no upgrade needed]
7. request_inference_params - upgrade for Problem 4
8. [Solve Problem 4 - complex comparison]
9. reset_inference_params - back to defaults
10. task_complete - summarize parameter decisions`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['MetacognitiveAgent'],
        completionAgentId: 'MetacognitiveAgent',
        priority: 'high',
        tags: ['inference-params', 'metacognitive', 'demo'],
        metadata: {
            demo: 'inference-params',
            scenario: 'adaptive-reasoning'
        }
    });

    console.log(`✅ Task created: ${taskId}\n`);
    console.log('🧠 Agent is now working autonomously...\n');
    console.log('Watch for tool calls showing metacognitive decisions:\n');

    return taskId;
};

// Cleanup state - module level for signal handler access
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
 * Cleanup function - can be called from finally block or signal handlers
 */
async function cleanup(): Promise<void> {
    if (cleanupState.cleanupDone) return;
    cleanupState.cleanupDone = true;

    console.log('\n🧹 Cleaning up...');

    // Disconnect agent first
    if (cleanupState.agent) {
        await cleanupState.agent.disconnect().catch(() => {});
    }

    // Delete agent memory via API (must be done before channel deletion)
    if (cleanupState.credentials) {
        console.log('Deleting agent memory...');
        await fetch(`${config.serverUrl}/api/agents/MetacognitiveAgent/memory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        // Delete channel via API (also deletes channel memory)
        console.log('Deleting channel...');
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

    console.log('✅ Cleanup complete');
}

// Handle Ctrl+C and termination signals
process.on('SIGINT', async () => {
    console.log('\n⚠️  Interrupted (Ctrl+C)');
    await cleanup();
    process.exit(130);
});

process.on('SIGTERM', async () => {
    console.log('\n⚠️  Terminated');
    await cleanup();
    process.exit(143);
});

/**
 * Main demo function
 */
async function demo() {
    displayBanner();

    console.log('🚀 Initializing MxfSDK...\n');

    // Create SDK with Personal Access Token authentication (REQUIRED)
    const accessToken = process.env.MXF_DEMO_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('❌ MXF_DEMO_ACCESS_TOKEN is required. Run: bun run server:cli -- demo:setup');
        process.exit(1);
    }

    const sdk = new MxfSDK({
        serverUrl: config.serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY!,
        accessToken: accessToken
    });

    // Store SDK reference for signal handler cleanup
    cleanupState.sdk = sdk;

    try {
        await sdk.connect();
        console.log('✅ SDK connected\n');

        // Create channel
        console.log('📡 Creating demo channel...');
        const channel = await sdk.createChannel(config.channelId, {
            name: 'Inference Parameters Demo Channel',
            description: 'Demonstrating LLM-driven dynamic inference parameters',
            systemLlmEnabled: false  // Disable SystemLLM - this demo tests agent's own metacognitive decisions
        });
        console.log(`✅ Channel created: ${config.channelId}\n`);

        // Setup monitoring - returns promise that resolves on task completion
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('🔑 Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'Metacognitive Agent Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('✅ Keys generated\n');

        // Create agent
        console.log('🤖 Creating metacognitive agent...');
        const agent = await createMetacognitiveAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('✅ Agent ready\n');

        // Create the task - agent will work autonomously from here
        await createProblemSolvingTask(agent);

        // Wait for agent to work (with timeout)
        // The agent will autonomously:
        // 1. Check current params
        // 2. Assess each problem's complexity
        // 3. Upgrade params for complex problems
        // 4. Solve problems
        // 5. Reset params after complex work
        // 6. Call task_complete when done
        console.log('⏳ Waiting for agent to complete (exits on task_complete, max 3 minutes)...\n');
        console.log('─'.repeat(60) + '\n');

        // Race between task completion and timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\n⚠️  Timeout reached (3 minutes) - exiting demo');
                resolve();
            }, 180000);
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

        console.log('\n' + '═'.repeat(80));
        console.log('Demo Complete');
        console.log('═'.repeat(80));

        console.log('\nKey Takeaways:');
        console.log('  • The agent autonomously decided when to upgrade parameters');
        console.log('  • No hardcoded tool calls - pure LLM reasoning');
        console.log('  • Metacognitive awareness enables cost-effective operation');
        console.log('  • Complex tasks got powerful models, simple tasks used budget models');

    } catch (error) {
        console.error('\n❌ Demo failed:', error);
        throw error;
    } finally {
        await cleanup();
    }
}

// Run demo
demo()
    .then(() => {
        console.log('\n🎬 Demo completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Demo failed:', error);
        process.exit(1);
    });

export { demo };
