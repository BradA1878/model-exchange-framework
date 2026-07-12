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
 * LLM Budget Events
 *
 * Emitted as SystemLLM spend approaches and crosses its daily ceiling. SystemLLM runs on
 * Claude Opus and had no absolute spend cap — only per-channel and global cooldowns — so
 * a busy or looping channel could run up real cost with nothing to stop it. These events
 * make that spend observable, and the EXCEEDED event marks the point where SystemLLM
 * calls start being refused.
 */

import { AgentId, ChannelId } from '../../types/ChannelContext.js';

/**
 * Events emitted as SystemLLM spend approaches and crosses the daily ceiling.
 */
export const LlmBudgetEvents = {
    /** Spend crossed the warning threshold. SystemLLM is still running. */
    WARNING: 'llm:budget:warning',
    /** Spend reached the daily ceiling. SystemLLM calls are refused until reset. */
    EXCEEDED: 'llm:budget:exceeded',
    /** A new budget day started and spend went back to zero. */
    RESET: 'llm:budget:reset'
} as const;

/**
 * Spend figures carried by every budget event.
 */
export interface LlmBudgetEventData {
    /** Money spent so far in the current budget day, in USD. */
    spentUsd: number;
    /** The daily ceiling, in USD. */
    limitUsd: number;
    /** Fraction of the ceiling used (spentUsd / limitUsd). */
    utilization: number;
    /** Start of the current budget day, as an ISO timestamp. */
    periodStart: string;
    /** Model whose call triggered the event, when there was one. */
    model?: string;
}

/**
 * Payload types for LLM budget events.
 */
export interface LlmBudgetPayloads {
    'llm:budget:warning': LlmBudgetEventData;
    'llm:budget:exceeded': LlmBudgetEventData;
    'llm:budget:reset': LlmBudgetEventData;
}

/** Actor recorded on budget events. Spend is a property of the server, not an agent. */
export const LLM_BUDGET_ACTOR_ID = 'system-llm-budget' as AgentId;

/** Channel recorded on budget events. The ceiling is global, not per channel. */
export const LLM_BUDGET_CHANNEL_ID = 'global' as ChannelId;
