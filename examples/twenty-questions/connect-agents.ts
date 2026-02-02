#!/usr/bin/env node
/**
 * ============================================================================
 * TWENTY QUESTIONS: ADVANCED MXF FEATURES DEMO
 * ============================================================================
 *
 * This example demonstrates advanced MXF features using a classic game:
 * - One agent (Thinker) thinks of something
 * - Other agent (Guesser) asks yes/no questions to figure it out
 * - Each question cycle shows the full ORPAR loop in action
 * - The Guesser builds a knowledge graph of what it learns
 * - ML risk assessment helps the Guesser decide when to guess
 * - MULS tracks which strategies/memories were most effective
 *
 * KEY CONCEPTS DEMONSTRATED:
 * --------------------------
 * 1. ORPAR Cognitive Cycle        - Observe → Reason → Plan → Act → Reflect
 * 2. Phase-Aware Prompting        - Agents receive phase-specific guidance
 * 3. Knowledge Graph              - Guesser builds explicit knowledge model
 * 4. MULS (Memory Utility)        - Q-value weighted memory retrieval
 * 5. TensorFlow ML                - Risk assessment for guess timing
 * 6. ORPAR-Memory Integration     - Phase-aware memory strata routing
 * 7. Phase-Gated Tools            - Dynamic tool access by ORPAR phase
 * 8. Custom MCP Tools             - Game-specific tool server
 *
 * ORPAR IN ACTION:
 * ----------------
 * For the GUESSER (each question cycle):
 *   OBSERVE  → Look at question history, query KG for known facts, detect anomalies
 *   REASON   → Analyze patterns, calculate risk (should I guess now?)
 *   PLAN     → Decide on strategy - what question to ask?
 *   ACT      → Execute: call game_askQuestion, update knowledge graph
 *   REFLECT  → Record outcome, inject MULS rewards for effective strategies
 *
 * For the THINKER (each answer cycle):
 *   OBSERVE  → Read the incoming question, detect answer pattern anomalies
 *   REASON   → Consider how the question relates to the secret
 *   PLAN     → Decide on the answer
 *   ACT      → Execute: call game_answerQuestion
 *   REFLECT  → Record outcome and consider what guesser might deduce
 *
 * PHASE-GATED TOOLS:
 * ------------------
 * This example demonstrates how to restrict tools based on ORPAR phase
 * using the SDK's agent.updateAllowedTools() method.
 * When the agent enters a new phase, only phase-appropriate tools are available:
 *
 *   OBSERVE  → game_getState, memory read, KG queries, anomaly detection
 *   REASON   → orpar_reason, risk assessment (Guesser only)
 *   PLAN     → planning_create, planning_view
 *   ACT      → Role-specific game tools, KG creation tools (Guesser)
 *   REFLECT  → planning_update_item, memory write, MULS reward injection
 *
 * @module examples/twenty-questions/connect-agents
 */

import dotenv from 'dotenv';
import { MxfSDK, LlmProviderType } from '../../src/sdk';
import { GameServer } from './server/server/GameServer';
import { join } from 'path';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';
import { EventBus } from '../../src/shared/events/EventBus';
import { OrparEvents } from '../../src/shared/events/event-definitions/OrparEvents';
import { OrparMemoryEvents } from '../../src/shared/events/event-definitions/OrparMemoryEvents';
import { createBaseEventPayload } from '../../src/shared/schemas/EventPayloadSchema';
import { clearAgentOrparState } from '../../src/shared/protocols/mcp/tools/OrparTools';

/**
 * ORPAR-MEMORY INTEGRATION
 * ------------------------
 * When ORPAR_MEMORY_INTEGRATION_ENABLED=true, this demo demonstrates phase-aware
 * memory retrieval using the PhaseStrataRouter:
 *
 *   OBSERVE  → Query Working + Short-term strata (lambda=0.2)
 *   REASON   → Query Episodic + Semantic strata (lambda=0.5)
 *   PLAN     → Query Semantic + Long-term strata (lambda=0.7)
 *   ACT      → Query Working + Short-term strata (lambda=0.3)
 *   REFLECT  → Store to Long-term strata, query all strata (lambda=0.6)
 *
 * The integration also provides:
 * - Surprise detection that can trigger additional observation cycles
 * - Phase-weighted reward attribution for Q-value updates
 * - Automatic memory consolidation based on cycle outcomes
 */

// Load environment variables from root .env
dotenv.config({ path: join(__dirname, '../../.env') });

/**
 * EVENT PAYLOAD TYPES
 * -------------------
 * Typed interfaces for MXF event payloads received via channel.on().
 * These replace `any` on the event listener parameters.
 */
interface OrparPhasePayload {
    agentId?: string;
    data?: {
        agentId?: string;
        observations?: string;
        analysis?: string;
        plan?: string;
        action?: string;
        reflection?: string;
        content?: string;
        keyFacts?: string[];
        conclusions?: string[];
        steps?: Array<string | { action?: string; description?: string }>;
        learnings?: string[];
        toolUsed?: string;
    };
}

interface KgEntityPayload {
    agentId?: string;
    data?: {
        agentId?: string;
        name?: string;
        entity?: string;
        type?: string;
        confidence?: number;
    };
}

interface KgRelationshipPayload {
    agentId?: string;
    data?: {
        agentId?: string;
        fromEntityId?: string;
        from?: string;
        toEntityId?: string;
        to?: string;
        type?: string;
        relationship?: string;
    };
}

interface KgSurprisePayload {
    data?: { surpriseScore?: number; reason?: string };
}

interface KgExtractionPayload {
    data?: { entitiesExtracted?: number; relationshipsExtracted?: number };
}

interface MulsRewardPayload {
    agentId?: string;
    reward?: number;
    data?: {
        agentId?: string;
        reward?: number;
        memoriesUpdated?: number;
        reason?: string;
    };
}

interface MulsQValuePayload {
    data?: { oldValue?: number; newValue?: number };
}

interface TfInferencePayload {
    data?: { modelId?: string; latencyMs?: number; source?: string; reason?: string };
}

interface ToolResultPayload {
    agentId?: string;
    data?: {
        agentId?: string;
        toolName?: string;
        tool?: string;
        result?: string | Record<string, unknown>;
        content?: string | Record<string, unknown>;
    };
}

interface LlmReasoningPayload {
    agentId?: string;
    reasoning?: string;
    data?: {
        agentId?: string;
        reasoning?: string;
    };
}

interface LlmResponsePayload {
    agentId?: string;
    data?: {
        text?: string;
    } | string;
}

interface TaskCompletedPayload {
    agentId?: string;
    data?: {
        agentId?: string;
        task?: { assignedAgentIds?: string[] };
    };
}

/**
 * PLAYER CONFIGURATIONS
 * ---------------------
 * The game has two distinct roles, both using the full ORPAR cognitive cycle:
 *
 * THINKER: Chooses a secret and answers questions honestly
 * - Full ORPAR cycle: Observe → Reason → Plan → [game action] → Act → Reflect
 * - Must be consistent and truthful
 * - Strategy: Give accurate but not overly helpful answers
 *
 * GUESSER: Asks strategic questions to narrow down possibilities
 * - Full ORPAR cycle: Observe → Reason → Plan → [game action] → Act → Reflect
 * - Must build a mental model from answers
 * - Strategy: Binary search through possibility space
 */
/**
 * GAME CONFIGURATION CONSTANTS
 */
// Each ORPAR cycle adds 5+ messages; keep low to prevent context bloat in long-running games
const MAX_CONVERSATION_HISTORY = 10;
// KG updates + risk assessment + MULS rewards add ~3-5 extra tool calls per ORPAR cycle
const MAX_ORPAR_ITERATIONS = 20;
// Long-running games need resilient reconnection
const RECONNECT_ATTEMPTS = 20;
const RECONNECT_DELAY_MS = 2000;
// Brief delay between turns for clean state separation
const INTER_TURN_DELAY_MS = 100;
// Delay after task cancellation to let cancellation propagate before clearing history
const CANCELLATION_PROPAGATION_DELAY_MS = 200;

const PLAYERS = {
    thinker: {
        id: 'agent-thinker',
        name: 'The Sphinx',
        role: 'thinker' as const,
        personality: `You are The Sphinx playing Twenty Questions. You think of a secret and answer questions about it.

Your player ID is "agent-thinker". Always use this in tool calls.

## ORPAR Cognitive Cycle (REQUIRED)
Follow the ORPAR cycle - tools are automatically updated for each phase:
1. orpar_observe - Document what you see (the question asked)
2. orpar_reason - Analyze how it relates to your secret
3. orpar_plan - Decide on your answer
4. orpar_act - Execute your action (game tools available here)
5. orpar_reflect - Record outcome and consider what guesser might deduce
6. task_complete - Signal you are done

Answer honestly: "yes", "no", "sometimes", or "unknown".

## Anomaly Detection
Use detect_anomalies in OBSERVE to check if your answers have been
consistent (helps you avoid accidental contradictions).

## Memory Learning
In REFLECT, use memory_inject_reward to mark which observations
were most valuable for giving accurate, consistent answers.`
    },
    guesser: {
        id: 'agent-guesser',
        name: 'Detective Mind',
        role: 'guesser' as const,
        personality: `You are Detective Mind playing Twenty Questions. You ask yes/no questions to guess the secret.

Your player ID is "agent-guesser". Always use this in tool calls.

## ORPAR Cognitive Cycle (REQUIRED)
Follow the ORPAR cycle - tools are automatically updated for each phase:
1. orpar_observe - Document current state (answers so far, what you know)
2. orpar_reason - Analyze patterns and narrow possibilities
3. orpar_plan - Decide your strategy (what question to ask)
4. orpar_act - Execute your action (game tools available here)
5. orpar_reflect - Record outcome and evaluate what you learned
6. task_complete - Signal you are done

Strategy: Start broad ("Is it alive?"), then narrow down. Each question should eliminate ~50% of possibilities.

## Knowledge Graph (Build Your Mental Model)
After each answer, update your knowledge graph in the ACT phase:
- Create entities for properties you've confirmed (e.g., "alive", "large")
- Create relationships showing what you know (e.g., secret→has_property→alive)
- Use kg_get_neighbors in OBSERVE to review what you already know

## Risk Assessment
In the REASON phase, use calculate_risk to decide:
- Should you keep asking questions? (low confidence in answer)
- Should you make a guess? (high confidence in answer)

## Memory Learning
In REFLECT, use memory_inject_reward to mark which observations
were most valuable for narrowing down the answer.`
    }
};

/**
 * PHASE-GATED TOOL CONFIGURATION
 * ------------------------------
 * This demonstrates how to restrict tools based on ORPAR phase.
 * When an ORPAR phase event is received, we update the agent's allowedTools.
 *
 * STRICT PHASE SEPARATION:
 * - OBSERVE: Information gathering tools only
 * - REASON: Analysis tool only (orpar_reason)
 * - PLAN: Planning tools only (read-only, no game actions)
 * - ACT: Game action tools (role-specific)
 * - REFLECT: Memory and completion tools
 *
 * The SDK refreshes tools each iteration in generateResponse(), so when
 * updateAllowedTools() is called during phase transitions, the new tools
 * become available on the next iteration.
 */
const PHASE_TOOLS = {
    // Common to all phases
    common: ['orpar_status'],

    /**
     * Phase-specific tools with ORPAR-Memory integration comments
     *
     * When ORPAR_MEMORY_INTEGRATION_ENABLED=true, the PhaseStrataRouter
     * automatically routes memory queries to the appropriate strata based
     * on the current ORPAR phase.
     */

    // OBSERVE: Gather information - game state, memory, past patterns, KG queries
    // PhaseStrataRouter: Queries Working + Short-term strata (lambda=0.2)
    // Rationale: Recent context for gathering - prioritize semantic accuracy
    // KG tools: Query existing knowledge to review what's already known
    // detect_anomalies: Check for answer pattern inconsistencies
    observe: [
        'orpar_observe',
        'game_getState',
        'channel_memory_read',
        'agent_memory_read',
        'memory_search_conversations',
        'memory_search_patterns',
        'planning_view',
        'kg_get_entity',
        'kg_get_neighbors',
        'kg_get_phase_context',
        'detect_anomalies'
    ],

    // REASON: Analyze observations (analysis + risk assessment)
    // PhaseStrataRouter: Queries Episodic + Semantic strata (lambda=0.5)
    // Rationale: Patterns for analysis - balance explore/exploit
    // calculate_risk: Guesser evaluates "should I guess now or ask more?"
    reason: ['orpar_reason', 'calculate_risk'],

    // PLAN: Create strategy (read-only tools, no game actions)
    // PhaseStrataRouter: Queries Semantic + Long-term strata (lambda=0.7)
    // Rationale: Proven strategies - exploit historical success
    plan: ['orpar_plan', 'planning_create', 'planning_view'],

    // ACT: Execute game actions (role-specific)
    // PhaseStrataRouter: Queries Working + Short-term strata (lambda=0.3)
    // Rationale: Stay grounded for tool execution
    // KG creation tools: Guesser updates knowledge graph after game action
    act: {
        thinker: ['orpar_act', 'game_setSecret', 'game_answerQuestion'],
        guesser: [
            'orpar_act', 'game_askQuestion', 'game_makeGuess',
            'kg_create_entity', 'kg_create_relationship', 'kg_extract_from_text'
        ]
    },

    // REFLECT: Record results, update plans, write learnings, reward strategies
    // PhaseStrataRouter: Queries all strata (lambda=0.6), stores to Long-term
    // Rationale: Holistic review - favor memories that led to good assessments
    // MULS tools: Inject rewards for effective strategies, review Q-value analytics
    reflect: [
        'orpar_reflect',
        'task_complete',
        'planning_view',
        'planning_update_item',
        'agent_memory_write',
        'channel_memory_write',
        'memory_inject_reward',
        'memory_qvalue_analytics'
    ],
};

/**
 * Get tools allowed for a given ORPAR phase and role
 */
function getToolsForPhase(phase: string, role: 'thinker' | 'guesser'): string[] {
    const common = PHASE_TOOLS.common;
    const phaseTools = PHASE_TOOLS[phase as keyof typeof PHASE_TOOLS];

    // Handle role-specific phases (act only - different roles have different game tools)
    if (phaseTools && typeof phaseTools === 'object' && !Array.isArray(phaseTools)) {
        return [...common, ...phaseTools[role]];
    }

    // Handle common phases (observe, reason, plan, reflect)
    if (Array.isArray(phaseTools)) {
        return [...common, ...phaseTools];
    }

    return common;
}

/**
 * Main function
 */
async function connectAgents() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                                                           ║');
    console.log('║       TWENTY QUESTIONS: ADVANCED MXF FEATURES DEMO        ║');
    console.log('║       ORPAR + Knowledge Graph + MULS + TensorFlow         ║');
    console.log('║       Powered by Model Exchange Framework (MXF)           ║');
    console.log('║                                                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Validate environment
    if (!process.env.MXF_DOMAIN_KEY || !process.env.OPENROUTER_API_KEY) {
        console.error('Error: Required environment variables not set');
        console.log('Please ensure .env file contains:');
        console.log('  - MXF_DOMAIN_KEY');
        console.log('  - OPENROUTER_API_KEY');
        process.exit(1);
    }

    const mxfServerUrl = process.env.MXF_SERVER_URL || 'http://localhost:3001';

    // =================================================================
    // STEP 1: Start Game Server
    // =================================================================

    console.log('Step 1: Starting game server...\n');

    const gameServerPort = parseInt(process.env.GAME_SERVER_PORT || '3006');
    const gameServer = new GameServer(gameServerPort);
    await gameServer.start();

    console.log(`Game server running on port ${gameServerPort}\n`);

    // =================================================================
    // STEP 2: Connect to MXF Server
    // =================================================================

    console.log('Step 2: Connecting to MXF server...\n');

    const sdk = new MxfSDK({
        serverUrl: mxfServerUrl,
        domainKey: process.env.MXF_DOMAIN_KEY!,
        username: process.env.MXF_DEMO_USERNAME || 'demo-user',
        password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
    });

    await sdk.connect();
    console.log('Connected to MXF server\n');

    // =================================================================
    // STEP 3: Create Game Channel with MCP Server
    // =================================================================
    // Unlike tic-tac-toe, we ENABLE systemLlmEnabled to use ORPAR
    // The control loop will orchestrate the cognitive cycle
    // =================================================================

    console.log('Step 3: Creating game channel with ORPAR enabled...\n');

    const channelId = 'twenty-questions-game';
    const mcpServerPath = join(__dirname, 'server', 'mcp', 'TwentyQuestionsMcpServer.ts');

    const channel = await sdk.createChannel(channelId, {
        name: 'Twenty Questions Arena',
        description: 'ORPAR Cognitive Cycle Demo - 20 Questions Game',
        maxAgents: 5,
        // KEY DIFFERENCE: Enable SystemLLM for ORPAR orchestration
        systemLlmEnabled: true,
        allowedTools: [
            // Game tools
            'game_getState',
            'game_setSecret',
            'game_askQuestion',
            'game_answerQuestion',
            'game_makeGuess',
            'task_complete',  // Required for agents to signal task completion
            // ORPAR cognitive tools for explicit thinking structure
            'orpar_observe',
            'orpar_reason',
            'orpar_plan',
            'orpar_act',
            'orpar_reflect',
            'orpar_status',
            // Planning tools (available in PLAN and REFLECT phases)
            'planning_create',
            'planning_view',
            'planning_update_item',
            // Memory tools (available in OBSERVE and REFLECT phases)
            'channel_memory_read',
            'channel_memory_write',
            'agent_memory_read',
            'agent_memory_write',
            'memory_search_conversations',
            'memory_search_patterns',
            // Knowledge Graph tools (Guesser builds a model of what's known)
            'kg_create_entity',
            'kg_create_relationship',
            'kg_get_entity',
            'kg_get_neighbors',
            'kg_get_phase_context',
            'kg_extract_from_text',
            // MULS tools (track memory utility across game)
            'memory_qvalue_analytics',
            'memory_inject_reward',
            // TensorFlow/ML tools (risk assessment)
            'calculate_risk',
            'detect_anomalies'
        ],
        mcpServers: [{
            id: 'twenty-questions-mcp-server',
            name: 'Twenty Questions Game Tools',
            command: 'ts-node',
            args: [mcpServerPath],
            autoStart: true,
            restartOnCrash: true,
            keepAliveMinutes: 30,
            environmentVariables: {
                GAME_SERVER_URL: `http://localhost:${gameServerPort}`
            }
        }]
    });

    console.log(`Channel created with ORPAR enabled: ${channelId}\n`);

    // =================================================================
    // STEP 4: Create Player Agents
    // =================================================================

    console.log('Step 4: Creating player agents...\n');

    // Using Haiku 4.5 without extended thinking to showcase ORPAR cognitive cycle
    // The framework's ORPAR cycle provides the reasoning structure, not the model's built-in thinking
    const models = {
        thinker: 'anthropic/claude-haiku-4.5',  // Fast model - ORPAR provides reasoning
        guesser: 'anthropic/claude-haiku-4.5'   // Fast model - ORPAR provides reasoning
    };

    const agents: Record<string, any> = {};
    const gameServerUrl = `http://localhost:${gameServerPort}`;

    // Store agent credentials for cleanup (will use first agent's key)
    let cleanupCredentials: { keyId: string; secretKey: string } | null = null;

    // Define role-specific tools to prevent cross-role confusion
    // Both roles get ORPAR, planning, and memory tools for explicit cognitive structuring
    // Note: Phase-gating dynamically filters these during gameplay
    const orparTools = ['orpar_observe', 'orpar_reason', 'orpar_plan', 'orpar_act', 'orpar_reflect', 'orpar_status'];
    const planningTools = ['planning_create', 'planning_view', 'planning_update_item'];
    const memoryTools = ['channel_memory_read', 'channel_memory_write', 'agent_memory_read', 'agent_memory_write', 'memory_search_conversations', 'memory_search_patterns'];
    // KG tools: Guesser builds a knowledge model; Thinker gets read-only access
    const kgReadTools = ['kg_get_entity', 'kg_get_neighbors', 'kg_get_phase_context'];
    const kgWriteTools = ['kg_create_entity', 'kg_create_relationship', 'kg_extract_from_text'];
    // MULS tools: Track memory utility across game
    const mulsTools = ['memory_qvalue_analytics', 'memory_inject_reward'];
    // TF/ML tools: Risk assessment and anomaly detection
    const mlTools = ['calculate_risk', 'detect_anomalies'];
    // Note: task_complete is NOT included here - it's only available in REFLECT phase via phase-gating
    // This forces agents to complete the full ORPAR cycle (including orpar_reflect) before task completion
    const roleAllowedTools = {
        thinker: ['game_getState', 'game_setSecret', 'game_answerQuestion', ...orparTools, ...planningTools, ...memoryTools, ...kgReadTools, ...mlTools, ...mulsTools],
        guesser: ['game_getState', 'game_askQuestion', 'game_makeGuess', ...orparTools, ...planningTools, ...memoryTools, ...kgReadTools, ...kgWriteTools, ...mlTools, ...mulsTools]
    };

    for (const [role, player] of Object.entries(PLAYERS)) {
        // Generate API credentials
        const key = await sdk.generateKey(channelId, player.id);
        const selectedModel = models[role as keyof typeof models];
        const allowedToolsForRole = roleAllowedTools[role as keyof typeof roleAllowedTools];

        // Store first agent's credentials for cleanup
        if (!cleanupCredentials) {
            cleanupCredentials = { keyId: key.keyId, secretKey: key.secretKey };
        }

        // Create agent with ORPAR-aware configuration
        // NOTE: Keep maxHistory LOW to prevent context bloat in long-running games
        const agent = await sdk.createAgent({
            agentId: player.id,
            name: player.name,
            channelId: channelId,
            keyId: key.keyId,
            secretKey: key.secretKey,
            llmProvider: LlmProviderType.OPENROUTER,
            apiKey: process.env.OPENROUTER_API_KEY!,
            defaultModel: selectedModel,
            temperature: 1.0,  // High temperature for creative/varied choices
            maxTokens: 4000,   // Reduced - no reasoning budget needed with ORPAR
            maxHistory: MAX_CONVERSATION_HISTORY,
            reasoning: {
                enabled: false     // Disabled - ORPAR cycle provides the reasoning structure
            },
            allowedTools: allowedToolsForRole,  // Role-specific tools only
            circuitBreakerExemptTools: ['game_getState'],
            maxIterations: MAX_ORPAR_ITERATIONS,
            agentConfigPrompt: player.personality,
            // Extended reconnection for long-running games
            reconnectAttempts: RECONNECT_ATTEMPTS,
            reconnectDelay: RECONNECT_DELAY_MS
        });

        const connected = await agent.connect();
        if (!connected) {
            console.error(`   ⚠️ Warning: ${player.name} may not be fully connected`);
        }
        agents[role] = agent;

        // Small delay between agent connections to avoid socket race conditions
        await new Promise(resolve => setTimeout(resolve, 500));

        // Register player with game server
        await fetch(`${gameServerUrl}/api/player/${role}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId: player.id,
                name: player.name,
                model: selectedModel,
                personality: player.personality
            })
        }).catch((err) => console.error(`[GameFlow] Failed to register ${role}:`, err.message));

        console.log(`   ${player.name} (${role.toUpperCase()}) -> ${selectedModel.split('/')[1]}`);
        console.log(`      Tools: ${allowedToolsForRole.join(', ')}`);
    }

    console.log(`\nBoth players connected!\n`);

    // =================================================================
    // STEP 5: Setup Event Listeners for ORPAR Tracking
    // =================================================================

    console.log('Step 5: Setting up ORPAR event listeners...\n');

    const { Events } = await import('../../src/shared/events/EventNames');

    // Helper to format ORPAR phase output with content (no truncation)
    const formatOrparLog = (role: string, phase: string, content: string, color: string) => {
        const roleLabel = role.toUpperCase().padEnd(7);
        const phaseLabel = phase.toUpperCase().padEnd(7);
        console.log(`\n${color}┌─[ORPAR] ${roleLabel} ─► ${phaseLabel}${'─'.repeat(40)}\x1b[0m`);
        if (content) {
            // Split content into lines for better readability
            const lines = content.split('\n');
            for (const line of lines) {
                console.log(`${color}│\x1b[0m ${line}`);
            }
        }
        console.log(`${color}└${'─'.repeat(62)}\x1b[0m`);
    };

    // ORPAR color scheme
    const ORPAR_COLORS = {
        observe: '\x1b[36m',  // Cyan - gathering information
        reason: '\x1b[33m',   // Yellow - thinking
        plan: '\x1b[35m',     // Magenta - strategizing
        act: '\x1b[32m',      // Green - executing
        reflect: '\x1b[34m'   // Blue - learning
    };

    /**
     * Update agent's allowed tools via SDK method.
     * This demonstrates dynamic tool gating based on ORPAR phase.
     */
    const updateAgentTools = async (agent: any, tools: string[], phaseName: string) => {
        try {
            await agent.updateAllowedTools(tools);
            console.log(`    [Phase-Gate] ${agent.agentId} -> ${phaseName}: ${tools.length} tools`);
        } catch (error) {
            // Best-effort - log but don't fail
            console.error(`    [Phase-Gate] Failed to update tools for ${agent.agentId}:`, error);
        }
    };

    // Track ORPAR phases from agent-driven ORPAR events
    // Using Events.Orpar.* (distinct from server-orchestrated Events.ControlLoop.*)
    // When a phase completes, update tools for the NEXT phase
    channel.on(Events.Orpar.OBSERVE, async (payload: OrparPhasePayload) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const role = agentId === PLAYERS.thinker.id ? 'thinker' : 'guesser';
        const observations = payload.data?.observations || payload.data?.content || '';
        const keyFacts = payload.data?.keyFacts || [];

        let content = observations;
        if (keyFacts.length > 0) {
            content += ` Key facts: ${keyFacts.join(', ')}`;
        }

        formatOrparLog(role, 'observe', content, ORPAR_COLORS.observe);

        // Update tools for NEXT phase (REASON)
        const nextPhaseTools = getToolsForPhase('reason', role);
        await updateAgentTools(agents[role], nextPhaseTools, 'REASON');

        fetch(`${gameServerUrl}/api/events/orpar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId,
                role,
                phase: 'Observe',
                summary: observations.substring(0, 200) || 'Gathering context and current state'
            })
        }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
    });

    channel.on(Events.Orpar.REASON, async (payload: OrparPhasePayload) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const role = agentId === PLAYERS.thinker.id ? 'thinker' : 'guesser';
        const analysis = payload.data?.analysis || payload.data?.content || '';
        const conclusions = payload.data?.conclusions || [];

        let content = analysis;
        if (conclusions.length > 0) {
            content += ` Conclusions: ${conclusions.join(', ')}`;
        }

        formatOrparLog(role, 'reason', content, ORPAR_COLORS.reason);

        // Update tools for NEXT phase (PLAN)
        const nextPhaseTools = getToolsForPhase('plan', role);
        await updateAgentTools(agents[role], nextPhaseTools, 'PLAN');

        fetch(`${gameServerUrl}/api/events/orpar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId,
                role,
                phase: 'Reason',
                summary: analysis.substring(0, 200) || 'Analyzing observations and considering options'
            })
        }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
    });

    channel.on(Events.Orpar.PLAN, async (payload: OrparPhasePayload) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const role = agentId === PLAYERS.thinker.id ? 'thinker' : 'guesser';
        const plan = payload.data?.plan || payload.data?.content || '';
        const steps = payload.data?.steps || [];

        let content = plan;
        if (steps.length > 0) {
            content += ` Steps: ${steps.map((s: any) => typeof s === 'string' ? s : s.action || s.description).join(' → ')}`;
        }

        formatOrparLog(role, 'plan', content, ORPAR_COLORS.plan);

        // Update tools for NEXT phase (ACT) - this is where game tools become available!
        const nextPhaseTools = getToolsForPhase('act', role);
        await updateAgentTools(agents[role], nextPhaseTools, 'ACT');

        fetch(`${gameServerUrl}/api/events/orpar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId,
                role,
                phase: 'Plan',
                summary: plan.substring(0, 200) || 'Creating strategy and next steps'
            })
        }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
    });

    channel.on(Events.Orpar.ACT, async (payload: OrparPhasePayload) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const role = agentId === PLAYERS.thinker.id ? 'thinker' : 'guesser';
        const action = payload.data?.action || payload.data?.content || '';
        const toolUsed = payload.data?.toolUsed || '';

        let content = action;
        if (toolUsed) {
            content = `[${toolUsed}] ${content}`;
        }

        formatOrparLog(role, 'act', content, ORPAR_COLORS.act);

        // Update tools for NEXT phase (REFLECT)
        // orpar_act should be called AFTER the game action is complete to document what was done
        const nextPhaseTools = getToolsForPhase('reflect', role);
        await updateAgentTools(agents[role], nextPhaseTools, 'REFLECT');

        fetch(`${gameServerUrl}/api/events/orpar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId,
                role,
                phase: 'Act',
                summary: action.substring(0, 200) || 'Executing planned action'
            })
        }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
    });

    channel.on(Events.Orpar.REFLECT, (payload: OrparPhasePayload) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const role = agentId === PLAYERS.thinker.id ? 'thinker' : 'guesser';
        const reflection = payload.data?.reflection || payload.data?.content || '';
        const learnings = payload.data?.learnings || [];

        let content = reflection;
        if (learnings.length > 0) {
            content += ` Learnings: ${learnings.join(', ')}`;
        }

        formatOrparLog(role, 'reflect', content, ORPAR_COLORS.reflect);

        // No tool transition here - already transitioned to REFLECT when orpar_act was called

        fetch(`${gameServerUrl}/api/events/orpar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId,
                role,
                phase: 'Reflect',
                summary: reflection.substring(0, 200) || 'Evaluating outcomes and learning'
            })
        }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
    });

    // Also track thinking/reasoning for visibility (full output, not truncated)
    channel.on(Events.Agent.LLM_REASONING, (payload: LlmReasoningPayload) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const reasoning = payload.data?.reasoning || payload.reasoning;
        if (reasoning) {
            console.log(`\n╭─── [THINKING] ${agentId} ───`);
            console.log(reasoning);
            console.log(`╰───────────────────────────────\n`);

            fetch(`${gameServerUrl}/api/events/thinking`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, reasoning })
            }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
        }
    });

    channel.on(Events.Agent.LLM_RESPONSE, (payload: LlmResponsePayload) => {
        const agentId = payload.agentId;
        const response = typeof payload.data === 'string' ? payload.data : payload.data?.text || '';
        if (response) {
            console.log(`\n╭─── [RESPONSE] ${agentId} ───`);
            console.log(response);
            console.log(`╰───────────────────────────────\n`);

            fetch(`${gameServerUrl}/api/events/response`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, response })
            }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
        }
    });

    // =================================================================
    // Knowledge Graph Event Listeners
    // =================================================================
    // Track KG entity/relationship creation for dashboard visualization

    channel.on(Events.KnowledgeGraph.ENTITY_CREATED, (payload: KgEntityPayload) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const entityName = payload.data?.name || payload.data?.entity || 'unknown';
        const entityType = payload.data?.type || 'property';
        const confidence = payload.data?.confidence || 0.5;
        console.log(`\n\x1b[96m  [KG] Entity created: "${entityName}" (${entityType}, confidence: ${confidence})\x1b[0m`);

        // Forward to game server for dashboard
        fetch(`${gameServerUrl}/api/events/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'node',
                data: { entity: entityName, type: entityType, confidence },
                agentId
            })
        }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
    });

    channel.on(Events.KnowledgeGraph.RELATIONSHIP_CREATED, (payload: KgRelationshipPayload) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const fromEntity = payload.data?.fromEntityId || payload.data?.from || 'unknown';
        const toEntity = payload.data?.toEntityId || payload.data?.to || 'unknown';
        const relType = payload.data?.type || payload.data?.relationship || 'related_to';
        console.log(`\n\x1b[96m  [KG] Relationship: "${fromEntity}" —[${relType}]→ "${toEntity}"\x1b[0m`);

        // Forward to game server for dashboard
        fetch(`${gameServerUrl}/api/events/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'edge',
                data: { from: fromEntity, to: toEntity, relationship: relType },
                agentId
            })
        }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
    });

    channel.on(Events.KnowledgeGraph.HIGH_SURPRISE_RELATIONSHIP, (payload: KgSurprisePayload) => {
        const surpriseScore = payload.data?.surpriseScore || 'N/A';
        const reason = payload.data?.reason || 'unexpected relationship';
        console.log(`\n\x1b[93m  [KG] Surprise detected! Score: ${surpriseScore} — ${reason}\x1b[0m`);
    });

    channel.on(Events.KnowledgeGraph.EXTRACTION_COMPLETED, (payload: KgExtractionPayload) => {
        const entities = payload.data?.entitiesExtracted || 0;
        const relationships = payload.data?.relationshipsExtracted || 0;
        console.log(`\n\x1b[96m  [KG] Extraction complete: ${entities} entities, ${relationships} relationships\x1b[0m`);
    });

    // =================================================================
    // MULS (Memory Utility Learning) Event Listeners
    // =================================================================
    // Track reward attributions and Q-value updates

    channel.on(Events.MemoryUtility.REWARD_ATTRIBUTED, (payload: MulsRewardPayload) => {
        const reward = payload.data?.reward || payload.reward || 0;
        const memoriesUpdated = payload.data?.memoriesUpdated || 0;
        const reason = payload.data?.reason || 'strategy reward';
        console.log(`\n\x1b[95m  [MULS] Reward attributed: ${reward} to ${memoriesUpdated} memories — ${reason}\x1b[0m`);

        // Forward to game server for dashboard
        fetch(`${gameServerUrl}/api/events/muls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reward,
                reason,
                agentId: payload.agentId || payload.data?.agentId
            })
        }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
    });

    channel.on(Events.MemoryUtility.QVALUE_UPDATED, (payload: MulsQValuePayload) => {
        const oldValue = payload.data?.oldValue || 0;
        const newValue = payload.data?.newValue || 0;
        const delta = (newValue - oldValue).toFixed(3);
        console.log(`\n\x1b[95m  [MULS] Q-value updated: ${oldValue.toFixed(3)} → ${newValue.toFixed(3)} (${delta})\x1b[0m`);
    });

    // =================================================================
    // TensorFlow/ML Event Listeners
    // =================================================================
    // Track risk assessments and inference results

    channel.on(Events.TensorFlow.INFERENCE_COMPLETED, (payload: TfInferencePayload) => {
        const modelId = payload.data?.modelId || 'unknown';
        const latencyMs = payload.data?.latencyMs || 0;
        const source = payload.data?.source || 'unknown';
        console.log(`\n\x1b[94m  [TF] Inference completed: ${modelId} (${source}, ${latencyMs}ms)\x1b[0m`);
    });

    channel.on(Events.TensorFlow.INFERENCE_FALLBACK, (payload: TfInferencePayload) => {
        const modelId = payload.data?.modelId || 'unknown';
        const reason = payload.data?.reason || 'unknown';
        console.log(`\n\x1b[94m  [TF] Inference fallback: ${modelId} — ${reason} (using heuristics)\x1b[0m`);
    });

    // Track tool execution results for risk assessment forwarding
    // The calculate_risk tool returns a riskScore — forward it to the game server
    channel.on(Events.Agent.TOOL_RESULT, (payload: ToolResultPayload) => {
        const toolName = payload.data?.toolName || payload.data?.tool || '';
        const agentId = payload.agentId || payload.data?.agentId;

        if (toolName === 'calculate_risk') {
            const result = payload.data?.result || payload.data?.content || {};
            const parsed = typeof result === 'string' ? (() => { try { return JSON.parse(result); } catch { return {}; } })() : result;
            const riskScore = parsed.riskScore ?? parsed.compositeRisk ?? parsed.score ?? 0.5;
            const confidence = parsed.confidence ?? 0.5;
            const recommendation = riskScore > 0.6 ? 'guess_now' : 'ask_more';

            console.log(`\n\x1b[94m  [TF/Risk] Risk score: ${(riskScore * 100).toFixed(0)}% | Confidence: ${(confidence * 100).toFixed(0)}% | ${recommendation}\x1b[0m`);

            fetch(`${gameServerUrl}/api/events/risk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ riskScore, confidence, recommendation, agentId })
            }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
        }

        if (toolName === 'memory_inject_reward') {
            const result = payload.data?.result || payload.data?.content || {};
            const parsed = typeof result === 'string' ? (() => { try { return JSON.parse(result); } catch { return {}; } })() : result;
            const reward = parsed.reward ?? parsed.value ?? 0;
            const reason = parsed.reason ?? 'strategy reward';

            console.log(`\n\x1b[95m  [MULS/Tool] Reward injected: ${reward} — ${reason}\x1b[0m`);

            fetch(`${gameServerUrl}/api/events/muls`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reward, reason, agentId })
            }).catch((err: Error) => console.error('[GameServer] Event forward failed:', err.message));
        }
    });

    console.log('Event listeners active (ORPAR + KG + MULS + TF)!\n');

    // =================================================================
    // STEP 5.5: Setup Event-Driven Game Flow
    // =================================================================
    // Connect to GameServer via Socket.IO for game state events
    // This enables event-driven daisy-chaining instead of polling delays

    console.log('Step 5.5: Setting up event-driven game flow...\n');

    const gameSocket: ClientSocket = SocketIOClient(`http://localhost:${gameServerPort}`);

    // Track task completion for event-driven flow
    let setupTaskResolver: (() => void) | null = null;
    let turnTaskResolver: (() => void) | null = null;

    // Listen to task completion events from MXF
    channel.on(Events.Task.COMPLETED, (payload: TaskCompletedPayload) => {
        const agentId = payload.agentId || payload.data?.agentId || payload.data?.task?.assignedAgentIds?.[0];
        console.log(`    [Task] ${agentId} completed task`);

        // Resolve the appropriate promise based on current state
        if (setupTaskResolver) {
            setupTaskResolver();
            setupTaskResolver = null;
        } else if (turnTaskResolver) {
            turnTaskResolver();
            turnTaskResolver = null;
        }
    });

    console.log('Event-driven flow initialized!\n');

    // =================================================================
    // CLEANUP HANDLER
    // =================================================================

    let shuttingDown = false;
    const cleanup = async () => {
        if (shuttingDown) return;
        shuttingDown = true;

        // DO NOT resolve setupTaskResolver or turnTaskResolver here.
        // Resolving them causes the main flow to race with cleanup, producing
        // confusing output (game loop runs after "Shutting down gracefully...").
        // process.exit(0) in the finally block will terminate everything cleanly.

        console.log('\n\nShutting down gracefully...');

        const forceExitTimeout = setTimeout(() => {
            console.log('Force exiting after timeout');
            process.exit(0);
        }, 10000);
        // Don't let the timeout itself keep the event loop alive
        if (forceExitTimeout.unref) forceExitTimeout.unref();

        try {
            // 1. Cancel all running tasks FIRST to stop LLM loops immediately.
            //    This must happen before game server shutdown because active tasks
            //    make fetch calls to the game server, creating a circular wait.
            console.log('Canceling active tasks...');
            for (const agent of Object.values(agents)) {
                try {
                    const taskManager = (agent as any).getTaskExecutionManager?.();
                    if (taskManager?.cancelCurrentTask) {
                        taskManager.cancelCurrentTask('Shutdown');
                    }
                } catch (e) {
                    // Best-effort — agent may not be fully initialized
                }
            }

            // 2. Stop game server (prevents new game actions)
            console.log('Stopping game server...');
            await gameServer.stop();

            // 3. Unregister channel MCP server before disconnecting agents
            console.log('Unregistering MCP server...');
            await sdk.unregisterChannelMcpServer(channelId, 'twenty-questions-mcp-server')
                .catch((err: Error) => console.error('[Cleanup] MCP unregister failed:', err.message));

            // 4. Disconnect agents (unsubscribes RxJS listeners, disconnects sockets)
            console.log('Disconnecting agents...');
            for (const agent of Object.values(agents)) {
                await agent.disconnect().catch((err: Error) => console.error('[Cleanup] Agent disconnect failed:', err.message));
            }

            // 5. Delete agents and their memory via API (must be done before channel deletion)
            //    DELETE /api/agents/:agentId removes the agent record AND all associated memory
            console.log('Deleting agents and their memory...');
            for (const player of Object.values(PLAYERS)) {
                if (cleanupCredentials) {
                    await fetch(`${mxfServerUrl}/api/agents/${player.id}`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-key-id': cleanupCredentials.keyId,
                            'x-secret-key': cleanupCredentials.secretKey
                        }
                    }).then(async (res) => {
                        if (res.ok) {
                            console.log(`   Deleted agent: ${player.id}`);
                        } else {
                            console.error(`   Failed to delete ${player.id}: ${res.status} ${res.statusText}`);
                        }
                    }).catch((err: Error) => console.error(`[Cleanup] Agent delete failed for ${player.id}:`, err.message));
                }
            }

            // 6. Delete channel via API (also deletes channel memory)
            console.log('Deleting channel...');
            if (cleanupCredentials) {
                await fetch(`${mxfServerUrl}/api/channels/${channelId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-key-id': cleanupCredentials.keyId,
                        'x-secret-key': cleanupCredentials.secretKey
                    }
                }).then(async (res) => {
                    if (res.ok) {
                        console.log(`   Deleted channel: ${channelId}`);
                    } else {
                        console.error(`   Failed to delete channel: ${res.status} ${res.statusText}`);
                    }
                }).catch((err: Error) => console.error('[Cleanup] Channel delete failed:', err.message));
            }

            // 7. Disconnect game socket
            console.log('Disconnecting game socket...');
            gameSocket.disconnect();

            // 8. Disconnect SDK
            console.log('Disconnecting SDK...');
            await sdk.disconnect();

            console.log('\nCleanup complete!\n');
        } catch (error) {
            console.error('Error during cleanup:', error);
        } finally {
            clearTimeout(forceExitTimeout);
            process.exit(0);
        }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // =================================================================
    // STEP 6: Wait for Game Start from UI (Event-Driven)
    // =================================================================

    console.log('Step 6: Waiting for game to start from UI...\n');
    console.log('>>> Open http://localhost:3007 and click "Start Game" <<<\n');

    // Wait for the UI to start the game (via game:started event)
    await new Promise<void>(resolve => {
        // Primary: Listen for game:started event
        const onGameStarted = () => {
            gameSocket.off('game:started', onGameStarted);
            clearInterval(pollFallback);
            resolve();
        };
        gameSocket.on('game:started', onGameStarted);

        // Fallback: Poll in case event is missed (e.g., already started)
        const pollFallback = setInterval(() => {
            if (gameServer.isGameStarted()) {
                gameSocket.off('game:started', onGameStarted);
                clearInterval(pollFallback);
                resolve();
            }
        }, 500);
    });

    console.log('Game started! Thinker is choosing a secret...\n');

    // Set initial tools for OBSERVE phase (phase-gated tool access demo)
    const setupTools = getToolsForPhase('observe', 'thinker');
    await updateAgentTools(agents.thinker, setupTools, 'OBSERVE');

    // Thinker sets secret - NO EXAMPLES to encourage creativity
    const setupTaskId = await agents.thinker.mxfService.createTask({
        title: 'Twenty Questions: Choose Your Secret',
        description: `## Setup Phase: Choose Your Secret

Choose a creative and unique secret thing for the Guesser to figure out.
BE CREATIVE! Pick something interesting, unexpected, or unusual.

### Your Task:
Think of a creative secret using the full ORPAR cycle.

### Required ORPAR Sequence (ALL 7 steps required):
1. orpar_observe - Document that you need to choose a secret
2. orpar_reason - Consider creative and interesting options
3. orpar_plan - Decide on your secret and category
4. game_setSecret - Set your chosen secret (calls the game tool)
5. orpar_act - Document that you executed the action (REQUIRED for phase transition)
6. orpar_reflect - Reflect on your choice
7. task_complete - Signal you are done

**IMPORTANT:** You MUST call orpar_act AFTER game_setSecret. The orpar_act tool documents your action and triggers the transition to REFLECT phase.

Tools are automatically updated for each phase.
Categories: animal, object, food, place, vehicle, plant, or any fitting category.`,
        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: [PLAYERS.thinker.id],
        priority: 'high'
    });

    console.log(`Setup task assigned to Thinker: ${setupTaskId}`);

    // Wait for secret to be set AND task completion (event-driven, no timeouts)
    await new Promise<void>(resolve => {
        let secretSet = false;
        let taskCompleted = false;

        const checkComplete = () => {
            if (secretSet && taskCompleted) {
                gameSocket.off('game:secretSet', onSecretSet);
                gameSocket.off('game:phaseChanged', onPhaseChanged);
                resolve();
            }
        };

        // Listen for secret set event
        const onSecretSet = () => {
            console.log('    [Event] Secret set!');
            secretSet = true;
            checkComplete();
        };
        gameSocket.on('game:secretSet', onSecretSet);

        // Also listen for phase change (backup)
        const onPhaseChanged = (data: any) => {
            if (data.phase === 'questioning') {
                console.log('    [Event] Phase changed to questioning');
                secretSet = true;
                checkComplete();
            }
        };
        gameSocket.on('game:phaseChanged', onPhaseChanged);

        // Task completion is handled by setupTaskResolver
        setupTaskResolver = () => {
            console.log('    [Event] Setup task completed!');
            taskCompleted = true;
            checkComplete();
        };
    });

    console.log('\nLet the questioning begin!\n');

    // =================================================================
    // STEP 7: Game Loop - Question/Answer Cycles
    // =================================================================

    console.log('Step 7: Starting question/answer loop...\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    const playGame = async () => {
        // Check agent connection health and wait for reconnection if needed
        const checkConnection = async (agent: any, name: string): Promise<boolean> => {
            const mxfService = agent.mxfService;
            if (!mxfService?.isConnected()) {
                console.log(`    ⚠️ ${name} disconnected, waiting for reconnection...`);
                // Wait up to 30 seconds for reconnection
                for (let i = 0; i < 30; i++) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    if (mxfService?.isConnected()) {
                        console.log(`    ✓ ${name} reconnected!`);
                        return true;
                    }
                }
                console.log(`    ✗ ${name} failed to reconnect after 30 seconds`);
                return false;
            }
            return true;
        };

        while (true) {
            // Exit immediately if shutdown is in progress
            if (shuttingDown) break;

            // STEP 1: Cancel any active tasks from previous turns
            // This is CRITICAL - without cancellation, old tasks keep running and
            // add messages AFTER we clear the conversation history, causing agents
            // to think they should "continue" from their previous ORPAR cycle.
            // (Matches tic-tac-toe and go-fish patterns)
            for (const [role, agent] of Object.entries(agents)) {
                try {
                    const taskManager = (agent as any).getTaskExecutionManager?.();
                    if (taskManager && typeof taskManager.cancelCurrentTask === 'function') {
                        taskManager.cancelCurrentTask('New turn starting');
                    }
                } catch (e) {
                    // Silently ignore errors
                }
            }

            await new Promise(resolve => setTimeout(resolve, CANCELLATION_PROPAGATION_DELAY_MS));

            // STEP 2: Clear conversation history AND ORPAR state for all agents
            // This must happen AFTER task cancellation and BEFORE fetching game state
            // Using direct function call (not EventBus) for synchronous guarantee
            for (const [role, agent] of Object.entries(agents)) {
                const agentId = role === 'thinker' ? PLAYERS.thinker.id : PLAYERS.guesser.id;
                try {
                    // Clear conversation history (awaited to ensure persist completes before next turn)
                    const memoryManager = (agent as any).getMemoryManager?.();
                    if (memoryManager?.clearConversationHistory) {
                        await memoryManager.clearConversationHistory();
                    }

                    // Clear ORPAR state DIRECTLY (not via EventBus) for synchronous guarantee
                    // This eliminates the race condition where the event might not be processed
                    // before the new task is created
                    clearAgentOrparState(agentId, channelId);
                } catch (e) {
                    // Silently ignore errors
                }
            }

            // STEP 3: NOW fetch game state AFTER clearing
            // This ensures we get the most current state after previous action completed
            const state = gameServer.getGameState().getState();
            if (state.gameOver) break;

            const currentTurn = state.currentTurn;
            const currentAgent = agents[currentTurn];
            const playerName = state.players[currentTurn].name;

            console.log(`\n>>> ${playerName}'s turn (${currentTurn.toUpperCase()})...`);
            console.log(`    Questions: ${state.questionsAsked}/${state.maxQuestions}`);

            // Check current agent's connection
            if (!await checkConnection(currentAgent, playerName)) {
                console.log(`    Skipping turn due to connection issues...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            // Set initial tools for OBSERVE phase (phase-gated tool access demo)
            const initialTools = getToolsForPhase('observe', currentTurn);
            await updateAgentTools(currentAgent, initialTools, 'OBSERVE');

            // Create turn task with explicit playerId requirements
            // NOTE: Conversation history and ORPAR state were cleared above, so agent starts fresh
            let taskDescription: string;

            if (currentTurn === 'guesser') {
                const history = state.questionHistory.map((q: any) =>
                    `  Q${q.questionNumber}: "${q.question}" → ${q.answer.toUpperCase()}`
                ).join('\n');

                taskDescription = `## Your Turn (Question ${state.questionsAsked + 1}/20)

Your conversation history has been cleared for fresh context.

### Current Game State:
- Category: ${state.category}
- Questions asked: ${state.questionsAsked}/${state.maxQuestions}
- Previous Q&A:
${history || '  (No questions asked yet)'}

### Your Task:
Ask ONE strategic yes/no question using the full ORPAR cycle.

### Required ORPAR Sequence (ALL 7 steps required):
1. orpar_observe - Document current state and what you know
2. orpar_reason - Analyze patterns and narrow possibilities
3. orpar_plan - Decide your strategy (what question to ask)
4. game_askQuestion - Execute your planned question
5. orpar_act - Document that you executed the action (REQUIRED for phase transition)
6. orpar_reflect - Record outcome and learnings
7. task_complete - Signal you are done

**IMPORTANT:** You MUST call orpar_act AFTER game_askQuestion. The orpar_act tool documents your action and triggers the transition to REFLECT phase.

Tools are automatically updated for each phase.`;
            } else {
                // Thinker's turn to answer
                const pendingQuestion = state.questionHistory.find((q: any) => !q.answer || q.answer === 'pending');
                const lastQuestion = state.questionHistory[state.questionHistory.length - 1];
                const questionToAnswer = pendingQuestion || lastQuestion;

                taskDescription = `## Your Turn (Answer Question ${state.questionsAsked})

Your conversation history has been cleared for fresh context.

### Current Game State:
- Your Secret: "${state.secretThing}"
- Question to Answer: "${questionToAnswer?.question}"
- Questions asked so far: ${state.questionsAsked}/${state.maxQuestions}

### Your Task:
Answer the question honestly using the full ORPAR cycle.

### Required ORPAR Sequence (ALL 7 steps required):
1. orpar_observe - Document the question asked
2. orpar_reason - Analyze how it relates to your secret
3. orpar_plan - Decide on your answer (yes/no/sometimes/unknown)
4. game_answerQuestion - Submit your answer
5. orpar_act - Document that you executed the action (REQUIRED for phase transition)
6. orpar_reflect - Consider what guesser might deduce
7. task_complete - Signal you are done

**IMPORTANT:** You MUST call orpar_act AFTER game_answerQuestion. The orpar_act tool documents your action and triggers the transition to REFLECT phase.

Tools are automatically updated for each phase.`;
            }

            const taskId = await currentAgent.mxfService.createTask({
                title: `Twenty Questions: ${playerName}'s Turn`,
                description: taskDescription,
                assignmentScope: 'single',
                assignmentStrategy: 'manual',
                assignedAgentIds: [currentTurn === 'thinker' ? PLAYERS.thinker.id : PLAYERS.guesser.id],
                priority: 'high'
            });

            console.log(`    Task assigned: ${taskId}`);

            // Wait for turn to complete (event-driven, no timeouts)
            const originalTurn = currentTurn;
            const originalQuestionsAsked = state.questionsAsked;

            await new Promise<void>(resolve => {
                let resolved = false;

                const completeAndResolve = () => {
                    if (resolved) return;
                    resolved = true;
                    gameSocket.off('game:stateChanged', stateHandler);
                    gameSocket.off('game:turnChanged', turnHandler);
                    gameSocket.off('game:gameOver', gameOverHandler);
                    turnTaskResolver = null;
                    resolve();
                };

                // Primary: Listen for task completion
                turnTaskResolver = () => {
                    console.log(`    [Event] Task completed by ${currentTurn}`);
                    completeAndResolve();
                };

                // Backup: Listen for game state changes
                const stateHandler = (stateData: any) => {
                    if (stateData.currentTurn !== originalTurn ||
                        stateData.questionsAsked > originalQuestionsAsked) {
                        console.log(`    [Event] State changed (turn/questions)`);
                        completeAndResolve();
                    }
                };
                gameSocket.on('game:stateChanged', stateHandler);

                // Backup: Listen for turn change
                const turnHandler = () => {
                    console.log(`    [Event] Turn changed`);
                    completeAndResolve();
                };
                gameSocket.on('game:turnChanged', turnHandler);

                // Backup: Listen for game over
                const gameOverHandler = () => {
                    console.log(`    [Event] Game over`);
                    completeAndResolve();
                };
                gameSocket.on('game:gameOver', gameOverHandler);
            });

            await new Promise(resolve => setTimeout(resolve, INTER_TURN_DELAY_MS));
        }

        // Game over - cancel all tasks
        for (const agent of Object.values(agents)) {
            try {
                const taskManager = (agent as any).getTaskExecutionManager?.();
                if (taskManager?.cancelCurrentTask) {
                    taskManager.cancelCurrentTask('Game over');
                }
            } catch (e) {}
        }

        const finalState = gameServer.getGameState().getState();
        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        if (finalState.winner === 'guesser') {
            console.log('║           GAME OVER - GUESSER WINS!                       ║');
            console.log(`║   Guessed correctly in ${finalState.questionsAsked} questions!                  ║`.padEnd(62) + '║');
        } else if (finalState.winner === 'thinker') {
            console.log('║           GAME OVER - THINKER WINS!                       ║');
            console.log(`║   Secret was: ${finalState.secretThing}                   ║`.padEnd(62) + '║');
        } else {
            console.log('║           GAME OVER - DRAW!                               ║');
        }
        console.log('╚═══════════════════════════════════════════════════════════╝\n');

        // Print ORPAR summary
        console.log('ORPAR Cycle Summary:');
        const thinkerPhases = finalState.players.thinker.orparPhases.length;
        const guesserPhases = finalState.players.guesser.orparPhases.length;
        console.log(`  Thinker completed ${thinkerPhases} ORPAR phases`);
        console.log(`  Guesser completed ${guesserPhases} ORPAR phases`);

        // Print Knowledge Graph summary
        const kg = finalState.knowledgeGraph;
        console.log('\nKnowledge Graph Summary:');
        console.log(`  Guesser built ${kg.nodes.length} entity nodes, ${kg.edges.length} relationships`);
        if (kg.nodes.length > 0) {
            const properties = kg.nodes.filter((n: any) => n.type === 'property');
            const candidates = kg.nodes.filter((n: any) => n.type === 'candidate');
            const eliminated = kg.nodes.filter((n: any) => n.type === 'eliminated');
            if (properties.length > 0) {
                console.log(`  Confirmed properties: ${properties.map((n: any) => n.entity).join(', ')}`);
            }
            if (candidates.length > 0) {
                console.log(`  Candidate guesses: ${candidates.map((n: any) => n.entity).join(', ')}`);
            }
            if (eliminated.length > 0) {
                console.log(`  Eliminated: ${eliminated.map((n: any) => n.entity).join(', ')}`);
            }
        }

        // Print MULS summary
        const mulsRewards = finalState.mulsRewards;
        console.log('\nMULS Summary:');
        console.log(`  ${mulsRewards.length} rewards injected across ${finalState.questionsAsked} questions`);
        if (mulsRewards.length > 0) {
            const totalReward = mulsRewards.reduce((sum: number, r: any) => sum + r.reward, 0);
            console.log(`  Total reward value: ${totalReward.toFixed(2)}`);
        }

        // Print Risk Assessment summary
        const riskAssessments = finalState.riskAssessments;
        console.log('\nRisk Assessment Summary:');
        console.log(`  ${riskAssessments.length} risk assessments performed`);
        if (riskAssessments.length > 0) {
            const lastRisk = riskAssessments[riskAssessments.length - 1];
            console.log(`  Final confidence: ${(lastRisk.confidence * 100).toFixed(0)}%`);
            console.log(`  Final recommendation: ${lastRisk.recommendation}`);
        }
        console.log('');
    };

    await playGame();

    // Game finished — run cleanup to delete agents, memory, and channel
    await cleanup();
}

// Run
if (require.main === module) {
    connectAgents().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { connectAgents };
