/**
 * Workflow Patterns Demo (Agentic Flow)
 *
 * Demonstrates an agent AUTONOMOUSLY analyzing workflow patterns and deciding
 * which execution pattern (Sequential, Parallel, or Loop) best fits each use case.
 *
 * KEY DIFFERENCE: This demo does NOT execute all three patterns blindly.
 * Instead, the agent receives workflow definitions and autonomously:
 * - Analyzes step dependencies
 * - Reasons about pattern suitability
 * - Recommends the optimal pattern for each workflow
 * - Explains its rationale
 *
 * @prerequisites
 * - MXF server running (`npm run dev`)
 * - Environment variables configured
 *
 * @example
 * ```bash
 * cd examples/workflow-patterns-demo
 * cp .env.example .env
 * npx ts-node workflow-patterns-demo.ts
 * ```
 *
 * Run with: npm run demo:workflow-patterns
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `workflow-patterns-demo-${timestamp}`
};

/**
 * Display demo banner explaining what the demo demonstrates
 */
const displayBanner = (): void => {
    console.log('\n' + '═'.repeat(80));
    console.log('WORKFLOW PATTERNS DEMO (Agentic Flow)');
    console.log('═'.repeat(80));
    console.log('');
    console.log('This demo shows an agent AUTONOMOUSLY analyzing workflow patterns:');
    console.log('  - The agent receives workflow definitions');
    console.log('  - It reasons about which pattern fits each use case');
    console.log('  - No hardcoded decisions - pure LLM reasoning');
    console.log('');
    console.log('Available Workflow Patterns:');
    console.log('  - Sequential : Steps execute one after another (dependencies)');
    console.log('  - Parallel   : Independent steps run concurrently (faster)');
    console.log('  - Loop       : Steps repeat until condition met (optimization)');
    console.log('');
    console.log('Watch for:');
    console.log('  - [Agent Thinking] Analyzing step dependencies...');
    console.log('  - [Tool Call] planning_create - Creating analysis plan');
    console.log('  - [Tool Call] tools_recommend - Discovering analysis tools');
    console.log('  - [Agent Decision] Workflow A → Sequential (dependencies)');
    console.log('  - [Agent Decision] Workflow B → Parallel (independent steps)');
    console.log('  - [Agent Decision] Workflow C → Loop (quality threshold)');
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
                    // Look for pattern decisions in the response
                    const patterns = ['Sequential', 'Parallel', 'Loop'];
                    const workflows = ['Workflow A', 'Workflow B', 'Workflow C', 'Document Processing', 'Multi-Source', 'Optimization'];

                    let hasDecision = false;
                    for (const pattern of patterns) {
                        for (const workflow of workflows) {
                            if (content.includes(pattern) && content.includes(workflow)) {
                                hasDecision = true;
                                break;
                            }
                        }
                    }

                    if (hasDecision) {
                        console.log(`\n${'─'.repeat(60)}`);
                        console.log('[Agent Decision]');
                        // Truncate for readability
                        const displayContent = content.length > 800
                            ? content.substring(0, 800) + '...'
                            : content;
                        console.log(displayContent);
                        console.log(`${'─'.repeat(60)}\n`);
                    } else {
                        // Regular response - truncate long messages
                        const displayContent = content.length > 500
                            ? content.substring(0, 500) + '...'
                            : content;
                        console.log(`\n[Agent Response]\n${displayContent}\n`);
                    }
                }
            } catch (error) {
                // Silent fail
            }
        });

        // Listen for tool calls - this is where we see the agent's analysis approach
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Highlight workflow analysis tool calls
            const analysisTools = [
                'tools_recommend', 'planning_create', 'analyze_codebase',
                'task_complete', 'planning_update_item', 'planning_view'
            ];

            if (analysisTools.includes(toolName)) {
                console.log(`\n${'─'.repeat(60)}`);
                console.log(`[Tool Call] ${toolName}`);
                if (args.intent) {
                    console.log(`   Intent: ${args.intent}`);
                }
                if (args.name) {
                    console.log(`   Plan Name: ${args.name}`);
                }
                if (args.description) {
                    console.log(`   Description: ${args.description.substring(0, 100)}...`);
                }
                if (args.items && Array.isArray(args.items)) {
                    console.log(`   Steps: ${args.items.length} items`);
                }
                if (args.summary) {
                    console.log(`   Summary: ${args.summary.substring(0, 150)}...`);
                }
                console.log(`${'─'.repeat(60)}\n`);
            } else {
                console.log(`[Tool Call] ${toolName}: ${JSON.stringify(args).substring(0, 100)}`);
            }
        });

        // Listen for tool results
        channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
            const toolName = payload.data?.toolName || 'unknown';
            const result = payload.data?.result;
            const data = result?.data;

            // Determine success based on tool result
            const isSuccess = data?.success === true || (data && !data?.error);

            // Log analysis tool results
            const analysisTools = [
                'tools_recommend', 'planning_create', 'planning_update_item'
            ];

            if (analysisTools.includes(toolName)) {
                const statusIcon = isSuccess ? 'Success' : 'Failed';
                let details = '';

                if (toolName === 'tools_recommend' && data?.recommendations) {
                    details = ` - ${data.recommendations.length} tools recommended`;
                } else if (toolName === 'planning_create' && data?.planId) {
                    details = ` - Plan created: ${data.planId}`;
                }

                console.log(`[Tool Result] ${toolName}: ${statusIcon}${details}`);
            }
        });

        // Listen for task completion - resolve promise when task completes
        channel.on(Events.Task.COMPLETED, (payload: any) => {
            if (taskCompleted) return; // Prevent duplicate handling
            taskCompleted = true;

            console.log(`\n${'═'.repeat(60)}`);
            console.log('[Task Completed]');
            if (payload.data?.summary) {
                console.log(`Summary: ${payload.data.summary}`);
            }
            console.log(`${'═'.repeat(60)}\n`);

            // Give a moment for any final logs, then resolve
            setTimeout(() => resolve(), 1000);
        });

        // Listen for LLM responses (shows internal thinking)
        channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
            const response = payload.data?.content || payload.data || '';
            if (response && typeof response === 'string' && response.length > 0 && response.length < 400) {
                // Check for workflow-related thinking
                const keywords = ['sequential', 'parallel', 'loop', 'depend', 'independent', 'iteration', 'threshold'];
                const hasKeyword = keywords.some(k => response.toLowerCase().includes(k));
                if (hasKeyword) {
                    console.log(`[Agent Thinking] ${response}`);
                }
            }
        });
    });
};

/**
 * Create the workflow analysis agent with detailed prompt
 */
const createWorkflowAnalysisAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'WorkflowPatternAnalyst',
        name: 'Workflow Pattern Analyst',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'An agent that analyzes workflow definitions and recommends optimal execution patterns',

        // LLM configuration
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.3,
        maxTokens: 8000,

        // Tools available to the agent for analysis
        allowedTools: [
            // Tool discovery
            'tools_recommend',

            // Analysis and planning
            'planning_create',
            'planning_update_item',
            'planning_view',

            // Task completion
            'task_complete'
        ],

        // Detailed agent behavior prompt - instructs the agent on workflow analysis
        agentConfigPrompt: `You are a Workflow Pattern Analyst. Your job is to analyze workflow requirements
and autonomously decide which execution pattern (Sequential, Parallel, or Loop)
best fits each use case.

## YOUR ROLE

You will receive workflow definitions that describe a series of steps. Your task is to:
1. Analyze the dependencies between steps
2. Identify the execution characteristics
3. Recommend the optimal pattern
4. Explain your rationale

## AVAILABLE WORKFLOW PATTERNS

### Pattern 1: Sequential
- **Best for**: Steps with strict dependencies, order-sensitive operations
- **Characteristics**:
  - One step must complete before the next begins
  - Output of step N is input to step N+1
  - Failure at any step stops the workflow
- **Indicators**:
  - "depends on", "requires output from", "after", "then"
  - Dependencies array shows chain: step2 depends on step1, step3 depends on step2, etc.
- **Example use cases**:
  - Document processing (validate → parse → transform → save)
  - Build pipelines (compile → test → package → deploy)
  - Data transformation (extract → transform → load)

### Pattern 2: Parallel
- **Best for**: Independent steps that can run concurrently
- **Characteristics**:
  - Steps have no dependencies on each other
  - All steps can start simultaneously
  - Results are merged at the end
- **Indicators**:
  - Empty dependencies array for multiple steps
  - Steps fetch from different sources
  - Only final step depends on all others
- **Example use cases**:
  - Multi-source data fetching (API1, API2, API3 all at once)
  - Concurrent file processing
  - Parallel test execution

### Pattern 3: Loop (Iterative)
- **Best for**: Quality improvement, refinement, optimization
- **Characteristics**:
  - Steps repeat until a threshold is met
  - Each iteration improves upon the previous
  - Has a maximum iteration limit
  - Includes a quality/convergence check
- **Indicators**:
  - "quality score", "threshold", "until", "max iterations"
  - Steps include "evaluate", "check", "measure"
  - Goal is to reach a target metric
- **Example use cases**:
  - ML model tuning (train → evaluate → adjust → repeat)
  - Content refinement (draft → review → improve → check)
  - Optimization (analyze → improve → measure → repeat)

## ANALYSIS METHODOLOGY

When analyzing a workflow, follow these steps:

### Step 1: Map Dependencies
For each step, identify:
- What it depends on (inputs required)
- What depends on it (outputs produced)
- Whether it's independent or chained

### Step 2: Identify Pattern Signals
Look for these signals:

**Sequential signals:**
- Each step has exactly one dependency (forming a chain)
- Steps are named with action words implying order (validate, then parse, then transform)
- Dependencies form a linear graph: A → B → C → D

**Parallel signals:**
- Multiple steps have zero dependencies
- Only the final step (merge/aggregate) depends on all others
- Dependencies form a fan-in pattern: (A, B, C, D) → E

**Loop signals:**
- Steps mention quality, threshold, score, or convergence
- There's an evaluation/measurement step
- A goal or target is specified (e.g., "quality >= 0.9")
- Maximum iterations are mentioned

### Step 3: Consider Edge Cases
- Hybrid patterns: Some workflows combine patterns (parallel fetch, then sequential process)
- Conditional branching: May need adaptive execution
- Error handling: Consider retry needs

### Step 4: Make Recommendation
For each workflow, state:
1. **Chosen Pattern**: Sequential, Parallel, or Loop
2. **Rationale**: Why this pattern fits (2-3 sentences)
3. **Key Insight**: The deciding factor (1 sentence)

## AVAILABLE TOOLS

### tools_recommend
- **Purpose**: Discover additional tools if needed for analysis
- **Input**: { intent: string, context?: string }
- **Use when**: You need capabilities beyond basic analysis

### planning_create
- **Purpose**: Create a structured analysis plan
- **Input**: { name: string, description: string, items: PlanItem[] }
- **Use when**: Organizing your analysis approach
- **PlanItem format**: { id: string, description: string, status: 'pending' }

### planning_update_item
- **Purpose**: Update the status of a specific plan item
- **Input**: { planId: string, itemId: string, status: 'pending'|'in_progress'|'completed'|'blocked' }
- **Use when**: Marking progress on your plan

### planning_view
- **Purpose**: View a plan and current status of all items
- **Input**: { planId?: string } (optional - shows all plans if not provided)
- **Use when**: Checking plan progress

### task_complete
- **Purpose**: Mark task complete with your findings
- **Input**: { summary: string, success: boolean, details?: object }
- **Use when**: You have analyzed all workflows and are ready to report

## YOUR WORKFLOW

1. **RECEIVE** the workflow definitions in your task
2. **ANALYZE** each workflow's dependency structure
3. **DETERMINE** the optimal pattern for each
4. **EXPLAIN** your reasoning clearly
5. **COMPLETE** the task with your recommendations

## OUTPUT FORMAT

When completing the task, structure your findings as:

\`\`\`
WORKFLOW PATTERN ANALYSIS RESULTS
================================

Workflow A: [Name]
  Pattern: [Sequential/Parallel/Loop]
  Rationale: [Why this pattern fits]
  Key Insight: [The deciding factor]

Workflow B: [Name]
  Pattern: [Sequential/Parallel/Loop]
  Rationale: [Why this pattern fits]
  Key Insight: [The deciding factor]

Workflow C: [Name]
  Pattern: [Sequential/Parallel/Loop]
  Rationale: [Why this pattern fits]
  Key Insight: [The deciding factor]

SUMMARY
=======
[Overall recommendations and insights]
\`\`\`

## IMPORTANT GUIDELINES

1. **Do NOT execute the workflows** - only analyze and recommend patterns
2. **Focus on dependency analysis** - this is the key to pattern selection
3. **Be specific** - reference actual step names and dependencies
4. **Consider trade-offs** - mention when multiple patterns could work
5. **Use task_complete** when done with all analysis`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the workflow analysis task for the agent
 */
const createWorkflowAnalysisTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating workflow analysis task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'Analyze Workflow Patterns',
        description: `# Workflow Pattern Analysis Task

You will analyze three workflow definitions and determine the optimal execution
pattern (Sequential, Parallel, or Loop) for each.

## WORKFLOW DEFINITIONS

### Workflow A: Document Processing Pipeline

**Steps:**
1. \`validate_format\` - Validate document format and structure
   - Dependencies: none
   - Purpose: Ensure document is valid before processing

2. \`extract_content\` - Extract text and metadata from document
   - Dependencies: [validate_format]
   - Purpose: Parse the validated document

3. \`transform_data\` - Transform extracted data to target format
   - Dependencies: [extract_content]
   - Purpose: Convert data for downstream use

4. \`generate_output\` - Generate final output document
   - Dependencies: [transform_data]
   - Purpose: Create the processed result

5. \`save_results\` - Persist results to storage
   - Dependencies: [generate_output]
   - Purpose: Store the final output

**Note:** Each step requires the previous step's output to function.

---

### Workflow B: Multi-Source Data Aggregation

**Steps:**
1. \`fetch_api_1\` - Fetch user data from User API
   - Dependencies: none
   - Duration: ~300ms

2. \`fetch_api_2\` - Fetch product data from Products API
   - Dependencies: none
   - Duration: ~250ms

3. \`fetch_database\` - Query order data from database
   - Dependencies: none
   - Duration: ~200ms

4. \`fetch_cache\` - Get cached analytics from Redis
   - Dependencies: none
   - Duration: ~50ms

5. \`fetch_file\` - Read configuration from file system
   - Dependencies: none
   - Duration: ~100ms

6. \`merge_results\` - Combine all data sources into unified response
   - Dependencies: [fetch_api_1, fetch_api_2, fetch_database, fetch_cache, fetch_file]
   - Purpose: Aggregate all fetched data

**Note:** First 5 steps are completely independent; only merge needs all results.

---

### Workflow C: Content Quality Optimization

**Steps:**
1. \`generate_draft\` - Generate initial content draft
   - Dependencies: none
   - Purpose: Create starting content

2. \`evaluate_quality\` - Evaluate current quality score (0-1)
   - Dependencies: [generate_draft] (first iteration) or [refine_content]
   - Purpose: Measure content quality

3. \`refine_content\` - Apply improvements based on evaluation
   - Dependencies: [evaluate_quality]
   - Purpose: Improve weak areas

4. \`check_threshold\` - Check if quality >= 0.9
   - Dependencies: [evaluate_quality]
   - Purpose: Determine if goal is met

**Configuration:**
- Target quality score: >= 0.9 (90%)
- Maximum iterations: 10
- Exit condition: quality threshold met OR max iterations reached

**Note:** Steps repeat until quality target is achieved or iteration limit reached.

---

## YOUR TASK

For each of the three workflows above:

1. **Analyze Dependencies** - Map out what each step requires
2. **Identify Pattern** - Determine which pattern fits best:
   - Sequential: Steps form a chain, each depending on the previous
   - Parallel: Steps are independent, can run concurrently
   - Loop: Steps repeat until a condition is met

3. **Explain Rationale** - Why does this pattern fit?
4. **Provide Key Insight** - What's the deciding factor?

## DELIVERABLES

Use \`task_complete\` when done with a summary containing:
- Pattern recommendation for each workflow
- Clear rationale for each choice
- Any observations about hybrid approaches or trade-offs

Remember: You are ANALYZING patterns, not EXECUTING workflows.`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['WorkflowPatternAnalyst'],
        completionAgentId: 'WorkflowPatternAnalyst',
        priority: 'high',
        tags: ['workflow-patterns', 'analysis', 'demo'],
        metadata: {
            demo: 'workflow-patterns',
            scenario: 'pattern-analysis'
        }
    });

    console.log(`Task created: ${taskId}\n`);
    console.log('Agent is now working autonomously...\n');
    console.log('Watch for agent decisions on pattern selection:\n');

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

    console.log('\nCleaning up...');

    // Disconnect agent first
    if (cleanupState.agent) {
        await cleanupState.agent.disconnect().catch(() => {});
    }

    // Delete agent memory via API (must be done before channel deletion)
    if (cleanupState.credentials) {
        console.log('Deleting agent memory...');
        await fetch(`${config.serverUrl}/api/agents/WorkflowPatternAnalyst/memory`, {
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

    // Create SDK with Personal Access Token authentication (REQUIRED)
    const accessToken = process.env.MXF_DEMO_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('MXF_DEMO_ACCESS_TOKEN is required. Run: bun run server:cli -- demo:setup');
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
        console.log('SDK connected\n');

        // Create channel
        console.log('Creating demo channel...');
        const channel = await sdk.createChannel(config.channelId, {
            name: 'Workflow Patterns Demo Channel',
            description: 'Demonstrating agentic workflow pattern analysis',
            systemLlmEnabled: false  // Disable SystemLLM - agent makes its own decisions
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring - returns promise that resolves on task completion
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'Workflow Pattern Analyst Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Create agent
        console.log('Creating workflow pattern analyst agent...');
        const agent = await createWorkflowAnalysisAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create the task - agent will work autonomously from here
        await createWorkflowAnalysisTask(agent);

        // Wait for agent to work (with timeout)
        // The agent will autonomously:
        // 1. Analyze workflow A dependencies
        // 2. Analyze workflow B dependencies
        // 3. Analyze workflow C dependencies
        // 4. Recommend patterns for each
        // 5. Call task_complete when done
        console.log('Waiting for agent to complete (exits on task_complete, max 3 minutes)...\n');
        console.log('─'.repeat(60) + '\n');

        // Race between task completion and timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (3 minutes) - exiting demo');
                resolve();
            }, 180000); // 3 minutes for workflow analysis
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

        console.log('\n' + '═'.repeat(80));
        console.log('Demo Complete');
        console.log('═'.repeat(80));

        console.log('\nKey Takeaways:');
        console.log('  - The agent autonomously analyzed workflow definitions');
        console.log('  - No hardcoded pattern execution - pure LLM reasoning');
        console.log('  - Agent identified patterns based on dependency analysis:');
        console.log('    - Workflow A: Sequential (chained dependencies)');
        console.log('    - Workflow B: Parallel (independent steps with final merge)');
        console.log('    - Workflow C: Loop (quality threshold with iterations)');

        console.log('\nWorkflow Patterns Summary:');
        console.log('  Pattern     | Use Case                    | Key Indicator');
        console.log('  ------------|-----------------------------|-----------------');
        console.log('  Sequential  | Document pipelines          | Chained dependencies');
        console.log('  Parallel    | Multi-source fetching       | Independent steps');
        console.log('  Loop        | Optimization tasks          | Quality threshold');

    } catch (error) {
        console.error('\nDemo failed:', error);
        throw error;
    } finally {
        await cleanup();
    }
}

// Run demo
demo()
    .then(() => {
        console.log('\nDemo completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nDemo failed:', error);
        process.exit(1);
    });

export { demo };
