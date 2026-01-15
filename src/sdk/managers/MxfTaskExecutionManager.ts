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
 * Task Execution Manager for MxfAgent
 * 
 * Manages task execution workflows, context tracking, and completion detection
 * for LLM agents. Handles both single-agent and multi-agent task scenarios.
 */

import { Logger } from '../../shared/utils/Logger';
import { TaskHelpers, AgentContext } from '../MxfAgentHelpers';
import { IntentFormulationHelper } from '../helpers/IntentFormulationHelper';

export interface TaskExecutionCallbacks {
    generateResponse: (prompt: string | null, tools?: any[], taskPrompt?: string) => Promise<string>;
    getCachedTools: () => any[];
    setCurrentTask: (task: any) => void;
    getCurrentTask: () => any;
    updateSystemPromptForTask: (task: any) => Promise<void>;
    isToolGatekeepingDisabled: () => boolean;
    getAllowedTools: () => string[] | undefined;  // Get agent's allowed tools list
}

export class MxfTaskExecutionManager {
    private logger: Logger;
    private agentId: string;
    private callbacks: TaskExecutionCallbacks;
    private currentTask: any = null;
    private taskExecutionStartTime: number = 0;
    private taskExecutionMetrics: Map<string, any> = new Map();

    constructor(agentId: string, callbacks: TaskExecutionCallbacks) {
        this.agentId = agentId;
        this.callbacks = callbacks;
        this.logger = new Logger('debug', `TaskExecution:${agentId}`, 'client');
    }

    /**
     * Execute a task request in a continuous loop until completion
     */
    public async executeTask(taskRequest: any): Promise<any> {
        this.taskExecutionStartTime = Date.now();
        
        try {
            // Track current task context for tool gatekeeper
            this.currentTask = taskRequest;
            this.callbacks.setCurrentTask(taskRequest);
            
            // Update system prompt based on task context
            if (taskRequest.metadata) {
                await this.callbacks.updateSystemPromptForTask(taskRequest);
            }
            
            await this.executeTaskLoop(taskRequest);
            
            const executionTime = Date.now() - this.taskExecutionStartTime;
            
            // Store execution metrics
            this.storeExecutionMetrics(taskRequest.taskId, executionTime);
            
            return {
                taskId: taskRequest.taskId,
                toAgentId: taskRequest.fromAgentId,
                content: 'Task processing initiated - agent will signal completion via task_complete tool'
            };
        } catch (error) {
            this.logger.error(`Error executing task ${taskRequest.taskId}: ${error}`);
            throw error;
        } finally {
            // Don't clear current task context here - let it be cleared when task_complete is called
            // This prevents rapid fire tool calls due to "No active task" fallback logic
            // The task context will be cleared in MxfAgent when task_complete is detected
        }
    }

    /**
     * Execute task in a continuous loop until agent signals completion
     */
    private async executeTaskLoop(taskRequest: any): Promise<void> {

        // Get available tools from task request or use cached tools
        let availableTools: any[] = [];

        if (taskRequest.tools && taskRequest.tools.length > 0) {
            // Use provided tools from task request
            availableTools = taskRequest.tools;
        } else {
            // Get cached tools - FAIL FAST if not available
            availableTools = this.callbacks.getCachedTools();

            if (!availableTools || availableTools.length === 0) {
                throw new Error('No cached tools available - cannot execute task');
            }

        }

        // CRITICAL: Filter tools by allowedTools to ensure only permitted tools are sent to LLM
        // This is essential for phase-gated tool systems where allowedTools changes dynamically
        const allowedTools = this.callbacks.getAllowedTools();
        if (allowedTools && allowedTools.length > 0) {
            const originalCount = availableTools.length;
            availableTools = availableTools.filter((tool: any) =>
                allowedTools.includes(tool.name)
            );
            this.logger.debug(`🔒 Tool filtering: ${originalCount} → ${availableTools.length} tools (allowedTools: ${allowedTools.join(', ')})`);
        }

        // Create comprehensive task prompt with context
        const taskPrompt = this.createTaskPrompt(taskRequest);
        
        try {
            // Single call to generateResponse with task as separate parameter
            // Pass null for userMessage since this is a task, not a conversation
            const response = await this.callbacks.generateResponse(null, availableTools, taskPrompt);
            
            
        } catch (error) {
            this.logger.error(`Error in task execution loop: ${error}`);
            throw error;
        }
    }

    /**
     * Create a comprehensive task prompt with proper context and guidance
     */
    private createTaskPrompt(taskRequest: any): string {
        const taskContext = this.buildTaskContextGuidance(taskRequest);
        const completionGuidance = this.buildCompletionGuidance(taskRequest);
        
        // Analyze task for better intent formulation
        const taskDescription = taskRequest.content || taskRequest.description || '';
        const intentGuidance = this.buildIntentFormulationGuidance(taskDescription);
        
        // Add planning guidance only if agent has planning tools
        const tools = this.callbacks.getCachedTools();
        const hasPlanningTools = tools.some((tool: any) => 
            tool.name?.includes('planning') || tool.name === 'task_create_with_plan'
        );
        
        const planningGuidance = hasPlanningTools ? `

📋 RECOMMENDED WORKFLOW:
1. **PLAN FIRST**: Create a plan using 'planning_create' or 'task_create_with_plan'
   - Break down complex tasks into clear steps
   - Update your plan when new information changes your approach
2. **EXECUTE**: Work through your plan systematically
   - Use 'planning_update_item' to track progress
3. **COMPLETE**: Call 'task_complete' when finished

Please start by creating a plan or beginning work on this task.` : '\n\nPlease begin work on this task.';
        
        // Include metadata as JSON if present (agents can parse it for additional context)
        const metadataSection = taskRequest.metadata && Object.keys(taskRequest.metadata).length > 0
            ? `\n\n## Task Metadata\n\`\`\`json\n${JSON.stringify(taskRequest.metadata, null, 2)}\n\`\`\`\n`
            : '';
        
        return `You have been assigned a task: ${taskRequest.content}
${metadataSection}
${taskContext}

${completionGuidance}

${intentGuidance}${planningGuidance}`;
    }

    /**
     * Build task context guidance based on task metadata
     */
    private buildTaskContextGuidance(taskRequest: any): string {
        // Determine if multi-agent from metadata (since SimpleTaskRequest doesn't have full task properties)
        const isMultiAgent = taskRequest.metadata?.multiAgentTask === true || 
                            taskRequest.metadata?.assignmentScope === 'multiple' ||
                            (taskRequest.metadata?.assignedAgentIds && taskRequest.metadata.assignedAgentIds.length > 1);
        
        // Check if agent has task_complete tool
        const allowedTools = this.callbacks.getAllowedTools();
        const hasTaskComplete = !allowedTools || allowedTools.includes('task_complete');
        
        let guidance = '';
        
        if (isMultiAgent) {
            guidance += `\n## Multi-Agent Collaboration\n`;
            // Check if this agent is the completion agent
            const completionAgent = taskRequest.metadata?.completionAgentId || taskRequest.metadata?.completionAgent;
            if (completionAgent === this.agentId) {
                if (hasTaskComplete) {
                    guidance += `You are responsible for monitoring overall progress and calling task_complete when all agents have finished their contributions.\n`;
                } else {
                    guidance += `You are responsible for monitoring overall progress. Signal completion through your available tools.\n`;
                }
            } else {
                guidance += `You are a contributor. Focus on your part and coordinate with other agents. Do NOT call task_complete.\n`;
            }
        } else {
            if (hasTaskComplete) {
                guidance += `\nYou are responsible for completing this entire task. Call task_complete when finished.\n`;
            } else {
                guidance += `\nYou are responsible for completing this entire task. Use your available tools to complete the work.\n`;
            }
        }
        
        // Add priority and deadline from metadata if available
        if (taskRequest.metadata?.priority) {
            guidance += `- **Priority**: ${taskRequest.metadata.priority}\n`;
        }
        
        if (taskRequest.metadata?.deadline) {
            guidance += `- **Deadline**: ${taskRequest.metadata.deadline}\n`;
        }
        
        if (taskRequest.metadata?.assignedAgentIds && taskRequest.metadata.assignedAgentIds.length > 0) {
            guidance += `- **Assigned Agents**: ${taskRequest.metadata.assignedAgentIds.join(', ')}\n`;
        }
        
        return guidance;
    }

    /**
     * Build completion guidance based on agent role
     */
    private buildCompletionGuidance(taskRequest: any): string {
        const context: AgentContext = {
            agentId: this.agentId,
            currentTask: taskRequest,
            disableToolGatekeeping: this.callbacks.isToolGatekeepingDisabled()
        };
        
        const isCompletionAgent = TaskHelpers.isCurrentTaskCompletionAgent(context, this.logger);
        
        // Check if agent has task_complete tool
        const allowedTools = this.callbacks.getAllowedTools();
        const hasTaskComplete = !allowedTools || allowedTools.includes('task_complete');
        
        if (!isCompletionAgent) {
            return `\n## COMPLETION GUIDANCE:
- You are NOT the completion agent for this task
- Focus on your contribution to the collaborative effort
- Use messaging tools to communicate with other agents
- DO NOT call task_complete - another agent handles that
- Signal your part is done through appropriate communication`;
        }
        
        if (hasTaskComplete) {
            return `\n## COMPLETION GUIDANCE:
- You ARE the completion agent for this task
- Monitor the overall progress of all contributors
- Only call task_complete when the ENTIRE task is finished
- Coordinate with other agents as needed
- Take responsibility for final task completion`;
        } else {
            return `\n## COMPLETION GUIDANCE:
- You ARE the completion agent for this task
- Monitor the overall progress of all contributors
- Signal completion through your available tools when the ENTIRE task is finished
- Coordinate with other agents as needed
- Take responsibility for final task completion`;
        }
    }

    /**
     * Get current task information
     */
    public getCurrentTask(): any {
        return this.currentTask;
    }

    /**
     * Check if there is an active task
     */
    public hasActiveTask(): boolean {
        return this.currentTask !== null && this.currentTask !== undefined;
    }

    /**
     * Check if agent is currently executing a task
     */
    public isExecutingTask(): boolean {
        return this.currentTask !== null;
    }

    /**
     * Get task execution status
     */
    public getTaskExecutionStatus(): {
        isExecuting: boolean;
        currentTask: any;
        executionTime: number;
        taskId?: string;
    } {
        const executionTime = this.currentTask 
            ? Date.now() - this.taskExecutionStartTime 
            : 0;
            
        return {
            isExecuting: this.isExecutingTask(),
            currentTask: this.currentTask,
            executionTime,
            taskId: this.currentTask?.taskId
        };
    }

    /**
     * Store execution metrics for analysis
     */
    private storeExecutionMetrics(taskId: string, executionTime: number): void {
        const metrics = {
            taskId,
            executionTime,
            completedAt: Date.now(),
            agentId: this.agentId
        };
        
        this.taskExecutionMetrics.set(taskId, metrics);
        
        // Keep only last 10 task metrics to prevent memory bloat
        if (this.taskExecutionMetrics.size > 10) {
            const oldestKey = this.taskExecutionMetrics.keys().next().value;
            if (oldestKey) {
                this.taskExecutionMetrics.delete(oldestKey);
            }
        }
        
    }

    /**
     * Get execution metrics for analysis
     */
    public getExecutionMetrics(): Array<{
        taskId: string;
        executionTime: number;
        completedAt: number;
        agentId: string;
    }> {
        return Array.from(this.taskExecutionMetrics.values());
    }

    /**
     * Get average task execution time
     */
    public getAverageExecutionTime(): number {
        const metrics = this.getExecutionMetrics();
        if (metrics.length === 0) return 0;
        
        const totalTime = metrics.reduce((sum, metric) => sum + metric.executionTime, 0);
        return totalTime / metrics.length;
    }

    /**
     * Cancel current task execution
     */
    public cancelCurrentTask(reason?: string): void {
        if (this.currentTask) {
            this.logger.warn(`Canceling current task ${this.currentTask.taskId}: ${reason || 'No reason provided'}`);
            
            // Store cancellation metrics
            const executionTime = Date.now() - this.taskExecutionStartTime;
            this.taskExecutionMetrics.set(this.currentTask.taskId, {
                taskId: this.currentTask.taskId,
                executionTime,
                completedAt: Date.now(),
                agentId: this.agentId,
                cancelled: true,
                cancellationReason: reason
            });
            
            // Clear current task
            this.currentTask = null;
            this.callbacks.setCurrentTask(null);
        }
    }

    /**
     * Validate task request structure
     */
    public validateTaskRequest(taskRequest: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!taskRequest) {
            errors.push('Task request is null or undefined');
            return { valid: false, errors };
        }
        
        if (!taskRequest.taskId) {
            errors.push('Task request missing taskId');
        }
        
        if (!taskRequest.content && !taskRequest.description) {
            errors.push('Task request missing content or description');
        }
        
        if (!taskRequest.fromAgentId && !taskRequest.requesterId) {
            errors.push('Task request missing fromAgentId or requesterId');
        }
        
        // Validate metadata if present
        if (taskRequest.metadata) {
            if (taskRequest.metadata.multiAgentTask && typeof taskRequest.metadata.isCompletionAgent !== 'boolean') {
                errors.push('Multi-agent task missing isCompletionAgent boolean flag');
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Build intent formulation guidance based on task description
     */
    private buildIntentFormulationGuidance(taskDescription: string): string {
        // Check if this is a calculation task
        if (/calculate|sum|add|subtract|multiply|divide|math|arithmetic/i.test(taskDescription)) {
            const suggestedIntents = IntentFormulationHelper.suggestIntents(taskDescription);
            
            return `## TOOL DISCOVERY GUIDANCE:
This task involves mathematical calculations. When using 'tools_recommend' to discover tools:

- Be SPECIFIC about the mathematical operation you need
- Focus on the action (add, multiply, divide) not coordination
- Example good intents: ${suggestedIntents.map(intent => `"${intent}"`).join(', ')}
- Avoid vague intents like "coordinate calculation" or "handle math request"`;
        }
        
        return '';
    }

    /**
     * Cleanup task execution manager
     */
    public cleanup(): void {
        
        if (this.currentTask) {
            this.cancelCurrentTask('Manager cleanup');
        }
        
        this.taskExecutionMetrics.clear();
    }
}