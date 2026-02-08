/**
 * DAG (Directed Acyclic Graph) System Demo
 *
 * This demo is FULLY AGENTIC - the agent autonomously:
 * 1. Creates tasks with a diamond dependency pattern (A→B, A→C, B→D, C→D, D→E)
 * 2. Uses DAG tools to analyze the task dependency graph
 * 3. Validates cycle detection
 * 4. Reports execution order, parallel groups, and critical path
 *
 * All DAG operations happen through actual tool calls - no local simulation.
 *
 * @prerequisites
 * - MXF server running with TASK_DAG_ENABLED=true
 * - Environment variables configured (see .env.example)
 *
 * @example
 * ```bash
 * # Start server with DAG enabled
 * TASK_DAG_ENABLED=true bun run dev
 *
 * # In another terminal, run demo
 * bun run demo:dag
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
    channelId: `dag-demo-${timestamp}`
};

/**
 * Display demo banner
 */
const displayBanner = (): void => {
    console.log('\n' + '='.repeat(70));
    console.log('TASK DAG (Directed Acyclic Graph) - AGENTIC DEMO');
    console.log('='.repeat(70));
    console.log('');
    console.log('This demo shows an agent AUTONOMOUSLY demonstrating the DAG system:');
    console.log('');
    console.log('  1. Create 5 tasks with diamond dependency pattern:');
    console.log('         A (Design API)');
    console.log('        / \\');
    console.log('       B   C  (Backend, Docs)');
    console.log('        \\ /');
    console.log('         D    (Integration Test)');
    console.log('         |');
    console.log('         E    (Deploy)');
    console.log('');
    console.log('  2. Analyze the DAG using these tools:');
    console.log('     - dag_get_ready_tasks: Find tasks ready to execute');
    console.log('     - dag_get_execution_order: Topological sort');
    console.log('     - dag_get_parallel_groups: Find parallelizable tasks');
    console.log('     - dag_get_critical_path: Longest dependency chain');
    console.log('     - dag_get_blocking_tasks: What blocks a specific task');
    console.log('     - dag_validate_dependency: Test for cycles');
    console.log('     - dag_get_stats: Overall DAG metrics');
    console.log('');
    console.log('Watch for:');
    console.log('  - [Agent Thinking] The LLM\'s reasoning process');
    console.log('  - [DAG Tool Call] Tool calls with arguments');
    console.log('  - [DAG Result] Analysis results');
    console.log('='.repeat(70));
    console.log('');
};

/**
 * Setup channel monitoring for tool calls, messages, and LLM thinking
 */
const setupMonitoring = (channel: MxfChannelMonitor): Promise<void> => {
    return new Promise((resolve) => {
        const processedIds = new Set<string>();
        const processedToolCalls = new Set<string>();
        const processedToolResults = new Set<string>();
        let taskCompleted = false;

        // Listen for LLM reasoning/thinking
        channel.on(Events.Agent.LLM_REASONING, (payload: any) => {
            const reasoning = payload.data?.reasoning || payload.data?.content || payload.data || '';
            if (reasoning && typeof reasoning === 'string' && reasoning.length > 0) {
                console.log(`\n${'─'.repeat(70)}`);
                console.log('[Agent Thinking]');
                console.log('─'.repeat(70));
                console.log(reasoning);
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
                console.log(response);
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
                    console.log(`\n[Agent Broadcast Message]\n${content}\n`);
                }
            } catch (error) {
                // Silent fail
            }
        });

        // Listen for tool calls (with deduplication)
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const callId = payload.data?.callId || payload.eventId || '';
            if (callId && processedToolCalls.has(callId)) {
                return;
            }
            if (callId) {
                processedToolCalls.add(callId);
                setTimeout(() => processedToolCalls.delete(callId), 5000);
            }

            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Highlight DAG-related tool calls
            const dagTools = [
                'dag_get_ready_tasks',
                'dag_validate_dependency',
                'dag_get_execution_order',
                'dag_get_blocking_tasks',
                'dag_get_parallel_groups',
                'dag_get_critical_path',
                'dag_get_stats',
                'task_create',
                'task_update'
            ];

            if (dagTools.includes(toolName)) {
                console.log(`\n${'='.repeat(50)}`);
                console.log(`[DAG Tool Call] ${toolName}`);
                console.log(`${'='.repeat(50)}`);

                // Pretty print relevant args
                if (toolName === 'task_create') {
                    console.log(`  Title: ${args.title}`);
                    console.log(`  Description: ${args.description}`);
                    if (args.dependsOn) {
                        console.log(`  Depends On: ${JSON.stringify(args.dependsOn)}`);
                    }
                } else if (toolName === 'task_update') {
                    console.log(`  Task ID: ${args.taskId}`);
                    if (args.dependsOn) {
                        console.log(`  Adding Dependencies: ${JSON.stringify(args.dependsOn)}`);
                    }
                } else if (toolName === 'dag_validate_dependency') {
                    console.log(`  Dependent Task: ${args.dependentTaskId}`);
                    console.log(`  Would Depend On: ${args.dependencyTaskId}`);
                } else if (toolName === 'dag_get_blocking_tasks') {
                    console.log(`  Checking Task: ${args.taskId}`);
                } else {
                    console.log(`  Args: ${JSON.stringify(args, null, 2)}`);
                }
            } else if (toolName === 'task_complete') {
                console.log(`\n[Task Complete] ${args.summary || 'Demo finished'}`);
            }
        });

        // Listen for tool results (with deduplication)
        channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
            const callId = payload.data?.callId || payload.eventId || '';
            if (callId && processedToolResults.has(callId)) {
                return;
            }
            if (callId) {
                processedToolResults.add(callId);
                setTimeout(() => processedToolResults.delete(callId), 5000);
            }

            const toolName = payload.data?.toolName || 'unknown';
            // Try multiple paths to find the result data
            let result = payload.data?.result || payload.data?.content || payload.result || {};

            // If result has a nested content array (MCP format), extract it
            if (Array.isArray(result?.content)) {
                const textContent = result.content.find((c: any) => c.type === 'text');
                if (textContent?.text) {
                    try {
                        result = JSON.parse(textContent.text);
                    } catch {
                        result = { message: textContent.text };
                    }
                }
            }

            // Helper to unwrap McpToolResultContent
            // Handles MCP result format: { type: 'text'|'application/json', data: ... }
            const unwrapResult = (rawResult: any): any => {
                if (typeof rawResult === 'string') {
                    try {
                        return JSON.parse(rawResult);
                    } catch {
                        return rawResult;
                    }
                }
                if (rawResult && typeof rawResult === 'object' && rawResult.data !== undefined) {
                    if (typeof rawResult.data === 'string') {
                        try {
                            return JSON.parse(rawResult.data);
                        } catch {
                            return rawResult.data;
                        }
                    }
                    return rawResult.data;
                }
                return rawResult;
            };

            // Show DAG tool results
            if (toolName === 'dag_get_ready_tasks') {
                console.log(`\n[DAG Result - Ready Tasks]`);
                try {
                    const data = unwrapResult(result);
                    if (data.success === false || data.enabled === false) {
                        console.log(`  DAG is DISABLED - enable with TASK_DAG_ENABLED=true`);
                    } else if (data.readyTasks) {
                        console.log(`  Ready Tasks: ${data.readyTasks.length}`);
                        data.readyTasks.forEach((t: any) => {
                            const display = typeof t === 'string' ? t : (t.title || t.id);
                            console.log(`    - ${display}`);
                        });
                        if (data.message) console.log(`  ${data.message}`);
                    } else {
                        console.log(`  Message: ${data.message || 'No ready tasks'}`);
                        console.log(`  Count: ${data.count ?? 'N/A'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'dag_get_execution_order') {
                console.log(`\n[DAG Result - Execution Order]`);
                try {
                    const data = unwrapResult(result);
                    if (data.executionOrder && data.executionOrder.length > 0) {
                        console.log(`  Topological Order (${data.executionOrder.length} tasks):`);
                        data.executionOrder.forEach((t: any, i: number) => {
                            const display = typeof t === 'string' ? t : (t.title || t.id);
                            console.log(`    ${i + 1}. ${display}`);
                        });
                    } else {
                        console.log(`  Message: ${data.message || 'No execution order'}`);
                        console.log(`  Count: ${data.count ?? 'N/A'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'dag_get_parallel_groups') {
                console.log(`\n[DAG Result - Parallel Groups]`);
                try {
                    const data = unwrapResult(result);
                    if (data.parallelGroups && data.parallelGroups.length > 0) {
                        console.log(`  ${data.parallelGroups.length} group(s) found:`);
                        data.parallelGroups.forEach((group: any, i: number) => {
                            const tasks = Array.isArray(group) ? group : (group.tasks || [group]);
                            const taskNames = tasks.map((t: any) => t.title || t.id || t).join(', ');
                            console.log(`    Group ${i + 1}: ${taskNames}`);
                        });
                    } else {
                        console.log(`  Message: ${data.message || 'No parallel groups'}`);
                        console.log(`  Group Count: ${data.groupCount ?? 'N/A'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'dag_get_critical_path') {
                console.log(`\n[DAG Result - Critical Path]`);
                try {
                    const data = unwrapResult(result);
                    if (data.criticalPath && data.criticalPath.length > 0) {
                        console.log(`  Critical Path Length: ${data.criticalPath.length}`);
                        console.log(`  Path: ${data.criticalPath.map((t: any) => t.title || t.id || t).join(' → ')}`);
                    } else {
                        console.log(`  Message: ${data.message || 'No critical path'}`);
                        console.log(`  Path Length: ${data.pathLength ?? 'N/A'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'dag_validate_dependency') {
                console.log(`\n[DAG Result - Dependency Validation]`);
                try {
                    const data = unwrapResult(result);
                    console.log(`  Valid: ${data.isValid ?? 'N/A'}`);
                    console.log(`  Message: ${data.message || 'No message'}`);
                    if (data.isValid === false && data.cyclePath) {
                        console.log(`  Cycle Detected: ${data.cyclePath.join(' → ')}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'dag_get_blocking_tasks') {
                console.log(`\n[DAG Result - Blocking Tasks]`);
                try {
                    const data = unwrapResult(result);
                    console.log(`  Is Ready: ${data.isReady ?? 'N/A'}`);
                    console.log(`  Message: ${data.message || 'No message'}`);
                    if (data.blockingTasks && data.blockingTasks.length > 0) {
                        console.log(`  Blocked By:`);
                        data.blockingTasks.forEach((t: any) => {
                            console.log(`    - ${t.title || t.id || t}`);
                        });
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'dag_get_stats') {
                console.log(`\n[DAG Result - Statistics]`);
                try {
                    const data = unwrapResult(result);
                    if (data.stats) {
                        console.log(`  Node Count: ${data.stats.nodeCount}`);
                        console.log(`  Edge Count: ${data.stats.edgeCount}`);
                        console.log(`  Max Depth: ${data.stats.maxDepth}`);
                        console.log(`  Ready Tasks: ${data.stats.readyTaskCount}`);
                        console.log(`  Blocked Tasks: ${data.stats.blockedTaskCount}`);
                        console.log(`  Completed Tasks: ${data.stats.completedTaskCount}`);
                    } else if (data.summary) {
                        console.log(`  Nodes: ${data.summary.nodes}`);
                        console.log(`  Edges: ${data.summary.edges}`);
                        console.log(`  Ready: ${data.summary.ready}`);
                        console.log(`  Blocked: ${data.summary.blocked}`);
                        console.log(`  Depth: ${data.summary.depth}`);
                    } else {
                        console.log(`  Message: ${data.message || 'No stats available'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'task_create') {
                console.log(`\n[Task Created]`);
                try {
                    const data = unwrapResult(result);
                    if (data.task) {
                        console.log(`  ID: ${data.task.id}`);
                        console.log(`  Title: ${data.task.title}`);
                    } else {
                        console.log(`  Message: ${data.message || JSON.stringify(data)}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
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
 * Create the DAG demonstration agent
 */
const createDagAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'DagDemoAgent',
        name: 'DAG Demonstration Agent',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'Agent demonstrating Task DAG system through actual tool calls',

        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.3,
        maxTokens: 4000,
        maxIterations: 30, // Enough for creating tasks and running DAG analysis

        // Tools for the DAG demonstration
        allowedTools: [
            // Task operations
            'task_create',
            'task_update',
            // DAG analysis tools
            'dag_get_ready_tasks',
            'dag_validate_dependency',
            'dag_get_execution_order',
            'dag_get_blocking_tasks',
            'dag_get_parallel_groups',
            'dag_get_critical_path',
            'dag_get_stats',
            // Task completion
            'task_complete'
        ],

        agentConfigPrompt: `You are demonstrating the Task DAG (Directed Acyclic Graph) system.

## YOUR MISSION

Execute a complete DAG demonstration by performing these steps IN ORDER:

### STEP 1: Create Diamond Pattern Tasks (SEQUENTIAL - Order Matters)

Create 5 tasks one at a time. Each task returns a task ID that you MUST use
for subsequent dependencies.

IMPORTANT: Do NOT pass the "assignTo" parameter when creating tasks.
These tasks are for DAG dependency tracking, not for delegation to other agents.
Only pass title, description, and dependsOn.

1. Create Task A: "Design API Schema"
   - No dependsOn (root task)
   - SAVE the returned task ID as ID_A

2. Create Task B: "Implement Backend"
   - dependsOn: [ID_A]
   - SAVE the returned task ID as ID_B

3. Create Task C: "Write Documentation"
   - dependsOn: [ID_A]
   - SAVE the returned task ID as ID_C

4. Create Task D: "Integration Testing"
   - dependsOn: [ID_B, ID_C]
   - SAVE the returned task ID as ID_D

5. Create Task E: "Deploy to Production"
   - dependsOn: [ID_D]

You MUST pass the dependsOn parameter to task_create for tasks B through E.
Each dependsOn value is an array of task ID strings from previous create results.

### STEP 2: Verify Initial DAG State
Use dag_get_ready_tasks to verify only Task A is ready initially (no dependencies blocking it).

### STEP 3: Get Execution Order
Use dag_get_execution_order to get the topological sort of all tasks.
This shows the valid order to execute tasks respecting dependencies.

### STEP 4: Find Parallel Groups
Use dag_get_parallel_groups to identify which tasks can run in parallel.
Tasks B and C should be able to run in parallel (both only depend on A).

### STEP 5: Find Critical Path
Use dag_get_critical_path to find the longest dependency chain.
This represents the minimum time to complete all tasks.

### STEP 6: Check Blocking Tasks
Use dag_get_blocking_tasks to see what blocks Task D.
It should show B and C as blocking tasks.

### STEP 7: Test Cycle Detection
Use dag_validate_dependency to verify that adding E→A would create a cycle.
- dependentTaskId: Task A's ID
- dependencyTaskId: Task E's ID
Report the cycle path if detected.

### STEP 8: Get DAG Statistics
Use dag_get_stats to show overall DAG metrics like node count, edge count, depth.

### STEP 9: Complete
Call task_complete with a summary including:
- Number of tasks created
- The execution order
- Which tasks can run in parallel
- The critical path
- Cycle detection result

## IMPORTANT RULES
- Execute ALL steps in order
- Store task IDs as you create them
- Use the EXACT task titles specified
- Do NOT pass assignTo when creating tasks - these are for dependency tracking only
- Show your work by explaining what each tool call does
- If DAG is disabled, explain how to enable it (TASK_DAG_ENABLED=true)`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the DAG demonstration task
 */
const createDagTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating DAG demonstration task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'DAG End-to-End Demonstration',
        description: `# Task DAG System Demo

Demonstrate the DAG system by creating a dependency graph and analyzing it.

## Step 1: Create Task Network (SEQUENTIAL - Order Matters)
Create 5 tasks ONE AT A TIME with this dependency structure (diamond pattern).
Each task_create call returns a task ID. You MUST pass that ID in the dependsOn
parameter of subsequent tasks.

IMPORTANT: Do NOT pass "assignTo" when creating tasks. These tasks are for
DAG dependency tracking only, not for delegation.

1. Task A: "Design API Schema" - no dependsOn (root task) → save ID as ID_A
2. Task B: "Implement Backend" - dependsOn: [ID_A] → save ID as ID_B
3. Task C: "Write Documentation" - dependsOn: [ID_A] → save ID as ID_C
4. Task D: "Integration Testing" - dependsOn: [ID_B, ID_C] → save ID as ID_D
5. Task E: "Deploy to Production" - dependsOn: [ID_D]

You MUST pass the dependsOn array parameter to task_create for tasks B-E.

## Step 2: Analyze DAG Structure
Use DAG tools to analyze the task graph:
1. dag_get_ready_tasks - Should show only Task A is ready
2. dag_get_execution_order - Get the topological sort
3. dag_get_parallel_groups - Should show B and C can run in parallel
4. dag_get_critical_path - Find the longest chain
5. dag_get_blocking_tasks for Task D - Should show B and C blocking
6. dag_get_stats - Show overall DAG metrics

## Step 3: Test Cycle Detection
Use dag_validate_dependency to verify that adding E→A would create a cycle.
Report the cycle path if detected.

## Step 4: Complete
Call task_complete with a summary of:
- How many tasks created
- The execution order
- Which tasks can run in parallel
- The critical path length
- Cycle detection result`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['DagDemoAgent'],
        completionAgentId: 'DagDemoAgent',
        priority: 'high',
        tags: ['dag', 'demo', 'agentic'],
        metadata: {
            demo: 'dag',
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
        // Delete agent registration and its AgentMemory documents
        await fetch(`${config.serverUrl}/api/agents/DagDemoAgent`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        // Delete agent memory from MemoryPersistenceService
        await fetch(`${config.serverUrl}/api/agents/DagDemoAgent/memory`, {
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

    cleanupState.sdk = sdk;

    try {
        await sdk.connect();
        console.log('SDK connected\n');

        // Create channel
        console.log('Creating demo channel...');
        const channel = await sdk.createChannel(config.channelId, {
            name: 'DAG Demo Channel',
            description: 'Demonstrating Task DAG system',
            systemLlmEnabled: false
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'DAG Agent Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Create agent
        console.log('Creating DAG demonstration agent...');
        const agent = await createDagAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create task
        await createDagTask(agent);

        console.log('Agent is now executing the DAG demonstration...');
        console.log('Watch for [DAG Tool Call] messages below.\n');
        console.log('-'.repeat(70) + '\n');

        // Wait for completion with timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (4 minutes) - the agent may still be working');
                resolve();
            }, 240000); // 4 minutes for full demo
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

    } catch (error) {
        console.error('\nDemo failed:', error);
        console.log('\nTroubleshooting:');
        console.log('  1. Ensure MXF server is running: bun run dev');
        console.log('  2. Enable DAG: TASK_DAG_ENABLED=true bun run dev');
        console.log('  3. Check OPENROUTER_API_KEY is set');
    } finally {
        await cleanup();
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('DAG DEMO SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log('What was demonstrated:');
    console.log('  - Task creation with dependencies via task_create');
    console.log('  - Ready task detection via dag_get_ready_tasks');
    console.log('  - Topological sorting via dag_get_execution_order');
    console.log('  - Parallel execution groups via dag_get_parallel_groups');
    console.log('  - Critical path analysis via dag_get_critical_path');
    console.log('  - Blocking task identification via dag_get_blocking_tasks');
    console.log('  - Cycle detection via dag_validate_dependency');
    console.log('  - DAG metrics via dag_get_stats');
    console.log('');
    console.log('Key DAG Concepts:');
    console.log('  - Topological Sort: Valid execution order respecting dependencies');
    console.log('  - Critical Path: Longest chain determining minimum completion time');
    console.log('  - Parallel Groups: Tasks that can execute simultaneously');
    console.log('  - Cycle Detection: Prevents circular dependencies');
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
