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
 * Task Completion Monitoring Service
 * 
 * Uses SystemLLM to intelligently monitor task progress and determine completion
 * Leverages existing planning tools and memory infrastructure
 */

import { Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { TaskEvents } from '../../../shared/events/event-definitions/TaskEvents';
import { 
    TaskCompletionConfig, 
    TaskMonitoringState, 
    CompletionStrategyType,
    TaskCompletionEvent 
} from '../../../shared/types/TaskCompletionTypes';
import { TaskDocument } from '../../../shared/models/task';
import { SystemLlmService } from './SystemLlmService';
import { SystemLlmServiceManager } from './SystemLlmServiceManager';
import { MemoryService } from '../../../shared/services/MemoryService';
import { lastValueFrom } from 'rxjs';
import { createTaskEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { v4 as uuidv4 } from 'uuid';
import { PromptInput } from '../../../shared/types/LlmTypes';

export class TaskCompletionMonitoringService {
    private static instance: TaskCompletionMonitoringService;
    private logger: Logger;
    private monitoringStates: Map<string, TaskMonitoringState>;
    private monitoringIntervals: Map<string, NodeJS.Timeout>;
    private taskConfigs: Map<string, TaskCompletionConfig>;

    private constructor() {
        this.logger = new Logger('debug', 'TaskCompletionMonitoring', 'server');
        this.monitoringStates = new Map();
        this.monitoringIntervals = new Map();
        this.taskConfigs = new Map();
        
        this.setupEventListeners();
    }

    public static getInstance(): TaskCompletionMonitoringService {
        if (!TaskCompletionMonitoringService.instance) {
            TaskCompletionMonitoringService.instance = new TaskCompletionMonitoringService();
        }
        return TaskCompletionMonitoringService.instance;
    }

    /**
     * Start monitoring a task for completion
     */
    public startMonitoring(task: TaskDocument, config: TaskCompletionConfig): void {
        // Check if monitoring is disabled
        if (config.enabled === false) {
            return;
        }
        
        
        // Initialize monitoring state
        const state: TaskMonitoringState = {
            taskId: task.id,
            startTime: Date.now(),
            lastActivityTime: Date.now(),
            activityCount: 0,
            evidence: {
                messages: [],
                toolCalls: [],
                planProgress: undefined
            },
            evaluations: [],
            agentActivity: new Map()
        };
        
        this.monitoringStates.set(task.id, state);
        this.taskConfigs.set(task.id, config);
        
        // Start evaluation based on primary strategy
        this.startEvaluationLoop(task, config);
    }

    /**
     * Stop monitoring a task
     */
    public stopMonitoring(taskId: string): void {
        
        const interval = this.monitoringIntervals.get(taskId);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(taskId);
        }
        
        this.monitoringStates.delete(taskId);
        this.taskConfigs.delete(taskId);
    }

    /**
     * Setup event listeners for tracking agent activity
     */
    private setupEventListeners(): void {
        // Track agent messages
        EventBus.server.on(Events.Message.AGENT_MESSAGE_DELIVERED, (payload: any) => {
            const { data } = payload;
            const taskId = this.findTaskForAgent(data.fromAgentId, data.channelId);
            if (taskId) {
                this.recordAgentMessage(taskId, data.fromAgentId, data.content);
            }
        });

        // Track tool calls
        EventBus.server.on('tool:executed', (payload: any) => {
            const { agentId, tool, result } = payload.data;
            const taskId = this.findTaskForAgent(agentId, payload.channelId);
            if (taskId) {
                this.recordToolCall(taskId, agentId, tool, result);
            }
        });

        // Track plan updates
        EventBus.server.on('plan:step_completed', (payload: any) => {
            const { planId, stepId } = payload.data;
            this.updatePlanProgress(planId, stepId);
        });
    }

    /**
     * Start the evaluation loop based on strategy
     */
    private startEvaluationLoop(task: TaskDocument, config: TaskCompletionConfig): void {
        let interval = 30000; // Default 30 seconds
        
        // Determine evaluation interval based on strategy
        if (config.primary.type === 'systemllm-eval') {
            interval = config.primary.evaluationInterval;
        } else if (config.primary.type === 'time-based') {
            interval = Math.min(10000, config.primary.maximumDuration / 10);
        }
        
        const evaluationInterval = setInterval(async () => {
            await this.evaluateTaskCompletion(task, config);
        }, interval);
        
        this.monitoringIntervals.set(task.id, evaluationInterval);
        
        // Run first evaluation immediately
        this.evaluateTaskCompletion(task, config);
    }

    /**
     * Evaluate if task should be completed
     */
    private async evaluateTaskCompletion(task: TaskDocument, config: TaskCompletionConfig): Promise<void> {
        const state = this.monitoringStates.get(task.id);
        if (!state) return;
        
        
        let isComplete = false;
        let confidence = 0;
        let reason = '';
        
        // Evaluate based on primary strategy
        switch (config.primary.type) {
            case 'plan-based':
                const planResult = await this.evaluatePlanBasedCompletion(task, config.primary, state);
                isComplete = planResult.complete;
                confidence = planResult.confidence;
                reason = planResult.reason;
                break;
                
            case 'systemllm-eval':
                const llmResult = await this.evaluateSystemLLMCompletion(task, config.primary, state);
                isComplete = llmResult.complete;
                confidence = llmResult.confidence;
                reason = llmResult.reason;
                break;
                
            case 'output-based':
                const outputResult = this.evaluateOutputBasedCompletion(task, config.primary, state);
                isComplete = outputResult.complete;
                confidence = outputResult.confidence;
                reason = outputResult.reason;
                break;
                
            case 'time-based':
                const timeResult = this.evaluateTimeBasedCompletion(task, config.primary, state);
                isComplete = timeResult.complete;
                confidence = timeResult.confidence;
                reason = timeResult.reason;
                break;
        }
        
        // Record evaluation
        state.evaluations.push({
            timestamp: Date.now(),
            strategy: config.primary.type,
            result: isComplete,
            confidence,
            reason
        });
        
        // Complete task if criteria met
        if (isComplete && confidence >= (config.primary.type === 'systemllm-eval' ? config.primary.confidenceThreshold : 0.8)) {
            await this.completeTask(task, state, config.primary.type, reason);
        }
        
        // Check absolute timeout
        if (config.absoluteTimeout && Date.now() - state.startTime > config.absoluteTimeout) {
            const timeoutReason = `Absolute timeout reached (${config.absoluteTimeout}ms)`;
            if (config.timeoutBehavior === 'complete') {
                await this.completeTask(task, state, 'time-based', timeoutReason);
            } else if (config.timeoutBehavior === 'fail') {
                await this.failTask(task, state, timeoutReason);
            }
        }
    }

    /**
     * Evaluate plan-based completion
     */
    private async evaluatePlanBasedCompletion(
        task: TaskDocument, 
        criteria: any, 
        state: TaskMonitoringState
    ): Promise<{ complete: boolean; confidence: number; reason: string }> {
        // Get plan from channel memory
        const memoryService = MemoryService.getInstance();
        const channelMemoryObs = memoryService.getChannelMemory(task.channelId);
        const channelMemory = await lastValueFrom(channelMemoryObs);
        const plan = channelMemory?.customData?.[`plan:${criteria.planId}`];
        
        if (!plan || !plan.items) {
            return { complete: false, confidence: 0, reason: 'Plan not found' };
        }
        
        const completedSteps = plan.items.filter((item: any) => item.status === 'completed');
        const criticalSteps = plan.items.filter((item: any) => item.critical);
        const criticalCompleted = criticalSteps.filter((item: any) => item.status === 'completed');
        
        state.evidence.planProgress = {
            completedSteps: completedSteps.map((s: any) => s.id),
            totalSteps: plan.items.length,
            criticalStepsCompleted: criticalCompleted.length
        };
        
        switch (criteria.completionType) {
            case 'all_steps':
                const allComplete = completedSteps.length === plan.items.length;
                return {
                    complete: allComplete,
                    confidence: allComplete ? 1.0 : completedSteps.length / plan.items.length,
                    reason: `${completedSteps.length}/${plan.items.length} steps completed`
                };
                
            case 'critical_steps':
                const criticalComplete = criticalCompleted.length === criticalSteps.length;
                return {
                    complete: criticalComplete,
                    confidence: criticalComplete ? 1.0 : criticalCompleted.length / criticalSteps.length,
                    reason: `${criticalCompleted.length}/${criticalSteps.length} critical steps completed`
                };
                
            case 'percentage':
                const percentage = (completedSteps.length / plan.items.length) * 100;
                const targetMet = percentage >= (criteria.percentage || 100);
                return {
                    complete: targetMet,
                    confidence: percentage / 100,
                    reason: `${percentage.toFixed(1)}% of steps completed`
                };
        }
        
        return { complete: false, confidence: 0, reason: 'Unknown completion type' };
    }

    /**
     * Evaluate using SystemLLM (uses per-channel instance from SystemLlmServiceManager)
     */
    private async evaluateSystemLLMCompletion(
        task: TaskDocument, 
        criteria: any, 
        state: TaskMonitoringState
    ): Promise<{ complete: boolean; confidence: number; reason: string }> {
        // Get the per-channel SystemLlmService instance
        const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(task.channelId);
        if (!systemLlm) {
            return { complete: false, confidence: 0, reason: 'SystemLLM not available for channel' };
        }
        
        // Build context for LLM evaluation
        const context = {
            task: {
                title: task.title,
                description: task.description,
                objectives: criteria.objectives,
                assignedAgents: task.assignedAgentIds
            },
            evidence: {
                duration: Date.now() - state.startTime,
                messageCount: state.evidence.messages.length,
                toolCallCount: state.evidence.toolCalls.length,
                activeAgents: Array.from(state.agentActivity.keys()),
                recentMessages: state.evidence.messages.slice(-10),
                recentTools: state.evidence.toolCalls.slice(-10),
                planProgress: state.evidence.planProgress
            }
        };
        
        const prompt = `Evaluate if this task is complete based on the objectives and evidence.

Task: ${task.title}
Description: ${task.description}

Objectives that must be met:
${criteria.objectives.map((o: string) => `- ${o}`).join('\n')}

Evidence of progress:
- Duration: ${Math.round(context.evidence.duration / 1000)}s
- Messages sent: ${context.evidence.messageCount}
- Tools used: ${context.evidence.toolCallCount}
- Active agents: ${context.evidence.activeAgents.join(', ')}

Recent activity:
${context.evidence.recentMessages.map((m: any) => `- ${m.agentId}: ${m.content.substring(0, 100)}...`).join('\n')}

Based on this evidence, are ALL objectives complete? Respond with:
1. YES/NO
2. Confidence (0-1)
3. Brief reason

Format: <complete>YES/NO</complete> <confidence>0.X</confidence> <reason>...</reason>`;

        try {
            // Use SystemLLM's processPrompt method for evaluation
            const promptInput: PromptInput = {
                prompt: prompt,
                systemPrompt: 'You are a task completion evaluator. Analyze if the task objectives have been met based on the evidence. Respond EXACTLY in this format: <complete>YES/NO</complete> <confidence>0.X</confidence> <reason>Brief explanation</reason>',
                options: {
                    temperature: 0.3,
                    maxTokens: 200
                }
            };
            
            // Call the private processPrompt method using bind to access it
            const processPromptMethod = (systemLlm as any).processPrompt.bind(systemLlm);
            const responseObservable = processPromptMethod(promptInput);
            
            const responseText = await lastValueFrom(responseObservable);
            
            // Parse response (ensure responseText is a string)
            const responseStr = String(responseText);
            const completeMatch = responseStr.match(/<complete>(YES|NO)<\/complete>/);
            const confidenceMatch = responseStr.match(/<confidence>([\d.]+)<\/confidence>/);
            const reasonMatch = responseStr.match(/<reason>(.*?)<\/reason>/s);
            
            return {
                complete: completeMatch?.[1] === 'YES',
                confidence: parseFloat(confidenceMatch?.[1] || '0'),
                reason: reasonMatch?.[1] || 'No reason provided'
            };
        } catch (error) {
            this.logger.error(`SystemLLM evaluation failed: ${error}`);
            return { complete: false, confidence: 0, reason: 'Evaluation error' };
        }
    }

    /**
     * Evaluate output-based completion
     */
    private evaluateOutputBasedCompletion(
        task: TaskDocument, 
        criteria: any, 
        state: TaskMonitoringState
    ): { complete: boolean; confidence: number; reason: string } {
        const requiredOutputs = criteria.requiredOutputs || [];
        let metCount = 0;
        
        for (const required of requiredOutputs) {
            let found = 0;
            
            if (required.type === 'message') {
                found = state.evidence.messages.filter((m: any) => 
                    !required.pattern || new RegExp(required.pattern).test(m.content)
                ).length;
            } else if (required.type === 'tool_call') {
                found = state.evidence.toolCalls.filter((t: any) => 
                    !required.pattern || new RegExp(required.pattern).test(t.toolName)
                ).length;
            }
            
            if (found >= (required.count || 1)) {
                metCount++;
            }
        }
        
        const allMet = metCount === requiredOutputs.length;
        return {
            complete: allMet,
            confidence: requiredOutputs.length > 0 ? metCount / requiredOutputs.length : 0,
            reason: `${metCount}/${requiredOutputs.length} required outputs found`
        };
    }

    /**
     * Evaluate time-based completion
     */
    private evaluateTimeBasedCompletion(
        task: TaskDocument, 
        criteria: any, 
        state: TaskMonitoringState
    ): { complete: boolean; confidence: number; reason: string } {
        const elapsed = Date.now() - state.startTime;
        const inactiveTime = Date.now() - state.lastActivityTime;
        
        // Check minimum duration
        if (criteria.minimumDuration && elapsed < criteria.minimumDuration) {
            return {
                complete: false,
                confidence: elapsed / criteria.minimumDuration,
                reason: `Minimum duration not met (${elapsed}ms < ${criteria.minimumDuration}ms)`
            };
        }
        
        // Check maximum duration
        if (elapsed >= criteria.maximumDuration) {
            if (criteria.requireActivity && state.activityCount === 0) {
                return {
                    complete: false,
                    confidence: 0,
                    reason: 'No activity detected'
                };
            }
            return {
                complete: true,
                confidence: 1.0,
                reason: `Maximum duration reached (${elapsed}ms)`
            };
        }
        
        // Check for inactivity completion
        const inactivityThreshold = criteria.maximumDuration / 4; // 25% of max duration
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
            reason: `Elapsed: ${elapsed}ms, Inactive: ${inactiveTime}ms`
        };
    }

    /**
     * Complete a task
     */
    private async completeTask(
        task: TaskDocument, 
        state: TaskMonitoringState, 
        strategy: CompletionStrategyType,
        reason: string
    ): Promise<void> {
        
        // Stop monitoring
        this.stopMonitoring(task.id);
        
        // Emit completion event
        const completionEvent: TaskCompletionEvent = {
            taskId: task.id,
            completedBy: 'system',
            completionStrategy: strategy,
            evidence: state.evidence,
            confidence: 1.0,
            reason,
            duration: Date.now() - state.startTime
        };
        
        // Ensure task has all required fields for the event payload
        const completeTask = {
            id: task.id,
            channelId: task.channelId,
            title: task.title || 'Untitled Task',
            description: task.description || '',
            status: 'completed' as const,
            priority: task.priority || 'medium',
            assignmentScope: task.assignmentScope || 'single',
            assignedAgentIds: task.assignedAgentIds || [],
            assignmentStrategy: task.assignmentStrategy || 'manual',
            coordinationMode: task.coordinationMode || 'collaborative',
            createdBy: task.createdBy || 'system',
            createdAt: task.createdAt || Date.now(),
            updatedAt: Date.now(),
            progress: 100,
            metadata: task.metadata || {},
            tags: task.tags || [],
            result: {
                summary: `Task automatically completed: ${reason}`,
                completionEvent
            }
        };
        
        // Emit task completion using existing event
        const payload = createTaskEventPayload(
            TaskEvents.COMPLETED,
            'system',
            task.channelId,
            {
                taskId: task.id,
                fromAgentId: 'system',
                toAgentId: 'system',
                task: completeTask
            }
        );
        
        EventBus.server.emit(TaskEvents.COMPLETED, payload);
    }

    /**
     * Fail a task
     */
    private async failTask(task: TaskDocument, state: TaskMonitoringState, reason: string): Promise<void> {
        this.logger.error(`❌ Failing task ${task.id}: ${reason}`);
        
        // Stop monitoring
        this.stopMonitoring(task.id);
        
        // Emit failure event
        const payload = createTaskEventPayload(
            TaskEvents.FAILED,
            'system',
            task.channelId,
            {
                taskId: task.id,
                fromAgentId: 'system',
                toAgentId: 'system',
                task: {
                    channelId: task.channelId,
                    id: task.id,
                    title: task.title,
                    description: task.description,
                    status: 'failed',
                    error: reason
                }
            }
        );
        
        EventBus.server.emit(TaskEvents.FAILED, payload);
    }

    /**
     * Record agent message
     */
    private recordAgentMessage(taskId: string, agentId: string, content: string): void {
        const state = this.monitoringStates.get(taskId);
        if (!state) return;
        
        state.evidence.messages.push({
            agentId,
            content,
            timestamp: Date.now()
        });
        
        state.lastActivityTime = Date.now();
        state.activityCount++;
        
        // Update agent activity
        const agentActivity = state.agentActivity.get(agentId) || {
            messageCount: 0,
            toolCallCount: 0,
            lastActive: 0
        };
        agentActivity.messageCount++;
        agentActivity.lastActive = Date.now();
        state.agentActivity.set(agentId, agentActivity);
    }

    /**
     * Record tool call
     */
    private recordToolCall(taskId: string, agentId: string, toolName: string, result: any): void {
        const state = this.monitoringStates.get(taskId);
        if (!state) return;
        
        state.evidence.toolCalls.push({
            agentId,
            toolName,
            result,
            timestamp: Date.now()
        });
        
        state.lastActivityTime = Date.now();
        state.activityCount++;
        
        // Update agent activity
        const agentActivity = state.agentActivity.get(agentId) || {
            messageCount: 0,
            toolCallCount: 0,
            lastActive: 0
        };
        agentActivity.toolCallCount++;
        agentActivity.lastActive = Date.now();
        state.agentActivity.set(agentId, agentActivity);
    }

    /**
     * Update plan progress
     */
    private updatePlanProgress(planId: string, stepId: string): void {
        // Find tasks monitoring this plan
        for (const [taskId, config] of this.taskConfigs) {
            if (config.primary.type === 'plan-based' && config.primary.planId === planId) {
                const state = this.monitoringStates.get(taskId);
                if (state && state.evidence.planProgress) {
                    state.evidence.planProgress.completedSteps.push(stepId);
                }
            }
        }
    }

    /**
     * Find task for an agent in a channel
     */
    private findTaskForAgent(agentId: string, channelId: string): string | null {
        // This would query the task service - simplified for now
        for (const [taskId, state] of this.monitoringStates) {
            if (state.agentActivity.has(agentId)) {
                return taskId;
            }
        }
        return null;
    }
}