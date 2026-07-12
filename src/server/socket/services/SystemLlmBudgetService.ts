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
 * SystemLLM Budget Service
 *
 * A hard daily ceiling on what SystemLLM may spend.
 *
 * SystemLLM defaults its reasoning and reflection operations to
 * anthropic/claude-opus-4.5 and runs them on channel activity. It had per-channel
 * and global cooldowns, which space calls out, but nothing that stops them: a
 * busy day cost real money with no upper bound. This puts a number on it.
 *
 * How spend is counted:
 * - Token counts are the real ones the provider returned (`usage.input_tokens`
 *   and `usage.output_tokens` on the response), not an estimate from string length.
 * - Those are multiplied by the per-model rates in MODEL_RATES_USD_PER_MILLION.
 * - A model that is not in the table is charged at UNKNOWN_MODEL_RATE, the most
 *   expensive tier, and logged once. Charging an unknown model zero would make
 *   "use a model MXF has never heard of" a way around the ceiling.
 *
 * Enforcement is in two places, because either alone leaks:
 * - SystemLlmServiceManager refuses to hand out a service once the ceiling is hit.
 * - SystemLlmService checks again immediately before each request, which catches
 *   the instances that were handed out before the ceiling was reached.
 *
 * The day is a rolling 24h window anchored at UTC midnight. Crossing into a new
 * day resets spend and re-enables SystemLLM.
 *
 * Environment variables:
 * - SYSTEMLLM_DAILY_BUDGET_USD  Daily ceiling in USD. Default 10.
 *                               0 disables SystemLLM entirely. Negative or
 *                               non-numeric values are a configuration error.
 * - SYSTEMLLM_BUDGET_WARN_AT    Fraction of the ceiling that triggers the warning
 *                               event. Default 0.8.
 */

import { Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import {
    LlmBudgetEvents,
    LlmBudgetEventData
} from '@mxf-dev/core/events/event-definitions/LlmBudgetEvents';
import { createLlmBudgetEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';

const logger = new Logger('info', 'SystemLlmBudgetService', 'server');

/** Default daily ceiling in USD when SYSTEMLLM_DAILY_BUDGET_USD is unset. */
const DEFAULT_DAILY_BUDGET_USD = 10;

/** Default fraction of the ceiling at which the warning event fires. */
const DEFAULT_WARN_AT = 0.8;

/**
 * Published rates in USD per million tokens, keyed by model id.
 *
 * Keys are matched after stripping the provider prefix, so `anthropic/claude-opus-4.5`
 * and `claude-opus-4.5` both resolve. Rates move; this table is what the ceiling
 * is enforced against, and it is the thing to update when they do.
 */
const MODEL_RATES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
    // Anthropic
    'claude-opus-4.5': { input: 15, output: 75 },
    'claude-opus-4-5': { input: 15, output: 75 },
    'claude-sonnet-4.5': { input: 3, output: 15 },
    'claude-sonnet-4-5': { input: 3, output: 15 },
    'claude-sonnet-4': { input: 3, output: 15 },
    'claude-haiku-4.5': { input: 0.8, output: 4 },
    'claude-haiku-4': { input: 0.8, output: 4 },

    // OpenAI
    'gpt-5.2': { input: 1.25, output: 10 },
    'gpt-5-mini': { input: 0.25, output: 2 },
    'gpt-5-nano': { input: 0.05, output: 0.4 },
    'gpt-4.1': { input: 2, output: 8 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },

    // Google
    'gemini-2.5-flash': { input: 0.3, output: 2.5 },
    'gemini-2.5-pro': { input: 1.25, output: 10 },
    'gemini-2.5-pro-preview-06-05': { input: 1.25, output: 10 },

    // Meta / open models
    'llama-3.3-70b-instruct': { input: 0.12, output: 0.3 },
    'llama-3.2-3b-instruct': { input: 0.015, output: 0.025 },

    // DeepSeek
    'deepseek-v3': { input: 0.27, output: 1.1 },
    'deepseek-r1': { input: 0.55, output: 2.19 },

    // Mistral
    'mistral-large-2': { input: 2, output: 6 },

    // Qwen
    'qwen-3-8b': { input: 0.04, output: 0.14 },
    'qwen-3-32b': { input: 0.1, output: 0.3 }
};

/**
 * Rate applied to models missing from the table.
 *
 * The most expensive tier on purpose. An unknown model must never be cheaper to
 * run than a known one, or the ceiling becomes optional.
 */
const UNKNOWN_MODEL_RATE = { input: 15, output: 75 };

/** Token usage as reported by the provider. */
export interface LlmTokenUsage {
    /** Prompt tokens billed. */
    inputTokens: number;
    /** Completion tokens billed. */
    outputTokens: number;
}

/** A snapshot of the current budget period. */
export interface BudgetStatus {
    /** Spend so far this period, in USD. */
    spentUsd: number;
    /** The ceiling, in USD. */
    limitUsd: number;
    /** spentUsd / limitUsd. */
    utilization: number;
    /** Whether SystemLLM calls are currently refused. */
    exhausted: boolean;
    /** Start of the current budget day. */
    periodStart: Date;
}

/**
 * Read the daily ceiling from the environment.
 *
 * @returns Ceiling in USD
 * @throws If SYSTEMLLM_DAILY_BUDGET_USD is negative or not a number
 */
const readDailyBudget = (): number => {
    const raw = process.env.SYSTEMLLM_DAILY_BUDGET_USD;

    if (raw === undefined || raw.trim() === '') {
        return DEFAULT_DAILY_BUDGET_USD;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(
            `SYSTEMLLM_DAILY_BUDGET_USD must be a number of dollars and cannot be negative, got '${raw}'. ` +
            'Set it to 0 to disable SystemLLM entirely.'
        );
    }

    return parsed;
};

/**
 * Read the warning threshold from the environment.
 *
 * @returns Fraction of the ceiling at which to warn
 * @throws If SYSTEMLLM_BUDGET_WARN_AT is outside (0, 1]
 */
const readWarnAt = (): number => {
    const raw = process.env.SYSTEMLLM_BUDGET_WARN_AT;

    if (raw === undefined || raw.trim() === '') {
        return DEFAULT_WARN_AT;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
        throw new Error(
            `SYSTEMLLM_BUDGET_WARN_AT must be a fraction greater than 0 and at most 1, got '${raw}'`
        );
    }

    return parsed;
};

/**
 * Start of the UTC day containing `at`.
 *
 * @param at - Any instant
 * @returns UTC midnight of that day
 */
const startOfUtcDay = (at: Date): Date => {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
};

/**
 * Cost of one call, in USD, from real token counts and the model's rates.
 *
 * @param model - Model id, with or without a provider prefix
 * @param usage - Token counts reported by the provider
 * @param onUnknownModel - Called when the model is not in the rate table
 * @returns Cost in USD
 */
export const priceCall = (
    model: string,
    usage: LlmTokenUsage,
    onUnknownModel?: (model: string) => void
): number => {
    // `anthropic/claude-opus-4.5` and `claude-opus-4.5` are the same model
    const bareModel = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
    const rate = MODEL_RATES_USD_PER_MILLION[bareModel];

    if (!rate) {
        onUnknownModel?.(model);
        return (
            (usage.inputTokens * UNKNOWN_MODEL_RATE.input +
                usage.outputTokens * UNKNOWN_MODEL_RATE.output) / 1_000_000
        );
    }

    return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
};

/**
 * Tracks SystemLLM spend against a daily ceiling.
 */
export class SystemLlmBudgetService {
    private static instance: SystemLlmBudgetService;

    private readonly limitUsd: number;
    private readonly warnAt: number;

    private spentUsd = 0;
    private periodStart: Date;
    private warningEmitted = false;
    private exceededEmitted = false;

    /** Models already reported as missing from the rate table, so we warn once each. */
    private readonly unknownModelsSeen = new Set<string>();

    private constructor() {
        this.limitUsd = readDailyBudget();
        this.warnAt = readWarnAt();
        this.periodStart = startOfUtcDay(new Date());

        if (this.limitUsd === 0) {
            logger.warn('SYSTEMLLM_DAILY_BUDGET_USD is 0 — SystemLLM calls are disabled');
        } else {
            logger.info(
                `SystemLLM daily budget: $${this.limitUsd.toFixed(2)} ` +
                `(warning at ${Math.round(this.warnAt * 100)}%)`
            );
        }
    }

    /**
     * Get the singleton instance.
     *
     * @returns The budget service
     */
    public static getInstance(): SystemLlmBudgetService {
        if (!SystemLlmBudgetService.instance) {
            SystemLlmBudgetService.instance = new SystemLlmBudgetService();
        }
        return SystemLlmBudgetService.instance;
    }

    /**
     * Roll into a new budget day if the clock has passed UTC midnight.
     */
    private rollPeriodIfNeeded(): void {
        const currentPeriod = startOfUtcDay(new Date());

        if (currentPeriod.getTime() === this.periodStart.getTime()) {
            return;
        }

        const previousSpend = this.spentUsd;

        this.periodStart = currentPeriod;
        this.spentUsd = 0;
        this.warningEmitted = false;
        this.exceededEmitted = false;

        logger.info(
            `SystemLLM budget period rolled over. Previous day spent $${previousSpend.toFixed(4)} ` +
            `of $${this.limitUsd.toFixed(2)}.`
        );

        this.emit(LlmBudgetEvents.RESET);
    }

    /**
     * Whether SystemLLM calls are currently refused.
     *
     * @returns True when the day's ceiling has been reached
     */
    public isExhausted(): boolean {
        this.rollPeriodIfNeeded();

        if (this.limitUsd === 0) {
            return true;
        }

        return this.spentUsd >= this.limitUsd;
    }

    /**
     * Refuse the call if the day's ceiling has been reached.
     *
     * Called immediately before every SystemLLM request. Throwing rather than
     * returning a placeholder is deliberate: callers already handle a SystemLLM
     * failure by falling back to their heuristic path, and a fabricated "response"
     * would be worse than no response.
     *
     * @param model - Model the call would use, for the error message
     * @throws If the ceiling has been reached
     */
    public assertWithinBudget(model: string): void {
        if (!this.isExhausted()) {
            return;
        }

        if (this.limitUsd === 0) {
            throw new Error(
                'SystemLLM is disabled: SYSTEMLLM_DAILY_BUDGET_USD is 0. ' +
                'Raise it to allow SystemLLM calls.'
            );
        }

        throw new Error(
            `SystemLLM daily budget exhausted: $${this.spentUsd.toFixed(4)} of $${this.limitUsd.toFixed(2)} ` +
            `spent since ${this.periodStart.toISOString()}. Refusing the ${model} call. ` +
            'Raise SYSTEMLLM_DAILY_BUDGET_USD or wait for the next budget day.'
        );
    }

    /**
     * Record the cost of a completed call.
     *
     * Called with the token counts the provider actually billed. Recording after
     * the fact means a single call can carry spend past the ceiling — the next one
     * is refused. That is the right trade: the alternative is refusing calls based
     * on a guess at what they will cost.
     *
     * @param model - Model that served the call
     * @param usage - Token counts reported by the provider
     * @returns The cost of this call, in USD
     */
    public recordUsage(model: string, usage: LlmTokenUsage): number {
        this.rollPeriodIfNeeded();

        const inputTokens = Number.isFinite(usage.inputTokens) ? Math.max(0, usage.inputTokens) : 0;
        const outputTokens = Number.isFinite(usage.outputTokens) ? Math.max(0, usage.outputTokens) : 0;

        const cost = priceCall(model, { inputTokens, outputTokens }, (unknown) => {
            if (!this.unknownModelsSeen.has(unknown)) {
                this.unknownModelsSeen.add(unknown);
                logger.warn(
                    `No published rate for model '${unknown}'. Charging it at the most expensive tier ` +
                    `($${UNKNOWN_MODEL_RATE.input}/$${UNKNOWN_MODEL_RATE.output} per 1M tokens) so it cannot ` +
                    'spend past the ceiling unmetered. Add it to MODEL_RATES_USD_PER_MILLION.'
                );
            }
        });

        this.spentUsd += cost;

        logger.debug(
            `SystemLLM spend: +$${cost.toFixed(6)} (${model}, ${inputTokens} in / ${outputTokens} out) ` +
            `— $${this.spentUsd.toFixed(4)} of $${this.limitUsd.toFixed(2)} today`
        );

        if (this.limitUsd > 0) {
            const utilization = this.spentUsd / this.limitUsd;

            if (utilization >= 1 && !this.exceededEmitted) {
                this.exceededEmitted = true;
                logger.error(
                    `SystemLLM daily budget exhausted: $${this.spentUsd.toFixed(4)} of ` +
                    `$${this.limitUsd.toFixed(2)}. Further SystemLLM calls are refused until the next budget day.`
                );
                this.emit(LlmBudgetEvents.EXCEEDED, model);
            } else if (utilization >= this.warnAt && !this.warningEmitted) {
                this.warningEmitted = true;
                logger.warn(
                    `SystemLLM spend at ${Math.round(utilization * 100)}% of the daily budget ` +
                    `($${this.spentUsd.toFixed(4)} of $${this.limitUsd.toFixed(2)})`
                );
                this.emit(LlmBudgetEvents.WARNING, model);
            }
        }

        return cost;
    }

    /**
     * Current spend, ceiling, and whether calls are refused.
     *
     * @returns A snapshot of the budget period
     */
    public getStatus(): BudgetStatus {
        this.rollPeriodIfNeeded();

        return {
            spentUsd: this.spentUsd,
            limitUsd: this.limitUsd,
            utilization: this.limitUsd > 0 ? this.spentUsd / this.limitUsd : 1,
            exhausted: this.isExhausted(),
            periodStart: new Date(this.periodStart)
        };
    }

    /**
     * Zero the current period. Used by tests.
     */
    public reset(): void {
        this.spentUsd = 0;
        this.periodStart = startOfUtcDay(new Date());
        this.warningEmitted = false;
        this.exceededEmitted = false;
        this.unknownModelsSeen.clear();
    }

    /**
     * Emit a budget event.
     *
     * @param eventType - One of LlmBudgetEvents
     * @param model - Model whose call triggered it, when there was one
     */
    private emit(eventType: string, model?: string): void {
        const data: LlmBudgetEventData = {
            spentUsd: this.spentUsd,
            limitUsd: this.limitUsd,
            utilization: this.limitUsd > 0 ? this.spentUsd / this.limitUsd : 1,
            periodStart: this.periodStart.toISOString(),
            model
        };

        EventBus.server.emit(eventType, createLlmBudgetEventPayload(eventType, data));
    }
}
