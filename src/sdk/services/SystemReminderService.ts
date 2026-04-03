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
 * System Reminder Service
 *
 * Generates contextual system reminders that are injected mid-conversation
 * to reinforce instructions at strategic points. Inspired by Claude Code's
 * <system-reminder> pattern.
 *
 * Reminders are triggered by specific events:
 *   - after_tool_execution: Reinforce tool usage patterns
 *   - after_error: Error recovery guidance
 *   - phase_transition: ORPAR phase-specific hints
 *   - conversation_length: Periodic re-anchoring
 *   - task_assigned: Task-specific guidance
 *
 * Each reminder has a cooldown to prevent flooding, priority ordering,
 * and a total token budget cap.
 */

import { Logger } from '../../shared/utils/Logger';
import { estimateTokens } from '../../shared/utils/TokenEstimator';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { AgentId, ChannelId } from '../../shared/types/ChannelContext';

const logger = new Logger('info', 'SystemReminderService', 'client');

/** When a reminder should trigger */
export type ReminderTrigger =
    | 'after_tool_execution'
    | 'after_error'
    | 'phase_transition'
    | 'conversation_length'
    | 'before_llm_request'
    | 'task_assigned';

/** Context passed to reminder condition evaluators */
export interface ReminderContext {
    /** Current agent ID */
    agentId: AgentId;
    /** Current channel ID */
    channelId: ChannelId;
    /** Current ORPAR phase (if active) */
    orparPhase?: string;
    /** Whether an error just occurred */
    hasRecentError?: boolean;
    /** The error message (if applicable) */
    errorMessage?: string;
    /** Current conversation length (message count) */
    conversationLength: number;
    /** Current task title/description (if any) */
    currentTask?: string;
    /** Name of the last tool that was executed (if applicable) */
    lastToolName?: string;
    /** Whether the last tool execution succeeded */
    lastToolSuccess?: boolean;
    /** Total estimated tokens in the conversation */
    estimatedTokens?: number;
    /** Model context limit */
    contextLimit?: number;
}

/** A registered system reminder */
export interface SystemReminder {
    /** Unique identifier */
    id: string;
    /** What triggers this reminder */
    trigger: ReminderTrigger;
    /** Priority (1–10, higher = more important) */
    priority: number;
    /** The reminder content to inject */
    content: string;
    /** Minimum seconds between consecutive firings of this reminder */
    cooldownSeconds: number;
    /** Condition that must be true for the reminder to fire */
    condition: (ctx: ReminderContext) => boolean;
}

/**
 * System Reminder Service — singleton
 *
 * Manages system reminders that get injected into conversation
 * history as system-role messages to reinforce key instructions.
 */
export class SystemReminderService {
    private static instance: SystemReminderService | null = null;
    private reminders = new Map<string, SystemReminder>();
    /** Tracks last fire time per reminder ID per agent */
    private cooldowns = new Map<string, number>();

    private constructor() {
        this.registerDefaults();
    }

    /** Get singleton instance */
    public static getInstance(): SystemReminderService {
        if (!SystemReminderService.instance) {
            SystemReminderService.instance = new SystemReminderService();
        }
        return SystemReminderService.instance;
    }

    /** Register a system reminder */
    public register(reminder: SystemReminder): void {
        this.reminders.set(reminder.id, reminder);
        logger.debug('System reminder registered', { id: reminder.id, trigger: reminder.trigger });
    }

    /** Unregister a reminder */
    public unregister(id: string): boolean {
        this.cooldowns.delete(id);
        return this.reminders.delete(id);
    }

    /**
     * Get applicable reminders for a given trigger and context.
     * Respects cooldowns, priority ordering, and token budget.
     *
     * @param trigger - The event type that triggered this check
     * @param context - Current agent/conversation context
     * @param tokenBudget - Max total tokens for all returned reminders (default 500)
     * @returns Array of ConversationMessage objects (system role) to inject
     */
    public getApplicableReminders(
        trigger: ReminderTrigger,
        context: ReminderContext,
        tokenBudget: number = 500,
    ): ConversationMessage[] {
        const now = Date.now();
        const applicable: SystemReminder[] = [];

        // Filter by trigger, condition, and cooldown
        for (const reminder of this.reminders.values()) {
            if (reminder.trigger !== trigger) continue;

            // Check cooldown — scoped per agent+channel so reminders fire
            // independently in each channel the agent operates in
            const cooldownKey = `${reminder.id}:${context.agentId}:${context.channelId}`;
            const lastFired = this.cooldowns.get(cooldownKey) || 0;
            if (now - lastFired < reminder.cooldownSeconds * 1000) continue;

            // Check condition
            try {
                if (!reminder.condition(context)) continue;
            } catch (error) {
                logger.warn('Reminder condition evaluation failed', {
                    reminderId: reminder.id,
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }

            applicable.push(reminder);
        }

        // Sort by priority (highest first)
        applicable.sort((a, b) => b.priority - a.priority);

        // Apply token budget
        const result: ConversationMessage[] = [];
        let totalTokens = 0;

        for (const reminder of applicable) {
            const tokens = estimateTokens(reminder.content);
            if (totalTokens + tokens > tokenBudget) break;

            // Record cooldown (same key format as the check above)
            const cooldownKey = `${reminder.id}:${context.agentId}:${context.channelId}`;
            this.cooldowns.set(cooldownKey, now);

            result.push({
                id: `reminder-${reminder.id}-${now}`,
                role: 'system',
                content: `<system-reminder>${reminder.content}</system-reminder>`,
                timestamp: now,
                metadata: {
                    contextLayer: 'system',
                    messageType: 'system-notice',
                    ephemeral: true,
                    reminderId: reminder.id,
                    reminderTrigger: trigger,
                },
            });

            totalTokens += tokens;
        }

        if (result.length > 0) {
            logger.debug('System reminders generated', {
                trigger,
                agentId: context.agentId,
                count: result.length,
                totalTokens,
            });
        }

        return result;
    }

    /** Clear all cooldowns (useful for testing) */
    public clearCooldowns(): void {
        this.cooldowns.clear();
    }

    /** List all registered reminder IDs */
    public listReminders(): string[] {
        return Array.from(this.reminders.keys());
    }

    /** Clear all reminders and cooldowns (useful for testing) */
    public clear(): void {
        this.reminders.clear();
        this.cooldowns.clear();
    }

    /** Reset to default reminders */
    public reset(): void {
        this.clear();
        this.registerDefaults();
    }

    /**
     * Register default system reminders.
     */
    private registerDefaults(): void {
        // ORPAR phase guidance — remind agent of current phase expectations
        this.register({
            id: 'orpar-observe-guidance',
            trigger: 'phase_transition',
            priority: 8,
            content: 'You are in the Observe phase. Focus on gathering information — read files, check state, list resources. Do not take action yet.',
            cooldownSeconds: 60,
            condition: (ctx) => ctx.orparPhase === 'observe',
        });

        this.register({
            id: 'orpar-reflect-guidance',
            trigger: 'phase_transition',
            priority: 8,
            content: 'You are in the Reflect phase. Evaluate whether your last action achieved its goal. If not, diagnose why before re-planning.',
            cooldownSeconds: 60,
            condition: (ctx) => ctx.orparPhase === 'reflect',
        });

        // Error recovery guidance
        this.register({
            id: 'error-recovery',
            trigger: 'after_error',
            priority: 9,
            content: 'An error occurred. Do not retry the exact same action. Diagnose the root cause, then try a different approach or modified parameters.',
            cooldownSeconds: 30,
            condition: (ctx) => ctx.hasRecentError === true,
        });

        // Tool execution reminder — don't retry same params
        this.register({
            id: 'tool-no-retry',
            trigger: 'after_tool_execution',
            priority: 6,
            content: 'If a tool call failed, do not retry with the same parameters. Analyze the error, modify your approach, and try again.',
            cooldownSeconds: 120,
            condition: (ctx) => ctx.lastToolSuccess === false,
        });

        // Conversation length re-anchoring — remind of task after many messages
        this.register({
            id: 'task-reanchor',
            trigger: 'conversation_length',
            priority: 5,
            content: 'Remember your current task. Stay focused on completing it. If you have accomplished the goal, call task_complete.',
            cooldownSeconds: 300,
            condition: (ctx) => ctx.conversationLength > 20 && !!ctx.currentTask,
        });

        // Context window pressure warning
        this.register({
            id: 'context-pressure',
            trigger: 'before_llm_request',
            priority: 7,
            content: 'Context window is getting full. Be concise in your responses. Avoid repeating information already in the conversation.',
            cooldownSeconds: 300,
            condition: (ctx) => {
                if (!ctx.estimatedTokens || !ctx.contextLimit) return false;
                return ctx.estimatedTokens / ctx.contextLimit > 0.70;
            },
        });

        // Task assignment reminder
        this.register({
            id: 'task-assigned',
            trigger: 'task_assigned',
            priority: 8,
            content: 'A new task has been assigned. Read the task description carefully. Begin with Observation to understand the requirements.',
            cooldownSeconds: 10,
            condition: (ctx) => !!ctx.currentTask,
        });

        logger.info('Default system reminders registered', { count: this.reminders.size });
    }
}
