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
 * Task Service for intelligent task management and assignment
 * Uses SystemLlmService for intelligent agent assignment
 */

import { Observable, BehaviorSubject, combineLatest, from, throwError, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { SystemLlmService } from './SystemLlmService';
import { SystemLlmServiceManager } from './SystemLlmServiceManager';
import { AgentService } from './AgentService';
import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';
import { EphemeralEventPatternService } from './EphemeralEventPatternService';
import { 
    ChannelTask, 
    TaskOrchestrationConfig,
    ChannelWorkloadAnalysis,
    AgentAssignmentAnalysis,
    CreateTaskRequest,
    NonLifecycleTaskUpdateRequest,
    UpdateTaskRequest,
    TaskAssignmentResult,
    TaskQueryFilters,
    AssignmentStrategy
} from '@mxf-dev/core/types/TaskTypes';
import { TaskEventData, createTaskEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { AgentId } from '@mxf-dev/core/types/Agent';
import { ChannelId } from '@mxf-dev/core/types/ChannelContext';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from '@mxf-dev/core/models/agent';
import { Task, TaskDocument } from '@mxf-dev/core/models/task';
import { TaskEvents } from '@mxf-dev/core/events/event-definitions/TaskEvents';
import {
    MonitoredTaskTransition,
    TaskCompletionMonitoringService
} from './TaskCompletionMonitoringService';
import { TaskCompletionConfig } from '@mxf-dev/core/types/TaskCompletionTypes';
import {
    TASK_COMPLETION_CHALLENGED_STATUS,
    TASK_METADATA_CHALLENGES_KEY,
    type SystemLlmChallenge,
    type SystemLlmChallengeRecord
} from '@mxf-dev/core/types/SystemLlmStanceTypes';
import { SystemLlmChallengeService } from './SystemLlmChallengeService';
import { TaskDagService } from '@mxf-dev/core/services/dag/TaskDagService';
import { isDagEnabled, isDagEnforcementEnabled } from '@mxf-dev/core/config/dag.config';
import { DagEvents } from '@mxf-dev/core/events/event-definitions/DagEvents';
import { createDagTaskBlockedPayload, createDagTaskDependenciesResolvedPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import type { FilterQuery } from 'mongoose';
import {
    parseCreateTaskRequest,
    parseNonLifecycleTaskUpdateRequest,
    parseUpdateTaskRequest
} from './TaskRequestPolicy';
import {
    assertTaskAgentsBelongToChannel,
    assertTaskDependenciesBelongToChannel
} from './TaskParticipantPolicy';

interface AssignmentCandidate {
    id: AgentId;
    role?: string;
    capabilities?: string[];
    specialization?: string;
    metadata?: Record<string, unknown>;
}

export type AgentTaskLifecycleTransition =
    | { kind: 'start' }
    | { kind: 'complete'; output: unknown }
    | { kind: 'fail'; error: string; output?: unknown }
    | { kind: 'cancel'; reason?: string };

export class TaskService {
    private static instance: TaskService | undefined;
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('TaskService');
    private readonly ephemeralEventService: EphemeralEventPatternService;
    
    // Orchestration state
    private readonly activeChannels = new BehaviorSubject<Set<ChannelId>>(new Set());
    private readonly taskAssignments = new Map<string, AgentId>();
    private readonly channelWorkloads = new Map<ChannelId, ChannelWorkloadAnalysis>();
    private orchestrationInitialized = false;

    /** Drives the 30s agent-coordination cadence from an interval we can unref(). */
    private readonly coordinationTick = new BehaviorSubject<number>(0);
    private coordinationTimer?: ReturnType<typeof setInterval>;
    private analysisTimer?: ReturnType<typeof setInterval>;
    private initialAnalysisTimer?: ReturnType<typeof setTimeout>;
    private orchestrationSubscriptions: Subscription[] = [];
    private agentService: AgentService | null = null;
    
    // Configuration for task orchestration
    private config: TaskOrchestrationConfig = {
        enableIntelligentAssignment: true,
        enableWorkloadBalancing: true,
        enableExpertiseMatching: true,
        maxTasksPerAgent: 5,
        agentOverloadThreshold: 0.8,
        taskTimeoutMinutes: 120,
        enableLlmAssignment: true,
        llmConfidenceThreshold: 0.7,
        enableTaskDependencies: true,
        enableLateJoinHandling: true,
        preventSimultaneousStart: false // Allow immediate assignment for single-agent scenarios
    };

    private constructor() {
        this.logger = new Logger('debug', 'TaskService', 'server');
        // Use per-channel SystemLlmService instances from SystemLlmServiceManager when needed
        // AgentService will be initialized lazily to avoid early singleton creation
        this.ephemeralEventService = EphemeralEventPatternService.getInstance();
        
        this.initializeOrchestration();
    }

    /**
     * Get AgentService instance lazily
     */
    private getAgentService(): AgentService {
        if (!this.agentService) {
            this.agentService = AgentService.getInstance();
        }
        return this.agentService;
    }

    public static getInstance(): TaskService {
        if (!TaskService.instance) {
            TaskService.instance = new TaskService();
        }
        return TaskService.instance;
    }

    /**
     * Initialize orchestration system
     */
    private initializeOrchestration(): void {
        if (this.orchestrationInitialized) return;

        try {
            this.setupTaskEventListeners();
            this.setupAgentCoordination();
            this.startPeriodicAnalysis();
            this.orchestrationInitialized = true;
        } catch (error) {
            if (this.coordinationTimer) {
                clearInterval(this.coordinationTimer);
                this.coordinationTimer = undefined;
            }
            if (this.analysisTimer) {
                clearInterval(this.analysisTimer);
                this.analysisTimer = undefined;
            }
            if (this.initialAnalysisTimer) {
                clearTimeout(this.initialAnalysisTimer);
                this.initialAnalysisTimer = undefined;
            }
            for (const subscription of this.orchestrationSubscriptions) {
                subscription.unsubscribe();
            }
            this.orchestrationSubscriptions = [];
            throw error;
        }
    }

    /**
     * Set up task event listeners for orchestration
     */
    private setupTaskEventListeners(): void {
        this.orchestrationSubscriptions.push(
            EventBus.server.on(
                Events.Task.CREATED,
                eventPayload => this.handleTaskCreated(eventPayload.data.task)
            )
        );
        this.orchestrationSubscriptions.push(
            EventBus.server.on(
                Events.Task.ASSIGNED,
                eventPayload => this.handleTaskAssigned(eventPayload.data.task)
            )
        );
        this.orchestrationSubscriptions.push(
            EventBus.server.on(
                Events.Task.COMPLETED,
                eventPayload => this.handleTaskCompleted(eventPayload.data.task)
            )
        );
    }

    /**
     * Set up agent coordination
     */
    private setupAgentCoordination(): void {
        // The 30s cadence is driven by a plain interval rather than RxJS timer().
        //
        // RxJS schedules timer()/interval() on setInterval internally and gives no access
        // to unref(), so the timer keeps Node's event loop open and any process that
        // merely constructed this service could never exit. The subscriptions were also
        // never stored, so they could not be torn down. A long-running server is kept
        // alive by its listener; a periodic sweep must not be what holds a process open.
        this.coordinationTimer = setInterval(
            () => this.coordinationTick.next(this.coordinationTick.value + 1),
            30000
        );
        this.coordinationTimer.unref();

        this.orchestrationSubscriptions.push(
            combineLatest([
                this.activeChannels.asObservable(),
                this.coordinationTick.asObservable()
            ]).pipe(
                switchMap(() => this.coordinateAgentAssignments())
            ).subscribe({
                error: (error) => this.logger.error(`Agent coordination error: ${error}`)
            })
        );
    }

    /**
     * Start periodic analysis and optimization
     */
    private startPeriodicAnalysis(): void {
        const runAnalysis = () => {
            this.optimizeTaskAssignments().catch(error => {
                this.logger.error(`Periodic optimization failed: ${error}`);
            });
        };

        // timer(0, ...) used to fire an immediate pass on the next tick; preserve that.
        this.initialAnalysisTimer = setTimeout(runAnalysis, 0);
        this.initialAnalysisTimer.unref();

        // Run analysis every 5 minutes.
        this.analysisTimer = setInterval(runAnalysis, 5 * 60 * 1000);
        this.analysisTimer.unref();
    }

    /**
     * Stop the timer-driven producers without tearing down event handling.
     *
     * The coordination tick, the periodic optimization pass, and completion
     * monitoring all start new work on their own schedule, some of it through
     * SystemLLM. Shutdown calls this before draining accepted work so the
     * drain only has to wait for work that was already in flight; the event
     * handlers that finish that work stay subscribed until shutdown().
     */
    public stopPeriodicWork(): void {
        if (this.coordinationTimer) {
            clearInterval(this.coordinationTimer);
            this.coordinationTimer = undefined;
        }
        if (this.analysisTimer) {
            clearInterval(this.analysisTimer);
            this.analysisTimer = undefined;
        }
        if (this.initialAnalysisTimer) {
            clearTimeout(this.initialAnalysisTimer);
            this.initialAnalysisTimer = undefined;
        }
        TaskCompletionMonitoringService.shutdownExisting();
    }

    /**
     * Stop orchestration: clear the periodic timers and unsubscribe.
     *
     * Nothing tore these down before, so a TaskService instance leaked its subscriptions
     * for the lifetime of the process.
     */
    public shutdown(): void {
        if (!this.orchestrationInitialized) {
            return;
        }
        this.stopPeriodicWork();

        for (const subscription of this.orchestrationSubscriptions) {
            subscription.unsubscribe();
        }
        this.orchestrationSubscriptions = [];
        TaskDagService.shutdownExisting();
        this.taskAssignments.clear();
        this.channelWorkloads.clear();
        this.activeChannels.next(new Set());
        this.coordinationTick.next(0);
        this.activeChannels.complete();
        this.coordinationTick.complete();
        this.agentService = null;
        this.orchestrationInitialized = false;
        if (TaskService.instance === this) {
            TaskService.instance = undefined;
        }
    }

    /**
     * Create a new task
     */
    public async createTask(
        request: CreateTaskRequest,
        createdBy: string,
        requestId?: string
    ): Promise<ChannelTask> {
        request = parseCreateTaskRequest(request);
        this.validator.assertIsNonEmptyString(createdBy, 'createdBy is required');

        const assignedAgentIds = Array.from(new Set([
            ...(request.assignedAgentId ? [request.assignedAgentId] : []),
            ...(request.assignedAgentIds ?? [])
        ]));
        const assignedAgentId = request.assignedAgentId ?? assignedAgentIds[0];
        if (request.completionAgentId && !assignedAgentIds.includes(request.completionAgentId)) {
            throw new Error(
                'completionAgentId must identify an agent assigned to the task'
            );
        }

        await assertTaskAgentsBelongToChannel(request.channelId, [
            ...assignedAgentIds,
            request.leadAgentId,
            request.completionAgentId
        ]);
        await assertTaskDependenciesBelongToChannel(request.channelId, request.dependsOn ?? []);

        const completionConfig = request.metadata?.enableMonitoring
            ? request.metadata?.completionConfig as TaskCompletionConfig | undefined
            : undefined;
        if (request.metadata?.enableMonitoring && !completionConfig) {
            throw new Error('completionConfig is required when task monitoring is enabled');
        }
        if (completionConfig) {
            TaskCompletionMonitoringService.getInstance().assertValidConfig(completionConfig);
        }

        const hasExplicitAssignment = assignedAgentId !== undefined || assignedAgentIds.length > 0;
        const task = new Task({
            ...request,
            assignedAgentId,
            assignedAgentIds,
            createdBy,
            priority: request.priority || 'medium',
            assignmentStrategy: request.assignmentStrategy || 'intelligent',
            status: hasExplicitAssignment ? 'assigned' : 'pending'
        });

        const savedTask = await task.save();
        const channelTask = this.taskDocumentToChannelTask(savedTask);

        // Emit task created event
        const eventPayload = createTaskEventPayload(
            Events.Task.CREATED,
            createdBy,
            request.channelId,
            {
                taskId: channelTask.id,
                requestId,
                fromAgentId: createdBy,
                toAgentId: channelTask.assignedAgentId || createdBy,
                task: channelTask
            }
        );
        EventBus.server.emit(Events.Task.CREATED, eventPayload);

        // Emit assignment events for all assigned agents (critical for multi-agent tasks)
        if (assignedAgentIds.length > 0) {
            
            for (const agentId of assignedAgentIds) {
                const assignmentPayload = createTaskEventPayload(
                    TaskEvents.ASSIGNED,
                    createdBy,
                    request.channelId,
                    {
                        taskId: channelTask.id,
                        fromAgentId: createdBy,
                        toAgentId: agentId,
                        task: {
                            ...channelTask,
                            taskRequest: {
                                taskId: channelTask.id,
                                title: channelTask.title,
                                description: channelTask.description,
                                channelId: request.channelId,
                                priority: channelTask.priority,
                                assignmentStrategy: channelTask.assignmentStrategy,
                                metadata: channelTask.metadata
                            }
                        }
                    }
                );
                EventBus.server.emit(TaskEvents.ASSIGNED, assignmentPayload);
            }
        }

        // Check if task has completion monitoring enabled
        if (completionConfig) {
            this.startCompletionMonitoring(savedTask, completionConfig);
        }

        return channelTask;
    }

    private startCompletionMonitoring(
        task: TaskDocument | ChannelTask,
        config: TaskCompletionConfig
    ): void {
        TaskCompletionMonitoringService.getInstance().startMonitoring(
            task,
            config,
            transition => this.transitionMonitoredTask(transition)
        );
    }

    /**
     * Persist an automatic terminal transition exactly once. The channel and
     * non-terminal status predicates stay on the write, so two overlapping
     * monitor evaluations cannot both announce completion and a monitor from
     * one channel cannot mutate an equal task identity in another.
     */
    public async transitionMonitoredTask(
        transition: MonitoredTaskTransition
    ): Promise<ChannelTask | null> {
        this.validator.assertIsNonEmptyString(transition.taskId, 'taskId is required');
        this.validator.assertIsNonEmptyString(transition.channelId, 'channelId is required');

        const persist = async (): Promise<ChannelTask | null> => {
            const task = await Task.findOneAndUpdate(
                {
                    _id: transition.taskId,
                    channelId: transition.channelId,
                    status: { $nin: ['completed', 'failed', 'cancelled'] }
                },
                {
                    $set: {
                        status: transition.status,
                        progress: transition.progress,
                        result: transition.result,
                        updatedAt: new Date()
                    }
                },
                { new: true, runValidators: true }
            );
            return task ? this.taskDocumentToChannelTask(task) : null;
        };

        if (transition.status === 'completed' && isDagEnabled()) {
            return TaskDagService.getInstance().withChannelLock(
                transition.channelId,
                async (): Promise<ChannelTask | null> => {
                    const task = await persist();
                    if (task) {
                        try {
                            await this.handleDagTaskCompletion(transition.channelId, transition.taskId);
                        } catch (error) {
                            // The database terminal transition is authoritative and
                            // cannot be rolled back safely here. Return it so the
                            // terminal task event is still delivered; the explicit
                            // error preserves the DAG reconciliation signal.
                            this.logger.error(
                                `Task ${transition.taskId} completed persistently, but DAG update failed: ${String(error)}`
                            );
                        }
                    }
                    return task;
                }
            );
        }

        return persist();
    }

    /**
     * Perform an agent-owned lifecycle transition with authorization and legal
     * source states in the same database compare-and-set as the mutation.
     */
    public async transitionTaskInChannel(
        taskId: string,
        channelId: ChannelId,
        agentId: AgentId,
        transition: AgentTaskLifecycleTransition
    ): Promise<ChannelTask> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');
        this.validator.assertIsNonEmptyString(agentId, 'agentId is required');

        const completedAt = new Date();
        let allowedStatuses: Array<ChannelTask['status']>;
        let update: Record<string, unknown>;

        switch (transition.kind) {
            case 'start':
                allowedStatuses = ['assigned'];
                update = { status: 'in_progress', updatedAt: completedAt };
                break;
            case 'complete':
                allowedStatuses = ['assigned', 'in_progress'];
                update = {
                    status: 'completed',
                    progress: 100,
                    result: {
                        success: true,
                        output: transition.output,
                        completedAt,
                        completedBy: agentId
                    },
                    updatedAt: completedAt
                };
                break;
            case 'fail':
                this.validator.assertIsNonEmptyString(transition.error, 'task failure error is required');
                allowedStatuses = ['assigned', 'in_progress'];
                update = {
                    status: 'failed',
                    result: {
                        success: false,
                        error: transition.error,
                        ...(transition.output !== undefined ? { output: transition.output } : {}),
                        completedAt,
                        completedBy: agentId
                    },
                    updatedAt: completedAt
                };
                break;
            case 'cancel':
                if (transition.reason !== undefined) {
                    this.validator.assertIsNonEmptyString(
                        transition.reason,
                        'task cancellation reason must be non-empty when provided'
                    );
                }
                allowedStatuses = ['assigned', 'in_progress'];
                update = {
                    status: 'cancelled',
                    result: {
                        success: false,
                        ...(transition.reason !== undefined ? { error: transition.reason } : {}),
                        completedAt,
                        completedBy: agentId
                    },
                    updatedAt: completedAt
                };
                break;
        }

        if (transition.kind === 'start' && isDagEnforcementEnabled()) {
            const blockedResult = await this.checkDagBlockers(channelId, taskId);
            if (blockedResult.blocked) {
                throw new Error(
                    `Task ${taskId} blocked by incomplete dependencies: ${blockedResult.blockerIds.join(', ')}`
                );
            }
        }

        const assignedAgentPredicate = {
            $or: [
                { assignedAgentId: agentId },
                { assignedAgentIds: agentId }
            ]
        };
        // Completing and failing are both terminal outcomes, gated the same way:
        // the designated completion agent when the task names one, otherwise
        // any assignee. Failing used to need only an assignee, so one
        // participant's loop error could end a task another agent was
        // designated to finish.
        const requiresCompletionAuthority = transition.kind === 'complete' || transition.kind === 'fail';
        const actorPredicate = requiresCompletionAuthority
            ? {
                $or: [
                    { completionAgentId: agentId },
                    {
                        $and: [
                            {
                                $or: [
                                    { completionAgentId: { $exists: false } },
                                    { completionAgentId: null }
                                ]
                            },
                            assignedAgentPredicate
                        ]
                    }
                ]
            }
            : assignedAgentPredicate;

        const persist = async (): Promise<ChannelTask> => {
            const task = await Task.findOneAndUpdate(
                {
                    _id: taskId,
                    channelId,
                    status: { $in: allowedStatuses },
                    ...actorPredicate
                },
                { $set: update },
                { new: true, runValidators: true }
            );

            if (!task) {
                // One compare-and-set covers state, assignment, and authority, so
                // the refusal names every condition it checked.
                throw new Error(
                    `Task ${taskId} cannot be ${transition.kind}ed by agent ${agentId} ` +
                    `in channel ${channelId} from its current state` +
                    (requiresCompletionAuthority
                        ? ' — the task is no longer active, the agent is not assigned to it, ' +
                          'or another agent is designated to report its outcome'
                        : '')
                );
            }
            return this.taskDocumentToChannelTask(task);
        };

        if (transition.kind === 'complete' && isDagEnabled()) {
            return TaskDagService.getInstance().withChannelLock(channelId, async () => {
                const task = await persist();
                try {
                    await this.handleDagTaskCompletion(channelId, taskId);
                } catch (error) {
                    this.logger.error(
                        `Task ${taskId} completed persistently, but DAG update failed: ${String(error)}`
                    );
                }
                return task;
            });
        }

        return persist();
    }

    /**
     * Owner/admin lifecycle transition used only after HTTP manage authorization.
     * Unlike an agent transition it may cancel an unassigned pending task, but it
     * still constrains every transition to its legal source state atomically.
     */
    public async transitionTaskAsOwnerInChannel(
        taskId: string,
        channelId: ChannelId,
        ownerId: string,
        transition: AgentTaskLifecycleTransition
    ): Promise<ChannelTask> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');
        this.validator.assertIsNonEmptyString(ownerId, 'ownerId is required');

        const completedAt = new Date();
        let allowedStatuses: Array<ChannelTask['status']>;
        let update: Record<string, unknown>;

        switch (transition.kind) {
            case 'start':
                allowedStatuses = ['assigned'];
                update = { status: 'in_progress', updatedAt: completedAt };
                break;
            case 'complete':
                allowedStatuses = ['assigned', 'in_progress'];
                update = {
                    status: 'completed',
                    progress: 100,
                    result: {
                        success: true,
                        output: transition.output,
                        completedAt,
                        completedBy: ownerId
                    },
                    updatedAt: completedAt
                };
                break;
            case 'fail':
                this.validator.assertIsNonEmptyString(transition.error, 'task failure error is required');
                allowedStatuses = ['assigned', 'in_progress'];
                update = {
                    status: 'failed',
                    result: {
                        success: false,
                        error: transition.error,
                        completedAt,
                        completedBy: ownerId
                    },
                    updatedAt: completedAt
                };
                break;
            case 'cancel':
                if (transition.reason !== undefined) {
                    this.validator.assertIsNonEmptyString(
                        transition.reason,
                        'task cancellation reason must be non-empty when provided'
                    );
                }
                allowedStatuses = ['pending', 'assigned', 'in_progress'];
                update = {
                    status: 'cancelled',
                    result: {
                        success: false,
                        ...(transition.reason !== undefined ? { error: transition.reason } : {}),
                        completedAt,
                        completedBy: ownerId
                    },
                    updatedAt: completedAt
                };
                break;
        }

        if (transition.kind === 'start' && isDagEnforcementEnabled()) {
            const blockedResult = await this.checkDagBlockers(channelId, taskId);
            if (blockedResult.blocked) {
                throw new Error(
                    `Task ${taskId} blocked by incomplete dependencies: ${blockedResult.blockerIds.join(', ')}`
                );
            }
        }

        const persist = async (): Promise<ChannelTask> => {
            const task = await Task.findOneAndUpdate(
                {
                    _id: taskId,
                    channelId,
                    status: { $in: allowedStatuses }
                },
                { $set: update },
                { new: true, runValidators: true }
            );
            if (!task) {
                throw new Error(
                    `Task ${taskId} cannot be ${transition.kind}ed in channel ${channelId} ` +
                    'from its current state'
                );
            }
            return this.taskDocumentToChannelTask(task);
        };

        if (transition.kind === 'complete' && isDagEnabled()) {
            return TaskDagService.getInstance().withChannelLock(channelId, async () => {
                const task = await persist();
                try {
                    await this.handleDagTaskCompletion(channelId, taskId);
                } catch (error) {
                    this.logger.error(
                        `Task ${taskId} completed persistently, but DAG update failed: ${String(error)}`
                    );
                }
                return task;
            });
        }

        return persist();
    }

    /**
     * Assign task using SystemLLM intelligence with multi-agent support
     */
    public async assignTaskIntelligently(taskId: string): Promise<TaskAssignmentResult> {
        const task = await Task.findById(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        // Handle different assignment scopes
        const assignmentScope = task.assignmentScope || 'single';
        
        // ;
        // ;
        // ;
        
        switch (assignmentScope) {
            case 'channel-wide':
                // ;
                return await this.assignChannelWideTask(task);
            case 'multiple':
                // ;
                return await this.assignToMultipleAgents(task);
            case 'single':
            default:
                // ;
                return await this.assignToSingleAgent(task);
        }
    }

    /**
     * Claim an unassigned task for an agent, atomically.
     *
     * The claim is a single conditional update: it only matches while the task is
     * still `pending` and still unassigned, so of two agents racing for the same
     * task exactly one update matches and the other gets null back.
     *
     * The previous code read the task, decided on an agent, then called
     * task.save() — last write wins, and two agents could each believe they owned
     * the same task.
     *
     * @param taskId - Task to claim
     * @param agentId - Agent claiming it
     * @returns The claimed task, or null if another agent got there first
     */
    private async claimTaskForAgent(taskId: string, agentId: AgentId): Promise<TaskDocument | null> {
        return Task.findOneAndUpdate(
            {
                _id: taskId,
                status: 'pending',
                $or: [
                    { assignedAgentId: { $exists: false } },
                    { assignedAgentId: null }
                ]
            },
            {
                $set: {
                    assignedAgentId: agentId,
                    assignedAgentIds: [agentId],
                    status: 'assigned',
                    updatedAt: new Date()
                }
            },
            { new: true }
        );
    }

    /** Assign one pending task and publish its single authoritative outcome. */
    public async assignTaskInChannel(
        taskId: string,
        channelId: ChannelId,
        targetAgentId: AgentId,
        assignedBy: string
    ): Promise<ChannelTask> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');
        this.validator.assertIsNonEmptyString(targetAgentId, 'targetAgentId is required');
        this.validator.assertIsNonEmptyString(assignedBy, 'assignedBy is required');
        await assertTaskAgentsBelongToChannel(channelId, [targetAgentId]);

        const task = await Task.findOneAndUpdate(
            {
                _id: taskId,
                channelId,
                status: 'pending'
            },
            {
                    $set: {
                        assignedAgentId: targetAgentId,
                        assignedAgentIds: [targetAgentId],
                        status: 'assigned',
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!task) {
            throw new Error(
                `Task ${taskId} is not pending in channel ${channelId} and cannot be assigned`
            );
        }

        const assignedTask = this.taskDocumentToChannelTask(task);
        EventBus.server.emit(
            TaskEvents.ASSIGNED,
            createTaskEventPayload(TaskEvents.ASSIGNED, assignedBy, channelId, {
                taskId: assignedTask.id,
                fromAgentId: assignedBy,
                toAgentId: targetAgentId,
                task: assignedTask
            })
        );
        return assignedTask;
    }

    /**
     * Run intelligent assignment for a task, scoped to the caller's channel.
     *
     * The socket entry point for assignment. Same reasoning as
     * updateTaskInChannel: the taskId arrives from the wire, so it is confined to
     * the channel the caller authenticated on before any assignment work — and
     * before any LLM spend — happens.
     *
     * @param taskId - Task to assign
     * @param channelId - Channel the caller authenticated on
     * @returns The assignment result
     * @throws If the task is not in the caller's channel
     */
    public async assignTaskIntelligentlyInChannel(
        taskId: string,
        channelId: ChannelId
    ): Promise<TaskAssignmentResult> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

        const task = await Task.findOne({ _id: taskId, channelId }).select('_id');

        if (!task) {
            throw new Error(`Task ${taskId} not found in channel ${channelId}`);
        }

        return this.assignTaskIntelligently(taskId);
    }

    /**
     * Assign task to a single agent (original logic)
     */
    private async assignToSingleAgent(task: TaskDocument): Promise<TaskAssignmentResult> {
        // Skip assignment if task is already assigned (check both singular and plural forms)
        // Also respect manual assignment strategy with assignedAgentIds
        const manualAgentId = task.assignedAgentId ||
            (task.assignedAgentIds && task.assignedAgentIds.length > 0 ? task.assignedAgentIds[0] : null);

        if (manualAgentId) {
            const assignedTask = await Task.findOneAndUpdate(
                {
                    _id: task.id,
                    channelId: task.channelId,
                    status: 'pending',
                    $or: [
                        { assignedAgentId: manualAgentId },
                        { assignedAgentIds: manualAgentId }
                    ]
                },
                {
                    $set: {
                        assignedAgentId: manualAgentId,
                        status: 'assigned',
                        updatedAt: new Date()
                    }
                },
                { new: true, runValidators: true }
            );
            if (!assignedTask) {
                throw new Error(
                    `Task ${task.id} is no longer pending for manual assignment`
                );
            }

            this.logger.info(`📋 Task assigned: "${task.title}" → Agent: ${manualAgentId} (manual)`);

            // Emit assignment event for manually assigned tasks
            const eventPayload = createTaskEventPayload(
                TaskEvents.ASSIGNED,
                manualAgentId,
                task.channelId,
                {
                    taskId: task.id,
                    fromAgentId: task.createdBy,
                    toAgentId: manualAgentId,
                    task: this.taskDocumentToChannelTask(assignedTask)
                }
            );
            EventBus.server.emit(TaskEvents.ASSIGNED, eventPayload);

            return {
                taskId: task.id,
                assignedAgentId: manualAgentId,
                strategy: 'manual' as AssignmentStrategy,
                confidence: 1.0,
                reasoning: 'Task manually assigned during creation',
                assignedAt: assignedTask.updatedAt?.getTime() || Date.now()
            };
        }

        try {
            // Get available agents for this channel
            const availableAgents = await this.getAgentService().getActiveAgentsInChannel(task.channelId);
            
            if (availableAgents.length === 0) {
                throw new Error(`No available agents in channel ${task.channelId}`);
            }

            // Refresh from persisted tasks instead of manufacturing workload
            // scores when the periodic analysis has not run yet.
            const workloadAnalysis = await this.analyzeChannelWorkload(task.channelId);

            if (!this.config.enableLlmAssignment) {
                throw new Error('Intelligent task assignment is disabled');
            }

            const assignmentAnalysis = await this.getAgentAssignmentAnalysis(
                task,
                availableAgents,
                workloadAnalysis
            );

            if (assignmentAnalysis.confidence < this.config.llmConfidenceThreshold) {
                throw new Error(
                    `SystemLLM assignment confidence ${assignmentAnalysis.confidence} is below ` +
                    `the required threshold ${this.config.llmConfidenceThreshold}`
                );
            }

            const assignedAgent = availableAgents.find(
                agent => agent.id === assignmentAnalysis.recommendedAgentId
            );

            if (!assignedAgent) {
                throw new Error(
                    `SystemLLM recommended unavailable agent ${assignmentAnalysis.recommendedAgentId}`
                );
            }

            // Claim atomically — another assignment pass may have taken this task
            // while the LLM was deciding.
            const claimed = await this.claimTaskForAgent(task.id, assignedAgent.id);

            if (!claimed) {
                throw new Error(
                    `Task ${task.id} was claimed by another agent while assignment was in progress`
                );
            }

            this.logger.info(`📋 Task assigned: "${task.title}" → Agent: ${assignedAgent.id} (intelligent)`);

            await this.emitTaskAssignmentEvent(claimed, assignedAgent.id);

            return {
                taskId: claimed.id,
                assignedAgentId: assignedAgent.id,
                strategy: 'intelligent' as AssignmentStrategy,
                confidence: assignmentAnalysis.confidence,
                reasoning: assignmentAnalysis.reasoning,
                assignedAt: Date.now()
            };

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`❌ Failed to assign task ${task.id}: ${message}`);
            throw error;
        }
    }

    /**
     * Assign task to multiple specific agents
     */
    private async assignToMultipleAgents(task: TaskDocument): Promise<TaskAssignmentResult> {
        
        const assignedAgentIds = task.assignedAgentIds || [];
        
        if (assignedAgentIds.length === 0) {
            this.logger.error(`❌ DEBUG: No agents specified for multiple assignment - assignedAgentIds is empty`);
            throw new Error('No agents specified for multiple assignment');
        }


        // Validate all agents exist and are available
        const agents = await Promise.all(
            assignedAgentIds.map(agentId => this.getAgentService().getAgent(agentId))
        );
        const validAgentIds = agents
            .filter((agent): agent is NonNullable<typeof agent> => agent !== null)
            .map(agent => agent.id);

        if (validAgentIds.length === 0) {
            this.logger.error(`❌ DEBUG: No valid agents found for assignment - all agents returned null`);
            throw new Error('No valid agents found for assignment');
        }

        const leadAgentId = task.leadAgentId || validAgentIds[0];
        const assignedTask = await this.claimPendingTaskForAssignment(task, {
            assignedAgentIds: validAgentIds,
            leadAgentId,
            assignedAgentId: leadAgentId
        }, 'multi-agent');

        this.logger.info(`📋 Task assigned: "${assignedTask.title}" → ${validAgentIds.length} agents (multi-agent)`);

        // Emit assignment events for each agent
        for (const agentId of validAgentIds) {
            await this.emitTaskAssignmentEvent(assignedTask, agentId);
        }

        return {
            taskId: assignedTask.id,
            assignedAgentId: leadAgentId, // Primary agent for compatibility
            strategy: 'multi_agent' as AssignmentStrategy,
            confidence: 1.0,
            reasoning: `Multi-agent assignment: ${validAgentIds.length} agents assigned`,
            assignedAt: assignedTask.updatedAt?.getTime() || Date.now()
        };
    }

    /**
     * Claim a task for assignment with one pending-only compare-and-set write.
     *
     * The caller has only a snapshot of the task. Reading it and then saving the
     * whole document would let an assignment request that arrives after
     * completion move the task back to `assigned`, and two concurrent requests
     * would overwrite each other's roster. The status precondition makes the
     * second writer fail instead.
     */
    private async claimPendingTaskForAssignment(
        task: TaskDocument,
        assignment: {
            assignedAgentIds: string[];
            leadAgentId: string;
            assignedAgentId: string;
            channelWideTask?: boolean;
        },
        kind: 'multi-agent' | 'channel-wide'
    ): Promise<TaskDocument> {
        const assignedTask = await Task.findOneAndUpdate(
            {
                _id: task.id,
                channelId: task.channelId,
                status: 'pending'
            },
            {
                $set: {
                    ...assignment,
                    status: 'assigned',
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );
        if (!assignedTask) {
            throw new Error(`Task ${task.id} is no longer pending for ${kind} assignment`);
        }
        return assignedTask;
    }

    /**
     * Assign task to all agents in channel (channel-wide task)
     */
    private async assignChannelWideTask(task: TaskDocument): Promise<TaskAssignmentResult> {
        
        // Get all active agents in the channel
        const channelAgents = await this.getAgentService().getActiveAgentsInChannel(task.channelId);
        
        // Apply filters
        let targetAgents = channelAgents;
        
        if (task.targetAgentRoles?.length) {
            targetAgents = targetAgents.filter(agent =>
                task.targetAgentRoles!.some(
                    role => this.getAssignmentCandidateRole(agent)?.includes(role)
                )
            );
        }
        
        if (task.excludeAgentIds?.length) {
            targetAgents = targetAgents.filter(agent =>
                !task.excludeAgentIds!.includes(agent.id)
            );
        }
        
        if (task.maxParticipants && targetAgents.length > task.maxParticipants) {
            // Use SystemLLM to select best participants
            targetAgents = await this.selectBestParticipants(task, targetAgents, task.maxParticipants);
        }
        
        const assignedAgentIds = targetAgents.map(agent => agent.id);
        
        if (assignedAgentIds.length === 0) {
            throw new Error('No eligible agents found for channel-wide assignment');
        }

        const leadAgentId = task.leadAgentId || assignedAgentIds[0];
        const assignedTask = await this.claimPendingTaskForAssignment(task, {
            assignedAgentIds,
            leadAgentId,
            assignedAgentId: leadAgentId,
            channelWideTask: true
        }, 'channel-wide');

        this.logger.info(`📋 Task assigned: "${assignedTask.title}" → ${assignedAgentIds.length} agents (channel-wide)`);

        // Emit assignment events for each agent
        for (const agentId of assignedAgentIds) {
            await this.emitTaskAssignmentEvent(assignedTask, agentId);
        }

        return {
            taskId: assignedTask.id,
            assignedAgentId: leadAgentId, // Primary agent for compatibility
            strategy: 'channel_wide' as AssignmentStrategy,
            confidence: 1.0,
            reasoning: `Channel-wide assignment: ${assignedAgentIds.length} agents in ${task.channelId}`,
            assignedAt: assignedTask.updatedAt?.getTime() || Date.now()
        };
    }

    /**
     * Select best participants using per-channel SystemLLM instance
     */
    private async selectBestParticipants<TCandidate extends AssignmentCandidate>(
        task: TaskDocument, 
        agents: TCandidate[],
        maxCount: number
    ): Promise<TCandidate[]> {
        if (!Number.isInteger(maxCount) || maxCount < 1) {
            throw new Error('maxParticipants must be a positive integer');
        }

        const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(task.channelId);
        if (!systemLlm) {
            throw new Error(`SystemLLM is unavailable for channel ${task.channelId}`);
        }

        const selectionCount = Math.min(maxCount, agents.length);
        
        const selectionPrompt = `
Select the ${maxCount} best agents for this task:

TASK:
- Title: ${task.title}
- Description: ${task.description}
- Required Roles: ${task.requiredRoles?.join(', ') || 'Any'}
- Required Capabilities: ${task.requiredCapabilities?.join(', ') || 'Any'}

AVAILABLE AGENTS:
${agents.map((agent, index) =>
    `${index + 1}. ${agent.id} - Role: ${this.getAssignmentCandidateRole(agent) ?? 'general'} - Capabilities: ${agent.capabilities?.join(', ')}`
).join('\n')}

Return only a JSON array containing exactly ${selectionCount} agent IDs in preference order.
`;

        const response = await systemLlm.sendLlmRequest(
            selectionPrompt,
            undefined,
            { operationType: 'coordination' }
        );
        if (typeof response !== 'string' || response.length === 0 || response.length > 10_000) {
            throw new Error('SystemLLM participant selection returned an invalid response');
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(response);
        } catch (error) {
            throw new Error(`SystemLLM participant selection returned invalid JSON: ${String(error)}`);
        }

        if (!Array.isArray(parsed) || parsed.length !== selectionCount) {
            throw new Error(
                `SystemLLM participant selection must contain exactly ${selectionCount} agent IDs`
            );
        }

        const selectedIds = parsed.map((value): AgentId => {
            if (typeof value !== 'string' || value.trim().length === 0) {
                throw new Error('SystemLLM participant selection contains an invalid agent ID');
            }
            return value;
        });
        if (new Set(selectedIds).size !== selectedIds.length) {
            throw new Error('SystemLLM participant selection contains duplicate agent IDs');
        }

        const candidatesById = new Map(agents.map(agent => [agent.id, agent]));
        return selectedIds.map(agentId => {
            const candidate = candidatesById.get(agentId);
            if (!candidate) {
                throw new Error(`SystemLLM participant selection named unavailable agent ${agentId}`);
            }
            return candidate;
        });
    }

    /**
     * Emit task assignment event
     */
    private async emitTaskAssignmentEvent(task: TaskDocument, agentId: string): Promise<void> {
        // For multi-agent tasks, customize the task description for each agent's role
        let roleSpecificTask = this.taskDocumentToChannelTask(task);
        
        if (task.assignmentScope === 'multiple' && task.assignedAgentIds && task.assignedAgentIds.length > 1) {
            roleSpecificTask = this.createRoleSpecificTask(task, agentId);
        }
        
        const eventPayload = createTaskEventPayload(
            TaskEvents.ASSIGNED,
            agentId, // ✅ Fixed: Use target agent ID instead of 'system'
            task.channelId,
            {
                taskId: task.id,
                fromAgentId: 'system',
                toAgentId: agentId,
                task: roleSpecificTask
            }
        );
        
        EventBus.server.emit(TaskEvents.ASSIGNED, eventPayload);
    }

    /**
     * Create role-specific task description for multi-agent assignments
     */
    private createRoleSpecificTask(task: TaskDocument, agentId: string): ChannelTask {
        const baseTask = this.taskDocumentToChannelTask(task);
        
        // Check if agent has task_complete tool
        const agentService = AgentService.getInstance();
        const agentData = agentService.getAgent(agentId);
        const allowedTools = agentData?.allowedTools;
        const hasTaskComplete = allowedTools === undefined || allowedTools.includes('task_complete');
        
        // Determine agent role based on assignment order and task configuration
        const agentIndex = task.assignedAgentIds?.indexOf(agentId) || 0;
        const isLeadAgent = task.leadAgentId === agentId;
        const totalAgents = task.assignedAgentIds?.length || 1;
        const isMultiAgentTask = totalAgents > 1;
        
        // Use coordination logic to determine completion responsibility
        let roleSpecificDescription: string;
        
        if (!isMultiAgentTask) {
            // Single agent task - straightforward
            if (hasTaskComplete) {
                roleSpecificDescription = `${task.description}

When you have completed this task, call task_complete with a summary of what was accomplished.`;
            } else {
                roleSpecificDescription = `${task.description}

Complete this task using your available tools.`;
            }
        } else {
            // Multi-agent task - use coordination logic
            const isCompletionAgent = this.shouldAgentHandleCompletion(task, agentId, agentIndex);
            
            
            if (isCompletionAgent && isLeadAgent) {
                // This agent is BOTH lead and completion agent - active hybrid role
                if (hasTaskComplete) {
                    roleSpecificDescription = `${task.description}

MULTI-AGENT COORDINATION:
- You are working with ${totalAgents - 1} other agent(s): ${task.assignedAgentIds?.filter(id => id !== agentId).join(', ')}
- You are the LEAD AGENT and COMPLETION AGENT for this collaborative task
- Take initiative to start the collaborative work AND handle final completion

Your responsibilities:
1. Take initiative in starting and coordinating the collaborative effort
2. Guide the overall collaborative effort and coordinate with other agents
3. Contribute to the collaborative work as needed
4. Call task_complete when the entire collaborative objective has been achieved

COMPLETION DECISION MAKING:
- Monitor conversation history and tool results for evidence of task completion
- Look for confirmation that all collaborative objectives have been met
- Do NOT wait for explicit confirmation from other agents - use your judgment
- Call task_complete as soon as you determine the collaborative goals are achieved
- Include a clear summary of what was accomplished when calling task_complete

IMPORTANT: You must both LEAD the collaboration (take initiative) and COMPLETE it (call task_complete when finished).`;
                } else {
                    roleSpecificDescription = `${task.description}

MULTI-AGENT COORDINATION:
- You are working with ${totalAgents - 1} other agent(s): ${task.assignedAgentIds?.filter(id => id !== agentId).join(', ')}
- You are the LEAD AGENT for this collaborative task
- Take initiative to start and coordinate the collaborative work

Your responsibilities:
1. Take initiative in starting and coordinating the collaborative effort
2. Guide the overall collaborative effort and coordinate with other agents
3. Contribute to the collaborative work as needed
4. Use your available tools to complete the work

IMPORTANT: Lead the collaboration using your available tools.`;
                }
            } else if (isCompletionAgent) {
                // This agent is designated to handle completion only
                if (hasTaskComplete) {
                    roleSpecificDescription = `${task.description}

MULTI-AGENT COORDINATION:
- You are working with ${totalAgents - 1} other agent(s): ${task.assignedAgentIds?.filter(id => id !== agentId).join(', ')}
- You are designated as the COMPLETION AGENT for this collaborative task
- After the collaborative work is finished, call task_complete with a summary

Your responsibilities:
1. Contribute to the collaborative effort as needed
2. Monitor the overall progress of the multi-agent task
3. Call task_complete when the entire collaborative objective has been achieved
4. Ensure all agents have completed their contributions before finalizing

COMPLETION DECISION MAKING:
- Monitor conversation history and tool results for evidence of task completion
- Look for confirmation that all collaborative objectives have been met
- Do NOT wait for explicit confirmation from other agents - use your judgment
- Call task_complete as soon as you determine the collaborative goals are achieved
- Include a clear summary of what was accomplished when calling task_complete

IMPORTANT: Only call task_complete when you determine the full collaborative task is finished, not just your individual part.`;
                } else {
                    roleSpecificDescription = `${task.description}

MULTI-AGENT COORDINATION:
- You are working with ${totalAgents - 1} other agent(s): ${task.assignedAgentIds?.filter(id => id !== agentId).join(', ')}
- You are monitoring the collaborative task
- After the collaborative work is finished, signal completion through your available tools

Your responsibilities:
1. Contribute to the collaborative effort as needed
2. Monitor the overall progress of the multi-agent task
3. Signal completion when the entire collaborative objective has been achieved
4. Ensure all agents have completed their contributions before finalizing

IMPORTANT: Signal completion using your available tools when you determine the full collaborative task is finished.`;
                }
            } else if (isLeadAgent) {
                // Lead agent coordinates but doesn't complete
                roleSpecificDescription = `${task.description}

MULTI-AGENT COORDINATION:
- You are the LEAD AGENT coordinating with ${totalAgents - 1} other agent(s): ${task.assignedAgentIds?.filter(id => id !== agentId).join(', ')}
- Focus on initiating and coordinating the collaborative effort
- DO NOT call task_complete - another agent is designated for completion

Your responsibilities:
1. Take initiative in starting the collaborative work
2. Coordinate with other agents as needed
3. Help guide the overall collaborative effort
4. Let the designated completion agent handle task_complete when finished`;
            } else {
                // Contributing agent
                roleSpecificDescription = `${task.description}

MULTI-AGENT COORDINATION:
- You are working with ${totalAgents - 1} other agent(s): ${task.assignedAgentIds?.filter(id => id !== agentId).join(', ')}
- Focus on your contribution to the collaborative effort
- DO NOT call task_complete - another agent is designated for completion

Your responsibilities:
1. Contribute your part to the collaborative effort
2. Coordinate with other agents as needed
3. Focus on your specific role in achieving the task objective
4. Let the designated completion agent handle task_complete when finished`;
            }
        }
        
        return {
            ...baseTask,
            description: roleSpecificDescription,
            metadata: {
                ...baseTask.metadata,
                agentRole: isMultiAgentTask ? (isLeadAgent ? 'lead' : 'contributor') : 'solo',
                agentIndex,
                isLeadAgent,
                isCompletionAgent: isMultiAgentTask ? this.shouldAgentHandleCompletion(task, agentId, agentIndex) : true,
                multiAgentTask: isMultiAgentTask,
                totalAgents
            }
        };
    }

    /**
     * Determine which agent should handle task completion in multi-agent scenarios
     * Uses coordination logic rather than hardcoded role assumptions
     */
    private shouldAgentHandleCompletion(task: TaskDocument, agentId: string, agentIndex: number): boolean {
        // Check for override first
        if (task.completionAgentId) {
            return task.completionAgentId === agentId;
        }

        // Strategy: Use consistent logic to designate one agent as completion handler
        // This could be enhanced with more sophisticated coordination logic
        
        // Option 1: Last assigned agent handles completion
        const totalAgents = task.assignedAgentIds?.length || 1;
        const isLastAgent = agentIndex === totalAgents - 1;
        
        // Option 2: Lead agent handles completion (if defined)
        const isLeadAgent = task.leadAgentId === agentId;
        
        // Option 3: First agent handles completion (fallback)
        const isFirstAgent = agentIndex === 0;
        // Coordination logic: 
        // 1. If there's a lead agent, they handle completion
        // 2. Otherwise, the last assigned agent handles completion
        // 3. Fallback to first agent if somehow neither applies
        
        if (task.leadAgentId) {
            const result = isLeadAgent;
            return result;
        }
        
        const result = isLastAgent || isFirstAgent;
        return result;
    }

    /**
     * Get intelligent agent assignment analysis using per-channel SystemLLM instance
     */
    private async getAgentAssignmentAnalysis(
        task: TaskDocument, 
        agents: AssignmentCandidate[],
        workloadAnalysis: ChannelWorkloadAnalysis
    ): Promise<AgentAssignmentAnalysis> {
        const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(task.channelId);
        if (!systemLlm) {
            throw new Error(`SystemLLM is unavailable for channel ${task.channelId}`);
        }
        
        const prompt = this.buildAssignmentPrompt(task, agents, workloadAnalysis);

        const response = await systemLlm.sendLlmRequest(
            prompt,
            undefined,
            { operationType: 'coordination' }
        );
        return this.parseAssignmentResponse(response, agents);
    }

    /**
     * Build prompt for SystemLLM assignment analysis
     */
    private buildAssignmentPrompt(
        task: TaskDocument,
        agents: AssignmentCandidate[],
        workload: ChannelWorkloadAnalysis
    ): string {
        const agentList = agents.map(agent => ({
            id: agent.id,
            role: this.getAssignmentCandidateRole(agent) || 'general',
            capabilities: agent.capabilities || [],
            specialization: this.getAssignmentCandidateSpecialization(agent) || 'general',
            currentTasks: workload.agentWorkloads.find(w => w.agentId === agent.id)?.activeTasks || 0
        }));

        return `
Analyze and recommend the best agent assignment for this task:

TASK:
- Title: ${task.title}
- Description: ${task.description}
- Required Roles: ${task.requiredRoles?.join(', ') || 'any'}
- Required Capabilities: ${task.requiredCapabilities?.join(', ') || 'any'}
- Priority: ${task.priority}

AVAILABLE AGENTS:
${agentList.map(a => `- ${a.id}: Role=${a.role}, Capabilities=[${a.capabilities.join(',')}], CurrentTasks=${a.currentTasks}`).join('\n')}

Respond with JSON:
{
  "recommendedAgentId": "agent_id",
  "confidence": 0.0-1.0,
  "reasoning": "explanation",
  "roleMatch": 0.0-1.0,
  "capabilityMatch": 0.0-1.0,
  "workloadScore": 0.0-1.0,
  "expertiseScore": 0.0-1.0,
  "availabilityScore": 0.0-1.0
}`;
    }

    private getAssignmentCandidateRole(agent: AssignmentCandidate): string | undefined {
        if (typeof agent.role === 'string') {
            return agent.role;
        }
        const metadataRole = agent.metadata?.role;
        return typeof metadataRole === 'string' ? metadataRole : undefined;
    }

    private getAssignmentCandidateSpecialization(agent: AssignmentCandidate): string | undefined {
        if (typeof agent.specialization === 'string') {
            return agent.specialization;
        }
        const metadataSpecialization = agent.metadata?.specialization;
        return typeof metadataSpecialization === 'string' ? metadataSpecialization : undefined;
    }

    /**
     * Parse LLM response for assignment
     */
    private parseAssignmentResponse(
        response: string,
        agents: AssignmentCandidate[]
    ): AgentAssignmentAnalysis {
        if (typeof response !== 'string' || response.length === 0 || response.length > 10_000) {
            throw new Error('SystemLLM assignment returned an invalid response');
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(response);
        } catch (error) {
            throw new Error(`SystemLLM assignment returned invalid JSON: ${String(error)}`);
        }

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('SystemLLM assignment response must be a JSON object');
        }

        const record = parsed as Record<string, unknown>;
        const recommendedAgentId = record.recommendedAgentId;
        if (
            typeof recommendedAgentId !== 'string' ||
            !agents.some(agent => agent.id === recommendedAgentId)
        ) {
            throw new Error('SystemLLM assignment recommended an unavailable agent');
        }

        const reasoning = record.reasoning;
        if (typeof reasoning !== 'string' || reasoning.trim().length === 0 || reasoning.length > 4_000) {
            throw new Error('SystemLLM assignment reasoning must be a non-empty string');
        }

        const readScore = (field: string): number => {
            const value = record[field];
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
                throw new Error(`SystemLLM assignment ${field} must be a number between 0 and 1`);
            }
            return value;
        };

        return {
            recommendedAgentId,
            confidence: readScore('confidence'),
            reasoning,
            roleMatch: readScore('roleMatch'),
            capabilityMatch: readScore('capabilityMatch'),
            workloadScore: readScore('workloadScore'),
            expertiseScore: readScore('expertiseScore'),
            availabilityScore: readScore('availabilityScore')
        };
    }

    /**
     * Convert TaskDocument to ChannelTask
     */
    private taskDocumentToChannelTask(task: TaskDocument): ChannelTask {
        return {
            id: task._id?.toString() || task.id,
            channelId: task.channelId,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            
            // Assignment fields (new and legacy)
            assignedAgentId: task.assignedAgentId,
            completionAgentId: task.completionAgentId,
            assignmentScope: task.assignmentScope || 'single', // Use actual scope or default
            assignedAgentIds: task.assignedAgentIds,
            leadAgentId: task.leadAgentId,
            assignmentStrategy: task.assignmentStrategy,
            
            // Channel-wide task fields (CRITICAL: these were missing and causing validation failures)
            channelWideTask: task.channelWideTask,
            targetAgentRoles: task.targetAgentRoles,
            excludeAgentIds: task.excludeAgentIds,
            maxParticipants: task.maxParticipants,
            coordinationMode: task.coordinationMode,
            
            createdBy: task.createdBy,
            createdAt: task.createdAt?.getTime() || Date.now(),
            updatedAt: task.updatedAt?.getTime() || Date.now(),
            progress: task.progress || 0,
            result: task.result ? {
                success: task.result.success,
                output: task.result.output,
                error: task.result.error,
                completedAt: task.result.completedAt?.getTime(),
                completedBy: task.result.completedBy
            } : undefined,
            metadata: task.metadata, // Preserve metadata
            tags: task.tags, // Preserve tags
            dependsOn: task.dependsOn || [], // Preserve dependency edges for DAG
            blockedBy: task.blockedBy || [] // Preserve blocker info for DAG
        };
    }

    /**
     * Get tasks by various filters
     */
    public async getTasks(filters: TaskQueryFilters = {}): Promise<ChannelTask[]> {
        const query = this.buildTaskQuery(filters);
        const tasks = await Task.find(query).sort({ priority: -1, createdAt: -1 });
        return tasks.map(task => this.taskDocumentToChannelTask(task));
    }

    /**
     * Query tasks within an already-authorized channel set.
     *
     * The channel predicate is applied in MongoDB. Callers must never fetch an
     * unrestricted collection and filter it afterward because that makes a
     * future projection, pagination, or aggregation change an authorization
     * bypass.
     */
    public async getTasksInChannels(
        filters: TaskQueryFilters,
        authorizedChannelIds: readonly ChannelId[]
    ): Promise<ChannelTask[]> {
        const channelIds = Array.from(new Set(
            authorizedChannelIds.filter(channelId => typeof channelId === 'string' && channelId.trim().length > 0)
        ));

        if (channelIds.length === 0) {
            return [];
        }

        const query = this.buildTaskQuery(filters);
        if (filters.channelId) {
            if (!channelIds.includes(filters.channelId)) {
                return [];
            }
            query.channelId = filters.channelId;
        } else {
            query.channelId = { $in: channelIds };
        }

        const tasks = await Task.find(query).sort({ priority: -1, createdAt: -1 });
        return tasks.map(task => this.taskDocumentToChannelTask(task));
    }

    /** Resolve only the task's authorization boundary, without exposing content. */
    public async getTaskChannelId(taskId: string): Promise<ChannelId | null> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');

        const task = await Task.findById(taskId).select('channelId').lean();
        return task && typeof task.channelId === 'string' ? task.channelId : null;
    }

    /** Read one task with the channel predicate present in the database query. */
    public async getTaskInChannel(taskId: string, channelId: ChannelId): Promise<ChannelTask | null> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

        const task = await Task.findOne({ _id: taskId, channelId });
        return task ? this.taskDocumentToChannelTask(task) : null;
    }

    private buildTaskQuery(filters: TaskQueryFilters): FilterQuery<TaskDocument> {
        const query: FilterQuery<TaskDocument> = {};

        if (filters.channelId) query.channelId = filters.channelId;
        if (filters.status) query.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
        if (filters.assignedAgentId) query.assignedAgentId = filters.assignedAgentId;
        if (filters.priority) query.priority = Array.isArray(filters.priority) ? { $in: filters.priority } : filters.priority;
        if (filters.createdBy) query.createdBy = filters.createdBy;
        if (filters.tags?.length) query.tags = { $all: filters.tags };

        if (filters.dueBefore !== undefined || filters.dueAfter !== undefined) {
            query.dueDate = {};
            if (filters.dueBefore !== undefined) query.dueDate.$lte = new Date(filters.dueBefore);
            if (filters.dueAfter !== undefined) query.dueDate.$gte = new Date(filters.dueAfter);
        }

        if (filters.createdBefore !== undefined || filters.createdAfter !== undefined) {
            query.createdAt = {};
            if (filters.createdBefore !== undefined) query.createdAt.$lte = new Date(filters.createdBefore);
            if (filters.createdAfter !== undefined) query.createdAt.$gte = new Date(filters.createdAfter);
        }

        return query;
    }

    /**
     * Update task with DAG enforcement
     *
     * When transitioning to in_progress, checks if task is blocked by incomplete dependencies.
     * When completing, updates the DAG and emits events for newly unblocked tasks.
     */
    public async updateTask(taskId: string, update: UpdateTaskRequest): Promise<ChannelTask> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');
        const safeUpdate = parseUpdateTaskRequest(update);

        // Get the current task state to check transitions
        const existingTask = await Task.findById(taskId);
        if (!existingTask) {
            throw new Error(`Task ${taskId} not found`);
        }

        return this.applyTaskUpdate(
            taskId,
            existingTask,
            { _id: taskId },
            safeUpdate,
            `Task ${taskId} not found`
        );
    }

    /**
     * Apply an already-validated update while keeping its authorization scope in
     * the mutation query. The pre-read is needed for DAG transition checks; the
     * filter on findOneAndUpdate is what makes that read safe against a race.
     */
    private async applyTaskUpdate(
        taskId: string,
        existingTask: TaskDocument,
        mutationFilter: FilterQuery<TaskDocument>,
        update: UpdateTaskRequest,
        notFoundMessage: string
    ): Promise<ChannelTask> {
        const completionConfig = update.metadata?.enableMonitoring
            ? update.metadata.completionConfig as TaskCompletionConfig | undefined
            : undefined;
        if (update.metadata?.enableMonitoring && !completionConfig) {
            throw new Error('completionConfig is required when task monitoring is enabled');
        }
        if (completionConfig) {
            TaskCompletionMonitoringService.getInstance().assertValidConfig(completionConfig);
        }

        const persistUpdate = async (): Promise<ChannelTask> => {
            const task = await Task.findOneAndUpdate(
                mutationFilter,
                { $set: update },
                { new: true, runValidators: true }
            );
            if (!task) {
                throw new Error(notFoundMessage);
            }
            const channelTask = this.taskDocumentToChannelTask(task);
            if (completionConfig) {
                this.startCompletionMonitoring(channelTask, completionConfig);
            }
            return channelTask;
        };

        // DAG enforcement: Check if task can transition to in_progress
        if (update.status === 'in_progress' && isDagEnforcementEnabled()) {
            const blockedResult = await this.checkDagBlockers(existingTask.channelId, taskId);
            if (blockedResult.blocked) {
                // Emit blocked event
                EventBus.server.emit(
                    DagEvents.TASK_BLOCKED,
                    createDagTaskBlockedPayload(
                        existingTask.channelId,
                        existingTask.assignedAgentId || 'system',
                        taskId,
                        blockedResult.blockerIds,
                        'in_progress',
                        `Task blocked by incomplete dependencies: ${blockedResult.blockerIds.join(', ')}`
                    )
                );
                throw new Error(
                    `Task ${taskId} blocked by incomplete dependencies: ${blockedResult.blockerIds.join(', ')}`
                );
            }
        }

        // When completing a task with DAG enabled, serialize the DB update + DAG update
        // under a per-channel lock to prevent race conditions from concurrent completions.
        if (update.status === 'completed' && isDagEnabled()) {
            const dagService = TaskDagService.getInstance();
            return dagService.withChannelLock(existingTask.channelId, async () => {
                const channelTask = await persistUpdate();
                try {
                    await this.handleDagTaskCompletion(existingTask.channelId, taskId);
                } catch (error) {
                    this.logger.error(
                        `Task ${taskId} completed persistently, but DAG update failed: ${String(error)}`
                    );
                }
                return channelTask;
            });
        }

        // Non-DAG or non-completion path: no lock needed
        return persistUpdate();
    }

    /**
     * Update a task on behalf of an agent, scoped to the channel it connected on.
     *
     * Every socket task handler goes through here, so the final mutation includes
     * both task and authenticated channel. An agent in channel A cannot complete,
     * reassign, or cancel a task in channel B by guessing its id, even if the task
     * changes between the transition pre-read and the write.
     *
     * @param taskId - Task being updated
     * @param channelId - Channel the caller authenticated on
     * @param update - Non-lifecycle fields to change
     * @returns The updated task
     * @throws If the task is not in the caller's channel or status is supplied
     */
    public async updateTaskInChannel(
        taskId: string,
        channelId: ChannelId,
        update: NonLifecycleTaskUpdateRequest
    ): Promise<ChannelTask> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');
        const safeUpdate = parseNonLifecycleTaskUpdateRequest(update);

        const task = await Task.findOne({ _id: taskId, channelId });

        // Same error whether the task is in another channel or does not exist —
        // there is no reason to confirm the existence of tasks the caller cannot see.
        if (!task) {
            throw new Error(`Task ${taskId} not found in channel ${channelId}`);
        }

        const mutationFilter: FilterQuery<TaskDocument> = {
            _id: taskId,
            channelId
        };

        return this.applyTaskUpdate(
            taskId,
            task,
            mutationFilter,
            safeUpdate,
            `Task ${taskId} not found in channel ${channelId}`
        );
    }

    /**
     * Check if a task is blocked by incomplete dependencies in the DAG
     *
     * @param channelId - The channel ID
     * @param taskId - The task ID to check
     * @returns Object with blocked status and blocker IDs
     */
    private async checkDagBlockers(
        channelId: ChannelId,
        taskId: string
    ): Promise<{ blocked: boolean; blockerIds: string[] }> {
        const dagService = TaskDagService.getInstance();
        if (!dagService.isEnabled()) {
            return { blocked: false, blockerIds: [] };
        }

        const blockerIds = dagService.getBlockingTasks(channelId, taskId);
        return {
            blocked: blockerIds.length > 0,
            blockerIds,
        };
    }

    /**
     * Handle DAG updates when a task completes
     *
     * Updates the DAG status and emits events for newly unblocked tasks.
     *
     * @param channelId - The channel ID
     * @param taskId - The completed task ID
     */
    private async handleDagTaskCompletion(channelId: ChannelId, taskId: string): Promise<void> {
        const dagService = TaskDagService.getInstance();
        if (!dagService.isEnabled()) {
            return;
        }

        // Update task status in the DAG (this also emits dag:task_dependencies_resolved events)
        dagService.updateTaskStatus(channelId, taskId, 'completed');

        this.logger.debug(`Updated DAG for completed task ${taskId} in channel ${channelId}`);
    }

    /**
     * Analyze workload for a specific channel
     */
    private async analyzeChannelWorkload(channelId: ChannelId): Promise<ChannelWorkloadAnalysis> {
        const tasks = await this.getTasks({ channelId });
        const agentsInChannel = await this.getAgentService().getActiveAgentsInChannel(channelId);
        const now = Date.now();
        const completedTasks = tasks.filter(task => task.status === 'completed');
        const completionDurations = completedTasks
            .map(task => (task.result?.completedAt ?? task.updatedAt) - task.createdAt)
            .filter(duration => Number.isFinite(duration) && duration >= 0);
        const average = (values: number[]): number => values.length === 0
            ? 0
            : values.reduce((sum, value) => sum + value, 0) / values.length;
        const isAssignedTo = (task: ChannelTask, agentId: AgentId): boolean =>
            task.assignedAgentId === agentId || task.assignedAgentIds?.includes(agentId) === true;

        const workload: ChannelWorkloadAnalysis = {
            channelId,
            totalTasks: tasks.length,
            pendingTasks: tasks.filter(task => task.status === 'pending').length,
            activeTasks: tasks.filter(task => task.status === 'in_progress').length,
            completedTasks: completedTasks.length,
            failedTasks: tasks.filter(task => task.status === 'failed').length,
            agentWorkloads: agentsInChannel.map(agent => {
                const agentTasks = tasks.filter(task => isAssignedTo(task, agent.id));
                const activeTasks = agentTasks.filter(
                    task => task.status === 'assigned' || task.status === 'in_progress'
                ).length;
                const pendingTasks = agentTasks.filter(task => task.status === 'pending').length;
                const terminalTasks = agentTasks.filter(
                    task => task.status === 'completed' || task.status === 'failed'
                );
                const agentCompletionDurations = terminalTasks
                    .filter(task => task.status === 'completed')
                    .map(task => (task.result?.completedAt ?? task.updatedAt) - task.createdAt)
                    .filter(duration => Number.isFinite(duration) && duration >= 0);

                return {
                    agentId: agent.id,
                    activeTasks,
                    pendingTasks,
                    completionRate: terminalTasks.length === 0
                        ? 0
                        : terminalTasks.filter(task => task.status === 'completed').length /
                            terminalTasks.length,
                    averageTaskDuration: average(agentCompletionDurations),
                    isOverloaded: activeTasks >= this.config.maxTasksPerAgent
                };
            }),
            averageCompletionTime: average(completionDurations),
            taskThroughput: completedTasks.filter(
                task => (task.result?.completedAt ?? task.updatedAt) >= now - 3_600_000
            ).length,
            analysisTimestamp: now,
            confidence: 1
        };

        this.channelWorkloads.set(channelId, workload);
        return workload;
    }

    /**
     * Get active tasks in a channel
     */
    private async getActiveTasksInChannel(channelId: ChannelId): Promise<ChannelTask[]> {
        return this.getTasks({
            channelId,
            status: ['pending', 'assigned', 'in_progress']
        });
    }

    /**
     * Handle task creation event for orchestration
     *
     * Adds the task to the DAG if DAG is enabled, and triggers workload analysis.
     */
    private async handleTaskCreated(task: ChannelTask): Promise<void> {
        try {
            // Add task to DAG if enabled
            if (isDagEnabled()) {
                await this.addTaskToDag(task);
            }

            // Add channel to active channels
            const channels = this.activeChannels.value;
            channels.add(task.channelId);
            this.activeChannels.next(channels);

            // Trigger workload analysis for the channel
            await this.analyzeChannelWorkload(task.channelId);

            // Skip assignment if intelligent assignment is disabled
            if (!this.config.enableIntelligentAssignment) {
                return;
            }

            // Skip assignment for tasks with 'none' strategy (e.g., DAG sub-tasks
            // created for dependency tracking, not for delegation)
            if (task.assignmentStrategy === 'none') {
                this.logger.debug(`[ASSIGNMENT] Skipping assignment for task "${task.title}" (strategy: none)`);
                return;
            }

            // createTask persists explicit assignments as `assigned` and emits
            // their ASSIGNED outcome itself. Re-running assignment from CREATED
            // would announce the same assignment twice.
            if (task.status === 'assigned' || task.assignedAgentId ||
                (task.assignedAgentIds?.length ?? 0) > 0) {
                return;
            }

            // Prevent simultaneous start if configured (only for non-assigned tasks)
            if (this.config.preventSimultaneousStart && !task.assignedAgentId) {
                const activeTasks = await this.getActiveTasksInChannel(task.channelId);
                if (activeTasks.length > 0) {
                    return;
                }
            }

            // Perform intelligent assignment
            await this.assignTaskIntelligently(task.id);

        } catch (error) {
            this.logger.error(`❌ Failed to orchestrate task creation: ${error}`);
        }
    }

    /**
     * Handle task assignment event
     */
    private async handleTaskAssigned(task: ChannelTask): Promise<void> {
        try {
            
            // Track assignment
            if (task.assignedAgentId) {
                this.taskAssignments.set(task.id, task.assignedAgentId);
            }

            // Update workload analysis
            await this.analyzeChannelWorkload(task.channelId);

        } catch (error) {
            this.logger.error(`❌ Failed to handle task assignment: ${error}`);
        }
    }

    /**
     * Handle task completion event
     */
    private async handleTaskCompleted(task: ChannelTask): Promise<void> {
        try {

            // Remove from tracking
            this.taskAssignments.delete(task.id);

            // Update workload analysis
            await this.analyzeChannelWorkload(task.channelId);

        } catch (error) {
            this.logger.error(`❌ Failed to handle task completion: ${error}`);
        }
    }

    /**
     * Add a task to the DAG
     *
     * If a DAG doesn't exist for the channel, builds one from all channel tasks.
     * Otherwise, adds the new task to the existing DAG.
     *
     * @param task - The task to add
     */
    private async addTaskToDag(task: ChannelTask): Promise<void> {
        try {
            const dagService = TaskDagService.getInstance();
            if (!dagService.isEnabled()) {
                return;
            }

            // Check if DAG exists for this channel
            const existingDag = dagService.getDag(task.channelId);
            if (existingDag) {
                // Add task to existing DAG
                dagService.addTask(task.channelId, task);
            } else {
                // The task event remains accepted work until the initial DAG snapshot
                // has finished reading and building the channel state.
                await this.buildChannelDag(task.channelId);
            }
        } catch (error) {
            this.logger.error(`Failed to add task ${task.id} to DAG: ${error}`);
        }
    }

    /**
     * Build DAG for a channel from all its tasks
     *
     * @param channelId - The channel ID
     */
    private async buildChannelDag(channelId: ChannelId): Promise<void> {
        const dagService = TaskDagService.getInstance();
        if (!dagService.isEnabled()) {
            return;
        }

        // Get all tasks for the channel
        const tasks = await this.getTasks({ channelId });

        // Build the DAG
        dagService.buildDag(channelId, tasks);
        this.logger.debug(`Built DAG for channel ${channelId} with ${tasks.length} tasks`);
    }

    /**
     * Coordinate agent assignments across channels
     */
    private coordinateAgentAssignments(): Observable<void> {
        return new Observable(observer => {
            try {
                // ;
                
                // Analyze workload across all channels
                const channels = Array.from(this.activeChannels.value);
                
                // Log current workload status for each channel
                for (const channelId of channels) {
                    const workload = this.channelWorkloads.get(channelId);
                    if (workload) {
                        // ;
                    }
                }
                
                observer.next();
                observer.complete();
                
            } catch (error) {
                observer.error(error);
            }
        });
    }

    /**
     * Optimize task assignments across the system
     */
    private async optimizeTaskAssignments(): Promise<void> {
        // ;
        
        try {
            // Analyze all channels and suggest optimizations
            const channels = Array.from(this.activeChannels.value);
            
            for (const channelId of channels) {
                // Guard: Skip channels with SystemLLM disabled
                if (!ConfigManager.getInstance().isChannelSystemLlmEnabled(channelId, 'coordination')) {
                    continue;
                }

                const workload = this.channelWorkloads.get(channelId);
                if (workload && workload.confidence > 0.7) {
                    // Use per-channel SystemLLM instance for optimization suggestions
                    const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
                    if (systemLlm) {
                        await systemLlm.analyzeChannelForCoordination(channelId);
                    }
                }
            }
            
        } catch (error: any) {
            this.logger.error(`❌ Failed to optimize task assignments: ${error}`);
        }
    }

    /**
     * Update orchestration configuration
     */
    public updateOrchestrationConfig(newConfig: Partial<TaskOrchestrationConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Emit configuration update event
        const eventPayload = createTaskEventPayload(
            Events.Task.ORCHESTRATION_CONFIG_UPDATED,
            'system', // emittingAgentId - orchestrator is system-level
            'global', // channelId - config is global
            {
                taskId: `config-update-${Date.now()}`,
                fromAgentId: 'system',
                toAgentId: 'system',
                task: { config: this.config } as any
            }
        );
        EventBus.server.emit(Events.Task.ORCHESTRATION_CONFIG_UPDATED, eventPayload);
    }

    /**
     * Get current orchestration status
     */
    public getOrchestrationStatus(): any {
        return {
            activeChannels: Array.from(this.activeChannels.value),
            activeAssignments: this.taskAssignments.size,
            channelWorkloads: Object.fromEntries(this.channelWorkloads),
            config: this.config
        };
    }

    /**
     * The active task whose terminal outcome this agent may report: a task it
     * is assigned to, or one that names it as the completion agent (which
     * overrides the assignee-based policy). Null when there is none.
     */
    public async findActiveTaskForAgent(channelId: ChannelId, agentId: AgentId): Promise<ChannelTask | null> {
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');
        this.validator.assertIsNonEmptyString(agentId, 'agentId is required');

        const activeTasks = await this.getTasks({ channelId });
        const agentTask = activeTasks.find(task => {
            const canReportTerminalOutcome = task.completionAgentId
                ? task.completionAgentId === agentId
                : task.assignedAgentIds?.includes(agentId) || task.assignedAgentId === agentId;
            return canReportTerminalOutcome &&
                task.status !== 'completed' &&
                task.status !== 'failed' &&
                task.status !== 'cancelled';
        });
        return agentTask ?? null;
    }

    /**
     * Append a SystemLLM challenge record to the task's metadata. The record
     * is what makes each trigger challenge-once per task, and it is the audit
     * trail of what SystemLLM disputed.
     *
     * The write is conditional on no record for the same trigger existing, so
     * two overlapping claims cannot both record a challenge: the check before
     * the model call is a snapshot, this is the guard that holds.
     *
     * @returns true when recorded; false when the task already carries a
     *          record for this trigger (the caller must not issue the challenge)
     * @throws Error when the task does not exist in the channel
     */
    public async recordSystemLlmChallenge(
        taskId: string,
        channelId: ChannelId,
        record: SystemLlmChallengeRecord
    ): Promise<boolean> {
        this.validator.assertIsNonEmptyString(taskId, 'taskId is required');
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');
        this.validator.assertIsNonEmptyString(record.id, 'record.id is required');

        const challengesPath = `metadata.${TASK_METADATA_CHALLENGES_KEY}`;
        const result = await Task.updateOne(
            {
                _id: taskId,
                channelId,
                [`${challengesPath}.trigger`]: { $ne: record.trigger }
            },
            {
                $push: { [challengesPath]: record },
                $set: { updatedAt: new Date() }
            }
        );
        if (result.matchedCount > 0) {
            return true;
        }
        const exists = await Task.exists({ _id: taskId, channelId });
        if (!exists) {
            throw new Error(`Cannot record SystemLLM challenge: task ${taskId} not found in channel ${channelId}`);
        }
        return false;
    }

    /**
     * Handle task completion from agent's task_complete tool call
     * This centralizes all task completion logic and ensures single event emission
     */
    public async handleTaskCompletion(
        agentId: string,
        channelId: string,
        completionData: {
            summary: string;
            success?: boolean;
            details?: Record<string, unknown>;
            nextSteps?: string;
            requestId: string;
        }
    ): Promise<{
        status: string;
        message: string;
        taskId?: string;
        nextSteps?: string;
        /** Present when the claim was challenged instead of accepted (critical or hostile stance). */
        challenge?: Pick<SystemLlmChallenge, 'id' | 'stance' | 'trigger' | 'summary' | 'points'>;
    }> {
        try {
            
            const validator = createStrictValidator('TaskService.handleTaskCompletion');
            validator.assertIsNonEmptyString(agentId, 'agentId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');
            validator.assertIsNonEmptyString(completionData.summary, 'completion summary is required');
            validator.assertIsNonEmptyString(completionData.requestId, 'requestId is required');
            
            const agentTask = await this.findActiveTaskForAgent(channelId, agentId);
            if (!agentTask) {
                throw new Error(
                    `No active task is assigned to agent ${agentId} in channel ${channelId}`
                );
            }

            const reportedSuccess = completionData.success !== false;

            // In critical or hostile stance, SystemLLM gets to dispute a success
            // claim before the task is marked complete. A failure report is not
            // a claim of success and is never challenged. Each task is
            // challenged on completion at most once; the next claim goes through.
            // If a challenge is required and cannot be produced, this throws and
            // the task stays where it is — no silent, unchallenged completions.
            if (reportedSuccess) {
                const challenge = await SystemLlmChallengeService.getInstance().challengeCompletionClaim({
                    task: agentTask,
                    agentId,
                    channelId,
                    summary: completionData.summary,
                    details: completionData.details
                });
                if (challenge) {
                    return {
                        status: TASK_COMPLETION_CHALLENGED_STATUS,
                        message: `Completion of task ${agentTask.id} was challenged by SystemLLM (${challenge.stance} stance). ` +
                            'Address each point with evidence, or explain why it is wrong, then call task_complete again.',
                        taskId: agentTask.id,
                        challenge: {
                            id: challenge.id,
                            stance: challenge.stance,
                            trigger: challenge.trigger,
                            summary: challenge.summary,
                            points: challenge.points
                        }
                    };
                }
            }

            const completionOutput = {
                agentId,
                summary: completionData.summary,
                ...(completionData.details !== undefined
                    ? { details: completionData.details }
                    : {}),
                ...(completionData.nextSteps !== undefined
                    ? { nextSteps: completionData.nextSteps }
                    : {}),
                reportedSuccess,
                requestId: completionData.requestId
            };
            const updatedTask = await this.transitionTaskInChannel(
                agentTask.id,
                channelId,
                agentId,
                reportedSuccess
                    ? { kind: 'complete', output: completionOutput }
                    : { kind: 'fail', error: completionData.summary, output: completionOutput }
            );
            
            
            // Emit one authoritative terminal event matching the durable state.
            const taskEventData = {
                taskId: updatedTask.id,
                requestId: completionData.requestId,
                fromAgentId: agentId,
                toAgentId: agentId,
                task: updatedTask
            };
            
            const terminalEvent = reportedSuccess ? TaskEvents.COMPLETED : TaskEvents.FAILED;
            const eventPayload = createTaskEventPayload(terminalEvent, agentId, channelId, taskEventData);
            EventBus.server.emit(terminalEvent, eventPayload);
            
            
            return {
                status: reportedSuccess ? 'task_completed' : 'task_failed',
                message: reportedSuccess
                    ? `Task completed successfully: ${completionData.summary}`
                    : `Task failed: ${completionData.summary}`,
                taskId: updatedTask.id,
                nextSteps: completionData.nextSteps
            };
            
        } catch (error) {
            this.logger.error(`❌ TASK COMPLETE: Error handling task completion: ${error}`);
            throw error;
        }
    }
}
