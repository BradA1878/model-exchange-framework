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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * SystemLLM stance
 *
 * The stance decides how SystemLLM talks to agents, and in one case how it
 * judges them:
 *
 * - `supportive` — the original behavior. Coordination hints are advisory and
 *   nothing SystemLLM says asks for a reply.
 * - `critical` — an honest skeptic. SystemLLM reads what agents did and
 *   challenges completion claims, plans, and reflections it cannot square with
 *   the evidence. The `systemllm-eval` completion judge demands evidence per
 *   objective. If there is nothing wrong, it says nothing.
 * - `hostile` — a test mode. SystemLLM issues plausible-but-wrong challenges
 *   and hints so an operator can measure whether agents verify before acting
 *   on system advice. Agents are told it is on; every hostile message is
 *   tagged; it never touches a decision (judge verdicts, task assignment).
 *
 * The server default comes from `SYSTEMLLM_STANCE`; a channel can carry its
 * own in `systemLlmStance`. These types are shared by the server (which
 * applies the stance), the SDK (which tells agents about it), and the channel
 * model (which persists it).
 */

/** Every stance, in the order the documentation lists them. */
export const SYSTEMLLM_STANCES = ['supportive', 'critical', 'hostile'] as const;

export type SystemLlmStance = typeof SYSTEMLLM_STANCES[number];

/** The stance when nothing sets one: today's behavior. */
export const DEFAULT_SYSTEMLLM_STANCE: SystemLlmStance = 'supportive';

/**
 * The ceiling when nothing sets one: no ceiling. `SYSTEMLLM_STANCE_MAX` lowers
 * it server-wide so that no channel, whatever its own stance says, goes
 * above it — `critical` keeps hostile out of production, `supportive` turns
 * challenges off everywhere without touching channel documents.
 */
export const DEFAULT_SYSTEMLLM_STANCE_CEILING: SystemLlmStance = 'hostile';

/** Stances from least to most adversarial; the index is the ordering. */
const STANCE_RANK: Record<SystemLlmStance, number> = { supportive: 0, critical: 1, hostile: 2 };

/** Whether `stance` is at or below `ceiling`. */
export function isStanceWithin(stance: SystemLlmStance, ceiling: SystemLlmStance): boolean {
    return STANCE_RANK[stance] <= STANCE_RANK[ceiling];
}

/** `stance`, lowered to `ceiling` when it is above it. */
export function capStance(stance: SystemLlmStance, ceiling: SystemLlmStance): SystemLlmStance {
    return isStanceWithin(stance, ceiling) ? stance : ceiling;
}

export function isSystemLlmStance(value: unknown): value is SystemLlmStance {
    return typeof value === 'string' && (SYSTEMLLM_STANCES as ReadonlyArray<string>).includes(value);
}

/**
 * Parse a stance from configuration text.
 *
 * @param value - Raw value, for example from an environment variable or a channel document
 * @param sourceName - What the value came from, for the error message (`SYSTEMLLM_STANCE`, `systemLlmStance`)
 * @throws Error when the value is blank or is not one of the stances
 */
export function parseSystemLlmStance(value: string, sourceName: string): SystemLlmStance {
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length === 0) {
        throw new Error(
            `${sourceName} is set but blank. Name a stance (${SYSTEMLLM_STANCES.join(', ')}), or remove it.`
        );
    }
    if (!isSystemLlmStance(trimmed)) {
        throw new Error(
            `Unsupported ${sourceName} '${value}'. Expected one of: ${SYSTEMLLM_STANCES.join(', ')}`
        );
    }
    return trimmed;
}

/**
 * What prompted a challenge.
 *
 * - `completion_claim` — the agent called `task_complete` reporting success
 * - `plan_posted` — the agent recorded a plan with `orpar_plan`
 * - `reflection_success` — the agent recorded a reflection with `orpar_reflect`
 *   that did not say expectations were missed
 */
export const CHALLENGE_TRIGGERS = ['completion_claim', 'plan_posted', 'reflection_success'] as const;

export type ChallengeTrigger = typeof CHALLENGE_TRIGGERS[number];

/** How a challenge reached the agent. */
export type ChallengeDelivery = 'tool_result' | 'channel_message';

/** One thing SystemLLM disputes. */
export interface SystemLlmChallengePoint {
    /** The agent's claim, quoted or paraphrased. */
    claim: string;
    /** Why the evidence does not support it. */
    problem: string;
    /** What would settle it: a tool result, a file, a message. */
    evidenceNeeded: string;
}

/** A challenge SystemLLM issued to one agent about one task. */
export interface SystemLlmChallenge {
    id: string;
    channelId: string;
    agentId: string;
    taskId: string;
    trigger: ChallengeTrigger;
    stance: Exclude<SystemLlmStance, 'supportive'>;
    delivery: ChallengeDelivery;
    summary: string;
    points: SystemLlmChallengePoint[];
    createdAt: number;
}

/**
 * Record kept on `task.metadata.systemLlmChallenges` so a trigger is
 * challenged at most once per task, and so the history is auditable.
 */
export interface SystemLlmChallengeRecord {
    id: string;
    trigger: ChallengeTrigger;
    stance: SystemLlmChallenge['stance'];
    delivery: ChallengeDelivery;
    summary: string;
    points: SystemLlmChallengePoint[];
    createdAt: number;
}

/** Key under `task.metadata` where challenge records are pushed. */
export const TASK_METADATA_CHALLENGES_KEY = 'systemLlmChallenges';

/**
 * `context.messageType` on a channel message that carries a challenge.
 * The SDK treats these as "answer this", unlike `coordination_suggestion`.
 */
export const SYSTEMLLM_CHALLENGE_MESSAGE_TYPE = 'systemllm_challenge';

/** `status` returned by `task_complete` when the claim was challenged instead of accepted. */
export const TASK_COMPLETION_CHALLENGED_STATUS = 'completion_challenged';
