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
 * Handlers for Task-related events
 */

import { v4 as uuidv4 } from 'uuid';
import { Events } from '../../shared/events/EventNames';
import { TaskEvents } from '../../shared/events/event-definitions/TaskEvents';
import { AgentEvents } from '../../shared/events/event-definitions/AgentEvents';
import { EventBus } from '../../shared/events/EventBus';
import { Handler } from './Handler';
import { SimpleTaskRequest, SimpleTaskResponse, TaskRequestHandler } from '../../shared/interfaces/TaskInterfaces';
import { Subscription } from 'rxjs';
import { TaskRequestEvent, TaskResponseEvent } from '../../shared/events/EventNames'; // These types might become obsolete or change
import { 
    createBaseEventPayload, 
    createTaskEventPayload,
    BaseEventPayload 
} from '../../shared/schemas/EventPayloadSchema'; // Updated import

export class TaskHandlers extends Handler {
    private agentId: string;
    private channelId: string; // Added to store channelId from constructor
    private readonly processedTaskAssignments = new Set<string>(); // Track processed assignments
    
    // Task-related handlers and callbacks
    private taskRequestHandler: TaskRequestHandler | null = null;
    private responseHandlers: Map<string, (response: SimpleTaskResponse) => void> = new Map();
    private globalResponseHandler: (response: SimpleTaskResponse) => void = () => {};
    
    // Store subscriptions for proper cleanup
    private subscriptions: Subscription[] = [];
    
    /**
     * Create new task event handlers
     * 
     * @param channelId Channel ID the agent belongs to
     * @param agentId Agent ID that owns this handler
     */
    constructor(channelId: string, agentId: string) {
        super(`TaskHandlers:${agentId}`);
        this.agentId = agentId;
        this.channelId = channelId; // Store channelId
        
        // Validate constructor parameters
        this.validator.assertIsNonEmptyString(channelId);
        this.validator.assertIsNonEmptyString(agentId);
    }
    
    /**
     * Initialize task event handlers
     * @internal - This method is called internally by MxfClient
     */
    public initialize(): void {
        
        this.setupTaskRequestHandler();
        this.setupTaskResponseHandler();
        this.setupTaskAssignedHandler();
    }
    
    /**
     * Clean up event handlers when shutting down
     * @internal - This method is called internally by MxfClient
     */
    public cleanup(): void {
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
    }
    
    /**
     * Set a handler for task requests
     * 
     * @param handler Function that handles task requests
     * @internal - This method is called internally by MxfClient
     */
    public setTaskRequestHandler(handler: TaskRequestHandler): void {
        this.validator.assertIsFunction(handler);
        this.taskRequestHandler = handler;
    }
    
    /**
     * Set a global handler for all task responses
     * This is called for every response after any task-specific handler
     * 
     * @param handler Function that handles all task responses
     * @internal - This method is for internal use only
     */
    private setGlobalResponseHandler(handler: (response: SimpleTaskResponse) => void): void {
        this.validator.assertIsFunction(handler);
        this.globalResponseHandler = handler;
    }
    
    /**
     * Send a task request to another agent
     * 
     * @param toAgentId The ID of the agent to send the task to
     * @param task The task description
     * @returns Promise resolving to the task ID
     */
    public async sendTaskRequest(toAgentId: string, task: string, metadata?: any): Promise<string> {
        this.validator.assertIsNonEmptyString(toAgentId);
        this.validator.assertIsNonEmptyString(task);
        
        // Generate a unique task ID
        const taskId = uuidv4();
        
        // Create the task request event data
        const taskRequestData = {
            taskId: taskId,
            fromAgentId: this.agentId,
            toAgentId: toAgentId,
            task: task,
            metadata: metadata || {}
        };
        
        // Emit the task request event
        const requestPayload = createTaskEventPayload(
            Events.Task.REQUEST,
            this.agentId,       // Source agent of the event
            this.channelId,     // Context channel
            taskRequestData
        );
        EventBus.client.emit(Events.Task.REQUEST, requestPayload);
        
        return taskId;
    }
    
    /**
     * Register a handler for a specific task response
     * 
     * @param taskId The task ID to handle response for
     * @param handler Function to call when response is received
     */
    private registerTaskResponseHandler(
        taskId: string, 
        handler: (response: SimpleTaskResponse) => void
    ): void {
        this.validator.assertIsNonEmptyString(taskId);
        this.validator.assertIsFunction(handler);
        
        this.responseHandlers.set(taskId, handler);
    }
    
    /**
     * Send a response to a task request
     * 
     * @param response The task response
     * @param fromAgentId The ID of the agent sending the response (defaults to this agent's ID)
     * @returns Promise resolving when the response is sent
     */
    public async sendTaskResponse(
        response: SimpleTaskResponse, 
        fromAgentId?: string
    ): Promise<void> {
        this.validator.assertIsObject(response);
        this.validator.assertIsNonEmptyString(response.taskId);
        this.validator.assertIsNonEmptyString(response.toAgentId);
        
        // Convert to TaskResponseEvent format
        const taskResponseData = {
            taskId: response.taskId,
            fromAgentId: fromAgentId || this.agentId,
            toAgentId: response.toAgentId,
            task: response.content
        };
        
        // Emit the response event
        const responsePayload = createTaskEventPayload(
            Events.Task.RESPONSE,
            fromAgentId || this.agentId, // Source agent of the event
            this.channelId,              // Context channel
            taskResponseData
        );
        EventBus.client.emit(Events.Task.RESPONSE, responsePayload);
    }
    
    /**
     * Set up handler for task requests
     * @private
     */
    private setupTaskRequestHandler(): void {
        const subscription = EventBus.client.on(Events.Task.REQUEST, async (task: SimpleTaskRequest) => {
            try {
                // Skip if we don't have a task request handler
                if (!this.taskRequestHandler) {
                    return;
                }
                
                // Only respond to tasks addressed to this agent
                if (task.toAgentId !== this.agentId) {
                    return;
                }
                
                
                // Call the task request handler with the task data and get the response
                const response = await this.taskRequestHandler(task);
                
                // Send the response back
                // Assuming 'response' from taskRequestHandler is the data part for the event.
                // The source agent of this response event is this.agentId.
                const responseData = {
                    taskId: task.taskId,
                    fromAgentId: this.agentId,
                    toAgentId: task.fromAgentId, // respond back to requester
                    task: response
                };

                const responsePayload = createTaskEventPayload(
                    Events.Task.RESPONSE,
                    this.agentId,   // This agent is sending the response
                    this.channelId, // Context channel
                    responseData
                );
                EventBus.client.emit(Events.Task.RESPONSE, responsePayload);
            } catch (error) {
                this.logger.error('Error handling task request:', error);
            }
        });
        
        this.subscriptions.push(subscription);
    }
    
    /**
     * Set up handler for task responses
     * @private
     */
    private setupTaskResponseHandler(): void {
        const subscription = EventBus.client.on(Events.Task.RESPONSE, (response: SimpleTaskResponse) => {
            try {
                // Only process responses addressed to this agent
                if (response.toAgentId !== this.agentId) {
                    return;
                }
                
                
                // Find the handler for this response
                const handler = this.responseHandlers.get(response.taskId);
                if (handler) {
                    // Call the handler with the response
                    handler(response);
                    // Remove the handler
                    this.responseHandlers.delete(response.taskId);
                }
                
                // Call the global response handler
                this.globalResponseHandler(response);
                
            } catch (error) {
                this.logger.error('Error handling task response:', error);
            }
        });
        
        this.subscriptions.push(subscription);
    }
    
    /**
     * Set up handler for task assignments
     * @private
     */
    private setupTaskAssignedHandler(): void {
        this.logger.debug(`[TaskHandlers:${this.agentId}] Setting up ASSIGNED handler subscription`);
        
        const subscription = EventBus.client.on(TaskEvents.ASSIGNED, (payload: any) => {
            try {
                // Debug: Log that we received a task assignment event
                //this.logger.debug(`[TaskHandlers:${this.agentId}] Received ASSIGNED event`);
                
                // Extract task assignment data from payload
                const taskData = payload.data;
                if (!taskData) {
                    this.logger.warn(`[TaskHandlers:${this.agentId}] Task assignment payload missing data`);
                    return;
                }
                
                // Debug: Log the toAgentId and check
                //this.logger.info(`[TaskHandlers:${this.agentId}] Checking assignment: toAgentId=${taskData.toAgentId}, assignedAgentIds=${JSON.stringify(taskData.task?.assignedAgentIds || [])}`);
                
                // Only process tasks assigned to this agent
                const isAssignedToAgent = taskData.toAgentId === this.agentId || 
                                         (taskData.task?.assignedAgentIds && taskData.task.assignedAgentIds.includes(this.agentId));
                
                if (!isAssignedToAgent) {
                    //this.logger.info(`[TaskHandlers:${this.agentId}] Not assigned to this agent, skipping`);
                    return;
                }
                
                //this.logger.info(`[TaskHandlers:${this.agentId}] Task IS assigned to this agent`);
                
                const assignedTask = taskData.task;
                if (!assignedTask) {
                    this.logger.warn(`[TaskHandlers:${this.agentId}] Task assignment payload missing task details`);
                    return;
                }
                
                // Check if task has already been processed
                if (this.processedTaskAssignments.has(assignedTask.id)) {
                    //this.logger.info(`[TaskHandlers:${this.agentId}] Task ${assignedTask.id} already processed, skipping`);
                    return;
                }
                
                //this.logger.info(`[TaskHandlers:${this.agentId}] Processing task ${assignedTask.id} for the first time`);
                this.processedTaskAssignments.add(assignedTask.id);
                
                
                // Convert to SimpleTaskRequest format for compatibility with existing handler
                // Include title and description for proper task context in buildTaskDesc
                const taskRequest: SimpleTaskRequest = {
                    taskId: assignedTask.id,
                    fromAgentId: taskData.fromAgentId,
                    toAgentId: taskData.toAgentId,
                    content: assignedTask.description,
                    title: assignedTask.title, // Include title for proper display
                    description: assignedTask.description, // Include description for buildTaskDesc compatibility
                    metadata: assignedTask.metadata // Include metadata with completion agent info
                };
                
                // Emit an event to notify that a task has been assigned
                // This allows MxfAgent to update its currentTask immediately
                const taskAssignmentPayload = createBaseEventPayload(
                    AgentEvents.TASK_ASSIGNED,
                    this.agentId,
                    assignedTask.channelId || this.channelId,
                    {
                        agentId: this.agentId,
                        task: assignedTask,
                        taskRequest: taskRequest
                    }
                );
                EventBus.client.emit(AgentEvents.TASK_ASSIGNED, taskAssignmentPayload);
                
                // Always trigger task execution - agent roles affect behavior, not task processing
                // Reactive agents will still process tasks and messages, but won't take proactive actions
                if (this.taskRequestHandler) {
                    this.taskRequestHandler(taskRequest).catch(error => {
                        this.logger.error(`Error executing assigned task ${assignedTask.id}:`, error);
                    });
                } else {
                    this.logger.warn('No task request handler set - cannot execute assigned task');
                }
                
                // Log agent role for debugging but don't prevent task execution
                const agentRoles = assignedTask.metadata?.agentRoles || {};
                const agentRole = agentRoles[this.agentId];
                if (agentRole === 'reactive' || agentRole === 'passive') {
                } else if (agentRole === 'proactive') {
                }
                
            } catch (error) {
                this.logger.error('Error handling task assignment:', error);
            }
        });
        
        this.subscriptions.push(subscription);
    }
}
