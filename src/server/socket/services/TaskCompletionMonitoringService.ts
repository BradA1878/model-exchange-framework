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
 */

import { Subscription } from 'rxjs';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import type { PlanStepCompletedEventData } from '@mxf-dev/core/events/event-definitions/PlanEvents';
import type {
    AgentMessageDeliveredEventPayload,
    BaseEventPayload,
    McpToolResultEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { createTaskEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import {
    CompletionStrategyType,
    TaskCompletionConfig,
    TaskCompletionEvent,
    TaskMonitoringState
} from '@mxf-dev/core/types/TaskCompletionTypes';
import type { ChannelTask, TaskStatus } from '@mxf-dev/core/types/TaskTypes';
import type { TaskDocument } from '@mxf-dev/core/models/task';
import PlanModel from '@mxf-dev/core/models/plan';
import { SystemLlmServiceManager } from './SystemLlmServiceManager';
import { buildCompletionJudgePrompt } from './SystemLlmStancePrompts';
import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';

type MonitoredTask = TaskDocument | ChannelTask;

export interface MonitoredTaskTransition {
    taskId: string;
    channelId: string;
    status: Extract<TaskStatus, 'completed' | 'failed'>;
    progress: number;
    result: NonNullable<ChannelTask['result']>;
}

export type MonitoredTaskTransitionHandler = (
    transition: MonitoredTaskTransition
) => Promise<ChannelTask | null>;

interface MonitoringEntry {
    task: MonitoredTask;
    config: TaskCompletionConfig;
    state: TaskMonitoringState;
    transition: MonitoredTaskTransitionHandler;
    evaluating: boolean;
    transitioning: boolean;
}

export interface TaskMonitoringStatus {
    taskId: string;
    channelId: string;
    active: boolean;
    startTime?: number;
    lastActivityTime?: number;
    activityCount?: number;
    evaluationCount?: number;
    strategy?: CompletionStrategyType;
}

/**
 * Monitors configured tasks and asks TaskService to make an atomic persistent
 * terminal transition before announcing completion. Every runtime key includes
 * the authenticated channel, because task ids alone are not tenant identities.
 */
export class TaskCompletionMonitoringService {
    private static instance: TaskCompletionMonitoringService | undefined;
    private readonly logger = new Logger('debug', 'TaskCompletionMonitoring', 'server');
    private readonly entries = new Map<string, MonitoringEntry>();
    private readonly monitoringIntervals = new Map<string, ReturnType<typeof setInterval>>();
    private eventSubscriptions: Subscription[] = [];
    private listenersInitialized = false;
    private shutdownComplete = false;

    private constructor() {
        this.setupEventListeners();
    }

    public static getInstance(): TaskCompletionMonitoringService {
        if (!TaskCompletionMonitoringService.instance) {
            TaskCompletionMonitoringService.instance = new TaskCompletionMonitoringService();
        }
        return TaskCompletionMonitoringService.instance;
    }

    /** Stop the live monitor without constructing one solely for teardown. */
    public static shutdownExisting(): boolean {
        if (!TaskCompletionMonitoringService.instance) {
            return false;
        }
        TaskCompletionMonitoringService.instance.shutdown();
        return true;
    }

    private monitoringKey(channelId: string, taskId: string): string {
        if (channelId.trim().length === 0 || taskId.trim().length === 0) {
            throw new Error('channelId and taskId are required for task monitoring');
        }
        return `${channelId}\0${taskId}`;
    }

    public startMonitoring(
        task: MonitoredTask,
        config: TaskCompletionConfig,
        transition: MonitoredTaskTransitionHandler
    ): void {
        if (this.shutdownComplete || TaskCompletionMonitoringService.instance !== this) {
            throw new Error('TaskCompletionMonitoringService has been shut down');
        }
        if (config.enabled === false) {
            return;
        }
        if (!task.id || !task.channelId) {
            throw new Error('Persisted task id and channelId are required for monitoring');
        }

        this.assertValidConfig(config);
        this.setupEventListeners();

        const key = this.monitoringKey(task.channelId, task.id);
        if (this.entries.get(key)?.transitioning) {
            throw new Error(`Task ${task.id} already has a terminal transition in progress`);
        }
        this.stopMonitoring(task.channelId, task.id);

        const assignedAgentIds = Array.from(new Set([
            ...(task.assignedAgentIds ?? []),
            ...(task.assignedAgentId ? [task.assignedAgentId] : [])
        ]));
        const agentActivity = new Map<string, {
            messageCount: number;
            toolCallCount: number;
            lastActive: number;
        }>();
        for (const agentId of assignedAgentIds) {
            agentActivity.set(agentId, { messageCount: 0, toolCallCount: 0, lastActive: 0 });
        }

        const now = Date.now();
        const state: TaskMonitoringState = {
            taskId: task.id,
            channelId: task.channelId,
            assignedAgentIds,
            startTime: now,
            lastActivityTime: now,
            activityCount: 0,
            evidence: { messages: [], toolCalls: [], planProgress: undefined },
            evaluations: [],
            agentActivity
        };

        this.entries.set(key, {
            task,
            config,
            state,
            transition,
            evaluating: false,
            transitioning: false
        });
        this.startEvaluationLoop(key);
    }

    public stopMonitoring(channelId: string, taskId: string): void {
        const key = this.monitoringKey(channelId, taskId);
        const interval = this.monitoringIntervals.get(key);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(key);
        }
        this.entries.delete(key);
    }

    public getMonitoringStatus(channelId: string, taskId: string): TaskMonitoringStatus {
        const entry = this.entries.get(this.monitoringKey(channelId, taskId));
        if (!entry) {
            return { taskId, channelId, active: false };
        }
        return {
            taskId,
            channelId,
            active: true,
            startTime: entry.state.startTime,
            lastActivityTime: entry.state.lastActivityTime,
            activityCount: entry.state.activityCount,
            evaluationCount: entry.state.evaluations.length,
            strategy: entry.config.primary.type
        };
    }

    /** Dispose this service's own timers and EventBus subscriptions. */
    public shutdown(): void {
        if (this.shutdownComplete) {
            return;
        }
        this.shutdownComplete = true;
        for (const interval of this.monitoringIntervals.values()) {
            clearInterval(interval);
        }
        this.monitoringIntervals.clear();
        this.entries.clear();
        for (const subscription of this.eventSubscriptions) {
            subscription.unsubscribe();
        }
        this.eventSubscriptions = [];
        this.listenersInitialized = false;
        if (TaskCompletionMonitoringService.instance === this) {
            TaskCompletionMonitoringService.instance = undefined;
        }
    }

    public assertValidConfig(config: TaskCompletionConfig): void {
        const primary = config.primary;
        switch (primary.type) {
            case 'plan-based':
                if (!primary.planId || primary.planId.trim().length === 0) {
                    throw new Error('planId is required for plan-based monitoring');
                }
                if (primary.completionType === 'percentage' &&
                    (primary.percentage === undefined || primary.percentage < 0 || primary.percentage > 100)) {
                    throw new Error('percentage must be between 0 and 100');
                }
                break;
            case 'systemllm-eval':
                if (primary.objectives.length === 0 || primary.evaluationInterval <= 0) {
                    throw new Error('SystemLLM monitoring requires objectives and a positive evaluationInterval');
                }
                if (!Number.isInteger(primary.maxEvaluations) || primary.maxEvaluations < 1) {
                    throw new Error('SystemLLM monitoring requires a positive maxEvaluations budget');
                }
                if (primary.confidenceThreshold < 0 || primary.confidenceThreshold > 1) {
                    throw new Error('SystemLLM confidenceThreshold must be between 0 and 1');
                }
                break;
            case 'output-based':
                if (primary.requiredOutputs.length === 0 ||
                    primary.requiredOutputs.some(output => !['message', 'tool_call'].includes(output.type))) {
                    throw new Error('Output monitoring requires at least one message or tool_call output');
                }
                for (const output of primary.requiredOutputs) {
                    if (output.pattern !== undefined) {
                        if (output.pattern.length === 0 || output.pattern.length > 256) {
                            throw new Error('Output patterns must contain between 1 and 256 characters');
                        }
                        try {
                            new RegExp(output.pattern);
                        } catch (error) {
                            throw new Error(`Invalid output pattern ${output.pattern}: ${String(error)}`);
                        }
                    }
                    if (output.count !== undefined &&
                        (!Number.isInteger(output.count) || output.count < 1)) {
                        throw new Error('Output counts must be positive integers');
                    }
                }
                break;
            case 'time-based':
                if (primary.maximumDuration <= 0) {
                    throw new Error('maximumDuration must be positive');
                }
                break;
            case 'event-based':
            case 'consensus':
            case 'custom':
                throw new Error(`Completion strategy ${primary.type} is not implemented`);
        }
        if (config.absoluteTimeout !== undefined && config.absoluteTimeout <= 0) {
            throw new Error('absoluteTimeout must be positive');
        }
        if (config.absoluteTimeout !== undefined && config.timeoutBehavior !== 'fail') {
            throw new Error('absoluteTimeout requires timeoutBehavior=fail');
        }
    }

    private setupEventListeners(): void {
        if (this.listenersInitialized) {
            return;
        }

        try {
            this.eventSubscriptions.push(
                EventBus.server.on(Events.Message.AGENT_MESSAGE_DELIVERED, payload => {
                const event = payload as unknown as AgentMessageDeliveredEventPayload;
                const agentId = event.data?.fromAgentId;
                if (typeof agentId !== 'string' || typeof event.channelId !== 'string') {
                    return;
                }
                const key = this.findTaskForAgent(agentId, event.channelId);
                if (key) {
                    this.recordAgentMessage(key, agentId, String(event.data.content));
                }
                })
            );
            this.eventSubscriptions.push(
                EventBus.server.on(Events.Mcp.TOOL_RESULT, payload => {
                const event = payload as McpToolResultEventPayload;
                if (typeof event.agentId !== 'string' || typeof event.channelId !== 'string' ||
                    typeof event.data?.toolName !== 'string') {
                    return;
                }
                const key = this.findTaskForAgent(event.agentId, event.channelId);
                if (key) {
                    this.recordToolCall(key, event.agentId, event.data.toolName, event.data.result);
                }
                })
            );
            this.eventSubscriptions.push(
                EventBus.server.on(Events.Plan.PLAN_STEP_COMPLETED, payload => {
                const event = payload as BaseEventPayload<PlanStepCompletedEventData>;
                if (typeof event.channelId !== 'string' || typeof event.data?.planId !== 'string' ||
                    typeof event.data.stepId !== 'string') {
                    return;
                }
                this.updatePlanProgress(event.channelId, event.data.planId, event.data.stepId);
                })
            );
            this.listenersInitialized = true;
        } catch (error) {
            for (const subscription of this.eventSubscriptions) {
                subscription.unsubscribe();
            }
            this.eventSubscriptions = [];
            throw error;
        }
    }

    private startEvaluationLoop(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) {
            throw new Error(`Monitoring entry ${key} was not initialized`);
        }

        let intervalMs = 30_000;
        if (entry.config.primary.type === 'systemllm-eval') {
            intervalMs = entry.config.primary.evaluationInterval;
        } else if (entry.config.primary.type === 'time-based') {
            intervalMs = Math.max(1, Math.min(10_000, entry.config.primary.maximumDuration / 10));
        }

        const interval = setInterval(() => {
            void this.runEvaluation(key).catch(error => {
                this.logger.error(`Task monitoring evaluation failed for ${key}: ${String(error)}`);
            });
        }, intervalMs);
        interval.unref?.();
        this.monitoringIntervals.set(key, interval);

        void this.runEvaluation(key).catch(error => {
            this.logger.error(`Initial task monitoring evaluation failed for ${key}: ${String(error)}`);
        });
    }

    private async runEvaluation(key: string): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry || entry.evaluating || entry.transitioning) {
            return;
        }
        entry.evaluating = true;
        try {
            await this.evaluateTaskCompletion(key, entry);
        } catch (error) {
            if (this.entries.get(key) === entry) {
                const message = error instanceof Error ? error.message : String(error);
                await this.transitionTask(
                    key,
                    entry,
                    'failed',
                    entry.config.primary.type,
                    `Completion evaluation failed: ${message}`,
                    0
                );
            }
        } finally {
            const current = this.entries.get(key);
            if (current === entry) {
                current.evaluating = false;
            }
        }
    }

    private async evaluateTaskCompletion(key: string, entry: MonitoringEntry): Promise<void> {
        const { task, config, state } = entry;
        let result: { complete: boolean; confidence: number; reason: string };

        switch (config.primary.type) {
            case 'plan-based':
                result = await this.evaluatePlanBasedCompletion(task, config.primary, state);
                break;
            case 'systemllm-eval':
                result = await this.evaluateSystemLLMCompletion(task, config.primary, state);
                break;
            case 'output-based':
                result = this.evaluateOutputBasedCompletion(config.primary, state);
                break;
            case 'time-based':
                result = this.evaluateTimeBasedCompletion(config.primary, state);
                break;
            case 'event-based':
            case 'consensus':
            case 'custom':
                throw new Error(`Completion strategy ${config.primary.type} is not implemented`);
        }

        // A config update or shutdown may have replaced this entry while an
        // asynchronous plan/LLM evaluation was running. Stale generations must
        // never transition the newly configured task.
        if (this.entries.get(key) !== entry) {
            return;
        }

        state.evaluations.push({
            timestamp: Date.now(),
            strategy: config.primary.type,
            result: result.complete,
            confidence: result.confidence,
            reason: result.reason
        });

        const threshold = config.primary.type === 'systemllm-eval'
            ? config.primary.confidenceThreshold
            : 0.8;
        if (result.complete && result.confidence >= threshold) {
            await this.transitionTask(key, entry, 'completed', config.primary.type, result.reason, result.confidence);
            return;
        }

        if (config.primary.type === 'systemllm-eval' &&
            state.evaluations.length >= config.primary.maxEvaluations) {
            await this.transitionTask(
                key,
                entry,
                'failed',
                config.primary.type,
                `SystemLLM evaluation budget exhausted after ${state.evaluations.length} attempts`,
                result.confidence
            );
            return;
        }

        if (config.absoluteTimeout !== undefined && Date.now() - state.startTime > config.absoluteTimeout) {
            const reason = `Absolute timeout reached (${config.absoluteTimeout}ms)`;
            await this.transitionTask(key, entry, 'failed', config.primary.type, reason, 1);
        }
    }

    private async evaluatePlanBasedCompletion(
        task: MonitoredTask,
        criteria: Extract<TaskCompletionConfig['primary'], { type: 'plan-based' }>,
        state: TaskMonitoringState
    ): Promise<{ complete: boolean; confidence: number; reason: string }> {
        const plan = await PlanModel.findOne({ planId: criteria.planId, channelId: task.channelId });
        if (!plan || plan.items.length === 0) {
            return { complete: false, confidence: 0, reason: 'Plan not found or contains no steps' };
        }

        const completedSteps = plan.items.filter(item => item.status === 'completed');
        const criticalSteps = plan.items.filter(item => item.priority === 'high');
        const criticalCompleted = criticalSteps.filter(item => item.status === 'completed');
        state.evidence.planProgress = {
            completedSteps: completedSteps.map(step => step.id),
            totalSteps: plan.items.length,
            criticalStepsCompleted: criticalCompleted.length
        };

        if (criteria.completionType === 'all_steps') {
            const complete = completedSteps.length === plan.items.length;
            return {
                complete,
                confidence: completedSteps.length / plan.items.length,
                reason: `${completedSteps.length}/${plan.items.length} steps completed`
            };
        }
        if (criteria.completionType === 'critical_steps') {
            if (criticalSteps.length === 0) {
                return { complete: false, confidence: 0, reason: 'Plan contains no critical steps' };
            }
            const complete = criticalCompleted.length === criticalSteps.length;
            return {
                complete,
                confidence: criticalCompleted.length / criticalSteps.length,
                reason: `${criticalCompleted.length}/${criticalSteps.length} critical steps completed`
            };
        }

        const percentage = (completedSteps.length / plan.items.length) * 100;
        return {
            complete: percentage >= (criteria.percentage ?? 100),
            confidence: percentage / 100,
            reason: `${percentage.toFixed(1)}% of steps completed`
        };
    }

    private async evaluateSystemLLMCompletion(
        task: MonitoredTask,
        criteria: Extract<TaskCompletionConfig['primary'], { type: 'systemllm-eval' }>,
        state: TaskMonitoringState
    ): Promise<{ complete: boolean; confidence: number; reason: string }> {
        const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(task.channelId);
        if (!systemLlm) {
            throw new Error(`SystemLLM is unavailable for channel ${task.channelId}`);
        }

        // The evidence the listeners collected goes to the judge in full (bounded
        // by EVIDENCE_CAPS). This used to send only the counts — "12 messages,
        // 5 tool calls" — which left the judge deciding without seeing the work.
        // The stance picks the prompt: critical demands evidence per objective.
        const stance = ConfigManager.getInstance().getChannelSystemLlmStance(task.channelId);
        const prompt = buildCompletionJudgePrompt(
            stance,
            { title: task.title, description: task.description },
            criteria.objectives,
            state.evidence
        );

        // degrade: false — a verdict must come from the model. A fabricated
        // "service unavailable" reply would fail the format check with a
        // misleading reason; the real provider error is the honest one.
        const response = await systemLlm.sendLlmRequest(
            prompt,
            undefined,
            {
                model: systemLlm.getModelForOperation('reasoning'),
                operationType: 'reasoning',
                temperature: 0.3,
                maxTokens: 200,
                degrade: false
            }
        );
        const parsed = response.trim().match(
            /^<complete>(YES|NO)<\/complete>\s*<confidence>([^<]+)<\/confidence>\s*<reason>(.+)<\/reason>$/s
        );
        if (!parsed) {
            throw new Error('SystemLLM completion response did not match the required format');
        }
        const confidence = Number(parsed[2]);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            throw new Error('SystemLLM completion confidence must be between 0 and 1');
        }
        const reason = parsed[3].trim();
        if (reason.length === 0) {
            throw new Error('SystemLLM completion response requires a reason');
        }
        return {
            complete: parsed[1] === 'YES',
            confidence,
            reason
        };
    }

    private evaluateOutputBasedCompletion(
        criteria: Extract<TaskCompletionConfig['primary'], { type: 'output-based' }>,
        state: TaskMonitoringState
    ): { complete: boolean; confidence: number; reason: string } {
        let metCount = 0;
        for (const required of criteria.requiredOutputs) {
            const pattern = required.pattern ? new RegExp(required.pattern) : undefined;
            const found = required.type === 'message'
                ? state.evidence.messages.filter(message => !pattern || pattern.test(message.content)).length
                : state.evidence.toolCalls.filter(call => !pattern || pattern.test(call.toolName)).length;
            if (found >= (required.count ?? 1)) {
                metCount += 1;
            }
        }
        const confidence = metCount / criteria.requiredOutputs.length;
        return {
            complete: metCount === criteria.requiredOutputs.length,
            confidence,
            reason: `${metCount}/${criteria.requiredOutputs.length} required outputs found`
        };
    }

    private evaluateTimeBasedCompletion(
        criteria: Extract<TaskCompletionConfig['primary'], { type: 'time-based' }>,
        state: TaskMonitoringState
    ): { complete: boolean; confidence: number; reason: string } {
        const elapsed = Date.now() - state.startTime;
        const inactiveTime = Date.now() - state.lastActivityTime;
        if (criteria.minimumDuration !== undefined && elapsed < criteria.minimumDuration) {
            return {
                complete: false,
                confidence: elapsed / criteria.minimumDuration,
                reason: `Minimum duration not met (${elapsed}ms < ${criteria.minimumDuration}ms)`
            };
        }
        if (elapsed >= criteria.maximumDuration) {
            if (criteria.requireActivity && state.activityCount === 0) {
                return { complete: false, confidence: 0, reason: 'No activity detected' };
            }
            return { complete: true, confidence: 1, reason: `Maximum duration reached (${elapsed}ms)` };
        }
        const inactivityThreshold = criteria.maximumDuration / 4;
        if (inactiveTime > inactivityThreshold && state.activityCount > 0) {
            return {
                complete: true,
                confidence: 0.9,
                reason: `Inactive for ${inactiveTime}ms after ${state.activityCount} activities`
            };
        }
        return {
            complete: false,
            confidence: elapsed / criteria.maximumDuration,
            reason: `Elapsed: ${elapsed}ms, inactive: ${inactiveTime}ms`
        };
    }

    private async transitionTask(
        key: string,
        entry: MonitoringEntry,
        status: Extract<TaskStatus, 'completed' | 'failed'>,
        strategy: CompletionStrategyType,
        reason: string,
        confidence: number
    ): Promise<void> {
        if (entry.transitioning) {
            return;
        }
        entry.transitioning = true;

        const completionEvent: TaskCompletionEvent = {
            taskId: entry.task.id,
            completedBy: 'system',
            completionStrategy: strategy,
            evidence: entry.state.evidence,
            confidence,
            reason,
            duration: Date.now() - entry.state.startTime
        };
        const result: NonNullable<ChannelTask['result']> = status === 'completed'
            ? {
                success: true,
                output: { summary: `Task automatically completed: ${reason}`, completionEvent },
                completedAt: Date.now(),
                completedBy: 'system'
            }
            : {
                success: false,
                error: reason,
                completedAt: Date.now(),
                completedBy: 'system'
            };

        try {
            const updatedTask = await entry.transition({
                taskId: entry.task.id,
                channelId: entry.task.channelId,
                status,
                progress: status === 'completed' ? 100 : entry.task.progress ?? 0,
                result
            });
            if (!updatedTask) {
                if (this.entries.get(key) === entry) {
                    this.stopMonitoring(entry.task.channelId, entry.task.id);
                }
                return;
            }

            if (this.entries.get(key) !== entry) {
                return;
            }
            this.stopMonitoring(entry.task.channelId, entry.task.id);
            const targetAgentId = updatedTask.assignedAgentId ??
                updatedTask.assignedAgentIds?.[0] ??
                updatedTask.createdBy;
            const eventName = status === 'completed' ? TaskEvents.COMPLETED : TaskEvents.FAILED;
            EventBus.server.emit(
                eventName,
                createTaskEventPayload(eventName, 'system', updatedTask.channelId, {
                    taskId: updatedTask.id,
                    fromAgentId: 'system',
                    toAgentId: targetAgentId,
                    task: updatedTask
                })
            );
        } finally {
            const current = this.entries.get(key);
            if (current === entry) {
                current.transitioning = false;
            }
        }
    }

    private recordAgentMessage(key: string, agentId: string, content: string): void {
        const state = this.entries.get(key)?.state;
        if (!state) {
            return;
        }
        state.evidence.messages.push({ agentId, content, timestamp: Date.now() });
        this.recordActivity(state, agentId, 'message');
    }

    private recordToolCall(key: string, agentId: string, toolName: string, result: unknown): void {
        const state = this.entries.get(key)?.state;
        if (!state) {
            return;
        }
        state.evidence.toolCalls.push({ agentId, toolName, result, timestamp: Date.now() });
        this.recordActivity(state, agentId, 'tool');
    }

    private recordActivity(state: TaskMonitoringState, agentId: string, kind: 'message' | 'tool'): void {
        const now = Date.now();
        state.lastActivityTime = now;
        state.activityCount += 1;
        const activity = state.agentActivity.get(agentId);
        if (!activity) {
            return;
        }
        if (kind === 'message') {
            activity.messageCount += 1;
        } else {
            activity.toolCallCount += 1;
        }
        activity.lastActive = now;
    }

    private updatePlanProgress(channelId: string, planId: string, stepId: string): void {
        for (const entry of this.entries.values()) {
            if (entry.state.channelId !== channelId || entry.config.primary.type !== 'plan-based' ||
                entry.config.primary.planId !== planId) {
                continue;
            }
            const progress = entry.state.evidence.planProgress;
            if (progress && !progress.completedSteps.includes(stepId)) {
                progress.completedSteps.push(stepId);
            }
        }
    }

    /**
     * Activity events do not contain a task id. Attribute them only when exactly
     * one monitored task in the exact channel is assigned to the agent; guessing
     * among concurrent tasks would manufacture completion evidence.
     */
    private findTaskForAgent(agentId: string, channelId: string): string | null {
        const matches = Array.from(this.entries.entries())
            .filter(([, entry]) => entry.state.channelId === channelId &&
                entry.state.assignedAgentIds.includes(agentId));
        if (matches.length !== 1) {
            if (matches.length > 1) {
                this.logger.warn(
                    `Ignoring ambiguous activity for ${agentId} in ${channelId}: ` +
                    `${matches.length} monitored tasks are assigned`
                );
            }
            return null;
        }
        return matches[0][0];
    }
}
