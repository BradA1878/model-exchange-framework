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
 * ORPAR Events - Agent-Driven Cognitive Documentation
 *
 * These events are emitted when agents explicitly call orpar_* tools to document
 * their cognitive process. They are DISTINCT from ControlLoopEvents which are
 * emitted by the server-orchestrated control loop system.
 *
 * Use Cases:
 * - Agent calls orpar_observe to document observations → emits ORPAR_OBSERVE
 * - Agent calls orpar_reason to document analysis → emits ORPAR_REASON
 * - Agent calls orpar_plan to document strategy → emits ORPAR_PLAN
 * - Agent calls orpar_act to document action taken → emits ORPAR_ACT
 * - Agent calls orpar_reflect to document learnings → emits ORPAR_REFLECT
 *
 * This separation allows:
 * 1. Clear distinction between agent-driven vs server-orchestrated events
 * 2. Consumers can subscribe to one or both event streams
 * 3. Dashboard can visualize both streams distinctly
 * 4. No duplicate events from multiple systems
 */
export const OrparEvents = {
    /** Agent documented an observation using orpar_observe tool */
    OBSERVE: 'orpar:observe',

    /** Agent documented reasoning/analysis using orpar_reason tool */
    REASON: 'orpar:reason',

    /** Agent documented a plan using orpar_plan tool */
    PLAN: 'orpar:plan',

    /** Agent documented an action using orpar_act tool */
    ACT: 'orpar:act',

    /** Agent documented reflection/learnings using orpar_reflect tool */
    REFLECT: 'orpar:reflect',

    /** Agent requested ORPAR status using orpar_status tool */
    STATUS: 'orpar:status',

    /** Error occurred during ORPAR tool execution */
    ERROR: 'orpar:error',

    /** Request to clear ORPAR state for an agent (start fresh cycle) */
    CLEAR_STATE: 'orpar:clearState',
} as const;

/**
 * Type for ORPAR event names
 */
export type OrparEventName = typeof OrparEvents[keyof typeof OrparEvents];

/**
 * Base payload for all ORPAR events
 */
export interface OrparBasePayload {
    /** Unique event ID */
    eventId: string;
    /** Event type (orpar:observe, orpar:reason, etc.) */
    eventType: OrparEventName;
    /** Agent who emitted this event */
    agentId: string;
    /** Channel where the agent is operating */
    channelId: string;
    /** Timestamp of the event */
    timestamp: number;
    /** ORPAR loop ID for correlating events in a cycle */
    loopId: string;
    /** Current cycle number (increments each time observe is called after reflect) */
    cycleNumber: number;
}

/**
 * Payload for ORPAR_OBSERVE event
 */
export interface OrparObservePayload extends OrparBasePayload {
    eventType: typeof OrparEvents.OBSERVE;
    data: {
        /** The observation content documented by the agent */
        observations: string;
        /** Key facts extracted from observations */
        keyFacts?: string[];
        /** Context about what triggered this observation */
        context?: string;
    };
}

/**
 * Payload for ORPAR_REASON event
 */
export interface OrparReasonPayload extends OrparBasePayload {
    eventType: typeof OrparEvents.REASON;
    data: {
        /** The reasoning/analysis documented by the agent */
        analysis: string;
        /** Key conclusions from the analysis */
        conclusions?: string[];
        /** Confidence level (0-1) */
        confidence?: number;
        /** Alternative interpretations considered */
        alternatives?: string[];
    };
}

/**
 * Payload for ORPAR_PLAN event
 */
export interface OrparPlanPayload extends OrparBasePayload {
    eventType: typeof OrparEvents.PLAN;
    data: {
        /** The plan documented by the agent */
        plan: string;
        /** Specific actions planned */
        actions?: Array<{
            action: string;
            tool?: string;
            expectedOutcome?: string;
        }>;
        /** Rationale for choosing this plan */
        rationale?: string;
        /** Contingency if plan fails */
        contingency?: string;
    };
}

/**
 * Payload for ORPAR_ACT event
 */
export interface OrparActPayload extends OrparBasePayload {
    eventType: typeof OrparEvents.ACT;
    data: {
        /** Description of the action taken */
        action: string;
        /** Tool that was used (if any) */
        toolUsed?: string;
        /** Outcome of the action */
        outcome?: string;
        /** Whether the action succeeded */
        success?: boolean;
    };
}

/**
 * Payload for ORPAR_REFLECT event
 */
export interface OrparReflectPayload extends OrparBasePayload {
    eventType: typeof OrparEvents.REFLECT;
    data: {
        /** The reflection content documented by the agent */
        reflection: string;
        /** Key learnings from this cycle */
        learnings?: string[];
        /** Whether expectations were met */
        expectationsMet?: boolean;
        /** Adjustments for next cycle */
        adjustments?: string;
    };
}

/**
 * Payload for ORPAR_STATUS event
 */
export interface OrparStatusPayload extends OrparBasePayload {
    eventType: typeof OrparEvents.STATUS;
    data: {
        /** Current phase in the ORPAR cycle */
        currentPhase: 'observe' | 'reason' | 'plan' | 'act' | 'reflect' | null;
        /** Phase history for this agent */
        phaseHistory: Array<{
            phase: string;
            timestamp: number;
            content?: string;
        }>;
    };
}

/**
 * Payload for ORPAR_ERROR event
 */
export interface OrparErrorPayload extends OrparBasePayload {
    eventType: typeof OrparEvents.ERROR;
    data: {
        /** Error message */
        error: string;
        /** Phase where error occurred */
        phase?: string;
        /** Additional context */
        context?: Record<string, any>;
    };
}

/**
 * Payload for ORPAR_CLEAR_STATE event
 */
export interface OrparClearStatePayload extends OrparBasePayload {
    eventType: typeof OrparEvents.CLEAR_STATE;
    data: {
        /** Reason for clearing state */
        reason: string;
        /** Previous phase before clearing (for logging) */
        previousPhase?: string;
    };
}

/**
 * Union type for all ORPAR payloads
 */
export type OrparPayload =
    | OrparObservePayload
    | OrparReasonPayload
    | OrparPlanPayload
    | OrparActPayload
    | OrparReflectPayload
    | OrparStatusPayload
    | OrparErrorPayload
    | OrparClearStatePayload;

/**
 * Payload types for ORPAR events (indexed by event name)
 */
export interface OrparPayloads {
    'orpar:observe': OrparObservePayload;
    'orpar:reason': OrparReasonPayload;
    'orpar:plan': OrparPlanPayload;
    'orpar:act': OrparActPayload;
    'orpar:reflect': OrparReflectPayload;
    'orpar:status': OrparStatusPayload;
    'orpar:error': OrparErrorPayload;
    'orpar:clearState': OrparClearStatePayload;
}
