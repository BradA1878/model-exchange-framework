/**
 * Nested Learning Demo (Agentic Flow)
 *
 * Demonstrates an agent AUTONOMOUSLY implementing the Self-Evolving Reasoning
 * Cycle (SERC) - analyzing observations, managing memory strata, verifying
 * its own reasoning, and deciding when self-repair is needed.
 *
 * KEY DIFFERENCE: This demo does NOT use hardcoded SERC functions.
 * Instead, the agent receives SERC scenarios and autonomously:
 * - Calculates surprise with momentum tracking
 * - Decides memory promotions/demotions
 * - Verifies reasoning with tool-grounded evidence
 * - Generates PATCH instructions when confidence is low
 * - Calculates promotion scores and explains decisions
 *
 * @prerequisites
 * - MXF server running (`npm run dev`)
 * - Environment variables configured
 *
 * @example
 * ```bash
 * cd examples/nested-learning-demo
 * cp .env.example .env
 * npx ts-node nested-learning-demo.ts
 * ```
 *
 * Run with: npm run demo:nested-learning
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `nested-learning-demo-${timestamp}`
};

/**
 * Memory stratum configuration based on MIRAS framework
 */
interface MemoryStratum {
    name: string;
    updateFrequency: string;
    persistence: string;
    compression: string;
    decayRate: number;
    architecture: 'vector' | 'matrix' | 'deep_mlp';
    attentionalBias: 'mse' | 'yaad' | 'moneta' | 'memora';
}

/**
 * Verification tuple from tool-grounded verification
 */
interface VerificationTuple {
    score: number;      // -1 to 1, factual correctness
    confidence: number; // 0 to 1, epistemic certainty
    critique: string;   // Natural language feedback
}

/**
 * PATCH instruction for self-repair
 */
interface PatchInstruction {
    action: 'PATCH' | 'NO_CHANGE';
    targetStep: number;
    patchType?: 'reasoning' | 'tool_call' | 'parameter';
    newContent?: string;
    justification: string;
}

/**
 * Surprise signal with momentum
 */
interface SurpriseSignal {
    momentary: number;      // Current cycle's surprise
    accumulated: number;    // Momentum accumulator
    effective: number;      // Combined effective surprise
    threshold: number;      // Promotion threshold
    shouldPromote: boolean;
}

/**
 * Memory strata configuration
 */
const MEMORY_STRATA: MemoryStratum[] = [
    {
        name: 'Immediate',
        updateFrequency: 'Every cycle',
        persistence: 'Ephemeral',
        compression: 'None',
        decayRate: 0.8,
        architecture: 'vector',
        attentionalBias: 'mse'
    },
    {
        name: 'Tactical',
        updateFrequency: 'Every 3-5 cycles',
        persistence: 'Session',
        compression: 'Light summarization',
        decayRate: 0.3,
        architecture: 'matrix',
        attentionalBias: 'yaad'
    },
    {
        name: 'Operational',
        updateFrequency: 'Every 10-20 cycles',
        persistence: 'Extended session',
        compression: 'Moderate summarization',
        decayRate: 0.1,
        architecture: 'matrix',
        attentionalBias: 'yaad'
    },
    {
        name: 'Strategic',
        updateFrequency: 'Every 50+ cycles',
        persistence: 'Persistent',
        compression: 'Heavy (embeddings)',
        decayRate: 0.05,
        architecture: 'deep_mlp',
        attentionalBias: 'memora'
    }
];

/**
 * Display demo banner explaining what the demo demonstrates
 */
const displayBanner = (): void => {
    console.log('\n' + '═'.repeat(80));
    console.log('NESTED LEARNING DEMO (Agentic Flow)');
    console.log('═'.repeat(80));
    console.log('');
    console.log('This demo shows an agent AUTONOMOUSLY implementing SERC:');
    console.log('  - The agent receives observations and memory state');
    console.log('  - It calculates surprise and decides memory promotions');
    console.log('  - It verifies its own reasoning with tool-grounded evidence');
    console.log('  - It generates PATCH instructions for self-repair when needed');
    console.log('');
    console.log('SERC Phases:');
    console.log('  - Observation  : Analyze data, compute surprise');
    console.log('  - Reasoning    : Process observations with surprise modulation');
    console.log('  - Planning     : Generate plans with predictions');
    console.log('  - Action       : Execute and record outcomes');
    console.log('  - Reflection   : Verify, self-repair if needed, calculate promotion score');
    console.log('');
    console.log('Watch for:');
    console.log('  - [Agent Thinking] Calculating surprise for observation...');
    console.log('  - [Tool Call] planning_create - Creating SERC analysis plan');
    console.log('  - [Agent Decision] Memory promotion: Immediate → Tactical');
    console.log('  - [Agent Decision] Self-repair triggered: confidence below threshold');
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
                    // Look for SERC-related decisions in the response
                    const sercKeywords = [
                        'surprise', 'momentum', 'promotion', 'verification',
                        'PATCH', 'repair', 'confidence', 'threshold',
                        'Immediate', 'Tactical', 'Operational', 'Strategic'
                    ];

                    let hasDecision = false;
                    for (const keyword of sercKeywords) {
                        if (content.includes(keyword)) {
                            hasDecision = true;
                            break;
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

            // Highlight SERC analysis tool calls
            const analysisTools = [
                'tools_recommend', 'planning_create', 'planning_update_item',
                'planning_view', 'task_complete'
            ];

            // Special handling for task_complete - show full SERC analysis
            if (toolName === 'task_complete') {
                console.log(`\n${'═'.repeat(60)}`);
                console.log('[SERC Analysis Complete]');
                if (args.summary) {
                    console.log(`\nSummary:\n${args.summary}`);
                }
                if (args.details) {
                    console.log(`\nDetails:`);
                    console.log(JSON.stringify(args.details, null, 2));
                }
                console.log(`${'═'.repeat(60)}\n`);
            } else if (analysisTools.includes(toolName)) {
                // Other analysis tools - show truncated info
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
                // Check for SERC-related thinking
                const keywords = [
                    'surprise', 'momentum', 'promote', 'verify', 'repair',
                    'confidence', 'threshold', 'cycle', 'stratum'
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
 * Create the SERC analyst agent with detailed prompt
 */
const createSERCAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'SERCAnalyst',
        name: 'SERC Analyst',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'An agent that implements Self-Evolving Reasoning Cycle',

        // LLM configuration
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.3,
        maxTokens: 8000,

        // Tools available to the agent for analysis
        allowedTools: [
            'tools_recommend',
            'planning_create',
            'planning_update_item',
            'planning_view',
            'task_complete'
        ],

        // Detailed agent behavior prompt - instructs the agent on SERC implementation
        agentConfigPrompt: `You are a SERC (Self-Evolving Reasoning Cycle) Analyst. Your job is to implement
the nested learning cycle by analyzing observations, managing memory strata,
verifying reasoning, and performing self-repair when needed.

## YOUR ROLE

You will receive:
1. Memory strata configuration (Immediate, Tactical, Operational, Strategic)
2. A series of observations with predicted vs actual values
3. Reasoning statements to verify
4. Confidence thresholds for repair decisions

Your task is to:
1. Calculate surprise for each observation
2. Decide whether memories should be promoted to slower strata
3. Verify reasoning using tool-grounded evidence
4. Generate PATCH instructions when confidence is low
5. Calculate promotion scores for each cycle

## MEMORY STRATA (MIRAS Framework)

Four strata with different temporal frequencies:

### Immediate Stratum
- Update: Every cycle
- Persistence: Ephemeral
- Decay rate: 0.8/cycle (fast)
- Architecture: Vector
- Bias: MSE

### Tactical Stratum
- Update: Every 3-5 cycles
- Persistence: Session
- Decay rate: 0.3/cycle
- Architecture: Matrix
- Bias: YAAD

### Operational Stratum
- Update: Every 10-20 cycles
- Persistence: Extended session
- Decay rate: 0.1/cycle
- Architecture: Matrix
- Bias: YAAD

### Strategic Stratum
- Update: Every 50+ cycles
- Persistence: Persistent
- Decay rate: 0.05/cycle (very slow)
- Architecture: Deep MLP
- Bias: MEMORA

## SURPRISE CALCULATION

Calculate surprise with momentum tracking:

### Momentary Surprise
momentary = |actual - predicted|

### Accumulated Surprise (Momentum)
accumulated = previous_accumulated × 0.7 + momentary × 0.3

### Effective Surprise
effective = momentary + accumulated × 0.5

### Promotion Threshold
If effective > 0.6, the memory should be promoted to a slower stratum

## TOOL-GROUNDED VERIFICATION

When verifying reasoning:

### Verification Tuple
- score: -1 to 1 (factual correctness)
- confidence: 0 to 1 (epistemic certainty)
- critique: Natural language feedback

### Score Calculation
- If all tools succeed: score = +1
- If all tools fail: score = -1
- Mixed results: weighted average

### Confidence
Average confidence from all tool verifications

## SELF-REPAIR PROTOCOL

### Repair Gate
Sigmoid function: gate = 1 / (1 + exp(-κ × (threshold - confidence)))
- κ = 5 (steepness)
- threshold = 0.7 (default)
- Trigger repair if gate > 0.5

### PATCH Instructions
When repair is needed:
{
  action: 'PATCH',
  targetStep: <step number>,
  patchType: 'reasoning' | 'tool_call' | 'parameter',
  newContent: '<corrected content>',
  justification: '<why repair needed>'
}

When no repair needed:
{
  action: 'NO_CHANGE',
  targetStep: <step number>,
  justification: '<why confidence is sufficient>'
}

## PROMOTION SCORE CALCULATION

Combined scoring from Titans + MIRAS + Agent0-VL:

score = αs × surprise + αc × confidence + αt × toolScore - β × repairCost

Where:
- αs = 0.3 (surprise weight)
- αc = 0.4 (confidence weight)
- αt = 0.3 (tool verification weight)
- β = 0.2 (repair cost penalty)
- toolScore = (verification.score + 1) / 2 (normalized)

## SERC DUAL-LOOP ARCHITECTURE

### Inner Loop (per-cycle)
1. Observation → Assemble context, compute surprise
2. Reasoning → LLM analysis modulated by surprise
3. Planning → Generate plan with predictions
4. Action → Execute plan, record outcomes
5. Reflection → Verify, self-repair if needed, calculate promotion

### Outer Loop (cross-cycle)
- Promote high-value memories to slower strata
- Identify cross-agent patterns
- Update Operational/Strategic strata
- Adjust MIRAS configuration

## AVAILABLE TOOLS

### tools_recommend
- Purpose: Discover additional tools if needed
- Input: { intent: string, context?: string }

### planning_create
- Purpose: Create a structured analysis plan
- Input: { name: string, description: string, items: PlanItem[] }

### planning_update_item
- Purpose: Update plan item status
- Input: { planId: string, itemId: string, status: string }

### planning_view
- Purpose: View plan status
- Input: { planId?: string }

### task_complete
- Purpose: Mark task complete with findings
- Input: { summary: string, success: boolean, details?: object }

## OUTPUT FORMAT

For each cycle, report:

\`\`\`
SERC CYCLE ANALYSIS
==================

Observation Analysis:
  Predicted: X.XX, Actual: X.XX
  Momentary surprise: X.XXX
  Accumulated (momentum): X.XXX
  Effective surprise: X.XXX
  Should promote: YES/NO → [target stratum]

Verification Results:
  Tools invoked: [list]
  Score: X.XX (correct/incorrect)
  Confidence: XX%
  Critique: [feedback]

Repair Decision:
  Gate value: X.XX
  Action: PATCH/NO_CHANGE
  [If PATCH: target, type, justification]

Promotion Score:
  Score: X.XXX
  Decision: [PROMOTE to Tactical/Stay in Immediate]
  Rationale: [explanation]
\`\`\`

## IMPORTANT GUIDELINES

1. Show your calculations - demonstrate the formulas
2. Be specific about thresholds and decisions
3. Explain rationale for each decision
4. Use task_complete when all cycles analyzed with FULL details
5. Don't simulate - analyze the data provided
6. Include ALL calculations in your task_complete summary and details`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the SERC analysis task for the agent
 */
const createSERCAnalysisTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating SERC analysis task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'Analyze SERC Cycles',
        description: `# SERC Cycle Analysis Task

You will analyze multiple reasoning cycles using the Self-Evolving Reasoning Cycle.

## MEMORY STRATA CONFIGURATION

${JSON.stringify(MEMORY_STRATA, null, 2)}

## OBSERVATION CYCLES

### Cycle 1: Normal Operation
- Predicted value: 0.50
- Actual value: 0.55
- Previous momentum: 0.00
- Description: "Routine database query"

### Cycle 2: Expected Behavior
- Predicted value: 0.50
- Actual value: 0.52
- Previous momentum: [calculate from Cycle 1]
- Description: "Standard API response"

### Cycle 3: Unexpected Error!
- Predicted value: 0.50
- Actual value: 0.95
- Previous momentum: [calculate from Cycle 2]
- Description: "Unexpected spike in response time"

### Cycle 4: Error Follow-up
- Predicted value: 0.50
- Actual value: 0.75
- Previous momentum: [calculate from Cycle 3]
- Description: "Investigating anomaly"

### Cycle 5: Returning to Normal
- Predicted value: 0.50
- Actual value: 0.60
- Previous momentum: [calculate from Cycle 4]
- Description: "System stabilizing"

## REASONING STATEMENTS TO VERIFY

### Statement 1: Mathematical Reasoning
- Reasoning: "Calculate 15% of 200 = 30"
- Simulated tool: calculator
- Expected outcome: success with high confidence (0.99)
- Notes: This is a straightforward calculation

### Statement 2: Fact-Checking
- Reasoning: "The capital of Australia is Sydney"
- Simulated tools: web_search, knowledge_base
- Expected outcome: failure (correct answer is Canberra)
- Tool confidence: 0.95, 0.92

### Statement 3: Code Execution
- Reasoning: "Function returns expected output"
- Simulated tools: code_execute, test_runner
- Expected outcome: partial success with moderate confidence
- Tool confidence: 0.85, 0.78

## YOUR TASK

For each observation cycle:
1. Calculate surprise using the formulas provided
2. Track momentum accumulation across cycles
3. Determine if memory should be promoted based on effective surprise > 0.6

For each reasoning statement:
1. Determine verification score based on tool success/failure
2. Calculate average confidence from tools
3. Apply repair gate sigmoid to decide if self-repair needed
4. Generate appropriate PATCH instruction or NO_CHANGE

Finally:
1. Calculate promotion scores for cycles with high surprise
2. Summarize which memories should move to slower strata
3. Provide overall SERC recommendations

## DELIVERABLES

Use task_complete when done with a summary containing:
- Surprise calculations for all 5 cycles
- Momentum tracking showing accumulation
- Verification results for all 3 statements
- PATCH decisions with justifications
- Promotion score calculations
- Overall SERC recommendations

Remember: You are IMPLEMENTING the SERC formulas, not just describing them.
Show your calculations step by step.`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['SERCAnalyst'],
        completionAgentId: 'SERCAnalyst',
        priority: 'high',
        tags: ['serc', 'nested-learning', 'demo'],
        metadata: {
            demo: 'nested-learning',
            scenario: 'serc-analysis'
        }
    });

    console.log(`Task created: ${taskId}\n`);
    console.log('Agent is now working autonomously on SERC analysis...\n');
    console.log('Watch for agent decisions on surprise, verification, and repair:\n');

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
        await fetch(`${config.serverUrl}/api/agents/SERCAnalyst/memory`, {
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
            name: 'Nested Learning Demo Channel',
            description: 'Demonstrating agentic SERC implementation',
            systemLlmEnabled: false  // Disable SystemLLM - agent makes its own decisions
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring - returns promise that resolves on task completion
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'SERC Analyst Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Create agent
        console.log('Creating SERC analyst agent...');
        const agent = await createSERCAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create the task - agent will work autonomously from here
        await createSERCAnalysisTask(agent);

        // Wait for agent to work (with timeout)
        // The agent will autonomously:
        // 1. Calculate surprise for each observation cycle
        // 2. Track momentum accumulation
        // 3. Verify reasoning statements
        // 4. Generate PATCH instructions when needed
        // 5. Calculate promotion scores
        // 6. Call task_complete when done
        console.log('Waiting for agent to complete (exits on task_complete, max 3 minutes)...\n');
        console.log('─'.repeat(60) + '\n');

        // Race between task completion and timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (3 minutes) - exiting demo');
                resolve();
            }, 180000); // 3 minutes for SERC analysis
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

        console.log('\n' + '═'.repeat(80));
        console.log('Demo Complete');
        console.log('═'.repeat(80));

        console.log('\nKey Takeaways:');
        console.log('  - Agent autonomously implemented SERC cycle');
        console.log('  - Surprise calculated with momentum tracking');
        console.log('  - Memory promotions decided by effective surprise > 0.6');
        console.log('  - Reasoning verified with tool-grounded evidence');
        console.log('  - Self-repair triggered when confidence below 0.7 threshold');

        console.log('\nNested Learning Features:');
        console.log('  Feature          | Description');
        console.log('  -----------------|------------------------------------------');
        console.log('  Memory Strata    | 4 levels: Immediate → Strategic');
        console.log('  Surprise Calc    | Momentary + Accumulated (momentum)');
        console.log('  Verification     | Tool-grounded score + confidence');
        console.log('  Self-Repair      | Sigmoid gate triggers PATCH when needed');
        console.log('  Promotion Score  | Combined Titans + MIRAS + Agent0-VL');

        console.log('\nKey Concepts:');
        console.log('  Titans     → Surprise-based memory encoding');
        console.log('  MIRAS      → Architecture, bias, retention, algorithm');
        console.log('  Agent0-VL  → Solver/Verifier modes, self-repair');
        console.log('  SERC       → Inner/outer loop integration');

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

// Export for testing
export {
    demo,
    MEMORY_STRATA,
    MemoryStratum,
    VerificationTuple,
    PatchInstruction,
    SurpriseSignal
};
