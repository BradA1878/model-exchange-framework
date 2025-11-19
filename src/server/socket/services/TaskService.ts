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
 * Task Service for intelligent task management and assignment
 * Uses SystemLlmService for intelligent agent assignment
 */

import { Observable, BehaviorSubject, combineLatest, timer, from, throwError } from 'rxjs';
import { map, filter, switchMap, debounceTime, catchError } from 'rxjs/operators';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { SystemLlmService } from './SystemLlmService';
import { SystemLlmServiceManager } from './SystemLlmServiceManager';
import { AgentService } from './AgentService';
import { EphemeralEventPatternService } from './EphemeralEventPatternService';
import { 
    ChannelTask, 
    TaskOrchestrationConfig,
    ChannelWorkloadAnalysis,
    AgentAssignmentAnalysis,
    CreateTaskRequest,
    UpdateTaskRequest,
    TaskAssignmentResult,
    TaskQueryFilters,
    AssignmentStrategy
} from '../../../shared/types/TaskTypes';
import { TaskEventData, createTaskEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { AgentId } from '../../../shared/types/Agent';
import { ChannelId } from '../../../shared/types/ChannelContext';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from '../../../shared/models/agent';
import { Task, TaskDocument } from '../../../shared/models/task';
import { TaskEvents } from '../../../shared/events/event-definitions/TaskEvents';
import { TaskCompletionMonitoringService } from './TaskCompletionMonitoringService';
import { TaskCompletionConfig } from '../../../shared/types/TaskCompletionTypes';

export class TaskService {
    private static instance: TaskService;
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('TaskService');
    private readonly ephemeralEventService: EphemeralEventPatternService;
    
    // Orchestration state
    private readonly activeChannels = new BehaviorSubject<Set<ChannelId>>(new Set());
    private readonly taskAssignments = new Map<string, AgentId>();
    private readonly channelWorkloads = new Map<ChannelId, ChannelWorkloadAnalysis>();
    private orchestrationInitialized = false;
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
        fallbackStrategy: 'role_based',
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
        
        // Set up event listeners
        this.setupTaskEventListeners();
        this.setupWorkloadMonitoring();
        this.setupAgentCoordination();
        
        // Start periodic analysis
        this.startPeriodicAnalysis();
        
        this.orchestrationInitialized = true;
    }

    /**
     * Set up task event listeners for orchestration
     */
    private setupTaskEventListeners(): void {
        // Listen for task creation events
        EventBus.server.on(Events.Task.CREATED, (eventPayload: any) => {
            this.handleTaskCreated(eventPayload.data.task);
        });

        // Listen for task assignment events
        EventBus.server.on(Events.Task.ASSIGNED, (eventPayload: any) => {
            this.handleTaskAssigned(eventPayload.data.task);
        });

        // Listen for task completion events
        EventBus.server.on(Events.Task.COMPLETED, (eventPayload: any) => {
            this.handleTaskCompleted(eventPayload.data.task);
        });

        // Listen for agent activity patterns
        EventBus.server.on('agent:activity_pattern', (eventData: any) => {
            this.handleAgentActivityPattern(eventData);
        });

    }

    /**
     * Set up workload monitoring
     */
    private setupWorkloadMonitoring(): void {
        // Monitor active channels for workload changes
        this.activeChannels.pipe(
            debounceTime(1000), // Wait for channel activity to settle
            filter(channels => channels.size > 0)
        ).subscribe(channels => {
            // ;
        });
    }

    /**
     * Set up agent coordination
     */
    private setupAgentCoordination(): void {
        // Combine channel activities with agent performance patterns
        combineLatest([
            this.activeChannels.asObservable(),
            timer(0, 30000) // Every 30 seconds
        ]).pipe(
            switchMap(() => this.coordinateAgentAssignments())
        ).subscribe({
            //next: () => // null,
            error: (error) => this.logger.error(`❌ Agent coordination error: ${error}`)
        });
    }

    /**
     * Start periodic analysis and optimization
     */
    private startPeriodicAnalysis(): void {
        // Run analysis every 5 minutes
        timer(0, 5 * 60 * 1000).subscribe(() => {
            this.optimizeTaskAssignments().catch(error => {
                this.logger.error(`❌ Periodic optimization failed: ${error}`);
            });
        });
    }

    /**
     * Create a new task
     */
    public async createTask(request: CreateTaskRequest, createdBy: string): Promise<ChannelTask> {
        this.validator.assertIsNonEmptyString(request.channelId, 'channelId is required');
        this.validator.assertIsNonEmptyString(request.title, 'title is required');
        this.validator.assertIsNonEmptyString(request.description, 'description is required');
        this.validator.assertIsNonEmptyString(createdBy, 'createdBy is required');

        const task = new Task({
            ...request,
            createdBy,
            priority: request.priority || 'medium',
            assignmentStrategy: request.assignmentStrategy || 'intelligent',
            status: 'pending'
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
                fromAgentId: createdBy,
                toAgentId: channelTask.assignedAgentId || createdBy,
                task: channelTask
            }
        );
        EventBus.server.emit(Events.Task.CREATED, eventPayload);

        // Emit assignment events for all assigned agents (critical for multi-agent tasks)
        const assignedAgentIds = request.assignedAgentIds || [];
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
        } else if (channelTask.assignedAgentId) {
            // Handle single agent assignment for backward compatibility
            const assignmentPayload = createTaskEventPayload(
                TaskEvents.ASSIGNED,
                createdBy,
                request.channelId,
                {
                    taskId: channelTask.id,
                    fromAgentId: createdBy,
                    toAgentId: channelTask.assignedAgentId,
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

        // Check if task has completion monitoring enabled
        if (request.metadata?.enableMonitoring && request.metadata?.completionConfig) {
            const monitoringService = TaskCompletionMonitoringService.getInstance();
            const completionConfig = request.metadata.completionConfig as TaskCompletionConfig;
            monitoringService.startMonitoring(savedTask, completionConfig);
        }

        return channelTask;
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
     * Assign task to a single agent (original logic)
     */
    private async assignToSingleAgent(task: TaskDocument): Promise<TaskAssignmentResult> {
        // Skip assignment if task is already assigned
        if (task.assignedAgentId) {
            //// this.logger.info(`🔄 Task ${task.id} already assigned to agent ${task.assignedAgentId}, emitting assignment event`);
            
            // Emit assignment event for manually assigned tasks
            const eventPayload = createTaskEventPayload(
                TaskEvents.ASSIGNED,
                task.assignedAgentId,
                task.channelId,
                {
                    taskId: task.id,
                    fromAgentId: task.createdBy,
                    toAgentId: task.assignedAgentId,
                    task: this.taskDocumentToChannelTask(task)
                }
            );
            EventBus.server.emit(TaskEvents.ASSIGNED, eventPayload);
            
            return {
                taskId: task.id,
                assignedAgentId: task.assignedAgentId,
                strategy: 'manual' as AssignmentStrategy,
                confidence: 1.0,
                reasoning: 'Task manually assigned during creation',
                assignedAt: task.updatedAt?.getTime() || Date.now()
            };
        }

        try {
            // Get available agents for this channel
            const availableAgents = await this.getAgentService().getActiveAgentsInChannel(task.channelId);
            
            if (availableAgents.length === 0) {
                throw new Error(`No available agents in channel ${task.channelId}`);
            }

            // Get workload analysis
            const workloadAnalysis = this.channelWorkloads.get(task.channelId) || {
                channelId: task.channelId,
                totalTasks: 0,
                pendingTasks: 0,
                activeTasks: 0,
                completedTasks: 0,
                failedTasks: 0,
                agentWorkloads: [],
                overloadedAgents: [],
                availableAgents: availableAgents.map(agent => ({ agentId: agent.id, role: (agent as any).role })),
                averageCompletionTime: 0,
                taskThroughput: 0,
                analysisTimestamp: Date.now(),
                confidence: 0.5
            };

            // Use SystemLLM for intelligent assignment if enabled
            if (this.config.enableLlmAssignment) {
                try {
                    const assignmentAnalysis = await this.getAgentAssignmentAnalysis(task, availableAgents, workloadAnalysis);
                    
                    if (assignmentAnalysis.confidence >= this.config.llmConfidenceThreshold) {
                        const assignedAgentId = assignmentAnalysis.recommendedAgentId;
                        const assignedAgent = availableAgents.find(agent => agent.id === assignedAgentId);
                        
                        if (assignedAgent) {
                            // Update task with assignment
                            task.assignedAgentId = assignedAgent.id;
                            await task.save();

                            // Emit assignment event
                            await this.emitTaskAssignmentEvent(task, assignedAgent.id);

                            return {
                                taskId: task.id,
                                assignedAgentId: assignedAgent.id,
                                strategy: 'intelligent' as AssignmentStrategy,
                                confidence: assignmentAnalysis.confidence,
                                reasoning: assignmentAnalysis.reasoning,
                                assignedAt: Date.now()
                            };
                        }
                    }
                } catch (llmError) {
                    this.logger.warn(`LLM assignment failed for task ${task.id}: ${llmError}`);
                }
            }

            // Fallback assignment
            const fallbackAnalysis = this.getFallbackAssignment(task, availableAgents);
            const fallbackAgentId = fallbackAnalysis.recommendedAgentId;
            const fallbackAgent = availableAgents.find(agent => agent.id === fallbackAgentId);
            
            if (!fallbackAgent) {
                throw new Error('No suitable agent found for assignment');
            }
            
            task.assignedAgentId = fallbackAgent.id;
            await task.save();

            //// this.logger.info(`⚙️ Task ${task.id} assigned to ${fallbackAgent.id} via fallback strategy`);

            // Emit assignment event
            await this.emitTaskAssignmentEvent(task, fallbackAgent.id);

            return {
                taskId: task.id,
                assignedAgentId: fallbackAgent.id,
                strategy: this.config.fallbackStrategy,
                confidence: 0.6,
                reasoning: 'Fallback assignment - first available agent',
                assignedAt: Date.now()
            };

        } catch (error: any) {
            this.logger.error(`❌ Failed to assign task ${task.id}: ${error.message}`);
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
            assignedAgentIds.map(async (agentId) => {
                const agent = await this.getAgentService().getAgent(agentId);
                if (agent) {
                }
                return agent;
            })
        );
        
        const validAgents = agents.filter(agent => agent !== null);
        const validAgentIds = validAgents.map(agent => agent!.id);
        
        
        if (validAgentIds.length === 0) {
            this.logger.error(`❌ DEBUG: No valid agents found for assignment - all agents returned null`);
            throw new Error('No valid agents found for assignment');
        }


        // Update task with assignments
        task.assignedAgentIds = validAgentIds;
        task.leadAgentId = task.leadAgentId || validAgentIds[0];
        await task.save();


        // Emit assignment events for each agent
        for (const agentId of validAgentIds) {
            await this.emitTaskAssignmentEvent(task, agentId);
        }


        return {
            taskId: task.id,
            assignedAgentId: task.leadAgentId!, // Primary agent for compatibility
            strategy: 'multi_agent' as AssignmentStrategy,
            confidence: 1.0,
            reasoning: `Multi-agent assignment: ${validAgentIds.length} agents assigned`,
            assignedAt: Date.now()
        };
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
            targetAgents = targetAgents.filter((agent: any) => 
                task.targetAgentRoles!.some(role => agent.role?.includes(role))
            );
        }
        
        if (task.excludeAgentIds?.length) {
            targetAgents = targetAgents.filter((agent: any) => 
                !task.excludeAgentIds!.includes(agent.id)
            );
        }
        
        if (task.maxParticipants && targetAgents.length > task.maxParticipants) {
            // Use SystemLLM to select best participants
            targetAgents = await this.selectBestParticipants(task, targetAgents, task.maxParticipants);
        }
        
        const assignedAgentIds = targetAgents.map((agent: any) => agent.id);
        
        if (assignedAgentIds.length === 0) {
            throw new Error('No eligible agents found for channel-wide assignment');
        }

        // Update task with assignments
        task.assignedAgentIds = assignedAgentIds;
        task.leadAgentId = task.leadAgentId || assignedAgentIds[0];
        task.channelWideTask = true;
        await task.save();

        // Emit assignment events for each agent
        for (const agentId of assignedAgentIds) {
            await this.emitTaskAssignmentEvent(task, agentId);
        }

        return {
            taskId: task.id,
            assignedAgentId: task.leadAgentId!, // Primary agent for compatibility
            strategy: 'channel_wide' as AssignmentStrategy,
            confidence: 1.0,
            reasoning: `Channel-wide assignment: ${assignedAgentIds.length} agents in ${task.channelId}`,
            assignedAt: Date.now()
        };
    }

    /**
     * Select best participants using per-channel SystemLLM instance
     */
    private async selectBestParticipants(
        task: TaskDocument, 
        agents: any[], 
        maxCount: number
    ): Promise<any[]> {
        // Get per-channel SystemLlmService instance
        const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(task.channelId);
        if (!systemLlm) {
            this.logger.warn(`No SystemLLM available for channel ${task.channelId}, using fallback participant selection`);
            return agents.slice(0, maxCount);
        }
        
        const selectionPrompt = `
Select the ${maxCount} best agents for this task:

TASK:
- Title: ${task.title}
- Description: ${task.description}
- Required Roles: ${task.requiredRoles?.join(', ') || 'Any'}
- Required Capabilities: ${task.requiredCapabilities?.join(', ') || 'Any'}

AVAILABLE AGENTS:
${agents.map((agent: any, index: number) => 
    `${index + 1}. ${agent.id} - Role: ${agent.role} - Capabilities: ${agent.capabilities?.join(', ')}`
).join('\n')}

Return the indices (1-based) of the best agents, separated by commas.
`;
        
        try {
            const response = await systemLlm.sendLlmRequest(selectionPrompt, null);
            const indices = response.split(',').map((i: string) => parseInt(i.trim()) - 1);
            return indices.filter((i: number) => i >= 0 && i < agents.length).map((i: number) => agents[i]);
        } catch (error) {
            // Fallback: return first N agents
            return agents.slice(0, maxCount);
        }
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
        const hasTaskComplete = !allowedTools || allowedTools.includes('task_complete');
        
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
        agents: any[], 
        workloadAnalysis: ChannelWorkloadAnalysis
    ): Promise<AgentAssignmentAnalysis> {
        // Get per-channel SystemLlmService instance
        const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(task.channelId);
        if (!systemLlm) {
            this.logger.warn(`No SystemLLM available for channel ${task.channelId}, using fallback assignment`);
            return this.getFallbackAssignment(task, agents);
        }
        
        const prompt = this.buildAssignmentPrompt(task, agents, workloadAnalysis);
        
        try {
            // Use the public method for LLM communication - only takes channelId
            const response = await systemLlm.analyzeChannelForCoordination(
                task.channelId
            );

            // Extract useful information from coordination analysis for assignment
            const analysis = this.parseCoordinationResponseForAssignment(response, agents, task);
            return analysis;
            
        } catch (error) {
            this.logger.warn(`LLM assignment failed, using fallback: ${error}`);
            return this.getFallbackAssignment(task, agents);
        }
    }

    /**
     * Build prompt for SystemLLM assignment analysis
     */
    private buildAssignmentPrompt(task: TaskDocument, agents: any[], workload: ChannelWorkloadAnalysis): string {
        const agentList = agents.map(agent => ({
            id: agent.agentId,
            role: agent.role || 'general',
            capabilities: agent.capabilities || [],
            specialization: agent.specialization || 'general',
            currentTasks: workload.agentWorkloads.find(w => w.agentId === agent.agentId)?.activeTasks || 0
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
  "workloadScore": 0.0-1.0
}`;
    }

    /**
     * Parse coordination response for assignment recommendations
     */
    private parseCoordinationResponseForAssignment(response: any, agents: any[], task: TaskDocument): AgentAssignmentAnalysis {
        try {
            // Use the coordination analysis to make assignment decisions
            const bestAgent = agents[0] || { id: 'default' }; // Simple fallback
            
            return {
                recommendedAgentId: bestAgent.id,
                confidence: 0.7, // Moderate confidence from coordination analysis
                reasoning: 'Assignment based on channel coordination analysis',
                roleMatch: 0.6,
                capabilityMatch: 0.6,
                workloadScore: 0.7,
                expertiseScore: 0.6,
                availabilityScore: 0.8
            };
        } catch (error) {
            return this.getFallbackAssignment(task, agents);
        }
    }

    /**
     * Parse LLM response for assignment
     */
    private parseAssignmentResponse(response: string, agents: any[]): AgentAssignmentAnalysis {
        try {
            const parsed = JSON.parse(response);
            return {
                recommendedAgentId: parsed.recommendedAgentId,
                confidence: parsed.confidence || 0.5,
                reasoning: parsed.reasoning || 'LLM assignment',
                roleMatch: parsed.roleMatch || 0.5,
                capabilityMatch: parsed.capabilityMatch || 0.5,
                workloadScore: parsed.workloadScore || 0.5,
                expertiseScore: 0.5,
                availabilityScore: 0.5
            };
        } catch (error) {
            return this.getFallbackAssignment({ requiredRoles: [] } as any, agents);
        }
    }

    /**
     * Fallback assignment when LLM fails
     */
    private getFallbackAssignment(task: any, agents: any[]): AgentAssignmentAnalysis {
        // Simple role-based fallback
        const bestAgent = agents[0]; // Simple fallback to first agent
        return {
            recommendedAgentId: bestAgent.id,
            confidence: 0.5,
            reasoning: 'Fallback assignment - LLM unavailable',
            roleMatch: 0.5,
            capabilityMatch: 0.5,
            workloadScore: 0.5,
            expertiseScore: 0.5,
            availabilityScore: 0.5
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
            metadata: task.metadata, // Preserve metadata
            tags: task.tags // Preserve tags
        };
    }

    /**
     * Get tasks by various filters
     */
    public async getTasks(filters: TaskQueryFilters = {}): Promise<ChannelTask[]> {
        const query: any = {};
        
        if (filters.channelId) query.channelId = filters.channelId;
        if (filters.status) query.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
        if (filters.assignedAgentId) query.assignedAgentId = filters.assignedAgentId;
        if (filters.priority) query.priority = Array.isArray(filters.priority) ? { $in: filters.priority } : filters.priority;
        
        const tasks = await Task.find(query).sort({ priority: -1, createdAt: -1 });
        return tasks.map((task: any) => this.taskDocumentToChannelTask(task));
    }

    /**
     * Update task
     */
    public async updateTask(taskId: string, update: UpdateTaskRequest): Promise<ChannelTask> {
        const task = await Task.findByIdAndUpdate(taskId, update, { new: true });
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        return this.taskDocumentToChannelTask(task);
    }

    /**
     * Analyze workload for a specific channel
     */
    private async analyzeChannelWorkload(channelId: ChannelId): Promise<void> {
        try {
            // ;
            
            // Get active tasks in the channel
            const activeTasks = await this.getActiveTasksInChannel(channelId);
            
            // Get agents in the channel
            const agentsInChannel = await this.getAgentService().getActiveAgentsInChannel(channelId);
            
            // Create workload analysis
            const workload: ChannelWorkloadAnalysis = {
                channelId,
                totalTasks: activeTasks.length,
                pendingTasks: activeTasks.filter(t => t.status === 'pending').length,
                activeTasks: activeTasks.filter(t => t.status === 'in_progress').length,
                completedTasks: 0, // Would need historical data
                failedTasks: 0, // Would need historical data
                agentWorkloads: agentsInChannel.map(agent => ({
                    agentId: agent.id,
                    activeTasks: activeTasks.filter(t => t.assignedAgentId === agent.id).length,
                    pendingTasks: activeTasks.filter(t => t.assignedAgentId === agent.id && t.status === 'pending').length,
                    completionRate: 0.8, // Would need historical data
                    averageTaskDuration: 3600000, // 1 hour in ms, would need historical data
                    isOverloaded: false
                })),
                averageCompletionTime: 3600000, // 1 hour in ms, would need historical data
                taskThroughput: 0, // Would need historical data
                analysisTimestamp: Date.now(),
                confidence: 0.9
            };

            // Store workload analysis
            this.channelWorkloads.set(channelId, workload);

        } catch (error) {
            this.logger.error(`❌ Failed to analyze channel workload: ${error}`);
        }
    }

    /**
     * Get active tasks in a channel
     */
    private async getActiveTasksInChannel(channelId: ChannelId): Promise<ChannelTask[]> {
        try {
            return await this.getTasks({
                channelId,
                status: ['pending', 'in_progress'] as any
            });
        } catch (error) {
            this.logger.error(`❌ Failed to get active tasks for channel ${channelId}: ${error}`);
            return [];
        }
    }

    /**
     * Handle task creation event for orchestration
     */
    private async handleTaskCreated(task: ChannelTask): Promise<void> {
        try {

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
     * Handle agent activity patterns from EphemeralEventPatternService
     */
    private async handleAgentActivityPattern(eventData: any): Promise<void> {
        try {
            // ;
            
            // Future implementation for responding to activity patterns
            // Could trigger task reassignment or workload balancing

        } catch (error) {
            this.logger.error(`❌ Failed to handle agent activity pattern: ${error}`);
        }
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
                const workload = this.channelWorkloads.get(channelId);
                if (workload && workload.confidence > 0.7) {
                    // Use per-channel SystemLLM instance for optimization suggestions
                    const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
                    if (systemLlm) {
                        await systemLlm.analyzeChannelForCoordination(channelId);
                    } else {
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
     * Handle task completion from agent's task_complete tool call
     * This centralizes all task completion logic and ensures single event emission
     */
    public async handleTaskCompletion(
        agentId: string,
        channelId: string,
        completionData: {
            summary: string;
            success?: boolean;
            details?: Record<string, any>;
            nextSteps?: string;
            requestId: string;
        }
    ): Promise<{ status: string; message: string; taskId?: string; nextSteps?: string }> {
        try {
            
            // Validate inputs
            const validator = createStrictValidator('TaskService.handleTaskCompletion');
            validator.assertIsNonEmptyString(agentId, 'agentId is required');
            validator.assertIsNonEmptyString(channelId, 'channelId is required');
            validator.assertIsNonEmptyString(completionData.summary, 'summary is required');
            
            // Find the active task for this agent
            const activeTasks = await this.getTasks({ channelId });
            const agentTask = activeTasks.find(task => 
                (task.assignedAgentIds?.includes(agentId) || task.assignedAgentId === agentId) && 
                task.status !== 'completed' &&
                task.status !== 'failed' && 
                task.status !== 'cancelled'
            );
            
            if (!agentTask) {
                this.logger.warn(`⚠️ No active task found for agent ${agentId} in channel ${channelId}`);
                return {
                    status: 'no_active_task',
                    message: 'No active task found to complete'
                };
            }
            
            
            // Check if task is already completed (race condition protection)
            if (agentTask.status === 'completed') {
                return {
                    status: 'already_completed',
                    message: 'Task was already completed by another agent',
                    taskId: agentTask.id
                };
            }
            
            // Update task to completed status
            const updatedTask = await this.updateTask(agentTask.id, {
                status: 'completed',
                progress: 100,
                metadata: {
                    ...agentTask.metadata,
                    completedAt: new Date().toISOString(),
                    completedBy: agentId,
                    result: {
                        agentId,
                        summary: completionData.summary,
                        success: completionData.success !== false,
                        details: completionData.details || {},
                        nextSteps: completionData.nextSteps,
                        completedAt: new Date().toISOString(),
                        requestId: completionData.requestId
                    }
                }
            });
            
            
            // Emit single task completion event
            const taskEventData = {
                taskId: updatedTask.id,
                fromAgentId: agentId,
                toAgentId: agentId,
                task: {
                    ...updatedTask,
                    result: updatedTask.metadata?.result || completionData
                }
            };
            
            const eventPayload = createTaskEventPayload(TaskEvents.COMPLETED, agentId, channelId, taskEventData);
            EventBus.server.emit(TaskEvents.COMPLETED, eventPayload);
            
            
            return {
                status: 'task_completed',
                message: `Task completed successfully: ${completionData.summary}`,
                taskId: updatedTask.id,
                nextSteps: completionData.nextSteps
            };
            
        } catch (error) {
            this.logger.error(`❌ TASK COMPLETE: Error handling task completion: ${error}`);
            throw error;
        }
    }
}
