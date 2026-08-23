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
 * SystemLLM Challenge Service
 *
 * When a channel's SystemLLM stance is critical or hostile, this service turns
 * three agent claims into challenges:
 *
 * - a completion claim (`task_complete`), challenged synchronously from
 *   TaskService.handleTaskCompletion before the task is marked complete —
 *   the challenge comes back as the tool result
 * - a plan (`orpar_plan`) and a reflection that did not report missed
 *   expectations (`orpar_reflect`), challenged asynchronously from their
 *   events and delivered as a channel message addressed to the agent
 *
 * Each trigger is challenged at most once per task; the record lives on
 * `task.metadata.systemLlmChallenges`. The evidence the model sees is what
 * the agent actually did: its ORPAR phases, recent messages in the channel,
 * and the results of its tool calls (kept here in a bounded buffer fed by
 * Events.Mcp.TOOL_RESULT — there is no other server-side store of them).
 *
 * In supportive stance this service does nothing: evidence is only kept for
 * channels whose stance can use it, and buffers are dropped when a channel
 * is deleted or archived or an agent disconnects.
 */

import { Subscription } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { OrparEvents } from '@mxf-dev/core/events/event-definitions/OrparEvents';
import type { OrparPlanPayload, OrparReflectPayload } from '@mxf-dev/core/events/event-definitions/OrparEvents';
import {
    createSystemLlmChallengeIssuedEventPayload,
    type AgentMessageDeliveredEventPayload,
    type ChannelMessageEventPayload,
    type McpToolResultEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';
import type { AgentId, ChannelId } from '@mxf-dev/core/types/ChannelContext';
import type { ChannelTask } from '@mxf-dev/core/types/TaskTypes';
import {
    TASK_METADATA_CHALLENGES_KEY,
    type ChallengeDelivery,
    type ChallengeTrigger,
    type SystemLlmChallenge,
    type SystemLlmChallengeRecord
} from '@mxf-dev/core/types/SystemLlmStanceTypes';
import { getAllOrparStates } from '@mxf-dev/core/protocols/mcp/tools/OrparTools';
import { isSystemLlmEnabled, SystemLlmServiceManager } from './SystemLlmServiceManager';
import { SystemLlmBudgetService } from './SystemLlmBudgetService';
import type { SystemLlmService } from './SystemLlmService';
import { TaskService } from './TaskService';
import {
    EVIDENCE_CAPS,
    EvidenceMessage,
    EvidenceToolCall,
    serializeToolResult,
    truncateEvidence
} from './SystemLlmEvidence';
import {
    ChallengeEvidence,
    ChallengingStance,
    formatChallengeForAgent
} from './SystemLlmStancePrompts';

const logger = new Logger('info', 'SystemLlmChallengeService', 'server');

/** Most recent messages kept per channel as challenge evidence. */
const MESSAGE_BUFFER = EVIDENCE_CAPS.messages;
/** Most recent tool calls kept per (channel, agent) as challenge evidence. */
const TOOL_CALL_BUFFER = EVIDENCE_CAPS.toolCalls;

/** A buffered message; `toAgentId` is set for a direct message, absent for a broadcast. */
interface BufferedMessage extends EvidenceMessage {
    toAgentId?: string;
}

export interface CompletionClaim {
    task: ChannelTask;
    agentId: AgentId;
    channelId: ChannelId;
    summary: string;
    details?: Record<string, unknown>;
}

/**
 * Thrown when a challenge was required and could not be produced: the
 * budget is spent, the provider failed, or the reply did not validate.
 * The completion path surfaces it to the agent; the async paths log it.
 */
export class ChallengeUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ChallengeUnavailableError';
    }
}

export class SystemLlmChallengeService {
    private static instance: SystemLlmChallengeService | undefined;

    private subscriptions: Subscription[] = [];
    private started = false;
    private isShutdown = false;
    private readonly messages = new Map<ChannelId, BufferedMessage[]>();
    private readonly toolCalls = new Map<string, EvidenceToolCall[]>();
    /** Channels already warned about a spent budget, so the async path logs once. */
    private readonly budgetWarned = new Set<ChannelId>();
    /**
     * Challenges being generated right now, keyed `${taskId}:${trigger}`. The
     * once-per-task rule is enforced from the task record, which is written
     * after the model answers; this closes the window in between so a burst of
     * the same claim does not buy the same challenge twice.
     */
    private readonly inFlight = new Set<string>();

    private constructor() {}

    public static getInstance(): SystemLlmChallengeService {
        if (!SystemLlmChallengeService.instance) {
            SystemLlmChallengeService.instance = new SystemLlmChallengeService();
        }
        return SystemLlmChallengeService.instance;
    }

    /**
     * Subscribe to the events that carry claims and evidence. Idempotent.
     */
    public start(): void {
        if (this.isShutdown) {
            throw new Error('SystemLlmChallengeService is shut down');
        }
        if (this.started) {
            return;
        }
        this.subscriptions.push(
            EventBus.server.on(Events.Mcp.TOOL_RESULT, payload => {
                this.recordToolResult(payload as McpToolResultEventPayload);
            }),
            EventBus.server.on(Events.Message.AGENT_MESSAGE_DELIVERED, payload => {
                const event = payload as AgentMessageDeliveredEventPayload;
                if (typeof event.data?.fromAgentId !== 'string' || typeof event.channelId !== 'string') {
                    return;
                }
                const toAgentId = typeof event.data.toAgentId === 'string' ? event.data.toAgentId : undefined;
                this.recordMessage(event.channelId, event.data.fromAgentId, event.data.content, toAgentId);
            }),
            EventBus.server.on(Events.Message.CHANNEL_MESSAGE, payload => {
                const event = payload as ChannelMessageEventPayload;
                const message = event.data;
                if (typeof message?.senderId !== 'string' || typeof event.channelId !== 'string') {
                    return;
                }
                const receiverId = typeof message.receiverId === 'string' ? message.receiverId : undefined;
                this.recordMessage(event.channelId, message.senderId, message.content, receiverId);
            }),
            EventBus.server.on(OrparEvents.PLAN, payload => {
                void this.handlePlanEvent(payload as OrparPlanPayload);
            }),
            EventBus.server.on(OrparEvents.REFLECT, payload => {
                void this.handleReflectEvent(payload as OrparReflectPayload);
            }),
            // Evidence is per channel and per (channel, agent); drop it with them.
            EventBus.server.on(Events.Channel.DELETED, payload => {
                this.forgetChannel(payload.channelId);
            }),
            EventBus.server.on(Events.Channel.ARCHIVED, payload => {
                this.forgetChannel(payload.channelId);
            }),
            EventBus.server.on(Events.Agent.DISCONNECTED, payload => {
                this.forgetAgent(payload.agentId);
            })
        );
        this.started = true;
        logger.info('SystemLlmChallengeService started');
    }

    public shutdown(): void {
        for (const subscription of this.subscriptions) {
            subscription.unsubscribe();
        }
        this.subscriptions = [];
        this.messages.clear();
        this.toolCalls.clear();
        this.budgetWarned.clear();
        this.inFlight.clear();
        this.started = false;
        this.isShutdown = true;
        SystemLlmChallengeService.instance = undefined;
    }

    /**
     * Challenge a completion claim before the task is marked complete.
     *
     * Returns null when there is nothing to challenge: supportive stance,
     * SystemLLM off for the channel, the trigger already challenged for this
     * task, or the critic found every claim supported.
     *
     * @throws ChallengeUnavailableError when a challenge was required and
     *         could not be produced. The caller must not complete the task.
     */
    public async challengeCompletionClaim(claim: CompletionClaim): Promise<SystemLlmChallenge | null> {
        const stance = ConfigManager.getInstance().getChannelSystemLlmStance(claim.channelId);
        if (stance === 'supportive') {
            return null;
        }
        const details = claim.details && Object.keys(claim.details).length > 0
            ? serializeToolResult(claim.details)
            : undefined;
        const challenge = await this.challenge({
            stance,
            trigger: 'completion_claim',
            task: claim.task,
            agentId: claim.agentId,
            channelId: claim.channelId,
            claim: claim.summary,
            claimDetails: details,
            delivery: 'tool_result',
            required: true
        });
        if (challenge) {
            // The caller returns it as the tool result; that is the delivery.
            this.announce(challenge);
        }
        return challenge;
    }

    private async handlePlanEvent(payload: OrparPlanPayload): Promise<void> {
        const { agentId, channelId } = payload;
        const plan = payload.data?.plan;
        if (typeof agentId !== 'string' || typeof channelId !== 'string' || typeof plan !== 'string') {
            return;
        }
        const actions = payload.data.actions;
        const details = [
            Array.isArray(actions) && actions.length > 0 ? `Actions:\n${serializeToolResult(actions)}` : null,
            payload.data.rationale ? `Rationale: ${payload.data.rationale}` : null,
            payload.data.contingency ? `Contingency: ${payload.data.contingency}` : null
        ].filter((part): part is string => part !== null).join('\n');

        await this.challengeAsync(agentId, channelId, 'plan_posted', plan, details || undefined);
    }

    private async handleReflectEvent(payload: OrparReflectPayload): Promise<void> {
        const { agentId, channelId } = payload;
        const reflection = payload.data?.reflection;
        if (typeof agentId !== 'string' || typeof channelId !== 'string' || typeof reflection !== 'string') {
            return;
        }
        if (payload.data.expectationsMet === false) {
            // The agent already said it fell short. Nothing to dispute.
            return;
        }
        const details = [
            Array.isArray(payload.data.learnings) && payload.data.learnings.length > 0
                ? `Learnings:\n${payload.data.learnings.map(learning => `- ${learning}`).join('\n')}`
                : null,
            payload.data.adjustments ? `Adjustments: ${payload.data.adjustments}` : null
        ].filter((part): part is string => part !== null).join('\n');

        await this.challengeAsync(agentId, channelId, 'reflection_success', reflection, details || undefined);
    }

    /**
     * The asynchronous path: resolve the agent's task, challenge, deliver as a
     * channel message. Errors are logged — there is no caller to fail into.
     */
    private async challengeAsync(
        agentId: AgentId,
        channelId: ChannelId,
        trigger: ChallengeTrigger,
        claim: string,
        claimDetails?: string
    ): Promise<void> {
        const stance = ConfigManager.getInstance().getChannelSystemLlmStance(channelId);
        if (stance === 'supportive') {
            return;
        }
        try {
            const task = await TaskService.getInstance().findActiveTaskForAgent(channelId, agentId);
            if (!task) {
                logger.debug(`[Challenge] ${agentId} has no active task in ${channelId}; ${trigger} not challenged`);
                return;
            }
            const challenge = await this.challenge({
                stance,
                trigger,
                task,
                agentId,
                channelId,
                claim,
                claimDetails,
                delivery: 'channel_message',
                required: false
            });
            if (!challenge) {
                return;
            }
            // The model call took time. If the task ended meanwhile, the agent
            // will not take a turn on this; the record stays as audit trail.
            const stillActive = await TaskService.getInstance().findActiveTaskForAgent(channelId, agentId);
            if (!stillActive || stillActive.id !== task.id) {
                logger.info(
                    `[Challenge] task ${task.id} ended before ${trigger} challenge ${challenge.id} could be delivered to ${agentId}; not sent`
                );
                return;
            }
            const systemLlm = this.resolveService(channelId, false);
            if (!systemLlm) {
                // It was available a moment ago to generate the challenge; it can
                // only have gone away through shutdown or a budget exhausted by
                // this very call. The record exists; nothing was announced.
                logger.warn(`[Challenge] SystemLLM unavailable to deliver ${challenge.id} to ${agentId}`);
                return;
            }
            systemLlm.injectSystemChallengeMessage(challenge, formatChallengeForAgent(challenge));
            this.announce(challenge);
        } catch (error) {
            logger.error(
                `[Challenge] ${stance} ${trigger} challenge for ${agentId} in ${channelId} failed: ` +
                (error instanceof Error ? error.message : String(error))
            );
        }
    }

    /**
     * Shared challenge pipeline: once-per-trigger check, evidence, model,
     * record, event.
     */
    private async challenge(input: {
        stance: ChallengingStance;
        trigger: ChallengeTrigger;
        task: ChannelTask;
        agentId: AgentId;
        channelId: ChannelId;
        claim: string;
        claimDetails?: string;
        delivery: ChallengeDelivery;
        /** When true, an unavailable SystemLLM (other than disabled) throws instead of logging. */
        required: boolean;
    }): Promise<SystemLlmChallenge | null> {
        const { stance, trigger, task, agentId, channelId, delivery } = input;

        if (hasChallengeRecord(task, trigger)) {
            logger.debug(`[Challenge] task ${task.id} already challenged on ${trigger}; letting it through`);
            return null;
        }

        const inFlightKey = `${task.id}:${trigger}`;
        if (this.inFlight.has(inFlightKey)) {
            logger.debug(`[Challenge] a ${trigger} challenge for task ${task.id} is already being generated`);
            return null;
        }

        const systemLlm = this.resolveService(channelId, input.required);
        if (!systemLlm) {
            return null;
        }

        const evidence = this.gatherEvidence(task, agentId, channelId, input.claim, input.claimDetails);
        let parsed;
        this.inFlight.add(inFlightKey);
        try {
            parsed = await systemLlm.generateChallenge(stance, trigger, evidence);
        } catch (error) {
            throw new ChallengeUnavailableError(
                `SystemLLM could not produce a ${stance} challenge for ${trigger}: ` +
                (error instanceof Error ? error.message : String(error))
            );
        } finally {
            this.inFlight.delete(inFlightKey);
        }

        if (!parsed.challenge) {
            logger.info(`[Challenge] ${stance} stance found nothing to dispute in ${agentId}'s ${trigger} on task ${task.id}`);
            return null;
        }

        const challenge: SystemLlmChallenge = {
            id: uuidv4(),
            channelId,
            agentId,
            taskId: task.id,
            trigger,
            stance,
            delivery,
            summary: parsed.summary,
            points: parsed.points,
            createdAt: Date.now()
        };
        const record: SystemLlmChallengeRecord = {
            id: challenge.id,
            trigger,
            stance,
            delivery,
            summary: challenge.summary,
            points: challenge.points,
            createdAt: challenge.createdAt
        };
        const recorded = await TaskService.getInstance().recordSystemLlmChallenge(task.id, channelId, record);
        if (!recorded) {
            // Another claim for the same trigger won the write while the model
            // was answering. That challenge stands; this one is dropped.
            logger.info(`[Challenge] task ${task.id} was already challenged on ${trigger} while this one was generated; dropping it`);
            return null;
        }

        return challenge;
    }

    /**
     * Announce a challenge once it has actually reached its delivery path: as
     * the tool result of the completion call, or as an injected channel
     * message. Before delivery it is only a record on the task.
     */
    private announce(challenge: SystemLlmChallenge): void {
        EventBus.server.emit(
            Events.System.SYSTEMLLM_CHALLENGE_ISSUED,
            createSystemLlmChallengeIssuedEventPayload(challenge.agentId, challenge.channelId, {
                challengeId: challenge.id,
                taskId: challenge.taskId,
                trigger: challenge.trigger,
                stance: challenge.stance,
                delivery: challenge.delivery,
                summary: challenge.summary,
                points: challenge.points
            })
        );
        logger.info(
            `[Challenge] ${challenge.stance} ${challenge.trigger} challenge ${challenge.id} issued to ${challenge.agentId} ` +
            `on task ${challenge.taskId} (${challenge.points.length} points, via ${challenge.delivery})`
        );
    }

    /**
     * The channel's SystemLLM service, or null when SystemLLM is off for the
     * channel. A spent daily budget is not "off": when the challenge is
     * required it throws, otherwise it warns once per channel and returns null.
     *
     * The off check comes first and on its own: getServiceForChannel returns
     * null for "off" and for "budget spent" alike, and a channel that opted
     * out of SystemLLM must never be blocked by other channels' spend.
     */
    private resolveService(channelId: ChannelId, required: boolean): SystemLlmService | null {
        if (!isSystemLlmEnabled() || !ConfigManager.getInstance().isChannelSystemLlmEnabled(channelId)) {
            logger.debug(`[Challenge] SystemLLM is off for channel ${channelId}; stance does not apply`);
            return null;
        }
        const service = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
        if (service) {
            return service;
        }
        if (SystemLlmBudgetService.getInstance().isExhausted()) {
            const message = `SystemLLM daily budget is spent; no challenge can be produced for channel ${channelId}`;
            if (required) {
                throw new ChallengeUnavailableError(message);
            }
            if (!this.budgetWarned.has(channelId)) {
                this.budgetWarned.add(channelId);
                logger.warn(`[Challenge] ${message}`);
            }
            return null;
        }
        // Enabled, not over budget, and still no service: the manager is shut
        // down or refused for another reason. Treat as unavailable, not off.
        const message = `SystemLLM is unavailable for channel ${channelId}; no challenge can be produced`;
        if (required) {
            throw new ChallengeUnavailableError(message);
        }
        logger.warn(`[Challenge] ${message}`);
        return null;
    }

    /** Drop every buffer for a channel: its messages, and tool calls of every agent in it. */
    private forgetChannel(channelId: unknown): void {
        if (typeof channelId !== 'string') {
            return;
        }
        this.messages.delete(channelId);
        this.budgetWarned.delete(channelId);
        for (const key of this.toolCalls.keys()) {
            if (key.startsWith(`${channelId}:`)) {
                this.toolCalls.delete(key);
            }
        }
    }

    /** Drop an agent's tool-call buffers in every channel. */
    private forgetAgent(agentId: unknown): void {
        if (typeof agentId !== 'string') {
            return;
        }
        for (const key of this.toolCalls.keys()) {
            if (key.endsWith(`:${agentId}`)) {
                this.toolCalls.delete(key);
            }
        }
    }

    private gatherEvidence(
        task: ChannelTask,
        agentId: AgentId,
        channelId: ChannelId,
        claim: string,
        claimDetails?: string
    ): ChallengeEvidence {
        const orparState = getAllOrparStates().get(`${agentId}:${channelId}`);
        return {
            task: {
                id: task.id,
                title: task.title,
                description: task.description,
                objectives: completionObjectives(task)
            },
            agentId,
            claim,
            claimDetails,
            orparHistory: (orparState?.phaseHistory ?? []).map(entry => ({
                phase: entry.phase,
                content: entry.content
            })),
            // Broadcasts, plus direct messages this agent sent or received. A
            // private exchange between two other agents is not this agent's
            // evidence and is not quoted into a challenge against it.
            messages: (this.messages.get(channelId) ?? [])
                .filter(message =>
                    message.toAgentId === undefined ||
                    message.toAgentId === agentId ||
                    message.agentId === agentId
                )
                .map(({ agentId: sender, content }) => ({ agentId: sender, content })),
            toolCalls: this.toolCalls.get(`${channelId}:${agentId}`) ?? []
        };
    }

    /**
     * Evidence is only kept for channels whose stance can use it. A supportive
     * channel costs nothing; a channel switched to critical later starts
     * collecting from that moment.
     */
    private collectsEvidence(channelId: ChannelId): boolean {
        return ConfigManager.getInstance().getChannelSystemLlmStance(channelId) !== 'supportive';
    }

    private recordMessage(channelId: ChannelId, senderId: string, content: unknown, toAgentId?: string): void {
        if (senderId === 'system') {
            // SystemLLM's own hints and challenges are not evidence of agent work.
            return;
        }
        if (!this.collectsEvidence(channelId)) {
            return;
        }
        const text = truncateEvidence(extractMessageText(content), EVIDENCE_CAPS.messageChars);
        const buffer = this.messages.get(channelId) ?? [];
        buffer.push({ agentId: senderId, content: text, ...(toAgentId !== undefined ? { toAgentId } : {}) });
        if (buffer.length > MESSAGE_BUFFER) {
            buffer.splice(0, buffer.length - MESSAGE_BUFFER);
        }
        this.messages.set(channelId, buffer);
    }

    private recordToolResult(event: McpToolResultEventPayload): void {
        if (typeof event.agentId !== 'string' || typeof event.channelId !== 'string' ||
            typeof event.data?.toolName !== 'string') {
            return;
        }
        if (!this.collectsEvidence(event.channelId)) {
            return;
        }
        const key = `${event.channelId}:${event.agentId}`;
        const buffer = this.toolCalls.get(key) ?? [];
        buffer.push({
            agentId: event.agentId,
            toolName: event.data.toolName,
            // Truncated at record time so the buffer is bounded in bytes, not just entries.
            result: truncateEvidence(serializeToolResult(event.data.result), EVIDENCE_CAPS.toolResultChars)
        });
        if (buffer.length > TOOL_CALL_BUFFER) {
            buffer.splice(0, buffer.length - TOOL_CALL_BUFFER);
        }
        this.toolCalls.set(key, buffer);
    }
}

/** Whether this trigger was already challenged for the task. */
export function hasChallengeRecord(task: ChannelTask, trigger: ChallengeTrigger): boolean {
    const records = task.metadata?.[TASK_METADATA_CHALLENGES_KEY];
    return Array.isArray(records) && records.some(record =>
        typeof record === 'object' && record !== null && (record as SystemLlmChallengeRecord).trigger === trigger
    );
}

/** Objectives from a systemllm-eval completion config, when the task has one. */
function completionObjectives(task: ChannelTask): string[] {
    const primary = task.metadata?.completionConfig?.primary;
    if (primary && primary.type === 'systemllm-eval' && Array.isArray(primary.objectives)) {
        return primary.objectives.filter((objective: unknown): objective is string => typeof objective === 'string');
    }
    return [];
}

/**
 * Message content arrives in two shapes: a plain value (direct agent messages)
 * or `{format, data}` (channel messages built by createChannelMessage).
 */
function extractMessageText(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }
    if (typeof content === 'object' && content !== null && 'data' in content) {
        const data = (content as { data: unknown }).data;
        return typeof data === 'string' ? data : serializeToolResult(data);
    }
    return serializeToolResult(content);
}
