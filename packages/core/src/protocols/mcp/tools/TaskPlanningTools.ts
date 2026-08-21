/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type { Subscription } from 'rxjs';
import type { ChannelTask } from '../../../types/TaskTypes.js';
import type { TaskCompletionConfig } from '../../../types/TaskCompletionTypes.js';
import {
    McpToolDefinition,
    McpToolHandlerContext,
    McpToolHandlerResult,
    McpToolResultContent
} from '../McpServerTypes.js';
import type { McpToolInput } from '../IMcpClient.js';
import { Logger } from '../../../utils/Logger.js';
import { EventBus } from '../../../events/EventBus.js';
import { Events } from '../../../events/EventNames.js';
import { TaskEvents } from '../../../events/event-definitions/TaskEvents.js';
import { createTaskEventPayload } from '../../../schemas/EventPayloadSchema.js';
import PlanModel from '../../../models/plan.js';
import { Task } from '../../../models/task.js';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger('debug', 'TaskPlanningTools', 'server');
const planUpdateLocks = new Set<string>();

interface PlanningIdentity {
    agentId: string;
    channelId: string;
}

interface CorrelatedTaskEventData {
    requestId?: string;
    taskId?: string;
    task?: ChannelTask;
    error?: string;
}

interface CompletionPlanStepInput {
    title: string;
    description?: string;
    critical?: boolean;
}

const requireIdentity = (context: McpToolHandlerContext): PlanningIdentity => {
    if (typeof context.agentId !== 'string' || context.agentId.trim().length === 0 ||
        typeof context.channelId !== 'string' || context.channelId.trim().length === 0) {
        throw new Error('Authenticated agentId and channelId are required');
    }
    return { agentId: context.agentId.trim(), channelId: context.channelId.trim() };
};

const readCorrelatedEvent = (payload: unknown): {
    channelId?: string;
    data: CorrelatedTaskEventData;
} | null => {
    if (!payload || typeof payload !== 'object' || !('data' in payload)) {
        return null;
    }
    const candidate = payload as { channelId?: unknown; data?: unknown };
    if (!candidate.data || typeof candidate.data !== 'object') {
        return null;
    }
    return {
        channelId: typeof candidate.channelId === 'string' ? candidate.channelId : undefined,
        data: candidate.data as CorrelatedTaskEventData
    };
};

const awaitTaskEvent = (
    requestId: string,
    channelId: string,
    successEvent: typeof TaskEvents.CREATED | typeof TaskEvents.PROGRESS_UPDATED,
    emitRequest: () => void
): Promise<ChannelTask> => {
    let successSubscription: Subscription | undefined;
    let errorSubscription: Subscription | undefined;
    const result = new Promise<ChannelTask>((resolve, reject) => {
        const cleanup = (): void => {
            successSubscription?.unsubscribe();
            errorSubscription?.unsubscribe();
        };
        successSubscription = EventBus.server.on(successEvent, payload => {
            const event = readCorrelatedEvent(payload);
            if (event?.channelId !== channelId || event.data.requestId !== requestId) {
                return;
            }
            if (!event.data.task?.id) {
                cleanup();
                reject(new Error(`${successEvent} ${requestId} returned no persisted task`));
                return;
            }
            cleanup();
            resolve(event.data.task);
        });
        errorSubscription = EventBus.server.on(TaskEvents.ERROR, payload => {
            const event = readCorrelatedEvent(payload);
            if (event?.channelId !== channelId || event.data.requestId !== requestId) {
                return;
            }
            cleanup();
            reject(new Error(event.data.error ?? `Task operation ${requestId} failed`));
        });
    });
    try {
        emitRequest();
    } catch (error) {
        successSubscription?.unsubscribe();
        errorSubscription?.unsubscribe();
        throw error;
    }
    return result;
};

const requireString = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${field} is required`);
    }
    return value.trim();
};

const requireAssignees = (value: unknown, defaultAgentId: string): string[] => {
    if (value === undefined) {
        return [defaultAgentId];
    }
    if (!Array.isArray(value) || value.length === 0 ||
        value.some(agentId => typeof agentId !== 'string' || agentId.trim().length === 0)) {
        throw new Error('assignTo must be a non-empty array of agent ids');
    }
    return Array.from(new Set(value.map(agentId => (agentId as string).trim())));
};

const emitCreateRequest = (
    identity: PlanningIdentity,
    requestId: string,
    task: Partial<ChannelTask> & Pick<ChannelTask, 'title'>
): Promise<ChannelTask> => awaitTaskEvent(
    requestId,
    identity.channelId,
    TaskEvents.CREATED,
    () => EventBus.server.emit(
        TaskEvents.CREATE_REQUEST,
        createTaskEventPayload(TaskEvents.CREATE_REQUEST, identity.agentId, identity.channelId, {
            taskId: requestId,
            requestId,
            fromAgentId: identity.agentId,
            toAgentId: task.assignedAgentIds?.[0] ?? identity.agentId,
            task
        })
    )
);

export const task_create_with_plan: McpToolDefinition = {
    name: 'task_create_with_plan',
    description: 'Persist a task and completion plan, then monitor the task until its configured plan criteria are met.',
    inputSchema: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Title of the task' },
            description: { type: 'string', description: 'Detailed task description' },
            completionPlan: {
                type: 'object',
                properties: {
                    steps: {
                        type: 'array',
                        minItems: 1,
                        items: {
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                description: { type: 'string' },
                                critical: { type: 'boolean', default: false }
                            },
                            required: ['title']
                        }
                    },
                    completionType: {
                        type: 'string',
                        enum: ['all_steps', 'critical_steps', 'percentage'],
                        default: 'all_steps'
                    },
                    percentage: { type: 'number', minimum: 0, maximum: 100 }
                },
                required: ['steps']
            },
            assignTo: { type: 'array', minItems: 1, items: { type: 'string' } },
            priority: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
            absoluteTimeout: { type: 'number', minimum: 1 }
        },
        required: ['title', 'description', 'completionPlan']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const startedAt = Date.now();
        const identity = requireIdentity(context);
        const title = requireString(input.title, 'title');
        const description = requireString(input.description, 'description');
        const completionPlan = input.completionPlan as {
            steps?: CompletionPlanStepInput[];
            completionType?: 'all_steps' | 'critical_steps' | 'percentage';
            percentage?: number;
        };
        if (!completionPlan || !Array.isArray(completionPlan.steps) || completionPlan.steps.length === 0) {
            throw new Error('completionPlan.steps must contain at least one step');
        }
        for (const step of completionPlan.steps) {
            requireString(step.title, 'completionPlan step title');
        }
        const completionType = completionPlan.completionType ?? 'all_steps';
        if (completionType === 'percentage' &&
            (typeof completionPlan.percentage !== 'number' ||
                completionPlan.percentage < 0 || completionPlan.percentage > 100)) {
            throw new Error('percentage must be between 0 and 100 for percentage completion');
        }
        if (completionType === 'critical_steps' && !completionPlan.steps.some(step => step.critical === true)) {
            throw new Error('critical_steps completion requires at least one critical step');
        }

        const planId = uuidv4();
        const planDoc = new PlanModel({
            planId,
            title: `${title} - Completion Plan`,
            createdBy: identity.agentId,
            channelId: identity.channelId,
            items: completionPlan.steps.map((step, index) => ({
                id: `item-${index + 1}`,
                title: step.title.trim(),
                description: step.description,
                status: 'pending',
                priority: step.critical ? 'high' : 'medium'
            })),
            metadata: { type: 'task_completion_plan', taskTitle: title }
        });
        await planDoc.save();

        const completionConfig: TaskCompletionConfig = {
            primary: {
                type: 'plan-based',
                planId,
                completionType,
                percentage: completionPlan.percentage
            },
            absoluteTimeout: typeof input.absoluteTimeout === 'number' ? input.absoluteTimeout : undefined,
            timeoutBehavior: typeof input.absoluteTimeout === 'number' ? 'fail' : undefined,
            allowManualCompletion: true
        };
        const assignees = requireAssignees(input.assignTo, identity.agentId);
        const requestId = uuidv4();

        try {
            const task = await emitCreateRequest(identity, requestId, {
                channelId: identity.channelId,
                title,
                description,
                assignmentScope: assignees.length > 1 ? 'multiple' : 'single',
                assignmentStrategy: 'manual',
                assignedAgentIds: assignees,
                coordinationMode: 'collaborative',
                priority: input.priority ?? 'medium',
                metadata: { completionConfig, planId, enableMonitoring: true }
            });
            return {
                content: {
                    type: 'application/json',
                    data: {
                        success: true,
                        taskId: task.id,
                        planId,
                        totalSteps: planDoc.items.length,
                        criticalSteps: planDoc.items.filter(item => item.priority === 'high').length,
                        completionType
                    }
                },
                metadata: { processingTime: Date.now() - startedAt, taskId: task.id, planId }
            };
        } catch (error) {
            try {
                await PlanModel.deleteOne({ planId, channelId: identity.channelId });
            } catch (cleanupError) {
                logger.error(`Failed to remove plan ${planId} after task creation failure: ${String(cleanupError)}`);
            }
            logger.error(`Failed to create task with plan: ${String(error)}`);
            throw error;
        }
    }
};

export const task_create_custom_completion: McpToolDefinition = {
    name: 'task_create_custom_completion',
    description: 'Persist a task with a supported SystemLLM, output, or time-based completion monitor.',
    inputSchema: {
        type: 'object',
        properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            completionStrategy: {
                type: 'string',
                enum: ['systemllm-eval', 'output-based', 'time-based']
            },
            completionCriteria: {
                type: 'object',
                properties: {
                    objectives: { type: 'array', minItems: 1, items: { type: 'string' } },
                    evaluationInterval: { type: 'number', minimum: 1, default: 30000 },
                    confidenceThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.8 },
                    maxEvaluations: {
                        type: 'number',
                        minimum: 1,
                        maximum: 100,
                        description: 'Maximum SystemLLM evaluations before the task fails'
                    },
                    requiredOutputs: {
                        type: 'array',
                        minItems: 1,
                        items: {
                            type: 'object',
                            properties: {
                                type: { type: 'string', enum: ['message', 'tool_call'] },
                                pattern: { type: 'string', maxLength: 256 },
                                count: { type: 'number', minimum: 1, default: 1 }
                            },
                            required: ['type']
                        }
                    },
                    minimumDuration: { type: 'number', minimum: 0 },
                    maximumDuration: { type: 'number', minimum: 1 },
                    requireActivity: { type: 'boolean', default: true }
                }
            },
            assignTo: { type: 'array', minItems: 1, items: { type: 'string' } }
        },
        required: ['title', 'description', 'completionStrategy', 'completionCriteria']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const startedAt = Date.now();
        const identity = requireIdentity(context);
        const title = requireString(input.title, 'title');
        const description = requireString(input.description, 'description');
        const criteria = input.completionCriteria as Record<string, unknown>;
        if (!criteria || typeof criteria !== 'object') {
            throw new Error('completionCriteria is required');
        }

        let primary: TaskCompletionConfig['primary'];
        if (input.completionStrategy === 'systemllm-eval') {
            if (!Array.isArray(criteria.objectives) || criteria.objectives.length === 0 ||
                criteria.objectives.some(objective => typeof objective !== 'string' || objective.trim().length === 0)) {
                throw new Error('systemllm-eval requires at least one objective');
            }
            if (!Number.isInteger(criteria.maxEvaluations) ||
                (criteria.maxEvaluations as number) < 1 ||
                (criteria.maxEvaluations as number) > 100) {
                throw new Error('systemllm-eval requires maxEvaluations between 1 and 100');
            }
            primary = {
                type: 'systemllm-eval',
                objectives: criteria.objectives as string[],
                evaluationInterval: typeof criteria.evaluationInterval === 'number'
                    ? criteria.evaluationInterval
                    : 30_000,
                confidenceThreshold: typeof criteria.confidenceThreshold === 'number'
                    ? criteria.confidenceThreshold
                    : 0.8,
                maxEvaluations: criteria.maxEvaluations as number
            };
        } else if (input.completionStrategy === 'output-based') {
            if (!Array.isArray(criteria.requiredOutputs) || criteria.requiredOutputs.length === 0) {
                throw new Error('output-based completion requires at least one output');
            }
            primary = {
                type: 'output-based',
                requiredOutputs: criteria.requiredOutputs as Array<{
                    type: 'message' | 'tool_call';
                    pattern?: string;
                    count?: number;
                }>
            };
        } else if (input.completionStrategy === 'time-based') {
            if (typeof criteria.maximumDuration !== 'number' || criteria.maximumDuration <= 0) {
                throw new Error('time-based completion requires a positive maximumDuration');
            }
            primary = {
                type: 'time-based',
                minimumDuration: typeof criteria.minimumDuration === 'number'
                    ? criteria.minimumDuration
                    : undefined,
                maximumDuration: criteria.maximumDuration,
                requireActivity: criteria.requireActivity !== false
            };
        } else {
            throw new Error(`Unsupported completion strategy: ${String(input.completionStrategy)}`);
        }

        const assignees = requireAssignees(input.assignTo, identity.agentId);
        const requestId = uuidv4();
        const task = await emitCreateRequest(identity, requestId, {
            channelId: identity.channelId,
            title,
            description,
            assignmentScope: assignees.length > 1 ? 'multiple' : 'single',
            assignmentStrategy: 'manual',
            assignedAgentIds: assignees,
            coordinationMode: 'collaborative',
            priority: 'medium',
            metadata: {
                completionConfig: { primary, allowManualCompletion: true } satisfies TaskCompletionConfig,
                enableMonitoring: true
            }
        });
        return {
            content: {
                type: 'application/json',
                data: {
                    success: true,
                    taskId: task.id,
                    strategy: primary.type,
                    monitoringConfigured: true
                }
            },
            metadata: { processingTime: Date.now() - startedAt, taskId: task.id }
        };
    }
};

export const task_link_to_plan: McpToolDefinition = {
    name: 'task_link_to_plan',
    description: 'Persist a plan-based completion config on an existing same-channel task and start monitoring it.',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string' },
            planId: { type: 'string' },
            completionType: {
                type: 'string',
                enum: ['all_steps', 'critical_steps', 'percentage'],
                default: 'all_steps'
            },
            percentage: { type: 'number', minimum: 0, maximum: 100 }
        },
        required: ['taskId', 'planId']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const startedAt = Date.now();
        const identity = requireIdentity(context);
        const taskId = requireString(input.taskId, 'taskId');
        const planId = requireString(input.planId, 'planId');
        const lockKey = `${identity.channelId}\0${planId}`;
        if (planUpdateLocks.has(lockKey)) {
            throw new Error(`Plan ${planId} is already being linked in this channel`);
        }
        planUpdateLocks.add(lockKey);
        try {
            const completionType = input.completionType ?? 'all_steps';
            if (completionType === 'percentage' && typeof input.percentage !== 'number') {
                throw new Error('percentage is required for percentage completion');
            }
            const plan = await PlanModel.findOne({ planId, channelId: identity.channelId });
            if (!plan) {
                throw new Error(`Plan ${planId} not found in channel ${identity.channelId}`);
            }
            if (completionType === 'critical_steps' && !plan.items.some(item => item.priority === 'high')) {
                throw new Error(`Plan ${planId} contains no critical steps`);
            }
            const task = await Task.findOne({ _id: taskId, channelId: identity.channelId });
            if (!task) {
                throw new Error(`Task ${taskId} not found in channel ${identity.channelId}`);
            }

            const completionConfig: TaskCompletionConfig = {
                primary: {
                    type: 'plan-based',
                    planId,
                    completionType,
                    percentage: typeof input.percentage === 'number' ? input.percentage : undefined
                },
                allowManualCompletion: true
            };
            const requestId = uuidv4();
            const updatedTask = await awaitTaskEvent(
                requestId,
                identity.channelId,
                TaskEvents.PROGRESS_UPDATED,
                () => EventBus.server.emit(
                    Events.Task.UPDATE_REQUEST,
                    createTaskEventPayload(
                        Events.Task.UPDATE_REQUEST,
                        identity.agentId,
                        identity.channelId,
                        {
                            taskId,
                            requestId,
                            fromAgentId: identity.agentId,
                            toAgentId: task.assignedAgentId ?? identity.agentId,
                            task: {
                                taskId,
                                requestId,
                                metadata: {
                                    ...(task.metadata ?? {}),
                                    completionConfig,
                                    planId,
                                    enableMonitoring: true
                                }
                            }
                        }
                    )
                )
            );
            return {
                content: {
                    type: 'application/json',
                    data: {
                        success: true,
                        taskId: updatedTask.id,
                        planId,
                        completionType,
                        monitoringConfigured: true
                    }
                },
                metadata: { processingTime: Date.now() - startedAt }
            };
        } finally {
            planUpdateLocks.delete(lockKey);
        }
    }
};

export const task_monitoring_status: McpToolDefinition = {
    name: 'task_monitoring_status',
    description: 'Read the persisted task state and automatic-completion configuration for a same-channel task.',
    inputSchema: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const identity = requireIdentity(context);
        const taskId = requireString(input.taskId, 'taskId');
        const task = await Task.findOne({ _id: taskId, channelId: identity.channelId });
        if (!task) {
            throw new Error(`Task ${taskId} not found in channel ${identity.channelId}`);
        }
        return {
            content: {
                type: 'application/json',
                data: {
                    taskId,
                    channelId: identity.channelId,
                    status: task.status,
                    progress: task.progress,
                    monitoringConfigured: task.metadata?.enableMonitoring === true &&
                        task.metadata?.completionConfig !== undefined,
                    completionConfig: task.metadata?.completionConfig
                }
            }
        };
    }
};

export const task_delegate: McpToolDefinition = {
    name: 'task_delegate',
    description: 'Signal that work was delegated and yield the current agent loop without completing the parent task.',
    inputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const identity = requireIdentity(context);
        const summary = requireString(input.summary, 'summary');
        const content: McpToolResultContent = {
            type: 'text',
            data: `Delegation recorded for ${identity.agentId}.\n\n${summary}`
        };
        return { content, metadata: { delegated: true } };
    }
};

export const taskPlanningTools = [
    task_create_with_plan,
    task_create_custom_completion,
    task_link_to_plan,
    task_monitoring_status,
    task_delegate
];
