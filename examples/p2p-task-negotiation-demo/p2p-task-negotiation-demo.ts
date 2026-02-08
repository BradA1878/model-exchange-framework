/**
 * P2P Task Negotiation Demo (Agentic Flow)
 *
 * Demonstrates an agent AUTONOMOUSLY analyzing P2P task auctions and deciding
 * which agent should win each auction based on different selection strategies.
 *
 * KEY DIFFERENCE: This demo does NOT use hardcoded bid generation or winner selection.
 * Instead, the agent receives auction scenarios and autonomously:
 * - Analyzes agent capabilities and eligibility
 * - Calculates bids for eligible agents
 * - Applies selection strategies to choose winners
 * - Explains its rationale for each decision
 *
 * @prerequisites
 * - MXF server running (`npm run dev`)
 * - Environment variables configured
 *
 * @example
 * ```bash
 * cd examples/p2p-task-negotiation-demo
 * cp .env.example .env
 * npx ts-node p2p-task-negotiation-demo.ts
 * ```
 *
 * Run with: npm run demo:p2p-task-negotiation
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `p2p-task-negotiation-demo-${timestamp}`
};

/**
 * Task announcement structure
 */
interface TaskAnnouncement {
    id: string;
    title: string;
    description: string;
    requiredCapabilities: string[];
    complexity: 'simple' | 'moderate' | 'complex';
    deadline: Date;
    reward: number;
    bidWindow: number; // ms
}

/**
 * Agent bid structure
 */
interface TaskBid {
    announcementId: string;
    agentId: string;
    confidence: number;       // 0-1
    estimatedDuration: number; // ms
    proposedCost: number;
    capabilities: string[];
    reputation: number;        // 0-1
}

/**
 * Selection strategy types
 */
type SelectionStrategy = 'lowest_price' | 'highest_reputation' | 'best_value' | 'fastest';

/**
 * Agent profile for bidding
 */
interface AgentProfile {
    id: string;
    name: string;
    capabilities: string[];
    reputation: number;
    baseCost: number;
    speedMultiplier: number;
}

/**
 * Agent marketplace - profiles available for auction bidding
 */
const AGENT_PROFILES: AgentProfile[] = [
    {
        id: 'agent_alpha',
        name: 'Alpha Agent',
        capabilities: ['data_analysis', 'code_review', 'testing'],
        reputation: 0.95,
        baseCost: 10,
        speedMultiplier: 1.0
    },
    {
        id: 'agent_beta',
        name: 'Beta Agent',
        capabilities: ['data_analysis', 'documentation', 'research'],
        reputation: 0.82,
        baseCost: 7,
        speedMultiplier: 1.3
    },
    {
        id: 'agent_gamma',
        name: 'Gamma Agent',
        capabilities: ['code_review', 'refactoring', 'optimization'],
        reputation: 0.88,
        baseCost: 12,
        speedMultiplier: 0.8
    },
    {
        id: 'agent_delta',
        name: 'Delta Agent',
        capabilities: ['testing', 'debugging', 'deployment'],
        reputation: 0.78,
        baseCost: 5,
        speedMultiplier: 1.5
    }
];

/**
 * Display demo banner explaining what the demo demonstrates
 */
const displayBanner = (): void => {
    console.log('\n' + '═'.repeat(80));
    console.log('P2P TASK NEGOTIATION DEMO (Agentic Flow)');
    console.log('═'.repeat(80));
    console.log('');
    console.log('This demo shows an agent AUTONOMOUSLY analyzing P2P task auctions:');
    console.log('  - The agent receives task announcements and agent marketplace data');
    console.log('  - It reasons about which agents can bid based on capabilities');
    console.log('  - It evaluates bids using different selection strategies');
    console.log('  - No hardcoded winner selection - pure LLM reasoning');
    console.log('');
    console.log('Available Selection Strategies:');
    console.log('  - lowest_price      : Minimize cost');
    console.log('  - highest_reputation: Prioritize trust');
    console.log('  - fastest           : Speed priority');
    console.log('  - best_value        : Balanced scoring');
    console.log('');
    console.log('Watch for:');
    console.log('  - [Agent Thinking] Analyzing agent capabilities...');
    console.log('  - [Tool Call] planning_create - Creating auction analysis plan');
    console.log('  - [Agent Decision] Auction 1 → Alpha Agent (highest reputation)');
    console.log('  - [Agent Decision] Auction 2 → Best value selection');
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
                    // Look for auction decisions in the response
                    const strategies = ['lowest_price', 'highest_reputation', 'fastest', 'best_value'];
                    const agentNames = ['Alpha Agent', 'Beta Agent', 'Gamma Agent', 'Delta Agent'];
                    const auctionTerms = ['Auction', 'Winner', 'Selected', 'eligible', 'bid'];

                    let hasDecision = false;
                    for (const term of auctionTerms) {
                        if (content.includes(term)) {
                            for (const agent of agentNames) {
                                if (content.includes(agent)) {
                                    hasDecision = true;
                                    break;
                                }
                            }
                        }
                        if (hasDecision) break;
                    }

                    if (hasDecision) {
                        console.log(`\n${'─'.repeat(60)}`);
                        console.log('[Agent Decision]');
                        // Truncate for readability
                        const displayContent = content.length > 1000
                            ? content.substring(0, 1000) + '...'
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

            // Highlight auction analysis tool calls
            const analysisTools = [
                'tools_recommend', 'planning_create', 'task_complete',
                'planning_update_item', 'planning_view'
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
                    const desc = args.description.length > 100
                        ? args.description.substring(0, 100) + '...'
                        : args.description;
                    console.log(`   Description: ${desc}`);
                }
                if (args.items && Array.isArray(args.items)) {
                    console.log(`   Steps: ${args.items.length} items`);
                }
                if (args.summary) {
                    const summary = args.summary.length > 200
                        ? args.summary.substring(0, 200) + '...'
                        : args.summary;
                    console.log(`   Summary: ${summary}`);
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
                // Check for auction-related thinking
                const keywords = [
                    'capability', 'reputation', 'cost', 'bid', 'eligible',
                    'strategy', 'winner', 'auction', 'agent', 'price'
                ];
                const hasKeyword = keywords.some(k => response.toLowerCase().includes(k));
                if (hasKeyword) {
                    console.log(`[Agent Thinking] ${response}`);
                }
            }
        });
    });
};

/**
 * Create the task auction analyst agent with detailed prompt
 */
const createTaskAuctionAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'TaskAuctionAnalyst',
        name: 'Task Auction Analyst',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'An agent that analyzes P2P task auctions and selects optimal winners',

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

        // Detailed agent behavior prompt - instructs the agent on auction analysis
        agentConfigPrompt: `You are a Task Auction Analyst. Your job is to analyze P2P task auction scenarios
and autonomously determine which agent should win each auction based on the
specified selection strategy.

## YOUR ROLE

You will receive:
1. Agent marketplace data (profiles with capabilities, reputation, costs)
2. Task announcements (requirements, complexity, rewards)
3. Selection strategy to use for each auction

Your task is to:
1. Determine which agents can bid (capability matching)
2. Calculate bid parameters for eligible agents
3. Apply the selection strategy to choose a winner
4. Explain your reasoning clearly

## AGENT MARKETPLACE STRUCTURE

Agents have these attributes:
- id: Unique identifier
- name: Display name
- capabilities: Array of task types they can handle
- reputation: Trust score (0-1, higher is better)
- baseCost: Starting cost per task in dollars
- speedMultiplier: How fast they work (lower = faster)

## BID CALCULATION FORMULAS

For each eligible agent, calculate:

### Confidence Score
confidence = capability_match_ratio * reputation
- capability_match_ratio = (matching capabilities / required capabilities)
- Only agents with ALL required capabilities can bid

### Estimated Duration
Base durations by complexity:
- simple: 60000ms (1 minute)
- moderate: 180000ms (3 minutes)
- complex: 600000ms (10 minutes)

estimatedDuration = base_duration * speedMultiplier

### Proposed Cost
Complexity multipliers:
- simple: 1x
- moderate: 1.5x
- complex: 2.5x

proposedCost = baseCost * complexity_multiplier

## SELECTION STRATEGIES

### lowest_price
Select the agent with the lowest proposedCost.
- Criteria: min(proposedCost)
- Best for: Budget-constrained scenarios

### highest_reputation
Select the agent with the highest reputation score.
- Criteria: max(reputation)
- Best for: Quality-critical tasks

### fastest
Select the agent with the lowest estimatedDuration.
- Criteria: min(estimatedDuration)
- Best for: Time-sensitive tasks

### best_value
Calculate a value score and select the highest.
- Formula: score = (reputation * confidence) / (proposedCost * (estimatedDuration / 60000))
- This balances quality (reputation, confidence) against cost and time
- Best for: Balanced optimization

## ANALYSIS METHODOLOGY

### Step 1: Filter Eligible Agents
For each auction task:
- Check which agents have ALL required capabilities
- An agent missing ANY required capability cannot bid
- List eligible vs ineligible agents

### Step 2: Calculate Bids
For each eligible agent:
- Calculate confidence using the formula above
- Calculate estimatedDuration using complexity and speedMultiplier
- Calculate proposedCost using baseCost and complexity multiplier

### Step 3: Apply Strategy
Using the specified strategy for each auction:
- Apply the strategy formula/criteria
- Rank eligible agents by the strategy metric
- Select the winner

### Step 4: Document Decision
For each auction, provide:
- List of eligible agents with their bid parameters
- Strategy applied
- Winner selected
- Clear rationale for why this agent won

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
- **Input**: { planId?: string }
- **Use when**: Checking plan progress

### task_complete
- **Purpose**: Mark task complete with your findings
- **Input**: { summary: string, success: boolean, details?: object }
- **Use when**: You have analyzed all auctions and are ready to report

## OUTPUT FORMAT

When completing the task, structure your findings as:

\`\`\`
P2P TASK AUCTION ANALYSIS RESULTS
=================================

Auction 1: [Task Title]
  Required Capabilities: [list]
  Strategy: [strategy name]

  Eligible Agents:
    - [Agent Name]: Cost=$X, Duration=Xm, Reputation=X%, Confidence=X%
    - [Agent Name]: Cost=$X, Duration=Xm, Reputation=X%, Confidence=X%

  Ineligible Agents:
    - [Agent Name]: Missing [capabilities]

  Winner: [Agent Name]
  Rationale: [Why this agent won under this strategy]

Auction 2: [Task Title]
  [Same format...]

Auction 3: [Task Title]
  [Same format...]

SUMMARY
=======
- Auction 1 → [Winner] (via [strategy])
- Auction 2 → [Winner] (via [strategy])
- Auction 3 → [Winner] (via [strategy])

Key Observations:
[Any insights about the marketplace or strategy effectiveness]
\`\`\`

## IMPORTANT GUIDELINES

1. **Only eligible agents can bid** - missing ANY required capability disqualifies an agent
2. **Show your calculations** - demonstrate how you computed bids
3. **Be specific** - reference actual agent names, numbers, and capabilities
4. **Use task_complete** when done with all analysis
5. **Don't simulate** - analyze the data provided, don't make up additional agents`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the auction analysis task for the agent
 */
const createAuctionAnalysisTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating auction analysis task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'Analyze P2P Task Auctions',
        description: `# P2P Task Auction Analysis

You will analyze three auction scenarios and determine winners using different selection strategies.

## AGENT MARKETPLACE

Here are the agents available in the marketplace:

\`\`\`json
${JSON.stringify(AGENT_PROFILES, null, 2)}
\`\`\`

## AUCTION SCENARIOS

### Auction 1: Data Analysis Project
- **Task ID**: task_001
- **Title**: Data Analysis Project
- **Description**: Analyze sales data and generate insights report
- **Required Capabilities**: data_analysis
- **Complexity**: moderate
- **Reward**: $25
- **Selection Strategy**: highest_reputation

Determine which agents can bid (have data_analysis capability), calculate their bids, and select the winner using the highest_reputation strategy.

---

### Auction 2: Code Review and Testing Task
- **Task ID**: task_002
- **Title**: Code Review and Testing
- **Description**: Review code changes and create comprehensive tests
- **Required Capabilities**: code_review AND testing (both required)
- **Complexity**: complex
- **Reward**: $50
- **Selection Strategy**: best_value

This task requires BOTH code_review AND testing capabilities. An agent must have both to be eligible. Use the best_value formula to select the winner.

---

### Auction 3: Quick Documentation Task
- **Task ID**: task_003
- **Title**: Quick Documentation Update
- **Description**: Update API documentation with new endpoints
- **Required Capabilities**: documentation
- **Complexity**: simple
- **Reward**: $10
- **Selection Strategy**: fastest

A simple task where speed is the priority. Select the agent who can complete it fastest.

---

## YOUR TASK

For each of the three auctions above:

1. **Identify Eligible Agents** - Which agents have ALL required capabilities?
2. **Calculate Bids** - For eligible agents, compute:
   - Confidence = capability_match * reputation
   - Estimated Duration = base_duration × speedMultiplier
   - Proposed Cost = baseCost × complexity_multiplier
3. **Apply Strategy** - Use the specified strategy to select the winner
4. **Explain Decision** - Why did this agent win under this strategy?

## CALCULATION REFERENCE

Base Durations:
- simple: 60,000ms (1 minute)
- moderate: 180,000ms (3 minutes)
- complex: 600,000ms (10 minutes)

Complexity Multipliers:
- simple: 1x
- moderate: 1.5x
- complex: 2.5x

Best Value Score Formula:
score = (reputation × confidence) / (proposedCost × (estimatedDuration / 60000))

## DELIVERABLES

Use \`task_complete\` when done with a summary containing:
- Winner for each auction with rationale
- Bid calculations for eligible agents
- Insights about strategy effectiveness

Remember: You are the ANALYST selecting winners, not simulating the auction process.`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['TaskAuctionAnalyst'],
        completionAgentId: 'TaskAuctionAnalyst',
        priority: 'high',
        tags: ['p2p', 'auction', 'demo'],
        metadata: {
            demo: 'p2p-task-negotiation',
            scenario: 'auction-analysis'
        }
    });

    console.log(`Task created: ${taskId}\n`);
    console.log('Agent is now working autonomously...\n');
    console.log('Watch for agent decisions on auction winners:\n');

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
        await fetch(`${config.serverUrl}/api/agents/TaskAuctionAnalyst/memory`, {
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
            name: 'P2P Task Negotiation Demo Channel',
            description: 'Demonstrating agentic P2P auction analysis',
            systemLlmEnabled: false  // Disable SystemLLM - agent makes its own decisions
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring - returns promise that resolves on task completion
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'Task Auction Analyst Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Create agent
        console.log('Creating task auction analyst agent...');
        const agent = await createTaskAuctionAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create the task - agent will work autonomously from here
        await createAuctionAnalysisTask(agent);

        // Wait for agent to work (with timeout)
        // The agent will autonomously:
        // 1. Analyze Auction 1: Data Analysis (highest_reputation strategy)
        // 2. Analyze Auction 2: Code Review + Testing (best_value strategy)
        // 3. Analyze Auction 3: Quick Documentation (fastest strategy)
        // 4. Call task_complete when done
        console.log('Waiting for agent to complete (exits on task_complete, max 3 minutes)...\n');
        console.log('─'.repeat(60) + '\n');

        // Race between task completion and timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (3 minutes) - exiting demo');
                resolve();
            }, 180000); // 3 minutes for auction analysis
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

        console.log('\n' + '═'.repeat(80));
        console.log('Demo Complete');
        console.log('═'.repeat(80));

        console.log('\nKey Takeaways:');
        console.log('  - The agent autonomously analyzed auction scenarios');
        console.log('  - No hardcoded winner selection - pure LLM reasoning');
        console.log('  - Agent identified eligible agents based on capabilities');
        console.log('  - Different strategies produced different winners:');
        console.log('    - Auction 1: highest_reputation → trusted agent');
        console.log('    - Auction 2: best_value → balanced cost/quality winner');
        console.log('    - Auction 3: fastest → speed-optimized agent');

        console.log('\nP2P Task Negotiation Features:');
        console.log('  Feature          | Description');
        console.log('  -----------------|------------------------------------------');
        console.log('  Capability Match | Only agents with required skills can bid');
        console.log('  Bid Calculation  | Cost, duration, confidence computed');
        console.log('  Selection Strategy | Multiple strategies for different needs');
        console.log('  Transparent Rationale | Agent explains every decision');

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

export { demo, AGENT_PROFILES };
