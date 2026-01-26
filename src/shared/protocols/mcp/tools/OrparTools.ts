/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * ORPAR Cognitive Cycle Tools
 *
 * These tools enable agents to explicitly structure their thinking using the
 * ORPAR (Observe-Reason-Plan-Act-Reflect) cognitive cycle pattern.
 *
 * When agents have these tools in their allowedTools, they are expected to use them
 * to document each phase of their cognitive process. The tools:
 *
 * 1. Validate the cognitive flow (can't act without planning first)
 * 2. Emit ORPAR events (distinct from ControlLoop events) for tracking
 * 3. Provide guidance for the next phase
 * 4. Complement (but don't duplicate) the server-side ControlLoop system
 *
 * IMPORTANT: These tools emit OrparEvents (orpar:observe, orpar:reason, etc.)
 * which are DISTINCT from ControlLoopEvents (controlLoop:observation, etc.).
 * This separation prevents duplicate events when both systems are active.
 *
 * Flow: OBSERVE → REASON → PLAN → ACT → REFLECT → (back to OBSERVE)
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../utils/Logger';
import { EventBus } from '../../../events/EventBus';
import { OrparEvents } from '../../../events/event-definitions/OrparEvents';
import { AgentEvents } from '../../../events/event-definitions/AgentEvents';
import { createStrictValidator } from '../../../utils/validation';
import { AgentId } from '../../../types/Agent';
import { ChannelId } from '../../../types/ChannelContext';
import { Observation, Reflection } from '../../../types/ControlLoopTypes';
import {
    normalizeOrparParameters,
    stripUnknownParameters,
    coerceArrayFields,
    ORPAR_ALLOWED_PROPERTIES
} from '../../../utils/ParameterNormalizer';

const logger = new Logger('info', 'OrparTools', 'server');

/**
 * Flag to track if agent disconnect listener has been registered
 * Prevents multiple subscriptions when tools are re-registered
 */
let agentDisconnectListenerRegistered = false;

/**
 * ORPAR phases in order
 */
export type OrparPhase = 'observe' | 'reason' | 'plan' | 'act' | 'reflect';

/**
 * Valid phase transitions
 */
const VALID_TRANSITIONS: Record<OrparPhase | 'initial', OrparPhase[]> = {
    'initial': ['observe'],                    // Must start with observe
    'observe': ['reason'],                     // After observing, must reason
    'reason': ['plan', 'observe'],             // After reasoning, plan (or re-observe if need more info)
    'plan': ['act', 'reason'],                 // After planning, act (or re-reason if plan needs revision)
    'act': ['reflect'],                        // After acting, must reflect
    'reflect': ['observe', 'act']              // After reflecting, observe again (or act again if reflection suggests retry)
};

/**
 * Agent ORPAR state tracking
 */
interface AgentOrparState {
    currentPhase: OrparPhase | null;
    loopId: string;
    cycleCount: number;
    phaseHistory: Array<{
        phase: OrparPhase;
        timestamp: number;
        content: string;
    }>;
    lastUpdated: number;
}

/**
 * State storage for agent ORPAR cycles
 *
 * NOTE ON CONCURRENCY: This Map is shared across all agent/channel combinations
 * but has no locking mechanism. In the current single-threaded Node.js model,
 * this is safe because JavaScript execution is synchronous within each event
 * loop tick. However, if two tool executions for the same agent/channel could
 * interleave (e.g., due to async operations), state corruption could occur.
 *
 * For production deployments with high concurrency requirements, consider:
 * 1. Using Redis or another distributed store with atomic operations
 * 2. Implementing a mutex/lock pattern per agent:channel key
 * 3. Using transactions for multi-step state updates
 *
 * Current mitigations:
 * - Each agent:channel pair has isolated state
 * - State updates are synchronous within tool handlers
 * - ORPAR tools enforce sequential phase transitions
 */
const agentOrparStates = new Map<string, AgentOrparState>();

/**
 * Get or create ORPAR state for an agent
 */
function getAgentOrparState(agentId: string, channelId: string): AgentOrparState {
    const key = `${agentId}:${channelId}`;
    let state = agentOrparStates.get(key);

    if (!state) {
        state = {
            currentPhase: null,
            loopId: uuidv4(),
            cycleCount: 0,
            phaseHistory: [],
            lastUpdated: Date.now()
        };
        agentOrparStates.set(key, state);
    }

    return state;
}

/**
 * Validate phase transition
 */
function validatePhaseTransition(currentPhase: OrparPhase | null, nextPhase: OrparPhase): { valid: boolean; error?: string } {
    const from = currentPhase || 'initial';
    const validNextPhases = VALID_TRANSITIONS[from];

    if (!validNextPhases.includes(nextPhase)) {
        const expected = validNextPhases.join(' or ');
        return {
            valid: false,
            error: `Invalid ORPAR transition: Cannot go from '${from}' to '${nextPhase}'. Expected: ${expected}`
        };
    }

    return { valid: true };
}

/**
 * Create a structured Observation object for server validation
 */
function createObservationObject(agentId: string, content: string): Observation {
    const validator = createStrictValidator('OrparTools.createObservationObject');
    validator.assertIsNonEmptyString(agentId, 'agentId is required');
    validator.assertIsNonEmptyString(content, 'observation content is required');

    return {
        id: uuidv4(),
        agentId: agentId as AgentId,
        source: 'orpar_tools',
        content: content,
        timestamp: Date.now(),
        metadata: {
            origin: 'agent-driven-orpar'
        }
    };
}

/**
 * Create a structured Reflection object for server validation
 */
function createReflectionObject(agentId: string, loopId: string, content: string, learnings?: string[]): Reflection {
    const validator = createStrictValidator('OrparTools.createReflectionObject');
    validator.assertIsNonEmptyString(agentId, 'agentId is required');
    validator.assertIsNonEmptyString(loopId, 'loopId is required');
    validator.assertIsNonEmptyString(content, 'reflection content is required');

    return {
        id: uuidv4(),
        agentId: agentId as AgentId,
        planId: loopId, // Use loopId as planId for ORPAR-driven reflections
        success: true, // ORPAR reflections are documentation, not success/failure
        insights: learnings || [content.substring(0, 200)],
        improvements: [],
        timestamp: Date.now(),
        metadata: {
            origin: 'agent-driven-orpar',
            fullContent: content
        }
    };
}

/**
 * Create a structured action object for server validation
 */
function createActionObject(agentId: string, content: string, toolUsed?: string): Record<string, any> {
    const validator = createStrictValidator('OrparTools.createActionObject');
    validator.assertIsNonEmptyString(agentId, 'agentId is required');
    validator.assertIsNonEmptyString(content, 'action content is required');

    return {
        id: uuidv4(),
        agentId: agentId,
        description: content,
        action: toolUsed || 'orpar_act',
        parameters: {},
        priority: 1,
        status: 'completed',
        timestamp: Date.now(),
        metadata: {
            origin: 'agent-driven-orpar'
        }
    };
}

/**
 * Update agent ORPAR state and emit ORPAR event
 *
 * Note: This emits OrparEvents (orpar:*) which are DISTINCT from ControlLoopEvents.
 * This prevents duplicate events when both agent-driven ORPAR tools and
 * server-orchestrated ControlLoop are active.
 */
function updateOrparState(
    agentId: string,
    channelId: string,
    phase: OrparPhase,
    content: string,
    eventType: string,
    additionalData?: { learnings?: string[]; toolUsed?: string; phaseData?: Record<string, any> }
): AgentOrparState {
    const validator = createStrictValidator('OrparTools.updateOrparState');
    validator.assertIsNonEmptyString(agentId, 'agentId is required');
    validator.assertIsNonEmptyString(channelId, 'channelId is required');
    validator.assertIsNonEmptyString(content, 'content is required');
    validator.assertIsNonEmptyString(eventType, 'eventType is required');

    const state = getAgentOrparState(agentId, channelId);

    // Update state
    state.currentPhase = phase;
    state.lastUpdated = Date.now();
    state.phaseHistory.push({
        phase,
        timestamp: Date.now(),
        content: content.substring(0, 500) // Truncate for storage
    });

    // Keep history bounded
    if (state.phaseHistory.length > 50) {
        state.phaseHistory = state.phaseHistory.slice(-50);
    }

    // Increment cycle count when starting new observation
    if (phase === 'observe' && state.phaseHistory.length > 1) {
        state.cycleCount++;
    }

    // Build ORPAR-specific payload (simpler than ControlLoop payloads)
    const payload = {
        eventId: uuidv4(),
        eventType: eventType,
        agentId: agentId,
        channelId: channelId,
        timestamp: Date.now(),
        loopId: state.loopId,
        cycleNumber: state.cycleCount,
        data: {
            phase: phase,
            content: content,
            ...additionalData?.phaseData
        }
    };

    // Emit to server EventBus for forwarding to clients
    EventBus.server.emit(eventType, payload);
    logger.debug(`[ORPAR] ${agentId} -> ${phase.toUpperCase()} (cycle ${state.cycleCount})`);

    return state;
}

/**
 * Get phase guidance for the agent
 * Provides explicit next-step guidance to help agents navigate the one-directional ORPAR loop
 */
function getPhaseGuidance(phase: OrparPhase, allowedTools?: string[]): string {
    // Explicit next-tool guidance - critical for phase-gated mode
    // Agents must be told exactly what tool to call next since other tools are blocked
    const guidance: Record<OrparPhase, string> = {
        observe: 'Observation recorded. You MUST call orpar_reason next. No other ORPAR tools will work.',
        reason: 'Reasoning recorded. You MUST call orpar_plan next. No other ORPAR tools will work.',
        plan: 'Plan recorded. You MUST call orpar_act next. No other ORPAR tools will work.',
        act: 'Action documented. You MUST call orpar_reflect next. No other ORPAR tools will work.',
        // Dynamic guidance for reflect phase based on available tools
        reflect: allowedTools?.includes('task_complete')
            ? 'Reflection recorded. ORPAR cycle complete. You MUST call task_complete now to finish your turn.'
            : 'Reflection recorded. ORPAR cycle complete. Your turn is finished.'
    };
    return guidance[phase];
}

// =============================================================================
// ORPAR TOOLS
// =============================================================================

/**
 * OBSERVE - Document observations about the current situation
 */
export const orparObserveTool = {
    name: 'orpar_observe',
    description: `STEP 1 of 5 in ORPAR cycle. Document your observations about the current situation.

ORPAR is a ONE-DIRECTIONAL loop: OBSERVE → REASON → PLAN → ACT → REFLECT → task_complete
You MUST complete ALL steps in order. Other tools will be BLOCKED if you try to skip ahead.
Even if a step feels unnecessary, you must call it to progress to the next phase.

Use this tool to record:
- What you see/perceive in the current state
- Relevant information from the environment
- Key facts that will inform your decisions

AFTER THIS TOOL: You MUST call 'orpar_reason' next. No other ORPAR tools will work.

IMPORTANT - Parameter format:
- Use "observations" (string) for your main observation text
- Use "keyFacts" as an ARRAY of strings: ["fact1", "fact2", "fact3"]
- Do NOT use numbered properties like keyFact1, keyFact2, etc.
- Do NOT add properties not in the schema (like "confidence" or "nextSteps")`,
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            observations: {
                type: 'string',
                description: 'Your observations about the current situation. Be specific and factual.',
                minLength: 10
            },
            keyFacts: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of key facts as a JSON array. Use ["fact1", "fact2"] format - do NOT use numbered properties like keyFact1, keyFact2.'
            },
            context: {
                type: 'string',
                description: 'Optional context about what triggered this observation'
            }
        },
        required: ['observations'],
        additionalProperties: false
    },
    examples: [
        {
            input: {
                observations: 'The question history shows 3 questions asked. Q1: "Is it alive?" -> YES. Q2: "Is it a mammal?" -> YES. Q3: "Is it larger than a dog?" -> NO.',
                keyFacts: ['The secret is alive', 'It is a mammal', 'It is smaller than a dog']
            },
            description: 'Observing the game state in Twenty Questions'
        }
    ],
    metadata: {
        category: 'orpar',
        timeout: 5000,
        phase: 'observe'
    },

    async handler(rawInput: { observations: string; keyFacts?: string[]; context?: string }, context: any): Promise<any> {
        // Step 1: Normalize parameter names (map common LLM variations)
        const normalizedInput = normalizeOrparParameters('orpar_observe', rawInput);
        // Step 2: Strip unknown parameters (prevent additionalProperties errors from LLM hallucinations)
        const strippedInput = stripUnknownParameters('orpar_observe', normalizedInput, ORPAR_ALLOWED_PROPERTIES.orpar_observe);
        // Step 3: Coerce arrays
        const input = coerceArrayFields(strippedInput, ['keyFacts']);

        const agentId = context?._agentId || context?.agentId || 'unknown';
        const channelId = context?._channelId || context?.channelId || 'unknown';

        // Validate transition
        const state = getAgentOrparState(agentId, channelId);
        const validation = validatePhaseTransition(state.currentPhase, 'observe');

        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                currentPhase: state.currentPhase,
                hint: 'Complete the current phase before starting a new observation cycle.'
            };
        }

        // Update state and emit event
        const updatedState = updateOrparState(
            agentId,
            channelId,
            'observe',
            input.observations,
            OrparEvents.OBSERVE,
            { phaseData: { observations: input.observations, keyFacts: input.keyFacts, context: input.context } }
        );

        return {
            success: true,
            phase: 'observe',
            cycleNumber: updatedState.cycleCount,
            loopId: updatedState.loopId,
            recorded: {
                observations: input.observations,
                keyFacts: input.keyFacts || [],
                context: input.context
            },
            nextPhase: 'reason',
            guidance: getPhaseGuidance('observe'),
            timestamp: Date.now()
        };
    }
};

/**
 * REASON - Analyze observations and form conclusions
 */
export const orparReasonTool = {
    name: 'orpar_reason',
    description: `STEP 2 of 5 in ORPAR cycle. Document your reasoning and analysis.

ORPAR is a ONE-DIRECTIONAL loop: OBSERVE → REASON → PLAN → ACT → REFLECT → task_complete
You MUST complete ALL steps in order. Other tools will be BLOCKED if you try to skip ahead or go back.
Even if a step feels unnecessary, you must call it to progress to the next phase.

Use this tool to record:
- Analysis of your observations
- Patterns you've identified
- Hypotheses and conclusions
- Considerations for next steps

AFTER THIS TOOL: You MUST call 'orpar_plan' next. No other ORPAR tools will work.

IMPORTANT - Parameter format:
- The parameter is "analysis" (NOT "reasoning", "thinking", or "thought")
- "conclusions" is an array: ["conclusion1", "conclusion2"]
- "confidence" is optional (0-1 NUMBER like 0.8) - NOT a string
- Do NOT add "nextSteps", "strategy", "keyFindings", or other undefined properties`,
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            analysis: {
                type: 'string',
                description: 'Your analysis and reasoning based on observations. Use this parameter name exactly - NOT "reasoning" or "thinking".',
                minLength: 10
            },
            conclusions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Key conclusions from your analysis as a JSON array'
            },
            confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Optional confidence level in your reasoning (0-1)'
            },
            alternatives: {
                type: 'array',
                items: { type: 'string' },
                description: 'Alternative interpretations considered as a JSON array'
            }
        },
        required: ['analysis'],
        additionalProperties: false
    },
    examples: [
        {
            input: {
                analysis: 'Based on the answers, the secret is a small mammal. Common small mammals include: cats, rabbits, hamsters, mice, squirrels. The category hint was "pet", which narrows it to domestic animals.',
                conclusions: ['It is a small domestic mammal', 'Most likely a cat, rabbit, or hamster'],
                confidence: 0.7
            },
            description: 'Reasoning about possibilities in Twenty Questions'
        }
    ],
    metadata: {
        category: 'orpar',
        timeout: 5000,
        phase: 'reason'
    },

    async handler(rawInput: { analysis: string; conclusions?: string[]; confidence?: number; alternatives?: string[] }, context: any): Promise<any> {
        // Step 1: Normalize parameter names (map common LLM variations)
        const normalizedInput = normalizeOrparParameters('orpar_reason', rawInput);
        // Step 2: Strip unknown parameters (prevent additionalProperties errors from LLM hallucinations)
        const strippedInput = stripUnknownParameters('orpar_reason', normalizedInput, ORPAR_ALLOWED_PROPERTIES.orpar_reason);
        // Step 3: Coerce arrays
        const input = coerceArrayFields(strippedInput, ['conclusions', 'alternatives']);

        const agentId = context?._agentId || context?.agentId || 'unknown';
        const channelId = context?._channelId || context?.channelId || 'unknown';

        // Validate transition
        const state = getAgentOrparState(agentId, channelId);
        const validation = validatePhaseTransition(state.currentPhase, 'reason');

        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                currentPhase: state.currentPhase,
                hint: state.currentPhase === null
                    ? 'You must OBSERVE first before reasoning.'
                    : `Complete the ${state.currentPhase} phase first.`
            };
        }

        // Update state and emit event
        const updatedState = updateOrparState(
            agentId,
            channelId,
            'reason',
            input.analysis,
            OrparEvents.REASON,
            { phaseData: { analysis: input.analysis, conclusions: input.conclusions, confidence: input.confidence, alternatives: input.alternatives } }
        );

        return {
            success: true,
            phase: 'reason',
            cycleNumber: updatedState.cycleCount,
            loopId: updatedState.loopId,
            recorded: {
                analysis: input.analysis,
                conclusions: input.conclusions || [],
                confidence: input.confidence ?? 0.5,
                alternatives: input.alternatives || []
            },
            nextPhase: 'plan',
            guidance: getPhaseGuidance('reason'),
            timestamp: Date.now()
        };
    }
};

/**
 * PLAN - Create an action plan
 */
export const orparPlanTool = {
    name: 'orpar_plan',
    description: `STEP 3 of 5 in ORPAR cycle. Document your action plan.

ORPAR is a ONE-DIRECTIONAL loop: OBSERVE → REASON → PLAN → ACT → REFLECT → task_complete
You MUST complete ALL steps in order. Other tools will be BLOCKED if you try to skip ahead or go back.
Even if a step feels unnecessary, you must call it to progress to the next phase.

Use this tool to record:
- What actions you will take
- The expected outcomes
- Contingency considerations

AFTER THIS TOOL: You MUST call 'orpar_act' next. No other ORPAR tools will work.

IMPORTANT - Parameter format:
- The parameter is "plan" (NOT "planning", "strategy", or "approach")
- "actions" is an array of OBJECTS [{action: "..."}], NOT strings
- Do NOT include "confidence", "keyDecisions", "readinessCheck", "description", or undefined properties`,
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            plan: {
                type: 'string',
                description: 'Your plan of action. Use this parameter name exactly - NOT "planning", "strategy", or "approach".',
                minLength: 10
            },
            actions: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        action: { type: 'string' },
                        tool: { type: 'string' },
                        expectedOutcome: { type: 'string' }
                    },
                    required: ['action']
                },
                description: 'Specific actions to take as an array. Do NOT use "nextSteps" or "steps" as the property name.'
            },
            rationale: {
                type: 'string',
                description: 'Why this plan was chosen'
            },
            contingency: {
                type: 'string',
                description: 'What to do if the plan fails'
            }
        },
        required: ['plan'],
        additionalProperties: false
    },
    examples: [
        {
            input: {
                plan: 'Ask whether the animal can be held in one hand to distinguish between cat/rabbit (no) and hamster/mouse (yes).',
                actions: [
                    { action: 'Ask size question', tool: 'game_askQuestion', expectedOutcome: 'Narrow down to 2-3 possibilities' }
                ],
                rationale: 'This question will eliminate roughly half the remaining possibilities.'
            },
            description: 'Planning a strategic question in Twenty Questions'
        }
    ],
    metadata: {
        category: 'orpar',
        timeout: 5000,
        phase: 'plan'
    },

    async handler(rawInput: { plan: string; actions?: any[]; rationale?: string; contingency?: string }, context: any): Promise<any> {
        // Step 1: Normalize parameter names (handles LLM variations like nextSteps -> actions)
        const normalizedInput = normalizeOrparParameters('orpar_plan', rawInput);
        // Step 2: Strip unknown parameters (prevent additionalProperties errors from LLM hallucinations)
        const input = stripUnknownParameters('orpar_plan', normalizedInput, ORPAR_ALLOWED_PROPERTIES.orpar_plan);

        const agentId = context?._agentId || context?.agentId || 'unknown';
        const channelId = context?._channelId || context?.channelId || 'unknown';

        // Validate transition
        const state = getAgentOrparState(agentId, channelId);
        const validation = validatePhaseTransition(state.currentPhase, 'plan');

        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                currentPhase: state.currentPhase,
                hint: state.currentPhase === null
                    ? 'You must OBSERVE and REASON first before planning.'
                    : state.currentPhase === 'observe'
                    ? 'You must REASON about your observations before planning.'
                    : `Complete the ${state.currentPhase} phase first.`
            };
        }

        // Update state and emit event
        const updatedState = updateOrparState(
            agentId,
            channelId,
            'plan',
            input.plan,
            OrparEvents.PLAN,
            { phaseData: { plan: input.plan, actions: input.actions, rationale: input.rationale, contingency: input.contingency } }
        );

        return {
            success: true,
            phase: 'plan',
            cycleNumber: updatedState.cycleCount,
            loopId: updatedState.loopId,
            recorded: {
                plan: input.plan,
                actions: input.actions || [],
                rationale: input.rationale,
                contingency: input.contingency
            },
            nextPhase: 'act',
            guidance: getPhaseGuidance('plan'),
            timestamp: Date.now()
        };
    }
};

/**
 * ACT - Document the action you executed
 */
export const orparActTool = {
    name: 'orpar_act',
    description: `STEP 4 of 5 in ORPAR cycle. Document the action you executed.

ORPAR is a ONE-DIRECTIONAL loop: OBSERVE → REASON → PLAN → ACT → REFLECT → task_complete
You MUST complete ALL steps in order. Other tools will be BLOCKED if you try to skip ahead or go back.
Even if a step feels unnecessary, you must call it to progress to the next phase.

Use this tool to record:
- What action you took (past tense)
- Which tool you used
- The outcome/result

AFTER THIS TOOL: You MUST call 'orpar_reflect' next. No other ORPAR tools will work.

IMPORTANT - Parameter format:
- Use "action" (string) - NOT "actions" (array)
- Use "toolUsed" (singular) - NOT "toolsUsed" (plural)
- Use "outcome" for the result - NOT "result" or "expectedOutcome"
- Do NOT include "confidence" or other undefined properties`,
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Description of the action taken. Use "action" (singular string) - NOT "actions" (array).',
                minLength: 5
            },
            toolUsed: {
                type: 'string',
                description: 'Name of the tool that was used. Use "toolUsed" - NOT "toolsUsed" or "tool".'
            },
            outcome: {
                type: 'string',
                description: 'The actual outcome of the action. Use "outcome" - NOT "result" or "expectedOutcome".'
            },
            success: {
                type: 'boolean',
                description: 'Whether the action succeeded'
            }
        },
        required: ['action'],
        additionalProperties: false
    },
    examples: [
        {
            input: {
                action: 'Asked "Can it be held in one hand?"',
                toolUsed: 'game_askQuestion',
                outcome: 'Answer was YES',
                success: true
            },
            description: 'Recording a question action in Twenty Questions'
        }
    ],
    metadata: {
        category: 'orpar',
        timeout: 5000,
        phase: 'act'
    },

    async handler(rawInput: { action: string; toolUsed?: string; outcome?: string; success?: boolean }, context: any): Promise<any> {
        // Step 1: Normalize parameter names (handles LLM variations like toolsUsed -> toolUsed)
        const normalizedInput = normalizeOrparParameters('orpar_act', rawInput);
        // Step 2: Strip unknown parameters (prevent additionalProperties errors from LLM hallucinations)
        const input = stripUnknownParameters('orpar_act', normalizedInput, ORPAR_ALLOWED_PROPERTIES.orpar_act);

        const agentId = context?._agentId || context?.agentId || 'unknown';
        const channelId = context?._channelId || context?.channelId || 'unknown';

        // Validate transition
        const state = getAgentOrparState(agentId, channelId);
        const validation = validatePhaseTransition(state.currentPhase, 'act');

        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                currentPhase: state.currentPhase,
                hint: state.currentPhase === null
                    ? 'You must complete OBSERVE → REASON → PLAN before acting.'
                    : state.currentPhase === 'observe'
                    ? 'You must REASON and PLAN before acting.'
                    : state.currentPhase === 'reason'
                    ? 'You must PLAN before acting.'
                    : `Complete the ${state.currentPhase} phase first.`
            };
        }

        // Update state and emit event
        const updatedState = updateOrparState(
            agentId,
            channelId,
            'act',
            input.action,
            OrparEvents.ACT,
            { toolUsed: input.toolUsed, phaseData: { action: input.action, toolUsed: input.toolUsed, outcome: input.outcome, success: input.success } }
        );

        return {
            success: true,
            phase: 'act',
            cycleNumber: updatedState.cycleCount,
            loopId: updatedState.loopId,
            recorded: {
                action: input.action,
                toolUsed: input.toolUsed,
                outcome: input.outcome,
                actionSuccess: input.success ?? true
            },
            nextPhase: 'reflect',
            guidance: getPhaseGuidance('act'),
            timestamp: Date.now()
        };
    }
};

/**
 * REFLECT - Record results and learn from the action
 */
export const orparReflectTool = {
    name: 'orpar_reflect',
    description: `STEP 5 of 5 in ORPAR cycle (FINAL STEP). Record results and reflect on what happened.

ORPAR is a ONE-DIRECTIONAL loop: OBSERVE → REASON → PLAN → ACT → REFLECT → task_complete
You MUST complete ALL steps in order. Other tools will be BLOCKED if you try to go back.
Even if a step feels unnecessary, you must call it to complete the cycle.

Use this tool to document:
- The outcome of your action
- What you learned
- Whether expectations were met
- Adjustments for future actions

AFTER THIS TOOL: Call 'task_complete' to signal you have finished your turn/task.
This completes the ORPAR cycle. Do NOT try to call orpar_observe again for a new cycle.

IMPORTANT - Parameter format:
- Use "reflection" (singular, string) - NOT "reflections" (plural)
- Use "learnings" as an array: ["learning1", "learning2"]
- Use "adjustments" for changes - NOT "nextSteps"
- Do NOT include "confidence", "whatLearned", "keyInsights", "deductions", "readiness", or undefined properties`,
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            reflection: {
                type: 'string',
                description: 'Your reflection on what happened and what you learned. Use "reflection" (singular) - NOT "reflections".',
                minLength: 10
            },
            learnings: {
                type: 'array',
                items: { type: 'string' },
                description: 'Key learnings as a JSON array. Use ["learning1", "learning2"] format - do NOT use "whatLearned" as a string.'
            },
            expectationsMet: {
                type: 'boolean',
                description: 'Whether the outcome matched expectations'
            },
            adjustments: {
                type: 'string',
                description: 'What to adjust in the next cycle. Use "adjustments" - NOT "nextSteps".'
            }
        },
        required: ['reflection'],
        additionalProperties: false
    },
    examples: [
        {
            input: {
                reflection: 'The YES answer confirms it is a very small animal that can be held. Combined with "pet" category, this strongly suggests hamster, mouse, or guinea pig. Guinea pig might be too big, so likely hamster or mouse.',
                learnings: ['Size question was highly effective', 'Can now narrow to 2-3 specific animals'],
                expectationsMet: true,
                adjustments: 'Next question should distinguish between hamster and mouse.'
            },
            description: 'Reflecting on a question outcome in Twenty Questions'
        }
    ],
    metadata: {
        category: 'orpar',
        timeout: 5000,
        phase: 'reflect'
    },

    async handler(rawInput: { reflection: string; learnings?: string[]; expectationsMet?: boolean; adjustments?: string }, context: any): Promise<any> {
        // Step 1: Normalize parameter names (map common LLM variations)
        const normalizedInput = normalizeOrparParameters('orpar_reflect', rawInput);
        // Step 2: Strip unknown parameters (prevent additionalProperties errors from LLM hallucinations)
        const strippedInput = stripUnknownParameters('orpar_reflect', normalizedInput, ORPAR_ALLOWED_PROPERTIES.orpar_reflect);
        // Step 3: Coerce arrays
        const input = coerceArrayFields(strippedInput, ['learnings']);

        const agentId = context?._agentId || context?.agentId || 'unknown';
        const channelId = context?._channelId || context?.channelId || 'unknown';

        // Validate transition
        const state = getAgentOrparState(agentId, channelId);
        const validation = validatePhaseTransition(state.currentPhase, 'reflect');

        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                currentPhase: state.currentPhase,
                hint: state.currentPhase === null
                    ? 'You must complete a full ORPAR cycle before reflecting.'
                    : `Complete the ${state.currentPhase} phase and ACT before reflecting.`
            };
        }

        // Update state and emit event
        const updatedState = updateOrparState(
            agentId,
            channelId,
            'reflect',
            input.reflection,
            OrparEvents.REFLECT,
            { learnings: input.learnings, phaseData: { reflection: input.reflection, learnings: input.learnings, expectationsMet: input.expectationsMet, adjustments: input.adjustments } }
        );

        return {
            success: true,
            phase: 'reflect',
            cycleNumber: updatedState.cycleCount,
            loopId: updatedState.loopId,
            recorded: {
                reflection: input.reflection,
                learnings: input.learnings || [],
                expectationsMet: input.expectationsMet,
                adjustments: input.adjustments
            },
            cycleComplete: true,
            nextPhase: 'observe',
            guidance: getPhaseGuidance('reflect', context?.allowedTools || context?._allowedTools),
            cycleSummary: {
                totalPhases: updatedState.phaseHistory.length,
                cyclesCompleted: updatedState.cycleCount
            },
            timestamp: Date.now()
        };
    }
};

/**
 * Get current ORPAR state for an agent (utility tool)
 */
export const orparStatusTool = {
    name: 'orpar_status',
    description: `Check your current position in the ORPAR cycle.

The ORPAR cycle is: OBSERVE → REASON → PLAN → ACT → REFLECT → task_complete
This tool tells you which phase you just completed and what you should call next.`,
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
    },
    examples: [
        {
            input: {},
            description: 'Check current status'
        }
    ],
    metadata: {
        category: 'orpar',
        timeout: 5000
    },

    async handler(input: {}, context: any): Promise<any> {
        const agentId = context?._agentId || context?.agentId || 'unknown';
        const channelId = context?._channelId || context?.channelId || 'unknown';
        const rawAllowedTools = context?.allowedTools || context?._allowedTools || [];
        // Ensure allowedTools is an array (defensive check for edge cases)
        const allowedTools: string[] = Array.isArray(rawAllowedTools) ? rawAllowedTools : [];

        const state = getAgentOrparState(agentId, channelId);

        // Detect stale state: if orpar_observe is allowed but current phase tool isn't,
        // this means we're in a new task but have leftover state from previous task
        const isOrparObserveAllowed = allowedTools.includes('orpar_observe');
        const currentPhaseTool = state.currentPhase ? `orpar_${state.currentPhase}` : null;
        const isCurrentPhaseToolAllowed = currentPhaseTool && allowedTools.includes(currentPhaseTool);

        if (isOrparObserveAllowed && state.currentPhase !== null && !isCurrentPhaseToolAllowed) {
            // State is stale from previous task - reset it
            const key = `${agentId}:${channelId}`;
            agentOrparStates.delete(key);
            logger.debug(`[ORPAR] Cleared stale state for ${key} - was in ${state.currentPhase} but orpar_observe is allowed`);

            return {
                currentPhase: 'none',
                loopId: null,
                cycleCount: 0,
                recentHistory: [],
                nextTool: 'orpar_observe',
                guidance: 'Starting new ORPAR cycle. Call orpar_observe to begin.',
                note: 'Previous cycle state cleared - new task detected.',
                reminder: 'ORPAR is a one-directional loop. Complete all phases in order.',
                timestamp: Date.now()
            };
        }

        // Provide explicit next-step guidance based on current phase
        const nextToolMap: Record<string, string> = {
            'none': 'orpar_observe',
            'observe': 'orpar_reason',
            'reason': 'orpar_plan',
            'plan': 'orpar_act',
            'act': 'orpar_reflect',
            'reflect': 'task_complete'
        };

        const currentPhase = state.currentPhase || 'none';
        const nextTool = nextToolMap[currentPhase] || 'orpar_observe';

        return {
            currentPhase: currentPhase,
            loopId: state.loopId,
            cycleCount: state.cycleCount,
            recentHistory: state.phaseHistory.slice(-5).map(h => ({
                phase: h.phase,
                timestamp: h.timestamp
            })),
            nextTool: nextTool,
            guidance: currentPhase === 'none'
                ? 'You have not started an ORPAR cycle. Call orpar_observe to begin.'
                : currentPhase === 'reflect'
                    ? 'ORPAR cycle complete. Call task_complete to finish your turn.'
                    : `You just completed ${currentPhase.toUpperCase()}. You MUST call ${nextTool} next.`,
            reminder: 'ORPAR is a one-directional loop. You cannot go back to previous phases.',
            timestamp: Date.now()
        };
    }
};

/**
 * Export all ORPAR tools
 */
export const orparTools = [
    orparObserveTool,
    orparReasonTool,
    orparPlanTool,
    orparActTool,
    orparReflectTool,
    orparStatusTool
];

/**
 * Export tool names for easy reference
 */
export const ORPAR_TOOL_NAMES = {
    OBSERVE: 'orpar_observe',
    REASON: 'orpar_reason',
    PLAN: 'orpar_plan',
    ACT: 'orpar_act',
    REFLECT: 'orpar_reflect',
    STATUS: 'orpar_status'
} as const;

/**
 * Utility to clear ORPAR state for an agent (for testing/reset)
 */
export function clearAgentOrparState(agentId: string, channelId: string): void {
    const key = `${agentId}:${channelId}`;
    agentOrparStates.delete(key);
    logger.debug(`[ORPAR] Cleared state for ${key}`);
}

/**
 * Utility to get all agent ORPAR states (for debugging/monitoring)
 */
export function getAllOrparStates(): Map<string, AgentOrparState> {
    return new Map(agentOrparStates);
}

/**
 * Clear all ORPAR states for a specific agent (across all channels)
 * Called when an agent disconnects to prevent memory leaks
 */
export function clearAllAgentOrparStates(agentId: string): number {
    let clearedCount = 0;
    const keysToDelete: string[] = [];

    for (const key of agentOrparStates.keys()) {
        if (key.startsWith(`${agentId}:`)) {
            keysToDelete.push(key);
        }
    }

    for (const key of keysToDelete) {
        agentOrparStates.delete(key);
        clearedCount++;
    }

    if (clearedCount > 0) {
        logger.debug(`[ORPAR] Cleared ${clearedCount} state(s) for disconnected agent ${agentId}`);
    }

    return clearedCount;
}

/**
 * Register EventBus listener for agent disconnection to clean up ORPAR state
 * Prevents memory leaks from accumulating agent states
 */
export function registerAgentDisconnectCleanup(): void {
    if (agentDisconnectListenerRegistered) {
        return; // Already registered
    }

    try {
        // Use server EventBus for agent disconnect events (server-side only)
        EventBus.server.on(AgentEvents.DISCONNECTED, (payload: any) => {
            const agentId = payload?.agentId || payload?.data?.agentId;
            if (agentId) {
                clearAllAgentOrparStates(agentId);
            }
        });
        agentDisconnectListenerRegistered = true;
        logger.debug('[ORPAR] Registered agent disconnect cleanup listener');
    } catch (error) {
        // EventBus may not be available in all contexts (e.g., unit tests)
        logger.debug('[ORPAR] Could not register agent disconnect cleanup - EventBus not available');
    }
}

// Auto-register the cleanup listener when module is loaded
// Uses setTimeout to allow EventBus to be initialized first
// Skip in test environment to avoid "Cannot log after tests are done" warnings
if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => {
        registerAgentDisconnectCleanup();
    }, 0);
}
